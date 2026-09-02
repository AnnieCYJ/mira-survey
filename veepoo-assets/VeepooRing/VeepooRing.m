#import "VeepooRing.h"
#import <React/RCTLog.h>
#import <VeepooBleSDK/VeepooBleSDK.h>

// Mira Ring Pro — native bridge over Veepoo's official iOS BLE SDK.
//
// The HK18 ring only speaks through VeepooBleSDK (a precompiled ObjC framework);
// RN / react-native-ble-plx cannot replicate its private GATT protocol. This module
// wraps the SDK and exposes a small JS API + 3 event channels:
//   onStateChange : { status?, deviceName?, deviceAddress?, battery?, firmware?, devices?, error?, bluetooth? }
//   onMetric      : { key:"hr"|"spo2"|"rr"|"eda"|"temp"|"hrv", value:Number, unit:String, ts:Number }
//   onLog         : String
//
// Critical memory/thread rules verified against MiraRingProbe reference:
//   1. EVERY SDK callback block captures self WEAKLY. The SDK retains these blocks
//      and may fire them after the RN module would otherwise dealloc.
//   2. EVERY SDK method call runs on the main queue (CoreBluetooth / Veepoo expect it).
//   3. Events are dispatched async to main queue; the dispatch block also holds weak self.
//   4. onPasswordVerified is guarded so it can only run once per connection cycle.
//   5. dealloc / disconnect clean up timers and nil out the singleton callbacks.

// Diagnostics: track the active RN module instance. When a bridge reloads, the old
// module is dealloc'd; if a stale JS call still reaches it we get EXC_BAD_ACCESS.
// Zombie Objects in scheme diagnostics would reveal the caller, but this guard
// stops the crash and logs the mismatch so we can identify the stale path.
static __unsafe_unretained VeepooRing *g_currentInstance = nil;

// ── 远程日志转发：App 把 [VeepooRing] 日志 POST 到本地收集服务（agent 沙箱内读取），
//    这样排查问题时 agent 能直接看到日志，无需用户在终端手动粘贴。失败静默、绝不阻塞主线程。 ──
static NSString *MRCollectorHost(void) {
  // Xcode scheme 已注入 RCT_PACKAGER_HOSTNAME=Mac 局域网 IP，复用它定位收集服务；
  // 取不到时回退到固定 IP。
  NSString *h = [NSProcessInfo processInfo].environment[@"RCT_PACKAGER_HOSTNAME"];
  if (h.length > 0) return h;
  return @"192.168.1.5";
}

static void MRForward(NSString *tag, NSString *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  NSString *msg = [[NSString alloc] initWithFormat:fmt arguments:ap];
  va_end(ap);
  // 本地仍打印，方便 Xcode 控制台对照
  NSLog(@"[%@] %@", tag, msg);
  // 异步 POST 到本地收集服务，超时 1s、失败静默
  NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://%@:8899/log", MRCollectorHost()]];
  if (!url || !msg) return;
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url
                                                    cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                                timeoutInterval:1.0];
  req.HTTPMethod = @"POST";
  [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"tag": (tag ?: @""), @"msg": msg} options:0 error:nil];
  if (!body) return;
  req.HTTPBody = body;
  NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:req];
  [task resume];
}

@interface VeepooRing ()
@property (nonatomic, strong) NSMutableArray<VPPeripheralModel *> *discovered;
@property (nonatomic, strong) VPPeripheralModel *connectedModel;
@property (nonatomic, assign) BOOL hasSetup;
@property (nonatomic, assign) BOOL listening;
// 注意：不能命名为 autoMonitor —— 那样合成的 setter 会是 setAutoMonitor:，
// 与 RCT_EXPORT_METHOD(setAutoMonitor:) 撞同一个 selector，方法体内 self.monitorOn = on
// 会无限递归调用自身直到栈溢出（EXC_BAD_ACCESS）。故内部属性改名为 monitorOn。
@property (nonatomic, assign) BOOL monitorOn;
@property (nonatomic, assign) BOOL hrRunning;    // 实时心率通道（veepooSDKTestHeartStart，照 RingManager.swift 参考实现）
@property (nonatomic, assign) BOOL oxyRunning;   // 实时血氧通道（veepooSDKTestOxygenStart，与心率分离、可同时开）
@property (nonatomic, assign) BOOL passwordVerified;
@property (nonatomic, assign) BOOL ready;
@property (nonatomic, assign) NSInteger rotationIdx;
@property (nonatomic, assign) BOOL testInProgress;   // 单测占位：同一时刻只跑一路单发测量，避免抢传感器
@property (nonatomic, assign) NSInteger rotationToken; // 配合超时兜底，防止某路回调不来时永久卡死
@property (nonatomic, strong) NSTimer *autoTimer;
@property (nonatomic, strong) NSTimer *hrvReadTimer;  // 历史 HRV 周期读取（HRV 走设备历史库，非实时命令，照《数据可用性定稿》）
// 诊断 / 节流
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *lastEmit;
@property (nonatomic, assign) NSUInteger rawMetricCount;
@property (nonatomic, assign) NSUInteger sentMetricCount;
@property (nonatomic, strong) dispatch_source_t diagTimer;
@end

