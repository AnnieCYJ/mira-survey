/**
 * ★ 2026-11-07 重要修正：此前本文件的 BASE_UI 能力是**照全量版协议 + HK18 旧后端数据**推出来的，
 *   与用户当前手上这枚 LunaMira 精简版有多处相反（体温/血脂/尿酸写「有」实际没有；血压写「无」实际有）。
 *   现按真机 `IDeviceFuctionDataListener` 能力包 + onBatch slot 实测字段重写，
 *   逐项证据见 docs/RING_DEVICE_CAPABILITY_MATRIX.md。
 *   **SDK 协议文档描述的是全量版（PRO_UI），不能套到精简版（BASE_UI）上。**
 *
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
  { key: 'rr', label: '呼吸率', layer: 'realtime', proOnly: true },
  // ★ 2026-11-05 协议复核（VeepooBleSDK.framework/Headers + UniApp SDK 使用文档）：
  //   · 温度只有一条真实链路：bodyTemperature(体温) / orgTemperature(原始温度=体表温度)，
  //     由 VPPeripheralModel.temperatureType 决定设备是否支持。当前戒指只在
  //     auto_data.temp_daily_mean 回读「日均体温」36.15–36.93℃；health_glance 空表、
  //     gsr 通道无温度字段 → **没有独立皮肤温度数据流**。
  //   · 协议里根本不存在 EDA(皮肤电导)：VPGSRResultModel 只有 skin_moisture(皮肤含水量 1–99)、
  //     sns_activation(交感)、emotion、depression_risk、cortisol_value。
  //     旧 auto_data.eda_daily_mean 是皮肤含水量被错误命名，且 11-05 真机连着戒指 0 条新回读
  //     → 基础版彻底移除皮电（用户 2026-11-05 拍板）。
  // ★ 2026-11-07 真机能力包实证（LunaMira 41:42:E7:17:9B:1C / 固件 00.12.09 / 协议版本 5）：
  //   `能力包P3 ─ 体温Type=0` = 精简版**没有体温传感器**；`能力包P4 ─ 体温告警=不支持`。
  //   旧注释「✅ 唯一真实温度：日均体温」是拿 HK18 全量版的数据反推精简版，已作废。
  { key: 'temp', label: '体温', layer: 'backfill', proOnly: true },            // ❌ 精简版不支持(type=0)
  { key: 'skinTemp', label: '皮肤温度', layer: 'realtime', proOnly: true },   // ❌ 无独立数据源，不展示
  { key: 'eda', label: '皮电 EDA', layer: 'backfill', proOnly: true },         // ❌ 协议无此指标，基础版不展示

  // —— 活动量（backfill，按天）——
  { key: 'steps', label: '步数', layer: 'backfill' },
  { key: 'distance', label: '距离', layer: 'backfill' },
  { key: 'calorie', label: '卡路里', layer: 'backfill' },

  // —— 健康评分/派生（backfill）——
  // ★ 2026-11-07 真机能力包：`压力 Stress : 支持 (StressType=2)` / `疲劳 Fatigue : 不支持`。
  //   压力硬件是有的，但**不在 v5 五分钟/一分钟 slot 里**（实测 keys=hr,bpDia,bpSys,spo2,hrv,t），
  //   要读设备手动测量记录（readDeviceManualData / STRESS）才有值，见 docs/RING_DEVICE_CAPABILITY_MATRIX.md。
  { key: 'stress', label: '压力', layer: 'backfill' },
  { key: 'fatigue', label: '疲劳', layer: 'backfill', proOnly: true },          // ❌ 精简版不支持
  { key: 'sns', label: '交感神经', layer: 'backfill' },                          // ⚠️ 精简版能力包未确认，按实测渲染
  { key: 'met', label: '梅脱', layer: 'backfill', proOnly: true },              // ❌ slot 无 met，精简版无源

  // —— 血压估计（backfill / PPG 估计）——
  // ★ 2026-11-07 真机能力包：`血压 BP : 支持 (BpTag=1)`，且 onBatch 实测逐点回传
  //   `bpSys=119 / bpDia=84` —— 精简版**有血压**。旧配置把血压标成 Pro 专属，反了。
  { key: 'bpSys', label: '收缩压', layer: 'backfill' },
  { key: 'bpDia', label: '舒张压', layer: 'backfill' },
  { key: 'ppgSys', label: 'PPG 收缩压', layer: 'backfill', proOnly: true },
  { key: 'ppgDia', label: 'PPG 舒张压', layer: 'backfill', proOnly: true },

  // —— 血液成分（backfill / HealthGlance 光谱；基础版按用户实测“有”血脂四项+尿酸+血糖）——
  // ★ 2026-11-07 真机能力包：`能力包P4 ─ ★血液成分(尿酸/血脂)=不支持 (CompTag=0)`、
  //   `单次校准=不支持`、`身体成分=不支持` → 精简版**没有血液成分**。
  //   旧配置写「基础版按用户实测有血脂四项+尿酸」，那是 HK18 全量版时期的数据，已作废。
  { key: 'lipid', label: '血脂', layer: 'backfill', proOnly: true },
  { key: 'triglyceride', label: '甘油三酯', layer: 'backfill', proOnly: true },
  { key: 'hdl', label: '高密度脂蛋白', layer: 'backfill', proOnly: true },
  { key: 'ldl', label: '低密度脂蛋白', layer: 'backfill', proOnly: true },
  { key: 'cholesterol', label: '总胆固醇', layer: 'backfill', proOnly: true },
  { key: 'ua', label: '尿酸', layer: 'backfill', proOnly: true },
  { key: 'glucose', label: '血糖', layer: 'backfill', proOnly: true },
  { key: 'glucoseType', label: '血糖测量类型', layer: 'backfill', proOnly: true },
  { key: 'glucoseLevel', label: '血糖风险等级', layer: 'backfill', proOnly: true },

  // —— 皮肤/情绪/皮质醇（backfill）——
  { key: 'skin', label: '皮肤含水量', layer: 'backfill', proOnly: true },
  { key: 'emotion', label: '情绪', layer: 'backfill', proOnly: true },
  { key: 'cortisol', label: '皮质醇', layer: 'backfill', proOnly: true },
  { key: 'depressionRisk', label: '抑郁风险', layer: 'backfill', proOnly: true },

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
export type ProFeature =
  | 'ecg'
  | 'bloodComponents'
  | 'quickCheck'
  | 'temp'
  | 'eda'
  | 'rr'
  | 'skin'
  | 'emotion'
  | 'cortisol'
  /** 基础版无皮质醇实测，但底层有 cortisolProxy 多信号推算节律 → 允许展示「推算」趋势图 */
  | 'cortisolProxy'
  | 'bp'
  | 'glucose'
  | 'bodyComp'
  | 'cholesterol'
  | 'uricAcid';

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
 * BASE_UI（LunaMira 精简版）原生指标 —— ★ 2026-11-07 **按设备能力包真机实证重写**。
 *
 * 证据：真机 MAC 41:42:E7:17:9B:1C / 固件 00.12.09 / 原始协议版本 5，
 *       Veepoo SDK `IDeviceFuctionDataListener.onFunctionSupportDataChange` 回包
 *       （完整日志见 docs/RING_DEVICE_CAPABILITY_MATRIX.md）。
 *
 *   ✅ 设备声明支持：
 *        心率 HR（始终）、血氧 SpO2、HRV（HrvType=6，全天 HRV 支持、App 测量不支持）、
 *        血压 BP（BpTag=1）、压力 Stress（StressType=2）、
 *        精准睡眠（sleepTag=6）、活动量 steps/distance/calorie（日汇总）
 *   ✅ onBatch 实测逐点回传的字段（dk=2026-11-06，1440 点/天，全天 1 分钟等间隔）：
 *        `hr, bpSys, bpDia, spo2, hrv, t` —— 只有这 5 个生命体征 + 时间戳
 *   ❌ 设备明确不支持：
 *        体温(type=0)、血液成分/尿酸/血脂(CompTag=0)、身体成分、血糖(GluTag=0)、
 *        疲劳、呼吸率、ECG、呼吸暂停提醒、体温告警、App 触发 HRV 测量
 *   ⚠️ 压力：硬件支持，但**不在 onBatch slot 里**（slot keys 无 stress），
 *        需走 `readDeviceManualData(STRESS)` 手动测量记录通道；当前原生未接入 → UI 如实空态。
 *   ⚠️ 数据隔离：旧设备 HK18（C9:00:9C:D7:C2:D8）是全量版，数据不得混入本机型，
 *        见 src/data/ringDataIsolation.ts。旧配置把它的数据当成精简版能力，是本次修正的根因。
 *
 * 与 PRO_UI 的关系：PRO_UI = 全功能戒指（HK18 / LunaMira Pro，SDK 协议全集），
 * BASE_UI = 这枚精简版，只保留上面「设备声明支持 ∪ 实测回传」的指标。
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
    features: {
      ecg: true, bloodComponents: true, quickCheck: true, temp: true, eda: true,
      rr: true, skin: true, emotion: true, cortisol: true, cortisolProxy: true, bp: true,
      glucose: true, bodyComp: true, cholesterol: true, uricAcid: true,
    },
    capabilities: {
      ecg: true, bloodComponents: true, quickCheck: true, temp: true, eda: true,
      rr: true, skin: true, emotion: true, cortisol: true, cortisolProxy: true, bp: true,
      glucose: true, bodyComp: true, cholesterol: true, uricAcid: true,
    },
  },
  BASE_UI: {
    id: 'BASE_UI',
    label: 'Luna Mira',
    subtitle: '精简版：心率 · HRV · 血氧 · 血压 · 压力 · 精准睡眠 · 活动（无 体温·血液成分·血糖·ECG·皮电·呼吸率·疲劳）',
    nativeMetrics: BASE_NATIVE_METRICS,
    // ★ 2026-11-07 真机能力包对齐：体温 / 血液成分 / 身体成分 / 血糖 / ECG / 呼吸率 /
    //   疲劳 / 皮电 / 皮肤温度 / 情绪 / 皮质醇实测 / 抑郁风险 = 硬件不支持，一律关闭；
    //   血压（BpTag=1）与压力（StressType=2）设备支持，血压还有逐点真实值 → 打开；
    //   quickCheck 与 cortisolProxy 是多信号推算，不依赖缺失传感器，保留。
    features: {
      ecg: false, bloodComponents: false, quickCheck: true, temp: false, eda: false,
      rr: false, skin: false, emotion: false, cortisol: false, cortisolProxy: true, bp: true,
      glucose: false, bodyComp: false, cholesterol: false, uricAcid: false,
    },
    capabilities: {
      ecg: false, bloodComponents: false, quickCheck: true, temp: false, eda: false,
      rr: false, skin: false, emotion: false, cortisol: false, cortisolProxy: true, bp: true,
      glucose: false, bodyComp: false, cholesterol: false, uricAcid: false,
    },
  },
};

