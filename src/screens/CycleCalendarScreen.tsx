/**
 * CycleCalendarScreen —— 周期日历（洞察「周期和激素」tab → 点经期卡片进入）
 *
 * 设计约束（与全局 design token 一致）：
 * 页面结构（★ 对齐其他数据详情页）：
 *   返回 + 标题
 *   → **周期切换条（‹ 上一个周期 / 下一个周期 ›，中间显示起点与第 N 天 / 共 L 天）**（最上面）
 *   → 选定周期：**当前周期 = 月相环**（可切「查看日历」）；**历史周期 = 该周期所跨自然月的日历网格**
 *   → **记录 / 修改经期入口（月相环正下方；无记录时排在空态卡上方）**
 *     ★ 2026-10-07：由洞察页「雌/孕激素」卡片移入（用户要求放在圆环下面）
 *   → 派生指标 → 体温双相监测 → 激素趋势卡 → 方法与依据。
 *  网格以顶部锚点日期为基准；网格内部不再自带导航（避免与顶部选择器重复）。
 *
 *  - 顶部返回 + 标题；周期切换走自绘的 ‹ / › 周期切换条
 *    ★ 2026-10-07（用户：点击原来的时间选择器报错；「参考其他生理期 App 怎么选择时间」）：
 *    去掉「月/年」分段控件与日期锚点选择器，改为「按周期浏览」（贴近 Clue / Flo / Oura）。
 *  - 月视图：30/31 天网格，每个格子按「真实记录推算的相位」着色
 *    （经期/卵泡期/排卵期/黄体期），并标记：已记录经期日（实心点）、
 *    排卵期窗口（青绿描边）、预测下次经期首日（虚线环）。
 *  - 年视图：12 个紧凑月历纵向排列，同样按相位着色，一眼看全年节律。
 *  - 三张真实数据趋势卡**跟随所选周期**（窗口 = 第 1 天 → 第 N 天），各自不带时间切换（时间由顶部周期切换承担）：
 *      · 体温双相监测——戒指实测体温（BBT 双相）；
 *      · 雌激素波动（HRV·EDA 推算）——戒指实测 HRV（卵泡期较高）+ EDA 皮肤电导（排卵期升高）；
 *      · 孕激素波动（体温推算）——戒指实测体温 + 静息心率的抬升合成。
 *    三张卡都带**四相图例**（PhaseLegend）与**AI 解读**（体温=TempBiphasicAnalysis，
 *    激素=TrendAnalysis），解读结论均由各卡同一份真实数据算出；色带/图例统一走 lib/phaseColors。
 *    戒指不直接测量激素，趋势卡均为「实测信号 → 趋势」的推算，非直接测量。
 *  - 点任意日 → 底部 Sheet：显示该日相位 / 预测雌激素 / 已记经期状态，并可在 Sheet 内
 *    直接编辑经量 + 疼痛程度（与周期 tab 的 PeriodLogCard 共用同一份 periodLog）。
 *
 * 数据：经期主记录来自 RingBle.female + 本地 cycleLog（merge 同 CyclePhaseCard）；
 * 每日状态来自 periodLog。相位/预测均为日历+体温推算，非硬件实测。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle, Rect, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { RingBle, type RingState } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import {
  computeCycle,
  estrogenAt,
  estrogenForDate,
  parseDate,
  dayKey,
  addDays,
  daysBetween,
  tempDailyToSeries,
  type CycleLog,
  type CyclePhase,
  type CycleInfo,
} from '../lib/cycleMath';
import { phaseOfDay, cycleAxis, buildEstrogenData, buildProgesteroneData, trendDays, type TrendRange } from '../lib/hormoneTrend';
import { loadCycleLog, loadPeriodDays, savePeriodDay, saveCycleLog, FLOW_LABEL, PAIN_LABEL, type FlowLevel, type PainLevel, type PeriodDayLog } from '../data/cycleLog';
import { PHASE_COLOR, PHASE_LABEL, phaseBg, phaseBand } from '../lib/phaseColors';
import CycleMoonPhase from '../components/CycleMoonPhase';
import CycleDerivedMetrics from '../components/CycleDerivedMetrics';
import TempBiphasicChart from '../components/TempBiphasicChart';
import TempBiphasicAnalysis from '../components/TempBiphasicAnalysis';
import TrendAnalysis from '../components/TrendAnalysis';
import PhaseLegend from '../components/PhaseLegend';
import PeriodRecordPanel from '../components/PeriodRecordPanel';
import SymptomStatsPanel from '../components/SymptomStatsPanel';
import SymptomPhaseMatrix from '../components/SymptomPhaseMatrix';
import CycleRegularityCard from '../components/CycleRegularityCard';
import CycleYearReviewCard from '../components/CycleYearReviewCard';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 顶部一级视图：周期（按周期浏览）/ 年（年度回顾） */
type ViewMode = 'cycle' | 'year';
/** 圆环下方的分析视图：周期分析 / 激素节律分析 */
type AnalysisTab = 'cycle' | 'hormone';

/**
 * SegTabs —— 分段切换控件，两种形态（分别对齐项目里已有的两处参照）：
 *  · variant='chip'（顶部「周期 / 年」）：★ 2026-10-07（用户：「参考指标页，它的日/周/月/年
 *     是怎么展示的？它是很小的，放在左边」）→ 参考 MetricDetailScreen 的 RangeSwitch：
 *     靠左排列的小胶囊，选中态实心主色 + 白字。
 *  · variant='ring'（圆环下方「周期分析 / 激素节律分析」）：★ 2026-10-07（用户：「参考洞察页
 *     昼夜节律 / 生理周期节律，它那种。点击只有外面那环，按钮的边缘会改变颜色，是那种绿色」）
 *     → 参考 InsightScreen 的 UnderlineTabs(large)：等宽平铺、**无底色**，
 *     选中只把描边换成 limeMid（绿），未选保留浅描边。
 */
