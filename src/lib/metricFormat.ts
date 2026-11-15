/**
 * metricFormat —— 指标数值的统一展示口径
 *
 * ★ 2026-11-14（用户）：「夜间低氧时间百分比是 0 就显示 0，不要显示杠」。
 *   旧代码满屏 `x || '--'`、`!x ? ... : ...`，把 0 当成「没有数据」。
 *   但 0 常常是**真实且重要的结果**：整夜无低氧事件 = 低氧时间 0 秒 / 占比 0%，
 *   深睡 0 分钟、起夜 0 次同理。显示成杠会让用户误以为功能坏了。
 *
 * 唯一允许显示占位符的情况：值本身是 null / undefined / NaN / Infinity。
 * 抽成纯函数是为了让回归脚本能直接测到**真实渲染用的那份逻辑**，而不是复制一份假实现。
 */

/** 是否有可展示的数值（0 算有） */
export function hasValue(v: number | null | undefined): boolean {
  return v != null && Number.isFinite(v);
}

/** 数值 → 展示字符串；0 显示 "0"，只有真正缺值才显示 '--' */
export function fmtMetric(v: number | null | undefined, digits = 0, empty = '--'): string {
  if (!hasValue(v)) return empty;
  const n = v as number;
  return digits > 0
    ? String(Math.round(n * 10 ** digits) / 10 ** digits)
    : String(Math.round(n));
}

/** 同 fmtMetric，但空值用中文破折号（列表行式明细用） */
export function fmtMetricDash(v: number | null | undefined, digits = 0): string {
  return fmtMetric(v, digits, '—');
}
