/**
 * DayDimensionSection → 2026-11-11 修订（用户：按维度看不要单独成模块，挂到回顾日曲线旅程上）
 *
 * 原始设计是把「这一天，按维度看」渲染成一个带标题、带分组 GlassCard 的**大区块**，
 * 独立于下方曲线旅程之上。用户明确不要这种「新增一个大模块」的呈现：
 *   维度小卡应当和下面的曲线旅程卡片**融在一起**，成为旅程的一个节点。
 *
 * 因此本文件不再导出整块 Section，只导出：
 *   · `DayDimensionCard` —— 单张维度卡（无标题、无分组容器），供 JourneyDayView
 *     当作曲线旅程里的一个节点渲染，与其余旅程卡共用同一条曲线；
 *   · `DIM_SOFT` / `DIM_DEEP` —— 维度配色映射（浅底 / 深字），与 mindmate token 同源。
 *
 * 设计要点（沿用旧口径，品牌铁律不变）：
 *   · 只有带 score 的卡才画进度条（复用 TodayTimelineCard.ScoreBar）；
 *   · 达标卡右上角沿用 SunMark（与月历格子、水晶球同一枚太阳）；
 *   · 每张卡底部一句 meaning = 「这对身体意味着什么」，平实、软化、不诊断；
 *   · 空数据整卡不出（在规则层 composeDimensionGroups 已保证）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import SunMark from './SunMark';
import { ScoreBar } from './TodayTimelineCard';
import type { DimensionCard } from '../lib/reviewDimensions';

/** 每个维度一个稳定的浅底色（取自 mindmate 现有 token，不新增色相） */
export const DIM_SOFT: Record<string, string> = {
  cycle: mm.colors.purpleSoft,
  sleep: mm.colors.honeySoft,
  activity: mm.colors.limeSoft,
  state: mm.colors.skySoft,
  mood: mm.colors.roseSoft,
  stress: mm.colors.skySoft,
  vitals: mm.colors.limeSoft,
  task: mm.colors.honeySoft,
};
export const DIM_DEEP: Record<string, string> = {
  cycle: mm.colors.purpleCore,
  sleep: mm.colors.honeyDeep,
  activity: mm.colors.limeDeep,
  state: mm.colors.skyDeep,
  mood: mm.colors.roseCore,
  stress: mm.colors.skyDeep,
  vitals: mm.colors.limeDeep,
  task: mm.colors.honeyDeep,
};

/** 单张维度卡：由 JourneyDayView 包在曲线节点（左/右交替）里渲染，自身不带标题与分组框 */
export function DayDimensionCard({ card }: { card: DimensionCard }) {
  const soft = DIM_SOFT[card.dimension] ?? mm.colors.purpleSoft;
  const deep = DIM_DEEP[card.dimension] ?? mm.colors.purpleCore;
  const hasScore = typeof card.score === 'number' && Number.isFinite(card.score);
  return (
    <View style={styles.card}>
      {card.goalMet ? (
        <View style={styles.sun}>
          <SunMark size={Math.round(theme.fontSize.lg * 1.15)} />
        </View>
      ) : null}
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: soft }]}>
          <Text style={styles.iconTxt}>{card.emoji}</Text>
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{card.title}</Text>
          {card.value ? <Text style={[styles.value, { color: deep }]}>{card.value}</Text> : null}
        </View>
      </View>
      {card.sub ? <Text style={styles.sub}>{card.sub}</Text> : null}
      {/* ★ 有分数才画进度条；完成任务型 / 纯数值型不画 */}
      {hasScore ? (
        <ScoreBar
          score={card.score!}
          max={card.scoreMax ?? 100}
          color={deep}
          label={card.scoreLabel}
        />
      ) : null}
      {card.meaning ? <Text style={styles.meaning}>{card.meaning}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPadCompact,
    position: 'relative',
  },
  sun: { position: 'absolute', top: theme.sp(1.25), right: theme.sp(1.5), zIndex: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5), paddingRight: theme.sp(7) },
  icon: {
    width: theme.sp(8), height: theme.sp(8), borderRadius: mm.radius.iconSq,
    alignItems: 'center', justifyContent: 'center',
  },
  iconTxt: { fontSize: theme.fontSize.body },
  headText: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(2) },
  title: {
    fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, flexShrink: 0,
  },
  value: { fontSize: theme.fontSize.body, fontWeight: theme.weight.bold as never, flex: 1 },
  sub: {
    fontSize: theme.fontSize.micro, color: mm.colors.inkFaint,
    lineHeight: theme.fontSize.micro * 1.45, marginTop: theme.sp(1.5),
  },
  meaning: {
    fontSize: theme.fontSize.xs, color: mm.colors.inkSoft,
    lineHeight: theme.fontSize.xs * 1.5, marginTop: theme.sp(1.5),
  },
});
