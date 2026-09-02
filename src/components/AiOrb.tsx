import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';

interface Props {
  size?: number;
  title?: string;
}

const INNER_COUNT = 18;
const MID_COUNT = 26;
const OUTER_COUNT = 14;

export default function AiOrb({ size = 220, title = 'Hi, can I help you?' }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 3200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    const spin = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 24000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();

    return () => {
      loop.stop();
      spin.stop();
    };
  }, [pulse, rotateAnim]);

  const particles = useMemo(() => {
    const c = size / 2;
    const makeRing = (
      count: number,
      radius: number,
      sizeBase: number,
      sizeRange: number,
      opacityBase: number,
      opacityRange: number,
      colorSolidRatio: number,
      angleJitter: number
    ) =>
      Array.from({ length: count }).map((_, i) => {
        const baseAngle = (i / count) * Math.PI * 2;
        const angle = baseAngle + (Math.random() - 0.5) * angleJitter;
        const r = radius + (Math.random() - 0.5) * (size * 0.02);
        const x = c + r * Math.cos(angle);
        const y = c + r * Math.sin(angle);
        const s = theme.sp(sizeBase) + Math.random() * theme.sp(sizeRange);
        const opacity = opacityBase + Math.random() * opacityRange;
        const delay = Math.random() * 2600;
        const color = Math.random() < colorSolidRatio ? theme.colors.accentSolid : theme.colors.accent1;
        return { x, y, s, opacity, delay, color, key: `${radius}-${i}` };
      });

    const inner = makeRing(INNER_COUNT, size * 0.32, 0.8, 0.6, 0.32, 0.16, 0.8, 0.35);
    const mid = makeRing(MID_COUNT, size * 0.42, 1.0, 0.8, 0.24, 0.14, 0.5, 0.45);
    const outer = makeRing(OUTER_COUNT, size * 0.52, 1.3, 1.0, 0.18, 0.12, 0.25, 0.55);
    return [...inner, ...mid, ...outer];
  }, [size]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0.95] });
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const glowSize = size * 1.28;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.glowWrap,
          {
            width: glowSize,
            height: glowSize,
            left: (size - glowSize) / 2,
            top: (size - glowSize) / 2,
            transform: [{ scale }],
            opacity,
          },
        ]}
      >
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            <RadialGradient id="aiOrbGlow" cx="50%" cy="50%" r="52%">
              <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity="0.72" />
              <Stop offset="26%" stopColor={theme.colors.accentSolid} stopOpacity="0.44" />
              <Stop offset="48%" stopColor={theme.colors.accent1} stopOpacity="0.20" />
              <Stop offset="72%" stopColor={theme.colors.accent1} stopOpacity="0.06" />
              <Stop offset="90%" stopColor="#B5A9F2" stopOpacity="0.015" />
              <Stop offset="100%" stopColor="#B5A9F2" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#aiOrbGlow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ rotate }] }]}>
        {particles.map((p) => (
          <OrbitingDot key={p.key} x={p.x} y={p.y} size={p.s} opacity={p.opacity} delay={p.delay} color={p.color} />
        ))}
      </Animated.View>

      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

function OrbitingDot({
  x,
  y,
  size,
  opacity,
  delay,
  color,
}: {
  x: number;
  y: number;
  size: number;
  opacity: number;
  delay: number;
  color: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 1800 + Math.random() * 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 1800 + Math.random() * 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.12] });
  const alpha = anim.interpolate({ inputRange: [0, 1], outputRange: [opacity * 0.55, opacity] });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale }],
          opacity: alpha,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  glowWrap: { position: 'absolute' },
  dot: { position: 'absolute' },
  textWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.lg,
  },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
    textAlign: 'center',
    textShadowColor: 'rgba(80,62,142,0.30)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 14,
  },
});
