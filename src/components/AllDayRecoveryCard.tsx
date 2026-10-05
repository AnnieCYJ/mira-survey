/**
 * AllDayRecoveryCard —— 首页「昼夜节律」卡片
 *
 * 结构：
 *   上半：睡眠恢复情况 + 皮质醇活性峰值（两枚指标块）
 *   下半：皮质醇活性全天趋势（平滑曲线 + 峰值高亮圆点 + 竖直虚线）
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ v18.116 数据口径改版：多模态反推「皮质醇活性」（方案 A）
 * ════════════════════════════════════════════════════════════════════════
 *  旧链路（已废弃）：collectSamples → analyzeCosinor(14天) → buildCortisolToday30Ex
 *    问题：① 输入是 `stress × 1.6 + 20` 的线性代理（HRV 二次加工）；
 *          ② 缺失时段用 14 天 cosinor 拟合曲线填补（v18.114 的虚线）—— 既非实测也不生理；
 *          ③ 输出叫「皮质醇值」，但戒指根本没有皮质醇传感器。
 *  新链路：lib/cortisolProxy.ts
 *    · 每 30 分钟窗口，由**实测** HRV(反相)/EDA/体温偏移/静息心率偏移/活动(负相)/睡眠债
 *      各自算 z-score（相对个人 14 天基线，中位数 + MAD×1.4826）→ 加权 → tanh 压缩到 0~100；
 *    · **没有实测信号的窗口 = null**，UI 留白。不拟合、不补形状、**不画虚线**；
 *    · 输出叫「皮质醇活性」，是**相对个人基线的相对量**，不是激素浓度。
 *  业界依据（Garmin Firstbeat / Oura / WHOOP 均为反推，非实测）：
 *    Garmin 压力分 vs 唾液皮质醇 r=0.29~0.71；Body Battery vs 晨起皮质醇 r=0.52（n=127, 2024）。
 *
 *  睡眠：healthStore.getSleep() 最近一晚（评分 / 总时长 / 深睡），口径未变。
 *  断流（dataStale）：整张卡走空态，不显示任何反推值。
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
import { buildCortisolProxyBaseline, buildCortisolProxyToday, MIN_BASELINE_DAYS } from '../lib/cortisolProxy';
// ★ v18.146：睡眠分统一走「今天该显示哪个睡眠分」的唯一入口（与圆环 chip、SleepCard 同源），
//   不再直接读旧落盘字段 sleep.score（绝对分），否则同一标签「睡眠恢复」会出现两把尺。
import { computeSleepPersonalized } from '../lib/sleepPersonalized';
// ★ v18.125：绘图几何与详情页共用同一模块（保证「同一指标画出同一张图」）
import { buildSmoothSeries, slotToClock, CHART_SLOTS } from '../lib/cortisolChartGeom';

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
  // ★ v18.146：分数走 `computeSleepPersonalized()`（相对个人基线、锚点 50=和平时一样），
  //   与圆环 chip、SleepCard 同源。之前这里直接读 `sleep.score`（旧绝对分落盘字段，锚点 100=达标），
  //   同一标签「睡眠恢复」在圆环是 52、在节律卡是 94，用户以为算错了。
  const sleep = useMemo(() => latestSleep(), [ring.sleepDaily, Date.now() & 0]);
  const pers = useMemo(() => { try { return computeSleepPersonalized(); } catch { return null; } }, [ring.sleepDaily, Date.now() & 0]);
  const sleepScore = !dataStale && pers && pers.score != null && Number.isFinite(pers.score) ? pers.score : null;
  const persRelative = pers?.mode === 'relative';
  // ★ v18.104：断流时空态要「连时长也不挂」—— 原来 sleepScore 置 null 后会退回 fmtDur(sleep.total)，
  //   等于把旧睡眠时长继续印在那里（用户实锤：圆环都空了这张卡还有数）。直接走「—」。
  const sleepValue = dataStale ? '—' : sleepScore != null ? String(sleepScore) : (sleep ? fmtDur(sleep.total) : '—');
  const sleepUnit = dataStale ? '' : sleepScore != null ? '分' : (sleep ? '时长' : '');
  // ★ v18.98（用户口径：不写「昨」，对齐 Oura）：只认**昨晚**的睡眠；
  //   latestSleep() 已经只取今晚，拿不到就是「暂无睡眠数据」+ 数值留「—」，不再挂溯源小字。
  const sleepSub = dataStale
    ? '戒指暂无新数据'
    : sleep == null
      ? '暂无睡眠数据'
      : `睡眠 ${fmtDur(sleep.total)} · 深睡 ${fmtDur(sleep.deep)}`;

  // —— 皮质醇活性（★ v18.116 方案 A：多模态反推，全实测驱动，无拟合无虚线）——
  //  废弃原 `analyzeCortisol` + cosinor 拟合：那套用 `stress×1.6+20` 的线性代理值，
  //  再拿 14 天拟合曲线填补缺失槽（v18.114 的虚线）—— 既不是实测也不是生理学形状。
  //  现在改为每 30 分钟窗口直接由实测信号算「皮质醇活性 0~100（相对个人基线）」：
  //  HRV(反相) / EDA / 体温偏移 / 静息心率偏移 / 活动(负相) / 睡眠债，z-score 加权 + tanh 压缩。
  //  缺信号 → 该槽 null（不编造、不画虚线）。
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const proxy = useMemo(() => {
    // ★ v18.117：14 天窗口、**不含今天**、按 30min 时段分桶（皮质醇有昼夜节律，
    //   必须同一时段跨天比较，否则凌晨槽会被白天样本的基线判成「偏高」）。
    const bl = buildCortisolProxyBaseline(14);
    const built = buildCortisolProxyToday(bl);
    const valid = built.vals.filter((v): v is number => v != null);
    let peakIdx = -1;
    let peakV = -Infinity;
    built.vals.forEach((v, i) => {
      if (v != null && v > peakV) { peakV = v; peakIdx = i; }
    });
    // 波动幅度 = 有效槽的 (max−min)/中位 —— 相对量，不是激素浓度
    const ampPct =
      valid.length >= 3 && peakV > -Infinity
        ? Math.round(((Math.max(...valid) - Math.min(...valid)) / (valid.reduce((a, b) => a + b, 0) / valid.length)) * 100)
        : null;
    const out = { ...built, validCount: valid.length, peakIdx, peakV, ampPct, baselineDays: bl.days };
    // ★ COR-PROBE：诊断日志（离线重算对账用，仅 __DEV__）。核对命令：grep COR-PROBE /tmp/metro_8081.log
    //   输出：峰值槽/值、有效槽数、每槽「值(参与信号数)」压缩串、基线天数。
    //   ★ 必须留在 useMemo 内：原先写在组件体里，每次渲染都会重跑一次 map/join 并打印，
    //     刷屏之外还把 render 路径变成 I/O 路径（真机掉帧排查时会误导定位）。
    if (__DEV__ && !dataStale) {
      const row = built.vals
        .map((v, i) => (v == null ? null : `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}=${v.toFixed(0)}(n${built.counts[i]})`))
        .filter(Boolean)
        .join(' ');
      console.log(`[COR-PROBE] peak=${Math.floor((peakIdx ?? -1) / 2)}:${(peakIdx ?? -1) % 2 ? '30' : '00'} v=${peakV?.toFixed(1)} valid=${valid.length} baseDays=${bl.days}`);
      console.log(`[COR-PROBE-SLOTS] ${row}`);
    }
    return out;
  }, [ring.curveStatus, hsRefresh]);

  // ★ v18.117：基线不足 3 天时不输出数（尺度是 MAD 估的，样本太少不可靠）
  const baselineReady = proxy.baselineDays >= MIN_BASELINE_DAYS;
  const hasProxy = baselineReady && proxy.validCount >= 3;
  // 峰值时刻 = 实测活性最高的那一槽（不是拟合出来的）
  const peakClock = dataStale || !hasProxy ? '—' : fmtClock(proxy.peakIdx / 2);
  const recoveryWord = !hasProxy
    ? baselineReady ? '数据不足' : `建立基线中（${proxy.baselineDays}/${MIN_BASELINE_DAYS} 天）`
    : proxy.peakV >= 70
        ? '压力偏高'
        : proxy.peakV <= 40
          ? '放松良好'
          : proxy.ampPct != null && proxy.ampPct >= 60
            ? '波动偏大'
            : '节律平稳';
  const cortisolSub = dataStale
    ? '戒指暂无新数据'
    : hasProxy
      ? `${proxy.ampPct != null ? `波动 ${proxy.ampPct}%` : '活性已建模'} · ${recoveryWord}`
      : '佩戴后生成活性曲线';

  // ★ v18.146：badge 档位词与圆环 chip 的 recTag、SleepCard 的 recoveryLabel **同源**
  //   （相对≥62 较好 / ≥45 一般；绝对≥80 良好 / ≥60 中），不再用旧的「接近目标」绝对措辞，
  //   避免 badge 文案和卡片大数字语义错位（MEMORY：标签与数值必须同一口径）。
  const badgeWord =
    sleepScore == null ? '待数据'
      : persRelative
        ? (sleepScore >= 62 ? '恢复较好' : sleepScore >= 45 ? '恢复一般' : '恢复偏弱')
        : (sleepScore >= 80 ? '恢复良好' : sleepScore >= 60 ? '恢复中' : '恢复偏弱');
  const badgeText = dataStale ? '暂无数据' : sleepScore != null ? `${sleepScore}/100 · ${badgeWord}` : badgeWord;

  // —— 曲线数据（★ v18.116 方案 A：直接用多模态反推结果，**无拟合、无虚线**）——
  //   数据源 = buildCortisolProxyToday() 的 48 槽实测活性（每槽由该窗口 HRV/EDA/体温/心率算出）。
  //   realFlags 标记「该槽真有生理信号」——绘图只连这些槽，间隔 >1h 断开。
  //   门槛：有效槽 >= MIN_TODAY_SLOTS 才算「构成趋势」，否则整张卡走空态。
  //   ★ 不再调用 buildCortisolToday30Ex（那是 cosinor 拟合 + 14 天补形状，v18.114 的虚线已废弃）。
  const { series, realFlags, mode } = useMemo<{ series: number[]; realFlags: boolean[]; mode: 'today' | 'none' }>(() => {
    const vals = proxy.vals;
    const real = proxy.real;
    if (proxy.validCount >= MIN_TODAY_SLOTS) {
      let lastIdx = vals.length - 1;
      while (lastIdx >= 0 && vals[lastIdx] == null) lastIdx--;
      if (lastIdx >= 0) {
        return {
          series: vals.slice(0, lastIdx + 1) as number[],
          realFlags: real.slice(0, lastIdx + 1),
          mode: 'today',
        };
      }
    }
    return { series: [], realFlags: [], mode: 'none' };
  }, [proxy.validCount, proxy.vals, proxy.real, hsRefresh, ring.timelineReady ?? ring.curveStatus]);
  // ★ v18.101：断流时整张卡走「无数据」路径（曲线不画、结论行走空态文案），
  //   与圆环/三个 chip 保持同一口径，避免同一屏上「圆环空了、这张卡还有数」。
  const chartMode: 'today' | 'none' = dataStale ? 'none' : mode;

  // —— 坐标换算 ——
  const chartW = Math.max(40, W - PAD_L - PAD_R);
    // ★ v18.125：几何计算收敛到共用模块 buildSmoothSeries() ——
  //   详情页皮质醇趋势图调用的是**同一个函数**，同一份数据必然画出同一张图
  //   （此前首页走 Catmull-Rom 平滑、详情页是折线 L 拼接，观感割裂 → 用户「看着难受」）。
  const g = buildSmoothSeries(series, realFlags, { W, H: CHART_H, padL: PAD_L, padR: PAD_R, padT: PAD_T, padB: PAD_B });
  const xOf = g.xOf;

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
            <Text style={styles.tileLabel}>皮质醇活性峰值</Text>
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
                y1={g.yBase}
                x2={PAD_L + chartW}
                y2={g.yBase}
                stroke={mm.colors.ringTealDeep}
                strokeOpacity={0.25}
                strokeWidth={1}
              />

              {/* 曲线下方填充 + 平滑曲线 */}
              {g.areaPath ? <Path d={g.areaPath} fill="url(#adrArea)" /> : null}
              {g.linePath ? (
                <Path
                  d={g.linePath}
                  fill="none"
                  stroke={mm.colors.ringTeal}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}

              {/* 孤立真实单点（真实但断开，画实心点让「测到了」可见） */}
              {g.singles.map((p, k) => (
                <Circle key={`sg${k}`} cx={p.x} cy={p.y} r={3.2} fill={mm.colors.ringTeal} />
              ))}

              {/* 峰值：竖直虚线 + 发光圆点 + 时刻标签（★ v18.69 取真实样本最高点；空数据整块不渲染，防 NaN 进 SVG） */}
              {g.peakIdx >= 0 ? (
                <>
                  <Line
                    x1={g.peakX}
                    y1={g.peakY}
                    x2={g.peakX}
                    y2={g.yBase}
                    stroke={mm.colors.ringTealDeep}
                    strokeOpacity={0.42}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                  />
                  <Circle cx={g.peakX} cy={g.peakY} r={4.2} fill={mm.colors.limeMid} />
                  <SvgText
                    x={Math.min(Math.max(g.peakX, PAD_L + 16), PAD_L + g.chartW - 16)}
                    y={Math.max(g.peakY - 12, 12)}
                    fontSize={11}
                    fontWeight="600"
                    fill={mm.colors.ringTealDeep}
                    textAnchor="middle"
                  >
                    {slotToClock(g.peakIdx)}
                  </SvgText>
                </>
              ) : null}

              {/* 时间轴 00 / 06 / 12 / 18 / 24（两端刻度改 start/end 锚点，贴边不截断） */}
              {[0, 6, 12, 18, 24].map((h) => {
                const slot = Math.min(h * 2, CHART_SLOTS - 1);
                const edgeL = h === 0;
                const edgeR = h === 24;
                return (
                  <SvgText
                    key={h}
                    x={edgeL ? PAD_L + 1 : edgeR ? PAD_L + g.chartW - 1 : xOf(slot)}
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
                  {dataStale ? '暂无数据' : '戴上戒指后，这里显示你的皮质醇活性趋势'}
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
                  : '戴上戒指后，这里显示你的皮质醇活性趋势'
                : `今日趋势 · ${cortisolSub}`}
            </Text>
          </View>
          {/* ★ v18.116：方案 A 全程实测驱动，没有推算段 → 不需要「实测/节律」双色图例。
              改为标注「反推自 N 项生理信号」，让用户知道这个值怎么来的、不是直接测的激素浓度。 */}
          {chartMode === 'today' && g.points.length > 0 ? (
            <View style={styles.legendBox}>
              <Text style={styles.legendTx}>
                反推自 HRV · 皮电 · 体温 · 心率
              </Text>
            </View>
          ) : null}
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
  // ★ v18.114：图例（实线=实测 / 虚线=14 天节律）
  legendBox: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.2) },
  legendTx: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint },
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