function SegTabs({
  value,
  options,
  onChange,
  variant = 'chip',
}: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (k: string) => void;
  variant?: 'chip' | 'ring';
}) {
  const ring = variant === 'ring';
  return (
    <View style={ring ? styles.segRingRow : styles.segChipRow}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            activeOpacity={0.7}
            onPress={() => {
              if (!on) onChange(o.key);
            }}
            style={[
              ring ? styles.segRingItem : styles.segChipItem,
              on ? (ring ? styles.segRingItemOn : styles.segChipItemOn) : null,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text
              style={[
                ring ? styles.segRingText : styles.segChipText,
                on ? (ring ? styles.segRingTextOn : styles.segChipTextOn) : null,
              ]}
            >
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** 三个趋势图（体温/雌激素/孕激素）统一按「月」这一档取回退窗口；实际横轴/取数窗口由顶部「周期切换」决定 */
const TREND_RANGE: TrendRange = 'month';

function mergeCycleLog(ring: RingState, local: CycleLog | null): CycleLog | null {
  const f = ring.female;
  const ringLog: CycleLog | null =
    f && f.lastMenstrualDate && f.menstrualCircle > 0
      ? {
          lastPeriodStart: f.lastMenstrualDate,
          cycleLength: f.menstrualCircle,
          lutealLength: 14,
          periodLength: f.menstrualDays || 5,
        }
      : null;
  if (!ringLog && !local) return null;
  if (!local) return ringLog;
  if (!ringLog) return local;
  return parseDate(ringLog.lastPeriodStart).getTime() >= parseDate(local.lastPeriodStart).getTime()
    ? ringLog
    : local;
}



export default function CycleCalendarScreen() {
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [localLog, setLocalLog] = useState<CycleLog | null>(null);
  const [periodDays, setPeriodDays] = useState<Record<string, PeriodDayLog>>({});
  // ★ 2026-10-07（用户：点击生理周期最上面的时间选择器出错了；「参考一下其他的生理期 App 怎么选择时间」）：
  //   顶部改为「周期切换」——‹ 上一个周期 / 下一个周期 ›，中间显示所选周期的起点与进度。
  //   0 = 当前周期，-1 = 上一个周期（贴近 Clue / Flo / Oura 的「按周期浏览」；不再用月/年分段控件）。
  const [cycleOffset, setCycleOffset] = useState(0);
  // 当前周期下是否把月相环切换成月历（历史周期直接出月历）
  const [showCal, setShowCal] = useState(false);
  // ★ 2026-10-07（用户：顶部加「周期 / 年」两个 tab；点「年」整页只显示年度内容）
  const [viewMode, setViewMode] = useState<ViewMode>('cycle');
  // ★ 2026-10-07（用户：圆环与「记录 / 修改」下方加「周期分析 / 激素节律分析」两个 tab）
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('cycle');
  const [selected, setSelected] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  useEffect(() => {
    void loadCycleLog().then(setLocalLog);
    void loadPeriodDays().then(setPeriodDays);
  }, []);

  const log = mergeCycleLog(ring, localLog);
  const hasLog = !!log;

  const onSaveDay = async (entry: PeriodDayLog) => {
    await savePeriodDay(entry);
    const all = await loadPeriodDays();
    setPeriodDays(all);
  };

  // ── 记录 / 修改经期：直接复用洞察页卡片那张「经期记录」面板（PeriodRecordPanel）──
  //   ★ 2026-10-07（用户：原先那个「记录 / 修改」里能记的东西很多 —— 经量 / 疼痛 / 心情 /
  //   身体症状 / 设为本次经期第一天 + 周期长度；详情页这枚按钮却只剩「日期 + 周期长度」）：
  //   现在打开的就是与卡片完全相同的内容，保存（写本地 periodLog / cycleLog + 写戒指）由面板内部完成。
  const openRecord = () => setRecordOpen(true);

  // ★ 圆环数据：当前周期进度
  const cycleInfo = useMemo(() => {
    if (!log) return null;
    return computeCycle(log, new Date(), {
      tempSeries: Object.keys(ring.tempDaily ?? {}).length
        ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] }))
        : undefined,
      periodHistory: log.history,
    });
  }, [log, ring.tempDaily]);

  /**
   * ★ 2026-10-07（周期切换）：周期列表（新 → 旧），index 0 = 当前周期。来源：
   *   · cycleLog.history —— 由 saveCycleLog 累积维护（升序，含最近一次）；
   *   · periodDays 里真实记过的「经期首日」（flow 有值且前一天无 flow），
   *     让只记过少数几次的用户也能往前翻。
   */
  const cycleStarts = useMemo(() => {
    if (!log?.lastPeriodStart) return [] as string[];
    const set = new Set<string>();
    set.add(log.lastPeriodStart); // 当前周期首日必在列表中
    for (const h of log.history ?? []) set.add(h);
    for (const k of Object.keys(periodDays)) {
      if (!periodDays[k]?.flow) continue;
      if (periodDays[addDays(k, -1)]?.flow) continue; // 只取「首日」（addDays 返回同格式的 'YYYY-M-D' 键）
      set.add(k);
    }
    const cur = parseDate(log.lastPeriodStart).getTime();
    return Array.from(set)
      .filter((d) => parseDate(d).getTime() <= cur)
      .sort((a, b) => parseDate(b).getTime() - parseDate(a).getTime());
  }, [log, periodDays]);

  // 选中周期（clamp 到可用范围）：0 = 当前周期；往前最多翻到最早一条记录
  const selIdx = Math.min(Math.max(-cycleOffset, 0), Math.max(0, cycleStarts.length - 1));
  const selStart = cycleStarts[selIdx] ?? log?.lastPeriodStart ?? null;
  const selDate = selStart ? parseDate(selStart) : null;
  const nextStart = selIdx > 0 ? cycleStarts[selIdx - 1] : null;
  const isCurrentCycle = selIdx === 0;
  const hasPrev = selIdx < cycleStarts.length - 1;

  // 该周期长度：当前周期取记录值；历史周期取「到下一次经期首日」的真实间隔
  const cycleLen = useMemo(() => {
    if (nextStart && selStart) return Math.max(1, daysBetween(selStart, nextStart));
    return Math.max(20, Math.min(45, Math.round(log?.cycleLength || 28)));
  }, [selStart, nextStart, log]);

  // 该周期横轴（第 1 天 = 周期首日）：当前周期把轴拉到「今天」以保证今天有虚线标记
  const cycAxis = useMemo(() => {
    if (!selStart) return null;
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    const todayDay = Math.round((t0.getTime() - parseDate(selStart).getTime()) / 86_400_000) + 1;
    const days = isCurrentCycle ? Math.max(cycleLen, todayDay) : cycleLen;
    return cycleAxis(log, new Date(), { start: selStart, days });
  }, [log, selStart, cycleLen, isCurrentCycle]);

  // 顶部标签：第 N 天 / 共 L 天
  const labelDay = isCurrentCycle ? cycAxis?.todayDay ?? 1 : cycleLen;
  const labelTotal = isCurrentCycle ? Math.max(cycleLen, cycAxis?.todayDay ?? 1) : cycleLen;

  // 选定周期覆盖到的自然月（历史周期可能跨 2 个月）
  const cycleMonths = useMemo(() => {
    if (!selStart) return [] as { y: number; m: number }[];
    const s0 = parseDate(selStart);
    const e0 = parseDate(addDays(selStart, Math.max(0, cycleLen - 1)));
    const out: { y: number; m: number }[] = [];
    let cur = new Date(s0.getFullYear(), s0.getMonth(), 1);
    const last = new Date(e0.getFullYear(), e0.getMonth(), 1);
    while (cur.getTime() <= last.getTime()) {
      out.push({ y: cur.getFullYear(), m: cur.getMonth() });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return out;
  }, [selStart, cycleLen]);

  // 历史周期的月相环：把 log 换成该周期的首日与长度，环上圆点即按该周期天数铺开
  const ringLog = useMemo(() => {
    if (!log) return null;
    if (isCurrentCycle || !selStart) return log;
    return { ...log, lastPeriodStart: selStart, cycleLength: cycleLen };
  }, [log, isCurrentCycle, selStart, cycleLen]);

  // 历史周期中央显示的日期区间右端
  const selEndDate = selStart ? parseDate(addDays(selStart, Math.max(0, cycleLen - 1))) : null;

  // ★ 趋势卡数据收敛到「所选周期」窗口（第 1 天 → 第 N 天）
  const estData = useMemo(
    () =>
      buildEstrogenData(
        ring,
        TREND_RANGE,
        cycAxis ? { startMs: cycAxis.startMs, days: cycAxis.days } : null,
      ),
    [ring, cycAxis],
  );
  const progData = useMemo(
    () =>
      buildProgesteroneData(
        ring,
        cycleInfo,
        TREND_RANGE,
        cycAxis ? { startMs: cycAxis.startMs, days: cycAxis.days } : null,
      ),
    [ring, cycleInfo, cycAxis],
  );

  const legendNode = <PhaseLegend />;

  /**
   * ★ 2026-10-07（用户：把「记录 / 修改」按钮放到经期详情页 —— 圆环下面）：
   *   记录入口统一收敛成这一个节点，有记录时挂在月相环 / 网格正下方，
   *   无记录时（还没有环可依附）挂在空态卡上方。
   */
  const recordRowNode = (
    <View style={styles.recordCenter}>
      <Text style={styles.recordHint}>
        {log?.lastPeriodStart ? `上次经期：${log.lastPeriodStart}` : '还没有经期记录'}
      </Text>
      <TouchableOpacity style={styles.recordBtn} activeOpacity={0.7} onPress={openRecord}>
        {/* ★ 2026-10-07（用户：要用之前的渐变颜色）—— 沿用洞察页卡片那枚按钮的 lime→粉 渐变 */}
        <BgGradient
          colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.recordBtnGrad}
        >
          <Text style={styles.recordBtnText}>{log ? '记录 / 修改' : '记录经期'}</Text>
        </BgGradient>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          {/* ★ 2026-10-07（用户：上边一写生理周期、节律） */}
          <Text style={styles.title}>生理周期 · 节律</Text>
          {/* ★ 2026-10-10（用户：去掉顶部「查看详情」开关 → 右上角日历 icon，点击看日历 / 收回月相环） */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowCal((v) => !v)}
            style={[styles.calBtn, showCal && styles.calBtnOn]}
            accessibilityRole="button"
            accessibilityLabel={showCal ? '返回月相环' : '查看日历'}
          >
            <Icon name="calendar" size={theme.fs(20)} color={showCal ? mm.colors.limeMid : mm.colors.ink} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* ★ 2026-10-07（用户：顶部加「周期 / 年」两个 tab；点「年」整页只显示年度内容，否则太乱） */}
        <SegTabs
          value={viewMode}
          options={[
            { key: 'cycle', label: '周期' },
            { key: 'year', label: '年' },
          ]}
          onChange={(k) => setViewMode(k as ViewMode)}
          variant="chip"
        />

        {viewMode === 'year' ? (
          <>
            {/* ★ 年度回顾：按自然年汇总周期与每月经期 / 症状分布 */}
            <CycleYearReviewCard cycleStarts={cycleStarts} periodDays={periodDays} />
          </>
        ) : !hasLog ? (
          <>
            {/* 无记录：还没有月相环可依附，记录入口排在空态卡上方 */}
            {recordRowNode}
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>还没有经期记录</Text>
              <Text style={styles.emptyText}>
                点上方的「记录经期」填写上次经期开始日，这里就会出现按真实周期推算的相位日历。
              </Text>
            </View>
          </>
        ) : (
          <>
            {/* ★ 2026-10-07：顶部「周期切换」—— ‹ 上一个周期 / 下一个周期 ›（对齐 Clue / Flo / Oura） */}
            <View style={styles.cycleSwitch}>
              <TouchableOpacity
                activeOpacity={0.7}
                disabled={!hasPrev}
                onPress={() => setCycleOffset((v) => Math.max(v - 1, -(cycleStarts.length - 1)))}
                style={styles.cycleNav}
                accessibilityRole="button"
                accessibilityLabel="上一个周期"
              >
                <Icon
                  name="chevronLeft"
                  size={theme.fs(18)}
                  color={hasPrev ? mm.colors.ink : theme.colors.textSub}
                  strokeWidth={2.2}
                />
                <Text style={[styles.cycleNavText, !hasPrev && styles.cycleNavTextOff]}>上一个周期</Text>
              </TouchableOpacity>

              <View style={styles.cycleCenter}>
                <Text style={styles.cycleDate}>
                  {selDate ? `${selDate.getMonth() + 1}月${selDate.getDate()}日` : '—'}
                </Text>
                <Text style={styles.cycleDay}>第 {labelDay} 天 / 共 {labelTotal} 天</Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.7}
                disabled={isCurrentCycle}
                onPress={() => setCycleOffset((v) => Math.min(v + 1, 0))}
                style={styles.cycleNav}
                accessibilityRole="button"
                accessibilityLabel="下一个周期"
              >
                <Text style={[styles.cycleNavText, isCurrentCycle && styles.cycleNavTextOff]}>下一个周期</Text>
                <Icon
                  name="chevronRight"
                  size={theme.fs(18)}
                  color={isCurrentCycle ? theme.colors.textSub : mm.colors.ink}
                  strokeWidth={2.2}
                />
              </TouchableOpacity>
            </View>

            {/* 选定周期一律以月相环为主视图（★ 2026-10-07 用户：点「上一个周期」也该显示圆环）；
                「查看日历」切换成该周期所跨自然月的日历网格 */}
            {!showCal ? (
              /* ★ 2026-10-07（用户：去掉圆环中间那个「＋ 记录」）：环心只留相位 / 距经期文字；
                 记录入口统一用环下方那枚「记录 / 修改」渐变按钮。
                 历史周期（cycleInfo 传 null + activeDay = 周期末日）环心改显日期区间与总天数。 */
              <CycleMoonPhase
                cycleInfo={isCurrentCycle ? cycleInfo : null}
                log={ringLog}
                activeDay={isCurrentCycle ? undefined : cycleLen}
                headLabel={
                  !isCurrentCycle && selDate && selEndDate
                    ? `${selDate.getMonth() + 1}月${selDate.getDate()}日 – ${selEndDate.getMonth() + 1}月${selEndDate.getDate()}日`
                    : undefined
                }
                subLabel={isCurrentCycle ? undefined : `共 ${cycleLen} 天`}
              />
            ) : (
              <>
                {legendNode}
                {cycleMonths.map((mo) => (
                  <MonthGrid
                    key={`${mo.y}-${mo.m}`}
                    y={mo.y}
                    m={mo.m}
                    log={log}
                    ring={ring}
                    periodDays={periodDays}
                    onPick={(d) => setSelected(d)}
                  />
                ))}
              </>
            )}

            {/* ★ 2026-10-07（用户要求）：记录 / 修改入口 —— 月相环（或网格）正下方 */}
            {recordRowNode}

            {/* ★ 2026-10-07（用户：圆环与「记录 / 修改」下方加两个 tab）：
                「周期分析」= 周期指标 / 规律性 / 体温双相 / 症状统计；
                「激素节律分析」= 雌激素 + 孕激素 两张趋势图与分析 */}
            <SegTabs
              value={analysisTab}
              options={[
                { key: 'cycle', label: '周期分析' },
                { key: 'hormone', label: '激素节律分析' },
              ]}
              onChange={(k) => setAnalysisTab(k as AnalysisTab)}
              variant="ring"
            />

            {analysisTab === 'cycle' ? (
              <>
                <CycleDerivedMetrics
                  log={log}
                  cycleInfo={cycleInfo}
                  ring={ring}
                  periodDays={periodDays}
                />
                {/* ★ 2026-10-07（用户：「生理周期是否准确？每个生理周期是不准确，还是推迟了？我记得 oura 有」）：
                    周期规律性 + 每个周期的提前/推迟 + 该周期记症状天数 */}
                <CycleRegularityCard cycleStarts={cycleStarts} baseCycleLength={cycleLen} periodDays={periodDays} />
                {/* 体温双相监测卡片：用戒指真实体温画双相趋势（经期低、排卵后升） */}
                <View style={styles.tempCard}>
                  <View style={styles.tempCardHead}>
                    <Text style={styles.tempCardTitle}>体温双相监测</Text>
                  </View>
                  <TempBiphasicChart
                    tempDaily={ring.tempDaily ?? {}}
                    tempHistory={ring.history.temp}
                    log={log}
                    range="month"
                    showHeader={false}
                    cycleStart={selStart}
                    cycleDays={cycAxis?.days}
                  />
                  <TempBiphasicAnalysis ring={ring} cycleInfo={cycleInfo} />
                </View>
                {/* ★ 方案二 / 三（2026-10-07，用户：「这里面生理周期的很多统计呀、症状的一些个比方说统计啊什么的都挺丰富的」）：
                    用本地真实记录做「症状统计」与「症状 × 相位分布」两面板 */}
                {/* ★ 2026-10-09（menstrual-cycle-preview）：症状×相位分布内嵌进「症状统计」的
                    「查看完整症状分布」折叠区（embedded 模式），不再单独成卡 */}
                <SymptomStatsPanel periodDays={periodDays}>
                  <SymptomPhaseMatrix periodDays={periodDays} log={log} ring={ring} embedded />
                </SymptomStatsPanel>
              </>
            ) : (
              <>
                <TrendCard
                  kind="estrogen"
                  title="雌激素波动（HRV·EDA 推算）"
                  lineColor={PHASE_COLOR.ovulation}
                  data={estData}
                  log={log}
                  ring={ring}
                  cycleInfo={cycleInfo}
                  cycleStart={selStart}
                  cycleDays={cycAxis?.days}
                  emptyNote="连续佩戴获取 HRV 与 EDA（皮肤电导）后，这里会显示基于实测信号推算的雌激素相位趋势：HRV 卵泡期较高、EDA 排卵期升高。戒指不直接测量雌激素。"
                  note="基于戒指实测 HRV + EDA（皮肤电导）推算，按所选周期窗口各自归一化后加权（HRV 0.6 / EDA 0.4）。戒指不直接测量雌激素，仅供参考。"
                />
                <TrendCard
                  kind="progesterone"
                  title="孕激素波动（体温推算）"
                  lineColor={mm.colors.purpleCore}
                  data={progData}
                  log={log}
                  ring={ring}
                  cycleInfo={cycleInfo}
                  cycleStart={selStart}
                  cycleDays={cycAxis?.days}
                  emptyNote="连续佩戴获取体温与静息心率后，这里会显示基于实测信号推算的孕激素波动趋势。戒指不直接测量孕酮，排卵后体温/静息心率抬升由孕酮驱动，据此推算。"
                  note="基于戒指实测体温（BBT 双相）与静息心率推算：排卵后孕酮升高会同时推高基础体温与静息心率，据此合成趋势。戒指不直接测量孕酮，仅供参考。"
                />
              </>
            )}

            {/* 方法与依据：页面最底部常显（不随上方两个 tab 切换），透明化各推算信号的开源方法 / 文献出处 */}
            <View style={styles.methodCard}>
              <Text style={styles.methodTitle}>方法与依据</Text>
              <Text style={styles.methodItem}>· 排卵 / 相位：症状体温法 symptothermal（基础体温 BBT 双相）＋ 日历法</Text>
              <Text style={styles.methodItem}>· 孕激素：黄体期基础体温升高（0.3–0.5 °C）＋ 静息心率升高，均为孕酮驱动的实测信号</Text>
              <Text style={styles.methodItem}>· 雌激素：以 HRV（卵泡期较高）＋ EDA 皮肤电导（排卵期升高）推算</Text>
              <Text style={styles.methodFoot}>均为开源成熟方法或已发表研究支持的推算，戒指不直接测量激素，结果不构成医学诊断。</Text>
            </View>
          </>
        )}
      </View>

      {/* 日详情 / 状态编辑 Sheet */}
      <DaySheet
        visible={!!selected}
        dateKey={selected}
        log={log}
        ring={ring}
        periodDays={periodDays}
        onClose={() => setSelected(null)}
        onSave={onSaveDay}
      />

      {/* ★ 2026-10-07：记录 / 修改经期 Sheet —— 内容与洞察页卡片的「记录 / 修改」完全一致
          （PeriodRecordPanel：日期 / 经量 / 疼痛 / 心情 / 身体症状 / 设为本次经期第一天） */}
      <Modal visible={recordOpen} transparent animationType="slide" onRequestClose={() => setRecordOpen(false)}>
        <View style={styles.sheetMask}>
          <View style={[styles.sheet, styles.recordSheet]}>
            <View style={styles.sheetHandle} />
            {/* ★ 2026-10-07（用户：打开近期记录后关不掉、卡住了）：原来这张 Sheet 只能靠底部「保存记录」退出，
                不想保存就无路可走 → 补上标准的右上角关闭按钮。 */}
            <View style={styles.recordSheetHead}>
              <Text style={styles.sheetDate}>经期记录</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setRecordOpen(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <Text style={styles.recordSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.recordSheetBody} showsVerticalScrollIndicator={false}>
              <PeriodRecordPanel
                female={ring.female}
                currentLog={log}
                onSaved={() => {
                  void loadCycleLog().then(setLocalLog);
                  void loadPeriodDays().then(setPeriodDays);
                  setRecordOpen(false);
                }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
    </View>
  );
}

