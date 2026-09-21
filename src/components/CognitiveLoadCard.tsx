import React from 'react';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import { computeCognitiveLoadReport, type LoadLevel, type FatigueLevel, levelLabel } from '../lib/cognitiveLoad';

import { useHealthStoreVersion } from '../hooks/useHealthStore';

export function fmtRange(span: { startHour: number; endHour: number }): string {
  const s = String(span.startHour).padStart(2, '0');
  const e = String(span.endHour + 1).padStart(2, '0');
  return s + ':00 – ' + e + ':00';
}

export function loadColor(l: LoadLevel): string {
  return l === 'heavy' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : theme.colors.stateCalm;
}
export function fatigueColor(l: FatigueLevel): string {
  return l === 'severe' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : l === 'mild' ? theme.colors.moodEnergy
    : theme.colors.stateCalm;
}
export function loadLabel(l: LoadLevel): string {
  return l === 'heavy' ? '高强度投入'
    : l === 'moderate' ? '中等投入'
    : l === 'light' ? '轻度投入'
    : '基本放松';
}
function fatigueLabel(l: FatigueLevel): string {
  return l === 'severe' ? '严重疲劳'
    : l === 'moderate' ? '中度疲劳'
    : l === 'mild' ? '轻度疲劳'
    : '精力充沛';
}

export default function CognitiveLoadCard() {
  useHealthStoreVersion(); // 触发 re-render
  const report = computeCognitiveLoadReport();
  // ★ debug: 每次 render 打印 sleepWindow
  try {
    const postLog = (globalThis as any).__postLog;
    if (postLog) postLog('COG-CARD', `sleepWindow=${JSON.stringify(report?.sleepWindow)} sampleCount=${report?.sampleCount}`);
    else {
      const fetch = (globalThis as any).fetch;
      if (fetch) fetch('http://localhost:8899/log', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({tag:'COG-CARD', msg:`sleepWindow=${JSON.stringify(report?.sleepWindow)} sampleCount=${report?.sampleCount}`}) }).catch(()=>{});
    }
  } catch(e) { console.log('COG-ERR', e); }
  const hasData = report.sampleCount >= 2;

  if (!hasData) {
    return (
      <Card>
          <Text style={styles.title}>认知负荷 & 疲劳</Text>
          <Text style={styles.emptyText}>暂无足够的生理数据，连上戒指跑 2-3 轮自动监测后自动生成报告</Text>
      </Card>
    );
  }

  const lCol = loadColor(report.loadLevel);
  const fCol = fatigueColor(report.fatigueLevel);

  return (
    <Card>
        {/* ── 头部 ── */}
        <Text style={styles.title}>认知负荷 & 疲劳</Text>

        {/* ── 全天认知负荷分布图（移到上面） ── */}
        <View style={styles.hourSection}>
          <HourHistogram hourly={report.hourly} peakSpan={report.peakLoadSpan} bestSpan={report.bestSpan} sleepWindow={report.sleepWindow} />
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateCalm }]} />
              <Text style={styles.legendText}>放松</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateTense }]} />
              <Text style={styles.legendText}>中度</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.danger }]} />
              <Text style={styles.legendText}>高强度</Text>
            </View>
          </View>
        </View>

        {/* ── 三个核心指标 ── */}
        <View style={[styles.summaryGrid, { marginTop: theme.sp(2) }]}>
          <SumCell label="认知负荷" value={String(report.loadScore)} valueColor={lCol} />
          <SumCell label="疲劳指数" value={String(report.fatigueIndex)} valueColor={fCol} />
          <SumCell
            label="恢复能力"
            value={report.recoveryCapacity != null ? `${Math.round(report.recoveryCapacity * 100)}%` : '—'}
          />
        </View>
    </Card>
  );
}

