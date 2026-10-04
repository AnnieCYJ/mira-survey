/**
 * ══ sleepBaseline ══ 睡眠的个人基线 + 规律性（v18.144）
 *
 * ══ 为什么要改：绝对达标分 vs 个人相对分 ══
 * 旧 `sleepScore.ts` 是**绝对达标分**：7.5h 满分、深睡 ≥20% 满分、效率 ≥85% 满分。
 * 问题很具体：
 * · 睡 7.5h 但平时只睡 6h → 旧口径给满分，实际上是「比平时多睡」；
 * · 睡 9h 但平时也睡 9h → 旧口径**轻扣分**（>8.5h 线性降到 0.7），完全不合理。
 * Oura 官方明确相反：**「total sleep from the past 24 hours compared against your baseline」**，
 * 且 App 需要**最多两周**来学习你的个人平均值 ⇒ 之后一律按「比自己平时」判。
 * 这也是它与其他可穿戴的核心差异：别人看「今天和昨夜」，Oura 看「今天和你」。
 *
 * ══ 规律性（Sleep Regularity）的算法与依据 ══
 * 口径：**睡眠中点的标准差**（不是就寝时刻，也不是起床时刻各自的 sd）。
 * 依据链（都有出处，不是拍的）：
 * · **睡眠中点定义**：入睡与起床的中点（10:30pm 入睡、6:30am 起床 → 中点 2:30am），
 *   出自 Sleep Regularity Index 的标准计算法（gethealthycalculators 综述）。
 * · **阈值**：中点 sd < 30min = 高规律；> 60min = 低规律，
 *   对应 Windred 2024 **SLEEP**（UK Biobank n=60,977）的死亡率五分位分组。
 * · **锚起床时刻比锚入睡时刻更重要**：节律研究中晨间光照是 SCN 授时的主 zeitgeber，
 *   而起床时刻决定晨光暴露 ⇒ 补分应以 wake 为锚（alivelongevity 综述引用）。
 *   ⚠ 这也是我们把「起床时刻 sd」的权重设得比「入睡时刻 sd」高的原因。
 * · Oura 自己怎么算的未公开，只说「measures how consistent your bedtime and wake-up
 *   times have been during the previous two weeks」，且**小睡不计入**
 *   ⇒ 我们也**只用主睡眠**（`healthStore.sleep` 本身就是主睡眠），排除 nap。
 *
 * ══ 冷启动策略（重要，别照抄 Oura 的「两周」）══
 * Oura 要求两周，但我们的用户第 1 天就该看到分。所以是**混合口径**：
 * · `baselineDays >= MIN_RELATIVE_DAYS(5)` → 用**时间加权**的个人相对分（与 Oura 一致）
 * · `< 5` → 退回**绝对达标分**（旧口径），并在返回值里明确标 `mode: 'absolute'`
 *   ⚠ 关键：UI 必须能区分这两种口径，否则用户第 3 天看到 78、第 6 天看到 62
 *   会以为分数「忽高忽低」，而实际是口径切换。**这条比算法本身更重要。**
 */

import { weightedCenter, type WeightedSample } from './recencyBaseline';

// ── 常量 ────────────────────────────────────────────────────────────────

/** 基线窗口天数（与 recencyBaseline 的窗口一致，便于复用加权逻辑） */
export const SLEEP_BASELINE_DAYS = 14;

/**
 * 进入「个人相对」口径所需的最少基线天数。
 * ⚠ **产品决策，非 Oura 的两周**。取 5 天的理由：睡眠是最稳定的生理量之一，
 *   5 夜已能形成可用的个人中位数；且不愿让新用户看到一整周的绝对分。
 *   Oura 要求两周是因为它同时要学 9 个因子的基线，我们只有睡眠一个。
 */
export const MIN_RELATIVE_DAYS = 5;

/** 中点 sd 的规律性档位（分钟）—— 依据 Windred 2024 SLEEP 的分组 */
export const REGULARITY_SD_GOOD = 30;   // < 30min = 高规律
export const REGULARITY_SD_POOR = 60;   // > 60min = 低规律

