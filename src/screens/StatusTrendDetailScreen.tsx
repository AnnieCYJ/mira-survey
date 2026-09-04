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
    arr.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
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

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  const statusDaily = ring.statusDaily ?? {};

  // 计算各区间的（点序列 + 轴标签 + 当前值 + 统计）
  const { pts, axisLabels, fixedAxis, current, firstReal, avg, hi, lo, hasData } = useMemo(() => {
    const anchorKey = `${anchor.getFullYear()}-${anchor.getMonth() + 1}-${anchor.getDate()}`;

    if (range === 'day') {
      const todayKey = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      if (anchorKey === todayKey) {
        const tl = (ring.statusTimeline ?? [])
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .map((p) => ({ t: p.t, value: p.value }))
          .sort((a, b) => a.t - b.t);
        const points = tl.map((p) => ({ x: dayFrac(p.t), value: p.value }));
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
        const tl = archived
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .map((p) => ({ t: p.t as number, value: p.value as number }))
          .sort((a, b) => a.t - b.t);
        const values = tl.map((p) => p.value);
        const points = tl.map((p) => ({ x: dayFrac(p.t), value: p.value }));
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
      const labels: string[] = [];
      const values: (number | null)[] = [];
      for (let mo = 0; mo < 12; mo++) {
        labels.push(`${mo + 1}月`);
        values.push(monthMean(statusDaily, y, mo));
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
    const keys: string[] = [];
    const labels: string[] = [];
    if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        keys.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
        labels.push(WEEK_LABEL[d.getDay()]);
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const d = new Date(y, m0, day);
        keys.push(`${y}-${m0 + 1}-${day}`);
        labels.push(`${day}`);
      }
    }
    const values = keys.map((k) => (statusDaily[k] != null ? statusDaily[k] : null));
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

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yAt = (v: number) => {
    const c = Math.max(Y_MIN, Math.min(Y_MAX, Number.isFinite(v) ? v : Y_MIN));
    return PAD_T + (1 - (c - Y_MIN) / (Y_MAX - Y_MIN || 1)) * plotH;
  };

  // 折线分段（遇 null 断线）；同时把所有真实点收集为散点，保证历史日单点/稀疏点也能看见。
  const { lineD, areaD, last, dots } = useMemo(() => {
    if (w === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
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
    for (const p of pts) {
      const v = p.value;
      if (v == null) {
        flush();
        continue;
      }
      const pt = { x: PAD_L + p.x * plotW, y: yAt(v) };
      allDots.push(pt);
      seg.push(pt);
    }
    flush();
    const lastPt = (() => {
      for (let i = pts.length - 1; i >= 0; i--) if (pts[i].value != null) return { x: PAD_L + pts[i].x * plotW, y: yAt(pts[i].value!) };
      return { x: 0, y: 0 };
    })();
    return { lineD: line, areaD: area, last: lastPt, dots: allDots };
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
    <ScreenContainer>
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
          <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
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
                {lineD ? (
                  <Path d={lineD} fill="none" stroke="url(#std_line)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
                {/* 所有真实数据点（小圆点），历史日单点/稀疏点也能看见 */}
                {dots.map((d, i) => (
                  <Circle key={`dot-${i}`} cx={d.x} cy={d.y} r={3.5} fill="#FFFFFF" stroke={theme.colors.accentSolid} strokeWidth={2} />
                ))}
              </Svg>
            ) : null}
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
            <Text style={styles.statValue}>{fmtVal(avg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最高</Text>
            <Text style={styles.statValue}>{fmtVal(hi)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最低</Text>
            <Text style={styles.statValue}>{fmtVal(lo)}</Text>
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
