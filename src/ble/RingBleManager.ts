/**
 * RingBleManager —— mira-app 的真实戒指数据层
 *
 * 方案 A：App 自己直连戒指（上架正路）
 *   HK18 的权威协议是 Veepoo 官方 iOS SDK（VeepooBleSDK.framework，预编译原生 framework）。
 *   React Native 无法桥接它，因此本文件通过一层 ObjC 原生桥 `VeepooRing`
 *   （见 ios/VeepooRing/VeepooRing.m + plugins/withVeepooSDK.js）包裹 SDK：
 *     mira-app --(NativeModules)--> VeepooRing --(VeepooBleSDK)--> HK18 戒指
 *   原生桥把扫描/连接/今日状态/心率/血氧/体温/皮电(EDA)/HRV/呼吸率 通过事件推给 JS。
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
import { BACKEND_BASE_URL, RING_DATA_SOURCE } from '../config';
// ★ Phase 1：设备令牌（按 device_id 隔离的云端访问凭证）
import { authHeaders, ensureDeviceToken } from '../data/ringIdentity';
// ★ 2026-11-05：两套戒指数据源隔离（旧 HK18 数据不得混进当前戒指）+ 体温合法性校验
import { trustedCurrentRingDeviceId, isBlockedRingDeviceId, saneBodyTemp } from '../data/ringDataIsolation';
import { ringUploadExtFields } from '../lib/ringUploadFields';
import {
  computeCycle,
  daysBetween,
  tempDailyToSeries,
  type CycleInfo,
  type CycleLog,
} from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { healthStore, dayKey, parseDayKey, type MetricKey as HSMetricKey } from '../data/healthStore';
import { parseClockMinutes, fmtClockHM, sleepClockToMs, sleepSummaryDateOf, sleepSegmentsDateOf } from '../lib/sleepTime';
import { estimateOfflineMetricsRecent } from '../lib/offlineEstimates';
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
import { scheduleRecompute, scheduleRecomputeMany, flushAll } from '../lib/recomputePipeline';
// ★ 2026-11-04（用户定稿）：设备识别改能力字段驱动（Veepoo SDK *Type），替代读 BLE DIS 0x2A24。
//   连接就绪后原生透传 capabilities，据此动态判定 Pro/基础版（有就展示）。
import {
  applyProfileFromCapabilities,
  applyProfileFromDevice,
  resolveProfileByModel,
  getStoredDeviceInfo,
  getDeviceProfileId,
  getProfile,
  DEFAULT_DEVICE_PROFILE,
} from '../config/deviceModel';

/** 今日状态每 30 分钟落一个快照；48 × 30min = 24h 滚动窗口 */
const STATUS_SNAPSHOT_MS = 30 * 60 * 1000;
/** ★ v18.100 断流阈值：超过这么久没有真实采样，就认为戒指当前没在给 App 传数据，
 *  页面上所有「今日/实时」数字（恢复/脑力/情绪/圆环）一律置空态，不许再挂旧快照的值。 */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // ★ v18.121 已不再用于 dataStale 判定（改为「从未采到过数据」），保留常量供他处引用

