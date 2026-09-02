import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { theme } from '../theme/theme';
import Sheet, { SheetHead } from './Sheet';
import Icon from './Icon';
import AiOrb from './AiOrb';
import { pickReply, generateQuestions, type AiTask } from '../data/chat';
import { useAppState } from '../state/AppState';
import { ask, type ChatHistoryItem } from '../ai';
import { RingBle, type RingState } from '../ble/RingBleManager';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialQuestion?: string;
}

interface Message {
  from: 'user' | 'ai';
  text: string;
  task?: AiTask;
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

export default function ChatSheet({ visible, onClose, initialQuestion }: Props) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ringState, setRingState] = useState<RingState | null>(() => RingBle.getState());
  const scrollRef = useRef<ScrollView>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const { addToolTask } = useAppState();

  useEffect(() => {
    const unsubscribe = RingBle.onState((s) => setRingState(s));
    return unsubscribe;
  }, []);

  const suggestedQuestions = useMemo(() => generateQuestions(ringState), [ringState]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
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
        return prev.map((m, i) => (i === idx ? { ...m, task: task ?? m.task } : m));
      });
      addToolTask({
        id: `ai-${Date.now()}`,
        type: task.type,
        badge: '来自 Mira AI',
        title: task.title,
        desc: task.desc,
        action: '开始',
        done: false,
      });
    };

    try {
      await ask(q, { history, onToken });
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
    if (visible && initialQuestion && messages.length === 0) {
      sendMessage(initialQuestion);
    }
  }, [visible, initialQuestion, messages.length, sendMessage]);

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
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingBottom: 0 }}>
      <SheetHead
        title="Mira AI"
        subtitle="你的健康助手"
        onBack={onClose}
        right={<VersionBadge />}
      />

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
                    key={`${q}-${i}`}
                    style={styles.actionChip}
                    onPress={() => sendMessage(q)}
                    activeOpacity={0.8}
                  >
                    <Icon
                      name="sparkle"
                      size={theme.fs(16)}
                      color={theme.colors.accentSolid}
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
            placeholder="询问你的健康数据..."
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
    </Sheet>
  );
}

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
    borderTopColor: 'rgba(124,106,224,0.2)',
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
  },
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
