/**
 * EmotionRangeBars —— 情绪「周/月/年」堆叠柱 + 周期标注 + 周期对比分析
 *
 * 卡①：堆叠柱（天/月一根柱）+ 经期/经前阴影 + 周期色带。
 * 卡②：周期情绪对比（StressWatch 式洞察）——
 *   · 基础数据（事件数 / 日均 / 消极占比 / 平均负荷，无数据不渲染空瓷片）
 *   · 本周期 vs 上个周期对比（同长度窗口，箭头表方向、颜色表好坏）
 *   · 规律发现：
 *       - 时段规律（StressWatch 式全天平滑面积曲线 + 高峰/最轻松时段卡片 + 具体日期/星期）
 *       - 周期规律（卡片形式：经前消极占比 / 经期天数 / 经前日均 / 经期负荷，仅描述、不构成诊断）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line, G, Text as SvgText, Defs, Path, Circle, Polyline, Pattern } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { computeStressReport } from '../lib/stressAlgorithm';
import { buildNaturalPeriods, buildPrevNaturalPeriods } from '../lib/periods';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { dayKey, parseDayKey } from '../data/healthStore';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import { isMonthTickDay, isYearTickMonth } from '../lib/chartAxis';
import { computeCycle, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { PHASE_COLOR, type PhaseKey } from '../lib/phaseColors';

/* ── 5 档情绪色 ★ 2026-10-10（bar-design-unified-spec 方案B·效价双相，与点阵同源）──
   正向（黄绿→黄）+ 负向（粉）：平静 limeMid / 愉悦 limeCore / 兴奋 honeyCore / 压力 roseCore / 焦虑 roseDeep
   （原 theme.colors.state* 旧色板与 mm.colors.mood* 两套并存，「平静」错用运动蓝 —— 已统一） */
const COL_EXCITED = mm.colors.honeyCore;   // 兴奋
const COL_PLEASANT = mm.colors.limeCore;   // 愉悦
const COL_CALM = mm.colors.limeMid;        // 平静
const COL_STRESSED = mm.colors.roseCore;   // 压力
const COL_ANXIOUS = mm.colors.roseDeep;    // 焦虑
const PRIMARY = theme.colors.accentSolid;
const PRE_PINK = mm.colors.roseMid;        // ★ 规范：#EC9CC2 硬编码 → roseMid #F6B3D0

/** 堆叠顺序（底 → 顶）：平静 / 愉悦 / 兴奋 / 压力 / 焦虑 */
const MOODS: { key: string; c: string; t: string }[] = [
  { key: 'ca', c: COL_CALM, t: '平静' },
  { key: 'pl', c: COL_PLEASANT, t: '愉悦' },
  { key: 'ex', c: COL_EXCITED, t: '兴奋' },
  { key: 'st', c: COL_STRESSED, t: '压力' },
  { key: 'an', c: COL_ANXIOUS, t: '焦虑' },
];
const MOOD_BY_COLOR: Record<string, string> = Object.fromEntries(
  MOODS.map((m) => [m.c, m.key]),
);

function moodColor(e: any): string {
  if (!e) return COL_CALM;
  const sev = e.severity || 50;
  if (e.valenceLabel === 'positive') return sev > 50 ? COL_EXCITED : COL_PLEASANT;
  if (e.valenceLabel === 'negative') return sev > 50 ? COL_ANXIOUS : COL_STRESSED;
  return COL_CALM;
}

/** lucide 线性图标 */
function Lucide({ name, size = 12, color }: { name: string; size?: number; color: string }) {
  const P: Record<string, string> = {
    heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9ZM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z',
    flower: 'M12 5a3 3 0 1 1 3 3 3 3 0 1 1-3 3 3 3 0 1 1-3-3 3 3 0 1 1 3-3Zm0 6v10',
  };
  if (!P[name]) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={P[name]} />
    </Svg>
  );
}

