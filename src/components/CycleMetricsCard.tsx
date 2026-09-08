/**
 * CycleMetricsCard — 周期完整指标面板
 *
 * 展示 computeCycle 所有关键字段:
 *   - 今天周期第几天 / 总长度
 *   - 预计排卵日 + 距排卵天数
 *   - 易孕期窗口窗口
 *   - 预计下次经期预测 + 倒计时 (含预测范围)
 *   - 体温确认排卵状态 (symptothermal BBT)
 *   - 个性化周期均值 / 标准差 (Periodical)
 *   - 雌激素水平
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import type { CycleLog, CycleInfo } from '../lib/cycleMath';

function daysAgoOrAhead(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - now.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff > 1) return `${diff} 天后`;
  if (diff === -1) return '昨天';
  return `${-diff} 天前`;
}

export default function CycleMetricsCard({
  cycleInfo: info,
  cycleLog: log,
}: {
  cycleInfo: CycleInfo | null;
  cycleLog: CycleLog | null;
}) {
  if (!log || !log.lastPeriodStart || !info || !info.hasLog) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>📊 周期指标</Text>
        <View style={{ marginTop: 8 }}>
          <Text style={styles.emptyTitle}>还没记录经期 🩸</Text>
          <Text style={styles.emptyText}>"周期 tab 左上角点 +" → 输入上次经期第一天 + 平均周期天数 (默认 28 天)</Text>
          <Text style={styles.emptyText}>📱 或: 戒指 → 绑定 App → Settings → Female → 同步经期信息</Text>
        </View>
      </View>
    );
  }

  const cycleLen = log.cycleLength;

  const metric = (label: string, value: React.ReactNode, sub?: React.ReactNode, highlight?: boolean) => (
    <View style={styles.metricItem}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && { color: theme.colors.accentSolid }]}>{value}</Text>
      {sub ? <Text style={styles.metricSub} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );

  const rangeText = (() => {
    const r = info.nextPeriodRange;
    if (!r) return null;
    return `${r[0]} ~ ${r[1]}`;
  })();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>📊 周期关键数据</Text>

      <View style={styles.grid}>
        {/* Row 1 */}
        {metric('周期天数', info.dayInCycle != null ? `第 ${info.dayInCycle} / ${cycleLen}` : '—',
          info.phaseLabel, true)}

        {metric('当前阶段', info.phaseLabel, null, true)}

        {/* Row 2 */}
        {metric('预计排卵日', info.ovulationDate ?? '—',
          info.daysToOvulation != null
            ? info.daysToOvulation === 0 ? '今天'
            : info.daysToOvulation > 0 ? `${info.daysToOvulation} 天后`
            : `${-info.daysToOvulation} 天前`
            : null)}

        {metric('易孕期窗口',
          info.fertilityStart && info.fertilityEnd
            ? `${info.fertilityStart} ~ ${info.fertilityEnd}`
            : '—')}

        {/* Row 3 */}
        {metric('预计下次经期', info.nextPeriodDate ?? '—',
          info.daysToNextPeriod != null ? `${info.daysToNextPeriod} 天后` : null)}

        {metric('预测范围', rangeText ?? '—',
          info.cycleLengthMean != null
            ? `基于 ${info.cycleLengthMean.toFixed(0)} ± ${info.cycleLengthStd?.toFixed(0) ?? '?'} 天`
            : '需 ≥3 次记录')}

        {/* Row 4 */}
        {metric('体温确认排卵',
          info.tempConfirmed ? '✅ 双相跳升' : '日历估算',
          info.baselineTemp != null
            ? `低温相基线 ${info.baselineTemp.toFixed(2)}°C`
            : null)}

        {metric('平均周期天数',
          info.cycleLengthMean != null
            ? `${info.cycleLengthMean.toFixed(0)} ± ${info.cycleLengthStd?.toFixed(0) ?? '?'} 天`
            : `${cycleLen} 天 (默认)`,
          info.cycleLengthMean != null ? '你自己的均值' : '需要更多历史记录')}

        {/* Row 5 */}
        {metric('雌激素水平',
          info.estrogenIndex != null ? Math.round(info.estrogenIndex).toString() : '—',
          '根据周期推算')}
      </View>

      {/* 历史记录提示 */}
      {log.history && log.history.length > 0 && (
        <Text style={styles.histHint}>
          基于 {log.history.length} 次记录 · 可信度 {log.history.length >= 6 ? '高' : log.history.length >= 3 ? '中' : '低'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.space.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -theme.sp(1),
  },
  metricItem: {
    width: '50%',
    paddingHorizontal: theme.sp(1),
    marginBottom: theme.space.md,
  },
  metricLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textTransform: 'uppercase',
    letterSpacing: theme.sp(0.0625),
  },
  metricValue: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.5),
  },
  metricSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.micro * 1.4,
  },
  histHint: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginTop: theme.space.xs,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    textAlign: 'center',
    paddingVertical: theme.space.md,
  },
});
