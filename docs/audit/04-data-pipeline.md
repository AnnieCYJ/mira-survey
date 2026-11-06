# 维度 4 · 数据链路与展示校验审查

> 审查对象：`/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`
> 审查范围：**只读**。本报告不修改任何 `src/` 下的文件，所有「建议修改后代码」均为**参考实现**，需由实现方落地。
> 审查链路：原生 BLE（`ios/VeepooRing/VeepooRing.m`）→ `src/ble/RingBleManager.ts`（RingState）→ `src/data/healthStore.ts` → UI（`src/screens/*`、`src/components/*`）

---

## 0. 审查结论速览

### 0.1 原生 `emitMetric` key 全量对照（审查项 1 的核心事实）

原生 `VeepooRing.m` 实际 `emitMetric` 的 key 共 **26 个**（`emitMetric` 定义于 `:191`）：

| 原生 key | 出现行号 | healthStore `ALL_METRIC_KEYS` | `metrics.ts` 展示别名 | 结论 |
|---|---|---|---|---|
| `hr` | 1549 / 1630 | ✅ `hr` | `hr` | 一致 |
| `spo2` | 1584 / 1629 | ✅ `spo2` | `spo2` | 一致 |
| `temp` | 1625 | ✅ `temp` | `temp` | 一致 |
| `skinTemp` | 1628 | ✅ `skinTemp` | `skinTemp` | 一致 |
| `eda` | 1705 | ✅ `eda` | `eda` | 一致 |
| `cortisol` | 1633 / 1706 | ✅ `cortisol` | `cortisol` | 一致 |
| `sns` | 1634 / 1707 | ✅ `sns` | `sns` | 一致（历史别名 `snsActivation` 已清理） |
| `emotion` | 1635 / 1708 | ✅ `emotion` | `emotion` | 一致 |
| `skin` | 1636 | ✅ `skin` | `skin` | 一致 |
| `fatigue` | 1637 | ✅ `fatigue` | `fatigue` | 一致 |
| `hrv` | 1638 / 1909 | ✅ `hrv` | `hrv` | 一致 |
| `stress` | 1639 | ✅ `stress` | `stress` | 一致 |
| `glucose` | 1640 | ✅ `glucose` | ⚠️ 展示层为 **`bloodSugar`** | **需桥接** |
| `glucoseType` | 1643 | ✅ `glucoseType` | — | 一致 |
| `glucoseLevel` | 1644 | ✅ `glucoseLevel` | — | 一致 |
| `bpSys` | 1648 / 1651 | ✅ `bpSys` | `bpSys` | 一致 |
| `bpDia` | 1649 / 1652 | ✅ `bpDia` | `bpDia` | 一致 |
| `ppgSys` | 1654 | ✅ `ppgSys` | `ppgSys` | 一致 |
| `ppgDia` | 1655 | ✅ `ppgDia` | `ppgDia` | 一致 |
| `depressionRisk` | 1658 / 1710 | ✅ `depressionRisk` | `depressionRisk` | 一致（历史上 `"depression"` 已修正） |
| `cholesterol` | 1661 | ✅ `cholesterol` | `cholesterol` | 一致（展示层另有别名 `bloodFat`） |
| `triglyceride` | 1662 | ✅ `triglyceride` | `triglyceride` | 一致 |
| `hdl` | 1663 | ✅ `hdl` | `hdl` | 一致 |
| `ldl` | 1664 | ✅ `ldl` | `ldl` | 一致 |
| `ua` | 1665 | ✅ `ua` | ⚠️ 展示层为 **`uricAcid`** | **需桥接** |

**结论：当前版本的 key 映射本身是完整的**（`depressionRisk` 已修正为正确形式，原生 26 个 key 全部落在 `ALL_METRIC_KEYS` 内，没有任何一个会被 `safeStore` 静默丢弃）。

但「映射表本身正确」**不等于**「映射链路安全」。本次审查发现的是**映射机制本身的结构性缺陷**（两份重复实现 + 一条绕过桥接的实时通路 + 一处 `v <= 0` 过滤与原生 `>= 0` 语义的正面冲突），详见 🔴-1 / 🔴-2 / 🔴-3。

### 0.2 五个重点排查项的结论

| 排查项 | 结论 | 对应问题 |
|---|---|---|
| 1. key 一一对应 | key 集合本身完整（原生 26 个 emit key 全部落在 `ALL_METRIC_KEYS` 内，`depressionRisk` 已修正，全仓无残留 `'depression'`）；但桥接层**双份重复实现**、实时通路**绕过桥接**、原生 `depressionRisk >= 0` 与 healthStore `v > 0` 过滤冲突、`daily` 读写 key 口径错位 | 🔴-1 / 🔴-2 / 🔴-3 / 🟡-6 / 🔵-3 / 🔵-5 |
| 2. null/NaN/极端值在图表层 | `finalize()` 未过滤 `Number.isFinite` → NaN 可直达 hero 数值与 y 轴刻度；`RangeBarsChart` 漏判 NaN → 画成基线柱；`AllDayBarsChart.yAt` **完全无 clamp** → 画穿坐标轴 | 🔴-4 / 🟡-1 / 🟡-2 / 🔵-2 |
| 3. 除零风险 | `NightBpCard.dipPct` 已有 `dayHr > 0` 保护，**除零本身不成立**；但负 dipPct 落入「基本没降」+ danger 色 → 语义误导 | 🟡-3 |
| 4. 数据竞争 | `mergeRealtime`（精确时刻覆盖）与 `mergeIntraday`（±60s 就近覆盖）语义不一致，交错写入会**丢样本**；11 个文件读 healthStore 却**未订阅版本号** → backfill 后不刷新 | 🟡-4 / 🟡-5 |
| 5. 快照恢复 | `serialize()` 字段齐全，`loadV2()` 整体替换 store → `derivedDays`/`manualMeasurements` 会随快照恢复（**核心结论：回放完整**）。遗留：`loadV2` 对**旧快照缺失字段**的兜底不完整；`getIntraday` 返回内部引用，破坏「已按 t 升序」的隐式契约 | 🔵-4 / 🔵-6 |

---

## 🔴 Critical

### 🔴-1 两份 `hsKeyFor` 映射表重复实现且已产生分歧 —— 下一个 key 不一致事故的温床

**文件**：`src/ble/RingBleManager.ts:152-181`、`src/lib/realSeries.ts:51-73`

**代码片段**（`RingBleManager.ts`）：

```ts
function hsKeyFor(signalKey: string): HSMetricKey | null {
  switch (signalKey) {
    case 'hr': case 'spo2': case 'temp': case 'skinTemp': case 'eda': case 'hrv': case 'rr':
    case 'steps': case 'distance': case 'calorie':
    case 'stress': case 'fatigue': case 'met': case 'cortisol': case 'emotion': case 'skin':
    case 'bpSys': case 'bpDia':
    case 'sns':
      return signalKey as HSMetricKey;
    case 'snsActivation': return 'sns';
    case 'bloodSugar': return 'glucose';
    ...
    case 'glucoseType': case 'glucoseLevel': case 'depressionRisk':
    case 'ppgSys': case 'ppgDia':
      return signalKey as HSMetricKey;
    default:
      return signalKey as HSMetricKey; // 未知/未映射指标不要硬 cast，避免 healthStore 里 store 未定义崩溃
  }
}
```

**代码片段**（`realSeries.ts`）：

```ts
/** 把展示/信号 key 映射到 healthStore 的规范 MetricKey（与 RingBleManager.hsKeyFor 保持一致）。 */
function hsKeyFor(signalKey: string): HSMetricKey {
  switch (signalKey) {
    ...
    case 'bloodSugar': return 'glucose';
    case 'bloodFat': return 'cholesterol';
    case 'triglyceride': return 'triglyceride';
    case 'hdl': return 'hdl';
    case 'ldl': return 'ldl';
    case 'uricAcid': return 'ua';
    default: return signalKey as HSMetricKey;
  }
}
```

**问题**：

1. 两处 `hsKeyFor` 是**两份独立维护的复制粘贴**。注释写着「与 `RingBleManager.hsKeyFor` 保持一致」，但实际已经不一致：
   - `realSeries.ts` 版本**没有** `glucoseType` / `glucoseLevel` / `depressionRisk` / `ppgSys` / `ppgDia` 的显式 case；
   - 目前它们之所以「能用」，纯粹是因为 `default` 分支 `return signalKey as HSMetricKey` **恰好同名返回**，属于巧合而非设计。
2. 两者的 `default` 分支都是**无条件 cast**。这意味着 `hsKeyFor('depression')` 会返回 `'depression' as HSMetricKey` —— 一个**根本不存在于 `ALL_METRIC_KEYS` 的 key**。而 `healthStore.safeStore(key)` 返回 `this.stores[key] ?? null`，于是 `upsertRealtime` 在 `:403` 静默 `return`，**数据被丢弃且不产生任何日志**。这正是团队背景中提到的「key 不一致被 TS 静默丢弃」的**结构性根因**：`as any` / `as HSMetricKey` 把编译期检查变成了谎言。
3. `RingBleManager.ts` 版本的返回类型是 `HSMetricKey | null`，但 `default` 分支**永远不返回 null** —— 类型签名与实现不符，调用方的 `if (hk)` 判空（如 `:3932`、`:4038`）形同虚设。

**建议的修改后代码**（新建唯一实现 `src/data/metricKeyMap.ts`，两处改为引用）：

```ts
// src/data/metricKeyMap.ts —— 【唯一真相源】展示层/信号层 key ↔ healthStore 规范 MetricKey
import type { MetricKey } from './healthStore';

export type HSMetricKey = MetricKey;

/**
 * 显式映射表。**只写需要转换的别名**；规范 key 走 IDENTITY 快速路径。
 * 新增原生 key 时：① 在此处登记 ② 在 ALL_METRIC_KEYS 登记 ③ 在 metrics.ts 登记展示定义。
 * 三处缺一不可——本文件是「不静默丢弃」的唯一闸门。
 */
const ALIAS_TO_HS: Readonly<Record<string, HSMetricKey>> = Object.freeze({
  // ── 展示层历史别名 → 数据层规范 key ──
  bloodSugar: 'glucose',   // 血糖
  uricAcid: 'ua',          // 尿酸
  bloodFat: 'cholesterol', // 总胆固醇（旧别名）
  snsActivation: 'sns',    // 交感神经（旧别名）
  // ── 数据层规范 key（显式登记，便于 IDE 补全与检索）──
  hr: 'hr', hrv: 'hrv', spo2: 'spo2', temp: 'temp', skinTemp: 'skinTemp',
  eda: 'eda', rr: 'rr', steps: 'steps', distance: 'distance', calorie: 'calorie',
  stress: 'stress', fatigue: 'fatigue', sns: 'sns', met: 'met',
  bpSys: 'bpSys', bpDia: 'bpDia', ppgSys: 'ppgSys', ppgDia: 'ppgDia',
  glucose: 'glucose', glucoseType: 'glucoseType', glucoseLevel: 'glucoseLevel',
  ua: 'ua', lipid: 'lipid', skin: 'skin', emotion: 'emotion', cortisol: 'cortisol',
  triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl', cholesterol: 'cholesterol',
  depressionRisk: 'depressionRisk',
});

/** healthStore 已注册的规范 key 全集（与 healthStore.ALL_METRIC_KEYS 同源，避免再写一份）。 */
let REGISTERED: ReadonlySet<string> | null = null;
function registered(): ReadonlySet<string> {
  if (!REGISTERED) {
    // 延迟 require，避免 metricKeyMap ↔ healthStore 的循环 import
    const hs = require('./healthStore') as { ALL_METRIC_KEYS: MetricKey[] };
    REGISTERED = new Set<string>(hs.ALL_METRIC_KEYS);
  }
  return REGISTERED;
}

/**
 * 把展示/信号 key 映射到 healthStore 规范 MetricKey。
 * **未知 key 返回 null**（而不是 `as HSMetricKey` 硬 cast）——这是「静默丢弃」事故的总闸门。
 */
export function hsKeyFor(signalKey: string): HSMetricKey | null {
  if (!signalKey) return null;
  const mapped = ALIAS_TO_HS[signalKey];
  if (mapped) return mapped;
  // 未登记的 key：只有在它本身就是已注册的规范 key 时才放行，否则明确拒绝
  return registered().has(signalKey) ? (signalKey as HSMetricKey) : null;
}

/** 调试用：列出所有「展示层 key → 数据层 key」的映射（供一致性自检脚本使用）。 */
export function dumpKeyMap(): Record<string, string> {
  return { ...ALIAS_TO_HS };
}
```

