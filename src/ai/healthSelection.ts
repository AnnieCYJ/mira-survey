/** 按问题选择完整事实块；不截数字、日期、来源或质量说明。 */
type Topic = 'sleep' | 'cycle' | 'emotion' | 'metabolic' | 'rhythm';
const TOPICS: Array<[Topic, RegExp]> = [
  ['sleep', /睡|恢复|休息|疲劳|累|脑力|认知|专注/],
  ['cycle', /周期|经期|月经|排卵|雌激素|孕激素|孕酮|激素|体温/],
  ['emotion', /情绪|心情|压力|焦虑|难过|开心|紧张|皮电|eda/i],
  ['metabolic', /血糖|血压|血脂|胆固醇|代谢|饮食|营养|吃|餐/],
  ['rhythm', /皮质醇|节律|作息/],
];
const LABELS: Record<Topic, string[]> = {
  sleep: ['睡眠事实', '睡眠与活动摘要', '皮质醇节律', '情绪脑力', '近7天趋势'],
  cycle: ['周期相位', '激素推断', '皮质醇节律', '睡眠事实', '睡眠与活动摘要', '近7天趋势'],
  emotion: ['情绪脑力', '睡眠事实', '睡眠与活动摘要', '皮质醇节律', '近7天趋势'],
  metabolic: ['代谢血液指标', '睡眠与活动摘要', '近7天趋势'],
  rhythm: ['皮质醇节律', '睡眠事实', '睡眠与活动摘要', '激素推断', '近7天趋势'],
};
const ALWAYS = ['解读规则', '当前时段', '基础指标', '周期相位'];
const KNOWN = new Set([...ALWAYS, ...Object.values(LABELS).flat(), '用户已确认的好习惯']);

export function needsHealthFacts(question: string): boolean {
  return TOPICS.some(([, pattern]) => pattern.test(question)) || /心率|hrv|血氧|状态|精力|能量|指标|数据|健康|运动|锻炼|皮肤|气色/i.test(question);
}

export function selectHealthFacts(
  snapshot: string,
  question: string,
  options: { omitPatternContext?: boolean } = {},
): string {
  if (!snapshot.trim()) return '';
  // 泛问或综合分析保留全部域；多主题问题取并集。
  const topics = TOPICS.filter(([, pattern]) => pattern.test(question)).map(([topic]) => topic);
  const all = !topics.length || /综合|全面|整体|所有指标/.test(question);
  const selected = new Set([...ALWAYS, ...topics.flatMap(topic => LABELS[topic]), '用户已确认的好习惯']);
  const blocks = snapshot.split(/\n(?=• |【)/);
  const kept = blocks.filter(block => {
    if (options.omitPatternContext && /^【(?:用户已确认的个人规律|最近观察到的规律)/.test(block)) return false;
    const label = /^• ([^：]+)：/.exec(block)?.[1];
    // 新增/未知块默认保留，避免新增证据边界被静默丢掉。
    return !label || !KNOWN.has(label) || all || selected.has(label);
  });
  if (kept.length === blocks.length) return snapshot;
  return kept.join('\n') + '\n• 选取范围：本轮只提供相关事实；未提供的领域不能推断为正常、异常或没有记录。';
}