/** 兼容旧调用方：DEVICE_MODELS 即 DEVICE_PROFILES 的别名 */
export const DEVICE_MODELS = DEVICE_PROFILES;

/**
 * 默认 Profile = BASE_UI（基础版，无 ECG/皮肤温度）。
 * ★ 2026-11-05（用户：按真机收敛）：未读到型号 / 原生未透传能力 / 读取出错时，
 *   一律兜底为「功能最少的档」，绝不默认全功能。理由：默认全功能会让本无 ECG 传感器的
 *   基础版错误展示心电入口；而真机识别（能力字段 → 已知 MAC → 广播名）会在连接时把 Pro 升级到全功能。
 *   即「无证据证明有 ECG，就不展示 ECG」。
 */
export const DEFAULT_DEVICE_PROFILE: DeviceProfileId = 'BASE_UI';

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

/**
 * 能力判断统一出口：入口处一句 `hasCap(profile, 'ecg')`。
 *
 * ★ 2026-11-06 审查（docs/audit/03 🟡#9）：**固件屏蔽必须在这里生效**。
 *   旧实现直接读 `profile.features`，完全绕过 `FIRMWARE_BUG_SHIELDS` ——
 *   那意味着「某个已知 bug 固件临时屏蔽 ECG」这张保护是**假保护**
 *   （生产代码从未调用 getEffectiveFeatures，只有未被引用的示例文件调用过）。
 *   现在统一走 getEffectiveFeatures，屏蔽表一填即生效。
 *
 * @param firmware 当前戒指固件号（null/undefined = 未知，不屏蔽）
 */
