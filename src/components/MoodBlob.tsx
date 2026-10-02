/**
 * MoodBlob —— 会动的情绪小家伙（参考视频：果冻小团随心情变形/变色/变表情）
 *
 * 结构（遵守项目铁律「固定形状+整层 scale/opacity，全 Native Driver」）：
 *  - 两层同色不同相位的 blob 路径（120 点极坐标采样生成），循环交叉淡入淡出 = 果冻蠕动变形感；
 *  - 外层 Animated.View 呼吸缩放循环 = 活着的感觉；
 *  - 脸（眼睛+嘴）画在最上层静态 SVG，随心情换表情（咧嘴笑/微笑/平静/抿嘴/皱眉）。
 *  - 形状三档：bloom(5 瓣·积极) / wave(6 瓣·平缓) / spiky(8 尖·难受)，与视频「越开心越圆润、
 *    越难受越尖」的语义一致。
 *  - variant 用于同屏多只错拍（时长偏移），避免整排珠子同步呼吸的机械感。
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { MOOD_COLOR, type MoodKey } from '../data/emotionLog';
import { mm } from '../theme/mindmate';

/* ── blob 路径生成（模块级：只算一次） ───────────────────── */
function blobPath(lobes: number, amp: number, phase: number): string {
  const N = 120;
  let d = '';
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 36 * (1 + amp * Math.sin(lobes * a + phase));
    const x = 50 + r * Math.cos(a);
    const y = 50 + r * Math.sin(a);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

const SHAPES = {
  bloom: { lobes: 5, amp: 0.1 },
  wave: { lobes: 6, amp: 0.14 },
  spiky: { lobes: 8, amp: 0.17 },
} as const;
type ShapeKey = keyof typeof SHAPES;

/** 每种形状预生成两个相位（A/B 层交叉淡化 = 变形循环） */
const BLOB_D: Record<ShapeKey, [string, string]> = {
  bloom: [blobPath(5, 0.1, 0.5), blobPath(5, 0.1, 1.6)],
  wave: [blobPath(6, 0.14, 1.1), blobPath(6, 0.14, 2.2)],
  spiky: [blobPath(8, 0.17, 0.2), blobPath(8, 0.17, 1.35)],
};

/** 12 档情绪 → 形状 + 表情（亮→沉，与 MOOD_ORDER 语义一致） */
const FAMILY: Record<MoodKey, { shape: ShapeKey; mouth: 'grin' | 'smile' | 'flat' | 'worried' | 'frown' }> = {
  excited: { shape: 'bloom', mouth: 'grin' },
  happy: { shape: 'bloom', mouth: 'grin' },
  love: { shape: 'bloom', mouth: 'smile' },
  grateful: { shape: 'bloom', mouth: 'smile' },
  pleasant: { shape: 'bloom', mouth: 'smile' },
  calm: { shape: 'wave', mouth: 'flat' },
  tired: { shape: 'wave', mouth: 'flat' },
  stressed: { shape: 'wave', mouth: 'worried' },
  anxious: { shape: 'wave', mouth: 'worried' },
  sad: { shape: 'spiky', mouth: 'frown' },
  angry: { shape: 'spiky', mouth: 'frown' },
  lonely: { shape: 'spiky', mouth: 'frown' },
};

/** 嘴（stroke 圆帽弧线，100×100 视图坐标） */
const MOUTH_D: Record<'grin' | 'smile' | 'flat' | 'worried' | 'frown', string> = {
  grin: 'M39 55 Q50 69 61 55',
  smile: 'M40 57 Q50 66 60 57',
  flat: 'M42 60 Q50 62.5 58 60',
  worried: 'M41 62.5 Q50 55 59 62.5',
  frown: 'M39 65 Q50 52 61 65',
};

interface Props {
  mood: MoodKey;
  /** 像素尺寸（正方形） */
  size: number;
  /** 同屏错拍序号（0-5 即可），不同只错开呼吸/变形节奏 */
  variant?: number;
}

function MoodBlobImpl({ mood, size, variant = 0 }: Props) {
  const color = MOOD_COLOR[mood];
  const { shape, mouth } = FAMILY[mood];
  const [dA, dB] = BLOB_D[shape];

  const breath = useRef(new Animated.Value(1)).current;
  const oA = useRef(new Animated.Value(1)).current;
  const oB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 错拍：variant 偏移时长，天然去同步（不用 delay，循环内不加拍）
    const breathDur = 2300 + (variant % 4) * 270;
    const morphDur = 3500 + (variant % 5) * 430;

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.06,
          duration: breathDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: breathDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const morphLoopA = Animated.loop(
      Animated.sequence([
        Animated.timing(oA, {
          toValue: 0,
          duration: morphDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(oA, {
          toValue: 1,
          duration: morphDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const morphLoopB = Animated.loop(
      Animated.sequence([
        Animated.timing(oB, {
          toValue: 1,
          duration: morphDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(oB, {
          toValue: 0,
          duration: morphDur,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    breathLoop.start();
    morphLoopA.start();
    morphLoopB.start();
    return () => {
      breathLoop.stop();
      morphLoopA.stop();
      morphLoopB.stop();
    };
  }, [breath, oA, oB, variant]);

  const svgSize = useMemo(() => ({ width: size, height: size }), [size]);
  const face = useMemo(
    () => (
      <Svg style={StyleSheet.absoluteFill} {...svgSize} viewBox="0 0 100 100">
        {/* 眼睛 */}
        <Circle cx={39} cy={45} r={3.4} fill={mm.colors.ink} />
        <Circle cx={61} cy={45} r={3.4} fill={mm.colors.ink} />
        {/* 嘴 */}
        <Path
          d={MOUTH_D[mouth]}
          stroke={mm.colors.ink}
          strokeWidth={3.4}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    ),
    [mouth, svgSize],
  );

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: breath }] }}>
      {/* A 层：实色 blob */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: oA }]}>
        <Svg {...svgSize} viewBox="0 0 100 100">
          <Path d={dA} fill={color} opacity={0.92} />
        </Svg>
      </Animated.View>
      {/* B 层：浅一档 blob（交叉淡化 = 蠕动变形） */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: oB }]}>
        <Svg {...svgSize} viewBox="0 0 100 100">
          <Path d={dB} fill={color} opacity={0.55} />
        </Svg>
      </Animated.View>
      {/* 脸（静态，随心情换表情） */}
      {face}
    </Animated.View>
  );
}

export default React.memo(MoodBlobImpl);
