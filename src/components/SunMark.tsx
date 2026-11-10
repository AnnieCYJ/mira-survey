import React from 'react';
import { ViewStyle } from 'react-native';
import Svg, { Circle, Path, Defs, RadialGradient, Stop } from 'react-native-svg';

type Props = {
  /** 直径（px）。默认 24 */
  size?: number;
  style?: ViewStyle;
};

/**
 * SunMark —— 发光太阳标记。
 * 还原用户提供的 sun-glow.svg 视觉（金渐变圆 + 光晕 + 8 角星），透明背景，
 * 作为「当日达标」的标记：日回顾卡片右上角、月历达标日。
 * 用 react-native-svg 原生绘制，零外部资源依赖、跨平台一致。
 */
export default function SunMark({ size = 24, style }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" style={style}>
      <Defs>
        {/* 外圈柔光晕 */}
        <RadialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFFDEC" stopOpacity={0.55} />
          <Stop offset="35%" stopColor="#FDF1C8" stopOpacity={0.28} />
          <Stop offset="70%" stopColor="#E9D49A" stopOpacity={0.1} />
          <Stop offset="100%" stopColor="#E9D49A" stopOpacity={0} />
        </RadialGradient>
        {/* 主体圆：中心亮金 → 边缘深金 */}
        <RadialGradient id="sunBody" cx="50%" cy="44%" r="58%">
          <Stop offset="0%" stopColor="#FFFCEE" />
          <Stop offset="22%" stopColor="#F8ECB4" />
          <Stop offset="50%" stopColor="#E6C77E" />
          <Stop offset="78%" stopColor="#A2945C" />
          <Stop offset="100%" stopColor="#6C6240" />
        </RadialGradient>
        {/* 8 角星：金 */}
        <RadialGradient id="sunStar" cx="42%" cy="36%" r="74%">
          <Stop offset="0%" stopColor="#ECCA5E" />
          <Stop offset="60%" stopColor="#C79A32" />
          <Stop offset="100%" stopColor="#9A7524" />
        </RadialGradient>
      </Defs>
      {/* 光晕 */}
      <Circle cx="100" cy="100" r="96" fill="url(#sunGlow)" />
      {/* 主体圆 */}
      <Circle cx="100" cy="100" r="64" fill="url(#sunBody)" />
      {/* 8 角星（由 sun-glow.svg 原坐标平移到 200×200 中心） */}
      <Path
        d="M100 46 L113.01 68.59 L138.18 61.82 L131.41 86.99 L154 100 L131.41 113.01 L138.18 138.18 L113.01 131.41 L100 154 L86.99 131.41 L61.82 138.18 L68.59 113.01 L46 100 L68.59 86.99 L61.82 61.82 L86.99 68.59 Z"
        fill="url(#sunStar)"
      />
      {/* 中心亮点 */}
      <Circle cx="100" cy="100" r="4.5" fill="#FFFDF2" />
    </Svg>
  );
}
