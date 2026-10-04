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
  /**
   * accentSolid —— 强调色的**色块/描边/图形**用（圆点、竖轨、进度、图标底）。
   * 若要把它当**小字颜色**用，请改用 accentText（见下），否则在玻璃卡上只有 3.06~3.91 < 4.5。
   */
  accentSolid: '#7C6AE0',
  /**
   * accentText —— 用**小字**呈现的强调色（卡片日期、强调标签等）。
   * = accentSolid 压深到 78%；实测 白卡 6.27 / 玻璃卡 5.82 / 玻璃卡下层 4.55，全部达标 AA。
   */
  accentText: '#6153AF',
  accentSoft: 'rgba(124,106,224,0.12)',
  /**
   * 紫色渐变卡（血压 / 血糖）的两端 —— 由深到浅：from 左上、to 右下。
   * ★ 2026-09-20 第四版（用户定稿方向）：**紫底 + 白字**，但紫要落在 design token 的量级
   *   （原 `#5B4BC8 → #6A5AE2` 太深）。现取值 = `accentSolid #7C6AE0` 同色相下压两档
   *   （×0.80 / ×0.96），也就是 App 主紫本身，不再另造一套紫。
   *   ⚠️ 硬约束：小字用纯白要 ≥4.5，**渐变「最浅的那一端」决定生死** ——
   *   最浅可用 = `#7766D7`（纯白 4.51）；再浅一档就是 `#7C6AE0`，只有 4.20（不达标）。
   *   因此卡上文字一律用 `onGrad`（纯白），**不要用半透明白**（92% 白在浅端仅 4.02）。
   */
  gradCardFrom: '#6355B3',
  gradCardTo: '#7766D7',
  // v16 五色系统迁移：青→黄绿、杏→黄（legacy 值重映射，新代码请用 mindmate 五色相 token）
  stateCalm: '#BCCB62',
  stateEnergy: '#9D8AF0',
  stateTense: '#F0C46E',
  stateTired: '#7EA6F8',
  moodEnergy: '#F0C46E',
  moodGood: '#BCCB62',
  moodNeutral: '#9D8AF0',
  moodRest: '#F2A3C6',
  textWhite: '#FFFFFF',
  textWhite80: 'rgba(255,255,255,0.82)',
  textWhite70: 'rgba(255,255,255,0.70)',
  textTitle: '#6C5647',
  textBody: '#4A4A5C',
  /**
   * textSub —— 次级文字。★ 2026-09-20 按 WCAG 实算重新定值：
   * 原 #8A8AA8 在任何底上都不达 4.5（白卡 3.34 / 玻璃卡 2.44 / 色晕卡 2.61），却在 69 个文件用了 382 处。
   * 现值 #5F5F74 = 压深到 69%，是「最浅但仍全部达标」的解：白卡 6.20 / 玻璃卡 4.52~5.75 / 色晕卡 4.83~5.34。
   * 层次感靠字号与字重区分，不要再往回调浅。
   */
  textSub: '#5F5F74',
  /** tab 未选中标签：原 #A6A3C2 在胶囊底上仅 2.32 → 压深到 69%，实测 4.53 */
  textNavIdle: '#737086',
  textNavOn: '#6C5FB5',
  /** 指标涨跌（仅用于文字；配对 ↑/↓ 图标以保证不只靠颜色传达） */
  trendUp: '#0A6F4D',
  trendDown: '#B13232',
  textInk: '#1A1A1A',
  textInkSoft: '#4A4660',
  ringOnLight: 'rgba(157,138,240,0.55)',
  avatarBgLight: 'rgba(157,138,240,0.16)',
  avatarBorderLight: 'rgba(157,138,240,0.55)',
  orbTextInk: '#2E2A3A',
  orbTextInkSub: '#6B6480',
  /** ★ v18.118：用于「更新于 HH:MM」这类时效信息。比 orbTextInk 弱一档（信息层级：值 > 时效），
   *  但仍保持 WCAG AA：圆环中心背景是浅紫玻璃渐变（#F7F5FE~#B5A9F2），
   *  本色在**最深的 #B5A9F2 上仍有 4.70:1**（AA 阈值 4.5），全区间 4.70~10.4:1。
   *  （注：既有的 orbTextInkSub #6B6480 在深端只有 2.64:1，是历史遗留，不在本次改动范围。） */
  orbTextInkFaint: '#453F5A',
  cardBg: '#FFFFFF',
  cardBgSoft: '#F7F6FC',
  cardBgStrong: '#FFFFFF',
  cardBorder: '#E8E6F2',
  cardBorder2: 'rgba(255,255,255,0.18)',
  // v16：success/危险色只做文字与标记（好坏由数字与文案表达），青→黄绿 deep
  success: '#6E7A24',
  successSoft: 'rgba(188,203,98,0.18)',
  danger: '#C9598A', // v21：珊瑚第六色相清零 → roseDeep（疲劳三档 high 同源）
  dangerSoft: 'rgba(224,123,107,0.14)',
  warn: '#F0C46E',
  overlay: 'rgba(70,58,110,0.30)',
  celebrateGrad: ['#F3D49B', '#F6B3D0'] as const,
  aiBadgeGrad: ['#9D8AF0', '#7EA6F8'] as const,

  /**
   * 消耗卡（首页）三张小卡的**单侧色晕**色 —— 参考稿是「白底 + 右侧一团柔光」，不是整卡铺色。
   * 色相取自首页下方三张消耗卡图片（card_emotion_new.png 暖橘桃 / card_focus.jpg 柔青蓝 / card_meditation.jpg 紫蓝），
   * 亮度饱和度对齐参考稿实测档位（S45~50 / L92~94，参考稿实测绿卡 #E7F6ED、粉卡 #F7EAEA），
   * 保证卡上深色文字对比度 ≥5.7。
   */
  cardGlowEmotion: '#F5E8E0',
  cardGlowBrain: '#E0F1F5',
  cardGlowSport: '#E0E2F5',

  /**
   * ★ 首页顶部四张小卡（认知 / 情绪 / 运动 / 恢复）的底色 —— 2026-09-22 新增。
   * 取色原则：**色相与它下方对应的大卡一一对齐**，这样「小卡 → 大卡」在颜色上是一条线索，
   * 而不是四块互不相关的彩色便利贴：
   *   tileCog ← 脑力消耗大卡的紫渐变（rgba(221,214,254,·)）
   *   tileEmo ← 情绪消耗大卡的粉渐变（rgba(253,232,240,·)）
   *   tileAct ← 运动消耗大卡的蓝渐变（rgba(191,219,254,·)）
   *   tileRec ← 恢复卡的奶油米（与 colors.ui.hazeWarm 同族）
   * ⚠️ 四个色必须落在**同一亮度档**（S≈20 / L≈93），否则四张卡会显得新旧不一。
   * 对比度实测（脚本实算，全部达标）：textInk 13.6~15.2 / textSub 4.87~5.43；
   * 与纯白底的可辨度 1.145~1.279（>1.12 才看得出是「一块色」）。
   */
  tileCog: '#E4E1F8',
  tileEmo: '#F8E6EC',
  tileAct: '#DFE9F9',
  tileRec: '#F6EFE0',

  /**
   * ★ 四张指标环（2026-09-22 第三版定稿）的**底轨**色。
   * 环色本身不再另造 token，直接复用既有语义 token（由 TodayScreen 引用）：
   *   认知疲劳度 = accentSolid（token 注释定义：描边/进度图形专用）
   *   情绪负荷   = moodRest · 运动消耗 = stateTired · 恢复程度 = stateCalm
   * 底轨 = textInk(#1A1A1A) 的 10% 透明度，白底上是「淡淡一圈」。
   */
  tileRingTrack: 'rgba(26,26,26,0.10)',

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

    /**
     * ★ 全天状态面板「下缘弥散」的暖色（2026-09-21 由用户指定：改用「恢复卡片那种淡淡的黄」）。
     * 取值 = `AllDayRecoveryCard` 渐变里最暖的那一档「奶油米色」，两处引用同一个 token（唯一真相源）。
     * ⚠️ 注意它**接近白色**（与纯白对比仅 ~1.16）：叠在紫底上会形成一条暖色带，
     *    但滚到页面的白色区域时边界会变得很弱（这是「淡黄弥散」的固有代价）。
     */
    hazeWarm: '#F5EEDD',
    /**
     * ★ 面板下缘弥散**实际使用**的颜色（2026-09-21）。
     * = `hazeWarm` 加深一档（同一个暖黄压深），原因：
     *   `hazeWarm`(#F5EEDD) 与纯白对比仅 ~1.16 → 叠在白面板下缘时**边界几乎不可见**，
     *   导致「弧口方向随滚动翻转」这个效果完全看不出来（已实测对照）。
     *   加深后与白有可感知差异，弧的形状变化才能被看见，同时仍是「淡淡的黄」。
     * ⚠️ 与 `hazeWarm` 分开是有意的：`hazeWarm` 是恢复卡渐变的档位色，改它会连带动那张卡。
     */
    panelHaze: '#EDE4CB',
    /**
     * ★ 全天状态面板（顶部）与白弧的底色（2026-09-21 用户「上面卡片更通透一点」）。
     * 半透明白：页面渐变微微透出来，面板从「实心白块」变成「通透玻璃面」；
     * 白弧用同一色，保证面板与弧浑然一体（弧是画在大卡背景图之上的）。
     */
    panelGlass: 'rgba(255,255,255,0.72)',
    white55: 'rgba(255,255,255,0.55)',
    white72: 'rgba(255,255,255,0.72)',
    white92: 'rgba(255,255,255,0.92)',
    /** 主题色半透明 */
    accentSoft20: 'rgba(124,106,224,0.2)',
    /** 开关未选轨道 / 次按钮浅底 */
    offTrack: 'rgba(120,120,140,0.28)',
    /** 拟态玻璃卡：半透明白底 / 高光描边 / 柔和紫投影（首页消耗卡、概览卡同款） */
    glassBg: 'rgba(255,255,255,0.55)',
    glassBorder: 'rgba(255,255,255,0.7)',
    glassShadow: 'rgba(80,60,140,0.12)',
    /** 成功态文字色 */
    successText: '#3F9E85',
    /** 身体恢复页节律大字·正常/偏高（浅紫渐变上清晰可读）；紊乱用首页圆环粉 moodRest */
    rhythmGood: '#1E8E5A',
    rhythmWarn: '#C2571A',
    /** 节律日历「正常日」淡紫底（异常日用首页圆环粉 moodRest） */
    rhythmCalm: '#D9D2F8',
    /** 卡片 chip 文字 / 渐变副色 */
    chipText: '#55557A',
    chipGradEnd: '#6E86E8',
    /** 中性徽章底色（如「AI 分析」等次级标签 chip） */
    chipNeutralBg: 'rgba(138,138,168,0.16)',
    /** 阴影用纯黑 / 深紫 */
    shadowBlack: '#000',
    shadowDeep: '#463A6E',
    /** 列表细分隔线 */
    borderSoft: 'rgba(120,120,180,0.08)',
    /** 播放角标：深色遮罩 + 半透明白 */
    playScrim: 'rgba(0,0,0,0.42)',
    playBadge: 'rgba(255,255,255,0.10)',
    /**
     * 紫色渐变卡（血压卡 / 血糖卡）上的文字。
     * 该卡是**紫底白字**：阈值由渐变「最浅端」决定，纯白在两端 6.04 / 4.51（均 ≥4.5）。
     * ⚠️ 只能用纯白：任何半透明白都会在浅端跌破 4.5（92% 白 → 4.02）。
     * 文字层次靠**字号/字重**区分，不要靠降低不透明度。
     */
    onGrad: '#FFFFFF',
  } as const,
} as const;

