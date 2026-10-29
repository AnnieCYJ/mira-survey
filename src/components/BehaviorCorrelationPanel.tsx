/**
 * BehaviorCorrelationPanel —— 行为关联面板（P0-2，2026-10-28）
 *
 * ★ 复用 `lib/behaviorCorrelation.computeBehaviorCorrelations`：Pearson r + Cohen's d + r²，
 *   权威统计口径（Cohen 1988 / Fritz & Morris 2012）。
 * ★ 放置在各数据详情页底部（睡眠详情 → 睡眠恢复；情绪详情 → 情绪），
 *   与「数据详情里面」的规矩一致，不另起散乱卡片。
 * ★ 诚实闸门：样本不足（<14 天 / 某标签 <7 天）整体不展示，留空态 + 引导文案。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { computeBehaviorCorrelations, type OutcomeKey } from '../lib/behaviorCorrelation';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

const OUTCOME_TITLE: Record<OutcomeKey, string> = {
  sleep: '哪些行为影响你的睡眠',
  emotion: '哪些行为影响你的情绪',
  bodyLoad: '哪些行为影响你的身体负荷',
};

export default function BehaviorCorrelationPanel({ outcome }: { outcome: OutcomeKey }) {
  useHealthStoreVersion(); // 数据写入后刷新
  const { items, enough, totalDays } = computeBehaviorCorrelations(outcome, 90, 4);

  const title = OUTCOME_TITLE[outcome];

  return (
    <Card style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>行为关联</Text>
        <Text style={styles.meta}>{title}</Text>
      </View>

      {!enough ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            持续记录行为（开会 / 写代码 / 运动 / 烧脑 / 情绪…）与情绪后，这里会显示「哪类日子让{outcome}更好或更差」的关联分析。
          </Text>
          <Text style={styles.emptySub}>至少需要 {14} 天数据，且某类行为出现 ≥ {7} 天才计算，避免偶然关联。</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>近 {totalDays} 天暂未捕捉到明显的行为关联。</Text>
          <Text style={styles.emptySub}>继续记录，关联会随数据变多逐渐清晰。</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((it, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.tag}>{it.tag}</Text>
                <View style={[styles.effChip, effChipStyle(it.effect)]}>
                  <Text style={[styles.effChipText, effChipTextStyle(it.effect)]}>
                    {it.effect === 'large' ? '强关联' : it.effect === 'medium' ? '中等' : '弱关联'}
                  </Text>
                </View>
              </View>
              <Text style={styles.summary}>{it.summary}</Text>
              <View style={styles.statRow}>
                <Text style={styles.stat}>r = {it.r != null ? it.r.toFixed(2) : '—'}</Text>
                <Text style={styles.stat}>r² = {it.r2 != null ? it.r2.toFixed(2) : '—'}</Text>
                <Text style={styles.stat}>d = {it.d != null ? it.d.toFixed(2) : '—'}</Text>
                <Text style={styles.stat}>n = {it.nWith}/{it.nWithout}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.note}>
        采用 Pearson 相关（r）与 Cohen's d 效应量（权威统计口径）。关联仅说明「共同出现」，不代表因果；样本为个人历史，仅供你观察自己的节律。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { padding: theme.space.cardPad, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.space.sm },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  empty: { paddingVertical: theme.space.sm },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 19 },
  emptySub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.xs, lineHeight: 17 },
  list: { gap: theme.space.sm },
  row: {
    paddingVertical: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.cardBorder,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  tag: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  effChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: theme.radius.pill },
  effChipText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  summary: { fontSize: theme.fontSize.sm, color: mm.colors.ink, lineHeight: 18, marginBottom: 4 },
  statRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  stat: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, lineHeight: 17, opacity: 0.85 },
});

function effChipStyle(effect: 'small' | 'medium' | 'large' | 'negligible') {
  if (effect === 'large') return { backgroundColor: mm.colors.roseSoft };
  if (effect === 'medium') return { backgroundColor: mm.colors.limeSoft };
  return { backgroundColor: theme.colors.cardBgSoft };
}
function effChipTextStyle(effect: 'small' | 'medium' | 'large' | 'negligible') {
  if (effect === 'large') return { color: mm.colors.roseDeep };
  if (effect === 'medium') return { color: mm.colors.limeDeep };
  return { color: theme.colors.textSub };
}
