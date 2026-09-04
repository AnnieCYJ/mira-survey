# Veepoo iOS SDK 指标 × App 展示缺口分析

> 数据源：本机 `ios/Frameworks/VeepooBleSDK.framework/Headers/VPHealthGlanceTestModel.h`、`VPPeripheralBaseManage.h`、`VPGSRResultModel.h`、`VPPeripheralModel.h` 头文件，以及 `ios/VeepooRing/VeepooRing.m` 实际 `emitMetric` 实现。
> 核对时间：2026-09-03

## ⚠️ 先更正：你的清单漏了 HealthGlance 的很多字段

你贴的 HealthGlance 字段是「简化版」。真实 `VPHealthGlanceTestModel.h` 里还有：

- **完整血脂四项**：`totalCholesterol`(总胆固醇) + `triglyceride`(甘油三酯) + `highDensityLipoprotein`(HDL) + `lowDensityLipoprotein`(LDL) —— 你只列了总胆固醇/尿酸，漏了 **甘油三酯、HDL、LDL**。
- **3 路血压**，不是 1 路：`systolicBloodPressure`/`diastolicBloodPressure`(基础光电) + `ppgBloodPressureHigh/Low`(PPG 细分) + `cuffBloodPressureHigh/Low`(气泵)。—— 你只写了 `h_bp/l_bp`。
- **身体成分 16 字段**：`bmi`、`bodyFatPercentage`(体脂率)、`fatMass`、`leanBodyMass`、`muscleRate`、`muscleMass`、`subcutaneousFat`(皮下脂肪)、`bodyMoisture`、`waterContent`(水分)、`skeletalMuscleRate`(骨骼肌率)、`boneMass`(骨量)、`proportionOfProtein`、`proteinAmount`、`basalMetabolicRate`(基础代谢率)、`weight`、`height`、`age`、`gender`。
- 其它子字段：`orgTemperature`(原始体温)、`bloodSugarType`、`bloodSugarLevel`(血糖类型/等级枚举)。

GSR 模型 `VPGSRResultModel` 也确认含：`emotion_level`(情绪)、`skin_moisture`(皮肤含水量)、`depression_risk`(抑郁风险)、`sns_activation`(交感神经活跃度)、`cortisol_value`(皮质醇)。

---

## 一、App 当前已展示 / 原生已 emit 的指标

**基础 5（BASIC_METRICS）**：`hr` 心率、`spo2` 血氧、`temp` 体温、`eda` 皮电、`hrv` 心率变异性

**扩展（EXTENDED_SIGNALS）**：`sleepTotal / sleepDeep / sleepRem / sleepScore`、`steps / distance / calorie`、`bloodSugar`(血糖)、`bloodFat`(总胆固醇)、`uricAcid`(尿酸)、`stress`(压力)、`fatigue`(疲劳度)、`emotion`(情绪)、`skin`(皮肤含水量)、`cortisol`(皮质醇)

**原生 `VeepooRing.m` 实际 `emitMetric` 的 key**：`hr / spo2 / temp / stress / fatigue / bloodSugar / bloodFat / uricAcid / emotion / skin / cortisol / eda / hrv`
（注：GSR 的 `sns_activation` 被直接并入 `stress` 显示，未单列；`depression_risk` 任何地方都没 emit。）

---

## 二、SDK 全量指标 × 是否展示（主表）

### A. 实时/单发测量（`veepooSDKTest*`）

