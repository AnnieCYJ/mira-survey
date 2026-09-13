/**
 * 压力洞察卡片 — InsightScreen mind tab 专用
 * 算法: src/lib/stressAlgorithm.ts (KalmanJS 滤波 + 全天 z-score 基线 + HRV 融合)
 * 开源参考: KalmanJS (MIT), hrv-stress-wearable (MIT), Kalman-Normalized GSR 2025
 * 设计令牌: 100% theme.ts (Mira Design System v1.0) — 禁止裸值
 */
import React from 'react';

import { View, Text, StyleSheet } from 'react-native';

import { theme } from '../theme/theme';
import Card from './Card';

import {
  computeStressReport, levelText, formatPeakHour,
  type StressLevel, type StressEvent, type HourBucket, type ValenceLabel,
} from '../lib/stressAlgorithm';

function valenceColor(label: ValenceLabel | null): string {
  switch (label) {
    case 'positive': return theme.colors.stateCalm;
    case 'negative': return theme.colors.danger;
    case 'neutral': return theme.colors.textSub;
    default: return theme.colors.textSub;
  }
}
function valenceText(label: ValenceLabel | null): string {
  switch (label) {
    case 'positive': return '偏积极';
    case 'negative': return '偏消极';
    case 'neutral': return '情绪平稳';
    default: return '—';
  }
}
function loadSubtext(load: number | null): string {
  if (load == null) return '';
  if (load < 30) return '轻松';
  if (load < 55) return '适中';
  if (load < 75) return '偏重';
  return '过载';
}

export function levelColor(level: StressLevel | null): string {
  switch (level) {
    case 'calm': return theme.colors.stateCalm;
    case 'mild': return theme.colors.moodEnergy;
    case 'moderate': return theme.colors.stateTense;
    case 'high': return theme.colors.danger;
    default: return theme.colors.textSub;
  }
}

export default function StressInsightCard() {
  const report = computeStressReport();
  const hasData = report.sampleCount >= 5;

  if (!hasData) {
    return (
      <Card>
        <Text style={styles.emptyTitle}>压力洞察</Text>
        <Text style={styles.emptyText}>
          还没有足够的 EDA 数据。连上戒指后开启自动监测，约 30 分钟后开始生成个人基线。
        </Text>
      </Card>
    );
  }

  const color = levelColor(report.level);

  return (
    <Card>
      <View style={styles.pad}>
        {/* Header */}
        <View style={styles.headRow}>
          <Text style={styles.title}>压力洞察</Text>
          {report.level && (
            <View style={[styles.levelChip, { backgroundColor: color + '22' }]}>
              <View style={[styles.levelDot, { backgroundColor: color }]} />
              <Text style={[styles.levelText, { color }]}>{levelText(report.level)}</Text>
            </View>
          )}
        </View>

        {/* Big score */}
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color }]}>{report.emotionalLoad ?? '—'}</Text>
          <Text style={styles.scoreUnit}>/ 100</Text>
          {report.events.length > 0 && (
            <View style={styles.eventCountBadge}>
              <Text style={styles.eventCountText}>今日 {report.events.length} 次压力事件</Text>
            </View>
          )}
        </View>

        {/* SumCell 风格 2×2 摘要网格 —— 与详情页对齐 */}
        <View style={styles.summaryGrid}>
          <SumCell
            label="情绪消耗"
            value={report.emotionalLoad != null ? `${report.emotionalLoad}` : '—'}
            sub={report.emotionalLoad != null ? loadSubtext(report.emotionalLoad) : ''}
          />
          <SumCell
            label="今日情绪"
            value={report.valenceLabel != null ? valenceText(report.valenceLabel) : '—'}
            sub={report.valenceReason ?? ''}
          />
        </View>
        <View style={[styles.summaryGrid, { marginTop: theme.sp(1) }]}>
          <SumCell
            label="恢复时间"
            value={report.avgRecoverySec != null ? `${report.avgRecoverySec}s` : '—'}
            sub={report.recoveryProlonged != null
              ? report.recoveryProlonged > 20 ? `恢复慢 ${report.recoveryProlonged}%`
                : report.recoveryProlonged < -15 ? `恢复快 ${Math.abs(report.recoveryProlonged)}%`
                : '正常'
              : ''}
          />
          <SumCell label="峰值时段" value={formatPeakHour(report.peakHour)} sub={report.peakHour != null ? '事件最多' : ''} />
        </View>
      </View>

      {/* 每小时事件直方图 */}
      {report.hourBuckets.some((b) => b.count > 0) && (
        <View style={styles.pad}>
          <View style={styles.hourSection}>
            <Text style={styles.sectionTitle}>全天压力事件分布</Text>
            <HourHistogram buckets={report.hourBuckets} />
          </View>
        </View>
      )}

      {/* 全天事件时间戳列表 */}
      {report.events.length > 0 && (
        <View style={styles.pad}>
          <Text style={styles.sectionTitle}>全天事件时间戳 ({report.events.length})</Text>
          <EventTimeline events={report.events} />
        </View>
      )}


    </Card>
  );
}

export function Metric({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <View style={styles.metricItem}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
    </View>
  );
}

/** SumCell —— 与详情页 EmotionCognitiveDetailScreen.SumCell 100% 对齐 */
export function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      {value ? <Text style={styles.sumValue}>{value}</Text> : null}
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

