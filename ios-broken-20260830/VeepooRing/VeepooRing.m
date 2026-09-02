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
// All SDK callback `state` parameters use the SDK's own enum types (verified against the
// real VeepooBleSDK.framework headers shipped in MiraRingProbe). Connection state values:
//   VPDeviceConnectState: 0 disconn, 1 connecting, 2 connect, 3 pwdSuccess, 4 pwdFail, 6 timeout, 7 confirmTimeout
// Read-state "complete" = VPReadDeviceBaseDataStateComplete = 2.

@interface VeepooRing ()
@property (nonatomic, strong) NSMutableArray<VPPeripheralModel *> *discovered;
@property (nonatomic, strong) VPPeripheralModel *connectedModel;
@property (nonatomic, assign) BOOL hasSetup;
@property (nonatomic, assign) BOOL listening;
@property (nonatomic, assign) BOOL autoMonitor;
@property (nonatomic, assign) BOOL hrRunning;
@property (nonatomic, assign) BOOL oxyRunning;
@property (nonatomic, strong) NSTimer *autoTimer;
@end

@implementation VeepooRing

RCT_EXPORT_MODULE(VeepooRing)

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onStateChange", @"onMetric", @"onLog"];
}

- (void)startObserving { self.listening = YES; }
- (void)stopObserving { self.listening = NO; }
- (BOOL)requiresMainQueueSetup { return NO; }

#pragma mark - helpers

- (VPBleCentralManage *)manager { return [VPBleCentralManage sharedBleManager]; }
- (VPPeripheralBaseManage *)peripheral { return [VPBleCentralManage sharedBleManager].peripheralManage; }

- (void)emit:(NSString *)name body:(id)body {
  if (!self.listening) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:name body:body];
  });
}

