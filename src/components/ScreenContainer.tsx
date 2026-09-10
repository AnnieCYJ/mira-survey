import React from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';

interface Props {
  children: React.ReactNode;
  compactTop?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  withGradient?: boolean;
}

const GRAD_COLORS: string[] = ['#B5A9F2', '#CFC8F7', '#E6E3FB', '#F7F5FE'];
const GRAD_LOCS: number[] = [0, 0.34, 0.64, 1];

export default function ScreenContainer({
  children,
  compactTop = false,
  style,
  contentStyle,
  withGradient = false,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, style]}>
      {withGradient && (
        <LinearGradient
          colors={GRAD_COLORS}
          locations={GRAD_LOCS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (compactTop ? theme.space.screen : theme.space.xl) + insets.top,
            paddingBottom: theme.layout.pageBottomPad(insets.bottom),
          },
          contentStyle,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, width: '100%', position: 'relative' },
  fill: { flex: 1, width: '100%' },
  content: { alignItems: 'center' },
  inner: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.screen,
  },
});
