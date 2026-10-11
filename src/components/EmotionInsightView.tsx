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
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import Card from './Card';
import {
  computeStressReport,
  formatPeakHour,
  type StressReport,
  type StressEvent,
} from '../lib/stressAlgorithm';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { healthStore, dayKey } from '../data/healthStore';
import { ensureEmotionLogLoaded, getEntriesForDay, onEmotionLog, EVENT_LABEL, MOOD_LABEL, MOOD_COLOR, type EmotionEntry } from '../data/emotionLog';
import { HourHistogram } from './StressInsightCard';
// ★ 心理压力全天趋势图（首页心理压力卡点进来 / 洞察页情绪 tab 共用本视图）
import StressTrendChart, { stressPointsOf } from './StressTrendChart';
import { computeEmotionalStress } from '../lib/emotionalStress';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';

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

/**
 * ★ 2026-10-09（psychological-stress-preview .dots / MOOD 表）：**点阵专用配色**。
 *   与堆叠柱（EmotionRangeBars）那套不同 —— 稿里点阵是
 *   平静 #BCCB62(黄绿) / 愉悦·兴奋 #F0C46E(黄) / 压力·焦虑 #F2A3C6(粉) / 疲惫 #7EA6F8(蓝)
 *   / 睡眠 #EAE7E2 / 无记录 #BDB7AE。
 */
const DOT_BY_MOOD: Record<string, string> = {
  [COL_CALM]: '#B8C86A',
  [COL_PLEASANT]: '#F2C35E',
  [COL_EXCITED]: '#F39A62',
  [COL_STRESSED]: '#D58AAE',
  [COL_ANXIOUS]: '#C9789F',
};
const DOT_EMPTY = '#BDB7AE';
const DOT_SLEEP = '#EAE7E2';
/** 点阵图例（与点阵同色，避免图例和格子颜色对不上） */
const DOT_LEGEND: { c: string; t: string }[] = [
  { c: '#F39A62', t: '兴奋' },
  { c: '#F2C35E', t: '开心' },
  { c: '#B8C86A', t: '平静' },
  { c: '#D58AAE', t: '压力' },
  { c: '#7EA6F8', t: '难过' },
  { c: DOT_SLEEP, t: '睡眠' },
];
const dotColorOf = (e: any): string => DOT_BY_MOOD[moodColor(e)] ?? DOT_EMPTY;

/**
 * ★ 2026-10-10（用户）：戒指 SDK 原生 emotionLevel(−10~10) 日均值 → 情绪方向标签。
 *   ★ 复用 stressAlgorithm.ts:571-601 的**同一基底映射**（emotionNow×10 → ±20 阈值）：
 *      score ≥ 20 → positive / ≤ −20 → negative / 否则 neutral。
 *   不直接出 5 档色，而是交给下方 moodColor() —— 与事件日点阵完全同一套颜色逻辑，
 *   保证「戒指回填点」和「EDA 事件点」「手动记录点」颜色口径一致、不另起一套。
 *   无戒指值返回 null。
 */
const ringValenceLabel = (v: number | null): 'positive' | 'negative' | 'neutral' | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const score = v * 10; // ★ 与算法一致：emotionLevel[-10,10] → [-100,100]
  if (score >= 20) return 'positive';
  if (score <= -20) return 'negative';
  return 'neutral';
};

