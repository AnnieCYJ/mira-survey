import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { TASK_EVENTS, TODAY_DAY, type TaskType } from '../data/tasks';

interface Props {
  year: number;
  month: number;
  tasks: Record<number, number[]>;
  onDayPress?: (day: number) => void;
  dayRefs?: React.MutableRefObject<Record<number, any>>;
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const GOLD = '#F5A623';
const CELL_BG = '#EEEEEF';
const TODAY_BG = '#FFF3CD';
const GAP = theme.sp(1.5);

/**
 * 所有格子（有日期/空白）必须用同一个 baseCellStyle，
 * 否则 RN flex:1 + aspectRatio 在不同 style 对象上计算结果可能微差 → 出现大格子。
 */
const baseCellStyle = {
  flex: 1 as const,
  aspectRatio: 0.55,
  marginRight: GAP,
  paddingHorizontal: theme.sp(1.5),
  paddingVertical: theme.sp(1),
  backgroundColor: CELL_BG,
  borderRadius: theme.radius.sm,
};

export default function CalendarGrid({ year, month, tasks, onDayPress, dayRefs }: Props) {
  const { rows } = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const lead = (first + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    const cells: number[] = [];
    for (let i = 0; i < lead; i++) cells.push(-1);
    for (let d = 1; d <= total; d++) cells.push(d);
    const filled = Math.ceil(cells.length / 7) * 7;
    while (cells.length < filled) cells.push(-1);
    const rowList: number[][] = [];
    for (let i = 0; i < cells.length; i += 7) rowList.push(cells.slice(i, i + 7));
    return { rows: rowList };
  }, [year, month]);

  const renderCell = (day: number, isLast: boolean) => {
    if (day < 0) {
      return <View key={`e${day}-${Math.random()}`} style={[baseCellStyle, isLast && { marginRight: 0 }]} />;
    }
    const isToday = day === TODAY_DAY;
    const taskTypes = (tasks[day] ?? []).slice(0, 2);
    return (
      <TouchableOpacity
        key={day}
        ref={(node) => { if (dayRefs && node) dayRefs.current[day] = node; }}
        style={[baseCellStyle, isToday && styles.cellToday, isLast && { marginRight: 0 }]}
        onPress={() => onDayPress?.(day)}
        disabled={!onDayPress}
        activeOpacity={0.8}
      >
        <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{day}</Text>
        {taskTypes.length > 0 ? (
          <View style={styles.events}>
            {taskTypes.map((t, i) => (
              <Text key={i} style={styles.evEmoji}>{TASK_EVENTS[t as TaskType].emoji}</Text>
            ))}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.weekRow}>
        {WEEK_LABELS.map((w, i) => {
          const isWE = i >= 5;
          const isLast = i === 6;
          return <Text key={w} style={[styles.weekLabel, isWE && styles.weekLabelWE, isLast && { marginRight: 0 }]}>{w}</Text>;
        })}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((day, ci) => renderCell(day, ci === 6))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  weekRow: { flexDirection: 'row', marginBottom: theme.sp(1) },
  weekLabel: {
    flex: 1, marginRight: GAP, textAlign: 'center',
    fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any,
    color: theme.colors.textBody, paddingVertical: theme.sp(1),
  },
  weekLabelWE: { color: GOLD },
  row: { flexDirection: 'row', marginBottom: GAP },
  cellToday: { backgroundColor: TODAY_BG },
  dayNum: {
    fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any,
    color: theme.colors.textSub, textAlign: 'center', marginBottom: theme.sp(0.5),
  },
  dayNumToday: { color: '#D97706', fontWeight: theme.weight.bold as any },
  events: { flexDirection: 'row', justifyContent: 'center', gap: 3 },
  evEmoji: { fontSize: 10, lineHeight: 12 },
});
