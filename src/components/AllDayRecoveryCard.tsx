/**
 * AllDayRecoveryCard —— 首页「昼夜节律」卡片（v18.96 由「全天恢复」更名：内容本就是皮质醇昼夜曲线）
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
import { MindIcon } from './MindIcons';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { useRingState } from '../hooks/useRingState';
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples, buildCortisolToday30Ex } from './CortisolRhythmCard';

/** 最小可信样本数：与 CortisolRhythmCard / CortisolSleepSummary 保持一致 */
const MIN_SAMPLES = 4;
/** 今日曲线至少要有这么多非空槽位才认为是「真实可画」 */
const MIN_TODAY_SLOTS = 6;
const SLOTS = 48;          // 48 × 30min = 全天
const CHART_H = 96;        // ★ v18.60：54→96（用户：趋势图纵坐标高度太小——原 54-20-20=14pt 曲线振幅几乎贴平）
const PAD_L = 3;           // ★ 曲线两端贴近 SVG 边缘（时间轴刻度改用 start/end 锚点防截断）
const PAD_R = 3;
const PAD_T = 18;          // ★ v18.60：20→18（峰值点+标签仍不裁切）
const PAD_B = 18;          // 底部留白：给时间轴 → 曲线可用振幅 96-18-18=60pt（原 14pt）

/**
 * ★ v10 reskin（2026-09-23）：整卡改白卡（SPEC §2 #10）——
 *   白底 + 细描边 + v10 白卡阴影；图表走青色系（ringTeal 线/面积、ringTealDeep 峰值标记）。
 *   标题行加青色胶囊 badge（数值来自真实睡眠评分）；底部解读行 = 色点 + 加粗结论 + 灰色说明。
 *   注：SPEC 里的「虚线目标线」无对应真实目标值，按数据铁律不上（不编造基线）。
 */

/** ★ v18.98（对齐 Oura）：只认「昨晚」这一夜 —— 今天的睡眠摘要，或昨天那条但起床落在今早。
 *  旧实现「优先今天、其次昨天、有多少天算多少天」会让一堆旧归档被当成昨晚睡的，
 *  早上打开就冒出一个恢复分；现在拿不到昨晚睡眠 → 返回 null → UI 显示「—」。 */
