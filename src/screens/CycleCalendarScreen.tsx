/**
 * CycleCalendarScreen —— 周期日历（洞察「周期和激素」tab → 点经期卡片进入）
 *
 * 设计约束（与全局 design token 一致）：
 *  - 顶部返回 + 标题；月/年切换（复用 RangeSwitch 思路，本屏仅 月/年）。
 *  - 月视图：30/31 天网格，每个格子按「真实记录推算的相位」着色
 *    （经期/卵泡期/排卵期/黄体期），并标记：已记录经期日（实心点）、
 *    排卵期窗口（青绿描边）、预测下次经期首日（虚线环）。
 *  - 年视图：12 个紧凑月历纵向排列，同样按相位着色，一眼看全年节律。
 *  - 顶部「雌激素波动（预测）」折线：基于用户真实经期记录建模（非实测），
 *    明确标注「建模·预测」，作为经期预测的一部分回答「能否算出雌激素趋势」。
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
  modelEstrogenCurve,
  estrogenAt,
  estrogenForDate,
  parseDate,
  dayKey,
  addDays,
  type CycleLog,
  type CyclePhase,
} from '../lib/cycleMath';
import { loadCycleLog, loadPeriodDays, savePeriodDay, FLOW_LABEL, PAIN_LABEL, type FlowLevel, type PainLevel, type PeriodDayLog } from '../data/cycleLog';
import { PHASE_COLOR, PHASE_LABEL, phaseBg, type PhaseKey } from '../lib/phaseColors';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

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

/** 取某日期的相位（带体温确认覆盖的 computeCycle） */
function phaseOfDay(log: CycleLog | null, date: Date, ring: RingState): CyclePhase | 'unknown' {
  if (!log || !log.lastPeriodStart) return 'unknown';
  const info = computeCycle(log, date, {
    tempSeries: Object.keys(ring.tempDaily ?? {}).length
      ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] }))
      : undefined,
    periodHistory: log.history,
  });
  return info.phase;
}

function buildEstrogenHeader(log: CycleLog | null, ring: RingState) {
  if (!log) return null;
  const info = computeCycle(log, new Date(), {
    tempSeries: Object.keys(ring.tempDaily ?? {}).length
      ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] }))
      : undefined,
    periodHistory: log.history,
  });
  // 用真实排卵日推算「周期第几天排卵」，作为雌激素建模曲线的峰值位置
  const ovDayIdx = info.ovulationDate
    ? Math.round((parseDate(info.ovulationDate).getTime() - parseDate(log.lastPeriodStart).getTime()) / 86_400_000) + 1
    : Math.max(8, Math.min(45, log.cycleLength - (log.lutealLength || 14)));
  const curve = modelEstrogenCurve({ cycleLength: log.cycleLength, ovulationDay: ovDayIdx, periodLength: log.periodLength || 5 });
  return curve;
}

export default function CycleCalendarScreen() {
  const navigation = useNavigation<any>();
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [localLog, setLocalLog] = useState<CycleLog | null>(null);
  const [periodDays, setPeriodDays] = useState<Record<string, PeriodDayLog>>({});
  const [view, setView] = useState<'month' | 'year'>('month');
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);

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

  const estCurve = useMemo(() => buildEstrogenHeader(log, ring), [log, ring.tempDaily]);

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.title}>周期日历</Text>
          <View style={styles.toggle}>
            {(['month', 'year'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                activeOpacity={0.7}
                onPress={() => setView(v)}
                style={[styles.toggleBtn, view === v && styles.toggleBtnOn]}
              >
                <Text style={[styles.toggleText, view === v && styles.toggleTextOn]}>{v === 'month' ? '月' : '年'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {!hasLog ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>还没有经期记录</Text>
            <Text style={styles.emptyText}>
              在「周期和激素」页点「记录经期」填写上次经期开始日，这里就会出现按真实周期推算的相位日历。
            </Text>
          </View>
        ) : (
          <>
            {/* 雌激素波动预测（建模） */}
            {estCurve ? <EstrogenTrend curve={estCurve} /> : null}

            {/* 图例 */}
            <View style={styles.legend}>
              {(['period', 'follicular', 'ovulation', 'luteal'] as PhaseKey[]).map((p) => (
                <View key={p} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: PHASE_COLOR[p] }]} />
                  <Text style={styles.legendText}>{PHASE_LABEL[p]}</Text>
                </View>
              ))}
            </View>

            {view === 'month' ? (
              <MonthGrid
                y={cursor.y}
                m={cursor.m}
                log={log}
                ring={ring}
                periodDays={periodDays}
                onPrev={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}
                onNext={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}
                onPick={(d) => setSelected(d)}
              />
            ) : (
              <YearGrid log={log} ring={ring} periodDays={periodDays} year={cursor.y} onPick={(d) => setSelected(d)} />
            )}
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
    </ScreenContainer>
  );
}

