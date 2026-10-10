/**
 * SleepRecoveryHero —— 「睡眠恢复分」卡片（日 / 周 / 月 / 年 统一）
 *
 * ★ 2026-10-09（用户定稿）：统一做成一张**置于时间选择器下方**的卡片，四视图一致；
 *   - 日视图：传 `anchorMs`，由 `computeSleepPersonalized` 算「当日」恢复分（50 = 和平时一样）；
 *   - 周/月/年：传 `value`（区间平均恢复分），标签为「平均恢复分（近 N 天/月）」。
 *   大数字字号 = theme.fontSize.hero（46），与预览稿日面板 .big 同款。
 *   右下角状态语：日视图按相对 50 基线自动判读；周月年不传 ctx（仅展示均值）。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { computeSleepPersonalized } from '../lib/sleepPersonalized';
// ★ 用与首页同源的「健康库刷新节拍」当依赖，睡眠记录到达后 hero 才会跟着刷新
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';

interface Props {
  /** 日视图：用锚点日毫秒算当日睡眠恢复分 */
  anchorMs?: number;
  /** 周/月/年：直接传入区间平均恢复分（覆盖 anchorMs 计算） */
  value?: number | null;
  /** 卡片主标签（日=睡眠恢复分（个人相对·50=平时）/ 周月年=平均恢复分（本区间）） */
  label: string;
  /** 右下角状态语；不传且走 anchorMs 时按相对 50 基线自动判读 */
  ctx?: string | null;
}

export default function SleepRecoveryHero({ anchorMs, value, label, ctx }: Props) {
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const pers = useMemo(() => {
    if (value != null || anchorMs == null) return null;
    try { return computeSleepPersonalized(anchorMs); } catch { return null; }
  }, [value, anchorMs, hsRefresh]);

  const score = value != null ? value : (pers?.score ?? null);
  const resolvedCtx = ctx != null ? ctx
    : pers ? (pers.mode === 'relative'
        ? (score != null ? (score >= 56 ? '比平时好 ↑' : score <= 44 ? '比平时吃力 ↓' : '和平时差不多 —') : null)
        : (pers.daysToReady > 0 ? `还需 ${pers.daysToReady} 晚建立基线` : '按固定目标评估'))
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.hero}>
        <View style={styles.lhs}>
          <Text style={styles.score}>{score != null ? String(Math.round(score)) : '—'}</Text>
          <Text style={styles.lab}>{label}</Text>
        </View>
        <Text style={[styles.ctx, resolvedCtx == null && { color: theme.colors.textSub }]}>
          {resolvedCtx ?? '暂无数据'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  lhs: { flexDirection: 'column' },
  score: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    lineHeight: 48,
  },
  lab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 4 },
  ctx: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep, paddingBottom: 4 },
});
