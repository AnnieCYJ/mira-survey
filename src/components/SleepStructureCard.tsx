import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import SleepStageChart, { SLEEP_STAGE_META } from './SleepStageChart';
import type { SleepSegment, SleepSummary } from '../ble/RingBleManager';

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  return `${m}分`;
}

/** 睡眠结构卡：整夜分期图 + 摘要（总时长/深睡占比/REM 占比/评分） */
export default function SleepStructureCard({
  segments,
  summary,
  sleepTime,
  wakeTime,
  deepPct,
  remPct,
  score,
  fallbackTotalMinutes,
  onPress,
}: {
  segments: SleepSegment[] | null;
  summary: SleepSummary | null;
  sleepTime: string | null;
  wakeTime: string | null;
  deepPct: number | null;
  remPct: number | null;
  score: number | null;
  fallbackTotalMinutes?: number | null;
  onPress?: () => void;
}) {
  const hasStages = !!segments && segments.length > 0;
  const hasSummary = !!summary && summary.total > 0;
  const total = summary?.total || fallbackTotalMinutes || 0;
  const deep = summary?.deep ?? 0;
  const rem = summary?.rem ?? 0;

  // 占比优先用 summary 的分钟数精确计算；缺失时回落到 daily 已算好的百分比
  const dPct = deepPct != null ? deepPct : total > 0 ? Math.round((deep / total) * 100) : null;
  const rPct = remPct != null ? remPct : total > 0 ? Math.round((rem / total) * 100) : null;

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.92 : 1}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.card, theme.glass, theme.shadow.card]}
    >
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>睡眠结构</Text>
          <Text style={styles.sub}>昨夜整夜分期</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.total}>{total > 0 ? fmtDuration(total) : '—'}</Text>
          <Text style={styles.totalLabel}>总睡眠</Text>
        </View>
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>入睡 {sleepTime ?? '—'}</Text>
        <Text style={styles.timeText}>起床 {wakeTime ?? '—'}</Text>
      </View>

      {hasStages ? (
        <SleepStageChart segments={segments!} sleepTime={sleepTime} />
      ) : (
        <View style={styles.chartEmpty}>
          <Text style={styles.emptyText}>
            {hasSummary
              ? '睡眠摘要已同步。整夜分期图需重新编译原生包（Xcode ⌘R）后显示。'
              : '连接戒指并将昨夜睡眠同步后，自动绘制整夜分期'}
          </Text>
        </View>
      )}

      {/* 图例 */}
      <View style={styles.legendRow}>
        {[0, 1, 2, 4].map((t) => (
          <View key={t} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: SLEEP_STAGE_META[t].color }]} />
            <Text style={styles.legendText}>{SLEEP_STAGE_META[t].label}</Text>
          </View>
        ))}
      </View>

      {/* 摘要 */}
      <View style={styles.summaryRow}>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{dPct != null ? `${dPct}%` : '—'}</Text>
          <Text style={styles.sumLabel}>深睡占比</Text>
        </View>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{rPct != null ? `${rPct}%` : '—'}</Text>
          <Text style={styles.sumLabel}>REM 占比</Text>
        </View>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{score != null ? `${score}` : '—'}</Text>
          <Text style={styles.sumLabel}>睡眠评分</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    gap: theme.space.md,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  sub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
  },
  totalWrap: { alignItems: 'flex-end' },
  total: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  totalLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
  },
  chartEmpty: {
    height: theme.sp(11),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.md,
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1.5),
  },
  dot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.radius.pill,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.ui.borderSoft,
  },
  sumItem: {
    alignItems: 'center',
  },
  sumVal: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  sumLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
});
