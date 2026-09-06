# 离线恢复修复说明（数据同步开关）

> 目标：让设置页「数据同步」开关（及回前台 / 30min 周期 / 连接成功）真正把戒指 flash 里离线累积的数据救回 App。
> 协议依据：本地 `VeepooBleSDK.framework/Headers`（与 github.com/HBandSDK/iOS_Ble_SDK 同版本 2.2.102.x）+ 已核准的 `veepooSDKGetDeviceOffStore*WithDate:` 系列。

## 根因

戒指在佩戴者睡眠 / 手机断连期间，会把 HR、睡眠、血氧、体温、HRV、步数等写入自身 flash。App 要拿到这些数据，必须经过两步：

1. **下载**：`[VPPeripheralBaseManage veepooSdkStartReadDeviceAllDataWithReadStateChangeBlock:]` —— 把戒指 flash 的离线数据拉进 SDK 本地 SQLite（VPDataBaseOperation 库）。
2. **读取**：`veepooSDKGetOriginalDataWithDate:andTableID:` / `veepooSDKGetAccurateSleepDataWithDate:andTableID:` / `veepooSDKGetDeviceOxygenDataWithDate:...` 等，从 SDK 库逐日读出。

头文件里 `veepooSDKGetDeviceOffStoreECGWithDate:` / `veepooSDKGetDeviceOffStoreBodyCompositionWithDate:` 的 "OffStore" 即「离线存储」——**不先执行第 1 步下载，这些离线数据根本不在库里**。

原链路缺陷：`RCT_EXPORT_METHOD(backfill)`（被开关 ON、回前台、30min 周期、连接成功四处调用）只调 `backfillRecentDays`，而 `backfillRecentDays` **仅在 `deviceTotalDays==0 && saveDays==0` 时才重新下载**。一旦戒指曾经连过（`deviceTotalDays>0`），手动/自动触发都只读旧库 → 睡眠期 / 离线期间累积的最新一批数据永远拉不回来。

## 修复（原生 `ios/VeepooRing/VeepooRing.m`）

- 已有 `recoverOfflineNow`（先 `veepooSdkStartReadDeviceAllData` 下载 → 氧血 → HRV → `backfillRecentDays`），本次把它**接入主链路**：
  - `RCT_EXPORT_METHOD(backfill)` 由 `backfillRecentDays` 改为 `recoverOfflineNow` → 所有入口（开关 ON 的 syncBackfill、回前台、30min、连接成功）一律先重下载再回填。
- 并发守卫 `recovering`（已在属性区声明）：
  - `onPasswordVerified` 在**同步段**即置 `recovering=YES`，使连接瞬间 `backfill()` 与重连下载链路不会双路并发拉取；
  - `setSyncEnabled(true)` / `recoverOffline` / `backfill` 触发的 `recoverOfflineNow` 见到 `recovering=YES` 自动跳过，避免重复下载。
  - 兜底：断连（`VPDeviceConnectStateDisConnect`）与 30s 强制就绪分支都清 `recovering=NO`，防止守卫卡死导致后续恢复被永久跳过。

## 接线确认（JS → 原生）

- 设置页「数据同步」开关 ON：`RingBle.setSyncEnabled(true)`（原生已实现 → `recoverOfflineNow`）+ `RingBle.syncBackfill()`（→ `native.backfill()` → `recoverOfflineNow`），守卫去重为一次下载。
- 历史日详情页无数据时：`MetricDetailScreen` → `RingBle.syncBackfill()` → 同上。
- 回前台 / 30min 周期 / 连接成功：`RingBleManager` 内部 → `VeepooNative.backfill()` → 同上。

## 验证要求

原生改动无法在沙箱编译（需 Xcode）。真机验证步骤：Clean Build + ⌘R → 戴戒指睡一晚 → 次日开 App、确保「数据同步」开启 → 观察原生日志 `[Recovery] ★ 开始从戒指 flash 重新拉取离线数据` 与 `[Backfill] sleep day=...` 是否出现，睡眠期 HR/睡眠/血氧应回填。

## 已知边界（协议层面，非 bug）

- 血氧 / 体温 / HRV：硬件按「日聚合」存储，回填只能拿到日均/最值，无逐分钟曲线（参考 `VeepooUniAppSDK使用文档.md`）。
- EDA（皮电）：协议无自动历史 API，离线期间数据无法回补，属硬件/协议限制。