@implementation VeepooRing

RCT_EXPORT_MODULE(VeepooRing)

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onStateChange", @"onMetric", @"onLog"];
}

- (void)startObserving { self.listening = YES; }
- (void)stopObserving { self.listening = NO; }

// Force the module to be initialized and called on the main queue. The Veepoo SDK
// requires CoreBluetooth interactions on the main thread, and a non-main module can
// race with bridge reload and dealloc, producing EXC_BAD_ACCESS on stale instances.
- (BOOL)requiresMainQueueSetup { return YES; }

- (void)dealloc {
  MRForward(@"NATIVE", @"[VeepooRing LIFECYCLE] dealloc instance=%p current=%p", self, g_currentInstance);
  [self cleanup];
  @synchronized(self) {
    if (g_currentInstance == self) {
      g_currentInstance = nil;
      MRForward(@"NATIVE", @"[VeepooRing LIFECYCLE] cleared active instance");
    }
  }
}

#pragma mark - helpers

- (VPBleCentralManage *)manager { return [VPBleCentralManage sharedBleManager]; }
- (VPPeripheralBaseManage *)peripheral { return [VPBleCentralManage sharedBleManager].peripheralManage; }

- (void)emit:(NSString *)name body:(id)body {
  // Weak capture through the dispatch boundary so a late callback cannot
  // message a deallocated module.
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself || !sself.listening) return;
    [sself sendEventWithName:name body:body];
  });
}

- (void)emitMetric:(NSString *)key value:(double)value unit:(NSString *)unit {
  @synchronized(self) {
    self.rawMetricCount++;
    // 节流：每个 key 每秒最多推 ~5 次，避免 Veepoo 实时回调高频把 RN bridge / 主线程冲爆导致卡死。
    // 原生 SDK 实时心率/血氧回调频率极高（实测可每次回调都触发），不节流会瞬间淹没 JS 线程。
    NSTimeInterval now = CFAbsoluteTimeGetCurrent();
    NSTimeInterval last = [self.lastEmit[key] doubleValue];
    const NSTimeInterval MIN_INTERVAL = 0.2; // 5Hz per key
    if (last > 0 && (now - last) < MIN_INTERVAL) {
      return;
    }
    self.lastEmit[key] = @(now);
    self.sentMetricCount++;
  }
  [self emit:@"onMetric" body:@{
    @"key": key,
    @"value": @(value),
    @"unit": unit ?: @"",
    @"ts": @((long)([[NSDate date] timeIntervalSince1970] * 1000))
  }];
}

- (void)emitLog:(NSString *)msg { [self emit:@"onLog" body:msg ?: @""]; }
- (void)emitError:(NSString *)msg { [self emit:@"onStateChange" body:@{@"error": msg ?: @""}]; }

- (void)emitStatus:(NSString *)status
        deviceName:(NSString *)name
          address:(NSString *)addr
          battery:(NSNumber *)battery
          firmware:(NSString *)fw {
  NSMutableDictionary *d = [NSMutableDictionary dictionary];
  if (status) d[@"status"] = status;
  if (name) d[@"deviceName"] = name;
  if (addr) d[@"deviceAddress"] = addr;
  if (battery) d[@"battery"] = battery;
  if (fw) d[@"firmware"] = fw;
  d[@"protocol"] = @"Veepoo";
  [self emit:@"onStateChange" body:d];
}

- (void)emitDevices {
  NSMutableArray *arr = [NSMutableArray array];
  for (VPPeripheralModel *p in self.discovered) {
    [arr addObject:@{
      @"id": p.deviceAddress ?: @"",
      @"name": p.deviceName ?: @"",
      @"rssi": p.RSSI ?: @(0)
    }];
  }
  [self emit:@"onStateChange" body:@{@"devices": arr}];
}

#pragma mark - diagnostics

