/**
 * Mira App · 五色系统 Tokens（v16，来源：mira-design/mira-handoff/Mira-App-Design-Handoff-v16.md + tokens.ts）
 *
 * v16 铁律：
 *  - 五色相四维一轴：紫=认知 / 粉=情绪 / 蓝=运动·心肺(血压·心电) / 黄=元气·能量·代谢；
 *    黄绿=主轴（今日状态·恢复·睡眠·完成度·交互选中，全稿唯一的绿）。
 *  - 青 Teal #6FCFB4 全系删除（恢复/睡眠/平静并入黄绿）；lavender/mint/陶土/杏作废（见各 key 注释）。
 *  - 数据卡一律白底，颜色只上图形；卡语义靠卡内图形 + soft/deep 角标表达。
 *  - 单屏彩色相 ≤4；饱和色面积 ≤2%；黄绿做控件，黄只做代谢数据，不得互换。
 *
 * 兼容策略：v10 时代的 key 名保留（避免全库改调用点），值按 v16 legacyMap 重映射；
 * 新代码请用五色相 5 档 key（purple/rose/sky/lime/honey × tint/soft/mid/core/deep）。
 */
export const mm = {
  colors: {
    /* ── 五色相 · 每相 5 档（v16 锁定）── */
    // 紫 Iris = 认知
    purpleTint: '#F4EDFC', purpleSoft: '#E7E1FB', purpleMid: '#C7B9F2', purpleCore: '#9D8AF0', purpleDeep: '#6E58C8',
    /**
     * purpleBtn —— 紫**按钮/气泡底**（上面压白字或白图标）专用档。
     * 白字 ≥4.5 的最浅紫上限 = #7766D7（4.51，与 theme.gradCardTo 同源）；
     * purpleCore(#9D8AF0) 白字仅 2.9、purpleDeep(#6E58C8) 偏深，按钮一律取本档。
     */
    purpleBtn: '#7766D7',
    // 粉 Rose = 情绪
    roseTint: '#FDF0F6', roseSoft: '#FCE7F0', roseMid: '#F6B3D0', roseCore: '#F2A3C6', roseDeep: '#C9598A',
    // 蓝 Sky = 运动 / 心肺（含血压·心电）
    skyTint: '#F0F4FE', skySoft: '#E3EBFE', skyMid: '#B9CCF9', skyCore: '#7EA6F8', skyDeep: '#4C74C9',
    // 黄绿 Lime = 今日状态 / 恢复 / 睡眠 / 完成度 / 交互选中（唯一控件色、唯一「绿」）
    limeTint: '#F6F7DC', limeSoft: '#EAF0BE', limeMid: '#BCCB62', limeCore: '#D5E384', limeDeep: '#6E7A24',
    // 黄 Honey = 元气 / 能量 / 代谢（点阵元气格 · 血糖 · 清醒段 · 黄体期段）
    honeyTint: '#FDF7E9', honeySoft: '#FBEFD6', honeyMid: '#F3D49B', honeyCore: '#F0C46E', honeyDeep: '#B98A2E',

    /* ── 文字（中性）── */
    ink: '#1F1D1A',
    inkSoft: '#5C574F',
    inkFaint: '#9C968C',
    emptyFill: '#F6F4F1',
    sleepDot: '#EAE7E2', // 点阵「睡眠」格

    /* ── v10 legacy 别名（值已按 v16 legacyMap 迁移，勿再新增使用）── */
    lime: '#D5E384',           // → limeCore
    lavender: '#E7E1FB',       // 旧 #F0D9F8 → purpleSoft
    lavenderSoft: '#F4EDFC',   // 旧 #F7EBFC → purpleTint
    lavenderDeep: '#6E58C8',   // 旧 #8A5CA8 → purpleDeep
    cyan: '#D5E384',           // 旧青系 → limeCore（青已删除；「运动」请改用 skyCore）
    cyanSoft: '#EAF0BE',       // 旧 #E2F1F4 → limeSoft
    cyanDeep: '#6E7A24',       // 旧 #41788C → limeDeep
    pink: '#FCE7F0',           // 旧 #F8CADA → roseSoft
    pinkSoft: '#FDF0F6',       // 旧 #FCEBF2 → roseTint
    pinkDeep: '#C9598A',       // 旧 #C2597F → roseDeep
    butter: '#FBEFD6',         // → honeySoft
    butterDeep: '#B98A2E',     // → honeyDeep
    ghostCard: '#F6F4F1',      // 旧 #F4F1FA → neutral.empty

    /* ── 圆环家族（数据图形色；v16 档位对齐）── */
    ringYellow: '#F0C46E',     // honeyCore
    ringTeal: '#BCCB62',       // 旧青 core → limeMid（legacyMap: core→mid）
    ringPurple: '#9D8AF0',     // purpleCore
    ringPink: '#F2A3C6',       // roseCore
    ringBlue: '#7EA6F8',       // skyCore
    ringPurpleDeep: '#6E58C8', // 旧 #7261D6 → purpleDeep
    ringPinkDeep: '#C9598A',   // 旧 #D8739F → roseDeep
    ringBlueDeep: '#4C74C9',   // 旧 #5581E0 → skyDeep
    ringTealDeep: '#6E7A24',   // 旧 #3A9B80 → limeDeep
    ringYellowDeep: '#B98A2E', // 旧 #C0903A → honeyDeep

    /* ── 情绪点阵 6 色（15min/点；v16：平静=黄绿mid、元气=黄core）── */
    moodCalm: '#BCCB62',   // 平静（v16 由青并入黄绿 mid）
    moodEnergy: '#F0C46E', // 元气（黄 core，与平静拉开色相）
    moodFocus: '#9D8AF0',  // 专注（紫 core）
    moodStress: '#F2A3C6', // 紧张（粉 core）
    moodTired: '#7EA6F8',  // 疲惫（蓝 core）
    moodSleep: '#EAE7E2',  // 睡眠（中性）
    moodNone: '#BDB7AE',   // 无数据（中灰，Bento 情绪卡点阵：睡眠段/未到时段/无曲线覆盖）

    /* ── 白卡与描边 ── */
    cardBg: '#FFFFFF',
    // 干预系列页暖白底（设计稿 out-iv2/0-plans.png 口径；区别于 App 根紫渐变）
    pageWarm: '#F7F5F0',
    // 0.05 在纯白上几乎不可见（用户实测反馈「看不到边框」）→ 提到 0.09
    cardBorder: 'rgba(31,29,26,0.09)',
    chipBorder: 'rgba(31,29,26,0.10)',
    tabBorder: 'rgba(31,29,26,0.14)',

    /* ── CTA 渐变按钮（SPEC §4.1 #12：mid 档软渐变 黄绿→米→粉）── */
    btnGradFrom: '#D5E384',
    btnGradTo: '#F6B3D0',      // roseMid（v16 渐变端点限 mid 档）
    btnTextOnGrad: '#5F6B1F',  // 黄绿底上的深绿字
    btnBusyBg: 'rgba(31,29,26,0.06)',

    /* ── 身体年龄 hero（v16 §4.2 #1：浅黄绿底 + 黄绿阶弧）── */
    heroGradFrom: '#F8FAE8',
    heroGradTo: '#FDFEF7',
    heroBorder: 'rgba(146,168,52,0.18)',
    heroTrack: '#E7EBD4',
    heroPillGreen: '#EAF0BE',  // 黄绿胶囊底（年轻/衰老统一黄绿）

    /* ── 底栏 ── */
    tabBg: 'rgba(255,255,255,0.96)',
    fabFrom: '#A98FE8',        // 紫渐变 FAB（SPEC §4.1 #13 保留紫色系）
    fabTo: '#9D8AF0',          // 旧 #C3B2D4 → purpleCore（legacyMap）
  },

  radius: {
    card: 24,     // 标准白卡
    chip: 16,     // 四指标 chip
    iconSq: 9,    // 26px 图标方块
    iconSqMd: 10, // 30px 卡角标方块
  },

  /** pastel 图标方块 bg/fg 对（v16：soft 底 + deep icon；§4.5） */
  chipBg: {
    lav: { bg: '#E7E1FB', fg: '#6E58C8' },    // 紫（认知）
    pink: { bg: '#FCE7F0', fg: '#C9598A' },   // 粉（情绪）
    cyan: { bg: '#E3EBFE', fg: '#4C74C9' },   // 蓝（运动·心肺；旧青语义由蓝接管）
    lime: { bg: '#EAF0BE', fg: '#6E7A24' },   // 黄绿（恢复/选中）
    butter: { bg: '#FBEFD6', fg: '#B98A2E' }, // 黄（代谢）
  } as const,

  /** 白卡阴影：CSS `0 14px 34px -18px rgba(31,29,26,.14)` 的 RN 拆解 */
  shadow: {
    color: '#1F1D1A',
    opacity: 0.14,
    height: 7,
    radius: 17,
    elevation: 2,
  },

  /** 底栏 AI FAB 紫色光晕：CSS `0 16px 30px -12px rgba(157,138,240,.6)` 的 RN 拆解 */
  fabShadow: {
    color: '#9D8AF0',
    opacity: 0.6,
    height: 16,
    radius: 15,
    elevation: 6,
  },
} as const;

export type MindChipTone = keyof typeof mm.chipBg;

/**
 * 指标卡图标方块取色：按 key 稳定哈希从五色相取一组
 * （soft = 图标方块底，fg = deep 图标色）。
 * ★ v16：数据卡一律白底——本函数只用于卡内 26px 图标方块，不再做卡底色。
 */
export function pastelFamilyFor(key: string): { soft: string; chipBg: string; fg: string } {
  const FAMILIES = [
    { soft: mm.colors.purpleSoft, chipBg: mm.chipBg.lav.bg, fg: mm.chipBg.lav.fg },
    { soft: mm.colors.skySoft, chipBg: mm.chipBg.cyan.bg, fg: mm.chipBg.cyan.fg },
    { soft: mm.colors.roseSoft, chipBg: mm.chipBg.pink.bg, fg: mm.chipBg.pink.fg },
    { soft: mm.colors.limeSoft, chipBg: mm.chipBg.lime.bg, fg: mm.chipBg.lime.fg },
    { soft: mm.colors.honeySoft, chipBg: mm.chipBg.butter.bg, fg: mm.chipBg.butter.fg },
  ];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FAMILIES[h % FAMILIES.length];
}
