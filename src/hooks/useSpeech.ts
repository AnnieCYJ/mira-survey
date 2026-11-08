import { useCallback } from 'react';

export type SpeechState = 'idle' | 'speaking' | 'stopped';

/**
 * TTS 语音朗读 —— 2026-11-06 用户明确要求「目前不需要」，已停用。
 *
 * 保留 hook 的形状（state / speak / stop），避免改动 ChatSheet 与
 * MiraAIHomeScreen 的调用点；内部不再加载 expo-speech，也不再输出
 * 「[Speech] 没找到 Tingting」这类 console.error 警告（开发版会把它们
 * 弹成底部 toast）。需要恢复朗读时，把旧实现从 git 历史取回即可。
 */
export function useSpeech() {
  const stop = useCallback(async () => {}, []);
  const speak = useCallback(async (
    _text: string,
    _opts?: { language?: string; rate?: number; pitch?: number },
  ) => {}, []);

  return { state: 'idle' as SpeechState, speak, stop };
}
