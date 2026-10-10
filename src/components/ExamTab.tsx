/**
 * ExamTab —— 「身体成分」紧凑版
 * ---------------------------------------------------------------------------
 * 编辑中 → 校验字段，保存成功后才进入摘要
 * 保存成功 → 摘要 + 修改/查看
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { LinearGradient } from 'expo-linear-gradient';
import Card from './Card';
import { validateProfile } from '../lib/profileForm';
import { RingBle } from '../ble/RingBleManager';
import {
  getLatestExamRecord,
  type Sex,
  type ExamRecord,
} from '../data/examStore';

export default function ExamTab({ onProfileSaved }: { onProfileSaved?: (age: number) => void }) {
  const navigation = useNavigation<any>();
  const saved = RingBle.getUserProfile();
  const [weight, setWeight] = useState(saved ? String(saved.weight) : '');
  const [height, setHeight] = useState(saved ? String(saved.height) : '');
  const [age, setAge] = useState(saved ? String(saved.age) : '');
  const [sex, setSex] = useState<Sex>(saved ? (saved.sex === 1 ? 'male' : 'female') : 'female');
  const [latest, setLatest] = useState<ExamRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const touchedRef = useRef(false);
  const [editing, setEditing] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<'weight' | 'height' | 'age', string>>>({});
  const [error, setError] = useState('');
  const fieldRefs = { weight: useRef<TextInput>(null), height: useRef<TextInput>(null), age: useRef<TextInput>(null) };
  const changeField = (key: 'weight' | 'height' | 'age', value: string) => {
    touchedRef.current = true;
    ({ weight: setWeight, height: setHeight, age: setAge })[key](value);
    setErrors(previous => ({ ...previous, [key]: undefined }));
    setError('');
  };

  useEffect(() => {
    let mounted = true;
    getLatestExamRecord().then(rec => {
      if (!mounted) return;
      setLatest(rec);
      if (rec && !touchedRef.current) {
        setWeight(String(rec.inputs.weight)); setHeight(String(rec.inputs.height));
        setAge(String(rec.inputs.age)); setSex(rec.inputs.sex); setEditing(false);
      }
    }).catch(() => { if (mounted) setError('历史报告暂时无法读取，可以重试或重新生成。'); });
    return () => { mounted = false; };
  }, []);


  const generate = async () => {
    if (savingRef.current) return;
    const result = validateProfile({ weight, height, age, sex });
    if (!result.ok) {
      setErrors(result.errors);
      const first = (['weight', 'height', 'age'] as const).find(key => result.errors[key]);
      if (first) fieldRefs[first].current?.focus();
      return;
    }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const { saveExamRecord } = await import('../data/examStore');
      const rec = await saveExamRecord(result.inputs);
      RingBle.setUserInfo({ ...result.inputs, sex: sex === 'male' ? 1 : 0 });
      setLatest(rec); setEditing(false);
      onProfileSaved?.(rec.inputs.age);
    } catch {
      setError('报告未保存成功，请重试。填写的内容已保留。');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };

  const sexLabels: { v: Sex; label: string }[] = [
    { v: 'female', label: '女' },
    { v: 'male', label: '男' },
  ];

  const sexText = sex === 'male' ? '男' : '女';

  return (
    <Card style={{ padding: theme.space.cardPadCompact }}>
      {/* 标题 */}
      <Text style={styles.cardTitle}>身体成分</Text>

      <Text style={styles.note}>根据身高、体重和年龄进行估算</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {editing ? (
        <>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>体重（kg）</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={weight}
                ref={fieldRefs.weight} editable={!saving} accessibilityLabel="体重，单位千克"
                onChangeText={value => changeField('weight', value)}
                placeholder="例如 55"
                placeholderTextColor={theme.colors.textSub}
              />
              {!!errors.weight && <Text accessibilityRole="alert" style={styles.error}>{errors.weight}</Text>}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>身高（cm）</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={height}
                ref={fieldRefs.height} editable={!saving} accessibilityLabel="身高，单位厘米"
                onChangeText={value => changeField('height', value)}
                placeholder="例如 165"
                placeholderTextColor={theme.colors.textSub}
              />
              {!!errors.height && <Text accessibilityRole="alert" style={styles.error}>{errors.height}</Text>}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>年龄</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={age}
                ref={fieldRefs.age} editable={!saving} accessibilityLabel="年龄，单位岁"
                onChangeText={value => changeField('age', value)}
                placeholder="例如 28"
                placeholderTextColor={theme.colors.textSub}
              />
              {!!errors.age && <Text accessibilityRole="alert" style={styles.error}>{errors.age}</Text>}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>性别</Text>
              <View style={styles.seg}>
                {sexLabels.map((s) => (
                  <TouchableOpacity
                    key={s.v}
                    style={[styles.segBtn, sex === s.v && styles.segBtnOn]}
                    disabled={saving}
                aria-selected={sex === s.v} aria-disabled={saving}
                accessibilityRole="button" accessibilityLabel={s.label}
                accessibilityState={{ selected: sex === s.v, disabled: saving }}
                onPress={() => { touchedRef.current = true; setSex(s.v); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.segText, sex === s.v && styles.segTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.save} onPress={generate} disabled={saving} activeOpacity={theme.press.opacity}
            accessibilityRole="button" accessibilityLabel={saving ? '正在保存报告' : '生成估算报告'} accessibilityState={{ disabled: saving, busy: saving }} aria-busy={saving} aria-disabled={saving}>
            {/* v10：主按钮统一 lime→粉 渐变 */}
            <LinearGradient
              colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveGrad}
            >
              <Text style={styles.saveText}>{saving ? '计算中…' : '生成估算报告'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TouchableOpacity onPress={() => { touchedRef.current = true; setEditing(true); setError(''); }}
            style={styles.viewReport} accessibilityRole="button" accessibilityLabel="修改身体档案">
            <Text style={styles.viewReportText}>修改档案</Text>
          </TouchableOpacity>
          {/* 保存成功后才展示摘要。 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{latest?.inputs.weight}</Text>
              <Text style={styles.summaryUnit}>kg</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{latest?.inputs.height}</Text>
              <Text style={styles.summaryUnit}>cm</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{latest?.inputs.age}</Text>
              <Text style={styles.summaryUnit}>岁</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{sexText}</Text>
            </View>
          </View>
          {latest && latest.metrics.length > 0 && (
            <TouchableOpacity
              style={styles.viewReport}
              onPress={() => navigation.navigate('BodyCompositionHistory')}
              activeOpacity={0.7}
            >
              <Text style={styles.viewReportText}>查看报告 ›</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginBottom: theme.space.sm },
  error: { fontSize: theme.fontSize.xs, color: theme.colors.trendDown, marginBottom: theme.space.xs },
  cardTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1),
  },
  row: { flexDirection: 'row', marginBottom: theme.sp(0.75), gap: theme.sp(0.75) },
  field: { flex: 1 },
  label: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: 2,
  },
  input: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp(1.5),
    paddingVertical: theme.sp(1),
    minHeight: 48,
    fontSize: theme.fontSize.body,
    color: theme.colors.textTitle,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(0.75),
    minHeight: 48, justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
  segBtnOn: { backgroundColor: mm.colors.lime },
  segText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: mm.colors.inkSoft },
  segTextOn: { color: mm.colors.ink },
  save: {
    marginTop: theme.sp(0.5),
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
  },
  saveGrad: {
    minHeight: 48, justifyContent: 'center',
    paddingVertical: theme.sp(1.25),
    alignItems: 'center',
  },
  saveText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad },

  // 摘要模式（紧凑）
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.sp(1.5),
    paddingHorizontal: theme.sp(1),
    marginBottom: theme.sp(1),
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  summaryVal: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  summaryUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginLeft: 2,
  },
  viewReport: {
    alignItems: 'center',
    minHeight: 48, justifyContent: 'center',
    paddingVertical: theme.sp(0.75),
  },
  viewReportText: { fontSize: theme.fontSize.micro, color: mm.colors.lavenderDeep, fontWeight: theme.weight.medium },
});
