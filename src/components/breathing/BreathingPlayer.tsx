import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ImageBackground, SafeAreaView } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Audio } from 'expo-av';
import BreathingEngine, { BREATH_PATTERNS } from './BreathingEngine';
import { theme } from '../../theme/theme';
import { mm } from '../../theme/mindmate';
import Icon from '../Icon';
import { useRingState } from '../../hooks/useRingState';
import Confetti from '../../components/Confetti';
import { addBreathCompletion } from '../../data/interventionLog';

interface Props {
  completionId?: string;
  patternKey: keyof typeof BREATH_PATTERNS;
  duration?: number;
  audioUri?: string;
  onClose?: () => void;
  /** ★ 2026-10-13 夜：目标轮数（每轮 = 一次完整 吸气→屏息→呼气 循环）。默认 8 轮。 */
  rounds?: number;
}

// ★ 2026-10-13 夜：默认训练轮数（box/4-7-8 等一轮约 16–19s；用户定 3 轮 ≈ 1 分钟，自然做完即弹卡）
const DEFAULT_ROUNDS = 3;

// ★ 2026-10-13：诚实口径的「状态变化」文案——只基于戒指真实前后状态，
//   等级或状态值任一发生变化才说变化，否则诚实说「当下还是 X / 慢慢松下来」。绝不编造。
function stateChangeLine(
  before?: string | null,
  after?: string | null,
  beforeV?: number | null,
  afterV?: number | null,
): string {
  if (!before && !after) return '这一轮做完，身体会慢慢松下来。';
  if (before && after && before !== after) {
    return `状态从「${before}」到了「${after}」，松快了些。`;
  }
  if (beforeV != null && afterV != null) {
    if (afterV >= beforeV + 2) return `状态值从 ${beforeV} 升到 ${afterV}，精神好一点了。`;
    if (afterV <= beforeV - 2) return `状态值从 ${beforeV} 落到 ${afterV}，紧绷感少了些。`;
  }
  return `这一轮做完，当下还是「${before ?? after}」，慢慢松下来。`;
}

