/**
 * 戒指采样频率 · 唯一口径源（2026-11-07）
 *
 * 为什么需要它：用户发现「夜间频率高、日间频率低」，但 App 里从未标注过采样频率，
 * 导致同一条曲线上的点疏密差异被误读成「数据缺失」或「算法算错」。
 *
 * 协议依据（全部来自本地 hband-sdk，不靠猜）：
 *  · iOS VPDataBaseOperation.h:16 —— 5 分钟原始数据「一般是每隔5分钟或者10分钟的，
 *    如果间隔时间长就是在设备中没有读取到数据」；样例 dict 里就有 stress / met。
 *  · Android VeepooSDK_Android_Api.md:1145 / :1248 —— 5 分钟一条，一天最多 288 条。
 *  · iOS VPDataBaseOperation.h:212 / :244 —— 血氧、HRV 原始数据「每一分钟」的字典数组。
 *  · iOS VPDataBaseOperation.h:239 —— 洛伦兹散点图取 **0～7 点** 的 HRV 数据
 *    → HRV / 血氧在夜间睡眠窗口是连续高频，白天只有自动监测的稀疏点。
 *  · iOS VPDataBaseOperation.h:80 —— 血压「每一个小时正常情况下会有一组有效值」。
 *  · iOS VPDataBaseOperation.h:259 / :275 —— 体温、血糖自动测量「每 5 分钟」。
 *  · Android :10711-10746 AutoMeasureData —— 自动测量（含 STRESS(3) / MET(6) /
 *    HRV(7) / BLOOD_OXYGEN(4)）带 measureInterval（分钟）+ currentStartMinute/
 *    currentEndMinute 时间段，**间隔可配、且可按时段不同**。
 *  · Android :13912-13914 —— PPG 原始数据 MODE1 每 15 分钟 / MODE2 每 5 分钟 / MODE3 实时。
 *  · Android :1041 / :3327（睡眠）—— 普通睡眠 1 字符 = 5 分钟；精准睡眠 1 字符 = 1 分钟。
 *
 * 本模块做两件事：
 *  ① 给出每个指标的**协议口径**（静态、有出处）；
 *  ② 从 healthStore 的**真实样本时间戳**算出日间/夜间实测间隔中位数（动态、可验证）。
 * 两者分开写，绝不拿协议值冒充实测值。
 */
import { healthStore, type MetricKey } from '../data/healthStore';

export interface ProtocolCadence {
  /** 日间（08:00–22:00）协议间隔 */
  day: string;
  /** 夜间（22:00–08:00）协议间隔 */
  night: string;
  /** 补充说明（为什么白天稀、夜里密等） */
  note: string;
  /** 协议出处，写到 UI 上便于核对 */
  source: string;
}

/** 夜间窗口 22:00–08:00（与 App 睡眠/昼夜节律口径一致）。 */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 8;

export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

const DENSE_5MIN: ProtocolCadence = {
  day: '每 5 分钟（原始数据桶）',
  night: '每 5 分钟（原始数据桶）',
  note: '一天最多 288 个 5 分钟桶；间隔变长通常表示设备当时没有读到数据，不是 App 漏画。',
  source: 'VPDataBaseOperation.h:16 / VeepooSDK_Android_Api.md:1145',
};

/**
 * ⚠️ 2026-11-07 机型区分：下面这张「协议口径」表来自 **全量版**（HK18 / LunaMira Pro）的 SDK 文档，
 *    不是用户当前佩戴的 **LunaMira 精简版**（固件 00.12.09 / 原始协议版本 5）。
 *    精简版真机实测是 **全天 1 分钟等间隔、1440 点/天**（`[Batch.cadence] 日间=1.0min 夜间=1.0min`），
 *    逐点字段只有 `hr,bpSys,bpDia,spo2,hrv,t`，日夜无差异。
 *    详见 docs/RING_DEVICE_CAPABILITY_MATRIX.md。
 *    UI 上优先展示 `computeMeasuredCadence()` 的**实测值**（永远对）；
 *    这里的静态协议值只作全量版参考，不要拿它当这枚戒指的规格。
 */
