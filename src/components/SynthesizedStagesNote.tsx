/**
 * SynthesizedStagesNote —— 「分期为示意」免责提示（审查 02 🔴#3）
 *
 * 为什么需要它：
 *   HK18 / QH15 精准睡眠模型只返回各阶段**时长**，不返回逐分钟分期。
 *   当 SDK 没有下发 curve / segments 时，RingBleManager.synthesizeSleepStages()
 *   会按典型睡眠周期（浅→深→浅→REM→短暂清醒）铺排出一张 hypnogram。
 *   各阶段「时长占比」严格等于戒指实测值，但**夜内的时间轴分布是编造的** ——
 *   而 UI 画出来的是一张逐分钟曲线，观众默认每个点都是实测的，
 *   与真实分期曲线在视觉上完全无法区分。
 *
 * 所以：凡走过合成路径的那一天，必须在分期图旁显式说明「时间轴为示意」，
 * 让用户知道哪些是实测、哪些是可视化惯例。
 *
 * 判定来源：RingState.sleepStagesSynthesizedDays[dayKey] === 1
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';

/** 统一的免责文案（各处复用，避免同一件事有 N 种说法）。 */
export const SYNTH_STAGES_NOTE =
  '分期时间轴为示意：各阶段总时长为戒指实测，逐分钟分布按典型睡眠周期铺排，仅供理解结构，不作逐点判读。';

export default function SynthesizedStagesNote({ style }: { style?: object }) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.tag}>示意</Text>
      <Text style={styles.txt}>{SYNTH_STAGES_NOTE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.sp(1),
    marginTop: theme.sp(1.5),
    paddingHorizontal: theme.sp(1.5),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  tag: {
    color: theme.colors.textNavIdle,
    fontSize: theme.fontSize.tiny,
    fontWeight: theme.weight.medium,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.xs,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  txt: {
    flex: 1,
    color: theme.colors.textNavIdle,
    fontSize: theme.fontSize.tiny,
    lineHeight: theme.fontSize.tiny * 1.5,
  },
});
