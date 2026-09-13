import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import BottomTabNavigator from './BottomTabNavigator';
import SettingsScreen from '../screens/SettingsScreen';
import MetricDetailScreen from '../screens/MetricDetailScreen';
import BodyCompositionHistoryScreen from '../screens/BodyCompositionHistoryScreen';
import CycleCalendarScreen from '../screens/CycleCalendarScreen';
import StatusTrendDetailScreen from '../screens/StatusTrendDetailScreen';
import SleepDetailScreen from '../screens/SleepDetailScreen';
import BpDetailScreen from '../screens/BpDetailScreen';
import EcgDetailScreen from '../screens/EcgDetailScreen';
import EnergyDetailScreen from '../screens/EnergyDetailScreen';
import EmotionCognitiveDetailScreen from '../screens/EmotionCognitiveDetailScreen';

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
  Settings: undefined;
  MetricDetail: MetricDetailParams;
  BodyCompositionHistory: undefined;
  CycleCalendar: undefined;
  StatusTrendDetail: undefined;
  SleepDetail: undefined;
  BpDetail: undefined;
  EcgDetail: undefined;
  EnergyDetail: { type: "emotion" | "cognitive" | "activity" };
  EmotionCognitiveDetail: undefined;
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
          cardStyle: { backgroundColor: 'transparent' },
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
          cardStyle: { backgroundColor: 'transparent' },
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
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen
        name="BodyCompositionHistory"
        component={BodyCompositionHistoryScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen name="SleepDetail" component={SleepDetailScreen} />
      <Stack.Screen
        name="EcgDetail"
        component={EcgDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen
        name="BpDetail"
        component={BpDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen
        name="EnergyDetail"
        component={EnergyDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen
        name="EmotionCognitiveDetail"
        component={EmotionCognitiveDetailScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ cardStyle: { backgroundColor: "transparent" } }} />

    </Stack.Navigator>
  );
}
