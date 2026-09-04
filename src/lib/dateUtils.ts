/**
 * 纯 JS 日期工具（无原生依赖），供详情页日期步进器与历史序列共用。
 * 周一律采用「周一为每周第一天」的 ISO/业务自然周（dow: 一=1 ... 日=0）。
 */

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dateKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 求包含 d 的当周周一 00:00 */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 周一=0 ... 周日=6
  x.setDate(x.getDate() - dow);
  return x;
}

/** 求包含 d 的当周周日 00:00 */
export function endOfWeek(d: Date): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

export function daysInMonth(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

export function formatMonth(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`;
}

export function formatYear(d: Date): string {
  return `${d.getFullYear()}`;
}

/** 返回自然周范围：本周一 ~ 本周日 */
export function formatWeekRange(d: Date): string {
  const s = startOfWeek(d);
  const e = endOfWeek(d);
  return `${formatDate(s)} - ${formatDate(e)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 生成某年某月的日历网格（含前后补全日，共 42 个 Date） */
export function calendarDays(year: number, month1: number): Date[] {
  const first = new Date(year, month1 - 1, 1);
  const start = startOfWeek(first);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(addDays(start, i));
  }
  return days;
}
