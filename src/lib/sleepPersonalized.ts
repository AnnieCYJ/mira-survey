/**
 * ══ sleepPersonalized ══ 「今天该显示哪个睡眠分」的唯一入口（v18.144）
 *
 * ══ 为什么需要这个模块 ══
 * 改动前，项目里「睡眠」有**三套互不相同的口径**：
 *   ① `sleepScore.ts` 的绝对分（时长/深睡/效率/起夜，对固定目标打分）
 *   ② `cognitiveLoad.ts` 的 `sleepRecovery`（**两项简化**：0.6×时长充足 + 0.4×深睡占比）
 *   ③ `cognitiveLoad.ts` 的 `sleepDebt`（7 天，带 exp 衰减）
 * ⇒ 同一个人在首页看到「睡眠恢复 78」，在脑力页却被另一套算法当 0.72 用 ——
 *   这就是 MEMORY 里那条「同一指标两个界面口径不一致 ⇒ 视觉漂移」的经典案例。
 *
 * 本模块把「取数 → 建基线 → 选口径 → 出分 + 规律性」收成一处，
 * UI 只读这里，不再各自拼公式。
 *
 * ══ 口径切换必须让用户看见 ══
 * `mode: 'absolute' | 'relative'` 会随佩戴天数从 absolute 切到 relative，
 * 那一刻分数会「跳一下」（锚点从 100 分制变成 50 分制）。
 * UI 必须显示 `daysToReady`（「还需 N 晚建立个人基线」），
 * 否则用户会以为 App 出 bug。**这条比算法本身重要。**
 */

import { healthStore, dayKey as hsDayKey, parseDayKey, type SleepSummary } from '../data/healthStore';
import { computePersonalizedSleepScore, type PersonalizedSleepResult } from './sleepScore';
import {
  buildSleepDimensionCenters, computeSleepRegularity,
  SLEEP_BASELINE_DAYS, MIN_RELATIVE_DAYS,
  type RegularityResult, type SleepBaselineInput,
} from './sleepBaseline';

export interface SleepPersonalizedReport {
  /** 今晚这一觉的睡眠分（0-100）。无睡眠数据时为 null —— UI 显「—」 */
  score: number | null;
  /** 口径标记：relative = 对比个人基线；absolute = 仍在用固定目标 */
  mode: 'relative' | 'absolute';
  /** 参与基线的天数 */
  baselineDays: number;
  /** 距进入个人化口径还差几天 */
  daysToReady: number;
  /** 规律性（数据不足时 score 为 null） */
  regularity: RegularityResult;
  /** 数据来源日（用于文案「昨晚」/ 日期） */
  sourceDayKey: string | null;
  /** 可用于恢复分的夜间生理信号比例 */
  physiologyCoverage: number;
}

/** 从 SleepSummary 抽成基线需要的最小字段。 */
function toInput(s: SleepSummary, daysAgo: number): SleepBaselineInput {
  const awake = (s.awake ?? 0) + (s.insomnia ?? 0);
  return {
    total: s.total ?? 0,
    deep: s.deep ?? 0,
    awakePlusInsomnia: awake > 0 ? awake : null,
    getUp: s.getUp ?? null,
    bedHour: s.bedHour ?? null,
    wakeHour: s.wakeHour ?? null,
    daysAgo,
  };
}

/**
 * 只认**今晚这一觉**。
 * 睡眠摘要常记在前一日（跨午夜），所以今天这条、或昨天那条且起床时刻落在今早，都算。
 * ⚠ 与 `cognitiveLoad.ts` 的 `sleepSourceDate` 同一口径，刻意保持一致。
 */
// ★ 2026-10-06（用户铁律：无今日睡眠即「—」，绝不挪用旧归档/昨日睡眠）：
//   **只认今日睡眠**（按起床日归档，今天起床那觉存在今日 key 下）。
//   删除原「昨日回退」——它会把任何历史晨间睡眠（含被错误归档到昨天的旧觉）当作今晚睡眠，
//   正是首页「睡眠恢复」冒出 59 等旧分数的根源。
function findTonightSleep(nowMs: number): { s: SleepSummary; dk: string } | null {
  const today = healthStore.getSleep(hsDayKey(nowMs));
  if (today && (today.total ?? 0) > 0) return { s: today, dk: hsDayKey(nowMs) };
  return null;
}

