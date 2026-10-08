# Mira 戒指同步契约对照表 v2（Veepoo HK18 × mira-app）

> 适用项目：`mira-app`（Expo 51 + RN 0.74 + VeepooBleSDK 原生桥，**当前范围：iOS only**）
> 整理日期：2026-10-08
> （2026-10-08 修订：澄清 EDA / 皮质醇 / GSR / HealthGlance **并非设备自动连续测量**，而是 App 主动点测；并补充 cortisolProxy 融合设备真值）
> 数据来源（已逐条核对，非推测）：
> - 原生桥实现 `ios/VeepooRing/VeepooRing.m`（emitMetric / triggerHealthGlance / triggerGSR / backfill）
> - iOS SDK 头文件 `VPGSRResultModel.h` / `VPHealthGlanceTestModel.h` / `VPManualHealthGlanceModel.h`（字段名 + 单位 + 范围）
> - JS 侧 `src/ble/RingBleManager.ts`（emitMetric key → HSMetricKey 映射）、`src/data/metrics.ts`（卡片定义）

---

## ⚠️ 0. 三个必须先讲清的结论

1. **皮质醇 / 交感神经活跃度 / 情绪 / 皮肤含水量 / 疲劳度 / 抑郁风险 = 真实设备值，已直采，不是 proxy 推算。**
   原生桥 `triggerHealthGlance` / `triggerGSR` 把 `VPHealthGlanceTestModel` / `VPGSRResultModel` 的字段直接 `emitMetric` 出去，经 `RingBleManager` 落 `healthStore`。`src/data/metrics.ts` 里这些卡全部标注「健康一览自动同步」。
   → 所以它们与 `cortisolProxy`（基于 HRV/EDA/SNS z-score 反推的**连续代理**）是**互补**关系：proxy 负责全天候连续趋势，设备值是点测真值快照，可做 proxy 的校验/锚点。

2. **皮质醇 / 交感神经走「皮电 GSR / 健康一览」点测，设备本身不自动测量。**
   GSR 与 HealthGlance 都是「你（App）触发一次、测一次」的单发测量（约 20–50s 出值），**不是**像 HR/SpO₂ 那样由设备后台 24/7 连续采的传感器。
   所谓"每 ~20s 一个结果"是 **App 的轮询循环（`setAutoMonitor` → 10s 定时器，体温/HealthGlance 与 皮电 GSR 两路交替）跑出来的节奏**，前提是：① App 开启了自动监测；② 戒指固件支持 GSR（`supportManualTestType` bit12）与 HealthGlance（type=2）。**这三者任一不成立，就完全没有数据**——设备不会自己默默测。所以它本质是"App 主动点测"，不是"设备连续测量"。
   想要全天候连续曲线，只能靠 `cortisolProxy` 用 HRV/EDA/体温/心率反推（见 §3 融合）。

3. **⌛ Android 原生桥缺失（2026-10-08 决策：暂不投入）。**
   全仓 `android/` 下零 Veepoo 引用（grep `veepoo` 命中 0）。iOS 侧已完整接入；**当前项目明确仅做 iOS**，Android 缺失属"产品决策暂不投入"，非紧急 bug。等 iOS 跑通、需要双端时再补 `VeepooRingModule` 等价实现，或届时明确"仅 iOS 支持"并屏蔽 Android 对应 UI。

---

## 1. 指标 → 协议源 → 结果字段 / 单位 / 范围 → 频率 → 取数命令 → Mira 同步字段

> 列「同步字段」= `RingBleManager` 的 `emitMetric` key（即最终进 `healthStore` / `POST /v1/ring/sync` 的字段）。`HSMetricKey` 为落库键（与同步字段同名或别名）。

### 1.1 基础 5（后台自动 / 实时连续）