**配套改动**：

- `src/ble/RingBleManager.ts` —— 删除本地 `hsKeyFor`（`:152-181`），改为：
  ```ts
  import { hsKeyFor } from '../data/metricKeyMap';
  ```
  并把 `:3932` 的 `if (hk)` 判空保持有效（现在真的可能为 null）。
- `src/lib/realSeries.ts` —— 删除本地 `hsKeyFor`（`:51-73`），改为：
  ```ts
  import { hsKeyFor } from '../data/metricKeyMap';
  ```
  注意：`realSeries.ts` 的 `hsKeyFor` 返回类型原本是 `HSMetricKey`（非空），调用点 `:381`（`getTodaySeries`）、`:129`（`dailyValueFor`）、`:544`（`buildHistorySeries`）需要补 null 处理：
  ```ts
  export function getTodaySeries(metricKey: string): TimePt[] {
    const hsKey = hsKeyFor(metricKey);
    if (!hsKey) return [];   // 未知 key → 明确返回空，不再悄悄读一个不存在的 store
    const start = dayStartMs(Date.now());
    const end = Date.now();
    return healthStore.getTimeRange(hsKey, start, end, { fillDailyMean: true, maxPoints: 480 });
  }
  ```
  ```ts
  function dailyValueFor(key: string, dk: string): number | null {
    const sk = signalKeyFor(key);
    if (sk === 'steps') {
      const val = healthStore.getDay('steps', dk)?.mean ?? null;
      return val;
    }
    if (sk === 'sleepTotal') return healthStore.getSleep(dk)?.total ?? null;
    if (sk === 'sleepDeep') return healthStore.getSleep(dk)?.deep ?? null;
    if (sk === 'sleepRem') return healthStore.getSleep(dk)?.rem ?? null;
    if (sk === 'sleepScore') return healthStore.getSleep(dk)?.score ?? null;
    const hsKey = hsKeyFor(key);
    if (!hsKey) return null;   // ← 新增：未知 key 不再 fallback 到 getDay
    ...
  }
  ```

- **建议补一条自检**（可放 `scripts/check-metric-keys.ts` 或 CI）：扫描 `ios/VeepooRing/VeepooRing.m` 中所有 `emitMetric:@"xxx"`，与 `ALL_METRIC_KEYS` 比对，缺失即失败。这能从根上杜绝「原生加了 key 但 JS 侧没接」。

---

### 🔴-2 `handleRealtime` 实时通路完全绕过 `hsKeyFor` —— 原生一旦改用别名即静默丢数据

**文件**：`src/ble/RingBleManager.ts:978-1007`（关键行 `:991`）

**代码片段**：

```ts
  private handleRealtime = (raw: any) => {
    if (!raw) return;
    const metric = String(raw.metric ?? raw.key ?? '');
    const value = num(raw.value);
    const ts = num(raw.ts) ?? Date.now();
    if (!metric || value == null || !Number.isFinite(value)) return;
    ...
    try {
      healthStore.upsertRealtime(metric as any, { t: ts, v: value }, ts);   // ← :991 直接用原生 key
      scheduleRecompute(dayKey(ts));
      ...
    } catch { /* 单个 metric 落库失败不中断 */ }
    ...
  };
```

**问题**：

1. `:991` 直接把原生 key 当作 healthStore key 写入，**没有经过 `hsKeyFor`**。当前原生 emit 的 26 个 key 恰好全部等于规范 key，所以暂时没出事 —— 但这是**巧合**，不是保障。
2. `:991` 用了 `metric as any`，**编译期完全无法校验**。原生一旦把 `emitMetric:@"glucose"` 改成 `emitMetric:@"bloodSugar"`（或任何别名），`upsertRealtime` 会在 `healthStore.ts:403` 的 `if (!store) return;` 处**静默丢弃**，且 `catch {}` 块还会吞掉一切异常，**日志里什么都看不到**。这与 🔴-1 是同一个事故的两半：一个是映射表不唯一，一个是实时通路不经过映射表。
3. 同一函数 `:1006` 的 `this.pushMetric({ key: metric as any, ... })` 也直接用原生 key。`RingState.metrics` 的类型是 `RingMetrics`（`:264-271`），只有 `hr/spo2/temp/eda/hrv/rr` 六个字段 —— 扩展指标塞进去是**运行时多出来的属性**，TS 无感知。

**建议的修改后代码**（`src/ble/RingBleManager.ts:978-1007` 整体替换）：

```ts
  /**
   * V2 handleRealtime：原生 onRealtime 事件 → healthStore.upsertRealtime
   * 原生 emit body: { metric: "hr", value: 72, unit: "bpm", ts: epochMs }
   *
   * ★ 2026-11-06（审计 4-2）：**必须经 hsKeyFor 桥接后再写库**。
   *   原实现直接 `upsertRealtime(metric as any, ...)`：原生一旦改用别名 key
   *   （如 glucose → bloodSugar），healthStore.safeStore 返回 null → 数据静默丢弃且无日志。
   *   这里统一走唯一映射表，未知 key 明确打日志并跳过（可观测，而非静默）。
   */
  private handleRealtime = (raw: any) => {
    if (!raw) return;
    const nativeKey = String(raw.metric ?? raw.key ?? '');
    const value = num(raw.value);
    const ts = num(raw.ts) ?? Date.now();
    if (!nativeKey || value == null || !Number.isFinite(value)) return;

    // ★ 桥接：原生 key → healthStore 规范 key
    const hk = hsKeyFor(nativeKey);
    if (!hk) {
      postLog('HR-REALTIME', ` ⚠️ 未知原生 metric key="${nativeKey}"，已跳过（请在 metricKeyMap.ts 登记）`);
      return;
    }
    // ★ 带符号指标：emotion 值域 [-10,10] 含负数，0/负是有效值，不能按占位符丢弃
    const signed = SIGNED_REALTIME_KEYS.has(hk);

    // 节流计数（旧 handleMetric 的诊断逻辑保留）
    this.jsMetricCount++;
    this.jsMetricKeys[nativeKey] = (this.jsMetricKeys[nativeKey] ?? 0) + 1;

    // V2 简化：直接写 healthStore + pushMetric + 更新 RingState.metrics
    try {
      healthStore.upsertRealtime(hk, { t: ts, v: value }, ts);
      // ★ 触发派生指标重算（去抖 500ms，同一 dayKey 多次写入合并一次）
      scheduleRecompute(dayKey(ts));
      // ★ 诊断日志：关键指标到了没
      if (['cortisol','sns','emotion','skin','fatigue','hrv','stress','cholesterol','triglyceride','hdl','ldl','ua','glucose','temp','skinTemp','bpSys','bpDia','ppgSys','ppgDia','glucoseType','glucoseLevel','depressionRisk'].includes(nativeKey)) {
        const _dk = dayKey(ts);
        postLog('HR-REALTIME', ` ✅ ${nativeKey}=${value} ${raw.unit||''} at ${new Date(ts).toLocaleTimeString()} dk=${_dk}`);
        try { postLog('HS-INT', ` ${hk} intraday[${_dk}]=${healthStore.getIntraday(hk, _dk).length} samples`); } catch {}
      }
    } catch (e) {
      postLog('HR-REALTIME', ` ⚠️ 写入 healthStore 失败 key=${hk}: ${e instanceof Error ? e.message : e}`);
    }

    // 同时走旧的 pushMetric（RingState.metrics 实时更新 + 情绪曲线依赖）
    this.pushMetric({ key: nativeKey as any, value, unit: raw.unit ?? '', ts });
  };
```

配套新增常量（放在 `RingBleManager.ts` 顶部 `SIGNED_HKEYS` 附近，与 `src/ble/RingBleManager.ts:1072` 的 `SIGNED_HKEYS` 保持同一份语义）：

```ts
/** 带符号指标（值域含负数，0/负是有效测量而非占位符）。与 healthStore.SIGNED_METRICS 同源。 */
const SIGNED_REALTIME_KEYS = new Set<string>(['emotion']);
```

---

### 🔴-3 `recomputeDaily` 的 `v > 0` 过滤与原生 `depressionRisk >= 0` 正面冲突 —— 抑郁风险日聚合恒为空

**文件**：`src/data/healthStore.ts:287-315`（关键行 `:295`）、`ios/VeepooRing/VeepooRing.m:1658` / `:1710`

**代码片段**（`healthStore.ts`）：

```ts
const SIGNED_METRICS = new Set<string>(['emotion']);

function recomputeDaily(
  intraday: TimePoint[],
  prevDaily: DayMetric | undefined,
  source: Source,
  key?: string,
): DayMetric {
  // ★ 生理指标 0/负数=原生 SDK 占位符（无测量）；emotion 等带符号指标例外，0/负是有效值。
  const signed = key ? SIGNED_METRICS.has(key) : false;
  const clean = intraday.filter((p) => Number.isFinite(p.v) && (signed || p.v > 0));
  ...
}
```

**代码片段**（`VeepooRing.m`）：

```objc
if (model.depressionRisk >= 0)    [sself2 emitMetric:@"depressionRisk" value:(double)model.depressionRisk unit:@""];
...
if (model.depression_risk >= 0)  [sself2 emitMetric:@"depressionRisk" value:(double)model.depression_risk unit:@""];
```

**问题**：

- 原生对 `depressionRisk` 的判定是 **`>= 0`**（`:1658`、`:1710`）—— 与 `emotion` 的 `!= 0`、其余指标的 `> 0` 都不同。这说明**协议侧明确认为 `depressionRisk = 0` 是一个有效读数**（`metrics.ts:371` 定义其量程为 `0 正常 · 1 轻度 · 2 重度`，`yMin: 0, yMax: 2`）。
- 但 `recomputeDaily` 只对 `SIGNED_METRICS`（仅 `emotion`）豁免 `v > 0` 过滤，其余一律 `p.v > 0`。
- 结果：**`depressionRisk` 的 `0` 值样本被 `recomputeDaily` 全部丢弃** → 该日 `daily.mean/min/max/last` 全为 `null`。
- 更糟的是这一路**在写入前就被切断了**：`RingBleManager.ts:1073-1087` 的 `extract()` 里 `if (!signed && v <= 0) continue;` —— `SIGNED_HKEYS = new Set(['emotion'])`（`:1072`）同样不含 `depressionRisk`。所以原生回传的 `depressionRisk: 0` **根本进不了 healthStore 的 intraday**。
- 净效果：**「抑郁风险 = 0（正常）」这一最常见、最有意义的读数，在数据层被完整丢弃**，指标卡永远显示「—」或空曲线。

> 补充：`depressionRisk` 是**等级型**指标（0/1/2），它与 `emotion` 不同 —— 它不是「可负值」，而是「**0 是合法档位**」。用 `SIGNED_METRICS` 表达它是错的语义，需要一个独立的「零值有效」集合。

**建议的修改后代码**（`src/data/healthStore.ts:280-315` 整体替换）：