// 每 2 秒打印指标推送速率（raw=SDK 实际回调次数，sent=经过节流后真正发往 JS 的次数），
// 并探测主线程是否被 bridge/渲染淹没（主线程 300ms 内不响应即判定为阻塞 → 卡死根因）。
- (void)startDiag {
  if (self.diagTimer) return;
  dispatch_queue_t q = dispatch_queue_create("com.mira.veepoo.diag", DISPATCH_QUEUE_SERIAL);
  self.diagTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, q);
  dispatch_source_set_timer(self.diagTimer, DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC, 0);
  __weak typeof(self) wself = self;
  dispatch_source_set_event_handler(self.diagTimer, ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    NSUInteger raw = 0, sent = 0;
    @synchronized(sself) {
      raw = sself.rawMetricCount;
      sent = sself.sentMetricCount;
      sself.rawMetricCount = 0;
      sself.sentMetricCount = 0;
    }
    // 主线程响应性探针：在后台线程向主队列派发一个 no-op，若 300ms 内没执行说明主线程被阻塞。
    __block BOOL responded = NO;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_main_queue(), ^{
      responded = YES;
      dispatch_semaphore_signal(sem);
    });
    long rc = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)));
    NSString *blockMsg = (rc != 0)
      ? @"  ⚠️ MAIN THREAD BLOCKED >300ms（卡死根因=主线程被指标流淹没）"
      : @"";
    MRForward(@"NATIVE", @"[VeepooRing METRIC-RATE] raw=%lu/2s sent=%lu/2s%@", (unsigned long)raw, (unsigned long)sent, blockMsg);
  });
  dispatch_resume(self.diagTimer);
  MRForward(@"NATIVE", @"[VeepooRing DIAG] started metric-rate monitor (2s window)");
}

- (void)stopDiag {
  if (self.diagTimer) {
    dispatch_source_cancel(self.diagTimer);
    self.diagTimer = nil;
  }
}

#pragma mark - setup / lifecycle

- (void)ensureSetup {
  @synchronized(self) {
    if (self.hasSetup) return;
    self.hasSetup = YES;
    g_currentInstance = self;
    self.discovered = [NSMutableArray array];
    self.hrRunning = NO;
    self.oxyRunning = NO;
    self.passwordVerified = NO;
    self.lastEmit = [NSMutableDictionary dictionary];
    MRForward(@"NATIVE", @"[VeepooRing LIFECYCLE] ensureSetup instance=%p set as active", self);
  }

  VPBleCentralManage *m = self.manager;
  m.peripheralManage = [VPPeripheralManage shareVPPeripheralManager];
  m.isLogEnable = YES;
  m.rrisLimit = -100;  // relax RSSI filter so the ring is not dropped

  __weak typeof(self) wself = self;
  m.VPBleCentralManageChangeBlock = ^(VPCentralManagerState state) {
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    NSString *bt = (state == VPCentralManagerStatePoweredOn) ? @"on"
                 : (state == VPCentralManagerStatePoweredOff) ? @"off" : @"unknown";
    [sself emit:@"onStateChange" body:@{@"bluetooth": bt}];
    if (state != VPCentralManagerStatePoweredOn) [sself emitLog:@"系统蓝牙未开启或未授权"];
  };
  m.VPBleConnectStateChangeBlock = ^(VPDeviceConnectState state) {
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    [sself onConnectState:state];
  };

  [self startDiag];
}

- (void)cleanup {
  [self stopDiag];
  [self stopAutoMonitor];
  VPBleCentralManage *m = self.manager;
  m.VPBleCentralManageChangeBlock = nil;
  m.VPBleConnectStateChangeBlock = nil;
  @synchronized(self) {
    self.hasSetup = NO;
    self.passwordVerified = NO;
    self.ready = NO;
  }
}

- (void)onConnectState:(VPDeviceConnectState)state {
  // VPDeviceConnectState: 0 disconn,1 connecting,2 connect,3 pwdSuccess,4 pwdFail,5(?),6 timeout,7 confirmTimeout
  // 调试：把 SDK 连接状态枚举值先打出来，方便确认卡在 扫描/连接/验密 哪一步
  [self emitLog:[NSString stringWithFormat:@"[连接状态] state=%ld (0断连 1连接中 2已连未验密 3验密成功 4验密失败 6超时 7确认超时)", (long)state]];
  if (state == VPDeviceConnectStateVerifyPasswordSuccess) {
    VPPeripheralModel *pm = self.manager.peripheralModel;
    NSString *fw = pm ? [NSString stringWithFormat:@"%@-%lu", pm.deviceVersion, (unsigned long)pm.deviceNumber] : nil;
    [self emitStatus:@"connected" deviceName:pm.deviceName address:pm.deviceAddress battery:nil firmware:fw];
    [self emitLog:@"密码验证成功，已连接"];
    [self onPasswordVerified];
  } else if (state == VPDeviceConnectStateDisConnect) {
    @synchronized(self) { self.passwordVerified = NO; }
    [self stopAutoMonitor];
    [self emitStatus:@"idle" deviceName:nil address:nil battery:nil firmware:nil];
  } else if (state == VPDeviceConnectStateConnecting) {
    [self emitStatus:@"connecting" deviceName:nil address:nil battery:nil firmware:nil];
  } else if (state == VPDeviceConnectStateVerifyPasswordFailure) {
    @synchronized(self) { self.passwordVerified = NO; }
    [self emitStatus:@"error" deviceName:nil address:nil battery:nil firmware:nil];
    [self emitError:@"密码验证失败"];
  } else if (state == VPDeviceConnectStateTimeout) {
    @synchronized(self) { self.passwordVerified = NO; }
    [self emitStatus:@"error" deviceName:nil address:nil battery:nil firmware:nil];
    [self emitError:@"连接超时（若自扫描连接，可能是 SDK 未扫到同一设备）"];
  }
}

