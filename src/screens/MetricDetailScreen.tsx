/**
 * MetricDetailScreen —— 洞察页任意卡片点击进入的「指标历史详情」全屏页
 *
 * 设计约束（与全局 design token 一致）：
 *  - 顶部返回胶囊 + 指标名；大字当前值 + 较首点变化；日/周/月/年切换（复用 RangeSwitch）；
 *  - 真实数据趋势图（面积 + 渐变曲线 + 末端白点，与 BasicMetricCard / DimensionCard 同源）；
 *  - 平均/最高/最低统计；底部解读文案。
 *  - 数据来自 buildHistorySeries（真实戒指数据，缺口断线，不编造）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, Line } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { RingBle, type RingState, type EcgReading } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import { loadCycleLog } from '../data/cycleLog';
import { moodFromEmotionLevel, MOOD_COLOR } from '../data/emotionLog';
import { buildHistorySeries, type HistoryResult } from '../lib/realSeries';
import { healthStore, type MetricKey as HSMetricKey, type ManualMeasurement } from '../data/healthStore';
import { dateKeyOf } from '../lib/dateUtils';
import { isMonthTickDay, isYearTickMonth } from '../lib/chartAxis';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import AllDayBarsChart, { DayBarsLegend, type DayBarSegment } from '../components/charts/AllDayBarsChart';
import TempCircadianChart, { TempBaselineLegend } from '../components/charts/TempCircadianChart';
import { binByMinutes, bucketFilledCount, dayStartOf } from '../lib/timeBuckets';
import { buildTempBaseline, tempDeviationSeries, tempDeviationSummary } from '../lib/tempBaseline';

interface Params {
  key: string;
  name: string;
  unit: string;
  yMin: number;
  yMax: number;
  dimension?: string;
  color?: string;
}

const W = 680;
const H = 240;
const PAD_L = 14;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 28;
// Y 轴左侧留白（容纳刻度数字，HTML 渲染避免 SVG 横向拉伸变形）
const Y_GUT = 34;

// ★ 2026-10-08：相对 / 归一化指标（皮质醇活性 0~100、EDA、HRV、压力、疲劳、情绪、皮肤含水量）
//   这类指标数值是「相对个人基线的活性」，没有绝对量纲意义，详情页不展示左侧数值 Y 轴
//   （避免自动量程冒出 -7 之类无意义负刻度；曲线 / 参考线 / 统计 / tooltip 仍保留）。
const RELATIVE_AXIS_KEYS = new Set(['cortisol', 'eda', 'hrv', 'stress', 'fatigue', 'emotion', 'skin']);

const PHASE_BG: Record<string, string> = {
  period: 'rgba(224,123,107,0.16)',
  follicular: 'rgba(124,106,224,0.10)',
  ovulation: 'rgba(111,207,180,0.20)',
  luteal: 'rgba(157,138,240,0.13)',
  unknown: 'rgba(138,138,168,0.05)',
};

/**
 * ★ 2026-10-10（用户拍板）：日视图走「全天柱状小条」的六项指标规格。
 *
 * `binMin`  一律 5 分钟/点（与心率同口径，Oura 5 分钟增量）
 * `bands`   [低档上限, 中档上限] → 柱色按档位分（低=浅灰 / 中=黄 / 高=红）
 *           压力/疲劳/情绪是「状态型」指标，没有睡眠/活动之分，用档位色比三段色贴切
 * `measuredOnly` true = **只展示实测**；推算日走空态（当前只有皮质醇）
 * `nightFirst`    true = 以夜间为主（血氧：Oura 白天不测，白天没数据就留白）
 * `sourceNote`    图表下方的数据来源说明
 */
const DAY_BAR_SPECS: Record<string, {
  key: HSMetricKey;
  binMin?: number;
  bands?: [number, number];
  /** 自定义分色（优先于 bands）。情绪这类双向指标用：负=偏低 / 0 附近=平稳 / 正=积极 */
  colorOf?: (v: number) => string;
  /** 图表左上角的小标签；不给则按 bands 有无自动选 */
  barLabel?: string;
  measuredOnly?: boolean;
  nightFirst?: boolean;
  sourceNote?: string;
}> = {
  stress: {
    key: 'stress',
    bands: [30, 55],
    sourceNote: '每根柱 = 5 分钟平均压力值，按档位分色（低 / 中 / 高）。',
  },
  spo2: {
    key: 'spo2',
    nightFirst: true,
    sourceNote: '每根柱 = 5 分钟平均血氧。血氧主要在睡眠时段测量，白天没有数据就留白，不画假线。',
  },
  eda: {
    key: 'eda',
    sourceNote: '每根柱 = 5 分钟平均皮电反应。皮肤电反映交感神经活动，事件时段会明显抬高。',
  },
  fatigue: {
    key: 'fatigue',
    bands: [30, 55],
    sourceNote: '每根柱 = 5 分钟平均疲劳度，按档位分色。',
  },
  emotion: {
    key: 'emotion',
    // ★ 2026-10-12（用户给定设备侧参考色卡）：-10～10 按设备**五档**分色，并一一映射到
    //   「情绪记录」的五档标签（唯一映射源 moodFromEmotionLevel / EMOTION_LEVEL_BANDS）：
    //     EMO −10~−7 → 难过 · 低落 −7~−3 → 压力 · 稳定 −3~4 → 平静
    //     · 高涨 4~7 → 开心 · 激动 7~10 → 兴奋
    //   （原实现先误抄压力/疲劳的 bands[2,3]，后误压成三段；现按设备真值五档 + 情绪记录标签。）
    barLabel: '全天 · 五档情绪',
    colorOf: (v: number) => {
      const m = moodFromEmotionLevel(v);
      return m ? (MOOD_COLOR[m] ?? mm.colors.inkFaint) : mm.colors.inkFaint;
    },
    sourceNote:
      '每根柱 = 5 分钟情绪评估值（−10～10）。五档：平静 −3~4 · 开心 4~7 · 兴奋 7~10 · 压力 −7~−3 · 难过 −10~−7。',
  },
  cortisol: {
    key: 'cortisol',
    measuredOnly: true,
    sourceNote: '每根柱 = 5 分钟平均皮质醇。仅展示戒指实测值。',
  },
  skin: {
    key: 'skin',
    bands: [40, 65],
    sourceNote: '每根柱 = 5 分钟平均皮肤含水量，按档位分色（偏干 / 适中 / 润泽）。',
  },
  sns: {
    key: 'sns',
    bands: [30, 55],
    sourceNote: '每根柱 = 5 分钟平均交感神经活跃度，按档位分色。与皮电互为印证。',
  },
};

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** "HH:mm" / "HH:mm:ss" → 当天该钟点的绝对 ms；解析失败返回 null */
function parseClockMs(s: string | null | undefined, dayStart: number): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return dayStart + hh * 3600_000 + mm * 60_000;
}

