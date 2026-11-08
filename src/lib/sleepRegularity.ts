/**
 * sleepRegularity.ts —— 「睡眠规律性」唯一算法层（纯函数，零 UI 依赖）
 *
 * ══ 这张图怎么读 ══
 * 每天一根**区间柱**：下端 = 入睡时刻，上端 = 起床时刻，柱高 = 这一夜躺下到起来的跨度。
 * 纵轴是一条被拉直的连续时间轴：18:00 = 18，次日 00:00 = 24，次日 12:00 = 36。
 * 跨午夜必须 +24 拉直，否则「23:30 睡、07:00 起」会画成倒挂的柱子。
 * 一排柱子齐不齐 → 规律；整体逐日往下挪 → 逐渐偏晚，反之逐渐偏早。
 *
 * ══ 数据来源（真实、逐日可得） ══
 * `RingBleManager` 的 BATCH-SLEEP 对每一天调 `healthStore.recordSleep(dk, {...sleepTime, wakeTime})`，
 * 快照恢复 `rebuildSleepFromSnapshot()` 也原样保留这两个字段。
 * 故 `healthStore.getSleep(dk)` 的历史夜确实带入睡 / 起床时刻，**不需要推算、不需要编造**。
 * 缺时刻 / 时长明显异常的夜 → 该槽留空（bedH = null），绝不拿前后日补。
 *
 * ══ 口径纪律（Mira 品牌） ══
 * 只做描述性观察：说「波动多少分钟」「一路往后挪」，不做评分、不诊断、不下建议。
 */
import { healthStore } from '../data/healthStore';
import { bedtimeHour, fmtClockHM, parseClockMinutes } from './sleepTime';

export type SleepRangeKey = 'week' | 'month' | 'year';

/** 纵轴固定范围：底 18:00、顶次日 12:00（固定刻度才方便跨周/月/年比较，不随数据跳）。 */
export const AXIS_MIN_H = 18;
export const AXIS_MAX_H = 36;
/** 纵轴刻度，每 3 小时一根；>=24 的按「次日」展示。 */
export const AXIS_TICKS_H = [18, 21, 24, 27, 30, 33, 36];

export interface SleepNightPoint {
  /** 归属日 YYYY-MM-DD；年视图为 YYYY-MM-01 */
  date: string;
  /** 横轴标签（周一 / 日号 / 月份） */
  label: string;
  /** 归一入睡小时（18–36）；null = 当晚无有效时刻 */
  bedH: number | null;
  /** 归一起床小时（18–36，恒 > bedH）；null = 当晚无有效时刻 */
  wakeH: number | null;
  bedClock: string | null;
  wakeClock: string | null;
  /** 入睡→起床跨度（小时） */
  durationH: number | null;
  /** 聚合进这个点的有效夜数（周/月 = 0 或 1；年 = 该月有效夜数） */
  samples: number;
}

export interface RegularityReport {
  /** 有效夜数 */
  n: number;
  label: string;
  tone: 'good' | 'warn' | 'neutral';
  sdBedMin: number | null;
  sdWakeMin: number | null;
  meanBedH: number | null;
  meanWakeH: number | null;
  meanDurationH: number | null;
  /** 最小二乘斜率：周/月为「分钟/晚」，年为「分钟/月」 */
  slopeMinPerStep: number | null;
  /** 首段与末段入睡时刻差（分钟），用于确认趋势不是单点噪声 */
  headTailMin: number | null;
  summary: string;
}

export interface BaselineComparison {
  latest: SleepNightPoint | null;
  baselineBedH: number | null;
  baselineClock: string | null;
  /** 参与基线的「前面几晚」数量 */
  baselineN: number;
  /** 最近一晚入睡 − 基线，正值 = 睡晚了（分钟） */
  diffMin: number | null;
  headline: string;
  tone: 'good' | 'warn' | 'neutral';
}

