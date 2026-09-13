/**
 * HormoneDualTrend —— 雌激素 + 孕激素「合在一起」的双相趋势图（近 30 天）。
 *
 * 复用 lib/hormoneTrend 的 buildEstrogenData / buildProgesteroneData（真实数据推算）：
 *   · 雌激素（绿，PHASE_COLOR.ovulation）：戒指实测 HRV·EDA 推算
 *   · 孕激素（紫，theme.colors.accentSolid）：戒指实测体温·静息心率推算
 * 两条曲线叠画在同一时间轴上，背景按真实日期着色四相色带；图例区分两条线；
 * 底部一句诚实说明（戒指不直接测量激素，均为推算）。
 *
 * 说明口径（与周期日历页激素卡一致）：信号基座来自成熟方法/已发表研究；组合权重与
 * 0–100 归一化是自研启发式。本组件不重复写算法，只负责「把两条真实推算曲线画一起」。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Circle } from 'react-native-svg';
import { theme } from '../theme/theme';
import { parseDate, type CycleInfo, type CycleLog } from '../lib/cycleMath';
import { phaseBand, PHASE_COLOR } from '../lib/phaseColors';
import { buildEstrogenData, buildProgesteroneData, phaseOfDay, type TrendRange } from '../lib/hormoneTrend';
import type { RingState } from '../ble/RingBleManager';

const EST_COLOR = PHASE_COLOR.ovulation; // 绿 #6FCFB4
const PROG_COLOR = theme.colors.accentSolid; // 紫 #7C6AE0
const RANGE: TrendRange = 'month';

type Pt = { x: number; y: number; date: string };

function makePath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

export default function HormoneDualTrend({
  ring,
  cycleInfo,
  log,
}: {
  ring: RingState;
  cycleInfo: CycleInfo | null;
  log: CycleLog | null;
}) {
  const estData = useMemo(() => buildEstrogenData(ring, RANGE), [ring]);
  const progData = useMemo(() => buildProgesteroneData(ring, cycleInfo, RANGE), [ring, cycleInfo]);
  const est = estData.real;
  const prog = progData.real;

  const W = 680;
  const H = 150;
  const PAD = 10;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const yAt = (v: number) => PAD + (1 - v / 100) * plotH;

  // 时间轴：固定为近 30 天窗口 [今天-29, 今天]，按真实日期定位
  const winDays = 30;
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const winEndMs = today0.getTime();
  const winStartMs = winEndMs - (winDays - 1) * 86_400_000;
  const xAtMs = (ms: number) => {
    const t = (ms - winStartMs) / (winEndMs - winStartMs || 1);
    return PAD + Math.max(0, Math.min(1, t)) * plotW;
  };

  // 合并两条序列的日期，用于四相背景色带
  const allDates = useMemo(() => {
    const s = new Set<number>();
    (est ?? []).forEach((p) => s.add(parseDate(p.date).getTime()));
    (prog ?? []).forEach((p) => s.add(parseDate(p.date).getTime()));
    return Array.from(s).sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [est, prog]);

  const estPts: Pt[] = useMemo(
    () => (est ?? []).map((p) => ({ x: xAtMs(parseDate(p.date).getTime()), y: yAt(p.value), date: p.date })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [est, winStartMs, winEndMs],
  );
  const progPts: Pt[] = useMemo(
    () => (prog ?? []).map((p) => ({ x: xAtMs(parseDate(p.date).getTime()), y: yAt(p.value), date: p.date })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prog, winStartMs, winEndMs],
  );

  const estPath = makePath(estPts);
  const progPath = makePath(progPts);

  // 四相背景带：窗口首尾 + 各数据日，按中点相位着色
  const bands = (() => {
    const edges = [winStartMs, ...allDates, winEndMs];
    const out: { x: number; w: number; color: string }[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      const x0 = xAtMs(a);
      const x1 = xAtMs(b);
      const centerMs = (a + b) / 2;
      const phase = log ? phaseOfDay(log, new Date(centerMs), ring) : 'unknown';
      out.push({ x: x0, w: Math.max(0, x1 - x0), color: phaseBand(phase) });
    }
    return out;
  })();

  const fmtMs = (ms: number) => {
    const dt = new Date(ms);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const winMidMs = winStartMs + ((winDays - 1) * 86_400_000) / 2;

  const hasAny = (est && est.length > 0) || (prog && prog.length > 0);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>雌激素 · 孕激素 双相趋势</Text>
        <Text style={styles.sub}>近 30 天 · 真实数据推算</Text>
      </View>

      {/* 双线图例 */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: EST_COLOR }]} />
          <Text style={styles.legendText}>雌激素（HRV·EDA）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: PROG_COLOR }]} />
          <Text style={styles.legendText}>孕激素（体温·心率）</Text>
        </View>
      </View>

      {!hasAny ? (
        <Text style={styles.note}>
          连续佩戴获取 HRV、EDA、体温与静息心率后，这里会显示雌激素与孕激素叠加的双相趋势：卵泡期雌激素爬升、排卵后孕激素抬升。戒指不直接测量激素，均为推算。
        </Text>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="dualEstGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={EST_COLOR} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={EST_COLOR} stopOpacity={0.02} />
              </LinearGradient>
              <LinearGradient id="dualProgGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={PROG_COLOR} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={PROG_COLOR} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {bands.map((b, i) => (
              <Rect key={`b${i}`} x={b.x} y={PAD} width={b.w} height={plotH} fill={b.color} />
            ))}
            {estPath ? <Path d={`${estPath} L ${estPts[estPts.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${estPts[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`} fill="url(#dualEstGrad)" /> : null}
            {progPath ? <Path d={`${progPath} L ${progPts[progPts.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${progPts[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`} fill="url(#dualProgGrad)" /> : null}
            {progPath ? <Path d={progPath} fill="none" stroke={PROG_COLOR} strokeWidth={2.4} strokeLinecap="round" /> : null}
            {estPath ? <Path d={estPath} fill="none" stroke={EST_COLOR} strokeWidth={2.4} strokeLinecap="round" /> : null}
            {progPts.map((p, i) => (
              <Circle key={`p${i}`} cx={p.x} cy={p.y} r={2.6} fill={PROG_COLOR} />
            ))}
            {estPts.map((p, i) => (
              <Circle key={`e${i}`} cx={p.x} cy={p.y} r={2.6} fill={EST_COLOR} />
            ))}
          </Svg>
          <View style={styles.axis}>
            <Text style={styles.axisText}>{fmtMs(winStartMs)}</Text>
            <Text style={styles.axisText}>{fmtMs(winMidMs)}</Text>
            <Text style={styles.axisText}>{fmtMs(winEndMs)}</Text>
          </View>
          <Text style={styles.note}>
            两条曲线均为真实数据推算（雌激素来自 HRV·EDA，孕激素来自体温·静息心率），戒指不直接测量激素。叠看可观察卵泡期雌激素爬升、排卵后孕激素抬升的双相节律。
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.md,
  },
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
  legend: {
    flexDirection: 'row',
    marginTop: theme.space.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: theme.space.md,
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
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
  },
});
