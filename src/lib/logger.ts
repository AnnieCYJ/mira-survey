/**
 * 独立 logger — 零依赖, 所有模块都可以安全 import
 * 避免循环依赖 (RingBleManager ↔ emotionEngine)
 */
import { NativeModules } from 'react-native';

let _logHost: string | null = null;

function getLogHost(): string {
  if (_logHost) return _logHost;
  try {
    const scriptURL = (NativeModules as any).SourceCode?.scriptURL as string | undefined;
    if (scriptURL) {
      const host = new URL(scriptURL).hostname;
      if (host) { _logHost = host; return host; }
    }
  } catch { /* ignore */ }
  _logHost = 'localhost';
  return _logHost;
}

/** 向 Mac 上的 :8899/log POST 一条日志 (dev 调试用) */
export function postLog(tag: string, msg: string) {
  try {
    fetch(`http://${getLogHost()}:8899/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, msg }),
    }).catch(() => {});
  } catch { /* 静默 */ }
}
