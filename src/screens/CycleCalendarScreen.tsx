/**
 * CycleCalendarScreen —— 周期日历（洞察「周期和激素」tab → 点经期卡片进入）
 *
 * 设计约束（与全局 design token 一致）：
 * 页面结构（★ 对齐其他数据详情页）：
 *   返回 + 标题 → 记录经期入口
 *   → **RangeSwitch（仅 月/年）→ DateAnchorPicker（◀ 日期 ▶ 顶部锚点选择器）**（最上面）
 *   → 按锚点分流：**本月 = 月相环**；**历史/其他月 = 日历网格**；年 = 年度网格
 *   → 派生指标 → 体温双相监测 → 激素趋势卡 → 方法与依据。
 *  网格以顶部锚点日期为基准；网格内部不再自带导航（避免与顶部选择器重复）。
 *
 *  - 顶部返回 + 标题；月/年切换走 `<RangeSwitch exclude={['day','week']} />`。
 *  - 月视图：30/31 天网格，每个格子按「真实记录推算的相位」着色
 *    （经期/卵泡期/排卵期/黄体期），并标记：已记录经期日（实心点）、
 *    排卵期窗口（青绿描边）、预测下次经期首日（虚线环）。
 *  - 年视图：12 个紧凑月历纵向排列，同样按相位着色，一眼看全年节律。
 *  - 三张真实数据趋势卡，**统一固定为近 30 天（月）**，各自不再带时间切换（时间由顶部选择器承担）：
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
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { RingBle, type RingState } from '../ble/RingBleManager';
import {
  computeCycle,
  estrogenAt,
  estrogenForDate,
  parseDate,
  dayKey,
  addDays,
  tempDailyToSeries,
  type CycleLog,
  type CyclePhase,
  type CycleInfo,
} from '../lib/cycleMath';
import { phaseOfDay, buildEstrogenData, buildProgesteroneData, trendDays, type TrendRange } from '../lib/hormoneTrend';
import { loadCycleLog, loadPeriodDays, savePeriodDay, saveCycleLog, FLOW_LABEL, PAIN_LABEL, type FlowLevel, type PainLevel, type PeriodDayLog } from '../data/cycleLog';
import { PHASE_COLOR, PHASE_LABEL, phaseBg, phaseBand } from '../lib/phaseColors';
import CycleMoonPhase from '../components/CycleMoonPhase';
import CycleDerivedMetrics from '../components/CycleDerivedMetrics';
import TempBiphasicChart from '../components/TempBiphasicChart';
import TempBiphasicAnalysis from '../components/TempBiphasicAnalysis';
import TrendAnalysis from '../components/TrendAnalysis';
import PhaseLegend from '../components/PhaseLegend';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 三个趋势图（体温/雌激素/孕激素）统一固定为「月」；月份/年份切换由顶部 RangeSwitch + DateAnchorPicker 承担 */
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
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [localLog, setLocalLog] = useState<CycleLog | null>(null);
  const [periodDays, setPeriodDays] = useState<Record<string, PeriodDayLog>>({});
  const [view, setView] = useState<'month' | 'year'>('month');
  // 日期锚点：由顶部 DateAnchorPicker 控制，月/年网格都以此为基准（对齐其他详情页）
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recDate, setRecDate] = useState('');
  const [recCycleLen, setRecCycleLen] = useState(28);

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);
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

  // ── 记录 / 修改经期（上次经期开始日 + 周期长度）──
  const recordDays = useMemo(() => {
    const t = new Date();
    const out: { key: string; label: string }[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(t);
      d.setDate(d.getDate() - i);
      out.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
    return out;
  }, []);

  const openRecord = () => {
    setRecDate(log?.lastPeriodStart ?? dayKey(new Date()));
    setRecCycleLen(Math.round(log?.cycleLength ?? 28));
    setRecordOpen(true);
  };

  const onSaveRecord = async () => {
    const next: CycleLog = {
      lastPeriodStart: recDate,
      cycleLength: Math.max(20, Math.min(45, Math.round(recCycleLen))),
      lutealLength: log?.lutealLength ?? 14,
      periodLength: log?.periodLength ?? 5,
    };
    await saveCycleLog(next);
    setLocalLog(next);
    setRecordOpen(false);
    void RingBle.refreshLocalCycle();
    try {
      await RingBle.writeFemale(recDate, next.cycleLength, next.periodLength);
    } catch {
      /* 戒指未写入：本地已存，不阻塞 */
    }
  };

  const estData = useMemo(() => buildEstrogenData(ring, TREND_RANGE), [ring]);

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

  const progData = useMemo(() => buildProgesteroneData(ring, cycleInfo, TREND_RANGE), [ring, cycleInfo]);

  // 顶部锚点是否落在「当月」：当月展示月相环，历史/其他月展示日历网格
  const nowRef = new Date();
  const isCurrentMonth =
    anchor.getFullYear() === nowRef.getFullYear() && anchor.getMonth() === nowRef.getMonth();

  const legendNode = <PhaseLegend />;

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.title}>周期日历</Text>
        </View>

        {/* 记录经期入口 */}
        <View style={styles.recordRow}>
          <Text style={styles.recordHint}>
            {log?.lastPeriodStart ? `上次经期：${log.lastPeriodStart}` : '还没有经期记录'}
          </Text>
          <TouchableOpacity style={styles.recordBtn} activeOpacity={0.85} onPress={openRecord}>
            <Text style={styles.recordBtnText}>{log ? '修改经期记录' : '记录经期'}</Text>
          </TouchableOpacity>
        </View>

        {!hasLog ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>还没有经期记录</Text>
            <Text style={styles.emptyText}>
              点上方的「记录经期」填写上次经期开始日，这里就会出现按真实周期推算的相位日历。
            </Text>
          </View>
        ) : (
          <>
            {/* 范围（仅 月/年）+ 日期锚点选择器——最上面（对齐其他数据详情页） */}
            <RangeSwitch
              value={view}
              onChange={(r) => setView(r === 'year' ? 'year' : 'month')}
              exclude={['day', 'week']}
            />
            <DateAnchorPicker value={anchor} onChange={setAnchor} range={view} />

            {/* 按锚点分流：本月 → 月相环；历史/其他月 → 日历网格；年 → 年度网格 */}
            {view === 'year' ? (
              <>
                {legendNode}
                <YearGrid
                  log={log}
                  ring={ring}
                  periodDays={periodDays}
                  year={anchor.getFullYear()}
                  onPick={(d) => setSelected(d)}
                />
              </>
            ) : isCurrentMonth ? (
              /* 当月：月相视图（深色星空 + 中央月相 + 外围月相环；点「记录今天」打开当日 Sheet） */
              <CycleMoonPhase
                cycleInfo={cycleInfo}
                log={log}
                onLogToday={() => setSelected(dayKey(new Date()))}
              />
            ) : (
              <>
                {legendNode}
                <MonthGrid
                  y={anchor.getFullYear()}
                  m={anchor.getMonth()}
                  log={log}
                  ring={ring}
                  periodDays={periodDays}
                  onPick={(d) => setSelected(d)}
                />
              </>
            )}

            <CycleDerivedMetrics
              log={log}
              cycleInfo={cycleInfo}
              ring={ring}
              periodDays={periodDays}
            />
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
              />
              <TempBiphasicAnalysis ring={ring} cycleInfo={cycleInfo} />
            </View>
            <TrendCard
              kind="estrogen"
              title="雌激素波动（HRV·EDA 推算）"
              lineColor={PHASE_COLOR.ovulation}
              data={estData}
              log={log}
              ring={ring}
              cycleInfo={cycleInfo}
              emptyNote="连续佩戴获取 HRV 与 EDA（皮肤电导）后，这里会显示基于实测信号推算的雌激素相位趋势：HRV 卵泡期较高、EDA 排卵期升高。戒指不直接测量雌激素。"
              note="基于戒指实测 HRV + EDA（皮肤电导）推算，按近 30 天各自归一化后加权（HRV 0.6 / EDA 0.4）。戒指不直接测量雌激素，仅供参考。"
            />
            <TrendCard
              kind="progesterone"
              title="孕激素波动（体温推算）"
              lineColor={theme.colors.accentSolid}
              data={progData}
              log={log}
              ring={ring}
              cycleInfo={cycleInfo}
              emptyNote="连续佩戴获取体温与静息心率后，这里会显示基于实测信号推算的孕激素波动趋势。戒指不直接测量孕酮，排卵后体温/静息心率抬升由孕酮驱动，据此推算。"
              note="基于戒指实测体温（BBT 双相）与静息心率推算：排卵后孕酮升高会同时推高基础体温与静息心率，据此合成趋势。戒指不直接测量孕酮，仅供参考。"
            />

            {/* 方法与依据：透明化各推算信号的开源方法/文献出处 */}
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

      {/* 记录 / 修改经期 Sheet（选上次经期开始日 + 周期长度） */}
      <Modal visible={recordOpen} transparent animationType="slide" onRequestClose={() => setRecordOpen(false)}>
        <View style={styles.sheetMask}>
          <View style={styles.sheet}>
            <Text style={styles.sheetDate}>记录上次经期开始日</Text>
            <Text style={styles.recHint}>用于推算周期与排卵期；保存后立即生效，并尝试写入戒指。</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.recScroll}
              contentContainerStyle={styles.recScrollContent}
            >
              {recordDays.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  activeOpacity={0.7}
                  onPress={() => setRecDate(c.key)}
                  style={[styles.chip, recDate === c.key && styles.chipOn]}
                >
                  <Text style={[styles.chipText, recDate === c.key && styles.chipTextOn]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.recStepperRow}>
              <Text style={styles.recStepperLabel}>月经周期长度</Text>
              <View style={styles.recStepper}>
                <TouchableOpacity style={styles.recStepBtn} activeOpacity={0.7} onPress={() => setRecCycleLen((v) => Math.max(20, v - 1))}>
                  <Text style={styles.recStepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.recStepValue}>{recCycleLen} 天</Text>
                <TouchableOpacity style={styles.recStepBtn} activeOpacity={0.7} onPress={() => setRecCycleLen((v) => Math.min(45, v + 1))}>
                  <Text style={styles.recStepBtnText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.recActions}>
              <TouchableOpacity style={styles.recCancelBtn} activeOpacity={0.7} onPress={() => setRecordOpen(false)}>
                <Text style={styles.recCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.recSaveBtn} activeOpacity={0.85} onPress={onSaveRecord}>
                <Text style={styles.recSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
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
}) {
  const W = 680;
  const H = 150;
  const PAD = 10;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const yAt = (v: number) => PAD + (1 - v / 100) * plotH;
  const pts = data.real;

  const head = (
    <View style={styles.estHead}>
      <Text style={styles.estTitle}>{title}</Text>
    </View>
  );

  if (!pts || pts.length === 0) {
    return (
      <View style={styles.estCard}>
        {head}
        <Text style={styles.estNote}>{emptyNote}</Text>
      </View>
    );
  }

  const n = pts.length;
  // 时间轴：横轴固定为所选窗口 [今天-(winDays-1), 今天]，按真实日期定位（不再按数据点等距）
  const winDays = trendDays(TREND_RANGE);
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const winEndMs = today0.getTime();
  const winStartMs = winEndMs - (winDays - 1) * 86_400_000;
  const xAtMs = (ms: number) => {
    const t = (ms - winStartMs) / (winEndMs - winStartMs || 1);
    return PAD + Math.max(0, Math.min(1, t)) * plotW;
  };
  const xy = pts.map((p) => ({ x: xAtMs(parseDate(p.date).getTime()), y: yAt(p.value), date: p.date }));

  let d = `M ${xy[0].x.toFixed(1)} ${xy[0].y.toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const a = xy[i - 1];
    const b = xy[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const area = `${d} L ${xy[n - 1].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${xy[0].x.toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`;

  // 相位背景带：按真实日期判相位（复用页面已有 phaseOfDay），范围限于有数据的区段
  const bands = xy.map((p, i) => {
    const phase = log ? phaseOfDay(log, parseDate(p.date), ring) : 'unknown';
    const x0 = i === 0 ? xy[0].x : (xy[i - 1].x + p.x) / 2;
    const x1 = i === n - 1 ? xy[n - 1].x : (p.x + xy[i + 1].x) / 2;
    return { x: x0, w: Math.max(0, x1 - x0), color: phaseBand(phase) };
  });

  const fmtMs = (ms: number) => {
    const dt = new Date(ms);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const winMidMs = winStartMs + ((winDays - 1) * 86_400_000) / 2;
  const gradId = `trendGrad${lineColor.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View style={styles.estCard}>
      {head}
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
        <Path d={area} fill={`url(#${gradId})`} />
        <Path d={d} fill="none" stroke={lineColor} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
      <View style={styles.estAxis}>
        <Text style={styles.estAxisText}>{fmtMs(winStartMs)}</Text>
        <Text style={styles.estAxisText}>{fmtMs(winMidMs)}</Text>
        <Text style={styles.estAxisText}>{fmtMs(winEndMs)}</Text>
      </View>
      {/* 四相标记：与体温双相图共用同一套图例，同一相位到处同色 */}
      <PhaseLegend />
      <Text style={styles.estNote}>{note}</Text>
      {/* AI 解读：与体温卡下方解读同一视觉语言，结论由本卡同一份真实数据算出 */}
      <TrendAnalysis kind={kind} data={data} cycleInfo={cycleInfo} windowDays={winDays} />
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
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => onPick(key)} style={styles.cell}>
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
                {isPeriodDay ? <View style={[styles.dayDot, { backgroundColor: PHASE_COLOR.period }]} /> : null}
                {ph === 'ovulation' ? <View style={[styles.dayRing, { borderColor: PHASE_COLOR.ovulation }]} /> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── 年视图：12 个紧凑月历 ──
function YearGrid({
  log,
  ring,
  periodDays,
  year,
  onPick,
}: {
  log: CycleLog | null;
  ring: RingState;
  periodDays: Record<string, PeriodDayLog>;
  year: number;
  onPick: (d: string) => void;
}) {
  return (
    <ScrollView style={styles.yearScroll} showsVerticalScrollIndicator={false}>
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth key={m} y={year} m={m} log={log} ring={ring} periodDays={periodDays} onPick={onPick} />
      ))}
    </ScrollView>
  );
}

function MiniMonth({
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
  const lead = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
  return (
    <View style={styles.miniCard}>
      <Text style={styles.miniTitle}>{m + 1} 月</Text>
      <View style={styles.miniWeekRow}>
        {WEEK.map((w) => (
          <Text key={w} style={styles.miniWeekText}>{w}</Text>
        ))}
      </View>
      <View style={styles.miniGrid}>
        {cells.map((dt, i) => {
          if (!dt) return <View key={`b${i}`} style={styles.miniCell} />;
          const key = dayKey(dt);
          const ph = phaseOfDay(log, dt, ring);
          const logged = periodDays[key];
          const isPeriodDay = ph === 'period' || !!(logged && logged.flow);
          return (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => onPick(key)} style={styles.miniCell}>
              <View style={[styles.miniDay, { backgroundColor: phaseBg(ph, 0.16) }]}>
                <Text style={[styles.miniNum, { color: ph === 'unknown' ? theme.colors.textSub : PHASE_COLOR[ph] }]}>
                  {dt.getDate()}
                </Text>
                {isPeriodDay ? <View style={[styles.miniDot, { backgroundColor: PHASE_COLOR.period }]} /> : null}
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
            activeOpacity={0.8}
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
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: theme.colors.textTitle, flex: 1 },

  emptyBox: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, padding: theme.space.lg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  emptyTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  emptyText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },

  estCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  estHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) },
  estTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  estNote: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, marginTop: theme.sp(1) },
  estAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(0.5), paddingHorizontal: theme.sp(0.5) },
  estAxisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
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

  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm },
  recordHint: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  recordBtn: { backgroundColor: theme.colors.accentSoft, paddingHorizontal: theme.space.md, paddingVertical: theme.sp(2), borderRadius: theme.radius.pill },
  recordBtnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.accentSolid },
  recHint: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1), marginBottom: theme.space.xs },
  recScroll: { marginTop: theme.space.xs, maxHeight: theme.sp(13) },
  recScrollContent: { gap: theme.space.xs },
  recStepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.md },
  recStepperLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle },
  recStepper: { flexDirection: 'row', alignItems: 'center' },
  recStepBtn: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.sp(4.5), backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  recStepBtnText: { fontSize: theme.fontSize.card, color: theme.colors.accentSolid, fontWeight: theme.weight.bold as any },
  recStepValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginHorizontal: theme.space.md, minWidth: theme.sp(12), textAlign: 'center' },
  recActions: { flexDirection: 'row', marginTop: theme.space.lg, gap: theme.space.sm },
  recCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(3), borderRadius: theme.radius.md, backgroundColor: theme.colors.ui.offTrack },
  recSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(3), borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSolid },
  recCancelText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  recSaveText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textWhite },

  monthCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  weekRow: { flexDirection: 'row', marginBottom: theme.sp(1) },
  weekText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: theme.sp(0.75), aspectRatio: 1 },
  dayBox: { flex: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dayToday: { borderWidth: 2, borderColor: theme.colors.accentSolid },
  dayNextPeriod: { borderWidth: 2, borderColor: theme.colors.textSub, borderStyle: 'dashed' },
  dayNum: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  dayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 2.5 },
  dayRing: { position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: 4, borderWidth: 2 },

  yearScroll: { maxHeight: 520 },
  miniCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm, marginBottom: theme.space.sm },
  miniTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  miniWeekRow: { flexDirection: 'row', marginBottom: theme.sp(0.5) },
  miniWeekText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { width: `${100 / 7}%`, padding: theme.sp(0.5), aspectRatio: 1 },
  miniDay: { flex: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  miniNum: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any },
  miniDot: { position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: 1.5 },

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
  chipOn: { backgroundColor: theme.colors.accentSolid },
  chipText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  chipTextOn: { color: theme.colors.textWhite, fontWeight: theme.weight.semibold as any },
  saveBtn: { marginTop: theme.space.lg, alignItems: 'center', paddingVertical: theme.sp(3), borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSolid },
  saveBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textWhite },
  cancelBtn: { marginTop: theme.sp(2.5), alignItems: 'center', paddingVertical: theme.sp(3) },
  cancelBtnText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
});
