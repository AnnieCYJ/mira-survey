import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// ——— 呼吸模式预设 ———
export interface BreathPattern {
  name: string;
  label: string;
  bg?: number;  // require() 背景图
  inhale: number;
  hold1: number;
  exhale: number;
  hold2: number;
  description: string;
}

export const BREATH_PATTERNS: Record<string, BreathPattern> = {
  box:     { name: 'box',     label: '箱式呼吸', inhale: 4, hold1: 4, exhale: 4, hold2: 4, description: '4-4-4-4，平衡自主神经', bg: require('../../assets/breathing/bg_box_v2.jpg') },
  calm:    { name: 'calm',    label: '放松呼吸', inhale: 4, hold1: 2, exhale: 6, hold2: 0, description: '4-2-6，延长呼气激活副交感', bg: require('../../assets/breathing/bg_calm_v2.jpg') },
  energize:{ name: 'energize',label: '提神呼吸', inhale: 6, hold1: 0, exhale: 2, hold2: 0, description: '6-2，延长吸气激活交感', bg: require('../../assets/breathing/bg_energize_v2.jpg') },
  sleep:   { name: 'sleep',   label: '睡前呼吸', inhale: 4, hold1: 7, exhale: 8, hold2: 0, description: '4-7-8，经典助眠', bg: require('../../assets/breathing/bg_sleep_v2.jpg') },
  stress:  { name: 'stress',  label: '抗压呼吸', inhale: 4, hold1: 4, exhale: 4, hold2: 4, description: '4-4-4-4，稳定心率变异性', bg: require('../../assets/breathing/bg_stress_v2.jpg') },
};

export type BreathPhase = 'idle' | 'inhale' | 'hold1' | 'exhale' | 'hold2';

export interface BreathingEngineProps {
  pattern: BreathPattern;
  size?: number;
  isPlaying: boolean;
  onPhaseChange?: (phase: BreathPhase) => void;
  onComplete?: (cycles: number) => void;
  /** 是否在圆心下方显示「第 N 轮」——播放器改为显示「第 N / 共 M 轮」时关掉，避免重复 */
  showCycles?: boolean;
}

interface PhaseInfo { phase: BreathPhase; duration: number; label: string; }

function buildSequence(p: BreathPattern): PhaseInfo[] {
  const arr: PhaseInfo[] = [];
  if (p.inhale > 0) arr.push({ phase: 'inhale', duration: p.inhale, label: '吸气' });
  if (p.hold1  > 0) arr.push({ phase: 'hold1',  duration: p.hold1,  label: '屏息' });
  if (p.exhale > 0) arr.push({ phase: 'exhale', duration: p.exhale, label: '呼气' });
  if (p.hold2  > 0) arr.push({ phase: 'hold2',  duration: p.hold2,  label: '屏息' });
  return arr;
}

const PHASE_LABELS: Record<BreathPhase, string> = {
  idle: '准备', inhale: '吸气', hold1: '屏息', exhale: '呼气', hold2: '屏息',
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 中心视觉：白色双环（底环 + 整轮进度弧）+ 呼吸缩放光晕 + 白字（相位/秒数/轮次）
export default function BreathingEngine({
  pattern, size = 220, isPlaying, onPhaseChange, onComplete, showCycles = true,
}: BreathingEngineProps) {
  const scale = useRef(new Animated.Value(0.55)).current;   // 光晕呼吸 0.55 → 1
  const arc = useRef(new Animated.Value(0)).current;        // 整轮进度 0 → 1
  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [remaining, setRemaining] = useState(0);
  const [cycles, setCycles] = useState(0);

  useEffect(() => {
    if (!isPlaying) {
      scale.stopAnimation();
      arc.stopAnimation();
      setPhase('idle');
      return;
    }
    const phases = buildSequence(pattern);
    const totalSec = phases.reduce((s, p) => s + p.duration, 0);
    let idx = 0;
    let count = 0;
    let dead = false;
    let tick: ReturnType<typeof setInterval> | null = null;
    let adv: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (tick) { clearInterval(tick); tick = null; }
      if (adv) { clearTimeout(adv); adv = null; }
    };

    const runPhase = () => {
      if (dead) return;
      if (idx >= phases.length) {
        count++;
        setCycles(count);
        onComplete?.(count);
        idx = 0;
        runPhase();
        return;
      }
      const p = phases[idx];
      setPhase(p.phase);
      onPhaseChange?.(p.phase);
      setRemaining(p.duration);
      clearTimers();
      // 秒数倒数（仅展示用）
      tick = setInterval(() => setRemaining((r) => (r > 1 ? r - 1 : r)), 1000);
      // 吸气放大、呼气缩小；屏息保持当前大小
      if (p.phase === 'inhale' || p.phase === 'exhale') {
        Animated.timing(scale, {
          toValue: p.phase === 'inhale' ? 1 : 0.55,
          duration: p.duration * 1000,
          easing: p.phase === 'inhale' ? Easing.out(Easing.sin) : Easing.in(Easing.sin),
          useNativeDriver: true,
        }).start();
      }
      // ★ 修复：到点进入下一阶段（此前缺少阶段推进，4-7-8 只显示吸气、屏息/呼气永远不出现）
      adv = setTimeout(() => {
        if (dead) return;
        idx++;
        runPhase();
      }, p.duration * 1000);
    };

    // 整轮进度弧：走完一轮自动归零重画
    const runArc = () => {
      if (dead) return;
      arc.setValue(0);
      Animated.timing(arc, {
        toValue: 1,
        duration: totalSec * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(runArc);
    };
    runArc();
    runPhase();

    return () => {
      dead = true;
      clearTimers();
      scale.stopAnimation();
      arc.stopAnimation();
    };
  }, [isPlaying, pattern]);

  const r = size * 0.436;               // 96 / 220
  const C = 2 * Math.PI * r;
  const dashOffset = arc.interpolate({ inputRange: [0, 1], outputRange: [C, 0] });
  const cx = size / 2, cy = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* 呼吸光晕（随吸气放大 / 呼气缩小） */}
      <Animated.View style={{
        position: 'absolute', width: size * 0.86, height: size * 0.86,
        transform: [{ scale }],
      }}>
        <Svg width={size * 0.86} height={size * 0.86} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id="breathHalo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#fff" stopOpacity="0.16" />
              <Stop offset="0.6" stopColor="#fff" stopOpacity="0.07" />
              <Stop offset="1" stopColor="#fff" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size * 0.45} fill="url(#breathHalo)" />
        </Svg>
      </Animated.View>

      {/* 白色双环：底环 + 整轮进度弧 */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.35)" strokeWidth={2} fill="none" />
        <AnimatedCircle
          cx={cx} cy={cy} r={r}
          stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${C} ${C}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>

      {/* 中央文字 */}
      <View style={styles.center}>
        <Text style={styles.phase}>{PHASE_LABELS[phase]}</Text>
        {remaining > 0 && <Text style={styles.count}>{remaining} 秒</Text>}
      </View>
      {showCycles && <Text style={styles.cycles}>第 {cycles + 1} 轮</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center' },
  phase: {
    fontSize: theme.fontSize.h2, fontWeight: '600', color: '#fff', letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  count: {
    marginTop: 6, fontSize: theme.fontSize.xs, color: 'rgba(255,255,255,0.82)',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  cycles: {
    position: 'absolute', bottom: -6, fontSize: theme.fontSize.micro, color: 'rgba(255,255,255,0.7)', letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
});
