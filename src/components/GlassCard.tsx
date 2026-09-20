import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { theme } from '../theme/theme';

/**
 * GlassCard —— 「拟态玻璃」卡片容器（首页消耗卡 / 概览卡同款外观）。
 * 半透明白底 + 白色高光描边 + 柔和紫色投影；外观 token 全部取自 theme.glassMorph。
 * 需要非玻璃的纯白卡请用 <Card>。
 */
interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 默认带 cardPad 内边距；自管理内边距时传 false */
  padded?: boolean;
}

export default function GlassCard({ children, style, padded = true }: Props) {
  return <View style={[styles.card, padded && styles.pad, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { ...theme.glassMorph, borderRadius: theme.radius.card },
  pad: { padding: theme.space.cardPad },
});
