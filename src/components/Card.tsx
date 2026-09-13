import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { theme } from '../theme/theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export default function Card({ children, style, padded = true }: Props) {
  return <View style={[styles.card, padded && styles.pad, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    overflow: 'hidden',
    // ...theme.shadow.card,  // ★ 临时注释 shadow 排查白闪
  },
  pad: { padding: theme.space.cardPad },
});
