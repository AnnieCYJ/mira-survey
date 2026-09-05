/**
 * ExamTab —— 洞察页「一键体检」tab 内容
 * ---------------------------------------------------------------------------
 *  - 上半：个人信息录入卡片（体重 / 身高 / 年龄 / 性别），点「生成体检报告」即估算并落库；
 *  - 下半：仅展示【最新一次】身体成分报告卡片（8 项指标网格 + 健康状态胶囊 + 免责声明），
 *          整卡可点进入历史页（按时间先后查看每次测量）。
 *  - 设计严格复用 theme token 与 InsightScreen 既有录入样式（profInput / profRow / seg），
 *    保证全 App 视觉一致。
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

  // 载入最新记录 + 总数（洞察页只展示最新；历史页展示全部）
  useEffect(() => {
    let active = true;
    (async () => {
      const [rec, n] = await Promise.all([getLatestExamRecord(), countExamRecords()]);
      if (!active) return;
      setLatest(rec);
      setCount(n);
    })();
    return () => {
      active = false;
    };
  }, []);

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
    } finally {
      setSaving(false);
    }
  };

  const openHistory = () => navigation.navigate('BodyCompositionHistory');

  const sexLabels: { v: Sex; label: string }[] = [
    { v: 'female', label: '女' },
    { v: 'male', label: '男' },
  ];

  return (
    <View style={styles.stack}>
      {/* 个人信息录入 */}
      <Card>
        <Text style={styles.title}>个人信息</Text>
        <Text style={styles.hint}>
          录入身高 / 体重 / 年龄 / 性别后生成身体成分估算报告。数据仅保存在本机，用于「一键体检」趋势记录。
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
      </Card>

      {/* 最新身体成分报告（洞察页仅展示最新） */}
      {latest ? (
        <TouchableOpacity style={styles.resultWrap} onPress={openHistory} activeOpacity={0.92}>
          <Card>
            <View style={styles.resultHead}>
              <Text style={styles.title}>身体成分报告</Text>
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

            <View style={styles.historyFoot}>
              <Text style={styles.historyFootText}>查看 {count} 次历史记录</Text>
              <Text style={styles.historyFootArrow}>›</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ) : (
        <Card>
          <Text style={styles.empty}>
            还没有体检记录。填写上方信息并点「生成体检报告」，这里会显示你最新的身体成分。
          </Text>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.lg },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.space.xs,
  },
  hint: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  row: { flexDirection: 'row', gap: theme.space.md, marginBottom: theme.space.sm },
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
  save: {
    marginTop: theme.space.xs,
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    alignItems: 'center',
  },
  saveText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: '#FFFFFF' },

  resultWrap: { width: '100%' },
  resultHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  dateChip: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1),
  },
  dateText: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid, fontWeight: theme.weight.medium },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  metricCell: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    minHeight: theme.sp(22),
    justifyContent: 'center',
  },
  metricName: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
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
    gap: 4,
  },
  historyFootText: { fontSize: theme.fontSize.sm, color: theme.colors.accentSolid, fontWeight: theme.weight.medium },
  historyFootArrow: { fontSize: theme.fontSize.h2, color: theme.colors.accentSolid, lineHeight: theme.fontSize.h2 },
  empty: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
  },
});
