/**
 * 「当前这枚戒指的数据实况」—— 唯一口径（2026-11-07）
 *
 * 用户诉求：不要把 HK18 / 全量版协议和手上这枚 LunaMira 精简版混在一起，
 *           要在 App 上直接看清「到底连了个啥、哪些数据真的传上来了、频率多少」。
 *
 * 两条铁律：
 *  ① 能力清单 = 设备能力包真机实证（LUNAMIRA_BASE_CAPABILITY_FINGERPRINT），
 *     不是 SDK 全量协议文档；「硬件没有」与「没传上来」必须分开写。
 *  ② 点数 / 频率 = healthStore 里**真实落库样本的时间戳**算出来（中位数），
 *     不写死、不插值、不拿协议值冒充实测值。
 *
 * 统计窗口只取设备能存的天数（精简版 3 天）+ 本次 onBatch 实收的日期，
 * 并按 deviceId 校验实收摘要，换戒指即不认上一枚的数据。
 */
import { dayKey, healthStore, normalizeDayKey, type MetricKey } from '../data/healthStore';
import { computeMeasuredCadence } from './samplingCadence';
import { LUNAMIRA_BASE_CAPABILITY_FINGERPRINT, type DeviceProfileId } from '../config/deviceModel';
import type { BatchDaySummary, RingState } from '../ble/RingBleManager';

export type RealityState = 'ok' | 'empty' | 'channel' | 'none';

export interface RealityRow {
  key: string;
  label: string;
  unit: string;
  state: RealityState;
  /** 统计窗口内真实落库点数 */
  points: number;
  /** 单日最多点数 */
  maxPerDay: number;
  dayMinutes: number | null;
  nightMinutes: number | null;
  latest: number | null;
  /** 数据通道（逐点 slot / 日汇总 / 测量记录 / 硬件） */
  source: string;
  note: string;
}

export interface DeviceReality {
  profile: DeviceProfileId;
  modelLabel: string;
  identityRows: Array<{ label: string; value: string }>;
  cadenceHeadline: string;
  cadenceNative: string;
  cadenceCaveat: string;
  cadenceCompare: string;
  rows: RealityRow[];
  extras: RealityRow[];
  noSensor: string[];
  noSensorEvidence: string;
  latestBatch: BatchDaySummary | null;
  dayKeys: string[];
  windowLabel: string;
}

interface StreamSpec {
  key: MetricKey;
  label: string;
  unit: string;
}

/** LunaMira 精简版：onBatch 逐点 slot 实测只有这 5 个生命体征 + 时间戳 t。 */
const BASE_STREAMS: StreamSpec[] = [
  { key: 'hr', label: '心率 HR', unit: 'bpm' },
  { key: 'spo2', label: '血氧 SpO₂', unit: '%' },
  { key: 'hrv', label: 'HRV', unit: 'ms' },
  { key: 'bpSys', label: '收缩压', unit: 'mmHg' },
  { key: 'bpDia', label: '舒张压', unit: 'mmHg' },
];

/** 全量版（HK18 / LunaMira Pro）：SDK 协议全集，仅当真的连到这一档才展示。 */
const PRO_STREAMS: StreamSpec[] = [
  { key: 'hr', label: '心率 HR', unit: 'bpm' },
  { key: 'spo2', label: '血氧 SpO₂', unit: '%' },
  { key: 'hrv', label: 'HRV', unit: 'ms' },
  { key: 'bpSys', label: '收缩压', unit: 'mmHg' },
  { key: 'bpDia', label: '舒张压', unit: 'mmHg' },
  { key: 'temp', label: '体温', unit: '℃' },
  { key: 'rr', label: '呼吸率', unit: '次/分' },
  { key: 'eda', label: '皮电 EDA', unit: '' },
  { key: 'stress', label: '压力', unit: '' },
  { key: 'glucose', label: '血糖', unit: '' },
];

