/**
 * ★ 2026-11-04（用户定稿）：两套 Profile 架构 —— 设备能力真相源
 *
 * 核心规则（用户拍板）：
 *  1. 戒指只有两套配置：
 *       - PRO_UI  ＝ HK18 与 LUNA-MIRA-PRO 能力完全一致，共用完整版界面
 *       - BASE_UI ＝ LUNA-MIRA 基础版，是 PRO_UI 的精简版（直接删除基础版没有的功能，
 *                    不在 UI 上留灰锁/占位入口）
 *  2. 设备识别【不】依赖蓝牙广播名，而是基于「Veepoo SDK 连接后暴露的硬件能力字段」：
 *       VPPeripheralModel.temperatureType / gsrType / ecgType / bloodAnalysisType / healthGlanceType …
 *       —— 这些 *Type 字段才是「这枚戒指实际有什么硬件」的真相源。
 *       说明：原计划「读 BLE DIS 0x2A24 型号字符串」在 Veepoo SDK 下不可行（SDK 不暴露 0x2A24，
 *       仅暴露广播名/固件版本），故改为能力字段驱动（用户 2026-11-04 拍板）。
 *       分档规则：ecgType>0（有 ECG 硬件）→ PRO_UI（LunaMira Pro / HK18）；否则 BASE_UI（LunaMira 基础版）。
 *       体温/皮电等是否展示不再靠型号假设，前端按「实测到数据/能力字段」渲染（有就展示）。
 *       固件版本 0x2A26 仍仅用于对“已知 bug”临时屏蔽某项能力，绝不用于“开启硬件不存在的能力”。
 *  3. 两套 Profile 各自对应一套能力配置（nativeMetrics 决定展示哪些数据；features 决定
 *     哪些 Pro 专属组件存在）。前端按当前连接戒指的 Profile 加载完整版或精简版界面。
 *  4. 数据隔离：连 HK18 只看 HK18 的数据，连 LUNA-MIRA 只看 LUNA-MIRA 的数据，
 *     同一账户内两枚戒指的数据不混显（见文件底部「数据隔离」章节）。
 *
 * 本文件是“设备能力”的唯一真相源。所有功能入口（tab / 卡片 / 深链 / 上传型号标注）
 * 统一走 `hasCap(profile, 'ecg')` 与 `profile.nativeMetrics` 判断。
 */
import { useEffect, useState } from 'react';
import { NativeModules as NativeModulesRef } from 'react-native';
import * as Prefs from '../utils/prefs';

// ─────────────────────────────────────────────────────────────────────────────
// 0. 底层原生数据面（协议层全集）
//    这是 Veepoo 协议“硬件能吐出来”的全部指标 —— 也就是“底层介质会上传的数据”的全集。
//    各 Profile 的 `nativeMetrics` 只是这份全集的子集（基础版硬件不支持的，直接不出现在子集里）。
//    layer 标注该指标在原生侧如何到达 App：
//      'realtime'  = BLE notify 实时流（约 1Hz，onRealtime）
//      'backfill'  = 连接后/周期回读设备库（onBatch，按天归档）
//      'measure'   = 按需测量动作（如 ECG 测量、HealthGlance 快检），非持续流
// ─────────────────────────────────────────────────────────────────────────────
export type NativeMetricLayer = 'realtime' | 'backfill' | 'measure';

export interface NativeMetricSpec {
  key: string;
  label: string;
  layer: NativeMetricLayer;
  /** 是否由 BASE_UI 硬件原生支持（false = 仅 PRO_UI 有该传感器/功能） */
  proOnly?: boolean;
}

