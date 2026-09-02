import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface Particle {
  anim: Animated.Value;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  rotFrom: string;
  rotMid: string;
  rotTo: string;
  size: number;
  height: number;
  radius: number;
  color: string;
}

interface Props {
  visible: boolean;
  duration?: number;
  count?: number;
  loop?: boolean;
}

const PALETTE = ['#F0C46E', '#6FCFB4', '#9D8AF0', '#F2A3C6', '#E8A87C', '#7C6AE0', '#8FB4FA'];

function createParticles(count: number): Particle[] {
  const centerX = SCREEN_W / 2;
  const centerY = SCREEN_H / 2;
  const maxR = Math.min(SCREEN_W, SCREEN_H) * 0.55;

  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = maxR * (0.25 + Math.random() * 0.75);
    const size = 5 + Math.random() * 9;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    return {
      anim: new Animated.Value(0),
      fromX: centerX,
      toX: centerX + dx * (0.9 + Math.random() * 0.3),
      fromY: centerY,
      toY: centerY + dy * (0.8 + Math.random() * 0.25),
      rotFrom: `${Math.random() * 360}deg`,
      rotMid: `${Math.random() * 720}deg`,
      rotTo: `${Math.random() * 1080}deg`,
      size,
      height: size * (0.35 + Math.random() * 0.65),
      radius: Math.random() > 0.5 ? size / 2 : 2,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    };
  });
}

export default function Confetti({ visible, duration = 3000, count = 80, loop = false }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const animsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    if (!visible) {
      animsRef.current.forEach((a) => a.stop());
      animsRef.current = [];
      setParticles([]);
      return;
    }

    const ps = createParticles(count);
    setParticles(ps);

    animsRef.current = ps.map((p) => {
      const d = duration * (0.6 + Math.random() * 0.4);
      const delay = Math.random() * 400;
      const seq = Animated.sequence([
        Animated.delay(delay),
        Animated.timing(p.anim, {
          toValue: 1,
          duration: d,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          useNativeDriver: true,
        }),
      ]);
      const runner = loop ? Animated.loop(seq) : seq;
      runner.start();
      return runner;
    });

    // 礼花全部播放完毕后彻底清空，避免粒子停留在界面
    const clearTimer = setTimeout(() => {
      animsRef.current.forEach((a) => a.stop());
      animsRef.current = [];
      setParticles([]);
    }, duration + 600);

    return () => {
      clearTimeout(clearTimer);
      animsRef.current.forEach((a) => a.stop());
      animsRef.current = [];
    };
  }, [visible, duration, count, loop]);

  const rendered = useMemo(
    () =>
      particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              width: p.size,
              height: p.height,
              borderRadius: p.radius,
              backgroundColor: p.color,
              opacity: p.anim.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: p.anim.interpolate({ inputRange: [0, 1], outputRange: [p.fromX, p.toX] }) },
                { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [p.fromY, p.toY] }) },
                { rotate: p.anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [p.rotFrom, p.rotMid, p.rotTo] }) },
              ],
            },
          ]}
        />
      )),
    [particles]
  );

  if (!visible || particles.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {rendered}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, zIndex: 1001, pointerEvents: 'none' },
  particle: { position: 'absolute', top: 0, left: 0 },
});
