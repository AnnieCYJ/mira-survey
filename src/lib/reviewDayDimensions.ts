/**
 * reviewDayDimensions —— 回顾·日「按维度拆解」的**取数层**（2026-11-11）
 *
 * 职责单一：把真机散落在 healthStore / RingBle 状态 / 各类日志里的数据，
 * 装进 `DayDimensionInput` 交给纯规则引擎 `reviewDimensions.composeDimensionGroups()`。
 * 本层**不写文案、不做判断**（那些全在纯模块里，可离线单测），只负责：
 *   · 按 dayKey 取当天真实数据；
 *   · 取不到就留 null/undefined → 对应维度整卡不出（空态铁律）；
 *   · 单源异常 try/catch 吞掉，不让一张维度卡把整个回顾日拖崩。
 *
 * 用户要的维度：生理周期阶段 / 早上睡眠 / 当天运动 / 整体·平均状态 /
 * 情绪·压力 / 血压等可监测数据 / 完成的任务（运动、呼吸冥想、饮食打卡…）。
 */
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { computeCycle, type CycleLog } from './cycleMath';
import { getEntriesForDay, MOOD_LABEL } from '../data/emotionLog';
import { getSelfReportsForDaySync } from '../data/selfReportLog';
import { allInterventionEntries, type InterventionKind } from '../data/interventionLog';
import { loadSportLogs } from './sportLog';
import { loadFoodLogs } from './foodAi';
import {
  composeDimensionGroups,
  type DayDimensionInput,
  type DimensionGroup,
} from './reviewDimensions';

/** 干预类型 → 人话事件名（与 month 视图 INTERVENTION_LABEL 口径一致，但收敛成「完成的事」） */
const TASK_LABEL: Record<InterventionKind, string> = {
  grounding: '缓一缓', reframe: '换个说法', activate: '动一动', gratitude: '睡前记两笔',
  compliment: '夸一个人', savoring: '品味小事', future: '给未来写信', outdoor: '到户外去',
  breath: '呼吸练习', meditate: '正念冥想',
};

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 取某指标当日均值（整数化；用户口径：只有身体年龄可带 1 位小数） */
function dayMean(key: any, dk: string): number | null {
  try {
    const d = healthStore.getDay(key, dk);
    return d && fin(d.mean) ? Math.round(d.mean) : null;
  } catch { return null; }
}

/** 取当天状态曲线（今天读实时时间线，历史日读归档）→ 均值 + 最多点数 */
function stateOfDay(dk: string, isToday: boolean): {
  mean: number | null; level: string | null; points: number;
} {
  try {
    const st = RingBle.getState();
    const pts: any[] = isToday
      ? (st?.statusTimeline ?? [])
      : (st?.statusTimelineByDay?.[dk] ?? []);
    const real = pts.filter((p) => p && fin(p.value) && p.value > 0 && p.fill !== true);
    if (real.length) {
      const mean = real.reduce((s, p) => s + p.value, 0) / real.length;
      // 档位用出现最多的真实 level，不自己另造切点
      const tally: Record<string, number> = {};
      for (const p of real) if (typeof p.level === 'string') tally[p.level] = (tally[p.level] ?? 0) + 1;
      const level = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] ?? null;
      return { mean, level, points: real.length };
    }
    // 曲线没点到，退回按天归档的日均（statusDaily 是真实归档值，不是补点）
    const sd = (st as any)?.statusDaily?.[dk];
    return fin(sd) ? { mean: sd, level: null, points: 1 } : { mean: null, level: null, points: 0 };
  } catch { return { mean: null, level: null, points: 0 }; }
}