- (void)onPasswordVerified {
  @synchronized(self) {
    if (self.passwordVerified) return;
    self.passwordVerified = YES;
    self.ready = NO;
  }

  // All SDK calls must happen on main queue.
  dispatch_async(dispatch_get_main_queue(), ^{
    __weak typeof(self) wself = self;
    __strong typeof(wself) sself = wself;
    if (!sself) return;

    VPBleCentralManage *m = sself.manager;
    VPPeripheralBaseManage *peripheral = m.peripheralManage;
    if (!peripheral) return;

    // 1) 同步个人信息（参考 Demo：验证密码后第一步）
    [peripheral veepooSDKSynchronousPersonalInformationWithStature:165
                                                              weight:55
                                                                birth:1995
                                                                  sex:0
                                                            targetStep:10000
                                                                result:^(NSUInteger r) {}];

    // 2) 读电量
    [peripheral veepooSDKReadDeviceBatteryAndChargeInfo:^(BOOL isPercent, VPDeviceChargeState chargeState, BOOL percenTypeIsLowBat, NSUInteger battery) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      [sself2 emitStatus:nil deviceName:nil address:nil battery:@(battery) firmware:nil];
    }];

    // 3) 链式读自动数据→血氧→历史HRV（初始化算法模块，参考 RingManager）
    [peripheral veepooSdkStartReadDeviceAllDataWithReadStateChangeBlock:^(VPReadDeviceBaseDataState state, NSUInteger totalDay, NSUInteger currentReadDayNumber, NSUInteger readCurrentDayProgress) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      if (state != VPReadDeviceBaseDataComplete) return;

      VPBleCentralManage *m2 = sself2.manager;
      VPPeripheralBaseManage *p2 = m2.peripheralManage;
      if (!p2) return;

      [p2 veepooSdkStartReadDeviceOxygenData:^(VPReadDeviceBaseDataState s2, NSUInteger t2, NSUInteger c2, NSUInteger p2) {
        __strong typeof(wself) sself3 = wself;
        if (!sself3) return;
        if (s2 != VPReadDeviceBaseDataComplete) return;

        VPBleCentralManage *m3 = sself3.manager;
        VPPeripheralBaseManage *p3 = m3.peripheralManage;
        if (!p3) return;

        [p3 veepooSdkStartReadDeviceHrvData:^(VPReadDeviceBaseDataState s3, NSUInteger t3, NSUInteger c3, NSUInteger p3) {
          __strong typeof(wself) sself4 = wself;
          if (!sself4) return;
          [sself4 markReadyAndStartIfNeeded];
        }];
      }];
    }];

    // 4) 自动监测开启则启动实时心率+血氧两条独立通道（仅当 SDK 已就绪；否则由 markReady 触发）
    if (sself.ready && sself.monitorOn) {
      [sself startRealtimeHR];
      [sself startRealtimeOxygen];
    }
  });

  // 兜底：若初始化读取链迟迟不回调（部分固件 HRV 读取不触发），30s 后强制就绪，
  // 避免实时测量永远无法启动。
  __weak typeof(self) wselfFb = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong typeof(wselfFb) sselfFb = wselfFb;
    if (!sselfFb) return;
    if (!sselfFb.ready) {
      [sselfFb emitLog:@"初始化读取超时，已强制就绪"];
      [sselfFb markReadyAndStartIfNeeded];
    }
  });
}

- (void)markReadyAndStartIfNeeded {
  @synchronized(self) {
    if (self.ready) return;
    self.ready = YES;
  }
  [self emitLog:@"SDK 初始化完成，可开始实时测量"];
  if (self.monitorOn) {
    [self startRealtimeHR];
    [self startRealtimeOxygen];
    [self startRotationIfNeeded];
    [self startHrvReadIfNeeded];
  }
}

#pragma mark - exported methods

