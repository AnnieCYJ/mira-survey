/**
 * 通用格式化工具（设计令牌之外的小型纯函数，无副作用、零依赖）。
 */

/** 把 epoch ms 格式化为 HH:MM 时钟（用于卡片上的「测量时间」展示）。 */
export function formatClockTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '—';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 相对时间（刚刚 / N 分钟前 / HH:MM），用于自动类卡片上轻量的「更新于」提示。 */
export function formatRelativeTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '尚未测量';
  const diff = Date.now() - ts;
  if (diff < 0) return formatClockTime(ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return formatClockTime(ts);
}
