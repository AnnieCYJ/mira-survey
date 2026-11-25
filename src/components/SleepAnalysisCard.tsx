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
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import SleepStageChart from './SleepStageChart';
// ★ 2026-11-06 审查（docs/audit/02 🔴#3）：合成分期图的「示意」免责提示
import SynthesizedStagesNote from './SynthesizedStagesNote';
import type { SleepSegment } from '../ble/RingBleManager';
// ★ 2026-11-25（用户：点指标旁「?」看说明）：底部说明弹层 + 入睡偏晚口径
import SleepInfoSheet, { type SleepInfoKey } from './SleepInfoSheet';
import { isLateBedtime } from '../lib/sleepTime';
// ★ 2026-11-04（双机型）：Luna Mira 无温度传感器 → 体温行（含偏离）整行隐藏
import { useDeviceModel } from '../config/deviceModel';
// ★ 2026-11-07（用户「所有的采样频率都不需要写」）：夜间采样频率实测标注已移除

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ 2026-11-24（用户「把这些标准加上」）：睡眠子指标状态标注。
 * 阈值**不新造**，全部取自工程里已存在的口径，只把原本藏在代码/元数据里的
 * 标准呈现到界面上：
 *   · 总时长 7–9h        → metrics.ts EXTENDED_SIGNALS.sleepTotal.range「成人建议 7–9h」
 *   · 深睡 15–25%        → metrics.ts sleepDeep.range「健康 15–25%」
 *   · REM  20–25%        → metrics.ts sleepRem.range「健康 20–25%」
 *   · 睡眠效率 ≥85% 良好 / <70% 碎片化 → sleepScore.ts:22 注释（WHOOP/Oura 目标）
 *   · 夜间清醒 ≤3 次     → sleepScore.ts TARGET_GETUP=3
 * 浅睡 / 入睡时刻 / 起床时刻：工程内**没有**健康标准，故不标注（不编造口径）。
 * 措辞只用描述性档位（偏短/适宜/偏长、偏低/正常/偏高），不做诊断、不评分、不提示就医。
 * ═══════════════════════════════════════════════════════════════════════════ */
type VerdictTone = 'good' | 'warn' | 'danger';
interface Verdict { text: string; tone: VerdictTone }
const vd = (text: string, tone: VerdictTone): Verdict => ({ text, tone });

/** 总时长：偏短 <7h / 适宜 7–9h / 偏长 >9h */
function durationVerdict(min: number | null): Verdict | null {
  if (min == null || !Number.isFinite(min) || min <= 0) return null;
  const h = min / 60;
  if (h < 7) return vd('偏短', 'warn');
  if (h > 9) return vd('偏长', 'warn');
  return vd('适宜', 'good');
}
/** 深睡占比：偏低 <15% / 正常 15–25% / 偏高 >25% */
function deepVerdict(pct: number | null): Verdict | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct < 15) return vd('偏低', 'warn');
  if (pct > 25) return vd('偏高', 'warn');
  return vd('正常', 'good');
}
/** REM 占比：偏低 <20% / 正常 20–25% / 偏高 >25% */
function remVerdict(pct: number | null): Verdict | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct < 20) return vd('偏低', 'warn');
  if (pct > 25) return vd('偏高', 'warn');
  return vd('正常', 'good');
}
/** 睡眠效率：良好 ≥85% / 一般 70–85% / 偏低 <70%（碎片化） */
function effVerdict(pct: number | null): Verdict | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 85) return vd('良好', 'good');
  if (pct < 70) return vd('偏低', 'danger');
  return vd('一般', 'warn');
}
/** 夜间清醒：正常 ≤3 次 / 偏多 >3 次（sleepScore 起夜达标线） */
function getUpVerdict(n: number | null): Verdict | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n <= 3 ? vd('正常', 'good') : vd('偏多', 'warn');
}
// ★ 2026-11-25：夜间生理信号 + 入睡时刻的状态标注（阈值沿用工程既有口径，见 SleepInfoSheet 顶部注释）
/** 睡眠静息心率：常见 58–85；>85 偏高 / <58 偏低（MetricDetailScreen.tsx:138-144） */
function nightHrVerdict(v: number | null): Verdict | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v > 85) return vd('偏高', 'warn');
  if (v < 58) return vd('偏低', 'warn');
  return vd('正常', 'good');
}
/** 夜间 HRV：≥50 恢复在线 / <50 偏低（MetricDetailScreen.tsx:147-150；个体差异大） */
function nightHrvVerdict(v: number | null): Verdict | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v >= 50 ? vd('正常', 'good') : vd('偏低', 'warn');
}
/** 夜间血氧：≥95 理想 / 90–94 偏低 / <90 异常（MetricDetailScreen.tsx:224-233） */
function nightSpo2Verdict(v: number | null): Verdict | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 95) return vd('理想', 'good');
  if (v >= 90) return vd('偏低', 'warn');
  return vd('异常', 'danger');
}
/** 入睡时刻：>23:30 偏晚（sleepTime.ts:202 isLateBedtime，已在情绪页使用） */
function bedVerdict(sleepTime: string | null | undefined): Verdict | null {
  if (!sleepTime) return null;
  return isLateBedtime(sleepTime) ? vd('偏晚', 'warn') : null;
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
  /** ★ 2026-11-07：夜间三指标的数据来源说明（逐样本 / 全天日均 / 无数据），如实告知用户 */
  physSourceNote?: string | null;
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
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🔴#3）：该日分期图是否为「按时长合成」。
   *   true → 图下必须显示「示意」说明（时长是实测，时间轴分布是铺排的）。
   */
  stagesSynthesized?: boolean;
  phys: DayPhys;
  /** ★ 2026-10-12（用户）：生理信号行点击跳转洞察页基础指标详情页。
   *   传 null 则不显示箭头、不可点击。 */
  onOpenMetric?: (m: MetricJump) => void;
}

