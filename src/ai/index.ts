export { ask, type AskOptions, type ChatHistoryItem } from './miraAi';
export { CHARACTER, WORLD_BOOK, buildSystemPrompt, buildCompanionInjection } from './character';
export { MemoryStore } from './memory';
export { ChatContextStore, type ChatContextSnapshot } from './context';
// ⚠️ 不要在业务代码里直接 `getLlamaContext()` + `ctx.completion(...)`：
//    端侧 ctx 是单例，并发推理会抛 "Context is busy" 并被静默降级成规则文案。
//    统一走 `runOnModel(task, key?)`（全局串行队列 + 同 key 去重 + busy 退避重试）。
export { getLlamaContext, runOnModel, releaseLlama, resolveModelPath, MODEL_FILENAME } from './model';
export { buildHealthSnapshot } from './health';
export { inferMood, inferThemes } from './miraAi';
export {
  getAiInsight,
  peekInsight,
  parseInsightRows,
  buildOverviewFallbackRows,
  buildRecoveryFallbackRows,
  aiRowsAcceptable,
  resolveInsightRows,
  type InsightKind,
  type AiInsightRow,
  type AiTone,
} from './insight';
