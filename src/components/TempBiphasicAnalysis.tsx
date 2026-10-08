/**
 * TempBiphasicAnalysis —— 「体温双相监测」图下方的 AI 解读
 *
 * 直接基于戒指真测皮肤温度 + 已推算周期相位，给出三条数据化结论：
 *   1) 确认排卵结果 —— 体温双相跳升幅度、高温期持续天数、与日历法是否吻合；
 *   2) 黄体功能结果 —— 双相幅度 + 黄体期长度 + 高温相稳定性；
 *   3) 联动周期受孕窗 —— 体温法排卵日修正后的易孕期窗口与当前位置。
 *
 * 体温为戒指真测皮肤温度；解读为 symptothermal 开源算法推算，非医学诊断。
 */
import React, { useMemo, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import AiAnalysis, { AiResultRow, type AiTone } from './AiAnalysis';
import {
  detectThermalShift,
  tempDailyToSeries,
  daysBetween,
  parseDate,
  type CycleInfo,
} from '../lib/cycleMath';
import type { RingState } from '../ble/RingBleManager';

interface Props {
  ring: RingState;
  cycleInfo: CycleInfo | null;
}

type Tone = AiTone;

function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function fmtDate(s: string): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function round1(v: number): number {
  return Math.round(v * 100) / 100;
}

export default function TempBiphasicAnalysis({ ring, cycleInfo }: Props) {
  const { shift, series, mag, baseline, cover, highDays, highStd } = useMemo(() => {
    const s = tempDailyToSeries(ring.tempDaily ?? {})
      .filter((p) => typeof p.temp === 'number' && Number.isFinite(p.temp) && p.temp > 30 && p.temp < 42)
      .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
    const sh = detectThermalShift(s, { threshold: 0.15, minPoints: 12, minSpan: 16 });
    let hd = 0;
    const ht: number[] = [];
    if (sh) {
      for (let i = sh.shiftIndex; i < s.length; i++) {
        if (s[i].temp >= sh.baseline + 0.1) {
          hd++;
          ht.push(s[i].temp);
        } else break;
      }
    }
    return {
      series: s,
      shift: sh,
      mag: sh ? round1(sh.coverTemp - sh.baseline) : null,
      baseline: sh ? round1(sh.baseline) : null,
      cover: sh ? round1(sh.coverTemp) : null,
      highDays: hd,
      highStd: std(ht),
    };
  }, [ring.tempDaily]);

  // 排卵日：优先体温法实测推断，回退日历法
  const ovDate = shift ? shift.ovulationDate : cycleInfo?.ovulationDate ?? null;
  // 黄体期长度：排卵日 → 下次经期首日
  const lutealLen = ovDate && cycleInfo?.nextPeriodDate ? daysBetween(ovDate, cycleInfo.nextPeriodDate) : null;
  // 体温法 vs 日历法排卵日偏差
  const ovDelta =
    shift && cycleInfo?.ovulationDate ? Math.abs(daysBetween(shift.ovulationDate, cycleInfo.ovulationDate)) : null;
  const tempConfirmed = !!cycleInfo?.tempConfirmed;

  const enoughData = series.length >= 12;

  // ── 1. 确认排卵结果 ──
  let ovTone: Tone = 'neutral';
  let ovText: ReactNode = '';
  if (shift && mag != null) {
    if (mag >= 0.3 && highDays >= 10) {
      ovTone = 'good';
      ovText = (
        <>
          已确认排卵。体温在 {fmtDate(shift.ovulationDate)} 前后出现清晰双相抬升，幅度 {mag}°C，
          高温期已持续 {highDays} 天。
          {ovDelta != null && ovDelta <= 3
            ? '体温法与日历法吻合。'
            : ovDelta != null
              ? `体温法较日历法调整了 ${ovDelta} 天。`
              : ''}
        </>
      );
    } else if (mag >= 0.3) {
      ovTone = 'good';
      ovText = (
        <>
          已检测到双相抬升（幅度 {mag}°C），但高温期仅 {highDays} 天，建议继续佩戴以确认黄体相稳定。
        </>
      );
    } else {
      ovTone = 'warn';
      ovText = (
        <>
          可能排卵：体温有抬升但幅度偏低（{mag}°C）。戒指测的是手腕皮肤温度，噪声较晨起舌下体温大、
          振幅偏小，若长期如此可关注排卵质量。
        </>
      );
    }
  } else if (enoughData) {
    ovTone = 'warn';
    ovText = (
      <>
        暂未检测到明确双相抬升。可能本月无排卵，或升温不够典型；已记录 {series.length} 天体温。
      </>
    );
  } else {
    ovTone = 'neutral';
    ovText = '数据不足：需连续佩戴 ≥12 天、覆盖排卵前后，才能判断本周期是否排卵。';
  }

  // ── 2. 黄体功能结果 ──
  let lutTone: Tone = 'neutral';
  let lutText: ReactNode = '';
  if (shift && mag != null && lutealLen != null) {
    const stable = highStd < 0.08;
    if (mag >= 0.3 && lutealLen >= 12 && stable) {
      lutTone = 'good';
      lutText = (
        <>
          黄体功能良好。孕酮充足，双相幅度 {mag}°C，黄体期长度 {lutealLen} 天（≥12 天为正常范围），
          高温相平稳。
        </>
      );
    } else if (mag >= 0.3 && lutealLen >= 10) {
      lutTone = 'warn';
      lutText = (
        <>
          黄体功能基本正常但偏弱：幅度 {mag}°C、黄体期 {lutealLen} 天（接近 10 天下限）
          {stable ? '' : '、高温相略有波动'}，建议关注。
        </>
      );
    } else if (lutealLen < 10) {
      lutTone = 'warn';
      lutText = (
        <>
          黄体期过短（{lutealLen} 天，不足 10 天）：孕酮支撑不足，可能影响受精卵着床，建议就医评估。
        </>
      );
    } else {
      lutTone = 'warn';
      lutText = <>黄体功能偏弱：双相幅度 {mag}°C 偏低，建议结合其他指标综合判断。</>;
    }
  } else if (shift && mag != null && lutealLen == null) {
    lutTone = 'warn';
    lutText = <>已确认排卵（幅度 {mag}°C），但尚缺下次经期起始日，追踪到经期后即可评估黄体期长度。</>;
  } else {
    lutTone = 'neutral';
    lutText = '数据不足：需先确认排卵并追踪至下次经期，才能评估黄体功能。';
  }

  // ── 3. 联动周期受孕窗 ──
  let fertTone: Tone = 'neutral';
  let fertText: ReactNode = '';
  if (ovDate && cycleInfo?.fertilityStart && cycleInfo?.fertilityEnd) {
    const d = cycleInfo.daysToOvulation;
    const inWindow = d != null && d >= -5 && d <= 1;
    fertTone = tempConfirmed ? 'good' : 'neutral';
    fertText = (
      <>
        按体温跳升日推算排卵约在 {fmtDate(ovDate)}。受孕窗为排卵前 5 天至排卵后 1 天
        （{fmtDate(cycleInfo.fertilityStart)} ~ {fmtDate(cycleInfo.fertilityEnd)}）
        {tempConfirmed ? '，本周期排卵已由体温双相确认' : ''}。
        {d != null
          ? inWindow
            ? `当前处于受孕窗内（距排卵 ${d} 天）。`
            : d > 1
              ? `当前已过受孕窗（排卵后 ${d} 天）。`
              : `当前距排卵 ${Math.abs(d)} 天，尚在受孕窗外。`
          : ''}
      </>
    );
  } else {
    fertTone = 'neutral';
    fertText = '暂无法确定排卵日，受孕窗待体温连续记录后补充。';
  }

  // ── 标题 + 建议 ──
  const phaseLabel = cycleInfo?.phaseLabel ?? '';
  const dayStr = cycleInfo?.dayInCycle != null ? `周期第 ${cycleInfo.dayInCycle} 天` : '体温监测';
  const bipTitle = shift
    ? `${phaseLabel || '双相监测'} · ${ovTone === 'good' ? '排卵已确认' : ovTone === 'warn' ? '排卵存疑' : '检测到双相'}`
    : `${phaseLabel || '双相监测'} · 尚未检测到双相`;

  const bipAdvice: string[] = [];
  if (!shift) bipAdvice.push('尚未检测到体温双相，连续佩戴 ≥12 天覆盖排卵前后即可补充');
  if (lutTone === 'warn') bipAdvice.push('黄体功能偏弱，建议连续佩戴更多周期确认');
  if (ovTone === 'warn') bipAdvice.push('排卵确认存疑，注意保证佩戴连续性');
  if (shift && bipAdvice.length === 0) bipAdvice.push('体温双相规律，保持连续佩戴记录');

  return (
    <AiAnalysis
      compact
      title={bipTitle}
      subtitle={dayStr}
      advice={bipAdvice}
      foot="基于戒指真测皮肤温度与 symptothermal 开源算法推算，仅供参考，不构成医学诊断。"
    >
      <AiResultRow compact tone={ovTone} title="确认排卵">
        {ovText}
      </AiResultRow>
      <AiResultRow compact tone={lutTone} title="黄体功能">
        {lutText}
      </AiResultRow>
      <AiResultRow compact tone={fertTone} title="联动受孕窗">
        {fertText}
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
