# Mira 本地数据存储规范（SDK 本地库 + App 本地 JSON）

> 目的：把"数据存在哪、存了什么字段、什么格式"一次说清，并标注本次修复的 bug。
> 依据：VeepooBleSDK 头文件 `VPDataBaseOperation.h`、uni-app/HBandSDK 文档、本项目 `RingBleManager.ts` / `VeepooRing.m`。

---

## 一、Veepoo SDK 自己的本地库（`VPDataBaseOperation`）

戒指测的数据**先存在戒指 Flash**，连上 App 后由 `veepooSdkStartReadDeviceAllData` 全量同步进 **SDK 内置 SQLite（FMDB）**。这层库由 VeepooBleSDK 管理，不在我们代码里，我们只是用类方法按 **「日期 + 设备 MAC」** 查。

| 项 | 说明 |
|---|---|
| 存储位置 | SDK 内置 SQLite（FMDB），App 沙盒内，由 VeepooBleSDK 管理 |
| 索引键 | `queryDate`（yyyy-MM-dd，如 `2026-09-03`） + `tableID`（设备 MAC = `peripheralModel.deviceAddress`） |
| 填充时机 | **只有** `veepooSdkStartReadDeviceAllData` 全量同步完成后，下列查库方法才返回数据；否则为空 |
| 并发限制 | SDK 不支持并发；体温读取不可与 HRV/血氧/日常并发 |

### 各指标查询方法与返回字段

| 指标 | 查询方法 | 返回结构 | 关键字段（属性名 → 含义/单位） |
|---|---|---|---|
| 心率原始（每 5/10 分钟） | `veepooSDKGetOriginalDataWithDate:andTableID:` | `NSDictionary`，键=时间串("10:40") | `heartValue`(bpm)、`diastolic`(舒张压)、`systolic`(收缩压)、`stepValue`、`calValue`、`disValue`、`sportValue`、`met`(梅脱)、`stress`(压力)、`ppgs`/`ecgs`(波形数组) |
| 心率半小时均值 | `veepooSDKGetOriginalChangeHalfHourDataWithDate:andTableID:` | `NSDictionary`，键=半小时("10:30") | `heartValue`(半小时均值)、`stepValue`/`calValue`/`disValue`(累加) |
| 血氧（每 1 分钟） | `veepooSDKGetDeviceOxygenDataWithDate:andTableID:` | `NSArray<NSDictionary>` | `OxygenValue`(%)、`ApneaResult`、`IsHypoxia`、`HypoxiaTime`、`CardiacLoad`、`HRV`、`RespirationRate`(呼吸率)、`HeartValue` |
| 体温（每 5 分钟） | `veepooSDKGetDeviceTemperatureDataWithDate:andTableID:` | `NSArray<NSDictionary>` | `value`(℃, 体表/体温)、`originalValue`(皮肤温度)、`hour`、`minute`、`month`、`day` |
| HRV（每 1 分钟） | `veepooSDKGetDeviceHrvDataWithDate:andTableID:` | `NSArray<NSDictionary>` | `hrvValue`(ms)、`time`("HH:MM")、`hearts`(字符串数组，每元素×10=一个 RR 间期，洛伦兹散点用) |
| 睡眠（普通） | `veepooSDKGetSleepDataWithDate:andTableID:` | `NSArray<NSDictionary>`（每段一段） | `DEEP_HOUR`、`LIGHT_HOUR`、`SLE_HOUR`+`SLE_MINUTE`、`SLEEP_LEVEL`、`SLEEP_TIME`、`WAKE_TIME`、`SLE_LINE`(每5分钟深浅曲线) |
| 睡眠（精准） | `veepooSDKGetAccurateSleepDataWithDate:andTableID:` | `NSArray<VPAccurateSleepModel>` | `sleepDuration`(分)、`deepDuration`、`lightDuration`、`getUpDuration`(起夜)、`otherDuration`(REM)、`sleepQuality`(评分)、`getUpTimes`、`sleepLine` |
| 计步/距离/卡路里 | `veepooSDKGetStepDataWithDate:andTableID:changeUserStature:result:` | `NSDictionary` | `Step`(步数)、`Dis`(km)、`Cal`(kcal) |
| 血压 | `veepooSDKGetBloodDataWithDate:andTableID:` | `NSArray<NSDictionary>` | `Time`、`diastolic`、`systolic`、`vein`、`isManual` |
| 血糖 | `veepooSDKGetDeviceBloodGlucoseDataWithDate:andTableID:` | `NSArray<NSDictionary>` | `time`、`bloodGlucoses`(数组)、`bloodGlucoseLevels`(风险 1-3) |
| 血液成分 | `veepooSDKGetDeviceBloodAnalysisDataWithDate:andTableID:` | `NSArray<VPDailyBloodAnalysisModel>` | 胆固醇/甘油三酯/HDL/LDL/尿酸 等 |
| ECG 离线 | `veepooSDKGetDeviceOffStoreECGWithDate:andTableID:` | `NSArray<VPECGTestDataModel>` | 波形/时长/平均心率（测完需再全量同步一次才入库） |
| 身体成分离线 | `veepooSDKGetDeviceOffStoreBodyCompositionWithDate:andTableID:` | `NSArray<VPBodyCompositionValueModel>` | 体重/脂肪率/水分/肌肉 等 |

