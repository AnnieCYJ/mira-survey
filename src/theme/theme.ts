/**
 * Mira Design System v1.0 — 唯一设计真相源（Single Source of Truth）
 * ---------------------------------------------------------------------------
 * 移植 / 克隆须知（务必随代码一起复制本文件）：
 *  1. 组件层禁止写裸色值、裸尺寸、裸字体——全部从这里取 token，保证换肤/移植时 UI 一致。
 *  2. 本项目【不使用任何自定义字体】，统一走 RN 默认系统字体
 *     （iOS = SF Pro / 中文 = PingFang，Android = Roboto / 中文 = Noto），
 *     因此不依赖任何 .ttf/.otf 资源，克隆后不会出现字体 fallback 走样。
 *  3. sp(n) = n*4 pt；fs(n) 按屏宽做 0.88~1.22 倍缩放（基准 390pt），纯函数、确定性，
 *     移植到任意设备表现由设备宽度决定，无需额外配置。
 *  4. 本文件仅依赖 react-native 的 Dimensions / Easing，无第三方依赖、无外部资源引用。
 *  5. 改设计时只动本文件；组件里若仍有个别局部视觉常量（如阴影 offset、半透明遮罩），
 *     请以本文件 `colors.ui` / `shadow` 中的同名 token 为准。
 * ---------------------------------------------------------------------------
 */
import { Dimensions, Easing } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const colors = {
  bgTop: '#B5A9F2',
  bgTopAlt: '#B0A6F0',
  bgMid: '#DED9FB',
  bgMidAlt: '#ECEAFB',
  bgBottom: '#F7F5FE',
  bgGradStops: ['#B5A9F2', '#CFC8F7', '#E6E3FB', '#F7F5FE'] as const,
  bgGradLocs: [0, 0.34, 0.64, 1] as const,
  accent1: '#9D8AF0',
  accent2: '#7EA6F8',
  accentSolid: '#7C6AE0',
  accentSoft: 'rgba(124,106,224,0.12)',
  stateCalm: '#6FCFB4',
  stateEnergy: '#9D8AF0',
  stateTense: '#E8A87C',
  stateTired: '#7EA6F8',
  moodEnergy: '#F0C46E',
  moodGood: '#6FCFB4',
  moodNeutral: '#9D8AF0',
  moodRest: '#F2A3C6',
  textWhite: '#FFFFFF',
  textWhite80: 'rgba(255,255,255,0.82)',
  textWhite70: 'rgba(255,255,255,0.70)',
  textTitle: '#6C5647',
  textBody: '#4A4A5C',
  textSub: '#8A8AA8',
  textNavIdle: '#A6A3C2',
  textNavOn: '#6C5FB5',
  textInk: '#1A1A1A',
  textInkSoft: '#4A4660',
  ringOnLight: 'rgba(157,138,240,0.55)',
  avatarBgLight: 'rgba(157,138,240,0.16)',
  avatarBorderLight: 'rgba(157,138,240,0.55)',
  orbTextInk: '#2E2A3A',
  orbTextInkSub: '#6B6480',
  cardBg: 'rgba(255,255,255,0.72)',
  cardBgSoft: 'rgba(247,246,252,0.78)',
  cardBgStrong: 'rgba(255,255,255,0.95)',
  cardBorder: 'rgba(255,255,255,0.55)',
  cardBorder2: 'rgba(255,255,255,0.18)',
  success: '#6FCFB4',
  successSoft: 'rgba(111,207,180,0.16)',
  danger: '#E07B6B',
  dangerSoft: 'rgba(224,123,107,0.14)',
  warn: '#F0C46E',
  overlay: 'rgba(70,58,110,0.30)',
  celebrateGrad: ['#F5D189', '#E8A87C'] as const,
  aiBadgeGrad: ['#9D8AF0', '#7EA6F8'] as const,

  /**
   * ui — 语义化界面令牌（从各组件收敛的高频裸值，值与原组件一致，UI 零变化）。
   * 新增界面元素请优先复用以下 token，避免再次散落裸值。
   */
  ui: {
    /** 悬浮 tab 胶囊背景 */
    tabBar: 'rgba(250,250,254,0.96)',
    /** 视频/弹层黑色遮罩（深/中/浅） */
    scrim: 'rgba(0,0,0,0.45)',
    scrimMid: 'rgba(0,0,0,0.35)',
    scrimSoft: 'rgba(0,0,0,0.30)',
    scrimDark: 'rgba(0,0,0,0.42)',
    /** 白色半透明（进度/卡片/描边等） */
    white25: 'rgba(255,255,255,0.25)',
    white55: 'rgba(255,255,255,0.55)',
    white72: 'rgba(255,255,255,0.72)',
    white92: 'rgba(255,255,255,0.92)',
    /** 主题色半透明 */
    accentSoft20: 'rgba(124,106,224,0.2)',
    /** 开关未选轨道 / 次按钮浅底 */
    offTrack: 'rgba(120,120,140,0.28)',
    /** 成功态文字色 */
    successText: '#3F9E85',
    /** 卡片 chip 文字 / 渐变副色 */
    chipText: '#55557A',
    chipGradEnd: '#6E86E8',
    /** 阴影用纯黑 / 深紫 */
    shadowBlack: '#000',
    shadowDeep: '#463A6E',
    /** 列表细分隔线 */
    borderSoft: 'rgba(120,120,180,0.08)',
    /** 播放角标：深色遮罩 + 半透明白 */
    playScrim: 'rgba(0,0,0,0.42)',
    playBadge: 'rgba(255,255,255,0.10)',
  } as const,
} as const;

