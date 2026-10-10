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
  TARGET_DURATION: 420,      // 7.5h
  TARGET_DURATION_MAX: 540,  // 8.5h：超过即线性轻扣（防"睡够 9h 就满分"）
  TARGET_DEEP_PCT: 18,       // 深睡 ≥20%
  TARGET_GETUP: 3,           // 起夜平滑：每次约扣 7 分（原为 0/1 悬崖）
  TARGET_EFFICIENCY: 0.85,   // 效率 ≥85%（WHOOP 目标）
  W_D: 0.35,
  W_DEEP: 0.20,
  W_EFF: 0.25,
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

// ═══════════════════════════════════════════════════════════════════════════
// v18.144 · 个人相对口径
//
// ★ 为什么加这个而不改 computeSleepScore：
//   `computeSleepScore` 是**落盘字段** `healthStore.sleep[dk].score` 的生产者，
//   被 RingBleManager / healthStore / 全项目 UI 读。直接改算法会让历史数据
//   （用旧口径算出的分）与新算法算出的分**混在同一字段里无法区分**。
//   ⇒ 正确做法：**保留绝对分作冷启动/回退**，另开一个「今天该显示哪个」的入口。
//
// 口径（与 Oura 一致）：**对比你自己的 14 天基线**，不是对比 7.5h 这个常量。
//   详见 sleepBaseline.ts 头注（含「睡 9h 但平时也睡 9h 不该被扣分」这个反例）。
// ═══════════════════════════════════════════════════════════════════════════

/** 把「今天值相对个人中心的偏离」换算成 0-1 归一分。 */
function relNorm(today: number, base: number, tol: number): number {
  if (base <= 0 || tol <= 0) return 0.5;
  const ratio = today / base;
  return clamp(0.5 + (ratio - 1) * (0.5 / tol), 0, 1);
}

export interface PersonalizedSleepResult {
  /** 最终分 0-100（整数） */
  score: number;
  /** 口径：relative = 已对比个人基线；absolute = 基线不足，仍用旧绝对口径 */
  mode: 'relative' | 'absolute';
  /** 参与基线的天数 */
  baselineDays: number;
  /** 距进入个人化口径还差几天（relative 时为 0） */
  daysToReady: number;
  /** 各维度归一分（诊断用；absolute 模式下为 null） */
  parts?: {
    key: string;
    w: number;
    v: number;
    /** 该维度走的口径：rel = 对比个人基线（50=和平时一样）/ abs = 基线不足，退回绝对目标（达标=1.0） */
    src: 'rel' | 'abs';
    today: number | null;
    base: number | null;
  }[];
}

/**
 * 睡眠恢复分（个人相对口径，基线不足自动退回绝对口径）。
 *
 * @param today      今晚这一觉
 * @param centers    个人四维基线中心（`buildSleepDimensionCenters().centers`）
 * @param baselineDays 参与基线的天数
 * @param ready      是否达到个人化门槛（`buildSleepDimensionCenters().ready`）
 * @param c          权重与绝对目标（沿用 SLEEP_SCORE_DEFAULTS，保证两套口径权重一致）
 */
