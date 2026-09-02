import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import Card from './Card';
import type { MetricDef } from '../data/metrics';

interface Props {
  metric: MetricDef;
  onPress: () => void;
}

function buildPath(data: number[], w: number, h: number) {
  // 防御：任何非有限值（NaN/Infinity）都会导致 iOS 原生 SVG 渲染器直接崩溃（硬退出）。
  // 只要清洗后不足 2 个点，就返回空 path，由调用方决定是否显示。
  const clean = data.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 2) return { d: '', area: '', last: { x: 0, y: 0 } };
  const pad = theme.sp(2);
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const range = max - min || 1;
  const pts = clean.map((v, i) => ({
    x: pad + ((w - pad * 2) * i) / (clean.length - 1),
    y: h - pad - (h - pad * 2) * ((v - min) / range),
  }));

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const area = d + ` L ${pts[pts.length - 1].x.toFixed(1)} ${h - pad} L ${pts[0].x.toFixed(1)} ${h - pad} Z`;
  return { d, area, last: pts[pts.length - 1] };
}

export default function DimensionCard({ metric, onPress }: Props) {
  const [w, setW] = useState(0);
  const h = theme.fs(88);
  const { d, area, last } = useMemo(
    () => (w > 0 ? buildPath(metric.data, w, h) : { d: '', area: '', last: { x: 0, y: 0 } }),
    [w, metric.data, h]
  );

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <Card>
        <View style={styles.top}>
          <Text style={styles.name}>{metric.name}</Text>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{metric.tag}</Text>
          </View>
        </View>

        <View style={styles.main}>
          <Text style={styles.val}>{metric.val}</Text>
          <Text style={styles.unit}>{metric.unit}</Text>
        </View>

        <Text style={[styles.delta, metric.dir === 'up' ? styles.up : styles.down]}>{metric.delta}</Text>

        <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
          {w > 0 ? (
            <Svg width={w} height={h}>
              <Defs>
                <LinearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.32} />
                  <Stop offset="100%" stopColor={theme.colors.accent2} stopOpacity={0.02} />
                </LinearGradient>
                <LinearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0%" stopColor={theme.colors.accent1} />
                  <Stop offset="100%" stopColor={theme.colors.accent2} />
                </LinearGradient>
              </Defs>
              <Path d={area} fill="url(#sparkGrad)" />
              <Path d={d} fill="none" stroke="url(#lineGrad)" strokeWidth={2.4} strokeLinecap="round" />
              <Circle cx={last.x} cy={last.y} r={4.5} fill="#FFFFFF" stroke={theme.colors.accentSolid} strokeWidth={2.4} />
            </Svg>
          ) : null}
        </View>

        <Text style={styles.note}>{metric.note}</Text>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  name: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  tag: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
  },
  tagText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  main: { flexDirection: 'row', alignItems: 'baseline', marginBottom: theme.sp(1) },
  val: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  delta: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    marginBottom: theme.space.sm,
  },
  up: { color: theme.colors.success },
  down: { color: theme.colors.stateTense },
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});
