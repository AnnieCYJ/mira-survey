import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Keyboard,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { LinearGradient } from 'expo-linear-gradient';
import Sheet, { SheetHead } from './Sheet';
import Icon from './Icon';
import AiOrb from './AiOrb';
import { pickReply, generateQuestions, type AiTask } from '../data/chat';
import { useAppState } from '../state/AppState';
import { ask, type ChatHistoryItem } from '../ai';
import { useSpeech } from '../hooks/useSpeech';
import { type RingState } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TaskType } from '../data/tasks';

interface Props {
  visible?: boolean;          // fullScreen 时可选，默认 true
  onClose: () => void;
  initialQuestion?: string;
  fullScreen?: boolean;       // ★ 跳过 Sheet Modal，直接当全屏页面渲染
}

interface Message {
  from: 'user' | 'ai';
  text: string;
  task?: AiTask;
  taskAdded?: boolean;  // 是否已添加到工具页
}

function VersionBadge() {
  return (
    <View style={styles.badge}>
      <View style={styles.badgeDot} />
      <Text style={styles.badgeText}>AI 1.3.2</Text>
      <Icon name="chevronRight" size={theme.fs(12)} color={theme.colors.textSub} strokeWidth={2.2} />
    </View>
  );
}

/** 顶部右侧：版本徽章 + 语音播报开关（喇叭）。喇叭状态来自全局 AppState，首页与问答页共享 */
function HeaderRight({ ttsOn, onToggle }: { ttsOn: boolean; onToggle: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) }}>
      <VersionBadge />
      <TouchableOpacity
        style={styles.speakerBtn}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityLabel="语音播报开关"
      >
        <Icon
          name={ttsOn ? 'speaker' : 'speaker_off'}
          size={theme.fs(20)}
          color={ttsOn ? mm.colors.purpleDeep : theme.colors.textSub}
          strokeWidth={2.2}
        />
      </TouchableOpacity>
    </View>
  );
}

