/**
 * LoginScreen —— 首次登录 / 注册页（mira-ocean 深海玻璃风）
 * ---------------------------------------------------------------------------
 * 字段：手机号 + 账户名 + 密码（注册额外含短信验证码，演示环境用固定演示码）。
 * 交互：顶部「登录 / 注册」分段切换；底部隐私提示。
 * 认证：本地 mock（userStore），后续替换为云端账号体系时调用方零改动。
 *
 * 本页由 App 入口的 AuthGate 在「未登录」时渲染，通过 onAuthenticated 回调切走。
 *
 * ★ 2026-11-16（1.4.9，用户「注册报已注册 → 点登录 tab 只剩蓝色空页」）：
 *   RN 0.74 Fabric 的 Differ 在同一批次里处理「多个子节点 unmount + Animated 改 transform」
 *   时会生成乱序 mount 指令。OPPO PMA110 真机 logcat 实锤：
 *     SurfaceMountingManager: removeViewAt tried to remove a React View that was actually
 *     reused. This indicates a bug in the Differ (specifically instruction ordering). [802]
 *   后果是原生视图树被静默撕成空容器（不崩溃、无 redbox、JS 错误边界抓不到），
 *   只剩最外层 LinearGradient 蓝底；uiautomator 抓到 13 个节点、0 个文本节点。
 *   典型触发路径：注册失败 → mount error Text → 切登录 tab → 同批 unmount
 *   「验证码 Field + error Text + 演示码提示」3 个节点 + 改动画 transform → Differ 乱序。
 *   2026-11-12 只修了密码框的 relative/absolute 嵌套，没修条件渲染，故切 tab 又复现。
 *   → 本页所有字段/提示一律常驻渲染，显隐只用 display:'none'（纯 style 更新，不产生
 *     removeViewAt），从源头规避 Fabric 视图复用 bug。
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
  // ★ 2026-11-16：演示验证码自动填好，用户不用点「获取验证码」也不用手动输入；
  //   同时删掉倒计时那套定时器（少一个状态源，也少一批 Fabric 样式更新）。
  const [code, setCode] = useState<string>(DEMO_CODE);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const [segW, setSegW] = useState(0);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError('');
    // 回到注册页时把演示码重新填好，避免用户改过之后留下非法值。
    if (m === 'register') setCode(DEMO_CODE);
    Animated.spring(slide, { toValue: m === 'register' ? 1 : 0, useNativeDriver: true }).start();
  };

  /** 把分段滑块归到指定模式（供「已注册自动切登录」复用）。 */
  const slideTo = (m: Mode) => {
    Animated.spring(slide, { toValue: m === 'register' ? 1 : 0, useNativeDriver: true }).start();
  };

  const submit = async () => {
    setError('');
    if (!PHONE_RE.test(phone)) {
      setError('请输入正确的 11 位手机号');
      return;
    }
    if (mode === 'register') {
      // ★ 2026-11-16（完整矩阵发现）：账户名是注册字段，login() 根本不校验它。
      //   原来无条件校验，导致「已注册 → 切登录 → 填手机号+密码」被「请填写账户名」
      //   拦住，正是用户反馈的「注册了却登录不进去」的第二层原因。
      if (!accountName.trim()) {
        setError('请填写账户名');
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setError('请输入 6 位验证码');
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
        // ★ 账号表是本地 mock：这个号码以前在本机注册过。自动切到登录页并保留
        //   手机号/账户名，用户只要输密码即可；也避免用户被迫手动点 tab（蓝屏触发路径）。
        if (err.includes('已注册')) {
          setMode('login');
          slideTo('login');
        }
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
      {/* ★ 2026-11-16（1.5.0）：Android 不再让 KeyboardAvoidingView 改高度。
          2026-11-12 已在 OnboardingScreen 验证：ColorOS/EMUI + RN 下 `behavior='height'`
          会在键盘弹起时改根布局高度，触发原生视图重排/卸载，表现为整页只剩蓝底。
          这里保持组件结构不变，Android 只依赖 manifest 的 windowSoftInputMode=adjustResize，
          iOS 仍保留 padding。 */}
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
            <Text style={s.wordmark}>Luna Mira</Text>
            <Text style={s.tagline}>你的身体，自有节奏</Text>
          </View>

          {/* 表单玻璃卡 */}
          <View style={s.card}>
            {/* 分段切换 */}
            <View style={s.segment} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
              <Animated.View
                style={[
                  s.segmentThumb,
                  segW > 0 && {
                    width: (segW - 6) / 2,
                    transform: [
                      {
                        translateX: slide.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (segW - 6) / 2],
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
            {/* 账户名只在注册态出现；仍常驻渲染，显隐只用 display:none，
                避免切 tab 时 unmount TextInput 触发 Fabric removeViewAt。 */}
            <Field
              icon="user"
              placeholder="账户名"
              autoCapitalize="none"
              value={accountName}
              onChange={setAccountName}
              hidden={mode !== 'register'}
            />

            {/* ★ 2026-11-16：常驻渲染。切 tab 只改 display:'none'，不再 unmount TextInput，
                从源头消除 Fabric 的 removeViewAt / Differ 乱序（见文件头说明）。 */}
            <Field
              icon="shield"
              placeholder="短信验证码"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChange={setCode}
              hidden={mode !== 'register'}
              trailing={<Text style={s.codeAuto}>已自动填写</Text>}
            />

            <PasswordField
              value={pwd}
              onChange={setPwd}
              placeholder="密码（至少 6 位）"
            />

            {/* 错误提示常驻：内容用空格占位，保证节点始终存在，不产生 remove 指令。 */}
            <Text style={[s.error, !error && s.hidden]}>{error || ' '}</Text>

            <TouchableOpacity
              style={[s.primary, busy && s.primaryOff]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={submit}
            >
              <Text style={s.primaryTxt}>{busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}</Text>
            </TouchableOpacity>

            {/* 演示环境无短信后端，验证码已预填，不再要求用户点「获取验证码」。常驻渲染。 */}
            <Text style={[s.demoHint, mode !== 'register' && s.hidden]}>
              演示验证码 {DEMO_CODE} 已自动填写（测试环境）
            </Text>
          </View>

          <Text style={s.privacy}>登录即表示同意《隐私政策》与《用户协议》</Text>
          <Text style={s.footnote}>lunamira · 看见 · 理解 · 掌控</Text>
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
  hidden,
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
  /** ★ 2026-11-16：显隐只改 style，绝不 unmount 节点（Fabric Differ 保护）。 */
  hidden?: boolean;
}) {
  return (
    <View style={[s.field, hidden && s.hidden]}>
      <View style={s.fieldIcon}>
        <FieldIcon name={icon} />
      </View>
      <TextInput
        style={s.input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.ui.white55}
        value={value}
        onChangeText={onChange}
        editable={!hidden}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        selectionColor={theme.colors.accentText}
        // ★ 2026-11-12（用户「点密码输密码就蓝屏」）：密码框是页面唯一触发系统
        //   密码自动填充/密码保险箱（OPPO 密码本 / 华为密码保险箱 / 小米密码荚）的字段，
        //   该服务的自动填充事件在部分 Android 机型（ColorOS / EMUI）会与 RN 的
        //   secureTextEntry 冲突，引发原生层崩溃、整页被撕掉露出蓝底。错误边界抓不到
        //   原生崩溃，故从源头关闭该字段的自动填充，彻底规避。对其他字段也一并关闭，
        //   防止联系人/短信等自动填充在个别机型上同样触发原生崩溃。
        importantForAutofill="no"
        autoComplete="off"
      />
      {trailing}
    </View>
  );
}

/**
 * ★ 2026-11-12（用户「注册页点密码输密码就蓝屏」；已确认 1.3.6 关自动填充仍崩）：
 * 根因是系统「安全输入法 / 密码键盘」——即 native `secureTextEntry`——在部分 Android
 * （ColorOS / EMUI）与 RN Fabric 新架构冲突，触发原生层崩溃、整页被撕成蓝底；错误边界
 * 抓不到原生崩溃，故 1.3.5/1.3.6 的 JS 兜底与关自动填充均无效。
 * 这里彻底绕开：不使用 native secureTextEntry，改用「透明真值 + 圆点遮罩」自定义显示。
 * - TextInput 始终持有真实密码（value 为真实串、永不被改写），规避任何受控改写导致的光标错位；
 * - 隐藏态：文字 transparent + 覆盖层画等长的 ●；显示态：直接显示真实文字。
 * - 眼睛按钮切换显隐，语义不变。此方案不经过系统安全输入路径，原生崩溃无从触发。
 */
function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  // ★ 2026-11-12（用户「点密码框变蓝屏」）：原方案用 fieldInputWrap(position:relative) +
  //    pwdMask(position:absolute 覆盖层) 的嵌套在 OPPO/ColorOS + 搜狗输入法 + RN Fabric
  //    下聚焦时会触发原生层静默卸载表单子树（露出纯蓝渐变底、无崩溃日志、无 redbox），
  //    表现为「蓝屏」。改为与正常 Field 一致的「单个 TextInput」结构，用受控掩码 value
  //    实现圆点遮罩——不引入任何额外 overlay / relative-absolute 嵌套节点，规避原生崩溃。
  const display = show ? value : '•'.repeat(value.length);
  return (
    <View style={s.field}>
      <View style={s.fieldIcon}>
        <FieldIcon name="lock" />
      </View>
      <TextInput
        style={s.input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.ui.white55}
        value={display}
        onChangeText={(t) => {
          // 显示态：用户看到的是真实字符，直接采用。
          if (show) {
            onChange(t);
            return;
          }
          // 遮罩态：输入框显示 N 个圆点。依据长度差还原真实串（光标默认在末尾，
          // 追加则补上新字符、删除则截掉末尾），避免把旧真实字符误清掉。
          const oldLen = value.length;
          let real: string;
          if (t.length > oldLen) real = value + t.slice(oldLen);
          else if (t.length < oldLen) real = value.slice(0, t.length);
          else real = value;
          onChange(real);
        }}
        secureTextEntry={false}
        keyboardType="default"
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={theme.colors.accentText}
        importantForAutofill="no"
        autoComplete="off"
      />
      <TouchableOpacity style={s.eye} activeOpacity={0.7} onPress={() => setShow((v) => !v)}>
        <Text style={s.eyeTxt}>{show ? '隐藏' : '显示'}</Text>
      </TouchableOpacity>
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
  wordmark: {
    // ★ 2026-11-07（用户「Luna Mira 要手写体」）：与启动页同款 Caveat 手写字体（AuthGate 全局加载）
    fontSize: theme.fontSize.h1 * 1.6,
    color: theme.colors.textTitle,
    letterSpacing: 1,
    fontFamily: 'Caveat',
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
    overflow: 'hidden',
  },
  segmentThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: '48%',
    bottom: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F2F4F8',
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: theme.space.xs, zIndex: 1 },
  segTxt: { fontSize: theme.fontSize.body, color: theme.colors.textSub, fontWeight: theme.weight.medium as any },
  segTxtOn: { color: theme.colors.bgBottom, fontWeight: theme.weight.semibold as any },
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
  // ★ 密码框：包裹真实输入框 + 圆点遮罩层（透明真值方案）
  fieldInputWrap: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  pwdMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    fontSize: theme.fontSize.body,
    color: theme.colors.textTitle,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  eye: { paddingHorizontal: theme.space.xs },
  eyeTxt: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  /** ★ 2026-11-16：验证码已自动填好，右侧只做静态说明，不再有可点按钮/倒计时。 */
  codeAuto: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginLeft: theme.space.xs,
  },
  /**
   * ★ 2026-11-16：Fabric 安全显隐。display:'none' 只更新 style、保留原生节点，
   *   不产生 removeViewAt 指令；不要用条件渲染（&& / 三元）来切字段。
   */
  hidden: { display: 'none' },
  error: {
    color: theme.colors.ui.status.danger,
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
    backgroundColor: theme.colors.ui.white92,
    borderWidth: 1,
    borderColor: theme.colors.ui.white55,
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 0,
  },
  primaryOff: { opacity: 0.6 },
  primaryTxt: { color: theme.colors.bgBottom, fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any },
  demoHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
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
