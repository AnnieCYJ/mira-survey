/**
 * recoveryEngine —— 「压力恢复」四态算法引擎
 *
 * ★ 2026-11-07（用户）：参考用户给出的 HealthStateEngine 后端算法逻辑，落地到 Mira 真实数据。
 *   四态（恢复 / 心流 / 松弛 / 紧绷）由「HRV 相对基线」+「活动量（METs）」共同判定：
 *     · HRV < 基线 × 0.90                         → 紧绷（tense）
 *     · HRV > 基线 × 1.05 且 安静（METs ≤ 基线）   → 恢复（recovery）
 *     · 其余 + 在动（METs > 基线）                 → 心流（flow）
 *     · 其余 + 安静                               → 松弛（relax）
 *   关键工程点（与用户算法一致）：
 *     · 基线 = 过去 14 天「逐日 HRV 均值」的动态均值；不足 3 天回退人群均值 45。
 *     · 滑动平滑（trailing window=3 个样本）防止抬手等毛刺导致状态跳变。
 *     · 全天恢复占比以 20% 清醒时长作为「满分 100 分」目标线，恢复分数 = min(ratio/0.20×100,100)。
 *   所有时长按真实样本时间戳的 Voronoi 半间隔累加（不假设固定 15 分钟间隔），缺口不插值。
 *
 * 数据纪律：HRV / METs 均取自 healthStore 真实 intraday；未来/无数据窗口留空，绝不伪造。
 */
import { healthStore, dayKey } from '../data/healthStore';
import { RangeKey } from '../data/metrics';
import { startOfDay, startOfWeek, endOfWeek, addDays } from './dateUtils';

export type RecoveryState = 'recovery' | 'flow' | 'relax' | 'tense';

export interface StateMeta {
  label: string;
  color: string;
}
/** 四态配色（与用户交付清单一致：恢复=深紫 / 心流=蓝 / 松弛=浅绿 / 紧绷=橙） */
export const STATE_META: Record<RecoveryState, StateMeta> = {
  recovery: { label: '恢复', color: '#6E58C8' }, // purpleDeep
  flow: { label: '心流', color: '#7EA6F8' },     // skyCore
  relax: { label: '松弛', color: '#BCCB62' },     // limeMid
  tense: { label: '紧绷', color: '#F0913E' },     // 橙
};
export const STATE_ORDER: RecoveryState[] = ['recovery', 'flow', 'relax', 'tense'];

const POP_HRV_BASELINE = 45;
const DEFAULT_MET_BASELINE = 2.0;
const HRV_LOW_RATIO = 0.9;
const HRV_HIGH_RATIO = 1.05;
const SMOOTH_WIN = 3;
const TARGET_RECOVERY_RATIO = 0.2;

interface Pt {
  t: number;
  v: number;
}

function intradayOf(metric: 'hrv' | 'met', dayStart: number, dayEnd: number): Pt[] {
  const key = dayKey(dayStart);
  return healthStore
    .getIntraday(metric, key)
    .filter((p: any) => typeof p.v === 'number' && p.v > 0 && p.t >= dayStart && p.t < dayEnd) as Pt[];
}

/** trailing-window 滑动平均（window 个样本，含当前；不足则取已有） */
function smooth(series: number[], win: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const s = Math.max(0, i - win + 1);
    let sum = 0;
    for (let j = s; j <= i; j++) sum += series[j];
    out.push(sum / (i - s + 1));
  }
  return out;
}

/** 过去 14 天逐日 HRV 均值的动态均值；不足 3 天回退人群均值 */
function baselineHrvFor(dayStart: number): number {
  const means: number[] = [];
  for (let back = 1; back <= 14; back++) {
    const ds = dayStart - back * 864e5;
    const de = ds + 864e5;
    const pts = intradayOf('hrv', ds, de);
    if (pts.length >= 3) {
      const m = pts.reduce((a, p) => a + p.v, 0) / pts.length;
      means.push(m);
    }
  }
  if (means.length < 3) return POP_HRV_BASELINE;
  return means.reduce((a, b) => a + b, 0) / means.length;
}

