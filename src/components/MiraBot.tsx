import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Animated, StyleSheet, TouchableOpacity, Easing, Dimensions } from 'react-native';
import Svg, { Circle, Rect, Defs, RadialGradient, Stop, Filter, FeDropShadow } from 'react-native-svg';
import { theme } from '../theme/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const AnimatedCircle = Animated.createAnimatedComponent(Circle as any);
const AnimatedRect = Animated.createAnimatedComponent(Rect as any);

type Mood = 'idle' | 'happy' | 'sad' | 'angry' | 'surprised' | 'sleepy' | 'sleep' | 'bored';

interface Pose {
  lw: number; lh: number;
  rw: number; rh: number;
  ly: number; ry: number;
  bodyScale: number;
}

const POSES: Record<Mood, Pose> = {
  idle:      { lw: 12, lh: 44, rw: 12, rh: 44, ly: 0,  ry: 0,  bodyScale: 1    },
  happy:     { lw: 14, lh: 30, rw: 14, rh: 30, ly: -4, ry: -4, bodyScale: 1.02 },
  sad:       { lw: 11, lh: 38, rw: 11, rh: 38, ly: 4,  ry: 4,  bodyScale: 0.98 },
  angry:     { lw: 13, lh: 34, rw: 13, rh: 34, ly: 2,  ry: 2,  bodyScale: 0.99 },
  surprised: { lw: 28, lh: 40, rw: 28, rh: 40, ly: 0,  ry: 0,  bodyScale: 1.05 },
  sleepy:    { lw: 12, lh: 20, rw: 12, rh: 20, ly: 0,  ry: 0,  bodyScale: 0.99 },
  sleep:     { lw: 14, lh: 4,  rw: 14, rh: 4,  ly: 0,  ry: 0,  bodyScale: 0.97 },
  bored:     { lw: 12, lh: 36, rw: 12, rh: 36, ly: 0,  ry: 0,  bodyScale: 1    },
};

const MOODS: Mood[] = ['idle', 'happy', 'sad', 'angry', 'surprised', 'sleep', 'bored'];

interface Props {
  size?: number;
  autoAnimate?: boolean;
}

