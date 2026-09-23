/**
 * AllDayRecoveryCard —— 首页「全天恢复」卡片（新增，独立组件，不影响既有卡片）
 *
 * 结构（按用户要求）：
 *   上半：睡眠恢复情况 + 皮质醇峰值（两枚毛玻璃指标块）
 *   下半：皮质醇全天趋势图（平滑曲线 + 峰值高亮圆点 + 竖直虚线）
 *   视觉：参考用户提供的渐变卡样式 —— 整卡紫色渐变、白色曲线、底部时间轴
 *
 * 数据口径（与既有皮质醇链路完全一致，不另起一套）：
 *   · collectSamples()           近 14 天逐样本（已剔除零值）
 *   · analyzeCortisol(_, 14)     → cosinor.acrophaseH（峰值时刻）/ amplitude / mesor / css
 *   · buildCortisolToday30()     今日 48 个 30min 槽位（已用 cosinor 补齐到当前时刻，未来时段为 null）
 *   · healthStore.getSleep()     最近一晚睡眠（评分 / 总时长 / 深睡）
 *
 * 曲线三级降级（保证任何时候都有东西可看）：
 *   1) 今日真实样本 ≥ 6 槽  → 画今日真实曲线，角标「今日」
 *   2) 今日稀疏但有 14 天节律 → 用 cosinor 拟合的 14 天日均节律铺满全天，角标「14天节律」
 *   3) 两者都无（新用户/未佩戴）→ 画典型皮质醇节律示意图，角标「示意图」并给出说明
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, {
  Path,
  Circle,
  Line,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { useRingState } from '../hooks/useRingState';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples, buildCortisolToday30 } from './CortisolRhythmCard';

/** 最小可信样本数：与 CortisolRhythmCard / CortisolSleepSummary 保持一致 */
const MIN_SAMPLES = 4;
/** 今日曲线至少要有这么多非空槽位才认为是「真实可画」 */
const MIN_TODAY_SLOTS = 6;
const SLOTS = 48;          // 48 × 30min = 全天
const CHART_H = 120;
const PAD_L = 3;           // ★ 曲线两端贴近 SVG 边缘（时间轴刻度改用 start/end 锚点防截断）
const PAD_R = 3;
const PAD_T = 44;          // ★ 顶部留白加大：峰值圆点 + 时刻标签不再被裁切（含平滑过冲余量）
const PAD_B = 20;          // 底部留白：给时间轴

/**
 * ★ v10 reskin（2026-09-23）：整卡改白卡（SPEC §2 #10）——
 *   白底 + 细描边 + v10 白卡阴影；图表走青色系（ringTeal 线/面积、ringTealDeep 峰值标记）。
 *   标题行加青色胶囊 badge（数值来自真实睡眠评分）；底部解读行 = 色点 + 加粗结论 + 灰色说明。
 *   注：SPEC 里的「虚线目标线」无对应真实目标值，按数据铁律不上（不编造基线）。
 */

/** 最近一晚睡眠：优先今天，其次昨天（跨午夜睡眠可能记在前一日） */
function latestSleep(): SleepSummary | null {
  for (let i = 0; i < 2; i++) {
    const s = healthStore.getSleep(dayKey(Date.now() - i * 86400000));
    if (s) return s;
  }
  return null;
}