export function hasCap(
  profile: DeviceProfile,
  feature: ProFeature,
  firmware?: string | null,
): boolean {
  const features = getEffectiveFeatures(profile, firmware);
  return features[feature] === true;
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

/**
 * 叠加固件屏蔽后的有效能力（前端实际应使用的 features）。
 *
 * ★ 2026-11-06 审查（docs/audit/03 🟡#9）：**始终返回副本** ——
 *   旧实现在无屏蔽时直接返回 `profile.features` 本体，调用方若误改返回值
 *   就会污染全局 Profile 定义（所有页面共享同一个对象）。
 *
 * ★ v18.134（审查 03 🔵#23）：生产链路请不要直接调本函数，统一走
 *   `hasCap(profile, feature, firmware)`（内部即取 getEffectiveFeatures）。
 *   原引用本函数的示例文件 ProfileAwareHome.example.tsx 已删除
 *   （它未被任何地方 import，是死代码，却让人误以为门禁已在生产生效）。
 */
export function getEffectiveFeatures(profile: DeviceProfile, firmware: string | null | undefined): DeviceCapabilities {
  const out: DeviceCapabilities = { ...profile.features };
  const shield = firmware ? FIRMWARE_BUG_SHIELDS[firmware] : undefined;
  if (shield && shield.length > 0) {
    for (const f of shield) out[f] = false;
  }
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
    if (!VeepooNative || typeof VeepooNative.readDeviceInformation !== 'function') {
      // 老固件 / Android 未实现 → 属**预期**路径，但留一行日志以便与「读取失败」区分
      console.info('[deviceModel] 原生未实现 readDeviceInformation（老固件 / Android），跳过型号读取');
      return null;
    }
    const raw = await VeepooNative.readDeviceInformation();
    if (!raw) {
      console.warn('[deviceModel] readDeviceInformation 返回空');
      return null;
    }
    return {
      modelNumber: raw.modelNumber ?? raw.model_number ?? raw.model ?? null,
      firmware: raw.firmware ?? raw.firmwareRevision ?? null,
      serialNumber: raw.serialNumber ?? raw.serial_number ?? null,
    };
  } catch (e) {
    // ★ 2026-11-06 审查（docs/audit/03 🟡#8）：读取失败 ≠ 设备不支持。
    //   两种失败原本被合并成同一个 null 且不留日志 → 「Pro 设备被识别成基础版」
    //   这类问题永远无法自证。这里必须留痕。
    console.warn('[deviceModel] readDeviceInformation 调用失败：', e);
    return null;
  }
}