function ChatSheetInner({ visible = true, onClose, initialQuestion, fullScreen }: Props) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ringState: RingState | null = useRingState();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const { addToolTask, ttsOn, setTtsOn } = useAppState();
  const { speak, stop } = useSpeech();
  // ttsOn 经全局共享；用 ref 避免 sendMessage 闭包拿到旧值（sendMessage 未把 ttsOn 列入依赖）
  const ttsOnRef = useRef(ttsOn);
  ttsOnRef.current = ttsOn;
  const toggleTts = useCallback(() => {
    const next = !ttsOnRef.current;
    setTtsOn(next);
    if (!next) stop();
  }, [setTtsOn, stop]);
  type Nav = StackNavigationProp<RootStackParamList>;
  const navigation = useNavigation<Nav>();

  // 打开时生成一次建议问题，避免 ringState 高频推送导致滑动跳跃
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[][]>(() => generateQuestions(ringState));
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setSuggestedQuestions(generateQuestions(ringState));
      // ★ Sheet 打开动画（约 250ms）完成后 focus 输入框，弹起键盘
      const t = setTimeout(() => inputRef.current?.focus(), 280);
      return () => clearTimeout(t);
    }
    prevVisible.current = visible;
  }, [visible, ringState]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    Keyboard.dismiss();
    const q = text.trim();

    const history: ChatHistoryItem[] = messagesRef.current
      .filter((m) => m.text && m.text.length > 0)
      .slice(-10)
      .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }));

    setMessages((prev) => [...prev, { from: 'user', text: q }, { from: 'ai', text: '' }]);
    setInput('');
    setIsLoading(true);

    const onToken = (tok: string) => {
      if (!tok) return;
      setMessages((prev) => {
        const idx = prev.length - 1;
        return prev.map((m, i) => (i === idx ? { ...m, text: m.text + tok } : m));
      });
      scrollRef.current?.scrollToEnd({ animated: true });
    };

    const attachTask = (task?: AiTask) => {
      if (!task) return;
      setMessages((prev) => {
        const idx = prev.length - 1;
        return prev.map((m, i) => (i === idx ? { ...m, task: task ?? m.task, taskAdded: false } : m));
      });
    };

    try {
      await ask(q, {
        history,
        onToken,
        // ★ 回复完整后播报（仅当喇叭开启）：流式逐字播会断句错乱，必须等全文到齐
        onDone: (full) => { if (ttsOnRef.current && full) speak(full); },
      });
      attachTask(pickReply(q).task);
    } catch (e) {
      console.warn('[ChatSheet] MiraAI 出错，回退模板:', e);
      const fb = pickReply(q);
      setMessages((prev) => {
        const idx = prev.length - 1;
        return prev.map((m, i) => (i === idx ? { ...m, text: fb.lines.join('\n'), task: fb.task } : m));
      });
      attachTask(fb.task);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, addToolTask]);

  useEffect(() => {
    if (!visible) return;
    setMessages([]);
    setInput('');
    if (!initialQuestion) return;
    // ★ 延后到页面转场动画结束（≈320ms）再发请求。
    //   端侧大模型（Qwen2.5-1.5B）推理是重活，旧实现用 queueMicrotask 在**挂载瞬间**
    //   就起跑，正好和 push 转场动画抢 JS/UI 线程 → 「跳到 AI 问答页特别卡」。
    //   等动画走完再推理，转场就丝滑了（用户感知不到这 320ms，因为屏幕上已在播转场）。
    const t = setTimeout(() => sendMessage(initialQuestion), 320);
    return () => clearTimeout(t);
  }, [visible]);

  const renderMessage = (msg: Message, idx: number) => {
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
            <View style={styles.taskSuggestion}>
              <Text style={styles.taskSuggestionTitle}>{msg.task.title}</Text>
              <Text style={styles.taskSuggestionDesc}>{msg.task.desc}</Text>
              {msg.taskAdded ? (
                <View style={styles.taskAddedBtn}>
                  <Text style={styles.taskAddedBtnText}>✓ 已添加</Text>
                </View>
              ) : msg.task!.type === 0 ? (
                // ★ 呼吸冥想：主按钮「立即开始」+ 次按钮「添加到工具」
                <View style={styles.taskBtnRow}>
                  <TouchableOpacity
                    style={styles.taskPrimaryWrap}
                    onPress={() => {
                      onClose();
                      setTimeout(() => navigation.navigate('Breathing'), 120);
                    }}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={[mm.colors.limeCore, mm.colors.limeMid]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={styles.taskPrimaryBtn}
                    >
                      <Icon name="breath" size={theme.fs(14)} color="#3F4A0E" strokeWidth={2} />
                      <Text style={styles.taskPrimaryBtnText}>立即开始呼吸 →</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.taskAddBtnSecondary}
                    onPress={() => {
                      addToolTask({
                        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        type: msg.task!.type,
                        badge: '来自 Mira AI',
                        title: msg.task!.title,
                        desc: msg.task!.desc,
                        action: '开始',
                        done: false,
                      });
                      setMessages((prev) =>
                        prev.map((m) =>
                          m === msg ? { ...m, taskAdded: true } : m,
                        ),
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.taskAddBtnSecondaryText}>+ 添加到工具</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.taskAddBtn}
                  onPress={() => {
                    addToolTask({
                      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      type: msg.task!.type,
                      badge: '来自 Mira AI',
                      title: msg.task!.title,
                      desc: msg.task!.desc,
                      action: '开始',
                      done: false,
                    });
                    setMessages((prev) =>
                      prev.map((m) =>
                        m === msg ? { ...m, taskAdded: true } : m,
                      ),
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.taskAddBtnText}>+ 添加到工具</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const sheetHead = (
    <SheetHead
      title="Mira AI"
      subtitle="你的健康助手"
      onBack={onClose}
      right={<HeaderRight ttsOn={ttsOn} onToggle={toggleTts} />}
    />
  );

  const body = (
    <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <AiOrb size={240} title="Hi, can I help you?" />
              <View style={styles.quickActions}>
                {suggestedQuestions.flat().map((q, i) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.actionChip}
                    onPress={() => sendMessage(q)}
                    activeOpacity={0.8}
                  >
                    <Icon
                      name="sparkle"
                      size={theme.fs(16)}
                      color={mm.colors.purpleDeep}
                      strokeWidth={2}
                    />
                    <Text style={styles.actionText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            messages.map(renderMessage)
          )}

          {isLoading ? (
            /* v18.20：加载点装进 AI 气泡（此前三点裸飘在页面上） */
            <View style={styles.msgRow}>
              <View style={styles.aiAvatar}>
                <Icon name="sparkle" size={theme.fs(12)} color={theme.colors.textWhite} strokeWidth={2.4} />
              </View>
              <View style={[styles.msgBubble, styles.aiBubble]}>
                <View style={styles.loadingRow}>
                  <View style={styles.loadingDot} />
                  <View style={[styles.loadingDot, { opacity: 0.6 }]} />
                  <View style={[styles.loadingDot, { opacity: 0.4 }]} />
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: insets.bottom }]}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="询问你的健康数据..."
            placeholderTextColor={theme.colors.textSub}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={200}
            autoFocus
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            disabled={!input.trim()}
            onPress={() => sendMessage(input)}
          >
            {!input.trim() ? null : (
              <LinearGradient
                colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            )}
            <Icon name="send" size={theme.fs(18)} color={input.trim() ? mm.colors.btnTextOnGrad : mm.colors.inkFaint} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
  );

  // ★ fullScreen：直接返回内容（SheetHead + body），不包 Sheet Modal
  //   v18.20：背景白——此前整页饱和紫(bgMid)与 App 其他页的白色语言割裂
  if (fullScreen) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.textWhite }}>
        {sheetHead}
        {body}
      </View>
    );
  }

  // 默认：Sheet Modal 包装（侧滑面板）
  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingBottom: 0 }}>
      {sheetHead}
      {body}
    </Sheet>
  );
}