| 指标 | 协议源 | 设备返回字段 | 单位 / 范围 | 频率 / 同步方式 | 取数命令 | 同步字段 |
|---|---|---|---|---|---|---|
| 心率 HR | 实时流 + 按天归档 | `heartRate` | bpm（30–250） | 实时连续 + 自动按天归档 | `startRealtimeHR` / `readBasicData` | `hr` |
| 血氧 SpO₂ | 实时流 + 按天归档 | `bloodOxygen` | %（90–100） | 实时连续 + 自动按天归档 | `startRealtimeOxygen` / `readOxygenData` | `spo2` |
| 体温 | 健康一览 | `bodyTemperature` | ℃（35–38.5） | 轮询点测（10s 轮，~50s 出） | `triggerHealthGlance` | `temp` |
| EDA 皮电 | 皮电 GSR | `skin_moisture`（GSR）/ `skinMoisture`（HG） | 相对指数 1–99 | **App 轮询点测（非设备连续）**：10s 轮、两路交替 → 每路约 20s 一次；依赖自动监测开关 + 固件 GSR(bit12) 支持 | `triggerGSR` | `eda`（= skin_moisture）|
| HRV | 设备历史库 | `hrv` | ms（0–150） | 当日历史读取（固件不开放实时 HRV 测试）| `readHistoricalHrv` | `hrv` |

### 1.2 心理 / 自主神经（★全部来自 GSR 或 HealthGlance 点测 — 非连续）

| 指标 | 协议源 | 设备返回字段 | 单位 / 范围 | 频率 / 同步方式 | 取数命令 | 同步字段 |
|---|---|---|---|---|---|---|
| **皮质醇** | 健康一览 / GSR | `cortisolValue`（HG）/ `cortisol_value`（GSR） | **μg/L，[0,500]**（真浓度，晨高夜低） | **App 轮询点测（非设备连续）**：10s 轮、两路交替 → 约每 20s 一次；依赖自动监测开关 + 固件 HealthGlance(type2)/GSR(bit12) 支持 | `triggerHealthGlance` / `triggerGSR` | `cortisol` |
| **交感神经活跃度** | 健康一览 / GSR | `snsActivation`（HG）/ `sns_activation`（GSR） | **[1,99]** | 随 GSR/健康一览点测 | `triggerGSR` / `triggerHealthGlance` | `sns` |
| **情绪** | 健康一览 / GSR | `emotionLevel`（HG）/ `emotin_level`（GSR） | **[-10,10]**（负低落/正高涨） | 随 GSR/健康一览点测 | 同上 | `emotion` |
| **皮肤含水量** | 健康一览 / GSR | `skinMoisture`（HG）/ `skin_moisture`（GSR） | **[1,99]** | 随 GSR/健康一览点测 | 同上 | `skin` |
| **疲劳度** | 健康一览 | `fatigueLevel` | [0,100] | 随健康一览点测 | `triggerHealthGlance` | `fatigue` |
| **压力** | 健康一览 / GSR | `stress` / `sns_activation` 印证 | [0,100]（0–20放松/21–40正常/41–60中等/61–80偏高/81–100很高） | 随健康一览点测 | `triggerHealthGlance` / `triggerGSR` | `stress` |
| **抑郁风险** | 皮电 GSR | `depression_risk`（`VPGSRResultModel`） | **[0,2]**（0低/1中/2高，**诊断向**） | 随 GSR 点测 | `triggerGSR` | `depressionRisk` |

> 取数命令路由（`VeepooRing.m` `measure:`）：
> - `cortisol / sns / emotion / skin / fatigue / 血脂` → `triggerHealthGlanceWithToken`
> - `stress / depression / eda` → `triggerGSRWithToken`
> - 自动轮询 `startRotationIfNeeded`：每 10s 一轮，体温/healthGlance 与 皮电 GSR 交替，单路 50s 超时兜底（固件不支持/未佩戴时优雅放行，不卡死其他通道）。

### 1.3 代谢 / 血液（随健康一览或独立点测）

