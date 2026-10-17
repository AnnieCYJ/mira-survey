/**
 * MiraAIHomeScreen —— 点击 tab bar 中间 bot 后进入的「Mira AI 首页」。
 *
 * ★ v16 reskin：整页白底 + 墨字（AI 语义紫只保留在 AiOrb 光球上）；
 *   版本徽章/喇叭钮 = 黄绿；发送钮 = 统一 lime→粉 渐变。
 *   - 顶部：白色左对齐大标题「Mira AI」+ 标题右侧「1.3」半透明胶囊徽章；
 *     下一行副标题「你的健康助手」；右上角 🔊 喇叭按钮。无返回键（tab 页靠 tab bar 导航）。
 *   - 中部：AiOrb 光球（"Hi, can I help you?"）+ 三排建议问题跑马灯：
 *     第 1/3 排向左滚动，第 2 排向右滚动；手指按住可暂停并手动拖动，松手 2.2s 后恢复。
 *   - 底部：圆角输入框 + 渐变发送圆钮（麦克风按钮已按用户要求移除）。
 *     ★ 输入行用 position:absolute 贴在屏底、paddingBottom = tabBarHeight + sp(2) + sp(2.5) = 74px，
 *       即「tab 卡片顶边(64px) + 10px 间距」纯几何计算（**不加 insets.bottom**，tab bar 是
 *       bottom:0 浮层、不含安全区，加了会重复计算）。绕开 KeyboardAvoidingView 在 iOS 篡改 padding 的坑。
 *
 * 点击问题 / 发送文字 → push VoiceChat（ChatSheet）带初始问题进入对话（语音输入走 tab bar 长按 bot）。
 * 跑马灯在页面失焦（跳转到问答页时）自动暂停，转场更顺、不空转。
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from '../components/Icon';
import AiOrb from '../components/AiOrb';
import { generateQuestions } from '../data/chat';
import { useRingState } from '../hooks/useRingState';
import { useSpeech } from '../hooks/useSpeech';
import { useAppState } from '../state/AppState';
import type { RingState } from '../ble/RingBleManager';

/** 生成建议问题的数据指纹：只有真实数据变化才重新生成 */
function questionKey(rs: RingState | null): string {
  return [
    rs?.curveStatus?.hasLog ? 1 : 0,
    rs?.curveStatus?.phaseLabel ?? '',
    rs?.sleepSummary?.total ?? 0,
    rs?.metrics.hrv ?? rs?.daily.hrv ?? 0,
    rs?.daily?.steps ?? 0,
  ].join('|');
}

const MARQUEE_SPEED = 26;   // 自动滚动速度 px/s
const RESUME_DELAY_MS = 2200; // 手动拖动后恢复自动滚动的延时

/** v16：三排建议问题 = 三个 pastel 家族（紫=认知 / 粉=情绪 / 蓝=运动心肺），soft 底 + deep 字 */
const ROW_TONES = [
  { bg: mm.colors.purpleSoft, fg: mm.colors.purpleDeep },
  { bg: mm.colors.roseSoft, fg: mm.colors.roseDeep },
  { bg: mm.colors.skySoft, fg: mm.colors.skyDeep },
] as const;

/**
 * 单排问题跑马灯：内容复制一份做无缝循环。
 * direction=1 内容向左移（第 1/3 排），direction=-1 内容向右移（第 2 排）。
 *
 * ★ 用 Animated translateX 位移，而非 ScrollView.scrollTo —— 否则 ScrollView 每帧都处在
 *   「滚动/惯性」状态，iOS 会吃掉子按钮的 onPress（表现为点问题没反应）。translateX 动画
 *   不会触发滚动态，点击正常。
 * ★ active=false（页面失焦/跳走）时暂停更新，转场不空转、更顺滑。
 */
