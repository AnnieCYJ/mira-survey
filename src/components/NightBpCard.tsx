/**
 * NightBpCard —— 睡眠恢复详情页「夜间血压参考」卡（Oura 对标 · 推导指标）
 *
 * ★ 2026-11-06（用户：「除了没有体温传感器，其他的我其实应该可以做个血压……补齐了，
 *   参考开源的一些个算法……放在睡眠恢复就是睡眠模块的相应位置上」）。
 *
 * 数据与口径（全部真实数据，不造假；不做绝对血压推算——无连续 PPG 波形与个人校准，
 *   编一个血压数值反而违反「不诊断/不评分」铁律。参考 Oura 做法：睡眠页给夜间心血管
 *   相关**趋势参考**，绝对血压走手动光电测量 BpDetailScreen）：
 *  1. 最近一次血压测量（真实：healthStore bpSys/bpDia intraday 最近点，来自光电测量/健康一览）。
 *  2. 近 7 天有测量的日的均值（getDay().mean）。
 *  3. 夜间心率下降（dipping 近似参考）：夜间(22:00–06:00) 平均 HR 相对日间(07:00–22:00)
 *     平均 HR 的下降百分比。公开生理学口径：夜间血压/心率较日间下降 ≥10% 为正常 dipping
 *     （non-dipping 与心血管风险相关）。**此处用心率近似血压 dipping**，仅作生活方式参考，
 *     需连续夜间血压才能给出血压 dipping 本身。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { healthStore, dayKey, type TimePoint } from '../data/healthStore';

const DAY_MS = 86400000;

interface Props {
  /** 锚定日（睡眠恢复页当前选中日，默认今天） */
  anchorMs?: number;
}

/** 该日「夜间窗口」（前一日 22:00 → 该日 06:00）的平均心率 */
function nightHrMean(dk: string, dayMs: number): number | null {
  const out: number[] = [];
  try {
    for (const p of healthStore.getIntraday('hr', dayKey(dayMs - DAY_MS))) {
      if (new Date(p.t).getHours() >= 22) out.push(p.v); // 前夜 22–24
    }
    for (const p of healthStore.getIntraday('hr', dk)) {
      if (new Date(p.t).getHours() < 6) out.push(p.v);   // 该日 0–6
    }
  } catch { /* 静默 */ }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}

/** 该日「日间窗口」（07:00–22:00）的平均心率 */
function daytimeHrMean(dk: string): number | null {
  const out: number[] = [];
  try {
    for (const p of healthStore.getIntraday('hr', dk)) {
      const h = new Date(p.t).getHours();
      if (h >= 7 && h < 22) out.push(p.v);
    }
  } catch { /* 静默 */ }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}

