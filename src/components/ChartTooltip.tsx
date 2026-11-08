/**
 * ChartTooltip —— 趋势图点击 tooltip（磨砂深色玻璃 · 统一尺寸与样式）
 * ---------------------------------------------------------------------------
 * ★ 2026-11-07（用户）：原各图表的白色大框 → 统一的半透明磨砂玻璃框（深海玻璃风），
 *   尺寸收敛、样式一致；所有带点击 tooltip 的趋势图共用本组件，避免「有的白框、有的没有」的不一致。
 *
 * 用法：在图表容器内、SVG 之后渲染
 *   <ChartTooltip tip={tip} w={w} H={H} />
 * 其中 tip = { x, y, label, value, color }（与 MetricDetailScreen / StatusTrendDetailScreen 的 tip 结构一致）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';

export interface ChartTip {
  x: number;
  y: number;
  label: string;
  value: string;
  color?: string;
}

// ★ 比原白色框（110×60 / 96×56）更小，统一尺寸
const TW = 94;
const TH = 52;
// 磨砂深色玻璃：深海蓝底半透 + 细白描边（原生不支持 backdrop-blur，用半透明+描边模拟磨砂感）
const GLASS_BG = 'rgba(12,30,52,0.80)';
const GLASS_BORDER = 'rgba(255,255,255,0.18)';

export default function ChartTooltip({ tip, w, H }: { tip: ChartTip | null; w: number; H: number }) {
  if (!tip || w <= 0) return null;
  let tipX = tip.x - TW / 2;
  if (tipX < 4) tipX = 4;
  if (tipX + TW > w - 4) tipX = w - 4 - TW;
  const tipY = Math.max(0, tip.y - TH - 12);
  const triX = tip.x - 7;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: H }}>
      <View style={[s.box, { left: tipX, top: tipY }]}>
        <Text style={s.label} numberOfLines={1}>{tip.label || '数值'}</Text>
        <Text style={[s.value, tip.color ? { color: tip.color } : null]} numberOfLines={1}>{tip.value}</Text>
      </View>
      <View style={[s.tri, { left: triX, top: tipY + TH }]} />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    position: 'absolute',
    width: TW,
    height: TH,
    backgroundColor: GLASS_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  label: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.ui.white74,
    marginBottom: 2,
  },
  value: {
    fontSize: theme.fontSize.body,
    fontWeight: '700',
    color: theme.colors.textWhite,
  },
  tri: {
    position: 'absolute',
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: GLASS_BG,
  },
});