```ts
/**
 * ★ 带符号指标：值域本身含负数，0/负数是有效测量值（不是原生 SDK 占位符）。
 *   - emotion：戒指原生情绪等级 [-10, 10]，负值=消极/低落，必须保留；否则情绪点阵与
 *     日均值只会看到「开心/兴奋」，丢光压力/难过（见 2026-10-12 修复）。
 */
const SIGNED_METRICS = new Set<string>(['emotion']);

/**
 * ★ 2026-11-06（审计 4-3）：**零值有效**指标 —— 0 是合法档位，不是「无测量」占位符。
 *   原生 VeepooRing.m:1658 / :1710 对 depressionRisk 的判定是 `>= 0`（而非其余指标的 `> 0`），
 *   协议侧明确认为 0 = 「抑郁风险正常」是有效读数。
 *   但 healthStore 一律用 `v > 0` 过滤、RingBleManager 的 extract() 也用 `v <= 0` 丢弃，
 *   导致「抑郁风险 = 0（正常）」这一最常见读数在数据层被完整丢弃 → 指标卡恒空。
 *
 *   语义区分（务必分清）：
 *   - SIGNED_METRICS：值域含**负数**（emotion -10~10）
 *   - ZERO_VALID_METRICS：值域是**离散档位且 0 合法**（depressionRisk 0/1/2）
 */
const ZERO_VALID_METRICS = new Set<string>(['depressionRisk']);

/** 该指标的 0 / 负数是否是有效测量值（而非原生占位符）。 */
function isZeroOrNegValid(key: string | undefined): boolean {
  if (!key) return false;
  return SIGNED_METRICS.has(key) || ZERO_VALID_METRICS.has(key);
}

function recomputeDaily(
  intraday: TimePoint[],
  prevDaily: DayMetric | undefined,
  source: Source,
  key?: string,
): DayMetric {
  // ★ 生理指标 0/负数=原生 SDK 占位符（无测量）；
  //   emotion（可负值）与 depressionRisk（0 是合法档位）等例外，0/负是有效值。
  const keepZeroNeg = isZeroOrNegValid(key);
  const clean = intraday.filter((p) => Number.isFinite(p.v) && (keepZeroNeg || p.v > 0));
  const vals = clean.map((p) => p.v);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const last = clean.length ? clean[clean.length - 1].v : null;
  const mergedSource: Source =
    prevDaily && prevDaily.source !== source && prevDaily.samples > 0 ? 'mixed' : source;
  return {
    mean: clampValid(mean as number),
    min: clampValid(min as number),
    max: clampValid(max as number),
    last: clampValid(last as number),
    samples: intraday.length,
    source: mergedSource,
    updatedAt: Date.now(),
  };
}
```

**配套改动**（`src/ble/RingBleManager.ts:1072-1087`，`extract()` 函数）：

```ts
      // ★ 带符号指标：emotion 值域 [-10,10] 含负数（消极/低落），0/负是有效值，
      //   不能用「生理指标 0/负=占位符」的守卫砍掉，否则情绪点阵只剩开心/兴奋。
      const SIGNED_HKEYS = new Set<string>(['emotion']);
      // ★ 2026-11-06（审计 4-3）：零值有效指标 —— 原生 VeepooRing.m:1658 对 depressionRisk
      //   用的是 `>= 0` 判定，0 = 「抑郁风险正常」是合法读数，不能当占位符丢掉。
      const ZERO_VALID_HKEYS = new Set<string>(['depressionRisk']);
      const extract = (nativeKey: string): Array<{ t: number; v: number }> => {
        const hsKey = METRIC_MAP[nativeKey];
        if (!hsKey) return [];
        const signed = SIGNED_HKEYS.has(hsKey);
        const zeroValid = ZERO_VALID_HKEYS.has(hsKey);
        const out: Array<{ t: number; v: number }> = [];
        for (const s of slots) {
          const v = num(s?.[nativeKey]);
          if (v == null || !Number.isFinite(v)) continue;
          if (!signed && !zeroValid && v <= 0) continue;  // 生理指标 0/负=占位符；emotion / depressionRisk 保留
          const t = parseSampleTs(date, s?.time ?? s?.t ?? '');
          if (t == null) continue;
          out.push({ t, v });
        }
        return out;
      };
```

---

### 🔴-4 `finalize()` / `finalizeContinuous()` 未过滤 `Number.isFinite` —— NaN 可直达 hero 数值与 SVG 路径

**文件**：`src/lib/realSeries.ts:156-215`

**代码片段**：

```ts
function finalize(
  vals: (number | null)[],
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  const real = vals.filter((v): v is number => v != null);
  const latest = lastNonNull(vals);
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return { kind: 'signal', continuous: false, points: vals, unit: def.unit, yMin: def.yMin, yMax: def.yMax, latest, avg, hi, lo, multiDay, note };
}

function finalizeContinuous(
  tps: TimePt[], tMin: number, tMax: number, def: BasicMetricDef, multiDay: boolean, note?: string
): HistoryResult {
  const real = tps.map((p) => p.v).filter((v) => Number.isFinite(v));
  const latest = tps.length ? tps[tps.length - 1].v : null;      // ← 未过滤
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  ...
}
```

**问题**：

1. `finalize()` 的 `real = vals.filter((v) => v != null)` —— **`NaN != null` 为 `true`**，所以 NaN 会被当成有效值进入 `real`：
   - `avg` → `NaN`
   - `hi` = `Math.max(...real)` → `NaN`
   - `lo` = `Math.min(...real)` → `NaN`
   - `latest` = `lastNonNull(vals)` → 同样是 NaN（`lastNonNull` 也只判 `!= null`）
2. `finalizeContinuous()` 的 `latest` 取 `tps[tps.length-1].v` **完全无过滤** —— 最后一个样本若是 NaN，hero 数值直接显示 `NaN`。
3. `points: vals` 原样透出，**NaN 会进入图表层**。`MetricDetailScreen.tsx:1049` 的 `yBounds` 用 `Number.isFinite(p.v)` 过滤了 `tPoints`，但 `:949` 的 `series.points` 分支只用 `v != null` 判定 —— 周/月/年视图（indexed 模式）走的就是这条路，**NaN 会进入 `rawMin/rawMax` 计算** → `yBounds` 变成 `{lo: NaN, hi: NaN}` → `yAt()` 的 clamp 失效 → **`y` 坐标为 NaN**。
4. 参照 `src/components/BasicMetricCard.tsx:92` 的注释：
   > `// 防御：任何非有限值（NaN/Infinity）都会导致 iOS 原生 SVG 渲染器直接崩溃（硬退出）。`

   即：**NaN 泄漏到 SVG 不是「画歪」，而是 iOS 端硬退出崩溃**。`BasicMetricCard` 自己做了防护，但 `MetricDetailScreen` 的 `RangeBarsChart` / `TrendChart` 没有同等防护。

**建议的修改后代码**（`src/lib/realSeries.ts:144-215` 整体替换）：

```ts
/** 取最后一个非空有效值（NaN / Infinity 一律视为无效）。 */
function lastNonNull(vals: (number | null)[]): number | null {
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** 过滤出真正可用于统计的有效值（非 null、非 NaN、非 Infinity）。 */
function finiteOnly(vals: (number | null)[]): number[] {
  return vals.filter((v): v is number => v != null && Number.isFinite(v));
}

/**
 * ★ 2026-11-06（审计 4-4）：`vals` 在进入统计前必须先把 NaN / Infinity 剔干净。
 *   旧实现 `vals.filter(v => v != null)` —— `NaN != null` 为 true，NaN 会被当成有效值：
 *   → avg/hi/lo/latest 全部变成 NaN → hero 数值显示 "NaN"，且 NaN 会随 points 透出到图表层。
 *   参照 BasicMetricCard.tsx:92 的注释：非有限值进 iOS 原生 SVG 渲染器会**硬退出崩溃**。
 */
function finalize(
  vals: (number | null)[],
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  const real = finiteOnly(vals);
  // ★ 出图用的 points 也要清洗：NaN 槽位一律降级为 null（图表层会断线，而不是画穿/崩溃）
  const points = vals.map((v) => (v != null && Number.isFinite(v) ? v : null));
  const latest = lastNonNull(points);
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return {
    kind: 'signal',
    continuous: false,
    points,
    unit: def.unit,
    yMin: def.yMin,
    yMax: def.yMax,
    latest,
    avg,
    hi,
    lo,
    multiDay,
    note,
  };
}

/** 真实时间戳连续序列的收口：统计来自 tPoints；tMin/tMax 为所选时间域（含「现在」）。 */
function finalizeContinuous(
  tps: TimePt[],
  tMin: number,
  tMax: number,
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  const real = finiteOnly(tps.map((p) => p.v));
  // ★ 2026-11-06（审计 4-4）：latest 之前直接取最后一个点的 v，未做有限性校验 → NaN 直达 hero 数值。
  const latest = lastNonNull(tps.map((p) => p.v));
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return {
    kind: 'signal',
    continuous: true,
    // ★ 出图用的 tPoints 同样清洗：无效值降级为 null，避免 NaN 坐标进 SVG
    tPoints: tps.map((p) => ({ t: p.t, v: Number.isFinite(p.v) ? p.v : NaN })),
    tMin,
    tMax,
    points: [],
    unit: def.unit,
    yMin: def.yMin,
    yMax: def.yMax,
    latest,
    avg,
    hi,
    lo,
    multiDay,
    note,
  };
}
```

> ⚠️ 注意：`finalizeContinuous` 的 `tPoints` 清洗策略与 `finalize` 不同 —— 连续序列必须**保留槽位**（否则 x 轴时间对齐会塌），所以保留 `t`、把 `v` 置为 `NaN`。这要求图表层对 `tPoints` 也有 `Number.isFinite` 过滤 —— `MetricDetailScreen.tsx:945-950` 的 `yBounds` 已经有 `if (Number.isFinite(p.v)) vals.push(p.v)`，但 `:1040` 的 `yAt(p.v)` 调用链会把 NaN 传下去。`MetricDetailScreen.tsx:973-976` 的 `yAt` 已有 `Number.isFinite(v) ? v : yLo` 兜底，**这一层是安全的**。真正缺失的是 `finalize` 的 `points`（indexed 模式）。

---

## 🟡 High

### 🟡-1 `RangeBarsChart` 的 `if (v == null)` 漏判 NaN —— NaN 画成基线处的「最小柱」而非断线

**文件**：`src/screens/MetricDetailScreen.tsx:504-511`（`RangeBarsChart` 内部）

**代码片段**：

```ts
              {points.map((v, i) => {
                if (v == null) return null;
                const x = barX(i);
                const y = yAt(v);
                const h = Math.max(1, baseY - y);
                return <Rect key={`b-${i}`} x={x} y={y} width={barW} height={h} rx={2} fill={colorOf(v) ?? mm.colors.ink} />;
              })}
```

**问题**：

- `v == null` 只挡 `null` 与 `undefined`，**`NaN` 不为 null** → NaN 会进入绘制分支。
- `yAt`（`:455-458`）有 `Number.isFinite(v) ? v : yLo` 兜底 → NaN 被钳到 `yLo`（量程下沿）。
- 于是 `y = baseY`、`h = Math.max(1, 0) = 1` → **画出一根贴在基线上的 1px 假柱**。
- 语义后果：**「数据缺失」被渲染成「数据存在但接近 0」**。周/月/年视图里缺失的那一天，用户看到一根几乎不可见但确实存在的柱子，而不是空槽 —— 这违反「不编造数据」铁律。
- 同函数 `onTouch`（`:477-484`）也只判 `v == null` → NaN 会让 tooltip 显示 `valueFmt(NaN)`。

**建议的修改后代码**（`src/screens/MetricDetailScreen.tsx:504-511`）：

```ts
              {points.map((v, i) => {
                // ★ 2026-11-06（审计 4-5）：`v == null` 漏判 NaN —— NaN 会被 yAt 钳到量程下沿，
                //   画成一根贴在基线上的 1px 假柱，把「数据缺失」伪装成「数值≈0」。
                //   这里改为显式判有限性：无效槽位直接不画（断线），并保留槽位供 x 轴对齐。
                if (v == null || !Number.isFinite(v)) return null;
                const x = barX(i);
                const y = yAt(v);
                const h = Math.max(1, baseY - y);
                return <Rect key={`b-${i}`} x={x} y={y} width={barW} height={h} rx={2} fill={colorOf(v) ?? mm.colors.ink} />;
              })}
```

配套（`src/screens/MetricDetailScreen.tsx:477-484` 的 tooltip 判定）：

```ts
    const v = points[best];
    if (v == null || !Number.isFinite(v)) { setTip(null); return; }
    setTip({ x: barX(best) + barW / 2, y: yAt(v), label: labels[best] ?? '', value: valueFmt(v), color: colorOf(v) ?? mm.colors.ink });
```

---

### 🟡-2 `AllDayBarsChart.yAt` 完全没有 clamp —— 超量程值会画穿坐标轴（与 `MetricDetailScreen.yAt` 行为不一致）

**文件**：`src/components/charts/AllDayBarsChart.tsx:138-172`（关键行 `:140`）

**代码片段**：

