import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { MOODS, TREND_AXIS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS, isSameDay, type CurvePoint } from '../lib/dailyStatus';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayFrac(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const f = (t - d.getTime()) / DAY_MS;
  return Math.min(1, Math.max(0, f));
}

function moodFor(value: number) {
  const idx = curveLevel(value, CURVE_DEFAULTS).index;
  return MOODS[idx] ?? MOODS[1];
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface Props {
  width: number;
  height?: number;
  timeline?: CurvePoint[];
}

interface PPoint {
  x: number;
  y: number;
  value: number;
  t: number;
}

export default function TrendChart({ width, height = theme.fs(108), timeline }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const padX = 10;  // 左右内边距, 保证首尾点不被左/右边缘裁掉

  const { path, gradStops, pts, minGapX } = useMemo(() => {
    // padX 用顶层常量
    // ★ 顶部留出气泡高度：值 100 的峰点也只到 padTop 线，浮层气泡完全悬在曲线上方，不再盖住峰点
    const padTop = 36;
    const padBottom = 6;
    const innerW = Math.max(1, width - padX * 2);
    const now = Date.now();
    const source: { value: number; t: number }[] = (timeline ?? [])
      .filter((p) => p && typeof p.value === 'number' && Number.isFinite(p.value) && Number.isFinite(p.t) && isSameDay(p.t, now))
      .map((p) => ({ value: p.value, t: p.t }));

    if (source.length === 0) return { path: '', gradStops: [] as { offset: string; color: string }[], pts: [] as PPoint[], minGapX: 28 };

    const p: PPoint[] = source.map((s) => {
      const frac = dayFrac(s.t);
      const x = padX + innerW * frac;
      const y = height - padBottom - (height - padTop - padBottom) * (s.value / 100);
      return { x, y, value: s.value, t: s.t };
    });

    // Catmull-Rom → Cubic Bezier: 真正平滑的样条插值
    let path = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
    const n = p.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(n - 1, i + 2)];
      // Catmull-Rom → Cubic Bezier (smoother, 0.5 tension)
      const cp1x = p1.x + (p2.x - p0.x) * 0.25;
      const cp1y = p1.y + (p2.y - p0.y) * 0.25;
      const cp2x = p2.x - (p3.x - p1.x) * 0.25;
      const cp2y = p2.y - (p3.y - p1.y) * 0.25;
      path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    // 多 stop LinearGradient: 每个点一个 stop，颜色随位置变化
    const totalX = p[p.length - 1].x - p[0].x || 1;
    const gradStops = p.map((pt) => ({
      offset: ((pt.x - p[0].x) / totalX * 100).toFixed(2) + '%',
      color: moodFor(pt.value).color,
    }));

    let gap = 28;
    for (let i = 0; i < p.length - 1; i++) {
      const g = Math.abs(p[i + 1].x - p[i].x);
      if (g > 0 && g < gap) gap = g;
    }
    return { path, gradStops, pts: p, minGapX: gap };
  }, [width, height, timeline]);

  const selIdx = selected != null && selected >= 0 && selected < pts.length
    ? selected
    : (pts.length > 0 ? pts.length - 1 : null);

  if (pts.length === 0) {
    return <View style={[styles.empty, { width, height }]}><Text style={styles.emptyText}>暂无数据</Text></View>;
  }

  const hitW = Math.max(18, Math.min(minGapX, 34) - 2);
  const hitH = 26;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
            {gradStops.map((gs, i) => (
              <Stop key={'gs' + i} offset={gs.offset} stopColor={gs.color} />
            ))}
          </LinearGradient>
          <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={gradStops[0]?.color ?? '#8B5CF6'} stopOpacity={0.28} />
            <Stop offset="55%" stopColor={gradStops[Math.floor(gradStops.length/2)]?.color ?? '#8B5CF6'} stopOpacity={0.10} />
            <Stop offset="100%" stopColor={gradStops[gradStops.length-1]?.color ?? '#8B5CF6'} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={`${path} L ${pts[pts.length - 1]?.x.toFixed(1) ?? 0} ${height} L ${pts[0]?.x.toFixed(1) ?? 0} ${height} Z`} fill="url(#trendFill)" />
        <Path d={path} fill="none" stroke="url(#trendStroke)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        {selIdx != null && pts[selIdx] ? (() => {
          const p = pts[selIdx]!;
          const mood = moodFor(p.value);
          // ★ 最新数据点：状态色实心点 + 白描边，明确展示当前所在档位（替代不显眼的白圈）
          return <Circle key="selDot" cx={p.x} cy={p.y} r={5} fill={mood.color} stroke="#fff" strokeWidth={2} />;
        })() : null}
      </Svg>

      {selIdx != null && pts[selIdx] ? (() => {
        const p = pts[selIdx]!;
        const mood = moodFor(p.value);
        const bubbleW = 78;
        const left = Math.max(4, Math.min(width - bubbleW - 4, p.x - bubbleW / 2));
        const top = Math.max(2, p.y - 46);
        return (
          <Pressable key="bubble" pointerEvents="none" style={[styles.bubble, { left, top, backgroundColor: mood.color }]}>
            <Text style={styles.bubbleLevel}>{mood.label} {Math.round(p.value)}</Text>
            <Text style={styles.bubbleTime}>{fmtTime(p.t)}</Text>
          </Pressable>
        );
      })() : null}

      {pts.map((p, i) => (
        <Pressable key={`hit-${i}`} onPress={() => setSelected(i)} style={[styles.hit, { left: Math.max(padX, p.x - hitW / 2), top: Math.max(0, p.y - hitH / 2), width: hitW, height: hitH }]} />
      ))}
    </View>
  );
}


export function TrendAxis({ width }: { width: number }) {
  return (
    <View style={[styles.axis, { width }]}>
      {TREND_AXIS.map((t) => (<Text key={t} style={styles.axisText}>{t}</Text>))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  bubble: { position: 'absolute', minWidth: 70, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  bubbleLevel: { fontSize: 10, color: '#fff', fontWeight: theme.weight.semibold },
  bubbleTime: { fontSize: 8, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  hit: { position: 'absolute', backgroundColor: 'transparent' },
});
