/**
 * RecoveryDayTrendChart —— 「当日恢复分数趋势」（0–24h 连续曲线，Oura Readiness 范式）
 *
 * ★ 2026-11-07（用户「趋势图应是 0–100 的连续分，四态折线跳来跳去不对/太丑」）：
 *  · 数据源 = recoveryEngine.computeDayRecoveryCurve：当日逐时段 HRV 相对 14 天基线的比值
 *    → 分段线性映射为连续 0–100 分（贴基线=72，Oura 口径：贴基线=良好）→ 5 点滑动平滑 →
 *    15 分钟降采样；无采样时段 = null（断线），绝不伪造；
 *  · 画法 = 黄绿平滑折线 + 底部渐变面积 + 末点白描边圆点（当前时刻竖线仅今天）；
 *  · 右侧四档标签（偏弱/一般/良好/充沛）+ 60/70/85 虚线（Oura 档位），横轴 0时/12时/24时。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line as SvgLine, Circle, Defs, LinearGradient as SvgLinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { type DayCurvePoint } from '../lib/recoveryEngine';
import ChartTapTip, { type ChartTapSlot } from './ChartTapTip';

/** ★ 2026-11-07：档位边界与标签对齐 Oura Readiness 官方口径
 *  （85-100 充沛 / 70-84 良好 / 60-69 一般 / <60 偏弱），与 recoveryTag 同源。 */
const TIER_LINES = [60, 70, 85];
const TIERS = [
  { label: '偏弱', mid: 30 },
  { label: '一般', mid: 65 },
  { label: '良好', mid: 77.5 },
  { label: '充沛', mid: 92.5 },
];

