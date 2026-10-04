/**
 * selfReportCalibration.ts —— **自报情绪接入心理压力**（v18.140）
 *
 * ══ 为什么要接 ══
 * 用户的诉求是「心理压力要真的是心理压力」。现在这个分数是**纯生理推导**：
 * 皮电 + HRV + 心率 + 体温，算出「身体在紧张」，但**没有回答「是心理引起的吗」**。
 * 而 Mira 的铁律是「情绪以用户自报为主，不做情绪推断/评分」——
 * **自报情绪目前只被用于「剔除」（`cognitiveLoad.ts:1045`），从没参与算分**。
 *
 * ⚠⚠ **本模块不做什么（必须先说清）**：
 * · **不做实时打分**。自报是稀疏的（一天可能 1-3 次），没法逐 30min 槽打分。
 * · **不做情绪分类**（不判断「你现在焦虑」）。12 档情绪里只有 `stressed`/`anxious`
 *   算「压力向」，其余 10 档是「非压力向」，但**非压力向 ≠ 真的没压力**
 *   （`calm` 也可能是压抑着的，`tired` 可能是累而不是压力）。
 * · **不用自报去「修正」生理分**。那是把主观感受硬塞进客观测量，
 *   会让分数在「用户随手点了一下」时剧烈跳变。
 *
 * ══ 它做什么（两件事，都可复算）══
 * **① 校准（积累到足够样本才生效）**：
 *   把「自报为压力向的时刻」与「同时段生理综合分」做配对回归，
 *   得到**你自己的** r（相关系数）。r 高 ⇒ 这套生理指标对你有效；
 *   r 低 ⇒ 老实降级到只报档位。**这是唯一能回答「算法准不准」的路径。**
 *   ⚠ 门槛 `MIN_PAIRS = 14 对`（约 7 天，每天 2 次压力向自报）。
 *   样本不足时**返回 null 并明确告知还差多少**，不返回假系数。
 *
 * **② 校准状态展示**：
 *   告诉用户「你的数据攒到哪了」「还差几天」——
 *   这是 Mira「逐渐累积、越来越准」这个承诺的**可见证据**。
 *
 * ══ 口径边界（写死，勿越界）══
 * · 压力向情绪只有 `stressed` + `anxious` 两档。
 *   ⚠ **为什么不含 `angry`/`sad`**：那两档的生理唤醒模式与焦虑不同
 *   （愤怒是高频激活、悲伤是低唤醒），混进来会污染回归。
 *   `tired`/`lonely` 也不含 —— 疲惫与孤独不是「心理压力」的同一件事。
 * · 配对窗口 **±30min**（与 `cognitiveLoad.ts` 的归因窗口一致，两个模块口径统一）。
 * · 回归用 **Pearson r**，不用线性回归求斜率 ——
 *   我们要的是「准不准」（相关性），不是「怎么换算」（映射关系），
 *   斜率在 n 小时、量纲不稳时极易过拟合。
 */

import { getEntriesForDay, ensureEmotionLogLoaded, type MoodKey } from '../data/emotionLog';

// ══ 口径常量（唯一定义处，勿在别处写死）══

/**
 * 压力向情绪（回归的唯一输入）。
 * ⚠ 只含 2 档，理由见文件头。
 */
export const STRESS_MOODS: MoodKey[] = ['stressed', 'anxious'];

/** 配对窗口（±分钟）—— 与 `cognitiveLoad.ts:1052` 的归因窗口一致 */
export const PAIR_WINDOW_MIN = 30;

/** 生效所需的最少配对数（约 7 天 × 每天 2 次压力向自报） */
export const MIN_PAIRS = 14;

/**
 * r 的判定门槛（**产品决策，不是文献结论**，理由写在这里）：
 * · **r ≥ 0.4** → 「有效」：这套生理指标对你有意义，可以给档位。
 * · **0.2 ≤ r < 0.4** → 「弱」：只给「压力低/中/高」三档，**不给 0-100 数字**
 *   （数字会让人以为很精确，实际不可靠）。
 * · **r < 0.2** → 「无效」：**不显示压力分**，只显示自报记录入口。
 *   ⚠ 上界参考：`cortisolProxy` 记录的生理信号推心理量有
 *   **physiological noise ceiling r ≈ 0.3~0.5**（Garmin压力分 vs 唾液皮质醇 r=0.29~0.71）。
 *   所以 0.4 是「接近噪声上限」的位置，**不设更高门槛是因为再高就永远达不到**。
 */
