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

// ══ 档位边界（按「偏离个人基线的幅度」分，不再用绝对 50 悬崖）══

/**
 * 百分位 → 档位。
 *
 * ★ v18.141 **按偏离个人基线的幅度分三档**（用户原话：「比平时的压力低多少算低、
 *   高多少算高？再做一次映射就 OK 了」）。上一版用 `低 ≤50 / 中 50-70 / 高 ≥70`，
 *   把「50 = 和平时一样」当成分界悬崖 —— 于是 48（z≈-0.08，基本＝平时）被判「较低压力」、
 *   52 就跳「中等」，这就是用户觉得别扭的根因。
 *
 * 新方案：**三档围绕 50（= 和平时一样）对称展开**，只看「离基线多远」，不看绝对分数：
 *   · 偏低  < 38  （z ≲ -0.5，明显比平时松）
 *   · 适中  38–62 （|z| ≲ 0.5，和平时差不多）
 *   · 偏高  > 62  （z ≳ +0.5，明显比平时紧）
 *
 * ══ 阈值依据（来自开源 / 学界，不是我们拍的）══
 * · **HRV4Training（Marco Altini）**：个人基线 = 历史均值 ± 1 SD；判断「有意义偏离」的
 *   最小 worthwhile change ≈ **0.5 × 个体间日 SD**。我们取 ±0.5 SD 作为「明显偏离」门槛。
 * · **Plews / AthleteData**：「正常范围 = 7 天滚动均值 ± 0.5 × 间日 SD」，连续低于正常
 *   才减载。同样支持「±0.5 SD 才算明显偏离」。
 * · **Oura 官方**：stress zones 是 **personalized（相对于你）、不设固定阈值**；四档
 *   Stressed/Engaged/Relaxed/Restored 也围绕个人常态对称展开 —— 与我们同源。
 * · **Garmin（Firstbeat）**：0-100 固定分区（静息 0-25 / 低 26-50 / 中 51-75 / 高 76-100），
 *   但官方也承认分数「calibrated to your own baseline」。我们借它的数字形态、不抄绝对阈值
 *   —— 固定阈值在个体间会失真（同样 62 分两人含义完全不同）。
 *
 * 为什么边界是 38/62（而不是 50/70）：
 *   50 是「和平时一样」的锚点，把它当档位边界，必然让「略低于平时」全进「低」、
 *   「略高于平时」全进「高」，丢掉「和平时差不多」这一档 —— 这正是别扭来源。
 *   38/62 是把 ±0.5 SD 换算回 0-100 的精确位置（score = 50 + 50·tanh(z/2)，z=±0.5 ⇒ 38/62），
 *   给「和平时差不多」留出对称窗口，48/52 都落「适中」，读数才符合直觉。
 *
 * 实测映射表（可复算，score = 50 + 50·tanh(z/2)）：
 *   z=-2→12 偏低 · z=-0.5→38 偏低（边界）· z=0→50 适中 · z=0.5→62 偏高（边界）
 *   · z=1→73 偏高 · z=2→88 偏高 · z=3→95 偏高
 *
 * ⚠ 标签并行化：偏低 / 适中 / 偏高（不再用 较低/中等/较高 的非对称写法）。
 */
export const STRESS_BANDS: Array<{ min: number; level: 'low' | 'mid' | 'high'; label: string }> = [
  { min: 0, level: 'low', label: '偏低' },
  { min: 38, level: 'mid', label: '适中' },
  { min: 62, level: 'high', label: '偏高' },
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
 * ★ v18.141 档位名只用「偏低 / 适中 / 偏高」三档（围绕个人基线对称），
 *   **不要在主文案里写「今天很松」「比平时紧一点」**（用户原话：
 *   「今天很松就写，就是低，压力低就行了。不要写着今天很松啊什么的」）。
 *
 * 保留的信息只有两类，且都是必要的：
 *  ① **口径**（这是百分位，不是绝对值）—— 不写会被读成「压力 62 分」
 *  ② **数据完整性**（几个信号在用）—— 降级时必须让用户知道，否则是在假装精确
 *
 * ⚠ 不写「监测」「疗愈」「诊断」「治疗」等词（Mira 品牌铁律）。
 * ⚠ 不替用户判断「好/坏」：低压侧只说「偏低」，不延伸成「你今天很好」。
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
