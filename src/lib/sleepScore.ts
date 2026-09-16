/**
 * 睡眠评分（0–100，**恢复质量**）——唯一实现，纯函数、零依赖。
 *
 * 定位：回答「这一晚睡得好不好」（时长达成 / 深睡结构 / 夜间连续性）。
 * 与它配套的「睡眠负载」见 `lib/sleepLoad.ts`（累计欠账 + 晚睡/不规律），两者刻意不重叠：
 *   · 晚睡、就寝不规律、阶段结构偏离 → 记在**睡眠负载**；
 *   · 时长达成、深睡是否够、起夜 → 记在**睡眠评分（恢复）**。
 *
 * 为什么单独成文件：`data/healthStore.ts` 载入睡眠时要按同一公式重算评分，而
 * `lib/dailyStatus.ts` → `lib/cycleMath.ts` → `data/healthStore.ts`，healthStore 直接引
 * dailyStatus 会成环。放这里两边都能安全引用。
 *
 * ★ 演进（两个 bug 都出在"端点上"）：
 *   旧版三项全「达标即封顶 1」且权重和 = 1 → 睡够+深睡够+不起夜 = **正好 100**；
 *   起夜项 `clamp(1 − 起夜/1)` 又是 0/1 悬崖 → 起夜一次直接掉到 70。
 *   之后把"超时长扣分"门槛设在 `>540min(9h)`，结果 **9.0h 正好卡在边界不扣分**，
 *   又出现满屏 100（用户实测反馈）。
 *
 * 现版本：
 *   ① **时长**：满分区间 `TARGET_DURATION`(450min/7.5h) ~ `TARGET_DURATION_MAX`(510min/8.5h)；
 *      低于下限线性衰减；高于上限线性轻扣（下限 0.7）。**满分区间取 7.5–8.5h**，
 *      这样 9h+ 的「睡得久」不再天然满分（WHOOP/Oura 建议区间为 7–9h，8.5h 起即开始轻微扣分）。
 *   ② **深睡**：`TARGET_DEEP_PCT`(20%) 起满分。**不再对"深睡过高"扣分**——深睡多不是坏事，
 *      结构是否偏离交给 `sleepLoad` 的「结构」维度处理（避免同一件事在两张卡上重复扣分）。
 *   ③ **起夜**：每 1 次扣 1/`TARGET_GETUP`（默认 3，约 10 分/次），不是 0/1 悬崖。
 *   权重 `W_D`/`W_DEEP`/`W_G` = 0.35/0.35/0.30（和为 1）。要拿 100 必须「时长正好 7.5–8.5h +
 *   深睡达标 + 一夜不起夜」三者同时成立，实际很罕见。
 */
export interface SleepScoreConst {
  /** 分钟：满分区间下限（低于此值线性衰减） */
  TARGET_DURATION: number;
  /** 分钟：满分区间上限（超过此值线性轻扣） */
  TARGET_DURATION_MAX: number;
  /** %：深睡占比满分下限 */
  TARGET_DEEP_PCT: number;
  /** 起夜次数：达到此值该项为 0（中间线性） */
  TARGET_GETUP: number;
  W_D: number;
  W_DEEP: number;
  W_G: number;
}

export const SLEEP_SCORE_DEFAULTS: SleepScoreConst = {
  TARGET_DURATION: 450, // 7.5h
  TARGET_DURATION_MAX: 510, // 8.5h：超过即线性轻扣（防「睡够 9h 就满分」）
  TARGET_DEEP_PCT: 20,
  TARGET_GETUP: 3, // 起夜平滑：每次约扣 10 分（原为 1 → 0/1 悬崖）
  W_D: 0.35,
  W_DEEP: 0.35,
  W_G: 0.3,
};

export interface SleepScoreInput {
  sleepTotal: number | null;
  sleepDeep: number | null;
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

  // ① 时长：7.5–8.5h 满分；过短线性衰减；过长线性轻扣（下限 0.7）
  let durNorm = clamp(total / c.TARGET_DURATION, 0, 1);
  if (total > c.TARGET_DURATION_MAX) {
    durNorm = clamp(1 - (total - c.TARGET_DURATION_MAX) / 300, 0.7, 1);
  }

  // ② 深睡占比：达标加分（过高不扣分——结构偏离由 sleepLoad 处理）
  const deepPct = ((s.sleepDeep ?? 0) / total) * 100;
  const deepNorm = clamp(deepPct / c.TARGET_DEEP_PCT, 0, 1);

  // ③ 起夜：平滑扣分（不是 0/1 悬崖）
  const getUpNorm = clamp(1 - (s.getUp ?? 0) / c.TARGET_GETUP, 0, 1);

  const v = 100 * (c.W_D * durNorm + c.W_DEEP * deepNorm + c.W_G * getUpNorm);
  return Math.round(clamp(v, 0, 100));
}
