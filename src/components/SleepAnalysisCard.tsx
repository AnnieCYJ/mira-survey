/**
 * SleepAnalysisCard —— 日视图「睡眠分析」卡
 *
 * 结构（2026-10-09 调整）：
 *   ① 标题「睡眠分析」+ 副标题（入睡 · 起床时刻）；
 *   ② 总睡眠时长（大字）；
 *   ③ 整夜分期图（SleepStageChart，**常驻显示**，不再随折叠隐藏）；
 *   ④ 「详细数据」折叠区（默认收起）：睡眠结构（比例条）+ 作息与时机 + 睡眠生理信号。
 *
 * ★ 调整原因（用户反馈）：分期图与曲线要始终可见，其下的明细数据可隐藏 / 展开，
 *   不再用「整卡折叠」把图也一起收掉。
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
// ★ 2026-11-04（双机型）：Luna Mira 无温度传感器 → 体温行（含偏离）整行隐藏
import { useDeviceModel, hasCap } from '../config/deviceModel';

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
  /**
   * 绝对体温 ℃。仅在个人基线未建立、算不出偏离时作为兜底展示（标签会改成「体温」，
   * 不能把绝对值当「偏离」显示——那会让36.5℃ 显示成「+36.5℃ 体温偏离」）。
   */
  tempAbs?: number | null;
  /** 呼吸率 /min */
  rr?: number | null;
  /** 夜间血氧 % */
  spo2?: number | null;
  /** 恢复指数 bpm/h */
  recoveryIdx?: number | null;
  /**
   * ★ 2026-10-10（用户：心率变异性分「睡眠阶段 / 日间」两个展示）：
   * 夜间 HRV 逐样本序列（绝对时间戳），作为分期图下面的第二层。
   * 由 `SleepDetailScreen` 从 `healthStore.getIntraday('hrv', dk)` 取，
   * 不用 `ring.history.hrv`（那条混了由 RR 间期展开的 BPM 值）。
   */
  hrvIntraday?: { t: number; v: number }[] | null;
}

export interface MetricJump {
  key: string;
  name: string;
  unit: string;
  yMin: number;
  yMax: number;
}

interface Props {
  day: DaySleepAnalysis | null;
  /** 该日分期段（无数据时为 null → 显占位） */
  segments: SleepSegment[] | null;
  phys: DayPhys;
  /** ★ 2026-10-12（用户）：生理信号行点击跳转洞察页基础指标详情页。
   *   传 null 则不显示箭头、不可点击。 */
  onOpenMetric?: (m: MetricJump) => void;
}

