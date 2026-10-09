/**
 * TempBiphasicChart —— 体温双相曲线（按日/周/月/年展示真实戒指体温数据）
 *
 * 数据来源：戒指真测体温。
 *   - 日：用 ring.history.temp 的今日时间槽，按 0–24 时绘制。
 *   - 周/月/年：用 ring.tempDaily 的每日日均体温，绘制最近 N 天。
 * 背景色带按「该日所处周期阶段」着色（基于用户记录的经期推算）。
 * 无数据时不造假，显示引导占位。
 *
 * SVG 内只画图形（线/带/网格/点），文字一律用 RN 层，避免 preserveAspectRatio 拉伸变形。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { computeCycle, dayKey, parseDate, tempDailyToSeries, type CycleLog } from '../lib/cycleMath';
import { phaseBand, type PhaseKey } from '../lib/phaseColors';
import PhaseLegend from './PhaseLegend';
import { cycleAxis } from '../lib/hormoneTrend';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import type { TimePoint } from '../ble/RingBleManager';

const W = 680;
const H = 200;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 14;
const Y_MIN = 35.5;
const Y_MAX = 37.6;
const DAY_MS = 86_400_000;

interface Props {
  tempDaily: Record<string, number>;
  tempHistory?: TimePoint[];
  log: CycleLog | null;
  range: RangeKey;
  /** 是否绘制自带标题行（默认 true）。外层已提供卡片标题时传 false，避免双标题。 */
  showHeader?: boolean;
  /** ★ 2026-10-07：跟随外层「周期切换」——指定周期首日与天数；不传则锚定当前周期 */
  cycleStart?: string | null;
  cycleDays?: number;
}

function daysInRange(range: RangeKey): number {
  switch (range) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    default:
      return 30;
  }
}

function formatDayLabel(d: Date, range: RangeKey): string {
  if (range === 'week') return `${d.getMonth() + 1}/${d.getDate()}`;
  if (range === 'month') return `${d.getMonth() + 1}/${d.getDate()}`;
  // year: 只显示月份，避免拥挤；具体由 axis 稀疏化控制
  return `${d.getMonth() + 1}月`;
}

function buildDaySeries(tempHistory: TimePoint[] | undefined): {
  pts: { t: number; v: number }[];
  labelFirst: string;
  labelLast: string;
} {
  const now = Date.now();
  const ds = new Date(now);
  ds.setHours(0, 0, 0, 0);
  const dayStart = ds.getTime();
  const pts = (tempHistory ?? [])
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= dayStart && p.t <= dayStart + DAY_MS)
    .sort((a, b) => a.t - b.t);
  return { pts, labelFirst: '0时', labelLast: '24时' };
}

function buildDailySeries(
  tempDaily: Record<string, number>,
  log: CycleLog | null,
  range: RangeKey,
  cycleStart?: string | null,
  cycleDays?: number
): {
  pts: { key: string; date: Date; v: number | null; phase: string }[];
  labelFirst: string;
  labelLast: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const seq: { key: string; date: Date; v: number | null; phase: string }[] = [];
  const push = (d: Date) => {
    const dd = new Date(d);
    dd.setHours(0, 0, 0, 0);
    const key = dayKey(dd);
    const v = tempDaily[key];
    const phase = computeCycle(log, dd, { tempSeries: tempDailyToSeries(tempDaily), periodHistory: log?.history }).phase;
    seq.push({ key, date: dd, v: v != null && Number.isFinite(v) ? v : null, phase });
  };
  // ★ 方案一（2026-10-07，用户：横轴要「按经期这一天开始算」）：
  //   有经期记录时横轴改为「周期第 1 天 → 第 N 天」（第 1 天 = 上次经期开始日）；
  //   没有记录时退回原来的「今天往前 N 天」滚动窗口。
  // ★ 2026-10-07：外层「周期切换」指定了周期时，按该周期首日锚定横轴
  const axis = cycleStart
    ? cycleAxis(log, today, { start: cycleStart, days: cycleDays ?? daysInRange(range) })
    : cycleAxis(log, today);
  if (axis) {
    for (let i = 0; i < axis.days; i++) {
      const d = new Date(axis.startMs);
      d.setDate(d.getDate() + i);
      push(d);
    }
  } else {
    const n = daysInRange(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      push(d);
    }
  }
  return {
    pts: seq,
    labelFirst: formatDayLabel(seq[0]?.date ?? today, range),
    labelLast: formatDayLabel(seq[seq.length - 1]?.date ?? today, range),
  };
}

