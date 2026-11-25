/**
 * VerdictPill —— 指标数值旁的「正常 / 偏高 / 偏低」小标记
 * 色值与睡眠卡、洞察页状态色同源（theme.colors.ui.status），不新造颜色。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import type { Verdict } from '../lib/metricVerdict';

export default function VerdictPill({ verdict, small = false }: { verdict: Verdict; small?: boolean }) {
  const c = theme.colors.ui.status[verdict.tone];
  const soft = verdict.tone === 'good' ? theme.colors.ui.status.goodSoft
    : verdict.tone === 'warn' ? theme.colors.ui.status.warnSoft
    : verdict.tone === 'danger' ? theme.colors.ui.status.dangerSoft
    : 'rgba(255,255,255,0.10)';
  return (
    <View style={[styles.pill, small && styles.pillSmall, { backgroundColor: soft }]}>
      <Text style={[styles.text, small && styles.textSmall, { color: c }]}>{verdict.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: theme.sp(1.5),
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
  },
  pillSmall: { paddingHorizontal: theme.sp(1), paddingVertical: 0 },
  text: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  textSmall: { fontSize: 10 },
});
