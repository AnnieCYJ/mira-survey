import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

const W = 51;
const H = 31;
const KNOB = 27;
const PAD = 2;
const ON_X = W - KNOB - PAD; // 22
const OFF_X = PAD; // 2

interface Props {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}

export default function Toggle({ value, onValueChange, disabled }: Props) {
  const x = useRef(new Animated.Value(value ? ON_X : OFF_X)).current;

  useEffect(() => {
    Animated.timing(x, {
      toValue: value ? ON_X : OFF_X,
      // 开关属于「点下去必须立刻有反应」的控件 → 用 quick 档 + 屏内标准曲线
      duration: theme.motion.quick,
      easing: theme.motion.easeStandard,
      useNativeDriver: true,
    }).start();
  }, [value, x]);

  return (
    <TouchableOpacity
      activeOpacity={theme.press.opacity}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.track,
        // v16 §1.6：开关=控件，选中态用黄绿（全 app 唯一控件色），替代旧 accentSolid 紫
        { backgroundColor: value ? mm.colors.limeMid : theme.colors.ui.offTrack },
      ]}
    >
      <Animated.View style={[styles.knob, { transform: [{ translateX: x }] }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: theme.colors.textWhite,
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
});
