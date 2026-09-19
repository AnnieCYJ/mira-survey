import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import CustomTabBar from '../components/CustomTabBar';
import TodayScreen from '../screens/TodayScreen';
import InsightScreen from '../screens/InsightScreen';
import MeditationScreen from '../screens/MeditationScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MiraAIHomeScreen from '../screens/MiraAIHomeScreen';

export type TabParamList = {
  Today: undefined;
  Insight: undefined;
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
      screenOptions={{
        headerShown: false,
        sceneContainerStyle: { backgroundColor: 'transparent' },
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Insight" component={InsightScreen} />
      <Tab.Screen name="Meditation" component={MeditationScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="MiraAI" component={MiraAIHomeScreen} />
    </Tab.Navigator>
  );
}