/**
 * 规律性分的**下限**（sd ≥ 60min 时取这个值）。
 * 不用 0 的理由：0 分在 UI 上会被读成「完全没有规律性信息」，而实际是「数据很乱」。
 * 8 分既明确是低分，又留出「明天可以改善」的语义。
 */
export const REG_SCORE_FLOOR = 8;

/**
 * 规律性分的**上限**。
 * ⚠ 取 96 而非 100 的依据：**Oura 官方明确写「100s are designed to be rare rather than
 * regular」**（ouraring.com/blog/readiness-score）。规律性是一个「连续 7~14 天作息」的结果，
 * 拿 100 分会让「偶尔一周作息规律」被显示成「完美」，反而降低可信度。
 * ⇒ 最规律也只能拿 96。
 */
export const REG_SCORE_CEIL = 96;

// ── 类型 ────────────────────────────────────────────────────────────────

export interface SleepBaselineInput {
  /** 总睡眠时长（分钟） */
  total: number;
  /** 深睡分钟数 */
  deep: number;
  /** 清醒 + 失眠分钟数（可空 = 不参与该项） */
  awakePlusInsomnia?: number | null;
  /** 起夜次数 */
  getUp?: number | null;
  /** 入睡小时 0-23（浮点，来自 sleepTime） */
  bedHour?: number | null;
  /** 起床小时 0-23（浮点，来自 wakeTime） */
  wakeHour?: number | null;
  /** 距今天数（0 = 今天；基线里的样本恒 ≥1） */
  daysAgo: number;
}

export interface SleepBaseline {
  /** 时间加权的个人基线中心（截尾加权均值）；样本不足时为 null */
  center: number | null;
  /** 参与基线的天数 */
  days: number;
  /** 达到个人相对口径了吗 */
  ready: boolean;
}

export interface RegularityResult {
  /**
   * 规律性分 0-100（100 = 极规律）。
   * ⚠ 数据不足时为 null，**不要给假分**（与「空态铁律」一致）。
   */
  score: number | null;
  /** 睡眠中点的标准差（分钟）；null = 样本不足 */
  midSdMin: number | null;
  /** 起床时刻标准差（分钟）；null = 样本不足 */
  wakeSdMin: number | null;
  /** 入睡时刻标准差（分钟）；null = 样本不足 */
  bedSdMin: number | null;
  /** 参与计算的天数 */
  days: number;
}

// ── 工具 ────────────────────────────────────────────────────────────────

/** 单日睡眠的三个核心量（用于构建基线与规律性） */
function extract(s: SleepBaselineInput): { total: number; deepPct: number; eff: number | null } {
  const total = s.total;
  const deepPct = total > 0 ? ((s.deep ?? 0) / total) * 100 : 0;
  const aw = s.awakePlusInsomnia;
  const eff = aw != null && Number.isFinite(aw) && total > 0
    ? Math.max(0, (total - aw) / total) * 100
    : null;
  return { total, deepPct, eff };
}

/** 标准差（样本 σ，n-1 分母）。样本 <2 返回 null。 */
function stdev(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const varSum = v.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return Math.sqrt(varSum / (v.length - 1));
}

/**
 * 睡眠中点（小时，0-24 的浮点，可跨午夜）。
 * 入睡 22:30、起床 06:30 → 中点 = (22.5 + 30.5) / 2 = 26.5 → 折回 2.5
 * ⚠ 必须处理跨午夜：起床时刻若 ≤ 入睡时刻，说明跨过 0 点，加 24。
 */
export function sleepMidpointHour(bedHour: number, wakeHour: number): number {
  let w = wakeHour;
  if (w <= bedHour) w += 24;          // 跨午夜
  const m = (bedHour + w) / 2;
  return m >= 24 ? m - 24 : m;        // 折回 [0,24)
}

/**
 * 把「小时 + 跨午夜展开」的中点转成**可比的角度差**。
 * 关键：23:30 与 00:30 的中点只差 1 小时，但在 0/24 处断开会导致
 * 直接相减得到 23 小时 ⇒ sd 被严重放大。解法是**以 23:00 附近为原点展开**。
 */
