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

  const lines = seriesList.map((s, idx) => {
    const def = LIPIDS[idx];
    const pts: { x: number; y: number }[] = [];
    if (mode === 'cont' && s.continuous && s.tPoints) {
      for (const p of s.tPoints) {
        if (!Number.isFinite(p.v)) continue;
        pts.push({ x: xAtT(p.t), y: yAt(p.v) });
      }
    } else {
      s.points.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) return;
        pts.push({ x: xAtI(i), y: yAt(v) });
      });
    }
    return { ...def, pts };
  });

  const hasData = lines.some((l) => l.pts.length > 0);

  // X 轴标签位置（避免过密）
  const xLabels: { x: number; label: string }[] = [];
  if (mode === 'cont') {
    const steps = [0, 0.25, 0.5, 0.75, 1];
    for (const f of steps) {
      const t = domMin + f * (domMax - domMin);
      const d = new Date(t);
      xLabels.push({ x: PAD_L + f * plotW, label: `${String(d.getHours()).padStart(2, '0')}:00` });
    }
  } else if (n > 0) {
    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      xLabels.push({ x: xAtI(i), label: axisLabels[i] ?? '' });
    }
    if ((n - 1) % step !== 0) xLabels.push({ x: xAtI(n - 1), label: axisLabels[n - 1] ?? '' });
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
      <Text style={[styles.note, { marginBottom: theme.sp(2) }]}>
        共享 0–10 mmol/L 坐标轴 · 不同颜色 = 不同指标 · 缺口 = 当日无测量
      </Text>

      {!hasData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>该时间范围内暂无血脂测量记录</Text>
          <Text style={styles.emptySub}>在「身体成分 / 血液成分」录入血脂后，这里会显示四项随时间的变化</Text>
        </View>
      ) : (
        <View onLayout={onLayout}>
          <Svg width={w} height={CHART_H}>
            {/* Y 轴网格 + 刻度 */}
            {Y_TICKS.map((t) => {
              const y = yAt(t);
              return (
                <G key={`y${t}`}>
                  <SvgLine x1={PAD_L} y1={y} x2={w - PAD_R} y2={y} stroke="#ECECEC" strokeWidth={1} />
                  <SvgText x={PAD_L - 6} y={y + 3} fontSize={9} fill={theme.colors.textSub} textAnchor="end">
                    {t}
                  </SvgText>
                </G>
              );
            })}
            {/* 四条线 */}
            {lines.map((l) => (
              <G key={l.key}>
                {l.pts.length > 1 ? (
                  <Polyline
                    points={l.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : null}
                {l.pts.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={2.6} fill={l.color} stroke="#FFFFFF" strokeWidth={1} />
                ))}
              </G>
            ))}
            {/* X 轴标签 */}
            {xLabels.map((xl, i) => (
              <SvgText key={i} x={xl.x} y={CHART_H - 8} fontSize={9} fill={theme.colors.textSub} textAnchor="middle">
                {xl.label}
              </SvgText>
            ))}
          </Svg>
        </View>
      )}

      {/* 图例（含各项最新值，四指标一图到底） */}
      <View style={styles.legend}>
        {LIPIDS.map((it, i) => {
          const s = seriesList[i];
          const latest = s?.continuous && s.tPoints?.length
            ? s.tPoints[s.tPoints.length - 1].v
            : (() => {
                for (let k = (s?.points.length ?? 0) - 1; k >= 0; k--) {
                  const v = s!.points[k];
                  if (v != null && Number.isFinite(v)) return v;
                }
                return null;
              })();
          return (
            <View key={it.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: it.color }]} />
              <Text style={styles.legendText}>{it.short}</Text>
              <Text style={[styles.legendVal, { color: it.color }]}>
                {latest != null ? latest.toFixed(2) : '—'}
              </Text>
            </View>
          );
        })}
      </View>
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
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  segLabelActive: {
    color: theme.colors.textTitle,
    fontWeight: theme.weight.semibold,
  },
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
