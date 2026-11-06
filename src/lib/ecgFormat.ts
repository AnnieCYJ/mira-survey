/**
 * ECG 数值格式化（审查 03 🔴#4）
 *
 * 为什么需要：
 *   `ring.ecg` 有两个来源 ——
 *     ① handleEcg()：全字段写入（`num(raw.x) ?? 0`），字段齐全；
 *     ② **快照恢复**：把磁盘上的旧 JSON 原样灌回来。
 *   旧版本 App 写出的 ecg 对象可能不含 aveQT / avePWV（这两个字段是后加的），
 *   此时 `Math.round(undefined)` → `NaN`，界面上直接显示「NaN ms」/「NaN cm/s」。
 *
 * 所以：任何 ECG 派生数值在展示前都必须过一道「有限数」检查，
 * 缺失 / NaN / Infinity 一律显示 '—'，绝不把 NaN 递给用户。
 */

/** 把可能是 undefined / NaN 的数值格式化为整数串；不可用时返回 '—'。 */
export function fmtEcgNum(v: number | undefined | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}` : '—';
}

/** 带单位版本：`fmtEcgUnit(ring.ecg?.aveHeart, 'bpm')` → '72 bpm' / '—'。 */
export function fmtEcgUnit(v: number | undefined | null, unit: string): string {
  const n = fmtEcgNum(v);
  return n === '—' ? n : `${n} ${unit}`;
}

/**
 * 数值 + 状态判定（用于详情页指标格）。
 * 无有效值时 status = 'unknown'（调用方按 unknown 走中性/空态样式）。
 */
export function ecgStatus(
  v: number | undefined | null,
  low: number,
  high: number,
): 'low' | 'normal' | 'high' | 'unknown' {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 'unknown';
  if (v > high) return 'high';
  if (v < low) return 'low';
  return 'normal';
}
