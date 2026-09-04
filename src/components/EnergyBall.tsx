import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { DEFAULT_MOOD, MOODS, type MoodIndex } from '../data/metrics';
import { type CurveStatus } from '../lib/dailyStatus';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** 当前「今日状态」曲线结果；传入后圆环按计算出的状态等级 + 电量值展示，否则回退为手动选择的心情 */
  status?: CurveStatus | null;
  onMoodChange?: (i: MoodIndex) => void;
}

// 计算等级（充沛/平稳/偏低/不足）→ 圆环四色点序号
const LEVEL_MOOD_IDX: Record<string, MoodIndex> = {
  充沛: 0,
  平稳: 1,
  偏低: 2,
  不足: 3,
};

export default function EnergyBall({ status, onMoodChange }: Props) {
  const { width: winW } = useWindowDimensions();
  const avail = Math.min(winW, theme.layout.maxWidth) - theme.space.screen * 2;
  const size = avail * 0.74;
  const svgSize = size * 1.32;
  const c = svgSize / 2;
  const ringR = (size / 2) * 0.843;
  // 4 个点放在白色环上：与白色环共用同一半径
  const dotR = ringR;

  const [active, setActive] = useState<MoodIndex>(DEFAULT_MOOD);
  // 有计算状态时，圆环跟随计算结果（等级 + 电量值）；否则回退为手动选择的心情
  const hi: MoodIndex =
    status?.level != null && LEVEL_MOOD_IDX[status.level] != null
      ? LEVEL_MOOD_IDX[status.level]
      : active;
  const mood = MOODS[hi];
  // 空状态（无数据）：圆环统一紫色，中间显示「暂无数据」
  const EMPTY_COLOR = '#9D8AF0';
  const moodColor = MOODS[hi].color;
  const hasData = !!(status?.hasData && status.value != null);
  const ringColor = hasData ? moodColor : EMPTY_COLOR;
  const centerLabel = hasData ? mood.label : '暂无数据';
  const statusValue = hasData ? Math.round(status.value as number) : null;

  const dotAnims = useRef(MOODS.map(() => new Animated.Value(0))).current;
  // 呼吸光晕：只作用于中间弥散的彩色，不缩放文字
  const halo = useRef(new Animated.Value(0)).current;
  // 轨道公转：整层绕中心缓慢旋转，让四个状态点像行星环绕
  const orbit = useRef(new Animated.Value(0)).current;
  const orbitRotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
    const ease = Easing.inOut(Easing.ease);
    const loops = dotAnims.map((a, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(a, {
            toValue: 1,
            duration: theme.motion.breath.dot / 2,
            easing: ease,
            useNativeDriver: true,
          }),
          Animated.timing(a, {
            toValue: 0,
            duration: theme.motion.breath.dot / 2,
            easing: ease,
            useNativeDriver: true,
          }),
        ])
      );
      const t = setTimeout(() => loop.start(), i * 450);
      return { loop, t };
    });

    // SVG 属性动画不能走 native driver
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, {
          toValue: 1,
          duration: theme.motion.breath.halo / 2,
          easing: ease,
          useNativeDriver: false,
        }),
        Animated.timing(halo, {
          toValue: 0,
          duration: theme.motion.breath.halo / 2,
          easing: ease,
          useNativeDriver: false,
        }),
      ])
    );
    haloLoop.start();

    // 行星环绕：整体匀速公转（约 32 秒一圈，缓慢移动）
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 32000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    orbitLoop.start();

    return () => {
      loops.forEach(({ loop, t }) => {
        clearTimeout(t);
        loop.stop();
      });
      haloLoop.stop();
      orbitLoop.stop();
    };
  }, [dotAnims, halo, orbit]);

  // 中间彩色光晕：半径与透明度一起呼吸，范围明显更大、更弥散
  const glowR = halo.interpolate({
    inputRange: [0, 1],
    outputRange: [ringR * 0.45, ringR * 1.32],
  });
  const glowOpacity = halo.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0.96],
  });

  const dots = useMemo(
    () =>
      MOODS.map((m) => {
        const rad = ((m.angle - 90) * Math.PI) / 180;
        return { ...m, x: c + dotR * Math.cos(rad), y: c + dotR * Math.sin(rad) };
      }),
    [c, dotR]
  );

  const press = (i: number) => {
    setActive(i as MoodIndex);
    onMoodChange?.(i as MoodIndex);
  };

  return (
    <View style={{ width: svgSize, height: svgSize, alignSelf: 'center' }}>
      <Svg width={svgSize} height={svgSize}>
        <Defs>
          {/* 外圈光晕：跟随情绪色，向环外大幅扩散 */}
          <RadialGradient key={`aura-${ringColor}`} id="aura" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={ringColor} stopOpacity="0" />
            <Stop offset="46%" stopColor={ringColor} stopOpacity="0" />
            <Stop offset="60%" stopColor={ringColor} stopOpacity="0.14" />
            <Stop offset="74%" stopColor={ringColor} stopOpacity="0.40" />
            <Stop offset="86%" stopColor={ringColor} stopOpacity="0.22" />
            <Stop offset="100%" stopColor={ringColor} stopOpacity="0" />
          </RadialGradient>
          {/* 中央彩色呼吸光晕：跟随情绪色（key 强制按颜色重挂，避免渐变缓存），范围更大更弥散 */}
          <RadialGradient key={ringColor} id="moodGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={ringColor} stopOpacity="0.86" />
            <Stop offset="38%" stopColor={ringColor} stopOpacity="0.54" />
            <Stop offset="70%" stopColor={ringColor} stopOpacity="0.16" />
            <Stop offset="100%" stopColor={ringColor} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Circle cx={c} cy={c} r={svgSize / 2} fill="url(#aura)" />
        {/* 中间弥散彩色呼吸光晕（仅颜色变化，不动文字） */}
        <AnimatedCircle
          cx={c}
          cy={c}
          r={glowR}
          fill="url(#moodGlow)"
          opacity={glowOpacity}
        />
        {/* 四个状态点所在的环：跟随情绪色切换；无数据时统一紫色 */}
        <Circle cx={c} cy={c} r={ringR} stroke={ringColor} strokeWidth={2.8} fill="none" opacity={0.92} />
      </Svg>

      {/* 轨道层：四个状态点像行星一样绕中心缓慢公转（中心文字不转） */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { pointerEvents: 'box-none', transform: [{ rotate: orbitRotate }] },
        ]}
      >
        {dots.map((d, i) => {
          const isOn = i === hi;
          const scale = dotAnims[i].interpolate({
            inputRange: [0, 1],
            outputRange: isOn ? [1.38, 1.82] : [0.96, 1.24],
          });
          return (
            <Animated.View
              key={`dot-${d.key}`}
              style={[
                styles.dot,
                {
                  left: d.x - theme.sp(1.5),
                  top: d.y - theme.sp(1.5),
                  backgroundColor: hasData ? d.color : ringColor,
                  transform: [{ scale }],
                  shadowColor: hasData ? d.color : ringColor,
                  shadowOpacity: isOn ? 0.9 : 0.4,
                  shadowRadius: isOn ? 18 : 8,
                  zIndex: isOn ? 3 : 2,
                },
              ]}
            />
          );
        })}

        {dots.map((d, i) => (
          <TouchableOpacity
            key={`hit-${d.key}`}
            style={[
              styles.hit,
              { left: d.x - theme.sp(6), top: d.y - theme.sp(6), width: theme.sp(12), height: theme.sp(12), zIndex: 10 },
            ]}
            onPress={() => press(i)}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel={d.label}
          />
        ))}
      </Animated.View>

      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.label, !hasData && styles.emptyLabel]}>{centerLabel}</Text>
        {statusValue != null && <Text style={styles.statusValue}>状态值：{statusValue}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    width: theme.sp(3),
    height: theme.sp(3),
    borderRadius: theme.radius.pill,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 4,
  },
  center: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: theme.fontSize.orb,
    color: theme.colors.orbTextInk,
    fontWeight: theme.weight.medium,
    textShadowColor: 'rgba(255,255,255,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  emptyLabel: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    textShadowColor: 'transparent',
    textShadowRadius: 0,
  },
  statusValue: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.orbTextInkSub,
    marginTop: theme.space.xs,
    fontWeight: theme.weight.medium,
  },
  hit: { position: 'absolute', borderRadius: theme.radius.pill },
});
