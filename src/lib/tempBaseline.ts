/**
 * tempBaseline —— 体温「偏离个人基线」基线计算（2026-10-10 建立）
 *
 * ★ 为什么不用绝对体温：Oura 官方明确 **不报绝对皮肤温度**，只报 `temperature_deviation`
 *   ——「和你的个人基线差多少度」。原因写在 Oura 文档里：白天体温被吃喝、运动、环境干扰，
 *   只有睡眠时的体温才有意义；而且**对女性周期定位真正有用的是曲线形状**（黄体期整体上移），
 *   不是「36.5℃」这个数字。
 *
 * ★ 数据层是绝对 ℃（见 `RingBleManager.handleTempSamples`：全链路零减法，原样入库），
 *   所以「偏离」必须在**消费侧**算，本模块负责这件事，不改数据层。
 *
 * ★ 口径：
 *   - 基线按 **30 分钟槽**分别统计（一天48 槽），这样基线本身也是一条**昼夜节律**，
 *     能把「这个钟点本来就比那个钟点高0.2 度」这种个体节律消掉。
 *   - 每个槽用**中位数**（不是均值）：体温偶发单点跳变多，中位数比均值更抗污染。
 *   - 样本天数不足的槽 → `null`（图上留白，不拿均值糊过去）。
 */

import { healthStore, parseDayKey, dayKey } from '../data/healthStore';
import { binByMinutes, dayStartOf } from './timeBuckets';

/** 正常带半宽（℃）：偏离基线在此范围内视为日常波动 */
export const TEMP_BAND_C = 0.3;
/** 基线回看天数 */
export const TEMP_BASELINE_DAYS = 14;
/** 基线槽宽（分钟） */
export const TEMP_SLOT_MIN = 30;
/** 一天的槽数 */
export const TEMP_SLOTS = 48;

export interface TempBaseline {
  /** 实际参与统计的天数 */
  days: number;
  /** 每天需要的槽覆盖数（低于此值判为基线未建立） */
  neededDays: number;
  /** 每 30 分钟槽的个人基线（绝对 ℃），无覆盖的槽 = null */
  slots: (number | null)[];
  /** 正常带半宽（℃） */
  band: number;
  /** 基线是否可用（false 时 UI 应写「建立基线中」而不是画正常带） */
  ready: boolean;
}

function median(xs: number[]): number {
  const a = xs.slice().sort((p, q) => p - q);
  const n = a.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * 构建个人体温基线。
 * @param endDayKey 截止日（默认今天）。基线**不含**当天，避免今天的数据把自己的基线拉高。
 */
export function buildTempBaseline(opts?: { days?: number; endDayKey?: string }): TempBaseline {
  const daysWanted = opts?.days ?? TEMP_BASELINE_DAYS;
  const all = healthStore.allDayKeys();
  const endKey = opts?.endDayKey ?? dayKey(Date.now());
  const endIdx = all.indexOf(endKey);

  // 取截止日之前的 N 天（不含截止日当天）
  const picked = (endIdx >= 0 ? all.slice(0, endIdx) : all).slice(-daysWanted);

  const perSlot: number[][] = Array.from({ length: TEMP_SLOTS }, () => []);
  let counted = 0;
  for (const dk of picked) {
    const base = parseDayKey(dk);
    if (!Number.isFinite(base)) continue;
    const buckets = binByMinutes(healthStore.getIntraday('temp', dk), TEMP_SLOT_MIN, {
      dayStartMs: dayStartOf(base),
      slotCount: TEMP_SLOTS,
    });
    let has = false;
    buckets.forEach((b, i) => {
      if (b.v == null) return;
      perSlot[i].push(b.v);
      has = true;
    });
    if (has) counted += 1;
  }

  const slots = perSlot.map((arr) => (arr.length >= 3 ? Number(median(arr).toFixed(2)) : null));
  const filled = slots.filter((s) => s != null).length;

  return {
    days: counted,
    neededDays: Math.max(3, Math.min(7, daysWanted)),
    slots,
    band: TEMP_BAND_C,
    ready: filled >= TEMP_SLOTS * 0.6 && counted >= 3,
  };
}

/** 单日某槽的偏离值（℃）：今日值 − 该槽基线；缺任一方返回 null */
export function tempSlotDeviation(
  todayBuckets: { v: number | null }[],
  baseline: TempBaseline,
  slot: number,
): number | null {
  const t = todayBuckets[slot]?.v;
  const b = baseline.slots[slot];
  if (t == null || b == null) return null;
  return Number((t - b).toFixed(2));
}

/**
 * 单日偏离序列（48 槽，℃）。用于画昼夜节律偏离曲线。
 * @param dayKeyRaw 目标日
 * @param baseline 已buildTempBaseline() 的结果（建议以该日**之前**为截止日构建）
 */
export function tempDeviationSeries(
  dayKeyRaw: string,
  baseline: TempBaseline,
): { dev: (number | null)[]; abs: (number | null)[] } {
  const base = parseDayKey(dayKeyRaw);
  const start = Number.isFinite(base) ? dayStartOf(base) : dayStartOf(Date.now());
  const buckets = binByMinutes(healthStore.getIntraday('temp', dayKeyRaw), TEMP_SLOT_MIN, {
    dayStartMs: start,
    slotCount: TEMP_SLOTS,
  });
  const abs = buckets.map((b) => b.v);
  const dev = buckets.map((b, i) => {
    const bl = baseline.slots[i];
    if (b.v == null || bl == null) return null;
    return Number((b.v - bl).toFixed(2));
  });
  return { dev, abs };
}

/** 一日偏离的汇总：均值 / 最大正偏移 / 最大负偏移（均按有效槽） */
export function tempDeviationSummary(dev: (number | null)[]): {
  avg: number | null;
  maxUp: number | null;
  maxDown: number | null;
} {
  let sum = 0;
  let n = 0;
  let maxUp: number | null = null;
  let maxDown: number | null = null;
  for (const v of dev) {
    if (v == null) continue;
    sum += v;
    n += 1;
    if (maxUp == null || v > maxUp) maxUp = v;
    if (maxDown == null || v < maxDown) maxDown = v;
  }
  return {
    avg: n > 0 ? Number((sum / n).toFixed(2)) : null,
    maxUp,
    maxDown,
  };
}