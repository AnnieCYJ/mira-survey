/**
 * RingBleManager —— mira-app 的真实戒指数据层
 *
 * 方案 A：App 自己直连戒指（上架正路）
 *   HK18 的权威协议是 Veepoo 官方 iOS SDK（VeepooBleSDK.framework，预编译原生 framework）。
 *   React Native 无法桥接它，因此本文件通过一层 ObjC 原生桥 `VeepooRing`
 *   （见 ios/VeepooRing/VeepooRing.m + plugins/withVeepooSDK.js）包裹 SDK：
 *     mira-app --(NativeModules)--> VeepooRing --(VeepooBleSDK)--> HK18 戒指
 *   原生桥把扫描/连接/电量/心率/血氧/体温/皮电(EDA)/HRV/呼吸率 通过事件推给 JS。
 *
 * 回退方案：后端客户端（原型期可用，且作为原生不可用时的兜底）
 *   当原生模块因故不可用（如 Android、或尚未 prebuild）时，自动回退到读
 *   mira-ring-pro-backend(:3000) 已存的真实数据（HK18 --探针 App-- 后端 -- mira-app）。
 *
 * 数据源选择由 src/config.ts 的 RING_DATA_SOURCE 控制：
 *   'native'  → 优先原生直连，不可用时回退后端
 *   'backend' → 始终后端
 *
 * 导出 API 与本文件历史各版完全一致（RingBle / RingState / MetricKey / onState /
 * getState / startScan / connect / connectToId / disconnect / flashRing /
 * setAutoMonitor / measure），UI 层（SettingsScreen / InsightScreen /
 * BasicMetricCard）零改动。
 */
import { Alert, NativeModules, NativeEventEmitter, Platform, AppState, type AppStateStatus } from 'react-native';
import { postLog as _postLog } from '../lib/logger';
import * as FileSystem from 'expo-file-system';
import { theme } from '../theme/theme';
import { BACKEND_BASE_URL, RING_DATA_SOURCE, RING_SYNC_TOKEN } from '../config';
import {
  computeCycle,
  daysBetween,
  tempDailyToSeries,
  type CycleInfo,
  type CycleLog,
} from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { healthStore, dayKey, parseDayKey, type MetricKey as HSMetricKey } from '../data/healthStore';
import {
  computeSeed,
  deriveDaytimeBaseline,
  accumulateWindow,
  curveLevel,
  isRecoveringNow,
  CURVE_DEFAULTS,
  ALGO_DEFAULTS,
  type DailyRecord,
  type TodayInput,
  type SeedResult,
  type DaytimeBaseline,
  type WindowSignals,
  type CurvePoint,
  type CurveStatus,
  type PhaseBucket,
  isSameDay,
  computeSleepScore,
  type SleepInput,
} from '../lib/dailyStatus';
import { computeHRV } from "../lib/hrvCompute";
import { computeEmotionSnapshot, EMOTION_LABEL_CN, type EmotionSnapshot, type EmotionLabel } from '../lib/emotionEngine';

/** 今日状态每 30 分钟落一个快照；48 × 30min = 24h 滚动窗口 */
const STATUS_SNAPSHOT_MS = 30 * 60 * 1000;

/** 当日曲线上下文：晨间种子 + 日间基线 + 跨窗口滑动状态 */
interface DailyCurveSeed {
  dayKey: string;
  seed: SeedResult;
  baseline: DaytimeBaseline;
  /** 上次累积时的当日累计步数（用于本窗口步数增量） */
  lastWindowSteps: number | null;
  /** 上次见到戒指（有数据刷新）的时刻，用于佩戴中断 >2h 软重置 */
  lastWearTs: number | null;
}

const clampN = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const PHASE_TEXT: Record<string, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
  unknown: '未记录',
};
const STATUS_TIMELINE_CAP = 48;

export type RingConnStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
export type MetricKey = 'hr' | 'spo2' | 'temp' | 'eda' | 'hrv' | 'rr';
/** 核心实时信号 key（走 ingest 时间槽聚合）；其余 key 落入 daily 扩展指标存储 */
const CORE_KEYS: MetricKey[] = ['hr', 'spo2', 'temp', 'eda', 'hrv', 'rr'];

/**
 * 把 RingBleManager 内部 / 原生 signalKey 映射到 healthStore 的规范 MetricKey。
 * 这是「旧三套表示 → 单一 healthStore」统一层的关键桥：所有 backfill/realtime 写入
 * 路由到 healthStore 的规范 key，读侧（realSeries）只认 healthStore，消除「读哪个」混乱。
 */
function hsKeyFor(signalKey: string): HSMetricKey | null {
  switch (signalKey) {
    case 'hr': case 'spo2': case 'temp': case 'eda': case 'hrv': case 'rr':
    case 'steps': case 'distance': case 'calorie':
    case 'stress': case 'fatigue': case 'met': case 'cortisol': case 'emotion': case 'skin':
    case 'bpSys': case 'bpDia':
      return signalKey as HSMetricKey;
    case 'snsActivation': return 'sns';
    case 'bloodSugar': return 'glucose';
    case 'triglyceride': return 'triglyceride';
    case 'hdl': return 'hdl';
    case 'ldl': return 'ldl';
    case 'bloodFat':
    case 'cholesterol':
      return 'cholesterol';
    case 'uricAcid':
    case 'ua':
      return 'ua';
    default:
      // 宽松兜底：未知 key 先 cast 试试，healthStore.safeStore 会校验合法性返回 null
      return signalKey as HSMetricKey; // 未知/未映射指标不要硬 cast，避免 healthStore 里 store 未定义崩溃
  }
}

/** 趋势图的一个数据点：t = 收到时刻(epoch ms)，v = 数值。卡片按 t 映射到"今日时间轴"。 */
export interface TimePoint {
  t: number;
  v: number;
}

/** 睡眠分期的一个连续段（来自 Veepoo `parseSleepLine` 合并连续相同状态）。type: 0深睡 1浅睡 2REM 3失眠 4清醒；start/end 单位为分钟（start含、end不含）。 */
export interface SleepSegment {
  type: number;
  start: number;
  end: number;
}

/** 睡眠摘要（聚合值，与 sleepLine 派生互补）。 */
export interface SleepSummary {
  total: number;       // 总时长（分钟）
  deep: number;        // 深睡（分钟）
  light: number;       // 浅睡（分钟）
  rem: number;         // REM（分钟）
  awake?: number;      // 清醒（分钟）—— 从 sleepLine curve 解析
  insomnia?: number;   // 失眠（分钟）—— 从 sleepLine curve 解析
  score: number;       // 睡眠评分（0-100，自算，dailyStatus.computeSleepScore 产出）
  sdkScore?: number;   // 原始 SDK sleepQuality（0-5），留作调试
  getUp: number;       // 起夜次数
  sleepTime?: string | null; // 入睡时间 "HH:mm"
  wakeTime?: string | null;  // 起床时间 "HH:mm"
}

export interface RingDeviceInfo {
  id: string;
  name: string;
  rssi: number | null;
  recommended?: boolean;
}

export interface RingMetrics {
  hr: number | null;
  spo2: number | null;
  temp: number | null;
  eda: number | null;
  hrv: number | null;
  rr: number | null;
}

/** 戒指回传的女性经期/生理期状态（来自 veepooSDKSettingDeviceFemale 读取） */
export interface FemaleInfo {
  state: number; // 0 未设置 / 1 月经期 / 2 备孕期 / 3 怀孕期 / 4 辣妈期
  lastMenstrualDate: string | null; // yyyy-MM-dd
  menstrualCircle: number; // 周期长度（天）
  menstrualDays: number; // 经期天数
  currentMenstrualDays: number; // 当前经期实际天数
}

export interface RingState {
  /** 实时情绪快照 (每 30s 节流) */
  emotion: {
    arousalScore: number;        // 0..100
    valenceScore: number;        // -100..+100
    emotionLabel: EmotionLabel;  // 'stressed'|'focused'|'calm'|'bored'|'depleted'
    scrPeaksPerMin: number;
    scrMeanAmp: number | null;
    reason: string;
    updatedAt: number;
  } | null;

  status: RingConnStatus;
  deviceName: string | null;
  rssi: number | null;
  battery: number | null;
  firmware: string | null;
  /** 设备稳定标识（戒指 MAC 地址），用于上传云端时作为 device_id；原生 onStateChange 回传 deviceAddress */
  deviceId: string | null;
  metrics: RingMetrics;
  availability: Record<MetricKey, 'live' | 'syncing' | 'unavailable'>;
  history: Record<MetricKey, TimePoint[]>;
  /** 每个指标最后一次收到真实数据的时间戳（epoch ms）；用于在卡片上显示「监测时间」 */
  lastUpdated: Record<MetricKey, number | null>;
  /** 扩展指标（睡眠/计步/血糖/血脂/血压/压力/梅脱等）最新真实值，按 metrics.ts 的 EXTENDED_SIGNALS key（camelCase）索引 */
  daily: Record<string, number | null>;
  /** 扩展指标的趋势点（每次读取写入一个今日时刻点） */
  dailyHistory: Record<string, TimePoint[]>;
  /** 昨夜睡眠分期段（来自 Veepoo parseSleepLine，合并连续同状态）。null = 尚未读到睡眠。 */
  sleepStages: SleepSegment[] | null;
  /** 历史每天睡眠分期归档：dateKey('YYYY-MM-DD') → SleepSegment[]。backfill 逐日写入。 */
  sleepStagesDaily: Record<string, SleepSegment[]>;
  /** 昨夜睡眠摘要（总/深/浅/REM/评分/起夜） */
  sleepSummary: SleepSummary | null;
  /** sleepSummary 对应的日期；backfill 按 dn=0,1,2… 顺序读，避免后读的旧日期覆盖今天 */
  sleepSummaryDate: string | null;
  /** 入睡 / 起床时间字符串（"HH:mm"），用于分期图时间轴标注 */
  sleepTime: string | null;
  wakeTime: string | null;
  /** 戒指回传的女性经期/生理期状态（连接后读回，写入戒指后更新）。null = 尚未读取。 */
  female: FemaleInfo | null;
  /** 每日体温归档：dateKey('YYYY-M-D') -> 当日日均体温(°C)。跨天累积并持久化，供周期双相曲线使用。 */
  tempDaily: Record<string, number>;
  /** 每日 HRV 归档：dateKey -> 当日 HRV 均值(ms)。重连后由原生 backfill 回填历史日，供多日趋势。 */
  hrvDaily: Record<string, number>;
  /** 按天日内序列（跨天时间桶）：signalKey('hr'|'hrv'|'spo2'|'temp') -> dateKey -> 当日逐样本(含绝对 ts)。
   *  供历史日详情页画连续曲线（HR/HRV 已回填；血氧/体温由 backfill 补 onXxxSamples）。今日样本额外 ingest 进实时连续序列。 */
  seriesByDay: Record<string, Record<string, TimePoint[]>>;
  /** 各核心指标按天归档：dateKey -> 当日均值。跨天从当日时间槽均值写入，供多日趋势（HR/SpO₂/体温/EDA/呼吸）。 */
  hrDaily: Record<string, number>;
  spo2Daily: Record<string, number>;
  edaDaily: Record<string, number>;
  rrDaily: Record<string, number>;
  /** 每日睡眠归档（来自原生 backfill 读设备库）：total/deep/light/rem(分钟)/score(0-4)/getUp(起夜次数)。 */
  sleepDaily: Record<string, { total: number; deep: number; light: number; rem: number; score: number; getUp: number }>;
  /** 每日计步归档（来自原生 backfill 读设备库）：steps/distance(km)/calorie(kcal)。 */
  stepDaily: Record<string, { steps: number; distance: number; calorie: number }>;
  /** 最近一次与戒指成功同步（收到真实数据 / 连接成功）的时间戳（epoch ms）；用于「已同步」指示。 */
  lastSyncedAt: number | null;
  /** 最近一次原生 backfill（历史数据回填）完成的时间戳（epoch ms）。用于诊断历史数据缺失。 */
  lastBackfillAt: number | null;
  /** 今日状态历史日记录（相位专属基线用），跨天累积持久化 */
  statusHistory: DailyRecord[];
  /** 当日曲线上下文（晨间种子 + 日间基线 + 滑动状态）；跨天重置 */
  dailyCurve: DailyCurveSeed | null;
  /** 首页「今日状态」头条（曲线模型展示聚合） */
  curveStatus: CurveStatus | null;
  /** 今日状态曲线：每 30 分钟一个电量点（最多 48 点 = 24h），用于首页日内趋势 */
  statusTimeline: CurvePoint[];
  /** 按天聚合的「今日状态」分值（0–100）：当天 statusTimeline 的均值；跨天累积持久化，供周/月/年趋势 */
  statusDaily: Record<string, number>;
  /** 历史日真实状态曲线：每 30 分钟一个点，按天归档（跨天把当日 statusTimeline 存入）。查看过去某天时用它，与当时一致，不反推 */
  statusTimelineByDay: Record<string, CurvePoint[]>;
  error: string | null;
  devices: RingDeviceInfo[];
  flashing: boolean;
  flashResult: string | null;
  protocol: string | null;
  /** 健康一览扩展指标（血脂/心理/血压/身体成分）与手动测量（血压/ECG）按天归档：
   *  dateKey('YYYY-M-D') -> { signalKey: value }。供周/月/年跨天历史（realSeries 读取）。 */
  extDaily: Record<string, Record<string, number>>;
  /** 最近一次 ECG 实时测量读数（HK18 硬件）。null = 尚未测量。 */
  ecg: EcgReading | null;
  /** 按天归档的 ECG 读数（backfill 离线回拉 + 实时测量累积）：dateKey -> 当日最新一次读数。 */
  ecgDaily: Record<string, EcgReading>;
  /** ECG 每次测量追加历史，最多 30 条，按时间倒序。 */
  ecgHistory: EcgReading[];
  /** 最近一次手动「上传云端」成功的时间戳（秒），用于设置页展示上传时间；null = 从未上传。 */
  lastUploadedAt: number | null;
  /** 设备能力标志（连接后由原生 onPasswordVerified 上报）：ecgType(0无/1E/2G)、funcAssessmentType、
   *  healthGlanceType、supportManualTestType（位掩码：GSR=1<<12 / BP=1<<0 / HG=1<<9）。
   *  用于如实判断「心电/光电血压/抑郁风险」在当前戒指上能否测量，而非盲目调用。 */
  deviceCapabilities: { ecgType: number; funcAssessmentType: number; healthGlanceType: number; supportManualTestType: number } | null;
  /** ECG 实时测量进度（原生 onEcgProgress 回传）：progress=0~100，hr=当前心率（测量中）。非持久化，仅测量期间有效。 */
  ecgProgress: { progress: number; hr?: number } | null;
  /** healthStore 数据版本计数器：healthStore 写入时递增，让只订阅 RingState 的页面也能感知到数据变化并刷新。 */
  dataVersion: number;
}

type StatePatch = Partial<RingState>;

/**
 * 离线同步进度（原生 onBackfillProgress 上报），用于底部「正在同步数据 x%」小浮层。
 * active=false = 本轮同步已结束（UI 可短暂显示「已同步」再淡出）。
 * ★ 走【独立订阅通道】onSyncProgress，**不进 RingState** —— 避免同步期间的高频进度更新
 *   触发全 App 重渲染，反过来加重同步时的卡顿（RingState 更新会 emit 给所有屏幕）。
 */
export interface SyncProgress {
  active: boolean;
  /** 0..100 */
  percent: number;
  /** 阶段文案：「从戒指下载数据」/「同步历史数据」/「已完成」 */
  phase: string;
}
type MetricEvent = { key: string; value: number; unit: string; ts: number };
/** 单次 ECG 实时测量读数（HK18 硬件支持）。filterSignals 为波形原始 ADC 点，原生已截断到合理长度。 */
export interface EcgReading {
  aveHeart: number;
  aveHrv: number;
  aveResRate: number;
  aveQT: number;
  avePWV: number;
  /** 波形点（归一化前的原始 ADC / mV 值），用于绘制迷你心电图 */
  waveform: number[];
  ts: number;
}
type StateListener = (s: RingState) => void;

const DEFAULT_METRICS: RingMetrics = {
  hr: null,
  spo2: null,
  temp: null,
  eda: null,
  hrv: null,
  rr: null,
};

const DEFAULT_AVAILABILITY: Record<MetricKey, 'live' | 'syncing' | 'unavailable'> = {
  hr: 'unavailable',
  spo2: 'unavailable',
  temp: 'unavailable',
  eda: 'unavailable',
  hrv: 'unavailable',
  rr: 'unavailable',
};

const EMPTY_HISTORY: Record<MetricKey, TimePoint[]> = {
  hr: [],
  spo2: [],
  temp: [],
  eda: [],
  hrv: [],
  rr: [],
};

const DEFAULT_LAST_UPDATED: Record<MetricKey, number | null> = {
  hr: null,
  spo2: null,
  temp: null,
  eda: null,
  hrv: null,
  rr: null,
};

function num(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function tail<T>(nums: T[], n = 24): T[] {
  if (nums.length <= n) return nums;
  return nums.slice(nums.length - n);
}

// ── 全天趋势图的数据模型：把一天切成等长时间槽（SLOT_MS），每槽聚合一个代表值 ──
// 这样无论底层采样多密（心率 1Hz → 一天 86400 点），存储与绘图都只有 ~1440 点/指标/天。
const SLOT_MS = 15 * 60_000; // 15 分钟一个槽（全天 96 个点，每个点取该时段样本均值，趋势更平滑）
const DAY_MS = 86_400_000;

function dayStartMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 把 yyyy-M-d / yyyy-MM-dd 字符串安全解析为当天 00:00:00 的毫秒数。
 *  不用 new Date(string) —— iOS/Safari 对非 ISO / 非补零的日期字符串会返回 Invalid Date，
 *  导致 dayKey 变成 NaN-NaN-NaN。 */
function parseYmd(date: string): { y: number; m: number; d: number } | null {
  const m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
function dateKeyToStartMs(date: string): number {
  const ymd = parseYmd(date);
  if (!ymd) return Number.NaN;
  return new Date(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0).getTime();
}
/** 解析日期字符串为 YYYY-MM-DD key，同时校验年份合法（2020-2099）。
 *  非法年份（如 2083 溢出、NaN-NaN-NaN）返回空串 ""，调用方应跳过。 */
function dateKeyOfStr(date: string): string {
  const ms = dateKeyToStartMs(date);
  if (Number.isNaN(ms)) return '';
  const ymd = parseYmd(date);
  if (!ymd) return '';
  if (ymd.y < 2020 || ymd.y > 2030) return ''; // 过滤 2083 溢出等垃圾（2030 年后视为非法）
  return dayKeyOf(ms);
}

/** 安全解析样本时间：支持字符串 "HH:mm" 或直接毫秒偏移数字，返回绝对时间戳 */
function sampleTimeMs(t: string | number | undefined, baseMs: number): number {
  if (typeof t === 'number') {
    // ★ 原生 backfill emitDaySamples 发的是绝对 epoch ms（@((long long)slotMs) → JS number > 1e12）
    // 老 code 误加 baseMs 导致时间戳翻倍，healthStore.getIntraday 查不到数据
    if (t > 1e12) return t;         // 绝对 ms，直接返回
    if (t > 1e9) return t * 1000;   // 秒级时间戳，转 ms
    return baseMs + t;              // 兜底：相对 baseMs 的偏移
  }
  if (typeof t !== 'string') return Number.NaN;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return Number.NaN;
  return baseMs + (h * 3600 + min * 60) * 1000;
}

/** 把原生精准睡眠曲线（每分钟一个 stage：0深睡/1浅睡/2REM/3失眠/4苏醒）合并成 SleepSegment[]。
 *  start/end 为相对入睡的分钟数（0..总时长），契合 SleepStageChart 契约。 */
function mergeSleepCurve(curve: number[]): SleepSegment[] {
  if (!curve.length) return [];
  const segs: SleepSegment[] = [];
  let runStart = 0;
  let runType = curve[0];
  for (let i = 1; i <= curve.length; i++) {
    const t = i < curve.length ? curve[i] : -1;
    if (t !== runType) {
      segs.push({ type: runType, start: runStart, end: i });
      runStart = i;
      runType = t;
    }
  }
  return segs;
}

/** 把协议睡眠时间串（"MM-DD-HH-mm" / "yyyy-MM-dd HH-mm" / "HH:mm"）规范成卡片所需的 "HH:mm"；无法解析返回 null。 */
function fmtSleepClock(s?: string | null): string | null {
  if (!s) return null;
  const parts = s.split(/[-:\s]/).filter((p) => p.length > 0);
  const pick = (hh: string, mm: string): string | null =>
    /^\d{1,2}$/.test(hh) && /^\d{1,2}$/.test(mm) ? `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}` : null;
  if (parts.length === 4) return pick(parts[2], parts[3]); // MM-DD-HH-mm
  if (parts.length === 5) return pick(parts[3], parts[4]); // yyyy-MM-dd HH-mm
  if (parts.length === 2) return pick(parts[0], parts[1]); // HH:mm
  return null;
}

/** 解析原生样本时间戳 t（关联日期 date，yyyy-MM-dd / yyyy-M-D 均可）。
 *  兼容：HH:MM / HH:MM:SS / yyyy-MM-dd HH:MM[:SS] / yyyy-MM-ddTHH:MM[:SS] / 纯数字(epoch ms 或 s)。
 *  返回绝对 ms；无法解析返回 null。原生 backfill 回传的 slot 时间格式未必是纯 HH:MM，
 *  解析失败会导致整段样本被丢弃（历史日「无逐时明细」），故此处放宽。 */
function parseSampleTs(date: string, t: unknown): number | null {
  // ★ 原生 backfill 传的是 @((long long)slotMs) → JS number（epoch ms）
  // 老 code 只接受 string → 所有 BP/HRV 样本被丢弃！
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
    return t > 1e12 ? t : t * 1000;
  }
  if (typeof t === 'string') {
    if (/^\d{9,}$/.test(t)) {
      const n = Number(t);
      return n > 1e12 ? n : n * 1000;
    }
    const base = dateKeyToStartMs(date);
    if (!Number.isFinite(base)) return null;
    let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const h = Number(m[1]), min = Number(m[2]), s = Number(m[3] ?? 0);
      if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) {
        return base + h * 3600000 + min * 60000 + s * 1000;
      }
    }
    m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      const h = Number(m[4]), min = Number(m[5]), s = Number(m[6] ?? 0);
      const ts = new Date(y, mo - 1, d, h, min, s, 0).getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }
  return null;
}

/** 当全部样本时间都无法解析时，按序号把 N 个样本均匀摊到当天 00:00~24:00，
 *  保证历史日连续曲线可画（顺序即时间先后，符合「按测量顺序回放」语义）。 */
function evenSpreadDay(date: string, n: number): number[] {
  const base = dateKeyToStartMs(date);
  const step = n > 1 ? Math.floor(86400000 / n) : 0;
  return Array.from({ length: n }, (_, i) => base + i * step);
}

// ── 日志双写：1）POST 到本地收集服务；2）内存环型缓冲，导出诊断时我直接看，
// 避免用户没开日志服务时丢失关键 native 事件。日志转发目标自动取 Metro/打包器
// 的真实局域网 IP（即 RN bundle 的 scriptURL host），不再写死 IP。
let _logHost: string | null = null;
function getLogHost(): string {
  if (_logHost) return _logHost;
  try {
    const scriptURL = (NativeModules as any).SourceCode?.scriptURL as string | undefined;
    if (scriptURL) {
      const host = new URL(scriptURL).hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        _logHost = host;
        return host;
      }
      _logHost = '192.168.1.2';
      return _logHost;
    }
  } catch {
    /* ignore */
  }
  _logHost = '192.168.1.2';
  return _logHost;
}
const MAX_MEM_LOGS = 1200;
const _recentLogs: { t: number; tag: string; msg: string }[] = [];
function pushMemLog(tag: string, msg: string) {
  _recentLogs.push({ t: Date.now(), tag, msg });
  if (_recentLogs.length > MAX_MEM_LOGS) _recentLogs.shift();
}
export function getRecentLogs(n = 300): { t: number; tag: string; msg: string }[] {
  return _recentLogs.slice(-Math.max(1, n));
}

