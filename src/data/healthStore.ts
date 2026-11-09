/**
 * healthStore.ts —— Luna Mira 唯一健康数据源（历史存储 + 离线读取统一层）
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

// 睡眠评分唯一实现（同样纯 TS、零依赖；此处用于「载入时按当前公式重算评分」）
import { computeSleepScore } from '../lib/sleepScore';

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
  | 'bpSys' | 'bpDia' | 'ppgSys' | 'ppgDia' | 'glucose' | 'lipid' | 'ua' | 'skin' | 'emotion' | 'cortisol'
  | 'triglyceride' | 'hdl' | 'ldl' | 'cholesterol'
  // ★ 2026-10-16：协议补齐——血糖测量类型/风险等级（1/2/3 低中高）、抑郁风险（[0,2]）
  | 'glucoseType' | 'glucoseLevel' | 'depressionRisk'
  // ★ 2026-10-16：皮肤温度（orgTemperature 原始体温读数），与体温（temp）区分做双 tab
  | 'skinTemp'
  // ★ 2026-11-06（用户：基础版无血压/血糖传感器，需手动自测记录 + 趋势）：
  //   手动自测指标走独立 key，与戒指原生 bp/glucose（proOnly）及 LEGACY_HISTORY_BLOCKED_KEYS
  //   完全解耦，基础版亦可记录与展示，且不会被旧戒指数据隔离误伤。
  | 'manualBpSys' | 'manualBpDia' | 'manualGlucose';

export const ALL_METRIC_KEYS: MetricKey[] = [
  'hr', 'hrv', 'spo2', 'temp', 'skinTemp', 'eda', 'rr',
  'steps', 'distance', 'calorie',
  'stress', 'fatigue', 'sns', 'met',
  'bpSys', 'bpDia', 'ppgSys', 'ppgDia', 'glucose', 'lipid', 'ua', 'skin', 'emotion', 'cortisol',
  'triglyceride', 'hdl', 'ldl', 'cholesterol',
  'glucoseType', 'glucoseLevel', 'depressionRisk',
  'manualBpSys', 'manualBpDia', 'manualGlucose',
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
  /**
   * ★ 2026-10-10：**推算日标记** dayKey → 1。
   * `lib/offlineEstimates.ts` 会把「当日实测 stress」线性映射成历史日的
   * cortisol / eda / sns / emotion / skin / fatigue intraday。这些值与实测值
   * **混在同一个 intraday 桶里、无法从数值区分**，所以必须在这里留一个来源标记，
   * UI 才能诚实地区分「实测」与「由压力换算」。
   * 快照恢复走 `this.stores[k] = incoming` 整体替换，本字段自动随快照持久化。
   */
  derivedDays?: Record<string, 1>;
}

export interface SleepSummary {
  total: number;
  deep: number;
  light: number;
  rem: number;
  awake?: number;
  insomnia?: number;
  /** 睡眠评分 0-100（自算，computeSleepScore 产出） */
  score: number;
  /** 原生 SDK sleepQuality 原始值 0-5（调试用） */
  sdkScore?: number;
  getUp: number;
  /** 入睡时间 "HH:mm" (原生 sleepTime) */
  sleepTime?: string | null;
  /** 起床时间 "HH:mm" (原生 wakeTime) */
  wakeTime?: string | null;
  /** 入睡小时 0-23（从 sleepTime 解析，用于 sleepWindow 计算） */
  bedHour?: number | null;
  /** 起床小时 0-23（从 wakeTime 解析，用于 sleepWindow 计算） */
  wakeHour?: number | null;
}

export interface HealthGlanceDay {
  [sub: string]: number; // pressure/fatigue/sns/met/glucose/lipid/ua/skin/emotion/cortisol...
}

const SCHEMA_VERSION = 2;

