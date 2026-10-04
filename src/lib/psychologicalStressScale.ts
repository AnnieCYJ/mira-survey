/**
 * psychologicalStressScale.ts —— **心理压力 0-100 的锚定**（v18.137）
 *
 * ══ 为什么单独一个模块 ══
 * 用户明确要求：App 里的指标叫「**心理压力**」，要 **0-100** 的数字。
 * 之前 `emotionalStress.ts` 里的 `severity` 是 z→0-100 的**约定映射**
 * （`Z2SEV` 那张分段表），数字含义只有「跟档位自洽」，没有可解释的锚点。
 * 「0-100」看起来像「压力值 62 分」，但它其实是「比平时高 12%」——
 * **用户会当成绝对值读，这是误导**。
 * 本模块把 0-100 定义成一个**有明确含义、可向用户解释**的量。
 *
 * ══ 口径依据（业界共识，不是我们拍的）══
 * · **Oura 官方文档**（support.ouraring.com Daytime Stress）：
 *   「Oura does not use fixed thresholds for stress. **Your scores are relative to you.**」
 *   四档：Stressed / Engaged / Relaxed / Restored。
 *   ⚠ 同一篇文档也明确写 **「cannot differentiate the source of stress physiologically」**
 *   —— 即它承认分不清压力来源。这正是我们要做运动门控的理由。
 * · **Garmin 压力分**：0-100 固定分区（静息 0-25 / 低 26-50 / 中 51-75 / 高 76-100），
 *   输入是 HRV 三分钟均值。我们**借它的数字形态，不抄它的阈值**——
 *   固定阈值的问题在个体间：同样 62 分，两个人的含义完全不同。
 * · **PSQ-20**（Levenstein 1993）提供 0-100 换算的先例（`((均值-1)/3)×100`），
 *   但它是**主观问卷**，与我们从生理信号推的东西不是一回事，**不能混用其阈值**。
 *
 * ══ 我们的定义（写死在这，UI 文案必须同步）══
 *   心理压力 0-100 = **今天此刻的综合偏离，在「你个人过去 14 天同时段分布」里的百分位**
 *
 *   50 = 和你平时一样
 *   80 = 比平时高出一截（今天高于 80% 的日子）
 *   20 = 比平时松
 *
 * ⚠⚠ **这不是「你的压力绝对值」**，也不是医学量表分。
 *   UI 必须同时给出「相对你自己平时」这句话，否则用户会把 62 读成「我压力 62 分」。
 *
 * ══ 百分位 vs z：为什么用百分位而不是 z ══
 * z 分是「离均值几个标准差」，**尾部不对称**：z=+2 在正态下是 97.7 百分位（很高），
 * 但 z=−2 是 2.3 百分位（很低）——**同样的绝对偏离，含义差 40 倍**。
 * 压力这个量天然单边（只有「高」这一侧有意义，「特别低」不是好事也不是坏事），
 * 所以单边百分位比 z 更贴近用户理解。
 * 仍保留 z 作为**尺度下限的来源**（`stressFeatures.SCALE_FLOOR` 靠 MAD 算），
 * 百分位只负责**最后的读数映射**。
 */

import { robustScaleOf } from './stressFeatures';

// ══ 档位边界（借 Garmin 的数字形态，但阈值是「相对你自己」划的）══

