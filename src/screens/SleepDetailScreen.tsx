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
import {View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent, Pressable} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Rect, Line, Defs, LinearGradient, Stop, G, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { RingBle, type RingState, type SleepSummary, type SleepSegment } from '../ble/RingBleManager';
import SleepStageChart from '../components/SleepStageChart';
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
}

function parseKey(k: string): Date | null {
  const t = new Date(k + 'T00:00:00');
  return Number.isFinite(t.getTime()) ? t : null;
}

function fmtDur(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—';
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

export default function SleepDetailScreen() {
  const navigation = useNavigation<any>();
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [range, setRange] = useState<RangeKey>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);

  // ★ key 格式必须与 RingBleManager.dayKeyOf 一致 (YYYY-MM-DD 补零)，否则 sleepDaily map 永远匹配不上
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

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
    <ScreenContainer withGradient>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
          <Icon name="chevronLeft" size={22} color={theme.colors.textTitle} />
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
            // ★ 按 anchor 日期取那天的 segments + summary
            const dk = dayKey(anchor);
            const segs = ring.sleepStagesDaily?.[dk] ?? ring.sleepStages; // 回退：最新一天
            const summaryObj = ring.sleepDaily?.[dk] ?? null;
            // 从 sleepDaily 构造 SleepSummary（它不是完整接口，缺 score/awake/insomnia/sdkScore）
            const summary = summaryObj ? {
              total: summaryObj.total ?? 0,
              deep: summaryObj.deep ?? 0,
              light: summaryObj.light ?? 0,
              rem: summaryObj.rem ?? 0,
              score: ring.sleepSummary?.score ?? 0, // 用最新一天的自算分做兜底
              getUp: 0,
              sleepTime: ring.sleepTime ?? null,
              wakeTime: ring.wakeTime ?? null,
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
                <SleepStageChart segments={segs} sleepTime={ring.sleepTime} />
                {/* 单天摘要：4 张独立卡片，2x2 grid */}
                <View style={styles.statRow}>
                  <StatItem label="总时长" value={summary ? fmtDur(summary.total) : '—'} />
                  <StatItem label="深睡" value={summary ? fmtDur(summary.deep) : '—'} />
                </View>
                <View style={styles.statRow}>
                  <StatItem label="REM" value={summary ? fmtDur(summary.rem) : '—'} />
                  <StatItem label="睡眠评分" value={summary ? String(Math.round(summary.score)) : '—'} />
                </View>
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
                            color: h === 8 ? theme.colors.accent1 : theme.colors.textSub,
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
                    <LinearGradient id="sleepBar" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity={0.95} />
                      <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={0.55} />
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
                        fill={isSelected ? theme.colors.accentSolid : 'url(#sleepBar)'}
                        opacity={selectedBar != null && !isSelected ? 0.45 : 1}
                        onPress={() => setSelectedBar(selectedBar === i ? null : i)}
                      />
                    );
                  })}

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

      {/* 周 / 月 / 年 的统计摘要（柱状图模式） */}
      {range !== 'day' && (
        <>
          {/* 3 个独立卡片，1 行 3 列 */}
          <View style={styles.statRow}>
            <StatItem label="最新" value={fmtDur(current ?? 0)} />
            <StatItem label="均值" value={fmtDur(avg ?? 0)} />
            <StatItem label="最佳" value={fmtDur(best ?? 0)} />
          </View>
          {/* 3 个独立卡片，1 行 3 列（次要指标更低调） */}
          <View style={styles.statRow}>
            <StatItem label="深睡占比" value={fmtPct(deepAvg)} sub />
            <StatItem label="REM 占比" value={fmtPct(remAvg)} sub />
            <StatItem label="睡眠评分" value={scoreAvg != null ? String(Math.round(scoreAvg)) : '—'} sub />
          </View>
        </>
      )}

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

function StatItem({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  // sub: 次要指标（深睡%/REM%），用更低调的样式
  return (
    <View style={[styles.statCell, sub && styles.statCellSub]}>
      <Text style={[styles.statVal, sub && styles.statValSub]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{value}</Text>
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
  statRow: { flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.space.sm },
  statCell: {
    flex: 1,
    borderRadius: theme.radius.card,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.sm,
    alignItems: 'center',
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.ui.borderSoft,
  },
  statCellSub: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  statVal: {
    fontSize: theme.fontSize.card,   // ~18px，比 h2(22px) 小，不挤
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
    lineHeight: theme.fontSize.card + 4,
  },
  statValSub: {
    fontSize: theme.fontSize.sm,   // ~14px，次要指标更小
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium,
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) },
});