/** 计算型指标按天存的精简快照（历史回溯用，不要存太大）。 */
export interface AnalysisSnapshot {
  stress?: {
    score: number | null;
    peakHour: number | null;
    emotionalLoad: number | null;
    avgRecoverySec: number | null;
    eventCount: number;
  };
  cognitive?: {
    loadScore: number;
    avgFatigue: number | null;
    fatigueIndex: number;
    peakHour: number | null;
    bestHour: number | null;
    recoveryCapacity: number | null;
  };
  cortisol?: {
    mesor: number;
    amplitude: number;
    acrophaseH: number;
    css: number;
    status: 'normal' | 'sustained_high' | 'dysregulated';
    sustainedHighStreak: number;
  };
  /**
   * ★ 2026-10-10（用户：「洞察页身体年龄最好一天最多有一次变化，不能老变」）：
   * 当日**冻结**的身体年龄快照。当天算出一次后即钉死，全天复用，
   * 不管实时数据怎么抖，卡片数字都不跳；跨天自动重算。
   * 存在这里（而非内存变量）是为了**重启 App 后当天仍是同一个值**。
   */
  healthAge?: {
    /** 身体年龄（岁） */
    healthAge: number;
    /** 当时的实际年龄（岁），用于回看口径 */
    actualAge: number | null;
    /** 差值（岁）：负 = 比实际年龄年轻 */
    delta: number | null;
    /** 冻结时的健康综合分（0–100），弧长与它绑定，一起冻结才不会跳 */
    overallScore: number | null;
    /** 冻结时间戳 */
    frozenAt: number;
  };
  /**
   * ★ 2026-10-13（用户：「为啥不是像 Oura/WHOOP 醒来就定了？因为睡眠时间已经定了啊」）：
   * 睡眠恢复分的**定稿快照**。这一觉的窗口一关（过了当天 wakeTime、且分期数据已到账）
   * 即冻结，当天后续 BLE 同步再补写睡眠明细也不翻动 —— Oura/WHOOP「醒来即定稿」同一心智。
   * 持久化在此（而非内存变量）⇒ 重启 App 后当天仍是同一个值。
   */
  sleepRecovery?: {
    score: number | null;
    mode: 'relative' | 'absolute';
    baselineDays: number;
    daysToReady: number;
    regularity: { score: number | null; midSdMin: number | null; wakeSdMin: number | null; bedSdMin: number | null; days: number };
    sourceDayKey: string | null;
    physiologyCoverage: number;
    frozenAt: number;
  };
  emotion?: {
    label: string;
    valence: number | null;
    arousal: number | null;
  };
  hormone?: {
    estrogen: string;
    progesterone: string;
    tsh: string;
    hrvTrend: string;
  };
  sleepLoad?: {
    load: number;
    level: string;
    debtH: number;
    windowDays: number;
  };
  updatedAt: number;
}
const MERGE_MS = 60 * 1000; // 同一天内时间差 < 1min 的样本视为同一时刻，取后写

function emptyStore(): MetricStore {
  return { daily: {}, intraday: {}, manualMeasurements: [] };
}

