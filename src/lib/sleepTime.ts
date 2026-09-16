/**
 * 睡眠时刻工具（纯函数、零依赖）——「HH:mm」入睡/起床时刻的解析与归一。
 *
 * 归一的意义：把凌晨 0–11 点视为 +24（00:30 → 24.5、23:30 → 23.5），
 * 这样「晚睡程度」可以单调比较（23:30 早于 00:30），睡眠负载/评分都依赖它。
 */

/** "HH:mm" → 归一化小时（凌晨 +24）。解析失败返回 null。 */
export function bedtimeHour(sleepTime?: string | null): number | null {
  if (!sleepTime) return null;
  const m = String(sleepTime).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  if (!Number.isFinite(h)) return null;
  return h < 12 ? h + 24 : h;
}

/** 入睡时刻是否偏晚（晚于 23:30 视为偏晚）。无时刻返回 false。 */
export function isLateBedtime(sleepTime?: string | null): boolean {
  const h = bedtimeHour(sleepTime);
  return h != null && h > 23.5;
}
