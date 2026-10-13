/**
 * 采集「今日运动建议」的输入（buildTodayWorkout 的入参）。
 *
 * ★ 单一事实来源：工具页「运动建议」（ToolTopicScreen·SportRedesign）与
 *   「运动消耗」详情页的「今日运动建议」卡共用本函数取数，保证两处给出的
 *   处方完全一致——点卡片进工具页不会出现「卡片说一套、页面说另一套」。
 *
 * 口径：从 ring + healthStore 按锚定日取真实数据；缺项静默降级为 null，绝不编数字。
 *   · 睡眠只取「昨晚」（今天没有就退昨天），不标「昨」。
 *   · HRV 只有当天能读（固件限制），历史日不编。
 *   · 皮质醇需当天 ≥4 个样本才给档位，否则 null（buildTodayWorkout 会退到时段解释）。
 */
import { healthStore, dayKey } from '../data/healthStore';
import { analyzeCortisol } from './cortisolRhythm';
import type { WorkoutInput } from './todayWorkout';

export function collectWorkoutInput(ring: any, dayTs: number): WorkoutInput {
  const d0 = new Date();
  const startOfToday = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
  const sd = new Date(dayTs);
  const startOfSel = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
  const isToday = startOfSel === startOfToday;
  const sk = dayKey(dayTs);

  const sleepSel = (() => {
    try { return healthStore.getSleep(sk) ?? (isToday ? healthStore.getSleep(dayKey(dayTs - 86400000)) : null); }
    catch { return null; }
  })();

  const steps = (() => { try { return ring?.stepDaily?.[sk]?.steps ?? 0; } catch { return 0; } })();

  // HRV 只有当天能读（固件限制），历史日不编
  const hrv = isToday ? (() => { try { return ring?.hrvDaily?.[sk] ?? null; } catch { return null; } })() : null;

  const cortisolLabel = (() => {
    try {
      const samples = (healthStore.getIntraday?.('cortisol', sk) ?? []) as { t: number; v: number }[];
      if (!Array.isArray(samples) || samples.length < 4) return null;
      const r = analyzeCortisol(samples, 14);
      const lv = (r as { todayLevel?: string }).todayLevel;
      return lv === 'high' ? '偏高' : lv === 'dysregulated' ? '节律紊乱' : '正常';
    } catch {
      return null;
    }
  })();

  const recentAvg = (daily: Record<string, number> | undefined, days: number): number | null => {
    if (!daily) return null;
    const keys = Object.keys(daily).sort().slice(-days - 1, -1); // 不含今天
    const nums = keys.map((k) => daily[k]).filter((v) => Number.isFinite(v) && v > 0);
    if (!nums.length) return null;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  };
  const statusAvg = (() => { try { return recentAvg(ring?.statusDaily, 7); } catch { return null; } })();
  const hrvAvg = (() => { try { return recentAvg(ring?.hrvDaily, 7); } catch { return null; } })();

  const todayTimeline = (() => {
    if (!isToday) return null;
    const list = (ring?.statusTimeline ?? []) as { t?: number; value?: number }[] | null;
    if (!list?.length) return null;
    const pts = list.filter((p) => p && p.t != null && (p.t as number) >= startOfToday && Number.isFinite(p.value));
    return pts.length ? (pts as { t: number; value: number }[]) : null;
  })();

  return {
    phase: ring?.curveStatus?.phaseLabel ?? '未记录',
    value: ring?.curveStatus?.value ?? null,
    statusAvg,
    sleepScore: sleepSel && Number.isFinite(sleepSel.score) ? Math.round(sleepSel.score) : null,
    now: isToday ? Date.now() : startOfSel + 12 * 3600 * 1000, // 历史日取正午做代表时刻
    sleepTotalMin: sleepSel?.total ?? null,
    sleepDeepMin: sleepSel?.deep ?? null,
    hrv, hrvAvg, steps,
    dayInCycle: isToday ? (ring?.curveStatus?.dayInCycle ?? null) : null,
    timeline: todayTimeline,
    cortisolLabel,
  };
}
