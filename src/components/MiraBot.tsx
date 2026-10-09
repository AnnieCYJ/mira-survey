import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Animated, StyleSheet, TouchableOpacity, Easing, Dimensions } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

const { width: SCREEN_W } = Dimensions.get('window');

type Mood = 'idle' | 'happy' | 'sad' | 'angry' | 'surprised' | 'sleepy' | 'sleep' | 'bored';

const MOODS: Mood[] = ['idle', 'happy', 'sad', 'angry', 'surprised', 'sleep', 'bored'];

interface Props {
  size?: number;
  autoAnimate?: boolean;
}

// body 颜色（直接用纯色，避免 Defs/RadialGradient 兼容性问题）
const BODY_COLORS: Record<Mood, string> = {
  idle:      '#a78bfa',
  happy:     '#c4b5fd',
  sad:       '#818cf8',
  angry:     '#f87171',
  surprised: '#fbbf24',
  sleepy:    '#a5b4fc',
  sleep:     '#6366f1',
  bored:     '#9ca3af',
};

export default function MiraBot({ size, autoAnimate = true }: Props) {
  const botSize = size ?? Math.min(SCREEN_W * 0.55, 260);

  const bodyScale = useRef(new Animated.Value(1)).current;
  const bodyTx = useRef(new Animated.Value(0)).current;
  const bodyTy = useRef(new Animated.Value(0)).current;
  const bodyRot = useRef(new Animated.Value(0)).current;
  const eyeScaleY = useRef(new Animated.Value(1)).current;
  const eyeOffsetX = useRef(new Animated.Value(0)).current;
  const [mood, setMood] = useState<Mood>('idle');
  const sleeping = mood === 'sleep';

  // 呼吸浮动
  useEffect(() => {
    if (!autoAnimate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(bodyTy, { toValue: -3, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bodyScale, { toValue: 1.015, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bodyTy, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bodyScale, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [autoAnimate]);

  // 眨眼
  useEffect(() => {
    if (!autoAnimate || sleeping) return;
    let cancelled = false;
    const schedule = () => {
      const delay = 1800 + Math.random() * 2800;
      const blink = () => {
        if (cancelled || sleeping) return;
        Animated.sequence([
          Animated.timing(eyeScaleY, { toValue: 0.06, duration: 55, useNativeDriver: true }),
          Animated.timing(eyeScaleY, { toValue: 1, duration: 55, useNativeDriver: true }),
        ]).start(() => schedule());
      };
      setTimeout(blink, delay);
    };
    schedule();
    return () => { cancelled = true; };
  }, [autoAnimate, sleeping]);

  // 头部 wander
  useEffect(() => {
    if (!autoAnimate || sleeping) return;
    let cancelled = false;
    const wander = () => {
      if (cancelled) return;
      Animated.timing(bodyRot, {
        toValue: (Math.random() * 2 - 1) * 2.5,
        duration: 2000 + Math.random() * 1500,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start(() => setTimeout(wander, 600 + Math.random() * 1200));
    };
    wander();
    return () => { cancelled = true; };
  }, [autoAnimate, sleeping]);

  // 视线 wander
  useEffect(() => {
    if (!autoAnimate || sleeping) return;
    let cancelled = false;
    const wander = () => {
      if (cancelled) return;
      const target = (Math.random() * 2 - 1) * 10;
      Animated.timing(eyeOffsetX, {
        toValue: target,
        duration: 1500 + Math.random() * 1500,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start(() => setTimeout(wander, 800 + Math.random() * 1200));
    };
    wander();
    return () => { cancelled = true; };
  }, [autoAnimate, sleeping]);

  const setMoodSafe = useCallback((m: Mood, duration = 320) => {
    setMood(m);
    // happy 小跳
    if (m === 'happy') {
      Animated.sequence([
        Animated.timing(bodyTy, { toValue: -8, duration: 140, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: -6, duration: 140, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (m === 'surprised') {
      Animated.sequence([
        Animated.timing(bodyScale, { toValue: 1.08, duration: 120, useNativeDriver: true }),
        Animated.timing(bodyScale, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [bodyScale, bodyTy]);

  const handleTap = useCallback(() => {
    const next = MOODS[(MOODS.indexOf(mood) + 1) % MOODS.length];
    setMoodSafe(next);
    if (next !== 'idle') {
      setTimeout(() => setMoodSafe('idle'), 2500);
    }
  }, [mood, setMoodSafe]);

  const handleLongPress = useCallback(() => {
    if (sleeping) {
      setMoodSafe('idle', 400);
    } else {
      setMoodSafe('sleep', 500);
    }
  }, [sleeping, setMoodSafe]);

  return (
    <View style={[styles.wrap, { width: botSize, height: botSize }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handleTap}
        onLongPress={handleLongPress}
        delayLongPress={800}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                { translateX: bodyTx },
                { translateY: bodyTy },
                { rotate: bodyRot.interpolate({ inputRange: [-90, 90], outputRange: ["-90deg", "90deg"] }) },
                { scale: bodyScale },
              ],
            },
          ]}
        >
          <Svg viewBox="0 0 200 200" width={botSize} height={botSize}>
            {/* 身体 */}
            <Circle cx={100} cy={100} r={82} fill={BODY_COLORS[mood]} />
            {/* 高光 */}
            <Circle cx={78} cy={60} r={22} fill="rgba(255,255,255,0.3)" />
            {/* 阴影 (底部椭圆) */}
            <Circle cx={100} cy={175} rx={50} ry={6} fill="rgba(0,0,0,0.15)" />

            {/* 左眼 */}
            <Rect
              x={80} y={sleeping ? 78 : 68}
              width={sleeping ? 20 : 12} height={sleeping ? 4 : 44}
              rx={6} ry={6}
              fill="#ffffff"
            />
            {/* 右眼 */}
            <Rect
              x={136} y={sleeping ? 78 : 68}
              width={sleeping ? 20 : 12} height={sleeping ? 4 : 44}
              rx={6} ry={6}
              fill="#ffffff"
            />
          </Svg>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
