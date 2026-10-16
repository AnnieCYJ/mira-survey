import React from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';  // LogBox 已注释
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './src/theme/theme';
import { AppStateProvider } from './src/state/AppState';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import { postLog } from './src/lib/logger';
import { VoiceTriggerProvider } from './src/hooks/useVoiceTrigger';
import VoiceQuickOverlay from './src/components/VoiceQuickOverlay';
import { warmupModel } from './src/ai/model';
// import SyncProgressBanner from './src/components/SyncProgressBanner';  // ★ 临时注释
import { enableFreeze } from 'react-native-screens';

// ★ 性能：开启 react-native-screens 的「冻结」能力，让 React Navigation 的
//   freezeOnBlur（见 BottomTabNavigator）真正生效 —— 失焦的 Tab 停止重渲染。
//   否则切 Tab 后旧 Tab 仍在后台订阅 BLE / healthStore 并反复重渲染 → 点击卡顿。
enableFreeze(true);

// 🔥 App 启动后后台预热端侧模型（不要 await，不阻塞首屏）
warmupModel();

// ★ 全局未捕获错误上报（开发期）：捕捉 React 红屏 / “Maximum update depth” /
// 异步未处理拒绝等 ErrorBoundary 兜不住的致命 JS 错误，POST 到 :8899 收集器，
// 便于真机复现时定位“回退不出去 / 页面卡死”的根因。
if (__DEV__) {
  const g = globalThis as any;
  if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === 'function') {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((err: any, isFatal?: boolean) => {
      try {
        const msg = err && err.message ? err.message : String(err);
        const stack = err && err.stack ? err.stack : '';
        postLog('GLOBAL_ERR', `[${msg}]${isFatal ? ' (FATAL)' : ''}\n${stack}`);
      } catch { /* 静默 */ }
      if (typeof prev === 'function') prev(err, isFatal);
    });
  }
}

// 关键修复：react-navigation 默认主题会给导航容器涂一层浅灰背景
// (background: 'rgb(242,242,242)')，盖住根渐变。改成透明让根背景透出来。

// ★ 抑制 BLE 连接期间「Excessive number of pending callbacks」LogBox 白色遮罩：
//   戒指回传历史数据时原生→JS 回调堆积（backfill 一次性推几千条样本），
//   RN 内部安全机制误报为"回调过多"并弹出白色 LogBox 面板遮挡界面。
//   这是已知良性警告（不影响数据正确性），在开发/生产环境均应屏蔽。
// LogBox.ignoreLogs(['Excessive number of pending callbacks']);  // ★ 临时注释
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
  },
};

const styles = StyleSheet.create({
  // 实色兜底：即使渐变组件偶发不渲染，也是浅灰 #F5F5F7（2026-10-15 用户定稿 V1 去紫，原紫渐变已改浅灰）
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
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <SafeAreaProvider>
          <AppStateProvider>
            <NavigationContainer theme={navTheme}>
              <ErrorBoundary>
                <VoiceTriggerProvider>
                  <RootStackNavigator />
                  <VoiceQuickOverlay />
                </VoiceTriggerProvider>
              </ErrorBoundary>
            </NavigationContainer>
            {/* 全局底部「正在同步数据 x%」浮层：绝对定位覆盖在导航之上；
                pointerEvents="none" 保证纯展示、不拦截任何触摸。 */}
            {/* <SyncProgressBanner />  ★ 临时注释排查白闪 */}
          </AppStateProvider>
        </SafeAreaProvider>
      </LinearGradient>
    </View>
  );
}
