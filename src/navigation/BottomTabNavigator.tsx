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
    <Tab.Navigator tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Insight" component={InsightScreen} />
      <Tab.Screen name="Focus" component={FocusScreen} />
      <Tab.Screen name="Meditation" component={MeditationScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