> 注意：计步、睡眠、血氧、体温、HRV、ECG、身体成分、血糖+血液成分**戒指按天离线存档**；EDA/GSR 皮电**只在实时流、不存档**（所以皮电永远无法 backfill）。

---

## 二、App 本地存储（`mira_ring_state_v1.json`）

| 项 | 说明 |
|---|---|
| 路径 | iOS App 沙盒 `FileSystem.documentDirectory + "mira_ring_state_v1.json"`（Documents 目录，普通方式取不到） |
| 同步开关 | `... + "mira_ring_sync_flag_v1.json"`（独立落盘，⌘R 不丢） |
| 格式 | 单个 JSON 文件，整棵状态树序列化；每次状态变更后 **5s 防抖**写盘 |
| 恢复 | 启动时 `loadPersisted()` 自动重灌；`seriesByDay` 等逐日数据也一并恢复（跨 ⌘R 保留趋势曲线） |

### 主要字段（JSON 顶层 key）

| 字段 | 类型 | 含义 |
|---|---|---|
| `seriesByDay` | `{ signalKey: { "2026-9-3": TimePoint[] } }` | **连续曲线主存储**。signalKey ∈ hr / hrv / spo2 / temp / stress / fatigue / snsActivation / met / steps / distance / calorie。TimePoint = `{t: 绝对时间戳ms, v: 数值}` |
| `hrDaily` / `hrvDaily` / `spo2Daily` / `tempDaily` | `{ "2026-9-3": number }` | 各指标**逐日均值**（单点，供今日状态种子 / 周月年跨天趋势） |
| `daily` | `{ hr, hrItem, hrv, spo2, temp, eda, rr, ... }` | **今日**当前值（仅当天由实时/今日回填更新） |
| `dailyHistory` | `{ signalKey: TimePoint[] }` | 跨天累计的当日实时序列（含历史日的当天段） |
| `sleepStages` / `sleepSummary` / `sleepDaily` | object / object / `{date:...}` | 睡眠分期（合成 hypnogram）、睡眠摘要、逐日睡眠 |
| `stepDaily` | `{ "2026-9-3": {steps,distance,calorie} }` | 逐日计步 |
| `extDaily` | `{ "2026-9-3": {血压/健康一览/身体成分...} }` | 光电血压、健康一览硬指标、身体成分 |
| `ecg` / `ecgDaily` | `EcgReading` / `{date: EcgReading}` | 单次 ECG、逐日 ECG |
| `female` | object | 经期/周期 |
| `deviceCapabilities` | object | 设备能力位（ecgType / funcAssessmentType / healthGlanceType / supportManualTestType） |
| `statusHistory` / `statusDaily` / `statusTimeline` / `dailyCurve` / `curveStatus` | — | 今日状态分、逐日状态、状态时间线、当日曲线 |
| `userProfile` | object | 身体成分档案（下发戒指用） |
| `deviceId` / `lastSyncedAt` / `lastUploadedAt` / `syncEnabled` | — | 设备标识、最后同步/上传时间、同步开关 |

