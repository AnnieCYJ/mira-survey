/** 与模型初始化共用窗口配置；按实际聊天模板分词，保留输出空间。 */
export const MODEL_CONTEXT_TOKENS = 2048;
const SAFETY_TOKENS = 64;
export type BudgetMessage = { role: string; content: string };
export interface BudgetTokenizer {
  getFormattedChat(messages: BudgetMessage[]): Promise<{ prompt: string }>;
  tokenize(text: string): Promise<{ tokens: number[] }>;
}

export class ContextBudgetError extends Error {
  constructor() {
    super('AI_CONTEXT_BUDGET_EXCEEDED');
    this.name = 'ContextBudgetError';
  }
}

/** 不裁断用户问题、知识边界或健康事实。超限时只删除调用方指定的可选消息。 */
export async function fitContext(
  ctx: BudgetTokenizer,
  messages: BudgetMessage[],
  outputTokens: number,
  optionalIndices: number[] = [],
): Promise<BudgetMessage[]> {
  const budget = MODEL_CONTEXT_TOKENS - outputTokens - SAFETY_TOKENS;
  if (!Number.isInteger(outputTokens) || outputTokens <= 0 || budget <= 0) throw new ContextBudgetError();
  const removed = new Set<number>();
  const candidates = [...new Set(optionalIndices)].filter(i => Number.isInteger(i) && i >= 0 && i < messages.length);
  for (let attempt = 0; attempt <= candidates.length; attempt++) {
    const kept = messages.filter((_, i) => !removed.has(i));
    const formatted = await ctx.getFormattedChat(kept);
    const { tokens } = await ctx.tokenize(formatted.prompt);
    if (tokens.length <= budget) return kept;
    if (attempt < candidates.length) removed.add(candidates[attempt]);
  }
  // 交给现有回退流程，避免把不完整事实送入模型继续生成分析。
  throw new ContextBudgetError();
}
