/**
 * StressTrendChart —— 心理压力 · 全天趋势图
 *
 * 放在「情绪洞察」页（首页心理压力卡点进来 / 洞察页情绪 tab，两处共用
 * `EmotionInsightView`，所以内容天然一致）。
 *
 * 数据源：`computeEmotionalStress()` 的 `slots`（30 分钟槽，0–47），
 * 与首页「心理压力」大数字读的是**同一份报告**（`stressScale` / `stressSlots`），
 * 所以趋势线与卡片分数必然同源，不会出现「线在低位、数字说中等」。
 *
 * 纵轴 = 心理压力 0–100 **百分位**（锚点 50 = 和你平时一样）。
 * 三档着色与 `psychologicalStressScale.STRESS_BANDS` 同源：
 *   低 <40 / 中 40–70 / 高 ≥70。
 *
 * 诚实边界：
 *  - 只有「判定成功」的槽才画点；无槽 = 不画，**不插值**；
 *  - 运动中 / 设备故障的槽不算「心理压力」，不参与连线（避免把走路时的 EDA 抖动画成压力尖峰）；
 *  - 全天无有效槽 → 显示「—」并说明原因，不放演示数据。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Circle, Line, Text as SvgText, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { DAY_HOUR_TICKS } from '../lib/chartAxis';
import { percentileFromZ } from '../lib/psychologicalStressScale';
import type { EmotionalStressReport, EmotionalStressSlot } from '../lib/emotionalStress';

const LEVELS: Array<{ min: number; color: string; band: string; label: string }> = [
  { min: 70, color: theme.colors.danger, band: theme.colors.dangerSoft, label: '高' },
  { min: 40, color: '#B98A2E', band: 'rgba(240,196,110,0.16)', label: '中' },
  { min: -1, color: theme.colors.success, band: theme.colors.successSoft, label: '低' },
];

export function stressColorOf(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return theme.colors.textSub;
  return LEVELS.find((l) => v >= l.min)!.color;
}

/** 单点（30 分钟槽粒度） */
export interface StressPoint {
  /** 30min 槽下标 0–47 */
  slot: number;
  /** 心理压力百分位 0–100 */
  value: number;
  /** 该槽是否有有效判定 */
  hasData: boolean;
  /** 该槽是否处于运动中（不参与连线） */
  isMoving: boolean;
}

/**
 * 从 `EmotionalStressReport` 抽趋势点。
 *
 * ★ 逐槽数值取 `featureDetail.bySlot[].fusedZ` → `percentileFromZ()`，
 *   与全天读数 `stressScale.value` **同一套换算**（`50 + 50·tanh(z/2)`），
 *   所以「趋势线的高低」和「卡片大数字」必然讲同一件事。
 *   ⚠ 不要拿 `slots[].level`（calm/mild/moderate/high 四档）当数值用 ——
 *     那是档位不是刻度，画出来只有 4 个台阶，看不出变化。
 *
 * 排除：`state` 为 moving / deviceFault / noData 的槽不给点（运动/故障/无数据
 * 都不是「心理压力」，混进去会把走路时的 EDA 抖动画成压力尖峰）。
 */
