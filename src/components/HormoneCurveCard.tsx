/**
 * HormoneCurveCard — 雌激素变化曲线
 *
 * 动态切换策略 (用户反馈):
 *   戒指数据不够 (< 14天体温 或 < 14天HRV)
 *     → 显示建模曲线 (经典双峰模型), 标注 "参考值 · 多戴几天更准"
 *   戒指数据够了 (≥ 14天体温 或 HRV)
 *     → 用建模轮廓 + 戒指真实数据 (体温/HRV) 做每日校准
 *     → 标注 "戒指数据校准中"
 *
 * 戒指硬件不能直接测雌激素分子, 所以永远有建模基底, 数据够了后做个人校准。
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Circle, Rect, Line, Text as SvgText, Defs, LinearGradient, Stop } from "react-native-svg";
import { theme } from "../theme/theme";
import { modelEstrogenCurve, type CycleLog, type CycleInfo, type CyclePhase } from "../lib/cycleMath";
import { healthStore } from "../data/healthStore";

const H = 120;
const PAD_L = 28;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 22;

const PHASE_BG: Record<CyclePhase, string> = {
  period: "rgba(224,123,107,0.10)",
  follicular: "rgba(124,106,224,0.08)",
  ovulation: "rgba(111,207,180,0.14)",
  luteal: "rgba(157,138,240,0.10)",
};
const PHASE_BORDER: Record<CyclePhase, string> = {
  period: "rgba(224,123,107,0.45)",
  follicular: "rgba(124,106,224,0.35)",
  ovulation: "rgba(111,207,180,0.55)",
  luteal: "rgba(157,138,240,0.40)",
};

/** 判断戒指数据够不够校准 (≥14天体温 或 ≥14天HRV) */
function ringDataEnough(): boolean {
  let tempDays = 0, hrvDays = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (healthStore.getDay("temp", key)) tempDays++;
    if (healthStore.getDay("hrv", key)) hrvDays++;
  }
  return tempDays >= 14 || hrvDays >= 14;
}

/** 用戒指数据对建模曲线做每日校准 */
function calibrateWithRing(
  baseCurve: { day: number; value: number }[],
  cycleLength: number,
  ovulationDay: number,
  periodLength: number,
  lastPeriodStart: string,
): { day: number; value: number }[] {
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  // 计算 lastPeriodStart 到今天偏移几天
  const startMs = (() => {
    const [y, m, d] = lastPeriodStart.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  })();
  const dayInCycleToday = Math.round((today0 - startMs) / 86400000) + 1;

  // 收集: 卵泡期 HRV 均值, 黄体期 RHR 均值, BBT 体温跳升值
  let folHRV = 0, folCount = 0, lutRHR = 0, lutCount = 0;
  const temps: { dayInCycle: number; temp: number }[] = [];

  for (let i = 0; i < 60; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const dm = Math.round((d.getTime() - startMs) / 86400000) + 1;

    const hrvDm = healthStore.getDay("hrv", key);
    const hrDm = healthStore.getDay("hr", key);
    const tempDm = healthStore.getDay("temp", key);

    if (dm > 0 && dm < ovulationDay && hrvDm?.mean != null) {
      folHRV += hrvDm.mean; folCount++;
    }
    if (dm > ovulationDay && hrDm?.min != null) {
      lutRHR += hrDm.min; lutCount++;
    }
    if (tempDm?.mean != null) {
      temps.push({ dayInCycle: dm, temp: tempDm.mean });
    }
  }

  if (folCount > 0) folHRV /= folCount;
  if (lutCount > 0) lutRHR /= lutCount;

  // 校准因子
  // 建模曲线卵泡期 HRV 基准 = 35ms, 真实偏低说明你雌激素偏低 → 整体曲线下调
  const FOL_HRV_BASE = 40;
  const hrvFactor = folCount > 0 ? Math.max(0.6, Math.min(1.3, folHRV / FOL_HRV_BASE)) : 1.0;

  // BBT: 黄体期体温 - 卵泡期体温 = 双相差
  let bbtShift = null as number | null;
  if (temps.length >= 10) {
    const folTemps = temps.filter(t => t.dayInCycle > 0 && t.dayInCycle < ovulationDay).map(t => t.temp);
    const lutTemps = temps.filter(t => t.dayInCycle > ovulationDay).map(t => t.temp);
    if (folTemps.length >= 3 && lutTemps.length >= 3) {
      bbtShift = (lutTemps.reduce((a, b) => a + b, 0) / lutTemps.length) -
                 (folTemps.reduce((a, b) => a + b, 0) / folTemps.length);
    }
  }

  // 对曲线做点校准: 排卵日和黄体段用戒指实际数据微调
  const calibrated = baseCurve.map(p => {
    let v = p.value;
    // 整体按 hrvFactor 缩放 (但保留基底)
    v = 22 + (v - 22) * hrvFactor;

    // 如果有 BBT 双相跳升确认, 增强黄体期雌激素 (孕酮+雌激素双次峰)
    if (bbtShift != null && bbtShift >= 0.25 && p.day > ovulationDay) {
      // 黄体期 BBT 确认 → 雌激素次峰更明显
      const lutealT = (p.day - ovulationDay) / Math.max(1, cycleLength - ovulationDay);
      if (lutealT < 0.3) {
        v += 10 * (1 - Math.abs(bbtShift - 0.35) / 0.3);
      }
    }
    return { ...p, value: Math.round(Math.max(0, Math.min(100, v))) };
  });

  return calibrated;
}

