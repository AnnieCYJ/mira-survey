/**
 * ══ recencyBaseline ══ 时间加权基线（v18.143）
 *
 * ══ 为什么需要它（这是我们明确落后于 Garmin / Oura 的地方）══
 * 现实现是「14 天**等权**中位数」⇒ 15 天前的一次熬夜，和昨天的熬夜对基线影响一样大。
 * 但生理系统的基线是**会移动的**：
 * · Garmin HRV 基线 = **25 夜滚动平均，加权偏向近期**，每天更新
 *   （来源：clearcals.com 引 Garmin 官方：「rolling 25-night average, weighted toward
 *   recent values, that updates daily」）
 * · Oura HRV Balance = 近 2 周滚动平均 vs 近 3 个月基线，
 *   官方原文「**puts more weight on recent days** to better reflect the fluctuations」
 *   （来源：ouraring.com/blog/hrv-balance）
 * · EWMA / 时间加权基线是训练负荷监测里的标准做法
 *   （运动医学 SOP：「不用固定『第一周基线永远不变』，而用滚动窗口或指数加权移动平均，
 *     给近期数据更大权重」）
 *
 * ⇒ 不加权的后果很具体：**昨晚的高强度训练 / 一次熬夜，在我们的基线里被稀释成 1/14**，
 *   所以「今天比平时高」这种最该被发现的信号，我们的分看不见。
 *
 * ══ 半衰期 7 天是产品决策，不是文献结论 ══
 * 上面三家的官方文档都只说「加权偏向近期」，**都没给具体数值**。
 * 我们选 7 天的理由（可复算）：
 * · 与我们的窗口一致：`BASELINE_DAYS = 14` = 2 个半衰期 ⇒ 最老那天的权重只剩 25%，
 *   也就是说「两周前的事还有四分之一的话语权」，不至于完全失忆。
 * · HRV 一次高强度训练后的压抑持续 12–48 小时（clearcals 引文献），
 *   而恢复性超量（超量恢复）在 2–3 天内（同一来源）⇒ 半衰期不该短于 3 天。
 * · 11 天及以上的数据价值已经很低 ⇒ 半衰期不该长于 10 天。
 * ⚠ 若要改，只改这一个常量；**不要**在不同模块各写一个。
 */

/** 基线窗口天数（与 emotionalStress.BASELINE_DAYS 保持一致） */
export const BASELINE_DAYS = 14;

/**
 * 权重半衰期（天）。7 天 ⇒ 权重序列 1.0, 0.91, 0.83, …, 0.25（14 天前）。
 * ⚠ **产品决策，非文献结论**，理由见本文件头注。
 */
export const RECENCY_HALF_LIFE_DAYS = 7;

/** 权重地板：避免极远期的样本权重趋零后彻底「失忆」 */
const MIN_WEIGHT = 0.05;

/**
 * 某一天相对今天（`daysAgo` 天前）的权重。
 * 指数衰减：`w = 0.5 ^ (daysAgo / halfLife)`，即每过 7 天权重减半。
 * @param daysAgo 0 = 今天（今天不参与基线，但函数本身不做排除）
 */
export function dayWeight(daysAgo: number, halfLife = RECENCY_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(daysAgo) || daysAgo < 0) return 1;
  const hl = halfLife > 0 ? halfLife : RECENCY_HALF_LIFE_DAYS;
  return Math.max(MIN_WEIGHT, Math.pow(0.5, daysAgo / hl));
}

/** 带权样本。`daysAgo` 越大（越久远）权重越低。 */
export interface WeightedSample {
  v: number;
  /** 距今天的天数（用于算权重）；调用方也可以直接填 `w` */
  daysAgo: number;
}

/**
 * ══ ★ 为什么中心估计量用「截尾加权均值」而不是「加权中位数」 ══
 *
 * ★ v18.143 自测实锤的坑：先实现的是**加权中位数**，自测立刻显示
 *   「7 天正常 + 昨天骤升」场景下，加权基线与等权基线**完全相同（50 vs 50，差异 0.0）**。
 *   原因很硬：单个异常样本的权重只占权重总和的 1/7.2 ≈ **14%**，
 *   **推不动中位数**（中位数是鲁棒估计，本来就免疫少数离群点）。
 *   ⇒ 「加权中位数」看起来有加权，实际对单日突变的响应是**零**，等于没做。
 *
 * 但换成纯加权均值又会让**单个设备异常值直接带跑基线**
 * （真机实测过 EDA 一夜从 28μS 漂到 95μS，单点就能把基线抬 2.6 倍 —— v18.135 实锤）。
 *
 * ⇒ 解法：**截尾（winsorize）+ 加权均值**。
 *   1. 先用加权分位数把样本截到 [P_LO, P_HI]，离群点只贡献「到边界」这么多；
 *   2. 再算加权均值 ⇒ **连续 2-3 天的真实偏移能把基线拉过去，单日异常不能**。
 *   3. 尺度仍用**加权 MAD**（鲁棒，不受截尾影响）⇒ z 的分母稳定。
 *
 * ⚠ 截尾分位点（默认 10%/90%）是**产品决策，非文献结论**。
 *   取 10/90 而不是 5/95：14 天 × 48 槽的数据量下，5% 会把真实的生理日间差异也截掉
 *   （我们已经有 MAD 尺度兜底，不需要过度截尾）。
 */
