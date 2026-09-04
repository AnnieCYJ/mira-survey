/**
 * PeriodLogCard —— 周期 tab 内的「今日经期状态」记录卡
 *
 * 让用户补充戒指测不到的自感状态：经量（点滴/量少/正常/量多）+ 疼痛程度（无痛/轻微/中度/严重）。
 * 数据存本地 periodLog.json，与 CycleCalendarScreen 的日详情编辑共用同一份数据，
 * 并回写到周期日历上标记真实经期日。属隐私，仅本机沙盒。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { dayKey } from '../lib/cycleMath';
import {
  loadPeriodDay,
  savePeriodDay,
  FLOW_LABEL,
  PAIN_LABEL,
  type FlowLevel,
  type PainLevel,
  type PeriodDayLog,
} from '../data/cycleLog';

const FLOWS: FlowLevel[] = ['spotting', 'light', 'normal', 'heavy'];
const PAINS: PainLevel[] = ['none', 'mild', 'moderate', 'severe'];

export default function PeriodLogCard({ onPress }: { onPress?: () => void }) {
  const todayKey = dayKey(new Date());
  const [flow, setFlow] = useState<FlowLevel>('');
  const [pain, setPain] = useState<PainLevel>('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void loadPeriodDay(todayKey).then((d) => {
      if (d) {
        setFlow(d.flow ?? '');
        setPain(d.pain ?? '');
        setSavedAt(d.updatedAt ?? null);
      }
    });
  }, [todayKey]);

  const save = async () => {
    const entry: PeriodDayLog = { date: todayKey, flow, pain, updatedAt: Date.now() };
    await savePeriodDay(entry);
    setSavedAt(entry.updatedAt!);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>今日经期状态</Text>
        <Text style={styles.date}>{new Date().getMonth() + 1}/{new Date().getDate()}</Text>
      </View>

      <Text style={styles.label}>经量</Text>
      <View style={styles.chipRow}>
        {FLOWS.map((f) => (
          <TouchableOpacity key={f} activeOpacity={0.7} onPress={() => setFlow(f === flow ? '' : f)} style={[styles.chip, flow === f && styles.chipOn]}>
            <Text style={[styles.chipText, flow === f && styles.chipTextOn]}>{FLOW_LABEL[f]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>疼痛程度</Text>
      <View style={styles.chipRow}>
        {PAINS.map((p) => (
          <TouchableOpacity key={p} activeOpacity={0.7} onPress={() => setPain(p === pain ? '' : p)} style={[styles.chip, pain === p && styles.chipOn]}>
            <Text style={[styles.chipText, pain === p && styles.chipTextOn]}>{PAIN_LABEL[p]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footRow}>
        <Text style={styles.saved}>
          {savedAt ? `已保存 · ${(() => { const d = new Date(savedAt); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; })()}` : '尚未记录今日'}
        </Text>
        <TouchableOpacity activeOpacity={0.8} onPress={save} style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>保存</Text>
        </TouchableOpacity>
      </View>

      {onPress ? (
        <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.moreBtn}>
          <Text style={styles.moreText}>查看周期日历 →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.sm },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  date: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, marginTop: theme.space.sm, marginBottom: 6, fontWeight: theme.weight.semibold as any },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: 'rgba(124,106,224,0.10)' },
  chipOn: { backgroundColor: theme.colors.accentSolid },
  chipText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  chipTextOn: { color: '#fff', fontWeight: theme.weight.semibold as any },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.md },
  saved: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft },
  saveBtnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.accentSolid },
  moreBtn: { marginTop: theme.space.md, alignItems: 'flex-end' },
  moreText: { fontSize: theme.fontSize.sm, color: theme.colors.accentSolid },
});