const PROFILE_KEY = 'device_profile_v1';
const MODEL_KEY = 'device_model_number_v1';
const FIRMWARE_KEY = 'device_firmware_v1';
const DEVICE_ID_KEY = 'device_id_v1';

/** 持久化当前连接的 Profile / 型号 / 固件 / MAC（MAC = 真机身份，用于上传标注 & 数据隔离判定） */
export async function persistProfile(
  profile: DeviceProfileId,
  modelNumber: string | null,
  firmware: string | null,
  deviceId?: string | null,
): Promise<void> {
  await Prefs.setItem(PROFILE_KEY, profile);
  if (modelNumber) await Prefs.setItem(MODEL_KEY, modelNumber);
  if (firmware) await Prefs.setItem(FIRMWARE_KEY, firmware);
  if (deviceId) await Prefs.setItem(DEVICE_ID_KEY, String(deviceId));
}

/** 读取已持久化的型号/固件/MAC（用于上传标注 & 数据隔离判定） */
export async function getStoredDeviceInfo(): Promise<{
  modelNumber: string | null;
  firmware: string | null;
  deviceId: string | null;
}> {
  const modelNumber = (await Prefs.getItem(MODEL_KEY)) || null;
  const firmware = (await Prefs.getItem(FIRMWARE_KEY)) || null;
  const deviceId = (await Prefs.getItem(DEVICE_ID_KEY)) || null;
  return { modelNumber, firmware, deviceId };
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
 * ★ 2026-11-05 协议复核（推翻第二轮的错误判断）：BASE_UI **只有 temp，没有 eda**。
 *   Veepoo SDK（VPGSRResultModel）里根本没有 EDA 皮肤电导，只有 skin_moisture 皮肤含水量；
 *   旧 auto_data.eda_daily_mean 即该值被错误命名，且 11-05 真机连着戒指 0 条新回读。
 *   gsr 通道只回传 sns，不含任何皮电逐点值 → BASE_UI.eda = false。
 *   温度也只有 temp 一路（日均体温），没有独立皮肤温度；血压 / 血糖 / 尿酸 / 总胆固醇 /
 *   皮肤含水量 / 情绪 / 皮质醇实测 / 疲劳度无源，按机型能力隐藏。
 *   ECG / 心电、呼吸率 rr 也仅 PRO_UI 有；一键体检 quickCheck 基础版保留（实测 + 估算）。
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
  // ── Veepoo `FunctionDeviceSupportData` 能力包字段（设备硬件真相源）──
  //   ⚠️ 2026-11-07 真机实测：已装 APK 的 `ready` 事件目前**只透传**
  //   `{deviceVersion, passwordConfirmed}`，下面这些 *Type 都没透传到 JS
  //   （原生只把它们打进 logcat「设备能力总览」）。所以能力门禁此刻实际靠 MAC 兜底，
  //   等原生重编译后补齐透传，这些字段即可直接用于分档，无需再改 JS 判定逻辑。
  originProtocolVersion?: number;
  watchDays?: number;
  hrvType?: number;
  allDayHrv?: boolean;
  hrvAppDetect?: boolean;
  spo2H?: boolean;
  spo2HBreathBreak?: boolean;
  bp?: boolean;
  bpTag?: number;
  temperatureFunction?: boolean;
  bloodGlucose?: boolean;
  gluTag?: number;
  bloodComponent?: boolean;
  compTag?: number;
  bodyComposition?: boolean;
  stress?: boolean;
  stressType?: number;
  fatigue?: boolean;
  breath?: boolean;
  precisionSleep?: boolean;
  sleepTag?: number;
}