/** 生理周期情绪趋势曲线（模块级，避免内联重建）。横轴=周期顺序，两条线：积极(绿)/消极(红)。 */
const TREND_POS = '#46A06B';
const TREND_NEG = '#E0607A';
function PhaseTrendChart({ data }: { data: { name: string; color: string; pos: number; neg: number }[] }) {
  const W = 320, H = 198, L = 30, R = 312, T = 14, B = 168;
  const n = data.length;
  // ★ 纵轴=每佩戴小时事件数（与上方柱图同口径），自适应量程，0.5 步进
  const yMax = Math.max(1, Math.ceil(Math.max(0.1, ...data.map((d) => Math.max(d.pos, d.neg))) * 2) / 2);
  const yOf = (v: number) => T + (1 - Math.max(0, Math.min(yMax, v)) / yMax) * (B - T);
  const xOf = (i: number) => (n <= 1 ? (L + R) / 2 : L + (i / (n - 1)) * (R - L));
  const negPts = data.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.neg).toFixed(1)}`).join(' ');
  const posPts = data.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.pos).toFixed(1)}`).join(' ');
  const gridVals = [0, 0.5, 1].map((f) => f * yMax);
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: theme.sp(1) }}>
      {gridVals.map((g, gi) => {
        const valTxt = g === 0 ? '0' : (Number.isInteger(g) ? String(g) : g.toFixed(1));
        return (
          <G key={gi}>
            <Line x1={L} y1={yOf(g)} x2={R} y2={yOf(g)} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
            <SvgText x={L - 5} y={yOf(g) + 3} fontSize={chart.axisFont} fill={chart.axisText} textAnchor="end">{valTxt}</SvgText>
          </G>
        );
      })}
      <Polyline points={negPts} fill="none" stroke={TREND_NEG} strokeWidth={chart.lw.series} strokeLinejoin="round" strokeLinecap="round" />
      <Polyline points={posPts} fill="none" stroke={TREND_POS} strokeWidth={chart.lw.series} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <G key={`neg${i}`}>
          <Circle cx={xOf(i)} cy={yOf(d.neg)} r={chart.dot.radius} fill={TREND_NEG} />
          <SvgText x={xOf(i)} y={yOf(d.neg) + 13} fontSize={chart.axisFont} fill={TREND_NEG} textAnchor="middle">{d.neg.toFixed(1)}</SvgText>
        </G>
      ))}
      {data.map((d, i) => (
        <G key={`pos${i}`}>
          <Circle cx={xOf(i)} cy={yOf(d.pos)} r={chart.dot.radius} fill={TREND_POS} />
          <SvgText x={xOf(i)} y={yOf(d.pos) - 7} fontSize={chart.axisFont} fill={TREND_POS} textAnchor="middle">{d.pos.toFixed(1)}</SvgText>
        </G>
      ))}
      {data.map((d, i) => (
        <SvgText key={`x${i}`} x={xOf(i)} y={B + 18} fontSize={chart.axisFont} fill={d.color} textAnchor="middle" fontWeight="500">{d.name}</SvgText>
      ))}
    </Svg>
  );
}

interface Bar {
  label: string;
  dayKeys: string[];
  repMidMs: number;
  total: number;
  counts: Record<string, number>;
  negCount: number;
  loadSum: number;
  loadCnt: number;
  phase: PhaseKey;
  isPre: boolean;
  /** 该区间（周=单日 / 月年=多日）是否有任意一天佩戴过：false=整段未佩戴（无数据） */
  worn: boolean;
  /** 该区间实际佩戴的天数（用于「日均事件」分母，排除未佩戴日） */
  wornDays: number;
  /** 该区间累计佩戴分钟数（多日求和；用于高度归一化 = 每佩戴小时事件数） */
  wearMin: number;
  /** 每佩戴小时事件数（total / (wearMin/60)）；未佩戴或 wearMin=0 时为 0 */
  intensity: number;
}

/** 区间聚合统计 */
interface WinStat {
  days: number; total: number; neg: number;
  negShare: number; dayAvg: number; avgLoad: number | null;
}

const emptyStat = (): WinStat => ({ days: 0, total: 0, neg: 0, negShare: 0, dayAvg: 0, avgLoad: null });

