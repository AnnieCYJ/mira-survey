/**
 * patterns.ts —— **端侧规律引擎**（Phase 2）
 *
 * ══ 为什么端上也要跑一遍 ══
 * 云端 `/v1/ring/patterns` 算的是「已上传到云的那段历史」，长窗口、跨设备；
 * 端上算的是「这台手机本地有的数据」，更细（本地有分钟级睡眠分期、入睡/起床时刻、
 * 用户自报的情绪与干预记录）。两边的观察**合并去重**后一起进「人生上下文」，
 * 谁有更多样本谁说了算。
 *
 * ⚠ 铁律（与云端、与 Mira 品牌一致）：
 * · **只做描述性观察** —— 不诊断、不评分、不下"你应该"式结论；
 * · **必须带证据**（样本量 n、r / 组间差）与**置信度**；
 * · **样本不足就不出**（宁可少说，不编）。
 *
 * 复用 `lib/selfReportCalibration.ts` 的 pearsonR（同一套统计口径，不另造轮子）。
 */
import { healthStore } from '../data/healthStore';
import { pearsonR } from '../lib/selfReportCalibration';
import type { PatternObservation } from '../data/patternStore';

/** 端侧默认窗口（天） */
export const LOCAL_WINDOW_DAYS = 30;

interface DayPoint {
  date: string;
  sleepMin: number | null;
  deepPct: number | null;
  hrv: number | null;
  hr: number | null;
  steps: number | null;
  /** 皮电/交感（压力信号）日均；仅实测，推算日不进 */
  sns: number | null;
  /** 入睡时刻（当天 0 点起的分钟数） */
  bedMin: number | null;
  /** 起床时刻（当天 0 点起的分钟数） */
  wakeMin: number | null;
}

function keyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "HH:mm" → 当天分钟数；跨零点（23:50 → 6:20）统一折算成「相对 18:00 的偏移」 */
function hhmmToMinutes(s?: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  let mins = h * 60 + mi;
  // 入睡在 18:00 之后算「跨夜」，往前折 24 小时，保证同一夜里相邻两天的值可比
  if (h >= 18) mins -= 24 * 60;
  return mins;
}

