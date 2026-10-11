/**
 * Emotion Engine — Valence + Arousal (Russell Circumplex)
 *
 * arousal: EDA/SCR density + SNS + HR, personal baseline 或绝对基准
 * valence: RMSSD preservation under arousal (Threat-Challenge)
 *
 * 5-class: focused | calm | stressed | bored | depleted
 */
import { healthStore, type MetricKey } from '../data/healthStore';
import { computeCycle, dayKey as cycleDayKey, type CyclePhase, type CycleInfo, type CycleLog } from './cycleMath';
import * as FileSystem from 'expo-file-system';

export type EmotionLabel = 'stressed' | 'focused' | 'calm' | 'bored' | 'depleted';

export interface EmotionSnapshot {
  t: number;
  arousalScore: number;
  valenceScore: number;
  emotionLabel: EmotionLabel;
  scrPeaksPerMin: number;
  scrMeanAmp: number | null;
  reason: string;
  updatedAt: number;
  cyclePhase: CyclePhase | 'unknown';
  cycleDayInPhase: number | null;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function personalRange(metric: MetricKey, nowMs = Date.now()) {
  const DAY = 86400000;
  const all: number[] = [];
  for (let i = 1; i <= 14; i++) {
    const date = new Date(nowMs);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const start = date.getTime();
    const pts = healthStore.getTimeRange(metric, start, start + DAY, { maxPoints: 500 });
    pts.forEach((p: any) => all.push(p.v));
  }
  if (all.length < 10) return null;
  all.sort((a, b) => a - b);
  return { p10: all[Math.floor(all.length * 0.1)], p95: all[Math.floor(all.length * 0.95)], mean: all.reduce((a, b) => a + b, 0) / all.length };
}

function personalNorm(v: number, range: { p10: number; p95: number } | null): number | null {
  if (!range || range.p95 === range.p10) return null;
  return clamp((v - range.p10) / (range.p95 - range.p10) * 2 - 1, -1, 1);
}

function hasFreshSample(points: Array<{ t: number }>, nowMs: number, maxAgeMs = 30 * 60 * 1000): boolean {
  return points.some((point) => Number.isFinite(point.t) && nowMs - point.t >= 0 && nowMs - point.t <= maxAgeMs);
}

/** ★ 经期相位感知 — 获取当前相位 */
/** Module-level 缓存的 CycleLog — 同步读, 异步刷新 (每 5min 或首次 load) */
let _cachedCycleLog: CycleLog | null = null;
let _lastCycleLogFetch = 0;

async function refreshCycleLogCache() {
  try {
    const PATH = (FileSystem.documentDirectory ?? '') + 'mira_cycle_log.json';
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) { _cachedCycleLog = null; _lastCycleLogFetch = Date.now(); return; }
    const raw = await FileSystem.readAsStringAsync(PATH);
    const j = JSON.parse(raw) as any;
    if (j && j.lastPeriodStart) {
      _cachedCycleLog = {
        lastPeriodStart: String(j.lastPeriodStart),
        cycleLength: Number(j.cycleLength) || 28,
        lutealLength: Number(j.lutealLength) || 14,
        periodLength: Number(j.periodLength) || 5,
        history: Array.isArray(j.history) ? j.history.map(String) : undefined,
      };
    }
    _lastCycleLogFetch = Date.now();
  } catch {
    /* 静默 */
  }
}

/** 启动时 + 每 5min 后台刷新一次 */
refreshCycleLogCache();  // fire-and-forget
setInterval(() => { refreshCycleLogCache(); }, 5 * 60 * 1000);

function getCurrentPhase(nowMs: number, cycleOverride?: CycleInfo): { phase: CyclePhase | 'unknown'; cycleInfo: CycleInfo | null } {
  try {
    if (cycleOverride) return { phase: cycleOverride.phase, cycleInfo: cycleOverride };
    const d = new Date(nowMs);
    if (!_cachedCycleLog || !_cachedCycleLog.lastPeriodStart) {
      return { phase: 'unknown', cycleInfo: null };
    }
    const tempSeries: { date: string; temp: number }[] = [];
    for (let offset = 0; offset <= 60; offset += 1) {
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const dateKey = cycleDayKey(date);
      const temp = healthStore.getDay('temp', dateKey)?.mean;
      if (typeof temp === 'number' && Number.isFinite(temp)) {
        tempSeries.push({ date: dateKey, temp });
      }
    }
    const info = computeCycle(_cachedCycleLog, d, {
      tempSeries,
      periodHistory: _cachedCycleLog.history,
    });
    return { phase: info.phase, cycleInfo: info };
  } catch {
    return { phase: 'unknown', cycleInfo: null };
  }
}

// 相位感知: 只用于给 label 加语境, 不改检测阈值 (用户反馈的情绪就是真实的)