/**
 * 主入口：算「今晚的睡眠恢复分 + 规律性」。
 * @param nowMs 当前时间（默认 Date.now）
 *
 * ★ 2026-10-13（用户：「为啥不是像 Oura/WHOOP 醒来就定了？因为睡眠时间已经定了啊」）
 *    —— **醒来即定稿**。原「醒后 90 分钟才冻」是我自己加的保险（防 SDK 分批回传掀翻分数），
 *    想当然且正是「白天分数还在变」的体感来源，已删除。Oura/WHOOP 敢醒来即定，
 *    是因为窗口一关、输入（时长/分期/HRV/静息心率）全部封闭；这里同理。
 *    · 定稿条件：`now ≥ 当天 wakeTime`（窗口已关）+ `deep > 0`（分期数据已到账，
 *      防锁到分批回传的半截数据）+ 夜间主睡眠窗（total ≥ 150min 且 wakeHour < 12，
 *      防白天小睡把当天定稿值覆盖掉）。三条同时满足才冻结；分期没到账就继续实时算，
 *      下次调用到齐即冻 —— 正常情况（会话一次性带回）醒来第一次调用就定稿。
 *    · 快照持久化在 `healthStore.analysis[dk].sleepRecovery`（按天、重启不丢）；
 *    · 历史日（周/月/年图表逐日调用）读同一快照，零漂移。
 */
export function computeSleepPersonalized(nowMs: number = Date.now()): SleepPersonalizedReport {
  const dk = hsDayKey(nowMs);
  // ① 已定稿 ⇒ 直接返回快照：当天后续同步再怎么补写睡眠明细，分数都不动
  const snap = healthStore.getAnalysis(dk)?.sleepRecovery;
  if (snap) {
    return {
      score: snap.score,
      mode: snap.mode,
      baselineDays: snap.baselineDays,
      daysToReady: snap.daysToReady,
      regularity: snap.regularity,
      sourceDayKey: snap.sourceDayKey,
      physiologyCoverage: snap.physiologyCoverage,
    };
  }

  const tonight = findTonightSleep(nowMs);
  if (!tonight) {
    return {
      score: null, mode: 'absolute', baselineDays: 0, daysToReady: MIN_RELATIVE_DAYS,
      regularity: { score: null, midSdMin: null, wakeSdMin: null, bedSdMin: null, days: 0 },
      sourceDayKey: null, physiologyCoverage: 0,
    };
  }

  // ── 收集历史（排除今晚那一觉，它不能进自己的基线）──
  const history: SleepBaselineInput[] = [];
  for (let d = 1; d <= SLEEP_BASELINE_DAYS; d++) {
    const dk = hsDayKey(nowMs - d * 86400000);
    const s = healthStore.getSleep(dk);
    if (!s || (s.total ?? 0) <= 0) continue;
    history.push(toInput(s, d));
  }

  const { centers, days, ready } = buildSleepDimensionCenters(history);

  // ★ 2026-10-07 诊断：把「睡眠恢复分到底怎么算出来的」全量打出来（临时，取证后删除）
  if (__DEV__) {
    const tw = (tonight.s.awake ?? 0) + (tonight.s.insomnia ?? 0);
    console.log(
      `[SLEEP-SCORE] dk=${tonight.dk} total=${tonight.s.total} deep=${tonight.s.deep} ` +
      `deepPct=${tonight.s.total ? (((tonight.s.deep ?? 0) / tonight.s.total) * 100).toFixed(1) : '—'} ` +
      `awake=${tw} getUp=${tonight.s.getUp ?? '—'} histDays=${days} ready=${ready} | ` +
      `centers=${JSON.stringify(centers)}`
    );
  }

  const awake = (tonight.s.awake ?? 0) + (tonight.s.insomnia ?? 0);
  const res: PersonalizedSleepResult = computePersonalizedSleepScore(
    {
      sleepTotal: tonight.s.total ?? null,
      sleepDeep: tonight.s.deep ?? null,
      sleepAwake: awake > 0 ? awake : null,
      getUp: tonight.s.getUp ?? null,
    },
    centers,
    days,
    ready,
  );

  // 规律性：历史 + 今晚一起算（今晚是「当前作息」的一部分）
  const reg = computeSleepRegularity([
    ...history,
    toInput(tonight.s, 0),
  ]);

  // 生理恢复修正：个人基线 z-score，参考公开的 HRV/RHR/呼吸率恢复模型。
  // 缺失信号不扣分；只在至少两个信号可用时参与，避免把“没有数据”当成低恢复。
  const metricDefs = [
    { key: 'hrv' as const, higher: true },
    { key: 'hr' as const, higher: false },
    { key: 'rr' as const, higher: false },
    { key: 'temp' as const, higher: false },
  ];
  const physScores: number[] = [];
  for (const m of metricDefs) {
    const values: number[] = [];
    for (let daysAgo = 0; daysAgo <= 30; daysAgo++) {
      const dk = hsDayKey(nowMs - daysAgo * 86400000);
      // ★ 2026-10-12：只看那一觉的睡眠时段生理，不取整日均值 ——
      //   今天早上醒来后，夜间读数不再增加 ⇒ 当天恢复分稳定，不再随白天累积而漂移。
      const sleep = daysAgo === 0 ? tonight.s : healthStore.getSleep(dk);
      const v = healthStore.getSleepWindowMetricMean(m.key, dk, sleep?.bedHour, sleep?.wakeHour);
      if (v != null) values.push(v);
    }
    if (values.length < 2) continue;
    const today = values[0];
    const hist = values.slice(1);
    const mean = hist.reduce((a, v) => a + v, 0) / hist.length;
    const variance = hist.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, hist.length - 1);
    const sd = Math.max(Math.sqrt(variance), m.key === 'hrv' ? 3 : m.key === 'rr' ? 0.5 : 1);
    const z = (today - mean) / sd * (m.higher ? 1 : -1);
    // 每 1 SD 约 16.6 分，限制单项影响，避免异常读数主导总分。
    physScores.push(Math.max(0, Math.min(100, 50 + z * 16.6)));
  }
  const physiologyCoverage = physScores.length / metricDefs.length;
  let score = physScores.length >= 2
    ? Math.round(res.score * 0.70 + (physScores.reduce((a, v) => a + v, 0) / physScores.length) * 0.30)
    : res.score;
  // 保护规则：睡够且效率良好时，单一深睡估算误差不能把恢复分压到红色区间。
  // 这是“核心睡眠达标下限”，不是把分数硬抬到满分。
  const coreTotalOk = (tonight.s.total ?? 0) >= 420;
  const coreAwake = (tonight.s.awake ?? 0) + (tonight.s.insomnia ?? 0);
  const coreEffOk = coreAwake <= 0 || coreAwake / Math.max(1, tonight.s.total ?? 1) <= 0.15;
  if (coreTotalOk && coreEffOk) score = Math.max(score, 60);

  // ── 定稿：这一觉的窗口已关闭（now ≥ 当天 wakeTime）⇒ 冻结当天 report ──
  const report: SleepPersonalizedReport = {
    score,
    mode: res.mode,
    baselineDays: res.baselineDays,
    daysToReady: res.daysToReady,
    regularity: reg,
    sourceDayKey: tonight.dk,
    physiologyCoverage,
  };
  const wakeHour = tonight.s.wakeHour;
  if (wakeHour != null && Number.isFinite(wakeHour)) {
    const wakeAbs = parseDayKey(dk) + wakeHour * 3_600_000;
    // 夜间主睡眠窗才定稿：时长 ≥ 2.5h 且中午前醒 —— 白天小睡不覆盖当天定稿值
    const isNightWindow = (tonight.s.total ?? 0) >= 150 && wakeHour < 12;
    // 分期数据已到账才定稿：防 SDK 分批回传时锁到「有时长没分期」的半截数据
    const stagesSynced = (tonight.s.deep ?? 0) > 0;
    if (isNightWindow && stagesSynced && nowMs >= wakeAbs) {
      healthStore.saveAnalysis(dk, 'sleepRecovery', { ...report, frozenAt: Date.now() });
    }
  }
  return report;
}

