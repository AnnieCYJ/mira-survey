/**
 * InfoDot —— 指标名旁的「查看说明」小圆点（?）
 * 与 SleepAnalysisCard 内已有的实现保持同一视觉，供其他睡眠相关卡片复用。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';

export default function InfoDot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="查看说明"
    >
      <View style={styles.infoDot}>
        <Text style={styles.infoDotText}>?</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  infoDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.textSub,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoDotText: { fontSize: 11, fontWeight: '600', color: theme.colors.textSub, lineHeight: 14 },
});