/** 设备 emotionLevel(-10~10) → 与手动记录一致的五档情绪。 */
const ringEmotionDot = (v: number | null): string | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= 6) return '#F39A62';       // 兴奋
  if (v >= 2) return '#F2C35E';       // 开心
  if (v > -2) return '#B8C86A';       // 平静
  if (v > -6) return '#D58AAE';       // 压力
  return '#7EA6F8';                   // 难过
};

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
export function MoodDotMatrix({ events, fallbackMood = null, sleepWindow = null }: { events: StressEvent[]; fallbackMood?: string | null; sleepWindow?: { bedHour: number; wakeHour: number } | null }) {
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
    const manual = evs.find((e) => e.isManual);
    if (manual) {
      if (manual.manualMood === 'excited') return '#F39A62';
      if (manual.manualMood === 'happy') return '#F2C35E';
      if (manual.manualMood === 'calm') return '#B8C86A';
      if (manual.manualMood === 'stressed') return '#D58AAE';
      if (manual.manualMood === 'sad') return '#7EA6F8';
      return dotColorOf(manual);
    }
    const neg = evs.find((e) => { const c = moodColor(e); return c === COL_ANXIOUS || c === COL_STRESSED; });
    // ★ 点阵用点阵配色（不是堆叠柱那套）
    return dotColorOf(neg ?? evs[0]);
  };
  const section = (hours: number[], labels: number[]) => (
    <View key={hours[0]} style={styles.hmSection}>
      <View style={styles.hmCols}>
        {hours.map((h) => (
          <View key={h} style={styles.hmCol}>
            {[0, 1, 2, 3].map((s) => {
              const c = slotColor(bySlot[h][s]);
              const hour = h + s / 4;
              const now = new Date();
              const isTodaySlotPast = h < now.getHours() || (h === now.getHours() && s <= Math.floor(now.getMinutes() / 15));
              const inSleep = !!sleepWindow && (sleepWindow.bedHour > sleepWindow.wakeHour
                ? (hour >= sleepWindow.bedHour || hour < sleepWindow.wakeHour)
                : (hour >= sleepWindow.bedHour && hour < sleepWindow.wakeHour));
              // 空槽且当天无手动记录 → 戒指情绪回填（半透明，明确标参考、不冒充手动）
              const useFallback = !c && !!fallbackMood && isTodaySlotPast;
              return (
                <View key={s} style={styles.hmSlot}>
                  {c ? (
                    <View style={[styles.hmDot, { backgroundColor: c }]} />
                  ) : inSleep ? (
                    <View style={[styles.hmDot, styles.sleepDot]}><Text style={styles.sleepGlyph}>☾</Text></View>
                  ) : useFallback ? (
                    <View style={[styles.hmDot, { backgroundColor: fallbackMood, opacity: 0.4 }]} />
                  ) : (
                    <View style={styles.hmDotEmpty} />
                  )}
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
    isManual: true,
    manualMood: e.mood,
  } as unknown as StressEvent;
}

/**
 * 「情绪洞察」主体（日视图）：全天情绪点阵（上 0–12 / 下 12–24）+ 情绪节律（高峰 / 低谷）。
 * 可选 anchorMs：传则展示该「锚定日」的全天（历史日 23:59:59.999，今天=此刻）。
 * ★ 数据 = EDA 采样事件 + 用户手动心情记录（emotionLog，写入即经事件总线刷新）。
 */
export default function EmotionInsightView({
  anchorMs,
  variant = 'both',
}: {
  anchorMs?: number;
  /**
   * ★ 2026-10-09（psychological-stress-preview）：情绪详情页分 **两个 tab**——
   *   'stress' = 心理压力（全天趋势 + 图例 + 详细数据）；'emotion' = 情绪记录（点阵 + 今日记录 + 节律）。
   *   洞察页不传 → 'both'（两块都显示，行为与原来一致）。
   */
  variant?: 'both' | 'stress' | 'emotion';
} = {}) {
  const dk = dayKey(anchorMs ?? Date.now());
  const showStress = variant !== 'emotion';
  const showEmotion = variant !== 'stress';

  // ★ 2026-10-10（用户）：戒指客观情绪参考 —— SDK 原生 emotionLevel(−10~10) 每日均值，
  //   作为「心理情绪记录」的客观参考，明确标注为参考、不做评分（Mira 以用户自报为主）。
  const ringEmotion = healthStore.getDay('emotion', dk)?.mean ?? null;
  const ringEmotionLabel = ringEmotion == null ? '—' : ringEmotion >= 4 ? '偏积极' : ringEmotion <= -4 ? '偏消极' : '平稳';
  const ringEmotionColor = ringEmotion == null ? theme.colors.textSub
    : ringEmotion >= 4 ? theme.colors.success
    : ringEmotion <= -4 ? theme.colors.danger
    : theme.colors.textSub;
  const [selfEntries, setSelfEntries] = useState<EmotionEntry[]>([]);
  // ★ 2026-10-09（psychological-stress-preview）：趋势图下方「详细数据」折叠，默认收起
  const [stressOpen, setStressOpen] = useState(false);
  // ★ 2026-10-10（用户）：详情页日视图趋势与周/月/年（StressRangeView，L 档 240）等高 ——
  //   心理压力主趋势统一 **L 档（240）**，不再用 M 档 180（chart-size-unified-spec：详情页主趋势 = L）
  const chartH = chart.h.l;

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
  // ★ 睡眠窗：从 cognitive load report 拿
  const sleepWindow = (() => {
    try { return computeCognitiveLoadReport(reportNowMsForDay(anchorMs ?? Date.now())).sleepWindow ?? null; }
    catch { return null; }
  })();
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
  // ★ 2026-10-10（用户）：当天「没有手动心情记录」时，用戒指情绪(−10~10)按现有映射回填点阵空槽。
  //   —— 复用 ringValenceLabel（emotionNow×10 → ±20 阈值）+ 现有 moodColor()，与事件日点阵同一套色。
  //   —— 当天有手动记录 → 以手动为主、不回填（用户一记即切回；onEmotionLog 订阅即时刷新）。
  const ringFallbackMood = selfEntries.length === 0 && ringEmotion != null
    ? ringEmotionDot(ringEmotion)
    : null;
  const hasData = report.sampleCount >= 5 || allEvents.length > 0;

  // ★ v18.106：无数据 ≠ 只丢一行小字（用户口径：「什么占位都没有就没了」）。
  //   ★ 2026-10-10（用户）：空态也必须遵守 variant 分流 ——
  //     心理压力 tab 只放全天趋势（空骨架），情绪记录 tab 只放点阵 + 节律；
  //     不允许空态把两个 tab 的内容全塞进一张卡。
  if (!hasData) {
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.title}>{variant === 'stress' ? '心理压力' : '情绪记录'}</Text>
          <Text style={styles.emptyText}>
            还没有足够的情绪数据 · 时间轴为「无事件」占位（不计入统计）。连上戒指开启自动监测，约 30 分钟后开始生成个人基线。
          </Text>
          {showStress && (
            <>
              <SectionTitle>心理压力 · 全天趋势</SectionTitle>
              <StressTrendChart points={stressPts} scale={stressScale} nowSlot={nowSlot} chartH={chartH} sleepWindow={sleepWindow} />
            </>
          )}
          {showEmotion && (
            <>
              <SectionTitle>全天情绪点阵</SectionTitle>
              <MoodDotMatrix events={[]} fallbackMood={ringFallbackMood} />
              <SectionTitle>情绪节律</SectionTitle>
              <View style={styles.hmCardsRow}>
                <SummaryTile icon="clock" label="情绪高峰" value="—" sub="消极最集中" valueColor={theme.colors.textSub} />
                <SummaryTile icon="moon" label="情绪低谷" value="—" sub="情绪最舒缓" valueColor={theme.colors.textSub} />
              </View>
            </>
          )}
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
        {/* Tab「心理压力」：全天趋势（★ 折线，与首页心理压力大数字同源）
            ★ 2026-10-09（psychological-stress-preview）：补三档图例 + 轴说明 + 「详细数据」折叠 */}
        {showStress ? (
          <>
        <SectionTitle>心理压力 · 全天趋势</SectionTitle>
        <StressTrendChart points={stressPts} scale={stressScale} nowSlot={nowSlot} chartH={chartH} sleepWindow={sleepWindow} />
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.danger }]} />
            <Text style={styles.legendText}>高压力</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.warn }]} />
            <Text style={styles.legendText}>中压力</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.success }]} />
            <Text style={styles.legendText}>低压力</Text>
          </View>
        </View>
        <Text style={styles.axisNote}>
          纵轴 = 心理压力 0–100（越高越紧张，50 = 个人基线）· 横轴 = 一天 24h · 夜间为睡眠，不展示压力数据
        </Text>
        <TouchableOpacity
          style={styles.mhRow}
          activeOpacity={0.7}
          onPress={() => setStressOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={stressOpen ? '收起详细数据' : '展开详细数据'}
        >
          <Text style={styles.mhLabel}>详细数据</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.mhCount}>2 项</Text>
            <View style={[styles.mhChev, stressOpen && styles.mhChevOpen]} />
          </View>
        </TouchableOpacity>
        {stressOpen ? (
          <View style={styles.rowsBox}>
            <View style={styles.rowItem}>
              <Text style={styles.rowK}>压力事件次数</Text>
              <Text style={styles.rowV}>
                {eventCount}
                <Text style={styles.rowVSmall}>次</Text>
              </Text>
            </View>
            <View style={[styles.rowItem, styles.rowItemLast]}>
              <Text style={styles.rowK}>峰值时段</Text>
              <Text style={styles.rowV}>{peakRange}</Text>
            </View>
          </View>
        ) : null}
          </>
        ) : null}

        {/* Tab「情绪记录」：心情点阵 + 今日自报 + 情绪节律 */}
        {showEmotion ? (
          <>
        {/* 全天情绪点阵（上 0–12 / 下 12–24） */}
        <SectionTitle>全天情绪点阵</SectionTitle>
        <MoodDotMatrix events={allEvents} fallbackMood={ringFallbackMood} sleepWindow={sleepWindow} />
        {/* ★ 2026-10-09（稿 .dotsCap）：点阵图例 + 口径说明 */}
        <View style={styles.dotLegend}>
          {DOT_LEGEND.map((m) => (
            <View key={m.t} style={styles.dotLegendItem}>
              <View style={[styles.dotLegendDot, { backgroundColor: m.c }]} />
              <Text style={styles.dotLegendText}>{m.t}</Text>
            </View>
          ))}
        </View>
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
          </>
        ) : null}
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
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: theme.sp(2), gap: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25) },
  // ★ 2026-10-09（psychological-stress-preview .legend 11px）
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ★ 2026-10-09（psychological-stress-preview 新增）：轴说明 + 统一折叠头 + 行式明细
  axisNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1), lineHeight: theme.fontSize.micro * 1.4 },
  // ★ 2026-10-10（用户选 G · 数量提示 pill）：去灰底描边盒，扁平行 + 顶部发丝线 + 右侧「N 项」pill
  mhRow: {
    flexDirection: 'row', alignItems: 'center',     justifyContent: 'space-between',
    marginTop: theme.space.sm,
    paddingVertical: theme.sp(2.25), paddingHorizontal: 0,
  },
  mhCount: {
    fontSize: theme.fontSize.micro, color: mm.colors.limeDeep,
    backgroundColor: mm.colors.limeSoft,
    paddingVertical: theme.sp(0.5), paddingHorizontal: theme.sp(1.5),
    borderRadius: theme.radius.pill, fontWeight: theme.weight.semibold as any,
    marginRight: theme.sp(2),
  },
  mhLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textInk, fontWeight: theme.weight.semibold as any },
  mhChev: {
    width: theme.sp(2), height: theme.sp(2),
    borderRightWidth: 1.6, borderBottomWidth: 1.6, borderColor: theme.colors.textSub,
    transform: [{ rotate: '45deg' }], marginRight: theme.sp(0.75),
  },
  mhChevOpen: { transform: [{ rotate: '-135deg' }] },
  rowsBox: { marginTop: theme.sp(1.5) },
  rowItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: theme.sp(2.25), borderBottomWidth: 1, borderBottomColor: theme.colors.ui.borderSoft,
  },
  rowItemLast: { borderBottomWidth: 0 },
  rowK: { fontSize: theme.fontSize.xs, color: theme.colors.textInk },
  rowV: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any, color: theme.colors.textInk },
  rowVSmall: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular as any, color: theme.colors.textSub, marginLeft: theme.sp(1) },

  // 全天情绪点阵：上 0–12 / 下 12–24 两段，每段 12 列(小时) × 4 行(15 分钟)
  hmSection: { marginBottom: theme.sp(2) },
  hmCols: { width: '100%', flexDirection: 'row' },
  hmCol: { flex: 1, flexDirection: 'column' },
  hmSlot: { height: DOT_CELL, alignItems: 'center', justifyContent: 'center' },
  hmDot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  sleepDot: { backgroundColor: '#E8E1F7', borderWidth: 1, borderColor: '#A99BD6', alignItems: 'center', justifyContent: 'center' },
  sleepGlyph: { fontSize: 8, lineHeight: 10, color: '#806FB5' },
  // ★ 2026-10-09（稿 .dots 无记录色 #BDB7AE）
  hmDotEmpty: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: DOT_EMPTY },
  // ★ 点阵图例（与格子同色）
  dotLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2), marginTop: theme.sp(2) },
  dotLegendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  dotLegendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25) },
  dotLegendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ★ 稿 .dotsCap 10.5px
  dotsCap: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.fontSize.micro * 1.5 },
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

  // ★ 2026-10-09（psychological-stress-preview .statRow .tile）：与 EnergyDetailScreen 同为
  //   无底色描边小格（radius 11 / 标签 11px / 值 15px·650）
  statCell: {
    flex: 1, alignItems: 'center',
    paddingVertical: theme.sp(2.25), paddingHorizontal: theme.sp(2.5),
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder,
    backgroundColor: 'transparent',
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  statValue: {
    fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle, lineHeight: theme.fontSize.body * 1.2, textAlign: 'center',
  },
  statSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.5, marginTop: theme.sp(1) },

  // ★ 2026-10-10（用户）：戒指客观情绪参考卡 —— 明确「参考、非评分」，不与用户自报冲突
  ringRefCard: {
    marginTop: theme.sp(2), padding: theme.sp(2),
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.cardBg,
  },
  ringRefHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1), marginBottom: theme.sp(1.5) },
  ringRefTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, fontWeight: theme.weight.medium as any },
  ringRefBody: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(1.5) },
  ringRefValue: { fontSize: theme.sp(5.5), fontWeight: theme.weight.semibold as any, lineHeight: theme.sp(7) },
  ringRefLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textTitle },
  ringRefNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: theme.fontSize.micro * 1.45 },
});
