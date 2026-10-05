# Mira App 算法与来源参考文档

> 适用项目：`mira-app`（Expo 51 + React Native 0.74，iOS，Veepoo HK18 戒指）
> 整理日期：2026-10-05
> 目的：把当前代码库中**所有核心算法模块**的方法与**引用的开源项目 / 文献**逐条归档，便于技术评审、合规自查与后续标定。

---

## 0. 设计前提与总原则

Mira 戒指（Veepoo HK18）**没有**任何分子级激素传感器（皮质醇、雌激素、孕酮均测不到）。因此本 App 的所有"激素/压力/认知"指标都是 **反推（inference / proxy）**，不是测量值。贯穿全部算法的四条铁律：

1. **相对个人基线，而非绝对达标分**：所有分数都是"相对你自己过去 14 天同时段"，`50 = 和平时一样`。这是 Oura / Garmin / HRV4Training 的共识做法。
2. **缺信号就返回 null，不编造**：某一窗口没有实测支撑，UI 留空，不靠拟合曲线填洞。
3. **方向有依据 ≠ 系数有依据**：文献能给"哪路信号该正相/反相"的生理学方向，但权重系数是"按文献强度 + 保守打折"的初始值，**真实标定必须走用户自报回归**（见 MEMORY 诚实度铁律）。
4. **不读主观情绪、不做诊断**：EDA / HRV 只能给"身体在紧绷"的生理唤醒程度，读不出"你为什么紧"，不构成医疗诊断。

---

## 1. 算法模块清单与来源

### A. 生理信号基础处理

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| HRV 计算 | `src/lib/hrvCompute.ts` | 从 RR 间期算 RMSSD | 过滤 RR 300–2000ms（>200bpm 或 <30bpm 视为异常丢弃），对有效 RR 算相邻差方均根 | 标准 HRV 时域指标（Task Force 1996 共识，业界通用，非单一文献） | ✅ 标准方法 |
| 卡尔曼平滑 | `src/lib/kalman-filter.ts`<br>`src/lib/stressAlgorithm.ts` | EDA/信号去噪 | 一维卡尔曼滤波 + 稳健基线 | **KalmanJS**（wouterbulten, MIT）；**Kalman-Normalized GSR**（2025, Wiley）；**cvxEDA**（Greco et al. 2016，EDA 分解为 tonic+phasic 金标准）；**Iglewicz & Hoaglin 1993** 修正 z-score（0.6745·(x−median)/MAD）；**Shaffer & Ginsberg 2017** HRV 综述 | ✅ 均为真实开源/经典方法 |

### B. 皮质醇 / HPA 轴

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| 皮质醇活性反推 | `src/lib/cortisolProxy.ts` | 多模态反推"皮质醇活性"（0–100，相对个人基线） | 每 30min 窗口对 6 路信号（HRV 反相 / EDA 正相 / 体温偏移 正相 / 静息心率 正相 / 活动 负相 / 睡眠结构 晨间基线）算"相对个人 14 天基线"的稳健 z（中位数 + MAD×1.4826），加权 `50+50·tanh(raw/2)` 压到 0–100；缺信号→null | **Garmin/Firstbeat**（HRV+呼吸+活动→0–100 压力分）；**Oura**（HRV+体温偏移+活动→Readiness）；**WHOOP**（HRV+RHR+呼吸+睡眠→"皮质醇模型"识模式不量化浓度）；Body Battery vs 晨起唾液皮质醇 **r=0.52**（n=127, 2024 Psychoneuroendocrinology）；**Nature Communications** SQC-SAS 汗液 aptamer 生物传感器（唯一真测方案）；2024 研究（夜间体温↑+HRV↓ 对应皮质醇失调）；Garmin 25 夜滚动加权基线 | ✅ 业界口径一致；数值为诚实公布的验证区间 |
| 皮质醇节律 | `src/lib/cortisolRhythm.ts` | 昼夜节律拟合 | Cosinor 余弦拟合 + CortSineScore | **CosinorPy**（Mathias-Fuchs，开源）；**CortSineScore / CSS**（Anza et al. 2025，开源） | ✅ 真实开源项目 |

