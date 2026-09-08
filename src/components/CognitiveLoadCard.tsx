import React from 'react';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import { computeCognitiveLoadReport, type LoadLevel, type FatigueLevel, levelLabel } from '../lib/cognitiveLoad';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

function fmtRange(span: { startHour: number; endHour: number }): string {
  const s = String(span.startHour).padStart(2, '0');
  const e = String(span.endHour + 1).padStart(2, '0');
  return s + ':00 – ' + e + ':00';
}

function loadColor(l: LoadLevel): string {
  return l === 'heavy' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : theme.colors.stateCalm;
}
function fatigueColor(l: FatigueLevel): string {
  return l === 'severe' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : l === 'mild' ? theme.colors.moodEnergy
    : theme.colors.stateCalm;
}
function loadLabel(l: LoadLevel): string {
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
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.title}>认知负荷 & 疲劳</Text>
          <Text style={styles.emptyText}>暂无足够的生理数据，连上戒指跑 2-3 轮自动监测后自动生成报告</Text>
        </View>
      </Card>
    );
  }

  const lCol = loadColor(report.loadLevel);
  const fCol = fatigueColor(report.fatigueLevel);

  return (
    <Card padded={false}>
      <View style={styles.pad}>
        {/* ── 头部: 认知负荷 ── */}
        <View style={styles.headRow}>
          <Text style={styles.title}>认知负荷 & 疲劳</Text>
          <View style={[styles.levelChip, { backgroundColor: lCol + '24' }]}>
            <View style={[styles.levelDot, { backgroundColor: lCol }]} />
            <Text style={[styles.levelText, { color: lCol }]}>{loadLabel(report.loadLevel)}</Text>
          </View>
        </View>

        {/* ── 两个大数值 ── */}
        <View style={styles.scoreRow}>
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>认知负荷</Text>
            <Text style={[styles.score, { color: lCol }]}>{report.loadScore}</Text>
          </View>
          <View style={styles.scoreDivider} />
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>疲劳指数</Text>
            <Text style={[styles.score, { color: fCol }]}>{report.fatigueIndex}</Text>
          </View>
        </View>

        {/* ── 4 子指标 ── */}
        <View style={styles.metricGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>负荷时段占比</Text>
            <Text style={styles.metricValue}>{report.highLoadRatio}%</Text>
            <Text style={styles.metricSub}>高负荷活跃时段</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>恢复能力</Text>
            <Text style={styles.metricValue}>
              {report.recoveryCapacity != null
                ? `${Math.round(report.recoveryCapacity * 100)}%`
                : '—'}
            </Text>
            <Text style={styles.metricSub}>全天最低窗口 / 基线</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>今日 HRV</Text>
            <Text style={styles.metricValue}>
              {report.baselines.hrv != null ? `${Math.round(report.baselines.hrv)} ms` : '—'}
            </Text>
            <Text style={styles.metricSub}>迷走神经活力</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>血管张力 (VTI)</Text>
            <Text style={styles.metricValue}>
              {report.baselines.vti != null ? `${Math.round(report.baselines.vti)}` : '—'}
            </Text>
            <Text style={styles.metricSub}>脑力投入外周信号</Text>
          </View>
        </View>

        {/* ── 小时分布 ── */}
        <View style={styles.hourSection}>
          <Text style={styles.sectionTitle}>全天认知负荷分布</Text>
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

        {/* ── 极值时段 ── */}
        <View style={styles.peakRow}>
          {report.peakLoadSpan != null && (
            <View style={styles.peakChip}>
              <Text style={styles.peakLabel}>最高负荷时段</Text>
              <Text style={[styles.peakTime, { color: theme.colors.danger }]}>
                {fmtRange(report.peakLoadSpan)}
              </Text>
              <Text style={styles.peakSub}>平均负荷 {report.peakLoadSpan.avgScore}</Text>
            </View>
          )}
          {report.bestSpan != null && (
            <View style={styles.peakChip}>
              <Text style={styles.peakLabel}>认知状态最佳</Text>
              <Text style={[styles.peakTime, { color: theme.colors.stateCalm }]}>
                {fmtRange(report.bestSpan)}
              </Text>
              <Text style={styles.peakSub}>平均负荷 {report.bestSpan.avgScore}</Text>
            </View>
          )}
        </View>

        {/* ── 解释 ── */}
        <Text style={styles.reasonText}>{report.loadReason}</Text>
        <Text style={[styles.reasonText, { marginTop: theme.sp(1) }]}>{report.fatigueReason}</Text>
      </View>
    </Card>
  );
}