```ts
  const geom = useMemo(() => {
    if (w <= 0) return null;
    const yAt = (v: number) => PAD_T + plotH * (1 - (v - range.lo) / (range.hi - range.lo));
    ...
      const y = yAt(b.v);
      const fill = colorOf?.(b.v) ?? chart.dayBarSegment[segmentOf?.(b.t) ?? 'awake'];
      bars.push(
        <Rect key={b.slot} x={x} y={y} width={barW}
          height={Math.max(chart.bar.minHeight, baseY - y)}
          rx={Math.min(chart.bar.radius, barW / 2)}
          fill={fill} opacity={chart.bar.opacity.solid} />,
      );
```

**问题**：

1. **`yAt` 没有任何 clamp**。而 `MetricDetailScreen.tsx:973-976` 的同名函数是有的：
   ```ts
   const yAt = (v: number) => {
     const c = Math.max(yLo, Math.min(yHi, Number.isFinite(v) ? v : yLo));
     return PAD_T + (1 - (c - yLo) / (yHi - yLo || 1)) * plotH;
   };
   ```
   两处行为不一致 —— 同一个 App 里两套 y 轴映射语义。
2. 当外部传入 `yMin`（`MetricDetailScreen.tsx:1426` 传 `yMin={0}`、`:1485` 传 `yMin={params.key === 'spo2' ? 85 : params.key === 'emotion' ? -10 : undefined}`）而 `yMax` 未传时，`range` 会走「自适应」分支（`:121-134`：仅当 `yMin != null && yMax != null && yMax > yMin` 才用外部量程）→ 自适应范围由实际 bucket 值决定，通常安全。**但**：
   - `emotion` 传 `yMin={-10}` 而 `yMax` 未传 → 走自适应分支，`range.lo` 由实际数据最小值决定。若某天情绪全为正（如只有 +5），`range.lo ≈ 4` → **负值区间被压掉**。
   - `hrv` 传 `yMin={0}`、`yMax` 未传 → 若某天 HRV 全为 0.5，`range.lo` 会被 padding 拉到负数 → **HRV 柱画到 0 线以下**。
3. 若外部同时传 `yMin`/`yMax`（当前调用点没有，但 props 支持），任何超量程的 `b.v` → `y` 超出 `[PAD_T, PAD_T+plotH]` → **柱子画出坐标轴，溢出到图例/标题区域**。

**建议的修改后代码**（`src/components/charts/AllDayBarsChart.tsx:138-141`）：

```ts
  const geom = useMemo(() => {
    if (w <= 0) return null;
    // ★ 2026-11-06（审计 4-6）：yAt 必须 clamp 到量程内。
    //   旧实现无任何 clamp —— 超量程值（如 spo2 传入 yMin=85 但样本是 72）
    //   会把柱子画到绘图区之外、溢出到图例/标题区域；NaN/Infinity 还会直接产出非法 SVG 坐标
    //   （参照 BasicMetricCard.tsx:92：非有限值会让 iOS 原生 SVG 渲染器硬退出）。
    //   口径与 MetricDetailScreen.tsx:973 的 yAt 对齐。
    const ySpan = range.hi - range.lo;
    const yAt = (v: number) => {
      const c = Number.isFinite(v)
        ? Math.max(range.lo, Math.min(range.hi, v))
        : range.lo;
      return PAD_T + plotH * (1 - (ySpan === 0 ? 0 : (c - range.lo) / ySpan));
    };
```

> 同时建议 `AllDayBarsChart.tsx:121-134` 的量程计算，在只有 `yMin` 被外部指定时也尊重它（例如 `yMin={85}` 时 `range.lo` 取 `min(自适应lo, 85)`），否则 `yMin` 这个 prop 实际是**半失效**的。

---

### 🟡-3 `NightBpCard` 的 `dipPct` 为负时落入「基本没降」+ danger 色 —— 语义误导

**文件**：`src/components/NightBpCard.tsx:88-95`

**代码片段**：

```ts
    // 3) 夜间心率 dipping 近似
    const nightHr = nightHrMean(dk, dayMs);
    const dayHr = daytimeHrMean(dk);
    const dipPct = nightHr != null && dayHr != null && dayHr > 0
      ? ((dayHr - nightHr) / dayHr) * 100
      : null;
    const dipLabel = dipPct == null ? null : dipPct >= 10 ? '下降充分' : dipPct >= 3 ? '下降偏少' : '基本没降';
    const dipColor = dipPct == null ? theme.colors.textSub : dipPct >= 10 ? mm.colors.limeDeep : dipPct >= 3 ? mm.colors.honeyDeep : theme.colors.danger;
```

**问题**：

- **除零本身已被防住**：`dayHr > 0` 的守卫存在，`dayHr` 为 0 / null 时 `dipPct = null` → 显示「需要夜间心率数据」。这一项是**正确的**，不需要修。
- 真正的问题是**负 dipPct 的语义**：
  - `dipPct < 0` 意味着**夜间心率高于日间**（如夜间 68 bpm / 日间 62 bpm → `dipPct = -9.7`）。
  - 公开生理学口径里，这属于 **non-dipping / 反向下降**，是比「基本没降」**更值得警惕**的形态（提示昼夜节律反转、夜间交感占优）。
  - 但当前代码把它归入 `'基本没降'` 并染 `theme.colors.danger` —— 颜色对，但**文案完全没传达「夜间反而更高」这层信息**。用户看到「基本没降 -10%」会困惑。
  - 更细的问题：`dipPct` 在 `[-3, 0)` 区间落在「基本没降」，在 `< -3` 也落在「基本没降」—— 两种截然不同的情形共用一个标签。
- 另外 `NightBpCard` 存在**两个与除零相关的隐性除零**：
  - `nightHrMean` / `daytimeHrMean`（`:32-55`）的均值分母是 `out.length`，`out.length ? ... : null` 已有保护，**这一点是安全的**。
  - 但 `sysAvg` / `diaAvg`（`:86-87`）用 `sysDays.length >= 2` 保护，**也安全**。
  - 唯一真实的除零隐患在**数值口径**：`daytimeHrMean` 窗口是 `h >= 7 && h < 22`（15 小时），`nightHrMean` 窗口是「前一日 22–24 时 + 该日 0–6 时」（8 小时）—— 两个窗口采样密度差异大时，`dipPct` 的可比性存疑（这是口径问题，非除零）。

**建议的修改后代码**（`src/components/NightBpCard.tsx:88-96`）：

```ts
    // 3) 夜间心率 dipping 近似
    const nightHr = nightHrMean(dk, dayMs);
    const dayHr = daytimeHrMean(dk);
    // ★ 除零保护保留：dayHr <= 0 时直接判为「无数据」，不参与百分比计算。
    const dipPct = nightHr != null && dayHr != null && dayHr > 0 && Number.isFinite(nightHr) && Number.isFinite(dayHr)
      ? ((dayHr - nightHr) / dayHr) * 100
      : null;
    // ★ 2026-11-06（审计 4-7）：负 dipPct（夜间心率**高于**日间）不能与「基本没降」共用文案。
    //   公开生理学口径：夜间较日间下降 ≥10% 为正常 dipping；
    //   0~3% = 下降偏少；3~10% = 下降不足；< 0% = **反向（非下降）**，是更需警惕的形态。
    const dipLabel = dipPct == null
      ? null
      : dipPct >= 10 ? '下降充分'
      : dipPct >= 3 ? '下降偏少'
      : dipPct >= 0 ? '基本没降'
      : '夜间高于日间';
    const dipColor = dipPct == null ? theme.colors.textSub
      : dipPct >= 10 ? mm.colors.limeDeep
      : dipPct >= 3 ? mm.colors.honeyDeep
      : dipPct >= 0 ? theme.colors.danger
      : theme.colors.danger;
    // 数值展示也区分：负值加「反向」前缀，避免出现「-10% 基本没降」的矛盾文案
    const dipText = dipPct == null ? null : `${dipPct > 0 ? '' : ''}${dipPct.toFixed(0)}%`;
```

配套（`src/components/NightBpCard.tsx:136-142` 的渲染）：

```tsx
          <View style={styles.cell}>
            <Text style={styles.label}>夜间心率下降（dipping 参考）</Text>
            <Text style={[styles.big, { color: data.dipColor }]}>
              {data.dipText != null ? data.dipText : '--'}
            </Text>
            <Text style={[styles.sub, data.dipLabel ? { color: data.dipColor } : null]}>
              {data.dipLabel ?? '需要夜间心率数据'}
            </Text>
          </View>
```

> 同时建议给 `NightBpCard.tsx:70-71` 补一句说明：`sp[sp.length - 1]` 取的是 intraday 数组的最后一个元素，而 `healthStore.getIntraday`（`healthStore.ts:558-562`）**返回的是 store 内部数组引用**（未经排序保证由调用方负责）。当前 `mergeRealtime` / `mergeIntraday` 都保证了升序，所以暂时安全；但这是一处隐式契约。建议改为按 `t` 显式取最大：
> ```ts
>     // 取该日**时间最新**的一次血压读数（不依赖数组顺序）
>     const spLast = sp.reduce((a, b) => (b.t > a.t ? b : a), sp[0]);
>     const dpLast = dp.reduce((a, b) => (b.t > a.t ? b : a), dp[0]);
>     sys = spLast.v;
>     dia = dpLast.v;
>     measuredAt = Math.max(spLast.t, dpLast.t);
> ```

---

### 🟡-4 `mergeRealtime` 与 `mergeIntraday` 合并语义不一致 —— 同 key 同日交错写入会丢样本

**文件**：`src/data/healthStore.ts:248-278`

**代码片段**：

```ts
const MERGE_MS = 60 * 1000; // 同一天内时间差 < 1min 的样本视为同一时刻，取后写

function mergeIntraday(prev: TimePoint[] | undefined, incoming: TimePoint[]): TimePoint[] {
  if (!prev || prev.length === 0) return [...incoming].sort((a, b) => a.t - b.t);
  const map = new Map<number, TimePoint>();
  for (const p of prev) map.set(p.t, p);
  for (const p of incoming) {
    // 找最近邻（±MERGE_MS）覆盖，否则新增
    let replaced = false;
    for (const k of map.keys()) {
      if (Math.abs(k - p.t) <= MERGE_MS) { map.set(k, p); replaced = true; break; }
    }
    if (!replaced) map.set(p.t, p);
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

function mergeRealtime(prev: TimePoint[] | undefined, incoming: TimePoint): TimePoint[] {
  const map = new Map<number, TimePoint>();
  for (const point of prev ?? []) map.set(point.t, point);
  map.set(incoming.t, incoming);
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}
```

**问题**：

1. **两条通路的「同刻」定义不同**：
   - `mergeRealtime`（`:273`，用于 `upsertRealtime`）：**精确时间戳**匹配 —— 只有 `t` 完全相同才覆盖。
   - `mergeIntraday`（`:258`，用于 `upsertBackfillSamples`）：**±60s 就近**匹配 —— 相邻一分钟内的点会被合并。
2. 由此产生的具体丢数据场景（已用 Node 复现）：
   - `prev = [{t:995, v:70}]`（来自实时流）
   - `incoming = [{t:1000,v:71}, {t:1010,v:72}, {t:1020,v:73}]`（来自 backfill）
   - `mergeIntraday` 的结果：**只剩 `[{t:1020,v:73}]`** —— 3 个样本被合并成 1 个，2 个丢失。
   - 原因：`for (const k of map.keys())` 遍历时**只匹配第一个**满足条件的 key，且 `map.set(k, p)` **复用旧 key `k`**（不是 `p.t`）→ 后续 incoming 点继续命中同一个旧 key → 连锁覆盖。
   - 更糟的是 `map.set(k, p)` 用旧 key 存新点，导致 `map` 的 key 集合与 value 的 `t` **不一致**，`Array.from(map.values())` 拿到的点的 `t` 是 `p.t`（对的），但 map 内部 key 仍是旧的 → 下一次 merge 时的邻域判断基准是错的。
3. **交错写入场景**（审查项 4 关注的正是这个）：
   - 实时流写入 `t=1000`（`mergeRealtime` → intraday 有 `{t:1000}`）
   - 随后 backfill 写入 `t=1000`（`mergeIntraday` → 命中 ±60s → **覆盖**，值被 backfill 的历史精度值替换，实时真值丢失）
   - 反向：backfill 先写 `t=1000`，实时再写 `t=1000` → `mergeRealtime` 精确命中 → 覆盖，backfill 值丢失
   - 两种顺序下最终留下的值**不一样**，但没有任何日志说明谁覆盖了谁 → 「数据忽高忽低、来源不明」这类问题无法排查。

