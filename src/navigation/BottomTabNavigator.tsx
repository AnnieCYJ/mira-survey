import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import CustomTabBar from '../components/CustomTabBar';
import TodayScreen from '../screens/TodayScreen';
import InsightScreen from '../screens/InsightScreen';
import MeditationScreen from '../screens/MeditationScreen';
import FocusScreen from '../screens/FocusScreen';
import ProfileScreen from '../screens/ProfileScreen';

export type TabParamList = {
  Today: undefined;
  Insight: undefined;
  Focus: undefined;
  Meditation: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function BottomTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneContainerStyle: { backgroundColor: 'transparent' },
        // ★ 性能：未访问过的 Tab 不预挂载（lazy），失焦的 Tab 冻结渲染（freezeOnBlur，
        //   需配合 App.tsx 的 enableFreeze(true)）。否则 5 个 Tab 常驻挂载、
        //   各自订阅 BLE/healthStore，切 Tab 时互相叠加重渲染 → 卡顿。
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Insight" component={InsightScreen} />
      <Tab.Screen name="Meditation" component={MeditationScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Focus" component={FocusScreen} />
    </Tab.Navigator>
  );
}
