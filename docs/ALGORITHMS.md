# Mira App 算法白皮书

> 版本: 2026-09-22 | 全部算法在纯前端 TS 实现, 零后端依赖, 可离线运行

---

## 1. 数据来源 —— 戒指是真主力, App 做二次加工

### 1.1 戒指硬件
Veepoo / 真时科技 HK18 戒指, 搭载 PPG (HR/HRV/SpO₂/ppgSys/ppgDia)、GSR (EDA/skinMoisture)、皮肤温度、六轴 IMU, 通过 BLE 4.2 连手机。固件每 10s 采一帧, 逐拍心跳回调节流到 ~5Hz。原生 SDK 是 `VeepooBleSDK.framework` (iOS 预编译), 通过 ObjC 桥 `VeepooRing` → `RingBleManager` 暴露给 JS。

### 1.2 戒指原生 signalKey → App 处理程度 (三层)

#### 第 1 层: 戒指传原始传感器值 —— App 直接入库
这些是硬件直接采的, 没有固件合成:

| 原生 key | healthStore key | 单位 | 采样 | 用途 |
|---|---|---|---|---|
| `hr` | `hr` | bpm | 逐拍 | 运动负荷、压力参考 |
| `spo2` | `spo2` | % | ~1Hz | 夜间血氧、睡眠质量 |
| `temp` | `temp` | °C 皮肤 | ~1/30s | 节律、睡眠窗口、排卵双相体温 |
| `eda` (skinMoisture) | `eda` | μS | ~1/30s | SCR 事件、压力检测 |
| `rr` | `rr` | 次/min | 固件计算 | 呼吸率 |
| `steps` / `dist` / `cal` | `steps` / `distance` / `calorie` | 步 / km / kcal | 固件计步器 | 运动消耗 |

#### 第 2 层: 戒指传固件合成值 —— App 直接用或微调
这些是 Veepoo 固件在戒指 MCU 上实时算好的, 通过 backfill (5min slots) 和 realtime (单 metric 事件) 推送:

| 原生 key | healthStore key | 单位/范围 | 戒指固件怎么算 | App 怎么用 |
|---|---|---|---|---|
| **`hrv`** | `hrv` | ms (RMSSD) | 固件逐拍算, 5min 聚合均值 | **直接用**, `hrvCompute.ts` 只在实时逐拍心跳队列上额外再算一次作为秒级补充 (固件 backfill 粒度是 5min) |
| **`stress`** | `stress` | 0–12 整数等级 | 固件用 EDA + HRV 合成压力等级 | **App 在此基础上重加工**: Kalman 去噪 EDA 序列 → z-score 事件检测 → SCR 恢复时间 → valence 情绪方向分解 → 0-100 连续分 (固件只给等级, App 需要更细的数字 + 事件时间戳 + 情绪倾向) |
| `sns` / `snsActivation` | `sns` | 0–5 近似 | 固件 HRV 频域 + 唤醒度合成 | 情绪引擎 arousal 输入 |
| `met` | `met` | METs | 固件活动强度 | 运动算法 |
| `fatigue` | `fatigue` | 0–100 | 固件 HRV + 活动合成 | cognitiveLoad 的疲劳 baseline |
| `emotion` | `emotion` | 标签/分 | 固件 EDA+HRV 情绪分类 | emotionEngine 对比校验 |
| `cortisol` | `cortisol` | μg/L 代理 | 固件用 SNS + 昼夜模板合成, **非化验级**, UI 标注"压力代理" | **App 跑 cosinor 节律分析** (§4): MESOR/振幅/acrophase/CSS/节律状态 (固件不做节律拟合) |
| `ppgSys` / `ppgDia` | `ppgSys` / `ppgDia` | 相对值 | 固件 PPG 波形提取的收缩峰/舒张谷 | App 只做减法得 **VTI = ppgSys - ppgDia** → 认知负荷的血管收缩信号 |
| `bpSys` / `bpDia` | `bpSys` / `bpDia` | mmHg 估计 | 固件 BCG (心冲击图) 估计 | UI 展示, 非医疗级 |
| `glucose` / `bloodSugar` | `glucose` | mmol/L 估计 | 固件红外光谱估计 | UI 展示 |
| `cholesterol` / `triglyceride` / `hdl` / `ldl` / `uricAcid` | 对应 lipid/ua key | 估计 | 固件多模态估计 | UI 展示 |
| `skin` | `skin` | μS | 皮肤电导 (EDA 别名) | realSeries 读侧兼容 |

#### 第 3 层: App 完全自己算的派生指标
这些是以上两层原始/固件值进入 `healthStore` 后, 由 `lib/` 下的纯 TS 算法重新加工得到:

