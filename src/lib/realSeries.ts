/**
 * realSeries —— 洞察页「卡片详情」用的真实历史数据构造
 *
 * 重构（数据层重做）：本文件不再直接翻 RingState 的 history / seriesByDay / *Daily 三套并存表示，
 * 而是统一从 **healthStore**（src/data/healthStore.ts，单一规范数据源）读取：
 *   - 日内逐样本曲线  → healthStore.getIntraday(key, day)
 *   - 按日聚合均值    → healthStore.getDay(key, day).mean
 *   - 跨天趋势        → 每日调 getDay（缺口为 null，绘图断线，绝不编造）
 *   - 睡眠            → healthStore.getSleep(day)
 * 这样「读哪个」不再有歧义，且与所有写入端（RingBleManager 各 backfill/realtime handler）同源。
 *
 * 设计原则（与全局一致 · 不造假）：
 *  - day（日）：今日取 healthStore 日内逐样本，按真实时间戳连续绘制；历史某天优先连续曲线，否则单点均值。
 *  - week/month：按自然日取「当日均值」画趋势（每点 = 一天均值，按时间顺序；缺口 null 断线）。
 *  - year：按月均值趋势（12 个点，每月一个均值）。
 *  - cycle：温度走 healthStore（实测）；激素戒指测不了，详情页仅展示实测体温 + 周期相位背景带。
 */
import type { RingState, TimePoint } from '../ble/RingBleManager';
import { healthStore, dayStartMs, type MetricKey as HSMetricKey } from '../data/healthStore';
import {
  BASIC_METRICS,
  EXTENDED_SIGNALS,
  RANGE_DEF,
  cycleNote,
  type RangeKey,
  type BasicMetricDef,
} from '../data/metrics';
import { computeCycle, parseDate, type CycleLog } from './cycleMath';
import { dateKeyOf, startOfWeek, addDays } from './dateUtils';

export interface TimePt {
  t: number;
  v: number;
}

/** 有些指标在展示层与数据层 key 不同（如皮肤含水量 skin 实际走 eda 信号） */
function signalKeyFor(metricKey: string): string {
  if (metricKey === 'skin') return 'eda';
  return metricKey;
}

/** 把展示/信号 key 映射到 healthStore 的规范 MetricKey（与 RingBleManager.hsKeyFor 保持一致）。 */
function hsKeyFor(signalKey: string): HSMetricKey {
  switch (signalKey) {
    case 'hr': case 'spo2': case 'temp': case 'eda': case 'hrv': case 'rr':
    case 'steps': case 'distance': case 'calorie':
    case 'stress': case 'fatigue': case 'met': case 'cortisol': case 'emotion': case 'skin':
    case 'bpSys': case 'bpDia':
      return signalKey as HSMetricKey;
    case 'snsActivation': return 'sns';
    case 'bloodSugar': return 'glucose';
    case 'bloodFat': return 'cholesterol';
    case 'triglyceride': return 'triglyceride';
    case 'hdl': return 'hdl';
    case 'ldl': return 'ldl';
    case 'uricAcid': return 'ua';
    default: return signalKey as HSMetricKey;
  }
}

export interface HistoryResult {
  kind: 'signal' | 'cycle';
  /** 渲染方式：continuous=true 时图表按真实 t（tMin..tMax）映射 x 轴；否则按索引 */
  continuous: boolean;
  /** 真实时间戳连续序列（continuous 用）。今日实时点与历史回填点都在这里，按 t 升序。 */
  tPoints?: TimePt[];
  /** continuous 的时间域（= 所选区间的起止 ms，含「现在」） */
  tMin?: number;
  tMax?: number;
  points: (number | null)[];
  /** 自定义 X 轴标签（如周期「第 N 天」）；缺省用 RANGE_DEF[range].axis */
  axisOverride?: string[];
  /** 每点相位（cycle 用，画背景带） */
  phaseAt?: (string | null)[];
  unit: string;
  yMin: number;
  yMax: number;
  latest: number | null;
  avg: number | null;
  hi: number | null;
  lo: number | null;
  multiDay: boolean;
  note?: string;
}

