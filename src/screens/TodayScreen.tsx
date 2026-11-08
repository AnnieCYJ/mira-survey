import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground, Animated, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const IMG_RECOVERY = require('../assets/card_recovery.jpg');
const IMG_EMOTION = require("../assets/card_emotion_new.png");
const IMG_COG = require("../assets/card_focus.jpg");
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
import Card from '../components/Card';
import GlassCard from '../components/GlassCard';
import Icon from '../components/Icon';
import EnergyBall from '../components/EnergyBall';
import SleepRhythmHomeCard from '../components/SleepRhythmHomeCard';
import SleepCard from '../components/SleepCard';
import { loadPeriodDays } from '../data/cycleLog';
import MindChips, { type MindChipItem } from '../components/MindChips';
import MindStatCard from '../components/MindStatCard';
import BentoCard from '../components/BentoCard';
import EmotionDots, { type MindMoodKey } from '../components/EmotionDots';
import MindWave from '../components/MindWave';
import { computeStressReport } from '../lib/stressAlgorithm';
// ★ v18.132：情绪压力改多信号融合判定（分离运动/设备故障），替代单信号 EDA 事件计数
import { computeEmotionalStress, LEVEL_LABEL, MIN_BASELINE_DAYS as ES_MIN_BASELINE_DAYS } from '../lib/emotionalStress';
import { computeCognitiveLoadReport, COG_LEVEL_LOW, COG_LEVEL_HIGH, cogLevelLabel, cogBarRatio } from '../lib/cognitiveLoad';
// ★ 认知准备度（2026-10-05）：首页「脑力」卡由「疲劳」改为「准备度」，柱状图改趋势图
import { computeReadinessSeries, readinessLevelLabel } from '../lib/cognitiveReadiness';
import MiniReadinessTrend from '../components/MiniReadinessTrend';
import { computeSleepPersonalized, sleepRecoveryTag } from '../lib/sleepPersonalized';
import { RingBle, type RingSportSession } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore'
// ★ 2026-11-06 审查（docs/audit/02 🔵#3）：接真实账号昵称，不再写死 Kristina / K
import { userStore, getCachedSession } from '../data/userStore';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from '../components/CortisolRhythmCard';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { MOODS } from '../data/metrics';
import { MemoryStore } from '../ai/memory';
import { inferThemes } from '../ai/miraAi';
import { onAiRecord } from '../lib/aiRecordBus';
import { evaluateTodayScene, markSceneShown, initTodaySceneCounter, buildCauseNarrative, type TodayScene } from '../lib/todayScene';
import { narrSigOf, aiNarrativeFor, requestAiNarrative } from '../lib/aiNarrative';
import { dayPhase } from '../lib/timePhase';
import HomeAiBubble from '../components/HomeAiBubble';
import PhaseLegend from '../components/PhaseLegend';
import type { PhaseKey } from '../lib/phaseColors';
import { resolveSportName } from '../lib/veepooSportTypes';
import { sportVisualOf } from '../lib/sportVisual';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

/** 「今日日历」取的 AI 聊天记录（MemoryStore 单例，避免每次渲染重建） */
const memoryStore = new MemoryStore();

/** ★ 睡眠卡显示开关（2026-10-05）：用户要求**先隐藏、代码保留**。
 *  改回 true 即恢复原样 —— 组件、props、数据口径都没有改动，只是不渲染。
 *  注意：这不影响「睡眠恢复」chip（第一屏）与 EmotionCognitiveDetail 详情页。 */
const SHOW_SLEEP_CARD: boolean = false;

/** ★ 第二屏（消耗与恢复节律）Bento 卡片总开关（2026-10-07）：用户要求「全天状态趋势下面的那些卡片先帮我隐藏」。
 *  改回 true 即整组恢复 —— 各卡组件、props、数据口径均未改动，只是不渲染。
 *  覆盖：睡眠节律 / 脑力消耗 / 心理压力 / 运动消耗 / 经期（含被 SHOW_SLEEP_CARD 单独控制的睡眠卡）。 */
const SHOW_RHYTHM_CARDS: boolean = false;


// 智能建议：结合经期相位 + 能量等级 + **时段** → 双分句短句
// ★ 时段优先：晚(18-22)/深夜(22-6) 一律休息导向，不管相位和能量等级
//   （1.5B 小模型搞不定优先级链，规则确定性兜底避免幻觉）
function buildSmartAdvice(phase: string, statusIdx: number | null, asleep: boolean): string {
  if (asleep) {
    if (phase === '经期') return '经期睡眠中，安心休息助修复';
    if (phase === '黄体期') return '黄体期睡眠中，深睡稳情绪';
    return '睡眠恢复中，安心休息';
  }

  const h = new Date().getHours();
  const isEvening = h >= 18 && h < 22;
  const isNight = h >= 22 || h < 6;
  const low = statusIdx != null && statusIdx >= 2;
  const high = statusIdx === 0;

  // 时段优先：傍晚/深夜 → 休息导向
  if (isEvening || isNight) {
    if (phase === '经期')     return '收工放松，别安排高强度活动';
    if (phase === '卵泡期')   return '适合轻松阅读，早点休息养精蓄锐';
    if (phase === '排卵期')   return '今日社交已够，收工放松别熬夜';
    if (phase === '黄体期')   return '情绪易起伏，做些轻量放松后早点休息';
    return '收工放松，别熬夜';
  }

  // 白天：相位 × 能量等级 组合
  const map: Record<string, { ok: string; low: string; high: string }> = {
    经期:     { ok: '放缓节奏，温和整理与复盘', low: '以休息为主，避免高强度安排', high: '适度活动，有助缓解经期不适' },
    卵泡期:   { ok: '精力回升，适合开启新计划', low: '轻度规划，别给自己太大压力', high: '精力峰值，推进项目和头脑风暴' },
    排卵期:   { ok: '状态活跃，社交沟通黄金窗口', low: '适合一对一沟通，重大决策可稍缓', high: '能量情商双高，谈判汇报都是黄金时机' },
    黄体期:   { ok: '专注执行收尾，留意情绪起伏', low: '轻松事务为主，别做重大决策', high: '适合深度工作，别熬夜' },
  };

  const entry = map[phase];
  if (!entry) return '记录经期后，为你提供周期专属建议';
  return low ? entry.low : high ? entry.high : entry.ok;
}

// ─────────────────────────────────────────────────────────────
// ★ 模块级组件：必须放在组件外部。
//   反例（2026-09-20 修）：这些组件原先定义在 TodayScreen 内部，导致每次 setState
//   都产生「新的组件类型」，React 会把整棵 SVG 子树卸载重建 —— 这是整屏卡顿的根因。
//   新增图表/卡片一律写在模块作用域，并用 React.memo 包裹。
// ─────────────────────────────────────────────────────────────
// 通用 mini chart 尺寸
// —— v18.52 经期日期圈（参考图 Activity 卡的圆圈行）：最近 7 天，圈 = 日期数字。
//   经期日（有 PeriodDayLog 自记）= lime 深色实心白字；今天 = 深色描边；其余白底。
const PeriodDayCircles = React.memo(function PeriodDayCircles({ marked }: { marked: Record<string, true> }) {
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const todayKey = keyOf(new Date());
  return (
    <View style={styles.pdRow}>
      {days.map((d) => {
        const k = keyOf(d);
        const isPeriod = !!marked[k];
        const isToday = k === todayKey;
        return (
          <View
            key={k}
            style={[
              styles.pdCircle,
              isPeriod && { backgroundColor: mm.chipBg.lav.fg },
              isToday && !isPeriod && { borderWidth: 2, borderColor: mm.chipBg.lav.fg },
            ]}
          >
            <Text style={[styles.pdCircleText, isPeriod && { color: mm.colors.cardBg }]}>{d.getDate()}</Text>
          </View>
        );
      })}
    </View>
  );
});

// Bottom clearance is derived from the tab bar and live safe-area insets below.

