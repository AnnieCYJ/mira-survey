import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

export type SpeechState = 'idle' | 'speaking' | 'stopped';

/**
 * Text-to-Speech hook wrapping expo-speech.
 * Auto-selects best Chinese Enhanced voice (Tingting / Meijia on iOS).
 */
export function useSpeech() {
  const [state, setState] = useState<SpeechState>('idle');
  const voicesRef = useRef<Speech.Voice[]>([]);

  // 初始化：缓存可用声音
  useEffect(() => {
    let alive = true;
    Speech.getAvailableVoicesAsync().then((vs) => {
      if (!alive) return;
      voicesRef.current = vs;
      // ★ 打印所有声音，找 Tingting
      console.error('[Speech] 共', vs.length, '个声音:');
      vs.forEach((v, i) => {
        if (v.language.startsWith('zh')) {
          console.log(`  [${i}] ZH: "${v.name}" lang=${v.language} quality=${v.quality}`);
        }
      });
      const zhVoices = vs.filter((v) => v.language.startsWith('zh'));
      if (zhVoices.length === 0) {
        console.error('[Speech] ⚠️ ⚠️ 没有中文声音！去 iOS 设置 > 辅助功能 > 语音内容 > 声音 下载中文声音包');
      }
      const tingting = zhVoices.find((v) => v.name.toLowerCase().includes('tingting'));
      if (tingting) {
        console.error('[Speech] ✅ 找到 Tingting！用它');
      } else {
        console.error('[Speech] ⚠️ ⚠️ 没找到 Tingting，可用中文声音:', zhVoices.map(v => v.name));
      }
    });
    return () => { alive = false; };
  }, []);

  const stop = useCallback(async () => {
    try {
      await Speech.stop();
    } catch {}
    setState('idle');
  }, []);

  const speak = useCallback(async (
    text: string,
    opts?: { language?: string; rate?: number; pitch?: number }
  ) => {
    if (!text?.trim()) return;
    await stop();

    const lang = opts?.language ?? 'zh-CN';
    // 找任何中文声音（iOS 会自动选 Enhanced 版本如果有）
    const voices = voicesRef.current;
    // 🔒 固定黎潋 Lilian — Annie 指定
    const lilian = voices.find((v) =>
      v.language.startsWith('zh') &&
      (v.name.toLowerCase().includes('lilian') || v.name.includes('黎潋'))
    );
    if (!lilian) {
      console.error('[Speech] ❌ 没找到 Lilian！可用中文声音:', voices.filter(v => v.language.startsWith('zh')).map(v => v.name));
    } else {
      console.error('[Speech] 🔒 固定用黎潋:', lilian.name, lilian.language);
    }
    const voiceId: string | undefined = lilian?.identifier;

    setState('speaking');
    Speech.speak(text, {
      language: lang,
      rate: opts?.rate ?? 1.0,
      pitch: opts?.pitch ?? 1.0,
      voice: voiceId as any,
      onDone: () => setState('idle'),
      onError: () => setState('idle'),
      onStopped: () => setState('idle'),
    });
  }, [stop]);

  // 卸载时停
  useEffect(() => () => { Speech.stop(); }, []);

  return { state, speak, stop };
}
