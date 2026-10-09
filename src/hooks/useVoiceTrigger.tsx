import React, { createContext, useContext, useCallback, useState, useRef } from 'react';

export interface VoiceOpenOptions {
  /**
   * silent = 不弹底部「正在聆听…」浮层，改由**页面内常驻气泡**呈现录音态。
   * 目前用于首页：长按右下 GROK → 内容直接显示在趋势图下方的常驻 AI 气泡里。
   */
  silent?: boolean;
}

interface VoiceTriggerValue {
  visible: boolean;
  /** 本次录音是否为「就地显示」模式（不弹浮层，由常驻气泡消费 liveText） */
  inlineMode: boolean;
  /** 录音过程中的实时转写文本（供常驻气泡显示） */
  liveText: string;
  setLiveText: (t: string) => void;
  /**
   * 最近一次录音的最终转写（松手后保留，不清空）。
   * 用途：长按 GROK 松手 → 跳转 VoiceChat 的「释放→导航」窗口内，以及从 VoiceChat 返回首页时，
   * 常驻气泡显示这句转写（紫字），**而不是回退到常态占位文案**，
   * 避免跳转瞬间的占位闪现、也让返回首页时不再重复问同一句。
   */
  spokenText: string;
  /**
   * 清空保留的最终转写。
   * 用途（2026-10-08）：首页建议卡点了「留下 / 没啥感觉」并收回后，
   * 气泡必须回到常态占位「可以和我聊聊你的感受吗？」——若此时还留着上一轮的
   * 语音转写，气泡会继续显示那句话而不是占位文案，故在收回时显式清掉。
   */
  clearSpoken: () => void;
  /** 由浮层松手后调用，把转写文字传出去 */
  onReleaseRef: React.MutableRefObject<((text: string) => void) | null>;
  open: (onRelease: (text: string) => void, opts?: VoiceOpenOptions) => void;
  close: () => void;
}

const VoiceTriggerContext = createContext<VoiceTriggerValue | null>(null);

export function VoiceTriggerProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [inlineMode, setInlineMode] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const onReleaseRef = useRef<((text: string) => void) | null>(null);

  const open = useCallback((onRelease: (text: string) => void, opts?: VoiceOpenOptions) => {
    onReleaseRef.current = onRelease;
    setInlineMode(!!opts?.silent);
    setLiveText(''); // 每次开录清空上一轮实时残字
    setSpokenText(''); // 开录也清空上一轮最终转写，避免遗留
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    // ★ 保留最终转写到 spokenText：松手瞬间先让气泡显示「你说的话」，再跳转（不再回退占位文案）
    setSpokenText((prev) => (liveText && liveText.trim() ? liveText.trim() : prev));
    setVisible(false);
    setLiveText('');
  }, [liveText]);

  // 清空保留的最终转写（首页建议卡收回时调用 → 气泡回到常态占位）
  const clearSpoken = useCallback(() => setSpokenText(''), []);

  return (
    <VoiceTriggerContext.Provider
      value={{ visible, inlineMode, liveText, setLiveText, spokenText, clearSpoken, onReleaseRef, open, close }}
    >
      {children}
    </VoiceTriggerContext.Provider>
  );
}

export function useVoiceTrigger(): VoiceTriggerValue {
  const ctx = useContext(VoiceTriggerContext);
  if (!ctx) throw new Error('useVoiceTrigger must be inside VoiceTriggerProvider');
  return ctx;
}
