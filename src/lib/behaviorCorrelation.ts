/**
 * behaviorCorrelation.ts —— 行为 × 结果 关联引擎（P0-2，2026-10-28）
 *
 * ★ 权威性（不另造轮子，沿用已验证的统计口径）：
 *   · 相关：Pearson r —— 直接复用 `lib/selfReportCalibration.pearsonR`（同源，样本<3 或单侧方差为 0 返回 null）。
 *   · 效应量：Cohen's d（1988，阈值 0.2/0.5/0.8），并给出 Hedges' g 小样本校正（n<50）。
 *   · 解释力：r²（决定系数）= 该行为能解释的「结果波动」占比。
 *   · 这些阈值是行为科学 / 心理学通用基准（Cohen 1988；Fritz & Morris 2012）。
 *
 * ★ 与 Oura Tags / WHOOP Journal 的对标：
 *   二者都允许用户给某天打「行为标签」（咖啡 / 酒精 / 晚练 / 压力日…），再回看
 *   「打了该标签的天，睡眠/恢复/压力 是否系统性偏高/偏低」。本引擎做同一件事，
 *   但以 **Pearson r + Cohen's d** 双指标量化「关联强度 × 方向 × 解释力」，比只给一条提示更严谨。
 *
 * ★ 诚实闸门（Mira 铁律：不瞎编数字）：
 *   · 某标签出现天数 < MIN_DAYS_WITH_TAG（默认 7 天）或 总样本天 < MIN_TOTAL_DAYS（默认 14 天）→ 不计算、不展示。
 *   · r 为 null（方差不足）→ 不展示。
 *   · 明确「相关 ≠ 因果」说明。
 *
 * ★ 数据来源（不新增采集，复用已有自报）：
 *   · 行为标签：CognitiveLabel（用户在负荷/回顾里记的 taskType：开会/写代码/阅读/运动/其他；
 *     + cognitiveType：burn 烧脑 / emotion 情绪 / calm 平静）。
 *   · 结果指标：各详情页同源的逐日值（睡眠恢复分 / 情绪分 / 身体负荷分）。
 */
import { healthStore } from '../data/healthStore';
import { pearsonR } from './selfReportCalibration';
import { dayKey } from '../data/healthStore';
import { sleepRecoveryScoreForDay } from './sleepPersonalized';
import { dailyStressValue } from './stressDaily';
import { computeStressReport } from './stressAlgorithm';

export type OutcomeKey = 'sleep' | 'emotion' | 'bodyLoad';

export interface BehaviorCorr {
  tag: string;
  outcome: OutcomeKey;
  /** 带该标签的天数（有结果值的） */
  nWith: number;
  /** 不带标签的天数 */
  nWithout: number;
  /** 带标签日的结果均值 */
  withMean: number;
  /** 不带标签日的结果均值 */
  withoutMean: number;
  /** Pearson r（null = 不可算） */
  r: number | null;
  r2: number | null;
  /** Cohen's d（带标签日 − 不带标签日） */
  d: number | null;
  /** 效应量档位（按 |r| 走 Cohen 1988：0.1 小 / 0.3 中 / 0.5 大） */
  effect: 'small' | 'medium' | 'large' | 'negligible';
  /** 方向：带标签日相对更高 / 更低 */
  dir: 'higher' | 'lower';
  /** 一句话结论（已含方向与效应） */
  summary: string;
}

const MIN_DAYS_WITH_TAG = 7;
const MIN_TOTAL_DAYS = 14;