function fmtDur(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function fmtClock(hourFloat: number): string {
  if (!Number.isFinite(hourFloat)) return '—';
  const h = Math.round(hourFloat) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

/** 典型皮质醇昼夜节律示意（无真实数据时用）：凌晨最低 → 6-9 点陡升达峰 → 日间缓降 → 午后小峰 → 夜间低平 */
function demoCurve(): number[] {
  return Array.from({ length: SLOTS }, (_, i) => {
    const h = i / 2;
    const morning = 78 * Math.exp(-Math.pow((h - 8.4) / 2.5, 2));
    const afternoon = 20 * Math.exp(-Math.pow((h - 16.6) / 3.2, 2));
    const nightFloor = 10;
    return nightFloor + morning + afternoon;
  });
}

/** Catmull-Rom → 三次贝塞尔：把折线转成平滑曲线 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function AllDayRecoveryCard({ onPress, ring: ringProp }: { onPress?: () => void; ring?: any }) {
  const ring = ringProp ?? useRingState();
  const [W, setW] = useState(0);

  // —— 睡眠恢复 ——
  const sleep = useMemo(() => latestSleep(), [ring.sleepDaily, Date.now() & 0]);
  const sleepScore = sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  const sleepValue = sleepScore != null ? String(sleepScore) : fmtDur(sleep?.total);
  const sleepUnit = sleepScore != null ? '分' : '时长';
  const sleepSub =
    sleep == null
      ? '暂无睡眠数据'
      : `睡眠 ${fmtDur(sleep.total)} · 深睡 ${fmtDur(sleep.deep)}`;

  // —— 皮质醇 ——
  const samples = useMemo(() => collectSamples(), [ring.curveStatus]);
  const r = useMemo(() => analyzeCortisol(samples, 14), [samples]);
  const cos = r.cosinor;
  const hasRhythm =
    Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && Number.isFinite(cos.acrophaseH) && cos.amplitude > 0;

  const peakClock = hasRhythm ? fmtClock(cos.acrophaseH) : '—';
  const ampPct = hasRhythm && cos.mesor > 0 ? Math.round((cos.amplitude / cos.mesor) * 100) : null;
  const recoveryWord =
    samples.length < MIN_SAMPLES
      ? '数据不足'
      : r.css > 10
        ? '恢复良好'
        : r.css < -10
          ? '偏晚'
          : cos.amplitude < 0.15 * cos.mesor
            ? '节律偏平'
            : '一般';
  const cortisolSub = hasRhythm
    ? `${ampPct != null ? `波动 ${ampPct}%` : '节律已建模'} · ${recoveryWord}`
    : '佩戴后生成节律';

  // ★ 青色 badge（SPEC #10「82% · 接近目标」）：数值 = 真实睡眠评分，档位词由评分推导
  const badgeWord =
    sleepScore == null ? '待数据' : sleepScore >= 80 ? '接近目标' : sleepScore >= 60 ? '恢复中' : '恢复偏弱';
  const badgeText = sleepScore != null ? `${sleepScore}% · ${badgeWord}` : badgeWord;

  // —— 曲线数据（三级降级）——
  const { series, mode } = useMemo<{ series: number[]; mode: 'today' | 'rhythm' | 'demo' }>(() => {
    const today = buildCortisolToday30();                       // 48 槽，尾段为 null
    const todayNonNull = today.filter((v) => v != null).length;
    if (todayNonNull >= MIN_TODAY_SLOTS) {
      // 只截到最后一个有效值 — 未来时段不画
      const lastIdx = today.findIndex((v, i) => i > 0 && v == null && today[i - 1] != null);
      const truncate: number[] = (lastIdx > 0 ? today.slice(0, lastIdx) : today.filter((v) => v != null)) as number[];
      return { series: truncate, mode: 'today' };
    }
    if (samples.length >= MIN_SAMPLES && hasRhythm) {
      const TWO_PI = Math.PI * 2;
      return {
        series: Array.from({ length: SLOTS }, (_, i) =>
          Math.max(0, cos.mesor + cos.amplitude * Math.cos((TWO_PI * (i / 2 - cos.acrophaseH)) / 24)),
        ),
        mode: 'rhythm',
      };
    }
    return { series: demoCurve(), mode: 'demo' };
  }, [samples.length, hasRhythm, cos.mesor, cos.amplitude, cos.acrophaseH, ring.timelineReady ?? ring.curveStatus]);

  // —— 坐标换算 ——
  const chartW = Math.max(40, W - PAD_L - PAD_R);
  const chartH = CHART_H - PAD_T - PAD_B;
  // ★ 圆弧平滑：先做 (1,2,1)/4 加权滑动平均柔化尖峰/深谷（峰值位置基本不变），
  //   再走 Catmull-Rom → 贝塞尔，消除 11:00 那种生硬的 V 形折角
  const sm = series.map((v, i) => {
    const a = series[i - 1] ?? v;
    const c = series[i + 1] ?? v;
    return (a + 2 * v + c) / 4;
  });
  const lo = Math.min(...sm);
  const hi = Math.max(...sm);
  const span = hi - lo || 1;
  const yLo = lo - span * 0.18;
  const yHi = hi + span * 0.18;
  const yOf = (v: number) => PAD_T + chartH - ((v - yLo) / (yHi - yLo)) * chartH;
  const xOf = (i: number) => PAD_L + (i / (SLOTS - 1)) * chartW;

  const pts = sm.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const linePath = smoothPath(pts);
  // ★ 面积填充在「最后一个数据点」收口：今日模式曲线只画到当前时刻时，
  //   填充不再斜插到 24:00 右下角，避免右侧出现一块无曲线的悬空渐变
  const lastDataX = xOf(series.length - 1);
  const areaPath = linePath
    ? `${linePath} L ${lastDataX.toFixed(1)} ${(PAD_T + chartH).toFixed(1)} L ${PAD_L.toFixed(1)} ${(PAD_T + chartH).toFixed(1)} Z`
    : '';

  // ★ 修复错位：hi 是「平滑后」数组的最大值，必须在 sm 里找下标；
  //   之前在原始 series 里 indexOf 找不到（平滑已改值）→ 返回 -1，峰值点/虚线/时刻标签全部错位
  const peakIdx = Math.max(0, sm.indexOf(hi));
  const peakX = xOf(peakIdx);
  const peakY = yOf(hi);

  const body = (
    <View style={styles.wrap}>
      <View style={styles.inner}>
        {/* 卡片标题 + 青色胶囊 badge */}
        <View style={styles.headRow}>
          <Text style={styles.title}>全天恢复</Text>
          <View style={styles.headRight}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeText}</Text>
            </View>
            <Icon name="chevronRight" size={18} color={mm.colors.inkFaint} />
          </View>
        </View>

        {/* 上半：睡眠恢复情况 / 皮质醇峰值 */}
        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>睡眠恢复</Text>
            <View style={styles.tileValRow}>
              <Text style={styles.tileVal} numberOfLines={1} adjustsFontSizeToFit>
                {sleepValue}
              </Text>
              <Text style={styles.tileUnit}>{sleepUnit}</Text>
            </View>
            <Text style={styles.tileSub} numberOfLines={2}>
              {sleepSub}
            </Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>皮质醇峰值</Text>
            <View style={styles.tileValRow}>
              <Text style={styles.tileVal} numberOfLines={1} adjustsFontSizeToFit>
                {peakClock}
              </Text>
              <Text style={styles.tileUnit}>点</Text>
            </View>
            <Text style={styles.tileSub} numberOfLines={2}>
              {cortisolSub}
            </Text>
          </View>
        </View>

        {/* 下半：皮质醇全天趋势（落在卡片渐变的深色区，曲线走白色） */}
        <View style={styles.chartBox} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {W > 0 ? (
            <Svg width={W} height={CHART_H}>
              <Defs>
                {/* 曲线下方渐变填充（纯白 token + 渐变透明度） */}
                <SvgLinearGradient id="adrArea" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={mm.colors.ringTeal} stopOpacity="0.34" />
                  <Stop offset="100%" stopColor={mm.colors.ringTeal} stopOpacity="0.02" />
                </SvgLinearGradient>
                {/* 峰值圆点外发光 */}
              </Defs>

              {/* 基线（时间轴底线） */}
              <Line
                x1={PAD_L}
                y1={PAD_T + chartH}
                x2={PAD_L + chartW}
                y2={PAD_T + chartH}
                stroke={mm.colors.ringTealDeep}
                strokeOpacity={0.25}
                strokeWidth={1}
              />

              {/* 曲线下方填充 + 平滑曲线 */}
              {areaPath ? <Path d={areaPath} fill="url(#adrArea)" /> : null}
              {linePath ? (
                <Path
                  d={linePath}
                  fill="none"
                  stroke={mm.colors.ringTeal}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={mode === 'demo' ? 0.75 : 1}
                />
              ) : null}

              {/* 峰值：竖直虚线 + 发光圆点 + 时刻标签 */}
              <Line
                x1={peakX}
                y1={peakY}
                x2={peakX}
                y2={PAD_T + chartH}
                stroke={mm.colors.ringTealDeep}
                strokeOpacity={0.42}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Circle cx={peakX} cy={peakY} r={4.2} fill={mm.colors.ringTealDeep} />
              <SvgText
                x={Math.min(Math.max(peakX, PAD_L + 16), PAD_L + chartW - 16)}
                y={Math.max(peakY - 12, 12)}
                fontSize={11}
                fontWeight="600"
                fill={mm.colors.ringTealDeep}
                textAnchor="middle"
              >
                {fmtClock(peakIdx / 2)}
              </SvgText>

              {/* 时间轴 00 / 06 / 12 / 18 / 24（两端刻度改 start/end 锚点，贴边不截断） */}
              {[0, 6, 12, 18, 24].map((h) => {
                const slot = Math.min(h * 2, SLOTS - 1);
                const edgeL = h === 0;
                const edgeR = h === 24;
                return (
                  <SvgText
                    key={h}
                    x={edgeL ? PAD_L + 1 : edgeR ? PAD_L + chartW - 1 : xOf(slot)}
                    y={CHART_H - 4}
                    fontSize={9.5}
                    fill={mm.colors.inkFaint}
                    textAnchor={edgeL ? 'start' : edgeR ? 'end' : 'middle'}
                  >
                    {String(h).padStart(2, '0')}
                  </SvgText>
                );
              })}
            </Svg>
          ) : (
            <View style={{ height: CHART_H }} />
          )}
        </View>

        {/* v10 解读行：色点 + 加粗结论 + 灰色说明（全部来自真实数据口径） */}
        <View style={styles.keyRow}>
          <View style={[styles.keyDot, { backgroundColor: mm.colors.ringTeal }]} />
          <View style={styles.keyTx}>
            <Text style={styles.keyBold} numberOfLines={1}>
              {mode === 'demo' ? '节律示意' : recoveryWord}
            </Text>
            <Text style={styles.keySub} numberOfLines={1}>
              {mode === 'demo'
                ? '戴上戒指后显示你的真实皮质醇趋势'
                : mode === 'rhythm'
                  ? `近 14 天日均拟合 · ${cortisolSub}`
                  : `今日真实趋势 · ${cortisolSub}`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // v10 白卡：白底 + 细描边 + v10 卡片阴影
  wrap: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card,
    overflow: 'hidden',
    marginTop: 0,
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
  },
  inner: { padding: theme.space.cardPad },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  // 青色胶囊 badge（chipBg.cyan 对）
  badge: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.chipBg.cyan.bg,
  },
  badgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: mm.chipBg.cyan.fg,
  },
  // 底部解读行（SPEC #10）：8px 色点 + 加粗结论 + 灰说明
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1.5),
    marginTop: theme.sp(0.5),
  },
  keyDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill },
  keyTx: { flex: 1 },
  keyBold: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.bold,
    color: mm.colors.ink,
  },
  keySub: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginTop: 1,
  },
  modePill: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  modePillText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInkSoft,
  },
  // ★ craft floor：卡片套卡片永远是错的 → 指标块不再套白卡，用留白分组
  tiles: { flexDirection: 'row', gap: theme.space.lg },
  tile: { flex: 1 },
  tileLabel: {
    fontSize: theme.fontSize.micro,
    // 彩色底上不能用中性灰，改用紫调中性色（从色相里染色）
    color: mm.colors.inkSoft,
    marginBottom: theme.sp(0.75),
  },
  tileValRow: { flexDirection: 'row', alignItems: 'baseline' },
  tileVal: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    flexShrink: 1,
  },
  tileUnit: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginLeft: theme.sp(0.75),
  },
  tileSub: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.75),
  },
  // 曲线区：落在卡片的深色段上（靠下方，给足上边距把曲线推进紫色区）
  chartBox: { marginTop: theme.space.lg },
  caption: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.5),
  },
});
