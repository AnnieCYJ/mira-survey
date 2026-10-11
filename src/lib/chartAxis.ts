/**
 * chartAxis —— 全 App 图表「横轴刻度」统一规范（2026-10-09 起）
 *
 * ★ 单一事实来源：本模块与 `data/metrics.ts` 的 `RANGE_DEF` 同源。
 *   （RANGE_DEF 也改由本模块派生，避免两处各写一套又跑偏。）
 *
 * 规范（日 / 周 / 月 / 年）：
 *   - 日：每 4 小时 → 0 / 4 / 8 / 12 / 16 / 20 / 24
 *   - 周：一周 7 天全标 → 一 … 日（周一为每周起点）
 *   - 月：固定标注 1 / 5 / 10 / 15 / 20 / 25 / 30（部分月只出现已发生的那些天）
 *   - 年：固定标注 1月 / 3月 / 5月 / 7月 / 9月 / 11月
 *
 * 任何新图表请走 `timeTickLabel()`，不要再各写一套横轴。
 */

export type TimeRange = 'day' | 'week' | 'month' | 'year';

/** 周视图短标签：index 取 Date.getDay()（0=周日 … 6=周六） */
export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 周视图按「周一 → 周日」自然顺序排列的标签 */
export const WEEK_ORDER = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 日视图小时刻度（详情/整行宽图，每 4 小时） */
export const DAY_HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24] as const;

/** 日视图小时刻度（首页紧凑小卡，每 6 小时，避免窄卡标签拥挤） */
export const DAY_HOUR_TICKS_COMPACT = [0, 6, 12, 18, 24] as const;

/**
 * ★ 2026-10-10（用户：心率详情页对齐 Oura 全天柱状小条）：**日视图次刻度线的间隔（分钟）**。
 *
 * Oura 的 24h 心率图结构是「每 30 分钟一条刻度线（division），格内含 6 根 5 分钟的小柱」。
 * 注意区分两层：
 *   - **标签层**（有文字）：每 4 小时 → DAY_HOUR_TICKS
 *   - **刻度线层**（无文字的竖线）：每 30 分钟 → 本常量
 * 本常量只管刻度线，不改 timeTickLabel 的标签口径。
 */
export const DAY_MINOR_TICK_MINUTES = 30 as const;

/**
 * 日视图次刻度线的钟点列表（0.5 / 1 / 1.5 … 23.5）。
 * 供「全天柱状小条」画每 30 分钟一条细竖线用；末端 24:00 只画线不画标签。
 */
export function dayMinorTickHours(minutes: number = DAY_MINOR_TICK_MINUTES): number[] {
  const stepH = minutes / 60;
  const out: number[] = [];
  for (let h = 0; h < 24; h += stepH) out.push(Math.round(h * 1000) / 1000);
  out.push(24);
  return out;
}

/** 月视图固定刻度日号 */
export const MONTH_TICK_DAYS = [1, 5, 10, 15, 20, 25, 30] as const;

/** 年视图固定刻度月份（1-based） */
export const YEAR_TICK_MONTHS = [1, 3, 5, 7, 9, 11] as const;

/** 年视图刻度：0-based 月份 → 「1月」 */
export function yearTickLabel(monthIndex0: number): string {
  return `${monthIndex0 + 1}月`;
}

export function isMonthTickDay(dayOfMonth: number): boolean {
  return (MONTH_TICK_DAYS as readonly number[]).includes(dayOfMonth);
}

export function isYearTickMonth(monthIndex0: number): boolean {
  return (YEAR_TICK_MONTHS as readonly number[]).includes(monthIndex0 + 1);
}

/**
 * 统一入口：给定时长区间的某一刻度，返回应显示的标签（'' = 不显示）。
 * - range='month' 传入该点日号 dayOfMonth
 * - range='week'  传入 weekday（0=周日…6=周六）
 * - range='year'  传入 monthIndex（0-based）
 */
export function timeTickLabel(opts: {
  range: TimeRange;
  /** 月视图：该点的日号 */
  dayOfMonth?: number;
  /** 周视图：0=周日 … 6=周六 */
  weekday?: number;
  /** 年视图：0-based 月份 */
  monthIndex?: number;
}): string {
  const { range, dayOfMonth = 0, weekday = 0, monthIndex = 0 } = opts;
  if (range === 'week') return WEEKDAY_SHORT[weekday] ?? '';
  if (range === 'month') return isMonthTickDay(dayOfMonth) ? String(dayOfMonth) : '';
  if (range === 'year') return isYearTickMonth(monthIndex) ? yearTickLabel(monthIndex) : '';
  return '';
}

/* ───────────────────────── 日期轴（周/月 等按真实日期的窗口）─────────────────────────
 * ★ 2026-10-07 用户口径（体温卡 vs 激素卡对不上）：日期轴不要写死的「几号」，
 *   要按**真实日期**出标签——起点 / 中点 / 今天，与体温卡、雌孕激素卡完全一致。
 *   全 App 凡「按日期铺点的窗口」（周 / 月 / 近 N 天）都走这里，保证横轴口径统一。
 */

/**
 * 日期轴稀疏刻度：起点 / 中点 / 终点（点数 ≤3 时全标）。
 * 与 HormoneDualTrend / SleepHormoneCorrelation / TempBiphasicChart 的三点式一致。
 */
export function dateTickIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count <= 3) return Array.from({ length: count }, (_, i) => i);
  return [0, Math.floor((count - 1) / 2), count - 1];
}

/** 真实日期短标签：M/D（如 10/7） */
export function fmtMonthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
