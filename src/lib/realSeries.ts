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
import { hsKeyFor } from '../data/metricKeyMap';
import {
  BASIC_METRICS,
  EXTENDED_SIGNALS,
  BASICS_EXTRA_SIGNALS,
  RANGE_DEF,
  cycleNote,
  type RangeKey,
  type BasicMetricDef,
} from '../data/metrics';
import { computeCycle, parseDate, type CycleLog } from './cycleMath';
import { dateKeyOf, startOfWeek, addDays } from './dateUtils';
import KalmanFilter from './kalman-filter';
// ★ 2026-10-08：详情页皮质醇「日」视图与洞察页昼夜节律卡同源——改用融合算法
//   （HRV/EDA/体温/心率 z-score + 设备真实皮质醇真值，6 路加权 → 0~100 活性）。
import {
  buildCortisolProxyBaseline,
  buildCortisolShapedToday,
} from './cortisolProxy';
import { CORTISOL_PRIOR_DISCLAIMER } from './cortisolPrior';

export interface TimePt {
  t: number;
  v: number;
}

/**
 * 展示层 key → 信号层 key（恒等映射）。
 *
 * ★ v18.134（审查 04 🔵-3）：旧实现 `if (metricKey === 'skin') return 'eda'` 是**过时且错误**的。
 *   数据层 `skin` 与 `eda` 是两份独立 store（RingBleManager 有 eda → skin 双写，
 *   原生 emit 的 `eda` 与 skinMoisture 语义不同）；旧特判已无实际作用（skin 不匹配任何
 *   sleep 分支），却会让读代码的人误以为 skin 的数据在 eda 里。
 */
function signalKeyFor(metricKey: string): string {
  return metricKey;
}

