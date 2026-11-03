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
  // ★★★ mira-ocean 分支（2026-10-17）：白底设计存档于 mira-ios（tag v-mira-ios-white）。
  //   本分支页面底色为 Calm 式深海渐变。真相源在 src/theme/ocean.ts。
  //   ★ 2026-11-04（用户选定方案 B「整片沉海」）：三段全部取自首页照片海面与夜空
  //     #1F4C7E（顶）→ #113861 → #0A294F（底）——与 ocean.ts 同值内联，旧调用点零改动。
  bgTop: '#1F4C7E',
  bgTopAlt: '#1D4876',
  bgMid: '#113861',
  bgMidAlt: '#113861',
  bgBottom: '#0A294F',
  bgGradStops: ['#1F4C7E', '#113861', '#0A294F'] as const,
  bgGradLocs: [0, 0.46, 1] as const,
  accent1: '#9D8AF0',
  accent2: '#7EA6F8',
  /**
   * accentSolid —— 强调色的**色块/描边/图形**用（圆点、竖轨、进度、图标底）。
   * 若要把它当**小字颜色**用，请改用 accentText（见下），否则在玻璃卡上只有 3.06~3.91 < 4.5。
   */
  accentSolid: '#7C6AE0',
  /**
   * accentText —— 用**小字**呈现的强调色（卡片日期、强调标签等）。
   * ★ mira-ocean（2026-10-17）：深底上紫 78% 不可读 → 改长春花蓝 #BFCBFF（Oura 式点缀色，
   *   深蓝紫底上对比 ≈7.4，达标 AA）。
   */
  accentText: '#BFCBFF',
  accentSoft: 'rgba(160,178,255,0.16)',
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
  // ★ mira-ocean（2026-10-17）：文字层级整体改白阶（深蓝紫底）。原白底深色字存档于 mira-ios。
  textTitle: '#FFFFFF',
  textBody: 'rgba(255,255,255,0.82)',
  /**
   * textSub —— 次级文字。★ mira-ocean：白 62% → 提至 74%（2026-10-28）：
   *   半透明白卡（cardBg 0.13）叠在深蓝紫底上，62% 白字实测发糊；
   *   提至 74% 仍明显低于 textBody(0.82)/ink(1.0)，层级不变，但全 App 次级文字可读性显著改善。
   */
  textSub: 'rgba(255,255,255,0.74)',
  /** tab 未选中标签：白 55%；选中改长春花蓝 */
  textNavIdle: 'rgba(255,255,255,0.55)',
  textNavOn: '#BFCBFF',
  /** 指标涨跌（仅用于文字；配对 ↑/↓ 图标以保证不只靠颜色传达）——深底改亮档 */
  trendUp: '#BCCB62',
  trendDown: '#F2A3C6',
  textInk: '#FFFFFF',
  textInkSoft: 'rgba(255,255,255,0.78)',
  ringOnLight: 'rgba(191,203,255,0.55)',
  // ★ mira-ocean：头像浅色底/描边改白阶玻璃
  avatarBgLight: 'rgba(255,255,255,0.14)',
  avatarBorderLight: 'rgba(255,255,255,0.22)',
  orbTextInk: '#FFFFFF',
  orbTextInkSub: 'rgba(255,255,255,0.72)',
  /** ★ v18.118：用于「更新于 HH:MM」这类时效信息。比 orbTextInk 弱一档（信息层级：值 > 时效），
   *  但仍保持 WCAG AA：圆环中心背景是浅紫玻璃渐变（#F7F5FE~#B5A9F2），
   *  本色在**最深的 #B5A9F2 上仍有 4.70:1**（AA 阈值 4.5），全区间 4.70~10.4:1。
   *  （注：既有的 orbTextInkSub #6B6480 在深端只有 2.64:1，是历史遗留，不在本次改动范围。） */
  orbTextInkFaint: 'rgba(255,255,255,0.55)',
  // ★ mira-ocean（2026-10-17）：卡面 token 全部改玻璃（白 13% 底 + 白 22~28% 细边），
  //   与 CalmWaveHome chips 同款；原白卡 #FFFFFF + #E8E6F2 存档于 mira-ios。
  cardBg: 'rgba(255,255,255,0.13)',
  cardBgSoft: 'rgba(255,255,255,0.08)',
  cardBgStrong: 'rgba(255,255,255,0.16)',
  cardBorder: 'rgba(255,255,255,0.22)',
  cardBorder2: 'rgba(255,255,255,0.28)',
  // v16：success/危险色只做文字与标记（好坏由数字与文案表达）
  // ★ mira-ocean：success 改亮档（深底上作文字/色块可读）；需要「白字按钮底」的场合
  //   （如 EcgCard 处理中态）请用 mm.colors.limeDeep，见该组件内联注释。
  success: '#9BD37E',
  successSoft: 'rgba(155,211,126,0.18)',
  danger: '#F2A3C6', // v21：珊瑚第六色相清零 → roseDeep（疲劳三档 high 同源）
  dangerSoft: 'rgba(242,163,198,0.18)',
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
  cardGlowEmotion: 'rgba(242,163,198,0.20)',
  cardGlowBrain: 'rgba(157,138,240,0.22)',
  cardGlowSport: 'rgba(126,166,248,0.22)',

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
  tileCog: 'rgba(157,138,240,0.22)',
  tileEmo: 'rgba(242,163,198,0.20)',
  tileAct: 'rgba(126,166,248,0.22)',
  tileRec: 'rgba(213,227,132,0.18)',

  /**
   * ★ 四张指标环（2026-09-22 第三版定稿）的**底轨**色。
   * 环色本身不再另造 token，直接复用既有语义 token（由 TodayScreen 引用）：
   *   认知疲劳度 = accentSolid（token 注释定义：描边/进度图形专用）
   *   情绪负荷   = moodRest · 运动消耗 = stateTired · 恢复程度 = stateCalm
   * 底轨 = textInk(#1A1A1A) 的 10% 透明度，白底上是「淡淡一圈」。
   */
  tileRingTrack: 'rgba(255,255,255,0.14)',

  /**
   * ui — 语义化界面令牌（从各组件收敛的高频裸值，值与原组件一致，UI 零变化）。
   * 新增界面元素请优先复用以下 token，避免再次散落裸值。
   */
  ui: {
    /** 悬浮 tab 胶囊背景（★ mira-ocean：Calm 式半透玻璃） */
    tabBar: 'rgba(255,255,255,0.22)',
    /** 视频/弹层黑色遮罩（深/中/浅） */
    scrim: 'rgba(0,0,0,0.45)',
    scrimMid: 'rgba(0,0,0,0.35)',
    scrimSoft: 'rgba(0,0,0,0.30)',
    scrimDark: 'rgba(0,0,0,0.42)',
    /** 白色半透明（进度/卡片/描边等） */
    white25: 'rgba(255,255,255,0.25)',

    /**
     * ★ mira-ocean（2026-10-17）：全天状态面板「下缘弥散」的暖色在深底上改为
     *   长春花蓝晕（与点缀色同源）；原奶油米 #F5EEDD 存档于 mira-ios。
     */
    hazeWarm: 'rgba(160,178,255,0.14)',
    panelHaze: 'rgba(160,178,255,0.18)',
    /**
     * ★ mira-ocean：全天状态面板由「半透明白 72%」改深海玻璃（白 10%），
     *   白弧同步改白阶，保证面板与弧在深底上浑然一体。
     */
    panelGlass: 'rgba(255,255,255,0.10)',
    white55: 'rgba(255,255,255,0.55)',
    white72: 'rgba(255,255,255,0.72)',
    white92: 'rgba(255,255,255,0.92)',
    /** 主题色半透明 */
    accentSoft20: 'rgba(160,178,255,0.20)',
    /** 开关未选轨道 / 次按钮浅底（深底改白阶） */
    offTrack: 'rgba(255,255,255,0.14)',
    /** 拟态玻璃卡：深海玻璃（白 13% 底 + 白 28% 高光描边 + 黑投影） */
    glassBg: 'rgba(255,255,255,0.13)',
    glassBorder: 'rgba(255,255,255,0.28)',
    glassShadow: 'rgba(0,0,0,0.28)',
    /** 成功态文字色（深底亮档） */
    successText: '#9BD37E',
    /** 身体恢复页节律大字·正常/偏高（深底亮档）；紊乱用首页圆环粉 moodRest */
    rhythmGood: '#8FD6A4',
    rhythmWarn: '#F5B97E',
    /** 节律日历「正常日」淡紫底（深底改紫玻璃） */
    rhythmCalm: 'rgba(157,138,240,0.22)',
    /** 卡片 chip 文字 / 渐变副色 */
    chipText: 'rgba(255,255,255,0.72)',
    chipGradEnd: '#8FA6F0',
    /** 中性徽章底色（如「AI 分析」等次级标签 chip） */
    chipNeutralBg: 'rgba(255,255,255,0.14)',
    /** 阴影用纯黑 / 深紫 */
    shadowBlack: '#000',
    shadowDeep: '#463A6E',
    /** 列表细分隔线（深底改白阶） */
    borderSoft: 'rgba(255,255,255,0.10)',
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
 * 圆角尺度（★ 2026-11-03 统一为单一标准）。
 * 详情页全部卡片（外层卡 / 卡内子卡 / 图表卡）统一圆角 = 24（与共享 <Card> 组件 mm.radius.card 同口径）。
 * 控件与卡内分块保持递减，避免内层比外层更圆：
 *   card 24 → 外层卡 + 卡内子卡（Card / GlassCard / 自绘卡片容器 / 图表卡 / 峰值低谷小卡 / 图例块）
 *   md   11 → 控件（按钮、次级卡、ECG 按钮）
 *   sm    9 → 卡内分块、小色块、行高亮
 *   pill 999 → 胶囊（chip / tag / 日期选择器圆角 / 圆形头像），不参与上面的递减关系
 * 说明：theme.radius.card 与 mm.radius.card 现已对齐为 24（此前 14，2026-11-03 统一）。
 */
export const radius = { phone: 55, xl: 24, card: 24, /** ★ 2026-11-03：lg=14 收口散落的 13–16 内卡圆角 */ lg: 14, md: 11, sm: 9, pill: 999 } as const;

const BASE_WIDTH = 390;
const fontScale = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.88), 1.22);
export const fs = (size: number): number => Math.round(size * fontScale * 10) / 10;

export const fontSize = {
  h1: fs(36),
  h2: fs(22),
  /** 卡片内的「指标大数字」（如血压 118 / 76）。介于 h2 与 body 之间，避免用裸值 32。 */
  stat: fs(32),
  card: fs(18),
  /** ★ 2026-11-03：lg=fs(20) 收口散落的 19–21 小标题 */
  lg: fs(20),
  body: fs(15),
  sm: fs(13.5),
  xs: fs(13),
  micro: fs(11),
  /** ★ 2026-11-03：tiny=fs(10) 收口 8–10.5 的脚注/角标，不再逐处写裸值 */
  tiny: fs(10),
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
  tabBarHeight: 48,
  tabCenterSize: 48,
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
