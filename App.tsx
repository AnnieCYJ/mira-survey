import React from 'react';
import { StatusBar, View, StyleSheet, Linking } from 'react-native';  // LogBox 已注释
import { RingBle } from './src/ble/RingBleManager';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './src/theme/theme';
import { AppStateProvider } from './src/state/AppState';
import AuthGate from './src/AuthGate';
import ErrorBoundary, { reportGlobalError } from './src/components/ErrorBoundary';
import { postLog } from './src/lib/logger';
import { VoiceTriggerProvider } from './src/hooks/useVoiceTrigger';
import VoiceQuickOverlay from './src/components/VoiceQuickOverlay';
import { warmupModel } from './src/ai/model'; // ★ 2026-11-08 恢复：newArchEnabled=true 已开启，
//   llama.rn codegen 库（libreact_codegen_RNLlamaSpec.so 等）已确认打入 APK（295 个 .so），
//   旧注释「需新架构与 false 冲突」的前提已不成立。AI 伴侣不再依赖云端 cloudAsk。
// import SyncProgressBanner from './src/components/SyncProgressBanner';  // ★ 临时注释
import { enableFreeze } from 'react-native-screens';

// ★ 2026-11-08 决定性检验：确认真机 bundle 是否为最新代码
console.log('[BOOT-CHECK] App.tsx 顶层执行, warmupModel type =', typeof warmupModel);

// ★ 性能：开启 react-native-screens 的「冻结」能力，让 React Navigation 的
//   freezeOnBlur（见 BottomTabNavigator）真正生效 —— 失焦的 Tab 停止重渲染。
//   否则切 Tab 后旧 Tab 仍在后台订阅 BLE / healthStore 并反复重渲染 → 点击卡顿。
enableFreeze(true);

// ★ 2026-11-12：移除「App 启动即预热端侧模型」。登录页用不到 AI，且 initLlama 在
//   冷启动路径上有已知 EXC_BAD_ACCESS 白屏风险（见 model.ts）。模型改为进入 AI 界面时
//   懒加载（FoodScanScreen 等已在挂载时调用 warmupModel），功能不受影响，启动更稳。

// ★ 全局未捕获错误兜底（2026-11-12 改为全量生效，原仅 __DEV__）：
//   捕捉 Promise 回调 / 原生事件回调里抛出的异步致命 JS 错误——这类错误 ErrorBoundary
//   渲染期捕获不到，会导致整棵 React 树被卸载、露出底层蓝底（蓝屏）。
//   现在统一上报日志，并驱动最外层 ErrorBoundary 显示「页面出错了 + 原因」而非静默蓝屏。
//   开发环境下额外保留 RN 默认红屏（prev），便于调试；生产环境仅显示我们的错误 UI。
{
  const g = globalThis as any;
  if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === 'function') {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((err: any, isFatal?: boolean) => {
      try {
        const msg = err && err.message ? err.message : String(err);
        const stack = err && err.stack ? err.stack : '';
        postLog('GLOBAL_ERR', `[${msg}]${isFatal ? ' (FATAL)' : ''}\n${stack}`);
        const e = err instanceof Error ? err : new Error(msg);
        reportGlobalError(e);
      } catch { /* 静默 */ }
      if (__DEV__ && typeof prev === 'function') {
        try { prev(err, isFatal); } catch { /* 静默 */ }
      }
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

/**
 * ★ 隐藏调试深链：强制连接指定戒指（不改秒连逻辑，仅验证用）。
 *   adb shell am start -a android.intent.action.VIEW \
 *     -d "miraringfashion://ring/connect?mac=41:42:14:AE:49:C9"
 * 只有命中白名单 MAC 才动作；先断开当前戒指，再强制连目标。
 * 连上后 App 自身的「记住上次那枚」会把后续秒连指向这枚戒指。
 */
const FORCE_CONNECT_ALLOWLIST = ['41:42:14:AE:49:C9', 'F0:77:5D:ED:A8:5B'];

function useForceConnectDeepLink() {
  React.useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      try {
        const u = new URL(url);
        const isConnect =
          u.pathname.replace(/^\/+/, '').toLowerCase().endsWith('connect') ||
          u.searchParams.get('action')?.toLowerCase() === 'connect';
        const raw = (u.searchParams.get('mac') || '').trim().toUpperCase();
        if (!isConnect || !FORCE_CONNECT_ALLOWLIST.includes(raw)) return;
        postLog('FORCE-CONNECT', `深链强制连接目标 ${raw}`);
        // 断开当前连接会置 userStoppedLink=true 停掉保活；随后 connectToId 会恢复，
        // 并把 knownMac/activeDeviceKey 切到目标 MAC，后续秒连自然指向它。
        (async () => {
          try {
            if (RingBle.getState().status === 'connected') {
              await RingBle.disconnect();
              await new Promise((r) => setTimeout(r, 600));
            }
            await RingBle.connectToId(raw);
            postLog('FORCE-CONNECT', `已发起连接 ${raw}`);
          } catch (e) {
            postLog('FORCE-CONNECT', `连接失败：${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      } catch { /* 非法 URL 忽略 */ }
    };
    let sub: { remove: () => void } | null = null;
    try {
      Linking.getInitialURL().then(handle).catch(() => {});
      sub = Linking.addEventListener('url', (e) => handle(e.url));
    } catch { /* 不支持深链时静默 */ }
    return () => { try { sub?.remove(); } catch { /* noop */ } };
  }, []);
}

export default function App() {
  useForceConnectDeepLink();
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={styles.gradient}
      >
        {/* ★ mira-ocean（2026-10-17）：全分支深底，状态栏恒亮 */}
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {/* ★ 2026-11-12：把 ErrorBoundary 提到最外层，覆盖 SafeAreaProvider / 各 Provider /
            NavigationContainer。任何渲染期 JS 异常都会显示「页面出错了+重试」而非整页空白，
            避免用户看到无内容的深蓝渐变却无从排查。原生崩溃仍不可捕获（需看 logcat）。 */}
        <ErrorBoundary>
          <SafeAreaProvider>
            <AppStateProvider>
              <NavigationContainer theme={navTheme}>
                <VoiceTriggerProvider>
                  {/* ★ 登录门禁：未登录→Login，未填资料→Onboarding，否则→主页 */}
                  <AuthGate />
                  <VoiceQuickOverlay />
                </VoiceTriggerProvider>
              </NavigationContainer>
              {/* 全局底部「正在同步数据 x%」浮层：绝对定位覆盖在导航之上；
                  pointerEvents="none" 保证纯展示、不拦截任何触摸。 */}
              {/* <SyncProgressBanner />  ★ 临时注释排查白闪 */}
            </AppStateProvider>
          </SafeAreaProvider>
        </ErrorBoundary>
      </LinearGradient>
    </View>
  );
}
