/**
 * 情绪洞察卡片 — InsightScreen mind tab
 * 算法: src/lib/emotionEngine.ts (Threat-Challenge valence + EDA SCR arousal)
 * 设计令牌: 100% theme.ts (Mira Design System v1.0) — 禁止裸值
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';

import EmotionTimeline, { EmotionLegend } from './EmotionTimeline';
import { getEmotionHistory } from '../ble/RingBleManager';
import { healthStore, type MetricKey } from '../data/healthStore';
import type { EmotionLabel } from '../lib/emotionEngine';

// ── 情绪 → token 颜色映射 (复用 theme 已有 token, 不造新色) ──
const emoColor: Record<EmotionLabel, string> = {
  focused:  theme.colors.stateCalm,       // 专注 = 绿 (CognitiveLoadCard 同款)
  calm:     theme.colors.accentSolid,     // 平静 = 主题紫
  stressed: theme.colors.danger,          // 焦虑 = 红
  bored:    theme.colors.textSub,          // 倦怠 = 灰
  depleted: theme.colors.stateTense,      // 耗竭 = 橙
};

// 情绪标签 — 贴合经期真实感受（参考 Clue/Flo 用户语料 + 临床研究）
const emoLabel: Record<EmotionLabel, string> = {
  focused:  '精力好',     // 卵泡期/排卵期常见
  calm:     '情绪平稳',   // 非 PMS 时段
  stressed: '易怒焦虑',   // PMS 黄体期/经期常见
  bored:    '没动力',     // 黄体期疲劳
  depleted: '疲劳累',     // 经期/黄体期晚期
};

const emoEmoji: Record<EmotionLabel, string> = {
  focused:  '✨',
  calm:     '😌',
  stressed: '😤',
  bored:    '😐',
  depleted: '🫠',
};

// 按经期相位的额外解读 + 建议
const PHASE_INSIGHT: Record<string, { subtitle: string; tip: string }> = {
  period: {
    subtitle: '🩸 经期 · 身体在恢复',
    tip: '痛经 + 激素骤降容易疲劳、情绪低落，多休息、少熬夜、清淡饮食。',
  },
  follicular: {
    subtitle: '🌸 卵泡期 · 精力回升',
    tip: '雌激素升高，精力变好、情绪积极。适合安排重要任务和社交活动。',
  },
  ovulation: {
    subtitle: '⚡ 排卵期 · 状态巅峰',
    tip: '雌激素峰值，性欲旺盛、皮肤最好、情绪最高。是社交和运动的黄金期。',
  },
  luteal: {
    subtitle: '🌙 黄体期 · PMS 高发',
    tip: '孕酮上升容易水肿、乳胀、易怒、渴望甜食。情绪波动大是正常的，注意饮食和睡眠。',
  },
  unknown: {
    subtitle: '',
    tip: '记录一次经期后开启周期解读',
  },
};

interface Props {
  ring: {
    emotion: {
      arousalScore: number;
      valenceScore: number;
      emotionLabel: EmotionLabel;
      scrPeaksPerMin: number;
      scrMeanAmp: number | null;
      reason: string;
      updatedAt: number;
      cyclePhase?: string;
    } | null;
  };
  onPress?: () => void;
}

const SP = theme.sp;

export default function EmotionCard({ ring, onPress }: Props) {
  const e = ring.emotion;
  const cardW = Dimensions.get('window').width - theme.space.screen * 2;

  // 时间线历史
  const [history, setHistory] = useState<ReturnType<typeof getEmotionHistory>>([]);
  useEffect(() => {
    const refresh = () => setHistory(getEmotionHistory());
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  if (!e) return <EmotionEmptyState cardW={cardW} />;

  const color = emoColor[e.emotionLabel];

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.7 : 1} onPress={onPress}>
      <Card>
        <View style={styles.pad}>
          {/* Header: title + levelChip */}
          <View style={styles.headRow}>
            <Text style={styles.title}>今日情绪</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
              <View style={[styles.levelChip, { backgroundColor: color + '22' }]}>
                <View style={[styles.levelDot, { backgroundColor: color }]} />
                <Text style={[styles.levelText, { color }]}>{emoEmoji[e.emotionLabel]} {emoLabel[e.emotionLabel]}</Text>
              </View>
              {e.cyclePhase && e.cyclePhase !== 'unknown' ? (
                <View style={[styles.levelChip, { backgroundColor: theme.colors.moodRest + '30' }]}>
                  <Text style={[styles.levelText, { color: theme.colors.moodRest }]}>
                    {e.cyclePhase === 'period' ? '🩸经期' : e.cyclePhase === 'luteal' ? '🌙黄体期' : e.cyclePhase === 'follicular' ? '🌸卵泡期' : '⚡排卵期'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Big score + 周期解读 */}
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color }]}>{e.arousalScore}</Text>
            <Text style={styles.scoreUnit}>身体紧张度 / 100</Text>
          </View>

          {/* ★ 周期语境解读 (经期/黄体期特别重要) */}
          {e.cyclePhase && e.cyclePhase !== 'unknown' && (() => {
            const insight = PHASE_INSIGHT[e.cyclePhase];
            const showPhase = e.cyclePhase === 'period' || e.cyclePhase === 'luteal';
            if (!insight || !showPhase) return null;
            return (
              <View style={styles.phaseInsightBox}>
                <Text style={styles.phaseInsightTitle}>{insight.subtitle}</Text>
                <Text style={styles.phaseInsightTip}>{insight.tip}</Text>
              </View>
            );
          })()}

          {/* SumCell 风格 2×2 摘要网格 —— 与详情页对齐 */}
          <View style={styles.summaryGrid}>
            <SumCell
              label="情绪方向"
              value={(e.valenceScore >= 0 ? '+' : '') + e.valenceScore}
              sub={e.valenceScore >= 30 ? '积极向上' : e.valenceScore <= -30 ? '消极压力' : '不偏不倚'}
            />
            <SumCell
              label="紧张程度"
              value={e.arousalScore.toString()}
              sub={e.arousalScore >= 60 ? '紧绷' : e.arousalScore <= 30 ? '放松' : '适中'}
            />
          </View>
          <View style={[styles.summaryGrid, { marginTop: SP(1) }]}>
            <SumCell
              label="皮肤电波动"
              value={e.scrPeaksPerMin.toFixed(1) + '/分'}
              sub={e.scrPeaksPerMin > 3 ? '明显波动' : e.scrPeaksPerMin < 1 ? '非常平静' : '小幅波动'}
            />
            <SumCell
              label="判定依据"
              value=""
              sub={e.reason}
            />
          </View>

          {/* 时间线 */}
          <View style={{ marginTop: SP(3) }}>
            <EmotionTimeline history={history} width={cardW - SP(8)} />
            <EmotionLegend />
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

