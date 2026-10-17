import React, { useRef, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../hooks/useReducedMotion';
import Icon, { type IconName } from './Icon';
import { useVoiceTriggerApi } from '../hooks/useVoiceTrigger';
import Svg, { Circle, Defs, LinearGradient as SvgLg, Stop } from 'react-native-svg';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Meditation: 'tools',
  Profile: 'calendar',
  __voice__: 'orb',
};
const TAB_LABEL: Record<string, string> = { Today: '今日', Insight: '洞察', Meditation: '工具', Profile: '我的' };
const VOICE_ROUTE = '__voice__'; // 虚拟路由, 不对应真实 tab
const LEFT_ROUTES = ['Today', 'Insight', 'Meditation', 'Profile'];
/** 真实存在但不渲染图标的 tab：MiraAI 由中间 bot 按钮触发进入 */
const HIDDEN_ROUTES = ['MiraAI'];

// 右下 tab 上会动的 Mira Bot 脸
// 全用 Animated.Views，避免 SVG transform 坐标混乱
function AnimatedBotFace({ size, focused }: { size: number; focused: boolean }) {
  // 眼睛 wander（两眼共享一个偏移）
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;
  // 眨眼
  const blinkY = useRef(new Animated.Value(1)).current;
  // 笑眼过渡：0 = 竖眼, 1 = 笑眼
  const smile = useRef(new Animated.Value(0)).current;

  const reducedMotion = useReducedMotion();
  const SCALE = size / 200;

  // 眼参数（viewBox 200 坐标 × SCALE → 实际像素）
  const EYE_W = 12 * SCALE;    // 竖眼宽
  const EYE_H = 44 * SCALE;   // 竖眼高
  const EYE_LX = 72 * SCALE;  // 左眼中心 X
  const EYE_RX = 128 * SCALE; // 右眼中心 X
  const EYE_CY = 100 * SCALE; // 两只眼中心 Y

  // 笑眼参数：短而扁的椭圆，中心稍微上移
  const SMILE_W = 18 * SCALE;
  const SMILE_H = 8 * SCALE;
  const SMILE_CY = EYE_CY - 5 * SCALE; // 比竖眼高一点

  // opacity 交叉淡入淡出
  const straightEyeOpacity = smile.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] });
  const smileEyeOpacity = smile.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] });

  useEffect(() => {
    lookX.setValue(0); lookY.setValue(0); blinkY.setValue(1); smile.setValue(0);
    if (reducedMotion) return;
    let cancelled = false;
    let wanderTimer: ReturnType<typeof setTimeout> | undefined;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let smileTimer: ReturnType<typeof setTimeout> | undefined;
    const wander = () => {
      if (cancelled) return;
      const dir = Math.floor(Math.random() * 4);
      Animated.parallel([
        Animated.timing(lookX, { toValue: (dir < 2 ? -1 : 1) * 18 * SCALE, duration: theme.motion.slow, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(lookY, { toValue: (dir % 2 ? 1 : -1) * 20 * SCALE, duration: theme.motion.slow, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(() => { if (!cancelled) wanderTimer = setTimeout(wander, 140); });
    };
    const blink = () => {
      blinkTimer = setTimeout(() => {
        if (cancelled) return;
        Animated.sequence([
          Animated.timing(blinkY, { toValue: 0.05, duration: theme.motion.instant / 2, useNativeDriver: true }),
          Animated.timing(blinkY, { toValue: 1, duration: theme.motion.instant / 2, useNativeDriver: true }),
        ]).start(() => { if (!cancelled) blink(); });
      }, 1800 + Math.random() * 2200);
    };
    const grin = () => {
      smileTimer = setTimeout(() => {
        if (cancelled) return;
        Animated.sequence([
          Animated.timing(smile, { toValue: 1, duration: theme.motion.base, useNativeDriver: true }),
          Animated.delay(850),
          Animated.timing(smile, { toValue: 0, duration: theme.motion.slow, useNativeDriver: true }),
        ]).start(() => { if (!cancelled) grin(); });
      }, 6000 + Math.random() * 4000);
    };
    wander(); blink(); grin();
    return () => {
      cancelled = true;
      clearTimeout(wanderTimer); clearTimeout(blinkTimer); clearTimeout(smileTimer);
      lookX.stopAnimation(); lookY.stopAnimation(); blinkY.stopAnimation(); smile.stopAnimation();
    };
  }, [reducedMotion, SCALE, lookX, lookY, blinkY, smile]);

  return (
    <View style={{ width: size, height: size }}>
      {/* 身体 —— ★ 2026-10-15：改洞察页「生理周期节律」按钮同款渐变（青柠→粉），原墨色渐变改掉 */}
      <Svg viewBox="0 0 200 200" width={size} height={size}>
        <Defs>
          <SvgLg id="tabBotBody" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#C6D84B" />
            <Stop offset="100%" stopColor="#F58AB8" />
          </SvgLg>
        </Defs>
        <Circle cx={100} cy={100} r={82} fill="url(#tabBotBody)" />
      </Svg>

      {/* ========== 竖长眼睛（正常态） ========== */}
      {/* 左眼 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: EYE_W / 2,
          left: EYE_LX - EYE_W / 2,
          top: EYE_CY - EYE_H / 2,
          width: EYE_W,
          height: EYE_H,
          opacity: straightEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
            { scaleY: blinkY },
          ],
        }}
      />
      {/* 右眼 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: EYE_W / 2,
          left: EYE_RX - EYE_W / 2,
          top: EYE_CY - EYE_H / 2,
          width: EYE_W,
          height: EYE_H,
          opacity: straightEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
            { scaleY: blinkY },
          ],
        }}
      />

      {/* ========== 笑眼（扁椭圆眯缝态） ========== */}
      {/* 左眼笑 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: SMILE_W / 2,
          left: EYE_LX - SMILE_W / 2,
          top: SMILE_CY - SMILE_H / 2,
          width: SMILE_W,
          height: SMILE_H,
          opacity: smileEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
          ],
        }}
      />
      {/* 右眼笑 */}
      <Animated.View
        style={{
          position: 'absolute',
          backgroundColor: '#ffffff',
          borderRadius: SMILE_W / 2,
          left: EYE_RX - SMILE_W / 2,
          top: SMILE_CY - SMILE_H / 2,
          width: SMILE_W,
          height: SMILE_H,
          opacity: smileEyeOpacity,
          transform: [
            { translateX: lookX },
            { translateY: lookY },
          ],
        }}
      />
    </View>
  );
}

// ★ 丝滑化：左侧 tab 选中项加 spring pop 缩放（选中放大一点，切走回弹），让选中标更"活"
function TabItem({ route, focused, onPress }: { route: any; focused: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1.12 : 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [focused, scale]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.item}
      activeOpacity={theme.press.opacity}
      accessibilityRole="tab"
      accessibilityLabel={TAB_LABEL[route.name] ?? route.name}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
    >
      {/* v10 选中态：lime 圆底 + 深色 icon；未选 = inkFaint */}
      {/* ★ 2026-10-10（用户）：去掉「今日/洞察/工具/我的」文字，只留图标；图标稍大（22→25） */}
      <Animated.View style={[styles.itemCircle, focused && { backgroundColor: mm.colors.lime }, { transform: [{ scale }] }]}>
        <Icon
          name={TAB_ICON[route.name] ?? 'home'}
          size={theme.fs(26)}
          color={focused ? mm.colors.ink : mm.colors.inkFaint}
          strokeWidth={2}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  // ★ 2026-10-12：只订阅稳定 API（录音转写每 250ms 推进不再重渲染整个 tab 栏）
  const { open, close } = useVoiceTriggerApi();
  const voiceStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressing = useRef(false);
  // ★ 丝滑化：bot 按钮按压缩放反馈（长按 / 单击都给触觉缩放，松手弹回）
  const botScale = useRef(new Animated.Value(1)).current;
  const pressBotIn = () =>
    Animated.spring(botScale, { toValue: 0.9, friction: 4, tension: 200, useNativeDriver: true }).start();
  const pressBotOut = () =>
    Animated.spring(botScale, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }).start();
  const insets = useSafeAreaInsets();
  // ★ 2026-10-10（用户：整体包括底下的 tab 往上挪一点点）：0 → 8 —— 悬浮 tab 胶囊不再贴死屏幕底。
  const marginBottom = 8;
  useEffect(() => () => {
    if (voiceStartTimer.current) clearTimeout(voiceStartTimer.current);
  }, []);

  // ★ 松手后 stop() 一解析出转写文本就立刻导航。
  //   旧实现把导航挂在 `setTimeout(..., 800)` 的兜底里 —— 等于**每次跳转前固定空等 800ms**，
  //   手感发滞（转场前的那段"卡"多半来自这里）；而且 `onStop` 定义了却从未被调用（死代码）。
  //   现在直接在 open() 的回调里跳，延迟只取决于语音识别 stop() 本身。
  const doNavigate = (text: string) => {
    const parentNav = (navigation as any).getParent?.() ?? navigation;
    const routeNames = navigation.getState().routes.map((r: any) => r.name).join(' → ');
    console.log('[CustomTabBar] 导航栈:', routeNames, '→ VoiceChat, question:', JSON.stringify(text));
    parentNav.navigate('VoiceChat', { question: text });
  };

  // ★ 单击 bot → 跳「三排建议问题」的 MiraAI 页面（VoiceChat 不带初始问题时，ChatSheet 即展示 suggestedQuestions）；
  //   长按(>HOLD_MS) → 开录音浮层，松手转写后带问题跳 VoiceChat。用延时区分两者，避免单击误触录音。
  const PRESS_HOLD_MS = 220;
  const handleVoicePressIn = () => {
    isLongPressing.current = true;
    pressBotIn();
    if (voiceStartTimer.current) clearTimeout(voiceStartTimer.current);
    voiceStartTimer.current = setTimeout(() => {
      voiceStartTimer.current = null; // 标记：已进入录音态
      // ★ 2026-10-08：在首页（Today）长按 → **不弹**「正在聆听…」浮层，
      //   实时转写直接显示在趋势图下方的常驻 AI 气泡里（silent = inlineMode）；
      //   其余页面保持原有底部浮层样式。
      const onToday = state.routes[state.index]?.name === 'Today';
      console.log('[CustomTabBar] 长按 bot → 打开录音', onToday ? '(就地/首页气泡)' : '(浮层)');
      open(
        (text) => {
          console.log('[CustomTabBar] onRelease 回调, text:', JSON.stringify(text));
          doNavigate((text || '').trim());
        },
        { silent: onToday },
      );
    }, PRESS_HOLD_MS);
  };

  const handleVoicePressOut = () => {
    if (!isLongPressing.current) return;
    isLongPressing.current = false;
    pressBotOut();
    if (voiceStartTimer.current) {
      // 未到长按阈值 = 单击 → 切到 MiraAI 首页 tab（tab 栏保持可见，与设计稿一致）
      clearTimeout(voiceStartTimer.current);
      voiceStartTimer.current = null;
      console.log('[CustomTabBar] 单击 bot → 切到 MiraAI tab');
      navigation.navigate('MiraAI');
    } else {
      // 已在录音态 → 松手关录音
      console.log('[CustomTabBar] 松手 → close（转写完成后跳转 VoiceChat）');
      close();
    }
  };

  const handlePress = (route: any, focused: boolean) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  const voiceFocused = state.routes[state.index]?.name === 'MiraAI';
  const botSize = theme.layout.tabCenterSize;

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      <View style={styles.leftCard}>
        {state.routes.map((route, idx) => {
          if (route.name === VOICE_ROUTE || HIDDEN_ROUTES.includes(route.name)) return null;
          const focused = state.index === idx;
          return (
            <TabItem
              key={route.key}
              route={route}
              focused={focused}
              onPress={() => handlePress(route, focused)}
            />
          );
        })}
      </View>

      <TouchableOpacity
        onPress={() => { /* bot 按钮不做 tab 切换, 只做长按录音 */ }}
        onPressIn={handleVoicePressIn}
        onPressOut={handleVoicePressOut}
        delayPressIn={0}
        delayPressOut={0}
        activeOpacity={theme.press.opacity}
        style={[styles.botBtn, { width: botSize, height: botSize }, voiceFocused && styles.botSelected]}
        accessibilityRole="tab"
        accessibilityLabel="Mira AI"
        accessibilityHint="点击进入聊天，长按说话，松手结束"
        accessibilityState={{ selected: voiceFocused }}
        aria-selected={voiceFocused}
        accessibilityActions={[{ name: 'activate', label: '打开 Mira AI 聊天' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') navigation.navigate('MiraAI'); }}
      >
        <Animated.View style={{ transform: [{ scale: botScale }] }}>
          <AnimatedBotFace size={botSize} focused={voiceFocused} />
          {voiceFocused ? <View style={styles.voiceDot} /> : null}
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: theme.layout.tabBarHeight,
  },
  leftCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: theme.layout.tabBarHeight,
    // ★ Calm 式透明玻璃胶囊（2026-10-17 预览）：原 rgba(255,255,255,0.96) 实底改半透玻璃。
    //   回退：改回 mm.colors.tabBg / mm.colors.cardBorder。
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    // ★ 必须用 pill：高度 = tabBarHeight(56)，pill(999) 会解析成半高 28 → 完整胶囊。
    //   原先写 radius.card 时 card 恰好是 28 才碰巧是胶囊；2026-09-20 把 card 收紧到 14 后就退化成圆角矩形了。
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    marginRight: theme.sp(2),
    ...theme.shadow.nav,
  },
  // ★ 2026-10-15（用户定稿 V1 去紫）：选中描边由 purpleDeep 改墨色
  botSelected: { borderWidth: 2, borderColor: mm.colors.ink },
  item: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(0.5) },
  // v10：选中项 = 42px lime 圆底（SPEC §2 #13），不再用小圆点
  // ★ 2026-10-10：文字标签移除，圆底随之放大（24→30→36，用户："绿色背景圈大一点"），icon 居中
  itemCircle: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botBtn: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.layout.tabBarHeight / 2 - theme.layout.tabCenterSize / 2,
    // ★ 2026-10-15：去掉黑色投影（用户：背景黑阴影去掉）
    shadowOpacity: 0,
    elevation: 0,
  },
  voiceDot: {
    position: 'absolute',
    bottom: -theme.sp(0.5),
    left: '50%',
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    marginLeft: -theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.ink,
  },
});
