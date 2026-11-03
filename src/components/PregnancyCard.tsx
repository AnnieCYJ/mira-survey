/**
 * PregnancyCard —— 孕期洞察（P1-1，2026-10-28）
 *
 * ★ 与 Oura 孕期对标：受孕窗 + 孕期周数 + 三孕期健康提示。
 * ★ 权威口径（见 lib/pregnancy.ts）：孕周以末次经期（LMP）为基准；预产期 Naegele 规则（LMP+280）；
 *   三孕期 1–13 / 14–27 / 28–40 周（ACOG / WHO 划分）。
 * ★ 入口：周期页顶部「孕期模式」开关（需填 LMP）。未开启或没填 LMP 不展示。
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { computePregnancy, TRIMESTER_LABEL, TRIMESTER_TIPS } from '../lib/pregnancy';

export default function PregnancyCard({
  pregnant,
  lmp,
  onEditLmp,
}: {
  pregnant: boolean | undefined;
  lmp?: string;
  onEditLmp?: () => void;
}) {
  const info = computePregnancy(lmp, pregnant);
  if (!info.enough) return null;
  const trimester = info.trimester!;
  const tips = TRIMESTER_TIPS[trimester];
  const pct = Math.round((info.progressPct ?? 0) * 100);

  return (
    <Card style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>孕期</Text>
        <Text style={[styles.trimester, { color: mm.colors.limeDeep }]}>{TRIMESTER_LABEL[trimester]}</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroNum}>{info.weeks}</Text>
        <Text style={styles.heroUnit}>周 {info.days} 天</Text>
      </View>

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.due}>预产期 {info.dueDate ?? '—'} · 进度 {pct}%</Text>

      <View style={styles.tips}>
        <Text style={styles.tipsTitle}>本孕期健康提示</Text>
        {tips.map((t, i) => (
          <Text key={i} style={styles.tip}>· {t}</Text>
        ))}
      </View>

      {onEditLmp && (
        <TouchableOpacity style={styles.editBtn} activeOpacity={0.7} onPress={onEditLmp}>
          <Text style={styles.editText}>修改末次经期</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.note}>孕周以末次经期（LMP）为基准，预产期按 Naegele 规则（LMP+280 天）。仅供参考，不替代产检与医生诊断。</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { padding: theme.space.cardPad, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  trimester: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  hero: { flexDirection: 'row', alignItems: 'baseline', marginBottom: theme.space.sm },
  heroNum: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.semibold, letterSpacing: -1.5, lineHeight: 48, color: mm.colors.ink },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: 6 },
  bar: { height: 8, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.pill, overflow: 'hidden', marginBottom: 6 },
  barFill: { height: '100%', backgroundColor: mm.colors.limeCore, borderRadius: theme.radius.pill },
  due: { fontSize: theme.fontSize.sm, color: mm.colors.ink, marginBottom: theme.space.sm },
  tips: { marginTop: theme.space.xs },
  tipsTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: 4 },
  tip: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: 18, marginBottom: 2 },
  editBtn: { marginTop: theme.space.sm, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: mm.colors.limeSoft },
  editText: { fontSize: theme.fontSize.sm, color: mm.colors.limeDeep, fontWeight: theme.weight.semibold },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, lineHeight: 17, opacity: 0.85 },
});