/** 当日曲线上下文：晨间种子 + 日间基线 + 跨窗口滑动状态 */
interface DailyCurveSeed {
  dayKey: string;
  seed: SeedResult;
  baseline: DaytimeBaseline;
  /** 上次累积时的当日累计步数（用于本窗口步数增量） */
  lastWindowSteps: number | null;
  /** 上次见到戒指（有数据刷新）的时刻，用于佩戴中断 >2h 软重置 */
  lastWearTs: number | null;
  /** ★ v18.95：晨间种子用的睡眠回退归档日期（'YYYY-M-D'）；null = 用的是今日 sleepSummary。
   *  非 null 时头条文案标注「睡眠为 M/D 数据」，不再静默拿旧夜数据冒充昨夜。 */
  seedSleepFallbackDate?: string | null;
  /** ★ v18.96 逻辑B：本次种子是否用到了「今日睡眠」输入。false = 当初算种子时还没有睡眠数据
   *  （例如 00:05 夜里先有 HRV、清晨才回传昨夜睡眠）→ 睡眠落地后需要用新数据重算补齐。 */
  seedHadTodaySleep?: boolean;
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

/** 连接成功时由原生从 Veepoo `VPPeripheralModel` 读取的设备身份 + 运动能力快照。
 *  - `deviceNumber` / `deviceVersion` / `CPUType` / `fiveProtocolType` 用于判定具体 Veepoo 模组（QX17/JH58 等）。
 *  - `runningType`=1 表示固件支持「10 种多运动」分类；`runningSaveTimes`>0 表示有运动模式；`isSupportMotionState` 表示支持运动状态上报。
 *  这些值只能连接成功时由 SDK 现场给出，静态代码无法预知，故需连上后由原生上报。 */
export interface RingModuleInfo {
  deviceNumber: number;
  deviceVersion: string;
  CPUType: number;
  fiveProtocolType: number;
  runningType: number;
  runningSaveTimes: number;
  isSupportMotionState: boolean;
  motionState: number;
}

/** 戒指已记录的一段运动（固件按类型分类，由原生 readDeviceSportWithCRC: 读出透传）。
 *  `typeName` 由原生按 Veepoo VPDeviceRuningMode 枚举映射（户外跑步/骑行/游泳/瑜伽/… 约 50 种）。 */
export interface RingSportSession {
  type: number;
  typeName: string;
  beginTime: string;
  endTime: string;
  totalStep: number;
  totalDis: number;   // m
  totalCal: number;   // kcal
  averHeart: number;
  totalTime: number;  // s
}
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
    case 'hr': case 'spo2': case 'temp': case 'skinTemp': case 'eda': case 'hrv': case 'rr':
    case 'steps': case 'distance': case 'calorie':
    case 'stress': case 'fatigue': case 'met': case 'cortisol': case 'emotion': case 'skin':
    case 'bpSys': case 'bpDia':
    // ★ 2026-10-10：`sns` 是原生真实 emit key，加进直通名单（否则 hk=null → intraday 不落库）。
    //   `snsActivation` 保留为历史别名，向后兼容。
    case 'sns':
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
    // ★ 2026-10-16：协议补齐——血糖类型/等级、抑郁风险（key 修正后原生 emit depressionRisk）
    case 'glucoseType': case 'glucoseLevel': case 'depressionRisk':
    case 'ppgSys': case 'ppgDia': // 血压细分：光电血压（气囊值走 bpSys/bpDia）
      return signalKey as HSMetricKey;
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

/** ★ 2026-10-16：血氧呼吸暂停（OSAHS）分析——原生 triggerOxygenAnalysis 读取设备血氧历史后解析回传。 */
export interface OxygenAnalysis {
  osahsResult: -1 | 0 | 1 | 2 | 3;  // -1 无结果 / 0 正常 / 1 轻度 / 2 中度 / 3 重度
  osahsResultDes: string;           // 结果本地化描述
  aveOxygen: number;                // 平均血氧 %
  minOxygen: number;                // 最低血氧 %
  aveRespRate: number;              // 平均呼吸率
  minRespRate: number;
  maxRespRate: number;
  aveLowOxygenTime: number;         // 低氧时间（平均/最大）
  maxLowOxygenTime: number;
  aveCardiacLoad: number;           // 心脏负荷（平均/最大/最小）
  maxCardiacLoad: number;
  minCardiacLoad: number;
  aveSleepActivity: number;         // 睡眠活动（平均）
  freqTimes: string[];              // 呼吸暂停频现时段
  freqVals: number[];               // 频现时段对应次数
  ts: number;
}

/** ★ 2026-10-16：HRV Lorenz 散点——原生 readRrAnalysis 读取 RR 间期历史后回传。 */
export interface RrAnalysis {
  rr: number[];                     // RR 间期数组（ms，已过滤 200~2000 生理区间）
  lorentz: { x: number; y: number }[]; // Lorenz 散点（x=前一个RR, y=后一个RR）
  ts: number;
}

/** 由 RR 间期数组计算时域 HRV：SDNN / RMSSD / PNN50 / 平均心率（供 Lorenz 详情页展示）。 */
export function computeRrHrv(rr: number[]): { sdnn: number; rmssd: number; pnn50: number; meanHr: number } | null {
  if (!rr || rr.length < 10) return null;
  const n = rr.length;
  const mean = rr.reduce((a, b) => a + b, 0) / n;
  const sdnn = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let rmss = 0, cnt50 = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    const d = rr[i] - rr[i - 1];
    rmss += d * d;
    if (Math.abs(d) > 50) cnt50++;
    cnt++;
  }
  const rmssd = Math.sqrt(rmss / Math.max(1, cnt));
  const pnn50 = cnt > 0 ? (cnt50 / cnt) * 100 : 0;
  const meanHr = mean > 0 ? Math.round(60000 / mean) : 0;
  return { sdnn: Math.round(sdnn * 10) / 10, rmssd: Math.round(rmssd * 10) / 10, pnn50: Math.round(pnn50 * 10) / 10, meanHr };
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
  /** 连接成功时原生上报的模组身份 + 运动能力快照（判定 QX17/JH58 及是否支持多运动识别）。null = 尚未连接。 */
  deviceInfo: RingModuleInfo | null;
  /** 戒指已记录的运动段（固件按类型分类的多运动识别结果）。null = 尚未读取。 */
  sportSessions: RingSportSession[] | null;
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
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🔴#3）：**哪些天的分期图是合成的**。
   *   HK18/QH15 只返回各阶段「时长」、不返回逐分钟分期，SDK 无 curve/segments 时
   *   会用 synthesizeSleepStages() 按典型睡眠周期铺排出一张 hypnogram。
   *   各阶段「时长占比」= 实测值，但**夜内时间轴分布是编造的**，
   *   与真实分期曲线在视觉上无法区分 → 必须标记并在 UI 显式告知。
   */
  sleepStagesSynthesizedDays?: Record<string, 1>;
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
  sleepDaily: Record<string, {
    total: number; deep: number; light: number; rem: number; score: number; getUp: number;
    /** 入睡 / 起床时刻（已格式化为 "HH:mm"；睡眠窗推导、分期图时间轴依赖它） */
    sleepTime?: string | null; wakeTime?: string | null;
    /** 失眠 / 苏醒时长（分钟）—— 由 sleepLine 曲线逐分钟统计（原生不发这两个） */
    insomnia?: number; awake?: number; sdkScore?: number;
  }>;
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
  /** 今日状态曲线：每 30 分钟一个今日状态点（最多 48 点 = 24h），用于首页日内趋势 */
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
  /** ★ 2026-10-16（续）：ECG 测量过程中的实时波形缓冲（原生 onEcgProgress 增量回传、JS 在此累积）。仅测量期间有效，结果到达或中断即清空。 */
  ecgLiveWaveform: number[] | null;
  /** ★ 2026-10-16（续）：ECG 测量最近一次失败原因（导联脱落/设备忙/无效读数/超时）。常驻显示，便于用户看到失败原因而非只弹一下 Alert。测量开始或成功后清空。 */
  ecgError: string | null;
  /** ★ 2026-11-03：ECG 测量中的轻提示（原生 NotLead 前 2 次走 hint，如「请保持手指接触电极…」）。
   *  与 ecgError 不同：不清进度、不打断测量，测量推进或下次正常回调时自动清空。 */
  ecgHint: string | null;
  /** ★ 2026-10-16：血氧呼吸暂停分析结果（triggerOxygenAnalysis）。null = 未读取/读取失败。 */
  oxygenAnalysis: OxygenAnalysis | null;
  /** ★ 2026-10-16：HRV Lorenz 散点 + RR 间期（readRrAnalysis）。null = 未读取/读取失败。 */
  rrAnalysis: RrAnalysis | null;
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
/** ECG 多诊断报告（来源：Veepoo SDK resultReportWithModel，设备返回，非本地测算）。
 *  风险指数均为 [1,99] 区间；医学指标含 SDK 乘倍（×100 / ×10）的原始整数，展示时需换算。 */
export interface EcgAnalysis {
  arrhythmiaRisk?: number;     // 心律失常 [1,99]
  stressIndex?: number;        // 精神压力 [1,99]
  fatigueIndex?: number;       // 疲劳 [1,99]
  myocarditisRisk?: number;    // 心肌炎 [1,99]
  chdRisk?: number;            // 冠心病 [1,99]
  angiosclerosisRisk?: number; // 血管硬化 [1,99]
  qrsTime?: number;            // QRS 时限 ms
  qrsAmp?: number;             // QRS 振幅 mv×100
  stMeanAmp?: number;          // ST 段振幅 mv×100（[-5,10] 正常）
  pwvMeanVal?: number;         // PWV 均值 m/s×10（>150 异常）
  sdnn?: number;               // SDNN ms（(141±39)）
  rmssd?: number;              // RMSSD ms（(27±12)）
  qtc?: number;                // QTc（本地 Bazett 计算：aveQT/√RR）ms
  riskParamArr?: (string | number)[]; // 32 种疾病风险等级
}

/** 单次 ECG 实时测量读数（HK18 硬件支持）。waveform 为原生 convertToMvWithValue 转换后的 mV 值，用于绘制心电波形。 */
export interface EcgReading {
  aveHeart: number;
  aveHrv: number;
  aveResRate: number;
  aveQT: number;
  avePWV: number;
  /** 波形点（已转 mV，单位 0.1mV），用于绘制迷你心电图 */
  waveform: number[];
  /** 多诊断报告（可能为 undefined：设备未返回 / 不支持） */
  analysis?: EcgAnalysis;
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

/**
 * 把协议睡眠时间串规范成卡片/时间轴所需的 "HH:mm"；无法解析返回 null。
 *
 * ★ 委托 `lib/sleepTime.fmtClockHM`（全仓唯一实现）：它既能解析 "HH:mm"，
 *   也能解析原生真实的 "yyyy-MM-dd HH:mm"（真机实测 `"2026-09-18 01:38"`），
 *   以及旧协议的 "MM-DD-HH-mm" / "yyyy-MM-dd HH-mm"。此处不得再自写一份正则，
 *   否则「入库形态」与「展示形态」又会漂移。
 */
function fmtSleepClock(s?: string | null): string | null {
  return fmtClockHM(s);
}

/**
 * 睡眠时刻串 → 本地绝对毫秒时间戳；委托 `lib/sleepTime.sleepClockToMs`（唯一实现）。
 * 串带完整日期时以该日期为真值（Date 原生进位，跨天/跨月/跨年自动正确），
 * 只有 "HH:mm" 时以 `baseMs` 所在日为基准；无法解析 → null。
 */
function clockOrDateToMs(s: string | null | undefined, baseMs: number): number | null {
  return sleepClockToMs(s, baseMs);
}

/**
 * 解析原生 `sleepLine`（16 进制串）→ 每分钟睡眠状态数组。
 *
 * SDK 约定（VPAccurateSleepModel.h L68）：每 2 字节 = 1 个点 = 1 分钟，高位在前低位在后，
 * 取**高 3 bit** 得状态：0 深睡 / 1 浅睡 / 2 REM / 3 失眠 / 4 苏醒（KH 系列无 2、3）。
 *
 * 为什么必须解析它：原生只 emit `sleepTotalMin/deep/light/insomnia/score`，
 * **不发 REM、不发苏醒**，也不发分期曲线 —— 而 `sleepLine` 是「各阶段时长的真相源」。
 * 2026-09-18 真机校验：点数 = 521 = sleepDuration；逐分钟统计 深睡 130 / REM 99
 * 与 SDK 的 deepDuration / otherDuration 完全一致，且各阶段之和严格等于总时长。
 */
export function parseSleepLineHex(line: unknown): number[] {
  if (typeof line !== 'string' || line.length < 8) return [];
  const out: number[] = [];
  for (let i = 0; i + 4 <= line.length; i += 4) {
    const v = parseInt(line.slice(i, i + 4), 16);
    if (!Number.isFinite(v)) break;
    out.push((v >> 13) & 0x7);
  }
  return out;
}

/** 每分钟状态数组 → 连续同状态合并的分期段（hypnogram 用），单位为分钟（自入睡起算）。 */
export function sleepLineToSegments(types: number[]): SleepSegment[] {
  if (types.length === 0) return [];
  const segs: SleepSegment[] = [];
  let cur = types[0];
  let start = 0;
  for (let i = 1; i < types.length; i++) {
    if (types[i] !== cur) {
      segs.push({ type: cur, start, end: i });
      cur = types[i];
      start = i;
    }
  }
  segs.push({ type: cur, start, end: types.length });
  return segs;
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
  // ★★ 关键：同时输出到 Metro 控制台！之前 postLog 只 fetch :8899，导致 Metro 里完全
  //  看不到 RingBle 的任何日志。加 console.log 让 Metro 可见。
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${msg}`);
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
  /** v18.112：收到 ready 但当时还没 connected → 挂起，等 connected 落地再补触发回填 */
  private _pendingReadyBackfill = false;
  /** ★ 2026-10-16（续）：ECG 实时波形累积缓冲（原生 onEcgProgress 增量回传，JS 在此拼接成完整 trace）。 */
  private _ecgLiveBuf: number[] = [];
  resetEcgLive() { this._ecgLiveBuf = []; }

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
      const emitter = new NativeEventEmitter(VeepooNative);
      this.emitter = emitter;
      // ★★ 2026-09-17 修红屏：原生 `supportedEvents` 只声明 6 个事件
      //    （onStateChange / onMetric / onLog / onBackfillDay / onBackfillSamples / onBackfillComplete）。
      //    RN 对**未声明**的事件名调 addListener 会弹「'onX' is not a supported event type」红屏
      //    （真机栈 RCTEventEmitter.m:106），且中断构造流程——之前 onHrvDay 在很靠前的位置就弹了，
      //    排在它后面的监听器（含离线回填的 onBackfillDay/onBackfillSamples）根本没机会注册。
      //    下面白名单只注册原生真正支持的事件；其余（onHrvDay/onStepDay/onSleepDay/… 原生侧早已不再
      //    emit，属历史遗留死监听）一律跳过。若将来原生新增事件，把事件名加进这个 Set 即可。
      // ★★ V2 事件收敛：原生只 emit 4 种事件，JS 只注册 4 种
      //   onLog       → 调试日志（开发期用）
      //   onRealtime  → 实时单 metric（hr/spo2/temp/eda…）
      //   onBatch     → 离线批量回填（5min slots + 可选 daily 汇总）
      //   onState     → 连接/同步状态变化（status: connected|ready|syncing|error）
      //   onEcg / onEcgProgress → ★ 2026-10-10 接通：ECG 实时测量结果/进度
      //     （此前 V2 收敛时被排除在白名单外，handleEcg/handleEcgProgress 成了死代码——
      //      「ECG 能测但结果永远不回来」的 JS 侧根因；原生侧 measure: 也没有 ecg 分支）
      const V2_EVENTS = new Set<string>(['onLog', 'onRealtime', 'onBatch', 'onState', 'onEcg', 'onEcgProgress']);
      const reg = (name: string, fn: (...a: any[]) => void) => {
        if (!V2_EVENTS.has(name)) return;
        emitter.addListener(name, fn);
      };

      // ── onLog：调试日志 ──
      reg('onLog', (msg: string) => { postLog('JS', msg); });

      // ── onRealtime：实时单 metric（原生 emit: {metric, value, unit, ts}）──
      reg('onRealtime', (raw: any) => this.handleRealtime(raw));

      // ── onBatch：离线批量回填（原生 emit: {date, slots:[{t,hr,spo2,temp,hrv,...}]} 或 {date, daily:{...}}）──
      reg('onBatch', (raw: any) => this.handleBatch(raw));

      // ── onState：状态统一（status=ready 触发增量 backfill；status=syncing 进度；backfillDone 更新锚点）──
      reg('onState', (raw: any) => this.handleStateV2(raw));

      // ── ★ 2026-10-10：ECG 实时测量（事件链此前两头都断，见 V2_EVENTS 注释）──
      reg('onEcg', (raw: any) => this.handleEcg(raw));
      reg('onEcgProgress', (raw: any) => this.handleEcgProgress(raw));
      // ★ 2026-10-16：呼吸暂停分析 + HRV Lorenz 散点（设备历史库读取，事件名与原生 emit 对应）
      reg('onOxygenAnalysis', (raw: any) => this.handleOxygenAnalysis(raw));
      reg('onRrAnalysis', (raw: any) => this.handleRrAnalysis(raw));
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


  // ═══════════════════════════════════════════════════════════════
  // V2 统一 Ingest Pipeline（3 个 handler 替换原来 28 个）
  // ═══════════════════════════════════════════════════════════════

  /**
   * V2 handleRealtime：原生 onRealtime 事件 → healthStore.upsertRealtime
   * 原生 emit body: { metric: "hr", value: 72, unit: "bpm", ts: epochMs }
   */
  private handleRealtime = (raw: any) => {
    if (!raw) return;
    const metric = String(raw.metric ?? raw.key ?? '');
    const value = num(raw.value);
    const ts = num(raw.ts) ?? Date.now();
    if (!metric || value == null || !Number.isFinite(value)) return;

    // 节流计数（旧 handleMetric 的诊断逻辑保留）
    this.jsMetricCount++;
    this.jsMetricKeys[metric] = (this.jsMetricKeys[metric] ?? 0) + 1;

    // V2 简化：直接写 healthStore + pushMetric + 更新 RingState.metrics
    try {
      healthStore.upsertRealtime(metric as any, { t: ts, v: value }, ts);
      // ★ 触发派生指标重算（去抖 500ms，同一 dayKey 多次写入合并一次）
      scheduleRecompute(dayKey(ts));
      // ★ 诊断日志：关键指标到了没
      if (['cortisol','sns','emotion','skin','fatigue','hrv','stress','cholesterol','triglyceride','hdl','ldl','ua','glucose','temp','skinTemp','bpSys','bpDia','ppgSys','ppgDia','glucoseType','glucoseLevel','depressionRisk'].includes(metric)) {
        const _dk = (() => {
          const d = new Date(ts);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        })();
        postLog('HR-REALTIME', ` ✅ ${metric}=${value} ${raw.unit||''} at ${new Date(ts).toLocaleTimeString()} dk=${_dk}`);
        try { postLog('HS-INT', ` ${metric} intraday[${_dk}]=${healthStore.getIntraday(metric as any, _dk).length} samples`); } catch {}
      }
    } catch { /* 单个 metric 落库失败不中断 */ }

    // 同时走旧的 pushMetric（RingState.metrics 实时更新 + 情绪曲线依赖）
    this.pushMetric({ key: metric as any, value, unit: raw.unit ?? '', ts });
  };

  /**
   * V2 handleBatch：原生 onBatch 事件 → healthStore.upsertBackfillSamples
   * 两种 body shape:
   *   { date: "2026-09-15", slots: [{ t: "09:05", hr, spo2, temp, hrv, step, cal, dist, stress, met, bpSys, bpDia, glucose }] }
   *   { date: "2026-09-15", daily: { step, spo2, hrv, temp, bpSys, bpDia, ... } }
   */
  private handleBatch = (raw: any) => {
    if (!raw) return;
    const date = String(raw.date ?? '');
    if (!date) return;
    const dk = dateKeyOfStr(date);
    if (!dk) return;

    // ★★★ 修复 2026-09-17: METRIC_MAP 必须提升到函数顶层（depth 1）
    // 否则 path A 的 if 块关闭后，path B 的 lastUpdated patch 访问不到 → ReferenceError 被静默吞
    const METRIC_MAP: Record<string, HSMetricKey> = {
      hr: 'hr',
      spo2: 'spo2',
      temp: 'temp',
      hrv: 'hrv',
      glucose: 'glucose',
      bpSys: 'bpSys',
      bpDia: 'bpDia',
      step: 'steps',
      cal: 'calorie',
      dist: 'distance',
      stress: 'stress',
      met: 'met',
      cortisol: 'cortisol',
      sns: 'sns',
      emotion: 'emotion',
      skin: 'skin',
      fatigue: 'fatigue',
      cholesterol: 'cholesterol',
      triglyceride: 'triglyceride',
      hdl: 'hdl',
      ldl: 'ldl',
      ua: 'ua',
      uricAcid: 'ua',  // UI 别名
    };

    // ★ V2 性能：backfill 期间 RingState patch 先累加到 this._pendingBatchPatch，
    //   不在 handleBatch 里 this.push()，避免 30 天 × 1 setState = 30 次 React render
    //   等 backfillDone 统一 flush 一次（见 handleStateV2.backfillDone）
    //   （path A 的 lastUpdated 也要走它，故声明提前到 path A 之前）
    const isBackfillInProgress = this._pendingBatchPatch !== null;
    const mergePatch = (p: StatePatch) => {
      if (isBackfillInProgress) {
        this._pendingBatchPatch = { ...this._pendingBatchPatch!, ...p };
      } else {
        this.push(p);
      }
    };

    // ── path A: slots（5min intraday）──
    const slots = Array.isArray(raw.daily?.slots) && raw.daily.slots.length > 0
                  ? raw.daily.slots
                  : (Array.isArray(raw.slots) ? raw.slots : []);
    if (slots.length > 0) {

      // 统一解析函数：从 slots 里按 key 提取 [{t, v}]
      // ★ 带符号指标：emotion 值域 [-10,10] 含负数（消极/低落），0/负是有效值，
      //   不能用「生理指标 0/负=占位符」的守卫砍掉，否则情绪点阵只剩开心/兴奋。
      const SIGNED_HKEYS = new Set<string>(['emotion']);
      /**
       * ★ 2026-11-06 审查（docs/audit/04 🔴-3）：**零值有效**指标。
       *   原生 VeepooRing.m:1658 / :1710 对 depressionRisk 用 `>= 0` 判定（其余指标是 `> 0`），
       *   协议侧明确认为 0 = 「抑郁风险正常」是有效读数。
       *   旧实现 `if (!signed && v <= 0) continue;` 把它当占位符丢弃 →
       *   「抑郁风险正常」这一最常见读数根本进不了 healthStore → 指标卡恒空。
       */
      const ZERO_VALID_HKEYS = new Set<string>(['depressionRisk']);
      const extract = (nativeKey: string): Array<{ t: number; v: number }> => {
        const hsKey = METRIC_MAP[nativeKey];
        if (!hsKey) return [];
        const signed = SIGNED_HKEYS.has(hsKey);
        const zeroValid = ZERO_VALID_HKEYS.has(hsKey);
        const out: Array<{ t: number; v: number }> = [];
        for (const s of slots) {
          const v = num(s?.[nativeKey]);
          if (v == null || !Number.isFinite(v)) continue;
          // 生理指标 0/负=占位符；emotion（带符号）与 depressionRisk（0 合法档位）保留
          if (!signed && !zeroValid && v <= 0) continue;
          const t = parseSampleTs(date, s?.time ?? s?.t ?? '');
          if (t == null) continue;
          out.push({ t, v });
        }
        return out;
      };

      let okCount = 0;
      let skipCount = 0;
      // ★ v18.96 逻辑B（重连补齐）：path A 原来只写 healthStore、不更新 state.lastUpdated →
      //   回传上来的今日样本无法通过「今天新鲜度」守卫，今日状态种子拿不到 HRV/HR。
      //   这里用**样本自身的真实时间戳**登记新鲜度（不是 Date.now()，历史日不会被当成新鲜）。
      const batchLatestTs: Record<string, number> = {};
      for (const [nativeKey, hsKey] of Object.entries(METRIC_MAP)) {
        const samples = extract(nativeKey);
        if (samples.length > 0) {
          try {
            healthStore.upsertBackfillSamples(hsKey as any, dk, samples);
            for (const s of samples) {
              if (!batchLatestTs[hsKey] || s.t > batchLatestTs[hsKey]) batchLatestTs[hsKey] = s.t;
            }
            okCount++;
            postLog('RingBle', `[Batch] ✅ ${hsKey} dk=${dk} n=${samples.length}`);
          } catch (err: any) {
            postLog('RingBle', `[Batch] ❌ ${hsKey} FAILED: ${err?.message ?? err}`);
          }
        } else {
          skipCount++;
        }
      }
      const curLastUpd = this.getState().lastUpdated ?? {};
      const newLastUpd: Record<string, number | null> = { ...curLastUpd };
      let lastUpdChanged = false;
      for (const [k, v] of Object.entries(batchLatestTs)) {
        if (newLastUpd[k] == null || v > (newLastUpd[k] as number)) { newLastUpd[k] = v; lastUpdChanged = true; }
      }
      if (lastUpdChanged) mergePatch({ lastUpdated: newLastUpd as any });
      postLog('RingBle', `[Batch] date=${date} dk=${dk} OK=${okCount} SKIP=${skipCount} slots=${slots.length}`);
    }

    // ── path B: daily（日汇总）──
    // （mergePatch / isBackfillInProgress 已上移到 path A 之前，供两条通道共用）
    if (raw.daily && typeof raw.daily === 'object') {
      const d = raw.daily;
      // step/dist/cal → stepDaily (特殊：复合结构)
      if (d.step != null || d.dist != null || d.cal != null) {
        const cur = this.getState().stepDaily;
        const prev = cur[dk] ?? { steps: 0, distance: 0, calorie: 0 };
        mergePatch({
          stepDaily: {
            ...cur,
            [dk]: {
              steps: num(d.step) ?? prev.steps,
              distance: num(d.dist) ?? prev.distance,
              calorie: num(d.cal) ?? prev.calorie,
            },
          },
        });
        if (d.step != null) healthStore.upsertBackfillDay('steps' as any, dk, num(d.step)!);
        if (d.dist != null) healthStore.upsertBackfillDay('distance' as any, dk, num(d.dist)!);
        if (d.cal != null) healthStore.upsertBackfillDay('calorie' as any, dk, num(d.cal)!);
      }
      // 单一 metric 的日均值 → 直接 upsertBackfillDay
      const SINGLE_MAP: Record<string, any> = { spo2: 'spo2', hrv: 'hrv', temp: 'temp', bpSys: 'bpSys', bpDia: 'bpDia' };
      for (const [nk, hk] of Object.entries(SINGLE_MAP)) {
        if (d[nk] != null) {
          const v = num(d[nk]);
          if (v != null) healthStore.upsertBackfillDay(hk, dk, v);
        }
      }
      // ★ V2 补 RingState patch —— 今日状态 / 趋势 / 身体恢复都读这些字段！
      const isToday = dk === dayKey(Date.now());
      const statePatch: StatePatch = {};

      // hrvDaily / hrDaily / spo2Daily / tempDaily（今日状态种子依赖）
      if (d.hrv != null) {
        statePatch.hrvDaily = { ...this.getState().hrvDaily, [dk]: num(d.hrv)! };
      }
      if (d.hr != null) {
        statePatch.hrDaily = { ...this.getState().hrDaily, [dk]: num(d.hr)! };
      }
      if (d.spo2 != null) {
        statePatch.spo2Daily = { ...this.getState().spo2Daily, [dk]: num(d.spo2)! };
      }
      if (d.temp != null) {
        statePatch.tempDaily = { ...this.getState().tempDaily, [dk]: num(d.temp)! };
      }
      if (d.bpSys != null) {
        statePatch.bpSysDaily = { ...this.getState().bpSysDaily, [dk]: num(d.bpSys)! };
      }
      if (d.bpDia != null) {
        statePatch.bpDiaDaily = { ...this.getState().bpDiaDaily, [dk]: num(d.bpDia)! };
      }

      // sleepDaily + sleepSummary（今日状态种子依赖 sleep）
      if (d.sleepTotalMin != null) {
        const clockToHour = (s: string | null): number | null => {
          // ★ 复用 lib/sleepTime.parseClockMinutes（唯一解析实现，保留分钟精度）：
          //   旧实现写死 `/^(\d{1,2}):(\d{2})$/`，遇到原生完整 datetime 会返回 null。
          const min = parseClockMinutes(s);
          return min == null ? null : min / 60;
        };
        // ★ 2026-09-18 修复：真实睡眠分期曲线（此前 V2 路径完全没解析它）
        //   原生 dayData.sleepLine 是 16 进制串（每分钟 1 点，高 3 bit = 0深睡/1浅睡/2REM/3失眠/4苏醒）。
        //   旧链路里唯一会写 sleepStages 的 handleSleepDay 属旧事件契约，在 V2
        //   （onLog/onRealtime/onBatch/onState 四事件）下从未被调用 ——
        //   于是 sleepStages/sleepStagesDaily 永远为空（睡眠详情页「日」视图只能拿陈旧快照兜底
        //   或显示「暂未同步」），且原生不发的 REM / 苏醒恒为 0。曲线是各阶段时长的真相源。
        const curve = parseSleepLineHex(d.sleepLine);
        const segs = sleepLineToSegments(curve);
        let deep = num(d.sleepDeepMin) ?? 0;
        let light = num(d.sleepLightMin) ?? 0;
        let rem = num(d.sleepRemMin) ?? 0;        // 原生不发 → 由曲线补齐
        let insomnia = num(d.sleepInsomniaMin) ?? 0;
        let awake = num(d.sleepGetUp) ?? 0;       // 原生不发 → 由曲线补齐
        let total = num(d.sleepTotalMin) ?? 0;
        if (curve.length > 0) {
          // 逐分钟统计（含原生不发的 REM/苏醒）；各阶段之和严格等于总时长，不再"合计对不上"
          deep = light = rem = insomnia = awake = 0;
          for (const t of curve) {
            if (t === 0) deep++;
            else if (t === 1) light++;
            else if (t === 2) rem++;
            else if (t === 3) insomnia++;
            else if (t === 4) awake++;
          }
          if (total <= 0) total = curve.length;
        }
        // ★ 2026-09-29 修复：SDK 原始 sleepScore 是 0–5 分制，之前直接当 score 存进去，
        //   详情页/恢复卡按 0–100 展示就成了「3 分」。这里与 handleSleepDay 同口径，
        //   用 computeSleepScore v2 自算 0–100（SDK 原始分保留在 sdkScore 字段）。
        const sleepObj = {
          total,
          deep,
          light,
          rem,
          score: total > 0 ? computeSleepScore(
            {
              sleepTotal: total,
              sleepDeep: deep,
              sleepAwake: awake + insomnia > 0 ? awake + insomnia : undefined,
              getUp: num(d.sleepGetUp) ?? 0,
            },
            ALGO_DEFAULTS
          ) : 0,
          getUp: num(d.sleepGetUp) ?? 0,
          // ★ 原生发的是 "yyyy-MM-dd HH:mm"；图上时间轴与睡眠窗推导都要 "HH:mm"，此处统一格式化
          sleepTime: fmtSleepClock(d.sleepTime) ?? d.sleepTime ?? null,
          wakeTime: fmtSleepClock(d.wakeTime) ?? d.wakeTime ?? null,
          insomnia,
          awake,
          sdkScore: num(d.sleepScore) ?? 0,
        };
        // ★ 睡眠诊断：原生 sleepTotalMin 有值才进这里
        postLog('BATCH-SLEEP', `📅 dk=${dk} isToday=${isToday} total=${total} deep=${deep} light=${light} rem=${rem} awake=${awake} insomnia=${insomnia} 曲线点=${curve.length} 分段=${segs.length} 入睡=${sleepObj.sleepTime} 起床=${sleepObj.wakeTime}`);
        healthStore.recordSleep(dk, sleepObj);
        statePatch.sleepDaily = { ...this.getState().sleepDaily, [dk]: sleepObj };
        // ★ 分期段按天归档（睡眠详情页「日」视图 / 洞察页 hypnogram 的唯一数据源）
        if (segs.length > 0) {
          const prevStagesDaily = this.getState().sleepStagesDaily ?? {};
          const nextStagesDaily: Record<string, SleepSegment[]> = { ...prevStagesDaily, [dk]: segs };
          const dks = Object.keys(nextStagesDaily).sort();   // dateKey 可直接字典序排序
          for (const stale of dks.slice(0, Math.max(0, dks.length - 60))) delete nextStagesDaily[stale];
          statePatch.sleepStagesDaily = nextStagesDaily;
        }
        // 今日睡眠 → sleepSummary（recomputeDailyStatus 种子需要 sleepSummary）
        if (isToday) {
          statePatch.sleepSummaryDate = dk;
          statePatch.sleepSummary = {
            total: sleepObj.total,
            deep: sleepObj.deep,
            light: sleepObj.light,
            rem: sleepObj.rem,
            awake: sleepObj.awake,
            insomnia: sleepObj.insomnia,
            score: sleepObj.score,
            sdkScore: sleepObj.sdkScore,
            getUp: sleepObj.getUp,
            sleepTime: sleepObj.sleepTime,
            wakeTime: sleepObj.wakeTime,
            bedHour: num(d.sleepBedHour) ?? num(d.bedHour) ?? clockToHour(sleepObj.sleepTime),
            wakeHour: num(d.sleepWakeHour) ?? num(d.wakeHour) ?? clockToHour(sleepObj.wakeTime),
          };
          if (segs.length > 0) statePatch.sleepStages = segs;        // InsightScreen 分期图
          if (sleepObj.sleepTime) statePatch.sleepTime = sleepObj.sleepTime;
          if (sleepObj.wakeTime) statePatch.wakeTime = sleepObj.wakeTime;
        }
      }

      // 今日 HRV/HR → state.daily（recomputeDailyStatus 种子输入）
      if (isToday) {
        const curDaily = { ...this.getState().daily };
        if (d.hrv != null) curDaily['hrv'] = num(d.hrv)!;
        if (d.hr != null) curDaily['hr'] = num(d.hr)!;
        if (d.spo2 != null) curDaily['spo2'] = num(d.spo2)!;
        if (d.temp != null) curDaily['temp'] = num(d.temp)!;
        statePatch.daily = curDaily;
      }

      // hrv seriesByDay（身体恢复详情页趋势）
      if (slots.length > 0) {
        const hrvSeries = slots
          .filter((s: any) => s?.hrv && Number(s.hrv) > 0)
          .map((s: any, i: number) => ({ t: parseSampleTs(date, s.time ?? s.t)!, v: Number(s.hrv) }))
          .filter((p: any) => p.t != null && Number.isFinite(p.t));
        if (hrvSeries.length > 0) {
          statePatch.seriesByDay = {
            ...this.getState().seriesByDay,
            [dk]: { ...(this.getState().seriesByDay[dk] ?? {}), hrv: hrvSeries },
          };
        }
      }

      // ★ V2: 从 slots 里提取所有 metric 的最新 timestamp → patch lastUpdated
      // 血液成分卡片 / HRV 卡片右上角时间显示 ring.lastUpdated[key]
      if (slots.length > 0) {
        const _metricKeys = ['hr','spo2','temp','hrv','glucose','bpSys','bpDia','cortisol','sns','emotion','skin','fatigue','stress','met','cholesterol','triglyceride','hdl','ldl','ua'];
        const latestTs: Record<string, number> = {};
        for (const s of slots) {
          const t = parseSampleTs(date, s.time ?? s.t);
          if (t == null) continue;
          for (const mk of _metricKeys) {
            const v = num(s?.[mk]);
            if (v != null && Number.isFinite(v) && v > 0) {
              if (!latestTs[mk] || t > latestTs[mk]) latestTs[mk] = t;
            }
          }
        }
        if (Object.keys(latestTs).length > 0) {
          const curLast = this.getState().lastUpdated ?? {};
          const newLast = { ...curLast };
          for (const [k, v] of Object.entries(latestTs)) {
            const hk = (METRIC_MAP as any)[k] ?? k;
            if (!newLast[hk] || v > (newLast[hk] ?? 0)) newLast[hk] = v;
            // ★ UI alias: 同时写 UI 组件用的 key（如 ua → uricAcid）
            if (k === 'ua' && hk !== 'uricAcid') {
              if (!newLast['uricAcid'] || v > (newLast['uricAcid'] ?? 0)) newLast['uricAcid'] = v;
            }
            if (k === 'uricAcid' && hk !== 'ua') {
              if (!newLast['ua'] || v > (newLast['ua'] ?? 0)) newLast['ua'] = v;
            }
          }
          if (Object.keys(newLast).some(k => newLast[k] !== curLast[k])) {
            statePatch.lastUpdated = newLast;
          }
        }
      }

      // 如果有 patch 就 push（backfill 期间累加到 _pendingBatchPatch）
      if (Object.keys(statePatch).length > 0) {
        mergePatch(statePatch);
        // ★ 离线回填后触发该日的派生指标重算
        scheduleRecomputeMany([dk]);
      }

      postLog('RingBle', `[Batch.daily] date=${date} step=${d.step ?? '-'} spo2=${d.spo2 ?? '-'} hrv=${d.hrv ?? '-'} sleep=${d.sleepTotalMin ?? '-'} patchKeys=${Object.keys(statePatch).join(',')}`);
    }
  };

  /**
   * V2 handleStateV2：原生 onState 事件（统一状态通道）
   * 原生 emit body:
   *   连接变化: { status: "connected"|"disconnected", deviceName, battery, firmware, deviceAddress }
   *   扫描:    { status: "scanResult", devices: [...] }
   *   蓝牙:    { status: "connected", bluetooth: {...} }
   *   就绪:    { status: "ready", deviceTotalDays: 13 }
   *   同步中:  { status: "syncing", progress: 0.3 }
   *   完成:    { status: "connected", progress: 1.0, backfillDone: true, days: 13 }
   *   错误:    { status: "error", error: "..." }
   */
  private handleStateV2 = (raw: any) => {
    if (!raw) return;
    const status = String(raw.status ?? '');

    // ── 分流 1: backfillDone → 更新增量锚点 ──
    if (raw.backfillDone) {
      const today = dayKey(Date.now());
      healthStore.setLastSyncDate(today);
      // ★ V2 派生指标管道：backfill 完成后立即把积压的所有 dayKey 重算一遍
      try { flushAll(); } catch {}
      // ★ v18.113：历史日派生指标（cortisol/eda/sns/…）的 intraday 补齐**必须放在 backfill 之后**。
      //   启动时那次 estimateOfflineMetricsRecent(30) 跑在回填之前 —— 当时历史日 stress 还是空的，
      //   deriveFromStress 拿不到样本 → 只落 1 个正午点（甚至完全不落），
      //   于是首页昼夜节律的皮质醇趋势拿到的是「14 天各 1 个点」，拟合不出节律 → 空态。
      //   这里回填完成后再补一次：此时历史日 stress 已有 110~247 条逐样本，能还原真实全天形状。
      try {
        const filledDays = estimateOfflineMetricsRecent(30);
        if (filledDays > 0) {
          postLog('RingBle', `[BACKFILL-DERIVED] 回填后补齐历史派生指标：${filledDays} 天`);
        }
      } catch (e) {
        postLog('RingBle', `[BACKFILL-DERIVED] ⚠️ 补齐失败（已忽略）: ${e instanceof Error ? e.message : e}`);
      }
      // 补完再重算 analysis，让 cortisol 拟合结果用上新样本
      try { flushAll(); } catch {}
      // ★ V2 性能：backfill 期间累积的 RingState patch 一次性 flush
      const accumulated = this._pendingBatchPatch;
      this._pendingBatchPatch = null;
      this.push({ lastBackfillAt: Date.now() });
      if (accumulated && Object.keys(accumulated).length > 0) {
        postLog('RingBle', `[State] flush ${Object.keys(accumulated).join(',')} (backfill accumulated patch)`);
        this.push(accumulated);
      }
      this.onBackfillComplete();
      // ★ V2: backfill 写完了 sleep/hrv/hr/stress → 触发今日状态重算
      // ★ v18.112：固定等 1500ms 不可靠 —— 30 天回填时 RingState patch 是异步 flush 的，
      //   1.5s 内 healthStore 可能还在写；而 rebuildHistoricalStatus 有重入锁，
      //   这次若被丢弃就**再也没有第二次**（实锤：`合并今日 statusTimeline` 全程 0 次）。
      //   改成「等 RingState patch 落地 + 重建不在运行中」再跑，最多等 8s。
      //   注意：重建锁 rebuildHistoricalStatusRunning 在 RingConnectionImpl（私有），
      //   这里通过 requestFlush 提供的上下文无法直接读 —— 改为「多等几拍 + 幂等重跑」：
      //   requestFlush 内部若正忙，rebuildHistoricalStatus 会记一次待补跑（v18.112），
      //   所以这里重复调用是安全的，且能确保回填后的最终状态一定被算进去。
      const waitFlush = (attempt: number) => {
        if (attempt < 5) {
          setTimeout(() => {
            try {
              this.requestFlush();
            } catch { /* 下一拍再试 */ }
            waitFlush(attempt + 1);
          }, 700);
          return;
        }
        try {
          // ★ 修: recomputeDailyStatus 是 RingConnectionImpl 的方法，NativeRingSource 调不到！
          // 用 this.requestFlush() 代替 —— 它实际指向 RingConnectionImpl 的回调：
          //   requestFlush = () => { this.rebuildHistoricalStatus(); this.scheduleRecomputeDailyStatus(); ... }
          this.requestFlush();
          postLog('RingBle', `[State] ✅ requestFlush (rebuild+recompute) after backfill (settled)`);
        } catch (err: any) {
          postLog('RingBle', `[State] ❌ recomputeDailyStatus FAILED: ${err?.message ?? err}`);
        }
      };
      setTimeout(() => waitFlush(0), 600);
      postLog('RingBle', `[State] ✅ backfillDone days=${raw.days ?? '?'} lastSyncDate=${today}`);
      return;
    }

    // ── 分流 2: ready → 触发增量 backfill ──
    if (status === 'ready') {
      // ★ V2 性能：开启累积模式（backfill 期间 RingState patch 不立即 push）
      this._pendingBatchPatch = {};
      postLog('RingBle', `[State] ready totalDays=${raw.deviceTotalDays ?? '?'}`);
      // ★ 2026-11-04（用户定稿·能力字段驱动）：连接就绪后，原生透传 capabilities（SDK *Type），
      //   据此动态判定 Pro/基础版 与 展示哪些功能（有就展示）。
      // ★ 2026-11-05（用户：连上戒指就该识别 Pro/基础版）：优先用能力字段；若原生没透传，回退到已连上的 MAC / 广播名。
      if (raw.capabilities || this.getState().deviceId || this.getState().deviceName) {
        void applyProfileFromDevice({
          capabilities: raw.capabilities,
          deviceName: this.getState().deviceName,
          deviceId: this.getState().deviceId,
        })
          .then((p) => {
            if (p) postLog('RingBle', `[DeviceProfile] 真机识别 → 应用 ${p}（ecgType=${raw.capabilities?.ecgType}，mac=${this.getState().deviceId}）`);
          })
          .catch(() => {});
      }
      if (this.getState().status === 'connected' && healthStore.syncEnabled) {
        this.triggerBackfillOnReady('ready');
      } else {
        // ★ v18.112：`ready` 常常**早于** connected 到达（原生先报告设备就绪，
        //   JS 侧 status 还在 scanning/connecting）。旧守卫直接 return，
        //   而 ready 是**回填的唯一触发点** → 这次连接永远不会回填，
        //   戒指里存着的离线数据（用户口述的第二段逻辑）永远拉不回来。
        //   实锤：近 3 次重启 `[State] ready` 0 次，原生却报
        //   `BACKFILL-API 2026-10-03 original=166 HR=141 hrv=141 temp=29`。
        //   现在记住这次 ready，等 connected 落地后再补触发（见下方 CONNECTED 分支）。
        this._pendingReadyBackfill = true;
        postLog(
          'RingBle',
          `[State] ready 先于 connected 到达（status=${this.getState().status}），挂起回填待连接后补触发`,
        );
      }
      return;
    }

    // ── 分流 3: syncing → 进度 ──
    if (status === 'syncing') {
      const pct = typeof raw.progress === 'number' ? Math.round(raw.progress * 100) : 0;
      this.onSyncProgress({ active: true, percent: pct, phase: 'syncing' });
      return;
    }

    // ── 分流 4: scanResult → 设备列表 ──
    if (status === 'scanResult' && Array.isArray(raw.devices)) {
      this.push({
        devices: raw.devices.map((d: any) => ({
          id: String(d.id ?? d.deviceAddress ?? ''),
          name: String(d.name ?? d.deviceName ?? 'Mira Ring Pro'),
          rssi: num(d.rssi ?? d.signalStrength) ?? null,
          recommended: !!d.recommended,
        })),
      });
      return;
    }

    // ── 分流 5: error ──
    if (status === 'error' || raw.error) {
      this.push({ error: String(raw.error ?? status) });
      return;
    }

    // ── 分流 6: connected / disconnected → 通用 patch ──
    const patch: StatePatch = {};
    if (status === 'connected' || status === 'disconnected' || status === 'connecting') {
      patch.status = status as RingConnStatus;
    }
    if (raw.deviceName) patch.deviceName = String(raw.deviceName);
    if (status === 'connected' && (raw.deviceName || raw.deviceAddress)) {
      // ★ 2026-11-05（用户：连上戒指就识别 Pro/基础版）：用 MAC + 广播名做真机识别（能力字段在 ready 分支补充）。
      void applyProfileFromDevice({ deviceName: raw.deviceName, deviceId: raw.deviceAddress });
    }
    if (raw.battery != null) patch.battery = num(raw.battery) ?? null;
    if (raw.firmware) patch.firmware = String(raw.firmware);
    if (raw.deviceAddress) patch.deviceId = String(raw.deviceAddress);
    if (raw.deviceInfo) patch.deviceInfo = raw.deviceInfo as RingModuleInfo;
    if (Array.isArray(raw.sportSessions)) {
      patch.sportSessions = raw.sportSessions as RingSportSession[];
      const names = (raw.sportSessions as any[]).map((s) => s.typeName).join('、');
      postLog('RingBle', `[Sport] 读取到 ${raw.sportSessions.length} 段运动: ${names}`);
    }

    if (Object.keys(patch).length > 0) {
      this.push(patch);
      postLog('RingBle', `[State] ${status} patch=${Object.keys(patch).join(',')}`);
    }
    // ★ v18.112：connected 落地后，若此前收到过 ready 但被守卫跳过，此刻补触发回填。
    if (status === 'connected' && this._pendingReadyBackfill) {
      this._pendingReadyBackfill = false;
      this.triggerBackfillOnReady('connected 补触发');
    }
  };

  /** 统一发起离线回填：用 lastSyncDate 做增量锚点，没有锚点则全量。 */
  private triggerBackfillOnReady(reason: string): void {
    // ★ syncEnabled 归 healthStore 全局单例持有（NativeRingSource 只有 setSyncEnabled 写入口），
    //   与 ready 分支原判断同源。
    if (!healthStore.syncEnabled) {
      postLog('RingBle', `[State] 跳过回填（syncEnabled=false，来源=${reason}）`);
      return;
    }
    const last = healthStore.getLastSyncDate();
    setTimeout(() => {
      try {
        if (last) {
          postLog('RingBle', `[State] ready → backfillSince(${last})（${reason}）`);
          VeepooNative?.backfillSince?.(last);
        } else {
          postLog('RingBle', `[State] ready → full backfill (no lastSyncDate)（${reason}）`);
          VeepooNative?.backfill?.();
        }
      } catch (e: any) {
        postLog('RingBle', `[State] backfill trigger FAILED: ${e?.message ?? e}`);
      }
    }, 500);
  }

  private handleState = (raw: Record<string, any>) => {
    // ★ 同步进度走**已有的** onStateChange 事件转发（刻意不新增事件名）：
    //   RCTEventEmitter 对「未在原生 supportedEvents 里声明的事件」会在 addListener 时
    //   直接抛异常 → 整屏红屏。复用已有事件可彻底避免「JS 先更新、原生还没 Clean Build」
    //   这种版本错配（2026-09-11 真机曾因新增 onBackfillProgress 触发红屏）。
    //   注意：进度只推给独立通道，**不写进 patch / RingState**，
    //   避免同步期间几十次进度更新触发全 App 重渲染、反过来加重卡顿。
    // ★★ 临时强制 backfill（调试用）：connected 后 3 秒直接调，看原生能不能收到
    if (raw?.status === 'connected') {
      console.log('[FORCE-BACKFILL] connected detected, will call backfill in 3s...');
      setTimeout(() => {
        try {
          console.log('[FORCE-BACKFILL] calling VeepooNative.backfill()...');
          const N = (NativeModules as any).VeepooRing;
          console.log('[FORCE-BACKFILL] VeepooNative exists?', !!N, 'backfill exists?', !!N?.backfill);
          N?.backfill?.();
          console.log('[FORCE-BACKFILL] backfill() called ✅');
        } catch (e) {
          console.log('[FORCE-BACKFILL] FAILED:', e);
        }
      }, 3000);
    }
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
    if (raw.status === 'connected' && raw.deviceName) {
      // ★ 2026-11-04（用户定稿）：机型识别改在 ready 分支基于原生透传的 capabilities（SDK *Type）判定。
    }
    if (raw.battery != null) patch.battery = num(raw.battery) ?? patch.battery;
    if (raw.firmware) patch.firmware = raw.firmware;
    if (raw.deviceAddress) patch.deviceId = String(raw.deviceAddress);
    if (raw.deviceInfo) {
      patch.deviceInfo = raw.deviceInfo as RingModuleInfo;
      postLog('RingBle', `[DeviceInfo] deviceNumber=${raw.deviceInfo.deviceNumber} version=${raw.deviceInfo.deviceVersion} runningType=${raw.deviceInfo.runningType}(1=10种多运动) runningSaveTimes=${raw.deviceInfo.runningSaveTimes} motionState=${raw.deviceInfo.isSupportMotionState}`);
    }
    if (Array.isArray(raw.sportSessions)) {
      patch.sportSessions = raw.sportSessions as RingSportSession[];
      const names = (raw.sportSessions as any[]).map((s) => s.typeName).join('、');
      postLog('RingBle', `[Sport] 读取到 ${raw.sportSessions.length} 段运动: ${names}`);
    }
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
    // ★ 空 patch（仅含 syncProgress 的进度事件、或 bluetooth 状态事件）不写 RingState：
    //   进度已走独立通道，再把空 patch 当 emit 会触发所有屏整体重渲染
    //   （同步期几十次 → 主线程被占满、卡顿，且底部浮层「出现」动画来不及提交就随同步结束消失）。
    //   空 patch 既无字段可合并也无副作用，跳过 push 是纯收益。
    if (Object.keys(patch).length > 0) {
      this.push(patch);
    }
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
    analysis?: EcgAnalysis;
  }) => {
    try {
      if (!raw || typeof raw.aveHeart !== 'number' || !Number.isFinite(raw.aveHeart)) return;
      const aveHeart = num(raw.aveHeart) ?? 0;
      // ★ QTc 本地计算（Bazett）：QTc = QT / √(RR_s)，RR_s = 60 / 心率
      const analysis: EcgAnalysis | undefined =
        raw.analysis && typeof raw.analysis === 'object' ? { ...raw.analysis } : undefined;
      const aveQT = num(raw.aveQT) ?? 0;
      if (analysis && aveHeart > 0 && aveQT > 0) {
        const rrS = 60 / aveHeart;
        analysis.qtc = aveQT / Math.sqrt(rrS);
      }
      const reading: EcgReading = {
        aveHeart,
        aveHrv: num(raw.aveHrv) ?? 0,
        aveResRate: num(raw.aveResRate) ?? 0,
        aveQT,
        avePWV: num(raw.avePWV) ?? 0,
        waveform: Array.isArray(raw.waveform) ? raw.waveform.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)) : [],
        analysis,
        ts: Date.now(),
      };
      // 追加到历史数组（最多保留 30 次）
      const curHistory = this.getState().ecgHistory ?? [];
      const newHistory = [reading, ...curHistory].slice(0, 30);
      // ★ 关键：清掉 ecgProgress → UI 从"处理结果中…"回到空闲态（显示"重新测量"）
      // 之前设 progress:100 会导致 isDone 永远为 true，UI 永远卡在 loading
      this.push({ ecg: reading, ecgProgress: null, ecgLiveWaveform: null, ecgError: null, ecgHint: null, ecgHistory: newHistory });
      this._ecgLiveBuf = [];
      // 把平均心率作为 'ecg' 信号推入 flush 归档链路 → extDaily[今日]['ecg']，多日趋势可用
      this.pushMetric({ key: 'ecg', value: reading.aveHeart, unit: 'bpm', ts: reading.ts });
      // 呼吸率：本固件独立 TestBreathingRateStart 会打断实时 HR/SpO₂ 且恒返 NoFunction(7)，故不调；
      // 改从 ECG 的 aveResRate 取（HK18 ECG 硬件支持），作为核心 'rr' 信号 → metrics.rr + rrDaily 历史。
      if (reading.aveResRate > 0) {
        this.pushMetric({ key: 'rr', value: reading.aveResRate, unit: '次/分', ts: reading.ts });
      }
    } catch (e) {
      // ★ 2026-11-06 审查（docs/audit/03 🟡#16）：ECG 解析失败必须写 ecgError 并清进度。
      //   旧实现静默吞错 → ecgProgress 保持原值 → EcgCard 的 isMeasuring 恒为 true →
      //   UI 永远停在「测量中 N%」，用户唯一出路是等 120s 超时 Alert。
      //   对齐 handleEcgProgress 的失败处理口径（见上方 :1749-1753）。
      _postLog('RingBle', `[handleEcg] ❌ 解析失败：${e}`);
      this._ecgLiveBuf = [];
      this.push({
        ecgProgress: null,
        ecgLiveWaveform: null,
        ecgError: '心电图数据解析失败，请重新测量',
      });
    }
  };

  /** ECG 实时测量进度（原生 onEcgProgress）：progress=0~100，hr=当前心率，waveform=本次新增的增量波形采样（mV）。
   *  仅测量期间有效，结果到达即由 handleEcg 清掉。JS 侧把增量拼接到 ecgLiveWaveform，供详情页实时绘制波形。
   *  ★ 2026-11-03（用户）：失败不再 Alert 打断（改为 UI 内联/浮层展示 ecgError）；新增 hint 轻提示
   *  通道（原生 NotLead 三振容忍的前 2 次走 hint），hint 只更新 ecgHint 不清进度。 */
  private handleEcgProgress = (raw: { progress?: number; hr?: number; error?: string; hint?: string; waveform?: number[] }) => {
    try {
      if (raw && raw.error) {
        // 失败：清进度与实时波形，原因写入 ecgError 由 UI（测量浮层 / 详情页常驻块）展示，不弹 Alert
        this._ecgLiveBuf = [];
        this.push({ ecgProgress: null, ecgLiveWaveform: null, ecgError: raw.error ?? 'ECG 测量失败' });
        return;
      }
      if (raw && raw.hint) {
        // 轻提示（如「请保持手指接触电极…」）：不清进度、不清波形，仅暂存供 UI 显示
        this.push({ ecgHint: raw.hint });
        return;
      }
      const progress = typeof raw.progress === 'number' ? raw.progress : 0;
      const hr = typeof raw.hr === 'number' && Number.isFinite(raw.hr) ? raw.hr : undefined;
      // 拼接增量波形
      const inc = Array.isArray(raw.waveform)
        ? raw.waveform.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v))
        : null;
      let live: number[] | null = this.getState().ecgLiveWaveform;
      if (inc && inc.length) {
        live = (live ?? []).concat(inc);
      }
      this.push({ ecgProgress: { progress, hr }, ecgLiveWaveform: live, ecgError: null, ecgHint: null });
    } catch {
      /* 静默 */
    }
  };

  /** 历史日 ECG 回填：原生 backfill 按日读离线 ECG，带 dateKey 回传，落库到 ecgDaily + extDaily[date]['ecg'] + rrDaily[date]。 */
  /** ★ 2026-10-16：呼吸暂停分析结果落地（原生 onOxygenAnalysis） */
  private handleOxygenAnalysis = (raw: any) => {
    try {
      if (!raw) return;
      if (raw.error) {
        postLog('O2-ANALYSIS', ` ${String(raw.error)}`);
        this.push({ oxygenAnalysis: null });
        return;
      }
      const analysis: OxygenAnalysis = {
        osahsResult: (num(raw.osahsResult) ?? -1) as OxygenAnalysis['osahsResult'],
        osahsResultDes: String(raw.osahsResultDes ?? ''),
        aveOxygen: num(raw.aveOxygen) ?? 0,
        minOxygen: num(raw.minOxygen) ?? 0,
        aveRespRate: num(raw.aveRespRate) ?? 0,
        minRespRate: num(raw.minRespRate) ?? 0,
        maxRespRate: num(raw.maxRespRate) ?? 0,
        aveLowOxygenTime: num(raw.aveLowOxygenTime) ?? 0,
        maxLowOxygenTime: num(raw.maxLowOxygenTime) ?? 0,
        aveCardiacLoad: num(raw.aveCardiacLoad) ?? 0,
        maxCardiacLoad: num(raw.maxCardiacLoad) ?? 0,
        minCardiacLoad: num(raw.minCardiacLoad) ?? 0,
        aveSleepActivity: num(raw.aveSleepActivity) ?? 0,
        freqTimes: Array.isArray(raw.freqTimes) ? raw.freqTimes.map(String) : [],
        freqVals: Array.isArray(raw.freqVals) ? raw.freqVals.map((v: any) => num(v) ?? 0) : [],
        ts: num(raw.ts) ?? Date.now(),
      };
      postLog('O2-ANALYSIS', ` ✅ osahs=${analysis.osahsResult} aveO2=${analysis.aveOxygen} minO2=${analysis.minOxygen}`);
      this.push({ oxygenAnalysis: analysis });
    } catch { /* 单事件失败不中断 */ }
  };

  /** ★ 2026-10-16：RR 间期 / Lorenz 散点落地（原生 onRrAnalysis） */
  private handleRrAnalysis = (raw: any) => {
    try {
      if (!raw) return;
      if (raw.error) {
        postLog('RR-ANALYSIS', ` ${String(raw.error)}`);
        this.push({ rrAnalysis: null });
        return;
      }
      const rr = Array.isArray(raw.rr) ? raw.rr.map((v: any) => num(v) ?? 0).filter((v: number) => v > 0) : [];
      const lorentz = Array.isArray(raw.lorentz)
        ? raw.lorentz
            .map((p: any) => ({ x: num(p?.x) ?? 0, y: num(p?.y) ?? 0 }))
            .filter((p: { x: number; y: number }) => p.x > 0 && p.y > 0)
        : [];
      postLog('RR-ANALYSIS', ` ✅ rr=${rr.length} lorentz=${lorentz.length}`);
      this.push({ rrAnalysis: { rr, lorentz, ts: num(raw.ts) ?? Date.now() } });
    } catch { /* 单事件失败不中断 */ }
  };

  private handleEcgDay = (raw: {    date?: string;
    ts?: number;
    aveHeart?: number;
    aveHrv?: number;
    aveResRate?: number;
    aveQT?: number;
    avePWV?: number;
    waveform?: number[];
    analysis?: EcgAnalysis;
  }) => {
    try {
      if (!raw || !raw.date || typeof raw.aveHeart !== 'number' || !Number.isFinite(raw.aveHeart) || raw.aveHeart <= 0) return;
      const date = String(raw.date);
      const dk = dateKeyOfStr(date);
      const aveHeart = num(raw.aveHeart) ?? 0;
      // QTc 本地计算（Bazett）
      const analysis: EcgAnalysis | undefined =
        raw.analysis && typeof raw.analysis === 'object' ? { ...raw.analysis } : undefined;
      const aveQT = num(raw.aveQT) ?? 0;
      if (analysis && aveHeart > 0 && aveQT > 0) {
        const rrS = 60 / aveHeart;
        analysis.qtc = aveQT / Math.sqrt(rrS);
      }
      const reading: EcgReading = {
        aveHeart,
        aveHrv: num(raw.aveHrv) ?? 0,
        aveResRate: num(raw.aveResRate) ?? 0,
        aveQT,
        avePWV: num(raw.avePWV) ?? 0,
        waveform: Array.isArray(raw.waveform)
          ? raw.waveform.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v))
          : [],
        analysis,
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
      if (!dk) { postLog('JS', '[handleBackfillDaySlots] ❌ invalid dk, skip'); return; }
      const map: Record<string, Array<{ t: number; v: number }> | undefined> = {
        hr: raw.hr, spo2: raw.spo2, temp: raw.temp, hrv: raw.hrv, glucose: raw.glucose,
        bpSys: raw.bpSys, bpDia: raw.bpDia,
        steps: raw.steps, calorie: raw.calorie, distance: raw.distance,
        stress: raw.stress, met: raw.met,
      };
      const summary: string[] = [];
      for (const [key, arr] of Object.entries(map)) {
        try {
          if (Array.isArray(arr) && arr.length > 0) {
            const cleaned = arr.filter(p => Number.isFinite(p.v) && p.v > 0);
            summary.push(`${key}=${cleaned.length}`);
            if (cleaned.length > 0) {
              healthStore.upsertBackfillSamples(key as any, dk, cleaned);
              postLog('JS', `[handleBackfillDaySlots] ✅ ${key} dk=${dk} samples=${cleaned.length}`);
            }
          } else {
            summary.push(`${key}=0`);
          }
        } catch (err: any) {
          postLog('JS', `[handleBackfillDaySlots] ❌ ${key} FAILED: ${err?.message || err}`);
        }
      }
      postLog('JS', `[handleBackfillDaySlots] date=${raw.date} dk=${dk} ${summary.join(' ')}`);
      // ★ 直接 Alert 弹窗看结果（只弹 9/17，不刷屏）
      if (String(raw.date).includes('09-17')) {
        try {
          const { Alert } = require('react-native');
          Alert.alert(
            `Backfill 9/17`,
            `dk=${dk}\n${summary.join('\n')}\nhrv_arr_len=${(raw as any).hrv?.length ?? 0}\ngluc_arr_len=${(raw as any).glucose?.length ?? 0}`,
            [{ text: 'OK' }]
          );
        } catch {}
      }
    } catch (err: any) {
      postLog('JS', `[handleBackfillDaySlots] ❌ OUTER FAIL: ${err?.message || err}`);
      try {
        const { Alert } = require('react-native');
        Alert.alert('OUTER FAIL', String(err));
      } catch {}
    }
  };

  /** ★★ 2026-09-17 新增：接住原生 backfill 真正发出的「日汇总」事件 onBackfillDay。
   *  原生字段名是 step/dist/cal/sleepTotalMin/sleepDeepMin/sleepLightMin/sleepScore/spo2/hrv/temp/bpSys/bpDia，
   *  与各 per-metric handler 期望的键不同，这里做翻译后转调，直接复用它们的落库逻辑（不重复实现）。
   *  修复前：onBackfillDay 无监听器 → 离线 steps/sleep/spo2/hrv/temp/bp 全部被丢。 */
  private handleBackfillDay = (raw: any) => {
    try {
      if (!raw?.date) return;
      const date = String(raw.date);
      postLog('JS', `[handleBackfillDay] ✅ date=${date} step=${raw.step} dist=${raw.dist} cal=${raw.cal} `
        + `sleep=${raw.sleepTotalMin} spo2=${raw.spo2} hrv=${raw.hrv} temp=${raw.temp} bp=${raw.bpSys}/${raw.bpDia}`);
      // 计步 / 距离 / 卡路里
      if (num(raw.step) != null || num(raw.dist) != null || num(raw.cal) != null) {
        this.handleStepDay({
          date,
          steps: num(raw.step) ?? 0,
          distance: num(raw.dist) ?? 0,
          calorie: num(raw.cal) ?? 0,
        });
      }
      // 睡眠（原生 VeepooRing.m 从 VPAccurateSleepModel 发完整数据：
      //   total/deep/light/insomnia/sleepTime/wakeTime/sleepLine(hex曲线)
      // JS handleSleepDay 解析 sleepLine → 重算各阶段(minute 精度)，
      // 并用 sleepTime/wakeTime 填睡眠窗口(供 sleepWindow / stress / emotion 用)。
      if ((num(raw.sleepTotalMin) ?? 0) > 0) {
        this.handleSleepDay({
          date,
          total: num(raw.sleepTotalMin) ?? 0,
          deep: num(raw.sleepDeepMin) ?? 0,
          light: num(raw.sleepLightMin) ?? 0,
          rem: num(raw.sleepRemMin) ?? 0,
          insomnia: num(raw.sleepInsomniaMin) ?? 0,
          score: num(raw.sleepScore) ?? 0,
          sleepTime: raw.sleepTime ?? null,
          wakeTime: raw.wakeTime ?? null,
          curve: parseSleepLineHex(raw.sleepLine),
        });
      }
      // 日值：血氧 / HRV / 体温 / 血压
      const spo2 = num(raw.spo2); if (spo2 != null && spo2 > 0) this.handleSpo2Day({ date, value: spo2 });
      const hrv = num(raw.hrv);   if (hrv != null && hrv > 0)  this.handleHrvDay({ date, value: hrv });
      const temp = num(raw.temp); if (temp != null && temp > 0) this.handleTempDay({ date, value: temp });
      const sys = num(raw.bpSys); const dia = num(raw.bpDia);
      if (sys != null && dia != null && sys > 0 && dia > 0) this.handleBpDay({ date, sys, dia });
    } catch { /* 静默 */ }
  };

  /** ★★ 2026-09-17 新增：接住原生 backfill 的 5min slot 批量事件 onBackfillSamples。
   *  原生形态 { date, slots:[{date,time,hr,bpSys,bpDia,stress,met,step,cal,dist}] }，
   *  reshape 成 handleBackfillDaySlots 期望的 { date, hr:[{t,v}], steps:[{t,v}], … } 再转调。 */
  private handleBackfillSamples = (raw: any) => {
    try {
      // ★★★ 最开头 Alert — 确认 onBackfillSamples 事件是否到了 JS
      try {
        const { Alert } = require('react-native');
        Alert.alert(
          `onBackfillSamples RAW`,
          `date=${raw?.date} slots=${raw?.slots?.length ?? 0}\n第一时间就弹了！`,
          [{ text: 'OK' }]
        );
      } catch {}
      // ★★ 直接 dump 原生 emit 的 raw.slots 到文件（用 expo-file-system，已安装）
      if (raw?.date === '2026-09-17' || /-09-17$/.test(raw?.date || '')) {
        try {
          import('expo-file-system').then(fs => {
            const path = fs.DocumentDirectoryPath + '/JS_RAW_SLOTS_917.json';
            fs.writeAsStringAsync(path, JSON.stringify(raw.slots?.slice(0, 50) || [], null, 2));
          }).catch(()=>{});
        } catch {}
      }
      if (!raw?.date || !Array.isArray(raw.slots) || raw.slots.length === 0) return;
      const date = String(raw.date);
      // ★ DEBUG: 打印原生 emit 的 slots 内容
      console.log(`[BackfillSamples] date=${date} slots=${raw.slots.length}`);
      if (raw.slots.length > 0) {
        const s0 = raw.slots[0];
        const sLast = raw.slots[raw.slots.length - 1];
        const hasSpo2 = raw.slots.filter(s => s.spo2 && Number(s.spo2) > 0).length;
        const hasHrv = raw.slots.filter(s => s.hrv && Number(s.hrv) > 0).length;
        const hasTemp = raw.slots.filter(s => s.temp && Number(s.temp) > 30).length;
        const hasGluc = raw.slots.filter(s => s.glucose && Number(s.glucose) > 0).length;
        console.log(`[BackfillSamples] date=${date} slot0=`, JSON.stringify(s0));
        console.log(`[BackfillSamples] spo2=${hasSpo2} hrv=${hasHrv} temp=${hasTemp} glucose=${hasGluc}`);
      }
      const mk = (nativeKey: string): Array<{ t: number; v: number }> => {
        const out: Array<{ t: number; v: number }> = [];
        for (const s of raw.slots) {
          const v = num(s?.[nativeKey]);
          if (v == null || !Number.isFinite(v) || v <= 0) continue;
          const t = parseSampleTs(date, s?.time);
          if (t == null) continue;
          out.push({ t, v });
        }
        return out;
      };
      const reshaped = {
        date,
        hr: mk('hr'),
        spo2: mk('spo2'),
        temp: mk('temp'),
        hrv: mk('hrv'),
        glucose: mk('glucose'),
        bpSys: mk('bpSys'),
        bpDia: mk('bpDia'),
        steps: mk('step'),
        calorie: mk('cal'),
        distance: mk('dist'),
        stress: mk('stress'),
        met: mk('met'),
      };
      postLog('JS', `[handleBackfillSamples] ✅ date=${date} slots=${raw.slots.length} `
        + `hr=${reshaped.hr.length} spo2=${reshaped.spo2?.length ?? 0} temp=${reshaped.temp?.length ?? 0} hrv=${reshaped.hrv?.length ?? 0} step=${reshaped.steps.length}`);
      postLog('JS', `[handleBackfillSamples] raw.slots[0].keys=${Object.keys(raw.slots[0] || {}).join(',')}`);
      // ★ 临时弹窗：让 Annie 直接在 App 上看到原生 emit 的 hr/spo2/temp/hrv 点数
      if (date.includes('-09-17')) {
        try {
          const { Alert } = require('react-native');
          Alert.alert(
            `Backfill ${date}`,
            `原生 slots[0].keys=${Object.keys(raw.slots[0]||{}).join(',')}
hr点数=${reshaped.hr.length} spo2点数=${reshaped.spo2?.length ?? 0}
temp点数=${reshaped.temp?.length ?? 0} hrv点数=${reshaped.hrv?.length ?? 0}
steps点数=${reshaped.steps?.length ?? 0}`,
            [{ text: 'OK' }]
          );
        } catch {}
      }
      this.handleBackfillDaySlots(reshaped);
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
    insomnia?: number;
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

      // ★ 用 computeSleepScore v2 自算 0-100 分（替代 SDK 原始 0-5 分）
      // v2 新增效率维度(sleepAwake)：从 sleepLine 曲线拿到的 stage 3+4 分钟数
      const si: SleepInput = {
        sleepTotal: total,
        sleepDeep: deep,
        sleepAwake: awake + insomnia,   // 卧床期间的非睡眠分钟数
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
      // ★ 2026-11-06 审查（docs/audit/02 🔴#3）：记录是否走了「合成」路径。
      //   合成路径的各阶段时长是实测，但夜内时间轴分布是按典型睡眠周期铺排的
      //   **示意图** —— 与真实分期曲线视觉上无法区分，必须打标并在 UI 告知。
      let synthesized = false;
      if (Array.isArray(raw.curve) && raw.curve.length) {
        segs = mergeSleepCurve(raw.curve);
      } else if (Array.isArray(raw.segments) && raw.segments.length) {
        segs = raw.segments
          .map((s: any) => ({ type: Number(s.type), start: Number(s.start), end: Number(s.end) }))
          .filter((s: any) => Number.isFinite(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end));
      } else {
        segs = this.synthesizeSleepStages(v);
        synthesized = true;
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
      // ★ 2026-11-06 审查（docs/audit/02 🔴#3）：记录合成日，供 UI 标注。
      const prevSynthDays = this.getState().sleepStagesSynthesizedDays ?? {};
      const nextSynthDays = { ...prevSynthDays };
      if (synthesized) nextSynthDays[dk] = 1; else delete nextSynthDays[dk];
      patch.sleepStagesSynthesizedDays = nextSynthDays;

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
      // sleepTime/wakeTime 一并打出：睡眠负载的「晚睡/规律性」维度依赖它，便于核对
      postLog('JS-SLEEP', `handleSleepDay date=${raw.date} total=${total} deep=${deep} light=${light} rem=${rem} awake=${awake} insomnia=${insomnia} score=${score.toFixed(1)} sdkScore=${sdkScore} 入睡=${v.sleepTime ?? '-'} 起床=${v.wakeTime ?? '-'} getUp=${getUp}`);
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
      // ★ 开始新的 ECG 测量前，清掉残留 progress + 旧读数 + 旧错误（避免显示上一次失败的 HRV=255/HR=0/ecgError）
      this.resetEcgLive();
      this.push({ ecgProgress: null, ecg: null, ecgLiveWaveform: null, ecgError: null, ecgHint: null });
    }
    VeepooNative?.measure(k);
  }
  stopEcg() { VeepooNative?.stopEcg?.(); }
  flash() { VeepooNative?.findDevice(); }
  /** 重连后回填历史日数据（戒指离线期间累积的）：原生按日读 HRV 等历史并带日期回传。 */
  backfill() { VeepooNative?.backfill?.(); }
  /** 离线恢复：先 veepooSdkStartReadDeviceAllData 从戒指 flash 重拉最新离线数据，再逐日回填。 */
  recoverOffline() { VeepooNative?.recoverOffline?.(); }
  /** ★ 2026-10-16：触发呼吸暂停（OSAHS）分析——原生读设备血氧历史 → VPOxygenAnalysisModel 解析。结果经 onOxygenAnalysis 事件写入 RingState.oxygenAnalysis。 */
  async triggerOxygenAnalysis(): Promise<void> {
    try { await VeepooNative?.triggerOxygenAnalysis?.(); } catch { /* 静默 */ }
  }
  /** ★ 2026-10-16：触发 HRV Lorenz 散点读取——原生读 RR 间期历史 → Lorenz 散点。结果经 onRrAnalysis 事件写入 RingState.rrAnalysis。 */
  async readRrAnalysis(): Promise<void> {
    try { await VeepooNative?.readRrAnalysis?.(); } catch { /* 静默 */ }
  }

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
  /** ★ 2026-11-05：原生直连模式下的「云端日值补齐器」定时器（独立，不碰实时链路） */
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private autoMonitor = false;

  constructor(private push: (patch: StatePatch) => void) {}

  private async getJSON(path: string): Promise<any> {
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      method: 'GET',
      // ★ Phase 1：读云端也要带设备令牌（后端按令牌收敛 device_id）
      headers: { Accept: 'application/json', ...authHeaders() },
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

  private async refreshDevice(silent = false) {
    // silent：日值补齐模式下只借它拿 deviceId，不推 status / protocol / 设备名
    const emit = (patch: StatePatch) => { if (!silent) this.push(patch); };
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

      // ★ 2026-11-06 审查（docs/audit/02 🔴#4）：**设备身份黑名单守卫**。
      //   后端设备列表里可能含 demo- / test-diag- 前缀的演示/诊断设备，也可能含
      //   旧 HK18（LEGACY_RING_IDS）。ringDataIsolation 的约定是「任何真机展示链路
      //   都不得读取」—— 这里必须硬拦，否则 start() → refreshDevice() →
      //   refreshMetrics() 会把演示设备的数据直接写进 state.daily 与 healthStore。
      if (dev && isBlockedRingDeviceId(dev.device_id)) {
        this.deviceId = null;
        emit({
          status: 'idle',
          error: '当前后端仅有演示 / 诊断设备，已阻止读取（不展示非真实测量数据）',
          devices: list.map((d) => ({
            id: d.device_id,
            name: d.name || 'Mira Ring Pro',
            rssi: null,
            recommended: !!d.bound,
          })),
        });
        return;
      }

      if (!dev) {
        emit({
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
      emit({
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
      emit({
        status: 'error',
        error: `无法连接后端（${BACKEND_BASE_URL}）：${e?.message || '网络错误'}。请确认后端已启动且与手机同一 WiFi。`,
      });
    }
  }

  private async refreshMetrics(dailyOnly = false) {
    if (!this.deviceId) return;
    // ★ 2026-11-06 审查（docs/audit/02 🔴#4）：兜底再拦一次 —— 演示 / 诊断 /
    //   旧 HK18 设备的任何通道数据都不允许进入 state.daily 与 healthStore。
    if (isBlockedRingDeviceId(this.deviceId)) {
      this.deviceId = null;
      return;
    }
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
    // ★ 2026-11-05（协议复核）：Veepoo SDK 的 VPGSRResultModel 只有
    //   skin_moisture(皮肤含水量 1–99) / sns_activation / emotion / depression_risk / cortisol，
    //   **没有 EDA 皮肤电导**。旧代码把 skin_moisture 与 auto_data.eda_daily_mean
    //   当成「皮电」写进 metrics.eda / daily.eda 是错误命名；11-05 真机连着戒指
    //   也没有任何 EDA 回报。这里不再把 GSR 值投影成 EDA（gsr 通道实测只有 sns）。
    // 体温：health_glance 表实测为空；保留通道但用 saneBodyTemp 挡住脏值/旧戒指遗留值。
    const hgPts = toPts(recs(hgR), (r) => saneBodyTemp(r.payload?.temp));
    const hrvPts = toPts(recs(hrvR), (r) => num(r.payload?.hrv_value));

    const hr = hrPts.length ? hrPts[hrPts.length - 1].v : null;
    const hgLatest = recs(hgR).length ? recs(hgR)[recs(hgR).length - 1].payload : null;
    const spo2FromRealtime = spo2Pts.length ? spo2Pts[spo2Pts.length - 1].v : null;
    const spo2 = spo2FromRealtime ?? num(hgLatest?.spo2) ?? null;
    const temp = saneBodyTemp(hgPts.length ? hgPts[hgPts.length - 1].v : num(hgLatest?.temp));

    const autoLatest = recs(autoR).length ? recs(autoR)[recs(autoR).length - 1].payload : null;
    const auto = autoLatest ?? {};
    const gsrLatest = recs(gsrR).length ? recs(gsrR)[recs(gsrR).length - 1].payload : null;
    const rrBreath = breathPts.length ? breathPts[breathPts.length - 1].v : null;
    const rrAuto = num(auto.sleep?.breath_avg) ?? null;
    const rr = rrBreath ?? rrAuto;

    const hrv = hrvPts.length ? hrvPts[hrvPts.length - 1].v : null;

    // ★ 2026-11-05（用户实锤「我连着戒指啊，为什么很多指标还不出值呢」）：
    //   基础版 LUNA-MIRA 的真实数据全在 auto_data（日聚合）/ gsr / hrv_history 通道，
    //   旧实现只把它们映射进 6 个「实时」RingMetrics，ring.daily 一个键都没写 →
    //   洞察页基础指标卡（renderBasicsCard 读 ring.daily[key]）恒显「—」；
    //   心率/血氧/体温（realtimeKeys 读 ring.metrics）也因 hr_realtime 等通道为空而全空。
    //   这里把云端**已存的真实日值**投影进 metrics + daily，全部为实测回读，不推算、不编数字。
    const hrDay = num(auto.hr_daily_mean);
    const spo2Day = num(auto.spo2_daily_mean);
    const tempDay = saneBodyTemp(auto.temp_daily_mean); // 唯一真实温度：日均体温(℃)
    const metrics: RingMetrics = {
      hr: hr ?? hrDay,
      spo2: spo2 ?? spo2Day,
      temp: temp ?? tempDay,
      eda: null,
      hrv, rr,
    };

    const dailyPatch: Record<string, number> = {};
    const putDaily = (k: string, v: unknown) => {
      const n = num(v);
      if (n != null && Number.isFinite(n)) dailyPatch[k] = n;
    };
    putDaily('hr', hrDay);
    putDaily('spo2', spo2Day);
    putDaily('temp', tempDay);
    // ❌ 不再写 daily['eda']：协议无 EDA；旧值实为皮肤含水量，且 11-05 无任何新回读。
    putDaily('hrv', hrv);
    putDaily('rr', rr);
    putDaily('steps', auto.steps);
    putDaily('distance', auto.distance);
    putDaily('calorie', auto.calorie);
    putDaily('triglyceride', auto.triglyceride);
    putDaily('hdl', auto.hdl);
    putDaily('ldl', auto.ldl);
    putDaily('statusScore', auto.status_score);
    // 交感神经活跃度：gsr 通道的 sns 是真实回读（不是健康一览推算）
    putDaily('sns', gsrLatest?.sns);
    // 睡眠：后端 auto_data.sleep 实测结构 = { total_sleep_min, deep_min, light_min, rem_min, score, get_up }
    if (typeof auto.sleep === 'number') putDaily('sleepTotal', auto.sleep);
    else if (auto.sleep && typeof auto.sleep === 'object') {
      const totalMin = num(auto.sleep.total_sleep_min) ?? num(auto.sleep.total_min)
        ?? num(auto.sleep.total) ?? num(auto.sleep.duration);
      if (totalMin != null && totalMin > 0) {
        putDaily('sleepTotal', totalMin);
        // 洞察页 sleepDeep / sleepRem 期望百分比（不是分钟），按真实分期时长换算
        const deepMin = num(auto.sleep.deep_min);
        const remMin = num(auto.sleep.rem_min);
        if (deepMin != null) putDaily('sleepDeep', Math.round((deepMin / totalMin) * 100));
        if (remMin != null) putDaily('sleepRem', Math.round((remMin / totalMin) * 100));
      }
      putDaily('sleepScore', auto.sleep.score);
    }
    // Pro 才有的健康一览：压力/疲劳/情绪/皮肤含水量/皮质醇（基础版该通道为空 → 自然不写）
    for (const k of ['stress', 'fatigue', 'emotion', 'skin', 'cortisol'] as const) {
      if (hgLatest) putDaily(k, (hgLatest as any)[k]);
    }
    // ★ 2026-11-05：云端 auto_data 是「按天一条、ts = 当日 0 点」，今天尚未上传时最新记录
    //   其实是昨天的日均值。把该批记录对应的日期一起带进 daily，UI 才能如实标「11-04 日均」，
    //   而不是把昨天的值冒充「今日日均」。
    const autoLastRec = recs(autoR).length ? recs(autoR)[recs(autoR).length - 1] : null;
    const autoTs = Number(autoLastRec?.ts);
    if (Number.isFinite(autoTs) && autoTs > 0) {
      dailyPatch['dailyDateTs'] = autoTs < 1e12 ? autoTs * 1000 : autoTs;
    }

    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    const availability: Record<MetricKey, 'live' | 'syncing' | 'unavailable'> = {
      hr: metrics.hr != null ? 'live' : 'unavailable',
      spo2: metrics.spo2 != null ? 'live' : 'unavailable',
      temp: metrics.temp != null ? 'live' : 'unavailable',
      eda: 'unavailable',
      hrv: metrics.hrv != null ? 'live' : 'unavailable',
      rr: metrics.rr != null ? 'live' : 'unavailable',
    };
    // 全天趋势最多保留 1440 点（≈每分钟 1 点），避免数组无限增长。
    const history: Record<MetricKey, TimePoint[]> = {
      hr: tail(hrPts, 1440),
      spo2: tail(spo2Pts, 1440),
      temp: tail(hgPts, 1440),
      eda: [],
      hrv: tail(hrvPts, 1440),
      rr: tail(breathPts, 1440),
    };
    const lastUpdated: Record<MetricKey, number | null> = {
      hr: metrics.hr != null ? nowMs : null,
      spo2: metrics.spo2 != null ? nowMs : null,
      temp: metrics.temp != null ? nowMs : null,
      eda: null,
      hrv: metrics.hrv != null ? nowMs : null,
      rr: metrics.rr != null ? nowMs : null,
    };
    // daily 只带本次有值的键；外层 applyBackendPatch 会与 state.daily 深合并，
    // 不会冲掉 syncExtendedDaily 投影出来的步数/睡眠/HRV 等归档值。
    // ★ 2026-11-05：原生直连戒指时只补 daily，绝不覆盖原生实时 metrics / 连接状态 / lastUpdated。
    if (dailyOnly) {
      this.push({ daily: dailyPatch });
      return;
    }
    this.push({ metrics, availability, history, lastUpdated, daily: dailyPatch });
  }

  /**
   * ★ 2026-11-05（用户实锤「连着戒指为什么很多指标还不出值」）：
   *   真机 RING_DATA_SOURCE='native' → startScan 只走原生桥，BackendRingSource 从不 start()，
   *   导致 auto_data / gsr / hrv_history 里那些**真实的按天回读值**（eda_daily_mean、
   *   temp_daily_mean、sns、hrv_value）一个都没进 ring.daily。
   *   这里启动一个只读补齐器：60s 拉一次，只推 daily（外层回调对 daily 深合并，不删已有归档）。
   *   不写 metrics / availability / lastUpdated / status → 原生实时数据完全不受影响。
   */
  async startDailyFallback() {
    this.stopTimers();
    // ★ 2026-11-05（用户：两套数据源不要混）：
    //   旧实现直接 refreshDevice(true)，后端在「没带 device_id」时返回设备列表第一台，
    //   很可能就是旧 HK18 的 C9:00:9C:D7:C2:D8 → 把旧戒指日值补进基础版 App。
    //   这里先锁定当前连接戒指的可信 MAC，再拉数据；拿不到身份就宁可不出值。
    const trusted = await trustedCurrentRingDeviceId();
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = null;
    if (!this.deviceId) this.deviceId = trusted;
    if (!this.deviceId) return;
    await this.refreshDevice(true);
    // refreshDevice 可能用后端返回的 bound 设备覆盖 deviceId，这里再兜一次黑名单
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = trusted;
    if (!this.deviceId) return;
    await this.refreshMetrics(true);
    if (!this.fallbackTimer) {
      this.fallbackTimer = setInterval(() => void this.refreshMetrics(true), 60_000);
    }
  }

  async start() {
    this.stopTimers();
    // ★ 2026-11-06 审查（docs/audit/02 🔴#4）：与 startDailyFallback 同口径 ——
    //   先锁定当前可信戒指身份再拉数据；拿不到可信身份就宁可不出值。
    //   旧实现直接 refreshDevice()，后端在「没带 device_id」时返回设备列表第一台，
    //   可能就是 demo- / test-diag- / 旧 HK18 → 演示数据会经 refreshMetrics()
    //   直接进 state.daily 与 healthStore。
    const trusted = await trustedCurrentRingDeviceId();
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = null;
    if (!this.deviceId) this.deviceId = trusted;
    if (!this.deviceId) {
      this.push({ status: 'idle', error: '未识别到当前戒指，已阻止读取（不展示非真实测量数据）' });
      return;
    }
    await this.refreshDevice();
    // refreshDevice 可能用后端返回的 bound 设备覆盖 deviceId，这里再兜一次黑名单
    if (isBlockedRingDeviceId(this.deviceId)) {
      this.deviceId = null;
      this.push({ status: 'idle', error: '后端设备为演示 / 诊断设备，已阻止读取（不展示非真实测量数据）' });
      return;
    }
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
    if (this.fallbackTimer) { clearInterval(this.fallbackTimer); this.fallbackTimer = null; }
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
    deviceInfo: null,
    sportSessions: null,
    metrics: { ...DEFAULT_METRICS },
    availability: { ...DEFAULT_AVAILABILITY },
    history: { ...EMPTY_HISTORY },
    lastUpdated: { ...DEFAULT_LAST_UPDATED },
    daily: {},
    dailyHistory: {},
    tempDaily: {},
    sleepStages: null,
    sleepStagesDaily: {},
    sleepStagesSynthesizedDays: {},
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
    ecgLiveWaveform: null,
    ecgError: null,
    ecgHint: null,
    oxygenAnalysis: null,
    rrAnalysis: null,
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
  /** healthStore 写入后延迟落盘用的 debounce 定时器（见 scheduleHealthStorePersist） */
  private healthStorePersistTimer: ReturnType<typeof setTimeout> | null = null;
  private healthStorePersistSubscribed = false;
  /** v18.111 落盘诊断计数器（只打前 3 次，避免刷屏） */
  private _hsPersistDiagCount = 0;
  /** ★ V2 性能：backfill 期间累积 RingState patch，结束后一次性 flush */
  private _pendingBatchPatch: StatePatch | null = null;

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

  /** ★ 2026-10-16：触发呼吸暂停（OSAHS）分析——原生读设备血氧历史 → VPOxygenAnalysisModel 解析。结果经 onOxygenAnalysis 事件写入 RingState.oxygenAnalysis。 */
  async triggerOxygenAnalysis(): Promise<void> {
    try { await VeepooNative?.triggerOxygenAnalysis?.(); } catch { /* 静默 */ }
  }
  /** ★ 2026-10-16：触发 HRV Lorenz 散点读取——原生读 RR 间期历史 → Lorenz 散点。结果经 onRrAnalysis 事件写入 RingState.rrAnalysis。 */
  async readRrAnalysis(): Promise<void> {
    try { await VeepooNative?.readRrAnalysis?.(); } catch { /* 静默 */ }
  }

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
      // ★ v18.96 跨天清零（用户口径：没连戒指=当天没新数据，app 展示断开前的值，但跨天清零；
      //   睡眠情况特殊，可跨天沿用最近一晚并加日期标注）。
      //   metrics / availability / lastUpdated / daily 是**无日期维度的「最新值」扁平表**，
      //   旧实现全仓无任何跨天清零 → 整夜未佩戴时它们还是昨天的数，首页基础卡/日均继续显示昨日值，
      //   且 lastUpdated 的时间戳让「新鲜度」判断误判。现在统一按天清零；
      //   昨日真值已归档在 hrDaily/hrvDaily/tempDaily/spo2Daily/edaDaily/rrDaily/sleepDaily/
      //   stepDaily/extDaily（按天 key）与 healthStore（按天分桶）里，趋势与详情不受影响；
      //   sleepSummary / sleepStages / sleepTime / wakeTime 属睡眠豁免，**不清**（跨天沿用）。
      //   重连回传后 syncExtendedDaily / backfill 会按新数据重新投影并 push（口径B 补齐）。
      this.state = {
        ...this.state,
        metrics: { ...DEFAULT_METRICS },
        availability: Object.keys(DEFAULT_METRICS).reduce(
          (acc, key) => { (acc as any)[key] = 'unavailable'; return acc; },
          {} as Record<MetricKey, 'live' | 'syncing' | 'unavailable'>,
        ),
        lastUpdated: Object.keys(DEFAULT_METRICS).reduce(
          (acc, key) => { (acc as any)[key] = null; return acc; },
          {} as Record<MetricKey, number | null>,
        ),
        daily: {},
      };
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
        this.scheduleRecomputeDailyStatus();
        this.syncExtendedDaily();
        this.ensureDay(Date.now());
        void this.saveSnapshot();
      },
      // 同步进度回调 → 独立轻量通道（底部「正在同步数据 x%」浮层订阅它）
      (p) => this.pushSyncProgress(p)
    );
    // ★ 2026-11-05：后端 refreshMetrics 现在每 10s 推一次 daily（真实日值投影）。
    //   applyPatch 是浅合并，直接推 daily 会整体覆盖 syncExtendedDaily 写进 state 的
    //   步数/睡眠/HRV 归档 → 那些卡片反而变空。这里对后端来源做深合并，只补不删。
    this.backend = new BackendRingSource((patch) => {
      if (patch.daily) {
        this.applyPatch({ ...patch, daily: { ...this.state.daily, ...patch.daily } });
      } else {
        this.applyPatch(patch);
      }
    });

    const wantNative = RING_DATA_SOURCE === 'native';
    this.useNative = wantNative && this.native.available;
    if (wantNative && !this.native.available) {
      // eslint-disable-next-line no-console
      postLog('RingBle', '原生 VeepooRing 模块不可用（非 iOS 真机或未 prebuild），回退后端客户端。');
    }
    this.state.protocol = this.useNative ? 'Veepoo·原生' : 'Veepoo·后端';
    // ★ 2026-11-05：原生直连模式下也补齐云端按天真实回读值（详见 startDailyFallback）。
    if (this.useNative) void this.backend.startDailyFallback();
    // 跨 ⌘R 保留真实数据：启动时异步恢复本地快照（沙盒文件），戒指重连前的空窗期也能看到趋势
    void this.loadPersisted();
    // 恢复「数据同步」开关（独立于快照，确保开关状态总能落盘）
    void this.loadSyncFlag();
    // 读取用户在 App 内手动记录的经期（本地 cycleLog），相位计算据此兜底，避免"记了却显示未记录"
    void this.refreshLocalCycle();
    // 今日状态时间线：对齐「整点 / 整半点」墙钟边界落快照（用户要求 12:00/12:30 出值），
    // 而非从 App 启动时刻起算的 30 分钟漂移，保证每次结果都精确落在 :00 或 :30。
    this.scheduleStatusTick();
    // ★ v18.98：App 切回前台就重算一次今日状态（不必为了看新数据把进程杀掉重开）。
    //   原来只有「完全杀掉 App 重开」才会走 loadPersisted → 跨天重算（v18.97），
    //   而最常见的场景是「把 App 丢后台一夜、第二天早上切回来」——页面挂着的仍是昨天的数字。
    //   recomputeDailyStatus 内部有 ensureDay（跨天清零）+ buildCurveStatus 的今日守卫，
    //   无新数据时它会把今日状态诚实置空，有回传数据时再补上。
    try {
      AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next !== 'active') return;
        try {
          this.scheduleRecomputeDailyStatus(Date.now(), true);
          postLog('RingBle', '[FOREGROUND_RECOMPUTE] App 回到前台已重算今日状态');
        } catch (e) {}
      });
    } catch (e) {}
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

  // ── emit 节流（合并回填期间的重渲染风暴） ──────────────────────────────
  // 背景：applyPatch 在每次数据到达时调用；离线回填期间逐日/逐指标 handler 高频触发，
  // 若每次都同步 emit()，会让所有订阅屏在数秒内整体重渲染几十~上百次 → 整屏卡顿。
  // 现合并为「同窗口内至多 1 次 emit」（默认 200ms）：状态合并与副作用（重连边沿 / 历史投影 /
  // 今日状态重算）仍同步进行，仅把「通知监听者」节流。数据最多延迟 200ms 呈现（用户无感），
  // 但重渲染次数降一个数量级。正常实时监测事件间隔远大于窗口，几乎总是立即 emit，不受影响。
  private emitThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;
  private readonly EMIT_WINDOW_MS = 200;
  private scheduleEmitThrottled() {
    const now = Date.now();
    const elapsed = now - this.lastEmitAt;
    if (elapsed >= this.EMIT_WINDOW_MS) {
      this.lastEmitAt = now;
      this.emit();
      return;
    }
    if (this.emitThrottleTimer) return;
    const remain = this.EMIT_WINDOW_MS - elapsed;
    this.emitThrottleTimer = setTimeout(() => {
      this.emitThrottleTimer = null;
      this.lastEmitAt = Date.now();
      this.emit();
    }, remain);
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
    // ★ 断连重连时立即补打最近的边界点（如果 gap >= 30min）
    // 比如 13:10 重连，立即补打 13:00 的点；不用等 13:30
    const boundaryTs = this.alignBoundaryTs(now);
    if (this.lastCurveAccumTs != null && boundaryTs - this.lastCurveAccumTs >= STATUS_SNAPSHOT_MS) {
      postLog('RingBle', `[scheduleStatusTick] ⚡ 补打错过的边界: ${new Date(boundaryTs).toISOString().slice(11,16)} (gap=${Math.round((boundaryTs - this.lastCurveAccumTs)/60000)}min)`);
      this.scheduleRecomputeDailyStatus(boundaryTs, true); // 用 boundaryTs 而非 now，保证 pushStatusPoint 的 t 对齐
    }
    // 距下一个 :00 / :30 边界的毫秒数（相对整点的分钟：<30→30，否则下个整点 60）
    const nextBoundaryMin = min < 30 ? 30 : 60;
    let delay = (nextBoundaryMin - min) * 60_000 - sec * 1000 - ms;
    if (delay < 0) delay += 30 * 60_000;
    if (delay > 30 * 60_000) delay = 30 * 60_000;
    this.statusTimer = setTimeout(() => {
      this.scheduleRecomputeDailyStatus(Date.now(), true); // force：边界必出一点（若有数据）
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
          // ★ 2026-09-17 改：不再 400ms 就调 backfill（readAllData 还没完成！），
          // 改为等原生 onSdkReady 事件触发真正 backfill。这里设个 45s 兜底——
          // 如果 SDK 初始化链迟迟不回调（部分固件 readAllData 超时），45s 后强制试一次。
          setTimeout(() => {
            if (this.syncEnabled) {
              postLog('RingBle', '[JS] SDK 初始化超时兜底 → 强制 backfill');
              try { this.native.backfill(); } catch { /* ignore */ }
            }
          }, 45000);
        }
      }
      // 状态快照定时器可能在上次断开时被清掉，重连后确保其运行（对齐 :00/:30 边界）
      if (!this.statusTimer) this.scheduleStatusTick();
    }
    // 经期数据变化 → 相位变化 → 重算今日状态（基线/叙事）。recompute 在 main 类上，
    // 故放此处（handleFemale 位于 NativeRingSource，拿不到 recompute）。
    if (patch.female !== undefined) this.scheduleRecomputeDailyStatus();
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
        this.scheduleRecomputeDailyStatus(); // 睡眠/HRV 归档落地后重算今日状态（解锁首页「今日状态」与全天状态趋势）
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        postLog('RingBle', `[applyPatch] 归档投影异常（已忽略，保证 UI 刷新）: ${msg}`);
      }
    }
    // ★ 节流 emit：回填期高频 applyPatch 合并通知，避免全屏重渲染风暴（见 scheduleEmitThrottled）。
    this.scheduleEmitThrottled();
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
        // ★ v18.102（用户实锤「一会儿空、一会儿又冒出数据」的元凶）：
        //   扩展指标多由 HealthGlance/健康一览轮询（~60s）取回，原生**不带样本时间戳**，
        //   旧代码 `m.ts ?? Date.now()` 会把「刚刚轮询到」当成「刚刚测到」写进 lastUpdated，
        //   于是只要 App 在前台，每 60 秒就把「最近采样时刻」刷成当前时间 → 断流判定永远 false，
        //   圆环/恢复/脑力全用旧快照出数；App 一被杀/切后台 → 清成 00:29 → 又变空态。
        //   这就是用户看到的空一下又冒数。修法：没有真实样本时刻就**不刷新 lastUpdated**
        //   （值照常入库供 UI 读，只是不伪造"此刻刚测到"）。
        if (typeof m.ts === 'number' && m.ts > 0) lastUpdated[m.key] = m.ts;
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
    this.scheduleRecomputeDailyStatus();
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
    // ★ v18.95 新鲜度守卫：metrics.hrv 是 last-known 值，隔夜未连戒指时它还是昨天的数。
    //   旧实现会把它写进「今天」的 hrvDaily 归档 → 今日状态种子/趋势被昨天的数污染
    //   （用户实锤：一晚没连，打开 app 照样有恢复程度）。只接受今天收到的实时值（lastUpdated）。
    const todayStartMs0 = new Date(); todayStartMs0.setHours(0, 0, 0, 0);
    const hrvLiveToday = (st.lastUpdated?.hrv ?? 0) >= todayStartMs0.getTime();
    let hv: number | undefined = hrvDaily[today];
    if (typeof hv !== 'number' && hrvLiveToday && typeof st.metrics.hrv === 'number') hv = st.metrics.hrv;
    if (typeof hv === 'number') {
      daily['hrv'] = hv;
      if (hrvDaily[today] == null) hrvDaily[today] = hv; // 落档：供趋势图与跨天历史
      if (metrics['hrv'] == null) metrics['hrv'] = hv;
    }
    // HR：优先用历史日归档 hrDaily；原生实时 HR 走 emitMetric 实时流（落 metrics.hr / history.hr），
    // 若归档缺今日值则用实时值兜底并落档，保证「心率」卡与趋势图有值。
    // ★ v18.95：同 HRV，兜底只允许「今天收到的实时值」（lastUpdated 判定）。
    const hrLiveToday = (st.lastUpdated?.hr ?? 0) >= todayStartMs0.getTime();
    let hrVal: number | undefined = hrDaily[today];
    if (typeof hrVal !== 'number' && hrLiveToday && typeof st.metrics.hr === 'number') hrVal = st.metrics.hr;
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
      // ★ v18.95：只认今天的 HR 采样。history.hr 持久化含昨天旧点，旧实现的「过去 24h 最小值」
      //   会把昨晚的最小心率当作今天的 RHR（用户实锤：一晚没连也出晨间静息心率）。
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      const inWin = hr.filter((p) => p.t >= dayStart.getTime());
      return inWin.length ? Math.min(...inWin.map((p) => p.v)) : null;
    }
    const inWin = hr.filter((p) => p.t >= lo && p.t <= hi && isSameDay(p.t, now));
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
    this.scheduleRecomputeDailyStatus();
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
   * - 仅当距上次累积 ≥30 分钟：提取本窗口信号 → accumulateWindow 累积 → 追加一个今日状态点。
   * - 高频数据刷新不触发累积，只刷新头条（用时间线最新点），避免重复扣减。
   * 详见 docs/daily-status-curve-spec.md。
   */
  /** 「昨晚这一夜」的睡眠归档（今天那条，或昨天那条但起床落在今早）。
   *  ★ v18.98（用户口径：对齐 Oura）：没有昨晚的睡眠就是「没有数据」，
   *    **不再**允许回退到 2–N 天前的旧归档去凑一个晨间恢复分。
   *    旧实现（≤2 天内任意一晚）会让「连着两晚没戴戒指」的早上照样冒出状态分/恢复分 ——
   *    用户实锤后改为只认今晚；返回 null 时 recomputeDailyStatus 的 hasTodayInput 为假，
   *    种子直接为 null → 首页圆环/全天趋势诚实空态，恢复/脑力 chip 显示「—」。 */
  private lastNightSleep(): {
    dateKey: string;
    total: number;
    deep: number;
    light: number;
    rem: number;
    score: number;
    getUp: number;
  } | null {
    const todayKey = this.bucketDay || dayKeyOf(Date.now());
    const ystKey = dayKeyOf(Date.now() - DAY_MS);
    const sleepAt = (k: string, v: any) => {
      if (!v || !(v.total > 0)) return false;
      if (k !== todayKey && k !== ystKey) return false;             // 只要今晚（或记在前一日的昨晚）
      const up = typeof v.getUp === 'number' ? v.getUp : null;      // 起床时刻（分钟）
      if (up == null) return true;                                  // 无起床时刻 → 无法证伪，按今晚算
      return up < 12 * 60;                                          // 12:00 前起床 ⇒ 昨晚睡到今早
    };
    for (const k of [todayKey, ystKey]) {
      const v = (this.state.sleepDaily as any)?.[k];
      if (sleepAt(k, v)) return { dateKey: k, ...(v as any) };
    }
    return null;
  }

  // ★ 性能修复（2026-10-28）：合并同一事件循环（同一帧）内的多次 recompute 调用。
  //   BLE 密集推送 / 回填 / 归档落地会在极短时间内连续触发多次 recomputeDailyStatus，
  //   每次都跑全量算法（buildCurveStatus / accumulateWindow / 基线推导），把主线程占满
  //   → 触摸事件被丢弃（表现为"一阵一阵点不动 / 卡"）。
  //   这里把请求入队，用 setTimeout(0) 合并为「一次事件循环只算一次」：取最新 now + force 的 OR。
  private _recomputeScheduled = false;
  private _recomputePending: { now: number; force: boolean } | null = null;
  private scheduleRecomputeDailyStatus(now: number = Date.now(), force = false) {
    if (this._recomputePending) {
      this._recomputePending.now = Math.max(this._recomputePending.now, now);
      this._recomputePending.force = this._recomputePending.force || force;
    } else {
      this._recomputePending = { now, force };
    }
    if (this._recomputeScheduled) return;
    this._recomputeScheduled = true;
    setTimeout(() => {
      this._recomputeScheduled = false;
      const args = this._recomputePending;
      this._recomputePending = null;
      if (args) this.recomputeDailyStatus(args.now, args.force);
    }, 0);
  }

  private recomputeDailyStatus(now: number = Date.now(), force = false) {
    // ★ v18.96 跨天驱动（审计 1-1）：ensureDay 原本只在 ingest/ingestExt/flush 里调用，
    //   整夜未佩戴（无任何实时样本）时 bucketDay 永远停在昨天 → 所有 `bucketDay || dayKeyOf(now)`
    //   兜底都返回昨天，statusDaily 也会把今天的均值写到昨天的 key 下。
    //   状态重算/打点（含冷启动首帧、边界定时器）都是可靠的跨天触发点，在这里先驱动日切。
    this.ensureDay(now);
    // ★ v18.99 一次性取证日志（用户质疑「0:29 和 10:02 到底哪个是真的」）：
    //   同时打印两套 lastUpdated —— 戒指侧 state.lastUpdated（实时流/回填写入的样本时刻）
    //   与 healthStore 侧缓存时间（洞察页健康项卡片用的是这个）。两者口径不同，
    //   之前错在把前者直接搬到首页、和后者显示的 0:29 撞成「两个时间打架」。
    // ★ v18.100：探针改为**无条件 + 5 分钟节流**（原来挂在 force 上，冷启动没走到就永远抓不到）。
    try {
      if (now - ((this as any).__probeAt ?? 0) > 5 * 60 * 1000) {
        (this as any).__probeAt = now;
        const g = (t: any): string => (typeof t === 'number' && t > 0 ? new Date(t).toTimeString().slice(0, 5) : '—');
        const lu: any = this.state.lastUpdated ?? {};
        const hs: any = (healthStore as any)?.lastUpdated ?? {};
        const newest = Math.max(lu.hr ?? 0, lu.spo2 ?? 0, lu.eda ?? 0, lu.hrv ?? 0, lu.temp ?? 0, lu.rr ?? 0, this.state.lastSyncedAt ?? 0);
        const tlLast = this.state.statusTimeline.length ? this.state.statusTimeline[this.state.statusTimeline.length - 1].t : 0;
        postLog(
          'JS',
          `[LU-PROBE] now=${g(now)} | ring: hr=${g(lu.hr)} spo2=${g(lu.spo2)} eda=${g(lu.eda)} hrv=${g(lu.hrv)} temp=${g(lu.temp)} sync=${g(this.state.lastSyncedAt)} | newestSample=${g(newest)} newest=${Math.round((now - newest) / 60000)}min tlLast=${g(tlLast)} | hs: hr=${g(hs.hr)} steps=${g(hs.steps)} sleep=${g(hs.sleep)}`,
        );
      }
    } catch (_e) {}
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
    // ★ v18.95 新鲜度守卫：种子只吃「今天」的 HRV（用户实锤：一晚没连戒指还出晨间恢复分）。
    //   metrics.hrv 是 last-known（可能是昨天的旧值）、daily['hrv'] 也可能被 syncExtendedDaily
    //   用旧实时值兜底过 → 一律以 lastUpdated['hrv'] 是否 ≥ 今日 0 点为准；今日归档 hrvDaily
    //   只能来自今天真实采样（backfill / 今日实时落档）。
    const todayStartMs = new Date(now); todayStartMs.setHours(0, 0, 0, 0);
    const hrvFreshToday = (this.state.lastUpdated?.hrv ?? 0) >= todayStartMs.getTime();
    const hrvDailyToday = typeof this.state.hrvDaily[dayKey] === 'number' ? this.state.hrvDaily[dayKey] : null;
    const liveHrv = hrvFreshToday && typeof this.state.metrics.hrv === 'number' ? this.state.metrics.hrv : null;
    const hrvRaw =
      hrvDailyToday ??
      liveHrv ??
      (hrvFreshToday && typeof this.state.daily['hrv'] === 'number' ? this.state.daily['hrv'] : null);
    const hrv =
      hrvRaw != null && hrvRaw <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvRaw >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvRaw
        : null;
    const rhr = this.deriveRHR();
    // ★ 2026-10-05：当日日均皮肤温纳入综合复合分（对齐 Oura 体温压力信号）。取今日 tempDaily；
    //   不参与 hasTodayInput 守卫（温是日级均值、非实时新鲜度信号），有则参与、无则跳过该路。
    const temp = typeof this.state.tempDaily[dayKey] === 'number' ? this.state.tempDaily[dayKey] : null;
    const ss = this.state.sleepSummaryDate === dayKey ? this.state.sleepSummary : null;
    // ★ v18.96：todaySleepTotal = 属于「今天」的睡眠（今日 sleepSummary）；与下面的历史回退严格区分，
    //   跨天清零判定只看它 + 今日 HRV/RHR。
    const todaySleepTotal: number | null = ss?.total ?? null;
    let sleepTotal: number | null = todaySleepTotal;
    let sleepDeep: number | null = ss?.deep ?? null;
    let getUp: number | null = ss?.getUp ?? null;
    // 今日 sleepSummary 缺失时（backfill 只回填过去夜 dn>=1），回退到最近一晚的真实睡眠归档。
    // ★ v18.95：回退不再静默——记下用的哪一天的归档，buildCurveStatus 会在文案里显式标注，
    //   避免「昨晚没戴/没连，今早照样出晨间恢复分」被误读成昨夜实测。
    let seedSleepFallbackDate: string | null = null;
    if (sleepTotal == null) {
      const latest = this.lastNightSleep();
      if (latest) {
        sleepTotal = latest.total;
        sleepDeep = latest.deep;
        getUp = latest.getUp;
        seedSleepFallbackDate = latest.dateKey;
      }
    }
    // ★ v18.96 跨天清零（用户口径：断开时展示断开前的数据，跨天清零；睡眠情况特殊可沿用并加日期）：
    //   今日状态种子必须至少有一个「今天的新输入」——今日睡眠归档 / 今日 HRV / 今日 RHR。
    //   隔夜未连戒指时三者皆无 → 纯历史睡眠回退**不作为今日种子**（否则每天早上都能拿昨天的
    //   睡眠生成今天的恢复分）。睡眠的跨天豁免体现在：恢复 chip 与脑力账户（认知准备度）
    //   仍用最近一晚并各自带日期标注；今日状态在有今日输入时，回退的那一晚也会在头条标来源。
    const hasTodayInput = todaySleepTotal != null || hrv != null || rhr != null;
    // 今日记录（写 statusHistory / 算基线）同样只收今日真实输入，回退睡眠不进基线（避免同一晚被计两次）。
    const sleep: TodayInput['sleep'] = hasTodayInput
      ? { sleepTotal, sleepDeep, getUp }
      : { sleepTotal: null, sleepDeep: null, getUp: null };
    const input: TodayInput = { hrv, rhr, sleep, temp };
    // 解锁被锁死的 null 种子：已有曲线、但其 seed 为 null、且当前已拿到有效输入（HRV/睡眠/静息心率任一）→ 强制重算。
    // 修复「当日首次 recompute 时数据尚未到达 → 种子锁死为 null，之后数据到了也不再解锁」导致今日状态全天空白。
    if (curve && curve.seed.value == null && hasTodayInput) {
      needSeed = true;
    }
    // ★ v18.96 逻辑B（重连补齐）：今日睡眠此刻才落库（清晨回传昨夜睡眠），而当前种子是
    //   「还没有今日睡眠」时算出来的（常见于夜里先有 HRV、清晨才同步）→ 用新到的睡眠重算种子，
    //   否则今日状态会一直沿用缺睡眠的旧种子。重算后按当前边界重锚该点（pushStatusPoint 同 ts 覆盖）。
    if (curve && todaySleepTotal != null && curve.seedHadTodaySleep === false) {
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
        // ★ v18.96 跨天清零（用户口径：断开时展示断开前的数据，跨天清零；睡眠例外）：
        //   归档后把非今日的点从「今日时间线」里真正裁掉。旧实现只归档不裁剪 →
        //   昨天整条曲线会继续留在 statusTimeline 里，被后面的 todayVals 当成今天的均值
        //   写进 statusDaily[今天] → 隔夜没连戒指，趋势图今天照样有曲线/数值。
        this.state.statusTimeline = this.state.statusTimeline.filter((p) => isSameDay(p.t, now));
      }
    }

    if (needSeed) {
      const seed = computeSeed({ input, history, cycle, consts: CURVE_DEFAULTS });
      const baseline = deriveDaytimeBaseline(history, cycle.phase as PhaseBucket, CURVE_DEFAULTS);
      curve = { dayKey, seed, baseline, lastWindowSteps: this.todaySteps(), lastWearTs: now, seedSleepFallbackDate, seedHadTodaySleep: todaySleepTotal != null };
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

    // ★ v18.95：睡眠回退状态随数据到达而变（如今晨连上拿到昨夜 sleepSummary）→ 曲线标志同步更新，
    //   头条「睡眠为 M/D 数据」标注随之消失/出现。
    if (curve && curve.seedSleepFallbackDate !== seedSleepFallbackDate) {
      curve = { ...curve, seedSleepFallbackDate };
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
      temp,
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
        // ★ 未佩戴守卫（v18.30）：本累积窗口内没有任何真实生理采样（HR/EDA 无窗口内新点、步数零增量）
        //   → 视为「戒指没在采集」，跳过累积：不打卡点、不推进曲线，今日状态冻结在最后一个有数据的边界。
        //   此前的 bug：边界定时器 force=true 恒 due → 窗口里全是旧数据/零信号也照样 accumulateWindow，
        //   摘下戒指后今日状态仍在“自走”（每 30 分钟凭空变一次）。
        //   跳过时把 lastCurveAccumTs 推进到本边界（空档记为已处理，避免重连补打拿错窗口的信号），
        //   但【不】刷新 lastWearTs → 长时间摘下后，软重置逻辑照常在重新佩戴时生效。
        const winStart = this.lastCurveAccumTs == null ? now - STATUS_SNAPSHOT_MS : this.lastCurveAccumTs;
        // ★ v18.96：新鲜采样判定同样限定「今天」，跨天首窗口不再被昨天 23:xx 的点误判为在戴。
        const hasFreshHr = this.state.history.hr.some((p) => p.t > winStart && p.t <= now && isSameDay(p.t, now));
        const hasFreshEda = this.state.history.eda.some((p) => p.t > winStart && p.t <= now && isSameDay(p.t, now));
        const hasFreshSteps = (sig.stepsDelta ?? 0) > 0;
        if (!hasFreshHr && !hasFreshEda && !hasFreshSteps) {
          const fmtT = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
          postLog('RingBle', `[DailyStatus] 窗口无新采样(未佩戴?) ${fmtT(winStart)}→${fmtT(now)}，跳过累积`);
          this.lastCurveAccumTs = boundaryTs;
        } else {
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
        }
      } else {
        // 数据刷新但非累积边界：戒指在戴，仅刷新佩戴时间戳，不推进曲线
        curve = { ...curve, lastWearTs: now };
      }
    }

    // 当日状态分值：今天 statusTimeline 的均值，写入 statusDaily（按天聚合，供周/月/年趋势）
    // ★ v18.96：只取**今天**的点。旧实现不过滤日期，跨天时残留的昨日点会被算成今天的均值。
    const todayVals = this.state.statusTimeline
      .filter((p) => isSameDay(p.t, now) && Number.isFinite(p.value))
      .map((p) => p.value);
    const todayMean = todayVals.length ? todayVals.reduce((a, b) => a + b, 0) / todayVals.length : null;
    const statusDaily =
      todayMean != null && Number.isFinite(todayMean)
        ? { ...this.state.statusDaily, [dayKeyOf(now)]: todayMean }
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
    // ★ v18.106：真实采样点显式 fill:false —— 首页趋势图只画这种点。
    const point: CurvePoint = { t: ts, value, level: curveLevel(value, CURVE_DEFAULTS).level, fill: false };
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
      // ★ v18.106：保留 fill 标记（真实采样点 false / 空缺补齐点 true 都要活过持久化）
      out.push({ t: ts, value: typeof p.value === 'number' ? p.value : NaN, level: p.level, fill: p.fill });
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
    // ★ v18.96：只取**今天**的窗口内样本。history 由快照恢复时含昨天旧点，
    //   跨天后的第一个窗口（00:00–00:30）会把昨天 23:40 的心率当成当前信号。
    const hrPts = this.state.history.hr.filter((p) => now - p.t <= WIN && isSameDay(p.t, now));
    const hrMean = hrPts.length ? hrPts.reduce((a, p) => a + p.v, 0) / hrPts.length : null;
    const cur = this.todaySteps();
    const stepsDelta = cur != null && curve.lastWindowSteps != null ? Math.max(0, cur - curve.lastWindowSteps) : 0;
    const edaPts = this.state.history.eda.filter((p) => now - p.t <= WIN && isSameDay(p.t, now));
    const edaEvents = this.countEdaEvents(edaPts);
    const hrvRaw = this.state.metrics.hrv;
    const hrv =
      hrvRaw != null && hrvRaw <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvRaw >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvRaw
        : null;
    const asleep = this.isAsleepNow(now);
    const isNap = !asleep && hrMean != null && hrMean < curve.baseline.hrRest * 0.95 && stepsDelta < 5 && this.isDaytime(now);
    // ★ v18.155：实时累积路径的睡眠段也要收敛到「这一夜能恢复到的水位」，
    //   否则在线累积（这里）与离线重建（rebuildDayTimelineFromHealthStore）会走出两条不同的夜间曲线。
    //   目标取当日 seed —— 它已经是用昨夜睡眠/HRV/RHR 算出来的晨间恢复度。
    const sleepTarget = asleep && Number.isFinite(curve.seed.value as number)
      ? (curve.seed.value as number)
      : null;
    return { hrMean, stepsDelta, edaEvents, hrv, asleep, isNap, sleepTarget };
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
    // ★ v18.96：sleepTime/wakeTime 是无日期的顶层扁平字段（只在「今日」分支写入、跨天不清）。
    //   昨天夜里的入睡/起床时刻会被套到今天，误判「现在还在睡」→ 今日状态/情绪点阵错位。
    //   今天没有睡眠记录时一律不判睡眠（睡眠跨天豁免只用于展示最近一晚，不用于判定此刻状态）。
    if (this.state.sleepSummaryDate !== dayKeyOf(now)) return false;
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

  /** 佩戴中断软重置用：依据当前窗口情境估算一个粗略今日状态 */
  private spotBattery(sig: WindowSignals, baseline: DaytimeBaseline): number {
    // ★ v18.155：睡眠情境下的快照值也用 sleepTarget（这一夜能恢复到的水位），
    //   不再硬编码 95 —— 否则「睡眠中断连 2h」的软重置会在夜间凭空拉出一个 95。
    if (sig.asleep) return clampN(sig.sleepTarget ?? 95, 0, 100);
    if (isRecoveringNow(sig, baseline, CURVE_DEFAULTS)) return 90;
    const active =
      (sig.hrMean != null && sig.hrMean > baseline.hrRest * 1.1) ||
      (sig.stepsDelta ?? 0) > CURVE_DEFAULTS.STEP_BASELINE * 0.3;
    return active ? 60 : 72;
  }

  private buildCurveStatus(curve: DailyCurveSeed | null, cycle: CycleInfo): CurveStatus {
    const now = Date.now();
    // ★ v18.96 跨天清零（审计 2-2）：只认**今天**的时间线点。旧实现 tlAllZero 只判「全为 0」，
    //   跨天后残留的昨天曲线会让首页圆环/大字继续显示昨天的状态分且无任何提示。
    const tl = this.state.statusTimeline.filter((p: any) => isSameDay(p.t, now));
    const tlAllZero = tl.length > 0 && tl.every((p: any) => !Number.isFinite(p.value) || p.value === 0);
    // ★ v18.97：曲线种子本身也必须是今天的。冷启动/热重载时若快照里的 dailyCurve 属于昨天，
    //   它的 seed.value 是昨天的晨间恢复分 —— 即使时间线已清空，也会让圆环显示昨天的数字。
    const curveIsToday = !!curve && curve.dayKey === dayKeyOf(now);
    // ★ v18.98（用户口径：对齐 Oura）：「今天到底有没有在测量」必须能被证伪。
    //   三条硬凭据任一成立才允许圆环出数：①今天已经累积过真实状态点；②近 30 分钟内有戒指采样
    //   （戒指此刻在戴）；③种子是用**今晚**的睡眠算的（晨间恢复分，当晚戴了戒指才有）。
    //   旧实现只要 seed 有值就出数 → 连着几晚没戴戒指，早上打开仍挂着一个昨天的状态分（用户实锤）。
    const freshSample = (arr: { t: number }[] | undefined): boolean =>
      !!arr && arr.some((p: any) => isSameDay(p.t, now) && now - p.t <= 30 * 60 * 1000);
    const hasTodayMeasurement =
      tl.length > 0 || freshSample(this.state.history?.hr) || freshSample(this.state.history?.eda) || curve?.seedHadTodaySleep === true;
    // ★ v18.100 断流即空态：戒指太久没给 App 送数据（>3h）→ 屏幕上任何数字都是旧快照。
    //   真机取证：2026-10-03 用户实测 lastUpdated 全部停在 00:29（hr/spo2/eda/hrv/temp/sync 一致），
    //   而首页还挂着恢复 96 / 脑力 39 / 圆环 62 → 正是用户要「断流即空态」的场景。
    const luAny: Record<string, unknown> = (this.state.lastUpdated ?? {}) as Record<string, unknown>;
    // ★ v18.101 只认**指标级真实采样**（lastUpdated），不再把 lastSyncedAt / 今日状态点算进兜底。
    //   根因实锤（用户「显示空的一会儿又展示数据」）：`lastSyncedAt` 在「连上戒指」边沿和
    //   「离线回填完成」都会被刷成 Date.now()，而「今日最后状态点」来自回填的历史采样。
    //   于是冷启动第一帧 state 被跨天清零 → 判断流 → 圆环空；几秒后回填跑完把 lastSyncedAt 刷成 now，
    //   判定立刻翻回「有数据」→ 旧值又冒出来。这就是用户看到的「空一下又冒数」。
    //   现在判定源只有一处：戒指真正推送过采样的时刻。回填再多也不是「此刻有实时数据」。
    const lastSampleAt = (() => {
      const vals = (['hr', 'spo2', 'eda', 'hrv', 'temp', 'rr', 'skin'] as const).map((k) => {
        const v = luAny[k];
        return typeof v === 'number' && v > 0 ? v : 0;
      });
      return Math.max(...vals) || null;
    })();
    // 没有任何一个指标写过采样时间（跨天清零那一帧 / 戒指从没回传）= 断流，不能放数字上屏。
    // ★ v18.121 口径反转（用户口述定稿，**覆盖 v18.100 的「3 小时断流即空态」**）：
    //   「3 点断开 → 手机上看的就是 3 点的值；4 点看还是 3 点的值；什么时候连上戒指，数据才更新上去。
    //    不用写「10:20 停止更新」这类提示，就是旧值停着不动。」
    //   ⇒ dataStale 的含义从「最近一次采样距今 > 3h」改成「**当前没连着戒指**」：
    //   **只在从来没采到过数据时置空**；一旦采到过，就保留那最后一批值（冻结），
    //   等重连 + 离线回填带来新数据时自然刷新。
    //   ⚠ 不再用「3 小时」做阈值：3 点断开、4 点看是同一份值（同一口径），
    //   若用时长阈值就会出现「2 点还显示、3 点突然全空」的割裂。
    const notConnected = this.state.status !== 'connected';
    const dataStale = lastSampleAt == null;
    // 「已采到过数据但当前断开」→ 保留旧值冻结显示（v18.121 口径）。
    // notConnected 目前只用于上面的语义说明与日志；UI 不需要额外提示（用户明确不要「停止更新」文案）。
    void notConnected;
    // ★ v18.101：只在判定结果翻转时打日志（原来每次都打会灌爆主队列，也看不出翻转）。
    //   日志里打出**全部 lastUpdated 明细**——翻转的元凶就是某个被刷新的指标（上一轮就是
    //   lastSyncedAt 被回填刷成 now 导致的），只报一个 max 值定位不到是谁。
    try {
      const f = (t: unknown) => (typeof t === 'number' && t > 0 ? new Date(t).toTimeString().slice(0, 5) : '—');
      const detail = Object.keys(luAny)
        .filter((k) => typeof luAny[k] === 'number')
        .map((k) => `${k}=${f(luAny[k] as number)}`)
        .join(' ');
      const prev: boolean | undefined = (this as any).__lastDataStale;
      if (prev !== dataStale) {
        (this as any).__lastDataStale = dataStale;
        postLog(
          'RingBle',
          `[CurveStatus] ${dataStale ? '⇄ 判定为空态（断流）' : '⇄ 判定为有数据'}：最近采样 ${f(lastSampleAt)} 距今 ${Math.round((now - (lastSampleAt ?? now)) / 60000)}min · lastUpdated=[${detail || '空'}], sync=${f(this.state.lastSyncedAt)}`,
        );
      }
    } catch (_e) {}
    if (!curve || !curveIsToday || curve.seed.value == null || tlAllZero || !hasTodayMeasurement || dataStale) {
      const pb = cycle.phase as PhaseBucket;
      // ★ 一致性修正：取时间最新点而非数组末位（数组可能因跨天清理/种子补点乱序）
      const tlSorted0 = tl.length ? [...tl].sort((a: any, b: any) => a.t - b.t) : [];
      const lastT = tlSorted0.length ? tlSorted0[tlSorted0.length - 1].t : null;
      // 阈值 3h，按小时取整；不足 1 小时（刚跨过阈值）也至少写 1 小时，不写「0 小时」
      // ★ v18.121：dataStale 现在只表示「**从来没采到过数据**」（旧口径是「距上次采样 > 3h」，
      //   会把「断开 3 小时后仍显示同一份旧值」的正常冻结误判成空态）。
      //   真正断流（从未采到）时的引导文案；v18.107 已定稿不报「已 N 小时 / 数据截至几点」。
      const staleNarrative = '暂无数据，请佩戴戒指。约半小时会更新最新数据。';
      return {
        value: null,
        level: null,
        phaseLabel: PHASE_TEXT[pb] ?? '未记录',
        dayInCycle: cycle.dayInCycle,
        hasLog: cycle.hasLog,
        estrogenIndex: cycle.estrogenIndex ?? null,
        seed: null,
        narrative: dataStale ? staleNarrative : cycle.hasLog
          ? '今日佩戴数据不足，暂无法评估恢复状态'
          : '记录经期并连续佩戴几天后，开启今日状态评估',
        hasData: false,
        staleSleepDate: null,
        // ★ v18.121：始终交出最后一点（不再按 dataStale 清空）——
        //   圆环下方「更新于 HH:MM」要靠它表达「数据停在什么时候」。
        //   从没采到数据时 lastT 本来就是 null，不会误导。
        lastPointAt: lastT,
        dataStale,
        lastSampleAt,
      };
    }
    // ★ v18.96：取「今天最后一个点」，跨天时不用昨天的末值冒充今天。
    // ★ 一致性修正：按时间排序后取最新点，与详情页（StatusTrendDetail）口径完全一致，
    //   避免数组乱序导致首页圆环/大字与详情页 hero 显示不同数值（用户实锤 81 vs 60）。
    const tlSorted = tl.length ? [...tl].sort((a: any, b: any) => a.t - b.t) : [];
    const lastPoint = tlSorted.length ? tlSorted[tlSorted.length - 1] : null;
    const value = (lastPoint?.value ?? null) ?? curve.seed.value;
    const lvl = curveLevel(value, CURVE_DEFAULTS);
    const seed = curve.seed;
    const delta = seed.recoveryDelta != null ? `${seed.recoveryDelta > 0 ? '+' : ''}${Math.round(seed.recoveryDelta)}` : '';
    // 显示相位跟随实时 cycle（用户中途记经期立即生效）；seed.phaseBucket 仅用于晨间能量种子，保持锁死
    const phaseLabel = PHASE_TEXT[cycle.phase as PhaseBucket] ?? '未记录';
    let narrative = `${phaseLabel}${cycle.hasLog && cycle.dayInCycle ? ` · 周期第 ${cycle.dayInCycle} 天` : ''} · 晨间恢复 ${Math.round(curve.seed.value)}（${seed.recoveryLabel}${delta ? ' ' + delta : ''}）`;
    // ★ v18.98：不再在头条塞「睡眠为 M/D 数据」这类溯源小字（用户口径：不要写昨/日期，
    //   拿不到昨晚睡眠时圆环直接是空态）。种子来源仍保留在 curve.seedSleepFallbackDate 字段里，
    //   只作诊断/日志用途，UI 不渲染。
    const staleSleepDate =
      curve.seedSleepFallbackDate && curve.seedSleepFallbackDate !== dayKeyOf(now) ? curve.seedSleepFallbackDate : null;
    if (staleSleepDate) postLog('RingBle', `[CurveStatus] ⚠️ 今日种子用了非今晚的睡眠归档（${staleSleepDate}）`);
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
      staleSleepDate,
      // ★ 一致性修正：时间排序后取最新点的时刻
      lastPointAt: tlSorted.length ? tlSorted[tlSorted.length - 1].t : null,
      dataStale,
      lastSampleAt,
    };
  }

  /**
   * 反推历史「今日状态」分值：backfill 拉回的历史 HRV / 睡眠 / 计步，本机从未在线，
   * 没有当时的实时曲线——用 dailyStatus 的晨间种子模型按「当日可用信号」估算一个状态分，
   * 写入 statusDaily[该日]。仅回填过去日（!= 今天），今天由实时曲线累积、不覆盖。
   * 诚实标注：这是基于 HRV/睡眠的推算分，不是当时逐 30 分钟的完整曲线。
   */
  private rebuildHistoricalStatus() {
    if (this.rebuildHistoricalStatusRunning) {
      // ★ v18.112 重入丢失是「回填完了趋势图还是没线」的真凶：
      //   healthStore.subscribe(节流调和) 在回填期间几百毫秒一次地触发重建，
      //   而 rebuildHistoricalStatusImpl 是同步重活（30 天 × 48 窗聚合），
      //   第一次还在跑时后续调用全被这个锁静默丢弃 ——
      //   包括 backfillDone 之后那次最关键的 requestFlush（实锤：日志里
      //   `[Batch] ✅ hr dk=2026-10-03 n=147` 之后 `requestFlush` 跑了，
      //   但 `合并今日 statusTimeline` 0 次）。
      // 改成「记一次待重跑」：当前这次跑完立刻再跑一轮，保证回填最后状态被算进去。
      this._rebuildPending = true;
      return;
    }
    this.rebuildHistoricalStatusRunning = true;
    try {
      this.rebuildHistoricalStatusImpl();
    } finally {
      this.rebuildHistoricalStatusRunning = false;
    }
    if (this._rebuildPending) {
      this._rebuildPending = false;
      postLog('RingBle', '[rebuildHistoricalStatus] 期间有请求被合并，补跑一轮');
      this.rebuildHistoricalStatus();
    }
  }

  private rebuildHistoricalStatusRunning = false;
  /** v18.112：运行期间收到的重建请求（合并成一次补跑，避免丢最后一次） */
  private _rebuildPending = false;
  /** v18.112：今日合并判定只诊断一次 */
  private _hsTodayDiagDone = false;
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
    // ★ v18.115：历史回填也要能写基线库（见循环内的说明）
    let statusHistory = this.state.statusHistory;
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

    // ★ v18.115 前置：先把回填日灌进基线库，再进重建循环。
    //   顺序很关键 —— 基线（hrRest / hrvExpected）是在重建循环里逐日调 computeSeed 与
    //   deriveDaytimeBaseline 时读的。若先重建后灌库，本轮仍用旧（空/文献）基线算完所有曲线，
    //   要等下一次触发才生效；回填是低频事件（启动/重连一次），很可能永远等不到。
    //   这里两段式：① 先全量灌库 → ② 再重建，基线从第一轮就是个人值。
    //   ⚠ mergeRecord 每次都返回新数组，引用比较恒不等 → 用「天数 + 末条内容」判断是否真的变了。
    const histBefore = this.state.statusHistory;
    const histBeforeKey = `${histBefore.length}|${histBefore[histBefore.length - 1]?.date ?? ''}|${
      histBefore[histBefore.length - 1]?.hrv ?? ''
    }|${histBefore[histBefore.length - 1]?.rhr ?? ''}|${histBefore[histBefore.length - 1]?.phase ?? ''}`;
    for (const dk of days) {
      if (dk === todayKey) continue; // 今日由 recomputeDailyStatus 走 mergeRecord 那条路
      const hrvOk =
        hrv[dk] != null && hrv[dk] <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrv[dk] >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
          ? hrv[dk]
          : null;
      const rec = this.buildBackfillBaselineRecord(dk, hrvOk, sleep[dk]);
      if (rec) statusHistory = this.mergeRecord(statusHistory, rec);
    }
    // ★ 基线库灌入后要落盘：否则下次冷启动 loadPersisted 拿的是旧 statusHistory，
    //   分级门槛又退回文献值，等于白灌（末尾的 emit() 会 scheduleSave 5s 内写盘）。
    const lastRec = statusHistory[statusHistory.length - 1];
    const histAfterKey = `${statusHistory.length}|${lastRec?.date ?? ''}|${lastRec?.hrv ?? ''}|${
      lastRec?.rhr ?? ''
    }|${lastRec?.phase ?? ''}`;
    if (histAfterKey !== histBeforeKey) {
      this.state = { ...this.state, statusHistory };
      const byPhase: Record<string, number> = {};
      for (const r of statusHistory) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
      postLog(
        'RingBle',
        `[rebuildHistoricalStatus] 📥 基线库前置灌入：${statusHistory.length} 天 · 相位分布 ${JSON.stringify(byPhase)}`,
      );
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
        temp: (this.state.tempDaily as any)?.[dk] ?? null,
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

      // ★ v18.115 历史回填喂进个人基线库：已在**循环之前**统一完成（见上方「前置」段），
      //   这里不再逐日 merge —— 顺序理由见前置段注释（基线在重建时被读，必须先灌库）。

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
        // ★ v18.110：合并门槛放宽——只要「重建出来的真实数据点」比现有时间线里的真实点多，
        //   就重新合并。作用：戒指重新连上、healthStore 补进新的 intraday 窗口后，
        //   趋势图能立刻用上这些回填点（旧实现 statusTimeline.length < 12 时一次性就不合了，
        //   导致重连后曲线仍停在几个点）。
        const existingReal = statusTimeline.filter((p) => p.fill === false).length;
        const rebuilt0 = this.rebuildDayTimelineFromHealthStore(dk, seedVal, cycle);
        const rebuiltReal = (rebuilt0 ?? []).filter((p) => p.fill === false).length;
        // ★ v18.112 诊断：今日合并为什么没走，一行看清（rebuilt 为空 / 门槛不够 / 已合并过）
        if (!this._hsTodayDiagDone) {
          this._hsTodayDiagDone = true;
          postLog(
            'RingBle',
            `[rebuildHistoricalStatus] 今日合并判定：statusTimeline=${statusTimeline.length}(真实 ${existingReal}) ` +
              `rebuilt=${rebuilt0?.length ?? 0}(真实 ${rebuiltReal}) seed=${seedVal} willMerge=` +
              `${(rebuilt0?.length ?? 0) > 0 && (statusTimeline.length < 12 || rebuiltReal > existingReal)}`,
          );
        }
        if (rebuilt0 && rebuilt0.length > 0 && (statusTimeline.length < 12 || rebuiltReal > existingReal)) {
          const rebuilt = rebuilt0;
          if (rebuilt && rebuilt.length > 0) {
            // 用新重建的点补到现有时间线后面（或替换为空的时间线），不要直接丢弃已有的实时点；
            // ★ v18.110：窗口已有「空窗占位点(fill:true)」而现在有了真实数据 → 用真实点覆盖它。
            const existingByT = new Map(statusTimeline.map((p) => [p.t, p]));
            for (const p of rebuilt) {
              const ex = existingByT.get(p.t);
              if (!ex || (ex.fill === true && p.fill === false)) existingByT.set(p.t, p);
            }
            const merged = Array.from(existingByT.values()).sort((a, b) => a.t - b.t);
            statusTimeline = merged;
            changed = true;
            // ★ v18.110 诊断：回填点里到底有多少是「窗口内有真实采样」的（fill:false）——
            //   首页趋势图只画 fill:false 的点，这个数直接决定曲线画不画得出来。
            const mergedReal = merged.filter((p) => p.fill === false).length;
            postLog('RingBle', `[rebuildHistoricalStatus] ✅ 合并今日 statusTimeline（回填 ${rebuilt.length} 点，合并后 ${merged.length} 点，其中真实采样点 ${mergedReal}）`);
          }
        }
      }
    }
    if (changed) {
      this.state = { ...this.state, statusDaily, statusTimelineByDay, statusTimeline, statusHistory };
      // 基线库灌入诊断已在上方「前置」段打过（更详细：天数 + 相位分布），此处不再重复。
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

    // 4. 睡眠时段（绝对起止 ms）
    //    ★ 修复三处错（原实现：`new Date(y, m-1, d-1 < 1 ? 0 : m-1, 23, 0)`）：
    //      ① `d>=2` 时第三参数被写成 `m-1`（月份）而非 `d-1` —— 2026-09-18 会算成 9月8日；
    //      ② 入睡硬编码 23:00，无视真实 sleepTime/wakeTime（该字段确实存在，backfill 会写）；
    //      ③ 无跨天/跨月/跨年处理。
    //    现在：优先用真实入睡/起床时刻解析绝对起止 ms（跨天则 end 落次日，用 Date 运算进位）；
    //    只有缺失时刻时才用 total 反推；两者都没有才回落到 23:00 + total。
    let sleepStart: number | null = null;
    let sleepEnd: number | null = null;
    if (sleep && sleep.total > 0) {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const bedMs = clockOrDateToMs(sleep.sleepTime, midnight);
      const wakeMs = clockOrDateToMs(sleep.wakeTime, midnight);
      if (bedMs != null && wakeMs != null) {
        sleepStart = bedMs;
        sleepEnd = wakeMs > bedMs ? wakeMs : wakeMs + DAY_MS; // 起床不晚于入睡 = 跨天 → 落次日
      } else if (bedMs != null) {
        sleepStart = bedMs;
        sleepEnd = bedMs + sleep.total * 60 * 1000;
      } else if (wakeMs != null) {
        sleepEnd = wakeMs;
        sleepStart = wakeMs - sleep.total * 60 * 1000;
      } else {
        // 兜底：两侧时刻都缺失（极旧数据）→ 沿用「23:00 入睡 + 总时长」估算
        sleepStart = midnight + 23 * 60 * 60 * 1000;
        sleepEnd = sleepStart + sleep.total * 60 * 1000;
      }
    }

    // 5. 逐窗口生成 WindowSignals → accumulateWindow
    const points: CurvePoint[] = [];
    // ★ v18.155（用户 2026-10-05）：修掉「seed 时序倒置」。
    //   旧实现 `let prev = seedValue`：seed 是**晨间恢复度**（醒来那一刻才该出现的值），
    //   却被放在 00:00 当曲线起点，睡眠段再从它往上充 ⇒ 用睡眠的「结果」当睡眠「开始」时的状态，
    //   同一晚的恢复被计两次，图上 0 点直接印着起床后的数字。
    //   现在：00:00 = 睡前水位（SLEEP_ENTRY_LEVEL），睡眠段渐进到 seed，
    //   seed 落在它该在的位置（起床时刻），曲线在 wakeTime 处自然连续。
    const hasSleepSeg = sleepStart != null && sleepEnd != null && sleepEnd > midnight;
    let prev = hasSleepSeg
      ? Math.min(CURVE_DEFAULTS.SLEEP_ENTRY_LEVEL, seedValue)
      : seedValue;
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
      const winMet = metArr.filter((p) => p.t >= winStart && p.t < winEnd);
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

      // ★ v18.155：睡眠段收敛目标 = 当日 seed（见上方 prev 头注）；非睡眠窗传 null，不参与。
      const sig = { hrMean, stepsDelta, edaEvents, hrv, asleep, isNap, sleepTarget: asleep ? seedValue : null };

      // 5f. accumulateWindow → next value
      let next: number;
      if (i === 0) {
        // 00:00 = 睡前水位（hasSleepSeg 时）/ seed（无睡眠段时）
        next = prev;
      } else if (hasSleepSeg && sleepStart != null && winStart < sleepStart) {
        // ★ v18.155：入睡前的窗口**冻结在睡前水位**，不推进。
        //   否则深夜静息会被 isRecovering 判成恢复 → 曲线先升（45→49）再被睡眠段拉回 seed，
        //   出现「睡前反而在涨」的假回升，与「入睡前是一天最低点」的直觉相反。
        next = prev;
      } else {
        // 简化版：不用真实 spotBattery（需要 sleepTime/wakeTime），直接走 accumulateWindow
        const res = accumulateWindow(prev, sig, baseline, CURVE_DEFAULTS);
        next = Number.isFinite(res.next) ? res.next : prev;
      }

      // ★ v18.110：fill 不再「一刀切全 true」，改为**按窗口是否真有 healthStore 采样**判定：
      //   · 窗口内有 hr/steps/met/eda/hrv 任意真实样本 → fill:false = 这条值有数据支撑，趋势图要画；
      //   · 窗口内一个样本都没有（纯 seed 递推）→ fill:true = 空窗占位，趋势图不画（断流期就不该出现水平线）。
      //   这样「断流即空」与「有新回填数据就补上曲线」两套口径可以共存：
      //   戒指离线时窗口没数据=空，重新戴上后回填进来=画出来（用户 v18.110 口径）。
      //
      // ★ v18.122 **回退 v18.120 的 connectedSince 判据**（v18.120 引入了新 bug，已撤销）。
      //   v18.120 的错法：用「本次连接起点 connectedSince」当界，只数 t >= CONN 的样本。
      //   问题：**每次 App 重启都会重新记一个连接起点**，
      //   于是「3 点断开 → 4 点打开 App 自动连上」时，0:00~3:00 那段**真实佩戴数据**会被
      //   误判成「断开前的旧数据」而整段排除 —— 违背用户口径
      //   「3 点断开就一直看到 3 点的数据，重新连上才补齐」，且导致曲线中间莫名断开。
      //
      //   ★ 正确判据（v18.110 起就是对的）：**只看「该 30min 窗口内有没有真实采样」**。
      //     · 窗口内有真实样本 → fill:false = 有数据支撑，画（无论断开前采的还是回填的）；
      //       断开前的数据本来就是真实佩戴期间采的，必须画。
      //     · 窗口内一个样本都没有 → fill:true = 该时段确实没戴/没连，留白。
      //   「3 点断开」这个场景天然正确：3 点之后的窗口没有任何采样 → 自然留白；
      //   0~3 点是你真戴着的 → 窗口内有采样 → 正常画。**不需要任何连接时刻判据。**
      //   实锤：本会话 App 启动 7 次、每次自动连上并回填，34 个点全 `fill:false` 真实点
      //   —— 数据是真的，不是伪造的水平线。
      const winReal = winHr.length + winSteps.length + winMet.length + winEda.length + hrvArrWin.length;
      points.push({
        t: winStart,
        value: clampN(next, 0, 100),
        level: curveLevel(clampN(next, 0, 100), CURVE_DEFAULTS).level,
        fill: winReal === 0,
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

  /**
   * healthStore 写入后延迟落盘（debounce 5s）。回填出的合成皮质醇/eda 等
   * 借此在重载前落盘，避免「重载即丢历史」；同时让实时流的 intraday 也能定期持久化。
   */
  private scheduleHealthStorePersist(): void {
    if (this.healthStorePersistTimer != null) return;
    this.healthStorePersistTimer = setTimeout(() => {
      this.healthStorePersistTimer = null;
      void this.saveSnapshot();
    }, 5000);
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
        sleepStagesDaily: this.state.sleepStagesDaily,
        // ★ 2026-11-06 审查（docs/audit/02 🔴#3）：合成日标记必须一起持久化，
        //   否则重启后 UI 会把示意图当成实测曲线展示。
        sleepStagesSynthesizedDays: this.state.sleepStagesSynthesizedDays,
        sleepSummary: this.state.sleepSummary,
        // ★ 必须一起持久化（此前漏了）：sleepSummaryDate 是「sleepSummary 属于哪一天」的唯一凭据，
        //   漏存 → 重启后恒为 null → 历史日详情页会把「今天」的分期段错画到历史日上。
        sleepSummaryDate: this.state.sleepSummaryDate,
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
        // ★ v18.133 补：运动段必须落盘。
        //   理由：`lib/motionGate` 的**恢复期**要跨时段判（今天早上 6:30 跑步，
        //   6:45 那一槽仍处恢复期），而固件运动段只在 App 连接时读一次；
        //   不落盘 ⇒ 冷启动后 gate 是空的，恢复期逻辑对「今天早些时候的运动」完全失效。
        //   同时它是 TodayScreen/ToolTopicScreen 运动卡的数据源，重启不该丢。
        sportSessions: this.state.sportSessions,
        syncEnabled: this.syncEnabled,
        userProfile: this.userProfile,
      };
      await FileSystem.writeAsStringAsync(path, JSON.stringify(snap));
      // ★ 单一数据源 healthStore 一并落盘（v2）。与 legacy 快照并存，重启优先恢复 healthStore。
      const hsPath = this.healthStorePath();
      if (hsPath) {
        try {
          // ★ v18.111 诊断：落盘前统计 healthStore 实际有多少 intraday 点。
          //   实锤过「mira_health_store_v2.json 写出来 stores 全空」——legacy 有今天数据、
          //   healthStore 却空，导致重启后 intraday 重建拿不到任何窗口、趋势图画不出来。
          if (this._hsPersistDiagCount < 3) {
            this._hsPersistDiagCount++;
            const probe = (['hr', 'hrv', 'met', 'eda', 'steps'] as const).map(
              (k) => `${k}=${healthStore.getIntraday(k, this.bucketDay).length}`,
            );
            postLog('RingBle', `[saveSnapshot] healthStore 今日 intraday: ${probe.join(' ')}`);
          }
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
  /**
   * v18.111：把 legacy 快照 buckets（今日 15min 槽）里的真实采样补进 healthStore.intraday。
   *
   * 为什么必须有这一步（用户实锤链）：
   *   ① backfill/实时流的数据**只**落在 RingState.dayBuckets（+ 落进 legacy 快照），
   *      healthStore.intraday 靠 upsertRealtime/upsertBackfillSamples 写，但重启恢复路径
   *      从不把 buckets 回灌进去 → 实测真机 `mira_health_store_v2.json` 写出来 stores 全空。
   *   ② 而 `rebuildDayTimelineFromHealthStore`（全天状态趋势图的数据源）与
   *      `collectSamples`（皮质醇昼夜节律的数据源）**只读 healthStore**。
   *   → 重启后两者都拿不到样本：曲线重建 `totalPts===0` 直接 return []，皮质醇空态。
   *
   * 口径：槽值取该槽 `last`（最后一次真实读数，语义上最接近「实测值」），
   * 时刻取槽起点（`dayStart + slot*SLOT_MS`）而非中点 —— 曲线按 :00/:15/:30/:45 对齐更好读。
   * 只补不覆盖：healthStore 已有同刻样本则跳过。
   */
  private hydrateHealthStoreFromBuckets(snap: any): void {
    const buckets = snap?.buckets;
    const dayStart = typeof snap?.dayStart === 'number' ? snap.dayStart : null;
    if (!buckets || dayStart == null) return;
    const dk = dayKeyOf(dayStart);
    const core = (buckets as any).core || buckets;
    const ext = (buckets as any).ext || {};
    let added = 0;
    const put = (signalKey: string, m: Record<string, any>) => {
      const hk = hsKeyFor(signalKey);
      if (!hk) return;
      for (const rawSlot of Object.keys(m || {})) {
        const slot = Number(rawSlot);
        if (!Number.isFinite(slot) || slot < 0) continue;
        const e = m[rawSlot];
        const v = Number(e?.last);
        if (!Number.isFinite(v) || v <= 0) continue;
        const t = dayStart + slot * SLOT_MS;
        if (t > Date.now()) continue; // 未来槽位不补
        if (healthStore.getIntraday(hk, dk).some((p) => Math.abs(p.t - t) < SLOT_MS / 2)) continue;
        healthStore.upsertRealtime(hk, { t, v }, t);
        added++;
      }
    };
    for (const k of CORE_KEYS) put(k, core?.[k] || {});
    for (const k of Object.keys(ext)) put(k, ext[k]);
    if (added > 0) {
      postLog('RingBle', `[buckets→healthStore] 已补入今日 intraday 样本 ${added} 条（dayKey=${dk}）`);
      // 补完必须触发一次重建：否则曲线/皮质醇还停留在补齐前的空态
      try {
        this.rebuildHistoricalStatus();
      } catch (e) {
        postLog('RingBle', `[buckets→healthStore] ⚠️ 触发重建失败（已忽略）: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /**
   * v18.112：App 启动后自动连上**上次那台戒指**，让离线回填与派生重算自己跑起来。
   *
   * 背景（用户口述的产品逻辑）：没戴戒指 → 当天没数据；戴了但没连 App → 数据存在戒指里，
   * 下次连上要能「回填回来」，然后由 App 重算全天状态趋势与皮质醇昼夜节律。
   * 改之前只有设置页手动点会连，导致重启后这条链彻底断掉。
   *
   * 做法：
   *  1. 没有上次设备（deviceId 从未持久化过）→ 不扫，避免无意义耗电；
   *  2. 扫描 → 候选里优先按 deviceId 精确匹配，匹配不到再按设备名兜底（原生按名字识别）；
   *  3. 匹配到就 connectToId，交给既有 `ready → backfillSince → backfillDone → requestFlush` 链路；
   *  4. 3s 内没扫到就静默放弃（用户可去设置页手动连），不弹任何东西。
   */
  private autoConnectOnLaunch(): void {
    if (!this.useNative) return;
    const lastId = this.state.deviceId;
    const lastName = this.state.deviceName;
    if (!lastId && !lastName) {
      postLog('RingBle', '[autoConnect] 跳过：没有上次设备记录（首次使用请在设置页连接）');
      return;
    }
    postLog('RingBle', `[autoConnect] 启动自动连接 lastId=${lastId ?? '-'} name=${lastName ?? '-'}`);
    const un = this.onState((s) => {
      const list = s.devices ?? [];
      if (Array.isArray(list) && list.length > 0) {
        const byId = lastId ? list.find((d: any) => String(d?.id ?? d?.deviceId ?? '') === String(lastId)) : null;
        const byName = lastName
          ? list.find((d: any) => String(d?.name ?? d?.deviceName ?? '') === String(lastName))
          : null;
        const hit = byId ?? byName ?? null;
        un();
        if (hit) {
          const id = String(hit?.id ?? '');
          if (id) {
            postLog('RingBle', `[autoConnect] ✅ 命中上次设备 → 连接 ${hit?.name ?? id}`);
            void this.connectToId(id);
          }
        } else {
          postLog('RingBle', '[autoConnect] 扫到的设备里没有上次那台，放弃（可在设置页手动连）');
        }
      }
    });
    setTimeout(() => {
      un();
      postLog('RingBle', '[autoConnect] 3s 内未命中，结束');
    }, 3000);
    void this.startScan();
  }

  /**
   * v18.112 公开封装：设置页聚焦 / App 启动都调它。已连 / 在连 / 在扫则跳过，避免重复发起扫描。
   * 行为同 autoConnectOnLaunch（扫到上次那台设备就 connectToId）。
   */
  autoConnect(): void {
    const st = this.getState();
    if (st.status === 'connected' || st.status === 'connecting' || st.status === 'scanning') return;
    this.autoConnectOnLaunch();
  }

  /**
   * v18.115：用**某一天回填回来的真实数据**构造一条基线库记录（DailyRecord）。
   *
   * 为什么必须有（用户实锤「历史回填肯定要放，未进基线库呢」）：
   *   `BaselineStore.baselineFor()` 的三级回落是「同相位个人 → 全局个人 → 文献群体」，
   *   门槛 `MIN_PHASE_SAMPLES=8` + `MIN_DAYS=30`。但 `statusHistory` 原来只有实时佩戴累积那条路会写，
   *   离线回填日一条不进 → 永远命中不了第 1/2 级，一直用文献值（HRV 50 / RHR 59 / 睡眠 74）。
   *   同时 `cycle.phase` 也从 `statusHistory[i].phase` 读，历史日不回填 → 相位恒 unknown，
   *   也就是「生理周期校正」在代码里写了、实际从未生效。
   *
   * 口径（都取该日真实值，取不到就 null 让基线库忽略该字段，绝不用邻近日/默认值填充）：
   *   hrv       → healthStore 该日 intraday HRV 的**晨间代表值**（近 12 点中位数，最贴晨间基线语义）
   *   rhr       → 该日 intraday HR 的**夜间最低 10% 分位**（RHR 近似，awake 期间会偏高）
   *   sleep*    → sleepDaily 该日归档（total/deep/rem/getUp）
   *   phase     → `computeCycle(log, 该日日期)`，**按那天推算**，不是复用今天的相位
   *   fever     → 暂 false（协议无体温阈值判定）；TODO 未来用 skin temp 阈值补
   */
  private buildBackfillBaselineRecord(
    dk: string,
    hrvDaily: number | null,
    sleep: { total?: number | null; deep?: number | null; rem?: number | null; getUp?: number | null } | undefined,
  ): DailyRecord | null {
    // 该日日期对象（dayKey 是 'YYYY-MM-DD'，本地时区解析）
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dk);
    if (!m) return null;
    const dayDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);

