/**
 * MindMate v10 Reskin 设计 tokens（来源：mira-design/mira-handoff/tokens.ts + DESIGN-SPEC.md v10）
 * 仅 UI 呈现层使用。铁律延续：组件层禁止裸 hex，一律从本文件取 token。
 * 圆环四色（ring*）只做图表数据色，禁止大面积底色（SPEC §0）。
 */
export const mm = {
  colors: {
    /* ── MindMate pastel 主色 ── */
    lime: '#D5E384',
    limeSoft: '#EAF0BE',
    limeDeep: '#5A6B1F',
    lavender: '#F0D9F8',
    lavenderSoft: '#F7EBFC',
    lavenderDeep: '#8A5CA8',
    cyan: '#B0D8E0',
    cyanSoft: '#E2F1F4',
    cyanDeep: '#41788C',
    pink: '#F8CADA',
    pinkSoft: '#FCEBF2',
    pinkDeep: '#C2597F',

    /* ── 文字 ── */
    ink: '#1F1D1A',
    inkSoft: '#5C574F',
    inkFaint: '#9C968C',

    /* ── 圆环四色（图表数据色专用）── */
    ringYellow: '#F0C46E',
    ringTeal: '#6FCFB4',
    ringPurple: '#9D8AF0',
    ringPink: '#F2A3C6',
    ringBlue: '#7EA6F8',
    ringPurpleDeep: '#7261D6',
    ringPinkDeep: '#D8739F',
    ringBlueDeep: '#5581E0',
    ringTealDeep: '#3A9B80',
    ringYellowDeep: '#C0903A',

    /* ── 情绪点阵 6 色（15min/点；图例不展示，颜色仅编码）── */
    moodCalm: '#6FCFB4',   // 平静
    moodEnergy: '#F0C46E', // 元气
    moodFocus: '#9D8AF0',  // 专注
    moodStress: '#F2A3C6', // 紧张
    moodTired: '#7EA6F8',  // 疲惫
    moodSleep: '#E7E1F6',  // 睡眠

    /* ── 白卡与描边 ── */
    cardBg: '#FFFFFF',
    ghostCard: '#F4F1FA',
    // 0.05 在纯白上几乎不可见（用户实测反馈「看不到边框」）→ 提到 0.09
    cardBorder: 'rgba(31,29,26,0.09)',
    chipBorder: 'rgba(31,29,26,0.10)',
    tabBorder: 'rgba(31,29,26,0.14)',
    // 参考稿「Save Mood」渐变按钮：lime → 粉（135°）
    btnGradFrom: '#D5E384',
    btnGradTo: '#F2B8D0',
    // 弧形/环形图的多色家族（参考稿 Emotional Check-in 甜甜圈）
    arcLime: '#B9D06B',
    arcLavender: '#A98FE8',
    arcPink: '#F2A3C6',

    /* ── 身体年龄 hero 卡（SPEC §2 #1：淡紫渐变卡 + 速度表半圆）── */
    heroGradFrom: '#EFE6FB',
    heroGradTo: '#F7F2FD',
    heroTrack: 'rgba(255,255,255,0.72)', // 弧轨道：白 72%（在淡紫底上可见）
    heroPillGreen: '#D9F2E5',            // 「年轻 x 岁」绿胶囊底

    /* ── 底栏（SPEC §2 #13）── */
    tabBg: 'rgba(255,255,255,0.96)',
    fabFrom: '#A98FE8',
    fabTo: '#C3B2D4',
  },

  radius: {
    card: 24,     // 标准白卡
    chip: 16,     // 四指标 chip
    iconSq: 9,    // 26px 图标方块
    iconSqMd: 10, // 30px 卡角标方块
  },

  /** pastel 图标方块 bg/fg 对（SPEC §5 速查） */
  chipBg: {
    lav: { bg: '#F0D9F8', fg: '#8A5CA8' },
    pink: { bg: '#F8CADA', fg: '#C2597F' },
    cyan: { bg: '#B0D8E0', fg: '#41788C' },
    lime: { bg: '#D5E384', fg: '#5A6B1F' },
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