function MarqueeRow({
  questions,
  direction,
  onPick,
  active,
  bg,
  fg,
}: {
  questions: string[];
  direction: 1 | -1;
  onPick: (q: string) => void;
  active: boolean;
  /** v16：每排一个 pastel 家族（soft 底 + deep 字） */
  bg: string;
  fg: string;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const halfW = useRef(0);                  // 单份内容的宽度（循环周期）
  const pos = useRef(0);
  const paused = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  const loop = useMemo(() => [...questions, ...questions], [questions]);

  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const step = () => {
      const now = Date.now();
      const dt = Math.min(now - last, 64); // 切后台回来防止跳变
      last = now;
      if (activeRef.current && !paused.current && halfW.current > 0) {
        pos.current += (direction * MARQUEE_SPEED * dt) / 1000;
        if (pos.current >= halfW.current) pos.current -= halfW.current;
        if (pos.current < 0) pos.current += halfW.current;
        translateX.setValue(-pos.current);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [direction, translateX]);

  const pause = () => {
    paused.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  };
  const resumeSoon = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { paused.current = false; }, RESUME_DELAY_MS);
  };

  return (
    <View
      style={styles.qRow}
      onTouchStart={pause}
      onTouchEnd={resumeSoon}
    >
      <Animated.View
        style={[styles.qRowInner, { transform: [{ translateX }] }]}
        onLayout={(e) => { halfW.current = e.nativeEvent.layout.width / 2; }}
      >
        {loop.map((q, i) => (
          <TouchableOpacity
            key={`${q}-${i}`}
            style={[styles.qChip, { backgroundColor: bg }]}
            onPress={() => onPick(q)}
            activeOpacity={0.7}
          >
            <Text style={[styles.qChipText, { color: fg }]}>{q}</Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </View>
  );
}

export default function MiraAIHomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const ringState: RingState | null = useRingState();
  const { ttsOn, setTtsOn } = useAppState();
  const { stop } = useSpeech();
  const [draft, setDraft] = useState('');

  // ★ mira-ocean：深底 → 状态栏亮图标（失焦恢复，避免影响其它白底 tab）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('dark-content', true);
  }, []));

  const k = questionKey(ringState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => generateQuestions(ringState, 4), [k]);

  const openChat = (q: string) => {
    const t = (q || '').trim();
    if (!t) return;
    const parentNav = (navigation as any).getParent?.() ?? navigation;
    parentNav.navigate('VoiceChat', { question: t });
  };

  const submitDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    openChat(t);
  };

  /* ★ 输入行底部留白 = tab 卡片顶边高度 + 10px 间距，纯几何计算。
     实测 tab bar 几何（CustomTabBar.tsx）：wrap 是 position:absolute + bottom:0（屏幕底）
     + marginBottom sp(2)=8，leftCard/botBtn 高 tabBarHeight=56 → 卡片顶边恒在屏底上方
     56+8=64px，且**不含安全区**（导航器未给 tab bar 包 SafeArea，bottom:0 即屏幕底）。
     所以这里绝不能再加 insets.bottom —— 加了会重复计算（真机多出 ~34px 空隙）。
     ⚠️ 不要改回 layout.pageBottomPad(insets)：那个公式面向「内容被 tab 栏遮挡」的滚动页，
        它假定 tab 栏上方还留 raised(16)+20 的缓冲，对贴底的输入行偏松。 */
  const inputPadBottom = theme.layout.tabBarHeight + theme.sp(2) + theme.sp(2.5); // 56+8+10 = 74

  return (
    <View style={styles.root}>
      {/* ★ mira-ocean（2026-10-17）：整页由白底改深海渐变（Calm 式钢蓝→蓝紫，同 App 根渐变） */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* 顶部：左对齐标题 + 1.3 徽章 / 副标题；右上喇叭。无返回键 */}
      <View style={[styles.header, { paddingTop: insets.top + theme.sp(2) }]}>
        <View style={styles.headLeft}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Mira AI</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>1.3</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>你的健康助手</Text>
        </View>
        <TouchableOpacity
          style={styles.speakerBtn}
          onPress={() => {
            const next = !ttsOn;
            setTtsOn(next);
            if (!next) stop();
          }}
          activeOpacity={0.7}
          accessibilityLabel="语音播报开关"
        >
          <Icon
            name={ttsOn ? 'speaker' : 'speaker_off'}
            size={theme.fs(20)}
            color={ttsOn ? mm.colors.limeDeep : mm.colors.inkFaint}
            strokeWidth={2.2}
          />
        </TouchableOpacity>
      </View>

      {/* 中部：光球 + 三排跑马灯问题（1/3 排向左、2 排向右，按住可暂停拖动） */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentInner, { paddingBottom: inputPadBottom + theme.sp(4) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <AiOrb size={240} title="Hi, can I help you?" />
        <View style={styles.qRows}>
          {rows.map((row, ri) => (
            <MarqueeRow
              key={ri}
              questions={row}
              direction={ri === 1 ? -1 : 1}
              onPick={openChat}
              active={focused}
              bg={ROW_TONES[ri % ROW_TONES.length].bg}
              fg={ROW_TONES[ri % ROW_TONES.length].fg}
            />
          ))}
        </View>
      </ScrollView>

      {/* 底部输入行：输入框 + 紫色发送 + 麦克风。
          ★ position:absolute 贴在屏底，paddingBottom = pageBottomPad（= tab 栏高 56 + 安全区 + raised 16 + 20），
            彻底绕开 KeyboardAvoidingView 在 iOS 上篡改 padding 的坑，输入框稳显示于 tab 栏上方 */}
      <View
        style={[styles.inputBar, { paddingBottom: inputPadBottom }]}
      >
        <TextInput
          style={styles.input}
          placeholder="问我任何健康问题"
          placeholderTextColor={theme.colors.textSub}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={200}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={styles.sendBtn}
          disabled={!draft.trim()}
          onPress={submitDraft}
          accessibilityLabel="发送"
        >
          {draft.trim() ? (
            /* v16：发送钮 = 统一 lime→粉 渐变（渐变层自带圆角） */
            <LinearGradient
              colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtnGrad}
            >
              <Icon name="send" size={theme.fs(18)} color={mm.colors.btnTextOnGrad} />
            </LinearGradient>
          ) : (
            /* v18.20：禁用态也用铺满内层——此前 Icon 直接当子元素会被
               TouchableOpacity（纵向容器）顶到左上角，图标飘出圆心 */
            <View style={[styles.sendBtnGrad, { backgroundColor: mm.colors.btnBusyBg }]}>
              <Icon name="send" size={theme.fs(18)} color={mm.colors.inkFaint} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // ★ mira-ocean：底色由根渐变铺（见 render 顶部 LinearGradient），此处留深蓝紫兜底
    backgroundColor: '#2B3564',
  },
  // —— 顶部 header（白底 + 墨字）——
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.screen,
  },
  headLeft: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(2),
  },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
  },
  versionBadge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.limeSoft,
  },
  versionText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.colors.limeDeep,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(1),
  },
  speakerBtn: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mm.colors.limeSoft,
  },
  // —— 中部内容 ——
  content: { flex: 1 },
  contentInner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.xl,
  },
  qRows: {
    width: '100%',
    gap: theme.sp(2),
    marginTop: theme.space.xl,
  },
  qRow: {
    width: '100%',
    overflow: 'hidden',
  },
  // 横向排布、不换行；内容复制两份做无缝循环，容器 overflow 隐藏裁切两侧
  qRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qChip: {
    flexShrink: 0,
    marginHorizontal: theme.sp(1.5),
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
  },
  qChipText: {
    fontSize: theme.fontSize.xs,
    color: mm.colors.inkSoft,
    fontWeight: theme.weight.medium,
  },
  // —— 底部输入行（absolute 贴屏底）——
  inputBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(2),
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(2),
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.sp(11),
    maxHeight: 120,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    fontSize: theme.fontSize.sm,
    color: mm.colors.ink,
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
  },
  sendBtn: {
    width: theme.sp(10),
    height: theme.sp(10),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  sendBtnGrad: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
