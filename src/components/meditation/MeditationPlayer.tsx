import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ImageBackground, SafeAreaView, Dimensions } from 'react-native';
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
  const [position, setPosition] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [durationSec, setDurationSec] = useState(0);

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
            if (status.isLoaded && typeof status.positionMillis === 'number') {
              setPosition(status.positionMillis / 1000);
            }
            if (status.isLoaded && typeof status.durationMillis === 'number') {
              setDurationSec(status.durationMillis / 1000);
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

  const handlePlay = async () => {
    const s = soundRef.current;
    if (!s) return;
    await s.playAsync();
    setPlaying(true);
  };
  const handlePause = async () => {
    const s = soundRef.current;
    if (!s) return;
    await s.pauseAsync();
    setPlaying(false);
  };

  const seek = async (pct: number) => {
    const s = soundRef.current;
    if (!s || !durationSec) return;
    await s.setPositionAsync(durationSec * 1000 * pct);
    setPosition(durationSec * pct);
  };

  if (!track) return null;

  const progress = durationSec > 0 ? position / durationSec : 0;

  return (
    <View style={styles.root}>
      <ImageBackground source={track.bg} style={styles.bg} imageStyle={{ resizeMode: 'cover' }}>
        {/* 暗化层 */}
        <View style={styles.overlay} />

        {/* 关闭按钮 —— 在 SafeAreaView 外层，确保不被裁 */}
        <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}>
          <Icon name="close" size={18} color="#fff" />
        </Pressable>

        <SafeAreaView style={styles.safe}>
          {/* 标题 */}
          <View style={styles.header}>
            <Text style={styles.title}>{track.title}</Text>
            <Text style={styles.subtitle}>{track.subtitle}</Text>
          </View>

          {/* 占位 */}
          <View style={{ flex: 1 }} />

          {/* 进度条 + 时间 */}
          <View style={styles.progressWrap}>
            <Pressable
              style={styles.progressBar}
              onPress={(e) => {
                const { width } = Dimensions.get('window');
                seek(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)));
              }}
            >
              <View style={[styles.progressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
            </Pressable>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>{formatTime(position)}</Text>
              <Text style={styles.timeLabel}>{formatTime(durationSec)}</Text>
            </View>
          </View>

          {/* 播放/暂停 */}
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

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1 },
  closeBtn: {
    position: 'absolute', top: 50, right: theme.space.card,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  safe: { flex: 1, paddingHorizontal: theme.space.card, zIndex: 2 },
  header: { alignItems: 'center', marginTop: 12, marginBottom: theme.space.xl },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: '#fff', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 8 },
  subtitle: { fontSize: theme.fontSize.body, color: 'rgba(255,255,255,0.85)', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 6 },
  progressWrap: { marginBottom: theme.space.md },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: '#fff' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  timeLabel: { fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.75)' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: theme.space.md, gap: theme.space.lg },
  playBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: theme.colors.accentSolid,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12,
    elevation: 4,
  },
  pauseBtn: {
    marginLeft: theme.space.lg,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
});