export default function HormoneCurveCard({
  cycleInfo,
  cycleLog,
}: {
  cycleInfo: CycleInfo | null;
  cycleLog: CycleLog | null;
}) {
  if (!cycleLog || !cycleLog.lastPeriodStart) {
    return (
      <View style={styles.wrap}>
        <View style={styles.head}>
          <Text style={styles.title}>📈 雌激素变化</Text>
          <Text style={styles.note}>需要先记录经期</Text>
        </View>
        <Text style={styles.emptyText}>记录经期后可以看雌激素变化</Text>
      </View>
    );
  }

  const { cycleLength, lutealLength, periodLength } = cycleLog;
  const ovulationDay = cycleLength - lutealLength;
  const dayInCycle = cycleInfo?.dayInCycle ?? null;
  const currentPhase = cycleInfo?.phase ?? "unknown";

  const enough = ringDataEnough();

  const curve = useMemo(() => {
    const base = modelEstrogenCurve({ cycleLength, ovulationDay, periodLength });
    if (!enough) return base.map(p => ({ ...p, value: Math.round(p.value) }));
    return calibrateWithRing(base, cycleLength, ovulationDay, periodLength, cycleLog.lastPeriodStart);
  }, [cycleLength, ovulationDay, periodLength, enough, cycleLog.lastPeriodStart]);

  // 今日雌激素指数
  const estrogenIdx = useMemo(() => {
    if (dayInCycle == null) return null;
    const p = curve.find(x => x.day === dayInCycle);
    return p?.value ?? null;
  }, [curve, dayInCycle]);

  // ── SVG 画 ──
  const svgW = 300;
  const innerW = svgW - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const phaseBands = useMemo(() => {
    const bands: { dayStart: number; dayEnd: number; phase: CyclePhase }[] = [];
    bands.push({ dayStart: 1, dayEnd: periodLength, phase: "period" });
    bands.push({ dayStart: periodLength + 1, dayEnd: ovulationDay - 1, phase: "follicular" });
    bands.push({ dayStart: ovulationDay, dayEnd: ovulationDay + 0.5, phase: "ovulation" });
    bands.push({ dayStart: ovulationDay + 1, dayEnd: cycleLength, phase: "luteal" });
    return bands;
  }, [periodLength, ovulationDay, cycleLength]);

  const xForDay = (day: number) => {
    const frac = Math.max(0, Math.min(1, (day - 1) / (cycleLength - 1 || 1)));
    return PAD_L + innerW * frac;
  };
  const yForVal = (v: number) => PAD_T + innerH * (1 - v / 100);

  let d = `M ${xForDay(1).toFixed(1)} ${yForVal(curve[0]?.value ?? 22).toFixed(1)}`;
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i];
    const x = xForDay(p.day);
    const y = yForVal(p.value);
    const prev = curve[i - 1];
    const mx = (xForDay(prev.day) + x) / 2;
    d += ` C ${mx.toFixed(1)} ${yForVal(prev.value).toFixed(1)}, ${mx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  const curX = dayInCycle != null ? xForDay(Math.max(1, dayInCycle)) : null;
  const curY = dayInCycle != null ? yForVal(curve.find(p => p.day === dayInCycle)?.value ?? 22) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>📈 雌激素变化</Text>
        <Text style={styles.note}>{enough ? "戒指校准中" : "参考值 · 多戴几天更准"}</Text>
      </View>

      <View style={styles.nowRow}>
        <Text style={styles.nowLabel}>今天雌激素水平</Text>
        {estrogenIdx != null ? (
          <Text style={[styles.nowVal, { color: theme.colors.accentSolid }]}>{estrogenIdx}</Text>
        ) : (
          <Text style={styles.nowVal}>—</Text>
        )}
        {currentPhase !== "unknown" && (
          <View style={[styles.phaseTag, { backgroundColor: PHASE_BG[currentPhase] }]}>
            <Text style={[styles.phaseTagText, { color: PHASE_BORDER[currentPhase] }]}>
              {cycleInfo?.phaseLabel}
            </Text>
          </View>
        )}
      </View>

      <Svg width={svgW} height={H}>
        <Defs>
          <LinearGradient id="e2Area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#7EA6F8" stopOpacity="0.35" />
            <Stop offset="100%" stopColor="#7EA6F8" stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {phaseBands.map((b, i) => {
          const x1 = xForDay(b.dayStart);
          const x2 = xForDay(Math.min(cycleLength, b.dayEnd));
          if (x2 - x1 < 2) return null;
          return (
            <React.Fragment key={i}>
              <Rect x={x1} y={PAD_T} width={x2 - x1} height={innerH} fill={PHASE_BG[b.phase]} />
              <Rect x={x1} y={PAD_T} width={0.8} height={innerH} fill={PHASE_BORDER[b.phase]} />
            </React.Fragment>
          );
        })}
        <Rect x={xForDay(cycleLength)} y={PAD_T} width={0.8} height={innerH} fill={PHASE_BORDER.luteal} />

        <Path d={d} fill="none" stroke="#7EA6F8" strokeWidth={enough ? 2.4 : 1.8} strokeOpacity={enough ? 1.0 : 0.75} />
        <Path d={d + ` L ${xForDay(cycleLength)} ${PAD_T + innerH} L ${xForDay(1)} ${PAD_T + innerH} Z`} fill="url(#e2Area)" />

        {(() => {
          const ovX = xForDay(ovulationDay);
          return (
            <React.Fragment>
              <Circle cx={ovX} cy={yForVal(curve.find(p => p.day === ovulationDay)?.value ?? 100)} r={3.5} fill="#6FCFB4" />
              <SvgText x={ovX} y={H - 4} fontSize={8} fill="#6FCFB4" textAnchor="middle">排卵</SvgText>
            </React.Fragment>
          );
        })()}

        {curX != null && curY != null && (
          <React.Fragment>
            <Line x1={curX} y1={PAD_T} x2={curX} y2={PAD_T + innerH} stroke={theme.colors.accentSolid} strokeWidth={1} strokeDasharray="3,2" />
            <Circle cx={curX} cy={curY} r={4} fill={theme.colors.accentSolid} />
          </React.Fragment>
        )}

        <SvgText x={PAD_L - 4} y={PAD_T + 3} fontSize={8} fill="#999" textAnchor="end">100</SvgText>
        <SvgText x={PAD_L - 4} y={PAD_T + innerH + 2} fontSize={8} fill="#999" textAnchor="end">20</SvgText>
        {[1, Math.ceil(cycleLength / 2), cycleLength].map((day, i) => (
          <SvgText key={i} x={xForDay(day)} y={H - 6} fontSize={8} fill="#999" textAnchor="middle">D{day}</SvgText>
        ))}
      </Svg>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: PHASE_BORDER.period }]} /><Text style={styles.legendText}>经期</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: PHASE_BORDER.follicular }]} /><Text style={styles.legendText}>卵泡期</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: PHASE_BORDER.ovulation }]} /><Text style={styles.legendText}>排卵期</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: PHASE_BORDER.luteal }]} /><Text style={styles.legendText}>黄体期</Text></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.colors.cardBg, borderColor: theme.colors.cardBorder, borderWidth: 1, borderRadius: theme.radius.card, padding: theme.space.cardPad, marginTop: theme.space.sm },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space.sm },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  nowRow: { flexDirection: "row", alignItems: "center", marginBottom: theme.space.sm },
  nowLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  nowVal: { fontSize: theme.fontSize.hero * 0.6, fontWeight: theme.weight.bold as any, marginLeft: theme.sp(2), marginRight: theme.sp(2) },
  phaseTag: { paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill },
  phaseTagText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: "center", paddingVertical: theme.space.md },
  legendRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: theme.space.xs },
  legendItem: { flexDirection: "row", alignItems: "center", marginHorizontal: theme.sp(1), marginVertical: 2 },
  legendDot: { width: 10, height: 4, borderRadius: 2, marginRight: 4 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
