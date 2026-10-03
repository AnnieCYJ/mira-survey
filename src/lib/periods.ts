// 自然日历周期工具：week=本周一~周日 / month=本月1号~月末 / year=今年1月~12月
// ★所有「按个数/数据展示」的图表都改用这里的真实日历区间，不再用「滚动最近 N 天/月」
import { dayKey } from '../data/healthStore';
import { reportNowMsForDay } from './dayAnchor';
import type { RangeKey } from '../data/metrics';

export interface PeriodUnit {
  label: string;
  dayKeys: string[];
  repMidMs: number;
}

const WD = ['一', '二', '三', '四', '五', '六', '日'];

/** 本周一 0:00（周一为一周起点，与 RANGE_DEF.week.axis 对齐） */
function mondayOf(anchorMs: number): Date {
  const d = new Date(anchorMs);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=周日 1=周一..6=周六
  const back = (dow + 6) % 7; // 距本周一的天数
  d.setDate(d.getDate() - back);
  return d;
}

/** 自然周期（日历对齐）。day 无分桶，返回空数组 */
export function buildNaturalPeriods(
  range: RangeKey,
  anchorMs: number,
): PeriodUnit[] {
  if (range === 'day') return [];
  const out: PeriodUnit[] = [];
  const a = new Date(anchorMs);
  a.setHours(0, 0, 0, 0);

  if (range === 'week') {
    const mon = mondayOf(anchorMs);
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      out.push({
        label: WD[i],
        dayKeys: [dayKey(d.getTime())],
        repMidMs: reportNowMsForDay(d.getTime()),
      });
    }
  } else if (range === 'month') {
    const y = a.getFullYear(), m = a.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    for (let dd = 1; dd <= dim; dd++) {
      const d = new Date(y, m, dd);
      out.push({
        label: String(dd),
        dayKeys: [dayKey(d.getTime())],
        repMidMs: reportNowMsForDay(d.getTime()),
      });
    }
  } else {
    const y = a.getFullYear();
    for (let m = 0; m < 12; m++) {
      const dim = new Date(y, m + 1, 0).getDate();
      const dayKeys: string[] = [];
      for (let dd = 1; dd <= dim; dd++) dayKeys.push(dayKey(new Date(y, m, dd).getTime()));
      out.push({
        label: `${m + 1}月`,
        dayKeys,
        repMidMs: reportNowMsForDay(new Date(y, m, 15).getTime()),
      });
    }
  }
  return out;
}

/** 上一自然周期（用于对比）：上周 / 上月 / 去年 */
export function buildPrevNaturalPeriods(
  range: RangeKey,
  anchorMs: number,
): PeriodUnit[] {
  if (range === 'day') return [];
  const a = new Date(anchorMs);
  if (range === 'week') {
    const prev = new Date(a);
    prev.setDate(prev.getDate() - 7);
    return buildNaturalPeriods('week', prev.getTime());
  }
  if (range === 'month') {
    const prev = new Date(a);
    prev.setMonth(prev.getMonth() - 1);
    return buildNaturalPeriods('month', prev.getTime());
  }
  const prev = new Date(a);
  prev.setFullYear(prev.getFullYear() - 1);
  return buildNaturalPeriods('year', prev.getTime());
}

export { dayKey };
