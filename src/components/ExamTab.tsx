/**
 * ExamTab —— 「身体成分」紧凑版
 * ---------------------------------------------------------------------------
 * 未填写 → 紧凑表单（2 行 input + 性别 + 按钮）
 * 已填写 → 极简摘要 + 修改/查看
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { LinearGradient } from 'expo-linear-gradient';
import Card from './Card';
import { RingBle } from '../ble/RingBleManager';
import {
  getLatestExamRecord,
  type Sex,
  type ExamRecord,
} from '../data/examStore';

export default function ExamTab() {
  const navigation = useNavigation<any>();
  const saved = RingBle.getUserProfile();
  const [weight, setWeight] = useState(saved ? String(saved.weight) : '');
  const [height, setHeight] = useState(saved ? String(saved.height) : '');
  const [age, setAge] = useState(saved ? String(saved.age) : '');
  const [sex, setSex] = useState<Sex>(saved ? (saved.sex === 1 ? 'male' : 'female') : 'female');
  const [latest, setLatest] = useState<ExamRecord | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLatestExamRecord().then((rec) => setLatest(rec));
  }, []);

  const isFilled = !!(weight && height && age);

  const generate = async () => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseFloat(age);
    if (!(w > 0 && h > 0 && a > 0)) return;
    setSaving(true);
    try {
      const { saveExamRecord } = await import('../data/examStore');
      const rec = await saveExamRecord({ weight: w, height: h, age: a, sex });
      setLatest(rec);
      RingBle.setUserInfo({ weight: w, height: h, age: a, sex: sex === 'male' ? 1 : 0 });
    } finally {
      setSaving(false);
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

      {!isFilled ? (
        <>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>体重</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={weight}
                onChangeText={setWeight}
                placeholder="kg"
                placeholderTextColor={theme.colors.textSub}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>身高</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={height}
                onChangeText={setHeight}
                placeholder="cm"
                placeholderTextColor={theme.colors.textSub}
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>年龄</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={age}
                onChangeText={setAge}
                placeholder="岁"
                placeholderTextColor={theme.colors.textSub}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>性别</Text>
              <View style={styles.seg}>
                {sexLabels.map((s) => (
                  <TouchableOpacity
                    key={s.v}
                    style={[styles.segBtn, sex === s.v && styles.segBtnOn]}
                    onPress={() => setSex(s.v)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.segText, sex === s.v && styles.segTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.save} onPress={generate} disabled={saving} activeOpacity={0.7}>
            {/* v10：主按钮统一 lime→粉 渐变 */}
            <LinearGradient
              colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveGrad}
            >
              <Text style={styles.saveText}>{saving ? '计算中…' : '生成报告'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* 紧凑摘要 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{weight}</Text>
              <Text style={styles.summaryUnit}>kg</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{height}</Text>
              <Text style={styles.summaryUnit}>cm</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{age}</Text>
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
    paddingVertical: theme.sp(0.75),
  },
  viewReportText: { fontSize: theme.fontSize.micro, color: mm.colors.lavenderDeep, fontWeight: theme.weight.medium },
});