const _emotionHistoryArr: { t: number; arousalScore: number; valenceScore: number; emotionLabel: string }[] = [];
export function getEmotionHistory() { return _emotionHistoryArr.slice(); }
function postLog(tag: string, msg: string) {
  pushMemLog(tag, msg);
  // ★ 远端收集器限流（真机 2026-09-11 20:54 看门狗崩溃诱因之一）：日志风暴时若每行都
  //   fetch 到 :8899，会把 Mac 单线程收集器打爆并堆积大量超时请求。
  //   ★ 但**诊断类日志必须豁免**：原生 emitLog 的消息（[BACKFILL]/[CHAIN]/[STEP]/[RECOVER]…）
  //   只能经 JS onLog 转发到收集器，若被限流吃掉，就再也看不到离线同步/步数的真实链路。
  const now = Date.now();
  const important = /\[(BACKFILL|CHAIN|RECOVER|FMDB|STEP|handleStepDay|handleSleepDay|AUTO-MONIT|连接状态)\]/i.test(msg);
  if (!important) {
    if (now - _gLastPostAt < 250) { _gPostDropped++; return; }
    _gLastPostAt = now;
    _gPostDropped = 0;
  }
  const host = getLogHost();
  try {
    fetch(`http://${host}:8899/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, msg }),
    }).catch(() => {});
  } catch {
    /* 静默：日志转发失败绝不影响 App 运行 */
  }
}

// ★ 远端日志限流状态（模块级，跨实例共享）
let _gLastPostAt = 0;
let _gPostDropped = 0;
// ★ setSyncEnabled 幂等防线（模块级）：真机 2026-09-11 20:54 观测到原生
//   `[VeepooRing LIFECYCLE] setSyncEnabled=1` 在 4.18s 内被打印 865 次（~207 次/秒），
//   即 native setSyncEnabled 被以同值疯狂重复下发。每次还会触发原生 MRForward 的远端
//   HTTP POST → 收集器被打爆 → libdispatch 争用 → LogBox 建面时同步等 UIManager 队列
//   → 主线程死锁 → 5s 看门狗杀（0x8BADF00D）。此处把「同值重复」折叠为 1 次并留一条
//   调用栈，从源头掐断风暴；若真出现重复，第一条会打印调用栈供定位。
let _gLastNativeSyncEnabled: boolean | null = null;
let _gLastNativeSyncAt = 0;
// 同值重发的兜底间隔：把 200+ 次/秒的风暴压到 ≤1 次/30s，同时保证「原生实例重建 / 上次
// 下发被 SKIP（instance 未就绪）」的情况下，30s 内必定重发一次，不会永久锁在错误值上。
const _SYNC_REPUSH_MS = 30000;
/**
 * 复位「同值不下发」守卫，使下一次 setSyncEnabled 必定下发。
 * 用在连接边沿（idle→connected）：需要把开关立即推给（可能刚重建的）原生实例，
 * 不能被幂等守卫按「值没变」吞掉 —— 否则原生 syncEnabled 停在默认 NO，backfill 全跳过。
 */
function resetSyncPushGuard() {
  _gLastNativeSyncEnabled = null;
  _gLastNativeSyncAt = 0;
}
// 把完整诊断快照 POST 到同一日志收集服务 /dump 端点，这样导出诊断文件时
// 结构化数据会自动落到 Mac 上 agent 可读的文件，用户无需 AirDrop 搬运。
function postDump(json: string) {
  const host = getLogHost();
  try {
    fetch(`http://${host}:8899/dump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }).catch(() => {});
  } catch {
    /* 静默 */
  }
}

// 把某天的已有日内序列与本次新样本合并（按 ts 去重，后者覆盖前者），返回按 ts 升序的序列。
// 用于跨天时间桶：backfill 可能多次运行，同一天样本以 ts 去重避免重复累加。
function mergeDaySeries(existing: TimePoint[] | undefined, incoming: TimePoint[]): TimePoint[] {
  const m = new Map<number, number>();
  for (const p of existing || []) if (typeof p.t === 'number' && typeof p.v === 'number') m.set(p.t, p.v);
  for (const p of incoming) if (typeof p.t === 'number' && typeof p.v === 'number') m.set(p.t, p.v);
  return Array.from(m.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 原生桥数据源（VeepooRing）
// ─────────────────────────────────────────────────────────────────────────────

const VeepooNative = (NativeModules as any).VeepooRing;

class NativeRingSource {
  private emitter: NativeEventEmitter | null = null;
  private jsMetricCount = 0;
  private jsMetricKeys: Record<string, number> = {};
  /** 已 ingest 的最新 HRV 样本时间戳（ms），用于 onHrvSamples 去重，避免每 300s 周期读重复写入 */
  private lastHrvIngestTs = 0;
  /** 已 ingest 的最新 HR 样本时间戳（ms），用于 onHrSamples 去重 */
  private lastHrIngestTs = 0;

  constructor(
    private push: (patch: StatePatch) => void,
    private pushMetric: (m: MetricEvent) => void,
    private getState: () => RingState,
    private requestFlush: () => void,
    private onBackfillComplete: () => void,
    /** 同步进度回调（原生 onBackfillProgress）→ 转发到 RingBleManager 的独立轻量通道 */
    private onSyncProgress: (p: SyncProgress | null) => void
  ) {
    if (VeepooNative) {
      this.emitter = new NativeEventEmitter(VeepooNative);
      this.emitter.addListener('onStateChange', this.handleState);
      this.emitter.addListener('onMetric', this.handleMetric);

      this.emitter.addListener('onHrvDay', this.handleHrvDay);
      this.emitter.addListener('onHrvSamples', this.handleHrvSamples);
      this.emitter.addListener('onSleepDay', this.handleSleepDay);
      this.emitter.addListener('onStepDay', this.handleStepDay);
      this.emitter.addListener('onSpo2Day', this.handleSpo2Day);
      this.emitter.addListener('onTempDay', this.handleTempDay);
      this.emitter.addListener('onFemale', this.handleFemale);
      this.emitter.addListener('onEcg', this.handleEcg);
      this.emitter.addListener('onEcgProgress', this.handleEcgProgress);
      this.emitter.addListener('onEcgDay', this.handleEcgDay);
      this.emitter.addListener('onHealthGlanceDay', this.handleHealthGlanceDay);
      // ★ 血压历史回填：原生 backfill 从 veepooSDKGetOriginalData 聚合血压后 emit onBpDay
      this.emitter.addListener('onBpDay', this.handleBpDay);
      // ★ raw 5 分钟 slot 批量回填（hr/bp/steps/stress/met 等逐点，趋势图用）
      this.emitter.addListener('onBackfillDaySlots', this.handleBackfillDaySlots);
      // ★ 血压 intraday 补全（原生拆成 onBpSysSamples / onBpDiaSamples 小事件）
      this.emitter.addListener('onBpSysSamples', (raw: any) => this.handleDayBucketSamples(raw, 'bpSys'));
      this.emitter.addListener('onBpDiaSamples', (raw: any) => this.handleDayBucketSamples(raw, 'bpDia'));
      // ★ 血糖 intraday 回填：原生 backfill 从 blood_glucose_table 拉每 5 分钟一条 emit onBloodSugarSamples
      this.emitter.addListener('onBloodSugarSamples', (raw: any) => this.handleDayBucketSamples(raw, 'bloodSugar'));
      // ★ 血液成分历史回填：原生 backfill 从 VPDailyBloodAnalysisModel 逐 5min 读取后 emit
      this.emitter.addListener('onBloodAnalysisDay', this.handleBloodAnalysisDay);
      this.emitter.addListener('onHrDay', this.handleHrDay);
      this.emitter.addListener('onHrSamples', this.handleHrSamples);
      this.emitter.addListener('onSpo2Samples', this.handleSpo2Samples);
      this.emitter.addListener('onTempSamples', this.handleTempSamples);
      // ★ 逐 slot 全天序列 — 从原生 veepooSDKGetOriginalDataWithDate 每个时间桶 emit
      this.emitter.addListener('onStressSamples', (raw: any) => this.handleDayBucketSamples(raw, 'stress'));
      this.emitter.addListener('onFatigueSamples', (raw: any) => this.handleDayBucketSamples(raw, 'fatigue'));
      this.emitter.addListener('onSnsSamples', (raw: any) => this.handleDayBucketSamples(raw, 'snsActivation'));
      this.emitter.addListener('onMetSamples', (raw: any) => this.handleDayBucketSamples(raw, 'met'));
      this.emitter.addListener('onStepSamples', (raw: any) => this.handleDayBucketSamples(raw, 'steps'));
      this.emitter.addListener('onDistanceSamples', (raw: any) => this.handleDayBucketSamples(raw, 'distance'));
      this.emitter.addListener('onCalorieSamples', (raw: any) => this.handleDayBucketSamples(raw, 'calorie'));
      // ★ healthGlance 复合指标历史回填（SDK ManualTestDataAll 里的 emotion/cortisol/skin/sns/bpSys/bpDia/血脂...）
      this.emitter.addListener('onManualHealthGlance', (raw: any) => this.handleManualHealthGlance(raw));
      this.emitter.addListener('onDeviceCapabilities', this.handleDeviceCapabilities);
      this.emitter.addListener('onBackfillComplete', () => {
        postLog('RingBle', '[JS] onBackfillComplete 收到 ✅');
        this.push({ lastBackfillAt: Date.now() });
        this.onBackfillComplete();
      });
      // ★ 同步进度**不再单独注册事件**：原生改走已有的 onStateChange（带 syncProgress 字段），
      //   由 handleState 分流到独立进度通道。这样避免「JS 先更新、原生未编译」时
      //   RCTEventEmitter 对未知事件名抛异常红屏（2026-09-11 真机踩过）。
      // ★ 调试：constructor 10s 后自动 backfill，让 handleBloodAnalysisDay 跑到
      setTimeout(() => {
        if (this.getState().status === 'connected') {
          postLog('RingBle', '[AUTO_BACKFILL] ✅ 触发');
          VeepooNative?.backfill?.();
        } else {
          postLog('RingBle', `[AUTO_BACKFILL] 跳过 status=${this.getState().status}`);
        }
      }, 10000);
      this.emitter.addListener('onLog', (msg: string) => {
        // eslint-disable-next-line no-console
        postLog('JS', msg);
      });
      // 诊断：每 2s 打印 JS 侧实际收到的指标速率（按 key 分类），与原生 METRIC-RATE 对照，
      // 直接看出 hr/spo2/temp/eda/hrv/rr 各自到没到。
      setInterval(() => {
        if (this.jsMetricCount > 0) {
          const parts = Object.entries(this.jsMetricKeys)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');
          const line = `[VeepooRing JS-RATE] recv=${this.jsMetricCount}/2s ${parts}`;
          // eslint-disable-next-line no-console
          postLog('JS-RATE', `recv=${this.jsMetricCount}/2s ${parts}`);
          this.jsMetricCount = 0;
          this.jsMetricKeys = {};
        }
      }, 2000);
      // ★ 每 15s dump 一次关键归档的 9-3 值 — 直接回答"数据到底存了没"
      setInterval(() => {
        try {
          const s = this.getState();
          // ★ 修：查今天和昨天的数据，不是硬编码 9-3
          const dk = (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          })();
          const edk = s.extDaily[dk] ?? {};
          const dump = {
            step: s.stepDaily[dk],
            hrv: s.hrvDaily[dk],
            temp: s.tempDaily[dk],
            hr: s.hrDaily[dk],
            spo2: s.spo2Daily[dk],
            sleep: s.sleepDaily[dk],
            extKeys: Object.keys(edk),
            extValues: edk,
            seriesKeys: Object.keys(s.seriesByDay),
            hasHrvSeries: !!s.seriesByDay['hrv']?.[dk]?.length,
          };
          postLog('STATE_DUMP', JSON.stringify(dump));
        } catch(e) {}
      }, 15000);
      // ★ 周期性轻量回填：修复「很多数据不更新」——原只在连接瞬间 / 手动 forceResync 才 backfill。
      //   每 30 分钟（已连接且同步开启）重新拉一次戒指历史，保证历史日数据持续补齐。
      setInterval(() => {
        try {
          const st = this.getState();
          if (st.status === 'connected' && healthStore.syncEnabled) {
            VeepooNative?.backfill?.();
            postLog('RingBle', '[PERIODIC_BACKFILL] 30min 周期回填已触发');
          }
        } catch (e) {}
      }, 30 * 60 * 1000);
      // ★ App 回到前台也触发一次回填（用户切回 App 时立即补齐历史）
      AppState.addEventListener('change', (next: AppStateStatus) => {
        try {
          if (next === 'active') {
            const st = this.getState();
            if (st.status === 'connected' && healthStore.syncEnabled) {
              VeepooNative?.recoverOffline?.();
              postLog('RingBle', '[FOREGROUND_BACKFILL] App 回到前台触发离线恢复（重下载）');
            }
          }
        } catch (e) {}
      });
    }

  }

  /** ★ ManualTestData healthGlance 历史回填

  /** ★ ManualTestData healthGlance 历史回填 — 把 SDK 本地 flash 存的所有 healthGlance 结果灌入 healthStore
   *  离线后重连能拉回 emotion/cortisol/skin/sns/bpSys/bpDia/血脂/血糖/尿酸 等复合指标 */
  private handleManualHealthGlance(raw: { samples: Array<Record<string, any>> }) {
    const samples = raw?.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
      postLog('RingBle', '[MANUAL-HG] empty → skip');
      return;
    }
    postLog('RingBle', `[MANUAL-HG] n=${samples.length}`);

    const FIELD_MAP: Record<string, HSMetricKey> = {
      hr: 'hr', spo2: 'spo2', hrv: 'hrv', temp: 'temp',
      stress: 'stress', fatigue: 'fatigue',
      sns: 'sns', cortisol: 'cortisol', emotion: 'emotion', skin: 'skin',
      bpSys: 'bpSys', bpDia: 'bpDia', ppgSys: 'ppgSys', ppgDia: 'ppgDia',
      glucose: 'glucose', cholesterol: 'cholesterol',
      triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl', uricAcid: 'ua',
    };

    let ingested = 0;
    for (const pt of samples) {
      const ts = Math.round(Number(pt.ts) || 0);
      if (ts <= 0) continue;
      for (const [field, hsKey] of Object.entries(FIELD_MAP)) {
        const val = pt[field];
        if (val == null) continue;
        const num = Number(val);
        if (!Number.isFinite(num) || num <= 0) continue;
        try {
          healthStore.upsertRealtime(hsKey, { t: ts, v: num }, ts);
          ingested++;
        } catch { /* skip */ }
      }
    }
    postLog('RingBle', `[MANUAL-HG] ingested=${ingested}`);
  }

  get available(): boolean {
    return !!VeepooNative;
  }

  private handleState = (raw: Record<string, any>) => {
    // ★ 同步进度走**已有的** onStateChange 事件转发（刻意不新增事件名）：
    //   RCTEventEmitter 对「未在原生 supportedEvents 里声明的事件」会在 addListener 时
    //   直接抛异常 → 整屏红屏。复用已有事件可彻底避免「JS 先更新、原生还没 Clean Build」
    //   这种版本错配（2026-09-11 真机曾因新增 onBackfillProgress 触发红屏）。
    //   注意：进度只推给独立通道，**不写进 patch / RingState**，
    //   避免同步期间几十次进度更新触发全 App 重渲染、反过来加重卡顿。
    if (raw && raw.syncProgress) {
      try {
        const sp = raw.syncProgress as { active?: unknown; percent?: unknown; phase?: unknown };
        const active = !!sp.active;
        const pct = typeof sp.percent === 'number' ? sp.percent : 0;
        const percent = Math.max(0, Math.min(100, pct));
        const phase = typeof sp.phase === 'string' ? sp.phase : '';
        this.onSyncProgress({ active, percent, phase });
      } catch {
        /* 静默：进度异常绝不影响连接状态处理 */
      }
    }
    // eslint-disable-next-line no-console
    const patch: StatePatch = {};
    if (typeof raw.status === 'string') patch.status = raw.status as RingConnStatus;
    if (raw.deviceName) patch.deviceName = raw.deviceName;
    if (raw.battery != null) patch.battery = num(raw.battery) ?? patch.battery;
    if (raw.firmware) patch.firmware = raw.firmware;
    if (raw.deviceAddress) patch.deviceId = String(raw.deviceAddress);
    if (Array.isArray(raw.devices)) {
      patch.devices = raw.devices.map((d: any) => ({
        id: String(d.id ?? ''),
        name: String(d.name ?? 'Mira Ring Pro'),
        rssi: num(d.rssi) ?? null,
        recommended: !!d.recommended,
      }));
    }
    if (raw.error) patch.error = String(raw.error);
    if (raw.protocol) patch.protocol = raw.protocol;
    this.push(patch);
  };

  private handleMetric = (m: MetricEvent) => {
    if (!m || m.key == null) return;
    this.jsMetricCount++;
    this.jsMetricKeys[m.key] = (this.jsMetricKeys[m.key] ?? 0) + 1;
    // 原生 SDK 回调的 value 可能是字符串/对象，必须规整为 number，否则下游
    // formatValue 里 `v.toFixed(1)` 会对字符串抛 TypeError → 整棵树崩溃白屏。
    // 关键：所有 key（核心 hr/spo2/... 与扩展 steps/sleepTotal/...）都要 push 出去，
    // 由 flushPendingMetrics 按 CORE_KEYS 分流——之前只 push 6 个核心 key，
    // 导致扩展指标（睡眠/计步/血糖...）在 handleMetric 就被丢弃，洞察页读不到。
    postLog('JS', `[handleMetric] RAW key=${m.key} val=${JSON.stringify(m.value)} type=${typeof m.value}`);
    const v = num(m.value);
    if (v == null) {
      postLog('JS', `[handleMetric] SKIP num(null) key=${m.key} val=${JSON.stringify(m.value)}`);
      return;
    }
    postLog('JS', `[handleMetric] PUSH key=${m.key} v=${v}`);
    this.pushMetric({ key: m.key, value: v, unit: m.unit ?? '', ts: m.ts ?? Date.now() });
  };

  /** 睡眠分期事件：结构不同于普通 metric（数组 + 摘要），单独落库，不经 num()/flush 流程。 */
  private handleSleepStages = (raw: {
    segments?: any[];
    summary?: any;
    sleepTime?: string;
    wakeTime?: string;
  }) => {
    try {
      const segs: SleepSegment[] = Array.isArray(raw.segments)
        ? raw.segments
            .map((s) => ({ type: Number(s.type), start: Number(s.start), end: Number(s.end) }))
            .filter((s) => Number.isFinite(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end))
        : [];
      const sm = raw.summary || {};
      const summary: SleepSummary = {
        total: Number(sm.total) || 0,
        deep: Number(sm.deep) || 0,
        light: Number(sm.light) || 0,
        rem: Number(sm.rem) || 0,
        score: Number(sm.score) || 0,
        getUp: Number(sm.getUp) || 0,
      };
      // 实时睡眠监测没有 date 字段，按「今天」处理；只在没有更新过或今天 >= 已存日期时更新
      const today = dayKey(Date.now());
      const curDate = this.getState().sleepSummaryDate;
      if (!summary.total) return;
      if (!curDate || today >= curDate) {
        this.push({
          sleepStages: segs.length ? segs : null,
          sleepSummary: summary,
          sleepSummaryDate: today,
          sleepTime: raw.sleepTime ?? null,
          wakeTime: raw.wakeTime ?? null,
        });
      }
    } catch {
      /* 睡眠分期解析失败静默：绝不影响其他信号 */
    }
  };

  /** 女性经期/生理期状态事件：连接后读回或写入后回传。 */
  private handleFemale = (raw: {
    state?: number;
    lastMenstrualDate?: string | null;
    menstrualCircle?: number;
    menstrualDays?: number;
    currentMenstrualDays?: number;
  }) => {
    try {
      const info: FemaleInfo = {
        state: Number(raw.state) || 0,
        lastMenstrualDate: raw.lastMenstrualDate ? String(raw.lastMenstrualDate) : null,
        menstrualCircle: Number(raw.menstrualCircle) || 0,
        menstrualDays: Number(raw.menstrualDays) || 0,
        currentMenstrualDays: Number(raw.currentMenstrualDays) || 0,
      };
      this.push({ female: info });
    } catch {
      /* 经期状态解析失败静默 */
    }
  };

  /** ECG 实时测量读数（HK18 硬件）：原生 onEcg 回传完整派生指标 + 波形，落库到 ring.ecg，
   *  同时把平均心率作为 'ecg' 信号写入扩展归档（extDaily），供周/月/年跨天趋势。 */
  private handleEcg = (raw: {
    aveHeart?: number;
    aveHrv?: number;
    aveResRate?: number;
    aveQT?: number;
    avePWV?: number;
    waveform?: number[];
  }) => {
    try {
      if (!raw || typeof raw.aveHeart !== 'number' || !Number.isFinite(raw.aveHeart)) return;
      const reading: EcgReading = {
        aveHeart: num(raw.aveHeart) ?? 0,
        aveHrv: num(raw.aveHrv) ?? 0,
        aveResRate: num(raw.aveResRate) ?? 0,
        aveQT: num(raw.aveQT) ?? 0,
        avePWV: num(raw.avePWV) ?? 0,
        waveform: Array.isArray(raw.waveform) ? raw.waveform.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)) : [],
        ts: Date.now(),
      };
      // 追加到历史数组（最多保留 30 次）
      const curHistory = this.getState().ecgHistory ?? [];
      const newHistory = [reading, ...curHistory].slice(0, 30);
      // ★ 关键：清掉 ecgProgress → UI 从"处理结果中…"回到空闲态（显示"重新测量"）
      // 之前设 progress:100 会导致 isDone 永远为 true，UI 永远卡在 loading
      this.push({ ecg: reading, ecgProgress: null, ecgHistory: newHistory });
      // 把平均心率作为 'ecg' 信号推入 flush 归档链路 → extDaily[今日]['ecg']，多日趋势可用
      this.pushMetric({ key: 'ecg', value: reading.aveHeart, unit: 'bpm', ts: reading.ts });
      // 呼吸率：本固件独立 TestBreathingRateStart 会打断实时 HR/SpO₂ 且恒返 NoFunction(7)，故不调；
      // 改从 ECG 的 aveResRate 取（HK18 ECG 硬件支持），作为核心 'rr' 信号 → metrics.rr + rrDaily 历史。
      if (reading.aveResRate > 0) {
        this.pushMetric({ key: 'rr', value: reading.aveResRate, unit: '次/分', ts: reading.ts });
      }
    } catch {
      /* ECG 解析失败静默 */
    }
  };

  /** ECG 实时测量进度（原生 onEcgProgress）：progress=0~100，hr=当前心率。仅测量期间有效，结果到达即由 handleEcg 清掉。 */
  private handleEcgProgress = (raw: { progress?: number; hr?: number; error?: string }) => {
    try {
      if (raw && raw.error) {
        if (typeof Alert !== 'undefined') Alert.alert('ECG 测量失败', raw.error);
        // 设备不支持（NoFunction）：清掉进度，UI 据此提示
        this.push({ ecgProgress: null });
        return;
      }
      const progress = typeof raw.progress === 'number' ? raw.progress : 0;
      const hr = typeof raw.hr === 'number' && Number.isFinite(raw.hr) ? raw.hr : undefined;
      this.push({ ecgProgress: { progress, hr } });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日 ECG 回填：原生 backfill 按日读离线 ECG，带 dateKey 回传，落库到 ecgDaily + extDaily[date]['ecg'] + rrDaily[date]。 */
  private handleEcgDay = (raw: {
    date?: string;
    ts?: number;
    aveHeart?: number;
    aveHrv?: number;
    aveResRate?: number;
    aveQT?: number;
    avePWV?: number;
    waveform?: number[];
  }) => {
    try {
      if (!raw || !raw.date || typeof raw.aveHeart !== 'number' || !Number.isFinite(raw.aveHeart) || raw.aveHeart <= 0) return;
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      const reading: EcgReading = {
        aveHeart: num(raw.aveHeart) ?? 0,
        aveHrv: num(raw.aveHrv) ?? 0,
        aveResRate: num(raw.aveResRate) ?? 0,
        aveQT: num(raw.aveQT) ?? 0,
        avePWV: num(raw.avePWV) ?? 0,
        waveform: Array.isArray(raw.waveform)
          ? raw.waveform.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v))
          : [],
        ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
      };
      const curEcg = this.getState().ecgDaily;
      const patch: StatePatch = { ecgDaily: { ...curEcg, [dk]: reading } };
      const todayKey = dayKeyOf(Date.now());
      if (dk === todayKey) patch.ecg = reading; // 今日的 ECG 立即在 ECG 卡片可见
      // 平均心率作为 ecg 信号归档（多日趋势）；呼吸率(aveResRate)作为 rr 信号归档（避免单独 TestBreathingRateStart 掐断实时 HR/SpO₂）
      const curExt = this.getState().extDaily;
      const prevDay = curExt[dk] ?? {};
      patch.extDaily = { ...curExt, [dk]: { ...prevDay, ecg: reading.aveHeart } };
      if (reading.aveResRate > 0) {
        patch.rrDaily = { ...this.getState().rrDaily, [dk]: reading.aveResRate };
        healthStore.upsertBackfillDay('rr', dk, reading.aveResRate);
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史日健康一览硬指标回填：原生 backfill 按日读离线血糖+血液成分，带 dateKey 回传，落库到 extDaily[date]。 */
  private handleHealthGlanceDay = (raw: {
    date?: string;
    bloodSugar?: number;
    bloodFat?: number;
    triglyceride?: number;
    hdl?: number;
    ldl?: number;
    uricAcid?: number;
    // ★ 原生 backfillDayHealthGlance 已从原始数据回传 stress/met/fatigue/snsActivation 历史（9-3 rawStress n=6 s=15.5）
    stress?: number;
    fatigue?: number;
    snsActivation?: number;
    met?: number;
    cortisol?: number;
    emotion?: number;
    skin?: number;
  }) => {
    try {
      if (!raw || !raw.date) return;
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      const fields: Record<string, number | null> = {
        bloodSugar: num(raw.bloodSugar),
        bloodFat: num(raw.bloodFat),
        triglyceride: num(raw.triglyceride),
        hdl: num(raw.hdl),
        ldl: num(raw.ldl),
        uricAcid: num(raw.uricAcid),
        stress: num(raw.stress),
        fatigue: num(raw.fatigue),
        snsActivation: num(raw.snsActivation),
        met: num(raw.met),
        cortisol: num(raw.cortisol),
        emotion: num(raw.emotion),
        skin: num(raw.skin),
      };
      const clean: Record<string, number> = {};
      (Object.keys(fields) as string[]).forEach((k) => {
        const v = fields[k];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) clean[k] = v;
      });
      if (Object.keys(clean).length === 0) return; // 当日无离线 HealthGlance 不落库
      const curExt = this.getState().extDaily;
      const prevDay = curExt[dk] ?? {};
      postLog('JS', `[handleHealthGlanceDay] date=${date} keys=${Object.keys(clean).join(',')}`);
      for (const [k, val] of Object.entries(clean)) {
        const hk = hsKeyFor(k);
        if (hk) healthStore.upsertBackfillDay(hk, dk, val);
      }
      this.push({ extDaily: { ...curExt, [dk]: { ...prevDay, ...clean } } });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日光电血压回填：原生 backfill 读 Blood 表（veepooSDKGetBloodData），带 dateKey 回传 sys/dia。
   *  落库到 healthStore(bpSys/bpDia) + 旧 extDaily 兼容镜像。原生未 emit onBpDay 时静默。 */
  private handleBpDay = (raw: { date?: string; sys?: number; dia?: number }) => {
    try {
      if (!raw || !raw.date) return;
      const dk = dateKeyOfStr(String(raw.date));
      const sys = num(raw.sys);
      const dia = num(raw.dia);
      if (sys == null || dia == null || sys <= 0 || dia <= 0) return;
      healthStore.upsertBackfillDay('bpSys', dk, sys);
      healthStore.upsertBackfillDay('bpDia', dk, dia);
      const curExt = this.getState().extDaily;
      const prevDay = curExt[dk] ?? {};
      this.push({ extDaily: { ...curExt, [dk]: { ...prevDay, bpSys: sys, bpDia: dia } } });
      postLog('JS', `[handleBpDay] date=${raw.date} sys=${sys} dia=${dia}`);
    } catch {
      /* 静默 */
    }
  };

  /** 历史日逐 slot 批量回填（原生从 VPDataBaseOperation veepooSDKGetOriginalDataWithDate 收集）。
   *  把当天所有 5-min slot 分别 upsert 到各指标的 intraday → 趋势图可画。 */
  private handleBackfillDaySlots = (raw: any) => {
    try {
      if (!raw?.date) { postLog('JS', '[handleBackfillDaySlots] ❌ no date, skip'); return; }
      const dk = dateKeyOfStr(String(raw.date));
      const map: Record<string, Array<{ t: number; v: number }> | undefined> = {
        hr: raw.hr, bpSys: raw.bpSys, bpDia: raw.bpDia,
        steps: raw.steps, calorie: raw.calorie, distance: raw.distance,
        stress: raw.stress, met: raw.met,
      };
      for (const [key, arr] of Object.entries(map)) {
        if (Array.isArray(arr) && arr.length > 0) {
          const cleaned = arr.filter(p => Number.isFinite(p.v) && p.v > 0);
          if (cleaned.length > 0) {
            healthStore.upsertBackfillSamples(key as any, dk, cleaned);
          }
        }
      }
      postLog('JS', `[handleBackfillDaySlots] date=${raw.date} slots=${
        ['hr','bpSys','bpDia','steps','calorie','distance','stress','met']
          .map(k => `${k}=${(raw as any)[k]?.length ?? 0}`).join(' ')
      }`);
    } catch { /* 静默 */ }
  };

  /** 历史日血液成分回填：原生 backfill 从 VPDailyBloodAnalysisModel 逐 5min 读回。
   *  samples 每项 = { time, triglyceride, hdl, ldl, totalCholesterol, uricAcid }
   *  healthStore 按 MetricKey 分别落 intraday 原始点，daily 取全天最后一个有效值。 */
  private handleBloodAnalysisDay = (raw: {
    date?: string;
    samples?: Array<Record<string, any>>;
  }) => {
    try {
      postLog('JS', `[handleBloodAnalysisDay] ENTRY rawKeys=${Object.keys(raw ?? {}).join(',')} date=${raw?.date} samples=${Array.isArray(raw?.samples) ? raw.samples.length : 'NOT_ARRAY'}`);
      // ★ 诊断：dump 第一个 sample 的原始字段
      const first = Array.isArray(raw?.samples) && raw.samples[0];
      postLog('JS', `[handleBloodAnalysisDay] SAMPLE[0] raw=${JSON.stringify(first).substring(0, 400)}`);
      if (first) {
        for (const k of Object.keys(first)) {
          const v = first[k];
          const n = num(v);
          postLog('JS', `[handleBloodAnalysisDay]   field ${k}=${JSON.stringify(v)} (type=${typeof v}, num()=${n})`);
        }
      }
      if (!raw?.date || !Array.isArray(raw.samples) || raw.samples.length === 0) {
        postLog('JS', `[handleBloodAnalysisDay] SKIP no date or empty samples. raw=${JSON.stringify(raw).substring(0, 300)}`);
        return;
      }
      const dk = dateKeyOfStr(String(raw.date));
      const dayKey = String(raw.date);
      const keys: { nativeKey: string; metricKey: string }[] = [
        { nativeKey: 'triglyceride', metricKey: 'triglyceride' },
        { nativeKey: 'hdl', metricKey: 'hdl' },
        { nativeKey: 'ldl', metricKey: 'ldl' },
        { nativeKey: 'totalCholesterol', metricKey: 'cholesterol' },
        { nativeKey: 'uricAcid', metricKey: 'ua' },
      ];
      // ★ 每个 metricKey 独立 push 一次，跟 handleHrSamples 模式完全一致
      for (const { nativeKey, metricKey } of keys) {
        const samples: Array<{ t: number; v: number }> = [];
        for (const s of raw.samples) {
          const v = num(s[nativeKey]);
          if (v == null || !Number.isFinite(v) || v <= 0) continue;
          const hm = String(s.time || '').split(':');
          const h = parseInt(hm[0], 10) || 0;
          const m = parseInt(hm[1], 10) || 0;
          const ms = new Date(`${dayKey}T00:00:00`).getTime() + (h * 3600 + m * 60) * 1000;
          samples.push({ t: ms, v });
        }
        if (samples.length > 0) {
          healthStore.upsertBackfillSamples(metricKey as any, dk, samples);
          const last = samples[samples.length - 1].v;
          healthStore.upsertBackfillDay(metricKey as any, dk, last);
          // ★ 完全照搬 handleHrSamples 模式
          const prevMetricByDay = this.getState().seriesByDay[metricKey] ?? {};
          const merged = mergeDaySeries(prevMetricByDay[dk], samples);
          const patch: StatePatch = {
            seriesByDay: {
              ...this.getState().seriesByDay,
              [metricKey]: { ...prevMetricByDay, [dk]: merged },
            },
          };
          this.push(patch);
          postLog('JS', `[handleBloodAnalysisDay] ✅ ${metricKey}/${nativeKey} date=${raw.date} n=${samples.length}`);
        } else {
          postLog('JS', `[handleBloodAnalysisDay] ⚠️ ${metricKey}/${nativeKey} date=${raw.date} parsed=0`);
        }
      }
      // ★ 同步诊断：所有 push 完成后立即确认 state
      try {
        const ak = Object.keys(this.getState().seriesByDay ?? {});
        postLog('JS', `[handleBloodAnalysisDay] ✅ ALL DONE seriesKeys now=${ak} date=${raw.date}`);
      } catch (e: any) {
        postLog('JS', `[handleBloodAnalysisDay] ❌ DONE ERR: ${e?.message ?? e}`);
      }
    } catch (e: any) {
      postLog('JS', `[handleBloodAnalysisDay] ❌ OUTER ERR: ${e?.message ?? e}`);
    }
  };

  /** 历史日 HRV 回填：原生 backfill 按日读 HRV 历史并带 dateKey 回传，这里落库到 hrvDaily。 */
  private handleHrvDay = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      postLog('JS', `[handleHrvDay] date=${raw.date} value=${raw.value}`);
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      if (!dk) { postLog('RingBle', `[handleHrvDay] 非法 date=${date}, 跳过`); return; }
      healthStore.upsertBackfillDay('hrv', dk, raw.value);
      const cur = this.getState().hrvDaily;
      const patch: StatePatch = { hrvDaily: { ...cur, [dk]: raw.value } };
      // 今日 HRV 立即落到 metrics.hrv / daily['hrv']，让「今日状态」种子（只用今日输入）即时可用，
      // 不必等 syncExtendedDaily 兜底链。todayKey 直接取墙钟今日（handleHrvDay 在内部类，无 bucketDay）。
      const todayKey = dayKeyOf(Date.now());
      if (dk === todayKey) {
        patch.metrics = { ...this.getState().metrics, hrv: raw.value };
        patch.daily = { ...this.getState().daily, hrv: raw.value };
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史日心率回填：原生 backfill 按天读心率历史并带 dateKey 回传，这里落库到 hrDaily。 */
  private handleHrDay = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
        postLog('RingBle', `[handleHrDay] 忽略非法事件 raw=${JSON.stringify(raw)}`);
        return;
      }
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      if (!dk) { postLog('RingBle', `[handleHrDay] 非法 date=${date}, 跳过`); return; }
      postLog('RingBle', `[handleHrDay] date=${date} dk=${dk} value=${raw.value}`);
      healthStore.upsertBackfillDay('hr', dk, raw.value);
      const cur = this.getState().hrDaily;
      const patch: StatePatch = { hrDaily: { ...cur, [dk]: raw.value } };
      // 今日心率立即落到 metrics.hr / daily['hr']，让「今日状态」与心率卡即时可用，
      // 不必等 syncExtendedDaily 兜底链。todayKey 直接取墙钟今日（handleHrDay 在内部类，无 bucketDay）。
      const todayKey = dayKeyOf(Date.now());
      if (dk === todayKey) {
        patch.metrics = { ...this.getState().metrics, hr: raw.value };
        patch.daily = { ...this.getState().daily, hr: raw.value };
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史/实时 HRV 连续样本：原生 backfill 把设备库「每分钟一条」的 HRV 样本（带 HH:MM）按天 emit 出来，
   *  这里把每天的样本合并进按天序列 seriesByDay['hrv']（跨天时间桶），历史日详情页即可画连续曲线。
   *  今日样本额外 ingest 进当日连续序列 history.hrv（实时趋势），并刷新卡片当前值。按 ts 去重避免重复。 */
  private handleHrvSamples = (raw: {
    date?: string;
    samples?: Array<{ t?: string | number; v?: number; hearts?: string[] }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) {
        console.log('[JS-HRV] SKIP: raw empty'); return;
      }
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dateKeyOfStr(date);
      const baseMs = dateKeyToStartMs(date);
      if (!Number.isFinite(baseMs)) return;
      const todayKey = dayKeyOf(Date.now());
      // 解析全部样本为带绝对 ts 的 TimePoint，按 ts 排序（兼容字符串 HH:mm 与数字 ms）
      const parsed: TimePoint[] = [];
      // ★ HRV 诊断：样本 t 的真实类型
      if (raw.samples.length > 0) {
        const s0 = raw.samples[0];
      }
      for (const s of raw.samples) {
        const v = num(s.v);
        if (v == null) continue;
        // 恢复原状

        if (v <= 0) continue;  // 0/负数都是占位符（生理指标不可能为0）
        const ts = sampleTimeMs(s.t, baseMs);
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);

      // ★ 展开 hearts（逐拍 RR 间期，每个值×10=ms）成密集 tachogram 点，填充 HRV 曲线。
      //   协议：hearts 即该次测量一分钟内的全部 RR 间期，是心率变异性的本来面目；
      //   单条 hrvValue 只是它的聚合，曲线只画一个点所以显得稀疏 —— 展开后曲线才连续。
      const hrvCurve: TimePoint[] = [];
      for (const s of raw.samples) {
        const baseTs = sampleTimeMs(s.t, baseMs);
        if (!Number.isFinite(baseTs)) continue;
        if (!Array.isArray(s.hearts) || s.hearts.length === 0) continue;
        let cum = 0;
        for (const rrStr of s.hearts) {
          const rr = Number(rrStr) * 10; // ms
          if (!Number.isFinite(rr) || rr <= 0 || rr > 3000) continue;
          const hr = 60000 / rr;
          if (hr < 30 || hr > 220) continue;
          hrvCurve.push({ t: baseTs + cum, v: Math.round(hr) });
          cum += rr;
        }
      }
      hrvCurve.sort((a, b) => a.t - b.t);

      // 按天存储设备返回的 HRV 聚合值；hearts 展开的 BPM 仅用于补全 HR，不写入 HRV。
      healthStore.upsertBackfillSamples('hrv', sampleDayKey, parsed);
      // ★ 从 HRV 的 hearts（RR 间期，每个值×10=ms）反推平均心率，补全睡眠期间 heartValue=0 的空缺
      const hrFromHrv: TimePoint[] = [];
      for (const s of raw.samples) {
        if (!Array.isArray(s.hearts) || s.hearts.length === 0) continue;
        const ts = sampleTimeMs(s.t, baseMs);
        if (!Number.isFinite(ts)) continue;
        let sum = 0, cnt = 0;
        for (const rrStr of s.hearts) {
          const rr = Number(rrStr) * 10; // ms
          if (!Number.isFinite(rr) || rr <= 0 || rr > 3000) continue;
          const hr = 60000 / rr;
          if (hr >= 30 && hr <= 220) { sum += hr; cnt++; }
        }
        if (cnt > 0) hrFromHrv.push({ t: ts, v: Math.round(sum / cnt) });
      }
      if (hrFromHrv.length > 0) {
        hrFromHrv.sort((a, b) => a.t - b.t);
        healthStore.upsertBackfillSamples('hr', sampleDayKey, hrFromHrv);
        const prevHrByDay = this.getState().seriesByDay['hr'] ?? {};
        const mergedHr = mergeDaySeries(prevHrByDay[sampleDayKey], hrFromHrv);
        const hrPatch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, hr: { ...prevHrByDay, [sampleDayKey]: mergedHr } } };
        this.push(hrPatch);
      }

      const prevByDay = this.getState().seriesByDay['hrv'] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, hrv: { ...prevByDay, [sampleDayKey]: merged } } };
      // 今日：额外喂实时连续序列（history.hrv）+ 卡片当前值（HRV 分数，来自聚合 hrvValue，不被 tachogram 污染）
      if (sampleDayKey === todayKey) {
        let scoreLatest: number | null = null;
        let scoreTs = this.lastHrvIngestTs;
        for (const p of parsed) {
          if (p.t <= this.lastHrvIngestTs) continue; // 今日去重：只 ingest 新样本
          // 走 pushMetric → applyMetric → ingest('hrv', v, ts)，进入当日连续序列（分数锚点）
          this.pushMetric({ key: 'hrv', value: p.v, unit: 'ms', ts: p.t });
          scoreLatest = p.v;
          scoreTs = p.t;
        }
        // 密集 tachogram 点也 ingest 进当日连续序列，让实时 HRV 曲线更密
        let maxCurveTs = this.lastHrvIngestTs;
        for (const p of hrvCurve) {
          if (p.t <= this.lastHrvIngestTs) continue;
          this.pushMetric({ key: 'hrv', value: p.v, unit: 'ms', ts: p.t });
          if (p.t > maxCurveTs) maxCurveTs = p.t;
        }
        if (scoreLatest != null) {
          this.lastHrvIngestTs = Math.max(scoreTs, maxCurveTs);
          // 末尾强制写回 HRV 分数，避免上面 tachogram 的 pushMetric 改写 metrics.hrv
          patch.metrics = { ...this.getState().metrics, hrv: scoreLatest };
          patch.daily = { ...this.getState().daily, hrv: scoreLatest };
        }
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史/离线心率连续样本：原生 backfill 把设备库「每 5/10 分钟一条」的 heartValue 样本（带 HH:MM）按天 emit 出来，
   *  这里把每天的样本合并进按天序列 seriesByDay['hr']（跨天时间桶），历史日详情页即可画连续心率曲线。
   *  今日样本额外 ingest 进当日连续序列 history.hr（实时趋势），并刷新卡片当前值。按 ts 去重避免重复。 */
  private handleHrSamples = (raw: {
    date?: string;
    samples?: Array<{ t?: string; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) {
        postLog('RingBle', `[handleHrSamples] 忽略空事件 raw=${JSON.stringify({ date: raw?.date, n: raw?.samples?.length })}`);
        return;
      }
      const date = String(raw.date); // yyyy-MM-dd 或 yyyy-M-d
      const dayBaseMs = dateKeyToStartMs(date);
      const sampleDayKey = Number.isNaN(dayBaseMs) ? dateKeyOfStr(date) : dayKeyOf(dayBaseMs);
      const todayKey = dayKeyOf(Date.now());
      postLog('RingBle', `[handleHrSamples] date=${date} dayKey=${sampleDayKey} today=${todayKey} samples=${raw.samples.length}`);
      // 解析全部样本为带绝对 ts 的 TimePoint，按 ts 排序
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const v = num(s.v);
        if (v == null) continue;
        // 恢复原状

        if (v <= 0) continue;  // 0/负数都是占位符（血糖/血压/血脂等生理指标不可能为0）
        const ts = parseSampleTs(date, s.t);
        if (ts == null || !Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      // 全部时间解析失败 → 兜底按测量序号均摊到当天，仍画出连续曲线（不再「无逐时明细」）
      if (parsed.length === 0 && raw.samples.length > 0) {
        const vals = raw.samples
          .map((s) => num(s.v))
          .filter((v): v is number => v != null && v > 0);
        if (vals.length > 0) {
          const tsArr = evenSpreadDay(date, vals.length);
          tsArr.forEach((ts, i) => parsed.push({ t: ts, v: vals[i] }));
          postLog('RingBle', `[handleHrSamples] ⚠️ 时间格式无法解析，已按序号均摊 date=${date} n=${vals.length}`);
        }
      }
      postLog('RingBle', `[handleHrSamples] parsed=${parsed.length} first=${parsed[0]?.t ?? '-'} last=${parsed[parsed.length - 1]?.t ?? '-'}`);
      // 9/3 专项：把真实收到的值打到日志服务，确认 ppgs 兜底取到的是真实 bpm（非波形噪声）。
      if (sampleDayKey === '2026-9-3') {
        postLog('HR_SEP3', `[HR_SEP3] 收到 ${parsed.length} 点: ` + parsed.map((p) => `${(p.v).toFixed(1)}@${new Date(p.t).toISOString().slice(11, 16)}`).join(', '));
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
      // 按天存储（所有回溯日都存）→ 历史日详情页画连续曲线
      healthStore.upsertBackfillSamples('hr', sampleDayKey, parsed);
      const prevByDay = this.getState().seriesByDay['hr'] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, hr: { ...prevByDay, [sampleDayKey]: merged } } };
      // 今日：额外喂实时连续序列（history.hr）+ 卡片当前值
      if (sampleDayKey === todayKey) {
        let latest: number | null = null;
        let latestTs = this.lastHrIngestTs;
        for (const p of parsed) {
          if (p.t <= this.lastHrIngestTs) continue; // 今日去重：只 ingest 新样本
          // 走 pushMetric → applyMetric → ingest('hr', v, ts)，进入当日连续序列
          this.pushMetric({ key: 'hr', value: p.v, unit: 'bpm', ts: p.t });
          latest = p.v;
          latestTs = p.t;
        }
        if (latest != null) {
          this.lastHrIngestTs = latestTs;
          patch.metrics = { ...this.getState().metrics, hr: latest };
          patch.daily = { ...this.getState().daily, hr: latest };
        }
      }
      this.push(patch);
      postLog('RingBle', `[handleHrSamples] 已存 seriesByDay.hr[${sampleDayKey}] n=${merged.length}`);
    } catch (e) {
      postLog('RingBle', `[handleHrSamples] 异常: ${e}`);
    }
  };

  /** 历史/离线血氧连续样本：原生 backfill 把设备库「每分钟一条」血氧样本（带 HH:MM）按天 emit 出来，
   *  合并进 seriesByDay['spo2']（跨天时间桶），历史日详情页即可画连续血氧曲线。
   *  实时血氧仍由 handleMetric 走 pushMetric 喂当日实时序列，这里只负责按天归档样本。 */
  private handleSpo2Samples = (raw: {
    date?: string;
    samples?: Array<{ t?: string | number; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dateKeyOfStr(date);
      const baseMs = dateKeyToStartMs(date);
      if (!Number.isFinite(baseMs)) return;
      const parsed: TimePoint[] = [];
      // ★ HRV 诊断：样本 t 的真实类型
      if (raw.samples.length > 0) {
        const s0 = raw.samples[0];
      }
      for (const s of raw.samples) {
        const v = num(s.v);
        if (v == null) continue;
        // 恢复原状

        if (v <= 0) continue;  // 0/负数都是占位符（生理指标不可能为0）
        const ts = sampleTimeMs(s.t, baseMs);
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
      healthStore.upsertBackfillSamples('spo2', sampleDayKey, parsed);
      const prevByDay = this.getState().seriesByDay['spo2'] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, spo2: { ...prevByDay, [sampleDayKey]: merged } } };
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史/离线体温连续样本：原生 backfill 把设备库「每 5 分钟一条」体温样本（带 hour/minute）按天 emit 出来，
   *  合并进 seriesByDay['temp']（跨天时间桶），历史日详情页即可画连续体温曲线。
   *  实时体温仍由 handleMetric 走 pushMetric 喂当日实时序列，这里只负责按天归档样本。 */
  private handleTempSamples = (raw: {
    date?: string;
    samples?: Array<{ t?: string | number; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dateKeyOfStr(date);
      const baseMs = dateKeyToStartMs(date);
      if (!Number.isFinite(baseMs)) return;
      const parsed: TimePoint[] = [];
      // ★ HRV 诊断：样本 t 的真实类型
      if (raw.samples.length > 0) {
        const s0 = raw.samples[0];
      }
      for (const s of raw.samples) {
        const v = num(s.v);
        if (v == null) continue;
        // 恢复原状

        if (v <= 0) continue;  // 0/负数都是占位符（生理指标不可能为0）
        const ts = sampleTimeMs(s.t, baseMs);
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
      healthStore.upsertBackfillSamples('temp', sampleDayKey, parsed);
      const prevByDay = this.getState().seriesByDay['temp'] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, temp: { ...prevByDay, [sampleDayKey]: merged } } };
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** ★ 通用：原生 veepooSDKGetOriginalDataWithDate 逐 slot emit 的全天序列存进 seriesByDay[signalKey]。
   *  signalKey 映射：stress / fatigue / snsActivation / met / steps / distance / calorie。 */
  private handleDayBucketSamples = (raw: {
    date?: string;
    samples?: Array<{ t?: any; v?: number }>;
  }, signalKey: string) => {
    try {
      // ★ 诊断：看原生传进来的 t 到底是什么类型
      if (signalKey === 'bpSys' || signalKey === 'bpDia') {
        const first = raw?.samples?.[0];
        // ★ 直接 dump healthStore，确认数据真进了 intraday
        setTimeout(() => {
          const hk = hsKeyFor(signalKey);
          const dk = dateKeyOfStr(String(raw?.date || ''));
          const ia = hk ? healthStore.getIntraday(hk, dk) : null;
          const dy = hk ? healthStore.getDay(hk, dk) : null;
        }, 100);
      }
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) {
        if (signalKey === 'bpSys') console.log('[DIAG-BP] raw empty! raw=', JSON.stringify(raw)?.substring(0, 200));
        return;
      }
      const date = String(raw.date);
      const sampleDayKey = dateKeyOfStr(date);
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const v = num(s.v);
        if (v == null) continue;
        // 恢复原状

        if (v <= 0) continue;  // 0/负数都是占位符（血糖/血压/血脂等生理指标不可能为0）
        const ts = parseSampleTs(date, s.t);
        if (ts == null || !Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) {
        postLog('RingBle', `[handleDayBucketSamples] ${signalKey} ${date} parsed=0 first_slotKey=${raw.samples[0]?.t}`);
        return;
      }
      parsed.sort((a, b) => a.t - b.t);
      const hsKey = hsKeyFor(signalKey);
      if (hsKey) healthStore.upsertBackfillSamples(hsKey, sampleDayKey, parsed);
      const prevByDay = this.getState().seriesByDay[signalKey] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = {
        seriesByDay: {
          ...this.getState().seriesByDay,
          [signalKey]: { ...prevByDay, [sampleDayKey]: merged },
        },
      };
      this.push(patch);  // ★ NativeRingSource 用 this.push，不是 this.applyPatch
      postLog("RingBle", `${signalKey.toUpperCase()} 日序列 ${date} n=${parsed.length}`);
    } catch (e) {
      postLog('RingBle', `[handleDayBucketSamples] ${signalKey} error: ${e}`);
    }
  };

  /** 设备能力上报（连接后原生 onPasswordVerified 推送）：ECG/BP/健康一览/皮电是否支持由固件决定。
   *  存进 state，供 UI/调试如实判断「心电/光电血压/抑郁风险」在当前戒指上能否测量。 */
  private handleDeviceCapabilities = (caps: {
    ecgType?: number; funcAssessmentType?: number; healthGlanceType?: number; supportManualTestType?: number;
  }) => {
    if (!caps) return;
    this.push({
      deviceCapabilities: {
        ecgType: num(caps.ecgType) ?? 0,
        funcAssessmentType: num(caps.funcAssessmentType) ?? 0,
        healthGlanceType: num(caps.healthGlanceType) ?? 0,
        supportManualTestType: num(caps.supportManualTestType) ?? 0,
      },
    });
  };

  /** 用真实睡眠时长合成整夜分期图（hypnogram）。
   *  HK18/QH15 精准睡眠模型只返回各阶段「时长」，不返回逐分钟分期；
   *  故按实测时长占比铺排典型睡眠周期（浅→深→浅→REM→短暂清醒），
   *  各阶段「时长占比」严格等于戒指实测值，仅夜内顺序为可视化惯例，不虚构测量数据。 */
  private synthesizeSleepStages(s: SleepSummary): SleepSegment[] {
    const total = Math.max(0, s.total);
    const deep = Math.max(0, s.deep);
    const light = Math.max(0, s.light);
    const rem = Math.max(0, s.rem);
    const awake = Math.max(0, total - deep - light - rem); // 清醒时长由总时长倒推
    if (total <= 0) return [];
    type B = { type: number; dur: number };
    const blocks: B[] = [];
    const push = (type: number, dur: number) => { if (dur > 0.5) blocks.push({ type, dur }); };
    push(4, awake * 0.35); // 入睡期清醒
    let dLeft = deep, lLeft = light, rLeft = rem, aLeft = awake * 0.65;
    let guard = 0;
    while ((dLeft > 0 || lLeft > 0 || rLeft > 0 || aLeft > 0) && guard < 60) {
      guard++;
      const l1 = Math.min(lLeft, 25); push(1, l1); lLeft -= l1;
      const d = Math.min(dLeft, 22); push(0, d); dLeft -= d;
      const l2 = Math.min(lLeft, 20); push(1, l2); lLeft -= l2;
      const r = Math.min(rLeft, 18); push(2, r); rLeft -= r;
      const a = Math.min(aLeft, 6); push(4, a); aLeft -= a;
    }
    if (aLeft > 0) push(4, aLeft);
    const rawSum = blocks.reduce((a, b) => a + b.dur, 0) || 1;
    let acc = 0;
    const segs: SleepSegment[] = blocks.map((b) => {
      const dur = (b.dur / rawSum) * total;
      const start = acc; acc += dur;
      return { type: b.type, start: Math.round(start), end: Math.round(acc) };
    });
    if (segs.length) segs[segs.length - 1].end = total;
    return segs;
  }

  /** 历史日睡眠回填：原生 backfill 读设备库睡眠，带 dateKey 回传，落库到 sleepDaily。
   *  原生现补发 sleepTime/wakeTime(协议 "MM-DD-HH-mm") 与 curve(每分钟 stage：0深睡/1浅睡/2REM/3失眠/4苏醒)，
   *  优先用真值曲线渲染 hypnogram，并把入睡/起床时间设成卡片显示串（"HH:mm"）。 */
  private handleSleepDay = (raw: {
    date?: string;
    total?: number;
    deep?: number;
    light?: number;
    rem?: number;
    score?: number;
    getUp?: number;
    sleepTime?: string;
    wakeTime?: string;
    curve?: number[];
    summary?: any;
    segments?: any[];
  }) => {
    try {
      if (!raw || !raw.date) return;
      const sm = raw.summary ?? raw;
      let total = num(sm.total) ?? 0;
      let deep  = num(sm.deep)  ?? 0;
      let light = num(sm.light) ?? 0;
      let rem   = num(sm.rem)   ?? 0;
      const sdkScore = num(sm.score) ?? 0;
      const getUp = num(sm.getUp) ?? 0;

      // ★ 如果有精准曲线（sleepLine 每分钟 stage），重新统计各阶段时长
      // 协议: 0=深睡 1=浅睡 2=REM 3=失眠 4=苏醒
      let awake = 0, insomnia = 0;
      if (Array.isArray(raw.curve) && raw.curve.length > 0) {
        const curve = raw.curve;
        deep = light = rem = awake = insomnia = 0;
        for (const s of curve) {
          switch (s) {
            case 0: deep++; break;
            case 1: light++; break;
            case 2: rem++; break;
            case 3: insomnia++; break;
            case 4: awake++; break;
          }
        }
        // total 以曲线为准
        total = curve.length;
      }

      if (total <= 0) return;

      // ★ 用 computeSleepScore 自算 0-100 分（替代 SDK 原始 0-5 分）
      const si: SleepInput = {
        sleepTotal: total,
        sleepDeep: deep,
        getUp,
      };
      const score = computeSleepScore(si, ALGO_DEFAULTS);

      const v: SleepSummary = {
        total, deep, light, rem,
        awake: awake || undefined,
        insomnia: insomnia || undefined,
        score,
        sdkScore: sdkScore || undefined,
        getUp,
        sleepTime: fmtSleepClock(raw.sleepTime),
        wakeTime: fmtSleepClock(raw.wakeTime),
      };
      const cur = this.getState().sleepDaily;
      // 生成段
      let segs: SleepSegment[];
      if (Array.isArray(raw.curve) && raw.curve.length) {
        segs = mergeSleepCurve(raw.curve);
      } else if (Array.isArray(raw.segments) && raw.segments.length) {
        segs = raw.segments
          .map((s: any) => ({ type: Number(s.type), start: Number(s.start), end: Number(s.end) }))
          .filter((s: any) => Number.isFinite(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end));
      } else {
        segs = this.synthesizeSleepStages(v);
      }
      const dk = dateKeyOfStr(String(raw.date));
      healthStore.recordSleep(dk, v);
      const patch: StatePatch = {
        sleepDaily: { ...cur, [dk]: v },
      };
      // ★ 每天都存 segments 到 sleepStagesDaily（按天归档），不再只存最新一天
      const prevStagesDaily = this.getState().sleepStagesDaily;
      const newStagesByDay = { ...prevStagesDaily };
      if (segs.length > 0) {
        newStagesByDay[dk] = segs;
      }
      patch.sleepStagesDaily = newStagesByDay;

      const curDate = this.getState().sleepSummaryDate;
      if (v.total > 0 && (!curDate || dk >= curDate)) {
        patch.sleepSummary = v;
        patch.sleepSummaryDate = dk;
        patch.sleepStages = segs.length ? segs : null; // InsightScreen 用
        const st = fmtSleepClock(raw.sleepTime);
        const wt = fmtSleepClock(raw.wakeTime);
        if (st) patch.sleepTime = st;
        if (wt) patch.wakeTime = wt;
      }
      postLog('JS-SLEEP', `handleSleepDay date=${raw.date} total=${total} deep=${deep} light=${light} rem=${rem} awake=${awake} insomnia=${insomnia} score=${score.toFixed(1)} sdkScore=${sdkScore}`);
      this.push(patch);
    } catch (e) {
    }
  };

  /** 历史日计步回填：原生 backfill 读设备库计步，带 dateKey 回传，落库到 stepDaily。 */
  private handleStepDay = (raw: any) => {
    try {
      if (!raw || !raw.date) return;
      const cur = this.getState().stepDaily;
      const v = {
        steps: num(raw.steps) ?? 0,
        distance: num(raw.distance) ?? 0,
        calorie: num(raw.calorie) ?? 0,
      };
      if (v.steps <= 0) return;
      const dk = dateKeyOfStr(String(raw.date));
      postLog('JS', `[handleStepDay] date=${raw.date} steps=${v.steps} dist=${v.distance} cal=${v.calorie}`);
      healthStore.upsertBackfillDay('steps', dk, v.steps);
      healthStore.upsertBackfillDay('distance', dk, v.distance);
      healthStore.upsertBackfillDay('calorie', dk, v.calorie);
      this.push({ stepDaily: { ...cur, [dk]: v } });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日血氧回填：原生 backfill 逐日查库读出当天血氧均值，落库到 spo2Daily。 */
  private handleSpo2Day = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      if (!dk) { postLog('RingBle', `[handleSleepDay] 非法 date=${date}, 跳过`); return; }
      if (!dk) { postLog('RingBle', `[handleHrvDay] 非法 date=${date}, 跳过`); return; }
      healthStore.upsertBackfillDay('spo2', dk, raw.value);
      const cur = this.getState().spo2Daily;
      const patch: StatePatch = { spo2Daily: { ...cur, [dk]: raw.value } };
      const todayKey = dayKeyOf(Date.now());
      // 今日血氧立即落到 metrics.spo2 / daily['spo2']，让实时流/今日状态即时可用
      if (dk === todayKey) {
        patch.metrics = { ...this.getState().metrics, spo2: raw.value };
        patch.daily = { ...this.getState().daily, spo2: raw.value };
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  /** 历史日体温回填：原生 backfill 逐日查库读出当天体温均值（℃），落库到 tempDaily。 */
  private handleTempDay = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      if (!dk) { postLog('RingBle', `[handleHrvDay] 非法 date=${date}, 跳过`); return; }
      healthStore.upsertBackfillDay('temp', dk, raw.value);
      const cur = this.getState().tempDaily;
      const patch: StatePatch = { tempDaily: { ...cur, [dk]: raw.value } };
      const todayKey = dayKeyOf(Date.now());
      // 今日体温立即落到 metrics.temp / daily['temp']，与实时 healthGlance 体温同源（℃）
      if (dk === todayKey) {
        patch.metrics = { ...this.getState().metrics, temp: raw.value };
        patch.daily = { ...this.getState().daily, temp: raw.value };
      }
      this.push(patch);
    } catch {
      /* 静默 */
    }
  };

  scan() { VeepooNative?.scan(); }
  stopScan() { VeepooNative?.stopScan(); }
  connect(id: string) { VeepooNative?.connect(id); }
  disconnect() { VeepooNative?.disconnect(); }
  setAutoMonitor(on: boolean) { VeepooNative?.setAutoMonitor(on); }
  measure(k: string) {
    if (k === 'ecg') {
      // ★ 开始新的 ECG 测量前，清掉残留 progress + 旧读数（避免显示上一次失败的 HRV=255/HR=0）
      this.push({ ecgProgress: null, ecg: null });
    }
    VeepooNative?.measure(k);
  }
  stopEcg() { VeepooNative?.stopEcg?.(); }
  flash() { VeepooNative?.findDevice(); }
  /** 重连后回填历史日数据（戒指离线期间累积的）：原生按日读 HRV 等历史并带日期回传。 */
  backfill() { VeepooNative?.backfill?.(); }
  /** 离线恢复：先 veepooSdkStartReadDeviceAllData 从戒指 flash 重拉最新离线数据，再逐日回填。 */
  recoverOffline() { VeepooNative?.recoverOffline?.(); }

  /**
   * 把「数据同步」开关推给原生：唯一控制 backfill 的来源（调试卡片不再参与控制）。
   * ★ 幂等：短时间内同值不重复下发（折叠日志风暴）。但**不永久锁定** —— 超过
   *   _SYNC_REPUSH_MS 后允许重发，避免「首次下发时原生 instance 还没就绪被 SKIP」
   *   导致状态永久不同步（表现为 native syncEnabled 一直 NO → backfill 全跳过、
   *   离线数据/步数不更新）。
   */
  setSyncEnabled(on: boolean) {
    // ★ 幂等折叠：同值且距上次下发不足 _SYNC_REPUSH_MS（30s）则跳过。
    //   原生 setSyncEnabled: 内部是 dispatch_async(main_queue)，高频重复下发会把主队列灌爆，
    //   诱发 LogBox 建面时同步等 UIManager 队列 → 主线程死锁 → 看门狗杀（0x8BADF00D）。
    //   保留 30s 兜底重发，防止原生实例重建后开关状态丢失把 backfill 永久锁死。
    const now = Date.now();
    if (_gLastNativeSyncEnabled === on && now - _gLastNativeSyncAt < _SYNC_REPUSH_MS) return;
    _gLastNativeSyncEnabled = on;
    _gLastNativeSyncAt = now;
    VeepooNative?.setSyncEnabled?.(on);
  }
  writeFemale(lastDate: string, cycle: number, days: number): Promise<void> {
    if (!VeepooNative || typeof (VeepooNative as any).writeFemale !== 'function') {
      // 运行中的原生包还没编译进 writeFemale（需 Clean Build + ⌘R），直接放行，不卡 UI
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const guard = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // 超时兜底：固件若不支持经期写入、SDK 不回调，8s 后直接放行，绝不卡住保存流程
      const timer = setTimeout(guard, 8000);
      try {
        Promise.resolve((VeepooNative as any).writeFemale(lastDate, cycle, days)).then(guard).catch(guard);
      } catch {
        guard();
      }
    });
  }
  refreshFemale() { VeepooNative?.readFemale(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 后端数据源（HTTP 客户端，作为回退 / 原型可用）
// ─────────────────────────────────────────────────────────────────────────────

interface BackendDevice {
  device_id: string;
  bound?: boolean;
  name?: string;
  model?: string;
  mac?: string;
  firmware?: string | null;
  battery?: number | null;
  connected?: boolean;
  last_sync_at?: number | null;
  sync_age_sec?: number | null;
}

interface BackendRecord {
  channel: string;
  ts: number;
  payload: Record<string, any>;
}

class BackendRingSource {
  private deviceId: string | null = null;
  private metricTimer: ReturnType<typeof setInterval> | null = null;
  private deviceTimer: ReturnType<typeof setInterval> | null = null;
  private autoMonitor = false;

  constructor(private push: (patch: StatePatch) => void) {}

  private async getJSON(path: string): Promise<any> {
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`后端返回 ${res.status} @ ${path}`);
    return res.json();
  }

  private async fetchChannel(deviceId: string, channel: string, from?: number): Promise<BackendRecord[]> {
    const qs = `device_id=${encodeURIComponent(deviceId)}&channel=${encodeURIComponent(channel)}${
      from != null ? `&from=${from}` : ''
    }`;
    const data = await this.getJSON(`/v1/ring/data?${qs}`);
    return Array.isArray(data?.records) ? (data.records as BackendRecord[]) : [];
  }

  private async refreshDevice() {
    try {
      const data = await this.getJSON(
        this.deviceId
          ? `/v1/ring/device?device_id=${encodeURIComponent(this.deviceId)}`
          : '/v1/ring/device'
      );
      const list: BackendDevice[] = Array.isArray(data?.devices) ? data.devices : [];
      const dev: BackendDevice | null = this.deviceId
        ? data?.bound === false
          ? null
          : (data as BackendDevice)
        : list.find((d) => d.bound) || list[0] || null;

      if (!dev) {
        this.push({
          status: 'idle',
          error: '后端暂无已绑定设备：请先在 MiraRingProbe 探针 App 连上 HK18 并同步',
          devices: list.map((d) => ({
            id: d.device_id,
            name: d.name || 'Mira Ring Pro',
            rssi: null,
            recommended: !!d.bound,
          })),
        });
        return;
      }
      this.deviceId = dev.device_id;
      this.push({
        status: 'connected',
        deviceName: dev.name || 'Mira Ring Pro',
        rssi: null,
        battery: num(dev.battery) ?? null,
        firmware: dev.firmware || null,
        protocol: 'Veepoo·后端',
        error: null,
        devices: list.map((d) => ({
          id: d.device_id,
          name: d.name || 'Mira Ring Pro',
          rssi: null,
          recommended: !!d.bound,
        })),
      });
      if (!dev.connected) {
        // eslint-disable-next-line no-console
        postLog('RingBle', '设备已绑定但最近未同步（探针未实时采集），仍展示已存真实数据。');
      }
    } catch (e: any) {
      this.push({
        status: 'error',
        error: `无法连接后端（${BACKEND_BASE_URL}）：${e?.message || '网络错误'}。请确认后端已启动且与手机同一 WiFi。`,
      });
    }
  }

  private async refreshMetrics() {
    if (!this.deviceId) return;
    const deviceId = this.deviceId;
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86_400;

    const [hrR, spo2R, breathR, gsrR, hgR, hrvR, autoR] = await Promise.allSettled([
      this.fetchChannel(deviceId, 'hr_realtime', dayAgo),
      this.fetchChannel(deviceId, 'spo2_realtime', dayAgo),
      this.fetchChannel(deviceId, 'breath_realtime', dayAgo),
      this.fetchChannel(deviceId, 'gsr'),
      this.fetchChannel(deviceId, 'health_glance'),
      this.fetchChannel(deviceId, 'hrv_history'),
      this.fetchChannel(deviceId, 'auto_data'),
    ]);

    const recs = (r: PromiseSettledResult<BackendRecord[]>): BackendRecord[] =>
      r.status === 'fulfilled' ? r.value : [];

    // 后端记录整条拉回（已按 dayAgo 限定为今日），直接转成 {t,v}[] 供全天趋势图使用。
    const toPts = (rs: BackendRecord[], fn: (r: BackendRecord) => number | null): TimePoint[] =>
      rs
        .map((r) => ({ t: r.ts, v: fn(r) }))
        .filter((p): p is TimePoint => p.v != null && Number.isFinite(p.v));

    const hrPts = toPts(recs(hrR), (r) => num(r.payload?.value));
    const spo2Pts = toPts(recs(spo2R), (r) => num(r.payload?.value));
    const breathPts = toPts(recs(breathR), (r) => num(r.payload?.value));
    const gsrPts = toPts(recs(gsrR), (r) => num(r.payload?.skin_moisture));
    const hgPts = toPts(recs(hgR), (r) => num(r.payload?.temp));
    const hrvPts = toPts(recs(hrvR), (r) => num(r.payload?.hrv_value));

    const hr = hrPts.length ? hrPts[hrPts.length - 1].v : null;
    const hgLatest = recs(hgR).length ? recs(hgR)[recs(hgR).length - 1].payload : null;
    const spo2FromRealtime = spo2Pts.length ? spo2Pts[spo2Pts.length - 1].v : null;
    const spo2 = spo2FromRealtime ?? num(hgLatest?.spo2) ?? null;
    const temp = hgPts.length ? hgPts[hgPts.length - 1].v : num(hgLatest?.temp) ?? null;

    const autoLatest = recs(autoR).length ? recs(autoR)[recs(autoR).length - 1].payload : null;
    const rrBreath = breathPts.length ? breathPts[breathPts.length - 1].v : null;
    const rrAuto = num(autoLatest?.sleep?.breath_avg) ?? null;
    const rr = rrBreath ?? rrAuto;

    const eda = gsrPts.length ? gsrPts[gsrPts.length - 1].v : null;
    const hrv = hrvPts.length ? hrvPts[hrvPts.length - 1].v : null;
    const metrics: RingMetrics = { hr, spo2, temp, eda, hrv, rr };

    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    const availability: Record<MetricKey, 'live' | 'syncing' | 'unavailable'> = {
      hr: hr != null ? 'live' : 'unavailable',
      spo2: spo2 != null ? 'live' : 'unavailable',
      temp: temp != null ? 'live' : 'unavailable',
      eda: eda != null ? 'live' : 'unavailable',
      hrv: hrv != null ? 'live' : 'unavailable',
      rr: rr != null ? 'live' : 'unavailable',
    };
    // 全天趋势最多保留 1440 点（≈每分钟 1 点），避免数组无限增长。
    const history: Record<MetricKey, TimePoint[]> = {
      hr: tail(hrPts, 1440),
      spo2: tail(spo2Pts, 1440),
      temp: tail(hgPts, 1440),
      eda: tail(gsrPts, 1440),
      hrv: tail(hrvPts, 1440),
      rr: tail(breathPts, 1440),
    };
    const lastUpdated: Record<MetricKey, number | null> = {
      hr: hr != null ? nowMs : null,
      spo2: spo2 != null ? nowMs : null,
      temp: temp != null ? nowMs : null,
      eda: eda != null ? nowMs : null,
      hrv: hrv != null ? nowMs : null,
      rr: rr != null ? nowMs : null,
    };
    this.push({ metrics, availability, history, lastUpdated });
  }

  async start() {
    this.stopTimers();
    await this.refreshDevice();
    if (this.deviceId) {
      await this.refreshMetrics();
      this.startTimers();
    }
  }

  setAutoMonitor(enabled: boolean) {
    this.autoMonitor = enabled;
    if (enabled && this.deviceId) this.startTimers();
    else this.stopMetricTimer();
  }

  measure() {
    if (this.deviceId) void this.refreshMetrics();
  }

  private startTimers() {
    if (!this.deviceId) return;
    if (!this.metricTimer) {
      this.metricTimer = setInterval(() => void this.refreshMetrics(), 10_000);
    }
    if (!this.deviceTimer) {
      this.deviceTimer = setInterval(() => void this.refreshDevice(), 30_000);
    }
  }

  private stopMetricTimer() {
    if (this.metricTimer) {
      clearInterval(this.metricTimer);
      this.metricTimer = null;
    }
  }


  private stopTimers() {
    this.stopMetricTimer();
    if (this.deviceTimer) { clearInterval(this.deviceTimer); this.deviceTimer = null; }
  }

  disconnect() {
    this.stopTimers();
    this.deviceId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 统一管理层
// ─────────────────────────────────────────────────────────────────────────────

class RingConnectionImpl {
  private _emotionTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<StateListener>();
  /** 同步进度订阅者（独立通道，见 SyncProgress 注释：刻意不走 emit，避免拖慢同步） */
  private syncProgressListeners = new Set<(p: SyncProgress | null) => void>();
  /** 「同步中」兜底定时器：太久没收到结束信号就自动清掉浮层 */
  private syncProgressTimer: ReturnType<typeof setTimeout> | null = null;
  private state: RingState = {
    status: 'idle',
    deviceName: null,
    rssi: null,
    battery: null,
    firmware: null,
    deviceId: null,
    metrics: { ...DEFAULT_METRICS },
    availability: { ...DEFAULT_AVAILABILITY },
    history: { ...EMPTY_HISTORY },
    lastUpdated: { ...DEFAULT_LAST_UPDATED },
    daily: {},
    dailyHistory: {},
    tempDaily: {},
    sleepStages: null,
    sleepStagesDaily: {},
    sleepSummary: null,
    sleepSummaryDate: null,
    sleepTime: null,
    wakeTime: null,
    female: null,
    hrvDaily: {},
    hrDaily: {},
    seriesByDay: {},
    deviceCapabilities: null,
    spo2Daily: {},
    edaDaily: {},
    rrDaily: {},
    sleepDaily: {},
    stepDaily: {},
  emotion: null as any,
    lastSyncedAt: null,
    lastBackfillAt: null,
    statusHistory: [],
    dailyCurve: null,
    curveStatus: null,
    statusTimeline: [],
    statusDaily: {},
    statusTimelineByDay: {},
    error: null,
    devices: [],
    flashing: false,
    flashResult: null,
    protocol: null,
    extDaily: {},
    ecg: null,
    ecgDaily: {},
    ecgHistory: [],
    lastUploadedAt: null,
    ecgProgress: null,
    dataVersion: 0,
  };
  private native: NativeRingSource;
  private backend: BackendRingSource;
  private useNative: boolean;
  private autoMonitor = false;
  /**
   * 「数据同步」总开关（持久化）：唯一控制 backfill 的来源。
   * true=开启（默认），连接成功时回填戒指历史数据；false=关闭，连接后不自动回填。
   * 设置页「数据同步」开关即此字段；调试卡片不再触发控制，仅作诊断展示。
   */
  private syncEnabled = true;
  private syncFlagLoaded = false;
  /** 身体成分档案（身高/体重/年龄/性别）：录入后下发戒指，健康一览才会返回身体成分字段。 */
  private userProfile: { weight: number; height: number; age: number; sex: number } | null = null;
  private pendingMetrics: MetricEvent[] | null = null;
  private metricFlushQueued = false;
  /** 心跳时间戳滑动窗口：收集逐拍时间戳，用于反算 HRV（RMSSD） */
  private hrBeatQueue: number[] = [];
  /** HRV 反算窗口：最近 30 分钟的心跳数据足够算出稳定 RMSSD */
  private static readonly HR_BEAT_WINDOW_MS = 30 * 60 * 1000;
  /** HRV 趋势重算节流：原生每 20 秒从设备拉一次 HRV 历史，这里只控制 UI 侧重算频率 */
  private static readonly HRV_COMPUTE_INTERVAL_MS = 5 * 60 * 1000;
  /** HRV 来源开关：true=用设备库每分钟样本（onHrvSamples），false=旧的「实时反算」（已停用）。
   *  原生实时心率回调 veepooSDKTestHeartStart 仅回传平均 BPM、无逐拍 R-R 间期，拿它算 RMSSD 是伪 HRV，
   *  会污染 metrics.hrv / history.hrv，故默认关闭。 */
  private static readonly HRV_USE_DEVICE_LIBRARY = true;
  private lastHrvComputeTs = 0;
  /** 节流后的心跳计数（调试用） */
  private hrBeatCount = 0;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCurveAccumTs: number | null = null;
  /** 用户在 App 内手动记录的经期（本地 cycleLog 文件），作为相位的权威兜底来源 */
  private localCycle: CycleLog | null = null;

  // ── 全天时间槽聚合存储：原生实时流高频到达，先落入"今日时间槽"，再派生 history 供卡片绘制 ──
  private bucketDay = '';
  private dayStart = dayStartMs(Date.now());
  private dayBuckets: Record<MetricKey, Map<number, { sum: number; count: number; last: number }>> = {
    hr: new Map(),
    spo2: new Map(),
    temp: new Map(),
    eda: new Map(),
    hrv: new Map(),
    rr: new Map(),
  };

  // 扩展指标（血糖/血脂/尿酸/压力/疲劳/情绪/皮肤/皮质醇等）的 15 分钟时间槽，
  // 与核心指标同宽（SLOT_MS），让这些原本只存"最新 1 点"的信号也能画出全天趋势曲线。
  private extBuckets: Record<string, Map<number, { sum: number; count: number; last: number }>> = {};

  /** 跨天则清空所有槽，并把 dayStart 指向今天 0 点 */
  private ensureDay(ts: number) {
    const k = dayKeyOf(ts);
    if (k !== this.bucketDay) {
      // 跨天：把「昨天」各核心指标的日均归档进各自的 *Daily 存储，供多日趋势/详情页跨天累积
      const prev = this.bucketDay;
      if (prev) {
        const dailyPatch: Partial<RingState> = {};
        const coreMean = (key: MetricKey): number | null => {
          const m = this.dayBuckets[key];
          if (!m || m.size === 0) return null;
          let s = 0, c = 0;
          m.forEach((e) => {
            s += e.sum;
            c += e.count;
          });
          return c > 0 ? s / c : null;
        };
        const hr = coreMean('hr');
        const spo2 = coreMean('spo2');
        const temp = coreMean('temp');
        const eda = coreMean('eda');
        const hrv = coreMean('hrv');
        const rr = coreMean('rr');
        if (hr != null) dailyPatch.hrDaily = { ...this.state.hrDaily, [prev]: hr };
        if (spo2 != null) dailyPatch.spo2Daily = { ...this.state.spo2Daily, [prev]: spo2 };
        if (temp != null) dailyPatch.tempDaily = { ...this.state.tempDaily, [prev]: temp };
        if (eda != null) dailyPatch.edaDaily = { ...this.state.edaDaily, [prev]: eda };
        if (hrv != null) dailyPatch.hrvDaily = { ...this.state.hrvDaily, [prev]: hrv };
        if (rr != null) dailyPatch.rrDaily = { ...this.state.rrDaily, [prev]: rr };
        if (Object.keys(dailyPatch).length) this.state = { ...this.state, ...dailyPatch };
      }
      this.bucketDay = k;
      this.dayStart = dayStartMs(ts);
      for (const key of Object.keys(this.dayBuckets) as MetricKey[]) this.dayBuckets[key].clear();
      for (const key of Object.keys(this.extBuckets)) this.extBuckets[key].clear();
      this.hrBeatQueue = []; // 跨天清空心跳队列，HRV 按日重置
    }
  }

  /**
   * 从「当日」时间槽反推各核心指标的当日日均，写入各自 *Daily[bucketDay]。
   *
   * 稳健性目标：不只在跨天瞬间（ensureDay）写「昨日」，而是每次调用都确保「当日」落档——
   * 这样即使 App 没在午夜开着、或被强制杀掉，只要当天采过样，当日日均就不会丢。
   * 另外把 hrv/rr 的「今天」也一并写入（此前 hrv/rr 要等跨天才进 *Daily，导致今天在详情页看不见）。
   * 在 flushPendingMetrics / saveSnapshot / loadPersisted(reconcile) 三处调用，覆盖「运行期 / 落盘前 / 重启恢复后」。
   */
  private syncDailyFromBuckets(): void {
    if (!this.bucketDay) return;
    const coreMean = (key: MetricKey): number | null => {
      const m = this.dayBuckets[key];
      if (!m || m.size === 0) return null;
      let s = 0, c = 0;
      m.forEach((e) => {
        s += e.sum;
        c += e.count;
      });
      return c > 0 ? s / c : null;
    };
    const hrDaily = { ...this.state.hrDaily };
    const spo2Daily = { ...this.state.spo2Daily };
    const tempDaily = { ...this.state.tempDaily };
    const edaDaily = { ...this.state.edaDaily };
    const hrvDaily = { ...this.state.hrvDaily };
    const rrDaily = { ...this.state.rrDaily };
    const hr = coreMean('hr');
    if (hr != null) hrDaily[this.bucketDay] = hr;
    const spo2 = coreMean('spo2');
    if (spo2 != null) spo2Daily[this.bucketDay] = spo2;
    const temp = coreMean('temp');
    if (temp != null) tempDaily[this.bucketDay] = temp;
    const eda = coreMean('eda');
    if (eda != null) edaDaily[this.bucketDay] = eda;
    const hrv = coreMean('hrv');
    if (hrv != null) hrvDaily[this.bucketDay] = hrv;
    const rr = coreMean('rr');
    if (rr != null) rrDaily[this.bucketDay] = rr;
    this.state = { ...this.state, hrDaily, spo2Daily, tempDaily, edaDaily, hrvDaily, rrDaily };
  }

  /** 增量写入一个样本到对应时间槽（高频采样自动按槽均值聚合） */
  private ingest(key: MetricKey, value: number, ts: number) {
    this.ensureDay(ts);
    // 反算 HRV：只有 HR 走这里，逐拍时间戳累积 → RMSSD
    if (key === "hr") {
      this.hrBeatQueue.push(ts);
      this.hrBeatCount++;
      // 滑动窗口：只保留最近 30 分钟的心跳
      const cutoff = ts - RingConnectionImpl.HR_BEAT_WINDOW_MS;
      while (this.hrBeatQueue.length > 0 && this.hrBeatQueue[0] < cutoff) {
        this.hrBeatQueue.shift();
      }
    }
    const slot = Math.floor((ts - this.dayStart) / SLOT_MS);
    const b = this.dayBuckets[key];
    const cur = b.get(slot);
    if (cur) {
      cur.sum += value;
      cur.count += 1;
      cur.last = value;
    } else {
      b.set(slot, { sum: value, count: 1, last: value });
    }
  }

  /** 由时间槽派生出今日有序的 {t,v} 点序列（t = 槽内时间中点对应的整点时刻 ms） */
  private deriveHistory(key: MetricKey): TimePoint[] {
    const b = this.dayBuckets[key];
    const slots = Array.from(b.keys()).sort((a, c) => a - c);
    return slots.map((s) => {
      const e = b.get(s)!;
      return { t: this.dayStart + s * SLOT_MS, v: e.sum / e.count };
    });
  }

  private deriveAllHistories(): Record<MetricKey, TimePoint[]> {
    return {
      hr: this.deriveHistory('hr'),
      spo2: this.deriveHistory('spo2'),
      temp: this.deriveHistory('temp'),
      eda: this.deriveHistory('eda'),
      hrv: this.deriveHistory('hrv'),
      rr: this.deriveHistory('rr'),
    };
  }

  /** 扩展指标增量写入 15 分钟时间槽（与核心指标同宽，自动按槽均值聚合） */
  private ingestExt(key: string, value: number, ts: number) {
    this.ensureDay(ts);
    const slot = Math.floor((ts - this.dayStart) / SLOT_MS);
    let b = this.extBuckets[key];
    if (!b) {
      b = new Map();
      this.extBuckets[key] = b;
    }
    const cur = b.get(slot);
    if (cur) {
      cur.sum += value;
      cur.count += 1;
      cur.last = value;
    } else {
      b.set(slot, { sum: value, count: 1, last: value });
    }
  }

  /** 由扩展指标时间槽派生出今日有序的 {t,v} 点序列（每槽一个均值点） */
  private deriveExtHistory(key: string): TimePoint[] {
    const b = this.extBuckets[key];
    if (!b || b.size === 0) return [];
    const slots = Array.from(b.keys()).sort((a, c) => a - c);
    return slots.map((s) => {
      const e = b.get(s)!;
      return { t: this.dayStart + s * SLOT_MS, v: e.sum / e.count };
    });
  }

  constructor() {
    this.native = new NativeRingSource(
      (patch) => this.applyPatch(patch),
      (m) => this.applyMetric(m),
      () => this.state,
      () => this.flushNow(),
      () => {
        postLog('RingBle', '[JS] callback: rebuild + saveSnapshot');
        // ★ 先清历史垃圾 key（如 2083-05-xx），再重建
    this.purgeInvalidDateKeys();
    this.rebuildHistoricalStatus();
        this.recomputeDailyStatus();
        this.syncExtendedDaily();
        this.ensureDay(Date.now());
        void this.saveSnapshot();
      },
      // 同步进度回调 → 独立轻量通道（底部「正在同步数据 x%」浮层订阅它）
      (p) => this.pushSyncProgress(p)
    );
    this.backend = new BackendRingSource((patch) => this.applyPatch(patch));

    const wantNative = RING_DATA_SOURCE === 'native';
    this.useNative = wantNative && this.native.available;
    if (wantNative && !this.native.available) {
      // eslint-disable-next-line no-console
      postLog('RingBle', '原生 VeepooRing 模块不可用（非 iOS 真机或未 prebuild），回退后端客户端。');
    }
    this.state.protocol = this.useNative ? 'Veepoo·原生' : 'Veepoo·后端';
    // 跨 ⌘R 保留真实数据：启动时异步恢复本地快照（沙盒文件），戒指重连前的空窗期也能看到趋势
    void this.loadPersisted();
    // 恢复「数据同步」开关（独立于快照，确保开关状态总能落盘）
    void this.loadSyncFlag();
    // 读取用户在 App 内手动记录的经期（本地 cycleLog），相位计算据此兜底，避免"记了却显示未记录"
    void this.refreshLocalCycle();
    // 今日状态时间线：对齐「整点 / 整半点」墙钟边界落快照（用户要求 12:00/12:30 出值），
    // 而非从 App 启动时刻起算的 30 分钟漂移，保证每次结果都精确落在 :00 或 :30。
    this.scheduleStatusTick();
    // healthStore 是独立数据源，写入不经过 RingState。订阅其变更 → 节流触发一次「调和」
    // （重建首页趋势 + 投影洞察指标 + 单次 emit）。
    // 原实现每次写入都 applyPatch({dataVersion})→emit()，有两个致命问题：
    //  (a) dataVersion 不满足 rebuild 触发条件，趋势/卡片永远不刷新（离线回传后首页空白）；
    //  (b) 每条样本触发一次全量重渲染，实时采集时造成「自动测量开关卡顿」等性能问题。
    // 改为节流（≥500ms 一次）+ 单次 emit，既保证数据回传后 UI 刷新，又消除重渲染风暴。
    healthStore.subscribe(() => {
      // 节流调和前打一条近 1H 诊断（只在前 3 次打，避免刷屏）
      if (!this._hsDiagCount) this._hsDiagCount = 0;
      if (this._hsDiagCount < 3) {
        this._hsDiagCount++;
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        const tk = dayKeyOf(now);
        const hrRecent = healthStore.getIntraday('hr', tk).filter((p: any) => p.t >= oneHourAgo).length;
        const hrvRecent = healthStore.getIntraday('hrv', tk).filter((p: any) => p.t >= oneHourAgo).length;
        const edaRecent = healthStore.getIntraday('eda', tk).filter((p: any) => p.t >= oneHourAgo).length;
        const tlRecent = this.state.statusTimeline.filter((p: any) => p.t >= oneHourAgo).length;
      }

      this.scheduleHsReconcile();
    });

    // ★ Emotion engine: 独立 30s 定时器 (数据源无关)
    setTimeout(() => this.computeAndPushEmotion(), 500);
    this._emotionTimer = setInterval(() => this.computeAndPushEmotion(), 30_000);
  }

  /** ★ Emotion engine — 30s 定时计算情绪快照 (arousal + valence + 5类) */
  private computeAndPushEmotion = () => {
    try {
      if (this.state.status !== 'connected') {
        this.applyPatch({ emotion: null });
        return;
      }
      const snap = computeEmotionSnapshot(Date.now(), this.resolveCycle());
      if (snap) {
        this.applyPatch({
          emotion: {
            arousalScore: snap.arousalScore,
            valenceScore: snap.valenceScore,
            emotionLabel: snap.emotionLabel,
            scrPeaksPerMin: snap.scrPeaksPerMin,
            scrMeanAmp: snap.scrMeanAmp,
            reason: snap.reason,
            updatedAt: snap.t,
            cyclePhase: (snap as any).cyclePhase ?? 'unknown',
          },
        } as StatePatch);
        _emotionHistoryArr.push({
          t: snap.t,
          arousalScore: snap.arousalScore,
          valenceScore: snap.valenceScore,
          emotionLabel: snap.emotionLabel,
        });
        if (_emotionHistoryArr.length > 200) _emotionHistoryArr.shift();

        postLog('RingBle', '[Emotion] OK label=' + snap.emotionLabel
          + ' a=' + snap.arousalScore.toFixed(0)
          + ' v=' + snap.valenceScore.toFixed(0));
      } else {
        this.applyPatch({ emotion: null });
        postLog('RingBle', '[Emotion] NULL');
      }
    } catch (e) {
      postLog('RingBle', '[Emotion] FAILED: ' + (e as Error).message);
    }
  };

  private emit() {
    this.scheduleSave();
    for (const fn of this.listeners) fn(this.state);
  }

  /** 把下一个状态快照对齐到墙钟的 :00 或 :30 边界（递归 setTimeout，每跳一次重新对齐下一边界）。 */
  private scheduleStatusTick() {
    const now = Date.now();
    const d = new Date(now);
    const min = d.getMinutes();
    const sec = d.getSeconds();
    const ms = d.getMilliseconds();
    // ★ 断连重连时立即补打最近的边界点（如果 gap >= 30min）
    // 比如 13:10 重连，立即补打 13:00 的点；不用等 13:30
    const boundaryTs = this.alignBoundaryTs(now);
    if (this.lastCurveAccumTs != null && boundaryTs - this.lastCurveAccumTs >= STATUS_SNAPSHOT_MS) {
      postLog('RingBle', `[scheduleStatusTick] ⚡ 补打错过的边界: ${new Date(boundaryTs).toISOString().slice(11,16)} (gap=${Math.round((boundaryTs - this.lastCurveAccumTs)/60000)}min)`);
      this.recomputeDailyStatus(boundaryTs, true); // 用 boundaryTs 而非 now，保证 pushStatusPoint 的 t 对齐
    }
    // 距下一个 :00 / :30 边界的毫秒数（相对整点的分钟：<30→30，否则下个整点 60）
    const nextBoundaryMin = min < 30 ? 30 : 60;
    let delay = (nextBoundaryMin - min) * 60_000 - sec * 1000 - ms;
    if (delay < 0) delay += 30 * 60_000;
    if (delay > 30 * 60_000) delay = 30 * 60_000;
    this.statusTimer = setTimeout(() => {
      this.recomputeDailyStatus(Date.now(), true); // force：边界必出一点（若有数据）
      this.scheduleStatusTick(); // 重新对齐下一边界
    }, delay);
  }

  private clearStatusTimer() {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private applyPatch(patch: StatePatch) {
    // ★ 边沿检测：必须在 this.state 被合并【之前】取旧值，用于判断「是否刚刚连上」。
    const prevStatus = this.state.status;
    // eslint-disable-next-line no-console
    if (patch.status) console.log('[DIAG] applyPatch status:', patch.status);
    // ★ 诊断：seriesByDay push 内容
    if (patch.seriesByDay) {
      const keys = Object.keys(patch.seriesByDay);
      postLog('RingBle', `[applyPatch] 📦 seriesByDay PUSH keys=${keys}`);
    }
    this.state = { ...this.state, ...patch };
    // 连上戒指即自动开启原生「自动监测」（实时 HR/SpO₂ + 体温/皮电轮询 + HRV 历史读取），
    // 不再依赖用户在设置页手动拨开关——之前 autoMonitor 默认 false 且不持久化，
    // 重建/重连后原生 monitorOn 永远是 false，导致戒指一条数据都不传（collector.log 里 raw=0）。
    // ★ 只在「非 connected → connected」的边沿执行一次：patch.status 可能被高频重复携带，
    //   若每次都走这里，会把 setAutoMonitor/setSyncEnabled 打成日志风暴并灌爆主队列。
    if (patch.status === 'connected' && prevStatus !== 'connected') {
      this.state = { ...this.state, lastSyncedAt: Date.now() };
      if (this.useNative) {
        this.autoMonitor = true;
        this.native.setAutoMonitor(true);
        // ★ 复位幂等守卫 + 强制重新下发：原生实例可能刚重建（ensureSetup 会把 syncEnabled
        //   归 NO），这时必须推一次 true，不能被「值没变」的幂等守卫吞掉。
        resetSyncPushGuard();
        this.native.setSyncEnabled(true);
        // 身体成分档案：连上即把已录入的身高/体重/年龄/性别下发戒指，
        // 使健康一览能返回身体成分字段（bmi/体脂率/肌肉量/水分/骨量/基础代谢率…）。
        if (this.userProfile) this.applyUserProfile();
        // 仅在「数据同步」开关开启时，连接成功才触发历史回填；
        // 开关状态由设置页「数据同步」控制（RingBle.syncEnabled），调试卡片不参与控制。
        // ★ 无论 syncFlagLoaded 是否已加载都触发 backfill：
        // syncFlagLoaded=false 时 syncEnabled 是默认值 true（先跑起来），
        // 如果 FileSystem 持久化文件里 syncEnabled=false，下次 loadSyncFlag 完成
        // 后如果还是 connected 会自动调 recoverOffline 做重同步。
        if (this.syncEnabled) {
          // ★ 原生 setSyncEnabled: 内部是 dispatch_async(main_queue)（异步），紧跟其后的
          //   同步 backfill 会读到尚未落定的旧值（NO）而被「数据同步已关闭」跳过。
          //   延后一拍再跑，确保开关已真实生效。
          setTimeout(() => {
            try {
              if (this.syncEnabled) this.native.backfill();
            } catch {
              /* 静默：回填失败不影响连接 */
            }
          }, 400);
        }
      }
      // 状态快照定时器可能在上次断开时被清掉，重连后确保其运行（对齐 :00/:30 边界）
      if (!this.statusTimer) this.scheduleStatusTick();
    }
    // 经期数据变化 → 相位变化 → 重算今日状态（基线/叙事）。recompute 在 main 类上，
    // 故放此处（handleFemale 位于 NativeRingSource，拿不到 recompute）。
    if (patch.female !== undefined) this.recomputeDailyStatus();
    // 历史回填（HRV/睡眠/计步/健康一览/ECG）落地 → 反推过去每天的状态分，补全状态趋势的周/月/年历史；
    // extDaily/ecgDaily 来自健康一览+ECG 的实时测量与 backfill，同样需要投影进 daily/dailyHistory。
    // ⚠️ 关键防护：下方投影若抛异常，绝不能再吃掉 this.emit()——否则 state 已更新、但所有监听屏
    // （趋势图/卡片）永远收不到新 state，表现为「数据明明回了、趋势图却全空」。故 try/catch 后必 emit。
    if (
      patch.hrvDaily !== undefined ||
      patch.hrDaily !== undefined ||
      patch.sleepDaily !== undefined ||
      patch.stepDaily !== undefined ||
      patch.extDaily !== undefined ||
      patch.ecgDaily !== undefined
    ) {
      try {
        this.rebuildHistoricalStatus();
        this.syncExtendedDaily(); // 归档 → daily/dailyHistory 投影，修复「回填型卡片不更新」
        this.recomputeDailyStatus(); // 睡眠/HRV 归档落地后重算今日状态（解锁首页「今日状态」与全天状态趋势）
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        postLog('RingBle', `[applyPatch] 归档投影异常（已忽略，保证 UI 刷新）: ${msg}`);
      }
    }
    this.emit();
  }

  // ── healthStore → RingState 轻量调和（节流） ──────────────────────────────
  // 背景：healthStore 是唯一健康数据源，离线回填 / 实时采集都先写它；但首页「全天状态趋势」
  // 与洞察卡片读的是 RingState（statusTimeline / daily / metrics），其派生数据只由
  // rebuildHistoricalStatus / syncExtendedDaily 计算。
  // 原实现每次 healthStore 写入都 applyPatch({dataVersion})→emit()，既不会重建趋势
  // （dataVersion 不满足 rebuild 触发条件），又因每条样本触发一次全量重渲染，造成
  // 「自动测量开关卡顿」等性能问题；且原生 onBackfillComplete 事件实际并未回传
  // （全量日志 0 次），离线数据回传后趋势/卡片永远不刷新。
  // 现改为：healthStore 变更 → 节流（≥500ms 一次）→ 一次调和 + 单次 emit。
  private hsReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private hsReconcileLast = 0;

  private scheduleHsReconcile() {
    if (this.hsReconcileTimer) return; // 已排程，连续写入不叠加
    const MIN_GAP = 500;
    const sinceLast = Date.now() - this.hsReconcileLast;
    const delay = sinceLast >= MIN_GAP ? 0 : MIN_GAP - sinceLast;
    this.hsReconcileTimer = setTimeout(() => {
      this.hsReconcileTimer = null;
      this.hsReconcileLast = Date.now();
      this.reconcileFromHealthStore();
    }, delay);
  }

  private reconcileFromHealthStore() {
    try {
      this.rebuildHistoricalStatus(); // 今日/历史 statusTimeline 从 healthStore intraday 重建
      this.syncExtendedDaily();       // 投影 daily/metrics → 洞察卡片
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      postLog('RingBle', `[reconcileFromHealthStore] 异常（已忽略）: ${msg}`);
    }
    // 单次脏检查：详情/洞察页直接订阅 healthStore 会自刷；首页订阅 RingState，需此处 emit。
    const next = (this.state.dataVersion ?? 0) + 1;
    this.applyPatch({ dataVersion: next });
  }

  // ── HRV 主要取自设备历史库：原生 readHistoricalHrv 每 300s 调一次 backfillDayHrv
  //   （veepooSDKGetDeviceHrvDataWithDate:andTableID:，键 hrvValue，与 backfill 同一条已验证通路）并 emit onHrvDay。
  //   下方 flushPendingMetrics 仍保留「基于逐拍 HR 时间戳的 JS 反算」作为实时补充——
  //   仅当原生 HR 回调确为逐拍（相邻 ts 差≈真实 RR 间期）且有效 RR≥10 时才写，否则自动跳过，不污染数值。
  private applyMetric(m: MetricEvent) {
    postLog('JS', `[applyMetric] ENTER key=${m.key} v=${m.value} queued=${this.metricFlushQueued}`);
    if (!this.pendingMetrics) this.pendingMetrics = [];
    this.pendingMetrics.push(m);
    // 每 30 条打一次（避免 spam）
    if (this.pendingMetrics.length % 30 === 0) {
    }
    if (!this.metricFlushQueued) {
      this.metricFlushQueued = true;
      queueMicrotask(() => this.flushPendingMetrics());
    }
  }

  private flushPendingMetrics() {
    postLog('JS', `[flushPending] ENTER pending=${this.pendingMetrics?.length ?? 0} queued=${this.metricFlushQueued}`);
    this.metricFlushQueued = false;
    const batch = this.pendingMetrics;
    this.pendingMetrics = null;
    if (!batch || batch.length === 0) {
      postLog('JS', `[flushPending] SKIP empty batch`);
      return;
    }
    const metrics = { ...this.state.metrics };
    const availability: Record<string, 'live' | 'syncing' | 'unavailable'> = { ...this.state.availability };
    const lastUpdated: Record<string, number | null> = { ...this.state.lastUpdated };
    const daily = { ...this.state.daily };
    const dailyHistory = { ...this.state.dailyHistory };
    // 健康一览扩展指标 / 手动测量（血压/ECG）按天归档：extDaily[dateKey][key] = value
    // 供周/月/年跨天历史（realSeries 读取）。仅在今日有值才写，避免 null 污染归档。
    const extDaily = { ...this.state.extDaily };
    const bucketDay = this.bucketDay || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    postLog('JS', `[flushPending] batch=${batch.length} keys=[${batch.map(m=>m.key).join(',')}] bucketDay=${bucketDay}`);
    for (const m of batch) {
      if (CORE_KEYS.includes(m.key as MetricKey)) {
        const k = m.key as MetricKey;
        metrics[k] = m.value;
        this.ingest(k, m.value, m.ts ?? Date.now());
        healthStore.upsertRealtime(k, { t: m.ts ?? Date.now(), v: m.value });
        availability[k] = 'live';
        lastUpdated[k] = m.ts ?? Date.now();
        // ★ skin/eda 双写：native emit 'eda'（CORE_KEYS），但 UI 读 extDaily['skin']
        if (k === 'eda') {
          const prevDay = extDaily[bucketDay] ?? {};
          extDaily[bucketDay] = { ...prevDay, skin: m.value };
          healthStore.upsertRealtime('skin', { t: m.ts ?? Date.now(), v: m.value }, m.ts ?? Date.now());
          lastUpdated['skin'] = m.ts ?? Date.now();
          availability['skin'] = 'live';
        }
      } else {
        // 扩展指标：存最新值，并增量写入 15 分钟时间槽以累积全天趋势曲线
        daily[m.key] = m.value;
        const t = m.ts ?? Date.now();
        // ★ 关键修复：扩展指标也要写 lastUpdated + availability，否则 UI 显示"没更新"
        lastUpdated[m.key] = t;
        availability[m.key] = 'live';
        this.ingestExt(m.key, m.value, t);
        dailyHistory[m.key] = this.deriveExtHistory(m.key);
        // 按天归档（今日），供跨天历史（浅拷贝当天对象，避免改动旧 state 嵌套引用）
        const prevDay = extDaily[bucketDay] ?? {};
        extDaily[bucketDay] = { ...prevDay, [m.key]: m.value };
        const hk = hsKeyFor(m.key);
        if (hk) {
          // 之前只调了 upsertBackfillDay 写 daily 聚合，healthStore.intraday 为空 → trend 图画不出来。
          // 现在每次 HealthGlance 轮询（~60s）收到的单点都累积进 intraday → 全天曲线可画。
          healthStore.upsertRealtime(hk, { t, v: m.value }, t);
          // 同时追加到 manualMeasurements（血液成分类指标每次 HealthGlance 返回的都是最新测值）
          if (hk === 'triglyceride' || hk === 'hdl' || hk === 'ldl' || hk === 'cholesterol' || hk === 'ua') {
            healthStore.upsertManual(hk, bucketDay, m.value, t, 'healthGlance');
          }
        }
      }
    }
    // ★ HRV 来源修正：真 HRV 来自设备库 veepooSDKGetDeviceHrvDataWithDate 的每分钟样本
    //   （原生 onHrvSamples → TS handleHrvSamples → ingest 进 dayBuckets['hrv']）。
    //   原「实时反算」已停用：原生实时心率回调仅回传平均 BPM（无逐拍 R-R 间期），
    //   拿平均 BPM 的时间戳算 RMSSD 是伪 HRV，会污染 metrics.hrv / history.hrv，故关闭。
    if (!RingConnectionImpl.HRV_USE_DEVICE_LIBRARY) {
      const nowMs = Date.now();
      if (
        nowMs - this.lastHrvComputeTs >= RingConnectionImpl.HRV_COMPUTE_INTERVAL_MS &&
        this.hrBeatQueue.length >= 10
      ) {
        const hrvResult = computeHRV(this.hrBeatQueue);
        if (hrvResult.rmssd != null && hrvResult.rmssd >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN) {
          metrics.hrv = hrvResult.rmssd;
          this.ingest("hrv", hrvResult.rmssd, nowMs);
          healthStore.upsertRealtime('hrv', { t: nowMs, v: hrvResult.rmssd });
          this.hrBeatCount = this.hrBeatQueue.length;
          this.lastHrvComputeTs = nowMs;
        }
      }
    }
    // 体温：把今日日均写入 tempDaily（跨天累积，供周期双相曲线）
    const tempDaily = { ...this.state.tempDaily };
    const todayTemp = this.deriveHistory('temp');
    if (todayTemp.length) {
      const avg = todayTemp.reduce((s, p) => s + p.v, 0) / todayTemp.length;
      tempDaily[this.bucketDay] = avg;
      healthStore.upsertBackfillDay('temp', this.bucketDay, avg);
    }
    // 核心指标（心率/血氧/皮电）同样在 App 侧按天落库：每次 flush 把今日日均写入各自 *Daily，
    // 与跨天 ensureDay 写入「昨日」互补，保证详情页选「今日」也有真实值。
    // 固件本身不按天归档这些信号，所以由 App 在运行期间累积存储（持久化已于 loadPersisted 恢复）。
    const dailyMean = (key: MetricKey): number | null => {
      const arr = this.deriveHistory(key);
      if (!arr.length) return null;
      return arr.reduce((s, p) => s + p.v, 0) / arr.length;
    };
    const hrDaily = { ...this.state.hrDaily };
    const hrMean = dailyMean('hr');
    if (hrMean != null) { hrDaily[this.bucketDay] = hrMean; healthStore.upsertBackfillDay('hr', this.bucketDay, hrMean); }
    const spo2Daily = { ...this.state.spo2Daily };
    const spo2Mean = dailyMean('spo2');
    if (spo2Mean != null) { spo2Daily[this.bucketDay] = spo2Mean; healthStore.upsertBackfillDay('spo2', this.bucketDay, spo2Mean); }
    const edaDaily = { ...this.state.edaDaily };
    const edaMean = dailyMean('eda');
    if (edaMean != null) { edaDaily[this.bucketDay] = edaMean; healthStore.upsertBackfillDay('eda', this.bucketDay, edaMean); }
    this.state = {
      ...this.state,
      metrics,
      availability,
      lastUpdated,
      daily,
      dailyHistory,
      history: this.deriveAllHistories(),
      tempDaily,
      hrDaily,
      spo2Daily,
      edaDaily,
      extDaily,
      lastSyncedAt: Date.now(),
    };
    // [DIAG] lastUpdated 诊断
    try {
      const __nowMs = Date.now();
      const __lu = this.state.lastUpdated;
      const __fmt = (k: string) => {
        const t = (__lu as any)[k];
        if (!t) return k + '=MISSING';
        const diff = Math.round((__nowMs - t) / 1000);
        const h = new Date(t);
        return k + '=' + h.getHours().toString().padStart(2,'0') + ':' + h.getMinutes().toString().padStart(2,'0') + '(' + diff + 's前)';
      };
      postLog('JS', '[FLUSH-LU] ' + __fmt('hr') + ' ' + __fmt('spo2') + ' ' + __fmt('temp') + ' ' + __fmt('eda') + ' ' + __fmt('hrv'));
    } catch(_e) {}
    // [DIAG] stress/cortisol dailyHistory 状态
    try {
      const ns = dailyHistory['stress']?.length ?? 0;
      const nc = dailyHistory['cortisol']?.length ?? 0;
    } catch(e) {}
    // ★ 把扩展信号（stress/cortisol/emotion/skin/fatigue/bpSys/bpDia/bloodSugar/bloodFat/uricAcid/triglyceride/hdl/ldl/snsActivation）
    // 的实时均值也写入 extDaily[today] — 这样 MetricDetail 周/月/年视图的 dailyValueFor(sk) 就能取到值
    const EXT_SIGNAL_KEYS = [
      'stress', 'cortisol', 'emotion', 'skin', 'fatigue', 'snsActivation',
      'bpSys', 'bpDia', 'bloodSugar', 'bloodFat', 'uricAcid', 'triglyceride', 'hdl', 'ldl', 'met',
    ];
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    const curExt = { ...this.state.extDaily };
    const prevDay = curExt[todayKey] ?? {};
    let extDirty = false;
    for (const sk of EXT_SIGNAL_KEYS) {
      if (prevDay[sk] != null && prevDay[sk] > 0) continue;
      const m = (this.state.metrics as unknown as Record<string, number | null>)[sk];
      if (typeof m === 'number' && m > 0) {
        prevDay[sk] = m;
        const hk = hsKeyFor(sk);
        if (hk) healthStore.upsertBackfillDay(hk, todayKey, m);
        extDirty = true;
      }
    }
    if (extDirty) {
      curExt[todayKey] = prevDay;
      this.state = { ...this.state, extDaily: curExt };
    }

    this.emit();
    // 数据每次刷新后重算「今日状态」（晨间锚点 + 基线 + 归一化）
    this.recomputeDailyStatus();
    // 回填归档投影必须在每次 flush 后重派生：flush 会按 CORE_KEYS 重建 metrics（含 hrv），
    // 可能把历史日 HRV 兜底层冲掉；此处用归档重新断言，保证「回填型卡片」持续有值。
    this.syncExtendedDaily();
    // 确保「当日」各核心指标日均落档（含 hrv/rr 今天），不依赖跨天瞬间，避免当天被丢
    this.syncDailyFromBuckets();

  }

  /**
   * 回填归档 → 当日快照&序列 投影（修复「很多数据不更新」）。
   *
   * 根因：原生 backfill 把步数/睡眠/HRV 写进 stepDaily/sleepDaily/hrvDaily 归档，
   * 但 InsightScreen 与 AI 摘要只消费 ring.daily[...] / ring.dailyHistory[...]。
   * 之前缺这一步投影，导致所有回填型卡片（步数/距离/消耗/睡眠总时长/深睡/REM/评分/HRV）
   * 永远读 null → 显示"—"。
   *
   * 注意：只投影到 daily / dailyHistory / metrics.hrv —— 不碰 history（deriveAllHistories
   * 每次 flush 都从核心 ingest 重建 history，会把我写的 history.hrv 清掉）。
   * daily / dailyHistory / metrics 在 flush 里都是 spread 复制，本函数写入的键不会被冲刷掉。
   */
  private syncExtendedDaily() {
    const st = this.state;
    const daily = { ...st.daily };
    const metrics = { ...st.metrics };
    const dailyHistory = { ...st.dailyHistory };
    const hrvDaily = { ...st.hrvDaily };
    const hrDaily = { ...st.hrDaily };
    const availability = { ...st.availability };

    // 今日 key：优先 bucketDay（与归档同格式 'YYYY-M-D'），未初始化时回退当天
    const today =
      this.bucketDay || dayKeyOf(Date.now());

    const step = st.stepDaily[today];
    if (step) {
      daily['steps'] = step.steps;
      daily['distance'] = step.distance;
      daily['calorie'] = step.calorie;
    }
    const sleep = st.sleepDaily[today];
    if (sleep && sleep.total > 0) {
      daily['sleepTotal'] = sleep.total; // 分钟（SleepStructureCard fallbackTotalMinutes 期望分钟）
      daily['sleepDeep'] = Math.round((sleep.deep / sleep.total) * 100); // %
      daily['sleepRem'] = Math.round((sleep.rem / sleep.total) * 100); // %
      daily['sleepScore'] = sleep.score;
    }
    // HRV：优先用历史日归档；原生实时 HRV 走 emitMetric 实时流（落 metrics.hrv / history.hrv），
    // 若归档缺今日值则用实时值兜底并落档，保证「心率变异性」卡与趋势图有值。
    let hv: number | undefined = hrvDaily[today];
    if (typeof hv !== 'number' && typeof st.metrics.hrv === 'number') hv = st.metrics.hrv;
    if (typeof hv === 'number') {
      daily['hrv'] = hv;
      if (hrvDaily[today] == null) hrvDaily[today] = hv; // 落档：供趋势图与跨天历史
      if (metrics['hrv'] == null) metrics['hrv'] = hv;
    }
    // HR：优先用历史日归档 hrDaily；原生实时 HR 走 emitMetric 实时流（落 metrics.hr / history.hr），
    // 若归档缺今日值则用实时值兜底并落档，保证「心率」卡与趋势图有值。
    let hrVal: number | undefined = hrDaily[today];
    if (typeof hrVal !== 'number' && typeof st.metrics.hr === 'number') hrVal = st.metrics.hr;
    if (typeof hrVal === 'number') {
      daily['hr'] = hrVal;
      if (hrDaily[today] == null) hrDaily[today] = hrVal; // 落档：供趋势图与跨天历史
      if (metrics['hr'] == null) metrics['hr'] = hrVal;
    }

    // 扩展信号（spo2/temp/hr/v/stress/bp 等）：backfill 已写入 seriesByDay[key][today]，
    // 但 ring.metrics / ring.daily 从未被回填填充——导致首页 basics 卡片（spo2/temp 等按 realtime 读 ring.metrics）
    // 恒显 "—"。这里把今日聚合均值投影进 metrics/daily，与 HR/HRV 的既有逻辑对齐。
    // metrics/availability/lastUpdated 仅接受核心 MetricKey（hr/spo2/temp/eda/hrv/rr），
    // 故核心键才写 metrics；daily 为 Record<string>，所有扩展信号键均可写（卡片读 daily）。
    const projFromSeries = ['hr', 'hrv', 'spo2', 'temp', 'stress', 'bpSys', 'bpDia'];
    const CORE_SET = new Set<string>(['hr', 'hrv', 'spo2', 'temp', 'eda', 'rr']);
    for (const k of projFromSeries) {
      const byDay = st.seriesByDay[k];
      const arr = byDay ? byDay[today] : undefined;
      if (!arr || arr.length === 0) continue;
      const vals = arr.map((p) => p.v).filter((v) => Number.isFinite(v) && v > 0);
      if (vals.length === 0) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const last = arr[arr.length - 1];
      daily[k] = mean; // 所有信号键都写 daily，卡片通用
      if (CORE_SET.has(k)) {
        const ck = k as MetricKey;
        if (metrics[ck] == null) metrics[ck] = mean; // 实时值优先，回填值兜底
        if (availability[ck] == null) availability[ck] = 'live';
        // ★ 完全不碰 lastUpdated！它只由 real-time 流（flushPendingMetrics / applyPatch 实时事件）维护。
        // syncExtendedDaily 从 backfill 历史取数据，时间戳是旧的，写了会覆盖刚到的 healthGlance 时间。
      }
    }

    // 跨天序列：合并所有归档日期 → {t,v} 点（供趋势图 + 末次测量时间）
    const allDates = Array.from(
      new Set([
        ...Object.keys(st.stepDaily),
        ...Object.keys(st.sleepDaily),
        ...Object.keys(st.hrvDaily),
        ...Object.keys(st.hrDaily),
      ])
    ).sort();
    const tsOf = (d: string): number => {
      const t = new Date(d + 'T00:00:00');
      return Number.isFinite(t.getTime()) ? Math.floor(t.getTime() / 1000) : Math.floor(Date.now() / 1000);
    };
    const series = (fn: (d: string) => number | null): TimePoint[] =>
      allDates
        .map((d) => ({ t: tsOf(d), v: fn(d) }))
        .filter((p): p is TimePoint => p.v != null && Number.isFinite(p.v));

    dailyHistory['steps'] = series((d) => st.stepDaily[d]?.steps ?? null);
    dailyHistory['distance'] = series((d) => st.stepDaily[d]?.distance ?? null);
    dailyHistory['calorie'] = series((d) => st.stepDaily[d]?.calorie ?? null);
    dailyHistory['sleepTotal'] = series((d) => st.sleepDaily[d]?.total ?? null);
    dailyHistory['sleepDeep'] = series((d) => {
      const s = st.sleepDaily[d];
      return s && s.total > 0 ? Math.round((s.deep / s.total) * 100) : null;
    });
    dailyHistory['sleepRem'] = series((d) => {
      const s = st.sleepDaily[d];
      return s && s.total > 0 ? Math.round((s.rem / s.total) * 100) : null;
    });
    dailyHistory['sleepScore'] = series((d) => st.sleepDaily[d]?.score ?? null);
    dailyHistory['hrv'] = series((d) => {
      const v = hrvDaily[d];
      return typeof v === 'number' ? v : null;
    });
    dailyHistory['hr'] = series((d) => {
      const v = hrDaily[d];
      return typeof v === 'number' ? v : null;
    });

    // 健康一览扩展指标（血脂/心理/血压/身体成分/梅脱等）：统一从 healthStore 取「今日日内 + 历史日均」合一序列。
    // healthStore 是本次重做的唯一可信源——handleHealthGlanceDay 写日均、handleDayBucketSamples 写日内逐点。
    // 这样压力/疲劳/SNS/MET 等「每日分辨率」指标既能画出今日的日内曲线，也能在缺少日内数据时回退到多日趋势。
    const hsTodayKey = dayKey(Date.now());
    const extKeySet = new Set<string>();
    for (const dk of Object.keys(st.extDaily)) {
      for (const k of Object.keys(st.extDaily[dk])) extKeySet.add(k);
    }
    for (const k of extKeySet) {
      const tv = st.extDaily[today]?.[k];
      if (tv != null) daily[k] = tv;
      const hk = hsKeyFor(k);
      if (!hk) continue;
      const pts: TimePoint[] = [];
      // 今日日内逐点（来自 onXxxSamples / 原始数据回填）→ 今日窗口内 ≥2 点，趋势图有内容
      for (const p of healthStore.getIntraday(hk, hsTodayKey)) {
        if (Number.isFinite(p.t) && Number.isFinite(p.v)) pts.push({ t: p.t, v: p.v });
      }
      // 历史日均（近 30 天，跳过今日以免与日内重复落双点）→ 多日趋势兜底
      for (let i = 1; i <= 30; i++) {
        const dk = dayKey(Date.now() - i * 864e5);
        const dm = healthStore.getDay(hk, dk);
        if (dm && typeof dm.mean === 'number' && Number.isFinite(dm.mean)) {
          const t = parseDayKey(dk);
          if (Number.isFinite(t)) pts.push({ t, v: dm.mean });
        }
      }
      pts.sort((a, b) => a.t - b.t);
      if (pts.length > 0) dailyHistory[k] = pts;
    }

    this.state = { ...this.state, daily, metrics, dailyHistory, hrvDaily, hrDaily, availability };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 「今日状态」恢复就绪度算法接入（Phase 1：相位专属基线 + 晨间锚点 + 归一化层）
  // 算法纯逻辑在 src/lib/dailyStatus.ts；此处负责把戒指真实数据映射成算法输入。
  // ─────────────────────────────────────────────────────────────────────────────

  /** RHR 近似：夜间窗口内 HR 最小值（TBD-5 纯 TS 路径，免 ⌘R）。无窗口则回退过去 24h 最小。 */
  private deriveRHR(): number | null {
    const hr = this.state.history.hr;
    if (!hr || hr.length === 0) return null;
    const { sleepTime, wakeTime } = this.state;
    const today = new Date();
    const toMs = (hhmm: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
      if (!m) return null;
      const d = new Date(today);
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return d.getTime();
    };
    const lo = toMs(sleepTime ?? '');
    const hi = toMs(wakeTime ?? '');
    const now = Date.now();
    if (lo == null || hi == null || hi <= lo) {
      const cutoff = now - DAY_MS;
      const inWin = hr.filter((p) => p.t >= cutoff);
      return inWin.length ? Math.min(...inWin.map((p) => p.v)) : null;
    }
    const inWin = hr.filter((p) => p.t >= lo && p.t <= hi);
    return inWin.length ? Math.min(...inWin.map((p) => p.v)) : null;
  }

  /**
   * 相位：合并「戒指回传 female」与「本地 cycleLog」两条经期来源，取更晚的经期开始日
   * （用户最近在 App 内输入的记录更可信）。两者皆空缺才回退 unknown。
   */
  private resolveCycle(): CycleInfo {
    const candidates: CycleLog[] = [];
    const f = this.state.female;
    if (f && f.lastMenstrualDate && f.menstrualCircle > 0) {
      candidates.push({
        lastPeriodStart: f.lastMenstrualDate,
        cycleLength: f.menstrualCircle,
        lutealLength: 14,
        periodLength: f.menstrualDays || 5,
      });
    }
    if (this.localCycle && this.localCycle.lastPeriodStart) {
      candidates.push(this.localCycle);
    }
    const tempSeries = tempDailyToSeries(this.state.tempDaily);
    const periodHistory = this.localCycle?.history;
    if (candidates.length === 0) {
      return computeCycle(null, new Date(), { tempSeries, periodHistory });
    }
    candidates.sort((a, b) => daysBetween(a.lastPeriodStart, b.lastPeriodStart));
    return computeCycle(candidates[candidates.length - 1], new Date(), { tempSeries, periodHistory });
  }

  /** 重新读取本地经期记录（cycleLog 文件），并触发相位/状态重算。用户在 App 内记经期后调用。 */
  async refreshLocalCycle(): Promise<void> {
    try {
      this.localCycle = await loadCycleLog();
    } catch {
      this.localCycle = null;
    }
    this.recomputeDailyStatus();
  }

  private mergeRecord(history: DailyRecord[], rec: DailyRecord): DailyRecord[] {
    const idx = history.findIndex((r) => r.date === rec.date);
    let next: DailyRecord[];
    if (idx >= 0) {
      next = history.slice();
      next[idx] = rec;
    } else {
      next = [...history, rec];
    }
    if (next.length > 120) next = next.slice(next.length - 120);
    return next;
  }

  /**
   * 今日状态曲线（v2 累积能量模型）。
   * - 每个自然日醒后第一次调用：算一次晨间种子 S0 并锁死（持久化），向时间线压入起点。
   * - 仅当距上次累积 ≥30 分钟：提取本窗口信号 → accumulateWindow 累积 → 追加一个电量点。
   * - 高频数据刷新不触发累积，只刷新头条（用时间线最新点），避免重复扣减。
   * 详见 docs/daily-status-curve-spec.md。
   */
  /** 最近的睡眠归档（日期 ≤ 今天），用于「今日状态」种子在没有今日 sleepSummary 时回退到最近一晚 */
  private latestSleepDaily(): {
    total: number;
    deep: number;
    light: number;
    rem: number;
    score: number;
    getUp: number;
  } | null {
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    const todayStart = dayStartMs(Date.now());
    const entries = Object.entries(this.state.sleepDaily)
      .filter(([k]) => k <= todayKey)
      .filter(([, value]) => value.total > 0)
      .filter(([k]) => {
        const [year, month, day] = k.split('-').map(Number);
        const start = new Date(year, month - 1, day).getTime();
        return Number.isFinite(start) && todayStart - start <= 2 * DAY_MS;
      })
      .sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return entries.length ? (entries[0][1] as any) : null;
  }

  private recomputeDailyStatus(now: number = Date.now(), force = false) {
    // ★ 只允许在 :00 / :30 墙钟边界打点 — 过滤掉连接瞬间 / 数据到达时触发的非边界点。
    // scheduleStatusTick 本身已对齐边界，但其他调用方（归档落地 / female change / 连接首次）
    // 也会进来加非边界点，这里做硬过滤。
    const d = new Date(now);
    const isBoundary = d.getMinutes() === 0 || d.getMinutes() === 30;
    // ★ force 不再卡 isBoundary：断连重连时 force=true + now=13:10 → boundaryTs=13:00 → 补打 13:00 的点
    const effectiveForce = force;
    // 清洗今日 statusTimeline：只保留墙钟 :00 / :30 边界的点
    const cleaned = this.state.statusTimeline.filter((p) => {
      const m = new Date(p.t).getMinutes();
      return m === 0 || m === 30;
    });
    if (cleaned.length !== this.state.statusTimeline.length) {
      this.state.statusTimeline = cleaned.slice(-STATUS_TIMELINE_CAP);
    }
    const cycle = this.resolveCycle();
    const history = this.state.statusHistory;
    const dayKey = this.bucketDay || dayKeyOf(now);

    // —— 晨间种子 S0（每个自然日算一次）——
    let curve = this.state.dailyCurve;
    let needSeed = !curve || curve.dayKey !== dayKey;
    // 这样只要戒指历史 HRV 回传过，今日状态种子就有 HRV 输入。
    const hrvRaw =
      this.state.metrics.hrv ??
      (typeof this.state.daily['hrv'] === 'number' ? this.state.daily['hrv'] : null);
    const hrv =
      hrvRaw != null && hrvRaw <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvRaw >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvRaw
        : null;
    const rhr = this.deriveRHR();
    const ss = this.state.sleepSummaryDate === dayKey ? this.state.sleepSummary : null;
    let sleepTotal: number | null = ss?.total ?? null;
    let sleepDeep: number | null = ss?.deep ?? null;
    let getUp: number | null = ss?.getUp ?? null;
    // 今日 sleepSummary 缺失时（backfill 只回填过去夜 dn>=1），回退到最近一晚的真实睡眠归档
    if (sleepTotal == null) {
      const latest = this.latestSleepDaily();
      if (latest) {
        sleepTotal = latest.total;
        sleepDeep = latest.deep;
        getUp = latest.getUp;
      }
    }
    const sleep: TodayInput['sleep'] = { sleepTotal, sleepDeep, getUp };
    const input: TodayInput = { hrv, rhr, sleep };
    // 解锁被锁死的 null 种子：已有曲线、但其 seed 为 null、且当前已拿到有效输入（HRV/睡眠/静息心率任一）→ 强制重算。
    // 修复「当日首次 recompute 时数据尚未到达 → 种子锁死为 null，之后数据到了也不再解锁」导致今日状态全天空白。
    if (curve && curve.seed.value == null && (hrv != null || sleepTotal != null || rhr != null)) {
      needSeed = true;
    }

    // 跨天归档：把"非今天"的实时状态点按天存入 statusTimelineByDay（历史日真实曲线，不反推）。
    // 查看过去某天时，看到的就是当天实时算出来的原曲线，与当时一致。
    let statusTimelineByDay = this.state.statusTimelineByDay;
    if (curve && curve.dayKey !== dayKey) {
      const closing = this.state.statusTimeline.filter((p) => !isSameDay(p.t, now));
      if (closing.length > 0) {
        const byDay: Record<string, CurvePoint[]> = {};
        for (const p of closing) {
          const dk = dayKeyOf(p.t);
          (byDay[dk] = byDay[dk] ?? []).push(p);
        }
        statusTimelineByDay = { ...statusTimelineByDay };
        for (const dk of Object.keys(byDay)) {
          const exist = statusTimelineByDay[dk] ?? [];
          const seen = new Set(exist.map((e) => e.t));
          statusTimelineByDay[dk] = [...exist, ...byDay[dk].filter((p) => !seen.has(p.t))].sort(
            (a, b) => a.t - b.t,
          );
        }
      }
    }

    if (needSeed) {
      const seed = computeSeed({ input, history, cycle, consts: CURVE_DEFAULTS });
      const baseline = deriveDaytimeBaseline(history, cycle.phase as PhaseBucket, CURVE_DEFAULTS);
      curve = { dayKey, seed, baseline, lastWindowSteps: this.todaySteps(), lastWearTs: now };
      if (seed.value != null) {
        // 种子起始点也对齐到最近的 :00 / :30 边界（不新增非边界点）
        const sd = new Date(now);
        const sm = sd.getMinutes() >= 30 ? 30 : 0;
        const startTs = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), sd.getHours(), sm, 0, 0).getTime();
        // 保留当日点、清掉昨日残留，再以边界对齐 ts 去重写入种子起始点
        this.state.statusTimeline = this.state.statusTimeline.filter((p) => isSameDay(p.t, now));
        this.pushStatusPoint(seed.value, startTs);
        this.lastCurveAccumTs = startTs;
      }
    }

    // —— 更新历史日记录（用于基线 / wakeNorm）——
    const rec: DailyRecord = {
      date: dayKey,
      hrv,
      rhr,
      sleepTotal: sleep.sleepTotal,
      sleepDeep: sleep.sleepDeep,
      sleepRem: ss?.rem ?? null,
      getUp: sleep.getUp,
      fever: false, // TODO(spec §9)：由皮肤温阈值判定发烧日，发烧日不计入基线
      phase: cycle.phase as DailyRecord['phase'],
      rawReadiness: curve?.seed.rawReadiness ?? null,
    };
    const updatedHistory = this.mergeRecord(history, rec);

    // —— 累积窗口（每 30 分钟一次）——
    if (curve && curve.seed.value != null) {
      // 统一用对齐到 :00/:30 边界的 ts 作为该点 t，并对同边界 t 去重（见 pushStatusPoint）
      const boundaryTs = this.alignBoundaryTs(now);
      // ★ 去掉 isBoundary 守卫：断连后重连时，即使当前不在边界，也能补打错过的 :00/:30 点
      // （boundaryTs 是对齐到最近的 :00/:30，pushStatusPoint 按 ts 去重，不会重复）
      const gap = this.lastCurveAccumTs == null ? Infinity : boundaryTs - this.lastCurveAccumTs;
      const due = effectiveForce || this.lastCurveAccumTs == null || gap >= STATUS_SNAPSHOT_MS;
      if (due) {
        const sig = this.deriveWindowSignals(now, curve);
        let prev = this.lastTimelineValue() ?? curve.seed.value;
        if (!Number.isFinite(prev)) prev = curve.seed.value ?? 50;
        // 佩戴中断 >2h：以当前情境快照对 S(t) 做软重置（0.3 快照 + 0.7 累积值）
        if (curve.lastWearTs != null && now - curve.lastWearTs > CURVE_DEFAULTS.WEAR_GAP_MS) {
          prev = clampN(prev * 0.7 + this.spotBattery(sig, curve.baseline) * 0.3, 0, 100);
          if (!Number.isFinite(prev)) prev = curve.seed.value ?? 50;
        }
        const res = accumulateWindow(prev, sig, curve.baseline, CURVE_DEFAULTS);
        const nextValue = Number.isFinite(res.next) ? res.next : (curve.seed.value ?? 50);
        this.pushStatusPoint(nextValue, boundaryTs);
        this.lastCurveAccumTs = boundaryTs;
        curve = { ...curve, lastWindowSteps: this.todaySteps(), lastWearTs: now };
      } else {
        // 数据刷新但非累积边界：戒指在戴，仅刷新佩戴时间戳，不推进曲线
        curve = { ...curve, lastWearTs: now };
      }
    }

    // 当日状态分值：今天 statusTimeline 的均值，写入 statusDaily（按天聚合，供周/月/年趋势）
    const todayVals = this.state.statusTimeline.filter((p) => Number.isFinite(p.value)).map((p) => p.value);
    const todayMean = todayVals.length ? todayVals.reduce((a, b) => a + b, 0) / todayVals.length : null;
    const statusDaily =
      todayMean != null && Number.isFinite(todayMean)
        ? { ...this.state.statusDaily, [this.bucketDay]: todayMean }
        : this.state.statusDaily;

    this.applyPatch({
      statusHistory: updatedHistory,
      dailyCurve: curve,
      statusTimeline: this.state.statusTimeline,
      curveStatus: this.buildCurveStatus(curve, cycle),
      statusDaily,
      statusTimelineByDay,
    });
  }

  /** 把任意时间戳对齐到最近的 :00 / :30 墙钟边界（去毫秒），作为 statusTimeline 点的统一 t。
   *  保证同一 30 分钟边界无论被多少次触发，t 都一致，从根本上避免「同一时间出现多个数据」。 */
  private alignBoundaryTs(now: number): number {
    const d = new Date(now);
    const sm = d.getMinutes() >= 30 ? 30 : 0;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), sm, 0, 0).getTime();
  }

  /** 向今日 statusTimeline 写入一个边界点：若同边界 t 已存在则替换（去重），否则追加。 */
  private pushStatusPoint(value: number, ts: number) {
    const point: CurvePoint = { t: ts, value, level: curveLevel(value, CURVE_DEFAULTS).level };
    const arr = this.state.statusTimeline;
    const idx = arr.findIndex((p) => p.t === ts);
    if (idx >= 0) {
      const next = arr.slice();
      next[idx] = point;
      this.state.statusTimeline = next.slice(-STATUS_TIMELINE_CAP);
    } else {
      this.state.statusTimeline = [...arr, point].slice(-STATUS_TIMELINE_CAP);
    }
  }

  /** 清洗一组曲线点：只保留 :00 / :30 边界点，按对齐边界 ts 去重（保留每个边界最后一条）。
   *  用于 loadSnapshot 读入存档时消除历史脏数据中的重复点。 */
  private dedupeBoundaryPoints(raw: any[]): CurvePoint[] {
    const seen = new Set<number>();
    const out: CurvePoint[] = [];
    for (const p of raw) {
      if (!p || typeof p.t !== 'number' || !Number.isFinite(p.t)) continue;
      const d = new Date(p.t);
      const m = d.getMinutes();
      if (m !== 0 && m !== 30) continue;
      const sm = m >= 30 ? 30 : 0;
      const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), sm, 0, 0).getTime();
      if (seen.has(ts)) continue;
      seen.add(ts);
      out.push({ t: ts, value: typeof p.value === 'number' ? p.value : NaN, level: p.level });
    }
    return out;
  }

  // ── 曲线辅助：窗口信号提取 / 情境判断 / 头条聚合 ──

  /** 当日累计步数（来自扩展信号 daily['steps']） */
  private todaySteps(): number | null {
    const s = this.state.daily['steps'];
    return typeof s === 'number' ? s : null;
  }

  private lastTimelineValue(): number | null {
    const t = this.state.statusTimeline;
    return t.length ? t[t.length - 1].value : null;
  }

  /** 提取最近 30 分钟窗口信号，供 accumulateWindow 使用 */
  private deriveWindowSignals(now: number, curve: DailyCurveSeed): WindowSignals {
    const WIN = STATUS_SNAPSHOT_MS;
    const hrPts = this.state.history.hr.filter((p) => now - p.t <= WIN);
    const hrMean = hrPts.length ? hrPts.reduce((a, p) => a + p.v, 0) / hrPts.length : null;
    const cur = this.todaySteps();
    const stepsDelta = cur != null && curve.lastWindowSteps != null ? Math.max(0, cur - curve.lastWindowSteps) : 0;
    const edaPts = this.state.history.eda.filter((p) => now - p.t <= WIN);
    const edaEvents = this.countEdaEvents(edaPts);
    const hrvRaw = this.state.metrics.hrv;
    const hrv =
      hrvRaw != null && hrvRaw <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvRaw >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvRaw
        : null;
    const asleep = this.isAsleepNow(now);
    const isNap = !asleep && hrMean != null && hrMean < curve.baseline.hrRest * 0.95 && stepsDelta < 5 && this.isDaytime(now);
    return { hrMean, stepsDelta, edaEvents, hrv, asleep, isNap };
  }

  /** EDA 应激事件计数：窗口内高于近期中位 30% 的采样点视为一次应激波峰（上限 8） */
  private countEdaEvents(pts: { v: number }[]): number {
    const vals = pts.map((p) => p.v).filter((v) => Number.isFinite(v));
    if (vals.length < 3) return 0;
    const sorted = [...vals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    if (med <= 0) return 0;
    return Math.min(vals.filter((v) => v > med * 1.3).length, 8);
  }

  private isAsleepNow(now: number): boolean {
    const { sleepTime, wakeTime } = this.state;
    if (!sleepTime || !wakeTime) return false;
    const toMs = (hhmm: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
      if (!m) return null;
      const d = new Date(now);
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return d.getTime();
    };
    const s = toMs(sleepTime);
    const w = toMs(wakeTime);
    if (s == null || w == null || s === w) return false;
    if (s < w) return now >= s && now <= w;
    return now >= s || now <= w; // 跨午夜
  }

  private isDaytime(now: number): boolean {
    const h = new Date(now).getHours();
    return h >= 8 && h < 22;
  }

  /** 佩戴中断软重置用：依据当前窗口情境估算一个粗略电量 */
  private spotBattery(sig: WindowSignals, baseline: DaytimeBaseline): number {
    if (sig.asleep) return 95;
    if (isRecoveringNow(sig, baseline, CURVE_DEFAULTS)) return 90;
    const active =
      (sig.hrMean != null && sig.hrMean > baseline.hrRest * 1.1) ||
      (sig.stepsDelta ?? 0) > CURVE_DEFAULTS.STEP_BASELINE * 0.3;
    return active ? 60 : 72;
  }

  private buildCurveStatus(curve: DailyCurveSeed | null, cycle: CycleInfo): CurveStatus {
    // ★ 没戒指 + healthStore 全空时，curve 可能非 null 但 statusTimeline 是空的 → 也判为没数据
    const tl = this.state.statusTimeline;
    const tlAllZero = tl.length > 0 && tl.every((p: any) => !Number.isFinite(p.value) || p.value === 0);
    if (!curve || curve.seed.value == null || tlAllZero) {
      const pb = cycle.phase as PhaseBucket;
      return {
        value: null,
        level: null,
        phaseLabel: PHASE_TEXT[pb] ?? '未记录',
        dayInCycle: cycle.dayInCycle,
        hasLog: cycle.hasLog,
        estrogenIndex: cycle.estrogenIndex ?? null,
        seed: null,
        narrative: cycle.hasLog
          ? '今日佩戴数据不足，暂无法评估恢复状态'
          : '记录经期并连续佩戴几天后，开启今日状态评估',
        hasData: false,
      };
    }
    const value = this.lastTimelineValue() ?? curve.seed.value;
    const lvl = curveLevel(value, CURVE_DEFAULTS);
    const seed = curve.seed;
    const delta = seed.recoveryDelta != null ? `${seed.recoveryDelta > 0 ? '+' : ''}${Math.round(seed.recoveryDelta)}` : '';
    // 显示相位跟随实时 cycle（用户中途记经期立即生效）；seed.phaseBucket 仅用于晨间能量种子，保持锁死
    const phaseLabel = PHASE_TEXT[cycle.phase as PhaseBucket] ?? '未记录';
    const narrative = `${phaseLabel}${cycle.hasLog && cycle.dayInCycle ? ` · 周期第 ${cycle.dayInCycle} 天` : ''} · 晨间恢复 ${Math.round(curve.seed.value)}（${seed.recoveryLabel}${delta ? ' ' + delta : ''}）`;
    return {
      value,
      level: lvl.level,
      phaseLabel,
      dayInCycle: cycle.dayInCycle,
      hasLog: cycle.hasLog,
      estrogenIndex: cycle.estrogenIndex ?? null,
      seed,
      narrative,
      hasData: true,
    };
  }

  /**
   * 反推历史「今日状态」分值：backfill 拉回的历史 HRV / 睡眠 / 计步，本机从未在线，
   * 没有当时的实时曲线——用 dailyStatus 的晨间种子模型按「当日可用信号」估算一个状态分，
   * 写入 statusDaily[该日]。仅回填过去日（!= 今天），今天由实时曲线累积、不覆盖。
   * 诚实标注：这是基于 HRV/睡眠的推算分，不是当时逐 30 分钟的完整曲线。
   */
  private rebuildHistoricalStatus() {
    if (this.rebuildHistoricalStatusRunning) return;
    this.rebuildHistoricalStatusRunning = true;
    try {
      this.rebuildHistoricalStatusImpl();
    } finally {
      this.rebuildHistoricalStatusRunning = false;
    }
  }

  private rebuildHistoricalStatusRunning = false;
  private _hsDiagCount = 0;


  /** 过滤持久化状态里的非法日期 key（如 2083 溢出、NaN-NaN-NaN）。
   *  遍历所有可能含 dateKey 的 *Daily 字段，删除不符合 YYYY-MM-DD / 2020-2099 的 key。 */
  private purgeInvalidDateKeys() {
    const isValid = (k: string) => {
      const m = k.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return false;
      const y = Number(m[1]);
      return y >= 2020 && y <= 2030;
    };
    const st = this.state;
    const patch: any = {};
    let changed = false;
    for (const field of ['statusDaily', 'hrvDaily', 'sleepDaily', 'hrDaily', 'spo2Daily', 'tempDaily', 'edaDaily', 'rrDaily', 'stepDaily', 'ecgDaily', 'extDaily']) {
      const cur = (st as any)[field];
      if (!cur || typeof cur !== 'object') continue;
      const cleaned: any = {};
      for (const [k, v] of Object.entries(cur)) {
        if (isValid(k)) cleaned[k] = v;
        else { changed = true; postLog('RingBle', `[purgeInvalidDateKeys] 🗑 丢弃 ${field}[${k}]`); }
      }
      if (changed && Object.keys(cur).length !== Object.keys(cleaned).length) {
        patch[field] = cleaned;
      }
    }
    // statusTimelineByDay 也要清
    if (st.statusTimelineByDay) {
      const cleaned: any = {};
      let tlChanged = false;
      for (const [k, v] of Object.entries(st.statusTimelineByDay)) {
        if (isValid(k)) cleaned[k] = v;
        else { tlChanged = true; postLog('RingBle', `[purgeInvalidDateKeys] 🗑 丢弃 statusTimelineByDay[${k}]`); }
      }
      if (tlChanged) patch.statusTimelineByDay = cleaned;
    }
    if (Object.keys(patch).length > 0) {
      this.applyPatch(patch);
      postLog('RingBle', `[purgeInvalidDateKeys] ✅ 清理完成`);
    }
  }
  private rebuildHistoricalStatusImpl() {
    const hrv = this.state.hrvDaily;
    const sleep = this.state.sleepDaily;

    // ★ 守卫：没连戒指 + healthStore 今日全空 → 不重建，避免造假曲线
    const todayKey0 = dayKeyOf(Date.now());
    const connected0 = this.state.status === 'connected';
    if (!connected0) {
      const hsHr0 = healthStore.getIntraday('hr', todayKey0).length;
      const hsHrv0 = healthStore.getIntraday('hrv', todayKey0).length;
      const hsSteps0 = healthStore.getIntraday('steps', todayKey0).length;
      const hsMet0 = healthStore.getIntraday('met', todayKey0).length;
      const hsEda0 = healthStore.getIntraday('eda', todayKey0).length;
      const todayHasAny = hsHr0 + hsHrv0 + hsSteps0 + hsMet0 + hsEda0 > 0;
      const hasAnyDaily = Object.keys(hrv).length > 0 || Object.keys(sleep).length > 0;
      if (!todayHasAny && !hasAnyDaily) {
        postLog('RingBle', '[rebuildHistoricalStatusImpl] 没连戒指 + healthStore 全空，跳过重建');
        return;
      }
    }

    // ★ 过滤非法日期（2083 溢出、NaN-NaN-NaN 等垃圾 key）
    const isValidDk = (k: string) => {
      const m = k.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return false;
      const y = Number(m[1]);
      return y >= 2020 && y <= 2030;
    };

    // ★ 近 1 小时全指标诊断：确认断连期间哪些数据源有数据、哪些丢了
    {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const todayKey2 = dayKeyOf(now);
      const lastHour: any = {};
      for (const metric of ['hr', 'hrv', 'eda', 'met', 'steps', 'temp', 'spo2']) {
        const all = healthStore.getIntraday(metric as any, todayKey2);
        const recent = all.filter((p: any) => p.t >= oneHourAgo);
        const last = all.length > 0 ? all[all.length - 1] : null;
        lastHour[metric] = {
          totalToday: all.length,
          lastHourPts: recent.length,
          lastTs: last ? new Date(last.t).toISOString().slice(11, 19) : null,
          lastValue: last ? last.v : null,
        };
      }
      const tl = this.state.statusTimeline.filter((p: any) => p.t >= oneHourAgo);
      const lastPt = tl.length > 0 ? tl[tl.length - 1] : null;
      const stlDiag = {
        totalToday: this.state.statusTimeline.length,
        lastHourPts: tl.length,
        lastTs: lastPt ? new Date(lastPt.t).toISOString().slice(11, 19) : null,
        lastValue: lastPt ? lastPt.value : null,
      };
    }

    const days = new Set<string>(
      [...Object.keys(hrv), ...Object.keys(sleep)].filter(isValidDk)
    );
    // ★ 今日也参与重建：若今日状态曲线稀疏（典型是当天靠离线回填、App 未在线累积），
    //   用当日回填的 intraday（hr/steps/met/eda）重建到当前时间的 30min 曲线，补全首页「全天状态趋势图」。
    // ★ 没连接戒指 + 今日 healthStore 全空 → 不把今天加入 days，避免造今日假曲线
    const connectedFlag = this.state.status === 'connected';
    // ★ 不用 this.bucketDay（初始值 '' 会导致 healthStore.getIntraday('', '') 崩溃），用墙钟
    const todayKeyCheck = this.bucketDay || dayKeyOf(Date.now());
    if (connectedFlag) {
      days.add(todayKeyCheck);
    } else {
      const tHr = healthStore.getIntraday('hr', todayKeyCheck).length;
      const tHrv = healthStore.getIntraday('hrv', todayKeyCheck).length;
      const tSteps = healthStore.getIntraday('steps', todayKeyCheck).length;
      const tMet = healthStore.getIntraday('met', todayKeyCheck).length;
      const tEda = healthStore.getIntraday('eda', todayKeyCheck).length;
      if (tHr + tHrv + tSteps + tMet + tEda > 0) {
        days.add(todayKeyCheck);
      }
    }
    if (days.size === 0) return;
    const cycle = this.resolveCycle();
    // ★ 用墙钟兜底，bucketDay 可能是 ''（数据还没到）
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    let statusDaily = this.state.statusDaily;
    let statusTimelineByDay = this.state.statusTimelineByDay;
    let statusTimeline = this.state.statusTimeline;
    let changed = false;

    // ★ 诊断 dump：backfill 后立即检查各数据源是否真有值
    {
      const dayList = Array.from(days).sort();
      const dump = dayList.map((dk) => {
        const hv = hrv[dk];
        const sl = sleep[dk];
        const hsHr = healthStore.getIntraday('hr', dk).length;
        const hsSteps = healthStore.getIntraday('steps', dk).length;
        const hsMet = healthStore.getIntraday('met', dk).length;
        const hsEda = healthStore.getIntraday('eda', dk).length;
        const hsHrv = healthStore.getIntraday('hrv', dk).length;
        const sd = this.state.statusDaily[dk];
        const stl = this.state.statusTimelineByDay[dk]?.length ?? 0;
        const stlHasVals = this.state.statusTimelineByDay[dk]?.filter(p => p.value > 0).length ?? 0;
        return { dk, hrv: hv, sleep: sl?.total, hr: hsHr, steps: hsSteps, met: hsMet, eda: hsEda, hrvPts: hsHrv, statusDaily: sd, stlByDay: stl, stlHasVals };
      });
      postLog('RingBle', `[rebuildHistoricalStatus] 诊断: ${JSON.stringify(dump)}`);
    }

    for (const dk of days) {
      const isToday = dk === todayKey;
      const hv = hrv[dk];
      const sl = sleep[dk];
      // ★ 只要 healthStore 有任何 intraday 数据（hr/steps/met），就算没有 hrv/sleep 也重建
      const hsHr = healthStore.getIntraday('hr', dk).length;
      const hsSteps = healthStore.getIntraday('steps', dk).length;
      const hsMet = healthStore.getIntraday('met', dk).length;
      const hsAny = hsHr + hsSteps + hsMet > 0;
      if (!isToday && hv == null && !sl && !hsAny) continue;
      const hrvOk =
        hv != null && hv <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hv >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN ? hv : null;
      const input: TodayInput = {
        hrv: hrvOk,
        rhr: null,
        sleep: sl
          ? { sleepTotal: sl.total ?? null, sleepDeep: sl.deep ?? null, getUp: sl.getUp ?? null }
          : { sleepTotal: null, sleepDeep: null, getUp: null },
      };
      const seed = computeSeed({ input, history: this.state.statusHistory, cycle, consts: CURVE_DEFAULTS });
      // ★ seed.value 为 null 时的兜底：只有 healthStore 有 hr/steps/met/eda 真实 intraday 数据时
      //   才 fallback 到 50（晨间能量基准），确保离线反算能跑；
      //   全空时 seedVal = null → 后续重建会返回 [] → curveStatus.hasData = false
      const hasAnyIntraday = hsHr + hsSteps + hsMet + healthStore.getIntraday('eda', dk).length + healthStore.getIntraday('hrv', dk).length > 0;
      const seedVal = (seed.value != null && Number.isFinite(seed.value))
        ? seed.value
        : (hasAnyIntraday ? 50 : null);
      // 历史日写 statusDaily（今日由 recomputeDailyStatus 用时间线均值覆盖，不在此写）
      // ★ seedVal 为 null（无任何真实生理数据）时不写，保持 statusDaily 未定义 → UI 知道这天没数据
      if (!isToday && seedVal != null && statusDaily[dk] !== seedVal) {
        statusDaily = { ...statusDaily, [dk]: seedVal };
        changed = true;
      }

      if (!isToday) {
        // 历史日：重建 statusTimelineByDay[dk] —— 全天 30min 曲线
        // 这是历史日详情页的数据源，之前只有"跨午夜那一刻"才会被归档，
        // backfill 历史日完全没反推 → UI 全空！
        // ★ seedVal 已有 fallback 50，无需再检查 seed.value
        const existing = statusTimelineByDay[dk];
        // 如果已有归档点（跨午夜那一刻产生的）且 ≥ 12 个点，保留
        // 如果没有（backfill 历史日）或太少（< 12 点），从 healthStore intraday 重建
        if (!existing || existing.length < 12) {
          const rebuilt = this.rebuildDayTimelineFromHealthStore(dk, seedVal, cycle);
          if (rebuilt && rebuilt.length > 0) {
            statusTimelineByDay = { ...statusTimelineByDay, [dk]: rebuilt };
            changed = true;
            postLog('RingBle', `[rebuildHistoricalStatus] ✅ 重建 statusTimelineByDay[${dk}] ${rebuilt.length} 个点`);
          }
        }
      } else {
        // 今日：若实时累积的 statusTimeline 稀疏（< 12 点，多为离线回填、当日未在线累积），
        // 用当日回填的 intraday 重建全天曲线，补全首页「全天状态趋势图」。
        // 实时已累积出较完整曲线（≥ 12 点）则保留真实累积，不覆盖。
        if (statusTimeline.length < 12) {
          const rebuilt = this.rebuildDayTimelineFromHealthStore(dk, seedVal, cycle);
          if (rebuilt && rebuilt.length > 0) {
            // 用新重建的点补到现有时间线后面（或替换为空的时间线），不要直接丢弃已有的实时点
            const existingByT = new Map(statusTimeline.map((p) => [p.t, p]));
            for (const p of rebuilt) {
              if (!existingByT.has(p.t)) existingByT.set(p.t, p);
            }
            const merged = Array.from(existingByT.values()).sort((a, b) => a.t - b.t);
            statusTimeline = merged;
            changed = true;
            postLog('RingBle', `[rebuildHistoricalStatus] ✅ 合并今日 statusTimeline（回填 ${rebuilt.length} 点，合并后 ${merged.length} 点）`);
          }
        }
      }
    }
    if (changed) {
      this.state = { ...this.state, statusDaily, statusTimelineByDay, statusTimeline };
      this.emit();
    }
  }

  /** 从 healthStore intraday 重建历史日的全天 30min 状态曲线。
   *  用于 backfill 历史日时 statusTimelineByDay 为空的场景。
   *  用 seed 作起评分，按 30min 窗口聚合 hr/steps/met/eda → accumulateWindow 推后续点。 */
  private rebuildDayTimelineFromHealthStore(
    dayKey: string,
    seedValue: number | null,
    cycle: CycleInfo,
  ): CurvePoint[] {
    // ★ seedValue 为 null → 无任何真实生理数据 → 返回空，不造假曲线
    if (seedValue == null) return [];
    // 1. 从 healthStore 读当天所有可用的 intraday 5min slot
    const hrArr = healthStore.getIntraday('hr', dayKey);
    const stepsArr = healthStore.getIntraday('steps', dayKey);
    const metArr = healthStore.getIntraday('met', dayKey);
    const edaArr = healthStore.getIntraday('eda', dayKey);
    const hrvArr = healthStore.getIntraday('hrv', dayKey);
    const hrvDaily = this.state.hrvDaily[dayKey] ?? null;
    const sleep = this.state.sleepDaily[dayKey];

    // 如果 healthStore 也没任何 intraday 数据，放弃重建
    const totalPts = hrArr.length + stepsArr.length + metArr.length + edaArr.length;
    if (totalPts === 0) return [];

    // 2. 算 baseline（简化：用 cycle.phase 和 hrvDaily 推导）
    const baseline = deriveDaytimeBaseline(this.state.statusHistory, cycle.phase as any, CURVE_DEFAULTS);

    // 3. 构造当天 30min 窗口边界
    // dayKey = "YYYY-MM-DD"
    const [y, m, d] = dayKey.split('-').map((x) => parseInt(x, 10));
    const midnight = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    const WINDOW_MS = 30 * 60 * 1000; // 30min
    const now = Date.now();
    const isToday = dayKey === this.bucketDay;
    // 历史日生成 48 个点（0:00~23:30）；今日只生成到当前时间，避免把 23:30 未来点画出来
    const POINTS_PER_DAY = isToday ? Math.max(0, Math.ceil((now - midnight) / WINDOW_MS)) : 48;

    // 4. 睡眠时段（简化：用 sleepTime/wakeTime 或 sleepDaily 时长反推）
    // 历史日没有实时 sleepTime/wakeTime，用 sleepDaily.total/rem 估算
    let sleepStart: number | null = null;
    let sleepEnd: number | null = null;
    if (sleep && sleep.total) {
      // 假设默认 23:00 睡 → total 分钟后醒
      const defaultSleepStart = new Date(y, m - 1, d - 1 < 1 ? 0 : m - 1, 23, 0).getTime();
      sleepStart = defaultSleepStart;
      sleepEnd = defaultSleepStart + sleep.total * 60 * 1000;
    }

    // 5. 逐窗口生成 WindowSignals → accumulateWindow
    const points: CurvePoint[] = [];
    let prev = seedValue;
    let cumSteps = 0; // 累计步数（模拟 curve.lastWindowSteps）

    for (let i = 0; i < POINTS_PER_DAY; i++) {
      const winStart = midnight + i * WINDOW_MS;
      const winEnd = winStart + WINDOW_MS;

      // 5a. 聚合 hr（30min 窗口均值）
      const winHr = hrArr.filter((p) => p.t >= winStart && p.t < winEnd);
      const hrMean = winHr.length
        ? winHr.reduce((a, p) => a + p.v, 0) / winHr.length
        : null;

      // 5b. 聚合 stepsDelta（窗口内步数增量）
      const winSteps = stepsArr.filter((p) => p.t >= winStart && p.t < winEnd);
      const stepsDelta = winSteps.reduce((s, p) => s + p.v, 0);

      // 5c. 聚合 edaEvents（简化：窗口内 eda 均值 > 中位数 30% 视为应激）
      const winEda = edaArr.filter((p) => p.t >= winStart && p.t < winEnd).map((p) => p.v);
      let edaEvents = 0;
      if (winEda.length >= 3) {
        const sorted = [...winEda].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        if (med > 0) edaEvents = Math.min(winEda.filter((v) => v > med * 1.3).length, 8);
      }

      // 5d. hrv（历史日只有日均值，简化：每个窗口用同一个值）
      const hrv = hrvDaily != null && hrvDaily <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvDaily >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvDaily
        : null;

      // 5e. asleep / isNap 判断
      const asleep = sleepStart != null && sleepEnd != null && winStart >= sleepStart && winStart <= sleepEnd;
      const hrvArrWin = hrvArr.filter((p) => p.t >= winStart && p.t < winEnd);
      const napHrMean = winHr.length ? winHr.reduce((a, p) => a + p.v, 0) / winHr.length : null;
      const hrvWinMean = hrvArrWin.length ? hrvArrWin.reduce((a, p) => a + p.v, 0) / hrvArrWin.length : null;
      const isNap = !asleep && napHrMean != null && hrvWinMean != null && napHrMean < baseline.hrRest * 0.95 && stepsDelta < 5 && new Date(winStart).getHours() >= 8 && new Date(winStart).getHours() < 22;

      const sig = { hrMean, stepsDelta, edaEvents, hrv, asleep, isNap };

      // 5f. accumulateWindow → next value
      let next: number;
      if (i === 0) {
        next = prev; // 第一个点直接用 seed
      } else {
        // 简化版：不用真实 spotBattery（需要 sleepTime/wakeTime），直接走 accumulateWindow
        const res = accumulateWindow(prev, sig, baseline, CURVE_DEFAULTS);
        next = Number.isFinite(res.next) ? res.next : prev;
      }

      points.push({
        t: winStart,
        value: clampN(next, 0, 100),
        level: curveLevel(clampN(next, 0, 100), CURVE_DEFAULTS).level,
      });
      prev = next;
      cumSteps += stepsDelta;
    }

    return points;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 跨 ⌘R 持久化：把真实数据写到 App 沙盒文件，重建后重新加载，趋势图不再归零
  // （纯 JS，使用 expo-file-system，无需新增原生 prebuild）
  // ─────────────────────────────────────────────────────────────────────────────
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** 是否有值得持久化的真实数据（避免把"空状态"覆盖掉已有的好快照） */
  private hasPersistableData(): boolean {
    const h = this.state.history;
    for (const k of CORE_KEYS) if (h[k] && h[k].length > 0) return true;
    for (const v of Object.values(this.state.daily)) if (v != null) return true;
    for (const arr of Object.values(this.state.dailyHistory)) if (arr && arr.length > 0) return true;
    for (const v of Object.values(this.state.tempDaily)) if (v != null && !Number.isNaN(v)) return true;
    if (this.state.statusTimeline && this.state.statusTimeline.length > 0) return true;
    if (this.state.statusTimelineByDay && Object.keys(this.state.statusTimelineByDay).length > 0) return true;
    if (this.state.curveStatus) return true;
    if (this.state.dailyCurve) return true;
    // ★ backfill 回填的逐日数据（HRV/HR/血氧/睡眠/计步/健康一览/ECG 等）也必须能触发落盘。
    // 否则「只有 HRV/HR/血氧、无体温也无实时流」的历史日会被判为无可存数据 → 整包不写盘 → 数据丢。
    for (const perDay of Object.values(this.state.seriesByDay)) {
      if (perDay && Object.keys(perDay).length > 0) return true;
    }
    const dailyMaps = [
      this.state.hrvDaily, this.state.hrDaily, this.state.spo2Daily,
      this.state.sleepDaily, this.state.stepDaily, this.state.extDaily,
      this.state.ecgDaily, this.state.rrDaily, this.state.edaDaily,
    ];
    for (const m of dailyMaps) {
      for (const v of Object.values(m)) if (v != null) return true;
    }
    if (this.state.ecg != null) return true;
    return false;
  }

  private snapshotPath(): string | null {
    if (!FileSystem.documentDirectory) return null;
    return FileSystem.documentDirectory + 'mira_ring_state_v1.json';
  }

  /** healthStore（v2 单一数据源）持久化文件。 */
  private healthStorePath(): string | null {
    if (!FileSystem.documentDirectory) return null;
    return FileSystem.documentDirectory + 'mira_health_store_v2.json';
  }

  /** 「数据同步」开关独立持久化文件：不依赖快照是否有数据，确保开关状态总能落盘/恢复。 */
  private syncFlagPath(): string | null {
    if (!FileSystem.documentDirectory) return null;
    return FileSystem.documentDirectory + 'mira_ring_sync_flag_v1.json';
  }
  private async loadSyncFlag() {
    const path = this.syncFlagPath();
    if (!path) {
      this.syncFlagLoaded = true;
      this.native.setSyncEnabled(this.syncEnabled);
      return;
    }
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(path);
        const o = JSON.parse(raw) as { syncEnabled?: boolean };
        if (typeof o.syncEnabled === 'boolean' && o.syncEnabled === false) {
          // ★ 文件里存了 false 是历史 bug 遗留（backfill 永远不触发），
          // 强制改成 true 并立即写回，彻底修复这个脏状态。
          /* 发现历史遗留 syncEnabled=false 文件 → 强制 true + 写回 */
          this.syncEnabled = true;
          await FileSystem.writeAsStringAsync(path, JSON.stringify({ syncEnabled: true }));
        } else {
          this.syncEnabled = true;  // 不管文件，强制 true
        }
      } else {
        this.syncEnabled = true;
      }
    } catch {
      /* 损坏则忽略，回落默认 true */
      this.syncEnabled = true;
    } finally {
      this.syncFlagLoaded = true;
      // 原生默认关闭，等持久化开关加载完成后再放行连接回填，避免启动竞态。
      healthStore.syncEnabled = this.syncEnabled;
      this.native.setSyncEnabled(this.syncEnabled);
      // 不在「开关加载完」这一步自动 recoverOffline：它会立刻重拉戒指 flash，
      // 而此刻 SDK 往往尚未 ready（连接刚建立），直接触发重型回传链是连上即闪退的元凶。
      // 轻量 backfill（读 SDK 本地库、不重拉 flash）已在 onConnected 触发；
      // 重拉 flash 交由用户主动点「数据同步」或 App 回前台这类 SDK 已稳定的时机。
    }
  }
  private async persistSyncFlag() {
    const path = this.syncFlagPath();
    if (!path) return;
    try {
      await FileSystem.writeAsStringAsync(path, JSON.stringify({ syncEnabled: this.syncEnabled }));
    } catch {
      /* 写盘失败静默：绝不阻塞 App */
    }
  }

  /** 防抖写盘：状态变化后最多每 5s 落盘一次（⌘R 耗时远超 5s，数据必已落盘） */
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveSnapshot();
    }, 5000);
  }

  private serializeBuckets(): {
    core: Record<string, Record<string, { sum: number; count: number; last: number }>>;
    ext: Record<string, Record<string, { sum: number; count: number; last: number }>>;
  } {
    const core: Record<string, Record<string, { sum: number; count: number; last: number }>> = {};
    for (const k of CORE_KEYS) {
      const obj: Record<string, { sum: number; count: number; last: number }> = {};
      for (const [slot, e] of this.dayBuckets[k].entries()) obj[String(slot)] = e;
      core[k] = obj;
    }
    const ext: Record<string, Record<string, { sum: number; count: number; last: number }>> = {};
    for (const k of Object.keys(this.extBuckets)) {
      const obj: Record<string, { sum: number; count: number; last: number }> = {};
      for (const [slot, e] of this.extBuckets[k].entries()) obj[String(slot)] = e;
      ext[k] = obj;
    }
    return { core, ext };
  }

  private async saveSnapshot() {
    if (!this.hasPersistableData()) return; // 不把空状态覆盖掉已有的好数据
    // 落盘前先把「当日」各核心指标日均写进 *Daily（不依赖跨天瞬间，避免当天被丢）
    this.syncDailyFromBuckets();
    const path = this.snapshotPath();
    if (!path) return;
    try {
      const snap = {
        v: 1,
        savedAt: Date.now(),
        bucketDay: this.bucketDay,
        dayStart: this.dayStart,
        buckets: this.serializeBuckets(),
        history: this.state.history,
        daily: this.state.daily,
        dailyHistory: this.state.dailyHistory,
        sleepStages: this.state.sleepStages,
        sleepSummary: this.state.sleepSummary,
        sleepTime: this.state.sleepTime,
        wakeTime: this.state.wakeTime,
        female: this.state.female,
        tempDaily: this.state.tempDaily,
        hrvDaily: this.state.hrvDaily,
        hrDaily: this.state.hrDaily,
        seriesByDay: this.state.seriesByDay,
        deviceCapabilities: this.state.deviceCapabilities,
        spo2Daily: this.state.spo2Daily,
        edaDaily: this.state.edaDaily,
        rrDaily: this.state.rrDaily,
        sleepDaily: this.state.sleepDaily,
        stepDaily: this.state.stepDaily,
        lastSyncedAt: this.state.lastSyncedAt,
        deviceId: this.state.deviceId,
        statusHistory: this.state.statusHistory,
        dailyCurve: this.state.dailyCurve,
        curveStatus: this.state.curveStatus,
        statusTimeline: this.state.statusTimeline.filter((p) => {
            const m = new Date(p.t).getMinutes();
            return m === 0 || m === 30;
          }),
        statusDaily: this.state.statusDaily,
        statusTimelineByDay: Object.fromEntries(
            Object.entries(this.state.statusTimelineByDay).map(([dk, arr]) => [
              dk,
              (arr as any[]).filter((p) => {
                const m = new Date(p.t).getMinutes();
                return m === 0 || m === 30;
              }),
            ])
          ),
        metrics: this.state.metrics,
        extDaily: this.state.extDaily,
        ecg: this.state.ecg,
        ecgDaily: this.state.ecgDaily,
        ecgHistory: this.state.ecgHistory,
        lastUploadedAt: this.state.lastUploadedAt,
        availability: this.state.availability,
        lastUpdated: this.state.lastUpdated,
        syncEnabled: this.syncEnabled,
        userProfile: this.userProfile,
      };
      await FileSystem.writeAsStringAsync(path, JSON.stringify(snap));
      // ★ 单一数据源 healthStore 一并落盘（v2）。与 legacy 快照并存，重启优先恢复 healthStore。
      const hsPath = this.healthStorePath();
      if (hsPath) {
        try {
          await FileSystem.writeAsStringAsync(hsPath, healthStore.serialize());
        } catch {
          /* 写盘失败静默：绝不阻塞 App */
        }
      }
    } catch {
      /* 写盘失败静默：绝不阻塞 App */
    }
  }

  /**
   * 迁移：旧版快照里各 *Daily / extDaily / ecgDaily / seriesByDay 可能用原生零填充 key
   * （如 '2026-09-03'）写入，而读取端统一用 dayKeyOf 非填充风格（'2026-9-3'）查找，
   * 导致历史日（含 9/3）在周/月/年趋势图上取不到。
   * 每次启动、在快照灌入 state 之前调用，把旧 key 重写成规范格式。
   * 幂等：已规范的 key 重归一化不变；只改 key 不改值。
   */
  private normalizeLegacyDateKeys(snap: any): void {
    const rekeyTop = (map: any): any => {
      if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
      const out: any = {};
      let changed = 0;
      let dropped = 0;
      for (const k of Object.keys(map)) {
        const ts = dateKeyToStartMs(k);
        if (Number.isNaN(ts)) {
          // 丢弃非法 key（如旧 bug 产生的 'NaN-NaN-NaN'），这些不是真实日期、只会污染归档。
          dropped++;
          continue;
        }
        const nk = dayKeyOf(ts);
        if (nk !== k) changed++;
        const existing = out[nk];
        const val = map[k];
        // 极少数「同日双 key」情况（旧补零 + 新规范并存）：合并而非覆盖
        if (existing && val && typeof val === 'object' && !Array.isArray(val)) {
          out[nk] = { ...existing, ...val };
        } else {
          out[nk] = val;
        }
      }
      if (changed > 0 || dropped > 0) postLog('RingBle', `[normalizeLegacyDateKeys] 重归一化 ${changed} 个、丢弃 ${dropped} 个非法日期 key`);
      return out;
    };
    const rekeyNested = (map: any): any => {
      if (!map || typeof map !== 'object') return map;
      const out: any = {};
      for (const sig of Object.keys(map)) out[sig] = rekeyTop(map[sig]);
      return out;
    };
    for (const f of ['hrDaily', 'spo2Daily', 'tempDaily', 'hrvDaily', 'rrDaily', 'edaDaily', 'sleepDaily', 'stepDaily', 'ecgDaily']) {
      if (snap[f]) snap[f] = rekeyTop(snap[f]);
    }
    if (snap.extDaily) snap.extDaily = rekeyTop(snap.extDaily);
    if (snap.seriesByDay) snap.seriesByDay = rekeyNested(snap.seriesByDay);
  }

  /** 载入或迁移 healthStore：优先读 v2 快照；否则把旧 v1 快照（*Daily/seriesByDay/extDaily/ecgDaily）迁移进来，丢弃非法 key。 */
  private async loadHealthStoreFromDisk(legacySnap: any): Promise<void> {
    const path = this.healthStorePath();
    if (path) {
      try {
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(path);
          const json = JSON.parse(raw);
          if (json && json.schema === 2) {
            healthStore.loadV2(json);
            postLog('RingBle', '[healthStore] 已从 v2 快照恢复');
            return;
          }
        }
      } catch {
        /* 损坏忽略，回落迁移 */
      }
    }
    try {
      healthStore.migrateFromV1(legacySnap);
      postLog('RingBle', '[healthStore] 已从旧 v1 快照迁移');
    } catch {
      /* 忽略 */
    }
  }

  private async loadPersisted() {
    const path = this.snapshotPath();
    if (!path) return;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return;
      const raw = await FileSystem.readAsStringAsync(path);
      const snap = JSON.parse(raw) as any;
      // 迁移：把旧版零填充日期 key 重写成规范格式（2026-09-03 → 2026-9-3），让历史日可读
      this.normalizeLegacyDateKeys(snap);
      // 重灌时间槽（仅当属同一天；跨天则让 ensureDay 重新计日，避免负槽位）
      if (snap.bucketDay && typeof snap.dayStart === 'number' && snap.buckets) {
        this.bucketDay = snap.bucketDay;
        this.dayStart = snap.dayStart;
        const core = (snap.buckets as any).core || snap.buckets; // 兼容旧快照格式
        for (const k of CORE_KEYS) {
          const m = core[k] || {};
          const map = new Map<number, { sum: number; count: number; last: number }>();
          for (const key of Object.keys(m)) map.set(Number(key), m[key]);
          this.dayBuckets[k] = map;
        }
        const ext = (snap.buckets as any).ext || {};
        for (const k of Object.keys(ext)) {
          const m = ext[k] || {};
          const map = new Map<number, { sum: number; count: number; last: number }>();
          for (const key of Object.keys(m)) map.set(Number(key), m[key]);
          this.extBuckets[k] = map;
        }
      }
      const patch: StatePatch = {};
      if (snap.history) patch.history = snap.history;
      if (snap.daily) patch.daily = snap.daily;
      if (snap.dailyHistory) patch.dailyHistory = snap.dailyHistory;
      if (snap.sleepStages) patch.sleepStages = snap.sleepStages;
      if (snap.sleepSummary) patch.sleepSummary = snap.sleepSummary;
      if (snap.sleepTime) patch.sleepTime = snap.sleepTime;
      if (snap.wakeTime) patch.wakeTime = snap.wakeTime;
      if (snap.female) patch.female = snap.female;
      if (snap.tempDaily) patch.tempDaily = snap.tempDaily;
      if (snap.hrvDaily) patch.hrvDaily = snap.hrvDaily;
      if (snap.hrDaily) patch.hrDaily = snap.hrDaily;
      if (snap.seriesByDay) patch.seriesByDay = snap.seriesByDay;
      if (snap.deviceCapabilities) patch.deviceCapabilities = snap.deviceCapabilities;
      if (snap.spo2Daily) patch.spo2Daily = snap.spo2Daily;
      if (snap.edaDaily) patch.edaDaily = snap.edaDaily;
      if (snap.rrDaily) patch.rrDaily = snap.rrDaily;
      if (snap.sleepDaily) patch.sleepDaily = snap.sleepDaily;
      if (snap.stepDaily) patch.stepDaily = snap.stepDaily;
      if (snap.lastSyncedAt) patch.lastSyncedAt = snap.lastSyncedAt;
      if (snap.extDaily) patch.extDaily = snap.extDaily;
      if (snap.ecg) patch.ecg = snap.ecg;
      if (snap.ecgDaily) patch.ecgDaily = snap.ecgDaily;
      if (snap.lastUploadedAt) patch.lastUploadedAt = snap.lastUploadedAt;
      if (snap.deviceId) patch.deviceId = snap.deviceId;
      if (snap.statusHistory) patch.statusHistory = snap.statusHistory;
      if (snap.dailyCurve) patch.dailyCurve = snap.dailyCurve;
      if (snap.curveStatus) patch.curveStatus = snap.curveStatus;
      if (snap.statusTimeline) {
        // ★ 启动时清洗旧脏数据：只保留 :00 / :30 边界的点，并按对齐边界 t 去重
        const raw = snap.statusTimeline as any[];
        patch.statusTimeline = this.dedupeBoundaryPoints(raw);
      }
      if (snap.statusDaily) patch.statusDaily = snap.statusDaily;
      if (snap.statusTimelineByDay) {
        // ★ 历史归档每个日也清洗非边界点 + 按边界 t 去重
        const rawByDay = snap.statusTimelineByDay as Record<string, any[]>;
        const cleanByDay: Record<string, any[]> = {};
        for (const dk of Object.keys(rawByDay)) {
          cleanByDay[dk] = this.dedupeBoundaryPoints(rawByDay[dk]);
        }
        patch.statusTimelineByDay = cleanByDay;
      }
      if (snap.metrics) patch.metrics = snap.metrics;
      if (snap.availability) patch.availability = snap.availability;
      if (snap.lastUpdated) patch.lastUpdated = snap.lastUpdated;
      // ★ 不从快照读 syncEnabled：它可能是历史 bug 遗留的 false（导致 backfill 永远跳过）。
      // 连接成功后 syncEnabled 强制 true，用户如果真关了下次 loadSyncFlag 再看持久化文件。
      // if (typeof snap.syncEnabled === 'boolean') this.syncEnabled = snap.syncEnabled;
      if (snap.userProfile && typeof snap.userProfile === 'object') this.userProfile = snap.userProfile;
      this.applyPatch(patch);
      // ★ 载入/迁移 healthStore（v2 单一数据源）：优先直接 loadV2；否则用旧 v1 快照迁移
      await this.loadHealthStoreFromDisk(snap);
      // 独立同步开关优先于健康数据快照中的旧副本；若开关文件尚未加载，
      // loadSyncFlag 的 finally 会在完成后再次写回正确值。
      // ★ 强制 syncEnabled=true：历史快照可能存了 false 导致离线回填永远跳过
      this.syncEnabled = true;
      healthStore.syncEnabled = this.syncEnabled;
      this.native.setSyncEnabled(this.syncEnabled);
      // reconcile：把恢复的「当日」时间槽反推回各自 *Daily（即使戒指尚未重连，最后活跃日也不丢）
      this.syncDailyFromBuckets();
      postLog('RingBle', '已从本地持久化恢复真实数据（跨 ⌘R 保留趋势曲线）');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      postLog('RingBle', `[loadPersisted] ⚠️ 快照加载失败（已忽略，从头开始）: ${msg}`);
    }
  }

  onState(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * 订阅「离线同步进度」（底部浮层用）。刻意与 onState 分离：同步期间进度可能更新几十次，
   * 若走 RingState→emit 会让所有屏幕整体重渲染，反而加重同步卡顿。
   */
  onSyncProgress(fn: (p: SyncProgress | null) => void): () => void {
    this.syncProgressListeners.add(fn);
    return () => {
      this.syncProgressListeners.delete(fn);
    };
  }

  /**
   * 广播同步进度。active 状态下挂 90s 兜底定时器：万一原生中途异常没发结束信号，
   * 也能自动收起浮层，不会永远卡在「同步中」。
   */
  private pushSyncProgress(p: SyncProgress | null): void {
    if (this.syncProgressTimer) {
      clearTimeout(this.syncProgressTimer);
      this.syncProgressTimer = null;
    }
    this.syncProgressListeners.forEach((cb) => {
      try {
        cb(p);
      } catch {
        /* 静默：单个订阅者异常不影响同步流程 */
      }
    });
    if (p && p.active) {
      this.syncProgressTimer = setTimeout(() => {
        this.syncProgressTimer = null;
        this.syncProgressListeners.forEach((cb) => {
          try {
            cb(null);
          } catch {
            /* 静默 */
          }
        });
      }, 90_000);
    }
  }

  getState(): RingState {
    return this.state;
  }

  async startScan(): Promise<void> {
    this.applyPatch({ status: 'scanning', error: null, devices: [], flashResult: null });
    if (this.useNative) {
      this.native.scan();
    } else {
      await this.backend.start();
    }
  }

  async connect(): Promise<void> {
    await this.startScan();
  }

  async connectToId(id: string): Promise<void> {
    this.applyPatch({ status: 'connecting', error: null });
    if (this.useNative) {
      this.native.connect(id);
    } else {
      // 后端模式：直接以该设备刷新
      this.backend.disconnect();
      await this.backend.start();
    }
  }

  async disconnect(): Promise<void> {
    this.clearStatusTimer();
    if (this.useNative) this.native.disconnect();
    else this.backend.disconnect();
    this.autoMonitor = false;
    this.applyPatch({
      status: 'idle',
      deviceName: null,
      rssi: null,
      battery: null,
      firmware: null,
      metrics: { ...DEFAULT_METRICS },
      availability: { ...DEFAULT_AVAILABILITY },
      history: { ...EMPTY_HISTORY },
      lastUpdated: { ...DEFAULT_LAST_UPDATED },
      sleepStages: null,
      sleepStagesDaily: {},
      sleepSummary: null,
      sleepTime: null,
      wakeTime: null,
      female: null,
      devices: [],
      flashing: false,
      flashResult: null,
      protocol: this.useNative ? 'Veepoo·原生' : 'Veepoo·后端',
    });
  }

  measure(metric: string) {
    if (this.useNative) {
      if ((CORE_KEYS as string[]).includes(metric)) {
        this.applyPatch({ availability: { ...this.state.availability, [metric as MetricKey]: 'syncing' } });
      }
      this.native.measure(metric);
    } else {
      if ((CORE_KEYS as string[]).includes(metric)) {
        this.applyPatch({ availability: { ...this.state.availability, [metric as MetricKey]: 'syncing' } });
      }
      this.backend.measure();
    }
  }

  /** 手动结束 ECG「关闭测试」：对齐 uni-app 文档的「关闭测试」按钮，可提前结束拿结果。 */
  stopEcg() {
    if (this.useNative) this.native.stopEcg();
    // 后端数据源不涉及原生 ECG，忽略。
  }

  async flashRing(): Promise<void> {
    if (this.state.status !== 'connected') {
      this.applyPatch({ flashResult: '请先连接戒指' });
      return;
    }
    this.applyPatch({ flashing: true, flashResult: '已发送查找指令，请留意戒指震动/亮灯…' });
    if (this.useNative) this.native.flash();
    else this.applyPatch({ flashResult: '当前为后端数据源，无法远程命令戒指闪光/震动。请在 MiraRingProbe 探针 App 中触发查找。' });
    setTimeout(() => this.applyPatch({ flashing: false }), 2500);
  }

  setAutoMonitor(enabled: boolean) {
    this.autoMonitor = enabled;
    if (this.useNative) {
      this.native.setAutoMonitor(enabled);
    } else {
      this.backend.setAutoMonitor(enabled);
    }
  }

  /** 写入经期记录到戒指（veepooSDKSettingDeviceFemale mode=1），成功后 onFemale 事件回传最新状态。 */
  writeFemale(lastDate: string, cycle: number, days: number): Promise<void> {
    if (this.useNative) return this.native.writeFemale(lastDate, cycle, days);
    return Promise.resolve();
  }

  /** 主动从戒指读取经期/生理期状态（连接后也自动读）。 */
  refreshFemale() {
    if (this.useNative) this.native.refreshFemale();
  }

  /** 主动触发一次离线恢复（戒指离线期间累积的数据拉回 App）。
   *  走原生 recoverOffline：先 veepooSdkStartReadDeviceAllData 从戒指 flash 重拉最新离线数据，再逐日回填。
   *  与轻量 backfill（仅读已有 SDK 库）不同，本方法保证点一下就能拉回睡眠期新增数据。仅在原生可用时有效。 */
  syncBackfill() {
    if (this.useNative) this.native.recoverOffline();
  }

  /** 立即落盘（不经 5s 防抖）。backfill 完成后由原生 onBackfillComplete 事件触发，确保刚拉回的历史数据立刻写盘，避免切走/被杀进程丢数据。 */
  flushNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.saveSnapshot();
    // backfill 完成后一次性重建/投影派生数据：之前把 seriesByDay 放进 applyPatch 触发条件，
    // 导致每个 backfill chunk 都触发重建并卡死 JS 线程。现在改到 backfill 完成时只跑一次。
    try {
      this.rebuildHistoricalStatus();
      this.syncExtendedDaily();
      this.recomputeDailyStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      postLog('RingBle', `[flushNow] 派生数据投影异常（已忽略）: ${msg}`);
    }
  }

  /** 强制重新同步：触发原生 recoverOffline，从戒指 flash 重新下载最新离线数据后回填
   *  （HR/HRV/血氧/体温/步数/睡眠/扩展体征）。用于「很多数据没更新」或历史日缺失时手动补救。 */
  forceResync() {
    if (this.useNative) this.native.recoverOffline();
  }

  /**
   * 派生数据（非戒指原始指标）的体检：今日状态 + 周期/经期相位。
   * 这两个算法已存在（dailyStatus.ts / cycleMath.ts），此处只把「是否在更新」并入统一体检清单，
   * 不重写算法。字段形状与 healthStore.freshnessReport() 对齐，便于 8899 dump 统一呈现。
   */
  private derivedFreshness(now: number = Date.now()): {
    key: string; label: string; cadence: string; status: 'never' | 'fresh' | 'stale';
    lastUpdated?: number; ageMinutes?: number; days: number; samples: number; note: string;
  }[] {
    const out: {
      key: string; label: string; cadence: string; status: 'never' | 'fresh' | 'stale';
      lastUpdated?: number; ageMinutes?: number; days: number; samples: number; note: string;
    }[] = [];

    // 1) 今日状态：statusTimeline 每 30 分钟一个点（48点=24h）；statusDaily 每天一聚合分
    const timeline = this.state.statusTimeline ?? [];
    const lastPt = timeline.length ? timeline[timeline.length - 1] : null;
    const lastT = lastPt && typeof lastPt.t === 'number' ? lastPt.t : undefined;
    const todayStatus = this.state.statusDaily?.[this.bucketDay];
    const hasStatus = lastT != null || todayStatus != null;
    const statusAge = lastT != null ? now - lastT : undefined;
    out.push({
      key: 'todayStatus',
      label: '今日状态(恢复就绪度)',
      cadence: '每30分钟一个时间点(24h滚动)；每天一聚合分供周/月/年趋势',
      status: hasStatus ? (statusAge != null && statusAge <= 2 * 864e5 ? 'fresh' : 'stale') : 'never',
      lastUpdated: lastT,
      ageMinutes: statusAge != null ? Math.round(statusAge / 60000) : undefined,
      days: Object.keys(this.state.statusDaily ?? {}).length,
      samples: timeline.length,
      note: '由 dailyStatus.ts 算法产出（HRV/RHR/睡眠/相位）；依赖实时流与 backfill',
    });

    // 2) 周期/经期相位：戒指回传 female + 本地 cycleLog(用户记录) + periodLog；相位为日历推算(非实测)
    const f = this.state.female;
    const lc = this.localCycle;
    const candidates: number[] = [];
    if (f && f.lastMenstrualDate) { const m = parseDayKey(f.lastMenstrualDate); if (Number.isFinite(m)) candidates.push(m); }
    if (lc && lc.lastPeriodStart) { const m = parseDayKey(lc.lastPeriodStart); if (Number.isFinite(m)) candidates.push(m); }
    if (lc && Array.isArray((lc as any).history)) for (const h of (lc as any).history) { const m = parseDayKey(h); if (Number.isFinite(m)) candidates.push(m); }
    const latestStart = candidates.length ? Math.max(...candidates) : NaN;
    const cycleKnown = Number.isFinite(latestStart);
    const cycleAge = cycleKnown ? now - latestStart : undefined;
    const STALE = 150 * 864e5; // 5 个月未记录 → 视为需重新记录
    out.push({
      key: 'cycle',
      label: '周期/经期相位',
      cadence: '用户记录(手动)+连上读戒指female+体温确认；相位日历推算(非实测)',
      status: !cycleKnown ? 'never' : (cycleAge != null && cycleAge <= STALE ? 'fresh' : 'stale'),
      lastUpdated: cycleKnown ? latestStart : undefined,
      ageMinutes: cycleAge != null ? Math.round(cycleAge / 60000) : undefined,
      days: lc && Array.isArray((lc as any).history) ? (lc as any).history.length : (cycleKnown ? 1 : 0),
      samples: 0,
      note: '经期主记录=戒指female∪本地cycleLog；相位由 cycleMath.ts 推算(非硬件实测)',
    });

    // 3) 睡眠：结构化 SleepSummary（total/deep/light/rem/score/getUp），原生睡眠分析产出，连上回填
    const sleepLast = healthStore.getLastUpdated('sleep');
    const sleepDays = healthStore.sleepDayCount();
    const sleepAge = sleepLast != null ? now - sleepLast : undefined;
    out.push({
      key: 'sleep',
      label: '睡眠 Sleep',
      cadence: '每晚一次（含多段睡眠）；连上回填',
      status: sleepLast == null ? 'never' : (sleepAge != null && sleepAge <= 7 * 864e5 ? 'fresh' : 'stale'),
      lastUpdated: sleepLast ?? undefined,
      ageMinutes: sleepAge != null ? Math.round(sleepAge / 60000) : undefined,
      days: sleepDays,
      samples: 0,
      note: '由原生睡眠分析产出；RingBleManager.handleSleepDay 归档到 healthStore.recordSleep',
    });

    return out;
  }

  /** 诊断快照：当前已落库的真实状态 + 9/3 HR 专项检查。不读设备，只读内存状态。 */
  getDebugDump(): Record<string, unknown> {
    const s = this.state;
    const SEP3 = '2026-9-3';
    const keys = (m: Record<string, unknown> | undefined) =>
      m ? Object.keys(m).sort() : [];
    const sep3HrVisible =
      s.hrDaily[SEP3] != null ||
      ((s.seriesByDay?.hr?.[SEP3]?.length ?? 0) > 0);
    const sep3HrSeries = (s.seriesByDay?.hr?.[SEP3] ?? []) as { t: number; v: number }[];
    return {
      status: s.status,
      protocol: s.protocol,
      syncEnabled: this.syncEnabled,
      lastSyncedAt: s.lastSyncedAt,
      lastBackfillAt: s.lastBackfillAt,
      // 实例方法存在性自检：如果 bundle 过期，这里会直接显示 false，解释为什么按钮报错。
      methodCheck: {
        hasForceResync: typeof (this as any).forceResync === 'function',
        hasExportDebugDump: typeof (this as any).exportDebugDump === 'function',
        hasGetDebugDump: typeof (this as any).getDebugDump === 'function',
        hasSyncBackfill: typeof (this as any).syncBackfill === 'function',
      },
      // 9/3 HR 专项：趋势图能否显示
      sep3HrVisibleOnTrend: sep3HrVisible,
      sep3HrDailyValue: s.hrDaily[SEP3] ?? null,
      sep3HrSampleCount: sep3HrSeries.length,
      sep3HrFirst3Points: sep3HrSeries.slice(0, 3).map((p) => ({
        t: new Date(p.t).toISOString(),
        v: p.v,
      })),
      sep3HrLast3Points: sep3HrSeries.slice(-3).map((p) => ({
        t: new Date(p.t).toISOString(),
        v: p.v,
      })),
      // 各信号历史日期（真实落库的 key，已统一为非补零 YYYY-M-D）
      hrDailyKeys: keys(s.hrDaily),
      seriesByDayHrKeys: keys(s.seriesByDay?.hr),
      spo2DailyKeys: keys(s.spo2Daily),
      tempDailyKeys: keys(s.tempDaily),
      hrvDailyKeys: keys(s.hrvDaily),
      edaDailyKeys: keys(s.edaDaily),
      stepDailyKeys: keys(s.stepDaily),
      sleepDailyKeys: keys(s.sleepDaily),
      extDailyKeys: keys(s.extDaily),
      ecgDailyKeys: keys(s.ecgDaily),
      rrDailyKeys: keys(s.rrDaily),
      // 最近 300 条内存日志：无需用户开日志服务，导出 dump 即我能看。
      recentLogs: getRecentLogs(300),
      // ★ healthStore（v2 单一数据源）诊断：每个指标最后更新时间 / 来源 / 样本数 / 天数
      healthStore: {
        diagnostics: healthStore.diagnostics(),
        freshness: [...healthStore.freshnessReport(), ...this.derivedFreshness()],
        sleepDays: healthStore.sleepDayCount(),
        glanceDays: healthStore.glanceDayCount(),
        last14DayKeys: healthStore.allDayKeys().slice(-14),
      },
    };
  }

  /** 导出诊断快照：写设备沙盒 + 自动 POST 到 Mac 日志收集服务（/dump），无需用户搬运文件。 */
  async exportDebugDump(): Promise<{ path: string; json: string }> {
    const json = JSON.stringify(this.getDebugDump(), null, 2);
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
    const path = `${dir}mira_debug_dump.json`;
    await FileSystem.writeAsStringAsync(path, json);
    postDump(json);
    return { path, json };
  }

  /** 读取身体成分档案（身高/体重/年龄/性别），未录入返回 null。 */
  getUserProfile(): { weight: number; height: number; age: number; sex: number } | null {
    return this.userProfile;
  }

  /**
   * 录入/更新身体成分档案。会落盘（快照）并立即下发戒指，
   * 使后续健康一览返回身体成分字段（bmi/体脂率/肌肉量/水分/骨量/基础代谢率…）。
   * sex: 0=女 1=男。
   */
  setUserInfo(p: { weight: number; height: number; age: number; sex: number }) {
    this.userProfile = p;
    void this.saveSnapshot();
    this.applyUserProfile();
  }

  /** 把已录入的档案下发戒指（native setUserInfo:weight:height:age:sex:）。 */
  private applyUserProfile() {
    if (!this.useNative || !this.userProfile || !VeepooNative) return;
    try {
      const p = this.userProfile;
      (this.native as any).setUserInfo(p.weight, p.height, p.age, p.sex);
    } catch {
      /* 下发失败静默：连接不稳时后续重连会再次尝试 */
    }
  }

  /** 读取「数据同步」开关当前值（持久化）。设置页开关初始化与连接回填判定都用它。 */
  getSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * 设置「数据同步」开关。唯一由设置页「数据同步」开关调用，是 backfill 的单一控制源。
   * 下次 saveSnapshot 会把新值落盘；关闭时不在此处触发反向清除（已落库数据仍保留，仅停止后续自动回填）。
   */
  setSyncEnabled(v: boolean) {
    this.syncEnabled = v;
    this.syncFlagLoaded = true;
    healthStore.syncEnabled = v;
    // 同步给原生：on 连接时 backfill 也受此开关约束（原生 markReadyAndStartIfNeeded → backfill 会自检 syncEnabled）
    this.native.setSyncEnabled(v);
    // 独立落盘，确保即便 App 随后被 ⌘R 也不会丢设置（不依赖快照是否有数据）。
    void this.persistSyncFlag();
  }

  /**
   * 手动上传本地戒指数据到云端（POST /v1/ring/sync）。
   * 仅由设置页「上传云端」按钮显式调用——本地数据始终保留，此操作完全由用户主动触发。
   * 把本地各日归档（步数/睡眠/HRV/核心指标日均/状态分 + 当前夜睡眠分期）打包成后端契约的 records envelope。
   * 后端校验仅要求 {channel, ts(int), payload(object)}，payload 多余字段会被原样存储。
   */
  async uploadRingData(): Promise<{ ok: boolean; count: number; error?: string }> {
    const st = this.state;
    const deviceId = st.deviceId || st.deviceName || 'mira-ring';
    const firmware = st.firmware || 'HK18';
    const records: Array<{ channel: string; ts: number; payload: Record<string, any> }> = [];

    // 把 'YYYY-M-D' / 'YYYY-MM-DD' 规整为本地 0 点的 epoch 秒，并归一化为 'YYYY-MM-DD'
    const norm = (dateKey: string): { ts: number; date: string } => {
      const t = new Date(dateKey + 'T00:00:00');
      const ts = Number.isFinite(t.getTime()) ? Math.floor(t.getTime() / 1000) : Math.floor(Date.now() / 1000);
      const d = Number.isFinite(t.getTime()) ? t : new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return { ts, date: `${y}-${m}-${dd}` };
    };

    const dates = new Set<string>([
      ...Object.keys(st.stepDaily),
      ...Object.keys(st.sleepDaily),
      ...Object.keys(st.hrvDaily),
      ...Object.keys(st.hrDaily),
      ...Object.keys(st.spo2Daily),
      ...Object.keys(st.tempDaily),
      ...Object.keys(st.edaDaily),
      ...Object.keys(st.rrDaily),
      ...Object.keys(st.statusDaily),
      ...Object.keys(st.extDaily),
      ...Object.keys(st.ecgDaily),
    ]);

    for (const dk of dates) {
      const step = st.stepDaily[dk];
      const sleep = st.sleepDaily[dk];
      const hr = st.hrDaily[dk];
      const spo2 = st.spo2Daily[dk];
      const temp = st.tempDaily[dk];
      const eda = st.edaDaily[dk];
      const rr = st.rrDaily[dk];
      const status = st.statusDaily[dk];
      const hasAuto =
        !!step || !!sleep || hr != null || spo2 != null || temp != null || eda != null || rr != null || status != null;
      if (hasAuto) {
        const { ts, date } = norm(dk);
        const payload: Record<string, any> = { date };
        if (step) {
          payload.steps = step.steps;
          payload.distance = step.distance;
          payload.calorie = step.calorie;
        }
        if (sleep) {
          payload.sleep = {
            total_sleep_min: sleep.total,
            deep_min: sleep.deep,
            light_min: sleep.light,
            rem_min: sleep.rem,
            score: sleep.score,
            get_up: sleep.getUp,
          };
        }
        if (hr != null) payload.hr_daily_mean = hr;
        if (spo2 != null) payload.spo2_daily_mean = spo2;
        if (temp != null) payload.temp_daily_mean = temp;
        if (eda != null) payload.eda_daily_mean = eda;
        if (rr != null) payload.rr_daily_mean = rr;
        if (status != null) payload.status_score = status;
        // 健康一览硬指标 + 光电血压 + ECG 平均心率（均来自 extDaily 归档）
        const ext = st.extDaily[dk];
        if (ext) {
          const extKeys = ['bloodSugar', 'bloodFat', 'triglyceride', 'hdl', 'ldl', 'uricAcid', 'bpSys', 'bpDia', 'ecg'] as const;
          for (const k of extKeys) {
            const v = ext[k];
            if (typeof v === 'number' && Number.isFinite(v)) payload[k] = v;
          }
        }
        records.push({ channel: 'auto_data', ts, payload });
      }
      const hv = st.hrvDaily[dk];
      if (hv != null) {
        const { ts, date } = norm(dk);
        records.push({ channel: 'hrv_history', ts, payload: { date, hrv_value: hv } });
      }
      // 离线/实时 ECG 记录（含波形）：逐个日期回传，后端原样存储 waveform
      const ecg = st.ecgDaily[dk];
      if (ecg) {
        const { ts, date } = norm(dk);
        records.push({
          channel: 'ecg',
          ts,
          payload: {
            date,
            ave_heart: ecg.aveHeart,
            ave_hrv: ecg.aveHrv,
            ave_res_rate: ecg.aveResRate,
            ave_qt: ecg.aveQT,
            ave_pwv: ecg.avePWV,
            waveform: ecg.waveform,
          },
        });
      }
    }

    // 当前夜睡眠分期（若有）→ sleep_stages（后端类型 0清醒/1浅睡/2深睡/3REM，需重映射）
    if (st.sleepStages && st.sleepStages.length && st.sleepSummary) {
      const remap: Record<number, number> = { 0: 2, 1: 1, 2: 3, 3: 0, 4: 0 };
      const stages = st.sleepStages.map((s) => remap[s.type] ?? 0);
      const startMin = st.sleepStages[0].start;
      const endMin = st.sleepStages[st.sleepStages.length - 1].end;
      const { ts, date } = norm(this.bucketDay);
      records.push({
        channel: 'sleep_stages',
        ts,
        payload: {
          date,
          start_ts: ts + startMin * 60,
          end_ts: ts + endMin * 60,
          epoch_min: endMin - startMin,
          stages,
        },
      });
    }

    if (records.length === 0) return { ok: false, count: 0, error: '暂无可导出的本地数据' };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (RING_SYNC_TOKEN) headers['Authorization'] = `Bearer ${RING_SYNC_TOKEN}`;
      const res = await fetch(`${BACKEND_BASE_URL}/v1/ring/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_id: deviceId,
          firmware,
          synced_at: Math.floor(Date.now() / 1000),
          records,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { ok: false, count: 0, error: `后端返回 ${res.status}: ${txt.slice(0, 200)}` };
      }
      const j = (await res.json().catch(() => ({}))) as any;
      const uploadedAt = Date.now();
      this.state = { ...this.state, lastUploadedAt: uploadedAt };
      return { ok: true, count: j.received ?? records.length };
    } catch (e: any) {
      return { ok: false, count: 0, error: e?.message || '网络错误（请确认手机与后端同一 WiFi）' };
    }
  }
}

export const RingBle = new RingConnectionImpl();
export const ringAccent = theme.colors.accentSolid;
