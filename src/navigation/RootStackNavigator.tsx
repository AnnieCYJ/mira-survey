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
import BreathingScreen from '../screens/BreathingScreen';
import FoodScanScreen from '../screens/FoodScanScreen';
import VoiceChatScreen from '../screens/VoiceChatScreen';
import EmotionLogScreen from '../screens/EmotionLogScreen';
import ToolTopicScreen from '../screens/ToolTopicScreen';
import LearnReadScreen from '../screens/LearnReadScreen';
import {
  EmotionInterveneHome,
} from '../screens/EmotionInterveneScreen';

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
  EmotionLog: undefined;
  EmotionIntervene: undefined;
  Breathing: undefined;
  FoodScan: { autoCamera?: boolean } | undefined;
  ToolTopic: { topic: 'glow' | 'sport' | 'learn' | 'nutrition' | 'sportArticles' };
  LearnRead: { articleId: string; collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition' };
  VoiceChat: { question: string };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={BottomTabNavigator} />
      <Stack.Screen
        name="VoiceChat"
        component={VoiceChatScreen}
        options={{
          headerShown: false,
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
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
      <Stack.Screen
        name="EmotionLog"
        component={EmotionLogScreen}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
      {/* 情绪干预四方案（工具页「情绪调节」入口） */}
      <Stack.Screen
        name="EmotionIntervene"
        component={EmotionInterveneHome}
        options={{
          presentation: 'card',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
          cardStyle: { backgroundColor: 'transparent' },
        }}
      />
        <Stack.Screen
          name="Breathing"
          component={BreathingScreen}
          options={{
            presentation: 'card',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
            cardStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="FoodScan"
          component={FoodScanScreen}
          options={{
            presentation: 'card',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
            cardStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="ToolTopic"
          component={ToolTopicScreen}
          options={{
            presentation: 'card',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
            cardStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="LearnRead"
          component={LearnReadScreen}
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
