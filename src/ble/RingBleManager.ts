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
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
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
} from '../lib/dailyStatus';
import { computeHRV } from "../lib/hrvCompute";

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
  total: number; // 总时长（分钟）
  deep: number;  // 深睡（分钟）
  light: number; // 浅睡（分钟）
  rem: number;   // REM（分钟）
  score: number; // 睡眠评分（0-4 星级 → 这里直传 SDK 值）
  getUp: number; // 起夜次数
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
  /** 昨夜睡眠摘要（总/深/浅/REM/评分/起夜） */
  sleepSummary: SleepSummary | null;
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
  /** 最近一次手动「上传云端」成功的时间戳（秒），用于设置页展示上传时间；null = 从未上传。 */
  lastUploadedAt: number | null;
  /** 设备能力标志（连接后由原生 onPasswordVerified 上报）：ecgType(0无/1E/2G)、funcAssessmentType、
   *  healthGlanceType、supportManualTestType（位掩码：GSR=1<<12 / BP=1<<0 / HG=1<<9）。
   *  用于如实判断「心电/光电血压/抑郁风险」在当前戒指上能否测量，而非盲目调用。 */
  deviceCapabilities: { ecgType: number; funcAssessmentType: number; healthGlanceType: number; supportManualTestType: number } | null;
  /** ECG 实时测量进度（原生 onEcgProgress 回传）：progress=0~100，hr=当前心率（测量中）。非持久化，仅测量期间有效。 */
  ecgProgress: { progress: number; hr?: number } | null;
}

