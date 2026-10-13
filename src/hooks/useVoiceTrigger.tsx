import React, { createContext, useContext, useCallback, useMemo, useRef, useState } from 'react';

export interface VoiceOpenOptions {
  /**
   * silent = 不弹底部「正在聆听…」浮层，改由**页面内常驻气泡**呈现录音态。
   * 目前用于首页：长按右下 GROK → 内容直接显示在趋势图下方的常驻 AI 气泡里。
   */
  silent?: boolean;
}

/**
 * ★ 2026-10-12（用户：点 GROK / 语音 / 跳转 AI 页都特别卡）：
 * context 拆成两个——
 *  · VoiceTriggerApi（open/close/onReleaseRef/clearSpoken）：**引用永远稳定**，
 *    给 CustomTabBar 等只触发录音、不展示转写的组件订阅；
 *  · VoiceTriggerLive（visible/inlineMode/liveText/spokenText/setLiveText）：
 *    随录音态**高频变化**，只给真正展示转写的组件（HomeAiBubble / VoiceQuickOverlay）订阅。
 * 旧实现合成一个 context：liveText 每 250ms 变一次 → 所有 consumer（含整个
 * CustomTabBar：笑脸动画 + 5 个 tab）全量重渲染，叠加端侧模型推理直接卡成幻灯片。
 */
interface VoiceTriggerApi {
  open: (onRelease: (text: string) => void, opts?: VoiceOpenOptions) => void;
  close: () => void;
  clearSpoken: () => void;
  onReleaseRef: React.MutableRefObject<((text: string) => void) | null>;
}

interface VoiceTriggerLive {
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
}

const VoiceTriggerApiContext = createContext<VoiceTriggerApi | null>(null);
const VoiceTriggerLiveContext = createContext<VoiceTriggerLive | null>(null);

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

  // liveText 的 ref 镜像：close 不能依赖 liveText（否则 api 引用每 250ms 就变，
  // 拆 context 的意义就没了）——松手时经 ref 读最新值，语义完全一致。
  const liveTextRef = useRef('');
  liveTextRef.current = liveText;

  const close = useCallback(() => {
    // ★ 保留最终转写到 spokenText：松手瞬间先让气泡显示「你说的话」，再跳转（不再回退占位文案）
    const cur = liveTextRef.current;
    setSpokenText((prev) => (cur && cur.trim() ? cur.trim() : prev));
    setVisible(false);
    setLiveText('');
  }, []);

  // 清空保留的最终转写（首页建议卡收回时调用 → 气泡回到常态占位）
  const clearSpoken = useCallback(() => setSpokenText(''), []);

  // 稳定 API：引用不变 → 只订阅它的组件（CustomTabBar）永不因转写推进而重渲染
  const api = useMemo<VoiceTriggerApi>(
    () => ({ open, close, clearSpoken, onReleaseRef }),
    [open, close, clearSpoken],
  );
  // 高频直播态：只给真正渲染转写的组件订阅
  const live = useMemo<VoiceTriggerLive>(
    () => ({ visible, inlineMode, liveText, setLiveText, spokenText, clearSpoken }),
    [visible, inlineMode, liveText, spokenText, clearSpoken],
  );

  return (
    <VoiceTriggerApiContext.Provider value={api}>
      <VoiceTriggerLiveContext.Provider value={live}>{children}</VoiceTriggerLiveContext.Provider>
    </VoiceTriggerApiContext.Provider>
  );
}

/** 只拿稳定 API（open/close/…）——订阅它不会因录音转写推进而重渲染 */
export function useVoiceTriggerApi(): VoiceTriggerApi {
  const ctx = useContext(VoiceTriggerApiContext);
  if (!ctx) throw new Error('useVoiceTriggerApi must be inside VoiceTriggerProvider');
  return ctx;
}

/** 拿高频直播态（visible/liveText/spokenText/…）——仅展示转写的组件用 */
export function useVoiceTriggerLive(): VoiceTriggerLive {
  const ctx = useContext(VoiceTriggerLiveContext);
  if (!ctx) throw new Error('useVoiceTriggerLive must be inside VoiceTriggerProvider');
  return ctx;
}

/** 兼容入口：同时拿 API + 直播态（等价旧 useVoiceTrigger 全量返回） */
export function useVoiceTrigger(): VoiceTriggerApi & VoiceTriggerLive {
  return { ...useVoiceTriggerApi(), ...useVoiceTriggerLive() };
}