/** Y 轴刻度数字：整数不带小数，小数保留 1 位并去尾零。 */
function fmtYAxis(v: number): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 连续时间轴的 X 轴刻度：日视图出时分，周/月视图出月/日；今日末点标「现在」。 */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeAxisLabels(range: RangeKey, tMin: number, tMax: number, isToday: boolean): string[] {
  const N = 6;
  const labels: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = tMin + ((tMax - tMin) * i) / N;
    labels.push(range === 'day' ? fmtClock(t) : `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`);
  }
  if (range === 'day' && isToday) labels[labels.length - 1] = '现在';
  return labels;
}

/** ★ 皮质醇/EDA/HRV 等 24h 节律指标 → X 轴固定 0/6/12/18/24 小时刻度（和 CortisolDailyChart 完全一致） */
function dayHourAxis(): string[] {
  return ['0', '6', '12', '18', '24'];
}

/** ★ 横轴刻度是否显示（与 chartAxis 同源）：周全标；月=1/5/10/15/20/25/30；年=奇数月 */
function axisTickVisible(range: RangeKey, t: string): boolean {
  if (range === 'week') return true;
  if (range === 'month') { const n = Number(t); return !Number.isNaN(n) && isMonthTickDay(n); }
  if (range === 'year') { const m = Number(t.replace('月', '')); return !Number.isNaN(m) && isYearTickMonth(m - 1); }
  return true;
}

