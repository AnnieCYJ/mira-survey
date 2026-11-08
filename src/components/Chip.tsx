import React from 'react';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export default function Chip({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.hit,
        pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
      ]}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {({ pressed: _p }) => (
        active ? (
          <LinearGradient
            colors={[theme.colors.accentSolid, theme.colors.ui.chipGradEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.chip, styles.on]}
          >
            <Text style={[styles.text, styles.textOn]}>{label}</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.chip, styles.idle]}>
            <Text style={styles.text}>{label}</Text>
          </View>
        )
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { marginRight: theme.space.xs, borderRadius: theme.radius.pill },
  chip: {
    paddingHorizontal: theme.space.sm + theme.sp(1),
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: {},
  idle: {
    backgroundColor: theme.colors.ui.white46,
    borderWidth: 1,
    borderColor: theme.colors.ui.white60,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: theme.colors.ui.chipText,
  },
  textOn: { color: theme.colors.textWhite },
});