/** Cohen's d（合并标准差）；n<50 自动 Hedges' g 校正 */
function cohensD(a: number[], b: number[]): number | null {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / na;
  const mb = b.reduce((s, v) => s + v, 0) / nb;
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (na - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (nb - 1);
  const pooled = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  if (pooled <= 1e-9) return null;
  let d = (ma - mb) / pooled;
  if (na + nb < 50) {
    const j = 1 - 3 / (4 * (na + nb) - 9); // Hedges' g 校正因子
    d *= j;
  }
  return d;
}

function effectOf(absR: number | null): 'small' | 'medium' | 'large' | 'negligible' {
  if (absR == null) return 'negligible';
  if (absR >= 0.5) return 'large';
  if (absR >= 0.3) return 'medium';
  if (absR >= 0.1) return 'small';
  return 'negligible';
}

function outcomeValueAt(key: OutcomeKey, dk: string): number | null {
  const ms = new Date(dk + 'T00:00:00').getTime();
  try {
    if (key === 'sleep') return sleepRecoveryScoreForDay(ms);
    if (key === 'emotion') return dailyStressValue(dk);
    if (key === 'bodyLoad') return computeStressReport(ms).score;
  } catch {
    return null;
  }
  return null;
}

/** 取最近 windowDays 天里，逐日的「结果值」映射（只含有效值），与「行为标签集合」映射 */
function buildDailyMaps(outcome: OutcomeKey, windowDays: number) {
  const outMap = new Map<string, number>();
  const tagMap = new Map<string, Set<string>>(); // dk -> 行为标签集合
  const now = Date.now();
  for (let i = 0; i < windowDays; i++) {
    const dk = dayKey(now - i * 86400000);
    const v = outcomeValueAt(outcome, dk);
    if (v != null && Number.isFinite(v)) outMap.set(dk, v);
  }
  // 行为标签：CognitiveLabel（taskType + cognitiveType 归并）
  const labels = healthStore.getLabels(now - (windowDays - 1) * 86400000, now);
  for (const l of labels) {
    const tags: string[] = [];
    if (l.taskType && l.taskType !== '其他') tags.push(l.taskType);
    if (l.cognitiveType === 'burn') tags.push('烧脑日');
    else if (l.cognitiveType === 'emotion') tags.push('情绪日');
    else if (l.cognitiveType === 'calm') tags.push('平静日');
    if (tags.length === 0) continue;
    const set = tagMap.get(l.dateKey) ?? new Set<string>();
    tags.forEach((t) => set.add(t));
    tagMap.set(l.dateKey, set);
  }
  return { outMap, tagMap };
}

/**
 * 计算某结果指标下的全部行为关联（按 |r| 降序，最多 topK 条）。
 * 返回 { items, enough } —— enough=false 表示样本不足、整体不展示。
 */
export function computeBehaviorCorrelations(
  outcome: OutcomeKey,
  windowDays = 90,
  topK = 4,
): { items: BehaviorCorr[]; enough: boolean; totalDays: number } {
  const { outMap, tagMap } = buildDailyMaps(outcome, windowDays);
  const totalDays = outMap.size;
  if (totalDays < MIN_TOTAL_DAYS) {
    return { items: [], enough: false, totalDays };
  }
  // 收集每个 tag 的「带/不带」结果值
  const byTag = new Map<string, { withV: number[]; withoutV: number[] }>();
  for (const [dk, v] of outMap) {
    const tags = tagMap.get(dk);
    for (const tag of new Set([...byTag.keys(), ...(tags ?? [])])) {
      const bucket = byTag.get(tag) ?? { withV: [], withoutV: [] };
      if (tags?.has(tag)) bucket.withV.push(v);
      else bucket.withoutV.push(v);
      byTag.set(tag, bucket);
    }
  }

  const results: BehaviorCorr[] = [];
  for (const [tag, { withV, withoutV }] of byTag) {
    if (withV.length < MIN_DAYS_WITH_TAG || withV.length + withoutV.length < MIN_TOTAL_DAYS) continue;
    const withMean = withV.reduce((a, b) => a + b, 0) / withV.length;
    const withoutMean = withoutV.reduce((a, b) => a + b, 0) / withoutV.length;
    // 二元标签(0/1) × 结果值 → Pearson r（复用已验证实现）
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [dk, v] of outMap) {
      xs.push(tagMap.get(dk)?.has(tag) ? 1 : 0);
      ys.push(v);
    }
    const r = pearsonR(xs, ys);
    const d = cohensD(withV, withoutV);
    const r2 = r != null ? r * r : null;
    const effect = effectOf(r == null ? null : Math.abs(r));
    const dir: 'higher' | 'lower' = withMean >= withoutMean ? 'higher' : 'lower';
    results.push({
      tag,
      outcome,
      nWith: withV.length,
      nWithout: withoutV.length,
      withMean: Math.round(withMean * 10) / 10,
      withoutMean: Math.round(withoutMean * 10) / 10,
      r,
      r2: r2 != null ? Math.round(r2 * 100) / 100 : null,
      d,
      effect,
      dir,
      summary: buildSummary(tag, outcome, dir, effect, withMean - withoutMean),
    });
  }

  results.sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0));
  return { items: results.slice(0, topK), enough: true, totalDays };
}

function outcomeLabel(o: OutcomeKey): string {
  return o === 'sleep' ? '睡眠恢复' : o === 'emotion' ? '情绪' : '身体负荷';
}

function buildSummary(tag: string, o: OutcomeKey, dir: 'higher' | 'lower', effect: string, delta: number): string {
  const lab = outcomeLabel(o);
  const dirTxt = dir === 'higher' ? '更高' : '更低';
  const mag = Math.abs(Math.round(delta * 10) / 10);
  const effTxt = effect === 'large' ? '强关联' : effect === 'medium' ? '中等关联' : '弱关联';
  return `${tag} 的日子，${lab}平均${dirTxt} ${mag} 分（${effTxt}）`;
}