- (void)emitMetric:(NSString *)key value:(double)value unit:(NSString *)unit {
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

#pragma mark - setup

- (void)ensureSetup {
  if (self.hasSetup) return;
  self.hasSetup = YES;
  self.discovered = [NSMutableArray array];
  self.hrRunning = NO;
  self.oxyRunning = NO;

  VPBleCentralManage *m = self.manager;
  m.peripheralManage = [VPPeripheralManage shareVPPeripheralManager];
  m.isLogEnable = YES;
  m.rrisLimit = -100;  // relax RSSI filter so the ring is not dropped

  __weak typeof(self) wself = self;
  m.VPBleCentralManageChangeBlock = ^(VPCentralManagerState state) {
    // VPCentralManagerState: 0 unknown,1 resetting,2 unsupported,3 unauthorized,4 off,5 on
    NSString *bt = (state == VPCentralManagerStatePoweredOn) ? @"on"
                 : (state == VPCentralManagerStatePoweredOff) ? @"off" : @"unknown";
    [wself emit:@"onStateChange" body:@{@"bluetooth": bt}];
    if (state != VPCentralManagerStatePoweredOn) [wself emitLog:@"系统蓝牙未开启或未授权"];
  };
  m.VPBleConnectStateChangeBlock = ^(VPDeviceConnectState state) {
    [wself onConnectState:state];
  };
}

- (void)onConnectState:(VPDeviceConnectState)state {
  // VPDeviceConnectState: 0 disconn,1 connecting,2 connect,3 pwdSuccess,4 pwdFail,5(?),6 timeout,7 confirmTimeout
  if (state == VPDeviceConnectStateVerifyPasswordSuccess) {
    VPPeripheralModel *pm = self.manager.peripheralModel;
    NSString *fw = pm ? [NSString stringWithFormat:@"%@-%lu", pm.deviceVersion, (unsigned long)pm.deviceNumber] : nil;
    [self emitStatus:@"connected" deviceName:pm.deviceName address:pm.deviceAddress battery:nil firmware:fw];
    [self emitLog:@"密码验证成功，已连接"];
    [self onPasswordVerified];
  } else if (state == VPDeviceConnectStateDisConnect) {
    [self emitStatus:@"idle" deviceName:nil address:nil battery:nil firmware:nil];
  } else if (state == VPDeviceConnectStateConnecting) {
    [self emitStatus:@"connecting" deviceName:nil address:nil battery:nil firmware:nil];
  } else if (state == VPDeviceConnectStateVerifyPasswordFailure) {
    [self emitStatus:@"error" deviceName:nil address:nil battery:nil firmware:nil];
    [self emitError:@"密码验证失败"];
  } else if (state == VPDeviceConnectStateTimeout) {
    [self emitStatus:@"error" deviceName:nil address:nil battery:nil firmware:nil];
    [self emitError:@"连接超时（若自扫描连接，可能是 SDK 未扫到同一设备）"];
  }
}

- (void)onPasswordVerified {
  VPBleCentralManage *m = self.manager;
  // 1) 同步个人信息（参考 Demo：验证密码后第一步）
  [m.peripheralManage veepooSDKSynchronousPersonalInformationWithStature:165
                                                                   weight:55
                                                                     birth:1995
                                                                      sex:0
                                                                targetStep:10000
                                                                    result:^(NSUInteger r) {}];
  // 2) 读电量
  [m.peripheralManage veepooSDKReadDeviceBatteryAndChargeInfo:^(BOOL isPercent, VPDeviceChargeState chargeState, BOOL percenTypeIsLowBat, NSUInteger battery) {
    [self emitStatus:nil deviceName:nil address:nil battery:@(battery) firmware:nil];
  }];
  // 3) 链式读自动数据→血氧→历史HRV（初始化算法模块，参考 RingManager）
  [m.peripheralManage veepooSdkStartReadDeviceAllDataWithReadStateChangeBlock:^(VPReadDeviceBaseDataState state, NSUInteger totalDay, NSUInteger currentReadDayNumber, NSUInteger readCurrentDayProgress) {
    if (state == VPReadDeviceBaseDataComplete) {
      [m.peripheralManage veepooSdkStartReadDeviceOxygenData:^(VPReadDeviceBaseDataState s2, NSUInteger t2, NSUInteger c2, NSUInteger p2) {
        if (s2 == VPReadDeviceBaseDataComplete) {
          [m.peripheralManage veepooSdkStartReadDeviceHrvData:^(VPReadDeviceBaseDataState s3, NSUInteger t3, NSUInteger c3, NSUInteger p3) {
            [self emitLog:@"历史HRV读取完成，算法模块已初始化"];
          }];
        }
      }];
    }
  }];
  // 4) 自动监测开启则启动实时心率/血氧
  if (self.autoMonitor) { [self startRealtimeHR]; [self startRealtimeOxygen]; }
}

#pragma mark - exported methods

RCT_EXPORT_METHOD(scan) {
  [self ensureSetup];
  [self.discovered removeAllObjects];
  [self emitDevices];
  [self.manager veepooSDKStartScanDeviceAndReceiveScanningDevice:^(VPPeripheralModel * _Nullable model) {
    if (!model) return;
    BOOL found = NO;
    for (VPPeripheralModel *p in self.discovered) {
      if ([p.deviceAddress isEqualToString:model.deviceAddress]) { found = YES; break; }
    }
    if (!found) {
      [self.discovered addObject:model];
      [self emitDevices];
      [self emitLog:[NSString stringWithFormat:@"发现设备: %@ / %@", model.deviceName, model.deviceAddress]];
    }
  }];
}

RCT_EXPORT_METHOD(stopScan) {
  [self.manager veepooSDKStopScanDevice];
}

RCT_EXPORT_METHOD(connect:(NSString *)address) {
  [self ensureSetup];
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
  [self emitStatus:@"connecting" deviceName:nil address:nil battery:nil firmware:nil];
  [self.manager veepooSDKConnectDevice:target deviceConnectBlock:^(VPDeviceConnectState connectState) {
    // handled mainly by VPBleConnectStateChangeBlock; nothing extra needed here
  }];
}

RCT_EXPORT_METHOD(disconnect) {
  [self stopAutoMonitor];
  [self.manager veepooSDKDisconnectDevice];
  self.connectedModel = nil;
  [self emitStatus:@"idle" deviceName:nil address:nil battery:nil firmware:nil];
}

RCT_EXPORT_METHOD(setAutoMonitor:(BOOL)on) {
  self.autoMonitor = on;
  if (on) {
    [self startRealtimeHR];
    [self startRealtimeOxygen];
    self.autoTimer = [NSTimer scheduledTimerWithTimeInterval:60.0
                                                      target:self
                                                    selector:@selector(autoTick)
                                                    userInfo:nil
                                                     repeats:YES];
  } else {
    [self stopAutoMonitor];
  }
}

- (void)stopAutoMonitor {
  if (self.autoTimer) { [self.autoTimer invalidate]; self.autoTimer = nil; }
  [self stopRealtimeHR];
  [self stopRealtimeOxygen];
}

- (void)autoTick {
  // periodically pull the single-shot metrics (temp / eda); hr & spo2 stream continuously
  [self triggerHealthGlance];
  [self performSelector:@selector(triggerGSR) withObject:nil afterDelay:30.0];
}

RCT_EXPORT_METHOD(measure:(NSString *)key) {
  if ([key isEqualToString:@"hr"]) {
    [self startRealtimeHR];
    [self performSelector:@selector(stopRealtimeHR) withObject:nil afterDelay:20.0];
  } else if ([key isEqualToString:@"spo2"]) {
    [self startRealtimeOxygen];
    [self performSelector:@selector(stopRealtimeOxygen) withObject:nil afterDelay:20.0];
  } else if ([key isEqualToString:@"rr"]) {
    [self triggerBreathing];
  } else if ([key isEqualToString:@"eda"]) {
    [self triggerGSR];
  } else if ([key isEqualToString:@"temp"]) {
    [self triggerHealthGlance];
  } else if ([key isEqualToString:@"hrv"]) {
    [self triggerHRV];
  } else {
    [self emitLog:[NSString stringWithFormat:@"未知测量项: %@", key]];
  }
}

RCT_EXPORT_METHOD(readBattery) {
  [self.manager.peripheralManage veepooSDKReadDeviceBatteryAndChargeInfo:^(BOOL isPercent, VPDeviceChargeState chargeState, BOOL percenTypeIsLowBat, NSUInteger battery) {
    [self emitStatus:nil deviceName:nil address:nil battery:@(battery) firmware:nil];
  }];
}

RCT_EXPORT_METHOD(findDevice) {
  // 官方 SDK 未在开放接口中暴露“让戒指响铃/震动”命令；
  // 退而求其次发送配对指令，部分固件会触发戒指响应。
  [self.manager veepooSDKSendPairedWithIphoneCommand];
  [self emitLog:@"已发送配对/查找指令（部分固件会让戒指震动或亮灯）"];
}

#pragma mark - realtime HR / SpO2

- (void)startRealtimeHR {
  if (self.hrRunning) return;
  self.hrRunning = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.peripheral veepooSDKTestHeartStart:YES testResult:^(VPTestHeartState testHeartState, NSUInteger heartValue) {
      if (heartValue > 0) [self emitMetric:@"hr" value:(double)heartValue unit:@"bpm"];
    }];
  });
}