/**
 * ★ 2026-11-07 真机能力指纹：LunaMira **精简版**（当前用户手上这枚）。
 * MAC 41:42:E7:17:9B:1C / 固件 00.12.09 / 原始协议版本 5 / 存储 3 天。
 * 来源：logcat `[VeepooRing] 设备能力总览` + `能力包P2/P3/P4`（逐项原文见能力矩阵文档）。
 * 这是「精简版有哪些数据」的唯一实证基准，与 SDK 全量协议（PRO_UI）严格区分。
 */
export const LUNAMIRA_BASE_CAPABILITY_FINGERPRINT = {
  originProtocolVersion: 5,
  watchDays: 3,
  hr: true,               // 始终支持
  spo2H: true,            // 支持
  spo2HBreathBreak: false,
  hrv: true, hrvType: 6, allDayHrv: true, hrvAppDetect: false,
  bp: true, bpTag: 1,
  temperatureFunction: false, temperatureType: 0,
  bloodGlucose: false, gluTag: 0,
  bloodComponent: false, compTag: 0, bodyComposition: false,
  stress: true, stressType: 2,
  fatigue: false,
  breath: false,
  ecg: false,
  precisionSleep: true, sleepTag: 6,
  /** onBatch 逐点 slot 实测 key 全集（1440 点/天，全天 1 分钟等间隔） */
  slotKeys: ['hr', 'bpSys', 'bpDia', 'spo2', 'hrv', 't'],
} as const;

