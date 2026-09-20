// AI 记录变更广播 —— 与 React 解耦的极简事件总线。
// 为什么需要它：miraAi.ask() 是普通模块函数（不在 React 树内），写完 MemoryStore 后
// 无法直接 setState；首页「今日日历」靠订阅本总线，实现「和 AI 对话产生关键信息后及时刷新」。

type Listener = () => void;

const listeners = new Set<Listener>();

/** 订阅 AI 记录变更，返回取消订阅函数 */
export function onAiRecord(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** AI 记录写入后调用（miraAi.ask 的 finally 里） */
export function emitAiRecord(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[aiRecordBus] listener failed:', e);
    }
  });
}
