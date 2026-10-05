/**
 * StressTrendChart —— 心理压力 · 全天趋势图
 *
 * 放在「情绪洞察」页（首页心理压力卡点进来 / 洞察页情绪 tab，两处共用
 * `EmotionInsightView`，所以内容天然一致）。
 *
 * 数据源：`computeEmotionalStress()` 的 `slots`（30 分钟槽，0–47），
 * 与首页「心理压力」大数字读的是**同一份报告**（`stressScale` / `stressSlots`），
 * 所以趋势线与卡片分数必然同源，不会出现「线在低位、数字说中等」。
 *
 * 纵轴 = 心理压力 0–100 **百分位**（锚点 50 = 和你平时一样）。
 * 三档着色与 `psychologicalStressScale.STRESS_BANDS` 同源：
 *   低 <40 / 中 40–70 / 高 ≥70。
 *
 * 诚实边界：
 *  - 只有「判定成功」的槽才画点；无槽 = 不画，**不插值**；
 *  - 运动中 / 设备故障的槽不算「心理压力」，不参与连线（避免把走路时的 EDA 抖动画成压力尖峰）；
 *  - 全天无有效槽 → 显示「—」并说明原因，不放演示数据。
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { percentileFromZ } from '../lib/psychologicalStressScale';
import type { EmotionalStressReport, EmotionalStressSlot } from '../lib/emotionalStress';

const LEVELS: Array<{ min: number; color: string; label: string }> = [
  { min: 70, color: theme.colors.danger, label: '高' },
  { min: 40, color: theme.colors.warn, label: '中' },
  { min: -1, color: theme.colors.success, label: '低' },
];

export function stressColorOf(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return theme.colors.textSub;
  return LEVELS.find((l) => v >= l.min)!.color;
}

/** 单点（30 分钟槽粒度） */
export interface StressPoint {
  /** 30min 槽下标 0–47 */
  slot: number;
  /** 心理压力百分位 0–100 */
  value: number;
  /** 该槽是否有有效判定 */
  hasData: boolean;
  /** 该槽是否处于运动中（不参与连线） */
  isMoving: boolean;
}

/**
 * 从 `EmotionalStressReport` 抽趋势点。
 *
 * ★ 逐槽数值取 `featureDetail.bySlot[].fusedZ` → `percentileFromZ()`，
 *   与全天读数 `stressScale.value` **同一套换算**（`50 + 50·tanh(z/2)`），
 *   所以「趋势线的高低」和「卡片大数字」必然讲同一件事。
 *   ⚠ 不要拿 `slots[].level`（calm/mild/moderate/high 四档）当数值用 ——
 *     那是档位不是刻度，画出来只有 4 个台阶，看不出变化。
 *
 * 排除：`state` 为 moving / deviceFault / noData 的槽不给点（运动/故障/无数据
 * 都不是「心理压力」，混进去会把走路时的 EDA 抖动画成压力尖峰）。
 */