    // ① HRV：优先用 intraday 的晨间代表值（近 12 点中位数），退回日均值
    let hrv: number | null = null;
    try {
      const arr = healthStore
        .getIntraday('hrv', dk)
        .filter((p) => Number.isFinite(p.v) && p.v >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN && p.v <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX)
        .map((p) => ({ t: p.t, v: p.v }))
        .sort((a, b) => a.t - b.t);
      if (arr.length > 0) {
        const from = new Date(dayDate.getTime() - 12 * 3600000).getTime();
        const morning = arr.filter((p) => p.t >= from);
        const pick = morning.length > 0 ? morning : arr;
        const vs = pick.map((p) => p.v).sort((a, b) => a - b);
        hrv = vs.length % 2 === 1 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
      }
    } catch {
      /* 取不到就退回 hrvDaily */
    }
    if (hrv == null) hrv = hrvDaily;

    // ② RHR：夜间最低 10% 分位
    let rhr: number | null = null;
    try {
      const hrArr = healthStore.getIntraday('hr', dk).filter((p) => Number.isFinite(p.v) && p.v > 0).map((p) => p.v).sort((a, b) => a - b);
      if (hrArr.length >= 10) {
        const idx = Math.min(hrArr.length - 1, Math.floor(hrArr.length * 0.1));
        rhr = hrArr[idx];
      } else if (hrArr.length > 0) {
        rhr = hrArr[0];
      }
    } catch {
      /* 无 HR 则 rhr 保持 null */
    }

