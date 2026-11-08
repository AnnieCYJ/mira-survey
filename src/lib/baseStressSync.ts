/**
 * ★ 2026-11-07（用户：「把压力这个改了，压力还没同步」）
 *
 * ── 事实先摆清楚（dex + SDK 源码双向实证，不靠猜）────────────────────────
 *  · 这枚 LunaMira 精简版能力包 `StressType=2` = 硬件/固件**支持压力**。
 *  · 但已装 APK 的原生桥只走 v3/v5 原始数据：onBatch slot 实测字段全集是
 *    `hr, bpDia, bpSys, spo2, hrv, t`（见 docs/RING_DEVICE_CAPABILITY_MATRIX.md），
 *    **没有 pressure / stress**。反编译 classes4.dex 也确认原生模块没有
 *    `readDeviceManualData`；SDK 里压力的真实通道是
 *    `readDeviceManualData(STRESS) → onPressureManualDataChange(PressureManualData.pressure 0–100)`
 *    （Android Demo: DeviceManualTestDataActivity.java:205/285）。
 *  · 也就是说：设备里存着压力测量记录，但当前 APK 没有把它们读出来。
 *    原生重编译被 build-debug.sh 的护栏挡住（磁盘 VeepooRingModule.kt 是 394 行旧桩，
 *    完整实现只在 classes4.dex，缺前 299 行源码）——见 docs/native-patches/。
 *
 * ── 本模块做什么（纯 JS、可立即生效、且诚实）────────────────────────────
 *  每次戒指同步完成后，用**这枚戒指真实回传**的 HRV / 心率 / 血压逐点读数，
 *  按个人基线生成「压力参考值」并落库，标记 `derived: true`，
 *  让首页「身心压力」、压力详情页、压力分布/压力时段、恢复力等整条链路真正有数据。
 *  · 只写真实读数所在的时间点，不插值、不补点、不拿时间外推。
 *  · UI 各处必须标注「推算 / 非设备直测」；设置页「数据实况」也如实分开写
 *    「设备直传 0 点」与「App 推算 N 点」。
 *  · **设备实测永远优先**：一旦原生补上 STRESS 通道（slot 出现 stress/pressure
 *    字段，或该日已有非 derived 的 stress 样本），本模块自动让位，不再覆盖实测值。
 *
 * ── 机型隔离（用户明确要求：只改 LunaMira 基础版 UI）──────────────────────
 *  · 只有当前 Profile = BASE_UI 才运行；PRO_UI（HK18 / Luna Mira Pro）直接 return，
 *    压力仍走它自己的设备实测链路，一个数值都不动。
 *  · 已知 HK18 的 MAC 在 DEVICE_ID_PROFILES 里硬排除，杜绝两枚戒指数据混算。
 */
import { healthStore, normalizeDayKey } from '../data/healthStore';
import {
  DEFAULT_DEVICE_PROFILE,
  DEVICE_ID_PROFILES,
  getDeviceProfileId,
  subscribeProfileChange,
  type DeviceProfileId,
} from '../config/deviceModel';

/** Profile 的同步缓存：让 backfillDone 这条同步链路能当场判断机型，不必 await。 */
let profileCache: DeviceProfileId = DEFAULT_DEVICE_PROFILE;
try {
  void getDeviceProfileId().then((p) => { profileCache = p; }).catch(() => {});
  subscribeProfileChange((p) => { profileCache = p; });
} catch { /* 读盘失败保持默认 BASE_UI，不静默升级成全功能 */ }

export interface StressSyncResult {
  ran: boolean;
  reason: string;
  days: number;
  points: number;
}

interface Pt { t: number; v: number }

const VALID = {
  hr: [30, 220],
  hrv: [1, 300],
  bpSys: [60, 250],
} as const;
type PhysKey = keyof typeof VALID;
/** 有效读数配对窗口：设备约 30 分钟一点，20 分钟足以配上同一轮测量 */
const PAIR_WINDOW_MS = 20 * 60_000;

