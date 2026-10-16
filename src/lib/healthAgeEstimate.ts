/**
 * 身体年龄估算。
 *
 * ★ 2026-10-16 修复「身体年龄一致不出数据」：
 *   旧逻辑把 `hasHormonalData` 当硬门槛——只要皮质醇节律判不出（当天 <4 个实测生理槽，
 *   早期佩戴/夜间静息/没做健康一览时极易触发），就整体返回 null → 卡片永久显示「数据积累中」。
 *   这与本文件「未知不代表偏老」的初衷相悖：本意是别乱猜，结果变成「猜不出就不显示」。
 *
 *   新口径：荷尔蒙节律**数据不足时不再卡死**，改为中性处理（不奖励也不惩罚），只按长期健康分调整；
 *   数据足够时仍按原 ± 调整。这样只要有「实际年龄 + 总体健康分」就能出身体年龄，既诚实（不假装
 *   荷尔蒙健康给 -4.5 优惠）又让功能真正可用。真正无数据（无年龄 / 无总体分）仍返回 null。
 */
export function estimateHealthAge(
  actualAge: number | null,
  overallScore: number | null,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
): number | null {
  // ★ 仅保留两道真正必要的门槛：实际年龄有效 + 有长期健康分（否则确实无法估算）
  if (actualAge == null || !Number.isInteger(actualAge) || actualAge < 18 || actualAge > 120 ||
      overallScore == null || !Number.isFinite(overallScore) || overallScore < 0 || overallScore > 100) return null;
  const longTermHealthy = overallScore >= 65;
  // ★ 荷尔蒙节律未知 → 中性（仅按长期健康分调整，不给 ± 荷尔蒙优惠/惩罚）
  const adjustment = !hasHormonalData
    ? (longTermHealthy ? -1.5 : 1.5)
    : (hormonalHealthy
      ? (longTermHealthy ? -4.5 : -1.5)
      : (longTermHealthy ? 1.5 : 3.5));
  return Math.max(18, Math.round((actualAge + adjustment + (65 - overallScore) / 20) * 10) / 10);
}