export default function EmotionRangeBars({ range, anchor }: { range: RangeKey; anchor: Date }) {
  const anchorMs = anchor.getTime();

  const [localLog, setLocalLog] = useState<CycleLog | null>(null);
  useEffect(() => { void loadCycleLog().then((l) => setLocalLog(l)); }, []);

  /** ★自然日历周期：week=本周一~周日 / month=本月1号~月末 / year=今年1月~12月
   *  ★ 2026-10-07（用户实锤）：**横轴保持完整自然周期** ——
   *    周=一~日 全部标出；月=1~月末；年=1~12月。
   *    但周期内**未来的天不参与统计**（否则 reportNowMsForDay 会把未来日钳到「此刻」，
   *    用今天的数据污染未来柱与汇总）。未来单元的 dayKeys 为空 → 现有的 isFuture 分支自然不画柱。 */
  const periods = useMemo(() => {
    const todayK = dayKey(Date.now());
    return buildNaturalPeriods(range, anchorMs)
      .map((u) => ({ ...u, dayKeys: u.dayKeys.filter((dk) => dk <= todayK) }));
  }, [range, anchorMs]);
  const nUnits = periods.length;

  /** 汇总一组 dayKeys 的情绪事件 */
  const aggWindow = (keys: string[]): WinStat => {
    let days = 0, total = 0, neg = 0, loadSum = 0, loadCnt = 0;
    for (const dk of keys) {
      days += 1;
      const rep = computeStressReport(reportNowMsForDay(parseDayKey(dk) ?? anchorMs));
      for (const e of rep.events) {
        total += 1;
        if (e.valenceLabel === 'negative') neg += 1;
      }
      if (rep.emotionalLoad != null) { loadSum += rep.emotionalLoad; loadCnt += 1; }
    }
    return {
      days, total, neg,
      negShare: total > 0 ? neg / total : 0,
      dayAvg: days > 0 ? total / days : 0,
      avgLoad: loadCnt > 0 ? Math.round(loadSum / loadCnt) : null,
    };
  };

  const bars = useMemo<Bar[]>(() => {
    const out: Bar[] = [];
    for (const u of periods) {
      const counts: Record<string, number> = { ca: 0, pl: 0, ex: 0, st: 0, an: 0 };
      let total = 0, neg = 0, loadSum = 0, loadCnt = 0, wornDays = 0, wearMinSum = 0;
      for (const dk of u.dayKeys) {
        const rep = computeStressReport(reportNowMsForDay(parseDayKey(dk) ?? anchorMs));
        if (rep.worn) wornDays += 1;
        wearMinSum += rep.wearMin;
        for (const e of rep.events) {
          const key = MOOD_BY_COLOR[moodColor(e)] ?? 'ca';
          counts[key] += 1; total += 1;
          if (key === 'st' || key === 'an') neg += 1;
        }
        if (rep.emotionalLoad != null) { loadSum += rep.emotionalLoad; loadCnt += 1; }
      }
      let phase: PhaseKey = 'unknown';
      let isPre = false;
      if (localLog) {
        const info = computeCycle(localLog, new Date(u.repMidMs), { tempSeries: [], periodHistory: localLog.history });
        phase = (info.phase as PhaseKey) ?? 'unknown';
        isPre = info.daysToNextPeriod != null && info.daysToNextPeriod >= 1 && info.daysToNextPeriod <= 7 && phase !== 'period';
      }
      // ★ 高度归一化：每佩戴小时事件数。让「戴 2 小时 3 次」与「戴一整天 3 次」一眼可比
      const intensity = (wornDays > 0 && wearMinSum > 0) ? total / (wearMinSum / 60) : 0;
      out.push({ label: u.label, dayKeys: u.dayKeys, repMidMs: u.repMidMs, total, counts, negCount: neg, loadSum, loadCnt, phase, isPre, worn: wornDays > 0, wornDays, wearMin: wearMinSum, intensity });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, anchorMs, localLog]);

  const bandColor = (b: Bar): string => {
    if (b.phase === 'period') return PHASE_COLOR.period;
    if (b.isPre) return PRE_PINK;
    if (b.phase === 'follicular') return PHASE_COLOR.follicular;
    if (b.phase === 'ovulation') return PHASE_COLOR.ovulation;
    if (b.phase === 'luteal') return PHASE_COLOR.luteal;
    return mm.colors.emptyFill;
  };

  // ── 图表布局（onLayout 自适应卡片宽度，全部柱子塞进一屏）──
  const [viewW, setViewW] = useState(0);
  const [chartW, setChartW] = useState(0);
  const AXIS_L = 26, AXIS_R = 4, PLOT_TOP = 40, PLOT_H = 180, BAND_H = 12;
  const n = bars.length;
  const plotW = Math.max(60, viewW - AXIS_L - AXIS_R);
  const slot = plotW / Math.max(1, n);
  // ★ 2026-10-10（bar-design-unified-spec 规则3）：柱宽全站统一 clamp(4, slot×0.6, 24)
  const barW = Math.max(4, Math.min(24, slot * 0.6));
  const gap = Math.max(1.5, slot - barW);
  const plotBottom = PLOT_TOP + PLOT_H;
  const xLabelY = plotBottom + 15;
  const stripY = xLabelY + 8;
  const chartH = stripY + BAND_H + 4;

  // ★ 柱高归一化为「每佩戴小时事件数」，让佩戴时长不同的天可横向比较
  const rawMax = Math.max(0.1, ...bars.map((b) => b.intensity));
  const yMax = Math.max(1, Math.ceil(rawMax * 2) / 2); // 0.5 步进，便于读刻度
  const hasData = bars.some((b) => b.total > 0);

  // 连续经期 / 经前 run（图上方胶囊标注）
  const runs: { kind: 'period' | 'pre'; start: number; end: number }[] = [];
  let cur: { kind: 'period' | 'pre'; start: number; end: number } | null = null;
  bars.forEach((b, i) => {
    const kind = b.phase === 'period' ? 'period' : b.isPre ? 'pre' : null;
    if (kind) {
      if (cur && cur.kind === kind) cur.end = i;
      else { if (cur) runs.push(cur); cur = { kind, start: i, end: i }; }
    } else if (cur) { runs.push(cur); cur = null; }
  });
  if (cur) runs.push(cur);

  const summarize = (list: Bar[]): WinStat => {
    const days = list.reduce((s, b) => s + b.dayKeys.length, 0);
    const wornDays = list.reduce((s, b) => s + (b.wornDays ?? 0), 0);
    const total = list.reduce((s, b) => s + b.total, 0);
    const neg = list.reduce((s, b) => s + b.negCount, 0);
    const loadSum = list.reduce((s, b) => s + b.loadSum, 0);
    const loadCnt = list.reduce((s, b) => s + b.loadCnt, 0);
    return {
      days, total, neg,
      negShare: total > 0 ? neg / total : 0,
      // ★ 分母用「佩戴天数」而非自然天数：未佩戴日无事件，会稀释均值、把「佩戴日的真实活跃度」压低
      dayAvg: wornDays > 0 ? total / wornDays : (days > 0 ? total / days : 0),
      avgLoad: loadCnt > 0 ? Math.round(loadSum / loadCnt) : null,
    };
  };
  const hasCycleLog = localLog != null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // ── 分生理周期相位的情绪状态聚合（仅四个真实相位：经期 / 卵泡期 / 排卵期 / 黄体期）──
  // 经前(pre) 是一个「时期窗口」而非相位，仅作为图表阴影标注，不进入相位对比行
  const PHASE_LIST: { key: string; name: string; color: string }[] = [
    { key: 'period', name: '经期', color: PHASE_COLOR.period },
    { key: 'follicular', name: '卵泡期', color: PHASE_COLOR.follicular },
    { key: 'ovulation', name: '排卵期', color: PHASE_COLOR.ovulation },
    { key: 'luteal', name: '黄体期', color: PHASE_COLOR.luteal },
  ];
  const MOOD_META: Record<string, { c: string; t: string; emoji: string }> = {
    ca: { c: COL_CALM, t: '平静', emoji: '😌' },
    pl: { c: COL_PLEASANT, t: '愉悦', emoji: '🙂' },
    ex: { c: COL_EXCITED, t: '兴奋', emoji: '😆' },
    st: { c: COL_STRESSED, t: '压力', emoji: '😣' },
    an: { c: COL_ANXIOUS, t: '焦虑', emoji: '😰' },
  };
  const phaseAgg: Record<string, { days: number; total: number; neg: number; loadSum: number; loadCnt: number; wearMin: number; counts: Record<string, number> }> = {};
  for (const b of bars) {
    // ★ 经前是「黄体期内的一个时期窗口」，不是独立相位；其日子 phase 已是 'luteal'，
    //   直接用 b.phase 归桶，避免经前日漏算进黄体期、导致四相位对比残缺。
    const key = b.phase;
    if (key === 'unknown') continue;
    let a = phaseAgg[key];
    if (!a) { a = { days: 0, total: 0, neg: 0, loadSum: 0, loadCnt: 0, wearMin: 0, counts: { ca: 0, pl: 0, ex: 0, st: 0, an: 0 } }; phaseAgg[key] = a; }
    a.days += b.dayKeys.length;
    a.total += b.total;
    a.neg += b.negCount;
    a.loadSum += b.loadSum;
    a.loadCnt += b.loadCnt;
    a.wearMin += b.wearMin;
    for (const mk of ['ca', 'pl', 'ex', 'st', 'an']) a.counts[mk] += b.counts[mk] ?? 0;
  }

  /* ── 上个自然周期（上周 / 上月 / 去年）对比 ── */
  const prevStat = useMemo<WinStat>(() => {
    const prev = buildPrevNaturalPeriods(range, anchorMs);
    const keys = prev.flatMap((p) => p.dayKeys);
    return aggWindow(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, anchorMs]);

  const curStat = useMemo<WinStat>(() => summarize(bars), [bars]);

  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 高峰 / 最轻松 时段（逐单位比较消极占比；周=星期、月=日期、年=月份）
  let peakDay: { date: Date; share: number; total: number; neg: number } | null = null;
  let calmDay: { date: Date; share: number; pleasant: number } | null = null;
  {
    let bestP = -1;
    let bestC = Infinity;
    for (const b of bars) {
      if (b.total === 0) continue;
      const share = b.negCount / b.total;
      const pleasant = (b.counts.pl ?? 0) + (b.counts.ex ?? 0);
      if (share > bestP) { bestP = share; peakDay = { date: new Date(b.repMidMs), share, total: b.total, neg: b.negCount }; }
      if (share < bestC - 1e-9 || (Math.abs(share - bestC) < 1e-9 && calmDay != null && pleasant > calmDay.pleasant)) {
        bestC = share; calmDay = { date: new Date(b.repMidMs), share, pleasant };
      }
    }
  }
  const fmtUnit = (d: Date): string => {
    if (range === 'year') return `${d.getMonth() + 1}月`;
    if (range === 'week') return WD[d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const peakLabel = peakDay ? fmtUnit(peakDay.date) : '—';
  const calmLabel = calmDay ? fmtUnit(calmDay.date) : '—';

  // 周期对比方向：消极占比降 = 好（绿）；升 = 需留意（红）
  const diffShare = hasData && prevStat.total > 0 ? curStat.negShare - prevStat.negShare : null;
  const cmp = (d: number | null, goodWhenDown: boolean): { txt: string; up: boolean | null; good: boolean | null } => {
    if (d == null || Math.abs(d) < 0.005) return { txt: '持平', up: null, good: null };
    const up = d > 0;
    const good = goodWhenDown ? !up : up;
    return { txt: `${up ? '↑' : '↓'} ${goodWhenDown ? pct(Math.abs(d)) : Math.abs(d).toFixed(1)}`, up, good };
  };
  const cmpShare = cmp(diffShare, true);

  // ★ v18.105 无数据口径：卡② 洞察区整块保留（不整块消失），数值一律写「—」——
  //   不给「0% / 0.0 次 / 持平」这种「看着像有数据」的假值（用户：没数据就该是杠）。
  const negShareTxt = hasData && curStat.total > 0 ? pct(curStat.negShare) : '—';
  const dayAvgTxt = hasData && curStat.dayAvg > 0 ? curStat.dayAvg.toFixed(1) : '—';
  const totalTxt = hasData ? String(curStat.total) : '—';
  const cmpTxt = hasData ? cmpShare.txt : '—';
  const cmpSub = !hasData
    ? '无上期可对比'
    : cmpShare.up == null ? '持平'
      : cmpShare.good ? '消极占比改善' : '消极占比上升';
  const cmpTint = !hasData || cmpShare.up == null
    ? theme.colors.textSub
    : cmpShare.good ? theme.colors.trendUp : theme.colors.trendDown;

  // 月/年视图横坐标抽稀（与 chartAxis 同源：月=1/5/10/15/20/25/30，年=奇数月；周全标）
  const showX = (i: number) => range === 'month' ? isMonthTickDay(i + 1) : range === 'year' ? isYearTickMonth(i) : true;
  const showCount = barW >= 13;

  const PILL_BG = '#F6B3D0';

  return (
    <>
      {/* 卡 ① 堆叠柱 + 周期标注 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={styles.headRow}>
            <Text style={styles.chartTitle}>情绪分布 · {RANGE_DEF[range].label}</Text>
            <Text style={styles.headSub}>{range === 'year' ? '每月一根柱 · 柱高=每佩戴小时事件数' : '每天一根柱 · 柱高=每佩戴小时事件数'}</Text>
          </View>

          <View onLayout={(e) => setViewW(e.nativeEvent.layout.width)}>
            {viewW > 0 && (
            <Svg width={viewW} height={chartH}>
              <Defs>
                {/* 未佩戴占位：斜纹填充，明确区别于「佩戴但情绪平稳」的灰条 */}
                <Pattern id="hatchWear" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                  <Rect width={6} height={6} fill={mm.colors.emptyFill} />
                  <Line x1={0} y1={0} x2={0} y2={6} stroke={mm.colors.chipBorder} strokeWidth={1.3} />
                </Pattern>
              </Defs>
              {[0, 0.5, 1].map((f) => {
                const y = PLOT_TOP + PLOT_H - f * PLOT_H;
                const val = f === 0 ? 0 : f === 0.5 ? yMax / 2 : yMax;
                const valTxt = Number.isInteger(val) ? String(val) : val.toFixed(1);
                return (
                  <G key={`g${f}`}>
                    <Line x1={AXIS_L} y1={y} x2={viewW - AXIS_R} y2={y} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
                    <SvgText x={AXIS_L - 5} y={y + 3.5} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>{valTxt}</SvgText>
                  </G>
                );
              })}

              {bars.map((b, i) => {
                const x = AXIS_L + i * (barW + gap);
                if (b.phase === 'period') {
                  return <Rect key={`sh${i}`} x={x - 1.5} y={PLOT_TOP + 2} width={barW + 3} height={PLOT_H - 2} rx={4} fill={PHASE_COLOR.period} opacity={0.12} />;
                }
                if (b.isPre) {
                  return <Rect key={`sh${i}`} x={x - 1.5} y={PLOT_TOP + 2} width={barW + 3} height={PLOT_H - 2} rx={4} fill={PRE_PINK} opacity={0.12} />;
                }
                return null;
              })}

              {bars.map((b, i) => {
                const x = AXIS_L + i * (barW + gap);
                const y0 = plotBottom;
                // ★ 没有数据的 bar 直接跳过,不画任何占位
                const isFuture = b.dayKeys.every((dk) => dk > dayKey(Date.now()));
                if (isFuture) return null;
                // ★ 未佩戴 + 0 事件 → 不画(没数据就不画,不搞占位)
                if (!b.worn && b.total === 0) return null;
                const inten = b.intensity;
                const barH = inten > 0 ? Math.max(3, (inten / yMax) * PLOT_H) : 0;
                let cursor = y0;
                return (
                  <G key={`bar${i}`}>
                    {b.total > 0 ? (
                      MOODS.map((m) => {
                        const c = b.counts[m.key] || 0;
                        if (c === 0) return null;
                        const h = (c / b.total) * barH;
                        cursor -= h;
                        return <Rect key={m.key} x={x} y={cursor} width={barW} height={h} fill={m.c} rx={chart.barRadius} />;
                      })
                    ) : (
                      <Rect x={x} y={y0 - 2} width={barW} height={2} fill={mm.colors.emptyFill} />
                    )}
                    {inten > 0 && showCount && (
                      <SvgText x={x + barW / 2} y={y0 - barH - 4} textAnchor="middle" fontSize={theme.fontSize.micro} fontWeight="700" fill={theme.colors.textSub}>{inten.toFixed(1)}</SvgText>
                    )}
                  </G>
                );
              })}

              {runs.filter((r) => r.end - r.start >= 1).map((r, idx) => {
                const cx = AXIS_L + (r.start + (r.end - r.start) / 2 + 0.5) * (barW + gap) + barW / 2;
                const txt = r.kind === 'period' ? '经期' : '经前';
                const w = txt.length * 11 + 14;
                const px = Math.max(2, Math.min(viewW - w - 2, cx - w / 2));
                return (
                  <G key={`run${idx}`}>
                    <Rect x={px} y={PLOT_TOP - 26} width={w} height={16} rx={8} fill={r.kind === 'period' ? PHASE_COLOR.period : PRE_PINK} />
                    <SvgText x={px + w / 2} y={PLOT_TOP - 26 + 11.5} textAnchor="middle" fontSize={10.5} fontWeight="700" fill={mm.colors.roseDeep}>{txt}</SvgText>
                  </G>
                );
              })}

              {bars.map((b, i) => {
                if (!showX(i)) return null;
                const x = AXIS_L + i * (barW + gap);
                return (
                  <SvgText key={`x${i}`} x={x + barW / 2} y={xLabelY} textAnchor="middle" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>{b.label}</SvgText>
                );
              })}

              {bars.map((b, i) => {
                const x = AXIS_L + i * (barW + gap);
                return <Rect key={`band${i}`} x={x} y={stripY} width={barW} height={BAND_H} fill={bandColor(b)} rx={chart.barRadius} />;
              })}
            </Svg>
            )}
          </View>

          <View style={styles.legendRow}>
            {MOODS.map((m) => (
              <View key={m.key} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: m.c }]} />
                <Text style={styles.legendText}>{m.t}</Text>
              </View>
            ))}
            <View style={styles.legendItem}>
              <View style={styles.legendSwatchHatch} />
              <Text style={styles.legendText}>未佩戴</Text>
            </View>
          </View>
          <Text style={styles.mapCaption}>柱高 = 每佩戴小时情绪事件数（已按佩戴时长归一化，可横向比较不同佩戴时长的天）；斜纹 = 未佩戴（无数据，不计入）；平滑小灰条 = 佩戴但情绪平稳。</Text>
          {/* ★ v18.105 空态（本区间压根没采样）：坐标轴 / 网格 / 周期色带 / 图例照旧渲染，
              只用一行小字说明「空是空的」，不要把整张图抽掉。 */}
          {!hasData && (
            <Text style={styles.hint}>本区间没有佩戴记录 · 柱形为「未佩戴」斜纹占位（不计入统计）。</Text>
          )}
          <View style={[styles.legendRow, { marginTop: theme.sp(1.25) }]}>
            <Text style={styles.legendCaption}>周期</Text>
            {([
              ['经期', PHASE_COLOR.period],
              ['经前', PRE_PINK],
              ['卵泡期', PHASE_COLOR.follicular],
              ['排卵期', PHASE_COLOR.ovulation],
              ['黄体期', PHASE_COLOR.luteal],
            ] as [string, string][]).map(([t, c]) => (
              <View key={t} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: c }]} />
                <Text style={styles.legendText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {/* 卡 ② 情绪洞察：数据洞察（方块卡）+ 生理周期情绪状态 */}
      <Card padded={false} style={{ marginTop: theme.sp(2) }}>
        <View style={styles.pad}>
          <View style={styles.headRow}>
            <Text style={styles.chartTitle}>情绪记录</Text>
            {hasCycleLog && range !== 'week' && <View style={styles.badge}><Text style={styles.badgeText}>周期洞察</Text></View>}
          </View>

          {/* ① 数据洞察（StressWatch 式方块卡）★ v18.105：无数据也整块保留、数值一律写「—」，
              不再把整个洞察区替换成一行小字（用户：图表是空图表，不能什么占位都没有就没了）。 */}
          <Text style={styles.blockTitle}>数据洞察</Text>
          <View style={styles.statRow}>
            <MiniTile
              label="高峰时段"
              value={peakLabel}
              sub={hasData ? '消极最集中' : '本区间无事件记录'}
              tint={hasData ? COL_ANXIOUS : theme.colors.textSub}
            />
            <MiniTile
              label="最轻松时段"
              value={calmLabel}
              sub={hasData ? '情绪最舒缓' : '本区间无事件记录'}
              tint={hasData ? COL_PLEASANT : theme.colors.textSub}
            />
          </View>
          <View style={styles.statRow}>
            <MiniTile
              label="消极占比"
              value={negShareTxt}
              sub={hasData ? '本区间' : '暂无'}
              tint={hasData ? COL_ANXIOUS : theme.colors.textSub}
            />
            <MiniTile
              label="日均事件"
              value={dayAvgTxt}
              sub={hasData ? '次 / 天' : '暂无'}
              tint={hasData ? theme.colors.textTitle : theme.colors.textSub}
            />
          </View>
          <View style={styles.statRow}>
            <MiniTile
              label="总记录"
              value={totalTxt}
              sub={hasData ? '次' : '暂无'}
              tint={hasData ? theme.colors.textTitle : theme.colors.textSub}
            />
            <MiniTile
              label="跟上期对比"
              value={cmpTxt}
              sub={cmpSub}
              tint={cmpTint}
            />
          </View>
          {!hasData && (
            <Text style={styles.hint}>本区间没有佩戴记录 · 柱形为「未佩戴」斜纹占位（不计入统计）；连上戒指开启自动监测后，这里会展示情绪分布、峰谷时段与周期对比。</Text>
          )}

          {/* ② 生理周期情绪状态（仅月 / 年视图展示；周视图不展示周期对比） */}
          {hasData && range !== 'week' && (
                <>
                  <Text style={[styles.blockTitle, { marginTop: theme.sp(2.5) }]}>生理周期情绪状态</Text>
                  {hasCycleLog ? (
                    <View style={styles.trendWrap}>
                      {/* ★ 趋势曲线：横轴=周期顺序(经期→卵泡→排卵→黄体)，两条线=积极(绿)/消极(红)，看周期内情绪起伏 */}
                      <Text style={[styles.blockSub, { marginBottom: theme.sp(1) }]}>纵轴 = 每佩戴小时情绪事件数（已按佩戴时长归一化，与上方柱图同口径）</Text>
                      <PhaseTrendChart data={PHASE_LIST.map((p) => {
                        const a = phaseAgg[p.key];
                        const wh = (a?.wearMin ?? 0) / 60; // 该相位累计佩戴小时
                        const pos = (a?.counts.pl ?? 0) + (a?.counts.ex ?? 0);
                        const neg = (a?.counts.st ?? 0) + (a?.counts.an ?? 0);
                        // ★ 与上方柱状图同口径：每佩戴小时事件数（已按佩戴时长归一化）
                        return {
                          name: p.name, color: p.color,
                          pos: wh > 0 ? pos / wh : 0,
                          neg: wh > 0 ? neg / wh : 0,
                        };
                      })} />
                      <View style={styles.trendLegendRow}>
                        <View style={styles.trendLegendItem}><View style={[styles.trendLegendDot, { backgroundColor: TREND_POS }]} /><Text style={styles.trendLegendText}>积极</Text></View>
                        <View style={styles.trendLegendItem}><View style={[styles.trendLegendDot, { backgroundColor: TREND_NEG }]} /><Text style={styles.trendLegendText}>消极</Text></View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.statRow}>
                      <MiniTile label="生理周期" value="待记录" sub="记录经期后，这里按各阶段展示情绪趋势" tint={theme.colors.textSub} />
                    </View>
                  )}

                  <Text style={styles.analysisText}>
                    周期为推算（日历 + 体温），仅帮助你观察身体节律与情绪的关联，不构成诊断。
                  </Text>
                </>
              )}
        </View>
      </Card>
    </>
  );
}

