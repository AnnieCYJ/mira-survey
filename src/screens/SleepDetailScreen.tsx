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
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Rect, Line, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { RingBle, type RingState, type SleepSummary } from '../ble/RingBleManager';
import { type RangeKey } from '../data/metrics';

const W = 680;
const H = 320;
const PAD_L = 16;
const PAD_R = 16;
const PAD_T = 22;
const PAD_B = 40;

interface DayRec {
  total: number;
  deep: number;
  light: number;
  rem: number;
  score: number;
  getUp: number;
}

function parseKey(k: string): Date | null {
  const t = new Date(k + 'T00:00:00');
  return Number.isFinite(t.getTime()) ? t : null;
}

function fmtDur(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
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
    arr.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
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

export default function SleepDetailScreen() {
  const navigation = useNavigation<any>();
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [range, setRange] = useState<RangeKey>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  const sleepDaily = ring.sleepDaily ?? {};

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

    // 以 anchor 为基准筛出窗口内的记录
    const dayKeyOf2 = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const inWindow = (r: { key: string; date: Date; rec: DayRec }): boolean => {
      if (range === 'day') {
        const lo = new Date(anchor); lo.setHours(0,0,0,0); lo.setDate(anchor.getDate()-13);
        const hi = new Date(anchor); hi.setHours(0,0,0,0);
        return r.date.getTime() >= lo.getTime() && r.date.getTime() <= hi.getTime();
      }
      if (range === 'week') {
        const monday = new Date(anchor); const dow=(anchor.getDay()+6)%7; monday.setDate(anchor.getDate()-dow); monday.setHours(0,0,0,0);
        const lo = new Date(monday); lo.setDate(monday.getDate()-9*7);
        return r.date.getTime() >= lo.getTime() && r.date.getTime() <= monday.getTime()+86400000-1;
      }
      const y = anchor.getFullYear();
      const m0 = range === 'month' ? anchor.getMonth() : 0;
      const lo = new Date(y, m0, 1);
      const hi = range === 'month' ? new Date(y, m0+1, 0) : new Date(y, 11, 31);
      return r.date.getTime() >= lo.getTime() && r.date.getTime() <= hi.getTime();
    };
    const win = recs.filter(inWindow);
    const winRecs = win.length ? win : recs;

    if (range === 'day') {
      const lo = new Date(anchor); lo.setHours(0,0,0,0); lo.setDate(anchor.getDate()-13);
      const keys: string[] = [];
      for (let i = 13; i >= 0; i--) { const d = new Date(lo); d.setDate(lo.getDate()+i); keys.push(dayKeyOf2(d)); }
      const map = new Map(winRecs.map((r) => [r.key, r.rec]));
      const vals = keys.map((k) => (map.has(k) ? (map.get(k)!.total as number) : null));
      const labels = keys.map((k) => { const d = parseKey(k); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; });
      return {
        bars: vals, axisLabels: labels, current: lastNonNull(vals), avg: meanOf(vals), best: maxOf(vals),
        deepAvg: meanOf(winRecs.slice(-14).map((r) => (r.rec.total > 0 ? (r.rec.deep / r.rec.total) * 100 : null))),
        remAvg: meanOf(winRecs.slice(-14).map((r) => (r.rec.total > 0 ? (r.rec.rem / r.rec.total) * 100 : null))),
        scoreAvg: meanOf(winRecs.slice(-14).map((r) => (r.rec.score != null ? r.rec.score : null))),
        hasData: vals.some((v) => v != null),
      };
    }

    if (range === 'week') {
      const weeks: { start: Date; vals: number[]; deep: number[]; rem: number[]; score: number[] }[] = [];
      const getWeekIdx = (d: Date) => { const monday = new Date(d); const dow=(d.getDay()+6)%7; monday.setDate(d.getDate()-dow); monday.setHours(0,0,0,0); return monday.getTime(); };
      const byWeek = new Map<number, typeof weeks[number]>();
      for (const r of winRecs) {
        const wid = getWeekIdx(r.date);
        if (!byWeek.has(wid)) { const start = new Date(wid); byWeek.set(wid, { start, vals: [], deep: [], rem: [], score: [] }); }
        const b = byWeek.get(wid)!;
        b.vals.push(r.rec.total);
        if (r.rec.total > 0) { b.deep.push((r.rec.deep / r.rec.total) * 100); b.rem.push((r.rec.rem / r.rec.total) * 100); }
        if (r.rec.score != null) b.score.push(r.rec.score);
      }
      const monday = new Date(anchor); const dow=(anchor.getDay()+6)%7; monday.setDate(anchor.getDate()-dow); monday.setHours(0,0,0,0);
      const startLo = new Date(monday); startLo.setDate(monday.getDate()-9*7);
      const sorted = Array.from(byWeek.values()).filter((w) => w.start.getTime() >= startLo.getTime() && w.start.getTime() <= monday.getTime()).sort((a,b)=>a.start.getTime()-b.start.getTime());
      const last = sorted.slice(-10);
      const vals = last.map((wk) => (wk.vals.length ? wk.vals.reduce((a,b)=>a+b,0)/wk.vals.length : null));
      const labels = last.map((wk) => `${wk.start.getMonth()+1}/${wk.start.getDate()}`);
      return {
        bars: vals, axisLabels: labels, current: lastNonNull(vals), avg: meanOf(vals), best: maxOf(vals),
        deepAvg: meanOf(last.flatMap((wk) => wk.deep)), remAvg: meanOf(last.flatMap((wk) => wk.rem)), scoreAvg: meanOf(last.flatMap((wk) => wk.score)),
        hasData: vals.some((v) => v != null),
      };
    }

    // month / year：以 anchor 所在自然月 / 年 聚合
    const y = anchor.getFullYear();
    const m0 = range === 'month' ? anchor.getMonth() : 0;
    const lo = new Date(y, m0, 1);
    const hi = range === 'month' ? new Date(y, m0+1, 0) : new Date(y, 11, 31);
    const buckets: { prefix: string; label: string; vals: number[]; deep: number[]; rem: number[]; score: number[] }[] = [];
    const byMonth = new Map<string, (typeof buckets)[number]>();
    for (const r of winRecs) {
      if (r.date.getTime() < lo.getTime() || r.date.getTime() > hi.getTime()) continue;
      const prefix = `${r.date.getFullYear()}-${r.date.getMonth() + 1}`;
      if (!byMonth.has(prefix)) byMonth.set(prefix, { prefix, label: `${r.date.getMonth()+1}月`, vals: [], deep: [], rem: [], score: [] });
      const b = byMonth.get(prefix)!;
      b.vals.push(r.rec.total);
      if (r.rec.total > 0) { b.deep.push((r.rec.deep / r.rec.total) * 100); b.rem.push((r.rec.rem / r.rec.total) * 100); }
      if (r.rec.score != null) b.score.push(r.rec.score);
    }
    const months = range === 'month' ? [m0] : Array.from({ length: 12 }, (_, i) => i);
    const seq = months.map((mo) => ({ prefix: `${y}-${mo+1}`, label: `${mo+1}月` }));
    const last = seq.map((s) => byMonth.get(s.prefix)).filter((x): x is (typeof buckets)[number] => x != null);
    const vals = last.map((b) => (b.vals.length ? b.vals.reduce((a,c)=>a+c,0)/b.vals.length : null));
    const labels = last.map((b) => b.label);
    return {
      bars: vals, axisLabels: labels, current: lastNonNull(vals), avg: meanOf(vals), best: maxOf(vals),
      deepAvg: meanOf(last.flatMap((b) => b.deep)), remAvg: meanOf(last.flatMap((b) => b.rem)), scoreAvg: meanOf(last.flatMap((b) => b.score)),
      hasData: vals.some((v) => v != null),
    };
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
    <ScreenContainer>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
          <Icon name="chevronLeft" size={22} color={theme.colors.textTitle} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>睡眠时长</Text>
          <Text style={styles.unit}>总睡眠时长 · 分钟</Text>
        </View>
      </View>

      <RangeSwitch value={range} onChange={setRange} />

      {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

      <View style={[styles.chartCard, theme.glass, theme.shadow.card]} onLayout={onLayout}>
        {!hasData ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              暂无可展示的睡眠记录。连接戒指并将每晚睡眠同步后，这里会自动绘制日 / 周 / 月 / 年睡眠时长柱状图。
            </Text>
          </View>
        ) : (
          w > 0 && (
            <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`}>
              <Defs>
                <LinearGradient id="sleepBar" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity={0.95} />
                  <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={0.55} />
                </LinearGradient>
              </Defs>
              {/* 8 小时参考线（健康睡眠锚点） */}
              {(() => {
                const y8 = yAt(480);
                return <Line x1={PAD_L} y1={y8} x2={W - PAD_R} y2={y8} stroke={theme.colors.ui.borderSoft} strokeWidth={1} strokeDasharray="4 4" />;
              })()}
              {bars.map((v, i) => {
                const cx = PAD_L + slot * i + slot / 2;
                const x = cx - barW / 2;
                if (v == null || !Number.isFinite(v)) {
                  // 缺口：淡占位
                  return (
                    <Rect
                      key={i}
                      x={x}
                      y={PAD_T + plotH - 4}
                      width={barW}
                      height={4}
                      rx={2}
                      fill={theme.colors.cardBgSoft}
                    />
                  );
                }
                const y = yAt(v);
                const h = PAD_T + plotH - y;
                return (
                  <Rect key={i} x={x} y={y} width={barW} height={Math.max(2, h)} rx={6} fill="url(#sleepBar)" />
                );
              })}
              {/* 数值标签（仅在有值处） */}
              {bars.map((v, i) => {
                if (v == null || !Number.isFinite(v)) return null;
                const cx = PAD_L + slot * i + slot / 2;
                const y = yAt(v);
                return (
                  <SvgTextLabel
                    key={`t${i}`}
                    x={cx}
                    y={Math.max(PAD_T + 12, y - 8)}
                    text={fmtDur(v)}
                    anchor="middle"
                  />
                );
              })}
              {/* X 轴标签 */}
              {axisLabels.map((lab, i) => {
                const cx = PAD_L + slot * i + slot / 2;
                return <SvgTextLabel key={`x${i}`} x={cx} y={H - PAD_B + 18} text={lab} anchor="middle" sub />;
              })}
            </Svg>
          )
        )}
      </View>

      {/* 统计摘要 */}
      <View style={[styles.statGrid, theme.glass, theme.shadow.card]}>
        <StatItem label="最新" value={fmtDur(current ?? 0)} />
        <StatItem label="均值" value={fmtDur(avg ?? 0)} />
        <StatItem label="最佳" value={fmtDur(best ?? 0)} />
      </View>
      <View style={[styles.statGrid, theme.glass, theme.shadow.card]}>
        <StatItem label="深睡占比" value={fmtPct(deepAvg)} />
        <StatItem label="REM 占比" value={fmtPct(remAvg)} />
        <StatItem label="睡眠评分" value={scoreAvg != null ? String(Math.round(scoreAvg)) : '—'} />
      </View>
    </ScreenContainer>
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

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
  back: { padding: theme.sp(1), marginLeft: -theme.sp(1) },
  titleWrap: { flexDirection: 'column' },
  title: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: theme.colors.textWhite },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  chartCard: { borderRadius: theme.radius.card, padding: theme.space.cardPad, marginBottom: theme.space.md, minHeight: H },
  emptyWrap: { height: H, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 22 },
  statGrid: { flexDirection: 'row', borderRadius: theme.radius.card, padding: theme.space.md, marginBottom: theme.space.md },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: theme.colors.accentSolid },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
});
