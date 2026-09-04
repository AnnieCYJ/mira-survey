/**
 * realSeries —— 洞察页「卡片详情」用的真实历史数据构造
 *
 * 设计原则（与全局一致 · 不造假）：
 *  - day（日）：取今日真实日内时间槽（核心信号 ring.history / 扩展信号 ring.dailyHistory），
 *    按小时聚合为 24 点。
 *  - week/month/year：按自然日聚合。体温走 ring.tempDaily（跨天累积，真多日）;
 *    其余信号运行时只保留当日数据，故仅当日有值，历史日留空（诚实，不编造多日趋势）。
 *  - cycle：戒指测不了雌激素，因此 cycle 详情页不再展示建模雌激素曲线，
 *    改为展示「真实体温序列 + 周期相位背景带」，并标注体温为实测、激素未测。
 *  所有缺口（null）在绘图时断线，绝不臆造连续走势。
 */
import type { RingState, TimePoint } from '../ble/RingBleManager';
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

const CORE_KEYS = new Set(['hr', 'spo2', 'temp', 'eda', 'hrv', 'rr']);

/** 有些指标在展示层与数据层 key 不同（如皮肤含水量 skin 实际走 eda 信号） */
function signalKeyFor(metricKey: string): string {
  if (metricKey === 'skin') return 'eda';
  return metricKey;
}

