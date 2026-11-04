/**
 * OnboardingScreen —— AI 问答式首次资料收集（mira-ocean 深海玻璃风）
 * ---------------------------------------------------------------------------
 * 交互：Mira 以对话气泡逐题提问（性别 / 年龄 / 身高 / 体重 / 作息 / 运动 / 工作节奏），
 *   用户以气泡或选项回应；每答一题 Mira「正在输入」后抛出下一题。全部答完给出小结，点
 *   完成写入 userStore 并回调 onDone 进入主页。
 *
 * 定位：登录后首次进入；之后 AuthGate 依据 onboardingDone 直接放行主页。
 * 字段刻意精简（7 题），贴合用户「不要太多」的要求。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Animated,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { userStore, type UserProfile } from '../data/userStore';

interface Props {
  onDone: () => void;
}

interface Option {
  label: string;
  value: string;
}
interface Question {
  id: string;
  ai: string;
  type: 'choice' | 'number';
  options?: Option[];
  unit?: string;
  placeholder?: string;
  keyboardType?: 'number-pad' | 'default';
}

const QUESTIONS: Question[] = [
  {
    id: 'gender',
    ai: '你好，我是 Mira 👋 先认识一下～ 你的性别是？',
    type: 'choice',
    options: [
      { label: '女', value: 'female' },
      { label: '男', value: 'male' },
      { label: '不愿透露', value: 'undisclosed' },
    ],
  },
  { id: 'age', ai: '你今年多少岁啦？', type: 'number', unit: '岁', placeholder: '请输入年龄', keyboardType: 'number-pad' },
  { id: 'height', ai: '你的身高大概是多少？', type: 'number', unit: 'cm', placeholder: '例如 165', keyboardType: 'number-pad' },
  { id: 'weight', ai: '那体重呢？', type: 'number', unit: 'kg', placeholder: '例如 55', keyboardType: 'number-pad' },
  {
    id: 'sleep',
    ai: '平时的作息习惯更接近哪一种？',
    type: 'choice',
    options: [
      { label: '早睡早起', value: 'early' },
      { label: '经常熬夜', value: 'late' },
      { label: '作息不规律', value: 'irregular' },
    ],
  },
  {
    id: 'exercise',
    ai: '你的运动频率大概是？',
    type: 'choice',
    options: [
      { label: '很少运动', value: 'rare' },
      { label: '每周 1–2 次', value: 'weekly12' },
      { label: '每周 3 次以上', value: 'weekly3plus' },
    ],
  },
  {
    id: 'work',
    ai: '平时的工作 / 生活节奏呢？',
    type: 'choice',
    options: [
      { label: '久坐办公', value: 'sedentary' },
      { label: '经常走动', value: 'active' },
      { label: '高强度奔波', value: 'highintensity' },
    ],
  },
];

type Bubble = { role: 'ai' | 'user'; text: string };

/** ★ 2026-11-04：每答一题后 Mira 的柔和活泼回应（带一点解释，语气轻快） */
const RESPONSES: Record<string, string> = {
  gender: '好呀～ 记下了 🌿 了解这个，能帮我更贴近你的周期节奏。',
  age: '收到～ 年龄会让参考区间更贴合你，不会拿错标准。',
  height: '好嘞，身高记下啦。',
  weight: '嗯嗯，体重也记下咯～',
  sleep: '懂了～ 作息对恢复和情绪影响不小，我会多留意。',
  exercise: '收到！运动是很棒的恢复信号 💪',
  work: '明白～ 工作节奏我会算进你的精力消耗里。',
};

