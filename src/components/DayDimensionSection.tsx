/**
 * DayDimensionSection —— 回顾·日「这一天，按维度看」分组卡区（2026-11-11）
 *
 * 用户原话：「回顾日里面其实可以分几个维度，比方说生理周期阶段、早上睡眠、
 *   当天运动、整体状态/平均状态，还有血压各方面……有打分的，可以在日的
 *   每一个小卡里面加一个进度条，没有分数就不用说了，完成任务型可能没有。」
 *
 * 设计：
 *   · **独立渲染在曲线时间线之上**，不塞进 items.map、不占用「最多 7 条」上限；
 *   · 每个维度一张小卡；**只有带 score 的卡才画进度条**（复用 TodayTimelineCard.ScoreBar）；
 *   · 达标卡右上角沿用 SunMark（与月历格子、水晶球同一枚太阳）；
 *   · 每张卡底部一句 meaning = 「这对身体意味着什么」，平实、软化、不诊断；
 *   · 空数据整组不出，绝不用「—」硬凑。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import GlassCard from './GlassCard';
import SunMark from './SunMark';
import { ScoreBar } from './TodayTimelineCard';
import type { DimensionGroup, DimensionCard } from '../lib/reviewDimensions';

/** 每个维度一个稳定的浅底色（取自 mindmate 现有 token，不新增色相） */
const DIM_SOFT: Record<string, string> = {
  cycle: mm.colors.purpleSoft,
  sleep: mm.colors.honeySoft,
  activity: mm.colors.limeSoft,
  state: mm.colors.skySoft,
  mood: mm.colors.roseSoft,
  stress: mm.colors.skySoft,
  vitals: mm.colors.limeSoft,
  task: mm.colors.honeySoft,
};
const DIM_DEEP: Record<string, string> = {
  cycle: mm.colors.purpleCore,
  sleep: mm.colors.honeyDeep,
  activity: mm.colors.limeDeep,
  state: mm.colors.skyDeep,
  mood: mm.colors.roseCore,
  stress: mm.colors.skyDeep,
  vitals: mm.colors.limeDeep,
  task: mm.colors.honeyDeep,
};

function DimCardView({ card }: { card: DimensionCard }) {
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

export default function DayDimensionSection({ groups }: { groups: DimensionGroup[] }) {
  if (!groups.length) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>这一天，按维度看</Text>
        <Text style={styles.sectionHint}>有分数的，标了进度</Text>
      </View>
      {groups.map((g) => (
        <GlassCard key={g.id} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          {g.cards.map((c) => <DimCardView key={c.id} card={c} />)}
        </GlassCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.sp(3), gap: theme.sp(2.5) },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: {
    fontSize: theme.fs(17), fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, letterSpacing: -0.3,
  },
  sectionHint: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },
  group: { paddingVertical: theme.sp(3) },
  groupTitle: {
    fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never,
    color: theme.colors.accentText, marginBottom: theme.sp(2.5),
  },
  card: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(2), position: 'relative',
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
