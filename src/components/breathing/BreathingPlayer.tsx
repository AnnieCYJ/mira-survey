import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ImageBackground, SafeAreaView } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Audio } from 'expo-av';
import BreathingEngine, { BREATH_PATTERNS } from './BreathingEngine';
import { theme } from '../../theme/theme';
import Icon from '../Icon';
import { addInterventionEntry } from '../../data/interventionLog';

interface Props {
  patternKey: keyof typeof BREATH_PATTERNS;
  duration?: number;
  audioUri?: string;
  onClose?: () => void;
}

export default function BreathingPlayer({
  patternKey, duration = 0, audioUri, onClose,
}: Props) {
  const pattern = BREATH_PATTERNS[patternKey];
  const [playing, setPlaying] = useState(false);
  const [remaining, setRemaining] = useState(duration * 60);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing || duration === 0) return;
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setPlaying(false);
          timerRef.current && clearInterval(timerRef.current);
          // ★ 二十改：完整做完一次呼吸才记录（中途退出不记）——
          //   圆环下叙事的 AI 层用「最近做过的动作」做事实输入（如「刚做完放松呼吸」）
          addInterventionEntry('breath', `${pattern.label} · 做完`);
          onClose?.();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { timerRef.current && clearInterval(timerRef.current); };
  }, [playing, duration]);

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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
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
          <BreathingEngine pattern={pattern} isPlaying={playing || duration === 0} size={220} />
        </View>

        {/* 时长 */}
        {duration > 0 && (
          <Text style={styles.timer}>{formatTime(remaining)}</Text>
        )}
        {duration === 0 && (
          <Text style={styles.timer}>{totalSec}s 循环</Text>
        )}

        {/* 控制（开始/暂停合并为一个开关） */}
        <View style={styles.controls}>
          <Pressable onPress={handleToggle} style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}>
            <Icon name={playing ? 'pause' : 'play'} size={24} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
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
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 4,
  },
});
