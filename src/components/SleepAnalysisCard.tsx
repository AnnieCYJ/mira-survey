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
            <View style={{ marginTop: theme.space.sm }}>
              <SleepStageChart
                segments={segments}
                sleepTime={day?.sleepTime ?? null}
                totalMinutes={total > 0 ? total : null}
              />
              <View style={styles.legend}>
                <LegendItem color={mm.colors.purpleCore} label="深睡" />
                <LegendItem color={mm.colors.purpleMid} label="浅睡" />
                <LegendItem color={mm.colors.skyCore} label="REM" />
                <LegendItem color={mm.colors.honeyCore} label="清醒" />
              </View>
            </View>
          ) : (
            <Text style={styles.empty}>
              昨夜睡眠分期暂未同步。将戒指连接 App 后，后台会自动回填历史睡眠分期。
            </Text>
          )}

          {/* ③ 四比例 */}
          <View style={styles.grid4}>
            <Cell v={deepP != null ? `${deepP}%` : '—'} l="深睡占比" />
            <Cell v={lightP != null ? `${lightP}%` : '—'} l="浅睡占比" />
            <Cell v={remP != null ? `${remP}%` : '—'} l="REM 占比" />
            <Cell v={effPct != null ? `${effPct}%` : '—'} l="睡眠效率" />
          </View>

          {/* ④ 时机与规律 */}
          <View style={styles.metaRow}>
            <Meta v={bedMin != null ? `${bedMin}分` : '—'} l="入睡潜伏期" />
            <Meta v={day?.getUp != null ? `${day.getUp} 次` : '—'} l="夜间清醒" />
            <Meta v={wakeMin != null ? fmtClock(wakeMin) : '—'} l="起床时刻" />
            <Meta v="—" l="作息规律" />
          </View>

          {/* ⑤ 睡眠生理信号 —— 嵌套子折叠，默认收起 */}
          <View style={styles.subAcc}>
            <Pressable onPress={togglePhys} style={styles.subHead} accessibilityRole="button"
              accessibilityLabel={physOpen ? '收起睡眠生理信号' : '展开睡眠生理信号'}>
              <Text style={styles.subTitle}>睡眠生理信号</Text>
              <View style={[styles.chev, physOpen && styles.chevOpen]}>
                <Icon name="chevronRight" size={16} color={theme.colors.accentText} />
              </View>
            </Pressable>

            {physOpen ? (
              <View style={styles.physGrid}>
                <PhysCell v={fmtNum(phys.hr, 0)} u="bpm" l="睡眠静息心率" />
                <PhysCell v={fmtNum(phys.hrv, 0)} u="ms" l="夜间 HRV（RMSSD）" />
                <PhysCell v={fmtSigned(phys.tempDelta)} u="℃" l="体温偏离" />
                <PhysCell v={fmtNum(phys.rr, 1)} u="/min" l="呼吸率" />
                <PhysCell v={fmtNum(phys.spo2, 0)} u="%" l="夜间血氧" />
                <PhysCell v={fmtNum(phys.recoveryIdx, 1)} u="bpm/h" l="恢复指数" />
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
function Cell({ v, l }: { v: string; l: string }) {
  return (
    <View style={styles.cell4}>
      <Text style={styles.cell4Val}>{v}</Text>
      <Text style={styles.cell4Lab}>{l}</Text>
    </View>
  );
}
function Meta({ v, l }: { v: string; l: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaVal}>{v}</Text>
      <Text style={styles.metaLab}>{l}</Text>
    </View>
  );
}
function PhysCell({ v, u, l }: { v: string; u: string; l: string }) {
  return (
    <View style={styles.physCell}>
      <Text style={styles.physVal}>
        {v}
        <Text style={styles.physUnit}>{u}</Text>
      </Text>
      <Text style={styles.physLab}>{l}</Text>
    </View>
  );
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
  blockTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.space.md },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.xs, lineHeight: 20 },
  // 图例
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  // 四比例
  grid4: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  cell4: {
    flex: 1, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm, alignItems: 'center',
  },
  cell4Val: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  cell4Lab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  // 时机
  metaRow: {
    flexDirection: 'row', marginTop: theme.space.md, paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  metaItem: { flex: 1, alignItems: 'center' },
  metaVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  metaLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  // 生理信号子折叠
  subAcc: {
    marginTop: theme.space.md, paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  subHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  physGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.sm },
  physCell: {
    width: '48.5%', backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm,
    padding: theme.space.sm,
  },
  physVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  physUnit: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular, color: theme.colors.textSub, marginLeft: 2 },
  physLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
});
