import React from 'react';
import { StatusBar, View, StyleSheet, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './src/theme/theme';
import { AppStateProvider } from './src/state/AppState';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import SyncProgressBanner from './src/components/SyncProgressBanner';

// 关键修复：react-navigation 默认主题会给导航容器涂一层浅灰背景
// (background: 'rgb(242,242,242)')，盖住根渐变。改成透明让根背景透出来。

// ★ 抑制 BLE 连接期间「Excessive number of pending callbacks」LogBox 白色遮罩：
//   戒指回传历史数据时原生→JS 回调堆积（backfill 一次性推几千条样本），
//   RN 内部安全机制误报为"回调过多"并弹出白色 LogBox 面板遮挡界面。
//   这是已知良性警告（不影响数据正确性），在开发/生产环境均应屏蔽。
LogBox.ignoreLogs(['Excessive number of pending callbacks']);
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
            {/* 全局底部「正在同步数据 x%」浮层：绝对定位覆盖在导航之上；
                pointerEvents="none" 保证纯展示、不拦截任何触摸。 */}
            <SyncProgressBanner />
          </AppStateProvider>
        </SafeAreaProvider>
      </LinearGradient>
    </View>
  );
}
