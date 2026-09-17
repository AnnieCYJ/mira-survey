import React, { useRef } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon, { type IconName } from './Icon';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Meditation: 'tools',
  Profile: 'calendar',
  Focus: 'orb',
};
const VOICE_ROUTE = 'Focus';
const LEFT_ROUTES = ['Today', 'Insight', 'Meditation', 'Profile'];

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

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      {/* 左：白色圆角卡片，装 4 个 tab */}
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

      {/* 右：独立浮起的 AI Voice orb（没有白色背景！） */}
      <TouchableOpacity
        onPress={() => handlePress(state.routes[voiceIdx], voiceFocused)}
        onPressIn={handleVoicePressIn}
        onPressOut={handleVoicePressOut}
        delayPressIn={0}
        activeOpacity={0.85}
        style={styles.voiceBtn}
        accessibilityRole="button"
        accessibilityLabel="Mira AI — 长按说话"
      >
        <LinearGradient
          colors={[theme.colors.accent1, theme.colors.accent2]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.voiceGrad}
        >
          <Icon name="orb" size={theme.fs(28)} color={theme.colors.textWhite} strokeWidth={2} />
        </LinearGradient>
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
    alignItems: 'flex-end', // orb 底部对齐
    justifyContent: 'space-between',
    height: theme.layout.tabBarHeight + theme.sp(4), // 加 orb 浮起空间
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
  // 右：独立浮起，无白色背景
  voiceBtn: {
    width: theme.layout.tabCenterSize,
    height: theme.layout.tabCenterSize,
    marginBottom: theme.layout.tabBarHeight / 2 - theme.layout.tabCenterSize / 2, // 浮起来，跟左卡中间对
    borderRadius: theme.radius.pill,
    ...theme.shadow.center,
  },
  voiceGrad: {
    flex: 1,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceDot: {
    position: 'absolute',
    bottom: -theme.sp(1),
    left: '50%',
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    marginLeft: -theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
  },
});
