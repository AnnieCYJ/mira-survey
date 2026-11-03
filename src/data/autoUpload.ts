/**
 * 自动上传云端（App → 你的数据平台 data.lunamiraring.com）。
 *
 * 设计要点：
 *  - 与「数据同步」（戒指→本机 backfill）开关解耦：这是本机→云端的独立开关。
 *  - 触发条件：① App 在前台每约 4 小时一次；② 每次 App 从后台回到前台时，若距上次上传超过 3 小时则补传。
 *  - 由独立开关 `autoUploadEnabled`（默认开）控制；关闭则完全不自动上传（手动按钮仍可）。
 *  - 不依赖 iOS Background Fetch（避免过度工程）：仅在 App 活跃期与回到前台时跑，符合「三五个小时传一次」诉求。
 *  - 并发守卫：inFlight 防止手动 + 自动 + 定时器叠加。
 */
import { AppState, type AppStateStatus } from 'react-native';
import { RingBle } from '../ble/RingBleManager';
import { uploadSelfReports } from './selfReportSync';
import { getLocalDeviceId } from './ringIdentity';
import * as AsyncStorage from '../utils/prefs';

const AUTO_UPLOAD_INTERVAL_MS = 4 * 60 * 60 * 1000; // 前台定时：每 4 小时
const MIN_GAP_SINCE_LAST_MS = 3 * 60 * 60 * 1000; // 回前台补传阈值：距上次 > 3 小时才传
const PREF_KEY = 'autoUploadEnabled';

let cachedEnabled: boolean | null = null;
let inFlight = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** 读取开关（带缓存，默认开）。 */
export async function getAutoUploadEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    cachedEnabled = v === '0' ? false : true; // 未设过 → 默认开
  } catch {
    cachedEnabled = true;
  }
  return cachedEnabled;
}

/** 写入开关。 */
export async function setAutoUploadEnabled(v: boolean): Promise<void> {
  cachedEnabled = v;
  try {
    await AsyncStorage.setItem(PREF_KEY, v ? '1' : '0');
  } catch {
    /* 持久化失败不阻断功能 */
  }
}

async function doUpload(reason: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const r = await RingBle.uploadRingData();
    if (r.ok && r.count > 0) {
      const st = RingBle.getState();
      await uploadSelfReports(st.deviceId || st.deviceName || (await getLocalDeviceId()));
      // 上传成功 → 重拉规律摘要（长窗口规律可能刚成立）
      try {
        const { syncPatterns } = await import('../ai/cloudPatterns');
        await syncPatterns({ deviceId: st.deviceId || st.deviceName || undefined, force: true });
      } catch {
        /* 拉规律失败不影响上传结论 */
      }
      // eslint-disable-next-line no-console
      console.log(`[autoUpload] ✅ ${reason} 上传成功 count=${r.count}`);
    } else if (!r.ok && r.error && r.error !== '暂无可导出的本地数据') {
      // eslint-disable-next-line no-console
      console.warn(`[autoUpload] ⚠️ ${reason} 上传失败: ${r.error}`);
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[autoUpload] ⚠️ ${reason} 异常: ${e?.message || e}`);
  } finally {
    inFlight = false;
  }
}

async function maybeUpload(reason: string): Promise<void> {
  if (!(await getAutoUploadEnabled())) return;
  const last = RingBle.getState().lastUploadedAt;
  const due = last == null || Date.now() - last > MIN_GAP_SINCE_LAST_MS;
  if (!due) return;
  await doUpload(reason);
}

let started = false;

/** App 启动时调用一次：挂定时器 + 回前台监听。返回清理函数。 */
export function initAutoUpload(): () => void {
  if (started) return () => {};
  started = true;

  // 首次进入（冷启动）若距上次 > 3h 也补一次
  void maybeUpload('cold-start');

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') void maybeUpload('foreground');
  };
  const sub = AppState.addEventListener('change', onAppState);
  timer = setInterval(() => void maybeUpload('interval'), AUTO_UPLOAD_INTERVAL_MS);

  return () => {
    started = false;
    sub.remove();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
