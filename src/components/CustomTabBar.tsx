import React, { useRef, useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon, { type IconName } from './Icon';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';
import Svg, { Circle, Defs, LinearGradient as SvgLg, Stop } from 'react-native-svg';

const TAB_ICON: Record<string, IconName> = {
  Today: 'home',
  Insight: 'insights',
  Meditation: 'tools',
  Profile: 'calendar',
  __voice__: 'orb',
};
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
  const [smiling, setSmiling] = useState(false);

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

  // wander
  useEffect(() => {
    let cancelled = false;
    const WANDER_DUR = 380;        // 固定时长，保证速度一致
    const WANDER_GAP = 140;        // 固定间隔
    const AMP_X = 18 * SCALE;
    const AMP_Y = 20 * SCALE;
    const wander = () => {
      if (cancelled) return;
      const dir = Math.floor(Math.random() * 4); // 0=左上 1=右上 2=左下 3=右下
      Animated.parallel([
        Animated.timing(lookX, { toValue: (dir === 0 || dir === 2 ? -1 : 1) * AMP_X, duration: WANDER_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(lookY, { toValue: (dir === 0 || dir === 1 ? -1 : 1) * AMP_Y, duration: WANDER_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(() => setTimeout(wander, WANDER_GAP));
    };
    wander();
    return () => { cancelled = true; };
  }, []);

  // 眨眼（笑时不眨）
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const delay = 1800 + Math.random() * 2200;
      const doBlink = () => {
        if (cancelled || smiling) { schedule(); return; }
        Animated.sequence([
          Animated.timing(blinkY, { toValue: 0.05, duration: 55, useNativeDriver: true }),
          Animated.timing(blinkY, { toValue: 1, duration: 55, useNativeDriver: true }),
        ]).start(() => schedule());
      };
      setTimeout(doBlink, delay);
    };
    schedule();
    return () => { cancelled = true; };
  }, [smiling]);

  // 定时触发笑
  useEffect(() => {
    const t = setInterval(() => {
      if (smiling) return;
      setSmiling(true);
      Animated.timing(smile, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      setTimeout(() => {
        Animated.timing(smile, { toValue: 0, duration: 280, useNativeDriver: true }).start();
        setSmiling(false);
      }, 850);
    }, 6000 + Math.random() * 4000);
    return () => clearInterval(t);
  }, [smiling]);

  return (
    <View style={{ width: size, height: size }}>
      {/* 身体 —— v10 紫渐变（#A98FE8→#C3B2D4, 135°） */}
      <Svg viewBox="0 0 200 200" width={size} height={size}>
        <Defs>
          <SvgLg id="tabBotBody" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={mm.colors.fabFrom} />
            <Stop offset="100%" stopColor={mm.colors.fabTo} />
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

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { open, close } = useVoiceTrigger();
  const voiceStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressing = useRef(false);
  const marginBottom = theme.sp(2);

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

  const voiceIdx = -1; // 无对应 tab
  const voiceFocused = false;
  const botSize = theme.layout.tabCenterSize;

  return (
    <View style={[styles.wrap, { marginBottom }]}>
      <View style={styles.leftCard}>
        {state.routes.map((route, idx) => {
          if (route.name === VOICE_ROUTE || HIDDEN_ROUTES.includes(route.name)) return null;
          const focused = state.index === idx;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => handlePress(route, focused)}
              style={styles.item}
              activeOpacity={theme.press.opacity}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
            >
              {/* v10 选中态：lime 圆底 + 深色 icon；未选 = inkFaint */}
              <View style={[styles.itemCircle, focused && { backgroundColor: mm.colors.lime }]}>
                <Icon
                  name={TAB_ICON[route.name] ?? 'home'}
                  size={theme.fs(22)}
                  color={focused ? mm.colors.ink : mm.colors.inkFaint}
                  strokeWidth={2}
                />
              </View>
            </TouchableOpacity>
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
        style={[styles.botBtn, { width: botSize, height: botSize }]}
        accessibilityRole="button"
        accessibilityLabel="Mira Bot — 长按说话"
      >
        <AnimatedBotFace size={botSize} focused={voiceFocused} />
        {voiceFocused ? <View style={styles.voiceDot} /> : null}
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
    height: theme.layout.tabBarHeight + theme.sp(4),
  },
  leftCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: theme.layout.tabBarHeight,
    backgroundColor: mm.colors.tabBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    // ★ 必须用 pill：高度 = tabBarHeight(56)，pill(999) 会解析成半高 28 → 完整胶囊。
    //   原先写 radius.card 时 card 恰好是 28 才碰巧是胶囊；2026-09-20 把 card 收紧到 14 后就退化成圆角矩形了。
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    marginRight: theme.sp(2),
    ...theme.shadow.nav,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(0.5) },
  // v10：选中项 = 42px lime 圆底（SPEC §2 #13），不再用小圆点
  itemCircle: {
    width: theme.fs(38),
    height: theme.fs(38),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botBtn: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.layout.tabBarHeight / 2 - theme.layout.tabCenterSize / 2,
    shadowColor: mm.fabShadow.color,
    shadowOpacity: mm.fabShadow.opacity,
    shadowRadius: mm.fabShadow.radius,
    shadowOffset: { width: 0, height: mm.fabShadow.height },
    elevation: mm.fabShadow.elevation,
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