function unwrapMidpoints(mids: number[]): number[] {
  if (mids.length < 2) return mids;
  const ref = mids[0];
  return mids.map((m) => {
    let x = m;
    // 与参考点差 >12h 时，跨 24 展开（人的作息不会跨 12h 以上）
    if (x - ref > 12) x -= 24;
    else if (ref - x > 12) x += 24;
    return x;
  });
}

// ── 1) 个人基线 ─────────────────────────────────────────────────────────

/**
 * 建睡眠的个人基线（时间加权截尾均值）。
 *
 * ★ 为什么用「加权中心 + 时间加权 MAD」而不是「对比基线的偏离」：
 * 与心理压力同一套逻辑（recencyBaseline），保证全项目 z→分口径一致。
 */
export function buildSleepBaseline(
  samples: SleepBaselineInput[],
  halfLifeDays?: number,
): SleepBaseline {
  const valid = samples.filter((s) => s.total > 0);
  // 三个维度各建一条中心线（量纲不同不能混）
  const w = (v: number, d: number): WeightedSample => ({ v, daysAgo: d });
  const totalSamples: WeightedSample[] = valid.map((s) => w(s.total, s.daysAgo));
  const deepSamples: WeightedSample[] = valid.map((s) => w(extract(s).deepPct, s.daysAgo));
  const days = valid.length;

  if (days < MIN_RELATIVE_DAYS) {
    return { center: null, days, ready: false };
  }
  return {
    center: weightedCenter(totalSamples, halfLifeDays),
    days,
    ready: true,
  };
}

// ── 2) 规律性 ────────────────────────────────────────────────────────────

/**
 * 算睡眠规律性。
 *
 * ★ 分档依据（Windred 2024 SLEEP / UK Biobank n=60,977）：
 *   中点 sd < 30min → 高规律；> 60min → 低规律（死亡率最高五分位）。
 *   线性映射到 100~0，两端封顶封底（避免「sd=0 就是 100 分」的假精确）。
 *
 * ⚠ **sd 的单位是分钟**；sd=0 只说明「这 5 晚完全一样」，不说明健康。
 *   所以不封顶 100，而是 sd=0 → 92。
 *
 * @param samples **必须包含今晚这一条**（daysAgo = 0），见 withTime 处的说明
 * @param minDays 最少需要的天数（**含今晚**，所以第 5 晚就能出分）。
 *        Oura 对新用户要求两周；我们放宽到 5，理由同 MIN_RELATIVE_DAYS。
 */
export function computeSleepRegularity(
  samples: SleepBaselineInput[],
  minDays: number = MIN_RELATIVE_DAYS,
): RegularityResult {
  // ⚠ v18.144 **必须包含今天那条**（daysAgo = 0）。
  //   原写成 `s.daysAgo > 0`，等于把「当前作息」本身排除在规律性之外 ——
  //   而规律性问的恰恰是「最近的作息稳不稳」，今晚这一觉是最相关的一晚。
  //   真机实测后果：历史 4 晚被留下、今晚被剔掉 → 4 < minDays(5) → 规律性恒为 null。
  const withTime = samples.filter(
    (s) => s.daysAgo >= 0 && s.bedHour != null && s.wakeHour != null,
  );
  const n = withTime.length;
  const empty: RegularityResult = {
    score: null, midSdMin: null, wakeSdMin: null, bedSdMin: null, days: n,
  };
  if (n < minDays) return empty;

  const mids = unwrapMidpoints(
    withTime.map((s) => sleepMidpointHour(s.bedHour!, s.wakeHour!)),
  );
  // 入睡/起床也各自展开一次（以各自首值为参考），避免 23:50/00:10 炸出 23h
  const beds = unwrapAxis(withTime.map((s) => s.bedHour!));
  const wakes = unwrapAxis(withTime.map((s) => s.wakeHour!));

  const midSdH = stdev(mids);
  if (midSdH == null) return { ...empty, days: n };
  // ★ v18.144 自测实锤的 bug：`stdev` 返回的是**小时**，而阈值是**分钟**。
  //   原实现直接拿 0.857（小时）去和 30/60 比 ⇒ 恒为负数 ⇒ clamp01 后**永远满分 100**。
  //   ⇒ 必须在这里统一换算成分钟，后面所有阈值比较都用分钟。
  const midSdMin = midSdH * 60;

  // 分 → 0-100：以 30min 为「好」、60min 为「差」，线性插值到 [FLOOR, CEIL]。
  // ⚠ v18.144 自测实锤的两个 bug：
  //   ① 原实现 `clamp01(...) * 92 + 8`，注释说「sd=0 → 92 留余量」，但 clamp01 在 sd≤30
  //      时恒为 1 ⇒ `1*92+8 = 100`，**注释与实现不符**（实际给了满分）。
  //   ② `*92+8` 把端点藏在魔数里，读代码看不出上界是多少。
  // ⇒ 改为显式 [REG_SCORE_FLOOR, REG_SCORE_CEIL] 区间插值，两个端点都是具名常量。
  const t = clamp01(1 - (midSdMin - REGULARITY_SD_GOOD) / (REGULARITY_SD_POOR - REGULARITY_SD_GOOD));
  const score = Math.round(REG_SCORE_FLOOR + t * (REG_SCORE_CEIL - REG_SCORE_FLOOR));

  const wakeSdH = stdev(wakes);
  const bedSdH = stdev(beds);
  return {
    score,
    midSdMin: round1(midSdMin),
    wakeSdMin: wakeSdH != null ? round1(wakeSdH * 60) : null,
    bedSdMin: bedSdH != null ? round1(bedSdH * 60) : null,
    days: n,
  };
}

