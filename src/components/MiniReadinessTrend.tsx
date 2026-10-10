/**
 * MiniReadinessTrend —— 首页「脑力」半宽卡里的迷你趋势图
 *
 * ★ 替换原 `MiniCognitiveBars`（24 根离散柱）。
 * 准备度是连续状态量（晨高晚低波形），柱状图会把相邻两小时切成互不相干的两根，
 * 看不出「上午走高、傍晚回落」这个最关键的形态 → 改为折线 + 渐变面积。
 *
 * 与 `ReadinessTrendChart`（详情页）同源同阈值（40 / 70），只是省掉了坐标轴与图例，
 * 以适配首页半宽小卡（宽 ~168pt，高 ~44pt）。
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { READY_LOW, READY_HIGH, type ReadinessPoint } from '../lib/cognitiveReadiness';
import { DAY_HOUR_TICKS_COMPACT } from '../lib/chartAxis';

interface Props {
  points: ReadinessPoint[];
  /** 紧凑模式（更小，用于嵌套场景） */
  condensed?: boolean;
  height?: number;
}

const AXIS_H = 12;

export default function MiniReadinessTrend({ points, condensed, height }: Props) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const W = condensed ? 80 : measuredW;
  // ★ 2026-10-06（用户：纵坐标再高一点）：非紧凑默认高 44→54，让 0-100 折线的竖向更舒展
  const H = condensed ? 44 : (height ?? 54);
  const CH = H - (condensed ? 0 : AXIS_H);
  // ★ 2026-10-06（用户：所有指标统一 30 分钟一个点）：24 → 48 个半小时槽
  const N = 48;
  const anyData = points.some((p) => p.hasData);

  // 连续有值区段（缺口不连线、不插值）
  const runs: number[][] = [];
  {
    let cur: number[] = [];
    for (let s = 0; s < N; s++) {
      if (points[s]?.hasData) cur.push(s);
      else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }

  const xAt = (h: number) => (W * h) / N + (W / N) * 0.5;
  const yAt = (v: number) => CH - (v / 100) * CH;
  const lineOf = (idx: number[]) =>
    idx.map((h, k) => `${k === 0 ? 'M' : 'L'} ${xAt(h).toFixed(1)} ${yAt(points[h].score).toFixed(1)}`).join(' ');
  const areaOf = (idx: number[]) =>
    `${lineOf(idx)} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${CH.toFixed(1)} L ${xAt(idx[0]).toFixed(1)} ${CH.toFixed(1)} Z`;

  const ticks = DAY_HOUR_TICKS_COMPACT;

  return (
    <View
      onLayout={!condensed ? (e) => { const cw = e.nativeEvent.layout.width; if (cw > 0 && Math.abs(cw - measuredW) > 1) setMeasuredW(cw); } : undefined}
      style={{ width: condensed ? 80 : '100%', height: H }}
    >
      {!condensed && W <= 0 ? null : (
        <Svg width={W} height={H}>
          <Defs>
            <SvgLinear id="miniReadyArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity={0.24} />
              <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={0.02} />
            </SvgLinear>
          </Defs>

          {/* ★ 2026-10-06（用户口径）：纵轴 = 0-100，加回高/中/低三档柔和背景带，
              与详情页 ReadinessTrendChart 同源同阈值（40/70），首页与详情页视觉一致。
              色带只做背景分区（opacity 0.07），主视觉仍是 0-100 折线。 */}
          {[
            { hi: 100, lo: READY_HIGH, color: theme.colors.success },
            { hi: READY_HIGH, lo: READY_LOW, color: theme.colors.warn },
            { hi: READY_LOW, lo: 0, color: theme.colors.danger },
          ].map((b, i) => (
            <Rect key={'mband' + i} x={0} y={yAt(b.hi)} width={W} height={Math.max(0, yAt(b.lo) - yAt(b.hi))}
              fill={b.color} opacity={0.07} />
          ))}

          {/* 档位边界（40 / 70）淡虚线 */}
          {[READY_LOW, READY_HIGH].map((v) => (
            <Path key={v} d={`M 0 ${yAt(v).toFixed(1)} L ${W} ${yAt(v).toFixed(1)}`}
              stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} />
          ))}

          {/* 面积 + 折线 */}
          {runs.map((idx, i) => idx.length > 1 ? (
            <React.Fragment key={'r' + i}>
              <Path d={areaOf(idx)} fill="url(#miniReadyArea)" />
              <Path d={lineOf(idx)} fill="none" stroke={chart.series.primary}
                strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
            </React.Fragment>
          ) : null)}
          {/* 单点区段画点，否则该小时不可见 */}
          {runs.map((idx, i) => idx.length === 1 ? (
            <Circle key={'p' + i} cx={xAt(idx[0])} cy={yAt(points[idx[0]].score)} r={chart.dot.radius}
              fill={theme.colors.accentSolid} />
          ) : null)}

          {/* X 轴刻度（每 6 小时 = 每 12 槽） */}
          {!condensed ? ticks.map((h) => {
            const eL = h === 0, eR = h === 24;
            const slot = h * 2;
            return (
              <SvgTextX key={h} x={eL ? 1 : eR ? W - 1 : xAt(slot)} y={CH + AXIS_H - 2}
                anchor={eL ? 'start' : eR ? 'end' : 'middle'} label={String(h).padStart(2, '0')} />
            );
          }) : null}
        </Svg>
      )}

      {!anyData && !condensed ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: CH / 2 - 8, alignItems: 'center' }}>
          <Text style={{ fontSize: 9, color: theme.colors.textSub }}>暂无数据</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 迷你轴标签 */
function SvgTextX({ x, y, anchor, label }: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; label: string }) {
  return <SvgText x={x} y={y} textAnchor={anchor} fontSize={8} fill="rgba(120,110,160,0.6)">{label}</SvgText>;
}
