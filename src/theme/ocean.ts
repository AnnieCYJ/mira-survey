/**
 * Mira App · Ocean 主题 Tokens（mira-ocean 分支专用 · 2026-10-17）
 * ---------------------------------------------------------------------------
 * 定位：Calm 式「深海」皮肤的唯一真相源。白底设计已存档于 mira-ios 分支
 *       （tag v-mira-ios-white），本分支所有页面统一走深蓝紫底 + 玻璃卡 + 白线图标。
 *
 * 与 CalmWaveHome（今日 tab）的关系：本文件的渐变/玻璃/文字/点缀色全部从
 *   CalmWaveHome.tsx 与 home-calm-wave.html 的实跑值抽取，保证「首页 ↔ 其它页」同源。
 *
 * 使用方式（两层）：
 *   1) 新页面：直接 import { ocean } from '../theme/ocean' 取色；
 *   2) 旧页面：theme.ts / mindmate.ts 的表面与文字 token 已在本分支重映射到
 *      本文件的对应值（cardBg→glassBg、ink→text 等），旧调用点零改动即换肤。
 *      ★ 重映射只发生在 mira-ocean 分支；mira-ios 分支保留白底原值。
 *
 * 层级（深 → 浅）：
 *   pageTop   #1F4C7E  沉海蓝（页顶，取自首页照片海面亮段）
 *   pageMid   #113861  中海蓝
 *   pageDeep  #0A294F  海面最深处（页底，与首页照片收底色同源）
 *
 * ★ 2026-11-04（用户选定方案 B「整片沉海」）：三段全部取自首页照片海面与夜空
 *   （#1F4C7E → #113861 → #0A294F），比旧版（#3E627A→#2A4470→#2B3564，尾段紫味重）
 *   暗一档、饱和一档——洞察/工具等页与首页照片从此同一片海。
 */
export const ocean = {
  /** 页面纵向渐变（无视频页面用）：沉海蓝 → 中海蓝 → 海面最深处 */
  grad: {
    colors: ['#1F4C7E', '#113861', '#0A294F'] as const,
    locations: [0, 0.46, 1] as const,
  },

  pageTop: '#1F4C7E',
  pageMid: '#113861',
  pageDeep: '#0A294F',

  /** 玻璃卡（chips / 通用卡）：白 13% + 白 28% 细边，与 CalmWaveHome 完全一致 */
  glassBg: 'rgba(255,255,255,0.13)',
  glassBorder: 'rgba(255,255,255,0.28)',
  /** 深板岩玻璃（AI 分析卡这类「内容主卡」用，压深一档托住文字） */
  glassDeepBg: 'rgba(9,28,48,0.52)',
  glassDeepBorder: 'rgba(255,255,255,0.17)',

  /** 文字层级（全部白阶；命名对齐 CalmWaveHome 实跑值） */
  text: '#FFFFFF',
  text92: 'rgba(255,255,255,0.92)',
  text82: 'rgba(255,255,255,0.82)',
  text72: 'rgba(255,255,255,0.72)',
  text65: 'rgba(255,255,255,0.65)',
  text55: 'rgba(255,255,255,0.55)',
  text47: 'rgba(255,255,255,0.47)',

  /** 点缀色（长春花蓝，Oura 式）：高亮数值 / 选中态 / 头像圈 */
  accent: '#BFCBFF',
  accentSoft: 'rgba(160,178,255,0.16)',
  /** 建议胶囊（浅蓝底 + 深字） */
  pillBg: 'rgba(160,178,255,0.95)',
  pillText: '#101C33',

  /** 「状态好」高亮（沿用 v16 黄绿主轴，深底上更亮一档） */
  good: '#D5E384',
  goodSoft: 'rgba(213,227,132,0.18)',

  /** 头栏玻璃圆钮（账户 / 设置） */
  headBtnBg: 'rgba(255,255,255,0.18)',
  headBtnBorder: 'rgba(255,255,255,0.30)',

  /** 白线图标（Oura 式细线 SVG） */
  iconStroke: '#FFFFFF',

  /** 图表在深底上的网格 / 参考线 */
  chartGrid: 'rgba(255,255,255,0.10)',
  chartRef: 'rgba(255,255,255,0.28)',

  /** 深底上的阴影（黑而非墨，避免「越遮越脏」） */
  shadow: { color: '#000000', opacity: 0.28, radius: 18, offset: { width: 0, height: 8 }, elevation: 6 },

  /** Tab 栏玻璃（Calm 式半透胶囊） */
  tabBg: 'rgba(255,255,255,0.22)',
  tabBorder: 'rgba(255,255,255,0.38)',
} as const;

export type Ocean = typeof ocean;
