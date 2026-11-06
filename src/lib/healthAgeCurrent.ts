/**
 * healthAgeCurrent —— 身体年龄「当前值」的**唯一**实时计算源（2026-10-28 统一）。
 *
 * ★ 为什么要抽成共享模块：
 *   此前洞察页身体年龄卡用 `resolveDailyHealthAge` 按天冻结（当天只算一次、全天复用），
 *   而详情页 HealthAgeDetailScreen 用本地 `computeHealthAgeNow` 实时重算，且两者算式
 *   （综合分来源、荷尔蒙判定口径）都不一样 —— 同一天两张卡能差好几岁，且洞察页「一天不变」
 *   被用户感知为「数据一直没有更新」。
 *
 *   ★ 现在：洞察页卡与详情页头条都调用本函数 → 两页数字永远一致（连通），且随数据实时更新。
 *
 *   ★ 口径（与旧 HealthAgeDetailScreen.computeHealthAgeNow 完全一致）：
 *     综合分 = 均值( 100 - 脑力loadScore*0.6 , 100 - 压力emotionalLoad*0.5 , 当日睡眠分 )；
 *     荷尔蒙健康 = computeHormonalHealthy（当日皮质醇 intraday 经 analyzeCortisol 判定）；
 *     身体年龄 = estimateHealthAge(实际年龄, 综合分, 荷尔蒙健康, true)。
 *   历史趋势（月/年/衰老速度）仍由 HealthAgeDetailScreen 的 computeHealthAgeForDay 逐日计算，
 *   不在这里处理。
 */
import { computeCognitiveLoadReport } from './cognitiveLoad';
import { computeStressReport } from './stressAlgorithm';
import { analyzeCortisol, type CortisolSample } from './cortisolRhythm';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { estimateHealthAge } from './healthAgeEstimate';

/**
 * 当日皮质醇节律是否健康（与详情页同源）：≥4 个有效实测槽才判定，否则 false
 *
 * ★ v18.134：新增「是否有实测数据」出口 —— 基础版没有皮质醇实测通道，
 *   「没测」和「测了不健康」必须区分，否则身体年龄会被当成荷尔蒙失衡而偏老
 *   （与 healthAgeEstimate.ts 的「hasHormonalData=false → 中性 ±1.5」设计意图相悖）。
 */
export function computeHormonalHealthyCurrent(dk: string = dayKey(Date.now())): {
  hormonalHealthy: boolean;
  hasHormonalData: boolean;
} {
  try {
    const samples: CortisolSample[] = healthStore
      .getIntraday('cortisol', dk)
      .filter((p: any) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
      .map((p: any, i: number) => ({ t: Number.isFinite(p.t) ? p.t : i * 3600 * 1000, v: p.v }));
    // ★ 不足 4 个实测槽 = 「没测」，不是「测了不健康」
    if (samples.length < 4) return { hormonalHealthy: false, hasHormonalData: false };
    const a = analyzeCortisol(samples) as any;
    return { hormonalHealthy: a?.status?.level === 'normal', hasHormonalData: true };
  } catch (e) {
    // ★ 异常必须留痕 —— 否则「算崩了」与「没数据」在 UI 上完全一致，无法排查
    console.warn('[healthAgeCurrent] 皮质醇节律计算异常：', e);
    return { hormonalHealthy: false, hasHormonalData: false };
  }
}

/** 当前身体年龄（实时）：返回身体年龄 + 综合分；任一输入不足返回 null */
export function computeCurrentHealthAge(actualAge: number | null): {
  healthAge: number | null;
  overallScore: number | null;
} | null {
  if (actualAge == null || !Number.isInteger(actualAge) || actualAge < 18 || actualAge > 120) return null;
  try {
    const fatigue = computeCognitiveLoadReport();
    const stress = computeStressReport();
    const sleep = RingBle.getState()?.daily?.['sleepScore'];
    const scores: number[] = [];
    if (fatigue?.sampleCount > 0 && fatigue.loadScore != null && Number.isFinite(fatigue.loadScore)) {
      scores.push(100 - fatigue.loadScore * 0.6);
    }
    if (stress?.sampleCount > 0 && stress.emotionalLoad != null && Number.isFinite(stress.emotionalLoad)) {
      scores.push(100 - stress.emotionalLoad * 0.5);
    }
    if (sleep != null && Number.isFinite(sleep) && sleep >= 0 && sleep <= 100) scores.push(sleep);
    if (scores.length === 0) return null;
    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const { hormonalHealthy, hasHormonalData } = computeHormonalHealthyCurrent(dayKey(Date.now()));
    // ★ hasHormonalData 不再硬编码 true：基础版没有皮质醇实测通道时走「中性 ±1.5」，
    //   不会被误判成「荷尔蒙失衡 → 偏老」
    const healthAge = estimateHealthAge(actualAge, overallScore, hormonalHealthy, hasHormonalData);
    return { healthAge, overallScore };
  } catch (e) {
    console.warn('[healthAgeCurrent] 身体年龄计算异常：', e);
    return null;
  }
}
