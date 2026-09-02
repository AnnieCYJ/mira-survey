export const STATE_COLOR = {
  calm: '#6FCFB4',
  energy: '#9D8AF0',
  tense: '#E8A87C',
  tired: '#7EA6F8',
} as const;
export type StateKey = keyof typeof STATE_COLOR;

export const MOODS = [
  { key: 'energy', label: '元气满满', angle: 315, color: '#F0C46E' },
  { key: 'good', label: '状态良好', angle: 45, color: '#6FCFB4' },
  { key: 'neutral', label: '平平静静', angle: 135, color: '#9D8AF0' },
  { key: 'rest', label: '休息一下', angle: 225, color: '#F2A3C6' },
] as const;
export type MoodIndex = 0 | 1 | 2 | 3;
export const DEFAULT_MOOD: MoodIndex = 1;

export const TREND_SCRIPT: [StateKey, number][] = [
  ['tired', 30], ['tired', 26], ['calm', 24], ['calm', 22], ['calm', 24], ['calm', 28],
  ['calm', 32], ['calm', 40], ['energy', 52], ['energy', 64], ['energy', 72], ['energy', 70],
  ['energy', 66], ['tense', 60], ['tense', 58], ['energy', 64], ['energy', 68], ['tense', 62],
  ['tense', 58], ['energy', 60], ['energy', 56], ['tired', 46], ['tired', 42], ['energy', 52],
  ['energy', 60], ['energy', 64], ['tense', 62], ['tense', 58], ['energy', 60], ['energy', 56],
  ['tense', 54], ['tense', 50], ['tired', 44], ['tired', 40], ['calm', 46], ['calm', 52],
  ['calm', 58], ['calm', 62], ['calm', 56], ['calm', 48], ['calm', 42], ['tired', 36],
  ['tired', 32], ['tired', 28], ['calm', 26], ['calm', 24], ['tired', 22], ['tired', 24],
];
export const TREND_AXIS = ['0时', '4时', '8时', '12时', '16时', '20时', '24时'];

export type MetricKey = 'sleep' | 'cycle' | 'metabolism' | 'heart' | 'mind';

export interface MetricDef {
  name: string;
  tag: string;
  val: string;
  unit: string;
  delta: string;
  dir: 'up' | 'down';
  note: string;
  data: number[];
}

export const METRICS: Record<MetricKey, MetricDef> = {
  sleep: {
    name: '睡眠和激素',
    tag: '深睡 24%',
    val: '7h 12m',
    unit: '总睡眠',
    delta: '↑ 较上周 +38 分钟',
    dir: 'up',
    note: '生长激素在入睡后 90 分钟达到峰值，你的深睡窗口稳定在 01:20–03:40。',
    data: [46, 52, 48, 60, 58, 66, 72],
  },
  cycle: {
    name: '周期和激素',
    tag: '第 14 天',
    val: '排卵期',
    unit: '当前阶段',
    delta: '↑ 雌激素进入峰值',
    dir: 'up',
    note: '雌激素峰值通常带来更好的胰岛素敏感度与疼痛耐受度。',
    data: [30, 38, 52, 68, 82, 90, 86],
  },
  metabolism: {
    name: '代谢',
    tag: '静息代谢',
    val: '1,842',
    unit: 'kcal / 天',
    delta: '↓ 较上周 -24 kcal',
    dir: 'down',
    note: '黄体期基础代谢会自然上浮 5–10%，当前数值处于你的正常区间。',
    data: [62, 60, 64, 58, 61, 59, 57],
  },
  heart: {
    name: '心脏健康',
    tag: '静息 58 bpm',
    val: '62',
    unit: 'ms HRV',
    delta: '↑ 较上周 +6 ms',
    dir: 'up',
    note: 'HRV 连续 5 天高于你的个人基线，说明自主神经恢复良好。',
    data: [48, 50, 54, 52, 58, 60, 62],
  },
  mind: {
    name: '心理和压力',
    tag: '中等',
    val: '34',
    unit: '压力指数',
    delta: '↓ 较上周 -8',
    dir: 'up',
    note: '午后 14:00–16:00 出现两次明显压力峰，建议安排 5 分钟呼吸。',
    data: [58, 54, 60, 72, 66, 48, 34],
  },
};

