/**
 * PhaseInsightSection — 周期各阶段身心特征 + 建议（AI 分析外壳版）
 *
 * 设计：统一使用 design token 的「AI 分析」外壳（AiAnalysis：渐变 ✨ 胶囊 +
 *   AiResultRow 结论行 + 建议块），与周期日历页激素卡的 AI 解读视觉一致。
 *
 * 数据来源（科普部分）：
 *   - 生理变化: Clue 官方科普 + 临床综述 (Frontiers in Endocrinology 2023)
 *   - 情绪波动: Flo 用户语料分析
 *   - 运动建议: ACSM 运动与激素周期指南
 * 严格基于 PhaseBucket，不编造具体身体数据（戒指测不到的一律不编）。
 *
 * 激素趋势解读：复用 lib/hormoneTrend 的 buildEstrogenData / buildProgesteroneData
 *   （真实数据推算，戒指不直接测激素），把「上方面板那张双相趋势图」转成文字结论。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import type { CyclePhase, CycleInfo } from '../lib/cycleMath';
import { buildEstrogenData, buildProgesteroneData } from '../lib/hormoneTrend';
import type { RingState } from '../ble/RingBleManager';
import AiAnalysis, { AiResultRow, type AiTone } from './AiAnalysis';

interface InsightRow {
  tone: AiTone;
  title: string;
  body: string;
}
interface PhaseData {
  title: string;
  insights: InsightRow[];
  advice: string[];
}

const PHASE_DATA: Record<CyclePhase, PhaseData> = {
  period: {
    title: '经期 · 身体在恢复',
    insights: [
      {
        tone: 'neutral',
        title: '激素处于低位',
        body: '雌激素与孕酮骤降，身体进入恢复模式，能量最低、运动表现下降约 10–15%。',
      },
      {
        tone: 'warn',
        title: '注意休息与保暖',
        body: '常见痛经、疲劳、腹胀、情绪低落；免疫力轻微下降，注意保暖与睡眠。',
      },
    ],
    advice: ['多休息 · 减少高强度训练', '暖饮 · 姜茶与清淡饮食', '避免寒凉、咖啡、酒精'],
  },
  follicular: {
    title: '卵泡期 · 精力回升',
    insights: [
      {
        tone: 'good',
        title: '精力与情绪回升',
        body: '雌激素逐渐升高、HRV 上升，身体恢复能力增强，精力与情绪持续变好，适合安排高难度任务与加训。',
      },
    ],
    advice: ['适合安排重要任务、面试、社交', '加大训练强度 · 肌肉增长效率高', '可以开始新的运动/饮食计划'],
  },
  ovulation: {
    title: '排卵期 · 状态巅峰',
    insights: [
      {
        tone: 'good',
        title: '能量与状态巅峰',
        body: '雌激素峰值 + LH 激增，HRV 最高、压力抵抗力最强，运动表现最佳，是运动与决策的黄金时段。',
      },
      {
        tone: 'warn',
        title: '易孕期',
        body: '排卵前 5 天 ~ 后 1 天为易孕期，若有避孕或备孕计划需特别注意。',
      },
    ],
    advice: ['运动、社交、决策的黄金时段', '适合高强度训练与个人突破', '注意易孕期安排'],
  },
  luteal: {
    title: '黄体期 · PMS 高发',
    insights: [
      {
        tone: 'warn',
        title: '孕酮主导 · 能量回落',
        body: '孕酮上升使体温双相升高、HRV 下降，能量下降、运动恢复变慢，PMS 高发。',
      },
      {
        tone: 'warn',
        title: '情绪与水肿',
        body: '常见乳胀、易怒、焦虑、渴望甜食与疲劳；情绪波动属正常，注意沟通方式。',
      },
    ],
    advice: ['降低训练强度 · 多做拉伸与低强度有氧', '控制糖/盐 · 多喝水减轻水肿', '保证睡眠 · 最影响 PMS 症状'],
  },
};

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 把一组 0–100 序列的首尾趋势转成方向描述（取首/尾各 min(7, 1/3) 段均值） */
function trendStat(arr: { value: number }[]): { first: number; last: number; delta: number } | null {
  if (!arr || arr.length < 2) return null;
  const k = Math.min(7, Math.ceil(arr.length / 3));
  const first = avg(arr.slice(0, k).map((p) => p.value));
  const last = avg(arr.slice(-k).map((p) => p.value));
  return { first, last, delta: Math.round(last - first) };
}