**建议的修改后代码**（`src/data/healthStore.ts:248-278` 整体替换）：

```ts
const MERGE_MS = 60 * 1000; // 同一天内时间差 < 1min 的样本视为同一时刻，取后写

/**
 * 合并 intraday 样本。
 *
 * ★ 2026-11-06（审计 4-8）：修复「邻域匹配连锁覆盖」丢样本。
 *   旧实现：遍历 map.keys() 找到第一个 ±MERGE_MS 内的 key 就 `map.set(k, p)` ——
 *   ① 复用旧 key（key 与 value.t 不一致），后续点的邻域判断基准错位；
 *   ② 同一个旧 key 会被后续多个 incoming 点反复命中 → 3 个样本被合并成 1 个（实测可复现）。
 *   ③ 只取「第一个」匹配而不是「最近」匹配，匹配结果依赖插入顺序，不可预测。
 *
 *   新实现：
 *   - 同刻判定统一为「±MERGE_MS 内取**最近**的一个」；
 *   - 命中后**删除旧 key、按新 t 写入**，保证 map 的 key 与 value.t 始终一致；
 *   - incoming 内部先按 t 去重，避免同一批里互相覆盖。
 */
function mergeIntraday(prev: TimePoint[] | undefined, incoming: TimePoint[]): TimePoint[] {
  const base = prev && prev.length ? prev : [];
  if (base.length === 0) {
    // 无既有数据：按 t 去重后直接返回（同一批内不互相覆盖）
    const m0 = new Map<number, TimePoint>();
    for (const p of incoming) m0.set(p.t, p);
    return Array.from(m0.values()).sort((a, b) => a.t - b.t);
  }
  const map = new Map<number, TimePoint>();
  for (const p of base) map.set(p.t, p);
  for (const p of incoming) {
    if (!Number.isFinite(p?.t) || !Number.isFinite(p?.v)) continue;
    // 找**最近**的同刻点（而非第一个命中）
    let hitT: number | null = null;
    let bestDiff = Infinity;
    for (const k of map.keys()) {
      const diff = Math.abs(k - p.t);
      if (diff <= MERGE_MS && diff < bestDiff) { bestDiff = diff; hitT = k; }
    }
    if (hitT != null) {
      map.delete(hitT);          // ★ 先删旧 key，保证 key 与 value.t 一致
    }
    map.set(p.t, p);              // ★ 按新时间戳写入
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

/**
 * 实时单点合并：**精确时刻**覆盖（同 t 后写胜）。
 * ★ 2026-11-06（审计 4-8）：与 mergeIntraday 统一为「同刻取后写」——
 *   两条通路对「同刻」的定义必须一致，否则 realtime 与 backfill 交错写入时
 *   同一时刻会残留两份互相矛盾的样本（详见 upsertRealtime / upsertBackfillSamples 的调用约定）。
 */
function mergeRealtime(prev: TimePoint[] | undefined, incoming: TimePoint): TimePoint[] {
  const map = new Map<number, TimePoint>();
  for (const point of prev ?? []) map.set(point.t, point);
  map.set(incoming.t, incoming);
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}
```

> **配套约定（需一并落地，否则语义仍不闭环）**：建议在 `upsertRealtime` 与 `upsertBackfillSamples` 的注释中明确「**实时真值优先于 backfill 回填**」，并让 backfill 路径在发现已有 realtime 样本时**不覆盖**：
>
> ```ts
>   // ── 写入：backfill 逐样本（历史日曲线） ──────────────────────────────────
>   upsertBackfillSamples(key: MetricKey, dayKeyRaw: string, samples: TimePoint[], opts?: { derived?: boolean }): void {
>     const store = this.safeStore(key);
>     if (!store) return;
>     const dk = normalizeDayKey(dayKeyRaw);
>     if (dk === dayKeyRaw && Number.isNaN(parseDayKey(dk))) return; // 非法 key 丢弃
>     if (!samples || samples.length === 0) return;
>     // ★ 2026-11-06（审计 4-8）：过滤非法值，杜绝 NaN 进入 intraday（会污染日聚合与 SVG 坐标）
>     const valid = samples.filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v));
>     if (valid.length === 0) return;
>     // ★ 实时真值优先：已有 realtime 来源的同日样本不被 backfill 覆盖
>     const existing = store.intraday[dk] ?? [];
>     const realtimeKeys = new Set(
>       existing.filter((p) => store.daily[dk]?.source === 'realtime' || store.daily[dk]?.source === 'mixed').map((p) => p.t),
>     );
>     const toWrite = valid.filter((p) => !realtimeKeys.has(p.t));
>     if (toWrite.length === 0) return;
>     store.intraday[dk] = mergeIntraday(store.intraday[dk], toWrite);
>     ...
>   }
>   ```

---

### 🟡-5 11 个文件读取 healthStore 但**未订阅版本号** —— backfill 落库后页面不刷新

**文件与实测数据**（`grep -c healthStore` vs `grep -cE "useHealthStoreVersion|useDebouncedHealthStoreRefresh|useHealthStoreValue|useEnsureDerivedMetrics"`）：

| 文件 | 读 healthStore 次数 | 订阅次数 | 后果 |
|---|---|---|---|
| `src/screens/TodayScreen.tsx` | 12 | **0** | 页面靠 `RingBle.onState` 重渲染；`healthStore.getVersion()`（`:195`）只是普通变量读，**不触发重渲染** |
| `src/screens/BpDetailScreen.tsx` | 16 | **0** | 血压详情页 backfill 后不刷新 |
| `src/components/NightBpCard.tsx` | 9 | **0** | 睡眠页夜间血压卡 backfill 后不刷新 |
| `src/components/HormoneCurveCard.tsx` | 7 | **0** | 激素曲线不刷新 |
| `src/components/EmotionTimeline.tsx` | 7 | **0** | 情绪时间轴不刷新 |
| `src/screens/HealthAgeDetailScreen.tsx` | 7 | **0** | 健康年龄详情不刷新 |
| `src/screens/EnergyDetailScreen.tsx` | 5 | **0** | 精力详情不刷新 |
| `src/screens/ToolTopicScreen.tsx` | 4 | **0** | 工具专题不刷新 |
| `src/components/MonthDiscoveryView.tsx` | 4 | **0** | 月度发现不刷新 |
| `src/screens/StatusTrendDetailScreen.tsx` | 5 | **0** | 状态趋势不刷新 |
| `src/screens/SleepDetailScreen.tsx` | 3 | **0** | 睡眠详情（`NightBpCard` 的宿主）不刷新 |

**对照（订阅正确的文件）**：`MetricDetailScreen.tsx`（读 21 / 订阅 2，`:655` `useHealthStoreVersion()`）、`InsightScreen.tsx`（读 13 / 订阅 5，`:891`/`:1037`/`:1140`）、`CortisolDailyChart.tsx`（读 1 / 订阅 2，`:106` `useDebouncedHealthStoreRefresh(700)`）。

**问题**：

- `src/hooks/useHealthStore.ts` 的文件头注释写得很清楚：
  > `healthStore 是同步单例，写入不经过 RingState，因此只订阅 RingState 的组件无法感知离线回填完成。`

  `RingBleManager.reconcileFromHealthStore`（`:3845`）虽然会 `applyPatch({ dataVersion })` 触发 RingState 变更，但那是**节流 500ms + 只在 `rebuildHistoricalStatus` / `syncExtendedDaily` 之后**才发，且 `RingState.dataVersion` 只在 `RingBle.onState` 的订阅者里生效。`SleepDetailScreen` 用的 `useRingState`（`:204`）确实能收到，但它读的是 `ring.sleepDaily` 等 **RingState 字段**，而 `NightBpCard` 读的是 **`healthStore.getIntraday`** —— 两者数据源不同，`ring` 变化**不会**触发 `NightBpCard` 重算（`useMemo` 依赖只有 `[anchorMs]`，`:97`）。
- 结果：**用户在睡眠恢复页看到「夜间血压参考」显示「还没有血压测量」，即使数据早已入库** —— 这类「数据明明有但页面是空的」问题最难定位，因为它需要用户主动切页面才会刷新。

**建议的修改后代码**：

对每个未订阅文件，在组件顶层加一行订阅。以 `NightBpCard.tsx` 为例（改动最小、收益最大）：

```ts
// src/components/NightBpCard.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { healthStore, dayKey, type TimePoint } from '../data/healthStore';
// ★ 2026-11-06（审计 4-9）：订阅 healthStore 版本号 —— backfill 落库后本卡要立刻重算。
//   本卡读 healthStore.getIntraday（不是 RingState），不订阅就永远停留在首次渲染的快照。
import { useHealthStoreVersion } from '../hooks/useHealthStore';
```

```ts
export function NightBpCard({ anchorMs }: Props) {
  // ★ 订阅 healthStore：offline backfill 写入 intraday 后触发重渲染
  const healthVer = useHealthStoreVersion();
  const data = useMemo(() => {
    ...
    return { sys, dia, measuredAt, sysAvg, diaAvg, measuredDayCount, dipPct, dipLabel, dipColor, dipText, nightHr, dayHr };
  }, [anchorMs, healthVer]);   // ★ 依赖里补上 healthVer
```

`BpDetailScreen.tsx` 同理（在 `buildDual` 的 `useMemo` 依赖里补版本号）：

```ts
// src/screens/BpDetailScreen.tsx
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
...
export default function BpDetailScreen() {
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);
  // ★ 2026-11-06（审计 4-9）：血压数据全部来自 healthStore（bpSys/bpDia intraday），
  //   不订阅版本号则离线回填完成后本页不刷新（用户看到「空图」）。
  const hsVer = useDebouncedHealthStoreRefresh(700);
  ...
  const data = useMemo(() => buildDual(range, anchor), [range, anchor, nonce, hsVer]);
  const prev = useMemo(() => buildDual(range, prevAnchor), [range, prevAnchor, nonce, hsVer]);
  const ampm = useMemo(() => ampmSummary(range, anchor), [range, anchor, nonce, hsVer]);
```

`SleepDetailScreen.tsx`：

```ts
// src/screens/SleepDetailScreen.tsx
import { useHealthStoreVersion } from '../hooks/useHealthStore';
...
  const ring = useRingState();
  // ★ 2026-11-06（审计 4-9）：本屏的 dayAnalysis 直接读 healthStore.getIntraday('hrv', dk)，
  //   订阅版本号后 backfill 落库即可重算（否则要切页面才刷新）。
  const hsVer = useHealthStoreVersion();
  ...
  }, [sleepDaily, anchor, ring, hsVer]);   // ★ 依赖补 hsVer
```

其余文件（`TodayScreen` / `HormoneCurveCard` / `EmotionTimeline` / `HealthAgeDetailScreen` / `EnergyDetailScreen` / `ToolTopicScreen` / `MonthDiscoveryView` / `StatusTrendDetailScreen`）同理：加订阅 + 把版本号并入对应 `useMemo` 依赖。

> **`TodayScreen.tsx:195` 特别说明**：
> ```ts
>   const healthVer = healthStore.getVersion();
> ```
> 这行是**普通函数调用**，返回值被赋给普通变量 —— 它**不会**触发任何重渲染。它只是让下游 `useMemo` 的依赖数组「看起来变了」，但 `useMemo` 本身不会因为普通变量变化而重算（只有组件重渲染才会）。建议改为：
> ```ts
>   // ★ 2026-11-06（审计 4-9）：`healthStore.getVersion()` 只是普通读，不触发重渲染。
>   //   必须走 useSyncExternalStore 订阅，否则 healthStore 写入后本页不刷新。
>   const healthVer = useHealthStoreVersion();
> ```

---

### 🟡-6 `RingState.daily` 写入用原生 key、洞察页读取用展示别名 —— `bloodSugar` / `uricAcid` 的 daily 兜底恒空

**文件**：`src/ble/RingBleManager.ts:3915`（写）、`src/screens/InsightScreen.tsx:620` / `:627`（读）

