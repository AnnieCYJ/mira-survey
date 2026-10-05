/**
 * EmotionInsightView —— 「情绪洞察」统一视图（单一数据源，保证两处内容完全一致）
 *
 * 数据源：`computeStressReport()`（lib/stressAlgorithm.ts）
 *
 * 共用方：
 *  1) 首页 →「情绪消耗」点进去的 `EnergyDetailScreen`（type='emotion'）
 *  2) 洞察页 →「情绪压力」tab 下的情绪洞察卡
 *
 * 设计：shadcn/ui 语言 —— 描边白卡 + 薰衣草主色(accentSolid) + lucide 线性图标 + 中性文字。
 * 模块「开口式分区」渲染（无灰底盒子），情绪分布作为本页重点，做成最大「全天情绪点阵(24×4)」。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import {
  computeStressReport,
  formatPeakHour,
  type StressReport,
  type StressEvent,
} from '../lib/stressAlgorithm';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { dayKey } from '../data/healthStore';
import { ensureEmotionLogLoaded, getEntriesForDay, onEmotionLog, EVENT_LABEL, MOOD_LABEL, MOOD_COLOR, type EmotionEntry } from '../data/emotionLog';
import { HourHistogram } from './StressInsightCard';
// ★ 心理压力全天趋势图（首页心理压力卡点进来 / 洞察页情绪 tab 共用本视图）
import StressTrendChart, { stressPointsOf } from './StressTrendChart';
import { computeEmotionalStress } from '../lib/emotionalStress';

/** lucide 线性图标（stroke 1.8，统一栅格） */
function Lucide({ name, size = 13, color }: { name: string; size?: number; color: string }) {
  const P: Record<string, string> = {
    heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
    gauge: 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0',
    flower: 'M12 12a3 3 0 1 0 0-6 3 3 0 1 0 0 6Zm0 0a3 3 0 1 0 0 6 3 3 0 1 0 0-6Zm0 0a3 3 0 1 1-6 0 3 3 0 1 1 6 0Zm0 0a3 3 0 1 1 6 0 3 3 0 1 1-6 0Z',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8h.01M11 12h1v4h1',
  };
  if (!P[name]) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={P[name]} />
    </Svg>
  );
}

