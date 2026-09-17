import React, { createContext, useContext, useCallback, useState, useRef } from 'react';

interface VoiceTriggerValue {
  visible: boolean;
  /** 由浮层松手后调用，把转写文字传出去 */
  onReleaseRef: React.MutableRefObject<((text: string) => void) | null>;
  open: (onRelease: (text: string) => void) => void;
  close: () => void;
}

const VoiceTriggerContext = createContext<VoiceTriggerValue | null>(null);

export function VoiceTriggerProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const onReleaseRef = useRef<((text: string) => void) | null>(null);

  const open = useCallback((onRelease: (text: string) => void) => {
    onReleaseRef.current = onRelease;
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <VoiceTriggerContext.Provider value={{ visible, onReleaseRef, open, close }}>
      {children}
    </VoiceTriggerContext.Provider>
  );
}

export function useVoiceTrigger(): VoiceTriggerValue {
  const ctx = useContext(VoiceTriggerContext);
  if (!ctx) throw new Error('useVoiceTrigger must be inside VoiceTriggerProvider');
  return ctx;
}
