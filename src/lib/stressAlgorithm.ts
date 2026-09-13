/**
 * 压力检测算法 — 开源参考
 *  - KalmanJS (MIT): https://github.com/wouterbulten/kalmanjs
 *  - Kalman-Normalized GSR (2025): https://onlinelibrary.wiley.com/doi/full/10.1155/ijta/8828363
 *  - hrv-stress-wearable (MIT): https://github.com/Kaizer-1/hrv-stress-wearable
 *
 * 输入: EDA(skinMoisture) 序列 (全天), HRV(RMSSD) 单值
 * 输出: 当前压力分 0-100, 全天压力事件时间戳, 个人基线, 每小时事件分布
 */
import KalmanFilter from './kalman-filter';
import { healthStore, dayStartMs, dayKey, type MetricKey } from '../data/healthStore';

export type StressLevel = 'calm' | 'mild' | 'moderate' | 'high';

export interface StressEvent {
  t: number;          // ms 时间戳
  hour: number;       // [0-23]
  minute: number;     // [0-59]
  eda: number;        // 滤波后的 EDA 值
  baseline: number;   // 全天均值 (个人基线)
  z: number;          // z-score
  severity: number;   // 0-100 事件强度
  level: StressLevel;  // 本次事件等级
  recoverySec: number | null;  // SCR 恢复时间 (秒), null=全天最后一个事件没后续数据
  valenceLabel: ValenceLabel | null;  // 事件级情绪方向: positive/negative/neutral
}

export interface HourBucket {
  hour: number;       // [0-23]
  count: number;      // 事件数
  maxSeverity: number; // 该小时最高 severity
}

export type ValenceLabel = 'positive' | 'negative' | 'neutral';

export interface StressReport {
  score: number | null;
  level: StressLevel | null;
  baseline: number | null;
  dailyStd: number | null;
  edaNow: number | null;
  slope: number | null;
  hrvNow: number | null;
  hrvTrend: 'up' | 'down' | 'stable' | null;
  events: StressEvent[];        // 全天压力事件 (时间升序)
  hourBuckets: HourBucket[];    // 每小时事件分布
  peakHour: number | null;
  sampleCount: number;

  // ★ 情绪消耗 (分建设性 vs 破坏性) + 恢复时间
  emotionalLoad: number | null;         // 0-100, 总消耗
  loadConstructive: number | null;      // 0-100, 建设性消耗 (积极情绪的消耗)
  loadDestructive: number | null;       // 0-100, 破坏性消耗 (消极情绪的消耗)
  avgRecoverySec: number | null;        // 全天平均 SCR 恢复时间 (秒)
  recoveryProlonged: number | null;     // 相对基线延长比例 (%)
  valenceScore: number | null;          // -100 (负) ~ +100 (正), 情绪倾向
  valenceLabel: ValenceLabel | null;    // positive / negative / neutral
  valenceReason: string | null;         // 判定依据一句话
}

const SCORE_WINDOW_MS = 30 * 60 * 1000;   // 当前压力分用最近 30min 窗口
const SLOPE_WINDOW_MS = 5 * 60 * 1000;
const EVENT_Z_THRESHOLD = 1.2;             // z > 1.2 算轻度事件 (全天事件检测)
const EVENT_MIN_GAP_MS = 8 * 60 * 1000;    // 两个事件至少隔 8min (戒指 10s 一采 → 避免误检一串)

