/**
 * EmotionCognitiveDetailScreen —— 情绪认知消耗新详情页
 *
 * 内容顺序：返回头 → Hero(情绪+脑力双指标) → 皮质醇全天趋势 → 情绪消耗摘要 → 脑力消耗摘要
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import Card from '../components/Card';
import CortisolDailyChart from '../components/CortisolDailyChart';
import InsightBanner from '../components/InsightBanner';
import { healthStore, dayKey } from '../data/healthStore';
import { collectSamples } from '../components/CortisolRhythmCard';
import { analyzeCortisol } from '../lib/cortisolRhythm';

export default function EmotionCognitiveDetailScreen() {
  const navigation = useNavigation<any>();

  const stressReport = useMemo(() => {
    const { computeStressReport } = require('../lib/stressAlgorithm');
    return computeStressReport();
  }, []);

  const cogReport = useMemo(() => {
    const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
    return computeCognitiveLoadReport();
  }, []);


  // 皮质醇节律分析 —— 和 TrendChart 用同一份数据
  const cortisolRhythm = useMemo(() => {
    const samples = collectSamples();
    return analyzeCortisol(samples, 14);
  }, []);

  // AI 综合分析文案（针对皮质醇 + 情绪 + 脑力）
  const aiSummary = useMemo(() => {
    const parts: string[] = [];
    const r = cortisolRhythm;
    const s = stressReport;
    const g = cogReport;

    // 皮质醇节律 — 用 r.cosinor.n（样本数）、r.css（CortSineScore 判断相位）
    if (r.cosinor.n > 5) {
      const peakHour = r.cosinor.acrophaseH;
      if (Number.isFinite(peakHour)) {
        parts.push(
          `皮质醇峰值在 ${String(Math.round(peakHour)).padStart(2,'0')}:00` +
          (r.cosinor.mesor > 70 ? '，节律偏高负荷较重' :
           r.cosinor.mesor < 40 ? '，节律偏低恢复良好' :
           '，节律稳定')
        );
      }
      if (Number.isFinite(r.css)) {
        parts.push(`节律${r.css > 0.3 ? '晨型正常' : r.css < -0.3 ? '晚间偏移' : '扁平'}`);
      }
      if (r.sustainedHighStreak >= 2) {
        parts.push(`连续 ${r.sustainedHighStreak} 个时段皮质醇偏高`);
      }
    }

    // 情绪消耗
    if (s.emotionalLoad != null) {
      parts.push(
        `情绪消耗 ${s.emotionalLoad}/100` +
        (s.emotionalLoad >= 70 ? '，压力偏高注意调节' :
         s.emotionalLoad >= 40 ? '，处于适中区间' :
         '，状态放松')
      );
    }
    if (s.events.length > 0) {
      parts.push(`今日 ${s.events.length} 次压力事件`);
    }

    // 脑力消耗
    if (g.loadScore != null) {
      parts.push(
        `脑力消耗 ${g.loadScore}/100` +
        (g.loadLevel === 'heavy' ? '，认知负荷偏重' :
         g.loadLevel === 'moderate' ? '，负荷适中' :
         '，思维活跃')
      );
    }
    if (g.bestSpan) {
      parts.push(`最佳时段 ${String(g.bestSpan.startHour).padStart(2,'0')}:00–${String(g.bestSpan.endHour).padStart(2,'0')}:00`);
    }

    return parts.length > 0 ? parts.join('。') + '。' : '继续佩戴戒指，更多数据生成后即可为你提供皮质醇、情绪与脑力的综合分析。';
  }, [cortisolRhythm, stressReport, cogReport]);

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 返回头 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>身体恢复</Text>
            <Text style={styles.sub}>皮质醇 · 情绪 · 脑力全天追踪</Text>
          </View>
        </View>

        {/* ★ AI 综合分析 —— 复用洞察页面 InsightBanner 设计 */}
        <InsightBanner text={aiSummary} />

        {/* ★ 皮质醇全天趋势 —— 置顶 */}
        <CortisolDailyChart />

        {/* 情绪消耗摘要 */}
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.cardTitle}>情绪消耗摘要</Text>
            <View style={styles.summaryGrid}>
              <SumCell
                label="压力事件"
                value={`${stressReport.events.length} 次`}
                sub={stressReport.events.length > 0 ? `峰值 ${stressReport.peakHour != null ? `${String(Math.floor(stressReport.peakHour)).padStart(2,'0')}:00` : '—'}` : '无事件'}
              />
              <SumCell
                label="平均恢复"
                value={stressReport.avgRecoverySec != null ? `${stressReport.avgRecoverySec}s` : '—'}
                sub={stressReport.avgRecoverySec != null && stressReport.avgRecoverySec > 120 ? '恢复偏慢' : '恢复正常'}
              />
            </View>
          </View>
        </Card>

        {/* 脑力消耗摘要 —— 直接用 computeCognitiveLoadReport() 的事实数值 */}
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.cardTitle}>脑力消耗摘要</Text>
            <View style={styles.summaryGrid}>
              <SumCell
                label="认知负荷"
                value={cogReport.loadScore != null ? String(cogReport.loadScore) : '—'}
                sub={cogReport.peakLoadSpan ? `峰值 ${String(cogReport.peakLoadSpan.startHour).padStart(2,'0')}:00–${String(cogReport.peakLoadSpan.endHour).padStart(2,'0')}:00` : '—'}
              />
              <SumCell
                label="疲劳指数"
                value={cogReport.fatigueIndex != null ? String(cogReport.fatigueIndex) : '—'}
                sub={cogReport.bestSpan ? `最佳 ${String(cogReport.bestSpan.startHour).padStart(2,'0')}:00–${String(cogReport.bestSpan.endHour).padStart(2,'0')}:00` : '—'}
              />
              <SumCell
                label="负荷占比"
                value={cogReport.highLoadRatio != null ? `${cogReport.highLoadRatio}%` : '—'}
                sub="高负荷时段"
              />
              <SumCell
                label="恢复能力"
                value={cogReport.recoveryCapacity != null ? `${Math.round(cogReport.recoveryCapacity * 100)}%` : '—'}
                sub="全天最低窗口"
              />
            </View>
          </View>
        </Card>

        {/* 睡眠恢复摘要 */}
        {(() => {
          const sl = healthStore.getSleep(dayKey(Date.now()));
          if (!sl || sl.total <= 0) {
            return (
              <Card padded={false}>
                <View style={styles.pad}>
                  <Text style={styles.cardTitle}>睡眠恢复摘要</Text>
                  <Text style={styles.emptyHint}>昨晚无有效睡眠数据，继续佩戴戒指即可记录。</Text>
                </View>
              </Card>
            );
          }
          const totalH = (sl.total / 60).toFixed(1);
          const deepPct = sl.total > 0 ? Math.round((sl.deep / sl.total) * 100) : 0;
          const remPct  = sl.total > 0 ? Math.round((sl.rem  / sl.total) * 100) : 0;
          return (
            <Card padded={false}>
              <View style={styles.pad}>
                <Text style={styles.cardTitle}>睡眠恢复摘要</Text>
                <View style={styles.summaryGrid}>
                  <SumCell
                    label="总睡眠"
                    value={`${totalH}h`}
                    sub={`${sl.sleepTime ?? '—'} → ${sl.wakeTime ?? '—'}`}
                  />
                  <SumCell
                    label="睡眠评分"
                    value={sl.score != null ? String(sl.score) : '—'}
                    sub={sl.score >= 85 ? '恢复良好' : sl.score >= 70 ? '恢复正常' : sl.score >= 55 ? '恢复偏慢' : '需改善'}
                  />
                  <SumCell
                    label="深睡占比"
                    value={`${deepPct}%`}
                    sub={deepPct >= 20 ? '充足' : deepPct >= 12 ? '适中' : '偏少'}
                  />
                  <SumCell
                    label="REM 占比"
                    value={`${remPct}%`}
                    sub={remPct >= 15 ? '正常' : remPct >= 8 ? '适中' : '偏少'}
                  />
                </View>
              </View>
            </Card>
          );
        })()}
      </View>
    </ScreenContainer>
  );
}

function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

const pad = { padding: theme.space.cardPad };

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },

  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: theme.sp(2) },
  heroItem: { alignItems: 'center', flex: 1 },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: theme.colors.stateTense },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: -theme.sp(1) },
  heroLabel: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  heroDivider: { width: 1, height: theme.sp(12), backgroundColor: theme.colors.ui.borderSoft },

  pad,
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(2) },

  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
  emptyHint: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
});