export const METRIC_ORDER: MetricKey[] = ['sleep', 'cycle', 'metabolism', 'heart', 'mind'];

// ───────────────────────────────────────────────────────────
// 基础指标：戒指（HK18 / Veepoo）硬件可直接测量的生理信号
// 这些值当前为示例；连接戒指并完成实时命令接入后由 RingBle 推送真值。
// ───────────────────────────────────────────────────────────
import type { IconName } from '../components/Icon';

export interface BasicMetricDef {
  key: string;
  name: string;
  icon: IconName;
  /** 该信号归属的洞察页 tab：'basics'=基础指标，其余为五维之一。用于按维度渲染信号卡片。 */
  dimension: 'basics' | MetricKey;
  value: string;
  unit: string;
  range: string;
  data: number[]; // 全天趋势采样点（开启自动监测后展示，当前为示例）
  live: boolean; // 自动监测默认是否开启
  note: string;
  /** 监测频率：该指标戒指实际采集/上报的节奏（按《数据可用性定稿》+ 原生调度填真实值） */
  freq: string;
  /** 趋势图纵轴固定生理量程（避免小波动被自适应缩放拉满，造成"骗人"的剧烈起伏） */
  yMin: number;
  yMax: number;
  /** 自动同步类信号（睡眠/计步/血糖等无可手动触发的测量）隐藏"手动测量"按钮，避免误导；压力等可手动测的设为 false */
  hideMeasure?: boolean;
  /** 纯手动测量类信号（血糖/血脂/血压/梅脱/ECG/PPG/压力）：无自动数据流、趋势图恒空，
   *  洞察页改用 ManualMetricCard（无趋势图、数值左测量时间右、按钮置底）。 */
  manualOnly?: boolean;
  /** 手动测量后仍未读到数据时的提示文案（如设备不支持、需先在官方 App 测量等） */
  manualHint?: string;
  /** 仍在数据链路中（供其他卡片/结构卡聚合），但不在洞察页维度卡列表里单独展示 */
  hideInList?: boolean;
}

export const BASIC_METRICS: BasicMetricDef[] = [
  {
    key: 'hr',
    name: '心率',
    dimension: 'basics',
    icon: 'heart',
    value: '72',
    unit: 'bpm',
    range: '正常 60–100',
    data: [58, 56, 55, 54, 55, 57, 62, 70, 76, 78, 75, 72, 74, 80, 82, 79, 76, 73, 70, 68, 66, 64, 61, 59],
    live: true,
    note: '静息心率反映心脏负荷与恢复状态。',
    freq: '实时连续 · 约 1 次/秒',
    yMin: 40,
    yMax: 180,
  },
  {
    key: 'spo2',
    name: '血氧',
    dimension: 'basics',
    icon: 'drop',
    value: '98',
    unit: '%',
    range: '正常 95–100',
    data: [98, 98, 97, 97, 96, 97, 98, 99, 99, 98, 98, 97, 98, 99, 98, 97, 98, 99, 98, 97, 96, 97, 98, 98],
    live: true,
    note: '血氧饱和度，睡眠中持续低于 90% 值得关注。',
    freq: '实时连续 · 约 1 次/秒',
    yMin: 80,
    yMax: 100,
  },
  {
    key: 'temp',
    name: '体温',
    dimension: 'basics',
    icon: 'thermometer',
    value: '36.5',
    unit: '°C',
    range: '正常 36.0–37.2',
    data: [
      36.4, 36.3, 36.2, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7, 36.8, 36.9, 36.8,
      36.9, 37.0, 36.9, 36.8, 36.7, 36.6, 36.5, 36.5, 36.4, 36.4, 36.3, 36.4,
    ],
    live: true,
    note: '皮肤温度随周期激素波动，排卵期后略升。',
    freq: '单次测量 · 约每 20 秒',
    yMin: 35,
    yMax: 38.5,
  },
  {
    key: 'eda',
    name: 'EDA 皮电',
    dimension: 'basics',
    icon: 'activity',
    value: '4.2',
    unit: 'µS',
    range: '静息 < 8',
    data: [3, 2.5, 2, 1.8, 2, 2.4, 3.5, 5, 7, 6, 4, 3, 4, 6, 8, 7, 5, 4, 3.5, 3, 2.5, 2, 1.8, 2.2],
    live: true,
    note: '皮电活动对应交感神经唤醒，是压力的直接信号。',
    freq: '单次测量 · 约每 20 秒',
    yMin: 0,
    yMax: 15,
  },
  {
    key: 'hrv',
    name: '心率变异性',
    dimension: 'basics',
    icon: 'heart',
    value: '62',
    unit: 'ms',
    range: '越高越好',
    data: [88, 90, 92, 94, 91, 86, 78, 64, 56, 58, 62, 66, 60, 54, 52, 55, 58, 62, 68, 74, 80, 84, 88, 90],
    live: true,
    note: 'HRV 高说明自主神经恢复良好、抗压能力强。',
    freq: '每日自动采集 · App 每 5 分钟读取',
    yMin: 0,
    yMax: 150,
  },
];

