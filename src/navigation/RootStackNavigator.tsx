import React from 'react';
// ★ 2026-10-08 交互优化（A2）：JS createStackNavigator → createNativeStackNavigator。
//   转场与侧滑返回由 iOS 原生驱动，不再跑 JS interpolator（CardStyleInterpolators 在
//   native stack 下不可用，默认转场即原生横滑，且更跟手）。
// ★ 同步配合 A1：所有推入页由 transparent 改为不透明实底——
//   转场期间不再合成背后 1971 行的 TodayScreen（VoiceChat 此前已验证该改法「更丝滑」）。
//   ★ mira-ocean（2026-10-17）：主题由白底改深海，不透明底色由 cardBg 改 bgBottom 深蓝紫实底，
//   页面内部卡片走玻璃 token（mm.colors.cardBg = 白 13%），转场不合成下层、深底统一。
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import HealthAgeDetailScreen from '../screens/HealthAgeDetailScreen';
import CardioDetailScreen from '../screens/CardioDetailScreen';
import EnergyDetailScreen from '../screens/EnergyDetailScreen';
import EmotionCognitiveDetailScreen from '../screens/EmotionCognitiveDetailScreen';
import StressRecoveryDetailScreen from '../screens/StressRecoveryDetailScreen';
import BreathingScreen from '../screens/BreathingScreen';
import FoodScanScreen from '../screens/FoodScanScreen';
import VoiceChatScreen from '../screens/VoiceChatScreen';
import EmotionLogScreen from '../screens/EmotionLogScreen';
import ToolTopicScreen from '../screens/ToolTopicScreen';
import LearnReadScreen from '../screens/LearnReadScreen';
import {
  EmotionInterveneHome,
} from '../screens/EmotionInterveneScreen';
import AccountHubScreen from '../screens/AccountHubScreen';
import MemberDetailScreen from '../screens/MemberDetailScreen';
import BindingRitualScreen from '../screens/BindingRitualScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import QuickCheckHistoryScreen from '../screens/QuickCheckHistoryScreen';
import QuickCheckDetailScreen from '../screens/QuickCheckDetailScreen';
import type { Relationship } from '../data/familyStore';

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
  StressRecoveryDetail: undefined;
  HealthAgeDetail: undefined;
  CardioDetail: undefined;
  EmotionLog: undefined;
  EmotionIntervene: undefined;
  Breathing: undefined;
  AccountHub: undefined;
  MemberDetail: { memberId: string };
  BindingRitual: { relationship: Relationship; name: string; memberId?: string };
  PrivacyPolicy: undefined;
  FoodScan: { autoCamera?: boolean } | undefined;
  ToolTopic: { topic: 'glow' | 'sport' | 'learn' | 'nutrition' | 'sportArticles' };
  LearnRead: { articleId: string; collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition' };
  VoiceChat: { question: string };
  QuickCheckHistory: undefined;
  QuickCheckDetail: { recordId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* 底层 tab 容器保持透明：App.tsx 根渐变直接透出（它是最底层，无合成开销）。
          ★ native stack 默认 contentStyle 是系统色，必须显式 transparent 才不会挡住根渐变 */}
      <Stack.Screen
        name="Main"
        component={BottomTabNavigator}
        options={{ contentStyle: { backgroundColor: 'transparent' } }}
      />
      <Stack.Screen
        name="VoiceChat"
        component={VoiceChatScreen}
        options={{
          contentStyle: { backgroundColor: theme.colors.bgBottom },
        }}
      />
      <Stack.Screen
        name="MetricDetail"
        component={MetricDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="CycleCalendar"
        component={CycleCalendarScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="StatusTrendDetail"
        component={StatusTrendDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="BodyCompositionHistory"
        component={BodyCompositionHistoryScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen name="SleepDetail" component={SleepDetailScreen} options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }} />
      <Stack.Screen
        name="EcgDetail"
        component={EcgDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="BpDetail"
        component={BpDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="EnergyDetail"
        component={EnergyDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="EmotionCognitiveDetail"
        component={EmotionCognitiveDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="StressRecoveryDetail"
        component={StressRecoveryDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="HealthAgeDetail"
        component={HealthAgeDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="CardioDetail"
        component={CardioDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="EmotionLog"
        component={EmotionLogScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      {/* 情绪干预四方案（工具页「情绪调节」入口）：该屏 ScreenContainer 自带 cardBg 实底 */}
      <Stack.Screen
        name="EmotionIntervene"
        component={EmotionInterveneHome}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="Breathing"
        component={BreathingScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      {/* FoodScan 自铺 textWhite 实底渐变（不包 ScreenContainer，底栏要钉住） */}
      <Stack.Screen
        name="FoodScan"
        component={FoodScanScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="ToolTopic"
        component={ToolTopicScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="LearnRead"
        component={LearnReadScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }} />
      {/* ★ 2026-10-19 账户 / 家庭绑定：账户中枢 + 家人详情 + 绑定仪式 */}
      <Stack.Screen name="AccountHub" component={AccountHubScreen} options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }} />
      <Stack.Screen name="MemberDetail" component={MemberDetailScreen} options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }} />
      <Stack.Screen name="BindingRitual" component={BindingRitualScreen} options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }} />
      {/* ★ Phase 0（P0 合规）：隐私政策与开源致谢（含 CBT-Copilot Apache-2.0 归属） */}
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ contentStyle: { backgroundColor: theme.colors.textWhite } }} />
      {/* ★ 2026-10-26：「一键体检」体检记录列表 / 微体检报告详情（独立全屏页，非洞察页内切换） */}
      <Stack.Screen
        name="QuickCheckHistory"
        component={QuickCheckHistoryScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
      <Stack.Screen
        name="QuickCheckDetail"
        component={QuickCheckDetailScreen}
        options={{ contentStyle: { backgroundColor: theme.colors.bgBottom } }}
      />
    </Stack.Navigator>
  );
}
