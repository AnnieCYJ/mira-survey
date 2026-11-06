/**
 * EmptyChart —— 空图表占位（2026-11-06）
 *
 * ★ 用户原话：「所有这种趋势图和图表，没有数据展示空图表。不要展示一句话。」
 *   「周期规律性是不是个图表还是什么东西？最好就是一个空的表，不要完全是文字来描述，
 *     看着有点…症状统计也可以是空的，就是没有数据的一些个空的图表。不要全部是描述文字。」
 *
 * 设计口径：
 *   1. 空态 = **同款图表骨架**（坐标轴 + 网格线 + 刻度），只是没有数据线/柱，
 *      让用户一眼看出「这里本来是一张图」，而不是一段说明文字。
 *   2. **不放任何解释性文案**（无「暂无数据」「请佩戴戒指」等），保持视觉安静。
 *   3. 中间只放一个极轻的占位标记（虚线基线），不遮挡网格。
 *   4. 与 `AllDayBarsChart` / `AxisLabels` 共享同一套图表 token（theme.chart），
 *      保证不同详情页的空图骨架长得一样。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { theme } from '../../theme/theme';
import { chart } from '../../theme/chart';

interface Props {
  /** 绘图区净高（不含 X 轴标签带），默认 chart.plot.l */
  height?: number;
  /** X 轴刻度标签；不给则用 4 等分的空刻度（只有刻度线，无文字） */
  xLabels?: string[];
  /** Y 轴刻度标签（自上而下） */
  yLabels?: string[];
  /** Y 轴刻度列宽，默认 30 */
  padLeft?: number;
  /** 底部标签带高度，默认 20（与 AxisLabels 对齐） */
  axisH?: number;
  /** 右侧留白，默认 0 */
  padRight?: number;
}

export default function EmptyChart({
  height,
  xLabels,
  yLabels,
  padLeft = 30,
  axisH = 20,
  padRight = 0,
}: Props) {
  const H = height ?? chart.plot.l;
  const rows = 4;

  return (
    <View style={styles.wrap}>
      {/* Y 轴刻度 */}
      <View style={[styles.yCol, { width: padLeft, height: H }]}>
        {Array.from({ length: rows }).map((_, i) => (
          <Text key={i} style={styles.yLabel}>
            {yLabels?.[i] ?? ''}
          </Text>
        ))}
      </View>

      {/* 绘图区：网格线骨架 */}
      <View style={styles.plotWrap}>
        <Svg width="100%" height={H}>
          {/* 网格横线 */}
          {Array.from({ length: rows + 1 }).map((_, i) => {
            const y = (H / rows) * i;
            return (
              <Line
                key={`h${i}`}
                x1={0}
                y1={y}
                x2="100%"
                y2={y}
                stroke={chart.grid}
                strokeWidth={1}
              />
            );
          })}
          {/* 网格竖线（4 等分，与 X 轴刻度对齐） */}
          {Array.from({ length: 5 }).map((_, i) => {
            const x = `${(i / 4) * 100}%` as any;
            return <Line key={`v${i}`} x1={x} y1={0} x2={x} y2={H} stroke={chart.grid} strokeWidth={1} />;
          })}
          {/* 基线（虚线，表示「这一层本该有数据」） */}
          <Line
            x1={0}
            y1={H - 1}
            x2="100%"
            y2={H - 1}
            stroke={chart.refFaint}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        </Svg>

        {/* X 轴标签带 */}
        <View style={[styles.axisRow, { height: axisH, marginRight: padRight }]}>
          {(xLabels ?? ['', '', '', '', '']).map((t, i) => (
            <Text key={i} style={styles.xLabel}>
              {t}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start' },
  yCol: { justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: theme.sp(1) },
  yLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    lineHeight: theme.fontSize.micro * 1.2,
  },
  plotWrap: { flex: 1 },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  xLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
