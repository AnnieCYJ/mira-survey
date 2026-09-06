import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { MOODS, TREND_AXIS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS, type CurvePoint } from '../lib/dailyStatus';

const DAY_MS = 24 * 60 * 60 * 1000;

// 把时间戳映射到「今天 0–24 时」内的位置比例（0=0时，1=24时）
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

  const { d, area, pts, minGapX } = useMemo(() => {
    const pad = theme.sp(2);
    const innerW = Math.max(1, width - pad * 2);

    // 仅用真实数据：按 t 落到真实时间轴（0–24h）；无真实数据则不绘制（不回退脚本曲线，避免假数据）
    const source: { value: number; t: number }[] = (timeline ?? [])
      .filter(
        (p) =>
          p &&
          typeof p.value === 'number' &&
          Number.isFinite(p.value) &&
          Number.isFinite(p.t)
      )
      .map((p) => ({ value: p.value, t: p.t }));

    if (source.length === 0) return { d: '', area: '', pts: [] as PPoint[], minGapX: 28 };

    const p: PPoint[] = source.map((s) => {
      const frac = dayFrac(s.t);
      const x = pad + innerW * frac;
      const y = height - pad - (height - pad * 2) * (s.value / 100);
      return { x, y, value: s.value, t: s.t };
    });

    let path = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      const mx = (a.x + b.x) / 2;
      path += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    const areaPath =
      path + ` L ${p[p.length - 1].x.toFixed(1)} ${height - pad} L ${p[0].x.toFixed(1)} ${height - pad} Z`;

    let gap = 28;
    for (let i = 0; i < p.length - 1; i++) {
      const g = Math.abs(p[i + 1].x - p[i].x);
      if (g > 0 && g < gap) gap = g;
    }

    return { d: path, area: areaPath, pts: p, minGapX: gap };
  }, [width, height, timeline]);

  // 默认选中末点（保持当前绿色标记常驻），点其他点则移动气泡
  // 边界保护：selected 可能来自上一版数据（长度变了），必须 clamp
  const selIdx = selected != null && selected >= 0 && selected < pts.length
    ? selected
    : (pts.length > 0 ? pts.length - 1 : null);

  if (pts.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  }

  const hitW = Math.max(18, Math.min(minGapX, 34) - 2);
  const hitH = 26;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={theme.colors.accent2} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#areaGrad)" />
        <Path d={d} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.6} strokeLinecap="round" />
        {pts.map((p, i) => {
          const color = moodFor(p.value).color;
          return (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i % 2 === 0 ? 3.4 : 2.2}
              fill={color}
              opacity={i % 2 === 0 ? 1 : 0.62}
            />
          );
        })}
        {/* 选中点的白色高亮环 */}
        {selIdx != null && pts[selIdx] ? (
          <Circle
            cx={pts[selIdx]!.x}
            cy={pts[selIdx]!.y}
            r={6}
            fill="none"
            stroke="#fff"
            strokeWidth={1.6}
            opacity={0.9}
          />
        ) : null}
      </Svg>

      {/* 选中点的详情气泡：等级名 + 值 + 采样时刻 */}
      {selIdx != null && pts[selIdx]
        ? (() => {
            const p = pts[selIdx]!;
            const mood = moodFor(p.value);
            const bubbleW = 78;
            const left = Math.max(4, Math.min(width - bubbleW - 4, p.x - bubbleW / 2));
            const top = Math.max(2, p.y - 42);
            return (
              <Pressable
                key="bubble"
                pointerEvents="none"
                style={[
                  styles.bubble,
                  { left, top, backgroundColor: mood.color },
                ]}
              >
                <Text style={styles.bubbleLevel}>
                  {mood.label} {Math.round(p.value)}
                </Text>
                <Text style={styles.bubbleTime}>{fmtTime(p.t)}</Text>
              </Pressable>
            );
          })()
        : null}

      {/* 每个点的点击命中区（覆盖在 SVG 之上，纯 View 不触发 SVG 崩溃） */}
      {pts.map((p, i) => (
        <Pressable
          key={`hit-${i}`}
          onPress={() => setSelected(i)}
          style={[
            styles.hit,
            {
              left: Math.max(0, p.x - hitW / 2),
              top: Math.max(0, p.y - hitH / 2),
              width: hitW,
              height: hitH,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function TrendAxis({ width }: { width: number }) {
  return (
    <View style={[styles.axis, { width }]}>
      {TREND_AXIS.map((t) => (
        <Text key={t} style={styles.axisText}>
          {t}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  bubble: {
    position: 'absolute',
    minWidth: 70,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleLevel: {
    fontSize: 10,
    color: '#fff',
    fontWeight: theme.weight.semibold,
  },
  bubbleTime: {
    fontSize: 8,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  hit: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
});
