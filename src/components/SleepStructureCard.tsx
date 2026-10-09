import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import SleepStageChart, { SLEEP_STAGE_META } from './SleepStageChart';
import { formatSleepClockText } from '../lib/sleepTime';
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
  dataStale,
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
  /**
   * ★ v18.104 断流即空态（与首页圆环 / 昼夜节律卡同一口径）：
   *   戒指已经很久没回传新采样时，这张卡**整块走空态** —— 时长/入睡/起床/分期图/占比/评分全置「—」，
   *   不给「0:29 同步的昨夜睡眠」再挂一遍。恢复同步后自动回到真实数据。
   */
  dataStale?: boolean;
}) {
  const hasStages = !!segments && segments.length > 0;
  const hasSummary = !!summary && summary.total > 0;
  const total = summary?.total || fallbackTotalMinutes || 0;
  const deep = summary?.deep ?? 0;
  const rem = summary?.rem ?? 0;

  // 占比优先用 summary 的分钟数精确计算；缺失时回落到 daily 已算好的百分比
  const dPct = deepPct != null ? deepPct : total > 0 ? Math.round((deep / total) * 100) : null;
  const rPct = remPct != null ? remPct : total > 0 ? Math.round((rem / total) * 100) : null;

  // ★ 展示前归一为 "HH:mm"：传入的睡眠时刻可能是原生完整 datetime
  //   （真实形态 "2026-09-18 01:38"），直接插值会印出「入睡 2026-09-18 01:38」。
  //   跨天（23:05 睡 → 次日 07:20 起）时起床侧自动带「次日」标注。
  //   归一后的 bed 同时传给分期图做时间轴起点，保证文案与刻度同源。
  const clock = dataStale
    ? { bed: null, wake: null }
    : formatSleepClockText(sleepTime, wakeTime);
  // 断流时所有派生/归档数值一律不给（口径对齐首页空态；真实时刻也一并隐藏，避免「旧值装成今天」）
  const shownTotal = dataStale ? 0 : total;
  const shownD = dataStale ? null : dPct;
  const shownR = dataStale ? null : rPct;
  const shownScore = dataStale ? null : score;
  const showStages = !!segments && segments.length > 0 && !dataStale;

  return (
    <TouchableOpacity
      activeOpacity={onPress ? theme.press.opacity : 1}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.card, theme.shadow.card]}
    >
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>睡眠结构</Text>
          <Text style={styles.sub}>{dataStale ? '戒指暂无新数据' : '昨夜整夜分期'}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.total}>{shownTotal > 0 ? fmtDuration(shownTotal) : '—'}</Text>
          <Text style={styles.totalLabel}>总睡眠</Text>
        </View>
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>入睡 {clock.bed ?? '—'}</Text>
        <Text style={styles.timeText}>起床 {clock.wake ?? '—'}</Text>
      </View>

      {showStages ? (
        <SleepStageChart
          segments={segments!}
          sleepTime={clock.bed}
          totalMinutes={shownTotal > 0 ? shownTotal : null}
        />
      ) : (
        <View style={styles.chartEmpty}>
          <Text style={styles.emptyText}>
            {dataStale
              ? '戒指已很久没有新数据，昨夜睡眠暂不显示（同步后自动补齐）'
              : hasSummary
                ? '睡眠摘要已同步；整夜分期尚未同步，连接戒指同步后自动补齐。'
                : '连接戒指并将昨夜睡眠同步后，自动绘制整夜分期'}
          </Text>
        </View>
      )}

      {/* 图例 */}
      {showStages ? (
      <View style={styles.legendRow}>
        {[0, 1, 2, 3, 4].map((t) => (
          <View key={t} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: SLEEP_STAGE_META[t].color }]} />
            <Text style={styles.legendText}>{SLEEP_STAGE_META[t].label}</Text>
          </View>
        ))}
      </View>
      ) : null}

      {/* 摘要 */}
      <View style={styles.summaryRow}>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{shownD != null ? `${shownD}%` : '—'}</Text>
          <Text style={styles.sumLabel}>深睡占比</Text>
        </View>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{shownR != null ? `${shownR}%` : '—'}</Text>
          <Text style={styles.sumLabel}>REM 占比</Text>
        </View>
        <View style={styles.sumItem}>
          <Text style={styles.sumVal}>{shownScore != null ? `${Math.round(shownScore)}` : '—'}</Text>
          <Text style={styles.sumLabel}>{shownScore != null ? '睡眠评分 /100' : '睡眠评分'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: mm.radius.card,
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
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
