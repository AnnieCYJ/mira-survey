/**
 * SleepRecoveryHero —— 日视图顶部「睡眠恢复分」主结论
 *
 * ★ 2026-10-07（用户定口径：全 App 统一「个人相对分」）：
 *   分数由 `computeSleepPersonalized` 产出（50 = 和平时一样），与首页圆环 chip /
 *   睡眠节律卡 badge / SleepCard **同源**。此前这里用绝对分 `computeSleepScore`（100=达标），
 *   于是同一标签「睡眠恢复」在首页显示 65、在详情页显示 97，用户不知道信哪个 —— 现统一。
 *   ⚠ 相对口径下**不挂 /100**：50 才是「和平时一样」，挂百分制必然被读成「刚及格」。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { computeSleepPersonalized, sleepRecoveryTag } from '../lib/sleepPersonalized';
// ★ 用与首页同源的「健康库刷新节拍」当依赖，睡眠记录到达后 hero 才会跟着刷新
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';

interface Props {
  /** 锚点日的毫秒时间戳：算「那一天的睡眠恢复分」（今天=此刻） */
  anchorMs: number;
}

export default function SleepRecoveryHero({ anchorMs }: Props) {
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const pers = useMemo(() => {
    try { return computeSleepPersonalized(anchorMs); } catch { return null; }
  }, [anchorMs, hsRefresh]);

  const score = pers?.score ?? null;
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

  const relative = pers!.mode === 'relative';
  const tag = sleepRecoveryTag(score, pers!.mode) ?? '—';
  const sub = relative
    ? '对照你的个人基线 · 50 = 和平时一样'
    : pers!.daysToReady > 0
      ? `还需 ${pers!.daysToReady} 晚建立个人基线`
      : '仍在用固定目标';

  return (
    <View style={styles.hero}>
      <Text style={styles.score}>
        {Math.round(score)}
        {relative ? null : <Text style={styles.scoreUnit}>/100</Text>}
      </Text>
      <View style={styles.rhs}>
        <Text style={styles.label}>{tag}</Text>
        <Text style={styles.sub}>{sub}</Text>
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
});