| 指标 | SDK 接口 | App 展示？ | HK18 固件现实 | 建议 |
|---|---|---|---|---|
| 心率 HR | `TestHeartStart:` | ✅ `hr` | 实时连续 + **戒指按 5/10 分钟离线归档进原始数据 `heartValue`(VPDataBaseOperation.h:25/30/38/43/61/68)**；当前 backfill **未拉回 HR**，仅实时流 → 12-16 离线 HR 缺口是**真 bug**，应补 `readBasicDataWithDayNumber`/Running 回填 | 实时已接入，离线回填待补 |
| 血氧 SpO₂ | `TestOxygenStart:` | ✅ `spo2` | 实时 + 按天存档 | 已接入 |
| 血氧+心率合测 | `TestOxygenAndHeartStart:` | （已被上面两项覆盖） | — | — |
| 🫁 呼吸率 RR | `TestBreathingRateStart:` | ❌ 未展示 | 本固件返 `NoFunction=7`，**不可得** | 正确省略 |
| 🩸 光电血压 | `TestBloodStart:testMode:0` | ❌ 未展示 | 依赖 `isSupportBPTest`；HK18 实测返 0/未开放 | 需 flag 验证 |
| 🩸 气泵血压 | `TestBloodStart:testMode:1` | ❌ 未展示 | 需气囊硬件，HK18 无 | 不可得 |
| 😴 疲劳度 | `TestFatigueStart:` | ✅ `fatigue` | healthGlance 已出 | 已接入 |
| 📈 ECG | `TestECGStart:` | ✅ `ecg`（实时 + 离线）| **HK18 有 ECG 硬件**；设备离线 ECG 经 `veepooSDKGetDeviceOffStoreECGWithDate:` 按天存，已接 `backfillDayEcg` | 已接入 |
| ⚖️ 身体成分 | `TestBodyCompositionStart:` | ❌ 未展示 | 需体重/身高档案；模型含 16 字段 | 条件（需建档）|
| 🧪 血液分析 | `TestBloodAnalysisStart:` | ⚠️ **部分**：总胆固醇✅`bloodFat` / 尿酸✅`uricAcid`；**甘油三酯/HDL/LDL ❌** | 同 HealthGlance 血脂组 | 见 B |
| 🍬 血糖 | `TestBloodGlucoseStart:` | ✅ `bloodSugar` | healthGlance 已出 | 已接入 |
| ⚡ GSR 皮电 | `TestGSRStart:` | ⚠️ **部分**：`emotion`✅ / `skin`✅ / `cortisol`✅；**`depression_risk`❌ / `sns_activation`并入stress** | 见 B | 见 B |
| 📡 GSensor 原始 | `TestGSensorStart:` / `ADC` | ❌ 未展示 | 原始加速度，非用户指标 | 不展示 |

### B. HealthGlance 模型里「已解析但没 emit / 没展示」的字段

| 字段 | App 展示？ | 固件现实 | 建议 |
|---|---|---|---|
| `triglyceride` 甘油三酯 | ❌ | 同血脂组，无额外硬件 | **快赢：同 healthGlance 一并 emit** |
| `highDensityLipoprotein` HDL | ❌ | 同上 | **快赢** |
| `lowDensityLipoprotein` LDL | ❌ | 同上 | **快赢** |
| `depressionRisk` 抑郁风险 | ❌ | GSR 派生，模型已返回 | **快赢：原生 emit + 加卡片** |
| `snsActivation` 交感神经活跃度 | ⚠️ 已并入 `stress` | GSR 派生 | 可选：单列或保留并入 |
| `systolic/diastolic` 光电血压 | ❌ | 同 A5，flag 决定 | 条件 |
| `ppgBloodPressureHigh/Low` | ❌ | 光电血压细分 | 条件 |
| `cuffBloodPressureHigh/Low` 气泵 | ❌ | 硬件无 | 不可得 |
| `orgTemperature` 原始体温 | ❌ | 与 `bodyTemperature` 重复 | 可不展示 |
| `bloodSugarType/Level` | ❌ | 枚举子字段 | 可不单列 |
| 身体成分 16 字段（BMI/体脂率/肌肉量/水分/骨量/基础代谢率…）| ❌ | 需体重身高档案 | 条件（需建档）|

### C. 历史 / 按天读取接口

