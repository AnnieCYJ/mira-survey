/**
 * JourneyDayView —— 单日旅程（曲线流）
 *
 * 使用位置：
 *   · ★ 2026-10-12 起：Calendar 月历**点某一天 → 下抽屉**（DayDrawer）里展示那一天；
 *     Calendar 页顶部原「日 / 月」tab 已移除。
 *   · 不传 `date` 时锚点 = 今天（等同旧的「今日旅程」行为）。
 *
 * ★ 2026-10-10（用户，方案 A + 补充）：顶部日期条横滑——
 *   选中那天**自动滚动居中 + 紫底变色**，中央渐变曲线**从选中格正下方引出**、
 *   向下延伸，左右交替白卡挂两侧；曲线加粗（4.5）+ 卡片收窄（50%）保证线明显可见。
 *   数据 = buildTodayTimeline(date)（真实生理数据 + 用户自报，无 AI，品牌铁律）。
 *
 * ⚠️ 布局采用**固定行高 + 逐点生成 SVG 路径**（见 docs/design-tokens.md §10.9，禁 aspectRatio）。
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { buildTodayTimeline } from '../lib/buildTodayTimeline';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { ScoreBar, type TimelineItem } from './TodayTimelineCard';
// ★ 2026-11-11（用户：回顾日按维度拆解 + 有分数的小卡加进度条）
//   → 2026-11-11 修订（用户：按维度看不要单独成模块，要融进下面曲线旅程）：
//     只导入单卡 DayDimensionCard + 维度配色，把维度卡当作曲线旅程的一个节点渲染。
import { DayDimensionCard, DIM_DEEP } from './DayDimensionSection';
import { buildDayDimensionGroups } from '../lib/reviewDayDimensions';
import type { DimensionCard } from '../lib/reviewDimensions';
import { loadCycleLog } from '../data/cycleLog';
import { getCachedSession, onSessionChange, type Gender } from '../data/userStore';
import type { CycleLog } from '../lib/cycleMath';
import { getSelfReportsForDaySync, ensureSelfReportsLoaded, onSelfReport, sortByTime } from '../data/selfReportLog';
// ★ 本轮（用户）：呼吸 / 冥想完成后，其完成记录落在 interventionLog，
//   回顾·日 原本只读 selfReportLog，导致「做完呼吸回顾里啥也没有」——这里把 interventionLog 也并进来。
import { ensureInterventionLogLoaded, allInterventionEntries } from '../data/interventionLog';
import { ensureEmotionLogLoaded, onEmotionLog } from '../data/emotionLog';
import DateAnchorPicker from './DateAnchorPicker';
import SunMark from './SunMark';
// ★ 2026-11-10（用户）：AI 细小观察卡——"记得今天几点到几点状态变了/完成了什么/哪些有提升"，
//   由 buildDayObservations 从真实存储数据推算（睡眠对比前晚 / 身心压力变化时段 / 活动高峰时段），
//   历史日同样生效；没有数据不出卡、不臆测。
import { buildDayObservations, type DayObservation } from '../lib/buildDayObservations';

// ★ 2026-11-10（用户：「球里太阳币数要等于回顾日整个月累计获得的数量」）：
//   **移除临时演示太阳 DEMO_SUN**。原先它强制当日回顾第一张卡片显示一枚假太阳，
//   让回顾日里看到的太阳数比水晶球里的真实达标数多；现在卡片只认 real `goalMet`，
//   日视图卡片 / 月历格子 / 水晶球金币三者完全同源，达标一天就多一枚、逐月累加。

/** ★ 2026-11-05（用户 #286）：单日记录摘要，上抛给父层用于「钉在 Tab 正上方」的浮层。
 *  count = 当日记录条数；selLabel = 标题前缀（今日 / X月X日）；first/last = 首末记录时间/标题。 */
export type DaySummary = {
  count: number;
  isToday: boolean;
  selLabel: string;
  firstTime: string;
  lastTime: string;
  firstTitle: string;
  lastTitle: string;
};

