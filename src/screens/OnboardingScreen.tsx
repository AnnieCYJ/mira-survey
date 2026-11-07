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
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { userStore, type UserProfile } from '../data/userStore';
import { saveCycleLog } from '../data/cycleLog';
import LunaMiraFace from '../components/LunaMiraFace';

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
  defaultText?: string;
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

/** ★ 本轮（用户 #259）：女性专属生理期追问 —— 选「女」后追加在基础 7 题之后 */
const PERIOD_QUESTIONS: Question[] = [
  { id: 'periodStart', ai: '了解～ 最近一次生理期，大概是几天前开始的？', type: 'number', unit: '天前', placeholder: '例如 14', keyboardType: 'number-pad' },
  { id: 'periodDuration', ai: '那一次持续了几天呢？', type: 'number', unit: '天', placeholder: '例如 5', keyboardType: 'number-pad' },
  {
    id: 'periodRegular',
    ai: '你的周期一般规律吗？',
    type: 'choice',
    options: [
      { label: '规律', value: 'regular' },
      { label: '不太规律', value: 'irregular' },
    ],
  },
  { id: 'periodCycle', ai: '那平均周期大概是几天？（常见 28 天左右）', type: 'number', unit: '天', placeholder: '28', defaultText: '28', keyboardType: 'number-pad' },
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
  periodStart: '收到～ 这个时间点帮我定位周期起点。',
  periodDuration: '好嘞，持续天数记下啦。',
  periodRegular: '明白，规律与否我都会留意。',
  periodCycle: '记下了，平均周期会帮我更稳妥地预判下次时间。',
};