// ───────────────────────────────────────────────────────────
// 扩展信号：均由原生桥（健康一览 healthGlance + 每日 auto_data 睡眠/计步回读）自动接入，
// 协议文档确认本戒指固件真实返回的字段。每个信号一张 BasicMetricCard，令牌与基础指标一致。
// 均为「自动同步」类（hideMeasure），无手动测量按钮、无「待接入」占位卡。
// （呼吸率/静息代谢/血压/ECG/PPG 在本戒指固件上返回 0 或硬件未开放，已按用户要求从 App 移除。）
// ───────────────────────────────────────────────────────────
export const EXTENDED_SIGNALS: BasicMetricDef[] = [
  // —— 睡眠和激素 ——（来自设备每日 auto_data 睡眠回读，无特殊硬件要求）
  {
    key: 'sleepTotal', name: '睡眠总时长', icon: 'ring', dimension: 'sleep',
    value: '—', unit: 'h', range: '成人建议 7–9h', data: [], live: false,
    note: '戒指每日自动记录总睡眠时长，反映休息是否充足。', freq: '每日自动同步', yMin: 0, yMax: 12, hideInList: true,
  },
  {
    key: 'sleepDeep', name: '深睡占比', icon: 'ring', dimension: 'sleep',
    value: '—', unit: '%', range: '健康 15–25%', data: [], live: false,
    note: '深睡是身体修复的关键阶段，占比过低提示恢复不足。', freq: '每日自动同步', yMin: 0, yMax: 100, hideInList: true,
  },
  {
    key: 'sleepRem', name: 'REM 占比', icon: 'ring', dimension: 'sleep',
    value: '—', unit: '%', range: '健康 20–25%', data: [], live: false,
    note: 'REM 睡眠与记忆巩固、情绪调节密切相关。', freq: '每日自动同步', yMin: 0, yMax: 100, hideInList: true,
  },
  {
    key: 'sleepScore', name: '睡眠评分', icon: 'ring', dimension: 'sleep',
    value: '—', unit: '分', range: '越高越好', data: [], live: false,
    note: '综合入睡时长与睡眠结构的整体睡眠质量评分。', freq: '每日自动同步', yMin: 0, yMax: 100, hideInList: true,
  },
  // —— 代谢 ——（auto_data 计步 + 健康一览 血糖/血脂/尿酸）
  {
    key: 'steps', name: '步数', icon: 'ring', dimension: 'metabolism',
    value: '—', unit: '步', range: '目标 10000', data: [], live: false,
    note: '全天步数，反映日常活动量。', freq: '每日自动同步', yMin: 0, yMax: 20000,
  },
  {
    key: 'distance', name: '步行距离', icon: 'ring', dimension: 'metabolism',
    value: '—', unit: 'km', range: '—', data: [], live: false,
    note: '步行与跑步累计距离。', freq: '每日自动同步', yMin: 0, yMax: 20,
  },
  {
    key: 'calorie', name: '活动消耗', icon: 'ring', dimension: 'metabolism',
    value: '—', unit: 'kcal', range: '—', data: [], live: false,
    note: '全天活动消耗的热量。', freq: '每日自动同步', yMin: 0, yMax: 4000,
  },
  {
    key: 'bloodSugar', name: '血糖', icon: 'drop', dimension: 'metabolism',
    value: '—', unit: 'mmol/L', range: '正常 3.9–6.1', data: [], live: false, hideMeasure: true,
    note: '健康一览自动评估的血糖估算值，非静脉血糖，仅供参考。', freq: '健康一览自动同步', yMin: 2, yMax: 12,
  },
  {
    key: 'bloodFat', name: '血脂（总胆固醇）', icon: 'drop', dimension: 'metabolism',
    value: '—', unit: 'mmol/L', range: '参考报告', data: [], live: false, hideMeasure: true,
    note: '血液成分中的总胆固醇浓度，健康一览自动同步。', freq: '健康一览自动同步', yMin: 0, yMax: 10,
  },
  {
    key: 'uricAcid', name: '尿酸', icon: 'drop', dimension: 'metabolism',
    value: '—', unit: 'μmol/L', range: '正常 155–428', data: [], live: false, hideMeasure: true,
    note: '血液成分中的尿酸浓度，与饮食、嘌呤代谢相关。健康一览自动同步。', freq: '健康一览自动同步', yMin: 50, yMax: 600,
  },
  // —— 心理和压力 ——（全部来自健康一览 healthGlance 自动快照；协议 dataType 3 压力 / 11 疲劳度 / 10 情绪 / 12 皮电 / 皮质醇）
  {
    key: 'stress', name: '压力', icon: 'mind', dimension: 'mind',
    value: '—', unit: '', range: '0–100，越高越紧张', data: [], live: false, hideMeasure: true,
    note: '设备压力/紧张度读数，与皮电 GSR 的交感分量互为印证。健康一览自动同步。', freq: '健康一览自动同步', yMin: 0, yMax: 100,
  },
  {
    key: 'fatigue', name: '疲劳度', icon: 'mind', dimension: 'mind',
    value: '—', unit: '', range: '0–100，越高越疲劳', data: [], live: false, hideMeasure: true,
    note: '健康一览自动评估的身体疲劳程度，与睡眠质量、活动量相关。', freq: '健康一览自动同步', yMin: 0, yMax: 100,
  },
  {
    key: 'emotion', name: '情绪', icon: 'mind', dimension: 'mind',
    value: '—', unit: '', range: '-10–10，负向偏低落、正向偏高涨', data: [], live: false, hideMeasure: true,
    note: '健康一览自动评估的实时情绪状态，范围 -10（低落）到 10（高涨）。', freq: '健康一览自动同步', yMin: -10, yMax: 10,
  },
  {
    key: 'skin', name: '皮肤含水量', icon: 'mind', dimension: 'mind',
    value: '—', unit: '%', range: '1–99，越高越润泽', data: [], live: false, hideMeasure: true,
    note: '健康一览自动评估的皮肤含水量（皮电 GSR 相关），随 hydration 与周期波动。', freq: '健康一览自动同步', yMin: 1, yMax: 99,
  },
  {
    key: 'cortisol', name: '皮质醇', icon: 'ring', dimension: 'sleep',
    value: '—', unit: 'μg/L', range: '正常 ~50–250（晨高夜低）', data: [], live: false, hideMeasure: true,
    note: '压力激素皮质醇浓度，随昼夜节律波动（晨高夜低）。健康一览自动同步。', freq: '健康一览自动同步', yMin: 0, yMax: 500,
  },
];