/** 以首值为参考，把序列展开到连续区间（差 >12h 时跨 24 修正） */
function unwrapAxis(xs: number[]): number[] {
  if (xs.length < 2) return xs;
  const ref = xs[0];
  return xs.map((x) => {
    if (x - ref > 12) return x - 24;
    if (ref - x > 12) return x + 24;
    return x;
  });
}

// ── 3) 相对口径的睡眠分 ──────────────────────────────────────────────────

export type SleepScoreMode = 'relative' | 'absolute';

export interface RelativeSleepScore {
  /** 最终分 0-100 */
  score: number;
  /** 用了哪种口径 —— UI 必须据此提示用户，否则口径切换会被误读成分数忽高忽低 */
  mode: SleepScoreMode;
  /** 基线天数（absolute 模式下也返回，表示「离个人化还差几天」） */
  baselineDays: number;
  /** 距离进入个人化口径还差几天（ready 时为 0） */
  daysToReady: number;
}

/** 四个维度的个人中心（用于把「绝对达标分」换成「相对分」） */
export interface SleepDimensionCenters {
  total: number | null;
  deepPct: number | null;
  eff: number | null;
  getUp: number | null;
}

/**
 * 建四维个人基线（各维度量纲不同，必须分别建）。
 * ⚠ 与 `buildSleepBaseline` 的区别：那个只返回总时长中心（用于对外报告天数/ready），
 *   这个返回逐维中心（用于换算分数）。天数字段共用同一判定，避免两处口径打架。
 */
export function buildSleepDimensionCenters(
  samples: SleepBaselineInput[],
  halfLifeDays?: number,
): { centers: SleepDimensionCenters; days: number; ready: boolean } {
  const valid = samples.filter((s) => s.total > 0);
  const days = valid.length;
  const mk = (f: (s: SleepBaselineInput) => number | null) => {
    const pts: WeightedSample[] = [];
    for (const s of valid) {
      const v = f(s);
      if (v != null && Number.isFinite(v)) pts.push({ v, daysAgo: s.daysAgo });
    }
    return pts.length >= MIN_RELATIVE_DAYS ? weightedCenter(pts, halfLifeDays) : null;
  };
  return {
    centers: {
      total: mk((s) => s.total),
      deepPct: mk((s) => extract(s).deepPct),
      eff: mk((s) => extract(s).eff),
      getUp: mk((s) => (s.getUp != null && Number.isFinite(s.getUp) ? s.getUp : null)),
    },
    days,
    ready: days >= MIN_RELATIVE_DAYS,
  };
}

// ── 小工具 ──────────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
