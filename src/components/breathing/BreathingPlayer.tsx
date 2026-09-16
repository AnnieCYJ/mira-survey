import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, ImageBackground, SafeAreaView } from 'react-native';
import { Audio } from 'expo-av';
import BreathingEngine, { BREATH_PATTERNS, BreathStyle } from './BreathingEngine';
import { theme } from '../../theme/theme';
import Icon from '../Icon';

interface Props {
  patternKey: keyof typeof BREATH_PATTERNS;
  style?: BreathStyle;
  duration?: number;
  audioUri?: string;
  onClose?: () => void;
}

export default function BreathingPlayer({
  patternKey, style = 'orb', duration = 0, audioUri, onClose,
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

  const handlePlay = async () => {
    if (!soundRef.current) await loadAudio();
    setPlaying(true);
    await soundRef.current?.playAsync();
  };
  const handlePause = async () => {
    setPlaying(false);
    await soundRef.current?.pauseAsync();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const totalSec = pattern.inhale + pattern.hold1 + pattern.exhale + pattern.hold2;

  return (
    <View style={styles.root}>
    <ImageBackground
      source={pattern.bg ?? require('../../assets/breathing/bg_box.jpg')}
      style={styles.fullScreen}
      imageStyle={{ resizeMode: 'cover' }}
    >
      {/* 暗化层 */}
      <View style={styles.overlay} />

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
          <BreathingEngine pattern={pattern} style={style} isPlaying={playing || duration === 0} size={220} />
        </View>

        {/* 时长 */}
        {duration > 0 && (
          <Text style={styles.timer}>{formatTime(remaining)}</Text>
        )}
        {duration === 0 && (
          <Text style={styles.timer}>{totalSec}s 循环</Text>
        )}

        {/* 控制 */}
        <View style={styles.controls}>
          <Pressable onPress={handlePlay} style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}>
            <Icon name="play" size={24} color="#fff" />
          </Pressable>
          <Pressable onPress={handlePause} style={({ pressed }) => [styles.pauseBtn, pressed && { opacity: 0.8 }]}>
            <Icon name="pause" size={22} color="#fff" />
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
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
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
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 10, gap: theme.space.lg },
  playBtn: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: theme.colors.accentSolid,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 4,
  },
  pauseBtn: {
    marginLeft: theme.space.lg,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
});
