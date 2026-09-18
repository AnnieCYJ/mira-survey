#import "VeepooRing.h"
#import <VeepooBleSDK/VPAccurateSleepModel.h>
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
  NSString *h = [NSProcessInfo processInfo].environment[@"RCT_PACKAGER_HOSTNAME"];
  if (h.length > 0) return h;
  return @"192.168.1.10";
}

static void MRForward(NSString *tag, NSString *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  NSString *msg = [[NSString alloc] initWithFormat:fmt arguments:ap];
  va_end(ap);
  // 本地仍打印，方便 Xcode 控制台对照
  NSLog(@"[%@] %@", tag, msg);
  // ★ 追加写文件 Documents/NATIVE_LOG.txt（真机拉出来直接看）
  @try {
    static dispatch_once_t onceToken;
    static NSString *logPath = nil;
    dispatch_once(&onceToken, ^{
      NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
      logPath = [docs stringByAppendingPathComponent:@"NATIVE_LOG.txt"];
    });
    NSString *line = [NSString stringWithFormat:@"[%@] [%@] %@\n", [NSDate date], tag, msg];
    NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:logPath];
    if (!fh) { [@"" writeToFile:logPath atomically:YES encoding:NSUTF8StringEncoding error:nil]; fh = [NSFileHandle fileHandleForWritingAtPath:logPath]; }
    [fh seekToEndOfFile];
    [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [fh closeFile];
  } @catch (NSException *e) {}
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
@property (nonatomic, assign) NSUInteger deviceTotalDays;
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
// ★ V2 backfill serial queue：所有 VPDataBaseOperation 读操作在这个队列串行执行，
//   避免 30 天批量 backfill 阻塞主线程导致 UI 卡顿。emit 自身已经 async 回 main queue。
@property (nonatomic, strong) dispatch_queue_t backfillQueue;
@end

@implementation VeepooRing

RCT_EXPORT_MODULE(VeepooRing)

// ★★ V2 事件收敛：全文件只 emit 4 种事件
//   onRealtime  → 实时单 metric（hr/spo2/temp/eda…），每秒 1-2 条
//   onBatch     → 离线批量回填（5min slots + 每日聚合），backfill 完成后 emit
//   onState     → 连接/同步状态变化
//   onLog       → 调试日志（开发时看，将来可关闭）
- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"onLog",
    @"onRealtime",
    @"onBatch",
    @"onState",
  ];
}

- (void)startObserving { self.listening = YES; }
- (void)stopObserving { self.listening = NO; }

// Force the module to be initialized and called on the main queue. The Veepoo SDK
// requires CoreBluetooth interactions on the main thread, and a non-main module can
// race with bridge reload and dealloc, producing EXC_BAD_ACCESS on stale instances.
- (BOOL)requiresMainQueueSetup { return YES; }

- (instancetype)init {
  self = [super init];
  if (self) {
    _backfillQueue = dispatch_queue_create("com.mira.backfill", DISPATCH_QUEUE_SERIAL);
    _ready = NO;
  }
  return self;
}

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
  // ★★★ emit 入口 marker：记录每个 emit 的事件名
  static int emitCount = 0;
  emitCount++;
  BOOL isBackfill = [name isEqualToString:@"onBatch"];
  if (isBackfill) {
    NSLog(@"[EMIT_MARKER] #%d name=%@ bodyKeys=%lu listening=%d", emitCount, name, (unsigned long)[(NSArray*)[body allKeys] count], self.listening);
  }
  // Weak capture through the dispatch boundary so a late callback cannot
  // message a deallocated module.
  __weak typeof(self) wself = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) { NSLog(@"[EMIT_MARKER] dealloced, skip"); return; }
    if (!sself.listening) { NSLog(@"[EMIT_MARKER] listening=NO, skip name=%@", name); return; }
    [sself sendEventWithName:name body:body];
    if (isBackfill) {
      NSLog(@"[EMIT_MARKER] ✅ sent name=%@", name);
      // ★ 追加写文件（避免覆盖，看事件数量）
      @try {
        NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
        NSString *path = [docs stringByAppendingPathComponent:@"EMIT_LOG.txt"];
        NSString *line = [NSString stringWithFormat:@"[%@] name=%@ listening=%d\n", name, name, sself.listening];
        NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:path];
        if (!fh) { [@"" writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil]; fh = [NSFileHandle fileHandleForWritingAtPath:path]; }
        [fh seekToEndOfFile];
        [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
        [fh closeFile];
      } @catch (NSException *e) {}
    }
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
  [self emit:@"onRealtime" body:@{
    @"metric": key,
    @"value": @(value),
    @"unit": unit ?: @"",
    @"ts": @((long)([[NSDate date] timeIntervalSince1970] * 1000))
  }];
}