| 指标 | 协议源 | 设备返回字段 | 单位 / 范围 | 频率 / 同步方式 | 取数命令 | 同步字段 |
|---|---|---|---|---|---|---|
| 血糖 | 健康一览 | `bloodSugar` | mmol/L（2–12） | 随健康一览点测 | `triggerHealthGlance` | `glucose` / `bloodSugar` |
| 总胆固醇 | 健康一览 | `totalCholesterol` | mmol/L（0–10） | 随健康一览点测 | `triggerHealthGlance` | `cholesterol` / `bloodFat` |
| 甘油三酯 | 健康一览 | `triglyceride` | mmol/L（0–6） | 随健康一览点测 | `triggerHealthGlance` | `triglyceride` |
| HDL | 健康一览 | `highDensityLipoprotein` | mmol/L（0–3） | 随健康一览点测 | `triggerHealthGlance` | `hdl` |
| LDL | 健康一览 | `lowDensityLipoprotein` | mmol/L（0–6） | 随健康一览点测 | `triggerHealthGlance` | `ldl` |
| 尿酸 | 健康一览 | `uricAcid` | μmol/L（50–600） | 随健康一览点测 | `triggerHealthGlance` | `ua` / `uricAcid` |
| 血压（光电） | 健康一览 / 光电血压 | `systolicBloodPressure`/`diastolicBloodPressure` | mmHg（60–200） | 随健康一览 / 手动点测（依赖 `isSupportBPTest`）| `triggerHealthGlance` | `bpSys` / `bpDia` |

### 1.4 睡眠 / 活动（按天归档）

| 指标 | 协议源 | 设备返回字段 | 单位 / 范围 | 频率 / 同步方式 | 取数命令 | 同步字段 |
|---|---|---|---|---|---|---|
| 睡眠（深/浅/REM/总/评分） | 自动数据 | `deepSleepTime`/`lightSleepTime`/`nightTotalTime`/`sleepQuality` | 时段/分/% | 每日按天归档 | `readSleepDataWithDayNumber` | `sleepDeep`/`sleepRem`/`sleepTotal`/`sleepScore` |
| 步数 / 距离 / 卡路里 | 自动数据 | `step`/`distance`/`calorie` | 步 / km / kcal | 每日按天归档 | `readStepDataWithDayNumber` | `steps`/`distance`/`calorie` |
| 呼吸率 | ECG 平均值 | `aveResRate`（ECG 附带） | 次/分（5–40） | 手动 ECG 点测（独立呼吸率测量固件返 NoFunction）| `measure(rr)`→ECG | `rr` |

---

## 2. 设备能力门控（决定某项能不能出数）

`VeepooRing.m` 连接后自检（`supportManualTestType` 位掩码 + `healthGlanceType`）：

- **GSR（皮电 / 皮质醇 / 交感神经 / 抑郁风险）** = `supportManualTestType` 第 **12** 位（bit 12）。**不是所有维亿魄固件都有皮电**；不支持时 `triggerGSR` 50s 超时无回调 → 这些字段为空 → App 回退到 `cortisolProxy` 连续代理（逻辑已兜得住）。
- **HealthGlance（健康一览一整套）** = `healthGlanceType`：0 不支持 / 1 定制版（**无 cortisol / 血液成分**）/ 2 公版（全量）。
- **HRV 实时测试** = `isSupportHRVTest`：HK18 = **false** → HRV 只能走历史库读取，不做实时测试。
- **光电血压** = `isSupportBPTest`：HK18 大概率返 0 → `bpSys/bpDia` 可能恒为空，卡片诚实显"—"。
- **呼吸率独立测量** = `TestBreathingRateStart`：固件恒返 `NoFunction(7)` 且会掐断实时 HR/SpO₂ → 已正确省略，改经 ECG 取均值。

> 上线前必做：连真机看 `⚙️ 设备能力：supportManualTestType=0x...` 这行日志，确认 bit12（GSR）与 healthGlanceType 的具体值，据此决定 Mira 该暴露哪些心理指标、哪些回退 proxy。

---

## 3. 与 `cortisolProxy` 的关系（务必讲清，避免重复计算/口径打架）

| 量 | 来源 | 性质 | 用途 |
|---|---|---|---|
| `cortisol`（设备值） | HealthGlance/GSR 点测 | **真值快照**，μg/L [0,500] | 锚点、单点解读 |
| `cortisolProxy`（代理） | HRV/EDA/体温/心率 z-score 反推 + **设备真实皮质醇真值融合** | **连续估计 + 真值锚定**，相对个人基线 0~100 | 昼夜节律曲线、持续性分析、趋势 |

