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
  RadialGradient,
  Stop,
  Text as SvgText,
  G,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples, buildCortisolToday30 } from './CortisolRhythmCard';

/** 最小可信样本数：与 CortisolRhythmCard / CortisolSleepSummary 保持一致 */
const MIN_SAMPLES = 4;
/** 今日曲线至少要有这么多非空槽位才认为是「真实可画」 */
const MIN_TODAY_SLOTS = 6;
const SLOTS = 48;          // 48 × 30min = 全天
const CHART_H = 120;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 30;          // 顶部留白：给峰值文字标签
const PAD_B = 20;          // 底部留白：给时间轴

/**
 * 卡片渐变 —— 全部取 design token，不写裸色值（theme.ts 是唯一真相源）：
 *   · 起点 colors.accentSolid        #7C6AE0  主色（与 Chip 渐变起点一致）
 *   · 中段 colors.ui.chipGradEnd     #6E86E8  Chip 渐变端色（项目既有「渐变胶囊」约定）
 *   · 末端 colors.accent2            #7EA6F8  次色 / AI 渐变端色（aiBadgeGrad[1]）
 * 走向与 Chip / AiBadge 一致：左上 → 右下。
 * 不直接用 colors.bgGradStops（页面背景渐变，末端 #F7F5FE 过浅，白字白曲线读不出来）。
 */
const CARD_GRAD = [
  theme.colors.accentSolid,
  theme.colors.ui.chipGradEnd,
  theme.colors.accent2,
] as const;

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

