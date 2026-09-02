import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import BottomTabNavigator from './BottomTabNavigator';
import ChatScreen from '../screens/ChatScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  Main: undefined;
  Chat: { initialQuestion?: string };
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={BottomTabNavigator} />
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
