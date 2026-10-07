/**
 * SleepAnalysisCard —— 日视图「睡眠分析」可折叠卡
 *
 * 对齐 preview/sleep-rhythm.html v9 原型：
 *   ① 折叠头「睡眠分析」+ 副标题（入睡 · 起床时刻）—— 点按整行展开/收起；
 *   ② 展开态：总睡眠时长（大字）→ 整夜分期图（下沉 4 泳道，复用 SleepStageChart）
 *      → 四比例网格（深睡/浅睡/REM/效率）→ 时机与规律 → 睡眠生理信号。
 *   ③ 「睡眠生理信号」是**嵌套子折叠**，**默认收起**（唯一收起项），
 *      其余内容默认展开。
 *
 * 数据全部来自真实归档（sleepDaily / sleepStagesDaily / hrvDaily / hrDaily /
 * spo2Daily / tempDaily / rrDaily），缺口显「—」，不插值不编造。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import SleepStageChart from './SleepStageChart';
import type { SleepSegment } from '../ble/RingBleManager';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface DaySleepAnalysis {
  /** 昨夜入睡 / 起床（"HH:mm"） */
  sleepTime?: string | null;
  wakeTime?: string | null;
  /** 分钟 */
  total: number;
  deep: number;
  light: number;
  rem: number;
  /** 卧床期间清醒+失眠分钟（用于效率） */
  awakeMin?: number | null;
  /** 起夜次数 */
  getUp?: number | null;
}

export interface DayPhys {
  /** 睡眠静息心率 bpm */
  hr?: number | null;
  /** 夜间 HRV（RMSSD）ms */
  hrv?: number | null;
  /** 体温偏离 ℃ */
  tempDelta?: number | null;
  /** 呼吸率 /min */
  rr?: number | null;
  /** 夜间血氧 % */
  spo2?: number | null;
  /** 恢复指数 bpm/h */
  recoveryIdx?: number | null;
}

interface Props {
  day: DaySleepAnalysis | null;
  /** 该日分期段（无数据时为 null → 显占位） */
  segments: SleepSegment[] | null;
  phys: DayPhys;
}