function dayMean(pts: TimePoint[] | undefined): number | null {
  if (!pts || pts.length === 0) return null;
  const vals = pts.map((p) => p.v).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 取某指标在某自然日（dateKey）的「当日归档值」，供周/月/年趋势跨天绘制。
 * 统一从 healthStore 读取；睡眠走 getSleep，其余走 getDay().mean。缺口返回 null（绘图断线、不编造）。
 */
function dailyValueFor(key: string, dk: string): number | null {
  const sk = signalKeyFor(key);
  if (sk === 'steps') return healthStore.getDay('steps', dk)?.mean ?? null;
  if (sk === 'sleepTotal') return healthStore.getSleep(dk)?.total ?? null;
  if (sk === 'sleepDeep') return healthStore.getSleep(dk)?.deep ?? null;
  if (sk === 'sleepRem') return healthStore.getSleep(dk)?.rem ?? null;
  if (sk === 'sleepScore') return healthStore.getSleep(dk)?.score ?? null;
  return healthStore.getDay(hsKeyFor(key), dk)?.mean ?? null;
}

function bucketByHour(pts: TimePoint[] | undefined): (number | null)[] {
  const sum = new Array(24).fill(0);
  const cnt = new Array(24).fill(0);
  if (pts) {
    for (const p of pts) {
      if (p.v == null || !Number.isFinite(p.v)) continue;
      const h = new Date(p.t).getHours();
      sum[h] += p.v;
      cnt[h] += 1;
    }
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : null));
}

function lastNonNull(vals: (number | null)[]): number | null {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return vals[i];
  return null;
}

function resolveDef(key: string): BasicMetricDef | null {
  return BASIC_METRICS.find((m) => m.key === key) || EXTENDED_SIGNALS.find((m) => m.key === key) || null;
}

function finalize(
  vals: (number | null)[],
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  const real = vals.filter((v): v is number => v != null);
  const latest = lastNonNull(vals);
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return {
    kind: 'signal',
    continuous: false,
    points: vals,
    unit: def.unit,
    yMin: def.yMin,
    yMax: def.yMax,
    latest,
    avg,
    hi,
    lo,
    multiDay,
    note,
  };
}

/** 真实时间戳连续序列的收口：统计来自 tPoints；tMin/tMax 为所选时间域（含「现在」）。 */
function finalizeContinuous(
  tps: TimePt[],
  tMin: number,
  tMax: number,
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  const real = tps.map((p) => p.v).filter((v) => Number.isFinite(v));
  const latest = tps.length ? tps[tps.length - 1].v : null;
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return {
    kind: 'signal',
    continuous: true,
    tPoints: tps,
    tMin,
    tMax,
    points: [],
    unit: def.unit,
    yMin: def.yMin,
    yMax: def.yMax,
    latest,
    avg,
    hi,
    lo,
    multiDay,
    note,
  };
}

function emptyResult(key: string, note: string): HistoryResult {
  return {
    kind: 'signal',
    continuous: false,
    points: [],
    unit: '',
    yMin: 0,
    yMax: 100,
    latest: null,
    avg: null,
    hi: null,
    lo: null,
    multiDay: false,
    note: `「${key}」暂无真实数据：${note}`,
  };
}

function phaseForDate(log: CycleLog | null, d: Date): string {
  if (!log || !log.lastPeriodStart) return 'unknown';
  const start = parseDate(log.lastPeriodStart);
  start.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const daysSince = Math.floor((d.getTime() - start.getTime()) / dayMs);
  if (daysSince < 0) return 'unknown';
  const cycleLen = Math.max(20, Math.min(45, Math.round(log.cycleLength || 28)));
  const periodLen = Math.max(2, Math.min(10, Math.round(log.periodLength || 5)));
  const luteal = Math.max(9, Math.min(20, Math.round(log.lutealLength || 14)));
  const ovulationDay = cycleLen - luteal;
  const dayInCycle = (daysSince % cycleLen) + 1;
  if (dayInCycle <= periodLen) return 'period';
  if (dayInCycle < ovulationDay) return 'follicular';
  if (dayInCycle <= ovulationDay + 1) return 'ovulation';
  return 'luteal';
}