### C. 心理压力 / 情绪压力

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| 心理压力量表 | `src/lib/psychologicalStressScale.ts` | 百分位→三档 | `score = 50+50·tanh(z/2)`；档位边界 **偏低 <38 / 适中 38–62 / 偏高 >62**（即 \|z\|≲0.5 个个人标准差） | **Garmin/Firstbeat** 借 0–100 数字形态（不抄其绝对阈值）；**Oura** 个性化区间（不设固定阈值）；**HRV4Training**（Marco Altini）最小 worthwhile change ≈ 0.5×个体间日 SD；**Plews** 正常范围 = 7 天滚动均值 ±0.5×间日 SD | ✅ 边界由 ±0.5 SD 代数精确换算（z=±0.5 ↔ 38/62），有学界共识支撑 |
| 情绪压力判定 | `src/lib/emotionalStress.ts` | 多信号互斥判定（数据异常 / 运动中 / 情绪压力） | 三态优先级；EDA 用个人基线 MAD 稳健 z 分档 | **Bosch et al. 2026-05**（arXiv:2605.15756，德国航空航天中心 DLR，19 人 2×3 被试内）；**MDPI Sensors 2026《Beyond EDA》**；**Vieluf 2019**（treadmill 后 30min 皮温/EDA 仍高） | ✅ 已 WebSearch 核实（见 MEMORY） |
| 压力特征工程 | `src/lib/stressFeatures.ts` | 6 特征降维 | 把开源 Luma 9 通道降维到戒指可算的分钟级派生值 | **Luma / kookmin 2026-capstone-18**（女性专用 9 通道模型）；**Montoya Peña et al. 2026**（Comput Methods Programs Biomed，WESAD 8 算法基准：6 特征达 95% 平衡准确率，"统计饱和点"）；**arXiv:2402.15513**（跨数据集泛化掉到 50–60%） | ✅ 文献真实；已注明"初始权重非标定系数" |
| 运动门控 | `src/lib/motionGate.ts` | 剔除运动伪迹 | L1 固件运动段 / L2 连续 MET+步数 / L3 心率残差；恢复期按 MET 强度分档 | **Jalil et al. 2008**（J Appl Physiol）；**Vieluf et al. 2019**（Front Physiol, 19 人 treadmill）；**Buchheit 2014**（Sports Med） | ✅ 文献真实 |

### D. 认知负荷 / 脑力准备度

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| 脑力账户 | `src/lib/cognitiveLoad.ts` | brainReserve / brainRemaining / 认知准备度 | 节律+睡眠驱动（85%）+ HRV 代理（15%）；晨起储备 + 当前剩余随用脑下降 | **Wellby (IEEE Trans Affective Computing 2026)**；**CogWatch (HardwareX 2024)**；**ChatPPG 2026**；**NeuroPlay 2024**；**WHOOP Daily Outlook**；**Borbély Process S**；**ICFMR 2023**；**Task 2023**；**JBDM 2023**；**AstroGuard (NASA) LOESS**；**IEEE 2026 Bi-LSTM**；**lex-fatigue (MIT)** | ⚠️ **部分引用待复核**：先前评估判定 Wellby / CogWatch / ChatPPG / NeuroPlay / Task 2023 / JBDM 2023 / ICFMR 2023 中若干"查无此文/张冠李戴"，需在合规前逐条核实或替换 |
| 认知负荷检测 | `src/lib/cognitiveLoadDetector.ts` | 实时负荷事件检测 | 规则融合 | **CogWear 数据集 (Pantopoulos 2023)**；**WHOOP** 实时负荷检测 | ⚠️ 同上，需复核 |

> 说明：认知准备度的**核心科学依据**（睡眠→次日认知）是可靠的——Lowe et al. 2017（61 项研究 meta，持续性注意 g=−0.409）、Wüst 2024（44 研究，只睡一晚即损害）。但 `cognitiveLoad.ts` 头部列出的若干"开源参考"文献需核实后再对外引用。