    // ③ 相位：按该日日期推算（不能复用今天的相位 —— 否则历史日全被标成今天所处的阶段）
    let phase: DailyRecord['phase'] = 'unknown';
    try {
      const cyc = computeCycle(this.localCycle, dayDate);
      if (cyc.phase && cyc.phase !== 'unknown') phase = cyc.phase as DailyRecord['phase'];
    } catch {
      /* 无经期记录 → unknown，基线库会落到全局个人级 */
    }

    // 全为空 → 这天没有可用基线料，不写（避免污染基线中位数）
    if (hrv == null && rhr == null && !(sleep && (sleep.total ?? 0) > 0)) return null;

    // ④ 体温：当日日均皮肤温（tempDaily），作为复合分第四路输入（Oura 同口径压力信号）
    const tempVal = (this.state.tempDaily as any)?.[dk] ?? null;

    return {
      date: dk,
      hrv,
      rhr,
      sleepTotal: sleep?.total != null && sleep.total > 0 ? sleep.total : null,
      sleepDeep: sleep?.deep ?? null,
      sleepRem: sleep?.rem ?? null,
      getUp: sleep?.getUp ?? null,
      temp: typeof tempVal === 'number' && Number.isFinite(tempVal) ? tempVal : null,
      fever: false,
      phase,
    } as DailyRecord;
  }

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
            // ★ 补齐睡眠：v2 快照的 sleep 可能为空，而 legacy 快照的 sleepDaily 一直有数据；
            //   走 v2 分支就不会再执行 v1 迁移，若不补，重启后「睡眠恢复摘要」会空白。
            const v2SleepDays = json.sleep && typeof json.sleep === 'object' ? Object.keys(json.sleep).length : 0;
            const added = healthStore.hydrateSleepFromLegacy(legacySnap?.sleepDaily);
            postLog(
              'RingBle',
              `[healthStore] 已从 v2 快照恢复（v2.sleep=${v2SleepDays} 天，legacy 睡眠补齐 ${added} 天）`
            );
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

