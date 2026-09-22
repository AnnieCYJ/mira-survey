/**
 * 睡眠评分（0–100，**恢复质量**）——唯一实现，纯函数、零依赖。
 *
 * v2 变化（2026-09-22）：加入**清醒效率**维度。原来只有时长/深睡/起夜三项，
 *   但起夜一次 ≠ 躺在床上醒了 2 小时。现在从 sleepLine 曲线能拿到每分钟的
 *   「失眠」(stage 3) 和「苏醒」(stage 4) 分钟数 → 精确计算睡眠效率。
 *
 * 定位：回答「这一晚睡得好不好」（恢复质量）。
 * 与 sleepLoad.ts（累计欠账 + 晚睡/不规律）刻意不重叠：
 *   · 晚睡、就寝不规律、阶段结构偏离 → 记在**睡眠负载**；
 *   · 时长达成、深睡够不够、睡眠效率、起夜 → 记在**睡眠评分**。
 *
 * 演进：
 *   v1（现已删）：三项「达标即封顶 1」+ 权重和 = 1 → 睡够+深睡够+不起夜 = 正好 100。
 *   v2：时长满分区间 7.5–8.5h + 深睡 % 下限 20% + 效率 ≥85% + 起夜平滑扣分。
 *     权重 W_D=0.30 / W_DEEP=0.28 / W_EFF=0.22 / W_G=0.20，和为 1。
 *     缺某维度 → 其余重归一，不会因「缺数据」被扣分。
 *
 * 效率计算：efficiency = (total - awake) / total
 *   total = 睡眠曲线每分钟点数 = 总卧床时间（handleSleepDay 已用 sleepLine 修正）
 *   awake = 曲线中 stage 3(失眠) + stage 4(苏醒) 的分钟数
 *   WHOOP/Oura 目标 ≥85%；健康人约 80–90%；<70% 提示明显碎片化。
 */
export interface SleepScoreConst {
  /** 分钟：时长满分区间下限 */
  TARGET_DURATION: number;
  /** 分钟：时长满分区间上限（超过即线性轻扣） */
  TARGET_DURATION_MAX: number;
  /** %：深睡占比满分下限 */
  TARGET_DEEP_PCT: number;
  /** 起夜次数：达到此值该项为 0（中间线性） */
  TARGET_GETUP: number;
  /** 0-1：睡眠效率满分下限（WHOOP/Oura 目标） */
  TARGET_EFFICIENCY: number;
  W_D: number;
  W_DEEP: number;
  W_EFF: number;
  W_G: number;
}

export const SLEEP_SCORE_DEFAULTS: SleepScoreConst = {
  TARGET_DURATION: 450,      // 7.5h
  TARGET_DURATION_MAX: 510,  // 8.5h：超过即线性轻扣（防"睡够 9h 就满分"）
  TARGET_DEEP_PCT: 20,       // 深睡 ≥20%
  TARGET_GETUP: 3,           // 起夜平滑：每次约扣 7 分（原为 0/1 悬崖）
  TARGET_EFFICIENCY: 0.85,   // 效率 ≥85%（WHOOP 目标）
  W_D: 0.30,
  W_DEEP: 0.28,
  W_EFF: 0.22,
  W_G: 0.20,
};

export interface SleepScoreInput {
  sleepTotal: number | null;   // 分钟（从 sleepLine 来的话 = 总卧床时间）
  sleepDeep: number | null;    // 分钟
  /** 卧床期间的清醒/失眠分钟数（从 sleepLine stage 3+4 算）。缺 → 不扣分 */
  sleepAwake?: number | null;
  getUp: number | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 睡眠评分（0–100 整数）。sleepTotal ≤ 0 → 0（无有效睡眠）。 */
export function computeSleepScore(
  s: SleepScoreInput,
  c: SleepScoreConst = SLEEP_SCORE_DEFAULTS
): number {
  if (!s.sleepTotal || s.sleepTotal <= 0) return 0;
  const total = s.sleepTotal;

  const parts: { w: number; v: number }[] = [];

  // ① 时长：7.5–8.5h 满分；过短线性衰减；过长线性轻扣（下限 0.7）
  let durNorm = clamp(total / c.TARGET_DURATION, 0, 1);
  if (total > c.TARGET_DURATION_MAX) {
    durNorm = clamp(1 - (total - c.TARGET_DURATION_MAX) / 300, 0.7, 1);
  }
  parts.push({ w: c.W_D, v: durNorm });

  // ② 深睡占比：达标加分（过高不扣分——结构偏离由 sleepLoad 处理）
  const deepPct = ((s.sleepDeep ?? 0) / total) * 100;
  parts.push({ w: c.W_DEEP, v: clamp(deepPct / c.TARGET_DEEP_PCT, 0, 1) });

  // ③ 效率（缺 awake → 剔除该项，其余重归一）
  if (s.sleepAwake != null && Number.isFinite(s.sleepAwake) && total > 0) {
    const eff = Math.max(0, (total - s.sleepAwake) / total);
    parts.push({ w: c.W_EFF, v: clamp(eff / c.TARGET_EFFICIENCY, 0, 1) });
  }

  // ④ 起夜：平滑扣分（不是 0/1 悬崖）
  parts.push({ w: c.W_G, v: clamp(1 - (s.getUp ?? 0) / c.TARGET_GETUP, 0, 1) });

  // 权重归一化（因为缺项会剔除）
  const sumW = parts.reduce((acc, p) => acc + p.w, 0);
  const v = 100 * parts.reduce((acc, p) => acc + (p.w / sumW) * p.v, 0);
  return Math.round(clamp(v, 0, 100));
}
