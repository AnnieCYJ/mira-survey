import React, { useRef, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon, { type IconName } from './Icon';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Meditation: 'tools',
  Profile: 'calendar',
  __voice__: 'orb',
};
const TAB_LABEL: Record<string, string> = { Today: '今日', Insight: '洞察', Meditation: '工具', Profile: '我的' };
const VOICE_ROUTE = '__voice__'; // 虚拟路由, 不对应真实 tab
const LEFT_ROUTES = ['Today', 'Insight', 'Meditation', 'Profile'];
/** 真实存在但不渲染图标的 tab：
 *   · MiraAI 由中间 bot 按钮触发进入（★ 2026-11-05：bot 已按用户要求隐藏，故 MiraAI 不再从 tab 进入）
 *   · Meditation（工具）按用户要求隐藏 tab 入口（路由保留，避免深层跳转报错） */
const HIDDEN_ROUTES = ['MiraAI', 'Meditation'];

/** ★ 2026-11-05（用户：「那个白色的 grok，直接改成 lunamira 吧，不要 grok 了」）
 *  底栏 bot 原本是一张会眨眼/微笑的白色圆脸（内部代号 GROK）；现统一为 lunamira 品牌字标。
 *  按压缩放动画由外层 botScale 提供，不再需要眼睛动画。
 */
// ★ 丝滑化：左侧 tab 选中项加 spring pop 缩放（选中放大一点，切走回弹），让选中标更"活"
function TabItem({ route, focused, onPress }: { route: any; focused: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1.12 : 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [focused, scale]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.item}
      activeOpacity={theme.press.opacity}
      accessibilityRole="tab"
      accessibilityLabel={TAB_LABEL[route.name] ?? route.name}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
    >
      {/* v10 选中态：★ 2026-11-03(2) 修正 —— 用户要的是「图标本身变白」，不是整圈白底。
          故去掉白色圆底（itemCircleOn 不再填白），选中图标转纯白高亮、未选半透明白。 */}
      {/* ★ 2026-10-10（用户）：去掉「今日/洞察/工具/我的」文字，只留图标；图标稍大（22→25） */}
      <Animated.View style={[styles.itemCircle, { transform: [{ scale }] }]}>
        <Icon
          name={TAB_ICON[route.name] ?? 'home'}
          size={theme.fs(26)}
          color={focused ? '#FFFFFF' : 'rgba(255,255,255,0.5)'}
          strokeWidth={2}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  // ★ 2026-11-05（用户：隐藏右侧 LumaMira AI 入口 / bot 按钮；隐藏「工具」tab；剩余 tab 居中）
  // ★ 2026-11-03（用户：tab 不用那么低，稍微往上一点点）：4 → 10 —— 悬浮 tab 胶囊略上浮、底部留白更多。
  const marginBottom = 10;

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

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      <View style={styles.leftCard}>
        {state.routes.map((route, idx) => {
          if (route.name === VOICE_ROUTE || HIDDEN_ROUTES.includes(route.name)) return null;
          const focused = state.index === idx;
          return (
            <TabItem
              key={route.key}
              route={route}
              focused={focused}
              onPress={() => handlePress(route, focused)}
            />
          );
        })}
      </View>
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
    justifyContent: 'center',
    height: theme.layout.tabBarHeight,
  },
  leftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.sp(9),
    alignSelf: 'center',
    height: theme.layout.tabBarHeight,
    // ★ 2026-11-03（用户：tab 也要玻璃质感，对齐首页磨砂卡）：半透明白玻璃 + 白描边，
    //   图标保持深色（ink）在白玻璃上清晰可读；适度不透明避免滚动时内容过度透出。
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    // ★ 必须用 pill：高度 = tabBarHeight(56)，pill(999) 会解析成半高 28 → 完整胶囊。
    //   原先写 radius.card 时 card 恰好是 28 才碰巧是胶囊；2026-09-20 把 card 收紧到 14 后就退化成圆角矩形了。
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    ...theme.shadow.nav,
  },
  // ★ 2026-10-15（用户定稿 V1 去紫）：选中描边由 purpleDeep 改墨色
  botSelected: { borderWidth: 2, borderColor: mm.colors.ink },
  item: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(0.5) },
  // v10：选中项 = 42px 圆底（SPEC §2 #13），不再用小圆点
  // ★ 2026-10-10：文字标签移除，圆底随之放大（24→30→36，用户："绿色背景圈大一点"），icon 居中
  itemCircle: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botBtn: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.layout.tabBarHeight / 2 - theme.layout.tabCenterSize / 2,
    // ★ 2026-10-15：去掉黑色投影（用户：背景黑阴影去掉）
    shadowOpacity: 0,
    elevation: 0,
  },
  voiceDot: {
    position: 'absolute',
    bottom: -theme.sp(0.5),
    left: '50%',
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    marginLeft: -theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.ink,
  },
});
