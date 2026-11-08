# 戒指全指标链路审计（2026-11-07）

> 触发：用户「身心压力图表用的就是压力，把这个做完；把戒指能传的所有指标都看一下，有些可能不对；把频率标出来，夜间频率高、日间频率低」。
> 范围：**Android 优先**，iOS 未改动。
> 依据：本地 `hband-sdk/`（Android SDK 源码 + apidoc + 476KB API 文档、iOS SDK 头文件、uni-app SDK）、已装 APK 的 `classes4.dex`、`src/` 全链路代码。

## 0. 结论先说

1. **上一轮「SDK 无连续压力序列」的结论是错的，已更正。** 压力确实有真实数据源，只是**不在 v3 五分钟原始数据桶里**，而在「读取设备手动测量数据」通道（`DeviceManualDataType.STRESS(3)`）与健康一览/微体检快照里。已装 APK 的原生桥没接这条通道 → `onBatch` slot 里永远没有 `stress` → 首页/详情页读 `healthStore['stress']` 恒空。
2. **采样频率有官方口径，且日/夜确实不同。** HRV、血氧在**睡眠期每分钟**采一点（洛伦兹散点取 0–7 点），白天只在自动监测触发时有点；心率/体温/步数是 5 分钟桶；血压每小时一组。自动测量间隔由 `AutoMeasureData.measureInterval` 配置，支持按时间段设不同值。
3. **本轮纯 JS 侧全部做完**（Metro 热更即可生效）：全指标字段别名对齐、零值守卫修正、采样频率标注（详情页 + 睡眠页 + 真机日志）、睡眠曲线解析（上一轮）。
4. **压力要真正有数值，仍需一次原生重编译**：补丁已写好，但重编译前必须先恢复完整 Kotlin 源码，否则会把手机上能用的完整原生层编译倒退成 394 行空桩。详见 §4。

## 1. 采样频率 · 协议口径（有出处）

| 通道 | 日间 | 夜间 | 出处 |
|---|---|---|---|
| 5 分钟原始数据桶 | 每 5 分钟（或 10 分钟） | 每 5 分钟 | `VPDataBaseOperation.h:16`；`VeepooSDK_Android_Api.md:1145,1248`（一天最多 288 条） |
| HRV 原始数据 | 自动监测间隔（常见 30–60 分钟） | **每分钟**，0–7 点 | `VPDataBaseOperation.h:239-249` |
| 血氧历史 Spo2hOriginData | 手动 / 稀疏自动点 | **每分钟** | `VPDataBaseOperation.h:208-234` |
| 体温、血糖自动测量 | 每 5 分钟 | 每 5 分钟 | `VPDataBaseOperation.h:259,275` |
| 血压 | 每小时约一组有效值 | 每小时约一组 | `VPDataBaseOperation.h:80-100` |
| 压力 / MET / 疲劳 / 皮电 | 设备测量记录，间隔由 `measureInterval` 配置 | 同左（可按时间段不同） | `VeepooSDK_Android_Api.md:10061,10738-10746,10748` |
| 睡眠分期曲线 | — | 普通睡眠 **1 字符 = 5 分钟**；精准睡眠 **1 字符 = 1 分钟** | `VPDataBaseOperation.h:120`；`VeepooSDK_Android_Api.md:1041,3327` |
| PPG 原始数据模式 | MODE1 每 15 分钟 / MODE2 每 5 分钟 / MODE3 实时 | — | `VeepooSDK_Android_Api.md:13912-13914` |

> `VPDataBaseOperation.h:16` 原文：「一般是每隔5分钟或者10分钟的，**如果间隔时间长就是在设备中没有读取到数据**」——图上点疏不等于 App 丢包。

## 2. 全指标对照表

「原生 slot」列来自 `classes4.dex` 的 const-string 全集（97 个短标识符），是**已装 APK 实际会 emit 的字段**。

