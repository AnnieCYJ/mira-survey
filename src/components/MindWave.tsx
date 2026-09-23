/**
 * MindWave —— v10 小卡迷你波浪线（DESIGN-SPEC §1 #9）
 * 输入一组数值（已观测到的真实采样），输出单色折线 + 末点实心圆。
 * 少于 2 个有效点时不渲染（不编形状）。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { theme } from '../theme/theme';

interface Props {
  values: number[];
  /** 折线颜色（数据色，来自 mm.colors.ring*） */
  color: string;
  /** 末点颜色（通常取 deep 档） */
  dotColor: string;
  height?: number;
}

function MindWaveImpl({ values, color, dotColor, height = 36 }: Props) {
  const pts = (values ?? []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const W = 150;
  const H = 36;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 4;
  const step = (W - pad * 2) / (pts.length - 1);
  const xy = pts.map((v, i) => ({
    x: pad + i * step,
    y: H - pad - ((v - min) / span) * (H - pad * 2),
  }));
  // 平滑：用二次贝塞尔（中点法），比折线柔和、与概念稿波浪一致
  let d = `M${xy[0].x},${xy[0].y.toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const mx = (xy[i - 1].x + xy[i].x) / 2;
    const my = (xy[i - 1].y + xy[i].y) / 2;
    d += ` Q${xy[i - 1].x.toFixed(1)},${xy[i - 1].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = xy[xy.length - 1];
  d += ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return (
    <View style={[styles.wrap, { height: theme.fs(height) }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        {/* 末点： viewBox 会被拉伸，圆点用足够小的 r 保持近似圆形 */}
        <Circle cx={last.x} cy={last.y} r={1.6} fill={dotColor} />
      </Svg>
    </View>
  );
}

export default React.memo(MindWaveImpl);

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: theme.sp(2.75),
  },
});