| 派生指标 | 源 metric | App 算法文件 |
|---|---|---|
| **VTI** | `ppgSys - ppgDia` | `cognitiveLoad.ts` |
| **压力分 0–100 / 事件 / SCR 恢复时间 / valence** | `eda` (序列), `hrv` | `stressAlgorithm.ts` |
| **皮质醇节律 (MESOR/振幅/CSS/节律状态)** | `cortisol` (代理) | `cortisolRhythm.ts` |
| **脑力值 / 专注力 / Process S+C / peak/trough** | `hrv`, `sns`, `eda`, `temp`, 睡眠, 节律 | `cognitiveLoad.ts` |
| **认知负荷实时事件** | `hrv`, `vti`, `eda`, `temp` | `cognitiveLoadDetector.ts` |
| **睡眠评分 (恢复)** | 睡眠分期 | `sleepScore.ts` |
| **睡眠负载 (债/不规律/碎片化)** | 睡眠分期 + 历史 | `sleepLoad.ts` |
| **周期相位 / 排卵窗口** | 经期记录 + `temp` 体温跳升 | `cycleMath.ts` |
| **emotionEngine (Valence/Arousal/5-class)** | `eda`, `hrv`, `sns` | `emotionEngine.ts` |
| **身体年龄 / 长期风险** | 多 metric | `ai/health.ts` |
| **节律/长期 AI 文案** | 多算法输出 | `ai/insight.ts` |

### 1.3 手机 (HealthKit / 步数传感器)
| Metric | 来源 | 用途 |
|---|---|---|
| `steps` (备选) | CMMotionManager 或 HealthKit | 戒指没戴/不同步时的 fallback, 优先级低于戒指 |
| `distance` / `calorie` (备选) | HealthKit | 同上 |

### 1.4 手工输入
- 经期记录 (→ `cycleMath`)
- 睡眠窗口 (`bedHour` / `wakeHour`, 可自动从 temp 夜间低谷拟合)

### 1.5 healthStore 数据管道
所有 metric 统一进入单例 `healthStore` (内存 + SQLite 持久化), 提供:
- `upsertRealtime(key, point, ts)` —— `RingBleManager.handleRealtime` 每收到一个原生事件就写一次, 触发 `scheduleRecompute(dayKey)` 去抖 500ms 重算派生指标
- `upsertBackfillSamples(key, dk, samples[])` —— backfill 读设备库的 5min slots 批量写历史
- `getDay(key, dayKey)` → 日聚合 (mean/min/max/samples/source)
- `getTimeRange(key, fromMs, toMs)` → 逐时间点序列 (10–480pts)
- `getMetricDailyMeans(key, nDays)` → 多日基线 (stress/cortisol 都用 14d 滚动)
- 版本号 `getVersion()` (BLE 推送时 +1, `stressAlgorithm` 的结果缓存 key 用, 同版本内重复调用直接命中)

---
## 1.6 协议 vs App 实现缺口 (2026-09-22 从 VeepooRing.m 源码实测)

### 1.6.1 协议 vs App 三向对照 (Veepoo UniApp SDK 完整协议原文)

戒指传数据有 **两个通道**,App 要两个都接:

**通道 A:日常数据(backfill)** — `veepooSendReadDailyDataManager`
戒指保存三天,每个 metric 有 5 个时间槽的值,一次回调全返回。这是 App 最常用的历史数据源。

**通道 B:实时单 metric(onRealtime)** — Veepoo SDK 自动推送
每收到新测量结果 SDK 就 emit `{metric, value, unit, ts}`。App 用来做秒级实时刷新和情绪/认知的实时检测。

#### 通道 A 日常数据 content 完整字段 (协议原文一字不差)

```
content:
├── step:
│     stepCount        步数
│     amountOfExercise 运动量(估算)
│     distance         距离 km
│     calorie          卡路里 kcal
│     wear             佩戴标志
├── sleepData: [6个睡眠状态]
├── pulseReat: [5个脉率]           ← 每槽一个,分时段
├── respirationRate: [5个呼吸率]    ← 协议有,App 的 rr 还在等固件支持
├── bloodPressure:
│     bloodPressureHigh  高压 mmHg
│     bloodPressureLow   低压 mmHg
├── HRVData: [5个HRV值]             ← 分时段的 RMSSD 或 HRV 值
├── bloodOxygen:
│     oxygens:[5]           血氧  (以第一位为准)
│     apneaResults          呼吸暂停次数 (付费)
│     cardiacLoads          心脏负荷 (付费)
├── sleepAmountActivity: [5]        ← 夜间活动量,算睡眠体动
├── sleepStatus: [25个]             ← 夜间睡眠状态,每格几分钟
├── bloodGlucose: 4.09 或 {bloodGlucose, level}   ← level: 1低 2中 3高风险
├── meiTuo: [值÷10 → METs]          ← ⛔ App METRIC_MAP 有,但 RingBleManager 没接!
├── pressure: [压力值]               ← ⛔ 协议有!RingBleManager 漏接
├── bloodLiquid:
│     cholesterol  总胆固醇
│     triacylglycerol  甘油三酯
│     highDensity  HDL
│     lowDensity   LDL
│     uricAcidVal  尿酸
├── bodyTemperature:
│     bodyTemperature      体温 °C
│     bodySurfaceTemperature  皮肤温度 °C   ← ⛔ App temp 可能只拿了一个!
└── reset: { time, reset }
```

#### 通道 B 精准睡眠 (独立接口,比 sleepLoad 聚合准得多!)

