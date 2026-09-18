import React, { useRef, useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme/theme';
import Icon, { type IconName } from './Icon';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Meditation: 'tools',
  Profile: 'calendar',
  Focus: 'orb',
};
const VOICE_ROUTE = 'Focus';
const LEFT_ROUTES = ['Today', 'Insight', 'Meditation', 'Profile'];

// 右下 tab 上会动的 Mira Bot 脸
// 全用 Animated.Views，避免 SVG transform 坐标混乱
function AnimatedBotFace({ size, focused }: { size: number; focused: boolean }) {
  // 眼睛 wander（两眼共享一个偏移）
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;
  // 眨眼
  const blinkY = useRef(new Animated.Value(1)).current;
  // 笑眼过渡：0 = 竖眼, 1 = 笑眼
  const smile = useRef(new Animated.Value(0)).current;
  const [smiling, setSmiling] = useState(false);

  const SCALE = size / 200;

  // 眼参数（viewBox 200 坐标 × SCALE → 实际像素）
  const EYE_W = 12 * SCALE;    // 竖眼宽
  const EYE_H = 44 * SCALE;   // 竖眼高
  const EYE_LX = 72 * SCALE;  // 左眼中心 X
  const EYE_RX = 128 * SCALE; // 右眼中心 X
  const EYE_CY = 100 * SCALE; // 两只眼中心 Y

  // 笑眼参数：短而扁的椭圆，中心稍微上移
  const SMILE_W = 18 * SCALE;
  const SMILE_H = 8 * SCALE;
  const SMILE_CY = EYE_CY - 5 * SCALE; // 比竖眼高一点

  // opacity 交叉淡入淡出
  const straightEyeOpacity = smile.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] });
  const smileEyeOpacity = smile.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] });

  // wander
  useEffect(() => {
    let cancelled = false;
    const wander = () => {
      if (cancelled) return;
      // 加大幅度 + 速度加快，方向有规律（左上/右上/左下/右下，更灵动）
      const dir = Math.floor(Math.random() * 4);
      const ampX = (14 + Math.random() * 8) * SCALE;
      const ampY = (16 + Math.random() * 10) * SCALE;
      const dur = 250 + Math.random() * 380;
      Animated.parallel([
        Animated.timing(lookX, { toValue: (dir === 0 || dir === 2 ? -1 : 1) * ampX * (0.85 + Math.random()*0.3), duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(lookY, { toValue: (dir === 0 || dir === 1 ? -1 : 1) * ampY * (0.85 + Math.random()*0.3), duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(() => setTimeout(wander, dur * 0.15));
    };
    wander();
    return () => { cancelled = true; };
  }, []);

  // 眨眼（笑时不眨）
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const delay = 1800 + Math.random() * 2200;
      const doBlink = () => {
        if (cancelled || smiling) { schedule(); return; }
        Animated.sequence([
          Animated.timing(blinkY, { toValue: 0.05, duration: 55, useNativeDriver: true }),
          Animated.timing(blinkY, { toValue: 1, duration: 55, useNativeDriver: true }),
        ]).start(() => schedule());
      };
      setTimeout(doBlink, delay);
    };
    schedule();
    return () => { cancelled = true; };
  }, [smiling]);

  // 定时触发笑
  useEffect(() => {
    const t = setInterval(() => {
      if (smiling) return;
      setSmiling(true);
      Animated.timing(smile, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      setTimeout(() => {
        Animated.timing(smile, { toValue: 0, duration: 280, useNativeDriver: true }).start();
        setSmiling(false);
      }, 850);
    }, 6000 + Math.random() * 4000);
    return () => clearInterval(t);
  }, [smiling]);

  return (
    <View style={{ width: size, height: size }}>
      {/* 身体 —— 用 design token 颜色 */}
      <Svg viewBox="0 0 200 200" width={size} height={size}>
        <Defs>
          <RadialGradient id="tabBotBody" cx="35%" cy="28%" r="75%">
            <Stop offset="0%" stopColor={theme.colors.accent1} />
            <Stop offset="60%" stopColor={theme.colors.accentSolid} />
            <Stop offset="100%" stopColor={theme.colors.accentSolid} />
          </RadialGradient>
        </Defs>
        <Circle cx={100} cy={100} r={82} fill="url(#tabBotBody)" />
      </Svg>

      {/* ========== 竖长眼睛（正常态） ========== */}
      {/* 左眼 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: EYE_W / 2,
          left: EYE_LX - EYE_W / 2,
          top: EYE_CY - EYE_H / 2,
          width: EYE_W,
          height: EYE_H,
          opacity: straightEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
            { scaleY: blinkY },
          ],
        }}
      />
      {/* 右眼 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: EYE_W / 2,
          left: EYE_RX - EYE_W / 2,
          top: EYE_CY - EYE_H / 2,
          width: EYE_W,
          height: EYE_H,
          opacity: straightEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
            { scaleY: blinkY },
          ],
        }}
      />

      {/* ========== 笑眼（扁椭圆眯缝态） ========== */}
      {/* 左眼笑 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: SMILE_W / 2,
          left: EYE_LX - SMILE_W / 2,
          top: SMILE_CY - SMILE_H / 2,
          width: SMILE_W,
          height: SMILE_H,
          opacity: smileEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
          ],
        }}
      />
      {/* 右眼笑 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: SMILE_W / 2,
          left: EYE_RX - SMILE_W / 2,
          top: SMILE_CY - SMILE_H / 2,
          width: SMILE_W,
          height: SMILE_H,
          opacity: smileEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
          ],
        }}
      />
    </View>
  );
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { open, close } = useVoiceTrigger();
  const voiceStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressing = useRef(false);
  const marginBottom = theme.sp(2);

  const handleVoicePressIn = () => {
    voiceStartTimer.current = setTimeout(() => {
      isLongPressing.current = true;
      open((text) => {
        const parentNav = (navigation as any).getParent?.() ?? navigation;
        parentNav.navigate('Main', { screen: 'Focus', params: { autoOpen: text } });
      });
    }, 300);
  };

  const handleVoicePressOut = () => {
    if (voiceStartTimer.current) {
      clearTimeout(voiceStartTimer.current);
      voiceStartTimer.current = null;
    }
    if (isLongPressing.current) {
      close();
      isLongPressing.current = false;
    }
  };

  const handlePress = (route: any, focused: boolean) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  const voiceIdx = state.routes.findIndex((r) => r.name === VOICE_ROUTE);
  const voiceFocused = state.index === voiceIdx;
  const botSize = theme.layout.tabCenterSize;

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      <View style={styles.leftCard}>
        {state.routes.map((route, idx) => {
          if (!LEFT_ROUTES.includes(route.name)) return null;
          const focused = state.index === idx;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => handlePress(route, focused)}
              style={styles.item}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
            >
              <Icon
                name={TAB_ICON[route.name] ?? 'home'}
                size={theme.fs(26)}
                color={focused ? theme.colors.textNavOn : theme.colors.textNavIdle}
                strokeWidth={2}
              />
              {focused ? <View style={styles.dot} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        onPress={() => handlePress(state.routes[voiceIdx], voiceFocused)}
        onPressIn={handleVoicePressIn}
        onPressOut={handleVoicePressOut}
        delayPressIn={0}
        activeOpacity={0.9}
        style={[styles.botBtn, { width: botSize, height: botSize }]}
        accessibilityRole="button"
        accessibilityLabel="Mira Bot — 长按说话"
      >
        <AnimatedBotFace size={botSize} focused={voiceFocused} />
        {voiceFocused ? <View style={styles.voiceDot} /> : null}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: theme.layout.tabBarHeight + theme.sp(4),
  },
  leftCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: theme.layout.tabBarHeight,
    backgroundColor: theme.colors.ui.tabBar,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.space.sm,
    marginRight: theme.sp(2),
    ...theme.shadow.nav,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(0.5) },
  dot: {
    position: 'absolute',
    bottom: theme.sp(-1),
    left: '50%',
    width: theme.sp(1),
    height: theme.sp(1),
    marginLeft: -theme.sp(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.textNavOn,
  },
  botBtn: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.layout.tabBarHeight / 2 - theme.layout.tabCenterSize / 2,
    ...theme.shadow.center,
  },
  voiceDot: {
    position: 'absolute',
    bottom: -theme.sp(0.5),
    left: '50%',
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    marginLeft: -theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
  },
});