export default function OnboardingScreen({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [bubbles, setBubbles] = useState<Bubble[]>([{ role: 'ai', text: QUESTIONS[0].ai }]);
  const [step, setStep] = useState(0); // 已问到的问题数（= 已展示的题数）
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState(false);
  const [numText, setNumText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const dot = useRef(new Animated.Value(0)).current;

  // ★ 本轮（用户 #259）：选「女」时在基础 7 题之后追加生理期追问
  const Q = answers.gender === 'female' ? [...QUESTIONS, ...PERIOD_QUESTIONS] : QUESTIONS;
  const answeredCount = Object.keys(answers).length;
  const total = Q.length;
  const current = step < total ? Q[step] : null;

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
    Keyboard.dismiss(); // ★ 2026-11-04：用户输完即收起键盘，避免遮挡对话
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
        if (next < Q.length) {
          const nq = Q[next];
          setStep(next);
          // ★ 本轮（用户 #259）：有 defaultText 的数字题预填（如周期天数默认 28）
          setNumText(nq.type === 'number' && nq.defaultText ? nq.defaultText : '');
          pushAi(nq.ai);
        } else {
          setStep(total);
          setNumText('');
          pushAi('都了解啦～ 这些信息会帮我更贴近你的身体节奏。准备好开始了吗？');
        }
      }, 950);
    }, 620);
  };

  const finish = async () => {
    setBusy(true);
    // ★ 本轮（用户 #259）：女性 → 由「几天前开始 / 持续几天 / 规律 / 周期天数」推算起止日期并写入
    let period: UserProfile['period'];
    if (answers.gender === 'female') {
      const daysAgo = answers.periodStart ? Number(answers.periodStart) : undefined;
      const duration = answers.periodDuration ? Number(answers.periodDuration) : undefined;
      const todayMs = Date.now();
      const startMs =
        daysAgo != null && Number.isFinite(daysAgo) ? todayMs - daysAgo * 86400000 : undefined;
      const endMs =
        startMs != null && duration != null && Number.isFinite(duration)
          ? startMs + duration * 86400000
          : undefined;
      period = {
        lastStart: startMs != null ? isoDate(startMs) : undefined,
        lastEnd: endMs != null ? isoDate(endMs) : undefined,
        regular: answers.periodRegular === 'regular',
        cycleDays: answers.periodCycle ? Number(answers.periodCycle) : 28,
      };
    }
    const profile: UserProfile = {
      gender: (answers.gender as UserProfile['gender']) ?? undefined,
      age: answers.age ? Number(answers.age) : undefined,
      height: answers.height ? Number(answers.height) : undefined,
      weight: answers.weight ? Number(answers.weight) : undefined,
      sleepHabit: (answers.sleep as UserProfile['sleepHabit']) ?? undefined,
      exerciseHabit: (answers.exercise as UserProfile['exerciseHabit']) ?? undefined,
      workRhythm: (answers.work as UserProfile['workRhythm']) ?? undefined,
      period,
    };
    await userStore.completeOnboarding(profile);
    // ★ 本轮（用户 #259）：回写周期记录——把最近一次生理期起点 + 周期长度写入 cycleLog，
    //   供周期相位预测（月相环 / 阶段底色）直接使用，与用户后续在周期页手动补记同源。
    if (period?.lastStart) {
      const duration = answers.periodDuration ? Number(answers.periodDuration) : undefined;
      await saveCycleLog({
        lastPeriodStart: period.lastStart,
        cycleLength: period.cycleDays ?? 28,
        periodLength: duration != null && Number.isFinite(duration) ? duration : 5,
        lutealLength: 14,
        cycleLengthCustom: true,
      });
    }
    setBusy(false);
    // ★ 2026-11-05：去掉欢迎视频，资料保存后直接进主页
    onDone();
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

      {/* 顶部标题 + 进度 */}
      <View style={[s.head, { paddingTop: insets.top + theme.space.lg }]}>
        <Text style={s.headTitle}>Mira 想更懂你</Text>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${(answeredCount / total) * 100}%` }]} />
        </View>
        <Text style={s.progressTxt}>{answeredCount} / {total}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + theme.space.lg}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[s.chat, { paddingBottom: theme.space.xl + 140 }]}
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
                  selectionColor={mm.colors.ink}
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
              {/* ★ 本轮（用户 #259）：女性 → 在小结里展示生理期信息 */}
              {answers.gender === 'female' ? (
                <>
                  <SummaryItem label="最近一次" value={answers.periodStart ? `${answers.periodStart} 天前` : '—'} />
                  <SummaryItem label="持续" value={answers.periodDuration ? `${answers.periodDuration} 天` : '—'} />
                  <SummaryItem label="规律" value={answers.periodRegular === 'regular' ? '规律' : '不太规律'} />
                  <SummaryItem label="周期" value={`${answers.periodCycle ?? '28'} 天`} />
                </>
              ) : null}
            </View>
            <TouchableOpacity style={[s.finishBtn, busy && s.finishBtnOff]} activeOpacity={0.85} disabled={busy} onPress={finish}>
              <Text style={s.finishTxt}>{busy ? '保存中…' : '完成，开始体验'}</Text>
            </TouchableOpacity>
          </View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function AiBubble({ text }: { text: string }) {
  return (
    <View style={s.aiRow}>
      <LunaMiraFace size={30} glow={false} />
      <View style={s.aiBubble}>
        <View style={s.aiBadge}>
          <Text style={s.aiBadgeTxt}>Luna Mira</Text>
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
      <LunaMiraFace size={30} glow={false} />
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

/** 时间戳 → YYYY-MM-DD（本地日期，用于生理期起止日期存储） */
function isoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  progressFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: theme.radius.pill },
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
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    marginBottom: 4,
  },
  aiBadgeTxt: { fontSize: theme.fontSize.tiny, color: '#132A4A', fontWeight: theme.weight.semibold as any },
  aiText: { fontSize: theme.fontSize.body, color: theme.colors.textBody, lineHeight: theme.fontSize.body * 1.5 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.space.md },
  userBubble: {
    maxWidth: '78%',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.card,
    padding: theme.space.sm + 2,
  },
  userText: { fontSize: theme.fontSize.body, color: '#132A4A', fontWeight: theme.weight.medium as any },
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
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: theme.space.xs,
  },
  numNextOff: { opacity: 0.5 },
  numNextTxt: { color: '#132A4A', fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any },
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
    backgroundColor: '#FFFFFF',
  },
  finishBtnOff: { opacity: 0.6 },
  finishTxt: { color: '#132A4A', fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold as any },
  // —— 欢迎视频页 ——（背景渐变由 OnboardVideoScreen 的 LinearGradient 提供，与视频边缘同色）
  videoEnter: {
    position: 'absolute',
    left: theme.space.card,
    right: theme.space.card,
    bottom: theme.space.xl,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  videoEnterTxt: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold as any,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
});
