/**
 * HormoneDualTrend —— 雌激素 + 孕激素「合在一起」的双相趋势图。
 *
 * ★ 2026-10-12（用户三条）：
 *   ① 横轴改为「周期天锚定」——第 1 天 = 上次经期开始日 → 第 N 天（N = max(周期长度, 今天所在天)），
 *      与周期日历页（CycleCalendarScreen·TrendCard）完全同一口径（lib/hormoneTrend 的 cycleAxis）；
 *      无经期记录时退回滚动 30 天窗口（老行为，轴标签切回纯日期）。
 *   ② 横坐标双行：上面「第 N 天」，下面该周期天对应的真实日期（M/D）。
 *   ③ 图例从图上方移到图下方；标题右侧标注窗口口径 + 「推算 · 非实测」。
 * ★ 2026-10-12（用户追加两条）：
 *   ④ 「雌激素的波形看得不是特别明显」→ 雌激素线由淡黄绿 limeCore #D5E384 加深为
 *      同色系深档 limeDeep #6E7A24，白卡与四相浅色带上都清晰；
 *   ⑤ 「只展示雌激素，孕激素先不展示」→ onlyEstrogen：孕激素的数据/曲线/圆点/图例
 *      全部不渲染，标题与图例同步收为雌激素单项；底部说明句按用户要求删除。
 *
 * 复用 lib/hormoneTrend 的 buildEstrogenData（真实数据推算）：
 *   · 雌激素（深橄榄绿）：戒指实测 HRV·EDA 推算
 * 曲线叠画在周期天轴上，背景按四相位色带铺满整轴，今天画一条虚线标记。
 *
 * 说明口径（与周期日历页激素卡一致）：信号基座来自成熟方法/已发表研究；组合权重与
 * 0–100 归一化是自研启发式。本组件不重复写算法，只负责「把两条真实推算曲线画一起」。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Line } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import { parseDate, type CycleInfo, type CycleLog } from '../lib/cycleMath';
import { phaseBand } from '../lib/phaseColors';
import { buildEstrogenData, buildProgesteroneData, cycleAxis, phaseOfDay, type TrendRange } from '../lib/hormoneTrend';
import type { RingState } from '../ble/RingBleManager';

/** ★ 2026-10-21（用户：皮质醇等趋势线是亮色，生理周期这条却偏暗，要调亮一致）：
 *  雌激素线由深橄榄绿 limeDeep #6E7A24 改回亮黄绿 limeMid #BCCB62（与皮质醇亮绿同家族，深色玻璃卡上更跳）；
 *  孕激素由 accentSolid #7C6AE0 改为亮薰衣草紫 purpleCore #9D8AF0。
 *  背景四相色带仅 0.14~0.2 透明度，叠在深色玻璃卡上整体仍偏暗，亮线可清晰浮起。 */
const EST_COLOR = mm.colors.limeMid; // 亮黄绿 #BCCB62（与皮质醇 series.cortisol 同家族）
const PROG_COLOR = mm.colors.purpleCore; // 亮薰衣草紫 #9D8AF0（onlyEstrogen 时不画，保留常量备用）
const RANGE: TrendRange = 'month';

type Pt = { x: number; y: number; date: string };

function makePath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

