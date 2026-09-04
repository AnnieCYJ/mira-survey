/**
 * hrvCompute —— 从逐拍心率时间戳序列反算 HRV 指标
 *
 * 算法背景：
 *   HRV（心率变异性） = 相邻心跳间期（RR interval）的变异程度。
 *   戒指 SDK 的实时心率回调是逐拍的（节流到 5Hz，保证每个心跳都被记录），
 *   每个样本带精确时间戳 ts，相邻 ts 差 ≈ 真实 RR 间期（ms）。
 *
 * 支持指标：
 *   - RMSSD：相邻 RR 差的均方根（时域，最常用，反映副交感活性）
 *   - SDNN：RR 间期的标准差（时域，反映整体变异）
 *   - pNN50：相邻 RR 差 > 50ms 的比例（时域，迷走神经张力指标）
 *
 * 过滤策略：
 *   - RR < 300ms 或 > 2000ms → 异常值丢弃（对应 >200bpm 或 <30bpm 不可能）
 *   - RR 比前后值突变 > 300ms → 异常值丢弃
 *   - 有效 RR < 10 个 → 数据不足，返回 null
 */

export function extractValidRR(timestamps: number[]): number[] {
  if (timestamps.length < 2) return [];
  const rr: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const delta = timestamps[i] - timestamps[i - 1];
    if (delta >= 300 && delta <= 2000) rr.push(delta);
  }
  if (rr.length < 3) return rr;
  const filtered: number[] = [rr[0]];
  for (let i = 1; i < rr.length - 1; i++) {
    const jumpPrev = Math.abs(rr[i] - rr[i - 1]);
    const jumpNext = Math.abs(rr[i] - rr[i + 1]);
    filtered.push(jumpPrev <= 300 && jumpNext <= 300 ? rr[i] : rr[i - 1]);
  }
  filtered.push(rr[rr.length - 1]);
  return filtered.filter((r) => r >= 300 && r <= 2000);
}

export function computeRMSSD(rr: number[]): number | null {
  if (rr.length < 10) return null;
  let s = 0;
  for (let i = 1; i < rr.length; i++) {
    const d = rr[i] - rr[i - 1];
    s += d * d;
  }
  return Math.sqrt(s / (rr.length - 1));
}

export function computeSDNN(rr: number[]): number | null {
  if (rr.length < 10) return null;
  const m = rr.reduce((s, v) => s + v, 0) / rr.length;
  let s = 0;
  for (const v of rr) { const d = v - m; s += d * d; }
  return Math.sqrt(s / rr.length);
}

export function computePNN50(rr: number[]): number | null {
  if (rr.length < 10) return null;
  let c = 0;
  for (let i = 1; i < rr.length; i++) {
    if (Math.abs(rr[i] - rr[i - 1]) > 50) c++;
  }
  return (c / (rr.length - 1)) * 100;
}

export function computeHRV(tsList: number[]): {
  rmssd: number | null; sdnn: number | null; pnn50: number | null; rrCount: number;
} {
  const rr = extractValidRR(tsList);
  return { rmssd: computeRMSSD(rr), sdnn: computeSDNN(rr), pnn50: computePNN50(rr), rrCount: rr.length };
}
