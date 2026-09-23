/**
 * EmotionDots —— 情绪消耗点阵图（MindMate v10，DESIGN-SPEC §1 #8）
 * 4 排 × 24 列 = 96 点，每点 15 分钟。**只画点、不显图例**（用户定稿：档位不展示文字）。
 * 数据由 TodayScreen 预映射为 96 个档位 key 传入（真实数据：睡眠窗口 / 状态曲线档位 / 压力事件槽）。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

export type MindMoodKey = 'calm' | 'energy' | 'focus' | 'stress' | 'tired' | 'sleep';

const MOOD_COLOR: Record<MindMoodKey, string> = {
  calm: mm.colors.moodCalm,
  energy: mm.colors.moodEnergy,
  focus: mm.colors.moodFocus,
  stress: mm.colors.moodStress,
  tired: mm.colors.moodTired,
  sleep: mm.colors.moodSleep,
};

function EmotionDotsImpl({ slots, columns = 24 }: { slots: MindMoodKey[]; columns?: number }) {
  return (
    <View style={styles.wrap}>
      {slots.map((s, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: MOOD_COLOR[s] ?? mm.colors.moodCalm },
            // 每行末尾去掉右侧留白，保证 24 列对齐
            (i + 1) % columns === 0 && { marginRight: 0 },
            i >= slots.length - columns && { marginBottom: 0 },
          ]}
        />
      ))}
    </View>
  );
}

export default React.memo(EmotionDots);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.sp(2.75),
  },
  dot: {
    width: theme.fs(4.6),
    height: theme.fs(4.6),
    borderRadius: theme.fs(2.3),
    marginRight: theme.fs(1),
    marginBottom: theme.fs(1),
  },
});