### E. 综合今日状态（恢复就绪度）/ 睡眠

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| **综合今日状态（恢复就绪度复合分）** | `src/lib/dailyStatus.ts` | 融合 HRV / RHR / 睡眠 / **体温** → 单一 0–100 恢复就绪度；晨间 S0 锚点 + 全天 v2 充电/消耗曲线 | 晨间 S0 = 四路「相对个人同相位基线」加权（**HRV 0.34 / RHR 0.21 / 睡眠 0.30 / 体温 0.15**，合计 1.0）；日内曲线 = Garmin Body Battery 式充电/消耗；展示分 0–100 = 自身历史百分位 | **Oura Readiness**（公开方法论 support.ouraring.com：复合分 = 9 贡献因子，身体压力支柱 = HRV 平衡 + 静息心率 + 皮肤体温偏离个人基线 + 恢复指数）；**Fitbit Daily Readiness** / **WHOOP Recovery**（HRV+RHR+睡眠，相对个人基线，WHOOP HRV 权重 ~40–50%）；**Garmin Body Battery / Training Readiness**（充电/消耗范式）；**Banister Fitness-Fatigue 1975 → CTL/ATL/TSB**（就绪度 = 体能−疲劳，多日维度，τ 体能≈42d / 疲劳≈7d）；**RESTQ-Sport (Kellmann)**（恢复-应激构念效度背书）；⚠️ 原始输入 HRV/RHR 有 ECG 验证（Oura Gen4 CCC 0.99），但**所有厂商复合分闭源、缺独立验证**（2026 综述）→ 只作个人趋势线，不宣称绝对真值 | ✅ 方法论对齐业界公开口径；🟡 文献群体基线 TBD-1 待替换；体温路为 **2026-10-05 新增**（对齐 Oura 体温压力信号） |
| 睡眠段充电模型 | `src/lib/dailyStatus.ts` | 睡眠段恢复度（不再无条件充到固定上限） | 按相位分桶基线（同相位个人→全局个人→文献群体）；冷启动用文献值 + ±1sd 映射 | 文献群体基线为**占位常量（TBD-1）**，注释标明"正式上线前应替换为已发表纵向研究数据" | ⚠️ 文献常量为占位，待替换 |
| 睡眠评分 | `src/lib/sleepScore.ts` | 睡眠分（时长/深睡/起夜 + 清醒效率） | 多维绝对达标分（v2 已加入清醒效率维度） | 通用睡眠分期与评分框架 | ◽ 通用框架，无单一强引用 |
| 睡眠基线 + 规律性 | `src/lib/sleepBaseline.ts` | 个人相对基线 + 规律性分 | 睡眠中点标准差；冷启动混合口径（≥5 天个人相对，<5 天绝对）；上限 96（100 罕见） | **Oura** 个人基线（"compared against your baseline"）；**Sleep Regularity Index**（中点 sd 标准法）；**Windred 2024 SLEEP**（UK Biobank n=60,977 死亡率五分位分组）；Oura "100s are designed to be rare" | ✅ 强依据 |
| 睡眠债 / 负荷 | `src/lib/sleepLoad.ts` | 睡眠债累积与清除 | SWA 清除曲线拟合 | **Borbély 1982 + Achermann 2004**（SWA 清除曲线）；**Arab 2024 meta**（social jetlag，就寝不规律） | ✅ 经典 + 近期 meta |
| 睡眠个性化 | `src/lib/sleepPersonalized.ts` | 个性化睡眠参数 | 复用基线逻辑 | 同 sleepBaseline | ✅ |

> **体温在 Mira 的双重角色（2026-10-05 厘清）：** 体温在代码库中被两路独立使用，目的相反，避免混淆：
> 1. **复合分里的身体应变信号**（`dailyStatus.ts`，见上表"综合今日状态"）：取「今日体温 **偏离相位专属基线** 多少」。相位基线已吸收黄体期孕酮升温，故残差偏离 ≈ 真实身体负担（生病/恢复差/应激），**不是**周期位置标记。对齐 Oura Readiness 的 body-stress 支柱。
> 2. **周期相位确认**（`cycleMath.ts` 的 `detectThermalShift`，见 F 节）：用 symptothermal 双相体温跳升 **确认排卵**、重切卵泡/黄体边界。这是独立的相位推断功能，详见 F 节。

