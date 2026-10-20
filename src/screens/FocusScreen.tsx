import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import MiraBot from '../components/MiraBot';

const MOOD_TAGS: { label: string; mood: string }[] = [
  { label: '待机', mood: 'idle' },
  { label: '开心', mood: 'happy' },
  { label: '难过', mood: 'sad' },
  { label: '生气', mood: 'angry' },
  { label: '惊讶', mood: 'surprised' },
  { label: '睡觉', mood: 'sleep' },
  { label: '无聊', mood: 'bored' },
];

export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const floatAnim = useRef(new Animated.Value(0)).current;

  // 背景装饰浮动
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(floatAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.sp(6), paddingBottom: insets.bottom + theme.sp(4) }]}>
      {/* ★ mira-ocean（2026-10-19）：铺深海三色渐变（与全 App 同源 bgGradStops），去掉导航默认平板深紫实底 */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {/* 背景装饰 */}
      <View style={styles.bgDeco}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.blob,
              {
                left: `${10 + i * 14}%`,
                top: `${20 + (i % 3) * 25}%`,
                width: 40 + (i % 3) * 20,
                height: 40 + (i % 3) * 20,
                opacity: 0.08,
              },
            ]}
          />
        ))}
      </View>

      {/* 标题 */}
      <View style={styles.header}>
        <Text style={styles.title}>Mira Bot</Text>
        <Text style={styles.sub}>点我切换表情 · 长按睡觉</Text>
      </View>

      {/* Bot 主体 */}
      <Animated.View style={[styles.botWrap, { transform: [{ translateY: floatY }] }]}>
        <MiraBot size={280} />
      </Animated.View>

      {/* 底部操作区 */}
      <View style={styles.controls}>
        {MOOD_TAGS.map((tag) => (
          <MoodChip key={tag.mood} label={tag.label} mood={tag.mood} />
        ))}
      </View>
    </View>
  );
}

function MoodChip({ label, mood }: { label: string; mood: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      delay: Math.random() * 300,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeIn, transform: [{ scale }] }}>
      <TouchableOpacity
        style={styles.chip}
        activeOpacity={0.7}
        onPress={() => {
          Animated.sequence([
            Animated.timing(scale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start();
        }}
      >
        <Text style={styles.chipText}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  bgDeco: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.sp(6),
  },
  title: {
    fontSize: theme.fs(34),
    fontWeight: '300',
    color: theme.colors.textWhite,
    letterSpacing: 2,
  },
  sub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textWhite70,
    marginTop: theme.sp(1.5),
  },
  botWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: theme.sp(4),
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 380,
    marginTop: theme.sp(6),
    paddingHorizontal: theme.space.md,
  },
  chip: {
    paddingHorizontal: theme.sp(3.5),
    paddingVertical: theme.sp(2),
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    margin: theme.sp(1),
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textWhite,
  },
});
