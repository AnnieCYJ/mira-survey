/**
 * 周期相位 → 「今日运动建议」（ACSM 运动与周期指南口径）。
 *
 * 与 CyclePhaseCard 的 PHASE_BRIEF 同一套阶段语义（经期 / 卵泡期 / 排卵期 / 黄体期），
 * phase 传 `ring.curveStatus.phaseLabel`；无经期记录或未知相位返回引导语。
 * 铁律：只给相对强度/类型建议，绝不编造激素数值或具体数据。
 */
export function buildWorkoutAdvice(phase: string): { headline: string; detail: string } {
  switch (phase) {
    case '经期':
      return { headline: '低强度为主', detail: '散步·瑜伽·拉伸更合适，避开高强度与冷水，注意保暖和休息。' };
    case '卵泡期':
      return { headline: '适合加量', detail: '雌激素回升、恢复快，安排力量训练或高强度间歇，可以上量。' };
    case '排卵期':
      return { headline: '状态峰值', detail: '状态最佳，可冲力量 PR 或高强度训练，记得充分热身防受伤。' };
    case '黄体期':
      return { headline: '稳一点', detail: '能量回落，中等强度有氧更合适，别硬扛高强度，保证睡眠。' };
    default:
      return { headline: '记录经期后', detail: '记录一次经期后，按当前周期相位给你今日运动建议。' };
  }
}

/**
 * 周期相位 + 今日状态 → 卡片里一小段「处境分析」（用户 2026-10-12：
 * 「加上你处于什么，比方说经期的什么时候或者什么状态，适宜练什么样的运动，不要太多字」）。
 *
 * 输入全部来自真实数据（ring.curveStatus 的 phaseLabel / dayInCycle / value），
 * 缺失项静默省略，不编造；无相位（未记录经期）返回 null，由调用方走引导文案。
 */
export function buildPhaseAnalysis(
  phase: string,
  dayInCycle: number | null,
  value: number | null,
): string | null {
  const d = dayInCycle != null && Number.isFinite(dayInCycle) ? `第 ${dayInCycle} 天，` : '';
  // 今日状态前缀：只在明显偏低/在线时点一句，不硬凑
  const pre = value == null || !Number.isFinite(value) ? '' : value < 40 ? '今天状态偏低 · ' : value > 70 ? '今天状态在线 · ' : '';
  switch (phase) {
    case '经期':
      return `${pre}经期${d}身体恢复中，适合舒缓轻运动`;
    case '卵泡期':
      return `${pre}卵泡期${d}精力回升，适合逐步加量`;
    case '排卵期':
      return `${pre}排卵期${d}状态峰值，适合冲高强度`;
    case '黄体期':
      return `${pre}黄体期${d}能量回落，适合中低强度`;
    default:
      return null;
  }
}
