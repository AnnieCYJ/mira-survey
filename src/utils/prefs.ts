// ★ 2026-10-18：Expo Go 未内置 AsyncStorage 原生模块（[@RNC/AsyncStorage]: NativeModule
//   is null → 一读取设置项整个 App 崩溃）。改用 expo-file-system（Expo Go 全版本内置）
//   实现同接口轻量 KV，接口与 @react-native-async-storage/async-storage 一致：
//   getItem(key) → Promise<string|null> / setItem(key, value) → Promise<void>。
import * as FileSystem from 'expo-file-system';

const DIR = `${FileSystem.documentDirectory}prefs/`;
let dirReady: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  if (!dirReady) {
    // intermediates:true 一次性建好目录；已存在时 reject 也吞掉（幂等）
    dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
}

export async function getItem(key: string): Promise<string | null> {
  try {
    await ensureDir();
    return await FileSystem.readAsStringAsync(DIR + key);
  } catch {
    return null; // 文件不存在（首次运行）→ 视为未设置
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(DIR + key, value);
}
