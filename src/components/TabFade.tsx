/**
 * TabFade —— 包裹每个 bottom-tab screen，使其在**获得焦点（被切到）时**淡入 + 轻微上移，
 * 取代原生 bottom-tab 的硬切，让页面切换更丝滑。
 * 失焦时立即归零（不带动画），下次切回再淡入。
 *
 * 注意：screen 组件的 navigation / route props 由调用方透传（见 BottomTabNavigator），
 * 本组件只负责渲染包裹层，不消费导航。
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useReducedMotion } from '../hooks/useReducedMotion';

export default function TabFade({ children }: { children: React.ReactNode }) {
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (!focused) {
      // 失焦：立即归零，避免残留半透明层影响其它页截图/无障碍
      opacity.setValue(0);
      translateY.setValue(8);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0);
    translateY.setValue(8);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [focused, reducedMotion, opacity, translateY]);

  return (
    <Animated.View style={[{ flex: 1, opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