/** 精简版能力包明确不支持的传感器/功能（不是「没传」，是这枚戒指没有）。 */
const BASE_NO_SENSOR = [
  '体温', '血糖', '血脂四项 / 尿酸', '身体成分', '呼吸率',
  'ECG 心电', '皮电 EDA / 皮肤温度', '疲劳度', '情绪', '皮质醇实测',
  '呼吸暂停提醒', 'App 主动触发 HRV 测量',
];

const BASE_NO_SENSOR_EVIDENCE =
  '设备能力包：体温Type=0 · GluTag=0 · CompTag=0 · 身体成分=不支持 · 呼吸率=不支持 · ECG=不支持 · 疲劳=不支持';

function normId(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

function macTail(id: string | null): string {
  if (!id) return '未读取';
  const parts = id.split(':').filter(Boolean);
  return parts.length >= 2 ? `…${parts.slice(-2).join(':')}` : id;
}

function fmtMin(v: number | null): string {
  return v == null ? '—' : `~${v} 分钟`;
}

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function streamRow(spec: StreamSpec, dks: string[]): RealityRow {
  let points = 0;
  let maxPerDay = 0;
  let latest: number | null = null;
  let latestTs = -Infinity;
  for (const dk of dks) {
    let pts: Array<{ t: number; v: number }> = [];
    try {
      pts = healthStore.getIntraday(spec.key, dk) ?? [];
    } catch {
      pts = [];
    }
    points += pts.length;
    if (pts.length > maxPerDay) maxPerDay = pts.length;
    for (const p of pts) {
      if (Number.isFinite(p.t) && p.t > latestTs && Number.isFinite(p.v)) {
        latestTs = p.t;
        latest = p.v;
      }
    }
  }
  let m = { dayMinutes: null as number | null, nightMinutes: null as number | null };
  try {
    m = computeMeasuredCadence(spec.key, dks);
  } catch {
    /* 读取失败按无实测处理 */
  }
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    state: points > 0 ? 'ok' : 'empty',
    points,
    maxPerDay,
    dayMinutes: m.dayMinutes,
    nightMinutes: m.nightMinutes,
    latest,
    source: '逐点 slot（戒指原始回传）',
    note: points > 0 ? '已真实落库，可画全天曲线' : '本次窗口内没有有效样本',
  };
}

