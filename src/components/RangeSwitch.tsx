import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { theme } from '../theme/theme';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  exclude?: RangeKey[];
}

const RANGES: RangeKey[] = ['day', 'week', 'month', 'year'];

export default function RangeSwitch({ value, onChange, exclude }: Props) {
  const ranges = exclude ? RANGES.filter((r) => !exclude.includes(r)) : RANGES;
  const effectiveValue = ranges.includes(value) ? value : ranges[0];

  // ★ 方案: 每个 chip 自带 背景 pill + scale 动画, 不用 absolute 定位
  // Fabric 架构对 absolute Animated.View 有 parentNode 问题
  const animsRef = useRef<Record<string, { scale: Animated.Value; opacity: Animated.Value }>>({});
  ranges.forEach((r) => {
    if (!animsRef.current[r]) {
      animsRef.current[r] = { scale: new Animated.Value(0.85), opacity: new Animated.Value(0) };
    }
  });

  useEffect(() => {
    Object.entries(animsRef.current).forEach(([k, a]) => {
      const on = k === effectiveValue;
      Animated.parallel([
        Animated.spring(a.scale, {
          toValue: on ? 1 : 0.85,
          tension: 400, friction: 30, useNativeDriver: true,
        }),
        Animated.timing(a.opacity, {
          toValue: on ? 1 : 0,
          duration: on ? 160 : 100,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [effectiveValue]);

  return (
    <View style={styles.row}>
      {ranges.map((r) => {
        const on = r === effectiveValue;
        const a = animsRef.current[r];
        return (
          <TouchableOpacity
            key={r}
            activeOpacity={0.7}
            style={styles.chipWrap}
            onPress={() => { if (!on) onChange(r); }}
          >
            {/* 背景 pill (Fabric 安全: 正常 child, 不 absolute) */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                { opacity: a.opacity, transform: [{ scale: a.scale }] },
              ]}
            />
            <Text style={[styles.text, on && styles.textOn]}>{RANGE_DEF[r].label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: theme.space.md,
    backgroundColor: 'transparent',
    borderRadius: theme.radius.pill,
    padding: 3,
  },
  chipWrap: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.pill,
    shadowColor: theme.colors.accentSolid,
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
  },
  textOn: { color: theme.colors.textWhite },
});
