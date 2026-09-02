/**
 * TempBiphasicChart —— 体温双相曲线（近 N 天日均体温）
 *
 * 数据来源：戒指真测体温，由 RingBleManager 按「每日」归档成 tempDaily（跨天累积、持久化）。
 * 背景色带按「该日所处周期阶段」着色（基于用户记录的经期推算），直观呈现
 * 经期低温 → 排卵后升高的双相特征。无数据时不造假，显示引导占位。
 *
 * SVG 内只画图形（线/带/网格/点），文字一律用 RN 层，避免 preserveAspectRatio 拉伸变形。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { computeCycle, dayKey, parseDate, tempDailyToSeries, type CycleLog } from '../lib/cycleMath';

const W = 680;
const H = 200;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 14;
const Y_MIN = 35.5;
const Y_MAX = 37.6;

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

export default function TempBiphasicChart({
  tempDaily,
  log,
  days = 30,
}: {
  tempDaily: Record<string, number>;
  log: CycleLog | null;
  days?: number;
}) {
  const today = new Date();
  const seq: { key: string; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    seq.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / (seq.length - 1);
  const xAt = (i: number) => PAD_L + i * step;
  const yAt = (v: number) => {
    const c = Math.max(Y_MIN, Math.min(Y_MAX, v));
    return PAD_T + (1 - (c - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  };

  const pts = seq.map((s, i) => {
    const v = tempDaily[s.key];
    return {
      i,
      x: xAt(i),
      v,
      y: v != null ? yAt(v) : null,
      phase: computeCycle(log, parseDate(s.key), {
        tempSeries: tempDailyToSeries(tempDaily),
        periodHistory: log?.history,
      }).phase,
    };
  });

  const validCount = pts.filter((p) => p.v != null).length;
  const only = validCount === 1 ? pts.find((p) => p.v != null)! : null;

  // 折线分段（遇缺口断开，不臆造连线）
  const segments: string[] = [];
  let cur = '';
  for (const p of pts) {
    if (p.y == null) {
      if (cur) {
        segments.push(cur);
        cur = '';
      }
      continue;
    }
    cur += (cur ? ' L' : 'M') + ` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  if (cur) segments.push(cur);

  if (validCount === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>体温双相曲线</Text>
        <Text style={styles.emptyText}>
          连续佩戴几天后，这里会自动画出体温曲线：经期偏低、排卵后明显升高，是判断排卵的典型信号。
        </Text>
      </View>
    );
  }

  const first = seq[0].label;
  const last = seq[seq.length - 1].label;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>体温双相曲线</Text>
        <Text style={styles.range}>{first} – {last} · °C</Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* 周期阶段背景带 */}
        {pts.map((p) => (
          <Rect
            key={`bg-${p.i}`}
            x={xAt(p.i) - step / 2}
            y={PAD_T}
            width={step}
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
        {/* 仅 1 个点时画一个标记 + 数值标签，避免「有背景无线」的误读 */}
        {only && (
          <>
            <Circle cx={only.x} cy={only.y!} r={5} fill={theme.colors.accentSolid} stroke="#fff" strokeWidth={2} />
            <SvgText
              x={only.x}
              y={(only.y! as number) - 10}
              textAnchor="middle"
              fontSize={11}
              fill={theme.colors.textTitle}
              fontWeight="600"
            >
              {only.v!.toFixed(2)}°C
            </SvgText>
          </>
        )}
      </Svg>
      {validCount === 1 && (
        <Text style={styles.hintText}>已记录 {validCount} 天体温，再连续佩戴 2–3 天即可看到双相曲线。</Text>
      )}
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space.xs, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: 5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hintText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 6, paddingHorizontal: 2 },
  empty: { paddingVertical: 26, alignItems: 'center', paddingHorizontal: 22 },
  emptyTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: 8 },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 21 },
});