function rollingStats(values: number[]): { mean: number; std: number } | null {
  if (values.length < 5) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function linearSlope(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
}

function classifyLevel(z: number): StressLevel {
  if (z < 0.3) return 'calm';
  if (z < 0.8) return 'mild';
  if (z < 1.5) return 'moderate';
  return 'high';
}

export function computeStressReport(nowMs = Date.now()): StressReport {
  const dayStart = dayStartMs(nowMs);

  // ★ 优先用 EDA 原始值；Veepoo SDK 回的是 stress 等级（0~12 整数），fallback 到 stress key
  let edaRaw = healthStore.getTimeRange('eda', dayStart, nowMs, { fillDailyMean: true, maxPoints: 480 });
  if (edaRaw.length === 0) {
    edaRaw = healthStore.getTimeRange('stress', dayStart, nowMs, { fillDailyMean: true, maxPoints: 480 });
  }
  if (edaRaw.length === 0) {
    return {
      score: null, level: null, baseline: null, dailyStd: null, edaNow: null, slope: null,
      hrvNow: null, hrvTrend: null, events: [], hourBuckets: [], peakHour: null, sampleCount: 0,
      emotionalLoad: null, loadConstructive: null, loadDestructive: null,
      avgRecoverySec: null, recoveryProlonged: null,
      valenceScore: null, valenceLabel: null, valenceReason: null,
    };
  }

  // Kalman 滤波
  const kf = new KalmanFilter({ R: 2, Q: 0.1 });
  const filtered = edaRaw.map((p) => ({ t: p.t, v: kf.filter(p.v) }));

  // ── 全天统计 (用于事件检测) ──
  const allStats = rollingStats(filtered.map((p) => p.v));

  // ── 30min 窗口 (当前压力分) ──
  const recentStart = nowMs - SCORE_WINDOW_MS;
  const recentStats = rollingStats(filtered.filter((p) => p.t >= recentStart).map((p) => p.v));

  // ── 5min 斜率 ──
  const slopeStart = nowMs - SLOPE_WINDOW_MS;
  const slope = linearSlope(
    filtered.filter((p) => p.t >= slopeStart).map((p) => ({ x: (p.t - slopeStart) / 1000, y: p.v })),
  );

  // ── HRV ──
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 86400000).toISOString().slice(0, 10);
  const hrvNow = healthStore.getDay('hrv' as MetricKey, todayKey)?.mean ?? null;
  const hrvYest = healthStore.getDay('hrv' as MetricKey, yesterday)?.mean ?? null;
  let hrvTrend: 'up' | 'down' | 'stable' | null = null;
  if (hrvNow != null && hrvYest != null && hrvYest > 0) {
    const diff = (hrvNow - hrvYest) / hrvYest;
    hrvTrend = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : 'stable';
  }

  // ── 当前压力分 ──
  const edaNow = filtered[filtered.length - 1]?.v ?? null;
  let score: number | null = null;
  let level: StressLevel | null = null;
  if (edaNow != null && recentStats && recentStats.std > 0.01) {
    const z = (edaNow - recentStats.mean) / recentStats.std;
    score = Math.round(Math.max(0, Math.min(100, 40 + z * 15)));
    if (hrvTrend === 'down' && z > 0.5) score = Math.min(100, score + 10);
    level = classifyLevel(z);
  }

  // ── 全天压力事件检测 ──
  // 用全天 mean/std 做统一基线，检测全天所有偏离事件
  const events: StressEvent[] = [];
  if (allStats && allStats.std > 0.01) {
    let lastEventT = -Infinity;
    for (const p of filtered) {
      const z = (p.v - allStats.mean) / allStats.std;
      if (z >= EVENT_Z_THRESHOLD && p.t - lastEventT >= EVENT_MIN_GAP_MS) {
        const d = new Date(p.t);
        const severity = Math.min(100, Math.round(z * 30));
        events.push({
          t: p.t,
          hour: d.getHours(),
          minute: d.getMinutes(),
          eda: p.v,
          baseline: allStats.mean,
          z,
          severity,
          level: classifyLevel(z),
          recoverySec: null,
          valenceLabel: null,
        });
        lastEventT = p.t;
      }
    }
  }

  // ── 每个事件的 SCR 恢复时间 ──
  // 经典定义: 峰值后信号回到 baseline + (peak-baseline) * 0.37 所需时间
  // 0.37 = 1/e, 一阶指数衰减到 37% 高度的时间常数
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const peakT = ev.t;
    const peakV = ev.eda;
    const targetV = ev.baseline + (peakV - ev.baseline) * 0.37;
    let recoverySec: number | null = null;
    const startIdx = filtered.findIndex((p) => p.t >= peakT);
    for (let j = startIdx + 1; j < filtered.length; j++) {
      if (filtered[j].v <= targetV) {
        recoverySec = Math.round((filtered[j].t - peakT) / 1000);
        break;
      }
    }
    events[i] = { ...ev, recoverySec };
  }

  const validRTs = events.map((e) => e.recoverySec).filter((v): v is number => v != null && v > 0);
  const avgRecoverySec = validRTs.length > 0
    ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length)
    : null;

  // ── 事件级情绪方向判定 ──
  // 优先级: 事件前后 emotion 单点 > 恢复时间辅助 > 全天 valence 兜底
  const EVENT_WINDOW_MS = 10 * 60 * 1000; // ±10min 窗口
  const emotionDay = healthStore.getTimeRange('emotion' as MetricKey, dayStart, nowMs, { fillDailyMean: false, maxPoints: 200 });
  // ★ 全天 emotion 真实性预检测：值域窄 + 方差小 = offlineEstimates 假数据 = Tier 1 全跳过
  let emotionDayIsReal = false;
  if (emotionDay.length >= 5) {
    const vals = emotionDay.map(p => p.v);
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    const vMean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const vVar = vals.reduce((s,v)=>s+(v-vMean)**2,0)/vals.length;
    emotionDayIsReal = (vMax - vMin) >= 1.5 && vVar >= 0.5;
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const evStart = ev.t - EVENT_WINDOW_MS;
    const evEnd = ev.t + EVENT_WINDOW_MS;
    // 取事件窗口内的 emotion 单点
    const windowEmotions = emotionDay.filter((p) => p.t >= evStart && p.t <= evEnd);
    let evLabel: ValenceLabel | null = null;

    // ★ Tier 1: emotion 数据真实性检测
    // offlineEstimates 用 stress→emotion 映射出固定值 2/3/4，值域窄 (max-min<1.5) 且方差小 → 视为假数据跳过
    let emotionIsReal = false;
    if (windowEmotions.length >= 3) {
      const emoVals = windowEmotions.map(p => p.v);
      const emoMin = Math.min(...emoVals);
      const emoMax = Math.max(...emoVals);
      const emoRange = emoMax - emoMin;
      const emoMean = emoVals.reduce((a, b) => a + b, 0) / emoVals.length;
      const emoVar = emoVals.reduce((s, v) => s + (v - emoMean) ** 2, 0) / emoVals.length;
      emotionIsReal = emoRange >= 1.5 && emoVar >= 0.5;  // 值域≥1.5 且方差≥0.5 → 真数据
    }

    if (windowEmotions.length > 0 && emotionIsReal) {
      const avgEmo = windowEmotions.reduce((s, p) => s + p.v, 0) / windowEmotions.length;
      if (avgEmo >= 2) evLabel = 'positive';
      else if (avgEmo <= -2) evLabel = 'negative';
      else evLabel = 'neutral';
    } else if (ev.recoverySec != null) {
      // 没有 emotion 单点 → recoverySec 相对值判定（避免绝对阈值失效）
      // 同一用户同一天 recoverySec 常常很接近（都≈40s），用 ratio 比较才有区分度
      const avgRT = validRTs.length > 0 ? validRTs.reduce((a, b) => a + b, 0) / validRTs.length : 40;
      const ratio = avgRT > 0 ? ev.recoverySec / avgRT : 1;
      if (ratio < 0.5 && ev.z < 2.0) {
        evLabel = 'positive';   // 明显快于平均（<50%）→ 兴奋/心流
      } else if (ratio > 2.0 || ev.z > 2.5) {
        evLabel = 'negative';   // 明显慢于平均（>200%）或 z 极端高 → 压力
      }
      // 其他 → 保持 null，下面兜底 neutral
    }
    // 兜底: 没有足够信号 → neutral (不猜)
    if (evLabel == null) evLabel = 'neutral';
    events[i] = { ...ev, valenceLabel: evLabel };
  }

  // ── 每小时事件分布 ──
  const hourBuckets: HourBucket[] = [];
  for (let h = 0; h < 24; h++) {
    hourBuckets.push({ hour: h, count: 0, maxSeverity: 0 });
  }
  for (const e of events) {
    hourBuckets[e.hour].count++;
    if (e.severity > hourBuckets[e.hour].maxSeverity) hourBuckets[e.hour].maxSeverity = e.severity;
  }

  // 找峰值小时 (事件数最多)
  let peakHour: number | null = null;
  let peakCount = 0;
  for (const b of hourBuckets) {
    if (b.count > peakCount) { peakCount = b.count; peakHour = b.hour; }
  }
  if (peakCount === 0) peakHour = null;

    // ═══════════════════════════════════════════════════════════════
    // ★ SDK 原生信号 (healthStore 里) — 融合主输入
    // ═══════════════════════════════════════════════════════════════

    // emotionLevel [-10, 10] → valence 主输入
    const emotionNow = healthStore.getDay('emotion' as MetricKey, todayKey)?.mean ?? null;

    // snsActivation [1-99] → arousal (压力/紧张)
    const snsNow = healthStore.getDay('sns' as MetricKey, todayKey)?.mean ?? null;

    // VTI = ppgSys - ppgDia → 血管张力 (压力时↑, 放松时↓)
    const ppgSysNow = healthStore.getDay('ppgSys' as MetricKey, todayKey)?.mean ?? null;
    const ppgDiaNow = healthStore.getDay('ppgDia' as MetricKey, todayKey)?.mean ?? null;
    const vtiNow = (ppgSysNow != null && ppgDiaNow != null && ppgSysNow > ppgDiaNow)
      ? ppgSysNow - ppgDiaNow : null;

    // ── 多日基线 (过去 2 天) ──
    const daysBack: string[] = [];
    for (let i = 1; i <= 2; i++) {
      daysBack.push(new Date(nowMs - i * 86400000).toISOString().slice(0, 10));
    }
    const meanOf = (key: MetricKey) => {
      const vs = daysBack.map((dk) => healthStore.getDay(key, dk)?.mean ?? null).filter((v): v is number => v != null);
      return vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const hrvBaseline = meanOf('hrv' as MetricKey);
    const snsBaseline = meanOf('sns' as MetricKey);
    const emotionBaseline = meanOf('emotion' as MetricKey);
    const vtiBaseline = (() => {
      const ps = meanOf('ppgSys' as MetricKey);
      const pd = meanOf('ppgDia' as MetricKey);
      return (ps != null && pd != null && ps > pd) ? ps - pd : null;
    })();

    // ── 多日事件数基线 ──
    const eventHistoryCounts = daysBack.map((dk) => {
      const pastDayStart = dayStartMs(new Date(dk).getTime());
      const pastDayEnd = pastDayStart + 86400000;
      const pastArr = healthStore.getTimeRange('stress', pastDayStart, pastDayEnd, { maxPoints: 480 });
      if (pastArr.length === 0) return 0;
      const pastKf = new KalmanFilter({ R: 2, Q: 0.1 });
      const pastFilt = pastArr.map((p) => ({ t: p.t, v: pastKf.filter(p.v) }));
      const pastAllStats = rollingStats(pastFilt.map((p) => p.v));
      if (!pastAllStats || pastAllStats.std <= 0.01) return 0;
      let cnt = 0, lastT = -Infinity;
      for (const p of pastFilt) {
        const z = (p.v - pastAllStats.mean) / pastAllStats.std;
        if (z >= EVENT_Z_THRESHOLD && p.t - lastT >= EVENT_MIN_GAP_MS) { cnt++; lastT = p.t; }
      }
      return cnt;
    });
    const eventBaselineCount = eventHistoryCounts.length > 0
      ? eventHistoryCounts.reduce((a, b) => a + b, 0) / eventHistoryCounts.length
      : null;

    // ── 情绪消耗 emotionalLoad (0-100) ──
    // 4 因子融合: 事件密度 + 事件 severity + HRV 偏离 + snsActivation 偏离
    let emotionalLoad: number | null = null;
    if (events.length > 0 || hrvNow != null || snsNow != null) {
      let loadScore = 0;
      let loadWeight = 0;

      // 输入 1: 事件密度相对基线
      if (eventBaselineCount != null && eventBaselineCount > 0) {
        const densityRatio = events.length / eventBaselineCount;
        loadScore += Math.max(0, Math.min(1, (densityRatio - 0.5) / 1.5));
        loadWeight += 1;
      }

      // 输入 2: 事件平均 severity
      if (events.length > 0) {
        const avgSev = events.reduce((s, e) => s + e.severity, 0) / events.length;
        loadScore += avgSev / 100;
        loadWeight += 1;
      }

      // 输入 3: HRV 相对基线下降
      if (hrvNow != null && hrvBaseline != null && hrvBaseline > 0) {
        const hrvDelta = (hrvBaseline - hrvNow) / hrvBaseline;
        loadScore += Math.max(0, Math.min(1, hrvDelta * 2.5));
        loadWeight += 1;
      }

      // 输入 4: snsActivation 相对基线上升 (交感激活 = 消耗)
      if (snsNow != null && snsBaseline != null && snsBaseline > 0) {
        const snsDelta = (snsNow - snsBaseline) / snsBaseline;
        loadScore += Math.max(0, Math.min(1, snsDelta * 2));
        loadWeight += 1;
      }

      // 输入 5: SCR 恢复时间相对基线延长 (RT↑ → 自主神经恢复慢 → 消耗大)
      // Veepoo 戒指 GSR 采样典型恢复时间 ≈ 90s; 延长 2×+ 算显著
      if (avgRecoverySec != null) {
        const rtBaseline = 90;
        const rtRatio = avgRecoverySec / rtBaseline;
        // 30s → 0 (恢复快不消耗), 90s → 0.5, 180s+ → 1.0
        loadScore += Math.max(0, Math.min(1, (rtRatio - 0.33) / 1.67));
        loadWeight += 1;
      }

      if (loadWeight > 0) {
        emotionalLoad = Math.round(Math.max(0, Math.min(100, 20 + (loadScore / loadWeight) * 80)));
      }
    }



    // ── 正负倾向 valenceScore (-100 ~ +100) ──
    // emotionLevel (SDK 原生) 主输入; HRV + 压力事件 + sns + VTI 辅助修正
    let valenceScore: number | null = null;
    let valenceLabel: ValenceLabel | null = null;
    let valenceReason: string | null = null;

    const hrvDev = (hrvNow != null && hrvBaseline != null && hrvBaseline > 0)
      ? (hrvNow - hrvBaseline) / hrvBaseline : null;
    const eventDev = (eventBaselineCount != null && eventBaselineCount >= 0)
      ? (events.length - eventBaselineCount) / Math.max(1, eventBaselineCount + 1) : null;
    const snsDev = (snsNow != null && snsBaseline != null && snsBaseline > 0)
      ? (snsNow - snsBaseline) / snsBaseline : null;
    const vtiDev = (vtiNow != null && vtiBaseline != null && vtiBaseline > 0)
      ? (vtiNow - vtiBaseline) / vtiBaseline : null;

    // 身体状态方向: HRV↑/事件↓/sns↓/VTI↓ → 偏积极 (d>0)
    const bodyStateDir = (() => {
      let d = 0;
      if (hrvDev != null) d += Math.sign(hrvDev);
      if (eventDev != null) d -= Math.sign(eventDev);
      if (snsDev != null) d -= Math.sign(snsDev);
      if (vtiDev != null) d -= Math.sign(vtiDev);
      return d;
    })();

    // ★ emotionLevel [-10, 10] → 归一化到 [-100, 100]
    if (emotionNow != null) {
      valenceScore = Math.round(Math.max(-100, Math.min(100, emotionNow * 10)));

      // 修正: SDK emotion 偏正(>20) 但 身体偏消极(bodyStateDir<=-1) → 往 0 拉
      if (bodyStateDir <= -1 && valenceScore > 20) {
        valenceScore = Math.round(valenceScore * 0.5);
      }
      // 修正: SDK emotion 偏负(<-20) 但 身体偏积极(bodyStateDir>=1) → 往 0 拉
      if (bodyStateDir >= 1 && valenceScore < -20) {
        valenceScore = Math.round(valenceScore * 0.5);
      }
    } else {
      // fallback: 没有 emotionLevel → 完全靠身体信号融合
      const mag = (hrvDev != null ? Math.min(1, Math.abs(hrvDev) * 2) : 0)
                + (eventDev != null ? Math.min(1, Math.abs(eventDev)) : 0);
      if (bodyStateDir >= 1 && mag > 0.15) {
        valenceScore = Math.round(Math.min(100, (mag / 2) * 100));
      } else if (bodyStateDir <= -1 && mag > 0.15) {
        valenceScore = Math.round(Math.max(-100, -(mag / 2) * 100));
      } else {
        valenceScore = 0;
      }
    }

    if (valenceScore != null) {
      if (valenceScore >= 20) valenceLabel = 'positive';
      else if (valenceScore <= -20) valenceLabel = 'negative';
      else valenceLabel = 'neutral';
      valenceReason = buildValenceReason(emotionNow, hrvDev, eventDev, snsDev, vtiDev, valenceLabel);
    }

    // ── 恢复时间延长比例 (%) ──
    const recoveryProlonged = avgRecoverySec != null
      ? Math.round(((avgRecoverySec - 90) / 90) * 100)
      : null;

    // ── 情绪消耗正负拆分 ──
    // 建设性: 积极情绪下的消耗 (兴奋/心流/专注 → 消耗但充能)
    // 破坏性: 消极情绪下的消耗 (压力/焦虑/愤怒 → 消耗且损能)
    let loadConstructive: number | null = null;
    let loadDestructive: number | null = null;
    if (emotionalLoad != null && valenceScore != null) {
      if (valenceScore >= 20) {
        loadConstructive = Math.round(emotionalLoad * 0.7);
        loadDestructive = Math.round(emotionalLoad * 0.3);
      } else if (valenceScore <= -20) {
        loadConstructive = Math.round(emotionalLoad * 0.2);
        loadDestructive = Math.round(emotionalLoad * 0.8);
      } else {
        loadConstructive = Math.round(emotionalLoad * 0.5);
        loadDestructive = Math.round(emotionalLoad * 0.5);
      }
    }


  const result: StressReport = {
    score, level,
    baseline: allStats?.mean ?? null,
    dailyStd: allStats?.std ?? null,
    edaNow, slope,
    hrvNow, hrvTrend,
    events,
    hourBuckets,
    peakHour,
    sampleCount: filtered.length,
    emotionalLoad,
    loadConstructive,
    loadDestructive,
    avgRecoverySec,
    recoveryProlonged,
    valenceScore,
    valenceLabel,
    valenceReason,
  };
  // ↓ 自动持久化 —— 每次算完都存到 healthStore.analysis
  try {
    const _d = dayKey(nowMs);
    healthStore.saveAnalysis(_d, 'stress', {
      score: result.score,
      peakHour: result.peakHour,
      emotionalLoad: result.emotionalLoad,
      avgRecoverySec: result.avgRecoverySec,
      eventCount: result.events.length,
    });
  } catch { /* 存储失败不影响返回值 */ }
  return result;
}

