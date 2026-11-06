/**
 * SleepDualAxisChart —— 周 / 月 / 年「睡眠与恢复」双纵轴图
 *
 * ★ 2026-10-09：1:1 对齐设计稿 docs/sleep-recovery-preview.html（用户：预览什么样 App 就什么样）：
 *   - 轴标题「睡眠h / 恢复分」独立在刻度上方，不与刻度重叠；
 *   - 无参考虚线（预览没有）；
 *   - 恢复分面积 = 淡紫平涂 opacity 0.10（非重渐变）；
 *   - 柱 = 亮绿（左轴 h）、线 = 紫（右轴 0–100），平滑曲线 Catmull-Rom；
 *   - 皮质醇异常以**红点**标记（用户 2026-10-09 要求在周/月/年显示；点按红点开说明弹层）。
 *
 * ★ 2026-10-09 二次修正（用户反馈「点被挤了 + 横坐标不对」）：
 *   1) 几何：viewBox 宽度与实测容器宽 **1:1**（不再固定 680 配 preserveAspectRatio="none"）。
 *      旧写法把 680 宽横向压缩到 ~330px，圆点被拉成扁椭圆、柱宽也失真。
 *   2) 横轴标签：按实测文字宽居中（旧版 translateX:-50 是 **50dp 像素**，把每个标签整体左移
 *      50px → 与柱子错位；而 RN 0.74 的 transform 又不接受 "-50%" 百分比——传字符串会直接抛
 *      Render Error；固定宽盒又会互相压，故改为 onLayout 实测宽度反推 left）。
 *   3) 刻度密度走 chartAxis 统一规范（周=全标一…日 / 月=1号+每5天+末日 / 年=每3个月+末月）。
 *
 * 数据全部来自真实归档（sleepDaily）与真实算法，缺口留空不插值、不编造。
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Circle, Path } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';

const FALLBACK_W = 680;        // 未测到宽度前的兜底 viewBox 宽
// ★ 2026-10-10（chart-size-unified-spec）：L 档（详情主图 / 双轴），总高 240（原 380）
const H = chart.h.l;           // 总高（含轴标题带 + X 轴标签带）
// ★ 2026-11-05（用户「睡眠详情横坐标被裁掉」）：20 → 28。
//   首/末标签按 xAt 居中；原来 PAD 只有 20，遇到「30」「11月」这类两/三字标签时
//   半宽大于留白 → 被 clamp 推到容器边、与对应柱子错位，看起来像被裁掉。
const PAD_L = 28;
const PAD_R = 28;
// ★ 2026-10-10（规则 2：装饰带预算 ≤ 50pt，原 44+40=84 严重超标）
const PAD_T = 32;              // 顶部：轴标题带（独立于刻度，不重叠）
const PAD_B = 28;              // 底部：X 轴标签带
const Y_GUT_L = 44;            // 左侧 Y 轴刻度列宽（RN Text）
const Y_GUT_R = 40;            // 右侧 Y 轴刻度列宽

export interface DualPoint {
  /** 日键 YYYY-MM-DD */
  key: string;
  /** X 轴短标签 */
  label: string;
  /** 睡眠时长（分钟）；null = 缺口 */
  durationMin: number | null;
  /** 睡眠恢复分 0–100；null = 缺口 */
  score: number | null;
  /** 该天皮质醇是否异常（真实判定）；周/月/年图上以红点标记 */
  cortisolAbnormal: boolean;
  /** 异常类型，供外部弹层使用 */
  cortisolKind: 'high' | 'flat' | 'late' | 'normal';
}

interface Props {
  points: DualPoint[];
  /** 左轴上限（小时）；不传按数据自动取整到 2h 步进 */
  durMaxHours?: number;
  /** 皮质醇异常红点点击 → 打开说明弹层 */
  onAnomalyPress?: (p: DualPoint) => void;
}

