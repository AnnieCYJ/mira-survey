// 健康数据快照：注入所有可获取的健康数据给 MiraAI
// Token budget 控制：健康块总计 ≤ 800 token，留空间给 system prompt + 对话历史

import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey, type MetricKey } from '../data/healthStore';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectDailyPhysio, inferHormones, type DailyPhysio } from '../lib/hormoneInference';

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

function metricHistorySummary(metric: MetricKey, days = 7): string | null {
  try {
    const vals = healthStore.getMetricDailyMeans(metric, days);
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const dir = trendDir(vals.slice().reverse());
    return `近${days}天均值 ${fmt(mean)}，${dir}`;
  } catch { return null; }
}

/**
 * 皮质醇完整节律分析（身体恢复详情页同款数据，无遗漏）：
 *   Cosinor: MESOR/振幅/峰值时刻/拟合优度R²/样本数
 *   CSS: 节律方向性（正=晨型，负=晚间型）
 *   Baseline: 14天个人基线 P25/P75
 *   DailyMESOR: 历史 MESOR 漂移趋势
 *   Status: 节律正常/持续偏高/紊乱 + 具体 flags
 *   SustainedHighStreak: 连续偏高天数
 */
function getCortisolBlock(): string {
  const today = dayKey(Date.now());
  const cached = healthStore.getAnalysis(today);
  const parts: string[] = [];

  // 先尝试从缓存拿 cosinor 完整数据；缓存没有就现算 analyzeCortisol
  let cc: any = cached?.cortisol;
  let fullResult: any = null;

  try {
    if (!cc) {
      // 现算完整结果（会自动写缓存）
      const samples: { t: number; v: number }[] = [];
      for (const mk of ['cortisol'] as MetricKey[]) {
        
        const todayIntraday = healthStore.getIntraday(mk, today);
        for (const p of todayIntraday) samples.push({ t: p.t, v: p.v });
        // 近30天也抓一点做 baseline
        const now = Date.now();
        for (let i = 1; i < 30; i++) {
          const dk = dayKey(now - i * 86400000);
          const pts = healthStore.getIntraday(mk, dk);
          for (const p of pts) samples.push({ t: p.t, v: p.v });
        }
      }
      if (samples.length >= 3) {
        fullResult = analyzeCortisol(samples, 14);
        cc = {
          mesor: fullResult.cosinor.mesor,
          amplitude: fullResult.cosinor.amplitude,
          acrophaseH: fullResult.cosinor.acrophaseH,
          css: fullResult.css,
          status: fullResult.status.level,
          sustainedHighStreak: fullResult.sustainedHighStreak,
          // 额外完整字段
          r2: fullResult.cosinor.r2,
          n: fullResult.cosinor.n,
          baselineP25: fullResult.baseline.p25,
          baselineP75: fullResult.baseline.p75,
          baselineN: fullResult.baseline.n,
          flags: fullResult.status.flags,
        };
      }
    }
  } catch {}

  if (!cc) return '';

  // 1. cosinor 核心参数（身体恢复详情页同款）
  const acro = `${String(Math.floor(cc.acrophaseH)).padStart(2,'0')}:${String(Math.round((cc.acrophaseH % 1) * 60)).padStart(2,'0')}`;
  parts.push(`峰值 ${acro}`);
  parts.push(`节律中值MESOR ${fmt(cc.mesor)} μg/L`);
  parts.push(`昼夜振幅 ${fmt(cc.amplitude)} μg/L`);
  if (cc.r2 != null) parts.push(`拟合优度R² ${fmt(cc.r2, '', 2)}`);
  if (cc.n != null) parts.push(`样本数 ${cc.n}`);

  // 2. CSS 节律方向
  const cssLabel = cc.css > 10 ? '早起型' : cc.css < -10 ? '晚睡型' : '不明显';
  parts.push(`作息类型 ${cssLabel}(CSS=${Math.round(cc.css)})`);

  // 3. 14天个人基线对比
  if (cc.baselineP25 != null && cc.baselineP75 != null) {
    const inRange = cc.mesor >= cc.baselineP25 && cc.mesor <= cc.baselineP75;
    parts.push(`14天基线P25 ${fmt(cc.baselineP25)} / P75 ${fmt(cc.baselineP75)}，今日MESOR${inRange ? '在基线内' : cc.mesor > cc.baselineP75 ? '偏高' : '偏低'}`);
  }

  // 4. 节律状态 + flags
  const cmap: Record<string, string> = { normal: '正常', sustained_high: '持续偏高', dysregulated: '节律紊乱' };
  parts.push(`节律状态 ${cmap[cc.status] ?? cc.status}`);
  if (cc.flags && cc.flags.length) {
    parts.push(`节律异常项:${cc.flags.join('、')}`);
  }

  // 5. 连续偏高
  if (cc.sustainedHighStreak > 0) {
    parts.push(`连续 ${cc.sustainedHighStreak} 天皮质醇偏高`);
  }

  return parts.join('；');
}

/**
 * 激素推断（hormoneInference）：戒指实测 → 雌二醇/孕激素状态
 *   雌二醇: 状态/分数/HRV dip排卵信号/趋势方向
 *   孕激素: 状态/分数/BBT双相体温确认/cover-baseline温差
 *   周期规律度: 是否规律双相/HRV黄体期是否下降/RHR黄体期是否升高
 */
