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
import { RingBle, type RingState, type EcgReading, computeRrHrv } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import { loadCycleLog } from '../data/cycleLog';
import {
  moodFromEmotionLevel, MOOD_COLOR, MOOD_LABEL,
  getLatestForDay, onEmotionLog, ensureEmotionLogLoaded, type EmotionEntry,
  type MoodKey,
} from '../data/emotionLog';
import { buildHistorySeries, type HistoryResult } from '../lib/realSeries';
import { useDeviceModel } from '../config/deviceModel';
import { saneBodyTemp } from '../data/ringDataIsolation';
import { computeStressReport } from '../lib/stressAlgorithm';
import { healthStore, dayKey, type MetricKey as HSMetricKey, type ManualMeasurement } from '../data/healthStore';
import { dateKeyOf, startOfWeek, addDays } from '../lib/dateUtils';
import { isMonthTickDay, isYearTickMonth } from '../lib/chartAxis';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import { compareLabel } from '../lib/periodLabels';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import AllDayBarsChart, { DayBarsLegend, type DayBarSegment } from '../components/charts/AllDayBarsChart';
import TempCircadianChart, { TempBaselineLegend } from '../components/charts/TempCircadianChart';
import AxisLabels from '../components/charts/AxisLabels';
import { binByMinutes, bucketFilledCount, dayStartOf } from '../lib/timeBuckets';
import { buildTempBaseline, tempDeviationSeries, tempDeviationSummary } from '../lib/tempBaseline';
import AiAnalysis, { AiResultRow } from '../components/AiAnalysis';
import ChatSheet from '../components/ChatSheet';
import EmotionQuickRecord from '../components/EmotionQuickRecord';
import MoodBlob from '../components/MoodBlob';
import LipidTrendCard from '../components/LipidTrendCard';
import CortisolTrendCard from '../components/CortisolTrendCard';

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
  period: theme.colors.cyclePeriod,
  follicular: theme.colors.cycleFollicular,
  ovulation: theme.colors.cycleOvulation,
  luteal: theme.colors.cycleLuteal,
  unknown: theme.colors.cycleUnknown,
};

/**
 * ★ 本轮（用户）：指标详情 hero 数字下方加一段短 AI 分析（不太长），按指标语义 + 相对口径判读。
 *   覆盖身心压力 / 情绪 / 心率 / 血氧 / HRV / 疲劳 / 皮电 / 体温 / 血糖 / 血压 等常用指标，其余走通用兜底。
 */
function buildHeroAnalysis(key: string, name: string, value: number | null, range: RangeKey): string {
  const day = range === 'day';
  if (value == null) {
    return day
      ? '今天还没有足够的数据，持续佩戴后，这里会结合你的真实数据生成解读。'
      : '这一区间还没有足够的数据，多戴几天后这里会出现你的趋势解读。';
  }
  switch (key) {
    case 'stress': // 身心压力
      if (value < 30) return day ? '今天身心压力较低，状态松弛，可以放心安排强度高一点的活动。' : '这段时间身心压力整体偏低，节奏稳，保持就好。';
      if (value < 55) return day ? '今天身心压力适中，节奏平稳，按原计划来即可。' : '这段时间身心压力适中，状态平稳。';
      return day ? '今天身心压力偏重，身体在提醒你慢下来，午后找机会歇一歇。' : '这段时间身心压力偏重，记得给自己留点喘息的空间。';
    case 'emotion':
      if (value < 35) return day ? '今天情绪轻松，状态敞开，适合处理需要专注或沟通的事。' : '这段时间情绪整体轻松。';
      if (value < 60) return day ? '今天情绪平稳，没有大起大落，正常推进就好。' : '这段时间情绪平稳。';
      return day ? '今天情绪偏紧，琐事堆积让你有点绷，做点放松的事缓一缓。' : '这段时间情绪偏紧，留意给自己减压。';
    case 'hr':
      if (day) {
        if (value > 85) return `今天心率均值约 ${Math.round(value)} 次/分，偏高——今天别安排高强度训练，晚上早点休息，看明早能不能回落。`;
        if (value < 58) return `今天心率均值约 ${Math.round(value)} 次/分，静息偏低，说明心脏效率不错，恢复状态在线。`;
        return `今天心率均值约 ${Math.round(value)} 次/分，在常见静息范围内，和睡眠、压力对照着看更有意义。`;
      }
      return `这段心率均值约 ${Math.round(value)} 次/分，趋势平稳；和睡眠恢复对照着看更有意义。`;
    case 'spo2':
      return value >= 95 ? '血氧在正常区间，身体供氧充足。' : '血氧略低于 95%，先留意呼吸节奏和卧室通风；如果持续偏低，要当回事。';
    case 'hrv':
      return value >= 50
        ? `HRV ${Math.round(value)}ms，恢复和自主调节在线，适合安排有强度的训练。`
        : `HRV ${Math.round(value)}ms 偏低，身体可能还没缓过来——今晚早点放下手机，训练减量。`;
    case 'fatigue':
      if (value < 30) return '疲劳度低，精力在线，适合把难的事安排在今天。';
      if (value < 55) return '疲劳度适中，按正常节奏推进就好。';
      return '疲劳度偏高，今天别硬撑：午后歇 20 分钟，晚上提前收工。';
    case 'eda':
      return value >= 50
        ? '皮电偏高，身体处于「绷着」的状态——找 10 分钟做几组慢呼吸，或出去走一圈。'
        : '皮电平稳，身体处于放松状态。';
    case 'temp':
    case 'skinTemp':
      return '体温按相对个人基线显示，曲线形状比绝对数值更有意义。';
    case 'bloodSugar':
      return value <= 7.8 ? '餐后血糖在常见范围内，代谢平稳。' : '血糖偏高——下一餐少点精制碳水，餐后走 15 分钟有帮助。';
    case 'bpSys':
    case 'bpDia':
      return '血压按全天趋势展示，数值随测量时段波动，看整体比看单点更有意义。';
    default:
      return day ? `今天你的${name}已记录，结合长期趋势，保持现在的节奏即可。` : `这段${name}趋势已记录，保持现在的节奏即可。`;
  }
}

/**
 * ★ 本轮（用户 #246）：客观数据后再补一句夸赞 / 肯定——只在确有正向信号时给，
 * 不做评分、不用 "我们" 居高临下语气、不编造。无明显正向信号时返回 null（不渲染）。
 */
function buildPraise(key: string, name: string, value: number | null, range: RangeKey): string | null {
  if (value == null) return null;
  const day = range === 'day';
  switch (key) {
    case 'hrv':
      return value >= 50 ? '自主神经调节在线，今天身体跟得上你的节奏。' : null;
    case 'spo2':
      return value >= 95 ? '供氧一直稳稳的，身体在好好呼吸。' : null;
    case 'steps':
      return day ? `今天已记录 ${Math.round(value)} 步，身体一直在动，这很好。` : null;
    case 'sleep':
    case 'sleepScore':
      return value >= 82 ? '昨晚睡得扎实，今天的精神底子不错。' : null;
    case 'energy':
    case 'activity':
      return day ? '今天的活动量已经攒起来了，身体在持续做功。' : null;
    default:
      return null;
  }
}

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
  bands?: number[];
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
    bands: [30, 60, 80],
    sourceNote: '每根柱 = 5 分钟平均压力值，按四档分色（放松 / 正常 / 中等 / 偏高）。',
  },
  spo2: {
    key: 'spo2',
    nightFirst: true,
    sourceNote: '每根柱 = 5 分钟平均血氧。血氧主要在睡眠时段测量，白天没有数据就留白，不画假线。',
  },
  eda: {
    key: 'eda',
    sourceNote: '协议无 EDA 皮电；该视图在基础版不使用。',
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
    // ★ 2026-11-05（用户授权）：基础版无实测，改用 CortisolTrendCard 的多信号推算节律，
    //   日/周/月/年全粒度展示并明确标「推算」。此 spec 保留仅为兼容旧逻辑，详情页主图已不走它。
    measuredOnly: true,
    sourceNote: '基础版不实测皮质醇；趋势图由多信号推算，非检测值。',
  },
  skin: {
    key: 'skin',
    bands: [40, 65],
    sourceNote: '每根柱 = 5 分钟平均皮肤含水量，按档位分色（偏干 / 适中 / 润泽）。',
  },
  sns: {
    key: 'sns',
    bands: [30, 55],
    sourceNote: '每根柱 = 5 分钟平均交感神经活跃度，按档位分色。数据来自 GSR 通道的 sns 回读。',
  },
};

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * ★ 2026-11-05（用户）：压力四档（放松 / 正常 / 中等 / 偏高），与趋势图图例、区间分布一致。
 *   阈值取 STRESS_BANDS（= DAY_BAR_SPECS.stress.bands，当前 [30,60,80]）；
 *   两阈值规格（无第三阈值）时退化为 放松/正常/偏高 三档，保持兼容。
 *   返回纯数值，颜色由调用方按主题色映射。
 */
const STRESS_BANDS: number[] = (DAY_BAR_SPECS.stress?.bands as number[]) ?? [30, 55];
// 日间 / 夜间窗口（本地小时）：日间 07:00–22:59，夜间 23:00–06:59。
const isDaytime = (ts: number) => {
  const h = new Date(ts).getHours();
  return h >= 7 && h < 23;
};
export type StressDayPart = {
  avg: number | null;
  peak: number | null;
  min: number | null;
  relaxH: number;
  normalH: number;
  midH: number;
  stressH: number;
  totalMin: number;
};
function stressDaySummary(dk: string, dayStartTs: number) {
  const buckets = binByMinutes(healthStore.getIntraday('stress', dk), 5, { dayStartMs: dayStartTs });
  const th = STRESS_BANDS;
  const b0 = th[0] ?? 30, b1 = th[1] ?? b0, b2 = th[2] ?? b1;
  const classify = (v: number): 0 | 1 | 2 | 3 => (v <= b0 ? 0 : v <= b1 ? 1 : v <= b2 ? 2 : 3);
  let relaxMin = 0, normalMin = 0, midMin = 0, stressMin = 0;
  let sum = 0, cnt = 0, peak = 0, overallMin = Infinity;
  let dayRelaxMin = 0, dayNormalMin = 0, dayMidMin = 0, dayStressMin = 0;
  let daySum = 0, dayCnt = 0, dayPeak = 0, dayMin = Infinity;
  let nightRelaxMin = 0, nightNormalMin = 0, nightMidMin = 0, nightStressMin = 0;
  let nightSum = 0, nightCnt = 0, nightPeak = 0, nightMin = Infinity;
  for (const b of buckets) {
    if (b.v == null) continue;
    const day = isDaytime(b.t);
    const c = classify(b.v);
    if (c === 0) { relaxMin += 5; if (day) dayRelaxMin += 5; else nightRelaxMin += 5; }
    else if (c === 1) { normalMin += 5; if (day) dayNormalMin += 5; else nightNormalMin += 5; }
    else if (c === 2) { midMin += 5; if (day) dayMidMin += 5; else nightMidMin += 5; }
    else { stressMin += 5; if (day) dayStressMin += 5; else nightStressMin += 5; }
    sum += b.v; cnt += 1;
    if (b.v > peak) peak = b.v;
    if (b.v < overallMin) overallMin = b.v;
    if (day) { daySum += b.v; dayCnt += 1; if (b.v > dayPeak) dayPeak = b.v; if (b.v < dayMin) dayMin = b.v; }
    else { nightSum += b.v; nightCnt += 1; if (b.v > nightPeak) nightPeak = b.v; if (b.v < nightMin) nightMin = b.v; }
  }
  const part = (
    relaxH: number, normalH: number, midH: number, stressH: number,
    avg: number | null, pk: number | null, mn: number | null,
  ): StressDayPart => ({
    avg, peak: pk, min: mn, relaxH, normalH, midH, stressH,
    totalMin: relaxH * 60 + normalH * 60 + midH * 60 + stressH * 60,
  });
  return {
    hasData: cnt > 0,
    avg: cnt > 0 ? sum / cnt : null,
    peak: cnt > 0 ? peak : null,
    min: cnt > 0 ? overallMin : null,
    relaxH: relaxMin / 60, normalH: normalMin / 60, midH: midMin / 60, stressH: stressMin / 60,
    day: part(dayRelaxMin / 60, dayNormalMin / 60, dayMidMin / 60, dayStressMin / 60, dayCnt > 0 ? daySum / dayCnt : null, dayCnt > 0 ? dayPeak : null, dayCnt > 0 ? dayMin : null),
    night: part(nightRelaxMin / 60, nightNormalMin / 60, nightMidMin / 60, nightStressMin / 60, nightCnt > 0 ? nightSum / nightCnt : null, nightCnt > 0 ? nightPeak : null, nightCnt > 0 ? nightMin : null),
  };
}

