/**
 * EmotionDots —— 情绪消耗点阵图（MindMate v10，DESIGN-SPEC §1 #8）
 * 4 排 × 24 列 = 96 点，每点 15 分钟。**只画点、不显图例**（用户定稿：档位不展示文字）。
 * 数据由 TodayScreen 预映射为 96 个档位 key 传入（真实数据：睡眠窗口 / 状态曲线档位 / 压力事件槽）。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

export type MindMoodKey = 'calm' | 'energy' | 'focus' | 'stress' | 'tired' | 'sleep' | 'none';

const MOOD_COLOR: Record<MindMoodKey, string> = {
  calm: mm.colors.moodCalm,
  energy: mm.colors.moodEnergy,
  focus: mm.colors.moodFocus,
  stress: mm.colors.moodStress,
  tired: mm.colors.moodTired,
  sleep: mm.colors.moodSleep,
  none: mm.colors.moodNone,   // ★ v18.60：无数据 = 中灰（用户定稿：睡眠段/未到时段不上情绪色）
};

function EmotionDotsImpl({ slots, columns = 24, dotSize, gap, tight }: { slots: MindMoodKey[]; columns?: number; dotSize?: number; gap?: number; tight?: boolean }) {
  // ★ v18.53：dotSize 可缩点（Bento 小卡用）；tight 收紧顶部留白
  // ★ v18.56.1：gap 可调（Bento 情绪卡对齐 mock：7pt 点 + 3pt 间距）
  // ★ v18.60：显式分行（每行 columns 颗，chunk 切片）——flexWrap 自然换行的排数取决于实测宽度，
  //   真机上多出一排就把大数字挤到点阵上（遮挡实锤）。显式分行后纵向高度恒定 = rows×(d+g)-g。
  const d = dotSize ?? theme.fs(4.6);
  const g = gap ?? theme.fs(1);
  const rows: MindMoodKey[][] = [];
  for (let i = 0; i < slots.length; i += columns) rows.push(slots.slice(i, i + columns));
  return (
    <View style={[styles.wrap, tight && { marginTop: theme.sp(1) }]}>
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, { marginBottom: g }, r === rows.length - 1 && { marginBottom: 0 }]}>
          {row.map((s, c) => (
            <View
              key={c}
              style={[
                {
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  backgroundColor: MOOD_COLOR[s] ?? mm.colors.moodCalm,
                },
                c !== row.length - 1 && { marginRight: g },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export default React.memo(EmotionDotsImpl);

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',                 // ★ v18.60：不占满行宽，避免 wrap View 被拉伸影响对齐
    marginTop: theme.sp(2.75),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