/* 小分区瓷片（shadcn：描边白卡 + 彩色值；只渲染有数据的字段，不出「0 次 / 本区间无」空瓷片） */
function MiniTile({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: tint }]}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: theme.space.cardPad },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(2) },
  chartTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  headSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  badge: { backgroundColor: theme.colors.accentSoft, paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill },
  badgeText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: theme.colors.accentText },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: theme.sp(2.5), gap: theme.space.sm },
  legendCaption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginRight: theme.sp(0.5), fontWeight: '600' as any },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) },
  legendSwatch: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: chart.barRadius },
  legendSwatchHatch: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: chart.barRadius, backgroundColor: mm.colors.emptyFill, borderWidth: 0.75, borderStyle: 'dashed', borderColor: mm.colors.chipBorder },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.5, marginTop: theme.sp(1) },
  statRow: { flexDirection: 'row', gap: theme.space.sm },
  mapWrap: { position: 'relative' },
  mapAxisTop: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  mapAxisBottom: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, marginTop: theme.sp(1) },
  mapAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1) },
  mapAxisText: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub },
  gridOuter: { position: 'relative' },
  grid: { flexDirection: 'column', gap: 3, padding: 4, borderRadius: theme.radius.md, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  gridRow: { flexDirection: 'row', gap: 3 },
  gridCell: { flex: 1, aspectRatio: 1, borderRadius: theme.radius.xs },
  mapLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.sp(1.5) },
  mapCaption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), lineHeight: 14 },
  calmPill: {
    position: 'absolute', left: '50%', top: '50%', transform: [{ translateX: -42 }, { translateY: -12 }],
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.5),
  },
  calmPillText: { fontSize: theme.fontSize.micro, fontWeight: '600' as any, color: COL_CALM },
  tile: {
    flex: 1, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md, padding: theme.space.cardPadCompact,
  },
  tileLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) },
  tileValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, lineHeight: theme.fontSize.card * 1.2 },
  tileSub: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, marginTop: theme.sp(0.5), lineHeight: 13 },
  compareBlock: { marginTop: theme.sp(2.5) },
  blockTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  subTitle: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: theme.colors.accentText, marginBottom: theme.sp(0.5), textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  hourLegendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1) },
  hourLegendPeak: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: COL_ANXIOUS },
  hourLegendCalm: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: COL_PLEASANT },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  hourAxisText: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub },
  blockSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  mapBlock: { marginTop: theme.sp(2.5) },
  mapHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.sp(1), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.cardBorder },
  cmpLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, flex: 1 },
  cmpVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, minWidth: 52, textAlign: 'right' },
  cmpPrev: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, minWidth: 76, textAlign: 'right' },
  cmpDelta: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, minWidth: 52, textAlign: 'right' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(1), marginBottom: theme.sp(1.25) },
  bulletDot: { width: 5, height: 5, borderRadius: theme.radius.xs, backgroundColor: PRIMARY, marginTop: theme.fontSize.sm * 0.55 },
  bulletText: { fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, lineHeight: theme.fontSize.sm * 1.55, flex: 1 },
  analysisText: { fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, lineHeight: theme.fontSize.sm * 1.55, marginTop: theme.sp(2) },

  // 概览一行
  summaryLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: theme.sp(1), gap: theme.sp(0.5) },
  summaryText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.5 },
  summaryStrong: { fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },

  // 生理周期情绪状态（趋势曲线）
  trendWrap: { marginTop: theme.sp(0.5) },
  trendLegendRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.sp(0.5) },
  trendLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendLegendDot: { width: 10, height: 10, borderRadius: 2 },
  trendLegendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
});