/**
 * ★ 2026-10-17（用户补充：恢复力要加上）：Mira 恢复力——近 14 天滚动综合（对齐 Oura Resilience 口径）。
 * 以压力信号为主：夜间压力越低 = 恢复越好（权重 0.6），日间放松占比越高 = 承压越稳（权重 0.4）。
 * 不做认知评分，仅作身体承压/恢复状态的平实呈现。返回 0–100 评分 + 5 档等级。
 */
function stressResilience(anchor: Date, range: RangeKey): { score: number; level: string; nightAvg: number; relaxRatio: number; days: number } | null {
  // ★ 本轮（用户）：恢复力按周期真正算出不同值——
  //   日视图仍用近 14 天滚动（对齐 Oura Resilience）；周/月/年改用 rangeDayKeys 覆盖对应自然日。
  const dayKeys =
    range === 'day'
      ? Array.from({ length: 14 }, (_, i) => dateKeyOf(addDays(anchor, -i).getTime()))
      : rangeDayKeys(anchor, range);
  let nightSum = 0, nightCnt = 0, relaxSum = 0, relaxCnt = 0, days = 0;
  for (const dk of dayKeys) {
    const ds = stressDaySummary(dk, dayStartOf(new Date(dk + 'T00:00:00').getTime()));
    if (!ds.hasData) continue;
    days += 1;
    if (ds.night.avg != null) { nightSum += ds.night.avg; nightCnt += 1; }
    if (ds.day.totalMin > 0) { relaxSum += (ds.day.relaxH * 60) / ds.day.totalMin; relaxCnt += 1; }
  }
  if (days === 0) return null;
  const nightAvg = nightCnt > 0 ? nightSum / nightCnt : 50;
  const relaxRatio = relaxCnt > 0 ? relaxSum / relaxCnt : 0.5;
  const score = Math.max(0, Math.min(100, Math.round(0.6 * (100 - nightAvg) + 0.4 * (relaxRatio * 100))));
  const level = score >= 80 ? '卓越' : score >= 65 ? '强健' : score >= 50 ? '稳健' : score >= 35 ? '一般' : '受限';
  return { score, level, nightAvg: Math.round(nightAvg), relaxRatio, days };
}

/** 取 range 覆盖的自然日 dateKey 列表（周=当周 7 天 / 月=当月 / 年=当年） */
function rangeDayKeys(anchor: Date, range: RangeKey): string[] {
  const out: string[] = [];
  if (range === 'week') {
    const mon = startOfWeek(anchor);
    for (let i = 0; i < 7; i++) out.push(dateKeyOf(addDays(mon, i).getTime()));
  } else if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth(), dim = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) out.push(dateKeyOf(new Date(y, m, d).getTime()));
  } else {
    const y = anchor.getFullYear();
    for (let mo = 0; mo < 12; mo++) {
      const dim = new Date(y, mo + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) out.push(dateKeyOf(new Date(y, mo, d).getTime()));
    }
  }
  return out;
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

/* ★ 2026-10-17（用户：压力周月年对齐 Oura —— 分色柱而非连续折线）：
 * 状态型（分档）指标在周 / 月 / 年视图，改为「逐桶分色柱」：每个时间桶（周=天 / 月=天 / 年=月）
 * 一根柱，按该桶均值所属档位取色 —— 与日视图 5 分钟分色柱**共用同一套档位配色**
 * （低=灰 inkFaint / 中=琥珀 honeyCore / 高=粉 roseDeep），形态与语义从日贯穿到年，消除折线断层。
 * 柱高基于指标固定量程（默认 0–100），与日视图同尺度。 */
