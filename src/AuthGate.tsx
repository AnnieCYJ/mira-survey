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
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './theme/theme';
import { userStore, onSessionChange } from './data/userStore';
import LoginScreen from './screens/LoginScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import RootStackNavigator from './navigation/RootStackNavigator';

export default function AuthGate() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState({ loggedIn: false, onboardingDone: false });

  useEffect(() => {
    let alive = true;
    userStore.loadSession().then((s) => {
      if (!alive) return;
      setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone });
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
        setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone }),
      );
    });
  }, []);

  const refresh = () => {
    userStore.loadSession().then((s) =>
      setSession({ loggedIn: s.loggedIn, onboardingDone: s.onboardingDone }),
    );
  };

  if (!ready) return <Splash />;
  if (!session.loggedIn) return <LoginScreen onAuthenticated={refresh} />;
  if (!session.onboardingDone) return <OnboardingScreen onDone={refresh} />;
  return <RootStackNavigator />;
}

function Splash() {
  return (
    <View style={s.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.center}>
        <View style={s.dot} />
        <Text style={s.word}>Mira</Text>
        <ActivityIndicator style={{ marginTop: theme.space.md }} color={theme.colors.accentText} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgBottom },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accentSolid,
    shadowColor: theme.colors.accentSolid,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  word: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    letterSpacing: 1,
    marginTop: theme.space.sm,
  },
});
