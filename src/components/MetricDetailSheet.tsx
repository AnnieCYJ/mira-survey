import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import Sheet, { SheetHead } from './Sheet';
import {
  genSeries,
  type MetricKey,
  METRICS,
  RANGE_DEF,
  RANGE_NOTE,
  RANGE_UNIT,
  type RangeKey,
  SERIES_PARAM,
  cycleNote,
} from '../data/metrics';
import { RingBle } from '../ble/RingBleManager';

interface Props {
  visible: boolean;
  metricKey: MetricKey;
  onClose: () => void;
}

const RANGES: RangeKey[] = ['day', 'week', 'month', 'year'];

export default function MetricDetailSheet({ visible, metricKey, onClose }: Props) {
  const [range, setRange] = useState<RangeKey>('week');
  const [w, setW] = useState(0);
  const h = theme.fs(152);

  const def = RANGE_DEF[range];
  const unit = RANGE_UNIT[metricKey][range];

  const data = useMemo(
    () => genSeries(SERIES_PARAM[metricKey][range], def.n),
    [metricKey, range, def.n]
  );

  const latest = data[data.length - 1];
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const hi = Math.max(...data);
  const lo = Math.min(...data);
  const first = data[0];
  const deltaPct = first !== 0 ? Math.round(((latest - first) / Math.abs(first)) * 100) : 0;

  const chart = useMemo(() => {
    if (!w) return { d: '', area: '', pts: [] as { x: number; y: number }[] };
    const pad = theme.space.sm;
    const rng = hi - lo || 1;
    const pts = data.map((v, i) => ({
      x: pad + ((w - pad * 2) * i) / (data.length - 1),
      y: h - pad - (h - pad * 2) * ((v - lo) / rng),
    }));

    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a.x + b.x) / 2;
      d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    const area = d + ` L ${pts[pts.length - 1].x.toFixed(1)} ${h - pad} L ${pts[0].x.toFixed(1)} ${h - pad} Z`;
    return { d, area, pts };
  }, [data, w, h, hi, lo]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHead title={METRICS[metricKey].name} subtitle={unit.unit} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroVal}>{unit.fmt(latest)}</Text>
          <Text style={[styles.delta, deltaPct >= 0 ? styles.up : styles.down]}>
            {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较周期初
          </Text>
        </View>

        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.rangeChip, r === range && styles.rangeChipOn]}
              onPress={() => setRange(r)}
              activeOpacity={0.8}
            >
              <Text style={[styles.rangeText, r === range && styles.rangeTextOn]}>
                {RANGE_DEF[r].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.chartCard}>
          <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={h}>
                <Defs>
                  <LinearGradient id="bigGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.3} />
                    <Stop offset="100%" stopColor={theme.colors.accent2} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>
                <Path d={chart.area} fill="url(#bigGrad)" />
                <Path d={chart.d} fill="none" stroke={theme.colors.accentSolid} strokeWidth={2.6} strokeLinecap="round" />
                {chart.pts.length <= 12 &&
                  chart.pts.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={3} fill={theme.colors.accentSolid} />
                  ))}
              </Svg>
            ) : null}
          </View>
          <View style={styles.axisRow}>
            {def.axis.map((t) => (
              <Text key={t} style={styles.axisText}>
                {t}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>平均</Text>
            <Text style={styles.statValue}>{unit.fmt(avg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最高</Text>
            <Text style={styles.statValue}>{unit.fmt(hi)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最低</Text>
            <Text style={styles.statValue}>{unit.fmt(lo)}</Text>
          </View>
        </View>

        <Text style={styles.note}>
          {metricKey === 'cycle' ? cycleNote(range, RingBle.getState().curveStatus) : RANGE_NOTE[range][metricKey]}
        </Text>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: theme.space.screen, paddingBottom: theme.space.xl * 2 },
  hero: { alignItems: 'flex-start', marginBottom: theme.space.md },
  heroVal: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  delta: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, marginTop: theme.sp(1) },
  up: { color: theme.colors.success },
  down: { color: theme.colors.stateTense },
  rangeRow: { flexDirection: 'row', marginBottom: theme.space.md },
  rangeChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.xs,
  },
  rangeChipOn: { backgroundColor: theme.colors.accentSolid },
  rangeText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: theme.colors.textSub },
  rangeTextOn: { color: theme.colors.textWhite },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2) },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statGrid: { flexDirection: 'row', marginBottom: theme.space.md },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.6)',
    marginHorizontal: theme.sp(1),
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  statValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
  },
});
