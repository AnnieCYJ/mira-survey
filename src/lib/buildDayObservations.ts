/**
 * buildDayObservations —— 回顾·日「AI 细小观察」卡（2026-11-10 用户需求）
 *
 * 用户原话（摘要）：回顾·日里，AI 要"记得它很细小的变化"——比如"今天几点到几点
 * 状态怎么样、变化了，因为干了什么事情"，以及昨晚睡眠怎么样、完成了什么/哪些方面
 * 有提升。一天大概五六个、六七个，看用户完成的事情多少。
 *
 * 设计原则（与品牌铁律一致）：
 *   · 全部由**本地已存储的真实数据**推算（healthStore intraday / sleep / stepDaily +
 *     用户自报 selfReportLog），历史日同样能算；没有数据就不出卡，绝不臆测。
 *   · 只描述生理量（身心压力 / 步数 / 睡眠），不推情绪、不打分、不诊断。
 *   · 与用户自报的时间关联只用"差不多同一时间你记了一笔"这类平实关联句。
 *
 * 最多出 3 张观察卡（叠加基础时间线与用户打卡，总量通常 5–7 条）：
 *   1. 睡眠对比前晚（priority 1，紧跟起床卡）
 *   2. 身心压力变化时段（priority 2，落在高峰小时）
 *   3. 活动高峰时段（priority 3，落在高峰小时）
 * 超出总条数上限时由 JourneyDayView 按 priority 从低到高裁掉观察卡（用户记录永不裁）。
 */
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { getSelfReportsForDaySync, parseTime } from '../data/selfReportLog';
import type { TimelineItem } from '../components/TodayTimelineCard';

export type DayObservation = TimelineItem & { /** 超上限时的让位顺序：数值越大越先被裁 */ priority: number };

const pad2 = (n: number) => String(n).padStart(2, '0');

function fmtMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ''}` : `${m}分钟`;
}

function prevDayKeyOf(dk: string): string {
  return dayKey(parseDayKey(dk) - 86400000);
}

/** 时段措辞：上午 / 中午 / 下午 / 晚间 */
function periodWord(h: number): string {
  if (h < 12) return '上午';
  if (h < 15) return '中午';
  if (h < 18) return '下午';
  return '晚间';
}

/** 同一小时的最近自报（±45 分钟内），用于"差不多同一时间你记了一笔"关联句 */
function nearbyReport(dk: string, h: number): string | null {
  try {
    const center = h * 60 + 30;
    let best: { dt: number; title: string } | null = null;
    for (const sr of getSelfReportsForDaySync(dk)) {
      const t = parseTime(sr.time);
      if (t <= 0) continue;
      const dt = Math.abs(t - center);
      if (dt <= 45 && (!best || dt < best.dt)) best = { dt, title: sr.title };
    }
    return best ? `差不多同一时间，你记了一笔「${best.title}」` : null;
  } catch { return null; }
}

/* ── 1. 睡眠对比前晚 ─────────────────────────────────────────────── */
function sleepCompareObs(dk: string): DayObservation | null {
  try {
    const cur = healthStore.getSleep(dk);
    const prev = healthStore.getSleep(prevDayKeyOf(dk));
    if (!cur || !prev) return null;
    const t1 = cur.total;
    const t0 = prev.total;
    if (!Number.isFinite(t1) || !Number.isFinite(t0) || (t1 as number) <= 0 || (t0 as number) <= 0) return null;
    const dT = (t1 as number) - (t0 as number);
    const d1 = cur.deep ?? 0;
    const d0 = prev.deep ?? 0;
    const dD = Number.isFinite(d1) && Number.isFinite(d0) ? d1 - d0 : null;

    let title: string;
    let sub: string;
    if (dT >= 20) {
      title = '昨晚睡得更足';
      sub = `睡眠 ${fmtMin(t1)}，比前晚多 ${dT} 分钟${dD != null && dD >= 10 ? `，深睡也多了 ${dD} 分钟` : ''}。`;
    } else if (dT <= -20) {
      title = '昨晚睡眠短一些';
      sub = `睡眠 ${fmtMin(t1)}，比前晚少了 ${-dT} 分钟。今天节奏别排太满。`;
    } else if (dD != null && dD >= 12) {
      title = '深睡比前晚更多';
      sub = `总时长差不多，但深睡多了 ${dD} 分钟，恢复得更扎实。`;
    } else if (dD != null && dD <= -12) {
      title = '深睡比前晚少一点';
      sub = `总时长差不多，深睡少了 ${-dD} 分钟。今晚早点放下手机试试。`;
    } else {
      return null;
    }
    return {
      time: cur.wakeTime || '07:30',
      color: mm.colors.purpleCore,
      emoji: '🌙',
      title,
      sub,
      goalMet: false,
      // ★ 本轮（用户）：归入 sleep 维度 → 与「睡眠」维度卡去重，回顾·日每类只保留一张卡
      dimension: 'sleep',
      priority: 1,
    };
  } catch { return null; }
}

/* ── 2. 身心压力变化时段 ─────────────────────────────────────────── */
function stressPeakObs(dk: string): DayObservation | null {
  try {
    const pts = healthStore.getIntraday('stress' as never, dk) ?? [];
    if (!Array.isArray(pts) || pts.length < 6) return null;
    /** 小时 → [样本和, 样本数]（只看 07–22 点，22:00–23:00 是最后一档） */
    const hourAgg = new Map<number, { sum: number; n: number }>();
    let allSum = 0;
    let allN = 0;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
      const h = new Date(p.t).getHours();
      if (h < 7 || h > 22) continue;
      const a = hourAgg.get(h) ?? { sum: 0, n: 0 };
      a.sum += p.v; a.n += 1;
      hourAgg.set(h, a);
      allSum += p.v; allN += 1;
    }
    if (hourAgg.size < 4 || allN < 6) return null; // 数据太薄不谈"高点"
    const dayMean = allSum / allN;
    let peakH = -1;
    let peakMean = 0;
    for (const [h, a] of hourAgg) {
      const m = a.sum / a.n;
      if (m > peakMean) { peakMean = m; peakH = h; }
    }
    // 高于全天均值 8 分以上且本身不算低，才值得说"这个时段不一样"
    if (peakH < 0 || peakMean - dayMean < 8 || peakMean < 12) return null;
    const report = nearbyReport(dk, peakH);
    return {
      time: `${pad2(peakH)}:00`,
      color: theme.colors.stateTired,
      emoji: '🌊',
      title: `${periodWord(peakH)}身心压力走高`,
      sub: `${pad2(peakH)}:00–${pad2(peakH + 1)}:00 升到了这一天的高点，其余时段都更平稳。`,
      analysis: report ?? undefined,
      goalMet: false,
      // ★ 本轮（用户）：归入 stress 维度 → 与「身心压力」维度卡去重
      dimension: 'stress',
      priority: 2,
    };
  } catch { return null; }
}

/* ── 3. 活动高峰时段 ─────────────────────────────────────────────── */
function stepsPeakObs(dk: string, prevDk: string): DayObservation | null {
  try {
    const pts = healthStore.getIntraday('steps' as never, dk) ?? [];
    if (!Array.isArray(pts) || pts.length < 4) return null;
    // 判断序列是"日内累计"还是"逐区间步数"：相邻点大多不减 → 累计
    let nonDecreasing = 0;
    let cmp = 0;
    for (let i = 1; i < pts.length; i++) {
      if (!Number.isFinite(pts[i - 1]?.v) || !Number.isFinite(pts[i]?.v)) continue;
      cmp += 1;
      if ((pts[i].v as number) >= (pts[i - 1].v as number)) nonDecreasing += 1;
    }
    const cumulative = cmp > 0 && nonDecreasing / cmp >= 0.8;
    const hourAgg = new Map<number, number>();
    let prevV: number | null = null;
    let dayTotal = 0;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
      const h = new Date(p.t).getHours();
      const v = p.v as number;
      const delta = cumulative && prevV != null ? Math.max(0, v - prevV) : Math.max(0, v);
      prevV = v;
      if (h >= 7 && h <= 22) hourAgg.set(h, (hourAgg.get(h) ?? 0) + delta);
      dayTotal += delta;
    }
    let peakH = -1;
    let peakN = 0;
    for (const [h, n] of hourAgg) {
      if (n > peakN) { peakN = n; peakH = h; }
    }
    if (peakH < 0 || peakN < 400) return null;
    // 与前一天的总量对比（前一天同口径；取不到就用戒指 stepDaily）
    let analysis: string | undefined;
    try {
      const prevPts = healthStore.getIntraday('steps' as never, prevDk) ?? [];
      let prevTotal = 0;
      if (Array.isArray(prevPts) && prevPts.length >= 2) {
        let pv: number | null = null;
        for (const p of prevPts) {
          if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
          const v = p.v as number;
          prevTotal += cumulative && pv != null ? Math.max(0, v - pv) : Math.max(0, v);
          pv = v;
        }
      } else {
        prevTotal = RingBle.getState()?.stepDaily?.[prevDk]?.steps ?? 0;
      }
      const d = dayTotal - prevTotal;
      if (prevTotal > 0 && Math.abs(d) >= 500) {
        analysis = d > 0
          ? `全天合计约 ${dayTotal} 步，比前一天多走了 ${d} 步。`
          : `全天合计约 ${dayTotal} 步，比前一天少了 ${-d} 步。`;
      }
    } catch { /* 对比取不到就不写 */ }
    return {
      time: `${pad2(peakH)}:00`,
      color: theme.colors.stateCalm,
      emoji: '🚶‍♀️',
      title: '走路最多的一段',
      sub: `${periodWord(peakH)} ${pad2(peakH)}:00–${pad2(peakH + 1)}:00 走了约 ${peakN} 步，是一天里走动最多的时段。`,
      analysis,
      goalMet: false,
      // ★ 本轮（用户）：归入 activity 维度 → 与「当天运动」维度卡去重
      dimension: 'activity',
      priority: 3,
    };
  } catch { return null; }
}

/**
 * 生成某一天的 AI 细小观察卡（0–3 张）。
 * @param date 任意一天（今天或历史日）；没有数据的观察项直接不出卡。
 */
export function buildDayObservations(date: Date): DayObservation[] {
  const dk = dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime());
  const prevDk = prevDayKeyOf(dk);
  const out: DayObservation[] = [];
  const sleep = sleepCompareObs(dk);
  if (sleep) out.push(sleep);
  const stress = stressPeakObs(dk);
  if (stress) out.push(stress);
  const steps = stepsPeakObs(dk, prevDk);
  if (steps) out.push(steps);
  return out;
}