function HourHistogram({ hourly, peakSpan, bestSpan, sleepWindow }: {
  hourly: { hour: number; score: number }[];
  peakSpan: { startHour: number; endHour: number; avgScore: number } | null;
  bestSpan: { startHour: number; endHour: number; avgScore: number } | null;
  sleepWindow: { bedHour: number; wakeHour: number } | null;
}) {
  // 动态过滤: 排除睡眠时段
  // sleepWindow = { bedHour, wakeHour }
  //   - 如果 bedHour > wakeHour (比如 bed=23, wake=7): 睡眠 = [23,24) + [0,7)
  //   - 如果 bedHour < wakeHour (比如 bed=1, wake=7):   睡眠 = [1,7)
  function isAsleep(hour: number, sw: { bedHour: number; wakeHour: number } | null): boolean {
    if (!sw) return false;
    if (sw.bedHour < sw.wakeHour) return hour >= sw.bedHour && hour < sw.wakeHour;
    return hour >= sw.bedHour || hour < sw.wakeHour;
  }
  const sw = sleepWindow;
  const defaultWake = sw ? sw.wakeHour : 6;
  const defaultBed = sw ? (sw.bedHour < sw.wakeHour ? 24 : sw.bedHour) : 24;
  // 默认 fallback: 没 sleepWindow 时显示 wakeHour~24 (06-24)
  const visible = hourly.filter(h => {
    if (sw && isAsleep(h.hour, sw)) return false;
    if (!sw && h.hour < defaultWake) return false;
    return h.score > 0;  // 只保留有真实数据的小时
  });
  const totalBins = visible.length;

  // hour -> visible index 映射 (span 高亮层用)
  const hourToIdx = new Map<number, number>();
  visible.forEach((h, i) => hourToIdx.set(h.hour, i));

  // ── 用数据里的最大值做归一化, 确保柱子都能撑开 ──
  const dataMax = Math.max(10, ...visible.map(h => h.score));

  // histogramWrap 内部可用宽度 = 屏幕宽 - sp(1)*2 padding
  const wrapWidth = Dimensions.get('window').width - theme.sp(2);
  function spanPos(start: number, end: number) {
    const s = hourToIdx.get(start) ?? 0;
    const e = hourToIdx.get(end) ?? totalBins - 1;
    const binW = wrapWidth / totalBins;
    return {
      left: s * binW,
      width: (e - s + 1) * binW,
    };
  }

  return (
    <View style={styles.histogramWrap}>
      <View style={styles.histogram}>
        {visible.map((h) => {
          const hVal = Math.max(0, Math.min(dataMax, h.score));
          const barH = hVal === 0 ? theme.sp(0.5) : Math.max(theme.sp(1.5), (hVal / dataMax) * theme.sp(7));
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
      <View style={styles.histAxis}>
        {visible.map((h) => (
          <Text key={h.hour} style={styles.histAxisLabel}>
            {String(h.hour).padStart(2, '0')}
          </Text>
        ))}
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
    marginTop: theme.sp(2), paddingVertical: theme.sp(2.5),
    borderTopWidth: 1, borderTopColor: theme.colors.cardBorder2,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder2,
  },
  emptyText: { fontSize: theme.fontSize.body, color: theme.colors.textSub, lineHeight: theme.fontSize.body + theme.sp(1.5), marginTop: theme.sp(1.5) },

  // ── 认知负荷专属 ──
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2), marginBottom: theme.sp(3) },
  scoreBlock: { flex: 1, alignItems: 'center' },
  scoreLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625), marginBottom: theme.sp(0.5) },
  score: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, letterSpacing: -1 },
  scoreDivider: { width: 1, height: theme.sp(10), backgroundColor: theme.colors.ui.borderSoft },

  histogramWrap: { height: theme.sp(10), paddingHorizontal: theme.sp(1), marginTop: theme.sp(1) },
  spanHighlight: {
    position: 'absolute',
    top: 0, bottom: theme.sp(1.5),
    borderTopWidth: 2, borderBottomWidth: 2,
    opacity: 0.5,
  },
  histogram: { flexDirection: 'row', alignItems: 'flex-end', height: theme.sp(6) },
  histBin: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  histBar: { width: theme.sp(1.5), borderRadius: theme.sp(0.5) },
  histAxis: { flexDirection: 'row', marginTop: theme.sp(0.5), paddingHorizontal: theme.sp(0.5) },
  histAxisLabel: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center' },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1), paddingHorizontal: theme.sp(0.5) },
  hourAxisLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  legendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.sp(1.5) },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.sp(1.5) },
  legendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), marginRight: theme.sp(0.75) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  peakRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2) },
  peakChip: { flex: 1, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(2), marginHorizontal: theme.sp(0.75) },
  peakLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  peakTime: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, marginTop: theme.sp(0.5) },
  peakSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  reasonText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(2) },
});
