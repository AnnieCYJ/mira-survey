/**
 * sleepWindow.ts —— 睡眠窗口（全仓唯一实现，**分钟精度**）
 *
 * 为什么必须共享一份实现：
 *  - `lib/stressAlgorithm.ts`：只把**清醒时段**的 EDA 波动算作「压力/情绪事件」；
 *  - `components/EmotionInsightView.tsx`：给睡眠时段的小时列加浅底提示。
 * 两边口径一旦各写一份就会漂移（本项目已踩过：图表裁轴丢事件 → 图上点数与「N 次事件」不一致）。
 *
 * 为什么必须保留分钟（不能像旧实现那样 `Math.floor` 到整点）：
 *  实测 00:41 入睡 / 09:41 起床，而压力事件发生在 **00:12**——按整点取整会把 00:12 误判成睡眠时段。
 */
import { healthStore, dayKey } from '../data/healthStore';

export interface SleepWindow {
  /** 入睡时刻（小数小时，0–24） */
  bedHour: number;
  /** 起床时刻（小数小时，0–24） */
  wakeHour: number;
}

/** "HH:mm" → 小数小时；非法返回 null。 */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  return Number.isFinite(h) && h >= 0 && h <= 24 ? h : null;
}

/**
 * 取「某天」的睡眠窗口（无睡眠数据 → null，调用方需按「不判断睡眠」处理）。
 * @param nowMs 该日内的任一时刻（函数内部按本地日取 `healthStore.getSleep`）
 */
export function sleepWindowForDay(nowMs: number): SleepWindow | null {
  try {
    const sl = healthStore.getSleep(dayKey(nowMs));
    if (!sl || sl.total <= 0) return null;
    const bed = parseHHMM(sl.sleepTime as string | null | undefined);
    const wake = parseHHMM(sl.wakeTime as string | null | undefined);
    if (bed != null && wake != null) return { bedHour: bed, wakeHour: wake };
    // 只有一侧时刻 → 用总时长推另一侧
    if (bed != null) return { bedHour: bed, wakeHour: (bed + sl.total / 60) % 24 };
    if (wake != null) return { bedHour: (wake - sl.total / 60 + 24) % 24, wakeHour: wake };
    return null;
  } catch {
    return null;
  }
}

/**
 * 某个（小数）小时是否落在睡眠窗口内。
 * 两种形态都覆盖：跨零点入睡（23:30 睡 → 07:00 起）、当天内入睡（00:41 睡 → 09:41 起）。
 */
export function isAsleepHour(h: number, w: SleepWindow | null | undefined): boolean {
  if (!w) return false;
  const { bedHour, wakeHour } = w;
  if (bedHour > wakeHour) return h >= bedHour || h < wakeHour;
  return h >= bedHour && h < wakeHour;
}

/** 某时刻是否在睡眠窗口内。 */
export function isAsleepAtMs(t: number, w: SleepWindow | null | undefined): boolean {
  if (!w) return false;
  const d = new Date(t);
  return isAsleepHour(d.getHours() + d.getMinutes() / 60, w);
}
