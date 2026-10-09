import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

// Voice 原生模块
const VoiceModule = NativeModules.Voice as any;
const voiceEmitter = Platform.OS !== 'web' && VoiceModule
  ? new NativeEventEmitter(VoiceModule)
  : null;

export type VoiceState = 'idle' | 'listening' | 'error';

export interface UseVoiceInput {
  state: VoiceState;
  transcript: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<string>;
  isAvailable: boolean;
  /** 同步读取最新转写（不经过 React state/批处理，松手分支用它拿最新值，避免时序竞态） */
  peek: () => string;
}

export function useVoiceInput(): UseVoiceInput {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const stateRef = useRef<VoiceState>('idle');
  const transcriptRef = useRef<string>('');

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  useEffect(() => {
    if (!voiceEmitter) {
      setIsAvailable(false);
      return;
    }

    if (VoiceModule.isSpeechAvailable) {
      VoiceModule.isSpeechAvailable((ok: boolean) => {
        setIsAvailable(!!ok);
      });
    }

    // 🔥 节流变量（在 effect 作用域内，cleanup 时一起销毁）
    let lastResultTs = 0;
    let lastPartialTs = 0;
    let partialTimer: ReturnType<typeof setTimeout> | null = null;

    const subs = [
      voiceEmitter.addListener('onSpeechStart', () => {
        setState('listening');
      }),

      voiceEmitter.addListener('onSpeechResults', (e: any) => {
        const now = Date.now();
        if (now - lastResultTs < 150) return; // 150ms 节流
        lastResultTs = now;
        const best = e?.value?.reduce((a: string, b: string) =>
          (b.length > a.length ? b : a), '') ?? '';
        // ★ 同步写 ref：onSpeechResults 常与 onSpeechEnd 同帧触发，而 stop() 在 onSpeechEnd 里
        //   用 transcriptRef.current resolve 最终转写；若只靠 useEffect 更新 ref，会读到旧空串。
        //   所以这里先同步更新 ref，再排期 setTranscript（驱动 UI）。
        if (best) transcriptRef.current = best;
        if (best && best !== transcriptRef.current) setTranscript(best);
      }),

      voiceEmitter.addListener('onSpeechPartialResults', (e: any) => {
        const arr = e?.value;
        if (!Array.isArray(arr) || arr.length === 0) return;
        const now = Date.now();
        if (now - lastPartialTs < 250) { // 250ms 合并一次
          if (!partialTimer) {
            partialTimer = setTimeout(() => {
              partialTimer = null;
              const last = arr[arr.length - 1];
              if (last) {
                transcriptRef.current = last; // ★ 同步写 ref（见 onSpeechResults 注释）
                lastPartialTs = Date.now();
                setTranscript(last);
              }
            }, 250);
          }
          return;
        }
        const last = arr[arr.length - 1];
        if (last) {
          transcriptRef.current = last; // ★ 同步写 ref
          lastPartialTs = now;
          setTranscript(last);
        }
      }),

      voiceEmitter.addListener('onSpeechEnd', () => {
        setState(s => s === 'listening' ? 'idle' : s);
        if (pendingStopRef.current) {
          pendingStopRef.current.resolve(transcriptRef.current);
          pendingStopRef.current = null;
        }
      }),

      voiceEmitter.addListener('onSpeechError', (e: any) => {
        const code = e?.error?.code;
        if (code !== 7) {
          setError(e?.error?.message ?? '语音识别出错');
        }
        setState('idle');
        if (pendingStopRef.current) {
          pendingStopRef.current.resolve(transcriptRef.current);
          pendingStopRef.current = null;
        }
      }),
    ];

    return () => {
      subs.forEach(s => s.remove());
      if (partialTimer) clearTimeout(partialTimer);
    };
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current === 'listening') return;
    if (!VoiceModule) {
      setError('Voice 模块未注册');
      return;
    }
    setError(null);
    setTranscript('');
    transcriptRef.current = ''; // ★ 同步清空，避免上一轮转写残留到本轮
    try {
      VoiceModule.startSpeech('zh-CN', (err: any) => {
        if (err) {
          setError(String(err));
          setState('error');
        }
      });
    } catch (e: any) {
      setError(e?.message ?? '启动失败');
      setState('error');
    }
  }, []);

  const pendingStopRef = useRef<{ resolve: (t: string) => void } | null>(null);

  const stop = useCallback(async () => {
    if (!VoiceModule) return transcriptRef.current;
    try {
      VoiceModule.stopSpeech(() => {});
    } catch (e: any) {
      setState('idle');
      return transcriptRef.current;
    }
    return new Promise<string>((resolve) => {
      pendingStopRef.current = { resolve };
      setTimeout(() => {
        if (pendingStopRef.current) {
          pendingStopRef.current.resolve(transcriptRef.current);
          pendingStopRef.current = null;
        }
      }, 800);
    });
  }, []);

  return { state, transcript, error, start, stop, isAvailable, peek: () => transcriptRef.current };
}
