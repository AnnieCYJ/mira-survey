import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Image } from 'react-native';
import { theme } from '../theme/theme';
import { TASK_EVENTS, TODAY_DAY, type TaskType } from '../data/tasks';

const puzzleImg = require('../../assets/calendar-puzzle.jpg');

interface Props {
  year: number;
  month: number;
  tasks: Record<number, number[]>;
  onDayPress?: (day: number) => void;
  dayRefs?: React.MutableRefObject<Record<number, any>>;
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
// v16 五色系统：周末/今日用黄（honey）家族——黄=元气·能量档，替代旧 #F5A623/#FFF3CD
const GOLD = '#F0C46E';        // honeyCore
const CELL_BG = '#F6F4F1';     // mm.colors.emptyFill（中性空格子）
const TODAY_BG = '#FBEFD6';    // honeySoft
const GAP = theme.sp(1.5);
const COLS = 7;
const ROWS = 6;

const baseCellStyle = {
  flex: 1 as const,
  aspectRatio: 0.55,
  marginRight: GAP,
  borderRadius: theme.radius.sm,
};

export default function CalendarGrid({ year, month, tasks, onDayPress, dayRefs }: Props) {
  const { rows, cellInfos } = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const lead = (first + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    const cells: number[] = [];
    for (let i = 0; i < lead; i++) cells.push(-1);
    for (let d = 1; d <= total; d++) cells.push(d);
    const filled = Math.ceil(cells.length / 7) * 7;
    while (cells.length < filled) cells.push(-1);

    const infoList: { day: number; flipped: boolean }[] = cells.map(day => ({
      day,
      flipped: day > 0 && (tasks[day]?.length ?? 0) > 0,
    }));

    const rowList: number[][] = [];
    for (let i = 0; i < cells.length; i += 7) rowList.push(cells.slice(i, i + 7));
    return { rows: rowList, cellInfos: infoList };
  }, [year, month, tasks]);

  // 42 个 cell 的 flip 状态：isFlippedRef（布尔）+ flipRefs（动画值）
  const isFlippedRef = useRef<boolean[]>([]);
  const flipRefs = useRef<Animated.Value[]>([]);
  if (flipRefs.current.length !== 42) {
    isFlippedRef.current = cellInfos.map(i => i.flipped);
    flipRefs.current = cellInfos.map(i => new Animated.Value(i.flipped ? 1 : 0));
  }

  // tasks 变化 → 同步（无动画）
  useEffect(() => {
    cellInfos.forEach((info, idx) => {
      const target = info.flipped;
      isFlippedRef.current[idx] = target;
      flipRefs.current[idx].setValue(target ? 1 : 0);
    });
  }, [cellInfos]);

  const [cellSize, setCellSize] = useState({ w: 40, h: 73 });
  const onGridLayout = (e: any) => {
    const gridW = e.nativeEvent.layout.width;
    const cellW = (gridW - GAP * (COLS - 1)) / COLS;
    const cellH = cellW / 0.55;
    setCellSize({ w: cellW, h: cellH });
  };

  const toggleFlip = (idx: number) => {
    const v = flipRefs.current[idx];
    const next = !isFlippedRef.current[idx];
    isFlippedRef.current[idx] = next;
    Animated.timing(v, {
      toValue: next ? 1 : 0,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const renderCell = (day: number, rowIdx: number, colIdx: number, isLast: boolean) => {
    const idx = rowIdx * 7 + colIdx;
    const isEmpty = day < 0;
    const isToday = day === TODAY_DAY;
    const taskTypes = (tasks[day] ?? []).slice(0, 2);

    const flip = flipRefs.current[idx];
    const frontRot = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    const backRot = flip.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] });

    const puzzleImgW = cellSize.w * COLS;
    const puzzleImgH = cellSize.h * ROWS;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={isEmpty}
        style={[baseCellStyle, isLast && { marginRight: 0 }, styles.cellOuter]}
        onPress={() => { toggleFlip(idx); onDayPress?.(day); }}
      >
        <Animated.View
          style={[
            styles.face, styles.front,
            { transform: [{ rotateX: frontRot }] },
            !isEmpty && isToday && { backgroundColor: TODAY_BG },
          ]}
        >
          {!isEmpty && (
            <>
              <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{day}</Text>
              {taskTypes.length > 0 ? (
                <View style={styles.events}>
                  {taskTypes.map((t, i) => (
                    <Text key={i} style={styles.evEmoji}>{TASK_EVENTS[t as TaskType].emoji}</Text>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Animated.View>

        <Animated.View
          style={[styles.face, styles.back, { transform: [{ rotateX: backRot }] }]}
        >
          <Image
            source={puzzleImg}
            style={{
              position: 'absolute',
              width: puzzleImgW,
              height: puzzleImgH,
              left: -colIdx * cellSize.w,
              top: -rowIdx * cellSize.h,
              resizeMode: 'cover',
            }}
          />
        </Animated.View>
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
      <View style={styles.grid} onLayout={onGridLayout}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((day, ci) => renderCell(day, ri, ci, ci === 6))}
          </View>
        ))}
      </View>
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
  grid: {},
  row: { flexDirection: 'row', marginBottom: GAP },
  cellOuter: { transform: [{ perspective: 1000 }] },
  face: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  front: {
    backgroundColor: CELL_BG,
    paddingHorizontal: theme.sp(1.5),
    paddingVertical: theme.sp(1),
  },
  back: { backgroundColor: '#fff' },
  dayNum: {
    fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any,
    color: theme.colors.textSub, textAlign: 'center', marginBottom: theme.sp(0.5),
  },
  dayNumToday: { color: '#B98A2E', fontWeight: theme.weight.bold as any }, // honeyDeep
  events: { flexDirection: 'row', justifyContent: 'center', gap: 3 },
  evEmoji: { fontSize: theme.fontSize.tiny, lineHeight: 12 },
});