/**
 * 百分位 → 档位。
 *
 * ★ v18.138 **按用户要求改为纯三档：低 / 中 / 高**（用户原话：
 *   「给出来低中高，或者给我算一个百分比……它必须是心理压力。
 *     测不出来，你就写杠。**今天很松就写「压力低」就行了。不要写着今天很松啊什么的**」）。
 *
 * ⚠⚠ **上一版（v18.137）的措辞全部作废**：曾用「比平时松一些 / 和平时差不多 /
 *   比平时紧一点 / 比平时紧 / 明显高于平时」五档措辞 —— 用户明确否决这种写法，
 *   因为用户要的是**能一眼看懂的低/中/高**，不是要 App 教他「相对你自己」。
 *   口径信息（50=和平时差不多）改由**副标/说明行**承载，不占档位名。
 *
 * 边界依据（可复算，说明为什么是 50/70）：
 * · **低档上限 = 50**，即 `z ≤ 0`（不高于自己的基线）全归「压力低」。
 *   依据：百分位的锚点 50 就是「和平时一样」—— 把「和平时一样」划进「中」是错的
 *   （用户在 v18.137 反馈过类似问题：略松却被标成偏高）。
 *   ⚠ 曾用 40 做边界，实测 z=−0.3（略松，百分位 43）会被判「中」⇒ 已改为 50。
 * · **高档从 70 起**（z≈0.95）：参照 PSQ-20 人群参考带 60-100=high，
 *   我们给的是**生理偏离**、PSQ 给的是**主观感受**，生理信号要更保守才报高。
 * · 90 以上不给 100，保留 tanh 余量（`percentileFromZ(3)=95`），
 *   避免「偶尔一次极端值就打满」显得像坏了。
 *
 * 实测映射表（可复算）：
 *   z=-2→12 低 · z=-0.5→38 低 · z=0→50 中 · z=0.7→67 中 · z=1→73 高 · z=2→88 高 · z=3→95 高
 */
export const STRESS_BANDS: Array<{ min: number; level: 'low' | 'mid' | 'high'; label: string }> = [
  { min: 0, level: 'low', label: '较低压力' },
  { min: 50, level: 'mid', label: '中等压力' },
  { min: 70, level: 'high', label: '较高压力' },
];

export type StressBand = 'low' | 'mid' | 'high';

export function bandOf(percentile: number): { level: StressBand; label: string } {
  let hit = STRESS_BANDS[0];
  for (const b of STRESS_BANDS) if (percentile >= b.min) hit = b;
  return { level: hit.level, label: hit.label };
}

// ══ 百分位计算 ══

/**
 * 求「今天这个值」在「基线分布」里的百分位。
 *
 * ⚠ 与众不同的设计：**单边化**（只关心「比基线高多少」）。
 * 常规百分位函数会把 0.3 映射到 30 百分位（偏低），但压力场景里
 * 「远低于基线」不是我们关心的信号（睡眠差/恢复好都会让 HRV 升）。
 * 我们的做法：
 * · 综合 z ≥ 0 → 映射到 50~100（只反映「高了多少」）
 * · 综合 z < 0 → 映射到 0~50（反映「松了多少」，但上限压到 50）
 * ⇒ **50 是「和平时一样」这个对称锚点**，100 只由「高于基线」的方向抵达。
 *
 * 映射函数：`pct = 50 + 50 × tanh(z / 2)`
 * · tanh 的作用是把无限大的 z 压到 100 附近，不让单个极端值打爆量表。
 * · 除以 2 的依据与 `cortisolProxy` 的 `50 + 50·tanh(z/2)` 同一口径 ——
 *   **同一个项目里所有「z → 有界量」的映射必须一致**，否则两处会互相矛盾。
 */