export default function SleepAnalysisCard({ day, segments, phys, onOpenMetric }: Props) {
  const { model: dmModel } = useDeviceModel();
  const hasTempCap = hasCap(dmModel, 'temp');
  const [detailsOpen, setDetailsOpen] = useState(false);

  /** 入睡时刻的绝对 ms（给 HRV 第二层做 x 轴参考）；拿不到就null */
  const bedTimeMs = (() => {
    const st = day?.sleepTime;
    if (!st) return null;
    const m = /(\d{1,2}):(\d{2})/.exec(st);
    if (!m) return null;
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d.getTime();
  })();

  const toggleDetails = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDetailsOpen((v) => !v);
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
      {/* ── 标题（静态，不折叠；分期图常驻） ── */}
      <View style={styles.head}>
        <Text style={styles.title}>睡眠分析</Text>
      </View>

      {/* ① 总时长（大字） */}
      <View style={styles.durRow}>
        {total > 0 ? (
          <>
            <Text style={styles.dur}>{fmtDurCn(total)}</Text>
            <Text style={styles.durUnit}>总睡眠</Text>
          </>
        ) : (
          <Text style={styles.durNone}>昨夜睡眠时长暂无</Text>
        )}
      </View>

      {/* ② 整夜分期图（置于时长之下，常驻显示） */}
      <Text style={styles.blockTitle}>整夜分期</Text>
      {/* ★ 2026-10-12（用户）：去掉分期图下方的 HRV 柱状图——hrvLayer 传 null */}
      {segments && segments.length > 0 ? (
        <SleepStageChart
          segments={segments}
          sleepTime={day?.sleepTime ?? null}
          totalMinutes={total > 0 ? total : null}
          hrvLayer={null}
          bedTimeMs={bedTimeMs}
        />
      ) : (
        /* 日无数据时不要「完全空白」，给一张灰色分期图占位（不编造数值）。 */
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

      {/* ③ 详细数据（默认收起）：睡眠结构 + 作息与时机 + 生理信号 */}
      <Pressable onPress={toggleDetails} style={styles.moreHead} accessibilityRole="button"
        accessibilityLabel={detailsOpen ? '收起详细数据' : '展开详细数据'}>
        <Text style={styles.moreTitle}>详细数据</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.moreCount}><Text style={styles.moreCountText}>8 项</Text></View>
          <View style={[styles.chev, detailsOpen && styles.chevOpen]}>
            <Icon name="chevronRight" size={16} color={theme.colors.textSub} />
          </View>
        </View>
      </Pressable>

      {detailsOpen ? (
        <View>
          {/* 睡眠结构 —— 比例条（深睡/浅睡/REM 堆叠）+ 下方行式明细 */}
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

          {/* 作息与时机 —— 行式列表（标签左 · 数值右） */}
          <View style={styles.block}>
            <Text style={styles.groupTitle}>作息与时机</Text>
            {effPct != null ? <Row name="睡眠效率" value={`${effPct}%`} /> : null}
            <Divider />
            <Row name="入睡时刻" value={day?.sleepTime ?? '—'} />
            <Divider />
            <Row name="起床时刻" value={day?.wakeTime ?? (wakeMin != null ? fmtClock(wakeMin) : '—')} />
            <Divider />
            <Row name="夜间清醒" value={day?.getUp != null ? `${day.getUp} 次` : '—'} />
          </View>

          {/* 睡眠生理信号 —— 行式列表 */}
          <View style={styles.block}>
            <Text style={styles.groupTitle}>睡眠生理信号</Text>
            <Row name="睡眠静息心率" value={fmtNum(phys.hr, 0)} unit="bpm"
              metric={{ key: 'hr', name: '心率', unit: 'bpm', yMin: 40, yMax: 180 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'hr', name: '心率', unit: 'bpm', yMin: 40, yMax: 180 }) : undefined} />
            <Divider />
            <Row name="夜间 HRV（RMSSD）" value={fmtNum(phys.hrv, 0)} unit="ms"
              metric={{ key: 'hrv', name: '心率变异性', unit: 'ms', yMin: 0, yMax: 150 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'hrv', name: '心率变异性', unit: 'ms', yMin: 0, yMax: 150 }) : undefined} />
            {hasTempCap ? (<>
            <Divider />
            {/* ★ 2026-10-10（修 bug）：优先显示「相对个人基线的偏离」；基线未建立时退回绝对体温，
                且标签同步改成「体温」—— 绝不把 36.5℃ 当成「偏离 +36.5℃」显示。 */}
            {phys.tempDelta != null
              ? <Row name="体温偏离（相对基线）" value={fmtSigned(phys.tempDelta)} unit="℃"
                  metric={{ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }}
                  onPress={onOpenMetric ? () => onOpenMetric({ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }) : undefined} />
              : phys.tempAbs != null
              ? <Row name="体温（建立基线后可看偏离）" value={fmtNum(phys.tempAbs, 1)} unit="℃"
                  metric={{ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }}
                  onPress={onOpenMetric ? () => onOpenMetric({ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }) : undefined} />
              : <Row name="体温偏离（相对基线）" value="—" unit="℃"
                  metric={{ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }}
                  onPress={onOpenMetric ? () => onOpenMetric({ key: 'temp', name: '体温', unit: '°C', yMin: 35, yMax: 38.5 }) : undefined} />}
            </>) : null}
            <Divider />
            {phys.rr != null ? <Row name="呼吸率" value={fmtNum(phys.rr, 1)} unit="/min"
              metric={{ key: 'rr', name: '呼吸率', unit: '次/分', yMin: 5, yMax: 40 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'rr', name: '呼吸率', unit: '次/分', yMin: 5, yMax: 40 }) : undefined} /> : null}
            {phys.rr != null ? <Divider /> : null}
            <Row name="夜间血氧" value={fmtNum(phys.spo2, 0)} unit="%"
              metric={{ key: 'spo2', name: '血氧', unit: '%', yMin: 80, yMax: 100 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'spo2', name: '血氧', unit: '%', yMin: 80, yMax: 100 }) : undefined} />
            <Divider />
            {phys.recoveryIdx != null ? <Row name="恢复指数" value={fmtNum(phys.recoveryIdx, 1)} unit="bpm/h" last /> : null}
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
/** 行式明细：标签左 · 数值右（Oura / Whoop 范式，替代并排数字格）。
 *  ★ 2026-10-12：onPress 非空时右侧显示向右箭头，整行可点击跳转详情页。 */
