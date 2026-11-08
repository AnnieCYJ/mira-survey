/**
 * FertileWindowCard —— 受孕窗叙事（P1-2，2026-10-28）
 *
 * ★ 与 Oura 受孕窗对标：展示「6 天受孕窗」（排卵前 5 天 + 排卵日）+ 最佳受孕日。
 * ★ 权威口径：
 *   · 受孕窗 = 排卵日前 5 天 ~ 排卵日（精子可存活约 5 天，卵子可存活约 24 小时，
 *     峰值受孕概率落在排卵前 2 天 ~ 排卵日，WHO / ACOG 通用结论）。
 *   · 数据来源复用 `computeCycle` 的 ovulationDate / fertilityStart / fertilityEnd（与日历网格同源）。
 * ★ 诚实：只给「相对概率档位」（高/中/低），不给伪造的精确百分比；标明朝向即回看/前瞻。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { parseDate, addDays, dayKey, daysBetween, type CycleLog, type CycleInfo } from '../lib/cycleMath';

function fmtDate(s: string): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function FertileWindowCard({ log, cycleInfo }: { log: CycleLog | null; cycleInfo: CycleInfo | null }) {
  if (!log || !log.lastPeriodStart || !cycleInfo?.ovulationDate) {
    return null;
  }
  // 全程用字符串 dayKey（'YYYY-M-D'），与 cycleMath 各函数签名一致
  const ov = cycleInfo.ovulationDate;
  const fertilityStart = cycleInfo.fertilityStart ?? addDays(ov, -5);
  const fertilityEnd = cycleInfo.fertilityEnd ?? ov;
  const peak = addDays(ov, -2); // 最佳受孕日

  // 今天相对排卵日的偏移（daysBetween(today, ov) = ov − today）
  const today = dayKey(Date.now());
  const daysToOv = daysBetween(today, ov);

  // 受孕窗内逐日「相对概率档位」
  const windowDays: { d: string; tier: 'peak' | 'high' | 'mid' | 'low' }[] = [];
  for (let i = 0; i <= daysBetween(fertilityStart, fertilityEnd); i++) {
    const d = addDays(fertilityStart, i);
    const off = daysBetween(d, ov); // 距排卵日（天）
    const tier = off === 0 ? 'peak' : off === -1 || off === -2 ? 'high' : off < 0 ? 'mid' : 'low';
    windowDays.push({ d, tier });
  }

  const tierLabel: Record<string, string> = { peak: '最佳', high: '高', mid: '中', low: '低' };
  // ★ 2026-11-08：深玻璃卡上 limeDeep 发糊；改为「最佳=最亮 limeCore / 高=次亮 limeMid /
  //   中=暗玻璃 / 低=灰」，四档由亮到暗，保持层级区分（原来最佳档反而是最暗的深橄榄绿）。
  const tierColor: Record<string, string> = {
    peak: mm.colors.limeCore, high: mm.colors.limeMid, mid: theme.colors.cardBgSoft, low: theme.colors.textSub,
  };

  return (
    <Card style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>受孕窗</Text>
        <Text style={styles.meta}>
          {daysToOv > 0 ? `已排卵 ${daysToOv} 天` : daysToOv === 0 ? '今日排卵' : `距排卵还有 ${-daysToOv} 天`}
        </Text>
      </View>
      <Text style={styles.range}>
        受孕窗 {fmtDate(fertilityStart)} – {fmtDate(fertilityEnd)}（排卵日 {fmtDate(ov)}）
      </Text>
      <Text style={styles.peak}>最佳受孕日：{fmtDate(peak)}（排卵前 2 天）</Text>

      <View style={styles.row}>
        {windowDays.map((w, i) => (
          <View key={i} style={[styles.cell, { borderColor: tierColor[w.tier] }]}>
            <Text style={[styles.cellDate, { color: tierColor[w.tier] }]}>{fmtDate(w.d)}</Text>
            <View style={[styles.cellDot, { backgroundColor: tierColor[w.tier] }]} />
            <Text style={[styles.cellTier, { color: tierColor[w.tier] }]}>{tierLabel[w.tier]}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.note}>
        受孕窗 = 排卵前 5 天至排卵日（精子可存活约 5 天、卵子约 24 小时，峰值落在排卵前 2 天~排卵日）。
        基于你的周期长度与黄体期推算，仅供备孕参考，不构成医学建议。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { padding: theme.space.cardPad, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  range: { fontSize: theme.fontSize.sm, color: mm.colors.ink, marginBottom: 4 },
  peak: { fontSize: theme.fontSize.sm, color: mm.colors.limeCore, fontWeight: theme.weight.semibold, marginBottom: theme.space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: theme.space.sm },
  cell: {
    width: 56, borderRadius: theme.radius.sm, borderWidth: 1.2, paddingVertical: 6,
    alignItems: 'center',
  },
  cellDate: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  cellDot: { width: 8, height: 8, borderRadius: 4, marginVertical: 3 },
  cellTier: { fontSize: theme.fontSize.micro },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: 17, opacity: 0.85 },
});