/* ── 小工具 ───────────────────────────────────────────────────────────── */

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7)); // 0=周一
}
function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((acc, v) => acc + (v - m) ** 2, 0) / a.length);
}
/** 最小二乘斜率（y 单位 = 分钟，x = 序号 0..n-1）。 */
function slope(a: number[]): number | null {
  const n = a.length;
  if (n < 4) return null;
  const mx = (n - 1) / 2;
  const my = mean(a);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (a[i] - my);
    den += (i - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}
/** 归一小时 → "HH:mm"（>=24 折回次日钟面）。 */
export function clockFromNormH(h: number): string {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  const mm = Math.round((t - hh) * 60);
  const carry = mm === 60 ? 1 : 0;
  return `${String((hh + carry) % 24).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}
/** 纵轴刻度文案：24 → "00:00"，27 → "03:00"。 */
export function axisLabel(h: number): string {
  return clockFromNormH(h);
}
function emptyPoint(date: string, label: string): SleepNightPoint {
  return { date, label, bedH: null, wakeH: null, bedClock: null, wakeClock: null, durationH: null, samples: 0 };
}

/* ── 单夜读取 ─────────────────────────────────────────────────────────── */

/**
 * 读一晚的入睡 / 起床时刻。戒指按「起床日」归档（`getSleep(dk)` = 昨夜睡→今早醒）。
 * 跨午夜：起床钟面 < 12 点一律 +24；仍不晚于入睡再 +24（防脏数据倒挂）。
 * 时长不在 2–16 小时 → 判为异常记录，整晚留空。
 */
function nightOf(dk: string, label: string): SleepNightPoint {
  const s = healthStore.getSleep(dk);
  if (!s) return emptyPoint(dk, label);
  const bed = bedtimeHour(s.sleepTime); // 已处理「凌晨入睡 +24」
  const wMin = parseClockMinutes(s.wakeTime);
  if (bed == null || wMin == null) return emptyPoint(dk, label);
  let wake = wMin / 60;
  if (wake < 12) wake += 24;
  if (wake <= bed) wake += 24;
  const dur = wake - bed;
  if (!Number.isFinite(dur) || dur < 2 || dur > 16) return emptyPoint(dk, label);
  return {
    date: dk,
    label,
    bedH: clamp(bed, AXIS_MIN_H, AXIS_MAX_H),
    wakeH: clamp(wake, AXIS_MIN_H, AXIS_MAX_H),
    bedClock: fmtClockHM(s.sleepTime),
    wakeClock: fmtClockHM(s.wakeTime),
    durationH: dur,
    samples: 1,
  };
}

/* ── 周 / 月 / 年序列 ─────────────────────────────────────────────────── */

const WEEK_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 生成区间柱图所需的逐柱数据。
 * · 周：anchor 所在周的周一→周日，7 根柱；
 * · 月：anchor 所在月 1 号→月末，每天一根；
 * · 年：anchor 所在年 12 根柱，每月取该月有效夜的**中位数**（否则 365 根没法看）。
 * 无数据的槽保留占位（bedH = null），由图表画空槽，不塌缩、不补值。
 */
export function collectSleepSeries(range: SleepRangeKey, anchor: Date): SleepNightPoint[] {
  const out: SleepNightPoint[] = [];
  if (range === 'week') {
    const start = mondayOf(anchor);
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      out.push(nightOf(iso(d), WEEK_LABEL[i]));
    }
    return out;
  }
  if (range === 'month') {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      const d = new Date(y, m, i);
      out.push(nightOf(iso(d), String(i)));
    }
    return out;
  }
  const y = anchor.getFullYear();
  for (let m = 0; m < 12; m++) {
    const days = new Date(y, m + 1, 0).getDate();
    const beds: number[] = [];
    const wakes: number[] = [];
    const durs: number[] = [];
    for (let i = 1; i <= days; i++) {
      const p = nightOf(iso(new Date(y, m, i)), String(i));
      if (p.bedH != null && p.wakeH != null && p.durationH != null) {
        beds.push(p.bedH);
        wakes.push(p.wakeH);
        durs.push(p.durationH);
      }
    }
    const dk = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    out.push(
      beds.length
        ? {
            date: dk,
            label: `${m + 1}月`,
            bedH: median(beds),
            wakeH: median(wakes),
            bedClock: clockFromNormH(median(beds)),
            wakeClock: clockFromNormH(median(wakes)),
            durationH: median(durs),
            samples: beds.length,
          }
        : emptyPoint(dk, `${m + 1}月`),
    );
  }
  return out;
}

/** 横轴刻度：周全给，月取 1/8/15/22/月末，年取 1/4/7/10/12 月。 */
export function seriesTicks(points: SleepNightPoint[], range: SleepRangeKey): { i: number; label: string }[] {
  const n = points.length;
  if (!n) return [];
  if (range === 'week') return points.map((p, i) => ({ i, label: p.label.slice(1) }));
  if (range === 'month') {
    const idx = [...new Set([0, 7, 14, 21, n - 1])].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    return idx.map((i) => ({ i, label: points[i].label }));
  }
  return [0, 3, 6, 9, 11].filter((i) => i < n).map((i) => ({ i, label: points[i].label }));
}

/* ── 规律性判定 ───────────────────────────────────────────────────────── */

/**
 * 描述性判定。优先级：数据不足 → 明确趋势 → 稳定 → 明显散 → 轻微波动。
 * 趋势必须同时满足「斜率够大」+「首尾段差够大」，避免某一晚熬到 2 点就把整周判成「逐渐偏晚」。
 */
export function analyzeSleepRegularity(points: SleepNightPoint[], range: SleepRangeKey = 'week'): RegularityReport {
  const valid = points.filter((p) => p.bedH != null && p.wakeH != null);
  const n = valid.length;
  const base: RegularityReport = {
    n, label: '数据不足', tone: 'neutral',
    sdBedMin: null, sdWakeMin: null, meanBedH: null, meanWakeH: null,
    meanDurationH: null, slopeMinPerStep: null, headTailMin: null,
    summary: '',
  };
  if (n === 0) {
    base.summary = '这段时间还没有带入睡 / 起床时刻的记录，连续记录后这里会自动画出对应的区间柱。';
    return base;
  }
  const beds = valid.map((p) => (p.bedH as number) * 60);
  const wakes = valid.map((p) => (p.wakeH as number) * 60);
  const durs = valid
    .map((p) => p.durationH)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const sdBedMin = n >= 2 ? std(beds) : 0;
  const sdWakeMin = n >= 2 ? std(wakes) : 0;
  const slopeMin = slope(beds);
  const k = Math.max(1, Math.min(3, Math.floor(n / 3)));
  const headTailMin = n >= 4 ? mean(beds.slice(-k)) - mean(beds.slice(0, k)) : null;
  const stepWord = range === 'year' ? '每月' : '每晚';
  /** 年视图按「个月」聚合，周/月按「晚」；文案单位必须跟着数据粒度走 */
  const unitWord = range === 'year' ? '个月' : '晚';
  const slopeGate = range === 'year' ? 18 : 10;

  Object.assign(base, {
    sdBedMin, sdWakeMin,
    meanBedH: mean(beds) / 60,
    meanWakeH: mean(wakes) / 60,
    meanDurationH: durs.length ? mean(durs) : null,
    slopeMinPerStep: slopeMin,
    headTailMin,
  });

  if (n < 3) {
    base.summary = `目前只有 ${n} ${unitWord}的有效记录，连续记录后这里会给出规律性判断。`;
    return base;
  }
  if (
    slopeMin != null && headTailMin != null &&
    slopeMin >= slopeGate && headTailMin >= 30
  ) {
    base.label = '逐渐偏晚';
    base.tone = 'warn';
    base.summary = `入睡时间一路往后挪，平均${stepWord}晚约 ${Math.round(slopeMin)} 分钟，前后差了 ${Math.round(headTailMin)} 分钟。`;
    return base;
  }
  if (
    slopeMin != null && headTailMin != null &&
    slopeMin <= -slopeGate && headTailMin <= -30
  ) {
    base.label = '逐渐偏早';
    base.tone = 'good';
    base.summary = `入睡时间在慢慢提前，平均${stepWord}早约 ${Math.round(-slopeMin)} 分钟，前后差了 ${Math.round(-headTailMin)} 分钟。`;
    return base;
  }
  if (sdBedMin <= 30 && sdWakeMin <= 45) {
    base.label = '相对规律';
    base.tone = 'good';
    base.summary = `${n} ${unitWord}里，入睡大多落在 ${clockFromNormH(mean(beds) / 60)} 前后，波动约 ${Math.round(sdBedMin)} 分钟，几根柱子基本齐平。`;
    return base;
  }
  if (sdBedMin >= 60 || sdWakeMin >= 75) {
    base.label = '不太规律';
    base.tone = 'warn';
    base.summary = `${n} ${unitWord}里，入睡波动约 ${Math.round(sdBedMin)} 分钟、起床约 ${Math.round(sdWakeMin)} 分钟，早晚差得比较明显。`;
    return base;
  }
  base.label = '略有波动';
  base.tone = 'neutral';
  base.summary = `${n} ${unitWord}里，入睡波动约 ${Math.round(sdBedMin)} 分钟，整体还算齐，个别几次偏晚或偏早。`;
  return base;
}

/* ── 最近一晚 vs 前面基线 ─────────────────────────────────────────────── */

/** 基线窗口：最近一晚之前的 14 个有效夜，取中位数（比均值更抗偶尔一晚熬夜）。 */
export const BASELINE_N = 14;

/**
 * 从 anchor 往前最多 60 天找最近一晚有效记录，再拿它之前的 BASELINE_N 晚算入睡基线。
 * 结论只讲「早了 / 晚了 / 差不多」+ 分钟数，不给建议、不做评分。
 */
export function buildBaselineComparison(anchor: Date, windowDays = 60): BaselineComparison {
  const found: SleepNightPoint[] = [];
  for (let i = 0; i < windowDays && found.length < BASELINE_N + 1; i++) {
    const d = addDays(anchor, -i);
    const p = nightOf(iso(d), iso(d));
    if (p.bedH != null && p.wakeH != null) found.push(p);
  }
  const latest = found[0] ?? null;
  const prior = found.slice(1);
  const baselineN = prior.length;
  const baselineBedH = baselineN ? median(prior.map((p) => p.bedH as number)) : null;
  const empty: BaselineComparison = {
    latest, baselineBedH, baselineClock: baselineBedH != null ? clockFromNormH(baselineBedH) : null,
    baselineN, diffMin: null, headline: '', tone: 'neutral',
  };
  if (!latest || latest.bedH == null) {
    empty.headline = '最近还没有带入睡 / 起床时刻的睡眠记录';
    return empty;
  }
  if (baselineN < 3 || baselineBedH == null) {
    empty.headline = `还在攒作息基线（已有 ${baselineN} 晚）`;
    return empty;
  }
  const diffMin = (latest.bedH - baselineBedH) * 60;
  if (Math.abs(diffMin) < 10) {
    empty.headline = `和前面 ${baselineN} 晚差不多`;
  } else if (diffMin > 0) {
    empty.headline = `比前面 ${baselineN} 晚睡晚了 ${Math.round(diffMin)} 分钟`;
  } else {
    empty.headline = `比前面 ${baselineN} 晚睡早了 ${Math.round(-diffMin)} 分钟`;
  }
  empty.diffMin = diffMin;
  empty.tone = diffMin < -10 ? 'good' : diffMin >= 45 ? 'warn' : 'neutral';
  return empty;
}