export function computePersonalizedSleepScore(
  today: SleepScoreInput,
  centers: {
    total: number | null; deepPct: number | null; eff: number | null; getUp: number | null;
  },
  baselineDays: number,
  ready: boolean,
  c: SleepScoreConst = SLEEP_SCORE_DEFAULTS,
): PersonalizedSleepResult {
  const MIN_D = 5;
  if (!ready || baselineDays < MIN_D) {
    return {
      score: computeSleepScore(today, c),
      mode: 'absolute',
      baselineDays,
      daysToReady: Math.max(0, MIN_D - baselineDays),
    };
  }

  const total = today.sleepTotal ?? 0;
  const parts: PersonalizedSleepResult['parts'] = [];

  /* ═════════════════════════════════════════════════════════════════════
   * ★ 2026-10-07（用户实锤「睡了 8h58m、深睡 2h30m，睡眠恢复只有 38 分」）：
   *   **建不出个人基线的维度，退回该维度的绝对目标，绝不允许「丢维 + 权重放大」。**
   *
   *   原实现把「基线缺失」当成「维度不存在」直接跳过，再把剩下维度的权重归一化到 1。
   *   实测当天：`centers.eff = null`（历史无 awake 记录）、`centers.getUp = 0`（从不夜醒，<0.8）
   *   ⇒ 丢掉 42% 权重 ⇒ 剩下两维被放大 1.72 倍 ⇒
   *      「时长比平时少 0.55%」+「深睡占比低 10.5%」两个微小偏差被放大成 38 分，
   *      而昨晚效率 98.3%、零起夜这些**真实的好数据根本没进算**。
   *
   *   为什么退回绝对口径而不是按「中性 0.5」计：
   *   中性等于假设「这个维度表现平平」——但 98.3% 的效率、0 次起夜明显不是平平，
   *   按中性算等于把好数据抹掉。绝对目标（≥85%、≤3 次）本来就是这个维度的定义，
   *   在个人基线还没攒够时用它，比丢弃更接近真实。
   * ═══════════════════════════════════════════════════════════════════ */

  // ① 时长：相对自己的平均时长。tol=10% ⇒ 睡够 10% 拿满分、睡够 −10% 拿 0 分。
  {
    const v = centers.total != null && centers.total > 0
      ? relNorm(total, centers.total, 0.10)
      // 绝对兜底：与 computeSleepScore 的时长项同口径
      : total > c.TARGET_DURATION_MAX
        ? clamp(1 - (total - c.TARGET_DURATION_MAX) / 300, 0.7, 1)
        : clamp(total / c.TARGET_DURATION, 0, 1);
    parts.push({ key: 'duration', w: c.W_D, v, src: centers.total != null && centers.total > 0 ? 'rel' : 'abs', today: total, base: centers.total });
  }
  // ② 深睡占比（tol 0.25 → 0.30：深睡占比的日常变异本来就大，
  //    25% 的容差会把「比平时低 1 个 SD」直接判到接近 0 分，过严）
  if (total > 0) {
    const deepPct = ((today.sleepDeep ?? 0) / total) * 100;
    const v = centers.deepPct != null && centers.deepPct > 0
      ? relNorm(deepPct, centers.deepPct, 0.30)
      : clamp(deepPct / c.TARGET_DEEP_PCT, 0, 1);
    parts.push({ key: 'deep', w: c.W_DEEP, v, src: centers.deepPct != null && centers.deepPct > 0 ? 'rel' : 'abs', today: deepPct, base: centers.deepPct });
  }
  // ③ 效率
  if (today.sleepAwake != null && Number.isFinite(today.sleepAwake) && total > 0) {
    const eff = ((total - today.sleepAwake) / total) * 100;
    const v = centers.eff != null && centers.eff > 0
      ? relNorm(eff, centers.eff, 0.06)
      : clamp(eff / (c.TARGET_EFFICIENCY * 100), 0, 1);
    parts.push({ key: 'eff', w: c.W_EFF, v, src: centers.eff != null && centers.eff > 0 ? 'rel' : 'abs', today: eff, base: centers.eff });
  }
  // ④ 起夜
  if (today.getUp != null && Number.isFinite(today.getUp)) {
    const v = centers.getUp != null && centers.getUp >= 0.8
      // 相对：起夜越少越好 ⇒ 方向取反
      ? clamp(0.5 + ((centers.getUp - today.getUp) / centers.getUp) * 0.5, 0, 1)
      // 绝对兜底：基线 <0.8 次（几乎不夜醒）时「相对」无意义
      : clamp(1 - today.getUp / c.TARGET_GETUP, 0, 1);
    parts.push({ key: 'getup', w: c.W_G, v, src: centers.getUp != null && centers.getUp >= 0.8 ? 'rel' : 'abs', today: today.getUp, base: centers.getUp });
  }

  if (!parts.length) {
    return {
      score: computeSleepScore(today, c),
      mode: 'absolute',
      baselineDays,
      daysToReady: 0,
    };
  }

  const sumW = parts.reduce((a, p) => a + p.w, 0);
  // ★ 2026-10-07 诊断：把每个维度的「今天值 / 基线 / 归一分 / 权重占比」全量打出来（临时）
  if (__DEV__) {
    console.log(
      `[SLEEP-REL] parts=${parts.map((p) => `${p.key}:w${p.w}:${p.src}:today=${p.today ?? '—'}:base=${p.base ?? '—'}:v=${(p.v ?? 0).toFixed(3)}`).join(' | ')} ` +
      `sumW=${sumW.toFixed(2)} score=${Math.round(clamp(100 * parts.reduce((a, p) => a + (p.w / sumW) * p.v, 0), 0, 100))}`
    );
  }
  // 相对口径的锚点：与个人基线一样 ⇒ 50 分（不是绝对口径的 100）。
  // ⚠ 这是最重要的口径变化：50 = 和你平时一样。UI 副标必须写清，
  //   否则用户会把 62 读成「睡眠 62 分」（绝对量）。
  const v = 100 * parts.reduce((a, p) => a + (p.w / sumW) * p.v, 0);
  return {
    score: Math.round(clamp(v, 0, 100)),
    mode: 'relative',
    baselineDays,
    daysToReady: 0,
    parts,
  };
}