### F. 周期 / 激素推断

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| 激素状态推断 | `src/lib/hormoneInference.ts` | 生理信号→激素状态 | 相关性强推断 | **Symptothermal Method**（Bloody Health Collective, GPLv3，BBT 双相体温）；**Frontiers in Endocrinology 2021**（HRV–雌二醇 r≈0.62）；**Oura Health whitepaper 2022**（RHR–黄体酮 r≈0.45）；**Sleep Medicine Reviews 2019**（睡眠–黄体酮负相关） | ✅ 均为真实发表/开源 |
| 周期派生指标 | `src/lib/cycleDerived.ts` | RHR/HRV 周期相位相关 | 相关性聚合 | 同上 + 1,004 名自然月经女性 meta（卵泡期→黄体期 HRV 显著下降） | ✅ |
| 激素趋势 | `src/lib/hormoneTrend.ts` | 雌激素/孕酮趋势 | meta 趋势 + 症状体温法 | 1,004 女性 meta；排卵后孕酮→BBT 抬升 0.3–0.5°C（symptothermal method）+ RHR 升高 | ✅ |
| 周期数学 | `src/lib/cycleMath.ts` | 经期/排卵期曲线 | 经典月经激素双峰模型 | 经典 menstrual hormone profile（雌激素双峰：排卵前主峰 + 黄体期次峰） | ✅ 经典模型 |
| **BBT 双相体温检测（排卵确认）** | `src/lib/cycleMath.ts` `detectThermalShift` | 皮肤体温双相跳升检测，确认排卵、重切卵泡/黄体边界 | 稳健版 symptothermal（按皮肤体温放宽）：基线=前 6 低温日均值；跳升=连续 ≥3 天 ≥ 基线 + 0.15 且第 3 天 ≥ 基线 + 0.10 形成清晰台阶；排卵日 ≈ 跳升首日 −1；**统一口径：阈值 0.15 / 最少 12 点 / 跨度 ≥16 天**；`computeCycle` 内信任条件：跳升排卵在日历估计 ±9 天内且已发生（≤今天）才覆盖日历法 | **Symptothermal Method**（drip., Bloody Health Collective, GPLv3, F-Droid）；戒指皮肤体温方差大、振幅偏小，阈值/天数按皮肤体温放宽（README 明示"更准的方法如测基础体温"） | ✅ 已实现并全线接线；**2026-10-05 统一各调用点阈值**（原 `hormoneInference.ts` 用 0.12/10/14，已对齐 `cycleMath` 默认 0.15/12/16，消除"是否排卵"分叉结论） |

> **相位推算诚实边界（与复合分同理）：** 相位主体按周期内位置推算（经期 > 排卵期窗口 > 黄体 > 卵泡），体温只在**数据充足且可信**时覆盖排卵日；数据不足（如刚佩戴几天）回退纯日历法（Ogino-Knaus），体温不生效。故"体温预测相位"实为"日历法打底 + 体温确认排卵"，非纯体温模型。

### G. 基线 / 标定基础设施

| 模块 | 文件 | 功能 | 方法 | 引用来源 | 验证状态 |
|------|------|------|------|----------|----------|
| 时间加权基线 | `src/lib/recencyBaseline.ts` | 14 天指数加权个人基线 | 半衰期 7 天的 EWMA | **Garmin** 25 夜滚动加权（clearcals 引官方）；**Oura HRV Balance**（近 2 周 vs 近 3 月，recent days 加权）；训练负荷监测 SOP（滚动窗口/EWMA） | ✅ 方法真实；**半衰期 7 天为产品决策，非文献给定值** |
| 自报校准 | `src/lib/selfReportCalibration.ts` | 用户自报回归标定 | r 判定门槛 | 标注为**产品决策，非文献结论** | ◽ 产品决策 |

### H. 科普内容知识库（非计算算法，但附文献出处）

以下模块是 App 内"知识科普/工具推荐"文案，不属计算算法，但其引用文献一并归档以备审查：