function RangeBarsChart({
  points, labels, range, colorOf, yMin, yMax, unit, valueFmt, showYAxis, emptyText, moodMarkers,
}: {
  points: (number | null)[];
  labels: string[];
  range: RangeKey;
  colorOf: (v: number) => string | undefined;
  yMin: number;
  yMax: number;
  unit?: string;
  valueFmt: (v: number) => string;
  showYAxis: boolean;
  emptyText: string;
  /**
   * ★ 2026-11-06（用户：「如果是周月年，每一天他要加了心情状态的话那可以在这个趋势图的图上面，
   *   就是趋势图上来标记这个某一天他加的这个情绪…放在图表上，不要放在这个身心压力趋势图这几个字的上面。」）
   *   → 逐槽心情标记：index = 数据点下标，mood = 当天最新一次自报心情。
   *   画在**绘图区顶部**（每根柱的正上方），不是标题上方。
   */
  moodMarkers?: { index: number; mood: MoodKey }[] | null;
}) {
  const [w, setW] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string; color: string } | null>(null);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yLo = yMin;
  const yHi = yMax;
  const yAt = (v: number) => {
    const c = Math.max(yLo, Math.min(yHi, Number.isFinite(v) ? v : yLo));
    return PAD_T + (1 - (c - yLo) / (yHi - yLo || 1)) * plotH;
  };
  const n = points.length;
  // ★ 2026-11-06 审查（docs/audit/04 🟡-1）：NaN 必须与 null 同等对待。
  //   旧实现只判 != null → NaN 通过 → yAt(NaN) 落到 yLo → 画出一根基线处的「假最小柱」，
  //   看起来像真实的极小值，而不是数据缺失。
  const isValid = (p: number | null): p is number => p != null && Number.isFinite(p);
  const hasData = points.some((p) => isValid(p));
  const slotW = n > 0 ? plotW / n : plotW;
  const barW = Math.max(2, slotW * 0.5);
  const barX = (i: number) => PAD_L + (i + 0.5) * slotW - barW / 2;
  const baseY = yAt(yLo);
  const wScale = W / Math.max(w, 1);
  const yTicks = [yLo, (yLo + yHi) / 2, yHi];
  const onTouch = (e: any) => {
    if (n === 0 || w === 0) return;
    const svgX = e.nativeEvent.locationX * wScale;
    let best = -1; let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const cx = PAD_L + (i + 0.5) * slotW;
      const d = Math.abs(cx - svgX);
      if (d < bestD) { bestD = d; best = i; }
    }
    const v = points[best];
    if (!isValid(v)) { setTip(null); return; }
    setTip({ x: barX(best) + barW / 2, y: yAt(v), label: labels[best] ?? '', value: valueFmt(v), color: colorOf(v) ?? mm.colors.ink });
  };
  return (
    <View style={styles.chartCard}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {showYAxis && hasData ? (
          <View style={{ width: Y_GUT, height: H, position: 'relative' }}>
            {yTicks.map((gv, k) => (
              <Text key={`y-${k}`} style={{ position: 'absolute', top: Math.max(0, yAt(gv) - 7), right: 3, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'right' }}>
                {fmtYAxis(gv)}{k === 0 && unit ? ` ${unit}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
        <View
          style={{ flex: 1 }}
          onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
          onTouchStart={onTouch}
          onTouchEnd={() => setTimeout(() => setTip(null), 2000)}
          pointerEvents="box-none"
        >
          {w > 0 ? (
            <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {yTicks.map((gv, i) => (
                <Line key={`g-${i}`} x1={PAD_L} y1={yAt(gv)} x2={W - PAD_R} y2={yAt(gv)} stroke={theme.colors.ui.borderSoft} strokeWidth={chart.lw.grid} />
              ))}
              {points.map((v, i) => {
                if (!isValid(v)) return null;
                const x = barX(i);
                const y = yAt(v);
                const h = Math.max(1, baseY - y);
                return <Rect key={`b-${i}`} x={x} y={y} width={barW} height={h} rx={2} fill={colorOf(v) ?? mm.colors.ink} />;
              })}
            </Svg>
          ) : null}
          {/* ★ 2026-11-06（用户）：周/月/年每日心情标记画在**图表上**（柱顶上方），不在标题上方。
              MoodBlob 是 RN View（带动画），不能进 Svg → 用绝对定位叠在绘图区上。 */}
          {w > 0 && moodMarkers && moodMarkers.length > 0
            ? moodMarkers.map((mk) => {
                if (mk.index < 0 || mk.index >= n) return null;
                const cx = PAD_L + (mk.index + 0.5) * slotW;
                const px = (cx / W) * w;
                return (
                  <View
                    key={`mood-${mk.index}`}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: px - theme.sp(9),
                      top: Math.max(0, PAD_T - theme.sp(11)),
                      width: theme.sp(18),
                      height: theme.sp(18),
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MoodBlob mood={mk.mood} size={theme.sp(16)} variant={1} />
                  </View>
                );
              })
            : null}
          {tip && w > 0 ? (() => {
            const TW = 96, TH = 56;
            let tipX = tip.x - TW / 2;
            if (tipX < 4) tipX = 4;
            if (tipX + TW > w - 4) tipX = w - 4 - TW;
            const tipY = Math.max(0, tip.y - TH - 12);
            const triX = tip.x - 8;
            return (
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: H }}>
                <View style={{ position: 'absolute', left: tipX, top: tipY, width: TW, height: TH, backgroundColor: '#FFFFFF', borderRadius: theme.radius.sm, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, paddingHorizontal: 10, paddingVertical: 8 }}>
                  <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 2 }}>{tip.label || '数值'}</Text>
                  <Text style={{ fontSize: theme.fontSize.body, fontWeight: '700', color: tip.color }}>{tip.value}</Text>
                </View>
                <View style={{ position: 'absolute', left: triX, top: tipY + TH, width: 0, height: 0, backgroundColor: 'transparent', borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF' }} />
              </View>
            );
          })() : null}
        </View>
      </View>
      {!hasData ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : null}
      {/* ★ 2026-11-05：只渲染可见刻度，按槽位比例绝对定位 + 边界 clamp，
          不再用 space-between 把末标签顶到卡片右缘被裁、也不让空标签挤压可见标签。 */}
      <AxisLabels
        labels={labels}
        visible={(t) => axisTickVisible(range, t)}
        padLeft={showYAxis ? Y_GUT : PAD_L}
        padRight={PAD_R}
      />
    </View>
  );
}

export default function MetricDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = route.params as Params;
  // ★ 2026-11-05（用户）：身心压力详情页复用「情绪压力」页的「记录此刻心情」胶囊，
  //   记录完成后把对应表情显示在身心压力趋势图的顶部。数据源与情绪页完全同一套 emotionLog。
  const [latestMood, setLatestMood] = useState<EmotionEntry | null>(null);
  useEffect(() => {
    if (params.key !== 'stress') return;
    const refresh = () => {
      try { setLatestMood(getLatestForDay(dayKey(Date.now()))); } catch { setLatestMood(null); }
    };
    void ensureEmotionLogLoaded().then(refresh);
    refresh();
    return onEmotionLog(refresh);
  }, [params.key]);

  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  // 默认打开「日」视图：洞察页卡片今日段已与日视图同源同频，点卡片直接落到对得上的今日趋势。
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  // ★ 2026-10-10（用户）：HRV 日视图分「夜间 / 日间」两段展示（见下方 hrvDay 注释）
  const [hrvPart, setHrvPart] = useState<'night' | 'day'>('night');
  // ★ 2026-10-17（用户：日夜参考心率，做个 tab 区分就行）：压力日视图分「日间 / 夜间」两段，
  //   与 HRV 同套 partRow 控件 + mutedRanges 静音非选中段。默认日间（压力主故事在白天）。
  const [stressPart, setStressPart] = useState<'day' | 'night'>('day');
  // ★ 2026-11-05：基础版体温只用当前戒指日均，不读 HK18 时期写入的 healthStore 历史
  const { model: deviceModel } = useDeviceModel();
  const isBaseLayout = deviceModel.id === 'BASE_UI';
  // ★ 2026-10-16：体温详情页双 tab（Pro 保留；基础版无独立皮肤温度流，见 isTempDay 的门禁）
  const [tempSignal, setTempSignal] = useState<'temp' | 'skinTemp'>('temp');
  const [cycleLog, setCycleLog] = useState<ReturnType<typeof loadCycleLog> extends Promise<infer T> ? T : null>(null);
  const [w, setW] = useState(0);
  // ★ tooltip 状态：点击图表时显示的白色详情框
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string; color: string } | null>(null);
  // ★ 2026-10-16：详情页内 AI 问答入口（与精力/情绪详情页同款 ChatSheet 侧滑面板）
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = useCallback((q: string) => { setChatQuestion(q); setChatVisible(true); }, []);
  const isEcg = params.key === 'ecg';
  // ★ 2026-10-16（续 6）：血脂四项详情页主图 = 四项同图趋势（LipidTrendCard），替换通用单指标图
  const isLipid = ['cholesterol', 'triglyceride', 'hdl', 'ldl'].includes(params.key);
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
  // ★ 2026-10-16（用户：「血脂详情页的历史测量记录默认收起来」）：历史测量列表默认折叠，点头标题展开
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const requestedForRef = useRef<string | null>(null);
  // 锚点是否为「今天」之外：只有历史日才需要（且值得）自动触发 backfill
  const anchorKey = dateKeyOf(anchor.getTime());
  // ★ 2026-11-04（用户：解读融合）：心率峰值/静息并入 hero 分析（原 HrInsight 卡数据源，顶层调用）
  const hrZoneExtra = useHrZoneStats(anchorKey, mhrFromProfileAge().mhr);
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

  const series: HistoryResult = useMemo(() => {
    const built = buildHistorySeries(params.key, range, ring, cycleLog, anchor);
    // ★ 2026-11-05（用户：卡片和详情对不齐、详情页体温 39℃）：
    //   buildHistorySeries 一律读 healthStore，那里混着 HK18 时期写入的温度值（39℃ 即来自此）。
    //   基础版体温改为只读「当前戒指」的云端日均体温，与洞察页卡片同源、同数值。
    if (isBaseLayout && params.key === 'temp') {
      const cur = saneBodyTemp(
        (ring as any)?.metrics?.temp ?? (ring as any)?.daily?.temp ?? null,
      );
      return {
        ...built,
        continuous: false,
        tPoints: undefined,
        points: cur != null ? [cur] : [],
        latest: cur,
        avg: cur,
        hi: cur,
        lo: cur,
        multiDay: false,
        note: cur != null
          ? '当前戒指只回读日均体温（℃），没有逐点温度流，也没有独立皮肤温度；与洞察页卡片同源。'
          : '当前戒指尚未回读体温；不使用其它戒指的历史值。',
      };
    }
    return built;
  }, [params.key, range, ring, cycleLog, anchor, isBaseLayout]);

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
  // ★ 2026-11-05：基础版没有逐点温度样本，也不该用 HK18 历史画「相对个人基线」曲线 → 关掉该视图与双 tab
  const isTempDay = !isEcg && !isBaseLayout && range === 'day' && params.key === 'temp';
  const tempDay = useMemo(() => {
    if (!isTempDay) return null;
    const dk = dateKeyOf(anchor.getTime());
    // ★ 2026-10-16：双 tab —— 体温 / 皮肤温度，基线按各自信号独立构建
    const baseline = buildTempBaseline({ endDayKey: dk, metricKey: tempSignal });
    const { dev, abs } = tempDeviationSeries(dk, baseline, tempSignal);
    return { dev, abs, baseline, summary: tempDeviationSummary(dev) };
  }, [isTempDay, anchor, tempSignal]);

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
  // ★ 2026-10-17：分档（状态型）指标在周/月/年视图 → 逐桶分色柱（替代通用折线）
  const isSpecRange = !isEcg && !!spec?.bands && range !== 'day';
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

  // 状态型指标的分档配色：优先 spec 自定义（情绪按方向），否则低/中/高三档。
  // 始终返回一个函数（即便 spec 无 bands/colorOf 也回退到默认三档），避免调用处类型歧义。
  const specColorOf = useMemo(() => {
    if (spec?.colorOf) return spec.colorOf;
    const bands = spec?.bands ?? [30, 55];
    const [b0, b1, b2] = bands;
    // ★ 2026-11-05（用户：压力四档 放松/正常/中等/偏高）：四档指标用 绿/蓝/琥珀/粉 四色；
    //   三档指标（疲劳/皮肤含水量/交感）保持原 绿/琥珀/粉 三色，不引入第四色相。
    if (bands.length >= 4) {
      return (v: number) =>
        v <= (b0 ?? 30) ? mm.colors.limeMid
        : v <= (b1 ?? 60) ? mm.colors.skyMid
        : v <= (b2 ?? 80) ? mm.colors.honeyCore
        : mm.colors.roseDeep;
    }
    const lo = b0 ?? 30, hi = b1 ?? 55;
    return (v: number) => (v <= lo ? mm.colors.limeMid : v <= hi ? mm.colors.honeyCore : mm.colors.roseDeep);
  }, [spec]);
  // ★ 2026-10-17（对齐 Oura Daytime Stress 的「紧张时长 / 恢复时长」汇总）：日视图按档位把有数据的桶折算成小时。
  //   每桶 = binMin 分钟（默认 5）；v<lo=放松（恢复），v>hi=紧张。
  const specZoneHours = useMemo(() => {
    if (!specDay || specDay.blocked || !spec?.bands) return null;
    const bands = spec.bands;
    const [b0, b1, b2] = bands;
    const BIN = spec.binMin ?? 5;
    // ★ 2026-11-05（用户：压力四档）：按四档折算各档时长（放松/正常/中等/偏高）
    const inPart = (t: number) => {
      const h = new Date(t).getHours();
      return stressPart === 'day' ? h >= 7 && h < 23 : h < 7 || h >= 23;
    };
    let relaxMin = 0, normalMin = 0, midMin = 0, stressMin = 0;
    for (const b of specDay.buckets ?? []) {
      if (b.v == null || !inPart(b.t)) continue;
      const v = b.v;
      if (v <= (b0 ?? 30)) relaxMin += BIN;
      else if (v <= (b1 ?? 60)) normalMin += BIN;
      else if (v <= (b2 ?? 80)) midMin += BIN;
      else stressMin += BIN;
    }
    return { relax: relaxMin / 60, normal: normalMin / 60, mid: midMin / 60, stress: stressMin / 60 };
  }, [specDay, spec, stressPart]);
  // ★ 2026-10-17（用户：日夜参考心率做 tab）：按 stressPart 静音非选中段（日间=07:00–23:00，夜间=23:00–07:00）
  const stressMutedRanges = useMemo<[number, number][]>(() => {
    const s = dayStartOf(anchor.getTime());
    const H7 = 7 * 3_600_000, H23 = 23 * 3_600_000, D = 86_400_000;
    return stressPart === 'day'
      ? [[s, s + H7], [s + H23, s + D]]
      : [[s + H7, s + H23]];
  }, [anchor, stressPart]);
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
  // ★ 2026-10-16：尿酸两个入口 key 都收——洞察页传 'ua'，BloodComponentPanel 传 'uricAcid'
  const MANUAL_KEYS = ['triglyceride', 'hdl', 'ldl', 'cholesterol', 'bloodFat', 'uricAcid', 'ua', 'bodyComposition'];
  const showManualList = MANUAL_KEYS.includes(params.key);
  const manualHsKeyMap: Record<string, HSMetricKey> = {
    triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl',
    cholesterol: 'cholesterol', bloodFat: 'cholesterol',
    uricAcid: 'ua', ua: 'ua', bloodSugar: 'glucose', glucose: 'glucose',
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
  // ★ 2026-10-27（用户）：压力（身心压力）页的 hero 必须与首页「身心压力」卡同源 ——
  //   用 computeStressReport().score（SDK 压力 /12×100，0–100），而非原始 0–12 序列值（series.latest）。
  //   否则外卡显示 14/100、详情显示 1.x（原始值），口径打架。
  const isStress = params.key === 'stress';
  // ★ 基础版无皮质醇实测 → 详情页改用「推算节律」趋势卡（日/周/月/年），不走实测柱状图
  const isCortisol = params.key === 'cortisol';
  const stressScore = isStress ? (() => { try { return computeStressReport(anchor.getTime()).score; } catch { return null; } })() : null;
  // ★ 2026-11-06（用户）：压力 hero 右侧加定性档位（放松/正常/中等/偏高）+ 较昨日升降
  const stressYday = isStress ? (() => {
    try { const d = new Date(anchor.getTime()); d.setDate(d.getDate() - 1); return computeStressReport(d.getTime()).score; } catch { return null; }
  })() : null;
  const stressDeltaPct = isStress && typeof stressScore === 'number' && stressYday != null && stressYday !== 0
    ? Math.round(((stressScore - stressYday) / Math.abs(stressYday)) * 100)
    : 0;
  // 档位词与四档分色（specColorOf 四档）完全同源：放松=limeMid / 正常=skyMid / 中等=honeyCore / 偏高=roseDeep
  const stressQualIdx = typeof stressScore === 'number'
    ? (stressScore <= 30 ? 0 : stressScore <= 60 ? 1 : stressScore <= 80 ? 2 : 3)
    : -1;
  const STRESS_QUAL_WORDS = ['放松', '正常', '中等', '偏高'];
  const STRESS_QUAL_COLORS = [mm.colors.limeMid, mm.colors.skyMid, mm.colors.honeyCore, mm.colors.roseDeep];
  const stressQual = isStress && stressQualIdx >= 0 ? STRESS_QUAL_WORDS[stressQualIdx] : null;
  const stressQualColor = stressQualIdx >= 0 ? STRESS_QUAL_COLORS[stressQualIdx] : theme.colors.textSub;
  // 顶部聚合值：日视图显示当日最新读数；周/月/年显示区间平均（按需求：周月=周月均值，年=年均）
  const heroVal = isStress ? stressScore : (range === 'day' ? series.latest : series.avg);
  const heroUnit = isStress ? '/100' : (series.unit || undefined);
  // ★ 本轮（用户）：数字下方短 AI 分析（按指标语义判读，不太长）
  let heroAnalysis = buildHeroAnalysis(params.key, params.name, typeof heroVal === 'number' ? heroVal : null, range);
  // ★ 本轮（用户 #246）：客观数据后再补一句夸赞 / 肯定（仅正向信号时非空）
  const praiseLine = buildPraise(params.key, params.name, typeof heroVal === 'number' ? heroVal : null, range);
  // ★ 2026-11-04（用户：解读融合，统一规则 = hero 数字下一句分析，不再出独立解读卡）：
  // ① 体温日视图 —— 用基线偏离分析替代独立「体温解读」卡（TempAiCard 已删，信息并入这里）
  if (isTempDay && tempDay) {
    heroAnalysis = buildTempInsightText(tempDay, tempSignal) ?? heroAnalysis;
  }
  // ② 心率日视图 —— 峰值/静息并入同一句，替代独立「心率解读」卡（HrInsight 已删）
  if (params.key === 'hr' && range === 'day' && hasData) {
    const pk = hrZoneExtra.peak != null ? Math.round(hrZoneExtra.peak) : null;
    const rst = hrZoneExtra.resting != null ? Math.round(hrZoneExtra.resting) : null;
    if (pk != null || rst != null) {
      heroAnalysis = `${heroAnalysis.replace(/。\s*$/, '')}。峰值 ${pk ?? '—'} bpm，静息约 ${rst ?? '—'} bpm。`;
    }
  }
  // 心率 hero 融合用的当日峰值/静息（hook 必须顶层无条件调用）

  // ★ 本轮（用户）：周/月/年视图 → 与「上一周期」对比（相比上周/上个月/去年 上升/下降多少）。
  //   统一所有指标详情页 hero 卡格式：日视图保持「较区间首点」，周月年显示「较上周/较上个月/较去年」。
  //   ★ 2026-11-03：标签词表收敛到 lib/periodLabels（唯一真相源），不再各页手写。
  const prevLabel = range === 'day' ? '' : compareLabel(range);
  const prevAnchor = useMemo(() => {
    if (range === 'day') return anchor;
    const a = new Date(anchor.getTime());
    if (range === 'week') a.setDate(a.getDate() - 7);
    else if (range === 'month') a.setMonth(a.getMonth() - 1);
    else if (range === 'year') a.setFullYear(a.getFullYear() - 1);
    return a;
  }, [anchor, range]);
  const prevSeries = useMemo(() => {
    if (range === 'day') return null;
    try { return buildHistorySeries(params.key, range, ring, cycleLog, prevAnchor); } catch { return null; }
  }, [params.key, range, ring, cycleLog, prevAnchor]);
  // ★ 压力（身心压力）用 computeStressReport 0–100 口径（与 heroVal 同源）；其余用上一周期区间均值
  const prevVal = isStress
    ? (() => { try { return computeStressReport(prevAnchor.getTime()).score; } catch { return null; } })()
    : (prevSeries?.avg ?? null);
  const prevDeltaPct =
    typeof heroVal === 'number' && prevVal != null && prevVal !== 0
      ? Math.round(((heroVal - prevVal) / Math.abs(prevVal)) * 100)
      : 0;
  // ★ 本轮（用户）：底部图表统一标题「XXX趋势图」（身心压力 → 身心压力趋势图，其余同理）
  const chartTitle = `${params.name}趋势图`;
  /** ★ 身心压力趋势图顶部：当天最近一次自报心情的表情 + 标签（没记录则不渲染）。 */
  // ★ 2026-11-05（用户）：记录心情后只在图表顶部展示表情 icon，不再压一句说明文字
  // ★ 2026-11-06（用户）：周/月/年 → 心情标记画在**图表上**（逐日），不再在标题上方单独一条。
  //   日视图保留顶部单条（当天只有一个时刻的心情）。
  const moodOnChart = isStress && latestMood && range === 'day' ? (
    <View style={styles.moodStrip} pointerEvents="none">
      <MoodBlob mood={latestMood.mood} size={theme.sp(26)} variant={1} />
      <Text style={styles.moodStripTxt}>今日记录的心情</Text>
    </View>
  ) : null;

  /** ★ 2026-11-06（用户）：周/月/年逐日心情标记（index 对应 series.points 下标）。
   *  每天取当天最新一次自报心情；无记录则该槽不标。 */
  const rangeMoodMarkers = useMemo(() => {
    if (!isStress || range === 'day' || !isSpecRange) return null;
    const out: { index: number; mood: MoodKey }[] = [];
    try {
      const dks = rangeDayKeys(anchor, range);
      dks.forEach((dk, i) => {
        const e = getLatestForDay(dk);
        if (e) out.push({ index: i, mood: e.mood });
      });
    } catch { return null; }
    return out.length > 0 ? out : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStress, range, isSpecRange, anchor.getTime()]);

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
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.bgTop}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fontSize.h2} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{params.name}</Text>
            {params.dimension ? <Text style={styles.sub}>{params.unit}</Text> : null}
          </View>
          {/* ★ 2026-11-05（用户）：详情页右上角不显示「真实数据 / 实时」徽标，标题区保持干净 */}
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
              {/* ★ 本轮：title 移到数字上方（今日/近期 + 指标名） */}
              <Text style={styles.heroTitle}>{range === 'day' ? `今日${params.name}` : `近期${params.name}`}</Text>
              <View style={styles.hero}>
                <Text style={styles.heroVal}>{fmtVal(heroVal)}</Text>
                {heroUnit ? <Text style={styles.heroUnit}>{heroUnit}</Text> : null}
                {/* ★ 2026-11-06（用户）：压力卡右侧补定性档位 + 较昨日升降（与其余指标 hero 同款 delta 位） */}
                {isStress && stressQual ? (
                  <Text style={[styles.stressQual, { color: stressQualColor }]}>{stressQual}</Text>
                ) : null}
                {isStress && range === 'day' && stressDeltaPct !== 0 ? (
                  <Text style={[styles.delta, stressDeltaPct > 0 ? styles.up : styles.down]}>
                    {stressDeltaPct > 0 ? '↑' : '↓'} {Math.abs(stressDeltaPct)}% · 较昨日
                  </Text>
                ) : null}
                {range === 'day' && hasData && !isStress && deltaPct !== 0 && series.kind !== 'cycle' && (
                  <Text style={[styles.delta, deltaPct > 0 ? styles.up : styles.down]}>
                    {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较区间首点
                  </Text>
                )}
                {range !== 'day' && hasData && prevDeltaPct !== 0 && (
                  <Text style={[styles.delta, prevDeltaPct > 0 ? styles.up : styles.down]}>
                    {prevDeltaPct > 0 ? '↑' : '↓'} {Math.abs(prevDeltaPct)}% · {prevLabel}
                  </Text>
                )}
              </View>
              {/* ★ 本轮：数字下方短 AI 分析 */}
              {hasData ? <Text style={styles.heroAnalysis}>{heroAnalysis}</Text> : null}
              {/* ★ 本轮（用户 #246）：客观数据后再补一句夸赞 / 肯定 */}
              {hasData && praiseLine ? <Text style={styles.heroPraise}>{praiseLine}</Text> : null}
              {/* ★ 2026-11-03（用户）：区间解读文字从页面底部上移——与上面那句分析合成一块，页面下部不再单独展示
                  ★ 2026-11-06（用户）：压力页去掉「X 为今日真实测量」注脚（没必要写） */}
              {!isEcg && !isLipid && hasData && series.note && !(isStress && (series.note ?? '').includes('真实测量')) ? (
                <View style={{ marginTop: theme.sp(2), paddingTop: theme.sp(2), borderTopWidth: 1, borderTopColor: theme.colors.cardBorder }}>
                  <Text style={styles.heroNote}>{series.note}</Text>
                </View>
              ) : null}
            </View>
          </Card>
        )}

        {/* ★ 2026-11-03（用户）：解读内容统一上移——紧跟总体数据卡，不再放页面底部单独卡片。
            心率/尿酸/血脂的规则解读（原 InsightBanner 在页面底部各 section 末尾）提到这里。 */}

        {/* ★ 2026-10-10（用户）：心率日视图 = Oura 风格全天柱状小条（5 分钟一点 / 30 分钟一格刻度） */}
        {isHrDayBars && hrBars ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
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
          <>
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
            {/* ★ 2026-10-16：体温 / 皮肤温度 双 tab */}
            <View style={styles.partRow}>
              {(['temp', 'skinTemp'] as const).map((sig) => {
                const on = tempSignal === sig;
                return (
                  <TouchableOpacity
                    key={sig}
                    onPress={() => setTempSignal(sig)}
                    style={[styles.partBtn, on && styles.partBtnOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.partBtnText, on && styles.partBtnTextOn]}>
                      {sig === 'temp' ? '体温' : '皮肤温度'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.tempHeadRow}>
              <Text style={styles.tempHeadLab}>
                {tempSignal === 'skinTemp' ? '皮肤温度·相对个人基线' : '相对个人基线'}
              </Text>
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
              {tempSignal === 'skinTemp'
                ? '皮肤温度按「相对你自己的基线」显示，不是绝对温度——皮肤温噪声更大、受环境干扰更明显，曲线形状才有意义。'
                : '体温按「相对你自己的基线」显示，不是绝对体温——白天的体温会被吃喝、运动、环境干扰，曲线形状才有意义（黄体期通常整体上移约 +0.3℃）。'}
            </Text>
          </View>
          </>
        ) : null}

        {/* ★ 2026-11-05：基础版体温只有「日均体温」一路真实数据，与洞察页卡片同源 */}
        {isBaseLayout && params.key === 'temp' && range === 'day' ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>体温数据来源</Text>
            <Text style={styles.chartNote}>
              这枚戒指通过日常数据回读「日均体温」（℃）。协议里体温与体表温度是同一条测量链路的两个字段，
              没有独立的皮肤温度数据流，也没有皮电 EDA。这里与洞察页体温卡显示的是同一个数值；
              尚未同步新数据时显示最近一次日均，不补其它戒指的历史值。
            </Text>
          </View>
        ) : null}

        {/* ★ 2026-10-10（用户）：HRV 日视图 = 夜间 / 日间 分两段展示（Oura 口径：HRV 的意义集中在睡眠期） */}
        {isHrvDay && hrvDay ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
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
        {isSpecDay && spec && specDay && !isCortisol ? (
          <View style={styles.chartCard}>
            <View style={styles.partRow}>
              <Text style={[styles.chartTitle, styles.titleFlex]}>{chartTitle}</Text>
              {!isStress && (
                <Text style={styles.specCount}>
                  {specDay.blocked ? '无实测数据'
                    : `${specDay.filled ?? 0}/${specDay.total ?? 0} 有数据`}
                </Text>
              )}
            </View>
            {/* ★ 2026-10-17（用户：日夜参考心率，做个 tab 区分就行）：压力日视图 日间/夜间 分段控件 */}
            <View style={styles.partRow}>
              {(['day', 'night'] as const).map((p) => {
                const on = stressPart === p;
                return (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setStressPart(p)}
                    style={[styles.partBtn, on && styles.partBtnOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.partBtnText, on && styles.partBtnTextOn]}>
                      {p === 'day' ? '日间' : '夜间'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
                  mutedRanges={stressMutedRanges}
                  yMin={params.key === 'spo2' ? 85 : params.key === 'emotion' ? -10 : undefined}
                  height={chart.plot.l}
                  moodMarker={isStress && latestMood ? { ts: latestMood.t, mood: latestMood.mood } : null}
                />
                {/* ★ 2026-10-12（用户拍板：统一成 平静/开心/兴奋/压力/难过）—— 情绪图例 = 「情绪记录」
                    点阵的同一套五档顺序（DOT_LEGEND），色值一律取 MOOD_COLOR，跨页完全一致。
                    睡眠/清醒/活动是心率类图的分段（segmentOf），情绪/压力是状态型指标不用那套
                    → 压力按「放松/正常/中等/偏高」四档着色（2026-11-05 用户：四档），图例跟着换成同色相。 */}
                <DayBarsLegend
                  showMean={false}
                  items={
                    params.key === 'emotion' ? [
                      { color: MOOD_COLOR.calm, label: '平静' },
                      { color: MOOD_COLOR.happy, label: '开心' },
                      { color: MOOD_COLOR.excited, label: '兴奋' },
                      { color: MOOD_COLOR.stressed, label: '压力' },
                      { color: MOOD_COLOR.sad, label: '难过' },
                    ] : params.key === 'stress' ? [
                      { color: mm.colors.limeMid, label: '放松' },
                      { color: mm.colors.skyMid, label: '正常' },
                      { color: mm.colors.honeyCore, label: '中等' },
                      { color: mm.colors.roseDeep, label: '偏高' },
                    ] : undefined
                  }
                />
                <Text style={styles.chartNote}>
                  {spec!.sourceNote}
                  {specDay.derived ? '（当日历史数据为推算值）' : ''}
                  {stressPart === 'night'
                    ? ' 当前为夜间视图（23:00–07:00），日间时段已隐藏。'
                    : ' 当前为日间视图（07:00–23:00），夜间时段已隐藏。'}
                </Text>
                {/* ★ 2026-10-17（对齐 Oura Daytime Stress 的「紧张 / 恢复时长」汇总）：
                    按档位把有数据的桶折算成小时，与日视图同套档位配色（低=灰 / 高=粉）。 */}
                {specZoneHours && (specZoneHours.relax > 0 || specZoneHours.normal > 0 || specZoneHours.mid > 0 || specZoneHours.stress > 0) ? (
                  <View style={styles.zoneSummary}>
                    <View style={styles.zoneItem}>
                      <View style={[styles.zoneDot, { backgroundColor: mm.colors.limeMid }]} />
                      <Text style={styles.zoneText}>放松 <Text style={{ fontWeight: theme.weight.semibold }}>{specZoneHours.relax.toFixed(1)}h</Text></Text>
                    </View>
                    <View style={styles.zoneItem}>
                      <View style={[styles.zoneDot, { backgroundColor: mm.colors.skyMid }]} />
                      <Text style={styles.zoneText}>正常 <Text style={{ fontWeight: theme.weight.semibold }}>{specZoneHours.normal.toFixed(1)}h</Text></Text>
                    </View>
                    <View style={styles.zoneItem}>
                      <View style={[styles.zoneDot, { backgroundColor: mm.colors.honeyCore }]} />
                      <Text style={styles.zoneText}>中等 <Text style={{ fontWeight: theme.weight.semibold }}>{specZoneHours.mid.toFixed(1)}h</Text></Text>
                    </View>
                    <View style={styles.zoneItem}>
                      <View style={[styles.zoneDot, { backgroundColor: mm.colors.roseDeep }]} />
                      <Text style={styles.zoneText}>偏高 <Text style={{ fontWeight: theme.weight.semibold }}>{specZoneHours.stress.toFixed(1)}h</Text></Text>
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {/* ★ 2026-10-17（用户：压力周月年对齐 Oura —— 分色柱而非连续折线）：
            分档（状态型）指标在周/月/年视图，逐桶分色柱，与日视图同套档位配色与语义。 */}
        {isSpecRange && spec ? (
          <View style={styles.chartCard}>
            {/* ★ 2026-11-06（用户：「放在图表上，不要放在这个身心压力趋势图这几个字的上面」）
                → 周/月/年视图不再在标题上方单独一条心情条；心情逐日画进图表柱顶（moodMarkers）。 */}
            <Text style={styles.chartTitle}>{chartTitle}</Text>
            <RangeBarsChart
              points={series.points}
              labels={axisLabels}
              range={range}
              colorOf={specColorOf}
              yMin={params.yMin ?? 0}
              yMax={params.yMax ?? 100}
              unit={series.unit}
              valueFmt={fmtVal}
              showYAxis={!hideYAxis}
              emptyText={ring.status !== 'connected' ? '连接戒指以加载历史数据' : backfilling ? '正在补拉历史数据…' : '当前范围内暂无真实测量数据'}
              moodMarkers={rangeMoodMarkers}
            />
          </View>
        ) : null}

        {/* ★ 2026-11-05（用户：「底层有没有自己的算法推算皮质醇节律？可以出日周月年趋势图」）：
            基础版不实测皮质醇（health_glance 0 条），用项目自有 cortisolProxy 多信号加权推算，
            组件内全链路标注「推算」，无真实信号的时间窗留白、不插值。 */}
        {isCortisol ? <CortisolTrendCard range={range} anchor={anchor} title={chartTitle} /> : null}

        {/* ★ 2026-10-17：压力——分析「数据卡片」嵌在日/周/月/年详情里（图表下方），与 AI 文字解读并行 */}
        {params.key === 'stress' && (isSpecDay || isSpecRange) ? (
          <StressStatCards anchor={anchor} range={range} part={stressPart} />
        ) : null}

        {/* ★ 2026-10-16（续 6）：血脂四项详情页主图 = 四项同图趋势（TC/TG/HDL/LDL 共享 0–10 坐标轴，随顶部日/周/月/年切换） */}
        {isLipid ? <LipidTrendCard range={range} anchor={anchor} title="血脂四项趋势图" /> : null}

        {/* ★ 2026-11-05（用户：心率 / 心率变异性 周月年也展示成柱状图，与日视图同款） */}
        {!isEcg && (params.key === 'hr' || params.key === 'hrv') && range !== 'day' ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
            <RangeBarsChart
              points={series.points}
              labels={axisLabels}
              range={range}
              colorOf={() => color}
              yMin={yLo}
              yMax={yHi}
              unit={series.unit}
              valueFmt={fmtVal}
              showYAxis={!hideYAxis}
              emptyText={ring.status !== 'connected' ? '连接戒指以加载历史数据' : backfilling ? '正在补拉历史数据…' : '当前范围内暂无真实测量数据'}
            />
          </View>
        ) : null}

        {/* ★ 2026-11-06（用户：「血氧卡片详情的周月年也展示柱状图和趋势图一起吧」）：
            血氧周/月/年 = 柱状图（上方，与日视图同款分柱口径）+ 趋势图（下方通用折线卡）双图并存。
            血氧量程固定 85–100（与日视图一致），柱色用指标主色。 */}
        {!isEcg && params.key === 'spo2' && range !== 'day' ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{params.name}柱状分布</Text>
            <RangeBarsChart
              points={series.points}
              labels={axisLabels}
              range={range}
              colorOf={() => color}
              yMin={params.yMin ?? 85}
              yMax={params.yMax ?? 100}
              unit={series.unit}
              valueFmt={fmtVal}
              showYAxis={!hideYAxis}
              emptyText={ring.status !== 'connected' ? '连接戒指以加载历史数据' : backfilling ? '正在补拉历史数据…' : '当前范围内暂无真实测量数据'}
            />
          </View>
        ) : null}

        {!isEcg && !isLipid && !isHrDayBars && !isTempDay && !isHrvDay && !isSpecDay && !isSpecRange && !isCortisol && params.key !== 'hr' && params.key !== 'hrv' && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>{chartTitle}</Text>
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
                  <View style={{ position: 'absolute', left: tipX, top: tipY, width: TW, height: TH, backgroundColor: '#FFFFFF', borderRadius: theme.radius.sm, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, paddingHorizontal: 10, paddingVertical: 8 }}>
                    <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 2 }}>{tip.label}</Text>
                    <Text style={{ fontSize: theme.fontSize.body, fontWeight: '700', color: tip.color }}>{tip.value}</Text>
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

          {/* X 轴标签 ★ 2026-11-05：统一走 AxisLabels（绝对定位 + clamp），修末标签被裁 / 密槽互相遮挡 */}
          <AxisLabels
            labels={axisLabels}
            visible={(t) => axisTickVisible(range, t)}
            mode={axisLabels.length > 8 ? 'slot' : 'edge'}
            padLeft={hideYAxis ? PAD_L : Y_GUT}
            padRight={PAD_R}
          />
        </View>
        )}

        {/* ★ 2026-11-03：解读已上移合并进顶部总体数据卡（hero），此处不再展示 */}

        {/* 历史测量列表（手动测量类指标才显示，按时间倒序）
            ★ 2026-10-16（用户：「血脂详情页的历史测量记录默认收起来」）：改为可折叠区块，默认收起，
            点头标题展开/收起；收起时不占列表高度，让四项趋势主图更靠上。 */}
        {showManualList && (
          <View style={{ marginTop: theme.space.md }}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setHistoryExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: historyExpanded }}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: historyExpanded && manualList.length > 0 ? theme.space.sm : 0,
              }}
            >
              <Text style={{
                fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold,
                color: theme.colors.textTitle,
              }}>历史测量记录{manualList.length > 0 ? `（${manualList.length}）` : ''}</Text>
              <View style={{ transform: [{ rotate: historyExpanded ? '90deg' : '0deg' }] }}>
                <Icon name="chevronRight" size={theme.fontSize.card} color={theme.colors.textSub} />
              </View>
            </TouchableOpacity>
            {historyExpanded && (
              manualList.length === 0 ? (
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
                  const mm2 = String(d.getMinutes()).padStart(2, '0');
                  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm2}`;
                  const valStr = params.key === 'uricAcid' || params.key === 'ua' ? m.v.toFixed(1) : m.v.toFixed(2);
                  return (
                    <View key={`${m.t}-${i}`} style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: theme.space.sm,
                      paddingHorizontal: theme.space.md,
                      // ★ mira-ocean（2026-10-17）：淡紫 → 玻璃白
                      backgroundColor: i === 0 ? 'rgba(255,255,255,0.10)' : 'transparent',
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
              )
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
        {/* ★ 2026-10-16：血氧页——呼吸暂停（OSAHS）分析（读设备血氧历史，进入页面自动拉取） */}
        {params.key === 'spo2' ? <OxygenApneaSection /> : null}
        {/* ★ 2026-10-16：HRV 页——Lorenz 散点 + RR 间期时域分析（读设备 RR 历史，进入页面自动拉取） */}
        {params.key === 'hrv' ? <HrvLorenzSection /> : null}
        {/* ★ 2026-10-16：血糖页——测量类型 / 风险等级 / 参考区间（戒指健康一览回传）。
            注意：洞察页传入的 key 是 'bloodSugar'，需同时命中。 */}
        {params.key === 'glucose' || params.key === 'bloodSugar' ? <GlucoseSummaryCard /> : null}
        {/* ★ 2026-10-16：心率页——心率区间（MHR 五段环）+ 规则 AI 分析 */}
        {params.key === 'hr' ? <HrZoneSection anchor={anchor} openChat={openChat} /> : null}
        {/* ★ 2026-10-16：尿酸页——参考区间条 + 分级 + 规则 AI 分析。
            两个入口 key 都命中：洞察页 'ua' / BloodComponentPanel 'uricAcid' */}
        {params.key === 'ua' || params.key === 'uricAcid' ? <UaReferenceCard anchor={anchor} openChat={openChat} /> : null}
        {/* ★ 2026-10-16：血脂页（四项任一）——血脂四项汇总 + 规则 AI 分析。
            注意：四项同图的「日/周/月/年」趋势卡（LipidTrendCard）已作为主图渲染在页面顶部（续 6）。 */}
        {['cholesterol', 'triglyceride', 'hdl', 'ldl'].includes(params.key) ? <LipidOverviewCard anchor={anchor} openChat={openChat} /> : null}
        {edaDiagnostics ? (
          <View style={styles.debugFoot}>
            <Text style={styles.debugTitle}>测试信息 · EDA（最近 30 分钟）</Text>
            <Text style={styles.debugText}>
              样本 {edaDiagnostics.count} 条 · 中位间隔 {edaDiagnostics.medianGapMin != null ? `${edaDiagnostics.medianGapMin.toFixed(1)} 分钟` : '—'} · 最近样本 {edaDiagnostics.latestMin != null ? `${edaDiagnostics.latestMin.toFixed(1)} 分钟前` : '—'}
            </Text>
          </View>
        ) : null}
        {/* 给底部常驻「记录此刻心情」胶囊留白，避免遮住图表与分析卡
            ★ 2026-11-06（用户：「心压力的周，不展示这个记录此刻心情」）→ 周/月/年不渲染 FAB，也不需要留白 */}
        {isStress && range === 'day' ? <View style={{ height: 160 }} /> : null}
      </View>
      <ChatSheet visible={chatVisible} onClose={() => setChatVisible(false)} initialQuestion={chatQuestion} />
    </ScreenContainer>
    {/* ★ 2026-11-06（用户）：「心压力的周、月、年，不展示这个记录此刻心情」→ 仅日视图保留 FAB */}
    {isStress && range === 'day' ? <EmotionQuickRecord /> : null}
    </View>
  );
}

/* ★ 2026-10-16：血糖详情页——测量类型 / 风险等级 / 参考区间
 * 数据来自戒指健康一览（原生已回传 glucoseType / glucoseLevel）。参考区间按临床常规给出，仅展示。 */
const GLUCOSE_TYPES: { [k: number]: string } = { 1: '空腹', 2: '餐后 1 小时', 3: '餐后 2 小时' };
const GLUCOSE_LEVELS: { [k: number]: { label: string; color: string } } = {
  1: { label: '低风险', color: mm.colors.skyDeep },
  2: { label: '中风险', color: mm.colors.honeyCore },
  3: { label: '高风险', color: mm.colors.roseDeep },
};

/* ★ 2026-10-16（续 4）：血糖参考带（仿健康 App）——偏低/正常/偏高三段彩色条 + 当日最小/最大值 */
const GLUCOSE_BANDS = [
  { label: '空腹/\n餐前', lo: 3.9, hi: 6.1 },
  { label: '餐后 1 小时', lo: 6.7, hi: 9.4 },
  { label: '餐后 2 小时', lo: 4.4, hi: 7.8 },
];
const GLUCOSE_AXIS_MAX = 15;

function GlucoseRefBand({ label, lo, hi }: { label: string; lo: number; hi: number }) {
  const lowW = (lo / GLUCOSE_AXIS_MAX) * 100;
  const okW = ((hi - lo) / GLUCOSE_AXIS_MAX) * 100;
  const cLow = mm.colors.skyCore;
  const cOk = theme.colors.success;
  const cHigh = mm.colors.honeyCore;
  return (
    <View style={{ marginTop: theme.sp(2.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ width: 74, fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: theme.sp(4.5) }}>{label}</Text>
        <View style={{ flex: 1, height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden' }}>
          <View style={{ width: `${lowW}%`, backgroundColor: cLow }} />
          <View style={{ width: `${okW}%`, backgroundColor: cOk }} />
          <View style={{ flex: 1, backgroundColor: cHigh }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginLeft: 74, marginTop: 3 }}>
        <Text style={{ width: `${lowW}%`, fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{lo}</Text>
        <Text style={{ width: `${okW}%`, fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{hi}</Text>
        <Text style={{ flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'right' }}>{GLUCOSE_AXIS_MAX}</Text>
      </View>
    </View>
  );
}

function GlucoseSummaryCard() {
  const ring = useRingState();
  void ring; // 数据走 healthStore 最新值（实时/回填均落库）
  const dk = dateKeyOf(Date.now());
  const tType = latestVal('glucoseType', dk);
  const tLevel = latestVal('glucoseLevel', dk);
  const tTypeLabel = tType != null ? (GLUCOSE_TYPES[tType] ?? `类型 ${tType}`) : '—';
  const level = tLevel != null ? (GLUCOSE_LEVELS[tLevel] ?? null) : null;
  // 当日最小/最大血糖
  const dayPts = (() => { try { return healthStore.getIntraday('glucose' as any, dk); } catch { return []; } })();
  const vals = dayPts.map((p: any) => p.v).filter((v: number) => Number.isFinite(v));
  const gMin = vals.length ? Math.min(...vals) : null;
  const gMax = vals.length ? Math.max(...vals) : null;

  return (
    <Card>
      <Text style={styles.ecgTitle}>血糖概览</Text>
      <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>最小值</Text>
          <Text style={[styles.statValue, { fontSize: theme.fontSize.body }]}>{gMin != null ? gMin.toFixed(2) : '—'} <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>mmol/L</Text></Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>最大值</Text>
          <Text style={[styles.statValue, { fontSize: theme.fontSize.body }]}>{gMax != null ? gMax.toFixed(2) : '—'} <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>mmol/L</Text></Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>最近测量类型</Text>
          <Text style={[styles.statValue, { fontSize: theme.fontSize.body }]}>{tTypeLabel}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>风险等级</Text>
          <Text style={[styles.statValue, { color: level?.color, fontSize: theme.fontSize.body }]}>{level?.label ?? '—'}</Text>
        </View>
      </View>
      {/* ★ 参考区间三段彩色带（偏低/正常/偏高） */}
      <View style={{ marginTop: theme.sp(3) }}>
        <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, marginBottom: theme.sp(1) }}>参考</Text>
        <View style={{ flexDirection: 'row', gap: theme.sp(4), marginBottom: theme.sp(1), paddingLeft: 74 }}>
          {([['偏低', mm.colors.skyCore], ['正常', theme.colors.success], ['偏高', mm.colors.honeyCore]] as const).map(([t, c]) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{t}</Text>
            </View>
          ))}
        </View>
        {GLUCOSE_BANDS.map((b) => <GlucoseRefBand key={b.label} label={b.label} lo={b.lo} hi={b.hi} />)}
      </View>
      <Text style={styles.note}>参考区间按 mmol/L 临床常规给出，仅供参考，不替代医学检测；数值以戒指回传为准。</Text>
    </Card>
  );
}

function latestVal(key: string, dk: string): number | null {
  try {
    const pts = healthStore.getIntraday(key as any, dk);
    if (!pts.length) return null;
    return pts[pts.length - 1].v;
  } catch {
    return null;
  }
}

/* ★ 2026-10-16：心率详情页——心率区间（MHR 五段环）
 * MHR = 211 − 0.64 × 年龄（Tanaka 公式，适用于成年人）。
 * 按最大心率百分比划分 5 个训练区间，统计当天各区间停留时长 + 静息 / 峰值。 */
const HR_ZONES = [
  { key: 'z1', name: '热身', lo: 50, hi: 60, color: mm.colors.skyCore },
  { key: 'z2', name: '燃脂', lo: 60, hi: 70, color: mm.colors.limeMid },
  { key: 'z3', name: '有氧', lo: 70, hi: 80, color: mm.colors.honeyCore },
  { key: 'z4', name: '无氧', lo: 80, hi: 90, color: mm.colors.roseMid },
  { key: 'z5', name: '极限', lo: 90, hi: 100, color: mm.colors.roseDeep },
] as const;

function fmtDur(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

/** ★ 2026-11-03（用户：解读上移）：心率区间数据计算抽成共享 hook——
 *  HrZoneSection（区间环）与 HrInsight（顶部解读）共用同一份日内心率统计，逻辑不重复。 */
function useHrZoneStats(dk: string, mhr: number | null) {
  return useMemo(() => {
    let pts: { t: number; v: number }[] = [];
    try { pts = healthStore.getIntraday('hr', dk); } catch { pts = []; }
    pts = pts
      .filter((p) => Number.isFinite(p.v) && p.v > 30 && p.v < 240)
      .sort((a, b) => a.t - b.t);
    const dur = [0, 0, 0, 0, 0];
    let rest = 0, active = 0, pk = 0, sum = 0, cnt = 0;
    // ★ 2026-11-06 审查（docs/audit/02 🔴#5）：mhr 为 null（未录入年龄）时**不做百分比分档**。
    //   旧实现用 `age ?? 30` 兜底 → MHR=192 → 区间边界（115~173 bpm）全是假的，
    //   而且 UI 会写「基于 30 岁 · 公式 211 − 0.64 × 年龄」—— 是明确的假声明。
    //   现在：无年龄 → 不分档（zones 全 0），UI 走「录入年龄后显示区间」空态。
    const denom = mhr != null && Number.isFinite(mhr) && mhr > 0 ? mhr : null;
    for (let i = 1; i < pts.length; i++) {
      const gap = (pts[i].t - pts[i - 1].t) / 60000;
      if (gap <= 0 || gap > 30) continue; // 断连 / 异常间隔跳过
      const v = pts[i].v;
      if (v > pk) pk = v;
      sum += v; cnt++;
      if (denom == null) { rest += gap; continue; }
      const pct = (v / denom) * 100;
      let zi = -1;
      if (pct >= 90) zi = 4;
      else if (pct >= 80) zi = 3;
      else if (pct >= 70) zi = 2;
      else if (pct >= 60) zi = 1;
      else if (pct >= 50) zi = 0;
      if (zi >= 0) { dur[zi] += gap; active += gap; } else { rest += gap; }
    }
    const restVals = denom == null
      ? []
      : pts.filter((p) => (p.v / denom) * 100 < 50).map((p) => p.v);
    const restingAvg = restVals.length ? restVals.reduce((a, b) => a + b, 0) / restVals.length : null;
    return { zones: dur, resting: restingAvg, peak: pk || null, activeTotal: active, hasMhr: denom != null };
  }, [dk, mhr]);
}

/**
 * ★ 2026-11-06 审查（🔴#5）：最大心率只由**真实录入的年龄**推导。
 *   旧实现 `RingBle.getUserProfile()?.age ?? 30` —— 未填年龄时用 30 岁算出 MHR=192，
 *   心率区间环与「基于 30 岁」的文案全是编造的。返回 null 表示「年龄未知」。
 */
function mhrFromProfileAge(): { mhr: number | null; age: number | null } {
  const raw = RingBle.getUserProfile()?.age;
  const age = raw != null && Number.isInteger(raw) && raw >= 10 && raw <= 100 ? raw : null;
  if (age == null) return { mhr: null, age: null };
  return { mhr: Math.round(211 - 0.64 * age), age };
}

function HrZoneSection({ anchor, openChat }: { anchor: Date; openChat: (q: string) => void }) {
  const dk = dateKeyOf(anchor.getTime());
  // ★ 2026-11-06 审查（🔴#5）：年龄未知 → mhr 为 null，不再用假年龄 30 兜底。
  const { mhr, age } = mhrFromProfileAge();

  const { zones, activeTotal } = useHrZoneStats(dk, mhr);

  const R = 52, SW = 16, D = (R + SW) * 2, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = HR_ZONES.map((z, i) => {
    const frac = activeTotal > 0 ? zones[i] / activeTotal : 0;
    const len = frac * C;
    const el = (
      <Circle
        key={z.key}
        cx={R + SW}
        cy={R + SW}
        r={R}
        fill="none"
        stroke={z.color}
        strokeWidth={SW}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-acc}
        strokeLinecap="butt"
        transform={`rotate(-90 ${R + SW} ${R + SW})`}
      />
    );
    acc += len;
    return el;
  });

  return (
    <>
      <Card>
        <Text style={styles.ecgTitle}>心率区间</Text>
        {mhr == null ? (
          // ★ 2026-11-06 审查（🔴#5）：未录入年龄 → 不显示任何区间数值。
          //   旧实现用假年龄 30 算出 MHR=192 并写「基于 30 岁」，是彻底的假声明。
          <>
            <View style={{ alignItems: 'center', paddingVertical: theme.sp(6), gap: theme.sp(2) }}>
              <Text style={[styles.statValue, { fontSize: theme.fontSize.card }]}>—</Text>
              <Text style={styles.note}>
                心率区间按最大心率百分比划分，需要先录入年龄才能计算。
              </Text>
              <Text style={styles.note}>录入年龄后，这里会显示 50 / 60 / 70 / 80 / 90% 五档的实际活动时长分布。</Text>
            </View>
          </>
        ) : (
        <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(4) }}>
          <View style={{ width: D, height: D, position: 'relative' }}>
            <Svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
              <Circle cx={R + SW} cy={R + SW} r={R} fill="none" stroke={theme.colors.ui.offTrack} strokeWidth={SW} />
              {arcs}
            </Svg>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: theme.fontSize.h2, fontWeight: '700', color: mm.colors.ink }}>{Math.round(activeTotal)}</Text>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>活动分钟</Text>
            </View>
          </View>
          <View style={{ flex: 1, gap: theme.sp(1) }}>
            <Text style={styles.statLabel}>最大心率（MHR）</Text>
            <Text style={[styles.statValue, { fontSize: theme.fontSize.card }]}>
              {mhr}
              <Text style={styles.statLabel}> bpm</Text>
            </Text>
            <Text style={styles.note}>基于 {age} 岁 · 公式 211 − 0.64 × 年龄</Text>
          </View>
        </View>
        <View style={{ marginTop: theme.sp(3), gap: theme.sp(1.5) }}>
          {HR_ZONES.map((z, i) => {
            const lo = Math.round((z.lo / 100) * mhr);
            const hi = Math.round((z.hi / 100) * mhr);
            const dur = zones[i];
            const pct = activeTotal > 0 ? Math.round((dur / activeTotal) * 100) : 0;
            return (
              <View key={z.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: z.color }} />
                <Text style={{ flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.textTitle }}>{z.name}</Text>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{lo}–{hi} bpm</Text>
                <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textTitle, width: 52, textAlign: 'right' }}>{fmtDur(dur)}</Text>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, width: 36, textAlign: 'right' }}>{pct}%</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.note}>区间按最大心率百分比划分（50 / 60 / 70 / 80 / 90%）。仅供参考，运动强度因人而异。</Text>
        </>
        )}
      </Card>
    </>
  );
}

/** ★ 2026-11-03（用户：解读上移）：心率解读——原在页面底部 HrZoneSection 末尾，
 *  现紧跟顶部总体数据卡渲染，与「今日心率 68」下的分析话术衔接。 */
/* ★ 2026-10-28：尿酸详情页参考区间条 —— 与全 App 其余口径统一为临床常用 155–428 µmol/L
 * （BloodComponentPanel / quickCheckStore / ai.insight 均用 155–428；此前详情页错用 90–360/1000，
 *   与面板、AI 结论打架，用户看不明白）。正常上限 428，偏高 >428，偏低 <155。 */
const UA_MAX = 1000;
const UA_TIERS = [
  { key: 'low', name: '偏低', lo: 0, hi: 155, color: mm.colors.skyCore },
  { key: 'normal', name: '正常', lo: 155, hi: 428, color: mm.colors.limeMid },
  { key: 'high', name: '偏高', lo: 428, hi: UA_MAX, color: mm.colors.roseDeep },
] as const;

function UaReferenceCard({ anchor }: { anchor: Date; openChat: (q: string) => void }) {
  const dk = dateKeyOf(anchor.getTime());
  const val = latestVal('ua', dk);
  const tier = val == null ? null : val < 155 ? UA_TIERS[0] : val < 428 ? UA_TIERS[1] : UA_TIERS[2];
  const markerPct = val == null ? 0 : Math.max(0, Math.min(100, (Math.min(val, UA_MAX) / UA_MAX) * 100));

  return (
    <>
      <Card>
        <Text style={styles.ecgTitle}>尿酸参考区间</Text>
        {val == null ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>当前范围内暂无尿酸数据。</Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(3) }}>
              <Text style={styles.statLabel}>当前</Text>
              <Text style={[styles.statValue, { fontSize: theme.fontSize.card, color: tier?.color }]}>
                {Math.round(val)}
                <Text style={styles.statLabel}> µmol/L · {tier?.name}</Text>
              </Text>
            </View>
            <View style={{ position: 'relative' }}>
              <View style={{ height: 14, borderRadius: 7, flexDirection: 'row', overflow: 'hidden' }}>
                {UA_TIERS.map((t) => (
                  <View key={t.key} style={{ flex: t.hi - t.lo, backgroundColor: t.color, opacity: 0.85 }} />
                ))}
              </View>
              <View
                style={{
                  position: 'absolute',
                  top: -5,
                  bottom: -5,
                  left: `${markerPct}%`,
                  width: 3,
                  backgroundColor: mm.colors.ink,
                  borderRadius: 2,
                  transform: [{ translateX: -1.5 }],
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1) }}>
              {UA_TIERS.map((t) => (
                <Text key={t.key} style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
                  {t.name} {t.lo}–{t.hi === UA_MAX ? '1000+' : t.hi}
                </Text>
              ))}
            </View>
          </>
        )}
        <Text style={styles.note}>参考区间：偏低 &lt;155 / 正常 155–428 / 偏高 &gt;428 µmol/L。仅供参考，不替代医学检测。</Text>
      </Card>
    </>
  );
}

