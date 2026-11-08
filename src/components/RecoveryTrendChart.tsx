/**
 * RecoveryTrendChart —— 「恢复力」0–100 单线趋势图（Oura 恢复力页范式）
 *
 * ★ 2026-11-07（用户「压力恢复正面展示太复杂，就展示 0~100 的恢复力，像 Oura 那样，
 *   压力别在这儿展示了」）：
 *  · 一条恢复力折线（0–100 逐日实算分，recoveryEngine 四态算法），末段 today 竖向标线 + 加大圆点；
 *  · 右侧四个档位标签（偏弱 / 一般 / 良好 / 充沛，与 recoveryTag 同阈值 30/55/80），
 *    档位边界画虚线 —— 与竞品右侧「优异级/强劲级…」同排法；
 *  · 底部横轴 = 星期（周日~周六），取首日 / 每 3 天 / 今天；
 *  · 压力线彻底撤出恢复模块（压力看「身心压力」详情页）。
 *  · 无数据渲染占位文案，绝不伪造。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line as SvgLine, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ChartTapTip, { type ChartTapSlot } from './ChartTapTip';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 四档标签：落在各档带的垂直居中位置（<30 / 30–55 / 55–80 / ≥80） */
const TIERS = [
  { label: '偏弱', mid: 15 },
  { label: '一般', mid: 42.5 },
  { label: '良好', mid: 67.5 },
  { label: '充沛', mid: 90 },
];
const TIER_LINES = [30, 55, 80];

export default function RecoveryTrendChart({
  values,
  endDayMs,
  height = 170,
  ticks: ticksProp,
}: {
  /** 逐日恢复分（0–100），按时间升序；null = 当天无数据，线在此断开 */
  values: (number | null)[];
  /** 序列最后一天的 0 点时间戳（用于推算每天星期标签） */
  endDayMs: number;
  height?: number;
  /** 自定义横轴刻度（周/月/年用日期标签；不传则按星期自动取 首/每3天/今天） */
  ticks?: { i: number; label: string }[];
}) {
  const [W, setW] = useState(0);
  const hasData = values.some((v) => v != null && Number.isFinite(v));

  const layout = useMemo(() => {
    if (W === 0) return null;
    const padL = 6;
    const padR = 52; // 右侧档位标签区
    const padT = 8;
    const padB = 20;
    const n = values.length;
    const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
    const y = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * (height - padT - padB);
    const valid = values
      .map((v, i) => ({ v, i }))
      .filter((p): p is { v: number; i: number } => p.v != null && Number.isFinite(p.v));
    // 连续段：缺口断线
    const runs: { pts: string }[] = [];
    let cur: string[] = [];
    for (let k = 0; k < valid.length; k++) {
      if (cur.length > 0 && valid[k].i !== valid[k - 1].i + 1) {
        runs.push({ pts: cur.join(' ') });
        cur = [];
      }
      cur.push(`${x(valid[k].i).toFixed(1)},${y(valid[k].v).toFixed(1)}`);
    }
    if (cur.length > 0) runs.push({ pts: cur.join(' ') });
    const dots = valid.map((p) => ({ cx: x(p.i), cy: y(p.v), i: p.i, v: p.v }));
    // 横轴刻度：自定义优先（周/月/年传日期标签）；否则按星期（首日 / 每 3 天 / 今天）
    let ticks: { i: number; label: string }[];
    if (ticksProp && ticksProp.length > 0) {
      ticks = ticksProp;
    } else {
      ticks = [];
      for (let i = 0; i < n; i += 3) {
        const d = new Date(endDayMs - (n - 1 - i) * 864e5);
        ticks.push({ i, label: WEEKDAY[d.getDay()] });
      }
      const last = new Date(endDayMs);
      if ((n - 1) % 3 !== 0) ticks.push({ i: n - 1, label: WEEKDAY[last.getDay()] });
    }
    return { x, y, runs, dots, ticks, padL, padR, padT, padB, lastValid: valid[valid.length - 1] };
  }, [W, values, endDayMs, height, ticksProp]);

  if (W === 0 || !layout) {
    return (
      <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {!hasData ? (
          <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.emptyText}>近 14 天暂无数据，同步后自动绘制</Text>
          </View>
        ) : null}
      </View>
    );
  }
  const { x, y, runs, dots, ticks, padL, padR, padT, padB, lastValid } = layout;
  const plotW = W - padL - padR;

  // ★ 统一数值气泡：点任意一天 → 显示日期 + 当天恢复力分值
  const tapSlots = React.useMemo<ChartTapSlot[]>(() => {
    if (!layout || W <= 0) return [];
    return layout.dots.map((d) => {
      const day = new Date(endDayMs - (values.length - 1 - d.i) * 864e5);
      return {
        fx: d.cx / W,
        fy: d.cy / height,
        label: `${day.getMonth() + 1}/${day.getDate()}`,
        value: `${Math.round(d.v)} / 100`,
        color: mm.colors.ringTeal,
      };
    });
  }, [layout, W, height, endDayMs, values.length]);

  return (
    <View>
      <Svg width={W} height={height}>
        {/* 网格 0 / 50 / 100 */}
        {[0, 50, 100].map((gv) => (
          <SvgLine key={`g${gv}`} x1={padL} y1={y(gv)} x2={padL + plotW} y2={y(gv)} stroke={mm.colors.inkFaint} strokeOpacity={0.16} strokeWidth={1} />
        ))}
        {/* 档位边界虚线 30 / 55 / 80 */}
        {TIER_LINES.map((gv) => (
          <SvgLine key={`t${gv}`} x1={padL} y1={y(gv)} x2={padL + plotW} y2={y(gv)} stroke={mm.colors.inkFaint} strokeOpacity={0.32} strokeWidth={1} strokeDasharray="4 4" />
        ))}
        {/* 今天竖向标线（最后有数据的一天，Oura「今天」竖线同款） */}
        {lastValid ? (
          <SvgLine x1={x(lastValid.i)} y1={padT} x2={x(lastValid.i)} y2={height - padB} stroke={mm.colors.inkFaint} strokeOpacity={0.35} strokeWidth={1} />
        ) : null}
        {/* 恢复力折线（黄绿，缺口断线） */}
        {runs.map((r, k) => (
          <Polyline key={k} points={r.pts} fill="none" stroke={mm.colors.ringTeal} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* 逐日圆点（白色描边，今天加大） */}
        {dots.map((d, k) => (
          <Circle
            key={`d${k}`}
            cx={d.cx}
            cy={d.cy}
            r={lastValid && d.i === lastValid.i ? 4 : 2.6}
            fill={mm.colors.ringTeal}
            stroke="#FFFFFF"
            strokeWidth={lastValid && d.i === lastValid.i ? 1.6 : 1}
          />
        ))}
        {/* 右侧四档标签 */}
        {TIERS.map((t) => (
          <SvgText key={t.label} x={padL + plotW + 8} y={y(t.mid) + 3.5} fontSize={9.5} fill={mm.colors.inkSoft}>
            {t.label}
          </SvgText>
        ))}
        {/* 星期横轴 */}
        {ticks.map((t, k) => {
          const isLast = t.i === (values.length - 1);
          const anchor = k === 0 ? 'start' : isLast ? 'end' : 'middle';
          const tx = k === 0 ? padL : isLast ? padL + plotW : x(t.i);
          return (
            <SvgText key={`x${t.i}`} x={tx} y={height - 4} fontSize={9.5} fill={mm.colors.inkFaint} textAnchor={anchor}>
              {t.label}
            </SvgText>
          );
        })}
      </Svg>
      <ChartTapTip slots={tapSlots} height={height} width={W} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },
});
