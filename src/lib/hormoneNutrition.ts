/**
 * hormoneNutrition.ts —— 皮质醇 / 雌激素 / 孕激素 → 饮食营养建议（信号→建议映射）
 *
 * 这是「激素 × 饮食营养」这条线的收口层：把戒指可测信号推算出的三类激素状态，
 * 翻译成温和、非诊断的饮食建议，供饮食识别页（FoodScanScreen）展示。
 *
 * 数据来源（均为项目已有、已验证的推算层，非化验级读数）：
 *   · 皮质醇：cortisolRhythm.analyzeCortisol(collectSamples()) —— 昼夜节律状态
 *   · 雌激素：hormoneInference.inferHormones → estradiol（HRV + EDA 推算）
 *   · 孕激素：hormoneInference.inferHormones → progesterone（BBT + RHR 推算）
 *
 * 口径铁律（与 Mira 一致）：
 *   - 只描述生理状态 + 给出「可以留意」的食物方向，不做评分、不做诊断、不评判用户。
 *   - 激素值均为戒指信号推算的参考值（压力代理 / 生理相关），UI 须标注非化验结果。
 */
import type { RingState } from '../ble/RingBleManager';
import { collectSamples } from '../components/CortisolRhythmCard';
import { analyzeCortisol } from './cortisolRhythm';
import { collectDailyPhysio, inferHormones } from './hormoneInference';
import { computeCycle, type CycleLog, type CycleInfo } from './cycleMath';

export type HormoneStatusLike =
  | 'high' | 'normal' | 'low' | 'inconclusive' | 'insufficient' | 'reference';

export interface CortisolPart {
  ready: boolean;
  level: 'normal' | 'high' | 'dysregulated';
  label: string;
  highStreak: number;
  dysStreak: number;
  sustainedHighStreak: number;
  hint: string;
}
export interface EstrogenPart {
  ready: boolean;
  status: HormoneStatusLike;
  trend: 'rising' | 'falling' | 'flat' | 'unknown';
  label: string;
  hint: string;
}
export interface ProgesteronePart {
  ready: boolean;
  status: HormoneStatusLike;
  level: 'follicular' | 'luteal' | 'unknown';
  label: string;
  hint: string;
}
export interface HormoneNutritionSnapshot {
  cortisol: CortisolPart;
  estrogen: EstrogenPart;
  progesterone: ProgesteronePart;
}

// ────────────────────────────────────────────
// 状态文案
// ────────────────────────────────────────────
function statusLabel(s: HormoneStatusLike): string {
  switch (s) {
    case 'high': return '偏高';
    case 'normal': return '正常';
    case 'low': return '偏低';
    case 'reference': return '参考值';
    case 'inconclusive': return '待确认';
    case 'insufficient': return '数据不足';
  }
}

// ────────────────────────────────────────────
// 激素 → 饮食建议（温和、非诊断）
// ────────────────────────────────────────────
function cortisolHint(level: CortisolPart['level'], sustainedHigh: number, highStreak: number): string {
  if (level === 'high') {
    const tail = highStreak >= 3 ? `（已连续 ${highStreak} 天偏高）` : '';
    return `皮质醇偏高${tail}时，可留意含镁食物（深绿蔬菜、坚果、黑巧）与充足水分，少碰咖啡因与高糖。`;
  }
  if (level === 'dysregulated') {
    return '昼夜节律略乱，尽量固定三餐与睡眠时间，帮助皮质醇曲线回到晨高夜低。';
  }
  return '皮质醇节律正常，保持规律三餐即可。';
}

function estrogenHint(status: HormoneStatusLike, trend: EstrogenPart['trend']): string {
  if (status === 'high' || trend === 'rising') {
    return '雌激素上行，适量优质脂肪与十字花科蔬菜（西兰花、羽衣甘蓝）有助雌激素代谢。';
  }
  if (status === 'low') {
    return '雌激素偏低，可留意大豆制品、亚麻籽等植物来源。';
  }
  return '雌激素随周期平稳波动，正常饮食即可。';
}

function progesteroneHint(status: HormoneStatusLike, level: ProgesteronePart['level']): string {
  if (status === 'low' && level === 'luteal') {
    return '黄体期孕酮偏低，可留意维生素 B6（香蕉、禽肉）、镁与锌（坚果、贝类）。';
  }
  if (status === 'low' && level === 'follicular') {
    return '卵泡期孕酮本就偏低，无需特别补充。';
  }
  if ((status === 'normal' || status === 'high') && level === 'luteal') {
    return '孕酮处于黄体期高位，身体更需稳定碳水与温润杂粮。';
  }
  return '孕酮随周期变化，正常饮食即可。';
}

// ────────────────────────────────────────────
// 主入口：拼出三类激素状态 + 各自饮食建议
// ────────────────────────────────────────────
function tempSeriesOf(ring: RingState): { date: string; temp: number }[] | undefined {
  const td = (ring.tempDaily ?? {}) as Record<string, number>;
  const keys = Object.keys(td);
  return keys.length ? keys.map((d) => ({ date: d, temp: td[d] })) : undefined;
}

export function buildHormoneNutritionSnapshot(
  cycleLog: CycleLog | null,
  ring: RingState,
): HormoneNutritionSnapshot {
  // ── 1. 皮质醇（压力代理）──
  let cortisol: CortisolPart = {
    ready: false, level: 'normal', label: '数据不足',
    highStreak: 0, dysStreak: 0, sustainedHighStreak: 0, hint: '',
  };
  try {
    const samples = collectSamples();
    if (samples.length >= 4) {
      const r = analyzeCortisol(samples);
      const level = r.todayLevel; // 'normal' | 'high' | 'dysregulated'
      const label = level === 'high' ? '当日偏高' : level === 'dysregulated' ? '节律紊乱' : '节律正常';
      cortisol = {
        ready: true, level, label,
        highStreak: r.highStreak, dysStreak: r.dysStreak,
        sustainedHighStreak: r.sustainedHighStreak,
        hint: cortisolHint(level, r.sustainedHighStreak, r.highStreak),
      };
    }
  } catch {
    /* 保留数据不足态 */
  }

  // ── 2. 雌激素 / 孕激素（HRV/EDA/BBT/RHR 推算）──
  let estrogen: EstrogenPart = { ready: false, status: 'insufficient', trend: 'unknown', label: '数据不足', hint: '' };
  let progesterone: ProgesteronePart = { ready: false, status: 'insufficient', level: 'unknown', label: '数据不足', hint: '' };
  try {
    if (cycleLog && cycleLog.lastPeriodStart) {
      const physio = collectDailyPhysio(60);
      const info: CycleInfo = computeCycle(cycleLog, new Date(), {
        tempSeries: tempSeriesOf(ring),
        periodHistory: cycleLog.history,
      });
      const inf = inferHormones(physio, {
        lastPeriodStart: cycleLog.lastPeriodStart,
        cycleLength: cycleLog.cycleLength,
        lutealLength: cycleLog.lutealLength,
        periodLength: cycleLog.periodLength,
        dayInCycle: info.dayInCycle,
        phase: info.phase,
        ovulationDate: info.ovulationDate,
      });
      const e = inf.estradiol;
      const p = inf.progesterone;
      estrogen = { ready: true, status: e.status, trend: e.trend, label: statusLabel(e.status), hint: estrogenHint(e.status, e.trend) };
      progesterone = { ready: true, status: p.status, level: p.level, label: statusLabel(p.status), hint: progesteroneHint(p.status, p.level) };
    }
  } catch {
    /* 保留数据不足态 */
  }

  return { cortisol, estrogen, progesterone };
}
