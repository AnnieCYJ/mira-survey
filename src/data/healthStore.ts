/**
 * healthStore.ts —— Mira Ring 唯一健康数据源（历史存储 + 离线读取统一层）
 *
 * 设计目标（对应数据层重做）：
 *  1. 单一规范模型：每个指标只有一个 DayMetric（日聚合）+ intraday（逐时曲线），
 *     消灭旧 RingState 里 history / seriesByDay / *Daily 三套并存导致的"读哪个"混乱。
 *  2. 规范日期 key：全仓只用 `YYYY-MM-DD`（补零、ISO、跨平台一致）。
 *     接收原生回传的非补零 `2026-9-3` → normalizeDayKey() 归一成 `2026-09-03`；
 *     发给原生 queryDate 一律 `2026-09-03`。杜绝 `new Date('...')` 字符串解析（iOS 出 NaN）。
 *  3. 统一读写 API：upsertRealtime / upsertBackfill / upsertManual / getDay / getIntraday /
 *     getSeries / getLatest。所有页面与 realSeries 只调这套，不再直接翻三处 map。
 *  4. 持久化 v2：单快照 healthStore.json，含全部 stores + 睡眠 + 健康一览 + 元信息；
 *     load 时把旧 v1 快照（*Daily/seriesByDay/extDaily/ecgDaily）迁移进来，非法 key 丢弃。
 *
 * 本模块不依赖 React Native，纯 TS，可在 Node 下单测。
 */