/** 取某维度 tab 下应展示的信号卡片：'basics' 返回 6 个实时基础信号，其余返回对应维度的扩展信号。 */
export function signalsForDimension(dim: 'basics' | MetricKey): BasicMetricDef[] {
  if (dim === 'basics') return BASIC_METRICS;
  return EXTENDED_SIGNALS.filter((m) => m.dimension === dim && !m.hideInList);
}

export type RangeKey = 'day' | 'week' | 'month' | 'year';

export const RANGE_DEF: Record<RangeKey, { label: string; n: number; axis: string[] }> = {
  day: { label: '日', n: 24, axis: ['0', '4', '8', '12', '16', '20', '24'] },
  week: { label: '周', n: 7, axis: ['一', '二', '三', '四', '五', '六', '日'] },
  month: { label: '月', n: 30, axis: ['1', '5', '10', '15', '20', '25', '30'] },
  year: { label: '年', n: 12, axis: ['1月', '3月', '5月', '7月', '9月', '11月'] },
};

export interface SeriesParam {
  base: number;
  amp: number;
  cycles: number;
  phase: number;
  seed: number;
  min?: number;
  max?: number;
}

export const SERIES_PARAM: Record<MetricKey, Record<RangeKey, SeriesParam>> = {
  sleep: {
    day: { base: 46, amp: 42, cycles: 1, phase: 1.571, seed: 3, min: 0, max: 100 },
    week: { base: 7.1, amp: 0.6, cycles: 1.5, phase: 0, seed: 5, min: 4.5, max: 10 },
    month: { base: 7.2, amp: 0.7, cycles: 4, phase: 1, seed: 7, min: 4.5, max: 10 },
    year: { base: 7.0, amp: 0.4, cycles: 2, phase: 0.5, seed: 2, min: 5, max: 9.5 },
  },
  cycle: {
    day: { base: 58, amp: 24, cycles: 1, phase: -0.31, seed: 4, min: 0, max: 100 },
    week: { base: 62, amp: 18, cycles: 1, phase: 0, seed: 6, min: 0, max: 100 },
    month: { base: 55, amp: 32, cycles: 1, phase: -1.38, seed: 8, min: 0, max: 100 },
    year: { base: 58, amp: 12, cycles: 3, phase: 0, seed: 1, min: 0, max: 100 },
  },
  metabolism: {
    day: { base: 76, amp: 30, cycles: 1, phase: -1.571, seed: 9, min: 0, max: 100 },
    week: { base: 1842, amp: 90, cycles: 1.5, phase: 0, seed: 2, min: 1400, max: 2400 },
    month: { base: 1836, amp: 70, cycles: 1.2, phase: -1.2, seed: 4, min: 1400, max: 2400 },
    year: { base: 1820, amp: 60, cycles: 2, phase: 0.5, seed: 6, min: 1400, max: 2400 },
  },
  heart: {
    day: { base: 58, amp: 16, cycles: 1, phase: 1.571, seed: 7, min: 25, max: 110 },
    week: { base: 60, amp: 8, cycles: 1.2, phase: 0, seed: 3, min: 25, max: 110 },
    month: { base: 59, amp: 9, cycles: 3, phase: 1, seed: 5, min: 25, max: 110 },
    year: { base: 57, amp: 6, cycles: 2, phase: 0.4, seed: 8, min: 25, max: 110 },
  },
  mind: {
    day: { base: 40, amp: 26, cycles: 1, phase: -1.571, seed: 1, min: 0, max: 100 },
    week: { base: 42, amp: 14, cycles: 1.5, phase: 0, seed: 9, min: 0, max: 100 },
    month: { base: 44, amp: 16, cycles: 3.5, phase: 0.8, seed: 2, min: 0, max: 100 },
    year: { base: 41, amp: 10, cycles: 2, phase: 0.3, seed: 4, min: 0, max: 100 },
  },
};