/** 每小时事件直方图 (24 根竖条) */
export function HourHistogram({ buckets, chartH }: { buckets: HourBucket[]; chartH?: number }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const BAR_AREA_H = chartH && chartH > 80 ? chartH - 40 : theme.sp(16);   // 竖条绘制区高度
  const BAR_MAX_H = BAR_AREA_H - 12;    // 最大条高
  const BAR_GAP = theme.sp(0.25);    // 条间距

  return (
    <View style={{ paddingTop: theme.sp(1.5) }}>
      {/* 24 根竖条 — 水平时间轴 00→23 */}
      <View style={{ height: BAR_AREA_H, flexDirection: 'row', alignItems: 'flex-end' }}>
        {buckets.map((b) => {
          const hasData = b.count > 0;
          const ratio = hasData ? Math.max(0.1, b.count / maxCount) : 0;
          const h = hasData ? Math.max(theme.sp(1), ratio * BAR_MAX_H) : 1;
          const intensity = b.maxSeverity;
          const barColor =
            intensity >= 70 ? theme.colors.danger :
            intensity >= 40 ? theme.colors.stateTense :
            intensity > 0 ? theme.colors.moodEnergy :
            theme.colors.ui.white25;
          return (
            <View key={b.hour} style={{
              flex: 1, marginHorizontal: BAR_GAP, height: h,
              backgroundColor: barColor,
              opacity: hasData ? 0.9 : 0.06,
              borderRadius: theme.sp(0.5),
            }} />
          );
        })}
      </View>

      {/* 时间轴刻度 00 / 06 / 12 / 18 / 23 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(0.5) }}>
        {[0, 6, 12, 18, 23].map((h) => (
          <Text key={h} style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
            {String(h).padStart(2, '0')}
          </Text>
        ))}
      </View>

      {/* 图例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.sp(1.5) }}>
        <Legend color={theme.colors.danger} label="高压 ≥70%" />
        <Legend color={theme.colors.stateTense} label="中压 ≥40%" />
        <Legend color={theme.colors.moodEnergy} label="低压" />
      </View>


    </View>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), backgroundColor: color, marginRight: theme.sp(0.75) }} />
      <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{label}</Text>
    </View>
  );
}

/** 全天事件时间戳列表 */
export function EventTimeline({ events }: { events: StressEvent[] }) {
  const groups = new Map<number, StressEvent[]>();
  for (const e of events) {
    if (!groups.has(e.hour)) groups.set(e.hour, []);
    groups.get(e.hour)!.push(e);
  }
  const sortedHours = Array.from(groups.keys()).sort((a, b) => a - b);

  return (
    <View>
      {sortedHours.map((h) => (
        <View key={h} style={styles.timelineGroup}>
          <Text style={styles.timelineHour}>{String(h).padStart(2, '0')}:00</Text>
          <View style={styles.timelineEvents}>
            {groups.get(h)!.map((e, i) => {
              const severityColor = levelColor(e.level);
              const valenceDotColor =
                e.valenceLabel === 'positive' ? theme.colors.stateCalm :
                e.valenceLabel === 'negative' ? theme.colors.danger :
                theme.colors.textSub;
              const valenceTag =
                e.valenceLabel === 'positive' ? '+积极' :
                e.valenceLabel === 'negative' ? '-消极' : '';
              const rtText = e.recoverySec != null ? `RT ${e.recoverySec}s` : '';
              return (
                <View key={i} style={styles.timelineEvent}>
                  {/* 外圈 severity + 内圈 valence 双层 dot */}
                  <View style={[styles.timelineDot, { backgroundColor: severityColor }]}>
                    <View style={[styles.timelineDotInner, { backgroundColor: valenceDotColor }]} />
                  </View>
                  <Text style={styles.timelineTime}>
                    {String(e.hour).padStart(2, '0')}:{String(e.minute).padStart(2, '0')}
                  </Text>
                  <Text style={styles.timelineZ}>
                    {valenceTag || ' '}
                  </Text>
                  <Text style={[styles.timelineSev, { color: severityColor }]}>
                    强度 {e.severity}{rtText ? ` · ${rtText.replace('RT ', '恢复 ')}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: theme.space.cardPad },

  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },

  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(1.5), marginBottom: theme.sp(3)},
  score: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, letterSpacing: -1 },
  scoreUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: theme.sp(1) },
  eventCountBadge: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), marginLeft: theme.sp(2.5),
  },
  eventCountText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.medium },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.sp(1.5) },
  metricItem: { width: '50%', paddingHorizontal: theme.sp(1.5), marginBottom: theme.sp(2.5) },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textBody, marginTop: theme.sp(0.5) },
  metricSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  sectionTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textBody, marginBottom: theme.sp(1.5) },

  hourSection: {
    backgroundColor: theme.colors.cardBgSoft,
    marginTop: theme.sp(2), paddingVertical: theme.sp(2.5),
    borderTopWidth: 1, borderTopColor: theme.colors.cardBorder2,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder2,
  },

  timelineGroup: { marginBottom: theme.sp(1.5) },
  timelineHour: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5), marginTop: theme.sp(1) },
  timelineEvents: { paddingLeft: theme.sp(2) },
  timelineEvent: { flexDirection: 'row', alignItems: 'center', height: theme.sp(6) },
  timelineDot: { width: theme.sp(3), height: theme.sp(3), borderRadius: theme.sp(1.5), marginRight: theme.sp(1.5), justifyContent: 'center', alignItems: 'center' },
  timelineDotInner: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75) },
  timelineTime: { fontSize: theme.fontSize.body, color: theme.colors.textBody, width: theme.sp(15), fontWeight: theme.weight.medium },
  timelineZ: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, width: theme.sp(12) },
  timelineSev: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, flex: 1, textAlign: 'right' },

  // SumCell 风格摘要（与详情页对齐）
  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  emptyTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  emptyText: { fontSize: theme.fontSize.body, color: theme.colors.textSub, lineHeight: theme.fontSize.body + theme.sp(1.5) },
});