export default function SleepDualAxisChart({ points, durMaxHours, onAnomalyPress }: Props) {
  const [w, setW] = useState(0);
  // X 轴标签实测宽度（用于精确居中，避免固定盒互相压 / transform 不收百分比）
  const [labelW, setLabelW] = useState<Record<number, number>>({});
  // ★ 视图宽 = 实测容器宽（1:1，杜绝横向压扁）；未测到前用兜底宽占位。
  const W = w > 0 ? w : FALLBACK_W;
  const n = Math.max(points.length, 1);
  const cw = W - PAD_L - PAD_R;
  const ch = H - PAD_T - PAD_B;

  // ── 纵轴量程 ──
  const durVals = points.map((p) => (p.durationMin != null ? p.durationMin / 60 : null)).filter((v): v is number => v != null);
  const durMax = durMaxHours ?? Math.max(4, Math.ceil((Math.max(...(durVals.length ? durVals : [0]), 1) * 1.15) / 2) * 2);

  const yDur = (h: number) => PAD_T + ch * (1 - Math.max(0, Math.min(1, h / durMax)));
  // ★ v18.134（审查 04 🔵-2）：恢复分是**个人相对分**（50 = 平时），可以合法为负或超 100。
  //   旧实现 `Math.max(0, Math.min(1, v / 100))` 把负分硬压到 0、超高分压到 100 →
  //   「-5 分」与「-50 分」在图上完全重叠。改为按数据实际范围自适应量程。
  const scoreVals = points.map((p) => p.score).filter((v): v is number => v != null && Number.isFinite(v));
  const scoreLo = scoreVals.length ? Math.min(0, ...scoreVals) : 0;
  const scoreHi = scoreVals.length ? Math.max(100, ...scoreVals) : 100;
  const scoreSpan = scoreHi - scoreLo || 100;
  const yScore = (v: number) => {
    const vv = Number.isFinite(v) ? v : scoreLo;
    const ratio = (vv - scoreLo) / scoreSpan;
    return PAD_T + ch * (1 - Math.max(0, Math.min(1, ratio)));
  };
  const xAt = (i: number) => (n <= 1 ? PAD_L + cw / 2 : PAD_L + (i / (n - 1)) * cw);
  const slot = cw / n;
  const barW = Math.max(3, Math.min(34, slot * 0.5));

  // 左轴刻度：每 2h（0h/2h/…/8h，深绿 + h 单位，同预览）
  const lTicks: number[] = [];
  for (let h = 0; h <= durMax + 0.001; h += 2) lTicks.push(h);
  // 右轴刻度：0/20/40/60/80/100；★ v18.134（审查 04 🔵-2）：量程自适应时刻度同步跟随
  const rTicks: number[] = (() => {
    if (scoreLo === 0 && scoreHi === 100) return [0, 20, 40, 60, 80, 100];
    const step = (scoreHi - scoreLo) / 5;
    return Array.from({ length: 6 }, (_, i) => Math.round((scoreLo + i * step) / 5) * 5);
  })();

  // X 轴标签：由数据点自带（父级按 chartAxis 规范填好，'' = 该点不标）
  const labelPoints = points.map((p, i) => ({ i, text: p.label })).filter((s) => !!s.text);

  // 平滑曲线（Catmull-Rom → bezier），缺口断开不插值
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

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View>
      <View style={styles.row}>
        {/* ── 左轴：睡眠时长（小时）—— 标题独立在上方，刻度深绿 + h 单位 ── */}
        <View style={{ width: Y_GUT_L, height: H }}>
          <Text style={[styles.axisTitle, { top: 8, right: 6 }]}>睡眠h</Text>
          {lTicks.map((h) => {
            const y = yDur(h);
            return (
              <Text key={`l${h}`} style={[styles.yText, { top: Math.max(0, y - 7), right: 6, color: chart.axis.left }]}>
                {h}h
              </Text>
            );
          })}
        </View>

        {/* ── 绘图区 ── */}
        <View style={{ flex: 1 }} onLayout={onLayout}>
          <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`}>
            {/* 水平网格（虚线，同预览 3 4） */}
            {lTicks.map((h) => (
              <Path key={`g${h}`}
                d={`M ${PAD_L} ${yDur(h)} H ${W - PAD_R}`}
                stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
            ))}

            {/* 恢复分面积：淡紫平涂 0.10（预览定稿，非重渐变） */}
            {runs.map((r, i) => (
              <Path key={`ar${i}`} d={r.area} fill={chart.series.primary} opacity={0.1} />
            ))}

            {/* 柱：睡眠时长（左轴 · 亮绿） */}
            {points.map((p, i) => {
              if (p.durationMin == null || !(p.durationMin > 0)) return null;
              const y = yDur(p.durationMin / 60);
              return (
                <Rect key={`b${i}`} x={xAt(i) - barW / 2} y={y} width={barW}
                  height={Math.max(2, PAD_T + ch - y)} rx={chart.barRadius} fill={chart.series.secondary} />
              );
            })}

            {/* 折线：恢复分（右轴 · 紫，平滑） */}
            {runs.map((r, i) => (
              <Path key={`l${i}`} d={r.line} fill="none" stroke={chart.series.primary}
                strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {points.map((p, i) => p.score == null ? null : (
              <Circle key={`d${i}`} cx={xAt(i)} cy={yScore(p.score)} r={chart.dot.radius}
                fill={chart.series.primary} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
            ))}

            {/* 皮质醇异常：红色圆点标记（周/月/年，用户要求显示在恢复分趋势线上；点按开说明弹层）。
                落在恢复分曲线该点位置，圆点覆盖紫点，白圈衬底更醒目；无恢复分时回退到柱顶。 */}
            {points.map((p, i) => {
              if (!p.cortisolAbnormal) return null;
              const yDot = p.score != null
                ? yScore(p.score)
                : ((p.durationMin != null && p.durationMin > 0) ? yDur(p.durationMin / 60) : PAD_T + ch * 0.25);
              return (
                <Circle key={`ca${i}`} cx={xAt(i)} cy={yDot} r={chart.dot.anomaly}
                  fill={theme.colors.danger} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke}
                  onPress={() => onAnomalyPress?.(p)} />
              );
            })}

          </Svg>
          {/* X 轴标签：RN Text；按数据点 xAt 居中。宽度由 onLayout 实测（RN 0.74 的 transform
              不接受 "-50%" 百分比、固定宽盒又会互相压），因此用真实宽度反推 left 并夹在容器内。 */}
          <View style={[styles.xAxisWrap, { width: w }]}>
            {w > 0 && labelPoints.map(({ i, text }) => {
              const tw = labelW[i] ?? 0;
              const cx = xAt(i);
              let left = tw > 0 ? cx - tw / 2 : cx;
              if (left < 0) left = 0;
              if (tw > 0 && left + tw > w) left = Math.max(0, w - tw);
              return (
                <Text
                  key={`x${i}`}
                  numberOfLines={1}
                  onLayout={(e) => {
                    const lw = e.nativeEvent.layout.width;
                    setLabelW((m) => (m[i] === lw ? m : { ...m, [i]: lw }));
                  }}
                  style={[styles.xLabel, { left, opacity: tw > 0 ? 1 : 0 }]}
                >
                  {text}
                </Text>
              );
            })}
          </View>
        </View>

        {/* ── 右轴：睡眠恢复分 0–100 —— 标题独立在上方 ── */}
        <View style={{ width: Y_GUT_R, height: H }}>
          <Text style={[styles.axisTitle, { top: 8, left: 5 }]}>恢复分</Text>
          {rTicks.map((v) => {
            const y = yScore(v);
            return (
              <Text key={`r${v}`} style={[styles.yText, { top: Math.max(0, y - 7), left: 5, color: chart.axis.right }]}>
                {v}
              </Text>
            );
          })}
        </View>
      </View>

      {/* 图例（同预览两项） */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBar, { backgroundColor: chart.series.secondary }]} />
          <Text style={styles.legendText}>睡眠时长（左轴 h）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBar, { backgroundColor: chart.series.primary, height: 2.5 }]} />
          <Text style={styles.legendText}>恢复分（右轴）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.danger }} />
          <Text style={styles.legendText}>皮质醇异常日</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  yText: { position: 'absolute', fontSize: theme.fontSize.xs, textAlign: 'right' },
  axisTitle: { position: 'absolute', fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  // X 轴标签容器：与绘图区等宽，标签按数据点 xAt 比例绝对定位、水平居中
  // ★ 2026-11-05：标签带高度 18 → 22，micro 字号不再下探贴底被下方元素压住
  xAxisWrap: { height: 22, position: 'relative', marginTop: 4 },
  xLabel: {
    position: 'absolute',
    top: 0,
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
  legendRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  legendBar: { width: 18, height: 8, borderRadius: 2 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