export function stressPointsOf(report: EmotionalStressReport | null | undefined): StressPoint[] {
  if (!report) return [];
  const stateBySlot = new Map<number, EmotionalStressSlot['state']>();
  for (const s of report.slots ?? []) stateBySlot.set(s.slot, s.state);

  const out: StressPoint[] = [];
  for (const b of report.featureDetail?.bySlot ?? []) {
    if (b.fusedZ == null) continue;
    const st = stateBySlot.get(b.slot);
    const moving = st === 'moving';
    out.push({
      slot: b.slot,
      value: percentileFromZ(b.fusedZ),
      // 运动槽即便有 fusedZ 也不画（它反映的是活动，不是压力）
      hasData: !moving && st !== 'deviceFault' && st !== 'noData',
      isMoving: moving,
    });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

interface Props {
  points: StressPoint[];
  /** 全天读数（用于副标题：value + 档位） */
  scale?: { value: number; bandLabel: string; caption: string } | null;
  /** 标注「此刻」竖线 */
  nowSlot?: number | null;
  chartH?: number;
}

export default function StressTrendChart({ points, scale, nowSlot, chartH }: Props) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const estW = Dimensions.get('window').width - theme.space.screen * 2 - theme.space.cardPad * 2;
  const Y_W = theme.sp(7);
  const padL = Y_W + theme.sp(1);
  const padR = theme.sp(3);
  const padT = theme.sp(2);
  const padB = theme.sp(6);
  const svgW = measuredW > padL + padR ? measuredW : estW;
  const svgH = (chartH ?? theme.sp(44)) - theme.sp(2);
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const N = 48; // 30min 槽
  const xAt = (slot: number) => padL + (plotW * slot) / N;
  const yAt = (v: number) => padT + plotH - (v / 100) * plotH;

  // 连续有值区段（运动槽/缺口断开，不插值）
  const runs: number[][] = [];
  {
    let cur: number[] = [];
    for (let s = 0; s < N; s++) {
      const p = points.find((q) => q.slot === s);
      if (p?.hasData) cur.push(s);
      else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }
  const lineOf = (idx: number[]) =>
    idx.map((s, k) => `${k === 0 ? 'M' : 'L'} ${xAt(s).toFixed(1)} ${yAt(points.find((q) => q.slot === s)!.value).toFixed(1)}`).join(' ');
  const areaOf = (idx: number[]) =>
    `${lineOf(idx)} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(idx[0]).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const anyData = points.some((p) => p.hasData);
  const MAIN_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <View>
      {scale ? (
        <View style={styles.headRow}>
          <Text style={[styles.scaleVal, { color: stressColorOf(scale.value) }]}>{scale.value}</Text>
          <Text style={styles.scaleUnit}>/100 · {scale.bandLabel}</Text>
        </View>
      ) : null}

      <View
        onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
        style={{ width: '100%' }}
      >
        <Svg width={svgW} height={svgH + theme.sp(2)}>
          <Defs>
            <SvgLinear id="stressArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={mm.colors.roseCore} stopOpacity={0.24} />
              <Stop offset="100%" stopColor={mm.colors.roseCore} stopOpacity={0.01} />
            </SvgLinear>
          </Defs>

          {/* 0 基线 + 档位边界虚线 */}
          <Path d={`M ${padL} ${yAt(0)} L ${padL + plotW} ${yAt(0)}`} stroke={theme.colors.ui.borderSoft} strokeWidth={1.2} />
          {[40, 70].map((v) => (
            <Path key={v} d={`M ${padL} ${yAt(v)} L ${padL + plotW} ${yAt(v)}`}
              stroke={theme.colors.textSub + '30'} strokeWidth={1} strokeDasharray="3 3" />
          ))}
          {/* 50 = 与平时持平（百分位锚点） */}
          <Path d={`M ${padL} ${yAt(50)} L ${padL + plotW} ${yAt(50)}`}
            stroke={theme.colors.accentSolid} strokeWidth={1} strokeDasharray="4 3" opacity={0.42} />

          {/* 档位文字 */}
          {LEVELS.map((lv, i) => {
            const v = i === 0 ? 85 : i === 1 ? 55 : 20;
            return (
              <SvgText key={lv.label} x={padL - theme.sp(1.5)} y={yAt(v) + 3} textAnchor="end"
                fontSize={theme.fontSize.micro} fontWeight="600" fill={lv.color}>{lv.label}</SvgText>
            );
          })}

          {/* 面积 + 折线 */}
          {runs.map((idx, i) => (
            <React.Fragment key={'r' + i}>
              <Path d={areaOf(idx)} fill="url(#stressArea)" />
              <Path d={lineOf(idx)} fill="none" stroke={mm.colors.roseCore}
                strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </React.Fragment>
          ))}
          {/* 单点区段画点，否则不可见 */}
          {runs.map((idx, i) => idx.length === 1 ? (
            <Circle key={'p' + i} cx={xAt(idx[0])} cy={yAt(points.find((q) => q.slot === idx[0])!.value)} r={2.4}
              fill={mm.colors.roseCore} />
          ) : null)}

          {/* 「此刻」竖线 */}
          {nowSlot != null && nowSlot >= 0 && nowSlot < N ? (
            <Line x1={xAt(nowSlot)} y1={padT} x2={xAt(nowSlot)} y2={padT + plotH}
              stroke={theme.colors.accentSolid} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          ) : null}

          {/* X 轴（每 3 小时） */}
          {MAIN_HOURS.map((h) => {
            const slot = h * 2;
            const x = h === 24 ? padL + plotW : xAt(slot);
            const align = h === 0 ? 'start' : h >= 24 ? 'end' : 'middle';
            return (
              <SvgText key={h} x={x} y={padT + plotH + theme.sp(4)} textAnchor={align}
                fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>{String(h).padStart(2, '0')}</SvgText>
            );
          })}
        </Svg>
      </View>

      {/* 档位图例 + 口径 */}
      <View style={styles.legendRow}>
        {LEVELS.map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: l.color }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        {anyData
          ? `纵轴 = 心理压力百分位（50 = 和你平时一样）· 每点 30 分钟；虚线为 50 基准${scale ? ' · ' + scale.caption : ''}`
          : '今天还没有可判定的时段 · 连上戒指开启自动监测后开始生成（约需 3 天建立个人基线）'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: theme.space.xs },
  scaleVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any },
  scaleUnit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.sp(3), marginTop: theme.sp(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  dot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5) },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  caption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1), lineHeight: 16 },
});
