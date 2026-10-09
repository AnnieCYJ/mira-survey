/**
 * SleepDualAxisChart —— 周 / 月 / 年「睡眠与恢复」双纵轴图
 *
 * 对齐 preview/sleep-rhythm.html v9 原型：
 *   柱 = 睡眠时长（左纵轴「睡眠 h」）／ 折线 = 睡眠恢复分（右纵轴「恢复」0–100）
 *   · 去掉柱顶数值标签，改由左纵轴刻度读取；
 *   · 两条参考虚线：时长个人均值（左轴 · limeDeep）、恢复分个人基线（右轴 · ink）；
 *   · 恢复分线为平滑曲线（Catmull-Rom → bezier，与 StressTrendChart 同款）；
 *   · 皮质醇异常天在**当天恢复分数据点**上叠「红底白!」标记（#E2554E，复刻
 *     StatusTrendDetailScreen 标法），且**可点击** → 回调 onAnomalyPress 弹出该日皮质醇异常说明。
 *
 * 数据全部来自真实归档（sleepDaily）与真实算法（computeSleepScore / analyzeCortisol），
 * 缺口留空不插值、不编造。
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line, Circle, Path, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

const W = 680;                 // viewBox 宽（与现有 SleepDetailScreen 一致）
const H = 340;                 // 绘图区高
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 26;              // 顶部留白（给 icon）
const PAD_B = 8;
const Y_GUT_L = 34;            // 左侧 Y 轴刻度列宽（HTML Text）
const Y_GUT_R = 30;            // 右侧 Y 轴刻度列宽

/** 恢复分异常 icon 的颜色（与 App 内 StatusTrendDetailScreen / 周期状态趋势同源） */
const CORT_COLOR = '#E2554E';

export interface DualPoint {
  /** 日键 YYYY-MM-DD */
  key: string;
  /** X 轴短标签 */
  label: string;
  /** 睡眠时长（分钟）；null = 缺口 */
  durationMin: number | null;
  /** 睡眠恢复分 0–100；null = 缺口 */
  score: number | null;
  /** 该天皮质醇是否异常（真实判定）；用于叠 icon */
  cortisolAbnormal: boolean;
  /** 异常类型，供弹层区分「偏高 / 偏平 / 后移」 */
  cortisolKind: 'high' | 'flat' | 'late' | 'normal';
}

interface Props {
  points: DualPoint[];
  /** 左轴上限（小时）；不传按数据自动取整到 2h 步进 */
  durMaxHours?: number;
  onAnomalyPress?: (p: DualPoint) => void;
}

