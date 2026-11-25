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
import Icon from './Icon';
import InfoDot from './InfoDot';
import SleepInfoSheet from './SleepInfoSheet';
import { infoKeyFor } from '../lib/metricVerdict';
import { validateProfile } from '../lib/profileForm';
import { RingBle } from '../ble/RingBleManager';
import {
  getLatestExamRecord,
  countExamRecords,
  type Sex,
  type ExamRecord,
  type BodyMetric,
  type MetricStatus,
} from '../data/examStore';

/** 卡片头栏优先展示的 6 项身体成分结果（其余在「历史」页按次展开）。 */
const HEADLINE_KEYS = [
  'bmi',
  'bodyFatPercentage',
  'muscleMass',
  'boneMass',
  'waterContent',
  'basalMetabolicRate',
];
const STATUS_TEXT: Record<MetricStatus, string> = {
  low: '偏低',
  normal: '正常',
  high: '偏高',
  info: '',
};
const STATUS_COLOR: Record<MetricStatus, string> = {
  low: theme.colors.warn,
  normal: theme.colors.success,
  high: theme.colors.danger,
  info: theme.colors.textSub,
};
function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ExamTab({ onProfileSaved }: { onProfileSaved?: (age: number) => void }) {
  const navigation = useNavigation<any>();
  const saved = RingBle.getUserProfile();
  const [weight, setWeight] = useState(saved ? String(saved.weight) : '');
  const [height, setHeight] = useState(saved ? String(saved.height) : '');
  const [age, setAge] = useState(saved ? String(saved.age) : '');
  const [sex, setSex] = useState<Sex>(saved ? (saved.sex === 1 ? 'male' : 'female') : 'female');
  const [latest, setLatest] = useState<ExamRecord | null>(null);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const touchedRef = useRef(false);
  const [editing, setEditing] = useState(true);
  const [infoMetric, setInfoMetric] = useState<{ key: string; name: string; value: string; unit: string } | null>(null);
  const infoPressed = useRef(false);
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
    Promise.all([getLatestExamRecord(), countExamRecords()]).then(([rec, n]) => {
      if (!mounted) return;
      setLatest(rec);
      setCount(n);
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
          {/* 已测过：直接展示「最近一次测量结果」，整卡可点 → 历史（几次测量）。 */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { if (!infoPressed.current) navigation.navigate('BodyCompositionHistory'); }}
            accessibilityRole="button"
            accessibilityLabel="查看身体成分历史"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.dateSub}>最近一次 · {latest ? fmtDateShort(latest.createdAt) : '—'}</Text>
              <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} />
            </View>
            <View style={styles.resultGrid}>
              {(latest ? HEADLINE_KEYS : []).map((k) => {
                const m: BodyMetric | undefined = latest!.metrics.find((x) => x.key === k);
                if (!m) return null;
                return (
                  <View style={styles.metricCell} key={k}>
                    <View style={styles.metricNameRow}>
                      <Text style={styles.metricName}>{m.name}</Text>
                      <InfoDot onPress={() => {
                        infoPressed.current = true;
                        setInfoMetric({ key: m.key, name: m.name, value: m.value.toFixed(m.decimals), unit: m.unit });
                        setTimeout(() => { infoPressed.current = false; }, 80);
                      }} />
                    </View>
                    <View style={styles.metricValRow}>
                      <Text style={[styles.metricVal, { color: m.status === 'info' ? theme.colors.textTitle : STATUS_COLOR[m.status] }]} numberOfLines={1}>{m.value.toFixed(m.decimals)}</Text>
                      {m.unit ? <Text style={styles.metricUnit}>{m.unit}</Text> : null}
                    </View>
                    {m.status !== 'info' ? (
                      <View style={[styles.pill, { backgroundColor: STATUS_COLOR[m.status] + '22' }]}>
                        <Text style={[styles.pillText, { color: STATUS_COLOR[m.status] }]}>{STATUS_TEXT[m.status]}</Text>
                      </View>
                    ) : m.range !== '—' ? (
                      <Text style={styles.metricRange}>{m.range}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Text style={styles.historyHint}>
              查看全部 {count > 0 ? count : ''} 次测量 ›
            </Text>
          </TouchableOpacity>
          {/* 修改档案：次级动作，不再占据卡片主视觉。 */}
          <TouchableOpacity
            onPress={() => { touchedRef.current = true; setEditing(true); setError(''); }}
            style={styles.editLink}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="修改身体档案"
          >
            <Text style={styles.editLinkText}>修改档案</Text>
          </TouchableOpacity>
        </>
      )}
      <SleepInfoSheet
        visible={infoMetric != null}
        onClose={() => setInfoMetric(null)}
        metric={infoMetric ? infoKeyFor(infoMetric.key) : null}
        valueText={infoMetric ? `${infoMetric.name} ${infoMetric.value}${infoMetric.unit}` : null}
      />
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

  // 结果模式（最近一次测量）
  dateSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.sp(1),
  },
  resultGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
  },
  metricCell: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    minHeight: theme.sp(22),
    justifyContent: 'center',
  },
  metricNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: theme.sp(1) },
  metricName: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  metricValRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  metricVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  metricUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  pill: {
    alignSelf: 'flex-start',
    marginTop: theme.sp(1),
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: 2,
  },
  pillText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  metricRange: {
    marginTop: theme.sp(1),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  historyHint: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.micro,
    color: mm.colors.lavenderDeep,
    fontWeight: theme.weight.medium,
  },
  editLink: {
    alignItems: 'center',
    minHeight: 44, justifyContent: 'center',
    paddingVertical: theme.sp(0.75),
    marginTop: theme.space.sm,
  },
  editLinkText: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft, fontWeight: theme.weight.medium },
});