RCT_EXPORT_METHOD(scan) {
  [self ensureSetup];
  [self.discovered removeAllObjects];
  [self emitLog:@"开始扫描附近蓝牙设备…（请确认 iPhone 蓝牙已开、戒指戴在手指/靠近手机且有电）"];
  [self emitDevices];

  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    [sself.manager veepooSDKStartScanDeviceAndReceiveScanningDevice:^(VPPeripheralModel * _Nullable model) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2 || !model) return;
      BOOL found = NO;
      for (VPPeripheralModel *p in sself2.discovered) {
        if ([p.deviceAddress isEqualToString:model.deviceAddress]) { found = YES; break; }
      }
      if (!found) {
        [sself2.discovered addObject:model];
        [sself2 emitDevices];
        [sself2 emitLog:[NSString stringWithFormat:@"发现设备: %@ / %@", model.deviceName, model.deviceAddress]];
      }
    }];
  });
}

RCT_EXPORT_METHOD(stopScan) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.manager veepooSDKStopScanDevice];
  });
}

RCT_EXPORT_METHOD(connect:(NSString *)address) {
  [self ensureSetup];
  [self stopScan];

  VPPeripheralModel *target = nil;
  for (VPPeripheralModel *p in self.discovered) {
    if ([p.deviceAddress isEqualToString:address] || [p.deviceName isEqualToString:address]) {
      target = p; break;
    }
  }
  if (!target) {
    [self emitError:[NSString stringWithFormat:@"未找到设备 %@", address]];
    return;
  }
  self.connectedModel = target;
  [self emitLog:[NSString stringWithFormat:@"发起连接 → %@ / %@", target.deviceName, target.deviceAddress]];
  [self emitStatus:@"connecting" deviceName:nil address:nil battery:nil firmware:nil];

  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    [sself.manager veepooSDKConnectDevice:target deviceConnectBlock:^(DeviceConnectState connectState) {
      // handled mainly by VPBleConnectStateChangeBlock; nothing extra needed here
    }];
  });
}

RCT_EXPORT_METHOD(disconnect) {
  [self cleanup];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.manager veepooSDKDisconnectDevice];
  });
  self.connectedModel = nil;
  [self emitStatus:@"idle" deviceName:nil address:nil battery:nil firmware:nil];
}

RCT_EXPORT_METHOD(setAutoMonitor:(BOOL)on) {
  MRForward(@"NATIVE", @"[VeepooRing LIFECYCLE] setAutoMonitor entry self=%p active=%p on=%d ready=%d listening=%d",
        self, g_currentInstance, on, self.ready, self.listening);

  // 守卫：若本调用落到非当前活跃实例，不再「拒绝」（拒绝会让自动监测静默失效），
  // 而是以当前实例为准继续，避免自动监测在重建/重连后永远不生效。
  if (self != g_currentInstance) {
    MRForward(@"NATIVE", @"[VeepooRing LIFECYCLE] setAutoMonitor: self=%p != active=%p，采用当前实例继续", self, g_currentInstance);
    g_currentInstance = self;
  }

  self.monitorOn = on;
  // 只有 SDK 就绪后才启动连续实时测量，避免与连接时的初始化读取链并发冲突（曾导致原生崩溃）。
  if (on && self.ready) {
    [self startRealtimeHR];
    [self startRealtimeOxygen];
    // 启动两路单发测量轮询（体温/皮电），让它们也能持续更新（见 tickRotation）。
    [self startRotationIfNeeded];
    [self startHrvReadIfNeeded];
  }
}

- (void)stopAutoMonitor {
  if (self.autoTimer) { [self.autoTimer invalidate]; self.autoTimer = nil; }
  if (self.hrvReadTimer) { [self.hrvReadTimer invalidate]; self.hrvReadTimer = nil; }
  self.testInProgress = NO;
  [self stopRealtimeHR];
    [self stopRealtimeOxygen];
}

// 自动监测开启后，轮询触发「受 HK18 固件支持」的单发测量：体温(healthGlance) / 皮电 GSR(eda)。
// 设计要点（对照 数据可用性定稿.md + RingManager.swift 参考实现 + 真机日志）：
//  1. 这两路都不需要先停实时心率/血氧——停了反而让测试起不来（旧版 bug 根因之一）。
//  2. 用「单测占位于 testInProgress + 每路 50s 超时兜底」替代旧版全局 measuring 互斥锁：
//     任何一路回调不来（固件不支持/没佩戴）只卡自己这一路，超时后立刻放行下一轮，绝不再永久拦截全部通道。
//  3. HRV 不走固件命令（isSupportHRVTest=false，文档盖章不可用），改由设备历史库读取（readHistoricalHrv）。
//  4. 呼吸率(breathing)：本固件 veepooSDKTestBreathingRateStart 恒返 NoFunction(7)，且一旦调用会掐断
//     实时 HR+SpO₂ 通道（真机日志 15:27:51 触发 → 15:27:53 raw=0 全停），故 rotation 不再测它，卡片标「待接入」。
- (void)startRotationIfNeeded {
  if (self.autoTimer) return;
  self.rotationIdx = 0;
  self.testInProgress = NO;
  self.autoTimer = [NSTimer scheduledTimerWithTimeInterval:10.0
                                                    target:self
                                                  selector:@selector(tickRotation)
                                                  userInfo:nil
                                                   repeats:YES];
  [self tickRotation];
  MRForward(@"NATIVE", @"[VeepooRing] rotation timer started (temp/eda)");
}

