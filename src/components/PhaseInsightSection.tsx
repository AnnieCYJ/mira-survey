/**
 * PhaseInsightSection — 周期各阶段身心特征 + 建议
 *
 * 数据来源:
 *   - 生理变化: Clue 官方科普 + 临床综述 (Frontiers in Endocrinology 2023)
 *   - 情绪波动: Flo 用户语料分析
 *   - 运动建议: ACSM 运动与激素周期指南
 *
 * 严格基于 PhaseBucket, 不编造具体身体数据 (戒指测不到的一律不编)
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import type { CyclePhase } from '../lib/cycleMath';

interface PhaseData {
  title: string;         // 主标题
  emoji: string;
  body: string[];        // 3-4 个 bullet
  tips: string[];        // 2-3 个建议
  color: string;         // accent 色
}

const PHASE_DATA: Record<CyclePhase, PhaseData> = {
  period: {
    title: '经期 · 身体在恢复',
    emoji: '🩸',
    color: theme.colors.moodRest,
    body: [
      '雌激素/孕酮骤降 · 身体进入恢复模式',
      '常见: 痛经、疲劳、头痛、腹胀、失眠、情绪低落',
      '能量最低 · 运动表现下降 10-15%',
      '免疫力轻微下降 · 注意保暖和休息',
    ],
    tips: [
      '✅ 多休息 · 减少高强度训练',
      '✅ 暖饮 · 姜茶、热水、清淡饮食',
      '❌ 避免寒凉、咖啡、酒精',
    ],
  },
  follicular: {
    title: '卵泡期 · 精力回升',
    emoji: '🌸',
    color: theme.colors.success,
    body: [
      '雌激素逐渐升高 · 身心状态持续变好',
      'HRV 上升 · 身体恢复能力增强',
      '常见: 精力变好、情绪积极、社交活跃',
      '运动表现回升 · 是减脂和肌肉增长的好时机',
    ],
    tips: [
      '✅ 适合安排重要任务、面试、社交',
      '✅ 加大训练强度 · 肌肉增长效率高',
      '✅ 可以开始新的运动/饮食计划',
    ],
  },
  ovulation: {
    title: '排卵期 · 状态巅峰',
    emoji: '⚡',
    color: theme.colors.accentSolid,
    body: [
      '雌激素峰值 + LH 激增 · 最具能量',
      'HRV 最高 · 压力抵抗力最强',
      '常见: 性欲旺盛、情绪高涨、食欲下降、皮肤变好',
      '运动表现最佳 · 力量 + 耐力双双在线',
    ],
    tips: [
      '✨ 是运动、社交、决策的黄金时段',
      '⚠️ 易孕期 (排卵前 5 天 ~ 后 1 天)',
      '✅ 适合高强度训练和个人突破',
    ],
  },
  luteal: {
    title: '黄体期 · PMS 高发',
    emoji: '🌙',
    color: theme.colors.stateTense,
    body: [
      '孕酮上升 · 黄体分泌雌激素和孕酮',
      '体温双相升高 (BBT +0.3~0.5°C) · HRV 下降',
      '常见 PMS: 水肿、乳胀、易怒、焦虑、渴望甜食、疲劳、情绪波动大',
      '能量下降 · 运动恢复变慢',
    ],
    tips: [
      '✅ 降低训练强度 · 多做拉伸和低强度有氧',
      '✅ 控制糖/盐摄入 · 多喝水减轻水肿',
      '⚠️ 情绪波动大是正常的 · 注意沟通方式',
      '✅ 保证睡眠 · 睡眠质量最影响 PMS 症状',
    ],
  },
};

export default function PhaseInsightSection({
  phase,
  dayInCycle,
  cycleLength,
}: {
  phase: CyclePhase | 'unknown';
  dayInCycle: number;
  cycleLength: number;
}) {
  if (phase === 'unknown') return null;
  const data = PHASE_DATA[phase];

  // 进度: 本阶段内的相对位置 (0-100%)
  let phaseProgress = 0;
  if (phase === 'period') {
    const periodLen = 5;
    phaseProgress = Math.min(100, Math.max(0, (dayInCycle / periodLen) * 100));
  } else if (phase === 'follicular') {
    const ovulationDay = cycleLength - 14;
    phaseProgress = Math.min(100, Math.max(0, ((dayInCycle - 5) / Math.max(1, ovulationDay - 5)) * 100));
  } else if (phase === 'ovulation') {
    phaseProgress = 50;  // 排卵期短, 固定中位
  } else if (phase === 'luteal') {
    const lutealStart = cycleLength - 14;
    phaseProgress = Math.min(100, Math.max(0, ((dayInCycle - lutealStart) / 14) * 100));
  }

  return (
    <View style={styles.wrap}>
      {/* 标题 */}
      <View style={styles.head}>
        <Text style={styles.title}>{data.emoji} {data.title}</Text>
        <Text style={[styles.tag, { backgroundColor: data.color + '22', color: data.color }]}>
          周期第 {dayInCycle} 天
        </Text>
      </View>

      {/* 阶段进度 */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { flexGrow: phaseProgress / 100, backgroundColor: data.color }]} />
      </View>

      {/* 生理/情绪 bullet */}
      <View style={styles.bodyBox}>
        <Text style={styles.subTitle}>本阶段身心变化</Text>
        {data.body.map((b, i) => (
          <Text key={i} style={styles.bullet}>• {b}</Text>
        ))}
      </View>

      {/* 建议 */}
      <View style={styles.tipsBox}>
        <Text style={styles.subTitle}>建议</Text>
        {data.tips.map((t, i) => (
          <Text key={i} style={styles.tip}>{t}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: theme.space.md,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.card,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.sm },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  tag: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill },

  progressBar: { height: 4, backgroundColor: 'rgba(124,106,224,0.14)', borderRadius: 2, marginBottom: theme.space.md },
  progressFill: { height: 4, borderRadius: 2 },

  subTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1), marginTop: theme.space.xs },
  bullet: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55 },
  bodyBox: { marginBottom: theme.space.sm },

  tipsBox: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: theme.radius.sm,
    padding: theme.space.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentSoft,
  },
  tip: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.5, marginBottom: theme.sp(0.5) },
});
