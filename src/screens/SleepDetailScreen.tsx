/**
 * SleepDetailScreen —— 睡眠详情页（日 / 周 / 月 / 年）
 *
 * ★ v9 结构（对齐 preview/sleep-rhythm.html 原型，2026-10-05）：
 *   - 标题「睡眠节律」+ 副标题「睡眠恢复 · 整夜分期 · 睡眠节律」；
 *   - 顶部「睡眠恢复分」hero（仅日视图，置于日/周/月/年选择器**上方**，分数上方无标签）；
 *   - 日：睡眠分析卡（可折叠：总时长 → 整夜分期 → 四比例 → 时机；睡眠生理信号为
 *     **默认收起的嵌套子折叠**）+ 睡眠节律卡（皮质醇节律趋势图 + 4 格指标，
 *     「整体水平」格可点击 → 皮质醇异常说明弹层）；
 *   - 周/月/年：睡眠与恢复**双纵轴图**（柱=时长左轴 / 线=恢复分右轴，皮质醇异常天
 *     叠红底白「!」且**可点击** → 同一说明弹层）+ **多维度对比表**（当前 vs 上周/上月/
 *     去年，含皮质醇异常天数）。
 *
 * 数据纪律（全部真实，缺口留空不插值、不编造）：
 *   - 睡眠时长/分期/深睡/REM/起夜/入睡起床 ← `ring.sleepDaily` / `ring.sleepStagesDaily`；
 *   - 睡眠恢复分 0–100 ← `lib/sleepScore.computeSleepScore`（时长/深睡/效率/起夜四因子）。
 *     ★ 注意勿用 `sleepDaily.score`，那是设备侧 0–4 原始分；
 *   - 夜间 HR/HRV/SpO₂/体温/呼吸 ← `ring.hrDaily/hrvDaily/spo2Daily/tempDaily/rrDaily`；
 *   - 皮质醇 ← `collectSamplesForDay` → `analyzeCortisol`（cosinor 拟合）。
 *     异常判定口径与 `EmotionCognitiveDetailScreen.dayAbnormal` 一致：
 *     今天用 14 天基线（可判偏高），历史日 baselineDays=1（偏高不可信，只判节律紊乱）。
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { type SleepSummary, type SleepSegment } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import SleepHormoneCorrelation from '../components/SleepHormoneCorrelation';
// ── v9 原型移植：睡眠节律 / 睡眠分析 / 恢复分 hero / 双轴图 / 多维度对比 ──
import SleepRhythmCard from '../components/SleepRhythmCard';
import SleepAnalysisCard, { type DaySleepAnalysis, type DayPhys } from '../components/SleepAnalysisCard';
import SleepRecoveryHero, { type HeroDayRec } from '../components/SleepRecoveryHero';
import SleepDualAxisChart, { type DualPoint } from '../components/SleepDualAxisChart';
import SleepMultiDimCompare, { type MetricRow } from '../components/SleepMultiDimCompare';
import CortisolAnomalySheet, { type CortAnomKind } from '../components/CortisolAnomalySheet';
import { computeSleepScore } from '../lib/sleepScore';
import { collectSamplesForDay } from '../components/CortisolRhythmCard';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { startOfWeek, endOfWeek } from '../lib/dateUtils';
import { type RangeKey } from '../data/metrics';
import { dayKey as healthDayKey } from '../data/healthStore';


interface DayRec {
  total: number;
  deep: number;
  light: number;
  rem: number;
  score: number;
  getUp: number;
  sleepTime?: string | null;   // 入睡时间 "HH:mm"（用于作息规律性）
  wakeTime?: string | null;    // 起床时间 "HH:mm"
  /** 失眠 / 苏醒时长（分钟）—— 睡眠效率 = (total - awake) / total */
  insomnia?: number;
  awake?: number;
}

function parseKey(k: string): Date | null {
  const t = new Date(k + 'T00:00:00');
  return Number.isFinite(t.getTime()) ? t : null;
}


function meanOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** 把 sleepDaily 按『天键』拆成可读记录，键格式 'YYYY-M-D' 或 'YYYY-MM-DD' 均可 */
function toRecords(sleepDaily: Record<string, SleepSummary>): { key: string; date: Date; rec: DayRec }[] {
  return Object.keys(sleepDaily)
    .map((k) => {
      const d = parseKey(k);
      const s = sleepDaily[k];
      if (!d || !s || !(s.total > 0)) return null;
      return { key: k, date: d, rec: s as DayRec };
    })
    .filter((x): x is { key: string; date: Date; rec: DayRec } => x != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** 当前区间窗口（周=自然周 / 月=自然月 / 年=整年 / 日=当天） */
function windowOf(range: RangeKey, anchor: Date): { start: Date; end: Date } {
  if (range === 'week') return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
  if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m, 1);
    const e = new Date(y, m + 1, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (range === 'year') {
    const y = anchor.getFullYear();
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: e };
}
/** 上一等长周期窗口（用于「环比上一周期」对比） */
function prevWindowOf(range: RangeKey, anchor: Date): { start: Date; end: Date } {
  if (range === 'week') {
    const s = startOfWeek(anchor), e = endOfWeek(anchor);
    s.setDate(s.getDate() - 7); e.setDate(e.getDate() - 7);
    return { start: s, end: e };
  }
  if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (range === 'year') {
    const y = anchor.getFullYear() - 1;
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  const a = new Date(anchor); a.setDate(a.getDate() - 1); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: e };
}

export default function SleepDetailScreen() {
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [range, setRange] = useState<RangeKey>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  // ★ 皮质醇异常说明弹层（双轴图 icon 点击 / 节律卡「整体水平」点击 共用）
  const [cortSheet, setCortSheet] = useState<{ kind: CortAnomKind; date: string } | null>(null);

  // ★ key 格式必须与 RingBleManager.dayKeyOf 一致 (YYYY-MM-DD 补零)，否则 sleepDaily map 永远匹配不上
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const sleepDaily = ring.sleepDaily ?? {};


  /** 该区间是否至少有一天真实睡眠记录（双轴图空态判断用） */
  const hasData = useMemo(() => {
    const recs = toRecords(sleepDaily);
    if (recs.length === 0) return false;
    if (range === 'day') {
      const dk = dayKey(anchor);
      return recs.some((r) => r.key === dk);
    }
    const win = windowOf(range, anchor);
    return recs.some((r) => r.date.getTime() >= win.start.getTime() && r.date.getTime() <= win.end.getTime());
  }, [range, sleepDaily, anchor]);

  /* ══════════════ v9 原型移植 · 以下全部接真实数据 ══════════════ */

  /** 单日皮质醇异常判定（模块级缓存：周/月/年切 anchor 时避免重复拟合 cosinor）
   *  口径与 EmotionCognitiveDetailScreen.dayAbnormal 完全一致：
   *  今天用 14 天基线（可判偏高），历史日 baselineDays=1（偏高不可信，只判节律紊乱）。 */
  const cortKindCache = useMemo(() => new Map<string, { abn: boolean; kind: CortAnomKind }>(), []);
  const cortKindOfDay = (dk: string): { abn: boolean; kind: CortAnomKind } => {
    const isToday = dk === healthDayKey(Date.now());
    const hit = cortKindCache.get(dk);
    if (hit) return hit;
    let out = { abn: false, kind: 'normal' as CortAnomKind };
    const samples = collectSamplesForDay(dk);
    if (samples.length >= 4) {
      const r = analyzeCortisol(samples, isToday ? 14 : 1);
      const kind: CortAnomKind = r.today.dys ? 'late' : r.today.high ? 'high' : 'normal';
      out = { abn: r.today.dys || r.today.high, kind };
    }
    cortKindCache.set(dk, out);
    return out;
  };

  /** 一天的恢复分（0–100，computeSleepScore 口径）：时长/深睡/效率/起夜四因子 */
  const scoreOfDay = (rec: DayRec): number | null => {
    if (!(rec.total > 0)) return null;
    const awake = (rec.awake ?? 0) + (rec.insomnia ?? 0);
    const s = computeSleepScore({
      sleepTotal: rec.total,
      sleepDeep: rec.deep,
      sleepAwake: awake > 0 ? awake : null,
      getUp: rec.getUp ?? null,
    });
    return Number.isFinite(s) && s > 0 ? s : null;
  };

  /** 当前区间的取点序列（周=每天 / 月=每天 / 年=每月均值），供双轴图使用 */
  const dualPoints: DualPoint[] = useMemo(() => {
    if (range === 'day') return [];
    const recs = toRecords(sleepDaily);
    const map = new Map(recs.map((r) => [dayKey(r.date), r.rec]));
    const isYear = range === 'year';

    if (isYear) {
      // 年 = 12 个月的月内均值（对齐原型「年用月平均」）
      const y = anchor.getFullYear();
      const buckets: { recs: DayRec[]; label: string; key: string }[] = [];
      for (let m = 0; m < 12; m++) {
        const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
        const inM = recs.filter((r) => dayKey(r.date).startsWith(prefix));
        buckets.push({ recs: inM.map((r) => r.rec), label: `${m + 1}月`, key: prefix });
      }
      return buckets.map((b) => {
        const durMin = meanOf(b.recs.map((r) => (r.total > 0 ? r.total : null)));
        const scores = b.recs.map(scoreOfDay).filter((v): v is number => v != null);
        // 皮质醇：按该月逐日判定，天数 = 异常日占比折算（当月有记录的天数为分母）
        let abnDays = 0;
        for (const r of recs.filter((r) => dayKey(r.date).startsWith(b.key))) {
          if (cortKindOfDay(dayKey(r.date)).abn) abnDays += 1;
        }
        const anyAbn = abnDays > 0;
        const kinds = recs.filter((r) => dayKey(r.date).startsWith(b.key))
          .map((r) => cortKindOfDay(dayKey(r.date)).kind)
          .filter((k) => k !== 'normal');
        return {
          key: b.key,
          label: b.label,
          durationMin: durMin,
          score: scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null,
          cortisolAbnormal: anyAbn,
          cortisolKind: (kinds[0] as CortAnomKind) ?? 'normal',
        };
      });
    }

    // 周 / 月：区间内每天一根
    const win = windowOf(range, anchor);
    const out: DualPoint[] = [];
    const cur = new Date(win.start); cur.setHours(0, 0, 0, 0);
    const end = new Date(win.end); end.setHours(0, 0, 0, 0);
    while (cur.getTime() <= end.getTime()) {
      const dk = dayKey(cur);
      const rec = map.get(dk);
      const c = cortKindOfDay(dk);
      out.push({
        key: dk,
        label: range === 'week'
          ? ['日', '一', '二', '三', '四', '五', '六'][cur.getDay()]
          : String(cur.getDate()),
        durationMin: rec && rec.total > 0 ? rec.total : null,
        score: rec ? scoreOfDay(rec) : null,
        cortisolAbnormal: c.abn,
        cortisolKind: c.kind,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, sleepDaily, anchor, cortKindCache]);

  /** 日视图：hero 输入 + 14 天基线均值 */
  const dayHero = useMemo<{ input: HeroDayRec | null; baseline: number | null }>(() => {
    const dk = dayKey(anchor);
    const recs = toRecords(sleepDaily);
    const today = recs.find((r) => r.key === dk) ?? null;
    if (!today) return { input: null, baseline: null };

    const awake = (today.rec.awake ?? 0) + (today.rec.insomnia ?? 0);
    const input: HeroDayRec = {
      sleepTotal: today.rec.total,
      sleepDeep: today.rec.deep,
      sleepAwake: awake > 0 ? awake : null,
      getUp: today.rec.getUp ?? null,
      totalMin: today.rec.total,
      deepMin: today.rec.deep,
    };
    // 近 14 天（含当天）有记录天的分数均值
    const from = new Date(anchor); from.setDate(from.getDate() - 13);
    const recent = recs
      .filter((r) => r.date.getTime() >= from.getTime() && r.date.getTime() <= new Date(anchor).setHours(23, 59, 59, 999))
      .map((r) => scoreOfDay(r.rec))
      .filter((v): v is number => v != null);
    return { input, baseline: recent.length ? recent.reduce((a, c) => a + c, 0) / recent.length : null };
  }, [sleepDaily, anchor]);

  /** 日视图：睡眠分析卡 + 生理信号（全部真实归档字段） */
  const dayAnalysis = useMemo<{ day: DaySleepAnalysis | null; segs: SleepSegment[] | null; phys: DayPhys }>(() => {
    const dk = dayKey(anchor);
    const isLatest = !ring.sleepSummaryDate || ring.sleepSummaryDate === dk;
    const sum = sleepDaily[dk] ?? null;
    const segs = ring.sleepStagesDaily?.[dk] ?? (isLatest ? ring.sleepStages : null) ?? null;
    if (!sum) {
      return { day: null, segs, phys: { hr: ring.hrDaily?.[dk] ?? null, hrv: ring.hrvDaily?.[dk] ?? null, tempDelta: ring.tempDaily?.[dk] ?? null, rr: ring.rrDaily?.[dk] ?? null, spo2: ring.spo2Daily?.[dk] ?? null, recoveryIdx: null } };
    }
    const awakeMin = (sum.awake ?? 0) + (sum.insomnia ?? 0);
    return {
      day: {
        sleepTime: sum.sleepTime ?? (isLatest ? ring.sleepTime : null),
        wakeTime: sum.wakeTime ?? (isLatest ? ring.wakeTime : null),
        total: sum.total ?? 0,
        deep: sum.deep ?? 0,
        light: sum.light ?? 0,
        rem: sum.rem ?? 0,
        awakeMin: awakeMin > 0 ? awakeMin : null,
        getUp: sum.getUp ?? null,
      },
      segs,
      phys: {
        hr: ring.hrDaily?.[dk] ?? null,
        hrv: ring.hrvDaily?.[dk] ?? null,
        tempDelta: ring.tempDaily?.[dk] ?? null,
        rr: ring.rrDaily?.[dk] ?? null,
        spo2: ring.spo2Daily?.[dk] ?? null,
        recoveryIdx: null,
      },
    };
  }, [sleepDaily, anchor, ring]);

  /** 多维度对比：当前 vs 上周 / 上月 / 去年（皮质醇整体水平 + 异常天数 + 睡眠关键指标） */
  const cmpRows = useMemo<MetricRow[]>(() => {
    if (range === 'day') return [];
    const recs = toRecords(sleepDaily);
    if (recs.length === 0) return [];

    /** 参照窗口：lw=上周同区间 / lm=上月同区间 / ly=去年同区间 */
    const refWindow = (k: 'lw' | 'lm' | 'ly'): { start: Date; end: Date } | null => {
      if (k === 'lw') return prevWindowOf(range, anchor);
      const cur = windowOf(range, anchor);
      if (k === 'lm') {
        // 上月：保持当前日号，超界则取该月最后一天
        const s = new Date(cur.start); s.setMonth(s.getMonth() - 1);
        const e = new Date(cur.end); e.setMonth(e.getMonth() - 1);
        return { start: s, end: e };
      }
      // 去年：整体 −1 年
      const s = new Date(cur.start); s.setFullYear(s.getFullYear() - 1);
      const e = new Date(cur.end); e.setFullYear(e.getFullYear() - 1);
      return { start: s, end: e };
    };

    const inWin = (start: Date, end: Date) =>
      recs.filter((r) => r.date.getTime() >= start.getTime() && r.date.getTime() <= end.getTime());

    /** 一个窗口内的所有派生量 */
    const statsOf = (start: Date, end: Date) => {
      const rs = inWin(start, end);
      const recsOnly = rs.map((r) => r.rec).filter((r) => r.total > 0);
      const scores = rs.map((r) => scoreOfDay(r.rec)).filter((v): v is number => v != null);
      // 皮质醇异常天数：逐日真实判定
      let abnDays = 0;
      let anyHigh = false, anyDys = false;
      for (const r of rs) {
        const c = cortKindOfDay(r.key);
        if (c.abn) abnDays += 1;
        if (c.kind === 'high') anyHigh = true;
        if (c.kind === 'late') anyDys = true;
      }
      // 深睡占比取窗口内各天占比的均值
      const deepP = meanOf(recsOnly.map((r) => (r.total > 0 ? (r.deep / r.total) * 100 : null)));
      return {
        n: recsOnly.length,
        durH: meanOf(recsOnly.map((r) => r.total)),
        score: scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null,
        deepPct: deepP,
        abnDays,
        anyAbn: abnDays > 0,
        level: anyDys ? '节律紊乱' : anyHigh ? '偏高' : recsOnly.length ? '正常' : null,
      };
    };

    const cw = windowOf(range, anchor);
    const cur = statsOf(cw.start, cw.end);
    const wLw = refWindow('lw')!, wLm = refWindow('lm')!, wLy = refWindow('ly')!;
    const refs = {
      lw: statsOf(wLw.start, wLw.end),
      lm: statsOf(wLm.start, wLm.end),
      ly: statsOf(wLy.start, wLy.end),
    };
    const pick = <T,>(get: (s: ReturnType<typeof statsOf>) => T | null) => ({
      cur: get(cur),
      refs: { lw: get(refs.lw), lm: get(refs.lm), ly: get(refs.ly) } as Record<'lw' | 'lm' | 'ly', T | null>,
    });

    const mk = (key: string, label: string, unit: string | undefined, dir: 'high' | 'low',
                get: (s: ReturnType<typeof statsOf>) => number | null): MetricRow => ({
      key, label, unit, dir, ...pick(get),
    });

    const levelBand: MetricRow['band'] = {
      正常: { text: '正常', good: true },
      偏高: { text: '偏高', good: false },
      节律紊乱: { text: '节律紊乱', good: false },
    };

    return [
      {
        key: 'cortLevel', label: '皮质醇整体水平', dir: 'high', unit: undefined,
        cur: cur.level as unknown as number,
        refs: { lw: refs.lw.level as unknown as number, lm: refs.lm.level as unknown as number, ly: refs.ly.level as unknown as number },
        band: levelBand,
      },
      mk('cortAbn', '皮质醇异常天数', '天', 'low', (s) => (s.n > 0 ? s.abnDays : null)),
      mk('score', '睡眠恢复分', '分', 'high', (s) => s.score),
      mk('dur', '平均睡眠时长', 'h', 'high', (s) => (s.durH != null ? s.durH / 60 : null)),
      mk('deep', '深睡占比', '%', 'high', (s) => s.deepPct),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, sleepDaily, anchor, cortKindCache]);

  const cortAbnDaysCur = useMemo(
    () => dualPoints.filter((p) => p.cortisolAbnormal).length,
    [dualPoints],
  );

  /** 卡头右上角：区间平均恢复分 */
  const avgScore = useMemo(() => {
    const v = dualPoints.map((p) => p.score).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null;
  }, [dualPoints]);

  return (
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
          <Icon name="chevronLeft" size={22} color={mm.colors.ink} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>睡眠节律</Text>
          <Text style={styles.unit}>睡眠恢复 · 整夜分期 · 睡眠节律</Text>
        </View>
      </View>

      {/* ★ 睡眠恢复分 hero：置于日周月年「上方」，且仅日视图显示（对齐原型 v9） */}
      {range === 'day' ? (
        <SleepRecoveryHero input={dayHero.input} baseline={dayHero.baseline} />
      ) : null}

      <RangeSwitch value={range} onChange={setRange} />

      {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

      {range === 'day' ? (
        /* 日：睡眠分析（可折叠，含整夜分期 + 生理信号子折叠）+ 睡眠节律（皮质醇） */
        <>
          <SleepAnalysisCard
            day={dayAnalysis.day}
            segments={dayAnalysis.segs}
            phys={dayAnalysis.phys}
          />

          <SleepRhythmCard
            dk={dayKey(anchor)}
            isToday={dayKey(anchor) === healthDayKey(Date.now())}
          />
        </>
      ) : (
        /* 周 / 月 / 年：睡眠与恢复双纵轴图（柱=时长 · 线=恢复分 · 异常 icon 可点击） */
        <View style={[styles.chartCard, { padding: theme.space.cardPad }]}>
          {!hasData ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                暂无可展示的睡眠记录。连接戒指并将每晚睡眠同步后，这里会自动绘制睡眠与恢复趋势。
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.dualHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mTitle}>睡眠与恢复</Text>
                  <Text style={styles.cardSubLine}>
                    {range === 'week' ? '近 7 天' : range === 'month' ? '近 30 天' : '近 12 月'} · 柱 = 睡眠时长 · 线 = 恢复分
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.dualAvgVal}>{avgScore != null ? String(Math.round(avgScore)) : '—'}</Text>
                  <Text style={styles.cardSubLine}>平均恢复分</Text>
                </View>
              </View>

              <View style={{ marginTop: theme.space.xs }}>
                <SleepDualAxisChart
                  points={dualPoints}
                  onAnomalyPress={(p) => setCortSheet({ kind: p.cortisolKind, date: p.key })}
                />
              </View>

              <Text style={styles.axisNote}>左轴：睡眠时长（小时） · 右轴：睡眠恢复分（0–100）</Text>
            </>
          )}
        </View>
      )}

      {/* ★ 皮质醇异常说明弹层（双轴图 icon 点击触发） */}
      <CortisolAnomalySheet
        visible={cortSheet != null}
        onClose={() => setCortSheet(null)}
        kind={cortSheet?.kind ?? 'normal'}
        dateLabel={cortSheet?.date ?? null}
      />

      {/* ★ 多维度对比：当前 vs 上周 / 上月 / 去年（含皮质醇异常天数）—— 周/月/年显示 */}
      {range !== 'day' && cmpRows.length > 0 ? (
        <View style={styles.mCard}>
          <View style={styles.mHead}>
            <Text style={styles.mTitle}>多维度对比</Text>
            <Text style={styles.mHeadSub}>
              {range === 'week' ? '本周' : range === 'month' ? '本月' : '本年'} · 对照上周 / 上月 / 去年
            </Text>
          </View>
          <SleepMultiDimCompare
            rows={cmpRows}
            subtitle={`皮质醇与关键指标 · 本区间共 ${cortAbnDaysCur} 天皮质醇异常`}
          />
        </View>
      ) : null}

      {/* 睡眠 × 周期阶段 × 皮质醇 观察关联（仅月视图展示） */}
      {range === 'month' && (
        <View style={{ marginTop: theme.space.md }}>
          <SleepHormoneCorrelation ring={ring} />
        </View>
      )}

    </ScreenContainer>
    </View>
  );
}


const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
  back: { padding: theme.sp(1), marginLeft: -theme.sp(1) },
  titleWrap: { flexDirection: 'column' },
  title: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: mm.colors.ink },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
    minHeight: 360,
  },
  emptyWrap: { height: 200, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 22 },
  // ===== 指标行式对比卡（参考 Oura/Whoop） =====
  mCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  mHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.space.sm },
  mTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  mHeadSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  mGroupTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, marginBottom: theme.space.xs },
  mRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.space.sm },
  mNameWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  mDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.space.sm },
  mName: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, fontWeight: theme.weight.medium },
  mValWrap: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm },
  mVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, minWidth: 56, textAlign: 'right' },
  mDelta: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, minWidth: 56, textAlign: 'right' },
  mDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.ui.borderSoft },
  mFooter: {
    flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm,
    marginTop: theme.space.sm, paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  mFootItem: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  mFootVal: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  // ===== 参考线图例 =====
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.space.lg, marginTop: theme.sp(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  legendLine: { width: 18, height: 0, borderTopWidth: 2 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ===== v9 原型：双轴图卡头 / 说明行 =====
  dualHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardSubLine: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  dualAvgVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: theme.colors.accentSolid },
  axisNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.xs, textAlign: 'center' },
});