// ───────────────────────────────────────────────────────────────────────────
// 日期工具（全仓唯一实现，禁止在别处 new Date('... 00:00:00')）
// ───────────────────────────────────────────────────────────────────────────
export function dayStartMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/** 规范 key：YYYY-MM-DD（补零）。 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 解析各种格式的日期 key 为当天 0 点 ms；无法解析返回 NaN。 */
export function parseDayKey(k: string): number {
  if (typeof k !== 'string') return NaN;
  const m = k.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

/** 把非补零/带斜杠的 key 归一为 YYYY-MM-DD；非法则原样返回（调用方应丢弃）。 */
export function normalizeDayKey(k: string): string {
  const ms = parseDayKey(k);
  return Number.isNaN(ms) ? k : dayKey(ms);
}

/** 解析样本时间 t（关联日期 dateKey）。兼容 HH:MM / HH:MM:SS / 含日期 / epoch。 */
export function parseSampleTs(dateKey: string, t: string): number | null {
  if (typeof t !== 'string' || t.length === 0) return null;
  const base = parseDayKey(dateKey);
  if (!Number.isFinite(base)) return null;
  let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3] ?? 0);
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) {
      return base + h * 3600000 + min * 60000 + s * 1000;
    }
  }
  m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const ts = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? 0), 0,
    ).getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (/^\d{9,}$/.test(t)) {
    const n = Number(t);
    return n > 1e12 ? n : n * 1000;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────────────
export type MetricKey =
  | 'hr' | 'hrv' | 'spo2' | 'temp' | 'eda' | 'rr'
  | 'steps' | 'distance' | 'calorie'
  | 'stress' | 'fatigue' | 'sns' | 'met'
  | 'bpSys' | 'bpDia' | 'glucose' | 'lipid' | 'ua' | 'skin' | 'emotion' | 'cortisol'
  | 'triglyceride' | 'hdl' | 'ldl' | 'cholesterol';

export const ALL_METRIC_KEYS: MetricKey[] = [
  'hr', 'hrv', 'spo2', 'temp', 'eda', 'rr',
  'steps', 'distance', 'calorie',
  'stress', 'fatigue', 'sns', 'met',
  'bpSys', 'bpDia', 'glucose', 'lipid', 'ua', 'skin', 'emotion', 'cortisol',
  'triglyceride', 'hdl', 'ldl', 'cholesterol',
];

export type Source = 'realtime' | 'backfill' | 'manual' | 'mixed';

export interface DayMetric {
  mean: number | null;
  min: number | null;
  max: number | null;
  last: number | null;
  samples: number;
  source: Source;
  updatedAt: number;
}

export interface TimePoint {
  t: number; // 绝对 ms
  v: number;
}

export interface ManualMeasurement {
  t: number;          // epoch ms
  v: number;          // value
  source?: string;    // 'healthGlance' | 'manual' | 'backfill'
}

export interface MetricStore {
  daily: Record<string, DayMetric>;       // dayKey -> 日聚合
  intraday: Record<string, TimePoint[]>;  // dayKey -> 当天逐样本（按 t 升序）
  manualMeasurements?: ManualMeasurement[];
}

export interface SleepSummary {
  total: number;
  deep: number;
  light: number;
  rem: number;
  score: number;
  getUp: number;
}

export interface HealthGlanceDay {
  [sub: string]: number; // pressure/fatigue/sns/met/glucose/lipid/ua/skin/emotion/cortisol...
}

const SCHEMA_VERSION = 2;
const MERGE_MS = 60 * 1000; // 同一天内时间差 < 1min 的样本视为同一时刻，取后写

function emptyStore(): MetricStore {
  return { daily: {}, intraday: {}, manualMeasurements: [] };
}

function clampValid(v: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function mergeIntraday(prev: TimePoint[] | undefined, incoming: TimePoint[]): TimePoint[] {
  if (!prev || prev.length === 0) return [...incoming].sort((a, b) => a.t - b.t);
  const map = new Map<number, TimePoint>();
  for (const p of prev) map.set(p.t, p);
  for (const p of incoming) {
    // 找最近邻（±MERGE_MS）覆盖，否则新增
    let replaced = false;
    for (const k of map.keys()) {
      if (Math.abs(k - p.t) <= MERGE_MS) { map.set(k, p); replaced = true; break; }
    }
    if (!replaced) map.set(p.t, p);
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

function recomputeDaily(
  intraday: TimePoint[],
  prevDaily: DayMetric | undefined,
  source: Source,
): DayMetric {
  const vals = intraday.map((p) => p.v).filter((v) => Number.isFinite(v));
  const real = vals.filter((v) => v > 0 || intraday.length === 0 ? Number.isFinite(v) : false);
  const use = vals.length ? vals : [];
  const mean = use.length ? use.reduce((a, b) => a + b, 0) / use.length : null;
  const min = use.length ? Math.min(...use) : null;
  const max = use.length ? Math.max(...use) : null;
  const last = intraday.length ? intraday[intraday.length - 1].v : null;
  const mergedSource: Source =
    prevDaily && prevDaily.source !== source && prevDaily.samples > 0 ? 'mixed' : source;
  return {
    mean: clampValid(mean as number),
    min: clampValid(min as number),
    max: clampValid(max as number),
    last: clampValid(last as number),
    samples: intraday.length,
    source: mergedSource,
    updatedAt: Date.now(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HealthStore
// ───────────────────────────────────────────────────────────────────────────
export class HealthStore {
  private stores: Record<MetricKey, MetricStore> = {} as Record<MetricKey, MetricStore>;
  private sleep: Record<string, SleepSummary> = {};
  private glance: Record<string, HealthGlanceDay> = {}; // dayKey -> 各子指标末值
  private lastUpdated: Record<string, number> = {};     // metricKey or 'sleep'/'glance:<sub>' -> ts
  syncEnabled = true;
  userProfile: { weight: number; height: number; age: number; sex: number } | null = null;

  constructor() {
    for (const k of ALL_METRIC_KEYS) this.stores[k] = emptyStore();
  }

  private safeStore(key: MetricKey): MetricStore | null {
    return this.stores[key] ?? null;
  }

  // ── 写入：实时（今日） ───────────────────────────────────────────────────
  upsertRealtime(key: MetricKey, point: TimePoint, ts = Date.now()): void {
    const dk = dayKey(ts);
    const store = this.safeStore(key);
    if (!store) return;
    const arr = store.intraday[dk] ? [...store.intraday[dk], point] : [point];
    arr.sort((a, b) => a.t - b.t);
    store.intraday[dk] = arr;
    store.daily[dk] = recomputeDaily(arr, store.daily[dk], 'realtime');
    this.lastUpdated[key] = ts;
  }

  // ── 写入：backfill 逐样本（历史日曲线） ──────────────────────────────────
  upsertBackfillSamples(key: MetricKey, dayKeyRaw: string, samples: TimePoint[]): void {
    const store = this.safeStore(key);
    if (!store) return;
    const dk = normalizeDayKey(dayKeyRaw);
    if (dk === dayKeyRaw && Number.isNaN(parseDayKey(dk))) return; // 非法 key 丢弃
    if (!samples || samples.length === 0) return;
    store.intraday[dk] = mergeIntraday(store.intraday[dk], samples);
    const prev = store.daily[dk];
    // backfill 仅在样本更多/或尚无日值时覆盖；不抹掉实时已算的当日均值
    if (!prev || prev.samples === 0 || samples.length >= prev.samples) {
      store.daily[dk] = recomputeDaily(store.intraday[dk], prev, 'backfill');
    }
    this.lastUpdated[key] = Date.now();
  }

  // ── 写入：backfill 日均值（历史日只有均值、无逐样本时） ──────────────────
  upsertBackfillDay(key: MetricKey, dayKeyRaw: string, value: number): void {
    const store = this.safeStore(key);
    if (!store) return;
    const dk = normalizeDayKey(dayKeyRaw);
    if (Number.isNaN(parseDayKey(dk))) return;
    const v = clampValid(value);
    if (v == null) return;
    const prev = store.daily[dk];
    if (!prev || prev.samples === 0) {
      store.daily[dk] = {
        mean: v, min: v, max: v, last: v, samples: 1,
        source: 'backfill', updatedAt: Date.now(),
      };
    } else if (prev.source !== 'backfill' && prev.mean == null) {
      store.daily[dk] = { ...prev, mean: v, min: v, max: v, source: 'mixed', updatedAt: Date.now() };
    }
    this.lastUpdated[key] = Date.now();
  }

  // ── 写入：手动测量 ───────────────────────────────────────────────────────
  upsertManual(key: MetricKey, dayKeyRaw: string, value: number, ts = Date.now(), source?: string): void {
    const store = this.safeStore(key);
    if (!store) return;
    const dk = normalizeDayKey(dayKeyRaw);
    if (Number.isNaN(parseDayKey(dk))) return;
    const v = clampValid(value);
    if (v == null) return;
    const prev = store.daily[dk];
    store.daily[dk] = {
      mean: v, min: v, max: v, last: v, samples: prev?.samples ?? 1,
      source: prev && prev.samples > 0 ? 'mixed' : 'manual', updatedAt: Date.now(),
    };
    if (!store.manualMeasurements) store.manualMeasurements = [];
    const arr = store.manualMeasurements;
    let replaced = false;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (Math.abs(arr[i].t - ts) < 60_000) { arr[i] = { t: ts, v, source }; replaced = true; break; }
    }
    if (!replaced) arr.push({ t: ts, v, source });
    if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    arr.sort((a, b) => a.t - b.t);
    this.lastUpdated[key] = ts;
  }

  getManualMeasurements(key: MetricKey): ManualMeasurement[] {
    const store = this.stores[key];
    if (!store?.manualMeasurements) return [];
    return [...store.manualMeasurements].sort((a, b) => b.t - a.t);
  }

  // ── 睡眠（结构化） ───────────────────────────────────────────────────────
  recordSleep(dayKeyRaw: string, summary: SleepSummary): void {
    const dk = normalizeDayKey(dayKeyRaw);
    if (Number.isNaN(parseDayKey(dk))) return;
    this.sleep[dk] = summary;
    this.lastUpdated['sleep'] = Date.now();
  }
  getSleep(dayKeyRaw: string): SleepSummary | null {
    const dk = normalizeDayKey(dayKeyRaw);
    return this.sleep[dk] ?? null;
  }

  // ── 健康一览（复合指标末值，按日） ───────────────────────────────────────
  setGlance(dayKeyRaw: string, sub: string, value: number, ts = Date.now()): void {
    const dk = normalizeDayKey(dayKeyRaw);
    if (Number.isNaN(parseDayKey(dk))) return;
    if (!this.glance[dk]) this.glance[dk] = {};
    this.glance[dk][sub] = value;
    this.lastUpdated[`glance:${sub}`] = ts;
  }
  getGlance(dayKeyRaw: string): HealthGlanceDay | null {
    const dk = normalizeDayKey(dayKeyRaw);
    return this.glance[dk] ?? null;
  }

  // ── 读取 API（离线读取统一出口） ─────────────────────────────────────────
  getDay(key: MetricKey, dayKeyRaw: string): DayMetric | null {
    const store = this.safeStore(key);
    if (!store) return null;
    const dk = normalizeDayKey(dayKeyRaw);
    return store.daily[dk] ?? null;
  }
  getIntraday(key: MetricKey, dayKeyRaw: string): TimePoint[] {
    const store = this.safeStore(key);
    if (!store) return [];
    const dk = normalizeDayKey(dayKeyRaw);
    return store.intraday[dk] ?? [];
  }
  /** 区间趋势：返回 [fromDay..toDay]（含端点，按日）的日均值数组。 */
  getSeries(key: MetricKey, fromDayRaw: string, toDayRaw: string): (number | null)[] {
    const store = this.safeStore(key);
    if (!store) return [];
    const from = dayStartMs(parseDayKey(fromDayRaw));
    const to = dayStartMs(parseDayKey(toDayRaw));
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return [];
    const out: (number | null)[] = [];
    for (let t = from; t <= to; t += 86400000) {
      const dk = dayKey(t);
      out.push(store.daily[dk]?.mean ?? null);
    }
    return out;
  }
  /**
   * 连续时间序列：跨天收集 [fromTs, toTs] 内的逐样本点（按 t 升序）。
   * 这是「按时间展示现在+历史」的统一出口——今日实时 intraday 与历史回填 intraday
   * 都进同一个数组，按绝对 ms 排序，天然拼接成一条时间轴。
   *  - fillDailyMean: 对「仅有日均值、无逐样本」的日子补一个正午点，使曲线连贯（仍诚实标注缺口）。
   *  - maxPoints: 点数过多（如今日 1Hz HR）时下采样，避免绘图过密。
   */
  getTimeRange(
    key: MetricKey,
    fromTs: number,
    toTs: number,
    opts?: { fillDailyMean?: boolean; maxPoints?: number },
  ): TimePoint[] {
    const store = this.safeStore(key);
    if (!store) return [];
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs < fromTs) return [];
    const out: TimePoint[] = [];
    const fromDk = dayKey(fromTs);
    const toDk = dayKey(toTs);
    const start = parseDayKey(fromDk);
    const end = parseDayKey(toDk);
    if (Number.isNaN(start) || Number.isNaN(end)) return [];
    let cur = start;
    while (cur <= end) {
      const dk = dayKey(cur);
      const arr = store.intraday[dk];
      if (arr && arr.length) {
        for (const p of arr) if (p.t >= fromTs && p.t <= toTs) out.push(p);
      } else if (opts?.fillDailyMean) {
        const d = store.daily[dk];
        if (d && d.mean != null) out.push({ t: cur + 12 * 3600000, v: d.mean });
      }
      cur += 86400000;
    }
    out.sort((a, b) => a.t - b.t);
    const max = opts?.maxPoints ?? 420;
    if (out.length > max) {
      const stride = Math.ceil(out.length / max);
      const sampled: TimePoint[] = [];
      for (let i = 0; i < out.length; i += stride) sampled.push(out[i]);
      const lastP = out[out.length - 1];
      if (sampled[sampled.length - 1] !== lastP) sampled.push(lastP);
      return sampled;
    }
    return out;
  }

  getLatest(key: MetricKey, nDays = 1): number | null {
    const store = this.safeStore(key);
    if (!store) return null;
    const today = dayStartMs(Date.now());
    for (let i = 0; i < nDays; i++) {
      const dk = dayKey(today - i * 86400000);
      const v = store.daily[dk]?.last ?? store.daily[dk]?.mean;
      if (v != null) return v;
    }
    return null;
  }
  getLastUpdated(key: string): number | undefined {
    return this.lastUpdated[key];
  }
  allDayKeys(): string[] {
    const set = new Set<string>();
    for (const k of ALL_METRIC_KEYS) {
      for (const dk of Object.keys(this.stores[k].daily)) set.add(dk);
      for (const dk of Object.keys(this.stores[k].intraday)) set.add(dk);
    }
    for (const dk of Object.keys(this.sleep)) set.add(dk);
    for (const dk of Object.keys(this.glance)) set.add(dk);
    return Array.from(set).sort();
  }

  sleepDayCount(): number {
    return Object.keys(this.sleep).length;
  }
  glanceDayCount(): number {
    return Object.keys(this.glance).length;
  }

  /** 诊断：每个指标最后更新时间 / 来源 / 样本数 / 天数，直接回答「数据到底存了没、更新了没」。 */
  diagnostics(): {
    key: string;
    lastUpdated?: number;
    source?: string;
    samples: number;
    days: number;
  }[] {
    return ALL_METRIC_KEYS.map((k) => {
      const store = this.stores[k];
      let last = this.lastUpdated[k];
      let source: string | undefined;
      let maxSamples = 0;
      for (const dk of Object.keys(store.daily)) {
        const d = store.daily[dk];
        if (d.samples > maxSamples) {
          maxSamples = d.samples;
          source = d.source;
        }
      }
      return { key: k, lastUpdated: last, source, samples: maxSamples, days: Object.keys(store.daily).length };
    });
  }

  /**
   * 一键体检：每个指标「是否还在更新」。直接回答用户「查每个数据是否更新」。
   * 依据各指标的协议采集节奏给出「正常更新」窗口：佩戴实时类 2 天、夜间/手动/健康一览类 7 天。
   * status: 'never'(从未有数据) | 'fresh'(窗口内，正常) | 'stale'(超窗口，疑似停更)
   */
  freshnessReport(now: number = Date.now()): {
    key: string;
    label: string;
    cadence: string;
    status: 'never' | 'fresh' | 'stale';
    lastUpdated?: number;
    ageMinutes?: number;
    days: number;
    samples: number;
    note: string;
  }[] {
    const CADENCE: Record<string, { label: string; cadence: string; windowMs: number; note: string }> = {
      hr:        { label: '心率 HR',         cadence: '佩戴实时(~1Hz)，历史每5/10分钟一点', windowMs: 2 * 864e5, note: '需开启心率自动检测' },
      hrv:       { label: 'HRV',             cadence: '设备库每分钟一点，连上回填',          windowMs: 2 * 864e5, note: '需开启 HRV 自动检测' },
      spo2:      { label: '血氧 SpO₂',       cadence: '自动检测每分钟；手动按需',            windowMs: 2 * 864e5, note: '需开启血氧自动检测' },
      temp:      { label: '体温 Temp',       cadence: '自动每5分钟；手动按需',               windowMs: 2 * 864e5, note: '需开启体温自动检测' },
      eda:       { label: '皮电 EDA',        cadence: '实时（佩戴时）',                      windowMs: 2 * 864e5, note: '仅实时，无离线回填' },
      rr:        { label: '呼吸率 RR',       cadence: '随 ECG 测量',                         windowMs: 7 * 864e5, note: '需做过 ECG' },
      steps:     { label: '步数 Steps',      cadence: '日总量+实时累计',                     windowMs: 2 * 864e5, note: '' },
      distance:  { label: '距离 Distance',   cadence: '随步数',                              windowMs: 2 * 864e5, note: '' },
      calorie:   { label: '卡路里 Calorie',  cadence: '随步数',                              windowMs: 2 * 864e5, note: '' },
      stress:    { label: '压力 Stress',     cadence: '每5/10分钟（原始数据桶；亦含健康一览）', windowMs: 2 * 864e5, note: 'VPDataBaseOperation.h 原始数据示例含 stress 字段' },
      fatigue:   { label: '疲劳度 Fatigue',   cadence: '健康一览(healthGlance)快照；App 尝试读原始数据桶(固件未必写)', windowMs: 7 * 864e5, note: '协议 .h 原始数据示例未列 fatigue，真源为 healthGlance/微体检/ECG' },
      sns:       { label: '交感 SNS',        cadence: '健康一览 snsActivation + GSR 派生（非原始数据桶字段）', windowMs: 7 * 864e5, note: '协议 .h 原始数据示例无 sns；App 仅“顺便”读 slot[@"sns"]，真源为 healthGlance/GSR' },
      met:       { label: '梅脱 MET',        cadence: '每5/10分钟（原始数据桶，协议确认）', windowMs: 2 * 864e5, note: 'VPDataBaseOperation.h 原始数据示例含 met 字段' },
      bpSys:     { label: '血压·收缩 BP',    cadence: '手动测量/每小时原始点',              windowMs: 7 * 864e5, note: '手动为主，已加 best-effort 回填' },
      bpDia:     { label: '血压·舒张 BP',    cadence: '手动测量/每小时原始点',              windowMs: 7 * 864e5, note: '手动为主，已加 best-effort 回填' },
      glucose:   { label: '血糖 Glucose',    cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
      lipid:     { label: '血脂 Lipid',      cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
      ua:        { label: '尿酸 UA',         cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
      skin:      { label: '皮肤 Skin',       cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
      emotion:   { label: '情绪 Emotion',    cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
      cortisol:  { label: '皮质醇 Cortisol', cadence: '健康一览复合测量',                    windowMs: 7 * 864e5, note: '需做健康一览' },
    };
    return ALL_METRIC_KEYS.map((k) => {
      const info = CADENCE[k] ?? { label: k, cadence: '未知', windowMs: 7 * 864e5, note: '' };
      const store = this.stores[k];
      const days = Object.keys(store.daily).length;
      let maxSamples = 0;
      for (const dk of Object.keys(store.daily)) {
        const s = store.daily[dk].samples;
        if (s > maxSamples) maxSamples = s;
      }
      const last = this.lastUpdated[k];
      if (!last || days === 0) {
        return { key: k, label: info.label, cadence: info.cadence, status: 'never', days, samples: 0, note: info.note || '从未有数据' };
      }
      const age = now - last;
      const status: 'fresh' | 'stale' = age <= info.windowMs ? 'fresh' : 'stale';
      return {
        key: k,
        label: info.label,
        cadence: info.cadence,
        status,
        lastUpdated: last,
        ageMinutes: Math.round(age / 60000),
        days,
        samples: maxSamples,
        note: info.note,
      };
    });
  }

  // ── 持久化 + 迁移 ────────────────────────────────────────────────────────
  serialize(): string {
    return JSON.stringify({
      schema: SCHEMA_VERSION,
      syncEnabled: this.syncEnabled,
      userProfile: this.userProfile,
      stores: this.stores,
      sleep: this.sleep,
      glance: this.glance,
      lastUpdated: this.lastUpdated,
    });
  }

  /** 用 v2 结构直接载入（清掉旧状态）。 */
  loadV2(json: any): void {
    if (!json || json.schema !== SCHEMA_VERSION) return;
    for (const k of ALL_METRIC_KEYS) {
      this.stores[k] = json.stores?.[k] ?? emptyStore();
    }
    this.sleep = json.sleep ?? {};
    this.glance = json.glance ?? {};
    this.lastUpdated = json.lastUpdated ?? {};
    if (typeof json.syncEnabled === 'boolean') this.syncEnabled = json.syncEnabled;
    if (json.userProfile) this.userProfile = json.userProfile;
  }

  /** 从旧 v1 快照（RingState 的 *Daily/seriesByDay/extDaily/ecgDaily）迁移。 */
  migrateFromV1(snap: any): void {
    if (!snap || typeof snap !== 'object') return;
    const moveDaily = (src: Record<string, any> | undefined, key: MetricKey) => {
      if (!src) return;
      for (const rawK of Object.keys(src)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue; // 丢弃 NaN-* 等非法 key
        const v = clampValid(Number(src[rawK]));
        if (v == null) continue;
        const store = this.stores[key];
        store.daily[dk] = {
          mean: v, min: v, max: v, last: v, samples: 1, source: 'backfill', updatedAt: Date.now(),
        };
      }
    };
    const moveSeries = (src: Record<string, any> | undefined, key: MetricKey) => {
      if (!src) return;
      for (const rawK of Object.keys(src)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue;
        const arr = Array.isArray(src[rawK]) ? src[rawK] : [];
        const pts: TimePoint[] = arr
          .map((p: any) => ({ t: Number(p?.t), v: Number(p?.v) }))
          .filter((p: TimePoint) => Number.isFinite(p.t) && Number.isFinite(p.v));
        if (pts.length) {
          this.stores[key].intraday[dk] = mergeIntraday(this.stores[key].intraday[dk], pts);
        }
      }
    };

    moveDaily(snap.hrDaily, 'hr');
    moveSeries(snap.seriesByDay?.hr, 'hr');
    moveDaily(snap.hrvDaily, 'hrv');
    moveSeries(snap.seriesByDay?.hrv, 'hrv');
    moveDaily(snap.spo2Daily, 'spo2');
    moveSeries(snap.seriesByDay?.spo2, 'spo2');
    moveDaily(snap.tempDaily, 'temp');
    moveSeries(snap.seriesByDay?.temp, 'temp');
    moveDaily(snap.edaDaily, 'eda');
    moveDaily(snap.rrDaily, 'rr');
    moveDaily(snap.stepDaily ? objMap(snap.stepDaily, (v) => v?.steps) : undefined, 'steps');
    moveDaily(snap.stepDaily ? objMap(snap.stepDaily, (v) => v?.distance) : undefined, 'distance');
    moveDaily(snap.stepDaily ? objMap(snap.stepDaily, (v) => v?.calorie) : undefined, 'calorie');
    moveSeries(snap.seriesByDay?.stress, 'stress');
    moveSeries(snap.seriesByDay?.fatigue, 'fatigue');
    moveSeries(snap.seriesByDay?.snsActivation, 'sns');
    moveSeries(snap.seriesByDay?.met, 'met');
    moveDaily(snap.seriesByDay?.bpSys, 'bpSys');
    moveDaily(snap.seriesByDay?.bpDia, 'bpDia');

    if (snap.sleepDaily) {
      for (const rawK of Object.keys(snap.sleepDaily)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue;
        const s = snap.sleepDaily[rawK];
        this.sleep[dk] = {
          total: Number(s.total) || 0, deep: Number(s.deep) || 0,
          light: Number(s.light) || 0, rem: Number(s.rem) || 0,
          score: Number(s.score) || 0, getUp: Number(s.getUp) || 0,
        };
      }
    }
    if (snap.extDaily) {
      for (const rawK of Object.keys(snap.extDaily)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue;
        const day = snap.extDaily[rawK];
        if (!this.glance[dk]) this.glance[dk] = {};
        for (const sub of Object.keys(day)) {
          const v = clampValid(Number(day[sub]));
          if (v != null) this.glance[dk][sub] = v;
        }
      }
    }
    if (typeof snap.syncEnabled === 'boolean') this.syncEnabled = snap.syncEnabled;
    if (snap.userProfile) this.userProfile = snap.userProfile;
  }

  clear(): void {
    for (const k of ALL_METRIC_KEYS) this.stores[k] = emptyStore();
    this.sleep = {};
    this.glance = {};
    this.lastUpdated = {};
  }
}

function objMap(obj: Record<string, any>, fn: (v: any) => any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) out[k] = fn(obj[k]);
  return out;
}

export const healthStore = new HealthStore();
export default healthStore;