/** ECG 波形路径：原始 ADC/mV 点归一化到 320×120 视窗的折线。 */
function ecgWaveformPath(values: number[]): string {
  if (!values || values.length < 2) return '';
  const W = 320;
  const H = 120;
  const pad = 8;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) max = min + 1;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = pad + (i / (n - 1)) * (W - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function MetricDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = route.params as Params;

  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  // 默认打开「日」视图：洞察页卡片今日段已与日视图同源同频，点卡片直接落到对得上的今日趋势。
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  // ★ 2026-10-10（用户）：HRV 日视图分「夜间 / 日间」两段展示（见下方 hrvDay 注释）
  const [hrvPart, setHrvPart] = useState<'night' | 'day'>('night');
  const [cycleLog, setCycleLog] = useState<ReturnType<typeof loadCycleLog> extends Promise<infer T> ? T : null>(null);
  const [w, setW] = useState(0);
  // ★ tooltip 状态：点击图表时显示的白色详情框
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string; color: string } | null>(null);
  const isEcg = params.key === 'ecg';
  // ★ 运动类指标（步数/距离/消耗）不支持日视图，排除 'day' 按钮
  const ACTIVITY_KEYS = ['steps', 'distance', 'calorie'] as const;
  const isActivity = ACTIVITY_KEYS.includes(params.key as any);
  // 如果是运动类且当前 range 是 'day'，自动 fallback 到 'week'
  useEffect(() => {
    if (isActivity && range === 'day') setRange('week');
  }, [isActivity]);
  // ★ ECG 状态完全数据驱动，不从本地 measuring state 读：
  const _ecgProg = ring.ecgProgress;
  const _ecgProgress = _ecgProg?.progress ?? 0;
  const _ecgIsMeasuring = _ecgProg != null && _ecgProgress >= 0 && _ecgProgress < 100;
  const _ecgIsDone = _ecgProg != null && _ecgProgress >= 100;
  // 打开「历史日」且当前指标无数据时的自动补拉状态
  const [backfilling, setBackfilling] = useState(false);
  const requestedForRef = useRef<string | null>(null);
  // 锚点是否为「今天」之外：只有历史日才需要（且值得）自动触发 backfill
  const anchorKey = dateKeyOf(anchor.getTime());
  const isHistorical = anchorKey !== dateKeyOf(Date.now());

  // 心电图：仅主动测量。点击按钮触发原生 ECG 测量（约 30 秒），完成后 ring.ecg 更新并自动刷新本页。
  const measureEcg = useCallback(() => {
    if (_ecgIsMeasuring || _ecgIsDone) return;
    RingBle.measure('ecg'); // 内部先清残留 progress
  }, [_ecgIsMeasuring, _ecgIsDone]);
  // 手动结束 ECG「关闭测试」（对齐 uni-app 文档的「关闭测试」按钮）：提前结束拿结果
  const stopEcg = useCallback(() => {
    RingBle.stopEcg();
  }, []);
  

  // （BLE 状态订阅已由 useRingState 统一处理，见上方 const ring = useRingState()）
  // 直接订阅 healthStore 版本号：回填写入后本页立即重算 buildHistorySeries，
  // 历史曲线即时出现，无需切 Tab / 重进。
  useHealthStoreVersion();
  useEffect(() => {
    void loadCycleLog().then((l) => setCycleLog(l));
  }, []);

  const series: HistoryResult = useMemo(
    () => buildHistorySeries(params.key, range, ring, cycleLog, anchor),
    [params.key, range, ring, cycleLog, anchor]
  );

  // 统一配色铁律：血糖→琥珀(honey)、血氧→蓝(sky)，其余回落 params.color / 主色紫
  const color = (() => {
    if (params.key === 'bloodSugar' || params.key === 'glucose') return mm.colors.honeyCore;
    if (params.key === 'spo2') return mm.colors.skyCore;
    return params.color || theme.colors.accentSolid;
  })();

  /* ══════════════════════════════════════════════════════════════
   * ★ 2026-10-10（用户：心率详情页对齐 Oura 全天柱状小条）
   *
   * Oura 24h 心率图的结构：X 轴每 30 分钟一条刻度线（division），格内 6 根 5 分钟小柱，
   * 白天心率数据本身也是 5 分钟一点。288 根柱连成平滑线就是噪点，所以必须是柱状。
   *
   * 数据**不走 buildHistorySeries**：那条链路内部 `maxPoints:480` 会做等间隔 stride 抽稀
   * （真实一天约 1000~2000 点），尖峰会被抽掉。这里直接读 healthStore 的当日逐样本，
   * 自己分桶成 288 个 5 分钟槽（binByMinutes 保留空槽 = null，不插值）。
   * ══════════════════════════════════════════════════════════════ */
  const isHrDayBars = !isEcg && range === 'day' && params.key === 'hr';
  const hrBars = useMemo(() => {
    if (!isHrDayBars) return null;
    const anchorMs = anchor.getTime();
    const dk = dateKeyOf(anchorMs);
    const dayStart = dayStartOf(anchorMs);
    const buckets = binByMinutes(healthStore.getIntraday('hr', dk), 5, { dayStartMs: dayStart });

    // 睡眠窗口：入睡/起床小时（跨零点时 wake < bed）
    const sl = healthStore.getSleep(dk);
    let bedMs: number | null = null;
    let wakeMs: number | null = null;
    if (sl?.bedHour != null && sl?.wakeHour != null) {
      bedMs = dayStart + sl.bedHour * 3600_000;
      wakeMs = dayStart + sl.wakeHour * 3600_000;
      if (wakeMs <= bedMs) wakeMs += 86_400_000;          // 跨零点
    }

    // 运动段：戒指自动识别 / 手动记录的运动区间 → 柱色用「活动」
    const sessions = ring.sportSessions ?? [];
    const sportRanges: [number, number][] = [];
    for (const s of sessions) {
      const b = parseClockMs(s.beginTime, dayStart);
      const e = parseClockMs(s.endTime, dayStart);
      if (b == null || e == null) continue;
      sportRanges.push([b, e > b ? e : b + 3600_000]);
    }

    return { buckets, dayStart, bedMs, wakeMs, sportRanges };
  }, [isHrDayBars, anchor, ring.sportSessions]);

  const hrSegmentOf = useMemo(() => {
    if (!hrBars) return undefined;
    const { bedMs, wakeMs, sportRanges } = hrBars;
    return (t: number): DayBarSegment => {
      if (bedMs != null && wakeMs != null && t >= bedMs && t <= wakeMs) return 'sleep';
      for (const [b, e] of sportRanges) if (t >= b && t <= e) return 'active';
      return 'awake';
    };
  }, [hrBars]);

  /* ══════════════════════════════════════════════════════════════
   * ★ 2026-10-10（用户：体温对齐 Oura —— 偏离个人基线，不报绝对体温）
   *
   * Oura 官方口径：`temperature_deviation` = 偏离个人基线的度数，±0.5℃ 常提示免疫反应 /
   * 压力 / **黄体期上移**。我们按 30 分钟槽建个人基线（见 lib/tempBaseline.ts），
   * Y 轴画**偏离量 Δ℃**，绝对值只在标题行给一个，避免 Y 轴冒出 35~38 这种无信息量刻度。
   * ══════════════════════════════════════════════════════════════ */
  const isTempDay = !isEcg && range === 'day' && params.key === 'temp';
  const tempDay = useMemo(() => {
    if (!isTempDay) return null;
    const dk = dateKeyOf(anchor.getTime());
    const baseline = buildTempBaseline({ endDayKey: dk });
    const { dev, abs } = tempDeviationSeries(dk, baseline);
    return { dev, abs, baseline, summary: tempDeviationSummary(dev) };
  }, [isTempDay, anchor]);

  /* ══════════════════════════════════════════════════════════════
   * ★ 2026-10-10（用户拍板）：血氧 / 压力 / EDA / 疲劳 / 情绪 / 皮质醇 六项的日视图。
   *
   * 关键约束（来自 `lib/offlineEstimates.ts` 的数据真相）：
   *   历史日的 cortisol / fatigue / emotion / eda / skin 都是**当日实测 stress 的线性换算**
   *   （cortisol=stress×1.6+20、fatigue=stress×1.2、emotion=stress 分档只有 {2,3,4}）。
   *   所以：
   *   ① **皮质醇只展示实测**（用户明确要求）——推算日一律走空态，不画线、不用压力顶替。
   *      理由：皮质醇有教科书级昼夜节律（CAR），画一条「看起来很科学的」激素曲线，
   *      实际是压力分换算，这是最容易被当成临床结论误引的指标。
   *   ② 其余五项正常展示，但**必须标注数据来源**（今天实测 / 历史推算）。
   *   ③ 压力/疲劳/情绪是「状态型」指标 → 用 `colorOf` 按档位分色，不用睡眠/活动三段色。
   *   ④ 血氧以夜间为主（Oura 白天不测）；白天真有数据就照实画，没有就留白。
   * ══════════════════════════════════════════════════════════════ */
  const spec = DAY_BAR_SPECS[params.key];
  const isSpecDay = !isEcg && range === 'day' && !!spec;
  const specDay = useMemo(() => {
    if (!isSpecDay || !spec) return null;
    const dk = dateKeyOf(anchor.getTime());
    const dayStart = dayStartOf(anchor.getTime());
    const derived = healthStore.isDerivedDay(spec.key as HSMetricKey, dk);
    // 皮质醇：推算日不出曲线（空态）
    if (spec.measuredOnly && derived) return { blocked: true as const, dk, derived, buckets: null };
    const pts = healthStore.getIntraday(spec.key as HSMetricKey, dk);
    const buckets = binByMinutes(pts, spec.binMin ?? 5, { dayStartMs: dayStart });
    const filled = bucketFilledCount(buckets);
    return { blocked: false as const, dk, derived, buckets, filled, total: buckets.length };
  }, [isSpecDay, spec, anchor]);

  // 状态型指标的分档配色：优先 spec 自定义（情绪按方向），否则低/中/高三档
  const specColorOf = useMemo(() => {
    if (spec?.colorOf) return spec.colorOf;
    if (!spec?.bands) return undefined;
    const [lo, hi] = spec.bands;
    return (v: number) => (v <= lo ? mm.colors.inkFaint : v <= hi ? mm.colors.honeyCore : mm.colors.roseDeep);
  }, [spec]);
  const isHrvDay = !isEcg && range === 'day' && params.key === 'hrv';

  /**
   * ★ 睡眠窗口**独立计算**，只依赖 anchor —— 绝不依赖 `hrvPart`。
   *
   * 2026-10-10 用户实锤的 bug：「点了日间就再也点不回夜间」。
   * 根因是自引用状态：原来睡眠窗口跟 `hrvDay` 算在**同一个 memo**里，而这个 memo 又依赖
   * `hrvPart`。切到「日间」时走的是日间分支 → 返回的 `window` 是 `null` →
   * 「夜间」按钮的 `disabled={hrvDay.window == null}` 变成 true → 自己把按钮禁用了，
   * 再也点不回来。拆开后「夜间可不可点」只由当天有没有睡眠时刻决定，与当前选中项无关。
   */
  const hrvSleepWindow = useMemo(() => {
    if (!isHrvDay) return null;
    const dk = dateKeyOf(anchor.getTime());
    const dayStart = dayStartOf(anchor.getTime());
    const sl = healthStore.getSleep(dk);
    if (sl?.bedHour == null || sl?.wakeHour == null) return null;
    const bedMs = dayStart + sl.bedHour * 3600_000;
    let wakeMs = dayStart + sl.wakeHour * 3600_000;
    if (wakeMs <= bedMs) wakeMs += 86_400_000;                // 跨零点
    return wakeMs > bedMs ? ([bedMs, wakeMs] as [number, number]) : null;
  }, [isHrvDay, anchor]);

  const hrvNightAvailable = hrvSleepWindow != null;

  const hrvDay = useMemo(() => {
    if (!isHrvDay) return null;
    const dk = dateKeyOf(anchor.getTime());
    const dayStart = dayStartOf(anchor.getTime());
    const pts = healthStore.getIntraday('hrv', dk);
    const win = hrvSleepWindow;

    if (hrvPart === 'night' && win) {
      const [bedMs, wakeMs] = win;
      const slotCount = Math.max(6, Math.ceil((wakeMs - bedMs) / (5 * 60_000)));
      const buckets = binByMinutes(pts, 5, { dayStartMs: bedMs, slotCount });
      const ticks: { frac: number; label: string }[] = [];
      const stepMs = 2 * 3600_000;
      const first = Math.ceil(bedMs / stepMs) * stepMs;
      for (let t = first; t <= wakeMs; t += stepMs) {
        const d = new Date(t);
        ticks.push({
          frac: (t - bedMs) / (wakeMs - bedMs),
          label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        });
      }
      return { buckets, t0: bedMs, spanMs: wakeMs - bedMs, ticks, muted: undefined, window: win };
    }

    // 日间视图：全天轴，睡眠段静默（趋势线在静默区断开，见 AllDayBarsChart 分段逻辑）
    const buckets = binByMinutes(pts, 5, { dayStartMs: dayStart });
    return {
      buckets,
      t0: dayStart,
      spanMs: 86_400_000,
      ticks: undefined,
      muted: win ? ([[win[0], Math.min(win[1], dayStart + 86_400_000)]] as [number, number][]) : undefined,
      window: win,
    };
  }, [isHrvDay, anchor, hrvPart, hrvSleepWindow]);
  // 手动测量类 key — 在底部显示历史测量列表（按时间倒序）
  // bloodSugar/glucose/bpSys/bpDia 是戒指连续信号，不走 manual 流程
