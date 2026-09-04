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

const PHASE_BG: Record<string, string> = {
  period: 'rgba(224,123,107,0.16)',
  follicular: 'rgba(124,106,224,0.10)',
  ovulation: 'rgba(111,207,180,0.20)',
  luteal: 'rgba(157,138,240,0.13)',
  unknown: 'rgba(138,138,168,0.05)',
};

const LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'follicular', label: '卵泡期', color: 'rgba(124,106,224,0.55)' },
  { key: 'ovulation', label: '排卵期', color: 'rgba(111,207,180,0.85)' },
  { key: 'luteal', label: '黄体期', color: 'rgba(157,138,240,0.7)' },
  { key: 'period', label: '经期', color: 'rgba(224,123,107,0.7)' },
];

interface Props {
  tempDaily: Record<string, number>;
  tempHistory?: TimePoint[];
  log: CycleLog | null;
  range: RangeKey;
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
  range: RangeKey
): {
  pts: { key: string; date: Date; v: number | null; phase: string }[];
  labelFirst: string;
  labelLast: string;
} {
  const today = new Date();
  const n = daysInRange(range);
  const seq: { key: string; date: Date; v: number | null; phase: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const v = tempDaily[key];
    const phase = computeCycle(log, d, { tempSeries: tempDailyToSeries(tempDaily), periodHistory: log?.history }).phase;
    seq.push({ key, date: d, v: v != null && Number.isFinite(v) ? v : null, phase });
  }
  return {
    pts: seq,
    labelFirst: formatDayLabel(seq[0]?.date ?? today, range),
    labelLast: formatDayLabel(seq[seq.length - 1]?.date ?? today, range),
  };
}

export default function TempBiphasicChart({ tempDaily, tempHistory, log, range }: Props) {
  const isDay = range === 'day';

  const { pts, labelFirst, labelLast, validCount } = useMemo(() => {
    if (isDay) {
      const { pts: p, labelFirst: f, labelLast: l } = buildDaySeries(tempHistory);
      return { pts: p, labelFirst: f, labelLast: l, validCount: p.length };
    }
    const { pts: p, labelFirst: f, labelLast: l } = buildDailySeries(tempDaily, log, range);
    return { pts: p, labelFirst: f, labelLast: l, validCount: p.filter((x) => x.v != null).length };
  }, [tempDaily, tempHistory, log, range, isDay]);

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

  if (validCount === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>体温双相曲线</Text>
        <Text style={styles.emptyText}>
          {isDay
            ? '今日暂无体温数据。戒指会自动采集皮肤温度，佩戴一段时间后即可看到日内趋势。'
            : '近段暂无日均体温数据。连续佩戴几天后，这里会自动画出体温曲线：经期偏低、排卵后明显升高。'}
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

  const axisLabels = RANGE_DEF[range].axis;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>体温双相曲线</Text>
        <Text style={styles.range}>
          {labelFirst} – {labelLast} · °C
        </Text>
      </View>
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
              fill={PHASE_BG[p.phase] ?? PHASE_BG.unknown}
            />
          ))}
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
      {validCount === 1 && (
        <Text style={styles.hintText}>
          {isDay ? '已记录 1 个体温点，继续佩戴即可看到完整日内曲线。' : '已记录 1 天体温，再连续佩戴 2–3 天即可看到双相曲线。'}
        </Text>
      )}
      <View style={styles.axisRow}>
        {axisLabels.map((t, i) => (
          <Text key={`${t}-${i}`} style={styles.axisText}>
            {t}
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.xs },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 },
  title: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  range: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2), paddingHorizontal: 2 },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space.xs, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: 5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hintText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 6, paddingHorizontal: 2 },
  empty: { paddingVertical: 26, alignItems: 'center', paddingHorizontal: 22 },
  emptyTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: 8 },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 21 },
});