// ── 通用波动趋势卡（真实数据推算：雌激素=HRV / 孕激素=体温+心率）──
function TrendCard({
  kind,
  title,
  lineColor,
  note,
  emptyNote,
  data,
  log,
  ring,
  cycleInfo,
  cycleStart,
  cycleDays,
}: {
  /** 决定卡下方 AI 解读的结论口径 */
  kind: 'estrogen' | 'progesterone';
  title: string;
  lineColor: string;
  note: React.ReactNode;
  emptyNote: React.ReactNode;
  data: { real: { date: string; value: number }[] | null };
  log: CycleLog | null;
  ring: RingState;
  cycleInfo: CycleInfo | null;
  /** ★ 2026-10-07：跟随外层「周期切换」——指定周期首日与天数 */
  cycleStart?: string | null;
  cycleDays?: number;
}) {
  const W = 680;
  const H = 150;
  const PAD = 10;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const pts = data.real;

  const head = (
    <View style={styles.estHead}>
      <Text style={styles.estTitle}>{title}</Text>
    </View>
  );

  // ★ 方案一（2026-10-07，用户：「现在目前是 9 月 8 号到 10 月 7 号。整个图表就会显示在最右边。这个合理吗？
  //   我觉得可以按经期这一天开始算」）：
  //   横轴由「滚动 30 天」改为「周期天锚定」——第 1 天 = 上次经期开始日，长度 N = max(周期长度, 今天所在天)。
  //   相位色带逐日判定并铺满整轴，数据点按「周期第几天」落位（落在轴外的点丢弃），今天画一条虚线标记。
  const winDays = trendDays(TREND_RANGE); // 无周期记录时的回退窗口
  // ★ 2026-10-07：跟随外层「周期切换」——横轴锚定到所选周期首日
  const axis = cycleStart
    ? cycleAxis(log, new Date(), { start: cycleStart, days: cycleDays ?? winDays })
    : cycleAxis(log, new Date());
  const axisStartMs = axis
    ? axis.startMs
    : (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime() - (winDays - 1) * 86_400_000;
      })();
  const axisN = axis ? axis.days : winDays;
  const xAtCd = (cd: number) => PAD + ((cd - 1) / Math.max(1, axisN - 1)) * plotW;
  const cdOfDate = (date: string) => Math.round((parseDate(date).getTime() - axisStartMs) / 86_400_000) + 1;

  // 相位背景带：逐日判相位、同色相邻合并、铺满整轴（无数据也画）
  const bands: { x: number; w: number; color: string }[] = [];
  for (let cd = 1; cd <= axisN; cd++) {
    const color = phaseBand(log ? phaseOfDay(log, new Date(axisStartMs + (cd - 1) * 86_400_000), ring) : 'unknown');
    const x0 = xAtCd(cd);
    const x1 = cd < axisN ? xAtCd(cd + 1) : PAD + plotW;
    const prev = bands[bands.length - 1];
    if (prev && prev.color === color) prev.w += Math.max(0, x1 - x0);
    else bands.push({ x: x0, w: Math.max(0, x1 - x0), color });
  }

  // 数据点按「周期第几天」落位；落在轴外的点丢弃（不硬塞到两端）
  const placed = (pts ?? []).filter((p) => {
    const cd = cdOfDate(p.date);
    return cd >= 1 && cd <= axisN;
  });

  // ★ Y 轴自适应：0–100 的相对指数常只落在很窄一段（如 12–18），
  //   固定 0–100 会让折线贴底、只占图高一点点。
  let yAt = (v: number) => PAD + (1 - v / 100) * plotH;
  const xy: { x: number; y: number; date: string }[] = [];
  if (placed.length > 0) {
    const vals = placed.map((p) => p.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const spanPad = Math.max(4, (hi - lo) * 0.35);
    const yMin = Math.max(0, lo - spanPad);
    const yMax = Math.min(100, hi + spanPad);
    yAt = (v: number) => PAD + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
    for (const p of placed) xy.push({ x: xAtCd(cdOfDate(p.date)), y: yAt(p.value), date: p.date });
  }

  let d = '';
  let area = '';
  if (xy.length > 0) {
    d = `M ${xy[0].x.toFixed(1)} ${xy[0].y.toFixed(1)}`;
    for (let i = 1; i < xy.length; i++) {
      const a = xy[i - 1];
      const b = xy[i];
      const mx = (a.x + b.x) / 2;
      d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    area = `${d} L ${xy[xy.length - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${xy[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`;
  }

  const gradId = `trendGrad${lineColor.replace(/[^a-zA-Z0-9]/g, '')}`;
  // 横轴标签：周期天（第 1 天 → 第 N 天，取 ¼ 分位）
  const axisLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(1 + (axisN - 1) * f));
  const todayCd = axis?.todayDay ?? null;
  const showToday = todayCd != null && todayCd >= 1 && todayCd <= axisN;
  const hasData = xy.length > 0;

  return (
    <View style={styles.estCard}>
      {head}
      {showToday ? (
        <View style={[styles.todayRow, { marginBottom: theme.sp(1) }]}>
          <Text style={styles.todayText}>今天 · 第 {todayCd} 天</Text>
        </View>
      ) : null}
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {bands.map((b, i) => (
          <Rect key={i} x={b.x} y={PAD} width={b.w} height={plotH} fill={b.color} />
        ))}
        {/* 今天 · 第 N 天：虚线标记（方案一） */}
        {showToday ? (
          <Line
            x1={xAtCd(todayCd as number)}
            y1={PAD}
            x2={xAtCd(todayCd as number)}
            y2={PAD + plotH}
            stroke={theme.colors.accentText}
            strokeWidth={1.2}
            strokeDasharray="4 4"
            opacity={0.65}
          />
        ) : null}
        {hasData ? <Path d={area} fill={`url(#${gradId})`} /> : null}
        {hasData ? <Path d={d} fill="none" stroke={lineColor} strokeWidth={2.4} strokeLinecap="round" /> : null}
        {/* ★ 2026-10-07（用户：只有 2 个真实点也要看得见「画出来」）：
            周期初期两个点挤在横轴最左、只连出一小段线段，肉眼几乎看不见；
            每个真实点补一个小圆点，两个点也能明显看到。 */}
        {xy.map((p, i) => (
          <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={2.4} fill={lineColor} />
        ))}
      </Svg>
      <View style={styles.estAxis}>
        {axisLabels.map((cd, i) => (
          <Text key={`${cd}-${i}`} style={styles.estAxisText}>
            第 {cd} 天
          </Text>
        ))}
      </View>
      {/* 四相标记：与体温双相图共用同一套图例，同一相位到处同色 */}
      <PhaseLegend />
      <Text style={styles.estNote}>{hasData ? note : emptyNote}</Text>
      {/* AI 解读：与体温卡下方解读同一视觉语言，结论由本卡同一份真实数据算出 */}
      {hasData ? (
        <TrendAnalysis kind={kind} data={data} cycleInfo={cycleInfo} windowDays={axisN} />
      ) : null}
    </View>
  );
}

