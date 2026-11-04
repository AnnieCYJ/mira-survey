/**
 * GrokFace —— 可复用「Grok 风」助手头像
 * ---------------------------------------------------------------------------
 * 设计：黑色圆角方块（Grok 标志性 squircle）+ 两只圆眼睛 + 一抹微笑弧。
 * 用在一个地方：首页 AI 大光球、聊天/Onboarding 的小头像、空态占位。
 * 这样「Luna Mira」助手在全局视觉统一为同一张脸。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

type Props = { size?: number; glow?: boolean };

export default function GrokFace({ size = 150, glow = true }: Props) {
  const r = Math.round(size * 0.3); // 圆角方块的圆角半径
  const glowSize = Math.round(size * 1.6);
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {glow && (
        <View
          style={[
            styles.glow,
            { width: glowSize, height: glowSize, borderRadius: glowSize / 2 },
          ]}
        />
      )}
      <View
        style={[
          styles.face,
          { width: size, height: size, borderRadius: r, backgroundColor: '#0B0B12' },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {/* ★ 圆眼睛（Grok 标志） */}
          <Circle cx={37} cy={43} r={9} fill="#FFFFFF" />
          <Circle cx={63} cy={43} r={9} fill="#FFFFFF" />
          {/* ★ 微笑弧 */}
          <Path
            d="M33 60 Q50 72 67 60"
            stroke="#FFFFFF"
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(140,190,255,0.18)',
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});
