# 离线数据同步修复记录（2026-09-05）

## 用户反馈
- 睡眠详情页能看到 9/5 8h39m，但洞察页「睡眠和激素」只显示 7h12m / 结构 1h40m，入睡/起床为「—」。
- 心率/血氧洞察页 0–10 点（睡眠期间）无曲线。
- 要求：按 Veepoo SDK 协议重新排查离线数据同步。

## 根因分析

### 1. 洞察页睡眠不是最新日期
`RingBleManager.handleSleepDay` 把 `sleepSummary/sleepStages/sleepTime/wakeTime` 直接设为最后一次 `onSleepDay` 的数据。原生 `backfillRecentDays` 按 `dn=0（今天）、dn=1（昨天）、dn=2…` 顺序读取，导致最后被旧日期覆盖。洞察页因此显示的不是 9/5 最新睡眠。

### 2. 血氧/体温/HRV 只有日聚合，没有 intraday 样本
原生 `backfillRecentDays` 中：
- 血氧：`veepooSDKGetDeviceOxygenDataWithDate` 只取了平均值 emit `onSpo2Day`。
- 体温：`veepooSDKGetDeviceTemperatureDataWithDate` 只取了平均值 emit `onTempDay`。
- HRV：`veepooSDKGetDeviceHrvDataWithDate` 只取了平均值 emit `onHrvDay`。

这三个 API 都返回**逐时间点数组**（血氧 `Time+OxygenValue`、体温 `hour/minute/value`、HRV `time/hrvValue`），但代码只取了均值，所以趋势图 0–10 点没有曲线。

### 3. 心率 0–10 点缺失是协议正常行为
`veepooSDKGetOriginalDataWithDate` 返回半小时心率平均值，协议明确：睡眠期间 `heartValue` 常为 0，且文档要求过滤 0 bpm 不显示。因此心率曲线在睡眠期间为空。

补救方案：HRV 数据每分钟带 `hearts` 字符串数组（每个值×10 = RR 间期 ms），可反推心率 = 60000 / RR，用于填补睡眠期间心率曲线（0–7 点，因为协议说明 HRV hearts 主要用于 0–7 点）。

## 协议依据

全部来自本地 `VeepooBleSDK.framework/Headers`（与 `github.com/HBandSDK/iOS_Ble_SDK` 同版本）：

- `VPDataBaseOperation.h:51`：`+ (NSDictionary *)veepooSDKGetOriginalDataWithDate:andTableID:`，返回以时间为 key 的 dict，value 含 `heartValue/sportValue/stepValue/calValue/disValue`。
- `VPDataBaseOperation.h:236`：`+ (NSArray *)veepooSDKGetDeviceOxygenDataWithDate:andTableID:`，返回数组，每项含 `Time`（字符串）、`OxygenValue`。
- `VPDataBaseOperation.h:269`：`+ (NSArray *)veepooSDKGetDeviceTemperatureDataWithDate:andTableID:`，返回数组，每项含 `hour/minute/value`。
- `VPDataBaseOperation.h:252`：`+ (NSArray *)veepooSDKGetDeviceHrvDataWithDate:andTableID:`，返回数组，每项含 `time/hrvValue/hearts`。
- `VPAccurateSleepModel.h`：`sleepDuration/deepDuration/lightDuration/otherDuration/sleepTime/wakeTime/sleepLine` 等字段定义。

## 改动清单

### JS：`src/ble/RingBleManager.ts`
1. `RingState` 新增 `sleepSummaryDate: string | null`。
2. `handleSleepStages`：按今天日期做守卫，避免旧数据覆盖。
3. `handleSleepDay`：只在 `raw.date >= 当前 sleepSummaryDate` 时才更新 `sleepSummary/sleepStages/sleepTime/wakeTime`。
4. 新增安全函数 `sampleTimeMs(t, baseMs)`，支持 `"HH:mm"` 字符串或数字 ms，避免 iOS `new Date(string)` 解析失败。
5. `handleSpo2Samples` / `handleTempSamples` / `handleHrvSamples`：改用 `dateKeyOfStr` + `dateKeyToStartMs` + `sampleTimeMs`，兼容原生新格式。
6. `handleHrvSamples`：从 `hearts` 反推心率，upsert 到 `hr` intraday，补全睡眠期间心率曲线。

### JS：`src/screens/SettingsScreen.tsx`
- 诊断面板增加「HRV/睡眠/体温/血氧 样本日期」和「睡眠摘要日期」，方便验证 intraday 是否回来。
- 初始 mock `RingState` 补 `sleepSummaryDate: null`。

### 原生：`ios/VeepooRing/VeepooRing.m`
1. 新增 `sampleTimeString(id raw)` 辅助函数，把 SDK 时间字段统一转成 `"HH:mm"`。
2. 血氧读取：emit 日聚合 `onSpo2Day` + intraday 样本 `onSpo2Samples`（`Time`/`time` 字段）。
3. 体温读取：emit 日聚合 `onTempDay` + intraday 样本 `onTempSamples`（`hour/minute` 字段）。
4. HRV 读取：emit 日聚合 `onHrvDay` + intraday 样本 `onHrvSamples`（`time` 字段），并在样本中附加 `hearts` 数组。

## 验证步骤

1. Xcode `Product → Clean Build Folder` → `⌘R`（原生改动必须重编）。
2. App 打开后等 1–2 分钟，让 `recoverOfflineNow` 从戒指 flash 下载完成。
3. 进入 **设置 → 调试·数据诊断**：
   - 「睡眠摘要日期」应为 `2026-9-5`。
   - 「血氧 样本日期」「体温 样本日期」「HRV 样本日期」应包含 `2026-9-5`。
   - 「HR 样本日期」也应包含 `2026-9-5`（由 HRV 反推补全）。
4. 回到洞察页：
   - 睡眠和激素 tab 应显示 9/5 8h39m 的完整分期。
   - 心率/血氧/体温卡片 0–10 点应出现曲线。
5. 若仍异常，点「导出诊断文件」发我精确定位。

## 已知协议边界

- HRV hearts 反推心率只能补 0–7 点左右（协议说明 hearts 主要用于 0–7 点洛伦兹散点图）。若 7–10 点仍无 HRV，该段心率仍会空。
- EDA 无自动历史 API（协议未提供），离线期 EDA 无法恢复。