/**
 * ★ v18.156：睡眠恢复的**档位词唯一实现**。
 *
 * 为什么必须收成一处（真机实锤）：同一个数在首页会同时出现在 chip 和「睡眠节律」卡 badge 上，
 * 而两处各自写了一套阈值 —— chip 用 58/42、卡 badge 用 62/45，措辞也不同
 * （「高于平时」vs「恢复较好」）⇒ 用户同屏看到「61 · 高于平时」和「61/100 · 恢复较好」，
 * 既像两个指标，又把 61 读成「刚过及格线」（相对口径的锚点是 50，不是 60）。
 *
 * ⚠ 相对口径下**不要挂 `/100`**：50 = 和你平时一样，挂百分制必然被读成绝对分。
 */
export function sleepRecoveryTag(
  score: number | null | undefined,
  mode: 'relative' | 'absolute',
): string | undefined {
  if (score == null || !Number.isFinite(score)) return undefined;
  if (mode === 'relative') {
    return score >= 82 ? '高于平时' : score >= 68 ? '与平时持平' : '低于平时';
  }
  return score >= 80 ? '恢复良好' : score >= 60 ? '恢复中' : '恢复偏弱';
}

/** 单日「睡眠恢复分」唯一入口（个人相对口径；基线不足自动退回绝对口径）。
 *  供详情页 hero / 周月年图表统一调用 —— 保证「睡眠恢复」在全 App 只有一把尺。 */
export function sleepRecoveryScoreForDay(dayMs: number): number | null {
  try {
    const r = computeSleepPersonalized(dayMs);
    return r.score != null && Number.isFinite(r.score) && r.score > 0 ? r.score : null;
  } catch {
    return null;
  }
}

export { MIN_RELATIVE_DAYS, SLEEP_BASELINE_DAYS };
