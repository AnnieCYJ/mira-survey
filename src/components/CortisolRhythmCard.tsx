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
import Card from './Card';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { parseClockMinutes } from '../lib/sleepTime';
import { analyzeCortisol, type CortisolSample, type CortisolRhythmResult } from '../lib/cortisolRhythm';
import KalmanFilter from '../lib/kalman-filter';

const LEVEL_META: Record<string, { label: string; color: string }> = {
  normal: { label: '节律正常', color: mm.colors.ink },
  sustained_high: { label: '持续偏高', color: theme.colors.danger },
  dysregulated: { label: '节律紊乱', color: '#FFFFFF' },
};

const LOOKBACK_DAYS = 14;

/** 拉取近 14 天 cortisol 逐样本（已剔除零值），含离线回填日。 */
export function collectSamples(): CortisolSample[] {
  const out: CortisolSample[] = [];
  const now = Date.now();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const dk = dayKey(now - i * 86400000);
    const arr = healthStore.getIntraday('cortisol', dk);
    for (const p of arr) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
    }
  }
  return out;
}

/** 拉取指定某一天的 cortisol 逐样本（已剔除零值）。用于身体恢复详情页按 anchor 日查看。 */
export function collectSamplesForDay(dk: string): CortisolSample[] {
  const out: CortisolSample[] = [];
  for (const p of healthStore.getIntraday('cortisol', dk)) {
    if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
  }
  return out;
}