- `src/lib/learnArticles.ts`：Czeisler 1989 (Science，亮光重置节律)、Barth 2015 (Neurosci Biobehav Rev)、Majewska 1986 (Science，ALLO 是 GABA-A 调制剂)、Timby 2016 (Psychoneuroendocrinology)、Fries 2009 (CAR 综述)、Shilaih 2018 (Sci Rep)、Bull 2019 (npj Digit Med)、Maki 2015、Solomon 1982、Bisdee 1989、Shechter 2010、Yildirir 2002、Sato 1996、Balban 2023。
- `src/lib/sportArticles.ts`：Sims & Yeager 2016 (ROAR)、McNulty 2020 (Sports Med)、Riley 1999 (Pain)、Shultz 2010、Stachenfeld 2000、Armour 2019 (Cochrane)、Meeusen 2013、Lehmann 1998、Plews 2013、Buchheit 2014、Leibel 1995 (NEJM)、Rosenbaum 2010、Balban 2023、Spiegel 2004。
- `src/lib/emotionArticles.ts`：Seligman 2005 (Am Psychol，三件好事)、Lieberman 2007 (Psychol Sci)、Coan 2006、Balban 2023、Frattaroli 2006 (Psychol Bull)。
- `src/lib/nutritionArticles.ts`：Shukla 2015、DiPietro 2013、Pasricha 2021 (Lancet)、Hallberg 1989、Paddon-Jones 2008、Mamerow 2014、Bisdee 1989、Wastyk 2021 (Cell)、Cryan 2019。
- `src/lib/glowArticles.ts`：Sethi 2016、Flament 2013、Van Cauter 2000 (JAMA)、Chang 2015 (PNAS)、Danby 2010、Shukla 2015、Shah & Maibach 2001、Chiu 2003、Yosipovitch 2007、Mukherjee 2006、skin cycling (Whitney Bowe, 2022，非期刊)。
- `src/lib/toolRecommend.ts`：聚合上述可信文献作为每日工具推荐的出处标注（Balban 2023、Lieberman 2007、DiPietro 2013、Oosthuyse 2008、Pasricha 2021、Van Cauter 2000、Fries 2009、Shah & Maibach 2001、Seligman 2005、Yildirir 2002 等）。

---

## 2. 直接复用的开源代码库

| 项目 | 类型 / 协议 | 用途 | 链接 |
|------|------------|------|------|
| KalmanJS | MIT | EDA/信号卡尔曼平滑 | github.com/wouterbulten/kalmanjs |
| CosinorPy | 开源 | 余弦节律拟合 | github.com/Mathias-Fuchs/CosinorPy |
| CortSineScore (CSS) | 开源 | 皮质醇正弦评分 | github.com/simone-anza/CortSineScore |
| Symptothermal Method | GPLv3 | BBT 双相体温排卵识别 | Bloody Health Collective |
| Luma (kookmin 2026-capstone-18) | 学术 capstone | 女性专用 9 通道压力模型（降维参考） | — |
| hrv-stress-wearable | MIT | HRV 应激检测参考 | github.com/Kaizer-1/hrv-stress-wearable |
| lex-fatigue | MIT | 疲劳预测参考 | — |
| cvxEDA | 学术 | EDA tonic/phasic 分解金标准 | Greco et al. 2016 |

---

## 3. 引用文献总表（按出现频次 / 重要度）

**已核实可信（支撑核心算法）：**
- Oura Readiness 公开方法论（support.ouraring.com/hc/articles/360025589793 与 360057791533）— 复合分 = 9 贡献因子；身体压力支柱 = HRV 平衡 + 静息心率 + 皮肤体温偏离个人基线 + 恢复指数；体温偏离个人基线列为准备度核心压力信号
- Fitbit Daily Readiness（fitbit.com/global/uk/technology/daily-readiness-score）— HRV + RHR + 睡眠，相对个人 7 天基线
- WHOOP Recovery（whoop.com）— HRV(~40–50% 权重) + RHR(~25%) + 睡眠表现 + 睡眠规律性；个人 30–60 天基线
- Garmin Body Battery / Training Readiness（garmin.com）— 充电/消耗范式；Training Readiness 融合 HRV + 睡眠 + 恢复时间 + 训练负荷平衡 + 应激 + 急性疲劳
- Banister Fitness-Fatigue 模型 (Banister et al. 1975, Canad J Appl Sport Sci) → CTL/ATL/TSB — 就绪度 = 体能(τ≈42d) − 疲劳(τ≈7d)；现代训练负荷监测（TrainingPeaks PMC）的理论基石
- RESTQ-Sport (Kellmann & Kallus, 2001) — 经验证的恢复-应激心理量表（双轴 × 19 子量表），为客观复合分提供构念效度
- Psychoneuroendocrinology 2024 — Body Battery vs 晨起皮质醇 r=0.52（n=127）
- Windred 2024, SLEEP — UK Biobank n=60,977 睡眠规律性/死亡率分组
- Bosch et al. 2026, arXiv:2605.15756 (DLR) — 运动 vs 心理压力信号分解
- Montoya Peña et al. 2026, Comput Methods Programs Biomed — WESAD 6 特征饱和点
- Frontiers in Endocrinology 2021 — HRV–雌二醇 r≈0.62
- Oura Health whitepaper 2022 — RHR–黄体酮 r≈0.45
- Sleep Medicine Reviews 2019 — 睡眠–黄体酮
- Borbély 1982 / Achermann 2004 — 睡眠 SWA 模型
- Jalil 2008 / Vieluf 2019 / Buchheit 2014 — 运动后自主神经恢复
- Greco 2016 (cvxEDA) / Shaffer & Ginsberg 2017 / Iglewicz & Hoaglin 1993 — EDA/HRV 稳健统计
- Balban 2023 (Cell Reports Medicine) / Seligman 2005 / Lieberman 2007 — 情绪/呼吸/积极心理学（科普+工具）
- Majewska 1986 (Science) / Timby 2016 — ALLO–GABA 机制