### 日期 key 约定（全链路一致）
- **JS 侧锚点 / 存储**：`dayKeyOf` → `2026-9-3`（**不补零**，形如 `yyyy-M-d`）
- **原生查 SDK 库**：`dateStringForDaysAgo` → `2026-09-03`（**补零** `yyyy-MM-dd`，SDK 要求）
- 原生 emit 连续样本时用 `queryDate`(补零)，JS 收数端 `dayKeyOf(new Date("2026-09-03 00:00"))` 归一化回 `2026-9-3` → 与锚点对齐。**日期 key 不是 bug 来源。**

---

## 三、数据流

```
戒指 Flash ──veepooSdkStartReadDeviceAllData(全量同步)──▶ SDK 本地库(VPDataBaseOperation)
                                                                    │ 按 日期+MAC 查
                                                                    ▼
                                      RingBleManager 原生 backfill (VeepooRing.m)
                                                                    │ emit onXxxSamples / onXxxDay
                                                                    ▼
                                       TS handlers → seriesByDay / *Daily （内存）
                                                                    │ 5s 防抖 saveSnapshot
                                                                    ▼
                                       mira_ring_state_v1.json（主存储，真源）
                                                                    │ 启动时 loadPersisted 恢复
                                                                    ▼
                                       各详情页（按锚点 dateKeyOf 取 seriesByDay[signal][锚点]）
```

---

## 四、本次修复的问题（2026-09-04）

1. **`hasPersistableData()` 漏判 backfill 数据 → 历史日数据不落盘（系统性"存不下来"）**
   - 原逻辑只认 `history / daily / dailyHistory / tempDaily / statusTimeline / curveStatus / dailyCurve`，**完全没检查 `seriesByDay` 和 `hrvDaily/hrDaily/spo2Daily/sleepDaily/stepDaily/extDaily/ecgDaily`**。
   - 历史日 handler 只写 `hrvDaily["2026-9-3"]`/`seriesByDay['hrv']["2026-9-3"]` 这类映射、**不碰 `daily`**（只有"今日"才写 `daily`）。所以当某历史日**只有 HRV/HR/血氧、没有体温也没有实时流**时，`hasPersistableData` 判 false → `saveSnapshot` 直接 return → **整包历史数据不写盘，下次打开全丢**。
   - 修复：补齐 `seriesByDay` 与各 `*Daily` 映射的判定（`RingBleManager.ts` `hasPersistableData`）。

2. **体温连续曲线永远为 0 个点（`n=130 samples=0`）**
   - `backfillDayTemperature` 要求 `hour`+`minute` 同为 `NSNumber` 才入 samples；HK18 实际把 hour/minute 以 **NSString** 返回 → `isKindOfClass:[NSNumber]` 全失败 → 库里 130 条一条曲线点都 emit 不出，只剩日均单点（画不出线）。
   - 修复：兼容 `NSString`/`NSNumber`，时间字段缺失时按"每 5 分钟一条"用序号兜底（`VeepooRing.m`）。

3. **文件被外部编辑损坏：`handleDayBucketSamples` 残留一份无函数头的残缺副本**，导致整文件 TS 语法崩坏（`tsc` 报 20+ 错）。已删除该残缺副本，`tsc --noEmit` 通过。

> 触发条件提醒：`backfill` 只在**连接戒指成功**时跑（不是 App 一打开就跑）；「数据同步」开关是总闸，关了 backfill 直接跳过。需 ⌘R 才生效的改动：`.m` 三项（temp 容错）；TS 改动已热更新。
