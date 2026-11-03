/**
 * periodLabels —— 日/周/月/年「上一周期」对比标签的**唯一真相源**
 * ---------------------------------------------------------------------------
 * ★ 2026-11-03（用户：「对周月年有日周月年有叫昨日、叫上周、叫上个月、叫去年等，
 *   如果有这些数字都要把这个加上，就所有页面都应该是统一的」）：
 *   此前各详情页各写各的标签，口径打架：
 *     MetricDetailScreen  → '较上周' / '较上月' / '较上年'（且上月/上年 与 别页不一致）
 *     EnergyDetailScreen  → '上周' / '上月' / '去年同期'
 *     SleepDetailScreen   → '本周/上周'、'本月/上月'、'本年/去年'
 *     StatusTrendDetail   → '昨日' / '上周' / '上月' / '去年'（+ 7天基线/30天基线/全年基线）
 *   现在统一为一套：**当前周期 + 上一周期** 两个词，随 range 切换。
 *
 * 词表（用户定稿口径）：
 *   日 → 今日  / 昨日
 *   周 → 本周  / 上周
 *   月 → 本月  / 上个月
 *   年 → 本年  / 去年
 *
 * 铁律：
 *   - 「上个月」不写「上月」；「去年」不写「去年同期」。全 App 只有这一份。
 *   - 需要「较 X」句式时用 compareLabel()（自动带「较」），不要手写「较上月」。
 *   - 需要「对比上一周期」块标题时用 compareTitle()（统一「对比上周 / 对比上个月 / 对比去年」）。
 */
import type { RangeKey } from '../data/metrics';

/** 当前周期名：今日 / 本周 / 本月 / 本年 */
export const currentPeriodLabel = (range: RangeKey): string =>
  range === 'day' ? '今日' : range === 'week' ? '本周' : range === 'month' ? '本月' : '本年';

/** 上一周期名：昨日 / 上周 / 上个月 / 去年 */
export const previousPeriodLabel = (range: RangeKey): string =>
  range === 'day' ? '昨日' : range === 'week' ? '上周' : range === 'month' ? '上个月' : '去年';

/** 「较 X」句式（用于 delta 徽章）：较昨日 / 较上周 / 较上个月 / 较去年 */
export const compareLabel = (range: RangeKey): string => `较${previousPeriodLabel(range)}`;

/** 对比块标题：对比昨日 / 对比上周 / 对比上个月 / 对比去年 */
export const compareTitle = (range: RangeKey): string => `对比${previousPeriodLabel(range)}`;

/**
 * 基线窗口名（仅 StatusTrendDetail 用）：
 *   日 → 7天基线、周 → 30天基线、月 → 30天基线、年 → 全年基线
 * 与上一周期（等长前一窗口）是**两个不同口径**，不能混用，故单列。
 */
export const baselineLabel = (range: RangeKey): string =>
  range === 'day' ? '7天基线' : range === 'week' ? '30天基线' : range === 'month' ? '30天基线' : '全年基线';