- 二者**不冲突**：proxy 填"全天候连续"的坑，设备值填"绝对真值校准"的坑。
- **★ 2026-10-08 融合落地**：`cortisolProxy.ts` 的 `computeCortisolProxyDay` 现在直接读 `healthStore.getIntraday('cortisol')` 的真实浓度，作为第 6 路 z-score（权重 **0.30**，金标准），并入 HRV/EDA/体温/心率的加权合成。
  - **无真值时自动回退**：没有 `cortisol` 真值（旧数据 / 未开启自动监测 / 固件不支持 GSR）时该路跳过，其余 5 路按 0.7 同比例缩放 → 数学上与原纯 proxy **完全等价**（向后兼容，零破坏）。
  - 有真值时，皮质醇以最高权重直接牵引合成结果，曲线会比纯反推更贴近真实浓度节律。
  - **生效前提**：真实浓度要进 `healthStore`，即必须走通 §0-2 的"App 主动点测"链路（自动监测开启 + 固件支持）。**没真值 → 融合是 no-op → 曲线与融合前无异**，这也是"看起来没变化"的最常见原因。
- 前端两处消费已对齐为同源：`CortisolRhythmCard`（洞察页昼夜节律卡）、`CortisolDailyChart`（身体恢复/洞察睡眠 tab）、`MetricDetailScreen` 日视图（`realSeries.ts`）均调用 `buildCortisolProxyToday`，画的是同一条融合曲线。
- 风险点：若前端同时展示"设备皮质醇值"和"proxy 昼夜节律结论"，需明确区分"点测真值"vs"连续估计"，避免用户误以为两个数字应相等。

---

## 4. 合规红线（Mira 铁律：不做诊断 / 不疗愈 / 不监测）

- **`depressionRisk` [0,2]** 是诊断向分类（直接写"抑郁症风险 高/中/低"）。**不能当诊断展示**，最多做软信号或干脆不暴露标签——违反 Mira 品牌铁律。当前代码已 `hideInList: true`（不进列表），但字段仍在同步；建议明确产品口径（是否对用户可见、可见时如何措辞）。
- 其余心理指标（情绪/压力/疲劳/交感）属"状态自评/状态读数"范畴，可展示，但措辞需贴合 Mira"用户自报为主、不评分"的定位，不叠加强判定。

---

## 5. 平台缺口清单（上线前必补/必决）

| 缺口 / 决策 | 严重度 | 说明 |
|---|---|---|
| **Android 暂不纳入范围** | ⚪ 决策 | 2026-10-08 明确：**当前项目仅做 iOS**，Android 原生桥缺失属"产品决策暂不投入"，非紧急 bug。等 iOS 跑通、需要双端时再补 `VeepooRingModule` 等价实现，或届时明确"仅 iOS 支持"并屏蔽 Android 对应 UI。 |
| iOS 已接但需真机验证字段填充 | 🟡 中 | 血脂四项 / 血压 / GSR 是否真填充，取决于 HK18 固件实际 `supportManualTestType`；连真机看日志确认。 |
| 离线 HR 回填 | 🟡 中 | `sdk-metric-gap.md` 指出的历史 HR 未拉回 bug（实时流有、按天归档缺），影响多日趋势完整性。 |

---

## 6. 速查：原生桥 `emitMetric` 全部 key（= 同步字段全集）

`hr / spo2 / temp / eda / hrv / rr / stress / fatigue / glucose / bloodSugar / cholesterol / bloodFat / uricAcid / ua / triglyceride / hdl / ldl / emotion / skin / cortisol / sns / depressionRisk / bpSys / bpDia / ppgSys / ppgDia / met / steps / calorie / distance`

映射到 `HSMetricKey` 见 `RingBleManager.ts` 的 `FIELD_MAP`（handleManualHealthGlance）与 `METRIC_MAP`（handleBatch）。