/** 各指标协议频率表。未列出的指标回退到 UNKNOWN。 */
export const PROTOCOL_CADENCE: Partial<Record<MetricKey, ProtocolCadence>> = {
  hr: {
    day: '每 5 分钟汇总（PPG 原始可到 1 分钟）',
    night: '每 5 分钟汇总 + 睡眠期 PPG 连续采集',
    note: '心率自动检测开启时才有连续点；白天运动模式下可能切到更密的采集模式。',
    source: 'OriginData3.ppgs/ecgs · VPDataBaseOperation.h:16 · MODE1/2/3 (:13912)',
  },
  hrv: {
    day: '自动监测间隔（可配，常见 30～60 分钟）',
    night: '每分钟（0–7 点洛伦兹/HRV 原始数据）',
    note: '★ 夜间明显比日间密：HRV 主要在睡眠期逐分钟采集，白天只在自动监测触发时有点。',
    source: 'VPDataBaseOperation.h:239-249 · AutoMeasureData.measureInterval (:10738)',
  },
  spo2: {
    day: '手动测量 / 自动监测间隔',
    night: '每分钟（Spo2hOriginData 血氧历史通道）',
    note: '★ 夜间明显比日间密：血氧历史数据按分钟存储，白天多为手动或稀疏自动点。',
    source: 'VPDataBaseOperation.h:208-234 · readSpo2hOrigin',
  },
  temp: {
    day: '每 5 分钟',
    night: '每 5 分钟',
    note: '体温自动测量数据，含体温与体表温度两个值。',
    source: 'VPDataBaseOperation.h:256-267',
  },
  skinTemp: {
    day: '每 5 分钟',
    night: '每 5 分钟',
    note: '与体温同一条自动测量通道里的原始体表温度。',
    source: 'VPDataBaseOperation.h:266',
  },
  steps: DENSE_5MIN,
  distance: DENSE_5MIN,
  calorie: DENSE_5MIN,
  bpSys: {
    day: '每小时约一组有效值 / 手动测量',
    night: '每小时约一组有效值',
    note: '原始数据中血压每小时提炼一组有效值；基础版硬件需手动自测记录。',
    source: 'VPDataBaseOperation.h:80-100',
  },
  bpDia: {
    day: '每小时约一组有效值 / 手动测量',
    night: '每小时约一组有效值',
    note: '与收缩压同一组读数。',
    source: 'VPDataBaseOperation.h:80-100',
  },
  stress: {
    day: '自动压力监测间隔（可配，按时间段）',
    night: '自动压力监测间隔（可配，按时间段）',
    note: '压力来自设备端测量记录（DeviceManualDataType.STRESS）与健康一览快照，不是 5 分钟原始数据桶字段；间隔由设备 measureInterval 决定，白天/夜间可不同。',
    source: 'VeepooSDK_Android_Api.md:10061/10748 · VPDataBaseOperation.h:33',
  },
  met: {
    day: '每 5 分钟原始数据桶 / 自动监测间隔',
    night: '每 5 分钟原始数据桶',
    note: '梅脱在 5 分钟原始数据样例中逐桶出现；也可由 MET 测量记录补充。',
    source: 'VPDataBaseOperation.h:32 · DeviceManualDataType.MET(6)',
  },
  rr: {
    day: '每 5 分钟（OriginData3.resRates）/ 随 ECG',
    night: '每 5 分钟（睡眠期呼吸率）',
    note: '呼吸率随血氧/ECG 通道产出，不是独立传感器连续流。',
    source: 'OriginData3.getResRates() · VPDataBaseOperation.h:233',
  },
  eda: {
    day: '按需手动测量（GSR / 皮电）',
    night: '无连续离线流',
    note: '皮电只在测量时产生，协议不提供整夜连续 EDA；请勿把空段当作丢包。',
    source: 'DeviceManualDataType.SKIN_CONDUCTANCE(12) · VPManualGSRModel',
  },
  fatigue: {
    day: '健康一览 / 疲劳度测量快照（按需）',
    night: '无连续离线流',
    note: '稀疏快照，不是逐分钟曲线。',
    source: 'VPHealthGlanceTestModel.h:21 · DeviceManualDataType.FATIGUE(11)',
  },
  glucose: {
    day: '每 5 分钟（自动测量）/ 健康一览快照',
    night: '每 5 分钟',
    note: '需要设备支持血糖类型；基础版多为健康一览单点。',
    source: 'VPDataBaseOperation.h:271-280',
  },
  cortisol: {
    day: '健康一览快照（按需）',
    night: '无连续离线流',
    note: '稀疏测量点，App 中的昼夜节律曲线为推算值并明确标注。',
    source: 'VPHealthGlanceTestModel.h:103',
  },
  emotion: {
    day: '健康一览 / 情绪测量快照（按需）',
    night: '无连续离线流',
    note: '值域 [-10,10]，0 与负数是有效读数。',
    source: 'VPHealthGlanceTestModel.h:95',
  },
  sns: {
    day: '健康一览 snsActivation 快照（按需）',
    night: '无连续离线流',
    note: '交感神经活跃度 [1,99]，稀疏测量点。',
    source: 'VPHealthGlanceTestModel.h:101',
  },
  ua: {
    day: '健康一览复合测量（按需）',
    night: '无连续离线流',
    note: '血液成分随健康一览产出。',
    source: 'OriginData3.getBloodComponent()',
  },
  cholesterol: {
    day: '健康一览复合测量（按需）',
    night: '无连续离线流',
    note: '血液成分随健康一览产出。',
    source: 'OriginData3.getBloodComponent()',
  },
  triglyceride: {
    day: '健康一览复合测量（按需）',
    night: '无连续离线流',
    note: '血液成分随健康一览产出。',
    source: 'OriginData3.getBloodComponent()',
  },
  hdl: {
    day: '健康一览复合测量（按需）',
    night: '无连续离线流',
    note: '血液成分随健康一览产出。',
    source: 'OriginData3.getBloodComponent()',
  },
  ldl: {
    day: '健康一览复合测量（按需）',
    night: '无连续离线流',
    note: '血液成分随健康一览产出。',
    source: 'OriginData3.getBloodComponent()',
  },
};

