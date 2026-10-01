/**
 * SleepHormoneCorrelation —— 睡眠 × 周期阶段 × 皮质醇 关联性卡（睡眠详情页底部）
 *
 * 设计口径（与全仓一致，诚实优先）：
 *  - 雌激素 / 孕激素均来自「戒指实测信号 → 趋势」推算（HRV·EDA / 体温·心率），非直接测量；
 *  - 皮质醇为戒指固件用「交感 + 昼夜模板」合成的**压力代理值**，非化验级读数；
 *  - 此处只展示「你自身近 30 天数据」里的观察关联（阶段背景 + 皮质醇高低 vs 睡眠评分），
 *    不作因果 / 诊断结论。对应 Mira 设计哲学：周期背景 + 身体 × 情绪 → 解释日常波动。
 *
 * 数据同源：phaseOfDay(周期推算) / collectSamplesForRange+analyzeCortisol(皮质醇) / healthStore.getSleep(睡眠)。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { type RingState } from '../ble/RingBleManager';
import { type CycleLog } from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { dayKey, healthStore } from '../data/healthStore';
import { phaseOfDay } from '../lib/hormoneTrend';
import { PHASE_ORDER, PHASE_LABEL, PHASE_COLOR, phaseBand, type PhaseKey } from '../lib/phaseColors';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamplesForRange } from './CortisolRhythmCard';

const DAYS = 30;
const SLEEP_LINE = mm.colors.ink; // 睡眠评分线（深色，0–100）
const CORT_COLOR = theme.colors.accent2; // 皮质醇面积（蓝）

type Cell = { key: string; ms: number; phase: PhaseKey; sleep: number | null; cort: number | null };

export default function SleepHormoneCorrelation({ ring }: { ring: RingState }) {
  const [log, setLog] = useState<CycleLog | null>(null);
  useEffect(() => {
    let alive = true;
    loadCycleLog()
      .then((l) => {
        if (alive) setLog(l);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const data = useMemo<{ cells: Cell[]; hasLog: boolean; enough: boolean }>(() => {
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const startMs = today0.getTime() - (DAYS - 1) * 86400000;

    // 皮质醇：近 30 天逐样本 → 每日 mesor
    const samples = collectSamplesForRange(startMs, today0.getTime() + 86400000 - 1);
    const cort = analyzeCortisol(samples, DAYS);
    const cortByDate = new Map<string, number>();
    (cort.dailyMesors ?? []).forEach((d) => {
      if (Number.isFinite(d.mesor)) cortByDate.set(d.date, d.mesor);
    });

    const cells: Cell[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(today0.getDate() - i);
      const k = dayKey(d.getTime());
      const sl = healthStore.getSleep(k);
      const sleep = sl && typeof sl.score === 'number' && sl.total > 0 ? sl.score : null;
      const phase = (log ? phaseOfDay(log, d, ring) : 'unknown') as PhaseKey;
      cells.push({ key: k, ms: d.getTime(), phase, sleep, cort: cortByDate.has(k) ? cortByDate.get(k)! : null });
    }
    const hasLog = !!log && log.lastPeriodStart != null;
    const enough = cells.filter((c) => c.sleep != null).length >= 7;
    return { cells, hasLog, enough };
  }, [ring, log]);

  // 归一化皮质醇（窗口内 min~max → 0~100）用于绘图
  const cRange = useMemo(() => {
    const vs = data.cells.map((c) => c.cort).filter((v): v is number => v != null);
    if (vs.length < 2) return { lo: 0, span: 1 };
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return { lo, span: hi - lo || 1 };
  }, [data]);

  // 分阶段聚合
  const phaseAgg = useMemo(() => {
    const buckets: Record<string, { sleep: number[]; cort: number[] }> = {};
    PHASE_ORDER.forEach((p) => (buckets[p] = { sleep: [], cort: [] }));
    const allSleep: number[] = [];
    const allCort: number[] = [];
    data.cells.forEach((c) => {
      if (c.sleep != null) allSleep.push(c.sleep);
      if (c.cort != null) allCort.push(c.cort);
      const b = buckets[c.phase];
      if (!b) return; // 'unknown'（未记录经期 / log 未加载）不进分阶段聚合，避免 undefined 崩溃
      if (c.sleep != null) b.sleep.push(c.sleep);
      if (c.cort != null) b.cort.push(c.cort);
    });
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const overallSleep = mean(allSleep);
    const overallCort = mean(allCort);
    const rows = PHASE_ORDER.map((p) => {
      const sleep = mean(buckets[p].sleep);
      const cort = mean(buckets[p].cort);
      if (sleep == null || buckets[p].sleep.length === 0) return null;
      return {
        phase: p,
        sleep,
        cortPct: cort != null && overallCort ? ((cort - overallCort) / overallCort) * 100 : null,
        n: buckets[p].sleep.length,
        dSleep: overallSleep != null ? sleep - overallSleep : null,
      };
    }).filter((x): x is NonNullable<typeof x> => x != null);
    return { rows, overallSleep };
  }, [data]);

  // 睡眠评分 ↔ 皮质醇 的皮尔逊相关（仅当两者都有 ≥10 天）
  const corr = useMemo(() => {
    const pairs = data.cells.filter((c) => c.sleep != null && c.cort != null) as { sleep: number; cort: number }[];
    if (pairs.length < 10) return null;
    const n = pairs.length;
    const ms = pairs.reduce((s, p) => s + p.sleep, 0) / n;
    const mc = pairs.reduce((s, p) => s + p.cort, 0) / n;
    let sxy = 0,
      sxx = 0,
      syy = 0;
    for (const p of pairs) {
      const a = p.sleep - ms;
      const b = p.cort - mc;
      sxy += a * b;
      sxx += a * a;
      syy += b * b;
    }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }, [data]);

  // 高亮：偏离整体最大的阶段（≥2 天样本，避免单点误判）
  const highlight = useMemo(() => {
    const cand = phaseAgg.rows.filter((r) => r.n >= 2 && r.dSleep != null);
    if (!cand.length) return null;
    cand.sort((a, b) => Math.abs(b.dSleep!) - Math.abs(a.dSleep!));
    return cand[0];
  }, [phaseAgg]);

  // ── 图表几何 ──
  const W = 680;
  const H = 180;
  const PAD = 12;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const step = plotW / (DAYS - 1);
  const xAt = (i: number) => PAD + i * step;
  const ySleep = (v: number) => PAD + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;
  const yCort = (v: number) => PAD + (1 - Math.max(0, Math.min(100, ((v - cRange.lo) / cRange.span) * 100))) * plotH;

  const sleepPath = (() => {
    let p = '';
    let started = false;
    data.cells.forEach((c, i) => {
      if (c.sleep == null) {
        started = false;
        return;
      }
      const x = xAt(i);
      const y = ySleep(c.sleep);
      p += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      started = true;
    });
    return p;
  })();

  const cortAreas = (() => {
    const segs: { x: number; y: number }[][] = [];
    let seg: { x: number; y: number }[] = [];
    data.cells.forEach((c, i) => {
      if (c.cort == null) {
        if (seg.length) segs.push(seg);
        seg = [];
        return;
      }
      seg.push({ x: xAt(i), y: yCort(c.cort) });
    });
    if (seg.length) segs.push(seg);
    return segs
      .filter((s) => s.length > 1)
      .map((s) => {
        let d = `M ${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`;
        for (let i = 1; i < s.length; i++) d += ` L ${s[i].x.toFixed(1)} ${s[i].y.toFixed(1)}`;
        d += ` L ${s[s.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${s[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`;
        return d;
      });
  })();

  const fmtMs = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const startMs = today0.getTime() - (DAYS - 1) * 86400000;
  const midMs = startMs + (DAYS - 1) * 86400000 / 2;

  const sleepN = data.cells.filter((c) => c.sleep != null).length;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>睡眠 · 激素节律 关联</Text>
        <Text style={styles.sub}>近 30 天 · 你自身数据的观察关联</Text>
      </View>

      {!data.enough ? (
        <Text style={styles.note}>
          继续佩戴，积累更多天的睡眠与皮质醇数据后，这里会显示睡眠评分与激素节律的关联（按周期阶段对比）。
          {!data.hasLog ? '记录经期后可进一步按卵泡期 / 排卵期 / 黄体期 / 经期分别看睡眠差异。' : ''}
        </Text>
      ) : (
        <>
          {/* 图例 */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: SLEEP_LINE }]} />
              <Text style={styles.legendText}>睡眠评分</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendArea, { backgroundColor: CORT_COLOR }]} />
              <Text style={styles.legendText}>皮质醇（相对高低）</Text>
            </View>
            {PHASE_ORDER.map((p) => (
              <View key={p} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: PHASE_COLOR[p] }]} />
                <Text style={styles.legendText}>{PHASE_LABEL[p]}</Text>
              </View>
            ))}
          </View>

          {/* 叠加图：阶段背景带 + 皮质醇面积 + 睡眠评分线 */}
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="cortGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={CORT_COLOR} stopOpacity={0.26} />
                <Stop offset="100%" stopColor={CORT_COLOR} stopOpacity={0.04} />
              </LinearGradient>
            </Defs>
            {/* 阶段背景带 */}
            {data.cells.map((c, i) => (
              <Rect
                key={`b${i}`}
                x={i === 0 ? PAD : xAt(i) - step / 2}
                y={PAD}
                width={i === 0 || i === DAYS - 1 ? step / 2 : step}
                height={plotH}
                fill={phaseBand(c.phase)}
              />
            ))}
            {/* 皮质醇面积 */}
            {cortAreas.map((d, i) => (
              <Path key={`c${i}`} d={d} fill="url(#cortGrad)" />
            ))}
            {/* 睡眠评分线 */}
            {sleepPath ? <Path d={sleepPath} fill="none" stroke={SLEEP_LINE} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
          </Svg>
          <View style={styles.axis}>
            <Text style={styles.axisText}>{fmtMs(startMs)}</Text>
            <Text style={styles.axisText}>{fmtMs(midMs)}</Text>
            <Text style={styles.axisText}>{fmtMs(today0.getTime())}</Text>
          </View>

          {/* 关联洞察（皮质醇 ↔ 睡眠评分） */}
          {corr != null ? (
            <Text style={styles.insight}>
              你近 30 天里，皮质醇偏高时睡眠评分趋向{corr < 0 ? '偏低' : '偏高'}（二者{corr < 0 ? '负' : '正'}向关联，r≈{corr.toFixed(2)}）——属于身体节律的自我观察。
            </Text>
          ) : null}

          {/* 分阶段对比 */}
          <Text style={styles.sub2}>按周期阶段对比（睡眠评分均值 · 皮质醇相对整体）</Text>
          {phaseAgg.rows.map((r) => (
            <View key={r.phase} style={styles.cmpRow}>
              <View style={[styles.phaseDot, { backgroundColor: PHASE_COLOR[r.phase] }]} />
              <Text style={styles.cmpPhase}>{PHASE_LABEL[r.phase]}</Text>
              <View style={styles.cmpScores}>
                <Text style={styles.cmpSleep}>
                  {Math.round(r.sleep)}
                  <Text style={styles.cmpUnit}> 分</Text>
                  {r.dSleep != null ? (
                    <Text style={[styles.cmpDelta, { color: r.dSleep < 0 ? theme.colors.trendDown : theme.colors.trendUp }]}>
                      {'  '}
                      {r.dSleep < 0 ? '▼' : '▲'}
                      {Math.abs(Math.round(r.dSleep))}
                    </Text>
                  ) : null}
                </Text>
                <Text style={styles.cmpCort}>
                  皮质醇{' '}
                  {r.cortPct != null ? (
                    <Text style={{ color: r.cortPct > 0 ? theme.colors.trendUp : theme.colors.trendDown }}>
                      {r.cortPct > 0 ? '高' : '低'}
                      {Math.abs(Math.round(r.cortPct))}%
                    </Text>
                  ) : (
                    <Text style={styles.cmpMuted}>—</Text>
                  )}
                </Text>
              </View>
            </View>
          ))}

          {/* 高亮阶段 */}
          {highlight ? (
            <Text style={styles.highlight}>
              {PHASE_LABEL[highlight.phase]}：睡眠评分平均比整体{highlight.dSleep! < 0 ? '低' : '高'}{' '}
              {Math.abs(Math.round(highlight.dSleep!))} 分
              {highlight.cortPct != null
                ? `，同期皮质醇平均${highlight.cortPct > 0 ? '偏高' : '偏低'}${Math.abs(Math.round(highlight.cortPct))}%`
                : ''}
              。经期前与黄体后期身体恢复本就偏慢、更易睡不深，属常见节律波动。
            </Text>
          ) : null}

          <Text style={styles.note}>
            雌激素与孕激素均为戒指实测信号推算（非直接测量），皮质醇为压力代理值（非化验级读数）。本卡仅展示你自身数据中的观察关联，帮助理解睡眠波动的背景，不构成诊断。
          </Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  sub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  sub2: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
    marginBottom: theme.space.xs,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.space.xs,
    rowGap: theme.space.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: theme.space.md,
  },
  legendLine: {
    width: theme.sp(4),
    height: theme.sp(0.6),
    borderRadius: theme.sp(0.3),
    marginRight: theme.sp(1.5),
  },
  legendArea: {
    width: theme.sp(4),
    height: theme.sp(2.4),
    borderRadius: theme.sp(1),
    marginRight: theme.sp(1.5),
    opacity: 0.3,
  },
  legendDot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.sp(1.25),
    marginRight: theme.sp(1.5),
  },
  legendText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.space.xs,
  },
  axisText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  insight: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.textTitle,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    marginTop: theme.space.sm,
  },
  cmpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.xs,
  },
  phaseDot: {
    width: theme.sp(3),
    height: theme.sp(3),
    borderRadius: theme.sp(1.5),
    marginRight: theme.space.sm,
  },
  cmpPhase: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTitle,
    width: 56,
  },
  cmpScores: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  cmpSleep: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  cmpUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    fontWeight: theme.weight.regular as any,
  },
  cmpDelta: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as any,
  },
  cmpCort: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  cmpMuted: {
    color: theme.colors.textSub,
  },
  highlight: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.textTitle,
    marginTop: theme.space.sm,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.sm,
  },
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});