  /**
   * 睡眠评分是**派生值**（由冻结的原始 total/deep/getUp 算出）。快照里存的是旧公式的结果，
   * 若原样恢复，改了公式也"看不出变化"（实测：老快照里的 100 一直沿用）。
   * 载入时统一按当前公式重算；原始测量字段原样保留（不违反"冻结测量"原则）。
   */
  private rescoreSleep(s: any): any {
    if (!s) return s;
    const total = Number(s.total) || 0;
    if (total <= 0) return s;
    const awake = (Number(s.awake) || 0) + (Number(s.insomnia) || 0);
    return {
      ...s,
      score: computeSleepScore(
        {
          sleepTotal: total,
          sleepDeep: Number(s.deep) || 0,
          sleepAwake: awake > 0 ? awake : undefined,
          getUp: Number(s.getUp) || 0,
        },
        ALGO_DEFAULTS
      ),
    };
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
      if (snap.sleepStagesDaily) patch.sleepStagesDaily = snap.sleepStagesDaily;
      if (snap.sleepStagesSynthesizedDays) patch.sleepStagesSynthesizedDays = snap.sleepStagesSynthesizedDays;
      if (snap.sleepSummary) patch.sleepSummary = this.rescoreSleep(snap.sleepSummary);
      if (snap.sleepTime) patch.sleepTime = snap.sleepTime;
      if (snap.wakeTime) patch.wakeTime = snap.wakeTime;
      // ★ 顶层 sleepTime/wakeTime 回正：以「当日 sleepSummary」为唯一真值源回同步，
      //   清掉历史遗留的陈旧值（实测 sleepSummary="2026-09-18 01:38" 而顶层仍是
      //   09-16 的 "00:41"），否则重启后卡片与分期图时间轴继续用错时刻。
      if (patch.sleepSummary) {
        const sst = fmtSleepClock(patch.sleepSummary.sleepTime);
        const swt = fmtSleepClock(patch.sleepSummary.wakeTime);
        if (sst) patch.sleepTime = sst;
        if (swt) patch.wakeTime = swt;
      }
      // ★ sleepSummaryDate：恢复 + **自愈**。
      //   老快照根本没这个字段（真机 mira_ring_state_v1.json 实测为 undefined），若只写
      //   `if (snap.sleepSummaryDate)` 恢复，则它恒为 null → InsightScreen「当日 sleepSummary」
      //   分支（日期吻合）恒失效、SleepDetailScreen 的 isLatest 恒为真（历史日会错用今天的分期段）、
      //   recomputeDailyStatus 的今日种子判断同样失真。故快照无值时自 sleepSummary 自身推导。
      const summaryDate = snap.sleepSummaryDate
        ?? sleepSummaryDateOf(patch.sleepSummary, snap.sleepDaily);
      if (summaryDate) patch.sleepSummaryDate = summaryDate;
      // ★ 顶层分期段「归位 / 分离」（与上面同一类「陈旧便捷字段」问题的收口）。
      //   顶层 sleepStages 同样是「最新一次」，可能与 sleepSummary 属于**不同**的一晚：
      //   真机快照实测它是 09-16 的曲线（跨度 540 / 深睡 180 / 浅睡 231，与
      //   sleepDaily['2026-09-16'] 完全吻合），而 sleepSummary 已是 09-18（521 / 130 / 282）。
      //   若原样保留，洞察页与睡眠详情页会把 09-16 的曲线画在 09-18 的标题下
      //   （横轴长度已被 totalMinutes 校正，但画的是错的一晚 —— QA 二轮阻断点）。
      //   处理：能归位 → ① 归档到它真正的日期（历史日反而变得可查看），
      //                ② 顶层字段清空，不再冒充「今日/最新」曲线；
      //         归位不出（sleepSegmentsDateOf = null）→ 保持原样，不臆断、不清空用户可见的图。
      const segDate = sleepSegmentsDateOf(snap.sleepStages, snap.sleepDaily);
      if (segDate) {
        const prevDaily: Record<string, SleepSegment[]> = patch.sleepStagesDaily ?? snap.sleepStagesDaily ?? {};
        if (!prevDaily[segDate]) {
          patch.sleepStagesDaily = { ...prevDaily, [segDate]: snap.sleepStages as SleepSegment[] };
        }
        if (segDate !== (summaryDate ?? '')) patch.sleepStages = null;
      }
      if (snap.female) patch.female = snap.female;
      if (snap.tempDaily) patch.tempDaily = snap.tempDaily;
      if (snap.hrvDaily) patch.hrvDaily = snap.hrvDaily;
      if (snap.hrDaily) patch.hrDaily = snap.hrDaily;
      if (snap.seriesByDay) patch.seriesByDay = snap.seriesByDay;
      if (snap.deviceCapabilities) patch.deviceCapabilities = snap.deviceCapabilities;
      if (snap.spo2Daily) patch.spo2Daily = snap.spo2Daily;
      if (snap.edaDaily) patch.edaDaily = snap.edaDaily;
      if (snap.rrDaily) patch.rrDaily = snap.rrDaily;
      if (snap.sleepDaily) {
        // ★ 按当前公式重算每天评分（原始 total/deep/getUp 保留），否则快照里的旧分数会一直沿用
        const fixedDaily: Record<string, any> = {};
        for (const [k, v] of Object.entries(snap.sleepDaily as Record<string, any>)) {
          fixedDaily[k] = this.rescoreSleep(v);
        }
        patch.sleepDaily = fixedDaily;
      }
      if (snap.stepDaily) patch.stepDaily = snap.stepDaily;
      if (snap.lastSyncedAt) patch.lastSyncedAt = snap.lastSyncedAt;
      if (snap.extDaily) patch.extDaily = snap.extDaily;
      if (snap.ecg) patch.ecg = snap.ecg;
      if (snap.ecgDaily) patch.ecgDaily = snap.ecgDaily;
      if (snap.lastUploadedAt) patch.lastUploadedAt = snap.lastUploadedAt;
      if (snap.deviceId) patch.deviceId = snap.deviceId;
      // ★ v18.133 补：恢复运动段（与 saveSnapshot 新增字段配对）。
      //   冷启动后 motionGate 靠它判「今天早些时候的运动 + 恢复期」——
      //   固件运动段只在连接成功时读一次，不恢复就等于恢复期逻辑对当天已发生的运动失效。
      //   只接受数组（老快照是 undefined ⇒ 保持 null，等本次连接读回来）。
      if (Array.isArray(snap.sportSessions)) {
        patch.sportSessions = snap.sportSessions as RingSportSession[];
        postLog('RingBle', `[loadPersisted] ✅ 恢复运动段 ${patch.sportSessions.length} 段`);
      }
      if (snap.statusHistory) patch.statusHistory = snap.statusHistory;
      if (snap.dailyCurve) patch.dailyCurve = snap.dailyCurve;
      if (snap.curveStatus) patch.curveStatus = snap.curveStatus;
      if (snap.statusTimeline) {
        // ★ 启动时清洗旧脏数据：只保留 :00 / :30 边界的点，并按对齐边界 t 去重
        const raw = snap.statusTimeline as any[];
        patch.statusTimeline = this.dedupeBoundaryPoints(raw);
        // ★ v18.97：再按「今天」过滤一次。快照里存的是上次退出时的今日曲线，隔夜未佩戴再冷启动，
        //   那些点属于昨天 —— 直接灌进今日时间线会让首页圆环/趋势图继续显示昨天的状态分
        //   （用户实锤）。跨天过滤后由启动帧的 recomputeDailyStatus 决定今天是否重新出点。
        const t0 = Date.now();
        patch.statusTimeline = patch.statusTimeline.filter((p) => isSameDay(p.t, t0));
        // ★ v18.106：旧快照里「没有任何 fill 标记」的点 = 当年 healthStore 回填的补齐点
        //   （那条 seed 推出来的水平线）。统一标成 fill:true —— 首页趋势图只画 fill:false 的真实采样点，
        //   否则每次冷启动恢复旧快照，断流期的伪造曲线又会冒出来。
        patch.statusTimeline = patch.statusTimeline.map((p: any) => (p.fill === false ? p : { ...p, fill: true }));
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
      // ★ v18.111（用户实锤「戒指数据有更新，全天状态趋势图却还是没数据」的真凶）：
      //   legacy 快照 buckets（今日 30min 槽：hr/hrv/spo2/temp/eda + 扩展指标）**只**恢复进
      //   RingState.dayBuckets，从来不写 healthStore.intraday。而
      //   rebuildDayTimelineFromHealthStore / analyzeCortisol(collectSamples) 全都只读 healthStore
      //   → 重启后 healthStore 是空的（实测 mira_health_store_v2.json 写出来 stores 全空），
      //   于是：① 曲线重建 totalPts===0 直接 return []；② 皮质醇无样本 → 昼夜节律空态。
      //   这里把 buckets 里的真实采样按槽中心时刻补进 healthStore（只补缺失，不覆盖已有）。
      try {
        this.hydrateHealthStoreFromBuckets(snap);
      } catch (e) {
        postLog('RingBle', `[loadPersisted] ⚠️ buckets→healthStore 补齐失败（已忽略）: ${e instanceof Error ? e.message : e}`);
      }
      // 独立同步开关优先于健康数据快照中的旧副本；若开关文件尚未加载，
      // loadSyncFlag 的 finally 会在完成后再次写回正确值。
      // ★ 强制 syncEnabled=true：历史快照可能存了 false 导致离线回填永远跳过
      this.syncEnabled = true;
      healthStore.syncEnabled = this.syncEnabled;
      this.native.setSyncEnabled(this.syncEnabled);
      // reconcile：把恢复的「当日」时间槽反推回各自 *Daily（即使戒指尚未重连，最后活跃日也不丢）
      this.syncDailyFromBuckets();
      // ★ 启动即回填派生指标历史（cortisol/eda/sns/emotion/skin/fatigue）：
      //   用已恢复的 stress 重算历史 intraday。修复「Metro 重载/重启后历史皮质醇丢失」——
      //   重载后无「App 回前台」事件、30min 周期回填计时器也重置、且首屏未必是详情页，
      //   先前只在详情页挂载时才跑回填，导致重载后历史为空。此处保证每次冷启动都补齐。
      try {
        const filled = estimateOfflineMetricsRecent(30);
        if (filled > 0) {
          postLog('RingBle', `[BOOT_BACKFILL] 启动回填派生指标历史：${filled} 天`);
        }
      } catch (e) {
        postLog('RingBle', `[BOOT_BACKFILL] 失败（忽略）: ${e instanceof Error ? e.message : e}`);
      }
      // ★ 订阅 healthStore：任何写入（实时流 / 回填 / 手动）后 5s 内自动落盘，
      //   保证回填出的合成皮质醇/eda 等不因子弹重载前未存盘而丢失。一次性订阅。
      if (!this.healthStorePersistSubscribed) {
        this.healthStorePersistSubscribed = true;
        healthStore.subscribe(() => this.scheduleHealthStorePersist());
      }
      // 启动回填出的历史立即落盘：否则紧接着再重载仍靠重算（虽自愈，但不如直接冻结）。
      void this.saveSnapshot();
      // ★ v18.97 跨天清零的启动帧（用户实锤：「首页圆环还展示恢复程度，趋势图还展示没连戒指的指标」）：
      //   快照恢复会把 curveStatus / statusTimeline 原样灌回state，但此路径**从不调用**
      //   recomputeDailyStatus → 隔夜未佩戴、早上冷启动时，首页圆环与全天趋势图读到的仍是
      //   快照里「昨天」的 curveStatus 与时间线（今天没有任何输入，recompute 也不会给出数）。
      //   这里在恢复完成后立刻驱动一次：ensureDay 跨天清零「最新值」结构 + 归档裁剪昨日曲线
      //   + buildCurveStatus 重算（今天无输入 → 诚实空态）。之后正常打点/连接会继续更新。
      try {
        this.scheduleRecomputeDailyStatus(Date.now(), true);
      } catch (e) {
        postLog('RingBle', `[loadPersisted] ⚠️ 启动跨天重算失败（已忽略）: ${e instanceof Error ? e.message : e}`);
      }
      postLog('RingBle', '已从本地持久化恢复真实数据（跨 ⌘R 保留趋势曲线）');
      // ★ v18.112 启动自动连接（用户口述的真实产品逻辑第二段：「有佩戴的时候戴上以后它就会拉取
      //   历史的数据」）。改之前 App 重启后**从不连戒指** —— 只有设置页手动点才调 startScan，
      //   于是：① 戒指里存着的离线数据永远拉不回来；② `[State] ready`（回填唯一触发点）不来；
      //   ③ 全天状态趋势图 / 皮质醇昼夜节律自然也算不出离线那段时间。
      //   实锤：近 3 次重启日志里 `[State] ready` 0 次，而原生曾报
      //   `BACKFILL-API 2026-10-03 original=166 HR=141 hrv=141 temp=29`（今天确实有 141 条 HR 躺在戒指里）。
      //   这里在恢复完成后自动发起扫描 + 连上**上次那台设备**（deviceId 已随快照持久化）。
      try {
        this.autoConnectOnLaunch();
      } catch (e) {
        postLog('RingBle', `[autoConnect] ⚠️ 启动自动连接失败（已忽略）: ${e instanceof Error ? e.message : e}`);
      }
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
      sleepStagesSynthesizedDays: {},
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

  /** ★ 2026-10-16：ECG 测量超时/卡死兜底中止——原生无回包时 UI 会永久停在「测量中 99%」。
   *  先让原生停测，再清掉卡在测量中的进度，让 UI 回到空闲态。 */
  abortEcg() {
    if (this.useNative) this.native.stopEcg();
    this.native?.resetEcgLive?.();
    this.applyPatch({ ecgProgress: null, ecgLiveWaveform: null, ecgError: '测量超时：未在预期时间内完成，已自动结束。请确认戒指电极与手指接触良好，或稍后重试。', ecgHint: null });
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
      this.scheduleRecomputeDailyStatus();
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
    // ★ 2026-11-05（用户：两套数据源不要混）：上传目标必须是当前连接的真实戒指 MAC。
    //   旧的 `st.deviceName || getLocalDeviceId()` 会把设备名 / 本地随机 id 当成 device_id，
    //   同一批本地历史归档因此被写到多个 device_id（D1 里 41:42… 与 C9:00… 的 11-02/11-03
    //   数据逐字段完全相同，根因就在这里）。这里禁止设备名兜底，并拒绝向旧 HK18 设备上传。
    if (st.deviceId && isBlockedRingDeviceId(st.deviceId)) {
      return { ok: false, count: 0, error: '当前连接的是旧设备，已阻止上传（两套戒指数据不混）' };
    }
    const deviceId = st.deviceId || await trustedCurrentRingDeviceId();
    if (!deviceId) {
      return { ok: false, count: 0, error: '未识别到当前戒指，已阻止上传' };
    }
    // ★ 2026-11-04（用户：固件号标注）：固件未同步时不再误标 'HK18' → 'unknown'；
    //   顶层新增 model（机型，按广播名识别），后端一个账户可挂多固件/多机型，按此区分数据呈现。
    const firmware = st.firmware || 'unknown';
    // ★ 2026-11-04（用户定稿）：上传型号标注以 DIS(0x2A24) 读到的型号为准（不靠广播名）。
    //   读不到型号时回退到设备名，再不行 'unknown'；不再误标 'HK18'。
    // ★ 2026-11-05（用户：按真机收敛）：上传机型标注以「连接时真机识别出的 Profile」为准
    //   （能力字段 / MAC / 广播名三层识别，安全默认 BASE_UI），不再用空 modelNumber 重解析落回全功能。
    const { modelNumber } = await getStoredDeviceInfo();
    const resolvedByStored = resolveProfileByModel(modelNumber) ?? (st.deviceName ? resolveProfileByModel(st.deviceName) : null);
    const profileId = (await getDeviceProfileId()) ?? resolvedByStored ?? DEFAULT_DEVICE_PROFILE;
    const model = getProfile(profileId).label;
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
      const rr = st.rrDaily[dk];
      const status = st.statusDaily[dk];
      const extFields = ringUploadExtFields(st.extDaily[dk]);
      const hasAuto =
        !!step || !!sleep || hr != null || spo2 != null || saneBodyTemp(temp) != null || rr != null || status != null || Object.keys(extFields).length > 0;
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
        // 体温：只上传当前戒指的合法日均体温，挡住旧设备遗留的 39℃ 等脏值
        const safeTemp = saneBodyTemp(temp);
        if (safeTemp != null) payload.temp_daily_mean = safeTemp;
        // ❌ 不再上传 eda_daily_mean：协议无 EDA，旧字段实为皮肤含水量（且 11-05 无新回读）
        if (rr != null) payload.rr_daily_mean = rr;
        if (status != null) payload.status_score = status;
        // 健康一览硬指标 + 光电血压 + ECG 平均心率（均来自 extDaily 归档）
        Object.assign(payload, extFields);
        records.push({ channel: 'auto_data', ts, payload });
      }
      const hv = st.hrvDaily[dk];
      if (hv != null) {
        const { ts, date } = norm(dk);
        records.push({ channel: 'hrv_history', ts, payload: { date, hrv_value: hv } });
      }
      // ★ 云端也要有「压力」这一维：gsr 通道（皮电 SNS 日均）。
      //   之前 App 从不上传 gsr → 云端恢复分永远缺 stress 分量、data_complete 恒为 false，
      //   运营后台的「压力/身心」列也一直是空的。
      //   ⚠ **诚实口径**：历史日的 sns 可能是**推算**值（由 stress 线性换算，见
      //   healthStore.isDerivedDay）——上传必须标 source='derived'，后端才知道
      //   不能拿它当实测建个人基线、也不能当成真压力去算恢复分。
      try {
        const snsDay = healthStore.getDay('sns', dk);
        if (snsDay && typeof snsDay.mean === 'number' && Number.isFinite(snsDay.mean)) {
          const { ts, date } = norm(dk);
          const derived = healthStore.isDerivedDay('sns', dk);
          records.push({
            channel: 'gsr',
            ts,
            payload: {
              date,
              sns: Math.round(snsDay.mean * 100) / 100,
              source: derived ? 'derived' : 'measured',
              samples: typeof snsDay.samples === 'number' ? snsDay.samples : 0,
            },
          });
        }
      } catch {
        /* 取不到皮电日均就不传这一条，不影响其它通道 */
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
      // ★ Phase 1：带设备令牌上传（没有就先向云端签一枚）。
      //   没有令牌时后端走开发态放行；签发成功后本机长期持有自己的令牌。
      const token = await ensureDeviceToken(deviceId);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(token) };
      const res = await fetch(`${BACKEND_BASE_URL}/v1/ring/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_id: deviceId,
          firmware,
          model,
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
      // ★ 走 applyPatch 通知订阅者（设置页「最近上传」需实时刷新），而非直接改 this.state
      this.applyPatch({ lastUploadedAt: uploadedAt });
      return { ok: true, count: j.received ?? records.length };
    } catch (e: any) {
      return { ok: false, count: 0, error: e?.message || '网络错误（请检查手机网络连接）' };
    }
  }
}

export const RingBle = new RingConnectionImpl();
export const ringAccent = theme.colors.accentSolid;
