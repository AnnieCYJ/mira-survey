/**
 * LoginScreen —— 首次登录 / 注册页（mira-ocean 深海玻璃风）
 * ---------------------------------------------------------------------------
 * 字段：手机号 + 账户名 + 密码（注册额外含短信验证码，演示环境用固定演示码）。
 * 交互：顶部「登录 / 注册」分段切换；底部隐私提示。
 * 认证：本地 mock（userStore），后续替换为云端账号体系时调用方零改动。
 *
 * 本页由 App 入口的 AuthGate 在「未登录」时渲染，通过 onAuthenticated 回调切走。
 */
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { userStore, DEMO_CODE } from '../data/userStore';

const PHONE_RE = /^1\d{10}$/;

interface Props {
  onAuthenticated: () => void;
}

type Mode = 'login' | 'register';

export default function LoginScreen({ onAuthenticated }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('');
  const [accountName, setAccountName] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError('');
    Animated.spring(slide, { toValue: m === 'register' ? 1 : 0, useNativeDriver: true }).start();
  };

  const startCountdown = () => {
    setCountdown(60);
    timer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const sendCode = () => {
    if (!PHONE_RE.test(phone)) {
      setError('请输入正确的 11 位手机号');
      return;
    }
    setCodeSent(true);
    startCountdown();
    setError('');
  };

  const submit = async () => {
    setError('');
    if (!PHONE_RE.test(phone)) {
      setError('请输入正确的 11 位手机号');
      return;
    }
    if (!accountName.trim()) {
      setError('请填写账户名');
      return;
    }
    if (mode === 'register') {
      if (!/^\d{6}$/.test(code)) {
        setError('请输入 6 位验证码（演示验证码见下方）');
        return;
      }
      if (pwd.length < 6) {
        setError('密码至少 6 位');
        return;
      }
      setBusy(true);
      const err = await userStore.register(phone, accountName.trim(), pwd);
      setBusy(false);
      if (err) {
        setError(err);
        return;
      }
      onAuthenticated();
      return;
    }
    // login
    if (pwd.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    setBusy(true);
    const err = await userStore.login(phone, pwd);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onAuthenticated();
  };

  return (
    <View style={s.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingTop: insets.top + theme.space.xl, paddingBottom: insets.bottom + theme.space.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 品牌区 */}
          <View style={s.brand}>
            <View style={s.logoDot} />
            <Text style={s.wordmark}>Mira</Text>
            <Text style={s.tagline}>你的身体，自有节奏</Text>
          </View>

          {/* 表单玻璃卡 */}
          <View style={s.card}>
            {/* 分段切换 */}
            <View style={s.segment}>
              <Animated.View
                style={[
                  s.segmentThumb,
                  {
                    transform: [
                      {
                        translateX: slide.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (theme.layout.maxWidth - theme.space.card * 2 - 6) / 2],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <TouchableOpacity style={s.segBtn} activeOpacity={0.8} onPress={() => switchMode('login')}>
                <Text style={[s.segTxt, mode === 'login' && s.segTxtOn]}>登录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.segBtn} activeOpacity={0.8} onPress={() => switchMode('register')}>
                <Text style={[s.segTxt, mode === 'register' && s.segTxtOn]}>注册</Text>
              </TouchableOpacity>
            </View>

            <Field
              icon="phone"
              placeholder="手机号"
              keyboardType="phone-pad"
              maxLength={11}
              value={phone}
              onChange={setPhone}
            />
            <Field
              icon="user"
              placeholder="账户名"
              autoCapitalize="none"
              value={accountName}
              onChange={setAccountName}
            />

            {mode === 'register' && (
              <Field
                icon="shield"
                placeholder="短信验证码"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChange={setCode}
                trailing={
                  <TouchableOpacity
                    style={[s.codeBtn, countdown > 0 && s.codeBtnOff]}
                    activeOpacity={0.8}
                    disabled={countdown > 0}
                    onPress={sendCode}
                  >
                    <Text style={[s.codeTxt, countdown > 0 && s.codeTxtOff]}>
                      {countdown > 0 ? `${countdown}s` : codeSent ? '重新发送' : '获取验证码'}
                    </Text>
                  </TouchableOpacity>
                }
              />
            )}

            <Field
              icon="lock"
              placeholder="密码（至少 6 位）"
              secureTextEntry={!showPwd}
              value={pwd}
              onChange={setPwd}
              trailing={
                <TouchableOpacity style={s.eye} activeOpacity={0.7} onPress={() => setShowPwd((v) => !v)}>
                  <Text style={s.eyeTxt}>{showPwd ? '隐藏' : '显示'}</Text>
                </TouchableOpacity>
              }
            />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.primary, busy && s.primaryOff]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={submit}
            >
              <LinearGradient
                colors={[...theme.colors.aiBadgeGrad]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Text style={s.primaryTxt}>{busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}</Text>
            </TouchableOpacity>

            {mode === 'register' && codeSent && (
              <Text style={s.demoHint}>演示验证码：{DEMO_CODE}（无短信后端，正式版由服务端下发）</Text>
            )}
          </View>

          <Text style={s.privacy}>登录即表示同意《隐私政策》与《用户协议》</Text>
          <Text style={s.footnote}>Mira · 看见 · 理解 · 掌控</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── 输入框（带前置图标 + 可选后置控件）─────────────────────────────────────
function Field({
  icon,
  placeholder,
  value,
  onChange,
  secureTextEntry,
  keyboardType,
  maxLength,
  autoCapitalize,
  trailing,
}: {
  icon: 'phone' | 'user' | 'lock' | 'shield';
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'phone-pad' | 'number-pad' | 'default';
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences';
  trailing?: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <View style={s.fieldIcon}>
        <FieldIcon name={icon} />
      </View>
      <TextInput
        style={s.input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.ui.white55}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        selectionColor={theme.colors.accentText}
      />
      {trailing}
    </View>
  );
}

function FieldIcon({ name }: { name: 'phone' | 'user' | 'lock' | 'shield' }) {
  const c = theme.colors.textSub;
  const common = { fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'phone')
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...common}>
        <Path d="M6.5 3.5h3l1.2 3.5-2 1.3a11 11 0 0 0 4.5 4.5l1.3-2 3.5 1.2v3a2 2 0 0 1-2.2 2A14.5 14.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
      </Svg>
    );
  if (name === 'user')
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...common}>
        <Circle cx={12} cy={8.5} r={3.4} />
        <Path d="M5 20a7 7 0 0 1 14 0" />
      </Svg>
    );
  if (name === 'lock')
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24" {...common}>
        <Path d="M7 11V8a5 5 0 0 1 10 0v3" />
        <Rect x={5.5} y={11} width={13} height={9} rx={2.4} />
      </Svg>
    );
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" {...common}>
      <Path d="M12 3.5 4.5 6.5v4.5c0 4.6 3 8 7.5 9.5 4.5-1.5 7.5-4.9 7.5-9.5V6.5L12 3.5Z" />
      <Path d="M9.3 12.2l1.9 1.9 3.6-3.8" />
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgBottom },
  scroll: { paddingHorizontal: theme.space.card, alignItems: 'center' },
  brand: { alignItems: 'center', marginBottom: theme.space.xl },
  logoDot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accentSolid,
    marginBottom: theme.space.sm,
    shadowColor: theme.colors.accentSolid,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  wordmark: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
  },
  card: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
  },
  segment: {
    position: 'relative',
    flexDirection: 'row',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.pill,
    padding: 3,
    marginBottom: theme.space.md,
  },
  segmentThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: '48%',
    bottom: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
    shadowColor: theme.colors.accentSolid,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: theme.space.xs, zIndex: 1 },
  segTxt: { fontSize: theme.fontSize.body, color: theme.colors.textSub, fontWeight: theme.weight.medium as any },
  segTxtOn: { color: '#fff', fontWeight: theme.weight.semibold as any },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingHorizontal: theme.space.sm,
    marginBottom: theme.space.sm,
    height: 50,
  },
  fieldIcon: { width: 24, alignItems: 'center', marginRight: theme.space.xs },
  input: {
    flex: 1,
    color: theme.colors.textTitle,
    fontSize: theme.fontSize.body,
    height: 50,
  },
  eye: { paddingHorizontal: theme.space.xs },
  eyeTxt: { fontSize: theme.fontSize.sm, color: theme.colors.accentText },
  codeBtn: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 6,
  },
  codeBtnOff: { backgroundColor: 'rgba(255,255,255,0.06)' },
  codeTxt: { fontSize: theme.fontSize.sm, color: theme.colors.accentText, fontWeight: theme.weight.medium as any },
  codeTxtOff: { color: theme.colors.textSub },
  error: {
    color: theme.colors.danger,
    fontSize: theme.fontSize.sm,
    marginTop: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  primary: {
    height: 50,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space.sm,
    overflow: 'hidden',
  },
  primaryOff: { opacity: 0.6 },
  primaryTxt: { color: '#fff', fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any },
  demoHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accentText,
    marginTop: theme.space.xs,
    textAlign: 'center',
  },
  privacy: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.space.md,
    textAlign: 'center',
  },
  footnote: {
    fontSize: theme.fontSize.tiny,
    color: theme.colors.ui.white55,
    marginTop: theme.space.sm,
    textAlign: 'center',
  },
});