type StatePatch = Partial<RingState>;
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
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── 远程日志转发：把 [VeepooRing] 相关日志 POST 到本地收集服务，agent 直接读文件看，
// 日志转发目标：自动取 Metro/打包器的真实局域网 IP（即 RN bundle 的 scriptURL host），
// 不再写死 IP，避免 Mac 切换 Wi-Fi / 重拨后 JS 日志通道整体失效。fallback 到常用开发机地址。
let _logHost: string | null = null;
function getLogHost(): string {
  if (_logHost) return _logHost;
  try {
    const scriptURL = (NativeModules as any).SourceCode?.scriptURL as string | undefined;
    if (scriptURL) {
      const host = new URL(scriptURL).hostname;
      if (host) {
        _logHost = host;
        return host;
      }
    }
  } catch {
    /* ignore */
  }
  _logHost = '192.168.1.12';
  return _logHost;
}
function postLog(tag: string, msg: string) {
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
    private requestFlush: () => void
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
      this.emitter.addListener('onDeviceCapabilities', this.handleDeviceCapabilities);
      this.emitter.addListener('onBackfillComplete', () => { this.requestFlush(); });
      this.emitter.addListener('onLog', (msg: string) => {
        // eslint-disable-next-line no-console
        console.log('[VeepooRing]', msg);
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
          console.log(line);
          postLog('JS-RATE', `recv=${this.jsMetricCount}/2s ${parts}`);
          this.jsMetricCount = 0;
          this.jsMetricKeys = {};
        }
      }, 2000);
      // ★ 每 15s dump 一次关键归档的 9-3 值 — 直接回答"数据到底存了没"
      setInterval(() => {
        try {
          const s = this.getState();
          const dk = '2026-9-3';
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
          console.log(`[STATE_DUMP] 9-3: ${JSON.stringify(dump)}`);
          postLog('STATE_DUMP', JSON.stringify(dump));
        } catch(e) {}
      }, 15000);
    }
  }

  get available(): boolean {
    return !!VeepooNative;
  }

  private handleState = (raw: Record<string, any>) => {
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
    const v = num(m.value);
    if (v == null) return;
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
      this.push({
        sleepStages: segs.length ? segs : null,
        sleepSummary: summary.total > 0 ? summary : null,
        sleepTime: raw.sleepTime ?? null,
        wakeTime: raw.wakeTime ?? null,
      });
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
      this.push({ ecg: reading, ecgProgress: null });
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
      const patch: StatePatch = { ecgDaily: { ...curEcg, [date]: reading } };
      const todayKey = dayKeyOf(Date.now());
      if (date === todayKey) patch.ecg = reading; // 今日的 ECG 立即在 ECG 卡片可见
      // 平均心率作为 ecg 信号归档（多日趋势）；呼吸率(aveResRate)作为 rr 信号归档（避免单独 TestBreathingRateStart 掐断实时 HR/SpO₂）
      const curExt = this.getState().extDaily;
      const prevDay = curExt[date] ?? {};
      patch.extDaily = { ...curExt, [date]: { ...prevDay, ecg: reading.aveHeart } };
      if (reading.aveResRate > 0) {
        patch.rrDaily = { ...this.getState().rrDaily, [date]: reading.aveResRate };
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
      const prevDay = curExt[date] ?? {};
      postLog('JS', `[handleHealthGlanceDay] date=${date} keys=${Object.keys(clean).join(',')}`);
      this.push({ extDaily: { ...curExt, [date]: { ...prevDay, ...clean } } });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日 HRV 回填：原生 backfill 按日读 HRV 历史并带 dateKey 回传，这里落库到 hrvDaily。 */
  private handleHrvDay = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      postLog('JS', `[handleHrvDay] date=${raw.date} value=${raw.value}`);
      const date = String(raw.date);
      const cur = this.getState().hrvDaily;
      const patch: StatePatch = { hrvDaily: { ...cur, [date]: raw.value } };
      // 今日 HRV 立即落到 metrics.hrv / daily['hrv']，让「今日状态」种子（只用今日输入）即时可用，
      // 不必等 syncExtendedDaily 兜底链。todayKey 直接取墙钟今日（handleHrvDay 在内部类，无 bucketDay）。
      const todayKey = dayKeyOf(Date.now());
      if (date === todayKey) {
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
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      const date = String(raw.date);
      const cur = this.getState().hrDaily;
      const patch: StatePatch = { hrDaily: { ...cur, [date]: raw.value } };
      // 今日心率立即落到 metrics.hr / daily['hr']，让「今日状态」与心率卡即时可用，
      // 不必等 syncExtendedDaily 兜底链。todayKey 直接取墙钟今日（handleHrDay 在内部类，无 bucketDay）。
      const todayKey = dayKeyOf(Date.now());
      if (date === todayKey) {
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
    samples?: Array<{ t?: string; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dayKeyOf(new Date(`${date} 00:00`).getTime());
      const todayKey = dayKeyOf(Date.now());
      // 解析全部样本为带绝对 ts 的 TimePoint，按 ts 排序
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const t = s.t;
        const v = num(s.v);
        if (typeof t !== 'string' || t.length === 0 || v == null || v <= 0) continue;
        const ts = new Date(`${date} ${t}`).getTime();
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
      // 按天存储（所有回溯日都存）→ 历史日详情页画连续曲线
      const prevByDay = this.getState().seriesByDay['hrv'] ?? {};
      const merged = mergeDaySeries(prevByDay[sampleDayKey], parsed);
      const patch: StatePatch = { seriesByDay: { ...this.getState().seriesByDay, hrv: { ...prevByDay, [sampleDayKey]: merged } } };
      // 今日：额外喂实时连续序列（history.hrv）+ 卡片当前值
      if (sampleDayKey === todayKey) {
        let latest: number | null = null;
        let latestTs = this.lastHrvIngestTs;
        for (const p of parsed) {
          if (p.t <= this.lastHrvIngestTs) continue; // 今日去重：只 ingest 新样本
          // 走 pushMetric → applyMetric → ingest('hrv', v, ts)，进入当日连续序列
          this.pushMetric({ key: 'hrv', value: p.v, unit: 'ms', ts: p.t });
          latest = p.v;
          latestTs = p.t;
        }
        if (latest != null) {
          this.lastHrvIngestTs = latestTs;
          patch.metrics = { ...this.getState().metrics, hrv: latest };
          patch.daily = { ...this.getState().daily, hrv: latest };
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
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dayKeyOf(new Date(`${date} 00:00`).getTime());
      const todayKey = dayKeyOf(Date.now());
      // 解析全部样本为带绝对 ts 的 TimePoint，按 ts 排序
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const t = s.t;
        const v = num(s.v);
        if (typeof t !== 'string' || t.length === 0 || v == null || v <= 0) continue;
        const ts = new Date(`${date} ${t}`).getTime();
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
      // 按天存储（所有回溯日都存）→ 历史日详情页画连续曲线
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
    } catch {
      /* 静默 */
    }
  };

  /** 历史/离线血氧连续样本：原生 backfill 把设备库「每分钟一条」血氧样本（带 HH:MM）按天 emit 出来，
   *  合并进 seriesByDay['spo2']（跨天时间桶），历史日详情页即可画连续血氧曲线。
   *  实时血氧仍由 handleMetric 走 pushMetric 喂当日实时序列，这里只负责按天归档样本。 */
  private handleSpo2Samples = (raw: {
    date?: string;
    samples?: Array<{ t?: string; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dayKeyOf(new Date(`${date} 00:00`).getTime());
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const t = s.t;
        const v = num(s.v);
        if (typeof t !== 'string' || t.length === 0 || v == null || v <= 0) continue;
        const ts = new Date(`${date} ${t}`).getTime();
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
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
    samples?: Array<{ t?: string; v?: number }>;
  }) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date); // yyyy-MM-dd
      const sampleDayKey = dayKeyOf(new Date(`${date} 00:00`).getTime());
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const t = s.t;
        const v = num(s.v);
        if (typeof t !== 'string' || t.length === 0 || v == null || v <= 0) continue;
        const ts = new Date(`${date} ${t}`).getTime();
        if (!Number.isFinite(ts)) continue;
        parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) return;
      parsed.sort((a, b) => a.t - b.t);
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
    samples?: Array<{ t?: string; v?: number }>;
  }, signalKey: string) => {
    try {
      if (!raw || !raw.date || !Array.isArray(raw.samples) || raw.samples.length === 0) return;
      const date = String(raw.date);
      const sampleDayKey = dayKeyOf(new Date(`${date} 00:00`).getTime());
      const parsed: TimePoint[] = [];
      for (const s of raw.samples) {
        const t = s.t;
        const v = num(s.v);
        if (typeof t !== "string" || t.length === 0 || v == null || v <= 0) continue;
        let ts: number | null = null;
        const hmMatch = t.match(/^(\\d{1,2}):(\\d{2})$/);
        if (hmMatch) {
          const h = parseInt(hmMatch[1]);
          const m = parseInt(hmMatch[2]);
          ts = new Date(`${date} ${h}:${m}:00`).getTime();
        } else {
          const numT = Number(t);
          if (Number.isFinite(numT) && numT > 1000000000000) {
            ts = numT;
          } else {
            console.log(`[handleDayBucketSamples] ${signalKey} 无法解析 slotKey="${t}", 跳过`);
            continue;
          }
        }
        if (ts != null && Number.isFinite(ts)) parsed.push({ t: ts, v });
      }
      if (parsed.length === 0) {
        console.log(`[handleDayBucketSamples] ${signalKey} ${date} parsed=0 first_slotKey=${raw.samples[0]?.t}`);
        return;
      }
      parsed.sort((a, b) => a.t - b.t);
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
      console.log(`[handleDayBucketSamples] ${signalKey} error: ${e}`);
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

  /** 历史日睡眠回填：原生 backfill 读设备库睡眠，带 dateKey 回传，落库到 sleepDaily。 */
  private handleSleepDay = (raw: {
    date?: string;
    total?: number;
    deep?: number;
    light?: number;
    rem?: number;
    score?: number;
    getUp?: number;
    summary?: any;
    segments?: any[];
  }) => {
    try {
      if (!raw || !raw.date) return;
      // 兼容原生两种 payload：当前 HK18/QH15 发扁平字段；未来固件可能发嵌套 summary
      const sm = raw.summary ?? raw;
      const v: SleepSummary = {
        total: num(sm.total) ?? 0,
        deep: num(sm.deep) ?? 0,
        light: num(sm.light) ?? 0,
        rem: num(sm.rem) ?? 0,
        score: num(sm.score) ?? 0,
        getUp: num(sm.getUp) ?? 0,
      };
      if (v.total <= 0) return; // 当天无睡眠记录不落库
      const cur = this.getState().sleepDaily;
      // 若未来原生直发精准分期则优先用真值，否则用真实时长合成 hypnogram
      const segs: SleepSegment[] =
        Array.isArray(raw.segments) && raw.segments.length
          ? raw.segments
              .map((s: any) => ({ type: Number(s.type), start: Number(s.start), end: Number(s.end) }))
              .filter((s: any) => Number.isFinite(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end))
          : this.synthesizeSleepStages(v);
      this.push({
        sleepDaily: { ...cur, [String(raw.date)]: v },
        sleepSummary: v.total > 0 ? v : null,
        sleepStages: segs.length ? segs : null,
      });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日计步回填：原生 backfill 读设备库计步，带 dateKey 回传，落库到 stepDaily。 */
  private handleStepDay = (raw: {
    date?: string;
    steps?: number;
    distance?: number;
    calorie?: number;
  }) => {
    try {
      if (!raw || !raw.date) return;
      const cur = this.getState().stepDaily;
      const v = {
        steps: num(raw.steps) ?? 0,
        distance: num(raw.distance) ?? 0,
        calorie: num(raw.calorie) ?? 0,
      };
      if (v.steps <= 0) return;
      postLog('JS', `[handleStepDay] date=${raw.date} steps=${v.steps} dist=${v.distance} cal=${v.calorie}`);
      this.push({ stepDaily: { ...cur, [String(raw.date)]: v } });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日血氧回填：原生 backfill 逐日查库读出当天血氧均值，落库到 spo2Daily。 */
  private handleSpo2Day = (raw: { date?: string; value?: number }) => {
    try {
      if (!raw || !raw.date || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      const date = String(raw.date);
      const cur = this.getState().spo2Daily;
      const patch: StatePatch = { spo2Daily: { ...cur, [date]: raw.value } };
      const todayKey = dayKeyOf(Date.now());
      // 今日血氧立即落到 metrics.spo2 / daily['spo2']，让实时流/今日状态即时可用
      if (date === todayKey) {
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
      const cur = this.getState().tempDaily;
      const patch: StatePatch = { tempDaily: { ...cur, [date]: raw.value } };
      const todayKey = dayKeyOf(Date.now());
      // 今日体温立即落到 metrics.temp / daily['temp']，与实时 healthGlance 体温同源（℃）
      if (date === todayKey) {
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
  measure(k: string) { VeepooNative?.measure(k); }
  stopEcg() { VeepooNative?.stopEcg?.(); }
  flash() { VeepooNative?.findDevice(); }
  /** 重连后回填历史日数据（戒指离线期间累积的）：原生按日读 HRV 等历史并带日期回传。 */
  backfill() { VeepooNative?.backfill?.(); }
  /** 把「数据同步」开关推给原生：唯一控制 backfill 的来源（调试卡片不再参与控制）。 */
  setSyncEnabled(on: boolean) { VeepooNative?.setSyncEnabled?.(on); }
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
        console.log('[RingBle] 设备已绑定但最近未同步（探针未实时采集），仍展示已存真实数据。');
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
    if (this.deviceTimer) {
      clearInterval(this.deviceTimer);
      this.deviceTimer = null;
    }
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
  private listeners = new Set<StateListener>();
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
    sleepSummary: null,
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
    lastSyncedAt: null,
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
    lastUploadedAt: null,
    ecgProgress: null,
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
  /** 身体成分档案（身高/体重/年龄/性别）：录入后下发戒指，健康一览才会返回身体成分字段。 */
  private userProfile: { weight: number; height: number; age: number; sex: number } | null = null;
  private pendingMetrics: MetricEvent[] | null = null;
  private metricFlushQueued = false;
  /** 心跳时间戳滑动窗口：收集逐拍时间戳，用于反算 HRV（RMSSD） */
  private hrBeatQueue: number[] = [];
  /** HRV 反算窗口：最近 30 分钟的心跳数据足够算出稳定 RMSSD */
  private static readonly HR_BEAT_WINDOW_MS = 30 * 60 * 1000;
  /** 每 5 分钟重算一次 HRV，保证趋势流畅 */
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
      () => this.flushNow()
    );
    this.backend = new BackendRingSource((patch) => this.applyPatch(patch));

    const wantNative = RING_DATA_SOURCE === 'native';
    this.useNative = wantNative && this.native.available;
    if (wantNative && !this.native.available) {
      // eslint-disable-next-line no-console
      console.warn('[RingBle] 原生 VeepooRing 模块不可用（非 iOS 真机或未 prebuild），回退后端客户端。');
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
  }

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
    this.state = { ...this.state, ...patch };
    // 连上戒指即自动开启原生「自动监测」（实时 HR/SpO₂ + 体温/皮电轮询 + HRV 历史读取），
    // 不再依赖用户在设置页手动拨开关——之前 autoMonitor 默认 false 且不持久化，
    // 重建/重连后原生 monitorOn 永远是 false，导致戒指一条数据都不传（collector.log 里 raw=0）。
    if (patch.status === 'connected') {
      this.state = { ...this.state, lastSyncedAt: Date.now() };
      if (this.useNative) {
        this.autoMonitor = true;
        this.native.setAutoMonitor(true);
        // 身体成分档案：连上即把已录入的身高/体重/年龄/性别下发戒指，
        // 使健康一览能返回身体成分字段（bmi/体脂率/肌肉量/水分/骨量/基础代谢率…）。
        if (this.userProfile) this.applyUserProfile();
        // 仅在「数据同步」开关开启时，连接成功才触发历史回填；
        // 开关状态由设置页「数据同步」控制（RingBle.syncEnabled），调试卡片不参与控制。
        if (this.syncEnabled) this.native.backfill();
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

  // ── HRV 主要取自设备历史库：原生 readHistoricalHrv 每 300s 调一次 backfillDayHrv
  //   （veepooSDKGetDeviceHrvDataWithDate:andTableID:，键 hrvValue，与 backfill 同一条已验证通路）并 emit onHrvDay。
  //   下方 flushPendingMetrics 仍保留「基于逐拍 HR 时间戳的 JS 反算」作为实时补充——
  //   仅当原生 HR 回调确为逐拍（相邻 ts 差≈真实 RR 间期）且有效 RR≥10 时才写，否则自动跳过，不污染数值。
  private applyMetric(m: MetricEvent) {
    // 原生自动监测可能每秒推送多次（心率/血氧等），直接每次 setState 会引发
    // re-render 风暴把主线程卡死。这里合并到下一个微任务批量提交一次 state。
    if (!this.pendingMetrics) this.pendingMetrics = [];
    this.pendingMetrics.push(m);
    if (!this.metricFlushQueued) {
      this.metricFlushQueued = true;
      queueMicrotask(() => this.flushPendingMetrics());
    }
  }

  private flushPendingMetrics() {
    this.metricFlushQueued = false;
    const batch = this.pendingMetrics;
    this.pendingMetrics = null;
    if (!batch || batch.length === 0) return;
    const metrics = { ...this.state.metrics };
    const availability = { ...this.state.availability };
    const lastUpdated = { ...this.state.lastUpdated };
    const daily = { ...this.state.daily };
    const dailyHistory = { ...this.state.dailyHistory };
    // 健康一览扩展指标 / 手动测量（血压/ECG）按天归档：extDaily[dateKey][key] = value
    // 供周/月/年跨天历史（realSeries 读取）。仅在今日有值才写，避免 null 污染归档。
    const extDaily = { ...this.state.extDaily };
    const bucketDay = this.bucketDay || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    })();
    for (const m of batch) {
      if (CORE_KEYS.includes(m.key as MetricKey)) {
        const k = m.key as MetricKey;
        metrics[k] = m.value;
        this.ingest(k, m.value, m.ts ?? Date.now());
        availability[k] = 'live';
        lastUpdated[k] = m.ts ?? Date.now();
      } else {
        // 扩展指标：存最新值，并增量写入 15 分钟时间槽以累积全天趋势曲线
        daily[m.key] = m.value;
        const t = m.ts ?? Date.now();
        this.ingestExt(m.key, m.value, t);
        dailyHistory[m.key] = this.deriveExtHistory(m.key);
        // 按天归档（今日），供跨天历史（浅拷贝当天对象，避免改动旧 state 嵌套引用）
        const prevDay = extDaily[bucketDay] ?? {};
        extDaily[bucketDay] = { ...prevDay, [m.key]: m.value };
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
          this.hrBeatCount = this.hrBeatQueue.length;
          this.lastHrvComputeTs = nowMs;
          console.log(`[HRV 反算] RMSSD=${hrvResult.rmssd.toFixed(1)}ms beats=${hrvResult.rrCount}`);
        }
      }
    }
    // 体温：把今日日均写入 tempDaily（跨天累积，供周期双相曲线）
    const tempDaily = { ...this.state.tempDaily };
    const todayTemp = this.deriveHistory('temp');
    if (todayTemp.length) {
      const avg = todayTemp.reduce((s, p) => s + p.v, 0) / todayTemp.length;
      tempDaily[this.bucketDay] = avg;
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
    if (hrMean != null) hrDaily[this.bucketDay] = hrMean;
    const spo2Daily = { ...this.state.spo2Daily };
    const spo2Mean = dailyMean('spo2');
    if (spo2Mean != null) spo2Daily[this.bucketDay] = spo2Mean;
    const edaDaily = { ...this.state.edaDaily };
    const edaMean = dailyMean('eda');
    if (edaMean != null) edaDaily[this.bucketDay] = edaMean;
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
    // [DIAG] stress/cortisol dailyHistory 状态
    try {
      const ns = dailyHistory['stress']?.length ?? 0;
      const nc = dailyHistory['cortisol']?.length ?? 0;
      console.log(`[STRESS_DIAG] dailyHist_stress=${ns} dailyHist_cortisol=${nc} extBuckets_keys=${Object.keys(this.extBuckets || {}).join(',')}`);
    } catch(e) {}
    // ★ 把扩展信号（stress/cortisol/emotion/skin/fatigue/bpSys/bpDia/bloodSugar/bloodFat/uricAcid/triglyceride/hdl/ldl/snsActivation）
    // 的实时均值也写入 extDaily[today] — 这样 MetricDetail 周/月/年视图的 dailyValueFor(sk) 就能取到值
    const EXT_SIGNAL_KEYS = [
      'stress', 'cortisol', 'emotion', 'skin', 'fatigue', 'snsActivation',
      'bpSys', 'bpDia', 'bloodSugar', 'bloodFat', 'uricAcid', 'triglyceride', 'hdl', 'ldl', 'met',
    ];
    const todayKey = this.bucketDay || (() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; })();
    const curExt = { ...this.state.extDaily };
    const prevDay = curExt[todayKey] ?? {};
    let extDirty = false;
    for (const sk of EXT_SIGNAL_KEYS) {
      if (prevDay[sk] != null && prevDay[sk] > 0) continue;
      const m = (this.state.metrics as unknown as Record<string, number | null>)[sk];
      if (typeof m === 'number' && m > 0) {
        prevDay[sk] = m;
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

    // 今日 key：优先 bucketDay（与归档同格式 'YYYY-M-D'），未初始化时回退当天
    const today =
      this.bucketDay ||
      (() => {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      })();

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

    // 健康一览扩展指标（血脂/心理/血压/身体成分）+ 手动测量（血压/ECG）跨天投影
    const allExtDates = Array.from(new Set([...allDates, ...Object.keys(st.extDaily)])).sort();
    const extSeries = (k: string): TimePoint[] =>
      allExtDates
        .map((d) => ({ t: tsOf(d), v: st.extDaily[d]?.[k] ?? null }))
        .filter((p): p is TimePoint => p.v != null && Number.isFinite(p.v));
    const extKeys = new Set<string>();
    for (const dk of Object.keys(st.extDaily)) for (const k of Object.keys(st.extDaily[dk])) extKeys.add(k);
    for (const k of extKeys) {
      const tv = st.extDaily[today]?.[k];
      if (tv != null) daily[k] = tv;
      dailyHistory[k] = extSeries(k);
    }

    this.state = { ...this.state, daily, metrics, dailyHistory, hrvDaily, hrDaily };
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
    const entries = Object.entries(this.state.sleepDaily)
      .filter(([k]) => k <= todayKey)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return entries.length ? (entries[0][1] as any) : null;
  }

  private recomputeDailyStatus(now: number = Date.now(), force = false) {
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
    const ss = this.state.sleepSummary;
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
        const startPt: CurvePoint = {
          t: now,
          value: seed.value,
          level: curveLevel(seed.value, CURVE_DEFAULTS).level,
        };
        this.state.statusTimeline = [
          ...this.state.statusTimeline.filter((p) => isSameDay(p.t, now)),
          startPt,
        ].slice(-STATUS_TIMELINE_CAP);
        this.lastCurveAccumTs = now;
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
      const due = force || this.lastCurveAccumTs == null || now - this.lastCurveAccumTs >= STATUS_SNAPSHOT_MS;
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
        const point: CurvePoint = {
          t: now,
          value: nextValue,
          level: curveLevel(nextValue, CURVE_DEFAULTS).level,
        };
        this.state.statusTimeline = [...this.state.statusTimeline, point].slice(-STATUS_TIMELINE_CAP);
        this.lastCurveAccumTs = now;
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
    if (!curve || curve.seed.value == null) {
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
    const hrv = this.state.hrvDaily;
    const sleep = this.state.sleepDaily;
    const days = new Set<string>([...Object.keys(hrv), ...Object.keys(sleep)]);
    if (days.size === 0) return;
    const cycle = this.resolveCycle();
    const todayKey = this.bucketDay;
    let statusDaily = this.state.statusDaily;
    let changed = false;
    for (const dk of days) {
      if (dk === todayKey) continue;
      const hv = hrv[dk];
      const sl = sleep[dk];
      if (hv == null && !sl) continue;
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
      if (seed.value != null && Number.isFinite(seed.value) && statusDaily[dk] !== seed.value) {
        statusDaily = { ...statusDaily, [dk]: seed.value };
        changed = true;
      }
    }
    if (changed) {
      this.state = { ...this.state, statusDaily };
      this.emit();
    }
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

  /** 「数据同步」开关独立持久化文件：不依赖快照是否有数据，确保开关状态总能落盘/恢复。 */
  private syncFlagPath(): string | null {
    if (!FileSystem.documentDirectory) return null;
    return FileSystem.documentDirectory + 'mira_ring_sync_flag_v1.json';
  }
  private async loadSyncFlag() {
    const path = this.syncFlagPath();
    if (!path) return;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return; // 默认 true
      const raw = await FileSystem.readAsStringAsync(path);
      const o = JSON.parse(raw) as { syncEnabled?: boolean };
      if (typeof o.syncEnabled === 'boolean') {
        this.syncEnabled = o.syncEnabled;
        // 恢复即同步给原生，保证 on 连接行为受开关约束
        this.native.setSyncEnabled(this.syncEnabled);
      }
    } catch {
      /* 损坏则忽略，回落默认 true */
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
        statusTimeline: this.state.statusTimeline,
        statusDaily: this.state.statusDaily,
        statusTimelineByDay: this.state.statusTimelineByDay,
        metrics: this.state.metrics,
        extDaily: this.state.extDaily,
        ecg: this.state.ecg,
        ecgDaily: this.state.ecgDaily,
        lastUploadedAt: this.state.lastUploadedAt,
        availability: this.state.availability,
        lastUpdated: this.state.lastUpdated,
        syncEnabled: this.syncEnabled,
        userProfile: this.userProfile,
      };
      await FileSystem.writeAsStringAsync(path, JSON.stringify(snap));
    } catch {
      /* 写盘失败静默：绝不阻塞 App */
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
      if (snap.statusTimeline) patch.statusTimeline = snap.statusTimeline;
      if (snap.statusDaily) patch.statusDaily = snap.statusDaily;
      if (snap.statusTimelineByDay) patch.statusTimelineByDay = snap.statusTimelineByDay;
      if (snap.metrics) patch.metrics = snap.metrics;
      if (snap.availability) patch.availability = snap.availability;
      if (snap.lastUpdated) patch.lastUpdated = snap.lastUpdated;
      if (typeof snap.syncEnabled === 'boolean') this.syncEnabled = snap.syncEnabled;
      if (snap.userProfile && typeof snap.userProfile === 'object') this.userProfile = snap.userProfile;
      this.applyPatch(patch);
      // reconcile：把恢复的「当日」时间槽反推回各自 *Daily（即使戒指尚未重连，最后活跃日也不丢）
      this.syncDailyFromBuckets();
      postLog('RingBle', '已从本地持久化恢复真实数据（跨 ⌘R 保留趋势曲线）');
    } catch {
      /* 快照损坏则忽略，从头开始 */
    }
  }

  onState(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
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

  /** 主动触发一次历史回填（戒指离线期间累积的数据拉回 App）。仅在原生可用时有效。 */
  syncBackfill() {
    if (this.useNative) this.native.backfill();
  }

  /** 立即落盘（不经 5s 防抖）。backfill 完成后由原生 onBackfillComplete 事件触发，确保刚拉回的历史数据立刻写盘，避免切走/被杀进程丢数据。 */
  flushNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.saveSnapshot();
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
