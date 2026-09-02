import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import type { SleepSegment } from '../ble/RingBleManager';

/** 睡眠阶段元数据：颜色严格取自 design token，避免裸值。
 *  0=深睡 1=浅睡 2=REM 3=失眠 4=清醒（KH18 固件通常只返回 0/1/2/4）。
 *  每个阶段占独立水平带（row），行高和行间距都压小，形成参考图那种密集分层。
 */
export const SLEEP_STAGE_META: Record<number, { label: string; color: string; row: number }> = {
  0: { label: '深睡', color: theme.colors.accent1, row: 0 },      // 最底行，浅紫矮条
  1: { label: '浅睡', color: theme.colors.accentSolid, row: 1 }, // 中紫中条
  2: { label: 'REM', color: theme.colors.accent2, row: 2 },      // 浅蓝高条
  3: { label: '失眠', color: theme.colors.danger, row: 3 },        // 与清醒同行
  4: { label: '清醒', color: theme.colors.stateTense, row: 3 },    // 最顶行，黄色小条
};

const ROW_H = theme.sp(4.5);       // 行带高度 ≈18
const BAR_H = theme.sp(2.5);       // 行内矩形高度 ≈10（短于行高，形成呼吸感）
const ROW_GAP = theme.sp(0.75);    // 行间距 ≈3（密集）
const AXIS_H = theme.sp(5);        // 时间轴

function parseClock(s?: string | null): number | null {
  if (!s || /^\d{1,2}:\d{2}/.test(s) === false) return null;
  const parts = s.split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function fmtClock(absMin: number): string {
  const h = (((Math.floor(absMin / 60) % 24) + 24) % 24);
  const m = (((absMin % 60) + 60) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function SleepStageChart({
  segments,
  sleepTime,
}: {
  segments: SleepSegment[];
  sleepTime?: string | null;
}) {
  const { width: winW } = useWindowDimensions();
  const padX = theme.space.screen + theme.space.cardPad;
  const W = Math.max(200, winW - padX * 2);
  const rows = [0, 1, 2, 3];
  const chartH = rows.length * ROW_H + (rows.length - 1) * ROW_GAP;
  const H = chartH + AXIS_H;
  const totalMin = segments && segments.length > 0
    ? segments[segments.length - 1].end
    : 0;

  const x = (min: number) => (totalMin > 0 ? (min / totalMin) * W : 0);
  const startAbs = parseClock(sleepTime);

  // 时间轴刻度：从入睡时间开始，每 2 小时一个标签
  const ticks: { x: number; label: string }[] = [];
  if (startAbs != null && totalMin > 0) {
    let cur = Math.ceil(startAbs / 60) * 60;
    const endAbs = startAbs + totalMin;
    while (cur <= endAbs && ticks.length < 40) {
      const rel = cur - startAbs;
      ticks.push({ x: x(rel), label: fmtClock(cur) });
      cur += 120;
    }
  } else if (totalMin > 0) {
    for (let t = 0; t <= totalMin; t += 120) {
      ticks.push({ x: x(t), label: `+${Math.round(t / 60)}h` });
    }
  }

  if (!segments || segments.length === 0) {
    return (
      <View style={[styles.empty, { height: H }]}>
        <Text style={styles.emptyText}>昨夜睡眠结构暂未同步</Text>
      </View>
    );
  }

  // 行底部 y 坐标（深睡在底）
  const rowBottomY = (rowIndex: number) =>
    chartH - (rowIndex + 1) * ROW_H - rowIndex * ROW_GAP;

  const gap = 0.5; // 段间极小间隙

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* 阶段段：每个 type 落在自己的行内，矩形在行内居中 */}
        {segments.map((s, i) => {
          const meta = SLEEP_STAGE_META[s.type] ?? SLEEP_STAGE_META[1];
          const rawSx = x(s.start);
          const rawEx = x(s.end);
          const sw = Math.max(1.5, rawEx - rawSx - gap);
          const sx = rawSx + gap / 2;
          const rowY = rowBottomY(meta.row);
          const barY = rowY + (ROW_H - BAR_H) / 2; // 行内居中
          return (
            <Rect
              key={i}
              x={sx}
              y={barY}
              width={sw}
              height={BAR_H}
              fill={meta.color}
              rx={theme.sp(0.6)}
            />
          );
        })}

        {/* 时间轴竖线 */}
        {ticks.map((t, i) => (
          <Line
            key={`tick-${i}`}
            x1={t.x}
            y1={chartH + theme.sp(0.5)}
            x2={t.x}
            y2={chartH + theme.sp(2)}
            stroke={theme.colors.textSub}
            strokeWidth={1}
            opacity={0.45}
          />
        ))}

        {/* 时间轴标签 */}
        {ticks.map((t, i) => (
          <SvgText
            key={`tl-${i}`}
            x={t.x}
            y={H - theme.sp(0.75)}
            fontSize={theme.fontSize.micro}
            fill={theme.colors.textSub}
            textAnchor="middle"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
  },
});
