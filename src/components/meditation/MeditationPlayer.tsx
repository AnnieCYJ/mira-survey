import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ImageBackground, SafeAreaView } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Audio } from 'expo-av';
import { theme } from '../../theme/theme';
import Icon from '../Icon';
import type { MeditationTrack } from '../../data/meditation/tracks';
import { addInterventionEntry } from '../../data/interventionLog';

interface Props {
  track: MeditationTrack | null;
  onClose: () => void;
}

export default function MeditationPlayer({ track, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (!track) return;
    let mounted = true;
    let sound: Audio.Sound | null = null;

    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync(track.uri, {
          isLooping: track.loop,
          volume: 0.8,
        });
        sound = s;
        soundRef.current = s;
        if (mounted) {
          s.setOnPlaybackStatusUpdate((status: any) => {
            if (status.isLoaded && status.didJustFinish) {
              setPlaying(false);
              // ★ 二十改：音频播完才记录（中途退出不记）——供叙事 AI 层引用「刚做完冥想」
              addInterventionEntry('meditate', `${track.title} · 听完`);
            }
          });
          await s.playAsync();
          setPlaying(true);
        }
      } catch (e) {
        console.warn('[MeditationPlayer] load fail', e);
      }
    })();

    return () => {
      mounted = false;
      if (sound) { sound.stopAsync().catch(() => {}); sound.unloadAsync().catch(() => {}); }
      soundRef.current = null;
    };
  }, [track?.id]);

  const handleToggle = async () => {
    const s = soundRef.current;
    if (!s) return;
    if (playing) {
      await s.pauseAsync();
      setPlaying(false);
    } else {
      await s.playAsync();
      setPlaying(true);
    }
  };

  if (!track) return null;

  return (
    <View style={styles.root}>
      <ImageBackground source={track.bg} style={styles.bg} imageStyle={{ resizeMode: 'cover' }}>
        {/* 压暗渐变层：顶部/底部加重，让白字与玻璃控件在任何照片上都可读 */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="mShade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0A0A14" stopOpacity="0.32" />
              <Stop offset="0.45" stopColor="#0A0A14" stopOpacity="0.10" />
              <Stop offset="1" stopColor="#0A0A14" stopOpacity="0.38" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#mShade)" />
        </Svg>

        {/* 关闭按钮 —— 玻璃拟态，SafeAreaView 外层确保不被裁 */}
        <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}>
          <Icon name="close" size={18} color="#fff" />
        </Pressable>

        <SafeAreaView style={styles.safe}>
          {/* 标题 */}
          <View style={styles.header}>
            <Text style={styles.title}>{track.title}</Text>
            <Text style={styles.subtitle}>{track.subtitle}</Text>
          </View>

          {/* 中部留白：让风景主体露出来 */}
          <View style={{ flex: 1 }} />

          {/* 循环状态 */}
          <Text style={styles.loopHint}>{track.loop ? '∞ 循环播放' : '单次播放'}</Text>

          {/* 播放/暂停（合并为一个玻璃开关） */}
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
  bg: { flex: 1 },
  closeBtn: {
    position: 'absolute', top: 50, right: theme.space.card,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  safe: { flex: 1, paddingHorizontal: theme.space.card, zIndex: 2 },
  header: { alignItems: 'center', marginTop: 12, marginBottom: theme.space.xl },
  title: {
    fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  subtitle: {
    fontSize: theme.fontSize.body, color: 'rgba(255,255,255,0.85)', marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  loopHint: {
    fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.7)', textAlign: 'center',
    letterSpacing: 1, marginBottom: theme.space.md,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  controls: { justifyContent: 'center', alignItems: 'center', marginBottom: theme.space.md },
  playBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16,
    elevation: 4,
  },
});