- (void)tickRotation {
  if (!self.monitorOn || !self.ready) return;
  if (self.testInProgress) return;   // 上一发单测还没结束/超时，等下一轮
  self.testInProgress = YES;
  NSInteger idx = self.rotationIdx % 2;
  self.rotationIdx++;
  NSInteger myToken = ++self.rotationToken;
  NSArray<NSString *> *names = @[@"体温(healthGlance)", @"皮电(gsr)"];
  MRForward(@"NATIVE", @"[VeepooRing ROTATION] -> %@", names[idx]);
  if (idx == 0) [self triggerHealthGlanceWithToken:myToken];
  else [self triggerGSRWithToken:myToken];
  // 每路 50s 超时兜底：若回调不来（固件不支持/未佩戴），强制放行，避免永久卡死。
  __weak typeof(self) wself = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    if (sself.testInProgress && sself.rotationToken == myToken) {
      MRForward(@"NATIVE", @"[VeepooRing ROTATION] #%ld 超时未回调，强制放行（固件可能不支持或未佩戴）", (long)myToken);
      sself.testInProgress = NO;
    }
  });
}

- (void)finishTestWithToken:(NSInteger)token {
  // 仅在轮询 token 匹配时释放「单测占位」，避免旧测试的迟到回调误清当前测试。
  if (self.rotationToken == token) self.testInProgress = NO;
}

RCT_EXPORT_METHOD(measure:(NSString *)key) {
  MRForward(@"NATIVE", @"[VeepooRing MEASURE] key=%@ ready=%d monitorOn=%d periph=%d", key, self.ready, self.monitorOn, (self.peripheral != nil));
  if (!self.ready) {
    [self emitLog:@"设备仍在初始化（读取历史数据），请稍候几秒再测量"];
    return;
  }
  if ([key isEqualToString:@"hr"] || [key isEqualToString:@"spo2"]) {
    // 照 RingManager.swift 参考实现：实时心率与血氧是两条独立通道，分别开启、可同时运行
    // （HK18 上二者共存，无抢占；HRV 反算也依赖实时心率这条流）。
    [self startRealtimeHR];
    [self startRealtimeOxygen];
    // 若自动监测未开启（即本测量是一次性手动触发），22s 后自动停掉这两条通道，避免空转。
    if (!self.monitorOn) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(22 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        __weak typeof(self) wself = self;
        __strong typeof(wself) sself = wself;
        if (!sself) return;
        if (!sself.monitorOn) { [sself stopRealtimeHR]; [sself stopRealtimeOxygen]; }
      });
    }
  } else if ([key isEqualToString:@"rr"]) {
    // 呼吸率：本固件 veepooSDKTestBreathingRateStart 恒返 NoFunction(7)，且一旦调用会掐断实时 HR+SpO₂ 通道，
    // 故不再调用。卡片诚实显示「待接入」，不塞假数、也不拖垮心率。
    [self emitLog:@"呼吸率：本设备固件未开放（SDK 返回 NoFunction），暂以待接入呈现"];
    MRForward(@"NATIVE", @"[VeepooRing MEASURE] rr -> 固件不支持，跳过（避免掐断实时 HR/SpO₂）");
  } else if ([key isEqualToString:@"eda"]) {
    [self triggerGSRWithToken:-1];
  } else if ([key isEqualToString:@"temp"]) {
    [self triggerHealthGlanceWithToken:-1];
  } else if ([key isEqualToString:@"hrv"]) {
    // HRV 实时测试固件不支持（isSupportHRVTest=false），改由设备历史库读取（数据可用性定稿.md 第72行）。
    [self readHistoricalHrv];
  } else {
    [self emitLog:[NSString stringWithFormat:@"未知测量项: %@", key]];
  }
}

RCT_EXPORT_METHOD(readBattery) {
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) return;
    [p veepooSDKReadDeviceBatteryAndChargeInfo:^(BOOL isPercent, VPDeviceChargeState chargeState, BOOL percenTypeIsLowBat, NSUInteger battery) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      [sself2 emitStatus:nil deviceName:nil address:nil battery:@(battery) firmware:nil];
    }];
  });
}