/** SumCell —— 与详情页 EmotionCognitiveDetailScreen.SumCell 100% 对齐 */
function SumCell({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      {value ? <Text style={[styles.sumValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

export function HourHistogram({ hourly, peakSpan, bestSpan, sleepWindow, chartH }: {
  hourly: { hour: number; score: number }[];
  peakSpan: { startHour: number; endHour: number; avgScore: number } | null;
  bestSpan: { startHour: number; endHour: number; avgScore: number } | null;
  sleepWindow: { bedHour: number; wakeHour: number } | null;
  chartH?: number;
}) {
  // ★ 和情绪洞察统一：固定 24 列全天 0-23，标签显示 1-24
  // 不再按睡眠窗口裁剪——睡眠时段的柱状图自然会是 0 高度（因为没数据）
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const hourMap = new Map(hourly.map(h => [h.hour, h]));
  const visible = HOURS.map(h => hourMap.get(h) ?? { hour: h, score: 0 });
  const totalBins = 24;

  // hour -> index 映射（固定 0-23 全有）
  const hourToIdx = new Map(HOURS.map((h, i) => [h, i]));

  // ── 用数据里的最大值做归一化, 确保柱子都能撑开 ──
  const dataMax = Math.max(10, ...visible.map(h => h.score));

  // histogramWrap 内部可用宽度 = 屏幕宽 - sp(1)*2 padding
  // 减去 Card(cardPad≈20)*2 + hourSection padding(sp(2))*2
  const wrapWidth = Dimensions.get('window').width - theme.space.cardPad * 2 - theme.sp(2) * 2;
  function spanPos(start: number, end: number) {
    const s = hourToIdx.get(start) ?? 0;
    const e = hourToIdx.get(end) ?? totalBins - 1;
    const binW = wrapWidth / totalBins;
    return {
      left: s * binW,
      width: (e - s + 1) * binW,
    };
  }

  const wrapH = chartH && chartH > 80 ? chartH - 60 : theme.sp(10);
  const barsH = Math.max(theme.sp(6), wrapH - theme.sp(3));

  return (
    <View style={[styles.histogramWrap, { height: wrapH + theme.sp(4) }]}>
      <View style={[styles.histogram, { height: barsH }]}>
        {visible.map((h) => {
          const hVal = Math.max(0, Math.min(dataMax, h.score));
          const maxBarH = Math.max(theme.sp(7), barsH - theme.sp(1));
          const barH = hVal === 0 ? theme.sp(0.5) : Math.max(theme.sp(1.5), (hVal / dataMax) * maxBarH);
          const barColor = hVal === 0 ? theme.colors.ui.borderSoft
            : hVal >= dataMax * 0.65 ? theme.colors.danger
            : hVal >= dataMax * 0.40 ? theme.colors.stateTense
            : theme.colors.stateCalm;
          return (
            <View key={h.hour} style={styles.histBin}>
              <View style={[styles.histBar, { height: barH, backgroundColor: barColor }]} />
            </View>
          );
        })}
      </View>
      {/* ★ X 轴标签：和格子等宽对齐（flex:1），首尾 absolute 贴根容器边缘 */}
      <View style={styles.histAxis}>
        {visible.map((h, i) => {
          const n = visible.length;
          const isFirst = i === 0;
          const isLast  = i === n - 1;
          const displayH = h.hour + 1;
          const showMiddle = !isFirst && !isLast && (h.hour === 6 || h.hour === 12 || h.hour === 18);
          const baseLabel = {
            fontSize: theme.fontSize.micro,
            color: theme.colors.textSub,
            lineHeight: theme.fontSize.micro + 2,
          };
          // 首尾也返回空 flex spacer，保证 n 列和柱子对齐
          const spacer = <Text key={h.hour} style={{ flex: 1, lineHeight: theme.sp(3) }} />;
          if (isFirst) {
            return (
              <React.Fragment key={h.hour}>
                {spacer}
                <Text style={{
                  position: 'absolute', left: 0, top: 0,
                  ...baseLabel, fontWeight: theme.weight.medium,
                }}>{displayH}</Text>
              </React.Fragment>
            );
          }
          if (isLast) {
            return (
              <React.Fragment key={h.hour}>
                {spacer}
                <Text style={{
                  position: 'absolute', right: 0, top: 0,
                  ...baseLabel, fontWeight: theme.weight.medium,
                }}>{displayH}</Text>
              </React.Fragment>
            );
          }
          if (!showMiddle) return spacer;
          return (
            <Text key={h.hour} numberOfLines={1} style={{
              minWidth: theme.sp(4), ...baseLabel, textAlign: 'center', fontWeight: theme.weight.medium,
            }}>{displayH}</Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── 复用 StressInsightCard token ──
  pad: { padding: theme.space.cardPad },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.sp(1.5) },
  metricItem: { width: '50%', paddingHorizontal: theme.sp(1.5), marginBottom: theme.sp(2.5) },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textBody, marginTop: theme.sp(0.5) },
  metricSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  sectionTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textBody, marginBottom: theme.sp(1.5) },
  hourSection: {
    backgroundColor: theme.colors.cardBgSoft,
    marginTop: theme.sp(2), paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(2),
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.cardBorder2,
    overflow: 'visible',
  },
  emptyText: { fontSize: theme.fontSize.body, color: theme.colors.textSub, lineHeight: theme.fontSize.body + theme.sp(1.5), marginTop: theme.sp(1.5) },

  // ── 认知负荷专属 ──
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2), marginBottom: theme.sp(3) },
  scoreBlock: { flex: 1, alignItems: 'center' },
  scoreLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625), marginBottom: theme.sp(0.5) },
  score: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, letterSpacing: -1 },
  scoreDivider: { width: 1, height: theme.sp(10), backgroundColor: theme.colors.ui.borderSoft },

  histogramWrap: { height: theme.sp(10), marginTop: theme.sp(1), position: 'relative', width: '100%', overflow: 'visible' },
  spanHighlight: {
    position: 'absolute',
    top: 0, bottom: theme.sp(1.5),
    borderTopWidth: 2, borderBottomWidth: 2,
    opacity: 0.5,
  },
  histogram: { flexDirection: 'row', alignItems: 'flex-end', height: theme.sp(6), gap: 1 },
  histBin: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  histBar: { width: theme.sp(1.5), borderRadius: theme.sp(0.5) },
  histAxis: { flexDirection: 'row', marginTop: theme.sp(0.5), paddingHorizontal: 0 },
  histAxisLabel: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', lineHeight: theme.sp(3) },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1), paddingHorizontal: theme.sp(0.5) },
  hourAxisLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  legendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.sp(1.5) },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.sp(1.5) },
  legendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), marginRight: theme.sp(0.75) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  peakRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2) },
  peakChip: { flex: 1, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(2), marginHorizontal: theme.sp(0.75) },
  peakLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  peakTime: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, marginTop: theme.sp(0.5) },
  peakSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  reasonText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(2) },

  // SumCell 风格摘要（与详情页对齐）
  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
});
