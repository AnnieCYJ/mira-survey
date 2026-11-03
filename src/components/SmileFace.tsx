import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient as LNGrad } from 'expo-linear-gradient';
import { theme } from '../theme/theme';

/**
 * 极简笑脸动画组件
 * 眼睛循环：竖条形 → 眯眼过渡 → 小圆点 → 过渡回 → 竖条形
 * 嘴巴保持微笑弧线
 */
export default function SmileFace({ size = 160 }: { size?: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(800),                // 静止竖条 0.8s
        Animated.timing(anim, {             // 过渡到眯眼
          toValue: 0.35, duration: 600,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.timing(anim, {             // 眯眼 → 圆点
          toValue: 0.65, duration: 800,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.delay(400),                // 圆点停留 0.4s
        Animated.timing(anim, {             // 过渡回竖条
          toValue: 1, duration: 600,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.delay(1400),               // 静止竖条 1.4s
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  // 眼睛插值：竖条形 → 眯眼（缩短+圆角+倾斜）→ 圆点 → 恢复
  const eyeHeight = anim.interpolate({
    inputRange: [0, 0.35, 0.65, 1],
    outputRange: [32, 20, 18, 32],
  });
  const eyeWidth = anim.interpolate({
    inputRange: [0, 0.35, 0.65, 1],
    outputRange: [18, 24, 18, 18],
  });
  const eyeRx = anim.interpolate({
    inputRange: [0, 0.35, 0.65, 1],
    outputRange: [3, 8, 9, 3],
  });
  const leftRotate = anim.interpolate({
    inputRange: [0, 0.25, 0.45, 0.65, 0.85, 1],
    outputRange: [0, -15, 15, 0, 0, 0],
  });
  const rightRotate = anim.interpolate({
    inputRange: [0, 0.25, 0.45, 0.65, 0.85, 1],
    outputRange: [0, 15, -15, 0, 0, 0],  // 镜像
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* 嘴巴：微笑弧线 */}
      <Svg width={size} height={size} viewBox="0 0 200 200" style={{ position: 'absolute' }}>
        <Path
          d="M 55 115 Q 100 145 145 115"
          fill="none"
          stroke="#ffffff"
          strokeWidth="12"
          strokeLinecap="round"
        />
      </Svg>
      {/* 左眼睛 */}
      <Animated.View
        style={{
          position: 'absolute',
          left: size * 0.33,
          top: size * 0.38,
          width: eyeWidth,
          height: eyeHeight,
          borderRadius: eyeRx,
          backgroundColor: '#ffffff',
          transform: [{ rotate: leftRotate }],
        }}
      />
      {/* 右眼睛 */}
      <Animated.View
        style={{
          position: 'absolute',
          right: size * 0.33,
          top: size * 0.38,
          width: eyeWidth,
          height: eyeHeight,
          borderRadius: eyeRx,
          backgroundColor: '#ffffff',
          transform: [{ rotate: rightRotate }],
        }}
      />
    </View>
  );
}

// ——— 整屏欢迎页（紫色渐变背景 + 笑脸 + 名字）———
export function WelcomeFace({
  name = 'Ryan',
  faceSize = 160,
}: {
  name?: string;
  faceSize?: number;
}) {
  return (
    <LNGrad
      colors={['#8B7BDB', '#6E5BB5', '#5D4AA0']}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <SmileFace size={faceSize} />
      <Text style={styles.greeting}>Hi {name}</Text>
    </LNGrad>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: {
    marginTop: theme.space.cardPad,
    fontSize: theme.fontSize.stat,
    fontWeight: theme.weight.semibold,
    color: '#ffffff',
    letterSpacing: 0.5,
  },
});