function phaseLabel(phase: CyclePhase | 'unknown') {
  switch (phase) {
    case 'period': return '经期';
    case 'follicular': return '卵泡期';
    case 'ovulation': return '排卵期';
    case 'luteal': return '黄体期';
    default: return null;
  }
}

function computeSCRFeatures(edaPts: Array<{ t: number; v: number }>, _fs = 0.1, windowMin = 60) {
  if (edaPts.length < 5) return { peaksPerMin: 0, meanAmp: null, meanT50: null, tonicMean: null };
  const recent = edaPts.slice(-Math.min(edaPts.length, windowMin * 6));
  const mean = recent.reduce((s, p) => s + p.v, 0) / recent.length;
  const peaks: number[] = [];
  for (let i = 1; i < recent.length - 1; i++) {
    if (recent[i].v > recent[i - 1].v && recent[i].v > recent[i + 1].v && recent[i].v - mean > 0.1) {
      peaks.push(recent[i].v - mean);
    }
  }
  const minutes = Math.max(1, (recent[recent.length - 1].t - recent[0].t) / 60000);
  return {
    peaksPerMin: peaks.length / minutes,
    meanAmp: peaks.length > 0 ? peaks.reduce((s, a) => s + a, 0) / peaks.length : null,
    meanT50: null,
    tonicMean: mean,
  };
}

export function computeEmotionSnapshot(nowMs = Date.now(), cycleOverride?: CycleInfo): EmotionSnapshot | null {
  const DAY = 86400000;
  const currentDate = new Date(nowMs);
  const today = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  ).getTime();

  const edaPts = healthStore.getTimeRange('eda' as MetricKey, today, nowMs, { maxPoints: 500 });
  const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, today, nowMs, { maxPoints: 500 });
  const snsPts = healthStore.getTimeRange('sns' as MetricKey, today, nowMs, { maxPoints: 500 });
  const hrPts = healthStore.getTimeRange('hr' as MetricKey, today, nowMs, { maxPoints: 500 });
  // 设备原生 emotionLevel：协议值域约 -10～+10，作为情绪方向主输入。
  const emotionPts = healthStore.getTimeRange('emotion' as MetricKey, today, nowMs, { maxPoints: 120 });

  const hasHrv = hrvPts.length >= 1;
  const arousalSrcs = [edaPts.length, snsPts.length, hrPts.length].filter(n => n >= 1).length;
  const hasFreshHrv = hasFreshSample(hrvPts, nowMs);
  const hasFreshArousal = [edaPts, snsPts, hrPts].some((points) => hasFreshSample(points, nowMs));
  if (!hasHrv || arousalSrcs < 1 || !hasFreshHrv || !hasFreshArousal) return null;

  const edaRange = personalRange('eda' as MetricKey, nowMs);
  const hrvRange = personalRange('hrv' as MetricKey, nowMs);
  const snsRange = personalRange('sns' as MetricKey, nowMs);
  const hrRange = personalRange('hr' as MetricKey, nowMs);

  const edaNow = edaPts.length > 0 ? edaPts[edaPts.length - 1].v : null;
  const hrvNow = hrvPts.length > 0 ? hrvPts[hrvPts.length - 1].v : null;
  const snsNow = snsPts.length > 0 ? snsPts[snsPts.length - 1].v : null;
  const hrNow = hrPts.length > 0 ? hrPts[hrPts.length - 1].v : null;
  const deviceEmotionNow = emotionPts.length > 0 ? clamp(emotionPts[emotionPts.length - 1].v, -10, 10) : null;

  const edaNorm = edaNow != null ? personalNorm(edaNow, edaRange) : null;
  const hrvNorm = hrvNow != null ? personalNorm(hrvNow, hrvRange) : null;
  const snsNorm = snsNow != null ? personalNorm(snsNow, snsRange) : null;
  const hrNorm = hrNow != null ? personalNorm(hrNow, hrRange) : null;

  const scr = computeSCRFeatures(edaPts, 0.1, 60);

  // === AROUSAL ===
  const parts: number[] = [];
  if (edaNorm != null) parts.push(clamp(edaNorm, 0, 1));
  if (snsNorm != null) parts.push(clamp(snsNorm, 0, 1));
  if (hrNorm != null) parts.push(clamp(hrNorm, 0, 1));
  const scrArousal = clamp(scr.peaksPerMin / 5, 0, 1);
  parts.push(scrArousal);

  let arousalScore: number;
  if (parts.length <= 1) {
    arousalScore = 30 + scrArousal * 40;  // 低数据: baseline 30, SCR 拉高
  } else {
    const weights = [0.25, 0.25, 0.2, 0.3];
    let wsum = 0, wtotal = 0;
    for (let i = 0; i < parts.length; i++) {
      wsum += parts[i] * weights[i];
      wtotal += weights[i];
    }
    arousalScore = clamp(wsum / wtotal * 100, 0, 100);
  }

  // === VALENCE (Threat-Challenge) ===
  const hrvPreservation = hrvNorm ?? 0;
  let valenceScore: number;
  if (deviceEmotionNow != null) {
    // 原生情绪值决定正负方向；HRV/EDA 只决定唤醒度和标签细分。
    valenceScore = deviceEmotionNow * 10;
  } else if (arousalScore > 60) {
    // High arousal: Challenge (+) vs Threat (-) determined by RMSSD
    valenceScore = hrvPreservation * 100;
  } else {
    // Low arousal: neutral → slightly negative toward depleted
    valenceScore = hrvPreservation * 60 - 20;
  }

  // === CLASSIFY ===
  let label: EmotionLabel;
  let reason: string;
  if (arousalScore > 55) {
    if (valenceScore > 20) { label = 'focused'; reason = deviceEmotionNow != null ? `设备情绪 +${deviceEmotionNow.toFixed(0)} · 高唤醒积极状态` : '身体紧绷但心态积极 — 心流状态'; }
    else { label = 'stressed'; reason = deviceEmotionNow != null ? `设备情绪 ${deviceEmotionNow.toFixed(0)} · 高唤醒负向状态` : '身体紧绷且心率变乱 — 感到威胁'; }
  } else if (arousalScore < 35) {
    if (hrvNorm != null && hrvNorm > 0.3) { label = 'calm'; reason = '身体放松 + 心率稳定 — 恢复中'; }
    else if (valenceScore < -30) { label = 'depleted'; reason = '身体放松但心率变乱 — 疲劳积累'; }
    else { label = 'bored'; reason = '身体放松 — 缺乏动力'; }
  } else {
    if (valenceScore > 15) { label = 'focused'; reason = '适度紧张 + 心态积极'; }
    else if (valenceScore < -15) { label = 'stressed'; reason = '适度紧张 + 心态消极'; }
    else { label = 'calm'; reason = '适度紧张 — 情绪平稳'; }
  }

  const { phase, cycleInfo } = getCurrentPhase(nowMs, cycleOverride);
  const dayInPhase = cycleInfo ? cycleInfo.dayInCycle : null;

  // ★ 经期相位语境: 在 reason 末尾追加 "这是周期造成的, 正常"
  let reasonFinal = reason;
  if (phase === 'luteal' && (label === 'stressed' || label === 'depleted')) {
    reasonFinal += ' — 黄体期激素波动, 情绪敏感, 正常';
  } else if (phase === 'period' && (label === 'bored' || label === 'depleted' || label === 'stressed')) {
    reasonFinal += ' — 经期身体恢复, 容易疲劳, 正常';
  } else if (phase === 'luteal' && label === 'bored') {
    reasonFinal += ' — 黄体期精力下降, 正常';
  }

  return {
    t: nowMs,
    arousalScore: Math.round(arousalScore),
    valenceScore: Math.round(valenceScore),
    emotionLabel: label,
    scrPeaksPerMin: Math.round(scr.peaksPerMin * 10) / 10,
    scrMeanAmp: scr.meanAmp != null ? Math.round(scr.meanAmp * 100) / 100 : null,
    reason: reasonFinal,
    updatedAt: nowMs,
    cyclePhase: phase,
    cycleDayInPhase: dayInPhase,
  };
}

