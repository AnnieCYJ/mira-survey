/**
 * 独立 logger — 零依赖, 所有模块都可以安全 import
 * 避免循环依赖 (RingBleManager ↔ emotionEngine)
 */
import { NativeModules, Platform } from 'react-native';
import * as FS from 'expo-file-system';

// ★★ 同步写日志到 Documents/JS_LOG.txt（不依赖 HTTP）
async function writeLogFile(tag: string, msg: string) {
  try {
    const path = FS.DocumentDirectoryPath + '/JS_LOG.txt';
    const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
    await FS.appendAsStringAsync(path, line);
  } catch {}
}

let _logHost: string | null = null;

function getLogHost(): string {
  // ★ 硬编码 Mac IP（真机 localhost ≠ Mac），Dev 调试用
  return '192.168.1.10';
}

/** 向 Mac 上的 :8899/log POST 一条日志 (dev 调试用) */
export function postLog(tag: string, msg: string) {
  // ★ 限流：日志风暴时避免每行都 fetch 把 :8899 收集器打爆（见 RingBleManager 同款说明）。
  //   ★ 诊断类日志豁免（否则看不到离线同步/步数链路）。
  const now = Date.now();
  const important = /\[(BACKFILL|CHAIN|RECOVER|FMDB|STEP|handleStepDay|handleSleepDay|AUTO-MONIT|连接状态)\]/i.test(msg);
  if (!important) {
    if (now - _lastPostAt < 250) return;
    _lastPostAt = now;
  }
  try {
    fetch(`http://${getLogHost()}:8899/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, msg }),
    }).catch(() => {});
  } catch { /* 静默 */ }
  // ★★ 同时写文件
  writeLogFile(tag, msg);
}

let _lastPostAt = 0;