function getHormoneBlock(): string {
  const st = RingBle.getState();
  const cs = st.curveStatus;
  const parts: string[] = [];

  // 构建 CycleLogRef
  let cycleRef = null as any;
  if (cs?.hasLog) {
    cycleRef = {
      lastPeriodStart: '', // 不需要，collectDailyPhysio 不看这个
      cycleLength: 28,
      lutealLength: 14,
      periodLength: 5,
      dayInCycle: cs.dayInCycle,
      phase: (cs.phaseLabel === '月经期' ? 'period' :
             cs.phaseLabel === '卵泡期' ? 'follicular' :
             cs.phaseLabel === '排卵期' ? 'ovulation' :
             cs.phaseLabel === '黄体期' ? 'luteal' : 'unknown'),
      ovulationDate: null,
    };
  }

  let inference: any = null;
  try {
    const physio: DailyPhysio[] = collectDailyPhysio(60);
    if (physio.filter(p => p.temp != null || p.hrv != null || p.rhr != null).length >= 7) {
      inference = inferHormones(physio, cycleRef);
    }
  } catch { return ''; }

  if (!inference) return '';

  // 雌二醇
  const e2 = inference.estradiol;
  if (e2.status !== 'insufficient') {
    const e2map: Record<string, string> = { high: '偏高', normal: '正常', low: '偏低', inconclusive: '不确定', reference: '参考值' };
    parts.push(`雌二醇(E2):${e2map[e2.status] ?? e2.status}，指数 ${fmt(e2.score)}`);
    if (e2.hrvDipDetected) parts.push('检测到HRV dip（排卵前雌激素峰值信号）');
    const trmap: Record<string, string> = { rising: '上升中', falling: '下降中', flat: '平稳', unknown: '未知' };
    if (e2.trend !== 'unknown') parts.push(`趋势 ${trmap[e2.trend] ?? e2.trend}`);
  }

  // 孕激素
  const p = inference.progesterone;
  if (p.status !== 'insufficient') {
    const pmap: Record<string, string> = { high: '偏高', normal: '正常', low: '偏低', inconclusive: '不确定', reference: '参考值' };
    parts.push(`孕激素(P4):${pmap[p.status] ?? p.status}，指数 ${fmt(p.score)}`);
    if (p.bbtConfirmed) {
      parts.push(`BBT双相体温已确认排卵，cover-baseline ${fmt(p.delta, '°C')}`);
    } else {
      parts.push('尚未检测到BBT双相体温');
    }
    const lmap: Record<string, string> = { follicular: '卵泡期', luteal: '黄体期', unknown: '未知' };
    parts.push(`当前${lmap[p.level] ?? p.level}`);
  }

  // 周期规律度
  const reg = inference.regularity;
  const regMap: Record<string, string> = { normal: '规律', possible: '可能不规律', likely: '不规律', insufficient: '数据不足' };
  parts.push(`周期规律度:${regMap[reg.irregularity] ?? reg.irregularity}`);
  if (reg.hasBiphasicBBT) parts.push('有规律BBT双相（排卵正常）');
  if (reg.rhrLutealElevated) parts.push('黄体期RHR升高（孕酮作用正常）');

  // 数据质量
  const dq = inference.dataQuality;
  parts.push(`数据覆盖:${dq.daysWithTemp}天体温/${dq.daysWithHRV}天HRV/${dq.daysWithRHR}天RHR`);

  return parts.join('；');
}

/** 计算型结果（stress / cognitive） */
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
      parts.push(`压力评分 ${s.score}；事件 ${s.eventCount} 次；峰值 ${peak}；平均恢复 ${rec}；情绪负荷 ${fmt(s.emotionalLoad)}`);
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
      parts.push(`脑力负荷 ${c.loadScore}；疲劳指数 ${c.fatigueIndex}；峰值 ${peak}；最佳时段 ${best}；恢复力 ${c.recoveryCapacity != null ? fmt(c.recoveryCapacity, '%', 0) : '-'}`);
    }
  } catch {}

  return parts.join('；');
}

/** 周期相位（RingBle curveStatus） */
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
    { key: 'hrv', label: 'HRV' }, { key: 'hr', label: '心率' },
    { key: 'stress', label: '压力' }, { key: 'eda', label: '皮电' },
    { key: 'spo2', label: '血氧' }, { key: 'temp', label: '体温' },
    { key: 'bpSys', label: '收缩压' }, { key: 'bpDia', label: '舒张压' },
  ];
  const parts: string[] = [];
  for (const m of metrics) {
    const s = metricHistorySummary(m.key, 7);
    if (s) parts.push(`${m.label}${s}`);
  }
  // 睡眠评分
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

  // ① 今日实时
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

  // ② 皮质醇完整节律分析（身体恢复详情页同款）
  const cortisol = getCortisolBlock();
  if (cortisol) blocks.push(`皮质醇节律:${cortisol}`);

  // ③ 激素推断（雌二醇/孕激素/周期规律度）
  const hormone = getHormoneBlock();
  if (hormone) blocks.push(`激素推断:${hormone}`);

  // ④ 计算型结果（stress/cognitive）
  const analysis = getAnalysisBlock();
  if (analysis) blocks.push(`情绪脑力:${analysis}`);

  // ⑤ 周期相位
  const cycle = getCycleBlock();
  if (cycle) blocks.push(cycle);

  // ⑥ 历史趋势
  const trend = getTrendBlock();
  if (trend) blocks.push(`近7天趋势:${trend}`);

  if (blocks.length === 0) return '';
  return (
    '【用户健康数据（仅作回答参考，不要逐条播报；用户没问就不主动提）】\\n' +
    blocks.join('\\n')
  );
}
