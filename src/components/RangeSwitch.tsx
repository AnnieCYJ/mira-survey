import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  /** ★ 可选：排除哪些按钮（如排除 'day' 只留周月年） */
  exclude?: RangeKey[];
}

const RANGES: RangeKey[] = ['day', 'week', 'month', 'year'];

export default function RangeSwitch({ value, onChange, exclude }: Props) {
  const ranges = exclude ? RANGES.filter((r) => !exclude.includes(r)) : RANGES;
  // 如果当前 value 被排除了，自动 fallback 到第一个可用的
  const effectiveValue = ranges.includes(value) ? value : ranges[0];
  return (
    <View style={styles.row}>
      {ranges.map((r) => (
        <TouchableOpacity
          key={r}
          activeOpacity={0.8}
          style={[styles.chip, r === effectiveValue && styles.chipOn]}
          onPress={() => {
            if (r !== effectiveValue) onChange(r);
          }}
        >
          <Text style={[styles.text, r === effectiveValue && styles.textOn]}>{RANGE_DEF[r].label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: theme.space.md,
  },
  chip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.xs,
  },
  chipOn: { backgroundColor: theme.colors.accentSolid },
  text: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: theme.colors.textSub },
  textOn: { color: theme.colors.textWhite },
});