RCT_EXPORT_METHOD(findDevice) {
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) return;
    [p veepooSDKSendPairedWithIphoneCommand];
    [sself emitLog:@"已发送配对/查找指令（部分固件会让戒指震动或亮灯）"];
  });
}

#pragma mark - realtime HR / SpO2

- (void)startRealtimeHR {
  @synchronized(self) {
    if (self.hrRunning) return;
    self.hrRunning = YES;
  }
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself || !sself.ready) { @synchronized(self){ self.hrRunning = NO; } return; }
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) { @synchronized(self){ self.hrRunning = NO; } return; }
    // 照 RingManager.swift 参考实现：单独开实时心率，回调持续回传 bpm（HRV 反算也依赖此流）。
    [p veepooSDKTestHeartStart:YES testResult:^(VPTestHeartState testHeartState, NSUInteger heartValue) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      MRForward(@"NATIVE", @"[VeepooRing CB hr] state=%ld value=%lu", (long)testHeartState, (unsigned long)heartValue);
      if (heartValue > 0) [sself2 emitMetric:@"hr" value:(double)heartValue unit:@"bpm"];
    }];
  });
}

- (void)stopRealtimeHR {
  @synchronized(self) {
    if (!self.hrRunning) return;
    self.hrRunning = NO;
  }
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) return;
    [p veepooSDKTestHeartStart:NO testResult:^(VPTestHeartState s, NSUInteger v) {}];
  });
}

- (void)startRealtimeOxygen {
  @synchronized(self) {
    if (self.oxyRunning) return;
    self.oxyRunning = YES;
  }
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself || !sself.ready) { @synchronized(self){ self.oxyRunning = NO; } return; }
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) { @synchronized(self){ self.oxyRunning = NO; } return; }
    [p veepooSDKTestOxygenStart:YES testResult:^(VPTestOxygenState testOxygenState, NSUInteger oxygenValue) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      MRForward(@"NATIVE", @"[VeepooRing CB spo2] state=%ld value=%lu", (long)testOxygenState, (unsigned long)oxygenValue);
      if (oxygenValue > 0) [sself2 emitMetric:@"spo2" value:(double)oxygenValue unit:@"%"];
    }];
  });
}

- (void)stopRealtimeOxygen {
  @synchronized(self) {
    if (!self.oxyRunning) return;
    self.oxyRunning = NO;
  }
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) return;
    [p veepooSDKTestOxygenStart:NO testResult:^(VPTestOxygenState s, NSUInteger v) {}];
  });
}

#pragma mark - single-shot metrics (HK18 固件支持的单发测量)

- (void)triggerHealthGlanceWithToken:(NSInteger)token {
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) { [sself finishTestWithToken:token]; return; }
    // 注意：不先停实时心率/血氧（对照 RingManager.swift，healthGlance 与实时通道可共存；
    // 旧版先停实时反而让测试起不来 → 回调不来 → 永久卡死）。
    [p veepooSDK_healthGlanceTestStart:YES
        andProgress:^(NSInteger progress) {
          MRForward(@"NATIVE", @"[VeepooRing CB healthGlance] progress=%ld", (long)progress);
        }
        andResult:^(VPDeviceHealthGlanceState state, VPHealthGlanceTestModel * _Nullable model) {
          __strong typeof(wself) sself2 = wself;
          if (!sself2) return;
          MRForward(@"NATIVE", @"[VeepooRing CB healthGlance] state=%ld temp=%.2f spo2=%.0f hr=%.0f",
                    (long)state, model?model.bodyTemperature:0.0, model?(double)model.bloodOxygen:0.0, model?(double)model.heartRate:0.0);
          if (model) {
            if (model.bodyTemperature > 0) [sself2 emitMetric:@"temp" value:model.bodyTemperature unit:@"℃"];
            if (model.bloodOxygen > 0)     [sself2 emitMetric:@"spo2" value:(double)model.bloodOxygen unit:@"%"];
            if (model.heartRate > 0)       [sself2 emitMetric:@"hr" value:(double)model.heartRate unit:@"bpm"];
          }
          // 测完主动停止本病种测试（参考 RingManager：healthGlance 完成需显式 stop）。
          [p veepooSDK_healthGlanceTestStart:NO andProgress:^(NSInteger pr) {} andResult:^(VPDeviceHealthGlanceState s, VPHealthGlanceTestModel * _Nullable m) {}];
          [sself2 finishTestWithToken:token];
        }];
  });
}