export default function OnboardingScreen({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [bubbles, setBubbles] = useState<Bubble[]>([{ role: 'ai', text: QUESTIONS[0].ai }]);
  const [step, setStep] = useState(0); // 已问到的问题数（= 已展示的题数）
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState(false);
  const [numText, setNumText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'chat' | 'video'>('chat');
  const scrollRef = useRef<ScrollView>(null);
  const dot = useRef(new Animated.Value(0)).current;

  const answeredCount = Object.keys(answers).length;
  const total = QUESTIONS.length;
  const current = step < total ? QUESTIONS[step] : null;

  // 输入中三点动画
  useEffect(() => {
    if (!typing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [typing, dot]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [bubbles, typing]);

  const pushAi = (text: string) =>
    setBubbles((b) => [...b, { role: 'ai', text }]);

  const answer = (q: Question, raw: string) => {
    if (typing) return;
    const label =
      q.type === 'choice'
        ? q.options!.find((o) => o.value === raw)?.label ?? raw
        : `${raw}${q.unit ?? ''}`;
    setAnswers((a) => ({ ...a, [q.id]: raw }));
    setBubbles((b) => [...b, { role: 'user', text: label }]);
    setNumText('');

    const next = step + 1;
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      // ★ 2026-11-04：每答一题，Mira 先给一个柔和活泼的回应，再抛下一题（更像真实对话）
      pushAi(RESPONSES[q.id] ?? '记下了～');
      setTimeout(() => {
        if (next < total) {
          setStep(next);
          pushAi(QUESTIONS[next].ai);
        } else {
          setStep(total);
          pushAi('都了解啦～ 这些信息会帮我更贴近你的身体节奏。准备好开始了吗？');
        }
      }, 950);
    }, 620);
  };

  const finish = async () => {
    setBusy(true);
    const profile: UserProfile = {
      gender: (answers.gender as UserProfile['gender']) ?? undefined,
      age: answers.age ? Number(answers.age) : undefined,
      height: answers.height ? Number(answers.height) : undefined,
      weight: answers.weight ? Number(answers.weight) : undefined,
      sleepHabit: (answers.sleep as UserProfile['sleepHabit']) ?? undefined,
      exerciseHabit: (answers.exercise as UserProfile['exerciseHabit']) ?? undefined,
      workRhythm: (answers.work as UserProfile['workRhythm']) ?? undefined,
    };
    await userStore.completeOnboarding(profile);
    setBusy(false);
    // ★ 2026-11-04：资料保存后不直接进主页，先放一段欢迎视频，看完再进入
    setPhase('video');
  };

  if (phase === 'video') {
    return <OnboardVideoScreen onDone={onDone} />;
  }

  return (
    <View style={s.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StatusBar barStyle="light-content" />

      {/* 顶部标题 + 进度 */}
      <View style={[s.head, { paddingTop: insets.top + theme.space.lg }]}>
        <Text style={s.headTitle}>Mira 想更懂你</Text>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${(answeredCount / total) * 100}%` }]} />
        </View>
        <Text style={s.progressTxt}>{answeredCount} / {total}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.chat, { paddingBottom: theme.space.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {bubbles.map((b, i) =>
          b.role === 'ai' ? <AiBubble key={i} text={b.text} /> : <UserBubble key={i} text={b.text} />,
        )}
        {typing && <TypingBubble dot={dot} />}

        {/* 当前题目作答区 */}
        {current && (
          <View style={s.answerArea}>
            {current.type === 'choice' ? (
              current.options!.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={s.option}
                  activeOpacity={0.85}
                  onPress={() => answer(current, o.value)}
                >
                  <Text style={s.optionTxt}>{o.label}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <View style={s.numRow}>
                <TextInput
                  style={s.numInput}
                  placeholder={current.placeholder}
                  placeholderTextColor={theme.colors.ui.white55}
                  keyboardType={current.keyboardType}
                  maxLength={4}
                  value={numText}
                  onChangeText={setNumText}
                  selectionColor={theme.colors.accentText}
                />
                {current.unit && <Text style={s.numUnit}>{current.unit}</Text>}
                <TouchableOpacity
                  style={[s.numNext, !numText.trim() && s.numNextOff]}
                  activeOpacity={0.85}
                  disabled={!numText.trim()}
                  onPress={() => answer(current, numText.trim())}
                >
                  <Text style={s.numNextTxt}>下一步</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* 完成小结 */}
        {!current && (
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>你的基础档案</Text>
            <View style={s.summaryGrid}>
              <SummaryItem label="性别" value={genderText(answers.gender)} />
              <SummaryItem label="年龄" value={answers.age ? `${answers.age} 岁` : '—'} />
              <SummaryItem label="身高" value={answers.height ? `${answers.height} cm` : '—'} />
              <SummaryItem label="体重" value={answers.weight ? `${answers.weight} kg` : '—'} />
              <SummaryItem label="作息" value={habitText('sleep', answers.sleep)} />
              <SummaryItem label="运动" value={habitText('exercise', answers.exercise)} />
              <SummaryItem label="节奏" value={habitText('work', answers.work)} span />
            </View>
            <TouchableOpacity style={[s.finishBtn, busy && s.finishBtnOff]} activeOpacity={0.85} disabled={busy} onPress={finish}>
              <LinearGradient colors={[...theme.colors.aiBadgeGrad]} style={StyleSheet.absoluteFill} pointerEvents="none" />
              <Text style={s.finishTxt}>{busy ? '保存中…' : '完成，开始体验'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** ★ 2026-11-04：资料收集完成后的欢迎视频页（问答之后播放，看完点「进入 Mira」进主页） */
function OnboardVideoScreen({ onDone }: { onDone: () => void }) {
  return (
    <View style={s.videoRoot}>
      <Video
        source={require('../assets/onboarding/onboard_welcome.mp4')}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        isLooping
        shouldPlay
      />
      <View style={s.videoScrim} />
      <TouchableOpacity style={s.videoEnter} activeOpacity={0.85} onPress={onDone}>
        <Text style={s.videoEnterTxt}>进入 Mira →</Text>
      </TouchableOpacity>
    </View>
  );
}

function AiBubble({ text }: { text: string }) {
  return (
    <View style={s.aiRow}>
      <View style={s.aiAvatar}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
          <Path d="M5 13a7 7 0 0 1 14 0" />
          <Circle cx={9} cy={11} r={1.1} fill="#fff" stroke="none" />
          <Circle cx={15} cy={11} r={1.1} fill="#fff" stroke="none" />
        </Svg>
      </View>
      <View style={s.aiBubble}>
        <View style={s.aiBadge}>
          <Text style={s.aiBadgeTxt}>Mira</Text>
        </View>
        <Text style={s.aiText}>{text}</Text>
      </View>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View style={s.userRow}>
      <View style={s.userBubble}>
        <Text style={s.userText}>{text}</Text>
      </View>
    </View>
  );
}

function TypingBubble({ dot }: { dot: Animated.Value }) {
  return (
    <View style={s.aiRow}>
      <View style={s.aiAvatar}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
          <Path d="M5 13a7 7 0 0 1 14 0" />
          <Circle cx={9} cy={11} r={1.1} fill="#fff" stroke="none" />
          <Circle cx={15} cy={11} r={1.1} fill="#fff" stroke="none" />
        </Svg>
      </View>
      <View style={s.aiBubble}>
        <View style={s.typingDots}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                s.typingDot,
                {
                  opacity: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: i === 0 ? [0.3, 1] : i === 1 ? [0.5, 1] : [0.3, 0.6],
                  }),
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function SummaryItem({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <View style={[s.sumItem, span && s.sumItemSpan]}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={s.sumValue}>{value}</Text>
    </View>
  );
}

function genderText(v?: string) {
  if (v === 'female') return '女';
  if (v === 'male') return '男';
  if (v === 'undisclosed') return '不愿透露';
  return '—';
}
function habitText(kind: 'sleep' | 'exercise' | 'work', v?: string) {
  const map: Record<string, string> = {
    early: '早睡早起',
    late: '经常熬夜',
    irregular: '作息不规律',
    rare: '很少运动',
    weekly12: '每周 1–2 次',
    weekly3plus: '每周 3 次以上',
    sedentary: '久坐办公',
    active: '经常走动',
    highintensity: '高强度奔波',
  };
  return v ? map[v] ?? '—' : '—';
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgBottom },
  head: { paddingHorizontal: theme.space.card, paddingBottom: theme.space.md },
  headTitle: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.space.sm },
  progressTrack: { height: 5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBgSoft, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: theme.colors.accentSolid, borderRadius: theme.radius.pill },
  progressTxt: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.space.xs, textAlign: 'right' },
  chat: { paddingHorizontal: theme.space.card },
  aiRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: theme.space.md },
  aiAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.xs,
  },
  aiBubble: {
    maxWidth: '82%',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.sm + 2,
  },
  aiBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    marginBottom: 4,
  },
  aiBadgeTxt: { fontSize: theme.fontSize.tiny, color: theme.colors.accentText, fontWeight: theme.weight.semibold as any },
  aiText: { fontSize: theme.fontSize.body, color: theme.colors.textBody, lineHeight: theme.fontSize.body * 1.5 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.space.md },
  userBubble: {
    maxWidth: '78%',
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.card,
    padding: theme.space.sm + 2,
  },
  userText: { fontSize: theme.fontSize.body, color: '#fff', fontWeight: theme.weight.medium as any },
  typingDots: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.textSub, marginHorizontal: 3 },
  answerArea: { marginTop: theme.space.md },
  option: {
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm + 2,
    paddingHorizontal: theme.space.card,
    marginBottom: theme.space.xs,
  },
  optionTxt: { fontSize: theme.fontSize.body, color: theme.colors.textTitle, fontWeight: theme.weight.medium as any },
  numRow: { flexDirection: 'row', alignItems: 'center' },
  numInput: {
    flex: 1,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.sm,
    height: 48,
    color: theme.colors.textTitle,
    fontSize: theme.fontSize.body,
  },
  numUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginHorizontal: theme.space.xs },
  numNext: {
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: theme.space.xs,
  },
  numNextOff: { opacity: 0.5 },
  numNextTxt: { color: '#fff', fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any },
  summaryCard: {
    marginTop: theme.space.lg,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
  },
  summaryTitle: { fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.space.sm },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  sumItem: { width: '33.33%', marginBottom: theme.space.sm },
  sumItemSpan: { width: '100%' },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  sumValue: { fontSize: theme.fontSize.body, color: theme.colors.textTitle, fontWeight: theme.weight.medium as any, marginTop: 2 },
  finishBtn: {
    height: 50,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space.sm,
    overflow: 'hidden',
  },
  finishBtnOff: { opacity: 0.6 },
  finishTxt: { color: '#fff', fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any },
  // —— 欢迎视频页 ——
  videoRoot: { flex: 1, backgroundColor: '#000' },
  videoScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 150,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoEnter: {
    position: 'absolute',
    left: theme.space.card,
    right: theme.space.card,
    bottom: theme.space.xl,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.ui.white92,
    borderWidth: 1,
    borderColor: theme.colors.ui.white55,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  videoEnterTxt: { color: theme.colors.bgBottom, fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any },
});