export default function SleepAnalysisCard({ day, segments, phys, onOpenMetric, stagesSynthesized }: Props) {
  useDeviceModel();
  // ★ 2026-11-07（用户「静息心率/夜间HRV/血氧都不展示」）：详细数据改为默认展开——
  //   睡眠生理信号（静息心率/夜间HRV/血氧/呼吸率）不再藏在折叠区里，进卡即见。
  const [detailsOpen, setDetailsOpen] = useState(true);
  // ★ 2026-11-25：点指标名旁「?」打开的底部说明弹层
  const [infoKey, setInfoKey] = useState<SleepInfoKey | null>(null);
  const [infoValue, setInfoValue] = useState<string | null>(null);
  const openInfo = (key: SleepInfoKey, value: string | null) => {
    setInfoKey(key);
    setInfoValue(value);
  };

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

  // ★ 2026-11-24：把工程既有标准接进 UI（无标准项不标注）
  const vTotal = durationVerdict(total > 0 ? total : null);
  const vDeep = deepVerdict(deepP);
  const vRem = remVerdict(remP);
  const vEff = effVerdict(effPct);
  const vGetUp = getUpVerdict(day?.getUp ?? null);
  const vBed = bedVerdict(day?.sleepTime);
  // ★ 2026-11-25：用与界面显示一致的整数值判定，避免出现「58 bpm 偏低」这类显示值与档位矛盾
  const vHr = nightHrVerdict(phys.hr != null && Number.isFinite(phys.hr) ? Math.round(phys.hr) : null);
  const vHrv = nightHrvVerdict(phys.hrv != null && Number.isFinite(phys.hrv) ? Math.round(phys.hrv) : null);
  const vSpo2 = nightSpo2Verdict(phys.spo2 != null && Number.isFinite(phys.spo2) ? Math.round(phys.spo2) : null);

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
            <VerdictTag v={vTotal} style={styles.durVerdict} />
            <View style={styles.durInfo}>
              <InfoDot onPress={() => openInfo('duration', `昨夜 ${fmtDurCn(total)}`)} />
            </View>
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
      {/* ★ 2026-11-06 审查（docs/audit/02 🔴#3）：合成分期图必须告知用户。 */}
      {stagesSynthesized && segments && segments.length > 0 ? <SynthesizedStagesNote /> : null}
      {/* ★ 2026-11-07（用户「睡到10点多，中间那些没有啊」）：分期曲线比总时长短时如实标注缺口——
          曲线（sleepLine）与总时长（原生汇总）不同源，戒指只回读到某刻时，缺口必须说明而不是静默截断。 */}
      {segments && segments.length > 0 && total > 0 && segments[segments.length - 1].end < total - 5 ? (
        <Text style={styles.empty}>
          分期明细只回读到 {fmtStageEnd(day?.sleepTime ?? null, segments[segments.length - 1].end)}，之后的分段戒指还没上传，同步后会自动补全。
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
          {/* ★ 2026-11-24：状态标注的口径说明（对齐尿酸/血糖页「仅供参考，不替代医学检测」） */}
          <Text style={styles.verdictNote}>
            偏短/适宜/偏高按成人常见区间标注，仅供参考，不替代医学检测。
          </Text>
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
                {/* ★ 2026-11-24：深睡/REM 有健康标准 → 标注；浅睡无标准 → 不标注
                    ★ 2026-11-25：标签移到名称下方；深睡/REM 加「?」说明入口 */}
                <PropKey color={mm.colors.purpleCore} k="深睡" v={deepP} verdict={vDeep}
                  onInfo={() => openInfo('deep', deepP != null ? `昨夜占比 ${deepP}%` : null)} />
                <PropKey color={mm.colors.purpleMid} k="浅睡" v={lightP} />
                <PropKey color={mm.colors.skyCore} k="REM" v={remP} verdict={vRem}
                  onInfo={() => openInfo('rem', remP != null ? `昨夜占比 ${remP}%` : null)} />
              </View>
            </View>
          ) : null}

          {/* 作息与时机 —— 行式列表（标签左 · 数值右） */}
          <View style={styles.block}>
            <Text style={styles.groupTitle}>作息与时机</Text>
            {effPct != null ? <Row name="睡眠效率" value={`${effPct}%`} verdict={vEff}
              infoKey="eff" infoValue={`昨夜 ${effPct}%`} onInfo={openInfo} /> : null}
            <Divider />
            <Row name="入睡时刻" value={day?.sleepTime ?? '—'} verdict={vBed}
              infoKey="bed" infoValue={day?.sleepTime ?? null} onInfo={openInfo} />
            <Divider />
            {/* ★ 2026-11-25：起床时刻工程无绝对判断 → 不加 verdict，但给「?」说明为什么 */}
            <Row name="起床时刻" value={day?.wakeTime ?? (wakeMin != null ? fmtClock(wakeMin) : '—')}
              infoKey="wake" infoValue={day?.wakeTime ?? (wakeMin != null ? fmtClock(wakeMin) : null)} onInfo={openInfo} />
            <Divider />
            <Row name="夜间清醒" value={day?.getUp != null ? `${day.getUp} 次` : '—'} verdict={vGetUp}
              infoKey="getup" infoValue={day?.getUp != null ? `昨夜 ${day.getUp} 次` : null} onInfo={openInfo} />
          </View>

          {/* 睡眠生理信号 —— 行式列表 */}
          <View style={styles.block}>
            <Text style={styles.groupTitle}>睡眠生理信号</Text>
            <Row name="睡眠静息心率" value={fmtNum(phys.hr, 0)} unit="bpm" verdict={vHr}
              infoKey="hr" infoValue={phys.hr != null ? `昨夜 ${fmtNum(phys.hr, 0)} bpm` : null} onInfo={openInfo}
              metric={{ key: 'hr', name: '心率', unit: 'bpm', yMin: 40, yMax: 180 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'hr', name: '心率', unit: 'bpm', yMin: 40, yMax: 180 }) : undefined} />
            <Divider />
            <Row name="夜间 HRV（RMSSD）" value={fmtNum(phys.hrv, 0)} unit="ms" verdict={vHrv}
              infoKey="hrv" infoValue={phys.hrv != null ? `昨夜 ${fmtNum(phys.hrv, 0)} ms` : null} onInfo={openInfo}
              metric={{ key: 'hrv', name: '心率变异性', unit: 'ms', yMin: 0, yMax: 150 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'hrv', name: '心率变异性', unit: 'ms', yMin: 0, yMax: 150 }) : undefined} />
            {(phys.tempAbs != null || phys.tempDelta != null) ? (<>
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
            {/* ★ 2026-11-14（用户）：呼吸率行整行去掉 —— 本机型固件恒不回传呼吸率（实测恒 0），
                这张卡永远不会出真实数据，按「没数据就删」纪律下线。 */}
            <Row name="夜间血氧" value={fmtNum(phys.spo2, 0)} unit="%" verdict={vSpo2}
              infoKey="spo2" infoValue={phys.spo2 != null ? `昨夜 ${fmtNum(phys.spo2, 0)}%` : null} onInfo={openInfo}
              metric={{ key: 'spo2', name: '血氧', unit: '%', yMin: 80, yMax: 100 }}
              onPress={onOpenMetric ? () => onOpenMetric({ key: 'spo2', name: '血氧', unit: '%', yMin: 80, yMax: 100 }) : undefined} />
            <Divider />
            {phys.recoveryIdx != null ? <Row name="恢复指数" value={fmtNum(phys.recoveryIdx, 1)} unit="bpm/h" last /> : null}
            {/* ★ 2026-11-14（用户）：「按睡眠窗口内足样本计算 HR/HRV/血氧…」来源注释行去掉，不再展示。
                数据口径仍在 nightPhysiology 内部保证，只是不向用户展示统计说明。 */}
          </View>
        </View>
      ) : null}

      {/* ★ 2026-11-25：指标说明底部弹层 */}
      <SleepInfoSheet
        visible={infoKey != null}
        onClose={() => setInfoKey(null)}
        metric={infoKey}
        valueText={infoValue}
      />
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
/** ★ 2026-11-25：「查看说明」小圆点（?）——点击打开底部说明弹层。
 *  不新增全局图标，用自绘圆点+? 文字，避免影响其他页面。 */
