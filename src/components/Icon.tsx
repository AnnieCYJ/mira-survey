import React from 'react';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { theme } from '../theme/theme';

export type IconName =
  | 'home'
  | 'insights'
  | 'orb'
  | 'tools'
  | 'calendar'
  | 'back'
  | 'arrowRight'
  | 'sparkle'
  | 'send'
  | 'check'
  | 'plus'
  | 'breath'
  | 'mind'
  | 'focus'
  | 'learn'
  | 'chevronLeft'
  | 'chevronRight'
  | 'pen'
  | 'image'
  | 'close'
  | 'play'
  | 'bell'
  | 'sync'
  | 'ring'
  | 'heart'
  | 'drop'
  | 'thermometer'
  | 'activity';

type Node = { p: string } | { cx: number; cy: number; r: number; fill?: boolean };

interface IconDef {
  mode: 'stroke' | 'fill';
  nodes: Node[];
}

const ICONS: Record<IconName, IconDef> = {
  home: { mode: 'fill', nodes: [{ p: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' }] },
  insights: { mode: 'stroke', nodes: [{ p: 'M3 3v18h18' }, { p: 'M7 15l4-5 3 3 5-7' }] },
  orb: {
    mode: 'stroke',
    nodes: [
      { cx: 12, cy: 12, r: 7 },
      { cx: 12, cy: 12, r: 2.5, fill: true },
      { cx: 12, cy: 4, r: 1.6, fill: true },
      { cx: 20, cy: 12, r: 1.6, fill: true },
      { cx: 12, cy: 20, r: 1.6, fill: true },
      { cx: 4, cy: 12, r: 1.6, fill: true },
    ],
  },
  tools: {
    mode: 'stroke',
    nodes: [
      { p: 'M3 3h7v7H3z' },
      { p: 'M14 3h7v7h-7z' },
      { p: 'M3 14h7v7H3z' },
      { p: 'M14 14h7v7h-7z' },
    ],
  },
  calendar: {
    mode: 'stroke',
    nodes: [{ p: 'M3 4h18v18H3z' }, { p: 'M16 2v4M8 2v4M3 10h18' }],
  },
  back: { mode: 'stroke', nodes: [{ p: 'M15 18l-6-6 6-6' }] },
  arrowRight: { mode: 'stroke', nodes: [{ p: 'M5 12h13M13 6l6 6-6 6' }] },
  sparkle: {
    mode: 'stroke',
    nodes: [{ p: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' }],
  },
  send: { mode: 'stroke', nodes: [{ p: 'M22 2L11 13M22 2l-7 20-4-9-9-4z' }] },
  check: { mode: 'stroke', nodes: [{ p: 'M20 6L9 17l-5-5' }] },
  plus: { mode: 'stroke', nodes: [{ p: 'M12 5v14M5 12h14' }] },
  breath: {
    mode: 'stroke',
    nodes: [
      { p: 'M12 22c4.97 0 9-4.03 9-9-4.5 0-9-4.5-9-9 0 4.5-4.5 9-9 9 0 4.97 4.03 9 9 9z' },
    ],
  },
  mind: {
    mode: 'stroke',
    nodes: [
      { p: 'M9.5 2a5.5 5.5 0 0 0-3.3 9.9A4.5 4.5 0 0 0 8 21h1v-6h6v6h1a4.5 4.5 0 0 0 1.8-9.1A5.5 5.5 0 0 0 14.5 2z' },
    ],
  },
  focus: {
    mode: 'stroke',
    nodes: [
      { p: 'M13 2L4.1 12.8a1 1 0 0 0 .8 1.6H11l-1 7.6 8.9-10.8a1 1 0 0 0-.8-1.6H12l1-7.6z' },
    ],
  },
  learn: {
    mode: 'stroke',
    nodes: [
      { p: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' },
      { p: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
    ],
  },
  chevronLeft: { mode: 'stroke', nodes: [{ p: 'M15 18l-6-6 6-6' }] },
  chevronRight: { mode: 'stroke', nodes: [{ p: 'M9 18l6-6-6-6' }] },
  pen: {
    mode: 'stroke',
    nodes: [
      { p: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' },
    ],
  },
  image: {
    mode: 'stroke',
    nodes: [
      { p: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z' },
      { p: 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
      { p: 'M21 15l-5-5L5 21' },
    ],
  },
  close: {
    mode: 'stroke',
    nodes: [
      { p: 'M18 6L6 18' },
      { p: 'M6 6l12 12' },
    ],
  },
  play: {
    mode: 'fill',
    nodes: [{ p: 'M8 5v14l11-7z' }],
  },
  bell: {
    mode: 'stroke',
    nodes: [{ p: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }, { p: 'M13.73 21a2 2 0 0 1-3.46 0' }],
  },
  sync: {
    mode: 'stroke',
    nodes: [
      { p: 'M4 12a8 8 0 0 1 13.7-5.6L20 8' },
      { p: 'M20 4v4h-4' },
      { p: 'M20 12a8 8 0 0 1-13.7 5.6L4 16' },
      { p: 'M4 20v-4h4' },
    ],
  },
  ring: {
    mode: 'stroke',
    nodes: [{ cx: 12, cy: 12, r: 8 }, { cx: 12, cy: 12, r: 3.4 }],
  },
  heart: {
    mode: 'fill',
    nodes: [
      {
        p: 'M12 21s-6.7-4.35-9.3-8.5C.9 9.4 2.1 5.5 5.6 5.5c2 0 3.3 1.1 4.4 2.6 1.1-1.5 2.4-2.6 4.4-2.6 3.5 0 4.7 3.9 2.9 7C18.7 16.65 12 21 12 21z',
      },
    ],
  },
  drop: {
    mode: 'fill',
    nodes: [{ p: 'M12 2.5s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11z' }],
  },
  thermometer: {
    mode: 'stroke',
    nodes: [
      { p: 'M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0z' },
      { cx: 12, cy: 18, r: 1.6 },
    ],
  },
  activity: {
    mode: 'stroke',
    nodes: [{ p: 'M22 12h-4l-3 9L9 3l-3 9H2' }],
  },
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export default function Icon({
  name,
  size = theme.fs(24),
  color = theme.colors.textSub,
  strokeWidth = 2,
}: IconProps) {
  const def = ICONS[name];
  const isStroke = def.mode === 'stroke';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G
        fill={isStroke ? 'none' : color}
        stroke={isStroke ? color : 'none'}
        strokeWidth={isStroke ? strokeWidth : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {def.nodes.map((n, i) =>
          'p' in n ? (
            <Path key={i} d={n.p} />
          ) : (
            <Circle
              key={i}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              fill={n.fill ? color : 'none'}
              stroke={n.fill ? 'none' : color}
              strokeWidth={n.fill ? 0 : strokeWidth}
            />
          )
        )}
      </G>
    </Svg>
  );
}
