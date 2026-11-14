/**
 * 独立 logger — 零依赖, 所有模块都可以安全 import
 * 避免循环依赖 (RingBleManager ↔ emotionEngine)
 */
import { NativeModules, Platform } from 'react-native';
import * as FS from 'expo-file-system';

// ★★ 同步写日志到 Documents/JS_LOG.txt（不依赖 HTTP）
// expo-file-system 17 无 append 接口，改为「读旧 + 拼新 + 写回」实现追加。
async function writeLogFile(tag: string, msg: string) {
  try {
    const dir = FS.documentDirectory;
    if (!dir) return;
    const path = dir + 'JS_LOG.txt';
    let prev = '';
    try {
      const info = await FS.getInfoAsync(path);
      if (info.exists) prev = await FS.readAsStringAsync(path);
    } catch {}
    const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
    await FS.writeAsStringAsync(path, prev + line);
  } catch {}
}

let _logHost: string | null = null;

function getLogHost(): string {
  // ★ 硬编码 Mac IP（真机 localhost ≠ Mac），Dev 调试用
  return '192.168.1.10';
}

/** 向 Mac 上的 :8899/log POST 一条日志 (dev 调试用) */
export function postLog(tag: string, msg: string, ...extra: any[]) {
  // ★ 限流：日志风暴时避免每行都 fetch 把 :8899 收集器打爆（见 RingBleManager 同款说明）。
  //   ★ 诊断类日志豁免（否则看不到离线同步/步数链路）。
  let fullMsg = msg;
  if (extra.length > 0) {
    fullMsg = msg + ' ' + extra.map((e) => (typeof e === 'string' ? e : safeStringify(e))).join(' ');
  }
  const now = Date.now();
  const important = /\[(BACKFILL|CHAIN|RECOVER|FMDB|STEP|handleStepDay|handleSleepDay|AUTO-MONIT|连接状态)\]/i.test(fullMsg);
  if (!important) {
    if (now - _lastPostAt < 250) return;
    _lastPostAt = now;
  }
  try {
    fetch(`http://${getLogHost()}:8899/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, msg: fullMsg }),
    }).catch(() => {});
  } catch { /* 静默 */ }
  // ★★ 同时写文件
  writeLogFile(tag, fullMsg);
}

function safeStringify(e: any): string {
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

let _lastPostAt = 0;