export interface HistoryResult {
  kind: 'signal' | 'cycle';
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
 * - 各核心指标走各自的 *Daily 存储（HRV/睡眠/计步来自原生 backfill 历史回填；其余随每日跨天累积）；
 * - 今天的多日归档要等跨天（午夜）才写入，因此对 todayKey 用今日实时均值兜底，避免当天空白。
 * - 缺口（戒指未记录/未同步）返回 null，绘图时断线、不编造。
 */
function dailyValueFor(
  key: string,
  dk: string,
  ring: RingState,
  hist: Record<string, TimePoint[]>,
  daily: Record<string, TimePoint[]>,
  todayKey: string
): number | null {
  const sk = signalKeyFor(key);
  let v: number | null = null;
  switch (sk) {
    case 'hr':
      v = ring.hrDaily[dk] ?? null;
      break;
    case 'spo2':
      v = ring.spo2Daily[dk] ?? null;
      break;
    case 'temp':
      v = ring.tempDaily[dk] ?? null;
      break;
    case 'eda':
      v = ring.edaDaily[dk] ?? null;
      break;
    case 'hrv':
      v = ring.hrvDaily[dk] ?? null;
      break;
    case 'rr':
      v = ring.rrDaily[dk] ?? null;
      break;
    case 'steps':
      v = ring.stepDaily[dk]?.steps ?? null;
      break;
    case 'sleepTotal':
      v = ring.sleepDaily[dk]?.total ?? null;
      break;
    case 'sleepDeep':
      v = ring.sleepDaily[dk]?.deep ?? null;
      break;
    default:
      // 健康一览扩展指标（血脂/心理/血压/身体成分）+ 手动测量（血压/ECG 平均心率）：
      // 从按天归档 extDaily 取当日值，供周/月/年跨天趋势。缺口（未记录）返回 null，绘图断线。
      v = ring.extDaily[dk]?.[sk] ?? null;
  }
  if (v == null && dk === todayKey) {
    // 今天的多日归档尚未跨天写入，用今日实时均值兜底
    const isCoreSignal = CORE_KEYS.has(sk);
    v = dayMean(isCoreSignal ? hist[sk] : daily[sk]);
  }
  return v;
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

function emptyResult(key: string, note: string): HistoryResult {
  return {
    kind: 'signal',
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
      // 日（今天）：今日 0–23 时真实体温，每小时一相同时段聚合
      const vals = bucketByHour(ring.history.temp);
      const phase = phaseForDate(effective, new Date());
      points = vals;
      phaseAt = vals.map(() => phase);
      axisOverride = Array.from({ length: 24 }, (_, i) => `${i}`);
    } else {
      // 日（历史某天）：只有 App 按天归档的当日体温均值（无逐时明细）
      const v = ring.tempDaily[anchorKey] ?? null;
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
      points.push(ring.tempDaily[dk] ?? null);
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
        points.push(ring.tempDaily[dk] ?? null);
        phaseAt.push(phaseForDate(effective, d));
      } else {
        // year：每月均值
        let sum = 0;
        let cnt = 0;
        const mdim = new Date(y, step + 1, 0).getDate();
        for (let day = 1; day <= mdim; day++) {
          const v = ring.tempDaily[dateKeyOf(new Date(y, step, day).getTime())] ?? null;
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

  const hist = ring.history as Record<string, TimePoint[]>;
  const daily = ring.dailyHistory as Record<string, TimePoint[]>;
  const anchorKey = dateKeyOf(anchor.getTime());

  // 日：今天→实时时间槽 24h 聚合；历史某天→优先用按天日内序列画连续曲线（跨天时间桶），否则单点均值
  if (range === 'day') {
    const isToday = anchorKey === dateKeyOf(Date.now());
    if (isToday) {
      const signalKey = signalKeyFor(key);
      const isCoreSignal = CORE_KEYS.has(signalKey);
      const src = isCoreSignal ? hist[signalKey] : daily[signalKey];
      const vals = bucketByHour(src);
      return finalize(
        vals,
        def,
        false,
        `${def.name} 为今日真实测量（按小时聚合）。保持佩戴并开启自动监测后，周/月/年将展示跨天趋势。`
      );
    }
    // 历史某天：优先用按天日内序列画连续曲线（跨天时间桶，重连即由 backfill 补回），
    // 让「离线那段时间的 HR/HRV/血氧/体温」都能直接画到趋势图上；无逐时明细再回退单点均值。
    const signalKey = signalKeyFor(key);
    const daySeries = ring.seriesByDay[signalKey]?.[anchorKey];
    if (daySeries && daySeries.length > 0) {
      const vals = bucketByHour(daySeries);
      return finalize(vals, def, false, `${def.name} ${anchorKey} 当日连续测量（按小时聚合，离线回填补全）`);
    }
    const dv = dailyValueFor(key, anchorKey, ring, hist, daily, anchorKey);
    if (dv == null) return emptyResult(key, `${anchorKey} 该日无真实测量数据（App 未在该日记录）`);
    return finalize([dv], def, false, `${def.name} ${anchorKey} 当日均值（App 按天归档，无逐时明细）`);
  }

  // 周/月/年：以 anchor 为窗口基准（anchor 为最右/末点）
  const out: (number | null)[] = [];
  const axis: string[] = [];
  if (range === 'week') {
    // 自然周：周一 ~ 周日
    const mon = startOfWeek(anchor);
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      const dk = dateKeyOf(d.getTime());
      out.push(dailyValueFor(key, dk, ring, hist, daily, dk));
      axis.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
  } else if (range === 'month') {
    const y = anchor.getFullYear();
    const m0 = anchor.getMonth();
    const dim = new Date(y, m0 + 1, 0).getDate();
    for (let day = 1; day <= dim; day++) {
      const dk = dateKeyOf(new Date(y, m0, day).getTime());
      out.push(dailyValueFor(key, dk, ring, hist, daily, dk));
      axis.push(`${day}`);
    }
  } else {
    // year：anchor 所在自然年，12 个月各取月内每日均值
    const y = anchor.getFullYear();
    for (let mo = 0; mo < 12; mo++) {
      let sum = 0;
      let cnt = 0;
      const mdim = new Date(y, mo + 1, 0).getDate();
      for (let day = 1; day <= mdim; day++) {
        const dk = dateKeyOf(new Date(y, mo, day).getTime());
        const v = dailyValueFor(key, dk, ring, hist, daily, dk);
        if (v != null) {
          sum += v;
          cnt += 1;
        }
      }
      out.push(cnt ? sum / cnt : null);
      axis.push(`${mo + 1}月`);
    }
  }

  const nonNull = out.filter((v) => v != null).length;
  const multiDay = nonNull > 1;
  const note = multiDay
    ? undefined
    : `${def.name} 的多日趋势来自 App 按天归档与持续佩戴累积；当前范围内仅有少量真实数据，缺口为未记录或未同步之日。`;

  const res = finalize(out, def, multiDay, note);
  if (range === 'year') res.axisOverride = axis;
  return res;
}