/** 等宽均分数据单元（与 MetricDetail statCell 同款；两处共用） */
export function StatCell({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      <Text
        style={[styles.statValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >{value}</Text>
      {sub ? <Text style={styles.statSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/* ── 5 档情绪色：与全仓情绪语义 token 一致 ── */
const COL_EXCITED = theme.colors.moodEnergy;   // 兴奋
const COL_PLEASANT = theme.colors.moodGood;    // 愉悦
const COL_CALM = theme.colors.stateTired;      // 平静
const COL_STRESSED = theme.colors.stateEnergy; // 压力
const COL_ANXIOUS = theme.colors.danger;       // 焦虑
const NEUTRAL = theme.colors.bgMidAlt;         // 情绪流动带底色（柔紫浅底）
const PRIMARY = theme.colors.accentSolid;      // 薰衣草主色

/** 事件 → 5 档情绪色（valenceLabel + severity 细分） */
const moodColor = (e: any): string => {
  if (!e) return NEUTRAL;
  const sev = e.severity || 50;
  if (e.valenceLabel === 'positive') return sev > 50 ? COL_EXCITED : COL_PLEASANT;
  if (e.valenceLabel === 'negative') return sev > 50 ? COL_ANXIOUS : COL_STRESSED;
  return COL_CALM;
};

/** 5 档情绪 → 中文标签（用于「今日主情绪」与图例） */
const MOOD_LABELS: { c: string; t: string }[] = [
  { c: COL_EXCITED, t: '兴奋' },
  { c: COL_PLEASANT, t: '愉悦' },
  { c: COL_CALM, t: '平静' },
  { c: COL_STRESSED, t: '压力' },
  { c: COL_ANXIOUS, t: '焦虑' },
];
const colorToLabel = (c: string): string =>
  (MOOD_LABELS.find((m) => m.c === c)?.t) ?? '平静';

/** 5 档情绪 → emoji（HERO 展示用；无记录时用中性符号，绝不假装有主情绪） */
const MOOD_EMOJI: Record<string, string> = {
  [COL_EXCITED]: '😆',
  [COL_PLEASANT]: '🙂',
  [COL_CALM]: '😌',
  [COL_STRESSED]: '😣',
  [COL_ANXIOUS]: '😰',
};

/**
 * 全天情绪点阵 —— 上 0–12 / 下 12–24 两段，每段 12 列(小时) × 4 行(15 分钟)。
 * 每个格子 = 一个 15 分钟时段，有记录则按情绪色绘实心圆点，无记录淡灰占位。
 * 横轴标注 12 / 24 边界（无纵轴）。
 */
export function MoodDotMatrix({ events }: { events: StressEvent[] }) {
  // 分桶：bySlot[hour][slot] = 该 15 分钟时段内的事件
  const bySlot: any[][][] = Array.from({ length: 24 }, () => [[], [], [], []]);
  for (const e of events) {
    if (!e || !Number.isFinite(e.t)) continue;
    const d = new Date(e.t);
    const h = d.getHours();
    const slot = Math.min(3, Math.floor(d.getMinutes() / 15));
    bySlot[h][slot].push(e);
  }
  const slotColor = (evs: any[]): string | null => {
    if (!evs.length) return null;
    const neg = evs.find((e) => { const c = moodColor(e); return c === COL_ANXIOUS || c === COL_STRESSED; });
    return moodColor(neg ?? evs[0]);
  };
  const section = (hours: number[], labels: number[]) => (
    <View key={hours[0]} style={styles.hmSection}>
      <View style={styles.hmCols}>
        {hours.map((h) => (
          <View key={h} style={styles.hmCol}>
            {[0, 1, 2, 3].map((s) => {
              const c = slotColor(bySlot[h][s]);
              return (
                <View key={s} style={styles.hmSlot}>
                  {c ? <View style={[styles.hmDot, { backgroundColor: c }]} /> : <View style={styles.hmDotEmpty} />}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <View style={styles.hmAxis}>
        {hours.map((h) => (
          <Text key={h} style={styles.hmAxisText}>{labels.includes(h) ? String(h).padStart(2, '0') : ''}</Text>
        ))}
      </View>
    </View>
  );
  return (
    <View style={styles.matrixWrap}>
      {section([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 3, 6, 9, 12])}
      {section([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], [12, 15, 18, 21, 24])}
      {/* 5 档情绪图例 */}
      <View style={styles.matrixLegend}>
        {MOOD_LABELS.map(({ c, t }) => (
          <View key={t} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: c }]} />
            <Text style={styles.legendText}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * 记录事件时间线 —— 点阵图下方把「手动心情记录」按时刻列出来。
 *
 * 为什么需要：点阵图只有 15 分钟格子的**颜色**，看不出「当时发生了什么」。
 * 用户在「记录此刻心情」里勾选的生活事件（工作/运动/饮食…）与备注，
 * 只有在这里才可见 —— 否则记录里的关键信息等于白填。
 *
 * 只列手动记录（`EmotionEntry`），不列 EDA 自动采样事件：那不是用户填的，
 * 列出来会变成 48 行噪音。
 */
function RecordEventTimeline({ entries }: { entries: EmotionEntry[] }) {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.t - b.t);
  return (
    <View style={styles.recWrap}>
      {sorted.map((e) => {
        const d = new Date(e.t);
        const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const tags = [
          ...(e.events ?? []).map((k) => EVENT_LABEL[k] ?? k),
          ...(e.customEvents ?? []),
        ];
        const moodColorHex = MOOD_COLOR[e.mood] ?? mm.colors.roseCore;
        return (
          <View key={e.id} style={styles.recRow}>
            <View style={styles.recTimeCol}>
              <View style={[styles.recDot, { backgroundColor: moodColorHex }]} />
              <Text style={styles.recTime}>{hhmm}</Text>
            </View>
            <View style={styles.recBody}>
              <Text style={styles.recMood}>{MOOD_LABEL[e.mood] ?? e.mood}</Text>
              {tags.length > 0 && (
                <View style={styles.recTags}>
                  {tags.map((t) => (
                    <View key={t} style={styles.recTag}>
                      <Text style={styles.recTagText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              {e.note ? <Text style={styles.recNote}>{e.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 小分区标题（开口式） */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** 今日概览大瓷片（shadcn：描边白卡 + 彩色值，不用灰底大色块） */
function SummaryTile({ icon, label, value, sub, valueColor }: {
  icon: string; label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        <Lucide name={icon} size={12} color={valueColor ?? theme.colors.textSub} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

/** 手动心情记录 → 点阵伪事件：按记录时刻落进对应 15 分钟槽，5 档映射到点阵色。
 *  兴奋=正性·高强度 / 开心=正性 / 平静=中性 / 压力=负性 / 难过=负性·高强度（→ 焦虑色）。 */
function selfEntryToEvent(e: EmotionEntry): StressEvent {
  const valence: 'positive' | 'negative' | 'neutral' =
    e.mood === 'excited' || e.mood === 'happy' ? 'positive'
      : e.mood === 'stressed' || e.mood === 'sad' ? 'negative'
        : 'neutral';
  const severity = e.mood === 'excited' || e.mood === 'sad' ? 80 : 30;
  const d = new Date(e.t);
  return {
    t: e.t,
    hour: d.getHours(),
    minute: d.getMinutes(),
    eda: 0,
    baseline: 0,
    z: 0,
    severity,
    level: 'mid',
    recoverySec: null,
    valenceLabel: valence,
  } as unknown as StressEvent;
}

/**
 * 「情绪洞察」主体（日视图）：全天情绪点阵（上 0–12 / 下 12–24）+ 情绪节律（高峰 / 低谷）。
 * 可选 anchorMs：传则展示该「锚定日」的全天（历史日 23:59:59.999，今天=此刻）。
 * ★ 数据 = EDA 采样事件 + 用户手动心情记录（emotionLog，写入即经事件总线刷新）。
 */
export default function EmotionInsightView({ anchorMs }: { anchorMs?: number } = {}) {
  const dk = dayKey(anchorMs ?? Date.now());
  const [selfEntries, setSelfEntries] = useState<EmotionEntry[]>([]);

  // 载入手动记录 + 订阅变更（「记录此刻心情」写入后 emit → 点阵/节律卡即时刷新）
  useEffect(() => {
    let alive = true;
    void ensureEmotionLogLoaded().then(() => {
      if (alive) setSelfEntries(getEntriesForDay(dk));
    });
    const off = onEmotionLog(() => setSelfEntries(getEntriesForDay(dk)));
    return () => { alive = false; off(); };
  }, [dk]);

  const report: StressReport = computeStressReport(reportNowMsForDay(anchorMs ?? Date.now()));
  // ★ 心理压力趋势：与首页「心理压力」大数字读同一份 computeEmotionalStress 报告
  const esReport = (() => {
    try { return computeEmotionalStress(reportNowMsForDay(anchorMs ?? Date.now()), null); }
    catch { return null; }
  })();
  const stressPts = stressPointsOf(esReport);
  const stressScale = esReport?.stressScoreVisible ? esReport.stressScale : null;
  // 「此刻」槽位：今天按当前时刻；历史日不画此刻线
  const nowSlot = (anchorMs ?? Date.now()) ? (() => {
    const t = reportNowMsForDay(anchorMs ?? Date.now());
    const d = new Date(t);
    const isToday = d.toDateString() === new Date().toDateString();
    if (!isToday) return null;
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.max(0, Math.min(47, Math.floor((t - midnight) / 1800000)));
  })() : null;
  const selfEvents = selfEntries.map(selfEntryToEvent);
  // 合并：手动记录 + EDA 采样，按时间升序；手动记录在同槽内优先展示（slotColor 取优先级）
  const allEvents = [...selfEvents, ...report.events].sort((a, b) => a.t - b.t);
  const hasData = report.sampleCount >= 5 || allEvents.length > 0;

  // ★ v18.106：无数据 ≠ 只丢一行小字（用户口径：「什么占位都没有就没了」）。
  //   保留「空图表骨架」（点阵空槽网格）+ 两个结论瓷片写「—」+ 一行说明。
  if (!hasData) {
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.title}>情绪洞察</Text>
          <Text style={styles.emptyText}>
            还没有足够的情绪数据 · 时间轴为「无事件」占位（不计入统计）。连上戒指开启自动监测，约 30 分钟后开始生成个人基线。
          </Text>
          <SectionTitle>心理压力 · 全天趋势</SectionTitle>
          <StressTrendChart points={stressPts} scale={stressScale} nowSlot={nowSlot} />
          <SectionTitle>全天情绪点阵</SectionTitle>
          <MoodDotMatrix events={[]} />
          <SectionTitle>情绪节律</SectionTitle>
          <View style={styles.hmCardsRow}>
            <SummaryTile icon="clock" label="情绪高峰" value="—" sub="消极最集中" valueColor={theme.colors.textSub} />
            <SummaryTile icon="moon" label="情绪低谷" value="—" sub="情绪最舒缓" valueColor={theme.colors.textSub} />
          </View>
        </View>
      </Card>
    );
  }

  const eventCount = allEvents.length;

  // 时段峰谷：高峰 = 消极情绪最集中的小时；低谷 = 消极最少的小时
  const hourNegD = Array(24).fill(0);
  const hourAllD = Array(24).fill(0);
  for (const e of allEvents) {
    const h = new Date(e.t ?? Date.now()).getHours();
    hourAllD[h] += 1;
    const c = moodColor(e);
    if (c === COL_ANXIOUS || c === COL_STRESSED) hourNegD[h] += 1;
  }
  let peakHourD = -1, calmHourD = -1;
  if (hourAllD.some((v: number) => v > 0)) {
    let bestP = -1;
    for (let h = 0; h < 24; h++) {
      if (hourNegD[h] === 0) continue;
      const score = hourNegD[h] * 100 + hourAllD[h];
      if (score > bestP) { bestP = score; peakHourD = h; }
    }
    let bestC = Infinity, bestCP = -1;
    for (let h = 0; h < 24; h++) {
      if (hourAllD[h] === 0) continue;
      const neg = hourNegD[h];
      const pleasant = hourAllD[h] - hourNegD[h];
      if (neg < bestC || (neg === bestC && pleasant > bestCP)) { bestC = neg; bestCP = pleasant; calmHourD = h; }
    }
    if (peakHourD < 0) { let m = -1; for (let h = 0; h < 24; h++) if (hourAllD[h] > m) { m = hourAllD[h]; peakHourD = h; } }
  }
  const hourLabelD = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  const peakRange = peakHourD >= 0 ? hourLabelD(peakHourD) : '—';
  const calmRange = calmHourD >= 0 ? hourLabelD(calmHourD) : '—';

  return (
    <Card padded={false}>
      <View style={styles.pad}>
        {/* 心理压力 · 全天趋势（★ 折线，与首页心理压力大数字同源） */}
        <SectionTitle>心理压力 · 全天趋势</SectionTitle>
        <StressTrendChart points={stressPts} scale={stressScale} nowSlot={nowSlot} />

        {/* 全天情绪点阵（上 0–12 / 下 12–24） */}
        <SectionTitle>全天情绪点阵</SectionTitle>
        <MoodDotMatrix events={allEvents} />
        {selfEvents.length > 0 && (
          <>
            <Text style={styles.hint}>含手动心情记录 {selfEvents.length} 条（按记录时刻落在对应时段）</Text>
            {/* ★ 点阵图下方把记录内容摊开：时刻 + 心情 + 生活事件标签 + 备注 */}
            <RecordEventTimeline entries={selfEntries} />
          </>
        )}
        {eventCount === 0 && (
          <Text style={styles.hint}>今天还没有情绪事件采样 · 用页面底部的「记录此刻心情」记下第一笔</Text>
        )}

        {/* 情绪高峰 / 低谷（时段结论） */}
        <SectionTitle>情绪节律</SectionTitle>
        <View style={styles.hmCardsRow}>
          <SummaryTile icon="clock" label="情绪高峰" value={peakRange} sub="消极最集中" valueColor={COL_STRESSED} />
          <SummaryTile icon="moon" label="情绪低谷" value={calmRange} sub="情绪最舒缓" valueColor={COL_CALM} />
        </View>

        {/* 周期提示 */}
        <View style={styles.cycleCard}>
          <Lucide name="flower" size={16} color={COL_ANXIOUS} />
          <Text style={styles.cycleText}>
            情绪随周期波动属正常节律 · 周期为推算（日历 + 体温），不构成诊断。
          </Text>
        </View>
      </View>
    </Card>
  );
}

const DOT_CELL = theme.sp(3.8);  // 每行(15 分钟)槽高
const DOT_SIZE = theme.sp(3.2);  // 圆点直径（放大，便于辨识）

const styles = StyleSheet.create({
  pad: { padding: theme.space.cardPad },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },

  sectionTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.space.lg,
    marginBottom: theme.sp(2),
  },

  // 记录事件时间线（点阵图下方）
  recWrap: { marginTop: theme.space.sm, gap: theme.sp(1.5) },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(1.5) },
  recTimeCol: { flexDirection: 'row', alignItems: 'center', gap: 4, width: theme.sp(11) },
  recDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(1) },
  recTime: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontVariant: ['tabular-nums'] },
  recBody: { flex: 1, paddingBottom: theme.sp(1.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.ui.borderSoft },
  recMood: { fontSize: theme.fontSize.xs, color: theme.colors.textTitle, fontWeight: theme.weight.medium as any },
  recTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  recTag: {
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBgSoft,
  },
  recTagText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  recNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 3 },

  // 全天情绪点阵容器
  matrixWrap: { width: '100%' },
  matrixLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: theme.sp(2.5), gap: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25) },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },

  // 全天情绪点阵：上 0–12 / 下 12–24 两段，每段 12 列(小时) × 4 行(15 分钟)
  hmSection: { marginBottom: theme.sp(2) },
  hmCols: { width: '100%', flexDirection: 'row' },
  hmCol: { flex: 1, flexDirection: 'column' },
  hmSlot: { height: DOT_CELL, alignItems: 'center', justifyContent: 'center' },
  hmDot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  hmDotEmpty: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: 'rgba(0,0,0,0.06)' },
  hmAxis: { flex: 1, flexDirection: 'row', marginTop: theme.sp(0.5) },
  hmAxisText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  hint: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(1.5), lineHeight: theme.fontSize.xs * 1.5 },

  // 今日情绪双卡（描边瓷片）
  tile: {
    flex: 1, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md, padding: theme.space.cardPadCompact, marginBottom: theme.space.sm,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.75), marginBottom: theme.sp(1) },
  tileLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  tileValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.card * 1.2 },
  tileSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), lineHeight: theme.fontSize.micro * 1.4 },

  // 周期提示条
  cycleCard: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
    backgroundColor: '#FDF4F9', borderWidth: 1, borderColor: '#F0DCEA', borderRadius: theme.radius.md, padding: theme.sp(2), marginTop: theme.sp(2) },
  cycleText: { flex: 1, fontSize: theme.fontSize.xs, color: '#A8628C', lineHeight: theme.fontSize.xs * 1.5 },

  // 情绪高峰 / 低谷 双卡行
  hmCardsRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.sp(1.5) },

  // 兼容 EnergyDetailScreen 的 StatCell（维持原样）
  statCell: {
    flex: 1, alignItems: 'center',
    paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1),
    borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5),
  },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  statValue: {
    fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle, lineHeight: theme.fontSize.card * 1.2, textAlign: 'center',
  },
  statSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.5, marginTop: theme.sp(1) },
});
