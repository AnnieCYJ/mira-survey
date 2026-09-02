import React from 'react';
import { ScrollView, View, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';

interface Props {
  children: React.ReactNode;
  compactTop?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export default function ScreenContainer({
  children,
  compactTop = false,
  style,
  contentStyle,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, style]}>
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
  outer: { flex: 1, width: '100%', alignItems: 'center' },
  fill: { flex: 1, width: '100%' },
  content: { alignItems: 'center' },
  inner: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.screen,
  },
});
