/**
 * App 内「检查更新」（Android / P30 离线包）
 * ---------------------------------------------------------------------------
 * 链路：
 *   1. 读版本清单 update.json（几百字节，静态托管即可）
 *   2. 用 versionCode 比对，> 当前版本就显示「发现新版本」
 *   3. 点下载 → 交给系统浏览器下载 APK → 系统安装器接管
 *
 * 为什么不让 App 自己下载后静默安装：Android 7+ 禁止 App 用 file:// 直接安装，
 * 需要 FileProvider + REQUEST_INSTALL_PACKAGES，且系统仍会弹一次用户确认。
 * 用系统浏览器下载是最稳的一条：支持大文件断点续传，安装包由系统校验签名，
 * 覆盖安装时数据（healthStore / RingState 文件）也不会丢。
 *
 * 清单格式（由 scripts/publish-apk-update.mjs 生成）：
 *   {
 *     "versionCode": 3,
 *     "versionName": "1.1.1",
 *     "apkUrl": "https://.../mira-app-1.1.1-3.apk",
 *     "sizeBytes": 123456789,
 *     "sha256": "...",
 *     "notes": "回填通路修复 + 检查更新",
 *     "releasedAt": "2026-11-09T16:00:00+08:00"
 *   }
 */

import { Linking, NativeModules, DeviceEventEmitter } from 'react-native';
import { UPDATE_MANIFEST_URL } from '../config';
import { APP_VERSION_CODE, APP_VERSION_NAME } from '../version';

export interface AppUpdateInfo {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sizeBytes?: number;
  sha256?: string;
  notes?: string;
  releasedAt?: string;
}

export type UpdateCheckResult =
  | { state: 'latest'; current: string }
  | { state: 'available'; current: string; info: AppUpdateInfo }
  | { state: 'error'; message: string };

/** 正式清单读不到时，退回 adb reverse 到本机的调试清单（仅开发期有用，生产无副作用）。 */
const DEV_FALLBACK_URL = 'http://127.0.0.1:8765/update.json';

async function fetchManifest(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 检查更新。正式清单 404 / 不可达时再试本机调试清单，任一成功即用。 */
export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const current = `${APP_VERSION_NAME} (${APP_VERSION_CODE})`;
  const primary: string = UPDATE_MANIFEST_URL;
  const urls = [primary, ...(primary !== DEV_FALLBACK_URL ? [DEV_FALLBACK_URL] : [])];
  let manifest: any = null;
  for (const u of urls) {
    manifest = await fetchManifest(u);
    if (manifest) break;
  }
  if (!manifest) {
    return {
      state: 'error',
      message: '还没读到更新清单。发布一次新包后就能检查（清单地址见 src/config.ts）',
    };
  }
  const code = Number(manifest.versionCode);
  if (!Number.isFinite(code) || typeof manifest.apkUrl !== 'string' || !manifest.apkUrl) {
    return { state: 'error', message: '更新清单格式不正确（缺 versionCode / apkUrl）' };
  }
  if (code <= APP_VERSION_CODE) return { state: 'latest', current };
  return {
    state: 'available',
    current,
    info: {
      versionCode: code,
      versionName: String(manifest.versionName ?? code),
      apkUrl: manifest.apkUrl,
      sizeBytes: Number(manifest.sizeBytes) || undefined,
      sha256: manifest.sha256 ? String(manifest.sha256) : undefined,
      notes: manifest.notes ? String(manifest.notes) : undefined,
      releasedAt: manifest.releasedAt ? String(manifest.releasedAt) : undefined,
    },
  };
}

/** 体积友好展示 */
export function formatApkSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(0)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

/** 打开 APK 下载地址，交给系统浏览器 + 系统安装器（作为原生模块不可用时的兜底）。 */
export async function openApkDownload(apkUrl: string): Promise<void> {
  await Linking.openURL(apkUrl);
}

export interface DownloadProgress {
  /** 0–100 */
  progress: number;
  bytes: number;
  total: number;
}

/**
 * ★ 2026-11-10：App 内直接下载并安装（替代「跳系统浏览器」中转）。
 * 调原生 AppUpdater.downloadAndInstall：下载到私有目录 → FileProvider → 拉起系统安装器；
 * 下载进度经 AppUpdaterProgress 事件回传。原生模块不可用（如 iOS / 未链接）时退回浏览器下载。
 * 注意：安装仍需用户在系统弹窗点一次「安装」（Android 8+ 安全要求，无法绕过）。
 */
export function downloadAndInstallApk(
  apkUrl: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const updater = (NativeModules as Record<string, any>).AppUpdater;
  if (!updater || typeof updater.downloadAndInstall !== 'function') {
    return openApkDownload(apkUrl);
  }
  const sub = onProgress
    ? DeviceEventEmitter.addListener('AppUpdaterProgress', (e: any) => {
        onProgress({
          progress: Number(e?.progress ?? 0),
          bytes: Number(e?.bytes ?? 0),
          total: Number(e?.total ?? 0),
        });
      })
    : null;
  return Promise.resolve(updater.downloadAndInstall(apkUrl))
    .then(() => {
      sub?.remove();
    })
    .catch((err) => {
      sub?.remove();
      // 原生失败时退回浏览器，保证「检查到更新就一定下得动」
      return openApkDownload(apkUrl);
    });
}