/** 当天完成的任务（真实日志聚合；无记录返回空数组） */
function completedTasksOf(dk: string): { label: string; count: number }[] {
  const tally = new Map<string, number>();
  const add = (label: string, n = 1) => tally.set(label, (tally.get(label) ?? 0) + n);

  try {
    for (const e of allInterventionEntries()) {
      if (dayKey(e.ts) !== dk) continue;
      add(TASK_LABEL[e.kind] ?? '做了一件事');
    }
  } catch { /* 日志未加载就跳过 */ }

  try {
    for (const sr of getSelfReportsForDaySync(dk)) {
      if (sr.type === 'food') add('记了饮食');
      else if (sr.type === 'mood') add('记了心情');
      else add('记下一笔');
    }
  } catch { /* ignore */ }

  try {
    const n = loadSportLogs().filter((s) => s.dateKey === dk).length;
    if (n > 0) add('运动打卡', n);
  } catch { /* SQLite 未就绪时跳过 */ }

  try {
    const n = loadFoodLogs().filter((f) => f.dateKey === dk).length;
    if (n > 0) add('饮食拍照', n);
  } catch { /* ignore */ }

  return [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/** 当天运动名称（手动打卡 + 今日戒指识别到的运动段） */
function sportNamesOf(dk: string, isToday: boolean): string[] {
  const out: string[] = [];
  try {
    for (const s of loadSportLogs()) {
      if (s.dateKey === dk && s.typeName) out.push(s.typeName);
    }
  } catch { /* ignore */ }
  if (isToday) {
    try {
      for (const s of RingBle.getState()?.sportSessions ?? []) {
        if ((s as any)?.typeName) out.push(String((s as any).typeName));
      }
    } catch { /* ignore */ }
  }
  return [...new Set(out)].slice(0, 4);
}

/** 当天读到的一组身体数值（只展示数值，不打分、不画进度条） */
function vitalsOf(dk: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const sys = dayMean('bpSys', dk) ?? dayMean('manualBpSys', dk);
  const dia = dayMean('bpDia', dk) ?? dayMean('manualBpDia', dk);
  if (sys != null && dia != null) out.push({ label: '血压', value: `${sys}/${dia}` });
  const hr = dayMean('hr', dk);
  if (hr != null) out.push({ label: '心率', value: `${hr} bpm` });
  const hrv = dayMean('hrv', dk);
  if (hrv != null) out.push({ label: 'HRV', value: `${hrv} ms` });
  const spo2 = dayMean('spo2', dk);
  if (spo2 != null) out.push({ label: '血氧', value: `${spo2}%` });
  const stress = dayMean('stress', dk);
  if (stress != null) out.push({ label: '身心压力', value: `${stress}` });
  return out.slice(0, 6);
}

/**
 * 读某一天的全部维度数据并组卡。
 * @param date 任意一天（今天或历史日）
 * @param cycleLog 本地经期记录（异步加载后传入）；历史日据此用 computeCycle 推算相位，
 *                 没有记录就不出「生理周期」卡，绝不臆测。
 */
export function buildDayDimensionGroups(
  date: Date,
  cycleLog?: CycleLog | null,
): DimensionGroup[] {
  try {
    return buildDayDimensionGroupsInner(date, cycleLog);
  } catch {
    // ★ 顶层兜底：任何单源异常都只让维度区少一张卡，绝不让整个回顾页白屏
    return [];
  }
}

function buildDayDimensionGroupsInner(
  date: Date,
  cycleLog?: CycleLog | null,
): DimensionGroup[] {
  const anchor = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const dk = dayKey(anchor.getTime());
  const isToday = dayKey(Date.now()) === dk;

  let phaseLabel: string | null = null;
  let dayInCycle: number | null = null;
  try {
    const ring = RingBle.getState();
    if (isToday && ring?.curveStatus?.hasLog && ring.curveStatus.phaseLabel) {
      // 今天直接用状态里已算好的实时相位，不重复计算
      phaseLabel = ring.curveStatus.phaseLabel;
      dayInCycle = ring.curveStatus.dayInCycle ?? null;
    } else if (cycleLog?.lastPeriodStart) {
      const info = computeCycle(cycleLog, anchor);
      if (info.hasLog && info.phaseLabel && info.phaseLabel !== '未记录') {
        phaseLabel = info.phaseLabel;
        dayInCycle = info.dayInCycle ?? null;
      }
    }
  } catch { /* 相位取不到就不出卡 */ }

  let sleepScore: number | null = null;
  let sleepTotalMin: number | null = null;
  let sleepDeepMin: number | null = null;
  let wakeTime: string | null = null;
  try {
    const s = healthStore.getSleep(dk);
    if (s) {
      sleepScore = fin(s.score) ? s.score : null;
      sleepTotalMin = fin(s.total) && s.total > 0 ? s.total : null;
      sleepDeepMin = fin(s.deep) && s.deep > 0 ? s.deep : null;
      wakeTime = s.wakeTime ?? null;
    }
  } catch { /* ignore */ }

  const state = stateOfDay(dk, isToday);
  let steps: number | null = null;
  let sleepDataStale = false;
  try {
    const st = RingBle.getState();
    const s = st?.stepDaily?.[dk];
    if (s && fin(s.steps) && s.steps > 0) steps = s.steps;
    // ★ 与 buildTodayTimeline 同源：断流只约束今天，历史日已归档睡眠不受影响
    sleepDataStale = isToday && st?.curveStatus?.dataStale === true;
  } catch { /* ignore */ }

  let moodReports: string[] = [];
  try {
    moodReports = getEntriesForDay(dk)
      .map((e) => (e.note ? `${MOOD_LABEL[e.mood] ?? ''}·${e.note}` : (MOOD_LABEL[e.mood] ?? '')))
      .filter(Boolean)
      .slice(0, 3);
  } catch { /* 情绪日志未加载 */ }

  const input: DayDimensionInput = {
    dayKey: dk,
    isToday,
    cyclePhaseLabel: phaseLabel,
    dayInCycle,
    sleepScore,
    sleepTotalMin,
    sleepDeepMin,
    wakeTime,
    sleepDataStale,
    steps,
    stepGoal: 10000,
    sportNames: sportNamesOf(dk, isToday),
    stateMean: state.mean,
    stateLevel: state.level,
    statePointCount: state.points,
    moodReports,
    stressMean: dayMean('stress', dk),
    vitals: vitalsOf(dk),
    completedTasks: completedTasksOf(dk),
  };

  try {
    return composeDimensionGroups(input);
  } catch {
    return [];
  }
}
