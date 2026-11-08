/**
 * SleepRegularityChart —— 入睡 / 起床「区间柱」图（洞察页卡片 + 详情页共用同一份实现）
 *
 * 纵轴 = 连续时间轴，底部 18:00（AXIS_MIN_H=18）、顶部次日 12:00（36）。
 * 每根柱：下端 yOf(bedH) = 入睡，上端 yOf(wakeH) = 起床，柱高 = 这一夜的跨度。
 * 柱子齐平 → 作息稳；柱子逐日往下挪 → 逐渐偏晚。
 *
 * ★ 无数据的槽保留淡虚线空位，不塌缩、不补值（沿用「无数据也展示空图表」的项目口径）。
 * ★ 样式与 RecoveryTrendChart 同源：Svg + onLayout 量宽、mm.colors / theme.fontSize token。
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line as SvgLine, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import {
  AXIS_MAX_H,
  AXIS_MIN_H,
  AXIS_TICKS_H,
  axisLabel,
  type SleepNightPoint,
} from '../lib/sleepRegularity';

interface Props {
  points: SleepNightPoint[];
  height?: number;
  /** 洞察页卡片：压缩纵轴标签密度、不画横轴日期 */
  compact?: boolean;
  /** 入睡基线（归一小时），画一条横向虚线便于看逐日偏晚 */
  baselineBedH?: number | null;
  /** 横轴刻度（周 / 月 / 年 由 seriesTicks 生成） */
  ticks?: { i: number; label: string }[];
}

const GRID = mm.colors.inkFaint;

export default function SleepRegularityChart({
  points,
  height = 190,
  compact = false,
  baselineBedH = null,
  ticks,
}: Props) {
  const [W, setW] = useState(0);
  const n = Math.max(1, points.length);

  const layout = useMemo(() => {
    if (W <= 0) return null;
    const padL = compact ? 30 : 38;
    const padR = 4;
    const padT = 6;
    const padB = compact ? 2 : 20;
    const plotW = Math.max(1, W - padL - padR);
    const plotH = Math.max(1, height - padT - padB);
    const yOf = (h: number) =>
      padT + ((AXIS_MAX_H - Math.max(AXIS_MIN_H, Math.min(AXIS_MAX_H, h))) / (AXIS_MAX_H - AXIS_MIN_H)) * plotH;
    const xOf = (i: number) => padL + ((i + 0.5) / n) * plotW;
    const barW = Math.max(2, Math.min(compact ? 10 : 14, (plotW / n) * 0.56));
    // 卡片只标 18 / 24 / 30 / 36，详情页给全刻度
    const axisTicks = compact ? [18, 24, 30, 36] : AXIS_TICKS_H;
    return { padL, padR, padT, padB, plotW, plotH, yOf, xOf, barW, axisTicks };
  }, [W, height, n, compact]);

  if (!layout) {
    return <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} />;
  }
  const { padL, padR, padT, padB, plotW, plotH, yOf, xOf, barW, axisTicks } = layout;
  const gridRight = padL + plotW;

  return (
    <View>
      <Svg width={W} height={height}>
        {/* 时间网格 + 左侧刻度：18:00 在下、次日 12:00 在上 */}
        {axisTicks.map((h) => (
          <SvgLine
            key={`g${h}`}
            x1={padL}
            y1={yOf(h)}
            x2={gridRight}
            y2={yOf(h)}
            stroke={GRID}
            strokeOpacity={h === 24 ? 0.32 : 0.16}
            strokeWidth={1}
          />
        ))}
        {axisTicks.map((h) => (
          <SvgText
            key={`t${h}`}
            x={padL - 5}
            y={yOf(h) + 3}
            textAnchor="end"
            fontSize={theme.fontSize.axis}
            fill={theme.colors.textSub}
          >
            {axisLabel(h)}
          </SvgText>
        ))}

        {/* 入睡基线：横向虚线，柱底相对它上下移动即「比平时早 / 晚」 */}
        {baselineBedH != null && baselineBedH >= AXIS_MIN_H && baselineBedH <= AXIS_MAX_H ? (
          <SvgLine
            x1={padL}
            y1={yOf(baselineBedH)}
            x2={gridRight}
            y2={yOf(baselineBedH)}
            stroke={mm.colors.honeyCore}
            strokeOpacity={0.7}
            strokeWidth={1.2}
            strokeDasharray="5 4"
          />
        ) : null}

        {/* 逐日区间柱 */}
        {points.map((p, i) => {
          const cx = xOf(i);
          if (p.bedH == null || p.wakeH == null) {
            return (
              <SvgLine
                key={`e${p.date}${i}`}
                x1={cx}
                y1={padT}
                x2={cx}
                y2={padT + plotH}
                stroke={GRID}
                strokeOpacity={0.16}
                strokeWidth={1}
                strokeDasharray="2 6"
              />
            );
          }
          const yTop = yOf(p.wakeH);
          const yBottom = yOf(p.bedH);
          const barH = Math.max(2, yBottom - yTop);
          return (
            <React.Fragment key={`b${p.date}${i}`}>
              <Rect
                x={cx - barW / 2}
                y={yTop}
                width={barW}
                height={barH}
                rx={Math.min(barW / 2, 5)}
                fill={mm.colors.limeMid}
                fillOpacity={0.62}
              />
              {/* 下端 = 入睡（亮绿点），上端 = 起床（白点） */}
              <Circle cx={cx} cy={yBottom} r={compact ? 1.8 : 2.4} fill={mm.colors.limeCore} />
              <Circle cx={cx} cy={yTop} r={compact ? 1.8 : 2.4} fill={mm.colors.ink} />
            </React.Fragment>
          );
        })}

        {/* 横轴日期（卡片不画） */}
        {!compact && ticks && ticks.length
          ? ticks.map((t) => (
              <SvgText
                key={`x${t.i}`}
                x={xOf(t.i)}
                y={height - 4}
                textAnchor="middle"
                fontSize={theme.fontSize.axis}
                fill={theme.colors.textSub}
              >
                {t.label}
              </SvgText>
            ))
          : null}
      </Svg>
    </View>
  );
}