export default function SleepAnalysisCard({ day, segments, phys }: Props) {
  const [open, setOpen] = useState(true);
  const [physOpen, setPhysOpen] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };
  const togglePhys = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPhysOpen((v) => !v);
  };

  const total = day?.total ?? 0;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : null);
  const deepP = pct(day?.deep ?? 0);
  const lightP = pct(day?.light ?? 0);
  const remP = pct(day?.rem ?? 0);
  const bedMin = parseHM(day?.sleepTime);
  const wakeMin = parseHM(day?.wakeTime);
  const effPct = total > 0 && day?.awakeMin != null
    ? Math.round(((total - day.awakeMin) / total) * 100)
    : null;

  return (
    <View style={styles.card}>
      {/* ── 折叠头 ── */}
      <Pressable onPress={toggle} style={styles.head} accessibilityRole="button"
        accessibilityLabel={open ? '收起睡眠分析' : '展开睡眠分析'}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>睡眠分析</Text>
          <Text style={styles.sub}>
            {day?.sleepTime && day?.wakeTime ? `昨夜 ${day.sleepTime} 入睡 · ${day.wakeTime} 起床` : '昨夜入睡 / 起床时刻暂无'}
          </Text>
        </View>
        <View style={[styles.chev, open && styles.chevOpen]}>
          <Icon name="chevronRight" size={18} color={theme.colors.accentText} />
        </View>
      </Pressable>

      {open ? (
        <View>
          {/* ① 总时长（大字） */}
          <View style={styles.durRow}>
            {total > 0 ? (
              <>
                <Text style={styles.dur}>{fmtDurCn(total)}</Text>
                <Text style={styles.durUnit}>总睡眠</Text>
                <Text style={styles.durNote}>
                  {effPct != null ? `效率 ${effPct}%` : '效率暂无'}
                  {day?.getUp != null ? ` · 起夜 ${day.getUp} 次` : ''}
                </Text>
              </>
            ) : (
              <Text style={styles.durNone}>昨夜睡眠时长暂无</Text>
            )}
          </View>

          {/* ② 整夜分期图（置于时长之下） */}
          <Text style={styles.blockTitle}>整夜分期</Text>
          {segments && segments.length > 0 ? (
            <SleepStageChart
              segments={segments}
              sleepTime={day?.sleepTime ?? null}
              totalMinutes={total > 0 ? total : null}
            />
          ) : (
            /* ★ 2026-10-06（用户反馈）：日无数据时不要「完全空白」，给一张**灰色分期图占位**——
               4 条泳道（深睡/浅睡/REM/清醒）以极淡的同色画出，让用户看到「分期图的样子」而非一片空。
               不编造任何数值或分段。 */
            <View style={styles.emptyStage}>
              <View style={styles.emptyLane}><View style={[styles.emptyLaneBar, { backgroundColor: mm.colors.purpleCore }]} /></View>
              <View style={styles.emptyLane}><View style={[styles.emptyLaneBar, { backgroundColor: mm.colors.purpleMid }]} /></View>
              <View style={styles.emptyLane}><View style={[styles.emptyLaneBar, { backgroundColor: mm.colors.skyCore }]} /></View>
              <View style={styles.emptyLane}><View style={[styles.emptyLaneBar, { backgroundColor: mm.colors.honeyCore }]} /></View>
            </View>
          )}
          <View style={styles.legend}>
            <LegendItem color={mm.colors.purpleCore} label="深睡" />
            <LegendItem color={mm.colors.purpleMid} label="浅睡" />
            <LegendItem color={mm.colors.skyCore} label="REM" />
            <LegendItem color={mm.colors.honeyCore} label="清醒" />
          </View>
          {!(segments && segments.length > 0) ? (
            <Text style={styles.empty}>
              昨夜睡眠分期暂未同步。将戒指连接 App 后，后台会自动回填历史睡眠分期。
            </Text>
          ) : null}

          {/* ③ 睡眠结构 —— 一行式比例条（深睡/浅睡/REM 堆叠）+ 下方行式明细
              ★ 不再并排四个数字格：那类「2×2 数字罗列」信息密度低、彼此无比较关系。 */}
          {deepP != null ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>睡眠结构</Text>
              <View style={styles.propBar}>
                <PropSeg w={deepP} color={mm.colors.purpleCore} />
                <PropSeg w={lightP ?? 0} color={mm.colors.purpleMid} />
                <PropSeg w={remP ?? 0} color={mm.colors.skyCore} />
              </View>
              <View style={styles.propLegend}>
                <PropKey color={mm.colors.purpleCore} k="深睡" v={deepP} />
                <PropKey color={mm.colors.purpleMid} k="浅睡" v={lightP} />
                <PropKey color={mm.colors.skyCore} k="REM" v={remP} />
              </View>
            </View>
          ) : null}

          {/* ④ 作息与时机 —— 行式列表（标签左 · 数值右） */}
          <View style={styles.block}>
            <Text style={styles.groupTitle}>作息与时机</Text>
            <Row name="睡眠效率" value={effPct != null ? `${effPct}%` : '—'} />
            <Divider />
            <Row name="入睡时刻" value={day?.sleepTime ?? '—'} />
            <Divider />
            <Row name="起床时刻" value={day?.wakeTime ?? (wakeMin != null ? fmtClock(wakeMin) : '—')} />
            <Divider />
            <Row name="夜间清醒" value={day?.getUp != null ? `${day.getUp} 次` : '—'} />
          </View>

          {/* ⑤ 睡眠生理信号 —— 嵌套子折叠，默认收起；展开后为行式列表 */}
          <View style={styles.subAcc}>
            <Pressable onPress={togglePhys} style={styles.subHead} accessibilityRole="button"
              accessibilityLabel={physOpen ? '收起睡眠生理信号' : '展开睡眠生理信号'}>
              <Text style={styles.subTitle}>睡眠生理信号</Text>
              <View style={[styles.chev, physOpen && styles.chevOpen]}>
                <Icon name="chevronRight" size={16} color={theme.colors.accentText} />
              </View>
            </Pressable>

            {physOpen ? (
              <View style={{ marginTop: theme.space.xs }}>
                <Row name="睡眠静息心率" value={fmtNum(phys.hr, 0)} unit="bpm" />
                <Divider />
                <Row name="夜间 HRV（RMSSD）" value={fmtNum(phys.hrv, 0)} unit="ms" />
                <Divider />
                <Row name="体温偏离" value={fmtSigned(phys.tempDelta)} unit="℃" />
                <Divider />
                <Row name="呼吸率" value={fmtNum(phys.rr, 1)} unit="/min" />
                <Divider />
                <Row name="夜间血氧" value={fmtNum(phys.spo2, 0)} unit="%" />
                <Divider />
                <Row name="恢复指数" value={fmtNum(phys.recoveryIdx, 1)} unit="bpm/h" last />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}
/** 比例条中的一段（按百分比宽度） */
function PropSeg({ w, color }: { w: number; color: string }) {
  if (!(w > 0)) return null;
  return <View style={{ flex: w, backgroundColor: color }} />;
}
/** 比例条下方的一个色标 + 名称 + 数值 */
function PropKey({ color, k, v }: { color: string; k: string; v: number | null }) {
  return (
    <View style={styles.propKeyItem}>
      <View style={[styles.propDot, { backgroundColor: color }]} />
      <Text style={styles.propKeyText}>{k}</Text>
      <Text style={styles.propKeyVal}>{v != null ? `${v}%` : '—'}</Text>
    </View>
  );
}
/** 行式明细：标签左 · 数值右（Oura / Whoop 范式，替代并排数字格） */
function Row({ name, value, unit, last }: { name: string; value: string; unit?: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowName}>{name}</Text>
      <View style={styles.rowValWrap}>
        <Text style={styles.rowVal}>{value}</Text>
        {unit ? <Text style={styles.rowUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}
function Divider() {
  return <View style={styles.divider} />;
}

function fmtDurCn(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}
function fmtClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
}
function parseHM(s?: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtNum(v: number | null | undefined, digits: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}
function fmtSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + (Math.round(v * 100) / 100).toString();
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 2 },
  chev: { transform: [{ rotate: '90deg' }], marginLeft: theme.space.sm },
  chevOpen: { transform: [{ rotate: '-90deg' }] },
  // 时长
  durRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.space.md },
  dur: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  durUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: 6 },
  durNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, width: '100%', marginTop: 2 },
  durNone: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  blockTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.space.md, marginBottom: theme.space.xs },
  // ★ 2026-10-06：日无数据的「灰色分期图」占位——4 条极淡泳道，不编造数值
  emptyStage: { marginTop: theme.space.sm, gap: theme.sp(0.75) },
  emptyLane: { height: theme.sp(4.5), justifyContent: 'center' },
  emptyLaneBar: { height: theme.sp(2.5), borderRadius: 3, opacity: 0.13 },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.xs, lineHeight: 20 },
  // 图例
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  // 分组块
  block: { marginTop: theme.space.md },
  groupTitle: {
    fontSize: theme.fontSize.micro, color: theme.colors.textSub,
    marginTop: theme.space.md, marginBottom: theme.space.xs,
  },
  // 睡眠结构比例条
  propBar: {
    flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden',
    backgroundColor: theme.colors.cardBgSoft,
  },
  propLegend: { flexDirection: 'row', marginTop: theme.space.sm },
  propKeyItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  propDot: { width: 8, height: 8, borderRadius: 4 },
  propKeyText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  propKeyVal: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  // 行式明细
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: theme.space.sm,
  },
  rowLast: { paddingBottom: 0 },
  rowName: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle },
  rowValWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  rowVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  rowUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.ui.borderSoft },
  // 生理信号子折叠
  subAcc: {
    marginTop: theme.space.md, paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  subHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
});