export const NATIVE_METRIC_CATALOG: NativeMetricSpec[] = [
  // —— 核心实时生命体征（realtime，BLE notify）——
  { key: 'hr', label: '心率', layer: 'realtime' },
  { key: 'spo2', label: '血氧', layer: 'realtime' },
  { key: 'hrv', label: '心率变异性', layer: 'realtime' },
  { key: 'rr', label: '呼吸率', layer: 'realtime' },
  { key: 'temp', label: '体温', layer: 'backfill' },                          // ★ 基础版实测回读含体温（temp_daily_mean）
  { key: 'skinTemp', label: '皮肤温度', layer: 'realtime', proOnly: true },   // ★ 基础版无独立皮肤温度
  { key: 'eda', label: '皮电 EDA', layer: 'backfill' },                        // ★ 基础版实测回读含皮电（eda_daily_mean）

  // —— 活动量（backfill，按天）——
  { key: 'steps', label: '步数', layer: 'backfill' },
  { key: 'distance', label: '距离', layer: 'backfill' },
  { key: 'calorie', label: '卡路里', layer: 'backfill' },

  // —— 健康评分/派生（backfill）——
  { key: 'stress', label: '压力', layer: 'backfill' },
  { key: 'fatigue', label: '疲劳', layer: 'backfill' },
  { key: 'sns', label: '交感神经', layer: 'backfill' },
  { key: 'met', label: '梅脱', layer: 'backfill' },

  // —— 血压估计（backfill / PPG 估计）——
  { key: 'bpSys', label: '收缩压', layer: 'backfill' },
  { key: 'bpDia', label: '舒张压', layer: 'backfill' },
  { key: 'ppgSys', label: 'PPG 收缩压', layer: 'backfill' },
  { key: 'ppgDia', label: 'PPG 舒张压', layer: 'backfill' },

  // —— 血液成分（backfill / HealthGlance 光谱；基础版按用户实测“有”血脂四项+尿酸+血糖）——
  { key: 'lipid', label: '血脂', layer: 'backfill' },
  { key: 'triglyceride', label: '甘油三酯', layer: 'backfill' },
  { key: 'hdl', label: '高密度脂蛋白', layer: 'backfill' },
  { key: 'ldl', label: '低密度脂蛋白', layer: 'backfill' },
  { key: 'cholesterol', label: '总胆固醇', layer: 'backfill' },
  { key: 'ua', label: '尿酸', layer: 'backfill' },
  { key: 'glucose', label: '血糖', layer: 'backfill' },
  { key: 'glucoseType', label: '血糖测量类型', layer: 'backfill' },
  { key: 'glucoseLevel', label: '血糖风险等级', layer: 'backfill' },

  // —— 皮肤/情绪/皮质醇（backfill）——
  { key: 'skin', label: '皮肤含水量', layer: 'backfill' },
  { key: 'emotion', label: '情绪', layer: 'backfill' },
  { key: 'cortisol', label: '皮质醇', layer: 'backfill' },
  { key: 'depressionRisk', label: '抑郁风险', layer: 'backfill' },

  // —— 睡眠（backfill，设备库读回）——
  { key: 'sleep', label: '睡眠', layer: 'backfill' },

  // —— 心电（measure，按需测量动作；基础版硬件无 ECG）——
  { key: 'ecg', label: '心电', layer: 'measure', proOnly: true },
];

export const ALL_NATIVE_METRIC_KEYS: string[] = NATIVE_METRIC_CATALOG.map((m) => m.key);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Profile 类型与能力配置
// ─────────────────────────────────────────────────────────────────────────────
export type DeviceProfileId = 'PRO_UI' | 'BASE_UI';

/** 兼容旧调用方（RingBleManager 等）：DeviceModelId 即 DeviceProfileId 的别名 */
export type DeviceModelId = DeviceProfileId;

/**
 * Pro 专属 UI 功能（组件级开关）。
 * BASE_UI 中这些为 false → 对应组件“根本不存在”，不在界面留灰锁/占位。
 */
export type ProFeature = 'ecg' | 'bloodComponents' | 'quickCheck' | 'temp' | 'eda';

/** 兼容旧类型名：DeviceCapabilities = ProFeature 的能力记录 */
export type DeviceCapabilities = Record<ProFeature, boolean>;

