/**
 * CortisolRhythmCard —— 洞察页「皮质醇节律」卡片
 *
 * 数据：healthStore 内 cortisol 逐样本（含离线回填日，经 backfill 进入 healthStore 后自动覆盖）。
 * 由 InsightScreen 的 useHealthStoreVersion() 在每次 healthStore 变更时驱动本卡片重渲染。
 * 仅取 v > 0 的样本（剔除 GSR 通道 82% 的零值噪声），只用可靠的 HealthGlance 皮质醇。
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop, Line, G, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import Card from './Card';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { parseClockMinutes } from '../lib/sleepTime';
import { analyzeCortisol, type CortisolSample, type CortisolRhythmResult } from '../lib/cortisolRhythm';
import KalmanFilter from '../lib/kalman-filter';
import { DAY_HOUR_TICKS_COMPACT } from '../lib/chartAxis';
// ★ v18.123：今日曲线改用多模态反推的皮质醇活性（与首页昼夜节律卡同源）
import { buildCortisolProxyBaseline, buildCortisolProxyToday, buildCortisolBaselineActivity } from '../lib/cortisolProxy';
// ★ v18.125：与首页昼夜节律卡**共用同一套绘图几何**（用户：两处图不一样，看着难受）
import { buildSmoothSeries, computeYRange, slotToClock, CHART_SLOTS } from '../lib/cortisolChartGeom';

const LEVEL_META: Record<string, { label: string; color: string }> = {
  normal: { label: '节律正常', color: chart.series.cortisol },
  sustained_high: { label: '持续偏高', color: theme.colors.danger },
  dysregulated: { label: '节律紊乱', color: '#FFFFFF' },
};

const LOOKBACK_DAYS = 14;

/**
 * 拉取近 14 天 cortisol 逐样本（已剔除零值）。**只含实测日**。
 *
 * ★ 2026-11-06 审查（docs/audit/02 🟡#2）：**过滤推算日**。
 *   cortisol 的历史样本大多来自 offlineEstimates 的 stress 线性换算
 *   （cortisol = stress × 1.6 + 20），不是戒指实测。
 *   把推算样本喂进 cosinor 拟合，会得出「晨峰 08:00 / 节律良好」这类
 *   基于编造数据的生理节律结论。现只保留实测日样本。
 */
export function collectSamples(): CortisolSample[] {
  const out: CortisolSample[] = [];
  const now = Date.now();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const dk = dayKey(now - i * 86400000);
    if (healthStore.isDerivedDay('cortisol', dk)) continue;   // ★ 跳过推算日
    const arr = healthStore.getIntraday('cortisol', dk);
    for (const p of arr) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
    }
  }
  return out;
}

/**
 * 拉取指定某一天的 cortisol 逐样本（已剔除零值）。用于身体恢复详情页按 anchor 日查看。
 * ★ 2026-11-06（审查 02 🟡#2）：推算日不取 —— 否则单日视图也是一张换算出来的曲线。
 */
export function collectSamplesForDay(dk: string): CortisolSample[] {
  const out: CortisolSample[] = [];
  if (healthStore.isDerivedDay('cortisol', dk)) return out;
  for (const p of healthStore.getIntraday('cortisol', dk)) {
    if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
  }
  return out;
}

/**
 * 拉取 [startMs, endMs] 闭区间内所有天的 cortisol 逐样本（已剔除零值）。用于周/月/年区间聚合。
 * ★ 2026-11-06（审查 02 🟡#2）：区间基线同样过滤推算日 —— 30 分钟窗基线若含推算值，
 *   整张皮质醇节律卡的参照系就全是换算出来的。
 */