function Row({ name, value, unit, last, onPress, metric }: {
  name: string;
  value: string;
  unit?: string;
  last?: boolean;
  onPress?: () => void;
  metric?: MetricJump;
}) {
  const showArrow = onPress != null && metric != null;
  const content = (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowName}>{name}</Text>
      <View style={styles.rowValWrap}>
        {/* ★ 2026-10-13（用户：数字和右侧箭头不在一个水平）：拆两层——
            数字/单位之间按基线对齐（单位小字贴大数字底），箭头无文字基线、
            单独垂直居中。原来整层都 baseline，Icon 会掉到底部对齐而错开。 */}
        <View style={styles.rowValText}>
          <Text style={styles.rowVal}>{value}</Text>
          {unit ? <Text style={styles.rowUnit}>{unit}</Text> : null}
        </View>
        {showArrow ? <Icon name="chevronRight" size={15} color={theme.colors.textSub} style={styles.rowArrow} /> : null}
      </View>
    </View>
  );
  return showArrow ? (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
      {content}
    </Pressable>
  ) : content;
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
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  chev: { transform: [{ rotate: '90deg' }], marginLeft: theme.space.sm },
  chevOpen: { transform: [{ rotate: '-90deg' }] },
  // 时长（对齐 sleep-recovery-preview.html：总睡眠 22px / 单位 11px，同预览 .durRow2）
  durRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.space.xs },
  dur: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  durUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 6 },
  durNone: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  // ★ 2026-10-09（.blockTitle 11px）：块标题用 micro 档，对齐预览稿
  blockTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.md, marginBottom: theme.space.xs },
  // 日无数据的「灰色分期图」占位
  emptyStage: { marginTop: theme.space.sm, gap: theme.sp(0.75) },
  emptyLane: { height: theme.sp(4.5), justifyContent: 'center' },
  emptyLaneBar: { height: theme.sp(2.5), borderRadius: 3, opacity: 0.13 },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.xs, lineHeight: 20 },
  // 图例
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // 「详细数据」折叠头（2026-10-09：对齐 sleep-recovery-preview.html 的整块按钮样式——
  //   浅底描边胶囊，替代原纯文字行，与预览稿的「详细数据 ▾」入口一致）
  moreHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.space.md,
    paddingTop: theme.sp(2.25), paddingHorizontal: 0,
  },
  moreCount: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: mm.colors.limeSoft, borderRadius: theme.radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  moreCountText: { fontSize: theme.fontSize.xs, fontWeight: '600', color: mm.colors.limeDeep },
  moreTitle: { fontSize: theme.fontSize.sm, color: mm.colors.ink, fontWeight: theme.weight.semibold },
  // 分组块
  block: { marginTop: theme.space.md },
  groupTitle: {
    fontSize: theme.fontSize.micro, color: theme.colors.textSub,
    marginTop: theme.space.md, marginBottom: theme.space.xs,
  },
  // 睡眠结构比例条（★ bar-design-unified-spec 规则2：横条 ≤10pt 一律 pill）
  propBar: {
    flexDirection: 'row', height: 10, borderRadius: theme.radius.pill, overflow: 'hidden',
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
  rowValWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowValText: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  rowVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  rowUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  rowArrow: { marginLeft: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.ui.borderSoft },
});
