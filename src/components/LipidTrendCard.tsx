/**
 * ★ 2026-10-16（续）：血脂四项「日 / 周 / 月 / 年」趋势图（TC / TG / HDL / LDL 同图）。
 *
 * 与 MetricDetailScreen 的 LipidOverviewCard（当日快照、共享 0–10 坐标轴）配套：
 *  - LipidOverviewCard = 今日四项「同尺度对比」快照；
 *  - 本组件 = 四项「随时间变化」的趋势，复用屏幕 / 卡片自带的日周月年切换。
 *
 * 设计要点：
 *  - 四条线共用一根 0–10 mmol/L 坐标轴（mm.colors 配色：TC 玫红 / TG 天蓝 / HDL 青绿 / LDL 蜜黄）；
 *  - 日视图：手动测量按真实时间戳连续铺开（共享当日 0–24h 域）；
 *  - 周 / 月 / 年：按自然日 / 月聚合，遇缺口断线，不编造；
 *  - 自带紧凑 4 段切换，既可独立用（洞察页血液成分 tab），也可受控用（详情页复用顶部 RangeSwitch）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Circle, Line as SvgLine, Text as SvgText, G } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { buildHistorySeries, type HistoryResult } from '../lib/realSeries';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import { useRingState } from '../hooks/useRingState';
import Card from './Card';

const AXIS_MAX = 10; // mmol/L，四项共享坐标轴上限
const Y_TICKS = [0, 2, 4, 6, 8, 10];
const CHART_H = 210;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 26;

type LipidDef = { key: string; name: string; short: string; color: string };
const LIPIDS: LipidDef[] = [
  { key: 'cholesterol', name: '总胆固醇', short: 'TC', color: mm.colors.roseCore },
  { key: 'triglyceride', name: '甘油三酯', short: 'TG', color: mm.colors.skyCore },
  { key: 'hdl', name: '高密度脂蛋白', short: 'HDL', color: mm.colors.limeMid },
  { key: 'ldl', name: '低密度脂蛋白', short: 'LDL', color: mm.colors.honeyCore },
];

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

interface Props {
  /** 受控的当前范围；不传则组件内部自带切换 */
  range?: RangeKey;
  /** 受控模式下切换回调（传了即用受控） */
  onRangeChange?: (r: RangeKey) => void;
  /** 是否显示自带的范围切换（受控模式下也会显示，点击触发 onRangeChange） */
  showToggle?: boolean;
  /** 锚点日期，默认今天 */
  anchor?: Date;
  /** 标题，默认「血脂四项趋势」 */
  title?: string;
}