export const sp = (n: number): number => n * 4;

export const space = {
  screen: sp(6),
  card: sp(4),
  cardPad: sp(5),
  xs: sp(2),
  sm: sp(3),
  md: sp(4),
  lg: sp(5),
  xl: sp(6),
} as const;

export const radius = { phone: 55, card: 28, md: 22, sm: 17, pill: 999 } as const;

const BASE_WIDTH = 390;
const fontScale = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.88), 1.22);
export const fs = (size: number): number => Math.round(size * fontScale * 10) / 10;

export const fontSize = {
  h1: fs(36),
  h2: fs(22),
  card: fs(18),
  body: fs(15),
  sm: fs(13.5),
  xs: fs(13),
  micro: fs(11),
  hero: fs(46),
  orb: fs(24),
} as const;

export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const shadow = {
  card: {
    shadowColor: '#7878B4',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
  hover: {
    shadowColor: '#7878B4',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.16,
    shadowRadius: 44,
    elevation: 8,
  },
  nav: {
    shadowColor: '#8278B4',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 10,
  },
  center: {
    shadowColor: '#7C6AE0',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.38,
    shadowRadius: 32,
    elevation: 12,
  },
  deckTop: {
    shadowColor: '#463A6E',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.17,
    shadowRadius: 44,
    elevation: 10,
  },
  deckBack: {
    shadowColor: '#463A6E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 6,
  },
  sheet: {
    shadowColor: '#463A6E',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.26,
    shadowRadius: 60,
    elevation: 16,
  },
} as const;

export const motion = {
  dur: 220,
  durS: 160,
  durL: 440,
  ease: Easing.bezier(0.22, 1, 0.36, 1),
  breath: { dot: 3000, dotActive: 2600, halo: 4600, orbRotate: 120000 },
} as const;

export const layout = {
  maxWidth: 500,
  tabBarHeight: 56,
  tabCenterSize: 56,
  moodWheelRatio: 0.72,
  /** 悬浮胶囊距屏幕底部的留白 */
  floatMargin: 0,
  /** 中间凸起按钮超出胶囊的高度 */
  raised: sp(4),
  pageBottomPad: (insetsBottom: number) =>
    layout.tabBarHeight + insetsBottom + layout.floatMargin + layout.raised + 20,
} as const;

export const glass = {
  backgroundColor: colors.cardBg,
  borderColor: colors.cardBorder,
  borderWidth: 1,
} as const;

export const theme = {
  colors,
  space,
  sp,
  radius,
  fontSize,
  fs,
  weight,
  shadow,
  motion,
  layout,
  glass,
};

export type Theme = typeof theme;
export default theme;