export default function MiraBot({ size, autoAnimate = true }: Props) {
  const botSize = size ?? Math.min(SCREEN_W * 0.55, 260);

  // 整个 body 的 transform（scale + translate + rotate）
  const bodyScale = useRef(new Animated.Value(1)).current;
  const bodyTx = useRef(new Animated.Value(0)).current;
  const bodyTy = useRef(new Animated.Value(0)).current;
  const bodyRot = useRef(new Animated.Value(0)).current;
  const eyeSquish = useRef(new Animated.Value(1)).current; // angry 时眼睛水平挤压

  // 眼睛参数
  const lw = useRef(new Animated.Value(POSES.idle.lw)).current;
  const lh = useRef(new Animated.Value(POSES.idle.lh)).current;
  const ly = useRef(new Animated.Value(POSES.idle.ly)).current;
  const lxOffset = useRef(new Animated.Value(0)).current; // 视线 wander X
  const rw = useRef(new Animated.Value(POSES.idle.rw)).current;
  const rh = useRef(new Animated.Value(POSES.idle.rh)).current;
  const ry = useRef(new Animated.Value(POSES.idle.ry)).current;
  const rxOffset = useRef(new Animated.Value(0)).current;

  const blinkScaleY = useRef(new Animated.Value(1)).current;
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
          Animated.timing(blinkScaleY, { toValue: 0.06, duration: 55, useNativeDriver: true }),
          Animated.timing(blinkScaleY, { toValue: 1, duration: 55, useNativeDriver: true }),
        ]).start(() => schedule());
      };
      setTimeout(blink, delay);
    };
    schedule();
    return () => { cancelled = true; };
  }, [autoAnimate, sleeping]);

  // 头部轻微倾斜 wander
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

  // 视线 X wander
  useEffect(() => {
    if (!autoAnimate || sleeping) return;
    let cancelled = false;
    const wander = () => {
      if (cancelled) return;
      const amp = 5 + Math.random() * 8;
      const target = (Math.random() * 2 - 1) * amp;
      Animated.parallel([
        Animated.timing(lxOffset, { toValue: target, duration: 1500 + Math.random() * 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(rxOffset, { toValue: target, duration: 1500 + Math.random() * 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(() => setTimeout(wander, 800 + Math.random() * 1200));
    };
    wander();
    return () => { cancelled = true; };
  }, [autoAnimate, sleeping]);

  const setPose = useCallback((m: Mood, duration = 320) => {
    setMood(m);
    const p = POSES[m];
    Animated.parallel([
      Animated.timing(lw, { toValue: p.lw, duration, useNativeDriver: false }),
      Animated.timing(lh, { toValue: p.lh, duration, useNativeDriver: false }),
      Animated.timing(ly, { toValue: p.ly, duration, useNativeDriver: true }),
      Animated.timing(rw, { toValue: p.rw, duration, useNativeDriver: false }),
      Animated.timing(rh, { toValue: p.rh, duration, useNativeDriver: false }),
      Animated.timing(ry, { toValue: p.ry, duration, useNativeDriver: true }),
      Animated.timing(bodyScale, { toValue: p.bodyScale, duration, useNativeDriver: true }),
    ]).start();

    if (m === 'happy') {
      Animated.sequence([
        Animated.timing(bodyTy, { toValue: -10, duration: 160, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: -7, duration: 160, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start();
    } else if (m === 'surprised') {
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.timing(bodyTx, { toValue: 3, duration: 60, useNativeDriver: true }),
          Animated.timing(bodyTy, { toValue: -2, duration: 60, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bodyTx, { toValue: -3, duration: 60, useNativeDriver: true }),
          Animated.timing(bodyTy, { toValue: 2, duration: 60, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bodyTx, { toValue: 2, duration: 60, useNativeDriver: true }),
          Animated.timing(bodyTy, { toValue: -1, duration: 60, useNativeDriver: true }),
        ]),
        Animated.timing(bodyTx, { toValue: 0, duration: 100, useNativeDriver: true }),
        Animated.timing(bodyTy, { toValue: 0, duration: 100, useNativeDriver: true }),
      ]).start();
    } else if (m === 'angry') {
      Animated.sequence([
        Animated.timing(eyeSquish, { toValue: 0.85, duration: 100, useNativeDriver: true }),
        Animated.timing(eyeSquish, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.timing(eyeSquish, { toValue: 0.88, duration: 100, useNativeDriver: true }),
        Animated.timing(eyeSquish, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [lw, lh, ly, rw, rh, ry, bodyScale, bodyTx, bodyTy, eyeSquish]);

  const handleTap = useCallback(() => {
    const next = MOODS[(MOODS.indexOf(mood) + 1) % MOODS.length];
    setPose(next);
    if (next !== 'idle') {
      setTimeout(() => setPose('idle'), 2500);
    }
  }, [mood, setPose]);

  const handleLongPress = useCallback(() => {
    if (sleeping) {
      setPose('idle', 400);
    } else {
      setPose('sleepy', 500);
      setTimeout(() => setPose('sleep', 600), 550);
    }
  }, [sleeping, setPose]);

  // SVG transform 字符串
  const bodyTransform = Animated.template`translate(${bodyTx}, ${bodyTy}) rotate(${bodyRot} 100 100) scale(${bodyScale})`;

  // 眼睛 transform（位置 + 眨眼纵向压缩）
  const leftEyeTransform = Animated.template`translate(${Animated.add(80, lxOffset)}, ${Animated.add(68, ly)}) scale(${Animated.multiply(eyeSquish, 1)}, ${blinkScaleY})`;
  const rightEyeTransform = Animated.template`translate(${Animated.add(136, rxOffset)}, ${Animated.add(68, ry)}) scale(${Animated.multiply(eyeSquish, 1)}, ${blinkScaleY})`;

  // 圆角
  const leftRx = Animated.min(Animated.divide(lw, 2), Animated.divide(lh, 2));
  const rightRx = Animated.min(Animated.divide(rw, 2), Animated.divide(rh, 2));

  return (
    <View style={[styles.wrap, { width: botSize, height: botSize }]}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleTap}
        onLongPress={handleLongPress}
        delayLongPress={800}
        style={StyleSheet.absoluteFill}
      >
        <Svg viewBox="0 0 200 200" width={botSize} height={botSize}>
          <Defs>
            <RadialGradient id="bodyGrad" cx="35%" cy="28%" r="75%">
              <Stop offset="0%" stopColor="#c4b5fd" />
              <Stop offset="50%" stopColor="#a78bfa" />
              <Stop offset="100%" stopColor="#8b7cf6" />
            </RadialGradient>
            <Filter id="shadow" x="-20%" y="-10%" width="140%" height="130%">
              <FeDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#8b7cf6" floodOpacity="0.35" />
            </Filter>
          </Defs>

          {/* 身体 + 眼睛（统一 transform）*/}
          <AnimatedCircle
            cx={100} cy={100} r={82}
            fill="url(#bodyGrad)"
            filter="url(#shadow)"
            transform={bodyTransform}
          />
          {/* 高光（跟着身体动）*/}
          <AnimatedCircle
            cx={78} cy={60} r={22}
            fill="rgba(255,255,255,0.35)"
            transform={bodyTransform}
          />

          {/* 左眼 */}
          <AnimatedRect
            x={Animated.divide(lw, -2)}
            y={Animated.divide(lh, -2)}
            width={lw}
            height={lh}
            rx={leftRx}
            ry={leftRx}
            fill="#ffffff"
            transform={Animated.template`${bodyTransform} ${leftEyeTransform}`}
          />
          {/* 右眼 */}
          <AnimatedRect
            x={Animated.divide(rw, -2)}
            y={Animated.divide(rh, -2)}
            width={rw}
            height={rh}
            rx={rightRx}
            ry={rightRx}
            fill="#ffffff"
            transform={Animated.template`${bodyTransform} ${rightEyeTransform}`}
          />
        </Svg>
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