function InfoDot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="查看说明"
    >
      <View style={styles.infoDot}>
        <Text style={styles.infoDotText}>?</Text>
      </View>
    </Pressable>
  );
}
/** 状态标注小胶囊（偏短/适宜/正常/偏高…），tone 复用 theme.colors.ui.status 语义色 */
function VerdictTag({ v, style }: { v: Verdict | null; style?: object }) {
  if (!v) return null;
  const colorMap = {
    good: theme.colors.ui.status.good,
    warn: theme.colors.ui.status.warn,
    danger: theme.colors.ui.status.danger,
  };
  const bgMap = {
    good: theme.colors.ui.status.goodSoft,
    warn: theme.colors.ui.status.warnSoft,
    danger: theme.colors.ui.status.dangerSoft,
  };
  return (
    <View style={[styles.verdictTag, { backgroundColor: bgMap[v.tone] }, style]}>
      <Text style={[styles.verdictTagText, { color: colorMap[v.tone] }]}>{v.text}</Text>
    </View>
  );
}
/** 比例条下方的一个色标 + 名称 + 数值。
 *  ★ 2026-11-25（用户「标签放深睡下面，位置太小字会遮住」）：状态标注移到名称下一行，
 *    不再与名称/百分比挤在同一行。 */
function PropKey({ color, k, v, verdict, onInfo }: {
  color: string; k: string; v: number | null; verdict?: Verdict | null;
  onInfo?: () => void;
}) {
  return (
    <View style={styles.propKeyItem}>
      <View style={styles.propKeyLine}>
        <View style={[styles.propDot, { backgroundColor: color }]} />
        <Text style={styles.propKeyText}>{k}</Text>
        <Text style={styles.propKeyVal}>{v != null ? `${v}%` : '—'}</Text>
        {onInfo ? <InfoDot onPress={onInfo} /> : null}
      </View>
      {/* 标签单独占一行，避免窄屏挤压遮字 */}
      <View style={styles.propKeyVerdictRow}>
        {verdict ? <VerdictTag v={verdict} /> : null}
      </View>
    </View>
  );
}
/** 行式明细：标签左 · 数值右（Oura / Whoop 范式，替代并排数字格）。
 *  ★ 2026-10-12：onPress 非空时右侧显示向右箭头，整行可点击跳转详情页。 */
