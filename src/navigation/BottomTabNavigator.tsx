import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import CustomTabBar from '../components/CustomTabBar';
import TodayScreen from '../screens/TodayScreen';
// ★ Calm 式海浪首页真机预览（2026-10-17）：改回 false 即恢复原 TodayScreen
import CalmWaveHome from '../components/CalmWaveHome';
const USE_CALM_WAVE_HOME = true;
import InsightScreen from '../screens/InsightScreen';
import MeditationScreen from '../screens/MeditationScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MiraAIHomeScreen from '../screens/MiraAIHomeScreen';

export type TabParamList = {
  Today: undefined;
  /** ★ 2026-11-05：首页建议胶囊可直达「身体指标 → 一键体检」子 tab；
   *  t 为每次点击的 nonce，保证重复点击也能重新落到 quickcheck（参数不变时 effect 不会重跑）。 */
  Insight: { subTab?: string; t?: number } | undefined;
  Meditation: undefined;
  Profile: undefined;
  /** Mira AI 首页（点击 tab bar 中间 bot 进入；CustomTabBar 里隐藏图标） */
  MiraAI: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function BottomTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      sceneContainerStyle={{ backgroundColor: 'transparent' }}
      screenOptions={{
        headerShown: false,
        // ★ 2026-10-14 回退：恢复 lazy:true（访问时才挂载），避免 5 个重页面在
        //   离线数据加载前就全部挂载 → 切到首页时趋势图/卡片要等数据回填才显示。
        //   freezeOnBlur 仍冻结后台页，省资源且不卸载（不会丢失已渲染状态）。
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tab.Screen name="Today" component={USE_CALM_WAVE_HOME ? CalmWaveHome : TodayScreen} />
      <Tab.Screen name="Insight" component={InsightScreen} />
      <Tab.Screen name="Meditation" component={MeditationScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="MiraAI" component={MiraAIHomeScreen} />
    </Tab.Navigator>
  );
}
