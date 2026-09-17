import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { theme } from '../theme/theme';
import OrbDots from '../components/OrbDots';
import Icon from '../components/Icon';
import { generateQuestions, pickReply, type AiTask } from '../data/chat';
import { ask } from '../ai';
import { RingBle, type RingState } from '../ble/RingBleManager';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useSpeech } from '../hooks/useSpeech';
import { useAppState } from '../state/AppState';

export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { addToolTask } = useAppState();

  // ===== Ring BLE =====
  const [ringState, setRingState] = useState<RingState | null>(() => RingBle.getState());
  useEffect(() => {
    let pending: RingState | null = null;
    let scheduled = false;
    const throttled = (s: RingState) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRingState(pending);
        });
      }
    };
    const unsubscribe = RingBle.onState(throttled);
    return unsubscribe;
  }, []);
  // 🔥 依赖 key 稳定化：ringState 对象每次 BLE emit 都是新引用 → useMemo 失效
  // 只对比真正影响问题生成的字段
  const ringKey = ringState
    ? `${ringState.curveStatus?.phaseLabel ?? ''}|${ringState.curveStatus?.dayInCycle ?? 0}|${ringState.curveStatus?.hasLog ?? 0}|${ringState.todayStatus?.score ?? 0}`
    : '';
  const questions = useMemo(() => generateQuestions(ringState), [ringKey]);

  // ===== Chat state =====
  const [messages, setMessages] = useState<{ from: 'user' | 'ai'; text: string; task?: AiTask; taskAdded?: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const voice = useVoiceInput();
  const speech = useSpeech();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const prevLoadingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // ===== autoOpen from TabBar long-press =====
  const lastAutoOpenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const text = route.params?.autoOpen;
    if (text && text !== lastAutoOpenRef.current) {
      lastAutoOpenRef.current = text;
      console.log("[PERF] T7 Focus 收到 autoOpen → sendMessage");
      setTimeout(() => sendMessage(text), 50);
    }
  }, [route.params?.autoOpen]);

  // ===== AI 完成 → 自动朗读 =====
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading && autoSpeak) {
      const lastAi = messagesRef.current.slice().reverse().find((m) => m.from === 'ai' && m.text?.trim());
      if (lastAi?.text) speech.speak(lastAi.text);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, autoSpeak, speech]);

  // ===== 自动滚到底 =====
  useEffect(() => {
    if (messages.length > 0 || isLoading) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages, isLoading]);

  // ===== sendMessage =====
  const sendMessage = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || isLoading) return;

    const userMsg = { from: 'user' as const, text };
    const aiPlaceholder = { from: 'ai' as const, text: '' };
    setMessages((prev) => [...prev, userMsg, aiPlaceholder]);
    console.log("[PERF] T8 sendMessage: 用户气泡添加完毕，开始 ask()"); setIsLoading(true);

    // 简易 history：最后 6 条（不包含刚加的 user + ai placeholder）
    const history = messagesRef.current.slice(-6).map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text } as const));
    // 🔥 批量 flush：onToken 只写 ref，每 50ms 才 setMessages 一次（20fps，肉眼无感知）
    // 原来每 token 都 setState → 150 token = 150 次全量 re-render → 卡爆
    const pendingTextRef = { text: '' };
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let firstTokenLogged = false;

    const flushPending = () => {
      if (pendingTextRef.text === '') return;
      const toAppend = pendingTextRef.text;
      pendingTextRef.text = '';
      setMessages((prev) => {
        const idx = prev.length - 1;
        const last = prev[idx];
        if (last && last.from === 'ai') {
          return [...prev.slice(0, -1), { ...last, text: (last.text || '') + toAppend }];
        }
        return prev;
      });
    };

    const onToken = (token: string) => {
      if (!firstTokenLogged) { firstTokenLogged = true; console.log("[PERF] T9 首 token 到达（prefill 完成）"); }
      pendingTextRef.text += token;
      if (!flushTimer) {
        flushTimer = setInterval(() => {
          flushPending();
        }, 50); // 20fps 节流
      }
    };

    try {
      console.log("[PERF] T8.5 ask() 开始 prefill..."); await ask(text, { history, onToken });
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; flushPending(); }
      console.log("[PERF] T10 ask() 全部完成");
      const reply = pickReply(text);
      if (reply.task) {
        setMessages((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, task: reply.task } : m));
      }
    } catch (e) {
      console.warn('[Focus] MiraAI error, fallback:', e);
      const fb = pickReply(text);
      setMessages((prev) => prev.map((m, i) => i === prev.length - 1 ? { ...m, text: fb.lines.join('\n'), task: fb.task } : m));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // ===== 三排问题卡点击 =====
  const handleQuestionTap = (question: string) => {
    setTimeout(() => sendMessage(question), 0);
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: theme.sp(2) + theme.layout.tabBarHeight + theme.sp(2) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* === 顶部标题 + 喇叭 === */}
          <View style={styles.head}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Mira AI</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>1.3</Text>
              </View>
            </View>
            <View style={styles.subRow}>
              <Text style={styles.sub}>你的健康助手</Text>
              <TouchableOpacity
                onPress={() => {
                  if (speech.state === 'speaking') speech.stop();
                  else setAutoSpeak((v) => !v);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon
                  name={autoSpeak ? 'speaker' : 'ring'}
                  size={theme.fs(20)}
                  color={autoSpeak ? theme.colors.accentSolid : theme.colors.textSub}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            </View>
          </View>

          <OrbDots />

          {/* === 三排问题卡 === */}
          <View style={styles.questions}>
            {questions.map((row, i) => (
              <QuestionRow key={i} row={row} index={i} scrollRight={i % 2 === 0} onPress={handleQuestionTap} />
            ))}
          </View>

          {/* === 对话气泡（问题卡下方自然衔接）=== */}
          {messages.length > 0 || isLoading ? (
            <View style={styles.chatArea}>
              <View style={styles.chatDivider} />
              {messages.map((msg, idx) => {
                const isUser = msg.from === 'user';
                return (
                  <View key={idx} style={[styles.msgRow, isUser ? styles.userRow : styles.aiRow]}>
                    {!isUser ? (
                      <View style={styles.aiAvatar}>
                        <Icon name="sparkle" size={theme.fs(12)} color={theme.colors.textWhite} strokeWidth={2.4} />
                      </View>
                    ) : null}
                    <View style={[styles.msgBubble, isUser ? styles.userBubble : styles.aiBubble]}>
                      <Text style={[styles.msgText, isUser ? styles.userText : styles.aiText]}>{msg.text}</Text>
                      {msg.task ? (
                        <View style={styles.taskRow}>
                          <Text style={styles.taskTitle}>{msg.task.title}</Text>
                          <Text style={styles.taskDesc}>{msg.task.desc}</Text>
                          <TouchableOpacity
                            style={styles.taskBtn}
                            onPress={() => {
                              addToolTask({
                                id: `ai-${Date.now()}`,
                                type: msg.task!.type,
                                badge: '来自 Mira AI',
                                title: msg.task!.title,
                                desc: msg.task!.desc,
                                action: '开始',
                                done: false,
                              });
                            }}
                          >
                            <Text style={styles.taskBtnText}>+ 添加到工具</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              {isLoading ? (
                <View style={styles.loadingRow}>
                  <View style={styles.loadingDot} />
                  <View style={[styles.loadingDot, { opacity: 0.6 }]} />
                  <View style={[styles.loadingDot, { opacity: 0.4 }]} />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* === 底部输入行 === */}
        <View style={[styles.inputRow, { paddingBottom: theme.sp(2) + theme.layout.tabBarHeight + theme.sp(2) }]}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={voice.state === 'listening' ? '正在听...' : '问我任何健康问题'}
            placeholderTextColor={theme.colors.textSub}
            value={voice.state === 'listening' ? voice.transcript : input}
            onChangeText={setInput}
            multiline
            maxLength={200}
            blurOnSubmit={false}
            editable={voice.state !== 'listening'}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !(voice.state === 'listening' ? voice.transcript.trim() : input.trim()) && styles.sendBtnDisabled]}
            disabled={!(voice.state === 'listening' ? voice.transcript.trim() : input.trim()) || voice.state === 'listening'}
            onPress={() => {
              const q = input.trim();
              if (q) { sendMessage(q); setInput(''); }
            }}
          >
            <Icon
              name="send"
              size={theme.fs(18)}
              color={theme.colors.textWhite}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPressIn={async () => {
              inputRef.current?.blur();
              await speech.stop();
              await voice.start();
            }}
            onPressOut={async () => {
              const t = voice.transcript;
              await voice.stop();
              if (t?.trim()) {
                setInput(t);
                setTimeout(() => { sendMessage(t.trim()); setInput(''); }, 200);
              }
            }}
            delayPressIn={0}
            style={[styles.micBtn, voice.state === 'listening' && styles.micBtnActive]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon
              name="mic"
              size={theme.fs(20)}
              color={voice.state === 'listening' ? theme.colors.textWhite : theme.colors.textSub}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(14),
    paddingBottom: theme.space.lg,
  },
  head: { marginBottom: theme.space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  badge: {
    marginLeft: theme.sp(2),
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
  },
  sub: { fontSize: theme.fontSize.sm, color: theme.colors.textWhite70, marginTop: theme.sp(1) },
  questions: { marginTop: theme.space.md },
  marqueeContainer: {
    width: '100%',
    overflow: 'hidden',
    marginBottom: theme.sp(2.5),
  },
  marqueeTrack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    marginRight: theme.sp(2),
    maxWidth: 188,
  },
  qText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(2.5),
    paddingBottom: theme.sp(2.5),
  },
  inputWrap: {
    flex: 1,
    height: theme.sp(12),
    justifyContent: 'center',
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(247,246,252,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    marginRight: theme.sp(2),
  },
  inputPlaceholder: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  input: {
    flex: 1,
    minHeight: theme.sp(12),
    maxHeight: theme.sp(20),
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(247,246,252,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    marginRight: theme.sp(2),
  },
  // ===== 消息气泡 =====
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chatArea: { marginTop: theme.space.lg },
  chatDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: theme.space.md },
  msgRow: { flexDirection: 'row', marginBottom: theme.space.md, alignItems: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  aiAvatar: { width: theme.sp(6), height: theme.sp(6), borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent1, alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2) },
  msgBubble: { maxWidth: '80%', paddingHorizontal: theme.space.md, paddingVertical: theme.sp(2.5), borderRadius: theme.radius.card },
  userBubble: { backgroundColor: theme.colors.accent1, borderBottomRightRadius: theme.sp(2) },
  aiBubble: { backgroundColor: 'rgba(255,255,255,0.85)', borderBottomLeftRadius: theme.sp(2) },
  msgText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.5 },
  userText: { color: theme.colors.textWhite },
  aiText: { color: theme.colors.textBody },

  // ===== 任务建议 =====
  taskRow: { marginTop: theme.sp(2), paddingTop: theme.sp(2), borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.1)' },
  taskTitle: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: theme.colors.textBody },
  taskDesc: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  taskBtn: { marginTop: theme.sp(1.5), alignSelf: 'flex-start', paddingHorizontal: theme.space.md, paddingVertical: theme.sp(1), borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid },
  taskBtnText: { fontSize: theme.fontSize.xs, color: theme.colors.textWhite, fontWeight: theme.weight.medium },

  // ===== Loading =====
  loadingRow: { flexDirection: 'row', paddingHorizontal: theme.space.sm, marginBottom: theme.space.md },
  loadingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.7)', marginRight: 6 },

  // ===== mic 按钮 =====
  micBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 6, backgroundColor: theme.colors.ui.offTrack },
  micBtnActive: { backgroundColor: theme.colors.accentSolid },

  sendBtnDisabled: { opacity: 0.5 },
  sendBtn: {
    width: theme.sp(12),
    height: theme.sp(12),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface QuestionRowProps {
  row: string[];
  index: number;
  scrollRight: boolean;
  onPress: (q: string) => void;
}

const SCREEN_W = Dimensions.get('window').width;
// 估算单个 chip 占位（maxWidth + marginRight）
const CHIP_SLOT = 188 + theme.sp(2);
// 保证一组内容宽度超过屏幕宽度，避免滚动时出现空白
const REPEAT = Math.max(3, Math.ceil(SCREEN_W / CHIP_SLOT) + 1);

function QuestionRow({ row, index, scrollRight, onPress }: QuestionRowProps) {
  const scrollX = useRef(new Animated.Value(0)).current;
  const [groupWidth, setGroupWidth] = useState(0);

  // 一组内容：把原始问题重复 REPEAT 次
  const groupItems = React.useMemo(
    () => Array.from({ length: REPEAT }).flatMap((_, r) => row.map((q, i) => ({ q, key: `${r}-${i}` }))),
    [row]
  );

  useEffect(() => {
    if (groupWidth === 0) return;
    // 向右滚：从 -groupWidth 滚动到 0（新内容从左侧进入）
    // 向左滚：从 0 滚动到 -groupWidth（新内容从右侧进入）
    const from = scrollRight ? -groupWidth : 0;
    const to = scrollRight ? 0 : -groupWidth;
    scrollX.setValue(from);

    const loop = Animated.loop(
      Animated.timing(scrollX, {
        toValue: to,
        duration: 16000 + index * 1800, // 每排速度略有差异，更自然
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const t = setTimeout(() => loop.start(), index * 350);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [groupWidth, scrollRight, index, scrollX]);

  const onTrackLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    // track 里有两组内容，单组宽度为总宽度的一半
    setGroupWidth(e.nativeEvent.layout.width / 2);
  };

  const renderChips = () =>
    groupItems.map(({ q, key }) => (
      <TouchableOpacity key={key} style={styles.qChip} onPress={() => onPress(q)} activeOpacity={0.8}>
        <Text style={styles.qText} numberOfLines={1}>
          {q}
        </Text>
      </TouchableOpacity>
    ));

  return (
    <View style={styles.marqueeContainer}>
      <Animated.View onLayout={onTrackLayout} style={[styles.marqueeTrack, { transform: [{ translateX: scrollX }] }]}>
        {renderChips()}
        {renderChips()}
      </Animated.View>
    </View>
  );
}