export const sp = (n: number): number => n * 4;

export const space = {
  screen: sp(6),
  card: sp(4),
  cardPad: sp(5),
  /**
   * 紧凑卡内边距（半宽卡 / 并排小卡 / 体检卡这类密度更高的卡）。
   * ★ 卡片内边距只允许**两级**：外层卡 cardPad(20) 与紧凑卡 cardPadCompact(12)。
   *   不要再出现 sp(2.5)=10、sp(2)=8 这类第三、第四种密度。
   */
  cardPadCompact: sp(3),
  xs: sp(2),
  sm: sp(3),
  md: sp(4),
  lg: sp(5),
  xl: sp(6),
} as const;

/**
 * 圆角尺度（★ 2026-09-20 两轮收紧：28 → 18 → 14，用户评价「太圆」）。
 * 保持「外层卡 > 控件 > 卡内分块」的递减比例（14 : 11 : 9 ≈ 原 28 : 22 : 17 的缩放），
 * 避免出现内层比外层更圆：
 *   card 14 → 外层卡（Card / GlassCard / 自绘卡片容器）
 *   md   11 → 控件（按钮、次级卡）
 *   sm    9 → 卡内分块、小色块
 *   pill 999 → 胶囊（chip / tag / 圆形头像），不参与上面的递减关系
 */