// ★ 2026-11-09(5)（用户：文字要讲全，不要省略号）：去掉 numberOfLines 后文字行数变多，
//   行高 104→120，保证完整文案在固定行高内放得下。
// ★ 2026-11-11（用户：有分数的小卡加进度条）：进度条 + 分数标签约多占 25pt；
//   行高再 120→168，避免卡片内容超出固定行高压到下一行（正是用户反复吐槽的重叠问题）。
//   曲线点 y = i*ROW_H + ROW_H/2 与行中心共用同一常量，行高变化后端点仍然严格对齐。
const ROW_H = theme.sp(42);          // 每行 168：卡片区高
// ★ 本轮（用户 #248 复盘）：时间线从「屏幕正中蛇形」改为「左侧 rail 脊线」——
//   脊线钉在最左边，卡片全部排在它右侧；脊线在标题【左边】，绝不会出现在标题右边冒充分隔线。
const RAIL_LEFT = theme.sp(5);       // 脊线中心距屏幕左缘（≈20dp）
const RAIL_AMP = theme.sp(1.4);      // 脊线沿中轴的小幅摆动（保留 S 形韵律，但不侵入卡片区）
const RAIL_GAP = theme.sp(12);       // 卡片左留白，给脊线 + 圆点让位（卡片整体右移）
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** #RRGGBB 与白混合（做图标方块的浅底） */
function mixWhite(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#F6F4F1';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - ratio) + 255 * ratio);
  const g = Math.round(((n >> 8) & 255) * (1 - ratio) + 255 * ratio);
  const b = Math.round((n & 255) * (1 - ratio) + 255 * ratio);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 兜底 emoji */
function emojiFor(title: string): string {
  if (/起床|睡眠/.test(title)) return '☀️';
  if (/情绪/.test(title)) return '💗';
  if (/脑力/.test(title)) return '🧠';
  if (/步|活动/.test(title)) return '🏃‍♀️';
  if (/对话/.test(title)) return '💬';
  if (/洞察/.test(title)) return '✨';
  return '🌸';
}

/**
 * ★ S 型蛇形曲线（对齐序日参考图）：**从第一个卡片的节点开始**（用户 23:20：
 *   "线的头就从第一个卡片那个点开始"，不再从日期条引出长线），到最后一个节点结束。
 *   节点贴左侧 rail 脊线（小幅摆动 ±RAIL_AMP 保留 S 形韵律），Catmull-Rom → 贝塞尔平滑样条。
 *
 * ★ 2026-11-11 修订（用户：卡片被拉成长条 / 错位重叠）：
 *   旧实现把节点中心 y 写死成 `i*ROW_H + ROW_H/2`（固定行高），但维度卡文字多时会
 *   **超过固定行高** → 内容溢出到邻行、且曲线端点与实际卡片中心对不上（用户截图里
 *   右卡被压成又高又窄的竖条）。现改为**实测每行的实际中心 Y**（onLayout 测得），
 *   曲线严格穿过每个圆点（圆点本身 top:50% = 行中心），无论卡片多高都贴合。
 *   首帧测量未到位前用固定 ROW_H 兜底，避免曲线闪空。
 */
function buildWavePath(yCenters: number[]): string {
  // ★ 脊线居中于 Svg（半宽 = RAIL_AMP 外的固定中心），小幅摆动保留 S 形韵律
  const cx = 20; // Svg 宽 40，中心 x = 20
  const pts: { x: number; y: number }[] = yCenters.map((y, i) => ({
    x: cx + (i % 2 === 0 ? -RAIL_AMP : RAIL_AMP),
    y,
  }));
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * ★ 2026-10-12（用户）：支持从月历点某一天打开 —— 传 `date` 即以该日为锚点
 *   （日期条窗口跟着那天走、选中那天居中），不传则等同旧行为（锚点=今天）。
 */
export default function JourneyDayView({ date, showDatePicker = true, onSummaryChange }: { date?: Date; showDatePicker?: boolean; onSummaryChange?: (s: DaySummary | null) => void } = {}) {
  const anchor = useMemo(() => {
    const d = date ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, [date]);

  const [selDate, setSelDate] = useState<Date>(anchor);

  // ★ 2026-10-12：锚点变化（月历换了另一天打开）→ 选中日同步
  useEffect(() => {
    setSelDate(anchor);
  }, [anchor]);

  // ★ 本轮（用户）：进入回顾即拉起回顾补充数据源；新记录产生（如用户在别的页刚完成饮食/心情）
  //   即时合并进时间线，无需手动刷新。
  const [recapTick, setRecapTick] = useState(0);
  // ★ 2026-11-11：历史日的「生理周期阶段」要用本地经期记录推算（与日历页同源）。
  //   异步加载一次，加载完成触发维度区重算；没记录就诚实不出周期卡，不臆测。
  const [cycleLog, setCycleLog] = useState<CycleLog | null>(null);
  useEffect(() => {
    let alive = true;
    void ensureSelfReportsLoaded().then(() => { if (alive) setRecapTick((n) => n + 1); });
    // ★ 本轮（用户）：呼吸 / 冥想记录同样要即时并入时间线
    void ensureInterventionLogLoaded().then(() => { if (alive) setRecapTick((n) => n + 1); });
    void loadCycleLog().then((l) => { if (alive) setCycleLog(l); }).catch(() => {});
    // ★ 2026-11-11：情绪自报也是维度卡的「心情」来源，载入完成/新增即时重算
    void ensureEmotionLogLoaded().then(() => { if (alive) setRecapTick((n) => n + 1); });
    const off = onSelfReport(() => { if (alive) setRecapTick((n) => n + 1); });
    const offEmotion = onEmotionLog(() => { if (alive) setRecapTick((n) => n + 1); });
    return () => { alive = false; off(); offEmotion(); };
  }, []);

  // ★ 本轮（用户）：男性（gender==='male'）不展示生理周期相关卡与措辞
  const [jGender, setJGender] = useState<Gender | undefined>(() => getCachedSession()?.profile?.gender);
  useEffect(() => {
    const sync = () => setJGender(getCachedSession()?.profile?.gender);
    sync();
    return onSessionChange(sync);
  }, []);
  const showCycle = jGender !== 'male';

  const result = useMemo(() => {
    try { return buildTodayTimeline(undefined, selDate, showCycle); } catch { return null; }
  }, [selDate, showCycle]);

  // ★ 本轮（用户）：回顾补充数据源——用户在胶囊建议里完成的饮食 / 心情记录，
  //   按时间插进当日生理时间线，让「刚做完的事」立刻出现在回顾·今日。
  const recapItems: TimelineItem[] = useMemo(() => {
    const dk = dayKey(selDate.getTime());
    return getSelfReportsForDaySync(dk).map((sr) => ({
      time: sr.time,
      color: sr.color,
      title: sr.title,
      sub: sr.sub,
      emoji: sr.emoji,
      goalMet: false,
      analysis: sr.analysis,
      imageUri: sr.imageUri,
    }));
  }, [selDate]);

  // ★ 本轮（用户）：呼吸 / 冥想完成记录（interventionLog）并入回顾·日——
  //   否则「做完呼吸，回顾里啥也没有」。带前后状态变化时一并写出。
  const interventionItems: TimelineItem[] = useMemo(() => {
    const dk = dayKey(selDate.getTime());
    return allInterventionEntries()
      .filter((e) => dayKey(e.ts) === dk)
      .map((e) => {
        const d = new Date(e.ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mn = String(d.getMinutes()).padStart(2, '0');
        const isBreath = e.kind === 'breath';
        let sub = e.detail ?? '';
        if (e.stateBefore && e.stateAfter && e.stateBefore !== e.stateAfter) {
          sub += ` · 状态 ${e.stateBefore}→${e.stateAfter}`;
        } else if (
          e.valueBefore != null && e.valueAfter != null &&
          Math.abs(e.valueAfter - e.valueBefore) >= 2
        ) {
          sub += ` · ${e.valueBefore}→${e.valueAfter}`;
        }
        return {
          time: `${hh}:${mn}`,
          color: isBreath ? mm.colors.limeCore : mm.colors.purpleCore,
          title: isBreath ? '呼吸练习' : '正念冥想',
          sub,
          emoji: isBreath ? '🌬️' : '🧘',
          goalMet: false,
          analysis: undefined,
          imageUri: undefined,
        } as TimelineItem;
      });
  }, [selDate]);

  // ★ 2026-11-10（用户）：AI 细小观察卡（recapTick 依赖：回填数据到位后重算观察卡）
  const obsItems = useMemo<DayObservation[]>(() => {
    try { return buildDayObservations(selDate); } catch { return []; }
  }, [selDate, recapTick]);

  // ★ 2026-11-11（用户：回顾日按维度拆解）：独立渲染，不占曲线 items 的 7 条上限。
  //   cycleLog / recapTick 到位后重算；单源异常已在取数层吞掉，不会拖崩整页。
  const dimensionGroups = useMemo(
    () => buildDayDimensionGroups(selDate, cycleLog, showCycle),
    [selDate, cycleLog, recapTick, showCycle],
  );

  const items: TimelineItem[] = useMemo(() => {
    const all = sortByTime<TimelineItem>([...(result?.items ?? []), ...recapItems, ...interventionItems, ...obsItems]);
    // 上限 7 条（用户："一天大概五六个、六七个，看他今天完成的事情多少"）——
    // 超出时优先裁 AI 观察卡（priority 大者先让位），用户打卡/基础时间线永不裁。
    if (all.length <= 7) return all;
    const dropOrder = [...obsItems].sort((a, b) => b.priority - a.priority);
    const dropped = new Set<DayObservation>();
    let excess = all.length - 7;
    for (const o of dropOrder) {
      if (excess <= 0) break;
      dropped.add(o);
      excess -= 1;
    }
    return all.filter((x) => !dropped.has(x as DayObservation));
  }, [result, recapItems, interventionItems, obsItems]);
  // ★ 2026-11-11 修订（用户：按维度看不要单独成模块，融进曲线旅程）：
  //   把「时间线事件」与「维度卡」合成同一组由曲线连接的旅程节点。
  //   事件在前（按时间），维度卡在后（延续同一条曲线，不再另起一个大模块）。
  type JourneyNode =
    | { kind: 'event'; item: TimelineItem }
    | { kind: 'dim'; card: DimensionCard };
  // ★ 本轮（用户）：同一类目（睡眠 / 运动 / 生理周期…）只保留一张卡。
  //   时间线事件与「按维度拆解」卡会同时覆盖这些类目 → 维度卡信息更全（含分数条/健康意义），
  //   故时间线里同维度的事件卡去掉，避免「同一类重复讲好几张卡」。
  //   某类目当天无维度卡时（如当天没睡眠数据），时间线事件仍保留，不丢信息。
  const nodes: JourneyNode[] = useMemo(() => {
    const dimsCovered = new Set<string>();
    for (const g of dimensionGroups) {
      for (const c of g.cards) if (c.dimension) dimsCovered.add(c.dimension);
    }
    const events: JourneyNode[] = items
      .filter((it) => !(it.dimension && dimsCovered.has(it.dimension)))
      .map((it) => ({ kind: 'event', item: it }));
    const dims: JourneyNode[] = dimensionGroups.flatMap((g) =>
      g.cards.map((c) => ({ kind: 'dim', card: c })),
    );
    return [...events, ...dims];
  }, [items, dimensionGroups]);

  // ★ 2026-11-11 修订（用户：卡片被拉成长条 / 错位重叠）：
  //   用 onLayout 实测每个 row 的真实中心 Y（= layout.y + height/2，相对 rows 容器），
  //   曲线端点严格贴合圆点（圆点 top:50% = 行中心），无论卡片多高都不再错位 / 溢出邻行。
  //   首帧测量未到位前退回固定 ROW_H 兜底，避免曲线闪空；测量到位后用实测值重画。
  const [rowLayouts, setRowLayouts] = useState<{ y: number; height: number }[]>([]);
  const onRowLayout = useCallback(
    (i: number) => (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      setRowLayouts((prev) => {
        const cur = prev[i];
        if (cur && cur.y === y && cur.height === height) return prev; // 无变化不触发重渲染
        const next = [...prev];
        next[i] = { y, height };
        return next;
      });
    },
    [],
  );

  const measured = rowLayouts.length === nodes.length;
  const yCenters = measured
    ? rowLayouts.map((l) => l.y + l.height / 2)
    : nodes.map((_, i) => i * ROW_H + ROW_H / 2);
  const totalH = measured
    ? rowLayouts[rowLayouts.length - 1].y + rowLayouts[rowLayouts.length - 1].height
    : Math.max(nodes.length, 1) * ROW_H;
  const wavePath = buildWavePath(yCenters);
  const isSelToday = sameDay(selDate, new Date());

  // ★ 2026-11-12（修复「从今日到四点」）：buildTodayTimeline 产出的节点含非时间标签
  //   （'今日' / '全天' / 起床时间 wakeTime 等），如果直接取 items[0]/items[last].time 当首末时间，
  //   会把这些非 HH:MM 文本拼进摘要，出现「从 今日 到 四点」这类错误文案。
  //   这里只取「有效 HH:MM 时间」的节点参与首末时间计算；不足 2 条有效时间时，
  //   firstTime/lastTime 留空，由 ProfileScreen 决定是否渲染时间区间。
  const isValidHM = (t: string | undefined): boolean =>
    typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t);

  // ★ 2026-11-05（用户 #286）：把「X 条记录」摘要上抛父层，由 ProfileScreen 钉在 Tab 正上方（固定浮层，不随滚动走）
  const daySummary = useMemo<DaySummary | null>(() => {
    if (items.length === 0) return null;
    const timed = items.filter((it) => isValidHM(it.time));
    const first = timed[0];
    const last = timed[timed.length - 1];
    const hasRange = timed.length >= 2 && !!first && !!last;
    return {
      count: items.length,
      isToday: isSelToday,
      selLabel: isSelToday ? '今日' : `${selDate.getMonth() + 1}月${selDate.getDate()}日`,
      firstTime: hasRange ? (first!.time as string) : '',
      lastTime: hasRange ? (last!.time as string) : '',
      firstTitle: hasRange ? (first!.title as string) : '',
      lastTitle: hasRange ? (last!.title as string) : '',
    };
  }, [items, isSelToday, selDate]);

  useEffect(() => {
    onSummaryChange?.(daySummary);
  }, [daySummary, onSummaryChange]);

  return (
    <View style={styles.wrap}>
      {/* ── 日期步进器（与月视图 DateAnchorPicker 同款，保证日 / 月 选择器一致）── */}
      {showDatePicker && (
        <DateAnchorPicker value={selDate} onChange={(d) => setSelDate(d)} range="day" maxDate={new Date()} />
      )}

      {/* ── 曲线层：从选中格（居中）正下方引出，向下波浪延伸 ──
          ★ 2026-11-11 修订（用户）：时间线事件 + 维度卡合并为同一组旅程节点，
          维度卡不再单独成块，而是挂在同一条曲线上，读起来就是「一整段旅程」。 */}
      {nodes.length === 0 ? (
        <View style={[styles.empty, { marginTop: theme.sp(3) }]}>
          <Text style={styles.emptyTitle}>{isSelToday ? '今天还没有记录' : '这一天还没有记录'}</Text>
          <Text style={styles.emptyText}>打卡、写日记或戴上戒指走一走，这一天就会在这里留下痕迹。</Text>
        </View>
      ) : (
        <>
          {/* ★ 2026-10-12：曲线与行共用同一个容器（曲线 top:0 定位在行区内），
              这样曲线端点与圆点严格重合——从第一条记录的点连到最后一条记录的点。 */}
          {/* ★ 2026-11-11 修订：去掉固定 height，改为按内容自然撑高（每行 minHeight=ROW_H），
              配合 onLayout 实测中心 Y 把曲线贴合到真实卡片位置，消除拉长 / 重叠。 */}
          <View style={styles.rows}>
          {/* ★ 只有 ≥2 个节点才画曲线（1 个点无曲线；空 d 的 Path 会让 SVG 把渐变整块渲染成色块） */}
          {nodes.length >= 2 && (
            <Svg width={40} height={totalH} style={styles.curve} pointerEvents="none">
              <Defs>
                <SvgGrad id="journeyGrad" x1="20" y1="0" x2="20" y2={totalH} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={mm.colors.purpleCore} />
                  <Stop offset="0.5" stopColor={mm.colors.roseCore} />
                  <Stop offset="1" stopColor={mm.colors.limeMid} />
                </SvgGrad>
              </Defs>
              <Path d={wavePath} stroke="url(#journeyGrad)" strokeWidth={2.5} strokeOpacity={0.85} strokeLinecap="round" fill="none" />
            </Svg>
          )}

          {/* 旅程节点行：事件卡 + 维度卡左右交替，节点圆点贴卡片内缘、落在曲线上 */}
            {nodes.map((node, i) => {
              // ★ 本轮（用户 #248 复盘）：时间线改为左侧 rail，卡片统一排在脊线右侧，
              //   不再左右交替（交替会让脊线落在标题右侧，被误读为「竖线分隔条」）。
              // ★ 维度卡：直接复用单卡 DayDimensionCard，挂在同一条曲线上（不再单独成块）
              if (node.kind === 'dim') {
                const deep = DIM_DEEP[node.card.dimension] ?? mm.colors.purpleCore;
                return (
                  <View key={`dim-${node.card.id}-${i}`} style={styles.row} onLayout={onRowLayout(i)}>
                    <View style={[styles.dot, { backgroundColor: deep }]} />
                    {/* ★ 本轮（用户）：DayDimensionCard 自身已带卡片壳，这里只给布局占位（留白贴脊线），不再套第二层卡片背景 */}
                    <DayDimensionCard card={node.card} style={styles.cardSlot} />
                  </View>
                );
              }
              const it = node.item;
              return (
                <View key={`${it.time}-${i}`} style={styles.row} onLayout={onRowLayout(i)}>
                  <View style={[styles.dot, { backgroundColor: it.color }]} />
                  <View style={styles.card}>
                    {/* ★ 2026-11-10：只认真实达标，与月历格子、水晶球金币三者同源 */}
                    {it.goalMet ? (
                      <View style={styles.goalStar}>
                        <SunMark size={Math.round(theme.fontSize.lg * 1.4)} />
                      </View>
                    ) : null}
                    <View style={styles.cardHead}>
                      <View style={[styles.icon, { backgroundColor: mixWhite(it.color, 0.82) }]}>
                        <Text style={styles.iconTxt}>{it.emoji ?? emojiFor(it.title)}</Text>
                      </View>
                      <Text style={styles.cardTitle}>{it.title}</Text>
                    </View>
                    {!!it.sub && <Text style={styles.cardSub}>{it.sub}</Text>}
                    {/* ★ 2026-11-11（用户）：有分数才画进度条；完成任务型 / 纯数值型不画 */}
                    {typeof it.score === 'number' && Number.isFinite(it.score) ? (
                      <ScoreBar
                        score={it.score}
                        max={it.scoreMax ?? 100}
                        color={it.color}
                        label={it.scoreLabel ?? `${Math.round(it.score)} / ${Math.round(it.scoreMax ?? 100)}`}
                        track={mm.colors.emptyFill}
                      />
                    ) : null}
                    {/* ★ 本轮（用户 #248）：卡片底部补一句分析 */}
                    {/* ★ 2026-11-09(5)（用户：文字要讲全，不要省略号）—— 去掉全部 numberOfLines 截断 */}
                    {!!it.analysis && <Text style={styles.cardAnalysis}>{it.analysis}</Text>}
                    {/* ★ 本轮（用户）：饮食等带图记录，卡片内附图 */}
                    {!!it.imageUri && (
                      <Image source={{ uri: it.imageUri }} style={styles.cardPhoto} resizeMode="cover" />
                    )}
                    <Text style={styles.cardTime}>{it.time}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', marginTop: theme.sp(1) },

  /* 曲线与行 */
  // ★ 本轮（用户 #248 复盘）：曲线 = 左侧 rail 脊线，钉在屏幕最左缘，卡片整体右移，
  //   脊线在标题【左边】，不再被误读为「标题右边的竖线分隔条」。
  rows: { position: 'relative', width: '100%' },
  curve: { position: 'absolute', top: 0, left: RAIL_LEFT - theme.sp(5), width: theme.sp(10) },
  row: {
    width: '100%', minHeight: ROW_H, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-start', position: 'relative',
  },
  dot: {
    position: 'absolute', left: RAIL_LEFT, top: '50%',
    width: theme.sp(3), height: theme.sp(3), marginLeft: -theme.sp(1.5), marginTop: -theme.sp(1.5),
    borderRadius: theme.sp(1.5), borderWidth: 2.5, borderColor: theme.colors.cardBg, zIndex: 1,
  },
  card: {
    flex: 1, marginLeft: RAIL_GAP, marginRight: theme.sp(3),
    backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPadCompact,
    shadowColor: mm.shadow.color, shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius, shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
    zIndex: 2,
  },
  // ★ 本轮（用户）：维度卡占位——只负责"贴脊线右移 + 撑满宽度"，不带卡片背景（避免和 DayDimensionCard 自带的壳套两层）
  cardSlot: { flex: 1, marginLeft: RAIL_GAP, marginRight: theme.sp(3) },
  // ★ 本轮（用户 #287）：卡片头右侧留出空间，避免右上角达标皇冠压到标题文字
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), paddingRight: theme.sp(8) },
  icon: {
    width: theme.sp(7.5), height: theme.sp(7.5), borderRadius: mm.radius.iconSq,
    alignItems: 'center', justifyContent: 'center',
  },
  iconTxt: { fontSize: theme.fontSize.body },
  cardTitle: {
    flex: 1, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, lineHeight: theme.fontSize.sm * 1.3,
  },
  cardSub: {
    fontSize: theme.fontSize.micro, color: mm.colors.inkFaint,
    lineHeight: theme.fontSize.micro * 1.4, marginTop: theme.sp(1.25),
  },
  cardTime: { fontSize: theme.fontSize.micro - 1, color: mm.colors.inkFaint, marginTop: theme.sp(1.5) },
  // ★ 本轮（用户 #261/#245）：达标皇冠，卡片右上角（矢量 CrownMark，明亮黄绿更醒目、鼓励感更强）
  goalStar: {
    position: 'absolute', top: theme.sp(1.25), right: theme.sp(1.5),
    zIndex: 3,
  },
  // ★ 本轮（用户 #261）：卡片底部分析句，改用明亮黄绿（limeCore）替代看不清的深绿（limeDeep）
  cardAnalysis: {
    fontSize: theme.fontSize.micro, color: mm.colors.limeCore,
    lineHeight: theme.fontSize.micro * 1.45, marginTop: theme.sp(1),
  },
  // ★ 本轮（用户）：饮食记录卡片内附图
  cardPhoto: {
    marginTop: theme.sp(1.5),
    width: '100%',
    height: theme.sp(22),
    borderRadius: theme.radius.sm,
    backgroundColor: mm.colors.btnBusyBg,
  },

  empty: {
    backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPad, alignItems: 'center',
  },
  emptyTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  emptyText: {
    fontSize: theme.fontSize.sm, color: mm.colors.inkFaint,
    textAlign: 'center', marginTop: theme.sp(1.5), lineHeight: theme.fontSize.sm * 1.5,
  },
});