- (void)emitLog:(NSString *)msg { [self emit:@"onLog" body:msg ?: @""]; }
- (void)emitError:(NSString *)msg { [self emit:@"onState" body:@{@"status": @"error", @"error": msg ?: @""}]; }

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
  [self emit:@"onState" body:d];
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
  [self emit:@"onState" body:@{@"status": @"scanResult", @"devices": arr}];
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
    [sself emit:@"onState" body:@{@"status": @"connected", @"bluetooth": bt}];
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
    // ★★ 2026-09-17 修「离线数据连上也回不来」：`connectedModel` 原先**只在 connect:(JS 扫码连接) 里赋值**，
    //   **SDK 自动重连**这条路径不赋值 → `backfill` 里 `sself.connectedModel.deviceAddress` 恒为 nil
    //   → 每次回填都早退「[Backfill] 无已连接设备，跳过」（真机日志实测：连上 1 秒内实时指标已在流，
    //   但重试 5 次回填全部被拒）。在验密成功回调补一次赋值，任何连接方式（自动重连/扫码）都能拿到 MAC。
    if (pm) self.connectedModel = pm;
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

    // ★ 设备能力自检：打印 HealthGlance / ManualTestData / support 的所有标志位
    // 用于确认戒指固件是否支持 cortisol/sns/emotion/bloodComp 功能
    VPPeripheralModel *_pm = peripheral.peripheralModel;
    NSUInteger _hgType = _pm ? _pm.healthGlanceType : 0;          // 0=不支持, 1=定制, 2=公版
    BOOL _hgSupport = _pm ? _pm.supportHealthGlanceTest : NO;
    VPManualTestDataType _mtdType = peripheral.supportManualTestType; // bitmask
    NSString *_hgProto = @"";
    if (_hgType == 0) _hgProto = @"不支持";
    else if (_hgType == 1) _hgProto = @"定制版(无 cortisol/bloodComp)";
    else if (_hgType == 2) _hgProto = @"公版(支持全部)";
    else _hgProto = [NSString stringWithFormat:@"未知(%lu)", (unsigned long)_hgType];
    MRForward(@"NATIVE", @"[VeepooRing] ⚙️ 设备能力：healthGlanceType=%@ supportHealthGlanceTest=%d supportManualTestType=0x%lx",
              _hgProto, _hgSupport, (unsigned long)_mtdType);
    [self emitLog:[NSString stringWithFormat:@"⚙️ 设备能力：healthGlanceType=%@ supportHealthGlanceTest=%d supportManualTestType=0x%lx",
                   _hgProto, _hgSupport, (unsigned long)_mtdType]];
    // 解析 supportManualTestType bitmask 每一位
    NSDictionary *_mtdBits = @{
      @(0): @"BloodPressure", @(1): @"HeartRate", @(2): @"BloodSugar",
      @(3): @"Stress", @(4): @"BloodOxygen", @(5): @"Temperature",
      @(6): @"Met", @(7): @"HRV", @(8): @"BloodComponents",
      @(9): @"HealthGlance(cortisol!)", @(10): @"Emotion", @(11): @"FatigueLevel",
      @(12): @"GSR"
    };
    NSMutableArray *_supp = [NSMutableArray array];
    for (NSNumber *_bit in _mtdBits) {
      if ((_mtdType >> [_bit unsignedIntegerValue]) & 1) [_supp addObject:_mtdBits[_bit]];
    }
    MRForward(@"NATIVE", @"[VeepooRing] ⚙️ 支持的 ManualTestData 类型：%@", [_supp componentsJoinedByString:@", "]);
    [self emitLog:[NSString stringWithFormat:@"⚙️ 支持的 ManualTestData 类型：%@", [_supp componentsJoinedByString:@", "] ]];

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
      self.deviceTotalDays = totalDay;
      if (state != VPReadDeviceBaseDataComplete) return;

      VPBleCentralManage *m2 = sself2.manager;
      VPPeripheralBaseManage *p2 = m2.peripheralManage;
      if (!p2) return;

      [p2 veepooSdkStartReadDeviceOxygenData:^(VPReadDeviceBaseDataState s2, NSUInteger t2, NSUInteger c2, NSUInteger p2) {
        __strong typeof(wself) sself3 = wself;
        if (!sself3) return;
        [sself3 emitLog:[NSString stringWithFormat:@"[SDK_INIT] readOxygen state=%ld totalDay=%lu curDay=%lu", (long)s2, (unsigned long)t2, (unsigned long)c2]];
        if (s2 != VPReadDeviceBaseDataComplete) return;

        VPBleCentralManage *m3 = sself3.manager;
        VPPeripheralBaseManage *p3 = m3.peripheralManage;
        if (!p3) return;

        [p3 veepooSdkStartReadDeviceHrvData:^(VPReadDeviceBaseDataState s3, NSUInteger t3, NSUInteger c3, NSUInteger p3) {
          __strong typeof(wself) sself4 = wself;
          if (!sself4) return;
          [sself4 emitLog:[NSString stringWithFormat:@"[SDK_INIT] readHRV state=%ld totalDay=%lu curDay=%lu → markReady", (long)s3, (unsigned long)t3, (unsigned long)c3]];
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
  // ★★ 版本标志：写 DEPLOY_MARKER.txt 确认当前手机跑的是带 spo2/temp/hrv/glucose merge 的版本
  @try {
    NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    NSString *marker = [docs stringByAppendingPathComponent:@"DEPLOY_MARKER.txt"];
    [[NSString stringWithFormat:@"SDK_READY v2 spo2/fix@%@", [NSDate date]] writeToFile:marker atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSLog(@"[MARKER] DEPLOY_MARKER written ✅");
  } @catch (NSException *e) { NSLog(@"[MARKER] write failed: %@", e); }

  @synchronized(self) {
    if (self.ready) return;
    self.ready = YES;
  }
  [self emitLog:@"SDK 初始化完成，可开始实时测量"];
  [self emit:@"onState" body:@{@"status": @"ready", @"deviceTotalDays": @(self.deviceTotalDays)}];
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
  } else if ([key isEqualToString:@"cortisol"] || [key isEqualToString:@"healthGlance"] || [key isEqualToString:@"sns"] || [key isEqualToString:@"emotion"] || [key isEqualToString:@"skin"] || [key isEqualToString:@"fatigue"]) {
    // ★ 协议：这些指标 SDK 没有独立命令，全部走 veepooSDK_healthGlanceTestStart（一次返回一整套）
    [self triggerHealthGlanceWithToken:-1];
  } else if ([key isEqualToString:@"stress"] || [key isEqualToString:@"depression"]) {
    // stress/depression 走 GSR（VPGSRResultModel 有 sns_activation / depression_risk）
    [self triggerGSRWithToken:-1];
  } else if ([key isEqualToString:@"cholesterol"] || [key isEqualToString:@"triglyceride"] || [key isEqualToString:@"hdl"] || [key isEqualToString:@"ldl"] || [key isEqualToString:@"ua"] || [key isEqualToString:@"uricAcid"]) {
    // 血液成分：也走 healthGlance（protocol==2 固件才有，functionSupport & VPHealthGlanceTypeBloodComp）
    [self triggerHealthGlanceWithToken:-1];
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

#pragma mark - Backfill（离线数据回填）

// ★ V2 backfill：挪到 serial queue，不卡主线程
RCT_EXPORT_METHOD(backfill) {
  [self runBackfillDaysInternal:30 fromDateStr:nil];
}

// ★ V2 增量回填：JS 从 healthStore.lastSyncDate 读出来传入
RCT_EXPORT_METHOD(backfillSince:(NSString *)fromDateStr) {
  [self runBackfillDaysInternal:0 fromDateStr:fromDateStr];
}

// ★ 内部统一入口（serial queue 执行，merge+emit 逻辑复用）
// ★ V2.1: 先拉 ManualTestData（HealthGlance 历史，含 cortisol/sns/emotion/skin/fatigue），
//          再进 _backfillBodyDays。HealthGlance 是戒指 flash 存的真实测量值，不用推算。
- (void)runBackfillDaysInternal:(int)days fromDateStr:(NSString *)fromDateStr {
  __weak typeof(self) wself = self;
  // 先在主线程（SDK delegate 一般要求 main）拉 ManualTestData
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong typeof(wself) sself = wself;
    if (!sself) return;
    NSString *mac = sself.connectedModel.deviceAddress;
    if (!mac && g_currentInstance && g_currentInstance != sself) {
      mac = g_currentInstance.connectedModel.deviceAddress;
    }
    if (!mac) {
      [sself emitLog:@"[Backfill] 无已连接设备，跳过 ManualTestData 拉取"];
      // 没设备直接走原流程（HealthGlanceArr=nil）
      dispatch_async(sself.backfillQueue ?: dispatch_get_global_queue(QOS_CLASS_BACKGROUND, 0), ^{
        [sself _backfillBodyDays:days fromDateStr:fromDateStr healthGlanceArr:nil bloodCompArr:nil];
      });
      return;
    }
    // 拉 ManualTestDataAll（HealthGlanceArr 里有 cortisol/sns/emotion/skin/stress/fatigue/met）
    // timestamp=0 表示拉全部历史
    VPPeripheralBaseManage *p = sself.peripheral;
    if (!p) {
      [sself emitLog:@"[Backfill] peripheralManage 未就绪，跳过 ManualTestData 拉取"];
      dispatch_async(sself.backfillQueue ?: dispatch_get_global_queue(QOS_CLASS_BACKGROUND, 0), ^{
        [sself _backfillBodyDays:days fromDateStr:fromDateStr healthGlanceArr:nil bloodCompArr:nil];
      });
      return;
    }
    VPManualTestDataType dtype = VPManualTestDataAll;
    if (p.supportManualTestType != 0) {
      dtype = (VPManualTestDataType)(p.supportManualTestType & VPManualTestDataAll);
    }
    [sself emitLog:[NSString stringWithFormat:@"[Backfill] 拉 ManualTestData dtype=0x%lx", (unsigned long)dtype]];
    [p readManualTestDataWithTimestamp:0 dataType:dtype result:^(VPManualTestDataModel *model) {
      __strong typeof(wself) sself2 = wself;
      if (!sself2) return;
      NSArray *hgArr = model.healthGlanceArr;
      NSArray *bcArr = model.bloodCompArr;
      [sself2 emitLog:[NSString stringWithFormat:@"[Backfill] ManualTestData healthGlanceArr=%lu bloodCompArr=%lu (血脂/尿酸)", (unsigned long)hgArr.count, (unsigned long)bcArr.count]];
      // 进 serial queue 做 merge+emit
      dispatch_async(sself2.backfillQueue ?: dispatch_get_global_queue(QOS_CLASS_BACKGROUND, 0), ^{
        [sself2 _backfillBodyDays:days fromDateStr:fromDateStr healthGlanceArr:hgArr bloodCompArr:bcArr];
      });
    }];
  });
}

// ★★★ V2.1: 加 healthGlanceArr 参数，merge HealthGlance 历史（cortisol/sns/emotion/skin/fatigue/met/stress 真实值）
- (void)_backfillBodyDays:(int)days fromDateStr:(NSString *)fromDateStr healthGlanceArr:(NSArray *)hgArr bloodCompArr:(NSArray *)bcArr {
  // marker
  @try {
    NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    [[NSString stringWithFormat:@"BACKFILL_V2 at %@ days=%d since=%@", [NSDate date], days, fromDateStr ?: @"nil"] writeToFile:[docs stringByAppendingPathComponent:@"BACKFILL_CALLED.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSLog(@"[BACKFILL_V2] ✅ days=%d since=%@", days, fromDateStr ?: @"nil");
  } @catch (NSException *e) {}

  // ★ 直接在调用链上（serial queue），不需要再 dispatch_async main
    // ★★★ 第二个 marker：确认进入了 block
    @try {
      NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
      [[NSString stringWithFormat:@"BACKFILL_ENTERED_BLOCK at %@", [NSDate date]] writeToFile:[docs stringByAppendingPathComponent:@"BACKFILL_ENTERED.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
      NSLog(@"[BACKFILL_MARKER] ✅ entered dispatch block");
    } @catch (NSException *e) {}
    // ★ 2026-09-17 兜底：若本实例未持有设备（多次 reload / 实例重建），取当前活跃实例的 connectedModel
    NSString *mac = self.connectedModel.deviceAddress;
    if (!mac && g_currentInstance && g_currentInstance != self) {
      mac = g_currentInstance.connectedModel.deviceAddress;
    }
    if (!mac) { [self emitLog:@"[Backfill] 无已连接设备，跳过"]; return; }
    [self emitLog:@"[Backfill] ✅ 开始从 VPDataBaseOperation 读离线数据…"];

    // 读近 30 天（覆盖戒指 flash 实际容量 ~13 天，避免历史中段 09-07~09-14 永远不在 3 天窗口内而丢失）
    // V2：从参数算日期范围
    NSDateFormatter *_df = [[NSDateFormatter alloc] init]; [_df setDateFormat:@"yyyy-MM-dd"];
    NSCalendar *_cal = [NSCalendar currentCalendar];
    int BACKFILL_DAYS = days > 0 ? days : 30;
    if (fromDateStr.length > 0) {
      NSDate *fsd = [_df dateFromString:fromDateStr];
      if (fsd) {
        NSDateComponents *_c = [_cal components:NSCalendarUnitDay fromDate:fsd toDate:[NSDate date] options:0];
        BACKFILL_DAYS = MAX(1, (int)_c.day + 1);
      }
    }
    NSDateFormatter *f = [[NSDateFormatter alloc] init];
    [f setDateFormat:@"yyyy-MM-dd"];
    NSCalendar *cal = [NSCalendar currentCalendar];

    NSTimeInterval tStart = CFAbsoluteTimeGetCurrent();
    __block int emittedCount = 0;
    for (int dn = 0; dn < BACKFILL_DAYS; dn++) {
      // ★ 2026-09-18 健壮性修复：单日处理全程 @try 隔离。
      //   此前一行睡眠调试日志因类型假设抛 NSException → 整个 serial queue 上这轮回填被打断，
      //   backfillDone 不再 emit，导致"今天/全部离线数据都不回来"。任何单日异常都必须只跳过该日。
      @try {
      NSTimeInterval tDayStart = CFAbsoluteTimeGetCurrent();
      NSMutableArray *slots = [NSMutableArray array];
      NSDate *d;
      if (fromDateStr.length > 0) {
        NSDate *_fsd2 = [f dateFromString:fromDateStr];
        d = _fsd2 ? [cal dateByAddingUnit:NSCalendarUnitDay value:dn toDate:_fsd2 options:0] : [cal dateByAddingUnit:NSCalendarUnitDay value:-dn toDate:[NSDate date] options:0];
      } else {
        d = [cal dateByAddingUnit:NSCalendarUnitDay value:-dn toDate:[NSDate date] options:0];
      }
      NSString *dateStr = [f stringFromDate:d];

      // 1) 原始 5min slot
      NSDictionary *original = [VPDataBaseOperation veepooSDKGetOriginalDataWithDate:dateStr andTableID:mac];
      if (original && original.count > 0) {
        [slots removeAllObjects];
        for (NSString *timeKey in original) {
          NSDictionary *slot = original[timeKey];
          NSMutableDictionary *emitSlot = [NSMutableDictionary dictionary];
          emitSlot[@"date"] = dateStr;
          emitSlot[@"time"] = timeKey;
          if (slot[@"heartValue"]) emitSlot[@"hr"] = slot[@"heartValue"];
          if (slot[@"systolic"]) emitSlot[@"bpSys"] = slot[@"systolic"];
          if (slot[@"diastolic"]) emitSlot[@"bpDia"] = slot[@"diastolic"];
          if (slot[@"stress"]) emitSlot[@"stress"] = slot[@"stress"];
          if (slot[@"met"]) emitSlot[@"met"] = slot[@"met"];
          if (slot[@"stepValue"]) emitSlot[@"step"] = slot[@"stepValue"];
          if (slot[@"calValue"]) emitSlot[@"cal"] = slot[@"calValue"];
          if (slot[@"disValue"]) emitSlot[@"dist"] = slot[@"disValue"];
          [slots addObject:emitSlot];
        }
        if (slots.count > 0) {
          // ★ merge oxygen/hrv/temp/step 逐 5min 数据
          {
            NSArray *oxyArr = [VPDataBaseOperation veepooSDKGetDeviceOxygenDataWithDate:dateStr andTableID:mac];
            NSArray *hrvArr  = [VPDataBaseOperation veepooSDKGetDeviceHrvDataWithDate:dateStr andTableID:mac];
            NSArray *tempArr = [VPDataBaseOperation veepooSDKGetDeviceTemperatureDataWithDate:dateStr andTableID:mac];
            NSDictionary *heartHalfHour = [VPDataBaseOperation veepooSDKGetOriginalChangeHalfHourDataWithDate:dateStr andTableID:mac];
            // ★★★ 详细调试：把每天拉到的数据源情况 emit 给 JS
            NSUInteger oxyHR=0, oxyO2=0, oxyStep=0;
            for (NSDictionary *o in oxyArr) {
                if ([o[@"HeartValue"] doubleValue]>0) oxyHR++;
                if ([o[@"OxygenValue"] doubleValue]>0) oxyO2++;
                if ([o[@"StepValue"] doubleValue]>0) oxyStep++;
            }
            NSUInteger hrvValid=0;
            for (NSDictionary *h in hrvArr) {
                double hv = [h[@"hrvValue"] doubleValue];
                if (hv>0 && hv<200) hrvValid++;
            }
            NSUInteger tempValid=0;
            for (NSDictionary *t in tempArr) {
                double vv = [t[@"value"] doubleValue];
                if (vv>30 && vv<42) tempValid++;
            }
            [self emitLog:[NSString stringWithFormat:@"[BACKFILL-API] %@ original=%lu oxy(total=%lu,HR=%lu,O2=%lu,Step=%lu) hrv(total=%lu,valid=%lu) temp(total=%lu,valid=%lu) heartHH=%lu",
                dateStr, (unsigned long)slots.count,
                (unsigned long)oxyArr.count, (unsigned long)oxyHR, (unsigned long)oxyO2, (unsigned long)oxyStep,
                (unsigned long)hrvArr.count, (unsigned long)hrvValid,
                (unsigned long)tempArr.count, (unsigned long)tempValid,
                (unsigned long)heartHalfHour.count]];
            [self emitLog:[NSString stringWithFormat:@"[Backfill merge] %@ original=%lu oxygen=%lu hrv=%lu temp=%lu heartHalfHour=%lu", dateStr, (unsigned long)slots.count, (unsigned long)oxyArr.count, (unsigned long)hrvArr.count, (unsigned long)tempArr.count]];
            NSMutableDictionary *slotIdx = [NSMutableDictionary dictionary];
            for (NSMutableDictionary *s in slots) slotIdx[s[@"time"] ?: @""] = s;

            if (oxyArr.count > 0) {
              NSMutableDictionary *hrB = [NSMutableDictionary dictionary];
              NSMutableDictionary *o2B = [NSMutableDictionary dictionary];
              NSMutableDictionary *tpB = [NSMutableDictionary dictionary];
              NSMutableDictionary *spB = [NSMutableDictionary dictionary];
              for (NSDictionary *o in oxyArr) {
                NSString *t = o[@"Time"] ?: @"";
                if (t.length < 5) continue;
                NSInteger mm = [[t componentsSeparatedByString:@":"][1] integerValue];
                NSString *bk = [NSString stringWithFormat:@"%@:%02ld", [t substringToIndex:2], (long)(mm/5*5)];
                NSNumber *hv = o[@"HeartValue"];
                NSNumber *ox = o[@"OxygenValue"];
                NSNumber *tp = o[@"Temp1"];
                NSNumber *sp = o[@"StepValue"];
                if (!hrB[bk]) hrB[bk] = [NSMutableArray array];
                if (!o2B[bk]) o2B[bk] = [NSMutableArray array];
                if (!tpB[bk]) tpB[bk] = [NSMutableArray array];
                if (!spB[bk]) spB[bk] = [NSMutableArray array];
                if (hv.doubleValue > 0) [hrB[bk] addObject:hv];
                if (ox.doubleValue > 0) [o2B[bk] addObject:ox];
                if (tp.doubleValue > 30 && tp.doubleValue < 42) [tpB[bk] addObject:tp];
                if (sp.doubleValue > 0) [spB[bk] addObject:sp];
              }
              for (NSString *bk in hrB) {
                NSMutableDictionary *slot = slotIdx[bk];
                if (!slot) continue;
                if (!slot[@"hr"]) { double s=0;int c=0; for(NSNumber*n in hrB[bk]){s+=n.doubleValue;c++;} if(c>0) slot[@"hr"]=@(s/c); }
                if (!slot[@"spo2"]) { double s=0;int c=0; for(NSNumber*n in o2B[bk]){s+=n.doubleValue;c++;} if(c>0) slot[@"spo2"]=@(s/c); }
                if (!slot[@"temp"]) { double s=0;int c=0; for(NSNumber*n in tpB[bk]){s+=n.doubleValue;c++;} if(c>0) slot[@"temp"]=@(s/c); }
                if (!slot[@"step"]) { long long ss=0; for(NSNumber*n in spB[bk]) ss+=n.longLongValue; slot[@"step"]=@(ss); }
              }
            }
            // ★ heart_table: 30min 桶 heartValue（全天覆盖！oxygen 表只有 147 条 HR，heart_table 有 32 个桶！）
            if (heartHalfHour.count > 0) {
              NSInteger mergedCount = 0;
              for (NSString *bucket in heartHalfHour) {
                NSMutableDictionary *slot = slotIdx[bucket];
                if (!slot) continue;  // 5min slot 可能不存在（这个 30min 时间点没有 original 数据）
                NSDictionary *hv = heartHalfHour[bucket];
                NSInteger hvVal = [hv[@"heartValue"] integerValue];
                if (hvVal > 0) {
                  if (!slot[@"hr"] || [slot[@"hr"] integerValue] == 0) {
                    slot[@"hr"] = @(hvVal);
                    mergedCount++;
                  }
                }
              }
              [self emitLog:[NSString stringWithFormat:@"[Backfill merge] heartHalfHour=%lu buckets, merged=%ld, keys=%@", (unsigned long)heartHalfHour.count, (long)mergedCount, [[heartHalfHour allKeys] sortedArrayUsingSelector:@selector(compare:)] ?: @""]];
            }

            if (hrvArr.count > 0) {
              NSMutableDictionary *hB = [NSMutableDictionary dictionary];
              for (NSDictionary *h in hrvArr) {
                NSString *t = h[@"time"] ?: @"";
                if (t.length < 5) continue;
                NSInteger mm = [[t componentsSeparatedByString:@":"][1] integerValue];
                NSString *bk = [NSString stringWithFormat:@"%@:%02ld", [t substringToIndex:2], (long)(mm/5*5)];
                NSNumber *hv = h[@"hrvValue"];
                if (!hB[bk]) hB[bk] = [NSMutableArray array];
                if (hv.doubleValue > 0 && hv.doubleValue < 200) [hB[bk] addObject:hv];
              }
              for (NSString *bk in hB) {
                NSMutableDictionary *slot = slotIdx[bk];
                if (slot && !slot[@"hrv"]) { double s=0;int c=0; for(NSNumber*n in hB[bk]){s+=n.doubleValue;c++;} if(c>0) slot[@"hrv"]=@(s/c); }
              }
            }
            if (tempArr.count > 0) {
              for (NSDictionary *t in tempArr) {
                NSNumber *hh = t[@"hour"], *mm = t[@"minute"], *vv = t[@"value"];
                if (!hh || !mm || !vv) continue;
                if (vv.doubleValue <= 30 || vv.doubleValue >= 42) continue;
                NSString *bk = [NSString stringWithFormat:@"%02ld:%02ld", (long)hh.integerValue, (long)mm.integerValue];
                NSMutableDictionary *slot = slotIdx[bk];
                if (slot && !slot[@"temp"]) slot[@"temp"] = vv;
              }
            }

            NSArray *glucArr = [VPDataBaseOperation veepooSDKGetDeviceBloodGlucoseDataWithDate:dateStr andTableID:mac];
            if (glucArr.count > 0) {
              NSInteger mergedG = 0;
              for (NSDictionary *g in glucArr) {
                NSString *t = g[@"time"] ?: @"";
                if (t.length < 5) continue;
                NSArray *glucs = g[@"bloodGlucoses"];
                if (![glucs isKindOfClass:[NSArray class]] || glucs.count == 0) continue;
                NSMutableArray *validVals = [NSMutableArray array];
                for (NSString *s in glucs) { double v = s.doubleValue; if (v > 0) [validVals addObject:@(v)]; }
                if (validVals.count == 0) continue;
                double sum = 0; for (NSNumber *n in validVals) sum += n.doubleValue;
                double avg = sum / validVals.count;
                NSInteger mm = [[t componentsSeparatedByString:@":"][1] integerValue];
                NSString *bk = [NSString stringWithFormat:@"%@:%02ld", [t substringToIndex:2], (long)(mm/5*5)];
                NSMutableDictionary *slot = slotIdx[bk];
                if (slot && !slot[@"glucose"]) { slot[@"glucose"] = @(round(avg * 100) / 100.0); mergedG++; }
              }
              [self emitLog:[NSString stringWithFormat:@"[Backfill merge] glucose=%ld merged=%ld", (long)glucArr.count, (long)mergedG]];
            }

            if (slots.count > 0) {
                NSInteger cHr=0,cO2=0,cTp=0,cHrv=0,cG=0;
                for (NSMutableDictionary *s in slots) {
                    if ([s[@"hr"] integerValue]>0) cHr++;
                    if ([s[@"spo2"] integerValue]>0) cO2++;
                    if ([s[@"temp"] doubleValue]>30) cTp++;
                    if ([s[@"hrv"] integerValue]>0) cHrv++;
                    if ([s[@"glucose"] doubleValue]>0) cG++;
                }
                NSLog(@"[VEEPOO_MARKER] BACKFILL counts hr=%ld spo2=%ld temp=%ld hrv=%ld glucose=%ld keys=%@",
                      (long)cHr,(long)cO2,(long)cTp,(long)cHrv,(long)cG,
                      [[slots[0] allKeys] componentsJoinedByString:@","]);
            }
          }
          // ★ 调试：把 slots 写到 Documents/backfill_debug.json
          @try {
            NSMutableArray *debugSlots = [NSMutableArray array];
            NSInteger cHr=0,cO2=0,cTp=0,cHrv=0,cG=0;
            for (NSMutableDictionary *s in slots) {
                NSMutableDictionary *d = [NSMutableDictionary dictionary];
                for (NSString *k in s) d[k] = s[k] ?: [NSNull null];
                [debugSlots addObject:d];
                if ([s[@"hr"] doubleValue] > 0) cHr++;
                if ([s[@"spo2"] doubleValue] > 0) cO2++;
                if ([s[@"temp"] doubleValue] > 30) cTp++;
                if ([s[@"hrv"] doubleValue] > 0) cHrv++;
                if ([s[@"glucose"] doubleValue] > 0) cG++;
            }
            NSDictionary *debug = @{@"date": dateStr, @"slots": debugSlots,
                @"counts": @{@"hr": @(cHr), @"spo2": @(cO2), @"temp": @(cTp), @"hrv": @(cHrv), @"glucose": @(cG)}};
            NSData *d = [NSJSONSerialization dataWithJSONObject:debug options:NSJSONWritingPrettyPrinted error:nil];
            NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
            [d writeToFile:[docs stringByAppendingPathComponent:@"backfill_debug.json"] atomically:YES];
            // ★ 9/17 专属
            if ([dateStr containsString:@"09-17"]) {
                NSDictionary *d17 = @{@"date": dateStr, @"slots": debugSlots,
                    @"slotStats": @{@"total": @(slots.count), @"hr": @(cHr), @"spo2": @(cO2), @"temp": @(cTp), @"hrv": @(cHrv), @"glucose": @(cG)}};
                NSData *d17data = [NSJSONSerialization dataWithJSONObject:d17 options:NSJSONWritingPrettyPrinted error:nil];
                [d17data writeToFile:[docs stringByAppendingPathComponent:@"backfill_917.json"] atomically:YES];
                NSLog(@"[DEBUG 9/17] total=%lu hr=%ld spo2=%ld temp=%ld hrv=%ld gluc=%ld",
                    (unsigned long)slots.count, (long)cHr, (long)cO2, (long)cTp, (long)cHrv, (long)cG);
            }
          } @catch (NSException *e) { NSLog(@"[DEBUG write] %@", e); }

        }
      }

      // 2) 睡眠
      NSArray *sleepArr = [VPDataBaseOperation veepooSDKGetAccurateSleepDataWithDate:dateStr andTableID:mac];
      if (!sleepArr || sleepArr.count == 0) {
        sleepArr = [VPDataBaseOperation veepooSDKGetSleepDataWithDate:dateStr andTableID:mac];
      }
      // ★ 诊断：把 SDK 返回的睡眠记录完整打出来
      // ⚠️ 2026-09-18 崩溃修复（务必保留此类型判断）：
      //    veepooSDKGetAccurateSleepDataWithDate: 返回的是 VPAccurateSleepModel 对象数组，
      //    **不是 NSDictionary**。旧代码写 `NSDictionary *sFirst = sleepArr[0]; [sFirst allKeys]`
      //    → "-[VPAccurateSleepModel allKeys]: unrecognized selector sent to instance" → SIGABRT。
      //    更致命的是它位于回填主循环 dn=0（今天有昨夜睡眠记录）→ 第一天就崩 →
      //    backfillDone 永不 emit → 全部天数（含今天）离线数据都回不来。
      //    日志绝不能因类型假设而弄崩回填：这里先判类型再用 @try 兜底。
      if (sleepArr && sleepArr.count > 0) {
        id sFirst = sleepArr.firstObject;
        NSString *keysStr = @"-";
        @try {
          if ([sFirst isKindOfClass:[NSDictionary class]]) {
            keysStr = [[(NSDictionary *)sFirst allKeys] componentsJoinedByString:@","];
          } else {
            keysStr = [NSString stringWithFormat:@"<%@>", NSStringFromClass([sFirst class])];
          }
        } @catch (NSException *e) { keysStr = @"<err>"; }
        MRForward(@"SLEEP-RAW", @"date=%@ count=%lu keys=%@ first=%@", dateStr, (unsigned long)sleepArr.count, keysStr, sFirst);
      } else {
        MRForward(@"SLEEP-RAW", @"date=%@ count=0 (SDK 无记录)", dateStr);
      }

      // 该日既无原始 5min slot 也无睡眠记录 → 整日无 flash 数据，跳过后续查询（窗口放宽到 30 天后可避免对空日反复打 SDK）
      if ((!original || original.count == 0) && (!sleepArr || sleepArr.count == 0)) {
        continue;
      }

      [VPDataBaseOperation veepooSDKGetStepDataWithDate:dateStr andTableID:mac changeUserStature:165 result:^(NSDictionary *stepDict) {
        MRForward(@"BATCH-TIME", @"stepData callback date=%@ wall=%.3fs (serial queue wall-clock)", dateStr, CFAbsoluteTimeGetCurrent() - tStart);
        NSMutableDictionary *dayData = [NSMutableDictionary dictionary];
        dayData[@"date"] = dateStr;
        dayData[@"slots"] = slots; // ★ 关键修复：把已填充的 5min slots 塞进 dayData，否则 JS path A 收到空数组
        dayData[@"step"] = stepDict[@"Step"] ?: @0;
        dayData[@"dist"] = stepDict[@"Dis"] ?: @0;
        dayData[@"cal"] = stepDict[@"Cal"] ?: @0;

        // 4) 血压
        NSArray *bpArr = [VPDataBaseOperation veepooSDKGetBloodDataWithDate:dateStr andTableID:mac];
        if (bpArr && bpArr.count > 0) {
          dayData[@"bpSys"] = @([bpArr.lastObject[@"systolic"] doubleValue]);
          dayData[@"bpDia"] = @([bpArr.lastObject[@"diastolic"] doubleValue]);
        }

        // 5) 血氧
        NSArray *oxyArr = [VPDataBaseOperation veepooSDKGetDeviceOxygenDataWithDate:dateStr andTableID:mac];
        if (oxyArr && oxyArr.count > 0) {
          // 算平均
          double sum = 0; int cnt = 0;
          for (NSDictionary *o in oxyArr) {
            NSNumber *v = o[@"OxygenValue"];
            if (v && [v doubleValue] > 0) { sum += [v doubleValue]; cnt++; }
          }
          if (cnt > 0) dayData[@"spo2"] = @(sum / cnt);
        }

        // 6) HRV
        NSArray *hrvArr = [VPDataBaseOperation veepooSDKGetDeviceHrvDataWithDate:dateStr andTableID:mac];
        if (hrvArr && hrvArr.count > 0) {
          double sum = 0; int cnt = 0;
          for (NSDictionary *h in hrvArr) {
            NSNumber *v = h[@"hrvValue"];
            if (v && [v doubleValue] > 0 && [v doubleValue] < 200) { sum += [v doubleValue]; cnt++; }
          }
          if (cnt > 0) dayData[@"hrv"] = @(sum / cnt);
        }

        // 7) 体温
        NSArray *tempArr = [VPDataBaseOperation veepooSDKGetDeviceTemperatureDataWithDate:dateStr andTableID:mac];
        if (tempArr && tempArr.count > 0) {
          double sum = 0; int cnt = 0;
          for (NSDictionary *t in tempArr) {
            NSNumber *v = t[@"value"];
            if (v && [v doubleValue] > 30 && [v doubleValue] < 42) { sum += [v doubleValue]; cnt++; }
          }
          if (cnt > 0) dayData[@"temp"] = @(sum / cnt);
        }

        // 睡眠也放进来
        // ★★ 根因修复：SDK veepooSDKGetAccurateSleepDataWithDate 返回 VPAccurateSleepModel*
        //     不是 NSDictionary！旧代码 isKindOfClass:[NSDictionary class] 永远是 NO → 整块跳过！
        if (sleepArr && sleepArr.count > 0) {
          id s0 = sleepArr[0];
          // ── 分支 A：精准睡眠模型（VPAccurateSleepModel）───
          if ([s0 isKindOfClass:[VPAccurateSleepModel class]]) {
            VPAccurateSleepModel *m = (VPAccurateSleepModel *)s0;
            double deepMin = [m.deepDuration doubleValue];
            double lightMin = [m.lightDuration doubleValue];
            double insomniaMin = [m.insomniaDuration doubleValue];
            double totalMin = [m.sleepDuration doubleValue];
            if (totalMin <= 0) totalMin = deepMin + lightMin + insomniaMin;
            if (totalMin <= 0) totalMin = deepMin + lightMin;
            if (totalMin > 0) {
              dayData[@"sleepTotalMin"] = @(totalMin);
              dayData[@"sleepDeepMin"] = @(deepMin);
              dayData[@"sleepLightMin"] = @(lightMin);
              dayData[@"sleepInsomniaMin"] = @(insomniaMin);
              dayData[@"sleepScore"] = m.sleepQuality ?: @0;
              if (m.sleepTime.length > 0) dayData[@"sleepTime"] = m.sleepTime;
              if (m.wakeTime.length > 0) dayData[@"wakeTime"] = m.wakeTime;
              if (m.sleepLine.length > 0) dayData[@"sleepLine"] = m.sleepLine;
              MRForward(@"SLEEP-PARSE", @"✅ VPAccurateSleepModel total=%.0f deep=%.0f light=%.0f insomnia=%.0f score=%@ time=%@ wake=%@",
                        totalMin, deepMin, lightMin, insomniaMin, m.sleepQuality, m.sleepTime, m.wakeTime);
            } else {
              MRForward(@"SLEEP-PARSE", @"⚠️ VPAccurateSleepModel totalMin=0，原始值 sleepDuration=%@ deepDuration=%@ lightDuration=%@ insomniaDuration=%@",
                        m.sleepDuration, m.deepDuration, m.lightDuration, m.insomniaDuration);
            }
          }
          // ── 分支 B：旧式字典返回（veepooSDKGetSleepDataWithDate fallback）───
          else if ([s0 isKindOfClass:[NSDictionary class]]) {
            NSDictionary *d = (NSDictionary *)s0;
            double deepMin = [d[@"deepDuration"] doubleValue];
            if (deepMin <= 0) deepMin = [d[@"DEEP_HOUR"] doubleValue] * 60;
            double lightMin = [d[@"lightDuration"] doubleValue];
            if (lightMin <= 0) lightMin = [d[@"LIGHT_HOUR"] doubleValue] * 60;
            double insomniaMin = [d[@"insomniaDuration"] doubleValue];
            double totalMin = [d[@"sleepDuration"] doubleValue];
            if (totalMin <= 0) totalMin = deepMin + lightMin + insomniaMin;
            if (totalMin <= 0) totalMin = deepMin + lightMin;
            if (totalMin > 0) {
              dayData[@"sleepTotalMin"] = @(totalMin);
              dayData[@"sleepDeepMin"] = @(deepMin);
              dayData[@"sleepLightMin"] = @(lightMin);
              dayData[@"sleepInsomniaMin"] = @(insomniaMin);
              id sc = d[@"sleepQuality"] ?: d[@"SLEEP_LEVEL"];
              dayData[@"sleepScore"] = sc ?: @0;
              if (d[@"sleepTime"]) dayData[@"sleepTime"] = d[@"sleepTime"];
              if (d[@"wakeTime"]) dayData[@"wakeTime"] = d[@"wakeTime"];
              if (d[@"sleepLine"]) dayData[@"sleepLine"] = d[@"sleepLine"];
              MRForward(@"SLEEP-PARSE", @"✅ NSDictionary total=%.0f deep=%.0f light=%.0f", totalMin, deepMin, lightMin);
            }
          } else {
            MRForward(@"SLEEP-PARSE", @"❌ 未知睡眠类型: %@", NSStringFromClass([s0 class]));
          }
        }

        // 仅在有真实数据时回灌，避免空日覆盖实时/已有数据（窗口放宽到 30 天后尤需此保护）
        BOOL hasBackfillData = ([dayData[@"step"] doubleValue] > 0)
                            || (dayData[@"spo2"] != nil)
                            || (dayData[@"hrv"] != nil)
                            || (dayData[@"temp"] != nil)
                            || (dayData[@"bpSys"] != nil)
                            || (dayData[@"sleepTotalMin"] != nil);
        if (hasBackfillData) {
          // ★ V2.1 merge HealthGlance（cortisol/sns/emotion/skin/fatigue）
          if (hgArr.count > 0) {
            NSMutableArray *slots = dayData[@"slots"];
            NSMutableDictionary *dateSlots = [NSMutableDictionary dictionary]; // time(string) -> slot dict
            for (NSMutableDictionary *slot in slots) {
              NSString *t = slot[@"time"] ?: slot[@"t"] ?: @"";
              if (t.length > 0) dateSlots[t] = slot;
            }
            int hgCortisolCount = 0, hgSnsCount = 0, hgEmoCount = 0, hgSkinCount = 0, hgFatCount = 0;
            NSTimeInterval dayStart = [[_df dateFromString:dayData[@"date"]] timeIntervalSince1970];
            NSTimeInterval dayEnd = dayStart + 86400;
            for (VPManualHealthGlanceModel *hg in hgArr) {
              NSTimeInterval ts = hg.timestamp;
              if (ts < dayStart || ts >= dayEnd) continue;
              // HealthGlance 不是 5min slot，是精确测量时间。转 HH:MM:SS 取分钟对齐到 5min
              NSDate *hgDate = [NSDate dateWithTimeIntervalSince1970:ts];
              NSDateComponents *comp = [_cal components:(NSCalendarUnitHour|NSCalendarUnitMinute) fromDate:hgDate];
              NSInteger h = comp.hour;
              NSInteger m = comp.minute;
              NSInteger slotMin = (m / 5) * 5; // 对齐到 0,5,10,...55
              NSString *slotTime = [NSString stringWithFormat:@"%02ld:%02ld", (long)h, (long)slotMin];
              NSMutableDictionary *target = dateSlots[slotTime];
              if (!target) {
                target = [NSMutableDictionary dictionary];
                target[@"time"] = slotTime;
                dateSlots[slotTime] = target;
              }
              // ★ 只在 slot 没值时填入（基础 table 的 5min avg 优先）
              if (!target[@"cortisol"] && hg.cortisolValue > 0) { target[@"cortisol"] = @(hg.cortisolValue); hgCortisolCount++; }
              if (!target[@"sns"] && hg.snsActivation > 0)      { target[@"sns"] = @(hg.snsActivation);       hgSnsCount++; }
              if (!target[@"emotion"] && hg.emotionLevel != 0)  { target[@"emotion"] = @(hg.emotionLevel);     hgEmoCount++; }
              if (!target[@"skin"] && hg.skinMoisture > 0)      { target[@"skin"] = @(hg.skinMoisture);        hgSkinCount++; }
              if (!target[@"fatigue"] && hg.fatigueLevel > 0)   { target[@"fatigue"] = @(hg.fatigueLevel);     hgFatCount++; }
              // ★ 血液成分（HealthGlance 里的血脂+尿酸）
              if (!target[@"cholesterol"] && hg.totalCholesterol > 0)          target[@"cholesterol"] = @(hg.totalCholesterol);
              if (!target[@"triglyceride"] && hg.triglyceride > 0)             target[@"triglyceride"] = @(hg.triglyceride);
              if (!target[@"hdl"] && hg.highDensityLipoprotein > 0)            target[@"hdl"] = @(hg.highDensityLipoprotein);
              if (!target[@"ldl"] && hg.lowDensityLipoprotein > 0)             target[@"ldl"] = @(hg.lowDensityLipoprotein);
              if (!target[@"ua"] && hg.uricAcid > 0)                           target[@"ua"] = @(hg.uricAcid);
              // stress/fatigue/met 如果基础 table 没有，也用 HealthGlance 值（HealthGlance 的 stress 更准，是实时测的）
              if (!target[@"stress"] && hg.stress > 0)           target[@"stress"] = @(hg.stress);
              if (!target[@"hrv"] && hg.hrv > 0)                 target[@"hrv"] = @(hg.hrv);
              if (!target[@"bpSys"] && hg.h_bp > 0)              target[@"bpSys"] = @(hg.h_bp);
              if (!target[@"bpDia"] && hg.l_bp > 0)              target[@"bpDia"] = @(hg.l_bp);
              if (!target[@"glucose"] && hg.bloodSugar > 0)      target[@"glucose"] = @(hg.bloodSugar);
            }
            // ★ V2.1b: bloodCompArr 单独 merge（VPManualBloodCompModel 有独立 timestamp）
            if (bcArr.count > 0) {
              int bcCholCount = 0, bcTrigCount = 0, bcHdlCount = 0, bcLdlCount = 0, bcUaCount = 0;
              NSTimeInterval dayStart2 = [[_df dateFromString:dayData[@"date"]] timeIntervalSince1970];
              NSTimeInterval dayEnd2 = dayStart2 + 86400;
              for (id bcModel in bcArr) {
                if (![bcModel respondsToSelector:@selector(timestamp)]) continue;
                NSNumber *tsN = [bcModel valueForKey:@"timestamp"]; NSTimeInterval ts = tsN ? (NSTimeInterval)tsN.unsignedLongLongValue : 0;
                if (ts < dayStart2 || ts >= dayEnd2) continue;
                NSDate *bcDate = [NSDate dateWithTimeIntervalSince1970:ts];
                NSDateComponents *comp = [_cal components:(NSCalendarUnitHour|NSCalendarUnitMinute) fromDate:bcDate];
                NSInteger slotMin = ((int)comp.minute / 5) * 5;
                NSString *slotTime = [NSString stringWithFormat:@"%02ld:%02ld", (long)comp.hour, (long)slotMin];
                NSMutableDictionary *target = dateSlots[slotTime];
                if (!target) { target = [NSMutableDictionary dictionary]; target[@"time"] = slotTime; dateSlots[slotTime] = target; }
                NSNumber *chol = [bcModel valueForKey:@"totalCholesterol"];
                NSNumber *trig = [bcModel valueForKey:@"triglyceride"];
                NSNumber *hdl2 = [bcModel valueForKey:@"highDensityLipoprotein"];
                NSNumber *ldl2 = [bcModel valueForKey:@"lowDensityLipoprotein"];
                NSNumber *ua2 = [bcModel valueForKey:@"uricAcid"];
                if (!target[@"cholesterol"] && chol && chol.doubleValue > 0) { target[@"cholesterol"] = chol; bcCholCount++; }
                if (!target[@"triglyceride"] && trig && trig.doubleValue > 0) { target[@"triglyceride"] = trig; bcTrigCount++; }
                if (!target[@"hdl"] && hdl2 && hdl2.doubleValue > 0)         { target[@"hdl"] = hdl2; bcHdlCount++; }
                if (!target[@"ldl"] && ldl2 && ldl2.doubleValue > 0)         { target[@"ldl"] = ldl2; bcLdlCount++; }
                if (!target[@"ua"] && ua2 && ua2.doubleValue > 0)             { target[@"ua"] = ua2; bcUaCount++; }
              }
              if (bcCholCount + bcTrigCount + bcHdlCount + bcLdlCount + bcUaCount > 0) {
                [self emitLog:[NSString stringWithFormat:@"[Backfill] ✅ BC merge dk=%@ chol=%d trig=%d hdl=%d ldl=%d ua=%d",
                  dayData[@"date"], bcCholCount, bcTrigCount, bcHdlCount, bcLdlCount, bcUaCount]];
              }
            }
            // 把 dateSlots 重新排好序的数组写回 dayData[@"slots"]
            NSArray *allKeys = [[dateSlots allKeys] sortedArrayUsingSelector:@selector(compare:)];
            NSMutableArray *merged = [NSMutableArray array];
            for (NSString *k in allKeys) [merged addObject:dateSlots[k]];
            dayData[@"slots"] = merged;
            if (hgCortisolCount + hgSnsCount + hgEmoCount + hgSkinCount + hgFatCount > 0) {
              [self emitLog:[NSString stringWithFormat:@"[Backfill] ✅ HG merge dk=%@ cortisol=%d sns=%d emotion=%d skin=%d fatigue=%d",
                dayData[@"date"], hgCortisolCount, hgSnsCount, hgEmoCount, hgSkinCount, hgFatCount]];
            }
          }
          emittedCount++;
          MRForward(@"BATCH-TIME", @"✅ emit onBatch date=%@ seq=%d wall=%.3fs dayCost=%.3fs", dayData[@"date"] ?: @"", emittedCount, CFAbsoluteTimeGetCurrent() - tStart, CFAbsoluteTimeGetCurrent() - tDayStart);
          [self emit:@"onBatch" body:@{@"date": dayData[@"date"] ?: @"", @"daily": dayData}];
        }
      }];
      } @catch (NSException *e) {
        [self emitLog:[NSString stringWithFormat:@"[Backfill] ⚠️ 单日处理异常，已跳过该日继续: %@ / %@", e.name, e.reason ?: @""]];
      }
    }

    // 最后 emit complete（直接在 serial queue 里调，emit 内部 async 回 main queue）
    MRForward(@"BATCH-TIME", @"🏁 backfillDone wall=%.3fs days=%d (ManualTestData已包含)", CFAbsoluteTimeGetCurrent() - tStart, emittedCount);
    [self emit:@"onState" body:@{@"status": @"connected", @"progress": @1.0, @"backfillDone": @YES, @"days": @(BACKFILL_DAYS), @"fromDate": fromDateStr ?: @""}];
    [self emitLog:[NSString stringWithFormat:@"[Backfill] ✅ 完成 %d 天（serial queue）", BACKFILL_DAYS]];
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

            // ★ 协议补齐：VPHealthGlanceTestModel 还有 cortisol/sns/emotion/skin/fatigue/bloodComp
            if (model.cortisolValue > 0)                    [sself2 emitMetric:@"cortisol" value:(double)model.cortisolValue unit:@"ug/L"];
            if (model.snsActivation > 0)                    [sself2 emitMetric:@"sns" value:(double)model.snsActivation unit:@""];
            if (model.emotionLevel != 0)                    [sself2 emitMetric:@"emotion" value:(double)model.emotionLevel unit:@""];
            if (model.skinMoisture > 0)                     [sself2 emitMetric:@"skin" value:(double)model.skinMoisture unit:@""];
            if (model.fatigueLevel > 0)                     [sself2 emitMetric:@"fatigue" value:(double)model.fatigueLevel unit:@""];
            if (model.hrv > 0)                            [sself2 emitMetric:@"hrv" value:(double)model.hrv unit:@"ms"];
            if (model.stress > 0)                          [sself2 emitMetric:@"stress" value:(double)model.stress unit:@""];
            if (model.bloodSugar > 0)                      [sself2 emitMetric:@"glucose" value:model.bloodSugar unit:@"mmol/L"];
            if (model.systolicBloodPressure > 0)           [sself2 emitMetric:@"bpSys" value:(double)model.systolicBloodPressure unit:@"mmHg"];
            if (model.diastolicBloodPressure > 0)          [sself2 emitMetric:@"bpDia" value:(double)model.diastolicBloodPressure unit:@"mmHg"];
            if (model.depressionRisk >= 0)                 [sself2 emitMetric:@"depression" value:(double)model.depressionRisk unit:@""];
            // 血液成分（protocol==2 才有，需 getFuncSupport:VPHealthGlanceTypeBloodComp）
            if ((model.functionSupport & VPHealthGlanceTypeBloodComp) != 0) {
              if (model.totalCholesterol > 0)           [sself2 emitMetric:@"cholesterol" value:model.totalCholesterol unit:@"mmol/L"];
              if (model.triglyceride > 0)               [sself2 emitMetric:@"triglyceride" value:model.triglyceride unit:@"mmol/L"];
              if (model.highDensityLipoprotein > 0)     [sself2 emitMetric:@"hdl" value:model.highDensityLipoprotein unit:@"mmol/L"];
              if (model.lowDensityLipoprotein > 0)      [sself2 emitMetric:@"ldl" value:model.lowDensityLipoprotein unit:@"mmol/L"];
              if (model.uricAcid > 0)                   [sself2 emitMetric:@"ua" value:model.uricAcid unit:@"umol/L"];
            }
            MRForward(@"NATIVE", @"[VeepooRing CB healthGlance] ✅ hrv=%.0f stress=%.0f glu=%.1f bp=%.0f/%.0f cort=%.0f sns=%.0f emo=%.1f skin=%.0f fatigue=%.0f chol=%.1f trig=%.1f hdl=%.1f ldl=%.1f ua=%.1f funcSupport=0x%lx",
                      (double)model.hrv, (double)model.stress, model.bloodSugar, (double)model.systolicBloodPressure, (double)model.diastolicBloodPressure, (double)model.cortisolValue, (double)model.snsActivation, (double)model.emotionLevel,
                      (double)model.skinMoisture, (double)model.fatigueLevel,
                      model.totalCholesterol, model.triglyceride, model.highDensityLipoprotein, model.lowDensityLipoprotein, model.uricAcid,
                      (unsigned long)model.functionSupport);
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
            
            // ★ 协议补齐：VPGSRResultModel 所有字段 snake_case（SDK 原库命名）
            // skin_moisture → eda（皮肤含水量，[1,99]）
            // sns_activation → sns（交感神经活跃度，[1,99]）
            // cortisol_value → cortisol（皮质醇浓度，[0,500]ug/L）
            // emotin_level → emotion（情绪，[-10,10]）
            // depression_risk → depression（抑郁症风险，[0,2]）
            [sself2 emitMetric:@"eda" value:(double)model.skin_moisture unit:@""];
            if (model.cortisol_value > 0)                   [sself2 emitMetric:@"cortisol" value:(double)model.cortisol_value unit:@"ug/L"];
            if (model.sns_activation > 0)                   [sself2 emitMetric:@"sns" value:(double)model.sns_activation unit:@""];
            if (model.emotin_level != 0)                     [sself2 emitMetric:@"emotion" value:(double)model.emotin_level unit:@""];
            if (model.depression_risk >= 0)                   [sself2 emitMetric:@"depression" value:(double)model.depression_risk unit:@""];
            MRForward(@"NATIVE", @"[VeepooRing CB gsr] ✅ eda=%.0f cortisol=%.0f sns=%.0f emotion=%.1f depression=%.0f",
                      (double)model.skin_moisture, (double)model.cortisol_value, (double)model.sns_activation,
                      (double)model.emotin_level, (double)model.depression_risk);
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
      self.deviceTotalDays = totalDay;
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