function meanOf(a: number[]): number | null {
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function stdOf(a: number[]): number | null {
  if (a.length < 2) return null;
  const m = meanOf(a)!;
  return Math.sqrt(a.reduce((acc, v) => acc + (v - m) ** 2, 0) / a.length);
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function dowOf(dateISO: string): number {
  const d = new Date(dateISO + 'T12:00:00');
  return (d.getDay() + 6) % 7; // 0=周一
}

/** 样本量 + r → 置信度（与云端同一套阈值） */
function confidenceOf(n: number, r: number): { label: PatternObservation['confidence']; score: number } | null {
  const ar = Math.abs(r);
  if (n >= 14 && ar >= 0.5) return { label: 'high', score: Math.min(0.95, 0.55 + ar * 0.4) };
  if (n >= 10 && ar >= 0.35) return { label: 'medium', score: Math.min(0.8, 0.35 + ar * 0.5) };
  if (n >= 6 && ar >= 0.25) return { label: 'low', score: Math.min(0.6, 0.2 + ar * 0.6) };
  return null;
}

/** 从 healthStore 拉出最近 N 天的每日要点 */
export function collectLocalSeries(days = LOCAL_WINDOW_DAYS): DayPoint[] {
  const out: DayPoint[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const ts = today.getTime() - i * 86400000;
    const date = keyOf(ts);
    const sleep = healthStore.getSleep(date);
    const hrv = healthStore.getDay('hrv', date);
    const hr = healthStore.getDay('hr', date);
    const steps = healthStore.getDay('steps', date);
    // 皮电/压力：⚠ 只取**实测**日 —— 历史日可能是由压力换算的推算值（isDerivedDay），
    //   推算值不能当真实压力参与规律计算。
    const snsDay = healthStore.getDay('sns', date);
    const snsMeasured =
      snsDay && typeof snsDay.mean === 'number' && !healthStore.isDerivedDay('sns', date)
        ? snsDay.mean
        : null;
    out.push({
      date,
      sleepMin: sleep && sleep.total > 0 ? Math.round(sleep.total) : null,
      deepPct: sleep && sleep.total > 0 ? (sleep.deep / sleep.total) * 100 : null,
      hrv: hrv && typeof hrv.mean === 'number' ? hrv.mean : null,
      hr: hr && typeof hr.mean === 'number' ? hr.mean : null,
      steps: steps && typeof steps.mean === 'number' ? steps.mean : null,
      sns: snsMeasured,
      bedMin: hhmmToMinutes(sleep?.sleepTime),
      wakeMin: hhmmToMinutes(sleep?.wakeTime),
    });
  }
  return out;
}

/**
 * 端侧规律引擎：产出描述性观察。
 * ⚠ 与云端用**同一套 id**，便于合并去重（样本多的一方胜出）。
 */
export function computeLocalPatterns(days = LOCAL_WINDOW_DAYS): PatternObservation[] {
  const series = collectLocalSeries(days);
  const out: PatternObservation[] = [];
  const now = Date.now();
  const idx = new Map(series.map((s, i) => [s.date, i]));

  // ① 睡眠时长 ↔ 次日 HRV
  {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < series.length - 1; i++) {
      const a = series[i], b = series[i + 1];
      if (a.sleepMin != null && b.hrv != null) { xs.push(a.sleepMin); ys.push(b.hrv); }
    }
    const r = pearsonR(xs, ys);
    const conf = r == null ? null : confidenceOf(xs.length, r);
    if (conf && r != null) {
      out.push({
        id: 'sleep_nextday_hrv',
        kind: 'correlation',
        title: '睡得长的第二天，心率变异性更高',
        text: `最近 ${days} 天里，有 ${xs.length} 天的前一晚睡眠时长能和次日心率变异性对上：前一晚多睡一小时，次日心率变异性平均${r > 0 ? '更高' : '更低'}一些。`,
        evidence: { n: xs.length, r: Math.round(r * 100) / 100, detail: `${xs.length} 天配对` },
        confidence: conf.label,
        confidenceScore: round1(conf.score),
        source: 'local',
        windowDays: days,
        observedAt: now,
      });
    }
  }

  // ② 深睡占比 ↔ 同日 HRV
  {
    const xs: number[] = [], ys: number[] = [];
    for (const s of series) {
      if (s.deepPct != null && s.hrv != null) { xs.push(s.deepPct); ys.push(s.hrv); }
    }
    const r = pearsonR(xs, ys);
    const conf = r == null ? null : confidenceOf(xs.length, r);
    if (conf && r != null) {
      out.push({
        id: 'deep_sleep_hrv',
        kind: 'correlation',
        title: '深睡占比高的那天，心率变异性更稳',
        text: `深睡多的日子，心率变异性也${r > 0 ? '更高' : '更低'}——两者基本同步。`,
        evidence: { n: xs.length, r: Math.round(r * 100) / 100, detail: `${xs.length} 天配对` },
        confidence: conf.label,
        confidenceScore: round1(conf.score),
        source: 'local',
        windowDays: days,
        observedAt: now,
      });
    }
  }

  // ③ 日均心率 ↔ HRV
  {
    const xs: number[] = [], ys: number[] = [];
    for (const s of series) if (s.hr != null && s.hrv != null) { xs.push(s.hr); ys.push(s.hrv); }
    const r = pearsonR(xs, ys);
    const conf = r == null ? null : confidenceOf(xs.length, r);
    if (conf && r != null) {
      out.push({
        id: 'resting_hr_hrv',
        kind: 'correlation',
        title: '心率安静的时候，心率变异性更活跃',
        text: `日均心率低的那 ${xs.length} 天，心率变异性平均更高一点——两件事是反着走的。`,
        evidence: { n: xs.length, r: Math.round(r * 100) / 100, detail: `${xs.length} 天配对` },
        confidence: conf.label,
        confidenceScore: round1(conf.score),
        source: 'local',
        windowDays: days,
        observedAt: now,
      });
    }
  }

  // ④ 入睡时间规律性（比云端多一个维度：本地有 sleepTime）
  {
    const beds = series.map((s) => s.bedMin).filter((v): v is number => v != null);
    if (beds.length >= 5) {
      const sd = stdOf(beds);
      if (sd != null) {
        const stable = sd <= 35;
        out.push({
          id: 'bedtime_regularity',
          kind: 'rhythm',
          title: stable ? '你的入睡时间挺稳的' : '你的入睡时间有点飘',
          text: stable
            ? `最近 ${beds.length} 天的入睡时间都记着，波动大约 ${Math.round(sd)} 分钟——作息底子是稳的。`
            : `最近 ${beds.length} 天的入睡时间波动大约 ${Math.round(sd)} 分钟，早晚差得比较多。`,
          evidence: { n: beds.length, detail: `波动 ${Math.round(sd)} 分钟` },
          confidence: beds.length >= 8 ? 'medium' : 'low',
          confidenceScore: beds.length >= 8 ? 0.55 : 0.35,
          source: 'local',
          windowDays: days,
          observedAt: now,
        });
      }
    }
  }

  // ⑤ 周末 vs 工作日（睡眠时长）
  {
    const wk: number[] = [], we: number[] = [];
    for (const s of series) {
      if (s.sleepMin == null) continue;
      (dowOf(s.date) >= 5 ? we : wk).push(s.sleepMin);
    }
    if (wk.length >= 4 && we.length >= 3) {
      const a = meanOf(wk), b = meanOf(we);
      if (a != null && b != null) {
        const diff = b - a;
        if (Math.abs(diff) >= 20) {
          out.push({
            id: 'weekday_vs_weekend',
            kind: 'group_diff',
            title: '周末和工作日，你的身体状态不太一样',
            text: `对比 ${wk.length} 个工作日和 ${we.length} 个周末：睡眠时长平均${diff > 0 ? '多' : '少'} ${Math.round(Math.abs(diff))} 分钟。`,
            evidence: { n: wk.length + we.length, detail: `工作日 ${wk.length} 天 / 周末 ${we.length} 天` },
            confidence: wk.length + we.length >= 10 ? 'medium' : 'low',
            confidenceScore: wk.length + we.length >= 10 ? 0.6 : 0.4,
            source: 'local',
            windowDays: days,
            observedAt: now,
          });
        }
      }
    }
  }

  // ⑥ 步数 ↔ 次日日均心率
  {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < series.length - 1; i++) {
      const a = series[i], b = series[i + 1];
      if (a.steps != null && b.hr != null) { xs.push(a.steps); ys.push(b.hr); }
    }
    const r = pearsonR(xs, ys);
    const conf = r == null ? null : confidenceOf(xs.length, r);
    if (conf && r != null) {
      out.push({
        id: 'steps_nextday_hr',
        kind: 'correlation',
        title: '走得多的第二天，心率更安静',
        text: `走得多的那天，第二天心率平均${r < 0 ? '更低' : '更高'}——活动越足，恢复越松。`,
        evidence: { n: xs.length, r: Math.round(r * 100) / 100, detail: `${xs.length} 天配对` },
        confidence: conf.label,
        confidenceScore: round1(conf.score),
        source: 'local',
        windowDays: days,
        observedAt: now,
      });
    }
  }

  // ⑦ 压力（皮电 SNS）↔ 次日心率变异性
  {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < series.length - 1; i++) {
      const a = series[i], b = series[i + 1];
      if (a.sns != null && b.hrv != null) { xs.push(a.sns); ys.push(b.hrv); }
    }
    const r = pearsonR(xs, ys);
    const conf = r == null ? null : confidenceOf(xs.length, r);
    if (conf && r != null) {
      out.push({
        id: 'stress_nextday_hrv',
        kind: 'correlation',
        title: '皮电活跃的那天，第二天心率变异性偏低',
        text: `压力高的那天，第二天心率变异性平均${r < 0 ? '更低' : '更高'}——紧绷之后，身体恢复的余地会变小。`,
        evidence: { n: ys.length, r: Math.round(r * 100) / 100, detail: `${ys.length} 天配对（仅实测）` },
        confidence: conf.label,
        confidenceScore: round1(conf.score),
        source: 'local',
        windowDays: days,
        observedAt: now,
      });
    }
  }

  // ⑧ 数据覆盖（诚实交代样本够不够）
  {
    const withCore = series.filter((s) => s.sleepMin != null || s.hrv != null).length;
    out.push({
      id: 'data_coverage',
      kind: 'coverage',
      title: `这 ${days} 天里有 ${withCore} 天有可用数据`,
      text: withCore >= days * 0.6
        ? '数据比较连续，下面这些观察基本站得住。'
        : '数据还不够连续，下面有些观察可能会随佩戴时间变化。',
      evidence: { n: withCore, detail: `窗口 ${days} 天` },
      confidence: 'context',
      confidenceScore: 0.3,
      source: 'local',
      windowDays: days,
      observedAt: now,
    });
  }

  return out;
}

/**
 * 合并云端 + 端侧观察：同 id 只留**样本更多**的那条（证据更硬），
 * 样本一样时端侧优先（本地数据更细）。
 */
export function mergeObservations(
  cloud: PatternObservation[],
  local: PatternObservation[],
): PatternObservation[] {
  const map = new Map<string, PatternObservation>();
  for (const o of cloud) map.set(o.id, o);
  for (const o of local) {
    const prev = map.get(o.id);
    if (!prev) { map.set(o.id, o); continue; }
    const prevN = prev.evidence?.n ?? 0;
    const curN = o.evidence?.n ?? 0;
    if (curN > prevN || (curN === prevN && o.source === 'local')) map.set(o.id, o);
  }
  return [...map.values()].sort(
    (a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) || (b.evidence?.n ?? 0) - (a.evidence?.n ?? 0),
  );
}