function Row({ name, value, unit, last, onPress, metric, verdict, infoKey, infoValue, onInfo }: {
  name: string;
  value: string;
  unit?: string;
  last?: boolean;
  onPress?: () => void;
  metric?: MetricJump;
  verdict?: Verdict | null;
  /** ★ 2026-11-25：名称旁「?」说明入口 */
  infoKey?: SleepInfoKey;
  infoValue?: string | null;
  onInfo?: (key: SleepInfoKey, value: string | null) => void;
}) {
  const showArrow = onPress != null && metric != null;
  const content = (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowNameWrap}>
        <Text style={styles.rowName}>{name}</Text>
        {infoKey && onInfo ? <InfoDot onPress={() => onInfo(infoKey, infoValue ?? null)} /> : null}
      </View>
      <View style={styles.rowValWrap}>
        {/* ★ 2026-10-13（用户：数字和右侧箭头不在一个水平）：拆两层——
            数字/单位之间按基线对齐（单位小字贴大数字底），箭头无文字基线、
            单独垂直居中。原来整层都 baseline，Icon 会掉到底部对齐而错开。 */}
        <View style={styles.rowValText}>
          <Text style={styles.rowVal}>{value}</Text>
          {unit ? <Text style={styles.rowUnit}>{unit}</Text> : null}
        </View>
        {verdict ? <VerdictTag v={verdict} style={styles.rowVerdict} /> : null}
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
/** 分期曲线覆盖到的钟点：入睡时刻 + 曲线末端（相对分钟），跨天取模；无法解析返回 null。
 *  ★ 2026-11-07：分期缺口提示用。 */
function fmtStageEnd(sleepTime: string | null, spanMin: number): string {
  const startMin = parseHM(sleepTime);
  if (startMin == null) return '暂未同步的时段';
  const abs = (((startMin + Math.round(spanMin)) % 1440) + 1440) % 1440;
  return fmtClock(abs);
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
  /* ★ 2026-11-09（一致性排查）：数字 + 单位是二元行，显式 nowrap 锁死基线，避免换行后错落 */
  durRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'nowrap', marginTop: theme.space.xs },
  dur: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  durUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 6, flexShrink: 1 },
  durNone: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  // ★ 2026-10-09（.blockTitle 11px）：块标题用 micro 档，对齐预览稿
  blockTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.md, marginBottom: theme.space.xs },
  // 日无数据的「灰色分期图」占位
  emptyStage: { marginTop: theme.space.sm, gap: theme.sp(0.75) },
  emptyLane: { height: theme.sp(4.5), justifyContent: 'center' },
  emptyLaneBar: { height: theme.sp(2.5), borderRadius: theme.radius.xs, opacity: 0.13 },
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
  // ★ 2026-11-07：夜间三指标数据来源说明（次级小字，不抢主数据）
  physSourceNote: {
    marginTop: theme.space.xs, fontSize: theme.fontSize.micro,
    color: theme.colors.textSub, lineHeight: theme.fontSize.micro * 1.5,
  },
  verdictNote: {
    marginTop: theme.space.sm, fontSize: theme.fontSize.micro,
    color: theme.colors.textSub, lineHeight: theme.fontSize.micro * 1.5,
  },
  // 睡眠结构比例条（★ bar-design-unified-spec 规则2：横条 ≤10pt 一律 pill）
  propBar: {
    flexDirection: 'row', height: 10, borderRadius: theme.radius.pill, overflow: 'hidden',
    backgroundColor: theme.colors.cardBgSoft,
  },
  propLegend: { flexDirection: 'row', marginTop: theme.space.sm },
  propKeyItem: { flex: 1, alignItems: 'flex-start' },
  propKeyLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  propDot: { width: 8, height: 8, borderRadius: 4 },
  propKeyText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  propKeyVal: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  propKeyVerdictRow: { minHeight: 20, marginTop: 2 },
  // ★ 2026-11-24：状态标注胶囊（复用 theme.colors.ui.status 语义色，背景由 inline 注入）
  verdictTag: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill,
    alignSelf: 'center',
  },
  verdictTagText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  durVerdict: { marginLeft: 8 },
  durInfo: { marginLeft: 10, alignSelf: 'center' },
  rowVerdict: { marginLeft: 4 },
  propKeyVerdict: { marginLeft: 2, paddingHorizontal: 4, paddingVertical: 1 },
  // ★ 2026-11-25：「查看说明」小圆点
  rowNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingRight: 8 },
  infoDot: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 1, borderColor: theme.colors.textSub,
    alignItems: 'center', justifyContent: 'center',
  },
  infoDotText: { fontSize: 11, fontWeight: '600', color: theme.colors.textSub, lineHeight: 14 },
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