export const R_VALID = 0.4;
export const R_WEAK = 0.2;

export type CalibrationLevel = 'insufficient' | 'invalid' | 'weak' | 'valid';

export const CALIBRATION_LABEL: Record<CalibrationLevel, string> = {
  insufficient: '还在攒数据',
  invalid: '这套数据对你参考价值低',
  weak: '参考价值有限',
  valid: '对你有效',
};

// ══ 配对样本 ══

/** 一条配对样本：自报时刻 + 同时段生理综合分 */
export interface SelfReportPair {
  /** 自报时刻 epoch ms */
  t: number;
  /** 该时刻自报的情绪 */
  mood: MoodKey;
  /** 是否压力向 */
  isStressMood: boolean;
  /** 同时段生理综合分（0-100 百分位）；null = 该时段生理数据不足 */
  physioPct: number | null;
  /** 生理分相对该压力向样本群的偏移（仅 valid 时有意义） */
  deltaFromStressGroup: number | null;
}

export interface CalibrationResult {
  level: CalibrationLevel;
  /** Pearson r；样本不足时 null */
  r: number | null;
  /** 有效配对数（两侧都有值的样本） */
  pairCount: number;
  /** 还差多少对才够 */
  remainingPairs: number;
  /** 压力向自报总数（不管生理数据有没有） */
  stressReports: number;
  /** 非压力向自报总数 */
  otherReports: number;
  /** 压力向样本的生理分均值；null = 无有效配对 */
  stressMean: number | null;
  /** 非压力向样本的生理分均值 */
  otherMean: number | null;
  /** 两组均值差（压力向 − 非压力向）；null = 缺一组 */
  separation: number | null;
  /** 给用户看的一句话 */
  narrative: string;
  /** 研发侧诊断（进日志，不给用户看） */
  diag: string;
}

// ══ Pearson r ══

/**
 * Pearson 相关系数。样本 <3 或任一侧方差为 0 时返回 null（**不给假 r**）。
 */
export function pearsonR(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 1e-9 || syy <= 1e-9) return null;   // 一侧全同值 ⇒ 无从判断
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

// ══ 配对构建 ══

/**
 * 拉取最近 N 天的自报，与生理分配对。
 *
 * @param physioPctAt 回调：给一个时刻，返回该时刻**所在 30min 槽**的生理综合分
 *        （0-100 百分位）。返回 null = 该槽生理数据不足。
 *        ⚠ 由调用方（`emotionalStress.ts`）注入，因为槽→分数的映射逻辑在那里，
 *               本模块不反向依赖，避免循环引用。
 * @param days 回看天数（含今天）
 */
