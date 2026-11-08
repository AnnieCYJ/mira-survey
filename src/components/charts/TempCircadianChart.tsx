import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line, Path, Text as SvgText } from 'react-native-svg';
import { theme } from '../../theme/theme';
import { mm } from '../../theme/mindmate';
import { chart } from '../../theme/chart';
import { DAY_HOUR_TICKS, hourTickLabel } from '../../lib/chartAxis';
import { TEMP_BAND_C, type TempBaseline } from '../../lib/tempBaseline';

/**
 * TempCircadianChart —— 体温「偏离个人基线」的昼夜节律曲线（2026-10-10 建立）
 *
 * ★ 口径完全对齐 Oura：
 *   - Oura **不报绝对皮肤温度**，只报 `temperature_deviation`（偏离个人基线多少度）
 *   - 白天受吃喝 / 运动 / 环境干扰，只有**睡眠时段**的体温有信息量
 *   - 对 Mira 更有价值的是**曲线形状**：黄体期整体上移（约 +0.3~0.5℃）
 *
 * ★ 图的三个要素：
 *   1. 正常带（±band，浅黄绿半透明横带）——日常波动范围
 *   2. 0 线（个人基线本身，虚线）
 *   3. 今日偏离曲线（面积 + 线），缺口断开不插值
 *
 * ★ Y 轴是**偏离量（Δ℃）**，不是绝对温度——绝对值藏在标题行里，避免 Y 轴冒出 35~38 这种无信息量刻度。
 */

interface Props {
  /** 48 槽偏离序列（℃），null = 无有效数据 */
  dev: (number | null)[];
  /** 基线信息（决定正常带宽度与「建立基线中」提示） */
  baseline: TempBaseline;
  /** Y 轴半幅（℃）；不给则按数据自适应，下限 TEMP_BAND_C */
  span?: number;
  /** 绘图区净高，默认 `chart.plot.m`（体温是 m 档） */
  height?: number;
  /** 当前时刻；之后的槽不画（轴仍画满 24h） */
  nowMs?: number;
}

const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 14;
// ★ 2026-11-05（用户「横坐标被遮挡 / 裁掉」）：20 → 28，让底部 Y 轴刻度与 X 轴标签带分开
const AXIS_H = 28;

