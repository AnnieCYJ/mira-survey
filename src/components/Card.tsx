import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

/**
 * v10 reskin（2026-09-24）：白卡 + **可见描边** + 卡片阴影。
 * 原来 borderWidth:0 + shadow 被注释导致纯白页面上卡片完全无边界（用户反馈
 * 「看不到边框」）。按 DESIGN-SPEC §2 白卡规格恢复：1px cardBorder + 阴影。
 */
export default function Card({ children, style, padded = true }: Props) {
  return <View style={[styles.card, padded && styles.pad, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: mm.radius.card,
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    overflow: 'hidden',
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    // ★ 2026-11-06（华为 P30 / EMUI 真机实证）：半透明玻璃底 + overflow:'hidden' +
    //   borderRadius + elevation 会让 Android 原生 outline 退化成直角实心蓝色方块，
    //   叠在卡片内容上。置 0 后方块消失、磨砂玻璃质感保留；iOS 走 shadow* 不受影响。
    elevation: 0,
  },
  pad: { padding: theme.space.cardPad },
});
