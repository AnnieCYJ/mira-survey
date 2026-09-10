/**
 * StatusTrendDetailScreen —— 「全天状态趋势」点击进入的日 / 周 / 月 / 年历史详情页
 *
 * 设计约束（与 MetricDetailScreen / design token 一致）：
 *  - 顶部返回 + 标题「全天状态趋势」+ 单位「状态指数 0–100」；
 *  - 日 / 周 / 月 / 年切换（复用 RangeSwitch）；
 *  - 日：今日分时曲线（ring.statusTimeline，实时能量曲线，0–24h）；
 *  - 周 / 月：每日均值（statusDaily，按天聚合的当日状态分值），一天一个点；
 *  - 年：每月均值（statusDaily 当月所有天的均值），一月一个点；
 *  - 全部使用真实数据，缺口断线 / 缺天留空，不编造；无数据区间诚实显示占位。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { RingBle, type RingState } from '../ble/RingBleManager';
import { type RangeKey } from '../data/metrics';
import { startOfWeek, addDays } from '../lib/dateUtils';
import { MOODS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { dayKey } from '../data/healthStore';


const W = 680;
const H = 240;
const PAD_L = 14;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 28;
const Y_MIN = 0;
const Y_MAX = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

function moodFor(value: number) {
  const idx = curveLevel(value, CURVE_DEFAULTS).index;
  return MOODS[idx] ?? MOODS[1];
}


/** 把稀疏的 statusTimeline 点展开为全天 48 个 30min 边界槽。
 *  没数据的槽用 null，让折线分段逻辑自动断线。 */
// ★ 修：在每个 30min 窗口内找窗口最后一个点（不是精准匹配）
function expandTo48Slots(points: { t: number; value: number }[], anchorDayMs: number): { x: number; value: number | null }[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const n = sorted.length;
  let idx = 0;
  const result: { x: number; value: number | null }[] = [];
  for (let i = 0; i < 48; i++) {
    const slotStart = anchorDayMs + i * 30 * 60 * 1000;
    const slotEnd = slotStart + 30 * 60 * 1000;
    // 跳过 slotStart 之前的点
    while (idx < n && sorted[idx].t < slotStart) idx++;
    // 收集 [slotStart, slotEnd) 内所有点，取最后一个
    let lastInSlot: { value: number } | null = null;
    while (idx < n && sorted[idx].t < slotEnd) {
      lastInSlot = sorted[idx];
      idx++;
    }
    result.push({ x: dayFrac(slotStart), value: lastInSlot?.value ?? null });
  }
  return result;
}

function dayFrac(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.min(1, Math.max(0, (t - d.getTime()) / DAY_MS));
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

function monthMean(
  statusDaily: Record<string, number>,
  year: number,
  month0: number
): number | null {
  const prefix = `${year}-${month0 + 1}-`;
  const vals = Object.keys(statusDaily)
    .filter((k) => k.startsWith(prefix))
    .map((k) => statusDaily[k]);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
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
function minOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.min(...v);
}

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
}

const DAY_AXIS = ['0', '6', '12', '18', '24'];