**复合分诚实边界（2026 综述，aifithub.io / inspiredbysports.com）：**
- 原始输入（HRV、RHR）有 ECG 验证（Oura Gen4 CCC 0.99，WHOOP 0.94，Garmin 0.87），但 **WHOOP/Oura/Garmin 的复合分都是闭源、缺独立验证**；同一人不同设备读数可差 20+ 分（如 WHOOP 78% vs Garmin 42）——它们回答的是略不同的"就绪度"问题。
- 结论：复合分**只作个人趋势线**，不宣称跨设备/绝对生理真值；档位与百分比一律相对用户自身历史（与 Mira 品牌诚实边界一致）。

**存疑 / 待复核（集中在 `cognitiveLoad.ts` 头部引用）：**
- Wellby (IEEE TAFFC 2026)、CogWatch (HardwareX 2024)、ChatPPG 2026、NeuroPlay 2024、ICFMR 2023、Task 2023、JBDM 2023 —— 先前技术评估判定其中若干"查无此文 / 张冠李戴"，**对外引用前必须逐条核实或替换**。

**产品决策（非文献结论，已在代码注释标明）：**
- `recencyBaseline` 半衰期 7 天
- `psychologicalStressScale` 档位边界 38/62（虽由 ±0.5 SD 代数换算，但"取 ±0.5 SD 当明显偏离"是共识性产品选择）
- `sleepBaseline` 冷启动 5 天阈值、规律性分上限 96
- `selfReportCalibration` 判定门槛
- `dailyStatus` 文献群体基线为占位常量 TBD-1（待替换为真实发表数据）

---

## 4. 验证状态与风险小结

| 风险等级 | 内容 | 建议动作 |
|----------|------|----------|
| 🔴 高 | `cognitiveLoad.ts` / `cognitiveLoadDetector.ts` 头部若干开源文献引用存疑 | 合规/对外评审前逐条 WebSearch 核实，无法核实的删除或替换为真实可引用来源 |
| 🟡 中 | `dailyStatus.ts` 文献群体基线为占位常量（TBD-1） | 上线前替换为已发表纵向研究数据 |
| 🟢 低 | 各权重系数为"按文献强度 + 保守打折"的初始值 | 走用户自报回归标定（已在 MEMORY 诚实度铁律登记） |
| 🟢 低 | 产品决策类参数（半衰期、档位边界等） | 已在代码注释明确标注"非文献结论"，保留即可 |

---

## 5. 口径诚信边界（Mira 品牌铁律，务必保留在 UI 文案）

- 不称"皮质醇值"，称"皮质醇活性（相对个人基线）"；不称"激素值"，称"激素状态推断"。
- 所有分数 0–100 均"相对你自己平时"，50 = 和平时一样；UI 必须显式说明，避免被读成绝对值。
- EDA / HRV 给"身体在紧绷"的生理唤醒程度，**不读主观情绪、不做医疗诊断**。
- 缺信号→留空，不编造、不靠拟合曲线填洞。

---

*本文档由代码注释与文献引用自动归集整理，验证状态基于代码内声明与历史技术评估；标注"待复核"的条目需在正式对外披露前二次核实。*
