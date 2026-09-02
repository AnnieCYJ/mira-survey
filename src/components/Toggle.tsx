import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';

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
      duration: 200,
      easing: theme.motion.ease,
      useNativeDriver: true,
    }).start();
  }, [value, x]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.track,
        { backgroundColor: value ? theme.colors.accentSolid : theme.colors.ui.offTrack },
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