function buildValenceReason(
  emotionNow: number | null,
  hrvDev: number | null,
  eventDev: number | null,
  snsDev: number | null,
  vtiDev: number | null,
  label: ValenceLabel,
): string {
  const parts: string[] = [];
  if (emotionNow != null) {
    parts.push(`SDK情绪 ${emotionNow > 0 ? '+' : ''}${emotionNow.toFixed(0)}`);
  }
  if (hrvDev != null) {
    const pct = Math.round(Math.abs(hrvDev) * 100);
    parts.push(hrvDev > 0 ? `HRV↑${pct}%` : `HRV↓${pct}%`);
  }
  if (eventDev != null) {
    const pct = Math.round(Math.abs(eventDev) * 100);
    parts.push(eventDev > 0 ? `事件多${pct}%` : `事件少${pct}%`);
  }
  if (snsDev != null) {
    const pct = Math.round(Math.abs(snsDev) * 100);
    parts.push(snsDev > 0 ? `交感↑${pct}%` : `交感↓${pct}%`);
  }
  if (vtiDev != null) {
    const pct = Math.round(Math.abs(vtiDev) * 100);
    parts.push(vtiDev > 0 ? `血管张力↑${pct}%` : `血管张力↓${pct}%`);
  }
  const prefix = label === 'positive' ? '偏积极 · ' : label === 'negative' ? '偏消极 · ' : '情绪平稳 · ';
  return prefix + parts.join('，');
}
export function formatPeakHour(h: number | null): string {
  if (h == null) return '—';
  return `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}`;
}

export function levelText(level: StressLevel | null): string {
  switch (level) {
    case 'calm': return '放松';
    case 'mild': return '轻度紧张';
    case 'moderate': return '中度压力';
    case 'high': return '高压';
    default: return '—';
  }
}
