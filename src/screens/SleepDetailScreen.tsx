/**
 * SleepDetailScreen —— 「睡眠结构」卡片点击进入的日 / 周 / 月 / 年历史详情页
 *
 * 设计约束（与 StatusTrendDetailScreen / design token 一致）：
 *  - 顶部返回 + 标题「睡眠时长」+ 单位「分钟」；
 *  - 日 / 周 / 月 / 年切换（复用 RangeSwitch）；
 *  - 全部柱状图展示「睡眠总时长」（来自 ring.sleepDaily.total，单位分钟，真实数据）；
 *      · 日：最近 14 天，一天一根；
 *      · 周：最近 10 周，每周平均时长；
 *      · 月：最近 6 个月，每月平均时长；
 *      · 年：最近 12 个月，每月平均时长（跨一整年视角）；
 *  - 第二排统计：最新 / 均值 / 最佳（小时制），以及该区间深睡% / REM% / 评分的均值；
 *  - 全部使用真实数据，缺口留空（不编造）；无任何数据时诚实显示占位引导。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent, Pressable } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import Svg, { Rect, Line, Defs, LinearGradient, Stop, G, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { type SleepSummary, type SleepSegment } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import SleepStageChart from '../components/SleepStageChart';
import SleepHormoneCorrelation from '../components/SleepHormoneCorrelation';
import { startOfDay, startOfWeek, endOfWeek } from '../lib/dateUtils';
import { type RangeKey } from '../data/metrics';
import { dayKey } from '../data/healthStore';

// ★ 柱状图 SVG 只负责画柱子、网格线、渐变；所有文字都用 HTML（参考 MetricDetailScreen）
const W = 680;
const H = 280;          // 纯绘图区高度（不含文字区）
const PAD_L = 10;       // 绘图区左边界
const PAD_R = 10;       // 绘图区右边界
const PAD_T = 14;       // 顶部留白
const PAD_B = 10;       // 底部留白
const Y_GUT = 36;       // ★ 左侧 Y 轴刻度列宽度（HTML Text）
const X_AXIS_H = 48;    // ★ 底部 X 轴标签区高度（HTML Text，两行）

interface DayRec {
  total: number;
  deep: number;
  light: number;
  rem: number;
  score: number;
  getUp: number;
  sleepTime?: string | null;   // 入睡时间 "HH:mm"（用于作息规律性）
  wakeTime?: string | null;    // 起床时间 "HH:mm"
}

function parseKey(k: string): Date | null {
  const t = new Date(k + 'T00:00:00');
  return Number.isFinite(t.getTime()) ? t : null;
}

function fmtDur(min: number | null): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '—';
  let h = Math.floor(min / 60);
  let m = Math.round(min % 60);
  if (m >= 60) { h += 1; m -= 60; }  // ★ 进位：避免 "9h60m"
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v)}%`;
}

function lastDayKeys(n: number): string[] {
  const arr: string[] = [];
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    arr.push(dayKey(d.getTime()));  // ★ 补零格式
  }
  return arr;
}

function meanOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function maxOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.max(...v);
}
function lastNonNull(vals: (number | null)[]): number | null {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return vals[i] as number;
  return null;
}

/** 把 sleepDaily 按『天键』拆成可读记录，键格式 'YYYY-M-D' 或 'YYYY-MM-DD' 均可 */
function toRecords(sleepDaily: Record<string, SleepSummary>): { key: string; date: Date; rec: DayRec }[] {
  return Object.keys(sleepDaily)
    .map((k) => {
      const d = parseKey(k);
      const s = sleepDaily[k];
      if (!d || !s || !(s.total > 0)) return null;
      return { key: k, date: d, rec: s as DayRec };
    })
    .filter((x): x is { key: string; date: Date; rec: DayRec } => x != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

const GOAL_MIN = 450; // 7.5h 参考目标线（仅作对比参考，非强制目标）

function parseHM(s?: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** 入睡跨午夜归一到「傍晚起点」：AM(<12:00) 视为 +1440，便于算入睡波动 */
function bedMinute(s?: string | null): number | null {
  const t = parseHM(s);
  if (t == null) return null;
  return t < 720 ? t + 1440 : t;
}
function stdOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}
interface Agg {
  total: number | null;
  deepPct: number | null;
  remPct: number | null;
  score: number | null;
  count: number;
  bedStd: number | null;
  wakeStd: number | null;
  bedMean: number | null;
  wakeMean: number | null;
}
/** 对 [start,end] 窗口内的睡眠记录做聚合（与柱状图当前窗口口径一致） */
function aggSleep(recs: { key: string; date: Date; rec: DayRec }[], start: Date, end: Date): Agg {
  const valid = recs
    .filter((r) => r.date.getTime() >= start.getTime() && r.date.getTime() <= end.getTime())
    .map((r) => r.rec)
    .filter((r) => r.total > 0);
  return {
    total: meanOf(valid.map((r) => r.total)),
    deepPct: meanOf(valid.map((r) => (r.deep / r.total) * 100)),
    remPct: meanOf(valid.map((r) => (r.rem / r.total) * 100)),
    score: meanOf(valid.map((r) => (r.score != null ? r.score : null))),
    count: valid.length,
    bedStd: stdOf(valid.map((r) => bedMinute(r.sleepTime ?? null))),
    wakeStd: stdOf(valid.map((r) => parseHM(r.wakeTime ?? null))),
    bedMean: meanOf(valid.map((r) => bedMinute(r.sleepTime ?? null))),
    wakeMean: meanOf(valid.map((r) => parseHM(r.wakeTime ?? null))),
  };
}
/** 当前区间窗口（周=自然周 / 月=自然月 / 年=整年 / 日=当天） */
function windowOf(range: RangeKey, anchor: Date): { start: Date; end: Date } {
  if (range === 'week') return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
  if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m, 1);
    const e = new Date(y, m + 1, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (range === 'year') {
    const y = anchor.getFullYear();
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: e };
}
/** 上一等长周期窗口（用于「环比上一周期」对比） */
function prevWindowOf(range: RangeKey, anchor: Date): { start: Date; end: Date } {
  if (range === 'week') {
    const s = startOfWeek(anchor), e = endOfWeek(anchor);
    s.setDate(s.getDate() - 7); e.setDate(e.getDate() - 7);
    return { start: s, end: e };
  }
  if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (range === 'year') {
    const y = anchor.getFullYear() - 1;
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  const a = new Date(anchor); a.setDate(a.getDate() - 1); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: e };
}
type CmpKind = 'dur' | 'pct' | 'score';
/** 对比信息：当前值文本 + 环比 delta（箭头+颜色，上升=好） */
function cmpInfo(cur: number | null, prev: number | null, kind: CmpKind): { curText: string; deltaText: string; deltaColor: string } {
  const curText = cur == null ? '—' : kind === 'dur' ? fmtDur(cur) : kind === 'pct' ? `${Math.round(cur)}%` : `${Math.round(cur)}`;
  if (cur == null || prev == null) return { curText, deltaText: '上期无数据', deltaColor: theme.colors.textSub };
  const d = cur - prev;
  const tol = kind === 'dur' ? 1 : 0.5;
  if (Math.abs(d) < tol) return { curText, deltaText: '→ 持平', deltaColor: theme.colors.textSub };
  const up = d > 0;
  const deltaText = (up ? '▲ ' : '▼ ') + (kind === 'dur' ? fmtDur(Math.abs(d)) : kind === 'pct' ? `${Math.abs(d).toFixed(1)}pp` : `${Math.round(Math.abs(d))}`);
  return { curText, deltaText, deltaColor: up ? theme.colors.trendUp : theme.colors.trendDown };
}

export default function SleepDetailScreen() {
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [range, setRange] = useState<RangeKey>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);

  // ★ key 格式必须与 RingBleManager.dayKeyOf 一致 (YYYY-MM-DD 补零)，否则 sleepDaily map 永远匹配不上
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const sleepDaily = ring.sleepDaily ?? {};

/** ★ 生成 N+1 个均匀分布在 [start, end] 时间域上的 X 轴刻度（和 MetricDetail 一致） */
function buildAxisLabels(start: Date, end: Date, N: number, fmt: (d: Date, isFirst: boolean, isLast: boolean) => string): string[] {
  const labels: string[] = [];
  const t0 = start.getTime();
  const t1 = end.getTime();
  for (let i = 0; i <= N; i++) {
    const d = new Date(t0 + (t1 - t0) * (i / N));
    labels.push(fmt(d, i === 0, i === N));
  }
  return labels;
}

  const { bars, axisLabels, current, avg, best, deepAvg, remAvg, scoreAvg, hasData } = useMemo(() => {

    const recs = toRecords(sleepDaily);
    const empty = {
      bars: [] as (number | null)[],
      axisLabels: [] as string[],
      current: null,
      avg: null,
      best: null,
      deepAvg: null,
      remAvg: null,
      scoreAvg: null,
      hasData: false,
    };
    if (recs.length === 0) return empty;



    // 通用：[startDate, endDate] 区间内每天一根柱子
    const dailyBars = (start: Date, end: Date, labelFn: (d: Date, isFirst: boolean, isLast: boolean) => string): {
      vals: (number | null)[]; labels: string[];
      current: number | null; avg: number | null; best: number | null;
      deepAvg: number | null; remAvg: number | null; scoreAvg: number | null;
      hasData: boolean;
    } => {
      const win = recs.filter((r) => r.date.getTime() >= start.getTime() && r.date.getTime() <= end.getTime());
      const map = new Map(win.map((r) => [r.key, r.rec]));
      // 生成日期序列
      const keys: string[] = [];
      const cur = new Date(start); cur.setHours(0, 0, 0, 0);
      const endNorm = new Date(end); endNorm.setHours(0, 0, 0, 0);
      while (cur.getTime() <= endNorm.getTime()) {
        keys.push(dayKey(cur));
        cur.setDate(cur.getDate() + 1);
      }
      const vals = keys.map((k) => (map.has(k) ? (map.get(k)!.total as number) : null));
      const labels = keys.map((k, i) => {
        const d = parseKey(k);
        if (!d) return '';
        return labelFn(d, i === 0, i === keys.length - 1);
      });
      // 统计指标只用有数据的天
      const validRecs = keys.map((k) => map.get(k)).filter((r): r is DayRec => r != null);
      return {
        vals, labels,
        current: lastNonNull(vals), avg: meanOf(vals), best: maxOf(vals),
        deepAvg: meanOf(validRecs.map((r) => (r.total > 0 ? (r.deep / r.total) * 100 : null))),
        remAvg: meanOf(validRecs.map((r) => (r.total > 0 ? (r.rem / r.total) * 100 : null))),
        scoreAvg: meanOf(validRecs.map((r) => (r.score != null ? r.score : null))),
        hasData: vals.some((v) => v != null),
      };
    };

    if (range === 'day') {
      // 近 14 天，每天一根柱子
      const end = new Date(anchor); end.setHours(0, 0, 0, 0);
      const start = new Date(end); start.setDate(end.getDate() - 13);
      const res = dailyBars(start, end, (d) => `${d.getMonth() + 1}/${d.getDate()}`);
      return { bars: res.vals, axisLabels: res.labels, current: res.current, avg: res.avg, best: res.best, deepAvg: res.deepAvg, remAvg: res.remAvg, scoreAvg: res.scoreAvg, hasData: res.hasData };
    }

    if (range === 'week') {
      // ★ 自然周：和 DateAnchorPicker 统一（startOfWeek~endOfWeek，周一~周日）
      const start = startOfWeek(anchor);
      const end = endOfWeek(anchor);
      const res = dailyBars(start, end, (d) => {
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
      });
      // ★ axisLabels: 7 个均匀分布刻度（和柱子数量解耦）
      // ★ axisLabels: 7 个刻度，格式 M/D（和 MetricDetail 一致）
      const weekLabels = buildAxisLabels(start, end, 6, (d) => `${d.getMonth() + 1}/${d.getDate()}`);
      return { bars: res.vals, axisLabels: weekLabels, current: res.current, avg: res.avg, best: res.best, deepAvg: res.deepAvg, remAvg: res.remAvg, scoreAvg: res.scoreAvg, hasData: res.hasData };
    }

    if (range === 'month') {
      // 当月每天一根柱子，X 轴标签稀疏（只在 1/8/15/22/29 日显示）
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0); // 月末
      const res = dailyBars(start, end, (d, isFirst, isLast) => {
        const dom = d.getDate();
        if (isFirst || isLast || dom <= 1 || dom === 8 || dom === 15 || dom === 22 || dom === 29) {
          return String(dom);
        }
        return ''; // 其他天不显示标签，避免溢出
      });
      // ★ axisLabels: 7 个均匀分布刻度（不是 30 个！）
      const monthLabels = buildAxisLabels(start, end, 6, (d) => `${d.getMonth() + 1}/${d.getDate()}`);
      return { bars: res.vals, axisLabels: monthLabels, current: res.current, avg: res.avg, best: res.best, deepAvg: res.deepAvg, remAvg: res.remAvg, scoreAvg: res.scoreAvg, hasData: res.hasData };
    }

    // year：anchor 所在年 12 个月，每月一根柱子（月内取平均）
    const yYear = anchor.getFullYear();
    const loYear = new Date(yYear, 0, 1);
    const hiYear = new Date(yYear, 11, 31);
    const winYear = recs.filter((r) => r.date.getTime() >= loYear.getTime() && r.date.getTime() <= hiYear.getTime());
    const byMonth = new Map<string, { vals: number[]; deep: number[]; rem: number[]; score: number[] }>();
    for (const r of winYear) {
      const prefix = `${r.date.getFullYear()}-${r.date.getMonth() + 1}`;
      if (!byMonth.has(prefix)) byMonth.set(prefix, { vals: [], deep: [], rem: [], score: [] });
      const b = byMonth.get(prefix)!;
      b.vals.push(r.rec.total);
      if (r.rec.total > 0) { b.deep.push((r.rec.deep / r.rec.total) * 100); b.rem.push((r.rec.rem / r.rec.total) * 100); }
      if (r.rec.score != null) b.score.push(r.rec.score);
    }
    const seq: { prefix: string; label: string }[] = Array.from({ length: 12 }, (_, i) => ({ prefix: `${yYear}-${i + 1}`, label: `${i + 1}月` }));
    const vals = seq.map((s) => {
      const b = byMonth.get(s.prefix);
      return b && b.vals.length ? b.vals.reduce((a, c) => a + c, 0) / b.vals.length : null;
    });
    const foundMonths = seq.map((s) => byMonth.get(s.prefix)).filter((b) => b != null) as { vals: number[]; deep: number[]; rem: number[]; score: number[] }[];
    // ★ axisLabels: 7 个均匀分布刻度（N=6，和 MetricDetail 一致）
    const yearLabels = buildAxisLabels(loYear, hiYear, 6, (d) => `${d.getMonth() + 1}月`);
    return {
      bars: vals, axisLabels: yearLabels, current: lastNonNull(vals), avg: meanOf(vals), best: maxOf(vals),
      deepAvg: meanOf(foundMonths.flatMap((b) => b.deep)), remAvg: meanOf(foundMonths.flatMap((b) => b.rem)), scoreAvg: meanOf(foundMonths.flatMap((b) => b.score)),
      hasData: vals.some((v) => v != null),
    };
  }, [range, sleepDaily, anchor]);

  // ★ 对比聚合：当前区间 vs 上一等长周期 + 个人基线（近30天），复用 EmotionCognitiveDetailScreen 范式
  const cmp = useMemo<{
    has: boolean; cur?: Agg; prev?: Agg; baseline?: Agg; goalPct?: number | null; bedStd?: number | null; wakeStd?: number | null;
  }>(() => {
    const recsAll = toRecords(sleepDaily);
    if (recsAll.length === 0) return { has: false };
    const cur = windowOf(range, anchor);
    const prev = prevWindowOf(range, anchor);
    const baseStart = new Date(prev.start); baseStart.setDate(baseStart.getDate() - 30);
    const curAgg = aggSleep(recsAll, cur.start, cur.end);
    const prevAgg = aggSleep(recsAll, prev.start, prev.end);
    const baseAgg = aggSleep(recsAll, baseStart, prev.start);
    const goalPct = curAgg.total != null ? Math.min(150, Math.round((curAgg.total / GOAL_MIN) * 100)) : null;
    return { has: true, cur: curAgg, prev: prevAgg, baseline: baseAgg, goalPct, bedStd: curAgg.bedStd, wakeStd: curAgg.wakeStd };
  }, [range, sleepDaily, anchor]);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yMax = (() => {
    const m = maxOf(bars) ?? 480;
    return Math.max(360, Math.ceil((m * 1.12) / 60) * 60); // 最低 6h，向上取整到 60min
  })();
  const yAt = (v: number) => {
    const c = Math.max(0, Math.min(yMax, Number.isFinite(v) ? v : 0));
    return PAD_T + (1 - c / yMax) * plotH;
  };

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const barCount = Math.max(bars.length, 1);
  const slot = plotW / barCount;
  const barW = Math.min(46, slot * 0.6);

  return (
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
          <Icon name="chevronLeft" size={22} color={mm.colors.ink} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{range === 'day' ? '睡眠结构' : '睡眠时长'}</Text>
          <Text style={styles.unit}>{range === 'day' ? '昨夜整夜分期' : '总睡眠时长 · 分钟'}</Text>
        </View>
      </View>

      <RangeSwitch value={range} onChange={setRange} />

      {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

      {range === 'day' ? (
        /* 日：展示最新一天的睡眠分期图 */
        <View style={[styles.chartCard, { padding: theme.space.cardPad }]}>
          {(() => {
            // ★ 按 anchor 日期取那天的 segments + summary（每天的分期段由 RingBleManager 解析 sleepLine 归档）
            const dk = dayKey(anchor);
            const isLatest = !ring.sleepSummaryDate || ring.sleepSummaryDate === dk;
            // 只有该日就是「最新同步日」时才允许回退到 sleepStages，否则会把今天的分期画到历史日上
            const segs = ring.sleepStagesDaily?.[dk] ?? (isLatest ? ring.sleepStages : null);
            const summaryObj = ring.sleepDaily?.[dk] ?? null;
            // 从 sleepDaily 构造 SleepSummary（它是归档子集，缺 sdkScore 等字段）
            const summary = summaryObj ? {
              total: summaryObj.total ?? 0,
              deep: summaryObj.deep ?? 0,
              light: summaryObj.light ?? 0,
              rem: summaryObj.rem ?? 0,
              score: summaryObj.score ?? ring.sleepSummary?.score ?? 0, // 该日自身评分优先
              getUp: summaryObj.getUp ?? 0,
              sleepTime: summaryObj.sleepTime ?? (isLatest ? ring.sleepTime : null),
              wakeTime: summaryObj.wakeTime ?? (isLatest ? ring.wakeTime : null),
            } : ring.sleepSummary;
            if (!segs || segs.length === 0) {
              return (
                <View style={{ height: 200, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.md }}>
                  <Text style={[styles.emptyText, { textAlign: 'center' }]}>
                    昨夜睡眠分期暂未同步。将戒指连接 App 后，后台会自动回填历史睡眠分期。
                  </Text>
                </View>
              );
            }
            return (
              <>
                <SleepStageChart
                  segments={segs}
                  sleepTime={summary?.sleepTime ?? null}
                  totalMinutes={summary?.total ?? null}
                />
                {/* 单天指标（总时长/深睡/REM/评分/作息）统一移到下方 SleepMetricCompare 行式列表 */}
              </>
            );
          })()}
        </View>
      ) : (
        /* 周 / 月 / 年：柱状图（HTML Y 轴刻度 + SVG 柱子 + HTML X 轴标签） */
        <View style={[styles.chartCard, { minHeight: H + 80 }]}>
          {!hasData ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                暂无可展示的睡眠记录。连接戒指并将每晚睡眠同步后，这里会自动绘制睡眠时长柱状图。
              </Text>
            </View>
          ) : (
            <>
                {/* ★ 第一行：Y 轴 HTML 刻度列 + SVG 绘图区 */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  {/* Y 轴刻度：HTML Text 避免 SVG 拉伸变形 */}
                  <View style={{ width: Y_GUT, height: H, position: 'relative' }}>
                    {[0, 4, 8, 12].map((h) => {
                      const y = yAt(h * 60);
                      return (
                        <Text
                          key={`y-html-${h}`}
                          style={{
                            position: 'absolute',
                            top: Math.max(0, y - 7),
                            right: 4,
                            fontSize: theme.fontSize.micro,
                            color: h === 8 ? mm.colors.limeDeep : theme.colors.textSub,
                            fontWeight: h === 8 ? '600' : '400',
                            textAlign: 'right',
                          }}
                        >
                          {h}h
                        </Text>
                      );
                    })}
                  </View>
                  {/* SVG 绘图区：onLayout 拿到实际宽度 */}
                  <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
                    <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                  <Defs>
                    {/* v16：睡眠语义=lime（旧紫 accentSolid 废弃） */}
                    <LinearGradient id="sleepBar" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor={mm.colors.limeMid} stopOpacity={0.95} />
                      <Stop offset="100%" stopColor={mm.colors.limeSoft} stopOpacity={0.55} />
                    </LinearGradient>
                  </Defs>

                  {/* ===== Y 轴网格线（刻度文字移到 HTML 左列 Y_GUT） ===== */}
                  {[0, 4, 8, 12].map((h) => {
                    const y = yAt(h * 60);
                    const isAnchor = h === 8;
                    return (
                      <Line
                        key={`y${h}`}
                        x1={PAD_L}
                        y1={y}
                        x2={W - PAD_R}
                        y2={y}
                        stroke={theme.colors.ui.borderSoft}
                        strokeWidth={isAnchor ? 1 : 0.5}
                        strokeDasharray={isAnchor ? '4 4' : '2 4'}
                        opacity={isAnchor ? 0.8 : 0.4}
                      />
                    );
                  })}

                  {/* ===== 柱子 ===== */}
                  {bars.map((v, i) => {
                    const cx = PAD_L + slot * i + slot / 2;
                    const x = cx - barW / 2;
                    const isSelected = selectedBar === i;
                    if (v == null || !Number.isFinite(v)) {
                      return (
                        <Rect
                          key={i}
                          x={x}
                          y={PAD_T}
                          width={barW}
                          height={plotH}
                          rx={4}
                          fill="transparent"
                          stroke={theme.colors.ui.borderSoft}
                          strokeWidth={1}
                          strokeDasharray="3 3"
                        />
                      );
                    }
                    const y = yAt(v);
                    const hgt = PAD_T + plotH - y;
                    return (
                      <Rect
                        key={i}
                        x={x}
                        y={y}
                        width={barW}
                        height={Math.max(2, hgt)}
                        rx={6}
                        fill={isSelected ? mm.colors.limeDeep : 'url(#sleepBar)'}
                        opacity={selectedBar != null && !isSelected ? 0.45 : 1}
                        onPress={() => setSelectedBar(selectedBar === i ? null : i)}
                      />
                    );
                  })}

                  {/* ===== 均值参考线 + 目标参考线 ===== */}
                  {avg != null && (() => {
                    const y = yAt(avg);
                    return <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={mm.colors.limeDeep} strokeWidth={1.4} strokeDasharray="6 4" opacity={0.85} />;
                  })()}
                  {GOAL_MIN <= yMax && (() => {
                    const y = yAt(GOAL_MIN);
                    return <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={theme.colors.accentSolid} strokeWidth={1.4} strokeDasharray="2 3" opacity={0.85} />;
                  })()}

                  {/* X 轴标签已移到 HTML 外层 axis 行 */}
                </Svg>
                  </View>{/* SVG 区域 flex:1 */}
                </View>{/* row flexDirection */}

                {/* ★ 第二行：X 轴 HTML 标签（两行：周几小在上 + 日期大在下） */}
                {/* ★ X 轴标签：和 MetricDetail 一致，space-between 自动两端对齐 */}
                <View style={styles.axis}>
                  {axisLabels.map((lab, i) => (
                    <Text key={`x${i}`} style={styles.axisText}>{lab}</Text>
                  ))}
                </View>

                {/* 参考线图例：均值（虚线）/ 目标（点线） */}
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendLine, { borderColor: mm.colors.limeDeep, borderStyle: 'dashed' }]} />
                    <Text style={styles.legendText}>均值 {avg != null ? fmtDur(avg) : '—'}</Text>
                  </View>
                  {GOAL_MIN <= yMax && (
                    <View style={styles.legendItem}>
                      <View style={[styles.legendLine, { borderColor: theme.colors.accentSolid, borderStyle: 'dotted' }]} />
                      <Text style={styles.legendText}>目标 {fmtDur(GOAL_MIN)}</Text>
                    </View>
                  )}
                </View>

                {/* ===== Tooltip：选中柱子上方浮出 ===== */}
                {selectedBar != null && bars[selectedBar] != null && (() => {
                  const v = bars[selectedBar]!;
                  const cx = PAD_L + slot * selectedBar + slot / 2;
                  const tipY = Math.max(PAD_T + 4, yAt(v) - 48);
                  const tipX = cx / W * w;
                  const tipSub = axisLabels[selectedBar] || (() => {
                    if (range === 'week') return '';
                    if (range === 'month') return `${selectedBar + 1}日`;
                    if (range === 'year') return `${selectedBar + 1}月`;
                    return '';
                  })();
                  const contentW = 110;
                  return (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: tipX - contentW / 2,
                        top: tipY * w / W,
                        width: contentW,
                        alignItems: 'center',
                      }}
                    >
                      <View style={{
                        backgroundColor: theme.colors.cardBg,
                        borderRadius: 8,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderWidth: 1,
                        borderColor: theme.colors.ui.borderSoft,
                        shadowColor: '#000',
                        shadowOpacity: 0.15,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 2 },
                        alignItems: 'center',
                      }}>
                        <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle }}>
                          {fmtDur(v)}
                        </Text>
                        {tipSub ? (
                          <Text style={{ fontSize: 10, color: theme.colors.textSub, marginTop: 1 }}>
                            {tipSub}
                          </Text>
                        ) : null}
                      </View>
                      {/* 小三角指向柱子 */}
                      <View style={{
                        width: 0, height: 0,
                        borderLeftWidth: 6,
                        borderRightWidth: 6,
                        borderTopWidth: 6,
                        borderLeftColor: 'transparent',
                        borderRightColor: 'transparent',
                        borderTopColor: theme.colors.cardBg,
                        marginTop: -1,
                      }} />
                    </View>
                  );
                })()}
              </>
          )}
        </View>
      )}

      {/* 睡眠指标 · 对比上一周期（参考 Oura/Whoop 行式：标签左 · 数值右 · 趋势箭头） */}
      <SleepMetricCompare range={range} cmp={cmp} />

      {/* 睡眠 × 周期阶段 × 皮质醇 观察关联（仅月视图展示） */}
      {range === 'month' && (
        <View style={{ marginTop: theme.space.md }}>
          <SleepHormoneCorrelation ring={ring} />
        </View>
      )}

    </ScreenContainer>
    </View>
  );
}

