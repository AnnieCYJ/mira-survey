import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import BottomTabNavigator from './BottomTabNavigator';
import ChatScreen from '../screens/ChatScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MetricDetailScreen from '../screens/MetricDetailScreen';
import CycleCalendarScreen from '../screens/CycleCalendarScreen';
import StatusTrendDetailScreen from '../screens/StatusTrendDetailScreen';
import SleepDetailScreen from '../screens/SleepDetailScreen';

export interface MetricDetailParams {
  key: string;
  name: string;
  unit: string;
  yMin: number;
  yMax: number;
  dimension?: string;
  color?: string;
}

export type RootStackParamList = {
  Main: undefined;
  Chat: { initialQuestion?: string };
  Settings: undefined;
  MetricDetail: MetricDetailParams;
  CycleCalendar: undefined;
  StatusTrendDetail: undefined;
  SleepDetail: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={BottomTabNavigator} />
      <Stack.Screen
        name="MetricDetail"
        component={MetricDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: theme.colors.bgBottom },
        }}
      />
      <Stack.Screen
        name="CycleCalendar"
        component={CycleCalendarScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: theme.colors.bgBottom },
        }}
      />
      <Stack.Screen
        name="StatusTrendDetail"
        component={StatusTrendDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: theme.colors.bgBottom },
        }}
      />
      <Stack.Screen name="SleepDetail" component={SleepDetailScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          presentation: 'modal',
          cardStyle: { backgroundColor: 'transparent' },
          cardStyleInterpolator: CardStyleInterpolators.forVerticalIOS,
          gestureEnabled: true,
          gestureDirection: 'vertical',
        }}
      />
    </Stack.Navigator>
  );
}
