/**
 * SleepRecoveryHero —— 日视图顶部「睡眠恢复分」主结论
 *
 * 对齐 preview/sleep-rhythm.html v9 原型（v9 已按用户要求**去掉分数上方的
 * 「睡眠恢复」标签**，只留大分数 + 右侧结论词 + 与个人基线的差值）。
 *
 * 位置：RangeSwitch **上方**，且**仅日视图**显示（与 App 内 EmotionCognitiveDetailScreen 同策略）。
 *
 * ★ 量纲说明（重要）：分数来自 lib/sleepScore 的 `computeSleepScore`，输出 0–100，
 *   是**恢复质量**口径（时长/深睡/效率/起夜四因子）。
 *   注意不要误用 `sleepDaily.score` —— 那是设备侧 0–4 原始分。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { computeSleepScore, type SleepScoreInput } from '../lib/sleepScore';
import { sleepRecoveryTag } from '../lib/sleepPersonalized';

export interface HeroDayRec extends SleepScoreInput {
  /** 该日归档的分钟数（用于算深睡占比） */
  totalMin: number;
  deepMin: number;
}

interface Props {
  /** 锚点日的睡眠评分输入（已由调用方组装好，缺数据时为 null） */
  input: HeroDayRec | null;
  /** 近 14 天（含锚点日）的分数均值，用于「高于/低于个人均值」 */
  baseline: number | null;
}

export default function SleepRecoveryHero({ input, baseline }: Props) {
  const score = useMemo(() => {
    if (!input) return null;
    const s = computeSleepScore({
      sleepTotal: input.sleepTotal,
      sleepDeep: input.sleepDeep,
      sleepAwake: input.sleepAwake,
      getUp: input.getUp,
    });
    return Number.isFinite(s) && s > 0 ? s : null;
  }, [input]);

  if (score == null) {
    return (
      <View style={styles.hero}>
        <Text style={styles.score}>—</Text>
        <View style={styles.rhs}>
          <Text style={styles.label}>暂无数据</Text>
          <Text style={styles.sub}>同步当晚睡眠后显示</Text>
        </View>
      </View>
    );
  }

  // 口径固定 absolute：单日分无法构成个人化基线，relative 需多日历史
  const tag = sleepRecoveryTag(score, 'absolute') ?? '—';
  const delta = baseline != null ? Math.round(score - baseline) : null;

  return (
    <View style={styles.hero}>
      <Text style={styles.score}>
        {Math.round(score)}
        <Text style={styles.scoreUnit}>/100</Text>
      </Text>
      <View style={styles.rhs}>
        <Text style={styles.label}>{tag}</Text>
        {delta != null ? (
          <Text style={[styles.sub, delta > 0 ? styles.up : delta < 0 ? styles.down : null]}>
            {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : '→ 与 14 天均值持平'}
            {delta !== 0 ? ' · 对比 14 天均值' : ''}
          </Text>
        ) : (
          <Text style={styles.sub}>对比 14 天均值</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
    paddingHorizontal: 2,
  },
  score: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    lineHeight: 48,
  },
  scoreUnit: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: mm.colors.inkSoft },
  rhs: { alignItems: 'flex-end', paddingBottom: 4 },
  label: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep },
  sub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  up: { color: theme.colors.trendUp },
  down: { color: theme.colors.trendDown },
});