export default function TempCircadianChart({
  dev,
  baseline,
  span,
  height,
  nowMs,
}: Props) {
  const plotH = height ?? chart.plot.m;
  const H = PAD_T + plotH + AXIS_H;
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const plotW = Math.max(0, w - PAD_L - PAD_R);
  const now = nowMs ?? Date.now();

  const half = useMemo(() => {
    if (span && span > 0) return span;
    let m = TEMP_BAND_C;
    for (const v of dev) if (v != null && Math.abs(v) > m) m = Math.abs(v);
    return Math.ceil((m + 0.1) * 10) / 10;
  }, [dev, span]);

  const geom = useMemo(() => {
    if (w <= 0) return null;
    const n = Math.max(1, dev.length);
    const slotW = plotW / n;
    const baseY = PAD_T + plotH;
    const yOf = (v: number) => PAD_T + plotH * (1 - (v + half) / (half * 2));
    const xOf = (i: number) => PAD_L + slotW * (i + 0.5);

    const bandTop = yOf(baseline.band);
    const bandH = Math.max(1, yOf(-baseline.band) - bandTop);

    // 曲线：连续有值的段才连（缺口断开，不插值）
    const segs: { x: number; y: number }[][] = [];
    let seg: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const v = dev[i];
      if (v == null) { flushSeg(); continue; }
      if (slotStartMs(i, n) > now) { flushSeg(); continue; }   // 未来的槽不画
      seg.push({ x: xOf(i), y: yOf(v) });
    }
    flushSeg();

    function flushSeg() {
      if (seg.length >= 2) { segs.push(seg); }
      seg = [];
    }

    const lines = segs.map((s) => `M ${s.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`);
    const areas = segs.map(
      (s) =>
        `M ${s.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}` +
        ` L ${s[s.length - 1].x.toFixed(1)} ${baseY} L ${s[0].x.toFixed(1)} ${baseY} Z`,
    );

    // ★ 2026-11-05：X 轴标签统一 middle 锚点 + 半宽 clamp，首末不再贴边被裁。
    const labelHalf = (s: string) => (s.length * chart.axisFont * 0.62) / 2;
    const ticks: React.ReactNode[] = DAY_HOUR_TICKS.map((hh) => {
      const rawX = PAD_L + (plotW * hh) / 24;
      const label = hourTickLabel(hh);
      const lh = labelHalf(label);
      const x = Math.max(PAD_L + lh, Math.min(PAD_L + plotW - lh, rawX));
      return (
        <React.Fragment key={`t${hh}`}>
          <Line x1={rawX} y1={PAD_T} x2={rawX} y2={baseY} stroke={chart.grid} strokeWidth={chart.lw.grid} />
          <SvgText x={x} y={H - 6} fontSize={chart.axisFont} fill={chart.axisText}
            textAnchor="middle">{label}</SvgText>
        </React.Fragment>
      );
    });

    // 最底部刻度（-half）抬高到 baseY-8，避免与 X 轴「0:00」叠在一起造成「被遮挡」
    const yLabels: React.ReactNode[] = [half, 0, -half].map((g) => (
      <SvgText key={`y${g}`} x={PAD_L - 5} y={Math.min(yOf(g) + 3, baseY - 8)} fontSize={chart.axisFont}
        fill={theme.colors.textSub}
        textAnchor="end" fontWeight={g === 0 ? '500' : '400'}>
        {g > 0 ? `+${g.toFixed(1)}` : g.toFixed(1)}
      </SvgText>
    ));

    return {
      band: baseline.ready ? (
        <Rect x={PAD_L} y={bandTop} width={plotW} height={bandH}
          fill={mm.colors.limeSoft} opacity={chart.bar.opacity.faint} />
      ) : null,
      zero: (
        <Line x1={PAD_L} y1={yOf(0)} x2={PAD_L + plotW} y2={yOf(0)}
          stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} />
      ),
      lines, areas, ticks, yLabels, baseY,
    };
  }, [dev, w, plotW, plotH, half, baseline, now, H]);

  const hasData = dev.some((v) => v != null);

  return (
    <View onLayout={onLayout}>
      {geom && (
        <Svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
          {geom.band}
          {geom.yLabels}
          {geom.ticks}
          {geom.zero}
          {geom.areas.map((d, i) => (
            <Path key={`a${i}`} d={d} fill={mm.colors.roseCore} opacity={chart.bar.opacity.faint} />
          ))}
          {geom.lines.map((d, i) => (
            <Path key={`l${i}`} d={d} fill="none" stroke={mm.colors.roseDeep}
              strokeWidth={chart.lw.series} strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </Svg>
      )}
      {!baseline.ready && (
        <Text style={styles.note}>
          {`正在建立个人基线（已累计 ${baseline.days} 天，至少需要 3 天）——`}
          {`基线建成后才会画出正常带。`}
        </Text>
      )}
      {!hasData && (
        <Text style={styles.note}>暂无体温数据。</Text>
      )}
    </View>
  );
}

/** 第 i 槽的窗口起点（ms） */
function slotStartMs(i: number, n: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + (i * (86_400_000 / n));
}

export function TempBaselineLegend() {
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: mm.colors.roseDeep }]} />
        <Text style={styles.legendText}>今日偏离</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: mm.colors.limeSoft }]} />
        <Text style={styles.legendText}>{`正常带 ±${TEMP_BAND_C.toFixed(1)}℃`}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendLine, { backgroundColor: chart.refFaint }]} />
        <Text style={styles.legendText}>个人基线</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(1.5),
    lineHeight: theme.fontSize.micro * 1.6,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
    marginTop: theme.sp(1.5),
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  legendSwatch: { width: 10, height: 10, borderRadius: theme.radius.xs },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
});