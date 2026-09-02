import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { PLAN_PER_DAY, TASK_COLORS, TODAY_DAY } from '../data/tasks';

interface Props {
  year: number;
  /** 0-based month */
  month: number;
  tasks: Record<number, number[]>;
  onDayPress?: (day: number) => void;
  /** 每个日期格子的宿主节点引用，用于测量屏幕坐标 */
  dayRefs?: React.MutableRefObject<Record<number, any>>;
}

export default function CalendarGrid({ year, month, tasks, onDayPress, dayRefs }: Props) {
  const { days, firstDayOffset } = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const list: { day: number; tasks: number[]; allDone: boolean }[] = [];
    for (let d = 1; d <= total; d++) {
      const dayTasks = tasks[d] || [];
      list.push({ day: d, tasks: dayTasks, allDone: dayTasks.length >= PLAN_PER_DAY });
    }
    return { days: list, firstDayOffset: first };
  }, [year, month, tasks]);

  const renderDay = (day: number, allDone: boolean, taskTypes: number[]) => {
    const isToday = day === TODAY_DAY;
    return (
      <TouchableOpacity
        key={day}
        ref={(node) => {
          if (dayRefs && node) dayRefs.current[day] = node;
        }}
        style={[styles.day, isToday && styles.today, allDone && styles.allDone]}
        onPress={() => onDayPress?.(day)}
        disabled={!onDayPress}
        activeOpacity={0.7}
      >
        <Text style={[styles.dayText, isToday && styles.todayText, allDone && styles.allDoneText]}>{day}</Text>
        <View style={styles.taskDots}>
          {taskTypes.slice(0, 3).map((t, i) => (
            <View key={i} style={[styles.taskDot, { backgroundColor: TASK_COLORS[t] ?? TASK_COLORS[0] }]} />
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.grid}>
      {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
        <Text key={w} style={styles.weekLabel}>
          {w}
        </Text>
      ))}
      {Array.from({ length: firstDayOffset }).map((_, i) => (
        <View key={`empty-${i}`} style={styles.emptyDay} />
      ))}
      {days.map((d) => renderDay(d.day, d.allDone, d.tasks))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: theme.radius.md,
    padding: theme.sp(2),
  },
  weekLabel: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    fontWeight: theme.weight.semibold,
    paddingVertical: theme.sp(1.5),
  },
  day: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
    marginVertical: 2,
  },
  today: { backgroundColor: theme.colors.accent1 },
  allDone: {
    backgroundColor: theme.colors.celebrateGrad[0] + '44',
    borderWidth: 1,
    borderColor: theme.colors.celebrateGrad[0],
  },
  emptyDay: { width: '14.28%', aspectRatio: 1 },
  dayText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textBody },
  todayText: { color: theme.colors.textWhite },
  allDoneText: { color: theme.colors.textTitle },
  taskDots: { flexDirection: 'row', marginTop: 2, gap: 2 },
  taskDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.radius.pill },
});