/** 轻量 SVG 文本（数值标签与 X 轴标签共用） */
function SvgTextLabel({ x, y, text, anchor, sub }: { x: number; y: number; text: string; anchor?: 'middle' | 'start' | 'end'; sub?: boolean }) {
  return (
    <SvgText x={x} y={y} textAnchor={anchor ?? 'middle'} fontSize={sub ? 14 : 16} fontWeight={sub ? '400' : '600'} fill={sub ? theme.colors.textSub : theme.colors.textTitle}>
      {text}
    </SvgText>
  );
}

/** 睡眠指标行式对比卡（参考 Oura / Whoop：每个指标一行，名称左·数值右·环比箭头） */
function fmtClock(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return '—';
  const m = ((min % 1440) + 1440) % 1440; // 入睡跨午夜归一到 0–1440
  const h = Math.floor(m / 60);
  const mm2 = Math.round(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm2).padStart(2, '0')}`;
}
/** 入睡/起床时间环比：更早(数值减小)通常更好 → 绿；更晚 → 红（健康作息常识，非诊断） */
function cmpTime(cur: number | null, prev: number | null): { text: string; color: string } {
  if (cur == null || prev == null) return { text: '上期无数据', color: theme.colors.textSub };
  const d = cur - prev;
  if (Math.abs(d) < 1) return { text: '→ 持平', color: theme.colors.textSub };
  const earlier = d < 0;
  return { text: (earlier ? '早 ' : '晚 ') + Math.abs(Math.round(d)) + '分', color: earlier ? theme.colors.trendUp : theme.colors.trendDown };
}

function MetricRow({ name, dot, value, delta }: { name: string; dot?: string; value: string; delta: { deltaText: string; deltaColor: string } }) {
  return (
    <View style={styles.mRow}>
      <View style={styles.mNameWrap}>
        {dot ? <View style={[styles.mDot, { backgroundColor: dot }]} /> : null}
        <Text style={styles.mName}>{name}</Text>
      </View>
      <View style={styles.mValWrap}>
        <Text style={styles.mVal}>{value}</Text>
        <Text style={[styles.mDelta, { color: delta.deltaColor }]}>{delta.deltaText}</Text>
      </View>
    </View>
  );
}

function SleepMetricCompare({ range, cmp }: { range: RangeKey; cmp: { has: boolean; cur?: Agg; prev?: Agg; baseline?: Agg; goalPct?: number | null; bedStd?: number | null; wakeStd?: number | null } }) {
  if (!cmp.has || !cmp.cur || !cmp.prev) return null;
  const { cur, prev, baseline, goalPct, bedStd, wakeStd } = cmp;
  const subTitle = range === 'day' ? '对比前一晚' : '对比上一周期';
  const structRows = [
    { name: '总睡眠时长', dot: mm.colors.limeDeep, value: fmtDur(cur.total), delta: cmpInfo(cur.total, prev.total, 'dur') },
    { name: '深睡占比', dot: theme.colors.accentSolid, value: fmtPct(cur.deepPct), delta: cmpInfo(cur.deepPct, prev.deepPct, 'pct') },
    { name: 'REM 占比', dot: theme.colors.accent2, value: fmtPct(cur.remPct), delta: cmpInfo(cur.remPct, prev.remPct, 'pct') },
    { name: '睡眠评分', dot: mm.colors.ink, value: cur.score != null ? String(Math.round(cur.score)) : '—', delta: cmpInfo(cur.score, prev.score, 'score') },
  ];
  const bedD = cmpTime(cur.bedMean, prev.bedMean);
  const wakeD = cmpTime(cur.wakeMean, prev.wakeMean);
  const timeRows = [
    { name: '平均入睡', value: fmtClock(cur.bedMean), delta: { deltaText: bedD.text, deltaColor: bedD.color } },
    { name: '平均起床', value: fmtClock(cur.wakeMean), delta: { deltaText: wakeD.text, deltaColor: wakeD.color } },
  ];
  return (
    <View style={styles.mCard}>
      <View style={styles.mHead}>
        <Text style={styles.mTitle}>睡眠指标</Text>
        <Text style={styles.mHeadSub}>{subTitle}</Text>
      </View>
      {structRows.map((r, i) => (
        <View key={r.name}>
          <MetricRow name={r.name} dot={r.dot} value={r.value} delta={r.delta} />
          {i < structRows.length - 1 && <View style={styles.mDivider} />}
        </View>
      ))}
      <View style={styles.mDivider} />
      <Text style={styles.mGroupTitle}>作息规律</Text>
      {timeRows.map((r, i) => (
        <View key={r.name}>
          <MetricRow name={r.name} value={r.value} delta={r.delta} />
          {i < timeRows.length - 1 && <View style={styles.mDivider} />}
        </View>
      ))}
      <View style={styles.mFooter}>
        <Text style={styles.mFootItem}>个人基线 <Text style={styles.mFootVal}>{baseline?.total != null ? fmtDur(baseline.total) : '—'}</Text></Text>
        <Text style={styles.mFootItem}>目标达成 <Text style={styles.mFootVal}>{goalPct != null ? `${Math.round(goalPct)}%` : '—'}</Text></Text>
        {bedStd != null && <Text style={styles.mFootItem}>入睡波动 <Text style={styles.mFootVal}>±{Math.round(bedStd)}分</Text></Text>}
        {wakeStd != null && <Text style={styles.mFootItem}>起床波动 <Text style={styles.mFootVal}>±{Math.round(wakeStd)}分</Text></Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
  back: { padding: theme.sp(1), marginLeft: -theme.sp(1) },
  titleWrap: { flexDirection: 'column' },
  title: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: mm.colors.ink },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
    minHeight: 360,
  },
  emptyWrap: { height: H, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 22 },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.sp(2),
    paddingLeft: Y_GUT,
  },
  axisText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
  axisWeekday: { fontSize: 10, color: theme.colors.textSub, fontWeight: '400' },
  axisDate: { fontSize: theme.fontSize.micro, color: theme.colors.textTitle, fontWeight: '500', marginTop: 1 },
  axisMonth: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: '500', textAlign: 'center' },
  // ===== 指标行式对比卡（参考 Oura/Whoop） =====
  mCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  mHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.space.sm },
  mTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  mHeadSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  mGroupTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, marginBottom: theme.space.xs },
  mRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.space.sm },
  mNameWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  mDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.space.sm },
  mName: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, fontWeight: theme.weight.medium },
  mValWrap: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm },
  mVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, minWidth: 56, textAlign: 'right' },
  mDelta: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, minWidth: 56, textAlign: 'right' },
  mDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.ui.borderSoft },
  mFooter: {
    flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm,
    marginTop: theme.space.sm, paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  mFootItem: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  mFootVal: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  // ===== 参考线图例 =====
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.space.lg, marginTop: theme.sp(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  legendLine: { width: 18, height: 0, borderTopWidth: 2 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