| 指标 | SDK 真实来源 | 频率 | 已装 APK slot | JS 映射（本轮） | UI | 判定 |
|---|---|---|---|---|---|---|
| 心率 HR | `OriginData.rateValue` / `OriginData3.ppgs,ecgs` / PPG 每分钟 | 5 分钟桶 | `hr`,`heartrate`,`bpm` | `hr` + 6 个别名 | 心率页 | ✅ |
| HRV | `HRVOriginData` 每分钟 | **夜 1 分 / 日稀疏** | `hrv` | `hrv`,`hrvValue` | HRV 页、夜间 HRV | ✅ 频率已标注 |
| 血氧 | `Spo2hOriginData` 每分钟 | **夜 1 分 / 日手动** | `spo2h`,`oxygen`,`bloodoxygen` | 本轮补齐 `spo2h→spo2` 等 5 别名 | 血氧页、夜间血氧 | ⚠️→✅ 已修 |
| 体温 / 皮温 | 温度自动测量每 5 分钟 | 5 分钟 | `temp` | `temp`,`temperature`,`bodyTemperature` | 体温页 | ✅ |
| 步数 / 距离 / 卡路里 | `OriginData` 5 分钟汇总 | 5 分钟 | `step`,`cal`,`dist` | 别名 + **0 值合法**（本轮） | 活动消耗 | ⚠️→✅ 已修 |
| 血压 | 每小时一组 / 手动 | 每小时 | `bpSys`,`bpDia` | `systolic`,`diastolic`,`highValue`… | 血压页 | ✅ |
| **压力 stress** | `PressureManualData.pressure [0-100]`、`MiniCheckupResultData.stress`、`VPHealthGlanceTestModel.stress` | 设备测量间隔可配 | **无** | `stress` + `pressure`/`stressValue`/`stressIndex`（本轮） | 首页身心压力、压力分布/时段 | ❌ **原生未 emit → 待重编译** |
| **梅脱 met** | `MetoManualData.getMeto()`、5 分钟原始数据样例 `met` | 5 分钟桶 / 测量记录 | **无** | `met`,`meto`,`metValue`（本轮） | 活动消耗 | ❌ 同上 |
| 疲劳 fatigue | `FatigueManualData` / `fatigueLevel` | 快照/按需 | 无 | `fatigueLevel`,`fatigueIndex`（本轮） | 疲劳页 | ⚠️ 稀疏，正常 |
| 皮电 EDA/GSR | `SkinConductanceManualData` | 按需 | 无 | `gsr`,`skinConductance`,`eda`（本轮） | 皮电页 | ⚠️ 只按需有值 |
| 呼吸率 RR | `OriginData3.resRates` / 随血氧、ECG | 5 分钟桶 | 无 | **本轮新增** `resRate`,`respirationRate`,`breathRate` | 呼吸率页 | ⚠️→✅ 已修 |
| 血糖 / 血脂 / 尿酸 | 健康一览复合测量、`OriginData3.bloodComponent` | 按需 | 无 | `bloodGlucose`,`bloodSugar` 等 | 基础指标 | ✅ 稀疏正常 |
| 情绪 / 皮质醇 / SNS / 皮肤 / 抑郁风险 | `VPHealthGlanceTestModel` | 快照/按需 | 无 | `emotionLevel`,`cortisolValue`,`snsActivation`,`skinMoisture`,`depressionRisk`（本轮） | 洞察页 | ✅ 稀疏正常 |
| 睡眠分期 | `SleepData.sleepLine` | 5 分/字符 或 1 分/字符 | `sleepLine` | 上一轮改为三候选自适应解析 | 睡眠页 | ⚠️→✅ 已修 |