export default function SleepDualAxisChart({ points, durMaxHours, onAnomalyPress }: Props) {
  const [w, setW] = useState(0);
  const n = Math.max(points.length, 1);
  const cw = W - PAD_L - PAD_R;
  const ch = H - PAD_T - PAD_B;

  // ── 纵轴量程 ──
  const durVals = points.map((p) => (p.durationMin != null ? p.durationMin / 60 : null)).filter((v): v is number => v != null);
  const scoreVals = points.map((p) => p.score).filter((v): v is number => v != null);
  const durMax = durMaxHours ?? Math.max(4, Math.ceil((Math.max(...(durVals.length ? durVals : [0]), 1) * 1.15) / 2) * 2);
  const durAvg = durVals.length ? durVals.reduce((a, b) => a + b, 0) / durVals.length : null;
  const scoreBase = scoreVals.length ? scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length : null;

  const yDur = (h: number) => PAD_T + ch * (1 - Math.max(0, Math.min(1, h / durMax)));
  const yScore = (v: number) => PAD_T + ch * (1 - Math.max(0, Math.min(1, v / 100)));
  const xAt = (i: number) => (n <= 1 ? PAD_L + cw / 2 : PAD_L + (i / (n - 1)) * cw);
  const slot = cw / n;
  const barW = Math.max(2.5, Math.min(24, slot * 0.5));

  // 左轴刻度：每 2h
  const lTicks: number[] = [];
  for (let h = 0; h <= durMax + 0.001; h += 2) lTicks.push(h);
  // 右轴刻度：0/20/40/60/80/100
  const rTicks = [0, 20, 40, 60, 80, 100];

  // X 轴标签：≤12 全画，>12 取 7 个等距
  const labelIdx = n <= 12 ? points.map((_, i) => i) : Array.from({ length: 7 }, (_, i) => Math.floor((i * (n - 1)) / 6));

  // 曲线 + 面积：按「连续有分数」的区段切分，断点自然断开（缺口不插值）。
  // ★ 2026-10-08（用户口径）：恢复分线改平滑曲线 —— Catmull-Rom spline → SVG cubic bezier
  //   （与 StressTrendChart 同款算法），不再是硬折线。
  const smoothOf = (idx: number[]): string => {
    if (idx.length < 2) return idx.length === 1 ? `M ${xAt(idx[0]).toFixed(1)} ${yScore(points[idx[0]].score!).toFixed(1)}` : '';
    const pts = idx.map((i) => ({ x: xAt(i), y: yScore(points[i].score!) }));
    if (pts.length === 2) {
      return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const runs: { line: string; area: string }[] = [];
  {
    let idx: number[] = [];
    const flush = () => {
      if (idx.length === 0) return;
      const line = smoothOf(idx);
      const area = `${line} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${PAD_T + ch} L ${xAt(idx[0]).toFixed(1)} ${PAD_T + ch} Z`;
      runs.push({ line, area });
      idx = [];
    };
    points.forEach((p, i) => { if (p.score == null) flush(); else idx.push(i); });
    flush();
  }

  const anomIdx = points.map((p, i) => (p.cortisolAbnormal ? i : -1)).filter((i) => i >= 0);

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View>
      <View style={styles.row}>
        {/* ── 左轴：睡眠时长（小时） ── */}
        <View style={{ width: Y_GUT_L, height: H }}>
          {lTicks.map((h) => {
            const y = yDur(h);
            return (
              <Text key={`l${h}`} style={[styles.yText, { top: Math.max(0, y - 7), right: 4, color: mm.colors.limeDeep }]}>
                {h}
              </Text>
            );
          })}
          <Text style={[styles.axisTitle, { top: 4, right: 4 }]}>睡眠h</Text>
        </View>

        {/* ── 绘图区 ── */}
        <View style={{ flex: 1 }} onLayout={onLayout}>
          <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="dualArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={mm.colors.purpleCore} stopOpacity={0.16} />
                <Stop offset="100%" stopColor={mm.colors.purpleCore} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* 水平网格 */}
            {lTicks.map((h) => (
              <Line key={`g${h}`} x1={PAD_L} y1={yDur(h)} x2={W - PAD_R} y2={yDur(h)}
                stroke={theme.colors.ui.borderSoft} strokeWidth={1} strokeDasharray="3 4" />
            ))}

            {/* 参考虚线：时长个人均值（左轴） */}
            {durAvg != null && durAvg > 0 && (
              <Line x1={PAD_L} y1={yDur(durAvg)} x2={W - PAD_R} y2={yDur(durAvg)}
                stroke={mm.colors.limeDeep} strokeWidth={1.3} strokeDasharray="5 4" opacity={0.55} />
            )}
            {/* 参考虚线：恢复分个人基线（右轴） */}
            {scoreBase != null && (
              <Line x1={PAD_L} y1={yScore(scoreBase)} x2={W - PAD_R} y2={yScore(scoreBase)}
                stroke={mm.colors.ink} strokeWidth={1.3} strokeDasharray="5 4" opacity={0.32} />
            )}

            {/* 恢复分面积（先画，置于柱之下，避免染绿柱） */}
            {runs.map((r, i) => (
              <Path key={`ar${i}`} d={r.area} fill="url(#dualArea)" />
            ))}

            {/* 柱：睡眠时长（左轴） */}
            {points.map((p, i) => {
              if (p.durationMin == null || !(p.durationMin > 0)) return null;
              const y = yDur(p.durationMin / 60);
              return (
                <Rect key={`b${i}`} x={xAt(i) - barW / 2} y={y} width={barW}
                  height={Math.max(2, PAD_T + ch - y)} rx={3} fill={mm.colors.limeMid} />
              );
            })}

            {/* 折线：恢复分（右轴） */}
            {runs.map((r, i) => (
              <Path key={`l${i}`} d={r.line} fill="none" stroke={mm.colors.purpleCore}
                strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {points.map((p, i) => p.score == null ? null : (
              <Circle key={`d${i}`} cx={xAt(i)} cy={yScore(p.score)} r={2.6}
                fill={mm.colors.purpleCore} stroke={theme.colors.cardBg} strokeWidth={1.2} />
            ))}

            {/* 皮质醇异常标记（可点击）。
                ★ 2026-10-08（用户反馈「红点挤成一条」）：不再把所有「!」钉在顶部同一行 ——
                月视图 30 天里相邻异常天的图标 + 虚线会糊成一条红带。
                改为标记**落在当天的恢复分数据点上**，随曲线散开；
                ★ 2026-10-09（用户反馈「不要长条、要圆」）：去掉白垫底圈，改成「红底 + 白描边」的干净圆点，
                无白圈光晕、不被看成带把的长条。 */}
            {anomIdx.map((i) => {
              const p = points[i];
              const hasScore = p.score != null;
              const cx = xAt(i);
              const cy = hasScore ? yScore(p.score!) : PAD_T + 10;
              return (
                <G key={`a${i}`} onPress={onAnomalyPress ? () => onAnomalyPress(p) : undefined}>
                  {/* 透明大热区，方便手指点中 */}
                  <Circle cx={cx} cy={cy} r={13} fill="transparent" />
                  {/* 干净圆形标记：红底 + 白描边（无白垫底圈） */}
                  <Circle cx={cx} cy={cy} r={5} fill={CORT_COLOR} stroke={theme.colors.cardBg} strokeWidth={1.5} />
                  {hasScore ? <SvgTextX x={cx} y={cy} /> : null}
                </G>
              );
            })}
          </Svg>
        </View>

        {/* ── 右轴：睡眠恢复分 ── */}
        <View style={{ width: Y_GUT_R, height: H }}>
          {rTicks.map((v) => {
            const y = yScore(v);
            return (
              <Text key={`r${v}`} style={[styles.yText, { top: Math.max(0, y - 7), left: 3, color: mm.colors.purpleDeep }]}>
                {v}
              </Text>
            );
          })}
          <Text style={[styles.axisTitle, { top: 4, left: 3 }]}>恢复</Text>
        </View>
      </View>

      {/* X 轴标签 */}
      <View style={[styles.xRow, { marginLeft: Y_GUT_L, marginRight: Y_GUT_R }]}>
        {labelIdx.map((i) => (
          <Text key={`x${i}`} style={styles.xText}>{points[i]?.label ?? ''}</Text>
        ))}
      </View>

      {/* 图例 */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBar, { backgroundColor: mm.colors.limeMid }]} />
          <Text style={styles.legendText}>睡眠时长（左轴 h）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBar, { backgroundColor: mm.colors.purpleCore, height: 2.5 }]} />
          <Text style={styles.legendText}>恢复分（右轴）</Text>
        </View>
        {anomIdx.length > 0 && (
          <PressableLegend />
        )}
      </View>
    </View>
  );
}

/** 「!」字形：极简感叹号（一竖一点），按 r=5 的红点尺寸调的比例 */
function SvgTextX({ x, y }: { x: number; y: number }) {
  return (
    <G>
      <Line x1={x} y1={y - 2.9} x2={x} y2={y + 0.3} stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={x} cy={y + 2.7} r={0.9} fill="#FFFFFF" />
    </G>
  );
}

function PressableLegend() {
  return (
    <View style={styles.legendItem}>
      <View style={styles.anomDot} />
      <Text style={styles.legendText}>皮质醇异常</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  yText: { position: 'absolute', fontSize: theme.fontSize.micro, textAlign: 'right' },
  axisTitle: { position: 'absolute', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  xRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  xText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  legendBar: { width: 18, height: 8, borderRadius: 2 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  anomDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: CORT_COLOR },
});
