import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon, { type IconName } from './Icon';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Focus: 'orb',
  Meditation: 'tools',
  Profile: 'calendar',
};
const CENTER_ROUTE = 'Focus';

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  // 胶囊贴底但完整可见，底部只留 8pt 小边
  const marginBottom = theme.sp(2);

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      {state.routes.map((route, idx) => {
        const focused = state.index === idx;
        const center = route.name === CENTER_ROUTE;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (center) {
          return (
            <View key={route.key} style={styles.centerSlot}>
              <TouchableOpacity
                onPress={onPress}
                activeOpacity={0.85}
                style={styles.centerBtn}
                accessibilityRole="button"
                accessibilityLabel="Mira AI"
              >
                <LinearGradient
                  colors={[theme.colors.accent1, theme.colors.accent2]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.centerGrad}
                >
                  <Icon name="orb" size={theme.fs(28)} color={theme.colors.textWhite} strokeWidth={2} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
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
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.sm,
    height: theme.layout.tabBarHeight,
    backgroundColor: theme.colors.ui.tabBar,
    borderRadius: theme.radius.card,
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
  centerSlot: { width: theme.layout.tabCenterSize + theme.space.sm, alignItems: 'center' },
  centerBtn: {
    width: theme.layout.tabCenterSize,
    height: theme.layout.tabCenterSize,
    marginTop: -theme.sp(4),
    borderRadius: theme.radius.pill,
    ...theme.shadow.center,
  },
  centerGrad: {
    flex: 1,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