export default function LipidTrendCard({ range: rangeProp, onRangeChange, showToggle, anchor, title }: Props) {
  const ring = useRingState();
  const isControlled = rangeProp !== undefined;
  const [internal, setInternal] = useState<RangeKey>(rangeProp ?? 'week');
  // 受控（传了 range）：直接跟随父级范围；非受控：用内部 state
  const r = isControlled ? (rangeProp as RangeKey) : internal;
  const setR = onRangeChange ?? setInternal;

  const [w, setW] = useState(() => Math.max(260, Dimensions.get('window').width - 64));
  // 未传 anchor 时给一个稳定的默认（避免每次渲染都 new Date 导致 useMemo 失效）
  const [defAnchor] = useState<Date>(() => new Date());
  const a = anchor ?? defAnchor;
  const onLayout = (e: LayoutChangeEvent) => {
    const cw = e.nativeEvent.layout.width;
    if (cw > 0 && Math.abs(cw - w) > 1) setW(cw);
  };

  const seriesList: HistoryResult[] = useMemo(
    () => LIPIDS.map((it) => buildHistorySeries(it.key, r, ring, null, a)),
    [r, ring, a]
  );

  // 判定连续（日）还是索引（周/月/年）
  const anyCont = seriesList.some((s) => s.continuous && (s.tPoints?.length ?? 0) > 0);
  const mode: 'cont' | 'idx' = anyCont ? 'cont' : 'idx';

  const plotW = w - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;

  // 共享时间 / 索引域
  let domMin = 0;
  let domMax = 1;
  let n = 0;
  let axisLabels: string[] = [];
  if (mode === 'cont') {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of seriesList) {
      if (s.continuous && s.tPoints && s.tPoints.length) {
        lo = Math.min(lo, s.tMin ?? s.tPoints[0].t);
        hi = Math.max(hi, s.tMax ?? s.tPoints[s.tPoints.length - 1].t);
      }
    }
    if (!isFinite(lo)) {
      const d = new Date(a);
      d.setHours(0, 0, 0, 0);
      lo = d.getTime();
      hi = lo + 86_400_000;
    }
    domMin = lo;
    domMax = hi;
  } else {
    n = Math.max(1, ...seriesList.map((s) => s.points.length));
    const ref = seriesList.find((s) => s.axisOverride && s.axisOverride.length) ?? seriesList[0];
    axisLabels = (ref?.axisOverride && ref.axisOverride.length ? ref.axisOverride : RANGE_DEF[r].axis) ?? [];
  }

  const yAt = (v: number) => {
    const c = Math.max(0, Math.min(AXIS_MAX, Number.isFinite(v) ? v : 0));
    return PAD_T + (1 - c / AXIS_MAX) * plotH;
  };
  const xAtT = (t: number) => PAD_L + ((t - domMin) / (domMax - domMin || 1)) * plotW;
  const xAtI = (i: number) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  // ★ 2026-11-04（用户「四项数值每次都差得很近，放一起看不清」）：
  //   四条线共用 0–10 轴 → TC/TG/HDL/LDL 全挤在下半区。改为「四条独立小图」：
  //   各自量程自动缩放 + 各自参考线（理想区间），每项趋势独立可读；X 域四图共享。
  const SPARK_H = 62;
  const PAD_L_S = 30;
  const PAD_R_S = 10;
  const PAD_T_S = 8;
  const PAD_B_S = 14;
  const plotWS = w - PAD_L_S - PAD_R_S;

  const panelDomain = (s: HistoryResult, ref: number | null) => {
    const vals = (s.continuous && s.tPoints ? s.tPoints.map((p) => p.v) : (s.points.filter((v) => v != null) as number[]))
      .filter((v) => Number.isFinite(v));
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    if (ref != null) {
      lo = Math.min(lo, ref);
      hi = Math.max(hi, ref);
    }
    const pad = Math.max((hi - lo) * 0.25, hi * 0.12, 0.3);
    return { lo: Math.max(0, lo - pad), hi: hi + pad };
  };

  const sparkY = (v: number, dlo: number, dhi: number) => {
    const span = dhi - dlo || 1;
    const c = Math.max(dlo, Math.min(dhi, Number.isFinite(v) ? v : dlo));
    return PAD_T_S + (1 - (c - dlo) / span) * (SPARK_H - PAD_T_S - PAD_B_S);
  };

  const hasData = seriesList.some((s) =>
    s.continuous && s.tPoints ? s.tPoints.length > 0 : s.points.some((v) => v != null)
  );

  // 理想区间参考线（与 MetricDetailScreen.LIPID_ITEMS 的 hi/lo 同值）
  const REF: Record<string, { v: number; label: string }> = {
    cholesterol: { v: 5.2, label: '理想 ≤5.2' },
    triglyceride: { v: 1.7, label: '理想 ≤1.7' },
    hdl: { v: 1.0, label: '理想 ≥1.0' },
    ldl: { v: 3.4, label: '理想 ≤3.4' },
  };

  // X 轴标签（四图共享同一 X 域，只画在最下面一幅）
  const xLabels: { x: number; label: string }[] = [];
  if (hasData) {
    if (mode === 'cont') {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const t = domMin + f * (domMax - domMin);
        const d = new Date(t);
        xLabels.push({ x: PAD_L_S + f * plotWS, label: `${String(d.getHours()).padStart(2, '0')}:00` });
      }
    } else if (n > 0) {
      const step = Math.max(1, Math.ceil(n / 7));
      const xAt = (i: number) => PAD_L_S + (n > 1 ? (i / (n - 1)) * plotWS : plotWS / 2);
      for (let i = 0; i < n; i += step) xLabels.push({ x: xAt(i), label: axisLabels[i] ?? '' });
      if ((n - 1) % step !== 0) xLabels.push({ x: xAt(n - 1), label: axisLabels[n - 1] ?? '' });
    }
  }

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>{title ?? '血脂四项趋势'}</Text>
        {showToggle || onRangeChange ? (
          <View style={styles.seg}>
            {RANGES.map((rg) => {
              const active = r === rg.key;
              return (
                <PressableRow key={rg.key} active={active} onPress={() => setR(rg.key)}>
                  <Text style={[styles.segLabel, active && styles.segLabelActive]}>{rg.label}</Text>
                </PressableRow>
              );
            })}
          </View>
        ) : null}
      </View>

      {!hasData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>该时间范围内暂无血脂测量记录</Text>
          <Text style={styles.emptySub}>在「身体成分 / 血液成分」录入血脂后，这里会显示四项随时间的变化</Text>
        </View>
      ) : (
        <View onLayout={onLayout}>
          {LIPIDS.map((it, idx) => {
            const s = seriesList[idx];
            const ref = REF[it.key];
            const dom = panelDomain(s, ref.v);
            const pts: string[] = [];
            if (mode === 'cont' && s.continuous && s.tPoints) {
              for (const p of s.tPoints) {
                if (!Number.isFinite(p.v)) continue;
                const x = PAD_L_S + ((p.t - domMin) / (domMax - domMin || 1)) * plotWS;
                pts.push(`${x.toFixed(1)},${sparkY(p.v, dom.lo, dom.hi).toFixed(1)}`);
              }
            } else {
              s.points.forEach((v, i) => {
                if (v == null || !Number.isFinite(v)) return;
                const x = PAD_L_S + (n > 1 ? (i / (n - 1)) * plotWS : plotWS / 2);
                pts.push(`${x.toFixed(1)},${sparkY(v, dom.lo, dom.hi).toFixed(1)}`);
              });
            }
            const latest =
              s.continuous && s.tPoints?.length
                ? s.tPoints[s.tPoints.length - 1].v
                : (() => {
                    for (let k = s.points.length - 1; k >= 0; k--) {
                      const v = s.points[k];
                      if (v != null && Number.isFinite(v)) return v;
                    }
                    return null;
                  })();
            const refY = sparkY(ref.v, dom.lo, dom.hi);
            const isLast = idx === LIPIDS.length - 1;
            return (
              <View key={it.key} style={isLast ? undefined : styles.panelGap}>
                <View style={styles.panelHead}>
                  <View style={[styles.legendDot, { backgroundColor: it.color }]} />
                  <Text style={styles.panelName}>{it.name}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.panelVal, { color: it.color }]}>{latest != null ? latest.toFixed(2) : '—'}</Text>
                  <Text style={styles.panelUnit}>mmol/L</Text>
                </View>
                <Svg width={w} height={SPARK_H}>
                  {/* 理想区间参考线（虚线 + 右上小字） */}
                  <SvgLine x1={PAD_L_S} y1={refY} x2={w - PAD_R_S} y2={refY} stroke={theme.colors.textSub} strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
                  <SvgText x={w - PAD_R_S} y={Math.max(9, refY - 4)} fontSize={8.5} fill={theme.colors.textSub} textAnchor="end">
                    {ref.label}
                  </SvgText>
                  {pts.length > 1 ? (
                    <Polyline
                      points={pts.join(' ')}
                      fill="none"
                      stroke={it.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {pts.map((pt, i) => {
                    const [cx, cy] = pt.split(',');
                    return <Circle key={i} cx={parseFloat(cx)} cy={parseFloat(cy)} r={2.4} fill={it.color} stroke="#FFFFFF" strokeWidth={1} />;
                  })}
                </Svg>
                {isLast ? (
                  <Svg width={w} height={18}>
                    {xLabels.map((xl, i) => (
                      <SvgText key={i} x={xl.x} y={12} fontSize={9} fill={theme.colors.textSub} textAnchor="middle">
                        {xl.label}
                      </SvgText>
                    ))}
                  </Svg>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

/** 轻量 Pressable 行（避免额外 import，内联实现） */
function PressableRow({ active, onPress, children }: { active: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <View>
      <View
        onTouchEnd={onPress}
        style={[styles.segBtn, active && styles.segBtnActive]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(1),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  note: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: mm.colors.inkFaint,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  segBtn: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: theme.radius.sm,
  },
  segBtnActive: {
    backgroundColor: mm.colors.cardBg,
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
  segLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  segLabelActive: {
    color: theme.colors.textTitle,
    fontWeight: theme.weight.semibold,
  },
  panelGap: { marginTop: theme.sp(2.5) },
  panelHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 },
  panelName: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textTitle, marginLeft: 6 },
  panelVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold },
  panelUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 4 },
  empty: {
    height: CHART_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTitle,
    fontWeight: theme.weight.medium,
  },
  emptySub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.sp(2),
    gap: theme.sp(3),
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  legendText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  legendVal: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    marginLeft: 4,
  },
});
