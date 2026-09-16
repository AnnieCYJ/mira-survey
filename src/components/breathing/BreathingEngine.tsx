import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { theme } from '../../theme/theme';

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
  box:     { name: 'box',     label: '箱式呼吸', inhale: 4, hold1: 4, exhale: 4, hold2: 4, description: '4-4-4-4，平衡自主神经', bg: require('../../assets/breathing/bg_box.jpg') },
  calm:    { name: 'calm',    label: '放松呼吸', inhale: 4, hold1: 2, exhale: 6, hold2: 0, description: '4-2-6，延长呼气激活副交感', bg: require('../../assets/breathing/bg_calm.jpg') },
  energize:{ name: 'energize',label: '提神呼吸', inhale: 6, hold1: 0, exhale: 2, hold2: 0, description: '6-2，延长吸气激活交感', bg: require('../../assets/breathing/bg_energize.jpg') },
  sleep:   { name: 'sleep',   label: '睡前呼吸', inhale: 4, hold1: 7, exhale: 8, hold2: 0, description: '4-7-8，经典助眠', bg: require('../../assets/breathing/bg_sleep.jpg') },
  stress:  { name: 'stress',  label: '抗压呼吸', inhale: 4, hold1: 4, exhale: 4, hold2: 4, description: '4-4-4-4，稳定心率变异性', bg: require('../../assets/breathing/bg_stress.jpg') },
};

export type BreathStyle = 'orb' | 'ring' | 'wave' | 'watch';
export type BreathPhase = 'idle' | 'inhale' | 'hold1' | 'exhale' | 'hold2';

export interface BreathingEngineProps {
  pattern: BreathPattern;
  style?: BreathStyle;
  size?: number;
  isPlaying: boolean;
  onPhaseChange?: (phase: BreathPhase) => void;
  onComplete?: (cycles: number) => void;
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

export default function BreathingEngine({
  pattern, style = 'orb', size = 280, isPlaying, onPhaseChange,
}: BreathingEngineProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [cycles, setCycles] = useState(0);

  useEffect(() => {
    if (!isPlaying) {
      progress.stopAnimation();
      setPhase('idle');
      return;
    }
    const phases = buildSequence(pattern);
    let idx = 0;
    let count = 0;

    const runPhase = () => {
      if (idx >= phases.length) {
        count++;
        setCycles(count);
        idx = 0;
        runPhase();
        return;
      }
      const p = phases[idx];
      setPhase(p.phase);
      onPhaseChange?.(p.phase);
      Animated.timing(progress, {
        toValue: idx / phases.length,
        duration: p.duration * 1000,
        easing: p.phase === 'inhale' ? Easing.out(Easing.sin)
               : p.phase === 'exhale' ? Easing.in(Easing.sin)
               : Easing.linear,
        useNativeDriver: true,
      }).start(() => { idx++; runPhase(); });
    };
    runPhase();
    return () => progress.stopAnimation();
  }, [isPlaying, pattern]);

  const inhaleScale = progress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.55, 1, 1, 0.55, 0.55],
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {renderStyle(style, size, inhaleScale, phase)}
      <View style={styles.labelLayer}>
        <Text style={styles.phaseLabel}>{PHASE_LABELS[phase]}</Text>
        <Text style={styles.cycleLabel}>第 {cycles + 1} 轮</Text>
      </View>
    </View>
  );
}

function renderStyle(style: BreathStyle, size: number, scale: Animated.Value, phase: BreathPhase) {
  switch (style) {
    case 'orb':   return <OrbS size={size} scale={scale} />;
    case 'ring':  return <RingS size={size} scale={scale} phase={phase} />;
    case 'wave':  return <WaveS size={size} scale={scale} />;
    case 'watch': return <WatchS size={size} scale={scale} />;
  }
}

// Orb — 多层呼吸球
function OrbS({ size, scale }: { size: number; scale: Animated.Value }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 60, 120, 180, 240, 300].map((deg, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', width: size * 0.85, height: size * 0.85,
          borderRadius: size * 0.425,
          backgroundColor: i % 2 === 0 ? 'rgba(124,106,224,0.18)' : 'rgba(126,166,248,0.18)',
          transform: [{ rotate: deg + 'deg' }, { scale }],
        }} />
      ))}
      <Animated.View style={{
        position: 'absolute', width: size * 0.5, height: size * 0.5,
        borderRadius: size * 0.25, backgroundColor: theme.colors.accentSolid,
        opacity: 0.35, transform: [{ scale: Animated.add(scale, 0.35) }],
      }} />
    </View>
  );
}

// Ring — 环形呼吸
function RingS({ size, scale, phase }: { size: number; scale: Animated.Value; phase: BreathPhase }) {
  const color = phase === 'inhale' ? theme.colors.moodGood
               : phase === 'exhale' ? theme.colors.moodRest
               : theme.colors.accent1;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25,
        backgroundColor: 'transparent', borderWidth: 4,
        borderColor: color, opacity: Animated.add(scale, 0.3) as any,
        transform: [{ scale }],
      }} />
      <Animated.View style={{
        position: 'absolute', width: size * 0.3, height: size * 0.3,
        borderRadius: size * 0.15, backgroundColor: theme.colors.accentSolid,
        opacity: 0.2, transform: [{ scale: Animated.add(scale, 0.5) }],
      }} />
    </View>
  );
}

// Wave — 条形波浪
function WaveS({ size, scale }: { size: number; scale: Animated.Value }) {
  const bars = 16;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: size * 0.55, gap: 4 }}>
        {Array.from({ length: bars }).map((_, i) => {
          const phaseShift = Math.sin((i / bars) * Math.PI * 2);
          const localScale = Animated.add(Animated.multiply(Animated.add(scale, phaseShift), 0.5), 0.3);
          return (
            <Animated.View key={i} style={{
              width: 6, height: 40, borderRadius: 3,
              backgroundColor: theme.colors.accentSolid,
              transform: [{ scaleY: localScale }],
              opacity: Animated.add(Animated.multiply(scale, 0.3), 0.4) as any,
            }} />
          );
        })}
      </View>
    </View>
  );
}

// Watch — Apple Watch 风格旋转圆
function WatchS({ size, scale }: { size: number; scale: Animated.Value }) {
  const items = 8;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: items }).map((_, i) => {
        const rotation = scale.interpolate({
          inputRange: [0, 1],
          outputRange: [i * (360/items) + 'deg', (i * (360/items) + 180) + 'deg'],
        });
        const translateX = scale.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, size * 0.12, 0] });
        return (
          <Animated.View key={i} style={{
            position: 'absolute', width: size * 0.55, height: size * 0.55,
            borderRadius: size * 0.275, backgroundColor: theme.colors.accentSolid,
            opacity: 0.12, transform: [{ rotate: rotation }, { translateX }, { translateY: translateX }],
          }} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  labelLayer: { position: 'absolute', alignItems: 'center' },
  phaseLabel: { fontSize: 22, fontWeight: '600', color: theme.colors.textBody },
  cycleLabel: { marginTop: 4, fontSize: 13, color: theme.colors.textSub },
});
