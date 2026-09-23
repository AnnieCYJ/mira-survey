import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { healthStore } from '../data/healthStore';
import { dayStartMs } from '../data/healthStore';

// v10 SPEC §2 #7：双折线语义色——收缩=粉、舒张=蓝（圆环家族数据色）
const COL_SYS = mm.colors.ringPinkDeep;
const COL_DIA = mm.colors.ringBlueDeep;

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
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={styles.title}>血压</Text>
        <Text style={styles.time}>{fmtTime(lastT)}</Text>
      </View>
      <View style={{ flexDirection: 'column', gap: theme.sp(1.25) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.unit}>收缩压</Text>
          <Text style={[styles.val, { color: COL_SYS }]}>{lastSys ? Math.round(lastSys.v) : '—'}</Text>
        </View>
        <View style={{ height: 1, backgroundColor: mm.colors.chipBorder }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.unit}>舒张压</Text>
          <Text style={[styles.val, { color: COL_DIA }]}>{lastDia ? Math.round(lastDia.v) : '—'}</Text>
        </View>
        {!hasData && (
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center' }}>点击查看</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  time: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  val: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold },
  sep: { fontSize: theme.fontSize.h2, marginHorizontal: theme.sp(1) },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: theme.sp(1.5) },
  legend: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