export const RANGE_UNIT: Record<
  MetricKey,
  Record<RangeKey, { unit: string; fmt: (v: number) => string }>
> = {
  sleep: {
    day: { unit: '睡眠深度', fmt: (v) => `${Math.round(v)}%` },
    week: { unit: '日均睡眠', fmt: (v) => `${v.toFixed(1)} h` },
    month: { unit: '日均睡眠', fmt: (v) => `${v.toFixed(1)} h` },
    year: { unit: '月均睡眠', fmt: (v) => `${v.toFixed(1)} h` },
  },
  cycle: {
    day: { unit: '雌激素指数', fmt: (v) => `${Math.round(v)}` },
    week: { unit: '周内均值', fmt: (v) => `${Math.round(v)}` },
    month: { unit: '周期内均值', fmt: (v) => `${Math.round(v)}` },
    year: { unit: '年度均值', fmt: (v) => `${Math.round(v)}` },
  },
  metabolism: {
    day: { unit: '代谢率指数', fmt: (v) => `${Math.round(v)}` },
    week: { unit: '日均消耗', fmt: (v) => `${Math.round(v)} kcal` },
    month: { unit: '日均消耗', fmt: (v) => `${Math.round(v)} kcal` },
    year: { unit: '月均消耗', fmt: (v) => `${Math.round(v)} kcal` },
  },
  heart: {
    day: { unit: '当前 HRV', fmt: (v) => `${Math.round(v)} ms` },
    week: { unit: '周均 HRV', fmt: (v) => `${Math.round(v)} ms` },
    month: { unit: '月均 HRV', fmt: (v) => `${Math.round(v)} ms` },
    year: { unit: '年均 HRV', fmt: (v) => `${Math.round(v)} ms` },
  },
  mind: {
    day: { unit: '当前压力', fmt: (v) => `${Math.round(v)}` },
    week: { unit: '周均压力', fmt: (v) => `${Math.round(v)}` },
    month: { unit: '月均压力', fmt: (v) => `${Math.round(v)}` },
    year: { unit: '年均压力', fmt: (v) => `${Math.round(v)}` },
  },
};

