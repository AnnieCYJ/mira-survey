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

import { healthStore, dayKey as hsDayKey, type SleepSummary } from '../data/healthStore';
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
function findTonightSleep(nowMs: number): { s: SleepSummary; dk: string } | null {
  const today = healthStore.getSleep(hsDayKey(nowMs));
  if (today && (today.total ?? 0) > 0) return { s: today, dk: hsDayKey(nowMs) };
  const yKey = hsDayKey(nowMs - 86400000);
  const y = healthStore.getSleep(yKey);
  if (y && (y.total ?? 0) > 0) {
    // 起床小时 < 12 ⇒ 是今早起来的，算今晚这一觉
    const wh = y.wakeHour;
    if (wh != null && wh >= 0 && wh < 12) return { s: y, dk: yKey };
  }
  return null;
}

/**
 * 主入口：算「今晚的睡眠恢复分 + 规律性」。
 * @param nowMs 当前时间（默认 Date.now）
 */
export function computeSleepPersonalized(nowMs: number = Date.now()): SleepPersonalizedReport {
  const tonight = findTonightSleep(nowMs);
  if (!tonight) {
    return {
      score: null, mode: 'absolute', baselineDays: 0, daysToReady: MIN_RELATIVE_DAYS,
      regularity: { score: null, midSdMin: null, wakeSdMin: null, bedSdMin: null, days: 0 },
      sourceDayKey: null,
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

  return {
    score: res.score,
    mode: res.mode,
    baselineDays: res.baselineDays,
    daysToReady: res.daysToReady,
    regularity: reg,
    sourceDayKey: tonight.dk,
  };
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
    return score >= 58 ? '高于平时' : score >= 42 ? '与平时持平' : '低于平时';
  }
  return score >= 80 ? '恢复良好' : score >= 60 ? '恢复中' : '恢复偏弱';
}

export { MIN_RELATIVE_DAYS, SLEEP_BASELINE_DAYS };