export function buildPairs(
  physioPctAt: (t: number) => number | null,
  days = 14,
  nowMs: number = Date.now(),
): SelfReportPair[] {
  const out: SelfReportPair[] = [];
  const seenDays = new Set<string>();
  for (let i = 0; i < days; i++) {
    const dk = dayKeyOf(nowMs - i * 86400000);
    if (seenDays.has(dk)) continue;
    seenDays.add(dk);
    let entries;
    try { entries = getEntriesForDay(dk); } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e.t !== 'number' || !e.mood) continue;
      out.push({
        t: e.t,
        mood: e.mood,
        isStressMood: STRESS_MOODS.includes(e.mood),
        physioPct: safePhysio(physioPctAt, e.t),
        deltaFromStressGroup: null,
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function safePhysio(fn: (t: number) => number | null, t: number): number | null {
  try {
    const v = fn(t);
    return v == null || !Number.isFinite(v) ? null : v;
  } catch {
    return null;
  }
}

function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ══ 校准 ══

/**
 * 算校准结果。
 *
 * ⚠ **压力向自报必须 ≥3 条、非压力向也必须 ≥3 条**才能算 r ——
 *   只有压力向没有对照，无法回答「这个分数能不能区分压力和不压力」。
 *   样本不足时返回 `insufficient` 并明确告知还差多少，**不返回假 r**。
 */
export function computeCalibration(pairs: SelfReportPair[]): CalibrationResult {
  const stressRep = pairs.filter((p) => p.isStressMood);
  const otherRep = pairs.filter((p) => !p.isStressMood);

  // 配对：两侧都有生理分
  const sPts = stressRep.filter((p) => p.physioPct != null).map((p) => p.physioPct!);
  const oPts = otherRep.filter((p) => p.physioPct != null).map((p) => p.physioPct!);

  // 标签：压力向=1，非压力向=0；与生理分做相关
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of stressRep) if (p.physioPct != null) { xs.push(1); ys.push(p.physioPct); }
  for (const p of otherRep) if (p.physioPct != null) { xs.push(0); ys.push(p.physioPct); }
  const pairCount = xs.length;

  const r = pairCount >= MIN_PAIRS ? pearsonR(xs, ys) : null;
  const stressMean = sPts.length ? mean(sPts) : null;
  const otherMean = oPts.length ? mean(oPts) : null;
  const separation =
    stressMean != null && otherMean != null ? stressMean - otherMean : null;

  const diag =
    `pairs=${pairCount} stressRep=${stressRep.length}(配到${sPts.length}) ` +
    `otherRep=${otherRep.length}(配到${oPts.length}) ` +
    `r=${r == null ? '—' : r.toFixed(3)} ` +
    `stressMean=${stressMean == null ? '—' : stressMean.toFixed(1)} ` +
    `otherMean=${otherMean == null ? '—' : otherMean.toFixed(1)} ` +
    `sep=${separation == null ? '—' : separation.toFixed(1)}`;

  // ── 判定 ──
  // ⚠ 顺序很重要：先看样本够不够，再看 r。
  if (stressRep.length < 3 || otherRep.length < 3 || pairCount < MIN_PAIRS) {
    const need = Math.max(0, MIN_PAIRS - pairCount);
    const needGroups = Math.max(
      3 - stressRep.length,
      3 - otherRep.length,
    );
    return {
      level: 'insufficient',
      r: null,
      pairCount,
      remainingPairs: need,
      stressReports: stressRep.length,
      otherReports: otherRep.length,
      stressMean, otherMean, separation,
      narrative: needGroups > 0
        ? `继续记录情绪就能看到准确度。现在缺「压力时」和「不紧张时」两类记录（压力向 ${stressRep.length}/3、不紧张向 ${otherRep.length}/3）。`
        : `再攒 ${need} 次记录就能算出准确度。`,
      diag,
    };
  }

  const level: CalibrationLevel =
    r == null ? 'insufficient'
      : r >= R_VALID ? 'valid'
      : r >= R_WEAK ? 'weak'
      : 'invalid';

  const narrative =
    level === 'insufficient'
      ? '记录还差一点，攒够就能看到准确度。'
      : level === 'valid'
      ? `你的心理压力分对你有效（准确度 ${r!.toFixed(2)}），压力时的身体反应确实和平时不一样。`
      : level === 'weak'
      ? `准确度 ${r!.toFixed(2)}，参考价值有限。建议以你填的情绪记录为准。`
      : `准确度 ${r!.toFixed(2)}，这套身体数据分不出你压力的大小。已改为只显示你填的情绪记录。`;

  return {
    level, r, pairCount, remainingPairs: 0,
    stressReports: stressRep.length, otherReports: otherRep.length,
    stressMean, otherMean, separation, narrative, diag,
  };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ══ UI 便捷 ══

/**
 * 心理压力 0-100 该不该显示？
 * ⚠ 这是**诚实度闸门**：`invalid` ⇒ 数字位显示「—」，
 *   `weak` ⇒ 建议只显示档位（由 UI 决定是否仍给数字）。
 */
export function shouldShowNumber(level: CalibrationLevel): boolean {
  return level !== 'insufficient' && level !== 'invalid';
}

/** 该不该显示 0-100 数字（比 shouldShowNumber 更严：`weak` 也不给数字） */
export function shouldShowScore(level: CalibrationLevel): boolean {
  return level === 'valid';
}