export default function RecoveryDayTrendChart({
  curve,
  dayStart,
  endMs,
  height = 170,
}: {
  /** 当日恢复分曲线（15 分钟栅格，score=null = 无采样，断线） */
  curve: DayCurvePoint[];
  /** 当天 0 点时间戳 */
  dayStart: number;
  /** 线画到哪个时刻（今天=当前时刻；历史日=24:00），默认整天 */
  endMs?: number;
  height?: number;
}) {
  const [W, setW] = useState(0);
  const hasData = curve.some((p) => p.score != null && Number.isFinite(p.score));
  const dayEnd = endMs ?? dayStart + 864e5;
  const nowMs = useMemo(() => Date.now(), []);

  const layout = useMemo(() => {
    if (W === 0) return null;
    const padL = 6;
    const padR = 52; // 右侧档位标签区
    const padT = 8;
    const padB = 20;
    const x = (t: number) => padL + ((t - dayStart) / 864e5) * (W - padL - padR);
    const y = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * (height - padT - padB);
    // 连续段：null 格断线（相邻 null 间隔 ≤1 格视为连续缺口）
    const valid = curve.filter((p) => p.score != null && Number.isFinite(p.score)) as { t: number; score: number }[];
    const runs: { pts: string }[] = [];
    let cur: string[] = [];
    for (let k = 0; k < valid.length; k++) {
      if (cur.length > 0) {
        // 与上一个有效点之间若隔了 ≥2 个 null 格则断开
        const prev = valid[k - 1];
        const gap = Math.round((valid[k].t - prev.t) / (15 * 60e3)) - 1;
        if (gap >= 2) {
          runs.push({ pts: cur.join(' ') });
          cur = [];
        }
      }
      cur.push(`${x(valid[k].t).toFixed(1)},${y(valid[k].score).toFixed(1)}`);
    }
    if (cur.length > 0) runs.push({ pts: cur.join(' ') });
    // 面积（第一段）
    let areaPts = '';
    if (runs.length > 0) {
      const firstPts = runs[0].pts.split(' ');
      const lastPts = runs[runs.length - 1].pts.split(' ');
      const base = (height - padB).toFixed(1);
      areaPts = `${firstPts[0].split(',')[0]},${base} ${runs.map((r) => r.pts).join(' ')} ${lastPts[lastPts.length - 1].split(',')[0]},${base}`;
    }
    const last = valid.length > 0 ? { tx: x(valid[valid.length - 1].t), ty: y(valid[valid.length - 1].score) } : null;
    const nowX = x(Math.min(Math.max(nowMs, dayStart), dayStart + 864e5));
    return { y, runs, areaPts, last, padL, padR, padT, padB, nowX, plotW: W - padL - padR };
  }, [W, curve, dayStart, dayEnd, height, nowMs]);

  if (W === 0 || !layout) {
    return (
      <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {!hasData ? (
          <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.emptyText}>今日暂无数据，同步后自动绘制</Text>
          </View>
        ) : null}
      </View>
    );
  }
  const { y, runs, areaPts, last, padL, padR, padT, padB, nowX, plotW } = layout;

  // ★ 统一数值气泡：点曲线任意时刻 → 显示该时刻 + 恢复分
  const tapSlots = React.useMemo<ChartTapSlot[]>(() => {
    if (!layout || W <= 0) return [];
    const xOf = (t: number) => layout.padL + ((t - dayStart) / 864e5) * layout.plotW;
    return curve.flatMap((p) => {
      if (p.score == null || !Number.isFinite(p.score)) return [];
      const d = new Date(p.t);
      const hh = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return [{
        fx: xOf(p.t) / W,
        fy: layout.y(p.score) / height,
        label: `${hh}:${mins}`,
        value: `${Math.round(p.score)} / 100`,
        color: mm.colors.ringTeal,
      }];
    });
  }, [layout, W, height, curve, dayStart]);

  return (
    <View>
    <Svg width={W} height={height}>
      <Defs>
        <SvgLinearGradient id="dayRecGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={mm.colors.ringTeal} stopOpacity="0.26" />
          <Stop offset="100%" stopColor={mm.colors.ringTeal} stopOpacity="0.02" />
        </SvgLinearGradient>
      </Defs>
      {/* 网格 0 / 50 / 100 */}
      {[0, 50, 100].map((gv) => (
        <SvgLine key={`g${gv}`} x1={padL} y1={y(gv)} x2={padL + plotW} y2={y(gv)} stroke={mm.colors.inkFaint} strokeOpacity={0.16} strokeWidth={1} />
      ))}
      {/* 档位边界虚线 30 / 55 / 80 */}
      {TIER_LINES.map((gv) => (
        <SvgLine key={`t${gv}`} x1={padL} y1={y(gv)} x2={padL + plotW} y2={y(gv)} stroke={mm.colors.inkFaint} strokeOpacity={0.32} strokeWidth={1} strokeDasharray="4 4" />
      ))}
      {/* 当前时刻竖线（仅今天） */}
      {!endMs || endMs > nowMs ? (
        <SvgLine x1={nowX} y1={padT} x2={nowX} y2={height - padB} stroke={mm.colors.inkFaint} strokeOpacity={0.35} strokeWidth={1} />
      ) : null}
      {/* 渐变面积 */}
      {areaPts ? <Polyline points={areaPts} fill="url(#dayRecGrad)" stroke="none" /> : null}
      {/* 恢复分数曲线（黄绿，缺口断线） */}
      {runs.map((r, k) => (
        <Polyline key={k} points={r.pts} fill="none" stroke={mm.colors.ringTeal} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* 末点（当前时刻）白描边圆点 */}
      {last ? <Circle cx={last.tx} cy={last.ty} r={3.6} fill={mm.colors.ringTeal} stroke="#FFFFFF" strokeWidth={1.4} /> : null}
      {/* 右侧四档标签 */}
      {TIERS.map((t) => (
        <SvgText key={t.label} x={padL + plotW + 8} y={y(t.mid) + 3.5} fontSize={9.5} fill={mm.colors.inkSoft}>
          {t.label}
        </SvgText>
      ))}
      {/* 横轴时刻 */}
      <SvgText x={padL} y={height - 4} fontSize={9.5} fill={mm.colors.inkFaint} textAnchor="start">0时</SvgText>
      <SvgText x={padL + plotW / 2} y={height - 4} fontSize={9.5} fill={mm.colors.inkFaint} textAnchor="middle">12时</SvgText>
      <SvgText x={padL + plotW} y={height - 4} fontSize={9.5} fill={mm.colors.inkFaint} textAnchor="end">24时</SvgText>
    </Svg>
    <ChartTapTip slots={tapSlots} height={height} width={W} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },
});