/* ★ 2026-10-16：血脂详情页——血脂四项汇总（TC / TG / HDL / LDL）+ 参考区间 + 分级 */
const LIPID_ITEMS = [
  { key: 'cholesterol', name: '总胆固醇', short: 'TC', unit: 'mmol/L', hi: 5.2, scaleMax: 10, lowerBetter: true, color: mm.colors.roseCore, lowLabel: '正常', highLabel: '偏高' },
  { key: 'triglyceride', name: '甘油三酯', short: 'TG', unit: 'mmol/L', hi: 1.7, scaleMax: 6, lowerBetter: true, color: mm.colors.skyCore, lowLabel: '正常', highLabel: '偏高' },
  { key: 'hdl', name: '高密度脂蛋白', short: 'HDL', unit: 'mmol/L', lo: 1.0, scaleMax: 3, lowerBetter: false, color: mm.colors.limeMid, lowLabel: '偏低', highLabel: '正常' },
  { key: 'ldl', name: '低密度脂蛋白', short: 'LDL', unit: 'mmol/L', hi: 3.4, scaleMax: 6, lowerBetter: true, color: mm.colors.honeyCore, lowLabel: '正常', highLabel: '偏高' },
] as const;

function LipidOverviewCard({ anchor }: { anchor: Date; openChat: (q: string) => void }) {
  // ★ 2026-10-16（续）：四个脂蛋白画到「同一张图」——共享 0–10 mmol/L 坐标轴，不同颜色代表不同指标，
  //   这样 TC/TG/HDL/LDL 可直接横向对比，而不是各自独立量程的小条。
  const AXIS_MAX = 10;
  const dk = dateKeyOf(anchor.getTime());
  const data = LIPID_ITEMS.map((it) => {
    const v = latestVal(it.key, dk);
    let status: 'good' | 'warn' | 'neutral' = 'neutral';
    let label = '—';
    if (v != null) {
      if (it.lowerBetter) {
        if (v <= it.hi) { status = 'good'; label = it.lowLabel; }
        else { status = 'warn'; label = it.highLabel; }
      } else {
        if (v >= (it.lo ?? 0)) { status = 'good'; label = it.highLabel; }
        else { status = 'warn'; label = it.lowLabel; }
      }
    }
    // 理想区间在【共享坐标轴】上的起止百分比（绿色带）
    const bandStart = it.lowerBetter ? 0 : (it.lo ?? 0);
    const bandEnd = it.lowerBetter ? it.hi : AXIS_MAX;
    const bandStartPct = (bandStart / AXIS_MAX) * 100;
    const bandWidthPct = ((bandEnd - bandStart) / AXIS_MAX) * 100;
    const valPct = v != null ? Math.max(0, Math.min(100, (v / AXIS_MAX) * 100)) : null;
    return { ...it, v, status, label, bandStartPct, bandWidthPct, valPct };
  });

  const dotColor = (s: string) =>
    s === 'good' ? theme.colors.success : s === 'warn' ? theme.colors.stateTense : theme.colors.textSub;

  // 共享坐标轴刻度（0–10 mmol/L）
  const TICKS = [0, 2, 4, 6, 8, 10];

  return (
    <>
      <Card>
        <Text style={styles.ecgTitle}>血脂四项总览</Text>
        <Text style={[styles.note, { marginTop: theme.sp(1), marginBottom: theme.sp(3) }]}>
          TC / TG / HDL / LDL 同尺度对比（0–10 mmol/L）· 不同颜色代表不同指标
        </Text>
        {data.map((d) => (
          <View key={d.key} style={{ marginBottom: theme.sp(3) }}>
            {/* 指标名 + 数值 + 状态 */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color, marginRight: 6 }} />
              <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textTitle }}>{d.name}</Text>
              <Text style={{ fontSize: theme.fontSize.micro, color: d.color, marginLeft: 6 }}>{d.short}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle }}>
                {d.v != null ? d.v.toFixed(2) : '—'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: 4 }}>{d.unit}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 10, width: 56, justifyContent: 'flex-end' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor(d.status) }} />
                <Text style={{ fontSize: theme.fontSize.micro, color: dotColor(d.status) }}>{d.label}</Text>
              </View>
            </View>
            {/* 同尺度轨道：灰底 + 绿色理想带 + 彩色实测点（全部以 0–10 mmol/L 为基准，可直接对比） */}
            <View style={{ height: 12, borderRadius: 6, backgroundColor: theme.colors.cardBgSoft, position: 'relative' }}>
              <View
                style={{
                  position: 'absolute',
                  left: `${d.bandStartPct}%`,
                  width: `${d.bandWidthPct}%`,
                  top: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(213,227,132,0.22)',
                  borderRadius: 6,
                }}
              />
              {d.valPct != null ? (
                <View
                  style={{
                    position: 'absolute',
                    left: `${d.valPct}%`,
                    top: -3,
                    width: 6,
                    height: 18,
                    borderRadius: 3,
                    backgroundColor: d.color,
                    borderWidth: 1.5,
                    borderColor: '#FFFFFF',
                    transform: [{ translateX: -3 }],
                  }}
                />
              ) : null}
            </View>
          </View>
        ))}
        {/* 共享坐标轴刻度（0–10 mmol/L）：明确这是「一张图、同一把尺」 */}
        <View style={{ flexDirection: 'row', marginTop: theme.sp(1), marginBottom: theme.sp(2) }}>
          {TICKS.map((t) => (
            <Text
              key={t}
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: theme.fontSize.micro,
                color: theme.colors.textSub,
              }}
            >
              {t}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1) }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: 'rgba(213,227,132,0.35)', marginRight: 6 }} />
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>绿色带 = 理想区间 · 彩色竖条 = 你今日的实测值</Text>
        </View>
        <Text style={styles.note}>参考区间按 mmol/L 临床常规给出，仅供参考，不替代医学检测；数值以戒指回传为准。</Text>
      </Card>
    </>
  );
}


