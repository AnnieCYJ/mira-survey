/**
 * MindMate 线性图标组件（16 枚，v10 Reskin）
 * 来源：mira-design/mira-handoff/icons.tsx（与概念稿 sprite 同形）
 * 依赖：react-native-svg（Expo 已内置）
 * 用法：import { MindIcon } from './MindIcons';
 *       <MindIcon name="heart" size={14} color={mm.colors.pinkDeep} />
 */
import React from 'react';
import Svg, { Path, Circle, G } from 'react-native-svg';

export type MindIconName =
  | 'flower' | 'bell' | 'nodes' | 'heart' | 'bolt' | 'leaf' | 'moon'
  | 'breath' | 'sun' | 'drop' | 'wind' | 'book' | 'list' | 'flame'
  | 'plus' | 'check';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const makeIcon =
  (children: React.ReactNode, defaultWidth = 1.8) =>
  ({ size = 16, color = '#1F1D1A', strokeWidth = defaultWidth }: IconProps) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </G>
    </Svg>
  );

/** 四瓣花（头像） */
export const IconFlower = makeIcon(
  <>
    <Circle cx="12" cy="6.3" r="3" />
    <Circle cx="17.7" cy="12" r="3" />
    <Circle cx="12" cy="17.7" r="3" />
    <Circle cx="6.3" cy="12" r="3" />
    <Circle cx="12" cy="12" r="1.4" fill="color" stroke="none" />
  </>
);

/** 铃铛（通知） */
export const IconBell = makeIcon(
  <>
    <Path d="M18 16H6c1.2-1.4 1.8-2.6 1.8-5a4.2 4.2 0 0 1 8.4 0c0 2.4.6 3.6 1.8 5z" />
    <Path d="M10.5 19a1.6 1.6 0 0 0 3 0" />
  </>
);

/** 节点（认知） */
export const IconNodes = makeIcon(
  <>
    <Circle cx="6" cy="5.5" r="2.3" />
    <Circle cx="18" cy="8" r="2.3" />
    <Circle cx="10" cy="18.5" r="2.3" />
    <Path d="M8.1 6.4l7.6 1M7 7.7l2.3 8.6M16.9 9.9l-5.2 6.7" />
  </>
);

/** 心（情绪） */
export const IconHeart = makeIcon(
  <Path d="M12 19s-6.5-4.1-8-8a4.4 4.4 0 0 1 8-2.6A4.4 4.4 0 0 1 20 11c-1.5 3.9-8 8-8 8z" />
);

/** 闪电（运动） */
export const IconBolt = makeIcon(
  <Path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z" />
);

/** 叶（恢复/生理） */
export const IconLeaf = makeIcon(
  <>
    <Path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" />
    <Path d="M8 16c2-4 5-7 8-8" />
  </>
);

/** 月亮（睡眠） */
export const IconMoon = makeIcon(
  <Path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" />
);

/** 呼吸波纹（冥想/呼吸练习） */
export const IconBreath = makeIcon(
  <Path d="M4 9h9a2.5 2.5 0 1 0-2.4-3.2M4 13h13a2.5 2.5 0 1 1-2.4 3.2M4 17h7" />
);

/** 落日（户外/散步） */
export const IconSun = makeIcon(
  <>
    <Circle cx="12" cy="12" r="3.6" />
    <Path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
  </>
);

/** 水滴（推荐任务） */
export const IconDrop = makeIcon(
  <Path d="M12 3.5c3 3.8 5.2 6.3 5.2 9a5.2 5.2 0 0 1-10.4 0c0-2.7 2.2-5.2 5.2-9z" />
);

/** 书本（知识学习） */
export const IconBook = makeIcon(
  <>
    <Path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <Path d="M20 19H6.5" />
  </>
);

/** 清单（计划任务） */
export const IconList = makeIcon(
  <>
    <Path d="M9 6h11M9 12h11M9 18h11" />
    <Path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </>
);

/** 火焰（连续记录 streak） */
export const IconFlame = makeIcon(
  <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
);

/** 加号圆（记录 CTA） */
export const IconPlusCircle = makeIcon(
  <>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 8v8M8 12h8" />
  </>,
  2
);

/** 对勾（已完成） */
export const IconCheck = makeIcon(
  <Path d="M5 12.5l4.5 4.5L19 7" />,
  2.2
);

/** 统一导出表 */
export const MindIcons: Record<MindIconName, React.ComponentType<IconProps>> = {
  flower: IconFlower, bell: IconBell, nodes: IconNodes, heart: IconHeart,
  bolt: IconBolt, leaf: IconLeaf, moon: IconMoon, breath: IconBreath,
  sun: IconSun, drop: IconDrop, wind: IconBreath, // wind 与 breath 同形，可复用
  book: IconBook, list: IconList, flame: IconFlame, plus: IconPlusCircle, check: IconCheck,
};

export function MindIcon(props: IconProps & { name: MindIconName }) {
  const { name, ...rest } = props;
  const Cmp = MindIcons[name];
  return <Cmp {...rest} />;
}