function buildCycleSeries(log: CycleLog | null, ring: RingState, range: RangeKey, anchor: Date = new Date()): HistoryResult {
  const cs = ring.curveStatus;
  const effective: CycleLog | null = (() => {
    if (ring.female && ring.female.menstrualCircle > 0 && ring.female.lastMenstrualDate) {
      return {
        lastPeriodStart: ring.female.lastMenstrualDate,
        cycleLength: ring.female.menstrualCircle,
        lutealLength: 14,
        periodLength: ring.female.menstrualDays || 5,
      };
    }
    return log;
  })();

  const anchorKey = dateKeyOf(anchor.getTime());
  const isToday = anchorKey === dateKeyOf(Date.now());

  let points: (number | null)[] = [];
  let phaseAt: (string | null)[] = [];
  let axisOverride: string[] | undefined;

  if (range === 'day') {
    if (isToday) {
      // 日（今天）：今日 0–23 时真实体温，每小时一相同时段聚合（统一数据源 healthStore）
      const vals = bucketByHour(healthStore.getIntraday('temp', anchorKey));
      const phase = phaseForDate(effective, new Date());
      points = vals;
      phaseAt = vals.map(() => phase);
      axisOverride = Array.from({ length: 24 }, (_, i) => `${i}`);
    } else {
      // 日（历史某天）：只有 App 按天归档的当日体温均值（无逐时明细）
      const v = healthStore.getDay('temp', anchorKey)?.mean ?? null;
      if (v == null) {
        return emptyResult('cycle', `${anchorKey} 该日无真实体温数据（App 未在该日记录）`);
      }
      points = [v];
      phaseAt = [phaseForDate(effective, anchor)];
      axisOverride = ['体温'];
    }
  } else if (range === 'week') {
    // 周：anchor 所在自然周（周一 ~ 周日）
    const mon = startOfWeek(anchor);
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      const dk = dateKeyOf(d.getTime());
      points.push(healthStore.getDay('temp', dk)?.mean ?? null);
      phaseAt.push(phaseForDate(effective, d));
    }
    axisOverride = points.map((_, i) => {
      const d = addDays(mon, i);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
  } else {
    // month / year：以 anchor 所在自然月 / 自然年
    const y = anchor.getFullYear();
    const m0 = range === 'month' ? anchor.getMonth() : 0;
    const dim = range === 'month' ? new Date(y, m0 + 1, 0).getDate() : 12;
    for (let step = 0; step < dim; step++) {
      if (range === 'month') {
        const d = new Date(y, m0, step + 1);
        const dk = dateKeyOf(d.getTime());
        points.push(healthStore.getDay('temp', dk)?.mean ?? null);
        phaseAt.push(phaseForDate(effective, d));
      } else {
        // year：每月均值
        let sum = 0;
        let cnt = 0;
        const mdim = new Date(y, step + 1, 0).getDate();
        for (let day = 1; day <= mdim; day++) {
          const v = healthStore.getDay('temp', dateKeyOf(new Date(y, step, day).getTime()))?.mean ?? null;
          if (v != null) {
            sum += v;
            cnt += 1;
          }
        }
        points.push(cnt ? sum / cnt : null);
        phaseAt.push(null);
      }
    }
    axisOverride = points.map((_, i) => (range === 'month' ? `${i + 1}` : `${i + 1}月`));
  }

  const real = points.filter((v): v is number => v != null);
  const latest = lastNonNull(points);
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;

  let yMin = 35.0;
  let yMax = 39.0;
  if (real.length > 0) {
    const min = Math.min(...real);
    const max = Math.max(...real);
    const pad = (max - min) * 0.25 || 0.5;
    yMin = Math.max(34, min - pad);
    yMax = Math.min(41, max + pad);
  }

  return {
    kind: 'cycle',
    continuous: false,
    points,
    axisOverride,
    phaseAt,
    unit: '°C',
    yMin,
    yMax,
    latest,
    avg,
    hi,
    lo,
    multiDay: range !== 'day',
    note: `${cycleNote(range, cs)} 体温为戒指实测，可用于辅助确认排卵；雌激素/黄体酮戒指硬件暂不直接测量。`,
  };
}

/**
 * 洞察页卡片「今日」趋势的统一数据源。
 *
 * 与 MetricDetailScreen 日视图（buildHistorySeries(key,'day')）共用**同一个 healthStore.getTimeRange 调用**，
 * 因此洞察页每张数据卡片的「今天」这一段，与历史页面（详情页）日视图的今日段**逐点一致、密度一致
 * （同一 maxPoints / fillDailyMean / 时间窗口）**，不再出现“卡片多日回退、详情页只画今天”的错位。
 *
 * @param metricKey 展示层/信号层 key（如 'skin' 'snsActivation' 'bloodSugar'），内部经 hsKeyFor 映射到 healthStore 规范 key。
 */
export function getTodaySeries(metricKey: string): TimePt[] {
  const hsKey = hsKeyFor(metricKey);
  const start = dayStartMs(Date.now());
  const end = Date.now();
  return healthStore.getTimeRange(hsKey, start, end, { fillDailyMean: true, maxPoints: 480 });
}

export function buildHistorySeries(
  key: string,
  range: RangeKey,
  ring: RingState,
  cycleLog: CycleLog | null,
  anchor: Date = new Date()
): HistoryResult {
  if (key === 'cycle') return buildCycleSeries(cycleLog, ring, range, anchor);

  const def = resolveDef(key);
  if (!def) return emptyResult(key, '未找到该指标定义');

  const anchorKey = dateKeyOf(anchor.getTime());
  const isTodayAnchor = anchorKey === dateKeyOf(Date.now());
  const hsKey = hsKeyFor(key);
  const DAY = 86400000;

  // 日：今日取 healthStore 日内逐样本，按真实时间戳连续绘制（统一数据源 healthStore）；
  //     历史某天优先连续曲线，否则单点当日均值。
  if (range === 'day') {
    const start = dayStartMs(anchor.getTime());
    const end = isTodayAnchor ? Date.now() : start + DAY;
    const tps = healthStore.getTimeRange(hsKey, start, end, { fillDailyMean: true, maxPoints: 480 });
    console.log(`[REAL-SERIES-DAY] key=${key} hsKey=${hsKey} anchorKey=${anchorKey} isToday=${isTodayAnchor} tps=${tps.length} start=${start} end=${end}`);
    // 诊断：直接查 getIntraday
    const raw = healthStore.getIntraday(hsKey, anchorKey);
    const dk2 = anchorKey.replace(/-(\d)-(\d)$/, '-0$1-0$2').replace(/-0(\d)-0(\d)$/, '-0$1-0$2');
    console.log(`[REAL-SERIES-DAY] getIntraday(${hsKey}, ${anchorKey})=${raw.length} normalized=${healthStore.getIntraday(hsKey, dk2).length}`);
    if (tps.length === 0) {
      const dv = healthStore.getDay(hsKey, anchorKey)?.mean ?? null;
      if (dv == null) return emptyResult(key, `${anchorKey} 该日无真实测量数据（App 未在该日记录）`);
      return finalize([dv], def, false, `${def.name} ${anchorKey} 当日均值（按天归档，无逐时明细）`);
    }
    const note = isTodayAnchor
      ? `${def.name} 为今日真实测量（按时间戳连续绘制）。`
      : `${def.name} ${anchorKey} 当日连续测量（按时间戳连续绘制，离线回填补全）。`;
    return finalizeContinuous(tps, start, end, def, false, note);
  }

  // 周 / 月：按自然日取「当日均值」画趋势（每点 = 一天均值，按时间顺序；缺口 null 断线，不编造）。
  if (range === 'week' || range === 'month') {
    const out: (number | null)[] = [];
    const axis: string[] = [];
    if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        const dk = dateKeyOf(d.getTime());
        out.push(dailyValueFor(key, dk));
        axis.push(`${d.getMonth() + 1}/${d.getDate()}`);
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const dk = dateKeyOf(new Date(y, m0, day).getTime());
        out.push(dailyValueFor(key, dk));
        axis.push(`${day}`);
      }
    }
    const nonNull = out.filter((v) => v != null).length;
    const multiDay = nonNull > 1;
    const note = multiDay
      ? undefined
      : `${def.name} 的多日趋势来自 healthStore 按天归档与持续佩戴累积；当前范围内仅有少量真实数据，缺口为未记录或未同步之日。`;
    const res = finalize(out, def, multiDay, note);
    res.axisOverride = axis;
    return res;
  }

  // 年：按月均值趋势（12 个点，每月一个均值；缺口 null 断线）。
  const out: (number | null)[] = [];
  const axis: string[] = [];
  const y = anchor.getFullYear();
  for (let mo = 0; mo < 12; mo++) {
    const mdim = new Date(y, mo + 1, 0).getDate();
    let sum = 0;
    let cnt = 0;
    for (let day = 1; day <= mdim; day++) {
      const v = dailyValueFor(key, dateKeyOf(new Date(y, mo, day).getTime()));
      if (v != null) {
        sum += v;
        cnt += 1;
      }
    }
    out.push(cnt ? sum / cnt : null);
    axis.push(`${mo + 1}月`);
  }
  const nonNull = out.filter((v) => v != null).length;
  const res = finalize(out, def, nonNull > 1);
  res.axisOverride = axis;
  return res;
}