```
content:
├── fallAsleepTime:    "MM-DD-HH-MM"  ← ⭐ 真正入睡时间戳,比推算准 10 倍!
├── exitSleepTime:     "MM-DD-HH-MM"  ← ⭐ 真正起床时间戳!
├── sleepTotalTime / deepSleepTime / lightSleepTime / otherSleepTime (分钟)
├── sleepCurve: [0深睡,1浅睡,2REM,3失眠,4苏醒] 每分钟一格  ← ⭐ 画精准睡眠图
├── firstDeepSleepTime / nightTotalTime / nightDeepSleepMeanValue
├── insomniaScore / insomniaCount
├── nightScore / deepSleepScore / sleepEfficiencyScore / sleepTimeScore / sleepQuality
```

#### 通道 C 实时测量 (`veepooSendPressureTestManager` 等 type:58)

| 接口 | type | content | App 接了吗 |
|---|---|---|---|
| 压力测量 | 58 | `pressure: N` | ⚠️ 只接了 stress(0–12等级),漏掉 pressure 连续值 |
| PPG 原始数据(JH58) | 55 | `{ppgData:[每秒原始值], acceleration:{x[],y[],z[]}}` | ⛔ **如果 HK18 支持这个定制 → ppgSys/ppgDia 自算 + 三轴加速度** |
| 自动测量 B3 | 54 | `{p_fun_type_content: 0-8}` 0脉率/1血压/2血糖/3压力/4血氧/5体温/6散点/7HRV/8血液 | ⚠️ VeepooRing.m 有 handle,App 用 HealthGlance 覆盖了 |

#### 协议 vs App METRIC_MAP 完整对照

| 协议日常数据 content | VeepooRing.m emit | healthStore MetricKey | RingBleManager METRIC_MAP | App 算法层 | 状态 |
|---|---|---|---|---|---|
| `step.stepCount` | — | `steps` | ✅ `step→steps` | realSeries 运动 | ✅ 正常 |
| `step.distance` | — | `distance` | ✅ `dist→distance` | 运动 | ✅ 正常 |
| `step.calorie` | — | `calorie` | ✅ `cal→calorie` | 运动 | ✅ 正常 |
| `pulseReat[]` | `hr` | `hr` | ✅ `hr→hr` | 运动负荷 | ✅ 正常 |
| `respirationRate[]` | `rr` | `rr` | ✅ `rr→rr` | — | ⚠️ SDK NoFunction(7),等固件 |
| `bloodPressure.{High,Low}` | `bpSys`/`bpDia` | `bpSys`/`bpDia` | ✅ | UI 展示 | ✅ 正常 |
| `HRVData[]` | `hrv` | `hrv` | ✅ `hrv→hrv` | RMSSD 多日基线 | ✅ 正常 |
| `bloodOxygen.oxygens[]` | `spo2` | `spo2` | ✅ | 睡眠/夜间血氧 | ✅ 正常 |
| `bodyTemperature.bodyTemperature` | `temp` | `temp` | ✅ `temp→temp` | 节律/排卵 | ✅ 正常 |
| **`bodySurfaceTemperature`** | ❌ | ❌ | ❌ | ❌ | **⛔ 协议有,App 完全漏掉皮肤温度!** |
| **`meiTuo[]` (÷10=METs)** | ❌ | `met` | ✅ `met→met`(METRIC_MAP 有) | ❌ 没接 | **⛔ METRIC_MAP 有但 VeepooRing.m emitMetric 没发,日常数据里有但 RingBleManager backfill 漏映射** |
| **`pressure[]` (压力连续值)** | ❌ | `stress` | ✅ `stress→stress` | stressAlgorithm | **⚠️ 只接了固件 0–12 等级,协议有独立 pressure 数组没接** |
| `glucose` / `bloodGlucose` | `glucose` | `glucose` | ✅ | UI 展示 | ✅ 正常 |
| `bloodLiquid.cholesterol` | `cholesterol` | `cholesterol` | ✅ | UI | ✅ 正常 |
| `bloodLiquid.triacylglycerol` | `triglyceride` | `triglyceride` | ✅ | UI | ✅ 正常 |
| `bloodLiquid.highDensity` | `hdl` | `hdl` | ✅ | UI | ✅ 正常 |
| `bloodLiquid.lowDensity` | `ldl` | `ldl` | ✅ | UI | ✅ 正常 |
| `bloodLiquid.uricAcidVal` | `ua`/`uricAcid` | `ua` | ✅ | UI | ✅ 正常 |
| `depression` | `depression` | **❌ 没定义** | **❌ 没映射** | **❌** | **⛔ Veepoo emit 有,全链路漏接** |
| `skin` (=EDA) | `skin`/`eda` | `eda`/`skin` | ✅ | stressAlgorithm | ✅ 正常 |
| `cortisol` | `cortisol` | `cortisol` | ✅ | cortisolRhythm | ✅ 正常 |
| `sns` | `sns` | `sns` | ✅ | emotionEngine | ✅ 正常 |
| `emotion` | `emotion` | `emotion` | ✅ | emotionEngine | ✅ 正常 |
| `fatigue` | `fatigue` | `fatigue` | ✅ | cognitiveLoad | ✅ 正常 |
| **`ppgSys`/`ppgDia`** | **❌ 不存在** | **定义了** | **映射了** | stress/cognitiveLoad | **❌ 假指标!协议没给,永远 null** |