export interface DeviceProfile {
  id: DeviceProfileId;
  label: string;
  subtitle: string;
  /**
   * 该 Profile 硬件“原生会上传 / 可解读”的指标全集（决定展示哪些卡片/趋势）。
   * 不存在于该数组的指标 = 这枚戒指硬件根本不吐，前端一律不显示。
   */
  nativeMetrics: string[];
  /** UI 组件级开关（Pro 专属功能） */
  features: DeviceCapabilities;
  /** 兼容旧调用方：capabilities 即 features 的别名 */
  capabilities: DeviceCapabilities;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 型号 → Profile 映射（唯一真相源；靠 0x2A24 区分，不靠广播名）
//    键为 0x2A24 Model Number String（大小写/空格容错见 resolveProfileByModel）。
// ─────────────────────────────────────────────────────────────────────────────
export const DEVICE_PROFILE_MAP: Record<string, DeviceProfileId> = {
  HK18: 'PRO_UI',
  'LUNA-MIRA-PRO': 'PRO_UI',
  'LUNA-MIRA': 'BASE_UI',
};

/** PRO_UI 原生支持的指标 = 全集（基础版的 proOnly 项也都在） */
const PRO_NATIVE_METRICS = ALL_NATIVE_METRIC_KEYS;

/**
 * BASE_UI（LUNA-MIRA）原生指标 —— 按用户实测标定（2026-11-04 后端实查 41:.. 这枚）：
 *   ✅ 有：核心生命体征(hr/spo2/hrv/rr)、活动量、压力/疲劳/交感/梅脱、血压估计、
 *         体温 temp、皮电 eda（均走每日回读 temp_daily_mean/eda_daily_mean）、
 *         血液成分（血脂四项 triglyceride/hdl/ldl/cholesterol + 尿酸 ua + 血糖 glucose）、
 *         皮肤/情绪/皮质醇、睡眠
 *   ❌ 无（硬件不支持 / 无数据）：皮肤温度 skinTemp、心电 ecg
 * 注：skinTemp/ecg 在 NATIVE_METRIC_CATALOG 中标记为 proOnly，这里直接剔除；
 *     temp/eda 实测基础版也回读，已从 proOnly 移除以确保展示。
 */
const BASE_NATIVE_METRICS = ALL_NATIVE_METRIC_KEYS.filter((k) => {
  const spec = NATIVE_METRIC_CATALOG.find((m) => m.key === k);
  return !(spec?.proOnly === true);
});

export const DEVICE_PROFILES: Record<DeviceProfileId, DeviceProfile> = {
  PRO_UI: {
    id: 'PRO_UI',
    label: 'Luna Mira Pro',
    subtitle: '全功能：心电 · 体温/皮电 · 血液成分 · 一键体检',
    nativeMetrics: PRO_NATIVE_METRICS,
    features: { ecg: true, bloodComponents: true, quickCheck: true, temp: true, eda: true },
    capabilities: { ecg: true, bloodComponents: true, quickCheck: true, temp: true, eda: true },
  },
  BASE_UI: {
    id: 'BASE_UI',
    label: 'Luna Mira',
    subtitle: '基础版：心率/HRV/血氧/体温/皮电/睡眠/活动/血压/血液成分（无 心电/皮肤温度）',
    nativeMetrics: BASE_NATIVE_METRICS,
    // 基础版：无 ECG / 独立皮肤温度；体温 temp 与皮电 eda 实测走每日回读（有数据，照常展示）；
    // 血液成分（血脂四项+尿酸+血糖）按实测“有”；一键体检保留
    features: { ecg: false, bloodComponents: true, quickCheck: true, temp: true, eda: true },
    capabilities: { ecg: false, bloodComponents: true, quickCheck: true, temp: true, eda: true },
  },
};

/** 兼容旧调用方：DEVICE_MODELS 即 DEVICE_PROFILES 的别名 */
export const DEVICE_MODELS = DEVICE_PROFILES;

/** 默认 Profile = PRO_UI（功能全的档），未读到型号/读取出错时兜底 */
export const DEFAULT_DEVICE_PROFILE: DeviceProfileId = 'PRO_UI';

// ─────────────────────────────────────────────────────────────────────────────
// 3. 型号识别（0x2A24 Model Number → Profile）
// ─────────────────────────────────────────────────────────────────────────────
function normModel(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '-');
}

