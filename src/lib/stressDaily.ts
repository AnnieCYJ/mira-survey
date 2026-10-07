/**
 * stressDaily.ts —— 心理压力「日均值」唯一提供者
 *
 * ★ 为什么要有这个文件：
 *   首页大数字读的是 `computeEmotionalStress().stressScale.value`（0–100 百分位，
 *   50 = 和你平时一样）。详情页如果自己拿别的接口算（比如负重 emotions / stressReport.score），
 *   同一天就会出现两个数字 —— 这是之前反复踩过的坑。
 *   所以日/周/月/年的 Hero 大数、周月年折线图**只走这里**。
 *
 * ★ 日均值的语义：`stressScale.value` 本身就是「全天参与判定的所有槽的百分位均值」
 *   （见 emotionalStress.ts 的 meanSeverity），所以它天然就是**日均**，
 *   不需要我们再对当天做二次平均。
 *
 * ★ 性能：`computeEmotionalStress` 要重建 14 天基线，一年视图会调用 365 次。
 *   故按 dayKey 缓存，并用 `healthStore.subscribe` 在数据变更时整体失效，
 *   避免「记了一笔新自报，图上还是旧值」。
 */
import { computeEmotionalStress } from './emotionalStress';
import type { SportSessionLike } from './motionGate';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { reportNowMsForDay } from './dayAnchor';
import { buildNaturalPeriods } from './periods';
import type { RangeKey } from '../data/metrics';

/** dayKey → 当天心理压力百分位（null = 那天没有可判定数据） */
const cache = new Map<string, number | null>();

let subscribed = false;
function ensureInvalidation() {
  if (subscribed) return;
  subscribed = true;
  try {
    healthStore.subscribe(() => cache.clear());
  } catch {
    // 订阅失败就退化为「每次重算」，不影响正确性
  }
}

/** 手动让缓存失效（外部写入自报情绪后可调用） */
export function clearStressDailyCache() {
  cache.clear();
}

/**
 * 某一天的心理压力百分位 0–100（与首页「心理压力」卡片同一个读数）。
 * @param dk  日键 YYYY-MM-DD
 * @param sportSessions 当天固件运动记录（用于运动门控；历史日没有，传 null 即可）
 */
export function dailyStressValue(
  dk: string,
  sportSessions?: SportSessionLike[] | null,
): number | null {
  ensureInvalidation();
  // ★ 今天不缓存：戒指数据每分钟都在涨，缓存会让今天的读数停在打开页面那一刻。
  //   历史日数据不会再变，才是缓存的目标。
  const todayK = dayKey(Date.now());
  // ★ 2026-10-07（用户实锤）：**未来日直接判「无数据」**。
  //   此前对未来 dk 也照算，而 `reportNowMsForDay(未来日)` 会把时间钳到「此刻」，
  //   于是周三的图上「四/五/六/日」每天都返回今天的数据、年视图未来月份也冒出数据 —— 全是假的。
  if (dk > todayK) return null;
  const isToday = dk === todayK;
  if (!isToday && cache.has(dk)) return cache.get(dk)!;
  let v: number | null = null;
  try {
    const dayMs = parseDayKey(dk);
    if (dayMs) {
      const rep = computeEmotionalStress(reportNowMsForDay(dayMs), sportSessions ?? null);
      v = rep?.stressScale?.value ?? null;
      if (v != null && !Number.isFinite(v)) v = null;
    }
  } catch {
    v = null;
  }
  if (!isToday) cache.set(dk, v);
  return v;
}

/**
 * 一组天的压力均值 —— 先把每天的日均值算出来再平均，
 * ⚠ 不是「把整天数据混在一起算一次」：后者会让数据多的天白白占更大权重。
 */
export function meanStressOfDays(
  dayKeys: string[],
  sportSessions?: SportSessionLike[] | null,
): number | null {
  const vals = dayKeys
    .map((dk) => dailyStressValue(dk, sportSessions))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export interface StressPeriodPoint {
  label: string;
  /** 该周期的压力均值 0–100；无数据 → null */
  value: number | null;
  /** 参与统计的有效天数 */
  nDays: number;
}

/**
 * 周/月/年 折线图数据 —— 每个周期一个点，点的高度 = 该周期的压力均值。
 *   周 → 7 个日点；月 → 该月每天一个点；年 → 12 个月点。
 */
export function buildStressRangeSeries(
  range: RangeKey,
  anchorMs: number,
  sportSessions?: SportSessionLike[] | null,
): StressPeriodPoint[] {
  if (range === 'day') return [];
  // ★ 2026-10-07（用户实锤）：**横轴保持完整自然周期**（周=一~日 / 月=1~月末 / 年=1~12月），
  //   但周期内**未来的天不参与均值**（dailyStressValue 对未来日已返回 null，这里再过滤一次以免空算）。
  //   注意：**不能把整个未来周期从横轴上删掉** —— 否则周三打开周视图只剩「一/二/三」，
  //   横坐标就不再是「自然的周」了（用户反馈「这个横坐标不对」）。
  const todayK = dayKey(Date.now());
  const periods = buildNaturalPeriods(range, anchorMs)
    .map((p) => ({ ...p, dayKeys: p.dayKeys.filter((dk) => dk <= todayK) }));
  return periods.map((p) => ({
    label: p.label,
    value: meanStressOfDays(p.dayKeys, sportSessions),
    nDays: p.dayKeys.filter((dk) => dailyStressValue(dk, sportSessions) != null).length,
  }));
}

/**
 * 区间的总体均值（Hero 大数字）—— 日=日均，周=周平均，月=月平均，年=年平均。
 * ⚠ 周/月/年 是「先算每个周期均值、再对周期取平均」，
 *   年视图因此是「12 个月的月均再平均」，与「365 天直接平均」会有微小差异，这是刻意的：
 *   早期的月份缺数据时不应把年度均值拉空。
 */
export function rangeStressMean(
  range: RangeKey,
  anchorMs: number,
  anchorDayKey: string,
  sportSessions?: SportSessionLike[] | null,
): number | null {
  if (range === 'day') return dailyStressValue(anchorDayKey, sportSessions);
  const series = buildStressRangeSeries(range, anchorMs, sportSessions);
  const vals = series.map((p) => p.value).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