export const RANGE_NOTE: Record<RangeKey, Record<MetricKey, string>> = {
  day: {
    sleep: '夜间曲线反映你的睡眠结构。深睡集中在 01:20–03:40。',
    cycle: '雌激素在清晨达到日内高点，午后缓慢回落。',
    metabolism: '代谢率从清晨开始爬升，午后进入平台。',
    heart: 'HRV 在深睡阶段最高，白天随活动和压力下降。',
    mind: '压力指数在午后出现明显峰值，与你的会议时段重合。',
  },
  week: {
    sleep: '本周睡眠时长整体上行，工作日与周末差异在 40 分钟以内。',
    cycle: '本周处于卵泡期末段，雌激素持续爬升。',
    metabolism: '本周静息代谢波动不大，处在你的正常区间。',
    heart: '本周 HRV 连续高于个人基线，恢复良好。',
    mind: '本周压力峰值集中在工作日中段，周末明显回落。',
  },
  month: {
    sleep: '整月睡眠在排卵期后略有下降，与孕激素升高一致。',
    cycle: '完整周期呈现清晰的单峰曲线，峰值在第 14 天附近。',
    metabolism: '整月代谢在黄体期上浮约 5–8%。',
    heart: '整月 HRV 呈缓慢上行趋势，正向平衡。',
    mind: '整月压力与工作节奏高度相关。',
  },
  year: {
    sleep: '全年睡眠时长冬季略长、夏季略短，无结构性问题。',
    cycle: '全年周期长度稳定在 27–29 天。',
    metabolism: '全年基础代谢随体成分缓慢变化。',
    heart: '全年 HRV 随训练周期波动，冬季略低属正常。',
    mind: '全年压力与工作项目节奏吻合，无长期升高。',
  },
};

export function genSeries(p: SeriesParam, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const s = Math.sin(t * p.cycles * 2 * Math.PI + p.phase);
    const noise = (((i * 13 + p.seed * 7) % 7) - 3) * (p.amp / 14);
    let v = p.base + p.amp * s + noise;
    if (p.min !== undefined) v = Math.max(p.min, v);
    if (p.max !== undefined) v = Math.min(p.max, v);
    out.push(v);
  }
  return out;
}