export function NightBpCard({ anchorMs }: Props) {
  const data = useMemo(() => {
    const dayMs = anchorMs ?? Date.now();
    const dk = dayKey(dayMs);
    // 1) 最近一次血压测量（该日优先，没有则往前找 7 天内最近一次）
    let sys: number | null = null;
    let dia: number | null = null;
    let measuredAt: number | null = null;
    for (let i = 0; i < 7; i++) {
      const d = dayKey(dayMs - i * DAY_MS);
      const sp: TimePoint[] = healthStore.getIntraday('bpSys', d);
      const dp: TimePoint[] = healthStore.getIntraday('bpDia', d);
      if (sp.length && dp.length) {
        sys = sp[sp.length - 1].v;
        dia = dp[dp.length - 1].v;
        measuredAt = Math.max(sp[sp.length - 1].t, dp[dp.length - 1].t);
        break;
      }
    }
    // 2) 近 7 天有测量的日均值（≥2 天才给均值，1 天无趋势意义）
    const sysDays: number[] = [];
    const diaDays: number[] = [];
    let measuredDayCount = 0;
    for (let i = 0; i < 7; i++) {
      const d = dayKey(dayMs - i * DAY_MS);
      const s = healthStore.getDay('bpSys', d)?.mean ?? null;
      const di = healthStore.getDay('bpDia', d)?.mean ?? null;
      if (s != null && di != null) { sysDays.push(s); diaDays.push(di); measuredDayCount++; }
    }
    const sysAvg = sysDays.length >= 2 ? sysDays.reduce((a, b) => a + b, 0) / sysDays.length : null;
    const diaAvg = diaDays.length >= 2 ? diaDays.reduce((a, b) => a + b, 0) / diaDays.length : null;
    // 3) 夜间心率 dipping 近似
    const nightHr = nightHrMean(dk, dayMs);
    const dayHr = daytimeHrMean(dk);
    const dipPct = nightHr != null && dayHr != null && dayHr > 0
      ? ((dayHr - nightHr) / dayHr) * 100
      : null;
    const dipLabel = dipPct == null ? null : dipPct >= 10 ? '下降充分' : dipPct >= 3 ? '下降偏少' : '基本没降';
    const dipColor = dipPct == null ? theme.colors.textSub : dipPct >= 10 ? mm.colors.limeDeep : dipPct >= 3 ? mm.colors.honeyDeep : theme.colors.danger;
    return { sys, dia, measuredAt, sysAvg, diaAvg, measuredDayCount, dipPct, dipLabel, dipColor, nightHr, dayHr };
  }, [anchorMs]);

  const hasBp = data.sys != null && data.dia != null;

  return (
    <Card>
      <Text style={styles.title}>夜间血压参考</Text>
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.label}>最近测量</Text>
          <Text style={styles.big}>
            {hasBp ? `${Math.round(data.sys!)}/${Math.round(data.dia!)}` : '--'}
            <Text style={styles.unit}> mmHg</Text>
          </Text>
          <Text style={styles.sub}>
            {hasBp
              ? data.measuredAt ? `光电血压 · ${new Date(data.measuredAt).getMonth() + 1}/${new Date(data.measuredAt).getDate()}` : '光电血压'
              : '还没有血压测量'}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.label}>7 天测量均值</Text>
          <Text style={styles.big}>
            {data.sysAvg != null && data.diaAvg != null
              ? `${Math.round(data.sysAvg)}/${Math.round(data.diaAvg)}`
              : '--'}
            <Text style={styles.unit}> mmHg</Text>
          </Text>
          <Text style={styles.sub}>
            {data.measuredDayCount >= 2
              ? `近 7 天 ${data.measuredDayCount} 天有测量`
              : data.measuredDayCount === 1
                ? '测量 1 天，暂无均值'
                : '还没有测量记录'}
          </Text>
        </View>
      </View>
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.label}>夜间心率下降（dipping 参考）</Text>
          <Text style={[styles.big, { color: data.dipColor }]}>
            {data.dipPct != null ? `${data.dipPct.toFixed(0)}%` : '--'}
          </Text>
          <Text style={[styles.sub, data.dipLabel ? { color: data.dipColor } : null]}>
            {data.dipLabel ?? '需要夜间心率数据'}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.label}>夜间 / 日间心率</Text>
          <Text style={styles.big}>
            {data.nightHr != null && data.dayHr != null
              ? `${Math.round(data.nightHr)}/${Math.round(data.dayHr)}`
              : '--'}
            <Text style={styles.unit}> bpm</Text>
          </Text>
          <Text style={styles.sub}>夜 22–06 · 日 07–22</Text>
        </View>
      </View>
      <Text style={styles.note}>
        血压来自手动光电测量；夜间心率下降用心率近似血压 dipping（夜间较日间下降 ≥10% 为常见参考口径），仅供参考，
        不构成医疗建议。连续夜间血压监测可在睡前完成一次光电血压测量积累个人记录。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  grid: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(2) },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(1),
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  label: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  big: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  unit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: '400' as any },
  sub: { fontSize: theme.fontSize.micro - 2, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center' },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});

export default NightBpCard;
