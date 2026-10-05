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
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { READY_LOW, READY_HIGH, type ReadinessPoint } from '../lib/cognitiveReadiness';

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
  const H = condensed ? 44 : (height ?? 44);
  const CH = H - (condensed ? 0 : AXIS_H);
  const N = 24;
  const anyData = points.some((p) => p.hasData);

  // 连续有值区段（缺口不连线、不插值）
  const runs: number[][] = [];
  {
    let cur: number[] = [];
    for (let h = 0; h < N; h++) {
      if (points[h]?.hasData) cur.push(h);
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

  const ticks = [0, 6, 12, 18, 24];

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

          {/* 档位边界（40 / 70）淡虚线 */}
          {[READY_LOW, READY_HIGH].map((v) => (
            <Path key={v} d={`M 0 ${yAt(v).toFixed(1)} L ${W} ${yAt(v).toFixed(1)}`}
              stroke={theme.colors.textSub + '22'} strokeWidth={0.8} strokeDasharray="2 3" />
          ))}

          {/* 面积 + 折线 */}
          {runs.map((idx, i) => idx.length > 1 ? (
            <React.Fragment key={'r' + i}>
              <Path d={areaOf(idx)} fill="url(#miniReadyArea)" />
              <Path d={lineOf(idx)} fill="none" stroke={theme.colors.accentSolid}
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </React.Fragment>
          ) : null)}
          {/* 单点区段画点，否则该小时不可见 */}
          {runs.map((idx, i) => idx.length === 1 ? (
            <Circle key={'p' + i} cx={xAt(idx[0])} cy={yAt(points[idx[0]].score)} r={2}
              fill={theme.colors.accentSolid} />
          ) : null)}

          {/* X 轴刻度 */}
          {!condensed ? ticks.map((h) => {
            const eL = h === 0, eR = h === 24;
            return (
              <SvgTextX key={h} x={eL ? 1 : eR ? W - 1 : xAt(h)} y={CH + AXIS_H - 2}
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
