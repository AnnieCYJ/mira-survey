// 健康数据快照：注入所有可获取的健康数据给 MiraAI
// Token budget 控制：健康块总计 ≤ 800 token，留空间给 system prompt + 对话历史

import { peekHabits } from '../data/habitSuggestions';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey, type MetricKey } from '../data/healthStore';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
// ★ 2026-10-05：AI 认知口径从「疲劳/负荷」改为「准备度」（与首页、洞察页、详情页同源）
import { computeReadinessSeries, readinessLevel, readinessLevelLabel } from '../lib/cognitiveReadiness';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectDailyPhysio, inferHormones, type DailyPhysio } from '../lib/hormoneInference';
import { factsForDay, sleepFactForDay } from '../lib/analysisFacts';

const FEMALE_STATE: Record<number, string> = {
  0: '未设置经期', 1: '月经期', 2: '备孕期', 3: '怀孕期', 4: '辣妈期',
};

function fmt(v: number | null | undefined, unit = '', digits = 1): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)}${unit}`;
}

/**
 * 只在有值时输出「标签 值」，无值**整项省略**。
 *
 * 为什么必须这样：这段文本是**直接喂给端侧小模型**的。早期用 `${fmt(v)}` / `${v}` 直接插值，
 * fmt 无值时返回 null、字段缺失时是 undefined，模板字符串会把它变成字符串 "null" / "undefined"
 * 写进数据串，模型原样复述出去 → 页面上出现「压力评分null」「最佳时段~」这类脏文案；
 * 用 '-' 占位同样会被模型读成「无数据」并复述。所以缺数据就整项别写。
 */
function kv(out: string[], label: string, v: number | null | undefined, unit = '', digits = 1): void {
  const s = fmt(v, unit, digits);
  if (s != null && s !== '') out.push(`${label} ${s}`);
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
/** 今日皮质醇节律摘要（todayLevel + 峰值/连续天数/异常项），与身体恢复页顶部大字、CortisolDailyChart 同源 */
export interface TodayCortisolSummary {
  level: 'normal' | 'high' | 'dysregulated';
  /** 峰值时刻（小时，小数） */
  peakH: number | null;
  /** 节律中值 MESOR */
  mesor: number | null;
  amplitude: number | null;
  /** 连续偏高天数（含今天） */
  highStreak: number;
  /** 连续紊乱天数（含今天） */
  dysStreak: number;
  /** 具体异常项（来自算法 flags） */
  flags: string[];
}

/** 取今日皮质醇节律摘要（无样本 → null）。AI 与规则兜底共用，保证页面、大字、文案三者口径一致。 */
export function getTodayCortisolSummary(): TodayCortisolSummary | null {
  try {
    const samples: { t: number; v: number }[] = [];
    const now = Date.now();
    for (let i = 0; i < 14; i++) {
      const dk = dayKey(now - i * 86400000);
      for (const p of healthStore.getIntraday('cortisol', dk)) samples.push({ t: p.t, v: p.v });
    }
    if (samples.length < 4) return null;
    const r = analyzeCortisol(samples, 14);
    const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
    return {
      level: r.todayLevel,
      peakH: fin(r.cosinor.acrophaseH),
      mesor: fin(r.cosinor.mesor),
      amplitude: fin(r.cosinor.amplitude),
      highStreak: r.highStreak,
      dysStreak: r.dysStreak,
      flags: r.status.flags || [],
    };
  } catch {
    return null;
  }
}

function getTodayRhythmLevel(): 'normal' | 'high' | 'dysregulated' | null {
  return getTodayCortisolSummary()?.level ?? null;
}

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

  // 4. 今日节律（todayLevel）—— 与身体恢复页顶部大字 / CortisolDailyChart 同源，保证 AI 文案与其一致。
  //    ★ 只保留这一条「今日」表述。早期同时输出「节律状态 节律紊乱」和「今日节律 紊乱」，
  //      模型会把块名「皮质醇节律」和值「节律紊乱」连读成「皮质醇节律节律紊乱」。
  const cmap: Record<string, string> = { normal: '正常', sustained_high: '偏高', dysregulated: '紊乱' };
  const todayLv = getTodayRhythmLevel();
  parts.push(`今日节律 ${todayLv ? cmap[todayLv] : cmap[cc.status] ?? cc.status}`);
  if (cc.flags && cc.flags.length) {
    parts.push(`异常项 ${cc.flags.join('、')}`);
  }

  // 5. 连续偏高
  if (cc.sustainedHighStreak > 0) {
    parts.push(`连续 ${cc.sustainedHighStreak} 天偏高`);
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

  // Stress（全程用 kv 组装：缺项整项省略，不写 null / '-'）
  try {
    const s = cached?.stress ?? (() => {
      const r = computeStressReport();
      return {
        score: r.score, peakHour: r.peakHour, emotionalLoad: r.emotionalLoad,
        avgRecoverySec: r.avgRecoverySec, eventCount: r.events.length,
      };
    })();
    if (s) {
      const bits: string[] = [];
      kv(bits, '压力评分', s.score);
      if (s.eventCount != null) bits.push(`压力事件 ${s.eventCount} 次`);
      kv(bits, '情绪消耗', s.emotionalLoad, '/100', 0);
      if (s.avgRecoverySec != null) bits.push(`压力后平均恢复 ${Math.round(s.avgRecoverySec)}s`);
      if (s.peakHour != null) bits.push(`压力峰值 ${String(Math.round(s.peakHour)).padStart(2, '0')}:00`);
      if (bits.length) parts.push(`情绪压力：${bits.join('，')}`);
    }
  } catch {}

  // Cognitive —— ★ 认知准备度（不是疲劳）
  try {
    const r = computeCognitiveLoadReport();
    const ready = computeReadinessSeries(r);
    const bits: string[] = [];
    if (ready.now != null) {
      bits.push(`此刻准备度 ${ready.now}/100（${readinessLevelLabel(ready.now)}）`);
    }
    if (ready.avg != null) bits.push(`全天均值 ${ready.avg}/100`);
    if (ready.morning != null) bits.push(`晨起 ${ready.morning}`);
    if (ready.nightLow != null) bits.push(`夜间低谷 ${ready.nightLow}`);
    if (ready.peakHour != null) bits.push(`状态最佳 ${String(ready.peakHour).padStart(2, '0')}:00`);
    if (ready.troughHour != null) bits.push(`需要休息 ${String(ready.troughHour).padStart(2, '0')}:00`);
    // 恢复力是 0–1 比值（computeRecoveryCapacity = minWinMean / hrvBase），必须 ×100 才是百分数
    if (r.recoveryCapacity != null) kv(bits, '恢复力', r.recoveryCapacity * 100, '%', 0);
    if (r.sleepDebt != null && r.sleepDebt > 0.2) bits.push(`睡眠债 ${r.sleepDebt.toFixed(1)}h`);
    if (bits.length) {
      parts.push(`认知准备度：${bits.join('，')}。口径：分数越高表示此刻越「转得动」（非疲劳分，勿反向解读）；`
        + '正常为上午高、傍晚低；与个人基线对比，无实测的时段不作数');
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

// ★ 性能：健康快照计算极重（皮质醇 30 天 intraday / 激素 60 天 / 压力 / 准备度），且数据按天更新、变化慢。
//   缓存 60s：同一会话内连续提问、或洞察页 AI 分析与聊天并发时，避免重复跑这几秒的同步重算（省 JS 线程）。
let _healthSnapCache: { at: number; value: string } | null = null;
const HEALTH_SNAP_TTL_MS = 60 * 1000;

export function buildHealthSnapshot(): string {
  const now = Date.now();
  if (_healthSnapCache && now - _healthSnapCache.at < HEALTH_SNAP_TTL_MS) return _healthSnapCache.value;
  const st = RingBle.getState();
  const daily = st.daily || {};
  const blocks: string[] = [];

  // ① 今日实时
  const rt: string[] = [];
  const add = (label: string, v: string | null) => { if (v) rt.push(`${label}=${v}`); };
  const basicMetrics: Array<{ key: MetricKey; label: string; unit: string }> = [
    { key: 'hr', label: '心率', unit: 'bpm' },
    { key: 'spo2', label: '血氧', unit: '%' },
    { key: 'hrv', label: 'HRV', unit: 'ms' },
    { key: 'temp', label: '体温', unit: '℃' },
    { key: 'eda', label: '皮电', unit: '' },
    { key: 'stress', label: '压力', unit: '' },
  ];
  const facts = factsForDay(basicMetrics.map((m) => m.key), new Date(now));
  const sourceLabels = { measured: '设备记录', self_reported: '用户记录', derived: '推算', snapshot: '缓存', unknown: '来源未确认' };
  const basicLines = facts.flatMap((fact, index) => {
    if (fact.quality === 'missing' || typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return [];
    const meta = basicMetrics[index];
    return [`${meta.label}日汇总=${fmt(fact.value, meta.unit)}（${fact.date}；${sourceLabels[fact.source]}；${fact.sampleCount}个样本；覆盖质量待确认）`];
  });
  if (basicLines.length) blocks.push(`• 基础指标：${basicLines.join('，')}`);
  blocks.push('• 解读规则：日汇总不代表当前值或全天连续监测；推算和来源未确认的记录不能称为实测；缺少的指标不补零、不推测。');
  add('步数', fmt(daily['steps']));
  // 睡眠：优先取 healthStore 的分钟级明细。
  // ★ RingBle.daily 里 sleepTotal 是「分钟」、而 sleepDeep/sleepRem 是「百分比」，
  //   早期把三者都标成 min 喂给模型，导致 AI 输出「深睡只有 30min」这类错口径结论。
  let sleepFromStore = false;
  try {
    const ss = healthStore.getSleep(dayKey(Date.now()));
    if (ss && ss.total > 0) {
      add('睡眠总时长', `${Math.round(ss.total)}min`);
      // 同时给「分钟」和「占比」：只给分钟时，模型看到「深睡 30min / 总时长 591min」会
      // 直接判「深睡严重不足」，但无法解释它到底占多少，容易和「睡眠评分」自相矛盾。
      const deepPct = Math.round((ss.deep / ss.total) * 100);
      add('深睡', `${Math.round(ss.deep)}min(占${deepPct}%)`);
      add('REM', `${Math.round(ss.rem)}min(占${Math.round((ss.rem / ss.total) * 100)}%)`);
      if (ss.awake != null && ss.awake > 0) add('夜间清醒', `${Math.round(ss.awake)}min`);
      add('睡眠评分', fmt(ss.score));
      if (ss.sleepTime) add('入睡时刻', ss.sleepTime);
      if (ss.wakeTime) add('起床时刻', ss.wakeTime);
      sleepFromStore = true;
    }
  } catch {}
  if (!sleepFromStore) {
    add('睡眠总时长', fmt(daily['sleepTotal'], 'min'));
    add('深睡占比', fmt(daily['sleepDeep'], '%', 0));
    add('REM占比', fmt(daily['sleepRem'], '%', 0));
    add('睡眠评分', fmt(daily['sleepScore']));
  }
  const sleepFact = sleepFactForDay(new Date(now));
  if (sleepFact.quality !== 'missing') {
    blocks.push(`• 睡眠事实：${sleepFact.date}；睡眠评分 ${sleepFact.value}；${sleepFact.source}；${sleepFact.sampleCount} 条夜间摘要`);
  }
  const tl = st.statusTimeline || [];
  if (tl.length) {
    const last = tl[tl.length - 1];
    add('今日状态值', `${last.value}/100(${last.level})`);
  }
  // 当前时段（AI 用它判断是白天工作还是夜晚休息场景）
  const h = new Date().getHours();
  const timeLabel = h >= 6 && h < 12 ? '上午' : h >= 12 && h < 18 ? '下午' : h >= 18 && h < 22 ? '傍晚' : '深夜';
  blocks.push(`• 当前时段：${timeLabel}(${h}:00)`);
  if (rt.length) blocks.push(`• 睡眠与活动摘要：${rt.join('，')}`);

  // ② 代谢血液指标（「代谢」tab 真实展示的数据，与下方皮质醇节律分属不同维度）
  //    ★ 早期事实串只有总胆固醇/血糖/梅脱，模型分析「代谢」时拿不到血脂四项细节，
  //      分析文案写不出 tab 里看到的真实指标。这里补齐血液成分面板全量数据。
  {
    const metabParts: string[] = [];
    const mkv = (label: string, v: number | null | undefined, unit: string) => {
      const s = fmt(v, unit);
      if (s != null && s !== '') metabParts.push(`${label} ${s}`);
    };
    mkv('血糖', daily['bloodSugar'], 'mmol/L');
    mkv('甘油三酯', daily['triglyceride'], 'mmol/L');
    mkv('HDL', daily['hdl'], 'mmol/L');
    mkv('LDL', daily['ldl'], 'mmol/L');
    mkv('总胆固醇', daily['cholesterol'], 'mmol/L');
    mkv('尿酸', daily['uricAcid'], 'μmol/L');
    mkv('代谢率', daily['metabolicRate'], 'kcal');
    if (metabParts.length) blocks.push(`• 代谢血液指标：${metabParts.join('，')}`);
  }

  // ③ 皮质醇完整节律分析（身体恢复详情页同款）
  const cortisol = getCortisolBlock();
  if (cortisol) blocks.push(`• 皮质醇节律：${cortisol}`);

  // ④ 激素推断（雌二醇/孕激素/周期规律度）
  const hormone = getHormoneBlock();
  if (hormone) blocks.push(`• 激素推断：${hormone}`);

  // ⑤ 计算型结果（stress/cognitive）
  const analysis = getAnalysisBlock();
  if (analysis) blocks.push(`• 情绪脑力：${analysis}`);

  // ⑥ 周期相位
  const cycle = getCycleBlock();
  if (cycle) blocks.push(`• 周期相位：${cycle}`);

  // ⑦ 历史趋势
  const trend = getTrendBlock();
  if (trend) blocks.push(`• 近7天趋势：${trend}`);

  // ⑧ 用户已确认的好习惯（工具页「我的建议」清单）——让 Mira 的建议能引用用户自己的真实证据
  const habits = peekHabits().habits;
  if (habits.length) {
    const top = [...habits].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 3);
    blocks.push(
      `• 用户已确认的好习惯：${top
        .map((h) => `${h.action}（${h.metric}；已确认 ${h.count} 次）`)
        .join('；')}`
    );
  }

  if (blocks.length === 0) {
    _healthSnapCache = { at: Date.now(), value: '' };
    return '';
  }
  // 每块独占一行、以「• 块名：」开头：早期把多块用「；」串成一段，模型会把「皮质醇节律」
  // 和「情绪脑力」等块名当成正文一起复述成一大段。分块换行后模型更容易按块分行输出。
  const value =
    '【用户健康数据（仅作解读参考；不要逐条播报原始数字，要给出结论与建议）】\n' +
    blocks.join('\n');
  _healthSnapCache = { at: Date.now(), value };
  return value;
}
