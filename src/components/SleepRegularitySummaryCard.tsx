/**
 * SleepRegularitySummaryCard —— 洞察页「昼夜节律」卡片（紧凑版，主视觉 = 睡眠规律性）
 *
 * ★ 2026-11-09（用户纠偏）：洞察页「昼夜节律」卡原先主视觉是皮质醇（AllDayRecoveryCard），
 *   现改为直接展示「睡眠规律性」：入睡/起床区间柱状图（周视图）+ 规律性状态/平均入睡/平均起床。
 *   皮质醇因批处理算法未达精准，不再在主视觉露出（仅在详情页最底部弱化处理）。
 *
 * 数据全部真实，来自 healthStore 逐日睡眠时刻（collectSleepSeries / analyzeSleepRegularity），
 * 与 SleepRegularityDetailScreen 同源、同一套口径。只做描述性观察，不评分、不诊断。
 *
 * ★ 2026-11-09（用户：「昼夜节律卡趋势图下面要有分析，跟其他模块一样」）：
 *   本卡在 11-09 从 AllDayRecoveryCard（皮质醇）换成睡眠规律性视图时，把原趋势图下方的
 *   AiAnalysis 分析段弄丢了（旧卡 AllDayRecoveryCard.tsx:547 有、相邻的 StressRecoveryCard.tsx:91 也有）。
 *   现按同款外壳加回，文案取 reg.summary + cmp.headline（与详情页同源的真实数据派生结论）。
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import SleepRegularityChart from './SleepRegularityChart';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import {
  analyzeSleepRegularity,
  buildBaselineComparison,
  clockFromNormH,
  collectSleepSeries,
  seriesTicks,
} from '../lib/sleepRegularity';

interface Props {
  /** 点卡片进详情页 */
  onPress?: () => void;
}

export default function SleepRegularitySummaryCard({ onPress }: Props) {
  const hsVer = useHealthStoreVersion();
  const range = 'week' as const;
  const anchor = useMemo(() => new Date(), [hsVer]);

  const points = useMemo(() => collectSleepSeries(range, anchor), [anchor, hsVer]);
  const reg = useMemo(() => analyzeSleepRegularity(points, range), [points, range]);
  const ticks = useMemo(() => seriesTicks(points, range), [points, range]);
  const cmp = useMemo(() => buildBaselineComparison(new Date()), [hsVer]);

  const toneColor =
    reg.tone === 'warn' ? mm.colors.honeyCore : reg.tone === 'good' ? mm.colors.limeCore : mm.colors.ink;
  const meanBed = reg.meanBedH != null ? clockFromNormH(reg.meanBedH) : '—';
  const meanWake = reg.meanWakeH != null ? clockFromNormH(reg.meanWakeH) : '—';

  // 分析段正文：规律性结论（与详情页 Hero 同源）+ 最近一晚与作息基线的真实对比，
  // 全部由实测时刻派生，不编造、不评价、不做诊断。
  const analysisBody = reg.n === 0
    ? reg.summary
    : [reg.summary, cmp.headline ? `${cmp.headline}。` : ''].filter(Boolean).join(' ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel="昼夜节律：睡眠作息规律性"
    >
      <View style={styles.headRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>昼夜节律</Text>
          <Text style={styles.subtitle}>睡眠作息规律性</Text>
        </View>
        <Icon name="chevronRight" size={18} color={mm.colors.inkFaint} />
      </View>

      {/* 规律性数据：状态 + 平均入睡 + 平均起床 —— 置于图表上方，
          与洞察页其他卡片（指标在上、图在下）保持一致 */}
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>规律性</Text>
          <Text style={[styles.statValue, { color: toneColor }]} numberOfLines={1} adjustsFontSizeToFit>
            {reg.label}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statLabel}>平均入睡</Text>
          <Text style={styles.statValue}>{meanBed}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statLabel}>平均起床</Text>
          <Text style={styles.statValue}>{meanWake}</Text>
        </View>
      </View>

      {/* 主图：入睡 / 起床区间柱（周视图 7 根） */}
      <View style={styles.chartWrap}>
        <SleepRegularityChart
          points={points}
          height={148}
          baselineBedH={cmp.baselineBedH}
          ticks={ticks}
        />
      </View>

      {/* ★ 2026-11-09（用户）：趋势图下方补回分析模块 —— 与相邻「压力恢复节律」卡
          （StressRecoveryCard.tsx:91）及旧昼夜节律卡完全同款：AiAnalysis + AiResultRow。 */}
      {analysisBody ? (
        <AiAnalysis>
          <AiResultRow tone={reg.tone} title={reg.label} bodyColor={theme.colors.textBody}>
            {analysisBody}
          </AiResultRow>
        </AiAnalysis>
      ) : null}

      {reg.n === 0 ? (
        <Text style={styles.foot}>这段时间还没有带入睡 / 起床时刻的记录，连上戒指后这里会自动画出对应的区间柱。</Text>
      ) : (
        <Text style={styles.foot}>只描述作息时间的变化，不构成诊断或评分。</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  cardPressed: { opacity: 0.92 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  titleWrap: { flex: 1 },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  subtitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  chartWrap: { marginTop: theme.space.sm },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.sm,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: theme.colors.ui.borderSoft },
  statLabel: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, marginBottom: 3 },
  statValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  foot: {
    fontSize: theme.fontSize.tiny,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
    opacity: 0.85,
  },
});