function latestSleep(): SleepSummary | null {
  const isLastNight = (s: SleepSummary | null): boolean => {
    if (!s || !((s.total ?? 0) > 0)) return false;
    const up = typeof s.getUp === 'number' ? s.getUp : null;
    if (up == null) return true;
    return up < 12 * 60; // 起床在 12:00 前 ⇒ 昨晚睡到今早
  };
  const t = healthStore.getSleep(dayKey(Date.now()));
  if (isLastNight(t)) return t;
  const y = healthStore.getSleep(dayKey(Date.now() - 86400000));
  return isLastNight(y) ? y : null;
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

/** （v18.64 移除 demoCurve 示意曲线：Mira 诚实数据铁律——没戴戒指就空态，不放「看起来像数据」的示意图） */

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

export default function AllDayRecoveryCard({ onPress, ring: ringProp, bg, iconFg: iconFgProp }: { onPress?: () => void; ring?: any; bg?: string; iconFg?: string }) {
  // ★ v18.53.2：bg 可传 butter（黄）；图标/强调色默认 lime，黄底时由调用方传 butter.fg
  const iconFg = iconFgProp ?? mm.chipBg.lime.fg;
  const ring = ringProp ?? useRingState();
  const [W, setW] = useState(0);
  // ★ v18.53：可传背景色（Bento 化，恢复=lime）；有底色时 badge 改白底避免同色相融
  const onColor = !!bg;

  // ★ v18.101 断流即空态：与首页圆环（curveStatus.dataStale）同一口径。
  //   这张卡原来只看睡眠有没有，圆环已经空了它还挂着恢复分/曲线 → 首页出现「圆环空、卡片有数」的撕裂，
  //   用户看到的就是这个：一会儿空、一会儿又冒出数字。数据不再新鲜时整张卡一起空。
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;
  // —— 睡眠恢复 ——
  const sleep = useMemo(() => latestSleep(), [ring.sleepDaily, Date.now() & 0]);
  const sleepScore = !dataStale && sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  // ★ v18.104：断流时空态要「连时长也不挂」—— 原来 sleepScore 置 null 后会退回 fmtDur(sleep.total)，
  //   等于把旧睡眠时长继续印在那里（用户实锤：圆环都空了这张卡还有数）。直接走「—」。
  const sleepValue = dataStale ? '—' : sleepScore != null ? String(sleepScore) : fmtDur(sleep?.total);
  const sleepUnit = dataStale ? '' : sleepScore != null ? '分' : '时长';
  // ★ v18.98（用户口径：不写「昨」，对齐 Oura）：只认**昨晚**的睡眠；
  //   latestSleep() 已经只取今晚，拿不到就是「暂无睡眠数据」+ 数值留「—」，不再挂溯源小字。
  const sleepSub = dataStale
    ? '戒指暂无新数据'
    : sleep == null
      ? '暂无睡眠数据'
      : `睡眠 ${fmtDur(sleep.total)} · 深睡 ${fmtDur(sleep.deep)}`;

  // —— 皮质醇 ——
  // ★ v18.110：离线回填把近 14 天的 cortisol/eda 逐样本补进 healthStore 后，这里必须重新取一遍，
  //   否则「皮质醇波动 / 峰值时刻 / 节律评价」会一直挂着重连前的旧拟合值（用户：重连后要按现有数据重算）。
  //   用防抖订阅：回填/实时流高频写不会每秒重算 fit，但 700ms 静默后一定算一次新值。
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const samples = useMemo(() => collectSamples(), [ring.curveStatus, hsRefresh]);
  const r = useMemo(() => analyzeCortisol(samples, 14), [samples]);
  const cos = r.cosinor;
  const hasRhythm =
    Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && Number.isFinite(cos.acrophaseH) && cos.amplitude > 0;

  // ★ v18.104：断流时皮质醇峰值也不该挂旧拟合值（cosinor 是拿旧采样拟合出来的时刻）。
  const peakClock = dataStale ? '—' : hasRhythm ? fmtClock(cos.acrophaseH) : '—';
  const ampPct = !dataStale && hasRhythm && cos.mesor > 0 ? Math.round((cos.amplitude / cos.mesor) * 100) : null;
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
  const cortisolSub = dataStale
    ? '戒指暂无新数据'
    : hasRhythm
      ? `${ampPct != null ? `波动 ${ampPct}%` : '节律已建模'} · ${recoveryWord}`
      : '佩戴后生成节律';

  // ★ 青色 badge（SPEC #10「82% · 接近目标」）：数值 = 真实睡眠评分，档位词由评分推导
  const badgeWord =
    sleepScore == null ? '待数据' : sleepScore >= 80 ? '接近目标' : sleepScore >= 60 ? '恢复中' : '恢复偏弱';
  const badgeText = dataStale ? '暂无数据' : sleepScore != null ? `${sleepScore}/100 · ${badgeWord}` : badgeWord;

  // —— 曲线数据（★ v18.69 门槛 + 分段）——
  //   三重门槛，缺一不画：
  //   1) 戒指今日同步过（lastSyncedAt 是今天）——没连过戒指的当天不画
  //   2) 今日有真实 HRV 采样——估计值/节律插值不冒充实测
  //   3) 30min 槽位非空 ≥6——太少不构成「趋势」
  //   realFlags 标记真实样本槽：画线只走真实槽，间隔 >1h 断开（见下方分段逻辑）。
  //   14 天节律拟合不上首页卡（用户定稿：那是详情页「14 天基线」的事）。
  const { series, realFlags, mode } = useMemo<{ series: number[]; realFlags: boolean[]; mode: 'today' | 'none' }>(() => {
    const ls = ring.lastSyncedAt as number | null | undefined;
    const syncedToday = (() => {
      if (!ls) return false;
      const a = new Date(ls);
      const b = new Date();
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    })();
    const realHrvToday = (() => {
      try { return healthStore.getIntraday('hrv', dayKey(Date.now())).length; } catch { return 0; }
    })();
    if (syncedToday && realHrvToday > 0) {
      const { vals, real } = buildCortisolToday30Ex();
      if (vals.filter((v) => v != null).length >= MIN_TODAY_SLOTS) {
        let lastIdx = vals.length - 1;
        while (lastIdx >= 0 && vals[lastIdx] == null) lastIdx--;
        return { series: vals.slice(0, lastIdx + 1) as number[], realFlags: real.slice(0, lastIdx + 1), mode: 'today' };
      }
    }
    return { series: [], realFlags: [], mode: 'none' };
  }, [ring.lastSyncedAt, samples.length, hasRhythm, cos.mesor, cos.amplitude, cos.acrophaseH, hsRefresh, ring.timelineReady ?? ring.curveStatus]);
  // ★ v18.101：断流时整张卡走「无数据」路径（曲线不画、结论行走空态文案），
  //   与圆环/三个 chip 保持同一口径，避免同一屏上「圆环空了、这张卡还有数」。
  const chartMode: 'today' | 'none' = dataStale ? 'none' : mode;

  // —— 坐标换算 ——
  const chartW = Math.max(40, W - PAD_L - PAD_R);
  const chartH = CHART_H - PAD_T - PAD_B;
  // ★ v18.69 分段连线：只画「真实样本」槽；真实样本间隔 >1h（槽差 >2）断开——
  //   节律插值补的空槽不再连线冒充连续观测（用户实锤：数据超过 1 小时不连线）。
  //   间隔 ≤1h（相邻真实槽中间恰好 1 个空槽）桥接连线。
  const realPts: { i: number; v: number }[] = [];
  for (let i = 0; i < series.length; i++) {
    if (realFlags[i] && Number.isFinite(series[i])) realPts.push({ i, v: series[i] });
  }
  const segs: { i: number; v: number }[][] = (() => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    for (const p of realPts) {
      if (cur.length === 0 || p.i - cur[cur.length - 1].i <= 2) cur.push(p);
      else { out.push(cur); cur = [p]; }
    }
    if (cur.length) out.push(cur);
    return out;
  })();

  // Y 轴范围按真实样本算（插值点不参与，避免把真实曲线压扁）
  const realVals = realPts.map((p) => p.v);
  const lo = realVals.length > 0 ? Math.min(...realVals) : 0;
  const hi = realVals.length > 0 ? Math.max(...realVals) : 1;
  const span = hi - lo || 1;
  const yLo = lo - span * 0.18;
  const yHi = hi + span * 0.18;
  const yOf = (v: number) => PAD_T + chartH - ((v - yLo) / (yHi - yLo)) * chartH;
  const xOf = (i: number) => PAD_L + (i / (SLOTS - 1)) * chartW;

  // 段内 (1,2,1) 平滑 + Catmull-Rom → 贝塞尔；单点段不画线（诚实）
  const segD = (seg: { i: number; v: number }[]): string => {
    if (seg.length < 2) return '';
    const smv = seg.map((p, k) => ((seg[k - 1]?.v ?? p.v) + 2 * p.v + (seg[k + 1]?.v ?? p.v)) / 4);
    return smoothPath(seg.map((p, k) => ({ x: xOf(p.i), y: yOf(smv[k]) })));
  };
  const linePath = segs.map(segD).filter(Boolean).join(' ');
  // 面积填充逐段收口到基线（不再斜插跨过缺口）
  const yBase = (PAD_T + chartH).toFixed(1);
  const areaPath =
    linePath
      ? segs
          .map((seg) => {
            const d = segD(seg);
            if (!d) return '';
            const x0 = xOf(seg[0].i).toFixed(1);
            const x1 = xOf(seg[seg.length - 1].i).toFixed(1);
            return `${d} L ${x1} ${yBase} L ${x0} ${yBase} Z`;
          })
          .filter(Boolean)
          .join(' ')
      : '';

  // 峰值标记 = 真实样本的最高点（不再取节律插值）
  let peakIdx = -1;
  let peakV = -Infinity;
  for (const p of realPts) {
    if (p.v > peakV) { peakV = p.v; peakIdx = p.i; }
  }
  const peakX = peakIdx >= 0 ? xOf(peakIdx) : 0;
  const peakY = peakIdx >= 0 ? yOf(peakV) : 0;

  const body = (
    <View style={[styles.wrap, !!bg && { backgroundColor: bg, borderColor: 'transparent' }]}>
      <View style={styles.inner}>
        {/* 卡片标题 + leaf 图标 chip（与首页圆环上方 chips 的恢复 icon 同款）+ 青色胶囊 badge */}
        <View style={styles.headRow}>
          <View style={styles.titleRow}>
            <View style={[styles.iconChip, onColor && { backgroundColor: mm.colors.cardBg }]}>
              <MindIcon name="leaf" size={theme.fs(17)} color={iconFg} />
            </View>
            <Text style={styles.title}>昼夜节律</Text>
          </View>
          <View style={styles.headRight}>
            <View style={[styles.badge, onColor && { backgroundColor: mm.colors.cardBg }]}>
              <Text style={[styles.badgeText, onColor && { color: iconFg }]}>{badgeText}</Text>
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

        {/* 下半：皮质醇全天趋势（落在卡片渐变的深色区，曲线走白色） */}
        <View style={styles.chartBox} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {W > 0 ? (
            <>
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
                />
              ) : null}

              {/* 峰值：竖直虚线 + 发光圆点 + 时刻标签（★ v18.69 取真实样本最高点；空数据整块不渲染，防 NaN 进 SVG） */}
              {peakIdx >= 0 ? (
                <>
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
                  <Circle cx={peakX} cy={peakY} r={4.2} fill={mm.colors.limeMid} />
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
                </>
              ) : null}

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
            {/* ★ v18.64 空态：没戴戒指不画示意曲线，只留时间轴 + 居中提示 */}
            {chartMode === 'none' ? (
              <View style={styles.emptyHint} pointerEvents="none">
                {/* ★ v18.104：断流（戴了戒指但很久没新采样）与「没戴过」是两种空态，文案要区分，
                    否则用户以为自己没戴 → 一直对着「戴上戒指后…」发呆。 */}
                <Text style={styles.emptyHintText}>
                  {dataStale ? '暂无数据' : '戴上戒指后，这里显示你的真实皮质醇趋势'}
                </Text>
              </View>
            ) : null}
            </>
          ) : (
            <View style={{ height: CHART_H }} />
          )}
        </View>

        {/* v10 解读行：色点 + 加粗结论 + 灰色说明（全部来自真实数据口径） */}
        <View style={styles.keyRow}>
          <View style={[styles.keyDot, chartMode === 'none' ? { backgroundColor: mm.colors.inkFaint } : { backgroundColor: mm.colors.ringTeal }]} />
          <View style={styles.keyTx}>
            <Text style={styles.keyBold} numberOfLines={1}>
              {chartMode === 'none' ? '暂无数据' : recoveryWord}
            </Text>
            <Text style={styles.keySub} numberOfLines={1}>
              {chartMode === 'none'
                ? dataStale
                  ? '请佩戴戒指，约半小时会更新最新数据'
                  : '戴上戒指后，这里显示你的真实皮质醇趋势'
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
  inner: { padding: theme.sp(2.5) },        // ★ v18.53.3：14→10，一屏预算（sp=n*4 实测重算）
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.xs,   // ★ v18.53.2 sm(12)→xs(8)，一屏预算
  },
  // ★ v18.53：leaf 图标 chip（与 Bento 卡白圆 chip 同规格）
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: theme.fs(36),
    height: theme.fs(36),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.chipBg.lime.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  // v16 黄绿胶囊 badge（恢复=黄绿；chipBg.cyan 已改语义为蓝·运动，恢复一律用 lime）
  badge: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.chipBg.lime.bg,
  },
  badgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: mm.chipBg.lime.fg,
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
  // 曲线区：★ v18.53 贴近上方文字（用户反馈：图表离上面的字太远），lg→sm
  chartBox: { marginTop: theme.space.sm },
  // ★ v18.64 空态提示（盖在 SVG 上居中）
  emptyHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHintText: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkFaint,
  },
  caption: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.5),
  },
});