| 接口 | 用途 | 状态 |
|---|---|---|
| `StartReadDeviceAllData` | 一键全量同步 | ✅ 用 |
| `StartReadDeviceRunningData` | 步数/卡路里 | ✅ `steps` |
| `StartReadDeviceOxygenData` | 血氧历史 | ✅ |
| `StartReadDeviceHrvData` | HRV 历史（仅当日 dn=0）| ✅ |
| `StartReadDeviceTemperatureData` | 体温历史 | ✅ |
| `readStepDataWithDayNumber:` | 步数 | ✅ |
| `readSleepDataWithDayNumber:` | 睡眠段 | ✅ 睡眠 4 项 |
| `readBasicDataWithDayNumber:` | 核心 5/日 | ✅ |
| `readOxygenDataWithDayNumber:` | 血氧历史 | ✅ |
| `readHrvDataWithDayNumber:` | HRV（当日）| ✅ |
| `readRRIntervalDataWithDayNumber:` | RR 原始间期 | ✅ **离线存**（每分钟 1 块/天 1440 块，VPPeripheralBaseManage.h:974）；亦内嵌于 HRV 数据 `VPHRVHeartsKey`；用于离线 RMSSD/HRV，当前 `readRRIntervalDay` 已用 |
| `readDeviceAutoTestTemperatureDataWithDayNumber:` | 自动体温测试 | （temp 已覆盖）|
| `veepooSDKGetDeviceOffStoreECGWithDate:` | 设备离线 ECG（按天）| ✅ 已接 `backfillDayEcg` |
| `veepooSDKGetDeviceOffStoreBodyCompositionWithDate:` | 设备离线身体成分（按天）| ✅ 可接 |
| `veepooSDKGetDeviceBloodGlucoseDataWithDate:` | 设备离线血糖（按天）| ✅ 已接 |
| `veepooSDKGetDeviceBloodAnalysisDataWithDate:` | 设备离线血液成分（按天）| ✅ 已接 |

### D. Feature Flag（`VPPeripheralModel`）

| Flag | 含义 | 对 App 的影响 |
|---|---|---|
| `isSupportHRVTest` | 实时 HRV 测试（HK18=**false**）| 实时 HRV 不可用，HRV 走历史 |
| `isSupportBPTest` | 血压测试 | 决定光电血压是否可得 |
| `isSupportEmotionTest` | 情绪测试 | 情绪可得性 |
| `isSupportMetTest` | 新陈代谢 | 代谢可得性 |

---

## 三、结论：真正「固件里返回了、但 App 没展示」的快赢项

这 4 个和已展示的 `bloodSugar / bloodFat / uricAcid` 同属 HealthGlance 的「血脂 + 心理」组，**原生已经拿到整个 `VPHealthGlanceTestModel`，只是没 `emit` / 没定义卡片**：

1. **甘油三酯 `triglyceride`**
2. **高密度脂蛋白 HDL `highDensityLipoprotein`**
3. **低密度脂蛋白 LDL `lowDensityLipoprotein`**
4. **抑郁风险 `depressionRisk`**（GSR 派生）

> 风险低：只需在 `VeepooRing.m` 的 healthGlance 结果里补 4 行 `emitMetric` + 在 `EXTENDED_SIGNALS` 加 4 张卡片。连戒指即可验证 HK18 是否真正填充这些字段（血脂组与已工作的 `bloodSugar/totalCholesterol/uricAcid` 同源，大概率也填充）。

---

## 四、需要额外条件才能展示

| 指标 | 所需条件 |
|---|---|
| 光电血压（systolic/diastolic、ppg）| `isSupportBPTest == YES`：需原生 emit + 加卡片；HK18 大概率返 0 |
| 身体成分全套（BMI/体脂率/肌肉量/水分/骨量/基础代谢率…）| 用户在 App 录入**体重/身高档案**（模型这些字段依赖 profile）|
| 交感神经活跃度单列 | 可选，目前并入 `stress` |

---

## 五、不可得（当前正确省略）

- **呼吸率 RR（独立测量）**：`TestBreathingRateStart:` 固件返 `NoFunction=7`，且会掐断实时 HR/SpO₂，故不启用。但 RR 并非完全不可得：① RR 原始间期离线存于 `readRRIntervalDataWithDayNumber`（可由 RR 序列反算）；② 血氧数据内嵌 `RespirationRate`。仅「独立一次测量」这条路被封。
- **气泵血压**：无气囊硬件
- **GSensor 原始加速度**：原始数据，非用户指标（区别于 RR 间期——RR 间期是用户指标，已用于 HRV）
