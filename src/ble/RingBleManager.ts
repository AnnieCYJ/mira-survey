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
import { BACKEND_BASE_URL, RING_DATA_SOURCE } from '../config';
import {
  computeCycle,
  daysBetween,
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
  /** 今日状态历史日记录（相位专属基线用），跨天累积持久化 */
  statusHistory: DailyRecord[];
  /** 当日曲线上下文（晨间种子 + 日间基线 + 滑动状态）；跨天重置 */
  dailyCurve: DailyCurveSeed | null;
  /** 首页「今日状态」头条（曲线模型展示聚合） */
  curveStatus: CurveStatus | null;
  /** 今日状态曲线：每 30 分钟一个电量点（最多 48 点 = 24h），用于首页日内趋势 */
  statusTimeline: CurvePoint[];
  error: string | null;
  devices: RingDeviceInfo[];
  flashing: boolean;
  flashResult: string | null;
  protocol: string | null;
}

type StatePatch = Partial<RingState>;
type MetricEvent = { key: MetricKey; value: number; unit: string; ts: number };
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
//    无需用户在终端粘贴。与 Xcode scheme 注入的 RCT_PACKAGER_HOSTNAME（Mac 局域网 IP）一致。
const LOG_HOST = '192.168.1.5';
function postLog(tag: string, msg: string) {
  try {
    fetch(`http://${LOG_HOST}:8899/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, msg }),
    }).catch(() => {});
  } catch {
    /* 静默：日志转发失败绝不影响 App 运行 */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 原生桥数据源（VeepooRing）
// ─────────────────────────────────────────────────────────────────────────────

const VeepooNative = (NativeModules as any).VeepooRing;

class NativeRingSource {
  private emitter: NativeEventEmitter | null = null;
  private jsMetricCount = 0;
  private jsMetricKeys: Record<string, number> = {};

  constructor(
    private push: (patch: StatePatch) => void,
    private pushMetric: (m: MetricEvent) => void
  ) {
    if (VeepooNative) {
      this.emitter = new NativeEventEmitter(VeepooNative);
      this.emitter.addListener('onStateChange', this.handleState);
      this.emitter.addListener('onMetric', this.handleMetric);
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

  scan() { VeepooNative?.scan(); }
  stopScan() { VeepooNative?.stopScan(); }
  connect(id: string) { VeepooNative?.connect(id); }
  disconnect() { VeepooNative?.disconnect(); }
  setAutoMonitor(on: boolean) { VeepooNative?.setAutoMonitor(on); }
  measure(k: string) { VeepooNative?.measure(k); }
  flash() { VeepooNative?.findDevice(); }
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
    statusHistory: [],
    dailyCurve: null,
    curveStatus: null,
    statusTimeline: [],
    error: null,
    devices: [],
    flashing: false,
    flashResult: null,
    protocol: null,
  };
  private native: NativeRingSource;
  private backend: BackendRingSource;
  private useNative: boolean;
  private autoMonitor = false;
  private pendingMetrics: MetricEvent[] | null = null;
  private metricFlushQueued = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
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
      // 跨天：把「昨天」的体温日均归档进 tempDaily（仅当昨天确有数据），供周期双相曲线跨天累积
      const prev = this.bucketDay;
      if (prev && this.dayBuckets['temp'].size) {
        let sum = 0, c = 0;
        this.dayBuckets['temp'].forEach((e) => {
          sum += e.sum;
          c += e.count;
        });
        if (c > 0) {
          this.state = { ...this.state, tempDaily: { ...this.state.tempDaily, [prev]: sum / c } };
        }
      }
      this.bucketDay = k;
      this.dayStart = dayStartMs(ts);
      for (const key of Object.keys(this.dayBuckets) as MetricKey[]) this.dayBuckets[key].clear();
      for (const key of Object.keys(this.extBuckets)) this.extBuckets[key].clear();
    }
  }

  /** 增量写入一个样本到对应时间槽（高频采样自动按槽均值聚合） */
  private ingest(key: MetricKey, value: number, ts: number) {
    this.ensureDay(ts);
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
      (m) => this.applyMetric(m)
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
    // 读取用户在 App 内手动记录的经期（本地 cycleLog），相位计算据此兜底，避免"记了却显示未记录"
    void this.refreshLocalCycle();
    // 今日状态时间线：每 30 分钟落一个快照（即时钟驱动的「每半小时一个结果」）
    this.statusTimer = setInterval(() => this.recomputeDailyStatus(Date.now()), STATUS_SNAPSHOT_MS);
  }

  private emit() {
    this.scheduleSave();
    for (const fn of this.listeners) fn(this.state);
  }

  private applyPatch(patch: StatePatch) {
    this.state = { ...this.state, ...patch };
    // 连上戒指即自动开启原生「自动监测」（实时 HR/SpO₂ + 体温/皮电轮询 + HRV 历史读取），
    // 不再依赖用户在设置页手动拨开关——之前 autoMonitor 默认 false 且不持久化，
    // 重建/重连后原生 monitorOn 永远是 false，导致戒指一条数据都不传（collector.log 里 raw=0）。
    if (patch.status === 'connected' && this.useNative) {
      this.autoMonitor = true;
      this.native.setAutoMonitor(true);
    }
    // 经期数据变化 → 相位变化 → 重算今日状态（基线/叙事）。recompute 在 main 类上，
    // 故放此处（handleFemale 位于 NativeRingSource，拿不到 recompute）。
    if (patch.female !== undefined) this.recomputeDailyStatus();
    this.emit();
  }

  // ── HRV 取自设备历史库（原生 veepooSDK_readHrvDataWithDayNumber 周期读取并 emit），
  // 协议明确：实时心率通道只回 bpm、无 IBI/RR，无法在 App 端反算，故不再做 JS 反算。
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
      }
    }
    // 体温：把今日日均写入 tempDaily（跨天累积，供周期双相曲线）
    const tempDaily = { ...this.state.tempDaily };
    const todayTemp = this.deriveHistory('temp');
    if (todayTemp.length) {
      const avg = todayTemp.reduce((s, p) => s + p.v, 0) / todayTemp.length;
      tempDaily[this.bucketDay] = avg;
    }
    this.state = { ...this.state, metrics, availability, lastUpdated, daily, dailyHistory, history: this.deriveAllHistories(), tempDaily };
    this.emit();
    // 数据每次刷新后重算「今日状态」（晨间锚点 + 基线 + 归一化）
    this.recomputeDailyStatus();
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
    if (candidates.length === 0) return computeCycle(null, new Date());
    candidates.sort((a, b) => daysBetween(a.lastPeriodStart, b.lastPeriodStart));
    return computeCycle(candidates[candidates.length - 1], new Date());
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
  private recomputeDailyStatus(now: number = Date.now()) {
    const cycle = this.resolveCycle();
    const history = this.state.statusHistory;
    const dayKey = this.bucketDay;

    // —— 晨间种子 S0（每个自然日算一次，锁死）——
    let curve = this.state.dailyCurve;
    const needSeed = !curve || curve.dayKey !== dayKey;

    const hrvRaw = this.state.metrics.hrv;
    const hrv =
      hrvRaw != null && hrvRaw <= ALGO_DEFAULTS.HRV_ARTIFACT_MAX && hrvRaw >= ALGO_DEFAULTS.HRV_ARTIFACT_MIN
        ? hrvRaw
        : null;
    const rhr = this.deriveRHR();
    const ss = this.state.sleepSummary;
    const sleep: TodayInput['sleep'] = ss
      ? { sleepTotal: ss.total ?? null, sleepDeep: ss.deep ?? null, getUp: ss.getUp ?? null }
      : { sleepTotal: null, sleepDeep: null, getUp: null };
    const input: TodayInput = { hrv, rhr, sleep };

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
      const due = this.lastCurveAccumTs == null || now - this.lastCurveAccumTs >= STATUS_SNAPSHOT_MS;
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

    this.applyPatch({
      statusHistory: updatedHistory,
      dailyCurve: curve,
      statusTimeline: this.state.statusTimeline,
      curveStatus: this.buildCurveStatus(curve, cycle),
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
      seed,
      narrative,
      hasData: true,
    };
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
    if (this.state.curveStatus) return true;
    if (this.state.dailyCurve) return true;
    return false;
  }

  private snapshotPath(): string | null {
    if (!FileSystem.documentDirectory) return null;
    return FileSystem.documentDirectory + 'mira_ring_state_v1.json';
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
        statusHistory: this.state.statusHistory,
        dailyCurve: this.state.dailyCurve,
        curveStatus: this.state.curveStatus,
        statusTimeline: this.state.statusTimeline,
        metrics: this.state.metrics,
        availability: this.state.availability,
        lastUpdated: this.state.lastUpdated,
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
      if (snap.statusHistory) patch.statusHistory = snap.statusHistory;
      if (snap.dailyCurve) patch.dailyCurve = snap.dailyCurve;
      if (snap.curveStatus) patch.curveStatus = snap.curveStatus;
      if (snap.statusTimeline) patch.statusTimeline = snap.statusTimeline;
      if (snap.metrics) patch.metrics = snap.metrics;
      if (snap.availability) patch.availability = snap.availability;
      if (snap.lastUpdated) patch.lastUpdated = snap.lastUpdated;
      this.applyPatch(patch);
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
}

export const RingBle = new RingConnectionImpl();
export const ringAccent = theme.colors.accentSolid;