// ── 月视图 ──
function MonthGrid({
  y,
  m,
  log,
  ring,
  periodDays,
  onPick,
}: {
  y: number;
  m: number;
  log: CycleLog | null;
  ring: RingState;
  periodDays: Record<string, PeriodDayLog>;
  onPick: (d: string) => void;
}) {
  const first = new Date(y, m, 1);
  const lead = first.getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = dayKey(new Date());
  const info = log ? computeCycle(log, new Date(), { tempSeries: Object.keys(ring.tempDaily ?? {}).length ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] })) : undefined, periodHistory: log.history }) : null;
  const nextPeriodKey = info?.nextPeriodDate ?? null;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));

  return (
    <View style={styles.monthCard}>
      <View style={styles.weekRow}>
        {WEEK.map((w) => (
          <Text key={w} style={styles.weekText}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((dt, i) => {
          if (!dt) return <View key={`b${i}`} style={styles.cell} />;
          const key = dayKey(dt);
          const ph = phaseOfDay(log, dt, ring);
          const isToday = key === todayKey;
          const isNextPeriod = key === nextPeriodKey;
          const logged = periodDays[key];
          const isPeriodDay = ph === 'period' || !!(logged && logged.flow);
          return (
            <TouchableOpacity key={key} activeOpacity={0.7} onPress={() => onPick(key)} style={styles.cell}>
              <View
                style={[
                  styles.dayBox,
                  { backgroundColor: phaseBg(ph, 0.16) },
                  isToday && styles.dayToday,
                  isNextPeriod && styles.dayNextPeriod,
                ]}
              >
                <Text style={[styles.dayNum, { color: ph === 'unknown' ? theme.colors.textSub : PHASE_COLOR[ph] }]}>
                  {dt.getDate()}
                </Text>
                {/* v20.5：粉 deep 标记（已记录经期日） */}
                {isPeriodDay ? <View style={[styles.dayDot, { backgroundColor: mm.colors.roseDeep }]} /> : null}
                {/* v20.5：排卵期标记；标记色比底色深一档，黄绿 core 同色压同色 */}
                {ph === 'ovulation' ? <View style={[styles.dayRing, { borderColor: mm.colors.limeDeep }]} /> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── 日详情 / 状态编辑 Sheet ──
function DaySheet({
  visible,
  dateKey,
  log,
  ring,
  periodDays,
  onClose,
  onSave,
}: {
  visible: boolean;
  dateKey: string | null;
  log: CycleLog | null;
  ring: RingState;
  periodDays: Record<string, PeriodDayLog>;
  onClose: () => void;
  onSave: (e: PeriodDayLog) => void;
}) {
  const [flow, setFlow] = useState<FlowLevel>('');
  const [pain, setPain] = useState<PainLevel>('');

  useEffect(() => {
    if (!dateKey) return;
    const cur = periodDays[dateKey];
    setFlow(cur?.flow ?? '');
    setPain(cur?.pain ?? '');
  }, [dateKey, periodDays]);

  if (!dateKey) return null;
  const dt = parseDate(dateKey);
  const ph = phaseOfDay(log, dt, ring);
  const est = log ? estrogenForDate(log, dt) : null;

  const flows: FlowLevel[] = ['spotting', 'light', 'normal', 'heavy'];
  const pains: PainLevel[] = ['none', 'mild', 'moderate', 'severe'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetMask}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetDate}>{dt.getFullYear()} 年 {dt.getMonth() + 1} 月 {dt.getDate()} 日</Text>
          <View style={styles.sheetPhaseRow}>
            <View style={[styles.sheetPhaseTag, { backgroundColor: phaseBg(ph, 0.2) }]}>
              <Text style={[styles.sheetPhaseText, { color: PHASE_COLOR[ph] }]}>{PHASE_LABEL[ph]}</Text>
            </View>
            {est != null ? (
              <Text style={styles.sheetEst}>预测雌激素指数 {est}</Text>
            ) : null}
          </View>

          <Text style={styles.sheetLabel}>经量</Text>
          <View style={styles.chipRow}>
            {flows.map((f) => (
              <TouchableOpacity key={f} activeOpacity={0.7} onPress={() => setFlow(f === flow ? '' : f)} style={[styles.chip, flow === f && styles.chipOn]}>
                <Text style={[styles.chipText, flow === f && styles.chipTextOn]}>{FLOW_LABEL[f]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sheetLabel}>疼痛程度</Text>
          <View style={styles.chipRow}>
            {pains.map((p) => (
              <TouchableOpacity key={p} activeOpacity={0.7} onPress={() => setPain(p === pain ? '' : p)} style={[styles.chip, pain === p && styles.chipOn]}>
                <Text style={[styles.chipText, pain === p && styles.chipTextOn]}>{PAIN_LABEL[p]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.saveBtn}
            onPress={() => {
              onSave({ date: dateKey, flow, pain });
              onClose();
            }}
          >
            <Text style={styles.saveBtnText}>保存当日状态</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tempCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    marginTop: theme.space.sm,
  },
  tempCardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.space.xs,
  },
  tempCardTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  stack: { gap: theme.space.md },
  // ★ 顶部「周期 / 年」：参考指标页 日 / 周 / 月 / 年 的小胶囊 —— 靠左、字号最小、选中实心主色
  segChipRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  segChipItem: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segChipItemOn: { backgroundColor: theme.colors.accentSolid },
  segChipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textSub,
  },
  segChipTextOn: { color: theme.colors.textWhite },
  // ★ 圆环下方「周期分析 / 激素节律分析」：参考洞察页「昼夜节律 / 生理周期节律」——
  //   等宽平铺、无底色，选中只把描边换成 limeMid（绿），未选保留浅描边
  segRingRow: { flexDirection: 'row', width: '100%', gap: theme.sp(1) },
  segRingItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.sp(3),
    borderRadius: theme.radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
  },
  segRingItemOn: { borderColor: mm.colors.limeMid },
  segRingText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium as any,
    color: mm.colors.inkSoft,
  },
  segRingTextOn: { color: mm.colors.ink, fontWeight: theme.weight.semibold as any },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBg,
    marginRight: theme.space.sm,
  },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: mm.colors.ink, flex: 1 },

  /* ★ 2026-10-07：顶部「周期切换」（‹ 上一个周期 / 下一个周期 ›） */
  cycleSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.sm,
  },
  cycleNav: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5), paddingVertical: theme.sp(1), paddingHorizontal: theme.sp(1) },
  cycleNavText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  cycleNavTextOff: { opacity: 0.4 },
  cycleCenter: { flex: 1, alignItems: 'center' },
  cycleDate: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  cycleDay: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  // ★ 2026-10-10（用户：右上角日历 icon 按钮，替代顶部「查看详情」开关；激活态描边转亮绿）
  calBtn: {
    width: theme.sp(9), height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
    marginLeft: theme.space.sm,
  },
  calBtnOn: { borderColor: mm.colors.limeMid },

  emptyBox: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, padding: theme.space.lg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  emptyTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  emptyText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },

  estCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  estHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) },
  estTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  estNote: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, marginTop: theme.sp(1) },
  estAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(0.5), paddingHorizontal: theme.sp(0.5) },
  estAxisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  /* ★ 方案一：今天虚线标记的文字（右对齐） */
  todayRow: { alignItems: 'flex-start', paddingHorizontal: theme.sp(0.5) },
  todayText: { fontSize: theme.fontSize.micro, color: theme.colors.accentText },
  methodCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    gap: theme.sp(1),
  },
  methodTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  methodItem: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub },
  methodFoot: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, opacity: 0.85 },

  /* ★ 2026-10-07：记录 / 修改入口改为「圆环下方居中 + lime→粉渐变胶囊」（与洞察页原按钮同色） */
  recordCenter: { alignItems: 'center' },
  recordHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.space.xs },
  // 渐变自成胶囊：圆角 + 水平 padding 都落在渐变层上，外层只负责点击区域
  recordBtn: { borderRadius: theme.radius.pill, overflow: 'hidden' },
  recordBtnGrad: { paddingVertical: theme.sp(2), paddingHorizontal: theme.space.lg, borderRadius: theme.radius.pill, alignItems: 'center' },
  recordBtnText: { color: mm.colors.btnTextOnGrad, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  /* ★ 2026-10-07：记录面板复用洞察页那张（内容较高），Sheet 只需封顶高度 + 可滚动 */
  recordSheet: { maxHeight: '88%' },
  recordSheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordSheetClose: { fontSize: theme.fontSize.card, color: theme.colors.textSub, fontWeight: theme.weight.bold as any },
  /* minHeight: 0 + flexShrink: 1 —— 让 ScrollView 在封顶高度的 Sheet 里真正可滚动（不会把底部按钮顶出屏幕） */
  recordSheetBody: { marginTop: theme.space.xs, flexShrink: 1, minHeight: 0 },

  monthCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  weekRow: { flexDirection: 'row', marginBottom: theme.sp(1) },
  weekText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: theme.sp(0.75), aspectRatio: 1 },
  dayBox: { flex: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dayToday: { borderWidth: 2, borderColor: theme.colors.accentSolid }, // v21：本页紫主控（周期语义域）
  dayNextPeriod: { borderWidth: 2, borderColor: theme.colors.textSub, },
  dayNum: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  dayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 2.5 },
  dayRing: { position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: 4, borderWidth: 2 },

  sheetMask: { flex: 1, backgroundColor: theme.colors.ui.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.cardBgStrong, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, padding: theme.space.cardPad, paddingBottom: theme.space.xl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.ui.chipNeutralBg, alignSelf: 'center', marginBottom: theme.space.sm },
  sheetDate: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sheetPhaseRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: theme.space.sm },
  sheetPhaseTag: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.radius.pill },
  sheetPhaseText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  sheetEst: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  sheetLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, marginTop: theme.space.md, marginBottom: 6, fontWeight: theme.weight.semibold as any },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft },
  chipOn: { backgroundColor: mm.colors.purpleBtn },
  chipText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  chipTextOn: { color: theme.colors.textWhite, fontWeight: theme.weight.semibold as any },
  saveBtn: { marginTop: theme.space.lg, alignItems: 'center', paddingVertical: theme.sp(3), borderRadius: theme.radius.md, backgroundColor: mm.colors.purpleBtn },
  saveBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textWhite },
  cancelBtn: { marginTop: theme.sp(2.5), alignItems: 'center', paddingVertical: theme.sp(3) },
  cancelBtnText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
});