export function resolveProfileByCapabilities(
  caps: RingCapabilities | null | undefined,
): DeviceProfileId | null {
  if (!caps) return null;
  // ECG 是 Pro 与基础版的唯一硬件硬区分（基础版无 ECG 传感器）
  //
  // ★ 2026-11-06 审查（docs/audit/03 🟡#6）：只有在**确实读到 ecgType** 时才下结论。
  //   旧实现里 ecgType 缺失（undefined）时 Number(undefined) > 0 → false → 判 BASE_UI。
  //   而 detectProfile 的 caps 层优先级最高 → 会把 MAC / 广播名判定整个短路掉。
  //   实锤：iOS VeepooRing.m 在 connectedModel 尚未就绪时透传的是**空字典 {}**（pm 为 nil），
  //   那样一台 Pro 设备会被永久持久化成 BASE_UI（用户侧：ECG/血压/血糖入口全部消失）。
  //   修正：ecgType 缺失 → 返回 null，交回 MAC / 广播名判定；三条线索都拿不到时由调用方保留上一档。
  const ecgType = caps.ecgType;
  if (typeof ecgType !== 'number' || !Number.isFinite(ecgType)) return null;
  if (ecgType > 0) return 'PRO_UI';
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

/**
 * ★ 2026-11-05（用户：连上戒指就该知道是 Pro 还是基础版，按真机收敛）：
 *   已知设备 MAC → Profile 的硬编码映射。这是「真机身份」最可靠的信号——
 *   原生即便不暴露型号字符串 / 不透传能力字段，MAC 也一定在。
 *   用户已确认：基础版 Luna Mira = 41:42:E7:17:9B:1C；Pro（HK18）由能力字段/广播名识别。
 *   后续新增已知设备直接在此追加即可。
 */
export const DEVICE_ID_PROFILES: Record<string, DeviceProfileId> = {
  '41:42:E7:17:9B:1C': 'BASE_UI', // ★ 用户确认的 LunaMira 基础版 MAC（当前在用）
  'C9:00:9C:D7:C2:D8': 'PRO_UI',  // ★ 旧设备 / HK18 时期，仅用于识别，数据不得混入基础版
  // ★ 2026-11-16：Luna Mira Pro 实机（用户华为 P30 连接验证）。
  //   广播名 "Lunamira Pro" / 固件 00.18.03 / SDK 能力包 ECG=SUPPORT·血压=SUPPORT·HRV=SUPPORT。
  //   Android 原生 ready 不透传 *Type 能力字段（见 RingCapabilities 注释），MAC 是唯一稳定证据。
  'F0:77:5D:ED:A8:5B': 'PRO_UI',
};

function normDeviceId(id?: string | null): string {
  return String(id ?? '').trim().toUpperCase();
}

/**
 * 统一真机识别：按「能力字段 → 已知 MAC → 广播名」优先级判定 Profile。
 * 任何一层都拿不到证据时返回 null（调用方据此保留上一档 / 用安全默认，绝不强行全功能）。
 *
 * 优先级说明：
 *  - 能力字段（ecgType>0）→ PRO_UI；ecgType=0 或缺失 → 该层已能确定「无 ECG」→ BASE_UI（也是真值，直接返回）。
 *  - 已知 MAC：用户确认的实体设备身份，覆盖「原生不报型号/能力」的情况。
 *  - 广播名：'luna mira'+'pro'/'hk18' → Pro；'luna mira' → 基础版。
 */
export function detectProfile(opts: {
  capabilities?: RingCapabilities | null;
  deviceName?: string | null;
  deviceId?: string | null;
}): DeviceProfileId | null {
  // 1) 能力字段最准：有 ECG 硬件 → Pro；无 ECG（或缺失）→ 该层即可定 BASE_UI
  const byCaps = resolveProfileByCapabilities(opts.capabilities);
  if (byCaps) return byCaps;
  // 2) 已知设备 MAC（真机身份）
  const did = normDeviceId(opts.deviceId);
  if (did && DEVICE_ID_PROFILES[did]) return DEVICE_ID_PROFILES[did];
  // 3) 广播名 / 设备名
  const byName = guessModelFromName(opts.deviceName);
  if (byName) return byName;
  return null;
}

/**
 * ★ 连接流程统一入口：汇集「连接就绪时原生透传的能力字段 / 已连上的设备名 / MAC」，
 *   调用 detectProfile 判定 Profile，持久化（含 MAC）并通知全 App 门禁刷新。
 *   返回应用到的 Profile（null = 未能判定，不动现有选择）。
 */
export async function applyProfileFromDevice(opts: {
  capabilities?: RingCapabilities | null;
  deviceName?: string | null;
  deviceId?: string | null;
  modelNumber?: string | null;
  firmware?: string | null;
}): Promise<DeviceProfileId | null> {
  const profile = detectProfile(opts);
  if (!profile) return null;
  await persistProfile(profile, opts.modelNumber ?? null, opts.firmware ?? null, opts.deviceId ?? null);
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
  } catch (e) {
    // ★ 2026-11-06 审查（docs/audit/03 🟡#7）：读盘失败静默吞错 → 机型**静默降级**为
    //   BASE_UI，且无任何日志。此处留痕，否则「Pro 设备被当成基础版」无从追查。
    console.warn('[deviceModel] 读取机型配置失败，回退为默认机型：', e);
  }
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
//    ★ 2026-11-05：真相源已抽到 src/data/ringDataIsolation.ts ——
//      旧 HK18 设备 C9:00:9C:D7:C2:D8 / demo-* / test-diag-* 全部拉黑；
//      云端日值补齐器只认当前连接戒指的可信 MAC；展示层禁止对温度类指标
//      回退到本机 healthStore 历史归档（那里混着 HK18 时期的 39℃ 脏值）。
//    本模块保留 currentRingDeviceId() 作为展示层判定入口。
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 当前连接戒指的 MAC（来自 ring state.deviceId / 原生 deviceAddress）。
 * 展示层与上传层都应带此值，确保 HK18 与 LUNA-MIRA 数据分账、不混。
 */
export function currentRingDeviceId(ringState: { deviceId?: string | null } | null | undefined): string | null {
  return ringState?.deviceId ?? null;
}
