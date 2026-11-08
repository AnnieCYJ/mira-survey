import React from 'react';
import { ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
  /** 主色；默认金 #E6A94E。基座自动取主色加深 12% */
  color?: string;
  style?: ViewStyle;
};

function darken(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amt)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amt)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amt)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 矢量皇冠标记 —— 替换原 emoji 👑（更干净、可换色）。viewBox 24x24。 */
export default function CrownMark({ size = 16, color = '#E6A94E', style }: Props) {
  const base = darken(color, 0.14);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path
        d="M4 19 V10 L8.4 14 L12 6.5 L15.6 14 L20 10 V19 Z"
        fill={color}
        stroke={color}
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
      <Path
        d="M3.6 19 H20.4 V21 H3.6 Z"
        fill={base}
        stroke={base}
        strokeWidth={0.4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