export default function PhaseInsightSection({
  phase,
  dayInCycle,
  ring,
  cycleInfo,
}: {
  phase: CyclePhase | 'unknown';
  dayInCycle: number;
  ring: RingState;
  cycleInfo: CycleInfo | null;
}) {
  if (phase === 'unknown') return null;
  const data = PHASE_DATA[phase];

  // 双激素趋势解读（真实数据推算），与上方的双相趋势图配套。
  const estData = useMemo(() => buildEstrogenData(ring, 'month'), [ring]);
  const progData = useMemo(() => buildProgesteroneData(ring, cycleInfo, 'month'), [ring, cycleInfo]);

  const hormoneRows = useMemo<InsightRow[]>(() => {
    const rows: InsightRow[] = [];

    const e = trendStat(estData.real ?? []);
    if (e) {
      let body: string;
      if (e.delta > 5) {
        body = `近 30 天由 ${Math.round(e.first)} 升至 ${Math.round(e.last)}（▲${e.delta}），处于爬升段，与体力、情绪回升同步。`;
      } else if (e.delta < -5) {
        body = `近 30 天由 ${Math.round(e.first)} 回落至 ${Math.round(e.last)}（▼${Math.abs(e.delta)}），处于周期后段下降趋势。`;
      } else {
        body = `近 30 天在 ${Math.round(e.last)} 上下小幅波动，未见明显趋势。`;
      }
      rows.push({ tone: 'good', title: '雌激素趋势（HRV·EDA 推算）', body });
    } else {
      rows.push({
        tone: 'neutral',
        title: '雌激素趋势（HRV·EDA 推算）',
        body: '连续佩戴获取 HRV 与皮肤电导（EDA）后，这里会显示雌激素趋势推算。',
      });
    }

    const p = trendStat(progData.real ?? []);
    if (p) {
      let body: string;
      if (p.delta > 5) {
        body = `近 30 天由 ${Math.round(p.first)} 升至 ${Math.round(p.last)}（▲${p.delta}），排卵后孕酮驱动体温与心率抬升，已进入黄体相。`;
      } else if (p.delta < -5) {
        body = `近 30 天由 ${Math.round(p.first)} 降至 ${Math.round(p.last)}（▼${Math.abs(p.delta)}），黄体相回落后趋于低位。`;
      } else {
        body = `近 30 天维持约 ${Math.round(p.last)} 的低位，尚未进入黄体期双相抬升。`;
      }
      rows.push({ tone: 'neutral', title: '孕激素趋势（体温·心率 推算）', body });
    } else {
      rows.push({
        tone: 'neutral',
        title: '孕激素趋势（体温·心率 推算）',
        body: '连续佩戴获取体温与静息心率后，这里会显示孕激素趋势推算。',
      });
    }

    return rows;
  }, [estData, progData]);

  const rows: InsightRow[] = [...data.insights, ...hormoneRows];

  return (
    <View style={styles.wrap}>
      <AiAnalysis label="AI 分析">
        <Text style={styles.phaseTitle}>{data.title}</Text>
        <Text style={styles.dayTag}>周期第 {dayInCycle} 天</Text>
        {rows.map((r, i) => (
          <AiResultRow key={i} tone={r.tone} title={r.title}>
            {r.body}
          </AiResultRow>
        ))}
      </AiAnalysis>

      {/* 建议块（token 化，沿用 AiResultRow 正文规格） */}
      <View style={styles.adviceBox}>
        <Text style={styles.adviceTitle}>建议</Text>
        {data.advice.map((t, i) => (
          <Text key={i} style={styles.adviceItem}>
            {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: theme.space.lg,
    paddingTop: theme.space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.cardBorder,
  },
  phaseTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(0.5),
  },
  dayTag: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  adviceBox: {
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    padding: theme.space.sm,
    marginTop: theme.space.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentSoft,
  },
  adviceTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1),
  },
  adviceItem: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: theme.fontSize.sm * 1.5,
    marginBottom: theme.sp(0.5),
  },
});