export function stressPointsOf(report: EmotionalStressReport | null | undefined): StressPoint[] {
  if (!report) return [];
  const stateBySlot = new Map<number, EmotionalStressSlot['state']>();
  for (const s of report.slots ?? []) stateBySlot.set(s.slot, s.state);

  const out: StressPoint[] = [];
  for (const b of report.featureDetail?.bySlot ?? []) {
    if (b.fusedZ == null) continue;
    const st = stateBySlot.get(b.slot);
    const moving = st === 'moving';
    out.push({
      slot: b.slot,
      value: percentileFromZ(b.fusedZ),
      // 运动槽即便有 fusedZ 也不画（它反映的是活动，不是压力）
      hasData: !moving && st !== 'deviceFault' && st !== 'noData',
      isMoving: moving,
    });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

interface Props {
  points: StressPoint[];
  /** 全天读数（用于副标题：value + 档位） */
  scale?: { value: number; bandLabel: string; caption: string } | null;
  /** 标注「此刻」竖线 */
  nowSlot?: number | null;
  chartH?: number;
  /** 睡眠时段：仅用于让曲线在睡眠窗内断开（不插值、不画夜间压力），不再绘制灰色遮罩 */
  sleepWindow?: { bedHour: number; wakeHour: number } | null;
}

export default function StressTrendChart({ points, scale, nowSlot, chartH, sleepWindow }: Props) {
  const [measuredW, setMeasuredW] = React.useState(0);
  // ★ 2026-10-07：pad 全面收窄 → plotW 变宽,横坐标更舒展
  const Y_W = theme.sp(6);        // 从 8 → 6,0/100 刻度够用
  const padL = Y_W + theme.sp(1); // sp(7) 原 sp(10)
  const padR = theme.sp(7);       // 原 sp(11),右侧档位标签够用
  const padT = theme.sp(1.5);
  const padB = theme.sp(5);       // 原 sp(6)
  // ★ 与 ReadinessTrendChart 同款修复：未测到宽度时不再用 estW 顶替（那会让图先按窄屏宽渲染、
  //   显得小且居中）；测到真实宽度后画满整行 → 图自然变宽、贴齐卡片左右。
  const svgW = measuredW > padL + padR ? measuredW : 0;
  const svgH = (chartH ?? theme.sp(44)) - theme.sp(2);
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const N = 48; // 30min 槽
  const xAt = (slot: number) => padL + (plotW * slot) / N;
  const yAt = (v: number) => padT + plotH - (v / 100) * plotH;

  // ★ 2026-10-10（用户：睡眠中不展示心理压力）：睡眠窗内的槽不参与连线 ——
  //   曲线在睡眠时段**真正断开**（不再只是盖一层灰色遮罩），与「夜间为睡眠，不展示压力数据」口径一致。
  const inSleep = (slot: number): boolean => {
    if (!sleepWindow) return false;
    const bedS = Math.max(0, Math.min(47, Math.floor(sleepWindow.bedHour * 2)));
    const wakeS = Math.max(0, Math.min(47, Math.floor(sleepWindow.wakeHour * 2)));
    if (bedS === wakeS) return false;
    if (bedS < wakeS) return slot >= bedS && slot <= wakeS;
    return slot >= bedS || slot <= wakeS; // 跨午夜
  };
  // 连续有值区段（运动槽/缺口/睡眠窗 断开，不插值）
  const runs: number[][] = [];
  {
    let cur: number[] = [];
    for (let s = 0; s < N; s++) {
      const p = points.find((q) => q.slot === s);
      if (p?.hasData && !inSleep(s)) cur.push(s);
      else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }
  // ★ 折线平滑: Catmull-Rom spline → SVG cubic bezier
  const smoothPath = (idx: number[]) => {
    if (idx.length < 2) return '';
    const pts = idx.map((s) => ({ x: xAt(s), y: yAt(points.find((q) => q.slot === s)!.value) }));
    if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const lineOf = (idx: number[]) => smoothPath(idx);
  const areaOf = (idx: number[]) =>
    `${lineOf(idx)} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(idx[0]).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const anyData = points.some((p) => p.hasData);
  // ★ 2026-10-09：日视图小时刻度统一走 chartAxis.DAY_HOUR_TICKS（★ 2026-11-05 起每 6 小时：0/6/12/18/24），
  //   与 ReadinessTrendChart / CognitiveLoadCard / RANGE_DEF 完全一致。
  const MAIN_HOURS = [...DAY_HOUR_TICKS];

  return (
    <View>
      {scale ? (
        <View style={styles.headRow}>
          <Text style={[styles.scaleVal, { color: stressColorOf(scale.value) }]}>{scale.value}</Text>
          <Text style={styles.scaleUnit}>/100 · {scale.bandLabel}</Text>
        </View>
      ) : null}

      <View
        onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
        style={{ width: '100%' }}
      >
        {svgW > 0 ? (
        <Svg width={svgW} height={svgH + theme.sp(2)}>
          <Defs>
            <SvgLinear id="stressArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={chart.series.primary} stopOpacity={0.22} />
              <Stop offset="100%" stopColor={chart.series.primary} stopOpacity={0.01} />
            </SvgLinear>
          </Defs>

          {/* ★ 2026-10-06（用户口径）：纵轴 = 心理压力 0-100，三档柔和背景带 + 右侧低/中/高标注。
              压力语义与准备度相反：低压力=绿(好) / 中=黄 / 高压力=红。 */}
          {[0, 1, 2].map((i) => {
            const hi = i === 0 ? 100 : i === 1 ? 70 : 40;
            const lo = i === 0 ? 70 : i === 1 ? 40 : 0;
            return (
              <Rect key={'sband' + i} x={padL} y={yAt(hi)} width={plotW} height={Math.max(0, yAt(lo) - yAt(hi))}
                fill={LEVELS[i].color} opacity={0.07} />
            );
          })}

          {/* 0 基线（网格线 token：线宽 1 + 3 4 虚线） */}
          <Path d={`M ${padL} ${yAt(0)} L ${padL + plotW} ${yAt(0)}`} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
          {/* 40 / 70 档位边界（参考基准虚线 token：线宽 1.3 + 5 4 虚线） */}
          {[40, 70].map((v) => (
            <Path key={v} d={`M ${padL} ${yAt(v)} L ${padL + plotW} ${yAt(v)}`}
              stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} />
          ))}
          {/* 数值刻度锚点（0 / 100）—— 确认纵轴 0–100 尺度 */}
          <SvgText key="y100" x={padL - theme.sp(1.5)} y={yAt(100) + 3} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>100</SvgText>
          <SvgText key="y0" x={padL - theme.sp(1.5)} y={yAt(0) + 3} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>0</SvgText>

          {/* 面积 + 折线：单一强调色（token primary），与认知准备度趋势图（脑力页）保持一致 */}
          {runs.map((idx, i) => idx.length > 1 ? (
            <React.Fragment key={'r' + i}>
              <Path d={areaOf(idx)} fill="url(#stressArea)" />
              <Path d={lineOf(idx)} fill="none" stroke={chart.series.primary}
                strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
            </React.Fragment>
          ) : (
            <Circle key={'p' + i} cx={xAt(idx[0])} cy={yAt(points.find((q) => q.slot === idx[0])!.value)} r={chart.dot.radius}
              fill={chart.series.primary} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
          ))}

          {/* 「此刻」竖线 */}
          {nowSlot != null && nowSlot >= 0 && nowSlot < N ? (
            <Line x1={xAt(nowSlot)} y1={padT} x2={xAt(nowSlot)} y2={padT + plotH}
              stroke={chart.series.primary} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} opacity={0.5} />
          ) : null}

          {/* 右侧档位标注：低压力 / 中压力 / 高压力（纵轴 0-100 分区） */}
          {[
            { label: '高压力', v: 85, color: theme.colors.danger },
            { label: '中压力', v: 55, color: '#B98A2E' },
            { label: '低压力', v: 20, color: theme.colors.success },
          ].map((b) => (
            <SvgText key={'slvl' + b.label} x={padL + plotW + theme.sp(1.5)} y={yAt(b.v) + 3}
              textAnchor="start" fontSize={theme.fontSize.micro} fill={b.color} fontWeight="600">{b.label}</SvgText>
          ))}
          {/* X 轴（每 3 小时） */}
          {MAIN_HOURS.map((h) => {
            const slot = h * 2;
            const x = h === 24 ? padL + plotW : xAt(slot);
            const align = h === 0 ? 'start' : h >= 24 ? 'end' : 'middle';
            return (
              <SvgText key={h} x={x} y={padT + plotH + theme.sp(4)} textAnchor={align}
                fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>{String(h).padStart(2, '0')}</SvgText>
            );
          })}
        </Svg>
        ) : null}
      </View>

      <Text style={styles.caption}>
        {anyData
          ? `纵轴 = 心理压力 0–100（越高越紧张，50 为你的个人基线）· 每点 30 分钟${scale ? ' · ' + scale.caption : ''}`
          : '今天还没有可判定的时段 · 连上戒指开启自动监测后开始生成（约需 3 天建立个人基线）'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: theme.space.xs },
  scaleVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any },
  scaleUnit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  caption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1), lineHeight: 16 },
});