export default function HormoneDualTrend({
  ring,
  cycleInfo,
  log,
  embedded,
  onlyEstrogen,
}: {
  ring: RingState;
  cycleInfo: CycleInfo | null;
  log: CycleLog | null;
  /** ★ 2026-10-12（用户：洞察页「雌激素孕激素不要写文字，就画趋势图」）：
   *  嵌入宿主卡内（CyclePhaseCard）——去掉外层卡片壳/margin，标题精简为「雌激素 · 孕激素」。 */
  embedded?: boolean;
  /** ★ 2026-10-12（用户：「只展示雌激素，孕激素先不展示」）：
   *  true = 只画雌激素一条线；孕激素的数据/曲线/圆点/渐变/图例全部不渲染，
   *  标题与图例同步收为雌激素单项。缺省 false（双线，行为不变）。 */
  onlyEstrogen?: boolean;
}) {
  // ★ 2026-10-12：横轴 = 周期天锚定（第 1 天 = 上次经期开始日）；无经期记录退回滚动 30 天
  const axis = useMemo(() => cycleAxis(log), [log]);
  const win = useMemo(() => {
    if (axis) return { startMs: axis.startMs, days: axis.days };
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime() - 29 * 86_400_000, days: 30 };
  }, [axis]);
  // 数据窗口与横轴同源（周期窗口下 ≥2 个真实点即画线，见 buildEstrogenData 注释）
  const estData = useMemo(
    () => buildEstrogenData(ring, RANGE, { startMs: win.startMs, days: win.days }),
    [ring, win],
  );
  // ★ 2026-10-12（用户：只展示雌激素）：onlyEstrogen 时不算孕激素数据
  const progData = useMemo(
    () =>
      onlyEstrogen
        ? null
        : buildProgesteroneData(ring, cycleInfo, RANGE, { startMs: win.startMs, days: win.days }),
    [onlyEstrogen, ring, cycleInfo, win],
  );
  const est = estData.real;
  const prog = progData?.real ?? null;

  const W = 680;
  const H = chart.h.m;   // ★ 规范：150 → M 档 180
  const PAD = 10;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const yAt = (v: number) => PAD + (1 - v / 100) * plotH;

  // 横坐标：周期天（第 1 天 → 第 N 天）；回退窗口下用日期定位
  const axisN = win.days;
  const xAtCd = (cd: number) => PAD + ((cd - 1) / Math.max(1, axisN - 1)) * plotW;
  const cdOfDate = (date: string) => Math.round((parseDate(date).getTime() - win.startMs) / 86_400_000) + 1;
  const dateOfCd = (cd: number) => {
    const dt = new Date(win.startMs + (cd - 1) * 86_400_000);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  const estPts: Pt[] = useMemo(
    () => (est ?? [])
      .map((p) => ({ x: xAtCd(cdOfDate(p.date)), y: yAt(p.value), date: p.date }))
      .filter((p) => cdOfDate(p.date) >= 1 && cdOfDate(p.date) <= axisN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [est, win.startMs, axisN],
  );
  const progPts: Pt[] = useMemo(
    () => (prog ?? [])
      .map((p) => ({ x: xAtCd(cdOfDate(p.date)), y: yAt(p.value), date: p.date }))
      .filter((p) => cdOfDate(p.date) >= 1 && cdOfDate(p.date) <= axisN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prog, win.startMs, axisN],
  );

  const estPath = makePath(estPts);
  const progPath = makePath(progPts);

  // 四相背景带：逐日判相位、同色相邻合并、铺满整轴（无数据也画）——与周期日历页 TrendCard 同一画法
  const bands = useMemo(() => {
    const out: { x: number; w: number; color: string }[] = [];
    for (let cd = 1; cd <= axisN; cd++) {
      const color = phaseBand(log ? phaseOfDay(log, new Date(win.startMs + (cd - 1) * 86_400_000), ring) : 'unknown');
      const x0 = xAtCd(cd);
      const x1 = cd < axisN ? xAtCd(cd + 1) : PAD + plotW;
      const prev = out[out.length - 1];
      if (prev && prev.color === color) prev.w += Math.max(0, x1 - x0);
      else out.push({ x: x0, w: Math.max(0, x1 - x0), color });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, ring, win.startMs, axisN]);

  // 今天 · 第 N 天：虚线标记（仅周期轴模式；回退窗口无 todayDay 不画）
  const todayCd = axis?.todayDay ?? null;
  const showToday = todayCd != null && todayCd >= 1 && todayCd <= axisN;

  // 横坐标刻度：¼ 分位 5 个。周期轴 = 双行（上「第 N 天」/ 下日期）；回退窗口 = 单行日期
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(1 + (axisN - 1) * f));

  const hasAny = (est && est.length > 0) || (prog && prog.length > 0);

  return (
    <View style={[styles.card, embedded && styles.cardEmbedded]}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {onlyEstrogen ? '雌激素' : embedded ? '雌激素 · 孕激素' : '雌激素 · 孕激素 双相趋势'}
        </Text>
        {/* ★ 2026-10-12：口径随轴走——周期轴报「第 1–N 天」，回退窗口报「近 30 天」；均标注推算·非实测 */}
        <Text style={styles.sub}>{axis ? `第 1–${axis.days} 天 · 推算 · 非实测` : '近 30 天 · 推算 · 非实测'}</Text>
      </View>

      {!hasAny ? (
        <Text style={styles.note}>
          {onlyEstrogen
            ? '连续佩戴获取 HRV 与心率后，这里会显示雌激素的推算趋势：卵泡期逐步爬升、排卵前后达峰。戒指不直接测量激素，均为推算。'
            : '连续佩戴获取 HRV、心率、体温与静息心率后，这里会显示雌激素与孕激素叠加的双相趋势：卵泡期雌激素爬升、排卵后孕激素抬升。戒指不直接测量激素，均为推算。'}
        </Text>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="dualEstGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={EST_COLOR} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={EST_COLOR} stopOpacity={0.02} />
              </LinearGradient>
              {!onlyEstrogen ? (
                <LinearGradient id="dualProgGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={PROG_COLOR} stopOpacity={0.18} />
                  <Stop offset="100%" stopColor={PROG_COLOR} stopOpacity={0.02} />
                </LinearGradient>
              ) : null}
            </Defs>
            {bands.map((b, i) => (
              <Rect key={`b${i}`} x={b.x} y={PAD} width={b.w} height={plotH} fill={b.color} />
            ))}
            {/* 今天虚线：圈出「当前在周期里的位置」 */}
            {showToday ? (
              <Line
                x1={xAtCd(todayCd as number)}
                y1={PAD}
                x2={xAtCd(todayCd as number)}
                y2={PAD + plotH}
                stroke={theme.colors.accentText}
                strokeWidth={1.2}
                strokeDasharray="4 4"
                opacity={0.65}
              />
            ) : null}
            {estPath ? <Path d={`${estPath} L ${estPts[estPts.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${estPts[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`} fill="url(#dualEstGrad)" /> : null}
            {!onlyEstrogen && progPath ? <Path d={`${progPath} L ${progPts[progPts.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${progPts[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`} fill="url(#dualProgGrad)" /> : null}
            {/* ★ 2026-10-20（用户：「生理周期节律下面那卡片，点圆圈不应该有，去掉」）：
                移除每个数据点的实心圆点，只保留平滑曲线；线宽 2.4 → 3 提升清晰度。 */}
            {!onlyEstrogen && progPath ? <Path d={progPath} fill="none" stroke={PROG_COLOR} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null}
            {estPath ? <Path d={estPath} fill="none" stroke={EST_COLOR} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null}
          </Svg>

          {/* ★ 2026-10-12：横坐标双行——上「第 N 天」/ 下对应日期（周期轴）；回退窗口单行日期 */}
          {axis ? (
            <View style={styles.axis}>
              {ticks.map((cd, i) => (
                <View key={`t-${cd}-${i}`} style={styles.axisCol}>
                  <Text style={styles.axisText}>第 {cd} 天</Text>
                  <Text style={styles.axisDate}>{dateOfCd(cd)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.axis}>
              {ticks.map((cd, i) => (
                <Text key={`t-${cd}-${i}`} style={styles.axisText}>{dateOfCd(cd)}</Text>
              ))}
            </View>
          )}

          {/* ★ 2026-10-12（用户：「图例放在图下面」）：图例从图上方移到图下方；
              onlyEstrogen 时只留雌激素一项。 */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: EST_COLOR }]} />
              <Text style={styles.legendText}>雌激素（HRV·心率）</Text>
            </View>
            {!onlyEstrogen ? (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: PROG_COLOR }]} />
                <Text style={styles.legendText}>孕激素（体温·心率）</Text>
              </View>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.md,
  },
  /* ★ 2026-10-12：embedded 嵌入宿主卡（CyclePhaseCard）——外壳让位给宿主 */
  cardEmbedded: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    marginTop: 0,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  sub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  /* ★ 2026-10-12：横坐标双行（上：第 N 天 / 下：日期） */
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.sp(1),
  },
  axisCol: { alignItems: 'center' },
  axisText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  axisDate: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.space.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: theme.space.md,
  },
  legendDot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.sp(1.25),
    marginRight: theme.sp(1.5),
  },
  legendText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
  },
});