export function buildDeviceReality(ring: RingState, profile: DeviceProfileId): DeviceReality {
  const isBase = profile === 'BASE_UI';
  const storageDays = isBase ? LUNAMIRA_BASE_CAPABILITY_FINGERPRINT.watchDays : 7;

  // 统计窗口：设备能存的天数 + 本次 onBatch 实收日期（最多 7 天），统一 YYYY-MM-DD
  const set = new Set<string>();
  for (let i = 0; i < storageDays; i++) set.add(dayKey(Date.now() - i * 86400000));
  for (const k of Object.keys(ring.batchSummaries ?? {})) {
    const n = normalizeDayKey(k);
    if (/^\d{4}-\d{2}-\d{2}$/.test(n)) set.add(n);
  }
  const dayKeys = Array.from(set).sort().reverse().slice(0, 7);

  const rows = (isBase ? BASE_STREAMS : PRO_STREAMS).map((s) => streamRow(s, dayKeys));

  // ── 非逐点通道：日汇总 / 睡眠分期 ──
  const extras: RealityRow[] = [];
  const stepDays = dayKeys.filter((dk) => (ring as any).stepDaily?.[dk] != null);
  const latestStep = stepDays.length ? (ring as any).stepDaily[stepDays[0]] : null;
  extras.push({
    key: 'activity',
    label: '活动量日汇总',
    unit: '步',
    state: stepDays.length > 0 ? 'ok' : 'empty',
    points: stepDays.length,
    maxPerDay: 1,
    dayMinutes: null,
    nightMinutes: null,
    latest: latestStep?.steps ?? null,
    source: '日汇总 · 每日 1 条（非逐点）',
    note: stepDays.length > 0
      ? `近 ${stepDays.length} 天有日汇总；最近一天 ${Math.round(Number(latestStep?.steps ?? 0))} 步 · ${Number(latestStep?.distance ?? 0).toFixed(2)} km · ${Math.round(Number(latestStep?.calorie ?? 0))} kcal`
      : '本次窗口内没有日汇总',
  });

  const sleepDays = dayKeys.filter(
    (dk) => (ring as any).sleepDaily?.[dk] != null || ((ring as any).sleepStagesDaily?.[dk]?.length ?? 0) > 0,
  );
  const lastSleep = sleepDays.length ? (ring as any).sleepDaily[sleepDays[0]] : null;
  extras.push({
    key: 'sleep',
    label: '精准睡眠分期',
    unit: '分钟',
    state: sleepDays.length > 0 ? 'ok' : 'empty',
    points: sleepDays.length,
    maxPerDay: 1,
    dayMinutes: 1,
    nightMinutes: 1,
    latest: lastSleep?.total ?? null,
    source: isBase ? '精准睡眠 · 1 分钟 / 点（sleepTag=6）' : '睡眠分期数据',
    note: sleepDays.length > 0
      ? `近 ${sleepDays.length} 夜有分期；最近一夜共 ${Math.round(Number(lastSleep?.total ?? 0))} 分钟`
      : '本次窗口内没有睡眠分期',
  });

  if (isBase) {
    // ★ 2026-11-07（用户「压力还没同步」）：把「设备直传」与「App 推算」分开写，
    //   绝不拿推算点数冒充设备同步。
    //   设备能力包 StressType=2，但已装 APK 的原生桥没接 readDeviceManualData(STRESS)，
    //   slot 实测字段只有 hr,bpDia,bpSys,spo2,hrv,t → 压力由同一次同步的
    //   HRV/心率/血压真实读数推算（baseStressSync.ts，derived 标记）。
    const stress = streamRow({ key: 'stress', label: '压力', unit: '' }, dayKeys);
    const slotKeys = Array.from(new Set(
      Object.values(ring.batchSummaries ?? {}).flatMap((b) => b.slotKeys ?? []),
    ));
    const deviceSent = slotKeys.some((k) => /^(stress|pressure|pressureValue|stressValue|stressIndex)$/i.test(k));
    const derivedDays = dayKeys.filter((dk) => healthStore.isDerivedDay('stress', dk));
    if (deviceSent && derivedDays.length === 0 && stress.points > 0) {
      stress.state = 'ok';
      stress.source = '设备压力测量记录（STRESS）· 直传';
      stress.note = '原生已接通 STRESS 通道，设备实测已落库（稀疏点，不插值）';
    } else if (stress.points > 0 && derivedDays.length > 0) {
      stress.state = 'channel';
      stress.source = 'App 推算 · 非设备直传';
      stress.note = `设备 slot 无 pressure 字段（原生未接 STRESS 通道）；当前 ${stress.points} 点由同一次同步的 HRV/心率/血压真实读数推算，已标 derived，不是设备测量值`;
    } else {
      stress.state = 'channel';
      stress.source = '压力测量记录（STRESS），非连续';
      stress.note = '设备支持（StressType=2），但已装 APK 的原生桥未接手动测量记录通道；同步完成后会生成标注「推算」的参考值';
    }
    extras.push(stress);
  }

  // 实收摘要：只认当前 deviceId，换戒指后旧摘要一律不显示
  const curId = normId(ring.deviceId);
  const summaries = Object.values(ring.batchSummaries ?? {}).filter((s) => {
    const sid = normId(s.deviceId);
    return !sid || !curId || sid === curId;
  });
  const latestBatch = summaries.sort((a, b) => b.dayKey.localeCompare(a.dayKey))[0] ?? null;

  // ★ 频率分两层写，避免把「设备采样节奏」和「有效读数间隔」混成一个数：
  //   真机 1440 slot/天（1 分钟等间隔），但多数 slot 的生理字段是 0 占位，
  //   App 只落库有效读数（hr 39 / spo2 186 / hrv 92 / bp 39…），
  //   所以按有效读数算出的间隔会明显大于 1 分钟 —— 这不是丢包。
  const hr = rows.find((r) => r.key === 'hr');
  const cadenceHeadline = latestBatch && (latestBatch.dayMinutes != null || latestBatch.nightMinutes != null)
    ? `设备采样节奏：${latestBatch.dayKey} 收到 ${latestBatch.slotCount} 个时间点 · 日间 ${fmtMin(latestBatch.dayMinutes)} ／ 夜间 ${fmtMin(latestBatch.nightMinutes)}`
    : hr && hr.points > 0
      ? `有效读数实测：日间 ${fmtMin(hr.dayMinutes)} ／ 夜间 ${fmtMin(hr.nightMinutes)}（${dayKeys.length} 天共 ${hr.points} 个心率点）`
      : '本次窗口暂无样本，开启「数据同步」并等待戒指回传后重算';

  const cadenceNative = isBase
    ? '这枚精简版（原始协议版本 5）是全天 1 分钟等间隔，一天约 1440 个时间点，日间与夜间没有差别。'
    : '全量版按 SDK 原始数据桶（5 分钟，一天最多 288 条）+ 夜间 HRV / 血氧每分钟历史通道采集。';

  // ★ 用户明确要求「夜间高频、日间低频要标出来」：按有效读数逐指标判断，动态列出夜间更密的项
  const denseAtNight = rows.filter(
    (r) => r.dayMinutes != null && r.nightMinutes != null && r.nightMinutes < r.dayMinutes,
  );
  const denseText = denseAtNight.length > 0
    ? `按有效读数看，${denseAtNight.map((r) => r.label).join('、')} 夜间比日间更密（下方逐行标注），这是设备读数密度差异，不是采样节奏变了。`
    : '';
  const cadenceCaveat = (isBase
    ? '两层要分清：戒指每分钟回传一个 slot，但 slot 里多数生理字段是 0（无效占位），App 只落库有效读数。所以下面各指标的「点数」少于 1440、「有效读数间隔」大于 1 分钟，属正常，不是丢包。'
    : '点数只统计有效读数，0 值占位不落库。') + denseText;

  const cadenceCompare = isBase
    ? 'HK18 / 全量版的「5 分钟桶、夜间 HRV·血氧每分钟（洛伦兹 0–7 点）」是另一枚戒指的口径，不适用于当前这枚，本页也不统计它的数据。'
    : 'LunaMira 精简版的「全天 1 分钟等间隔、1440 点/天」是另一枚戒指的口径，不适用于当前这枚。';

  const identityRows = [
    { label: '机型', value: isBase ? 'LunaMira 精简版（BASE_UI）' : 'HK18 / Luna Mira Pro 全量版（PRO_UI）' },
    { label: '固件广播名', value: ring.deviceBroadcastName || '待读取' },
    { label: '固件版本', value: ring.firmware || '待同步' },
    {
      label: '协议 / 存储',
      value: isBase
        ? `原始协议版本 ${LUNAMIRA_BASE_CAPABILITY_FINGERPRINT.originProtocolVersion} · 存储 ${storageDays} 天`
        : 'SDK 全量协议',
    },
    { label: '设备身份', value: macTail(ring.deviceId ?? null) },
  ];

  return {
    profile,
    modelLabel: isBase ? 'LunaMira 精简版' : 'HK18 / 全量版',
    identityRows,
    cadenceHeadline,
    cadenceNative,
    cadenceCaveat,
    cadenceCompare,
    rows,
    extras,
    noSensor: isBase ? BASE_NO_SENSOR : [],
    noSensorEvidence: isBase ? BASE_NO_SENSOR_EVIDENCE : '',
    latestBatch,
    dayKeys,
    windowLabel: `统计窗口 ${dayKeys[dayKeys.length - 1] ?? '—'} ~ ${dayKeys[0] ?? '—'}（${dayKeys.length} 天，仅当前戒指）`,
  };
}
