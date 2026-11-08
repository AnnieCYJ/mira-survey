/**
 * metricRetention.ts —— 跨天清零策略（唯一真相源）
 *
 * ★ 2026-11-08（用户原话口径）：
 *   「压力也应该跨天清零，我说的身心压力也要跨天清零，
 *    所有数据应该除了生理周期、体检，剩下的那些个还血压什么的都要跨天清零。」
 *
 * 即：每天 0 点（日界）过后，当日指标回到「今日暂无」状态，
 * 直到今天产生新数据才显示；而「长周期 / 一次性」数据保留上次值。
 *
 * ── 分类 ──────────────────────────────────────────────────────────────
 *  • 每日指标（daily / 跨天清零）：
 *      healthStore 里的全部 MetricKey —— hr/hrv/spo2/temp/eda/rr/steps/distance/calorie/
 *      stress/fatigue/sns/met/bpSys/bpDia/ppgSys/ppgDia/glucose/lipid/ua/skin/emotion/
 *      cortisol/triglyceride/hdl/ldl/cholesterol/glucoseType/glucoseLevel/depressionRisk/
 *      skinTemp/manualBpSys/manualBpDia/manualGlucose。
 *      这些键天然按 YYYY-MM-DD 分日存储 → 新的一天键为空 = 已归零。
 *      UI 读取今日值必须走 getTodayValue()，绝不回退到「最近一次」（getLatest 大窗口）。
 *
 *  • 长周期 / 一次性（persistent / 不清零 / 豁免）：
 *      - 'cycle'  生理周期：存于 cycleLog（独立 store），按周期相位推进，跨天保留。
 *      - 'exam'   体检（一键体检 / 微体检报告）：存于 quickCheckStore / examStore（独立 store），
 *        属「一次性快照」，结果长期保留；其组装允许读最近窗口（getLatest(k,7)）属体检快照设计，非每日指标。
 *
 *  其余所有数据（血压、压力、心率……）一律 daily，跨天清零。
 * ───────────────────────────────────────────────────────────────────────
 */

import type { MetricKey } from './healthStore';

/**
 * 豁免跨天清零的「长周期 / 一次性」数据类别。
 * 这些类别不存于 healthStore.daily，而是独立 store（cycleLog / quickCheckStore / examStore），
 * 因此不会随日界归零，需显式列入此集合。
 */
export const PERSISTENT_CATEGORIES = ['cycle', 'exam'] as const;
export type PersistentCategory = (typeof PERSISTENT_CATEGORIES)[number];

/**
 * 判断某个 healthStore 指标键是否「每日指标、需跨天清零」。
 * 当前 healthStore 内所有 MetricKey 均为每日指标 → 恒为 true。
 * 集中在此是为了让「跨天清零」成为显式策略而非散落各屏的隐式注释，
 * 未来若新增持久型指标可在此改写。
 */
export function isDailyResetMetric(_key: MetricKey): boolean {
  return true;
}

/**
 * 判断某数据类别是否豁免跨天清零（长周期 / 一次性）。
 * @param category 'cycle' | 'exam' 等
 */
export function isPersistentCategory(category: string): category is PersistentCategory {
  return (PERSISTENT_CATEGORIES as readonly string[]).includes(category);
}

/**
 * 文档化口径：用户定义的跨天清零规则（供团队/审计引用，不参与运行时）。
 */
export const RETENTION_RULE =
  '除生理周期(cycle)与体检(exam)外，所有每日指标(压力/身心压力/血压/心率/…)跨天清零；' +
  '周期与体检属长周期/一次性数据，保留上次值。';
