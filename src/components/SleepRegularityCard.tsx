/**
 * SleepRegularityCard —— 洞察页「身体节律」区 · 睡眠规律性卡片
 *
 * 卡片只回答三件事（用户 2026-11-08 定调）：
 *  ① 最近一晚的入睡 / 出睡（起床）时刻；
 *  ② 相比「前面几晚的基线」是睡早了还是睡晚了，差多少分钟；
 *  ③ 近 7 晚的区间柱缩略图 + 一句规律性状态。
 * 点进卡片 → SleepRegularityDetail（周 / 月 / 年 完整视图）。
 *
 * 数据全部来自 healthStore 逐日真实睡眠时刻；缺时刻的日子画空槽，不补值、不推算。
 * 样式与 StressRecoveryCard / AllDayRecoveryCard 完全同一套玻璃卡 token。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { MindIcon } from './MindIcons';
import SleepRegularityChart from './SleepRegularityChart';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import {
  analyzeSleepRegularity,
  buildBaselineComparison,
  collectSleepSeries,
} from '../lib/sleepRegularity';

export default function SleepRegularityCard({ onPress, title = '睡眠规律性' }: { onPress?: () => void; /** ★ 2026-11-08（用户）：洞察页这张卡对外叫「昼夜节律」，皮质醇卡收进详情页 */ title?: string }) {
  const hsVer = useHealthStoreVersion();
  const data = useMemo(() => {
    const now = new Date();
    const week = collectSleepSeries('week', now);
    return {
      week,
      cmp: buildBaselineComparison(now),
      reg: analyzeSleepRegularity(week, 'week'),
    };
  }, [hsVer]);

  const { week, cmp, reg } = data;
  const latest = cmp.latest;
  const hasLatest = !!latest && latest.bedClock != null && latest.wakeClock != null;
  const toneColor =
    cmp.tone === 'warn' ? mm.colors.honeyCore : cmp.tone === 'good' ? mm.colors.limeCore : mm.colors.inkSoft;

  const body = (
    <View style={styles.wrap}>
      <View style={styles.inner}>
        <View style={styles.headRow}>
          <View style={styles.titleRow}>
            <View style={styles.iconChip}>
              <MindIcon name="moon" size={theme.fs(17)} color={mm.colors.limeMid} />
            </View>
            <Text style={styles.title}>{title}</Text>
          </View>
          <Icon name="chevronRight" size={18} color={mm.colors.inkFaint} />
        </View>

        {/* 最近一晚：入睡 → 起床 */}
        <Text style={styles.clockLabel}>最近一晚</Text>
        <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
          {hasLatest ? `${latest!.bedClock} → ${latest!.wakeClock}` : '— → —'}
        </Text>
        {/* 相比前面基线的结论：早了 / 晚了 / 差不多 */}
        <Text style={[styles.headline, { color: toneColor }]} numberOfLines={2}>
          {cmp.headline}
        </Text>

        {/* 近 7 晚区间柱：下端入睡 / 上端起床，虚线为基线 */}
        <Text style={styles.chartLabel}>本周入睡 / 起床</Text>
        <SleepRegularityChart
          points={week}
          height={116}
          compact
          baselineBedH={cmp.baselineBedH}
        />
        <View style={styles.legendRow}>
          <Text style={styles.legendItem}>
            <Text style={[styles.legendDot, { color: mm.colors.limeCore }]}>●</Text> 入睡
          </Text>
          <Text style={styles.legendItem}>
            <Text style={[styles.legendDot, { color: mm.colors.ink }]}>●</Text> 起床
          </Text>
          {cmp.baselineBedH != null ? (
            <Text style={styles.legendItem}>
              <Text style={[styles.legendDot, { color: mm.colors.honeyCore }]}>┄</Text> 基线
            </Text>
          ) : null}
          <Text style={styles.legendStatus}>{reg.label}</Text>
        </View>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card,
    overflow: 'hidden',
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
    marginBottom: theme.space.md,
  },
  inner: { padding: theme.sp(2.5) },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: theme.fontSize.h1,
    height: theme.fontSize.h1,
    borderRadius: theme.radius.pill,
    backgroundColor: mm.chipBg.lime.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  clockLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft, marginTop: theme.sp(1) },
  clock: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginTop: theme.sp(0.5),
    letterSpacing: -0.3,
  },
  headline: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    marginTop: theme.sp(0.75),
    lineHeight: theme.fontSize.sm * 1.5,
  },
  chartLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft, marginTop: theme.sp(2) },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.sp(1.5),
    marginTop: theme.sp(1),
  },
  legendItem: { fontSize: theme.fontSize.tiny, color: mm.colors.inkSoft },
  legendDot: { fontSize: theme.fontSize.tiny },
  legendStatus: {
    fontSize: theme.fontSize.tiny,
    color: mm.colors.limeCore,
    fontWeight: theme.weight.semibold,
    marginLeft: 'auto',
  },
});
