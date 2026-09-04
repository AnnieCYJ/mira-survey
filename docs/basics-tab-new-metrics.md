# 基础指标 Tab 新增指标（2026-09-03）

把 SDK 健康一览（healthGlance）能返回、但之前没建卡/没 emit 的指标，全部补进「基础指标」tab，每个指标一张卡片；身体成分新增「录入档案」入口。

## 新增卡片（19 张，均在基础指标 tab）

**血脂 · 心理**
- 甘油三酯 `triglyceride`（mmol/L）
- 高密度脂蛋白 `hdl`（mmol/L）
- 低密度脂蛋白 `ldl`（mmol/L）
- 抑郁风险 `depressionRisk`（0/1/2）
- 交感神经活跃度 `snsActivation`（1–99，从原并入 stress 改为独立展示）

**光电血压**（依赖 `isSupportBPTest`，HK18 大概率返 0 → 显示"—"）
- 收缩压（光电）`bpSys`（mmHg）
- 舒张压（光电）`bpDia`（mmHg）

**身体成分**（需先在档案录入身高/体重/年龄/性别）
- BMI `bmi`、体脂率 `bodyFatPercentage`、脂肪量 `fatMass`、瘦体重 `leanBodyMass`、肌肉量 `muscleMass`、肌肉率 `muscleRate`、骨骼肌率 `skeletalMuscleRate`、皮下脂肪 `subcutaneousFat`、身体水分 `waterContent`、骨量 `boneMass`、蛋白质 `proteinAmount`、基础代谢率 `basalMetabolicRate`

## 数据链路（已打通）
1. 原生 `VeepooRing.m` 的 healthGlance 结果里新增 19 个 `emitMetric`（key 与 TS 完全一致），落到 `ring.daily[key]` / `ring.dailyHistory[key]`（经 `flushPendingMetrics`，与其他扩展信号同路）。
2. `metrics.ts` 新增 `BASICS_EXTRA_SIGNALS`，`signalsForDimension('basics')` 现返回 5 个实时核心 + 这 19 个；基础指标 tab 用「实时 vs daily」统一渲染，并加分组标题（血脂·心理 / 光电血压 / 身体成分）。
3. 身体成分档案：`RingBle.setUserInfo({weight,height,age,sex})` → 原生 `setUserInfo:weight:height:age:sex:` → `veepooSDKSynchronousPersonalInformationWithStature`，把档案下发戒指；连上即自动重发，本地快照持久化。档案录入后健康一览才会返回身体成分字段。

## 改动文件
- `src/data/metrics.ts`：新增 `BASICS_EXTRA_SIGNALS` + `section` 字段 + 改写 `signalsForDimension('basics')`
- `src/screens/InsightScreen.tsx`：基础指标 tab 统一渲染 + 分组标题 + `BodyProfileForm` 录入卡
- `src/ble/RingBleManager.ts`：`setUserInfo/getUserProfile` + 快照持久化 + 连接时重发档案
- `ios/VeepooRing/VeepooRing.m`：healthGlance 补 emit + 新增 `RCT_EXPORT_METHOD(setUserInfo:...)`

## ⚠️ 需要 ⌘R
`VeepooRing.m` 是原生改动，**必须 ⌘R 重新编译** TS 侧改动（卡片/表单）热更即生效，但 emit 与 `setUserInfo` 要等 ⌘R。

## 验证
⌘R 后戴稳连上，看 `/tmp/mira-logs/collector.log` 的
`[VeepooRing CB healthGlance] tg=… hdl=… ldl=… dep=… sns=… bp=…/… bmi=… fat=… bmr=…`
有非零值即说明补齐成功；身体成分需先填档案并让戒指测一次。所有未测/固件不支持的卡片诚实显示"—"，不造假。
