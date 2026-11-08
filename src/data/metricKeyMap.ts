/**
 * ★ v18.134（审查 04 🔴-1）【唯一真相源】展示层/信号层 key ↔ healthStore 规范 MetricKey。
 *
 * 背景：RingBleManager.ts 与 realSeries.ts 各自维护了一份 `hsKeyFor`，注释互称
 * 「保持一致」但实际已漂移（realSeries 缺 glucoseType/glucoseLevel/depressionRisk/
 * ppgSys/ppgDia 显式 case，靠 default 硬 cast 巧合兜住）。且旧实现的 default 分支
 * 无条件 `signalKey as HSMetricKey` —— 未知 key 会静默落进 healthStore.safeStore
 * 的 null 分支被丢弃，不产生任何日志（「key 不一致被 TS 静默丢弃」的结构性根因）。
 *
 * 现在两处一律 `import { hsKeyFor } from '../data/metricKeyMap'`：
 *   - 已登记别名（bloodSugar/uricAcid/bloodFat/snsActivation）→ 显式映射；
 *   - 已注册规范 key（healthStore.ALL_METRIC_KEYS）→ 恒等返回；
 *   - **未知 key → null**，由调用方明确打日志或返回空 —— 不静默、不硬 cast。
 *
 * 新增原生 key 三步（缺一不可）：
 *   ① 原生 emit 处定 key  ② healthStore.MetricKey / ALL_METRIC_KEYS 登记
 *   ③ 若是别名，在 ALIAS_TO_HS 登记。本文件是「不静默丢弃」的唯一闸门。
 */
import { ALL_METRIC_KEYS, type MetricKey } from './healthStore';

export type HSMetricKey = MetricKey;

/**
 * 显式别名表。**只写需要转换的别名**；规范 key 走 REGISTERED 快速路径。
 */
const ALIAS_TO_HS: Readonly<Record<string, HSMetricKey>> = Object.freeze({
  // ── 展示层历史别名 → 数据层规范 key ──
  bloodSugar: 'glucose',   // 血糖（展示层旧别名）
  uricAcid: 'ua',          // 尿酸（展示层旧别名）
  bloodFat: 'cholesterol', // 总胆固醇（展示层旧别名）
  // ★ 2026-10-10（用户实锤「洞察页有两个交感神经卡，左下那张不显示数据」）：
  //   原生 emit 的真实 key 是 `sns`；`snsActivation` 只是历史别名 → 映射到 'sns'。
  snsActivation: 'sns',

  // ── ★ 2026-11-07 全指标协议审计：SDK 头文件里的真实字段名 ──
  // 依据：iOS VPDataBaseOperation.h / VPHealthGlanceTestModel.h / VPManualTestDataModel.h、
  //       Android OriginData·OriginData3 getters、PressureManualData / MetoManualData。
  // 原生若改用 SDK 原名 emit onRealtime / onBatch，旧版会打印「未知 metric key」后丢弃；
  // 这里登记后一律正确落库。与 RingBleManager.FIELD_ALIASES 保持同一套命名口径。
  // 心率
  heartValue: 'hr', heartRate: 'hr', rateValue: 'hr', bpm: 'hr', pulse: 'hr', heartrate: 'hr',
  // 血氧
  oxygen: 'spo2', oxygenValue: 'spo2', bloodOxygen: 'spo2', bloodoxygen: 'spo2', spo2h: 'spo2',
  // 体温 / HRV
  temperature: 'temp', bodyTemperature: 'temp', hrvValue: 'hrv',
  // 活动量
  stepValue: 'steps', calValue: 'calorie', disValue: 'distance',
  // 血压
  systolic: 'bpSys', diastolic: 'bpDia', highValue: 'bpSys', lowValue: 'bpDia',
  // ★ 压力（用户明确要求「压力也做」）：PressureManualData.pressure [0-100]
  pressure: 'stress', pressureValue: 'stress', stressValue: 'stress', stressIndex: 'stress',
  // 梅脱 / 疲劳 / 皮电 / 呼吸率
  meto: 'met', metValue: 'met',
  fatigueLevel: 'fatigue', fatigueIndex: 'fatigue',
  gsr: 'eda', skinConductance: 'eda', gsrValue: 'eda',
  resRate: 'rr', respRate: 'rr', respirationRate: 'rr', breathRate: 'rr', resRates: 'rr',
  // 健康一览复合指标
  cortisolValue: 'cortisol', emotionLevel: 'emotion', skinMoisture: 'skin',
  bloodGlucose: 'glucose',
});

const REGISTERED: ReadonlySet<string> = new Set<string>(ALL_METRIC_KEYS);

/**
 * ★ v18.134（审查 04 🟡-6）：数据层规范 key → 展示层别名 key（用于 RingState.daily / extDaily 双写）。
 *   RingState.daily 既是数据层（realSeries 读原生/规范 key）又是展示层（InsightScreen 读别名 key）
 *   的并集 —— 写侧两套 key 都写，读侧才都能命中（血糖/尿酸卡在没有实时流时不再恒「—」）。
 */
export const DISPLAY_KEY_BY_HS: ReadonlyMap<string, string> = new Map<string, string>([
  ['glucose', 'bloodSugar'],
  ['ua', 'uricAcid'],
  ['cholesterol', 'bloodFat'],
]);

/**
 * 把展示/信号 key 映射到 healthStore 规范 MetricKey。
 * **未知 key 返回 null**（而不是 `as HSMetricKey` 硬 cast）——这是「静默丢弃」事故的总闸门。
 */
export function hsKeyFor(signalKey: string): HSMetricKey | null {
  if (!signalKey) return null;
  const mapped = ALIAS_TO_HS[signalKey];
  if (mapped) return mapped;
  // 未登记的 key：只有它本身就是已注册的规范 key 时才放行，否则明确拒绝
  return REGISTERED.has(signalKey) ? (signalKey as HSMetricKey) : null;
}

/** 调试/自检用：列出所有「展示层 key → 数据层 key」的显式映射。 */
export function dumpKeyMap(): Record<string, string> {
  return { ...ALIAS_TO_HS };
}
