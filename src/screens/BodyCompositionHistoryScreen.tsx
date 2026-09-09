/**
 * BodyCompositionHistoryScreen —— 「一键体检」历史详情页
 * ---------------------------------------------------------------------------
 *  - 进入方式：洞察页「一键体检」tab 中最新报告卡片点击进入；
 *  - 内容：把每次体检按【时间先后】升序排列为时间线，每条展示日期 + 录入信息 + 8 项身体成分；
 *  - 支持删除单次测量（Alert 二次确认）；
 *  - 设计 token 与洞察页 / StatusTrendDetailScreen 一致（返回头、卡片、指标网格同款）。
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import Icon from '../components/Icon';
import {
  getAllExamRecords,
  deleteExamRecord,
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

export default function BodyCompositionHistoryScreen() {
  const navigation = useNavigation<any>();
  const [records, setRecords] = useState<ExamRecord[]>([]);

  const load = useCallback(async () => {
    const recs = await getAllExamRecords(); // 升序：最早 → 最新
    setRecords(recs);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onDelete = (r: ExamRecord) => {
    Alert.alert('删除本次体检记录', '删除后无法恢复，确定删除吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteExamRecord(r.id);
          load();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={styles.stack}>
        {/* 返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>身体成分历史</Text>
            <Text style={styles.sub}>
              {records.length > 0 ? `按时间先后排列 · 共 ${records.length} 次` : '还没有体检记录'}
            </Text>
          </View>
        </View>

        {records.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>
              还没有体检记录。去洞察页「一键体检」录入身高 / 体重 / 年龄 / 性别，生成你的第一份身体成分报告。
            </Text>
          </Card>
        ) : (
          <View style={styles.timeline}>
            {records.map((r, i) => (
              <View style={styles.tlItem} key={r.id}>
                {i < records.length - 1 && <View style={styles.tlLine} />}
                <View style={styles.tlDot} />
                <Card>
                  <View style={styles.recHead}>
                    <View style={styles.dateChip}>
                      <Text style={styles.dateText}>{fmtDate(r.createdAt)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => onDelete(r)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
                      <Text style={styles.delText}>删除</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputs}>
                    身高 {r.inputs.height} cm · 体重 {r.inputs.weight} kg · 年龄 {r.inputs.age} ·{' '}
                    {r.inputs.sex === 'male' ? '男' : '女'}
                  </Text>

                  <View style={styles.metricGrid}>
                    {r.metrics.map((m) => (
                      <View style={styles.metricCell} key={m.key}>
                        <Text style={styles.metricName}>{m.name}</Text>
                        <View style={styles.metricValRow}>
                          <Text style={styles.metricVal} numberOfLines={1}>{fmtMetric(m)}</Text>
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
                </Card>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { padding: theme.space.xs, marginRight: theme.space.sm },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },

  emptyText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
  },

  // 时间线
  timeline: { position: 'relative' },
  tlItem: { position: 'relative', paddingLeft: theme.sp(11), paddingBottom: theme.space.lg },
  tlLine: {
    position: 'absolute',
    left: theme.sp(3),
    top: theme.sp(4),
    bottom: 0,
    width: 2,
    backgroundColor: theme.colors.ui.borderSoft,
  },
  tlDot: {
    position: 'absolute',
    left: theme.sp(1.5),
    top: theme.sp(4),
    width: theme.sp(3.5),
    height: theme.sp(3.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
    borderWidth: 3,
    borderColor: theme.colors.bgBottom,
  },

  recHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.xs,
  },
  dateChip: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1),
  },
  dateText: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid, fontWeight: theme.weight.medium },
  delText: { fontSize: theme.fontSize.sm, color: theme.colors.danger, fontWeight: theme.weight.medium },

  inputs: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },

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
});
