import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import Icon from '../components/Icon';
import { pickReply, generateQuestions, type AiTask } from '../data/chat';
import { RingBle, type RingState } from '../ble/RingBleManager';
import { useAppState } from '../state/AppState';
import { ask, type ChatHistoryItem } from '../ai';
import { RootStackParamList } from '../navigation/RootStackNavigator';

interface Message {
  from: 'user' | 'ai';
  text: string;
  task?: AiTask;
  taskAdded?: boolean;
}

type ChatRouteProp = RouteProp<RootStackParamList, 'Chat'>;
type ChatNavProp = StackNavigationProp<RootStackParamList, 'Chat'>;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<ChatRouteProp>();
  const navigation = useNavigation<ChatNavProp>();
  const initialQuestion = route.params?.initialQuestion;

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const { addToolTask } = useAppState();

  const [ringState, setRingState] = useState<RingState | null>(() => RingBle.getState());
  useEffect(() => {
    const unsubscribe = RingBle.onState((s) => setRingState(s));
    return unsubscribe;
  }, []);
  const suggestedQuestions = generateQuestions(ringState);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const q = text.trim();

    // 取本次之前的历史（最近 10 条有效消息），供模型上下文
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
        const idx = prev.length - 1; // 刚追加的 ai 占位气泡
        return prev.map((m, i) => (i === idx ? { ...m, text: m.text + tok } : m));
      });
      scrollRef.current?.scrollToEnd({ animated: true });
    };

    try {
      await ask(q, { history, onToken });
      // 沿用原模板的关键词命中，保留"放到工具页"任务建议
      const task = pickReply(q).task;
      setMessages((prev) => {
        const idx = prev.length - 1;
        return prev.map((m, i) => (i === idx ? { ...m, task: task ?? m.task } : m));
      });
    } catch (e) {
      console.warn('[ChatScreen] MiraAI 出错，回退关键词模板:', e);
      const fb = pickReply(q);
      setMessages((prev) => {
        const idx = prev.length - 1;
        return prev.map((m, i) =>
          i === idx ? { ...m, text: fb.lines.join('\n'), task: fb.task } : m
        );
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const addTaskToTools = useCallback(
    (idx: number) => {
      const msg = messages[idx];
      if (!msg?.task || msg.taskAdded) return;
      const added = addToolTask({
        id: `ai-${Date.now()}-${idx}`,
        type: msg.task.type,
        badge: '来自 Mira AI',
        title: msg.task.title,
        desc: msg.task.desc,
        action: '开始',
        done: false,
      });
      if (added) {
        setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, taskAdded: true } : m)));
      }
    },
    [messages, addToolTask]
  );

  useEffect(() => {
    if (initialQuestion && messages.length === 0) {
      sendMessage(initialQuestion);
    }
  }, [initialQuestion, messages.length, sendMessage]);

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
              <TouchableOpacity
                style={[styles.addTaskBtn, msg.taskAdded && styles.addTaskBtnDone]}
                onPress={() => addTaskToTools(idx)}
                disabled={msg.taskAdded}
                activeOpacity={0.85}
              >
                <Icon
                  name={msg.taskAdded ? 'check' : 'plus'}
                  size={theme.fs(14)}
                  color={msg.taskAdded ? theme.colors.stateCalm : theme.colors.textWhite}
                  strokeWidth={2.4}
                />
                <Text style={[styles.addTaskText, msg.taskAdded && styles.addTaskTextDone]}>
                  {msg.taskAdded ? '已放入工具页面' : '放到工具页面'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Icon name="chevronLeft" size={theme.fs(24)} color={theme.colors.textWhite} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Mira AI</Text>
          <Text style={styles.headerSub}>你的健康助手</Text>
        </View>
        <View style={styles.versionBadge}>
          <Text style={styles.versionText}>1.2</Text>
        </View>
      </View>

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
              <Icon name="sparkle" size={theme.fs(48)} color="rgba(255,255,255,0.72)" strokeWidth={2} />
              <Text style={styles.emptyText}>Hi, can I help you?</Text>
              <View style={styles.qWrap}>
                {suggestedQuestions.flat().map((q, i) => (
                  <TouchableOpacity
                    key={`${q}-${i}`}
                    style={styles.qChip}
                    onPress={() => sendMessage(q)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.qChipText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            messages.map(renderMessage)
          )}

          {isLoading ? (
            <View style={styles.loadingRow}>
              <View style={styles.loadingDot} />
              <View style={[styles.loadingDot, { opacity: 0.6 }]} />
              <View style={[styles.loadingDot, { opacity: 0.4 }]} />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + theme.space.sm }]}>
          <TextInput
            style={styles.input}
            placeholder="问 Mira 任何事..."
            placeholderTextColor={theme.colors.textSub}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={200}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            disabled={!input.trim()}
            onPress={() => sendMessage(input)}
          >
            <Icon name="send" size={theme.fs(18)} color={input.trim() ? theme.colors.textWhite : theme.colors.textSub} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgTop },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(14),
    paddingBottom: theme.sp(4),
  },
  backBtn: {
    width: theme.sp(11),
    height: theme.sp(11),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  headerSub: { fontSize: theme.fontSize.sm, color: theme.colors.textWhite70, marginTop: theme.sp(1) },
  versionBadge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  versionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: theme.space.screen, paddingBottom: theme.space.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.space.xl },
  emptyText: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
    marginTop: theme.space.md,
    textShadowColor: 'rgba(80,62,142,0.25)',
    textShadowOffset: { width: 0, height: 1 },
  },
  qWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: theme.space.screen,
    marginTop: theme.space.xl,
  },
  qChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    margin: theme.sp(1),
    maxWidth: 200,
  },
  qChipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium,
    textShadowRadius: 12,
  },
  msgRow: { flexDirection: 'row', marginBottom: theme.space.md, alignItems: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  aiAvatar: {
    width: theme.sp(6),
    height: theme.sp(6),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent1,
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
  userBubble: { backgroundColor: theme.colors.accentSolid },
  aiBubble: {
    backgroundColor: theme.colors.cardBgStrong,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  msgText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.6 },
  userText: { color: theme.colors.textWhite },
  aiText: { color: theme.colors.textBody },
  taskSuggestion: {
    marginTop: theme.sp(2),
    paddingTop: theme.sp(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.ui.accentSoft20,
  },
  taskSuggestionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  taskSuggestionDesc: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
    marginBottom: theme.sp(2),
  },
  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent1,
  },
  addTaskBtnDone: { backgroundColor: 'rgba(111,207,180,0.14)' },
  addTaskText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
    marginLeft: theme.sp(1.5),
  },
  addTaskTextDone: { color: theme.colors.ui.successText },
  loadingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.sp(2), paddingLeft: theme.sp(2) },
  loadingDot: {
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent1,
    marginHorizontal: 2,
    opacity: 0.4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.sp(2),
    backgroundColor: theme.colors.cardBgStrong,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  input: {
    flex: 1,
    minHeight: theme.sp(11),
    maxHeight: theme.sp(18),
    backgroundColor: 'rgba(247,246,252,0.7)',
    borderRadius: theme.radius.pill,
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
    backgroundColor: theme.colors.accent1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: theme.colors.ui.accentSoft20 },
});