/**
 * 把 0x2A24 读到的 Model Number String 解析成 Profile。
 * 先精确匹配映射表，未命中再做“包含”匹配（如 "HK18-XXXX" 仍归 PRO_UI）。
 * 返回 null 表示无法判定（应保留上一档/让用户确认，而不是默认全功能）。
 */
export function resolveProfileByModel(rawModelNumber: string | null | undefined): DeviceProfileId | null {
  const m = normModel(rawModelNumber);
  if (!m) return null;
  if (DEVICE_PROFILE_MAP[m]) return DEVICE_PROFILE_MAP[m];
  // 包含匹配（兼容带后缀的型号串）
  if (m.includes('LUNA-MIRA-PRO') || m.includes('HK18')) return 'PRO_UI';
  if (m.includes('LUNA-MIRA')) return 'BASE_UI';
  return null;
}

export function getProfile(id: DeviceProfileId): DeviceProfile {
  return DEVICE_PROFILES[id] ?? DEVICE_PROFILES[DEFAULT_DEVICE_PROFILE];
}

/** 能力判断统一出口：入口处一句 `hasCap(profile, 'ecg')`。 */
export function hasCap(profile: DeviceProfile, feature: ProFeature): boolean {
  return profile.features[feature] === true;
}

/** 该 Profile 是否原生支持某个指标（决定卡片/趋势是否渲染） */
export function hasMetric(profile: DeviceProfile, metric: string): boolean {
  return profile.nativeMetrics.includes(metric);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 固件版本 0x2A26 —— 仅用于临时屏蔽“已知 bug 的能力”（绝不用于开启硬件不存在的能力）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 固件 → 需临时屏蔽的 ProFeature 列表。
 * 例：某固件 ECG 测量会卡死，先临时屏蔽 `ecg`，待固件修复后删除该行即可。
 * 注意：这里的屏蔽只会把 true→false（叠加在 features 之上），不会把硬件不存在的能力变出来。
 */
export const FIRMWARE_BUG_SHIELDS: Record<string, ProFeature[]> = {
  // '00.12.09-2526': ['ecg'], // 示例：该固件 ECG 异常，临时屏蔽（修复后删除此行）
};

/** 叠加固件屏蔽后的有效能力（前端实际应使用的 features） */
export function getEffectiveFeatures(profile: DeviceProfile, firmware: string | null | undefined): DeviceCapabilities {
  const shield = firmware ? FIRMWARE_BUG_SHIELDS[firmware] : undefined;
  if (!shield || shield.length === 0) return profile.features;
  const out: DeviceCapabilities = { ...profile.features };
  for (const f of shield) out[f] = false;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 连接后读取 DIS 的流程（0x180A / 0x2A24 / 0x2A26）
//    原生桥需新增 `readDeviceInformation()`（见文件底部 ObjC 片段），返回：
//      { modelNumber: string, firmware: string, serialNumber?: string }
//    本函数负责：读 DIS → 解析 Profile → 持久化 + 通知全 App 门禁刷新。
// ─────────────────────────────────────────────────────────────────────────────
const VeepooNative = (NativeModulesRef as any).VeepooRing;

export interface DeviceInformation {
  modelNumber: string | null;
  firmware: string | null;
  serialNumber?: string | null;
}

/**
 * 读取设备 DIS（Model Number + Firmware）。
 * 调原生 `VeepooRing.readDeviceInformation()`；原生未实现该方法时返回 null（调用方应回退）。
 */
export async function readDeviceInformation(): Promise<DeviceInformation | null> {
  try {
    if (!VeepooNative || typeof VeepooNative.readDeviceInformation !== 'function') return null;
    const raw = await VeepooNative.readDeviceInformation();
    if (!raw) return null;
    return {
      modelNumber: raw.modelNumber ?? raw.model_number ?? raw.model ?? null,
      firmware: raw.firmware ?? raw.firmwareRevision ?? null,
      serialNumber: raw.serialNumber ?? raw.serial_number ?? null,
    };
  } catch {
    return null;
  }
}

const PROFILE_KEY = 'device_profile_v1';
const MODEL_KEY = 'device_model_number_v1';
const FIRMWARE_KEY = 'device_firmware_v1';

/** 持久化当前连接的 Profile / 型号 / 固件 */
export async function persistProfile(
  profile: DeviceProfileId,
  modelNumber: string | null,
  firmware: string | null,
): Promise<void> {
  await Prefs.setItem(PROFILE_KEY, profile);
  if (modelNumber) await Prefs.setItem(MODEL_KEY, modelNumber);
  if (firmware) await Prefs.setItem(FIRMWARE_KEY, firmware);
}

/** 读取已持久化的型号/固件（用于上传标注 & 数据隔离判定） */
export async function getStoredDeviceInfo(): Promise<{ modelNumber: string | null; firmware: string | null }> {
  const modelNumber = (await Prefs.getItem(MODEL_KEY)) || null;
  const firmware = (await Prefs.getItem(FIRMWARE_KEY)) || null;
  return { modelNumber, firmware };
}

/**
 * ★ 连接成功后按 DIS 自动应用 Profile（BLE 层在 'connected' 后调用）：
 *   1) 读 0x2A24 / 0x2A26
 *   2) resolveProfileByModel → Profile
 *   3) 持久化 + 通知全 App 门禁刷新
 *   4) 返回 { profile, modelNumber, firmware } 供上层写入 ring state（数据隔离/上传标注用）
 * 读不到型号 → 返回 null（不动现有选择，不默认全功能）。
 */
export async function applyProfileFromDis(): Promise<{
  profile: DeviceProfileId;
  modelNumber: string | null;
  firmware: string | null;
} | null> {
  const info = await readDeviceInformation();
  if (!info) return null;
  const profile = resolveProfileByModel(info.modelNumber);
  if (!profile) return null;
  await persistProfile(profile, info.modelNumber, info.firmware);
  listeners.forEach((fn) => fn(profile));
  return { profile, modelNumber: info.modelNumber, firmware: info.firmware };
}

/**
 * ★ 2026-11-04（用户拍板·能力字段驱动）：基于 Veepoo SDK 连接后暴露的 *Type 能力字段判定 Profile，
 *   替代「读 BLE DIS 0x2A24 型号」方案（Veepoo SDK 不暴露 0x2A24，且 *Type 才是硬件能力真相源）。
 *
 * 分档规则：
 *   - ecgType > 0（有 ECG 硬件）→ PRO_UI（LunaMira Pro / HK18 全功能）
 *   - 否则 → BASE_UI（LunaMira 基础版）
 * 体温/皮电等是否展示不靠型号假设：BASE_UI 已包含 temp/eda（实测基础版也回读），
 * 前端卡片按「实测到数据才渲染」实现「有就展示」；ECG 入口仅 PRO_UI 有。
 *
 * @param caps 原生 onState(ready) 透传的 capabilities（temperatureType/gsrType/ecgType/…）
 */
export interface RingCapabilities {
  temperatureType?: number;
  gsrType?: number;
  ecgType?: number;
  bloodAnalysisType?: number;
  healthGlanceType?: number;
  bloodGlucoseType?: number;
  skinType?: number;
  deviceVersion?: string;
  deviceNumber?: number;
}

export function resolveProfileByCapabilities(
  caps: RingCapabilities | null | undefined,
): DeviceProfileId | null {
  if (!caps) return null;
  // ECG 是 Pro 与基础版的唯一硬件硬区分（基础版无 ECG 传感器）
  if (Number(caps.ecgType) > 0) return 'PRO_UI';
  return 'BASE_UI';
}

export async function applyProfileFromCapabilities(
  caps: RingCapabilities | null | undefined,
): Promise<DeviceProfileId | null> {
  const profile = resolveProfileByCapabilities(caps);
  if (!profile) return null;
  await persistProfile(profile, null, null);
  listeners.forEach((fn) => fn(profile));
  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Profile 变更订阅 + React 钩子（兼容旧 useDeviceModel）
// ─────────────────────────────────────────────────────────────────────────────
type ProfileListener = (id: DeviceProfileId) => void;
const listeners = new Set<ProfileListener>();

export function subscribeProfileChange(fn: ProfileListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function getDeviceProfileId(): Promise<DeviceProfileId> {
  try {
    const v = await Prefs.getItem(PROFILE_KEY);
    if (v === 'PRO_UI' || v === 'BASE_UI') return v;
  } catch {}
  return DEFAULT_DEVICE_PROFILE;
}

export async function setDeviceProfileId(id: DeviceProfileId): Promise<void> {
  await Prefs.setItem(PROFILE_KEY, id);
}

/**
 * React 侧统一取用：加载 + 订阅变更（DIS 识别机型或设置页手动切换后，所有门禁即时生效）。
 * 返回当前 Profile 与切换函数。
 */
export function useDeviceModel(): {
  model: DeviceProfile;
  setModelId: (id: DeviceProfileId) => Promise<void>;
} {
  const [id, setId] = useState<DeviceProfileId>(DEFAULT_DEVICE_PROFILE);
  useEffect(() => {
    let alive = true;
    getDeviceProfileId().then((v) => {
      if (alive) setId(v);
    });
    const off = subscribeProfileChange((next) => {
      if (alive) setId(next);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const setModelId = async (next: DeviceProfileId) => {
    await setDeviceProfileId(next);
    setId(next);
  };
  return { model: getProfile(id), setModelId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 兼容旧 API（RingBleManager 历史调用；新代码请用 applyProfileFromDis）
//    ⚠️ 这些基于“广播名”的识别已废弃 —— 设备识别改以 DIS(0x2A24) 为准。保留仅为不破坏编译。
// ─────────────────────────────────────────────────────────────────────────────
/** @deprecated 设备识别请改用 resolveProfileByModel(0x2A24)。保留仅为兼容。 */
export function guessModelFromName(deviceName: string | null | undefined): DeviceProfileId | null {
  const n = String(deviceName ?? '').trim().toLowerCase();
  if (!n) return null;
  const hasLunaMira = n.includes('luna mira') || n.includes('lunamira');
  if (hasLunaMira && (n.includes('pro') || n.includes('hk18'))) return 'PRO_UI';
  if (hasLunaMira) return 'BASE_UI';
  if (n.includes('hk18')) return 'PRO_UI';
  return null;
}

/** @deprecated 请改用 applyProfileFromDis()。保留仅为兼容广播名兜底。 */
export async function autoApplyModelFromDeviceName(
  deviceName: string | null | undefined,
): Promise<DeviceProfileId | null> {
  const guessed = guessModelFromName(deviceName);
  if (!guessed) return null;
  const current = await getDeviceProfileId();
  if (current === guessed) return guessed;
  await setDeviceProfileId(guessed);
  listeners.forEach((fn) => fn(guessed));
  return guessed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 数据隔离（同一账户内两枚戒指数据不混显）
//    实现要点：healthStore 的每日桶必须加一层 deviceId（戒指 MAC）维度；
//    展示层只取“当前连接戒指的 MAC”的数据。
//    本模块提供判定入口，具体 healthStore 分桶改造为后续步骤（见 build 前的集成任务）。
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 当前连接戒指的 MAC（来自 ring state.deviceId / 原生 deviceAddress）。
 * 展示层与上传层都应带此值，确保 HK18 与 LUNA-MIRA 数据分账、不混。
 */
export function currentRingDeviceId(ringState: { deviceId?: string | null } | null | undefined): string | null {
  return ringState?.deviceId ?? null;
}