export function collectSamplesForRange(startMs: number, endMs: number): CortisolSample[] {
  const out: CortisolSample[] = [];
  const cur = new Date(startMs);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(23, 59, 59, 999);
  while (cur.getTime() <= end.getTime()) {
    const dk = dayKey(cur.getTime());
    if (!healthStore.isDerivedDay('cortisol', dk)) {
    for (const p of healthStore.getIntraday('cortisol', dk)) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
    }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * 从 healthStore 睡眠数据推导 sleepWindow (bedHour/wakeHour，**小数小时 / 分钟精度**)。
 *
 * ★ 不再 `Math.floor` 到整点：实测 00:41 入睡 / 09:41 起床，而压力事件发生在 00:12 ——
 *   取整会把 00:12 误判成睡眠时段。解析复用 `lib/sleepTime.parseClockMinutes`
 *   （全仓唯一实现，兼容 "HH:mm" 与原生 "yyyy-MM-dd HH:mm"）。
 * @param dk 目标日期；省略 = 今日（本地日）
 */
export function getSleepWindow(dk?: string): { bedHour: number; wakeHour: number } | null {
  const targetDk = dk ?? dayKey(Date.now());
  const sleepSum = healthStore.getSleep(targetDk);
  if (!sleepSum || !sleepSum.sleepTime || !sleepSum.wakeTime) return null;
  const bedMin = parseClockMinutes(sleepSum.sleepTime);
  const wakeMin = parseClockMinutes(sleepSum.wakeTime);
  if (bedMin == null || wakeMin == null) return null;
  return { bedHour: bedMin / 60, wakeHour: wakeMin / 60 };
}

/**
 * buildCortisolToday30 —— 生成今日皮质醇 30min 槽位（和 TrendChart 今日紫色线完全一致）
 * 导出给 MetricDetailScreen 复用。
 */
export function buildCortisolToday30Ex(): { vals: (number | null)[]; real: boolean[] } {
  const SLOTS = 48;
  const kf = new KalmanFilter({ R: 2, Q: 0.1 });
  const todayDK = dayKey(Date.now());
  const todayRaw: CortisolSample[] = healthStore.getIntraday('cortisol', todayDK)
    .filter((p) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
    .map((p) => ({ t: p.t, v: kf.filter(p.v) }));

  const sums: number[] = new Array(SLOTS).fill(0);
  const cnts: number[] = new Array(SLOTS).fill(0);
  for (const s of todayRaw) {
    const d = new Date(s.t);
    const slot = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
    sums[slot] += s.v;
    cnts[slot] += 1;
  }
  const today30: (number | null)[] = sums.map((s, i) => (cnts[i] > 0 ? +(s / cnts[i]).toFixed(1) : null));
  // ★ v18.69：标记哪些槽是「真实样本」——节律插值补的槽不算，
  //   供首页卡/详情页做「>1h 缺口断线」分段连线
  const real: boolean[] = today30.map((v) => v != null);

  const now = new Date();
  const currentSlot = Math.min(now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0), 47);
  // ★ 2026-09-29 修复：补齐空槽不再用「当日稀疏样本」做单日 cosinor（早上只有几小时的样本，
  //   拟合出的 acrophase 基本随机，补出来的曲线形状是错的）。改用近 14 天稳定节律补齐——
  //   真实样本槽保持不动，只填无数据时段，形状与「14天节律」模式一致。
  const r14 = analyzeCortisol(collectSamples(), 14);
  const c14 = r14.cosinor;
  const hasR14 =
    Number.isFinite(c14.mesor) && Number.isFinite(c14.amplitude) && c14.amplitude > 0 && Number.isFinite(c14.acrophaseH);
  if (hasR14) {
    const TWO_PI = Math.PI * 2;
    for (let slot = 0; slot <= currentSlot; slot++) {
      if (today30[slot] == null) {
        const h = slot / 2;
        const pred = c14.mesor + c14.amplitude * Math.cos(TWO_PI * (h - c14.acrophaseH) / 24);
        today30[slot] = Math.max(0, +pred.toFixed(1));
      }
    }
  }
  for (let slot = currentSlot + 1; slot < SLOTS; slot++) today30[slot] = null;
  return { vals: today30, real };
}

/** 兼容旧调用方：只要槽位值（补齐后的连续序列） */
export function buildCortisolToday30(): (number | null)[] {
  return buildCortisolToday30Ex().vals;
}

export default function CortisolRhythmCard() {
  const samples = collectSamples();
  const sleepWindow = getSleepWindow();
  console.log(`[CORT-CARD] samples=${samples.length} sleepWindow=${sleepWindow ? JSON.stringify(sleepWindow) : 'null'}`);
  if (samples.length < 4) {
    return (
      <Card>
        <Text style={styles.title}>🔥 皮质醇节律 v2</Text>
        <Text style={styles.hint}>
          暂无足够的皮质醇数据。连上戒指并开启自动监测后，约 1 天即可开始分析昼夜节律。
        </Text>
        <Text style={styles.disclaimer}>基于戒指压力代理值（非化验级皮质醇），且仅使用实测日样本；仅供趋势参考。</Text>
      </Card>
    );
  }
  const r = analyzeCortisol(samples, LOOKBACK_DAYS);
  const meta = LEVEL_META[r.status.level] ?? LEVEL_META.normal;
  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={styles.title}>皮质醇节律</Text>
        <View style={[styles.levelChip, { backgroundColor: meta.color + '22' }]}>
          <View style={[styles.levelDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.levelText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <CortisolBars r={r} sleepWindow={sleepWindow} />

      {/* ★ 2026-10-10：睡眠节律卡与洞察页共用同一张 TrendChart（同一个 r），峰值线统一走
          gMain.peakIdx（今日曲线真实最高点，永不在未来），两页逐位一致。 */}
      <TrendChart r={r} sleepWindow={sleepWindow} />

      <RhythmSummary r={r} />

      {r.status.flags.map((f, i) => (
        <Text
          key={i}
          style={[styles.flag, { color: r.status.level === 'normal' ? theme.colors.textSub : theme.colors.danger }]}
        >
          • {f}
        </Text>
      ))}

      <View style={styles.guide}>
        <Text style={styles.guideTitle}>怎么看这些指标</Text>
        <Text style={styles.guideLine}>• 整体水平：比你自己 14 天高 25% 以上算偏高，低 25% 以下算偏低</Text>
        <Text style={styles.guideLine}>• 昼夜起伏：越高表示早晚温差大，偏平 = 整天没变化</Text>
        <Text style={styles.guideLine}>• 全天最高：正常应该在早上 6–10 点，晚上高说明节律倒置</Text>
        <Text style={styles.guideLine}>• 节律规律度：越高表示你的每天模式越稳定，低于 30% 建议多测几天</Text>
      </View>

      <Text style={styles.disclaimer}>
        注：数据来自戒指传感器，以你 14 天基线做相对追踪，仅供参考。
      </Text>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function CortisolBars({ r, sleepWindow }: { r: CortisolRhythmResult; sleepWindow?: { bedHour: number; wakeHour: number } | null }) {
  const vals = r.hourlyMean.filter((v): v is number => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals, r.baseline.p25);
  const hi = Math.max(...vals, r.baseline.p75);
  const span = hi - lo || 1;

  // 判断某小时是否在睡眠时段
  const isAsleep = (h: number) => {
    if (!sleepWindow) return false;
    const { bedHour: b, wakeHour: w } = sleepWindow;
    if (b < w) return h >= b && h < w;       // 不跨零点 (bed=1 wake=10)
    return h >= b || h < w;                    // 跨零点 (bed=22 wake=7)
  };

  // 把 hourlyMean 画成折线图（带正常范围色带）
  const CHART_W = 320;
  const CHART_H = chart.h.s - chart.chrome.card;  // ★ 规范：S 档 96 − 装饰 24 = 72（原写死 72）
  const pad = 4;
  const xOf = (h: number) => pad + (CHART_W - pad * 2) * (h / 23);
  const yOf = (v: number) => pad + (CHART_H - pad * 2) * (1 - Math.max(0, Math.min(1, (v - lo) / span)));
  const valid = r.hourlyMean.map((v, h) => v != null ? { v: v!, h } : null).filter(Boolean) as { v: number; h: number }[];
  const ptColor = (h: number, v: number) => {
    const asleep = isAsleep(h);
    const inBand = !asleep && v >= r.baseline.p25 && v <= r.baseline.p75;
    return inBand ? mm.colors.ink : asleep ? theme.colors.ui.borderSoft : theme.colors.danger;
  };
  const segments: { d: string; color: string }[] = [];
  let segD = '', segColor = '';
  valid.forEach((p, i) => {
    const c = ptColor(p.h, p.v);
    const cmd = `${segColor === c && segD ? 'L' : 'M'} ${xOf(p.h).toFixed(1)} ${yOf(p.v).toFixed(1)}`;
    if (segColor && segColor !== c && segD) segments.push({ d: segD, color: segColor });
    segD = (segColor === c ? segD + ' ' : '') + cmd;
    segColor = c;
  });
  if (segD) segments.push({ d: segD, color: segColor });
  const p25Y = Number.isFinite(r.baseline.p25) ? yOf(r.baseline.p25) : null;
  const p75Y = Number.isFinite(r.baseline.p75) ? yOf(r.baseline.p75) : null;
  const bandPath = (p25Y != null && p75Y != null) ? `M ${xOf(0)} ${p75Y} L ${xOf(23)} ${p75Y} L ${xOf(23)} ${p25Y} L ${xOf(0)} ${p25Y} Z` : '';

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H + 24} style={{ alignSelf: 'center' }}>
        {/* 正常范围色带 */}
        {bandPath ? <Path d={bandPath} fill={chart.series.cortisol + '22'} /> : null}
        {/* 睡眠时段灰色遮罩 */}
        {(() => {
          const rects = [];
          for (let h = 0; h < 24; h++) {
            if (isAsleep(h)) {
              const x = xOf(Math.max(0, h - 0.5));
              const w = xOf(Math.min(23, h + 0.5)) - x;
              rects.push(<Rect key={h} x={x} y={0} width={w} height={CHART_H} fill={theme.colors.ui.borderSoft + '22'} />);
            }
          }
          return rects;
        })()}
        {/* 分段彩色折线 */}
        {segments.map((sg, i) => (
          <Path key={'seg'+i} d={sg.d} stroke={sg.color} strokeWidth={chart.lw.series} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* 数据点 */}
        {valid.map((p, i) => {
          const asleep = isAsleep(p.h);
          const inBand = !asleep && p.v >= r.baseline.p25 && p.v <= r.baseline.p75;
          const color = inBand ? chart.series.cortisol : asleep ? theme.colors.ui.borderSoft : theme.colors.danger;
          return <Circle key={i} cx={xOf(p.h)} cy={yOf(p.v)} r={chart.dot.radius} fill={color} />;
        })}
      </Svg>
      {/* 时间轴 */}
      <View style={styles.timeAxis}>
        {DAY_HOUR_TICKS_COMPACT.map((h) => (
          // ★ 2026-11-05：旧写法 `h % 24` 把末点 24 写成 0，首末标签都显示「0」→ 时间轴看起来不对。
          <Text key={h} style={styles.timeAxisLabel}>{String(h)}</Text>
        ))}
      </View>
      <Text style={styles.chartCap}>
        近 14 天每小时平均皮质醇（绿色阴影=你的正常范围，点色=是否在范围内）
      </Text>
    </View>
  );
}

/**
 * TrendChart —— 今天 vs 14 天基线 趋势对比
 * 绿虚线 = 14 天每小时基线 (hourlyMean, 含 cosinor 拟合补齐)
 * 蓝实线 = 今天逐样本原始数据
 * 灰色阴影 = 睡眠时段
 */
export function TrendChart({ r, sleepWindow, fillGaps = true, mainDayDk, hideYAxis = false, variant, peakHourOverride, height }: { r: CortisolRhythmResult; sleepWindow?: { bedHour: number; wakeHour: number } | null; fillGaps?: boolean; mainDayDk?: string; /** ★ 2026-10-08（用户：昼夜节律详情页不该展示纵坐标）：true 时不画左侧数值轴与网格刻度，绘图区吃满整宽 */ hideYAxis?: boolean; /** ★ 2026-10-09：睡眠恢复详情页「睡眠节律」卡用 sleep 变体 = 单条亮绿曲线，与 sleep-recovery-preview.html 一致；不画 14 天基线/峰值点/睡眠阴影 */ variant?: 'sleep'; /** ★ 2026-10-10：强制峰值竖线落在指定小时（覆盖自动检测）。睡眠节律卡用来让曲线峰值线对齐 14 天节律峰值，与文字/洞察页同源 */ peakHourOverride?: number; /** ★ 2026-10-10（用户：昼夜节律详情页图太小）：覆盖默认 chart.h.s 绘图高度（详情页传 chart.h.m 放大到详情单指标档） */ height?: number }) {
  const [W, setW] = React.useState(0);  // ★ 等 onLayout 拿真实宽度
  const H = height ?? chart.h.s;  // ★ 规范：S 档 96（原 120，与上方 72 自相矛盾）；详情页可传 chart.h.m 放大
  // ★ 2026-10-09：sleep 变体（睡眠节律卡）= 单条亮绿曲线，匹配预览；
  //   insight 变体（默认）= 青色今日线 + 绿色虚线基线 + 峰值点 + 睡眠阴影。
  const isSleep = variant === 'sleep';
  // ★ 2026-10-10（design-system-spec 铁律 H：皮质醇 = 亮绿 #BCCB62，今日实线 + 14天基线虚线同源绿）：
  //   今日线从 ringTeal(青蓝) 改回 chart.series.cortisol(亮绿)，与基线同色、靠实/虚区分，
  //   对齐昼夜节律设计稿与洞察页皮质醇卡 token（青蓝不在皮质醇色板内，属设计前遗留；
  //   且此前「今日线青蓝 + 峰值绿点」本身就自相矛盾）。
  const lineColor = chart.series.cortisol;
  // ★ 2026-10-08：隐藏 Y 轴时左侧不再留刻度数字的宽度，曲线整体左移吃满
  const padL = hideYAxis ? 6 : 38, padR = 12, padT = 10, padB = 18;
  const SLOTS = CHART_SLOTS;

  // ★ 等宽度拿到后再渲染 SVG
  if (W === 0) {
    return <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: '100%', height: H }} />;
  }

  const aggregate30m = (samples: CortisolSample[]): (number | null)[] => {
    const sums: number[] = new Array(SLOTS).fill(0);
    const cnts: number[] = new Array(SLOTS).fill(0);
    for (const s of samples) {
      if (!Number.isFinite(s.v) || s.v <= 0) continue;
      const d = new Date(s.t);
      const slot = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
      sums[slot] += s.v;
      cnts[slot] += 1;
    }
    return sums.map((s, i) => (cnts[i] > 0 ? +(s / cnts[i]).toFixed(1) : null));
  };

  const now = new Date();
  const currentSlot = Math.min(47, now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0));

  // ★ 主曲线所属的日：显式传 mainDayDk（身体恢复详情页按 anchor 日查看历史）→ 画该日；
  //   缺省=今天（洞察页复用本组件，行为不变）。
  const todayDK = dayKey(Date.now());
  const mainDK = mainDayDk ?? todayDK;
  const isMainToday = mainDK === todayDK;
  const mainStartMs = parseDayKey(mainDK);
  const mainDayMs = Number.isFinite(mainStartMs) ? mainStartMs : Date.now();
  const mainLabel = isMainToday ? '今天' : `${new Date(mainDayMs).getMonth() + 1}/${new Date(mainDayMs).getDate()}`;

  // ★ 2026-10-08：今日基线改用「融合活性基线」（与今日线同口径 0~100），不再用原始 μg/L 均值——
  //   之前两套量纲画一张图，基线被压底、今日线占满，看着错位（用户实锤）。
  //   历史日仍用原始 μg/L 聚合（与历史主曲线同口径），并用该日 cosinor 补齐空槽。
  let baseline30: (number | null)[];
  if (isMainToday) {
    baseline30 = buildCortisolBaselineActivity(14);
  } else {
    baseline30 = aggregate30m(collectSamplesForRange(mainDayMs - 13 * 86400000, mainDayMs));
    const cos = r.cosinor;
    const baseFillSlot = SLOTS - 1;
    if (fillGaps && Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && cos.amplitude > 0 && Number.isFinite(cos.acrophaseH)) {
      const TWO_PI = Math.PI * 2;
      for (let slot = 0; slot <= baseFillSlot; slot++) {
        if (baseline30[slot] == null) {
          const h = slot / 2;
          baseline30[slot] = Math.max(0, +(cos.mesor + cos.amplitude * Math.cos(TWO_PI * (h - cos.acrophaseH) / 24)).toFixed(1));
        }
      }
    }
  }

  // ★ 主曲线：所选日（mainDK）的原始逐样本——而非永远取「今天」。
  const mainRaw = healthStore.getIntraday('cortisol', mainDK)
    .filter((p) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
    .map((p) => ({ t: p.t, v: p.v } as CortisolSample));
  // ★ v18.65 今日曲线与首页「全天恢复」卡**同源同款**：buildCortisolToday30()
  //   （Kalman 滤波槽均值 + 14 天节律补空槽到当前时刻，未来时段不画）。
  //   旧实现用单日 cosinor 填空——样本稀疏时 acrophase 基本随机，补出的形状是错的。
  let main30: (number | null)[];
  if (isMainToday) {
    // ★ v18.123：今日主曲线改用**多模态反推的皮质醇活性**（lib/cortisolProxy，与首页昼夜节律卡同源）。
    //   旧实现 `buildCortisolToday30Ex()` 走的是 cosinor 拟合 + 14 天补形状 ——
    //   输入是 `stress×1.6+20` 的线性代理，且空槽被拟合曲线填满 → 既非实测、形状也不生理。
    //   proxy 每槽由该窗口实测 HRV/EDA/体温/心率算出，**没信号就是 null**（不填）。
    const bl = buildCortisolProxyBaseline(14);
    const px = buildCortisolProxyToday(bl);
    main30 = px.vals.map((v, i) => (px.real[i] ? v : null));
  } else {
    main30 = aggregate30m(mainRaw);
    // 历史日：整天都是过去，用该日自己的 cosinor 节律填满
    const mainR = analyzeCortisol(mainRaw, 1);
    const tcos = mainR.cosinor;
    if (fillGaps && Number.isFinite(tcos.mesor) && Number.isFinite(tcos.amplitude) && tcos.amplitude > 0 && Number.isFinite(tcos.acrophaseH)) {
      const TWO_PI = Math.PI * 2;
      for (let slot = 0; slot < SLOTS; slot++) {
        if (main30[slot] == null) {
          const h = slot / 2;
          const pred = tcos.mesor + tcos.amplitude * Math.cos(TWO_PI * (h - tcos.acrophaseH) / 24);
          main30[slot] = Math.max(0, +pred.toFixed(1));
        }
      }
    }
  }
  const mainNonNull = main30.filter(v => v != null).length;
  const baseNonNull = baseline30.filter(v => v != null).length;
  // ★ v18.125：清掉 v18.123 排查时加的逐帧 console.log（每帧刷 5 行、真机日志被冲掉）

  // （v18.65：旧「单日 cosinor 填空 + isMainToday 未来截断」已上移进上面的同源分支——
  //   今日曲线直接取 buildCortisolToday30()，与首页完全一致；历史日填满整天。）

  // ★ v18.125：**与首页昼夜节律卡调用同一个 buildSmoothSeries()**。
  //   改动前：首页是 Catmull-Rom 平滑曲线，详情页是 `makePath` 的直线折线（L 拼接）——
  //   同一份数据、一个圆润一个尖角嶙峢，用户反馈「看着难受」。现在物理上不可能再分叉。
  //   · 今日主曲线：走 proxy 的 48 槽实测活性（real 标记有生理信号的槽）
  //   · 14 天基线：同样平滑（此前也是折线 + 逐点小圆点，视觉噪）
  const todayReal: boolean[] = main30.map((v) => v != null);
  // ★ 14 天基线也要平滑：基线本身来自 14 天逐样本聚合，稀疏时折线很难看。
  //   用「真实槽=有聚合值的槽」构造，gapSlots 放大到 4（2 小时）避免基线被切太碎。
  const baseReal: boolean[] = baseline30.map((v) => v != null);
  // 先取「今日 + 14 天基线」的并集 Y 范围，再让两条线都用这一把尺
  const yr = computeYRange(isSleep
    ? [{ values: main30, real: todayReal }]
    : [{ values: main30, real: todayReal }, { values: baseline30, real: baseReal }]);
  const gMain = buildSmoothSeries(main30, todayReal, { W, H, padL, padR, padT, padB }, { yLo: yr.lo, yHi: yr.hi });
  const gBase = buildSmoothSeries(baseline30, baseReal, { W, H, padL, padR, padT, padB }, { gapSlots: 4, yLo: yr.lo, yHi: yr.hi });
  const yLo = yr.lo;
  const yHi = yr.hi;
  const yRange = yHi - yLo || 1;
  const basePath = gBase.linePath;
  const todayPath = gMain.linePath;
  const xOfSlot = gMain.xOf;
  const yOf = (v: number) => gMain.yOf(v);
  const chartH = gMain.chartH;
  const chartW = gMain.chartW;

  // 睡眠阴影
  const sleepRects: { x: number; w: number }[] = [];
  if (sleepWindow) {
    const { bedHour: b, wakeHour: w } = sleepWindow;
    const bedSlot = b * 2;
    const wakeSlot = w * 2;
    const totalSpan = xOfSlot(SLOTS - 1) - xOfSlot(0);
    if (bedSlot < wakeSlot) {
      sleepRects.push({ x: xOfSlot(bedSlot), w: xOfSlot(Math.min(wakeSlot, SLOTS - 1)) - xOfSlot(bedSlot) });
    } else {
      sleepRects.push({ x: xOfSlot(bedSlot), w: xOfSlot(SLOTS - 1) - xOfSlot(bedSlot) });
      sleepRects.push({ x: xOfSlot(0), w: xOfSlot(wakeSlot) - xOfSlot(0) });
    }
  }

  return (
    <View style={{ marginTop: theme.sp(1) }}>
      <Svg width={W} height={H}>
        {/* ★ 首页同款：今日曲线下渐变面积 */}
        <Defs>
          <LinearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity="0.34" />
            <Stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {gMain.areaPath ? <Path d={gMain.areaPath} fill="url(#trendArea)" /> : null}

        {/* 睡眠阴影（★ sleep 变体不画，与预览一致） */}
        {!isSleep && sleepRects.map((sr, i) => (
          <Rect key={`s${i}`} x={sr.x} y={padT} width={Math.max(1, sr.w)} height={chartH} fill={theme.colors.ui.borderSoft + '33'} />
        ))}

        {/* Y 轴网格 + 刻度（★ 昼夜节律详情页 hideYAxis=true → 不画，避免出现 -7 之类刻度） */}
        {!hideYAxis && [0, 0.5, 1].map((p, i) => {
          const val = yLo + p * yRange;
          const y = padT + chartH - p * chartH;
          return (
            <G key={i}>
              <Line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
              <SvgText x={padL - 4} y={y + 3} fontSize={9} fill={theme.colors.textSub} textAnchor="end">{val.toFixed(0)}</SvgText>
            </G>
          );
        })}

        {/* X 轴底线 */}
        <Line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke={chart.grid} strokeWidth={chart.lw.grid} />

        {/* 基线 (14天, 绿虚线) —— ★ sleep 变体不画 */}
        {!isSleep && basePath ? (
          <Path d={basePath} stroke={chart.series.cortisol} strokeWidth={chart.lw.ref} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={chart.dash.ref} />
        ) : null}
        {/* ★ v18.125：14 天基线不再逐点画小圆（用户要「平滑」）——
            折线已由共用模块平滑成曲线，散点只会让它看起来噪。 */}

        {/* 今天（★ sleep 变体用亮绿；insight 变体用 ringTeal 实线 2.6pt 圆头） */}
        {todayPath ? (
          <Path d={todayPath} stroke={lineColor} strokeWidth={chart.lw.series} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {/* ★ v18.125 与首页对齐：孤立真实单点画实心点（真实但断开，画了才知道「测到了」）—— ★ sleep 变体不画 */}
        {!isSleep && gMain.singles.map((p, k) => (
          <Circle key={'sg' + k} cx={p.x} cy={p.y} r={chart.dot.radius} fill={lineColor} />
        ))}

        {/* ★ v18.125 与首页对齐：峰值竖虚线 + 发光圆点 + 时刻标签 —— sleep 变体也画
            （2026-10-10 用户要求：睡眠节律卡的皮质醇曲线也要标峰值竖线，参考洞察页）。
            peakHourOverride 存在时，峰值线落在指定小时（= 14 天节律峰值），与上方文字/洞察页同源；
            否则自动取主曲线最高真实点。 */}
        {(() => {
          const ovSlot =
            peakHourOverride != null && Number.isFinite(peakHourOverride)
              ? Math.round(peakHourOverride * 2)
              : gMain.peakIdx;
          if (ovSlot < 0) return null;
          const ovX = xOfSlot(ovSlot);
          const ovV = main30[ovSlot];
          const ovY = ovV != null && Number.isFinite(ovV) ? yOf(ovV) : padT + chartH / 2;
          return (
            <>
              <Line
                x1={ovX}
                y1={ovY}
                x2={ovX}
                y2={gMain.yBase}
                stroke={mm.colors.limeDeep}
                strokeOpacity={0.45}
                strokeWidth={chart.lw.ref}
                strokeDasharray={chart.dash.ref}
              />
              {ovV != null && Number.isFinite(ovV) ? (
                <Circle cx={ovX} cy={ovY} r={4.2} fill={isSleep ? mm.colors.ink : mm.colors.limeMid} />
              ) : null}
              <SvgText
                x={Math.min(Math.max(ovX, padL + 16), padL + chartW - 16)}
                y={Math.max(ovY - 12, 12)}
                fontSize={chart.axisFont}
                fontWeight="600"
                fill={mm.colors.limeDeep}
                textAnchor="middle"
              >
                {slotToClock(ovSlot)}
              </SvgText>
            </>
          );
        })()}

        {/* X 时间刻度 0/6/12/18/24 */}
        {[0, 6, 12, 18, 24].map((h) => {
          const slot = Math.min(h * 2, SLOTS - 1);
          return (
            <SvgText key={h} x={xOfSlot(slot)} y={H - 4} fontSize={9} fill={theme.colors.textSub}
              textAnchor={h === 24 ? 'end' : h === 0 ? 'start' : 'middle'}>{String(h)}</SvgText>
          );
        })}
      </Svg>

      {/* ★ v18.125 图例：用真实线段样式（View 画线）而不是「- -」「—」字符 ——
          字符字形与实际 strokeDasharray 观感不一致，线宽/虚线间距都对不上。 */}
      <View style={styles.trendLegend}>
        {isSleep ? (
          <View style={styles.trendLegendItem}>
            <View style={[styles.trendLegendLine, { backgroundColor: chart.series.cortisol }]} />
            <Text style={styles.trendLegendTx}>皮质醇（亮绿）</Text>
          </View>
        ) : (
          <>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendLine, { backgroundColor: chart.series.cortisol }]} />
              <Text style={styles.trendLegendTx}>{mainLabel}</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={[styles.trendLegendDash, { borderColor: chart.series.cortisol }]} />
              <Text style={styles.trendLegendTx}>14 天基线</Text>
            </View>
            <View style={styles.trendLegendItem}>
              <View style={styles.trendLegendBand} />
              <Text style={styles.trendLegendTx}>睡眠时段</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** 节律四指标口语化描述 */
function RhythmSummary({ r }: { r: CortisolRhythmResult }) {
  // 根据个人基线计算百分位, 给口语化描述
  const mesor = r.cosinor.mesor;
  const amp = r.cosinor.amplitude;
  const p25 = r.baseline.p25, p75 = r.baseline.p75;
  const ampRatio = amp > 0 && mesor > 0 ? amp / mesor : 0;  // 相对波动比例

  // 日均值: 高/正常/低
  let levelText = '正常', levelColor: string = chart.series.cortisol;
  if (Number.isFinite(p25) && Number.isFinite(p75)) {
    if (mesor > p75) { levelText = '偏高'; levelColor = theme.colors.stateTense; }
    else if (mesor < p25) { levelText = '偏低'; levelColor = theme.colors.stateTense; }
  }

  // 昼夜波动: 正常/偏平/偏大
  let ampText = '正常';
  if (ampRatio < 0.15) ampText = '偏平（几乎没起伏）';
  else if (ampRatio > 0.40) ampText = '波动较大';

  // 最高时刻:
  let peakText = '—';
  if (Number.isFinite(r.cosinor.acrophaseH)) {
    const h = Math.round(r.cosinor.acrophaseH);
    const period = (h >= 4 && h < 12) ? '早上' : (h >= 12 && h < 18 ? '下午' : '晚上');
    peakText = `${period} ${String(h).padStart(2, '0')}:00`;
  }

  // 节律规律度
  let regText = '数据不足';
  if (Number.isFinite(r.cosinor.r2)) {
    const pct = Math.round(r.cosinor.r2 * 100);
    regText = pct >= 60 ? `规律 (${pct}%)` : pct >= 30 ? `一般 (${pct}%)` : `较乱 (${pct}%)`;
  }

  return (
    <View style={styles.summaryBlock}>
      <Text style={styles.summaryItem}>
        整体水平：<Text style={{ color: levelColor, fontWeight: theme.weight.semibold }}>{levelText}</Text>
      </Text>
      <Text style={styles.summaryItem}>昼夜起伏：{ampText}</Text>
      <Text style={styles.summaryItem}>全天最高：{peakText}</Text>
      <Text style={styles.summaryItem}>节律模式：{regText}</Text>
    </View>
  );
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}

const styles = StyleSheet.create({
  trendLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.sp(2), marginTop: theme.sp(0.5) },
  trendLegendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.8) },
  trendLegendLine: { width: theme.sp(3), height: 2.6, borderRadius: 1.3 },
  trendLegendDash: { width: theme.sp(3), height: 1.5, borderRadius: 0.75, backgroundColor: theme.colors.ui.scrimSoft }, // ★ Fabric 不支持 dashed border（红条警告），改实线短杠
  trendLegendBand: { width: theme.sp(3), height: theme.sp(1.6), borderRadius: 1, backgroundColor: theme.colors.ui.borderSoft }, // ★ 睡眠时段阴影色块（与图内 sleepRects 同源）
  trendLegendTx: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  levelDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 72, justifyContent: 'space-between', marginTop: theme.sp(0.5) },
  bar: { width: 8, borderRadius: chart.barRadius },
  timeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(0.5), paddingHorizontal: theme.sp(1.5) },
  timeAxisLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  chartCap: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), textAlign: 'center' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.sp(1.5) },
  metric: { width: '50%', marginBottom: theme.sp(1) },
  summaryBlock: { marginTop: theme.sp(1.5), gap: theme.sp(0.75) },
  guide: { marginTop: theme.sp(2), paddingTop: theme.sp(1.5), borderTopWidth: 1, borderTopColor: theme.colors.cardBorder2 },
  guideTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textSub, marginBottom: theme.sp(0.75) },
  guideLine: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: theme.fontSize.micro + theme.sp(1) },
  summaryItem: { fontSize: theme.fontSize.body, color: theme.colors.textBody },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textBody, marginTop: theme.sp(0.5) },
  flag: { fontSize: theme.fontSize.body, marginTop: theme.sp(0.5) },
  hint: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  disclaimer: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2) },
});