// React.memo：隔离父组件 ringState 高频推送导致的 re-render
export default React.memo(ChatSheetInner, (prev, next) => {
  return prev.visible === next.visible
      && prev.initialQuestion === next.initialQuestion;
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: theme.space.screen, paddingBottom: theme.space.md },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  badgeDot: {
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.stateCalm,
    marginRight: theme.sp(1.5),
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: theme.colors.textBody,
    marginRight: theme.sp(1),
  },
  speakerBtn: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mm.colors.purpleSoft,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.space.xl },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.sp(2),
    marginTop: theme.space.xl,
    paddingHorizontal: theme.space.screen,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    margin: theme.sp(1),
  },
  actionText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
    marginLeft: theme.sp(1.5),
  },
  msgRow: { flexDirection: 'row', marginBottom: theme.space.md, alignItems: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  aiAvatar: {
    width: theme.sp(6),
    height: theme.sp(6),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.purpleCore,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  msgBubble: {
    maxWidth: '78%',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.md,
  },
  // v18.20：气泡带「尾巴」圆角——用户右下收尖、AI 左下收尖，对话方向更清晰
  userBubble: {
    backgroundColor: mm.colors.purpleBtn,
    borderBottomRightRadius: theme.sp(1),
  },
  aiBubble: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderBottomLeftRadius: theme.sp(1),
  },
  msgText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.6 },
  userText: { color: theme.colors.textWhite },
  aiText: { color: theme.colors.textBody },
  taskSuggestion: {
    marginTop: theme.sp(2),
    paddingTop: theme.sp(2),
    borderTopWidth: 1,
    borderTopColor: 'rgba(31,29,26,0.09)', // v21 §4.8#7：分隔线一律中性灰，紫只留给 AI 身份元素
  },
  taskSuggestionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentText,
  },
  taskSuggestionDesc: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
    marginBottom: theme.sp(2),
  },
  taskBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.sp(2),
    marginTop: theme.sp(1),
  },
  // v21 §4.8 #5：主按钮=黄绿渐变实底、次按钮=白底描边
  taskPrimaryWrap: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    marginTop: theme.sp(1),
  },
  taskPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1.5),
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
  },
  taskPrimaryBtnText: {
    fontSize: theme.fontSize.xs,
    color: '#3F4A0E',
    fontWeight: theme.weight.semibold,
  },
  taskAddBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.textWhite,
    marginTop: theme.sp(1),
  },
  taskAddBtnSecondary: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: 'transparent',
    marginTop: 0,
  },
  taskAddBtnSecondaryText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium,
  },
  taskAddBtnText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTitle,
    fontWeight: theme.weight.semibold,
  },
  taskAddedBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.purpleSoft,
    marginTop: theme.sp(1),
  },
  taskAddedBtnText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    fontWeight: theme.weight.semibold,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) },
  loadingDot: {
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.purpleCore,
    opacity: 0.4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(2),
    // v18.20：输入条垫白 + 顶部细分隔线，白底页面上不再悬浮
    backgroundColor: theme.colors.textWhite,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
  },
  input: {
    flex: 1,
    minHeight: theme.sp(11),
    maxHeight: theme.sp(18),
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    marginRight: theme.sp(2),
  },
  sendBtn: {
    width: theme.sp(11),
    height: theme.sp(11),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(31,29,26,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(31,29,26,0.06)' },
});