export default function StatusTrendDetailScreen() {
  const navigation = useNavigation<any>();
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [range, setRange] = useState<RangeKey>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);
  // ★ tooltip 状态
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string; color: string } | null>(null);

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  const statusDaily = ring.statusDaily ?? {};

  // ★ Fallback: 从 statusTimelineByDay 反推某一天的状态均值
  const dailyMeanFromTimeline = (dayKey: string): number | null => {
    const tl = ring.statusTimelineByDay?.[dayKey];
    if (!tl || tl.length === 0) return null;
    const vals = tl.map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // ★ Fallback: 从今日实时 statusTimeline 反推均值（只给今天用）
  const todayMeanFromTimeline = (): number | null => {
    const tl = ring.statusTimeline ?? [];
    if (tl.length === 0) return null;
    const vals = tl.map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // 计算各区间的（点序列 + 轴标签 + 当前值 + 统计）
  const { pts, axisLabels, fixedAxis, current, firstReal, avg, hi, lo, hasData } = useMemo(() => {
    const anchorKey = dayKey(anchor.getTime());  // ★ 补零格式

    if (range === 'day') {
      const todayKey = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      // ★ 诊断 log
      console.log('[STATUS-DAY]', JSON.stringify({
        anchorKey, todayKey,
        anchorIsToday: anchorKey === todayKey,
        timeline_len: (ring.statusTimeline ?? []).length,
        timeline_first2: (ring.statusTimeline ?? []).slice(0, 2),
        timelineByDay_keys: Object.keys(ring.statusTimelineByDay ?? {}),
        timelineByDay_counts: Object.fromEntries(
          Object.entries(ring.statusTimelineByDay ?? {}).map(([k, v]) => [k, v?.length ?? 0])
        ),
        statusDaily_keys: Object.keys(statusDaily ?? {}),
        statusDaily_vals: Object.fromEntries(Object.entries(statusDaily ?? {}).slice(-7)),
      }));
      if (anchorKey === todayKey) {
        const anchorDayMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0).getTime();
        const tl = (ring.statusTimeline ?? [])
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .map((p) => ({ t: p.t, value: p.value }))
          .sort((a, b) => a.t - b.t);
        // ★ 展开为 48 个完整槽，gap 填 null → 折线自动断线
        const points = expandTo48Slots(tl, anchorDayMs);
        const values = tl.map((p) => p.value);
        return {
          pts: points,
          axisLabels: DAY_AXIS,
          fixedAxis: true,
          current: values.length ? values[values.length - 1] : null,
          firstReal: values.length ? values[0] : null,
          avg: meanOf(values),
          hi: maxOf(values),
          lo: minOf(values),
          hasData: values.length > 0,
        };
      }
      // 历史某天：优先用按天归档的真实状态曲线（每 30 分钟一个点，与当时一致）；无归档则退化为当日均值
      const archived = ring.statusTimelineByDay?.[anchorKey];
      if (archived && archived.length > 0) {
        const anchorDayMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0).getTime();
        const tl = archived
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .map((p) => ({ t: p.t as number, value: p.value as number }))
          .sort((a, b) => a.t - b.t);
        // ★ 展开为 48 个完整槽，gap 填 null → 折线自动断线
        const points = expandTo48Slots(tl, anchorDayMs);
        const values = tl.map((p) => p.value);
        return {
          pts: points,
          axisLabels: DAY_AXIS,
          fixedAxis: true,
          current: values.length ? values[values.length - 1] : null,
          firstReal: values.length ? values[0] : null,
          avg: meanOf(values),
          hi: maxOf(values),
          lo: minOf(values),
          hasData: values.length > 0,
        };
      }
      const v = statusDaily[anchorKey] != null ? statusDaily[anchorKey] : null;
      const values = v != null ? [v] : [];
      return {
        pts: v != null ? [{ x: 0.5, value: v }] : [],
        axisLabels: DAY_AXIS,
        fixedAxis: true,
        current: v,
        firstReal: v,
        avg: meanOf(values),
        hi: maxOf(values),
        lo: minOf(values),
        hasData: v != null,
      };
    }

    if (range === 'year') {
      const y = anchor.getFullYear();
      console.log('[STATUS-YEAR]', JSON.stringify({ year: y, statusDaily_all_keys: Object.keys(statusDaily ?? {}) }));
      const labels: string[] = [];
      const values: (number | null)[] = [];
      for (let mo = 0; mo < 12; mo++) {
        labels.push(`${mo + 1}月`);
        // ★ monthMean 基础 + timelineByDay fallback
        const base = monthMean(statusDaily, y, mo);
        if (base != null) { values.push(base); continue; }
        // 从 timelineByDay 扫当月每天
        const prefix = `${y}-${String(mo + 1).padStart(2, '0')}-`;  // ★ 补零匹配 timelineByDay key
        const tlVals: number[] = [];
        for (const dk of Object.keys(ring.statusTimelineByDay ?? {})) {
          if (dk.startsWith(prefix)) {
            const m = dailyMeanFromTimeline(dk);
            if (m != null) tlVals.push(m);
          }
        }
        if (tlVals.length > 0) {
          values.push(tlVals.reduce((a, b) => a + b, 0) / tlVals.length);
        } else {
          values.push(null);
        }
      }
      const points = values.map((v, i) => ({ x: values.length > 1 ? i / (values.length - 1) : 0.5, value: v }));
      return {
        pts: points,
        axisLabels: labels,
        fixedAxis: false,
        current: lastNonNull(values),
        firstReal: lastNonNull(values),
        avg: meanOf(values),
        hi: maxOf(values),
        lo: minOf(values),
        hasData: values.some((v) => v != null),
      };
    }

    // week (anchor 所在自然周 周一~周日) / month (anchor 所在自然月)：每日均值
    console.log('[STATUS-RANGE]', JSON.stringify({
      range, anchorKey,
      statusDaily_all: Object.fromEntries(
        Object.entries(statusDaily ?? {}).map(([k, v]) => [k, v?.toFixed(1) ?? null])
      ),
    }));
    const keys: string[] = [];
    const labels: string[] = [];
    if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(WEEK_LABEL[d.getDay()]);
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const d = new Date(y, m0, day);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(`${day}`);
      }
    }
    // ★ 3 层 fallback: statusDaily → statusTimelineByDay 均值 → 今日 timeline 均值（仅今天）
    const todayK = keys.includes(dayKey(Date.now()));
    const values = keys.map((k) => {
      if (statusDaily[k] != null) return statusDaily[k];
      const fromTl = dailyMeanFromTimeline(k);
      if (fromTl != null) return fromTl;
      // 如果是今天且 timelineByDay 没有，试实时 timeline
      if (k === dayKey(Date.now())) {
        const fromRT = todayMeanFromTimeline();
        if (fromRT != null) return fromRT;
      }
      return null;
    });
    const points = values.map((v, i) => ({ x: values.length > 1 ? i / (values.length - 1) : 0.5, value: v }));
    return {
      pts: points,
      axisLabels: labels,
      fixedAxis: false,
      current: lastNonNull(values),
      firstReal: lastNonNull(values),
      avg: meanOf(values),
      hi: maxOf(values),
      lo: minOf(values),
      hasData: values.some((v) => v != null),
    };
  }, [range, ring.statusTimeline, ring.statusTimelineByDay, statusDaily, anchor]);

  const plotW = w - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yAt = (v: number) => {
    const c = Math.max(Y_MIN, Math.min(Y_MAX, Number.isFinite(v) ? v : Y_MIN));
    return PAD_T + (1 - (c - Y_MIN) / (Y_MAX - Y_MIN || 1)) * plotH;
  };

  // 折线分段（遇 null 断线）；同时把所有真实点收集为散点，保证历史日单点/稀疏点也能看见。
  const { lineD, areaD, colorLines, last, dots } = useMemo(() => {
    if (w === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, colorLines: [], dots: [] as { x: number; y: number; color: string }[] };
    let line = '';
    let area = '';
    let seg: { x: number; y: number }[] = [];
    const allDots: { x: number; y: number; color: string }[] = [];
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
    for (const p of pts) {
      const v = p.value;
      if (v == null) {
        flush();
        continue;
      }
      const pt = { x: PAD_L + p.x * plotW, y: yAt(v), color: moodFor(v).color };
      allDots.push(pt);
      seg.push(pt);
    }
    flush();
    const lastPt = (() => {
      for (let i = pts.length - 1; i >= 0; i--) if (pts[i].value != null) return { x: PAD_L + pts[i].x * plotW, y: yAt(pts[i].value!), color: moodFor(pts[i].value!).color };
      return { x: 0, y: 0, color: '#7C6AE0' };
    })();
    // ★ 折线按等级分段上色：每段（连续两点之间）用起点的 mood 颜色
    const colorLines: { d: string; color: string }[] = [];
    if (allDots.length >= 2) {
      let i = 0;
      while (i < allDots.length - 1) {
        const seg = [allDots[i]];
        let j = i + 1;
        // 同一 color 连续的点放一段
        while (j < allDots.length && allDots[j].color === allDots[i].color) {
          seg.push(allDots[j]);
          j++;
        }
        // 画 seg 折线
        if (seg.length >= 2) {
          let d = `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
          for (let k = 0; k < seg.length - 1; k++) {
            const a = seg[k]; const b = seg[k + 1];
            const mx = (a.x + b.x) / 2;
            d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          }
          colorLines.push({ d, color: seg[0].color });
        }
        i = j;
      }
    }
    return { lineD: line, areaD: area, colorLines, last: lastPt, dots: allDots };
  }, [w, pts]);

  const deltaPct =
    firstReal != null && current != null && firstReal !== 0
      ? Math.round(((current - firstReal) / Math.abs(firstReal)) * 100)
      : 0;

  // 轴标签：固定（日=时间轴）则均匀排；否则取 ~7 个等距点
  const renderAxis = () => {
    if (fixedAxis) {
      return DAY_AXIS.map((t, i) => (
        <Text key={i} style={styles.axisText}>
          {t}
        </Text>
      ));
    }
    const arr = axisLabels;
    if (arr.length <= 7) {
      return arr.map((t, i) => (
        <Text key={i} style={styles.axisText}>
          {t}
        </Text>
      ));
    }
    const pick = 7;
    const idxs = Array.from({ length: pick }, (_, i) => Math.floor((i * (arr.length - 1)) / (pick - 1)));
    return idxs.map((i) => (
      <Text key={i} style={styles.axisText}>
        {arr[i]}
      </Text>
    ));
  };

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>全天状态趋势</Text>
            <Text style={styles.sub}>状态指数 0–100（越高越有活力）</Text>
          </View>
          {hasData ? (
            <View style={styles.liveTag}>
              <Text style={styles.liveText}>真实数据</Text>
            </View>
          ) : null}
        </View>

        {/* 当前值 */}
        <View style={styles.hero}>
          <Text style={styles.heroVal}>{fmtVal(current)}</Text>
          <Text style={styles.heroUnit}>/ 100</Text>
          {hasData && deltaPct !== 0 ? (
            <Text style={[styles.delta, deltaPct > 0 ? styles.up : styles.down]}>
              {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较区间首点
            </Text>
          ) : null}
        </View>

        {/* 日 / 周 / 月 / 年 切换 */}
        <RangeSwitch value={range} onChange={setRange} />

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* 趋势图 */}
        <View style={styles.chartCard}>
          <View
            onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
            onTouchStart={(e) => {
              if (dots.length === 0) return;
              const touch = e.nativeEvent;
              const wScale = W / Math.max(w, 1);
              const svgX = touch.locationX * wScale;
              let best = -1, bestDist = Infinity;
              for (let i = 0; i < dots.length; i++) {
                const dd = Math.abs(dots[i].x - svgX);
                if (dd < bestDist) { bestDist = dd; best = i; }
              }
              if (best < 0) return;
              const d = dots[best];
              const ptsArr = pts as any[];
              const rawVal = ptsArr?.[best]?.value;
              const label = axisLabels[Math.min(best, axisLabels.length - 1)] ?? '';
              const lv = curveLevel(rawVal ?? 50, CURVE_DEFAULTS);
              const mo = MOODS[lv.index] ?? MOODS[1];
              setTip({
                x: d.x / wScale,
                y: d.y / wScale,
                label,
                value: fmtVal(rawVal),
                color: mo.color,
              });
            }}
            onTouchEnd={() => setTimeout(() => setTip(null), 2000)}
            pointerEvents="box-none"
          >
            {w > 0 ? (
              <Svg width={w} height={H}>
                <Defs>
                  <LinearGradient id="std_grad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.3} />
                    <Stop offset="100%" stopColor={theme.colors.accent1} stopOpacity={0.02} />
                  </LinearGradient>
                  <LinearGradient id="std_line" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} />
                    <Stop offset="100%" stopColor={theme.colors.accentSolid} />
                  </LinearGradient>
                </Defs>

                {/* ★ 4 等级横向背景带 */}
                {(() => {
                  const bands = [
                    { y0: CURVE_DEFAULTS.LEVEL_TOP, y1: Y_MAX, color: MOODS[0].color, opacity: 0.08 },  // 充沛
                    { y0: CURVE_DEFAULTS.LEVEL_MID, y1: CURVE_DEFAULTS.LEVEL_TOP, color: MOODS[1].color, opacity: 0.08 },  // 平稳
                    { y0: CURVE_DEFAULTS.LEVEL_LOW, y1: CURVE_DEFAULTS.LEVEL_MID, color: MOODS[2].color, opacity: 0.08 },  // 偏低
                    { y0: Y_MIN, y1: CURVE_DEFAULTS.LEVEL_LOW, color: MOODS[3].color, opacity: 0.08 },  // 不足
                  ];
                  return bands.map((b, i) => (
                    <Rect
                      key={`band-${i}`}
                      x={PAD_L}
                      y={yAt(b.y1)}
                      width={Math.max(0, W - PAD_L - PAD_R)}
                      height={Math.max(0, yAt(b.y0) - yAt(b.y1))}
                      fill={b.color}
                      opacity={b.opacity}
                    />
                  ));
                })()}

                {/* 量程参考线 */}
                {[Y_MIN, (Y_MIN + Y_MAX) / 2, Y_MAX].map((gv, i) => (
                  <Line
                    key={`g-${i}`}
                    x1={PAD_L}
                    y1={yAt(gv)}
                    x2={W - PAD_R}
                    y2={yAt(gv)}
                    stroke={theme.colors.ui.borderSoft}
                    strokeWidth={1}
                  />
                ))}

                {areaD ? <Path d={areaD} fill="url(#std_grad)" /> : null}
                {/* 主折线：白底，保证彩色段不会太细 */}
                {lineD ? (
                  <Path d={lineD} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
                {/* ★ 4 等级彩色分段折线 */}
                {colorLines.map((cl, i) => (
                  <Path key={`cline-${i}`} d={cl.d} fill="none" stroke={cl.color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {/* ★ 彩色数据点（按等级上色，白底描边更醒目） */}
                {dots.map((d, i) => (
                  <Circle key={`dot-${i}`} cx={d.x} cy={d.y} r={4.5} fill={d.color} stroke="#FFFFFF" strokeWidth={1.5} />
                ))}
              </Svg>
            ) : null}
            {/* ★ tooltip：点击显示白色详情框 */}
            {tip && w > 0 ? (() => {
              const TW = 110, TH = 60;
              let tipX = tip.x - TW / 2;
              if (tipX < 4) tipX = 4;
              if (tipX + TW > w - 4) tipX = w - 4 - TW;
              const tipY = Math.max(0, tip.y - TH - 12);
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

          {/* 无数据占位（诚实） */}
          {!hasData ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {range === 'day'
                  ? '今日状态曲线尚未生成，佩戴戒指并打开数据同步后将实时记录'
                  : '当前范围内暂无真实测量数据，开启数据同步并佩戴戒指后将逐日累积'}
              </Text>
            </View>
          ) : null}

          {/* X 轴标签 */}
          <View style={styles.axis}>{renderAxis()}</View>
        </View>

        {/* 统计：平均 / 最高 / 最低 */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>平均</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(avg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最高</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(hi)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最低</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(lo)}</Text>
          </View>
        </View>

        {/* 解读 */}
        <Text style={styles.note}>
          状态指数由当日心率变异、静息心率与睡眠恢复综合推算，反映整日活力节律。周 / 月为每日均值，年为每月均值，均来自戒指真实测量，缺口不补值。
        </Text>
      </View>
    </ScreenContainer>
  );
}

function firstNonNull(arr: (number | null)[]): number | null {
  for (const v of arr) if (v != null && Number.isFinite(v)) return v;
  return null;
}
function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i])) return arr[i]!;
  return null;
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { padding: theme.space.xs, marginRight: theme.space.sm },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  liveTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(111,207,180,0.16)',
  },
  liveText: { fontSize: theme.fontSize.micro, color: theme.colors.success, fontWeight: theme.weight.medium as any },
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroVal: { fontSize: 40, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  heroUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  delta: { fontSize: theme.fontSize.sm, marginLeft: 6 },
  up: { color: theme.colors.danger },
  down: { color: theme.colors.success },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.cardPad,
  },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.md },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statGrid: { flexDirection: 'row', gap: 10 },
  statCell: {
    flex: 1,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginTop: 2 },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.6 },
});