// 标签映射
export const EMOTION_LABEL_CN: Record<EmotionLabel, string> = {
  focused: '专注',
  calm: '平静',
  stressed: '焦虑',
  bored: '倦怠',
  depleted: '耗竭',
};

export const EMOTION_LABEL_EMOJI: Record<EmotionLabel, string> = {
  focused: '🎯',
  calm: '😌',
  stressed: '😰',
  bored: '😶',
  depleted: '😩',
};

// ═══════════════════════════════════════════════════════════════════════════
// ★ 以下是 AI 对话侧的情绪分析（文本 VAD + Plutchik 8 类基本情绪）
// 独立于上面的 ring 生物信号 pipeline，不影响现有功能
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Plutchik Wheel — 8 类基本情绪 + 强度（2017 论文 validated）
 * joy/sadness/trust/disgust/fear/anticipation/anger/surprise
 * 每类 0-1 强度，互相独立（不是非此即彼）
 */
export type PlutchikLabel = 'joy' | 'sadness' | 'trust' | 'disgust' | 'fear' | 'anticipation' | 'anger' | 'surprise';

export interface PlutchikScores {
  scores: Record<PlutchikLabel, number>;
  top3: Array<{ label: PlutchikLabel; score: number }>;
  dominant: PlutchikLabel;
  /** Russell circumplex 映射 */
  valence: number;   // -1 ~ 1  (从 Plutchik 组合推导)
  arousal: number;   //  0 ~ 1
}

