import { theme } from './theme';
import { mm } from './mindmate';

/**
 * Chart Design Token —— 2026-10-09 起，所有图表组件共用同一套视觉变量，
 * 取代此前散落在各组件里的硬编码色 / 线宽 / 圆点 / 虚线。
 *
 * 语义色槽（取代各组件散落的 accentSolid / purpleCore / purpleDeep /
 *   limeMid / limeDeep / ink / ringTeal / danger / #E2554E 等）：
 *   primary   = 紫（恢复分 / 心理压力 / 孕激素）
 *   secondary = 亮绿 limeMid（睡眠时长 / 雌激素）
 *   cortisol  = 亮绿 limeMid（★ 2026-10-09 用户：皮质醇趋势不要墨色，改用亮绿）
 * 异常统一红 #E2554E。
 *
 * 线宽 / 圆点 / 网格 / 虚线全部收敛为单值，日周月年切换时视觉语言不变。
 */
export const chart = {
  series: {
    primary: theme.colors.accentSolid,
    secondary: mm.colors.limeMid,
    cortisol: mm.colors.limeMid,
  },
  anomaly: '#E2554E',
  /** 坐标轴文字：白底需深色。左轴「睡眠时长」用深绿（区别于亮绿柱 #BCCB62，保证可读）；右轴「恢复分」用紫。 */
  axis: {
    left: '#5C7A1E',
    right: theme.colors.accentSolid,
  },
  grid: theme.colors.ui.borderSoft,
  axisText: theme.colors.textSub,
  refFaint: 'rgba(31,29,26,0.32)',
  lw: { series: 2.4, ref: 1.3, grid: 1 },
  dot: { radius: 3, anomaly: 6, stroke: 2 },
  barRadius: 3,
  dash: { grid: '3 4', ref: '5 4' },
  motion: { fade: 160 },
  /**
   * ★ 2026-10-10（docs/chart-size-unified-spec.html 规则 1）：**图表高度只分 4 档**。
   *   高度只由「信息层级」决定，不由它在哪个页面决定——同一层级必须等高。
   *   xs 64 = 迷你（洞察页双列小卡 / 今日状态条）
   *   s  96 = 卡内嵌趋势（昼夜节律 / 睡眠节律 / 皮质醇节律）
   *   m 180 = 详情单指标（血压 / 血氧 / 激素 / 体温双相 / 情绪区间条）
   *   l 240 = 详情主趋势与双轴·柱线组合图（指标详情 / 状态趋势 / 能量·情绪主图 / 睡眠双轴）
   */
  h: { xs: 64, s: 96, m: 180, l: 240 },
  /** ★ 规则 2：装饰高度（轴标题带 + X 轴标签带 + 图例带）从总高剥离，每档固定预算 */
  chrome: { card: 24, detail: 50 },
  /** ★ 规则 1 附表：各档「绘图区净高」（总高 − 装饰带） */
  plot: { xs: 44, s: 70, m: 140, l: 190 },
} as const;