**代码片段**（写，`RingBleManager.ts:3913-3915`）：

```ts
      } else {
        // 扩展指标：存最新值，并增量写入 15 分钟时间槽以累积全天趋势曲线
        daily[m.key] = m.value;      // ← m.key 是原生 key：'glucose' / 'ua' / 'cholesterol' / 'sns' …
```

**代码片段**（读，`InsightScreen.tsx:584-634`）：

```ts
  const renderBasicsCard = (m: BasicMetricDef) => {
    const isRealtime = realtimeKeys.has(m.key);
    const rk = m.key as RingMetricKey;
    ...
    if (isRealtime) {
      const rt = ring.metrics[rk] ?? null;
      ...
        const dv = ring.daily[rk] ?? null;        // ← :620  读展示别名 key
        ...
    } else {
      const dv = ring.daily[m.key] ?? null;       // ← :627  读展示别名 key
```

**问题**：

- `RingState.daily` 的注释（`RingBleManager.ts:310`）明确写着「按 metrics.ts 的 EXTENDED_SIGNALS key（camelCase）索引」—— 即**期望存展示别名**。
- 但 `flushPendingMetrics` 的实际写入 `daily[m.key] = m.value` 用的是**原生 emit key**。于是 `daily` 里同时存在两套 key：
  - `daily['glucose']`（原生，来自 `:3915`）、`daily['ua']`、**没有** `daily['bloodSugar']`
  - 而 `EXT_SIGNAL_KEYS` 循环（`:4023-4031`）写的又是**别名**：`prevDay['bloodSugar'] = m`
- 结果：
  - `INSIGHT` 洞察页 `renderBasicsCard` 的 `ring.daily[m.key]`（`:627`）在 `m.key === 'bloodSugar'` / `'uricAcid'` 时**恒为 `null`** → 血糖/尿酸卡在没有实时流时永远显示「—」，即使 `daily['glucose']` 有值。
  - `daily` 里 `glucose` 与 `bloodSugar` **两套 key 并存**，且 `bloodSugar` 那份的数据来源是 `this.state.metrics['bloodSugar']`——而 `RingMetrics`（`:264-271`）只有 6 个核心字段，`metrics['bloodSugar']` **恒为 undefined** → `EXT_SIGNAL_KEYS` 这个循环对 `bloodSugar`/`bloodFat`/`uricAcid`/`snsActivation` **基本恒空转**。

**建议的修改后代码**（`src/ble/RingBleManager.ts:3913-3941`，`flushPendingMetrics` 的扩展指标分支）：

```ts
      } else {
        // ★ 2026-11-06（审计 4-10）：扩展指标同时写**原生 key** 与**展示别名 key**。
        //   旧实现只写 `daily[m.key]`（原生 key，如 'glucose' / 'ua' / 'cholesterol'），
        //   而洞察页 renderBasicsCard 读的是 `ring.daily[m.key]`（展示别名，如 'bloodSugar' / 'uricAcid'）
        //   → 血糖/尿酸在没有实时流时 daily 兜底恒空 → 卡片永远「—」。
        //   规则：daily 既是数据层（realSeries 读原生 key）又是展示层（InsightScreen 读别名 key）的并集，
        //   两套 key 都写，读侧才都能命中。
        const nativeKey = m.key;                                  // 原生 key（数据层）
        const hsKey = hsKeyFor(nativeKey);                        // 数据层规范 key
        const displayKey = DISPLAY_KEY_BY_HS.get(hsKey ?? '') ?? nativeKey; // 展示层别名 key

        daily[nativeKey] = m.value;
        if (displayKey !== nativeKey) daily[displayKey] = m.value;

        const t = m.ts ?? Date.now();
        // ★ v18.102（用户实锤「一会儿空、一会儿又冒出数据」的元凶）：
        //   扩展指标多由 HealthGlance/健康一览轮询（~60s）取回，原生**不带样本时间戳**，
        //   没有真实样本时刻就**不刷新 lastUpdated**（值照常入库供 UI 读，但不伪造"此刻刚测到"）。
        if (typeof m.ts === 'number' && m.ts > 0) lastUpdated[nativeKey] = m.ts;
        availability[nativeKey] = 'live';
        this.ingestExt(nativeKey, m.value, t);
        dailyHistory[nativeKey] = this.deriveExtHistory(nativeKey);
        // 按天归档（今日），供跨天历史（浅拷贝当天对象，避免改动旧 state 嵌套引用）
        const prevDay = extDaily[bucketDay] ?? {};
        extDaily[bucketDay] = { ...prevDay, [nativeKey]: m.value };
        if (displayKey !== nativeKey) extDaily[bucketDay] = { ...extDaily[bucketDay], [displayKey]: m.value };
        if (hsKey) {
          // 之前只调了 upsertBackfillDay 写 daily 聚合，healthStore.intraday 为空 → trend 图画不出来。
          // 现在每次 HealthGlance 轮询（~60s）收到的单点都累积进 intraday → 全天曲线可画。
          healthStore.upsertRealtime(hsKey, { t, v: m.value }, t);
          // 同时追加到 manualMeasurements（血液成分类指标每次 HealthGlance 返回的都是最新测值）
          if (hsKey === 'triglyceride' || hsKey === 'hdl' || hsKey === 'ldl' || hsKey === 'cholesterol' || hsKey === 'ua') {
            healthStore.upsertManual(hsKey, bucketDay, m.value, t, 'healthGlance');
          }
        }
      }
```

配套新增映射表（放在 `RingBleManager.ts` 顶部，或更好：放进 🔴-1 建议的 `metricKeyMap.ts`）：

```ts
// src/data/metricKeyMap.ts —— 追加
/** 数据层规范 key → 展示层别名 key（用于 RingState.daily / extDaily 双写）。 */
export const DISPLAY_KEY_BY_HS: ReadonlyMap<string, string> = new Map<string, string>([
  ['glucose', 'bloodSugar'],
  ['ua', 'uricAcid'],
  ['cholesterol', 'bloodFat'],
]);
```

并把 `RingBleManager.ts:4023-4041` 的 `EXT_SIGNAL_KEYS` 循环改为**读 `daily` 而非 `metrics`**（当前读的是 `this.state.metrics[sk]`，而扩展指标根本不在 `RingMetrics` 里）：

```ts
    // ★ 2026-11-06（审计 4-10）：扩展信号写 extDaily[today] 时，读的是 `daily` 而不是 `metrics`。
    //   旧实现读 `this.state.metrics[sk]` —— 但 RingMetrics 只有 hr/spo2/temp/eda/hrv/rr 六个核心字段，
    //   扩展指标（stress/cortisol/skin/…）**从来不写进 metrics** → 这个循环对扩展信号基本恒空转。
    //   正确数据源是 `daily`（扩展指标的最新值就写在那里）。
    const EXT_SIGNAL_KEYS = [
      'stress', 'cortisol', 'emotion', 'skin', 'fatigue', 'sns',
      'bpSys', 'bpDia', 'triglyceride', 'hdl', 'ldl', 'met',
      // 展示别名（对应数据层 glucose / ua / cholesterol）
      'bloodSugar', 'uricAcid', 'bloodFat',
    ];
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    const curExt = { ...this.state.extDaily };
    const prevDay = curExt[todayKey] ?? {};
    let extDirty = false;
    for (const sk of EXT_SIGNAL_KEYS) {
      if (prevDay[sk] != null && prevDay[sk] > 0) continue;
      const m = (daily as unknown as Record<string, number | null>)[sk]
        ?? (daily as unknown as Record<string, number | null>)[hsKeyFor(sk) ?? sk];
      if (typeof m === 'number' && m > 0) {
        prevDay[sk] = m;
        const hk = hsKeyFor(sk);
        if (hk) healthStore.upsertBackfillDay(hk, todayKey, m);
        extDirty = true;
      }
    }
```

---

## 🔵 Medium

### 🔵-1 `binByMinutes` 的 `p.v <= 0` 过滤会丢弃 `emotion` 的负值 —— 与 `SIGNED_METRICS` 契约冲突

**文件**：`src/lib/timeBuckets.ts:61-96`（关键行 `:77`）

**代码片段**：

```ts
  const sorted = source.slice().sort((a, b) => a.t - b.t);
  for (const p of sorted) {
    if (p.v <= 0) continue;                       // 纪律 2：0/负数是占位符
    const slot = Math.floor((p.t - dayStartMs) / spanMs);
    ...
  }
```

**问题**：

- `healthStore.ts:285` 的 `SIGNED_METRICS = new Set(['emotion'])` 明确声明：`emotion` 值域 `[-10, 10]`，**负值是有效测量**（消极/低落）。
- 但 `binByMinutes` 是通用分桶出口，**无差别地把 `v <= 0` 全部丢弃**。
- `MetricDetailScreen.tsx:789` 的 `specDay` 用 `binByMinutes(pts, spec.binMin ?? 5, ...)` 处理 `DAY_BAR_SPECS` 中的 `emotion`（`:216-231`，五档情绪 `-10~10`）→ **所有负值情绪样本被丢弃**。
- 后果：情绪全天柱状图只会显示非负部分，**「难过 / 低落 / 压力」三档（`-10~-7` / `-7~-3`）永远不会出现** —— 而这恰恰是 `metrics.ts` 里定义的五档语义里最有价值的部分。
- 同一过滤也影响 `binByMinutes` 的其他调用点（`:267` stress、`:710` hr、`:878`/`:893` hrv）—— 但那些指标本身不可能为负，所以只有 `emotion` 受影响。

**建议的修改后代码**（`src/lib/timeBuckets.ts:61-96`）：

```ts
export function binByMinutes(
  pts: TimePt[] | null | undefined,
  minutes: number,
  opts?: { dayStartMs?: number; slotCount?: number; roundDigits?: number; keepNonPositive?: boolean },
): Bucket[] {
  const spanMs = Math.max(1, minutes) * 60_000;
  const source = (pts ?? []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v));
  const dayStartMs = opts?.dayStartMs ?? (source.length ? dayStartOf(source[0].t) : dayStartOf(Date.now()));
  const slotCount = opts?.slotCount ?? Math.ceil(DAY_MS / spanMs);
  const digits = opts?.roundDigits ?? 1;
  // ★ 2026-11-06（审计 4-11）：`keepNonPositive` 用于**带符号指标**（emotion，值域 -10~10）。
  //   纪律 2「v <= 0 是占位符」对 emotion 不成立 —— 负值是有效的消极/低落读数，
  //   旧实现无差别丢弃 → 情绪图只剩非负部分，「难过/低落/压力」三档永不出现。
  const keepNonPositive = opts?.keepNonPositive ?? false;

  const sum = new Array(slotCount).fill(0);
  const cnt = new Array(slotCount).fill(0);

  const sorted = source.slice().sort((a, b) => a.t - b.t);
  for (const p of sorted) {
    if (!keepNonPositive && p.v <= 0) continue;   // 纪律 2：0/负数是占位符（带符号指标除外）
    const slot = Math.floor((p.t - dayStartMs) / spanMs);
    if (slot < 0 || slot >= slotCount) continue;
    sum[slot] += p.v;
    cnt[slot] += 1;
  }
  ...
}
```

配套（`src/screens/MetricDetailScreen.tsx:781-792` 的 `specDay`）：

```ts
  const specDay = useMemo(() => {
    if (!isSpecDay || !spec) return null;
    const dk = dateKeyOf(anchor.getTime());
    const dayStart = dayStartOf(anchor.getTime());
    const derived = healthStore.isDerivedDay(spec.key as HSMetricKey, dk);
    // 皮质醇：推算日不出曲线（空态）
    if (spec.measuredOnly && derived) return { blocked: true as const, dk, derived, buckets: null };
    const pts = healthStore.getIntraday(spec.key as HSMetricKey, dk);
    // ★ 2026-11-06（审计 4-11）：emotion 是带符号指标（-10~10），负值是有效读数，
    //   必须保留，否则「难过/低落/压力」三档在图上永不出现。
    const buckets = binByMinutes(pts, spec.binMin ?? 5, {
      dayStartMs: dayStart,
      keepNonPositive: spec.key === 'emotion',
    });
    const filled = bucketFilledCount(buckets);
    return { blocked: false as const, dk, derived, buckets, filled, total: buckets.length };
  }, [isSpecDay, spec, anchor]);
```

