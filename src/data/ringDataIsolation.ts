/**
 * 戒指数据源隔离 —— ★ 2026-11-05（用户拍板）
 *
 * 「HK18 / 上一枚戒指」与「现在这枚 LunaMira 基础版」是两套完全不同的数据源，
 * 绝不能混显、不能互相兜底、更不能拿旧戒指的历史值冒充当前戒指的实测值。
 *
 * 实锤依据（2026-11-05 直查 Cloudflare D1）：
 *   · device_id `41:42:E7:17:9B:1C` = 当前 LunaMira 基础版（用户确认的 MAC）
 *   · device_id `C9:00:9C:D7:C2:D8` = 旧设备（HK18 时期），两枚 ID 的 11-02 / 11-03
 *     auto_data 逐字段完全相同（steps 546、hr 74.0346…、temp 36.6418…、eda 93.5124…），
 *     说明旧版本曾把同一批本地历史归档同时写到两个 device_id —— 这正是混数据的根因。
 *   · 11-05 全库 0 条新记录（max(ts) = 2026-11-04 00:00 UTC），health_glance 表为空，
 *     gsr 表只有 sns / source / samples，没有 skin_moisture，更没有 EDA 逐点值。
 *   · demo-mira-00x / test-diag-001 是演示与诊断数据，真机展示链路一律不得读取。
 *
 * 协议依据（VeepooBleSDK.framework/Headers + UniApp SDK 文档）：
 *   · VPGSRResultModel 只有 emotion_level / skin_moisture(皮肤含水量 1–99) /
 *     depression_risk / sns_activation(1–99) / cortisol_value —— **没有 EDA(皮肤电导)**。
 *     旧代码把 skin_moisture 命名为 `eda` 是错的，基础版不再展示皮电。
 *   · 温度只有一条真实链路：bodyTemperature / orgTemperature(原始温度=体表温度)，
 *     由 VPPeripheralModel.temperatureType 决定设备是否支持。当前戒指在
 *     auto_data.temp_daily_mean 回读 36.15–36.93℃ 的真实日均体温；
 *     **没有独立的皮肤温度数据流**（health_glance 空 / gsr 无温度）。
 *   · VPAutoMonitTestModel 的 VPAutoMonitTestTypeBodyTemperature 是同一路体温自动监测。
 *
 * 结论（本模块对外口径）：
 *   ❌ 无：EDA 皮电、独立皮肤温度、健康一览 temp、gsr 里的温度
 *
 * ★ 2026-11-07 修正：上面「✅ 有：体温（日均，℃）」这条**已作废**。
 *   它是从 HK18 时期的云端 auto_data.temp_daily_mean 反推的，而那批数据
 *   与当前戒指的 device_id 混在一起（本文件开头已证实两个 ID 的记录逐字段相同）。
 *   真机能力包（见 docs/RING_DEVICE_CAPABILITY_MATRIX.md）明确：
 *   `体温 Temp : 不支持 (type=0)`、`体温告警=不支持`，
 *   且 onBatch 逐点 slot 字段全集里没有 temp。
 *   → 当前 LunaMira 精简版**没有体温**，UI 不得展示，也不得拿旧归档兜底。
 */
import {
  ALL_NATIVE_METRIC_KEYS,
  DEFAULT_DEVICE_PROFILE,
  getProfile,
  getStoredDeviceInfo,
} from '../config/deviceModel';

/** 当前在用的 LunaMira 基础版 MAC（用户 2026-11-05 确认） */
export const CURRENT_BASE_RING_ID = '41:42:E7:17:9B:1C';

/** 旧设备 / HK18 时期的 device_id —— 明确禁止进入当前戒指的读取与展示链路 */
export const LEGACY_RING_IDS: readonly string[] = ['C9:00:9C:D7:C2:D8'];

/** 演示 / 诊断数据前缀，任何真机展示链路都不得读取 */
export const NON_REAL_DEVICE_PREFIXES: readonly string[] = ['demo-', 'test-diag-'];

export function normDeviceId(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

/** 该 device_id 是否属于「禁止混进当前戒指」的来源 */
export function isBlockedRingDeviceId(v: unknown): boolean {
  const id = normDeviceId(v);
  if (!id) return true;
  if (LEGACY_RING_IDS.some((x) => normDeviceId(x) === id)) return true;
  if (NON_REAL_DEVICE_PREFIXES.some((p) => id.startsWith(p.toUpperCase()))) return true;
  return false;
}

/**
 * 当前可信戒指 device_id：
 *   优先用连接时持久化下来的 MAC；没读到时兜底用户确认的基础版 MAC。
 *   若读到的是旧 HK18 / 演示 ID，返回 null（宁可不出值，绝不混显）。
 */
export async function trustedCurrentRingDeviceId(): Promise<string | null> {
  let stored: string | null = null;
  try {
    const info = await getStoredDeviceInfo();
    stored = normDeviceId(info.deviceId) || null;
  } catch {
    stored = null;
  }
  const id = stored || CURRENT_BASE_RING_ID;
  return isBlockedRingDeviceId(id) ? null : id;
}

/**
 * 体温合法性校验：协议 bodyTemperature 单位 ℃，正常约 36.0–37.2。
 * 超出 [34, 42] 的一律视为脏数据（旧戒指遗留 / 单位未换算 / 原始值），返回 null 不展示。
 */
export function saneBodyTemp(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n >= 34 && n <= 42 ? n : null;
}

/**
 * 基础版禁止回退到本机 healthStore 历史归档的指标。
 * healthStore 里混着 HK18 时期写入的 temp / skinTemp / eda 值（详情页曾显示 39℃），
 * 与当前戒指无关。这些指标只允许用 ring.metrics / ring.daily 的当前戒指日值。
 *
 * ★ v18.134（审查 03 🔵#22）：改为**从 deviceModel 自动派生** ——
 *   凡基础版 Profile（BASE_UI）的 nativeMetrics 不含的原生指标，一律拉黑。
 *   以后在 NATIVE_METRIC_CATALOG 新增 Pro 专属指标（如 bloodGlucose）时，
 *   只要不加进 BASE_NATIVE_METRICS 就会自动进黑名单，不再依赖手工同步。
 */
export const LEGACY_HISTORY_BLOCKED_KEYS: readonly string[] = (() => {
  // 显式保留的历史键：协议语义上属「只此一路、别处兜底」的数据流，
  // 即使基础版 nativeMetrics 变化也不允许从 healthStore 历史归档回填。
  const manual: readonly string[] = ['temp', 'skinTemp', 'eda', 'skin'];
  // 基础版原生不支持的指标（= 全集减去 BASE_UI nativeMetrics）自动拉黑
  const baseMetrics = getProfile(DEFAULT_DEVICE_PROFILE).nativeMetrics;
  const auto = ALL_NATIVE_METRIC_KEYS.filter((k) => !baseMetrics.includes(k));
  return Array.from(new Set<string>([...manual, ...auto]));
})();