function clampValid(v: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 合并 intraday 样本。
 *
 * ★ v18.134（审查 04 🟡-4）：修复「邻域匹配连锁覆盖」丢样本。
 *   旧实现：遍历 map.keys() 找到**第一个** ±MERGE_MS 内的 key 就 `map.set(k, p)` ——
 *   ① 复用旧 key（map.key 与 value.t 不一致），后续点邻域判断基准错位；
 *   ② 同一个旧 key 会被后续多个 incoming 点反复命中 → 3 个样本连锁合并成 1 个（Node 可复现：
 *      prev=[{t:995}] + incoming=[{t:1000},{t:1010},{t:1020}] → 只剩 1 个点）；
 *   ③ 只取「第一个」匹配而非「最近」匹配，结果依赖插入顺序。
 *   新实现：同刻判定统一为「±MERGE_MS 内取最近」；命中后先删旧 key、按新 t 写入
 *   （key 与 value.t 始终一致）；incoming 内部先按 t 去重。
 */
function mergeIntraday(prev: TimePoint[] | undefined, incoming: TimePoint[]): TimePoint[] {
  const base = prev && prev.length ? prev : [];
  if (base.length === 0) {
    // 无既有数据：按 t 去重后直接返回（同一批内不互相覆盖）
    const m0 = new Map<number, TimePoint>();
    for (const p of incoming) {
      if (Number.isFinite(p?.t) && Number.isFinite(p?.v)) m0.set(p.t, p);
    }
    return Array.from(m0.values()).sort((a, b) => a.t - b.t);
  }
  const map = new Map<number, TimePoint>();
  for (const p of base) map.set(p.t, p);
  for (const p of incoming) {
    if (!Number.isFinite(p?.t) || !Number.isFinite(p?.v)) continue;
    // 找**最近**的同刻点（而非第一个命中）
    let hitT: number | null = null;
    let bestDiff = Infinity;
    for (const k of map.keys()) {
      const diff = Math.abs(k - p.t);
      if (diff <= MERGE_MS && diff < bestDiff) { bestDiff = diff; hitT = k; }
    }
    if (hitT != null) map.delete(hitT); // ★ 先删旧 key，保证 key 与 value.t 一致
    map.set(p.t, p);                    // ★ 按新时间戳写入
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

function mergeRealtime(prev: TimePoint[] | undefined, incoming: TimePoint): TimePoint[] {
  const map = new Map<number, TimePoint>();
  for (const point of prev ?? []) map.set(point.t, point);
  map.set(incoming.t, incoming);
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

/**
 * ★ 带符号指标：值域本身含负数，0/负数是有效测量值（不是原生 SDK 占位符）。
 *   - emotion：戒指原生情绪等级 [-10, 10]，负值=消极/低落，必须保留；否则情绪点阵与
 *     日均值只会看到「开心/兴奋」，丢光压力/难过（见 2026-10-12 修复）。
 */
export const SIGNED_METRICS = new Set<string>(['emotion']);

/**
 * ★ 2026-11-06 审查（docs/audit/04 🔴-3）：**零值有效**指标 —— 0 是合法档位，不是「无测量」占位符。
 *   原生 VeepooRing.m:1658 / :1710 对 depressionRisk 的判定是 `>= 0`（而非其余指标的 `> 0`），
 *   协议侧明确认为 0 = 「抑郁风险正常」是有效读数。
 *   但旧实现一律用 `v > 0` 过滤、RingBleManager 的 extract() 也用 `v <= 0` 丢弃，
 *   导致「抑郁风险 = 0（正常）」这一最常见读数在数据层被完整丢弃 → 指标卡恒空。
 *
 *   语义区分（务必分清）：
 *   - SIGNED_METRICS：值域含**负数**（emotion -10~10）
 *   - ZERO_VALID_METRICS：值域是**离散档位且 0 合法**（depressionRisk 0/1/2）
 */
export const ZERO_VALID_METRICS = new Set<string>(['depressionRisk']);

function recomputeDaily(
  intraday: TimePoint[],
  prevDaily: DayMetric | undefined,
  source: Source,
  key?: string,
): DayMetric {
  // ★ 生理指标 0/负数=原生 SDK 占位符（无测量）；
  //   emotion（带符号）与 depressionRisk（零值有效档位）例外。
  const signed = key ? SIGNED_METRICS.has(key) : false;
  const zeroValid = key ? ZERO_VALID_METRICS.has(key) : false;
  const clean = intraday.filter((p) => Number.isFinite(p.v) && (signed || zeroValid || p.v > 0));
  const vals = clean.map((p) => p.v);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const last = clean.length ? clean[clean.length - 1].v : null;
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
export type HealthStoreListener = () => void;


/** 第三步: 用户认知标注 (训练个性化分类器的壁垒数据) */
export interface CognitiveLabel {
  /** 标注时间戳 */
  t?: number;
  /** 关联的日期 key */
  dateKey: string;
  /** 标注类型: 负荷事件反馈 / 日常回顾 */
  type: 'event_feedback' | 'daily_review';
  /** 主观认知类型: 烧脑(高负荷) vs 心累(情绪) vs 平静 */
  cognitiveType: 'burn' | 'emotion' | 'calm';
  /** 主观认知负荷强度 1-5 */
  intensity: 1 | 2 | 3 | 4 | 5;
  /** 任务类型: 开会 / 写代码 / 阅读 / 运动 / 其他 */
  taskType?: string;
  /** 关联的 detector 事件 id (如果是 event_feedback) */
  eventT?: number;
  /** 备注 */
  note?: string;
}

export class HealthStore {
  private stores: Record<MetricKey, MetricStore> = {} as Record<MetricKey, MetricStore>;
  private sleep: Record<string, SleepSummary> = {};
  private glance: Record<string, HealthGlanceDay> = {}; // dayKey -> 各子指标末值
  private lastUpdated: Record<string, number> = {};     // metricKey or 'sleep'/'glance:<sub>' -> ts
  /** V2 incremental sync anchor: last successful backfill date (YYYY-MM-DD).
   *  JS computes delta = lastSyncDate -> today. null = never synced (fallback full 30d). */
  private lastSyncDate: string | null = null;

  /** 计算型指标缓存：dayKey -> { stress?, cognitive?, cortisol?, emotion? } */
  private analysis: Record<string, Partial<AnalysisSnapshot>> = {};
  /** 第三步: 用户认知标注 (ring buffer, 最多 500 条, 训练个性化分类器的壁垒数据) */
  private labels: CognitiveLabel[] = [];
  syncEnabled = true;
  userProfile: { weight: number; height: number; age: number; sex: number } | null = null;

  private listeners = new Set<HealthStoreListener>();
  private notifyScheduled = false;
  private version = 0;

  constructor() {
    for (const k of ALL_METRIC_KEYS) this.stores[k] = emptyStore();
    this.analysis = {};
  }

  /** 内部版本号，每次数据写入后递增；供 useSyncExternalStore 做稳定快照。 */
  getVersion(): number {
    return this.version;
  }

  /** 轻量订阅：数据写入后通知监听者（组件/Router/Manager），让详情页无需切 Tab 即可刷新。 */
  subscribe(listener: HealthStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.version += 1;
      for (const fn of this.listeners) {
        try {
          fn();
        } catch (e) {
          // 单个监听者抛错不能打断其他监听者
          console.warn('[HealthStore] listener error:', e);
        }
      }
    });
  }

  private safeStore(key: MetricKey): MetricStore | null {
    return this.stores[key] ?? null;
  }

  // ── 写入：实时（今日） ───────────────────────────────────────────────────
  upsertRealtime(key: MetricKey, point: TimePoint, ts = Date.now()): void {
    const dk = dayKey(ts);
    const store = this.safeStore(key);
    if (!store) return;
    const arr = mergeRealtime(store.intraday[dk], point);
    store.intraday[dk] = arr;
    store.daily[dk] = recomputeDaily(arr, store.daily[dk], 'realtime', key);
    this.lastUpdated[key] = ts;
    this.notify();
  }

  // ── 写入：backfill 逐样本（历史日曲线） ──────────────────────────────────
  upsertBackfillSamples(key: MetricKey, dayKeyRaw: string, samples: TimePoint[], opts?: { derived?: boolean }): void {
    const store = this.safeStore(key);
    if (!store) return;
    const dk = normalizeDayKey(dayKeyRaw);
    if (dk === dayKeyRaw && Number.isNaN(parseDayKey(dk))) return; // 非法 key 丢弃
    if (!samples || samples.length === 0) return;
    // ★ v18.134（审查 04 🟡-4）：过滤非法值，杜绝 NaN 进入 intraday（会污染日聚合与 SVG 坐标）
    const valid = samples.filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v));
    if (valid.length === 0) return;
    // ★ 实时真值优先：该日已有 realtime/mixed 来源的样本时，backfill 不覆盖同刻（±MERGE_MS）样本，
    //   避免「实时刚测的真值被历史精度值回写覆盖」且两条通路覆盖顺序不同、结果不同。
    const existing = store.intraday[dk] ?? [];
    const dailySrc = store.daily[dk]?.source;
    const hasRealtime = dailySrc === 'realtime' || dailySrc === 'mixed';
    const toWrite = hasRealtime
      ? valid.filter((p) => !existing.some((q) => Math.abs(q.t - p.t) <= MERGE_MS))
      : valid;
    if (toWrite.length === 0) return;
    store.intraday[dk] = mergeIntraday(store.intraday[dk], toWrite);
    // ★ 2026-10-10：标记该日为「由 stress 换算的推算日」（见 MetricStore.derivedDays）。
    //   只增不减 —— 推算过一次就永远是推算，不允许后来被当成实测。
    if (opts?.derived) {
      if (!store.derivedDays) store.derivedDays = {};
      store.derivedDays[dk] = 1;
    }
    const prev = store.daily[dk];
    // 合并后始终从完整明细重算，避免分片长度较小时漏掉回填更新；实时明细会保留并标记 mixed。
    store.daily[dk] = recomputeDaily(store.intraday[dk], prev, 'backfill', key);
    // ★ v18.96：lastUpdated 记「数据本身的时间戳」（取本批样本最新 t），不是 Date.now()。
    //   否则回填 30 天历史也会把 lastUpdated 刷成「现在」，新鲜度判断（freshnessReport、
    //   RingBleManager 的 hrvFreshToday 等）会把历史数据误认为刚采到的。
    const newest = valid.reduce((a, s) => (Number.isFinite(s.t) && s.t > a ? s.t : a), 0);
    if (newest > 0) {
      this.lastUpdated[key] = Math.max(this.lastUpdated[key] ?? 0, Math.min(newest, Date.now()));
    }
    this.notify();
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
    const intraday = store.intraday[dk];
    if (intraday && intraday.length > 0) {
      store.daily[dk] = recomputeDaily(intraday, prev, 'backfill', key);
    } else if (!prev || prev.source === 'backfill') {
      store.daily[dk] = {
        mean: v, min: v, max: v, last: v, samples: 1,
        source: 'backfill', updatedAt: Date.now(),
      };
    } else if (prev.mean == null) {
      store.daily[dk] = { ...prev, mean: v, min: v, max: v, source: 'mixed', updatedAt: Date.now() };
    } else {
      // ★ v18.96（审计 1-7）：已有 realtime 来源的日均 + 回填均值 → 旧实现三个分支全不命中，
      //   回填被静默丢弃（数据永远补不回来）。这里合并进均值，日均取两条来源的平均。
      store.daily[dk] = {
        ...prev,
        mean: (prev.mean + v) / 2,
        min: Math.min(prev.min ?? v, v),
        max: Math.max(prev.max ?? v, v),
        source: 'mixed',
        updatedAt: Date.now(),
      };
    }
    // ★ v18.96：同 upsertBackfillSamples，lastUpdated 用该日归档时刻而非 Date.now()。
    const dayEnd = parseDayKey(dk) + 86400000;
    if (Number.isFinite(dayEnd)) {
      this.lastUpdated[key] = Math.max(this.lastUpdated[key] ?? 0, Math.min(dayEnd, Date.now()));
    } else {
      this.lastUpdated[key] = Date.now();
    }
    this.notify();
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
    this.notify();
  }

  /**
   * ★ 2026-11-06（用户：基础版无血压/血糖传感器，需手动自测记录 + 趋势）：
   *   手动自测样本写入——同时落 intraday（出趋势曲线）、daily（出日均值/最新值）、
   *   manualMeasurements（出手动记录列表）。与戒指原生 bp/glucose 走不同 key（manualBpSys 等），
   *   彻底脱离 proOnly / LEGACY_HISTORY_BLOCKED_KEYS 的机型门禁与旧戒指数据隔离，
   *   基础版（LUNA-MIRA）也能记录与展示。source 固定 'manual'，UI 如实标注「手动记录」。
   */
  upsertManualSample(key: MetricKey, dayKeyRaw: string, value: number, ts = Date.now(), source = 'manual'): void {
    const store = this.safeStore(key);
    if (!store) return;
    const dk = normalizeDayKey(dayKeyRaw);
    if (Number.isNaN(parseDayKey(dk))) return;
    const v = clampValid(value);
    if (v == null) return;
    const point: TimePoint = { t: ts, v };
    store.intraday[dk] = mergeIntraday(store.intraday[dk] ?? [], [point]);
    store.daily[dk] = { ...recomputeDaily(store.intraday[dk], store.daily[dk], 'manual', key), source: 'manual' };
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
    this.notify();
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
    // ★ 自动从 sleepTime/wakeTime 解析 bedHour/wakeHour（如果还没填）
    const v: SleepSummary = { ...summary };
    if ((v.bedHour == null || v.wakeHour == null) && (v.sleepTime || v.wakeTime)) {
      const parse = (s?: string | null): number | null => {
        if (!s) return null;
        const m = String(s).match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        const h = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
        return Number.isFinite(h) && h >= 0 && h <= 24 ? h : null;
      };
      if (v.bedHour == null) v.bedHour = parse(v.sleepTime) ?? null;
      if (v.wakeHour == null) v.wakeHour = parse(v.wakeTime) ?? null;
    }
    this.sleep[dk] = v;
    this.lastUpdated['sleep'] = Date.now();
    this.notify();
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
    this.notify();
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
  /**
   * ★ 2026-11-08（跨天清零策略·唯一今日读取入口）
   * 严格按「今日」取值（当日 YYYY-MM-DD 的日均值）；跨天即归零——新的一天无样本 → null。
   * 每日指标（压力/身心压力/血压/心率/…）在 UI 一律走这里，绝不回退到「最近一次」（getLatest 大窗口）。
   * 长周期/一次性数据（周期 cycle、体检 exam）不存于 healthStore.daily，走各自独立 store，天然不清零。
   */
  getTodayValue(key: MetricKey, now: number = Date.now()): number | null {
    return this.getDay(key, dayKey(now))?.mean ?? null;
  }
  /**
   * 取某日的逐样本序列（按 t 升序）。
   *
   * ★ v18.134（审查 04 🔵-6）：返回**副本**而不是内部数组引用 —— 旧实现返回
   *   store.intraday[dk] 直接引用，调用方一次 sort()/reverse() 就能改坏 store。
   *   同时在此处**显式排序**，把「数组已按 t 升序」从隐式契约变成 API 保证
   *   （NightBpCard 等依赖「最后一个 = 最新一次」）。
   */
  getIntraday(key: MetricKey, dayKeyRaw: string): TimePoint[] {
    const store = this.safeStore(key);
    if (!store) return [];
    const dk = normalizeDayKey(dayKeyRaw);
    const arr = store.intraday[dk];
    if (!arr || arr.length === 0) return [];
    const sorted = arr.every((p, i) => i === 0 || arr[i - 1].t <= p.t)
      ? arr
      : arr.slice().sort((a, b) => a.t - b.t);
    return sorted.slice();
  }
  /**
   * ★ 2026-11-09：读取 lastUpdated 映射副本。
   * 冷启动合并进 RingState.lastUpdated，避免 buildCurveStatus 的 dataStale 误判「从未采到过数据」。
   */
  getLastUpdated(): Record<string, number> {
    return { ...this.lastUpdated };
  }
  /**
   * ★ 2026-10-10：该日的 intraday 是否为「由 stress 线性换算的推算值」。
   * 用于 UI 诚实标注（皮质醇更严格：推算日一律不出曲线，只走空态）。
   */
  isDerivedDay(key: MetricKey, dayKeyRaw: string): boolean {
    const store = this.safeStore(key);
    if (!store?.derivedDays) return false;
    return store.derivedDays[normalizeDayKey(dayKeyRaw)] === 1;
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
    // ★ getTimeRange 诊断已关闭（死循环风暴）
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

  // V2 incremental sync anchor API
  getLastSyncDate(): string | null { return this.lastSyncDate; }

  /** JS calls this after native onState.backfillDone to advance the delta anchor. */
  setLastSyncDate(dateKey: string | null): void {
    const dk = dateKey ? normalizeDayKey(dateKey) : null;
    if (dk && Number.isNaN(parseDayKey(dk))) return;
    if (this.lastSyncDate !== dk) {
      this.lastSyncDate = dk;
      this.notify();
    }
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
      lastSyncDate: this.lastSyncDate,
      stores: this.stores,
      sleep: this.sleep,
      glance: this.glance,
      lastUpdated: this.lastUpdated,
      analysis: this.analysis,
    });
  }

  /** 用 v2 结构直接载入（清掉旧状态）。 */
  loadV2(json: any): void {
    if (!json || json.schema !== SCHEMA_VERSION) return;
    for (const k of ALL_METRIC_KEYS) {
      const incoming = json.stores?.[k];
      // ★ v18.111 破坏性覆盖修复：旧版本写盘时若在回填落盘前就存过一次，
      //   快照里 stores 可能是**空壳**（{daily:{},intraday:{},manualMeasurements:[]}）。
      //   旧实现 `?? emptyStore()` 会把快照里那个空壳当成有效值灌进来，
      //   在内存已有数据时也照样清空 → 重启后 healthStore 全空，
      //   而 legacy 快照（mira_ring_state_v1.json）里当天数据还在 → 两套数据源打架，
      //   intraday 重建拿不到任何窗口，全天状态趋势图 / 皮质醇昼夜节律画不出来。
      // 现在：快照里该指标确实没有任何数据时，**保留内存现状**（不清空）。
      if (incoming) {
        const hasData =
          Object.keys(incoming.daily ?? {}).length > 0 ||
          Object.keys(incoming.intraday ?? {}).length > 0 ||
          (incoming.manualMeasurements?.length ?? 0) > 0 ||
          // ★ v18.134（审查 04 🔵-4）：derivedDays 也要计入判定 —— 漏判会让
          //   「只带推算日标记」的 store 被整体跳过 → derivedDays 丢失 →
          //   推算日被当成实测日展示（违反「诚实标注」铁律）。
          Object.keys(incoming.derivedDays ?? {}).length > 0;
        if (hasData || !this.stores[k]) {
          // ★ v18.134（审查 04 🔵-4）：结构归一 —— 快照可能来自被截断/外部修改的 JSON，
          //   daily/intraday 必须是对象、manualMeasurements 必须是数组，
          //   否则后续 store.daily[dk] 赋值会抛 TypeError。
          this.stores[k] = {
            daily: (incoming.daily && typeof incoming.daily === 'object') ? incoming.daily : {},
            intraday: (incoming.intraday && typeof incoming.intraday === 'object') ? incoming.intraday : {},
            manualMeasurements: Array.isArray(incoming.manualMeasurements) ? incoming.manualMeasurements : [],
            ...(incoming.derivedDays && typeof incoming.derivedDays === 'object'
              ? { derivedDays: incoming.derivedDays as Record<string, 1> }
              : {}),
          };
        }
      } else if (!this.stores[k]) {
        this.stores[k] = emptyStore();
      }
    }
    // ★ 睡眠评分是「由冻结的原始 total/deep/getUp 算出的**派生值**」，必须按**当前公式**重算。
    //   否则快照里按旧公式存下的 score（例如满屏 100）会被原样恢复 → 改了公式却"看不出变化"。
    //   原始测量值（total/deep/light/rem/awake/getUp/sleepTime/wakeTime）原样保留、不受影响。
    this.sleep = this.rebuildSleepFromSnapshot(json.sleep);
    this.glance = json.glance ?? {};
    this.lastUpdated = json.lastUpdated ?? {};
    this.analysis = json.analysis ?? {};
    if (typeof json.syncEnabled === 'boolean') this.syncEnabled = json.syncEnabled;
    if (json.userProfile) this.userProfile = json.userProfile;
    if (typeof json.lastSyncDate === "string") this.lastSyncDate = json.lastSyncDate;
    this.notify();
  }

  /**
   * 睡眠快照归一：**保留全部原始测量字段**（total/deep/light/rem/awake/insomnia/getUp/sleepTime/wakeTime），
   * 只把 `score` 按**当前公式**重算。
   *
   * 为什么必须重算：`score` 是派生值（原始三个量算出来的）。快照里存的是旧公式的结果，
   * 若原样恢复，改了公式也"看不出变化"（实测：老快照里的 100 一直在）。
   * 原始测量值不动 → 不违反"历史冻结"（冻结的是测量，不是派生计算）。
   */
  private rebuildSleepFromSnapshot(raw: any): Record<string, SleepSummary> {
    const out: Record<string, SleepSummary> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const k of Object.keys(raw)) {
      const dk = normalizeDayKey(k);
      if (Number.isNaN(parseDayKey(dk))) continue;
      const s = raw[k];
      if (!s || typeof s !== 'object') continue;
      const total = Number(s.total) || 0;
      const deep = Number(s.deep) || 0;
      const getUp = Number(s.getUp) || 0;
      const awake = Number(s.awake) || 0;
      const insomnia = Number(s.insomnia) || 0;
      out[dk] = {
        total,
        deep,
        light: Number(s.light) || 0,
        rem: Number(s.rem) || 0,
        awake: awake || undefined,
        insomnia: insomnia || undefined,
        score: total > 0 ? computeSleepScore({
          sleepTotal: total, sleepDeep: deep,
          sleepAwake: awake + insomnia > 0 ? awake + insomnia : undefined,
          getUp,
        }) : Number(s.score) || 0,
        sdkScore: Number(s.sdkScore) || undefined,
        getUp,
        sleepTime: (s.sleepTime as string | null) ?? null,
        wakeTime: (s.wakeTime as string | null) ?? null,
      };
    }
    return out;
  }

  /**
   * 从 legacy 快照的 `sleepDaily` 补齐睡眠（**只补缺失/空日，不覆盖已有**）。
   *
   * 背景（实测踩坑）：v2 快照里的 `sleep` 可能为空（历史遗留），而 legacy 快照的 `sleepDaily`
   * 一直有数据；`loadHealthStoreFromDisk` 一旦走 v2 分支就 `return`，**不再执行 v1 迁移**，
   * 于是 `healthStore.sleep` 为空 → 身体恢复页「睡眠恢复摘要」空白，必须等戒指重新回填才出现。
   * 这里在 v2 载入后显式补齐，保证重启即有数据。
   */
  hydrateSleepFromLegacy(rawDaily: any): number {
    const fixed = this.rebuildSleepFromSnapshot(rawDaily);
    let added = 0;
    for (const dk of Object.keys(fixed)) {
      const cur = this.sleep[dk];
      if (!cur || cur.total <= 0) {
        this.sleep[dk] = fixed[dk];
        added++;
      }
    }
    if (added > 0) this.notify();
    return added;
  }

  /** 存某天的计算结果（stress / cognitive / cortisol / emotion）。同一天多次写会覆盖。 */
  saveAnalysis(dateKey: string, type: keyof Omit<AnalysisSnapshot, 'updatedAt'>, data: any): void {
    if (!dateKey || !data) return;
    // ★ 幂等短路：内容与上次一致时，不写、不 notify。
    //   否则形成「自激渲染循环」：compute*(在 render 中调用) → saveAnalysis → notify
    //   → version++ → 订阅者(useHealthStoreVersion / RingBle 调和)重渲染 → 再 compute → …
    //   该循环只靠 notify 的 queueMicrotask 去重，等价于持续重渲染 → 点击/滚动卡顿。
    const prev = (this.analysis[dateKey] as any)?.[type];
    if (prev !== undefined) {
      try {
        if (JSON.stringify(prev) === JSON.stringify(data)) return; // 无变化 → 直接返回
      } catch {
        /* 序列化失败：保守写入（宁可多 notify 也不能丢结果） */
      }
    }
    if (!this.analysis[dateKey]) this.analysis[dateKey] = { updatedAt: Date.now() };
    (this.analysis[dateKey] as any)[type] = data;
    this.analysis[dateKey]!.updatedAt = Date.now();
    this.lastUpdated[`analysis:${type}`] = Date.now();
    this.notify();
  }

  /** 取某天的计算结果快照；不传 dateKey 默认今天。 */
  getAnalysis(dateKey?: string): Partial<AnalysisSnapshot> | null {
    const dk = dateKey ?? dayKey(Date.now());
    return this.analysis[dk] ?? null;
  }

  // ── 第三步: 用户标注数据模型 (训练个性化分类器的壁垒) ──
  // 用户标注: 某个时间段的认知状态自评
  //   - 触发时机: 认知负荷事件后、或每日回顾时
  //   - 用途: 训练个性化分类器 (通用模型 → 她的模型)
  //   - 存储: 按时间戳存, 可与同期 HRV/SNS 数据 join

  /** 认知标注类型 — 用户对某个时段的自评 */
  saveLabel(label: CognitiveLabel): void {
    if (!label.t) label.t = Date.now();

    this.labels.push(label);
    // 只保留最近 500 条 (ring buffer)
    if (this.labels.length > 500) this.labels = this.labels.slice(-500);
    this.lastUpdated['label'] = Date.now();
    this.notify();
  }

  /** 取标注, 可按日期范围过滤 */
  getLabels(fromMs?: number, toMs?: number): CognitiveLabel[] {
    if (!this.labels) return [];
    return this.labels.filter(l =>
      (fromMs == null || (l.t ?? 0) >= fromMs) && (toMs == null || (l.t ?? 0) <= toMs)
    );
  }

  /** 拿历史计算结果（近 N 天），供趋势/回溯用。 */
  getAnalysisHistory(days = 30): { date: string; analysis: Partial<AnalysisSnapshot> }[] {
    const out: { date: string; analysis: Partial<AnalysisSnapshot> }[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dk = dayKey(now - i * 86400000);
      const a = this.analysis[dk];
      if (a) out.push({ date: dk, analysis: a });
    }
    return out;
  }

  /**
   * 取某指标近 N 天的日均值数组（最新在前）。**跳过推算日**。
   *
   * ★ 2026-11-06 审查（docs/audit/02 🟡#3）：给 AI 趋势摘要用的版本。
   *   eda / sns / cortisol / emotion / skin / fatigue 的 daily 里混有
   *   offlineEstimates 的推算日（stress 线性换算）。若不剔除，AI 会把
   *   换算值当实测统计报出（「近 7 天皮电均值 42.3」）。
   */
  getMetricDailyMeansMeasured(metric: MetricKey, days = 7): number[] {
    const store = this.stores[metric];
    if (!store) return [];
    const out: number[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dk = dayKey(now - i * 86400000);
      if (store.derivedDays?.[dk] === 1) continue;   // ★ 跳过推算日
      const d = store.daily?.[dk];
      if (d && d.last != null && !Number.isNaN(d.last)) out.push(d.last);
      else if (d && d.mean != null && !Number.isNaN(d.mean)) out.push(d.mean);
    }
    return out;
  }

  /** 取某指标近 N 天的日均值数组（最新在前，旧的在后）。跳过没数据的日子。 */
  getMetricDailyMeans(metric: MetricKey, days = 7): number[] {
    const store = this.stores[metric];
    if (!store) return [];
    const out: number[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dk = dayKey(now - i * 86400000);
      const d = store.daily?.[dk];
      if (d && d.last != null && !Number.isNaN(d.last)) out.push(d.last);
      else if (d && d.mean != null && !Number.isNaN(d.mean)) out.push(d.mean);
    }
    return out;
  }


  /** 按明确日期读取单日指标，避免最近有数据的一天冒充今天。 */
  getMetricDailyMean(metric: MetricKey, dateKey: string): number | null {
    const d = this.stores[metric]?.daily?.[normalizeDayKey(dateKey)];
    if (!d) return null;
    const v = d.last ?? d.mean;
    return v != null && Number.isFinite(v) ? v : null;
  }

  /**
   * ★ 2026-10-12：取某指标在「该日睡眠时段」内的均值（入睡→起床，可跨午夜）。
   *
   * 为什么需要：睡眠恢复分的生理修正项原先读 `getMetricDailyMean`（= 当天**整日**均值，
   * 含白天走动时累积的 HRV/RHR/体温读数）。于是「今天」的恢复分随白天样本增多而一直漂，
   * 与「早上醒来、这觉睡完、恢复分就该定了」的预期相悖。
   *
   * 这里只取**那一觉夜里的生理**（入睡小时→起床小时，跨午夜时同时取起床日与前一日夜间段），
   * 这觉定下来后夜间读数不再增加 ⇒ 当天恢复分稳定。无 bedHour/wakeHour 或夜间无读数时，
   * 退回整日均值，避免把「没数据」读成 0。
   */
  getSleepWindowMetricMean(
    metric: MetricKey,
    dateKey: string,
    bedHour?: number | null,
    wakeHour?: number | null,
  ): number | null {
    const dk = normalizeDayKey(dateKey);
    if (bedHour == null || wakeHour == null) return this.getMetricDailyMean(metric, dk);
    const prevDk = dayKey(parseDayKey(dk) - 86400000);
    const inWin = (h: number) =>
      bedHour <= wakeHour ? (h >= bedHour && h < wakeHour) : (h >= bedHour || h < wakeHour);
    const vals: number[] = [];
    for (const pd of [dk, prevDk]) {
      for (const p of this.getIntraday(metric, pd)) {
        if (!Number.isFinite(p.v) || p.v <= 0) continue; // 0/负 = 原生占位符
        if (inWin(new Date(p.t).getHours())) vals.push(p.v);
      }
    }
    if (!vals.length) return this.getMetricDailyMean(metric, dk);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Number.isFinite(m) ? m : null;
  }

  /** 从旧 v1 快照（RingState 的 *Daily/seriesByDay/extDaily/ecgDaily）迁移。 */
  migrateFromV1(snap: any): void {
    if (!snap || typeof snap !== 'object') return;
    // ★ 2026-11-06 审查（docs/audit/02 🟡#4）：v1 快照里混着「实测」与「离线推算」两类值。
    //   旧实现统一写 source:'backfill' 且**不打 derivedDays**，等于给推算值做了洗白：
    //   isDerivedDay() 会把它们当成实测日 → measuredOnly 保护失效、
    //   patterns 的实测过滤失效、AI 会标 source:'measured'。
    //   现在：能判定为推算来源的指标一律打 derivedDays 标；
    //   快照里带明确推算标记（derivedDays / derived）的日也打标。
    const DERIVED_ONLY_KEYS = new Set<MetricKey>(['eda', 'sns', 'cortisol', 'emotion', 'skin', 'fatigue']);
    const moveDaily = (src: Record<string, any> | undefined, key: MetricKey) => {
      if (!src) return;
      const store = this.stores[key];
      for (const rawK of Object.keys(src)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue; // 丢弃 NaN-* 等非法 key
        const v = clampValid(Number(src[rawK]));
        if (v == null) continue;
        // ★ 仅补 v2 缺失的历史日，绝不覆盖 v2 已有的当日数据（避免旧快照覆盖新值）
        if (store.daily[dk] && store.daily[dk].samples > 0) continue;
        store.daily[dk] = {
          mean: v, min: v, max: v, last: v, samples: 1, source: 'backfill', updatedAt: Date.now(),
        };
        // ★ 打推算标：v1 里这些指标本就只有推算来源，或快照自带 derived 标记。
        const rawMarked = (snap.derivedDays && snap.derivedDays[rawK]) || (snap.derived && snap.derived[rawK]);
        if (rawMarked || DERIVED_ONLY_KEYS.has(key)) {
          if (!store.derivedDays) store.derivedDays = {};
          store.derivedDays[dk] = 1;
        }
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
      // v1 睡眠同样走「保留原始测量值 + 按当前公式重算 score」；只补 v1 缺失的日，不覆盖已有
      const fixed = this.rebuildSleepFromSnapshot(snap.sleepDaily);
      for (const dk of Object.keys(fixed)) {
        if (!this.sleep[dk]) this.sleep[dk] = fixed[dk];
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
    this.notify();
  }

  clear(): void {
    for (const k of ALL_METRIC_KEYS) this.stores[k] = emptyStore();
    this.sleep = {};
    this.glance = {};
    this.lastUpdated = {};
    this.notify();
  }
}

function objMap(obj: Record<string, any>, fn: (v: any) => any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) out[k] = fn(obj[k]);
  return out;
}

export const healthStore = new HealthStore();
export default healthStore;