export default function TodayScreen() {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const { width } = useWindowDimensions();

  // ─────────────────────────────────────────────────────────────
  // ★ 滚动联动（2026-09-20 新增）。所有插值只驱动 opacity / transform → 走**原生驱动**，
  //   滚动过程中 JS 线程不参与。强度就下面这几个数字，调整改这里即可：
  //     头部：scrollY 0 → 110px 淡出 1 → 0，同时上移 0 → -14px（给出「离开」的动势）
  //   顶部「化入」遮罩已经统一收进 ScreenContainer（所有页面共用），这里只需传白色覆盖默认的 bgTop。
  //   注意：动效只跟「位置」有关，不跟时间，所以上下滑都成立、不消耗额外性能。
  // ─────────────────────────────────────────────────────────────
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });
  const dims = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // ★ 2026-10-10（CustomTabBar marginBottom 0→8 同步）：tab 胶囊抬离屏幕底 8pt，气泡预留跟着 +8，
  //   保持「气泡恒在 Tab 上方」的间距不变（少加会把气泡和 tab 的间隙吃掉）。
  const bottomReserve = theme.layout.tabBarHeight + Math.max(insets.bottom, theme.sp(2)) + theme.sp(2) + 8;
  const navigation = useNavigation<any>();
  // ★ 2026-10-08（用户：「进首页不需要上下滑动」）：首页一屏锁定。
  //   量出第一屏内容的自然高度，若 ≤ 可视高度就彻底关掉滚动与回弹；
  //   只有极窄屏/超长文案导致内容确实超高时，才退回可滚动（避免内容被裁掉）。
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🔵#3）：接**真实账号昵称**，不再写死 Kristina / K。
   *   userStore 已持久化 accountName（注册 / 登录时写入）。
   *   写死会让渠道商用别的名字讲时首页仍显示 Kristina —— 既是演示身份泄漏，
   *   也是真实用户信息没接上。
   */
  const [accountName, setAccountName] = useState(() => {
    const cached = getCachedSession().account?.accountName;
    return cached && cached.trim() ? cached.trim() : '我';
  });
  useEffect(() => {
    let alive = true;
    void userStore.loadSession().then((s) => {
      if (!alive) return;
      const n = s.account?.accountName?.trim();
      if (n) setAccountName(n);
    });
    return () => { alive = false; };
  }, []);
  const accountLetter = useMemo(
    () => (accountName && accountName !== '我' ? accountName.slice(0, 1).toUpperCase() : '我'),
    [accountName]
  );

  const [vp_H, setVpH] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  const homeContentHRef = useRef(0);
  const [sectionHeights, setSectionHeights] = useState({ head: 36, chips: 94, narrative: 48, trend: 158 });
  const measureSection = (key: keyof typeof sectionHeights) => (event: import('react-native').LayoutChangeEvent) => {
    const h = Math.ceil(event.nativeEvent.layout.height);
    setSectionHeights(prev => prev[key] === h ? prev : { ...prev, [key]: h });
  };
  const viewHeight = vp_H || dims.height;
  // ★ 2026-10-15：用户「卡片稍高一点、分析内容多一点」→ 112→138（小屏 100→122），
  //   给「最多 3 行分析 + 建议卡」留出舒展高度、不裁切。
  // ★ 2026-10-15（V1 定稿）：气泡回到白玻璃款（海景图/深玻璃/标题行全部移除），
  //   分析≤3行 + 建议1~2条 → 用户 2026-10-15 晚：加高（170 / 小屏 150）
  // ★ 2026-10-16（用户：「AI分析的卡片高度减小一点，保证在下面的tab上面」）：170/150 → 150/136。
  //   背景：390×844 档按 170 算，一屏纵向预算差 ~14pt，气泡底会越过 Tab 上沿（环 + 两条图例 +
  //   chips 上移后余量更紧）——收 20pt 换回余量，气泡恒定贴在 Tab 上方。
  //   内容下限仍在框内：3 行分析(60) + 间距(8) + 占位两行(40) + 内边距(20) ≈ 133 ≤ 136。
  const bubbleHeight = viewHeight - insets.top - insets.bottom < 620 ? 136 : 150;
  // ★ v18.52 经期日期圈：真实自记经期日（PeriodDayLog 按日期 key），最近 7 天圈行用
  const [periodMarks, setPeriodMarks] = useState<Record<string, true>>({});
  useEffect(() => {
    let alive = true;
    loadPeriodDays()
      .then((p) => { if (alive) setPeriodMarks(Object.fromEntries(Object.keys(p).map((k) => [k, true as const]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [ring, setRing] = useState(() => RingBle.getState());

  // ★ B2（2026-10-08 交互优化）：无内部缓存算法的 memo key ——
  //   healthVer = healthStore 版本（戒指数据写入时自增）、dayKeyStr = 当日日期、
  //   esWindow = 30s 窗口（computeEmotionalStress 吃实时 EDA，与 cognitiveLoad 的 30s 缓存策略同款）。
  // ★ v18.134（审查 04 🟡-5）：healthStore.getVersion() 只是普通读、不触发重渲染；
  //   改用 useHealthStoreVersion 订阅（组件顶部 hsVer），写入后本页才会真正重算。
  const healthVer = hsVer;
  const dayKeyStr = dayKey(Date.now());
  const esWindow = Math.floor(Date.now() / 30000);

  // ★ 今日日历数据源之二：今天与 Mira 的对话记录（MemoryStore）
  //   写入发生在 miraAi.ask 结束（memory.add）后 → 经 aiRecordBus 广播即时刷新；
  //   另外每次回到首页（focus）再兜底拉一次，覆盖在别的页面聊天的情况。
  const [aiRecords, setAiRecords] = useState<{ text: string; ts: number }[]>([]);
  const loadAiRecords = useCallback(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    memoryStore
      .listSince(start.getTime())
      .then(setAiRecords)
      .catch(() => setAiRecords([]));
  }, []);
  useEffect(() => {
    loadAiRecords();
    return onAiRecord(loadAiRecords);
  }, [loadAiRecords]);
  useFocusEffect(useCallback(() => { loadAiRecords(); }, [loadAiRecords]));

  // ★ v18.140 心理压力数字的**真正定义在下方**（`stressValue`，esReport 声明之后）。
  //   ⚠⚠ 这里原来读的是 `computeStressReport().events.length`（旧算法的「压力事件次数」）——
  //   顶部 chip 标着「心理压力」但显示的是事件数（当年那个「19」就是它），
  //   与 v18.134~139 算的百分位**完全不是一回事**。
  // ⚠⚠ **不能在本行调 `computeEmotionalStress(..., sportSessions)`**：
  //   `sportSessions` 在本作用域**后面才声明**（TS2448/TS2454），
  //   必须复用下方已算好的 `esReport`，否则要么编译不过、要么算出两份不一致的数据。
  //   （这个坑与 v18.133 那次「诊断加在死代码里」同源：作用域顺序必须先确认。）
  // ★ 脑力准备度 = **当前剩余**（brainRemaining），随当天用脑实时下降（用户 2026-10-05 口径：「全天运脑，随着运脑会下降」）。
  //   与 v18.128 的「晨起固定值 brainReserve」不同：这里展示的是此刻还剩多少认知能量，
  //   早上接近储备、越用越低，更贴合「准备度」直觉，也与 Oura 的实时能量/准备度分拉开差异。
  //   科学依据不变（睡眠→次日认知 meta：Lowe 2017 g=−0.383、持续性注意 −0.409；Wüst 2024 一晚即损），
  //   只是把「一天一个数」改成「随昼夜能量线走」——储备仍由睡眠驱动，剩余是在储备上扣当天用脑。
  //   诚实边界：系数仍是经验值，**量纲未校准**（不能说 72 比 65「认知好 7%」）。后续用用户自报回归校准。
  const cognitive = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return '—';
      const r = computeCognitiveLoadReport();
      if (r?.brainRemaining != null) return String(r.brainRemaining);
      // ★ 2026-10-06 A+C（用户）：无昨夜睡眠时「剩余百分比」不存在，但「今日已用脑量」是
      //   白天实测 HRV↓/SNS↑ 累加的真实结果 → 显它而不是杠（tag 会切成「已用脑」）。
      if (r?.brainUsedToday != null) return String(r.brainUsedToday);
      return '—';
    } catch { return '—'; }
  })();
  const activity = (() => { try { const dk = dayKey(Date.now()); const s = ring?.stepDaily?.[dk]?.steps ?? 0; return s > 0 ? String(s) : '—'; } catch { return '—'; } })(); // 顶部 chip 备用：当日步数
  // 恢复 = 最近一晚睡眠评分 0-100（与「全天恢复」卡 AllDayRecoveryCard 同一取数口径）。
  // ★ v18.98（用户口径：对齐 Oura）：只认**昨晚**这一夜 ——
  //   今天的睡眠摘要，或昨天那条但起床时刻落在今早；再往前的旧归档一律不算（→ 显示「—」）。
  // ★ 2026-10-06（用户铁律：无今日睡眠即「—」，绝不挪用旧归档/昨日睡眠）：
  //   **只认今日睡眠**（dayKey(now)，按起床日归档）。删除原「昨日回退」——
  //   它会把任何历史晨间睡眠（含被错误归档到昨天的旧觉）当作今晚睡眠，
  //   正是圆环上方「睡眠恢复」冒出 59 等旧分数的根源。
  const recoverySleep = (() => {
    try {
      const t = healthStore.getSleep(dayKey(Date.now()));
      return (t && (t.total ?? 0) > 0) ? t : null;
    } catch { return null; }
  })();
  // ★ v18.98（用户口径：对齐 Oura，且明确「不要写『昨』」）：
  //   恢复分只认**昨晚**的睡眠。没有任何日期标注、也不写「昨」——
  //   拿不到昨晚睡眠就直接是「—」（见下方 recovery），而不是拿旧数据 + 一行溯源小字。
  const recoveryIsStale = false;
  // ★ v18.100 断流即空态（用户 2026-10-03 选定，覆盖 v18.97「没连戒指保留断开前值」）：
  //   戒指超过 3 小时没给 App 送采样（curveStatus.dataStale）时，页面上的恢复/脑力/情绪
  //   全是旧快照里的数，一律显示「—」，不许再挂一个数字让人当成实时。
  //   真机取证：00:29 之后一直到 12:22 都没有新采样，而首页还挂着恢复 96/脑力 39/圆环 62。
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;
  // ★ v18.144 改用「个人相对口径」（对比自己 14 天基线，Oura 同款）而非固定目标达标分。
  //   旧口径是绝对分（7.5h 满分 / 深睡 20% 满分），会出现「平时也睡 9h 却被轻扣」这类不合理。
  //   ⚠ dataStale 判定保持不变：断流时一律「—」，不许挂旧快照的数。
  // ★ B2（2026-10-08 交互优化）：包 memo（换天 / 数据版本变化才重算），此前每次渲染裸算
  const sleepPers = React.useMemo(() => {
    try { return computeSleepPersonalized(); } catch { return null; }
  }, [healthVer, dayKeyStr]);
  const recovery =
    dataStale || !recoverySleep || sleepPers?.score == null
      ? '—'
      : String(sleepPers.score);
  // 副标：把「口径」和「还差几天进入个人化」说清楚，否则口径切换会被当成分数忽高忽低。
  const recoverySub = (() => {
    if (sleepPers?.mode === 'absolute' && sleepPers.daysToReady > 0) {
      return `还需 ${sleepPers.daysToReady} 晚建立个人基线`;
    }
    return null;
  })();
  const recoverySubDur = (() => {
    const t = recoverySleep?.total;
    if (t == null || !Number.isFinite(t) || t <= 0) return '暂无';
    const h = Math.floor(t / 60), m = Math.round(t % 60);
    const dur = m > 0 ? `${h}h${m}m` : `${h}h`;
    return dur;
  })();

  // ★ 三张消耗卡的涨跌 = 真实数据，且**同口径比较**（今天「至今」 vs 昨天「同一时刻」）。
  //   为什么必须同口径：拿今天到 15:00 的累计值去比昨天的全天值，每天上午都会显示暴跌，
  //   那是另一种形式的假数字。拿不到可比数据时整块隐藏，绝不回落到占位/硬编码。
  //   方向用箭头、好坏用颜色（两重编码，色盲用户也能读）。
  const trendCmp = (() => {
    const nowD = new Date();
    const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
    const nowHour = nowD.getHours();
    const tMs = Date.now();
    const yMs = tMs - 86400000;

    // 情绪消耗：比较「到当前小时为止」的压力事件数
    const evUpTo = (ms: number): number | null => {
      try {
        const r = computeStressReport(ms);
        if (!r) return null;
        return (r.events ?? []).filter((e: any) => Number.isFinite(e.hour) && e.hour <= nowHour).length;
      } catch { return null; }
    };
    // 认知准备度：当前剩余 vs 昨日同时刻剩余（同一 ODE 能量线，直接可比）
    const cogAt = (ms: number): number | null => {
      try {
        return computeCognitiveLoadReport(ms)?.brainRemaining ?? null;
      } catch { return null; }
    };
    // 运动消耗：步数采样可能是「当日累计快照」也可能是「每段增量」——
    //   用昨天的全天总数当参照反推属于哪种（自校准），再取同一时刻的值。
    const stepsUpTo = (dk: string, dayTotal: number | null): number | null => {
      try {
        const pts = (healthStore.getIntraday('steps' as any, dk) ?? [])
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
        if (pts.length === 0) return null;
        const upToNow = pts.filter((p) => {
          const d = new Date(p.t);
          return d.getHours() * 60 + d.getMinutes() <= nowMin;
        });
        if (upToNow.length === 0) return null;
        const mx = Math.max(...pts.map((p) => p.v));
        const sum = pts.reduce((a, p) => a + p.v, 0);
        // 与全天总数更接近的那个模型，就是这套采样真实的语义
        const isCumulative = dayTotal == null ? true : Math.abs(mx - dayTotal) <= Math.abs(sum - dayTotal);
        return isCumulative ? upToNow[upToNow.length - 1].v : upToNow.reduce((a, p) => a + p.v, 0);
      } catch { return null; }
    };
    // 组装涨跌：|Δ|<3% 视为持平；昨天为 0/无数据 → 不给结论
    const cmp = (today: number | null, yest: number | null, upIsGood: boolean) => {
      if (today == null || yest == null || !Number.isFinite(today) || !Number.isFinite(yest) || yest <= 0) return null;
      const pct = ((today - yest) / yest) * 100;
      if (Math.abs(pct) < 3) return { dir: 'flat' as const, favorable: true, label: '持平' };
      const dir = pct > 0 ? ('up' as const) : ('down' as const);
      return { dir, favorable: dir === 'up' ? upIsGood : !upIsGood, label: `${pct > 0 ? '+' : ''}${Math.round(pct)}%` };
    };

    const dkT = dayKey(tMs);
    const dkY = dayKey(yMs);
    return {
      emotion: cmp(evUpTo(tMs), evUpTo(yMs), false),      // 情绪波动变多 = 不利
      cognitive: cmp(cogAt(tMs), cogAt(yMs), true),        // 准备度（剩余）更高 = 有利
      activity: cmp(
        stepsUpTo(dkT, ring?.stepDaily?.[dkT]?.steps ?? null),
        stepsUpTo(dkY, ring?.stepDaily?.[dkY]?.steps ?? null),
        true,                                             // 步数变多 = 有利
      ),
    };
  })();

  const stressReport = (() => { try { return computeStressReport(); } catch { return null; } })();
  const cogReport = (() => { try { return computeCognitiveLoadReport(); } catch { return null; } })();
  // ★ v18.69：认知图门槛加「戒指今日同步过」——lastSyncedAt 非今日 = 今天没连过戒指，
  //   不该出现任何「今日疲劳」图形（用户实锤：没戴戒指怎么还有认知疲劳度趋势图）
  const ringSyncedToday = (() => {
    const ls = ring?.lastSyncedAt as number | null | undefined;
    if (!ls) return false;
    const a = new Date(ls);
    const b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  })();
  // 认知柱状图只在「今日同步过 + 有真实 HRV 采样的时段」渲染（首页卡片无数据不放示意图）
  const cogHasData = ringSyncedToday && (cogReport?.hourly ?? []).some((h: any) => h.hasData);
  // ★ 认知准备度序列（与上面同一数据源 hourlyInstant，仅做「反向映射 + 节律塑形」）
  //   computeReadinessSeries 内部已按 nowMs 缓存报告的 key，这里直接算即可，无需 useMemo。
  const cogReadiness = cogReport ? computeReadinessSeries(cogReport) : null;
  // ★ 2026-10-13：脑力准备度（此刻剩余）与预测高峰小时 —— 喂给圆环下叙事的「上午」时段用，
  //   让 Mira 能讲「现在脑力挺好 + 高峰在几点 + 难活放这时」；数字全部真实、绝不编。
  const readinessNow = (() => { try { return cogReport?.brainRemaining ?? null; } catch { return null; } })();
  const readinessPeakHour = (() => { try { return (cogReport as any)?.forecast?.peak?.hour ?? null; } catch { return null; } })();
  // ★ 2026-10-06（用户："大卡片还是显示状态中等"）：大卡 value 用档位文字，标签判断必须和
  //   顶部 chip / 详情页同源（都用 brainRemaining），否则同一屏出现两个矛盾数字。
  //   cogReadyLabel 仅在没有 brainRemaining 时才用（此时它读能量线，是唯一可用口径）。  // ★ 2026-10-07(用户："不要状态中等，要么跟圆环一样显示数字，要么显示消耗%")
  // ★ 2026-10-07：首页大卡显示**今日脑力消耗%**（能量线从晨起到睡前的掉幅）
  //   圆环仍然显示当前剩余准备度（两者口径不同，不矛盾）
  const cogConsumptionPct = (() => {
    if (!cogReport) return null;
    const half = (cogReport as any).energyHalfHourly as { slot: number; value: number }[] | undefined;
    if (!half || half.length === 0) return null;
    const sleep = cogReport.sleepWindow ?? null;
    const wakeHour = sleep?.wakeHour ?? 7;
    const wakeSlot = Math.max(0, Math.floor(wakeHour * 2));
    // morning: 起床后 1h 内 3 槽均值
    const mSlots = half.filter((p) => p.slot >= wakeSlot && p.slot <= wakeSlot + 2);
    const morning = mSlots.length ? mSlots.reduce((a, b) => a + b.value, 0) / mSlots.length : null;
    // evening: 睡前槽 或 槽 46(23:00)
    const bedHour = sleep?.bedHour ?? null;
    const targetSlot = (bedHour != null && Number.isFinite(bedHour))
      ? Math.max(0, Math.min(47, Math.floor(bedHour * 2) - 1))
      : 46;
    const eSlot = half.find((p) => p.slot === targetSlot) ?? half.find((p) => p.slot === 46);
    const evening = eSlot?.value ?? null;
    if (morning != null && evening != null && morning > 0) {
      return Math.max(0, Math.round(((morning - evening) / morning) * 100));
    }
    // fallback: peak→trough
    const awake = half.filter((p) => {
      if (!sleep) return true;
      const bedS = Math.floor((sleep.bedHour ?? 22) * 2);
      const wakeS = Math.floor((sleep.wakeHour ?? 7) * 2);
      return !(p.slot >= bedS || p.slot <= wakeS);
    });
    if (awake.length >= 2) {
      const peak = awake.reduce((a, b) => (b.value > a.value ? b : a)).value;
      const trough = awake.reduce((a, b) => (b.value < a.value ? b : a)).value;
      if (peak > trough && peak > 0) return Math.round(((peak - trough) / peak) * 100);
    }
    return null;
  })();
  const cogCardValue = cogConsumptionPct != null ? String(cogConsumptionPct) : '—';
  const cogCardSub = cogConsumptionPct != null ? '今日脑力消耗' : '暂无数据';
  // 近 7 天步数
  const weekSteps = (() => {
    const out: { dayKey: string; steps: number; date: Date }[] = [];
    const now = new Date();
    for(let i=6;i>=0;i--){
      const d=new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
      const dk=dayKey(d.getTime());
      const s = ring?.stepDaily?.[dk]?.steps ?? 0;
      out.push({ dayKey:dk, steps:s, date:d });
    }
    return out;
  })();


  // ★ 节流订阅：BLE 状态推送（回填期约 ≥500ms 一次）会带动整屏重渲染，而本屏 render 里还要跑
  //   computeStressReport/computeCognitiveLoadReport/皮质醇分析。用 rAF 把同一帧内的多次推送合并成
  //   一次 setRing，避免叠加重渲染造成「点击/切 tab 卡顿」。（与 InsightScreen 同款写法）
  useEffect(() => {
    let pending: ReturnType<typeof RingBle.getState> | null = null;
    let scheduled = false;
    const throttled = (s: ReturnType<typeof RingBle.getState>) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRing(pending);
        });
      }
    };
    return RingBle.onState(throttled);
  }, []);
  const cardWidth =
    Math.min(width, theme.layout.maxWidth) - theme.space.screen * 2 - theme.space.cardPad * 2;
  // ★ V1（2026-10-15 用户定稿）：全宽白面板 + 底部圆弧整体移除——
  //   圆环直承浅灰页面底色，白只剩 chips / 气泡两层；原 panelW / panelArcH /
  //   panelUnderH / panelArcR / panelArcD / ARC_FEATHER 随之删除（无白面需要过渡）。

  // 圆环下方分析胶囊：状态胶囊（跟随心情色）+ 相位标签（软底彩字）+ 建议（描述文字），统一走 design token
  const status = ring.curveStatus;
  const statusIdx = status && status.value != null ? curveLevel(status.value, CURVE_DEFAULTS).index : null;
  const phase = status?.phaseLabel ?? '未记录';
  const phaseKnown = phase !== '未记录';
  // ★ 2026-10-16（用户：「图例两行有点多，能不能就展示一行，只展示当下的这个处于，
  //   比方说处于卵泡期只展示这个卵泡期，其他的不展示」）：圆环下方经期图例
  //   由「四相全量（两行）」改为「只留当前相位（一行）」。
  //   phaseLabel 是中文标签 → 这里映射到 PhaseKey；未记录 → null（PhaseLegend 整条隐藏）。
  const PHASE_LABEL_TO_KEY: Record<string, PhaseKey> = {
    经期: 'period', 卵泡期: 'follicular', 排卵期: 'ovulation', 黄体期: 'luteal',
  };
  const currentPhaseKey: PhaseKey | null =
    status?.phaseLabel != null ? PHASE_LABEL_TO_KEY[status.phaseLabel] ?? null : null;
  // ★ 真实睡眠检测：用最近一次 healthStore 中记录的睡眠窗口（sleepTime / wakeTime HH:mm）
  //   healthStore 里存的是「今天结束的那次睡眠」，跨午夜睡眠（23:30 → 07:00）正常工作。
  const todaySleep = healthStore.getSleep(dayKey(Date.now()));
  const { isAsleep, isNap } = (() => {
    const sl = todaySleep;
    if (!sl?.sleepTime || !sl?.wakeTime) return { isAsleep: false, isNap: false };
    const toMs = (hhmm: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
      if (!m) return null;
      const d = new Date();
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return d.getTime();
    };
    const s = toMs(sl.sleepTime);
    const w = toMs(sl.wakeTime);
    if (s == null || w == null || s === w) return { isAsleep: false, isNap: false };
    const now = Date.now();
    const inWindow = s < w ? now >= s && now <= w : now >= s || now <= w;
    const h = new Date().getHours();
    return { isAsleep: inWindow && (h >= 22 || h < 7), isNap: inWindow && h >= 8 && h < 22 };
  })();

  const fallbackAdvice = buildSmartAdvice(phase, statusIdx, isNap);

  // ★ v18.37 场景建议引擎：圈内 = 短建议词（≤6 字），胶囊 = 具体解释（≤2 行）。
  //   优先级：睡眠窗口 > 睡前1h(个人入睡习惯-60min) > 情绪尖峰 > 晨间满电
  //           > 饭前低今日状态 > 久坐 > 午后低谷 > 傍晚收工；无场景 → 常规相位句。
  //   频控：每词每日 ≤3 次（多数 ≤1）+ 最短冷却，持久化跨重启（lib/todayScene）。
  // ★ 二十改：近 1 小时压力事件数提前到场景引擎外计算 —— 场景引擎与叙事 AI 层共用同一事实
  const stressRecent1h = (stressReport?.events ?? []).filter(
    (e: any) => Number.isFinite(e.t) && e.t >= Date.now() - 3600e3,
  ).length;
  const scene: TodayScene | null = (() => {
    try {
      const nowMs = Date.now();
      const stepsPts = healthStore.getTimeRange('steps' as any, nowMs - 2 * 3600e3, nowMs, { maxPoints: 60 });
      const stepsLast2h = stepsPts.length >= 2 ? Math.max(0, stepsPts[stepsPts.length - 1].v - stepsPts[0].v) : 0;
      const spo2Pts = healthStore.getTimeRange('spo2' as any, nowMs - 3 * 3600e3, nowMs, { maxPoints: 20 });
      const spo2Latest = spo2Pts.length > 0 ? spo2Pts[spo2Pts.length - 1].v : null;
      return evaluateTodayScene({
        now: nowMs,
        isAsleep,
        statusValue: status?.value ?? null,
        sleepScore: recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null,
        wakeTimeStr: recoverySleep?.wakeTime ?? null,
        stressRecent1h,
        stepsLast2h,
        spo2Latest,
      });
    } catch { return null; }
  })();

  // 频控计数：同一次持续触发只记一次（key 变化再重新计），跨重启由文件持久化
  const markedSceneRef = useRef<string | null>(null);
  useEffect(() => { initTodaySceneCounter(); }, []);
  useEffect(() => {
    if (scene?.key && markedSceneRef.current !== scene.key) {
      markedSceneRef.current = scene.key;
      markSceneShown(scene.key);
    }
  }, [scene?.key]);

  const advice = isAsleep
    ? (phase === '经期' ? '经期睡眠中，安心休息助修复' : phase === '黄体期' ? '黄体期睡眠中，深睡稳情绪' : '睡眠恢复中，安心休息')
    : fallbackAdvice;
  const showPill = statusIdx != null || phaseKnown;
  // ★ 无场景触发时：胶囊 = 多因分析段（相位→雌/孕激素→皮质醇→睡眠，挂钩周期激素数据但不跳转）
  // ★ B1（2026-10-08 交互优化）：皮质醇 14 天 cosinor 拟合提到 memo —— 原来在 causeNarrative
  //   渲染路径里每次重跑 collectSamples+analyzeCortisol（无内部缓存，BLE 回填期 ~500ms 渲染一次）。
  //   按「日期 + healthStore 版本」重算，与 cognitiveLoad 的缓存 key 同款思路。
  const cortisolSummary = React.useMemo(() => {
    try {
      const samples = collectSamples();
      const cr = analyzeCortisol(samples, 14);
      if (cr && Number.isFinite(cr.cosinor?.acrophaseH)) {
        const peak = `${String(Math.round(cr.cosinor.acrophaseH)).padStart(2, '0')}:00`;
        let rhythm = '一般';
        if (cr.css > 10) rhythm = '良好';
        else if (cr.css < -10) rhythm = '偏晚';
        else if (Number.isFinite(cr.cosinor.amplitude) && Number.isFinite(cr.cosinor.mesor) && cr.cosinor.amplitude < 0.15 * cr.cosinor.mesor) rhythm = '扁平';
        return { peak, rhythm };
      }
      return null;
    } catch { return null; }
  }, [healthVer, dayKeyStr]);
  const causeNarrative = (() => {
    try {
      // 皮质醇晨峰/节律（14 天 cosinor，与洞察页同一套拟合）
      // ★ B1：数值取上方 cortisolSummary（memo 化），本 IIFE 不再重复拟合。
      return buildCauseNarrative({
        phaseLabel: phase,
        dayInCycle: status?.dayInCycle ?? null,
        estrogenIndex: status?.estrogenIndex ?? null,
        cortisolPeak: cortisolSummary?.peak ?? '—',
        cortisolRhythm: cortisolSummary?.rhythm ?? '—',
        sleepScore: recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null,
        // ★ 十九改：把圆环当前档位（充沛/平稳/偏低/不足）传给分析 —— 文案与圆环状态自洽
        level: status?.level ?? null,
      });
    } catch { return ''; }
  })();
  // ── ★ 二十改：圆环下叙事改为「AI 为主 + 模板兜底」（与建议卡同一套混合架构）──
  //   事实输入：状态档+分值、周期相位、皮质醇晨峰/节律、昨晚睡眠分、近 1h 压力事件、
  //   最近 3h 做完的动作（呼吸冥想/缓一缓…，由播放器完成时记录）。
  //   模板（scene.explain / causeNarrative）秒出先显示；AI 到货（≤30s）校验签名没变再无声替换。
  const narrSleepScore = recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null;
  const narrSig = narrSigOf({
    level: status?.level ?? null,
    value: status?.value ?? null,
    phase,
    cortisolPeak: cortisolSummary?.peak ?? '—',
    cortisolRhythm: cortisolSummary?.rhythm ?? '—',
    sleepScore: narrSleepScore,
    stressRecent1h,
    recentAction: null, // 模块内部取（需要 await 读干预日志），不进签名 —— 由状态分变化间接覆盖
    timePhase: dayPhase(),
    readinessNow,
    readinessPeakHour,
  });
  const [aiNarr, setAiNarr] = useState<string | null>(null);
  const narrSeqRef = useRef(0);
  useEffect(() => {
    if (dataStale) {
      setAiNarr(null);
      return;
    }
    const cached = aiNarrativeFor(narrSig);
    if (cached) {
      setAiNarr(cached); // 同签名重启/回页面：缓存秒出
      return;
    }
    setAiNarr(null); // AI 未到 → 模板先在位（永不空）
    const seq = ++narrSeqRef.current;
    requestAiNarrative({
      level: status?.level ?? null,
      value: status?.value ?? null,
      phase,
      cortisolPeak: cortisolSummary?.peak ?? '—',
      cortisolRhythm: cortisolSummary?.rhythm ?? '—',
      sleepScore: narrSleepScore,
      stressRecent1h,
      recentAction: null,
      timePhase: dayPhase(),
      readinessNow,
      readinessPeakHour,
    })
      .then((t) => {
        if (seq === narrSeqRef.current && t) setAiNarr(t); // 签名已翻档的旧结果直接丢弃
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrSig, dataStale]);

  // ★ v18.109 断流即空态：戒指超过 3 小时没回传采样（dataStale）时，圆环下方不写任何相位/多因分析
  //   （旧实现会继续输出「孕激素升高，能量天生易偏低」这类周期文案，看着像今天有数据其实是推算的），
  //   统一写「暂无数据，请佩戴戒指。约半小时会更新最新数据。」，与 curveStatus.narrative 同口径。
  //   ★ 二十改：显示优先级 = AI 叙事 > 场景解释 > 多因分析模板 > 兜底建议。
  const narrative = dataStale
    ? '暂无数据，请佩戴戒指。约半小时会更新最新数据。'
    : aiNarr ?? (scene
      ? scene.explain
      : causeNarrative || (showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析'));

  // ★ 今日日历：把「真实生理数据」+「与 Mira 的对话记录」按一天的时间顺序编排（约 6~7 条）
  const fmtMin = (min: number | null | undefined): string => {
    if (min == null || !Number.isFinite(min) || min <= 0) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ''}` : `${m}分钟`;
  };
  // timelineItems 构建已迁到 src/lib/buildTodayTimeline.ts
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const nowDate = new Date();
  const curMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const dkToday = dayKey(Date.now());
  const stepsToday = ring?.stepDaily?.[dkToday]?.steps ?? 0;
  let peakEvent: any = null;
  try {
    const evs = computeStressReport()?.events ?? [];
    peakEvent = evs.length > 0 ? evs.reduce((a, b) => (b.severity > a.severity ? b : a)) : null;
  } catch { /* ignore */ }

  // 三张消耗卡的副标题：一律由真实数据推导，不写死「峰值集中在傍晚」「19 kcal」这类未发生或编造的结论
  const stressSub = peakEvent ? `峰值 ${pad2(peakEvent.hour)}:${pad2(peakEvent.minute)}` : '暂无压力事件';
  // ★ v18.127：档位改用**瞬时**疲劳度均值（与柱状图同源，v18.125 前用的是累积量 avgFatigue）
  const cogLevelTxt = cogLevelLabel(cogReport?.avgFatigueInstant);
  // 峰值时刻取「已观测小时柱」最高点（与卡片柱状图完全同源）；未观测到就只给档位，不写未来时刻
  const cogPeakBar = (() => {
    const bars = (cogReport?.hourlyInstant ?? []).filter(h => h.hasData && h.hour * 60 <= curMin);
    return bars.length > 0 ? bars.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  })();
  const cognitiveSub = cogPeakBar
    ? `疲劳最高 ${pad2(cogPeakBar.hour)}:00`
    : `${cogLevelTxt}疲劳`;
  // ★ 2026-10-06（用户口径）：峰谷行**不再依赖 cogHasData**——节律预测（皮质醇昼夜模型）即使没有昨晚睡眠也能推算，
  //   故「脑力峰值 / 脑力低谷」两行始终展示（无值显「—」），让卡片在断流/无睡眠时也是完整的「分 + 峰 + 谷」三行。
  const cogPeakTroughLines = (() => {
    const f: any = (cogReport as any)?.forecast;
    const seg = (h: number) => `${pad2(h)}–${pad2((h + 1) % 24)}时`;
    // 真实峰谷：只取「已完全过去」的实测小时（h+1 点 ≤ 当前分钟），且至少 2 个实测小时才有峰谷意义
    // ★ v18.127：峰谷也改用**瞬时**序列（与柱状图/chip 同源）
    // ★ 2026-10-05 改「准备度」后峰谷方向反转：准备度 **峰 = 分数最高（状态最好）**、
    //   谷 = 分数最低。旧疲劳口径是「峰 = 分数最低」，直接沿用会把最好/最差说反。
    const passed = (cogReport?.hourlyInstant ?? []).filter((h) => h.hasData && (h.hour + 1) * 60 <= curMin);
    const realPeak = passed.length >= 2 ? passed.reduce((a, b) => (b.score <= a.score ? b : a)) : null;
    const realTrough = passed.length >= 2 ? passed.reduce((a, b) => (b.score >= a.score ? b : a)) : null;
    // 预测窗已完全过去 → 改用该端实测峰谷（同语义）；否则用节律预测值（无需睡眠即可得）
    const peakHour = f?.peak?.hour != null
      ? ((f.peak.hour + 1) * 60 <= curMin ? realPeak?.hour ?? f.peak.hour : f.peak.hour)
      : null;
    const troughHour = f?.trough?.hour != null
      ? ((f.trough.hour + 1) * 60 <= curMin ? realTrough?.hour ?? f.trough.hour : f.trough.hour)
      : null;
    // ★ 2026-10-06（用户问"无睡眠时峰谷还要不要展示"）：**要展示**。
    //   预测来自 `forecast`（皮质醇昼夜模型 + 昼夜相位），**不依赖睡眠归档**；
    //   预测窗已过去的端点改用当天实测峰谷（≥2 个实测小时才有意义，否则留预测值）。
    //   副标注「预测/实测」让用户知道这行的来源，不把预测当成实测。
    const peakIsReal = f?.peak?.hour != null && (f.peak.hour + 1) * 60 <= curMin && realPeak != null;
    const troughIsReal = f?.trough?.hour != null && (f.trough.hour + 1) * 60 <= curMin && realTrough != null;
    return [
      peakHour != null ? `脑力峰值 ${seg(peakHour)}${peakIsReal ? ' 实测' : ' 预测'}` : '脑力峰值 —',
      troughHour != null ? `脑力低谷 ${seg(troughHour)}${troughIsReal ? ' 实测' : ' 预测'}` : '脑力低谷 —',
    ];
  })();
  const stepKcalToday = (() => { try { return ring?.stepDaily?.[dkToday]?.calorie ?? 0; } catch { return 0; } })();
  const stepDistToday = (() => { try { return ring?.stepDaily?.[dkToday]?.distance ?? 0; } catch { return 0; } })();
  // 运动卡数据口径：卡路里为主数字（kcal），脚注行=步数(stepsToday 复用上方声明)+距离；今日有任何步数即视为有数据
  const activityHasData = (stepsToday > 0) || weekSteps.some((w) => w.steps > 0);
  // 戒指固件已按类型分类的运动段（多运动识别）：把识别出的运动类型与各自消耗塞进「运动消耗」卡
  const sportSessions: RingSportSession[] | null = ring?.sportSessions ?? null;
  const hasSportSessions = !!sportSessions && sportSessions.length > 0;
  const sportKcalTotal = hasSportSessions
    ? sportSessions.reduce((acc, s) => acc + (s.totalCal || 0), 0)
    : 0;
  // 原生只映射固件枚举前 53 项，超出会回「未知(N)」→ 按 type 用全量表还原（VEEPOO_SPORT_NAMES 0–188）
  const sportNames = hasSportSessions
    ? sportSessions.map((s) => resolveSportName(s.type, s.typeName)).filter(Boolean).join(' · ')
    : '';
  // ★ v18.88 首页运动卡副行：首段类型名按运动类别上色（嵌套 Text），段数走右上角 aside，
  //   整行刻意压短（「跑步 等 3 段」）——130pt 高的窄卡里超一行就会被 numberOfLines:1 吃成省略号。
  const sportFirst = hasSportSessions ? resolveSportName(sportSessions?.[0]?.type, sportSessions?.[0]?.typeName) : '';
  const sportFirstColor = hasSportSessions ? sportVisualOf(sportSessions?.[0]?.type).color : '';
  const sportCount = hasSportSessions ? (sportSessions?.length ?? 0) : 0;
  // 右上角 aside 放总时长的短写法（≥1h 用 1:36 时钟式，否则用「96 分钟」）——
  // 段数放副行，时长放 aside，两边不重复同一句话
  const sportTotalSec = hasSportSessions
    ? sportSessions.reduce((a, s) => a + (s.totalTime || 0), 0)
    : 0;
  const sportTotalMin = Math.round(sportTotalSec / 60);
  const sportAside = hasSportSessions
    ? (sportTotalMin >= 60
      ? `${Math.floor(sportTotalMin / 60)}:${String(sportTotalMin % 60).padStart(2, '0')}`
      : `${sportTotalMin} 分钟`)
    : undefined;

  // ★ chips 数据标签（数值下方一行小字）：全部由当天真实数据推导档位，无数据不给词
  // ★ v18.144：档位阈值随口径切换。
  //   ⚠ 这是必须的，不是可选：绝对口径下「80 = 睡够 7.5h+」，
  //   相对口径下「50 = 和你平时一样」⇒ 两套口径共用 80/60 阈值会得到相反的结论。
  //   （这正是 MEMORY 里「同一指标两界面口径不同 ⇒ 自相矛盾」的同类问题。）
  const recTag = (() => {
    if (recovery == null || recovery === '—') return undefined;
    const s = Number(recovery);
    if (!Number.isFinite(s)) return undefined;
    // ★ v18.156：档位词收成唯一实现（`sleepRecoveryTag`），与「睡眠节律」卡 badge 同源。
    //   此前 chip（58/42「高于平时」）与卡片（62/45「恢复较好」）各写一套，
    //   同一个 61 在首页出现两种说法 —— 用户 2026-10-05 的困惑点正是这个。
    return sleepRecoveryTag(s, sleepPers?.mode === 'relative' ? 'relative' : 'absolute');
  })();
  // ★ v18.128：档位按**晨起准备度剩余**判（与 chip 数值同一口径、同一个字段 brainReserve）。
  //   数值方向 = 准备度（高 = 更好），所以 ≥70 准备度高 / 40~70 准备度中 / <40 准备度低。
  //   阈值沿用 COG_LEVEL_HIGH/LOW（70/40），与 WHOOP 67 / Oura 70 的通行区间对齐。
  //   历史坑（v18.125）：曾用 `brainUsed`（已消耗）判档而数值读 `brainRemaining`（剩余），
  //   两者方向相反 → 「值 82 · 标签 高消耗」自相矛盾。**标签与数值必须取同一字段。**
  const cogTag = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return undefined;
      const rep = computeCognitiveLoadReport();
      // ★ 2026-10-06（用户指正："圆环上面写 59，但显示准备度高，这肯定不对"）：
      //   根因 —— chip 的**值**读 `brainRemaining`（此刻剩余），而**标签**读 `brainReserve`（晨起起点）。
      //   两者不是同一个量：晨起 80、此刻用到 59 是完全正常的，但拿 80 去判档就出现「59 · 准备度高」。
      //   ★ 铁律：**标签与数值必须取同一字段**（同源），否则用户永远会认为算错。
      //   现在统一按「此刻剩余」判档。
      const remain = rep?.brainRemaining;
      if (remain == null || !Number.isFinite(remain)) {
        // 无昨夜睡眠 → 顶部显「已用脑量」，tag 相应改成消耗口径
        const used = rep?.brainUsedToday;
        if (used != null && Number.isFinite(used)) {
          return used >= 40 ? '已用脑 · 偏多' : '已用脑 · 正常';
        }
        return undefined;
      }
      return remain >= COG_LEVEL_HIGH ? '准备度高' : remain >= COG_LEVEL_LOW ? '准备度中' : '准备度低';
    } catch { return undefined; }
  })();
  // ★ v18.132：情绪压力（多信号融合）在 TodayScreen 侧再取一次，供 chip 小字用。
  //   （与 EnergyRowData 里的 esReport 属不同组件作用域，各自算；healthStore 有内部缓存，代价小）
  // ★ v18.133：同 EnergyRowData，必须传 sportSessions，否则两处算出来的 moving 槽数会不一致
  //   （chip 说「平稳」、下面卡片说有运动 ⇒ 用户看到的图就自相矛盾）。
  // ★ B2（2026-10-08 交互优化）：computeEmotionalStress 无内部缓存，此前每次渲染重跑
  //   （BLE 推送经 rAF 节流后仍 ~500ms 一次）；现在仅 sportSessions / 数据版本 / 30s 窗口变化才重算。
  const esReport = React.useMemo(() => {
    try { return computeEmotionalStress(Date.now(), sportSessions); } catch { return null; }
  }, [sportSessions, healthVer, dayKeyStr, esWindow]);
  // ★ v18.141 心理压力 0-100 —— **显示，不再被校准闸门挡住**。
  //   ⚠⚠ v18.140 我加的 `stressScoreVisible` 闸门把数字全挡成「—」，
  //   但那时候**生理分其实算得出来**（41/42 槽、全天 55 分）。
  //   ⇒ 这是我拿「还没验证准不准」当「不给看」的理由，**过度保守**：
  //   用户要的是「今天压力多少」，一个标着「未校准」的 55 分比空白有用得多
  //   —— 前者还能用来观察趋势，后者什么都看不到。
  //   现在口径：数字**照出**，但副标必须写明未校准（`stressNote`），
  //   且 `calibration.level === 'invalid'`（r<0.2，证明这套数据对你没用）时才真正不给数。
  // ★ v18.142 诊断已取证（moving 18→4，MET 均值口径误判），按纪律移除。
  //   需要复查时重新加，打 `[PS-DEBUG] value/dataSlots/moving/byReason/calLevel`。
  // ★ v18.143 诊断已取证（加权后 value=51 / moving=4 / wSum=0.414），按纪律移除。
  //   需复查时重加，打 `[RB-DEBUG] value/dataSlots/moving/baseDays/drift/avgUsed/wSum`。
  // ★ v18.144 诊断已取证（relative/47/reg=96/midSd=13.9），按纪律移除。
  //   需复查时重加，打 `[SLEEP-P] score/mode/baseDays/daysToReady/reg/midSd/wakeSd/bedSd/regDays`。
  const stressValue = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return '—';
      if (!esReport || !esReport.stressScale) return '—';
      if (esReport.baselineDays < ES_MIN_BASELINE_DAYS) return '—';
      // 只在「已证明无效」时不给数（r < 0.2）；样本不足（insufficient）照给，只是标未校准
      if (esReport.calibration?.level === 'invalid') return '—';
      return String(esReport.stressScale.value);
    } catch { return '—'; }
  })();
  // ★ v18.133 运动门控诊断：**已取证完毕（fw=NO / 戒指未连上），按「排查 log 同轮清掉」纪律移除。**
  //   需要复查时把下面这段 uncomment 即可（依赖已就绪，字段都在）：
  //   ⚠ 位置说明：这段必须在**真正渲染的组件作用域**里。同文件的 `EnergyRowData` 看着像，
  //     但它**从未被任何地方使用**（`grep EnergyRowData` 只有定义处命中）——往那里加日志永远不打印。
  //   useEffect(() => {
  //     const d = esReport?.motionDiag; if (!d) return;
  //     console.log(`[MOTION-GATE] fw=${d.hasFirmwareSessions?'YES':'NO'} gate=[${d.gateSummary}] ` +
  //       `layers=${JSON.stringify(d.byReason)} moving=${esReport.movingSlots}/${esReport.dataSlots} ` +
  //       `stress=${esReport.stressSlots} peak=${esReport.peakLevel??'-'} sev=${esReport.meanSeverity??'-'} ` +
  //       `driftZ=${d.driftZ??'-'} edaScale=${d.edaScalePool??'-'} baseDays=${esReport.baselineDays}`);
  //   }, [esReport?.dataSlots, esReport?.movingSlots, esReport?.stressSlots, esReport?.meanSeverity, esReport?.deviceDrift, sportSessions?.length]);
  // ★ v18.134 6 特征融合诊断：**已取证（avgUsed=0 的根因是今日 EDA 真实漂移 2.65×，
  //   deviceDrift 正确拦下全部 40 槽），按「排查 log 同轮清掉」纪律移除。**
  //   需要复查时 uncomment 下面这段（字段都在 esReport.featureDetail）。
  //   ⚠ 位置：必须在真正渲染的组件作用域（EnergyRowData 是死代码，别放那儿）。
  // useEffect(() => {
  //   if (!esReport) return;
  //   const fd = esReport.featureDetail;
  //   console.log(`[FEAT-6] avgUsed=${fd.avgUsedCount} moving=${esReport.movingSlots}/${esReport.dataSlots} ` +
  //     `stress=${esReport.stressSlots} peak=${esReport.peakLevel ?? '-'} sev=${esReport.meanSeverity ?? '-'} ` +
  //     `drift=${esReport.deviceDrift} driftZ=${esReport.motionDiag.driftZ} baseDays=${esReport.baselineDays}`);
  // }, [esReport?.dataSlots, esReport?.stressSlots, esReport?.meanSeverity]);
  // ★ v18.137：chip 小字用 `stressScale.bandLabel`（「压力中/压力低/压力高」）。
  // ★ v18.141 修正：**档位不再被校准状态吃掉**。
  //   旧逻辑：`calibration.level === 'insufficient'` 直接 return「记录情绪可校准」，
  //   **排在档位判断之前** ⇒ 用户只看到引导文案，看不到「压力中」这个有效结论。
  //   为什么改：档位是**有数据的结论**（41/42 槽算得出、全天 55 分），
  //   校准只影响「这个数字可不可信」，不该把结论一起藏掉。
  //   ⇒ 改为：档位照常显示，**校准不足时在副标追加一句提示**。
  const emoTag = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return undefined;
      if (!esReport) return undefined;
      if (esReport.baselineDays < ES_MIN_BASELINE_DAYS) return '建立基线中';
      const ss = esReport.stressScale;
      if (!ss) return undefined;
      if (ss.confidence === 'low') return '信号较少';
      return ss.bandLabel;
    } catch { return undefined; }
  })();
  // ★ v18.141：校准不足时的**副标提示**（不占档位名，只在卡片小字出现）。
  //   empty = 不显示（已校准通过时）。
  const stressNote = (() => {
    try {
      const cal = esReport?.calibration;
      if (!cal) return undefined;
      if (cal.level === 'insufficient') {
        return cal.stressReports === 0
          ? '记录情绪可校准'
          : `压力时记录 ${cal.stressReports}/3`;
      }
      if (cal.level === 'weak') return `准确度 ${cal.r?.toFixed(2) ?? '—'}·仅参考`;
      if (cal.level === 'invalid') return '身体数据分不出压力大小';
      return undefined;
    } catch { return undefined; }
  })();
  // ★ v18.153：`actTag`（活动偏少 / 轻度活动 / 活力充足）随「运动消耗」chip 一并移除 ——
  //   它的唯一消费方就是那颗 chip；第二屏的「运动消耗」Bento 卡用的是 stepsToday / sportKcalTotal，
  //   与此 IIFE 无关，不受影响。

  /**
   * ★ 顶部指标 chips（MindMate v10 Reskin）：白卡 chip = pastel 方块 icon + 灰标签 + 数值。
   * 数据与消耗卡**同源同口径**：恢复=睡眠评分、脑力=准备度（脑力账户剩余）、情绪=事件数、经期=当前相位。
   * 无数据显式传 '—'，不编数字。
   * ★ 2026-10-07（用户：「在心理压力旁边加一个运动的小卡片展示卡路里…它是可以左右滑动的」）：
   *   按用户要求加回「运动」chip（置于「心理压力」右侧），主数字 = 当日卡路里 kcal，
   *   与第二屏「运动消耗」Bento 卡**同源同口径**（固件识别运动段 totalCal 优先，
   *   否则当日计步 calorie）。因条目变成 5 张 > 每屏 4 张，
   *   MindChips 自动切为**横向滚动**，第 5 张可滑出。
   */
  // 经期卡：月相图标与圆环四个象限点同一套（经期=满月/卵泡=上弦/黄体=全紫/排卵=下弦）
  const PHASE_MOON: Record<string, 'full' | 'quarterR' | 'allPurple' | 'quarterL'> = {
    经期: 'full', 卵泡期: 'quarterR', 黄体期: 'allPurple', 排卵期: 'quarterL',
  };
  const phaseMoon = status?.phaseLabel != null ? PHASE_MOON[status.phaseLabel] : undefined;

  // ★ v18.107 撤回 staleSleepTip：用户明确反对「戒指已 N 小时没有新数据 · 数据截至 HH:MM」这类
  //   时效小字（口径还会和真实采样时刻 00:29 打架，看着像没用的东西）。
  //   断流就画空图表（中间一行「暂无数据」）+ 圆环下方分析写「暂无数据，请佩戴戒指。约半小时会更新最新数据。」

  // 运动 chip（v18.153 移除后于 2026-10-07 按用户要求加回）：主数字 = 卡路里 kcal，
  // 与第二屏「运动消耗」Bento 卡同源（hasSportSessions / stepKcalToday 均为上方已声明）。
  const actKcal = hasSportSessions
    ? Math.round(sportKcalTotal)
    : (activityHasData ? Math.round(stepKcalToday) : null);
  const actChipValue = actKcal != null && actKcal > 0 ? String(actKcal) : '—';
  // ★ 2026-10-07（用户：首页圆环上面的高中低不用展示）：原 CHIP_LEVEL_WORD / chipLevelWord（动态档位语缩写）
  //   已整块移除 —— 睡眠恢复 / 脑力消耗 / 心理压力 三张 chip 不再渲染档位语，只保留数字与配色。
  //   ★ 同日补充：运动消耗 chip 的「低/中/高」档位语也一并去掉（用户：「运动消耗就不显示低了」），
  //   actTag 变量随之删除；阈值与数据口径不变。日后要恢复从 git 历史取回。

  /**
   * ★ 2026-10-07（用户：圆环上方「睡眠恢复/脑力消耗」这些数字按好坏上色）：
   *   统一口径 —— 好 = 绿、差 = 粉、适中 = 默认墨色；运动/经期不上色。
   *   这里直接用各 chip 自己已算出的档位词判方向（脑力 chip 数值 = 剩余准备度，高即好；
   *   「已用脑 · 偏多」虽归为「高」但语义是差，故单独列表）。不改任何阈值与取数。
   */
  const CHIP_VALUE_TONE: Record<string, 'good' | 'mid' | 'bad'> = {
    // 睡眠恢复（sleepRecoveryTag 全部输出）—— 高/恢复好 = 绿，低/偏弱 = 粉
    高于平时: 'good', 恢复良好: 'good',
    与平时持平: 'mid', 恢复中: 'mid',
    低于平时: 'bad', 恢复偏弱: 'bad',
    // 脑力：数值 = 此刻剩余准备度，高 = 好
    准备度高: 'good',
    准备度中: 'mid', '已用脑 · 正常': 'mid',
    准备度低: 'bad', '已用脑 · 偏多': 'bad',
    // 心理压力：高压 = 差（方向与上面相反）
    偏低: 'good', 压力低: 'good',
    适中: 'mid', 压力中: 'mid',
    偏高: 'bad', 压力高: 'bad',
  };
  const chipValueTone = (t?: string): 'good' | 'mid' | 'bad' | undefined =>
    t != null ? CHIP_VALUE_TONE[t] : undefined;

  // ★ 2026-10-17（用户：「身心压力 = 洞察页面基础指标的压力指标，不是心理压力那个」）：
  //   身心压力 直接取洞察页「基础指标」tab 里那张「压力」卡的同源数值 —— 设备 SDK 压力信号经
  //   stressAlgorithm 算出的当前压力分（0–100，越高越紧张）。
  //   ★ 2026-10-26 修复：此前误用 ring.metrics['stress']，但 RingBle 的 metrics 只填 hr/hrv、daily 不含
  //     stress，该字段恒为 null → 身心压力卡一直「— / 暂无数据」；改用 computeStressReport().score
  //     （与 MetricDetail「压力」卡、首页 CalmWaveHome 同源）。
  //   它 ≠ StressInsightCard 的 emotionalLoad（那个是派生总消耗），也 ≠ 「心理压力」chip 的
  //   emotionalStress 百分位（50=和平时差不多）。三者是三个不同口径，这里严格对齐基础指标压力卡。
  const bodyLoad = (() => { try { const r = computeStressReport(Date.now()); return r?.score ?? null; } catch { return null; } })();
  const loadValue = bodyLoad != null ? String(bodyLoad) : '—';
  const loadTone: 'good' | 'mid' | 'bad' | undefined =
    bodyLoad == null ? undefined
    : bodyLoad < 30 ? 'good'   // 轻松
    : bodyLoad < 55 ? 'mid'    // 适中
    : 'bad';                  // 偏重 / 过载

  const metricChips: MindChipItem[] = [
    // ★ 2026-10-07（用户：「睡眠恢复这个 66，也加上斜杠 100」）：本 chip 恒显「/100」，
    //   不再随相对/绝对口径切换单位（v18.155 的随口径隐单位被用户否决，以显示一致性优先）。
    { key: 'rec', icon: 'leaf', tone: 'lime', label: '睡眠恢复', value: recovery, unit: '/100', valueTone: chipValueTone(recTag), onPress: () => navigation.navigate('SleepDetail') },
    // ★ 2026-10-08（用户：圆环上面不是叫脑力准备度吗，怎么还是消耗）：chip 数值 = 此刻剩余准备度
    //   （brainRemaining，高=好，与 cogTag「准备度高/中/低」同字段同向）→ 标签改「脑力准备度」。
    //   例外：无昨夜睡眠时数值回落为「今日已用脑量」→ 标签同步切「今日用脑」，标签与数值必须同一口径
    //   （v18.128 铁律：标签与数值取同一字段，否则用户永远觉得算错）。
    { key: 'cog', icon: 'nodes', tone: 'cyan', label: cogTag?.startsWith('已用脑') ? '今日用脑' : '脑力准备度', value: cognitive, unit: '/100', valueTone: chipValueTone(cogTag), onPress: () => navigation.navigate('EnergyDetail', { type: 'cognitive' }) },
    { key: 'emo', icon: 'heart', tone: 'pink', label: '心理压力', value: stressValue, unit: '/100', valueTone: chipValueTone(emoTag), onPress: () => navigation.navigate('EnergyDetail', { type: 'emotion' }) },
    // ★ 2026-10-07 新增：运动（卡路里）。★ 2026-10-15（V1 去紫）：tone cyan→butter（黄：消耗/代谢），
    //   避免与脑力准备度的蓝块相邻撞色；mm.chipBg 语义：butter=黄（代谢）与卡路里消耗同向。
    { key: 'act', icon: 'flame', tone: 'butter', label: '运动消耗', value: actChipValue, unit: actChipValue !== '—' ? 'kcal' : undefined, onPress: () => navigation.navigate('EnergyDetail', { type: 'activity' }) },
    // ★ 2026-10-15（V1 去紫）：周期卡 tone lav(紫)→cyan(蓝)
    { key: 'period', icon: 'moon', tone: 'cyan', label: status?.phaseLabel && status.phaseLabel !== '未记录' ? status.phaseLabel : '生理周期', value: status?.dayInCycle != null ? `第 ${status.dayInCycle} 天` : '—', moonStyle: phaseMoon, onPress: () => navigation.navigate('CycleCalendar') },
    // ★ 2026-10-17 新增「身心压力」：取洞察页「基础指标」压力卡同源 —— `ring.metrics['stress']`
    //   （0–100，越高越紧张）。点按去向与基础指标压力卡一致 → stress 指标详情页（MetricDetail），
    //   而非「心理压力」的情绪压力详情页（EnergyDetail emotion）。tone 复用 pink，置于数组末位。
    { key: 'load', icon: 'bolt', tone: 'pink', label: '身心压力', value: loadValue, unit: loadValue !== '—' ? '/100' : undefined, valueTone: loadTone, onPress: () => navigation.navigate('MetricDetail', { key: 'stress', name: '身心压力', unit: '/100', yMin: 0, yMax: 100 }) },
  ];

  /** 睡眠恢复卡数据（MindMate v10：纯数字无图表）。全部来自真实睡眠摘要，缺项显式 '—'。 */
  const sleepCard = (() => {
    const s = recoverySleep;
    if (!s) return null;
    const deepPct = s.total > 0 && Number.isFinite(s.deep) ? Math.round((s.deep / s.total) * 100) : null;
    const wakeCount = s.awake ?? s.insomnia ?? null;
    const h = Math.floor((s.total ?? 0) / 60);
    const m = Math.round((s.total ?? 0) % 60);
    const total = h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
    return {
      score: Number.isFinite(s.score) ? Math.round(s.score) : null,
      deepPct,
      wakeCount,
      total,
      sleepTime: s.sleepTime ?? null,
      wakeTime: s.wakeTime ?? null,
    };
  })();

  /**
   * 情绪点阵 96 槽映射（15 分钟/点）。★ v18.60 口径（用户定稿）：展示「睡醒时间段」的情绪，
   * **没有数据 = 灰色（none）**，有数据按档位上色：
   * · 睡眠窗口（真实睡眠摘要 sleepTime→wakeTime，跨午夜）→ none（灰，无情绪数据）
   * · 未到时段（未来）→ none（灰）
   * · 压力事件所在的 15 分钟槽（真实 EDA 事件）→ stress
   * · 清醒且有「今日状态曲线」档位 → 充沛=energy / 平静=calm / 偏低·不足=tired
   * · 清醒但曲线未覆盖 → none（灰，不冒充数据）
   */
  const emotionSlots: MindMoodKey[] = (() => {
    const slots: MindMoodKey[] = new Array(96).fill('none');
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const parseHM = (s?: string | null): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const sleepStart = parseHM(recoverySleep?.sleepTime);
    const sleepEnd = parseHM(recoverySleep?.wakeTime);
    const inSleep = (m: number) =>
      sleepStart != null && sleepEnd != null
        ? sleepStart > sleepEnd ? (m >= sleepStart || m < sleepEnd) : (m >= sleepStart && m < sleepEnd)
        : false;
    const lvlMap: Record<string, MindMoodKey> = { '充沛': 'energy', '平稳': 'calm', '偏低': 'tired', '不足': 'tired' };
    // ★ v18.96（审计 2-1）：状态曲线只取**今天**的点。旧实现只比时分、不比日期，
    //   昨天某时段的 level 会被画进今天同一时刻的槽位（跨天清零后此处本已无残留，加过滤做防御）。
    const todayKeyStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const pts = (ring.statusTimeline ?? []).filter((p: any) => {
      if (!Number.isFinite(p?.t)) return false;
      const d = new Date(p.t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKeyStr;
    });
    for (let i = 0; i < 96; i++) {
      const m = i * 15;
      if (inSleep(m)) { slots[i] = 'none'; continue; }
      if (m > nowMin) { slots[i] = 'none'; continue; }
      let lvl: string | null = null;
      for (const p of pts) {
        const d = new Date(p.t);
        const pm = d.getHours() * 60 + d.getMinutes();
        if (pm <= m + 15 && m - pm < 60) lvl = p.level;
      }
      slots[i] = lvl ? (lvlMap[lvl] ?? 'none') : 'none';
    }
    for (const e of stressReport?.events ?? []) {
      if (Number.isFinite(e.hour) && Number.isFinite(e.minute)) {
        const idx = Math.min(95, Math.max(0, Math.floor((e.hour * 60 + e.minute) / 15)));
        slots[idx] = 'stress';
      }
    }
    return slots;
  })();

  // ★ v18.56.1 Bento 情绪卡点阵：96 槽(15min) → 48 点(30min/点，覆盖全天)。
  //   有数据档优先保留（stress > energy > tired > calm > none），压力事件点不因抽样丢失。
  const emotionDots48: MindMoodKey[] = (() => {
    const out: MindMoodKey[] = [];
    for (let j = 0; j < 48; j++) {
      const a = emotionSlots[j * 2];
      const b = emotionSlots[j * 2 + 1] ?? a;
      out.push(
        a === 'stress' || b === 'stress' ? 'stress'
        : a === 'energy' || b === 'energy' ? 'energy'
        : a === 'tired' || b === 'tired' ? 'tired'
        : a === 'calm' || b === 'calm' ? 'calm'
        : 'none',
      );
    }
    return out;
  })();

  return (
    <View style={styles.page}>
      {/* ★ mira-ocean（2026-10-19）：首页背景由纯白改深海三色渐变（与全 App 同源 bgGradStops）。
          原「上白下紫」/「全白」分屏收起——各文字/卡片 token 在 ocean 分支已是白阶玻璃，
          翻背景即可整体进入深海主题，无需逐个翻色。 */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        style={StyleSheet.absoluteFill}
      />
      {/* ★ v18.50 原整屏吸附翻页；2026-10-08 改自然滚动：第二屏（消费与恢复节律卡片）
          已按用户要求隐藏（SHOW_RHYTHM_CARDS=false），首页只需把「圆环→chips→趋势图→AI 气泡」
          作为连续内容流展示，故去掉 snapToInterval 强制吸附，首屏高度改为自然延伸。 */}
      <ScrollView
        style={styles.pagerScroll}
        contentContainerStyle={[styles.pagerContent, { paddingBottom: bottomReserve }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        bounces={false}
        // ★ 2026-10-13（用户：去掉首屏可以往下滑——第二屏内容已隐藏 SHOW_RHYTHM_CARDS=false，
        //   向下滑只露出空白）：仅当真有第二屏(pagable)且内容超高时才允许滚动，否则锁死。
        scrollEnabled={SHOW_RHYTHM_CARDS ? canScroll : false}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          setVpH(h);
          setCanScroll(homeContentHRef.current > h + 6);
        }}
        onContentSizeChange={(_w, h) => {
          homeContentHRef.current = h;
          setCanScroll(h > vp_H + 6);
        }}
      >
        {/* ===== 第一屏：状态区（高度自然延伸） ===== */}
        <View style={styles.pageSnap}>
          {/* ★ 2026-10-08：minHeight = 实际视口高 − 安全区与导航预留，配合气泡外层 marginTop:'auto'
              → 内容不足时气泡被顶到「Tab 栏上方」的固定位置（不再是靠 paddingBottom 猜位置）。
              同时把 flex 显式钉死为「按内容定高（minHeight 兜底）」，避免 styles.pageInner 的
              flex:1（flexBasis:0）在 ScrollView 这类不定高父容器里把高度算成 0 或撑满视口
              —— 那样 marginTop:'auto' 会把气泡推到屏幕最底部（整块被 Tab 盖住）。 */}
          <View
            style={[
              styles.pageInner,
              {
                paddingTop: insets.top + 12,
                minHeight: Math.max(0, (vp_H || dims.height) - bottomReserve),
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: 'auto',
              },
            ]}
          >
            {/* v18.45 头部单行：Today 居左，头像+名字移到右侧（整屏模式下不再滚动淡出）
                ★ 2026-10-16（用户）：账号行（K / Kristina）移到「今日状态」标题上方，标题随之下移 */}
            <View style={styles.head} onLayout={measureSection('head')}>
              <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('AccountHub')} activeOpacity={0.7}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{accountLetter}</Text>
                </View>
                <Text style={styles.name}>{accountName}</Text>
              </TouchableOpacity>
              <Text style={[styles.title, { marginTop: theme.space.sm }]}>今日状态</Text>
            </View>

            {/* ★ 2026-10-16（用户：「下面的小卡片展示到圆环的上面」）：指标 chips 从圆环下方
                （PhaseLegend 之后）移回标题下方、圆环上方 —— 与 2026-10-15 V1 之前的排布一致，
                head 的 marginBottom lg 正是当年为「标题与 chips 的呼吸间距」留的量（2026-10-11 用户原话）。
                chips 各自独立白卡，第 5 张露边提示可横滑；marginBottom md = chips 与圆环的间距。 */}
            <View style={{ marginBottom: theme.space.md }} onLayout={measureSection('chips')}>
              <MindChips items={metricChips} />
            </View>

            {/* ★ 2026-10-15：弹性呼吸位 —— 与圆弧下方的另一处弹性位等分剩余高度，
                让「圆环白卡」在标题与底部气泡之间均匀分布，不再被挤在顶部、底部留大空。 */}
            <View style={{ flexGrow: 1, flexBasis: 0 }} />

        {/* ★ V1（2026-10-15）：顶部指标 chips 在圆环下方（白面板已拆，直承浅灰底） */}

        {/* ─────────────────────────────────────────────────────────────
            ★ 全天状态面板（2026-09-21）：圆环 + 全天状态趋势 = **同一块全宽白面**。
            · 上/左/右不留边界：负 margin 抵消 ScreenContainer 的 24pt 内边距实现全宽铺满，
              且与页面上半部分的纯白底同色 → 接缝不可见，读起来是「一个整体、同一份数据」。
            · 只在最下方用一段**向上圆弧**收边（两端上扬、中间最低），呼应圆环的圆形。
            · ★ 2026-10-11：新增标题「全天状态趋势图」（左对齐，紧贴其右小箭头），箭头从浮在图上的玻璃圆改为标题旁 chevron；标题用「③ 左对齐·轻量·字小点」：13px / 常规 / 灰，避免深黑加粗显得像贴上去的标签。
            ───────────────────────────────────────────────────────────── */}
        {/* ─────────────────────────────────────────────────────────────
            ★ V1（2026-10-15 用户定稿）：圆环直承浅灰页面底色，**全宽白面板拆除**。
            · 页面底色 = 浅灰 #F5F5F7（theme bgGradStops，去紫）；白只剩 chips / 气泡两层；
            · 圆环 → chips 间距 16pt（energyWrap.marginBottom），chips 各自独立白卡；
            · 原「全宽白面 + 底部微笑弧 + 羽化」整体移除（没有白面需要过渡）。
            ───────────────────────────────────────────────────────────── */}
        <View style={styles.energyWrap}>
          <View style={styles.energyRingWrap}>
            {/* ★ 2026-10-15（用户）：圆环整体可点 → 跳「全天状态趋势」日/周/月/年详情 */}
            <TouchableOpacity
              style={styles.energyBallCol}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="查看全天状态趋势详情"
              onPress={() => navigation.navigate('StatusTrendDetail')}
            >
              <EnergyBall status={ring.curveStatus} centerLabelOverride={scene?.word ?? (isAsleep ? '睡眠恢复中' : undefined)} />
            </TouchableOpacity>
            {/* ★ 圆环右侧小箭头：与圆环同目标，点击也跳详情；绝对定位于环右、垂直居中 */}
            <TouchableOpacity
              style={styles.ringChevron}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="查看全天状态趋势详情"
              hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
              onPress={() => navigation.navigate('StatusTrendDetail')}
            >
              <Icon name="chevronRight" size={theme.fontSize.h2} color={theme.colors.textSub} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ★ 2026-10-15（用户）：圆环下方图例 —— 与「全天状态趋势」详情页图例同源（MOODS 四等级：
            元气满满/状态良好/平平静静/休息一下），解释圆环弧点颜色含义。
            ★ 2026-10-16（用户：「卵泡期能不能和元气满满、状态良好那些放在同一行」）：
            当前相位图例（inline）并入同一行末尾，间距沿用父级 gap 12；未记录时不渲染。 */}
        <View style={styles.ringLegendRow}>
          {MOODS.map((m) => (
            <View key={m.key} style={styles.ringLegendItem}>
              <View style={[styles.ringLegendDot, { backgroundColor: m.color }]} />
              <Text style={styles.ringLegendText}>{m.label}</Text>
            </View>
          ))}
          <PhaseLegend current={currentPhaseKey} inline />
        </View>

        {/* ★ 2026-10-16：指标 chips 已移到标题下方（圆环上方）——原「V1：chips 紧贴圆环下方」块删除 */}

        {/* ★ V1（2026-10-15）：常驻 AI 对话气泡（白玻璃磨砂 + 右下小尾巴）。
            气泡恒定落在「Tab 栏上方」（marginBottom = 0，贴 Tab 上沿），不被 Tab 压到、也不随
            建议态/录音态文案长度上下跳；它与标题下方各有一个等权弹性位，等分剩余高度 →
            内容整体居中、上下留白对称（不再把空白全堆在底部）。 */}
        <View style={{ flexGrow: 1, flexBasis: 0 }} />
        <View style={{ marginTop: theme.space.lg, marginBottom: -theme.sp(1.5), paddingTop: 0, alignItems: 'center' }}>
          <HomeAiBubble navigation={navigation} status={ring?.curveStatus} height={bubbleHeight} width={Math.max(0, Math.min(dims.width, theme.layout.maxWidth) - theme.space.screen * 2 - 8)} analysis={narrative} />
        </View>

          </View>{/* /pageInner 第一屏 */}
        </View>{/* /pageSnap 第一屏 */}

        {/* ===== 第二屏：消耗与恢复节律 / 今日旅程（整屏，Tab 吸顶 + 屏内滚动） ===== */}
        {SHOW_RHYTHM_CARDS ? (
        <View style={[styles.pageSnap, { height: dims.height }]}>
          <View style={[styles.pageInner, { paddingTop: insets.top + theme.space.md }]}>
            <ScrollView style={styles.page2Scroll} contentContainerStyle={{ paddingBottom: insets.bottom + theme.space.sm }} nestedScrollEnabled showsVerticalScrollIndicator={false}>

        {/* 消耗与恢复节律 Bento 网格（原今日旅程 tab 已迁到工具页 MeditationScreen 最底部） */}
        <View style={{ gap: theme.space.xs }}>
            {/* ★ v18.145 睡眠卡（新）：昨晚这一觉 = 分数 + 作息规律 + 入睡/起床/时长。
                ⚠ 放在 AllDayRecoveryCard **之前**：那张是「全天节律曲线」，
                   这张是「昨晚具体事件」，用户先看具体的、再看趋势更符合阅读顺序。
                   dataStale 与首页圆环同源（同一判据，不另设口径）。
                ★ 2026-10-05：暂时隐藏（见文件顶部 SHOW_SLEEP_CARD），代码与 props 原样保留。 */}
            {SHOW_SLEEP_CARD ? (
              <SleepCard dataStale={dataStale} onPress={() => navigation.navigate('SleepDetail')} />
            ) : null}

            {/* 最上面 = 全天恢复（★ v18.62 去彩底回白卡：颜色留给 lime chip/badge + 趋势曲线） */}
            {/* ★ 2026-10-06：用户要求「睡眠节律」卡点进去 = 洞察页睡眠 tab「睡眠结构」卡点进去的
                同一页（SleepDetail，昨天改的睡眠结构/节律详情），不再是昼夜节律/皮质醇页。 */}
            <SleepRhythmHomeCard onPress={() => navigation.navigate('SleepDetail')} />

            {/* 中排：左高块 = 脑力（lime：24h 疲劳柱状图 + 预测/真实峰谷行）；右列 = 情绪 / 运动
                ★ v18.68：去准备度（只在脑力消耗详情展示）；★ v18.126 标题「认知」→「脑力」（与顶部 chip 口径统一）
                ★ v18.59：两小卡一律固定高 sp(32.5)=130（130+8+130=268 正好占满）——flex:1 的 flexGrow 分配在 Fabric 下
                  与 stretch/gap 组合会把运动卡压成 ~30pt 细条（真机实锤），禁用 flexGrow 依赖 */}
            <View style={{ flexDirection: 'row', gap: theme.space.xs, height: theme.sp(67) }}>
              <BentoCard
                bg={mm.colors.cardBg}
                chipBg={mm.chipBg.lime.bg}
                icon="nodes"
                iconFg={mm.chipBg.lime.fg}
                title="脑力消耗"
                sub={cogCardSub}
                value={cogCardValue != null && cogCardValue !== "—" ? cogCardValue + "%" : cogCardValue}
                chart={cogReadiness
                  ? <View style={{ marginTop: 'auto', marginBottom: theme.sp(1.5) }}><MiniReadinessTrend points={cogReadiness.points} /></View>
                  : undefined}
                footLines={cogPeakTroughLines}
                style={{ width: '53%' }}
                onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })}
              />
              <View style={{ flex: 1, gap: theme.space.xs }}>
                <BentoCard
                  bg={mm.colors.cardBg}
                  chipBg={mm.chipBg.pink.bg}
                  icon="heart"
                  iconFg={mm.chipBg.pink.fg}
                  // ★ v18.140：标题从「情绪消耗·次峰值」改为「心理压力」，
                  //   值从「事件次数」改为 0-100 百分位（`stressValue`）。
                  //   旧标题三重矛盾（同 v18.137）：「消耗」没定义 / 单位「次」与分数不符 /
                  //   「峰值」是事件计数的概念，用户看不懂。
                  //   ⚠ 事件次数仍保留在内部（`emotionDots48` 点阵图需要它做时间轴），
                  //     只是不再当「压力大小」展示。
                  // ★ v18.141：`sub` 写档位 + 校准提示（原来只有 `unit`）。
                  title="心理压力"
                  value={stressValue}
                  sub={undefined}
                  unit=""
                  chart={<EmotionDots slots={emotionDots48} columns={12} dotSize={theme.fs(5.5)} gap={theme.fs(2.25)} tight />}
                  compact
                  style={{ height: theme.sp(32.5), flexGrow: 0, flexShrink: 0 }}
                  onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })}
                />
                <BentoCard
                  bg={mm.colors.cardBg}
                  chipBg={mm.chipBg.cyan.bg}
                  icon="bolt"
                  iconFg={mm.chipBg.cyan.fg}
                  title="运动消耗"
                  aside={sportAside}
                  subLine={hasSportSessions ? (
                    <Text style={{ fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium, color: mm.colors.inkSoft }}>
                      <Text style={{ color: sportFirstColor, fontWeight: theme.weight.semibold as never }}>
                        {sportFirst}
                      </Text>
                      {sportCount > 1 ? ` 等 ${sportCount} 段` : ''}
                    </Text>
                  ) : (activityHasData ? `${stepsToday.toLocaleString('en-US')} 步 · ${stepDistToday >= 1 ? stepDistToday.toFixed(1) : stepDistToday.toFixed(2)} km` : '连上戒指后自动同步')}
                  value={hasSportSessions ? String(Math.round(sportKcalTotal)) : (activityHasData ? String(Math.round(stepKcalToday)) : '—')}
                  unit={(hasSportSessions || activityHasData) ? 'kcal' : undefined}
                  compact
                  style={{ height: theme.sp(32.5), flexGrow: 0, flexShrink: 0 }}
                  onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })}
                />
              </View>
            </View>

            {/* 底部：经期卡——处于什么时期 + 第 N 天 + 最近 7 天日期圈 */}
            <BentoCard
              bg={mm.colors.cardBg}
              chipBg={mm.chipBg.lav.bg}
              icon="moon"
              iconFg={mm.chipBg.lav.fg}
              moonStyle={phaseMoon}
              title="经期"
              aside={status?.phaseLabel ?? undefined}
              dayBadge={status?.dayInCycle ?? null}
              dayBadgeBg={mm.colors.purpleDeep}
              dayBadgeFg={'#FFFFFF'}
              chart={<View style={{ marginTop: theme.sp(1.5) }}><PeriodDayCircles marked={periodMarks} /></View>}
              style={{ height: theme.sp(28), flexGrow: 0 }}
              onPress={() => navigation.navigate('CycleCalendar')}
            />
          </View>
            </ScrollView>{/* /page2Scroll 第二屏内容 */}
          </View>{/* /pageInner 第二屏 */}
        </View>
        ) : null}
        {/* /pageSnap 第二屏 */}
      </ScrollView>{/* /pager 整屏吸附 */}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%' },
  // ★ v18.50 整屏吸附分页
  pagerScroll: { flex: 1, width: '100%' },
  // ★ 2026-10-08（用户：「输入框被底下 Tab 压着」）：
  //   旧写法 paddingBottom = tabBarHeight + sp(11)(44) = 100 是**无效预留**——
  //   第一屏内容比视口高、ScrollView 停在顶部时，padding 只在内容末尾加空白，
  //   根本推不动上方元素，气泡照样压在 Tab 上（截图为证）。
  //   现在使用实际安全区计算 bottomReserve：
  //   minHeight 顶位置 + marginTop:'auto' 吃余量 + paddingBottom 保证超高时滚到底也在 Tab 上方。
  pagerContent: {},
  pageSnap: { width: '100%', alignItems: 'center' },
  pageInner: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.screen,
    flex: 1,
    position: 'relative',
  },
  snapHint: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xs,
  },
  snapHintText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium,
  },
  tabBarSticky: {
    flexDirection: 'row',
    marginTop: theme.space.sm,     // ★ v18.53.3 lg(20)→sm(12)：一屏预算
    marginBottom: theme.space.xs,  // ★ sm(12)→xs(8)
  },
  page2Scroll: { flex: 1, width: '100%' },
  head: {
    // ★ 2026-10-16（用户：账号 Kristina 放到「今日状态」上面 + 标题往下一点）：
    //   单行（标题左 / 账号右）→ 上下堆叠（账号行在上、标题在下，均左对齐）。
    flexDirection: 'column',
    alignItems: 'flex-start',
    // ★ 2026-10-11（用户：顶头与下方 chips 排有点挤）：xs(8) → lg(20)，
    //   给「今日状态」标题与下方睡眠恢复/脑力准备度 chips 留出更舒展的呼吸间距。
    marginBottom: theme.space.lg,
  },
  avatarName: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.avatarBgLight,
    borderWidth: 1,
    borderColor: theme.colors.avatarBorderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.sm,
  },
  avatarLetter: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  name: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  /**
   * ★ v18.153（用户：「趋势图往上一点，把下面的图例露出来」）：
   *   一屏纵向预算：head(36+36) + chips(87+12) + [环 + 胶囊 + 趋势图 + 时间轴 + 图例] + 底部圆弧。
   *   环本身已由 EnergyBall 收回画布底部空带（−0.07×svgSize ≈ −21pt）；
   *   这里再把「胶囊 → 趋势图」的间距从 16 收到 8（marginBottom 归零，留给 trendWrap.marginTop），
   *   合计让趋势图与图例整体上移 **≈45pt** → 图例不再被顶出一屏 / 被底部滑动提示压住。
   *   ⚠ 若还要更多空间，下一个旋钮是 EnergyBall 的 size 系数 0.70（环视觉会一起变小），
   *     不要再来动这里的间距。
   */
  energyWrap: { marginBottom: theme.space.md, alignItems: 'center' },
  energyBallCol: { alignItems: 'center' },
  // ★ 圆环图例：与 StatusTrendDetail 图例同款（9pt 圆点 + micro 灰字），紧凑单行不挤一屏
  ringLegendRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 2, marginBottom: theme.space.xs },
  ringLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ringLegendDot: { width: 9, height: 9, borderRadius: 4.5 },
  ringLegendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ★ 2026-10-15（用户）：圆环 + 右侧箭头 的相对容器；圆环保持屏幕居中，箭头绝对定位于环右、垂直居中，
  //   不挤占环本体，也不破坏「一屏不滑动」的纵向预算（箭头在环右侧空带内，高度随环自适应）。
  energyRingWrap: { position: 'relative', alignItems: 'center' },
  ringChevron: {
    position: 'absolute',
    right: -16,
    top: 0,
    bottom: 0,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ★ v18.50 修复：不要 flex:1——整屏吸附后 pageInner 是确定高度，flex:1（flexBasis=0）
  // 会让胶囊在自适应父容器里塌成 0 高，分析文字整句不可见。自动高度即可。
  statusPill: { marginTop: 4 },
  // ★ v18.52 经期日期圈（PeriodDayCircles）
  pdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  pdCircle: {
    width: theme.fs(30),
    height: theme.fs(30),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,   // ★ v18.62 白卡上未标记日期圈改中性浅灰（cardBg 白圈会隐形）
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdCircleText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  statusChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: theme.space.xs,
  },
  statusChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  statusChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.orbTextInk,
  },
  phaseChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  phaseChipIcon: {
    fontSize: theme.fontSize.xs,
    marginRight: theme.sp(1),
    lineHeight: theme.fs(12),
  },
  phaseChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.stateTired,
  },
  statusNarr: {
    // ★ v18.49：保留 A 的 16px/居中/留白28，但降浓——常规字重 + 柔和灰，不再浓黑
    fontSize: theme.fontSize.body,
    lineHeight: 24,
    // ★ 2026-10-13（用户：保证圆环下面恒为两行文字）：锁死两行高，
    //   文案为 1 行或 AI 缓存未刷新时也保留两行占位，下方趋势图位置不随文案长度跳动。
    minHeight: 48,
    color: theme.colors.textSub,
    fontWeight: theme.weight.regular,
    // 面板改成全宽、左右对称之后，文字也居中（原来左对齐会显得偏）
    textAlign: 'center',
    paddingHorizontal: theme.space.screen,
  },
  // ★ V1（2026-10-15）：全宽白面板（statusPanel）与底部圆弧（statusPanelArc）已整体移除；
  //   圆环直承浅灰页面底色；「圆环 → chips」16pt 间距与居中由下方 energyWrap 负责。
  trendWrap: { position: 'relative', marginTop: 0 },
  // ★ 2026-10-11：趋势图右上角的小箭头（弱暗示「可进详情」）。
  //   半透明白圆 + 极淡描边，层级轻、不抢图；pointerEvents:none 让点击落到外层 TouchableOpacity。
  trendChevCorner: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.ui.white72,
    borderWidth: 1,
    borderColor: theme.colors.ui.borderSoft,
  },

  energyCol: {
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.md,
  },
  energyMini: {
    flex: 1,
    height: 130,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  energyMiniImg: {
    borderRadius: theme.radius.md,
  },
  energyMiniOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 70,
  },
  energyMiniLabel: {
    position: 'absolute', left: 10, right: 10, bottom: 10,
  },
  energyMiniTitle: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textWhite,
    fontWeight: theme.weight.medium,
  },
  energyMiniValRow: {
    flexDirection: 'row', alignItems: 'baseline',
    marginTop: 2,
  },
  energyMiniVal: {
    fontSize: theme.fontSize.card,
    color: theme.colors.textWhite,
    fontWeight: theme.weight.semibold,
  },
  energyMiniUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.ui.white85,
  },
  adviceWrap: { marginTop: theme.space.md },
  cardTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  trendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  axisY: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.stateTired,
    fontWeight: theme.weight.medium,
    marginBottom: theme.sp(1),
  },
  legend: {
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 收紧：让底部圆弧离图表更近（原 12）
    marginTop: 4,
    // ★ 2026-10-08：xs(8) → 4，一屏预算再收 4
    marginBottom: 4,
    gap: theme.space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.sp(1) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  todayTabBtn: {
    flex: 1,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    // ★ 2026-10-06（用户口径）：无底色纯文字；未选无边框，选中只描边（lime）。
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    marginHorizontal: theme.space.xs,
  },
  todayTabBtnOn: {
    borderColor: mm.colors.limeMid,
  },
  todayTabLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  todayTabLabelOn: {
    color: mm.colors.ink,
    fontWeight: theme.weight.semibold,
  },
});