#### 协议有但 App 完全没接的 (硬缺口)

| # | 指标 | 协议位置 | 用途 | 修法 |
|---|---|---|---|---|
| **G1** | **三轴加速度 (x/y/z)** | JH58 PPG 原始数据接口(type:55)的 `acceleration` 字段 | **久坐/站立/活动等级/睡眠体动** | 确认 HK18 是否支持 JH58 定制 → 逆向/接 SDK 原生接口 |
| **G2** | **PPG 原始波形** | JH58 type:55 的 `ppgData[]`(每秒一组) | **自算 ppgSys/ppgDia/VTI → 补 VTI 假指标** | 同上 |
| **G3** | **bodySurfaceTemperature (皮肤温度)** | 日常数据 `bodyTemperature.bodySurfaceTemperature` | 睡眠监测更准,排卵检测辅助 | healthStore 加 `skinTemp` → 单独接收 |
| **G4** | **meiTuo METs** | 日常数据 `meiTuo[] ÷10` | 运动 × 恢复耦合 (§13.3 C4) | METRIC_MAP backfill 加 `meiTuo→met` 映射 |
| **G5** | **depression 抑郁风险** | VeepooRing.m emitMetric 有 | ai/health 长期风险 | healthStore 加 MetricKey + METRIC_MAP 加一行 |
| **G6** | **fallAsleepTime / exitSleepTime** | 精准睡眠接口(type:4) | circadian 节律分析替代 sleepLoad 推算 | sleepLoad 重写用精准时间戳 |
| **G7** | **pressure[] 压力连续值** | 日常数据 + 压力测量接口(type:58) | stressAlgorithm 用固件连续值替代/补充 EDA | RingBleManager backfill 补映射 |
| **G8** | **睡眠曲线** 每分钟一格 | 精准睡眠 `sleepCurve[]` | 画精准睡眠图 + sleepScore 结构偏离 | UI 和 sleepScore 用 |

#### 协议不存在但 App 写死的 (假指标,应改)

| 指标 | 现状 | 修法 |
|---|---|---|
| `ppgSys` / `ppgDia` | healthStore 定义了,METRIC_MAP 映射了,但 **Veepoo 协议完全没这个字段** → VTI 永远 null | stress/cognitiveLoad 里 VTI 改成 `RMSSD↓ + SNS↑ + EDA↑` 加权和作血管张力代理;长期等 G2 |


## 2. HRV 计算 — `lib/hrvCompute.ts`

### 为什么 App 自己还要算一次 (戒指已经给了 hrv)
Veepoo 固件 backfill 回的 `hrv` 是 **5min 聚合均值**, 粒度粗。App 在 `RingBleManager` 里维护一个实时心跳队列 `this.hrBeatQueue`, 每收到逐拍心跳事件就 append ts, 队列满后用本模块再算一次 RMSSD —— 得到 **秒级刷新的实时 HRV**, 用来做情绪引擎 arousal 的输入和认知负荷实时检测。

### 来源
纯时域标准算法, 教科书方法, 无外部依赖。

### 输入
`hrBeatQueue`: 最近 N 个逐拍心跳时间戳序列 (RingBleManager 实时心跳事件累积, ~5Hz)。

### 步骤
```
ts[] → RR[] = diff(ts) → 过滤异常 → 计算 RMSSD / SDNN / pNN50
```

**过滤规则**:
- RR < 300ms 或 > 2000ms → 丢弃 (对应 >200bpm 或 <30bpm)
- RR 比前后值突变 > 300ms → 丢弃 (误检)
- 有效 RR < 10 → 返回 null

**公式**:
```
RMSSD = sqrt( mean( (RR[i+1] - RR[i])² ) )     // 最常用, 副交感活性
SDNN  = std(RR)                                // 整体变异
pNN50 = count(|RR[i+1] - RR[i]| > 50ms) / N   // 迷走张力
```

### 输出
`{ rmssd, sdnn, pnn50 } | null`

---

## 3. 压力检测 — `lib/stressAlgorithm.ts`

### 戒指给了什么, App 加了什么
| 层 | 来源 | 内容 |
|---|---|---|
| 固件 | `stress` (0–12 整数等级) | 粗粒度压力等级, 只能说"压力大/小", 不能给连续分、事件时间戳、情绪方向 |
| 固件 | `eda` (μS 逐序列, 全天 ~480 点) | 原始 GSR 皮肤电导, App 用它做精细加工 |
| App | **本模块** | 基于 EDA 序列 → Kalman 去噪 → z-score 事件检测 → SCR 恢复时间 → valence 情绪方向分解 → **0–100 连续压力分 + 事件时间戳 + 情绪倾向** |