export default function AllDayRecoveryCard({ onPress }: { onPress?: () => void }) {
  const [W, setW] = useState(0);

  // —— 睡眠恢复 ——
  const sleep = useMemo(() => latestSleep(), []);
  const sleepScore = sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  const sleepValue = sleepScore != null ? String(sleepScore) : fmtDur(sleep?.total);
  const sleepUnit = sleepScore != null ? '分' : '时长';
  const sleepSub =
    sleep == null
      ? '暂无睡眠数据'
      : `睡眠 ${fmtDur(sleep.total)} · 深睡 ${fmtDur(sleep.deep)}`;

  // —— 皮质醇 ——
  const samples = useMemo(() => collectSamples(), []);
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

  // —— 曲线数据（三级降级）——
  const { series, mode } = useMemo<{ series: number[]; mode: 'today' | 'rhythm' | 'demo' }>(() => {
    const today = buildCortisolToday30();                       // 48 槽，尾段为 null
    const todayNonNull = today.filter((v) => v != null).length;
    if (todayNonNull >= MIN_TODAY_SLOTS) {
      // 尾部 null 用前一个有效值延续，图面更完整（不画预测）
      const last = today.filter((v): v is number => v != null).slice(-1)[0] ?? 0;
      return { series: today.map((v) => v ?? last), mode: 'today' };
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
  }, [samples.length, hasRhythm, cos.mesor, cos.amplitude, cos.acrophaseH]);

  const modeLabel = mode === 'today' ? '今日' : mode === 'rhythm' ? '14 天节律' : '示意图';

  // —— 坐标换算 ——
  const chartW = Math.max(40, W - PAD_L - PAD_R);
  const chartH = CHART_H - PAD_T - PAD_B;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  const yLo = lo - span * 0.18;
  const yHi = hi + span * 0.18;
  const yOf = (v: number) => PAD_T + chartH - ((v - yLo) / (yHi - yLo)) * chartH;
  const xOf = (i: number) => PAD_L + (i / (SLOTS - 1)) * chartW;

  const pts = series.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const linePath = smoothPath(pts);
  const areaPath = linePath
    ? `${linePath} L ${xOf(SLOTS - 1).toFixed(1)} ${(PAD_T + chartH).toFixed(1)} L ${PAD_L.toFixed(1)} ${(PAD_T + chartH).toFixed(1)} Z`
    : '';

  const peakIdx = series.indexOf(hi);
  const peakX = xOf(peakIdx);
  const peakY = yOf(hi);

  const body = (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[...CARD_GRAD] as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* 右上角柔光，制造渐变卡的体积感 */}
      <View style={styles.glowBlob} pointerEvents="none" />

      <View style={styles.inner}>
        {/* 卡片标题 */}
        <View style={styles.headRow}>
          <Text style={styles.title}>全天恢复</Text>
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>{modeLabel}</Text>
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
            <Text style={styles.tileSub} numberOfLines={1}>
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
            <Text style={styles.tileSub} numberOfLines={1}>
              {cortisolSub}
            </Text>
          </View>
        </View>

        {/* 下半：皮质醇全天趋势 */}
        <View style={styles.chartBox} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {W > 0 ? (
            <Svg width={W} height={CHART_H}>
              <Defs>
                {/* 曲线下方渐变填充（纯白 token + 渐变透明度） */}
                <SvgLinearGradient id="adrArea" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={theme.colors.textWhite} stopOpacity="0.38" />
                  <Stop offset="100%" stopColor={theme.colors.textWhite} stopOpacity="0.02" />
                </SvgLinearGradient>
                {/* 峰值圆点外发光 */}
                <RadialGradient id="adrDotGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={theme.colors.textWhite} stopOpacity="0.55" />
                  <Stop offset="100%" stopColor={theme.colors.textWhite} stopOpacity="0" />
                </RadialGradient>
              </Defs>

              {/* 基线（时间轴底线） */}
              <Line
                x1={PAD_L}
                y1={PAD_T + chartH}
                x2={PAD_L + chartW}
                y2={PAD_T + chartH}
                stroke={theme.colors.textWhite}
                strokeOpacity={0.35}
                strokeWidth={1}
              />

              {/* 曲线下方填充 + 平滑曲线 */}
              {areaPath ? <Path d={areaPath} fill="url(#adrArea)" /> : null}
              {linePath ? (
                <Path
                  d={linePath}
                  fill="none"
                  stroke={theme.colors.textWhite}
                  strokeWidth={2.4}
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
                stroke={theme.colors.textWhite}
                strokeOpacity={0.5}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Circle cx={peakX} cy={peakY} r={11} fill="url(#adrDotGlow)" />
              <Circle cx={peakX} cy={peakY} r={4.2} fill={theme.colors.textWhite} />
              <SvgText
                x={Math.min(Math.max(peakX, PAD_L + 16), PAD_L + chartW - 16)}
                y={Math.max(peakY - 12, 12)}
                fontSize={11}
                fontWeight="600"
                fill={theme.colors.textWhite}
                textAnchor="middle"
              >
                {fmtClock(peakIdx / 2)}
              </SvgText>

              {/* 时间轴 00 / 06 / 12 / 18 / 24 */}
              {[0, 6, 12, 18, 24].map((h) => {
                const slot = Math.min(h * 2, SLOTS - 1);
                return (
                  <SvgText
                    key={h}
                    x={xOf(slot)}
                    y={CHART_H - 4}
                    fontSize={9.5}
                    fill={theme.colors.textWhite}
                    fillOpacity={0.85}
                    textAnchor="middle"
                  >
                    {h === 24 ? '24' : String(h).padStart(2, '0')}
                  </SvgText>
                );
              })}
            </Svg>
          ) : (
            <View style={{ height: CHART_H }} />
          )}
        </View>

        <Text style={styles.caption}>
          {mode === 'demo'
            ? '皮质醇全天节律 · 示意曲线，戴上戒指后显示你的真实趋势'
            : mode === 'rhythm'
              ? '皮质醇全天节律 · 近 14 天日均拟合，今日样本累积后会更贴合'
              : '皮质醇全天节律 · 今日真实趋势'}
        </Text>
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
  wrap: {
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    marginTop: theme.space.md,
  },
  glowBlob: {
    position: 'absolute',
    right: -theme.sp(12),
    top: -theme.sp(14),
    width: theme.sp(40),
    height: theme.sp(40),
    borderRadius: theme.sp(20),
    // 柔光球：白 token + 透明度（不用裸 rgba）
    backgroundColor: theme.colors.textWhite,
    opacity: 0.16,
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
    color: theme.colors.textWhite,
  },
  modePill: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.ui.white25,
  },
  modePillText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite80,
  },
  tiles: { flexDirection: 'row', gap: theme.space.sm },
  tile: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
    // 毛玻璃块：白 token + 描边用 cardBorder2（项目既有的白色半透明描边 token）
    backgroundColor: theme.colors.ui.white25,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder2,
  },
  tileLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textWhite80,
    marginBottom: theme.sp(0.5),
  },
  tileValRow: { flexDirection: 'row', alignItems: 'baseline' },
  tileVal: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
    flexShrink: 1,
  },
  tileUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textWhite70,
    marginLeft: theme.sp(0.75),
  },
  tileSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textWhite70,
    marginTop: theme.sp(0.5),
  },
  chartBox: { marginTop: theme.space.sm },
  caption: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textWhite70,
    marginTop: theme.sp(0.5),
  },
});
