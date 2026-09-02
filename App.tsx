import React from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './src/theme/theme';
import { AppStateProvider } from './src/state/AppState';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';

// 关键修复：react-navigation 默认主题会给导航容器涂一层浅灰背景
// (background: 'rgb(242,242,242)')，盖住根渐变。改成透明让根背景透出来。
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
  },
};

const styles = StyleSheet.create({
  // 实色兜底：即使渐变组件偶发不渲染，也是紫色而非灰白
  root: { flex: 1, backgroundColor: theme.colors.bgTop },
  // 渐变用绝对定位铺满，不依赖 flex 链，Web / 原生都稳
  gradient: { ...StyleSheet.absoluteFillObject },
});

export default function App() {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={styles.gradient}
      >
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <SafeAreaProvider>
          <AppStateProvider>
            <NavigationContainer theme={navTheme}>
              <ErrorBoundary>
                <RootStackNavigator />
              </ErrorBoundary>
            </NavigationContainer>
          </AppStateProvider>
        </SafeAreaProvider>
      </LinearGradient>
    </View>
  );
}
