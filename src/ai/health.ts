// 健康数据快照：注入所有可获取的健康数据给 MiraAI
// 包括：实时原始值、计算型结果（stress/cognitive/cortisol）、历史趋势摘要、周期预测
// Token budget 控制：健康块总计 ≤ 800 token，留空间给 system prompt + 对话历史

import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey, type MetricKey } from '../data/healthStore';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { analyzeCortisol } from '../lib/cortisolRhythm';

const FEMALE_STATE: Record<number, string> = {
  0: '未设置经期', 1: '月经期', 2: '备孕期', 3: '怀孕期', 4: '辣妈期',
};

function fmt(v: number | null | undefined, unit = '', digits = 1): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)}${unit}`;
}

function trendDir(vals: number[]): string {
  if (vals.length < 4) return '';
  const mid = Math.floor(vals.length / 2);
  const a = vals.slice(0, mid).reduce((x, y) => x + y, 0) / mid;
  const b = vals.slice(mid).reduce((x, y) => x + y, 0) / (vals.length - mid);
  const diff = b - a;
  const pct = a > 0 ? (diff / a) * 100 : 0;
  if (Math.abs(pct) < 8) return '基本持平';
  return pct > 0 ? `上升 ${fmt(Math.abs(pct), '%', 0)}` : `下降 ${fmt(Math.abs(pct), '%', 0)}`;
}

/** 近 N 天某指标的摘要：均值 + 趋势方向（用 healthStore.getMetricDailyMeans 公开 API） */
function metricHistorySummary(metric: MetricKey, days = 7): string | null {
  try {
    const vals = healthStore.getMetricDailyMeans(metric, days);
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const dir = trendDir(vals.slice().reverse());
    return `近${days}天均值 ${fmt(mean)}，${dir}`;
  } catch { return null; }
}

/** 计算型结果：优先读缓存，缓存没有才现算（现算会自动回写缓存） */
function getAnalysisBlock(): string {
  const today = dayKey(Date.now());
  const cached = healthStore.getAnalysis(today);
  const parts: string[] = [];

  // Stress
  try {
    const s = cached?.stress ?? (() => {
      const r = computeStressReport();
      return {
        score: r.score, peakHour: r.peakHour, emotionalLoad: r.emotionalLoad,
        avgRecoverySec: r.avgRecoverySec, eventCount: r.events.length,
      };
    })();
    if (s) {
      const peak = s.peakHour != null ? `${String(s.peakHour).padStart(2,'0')}:00` : '-';
      const rec = s.avgRecoverySec != null ? `${Math.round(s.avgRecoverySec)}s` : '-';
      parts.push(`压力:评分 ${s.score}，事件 ${s.eventCount} 次，峰值 ${peak}，平均恢复 ${rec}`);
    }
  } catch {}

  // Cognitive
  try {
    const c = cached?.cognitive ?? (() => {
      const r = computeCognitiveLoadReport();
      return {
        loadScore: r.loadScore, fatigueIndex: r.fatigueIndex,
        peakHour: r.peakLoadSpan?.startHour ?? null,
        bestHour: r.bestSpan?.startHour ?? null,
        recoveryCapacity: r.recoveryCapacity,
      };
    })();
    if (c) {
      const peak = c.peakHour != null ? `${String(c.peakHour).padStart(2,'0')}:00` : '-';
      const best = c.bestHour != null ? `${String(c.bestHour).padStart(2,'0')}:00` : '-';
      parts.push(`脑力:负荷 ${c.loadScore}，疲劳 ${c.fatigueIndex}，峰值 ${peak}，最佳 ${best}，恢复力 ${c.recoveryCapacity != null ? fmt(c.recoveryCapacity, '%', 0) : '-'}`);
    }
  } catch {}

  // Cortisol
  try {
    const cc = cached?.cortisol;
    if (cc) {
      const acro = `${String(Math.floor(cc.acrophaseH)).padStart(2,'0')}:${String(Math.round((cc.acrophaseH % 1) * 60)).padStart(2,'0')}`;
      const cmap: Record<string, string> = { normal: '正常', sustained_high: '持续偏高', dysregulated: '节律紊乱' };
      const cssLabel = cc.css > 10 ? '早起型' : cc.css < -10 ? '晚睡型' : '不明显';
      parts.push(`皮质醇:峰值 ${acro}，振幅 ${fmt(cc.amplitude)}，节律 ${cmap[cc.status] ?? cc.status}，作息 ${cssLabel}，偏高连续 ${cc.sustainedHighStreak} 天`);
    }
  } catch {}

  return parts.length ? parts.join('；') : '';
}

/** 周期相位块：用 RingBle 已算好的 curveStatus（同步可用） */
function getCycleBlock(): string {
  const st = RingBle.getState();
  const cs = st.curveStatus;
  const parts: string[] = [];

  if (cs) {
    if (cs.hasLog) {
      parts.push(`周期相位:${cs.phaseLabel}`);
      if (cs.dayInCycle != null) parts.push(`周期第 ${cs.dayInCycle} 天`);
    } else {
      const fem = st.female;
      if (fem?.lastMenstrualDate) {
        parts.push(`周期相位:${FEMALE_STATE[fem.state ?? 0] ?? '未知'}`);
        parts.push(`末次经期:${fem.lastMenstrualDate}`);
      }
    }
    if (cs.estrogenIndex != null) parts.push(`雌激素指数:${fmt(cs.estrogenIndex)}`);
  } else {
    const fem = st.female;
    if (fem?.lastMenstrualDate) {
      parts.push(`周期相位:${FEMALE_STATE[fem.state ?? 0] ?? '未知'}`);
      parts.push(`末次经期:${fem.lastMenstrualDate}`);
    }
  }
  return parts.join('；');
}

/** 历史趋势摘要 */
function getTrendBlock(): string {
  const metrics: { key: MetricKey; label: string }[] = [
    { key: 'hrv', label: 'HRV' },
    { key: 'hr', label: '心率' },
    { key: 'stress', label: '压力' },
    { key: 'eda', label: '皮电' },
    { key: 'spo2', label: '血氧' },
    { key: 'temp', label: '体温' },
    { key: 'bpSys', label: '收缩压' },
    { key: 'bpDia', label: '舒张压' },
  ];
  const parts: string[] = [];
  for (const m of metrics) {
    const s = metricHistorySummary(m.key, 7);
    if (s) parts.push(`${m.label}${s}`);
  }
  // 睡眠评分从 healthStore.getSleep 拿（不是 MetricKey）
  try {
    const sleepMeans: number[] = [];
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      const dk = dayKey(now - i * 86400000);
      const ss = healthStore.getSleep(dk);
      if (ss && ss.score != null && !Number.isNaN(ss.score)) sleepMeans.push(ss.score);
    }
    if (sleepMeans.length >= 2) {
      const mean = sleepMeans.reduce((a, b) => a + b, 0) / sleepMeans.length;
      const dir = trendDir(sleepMeans.slice().reverse());
      parts.push(`睡眠评分近7天均值 ${fmt(mean)}，${dir}`);
    }
  } catch {}
  return parts.length ? parts.join('；') : '';
}

export function buildHealthSnapshot(): string {
  const st = RingBle.getState();
  const daily = st.daily || {};
  const blocks: string[] = [];

  // ① 今日实时值
  const rt: string[] = [];
  const add = (label: string, v: string | null) => { if (v) rt.push(`${label}=${v}`); };
  add('心率', fmt(daily['hr'], 'bpm'));
  add('血氧', fmt(daily['spo2'], '%'));
  add('HRV', fmt(daily['hrv'], 'ms'));
  add('体温', fmt(daily['temp'], '℃'));
  add('皮电', fmt(daily['eda']));
  add('步数', fmt(daily['steps']));
  add('睡眠总时长', fmt(daily['sleepTotal'], 'min'));
  add('深睡', fmt(daily['sleepDeep'], 'min'));
  add('REM', fmt(daily['sleepRem'], 'min'));
  add('睡眠评分', fmt(daily['sleepScore']));
  add('压力', fmt(daily['stress']));
  add('血糖', fmt(daily['bloodSugar']));
  add('血脂', fmt(daily['cholesterol']));
  add('梅脱', fmt(daily['metabolicRate']));
  const tl = st.statusTimeline || [];
  if (tl.length) {
    const last = tl[tl.length - 1];
    add('今日状态值', `${last.value}/100(${last.level})`);
  }
  if (rt.length) blocks.push(`今日实时:${rt.join('；')}`);

  // ② 计算型结果（stress/cognitive/cortisol）
  const analysis = getAnalysisBlock();
  if (analysis) blocks.push(`计算结果:${analysis}`);

  // ③ 周期相位
  const cycle = getCycleBlock();
  if (cycle) blocks.push(cycle);

  // ④ 历史趋势摘要
  const trend = getTrendBlock();
  if (trend) blocks.push(`近7天:${trend}`);

  if (blocks.length === 0) return '';
  return (
    '【用户健康数据（仅作回答参考，不要逐条播报；用户没问就不主动提）】\\n' +
    blocks.join('\\n')
  );
}