const MANUAL_KEYS = ['triglyceride', 'hdl', 'ldl', 'cholesterol', 'bloodFat', 'uricAcid', 'bodyComposition'];
  const showManualList = MANUAL_KEYS.includes(params.key);
  const manualHsKeyMap: Record<string, HSMetricKey> = {
    triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl',
    cholesterol: 'cholesterol', bloodFat: 'cholesterol',
    uricAcid: 'ua', bloodSugar: 'glucose', glucose: 'glucose',
    bpSys: 'bpSys', bpDia: 'bpDia',
  };
  const manualList: ManualMeasurement[] = showManualList
    ? healthStore.getManualMeasurements(manualHsKeyMap[params.key] ?? params.key as HSMetricKey).slice(0, 30)
    : [];
  // EDA 测试诊断：只在开发包的 EDA 详情页展示，帮助核对点测频率，不作为用户指标。
  const edaDiagnostics = useMemo(() => {
    if (!__DEV__ || params.key !== 'eda') return null;
    const end = Date.now();
    const points = healthStore.getTimeRange('eda', end - 30 * 60 * 1000, end, { maxPoints: 5000 });
    const times = points.map((p) => p.t).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0);
    const medianGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
    return {
      count: points.length,
      medianGapMin: medianGap != null ? medianGap / 60000 : null,
      latestMin: times.length ? (end - times[times.length - 1]) / 60000 : null,
    };
  }, [params.key, ring, range, anchor]);
  // ★ DEBUG: 详情页收到的参数和数据
  const gid = `md_${params.key}`;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = series.points.length;
  const xAt = (i: number) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  // 自适应 Y 轴量程：以当前视图实际数据为界，上下各留 12% 余量，曲线更饱满、刻度更接近真实值；
  // 单点/空数据时回退到指标的固定显示量程（series.yMin/yMax），避免退化或 NaN。
  // ★ 2026-10-08：相对 / 归一化指标（皮质醇活性 0~100 等）不展示左侧数值 Y 轴（用户要求），
  //   避免自动量程出现 -7 之类的无意义负刻度；曲线 / 参考线 / 统计 / tooltip 仍保留。
  const hideYAxis = RELATIVE_AXIS_KEYS.has(params.key);

  const yBounds = useMemo(() => {
    const vals: number[] = [];
    const pts = series.tPoints;
    if (pts && pts.length) {
      for (const p of pts) if (Number.isFinite(p.v)) vals.push(p.v);
    } else {
      for (const v of series.points) if (v != null) vals.push(v);
    }
    if (!vals.length) return { lo: series.yMin, hi: series.yMax };
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    // ★ 2026-10-08：非负 / 归一化指标（cortisol/eda/hrv/...）的 Y 轴下限钳 0，
    //   否则底部刻度会出现 -7 之类负值（用户实锤）。可负指标（如情绪 -10~10, yMin<0）不受影响。
    //   ★ 2026-10-12：emotion 虽在 RELATIVE_AXIS_KEYS（不显示数值轴），但它是**双向**指标
    //   （-10~10），一律钳 0 会把负值曲线整段切掉 → 排除出钳 0 名单。
    //   ★ 本轮：相对 / 归一化指标（RELATIVE_AXIS_KEYS）除情绪外一律下限 0（0~100 活性）。
    const isRelative = RELATIVE_AXIS_KEYS.has(params.key) && params.key !== 'emotion';
    const floor = isRelative ? 0 : (series.yMin != null && series.yMin >= 0 ? series.yMin : -Infinity);
    if (rawMin === rawMax) {
      const pad = Math.abs(rawMin) * 0.1 || 1;
      return { lo: Math.max(floor, rawMin - pad), hi: rawMax + pad };
    }
    const span = rawMax - rawMin;
    const pad = span * 0.12;
    return { lo: Math.max(floor, rawMin - pad), hi: rawMax + pad };
  }, [series.tPoints, series.points, series.yMin, series.yMax]);
  const yLo = yBounds.lo;
  const yHi = yBounds.hi;
  const yAt = (v: number) => {
    const c = Math.max(yLo, Math.min(yHi, Number.isFinite(v) ? v : yLo));
    return PAD_T + (1 - (c - yLo) / (yHi - yLo || 1)) * plotH;
  };

  // ★ 找离触摸点最近的真实数据点（tooltip 用）
  const wScale = W / Math.max(w, 1);
  const findNearestDot = (touchXRn: number) => {
    if (dots.length === 0) return null;
    const svgX = touchXRn * wScale;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < dots.length; i++) {
      const d = Math.abs(dots[i].x - svgX);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best < 0) return null;
    const d = dots[best];
    const label = axisLabels[Math.min(best, axisLabels.length - 1)] ?? '';
    // 兼容 indexed 模式（series.points）和 continuous 模式（series.tPoints）
    let rawVal: number | null = null;
    if (series.tPoints && series.tPoints.length > 0) rawVal = series.tPoints[best]?.v ?? null;
    else rawVal = series.points[best] ?? null;
    return { d, label, rawVal };
  };

  // 连续时间轴（真实时间戳）：今日实时点 + 历史回填点都在 tMin..tMax 域内按 t 映射 x
  const isTodayAnchor = anchorKey === dateKeyOf(Date.now());
  const useContinuous = series.continuous && !!series.tPoints && series.tPoints.length > 0;
  const tMin = series.tMin ?? 0;
  const tMax = series.tMax ?? 0;
  const xAtT = (t: number) =>
    PAD_L + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0.5) * plotW;

  // 折线分段（遇 null / 超阈值断线）；同时把所有真实点收集为散点，保证稀疏/单点历史日也能看见。
  const { lineD, areaD, last, dots } = useMemo(() => {
    if (w === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
    // ★ 断线阈值：实时采集指标约 5min/条，断 30min 视为明显断连
    // 之前 36h 阈值导致断连几天都不断线，完全形同虚设
    const GAP_MS = 30 * 60 * 1000;

    // 连续时间轴（HR/SpO2/Temp/EDA day range）：按真实 t 映射 x
    if (useContinuous && series.tPoints) {
      const pts = series.tPoints;
      let line = '';
      let area = '';
      let seg: { x: number; y: number }[] = [];
      const allDots: { x: number; y: number }[] = [];
      const flush = () => {
        if (seg.length < 2) { seg = []; return; }
        let d = `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
        for (let i = 0; i < seg.length - 1; i++) {
          const a = seg[i]; const b = seg[i + 1];
          const mx = (a.x + b.x) / 2;
          d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        }
        line += d;
        area += `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
        seg = [];
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = xAtT(p.t);
        const y = yAt(p.v);
        allDots.push({ x, y });
        // ★ 断线判断：相邻点时间差 > 30min → flush 分段
        if (i > 0) {
          const gapMs = p.t - pts[i - 1].t;
          const gapMin = gapMs / 60000;
          if (gapMs > GAP_MS) flush();
        }
        seg.push({ x, y });
      }
      flush();
      const lastPt = allDots.length ? allDots[allDots.length - 1] : { x: 0, y: 0 };
      return { lineD: line, areaD: area, last: lastPt, dots: allDots };
    }

    // 非连续（week/month/year）：按索引绘制，遇 null 断线
    if (n === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
    if (n === 1) {
      const v = series.points[0];
      if (v == null) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
      const pt = { x: xAt(0), y: yAt(v) };
      return { lineD: '', areaD: '', last: pt, dots: [pt] };
    }
    let line = '';
    let area = '';
    let seg: { x: number; y: number }[] = [];
    const allDots: { x: number; y: number }[] = [];
    const flush = () => {
      if (seg.length < 2) {
        seg = [];
        return;
      }
      let d = `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
      for (let i = 0; i < seg.length - 1; i++) {
        const a = seg[i];
        const b = seg[i + 1];
        const mx = (a.x + b.x) / 2;
        d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      }
      line += d;
      area += `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
      seg = [];
    };
    for (let i = 0; i < n; i++) {
      const v = series.points[i];
      if (v == null) {
        flush();
        continue;
      }
      const pt = { x: xAt(i), y: yAt(v) };
      allDots.push(pt);
      seg.push(pt);
    }
    flush();
    const lastPt = (() => {
      for (let i = n - 1; i >= 0; i--) if (series.points[i] != null) return { x: xAt(i), y: yAt(series.points[i]!) };
      return { x: 0, y: 0 };
    })();
    return { lineD: line, areaD: area, last: lastPt, dots: allDots };
  }, [w, useContinuous, series, plotW, plotH, yBounds]);

  // 首点（用于变化率）：连续序列取 tPoints 首点
  const firstReal = (() => {
    if (useContinuous && series.tPoints && series.tPoints.length) return series.tPoints[0].v;
    for (const v of series.points) if (v != null) return v;
    return null;
  })();
  const deltaPct =
    firstReal != null && series.latest != null && firstReal !== 0
      ? Math.round(((series.latest - firstReal) / Math.abs(firstReal)) * 100)
      : 0;
  const hasData = series.latest != null || series.avg != null;
  // 顶部聚合值：日视图显示当日最新读数；周/月/年显示区间平均（按需求：周月=周月均值，年=年均）
  const heroVal = range === 'day' ? series.latest : series.avg;

  // 打开「历史日」且当前指标无数据时，自动触发一次 backfill（需戒指已连接），
  // 让历史趋势图无需手动连戒指即可补拉。同一日期只触发一次，避免重复请求刷屏。
  useEffect(() => {
    if (isEcg || !isHistorical || hasData) return;
    if (ring.status !== 'connected') return;
    if (requestedForRef.current === anchorKey) return;
    requestedForRef.current = anchorKey;
    setBackfilling(true);
    RingBle.syncBackfill();
    // 兜底复位：原生 onBackfillComplete 会强制落盘，但这里给 15s 超时防止「正在补拉」一直挂着
    const t = setTimeout(() => setBackfilling(false), 15000);
    return () => clearTimeout(t);
  }, [isEcg, isHistorical, hasData, ring.status, anchorKey]);

  // X 轴标签：连续时间轴按时间域出刻度（日=时分，周/月=月/日，今日末点标"现在"）
  // ★ 高频连续指标（cortisol/eda/hrv/stress/fatigue/emotion/skin）日视图 → 固定 0-24h 刻度
  //   （与 RELATIVE_AXIS_KEYS 同源，统一相对/归一化指标集合）
  const KF_DAY_HOUR_AXIS = RELATIVE_AXIS_KEYS;
  const axisLabels = useMemo(() => {
    if (range === 'day' && KF_DAY_HOUR_AXIS.has(params.key)) {
      return dayHourAxis();
    }
    if (useContinuous && tMin && tMax && tMax > tMin) {
      return timeAxisLabels(range, tMin, tMax, isTodayAnchor);
    }
    if (series.axisOverride && series.axisOverride.length > 1) {
      // ★ 直接渲染真实序列长度（1:1 对齐数据点）；稀疏刻度由 axisTickVisible 按 chartAxis 同源规则抽稀
      return series.axisOverride;
    }
    return RANGE_DEF[range].axis;
  }, [useContinuous, tMin, tMax, range, isTodayAnchor, series.axisOverride]);

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{params.name}</Text>
            {params.dimension ? <Text style={styles.sub}>{params.unit}</Text> : null}
          </View>
          {!isEcg && hasData ? (
            <View style={styles.liveTag}>
              <Text style={styles.liveText}>真实数据</Text>
            </View>
          ) : null}
        </View>

        {/* 日 / 周 / 月 / 年 切换 */}
        {!isEcg && <RangeSwitch value={range} onChange={setRange} exclude={isActivity ? ['day'] : undefined} />}

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        {!isEcg && <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />}

        {/* ★ 2026-10-10（用户 10-09 硬性要求，此前本页漏改）：总体数据卡移到时间选择器**下方**，
              切换上方不再放大数字 —— 与状态趋势/脑力/心理压力详情页统一（切换 → 选择器 → 数据卡 → 图表） */}
        {!isEcg && (
          <Card padded={false}>
            <View style={styles.pad}>
              <View style={styles.hero}>
                <Text style={styles.heroVal}>{fmtVal(heroVal)}</Text>
                {series.unit ? <Text style={styles.heroUnit}>{series.unit}</Text> : null}
                {range !== 'day' && hasData ? <Text style={styles.heroTag}>区间平均</Text> : null}
                {range === 'day' && hasData && deltaPct !== 0 && series.kind !== 'cycle' && (
                  <Text style={[styles.delta, deltaPct > 0 ? styles.up : styles.down]}>
                    {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较区间首点
                  </Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* ★ 2026-10-10（用户）：心率日视图 = Oura 风格全天柱状小条（5 分钟一点 / 30 分钟一格刻度） */}
        {isHrDayBars && hrBars ? (
          <View style={styles.chartCard}>
            <AllDayBarsChart
              buckets={hrBars.buckets}
              dayStartMs={hrBars.dayStart}
              segmentOf={hrSegmentOf}
              height={chart.plot.l}
            />
            <DayBarsLegend />
            <Text style={styles.chartNote}>
              每根柱 = 5 分钟平均心率，横轴每 30 分钟一条刻度线。数据缺失的时段留白，不做插值。
            </Text>
          </View>
        ) : null}

        {/* ★ 2026-10-10（用户）：体温日视图 = 偏离个人基线的昼夜节律（Oura 口径） */}
        {isTempDay && tempDay ? (
          <View style={styles.chartCard}>
            <View style={styles.tempHeadRow}>
              <Text style={styles.tempHeadLab}>相对个人基线</Text>
              <Text style={styles.tempHeadVal}>
                {tempDay.summary.avg != null
                  ? `${tempDay.summary.avg > 0 ? '+' : ''}${tempDay.summary.avg.toFixed(2)}℃`
                  : '—'}
              </Text>
              <Text style={styles.tempHeadHint}>
                {tempDay.summary.maxUp != null
                  ? `峰值 +${tempDay.summary.maxUp.toFixed(2)}℃`
                  : ''}
                {tempDay.summary.maxDown != null
                  ? `　最低 ${tempDay.summary.maxDown.toFixed(2)}℃`
                  : ''}
              </Text>
            </View>
            <TempCircadianChart dev={tempDay.dev} baseline={tempDay.baseline} />
            <TempBaselineLegend />
            <Text style={styles.chartNote}>
              体温按「相对你自己的基线」显示，不是绝对体温——白天的体温会被吃喝、运动、环境干扰，
              曲线形状才有意义（黄体期通常整体上移约 +0.3℃）。
            </Text>
          </View>
        ) : null}

        {/* ★ 2026-10-10（用户）：HRV 日视图 = 夜间 / 日间 分两段展示（Oura 口径：HRV 的意义集中在睡眠期） */}
        {isHrvDay && hrvDay ? (
          <View style={styles.chartCard}>
            <View style={styles.partRow}>
              {(['night', 'day'] as const).map((p) => {
                const on = hrvPart === p;
                // ★ 2026-10-10：可点性只看「当天有没有睡眠时刻」，与当前选中项无关
                const disabled = p === 'night' && !hrvNightAvailable;
                return (
                  <TouchableOpacity
                    key={p}
                    disabled={disabled}
                    onPress={() => setHrvPart(p)}
                    style={[styles.partBtn, on && styles.partBtnOn, disabled && styles.partBtnOff]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.partBtnText, on && styles.partBtnTextOn]}>
                      {p === 'night' ? '夜间（睡眠期）' : '日间'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {hrvPart === 'night' && !hrvNightAvailable ? (
              <Text style={styles.chartNote}>昨夜入睡 / 起床时间未同步，夜间 HRV 暂时无法定位时段。</Text>
            ) : hrvDay?.buckets ? (
              <>
                <AllDayBarsChart
                  buckets={hrvDay.buckets}
                  dayStartMs={hrvDay.t0}
                  spanMs={hrvDay.spanMs}
                  tickLabels={hrvDay.ticks}
                  mutedRanges={hrvDay.muted}
                  yMin={0}
                  segmentOf={hrvPart === 'night' ? () => 'sleep' : () => 'awake'}
                  height={chart.plot.l}
                />
                <DayBarsLegend showMean={false} />
                <Text style={styles.chartNote}>
                  {hrvPart === 'night'
                    ? '每根柱 = 5 分钟平均 rMSSD（ms）。HRV 只在睡眠静止期有意义，所以只画入睡到起床这一段。'
                    : '每根柱 = 5 分钟平均 rMSSD（ms）。白天的 HRV 受运动与说话干扰，参考价值低于夜间；睡眠段不做测量，已留白。'}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        {/* ★ 2026-10-10（用户拍板）：血氧 / 压力 / EDA / 疲劳 / 情绪 / 皮质醇 —— 全天柱状小条 */}
        {isSpecDay && spec && specDay ? (
          <View style={styles.chartCard}>
            <View style={styles.partRow}>
              <Text style={styles.specLab}>{DAY_BAR_SPECS[params.key]?.barLabel
                ?? (DAY_BAR_SPECS[params.key]?.bands ? '全天 · 按档位分色' : '全天 · 每 5 分钟一点')}</Text>
              <Text style={styles.specCount}>
                {specDay.blocked ? '无实测数据'
                  : `${specDay.filled ?? 0}/${specDay.total ?? 0} 有数据`}
              </Text>
            </View>
            {specDay.blocked ? (
              <Text style={styles.chartNote}>
                当日皮质醇为推算值（由压力值换算），按产品口径**不展示**——皮质醇有明确的昼夜节律
                与临床阈值，用换算值画曲线会被误当成实测结论。这一天没有戒指实测数据。
              </Text>
            ) : (
              <>
                <AllDayBarsChart
                  buckets={specDay.buckets ?? []}
                  dayStartMs={dayStartOf(anchor.getTime())}
                  segmentOf={spec!.nightFirst ? hrSegmentOf : undefined}
                  colorOf={specColorOf}
                  yMin={params.key === 'spo2' ? 85 : params.key === 'emotion' ? -10 : undefined}
                  height={chart.plot.l}
                />
                {/* ★ 2026-10-12（用户拍板：统一成 平静/开心/兴奋/压力/难过）—— 情绪图例 = 「情绪记录」
                    点阵的同一套五档顺序（DOT_LEGEND），色值一律取 MOOD_COLOR，跨页完全一致。
                    睡眠/清醒/活动是心率类图的分段（segmentOf），情绪是状态型指标不用那套。 */}
                <DayBarsLegend
                  showMean={false}
                  items={params.key === 'emotion' ? [
                    { color: MOOD_COLOR.calm, label: '平静' },
                    { color: MOOD_COLOR.happy, label: '开心' },
                    { color: MOOD_COLOR.excited, label: '兴奋' },
                    { color: MOOD_COLOR.stressed, label: '压力' },
                    { color: MOOD_COLOR.sad, label: '难过' },
                  ] : undefined}
                />
                <Text style={styles.chartNote}>
                  {spec!.sourceNote}
                  {specDay.derived ? '（当日历史数据为推算值）' : ''}
                </Text>
              </>
            )}
          </View>
        ) : null}

        {!isEcg && !isHrDayBars && !isTempDay && !isHrvDay && !isSpecDay && (
        <View style={styles.chartCard}>
          {/* 图表主体：左侧 Y 轴刻度列 + 右侧曲线（X 轴标签在下方，左移 Y_GUT 对齐） */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {/* Y 轴刻度：HTML 文字避免 SVG 横向拉伸变形；位置与参考线一一对应 */}
            {/* ★ 2026-10-08：相对 / 归一化指标不展示数值 Y 轴（hideYAxis） */}
            {hasData && !hideYAxis && (
            <View style={{ width: Y_GUT, height: H, position: 'relative' }}>
                {[0, 1, 2, 3, 4].map((k) => {
                  const gv = yLo + (yHi - yLo) * (1 - k / 4);
                  return (
                    <Text
                      key={`y-${k}`}
                      style={{
                        position: 'absolute',
                        top: Math.max(0, yAt(gv) - 7),
                        right: 3,
                        fontSize: theme.fontSize.micro,
                        color: theme.colors.textSub,
                        textAlign: 'right',
                      }}
                    >
                      {fmtYAxis(gv)}
                      {k === 0 && series.unit ? ` ${series.unit}` : ''}
                    </Text>
                  );
                })}
            </View>
            )}
            <View
              style={{ flex: 1 }}
              onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
              onTouchStart={(e) => {
                const touch = e.nativeEvent;
                const result = findNearestDot(touch.locationX);
                if (result) {
                  setTip({
                    x: result.d.x / wScale,
                    y: result.d.y / wScale,
                    label: result.label,
                    value: fmtVal(result.rawVal),
                    color,
                  });
                } else {
                  setTip(null);
                }
              }}
              onTouchEnd={() => setTimeout(() => setTip(null), 2000)}
              pointerEvents="box-none"
            >
            {w > 0 ? (
              <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`${gid}_grad`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <Stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </LinearGradient>
                  <LinearGradient id={`${gid}_line`} x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={color} />
                    <Stop offset="100%" stopColor={color} />
                  </LinearGradient>
                </Defs>

                {/* 周期相位背景带 */}
                {series.phaseAt
                  ? series.phaseAt.map((ph, i) => (
                      <Rect
                        key={`bg-${i}`}
                        x={xAt(i) - plotW / (n || 1) / 2}
                        y={PAD_T}
                        width={plotW / (n || 1)}
                        height={plotH}
                        fill={PHASE_BG[ph ?? 'unknown'] ?? PHASE_BG.unknown}
                      />
                    ))
                  : null}

                {/* 自适应量程参考线（yLo / 中 / yHi） */}
                {[yLo, (yLo + yHi) / 2, yHi].map((gv, i) => (
                  <Line
                    key={`g-${i}`}
                    x1={PAD_L}
                    y1={yAt(gv)}
                    x2={W - PAD_R}
                    y2={yAt(gv)}
                    stroke={theme.colors.ui.borderSoft}
                    strokeWidth={chart.lw.grid}
                  />
                ))}

                {areaD ? <Path d={areaD} fill={`url(#${gid}_grad)`} /> : null}
                {lineD ? (
                  <Path d={lineD} fill="none" stroke={`url(#${gid}_line)`} strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
                {/* 数据点已去掉，改用点击 tooltip 展示详细数据 */}
              </Svg>
            ) : null}
            {/* ★ tooltip：点击显示白色详情框 */}
            {tip && w > 0 ? (() => {
              const TW = 110, TH = 60;
              // 智能定位：不超屏
              let tipX = tip.x - TW / 2;
              if (tipX < 4) tipX = 4;
              if (tipX + TW > w - 4) tipX = w - 4 - TW;
              const tipY = Math.max(0, tip.y - TH - 12);
              // 小三角
              const triX = tip.x - 8;
              return (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: H }}>
                  <View style={{ position: 'absolute', left: tipX, top: tipY, width: TW, height: TH, backgroundColor: '#FFFFFF', borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, paddingHorizontal: 10, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.colors.textSub, marginBottom: 2 }}>{tip.label}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: tip.color }}>{tip.value}</Text>
                  </View>
                  <View style={{ position: 'absolute', left: triX, top: tipY + TH, width: 0, height: 0, backgroundColor: 'transparent', borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF' }} />
                </View>
              );
            })() : null}
          </View>
          </View>

          {/* 无数据占位（诚实 + 引导） */}
          {!hasData ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {ring.status !== 'connected'
                  ? '连接戒指以加载历史数据'
                  : backfilling
                  ? '正在补拉历史数据…'
                  : '当前范围内暂无真实测量数据'}
              </Text>
            </View>
          ) : null}

          {/* X 轴标签 */}
          <View style={[styles.axis, { paddingLeft: hideYAxis ? PAD_L : Y_GUT }]}>
            {axisLabels.map((t, i) => (
              <Text key={i} style={styles.axisText}>
                {axisTickVisible(range, t) ? t : ''}
              </Text>
            ))}
          </View>
        </View>
        )}

        {/* 统计：平均 / 最高 / 最低 */}
        {!isEcg && (
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均</Text>
              <Text style={styles.statValue} numberOfLines={1}>{fmtVal(series.avg)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最高</Text>
              <Text style={styles.statValue} numberOfLines={1}>{fmtVal(series.hi)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低</Text>
              <Text style={styles.statValue} numberOfLines={1}>{fmtVal(series.lo)}</Text>
            </View>
          </View>
        )}

        {/* 解读 */}
        {!isEcg && series.note ? <Text style={styles.note}>{series.note}</Text> : null}

        {/* 历史测量列表（手动测量类指标才显示，按时间倒序） */}
        {showManualList && (
          <View style={{ marginTop: theme.space.md }}>
            <Text style={{
              fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold,
              color: theme.colors.textTitle, marginBottom: theme.space.sm,
            }}>历史测量记录</Text>
            {manualList.length === 0 ? (
              <Text style={{
                fontSize: theme.fontSize.sm, color: theme.colors.textSub,
                fontStyle: 'italic',
              }}>
                还没有测量记录。点击下方「一键血液成分测量」获取首次读数。
              </Text>
            ) : (
              manualList.map((m, i) => {
                const d = new Date(m.t);
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
                const valStr = params.key === 'uricAcid' ? m.v.toFixed(1) : m.v.toFixed(2);
                return (
                  <View key={`${m.t}-${i}`} style={{
                    flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: theme.space.sm,
                    paddingHorizontal: theme.space.md,
                    backgroundColor: i === 0 ? theme.colors.accentSoft : 'transparent',
                    borderRadius: theme.radius.sm,
                    marginBottom: theme.sp(1),
                  }}>
                    <Text style={{
                      fontSize: theme.fontSize.sm, color: theme.colors.textSub,
                    }}>{dateLabel}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{
                        fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold,
                        color: theme.colors.textTitle,
                      }}>{valStr}</Text>
                      <Text style={{
                        fontSize: theme.fontSize.micro, color: theme.colors.textSub,
                        marginLeft: theme.sp(1),
                      }}>{params.unit}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* 心电图：仅主动测量 —— 按钮触发，展示波形 + 派生指标，不做连续趋势图 */}
        {isEcg ? (
          <View style={styles.ecgDetail}>
            <Text style={styles.ecgTitle}>
              {ring.ecg ? `心电图波形 · ${new Date(ring.ecg.ts).toLocaleString()}` : '心电图 · 主动测量'}
            </Text>
            {ring.ecg ? (
              <View style={styles.ecgChart}>
                <Svg width="100%" height={120} viewBox="0 0 320 120" preserveAspectRatio="none">
                  <Path d={ecgWaveformPath(ring.ecg.waveform)} fill="none" stroke={mm.colors.skyDeep} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
                </Svg>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>尚未测量。点击下方按钮开始约 30 秒心电图测量（需手指接触电极）。</Text>
              </View>
            )}
            <View style={styles.ecgGrid}>
              {(
                [
                  ['平均心率', ring.ecg ? `${Math.round(ring.ecg.aveHeart)} bpm` : '—'],
                  ['HRV', ring.ecg ? `${Math.round(ring.ecg.aveHrv)} ms` : '—'],
                  ['呼吸率', ring.ecg ? `${Math.round(ring.ecg.aveResRate)} 次/分` : '—'],
                  ['QT', ring.ecg ? `${Math.round(ring.ecg.aveQT)} ms` : '—'],
                  ['PWV', ring.ecg ? `${Math.round(ring.ecg.avePWV)} cm/s` : '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <View style={styles.ecgCell} key={k}>
                  <Text style={styles.ecgLabel}>{k}</Text>
                  <Text style={styles.ecgValue}>{v}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} disabled={_ecgIsMeasuring || _ecgIsDone} style={[styles.ecgBtn, _ecgIsMeasuring && styles.ecgBtnBusy]}>
              <Text style={[styles.ecgBtnLabel, _ecgIsMeasuring && styles.ecgBtnLabelBusy]}>
                {_ecgIsMeasuring
                  ? `测量中 ${_ecgProgress}%${ring.ecgProgress?.hr ? ` · ${Math.round(ring.ecgProgress.hr)} bpm` : ''}`
                  : _ecgIsDone
                    ? '处理结果中…'
                    : ring.ecg
                      ? '重新测量'
                      : '开始心电图测量'}
              </Text>
            </TouchableOpacity>
            {_ecgIsMeasuring ? (
              <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={styles.ecgStopBtn}>
                <Text style={styles.ecgStopLabel}>停止测量</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {edaDiagnostics ? (
          <View style={styles.debugFoot}>
            <Text style={styles.debugTitle}>测试信息 · EDA（最近 30 分钟）</Text>
            <Text style={styles.debugText}>
              样本 {edaDiagnostics.count} 条 · 中位间隔 {edaDiagnostics.medianGapMin != null ? `${edaDiagnostics.medianGapMin.toFixed(1)} 分钟` : '—'} · 最近样本 {edaDiagnostics.latestMin != null ? `${edaDiagnostics.latestMin.toFixed(1)} 分钟前` : '—'}
            </Text>
          </View>
        ) : null}
      </View>
    </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  pad: { padding: theme.space.cardPad },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.sm,
  },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) },
  liveTag: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.successSoft,
  },
  liveText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.success },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  // ★ 2026-10-10：原 #FFFFFF 白字是给旧深色渐变头用的，v16 页面改全白底后大数字「白字白底」不可见；
  //   数据卡挪到选择器下方的同时改为墨色（与状态趋势/脑力详情页同口径）。
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, color: mm.colors.ink },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  heroTag: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: theme.space.md, alignSelf: 'center' },
  delta: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, marginLeft: theme.space.md },
  up: { color: theme.colors.success },
  down: { color: theme.colors.stateTense },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
  },
  /** ★ 2026-10-10：图表下方一句口径说明（柱状小条/偏离基线等新图形的读图须知） */
  chartNote: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(2),
    lineHeight: theme.fontSize.micro * 1.6,
  },
  /** ★ 2026-10-10：体温偏离图顶部一行（相对基线的均值 + 峰谷） */
  tempHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: theme.sp(1),
    gap: theme.sp(2),
  },
  tempHeadLab: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  tempHeadVal: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium as any,
    color: mm.colors.roseDeep,
  },
  tempHeadHint: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  /** ★ 2026-10-10：HRV 夜间 / 日间 分段控件（对齐洞察页 Tab 的选中语言） */
  partRow: { flexDirection: 'row', gap: theme.sp(2), marginBottom: theme.sp(2) },
  partBtn: {
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: 'transparent',
  },
  partBtnOn: { backgroundColor: mm.colors.limeSoft, borderColor: mm.colors.limeMid },
  partBtnOff: { opacity: 0.4 },
  partBtnText: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, fontWeight: theme.weight.medium as any },
  partBtnTextOn: { color: mm.colors.ink, fontWeight: theme.weight.semibold as any },
  /** ★ 2026-10-10：柱状小条卡顶部的口径标签 / 有效数据计数 */
  specLab: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, fontWeight: theme.weight.medium as any },
  specCount: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2), paddingLeft: Y_GUT },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  /**
   * ★ 2026-10-10（用户：「详情页下面的平均/最高/最低加个框，跟其他模块保持一致」）：
   * 原来三格是 `rgba(255,255,255,0.6)` 半透明白底 —— 页面本身是白的，等于没有边界，
   * 所以看起来"没框"。改为与全站卡片同一套规格：`cardBg` 实底 + 1px `cardBorder` 描边
   * + `radius.md` 圆角（对齐 components/Card.tsx 的白卡规格）。
   */
  statGrid: {
    flexDirection: 'row',
    gap: theme.sp(2),
    marginTop: theme.sp(1),
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(1),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  statValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
  debugFoot: {
    marginTop: theme.space.md,
    padding: theme.space.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(120, 100, 220, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(120, 100, 220, 0.14)',
  },
  debugTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.semibold },
  debugText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: theme.fontSize.micro * 1.5 },
  ecgDetail: { gap: theme.space.sm, marginTop: theme.space.sm },
  ecgTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  ecgChart: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    padding: theme.space.sm,
  },
  ecgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  ecgCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  ecgLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  ecgValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  ecgBtn: {
    marginTop: theme.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.purpleBtn, // v16：白字按钮最浅紫上限 4.51
  },
  ecgBtnBusy: { backgroundColor: theme.colors.ui.offTrack },
  ecgBtnLabel: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
  ecgBtnLabelBusy: { color: theme.colors.textSub },
  ecgStopBtn: {
    marginTop: theme.sp(8),
    paddingVertical: theme.sp(10),
    paddingHorizontal: theme.sp(20),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.ui.offTrack,
    borderWidth: 1,
    borderColor: theme.colors.ui.borderSoft,
  },
  ecgStopLabel: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.danger ?? theme.colors.textSub },
});
