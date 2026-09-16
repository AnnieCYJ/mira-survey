/**
 * ExamTab —— 「身体成分」单卡片
 * ---------------------------------------------------------------------------
 * 未填写 → 整卡就是表单（体重/身高/年龄/性别 + 生成按钮）
 * 已填写 → 上半：个人信息摘要（可点修改）；下半：最新身体成分报告
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Card from './Card';
import { RingBle } from '../ble/RingBleManager';
import {
  getLatestExamRecord,
  countExamRecords,
  saveExamRecord,
  type Sex,
  type ExamRecord,
  type BodyMetric,
  type MetricStatus,
} from '../data/examStore';

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

function fmtMetric(m: BodyMetric): string {
  return m.value.toFixed(m.decimals);
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ExamTab() {
  const navigation = useNavigation<any>();
  const saved = RingBle.getUserProfile();
  const [weight, setWeight] = useState(saved ? String(saved.weight) : '');
  const [height, setHeight] = useState(saved ? String(saved.height) : '');
  const [age, setAge] = useState(saved ? String(saved.age) : '');
  const [sex, setSex] = useState<Sex>(saved ? (saved.sex === 1 ? 'male' : 'female') : 'female');
  const [latest, setLatest] = useState<ExamRecord | null>(null);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [rec, n] = await Promise.all([getLatestExamRecord(), countExamRecords()]);
      if (!active) return;
      setLatest(rec);
      setCount(n);
    })();
    return () => { active = false; };
  }, []);

  const isFilled = !!(weight && height && age);

  const generate = async () => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseFloat(age);
    if (!(w > 0 && h > 0 && a > 0)) return;
    setSaving(true);
    try {
      const rec = await saveExamRecord({ weight: w, height: h, age: a, sex });
      setLatest(rec);
      setCount((c) => c + 1);
      RingBle.setUserInfo({ weight: w, height: h, age: a, sex: sex === 'male' ? 1 : 0 });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const openHistory = () => navigation.navigate('BodyCompositionHistory');

  const sexLabels: { v: Sex; label: string }[] = [
    { v: 'female', label: '女' },
    { v: 'male', label: '男' },
  ];

  const sexText = sex === 'male' ? '男' : '女';

  return (
    <Card>
      {/* 未填写 → 整卡表单 */}
      {!isFilled && (
        <>
          <Text style={styles.cardTitle}>身体成分</Text>
          <Text style={styles.hint}>
            录入身高 / 体重 / 年龄 / 性别后生成身体成分估算报告。数据仅保存在本机。
          </Text>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>体重 (kg)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={weight}
                onChangeText={setWeight}
                placeholder="55"
                placeholderTextColor={theme.colors.textSub}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>身高 (cm)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={height}
                onChangeText={setHeight}
                placeholder="165"
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
                placeholder="30"
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
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.segText, sex === s.v && styles.segTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.save} onPress={generate} disabled={saving} activeOpacity={0.8}>
            <Text style={styles.saveText}>{saving ? '计算中…' : '生成体检报告'}</Text>
          </TouchableOpacity>
        </>
      )}

      {/* 已填写 → 上半摘要 / 编辑表单 + 下半报告 */}
      {isFilled && (
        <>
          {/* 标题行 */}
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>身体成分</Text>
            {!editing && (
              <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.7}>
                <Text style={styles.editBtn}>修改</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 编辑模式 */}
          {editing && (
            <>
              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.label}>体重 (kg)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={weight}
                    onChangeText={setWeight}
                    placeholder="55"
                    placeholderTextColor={theme.colors.textSub}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>身高 (cm)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={height}
                    onChangeText={setHeight}
                    placeholder="165"
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
                    placeholder="30"
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
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.segText, sex === s.v && styles.segTextOn]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    if (saved) {
                      setWeight(String(saved.weight));
                      setHeight(String(saved.height));
                      setAge(String(saved.age));
                      setSex(saved.sex === 1 ? 'male' : 'female');
                    }
                    setEditing(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.save}
                  onPress={generate}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  <Text style={styles.saveText}>{saving ? '计算中…' : '保存并重新生成'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* 摘要模式 */}
          {!editing && (
            <>
              <View style={styles.profileRow}>
                <View style={styles.profileItem}>
                  <Text style={styles.profileVal}>{weight}</Text>
                  <Text style={styles.profileUnit}>kg</Text>
                  <Text style={styles.profileLabel}>体重</Text>
                </View>
                <View style={styles.profileDivider} />
                <View style={styles.profileItem}>
                  <Text style={styles.profileVal}>{height}</Text>
                  <Text style={styles.profileUnit}>cm</Text>
                  <Text style={styles.profileLabel}>身高</Text>
                </View>
                <View style={styles.profileDivider} />
                <View style={styles.profileItem}>
                  <Text style={styles.profileVal}>{age}</Text>
                  <Text style={styles.profileUnit}>岁</Text>
                  <Text style={styles.profileLabel}>年龄</Text>
                </View>
                <View style={styles.profileDivider} />
                <View style={styles.profileItem}>
                  <Text style={styles.profileVal}>{sexText}</Text>
                  <Text style={styles.profileUnit}></Text>
                  <Text style={styles.profileLabel}>性别</Text>
                </View>
              </View>
            </>
          )}

          {/* 分割线（摘要模式下有报告才显示） */}
          {!editing && latest && <View style={styles.divider} />}

          {/* 身体成分报告 */}
          {!editing && latest && (
            <>
              <View style={styles.reportHead}>
                <Text style={styles.reportTitle}>身体成分报告</Text>
                <View style={styles.dateChip}>
                  <Text style={styles.dateText}>{fmtDate(latest.createdAt)}</Text>
                </View>
              </View>
              <View style={styles.metricGrid}>
                {latest.metrics.map((m) => (
                  <View style={styles.metricCell} key={m.key}>
                    <Text style={styles.metricName}>{m.name}</Text>
                    <View style={styles.metricValRow}>
                      <Text style={styles.metricVal}>{fmtMetric(m)}</Text>
                      {m.unit ? <Text style={styles.metricUnit}>{m.unit}</Text> : null}
                    </View>
                    {m.status !== 'info' ? (
                      <View style={[styles.pill, { backgroundColor: STATUS_COLOR[m.status] + '22' }]}>
                        <Text style={[styles.pillText, { color: STATUS_COLOR[m.status] }]}>
                          {STATUS_TEXT[m.status]}
                        </Text>
                      </View>
                    ) : m.range !== '—' ? (
                      <Text style={styles.metricRange}>{m.range}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
              <Text style={styles.disclaimer}>
                以上为基于身高 / 体重 / 年龄的估算参考值（BMI、Deurenberg 体脂率、Mifflin-St Jeor 基础代谢率），非医学诊断。
              </Text>
              <TouchableOpacity style={styles.historyFoot} onPress={openHistory} activeOpacity={0.8}>
                <Text style={styles.historyFootText}>查看 {count} 次历史记录</Text>
                <Text style={styles.historyFootArrow}>›</Text>
              </TouchableOpacity>
            </>
          )}

          {/* 已填写但还没生成报告 */}
          {!editing && !latest && (
            <TouchableOpacity style={styles.save} onPress={generate} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.saveText}>{saving ? '计算中…' : '生成体检报告'}</Text>
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
    marginBottom: theme.space.xs,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.space.sm,
  },
  editBtn: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accentSolid,
    fontWeight: theme.weight.medium,
  },
  hint: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  row: { flexDirection: 'row', marginBottom: theme.space.sm },
  field: { flex: 1 },
  label: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.xs,
  },
  input: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    fontSize: theme.fontSize.card,
    color: theme.colors.textTitle,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    padding: theme.sp(1),
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.card,
  },
  segBtnOn: { backgroundColor: theme.colors.accentSolid },
  segText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textSub },
  segTextOn: { color: '#FFFFFF' },
  editActions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.xs },
  cancelBtn: {
    flex: 1,
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    alignItems: 'center',
  },
  cancelText: { fontSize: theme.fontSize.card, color: theme.colors.textSub, fontWeight: theme.weight.medium },
  save: {
    marginTop: theme.space.xs,
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    alignItems: 'center',
  },
  saveText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: '#FFFFFF' },

  // 个人信息摘要行
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.card,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.sm,
  },
  profileItem: { flex: 1, alignItems: 'center' },
  profileVal: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  profileUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 1,
  },
  profileLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 2,
  },
  profileDivider: {
    width: 1,
    height: 36,
    backgroundColor: theme.colors.ui.borderSoft,
  },

  divider: {
    height: 1,
    backgroundColor: theme.colors.ui.borderSoft,
    marginTop: theme.space.md,
    marginBottom: theme.space.sm,
  },

  reportHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  reportTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  dateChip: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1),
  },
  dateText: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid, fontWeight: theme.weight.medium },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  metricCell: {
    width: '31%',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.sm,
    marginBottom: theme.space.sm,
    alignItems: 'center',
  },
  metricName: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1), textAlign: 'center' },
  metricValRow: { flexDirection: 'row', alignItems: 'baseline' },
  metricVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  metricUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  pill: {
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
  disclaimer: {
    marginTop: theme.space.sm,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
  },
  historyFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.ui.borderSoft,
  },
  historyFootText: { fontSize: theme.fontSize.sm, color: theme.colors.accentSolid, fontWeight: theme.weight.medium },
  historyFootArrow: { fontSize: theme.fontSize.h2, color: theme.colors.accentSolid, lineHeight: theme.fontSize.h2 },
});