/** Metric 子项 — 旧版，保留供历史引用 */
function Metric({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <View style={styles.metricItem}>
      <Text style={styles.metricLabel}>{label}</Text>
      {value ? (
        <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      ) : null}
      {sub ? <Text style={styles.metricSub} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

/** SumCell —— 与详情页 EmotionCognitiveDetailScreen.SumCell 100% 对齐 */
function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      {value ? <Text style={styles.sumValue}>{value}</Text> : null}
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

/** 空状态 */
function EmotionEmptyState({ cardW }: { cardW: number }) {
  const [diag, setDiag] = useState<Record<string, number>>({});

  useEffect(() => {
    const run = () => {
      const now = Date.now();
      const d = new Date(now);
      const today0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const keys: MetricKey[] = ['hr', 'hrv', 'eda', 'sns', 'bpSys', 'bpDia'];
      const r: Record<string, number> = {};
      for (const k of keys) {
        try { r[k] = healthStore.getTimeRange(k, today0, now, { maxPoints: 999 }).length; }
        catch { r[k] = -1; }
      }
      setDiag(r);
    };
    run();
    const t = setInterval(run, 5000);
    const sub = healthStore.subscribe(run);
    return () => { clearInterval(t); sub?.(); };
  }, []);

  const usable = (diag.hrv ?? 0) >= 3
    || [diag.eda ?? 0, diag.sns ?? 0, diag.hr ?? 0].filter(n => n >= 3).length >= 2;

  return (
    <Card>
      <View style={styles.pad}>
        <View style={styles.headRow}>
          <Text style={styles.title}>今日情绪</Text>
          <Text style={styles.waitingChip}>⌛ 等待数据</Text>
        </View>

        <Text style={styles.emptyTitle}>
          {usable ? '数据就绪, 稍候…' : '正在采集生理信号'}
        </Text>
        <Text style={styles.emptyText}>
          {usable
            ? '已有足够样本, 定时器每 10s 计算一次情绪快照'
            : '连上戒指并开启自动监测。需要心率变异性(HRV) 或 至少两项生理信号到位。'}
        </Text>

        {/* 诊断 grid */}
        <View style={{ marginTop: SP(3) }}>
          {([['eda','皮肤电'],['hrv','心率变异性'],['sns','神经激活'],['hr','心率'],['bpSys','血压高压'],['bpDia','血压低压']] as const).map(([k, label]) => {
            const n = diag[k] ?? 0;
            const ok = n >= 3;
            return (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP(1) }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: ok ? theme.colors.stateCalm : theme.colors.danger }}>
                  {ok ? '✓' : '✗'} {label}
                </Text>
                <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: ok ? theme.colors.textBody : theme.colors.danger }}>
                  {n === 0 ? '无数据' : `${n} 条`}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Card>
  );
}

// ── Styles — 100% theme token, 零裸值 ──
const styles = StyleSheet.create({
  pad: { paddingVertical: SP(4), paddingHorizontal: SP(4) },

  // Header (对齐 StressInsightCard)
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP(3) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP(2), paddingVertical: SP(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: SP(1.5), height: SP(1.5), borderRadius: SP(0.75), marginRight: SP(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  waitingChip: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, backgroundColor: theme.colors.cardBgSoft, paddingHorizontal: SP(1.5), paddingVertical: SP(0.5), borderRadius: theme.radius.pill },

  // Big score (对齐 StressInsightCard)
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: SP(4) },
  score: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, letterSpacing: -1 },
  scoreUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: SP(1) },

  // Metric grid (对齐 StressInsightCard)
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -SP(1) },
  metricItem: { width: '50%', paddingHorizontal: SP(1), marginBottom: SP(3) },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: SP(0.0625) },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textBody, marginTop: SP(0.5) },
  metricSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: SP(0.5) },

  // 周期解读框
  phaseInsightBox: {
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md,
    padding: SP(2.5),
    marginBottom: SP(3),
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.moodRest,
  },
  phaseInsightTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
    marginBottom: SP(0.5),
  },
  phaseInsightTip: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: theme.fontSize.sm * 1.5,
  },

  // SumCell 风格摘要（与详情页对齐）
  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: SP(2), paddingHorizontal: SP(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: SP(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: SP(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: SP(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  // Empty state
  emptyTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle, marginBottom: SP(2) },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.4 },
});