/** 拉取 [startMs, endMs] 闭区间内所有天的 cortisol 逐样本（已剔除零值）。用于周/月/年区间聚合。 */
export function collectSamplesForRange(startMs: number, endMs: number): CortisolSample[] {
  const out: CortisolSample[] = [];
  const cur = new Date(startMs);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(23, 59, 59, 999);
  while (cur.getTime() <= end.getTime()) {
    for (const p of healthStore.getIntraday('cortisol', dayKey(cur.getTime()))) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
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
        <Text style={styles.disclaimer}>基于戒指压力代理值（非化验级皮质醇），仅供趋势参考。</Text>
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
  const CHART_H = 72;
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
        {bandPath ? <Path d={bandPath} fill="#1F1D1A22" /> : null}
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
          <Path key={'seg'+i} d={sg.d} stroke={sg.color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* 数据点 */}
        {valid.map((p, i) => {
          const asleep = isAsleep(p.h);
          const inBand = !asleep && p.v >= r.baseline.p25 && p.v <= r.baseline.p75;
          const color = inBand ? mm.colors.ink : asleep ? theme.colors.ui.borderSoft : theme.colors.danger;
          return <Circle key={i} cx={xOf(p.h)} cy={yOf(p.v)} r={2.5} fill={color} />;
        })}
      </Svg>
      {/* 时间轴 */}
      <View style={styles.timeAxis}>
        {[0, 6, 12, 18, 24].map((h) => (
          <Text key={h} style={styles.timeAxisLabel}>{h % 24}</Text>
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
export function TrendChart({ r, sleepWindow, fillGaps = true, mainDayDk }: { r: CortisolRhythmResult; sleepWindow?: { bedHour: number; wakeHour: number } | null; fillGaps?: boolean; mainDayDk?: string }) {
  console.log(`[TREND-ENTRY] called, hourlyMean=${r.hourlyMean?.filter(v=>v!=null).length}/${r.hourlyMean?.length}`);
  const [W, setW] = React.useState(0);  // ★ 等 onLayout 拿真实宽度
  const H = 120;
  const padL = 38, padR = 12, padT = 10, padB = 18;
  const chartW = Math.max(50, W - padL - padR);
  const chartH = H - padT - padB;
  const SLOTS = 48;
  console.log(`[TREND] W=${W.toFixed(0)} padL=${padL} chartW=${chartW.toFixed(0)} x0=${padL} x47=${(padL + chartW).toFixed(0)}`);

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

  // 14 天基线 + cosinor 填补空：
  //  今天视图：基线=近 14 天（含今天）聚合，只填到当前时刻；
  //  历史日：基线=该日往前 14 天聚合，整天填满（不再是「今天往前 14 天」，各历史页基线也随日期变化）。
  let baseline30 = isMainToday
    ? aggregate30m(collectSamples())
    : aggregate30m(collectSamplesForRange(mainDayMs - 13 * 86400000, mainDayMs));
  const cos = r.cosinor;
  const baseFillSlot = isMainToday ? currentSlot : SLOTS - 1;
  if (fillGaps && Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && cos.amplitude > 0 && Number.isFinite(cos.acrophaseH)) {
    const TWO_PI = Math.PI * 2;
    for (let slot = 0; slot <= baseFillSlot; slot++) {
      if (baseline30[slot] == null) {
        const h = slot / 2;
        baseline30[slot] = Math.max(0, +(cos.mesor + cos.amplitude * Math.cos(TWO_PI * (h - cos.acrophaseH) / 24)).toFixed(1));
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
    // ★ v18.69 与首页同款「分段连线」：只画真实样本槽；真实样本间隔 ≤1h（中间恰好 1 个
    //   空槽）桥接连线，>1h 断开——节律插值不再把稀疏观测连成一条连续曲线冒充实测
    const ex = buildCortisolToday30Ex();
    main30 = ex.vals.map((v, i) => {
      if (ex.real[i]) return v;
      const prevReal = i > 0 && ex.real[i - 1];
      const nextReal = i < ex.vals.length - 1 && ex.real[i + 1];
      return prevReal && nextReal ? v : null;   // 1h 桥接点保留；缺口 ≥1.5h 断开
    });
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
  console.log(`🔥 [TREND] dk=${mainDK} mainRaw=${mainRaw.length} mainNonNull=${mainNonNull}/48 baselineNonNull=${baseNonNull}/48`);
  // ★ 数据分布诊断
  if (mainRaw.length > 0) {
    const times = mainRaw.map(p => new Date(p.t).toLocaleTimeString().slice(0,5));
    const vals = mainRaw.map(p => p.v.toFixed(0));
    console.log(`🔥 [TREND] mainRaw TIMES=[${times.join(",")}]`);
    console.log(`🔥 [TREND] mainRaw VALS=[${vals.join(",")}] unit=SDK_μg/L`);
    const nonNull30 = main30.map((v,i) => v != null ? `${i/2}h=${v.toFixed(1)}` : null).filter(Boolean);
    console.log(`🔥 [TREND] main30 SLOTS: ${nonNull30.join(", ")}`);
  }

  // （v18.65：旧「单日 cosinor 填空 + isMainToday 未来截断」已上移进上面的同源分支——
  //   今日曲线直接取 buildCortisolToday30()，与首页完全一致；历史日填满整天。）

  // Y 轴范围
  const allVals = [...baseline30, ...main30].filter((v): v is number => v != null);
  if (allVals.length < 2) { console.log(`[TREND-SKIP] allVals=${allVals.length}`); return null; }
  const yLo = Math.min(...allVals) * 0.7;
  const yHi = Math.max(...allVals) * 1.1;
  const yRange = yHi - yLo || 1;
  // ⚠️ 必须放在 yLo/yHi/yRange 声明之后：Hermes 不做 TDZ 检查，提前访问只会得到 undefined，
  //    对 undefined 调 .toFixed 会整屏 Render Error（曾把皮质醇卡片打成红屏）。
  console.log(`🔥 [TREND] yLo=${yLo.toFixed(0)} yHi=${yHi.toFixed(0)} range=${yRange.toFixed(0)}`);

  // 坐标换算
  const xOfSlot = (slot: number) => padL + (slot / (SLOTS - 1)) * chartW;
  const yOf = (v: number) => padT + chartH - ((v - yLo) / yRange) * chartH;

  // 生成 SVG path (空槽 = 断线)
  const makePath = (arr: (number | null)[]) => {
    let d = '';
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += (started ? ' L' : 'M') + `${xOfSlot(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      started = true;
    });
    return d;
  };

  const basePath = makePath(baseline30);
  const todayPath = makePath(main30);

  // ★ v18.65 首页同款曲线样式：ringTeal 线 + 曲线下渐变面积（仅今日视图，历史日保持纯线）
  const mainIdxs = main30.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  const todayAreaPath =
    isMainToday && mainIdxs.length >= 2
      ? `${todayPath} L ${xOfSlot(mainIdxs[mainIdxs.length - 1]).toFixed(1)},${(padT + chartH).toFixed(1)} L ${xOfSlot(mainIdxs[0]).toFixed(1)},${(padT + chartH).toFixed(1)} Z`
      : '';

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
            <Stop offset="0%" stopColor={mm.colors.ringTeal} stopOpacity="0.34" />
            <Stop offset="100%" stopColor={mm.colors.ringTeal} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {todayAreaPath ? <Path d={todayAreaPath} fill="url(#trendArea)" /> : null}

        {/* 睡眠阴影 */}
        {sleepRects.map((sr, i) => (
          <Rect key={`s${i}`} x={sr.x} y={padT} width={Math.max(1, sr.w)} height={chartH} fill={theme.colors.ui.borderSoft + '33'} />
        ))}

        {/* Y 轴网格 + 刻度 */}
        {[0, 0.5, 1].map((p, i) => {
          const val = yLo + p * yRange;
          const y = padT + chartH - p * chartH;
          return (
            <G key={i}>
              <Line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke={theme.colors.ui.borderSoft} strokeWidth={1} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={y + 3} fontSize={9} fill={theme.colors.textSub} textAnchor="end">{val.toFixed(0)}</SvgText>
            </G>
          );
        })}

        {/* X 轴底线 */}
        <Line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke={theme.colors.ui.borderSoft} strokeWidth={1} />

        {/* 基线 (14天, 绿虚线) */}
        {basePath ? (
          <Path d={basePath} stroke={mm.colors.ink} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5,4" />
        ) : null}
        {/* 基线数据点 (绿色) */}
        {baseline30.map((v, i) => v != null && (
          <Circle key={'b'+i} cx={xOfSlot(i)} cy={yOf(v)} r={2} fill={mm.colors.ink} />
        ))}

        {/* 今天（★ v18.65 与首页同款：ringTeal 实线 2.6pt 圆头，不再用紫线+逐点圆） */}
        {todayPath ? (
          <Path d={todayPath} stroke={mm.colors.ringTeal} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {/* X 时间刻度 0/6/12/18/24 */}
        {[0, 6, 12, 18, 24].map((h) => {
          const slot = Math.min(h * 2, SLOTS - 1);
          return (
            <SvgText key={h} x={xOfSlot(slot)} y={H - 2} fontSize={9} fill={theme.colors.textSub} textAnchor="middle">{h === 24 ? '24' : h % 24}</SvgText>
          );
        })}
      </Svg>

      {/* 图例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.sp(0.5) }}>
        <Text style={{ fontSize: 11, color: theme.colors.textSub, marginHorizontal: 8 }}>
          <Text style={{ color: mm.colors.ink }}>- -</Text> 14 天基线
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.textSub, marginHorizontal: 8 }}>
          <Text style={{ color: mm.colors.ringTeal }}>—</Text> {mainLabel}
        </Text>
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
  let levelText = '正常', levelColor: string = mm.colors.ink;
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
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  levelDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 72, justifyContent: 'space-between', marginTop: theme.sp(0.5) },
  bar: { width: 8, borderRadius: 2 },
  timeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(0.5), paddingHorizontal: 2 },
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