- (void)triggerGSRWithToken:(NSInteger)token {
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) { [sself finishTestWithToken:token]; return; }
    [p veepooSDKTestGSRStart:YES
        progress:^(NSProgress * _Nullable progress) {
          MRForward(@"NATIVE", @"[VeepooRing CB gsr] progress=%.0f%%", (progress?progress.fractionCompleted:0.0)*100.0);
        }
        testResult:^(VPDeviceGSRState state, VPGSRResultModel * _Nullable model) {
          __strong typeof(wself) sself2 = wself;
          if (!sself2) return;
          MRForward(@"NATIVE", @"[VeepooRing CB gsr] state=%ld skin_moisture=%.2f emotion=%.1f sns=%ld cortisol=%.0f",
                    (long)state, model?model.skin_moisture:0.0, model?model.emotin_level:0.0,
                    (long)(model?model.sns_activation:0), model?model.cortisol_value:0.0);
          if (model) {
            // 皮肤含水量作为 EDA 主指标；交感/皮质醇/情绪可在后续扩展
            [sself2 emitMetric:@"eda" value:(double)model.skin_moisture unit:@""];
          }
          if (state == VPDeviceGSRStateComplete) {
            [p veepooSDKTestGSRStart:NO progress:nil testResult:nil];
          }
          [sself2 finishTestWithToken:token];
        }];
  });
}

#pragma mark - HRV（历史读取，非实时命令）

// HK18 固件不支持「实时 HRV 测试」命令（isSupportHRVTest=false，见《数据可用性定稿》）。
// 协议指明 HRV 唯一可行通路 = 设备历史/全天 HRV 读取 veepooSdkStartReadDeviceHrvData
// （原厂 Demo VPRootViewController.readHrvData() 同款，第六轮已验证读取成功 ✅）。
// 该读取只回进度，真实数值经本地库交付 → 在 .complete 后调用
// veepooSDK_readHrvDataWithDayNumber:0 取当日 HRV 数组，取均值上报。每 5 分钟读一次。
- (void)startHrvReadIfNeeded {
  if (self.hrvReadTimer) return;
  [self readHistoricalHrv];
  __weak typeof(self) wself = self;
  self.hrvReadTimer = [NSTimer scheduledTimerWithTimeInterval:300.0
                                                       target:self
                                                     selector:@selector(readHistoricalHrv)
                                                     userInfo:nil
                                                      repeats:YES];
  MRForward(@"NATIVE", @"[VeepooRing] HRV 历史读取已启动（每 300s 一次）");
}

- (void)readHistoricalHrv {
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself || !sself.ready) return;
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) return;
    MRForward(@"NATIVE", @"[VeepooRing HRV] veepooSdkStartReadDeviceHrvData →");
    [p veepooSdkStartReadDeviceHrvData:^(VPReadDeviceBaseDataState state, NSUInteger totalDay, NSUInteger curDay, NSUInteger progress) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      MRForward(@"NATIVE", @"[VeepooRing HRV] state=%ld totalDay=%lu curDay=%lu progress=%lu",
                (long)state, (unsigned long)totalDay, (unsigned long)curDay, (unsigned long)progress);
      if (state != VPReadDeviceBaseDataComplete) return;
      // 读取完成 → 从本地库取当日 HRV 数组（值与进度回调分离，见《数据可用性定稿》第150行）
      dispatch_async(dispatch_get_main_queue(), ^{
        __strong typeof(wself) sself3 = wself;
        if (!sself3) return;
        VPPeripheralBaseManage *p2 = sself3.peripheral;
        if (!p2) return;
        [p2 veepooSDK_readHrvDataWithDayNumber:0 maxPackage:30
                                        result:^(NSArray *oneDayHrvArray, NSInteger totalPackage, NSInteger currentReadPackage) {
          __strong typeof(wself) sself4 = wself;
          if (!sself4) return;
          NSMutableArray<NSNumber *> *vals = [NSMutableArray array];
          for (id obj in oneDayHrvArray) {
            if ([obj isKindOfClass:[NSNumber class]]) {
              double v = [obj doubleValue];
              if (v > 0) [vals addObject:@(v)];
            }
          }
          MRForward(@"NATIVE", @"[VeepooRing CB hrv] count=%lu totalPkg=%ld curPkg=%ld",
                    (unsigned long)vals.count, (long)totalPackage, (long)currentReadPackage);
          if (vals.count > 0) {
            double sum = 0; for (NSNumber *n in vals) sum += n.doubleValue;
            double mean = sum / vals.count;
            [sself4 emitMetric:@"hrv" value:mean unit:@"ms"];
            MRForward(@"NATIVE", @"[VeepooRing CB hrv] emit HRV mean=%.1f ms (n=%lu)", mean, (unsigned long)vals.count);
          } else {
            MRForward(@"NATIVE", @"[VeepooRing CB hrv] 当日无 HRV 数据（设备尚未采集/未佩戴）");
          }
        }];
      });
    }];
  });
}

@end
