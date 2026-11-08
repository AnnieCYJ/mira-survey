/**
 * ChartTapTip —— 统一的「点图表弹数值」交互层
 * ---------------------------------------------------------------------------
 * ★ 2026-11-08（用户：「有的趋势图/柱状图点击不弹黑色小弹框，有的有有的没有，要都有」）：
 *   原来只有 MetricDetailScreen / StatusTrendDetailScreen 两张主图自己写了 onTouch + ChartTooltip，
 *   其余十几个图表组件（全天柱、恢复力、睡眠规律性、皮质醇柱…）能看不能点；
 *   TrendChart 甚至另有一套彩色气泡。现在把「命中 + 自动消失 + 黑色磨砂数值框」收成一个组件，
 *   所有图表复用同一套样式与手感，避免各写各的。
 *
 * 用法（放在图表根 View 内、Svg 之后）：
 *   <ChartTapTip
 *     height={H}
 *     width={w}                       // 已用 onLayout 量过宽就传，省一次测量
 *     slots={[{ fx: 0.12, fy: 0.4, label: '08:30', value: '72 bpm' }, ...]}
 *   />
 *   fx / fy 是 0~1 的比例（相对整张图的宽高），因此不管图表用像素坐标还是 viewBox 缩放都能用。
 *   fy 不给时气泡贴在手指点击处上方；给了就贴在数据点 / 柱顶上方。
 *
 * 触摸用 RN responder 抢事件：点图 = 看数值，点卡片标题/箭头 = 进详情页；
 * onResponderTerminationRequest 返回 true，ScrollView 仍能正常抢回手势、不挡滚动。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import ChartTooltip, { type ChartTip } from './ChartTooltip';

export interface ChartTapSlot {
  /** 槽中心 X 在整图宽度中的比例 0~1 */
  fx: number;
  /** 气泡第一行（日期 / 时刻 / 星期） */
  label: string;
  /** 气泡第二行（数值，建议自带单位） */
  value: string;
  /** 数值颜色（可选，默认纯白） */
  color?: string;
  /** 数值点 Y 在整图高度中的比例 0~1；不给则贴手指点击处 */
  fy?: number;
}

interface Props {
  slots: ChartTapSlot[];
  /** 图表总高（含轴标签带），用于气泡定位与边界 clamp */
  height: number;
  /** 图表总宽；不传则内部 onLayout 自测 */
  width?: number;
  /** 松开后自动隐藏毫秒数，默认 2200（与两个详情页既有 tooltip 的 2000 同量级） */
  hideAfterMs?: number;
}

export default function ChartTapTip({ slots, height, width, hideAfterMs = 2200 }: Props) {
  const [measured, setMeasured] = useState(0);
  const w = width && width > 0 ? width : measured;
  const [tip, setTip] = useState<ChartTip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const hideSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(null), hideAfterMs);
  }, [hideAfterMs]);

  const pick = useCallback((e: GestureResponderEvent) => {
    if (!w || slots.length === 0) return;
    const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number };
    const x = Number.isFinite(ne.locationX) ? Number(ne.locationX) : 0;
    const y = Number.isFinite(ne.locationY) ? Number(ne.locationY) : 0;
    // 最近 X 命中：允许点在柱间空白/柱身上，也显示相邻那一根的数值
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const d = Math.abs(slots[i].fx * w - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    const s = slots[best];
    const ty = s.fy != null
      ? Math.max(0, Math.min(height, s.fy * height))
      : Math.max(0, Math.min(height, y));
    setTip({ x: s.fx * w, y: ty, label: s.label, value: s.value, color: s.color });
  }, [w, slots, height]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(e: LayoutChangeEvent) => {
          if (!width) setMeasured(e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => slots.length > 0}
        onResponderTerminationRequest={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderRelease={(e) => { pick(e); hideSoon(); }}
        onResponderTerminate={() => setTip(null)}
      />
      <ChartTooltip tip={tip} w={w} H={height} />
    </View>
  );
}

/** 便捷构造：等距 N 槽的图表（多数柱状/折线图都是这种布局） */
export function evenSlots<T>(
  items: T[],
  opts: {
    padLeft: number;
    plotWidth: number;
    totalWidth: number;
    labelOf: (item: T, i: number) => string;
    valueOf: (item: T, i: number) => string | null;
    colorOf?: (item: T, i: number) => string | undefined;
    fyOf?: (item: T, i: number) => number | undefined;
    /** 槽中心偏移比例（0.5 = 槽中心；按 i/(n-1) 分布的折线传 0） */
    center?: number;
  },
): ChartTapSlot[] {
  const n = items.length;
  if (n <= 0 || opts.totalWidth <= 0) return [];
  const denom = opts.center === 0 ? Math.max(1, n - 1) : n;
  const offset = opts.center === 0 ? 0 : 0.5;
  const out: ChartTapSlot[] = [];
  for (let i = 0; i < n; i++) {
    const v = opts.valueOf(items[i], i);
    if (v == null) continue;
    const x = opts.padLeft + ((i + offset) / denom) * opts.plotWidth;
    out.push({
      fx: Math.max(0, Math.min(1, x / opts.totalWidth)),
      label: opts.labelOf(items[i], i),
      value: v,
      color: opts.colorOf?.(items[i], i),
      fy: opts.fyOf?.(items[i], i),
    });
  }
  return out;
}