/* ★ 2026-10-17（用户：① 分析以数据卡片嵌在日/周/月/年详情图下；② 日夜参考心率用 tab 区分；③ 恢复力要加上）：
 * - 日视图：顶部「日间/夜间」tab 切换，图与卡均跟随选中段；卡片 = 定性 + 时长分布（放松/正常/中等/偏高）。
 * - 周/月/年：主导档位 + 偏高占比 + 平均压力（覆盖范围内有数据的自然日聚合）。
 * - 恢复力（近 14 天，对齐 Oura Resilience，压力信号为主）独立卡片，日/周/月/年均展示。
 * 色值与全局一致：放松=绿 limeMid / 正常=蓝 skyMid / 中等=琥珀 honeyCore / 偏高=粉 roseDeep。 */
function StressStatCards({ anchor, range, part }: { anchor: Date; range: RangeKey; part: 'day' | 'night' }) {
  // ★ 2026-11-05（用户：压力四档）：四档配色 放松=绿 / 正常=蓝 / 中等=琥珀 / 偏高=粉
  const C = { relax: mm.colors.limeMid, normal: mm.colors.skyMid, mid: mm.colors.honeyCore, stress: mm.colors.roseDeep };

  const today = useMemo(
    () => stressDaySummary(dateKeyOf(anchor.getTime()), dayStartOf(anchor.getTime())),
    [anchor],
  );

  // 周 / 月 / 年：覆盖范围内所有自然日聚合，求主导档位与偏高占比
  const agg = useMemo(() => {
    if (range === 'day') return null;
    let relaxMin = 0, normalMin = 0, midMin = 0, stressMin = 0, sum = 0, cnt = 0, daysWithData = 0;
    let max = -Infinity, min = Infinity;
    for (const dk of rangeDayKeys(anchor, range)) {
      const r = stressDaySummary(dk, dayStartOf(new Date(dk + 'T00:00:00').getTime()));
      if (!r.hasData) continue;
      daysWithData += 1;
      relaxMin += r.relaxH * 60; normalMin += r.normalH * 60; midMin += r.midH * 60; stressMin += r.stressH * 60;
      if (r.avg != null) { sum += r.avg; cnt += 1; }
      if (r.peak != null && r.peak > max) max = r.peak;
      if (r.min != null && r.min < min) min = r.min;
    }
    const totalMin = relaxMin + normalMin + midMin + stressMin;
    // ★ 2026-11-05：主导档位按四档占比取最高
    const order: [string, number][] = [['放松', relaxMin], ['正常', normalMin], ['中等', midMin], ['偏高', stressMin]];
    order.sort((a, b) => b[1] - a[1]);
    const dominant: '放松' | '正常' | '中等' | '偏高' = order[0][0] as '放松' | '正常' | '中等' | '偏高';
    return {
      daysWithData,
      avg: cnt > 0 ? sum / cnt : null,
      stressPct: totalMin > 0 ? Math.round((stressMin / totalMin) * 100) : 0,
      dominant,
      max: max > -Infinity ? max : null,
      min: min < Infinity ? min : null,
    };
  }, [anchor, range]);

  // 恢复力（日视图=近 14 天滚动，与 Oura Resilience 口径对齐；周/月/年=对应周期覆盖自然日）
  const resilience = useMemo(() => stressResilience(anchor, range), [anchor, range]);

  const qualOf = (avg: number | null): '放松日' | '正常日' | '中等日' | '偏高日' | null => {
    if (avg == null) return null;
    const b0 = STRESS_BANDS[0] ?? 30, b1 = STRESS_BANDS[1] ?? 60, b2 = STRESS_BANDS[2] ?? 80;
    if (avg <= b0) return '放松日';
    if (avg <= b1) return '正常日';
    if (avg <= b2) return '中等日';
    return '偏高日';
  };
  const fmtH = (h: number) => `${h.toFixed(1)}h`;
  const dash = (v: number | null, suffix = '') => (v != null ? `${Math.round(v)}${suffix}` : '—');
  const resColor = (lvl: string) =>
    lvl === '卓越' || lvl === '强健' ? C.relax : lvl === '稳健' ? C.mid : C.stress;
  const partName = part === 'day' ? '日间' : '夜间';
  // ★ 本轮（用户）：疲劳度直接取「洞察页基础数据→疲劳度」同源值（healthStore 日均值），不再用 压力×1.2 推算
  const rangeLabel = range === 'day' ? '今日' : range === 'week' ? '本周' : range === 'month' ? '本月' : '本年';
  // ★ 本轮（用户）：恢复力标题随周期变化（日=近 14 天，周/月/年=本{周/月/年}）
  const resilienceLabel = range === 'day' ? '近 14 天' : rangeLabel;
  // ★ 2026-11-05（用户：疲劳度若没算出就去掉）：非有限值一律视为「无数据」，不渲染疲劳度块
  const fatigue =
    range === 'day'
      ? (() => {
          const m = healthStore.getDay('fatigue' as HSMetricKey, dateKeyOf(anchor.getTime()))?.mean;
          return m != null && Number.isFinite(m) ? m : null;
        })()
      : (() => {
          let sum = 0, cnt = 0;
          for (const dk of rangeDayKeys(anchor, range)) {
            const m = healthStore.getDay('fatigue' as HSMetricKey, dk)?.mean;
            if (m != null && Number.isFinite(m)) { sum += m; cnt += 1; }
          }
          return cnt > 0 ? Math.round(sum / cnt) : null;
        })();
  const fatigueBand =
    fatigue == null ? null
      : fatigue < 30 ? { text: '低', color: C.relax }
      : fatigue < 55 ? { text: '适中', color: C.mid }
      : { text: '偏高', color: C.stress };
  // ★ 本轮（用户）：疲劳度 → 低/中/高 分段条形（指针标记当前值，一眼看懂 0–100 含义）
  // ★ 本轮（用户）：疲劳度不再单独成卡，作为内嵌块并入「压力分析 + 恢复力」合并卡
  const renderFatigueBar = () => {
    const shown = fatigue == null ? null : Math.round(fatigue);
    const pct = shown == null ? 0 : Math.max(0, Math.min(100, shown));
    return (
      <View style={{ marginTop: theme.sp(2), paddingTop: theme.sp(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft }}>
        <Text style={styles.specLab}>疲劳度（{rangeLabel}）</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: theme.sp(1) }}>
          <Text style={[styles.statValue, { color: fatigueBand?.color ?? theme.colors.textTitle }]}>{shown != null ? String(shown) : '—'}</Text>
          <Text style={[styles.statLabel, { marginLeft: theme.sp(1.5), color: fatigueBand?.color ?? theme.colors.textSub }]}>{fatigueBand ? `${fatigueBand.text}疲劳` : '暂无数据'}</Text>
        </View>
        <View style={{ position: 'relative', marginVertical: theme.sp(1) }}>
          <View style={{ flexDirection: 'row', height: theme.sp(2.6), borderRadius: theme.sp(1.3), overflow: 'hidden' }}>
            <View style={{ flex: 30, backgroundColor: C.relax }} />
            <View style={{ flex: 25, backgroundColor: C.mid }} />
            <View style={{ flex: 45, backgroundColor: C.stress }} />
          </View>
          {fatigue != null ? (
            <View style={{ position: 'absolute', left: `${pct}%`, top: -theme.sp(0.4), width: 2, height: theme.sp(3.4), backgroundColor: theme.colors.textTitle, borderRadius: 1, marginLeft: -1 }} />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[styles.note, { color: C.relax }]}>低</Text>
          <Text style={[styles.note, { color: C.mid }]}>中</Text>
          <Text style={[styles.note, { color: C.stress }]}>高</Text>
        </View>
        <Text style={styles.note}>0–100，越低越轻松。与「洞察页基础数据 → 疲劳度」同源（健康一览自动评估）。非医学诊断。</Text>
      </View>
    );
  };

  if (range === 'day') {
    if (!today.hasData) {
      return (
        <View>
          <Card>
            <Text style={styles.chartTitle}>压力分析</Text>
            <Text style={styles.note}>今日压力数据不足，暂无法生成分析卡片。持续佩戴后，这里会显示当日节奏。</Text>
            {fatigue != null && renderFatigueBar()}
          </Card>
        </View>
      );
    }
    const sel = part === 'day' ? today.day : today.night;
    const partHasData = sel.totalMin > 0;
    const qColor =
      sel.avg != null
        ? sel.avg <= STRESS_BANDS[0]
          ? C.relax
          : sel.avg <= STRESS_BANDS[1]
          ? C.normal
          : sel.avg <= STRESS_BANDS[2]
          ? C.mid
          : C.stress
        : theme.colors.textSub;
    return (
      <View>
        {/* ★ 本轮（用户）：压力分析 + 恢复力 + 疲劳度 合并一卡；去掉 平均/最高/最低 */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.chartTitle, styles.titleFlex]}>压力分析</Text>
            <Text style={{ color: qColor, fontSize: theme.fontSize.micro, fontWeight: '700' }}>{qualOf(sel.avg) ?? '—'}</Text>
          </View>
          {/* ★ 2026-11-05（用户：四档）：放松/正常/中等/偏高 时长，直接取 StressDayPart 四桶 */}
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>放松时长</Text>
              <Text style={[styles.statValue, { color: C.relax }]}>{fmtH(sel.relaxH)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>正常时长</Text>
              <Text style={[styles.statValue, { color: C.normal }]}>{fmtH(sel.normalH)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>中等时长</Text>
              <Text style={[styles.statValue, { color: C.mid }]}>{fmtH(sel.midH)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>偏高时长</Text>
              <Text style={[styles.statValue, { color: C.stress }]}>{fmtH(sel.stressH)}</Text>
            </View>
          </View>
          {resilience ? (
            <View style={{ marginTop: theme.sp(2), paddingTop: theme.sp(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft }}>
              <Text style={[styles.specLab, { marginBottom: theme.sp(1) }]}>恢复力（{resilienceLabel}）</Text>
              <View style={styles.statGrid}>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>等级</Text>
                  <Text style={[styles.statValue, { color: resColor(resilience.level) }]}>{resilience.level}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>综合评分</Text>
                  <Text style={[styles.statValue, { color: theme.colors.textTitle }]}>{resilience.score}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>夜间平均</Text>
                  <Text style={[styles.statValue, { color: theme.colors.textTitle }]}>{resilience.nightAvg}</Text>
                </View>
              </View>
            </View>
          ) : null}
          {fatigue != null && renderFatigueBar()}
          {!partHasData ? (
            <Text style={styles.note}>当前时段（{partName}）暂无足够压力数据。</Text>
          ) : null}
        </Card>
      </View>
    );
  }

  // 周 / 月 / 年
  const w = agg;
  const dColor =
    w && w.daysWithData > 0
      ? w.dominant === '偏高'
        ? C.stress
        : w.dominant === '中等'
        ? C.mid
        : w.dominant === '正常'
        ? C.normal
        : C.relax
      : theme.colors.textSub;
  return (
    <View>
      {/* ★ 本轮（用户）：区间压力分析 + 恢复力 + 疲劳度 合并一卡；去掉 平均/最高/最低 */}
      <Card>
        <Text style={styles.chartTitle}>压力分析</Text>
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>主导档位</Text>
            <Text style={[styles.statValue, { color: dColor }]}>{w && w.daysWithData > 0 ? w.dominant : '—'}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>偏高占比</Text>
            <Text style={[styles.statValue, { color: C.stress }]}>{w ? `${w.stressPct}%` : '—'}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>有数据日</Text>
            <Text style={[styles.statValue, { color: theme.colors.textTitle }]}>{w ? `${w.daysWithData} 天` : '—'}</Text>
          </View>
        </View>
        {resilience ? (
          <View style={{ marginTop: theme.sp(2), paddingTop: theme.sp(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft }}>
            <Text style={[styles.specLab, { marginBottom: theme.sp(1) }]}>恢复力（{resilienceLabel}）</Text>
            <View style={styles.statGrid}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>等级</Text>
                <Text style={[styles.statValue, { color: resColor(resilience.level) }]}>{resilience.level}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>综合评分</Text>
                <Text style={[styles.statValue, { color: theme.colors.textTitle }]}>{resilience.score}</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>夜间平均</Text>
                <Text style={[styles.statValue, { color: theme.colors.textTitle }]}>{resilience.nightAvg}</Text>
              </View>
            </View>
          </View>
        ) : null}
        {fatigue != null && renderFatigueBar()}
      </Card>
      {w && w.daysWithData === 0 ? (
        <Text style={styles.note}>当前范围内暂无足够压力数据，无法生成分析卡片。</Text>
      ) : null}
    </View>
  );
}

/* ★ 2026-10-16：体温详情页——规则 AI 解读（偏离个人基线趋势） */
/**
 * ★ 2026-11-04（用户：解读融合）：体温解读并入 hero 一句话（原 TempAiCard 独立卡删除）。
 * 信息 = 基线偏离幅度 + 一句人话归因；数据不足诚实直说。
 */
function buildTempInsightText(
  tempDay: { summary: { avg: number | null; maxUp: number | null; maxDown: number | null } } | null,
  tempSignal: 'temp' | 'skinTemp',
): string | null {
  const avg = tempDay?.summary?.avg;
  const sigName = tempSignal === 'skinTemp' ? '皮肤温度' : '体温';
  if (avg == null) return `今日${sigName}数据不足，暂无法评估基线偏离。`;
  const base = `今日${sigName}相对个人基线${avg > 0 ? '偏高' : '偏低'}约 ${Math.abs(avg).toFixed(2)}℃`;
  const trend =
    avg > 0.3
      ? '，可能处于黄体期或近期活动 / 环境升温，留意身体感受'
      : avg < -0.3
      ? '，注意保暖与休息'
      : '，围绕基线小幅波动，属正常昼夜节律';
  return `${base}${trend}。`;
}

/* ★ 2026-11-05（用户 E）：呼吸暂停（OSAHS）分析抽成可复用组件 src/components/OxygenApneaSection.tsx，
 * 血氧页与睡眠恢复页共用同一份实现。 */
import { OxygenApneaSection } from '../components/OxygenApneaSection';

/* ★ 2026-10-16：HRV 详情页——Lorenz 散点（RR 间期相位图）+ 时域 HRV
 * 数据来自戒指 RR 间期历史（原生 readRrAnalysis 读取设备库 → Lorenz 散点）。 */
function HrvLorenzSection() {
  const ring = useRingState();
  const [loading, setLoading] = useState(false);
  const r = ring.rrAnalysis;
  const hrv = r ? computeRrHrv(r.rr) : null;

  const reload = useCallback(async () => {
    setLoading(true);
    try { await RingBle.readRrAnalysis(); } finally { setTimeout(() => setLoading(false), 1200); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // Lorenz 散点缩放
  const SIZE = 240, PAD = 28;
  let scatter: string[] = [];
  if (r && r.lorentz.length) {
    const xs = r.lorentz.map((p) => p.x), ys = r.lorentz.map((p) => p.y);
    const mn = Math.max(0, Math.min(...xs, ...ys) - 50);
    const mx = Math.max(...xs, ...ys) + 50;
    const sx = (v: number) => PAD + ((v - mn) / (mx - mn || 1)) * (SIZE - PAD * 2);
    scatter = r.lorentz.map((p) => `M ${sx(p.x).toFixed(1)} ${sx(p.y).toFixed(1)} l 0.1 0.1`);
  }

  return (
    <Card>
      <Text style={styles.ecgTitle}>HRV 相位图（Lorenz）</Text>
      {!r && !loading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>当天暂无 RR 间期数据，请先佩戴一段时间后再查看。</Text>
        </View>
      ) : !r && loading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>正在读取戒指心率变异性历史…</Text>
        </View>
      ) : r ? (
        <>
          <View style={styles.chartCard}>
            {scatter.length ? (
              <Svg width="100%" height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid meet">
                <Defs>
                  <LinearGradient id="lorenzDot" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={mm.colors.limeMid} stopOpacity={0.9} />
                    <Stop offset="100%" stopColor={mm.colors.skyDeep} stopOpacity={0.9} />
                  </LinearGradient>
                </Defs>
                {[0.25, 0.5, 0.75].map((g, i) => (
                  <Line key={`gx${i}`} x1={PAD} y1={PAD + g * (SIZE - PAD * 2)} x2={SIZE - PAD} y2={PAD + g * (SIZE - PAD * 2)} stroke={theme.colors.ui.borderSoft} strokeWidth={1} />
                ))}
                {[0.25, 0.5, 0.75].map((g, i) => (
                  <Line key={`gy${i}`} x1={PAD + g * (SIZE - PAD * 2)} y1={PAD} x2={PAD + g * (SIZE - PAD * 2)} y2={SIZE - PAD} stroke={theme.colors.ui.borderSoft} strokeWidth={1} />
                ))}
                {scatter.map((d, i) => (
                  <Path key={i} d={d} stroke="url(#lorenzDot)" strokeWidth={2.4} strokeLinecap="round" />
                ))}
              </Svg>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>数据量不足以绘制相位图。</Text>
              </View>
            )}
          </View>
          {hrv ? (
            <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>SDNN</Text>
                <Text style={styles.statValue}>{hrv.sdnn}<Text style={styles.statLabel}> ms</Text></Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>RMSSD</Text>
                <Text style={styles.statValue}>{hrv.rmssd}<Text style={styles.statLabel}> ms</Text></Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>pNN50</Text>
                <Text style={styles.statValue}>{hrv.pnn50}<Text style={styles.statLabel}> %</Text></Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>平均心率</Text>
                <Text style={styles.statValue}>{hrv.meanHr}<Text style={styles.statLabel}> bpm</Text></Text>
              </View>
            </View>
          ) : null}
          <TouchableOpacity activeOpacity={0.7} onPress={reload} style={styles.ecgBtn}>
            <Text style={styles.ecgBtnLabel}>重新读取</Text>
          </TouchableOpacity>
          <Text style={styles.note}>Lorenz 散点反映相邻心跳间期的相关性，点云越集中提示心率变异性越低。数据仅供参考。</Text>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  moodStrip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingVertical: theme.sp(1), paddingHorizontal: theme.sp(2.5),
    marginBottom: theme.sp(2), borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1, borderColor: 'rgba(124,106,224,0.18)',
  },
  moodStripEmoji: { fontSize: theme.fontSize.lg, marginRight: theme.sp(1.5) },
  moodStripTxt: { fontSize: theme.fontSize.micro, color: mm.colors.ink, fontWeight: theme.weight.medium as never },
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
  // ★ 本轮：title 在数字上方（今日/近期 + 指标名）
  heroTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: theme.sp(1.5) },
  // ★ 2026-10-10：原 #FFFFFF 白字是给旧深色渐变头用的，v16 页面改全白底后大数字「白字白底」不可见；
  //   数据卡挪到选择器下方的同时改为墨色（与状态趋势/脑力详情页同口径）。
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, color: mm.colors.ink },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  heroTag: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: theme.space.md, alignSelf: 'center' },
  // ★ 本轮：数字下方短 AI 分析
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(2) },
  /** ★ 本轮（用户 #246）：客观数据后的夸赞 / 肯定句——比 heroAnalysis 弱半档、带一点强调色，但不喧宾夺主 */
  heroPraise: { fontSize: theme.fontSize.sm, color: mm.colors.limeDeep ?? theme.colors.success, lineHeight: 21, marginTop: theme.sp(1), fontWeight: theme.weight.medium as any },
  /** ★ 2026-11-03：hero 卡内的区间解读段（从页面底部上移合并）——比 heroAnalysis 再小半档，弱层级 */
  heroNote: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: 19, opacity: 0.9 },
  delta: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, marginLeft: theme.space.md },
  up: { color: theme.colors.success },
  down: { color: theme.colors.stateTense },
  /* ★ 2026-11-06（用户）：压力 hero 右侧定性档位（颜色按四档内联注入） */
  stressQual: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.bold, marginLeft: theme.space.md, alignSelf: 'center' },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
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
  partBtnTextOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold as any }, // ★ 对比度修复：白字压 limeSoft 不可读
  /** ★ 2026-10-10：柱状小条卡顶部的口径标签 / 有效数据计数 */
  specLab: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, fontWeight: theme.weight.medium as any },
  // ★ 本轮（用户）：底部图表统一标题「XXX趋势图」
  chartTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: theme.sp(2) },
  // ★ 2026-11-04：横排标题（左侧标题 + 右侧徽章/计数）复用 chartTitle 字号，去掉底距、占满左侧
  titleFlex: { flex: 1, marginBottom: 0 },
  specCount: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ★ 2026-10-17：日视图「紧张 / 放松时长」汇总（对齐 Oura）
  zoneSummary: { flexDirection: 'row', gap: theme.sp(18), marginTop: theme.sp(12), alignItems: 'center' },
  zoneItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(6) },
  zoneDot: { width: theme.sp(8), height: theme.sp(8), borderRadius: theme.sp(4) },
  zoneText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
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
    borderRadius: mm.radius.card,
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
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.ui.accentSoft20,
  },
  debugTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.semibold },
  debugText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: theme.fontSize.micro * 1.5 },
  ecgDetail: { gap: theme.space.sm, marginTop: theme.space.sm },
  ecgTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  ecgChart: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: mm.radius.card,
    padding: theme.space.sm,
  },
  ecgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  ecgCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: theme.colors.cardBg, // mira-ocean：0.6 白玻璃 + 浅字不可读 → 深色玻璃
    borderRadius: mm.radius.card,
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
