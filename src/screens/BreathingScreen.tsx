import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ImageBackground, StatusBar, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import BreathingPlayer from '../components/breathing/BreathingPlayer';
import MeditationPlayer from '../components/meditation/MeditationPlayer';
import ListCard, { type ListItem } from '../components/ListCard';
import { MEDITATION_TRACKS } from '../data/meditation/tracks';
import type { BreathStyle } from '../components/breathing/BreathingEngine';
import type { MeditationTrack } from '../data/meditation/tracks';

// —— 呼吸引导配图 ——
const IMG_BOX = require('../assets/breathing/thumb_box.jpg');
const IMG_CALM_BREATH = require('../assets/breathing/thumb_calm.jpg');
const IMG_SLEEP_BREATH = require('../assets/breathing/thumb_sleep.jpg');
const IMG_ENERGIZE = require('../assets/breathing/thumb_energize.jpg');

// —— Pattern keys（共享类型）——
type PatternKey = 'box' | 'calm' | 'energize' | 'sleep' | 'stress';

// —— 呼吸引导（Breathing）——
interface BreathTrack { title: string; duration: string; patternKey: PatternKey; style: BreathStyle; thumb: number; accent: string; }
const BREATH_TRACKS: BreathTrack[] = [
  { title: '箱式呼吸',  duration: '4-4-4-4 · 平衡自主神经', patternKey: 'box',     style: 'orb',   thumb: IMG_BOX,           accent: '#B8A9C9' },
  { title: '放松呼吸',  duration: '4-2-6 · 延长呼气',       patternKey: 'calm',    style: 'ring',  thumb: IMG_CALM_BREATH,   accent: '#E8B4B8' },
  { title: '睡前呼吸',  duration: '4-7-8 · 助眠',           patternKey: 'sleep',   style: 'wave',  thumb: IMG_SLEEP_BREATH,  accent: '#9B8EC4' },
  { title: '提神呼吸',  duration: '6-2 · 激活交感',         patternKey: 'energize',style: 'watch', thumb: IMG_ENERGIZE,      accent: '#F4A261' },
];

// —— Mini Courses ——
interface Course { title: string; meta: string; tag?: 'live' | 'course'; patternKey: PatternKey; style: BreathStyle; duration: number; }
const COURSES: Course[] = [
  { title: '轻松冥想入门', meta: '8 小时系列课程', tag: 'course', patternKey: 'box',  style: 'orb',  duration: 5 },
  { title: '线上团体课',   meta: '6 人在线',       tag: 'live',   patternKey: 'calm', style: 'ring', duration: 5 },
];

// —— 睡眠科学（v18.42 并入：斯坦福平衡激素法则中与睡眠相关的条目收拢在这里）——
const SLEEP_CARDS: ListItem[] = [
  { dot: mm.colors.limeDeep, title: '褪黑素怕光', sub: '夜间哪怕中等亮度也会压制褪黑素——睡前把灯调暗、屏幕拿远，比任何补剂都靠谱。' },
  { dot: mm.colors.limeDeep, title: '深睡是修复窗口', sub: '生长激素主要在深睡分泌，皮肤屏障与身体修复都在这里发生；睡眠债会直接写在状态上。' },
  { dot: mm.colors.limeDeep, title: '热水澡是降温开关', sub: '热水把血带到体表，出浴后核心温度下降——身体降温正是入睡的开关。' },
  { dot: mm.colors.limeDeep, title: 'NSDR：20 分钟快速回血', sub: '非睡眠深度休息（身体扫描/瑜伽休憩）能降低皮质醇、恢复多巴胺，午后低谷比咖啡好用。' },
];

