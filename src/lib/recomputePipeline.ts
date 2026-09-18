/**
 * RecomputePipeline —— 原始数据进来后，统一重算所有派生指标
 *
 * 设计原则：
 *  1. 原始数据（onRealtime / onBatch backfill）写入 healthStore 后触发
 *  2. 管道幂等：同一天同一天跑多次结果一样（用 JSON.stringify 判断变化才写）
 *  3. 去抖：500ms 内同一 dayKey 多次触发合并成一次（backfill 30 天 = 30 次 onBatch → 30 次重算）
 *  4. 轻量：管道只算**输入已齐**的指标（没睡眠数据就不算 sleepScore，没皮质醇就算不出 cortisolRhythm）
 *
 * 触发时机：
 *   - handleRealtime 写入后 → schedule(dk=today)
 *   - handleBatch backfill 每日写入后 → schedule(dk=当天)
 *   - handleStateV2 backfillDone → flushAll() 把积压的全跑完
 *
 * 输出：healthStore.analysis[dk] = { stress?, cognitive?, cortisol?, emotion?, hormone?, sleepLoad?, hrvStats? }
 */

import { healthStore, dayKey as dkFn, type MetricKey } from '../data/healthStore';
import { postLog } from '../lib/logger';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { analyzeCortisol, type CortisolSample } from '../lib/cortisolRhythm';
import { computeSleepLoad, type SleepLoadDay } from '../lib/sleepLoad';
import { collectDailyPhysio, inferHormones, type CycleLogRef } from '../lib/hormoneInference';

const DEBOUNCE_MS = 500;
const MAX_DAYS = 60;

/** 需要重算的 dayKey → 合并去抖定时器 */
const pendingDays = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRecompute(dayKey?: string) {
  const d = dayKey ?? dkFn(Date.now());
  pendingDays.add(d);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const days = Array.from(pendingDays);
    pendingDays.clear();
    for (const day of days) {
      runForDay(day);
    }
  }, DEBOUNCE_MS);
}

/** backfill 大量日时，批量触发（不单独去抖，让 schedule 自动合并） */
export function scheduleRecomputeMany(dayKeys: string[]) {
  for (const d of dayKeys) scheduleRecompute(d);
}

/** 立即清空所有待处理并跑完（backfillDone 后调用） */
export function flushAll() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const days = Array.from(pendingDays);
  pendingDays.clear();
  for (const day of days) runForDay(day);
}

/** 单天重算所有派生指标 */
function runForDay(day: string) {
  try {
    postLog('RECOMPUTE', ` 📊 day=${day} 开始重算派生指标`);
    const t0 = Date.now();

    // ── 1. Stress Report ──────────────────────────────────────
    // 输入：HR/EDA/SNS/Emotion/Skin/Fatigue 的逐样本
    // StressReport 是「到当前时刻」的状态，历史日锚定到当日 23:59:59
    const dayStartMs = new Date(day + 'T00:00:00').getTime();
    const isToday = day === dkFn(Date.now());
    const reportNowMs = isToday ? Date.now() : dayStartMs + 86400000 - 1;
    try {
      const stress = computeStressReport(reportNowMs);
      healthStore.saveAnalysis(day, 'stress', {
        score: stress.score,
        peakHour: stress.peakHour,
        emotionalLoad: stress.emotionalLoad,
        avgRecoverySec: stress.avgRecoverySec,
        eventCount: stress.events.length,
      });
    } catch (e: any) {
      postLog('RECOMPUTE-WARN', `⚠️ stress failed day=${day}:`, e?.message);
    }

    // ── 2. Cognitive Load ─────────────────────────────────────
    try {
      const cog = computeCognitiveLoadReport(reportNowMs);
      healthStore.saveAnalysis(day, 'cognitive', {
        loadScore: cog.loadScore,
        fatigueIndex: cog.fatigueIndex,
        peakHour: cog.peakLoadSpan?.startHour ?? null,
        bestHour: cog.bestSpan?.startHour ?? null,
        recoveryCapacity: cog.recoveryCapacity,
      });
    } catch (e: any) {
      postLog('RECOMPUTE-WARN', `⚠️ cognitive failed day=${day}:`, e?.message);
    }

    // ── 3. Cortisol Rhythm ────────────────────────────────────
    // 输入：healthStore.getIntraday('cortisol', day)
    const cortisolSamples: CortisolSample[] = healthStore.getIntraday('cortisol', day)
      .filter(p => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
      .map(p => ({ t: p.t, v: p.v }));
    if (cortisolSamples.length >= 4) {
      try {
        const r = analyzeCortisol(cortisolSamples, isToday ? 14 : 1);
        const cos = r.cosinor;
        if (Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && cos.amplitude > 0) {
          healthStore.saveAnalysis(day, 'cortisol', {
            mesor: +cos.mesor.toFixed(1),
            amplitude: +cos.amplitude.toFixed(1),
            acrophaseH: +cos.acrophaseH.toFixed(1),
            css: Number.isFinite(r.css) ? +r.css.toFixed(1) : NaN,
            status: r.todayLevel,
            sustainedHighStreak: r.highStreak,
          });
          postLog('RECOMPUTE', ` ✅ cortisol dk=${day} mesor=${cos.mesor.toFixed(1)} acro=${cos.acrophaseH.toFixed(1)}h css=${r.css.toFixed(1)}`);
        } else {
          postLog('RECOMPUTE', ` cortisol dk=${day} cosinor not converged (mesor=${cos.mesor.toFixed(1)} amp=${cos.amplitude.toFixed(1)})`);
        }
      } catch (e: any) {
        postLog('RECOMPUTE-WARN', `⚠️ cortisol failed day=${day}:`, e?.message);
      }
    } else {
      postLog('RECOMPUTE', ` cortisol dk=${day} samples=${cortisolSamples.length} < 4, skip`);
    }

    // ── 4. Hormone Inference（仅今日 + 近 N 天有足够数据）──────
    if (isToday) {
      try {
        const physio = collectDailyPhysio(MAX_DAYS);
        const cycleRef: CycleLogRef = {
          lastPeriodStart: '', cycleLength: 28, lutealLength: 14,
          periodLength: 5, dayInCycle: null, phase: 'unknown', ovulationDate: null,
        };
        const inference = inferHormones(physio, cycleRef);
        healthStore.saveAnalysis(day, 'hormone', {
          estrogen: inference.estradiol.status,
          progesterone: inference.progesterone.status,
          regularity: inference.regularity.irregularity,
        });
      } catch (e: any) {
        postLog('RECOMPUTE-WARN', `⚠️ hormone failed:`, e?.message);
      }
    }

    const dt = Date.now() - t0;
    postLog('RECOMPUTE', ` ✅ day=${day} done in ${dt}ms`);
  } catch (e: any) {
    postLog('RECOMPUTE-ERR', `❌ ❌ day=${day} failed:`, e?.message, e?.stack);
  }
}