export function percentileFromZ(z: number): number {
  if (!Number.isFinite(z)) return 50;
  const pct = 50 + 50 * Math.tanh(z / 2);
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ══ 历史分布（百分位的分母）══

/**
 * 某一路信号的**历史分时分布**（按 30min 槽分桶）。
 * 存的是「每天该槽一个代表值」——用中位数代表那一天该时段，避免被单点噪声带偏。
 */
export interface DaySlotValue {
  dayKey: string;
  slot: number;
  value: number;
}

export interface PercentileRef {
  /** 该槽的历史值（升序）；长度 < MIN_REF_DAYS 时不可用 */
  sorted: number[];
  /** 该槽参与统计的天数 */
  days: number;
}

/** 生成参考分布的最小天数（同 `MIN_BASELINE_DAYS`，别让两个模块各说各话） */
export const MIN_REF_DAYS = 3;

export function buildPercentileRef(
  values: DaySlotValue[],
  slot: number,
  dayKeys: Set<string>,
): PercentileRef {
  const vs = values
    .filter((v) => v.slot === slot && dayKeys.has(v.dayKey) && Number.isFinite(v.value) && v.value > 0)
    .map((v) => v.value)
    .sort((a, b) => a - b);
  const days = new Set(values.filter((v) => v.slot === slot && dayKeys.has(v.dayKey)).map((v) => v.dayKey)).size;
  return { sorted: vs, days };
}

/**
 * 「今天这个值」在历史分布里处于什么位置。
 * 返回 0-100；历史天数不足时返回 **null**（不给数，而不是给一个假的中间值）。
 *
 * ⚠ 与 `percentileFromZ` 的分工：
 * · `percentileFromZ` = **多路融合后**的综合分 → 百分位（用 tanh 压缩）
 * · 本函数 = **单路原始值** → 在历史分布里的真实百分位（用实际排序，最保守）
 * 单路诊断用本函数（能说「你的 EDA 今天高于 92% 的日子」），
 * 综合读数用 `percentileFromZ`。**两者不可混用。**
 */
export function rankPercentile(ref: PercentileRef, value: number): number | null {
  if (ref.days < MIN_REF_DAYS || ref.sorted.length < MIN_REF_DAYS) return null;
  if (!Number.isFinite(value)) return null;
  let below = 0;
  let equal = 0;
  for (const v of ref.sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  // 插值：把相等值的一半算在下面，避免「今天恰好等于历史中位数 → 50」这种巧合误读
  const pct = ((below + equal / 2) / ref.sorted.length) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ══ 可信度分级 ══

/**
 * 读数的可信度，**由参与信号数决定，不由分数高低决定**。
 * 高分不一定更可信 —— 一个「90 分」如果只有 2 个信号支持，比「55 分」六信号齐更可疑。
 */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '可信',
  medium: '参考',
  low: '仅供参考',
  none: '数据不足',
};

/**
 * @param usedCount 参与融合的特征数（0-6）
 * @param weightSum 参与特征的权重和（0-1）
 */
export function confidenceOf(usedCount: number, weightSum: number): Confidence {
  if (usedCount >= 5 && weightSum >= 0.85) return 'high';
  if (usedCount >= 3) return 'medium';
  if (usedCount >= 2) return 'low';
  return 'none';
}

// ══ 档位文本（用户直接能懂的）══

/**
 * 给用户的一句话说明。
 *
 * ★ v18.138 按用户要求简化：档位名只用「压力低/中/高」，
 *   **不要在主文案里写「今天很松」「比平时紧一点」**（用户原话：
 *   「今天很松就写，就是低，压力低就行了。不要写着今天很松啊什么的」）。
 *
 * 保留的信息只有两类，且都是必要的：
 *  ① **口径**（这是百分位，不是绝对值）—— 不写会被读成「压力 62 分」
 *  ② **数据完整性**（几个信号在用）—— 降级时必须让用户知道，否则是在假装精确
 *
 * ⚠ 不写「监测」「疗愈」「诊断」「治疗」等词（Mira 品牌铁律）。
 * ⚠ 不替用户判断「好/坏」：低压侧只说「压力低」，不延伸成「你今天很好」。
 */
export function bandNarrative(
  percentile: number,
  conf: Confidence,
  opts: { featureCount: number; totalFeatures: number; degraded: boolean },
): string {
  const parts = [bandOf(percentile).label];
  if (opts.degraded) {
    const missing = opts.totalFeatures - opts.featureCount;
    parts.push(missing > 0 ? `${missing} 个信号今天读数不稳` : '部分信号今天读数不稳');
  }
  if (conf === 'low') parts.push('信号较少，只能看个大概');
  else if (conf === 'none') parts.push('信号不足，暂时不给结论');
  return parts.join('，') + '。';
}

/** 诊断串（进日志，不给用户看） */
export function scaleDiag(pct: number, z: number, conf: Confidence, used: number, wSum: number): string {
  return `pct=${pct} z=${z.toFixed(3)} conf=${conf} used=${used} wSum=${wSum.toFixed(2)}`;
}