export default function BreathingPlayer({
  patternKey, audioUri, onClose, completionId, rounds = DEFAULT_ROUNDS,
}: Props) {
  const pattern = BREATH_PATTERNS[patternKey];
  const [playing, setPlaying] = useState(true); // ★ 夜改：进入即自动开始，无需先点播放
  const soundRef = useRef<Audio.Sound | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ★ 夜改：当前轮次（来自引擎 onComplete），跑满 rounds 即完成
  const [round, setRound] = useState(0);
  const doneRef = useRef(false);

  // ★ 2026-10-13：会话开始即快照当前状态（只取一次），完成时再取一次做前后对比
  const ring = useRingState();
  // 始终持有最新 ring（引擎 onComplete 闭包会过期，完成时要用「当下」状态做对比）
  const ringRef = useRef(ring);
  ringRef.current = ring;
  const beforeRef = useRef<{ level: string | null; value: number | null } | null>(null);
  if (beforeRef.current === null && ring?.curveStatus) {
    beforeRef.current = {
      level: ring.curveStatus.level ?? null,
      value: typeof ring.curveStatus.value === 'number' ? ring.curveStatus.value : null,
    };
  }

  // 完成卡 + 撒花
  const [done, setDone] = useState(false);
  const [doneSummary, setDoneSummary] = useState('');
  const [doneTitle, setDoneTitle] = useState('');

  // ★ 夜改：防御性取值 —— useRingState 运行时可能返回 curveStatus 为 null 的状态，
  //   原 `ring.curveStatus` 直接取会在完成时抛「Cannot read property 'curveStatus' of null」，
  //   导致 setDone 永远到不了、卡片和撒花不弹。
  const handleComplete = () => {
    const status = ringRef.current?.curveStatus ?? null;
    const b = beforeRef.current ?? { level: null, value: null };
    const aLevel = status?.level ?? null;
    const aVal = typeof status?.value === 'number' ? status.value : null;
    const summary = stateChangeLine(b.level, aLevel, b.value, aVal);
    const roundSec = pattern.inhale + pattern.hold1 + pattern.exhale + pattern.hold2;
    const minutes = Math.max(1, Math.round((rounds * roundSec) / 60));
    // ★ 二十改：完整做完才记录（中途退出不记）；这里同时存前后状态供完成卡 / 日历卡
    addBreathCompletion('breath', `${pattern.label} · 做完 ${rounds} 轮`, {
      completionId,
      stateBefore: b.level,
      stateAfter: aLevel,
      valueBefore: b.value,
      valueAfter: aVal,
      minutes,
    });
    setDoneTitle(pattern.label);
    setDoneSummary(summary);
    setDone(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // 撒花约 2.6s 后自动收起并关闭播放器
    closeTimer.current = setTimeout(() => {
      setDone(false);
      onClose?.();
    }, 2800);
  };

  // ★ 夜改：引擎每跑完一轮回调 count；到达目标轮数即完成（只触发一次）
  const onEngineComplete = (count: number) => {
    setRound(count);
    if (count >= rounds && !doneRef.current) {
      doneRef.current = true;
      handleComplete();
    }
  };

  // 卸载兜底：清掉计时器，避免泄漏
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const loadAudio = async () => {
    if (!audioUri) return;
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
      soundRef.current = sound;
    } catch (e) { console.warn('音频加载失败:', e); }
  };

  const handleToggle = async () => {
    if (playing) {
      setPlaying(false);
      await soundRef.current?.pauseAsync();
    } else {
      if (!soundRef.current) await loadAudio();
      setPlaying(true);
      await soundRef.current?.playAsync();
    }
  };

  const totalSec = pattern.inhale + pattern.hold1 + pattern.exhale + pattern.hold2;

  return (
    <View style={styles.root}>
    <ImageBackground
      source={pattern.bg ?? require('../../assets/breathing/bg_box_v2.jpg')}
      style={styles.fullScreen}
      imageStyle={{ resizeMode: 'cover' }}
    >
      {/* 压暗渐变层：顶部/底部加重，让白环与白字在任何照片上都可读 */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="bgShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0A0A14" stopOpacity={patternKey === 'sleep' ? 0.42 : 0.28} />
            <Stop offset="0.45" stopColor="#0A0A14" stopOpacity={patternKey === 'sleep' ? 0.18 : 0.10} />
            <Stop offset="1" stopColor="#0A0A14" stopOpacity={patternKey === 'sleep' ? 0.48 : 0.34} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgShade)" />
      </Svg>

      {/* 关闭按钮 —— SafeAreaView 外层 */}
      <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}>
        <Icon name="close" size={18} color="#fff" />
      </Pressable>

      <SafeAreaView style={styles.safe}>
        {/* 标题 */}
        <View style={styles.header}>
          <Text style={styles.title}>{pattern.label}</Text>
          <Text style={styles.subtitle}>{pattern.description}</Text>
        </View>

        {/* 呼吸引擎 */}
        <View style={styles.engineWrap}>
          {/* ★ 夜改：接 onComplete 数轮 + showCycles=false（轮次改由下方「第 N / 共 M 轮」统一显示） */}
          <BreathingEngine
            pattern={pattern}
            isPlaying={playing}
            size={220}
            onComplete={onEngineComplete}
            showCycles={false}
          />
        </View>

        {/* 轮次进度（★ 夜改：取代原 duration 倒数，跑满 rounds 即弹完成卡） */}
        <Text style={styles.timer}>
          第 {Math.min(round + 1, rounds)} / 共 {rounds} 轮
        </Text>

        {/* 控制（开始/暂停合并为一个开关） */}
        <View style={styles.controls}>
          <Pressable onPress={handleToggle} style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}>
            <Icon name={playing ? 'pause' : 'play'} size={24} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>

    {/* ★ 2026-10-13：完成卡 + 撒花（做完才出现，2.8s 后自动关闭） */}
    {done && (
      <View style={styles.doneOverlay} pointerEvents="none">
        <Confetti visible duration={2600} count={90} />
        <View style={styles.doneCard}>
          <View style={styles.doneBadge}><Text style={styles.doneCheck}>✓</Text></View>
          <Text style={styles.doneTitle}>完成 · {doneTitle}</Text>
          <Text style={styles.doneSub}>{rounds} 轮 · 放松练习</Text>
          <Text style={styles.doneLine}>{doneSummary}</Text>
        </View>
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fullScreen: {
    flex: 1, width: '100%', height: '100%',
  },
  safe: { flex: 1, paddingHorizontal: theme.space.card, paddingTop: 60, paddingBottom: 40 },
  closeBtn: {
    position: 'absolute', top: 50, right: theme.space.card,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  header: { alignItems: 'center', marginBottom: theme.space.xl, zIndex: 10 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: '#fff', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 8 },
  subtitle: { fontSize: theme.fontSize.body, color: 'rgba(255,255,255,0.85)', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 6 },
  engineWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  timer: {
    fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any,
    color: '#fff', textAlign: 'center', marginBottom: theme.space.md,
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 6,
  },
  controls: { justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  playBtn: {
    width: 64, height: 64, borderRadius: theme.radius.xl,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 4,
  },
  // ★ 完成卡 + 撒花
  doneOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1002, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  doneCard: {
    width: '82%', maxWidth: 320,
    backgroundColor: 'rgba(20,18,28,0.82)',
    borderRadius: theme.radius.xl, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, elevation: 10,
  },
  doneBadge: {
    width: 56, height: 56, borderRadius: theme.radius.xl,
    backgroundColor: mm.colors.limeMid, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  doneCheck: { color: '#1F1D1A', fontSize: theme.fontSize.stat, fontWeight: '700' },
  doneTitle: { color: '#fff', fontSize: theme.fontSize.lg, fontWeight: '600' as any, textAlign: 'center' },
  doneSub: { color: 'rgba(255,255,255,0.7)', fontSize: theme.fontSize.xs, marginTop: 4, textAlign: 'center' },
  doneLine: { color: 'rgba(255,255,255,0.92)', fontSize: theme.fontSize.body, lineHeight: 22, marginTop: 12, textAlign: 'center' },
});
