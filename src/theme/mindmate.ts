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
    // 红 ECG = 专业心电波形（线必为红，生理监测惯例；与 anomaly #E2554E 异常语义解耦，勿混用）
    ecgRed: '#E5484D', ecgRedSoft: 'rgba(229,72,77,0.14)',

    /* ── 文字（中性）── ★ mira-ocean（2026-10-17）：白阶；原深色墨系存档 mira-ios */
    ink: '#FFFFFF',
    inkSoft: 'rgba(255,255,255,0.88)', // ★ 2026-10-28：0.78 → 0.88，半透明白卡上更清楚
    inkFaint: 'rgba(255,255,255,0.74)', // ★ 2026-10-28：0.62 → 0.74（AA 仍达标，但发糊问题改善）
    emptyFill: 'rgba(255,255,255,0.08)',
    sleepDot: 'rgba(255,255,255,0.22)', // 点阵「睡眠」格

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
    moodSleep: 'rgba(255,255,255,0.35)', // 睡眠（深底白阶）
    moodNone: 'rgba(255,255,255,0.25)',  // 无数据（深底白阶）

    /* ── 白卡与描边 ── ★ mira-ocean：改玻璃（与 CalmWaveHome chips 同款） */
    cardBg: 'rgba(255,255,255,0.13)',
    // 干预系列页暖白底 → mira-ocean 深海页底
    pageWarm: '#0A294F',
    cardBorder: 'rgba(255,255,255,0.22)',
    chipBorder: 'rgba(255,255,255,0.28)',
    tabBorder: 'rgba(255,255,255,0.22)',

    /* ── CTA 按钮：★ 2026-11-03（用户）绿粉渐变与深海色系不搭 → 改白色玻璃（与 glassBg 同族，
       上亮下沉的微渐变模拟玻璃受光）；字全白。 */
    btnGradFrom: 'rgba(255,255,255,0.32)',
    btnGradTo: 'rgba(255,255,255,0.14)',
    btnTextOnGrad: '#FFFFFF',
    btnBusyBg: 'rgba(255,255,255,0.10)',

    /* ── 身体年龄 hero ── ★ mira-ocean：浅黄绿底改深海玻璃（深板岩 → 中蓝），弧线语义色不变 */
    heroGradFrom: 'rgba(9,28,48,0.52)',
    heroGradTo: 'rgba(38,62,96,0.40)',
    heroBorder: 'rgba(255,255,255,0.22)',
    heroTrack: 'rgba(255,255,255,0.16)',
    heroPillGreen: 'rgba(191,203,255,0.20)',  // 胶囊底改长春花蓝玻璃

    /* ── 底栏 ── ★ mira-ocean：tabBg 改 Calm 式半透玻璃（与 CustomTabBar 内联值一致） */
    tabBg: 'rgba(255,255,255,0.22)',
    // ★ 2026-10-15（用户定稿 V1 去紫）：右下 Mira 脸由紫渐变改墨色（#3A3644→#2E2A3A）
    fabFrom: '#3A3644',
    fabTo: '#2E2A3A',
  },

  radius: {
    card: 24,     // 标准白卡
    chip: 16,     // 四指标 chip
    iconSq: 9,    // 26px 图标方块
    iconSqMd: 10, // 30px 卡角标方块
  },

  /** pastel 图标方块 bg/fg 对 ★ mira-ocean：soft 底改色相玻璃、deep icon 改亮档（深底可读） */
  chipBg: {
    lav: { bg: 'rgba(157,138,240,0.22)', fg: '#D9CFF9' },    // 紫（认知）
    pink: { bg: 'rgba(242,163,198,0.20)', fg: '#F9D3E4' },   // 粉（情绪）
    cyan: { bg: 'rgba(126,166,248,0.22)', fg: '#CFDEFB' },   // 蓝（运动·心肺；旧青语义由蓝接管）
    lime: { bg: 'rgba(213,227,132,0.20)', fg: '#E9F3C0' },   // 黄绿（恢复/选中）
    butter: { bg: 'rgba(240,196,110,0.20)', fg: '#F8E3B8' }, // 黄（代谢）
  } as const,

  /** 白卡阴影 → mira-ocean 深海玻璃卡：黑投影（深底上出层次，不再用墨色） */
  shadow: {
    color: '#000000',
    opacity: 0.28,
    height: 8,
    radius: 18,
    elevation: 6,
  },

  /** 底栏 AI FAB 光晕 → mira-ocean：黑投影压深 */
  fabShadow: {
    color: '#000000',
    opacity: 0.4,
    height: 16,
    radius: 15,
    elevation: 6,
  },
} as const;

export type MindChipTone = keyof typeof mm.chipBg;

/**
 * ★ 2026-11-06 UI 一致性审查（C-08）：运动项目色板 + 心率区间色板。
 *
 * 背景：运动项目色是**数据分类色**，不是状态色，因此与五色相体系刻意解耦
 * （不能把跑步色改成「情绪粉」）。但此前 `lib/sportVisual.ts` 里 30+ 个运动项
 * 与 4 个心率区间全是裸 hex，绕开了 token 体系 —— 一旦要调色只能逐处改。
 *
 * 策略：**色值本身全部保留**（视觉零差异），只从裸 hex 提升为命名 token。
 * 这样既消除了漂移面，又不会让已经验证过的运动色板发生意外变化。
 */
export const sportPalette = {
  /* ── 跑步 / 心肺 ── */
  run: '#FF3B30',
  treadmill: '#FF3B30',
  walk: '#4CA9FF',
  stairs: '#34C759',
  cycle: '#007AFF',
  spin: '#007AFF',
  rope: '#FF2D55',
  hiit: '#D93025',
  aerobics: '#FF6600',
  boxing: '#C0392B',
  zumba: '#FF448A',
  dance: '#FF6FA5',
  elliptical: '#5AC8FA',
  rowing: '#2E86AB',
  climbing: '#8E5CF0',

  /* ── 力量 ── */
  strength: '#FF9500',
  core: '#F5A623',
  situp: '#F5A623',

  /* ── 身心 ── */
  yoga: '#7B61FF',
  pilates: '#8E7BFF',
  stretch: '#8E8E9C',
  taiji: '#4B4B55',

  /* ── 球类 / 水上 ── */
  swim: '#30B0C7',
  pingpong: '#E7B13A',
  badminton: '#4CAF50',
  basketball: '#F57C00',

  /** 未知运动类型兜底（中性） */
  other: '#9A93A8',
} as const;

/**
 * 心率区间色板（4 段）。
 * ⚠️ onColor 不是装饰 —— 每个区间底色都核过对比度：
 *   浅色区间（#E0A33C）用深墨 #1F1608，饱和区间用白字。
 *   改任一 color 时必须同步复核 onColor，否则字会看不见。
 */
export const hrZonePalette = {
  warmup: { color: '#2F7BE8', onColor: '#FFFFFF' },     // 热身 0–99
  aerobic: { color: '#22C55E', onColor: '#0F1A0C' },    // 有氧 100–124
  anaerobic: { color: '#E0A33C', onColor: '#1F1608' },  // 无氧 125–149
  extreme: { color: '#E5484D', onColor: '#FFFFFF' },   // 极限 150+
} as const;

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
