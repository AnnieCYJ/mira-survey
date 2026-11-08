/**
 * BackButton —— 统一返回按钮（圆形白底 + 左箭头）
 *
 * ★ 2026-11-06（用户）：各详情页返回按钮不一致（有的有圆圈、有的光一个箭头），
 *   统一收敛为「圆形白底 + 左箭头」——与 MetricDetailScreen 的 styles.back 同款视觉。
 *   所有需要返回上级的页面都走这一个组件，避免样式漂。
 */
import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';

interface Props {
  onPress: () => void;
  /** 箭头颜色，默认深墨（白底上清晰） */
  color?: string;
  /** 箭头尺寸，默认 h2 */
  size?: number;
  accessibilityLabel?: string;
}

export default function BackButton({
  onPress,
  color = mm.colors.ink,
  size = theme.fontSize.h2,
  accessibilityLabel = '返回',
}: Props) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={styles.btn}
    >
      <Icon name="back" size={size} color={color} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.ui.white72,
    alignItems: 'center',
    justifyContent: 'center',
    // ★ 2026-11-07（用户「返回键离标题太近」）：与 MetricDetailScreen styles.back 同款间距，
    //   返回圆钮与标题之间统一留 space.sm，不再各页自己补。
    marginRight: theme.space.sm,
  },
});