### 来源
- **Kalman 滤波**: [KalmanJS](https://github.com/wouterbulten/kalmanjs) (MIT, 1D Kalman) —— 给 EDA 序列去噪
- **归一化 GSR**: _Normalized GSR-Based Stress Detection Using ML_ (IJTA 2025, doi:10.1155/ijta/8828363) —— z-score 事件检测 + SCR 恢复时间
- **hrv-stress-wearable**: [Kaizer-1/hrv-stress-wearable](https://github.com/Kaizer-1/hrv-stress-wearable) (MIT)
- **Threat-Challenge**: 情绪方向判定 (高唤醒下 RMSSD 保持好 → 积极, RMSSD 塌缩 → 消极)

### 输入
- `eda[]`: **戒指传的** skinMoisture 序列, 全天 ~480 点 (healthStore 从原生 backfill/slots 和 realtime 合并)
- `hrv`: **戒指传的** RMSSD 日均值 + 昨天均值 (算 hrvTrend 加重压力分)
- `stress` (0–12): **戒指传的** 固件等级, 仅作 fallback (EDA 全为 0 时用)

### 步骤

**Step 1 — Kalman 去噪**:
```
KF(R=2, Q=0.1)   // R=测量噪声方差, Q=过程噪声方差
filtered[i] = KF.filter(eda[i])
```
R 大 → 更平滑; Q 大 → 更灵敏。2/0.1 是 wearable EDA 的经验值。

**Step 2 — 全天事件检测**:
```python
# 统一基线 (全天 mean/std)
all_mean, all_std = rollingStats(filtered)

# 事件条件
z = (filtered[i].v - all_mean) / all_std
if z >= 1.2 and t - lastEvent >= 8min:   # EVENT_Z_THRESHOLD=1.2, EVENT_MIN_GAP=8min
    severity = min(100, round(z * 30))
    events.append({ t, z, severity, level })
```

**Step 3 — 当前压力分 (30min 滑窗)**:
```python
# 只用最近 30min 的 mean/std 算 z
recent_mean, recent_std = rollingStats(filtered[now-30min : now])
eda_now = filtered[-1].v
z = (eda_now - recent_mean) / recent_std

score = clamp(40 + z * 15, 0, 100)
if hrvTrend == 'down' and z > 0.5:
    score += 10     # HRV 下降加重判断
```

**Step 4 — SCR 恢复时间 (事件级)**:
经典一阶衰减模型: 峰值后回到 `baseline + (peak - baseline) × 0.37` 的时间。0.37 = 1/e, 一阶指数衰减到 37% 高度的时间常数。

**Step 5 — HRV 趋势判断**:
```python
hrvTrend = (hrvToday - hrvYest) / hrvYest
> 10%  → 'up'
< -10% → 'down'
else   → 'stable'
```

### 输出
```typescript
StressReport {
  score, level, baseline, dailyStd, edaNow, slope, hrvNow, hrvTrend,
  events: StressEvent[],         // 全天压力事件
  hourBuckets: HourBucket[],     // 每小时事件分布
  emotionalLoad, loadConstructive, loadDestructive,
  avgRecoverySec, recoveryProlonged,
  valenceScore, valenceLabel, valenceReason,
}
```

### 缓存
同一 `(dayKey, healthStore 版本, 30s 窗)` 内重复调用直接命中, 避免重复跑 Kalman + 全天事件检测。TodayScreen / StressInsightCard / EnergyDetail / 情绪详情都在 render 里同步调用, BLE 推送带动重渲染 → 不缓存必卡。

---

## 4. 皮质醇节律 — `lib/cortisolRhythm.ts`

### 来源
- **Cosinor 余弦拟合**: [Mathias-Fuchs/CosinorPy](https://github.com/Mathias-Fuchs/CosinorPy)
- **CortSineScore (CSS)**: Anza et al. 2025, [simone-anza/CortSineScore](https://github.com/simone-anza/CortSineScore)
- **个人基线**: 14 天滚动 P25 / P75

### 输入
戒指固件合成的皮质醇代理值 `{ t, v }[]` (非化验级, UI 标注 "压力代理")

### 步骤

**Step 1 — Cosinor 拟合**:
```python
# 24h 周期余弦: y(t) = MESOR + AMP * cos(2π*(t - acrophase) / 24)
# 最小二乘解 mesor / amplitude / acrophase
# R² 衡量拟合优度
```

**Step 2 — CortSineScore**:
```python
# CSS 是对皮质醇曲线"是否接近理想昼夜模式"的评分
# 理想: 晨起高峰 → 日间下降 → 夜间低谷
CSS = f(mesor, amplitude, acrophase, r2)
```

**Step 3 — 节律状态判定**:
```python
highStreak = 连续天数 where 日均值 > 14天基线 P75
dysStreak  = 连续天数 where 曲线形态异常 (cosinor R² < 0.3 或振幅异常小)

todayLevel:
  sustained_high  if highStreak >= 2
  dysregulated    if dysStreak >= 2
  normal          otherwise
```

---

## 5. 认知负荷 & 脑力指标 — `lib/cognitiveLoad.ts`

### 来源
- **Wellby** (IEEE Trans Affective Computing 2026): 轻量化 wearable PPG 管道, AUC-ROC 91.6% stress / 85.84% fatigue
- **CogWatch** (HardwareX 2024): 开源认知负荷平台, 传感器权重 GSR 35-40% / HRV 30-35% / SkinTemp 15-20% / IMU 10-15%
- **ChatPPG 2026 review**: HF 功率 & LF/HF 比对认知负荷最敏感
- **ICFMR 2023 元分析**: 皮质醇日内节律曲线 → 认知表现窗口
- **NeuroPlay 2024**: RMSSD → cognitive reserve r=0.71
- **WHOOP Mental Readiness**: 节律 + 睡眠债 + HRV 融合

### VTI (血管收缩指数)
```python
VTI = ppgSys - ppgDia          # 戒指 PPG 收缩压峰 - 舒张压谷
# 认知负荷↑ → 血管收缩 → VTI↑
```
ppgSys/ppgDia 由固件从 PPG 波形提取, 皮肤接触度影响大, 过滤 `ppgSys - ppgDia < 5` 的无效值。

### circadianWeight (节律权重) — 核心函数
```python
# 两个正弦波叠加: 24h 晨起峰 + 12h 午后反弹
main           = 0.65 + 0.35 * sin(2π * (hour - 5) / 24)    # 峰在 8am
afternoon_bump = 0.08 * sin(2π * (hour - 14) / 12)           # 午后 4pm
weight = clamp(main + afternoon_bump, 0.3, 1.0)
# 8am ~0.95, 3pm ~0.55, 午夜 ~0.60 — 和 ICFMR 2023 元分析对齐
```

### 脑力值 (Mental Energy) — v2
```python
energy = 0.40 * sleepRecoveryFactor    # 40% 睡眠恢复 (0~1)
       + 0.35 * circadianWeight(hour)  # 35% 节律窗口
       + 0.15 * (1 - cumulativeLoad/100) # 15% 消耗剩余
       + 0.10 * clamp(hrvNow/hrvBaseline, 0.4, 1.6)  # 10% HRV 辅助
# × 100 → 0~100
```

### 当下专注力 (Focus) — v2
```python
focus = 0.45 * RMSSD_ratio             # 45% 迷走活性 (相对基线)
      + 0.30 * arousal_optimal        # 30% Yerkes-Dodson 唤醒度钟形
      + 0.15 * circadian_focus(hour)   # 15% 节律窗口
      + 0.10 * (1 - fatigue/100)       # 10% 疲劳抵消
# arousal_optimal: SNS_ratio ∈ [0.9, 1.3] → 最优, 偏离则下降
```
Yerkes-Dodson 定律: 最优唤醒度存在, 太低(无聊)和太高(焦虑)都差。

### Borbély 双过程模型 (Process S / Process C)
- **Process S (brainUsed)**: 从起床到现在线性累积 + 睡眠债加速
- **Process C (circadianEnergy)**: 当前时刻生物钟给的能量 (cosinor 曲线)
- **brainRemaining**: Process C 修正 Process S 后的剩余储备

---

## 6. 认知负荷事件检测 — `lib/cognitiveLoadDetector.ts`

### 来源
Wellby / CogWatch 的传感器权重配方, 融合 RMSSD↓ / VTI↑ / EDA↑ 三轴信号。

### 核心权重
| 信号 | 权重 | 生理依据 |
|---|---|---|
| RMSSD ↓ | 30-35% | 认知负荷抑制迷走 (Wellby 2026) |
| VTI ↑ | 25-30% | 血管收缩 (ChatPPG 2026) |
| EDA ↑ | 35-40% | GSR 密度 (CogWatch 2024) |
| SkinTemp ↑ | 10-15% | 疲劳积累 (CogWatch 2024) |

### 检测窗口
10min 滑窗, 逐窗计算综合 score, score > 阈值 → 事件。

### 输出
`CognitiveLoadEvent { t, score, triggers: { hrv, vti, eda, temp }, confidence }`

---

## 7. 睡眠评分 — `lib/sleepScore.ts`

### 定位
**恢复质量**: 回答 "这一晚睡得好不好"。与 sleepLoad (睡眠负债) 刻意不重叠 — 晚睡/不规律/结构偏离记在 sleepLoad。

### 三个维度
| 维度 | 权重 | 满分条件 | 扣分规则 |
|---|---|---|---|
| 时长 | 0.35 | 7.5h ~ 8.5h | <7.5h 线性衰减; >8.5h 线性轻扣 (下限 0.7) |
| 深睡 | 0.35 | ≥20% | 低于 20% 线性衰减, 不扣"过高"分 |
| 起夜 | 0.30 | 0 次 | 每 1 次扣 1/3 ≈ 10 分, 不是 0/1 悬崖 |

### 为什么 7.5–8.5h 满分区间
WHOOP/Oura 建议 7–9h, 但 9h+ 天然满分会导致 "睡够就满"。8.5h 起开始轻微扣分, 避免 9h 和 8h 都拿满分的 bug。

### 输出
0–100 分, 纯函数, healthStore 和 dailyStatus 都能安全引用。

---

## 8. 睡眠负载 — `lib/sleepLoad.ts`

### 定位
**累计欠账**: 睡眠债 + 就寝不规律 + 碎片化 + 结构偏离。权重参考 WHOOP / Apple watchOS 26 / Oura / Fitbit / Garmin 公开口径。

### Debt 算法 (v2 改进)
```python
needH = trimmed_median(全部历史睡眠时长).clamp(7, 9)   # 稳健基线, 抗连续熬夜拉低

# Borbély Process S 指数衰减, τ=5d (半衰期≈3.5d)
for day in days_back:
    gap = max(0, needH - effectiveH(day))            # 当日缺口
    debt += gap * exp(-days_ago / 5)                  # 连续衰减

# 超睡眠分段还债 (v1 完全不支持)
surplus = max(0, effectiveH - needH)
debt -= min(surplus, 0.5) * 1.0                      # 前 0.5h 100% 还
debt -= max(0, min(surplus-0.5, 1.0)) * 0.7          # 0.5–1.5h 70%
debt -= max(0, min(surplus-1.5, 1.5)) * 0.4          # 1.5–3h 40%
debt -= max(0, surplus-3.0) * 0.2                     # >3h 20% (过度补觉扰乱节律)

# effectiveH 质量加权
effectiveH = total_min * efficiency   # efficiency = total/(total+awake), 下限 0.65
```

### 其他维度
- **时机**: 就寝时间偏离个人窗口 → social jetlag 加分
- **碎片化**: 夜间清醒次数 + 时长
- **结构**: REM/Deep 比例偏离基线

---

## 9. 女性周期 — `lib/cycleMath.ts`

### 来源
- **Ogino-Knaus 日历法**: [arnowelzel/periodical](https://github.com/arnowelzel/periodical) (GPLv3, 485 commits, F-Droid)
- **Symptothermal BBT**: [com.drip](https://f-droid.org/en/packages/com.drip/) (Bloody Health Collective, GPLv3)
- **HRV × 雌二醇**: Frontiers in Endocrinology 2021, r ≈ 0.62

### 输入
- 上次经期开始日 + 周期长度 (默认 28)
- 可选: 历史经期记录 (≥3 段时启用 Periodical 均值法)
- 可选: 戒指皮肤体温序列 (symptothermal 双相体温跳升确认排卵)

### 相位推算
```python
cycleDay = (today - lastPeriodStart).days % cycleLength

if cycleDay < periodLength:
    phase = 'period'
elif cycleDay < cycleLength - lutealLength:
    phase = 'follicular'
    # 排卵窗口 ≈ cycleLength - lutealLength - 14 ± 2d
elif cycleDay < cycleLength:
    phase = 'luteal'

# 可选: 皮肤体温跳升检测 (symptothermal)
# 皮肤体温 < 核心体温, 双相幅度更小 → 阈值放宽
if tempJump_detected:
    ovulationDay = cycleDay_of_jump
    # 后续 luteal 长度用实测跳升校准
```

### 为什么只用日历法 + 体温跳升
戒指测不了雌激素/LH/相位, 只能测皮肤体温 (随孕酮波动、排卵后双相升高)。故相位 = 日历法基线 + 体温跳升确认 (若数据充足且可信)。

---

## 10. 情绪引擎 — `lib/emotionEngine.ts`

### 来源
Russell Circumplex 模型 (Valence × Arousal 二维空间)

### 核心
```python
# arousal: 唤醒度
scr_density = SCR peaks per min
sns_ratio   = sns_baseline / sns_now
arousal = 0.6 * scr_density_norm + 0.4 * sns_ratio_norm

# valence: 情绪方向 (Threat-Challenge 范式)
# 高唤醒下 RMSSD 保持好 → 积极 (challenge)
# 高唤醒下 RMSSD 塌缩 → 消极 (threat)
valence = RMSSD_preserved_under_arousal

# 5-class
# focused  = 高 arousal + 正 valence
# stressed = 高 arousal + 负 valence
# calm     = 低 arousal + 正 valence
# bored    = 低 arousal + 中性/负 valence
# depleted = 极低 arousal + 负 valence
```

---

## 11. AI 健康 / 洞察 — `src/ai/health.ts`, `src/ai/insight.ts`

### 定位
规则引擎 + 模板, 纯前端运行, 把算法数值翻译成 "人话"。

### health.ts 输出
- 身体年龄 (healthRing.ts)
- 长期风险等级 (心血管 / 代谢 / 睡眠 / 免疫)
- 改善建议

### insight.ts 输出
- 节律健康 AI (今日身体年龄 / 睡眠/生理/情绪&认知)
- 长期健康 AI (心血管 / 代谢 / 基础指标)

### 生成策略
```python
templates[condition_level][metric_type][urgency] → { title, body, suggestion }
```

---

## 12. 数据管道总览

```
Ring BLE (Veepoo)                    Phone Sensors          Manual Inputs
        │                                │                      │
        ├── hr / hrv (逐拍)              ├── steps             ├── period log
        ├── spo2 / temp (1/30s)          ├── distance          └── sleep window
        ├── eda / sns (1/30s)            └── calorie
        ├── ppgSys / ppgDia (每帧)
        └── cortisol / stress (固件)
                  │
                  ▼
          healthStore (内存 + SQLite, 版本号递增)
                  │
                  ├── hrvCompute.ts ────── RMSSD / SDNN / pNN50
                  ├── stressAlgorithm.ts ── 压力分 / 事件 / 恢复时间 / 情绪倾向
                  ├── cortisolRhythm.ts ─── MESOR / 振幅 / CSS / 节律状态
                  ├── cognitiveLoad.ts ──── 脑力值 / 专注力 / Process S+C / peak/trough
                  ├── cognitiveLoadDetector.ts ── 实时负荷事件
                  ├── sleepScore.ts ──────── 睡眠恢复质量
                  ├── sleepLoad.ts ───────── 睡眠债 / 不规律 / 碎片化
                  ├── cycleMath.ts ───────── 周期相位 / 排卵窗口
                  ├── emotionEngine.ts ───── Valence / Arousal / 5-class
                  ├── ai/health.ts ───────── 身体年龄 / 长期风险
                  └── ai/insight.ts ───────── 节律/长期 AI 文案
```

---

## 13. 还没实现的优化点

### 13.1 高优先级 (直接影响准确性)

| # | 方向 | 当前状态 | 改进 | 来源 |
|---|---|---|---|---|
| A1 | **PPG VTI 逐拍实时** | 固件均值, ~1Hz | 固件暴露原始 PPG → App 自算逐拍 VTI, 和 RMSSD 同频率 | ChatPPG 2026 |
| A2 | **EDA SCR-L 分解** | Kalman 后直接 z-score | 加连续 wave 检测, 每波独立算 recovery | [Ledalab](https://github.com/ledalab/ledalab) |
| A3 | **睡眠窗口自动拟合** | 需手动输入 | temp 夜间低谷 + HR 谷底自动定位就寝/起床 | Oura API 公开逻辑 |
| A4 | **周期预测 + HRV×雌二醇** | Ogino-Knaus + 体温跳升 | 卵泡期 HRV↑ / 黄体期 HRV↓ 辅助确认相位 | Frontiers in Endo 2021 r≈0.62 |
| A5 | **脑力 forecast 置信区间** | 只有 hourlyEnergy | bootstrap 给 peak/trough 加 95% CI | 经典时序预测 |

### 13.2 中优先级 (体验/可解释性)

| # | 方向 | 改进 |
|---|---|---|
| B1 | **可信度徽章** | 每张卡右上角 "高置信 / 中等 / 数据不足" — 基于 samples / 基线天数 / R² |
| B2 | **基线 EWMA + 异常值隔离** | stress 算法 baseline 固定 7d, 改成指数加权 + 3σ 隔离 |
| B3 | **Kalman R/Q 自适应** | 根据信号质量 valid_ratio 动态调 R=测量噪声方差 / Q=过程噪声方差 |
| B4 | **睡眠债务可视化** | 给 sleepLoad 加 "还债进度条", 今天补了多少 |
| B5 | **节律漂移检测** | 7 天 cosinor acrophase 位移 > 2h → 标注 "节律偏移", 归因 social jetlag / 经期 |
| B6 | **情绪 × 认知交互** | focused 状态下 VTI/RMSSD ratio 和 stressed 不同, 区分 "投入" vs "焦虑" |

### 13.3 低优先级 (研究/高级)

| # | 方向 | 改进 |
|---|---|---|
| C1 | **频域 HRV (LF/HF)** | 更长连续 RR 序列 (≥5min) → Welch PSD → LF/HF, 和时域 RMSSD 交叉验证 |
| C2 | **皮质醇代理校准** | 用户 3d saliva cortisol + 戒指 proxy → 线性回归校准表 |
| C3 | **认知高峰个体化** | circadianWeight 目前固定 sin 模板, 用用户 7d peakLoadSpan 反拟合个人曲线 |
| C4 | **运动 × 恢复耦合** | steps > 基线 150% → sleepLoad 次日 debt 阈值上调 (WHOOP 逻辑: 运动日需更多恢复) |
| C5 | **HRV 生物反馈** | 实时 RMSSD → 4-7-8 呼吸引导 → 降 stress score, 验证 Kalman + slope 响应速度 |

### 13.4 已知限制

| 限制 | 说明 |
|---|---|
| 皮质醇非化验级 | Veepoo 固件用 "交感 + 昼夜模板" 合成 proxy, 不是真实激素。UI 已标注 "压力代理" |
| 皮肤体温 ≠ 核心体温 | 戒指 temp 低 1–2°C, 双相体温跳升幅度小。symptothermal 阈值已放宽, 排卵检测置信度偏低 |
| HRV 连续 RR 要求 | BLE 中途断开 → RMSSD 跳变, < 10 有效 RR 时返回 null |
| EDA 基线 7d 太短 | 14d 更标准, 目前 stressAlgorithm baseline 易被短期波动拉偏 |