- (void)stopRealtimeHR {
  if (!self.hrRunning) return;
  self.hrRunning = NO;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.peripheral veepooSDKTestHeartStart:NO testResult:^(VPTestHeartState s, NSUInteger v) {}];
  });
}

- (void)startRealtimeOxygen {
  if (self.oxyRunning) return;
  self.oxyRunning = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.peripheral veepooSDKTestOxygenStart:YES testResult:^(VPTestOxygenState testOxygenState, NSUInteger oxygenValue) {
      if (oxygenValue > 0) [self emitMetric:@"spo2" value:(double)oxygenValue unit:@"%"];
    }];
  });
}

- (void)stopRealtimeOxygen {
  if (!self.oxyRunning) return;
  self.oxyRunning = NO;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.peripheral veepooSDKTestOxygenStart:NO testResult:^(VPTestOxygenState s, NSUInteger v) {}];
  });
}

- (void)restartRealtimeIfNeededAfter:(NSTimeInterval)delay {
  if (!self.autoMonitor) return;
  [self performSelector:@selector(startRealtimeHR) withObject:nil afterDelay:delay];
  [self performSelector:@selector(startRealtimeOxygen) withObject:nil afterDelay:delay];
}

#pragma mark - single-shot metrics (need the optical sensor exclusively)

- (void)triggerHealthGlance {
  [self stopRealtimeHR];
  [self stopRealtimeOxygen];
  [self.peripheral veepooSDK_healthGlanceTestStart:YES
      andProgress:^(NSInteger progress) {}
      andResult:^(VPDeviceHealthGlanceState state, VPHealthGlanceTestModel * _Nullable model) {
        if (model) {
          if (model.bodyTemperature > 0) [self emitMetric:@"temp" value:model.bodyTemperature unit:@"℃"];
          if (model.bloodOxygen > 0)     [self emitMetric:@"spo2" value:(double)model.bloodOxygen unit:@"%"];
          if (model.heartRate > 0)      [self emitMetric:@"hr" value:(double)model.heartRate unit:@"bpm"];
        }
        [self restartRealtimeIfNeededAfter:25.0];
      }];
}

- (void)triggerGSR {
  [self stopRealtimeHR];
  [self stopRealtimeOxygen];
  [self.peripheral veepooSDKTestGSRStart:YES
      progress:^(NSProgress * _Nullable progress) {}
      testResult:^(VPDeviceGSRState state, VPGSRResultModel * _Nullable model) {
        if (model) {
          // 皮肤含水量作为 EDA 主指标；交感/皮质醇可在后续扩展
          [self emitMetric:@"eda" value:(double)model.skin_moisture unit:@""];
        }
        [self restartRealtimeIfNeededAfter:25.0];
      }];
}

- (void)triggerHRV {
  [self stopRealtimeHR];
  [self stopRealtimeOxygen];
  [self.peripheral veepooSDK_HRVTest:YES callBack:^(int con, VPTestHRVState ack, int hrvValue) {
    if (con == 1 && hrvValue > 0) [self emitMetric:@"hrv" value:(double)hrvValue unit:@""];
    [self restartRealtimeIfNeededAfter:30.0];
  }];
}

- (void)triggerBreathing {
  [self stopRealtimeHR];
  [self stopRealtimeOxygen];
  [self.peripheral veepooSDKTestBreathingRateStart:YES testResult:^(VPTestBreathingRateState state, NSUInteger breathingRateProgress, NSUInteger breathingRateValue) {
    if (breathingRateValue > 0) [self emitMetric:@"rr" value:(double)breathingRateValue unit:@"次/分"];
    [self restartRealtimeIfNeededAfter:20.0];
  }];
}

@end
