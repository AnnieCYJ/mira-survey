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
import Card from './Card';
import { healthStore, dayKey } from '../data/healthStore';
import { analyzeCortisol, type CortisolSample, type CortisolRhythmResult } from '../lib/cortisolRhythm';

const LEVEL_META: Record<string, { label: string; color: string }> = {
  normal: { label: '节律正常', color: "#2ECC71" },
  sustained_high: { label: '持续偏高', color: theme.colors.danger },
  dysregulated: { label: '节律紊乱', color: theme.colors.stateTense },
};

const LOOKBACK_DAYS = 14;

/** 拉取近 14 天 cortisol 逐样本（已剔除零值），含离线回填日。 */
function collectSamples(): CortisolSample[] {
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

/** 从 healthStore 睡眠数据推导 sleepWindow (bedHour/wakeHour) */
function getSleepWindow(): { bedHour: number; wakeHour: number } | null {
  const todayDk = dayKey(Date.now());
  const sleepSum = healthStore.getSleep(todayDk);
  if (!sleepSum || !sleepSum.sleepTime || !sleepSum.wakeTime) return null;
  const parseHM = (s: string) => {
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : null;
  };
  const bedH = parseHM(sleepSum.sleepTime);
  const wakeH = parseHM(sleepSum.wakeTime);
  if (bedH == null || wakeH == null) return null;
  return { bedHour: Math.floor(bedH), wakeHour: Math.floor(wakeH) };
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
  const linePath = valid.length >= 2 ? valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.h).toFixed(1)} ${yOf(p.v).toFixed(1)}`).join(' ') : '';
  const areaPath = linePath ? `${linePath} L ${xOf(23).toFixed(1)} ${CHART_H - pad} L ${xOf(0).toFixed(1)} ${CHART_H - pad} Z` : '';
  const p25Y = Number.isFinite(r.baseline.p25) ? yOf(r.baseline.p25) : null;
  const p75Y = Number.isFinite(r.baseline.p75) ? yOf(r.baseline.p75) : null;
  const bandPath = (p25Y != null && p75Y != null) ? `M ${xOf(0)} ${p75Y} L ${xOf(23)} ${p75Y} L ${xOf(23)} ${p25Y} L ${xOf(0)} ${p25Y} Z` : '';

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H + 24} style={{ alignSelf: 'center' }}>
        {/* 正常范围色带 */}
        {bandPath ? <Path d={bandPath} fill="#2ECC7122" /> : null}
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
        {/* 面积 */}
        {areaPath ? <Path d={areaPath} fill={theme.colors.accentSolid + '15'} /> : null}
        {/* 折线 */}
        {linePath ? <Path d={linePath} stroke={theme.colors.accentSolid} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {/* 数据点 */}
        {valid.map((p, i) => {
          const asleep = isAsleep(p.h);
          const inBand = !asleep && p.v >= r.baseline.p25 && p.v <= r.baseline.p75;
          const color = inBand ? "#2ECC71" : asleep ? theme.colors.ui.borderSoft : theme.colors.danger;
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
function TrendChart({ r, sleepWindow }: { r: CortisolRhythmResult; sleepWindow?: { bedHour: number; wakeHour: number } | null }) {
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

  // 14 天基线 + cosinor 填补空
  let baseline30 = aggregate30m(collectSamples());
  const cos = r.cosinor;
  if (Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && cos.amplitude > 0 && Number.isFinite(cos.acrophaseH)) {
    const TWO_PI = Math.PI * 2;
    for (let slot = 0; slot < SLOTS; slot++) {
      if (baseline30[slot] == null) {
        const h = slot / 2;
        baseline30[slot] = Math.max(0, +(cos.mesor + cos.amplitude * Math.cos(TWO_PI * (h - cos.acrophaseH) / 24)).toFixed(1));
      }
    }
  }

  // 今天
  const todayDK = dayKey(Date.now());
  const todayRaw = healthStore.getIntraday('cortisol', todayDK)
    .filter((p) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
    .map((p) => ({ t: p.t, v: p.v } as CortisolSample));
  const today30 = aggregate30m(todayRaw);
  const todayNonNull = today30.filter(v => v != null).length;
  const baseNonNull = baseline30.filter(v => v != null).length;
  console.log(`🔥 [TREND] todayRaw=${todayRaw.length} todayNonNull=${todayNonNull}/48 baselineNonNull=${baseNonNull}/48`);

  // 对 todayRaw 单独跑 analyzeCortisol, 拿今天自己的 cosinor 节律来填补
  const todayR = analyzeCortisol(todayRaw, 1);
  const tcos = todayR.cosinor;
  if (Number.isFinite(tcos.mesor) && Number.isFinite(tcos.amplitude) && tcos.amplitude > 0 && Number.isFinite(tcos.acrophaseH)) {
    const TWO_PI = Math.PI * 2;
    for (let slot = 0; slot < 48; slot++) {
      if (today30[slot] == null) {
        const h = slot / 2;
        const pred = tcos.mesor + tcos.amplitude * Math.cos(TWO_PI * (h - tcos.acrophaseH) / 24);
        today30[slot] = Math.max(0, +pred.toFixed(1));
      }
    }
  }

  // Y 轴范围
  const allVals = [...baseline30, ...today30].filter((v): v is number => v != null);
  if (allVals.length < 2) { console.log(`[TREND-SKIP] allVals=${allVals.length}`); return null; }
  const yLo = Math.min(...allVals) * 0.7;
  const yHi = Math.max(...allVals) * 1.1;
  const yRange = yHi - yLo || 1;

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
  const todayPath = makePath(today30);

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
          <Path d={basePath} stroke={"#2ECC71"} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5,4" />
        ) : null}

        {/* 今天 (蓝实线) */}
        {todayPath ? (
          <Path d={todayPath} stroke={"#7C6AE0"} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {/* 今天数据点 */}
        {today30.map((v, i) => v != null && (
          <Circle key={i} cx={xOfSlot(i)} cy={yOf(v)} r={2.5} fill={"#7C6AE0"} />
        ))}

        {/* X 时间刻度 0/6/12/18/24 */}
        {[0, 6, 12, 18, 24].map((h) => {
          const slot = Math.min(h * 2, SLOTS - 1);
          return (
            <SvgText key={h} x={xOfSlot(slot)} y={H - 2} fontSize={9} fill={theme.colors.textSub} textAnchor="middle">{h % 24}</SvgText>
          );
        })}
      </Svg>

      {/* 图例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.sp(0.5) }}>
        <Text style={{ fontSize: 11, color: theme.colors.textSub, marginHorizontal: 8 }}>
          <Text style={{ color: "#2ECC71" }}>- -</Text> 14 天基线
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.textSub, marginHorizontal: 8 }}>
          <Text style={{ color: "#7C6AE0" }}>●</Text> 今天
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
  let levelText = '正常', levelColor = "#2ECC71";
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