// ── 雌激素波动预测折线（顶部）──
function EstrogenTrend({ curve }: { curve: ReturnType<typeof modelEstrogenCurve> }) {
  const W = 680;
  const H = 150;
  const PAD = 10;
  const n = curve.length;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const xAt = (i: number) => PAD + (i / (n - 1)) * plotW;
  const yAt = (v: number) => PAD + (1 - v / 100) * plotH;
  let d = `M ${xAt(0).toFixed(1)} ${yAt(curve[0].value).toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const a = { x: xAt(i - 1), y: yAt(curve[i - 1].value) };
    const b = { x: xAt(i), y: yAt(curve[i].value) };
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const area = `${d} L ${xAt(n - 1).toFixed(1)} ${(PAD + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(PAD + plotH).toFixed(1)} Z`;
  return (
    <View style={styles.estCard}>
      <View style={styles.estHead}>
        <Text style={styles.estTitle}>雌激素波动（预测）</Text>
        <Text style={styles.estBadge}>建模 · 非实测</Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="est_grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={PHASE_COLOR.ovulation} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={PHASE_COLOR.ovulation} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#est_grad)" />
        <Path d={d} fill="none" stroke={PHASE_COLOR.ovulation} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
      <Text style={styles.estNote}>基于你的真实经期记录建模（周期 {curve.length} 天），用于理解身体阶段，戒指硬件不直接测量雌激素。</Text>
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
  onPrev,
  onNext,
  onPick,
}: {
  y: number;
  m: number;
  log: CycleLog | null;
  ring: RingState;
  periodDays: Record<string, PeriodDayLog>;
  onPrev: () => void;
  onNext: () => void;
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
      <View style={styles.monthNav}>
        <TouchableOpacity activeOpacity={0.7} onPress={onPrev} style={styles.navBtn}>
          <Icon name="chevronLeft" size={theme.fs(20)} color={theme.colors.textSub} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{y} 年 {m + 1} 月</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={onNext} style={styles.navBtn}>
          <Icon name="chevronRight" size={theme.fs(20)} color={theme.colors.textSub} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
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
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.sm,
  },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: theme.colors.textTitle, flex: 1 },
  toggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: theme.radius.pill, padding: 3 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: theme.radius.pill },
  toggleBtnOn: { backgroundColor: theme.colors.accentSolid },
  toggleText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  toggleTextOn: { color: '#fff', fontWeight: theme.weight.semibold as any },

  emptyBox: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, padding: theme.space.lg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  emptyTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, marginBottom: 6 },
  emptyText: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },

  estCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  estHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  estTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  estBadge: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, backgroundColor: 'rgba(138,138,168,0.16)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  estNote: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, marginTop: 4 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  monthCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space.sm },
  navBtn: { padding: 6 },
  monthTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 3, aspectRatio: 1 },
  dayBox: { flex: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dayToday: { borderWidth: 2, borderColor: theme.colors.accentSolid },
  dayNextPeriod: { borderWidth: 2, borderColor: theme.colors.textSub, borderStyle: 'dashed' },
  dayNum: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  dayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 2.5 },
  dayRing: { position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: 4, borderWidth: 2 },

  yearScroll: { maxHeight: 520 },
  miniCard: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.space.sm, marginBottom: theme.space.sm },
  miniTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: 4 },
  miniWeekRow: { flexDirection: 'row', marginBottom: 2 },
  miniWeekText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { width: `${100 / 7}%`, padding: 2, aspectRatio: 1 },
  miniDay: { flex: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  miniNum: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any },
  miniDot: { position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: 1.5 },

  sheetMask: { flex: 1, backgroundColor: theme.colors.ui.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.cardBgStrong, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, padding: theme.space.cardPad, paddingBottom: theme.space.xl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(138,138,168,0.4)', alignSelf: 'center', marginBottom: theme.space.sm },
  sheetDate: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sheetPhaseRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: theme.space.sm },
  sheetPhaseTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  sheetPhaseText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
  sheetEst: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  sheetLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, marginTop: theme.space.md, marginBottom: 6, fontWeight: theme.weight.semibold as any },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: 'rgba(124,106,224,0.10)' },
  chipOn: { backgroundColor: theme.colors.accentSolid },
  chipText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  chipTextOn: { color: '#fff', fontWeight: theme.weight.semibold as any },
  saveBtn: { marginTop: theme.space.lg, alignItems: 'center', paddingVertical: 13, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSolid },
  saveBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: '#fff' },
  cancelBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
});