**发现并修正的错位**
- `METRIC_MAP` 只认一套自造 key，固件用 SDK 原名（`pressure` / `meto` / `heartValue` / `resRate` / `gsr`）回传时整条指标被静默丢弃 → 本轮登记 40+ 别名。
- `v <= 0` 守卫把压力 0（合法「完全放松」）、步数/卡路里/距离 0（合法「这 5 分钟没动」）全砍掉 → 本轮按 SDK 值域放行。
- `handleBackfillDaySlots` 的 `p.v > 0` 同样问题 → 已修。
- `handleHealthGlanceDay` 只认 `raw.stress` 一个名字 → 已接 `pressure` / `fatigueLevel` / `snsActivation` / `cortisolValue` 等。
- `spo2h` 血氧历史通道原本没进映射 → 已补（上一轮）。

## 3. 本轮改动文件

| 文件 | 改动 |
|---|---|
| `src/lib/samplingCadence.ts` | **新增**。协议频率表（含出处）+ 从真实样本时间戳算日间/夜间间隔中位数 |
| `src/components/CadenceNote.tsx` | **新增**。可展开的频率标注组件，实测与协议严格分开 |
| `src/screens/MetricDetailScreen.tsx` | 全指标详情页新增「采样频率」卡 |
| `src/components/SleepAnalysisCard.tsx` | 夜间 HR/HRV/血氧实测频率 + 协议差异说明 |
| `src/ble/RingBleManager.ts` | 字段别名全集、零值守卫、`[Batch.cadence]` / `[Batch.source]` 真机诊断日志、日均值别名兜底、健康一览别名 |
| `src/data/metricKeyMap.ts` | `onRealtime` 别名表补齐 SDK 原名 |
| `docs/native-patches/VeepooManualTestReader.kt` | **新增**。原生压力/MET 通道补丁（待接入） |
| `docs/native-patches/VeepooRingModule.recovered-lines-300-1689.kt.txt` | **新增**。从历史会话还原的完整原生桥源码片段 |

`npx tsc --noEmit`：全仓 **47** 个存量错误，本轮 **0 新增**。

## 4. 原生重编译的前置条件（红线）

- 磁盘 `android/app/src/main/java/.../VeepooRingModule.kt` 是 **394 行旧桩**（`backfillSince` 空实现），还缺 `VeepooAutoBridge.kt`。
- 手机上能读 279 条 v3 样本的完整实现**只存在于 APK 的 `classes4.dex`**；历史会话只还原出第 **300–1689 行**，前 299 行未留存。
- 直接 `./build-debug.sh` 会 BUILD SUCCESSFUL 但静默丢掉全部离线读取 → **已加前置 guard，实测拒绝构建**，并备份旧桩为 `VeepooRingModule.kt.stub-20261107.bak`。

要真正让压力出数：补齐完整源码 → 接入 `VeepooManualTestReader` → 重编译装机。产物是**稀疏测量点**（不是 5 分钟连续曲线），App 侧如实按稀疏点统计，不插值、不用 HRV 反推。

## 5. 连戒指后的验收清单

```bash
adb logcat -d | grep -E 'Batch.slots|Batch.cadence|Batch.source|BATCH-SLEEP|\[Batch\] ✅'
```

1. `[Batch.slots] keys=...` → 确认原生实际回传字段全集，是否含 `stress` / `met`。
2. `[Batch.cadence] 日间=…min 夜间=…min` → **直接验证频率差异**，与 UI 上的「采样频率」卡对照。
3. `[BATCH-SLEEP]` → 原串长 / SDK 总时长 / 解析点数三者接近，分期图铺满整晚。
4. `[Batch] ✅ stress` → 若出现，说明原生压力通道已生效；未出现则确认「设备没接通道」而非 JS 丢包。
5. `[Batch.source] source=manualTest` → 确认这批点来自设备测量记录（原生补丁生效后）。
6. 睡眠页「夜间采样频率（实测）」三指标 + 详情页「采样频率」卡 → 目视核对数值与来源标注。

---

## 6. 【13:07 真机验收后修正】两枚戒指必须分开看

