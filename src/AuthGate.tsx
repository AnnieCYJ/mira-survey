/**
 * AuthGate —— 应用入口的登录门禁（在 SafeAreaProvider 内、RootStackNavigator 之前）
 * ---------------------------------------------------------------------------
 * 路由规则：
 *   · 未就绪（读取本地会话中）→ 启动页 Splash
 *   · 未登录 → LoginScreen
 *   · 已登录但未完成首次资料 → OnboardingScreen（AI 问答）
 *   · 已登录且资料完成 → RootStackNavigator（主页）
 *
 * 登录 / 资料收集由本地 userStore 驱动；接入云端账号体系后，仅 userStore 内部变化，
 * 本文件与两个 Screen 的调用方式不变。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { theme } from './theme/theme';
import { userStore, onSessionChange } from './data/userStore';
import LoginScreen from './screens/LoginScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import RingConnectScreen from './screens/RingConnectScreen';
import RootStackNavigator from './navigation/RootStackNavigator';

export default function AuthGate() {
  const [ready, setReady] = useState(false);
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [session, setSession] = useState({ loggedIn: false, onboardingDone: false, ringSetupDone: false });
  // ★ 2026-11-07（用户「Luna Mira 要手写体」）：内嵌 Caveat 手写字体。
  //   之前 fontFamily:'Bradley Hand' 是 iOS 独有字体，Android 上回落默认字体 → 手写体不生效。
  const [fontsLoaded] = useFonts({
    Caveat: require('../assets/fonts/Caveat_400Regular.ttf'),
  });

  // ★ 2026-11-04：保证手写 "Luna Mira" 启动动画每次冷启动都看得清，最短展示 2400ms
  useEffect(() => {
    const t = setTimeout(() => setSplashMinDone(true), 2400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    userStore.loadSession().then((s) => {
      if (!alive) return;
      setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone, ringSetupDone: !!s.ringSetupDone });
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 响应 signOut / resetAll 等会话变更，即时回落到对应页面
  useEffect(() => {
    return onSessionChange(() => {
      userStore.loadSession().then((s) =>
        setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone, ringSetupDone: !!s.ringSetupDone }),
      );
    });
  }, []);

  // ★ 2026-11-26 本地真机验证用隐藏深链：miraringfashion://dev/login
  //   仅重建一个已登录+已完成引导的本地会话，跳过登录页，方便验证首页背景。
  //   不影响正常用户（需手动 adb 发深链才会触发）。
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      try {
        // miraringfashion://dev/login → host='dev', pathname='/login'
        const u = new URL(url);
        if (u.host.toLowerCase() !== 'dev' || u.pathname.replace(/^\/+/, '').toLowerCase() !== 'login') return;
        void (async () => {
          await userStore.register('13900000000', '本地验证', 'devonly');
          await userStore.completeOnboarding({});
          await userStore.completeRingSetup();
          const s = await userStore.loadSession();
          setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone, ringSetupDone: !!s.ringSetupDone });
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

  const refresh = () => {
    userStore.loadSession().then((s) =>
      setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone, ringSetupDone: !!s.ringSetupDone }),
    );
  };

  if (!ready || !splashMinDone) return <Splash fontsLoaded={fontsLoaded} />;
  if (!session.loggedIn) return <LoginScreen onAuthenticated={refresh} />;
  if (!session.onboardingDone) return <OnboardingScreen onDone={refresh} />;
  // ★ 2026-11-07（用户）：资料收集完成后、进主页前，先过「连接戒指」引导页
  if (!session.ringSetupDone) return <RingConnectScreen onDone={refresh} />;
  return <RootStackNavigator />;
}

function Splash({ fontsLoaded }: { fontsLoaded: boolean }) {
  return (
    <View style={s.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.center}>
        {/* ★ 2026-11-04：去掉紫色圆点 + "Mira"，改为手写体 "Luna Mira" 逐字显现动画
            ★ 2026-11-07：真手写字体 Caveat（Android/iOS 通用），字体加载完成后才开始逐字动画 */}
        {fontsLoaded ? <Handwritten text="Luna Mira" style={s.word} /> : null}
      </View>
    </View>
  );
}

/** ★ 手写体逐字显现：每个字母依次淡入 + 上移 + 轻微放大，像被手写出来。 */
function Handwritten({ text, style }: { text: string; style?: any }) {
  const letters = Array.from(text);
  const anims = React.useRef(letters.map(() => new Animated.Value(0))).current;
  React.useEffect(() => {
    Animated.stagger(
      85,
      anims.map((a) =>
        Animated.timing(a, {
          toValue: 1,
          duration: 430,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ),
    ).start();
  }, [anims]);
  return (
    <View style={{ flexDirection: 'row' }}>
      {letters.map((ch, i) => (
        <Animated.Text
          key={i}
          style={[
            style,
            {
              opacity: anims[i],
              transform: [
                { translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                { scale: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
              ],
            },
          ]}
        >
          {ch === ' ' ? ' ' : ch}
        </Animated.Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgBottom },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  word: {
    // ★ 2026-11-07（用户「要手写体」）：Caveat = Google Fonts 手写体，iOS/Android 双端内嵌生效。
    //   Caveat x-height 偏小，字号放大 ~1.6 倍才与原视觉等高；不用 fontWeight（合成粗体会糊）。
    fontSize: theme.fontSize.h1 * 1.6,
    color: theme.colors.textTitle,
    letterSpacing: 1,
    marginTop: theme.space.sm,
    fontFamily: 'Caveat',
  },
});