/**
 * ★ v18.134（审查 04 🔴-1）：hsKeyFor 收敛到 src/data/metricKeyMap.ts 唯一实现
 *   （原副本与 RingBleManager 的副本漂移，default 无条件硬 cast）。
 *   返回类型为 HSMetricKey | null：未知 key → null，各调用点显式处理。
 */

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
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🟡#1）：本区间内**含推算值**的日期集合。
   *   周 / 月 / 年视图的每一根柱都对应一个（或一段）日期，取数链路
   *   （dailyValueFor → healthStore.getIntraday）**不区分推算日与实测日**，
   *   所以推算柱与实测柱长得一模一样。UI 必须靠这个字段显式告知用户。
   *   键为 dateKey('YYYY-MM-DD')；年视图为「该月内含推算日」的月份首日。
   */
  derivedDayKeys?: string[];
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🟡#1）：与 `points` **索引对齐**的推算位置。
   *   （周/月：index = 第几天；年：index = 第几个月。）UI 用它把推算柱单独着色。
   */
  derivedIndexes?: number[];
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
  if (sk === 'steps') {
    const val = healthStore.getDay('steps', dk)?.mean ?? null;
    return val;
  }
  if (sk === 'sleepTotal') return healthStore.getSleep(dk)?.total ?? null;
  if (sk === 'sleepDeep') return healthStore.getSleep(dk)?.deep ?? null;
  if (sk === 'sleepRem') return healthStore.getSleep(dk)?.rem ?? null;
  if (sk === 'sleepScore') return healthStore.getSleep(dk)?.score ?? null;
  // ★ 其他指标：从 intraday 实时重算 mean（不信任已存 daily.mean，旧数据含 0 占位符）
  const hsKey = hsKeyFor(key);
  if (!hsKey) return null; // ★ 未知 key 不再 fallback 到 getDay（旧实现硬 cast 会读不存在的 store）
  const today0 = new Date(dk + 'T00:00:00').getTime();
  const pts = healthStore.getIntraday(hsKey, dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
  if (pts.length === 0) return healthStore.getDay(hsKey, dk)?.mean ?? null; // fallback
  const real = pts.map((p) => p.v);
  return real.reduce((a, b) => a + b, 0) / real.length;
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
  // ★ 2026-11-06 审查（docs/audit/04 🔴-4）：NaN 也必须视为「无值」。
  //   旧实现只判 != null，NaN 会通过 → latest/avg/hi/lo 变成 NaN →
  //   hero 数值显示 "NaN"、SVG path 画出 NaN 坐标（整条曲线消失或画穿坐标轴）。
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function resolveDef(key: string): BasicMetricDef | null {
  return BASIC_METRICS.find((m) => m.key === key)
    || EXTENDED_SIGNALS.find((m) => m.key === key)
    || BASICS_EXTRA_SIGNALS.find((m) => m.key === key)
    || null;
}

function finalize(
  vals: (number | null)[],
  def: BasicMetricDef,
  multiDay: boolean,
  note?: string
): HistoryResult {
  // ★ 2026-11-06 审查（docs/audit/04 🔴-4）：过滤 NaN/Infinity，不只是 null。
  //   否则 avg/hi/lo 变 NaN → hero 显示 "NaN"；points 里残留的 NaN 也会让 SVG 路径失效。
  const real = vals.filter((v): v is number => v != null && Number.isFinite(v));
  // points 里的 NaN 归一为 null（图表层按「断点」处理，不画穿坐标轴）
  const safeVals = vals.map((v) => (v != null && Number.isFinite(v) ? v : null));
  const latest = lastNonNull(vals);
  const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const hi = real.length ? Math.max(...real) : null;
  const lo = real.length ? Math.min(...real) : null;
  return {
    kind: 'signal',
    continuous: false,
    points: safeVals,
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
  // ★ 2026-11-06 审查（🔴-4）：最后一个点可能是 NaN → latest 变 NaN → hero 显示 "NaN"。
  //   改为「最后一个**有限**值」。
  const latest = lastNonNull(tps.map((p) => p.v));
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
    note: `「${key}」暂无数据：${note}`,
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
        return emptyResult('cycle', `${anchorKey} 该日暂无体温数据`);
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
    note: `${cycleNote(range, cs)} 曲线按周期阶段变化，用来观察排卵前后的走势。`,
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
/**
 * ★ 2026-11-12：戒指 RTC 未对时期间回读的样本时间戳可能略超前于手机，
 * 今日查询上界留 45 分钟容差，避免真实读数被 Date.now() 当成「未来数据」整段过滤掉。
 * 数据落库前已由 RingBleManager 统一平移校正，这里只是不丢点的兜底。
 */
export const TODAY_QUERY_TOLERANCE_MS = 45 * 60_000;

export function getTodaySeries(metricKey: string): TimePt[] {
  const hsKey = hsKeyFor(metricKey);
  if (!hsKey) return []; // ★ 未知 key → 明确返回空，不读不存在的 store
  const start = dayStartMs(Date.now());
  const end = Date.now() + TODAY_QUERY_TOLERANCE_MS;
  return healthStore.getTimeRange(hsKey, start, end, { fillDailyMean: true, maxPoints: 480 });
}

// 真正需要手动测量的指标：戒指没有连续信号，只能手动测
// 血糖/血压 等戒指有 intraday 连续信号，走下面通用链路
const MANUAL_KEYS_SET = new Set(['triglyceride', 'hdl', 'ldl', 'cholesterol', 'bloodFat', 'uricAcid']);

// ★ 2026-10-17 初版曾把 bpSys/bpDia 也纳入 15 分钟分桶；
//   但血压是点测信号（一天几次读数），按 15 分钟平均在临床上无意义，且主流健康 App 均不这么做
//   （Apple 健康 / Withings / Omron 都是逐次读数折线）。故血压已移出，仅保留 glucose：
//   血糖若为 CGM（连续血糖监测）是真·连续信号，每几分钟一点，15 分钟窗口聚合合理。
const DAY_BIN_15MIN = new Set(['glucose']);

/** 把日内连续点按 15 分钟窗口聚合：每个窗口只保留一点（窗口内均值，时间戳取窗口内最新样本）。 */
function binTo15Min(tps: TimePt[], dayStart: number, bucketMs = 15 * 60 * 1000): TimePt[] {
  if (tps.length === 0) return tps;
  const BUCKET = bucketMs;
  const map = new Map<number, { sum: number; cnt: number; lastT: number }>();
  for (const p of tps) {
    const slot = Math.floor((p.t - dayStart) / BUCKET);
    const cur = map.get(slot) ?? { sum: 0, cnt: 0, lastT: p.t };
    cur.sum += p.v;
    cur.cnt += 1;
    cur.lastT = p.t; // 取窗口内最新样本的真实时间戳
    map.set(slot, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, agg]) => ({ t: agg.lastT, v: agg.sum / agg.cnt }));
}

export function buildHistorySeries(
  key: string,
  range: RangeKey,
  ring: RingState,
  cycleLog: CycleLog | null,
  anchor: Date = new Date()
): HistoryResult {
  if (key === 'cycle') return buildCycleSeries(cycleLog, ring, range, anchor);

  // ★ 2026-10-16（用户实锤「尿酸详情页日周月年没有数据」）：
  //   洞察页血液面板以 UI 别名 'ua' 打开详情页（BloodComponentPanel 入口则用 'uricAcid'），
  //   而指标定义表 / MANUAL_KEYS_SET 的规范 key 是 'uricAcid'（hsKeyFor 才映射到数据层 'ua'）。
  //   旧代码把 'ua' 直接喂给 resolveDef → 三张定义表都查不到 → emptyResult('未找到该指标定义')，
  //   manual 分支也不命中（集合里是 'uricAcid'）→ 日/周/月/年四个视图全部无数据。
  //   入口统一归一为 'uricAcid'，与 hsKeyFor('uricAcid') → 'ua' 形成闭环。
  if (key === 'ua') key = 'uricAcid';

  const def = resolveDef(key);
  if (!def) return emptyResult(key, '未找到该指标定义');

  // ★ 手动测量类指标（血糖/血脂/尿酸/血压等）：优先从 manualMeasurements 取时间序列画趋势图；
  // 如果 manualMeasurements 为空（比如原生 SDK 把数据写到 intraday），fallback 到下面通用链路。
  if (MANUAL_KEYS_SET.has(key)) {
    const hsKey = hsKeyFor(key);
    if (!hsKey) return emptyResult(key, '未知指标 key（未在 metricKeyMap 登记）');
    const all = healthStore.getManualMeasurements(hsKey);  // 按时间倒序
    if (all.length > 0) {
      // 有 manual 数据，走趋势图
      const asc = [...all].sort((a, b) => a.t - b.t);
      if (range === 'day') {
        const start = dayStartMs(anchor.getTime());
        const end = start + 86400000;
        const pts = asc.filter(m => m.t >= start && m.t < end).map(m => ({ t: m.t, v: m.v }));
        // ★ 2026-11-04（用户「尿酸详情页也要半小时趋势图」）：尿酸不走手动优先——
        //   healthGlance 扩展指标实际增量写入了实时连续存储（upsertRealtime 'ua' + 15 分钟槽），
        //   手动优先导致日视图只剩一两个稀疏点。改为 实时连续 + 手动点 合并后按 30 分钟槽聚合，
        //   与心率/血氧等详情页同款 0-24h 连续趋势。
        if (key === 'uricAcid') {
          const isTodayUa = dateKeyOf(anchor.getTime()) === dateKeyOf(Date.now());
          const dataEndUa = isTodayUa ? Date.now() : end;
          const intra = healthStore
            .getTimeRange(hsKey, start, dataEndUa, { fillDailyMean: false, maxPoints: 480 })
            .filter(p => Number.isFinite(p.v) && p.v > 0);
          const merged = [...intra, ...pts].sort((a, b) => a.t - b.t);
          if (merged.length >= 2) {
            return finalizeContinuous(
              binTo15Min(merged, start, 30 * 60 * 1000),
              start, end, def, false, `${def.name} 30 分钟趋势`
            );
          }
        }
        if (pts.length) {
          return finalizeContinuous(pts, start, end, def, false);
        }
      } else if (range === 'week' || range === 'month') {
        const DAY = 86400000;
        const anchorMs = anchor.getTime();
        const dk0 = new Date(anchorMs);
        let startDay: Date;
        let n: number;
        if (range === 'week') {
          const mon = new Date(anchorMs);
          mon.setDate(mon.getDate() - mon.getDay() + 1);
          startDay = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
          n = 7;
        } else {
          startDay = new Date(dk0.getFullYear(), dk0.getMonth(), 1);
          n = new Date(dk0.getFullYear(), dk0.getMonth() + 1, 0).getDate();
        }
        const out: (number | null)[] = [];
        const axis: string[] = [];
        for (let i = 0; i < n; i++) {
          const d = new Date(startDay.getTime() + i * DAY);
          const dayMs = dayStartMs(d.getTime());
          const dayEnd = dayMs + DAY;
          // ★ 2026-11-04（用户）：尿酸周/月聚合并入实时连续存储（当日均值），与日视图同源
          let dayPts: TimePt[] = asc.filter(m => m.t >= dayMs && m.t < dayEnd).map(m => ({ t: m.t, v: m.v }));
          if (key === 'uricAcid') {
            const intra = healthStore
              .getTimeRange(hsKey, dayMs, dayEnd, { fillDailyMean: false, maxPoints: 480 })
              .filter(p => Number.isFinite(p.v) && p.v > 0);
            dayPts = [...intra, ...dayPts].sort((a, b) => a.t - b.t);
          }
          out.push(dayPts.length
            ? (key === 'uricAcid' ? dayPts.reduce((acc, p) => acc + p.v, 0) / dayPts.length : dayPts[dayPts.length - 1].v)
            : null);
          axis.push(range === 'week' ? `${d.getMonth() + 1}/${d.getDate()}` : `${i + 1}`);
        }
        const nonNull = out.filter(v => v != null).length;
        if (nonNull > 0) {
          const res = finalize(out, def, nonNull > 1);
          res.axisOverride = axis;
          return res;
        }
      } else {
        // year
        const y = anchor.getFullYear();
        const out: (number | null)[] = [];
        const axis: string[] = [];
        for (let mo = 0; mo < 12; mo++) {
          const monthStart = new Date(y, mo, 1).getTime();
          const monthEnd = new Date(y, mo + 1, 0).getTime() + 86400000;
          // ★ 2026-11-04（用户）：尿酸年聚合并入实时连续存储
          let monthPts: TimePt[] = asc.filter(m => m.t >= monthStart && m.t < monthEnd).map(m => ({ t: m.t, v: m.v }));
          if (key === 'uricAcid') {
            const intra = healthStore
              .getTimeRange(hsKey, monthStart, monthEnd, { fillDailyMean: false, maxPoints: 480 })
              .filter(p => Number.isFinite(p.v) && p.v > 0);
            monthPts = [...intra, ...monthPts].sort((a, b) => a.t - b.t);
          }
          out.push(monthPts.length ? monthPts.reduce((acc, p) => acc + p.v, 0) / monthPts.length : null);
          axis.push(`${mo + 1}月`);
        }
        const nonNull = out.filter(v => v != null).length;
        if (nonNull > 0) {
          const res = finalize(out, def, nonNull > 1);
          res.axisOverride = axis;
          return res;
        }
      }
      // manual 数据在所选范围内为空 → fallback 到通用链路（继续往下跑）
    }
    // manualMeasurements 本身就为空 → fallback 到通用链路
  }

  const anchorKey = dateKeyOf(anchor.getTime());
  const isTodayAnchor = anchorKey === dateKeyOf(Date.now());
  const hsKey = hsKeyFor(key);
  if (!hsKey) return emptyResult(key, '未知指标 key（未在 metricKeyMap 登记）');
  const DAY = 86400000;

  // ★ 诊断日志 — bloodSugar / 所有 key
  {
    const _intraday = healthStore.getIntraday(hsKey, anchorKey);
    const _day = healthStore.getDay(hsKey, anchorKey);
    const _keys = Object.keys((healthStore as any).stores?.[hsKey]?.intraday ?? {});
    const _manual = healthStore.getManualMeasurements(hsKey);
    console.log(`[HISTORY] key=${key} hsKey=${hsKey} range=${range} dayKey=${anchorKey} isToday=${isTodayAnchor} | intraday=${_intraday.length} dayMean=${_day?.mean ?? 'null'} manual=${_manual.length} storeDays=[${_keys.slice(-5).join(',')}]`);
  }

  // 日：今日取 healthStore 日内逐样本，按真实时间戳连续绘制（统一数据源 healthStore）；
  //     历史某天优先连续曲线，否则单点当日均值。
  if (range === 'day') {
    const start = dayStartMs(anchor.getTime());
    // ★ tMin/tMax 固定为完整 0:00-24:00（让 X 轴 0-24h 刻度对齐），曲线在 Date.now() 之后自然断开
    const KF_DAY_FULL_RANGE = new Set(['cortisol', 'eda', 'hrv', 'stress', 'fatigue', 'emotion', 'skin']);
    const end = KF_DAY_FULL_RANGE.has(hsKey) ? start + DAY : (isTodayAnchor ? Date.now() : start + DAY);
    const dataEnd = isTodayAnchor && !KF_DAY_FULL_RANGE.has(hsKey) ? Date.now() : end;
    let tps = healthStore.getTimeRange(hsKey, start, dataEnd, { fillDailyMean: true, maxPoints: 480 });
    // ★ 过滤原生 SDK 占位符 0 值（生理指标不可能为 0）
    tps = tps.filter(p => Number.isFinite(p.v) && p.v > 0);
    // ★ 2026-10-17：仅 glucose（CGM 连续信号）日视图按 15 分钟窗口聚合；
    //   血压(bpSys/bpDia) 已移出——点测信号走 BpDetailScreen 的逐次读数折线，不做分桶。
    if (DAY_BIN_15MIN.has(hsKey)) {
      tps = binTo15Min(tps, start);
    }
    console.log(`[REAL-SERIES-DAY] key=${key} hsKey=${hsKey} anchorKey=${anchorKey} isToday=${isTodayAnchor} tps=${tps.length} start=${start} end=${end}`);
    // ★ DEBUG: 打印 tps 首尾值和分布
    const _first3 = tps.slice(0,3).map(p=>`${p.t%86400000}s=${p.v?.toFixed?.(2)??p.v}`);
    const _last3 = tps.slice(-3).map(p=>`${p.t%86400000}s=${p.v?.toFixed?.(2)??p.v}`);
    const _vals = tps.map(p=>p.v).filter(v=>typeof v==='number' && Number.isFinite(v));
    const _min = _vals.length? Math.min(..._vals):null;
    const _max = _vals.length? Math.max(..._vals):null;
    const _avg = _vals.length? _vals.reduce((a,b)=>a+b,0)/_vals.length : null;
    console.log(`[REAL-SERIES-DAY] tps: first3=[${_first3}] last3=[${_last3}] min=${_min?.toFixed?.(2)} max=${_max?.toFixed?.(2)} avg=${_avg?.toFixed?.(2)}`);
    // 诊断：直接查 getIntraday
    const raw = healthStore.getIntraday(hsKey, anchorKey);
    const dk2 = anchorKey.replace(/-(\d)-(\d)$/, '-0$1-0$2').replace(/-0(\d)-0(\d)$/, '-0$1-0$2');
    console.log(`[REAL-SERIES-DAY] getIntraday(${hsKey}, ${anchorKey})=${raw.length} normalized=${healthStore.getIntraday(hsKey, dk2).length}`);
    if (tps.length === 0) {
      const dv = healthStore.getDay(hsKey, anchorKey)?.mean ?? null;
      if (dv == null) return emptyResult(key, `${anchorKey} 该日暂无数据`);
      return finalize([dv], def, false, `当天只有一个汇总值，暂无逐时明细。`);
    }

    // ★ 2026-10-08：皮质醇今日 → 与洞察页昼夜节律卡**同一套融合算法**（buildCortisolProxyToday）。
    //   旧实现 buildCortisolToday30 是「原始设备 μg/L 点测 + 14 天 cosinor 补形」，
    //   与洞察页已切换的「多模态反推活性」是两套口径、数值不可比 → 这里统一成融合活性（0~100）。
    //   有真实皮质醇真值时，该路以 0.30 权重并入合成；无真值时数学上退回纯 proxy，曲线不变（向后兼容）。
    if (hsKey === 'cortisol' && isTodayAnchor) {
      const bl = buildCortisolProxyBaseline(14);
      // ★ 2026-11-08：与洞察页 / 首页 / 趋势图统一走「正常昼夜节律先验 + 实测温和修正」。
      const px = buildCortisolShapedToday(bl);
      const nowMs = Date.now();
      const today0 = dayStartMs(nowMs);
      const tps2: { t: number; v: number }[] = [];
      for (let slot = 0; slot < 48; slot++) {
        const v = px.vals[slot];
        // 仅画「拟合后已过去的槽」；未来时段（>now）保持不画，保持诚实
        if (slot * 2 <= new Date(nowMs).getHours() * 2 + (new Date(nowMs).getMinutes() >= 30 ? 1 : 0)
            && v != null && Number.isFinite(v)) {
          const ts = today0 + slot * 1800000 + 900000; // 30min 槽中点
          tps2.push({ t: ts, v });
        }
      }
      if (tps2.length > 0) {
        const note = `皮质醇全天趋势（0~100 相对指数）。${CORTISOL_PRIOR_DISCLAIMER}`;
        return finalizeContinuous(tps2, start, end, def, false, note);
      }
    }

    // ★ 其他高频连续生物信号 → Kalman 滤波
    const KF_HIGH_FREQ = new Set(['eda', 'hrv', 'stress', 'fatigue', 'met', 'emotion', 'skin']);
    if (KF_HIGH_FREQ.has(hsKey)) {
      const kf = new KalmanFilter({ R: 2, Q: 0.1 });
      tps = tps.map(p => ({ ...p, v: kf.filter(p.v) }));
    }

    // ★ 2026-11-08（用户）：删掉「X 为今日真实测量 / 当日连续测量」这类来源注脚。
    //   数值本来就来自测量，写在卡片底下是废话；有实质内容的解读由上游 note 提供。
    return finalizeContinuous(tps, start, end, def, false);
  }

  // 周 / 月：按自然日取「当日均值」画趋势（每点 = 一天均值，按时间顺序；缺口 null 断线，不编造）。
  if (range === 'week' || range === 'month') {
    const out: (number | null)[] = [];
    const axis: string[] = [];
    // ★ 2026-11-06 审查（docs/audit/02 🟡#1）：收集区间内的推算日，供 UI 标注。
    const derivedDayKeys: string[] = [];
    const derivedIndexes: number[] = [];
    const trackDerived = (dk: string, hasValue: boolean, idx: number) => {
      if (hasValue && healthStore.isDerivedDay(hsKey, dk)) {
        derivedDayKeys.push(dk);
        derivedIndexes.push(idx);
      }
    };
    if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        const dk = dateKeyOf(d.getTime());
        const v = dailyValueFor(key, dk);
        out.push(v);
        trackDerived(dk, v != null, i);
        axis.push(`${d.getMonth() + 1}/${d.getDate()}`);
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const dk = dateKeyOf(new Date(y, m0, day).getTime());
        const v = dailyValueFor(key, dk);
        out.push(v);
        trackDerived(dk, v != null, day - 1);
        axis.push(`${day}`);
      }
    }
    const nonNull = out.filter((v) => v != null).length;
    const multiDay = nonNull > 1;
    const note = multiDay
      ? undefined
      : `当前范围内数据点还很少，空白的日期是尚未记录或未同步的。连续佩戴几天后，趋势会更清楚。`;
    const res = finalize(out, def, multiDay, note);
    res.axisOverride = axis;
    if (derivedDayKeys.length) {
      res.derivedDayKeys = derivedDayKeys;
      res.derivedIndexes = derivedIndexes;
    }
    return res;
  }

  // 年：按月均值趋势（12 个点，每月一个均值；缺口 null 断线）。
  const out: (number | null)[] = [];
  const axis: string[] = [];
  // ★ 2026-11-06 审查（docs/audit/02 🟡#1）：年视图按月聚合 → 收集「含推算日」的月份。
  const derivedDayKeys: string[] = [];
  const derivedIndexes: number[] = [];
  const y = anchor.getFullYear();
  for (let mo = 0; mo < 12; mo++) {
    const mdim = new Date(y, mo + 1, 0).getDate();
    let sum = 0;
    let cnt = 0;
    let monthHasDerived = false;
    for (let day = 1; day <= mdim; day++) {
      const dk = dateKeyOf(new Date(y, mo, day).getTime());
      const v = dailyValueFor(key, dk);
      if (v != null) {
        sum += v;
        cnt += 1;
        if (healthStore.isDerivedDay(hsKey, dk)) monthHasDerived = true;
      }
    }
    if (monthHasDerived) {
      derivedDayKeys.push(dateKeyOf(new Date(y, mo, 1).getTime()));
      derivedIndexes.push(mo);
    }
    out.push(cnt ? sum / cnt : null);
    axis.push(`${mo + 1}月`);
  }
  const nonNull = out.filter((v) => v != null).length;
  const res = finalize(out, def, nonNull > 1);
  res.axisOverride = axis;
  if (derivedDayKeys.length) {
    res.derivedDayKeys = derivedDayKeys;
    res.derivedIndexes = derivedIndexes;
  }
  return res;
}