export const radius = { phone: 55, xl: 24, card: 14, md: 11, sm: 9, pill: 999 } as const;

const BASE_WIDTH = 390;
const fontScale = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.88), 1.22);
export const fs = (size: number): number => Math.round(size * fontScale * 10) / 10;

export const fontSize = {
  h1: fs(36),
  h2: fs(22),
  /** 卡片内的「指标大数字」（如血压 118 / 76）。介于 h2 与 h1 之间，避免用裸值 32。 */
  stat: fs(32),
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

/**
 * ★ 动效 token（2026-09-20 建立）——**所有 duration / easing 一律取自这里，不要再写裸值**。
 * 依据：Material 3 motion token（easing + duration）、Apple HIG、以及 UI 动效上限 <300ms 的经验值。
 * 建立原因：此前代码里散落 **27 种不同的裸 duration**（0/5/55/100…3400）与 9 种 Easing 组合，
 * 这正是「交互不统一、不高级」的根源——每个组件各自拍一个数字。
 *
 * 时长四档（按元素大小与感知阈值，不是按手感拍）：
 *   instant  100ms  开关、状态点、按压反馈（≈「立即响应」的临界）
 *   quick    160ms  颜色/透明度、小位移、图标互换
 *   base     220ms  默认：卡片入场、列表项、普通过渡
 *   slow     320ms  需要被「看见」的过渡：大位移、局部展开
 *   sheet    440ms  整屏面板 / 大表面（large element 300~500ms 区间）
 *   sheetExit      ≈ sheet × 0.8，**离场要比进场快**（用户更不耐受「消失慢」）
 *
 * 缓动三类（按元素在该时刻的物理语义选，**不要默认用 inOut**）：
 *   easeEnter     进场减速 decelerate（m3 emphasized decelerate）→ 元素出现/进入
 *   easeExit      离场加速 accelerate（m3 emphasized accelerate）→ 元素消失/离开
 *   easeStandard  屏内标准曲线（m3 standard）→ 已在屏上的元素移动/变色
 */
export const motion = {
  instant: 100,
  quick: 160,
  base: 220,
  slow: 320,
  sheet: 440,
  sheetExit: 350,
  easeEnter: Easing.bezier(0.05, 0.7, 0.1, 1),
  easeExit: Easing.bezier(0.3, 0, 0.8, 0.15),
  easeStandard: Easing.bezier(0.2, 0, 0, 1),
  /** 呼吸/环境类循环动画的周期（毫秒），不属于 UI 过渡 */
  breath: { dot: 3000, dotActive: 2600, halo: 4600, orbRotate: 120000 },
} as const;

/**
 * ★ 按压反馈 token（2026-09-20 建立）——全 App 统一手感，替代此前 **9 种不同的 activeOpacity**。
 * 按下即缩、松手回弹（走 transform，原生驱动）。原则：反馈必须在 `motion.instant` 内完成，
 * 否则会被感知成「卡」而不是「弹」。
 */
export const press = {
  /** 小控件（图标按钮、chip） */
  scale: 0.96,
  /** 卡片等大表面：缩放要更轻，否则像「整块在动」 */
  scaleCard: 0.985,
  /** 非缩放场景（列表行、链接）统一用的不透明度 */
  opacity: 0.7,
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

/**
 * glassMorph — 「拟态玻璃」卡片外观（首页 3 张消耗卡 / 概览卡同款）。
 * 半透明白底 + 白色高光描边 + 柔和紫色投影，压在底色上呈现毛玻璃质感。
 * 组件层请通过 <GlassCard> 使用，不要直接写 rgba。
 */
export const glassMorph = {
  backgroundColor: colors.ui.glassBg,
  borderWidth: 1,
  borderColor: colors.ui.glassBorder,
  shadowColor: colors.ui.glassShadow,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 1,
  shadowRadius: 20,
  elevation: 6,
  overflow: 'hidden',
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
  press,
  layout,
  glass,
  glassMorph,
};

export type Theme = typeof theme;
export default theme;
