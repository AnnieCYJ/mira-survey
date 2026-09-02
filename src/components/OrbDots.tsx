import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';

const INNER_COUNT = 16;
const MID_COUNT = 22;
const OUTER_COUNT = 8;

const DOT_COLORS = [
  theme.colors.accentSolid,
  theme.colors.accent1,
  theme.colors.accent2,
  '#C9BBF7',
  '#8FB4FA',
];

export default function OrbDots() {
  const { width } = useWindowDimensions();
  const size = Math.min(width - theme.space.screen * 2, 320);
  const c = size / 2;

  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const dots = useMemo(() => {
    const makeRing = (
      count: number,
      radius: number,
      sizeBase: number,
      sizeRange: number,
      opacityBase: number,
      opacityRange: number,
      angleJitter: number
    ) => {
      return Array.from({ length: count }).map((_, i) => {
        const baseAngle = (i / count) * Math.PI * 2;
        const jitter = (Math.random() - 0.5) * angleJitter;
        const angle = baseAngle + jitter;
        const r = radius + (Math.random() - 0.5) * (size * 0.03);
        const x = c + r * Math.cos(angle);
        const y = c + r * Math.sin(angle);
        const s = theme.sp(sizeBase) + Math.random() * theme.sp(sizeRange);
        const opacity = opacityBase + Math.random() * opacityRange;
        const delay = Math.random() * 2600;
        const color = DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)];
        return { x, y, s, opacity, delay, color, key: `${radius}-${i}` };
      });
    };

    const inner = makeRing(INNER_COUNT, size * 0.26, 1.0, 0.7, 0.55, 0.25, 0.45);
    const mid = makeRing(MID_COUNT, size * 0.31, 1.3, 0.9, 0.48, 0.22, 0.55);
    const outer = makeRing(OUTER_COUNT, size * 0.37, 1.7, 1.1, 0.40, 0.18, 0.75);
    return [...inner, ...mid, ...outer];
  }, [size, c]);

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 3400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => {
      spin.stop();
      pulse.stop();
    };
  }, [rotateAnim, pulseAnim]);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const glowScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const glowOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 0.98] });

  const glowSize = size * 1.18;

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
            transform: [{ scale: glowScale }],
            opacity: glowOpacity,
          },
        ]}
      >
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            <RadialGradient id="orbGlow" cx="50%" cy="50%" r="52%">
              <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity="0.52" />
              <Stop offset="28%" stopColor={theme.colors.accent1} stopOpacity="0.30" />
              <Stop offset="52%" stopColor={theme.colors.accent2} stopOpacity="0.14" />
              <Stop offset="76%" stopColor="#B5A9F2" stopOpacity="0.04" />
              <Stop offset="100%" stopColor="#B5A9F2" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#orbGlow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ rotate }] }]}>
        {dots.map((d) => (
          <OrbitingDot key={d.key} x={d.x} y={d.y} size={d.s} opacity={d.opacity} delay={d.delay} color={d.color} />
        ))}
      </Animated.View>

      <View style={styles.textWrap} pointerEvents="none">
        <Text style={styles.title}>Hi, can I</Text>
        <Text style={styles.title}>help you?</Text>
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
          duration: 2000 + Math.random() * 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 2000 + Math.random() * 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.2] });
  const alpha = anim.interpolate({ inputRange: [0, 1], outputRange: [opacity * 0.72, opacity] });

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
  wrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginVertical: theme.sp(3) },
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
    textShadowColor: 'rgba(80,62,142,0.32)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 16,
  },
});