export default function BreathingScreen() {
  const navigation = useNavigation<any>();
  const [breathPlayer, setBreathPlayer] = useState<null | { patternKey: PatternKey; style: BreathStyle; duration: number }>(null);
  const [meditationTrack, setMeditationTrack] = useState<MeditationTrack | null>(null);

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer compactTop topFadeColor={theme.colors.textWhite}>
      {/* v16：白底 */}
      <StatusBar barStyle="dark-content" />

      {/* ——— 返回 + 标题 ——— */}
      <View style={styles.head}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={styles.headText}>
          <Text style={styles.title}>呼吸冥想</Text>
          <Text style={styles.sub}>呼吸放松 · 正念冥想</Text>
        </View>
      </View>

      {/* ——— 呼吸引导（可视化节奏）——— */}
      <Text style={styles.sectionTitle}>呼吸引导</Text>
      <View style={styles.trackList}>
        {BREATH_TRACKS.map((t, i) => (
          <Pressable key={i} style={({ pressed }) => [styles.trackItem, pressed && { opacity: 0.7 }]}
            onPress={() => setBreathPlayer({ patternKey: t.patternKey, style: t.style, duration: 5 })}
          >
            <View style={[styles.playBtn, { backgroundColor: t.accent }]}>
              <Icon name="play" size={theme.fs(16)} color={theme.colors.textWhite} strokeWidth={2.2} />
            </View>
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle}>{t.title}</Text>
              <Text style={styles.trackDuration}>{t.duration}</Text>
            </View>
            <Image source={t.thumb} style={styles.trackThumb} />
          </Pressable>
        ))}
      </View>

      {/* ——— 冥想音频（白噪声 / 自然声）——— */}
      <Text style={styles.sectionTitle}>冥想音频</Text>
      <View style={styles.trackList}>
        {MEDITATION_TRACKS.map((t, i) => (
          <Pressable key={i} style={({ pressed }) => [styles.trackItem, pressed && { opacity: 0.7 }]}
            onPress={() => setMeditationTrack(t)}
          >
            <View style={[styles.playBtn, { backgroundColor: t.accent }]}>
              <Icon name="play" size={theme.fs(16)} color={theme.colors.textWhite} strokeWidth={2.2} />
            </View>
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle}>{t.title}</Text>
              <Text style={styles.trackDuration}>{t.subtitle}</Text>
            </View>
            <Image source={t.thumb} style={styles.trackThumb} />
          </Pressable>
        ))}
      </View>

      {/* ——— 精选课程 ——— */}
      <Text style={styles.sectionTitle}>精选课程</Text>
      <View style={styles.courseList}>
        {COURSES.map((c, i) => (
          <Pressable key={i} style={({ pressed }) => [styles.courseItem, pressed && { opacity: 0.8 }]}
            onPress={() => setBreathPlayer({ patternKey: c.patternKey, style: c.style, duration: c.duration })}
          >
            <View style={[styles.courseIcon, c.tag === 'live' ? { backgroundColor: mm.colors.purpleCore } : { backgroundColor: mm.colors.limeMid }]}>
              <Icon name={c.tag === 'live' ? 'mind' : 'learn'} size={theme.fs(18)} color={theme.colors.textWhite} strokeWidth={1.8} />
            </View>
            <View style={styles.courseInfo}>
              <Text style={styles.courseTitle}>{c.title}</Text>
              <Text style={styles.courseMeta}>{c.meta}</Text>
            </View>
            {c.tag === 'live' && <View style={styles.liveDot} />}
          </Pressable>
        ))}
      </View>

      {/* ——— 睡眠科学（平衡激素法则 × 睡眠，v18.42 并入）——— */}
      <View style={{ marginTop: theme.space.lg, marginBottom: theme.space.xl }}>
        <ListCard title="睡眠科学" items={SLEEP_CARDS} />
      </View>

      {/* ——— Breathing Player Modal ——— */}
      <Modal visible={breathPlayer !== null} animationType="fade" statusBarTranslucent onRequestClose={() => setBreathPlayer(null)}>
        <View style={styles.modalBg}>
          {breathPlayer && (
            <BreathingPlayer
              patternKey={breathPlayer.patternKey}
              style={breathPlayer.style}
              duration={breathPlayer.duration}
              onClose={() => setBreathPlayer(null)}
            />
          )}
        </View>
      </Modal>

      {/* ——— Meditation Player Modal ——— */}
      <Modal visible={meditationTrack !== null} animationType="fade" statusBarTranslucent onRequestClose={() => setMeditationTrack(null)}>
        <MeditationPlayer track={meditationTrack} onClose={() => setMeditationTrack(null)} />
      </Modal>
    </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2), marginBottom: theme.space.lg },
  back: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },

  sectionTitle: {
    fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any,
    color: mm.colors.ink,
    marginTop: theme.space.lg, marginBottom: theme.space.card,
  },

  trackThumb: { width: 52, height: 52, borderRadius: theme.radius.sm },
  trackList: { gap: theme.space.card },
  trackItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md,
    padding: theme.space.cardPad, gap: theme.space.md,
    shadowColor: theme.colors.ui.shadowBlack, shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 2,
  },
  playBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: mm.colors.purpleBtn,
    alignItems: 'center', justifyContent: 'center',
  },
  trackInfo: { flex: 1, gap: 2 },
  trackTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textBody },
  trackDuration: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },

  courseList: { gap: theme.space.card, marginBottom: theme.space.xl },
  courseItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md,
    padding: theme.space.cardPad, gap: theme.space.md,
    shadowColor: theme.colors.ui.shadowBlack, shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 2,
  },
  courseIcon: { width: 40, height: 40, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  courseInfo: { flex: 1, gap: 2 },
  courseTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textBody },
  courseMeta: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: mm.colors.purpleCore },

  modalBg: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalCard: {
    width: '100%', height: '72%',
    borderRadius: theme.radius.card, overflow: 'hidden',
    shadowColor: theme.colors.ui.shadowDeep, shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: theme.sp(4) }, shadowRadius: theme.sp(8),
    elevation: 6,
  },
});
