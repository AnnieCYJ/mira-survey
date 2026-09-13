/**
 * PhaseLegend —— 周期四相图例（经期 / 卵泡期 / 排卵期 / 黄体期）
 *
 * 唯一实现：体温双相曲线、激素趋势卡（雌激素 / 孕激素）、日历网格共用，
 * 保证「同一相位到处同色」且样式一致。色值取自 lib/phaseColors（token）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { PHASE_COLOR, PHASE_LABEL, PHASE_ORDER } from '../lib/phaseColors';

export default function PhaseLegend() {
  return (
    <View style={styles.legend}>
      {PHASE_ORDER.map((p) => (
        <View key={p} style={styles.item}>
          <View style={[styles.dot, { backgroundColor: PHASE_COLOR[p] }]} />
          <Text style={styles.text}>{PHASE_LABEL[p]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space.xs, paddingHorizontal: 2 },
  item: { flexDirection: 'row', alignItems: 'center', marginRight: theme.sp(3.5), marginTop: theme.sp(1) },
  dot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1.25) },
  text: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