export default function TempBiphasicChart({
  tempDaily,
  tempHistory,
  log,
  range,
  showHeader = true,
  cycleStart,
  cycleDays,
}: Props) {
  const isDay = range === 'day';

  const { pts, labelFirst, labelLast, validCount } = useMemo(() => {
    if (isDay) {
      const { pts: p, labelFirst: f, labelLast: l } = buildDaySeries(tempHistory);
      return { pts: p, labelFirst: f, labelLast: l, validCount: p.length };
    }
    const { pts: p, labelFirst: f, labelLast: l } = buildDailySeries(tempDaily, log, range, cycleStart, cycleDays);
    return { pts: p, labelFirst: f, labelLast: l, validCount: p.filter((x) => x.v != null).length };
  }, [tempDaily, tempHistory, log, range, isDay, cycleStart, cycleDays]);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const dayStart = isDay
    ? (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })()
    : 0;

  const xAtIndex = (i: number) => PAD_L + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2);
  const xAtTime = (t: number) => PAD_L + ((t - dayStart) / DAY_MS) * plotW;
  const yAt = (v: number) => {
    const c = Math.max(Y_MIN, Math.min(Y_MAX, v));
    return PAD_T + (1 - (c - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  };

  // 折线分段（遇缺口断开，不臆造连线）
  const segments: string[] = [];
  let cur = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as any;
    const v = p.v;
    if (v == null || !Number.isFinite(v)) {
      if (cur) {
        segments.push(cur);
        cur = '';
      }
      continue;
    }
    const x = isDay ? xAtTime(p.t) : xAtIndex(i);
    const y = yAt(v);
    cur += (cur ? ' L' : 'M') + ` ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  if (cur) segments.push(cur);

  // ★ 2026-10-07（用户：没有数据也要把卵泡期 / 排卵期那些相位背景带上）：
  //   周 / 月 / 年视图即使一个体温点都没有，也照常画出相位色带与参考网格，引导文案放到图下；
  //   日视图是日内曲线（没有相位背景可言），保持原来的占位引导。
  const noData = validCount === 0;
  if (noData && isDay) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>体温双相曲线</Text>
        <Text style={styles.emptyText}>
          今日暂无体温数据。戒指会自动采集皮肤温度，佩戴一段时间后即可看到日内趋势。
        </Text>
      </View>
    );
  }

  const only = validCount === 1 ? pts.find((p: any) => p.v != null) : null;
  const onlyPoint = only
    ? {
        x: isDay ? xAtTime((only as any).t) : xAtIndex(pts.indexOf(only as any)),
        y: yAt((only as any).v),
        v: (only as any).v,
      }
    : null;

  // ★ 方案一：当前是否用「周期天轴」（有经期记录时为真）
  const cycAxis = isDay
    ? null
    : cycleStart
      ? cycleAxis(log, new Date(), { start: cycleStart, days: cycleDays ?? daysInRange(range) })
      : cycleAxis(log, new Date());

  // ★ 2026-10-07（用户：体温卡横轴是「1~30 号」，而雌/孕激素卡是 9/8–10/7，对不上）：
  //   原因：RANGE_DEF[range].axis 是写死的「几号」（month）/ 「一~日」（week），
  //   而实际窗口是「今天往前 N 天」。周 / 月改为按真实日期出标签（起点 / 中点 / 今天），与激素卡一致。
  const axisLabels: string[] = (() => {
    if (isDay || (range !== 'week' && range !== 'month')) return RANGE_DEF[range].axis;
    // ★ 方案一：有经期记录时横轴出「周期第 N 天」（与激素趋势卡同一口径）
    if (cycAxis) {
      const nPts = pts.length;
      return [0, 0.25, 0.5, 0.75, 1].map((f) => `第 ${Math.round(1 + (nPts - 1) * f)} 天`);
    }
    const dp = pts as { date: Date }[];
    const fmt = (d?: Date) => (d ? `${d.getMonth() + 1}/${d.getDate()}` : '');
    return [fmt(dp[0]?.date), fmt(dp[Math.floor((dp.length - 1) / 2)]?.date), fmt(dp[dp.length - 1]?.date)];
  })();

  // 今天标记：周期轴下今天落在「第 N 天」的位置，画一条虚线
  const todayIdx = !isDay && cycAxis ? cycAxis.todayDay - 1 : -1;
  const showTodayLine = todayIdx >= 0 && todayIdx <= pts.length - 1;

  return (
      <View style={styles.wrap}>
        {showHeader && (
          <View style={styles.headRow}>
            <Text style={styles.title}>体温双相曲线</Text>
            <Text style={styles.range}>
              {labelFirst} – {labelLast} · °C
            </Text>
          </View>
        )}
        {showTodayLine && cycAxis ? (
          <View style={styles.todayRow}>
            <Text style={styles.todayText}>今天 · 第 {cycAxis.todayDay} 天</Text>
          </View>
        ) : null}
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* 周期阶段背景带（仅周/月/年有按日相位；日视图因是日内，不画阶段带） */}
        {!isDay &&
          (pts as { key: string; date: Date; v: number | null; phase: string }[]).map((p, i) => (
            <Rect
              key={`bg-${p.key}`}
              x={xAtIndex(i) - (plotW / (pts.length - 1 || 1)) / 2}
              y={PAD_T}
              width={plotW / (pts.length - 1 || 1)}
              height={plotH}
              fill={phaseBand(p.phase as PhaseKey)}
            />
          ))}
        {/* 今天 · 第 N 天：虚线标记（方案一） */}
        {showTodayLine ? (
          <Line
            x1={xAtIndex(todayIdx)}
            y1={PAD_T}
            x2={xAtIndex(todayIdx)}
            y2={PAD_T + plotH}
            stroke={theme.colors.accentText}
            strokeWidth={1.2}
            strokeDasharray="4 4"
            opacity={0.65}
          />
        ) : null}
        {/* 体温参考网格（36.0 / 36.5 / 37.0 / 37.5） */}
        {[36.0, 36.5, 37.0, 37.5].map((gv) => (
          <Line
            key={`g-${gv}`}
            x1={PAD_L}
            y1={yAt(gv)}
            x2={W - PAD_R}
            y2={yAt(gv)}
            stroke={theme.colors.ui.borderSoft}
            strokeWidth={1}
          />
        ))}
        {/* 双相折线 */}
        {segments.map((d, idx) => (
          <Path
            key={`ln-${idx}`}
            d={d}
            fill="none"
            stroke={theme.colors.accentSolid}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* 仅 1 个点时画一个标记 + 数值标签 */}
        {onlyPoint && (
          <>
            <Circle cx={onlyPoint.x} cy={onlyPoint.y} r={5} fill={theme.colors.accentSolid} stroke="#fff" strokeWidth={2} />
            <SvgText
              x={onlyPoint.x}
              y={onlyPoint.y - 10}
              textAnchor="middle"
              fontSize={11}
              fill={theme.colors.textTitle}
              fontWeight="600"
            >
              {onlyPoint.v.toFixed(2)}°C
            </SvgText>
          </>
        )}
      </Svg>
      {noData ? (
        <Text style={styles.hintText}>
          近段暂无日均体温数据。连续佩戴几天后，这里会自动画出体温曲线：经期偏低、排卵后明显升高。
        </Text>
      ) : validCount === 1 ? (
        <Text style={styles.hintText}>
          {isDay ? '已记录 1 个体温点，继续佩戴即可看到完整日内曲线。' : '已记录 1 天体温，再连续佩戴 2–3 天即可看到双相曲线。'}
        </Text>
      ) : null}
      <View style={styles.axisRow}>
        {axisLabels.map((t, i) => (
          <Text key={`${t}-${i}`} style={styles.axisText}>
            {t}
          </Text>
        ))}
      </View>
      <PhaseLegend />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.xs },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 },
  title: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  range: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  todayRow: { alignItems: 'flex-start', marginBottom: theme.sp(1), paddingHorizontal: 2 },
  todayText: { fontSize: theme.fontSize.micro, color: theme.colors.accentText },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2), paddingHorizontal: 2 },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hintText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 6, paddingHorizontal: 2 },
  empty: { paddingVertical: 26, alignItems: 'center', paddingHorizontal: 22 },
  emptyTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: 8 },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 21 },
});