export const WINSOR_LO_PCT = 0.10;
export const WINSOR_HI_PCT = 0.90;

/**
 * 加权分位数。`pct` ∈ [0,1]。
 */
export function weightedQuantile(samples: WeightedSample[], pct: number, halfLife = RECENCY_HALF_LIFE_DAYS): number | null {
  const pts = samples
    .filter((s) => s.v != null && Number.isFinite(s.v))
    .map((s) => ({ v: s.v, w: dayWeight(s.daysAgo, halfLife) }))
    .sort((a, b) => a.v - b.v);
  if (!pts.length) return null;
  const p = Math.max(0, Math.min(1, pct));
  const total = pts.reduce((a, q) => a + q.w, 0);
  const target = total * p;
  let acc = 0;
  for (const q of pts) {
    acc += q.w;
    if (acc >= target) return q.v;
  }
  return pts[pts.length - 1].v;
}

/**
 * 截尾加权均值 —— **基线中心**的估计量。
 * 理由见上方「为什么中心估计量用截尾加权均值」的长注释（v18.143 自测实锤）。
 * @returns null 表示无有效样本
 */
export function weightedCenter(
  samples: WeightedSample[],
  halfLife = RECENCY_HALF_LIFE_DAYS,
): number | null {
  const pts = samples.filter((s) => s.v != null && Number.isFinite(s.v));
  if (!pts.length) return null;
  if (pts.length < 3) return weightedMedian(pts, halfLife);   // 样本太少，截尾无意义，退回中位
  const lo = weightedQuantile(pts, WINSOR_LO_PCT, halfLife);
  const hi = weightedQuantile(pts, WINSOR_HI_PCT, halfLife);
  if (lo == null || hi == null) return null;
  let num = 0;
  let den = 0;
  for (const s of pts) {
    const v = Math.max(lo, Math.min(hi, s.v));     // 截尾
    const w = dayWeight(s.daysAgo, halfLife);
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * 加权中位数（保留：样本不足时用；也用于「基线中心」的对账测试）。
 * ⚠ 不能用「按权重重复元素」的近似做法 —— 权重是小数时会引入量化误差，
 *   而我们的权重是 `0.5^(k/7)` 这种无理数，重复法会把权重悄悄取整。
 * 正确做法：按值排序后取「累计权重首次过半」的那个值。
 */
export function weightedMedian(samples: WeightedSample[], halfLife = RECENCY_HALF_LIFE_DAYS): number | null {
  const pts = samples
    .filter((s) => s.v != null && Number.isFinite(s.v))
    .map((s) => ({ v: s.v, w: dayWeight(s.daysAgo, halfLife) }))
    .sort((a, b) => a.v - b.v);
  if (!pts.length) return null;
  const total = pts.reduce((a, p) => a + p.w, 0);
  const half = total / 2;
  let acc = 0;
  for (const p of pts) {
    acc += p.w;
    if (acc >= half) return p.v;
  }
  return pts[pts.length - 1].v;
}

/**
 * 加权 MAD × 1.4826（≈正态下的标准差）。
 * 与 `weightedMedian` 同口径：先取加权中位，再对「到中位的加权绝对偏差」取加权中位。
 * @returns null 表示「样本退化」—— 历史上这个时段几乎没有真实波动，
 *          调用方**必须**区分它与「样本不足」（后者才允许回退全池）。
 */
export function weightedRobustScale(
  samples: WeightedSample[],
  halfLife = RECENCY_HALF_LIFE_DAYS,
): number | null {
  const pts = samples.filter((s) => s.v != null && Number.isFinite(s.v));
  if (pts.length < 2) return null;
  const med = weightedMedian(pts, halfLife);
  if (med == null) return null;
  // ⚠ 偏差样本必须**保留原来的 daysAgo** —— 越久远的样本对 MAD 的影响也越小，
  //   若在此处丢成等权，等于「中位用加权、离散度用等权」的混合口径。
  const devs: WeightedSample[] = pts.map((p) => ({ v: Math.abs(p.v - med), daysAgo: p.daysAgo }));
  const mad = weightedMedian(devs, halfLife);
  if (mad == null) return null;
  const sigma = mad * 1.4826;
  // 退化（历史几乎无波动）：交给调用方判「基线不可信」，不要回退全池。
  return sigma > 1e-6 ? sigma : null;
}

/**
 * 加权全池版本：把所有槽的样本混在一起算（槽级缺失时的回退 + 漂移判定用）。
 * ⚠ **跨槽混算时必须带 `daysAgo`**，否则早期槽（先 push）会系统性拿到高权重。
 */
export function poolSamples(
  perSlot: Map<number, WeightedSample[]>,
): WeightedSample[] {
  const out: WeightedSample[] = [];
  for (const arr of perSlot.values()) out.push(...arr);
  return out;
}

/** 便于测试/诊断：把权重序列打出来 */
export function weightSeries(nDays: number, halfLife = RECENCY_HALF_LIFE_DAYS): number[] {
  const out: number[] = [];
  for (let i = 1; i <= nDays; i++) out.push(Number(dayWeight(i, halfLife).toFixed(4)));
  return out;
}