> 更好的做法是让 `binByMinutes` 直接接收指标 key 并从 `SIGNED_METRICS` 推导，避免调用方忘记传 flag。

---

### 🔵-2 `SleepDualAxisChart` 的 `yScore` 钳位把负恢复分压成 0、超 100 压成 100

**文件**：`src/components/SleepDualAxisChart.tsx:76-79`

**代码片段**：

```ts
  const durMax = durMaxHours ?? Math.max(4, Math.ceil((Math.max(...(durVals.length ? durVals : [0]), 1) * 1.15) / 2) * 2);

  const yDur = (h: number) => PAD_T + ch * (1 - Math.max(0, Math.min(1, h / durMax)));
  const yScore = (v: number) => PAD_T + ch * (1 - Math.max(0, Math.min(1, v / 100)));
```

**问题**：

1. **`durMax` 无除零**（`Math.max(4, ...)` 保证 ≥ 4），`h / durMax` 安全 —— 这点是对的。
2. `yScore` 的 `Math.max(0, Math.min(1, v / 100))` 把**负恢复分直接压到 0**。
   - `sleepRecoveryScoreForDay` 是**个人相对分**（50 = 平时），可以合法为负（如「比平时差 30 分」→ 20 分；极端情况 0 分以下）。
   - 压到 0 之后，多个负分日的点会**全部叠在基线上**，视觉上无法区分「-5 分」与「-50 分」。
3. `v > 100` 同样被压到 100，**超高分的差异被抹平**。
4. `SleepDetailScreen.tsx:259-320` 的 `dualPoints` 计算 `score` 时分母有保护（`scores.length ? ... : null`），这一点是对的 —— 但分母为 0 时返回 `null`、后续 `smoothOf` 里用 `points[idx[0]].score!` 的非空断言（`:96`、`:99`），依赖 `runs` 分段逻辑（`:109-121`）保证不传 null，实际是安全的。

**建议的修改后代码**（`src/components/SleepDualAxisChart.tsx:74-92`）：

```ts
  // ── 纵轴量程 ──
  const durVals = points.map((p) => (p.durationMin != null ? p.durationMin / 60 : null)).filter((v): v is number => v != null);
  // ★ durMax 兜底最小 4h —— 避免除零（旧实现已有，保留）
  const durMax = durMaxHours ?? Math.max(4, Math.ceil((Math.max(...(durVals.length ? durVals : [0]), 1) * 1.15) / 2) * 2);

  // ★ 2026-11-06（审计 4-12）：恢复分是**个人相对分**（50 = 平时），可以合法为负。
  //   旧实现 `Math.max(0, Math.min(1, v / 100))` 把负分硬压到 0 → 多个负分日全部叠在基线上，
  //   「-5 分」与「-50 分」在图上无法区分。改为按**数据实际范围**自适应量程，
  //   并保证 0 分始终对应一条可辨认的水平参考线。
  const scoreVals = points.map((p) => (p.score != null ? p.score : null)).filter((v): v is number => v != null && Number.isFinite(v));
  const scoreLo = scoreVals.length ? Math.min(0, ...scoreVals) : 0;
  const scoreHi = scoreVals.length ? Math.max(100, ...scoreVals) : 100;
  const scoreSpan = scoreHi - scoreLo || 100;

  const yDur = (h: number) => {
    const hv = Number.isFinite(h) ? h : 0;
    return PAD_T + ch * (1 - Math.max(0, Math.min(1, hv / durMax)));
  };
  const yScore = (v: number) => {
    const vv = Number.isFinite(v) ? v : scoreLo;
    const ratio = (vv - scoreLo) / scoreSpan;          // 负分保留，不再被钳到 0
    return PAD_T + ch * (1 - Math.max(0, Math.min(1, ratio)));
  };
  /** 「个人平时 = 50 分」参考线的 y 坐标（无数据时返回 null，不画）。 */
  const yScoreBaseline = (() => {
    if (!scoreVals.length) return null;
    const ratio = (50 - scoreLo) / scoreSpan;
    if (ratio < 0 || ratio > 1) return null;
    return PAD_T + ch * (1 - ratio);
  })();
```

> 配套：右轴刻度（`:86` 的 `rTicks = [0, 20, 40, 60, 80, 100]`）也应改为按 `scoreLo`/`scoreHi` 动态生成，否则刻度与坐标不再对应。

---

### 🔵-3 `signalKeyFor('skin') → 'eda'` 与 `hsKeyFor('skin')` 直通相互矛盾

**文件**：`src/lib/realSeries.ts:44-48`（`signalKeyFor`）vs `:51-73`（`hsKeyFor`）

**代码片段**：

```ts
/** 有些指标在展示层与数据层 key 不同（如皮肤含水量 skin 实际走 eda 信号） */
function signalKeyFor(metricKey: string): string {
  if (metricKey === 'skin') return 'eda';
  return metricKey;
}
```

**问题**：

- `signalKeyFor('skin')` 返回 `'eda'`，而 `hsKeyFor('skin')` 直通返回 `'skin'`。
- `dailyValueFor`（`:111-128`）**同时**调用两者：
  ```ts
  function dailyValueFor(key: string, dk: string): number | null {
    const sk = signalKeyFor(key);
    if (sk === 'steps') { ... }
    if (sk === 'sleepTotal') return healthStore.getSleep(dk)?.total ?? null;
    ...
    const hsKey = hsKeyFor(key);           // ← skin → 'skin'
    const pts = healthStore.getIntraday(hsKey, dk).filter(...);
  ```
  → `signalKeyFor` 只在判断「是否 steps/sleep*」时起作用，`skin` 不属于任何 sleep 分支，所以这个特判在当前代码里**是死代码**，但语义上极具误导性：读代码的人会以为 `skin` 的数据在 `eda` 里。
- 更要紧的是：`RingBleManager.ts:3907-3911` 有 **eda → skin 双写**（原生 emit `eda`，UI 读 `extDaily['skin']`），说明 `skin` 和 `eda` 在数据层**确实是两份独立的 store**。那么 `signalKeyFor` 的注释「皮肤含水量 skin 实际走 eda 信号」本身就是**过时且不准确的**。
- 未来若有人信了这条注释，把 `dailyValueFor('skin')` 改成读 `eda`，就会读到「协议无 EDA 的基础版数据」→ 皮肤含水量曲线突然变空。

**建议的修改后代码**（`src/lib/realSeries.ts:44-48`）：

```ts
/**
 * 展示层 key → 「特殊语义类别」判定。
 *
 * ★ 2026-11-06（审计 4-13）：旧实现 `if (metricKey === 'skin') return 'eda'` 是**过时且错误**的。
 *   数据层 `skin` 与 `eda` 是两份独立 store（RingBleManager.ts:3907 有 eda → skin 双写，
 *   因为原生 emit 的 `skin`（skinMoisture）与 `eda`（skin_moisture）语义不同）。
 *   旧特判已无实际作用（`skin` 不匹配任何 sleep 分支），却会让读代码的人误以为 skin 的数据在 eda 里。
 *   这里改为显式的「睡眠类 key」判定，不再做隐式的 key 改写。
 */
const SLEEP_SERIES_KEYS = new Set<string>(['sleepTotal', 'sleepDeep', 'sleepRem', 'sleepScore']);

function signalKeyFor(metricKey: string): string {
  return metricKey;
}
```

并把 `dailyValueFor`（`:111-128`）改为：

```ts
function dailyValueFor(key: string, dk: string): number | null {
  const sk = signalKeyFor(key);
  if (sk === 'steps') {
    const val = healthStore.getDay('steps', dk)?.mean ?? null;
    return val;
  }
  if (SLEEP_SERIES_KEYS.has(sk)) {
    const s = healthStore.getSleep(dk);
    if (!s) return null;
    if (sk === 'sleepTotal') return s.total ?? null;
    if (sk === 'sleepDeep') return s.deep ?? null;
    if (sk === 'sleepRem') return s.rem ?? null;
    return s.score ?? null;
  }
  ...
}
```

---

### 🔵-4 快照恢复：`loadV2` 对旧快照缺失 `derivedDays` / `manualMeasurements` 的兜底不完整

**文件**：`src/data/healthStore.ts:773-812`

**代码片段**：

```ts
  serialize(): string {
    return JSON.stringify({
      schema: SCHEMA_VERSION,
      syncEnabled: this.syncEnabled,
      userProfile: this.userProfile,
      lastSyncDate: this.lastSyncDate,
      stores: this.stores,
      sleep: this.sleep,
      glance: this.glance,
      lastUpdated: this.lastUpdated,
      analysis: this.analysis,
    });
  }

  loadV2(json: any): void {
    if (!json || json.schema !== SCHEMA_VERSION) return;
    for (const k of ALL_METRIC_KEYS) {
      const incoming = json.stores?.[k];
      if (incoming) {
        const hasData =
          Object.keys(incoming.daily ?? {}).length > 0 ||
          Object.keys(incoming.intraday ?? {}).length > 0 ||
          (incoming.manualMeasurements?.length ?? 0) > 0;
        if (hasData || !this.stores[k]) {
          this.stores[k] = incoming;      // ← 整体替换
        }
      } else if (!this.stores[k]) {
        this.stores[k] = emptyStore();
      }
    }
    ...
  }
```

**结论与问题**：

**好消息（已确认正确，无需修改）**：
- `serialize()`（`:773-784`）**完整写入** `stores`（每个 store 内含 `daily` / `intraday` / `manualMeasurements` / `derivedDays`，见 `MetricStore` 定义 `:127-140`）、`sleep`、`glance`、`analysis`。
- `loadV2()` 的 `this.stores[k] = incoming` 是**整体替换**，`derivedDays` 与 `manualMeasurements` 作为 store 的字段会**随快照一起恢复** → **审查项 5 的核心结论：回放是完整的**。
- `RingBleManager.ts:5845-5876` 的 `loadHealthStoreFromDisk` 在 v2 分支额外调 `hydrateSleepFromLegacy(legacySnap?.sleepDaily)`（`:874-885`）补睡眠，且 `hydrateSleepFromSnapshot` 会**按当前公式重算 sleep score**（`:830-873`），避免「改了公式看不出变化」。

**遗留问题**：

1. **`hasData` 判定未计入 `derivedDays`**：
   ```ts
   const hasData =
     Object.keys(incoming.daily ?? {}).length > 0 ||
     Object.keys(incoming.intraday ?? {}).length > 0 ||
     (incoming.manualMeasurements?.length ?? 0) > 0;
   ```
   若某指标的快照里**只有 `derivedDays` 标记**（例如该日的推算值被后续逻辑清空、但标记仍在），`hasData` 为 `false` 且 `this.stores[k]` 已存在 → **该 store 整体被跳过**，`derivedDays` 丢失 → UI 把它当成「实测日」展示，**违反「推算日必须诚实标注」铁律**。
2. **`incoming` 直接赋值，未做结构归一**：`incoming.manualMeasurements` 若在旧快照里是 `null`（而非缺失），`store.manualMeasurements` 会变成 `null` → `getManualMeasurements`（`:506-509`）里 `!store?.manualMeasurements` 为真 → 返回 `[]`（安全），但 `upsertManual`（`:492`）里 `if (!store.manualMeasurements) store.manualMeasurements = []` 会重新初始化（安全）——**目前不炸，但依赖多处 `?? []` 兜底，属于隐性契约**。
3. **`this.stores[k] = incoming` 会丢掉 `emptyStore()` 的字段完整性**：`incoming` 可能来自被外部修改/截断的 JSON，`daily`/`intraday` 可能是 `undefined` → 后续 `store.daily[dk]`（`:406`）会抛 TypeError。

**建议的修改后代码**（`src/data/healthStore.ts:788-812`）：

