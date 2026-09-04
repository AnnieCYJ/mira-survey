import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
}

const RANGES: RangeKey[] = ['day', 'week', 'month', 'year'];

export default function RangeSwitch({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {RANGES.map((r) => (
        <TouchableOpacity
          key={r}
          activeOpacity={0.8}
          style={[styles.chip, r === value && styles.chipOn]}
          onPress={() => onChange(r)}
        >
          <Text style={[styles.text, r === value && styles.textOn]}>{RANGE_DEF[r].label}</Text>
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