// Plutchik 关键词词典（精简中文，覆盖 8 类情绪 + 反向词）
const PLUTCHIK_LEXICON: Record<PlutchikLabel, string[]> = {
  joy:      ['开心', '高兴', '快乐', '棒', '赞', '满意', '满足', '幸福', '美好', '喜欢', '爱', '享受', '爽', '嘻嘻', '哈哈'],
  sadness:  ['难过', '伤心', '悲伤', '哭', '眼泪', '痛', '遗憾', '后悔', '失望', '沮丧', '低落', '郁闷', '难受', '心碎', '唉'],
  trust:    ['信任', '安心', '踏实', '放心', '靠谱', '稳', '可靠', '支持', '理解', '陪伴', '爱'],
  disgust:  ['恶心', '讨厌', '烦', '厌恶', '反感', '不适', '排斥'],
  fear:     ['怕', '害怕', '担心', '焦虑', '紧张', '不安', '恐惧', '顾虑', '慌', '怂', '吓'],
  anticipation: ['期待', '盼望', '希望', '等', '等不及', '想', '盼', '好奇', '想知道'],
  anger:    ['生气', '怒', '愤怒', '烦', '讨厌', '破', '傻逼', '贱', '蠢', '火', '怼', '骂', '恨'],
  surprise: ['惊', '竟然', '居然', '没想到', '意外', '突然', '懵', '震惊'],
};

// Russell VAD 极性词典（补充 Plutchik 的 Valence/Arousal 推导）
const VAD_LEXICON = {
  positive: ['好', '棒', '赞', '开心', '喜欢', '爱', '满意', '幸福', '感谢', '棒', '不错', '挺好', '行', '没问题', '可以'],
  negative: ['烦', '累', '难过', '生气', '焦虑', '压力', '讨厌', '糟糕', '不行', '完蛋', '惨', '坏', '差', '糟', '累', '困'],
  highArousal: ['激动', '兴奋', '紧张', '焦虑', '生气', '怒', '慌', '怕', '恐惧', '急', '赶', '冲', '爆'],
  lowArousal: ['累', '困', '懒', '倦', '疲', '躺', '睡', '发呆', '放空', '静', '慢', '歇', '缓'],
};

/** 纯词典驱动，0ms，不调 LLM，安全（不依赖云端） */
export function analyzeTextEmotion(text: string): PlutchikScores {
  const t = text.toLowerCase();
  const scores: Record<PlutchikLabel, number> = {
    joy: 0, sadness: 0, trust: 0, disgust: 0,
    fear: 0, anticipation: 0, anger: 0, surprise: 0,
  };
  for (const label of Object.keys(PLUTCHIK_LEXICON) as PlutchikLabel[]) {
    const words = PLUTCHIK_LEXICON[label];
    let hits = 0;
    for (const w of words) {
      if (t.includes(w)) hits++;
    }
    scores[label] = hits;
  }

  // 归一化到 0-1
  const maxScore = Math.max(1, ...Object.values(scores));
  for (const k of Object.keys(scores) as PlutchikLabel[]) {
    scores[k] = scores[k] / maxScore;
  }

  const top3 = (Object.entries(scores) as [PlutchikLabel, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, score]) => ({ label, score: Math.round(score * 100) / 100 }));
  const dominant = top3[0].label;

  // Russell VAD 推导（从 Plutchik 组合 → valence + arousal）
  const posKeys: PlutchikLabel[] = ['joy', 'trust', 'anticipation'];
  const negKeys: PlutchikLabel[] = ['sadness', 'disgust', 'fear', 'anger'];
  const valence = (
    posKeys.reduce((s, k) => s + scores[k], 0) -
    negKeys.reduce((s, k) => s + scores[k], 0)
  ) / 3;  // 归一化

  const highArousalKeys: PlutchikLabel[] = ['anger', 'fear', 'joy', 'surprise'];
  const lowArousalKeys: PlutchikLabel[] = ['sadness', 'trust', 'anticipation'];
  const arousalBase = highArousalKeys.reduce((s, k) => s + scores[k], 0);
  const arousalAdj = lowArousalKeys.reduce((s, k) => s - scores[k], 0);
  const arousal = clamp(arousalBase + arousalAdj + 0.5, 0, 1);

  return {
    scores,
    top3,
    dominant,
    valence: clamp(valence, -1, 1),
    arousal: Math.round(arousal * 100) / 100,
  };
}

export const PLUTCHIK_LABEL_CN: Record<PlutchikLabel, string> = {
  joy: '愉悦', sadness: '难过', trust: '安心', disgust: '厌恶',
  fear: '担忧', anticipation: '期待', anger: '生气', surprise: '惊讶',
};