```ts
  /** 用 v2 结构直接载入（清掉旧状态）。 */
  loadV2(json: any): void {
    if (!json || json.schema !== SCHEMA_VERSION) return;
    for (const k of ALL_METRIC_KEYS) {
      const incoming = json.stores?.[k];
      // ★ v18.111 破坏性覆盖修复：旧版本写盘时若在回填落盘前就存过一次，
      //   快照里 stores 可能是**空壳**。现在：快照里该指标确实没有任何数据时，**保留内存现状**（不清空）。
      if (incoming) {
        const hasData =
          Object.keys(incoming.daily ?? {}).length > 0 ||
          Object.keys(incoming.intraday ?? {}).length > 0 ||
          (incoming.manualMeasurements?.length ?? 0) > 0 ||
          // ★ 2026-11-06（审计 4-14）：derivedDays 也要计入判定。
          //   漏判会导致「只带推算日标记」的 store 被整体跳过 → derivedDays 丢失 →
          //   推算日被当成实测日展示（违反「诚实标注」铁律）。
          Object.keys(incoming.derivedDays ?? {}).length > 0;
        if (hasData || !this.stores[k]) {
          // ★ 结构归一：快照可能来自被截断/外部修改的 JSON，daily/intraday 必须是对象，
          //   否则后续 store.daily[dk] 赋值会抛 TypeError。
          this.stores[k] = {
            daily: (incoming.daily && typeof incoming.daily === 'object') ? incoming.daily : {},
            intraday: (incoming.intraday && typeof incoming.intraday === 'object') ? incoming.intraday : {},
            manualMeasurements: Array.isArray(incoming.manualMeasurements) ? incoming.manualMeasurements : [],
            derivedDays: (incoming.derivedDays && typeof incoming.derivedDays === 'object') ? incoming.derivedDays : undefined,
          };
        }
      } else if (!this.stores[k]) {
        this.stores[k] = emptyStore();
      }
    }
    ...
  }
```

---

### 🔵-5 `EXT_SIGNAL_KEYS` 使用了原生协议里不存在的 key —— 该循环恒空转

**文件**：`src/ble/RingBleManager.ts:4022-4031`

**代码片段**：

```ts
    const EXT_SIGNAL_KEYS = [
      'stress', 'cortisol', 'emotion', 'skin', 'fatigue', 'snsActivation',
      'bpSys', 'bpDia', 'bloodSugar', 'bloodFat', 'uricAcid', 'triglyceride', 'hdl', 'ldl', 'met',
    ];
```

**问题**：

- 列表里的 `'snsActivation'` / `'bloodSugar'` / `'bloodFat'` / `'uricAcid'` 是**展示层历史别名**，原生协议里对应的真实 key 是 `'sns'` / `'glucose'` / `'cholesterol'` / `'ua'`（见本文 §0.1 对照表）。
- 该循环的用途是「把扩展信号的实时均值写进 `extDaily[today]`」，而它读的数据源是 `this.state.metrics[sk]` —— `RingMetrics`（`:264-271`）只有 `hr/spo2/temp/eda/hrv/rr` 六个字段，因此**这 4 个别名 key 读到的必然是 `undefined`**，循环对它们**恒空转**。
- 与 🟡-6 是同一处代码的两个面：写侧用别名、读侧用不存在的字段。

**建议的修改后代码**（`src/ble/RingBleManager.ts:4022-4041`，与 🟡-6 同源，此处给出可独立替换的完整片段）：

```ts
    // ★ 2026-11-06（审计 4-11）：扩展信号写 extDaily[today] 时，读的是 `daily` 而不是 `metrics`。
    //   旧实现读 `this.state.metrics[sk]` —— 但 RingMetrics（:264-271）只有 hr/spo2/temp/eda/hrv/rr
    //   六个核心字段，扩展指标（stress/cortisol/skin/fatigue/sns/…）**从来不写进 metrics**
    //   → 这个循环对扩展信号恒空转，extDaily[today] 里对应字段永远为 undefined。
    //   正确数据源是 `daily`（扩展指标的最新值就写在那里，:3915 / :4136）。
    //
    //   同时修正 key 口径：列表里原来的 'snsActivation' / 'bloodSugar' / 'bloodFat' / 'uricAcid'
    //   是**展示层历史别名**，原生协议里的真实 key 是 'sns' / 'glucose' / 'cholesterol' / 'ua'。
    //   读侧要同时命中两套 key，故用 hsKeyFor(sk) 回退到数据层规范 key。
    const EXT_SIGNAL_KEYS = [
      'stress', 'cortisol', 'emotion', 'skin', 'fatigue', 'sns',
      'bpSys', 'bpDia', 'triglyceride', 'hdl', 'ldl', 'met',
      // 展示别名（对应数据层 glucose / ua / cholesterol）
      'bloodSugar', 'uricAcid', 'bloodFat',
    ];
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    const curExt = { ...this.state.extDaily };
    const prevDay = curExt[todayKey] ?? {};
    let extDirty = false;
    for (const sk of EXT_SIGNAL_KEYS) {
      if (prevDay[sk] != null && prevDay[sk] > 0) continue;
      const dailyRec = daily as unknown as Record<string, number | null>;
      const m = dailyRec[sk] ?? dailyRec[hsKeyFor(sk) ?? sk];
      if (typeof m === 'number' && m > 0) {
        prevDay[sk] = m;
        const hk = hsKeyFor(sk);
        if (hk) healthStore.upsertBackfillDay(hk, todayKey, m);
        extDirty = true;
      }
    }
    if (extDirty) {
      curExt[todayKey] = prevDay;
      this.state = { ...this.state, extDaily: curExt };
    }
```

> 说明：`daily` 变量在 `flushPendingMetrics` 作用域内已存在（`:3915` 处 `daily[m.key] = m.value` 即写它），无需额外取数；若不在该作用域，改用 `this.state.daily` 即可。

---

### 🔵-6 `healthStore.getIntraday` 返回内部数组引用，调用方可意外改动 store

**文件**：`src/data/healthStore.ts:558-562`

**代码片段**：

```ts
  getIntraday(key: MetricKey, dayKeyRaw: string): TimePoint[] {
    const store = this.safeStore(key);
    if (!store) return [];
    const dk = normalizeDayKey(dayKeyRaw);
    return store.intraday[dk] ?? [];
  }
```

**问题**：

- 返回的是 `store.intraday[dk]` 的**直接引用**。调用方若对返回值做 `sort()` / `reverse()` / `push()`，会**原地修改 healthStore 内部状态**。
- 本仓当前**没有**这样的调用点（已全量核查 `getIntraday` 的消费方：`realSeries.ts`、`offlineEstimates.ts`、`MetricDetailScreen.tsx`、`NightBpCard.tsx`、`StatusTrendDetailScreen.tsx`、`EmotionTimeline.tsx`、`BloodPanelTab` 等，均为只读或先 `.filter()`/`.slice()`）—— **因此这不是当前的实际 bug，而是一个未设防的陷阱**。
- 特别地，`NightBpCard.tsx:70-71` 的 `sp[sp.length - 1]` 依赖「数组已按 t 升序」这一**隐式契约**。当前由 `mergeRealtime` / `mergeIntraday` 保证升序，但 `loadV2` 从快照恢复时（🔵-4）**不做排序校验** → 一份被外部改乱顺序的快照会让「最近一次血压」变成「最早一次」。

**建议的修改后代码**（`src/data/healthStore.ts:558-562`）：

```ts
  /**
   * 取某日的逐样本序列（按 t 升序）。
   *
   * ★ 2026-11-06（审计 4-15）：返回**副本**而不是内部数组引用。
   *   旧实现返回 `store.intraday[dk]` 的直接引用 → 调用方一次 sort()/reverse() 就能改坏 store。
   *   同时在此处**显式排序**，把「数组已按 t 升序」从隐式契约变成 API 保证
   *   （NightBpCard 依赖 `pts[pts.length-1]` 取最近一次）。
   */
  getIntraday(key: MetricKey, dayKeyRaw: string): TimePoint[] {
    const store = this.safeStore(key);
    if (!store) return [];
    const dk = normalizeDayKey(dayKeyRaw);
    const arr = store.intraday[dk];
    if (!arr || arr.length === 0) return [];
    // 已升序则直接复制；否则排序后复制（防御快照被外部改乱顺序）
    const sorted = arr.every((p, i) => i === 0 || arr[i - 1].t <= p.t)
      ? arr
      : arr.slice().sort((a, b) => a.t - b.t);
    return sorted.slice();
  }
```

---

## ✅ 已确认「不是问题」的项（避免误报）

| 关注点 | 结论 | 依据 |
|---|---|---|
| `NightBpCard` 的除零 | **已防住**。`dipPct` 有 `dayHr > 0` 守卫；`nightHrMean`/`daytimeHrMean` 的 `out.length ?` 守卫；`sysAvg`/`diaAvg` 的 `length >= 2` 守卫 | `NightBpCard.tsx:42`、`:54`、`:86-87`、`:91-93` |
| `CortisolDailyChart` 的 NaN | **相对安全**。虽然 `:158-168` 显式填 `NaN`，但所有消费点都有 `Number.isFinite` 保护：`hasCos`（`:199`）、`fmtHour`（`:204`）、`fmtAmpPct`（`:210`）、`peakHour`（`:264-278`）、`chrono`（`:279-285`） | `CortisolDailyChart.tsx` |
| `BasicMetricCard` 的 NaN | **已防护**。`:93-102` 过滤 `Number.isFinite(p.t) && Number.isFinite(p.v)`，`:108-111` 的 `yOf` 有 clamp | `BasicMetricCard.tsx:83-111` |
| `SleepDualAxisChart` 的除零 | **已防住**。`durMax` 有 `Math.max(4, ...)` 兜底；`dualPoints` 的 `scores.length ?` 分母保护 | `SleepDualAxisChart.tsx:76`、`SleepDetailScreen.tsx:259-320` |
| `CortisolRhythmCard` 的订阅 | **不是问题**。该组件自身**无任何** healthStore 读取，重渲染完全由父组件 `InsightScreen` 的 `useHealthStoreVersion()`（`:891`/`:1037`/`:1140`）驱动 | 全仓 grep 确认 |
| `MetricDetailScreen` 的订阅 | **正确**。`:655` 有 `useHealthStoreVersion()`，`series` 的 `useMemo`（`:659`）依赖它 → backfill 落库后立即重算 | `MetricDetailScreen.tsx:655-660` |
| `sleep` 快照恢复 | **完整**。`serialize()` 写 `sleep`；`loadV2` 用 `rebuildSleepFromSnapshot` 按当前公式重算 score；`loadHealthStoreFromDisk` 额外用 `hydrateSleepFromLegacy` 补 legacy 睡眠 | `healthStore.ts:773-784`、`:812`、`:830-885`；`RingBleManager.ts:5845-5876` |
| 原生 `depressionRisk` key | **已修正**为 `depressionRisk`，全仓无残留 `'depression'` | `VeepooRing.m:1658`/`:1710`；`grep -rn "'depression'"` 无匹配 |
| `sns` key | **已修正**。原生 emit `sns`（`:1634`/`:1707`），`metrics.ts` 唯一实现也是 `sns`，历史别名 `snsActivation` 仅作向后兼容映射保留 | `VeepooRing.m:1634`；`metrics.ts:377` |

---

## 附：修复优先级建议

| 顺序 | 问题 | 理由 |
|---|---|---|
| 1 | 🔴-3 `depressionRisk` 零值被丢弃 | 影响真实用户可见功能（抑郁风险卡恒空），改动最小、收益最直接 |
| 2 | 🔴-2 `handleRealtime` 绕过 `hsKeyFor` | 消除「key 不一致静默丢弃」的复发路径，改动集中在一个函数 |
| 3 | 🔴-4 `finalize` 的 NaN 过滤 | 防止 iOS 原生 SVG 硬退出崩溃（`BasicMetricCard.tsx:92` 已给出警示） |
| 4 | 🔴-1 `hsKeyFor` 统一 | 结构性治理，可一次消除后续同类问题的土壤 |
| 5 | 🟡-5 补齐 11 处订阅 | 用户可感知的「数据有但页面空」，批量改动、风险低 |
| 6 | 🟡-4 `mergeIntraday` 邻域覆盖 | 数据保真，涉及历史回填正确性 |
| 7 | 🟡-6 `RingState.daily` 双写 | 血糖/尿酸卡片显示 |
| 8 | 🟡-1 / 🟡-2 图表 NaN 与 clamp | 显示正确性 |
| 9 | 🟡-3 `NightBpCard` 负 dip 语义 | 文案准确性 |
| 10 | 🔵 各项 | 健壮性与一致性 |

---

共 16 个问题（🔴 4 / 🟡 6 / 🔵 6）
