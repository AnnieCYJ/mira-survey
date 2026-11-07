/**
 * MonthDiscoveryView —— 日历「月」tab（2026-10-12 改版，方案 A）
 *
 * ★ 2026-10-12 20:20 用户修订（本轮）：
 *   ① **习惯去重**：「读文章开始记着了」出现两条 —— 根因是习惯按建议 id 存储，
 *      同一习惯（读文章）可来自多条不同 id 的建议，归一化后同名 ⇒ 重复。
 *      修法：按「归一化名 + 单位」合并（次数累加 / 起止取并集 / 证据短语取最长）。
 *   ② **月度发现换成「习惯卡 + 文字结论」**（用户：「像旅程这种形式不是特别好，
 *      我希望是这种文字，然后它也可以是有图表的形式」）：
 *      · 习惯卡 = 图标块 + 习惯名 + 真实证据短语 + **大数字（N 篇 / N 次）** + 进度条 +
 *        起止日期 + 平均每周频率（对齐用户 18:55 给的参考截图的形式）；
 *      · 文字结论 = 最常做的那件事 / 深睡月初→月末 / 完成的事，三行真实口径人话。
 *   ③ 「竖向旅程时间轴」整套移除（连同 TL_* 几何常量与 tl* 样式）。
 *
 * 更早修订（仍有效）：
 *   · 时间选择器（DateAnchorPicker）置于顶部第一块；
 *   · Hero：透明无框两行字，标题「稳步向上的一个月 / 平稳的一个月」；
 *   · 「日 / 月」分段 tab 已移除（Calendar 页只保留「月」）；点月历任意日 → 下抽屉日视图；
 *   · 空槽（月初/月末补位）不画任何背景框；月历下方类别图例已删。
 *
 * 照片堆叠卡口径严格对齐预览稿 _design/calendar-stack-v4.html 的 .ph/.plus：
 *   正方形 + 白描边 1.5 + 圆角 7 + 微旋转 + 右下角深色 +N 药丸。
 *
 * 数据全部接真实源（不乱编）：
 *   · 习惯卡 = habitSuggestions.listHabits()（合并同名后按次数排序）；
 *   · 月历堆叠 + 变化结论 = 聚合 interventionLog / foodAi.loadFoodLogs /
 *     sportLog.loadSportLogs / healthStore.getSleep / tasks（计划）。
 *   · 数据段无数据填「—」、标签保留（空态铁律）。
 *
 * ★ 旧月视图代码（CalendarGrid + RelaxCardDeck）原样保留，由 ProfileScreen 的
 *   USE_MONTH_DISCOVERY 开关控制隐藏/显示，不删除。
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity, Animated, Easing,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useReducedMotion } from '../hooks/useReducedMotion';
import FadeInImage from './FadeInImage';
import { theme } from '../theme/theme';
import { mm, pastelFamilyFor } from '../theme/mindmate';
import Card from './Card';
import Icon, { type IconName } from './Icon';
import DateAnchorPicker from './DateAnchorPicker';
import DayDrawer from './DayDrawer';
import type { TimelineItem } from './TodayTimelineCard';
import { healthStore } from '../data/healthStore';
import {
  CAL_YEAR, CAL_MONTH, TODAY_DAY, TASK_LABELS, type TaskType,
} from '../data/tasks';
import { listHabits, type HabitEntry } from '../data/habitSuggestions';
import {
  allInterventionEntries, ensureInterventionLogLoaded, type InterventionKind,
} from '../data/interventionLog';
import { loadFoodLogs, type FoodLog } from '../lib/foodAi';
import { loadSportLogs, type SportLog } from '../lib/sportLog';
// ★ 2026-11-06（用户）：月历格子改展示「当天获得的皇冠数」——与回顾·日视图的达标皇冠同源
import { buildTodayTimeline } from '../lib/buildTodayTimeline';
// ★ 2026-11-07（用户）：日历格子皇冠已去掉，CrownMark 不再引用
// ★ Phase 2（无门禁软闭环）：规律观察直接落位日历观察区 ——
//   观察不等确认就写进来；用户点「挺准」→ 加权进人生上下文；随时可删（删了不复活）。
import {
  listVisiblePatterns,
  dismissPattern,
  type PatternEntry,
} from '../data/patternStore';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

const { width: SCREEN_W } = Dimensions.get('window');

/** #RRGGBB 与白混合（做图标方块的浅底）；与 JourneyDayView.mixWhite 同源 */
function mixWhite(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#F6F4F1';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - ratio) + 255 * ratio);
  const g = Math.round(((n >> 8) & 255) * (1 - ratio) + 255 * ratio);
  const b = Math.round((n & 255) * (1 - ratio) + 255 * ratio);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** ★ 2026-10-28（用户）：规律观察每条下方加「类别标签」，让用户一眼分清这观察是讲什么的。 */
const PATTERN_KIND_LABEL: Record<string, string> = {
  rhythm: '时间节律',
  correlation: '相关',
  group_diff: '组间差异',
  coverage: '数据覆盖',
};
function patternKindLabel(kind: string): string {
  return PATTERN_KIND_LABEL[kind] ?? '发现';
}

// ★ 2026-11-03（用户：不能有假数据/假分析）：原「示例规律」3 条已删除。
//   真实规律还没生成时，展示诚实的空态说明，不再用编造的观察占位。

// ── App 同款照片资源（与首页泡泡卡 / 工具页同源） ──
const IMG = {
  meditation: require('../assets/card_meditation.jpg'),
  activity: require('../assets/card_activity.jpg'),
  food: require('../assets/card_food.jpg'),
  emotion: require('../assets/card_emotion.jpg'),
  relax: require('../assets/card_relax.jpg'),
  learn: require('../assets/card_learn.png'),
  focus: require('../assets/card_focus.jpg'),
};

/** 4 个主类别（用户关心的 呼吸 / 情绪反馈 / 饮食 / 运动）+ 3 个计划派生类 */
const CAT_META: Record<string, { label: string; img: any; color: string }> = {
  breath: { label: '呼吸冥想', img: IMG.meditation, color: theme.colors.accent1 },
  mood: { label: '情绪调节', img: IMG.emotion, color: theme.colors.accent2 },
  food: { label: '记饮食', img: IMG.food, color: '#F59E6B' },
  sport: { label: '运动', img: IMG.activity, color: '#22C55E' },
  mind: { label: '认知提升', img: IMG.relax, color: theme.colors.accent1 },
  focus: { label: '专注力提升', img: IMG.focus, color: theme.colors.stateCalm },
  learn: { label: '知识学习', img: IMG.learn, color: theme.colors.accent2 },
};

const INTERVENTION_LABEL: Record<InterventionKind, string> = {
  grounding: '缓一缓', reframe: '换个说法', activate: '动一动', gratitude: '睡前记两笔',
  compliment: '夸一个人', savoring: '品味小事', future: '给未来写信', outdoor: '到户外去',
  breath: '呼吸冥想', meditate: '冥想',
};
function interventionCategory(k: InterventionKind): 'breath' | 'mood' | 'sport' {
  if (k === 'breath' || k === 'meditate') return 'breath';
  if (k === 'activate' || k === 'outdoor') return 'sport';
  return 'mood';
}

const TASK_TO_CAT: Record<TaskType, string> = {
  0: 'breath', 1: 'mind', 2: 'focus', 3: 'learn', 4: 'food', 5: 'sport',
};
const TASK_IMG: Record<TaskType, any> = {
  0: IMG.meditation, 1: IMG.relax, 2: IMG.focus, 3: IMG.learn, 4: IMG.food, 5: IMG.activity,
};

interface RecordItem {
  cat: string;
  label: string;
  img: any;
  ts: number;
}

/**
 * 习惯卡（月视图「这个月养成的习惯」一行 = 一条，已按归一化名合并）。
 * count = 该习惯累计确认次数（合并后）；metric = 真实证据短语（如「深睡连着 3 天变好」）。
 */
interface HabitCard {
  name: string;
  unit: string;
  icon: string;
  soft: string;
  deep: string;
  count: number;
  firstAt: number;
  lastAt: number;
  metric: string;
}

/** 时间戳 → 「8/3」 */
function mdOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 平均每周频率（真实：次数 ÷ 起止跨度周数）→ 「平均每周 1.8 篇」 */
function weeklyText(count: number, firstAt: number, lastAt: number, unit: string): string {
  const spanDays = Math.max(1, Math.round((lastAt - firstAt) / 86400000) + 1);
  const per = (count * 7) / spanDays;
  const n = per >= 10 ? String(Math.round(per)) : per.toFixed(1);
  return `平均每周 ${n} ${unit}`;
}

// ── 时间热力（你的本月节奏卡）：4 时段 × 7 天 ──
const SLOTS = [
  { short: '清晨', label: '清晨 5–9' },
  { short: '白天', label: '白天 9–18' },
  { short: '傍晚', label: '傍晚 18–21' },
  { short: '夜间', label: '夜间 21–24' },
];
const HEAT_LEV = [mm.colors.limeTint, mm.colors.limeCore, mm.colors.limeMid, mm.colors.limeDeep];
function heatColor(n: number): string {
  if (n <= 0) return mm.colors.emptyFill;
  if (n <= 1) return HEAT_LEV[0];
  if (n <= 2) return HEAT_LEV[1];
  if (n <= 4) return HEAT_LEV[2];
  return HEAT_LEV[3];
}

interface MonthData {
  interventions: ReturnType<typeof allInterventionEntries>;
  foods: FoodLog[];
  sports: SportLog[];
  habits: HabitEntry[];
}

function inMonth(ts: number, y: number, m: number): boolean {
  const d = new Date(ts);
  return d.getFullYear() === y && d.getMonth() === m;
}

/** 当月 / 上月 各类别完成次数（真实聚合，仅 4 主类别）；curY/curM = 当前查看的月 */
function computeMonthStats(data: MonthData, curY: number, curM: number) {
  const prevY = curM === 0 ? curY - 1 : curY;
  const prevM = curM === 0 ? 11 : curM - 1;

  const cnt: Record<string, number> = { breath: 0, mood: 0, food: 0, sport: 0 };
  const cntPrev: Record<string, number> = { breath: 0, mood: 0, food: 0, sport: 0 };

  for (const e of data.interventions) {
    const c = interventionCategory(e.kind);
    if (inMonth(e.ts, curY, curM)) cnt[c] += 1;
    else if (inMonth(e.ts, prevY, prevM)) cntPrev[c] += 1;
  }
  for (const f of data.foods) {
    if (inMonth(f.ts, curY, curM)) cnt.food += 1;
    else if (inMonth(f.ts, prevY, prevM)) cntPrev.food += 1;
  }
  for (const s of data.sports) {
    if (inMonth(s.ts, curY, curM)) cnt.sport += 1;
    else if (inMonth(s.ts, prevY, prevM)) cntPrev.sport += 1;
  }
  return { cnt, cntPrev };
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const GOLD = '#F0C46E';
const TODAY_BG = '#FBEFD6';
/** 照片卡微旋转角（对齐预览稿 .ph.a/.b/.c = -9 / 4 / -2，但加大以便小格子也能看出堆叠层次） */
const PH_ROT = [-11, 7, -5];
const PH_OFF = [
  { x: -7, y: -6 },
  { x: 2, y: 2 },
  { x: 8, y: -3 },
];
const GAP = theme.sp(1.5);
const COLS = 7;

/** 「完成的事」归类：认知重评类干预归 CBT 练习；呼吸/冥想归冥想 */
const CBT_KINDS: InterventionKind[] = ['grounding', 'reframe', 'gratitude', 'savoring', 'future', 'compliment'];

/**
 * 习惯展示名 —— ★ 2026-10-12（用户：「习惯养成不要写『状态挺稳』『去读篇文章』到底是个啥呀，
 * 你得把习惯给出来，比如读文章多少篇、饮食记录多少次」）。
 * 把落库的建议原文 / 空 action 归一成**具体行为名 + 计数单位**，用 cta 深链目标反查：
 *   Breathing → 睡前呼吸 / 放松呼吸 / 提神呼吸 / 箱式呼吸
 *   LearnRead → 读文章（单位「篇」）
 *   FoodScan  → 记录饮食
 *   iv-*（发现型，action 已是动作名）→ 直接用 action
 */
function habitDisplay(h: HabitEntry): { name: string; unit: string; icon: string } {
  const screen = h.cta?.screen;
  if (screen === 'Breathing') {
    // 与 suggestionEngine 的 patternKey 五值对齐：'box' | 'calm' | 'energize' | 'sleep' | 'stress'
    const k = String((h.cta?.params as any)?.breath ?? '');
    const name = k === 'sleep' ? '睡前呼吸'
      : k === 'energize' ? '提神呼吸'
      : k === 'box' ? '箱式呼吸'
      : k === 'stress' ? '缓压呼吸'
      : '放松呼吸';
    return { name, unit: '次', icon: 'breath' };
  }
  if (screen === 'LearnRead') return { name: '读文章', unit: '篇', icon: 'learn' };
  if (screen === 'FoodScan') return { name: '记录饮食', unit: '次', icon: 'food' };
  if (h.action) return { name: h.action, unit: '次', icon: 'check' };
  return { name: '一个小习惯', unit: '次', icon: 'check' };
}

/**
 * 单张照片卡（堆叠中的一层）。playId 变化 / 首次挂载时，按 delay 错峰做 scale + 淡入，
 * 形成「一张张叠上来」的堆叠感；reduce motion 时直接显示。
 */
function StackPhoto({ img, rot, off, zIndex, photoSize, delay, playId, reduced }: {
  img: any;
  rot: number;
  off: { x: number; y: number };
  zIndex: number;
  photoSize: number;
  delay: number;
  playId: number;
  reduced: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(1);
      return;
    }
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 340, delay, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }).start();
  }, [playId, reduced, t, delay]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  return (
    <Animated.View
      style={[
        styles.photoCard,
        {
          width: photoSize,
          height: photoSize,
          zIndex,
          opacity,
          transform: [
            { rotate: `${rot}deg` },
            { translateX: off.x },
            { translateY: off.y },
            { scale },
          ],
        },
      ]}
    >
      <FadeInImage source={img} style={styles.photoImg} resizeMode="cover" duration={220} />
    </Animated.View>
  );
}

