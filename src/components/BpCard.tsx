import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { healthStore } from '../data/healthStore';
import { dayStartMs } from '../data/healthStore';

const COL_SYS = '#E8A87C';
const COL_DIA = '#7EA6F8';

interface Props {
  ring: any;
  onPress: () => void;
}

export default function BpCard({ ring, onPress }: Props) {
  const now = Date.now();
  const start = dayStartMs(now);
  const sysTPs = healthStore.getTimeRange('bpSys', start, now, { maxPoints: 240 });
  const diaTPs = healthStore.getTimeRange('bpDia', start, now, { maxPoints: 240 });

  const lastSys = sysTPs.length > 0 ? sysTPs[sysTPs.length - 1] : null;
  const lastDia = diaTPs.length > 0 ? diaTPs[diaTPs.length - 1] : null;
  const lastT = Math.max(lastSys?.t ?? 0, lastDia?.t ?? 0);

  const fmtTime = (t: number) => {
    if (!t) return '';
    const diff = Math.floor((Date.now() - t) / 60000);
    if (diff < 1) return '刚刚';
    if (diff < 60) return `${diff}分钟前`;
    return `${Math.floor(diff / 60)}小时前`;
  };

  const hasData = !!lastSys || !!lastDia;

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={styles.title}>血压</Text>
        <Text style={styles.time}>{fmtTime(lastT)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={[styles.val, { color: COL_SYS }]}>{lastSys ? Math.round(lastSys.v) : '—'}</Text>
        <Text style={[styles.sep, { color: theme.colors.textSub }]}>/</Text>
        <Text style={[styles.val, { color: COL_DIA }]}>{lastDia ? Math.round(lastDia.v) : '—'}</Text>
        <Text style={styles.unit}>mmHg</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COL_SYS }} />
          <Text style={styles.legend}>收缩压</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COL_DIA }} />
          <Text style={styles.legend}>舒张压</Text>
        </View>
        {!hasData && <Text style={{ marginLeft: 'auto', color: theme.colors.textSub, fontSize: 12 }}>点击查看</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.textTitle },
  time: { fontSize: 12, color: theme.colors.textSub },
  val: { fontSize: 32, fontWeight: '700' },
  sep: { fontSize: 22, marginHorizontal: 4 },
  unit: { fontSize: 13, color: theme.colors.textSub, marginLeft: 6 },
  legend: { fontSize: 11, color: theme.colors.textSub },
});