function nearestMet(t: number, met: Pt[], fallback: number): number {
  if (met.length === 0) return fallback;
  let best = met[0];
  let bestD = Math.abs(met[0].t - t);
  for (const m of met) {
    const d = Math.abs(m.t - t);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best.v;
}

function classify(hrv: number, met: number, baseHrv: number, baseMet: number): RecoveryState {
  const low = baseHrv * HRV_LOW_RATIO;
  const high = baseHrv * HRV_HIGH_RATIO;
  const active = met > baseMet;
  if (hrv < low) return 'tense';
  if (hrv > high && !active) return 'recovery';
  if (active) return 'flow';
  return 'relax';
}

function zeroHours(): Record<RecoveryState, number> {
  return { recovery: 0, flow: 0, relax: 0, tense: 0 };
}

export interface DayRecoverySeg {
  t: number;
  state: RecoveryState;
  durH: number;
}

export interface DayRecovery {
  hasData: boolean;
  /** 全天状态带（按时间排序），用于渲染时间线 */
  segs: DayRecoverySeg[];
  /** 四态各自时长（小时） */
  hours: Record<RecoveryState, number>;
  recoveryHrs: number;
  tenseHrs: number;
  /** 全天恢复分数 0–100（旧口径：恢复时长占比 ÷ 20% 目标线，仅四态分布页内部参考） */
  score: number;
  /** ★ 2026-11-07（用户「hero 分数也要用连续 0–100 分」）：当日连续恢复分 =
   *    逐时段 HRV 相对基线比值 → RATIO_ANCHORS 分段线性映射 → 采样均值（与当日曲线同源同尺）。
   *    日/周/月/年 hero、趋势图统一用这一口径，不再出现「恢复时长够 20% 就顶 100」。 */
  curveScore: number;
  baseHrv: number;
  baseMet: number;
  totalHrs: number;
}

export function computeDayRecovery(dayStartMs: number): DayRecovery {
  const dayEnd = dayStartMs + 864e5;
  const hrv = intradayOf('hrv', dayStartMs, dayEnd).sort((a, b) => a.t - b.t);
  const met = intradayOf('met', dayStartMs, dayEnd).sort((a, b) => a.t - b.t);

  const empty: DayRecovery = {
    hasData: false,
    segs: [],
    hours: zeroHours(),
    recoveryHrs: 0,
    tenseHrs: 0,
    score: 0,
    curveScore: 0,
    baseHrv: 0,
    baseMet: DEFAULT_MET_BASELINE,
    totalHrs: 0,
  };
  if (hrv.length < 3) return empty;

  const baseHrv = baselineHrvFor(dayStartMs);
  const baseMet = DEFAULT_MET_BASELINE;

  const metVals = hrv.map((hp) => nearestMet(hp.t, met, baseMet));
  const hrvSm = smooth(
    hrv.map((p) => p.v),
    SMOOTH_WIN,
  );
  const metSm = smooth(metVals, SMOOTH_WIN);

  const states: RecoveryState[] = [];
  for (let i = 0; i < hrv.length; i++) {
    states.push(classify(hrvSm[i], metSm[i], baseHrv, baseMet));
  }

  const segs: DayRecoverySeg[] = [];
  const hours = zeroHours();
  let totalHrs = 0;
  for (let i = 0; i < hrv.length; i++) {
    const prevT = i > 0 ? hrv[i - 1].t : hrv[i].t;
    const nextT = i < hrv.length - 1 ? hrv[i + 1].t : hrv[i].t;
    const durH = (nextT - prevT) / 2 / 3600e3; // Voronoi 半间隔
    const st = states[i];
    segs.push({ t: hrv[i].t, state: st, durH });
    hours[st] += durH;
    totalHrs += durH;
  }

  const recoveryHrs = hours.recovery;
  const score = totalHrs > 0 ? Math.min((recoveryHrs / totalHrs) / TARGET_RECOVERY_RATIO * 100, 100) : 0;

  // ★ 连续恢复分（与 computeDayRecoveryCurve 同源）：复用已平滑的 hrvSm 与基线，
  //   逐样本比值 → RATIO_ANCHORS 分段线性 0–100 → 采样均值（缺口样本不参与）。
  const curveVals = hrvSm.map((v, i) => ratioToScore(v / baseHrv));
  const curveScore = Math.round(curveVals.reduce((a, b) => a + b, 0) / Math.max(1, curveVals.length));

  return {
    hasData: true,
    segs,
    hours,
    recoveryHrs,
    tenseHrs: hours.tense,
    score: Math.round(score),
    curveScore,
    baseHrv,
    baseMet,
    totalHrs,
  };
}

export interface RangeRecoveryPoint {
  label: string;
  dateMs: number;
  score: number | null;
  recoveryHrs: number;
  tenseHrs: number;
  hours: Record<RecoveryState, number>;
}

export interface RangeRecovery {
  points: RangeRecoveryPoint[];
  avgScore: number | null;
  totalRecoveryHrs: number;
  totalTenseHrs: number;
  hours: Record<RecoveryState, number>;
  prevAvgScore: number | null;
}

function daysFor(range: Exclude<RangeKey, 'day'>, anchor: Date): Date[] {
  if (range === 'week') {
    const s = startOfWeek(anchor);
    const e = endOfWeek(anchor);
    const a: Date[] = [];
    for (let d = new Date(s); d <= e; d = addDays(d, 1)) a.push(new Date(d));
    return a;
  }
  if (range === 'month') {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const n = new Date(y, m + 1, 0).getDate();
    const a: Date[] = [];
    for (let i = 1; i <= n; i++) a.push(new Date(y, m, i));
    return a;
  }
  // year
  const y = anchor.getFullYear();
  const a: Date[] = [];
  for (let mo = 0; mo < 12; mo++) {
    const n = new Date(y, mo + 1, 0).getDate();
    for (let i = 1; i <= n; i++) a.push(new Date(y, mo, i));
  }
  return a;
}

function addHours(target: Record<RecoveryState, number>, src: Record<RecoveryState, number>) {
  target.recovery += src.recovery;
  target.flow += src.flow;
  target.relax += src.relax;
  target.tense += src.tense;
}

function avgScoreForPeriod(range: Exclude<RangeKey, 'day'>, anchor: Date): number | null {
  const days = daysFor(range, anchor);
  let sum = 0;
  let n = 0;
  for (const d of days) {
    const dr = computeDayRecovery(startOfDay(d).getTime());
    if (dr.hasData) {
      // ★ 2026-11-07：上一周期对比同尺 —— 用连续恢复分（curveScore），与当前区间一致
      sum += dr.curveScore;
      n++;
    }
  }
  return n > 0 ? Math.round(sum / n) : null;
}

export function computeRangeRecovery(range: Exclude<RangeKey, 'day'>, anchor: Date): RangeRecovery {
  const days = daysFor(range, anchor);
  const perDay = days.map((d) => computeDayRecovery(startOfDay(d).getTime()));

  const totalHours = zeroHours();
  let totalRec = 0;
  let totalTense = 0;
  let scoreSum = 0;
  let scoreN = 0;
  const points: RangeRecoveryPoint[] = [];

  if (range !== 'year') {
    perDay.forEach((dr, idx) => {
      const d = days[idx];
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const dateMs = startOfDay(d).getTime();
      if (!dr.hasData) {
        points.push({ label, dateMs, score: null, recoveryHrs: 0, tenseHrs: 0, hours: zeroHours() });
        return;
      }
      // ★ 2026-11-07（用户「周月年也要用连续 0–100 分」）：趋势点与区间均分统一用 curveScore
      points.push({ label, dateMs, score: dr.curveScore, recoveryHrs: dr.recoveryHrs, tenseHrs: dr.tenseHrs, hours: dr.hours });
      addHours(totalHours, dr.hours);
      totalRec += dr.recoveryHrs;
      totalTense += dr.tenseHrs;
      scoreSum += dr.curveScore;
      scoreN++;
    });
  } else {
    const byMonth: Record<number, { scoreSum: number; scoreN: number; rec: number; tense: number; hours: Record<RecoveryState, number> }> = {};
    perDay.forEach((dr, idx) => {
      const mo = days[idx].getMonth();
      byMonth[mo] = byMonth[mo] || { scoreSum: 0, scoreN: 0, rec: 0, tense: 0, hours: zeroHours() };
      if (dr.hasData) {
        byMonth[mo].scoreSum += dr.curveScore;
        byMonth[mo].scoreN++;
        byMonth[mo].rec += dr.recoveryHrs;
        byMonth[mo].tense += dr.tenseHrs;
        addHours(byMonth[mo].hours, dr.hours);
        addHours(totalHours, dr.hours);
        totalRec += dr.recoveryHrs;
        totalTense += dr.tenseHrs;
        scoreSum += dr.curveScore;
        scoreN++;
      }
    });
    for (let mo = 0; mo < 12; mo++) {
      const b = byMonth[mo];
      const dateMs = new Date(anchor.getFullYear(), mo, 1).getTime();
      if (!b || b.scoreN === 0) {
        points.push({ label: `${mo + 1}月`, dateMs, score: null, recoveryHrs: 0, tenseHrs: 0, hours: zeroHours() });
      } else {
        points.push({
          label: `${mo + 1}月`,
          dateMs,
          score: Math.round(b.scoreSum / b.scoreN),
          recoveryHrs: b.rec,
          tenseHrs: b.tense,
          hours: b.hours,
        });
      }
    }
  }

  const avgScore = scoreN > 0 ? Math.round(scoreSum / scoreN) : null;

  const prevAnchor = new Date(anchor);
  if (range === 'week') prevAnchor.setDate(prevAnchor.getDate() - 7);
  else if (range === 'month') prevAnchor.setMonth(prevAnchor.getMonth() - 1);
  else prevAnchor.setFullYear(prevAnchor.getFullYear() - 1);
  const prevAvgScore = avgScoreForPeriod(range, prevAnchor);

  return {
    points,
    avgScore,
    totalRecoveryHrs: totalRec,
    totalTenseHrs: totalTense,
    hours: totalHours,
    prevAvgScore,
  };
}

/** 恢复分数 → 定性档位（与首页/卡片口径同源，供 hero 展示）
 * ★ 2026-11-07：阈值对齐 Oura Readiness 官方档位（85 Optimal / 70 Good / 60 Fair / <60 Pay Attention） */
export function recoveryTag(score: number | null): string {
  if (score == null) return '待数据';
  if (score >= 85) return '恢复充沛';
  if (score >= 70) return '恢复良好';
  if (score >= 60) return '恢复一般';
  return '恢复偏弱';
}

/* ═══════════════════════════════════════════════════════════════════
 * ★ 2026-11-07（用户「趋势图应是 0–100 连续分，不是四态折线跳来跳去」）：
 * 「当日恢复分曲线」—— 参照 Oura Readiness 的核心信号（HRV 相对个人基线的平衡），
 * 把当日逐时段 HRV 映射为连续 0–100 分，再平滑 + 15 分钟降采样。
 * Oura Readiness 本身是「日级」分数（7 个 contributor），并无当日小时级曲线；
 * 这里取其最核心、可逐时段计算的一路信号（HRV ratio）做连续 proxy：
 *   · 贴基线（ratio=1.0）→ 72（Oura 口径：贴基线 = 良好恢复，落在 70-84 Good 带）；
 *   · 超基线 +10% → 80 进入充沛带（Optimal 界 85 ≈ 超基线 ~13%）；
 *   · 低基线渐进入偏弱带；锚点分段线性插值，单调、无跳变。
 *   档位词阈值与 Oura 一致：85/70/60（recoveryTag）。
 * 数据纪律不变：只用真实 HRV 采样，无采样时段留 null（断线），绝不伪造。
 * ═══════════════════════════════════════════════════════════════════ */

export interface DayCurvePoint {
  t: number;
  score: number | null;
}

export interface DayRecoveryCurve {
  hasData: boolean;
  points: DayCurvePoint[];
}

/** HRV 相对基线比值 → 0–100 分（锚点分段线性，单调）
 * ★ 2026-11-07（用户「参考 Oura 的恢复力算法别搞错了」）按 Oura 官方口径校准：
 *  · Oura Readiness 档位 = 85-100 Optimal / 70-84 Good / 60-69 Fair / <60 Pay Attention；
 *  · HRV Balance 的核心原则是「贴着个人基线 = 恢复良好」（Oura 官方：近期趋势与平均值相当
 *    或更佳 = 良好恢复的指標），不是 50 分「一般」—— 故 ratio=1.0 锚在 72（良好带中部）；
 *  · 超基线 +10% 进入充沛带（80），更高渐近 100；低基线渐进入偏弱带。
 */
const RATIO_ANCHORS: [number, number][] = [
  [0.5, 0],
  [0.7, 25],
  [0.85, 45],
  [1.0, 72],
  [1.1, 80],
  [1.25, 90],
  [1.45, 100],
];

function ratioToScore(r: number): number {
  if (r <= RATIO_ANCHORS[0][0]) return 0;
  for (let i = 1; i < RATIO_ANCHORS.length; i++) {
    const [x1, y1] = RATIO_ANCHORS[i - 1];
    const [x2, y2] = RATIO_ANCHORS[i];
    if (r <= x2) return y1 + ((r - x1) / (x2 - x1)) * (y2 - y1);
  }
  return 100;
}

const CURVE_STEP_MS = 15 * 60e3; // 15 分钟一档

export function computeDayRecoveryCurve(dayStartMs: number): DayRecoveryCurve {
  const dayEnd = dayStartMs + 864e5;
  const hrv = intradayOf('hrv', dayStartMs, dayEnd).sort((a, b) => a.t - b.t);
  if (hrv.length < 3) return { hasData: false, points: [] };

  const baseHrv = baselineHrvFor(dayStartMs);
  const hrvSm = smooth(
    hrv.map((p) => p.v),
    SMOOTH_WIN,
  );
  // 逐采样点 → 连续分
  const raw = hrv.map((p, i) => ({ t: p.t, score: ratioToScore(hrvSm[i] / baseHrv) }));
  // 5 点滑动平滑（消除时段切换毛刺，比四态离散映射平滑得多）
  const sm = smooth(
    raw.map((p) => p.score),
    5,
  );
  // 15 分钟栅格降采样：窗口内均值；无采样格 = null（画图断线）
  const points: DayCurvePoint[] = [];
  let idx = 0;
  for (let t = dayStartMs; t < dayEnd; t += CURVE_STEP_MS) {
    const winEnd = t + CURVE_STEP_MS;
    const inWin: number[] = [];
    while (idx < raw.length && raw[idx].t < winEnd) {
      inWin.push(sm[idx]);
      idx++;
    }
    points.push({
      t: t + CURVE_STEP_MS / 2,
      score: inWin.length > 0 ? Math.round(inWin.reduce((a, b) => a + b, 0) / inWin.length) : null,
    });
  }
  return { hasData: true, points };
}