// ★ 2026-11-07（用户）：原「本月卓越表现」独立卡组已移除 —— 其信息现直接落在日历格子的 icon 卡内（每个皇冠任务一张 icon 卡）。



export default function MonthDiscoveryView({
  tasks,
  onAskMira,
}: {
  tasks: Record<number, number[]>;
  /** ★ Phase 3：把一条规律观察带去问 Mira（走云端长窗口综合分析）。可选 —— 没传就不渲染按钮。 */
  onAskMira?: (question: string) => void;
}) {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const [data, setData] = useState<MonthData | null>(null);
  const [cellW, setCellW] = useState(40);
  // ★ 2026-10-12（用户）：点某个日期 → 下抽屉弹出「原先日的那种」旅程视图（中间曲线 + 两侧活动卡片）
  const [drawerDate, setDrawerDate] = useState<Date | null>(null);

  // ★ 2026-10-28（V1 重设计）：卡头「收藏」+「你做过多少次」折叠开关
  const [favRhythm, setFavRhythm] = useState(false);
  const [favPattern, setFavPattern] = useState(false);
  const [countOpen, setCountOpen] = useState(true);

  // ★ 丝滑化：切到日历页时，月历照片卡错峰「堆叠展开」；focused 变化重放
  const calendarFocused = useIsFocused();
  const calendarReduced = useReducedMotion();
  const [photoPlayId, setPhotoPlayId] = useState(0);
  useEffect(() => {
    if (calendarFocused) setPhotoPlayId((p) => p + 1);
  }, [calendarFocused]);

  // ★ 时间选择器：与详情页一致，复用共享 DateAnchorPicker（range=month）。
  //   ★ 2026-10-12（用户）：默认锚定**当前最新月份**（realNow），不要跳到演示月（8 月）；
  //     可左右步进 / 弹日历跳任意历史月。演示计划（tasks）仍只在查看 8 月时叠加。
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const viewY = anchor.getFullYear();
  const viewM = anchor.getMonth();
  const viewDays = new Date(viewY, viewM + 1, 0).getDate();
  const realNow = new Date();
  // 仅当查看的正是「真实当前月」时才高亮今天，否则不渲染今天底色
  const todayDay = realNow.getFullYear() === viewY && realNow.getMonth() === viewM ? realNow.getDate() : -1;

  // ★ Phase 2：规律观察（云端长窗口 + 端侧细数据算出的观察）
  const [patterns, setPatterns] = useState<PatternEntry[]>([]);
  const reloadPatterns = async () => {
    try {
      const list = await listVisiblePatterns();
      setPatterns(list);
    } catch {
      setPatterns([]);
    }
  };
  useEffect(() => { void reloadPatterns(); }, []);
  useEffect(() => {
    // 回到日历页时刷新一次（可能刚刚在别处点过「挺准」/删过）
    if (calendarFocused) void reloadPatterns();
  }, [calendarFocused]);

  const onPatternRemove = async (id: string) => {
    await dismissPattern(id);
    await reloadPatterns();
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureInterventionLogLoaded();
      const habits = await listHabits();
      if (!alive) return;
      setData({
        interventions: allInterventionEntries(),
        foods: loadFoodLogs(),
        sports: loadSportLogs(),
        habits,
      });
    })();
    return () => { alive = false; };
  }, []);

  // 当月每天记录（按天聚合，去重到类别，避免呼吸同时出现在计划与完成里）
  const recordsByDay = useMemo(() => {
    const map: Record<number, RecordItem[]> = {};
    const add = (day: number, item: RecordItem) => {
      const arr = map[day] || (map[day] = []);
      if (arr.some((r) => r.cat === item.cat)) return; // 同类别当天只留一条，避免重复
      arr.push(item);
    };
    if (!data) return map;
    for (const e of data.interventions) {
      const d = new Date(e.ts);
      if (d.getFullYear() !== viewY || d.getMonth() !== viewM) continue;
      const cat = interventionCategory(e.kind);
      add(d.getDate(), { cat, label: INTERVENTION_LABEL[e.kind], img: CAT_META[cat].img, ts: e.ts });
    }
    for (const f of data.foods) {
      const d = new Date(f.ts);
      if (d.getFullYear() !== viewY || d.getMonth() !== viewM) continue;
      add(d.getDate(), { cat: 'food', label: '记饮食', img: IMG.food, ts: f.ts });
    }
    for (const s of data.sports) {
      const d = new Date(s.ts);
      if (d.getFullYear() !== viewY || d.getMonth() !== viewM) continue;
      add(d.getDate(), { cat: 'sport', label: '运动', img: IMG.activity, ts: s.ts });
    }
    // 计划（tasks）属于演示月（CAL_YEAR/CAL_MONTH），只在查看该月时叠加，避免串到其它月
    if (viewY === CAL_YEAR && viewM === CAL_MONTH) {
      for (const [dayStr, types] of Object.entries(tasks)) {
        const day = Number(dayStr);
        for (const t of types as TaskType[]) {
          add(day, { cat: TASK_TO_CAT[t], label: TASK_LABELS[t], img: TASK_IMG[t], ts: 0 });
        }
      }
    }
    return map;
  }, [data, tasks, viewY, viewM]);

  // ★ 2026-11-07（用户）：月历格子内只展示「当天一个代表 icon」（如起床 = ☀️ 太阳），
  //   右上角再叠一个「小皇冠」标记当天是否达成（皇冠/goalMet）任务。
  //   代表 icon 优先取「起床」事件（与回顾·日视图同源），否则取当天首个带 emoji 的条目。
  const dayCellMap = useMemo(() => {
    const map: Record<number, { icon: string | null; color: string }> = {};
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      try {
        const items = buildTodayTimeline(undefined, new Date(viewY, viewM, d)).items;
        if (!items.length) continue;
        const wake = items.find((it) => (it.title ?? '').startsWith('起床'));
        const rep = wake ?? items.find((it) => !!it.emoji) ?? items[0];
        map[d] = {
          icon: rep?.emoji ?? null,
          color: rep?.color ?? '#C9C4BC',
        };
      } catch { /* 单日构建失败忽略，该格不显示 */ }
    }
    return map;
  }, [viewY, viewM]);

  const stats = useMemo(() => (data ? computeMonthStats(data, viewY, viewM) : null), [data, viewY, viewM]);

  // ★ 2026-10-12 20:10（用户 18:55 截图 + 语音）：
  //   「读文章开始记着了。为啥出现两个呢？」——**根因**：习惯按建议 id 存储，
  //   同一个习惯（如「读文章」）可能来自多条不同 id 的建议（LearnRead 跳转 + 发现型 iv-*），
  //   归一化后名字相同 ⇒ 月视图上出现两条一模一样的东西。
  //   修法：**按「归一化名 + 单位」合并**（次数累加、起止时间取并集、证据短语取最长的一条）。
  //   只要确认过（≥1 次）就入列；一条都没有时也保留卡片并显示空态「—」（空态铁律）。
  const habitCards = useMemo(() => {
    if (!data) return [] as HabitCard[];
    const map = new Map<string, HabitCard>();
    for (const h of data.habits) {
      if (h.count < 1) continue;
      const d = habitDisplay(h);
      const key = `${d.name}|${d.unit}`;
      const metric = (h.metric || '').trim();
      const cur = map.get(key);
      if (cur) {
        cur.count += h.count;
        cur.firstAt = Math.min(cur.firstAt, h.firstAt);
        cur.lastAt = Math.max(cur.lastAt, h.lastAt);
        if (metric.length > cur.metric.length) cur.metric = metric;
      } else {
        // 配色按习惯名稳定哈希取一组五色相（同一习惯永远同色，换月不跳）
        const fam = pastelFamilyFor(d.name);
        map.set(key, {
          name: d.name, unit: d.unit, icon: d.icon,
          soft: fam.soft, deep: fam.fg,
          count: h.count, firstAt: h.firstAt, lastAt: h.lastAt, metric,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  }, [data]);

  // 规律总结聚合（真实数据；不可推导项交给渲染层填 —）
  //   · 留下记录的天数 / 最长连续记录：当月 interventions+foods+sports 真实落盘日
  //   · 本月新发现：firstAt 落在当月的习惯数
  //   · 最常做的 / 比上月：stats 四类别真实计数
  const summary = useMemo(() => {
    if (!data) return null;
    const set = new Set<number>();
    const push = (ts: number) => {
      const d = new Date(ts);
      if (d.getFullYear() === viewY && d.getMonth() === viewM) set.add(d.getDate());
    };
    for (const e of data.interventions) push(e.ts);
    for (const f of data.foods) push(f.ts);
    for (const s of data.sports) push(s.ts);
    const activeDays = set.size;
    const total = new Date(viewY, viewM + 1, 0).getDate();
    let best = 0, run = 0;
    for (let d = 1; d <= total; d++) { if (set.has(d)) { run++; best = Math.max(best, run); } else run = 0; }
    const newHabits = habitCards.filter((h) => inMonth(h.firstAt, viewY, viewM)).length;
    const habitCount = habitCards.length;
    let mostCat: 'breath' | 'mood' | 'food' | 'sport' = 'breath';
    let mostN = -1;
    if (stats) {
      (['breath', 'mood', 'food', 'sport'] as const).forEach((c) => { if (stats.cnt[c] > mostN) { mostN = stats.cnt[c]; mostCat = c; } });
    }
    const totalDelta = stats
      ? (['breath', 'mood', 'food', 'sport'] as const).reduce((s, c) => s + (stats.cnt[c] - stats.cntPrev[c]), 0)
      : 0;
    return { activeDays, streak: best, mostCat, mostN, newHabits, habitCount, totalDelta };
  }, [data, stats, habitCards, viewY, viewM]);

  // 「这个月在改善」+「完成的事」聚合（真实数据）
  //   · 深睡占比 = deep / total；取本月内有睡眠数据的最早 3 天 vs 最晚 3 天平均
  //   · CBT 练习 / 冥想 = 当月真实干预完成次数
  const extra = useMemo(() => {
    if (!data) return null;
    const pcts: number[] = [];
    for (let d = 1; d <= viewDays; d++) {
      const dk = `${viewY}-${String(viewM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const s = healthStore.getSleep(dk);
      if (s && s.total > 0) pcts.push(Math.round((s.deep / s.total) * 100));
    }
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const startPct = pcts.length >= 2 ? avg(pcts.slice(0, 3)) : null;
    const endPct = pcts.length >= 2 ? avg(pcts.slice(-3)) : null;
    const scale = Math.max(startPct ?? 0, endPct ?? 0, 25);

    let cbt = 0, med = 0;
    for (const e of data.interventions) {
      const d = new Date(e.ts);
      if (d.getFullYear() !== viewY || d.getMonth() !== viewM) continue;
      if (e.kind === 'breath' || e.kind === 'meditate') med += 1;
      else if (CBT_KINDS.includes(e.kind)) cbt += 1;
    }
    // 记录饮食的天数（当月去重到天，用于「这个月完成的事」的真实口径）
    const foodDays = new Set<number>();
    for (const f of data.foods) {
      const d = new Date(f.ts);
      if (d.getFullYear() === viewY && d.getMonth() === viewM) foodDays.add(d.getDate());
    }
    return { startPct, endPct, scale, sleepDays: pcts.length, cbt, med, foodDays: foodDays.size };
  }, [data, viewY, viewM, hsVer]);

  /**
   * 「你的本月节奏」= 时间热力（4 时段 × 7 天）+ 44% 主数字 + 4 条洞察，合一卡。
   * 全部接真实源：干预 / 饮食 / 运动 的 ts → 按时段×星期铺热力；四条洞察只用真实可算事实。
   * 时段口径：清晨 5–9 / 白天 9–18 / 傍晚 18–21 / 夜间 21–24（含 0–4）。
   * 数据不足（某条样本 < 2）则跳过该条，不编相关性。
   */
  const rhythm = useMemo(() => {
    if (!data) return null;
    const heat: number[][] = SLOTS.map(() => new Array(7).fill(0));
    const slotTotals = new Array(4).fill(0);
    let total = 0;

    const recs: { ts: number }[] = [];
    for (const e of data.interventions) recs.push({ ts: e.ts });
    for (const f of data.foods) recs.push({ ts: f.ts });
    for (const s of data.sports) recs.push({ ts: s.ts });
    for (const r of recs) {
      if (r.ts <= 0) continue; // 计划（ts=0）不进热力
      const d = new Date(r.ts);
      if (d.getFullYear() !== viewY || d.getMonth() !== viewM) continue;
      const h = d.getHours();
      const dow = (d.getDay() + 6) % 7; // 0=一 … 6=日
      const slot = h >= 5 && h <= 8 ? 0 : h >= 9 && h <= 17 ? 1 : h >= 18 && h <= 20 ? 2 : 3;
      heat[slot][dow] += 1;
      slotTotals[slot] += 1;
      total += 1;
    }
    let dominantIdx = 0;
    for (let i = 1; i < 4; i++) if (slotTotals[i] > slotTotals[dominantIdx]) dominantIdx = i;
    const dominantPct = total > 0 ? Math.round((slotTotals[dominantIdx] / total) * 100) : 0;

    type Insight = { icon: IconName; soft: string; deep: string; text: string; chip: string };
    const insights: Insight[] = [];
    const md = (day: number) => `${viewM + 1}/${day}`;

    // ① 呼吸练习几乎都在晚上
    const breathEntries = data.interventions.filter(
      (e) => (e.kind === 'breath' || e.kind === 'meditate') && inMonth(e.ts, viewY, viewM),
    );
    const bTotal = breathEntries.length;
    const bNight = breathEntries.filter((e) => {
      const h = new Date(e.ts).getHours();
      return h >= 21 || h <= 4;
    }).length;
    if (bTotal >= 2) {
      insights.push({
        icon: 'breath', soft: mm.colors.purpleSoft, deep: mm.colors.purpleDeep,
        text: `你做过的呼吸练习几乎都在晚上 —— ${bTotal} 次里有 ${bNight} 次在 21 点以后。`,
        chip: `夜间 21:00–24:00 · ${bNight} / ${bTotal} 次`,
      });
    }

    // ② 记饮食天数 vs 深睡占比（真实对照，不编因果）
    const foodDaySet = new Set<number>();
    for (const f of data.foods) if (inMonth(f.ts, viewY, viewM)) foodDaySet.add(new Date(f.ts).getDate());
    const dayPct: Record<number, number> = {};
    for (let d = 1; d <= viewDays; d++) {
      const dk = `${viewY}-${String(viewM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const s = healthStore.getSleep(dk);
      if (s && s.total > 0) dayPct[d] = Math.round((s.deep / s.total) * 100);
    }
    const dietPcts: number[] = [];
    const nonDietPcts: number[] = [];
    for (const [dStr, v] of Object.entries(dayPct)) {
      if (foodDaySet.has(Number(dStr))) dietPcts.push(v); else nonDietPcts.push(v);
    }
    const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
    if (dietPcts.length >= 2 && nonDietPcts.length >= 2) {
      insights.push({
        icon: 'food', soft: mm.colors.limeSoft, deep: mm.colors.limeDeep,
        text: `认真记饮食的那 ${dietPcts.length} 天，你的深睡平均 ${avg(dietPcts)}%；没记的那 ${nonDietPcts.length} 天平均 ${avg(nonDietPcts)}%。`,
        chip: `记饮食 ${dietPcts.length} 天 · 没记 ${nonDietPcts.length} 天`,
      });
    }

    // ③ 呼吸练习最长连续天数
    const breathDays = [...new Set(breathEntries.map((e) => new Date(e.ts).getDate()))].sort((a, b) => a - b);
    let best = 0, run = 0, bestStart = 0, bestEnd = 0, curStart = 0;
    for (let i = 0; i < breathDays.length; i++) {
      if (i === 0 || breathDays[i] === breathDays[i - 1] + 1) { if (run === 0) curStart = breathDays[i]; run++; }
      else { run = 1; curStart = breathDays[i]; }
      if (run > best) { best = run; bestStart = curStart; bestEnd = breathDays[i]; }
    }
    if (best >= 2) {
      insights.push({
        icon: 'sync', soft: mm.colors.skySoft, deep: mm.colors.skyDeep,
        text: `${md(bestStart)} 到 ${md(bestEnd)}，你的呼吸练习连着 ${best} 天没断过。`,
        chip: `最长连续 ${best} 天 · ${md(bestStart)}–${md(bestEnd)}`,
      });
    }

    // ④ 深睡占比月初→月末（复用 extra 的起止均值）
    if (extra && extra.startPct != null && extra.endPct != null) {
      const gain = extra.endPct - extra.startPct;
      insights.push({
        icon: 'moon', soft: mm.colors.honeySoft, deep: mm.colors.honeyDeep,
        text: `深睡占比从月初的 ${extra.startPct}% 走到月末的 ${extra.endPct}%。${gain > 0 ? '数字不大，但方向很清楚。' : gain < 0 ? '睡眠浅了一点，慢慢调回来。' : '一直挺平稳。'}`,
        chip: `${gain > 0 ? '+' : ''}${gain} 个百分点`,
      });
    }

    return { heat, slotTotals, total, dominantIdx, dominantPct, insights };
  }, [data, viewY, viewM, viewDays, extra, hsVer]);

  // 观察列表：剔除「数据覆盖」这类上下文条目（单独作脚注）
  const observedPatterns = useMemo(
    () => patterns.filter((p) => p.kind !== 'coverage'),
    [patterns],
  );
  // ★ 2026-11-06（用户：底下那句「这 30 天里有六天是有可用数据…」不需要写）→ coverageNote 随之移除。

  // 月历网格（周一起始，补齐整周）
  const rows = useMemo(() => {    const first = new Date(viewY, viewM, 1).getDay();
    const lead = (first + 6) % 7;
    const total = new Date(viewY, viewM + 1, 0).getDate();
    const cells: number[] = [];
    for (let i = 0; i < lead; i++) cells.push(-1);
    for (let d = 1; d <= total; d++) cells.push(d);
    const filled = Math.ceil(cells.length / 7) * 7;
    while (cells.length < filled) cells.push(-1);
    const rowList: number[][] = [];
    for (let i = 0; i < cells.length; i += 7) rowList.push(cells.slice(i, i + 7));
    return rowList;
  }, [viewY, viewM]);

  const onGridLayout = (e: any) => {
    const gridW = e.nativeEvent.layout.width;
    const w = (gridW - GAP * (COLS - 1)) / COLS;
    setCellW(w);
  };

  /** 单元格：预览稿口径 aspect 1 : 1.18（2026-10-17 用户「日历卡片再小一点」：1.32 → 1.18）；透明底（无灰框），仅今天蜜黄 */
  const cellH = cellW * 1.18;
  // ★ 2026-10-20（用户：「日历页面上面的那些图片稍微小一点」）：照片占格宽比例 0.95 → 0.82，
  //   格内图片更收敛、周围留白更多（堆叠错位/旋转仍保留层次感）
  const photo = Math.max(20, cellW * 0.82);

  const renderCell = (day: number, colIdx: number, rowIdx: number) => {
    // ★ 只有真实存在的日（day > 0）才可能是「今天」。空槽 day = -1，而非当前月时 todayDay 也是 -1，
    //   若只写 day === todayDay，则所有空槽都会被判成「今天」→ 染上蜜黄底方框
    //   （用户 2026-10-12 截图发现的「一二三四五那些空的时间怎么有背景框」根因）。必须加 day > 0。
    const isToday = day > 0 && day === todayDay;
    // ★ 2026-11-07（用户）：去掉右上角皇冠；icon 放大到至少原来的两倍（约 0.84 格宽，上限留 4pt 边距）。
    const cell = day > 0 ? dayCellMap[day] : null;
    const box = Math.max(28, Math.min(cellW - 4, Math.round(cellW * 0.84)));

    return (
      <TouchableOpacity
        key={`${rowIdx}-${colIdx}-${day}`}
        activeOpacity={day > 0 ? 0.6 : 1}
        disabled={day <= 0}
        onPress={() => { if (day > 0) setDrawerDate(new Date(viewY, viewM, day)); }}
        accessibilityRole={day > 0 ? 'button' : undefined}
        accessibilityLabel={day > 0 ? `${viewM + 1}月${day}日` : undefined}
        style={[
          styles.cell,
          { marginRight: colIdx === 6 ? 0 : GAP, height: cellH, backgroundColor: isToday ? TODAY_BG : 'transparent' },
        ]}
      >
        <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{day > 0 ? day : ''}</Text>

        {/* ★ 2026-11-07（用户）：格子内只展示当天一个代表 icon（如起床 = ☀️ 太阳），皇冠已去掉 */}
        {cell?.icon ? (
          <View
            style={[
              styles.cellIconBox,
              {
                width: box, height: box, borderRadius: Math.round(box * 0.28),
                backgroundColor: mixWhite(cell.color, 0.82),
              },
            ]}
          >
            <Text style={[styles.cellIconTxt, { fontSize: Math.round(box * 0.58) }]}>{cell.icon}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      {/* ★ 时间选择器（◀ 月 ▶ + 点中间弹日历，与详情页同款）；按用户要求放在「规律总结」小卡之上 */}
      <DateAnchorPicker value={anchor} onChange={setAnchor} range="month" />

      {/* ★ 规律总结标题
          ★ 2026-10-12（用户）：① 去掉外框（无边框、无填充，就是两行字）；
            ② 删掉「连续记录天数 / 本月养成习惯 / 新发现」三格统计 —— 用户原话
              「那个两次连续记录呀，本月养成习惯呀，新发现这个也不要写了」。 */}
      {summary ? (
        <View style={styles.heroCard}>
          <Text style={styles.heroHeadline}>
            {summary.totalDelta > 0 ? '稳步向上的一个月' : '平稳的一个月'}
          </Text>
          <Text style={styles.heroSub}>
            {summary.activeDays > 0
              ? `你留下了 ${summary.activeDays} 天记录，${summary.newHabits > 0 ? `${summary.newHabits} 件小事正在变成习惯。` : '慢慢来也没关系～'}`
              : '这个月还没留下什么记录，慢慢来也没关系～'}
          </Text>
        </View>
      ) : null}

      {/* ★ 2026-11-07（用户）：月视图 = 日历；每个格子内堆叠「当天皇冠任务」的 icon 卡。
          周一起始，空槽不画框；点格子 → 下抽屉日视图（旅程 + 两侧活动卡）。 */}
      <View style={styles.grid} onLayout={onGridLayout}>
        <View style={styles.weekRow}>
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <Text key={w} style={styles.weekLabel}>{w}</Text>
          ))}
        </View>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((day, ci) => renderCell(day, ci, ri))}
          </View>
        ))}
      </View>

      {/* ★ 2026-11-03(2)：按用户要求「先隐藏掉我的本月节奏」——整卡隐藏（保留代码便于后续切换） */}
      {false && (
      <Card>
        {/* ★ 月度发现 · 你的本月节奏（合并「你做过多少次」）：时间热力 + 44% + 你做过多少次（可折叠）
          ★ 2026-10-28 重设计：卡头去掉图标只留标题 + 收藏；去掉原「洞察」散文段，
            下方改放「你做过多少次」；其小标题右侧加向下箭头可折叠。 */}
        <View style={styles.cardHead}>
          <Text style={styles.cardHeadTitle}>你的本月节奏</Text>
          <View style={styles.headActions}>
            <TouchableOpacity
              style={styles.favBtn}
              onPress={() => setFavRhythm((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={favRhythm ? '取消收藏本月节奏' : '收藏本月节奏'}
            >
              <Icon name="bookmark" size={18} color={favRhythm ? GOLD : mm.colors.inkFaint} />
            </TouchableOpacity>
          </View>
        </View>

        {rhythm ? (
          <>
            {/* 时间热力：4 时段 × 7 天 */}
            <View style={styles.hmGrid}>
              <View style={styles.hmRow}>
                <View style={styles.hmCorner} />
                {WEEK_LABELS.map((w) => (
                  <Text key={w} style={styles.hmDow}>{w}</Text>
                ))}
              </View>
              {SLOTS.map((s, si) => (
                <View key={s.label} style={styles.hmRow}>
                  <Text style={styles.hmLab}>{s.short}</Text>
                  {rhythm.heat[si].map((v, di) => (
                    <View key={di} style={[styles.hmCell, { backgroundColor: heatColor(v) }]} />
                  ))}
                </View>
              ))}
            </View>

            {/* 图例 */}
            <View style={styles.hmLegend}>
              <Text style={styles.hmLegendText}>少</Text>
              {HEAT_LEV.map((c, i) => (
                <View key={i} style={[styles.hmSwatch, { backgroundColor: c }]} />
              ))}
              <Text style={styles.hmLegendText}>多</Text>
            </View>

            {/* 44% 主数字 */}
            <View style={styles.hmBig}>
              <Text style={[styles.hmBigNum, { color: mm.colors.purpleDeep }]}>
                {rhythm.dominantPct}<Text style={styles.hmBigUnit}>%</Text>
              </Text>
              <Text style={styles.hmBigLab}>
                {rhythm.total > 0
                  ? `你的记录出现在${SLOTS[rhythm.dominantIdx].label} 点`
                  : '这个月还没留下记录，慢慢来也没关系～'}
              </Text>
            </View>
            <Text style={styles.cardNote}>色深 = 那个时段做了多少次 · 按小时和星期把你的记录铺开看</Text>

            {/* ★ 你做过多少次（合并进本月节奏；小标题右侧箭头可折叠） */}
            <TouchableOpacity
              style={styles.subLabelRow}
              onPress={() => setCountOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={countOpen ? '收起你做过多少次' : '展开你做过多少次'}
            >
              <Text style={styles.subLabel}>你做过多少次</Text>
              <Icon
                name="chevronDown"
                size={16}
                color={mm.colors.inkFaint}
                style={{ transform: [{ rotate: countOpen ? '0deg' : '180deg' }] }}
              />
            </TouchableOpacity>

            {countOpen ? (
              <View style={styles.obsWrap}>
                {habitCards.length > 0 ? (
                  (() => {
                    const maxCount = Math.max(...habitCards.slice(0, 5).map((x) => x.count), 1);
                    return habitCards.slice(0, 5).map((h, i) => (
                      <View key={h.name} style={[styles.habitRow, i > 0 && styles.habitRowGap]}>
                        <View style={styles.habitTopRow}>
                          <View style={[styles.habitIconSq, { backgroundColor: h.soft }]}>
                            <Icon name={h.icon as any} size={16} color={h.deep} />
                          </View>
                          <View style={styles.habitTextCol}>
                            <Text style={styles.habitName}>{h.name}</Text>
                            {h.metric ? <Text style={styles.habitTag}>{h.metric}</Text> : null}
                          </View>
                          <View style={styles.habitNumRow}>
                            <Text style={[styles.habitNum, { color: mm.colors.ink }]}>{h.count}</Text>
                            <Text style={styles.habitUnit}>{h.unit}</Text>
                          </View>
                        </View>
                        {/* ★ 2026-10-28（用户：恢复进度条）：每条约一根进度条，宽度 = 该习惯次数 ÷ 本月最多次数，直观看相对量 */}
                        <View style={styles.habitTrack}>
                          <View
                            style={[
                              styles.habitFill,
                              { width: `${Math.max(8, Math.round((h.count / maxCount) * 100))}%`, backgroundColor: h.deep },
                            ]}
                          />
                        </View>
                        <View style={styles.habitFoot}>
                          <Text style={styles.habitFootText}>{mdOf(h.firstAt)} – {mdOf(h.lastAt)}</Text>
                          <Text style={styles.habitFootText}>{weeklyText(h.count, h.firstAt, h.lastAt, h.unit)}</Text>
                        </View>
                      </View>
                    ));
                  })()
                ) : (
                  <Text style={styles.cardNote}>把 Mira 的建议确认「有帮助」之后，就会出现在这里</Text>
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>
      )}

      {/* ★ 2026-11-03(2)：规律观察 —— 每条独立成一张磨砂玻璃卡（左 icon + 右内容 + 类别标签）；
          卡头只留标题 + 收藏（保留切换）。 */}
      <View style={styles.cardHead}>
        <Text style={styles.cardHeadTitle}>规律观察</Text>
        <View style={styles.headActions}>
          <TouchableOpacity
            style={styles.favBtn}
            onPress={() => setFavPattern((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={favPattern ? '取消收藏规律观察' : '收藏规律观察'}
          >
            <Icon name="bookmark" size={18} color={favPattern ? GOLD : mm.colors.inkFaint} />
          </TouchableOpacity>
        </View>
      </View>

      {(() => {
        const isSample = observedPatterns.length === 0;
        return (
          <>
            {isSample ? (
              /* ★ 空态（诚实）：真实规律还没攒够样本，不放假观察 */
              <Card>
                <View style={styles.patObsRow}>
                  <View style={[styles.obsIco, { backgroundColor: mm.colors.skySoft }]}>
                    <Icon name="sparkle" size={14} color={mm.colors.skyDeep} />
                  </View>
                  <View style={styles.obsBody}>
                    <Text style={styles.obsText}>还没有从你的数据里看出稳定规律。</Text>
                    <Text style={styles.cardNote}>
                      连续佩戴并记录一两周后，这里会出现真正属于你的观察（比如作息与情绪的关联）。样本不够时，我们不会编一条给你。
                    </Text>
                  </View>
                </View>
              </Card>
            ) : observedPatterns.slice(0, 4).map((p, idx) => {
              const accent =
                p.kind === 'rhythm' ? { soft: mm.colors.honeySoft, deep: mm.colors.honeyDeep }
                : p.kind === 'correlation' ? { soft: mm.colors.skySoft, deep: mm.colors.skyDeep }
                : p.kind === 'group_diff' ? { soft: mm.colors.purpleSoft, deep: mm.colors.purpleDeep }
                : { soft: mm.colors.limeSoft, deep: mm.colors.limeDeep };
              const pIcon: IconName =
                p.kind === 'rhythm' ? 'moon'
                : p.kind === 'correlation' ? 'sync'
                : p.kind === 'group_diff' ? 'activity'
                : 'sparkle';
              const kindLabel = patternKindLabel(p.kind);
              // ★ 2026-11-07（用户）：规律观察卡改「错落」展示 —— 像本月卓越表现卡那样
              //   左右轻微交替倾斜（±1.2°），几卡片看去有层次感，不再是整齐一条线。
              const obsRot = idx % 2 === 0 ? -1.2 : 1.2;
              return (
                <Card key={p.id} style={{ transform: [{ rotate: `${obsRot}deg` }] }}>
                  <View style={[styles.patObsRow, isSample && { paddingRight: 8 }]}>
                    <View style={[styles.obsIco, { backgroundColor: accent.soft }]}>
                      <Icon name={pIcon} size={14} color={accent.deep} />
                    </View>
                    <View style={styles.obsBody}>
                      {/* ★ 2026-10-28：正文放大 + 纯白，确保一眼读清 */}
                      <Text style={styles.obsText}>{p.text}</Text>
                      {/* ★ 2026-10-28（用户）：每条下方加类别标签，分清这观察讲什么 */}
                      <View style={[styles.patTag, { backgroundColor: accent.soft }]}>
                        <Text style={[styles.patTagText, { color: accent.deep }]}>{kindLabel}</Text>
                      </View>
                      {/* ★ 2026-11-06（用户：「不展示 AI 解读」）→ 移除「✨ AI 解读」入口。
                          ★ 2026-11-03 引入、2026-11-06 用户明确不要了。 */}
                    </View>
                    {/* ★ 2026-11-06（用户：「右边那个删掉，改成一个叉就行了，不要删掉那两个字」）
                        → 「删掉」两个字换成 ✕ 图标按钮。 */}
                    <TouchableOpacity
                      style={styles.patObsDel}
                      onPress={() => { void onPatternRemove(p.id); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={`删掉这条规律：${p.title}`}
                    >
                      <Text style={styles.patObsDelText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
            {/* ★ 2026-11-06（用户：「底下那句话不用写，这 30 天里有六天是有可用数据，
                这些个数在这些数据可以看出来规律之类，这句话不需要写。」）
                → 移除 coverageNote 脚注（覆盖天数/说明文案整行去掉）。 */}
          </>
        );
      })()}

      {/* ★ 2026-10-28：「你做过多少次」已合并进上方「你的本月节奏」卡（可折叠），此处不再单独成卡 */}

      {/* ★ 点击某个日期 → 下抽屉（原先「日」页的旅程视图：中间曲线 + 两侧活动卡片） */}
      <DayDrawer date={drawerDate} onClose={() => setDrawerDate(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 根容器：卡片之间留白（对齐截图卡片间距）
  root: { gap: theme.sp(3) },
  // 日历外层：透明、无边框、无阴影 —— 等同预览稿里浮在页面上的日历
  // ★ 2026-10-14：① marginHorizontal:-space.screen 让日历**整块满出血**（取消页面两侧 24px 白边），
  //   最左列照片不再被卡片 overflow 切掉、整张可见；② overflow:visible + borderRadius:0
  //   （透明卡本就无框，放开裁切避免圆角把贴边照片拐角切掉）。
  calCard: {
    backgroundColor: 'transparent', borderWidth: 0, shadowOpacity: 0, elevation: 0,
    alignSelf: 'center', width: '100%', maxWidth: Math.min(330, SCREEN_W - 48),
    overflow: 'visible', borderRadius: 0,
  },
  weekRow: { flexDirection: 'row', marginBottom: theme.sp(1) },
  weekLabel: {
    flex: 1, marginRight: GAP, textAlign: 'center', fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as any, color: theme.colors.textBody, paddingVertical: theme.sp(1),
  },
  weekLabelWE: { color: GOLD },
  grid: {},
  row: { flexDirection: 'row', marginBottom: GAP },
  // 单元格：透明无框（仅今天蜜黄），照片直接浮在页面上 —— 对齐预览 .cell
  cell: {
    flex: 1, borderRadius: theme.radius.sm, padding: 2, alignItems: 'center', justifyContent: 'flex-start',
  },
  // ★ 2026-10-14：日期数字改绝对定位 + zIndex 5，永远压在照片之上（照片下移后也不被盖住）
  dayNum: {
    position: 'absolute', top: 3, left: 4, zIndex: 5,
    fontSize: theme.fontSize.tiny, fontWeight: theme.weight.medium as any, color: theme.colors.textSub,
  },
  dayNumToday: { color: '#B98A2E', fontWeight: theme.weight.bold as any },

  // ★ 2026-11-07（用户）：格子内只放「一个代表 icon」的方块（如起床 = ☀️ 太阳），居中于日期数字下方；皇冠已去掉
  cellIconBox: { alignItems: 'center', justifyContent: 'center', marginTop: theme.sp(3) },
  cellIconTxt: { textAlign: 'center' },

  /* ★ 2026-11-06（用户）：格子皇冠展示（替代照片堆叠；本轮改为矢量 CrownMark）——
     ≤4 个逐个排开；>4 个显示「👑×N」，保证不溢出格子。 */
  crownWrap: { position: 'absolute', top: 18, left: 2, right: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', rowGap: 1 },
  crownX: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  crownXText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },

  // 照片堆叠区（对齐预览 .stack）：★ 2026-10-14 top 12 → 18，整摞照片下移，给左上角日期数字让位
  stackWrap: { position: 'absolute', top: 18, left: 1, right: 1, bottom: 2, alignItems: 'center', justifyContent: 'center' },
  // 单张照片卡（对齐预览 .ph：正方 + 白描边 1.5 + 圆角 7 + 投影）
  photoCard: {
    position: 'absolute', borderRadius: 7, borderWidth: 1.5, borderColor: '#fff',
    overflow: 'hidden', backgroundColor: '#fff',
    shadowColor: '#1F1D1A', shadowOpacity: 0.18, shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 }, elevation: 0,
  },
  photoImg: { width: '100%', height: '100%' },
  // +N 徽章（对齐预览 .plus：深墨药丸 + 白字，贴右下）
  plusBadge: {
    position: 'absolute', right: 0, bottom: 0, minWidth: 15, height: 14, borderRadius: 7,
    paddingHorizontal: 4, backgroundColor: '#1F1D1A',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  plusText: { fontSize: theme.fontSize.tiny, fontWeight: theme.weight.bold as any, color: theme.colors.textWhite },

  // 卡片小标题（图标 + 标题）
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.sp(3) },
  cardHeadTitle: { fontSize: theme.fs(17), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3 },
  // ★ 2026-10-28 重设计：卡头右侧操作（收藏）
  headActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: theme.sp(3) },
  favBtn: { padding: theme.sp(1), marginRight: -theme.sp(1) },
  // ★ 你做过多少次 折叠小标题（左侧文字 + 右侧向下箭头）
  subLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(4) },
  subLabel: { flex: 1, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, letterSpacing: 1 },
  cardNote: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: theme.sp(2) },

  // ① 规律总结标题（★ 2026-10-12 用户：去掉外框，就是两行字；三个统计格已删）
  heroCard: { backgroundColor: 'transparent', paddingHorizontal: 2 },
  heroHeadline: { fontSize: theme.fs(17), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3 },
  heroSub: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: theme.sp(1.5), lineHeight: 18 },

  // ② 这个月养成的习惯（图标块 + 名称 + 证据短语 + 大数字 + 进度条 + 起止/频率）
  habitRow: {},
  habitRowGap: { marginTop: theme.sp(3.5) },
  habitTopRow: { flexDirection: 'row', alignItems: 'center' },
  habitIconSq: {
    width: 30, height: 30, borderRadius: mm.radius.iconSqMd,
    alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2.5),
  },
  habitTextCol: { flex: 1, minWidth: 0 },
  habitName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  // ★ 2026-10-28：证据短语放大到 xs + inkSoft，原 micro/inkSoft 太小看不清
  habitTag: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: 2 },
  // 大数字（对齐用户截图：次数大、单位小）
  habitNumRow: { flexDirection: 'row', alignItems: 'flex-end', marginLeft: theme.sp(2) },
  habitNum: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold, letterSpacing: -0.5, lineHeight: 28 },
  habitUnit: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium as any, color: mm.colors.inkSoft, marginLeft: 2, marginBottom: 4 },
  habitTrack: { height: 7, borderRadius: 4, backgroundColor: mm.colors.emptyFill, overflow: 'hidden', marginTop: theme.sp(2.5) },
  habitFill: { height: 7, borderRadius: 4 },
  habitFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.sp(1.5) },
  // ★ 2026-10-28：起止/频率小字放大到 xs + inkSoft
  habitFootText: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },

  // 你的本月节奏（热力 + 44% + 洞察，合一卡）
  hmGrid: { marginTop: theme.sp(0.5) },
  hmRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1), marginBottom: theme.sp(1) },
  hmCorner: { width: 32 },
  hmLab: {
    width: 32, fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any,
    color: mm.colors.inkFaint, textAlign: 'center',
  },
  hmDow: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: mm.colors.inkFaint },
  hmCell: { flex: 1, aspectRatio: 1, borderRadius: 4, backgroundColor: mm.colors.emptyFill },
  hmLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: theme.sp(1), marginTop: theme.sp(2) },
  hmLegendText: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft },
  hmSwatch: { width: 11, height: 11, borderRadius: 3.5 },
  hmBig: { marginTop: theme.sp(3) },
  hmBigNum: { fontSize: theme.fs(26), fontWeight: theme.weight.bold as any, letterSpacing: -0.7, lineHeight: 30 },
  hmBigUnit: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: mm.colors.inkSoft, marginLeft: 2 },
  hmBigLab: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: theme.sp(0.5), lineHeight: 18 },
  obsWrap: { marginTop: theme.sp(4) },
  obs: { flexDirection: 'row', alignItems: 'flex-start' },
  obsGap: { marginTop: theme.sp(3.5) },
  obsIco: {
    width: 26, height: 26, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center',
    marginRight: theme.sp(2.5), marginTop: 1, flexShrink: 0,
  },
  obsBody: { flex: 1, minWidth: 0 },
  // ★ 2026-10-28（用户）：正文放大到 sm + 纯白 —— 半透明白卡上原 xs/inkSoft 发糊，现一眼读清
  obsText: { fontSize: theme.fontSize.sm, color: mm.colors.ink, lineHeight: 21 },
  obsChip: { alignSelf: 'flex-start', borderRadius: theme.radius.pill, paddingVertical: 3, paddingHorizontal: 9, marginTop: theme.sp(1.5) },
  obsChipText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any },

  // ★ 2026-10-28 重设计：规律观察 obs 行（左图标 + 文字 + 右上角删掉）
  patObsRow: { flexDirection: 'row', alignItems: 'flex-start', position: 'relative', paddingRight: 44 },
  patObsDel: { position: 'absolute', top: 0, right: 0, paddingHorizontal: 6, paddingVertical: 2 },
  // ★ 2026-10-28：删掉按钮放大到 xs + inkSoft，原来 micro/inkFaint 太小太淡看不清
  patObsDelText: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },
  // ★ 2026-10-28（用户）：每条规律观察下方的类别标签（时间节律/相关/组间差异）
  patTag: { alignSelf: 'flex-start', borderRadius: theme.radius.pill, paddingVertical: 3, paddingHorizontal: 10, marginTop: theme.sp(2.5) },
  patTagText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, letterSpacing: 0.4 },
  // ★ 2026-11-03（用户：规律观察接上 AI）：每条规律下方的「✨ AI 解读」入口
  patAiBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1), marginTop: theme.sp(2) },
  patAiBtnText: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft, fontWeight: theme.weight.medium as any },

  // ★ Phase 2：规律观察卡
  patRow: {},
  patRowGap: { marginTop: theme.sp(3.5) },
  patHeadRow: { flexDirection: 'row', alignItems: 'flex-start' },
  patTitle: {
    flex: 1, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold,
    color: mm.colors.ink, lineHeight: 20,
  },
  patOkBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: mm.colors.limeSoft, borderRadius: theme.radius.pill,
    paddingHorizontal: 7, paddingVertical: 2.5, marginLeft: theme.sp(2),
  },
  patOkText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: mm.colors.limeDeep },
  patText: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, lineHeight: 20, marginTop: theme.sp(1) },
  patFootRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.sp(2),
  },
  patChip: { borderRadius: theme.radius.pill, paddingVertical: 2.5, paddingHorizontal: 8, alignSelf: 'flex-start' },
  patChipText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any },
  patActions: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) },
  // ★ Phase 3：问问 Mira —— 走云端长窗口综合分析
  patActAsk: {
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: mm.colors.purpleSoft,
  },
  patActAskText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: mm.colors.purpleDeep },
  patActOk: {
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: mm.colors.limeSoft,
  },
  patActOkText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: mm.colors.limeDeep },
  patActDel: {
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: mm.colors.emptyFill,
  },
  patActDelText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any, color: mm.colors.inkFaint },

  // ★ 本轮（用户）：月视图「本月卓越表现」Icon 卡堆叠（与回顾·日视图卡片同源风格）
  deckWrap: { width: '100%', alignSelf: 'center', maxWidth: 360 },
  deckHead: { fontSize: theme.fs(17), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3, marginBottom: theme.sp(2) },
  deckList: { gap: theme.sp(2.5) },
  deckEmpty: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, textAlign: 'center', lineHeight: theme.fontSize.sm * 1.5 },
  exCard: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPadCompact,
    shadowColor: mm.shadow.color, shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius, shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
  },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), paddingRight: theme.sp(8) },
  exIcon: { width: theme.sp(7.5), height: theme.sp(7.5), borderRadius: mm.radius.iconSq, alignItems: 'center', justifyContent: 'center' },
  exIconTxt: { fontSize: theme.fontSize.body },
  exTitle: { flex: 1, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink, lineHeight: theme.fontSize.sm * 1.3 },
  exCrown: { position: 'absolute', top: theme.sp(1.25), right: theme.sp(1.5), zIndex: 3 },
  exSub: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, lineHeight: theme.fontSize.micro * 1.4, marginTop: theme.sp(1.25) },
  exDate: { fontSize: theme.fontSize.micro - 1, color: mm.colors.inkFaint, marginTop: theme.sp(1.5) },
});