function clean(metric: PhysKey, dks: string[]): Pt[] {
  const [lo, hi] = VALID[metric];
  const out: Pt[] = [];
  for (const dk of dks) {
    let pts: Pt[] = [];
    try { pts = healthStore.getIntraday(metric, dk) as Pt[]; } catch { continue; }
    for (const p of pts) {
      if (Number.isFinite(p?.t) && Number.isFinite(p?.v) && p.v >= lo && p.v <= hi) out.push(p);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function stats(xs: number[]): { mean: number; sd: number } | null {
  if (xs.length < 5) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, sd: Math.sqrt(varr) };
}

/** 取窗口内离 t 最近的一个读数（不插值）。 */
function nearest(pts: Pt[], t: number): number | null {
  let best: number | null = null;
  let bestDt = Infinity;
  for (const p of pts) {
    const dt = Math.abs(p.t - t);
    if (dt > PAIR_WINDOW_MS) continue;
    if (dt < bestDt) { bestDt = dt; best = p.v; }
  }
  return best;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const z = (v: number | null, s: { mean: number; sd: number } | null, sign = 1): number => {
  if (v == null || !s || s.sd < 1e-6) return 0;
  return clamp(sign * (v - s.mean) / s.sd, -2, 2);
};

/**
 * 在戒指同步完成后调用（RingBleManager.handleStateV2 的 backfillDone 分支）。
 *
 * @param dayKeys    需要覆盖的日期（本机近 3 天 + 本次 onBatch 实收日期）
 * @param deviceId   当前连接戒指 MAC（机型硬隔离用）
 * @param slotKeys   本次 onBatch 固件原始字段全集（判断原生 STRESS 通道是否已通）
 */
export function syncBaseStress(
  dayKeys: string[],
  deviceId?: string | null,
  slotKeys?: string[],
): StressSyncResult {
  // ① 机型门禁：PRO_UI 完全不碰
  if (profileCache !== 'BASE_UI') return { ran: false, reason: 'PRO_UI：保留设备实测压力链路', days: 0, points: 0 };
  // ② 已知全量版 MAC 硬排除（用户强调两枚戒指不能混）
  const id = String(deviceId ?? '').trim().toUpperCase();
  if (id && DEVICE_ID_PROFILES[id] && DEVICE_ID_PROFILES[id] !== 'BASE_UI') {
    return { ran: false, reason: '已知 PRO_UI 设备，跳过', days: 0, points: 0 };
  }
  // ③ 设备实测优先：原生 STRESS 通道一旦接通就整体让位
  if ((slotKeys ?? []).some((k) => /^(stress|pressure|pressureValue|stressValue|stressIndex)$/i.test(k))) {
    return { ran: false, reason: '本批 slot 已含设备实测压力，改用实测', days: 0, points: 0 };
  }

  const dks = Array.from(new Set((dayKeys ?? []).map((d) => normalizeDayKey(String(d)))))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dks.length === 0) return { ran: false, reason: '无有效日期', days: 0, points: 0 };

  const hrAll = clean('hr', dks);
  const hrvAll = clean('hrv', dks);
  const bpAll = clean('bpSys', dks);
  const sHr = stats(hrAll.map((p) => p.v));
  const sHrv = stats(hrvAll.map((p) => p.v));
  const sBp = stats(bpAll.map((p) => p.v));
  if (!sHr && !sHrv) return { ran: false, reason: '这枚戒指尚无 HR/HRV 有效读数', days: 0, points: 0 };

  let days = 0;
  let points = 0;
  for (const dk of dks) {
    // 该日已有设备实测压力 → 不覆盖、不改标
    const existing = healthStore.getIntraday('stress', dk);
    if (existing.length > 0 && !healthStore.isDerivedDay('stress', dk)) continue;

    const dayStart = new Date(`${dk}T00:00:00`).getTime();
    if (Number.isNaN(dayStart)) continue;
    const dayEnd = dayStart + 86_400_000;

    // 时间点 = 这枚戒指当天真实读数时刻的并集（1 分钟精度去重），不凭空造点
    const ts = new Set<number>();
    for (const arr of [hrAll, hrvAll, bpAll]) {
      for (const p of arr) {
        if (p.t >= dayStart && p.t < dayEnd) ts.add(Math.floor(p.t / 60_000) * 60_000);
      }
    }
    const out: Pt[] = [];
    for (const t of Array.from(ts).sort((a, b) => a - b)) {
      const hr = nearest(hrAll, t);
      const hrv = nearest(hrvAll, t);
      const bp = nearest(bpAll, t);
      if (hr == null && hrv == null) continue;
      // 心率↑ / HRV↓ / 收缩压↑ → 压力↑；50 = 个人平时水平，权重与分档沿用项目既有 0–100 口径
      const score = 50
        + 18 * z(hr, sHr, +1)
        + 18 * z(hrv, sHrv, -1)
        + 6 * z(bp, sBp, +1);
      out.push({ t, v: Math.round(clamp(score, 1, 99)) });
    }
    if (out.length === 0) continue;
    // ★ derived: true 是诚实口径的关键：healthStore 会打 derivedDays 标记，
    //   详情页 / 设置页据此标注「推算，非戒指实测」，不会被当成临床读数。
    healthStore.upsertBackfillSamples('stress', dk, out, { derived: true });
    days += 1;
    points += out.length;
  }
  return { ran: true, reason: '基于 HRV / 心率 / 血压实测读数推算（非设备直测）', days, points };
}

/** 供设置页「数据实况」判断这批压力点的来源，避免把推算写成设备同步。 */
export function isBaseStressDerived(dayKeys: string[]): boolean {
  return dayKeys.some((d) => healthStore.isDerivedDay('stress', normalizeDayKey(String(d))));
}
