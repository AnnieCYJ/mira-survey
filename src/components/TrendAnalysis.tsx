/**
 * TrendAnalysis —— 雌激素 / 孕激素波动趋势卡下方的 AI 解读
 *
 * 与「体温双相监测」下方解读同一视觉语言（AiAnalysis 外壳）。
 * 结论全部由趋势卡同一份真实数据算出（不是静态文案）：
 *   · 雌激素：戒指实测 HRV + EDA 归一化加权后的 0–100 相对指数；
 *   · 孕激素：戒指实测体温（BBT 双相）+ 静息心率归一化加权后的相对指数。
 * 配合已推算的周期相位（cycleInfo）判断「当前相位水平 / 峰值位置 / 与体温双相互相印证」。
 *
 * 戒指不直接测量激素，结果为推算趋势，不构成医学诊断。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import AiAnalysis, { AiResultRow, type AiTone } from './AiAnalysis';
import { parseDate, type CycleInfo } from '../lib/cycleMath';

type TrendPoint = { date: string; value: number };

interface Props {
  kind: 'estrogen' | 'progesterone';
  data: { real: TrendPoint[] | null };
  cycleInfo: CycleInfo | null;
  /** 窗口跨度（天），用于文案 */
  windowDays: number;
}

const md = (s: string): string => {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const meanOf = (a: TrendPoint[]): number | null =>
  a.length ? a.reduce((s, p) => s + p.value, 0) / a.length : null;
const r0 = (v: number): number => Math.round(v);

export default function TrendAnalysis({ kind, data, cycleInfo, windowDays }: Props) {
  const pts = data.real ?? [];
  // 数据太少（趋势卡本身会显示引导文案）时不重复给结论
  if (pts.length < 3) return null;

  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  const last = pts[pts.length - 1];
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a), pts[0]);
  const level = span > 1 ? (last.value - min) / span : 0.5;
  const levelLabel = level >= 0.66 ? '高位' : level >= 0.34 ? '中位' : '低位';

  const phase = cycleInfo?.phase ?? 'unknown';
  const ovDate = cycleInfo?.ovulationDate ?? null;
  const tempConfirmed = !!cycleInfo?.tempConfirmed;
  const ovMs = ovDate ? parseDate(ovDate).getTime() : null;

  const before = ovMs != null ? pts.filter((p) => parseDate(p.date).getTime() < ovMs) : [];
  const after = ovMs != null ? pts.filter((p) => parseDate(p.date).getTime() >= ovMs) : [];
  const beforeMean = meanOf(before);
  const afterMean = meanOf(after);

  const half = Math.floor(pts.length / 2);
  const firstHalf = meanOf(pts.slice(0, half));
  const secondHalf = meanOf(pts.slice(half));
  const delta = firstHalf != null && secondHalf != null ? secondHalf - firstHalf : null;
  const dir = delta == null ? '平稳' : delta > 8 ? '上升' : delta < -8 ? '下降' : '平稳';

  /** 汇总 chip（与体温卡解读同款） */
  const chip = (
    <View style={styles.metricRow}>
      <View style={styles.metricChip}>
        <Text style={styles.metricValue}>{last.value}</Text>
        <Text style={styles.metricUnit}>· 当前指数</Text>
      </View>
      <Text style={styles.metricDetail}>
        峰值 {md(peak.date)}（{peak.value}） · 近 {windowDays} 天区间 {r0(min)}–{r0(max)}
      </Text>
    </View>
  );

  if (kind === 'estrogen') {
    // ── 1. 当前相位水平是否与周期相位一致 ──
    const expectHigh = phase === 'follicular' || phase === 'ovulation';
    const knownPhase = phase !== 'unknown';
    const consistent = expectHigh ? level >= 0.34 : level < 0.66;
    const row1Tone: AiTone = !knownPhase ? 'neutral' : consistent ? 'good' : 'warn';
    const phaseExpect =
      phase === 'follicular'
        ? '卵泡期雌激素上行，通常偏高'
        : phase === 'ovulation'
          ? '排卵期雌激素达峰，通常偏高'
          : phase === 'luteal'
            ? '黄体期雌激素回落，通常偏低'
            : phase === 'period'
              ? '经期雌激素处于低谷，通常偏低'
              : '尚未记录经期，无法对照相位';

    // ── 2. 本窗口峰值位置 vs 推算排卵期 ──
    const peakMs = parseDate(peak.date).getTime();
    let peakTone: AiTone = 'neutral';
    let peakText: React.ReactNode;
    if (ovMs == null) {
      peakText = <>峰值出现于 {md(peak.date)}（指数 {peak.value}）。记录经期后可与推算排卵期比对。</>;
    } else {
      const diff = Math.round((peakMs - ovMs) / 86_400_000);
      if (Math.abs(diff) <= 2) {
        peakTone = 'good';
        peakText = (
          <>
            峰值出现于 {md(peak.date)}（指数 {peak.value}），与推算排卵期（{md(ovDate!)}）吻合，
            符合「排卵前后雌激素达峰」的规律。
          </>
        );
      } else {
        peakText = (
          <>
            峰值出现于 {md(peak.date)}（指数 {peak.value}），较推算排卵期（{md(ovDate!)}）
            {diff > 0 ? `晚 ${diff} 天` : `早 ${Math.abs(diff)} 天`}。
          </>
        );
      }
    }

    // ── 3. 趋势方向 + 建议 ──
    let trendTail = '';
    if (dir === '上升' && phase === 'follicular') trendTail = '与卵泡期雌激素上行一致。';
    else if (dir === '下降' && phase === 'luteal') trendTail = '与黄体期雌激素回落一致。';
    else if (pts.length < 10) trendTail = `窗口内仅 ${pts.length} 天有效数据，连续佩戴可让趋势更稳定。`;
    else if (phase !== 'unknown') trendTail = `当前为${cycleInfo?.phaseLabel ?? ''}，可结合相位一起看。`;

    return (
      <AiAnalysis
        foot={`基于戒指实测 HRV + EDA（皮肤电导）推算的 0–100 相对指数；戒指不直接测量雌激素，仅供了解自身趋势，不构成医学诊断。`}
      >
        {chip}
        <AiResultRow tone={row1Tone} title="当前相位水平">
          最新（{md(last.date)}）推算指数 {last.value}，处于近 {windowDays} 天的{levelLabel}（区间 {r0(min)}–
          {r0(max)}）。{phaseExpect}
          {knownPhase && !consistent ? '；实测信号与相位不同步，可能受睡眠、运动或佩戴时长影响。' : ''}
        </AiResultRow>
        <AiResultRow tone={peakTone} title="本窗口峰值">
          {peakText}
        </AiResultRow>
        <AiResultRow tone="neutral" title="趋势方向">
          近 {windowDays} 天整体呈{dir}
          {firstHalf != null && secondHalf != null ? `（前半段均值 ${r0(firstHalf)} → 后半段 ${r0(secondHalf)}）` : ''}。
          {trendTail}
        </AiResultRow>
      </AiAnalysis>
    );
  }

  // ── 孕激素 ──
  // 1. 黄体相判断（排卵前 vs 排卵后指数抬升）
  let lutealTone: AiTone = 'neutral';
  let lutealText: React.ReactNode;
  const rise = beforeMean != null && afterMean != null ? afterMean - beforeMean : null;
  if (ovMs != null && beforeMean != null && afterMean != null && before.length >= 2 && after.length >= 3) {
    if (rise != null && rise >= 12) {
      lutealTone = 'good';
      lutealText = (
        <>
          已进入黄体相：排卵后推算指数较排卵前抬升 {r0(rise!)} 点（{r0(beforeMean)} → {r0(afterMean)}），
          符合孕酮升高同时推高基础体温与静息心率的规律。
        </>
      );
    } else {
      lutealTone = 'warn';
      lutealText = (
        <>
          排卵后指数抬升不明显（仅 {r0(rise ?? 0)} 点）。可能黄体功能偏弱，或窗口内可用数据不足以体现，
          建议继续佩戴观察。
        </>
      );
    }
  } else if (ovMs != null && Date.now() >= ovMs) {
    lutealTone = 'warn';
    lutealText = (
      <>
        已过推算排卵日（{md(ovDate!)}），但排卵前后可用数据不足，暂无法判断抬升幅度。连续佩戴即可补齐。
      </>
    );
  } else {
    lutealTone = 'neutral';
    lutealText = (
      <>
        尚未排卵：孕酮本身处于低位，曲线保持低平属正常
        {ovDate ? `，预计约 ${md(ovDate)} 排卵后开始抬升` : ''}。
      </>
    );
  }

  // 2. 当前水平与相位期望
  let curTone: AiTone = 'neutral';
  let curText: React.ReactNode;
  if (phase === 'luteal') {
    const ok = level >= 0.5;
    curTone = ok ? 'good' : 'warn';
    curText = (
      <>
        最新（{md(last.date)}）指数 {last.value}，处于近 {windowDays} 天的{levelLabel}（区间 {r0(min)}–{r0(max)}）。
        黄体期孕酮应维持高位，{ok ? '当前符合。' : '当前偏低位，若持续偏低可关注黄体功能。'}
      </>
    );
  } else if (phase === 'ovulation') {
    curText = (
      <>
        最新（{md(last.date)}）指数 {last.value}。排卵期前后孕酮刚启动上行，处于低到中位属正常。
      </>
    );
  } else if (phase === 'follicular' || phase === 'period') {
    curText = (
      <>
        最新（{md(last.date)}）指数 {last.value}，处于{levelLabel}。{cycleInfo?.phaseLabel ?? ''}
        孕酮本就处于低位，当前低位曲线是正常表现。
      </>
    );
  } else {
    curText = <>最新（{md(last.date)}）指数 {last.value}；尚未记录经期，无法对照相位判断。</>;
  }

  // 3. 与体温双相互相印证
  let refTone: AiTone = 'neutral';
  let refText: React.ReactNode;
  if (tempConfirmed) {
    refTone = 'good';
    refText = <>体温双相已由 symptothermal 确认，与孕激素抬升互相印证，本周期排卵证据较充分。</>;
  } else if (phase === 'luteal') {
    refTone = 'warn';
    refText = (
      <>
        已进入黄体期但体温曲线尚未确认双相。体温与静息心率同源驱动，若孕激素曲线已上行而体温未确认，
        多为皮肤温度噪声或佩戴不连续所致。
      </>
    );
  } else {
    refText = <>尚未检测到体温双相；连续佩戴 ≥12 天并覆盖排卵前后，可让体温与孕激素两条曲线互相印证。</>;
  }

  return (
    <AiAnalysis foot="基于戒指实测体温（BBT 双相）与静息心率的抬升推算的 0–100 相对指数；戒指不直接测量孕酮，仅供了解自身趋势，不构成医学诊断。">
      {chip}
      <AiResultRow tone={lutealTone} title="黄体相判断">
        {lutealText}
      </AiResultRow>
      <AiResultRow tone={curTone} title="当前水平">
        {curText}
      </AiResultRow>
      <AiResultRow tone={refTone} title="与体温双相印证">
        {refText}
      </AiResultRow>
    </AiAnalysis>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    marginBottom: theme.space.xs,
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(2),
  },
  metricValue: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.accentSolid,
  },
  metricUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: theme.sp(1) },
  metricDetail: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