export const UNKNOWN_CADENCE: ProtocolCadence = {
  day: '按设备测量触发',
  night: '按设备测量触发',
  note: '该指标没有固定采样周期，只在测量时产生数据点。',
  source: 'Veepoo SDK',
};

export interface MeasuredCadence {
  dayMinutes: number | null;
  nightMinutes: number | null;
  overallMinutes: number | null;
  daySamples: number;
  nightSamples: number;
}

/** 取中位数（避免个别超大缺口把均值拉歪）。 */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 从真实样本时间戳算日间 / 夜间的采样间隔中位数。
 * - 只统计同一天内、间隔 < 2 小时的相邻点（跨天与大缺口不算「采样间隔」）。
 * - 按 **前一个点** 的小时归类日/夜，避免跨窗口的点被误分。
 * - 全程只读 healthStore，不插值、不补点、不改数据。
 */
export function computeMeasuredCadence(metric: MetricKey, dks: string[]): MeasuredCadence {
  const dayGaps: number[] = [];
  const nightGaps: number[] = [];
  const allGaps: number[] = [];
  let daySamples = 0;
  let nightSamples = 0;

  for (const dk of dks) {
    let pts: Array<{ t: number; v: number }> = [];
    try {
      pts = healthStore.getIntraday(metric, dk) ?? [];
    } catch {
      continue;
    }
    const sorted = pts
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length; i++) {
      const hour = new Date(sorted[i].t).getHours();
      if (isNightHour(hour)) nightSamples++;
      else daySamples++;
      if (i === 0) continue;
      const gapMin = (sorted[i].t - sorted[i - 1].t) / 60000;
      // 同一时刻的重复写入 / 跨天缺口 / 设备断连都不算采样间隔
      if (gapMin <= 0 || gapMin > 120) continue;
      allGaps.push(gapMin);
      const prevHour = new Date(sorted[i - 1].t).getHours();
      if (isNightHour(prevHour)) nightGaps.push(gapMin);
      else dayGaps.push(gapMin);
    }
  }

  const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
  return {
    dayMinutes: r1(median(dayGaps)),
    nightMinutes: r1(median(nightGaps)),
    overallMinutes: r1(median(allGaps)),
    daySamples,
    nightSamples,
  };
}

/** 组装可直接上屏的文案。无实测数据时只报协议口径，并明确「尚无样本」。 */
export function cadenceLines(
  metric: MetricKey,
  dks: string[],
): { primary: string; secondary: string; denseAtNight: boolean } {
  const p = PROTOCOL_CADENCE[metric] ?? UNKNOWN_CADENCE;
  const m = computeMeasuredCadence(metric, dks);
  const total = m.daySamples + m.nightSamples;
  const fmt = (n: number | null) => (n == null ? '—' : `~${n} 分钟`);
  const primary = total === 0
    ? `采样频率 · 日间 ${p.day} ／ 夜间 ${p.night}`
    : `采样频率 · 实测 日间 ${fmt(m.dayMinutes)} ／ 夜间 ${fmt(m.nightMinutes)}（${total} 点）`;
  const denseAtNight =
    m.dayMinutes != null && m.nightMinutes != null && m.nightMinutes < m.dayMinutes * 0.8;
  const secondary = total === 0
    ? `${p.note} 当前范围内暂无样本，实测间隔待同步后计算。`
    : `${p.note}${denseAtNight ? ' 本次实测夜间确实比日间更密。' : ''} 协议口径：日间 ${p.day} ／ 夜间 ${p.night}（${p.source}）`;
  return { primary, secondary, denseAtNight };
}
