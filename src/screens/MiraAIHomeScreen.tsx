/**
 * MiraAIHomeScreen —— 点击 tab bar 中间 bot 后进入的「Mira AI 首页」。
 *
 * ★ 2026-11-04（用户要求）：做成「更像对话」的 对话式首页——
 *   顶部 Mira 打招呼气泡（与聊天页同源的 AI 气泡样式）+ 一串静态「你可以这样问我」建议问题，
 *   点任意一条直接进入对话。去掉原先自动横向跑马灯（不够像对话）。
 *   - 顶部：左对齐大标题「Mira AI」+ 版本徽章；副标题「你的健康助手」；右上 🔊 喇叭。无返回键。
 *   - 中部：AiOrb 光球 + Mira 打招呼气泡 + 静态建议问题（可点，像 ChatGPT 式开场）。
 *   - 底部：圆角输入框 + 渐变发送圆钮。
 */
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StatusBar,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from '../components/Icon';
import LunaMiraFace from '../components/LunaMiraFace';
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

export default function MiraAIHomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const ringState: RingState | null = useRingState();
  const { ttsOn, setTtsOn } = useAppState();
  const { stop } = useSpeech();
  const [draft, setDraft] = useState('');

  // ★ mira-ocean：深底 → 状态栏亮图标
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));

  const k = questionKey(ringState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => generateQuestions(ringState), [k]);

  // ★ 2026-11-04：把三排问题摊平成「开场建议」，去重后取前 6 条，静态展示可点
  const starters = useMemo(() => {
    const flat: string[] = [];
    rows.forEach((r) => r.forEach((q) => { if (!flat.includes(q)) flat.push(q); }));
    return flat.slice(0, 6);
  }, [rows]);

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

  const inputPadBottom = theme.layout.tabBarHeight + theme.sp(2) + theme.sp(2.5); // 56+8+10 = 74

  return (
    <View style={styles.root}>
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
            <Text style={styles.title}>Luna Mira</Text>
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
            size={theme.fontSize.lg}
            color={ttsOn ? mm.colors.limeDeep : mm.colors.inkFaint}
            strokeWidth={2.2}
          />
        </TouchableOpacity>
      </View>

      {/* 中部：光球 + Mira 打招呼气泡 + 静态建议问题（更像对话） */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentInner, { paddingBottom: inputPadBottom + theme.sp(4) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
          <View style={styles.orbWrap}>
            <LunaMiraFace size={150} />
          </View>

        {/* ★ Luna Mira 打招呼气泡（与聊天页 AI 气泡同源样式） */}
        <View style={styles.greetRow}>
          <LunaMiraFace size={theme.sp(6)} glow={false} />
          <View style={styles.greetBubble}>
            <View style={styles.greetBadge}>
              <Text style={styles.greetBadgeTxt}>Luna Mira</Text>
            </View>
            <Text style={styles.greetText}>
              嗨，我是 Luna Mira 👋 你的健康助手。今天想聊聊身体状态，还是随便问我点什么？
            </Text>
          </View>
        </View>

        <Text style={styles.suggestHeader}>你可以这样问我</Text>
        <View style={styles.chipWrap}>
          {starters.map((q, i) => (
            <TouchableOpacity
              key={`${q}-${i}`}
              style={styles.suggestChip}
              onPress={() => openChat(q)}
              activeOpacity={0.7}
            >
              <Icon name="sparkle" size={theme.fontSize.xs} color={theme.colors.accentText} strokeWidth={2.2} />
              <Text style={styles.suggestChipText} numberOfLines={2}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* 底部输入行：输入框 + 发送渐变圆钮 */}
      <View style={[styles.inputBar, { paddingBottom: inputPadBottom }]}>
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
            <LinearGradient
              colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtnGrad}
            >
              <Icon name="send" size={theme.fontSize.card} color={mm.colors.btnTextOnGrad} />
            </LinearGradient>
          ) : (
            <View style={[styles.sendBtnGrad, { backgroundColor: mm.colors.btnBusyBg }]}>
              <Icon name="send" size={theme.fontSize.card} color={mm.colors.inkFaint} />
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
    backgroundColor: '#0A294F',
  },
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
    paddingVertical: theme.space.xl,
  },
  orbWrap: {
    alignItems: 'center',
    marginTop: theme.sp(2),
    marginBottom: theme.space.lg,
  },
  // —— Mira 打招呼气泡（与聊天页 AI 气泡同源）——
  greetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.space.lg,
  },
  greetAvatar: {
    width: theme.sp(6),
    height: theme.sp(6),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.purpleCore,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  greetBubble: {
    flex: 1,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.sm + 2,
  },
  greetBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    marginBottom: 4,
  },
  greetBadgeTxt: { fontSize: theme.fontSize.tiny, color: theme.colors.accentText, fontWeight: theme.weight.semibold as any },
  greetText: { fontSize: theme.fontSize.body, color: theme.colors.textBody, lineHeight: theme.fontSize.body * 1.5 },
  // —— 静态建议问题（开场，可点）——
  suggestHeader: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium as any,
    marginBottom: theme.space.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp(2),
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '48%',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  suggestChipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textBody,
    fontWeight: theme.weight.medium as any,
    marginLeft: theme.sp(1.5),
    flex: 1,
  },
  // —— 底部输入行（普通 flex 子元素，随 adjustResize 窗口收缩自然停在键盘上方）——
  inputBar: {
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