用户指出「协议代表两个戒指，全量版 vs LunaMira 精简版，没区分出来」。连上真机后确认属实，
且比预想严重：**§1 的频率表与 §2 的对照表都是全量版口径**，套到精简版上多项是反的。

真机 = LunaMira 精简版，MAC `41:42:E7:17:9B:1C`，固件 `00.12.09`，**原始协议版本 5**，存储 3 天。
完整证据与两档对照见 **`docs/RING_DEVICE_CAPABILITY_MATRIX.md`**（本文档的修正基准）。

### 6.1 能力包反转（旧配置 → 真机）

| 指标 | 旧配置 | 真机能力包 | 真机数据 |
|---|---|---|---|
| 体温 | 有 `temp_daily_mean` | ❌ `体温Type=0` | slot 无 temp |
| 血脂四项 / 尿酸 | 有 | ❌ `血液成分=不支持 (CompTag=0)` | 无 |
| 身体成分 | 有 | ❌ 不支持 | 无 |
| 血压 | Pro 专属、精简版无 | ✅ `血压 BP : 支持 (BpTag=1)` | **逐点 `bpSys/bpDia`** |
| 压力 | 后端 0 条、疑似无源 | ✅ `压力=支持 (StressType=2)` | slot 无 stress（走手动测量记录通道） |
| 疲劳 / 梅脱 | 保留 | ❌ `疲劳 Fatigue : 不支持` | slot 无 fatigue/met |
| ECG | 无 | ✅ 确认 `ECG=不支持` | 分档方向正确 |
| 精准睡眠 | 未区分 | ✅ `sleepTag=6` | sleepLine = 1 字符 1 分钟、五态 |

`src/config/deviceModel.ts` 的 `NATIVE_METRIC_CATALOG` / `BASE_UI.features` 已按上表重写，
并新增 `LUNAMIRA_BASE_CAPABILITY_FINGERPRINT` 固化真机能力指纹。

### 6.2 频率口径：精简版实测与 §1 表格不同

```
[Batch.slots] dk=2026-11-06 n=1440 keys=hr,bpDia,bpSys,spo2,hrv,t
[Batch.cadence] dk=2026-11-06 points=1440 日间=1.0min(840) 夜间=1.0min(599)
```

- 精简版协议版本 5 是**全天 1 分钟等间隔、1440 点/天**，不是 §1 写的「5 分钟桶 / 一天 288 条」。
- 用户说的「夜间频率高、日间频率低」是**全量版** HRV/血氧洛伦兹原始数据口径；这枚精简版**日夜无差异**。
- 逐点字段全集只有 6 个：`hr, bpSys, bpDia, spo2, hrv, t`；活动量是日汇总（steps/calorie/distance 各 4 条）。
- `v3 收到 279 条 5 分钟样本` 是另一条历史通道，与 v5 每分钟 slot 并存，不要混算频率。
- App 里「采样频率」卡走 `computeMeasuredCadence()` 从真实时间戳算，**显示 1.0min / 1.0min 是对的**；
  卡片上的「协议口径」静态文字属全量版规格，按机型区分以能力矩阵文档为准。

### 6.3 验收结论（13:06–13:07）

- 自动连接：按已知 MAC 直连成功，**0 次扫描**、8 秒连上，持续同步无掉线（详见能力矩阵 §6）。
- 睡眠分期：能力包 `sleepTag=6` 印证 `parseSleepLineHex` 三候选自适应方向正确。
- 夜间三指标：`hr/spo2/hrv` 都有逐点值，`nightPhysiology.ts` 可取到真实睡眠窗口样本。
- 压力：`[Batch] ✅ stress` **未出现** → 再次确认原生没接 `readDeviceManualData(STRESS)`，不是 JS 丢包。
- 能力字段透传：`ready` 只带 `{deviceVersion, passwordConfirmed}`，`ecgType` 等 `*Type` 未透传 →
  机型识别实际靠 MAC 兜底，列为后续原生改动项。
