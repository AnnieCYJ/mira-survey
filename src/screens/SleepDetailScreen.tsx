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
import { useMemo, useState, useDeferredValue } from 'react';
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
import SleepRecoveryHero from '../components/SleepRecoveryHero';
import SleepDualAxisChart, { type DualPoint } from '../components/SleepDualAxisChart';
import SleepMultiDimCompare, { type MetricRow } from '../components/SleepMultiDimCompare';
import CortisolAnomalySheet, { type CortAnomKind } from '../components/CortisolAnomalySheet';
import { sleepRecoveryScoreForDay } from '../lib/sleepPersonalized';
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

/**
 * 当前区间窗口（周=自然周 / 月=自然月 / 年=整年 / 日=当天）
 *
 * ★ 2026-10-07（用户实锤：「未来的日期也画上了，这不瞎说吗」）：
 *   **未来永远没有数据**，窗口右端必须截断到「此刻」。
 *   原实现直接返回自然周/月/年的完整区间 —— 今天 10/7，周视图会把 10/8~10/11、
 *   月视图会把 10/8~10/31、年视图会把今年剩下的所有日期都当成数据点铺到横轴上，
 *   虽然柱子是空的，但横轴刻度、网格、统计分母全是未来的日子，视觉上就是「画上了」。
 *   ⚠ 只截断**当前周期**：anchor 在过去时（翻日历看历史周/月/年）窗口本来就全在过去，不受影响。
 */
function windowOf(dRange: RangeKey, anchor: Date): { start: Date; end: Date } {
  const now = new Date();
  const clampEnd = (e: Date): Date => (e.getTime() > now.getTime() ? now : e);
  if (dRange === 'week') return { start: startOfWeek(anchor), end: clampEnd(endOfWeek(anchor)) };
  if (dRange === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m, 1);
    const e = new Date(y, m + 1, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: clampEnd(e) };
  }
  if (dRange === 'year') {
    const y = anchor.getFullYear();
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: clampEnd(e) };
  }
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: clampEnd(e) };
}
/** 上一等长周期窗口（用于「环比上一周期」对比） */
function prevWindowOf(dRange: RangeKey, anchor: Date): { start: Date; end: Date } {  if (dRange === 'week') {
    const s = startOfWeek(anchor), e = endOfWeek(anchor);
    s.setDate(s.getDate() - 7); e.setDate(e.getDate() - 7);
    return { start: s, end: e };
  }
  if (dRange === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 0); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (dRange === 'year') {
    const y = anchor.getFullYear() - 1;
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  const a = new Date(anchor); a.setDate(a.getDate() - 1); a.setHours(0, 0, 0, 0);
  const e = new Date(a); e.setHours(23, 59, 59, 999);
  return { start: a, end: e };
}

/** 一个时间窗口内的派生统计（多维度对比用） */
interface Stats {
  /** 窗口内有真实睡眠记录的天数 */
  n: number;
  /** 平均睡眠时长（分钟） */
  durH: number | null;
  /** 平均睡眠恢复分 0–100 */
  score: number | null;
  /** 平均深睡占比 % */
  deepPct: number | null;
  /** 皮质醇异常天数 */
  abnDays: number;
  /** 皮质醇整体水平档位 */
  level: '正常' | '偏高' | '节律紊乱' | null;
}

/**
 * 单日「睡眠恢复分」（**个人相对口径**，50 = 和平时一样）。
 * ★ 2026-10-07（用户定口径）：此前详情页用绝对分 computeSleepScore（100=达标），
 *   与首页的个人相对分（50=平时）同屏出现两个数（首页 65 / 详情 97），用户不知道信哪个。
 *   现全 App 统一走 `sleepRecoveryScoreForDay`（与首页圆环 chip / 睡眠节律卡 / SleepCard 同源）。
 */
function scoreOfDayMs(dayMs: number): number | null {
  return sleepRecoveryScoreForDay(dayMs);
}

/** 统计 [start,end] 窗口；cortKind 由调用方注入（判「今天」依赖 anchor，故不做模块级缓存） */
function statsOf(
  recs: { key: string; date: Date; rec: DayRec }[],
  start: Date,
  end: Date,
  cortKind: (dk: string) => CortAnomKind,
): Stats {
  const rs = recs.filter((r) => r.date.getTime() >= start.getTime() && r.date.getTime() <= end.getTime());
  const recsOnly = rs.map((r) => r.rec).filter((r) => r.total > 0);
  const scores = rs.map((r) => scoreOfDayMs(r.date.getTime())).filter((v): v is number => v != null);
  let abnDays = 0, anyHigh = false, anyDys = false;
  for (const r of rs) {
    const k = cortKind(r.key);
    if (k !== 'normal') abnDays += 1;
    if (k === 'high') anyHigh = true;
    if (k === 'late') anyDys = true;
  }
  return {
    n: recsOnly.length,
    durH: meanOf(recsOnly.map((r) => r.total)),
    score: scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null,
    deepPct: meanOf(recsOnly.map((r) => (r.total > 0 ? (r.deep / r.total) * 100 : null))),
    abnDays,
    level: anyDys ? '节律紊乱' : anyHigh ? '偏高' : recsOnly.length ? '正常' : null,
  };
}

export default function SleepDetailScreen() {
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [range, setRange] = useState<RangeKey>('day');
  // ★ B4（2026-10-08）：range 的「延迟版」—— 切档时 chip 高亮即时（用 range），
  //   重计算与图表用 dRange 稍后跟上，消除「点了要等一段」的体感。
  const dRange = useDeferredValue(range);
  const [anchor, setAnchor] = useState<Date>(new Date());
  // ★ 皮质醇异常说明弹层（双轴图 icon 点击 / 节律卡「整体水平」点击 共用）
  const [cortSheet, setCortSheet] = useState<{ kind: CortAnomKind; date: string } | null>(null);

  // ★ key 格式必须与 RingBleManager.dayKeyOf 一致 (YYYY-MM-DD 补零)，否则 sleepDaily map 永远匹配不上
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ★ 睡眠日 = 自然日，与 RingBleManager.dayKeyOf 的归档口径严格一致：
  //   戒指把每场睡眠按「起床日」归档（例：昨晚入睡 → 今早起床，落在 today 的 key 下），
  //   因此白天打开「日」视图读 today，天然就能见到昨夜睡眠，无需任何 18:00 回溯。
  //   若当日尚无归档（今天还没产生睡眠 / 未同步），各卡一律显示「暂无 / —」，
  //   绝不把更早日期的旧睡眠挪用进来填充当前窗口（此前 18:00 回溯会误读上一晚的旧数据）。
  const sleepDayKey = (anchor: Date): string => {
    return dayKey(anchor);
  };

  const sleepDaily = ring.sleepDaily ?? {};


  /** 该区间是否至少有一天真实睡眠记录（双轴图空态判断用） */
  const hasData = useMemo(() => {
    const recs = toRecords(sleepDaily);
    if (recs.length === 0) return false;
    if (dRange === 'day') {
      const dk = sleepDayKey(anchor);
      return recs.some((r) => r.key === dk);
    }
    const win = windowOf(dRange, anchor);
    return recs.some((r) => r.date.getTime() >= win.start.getTime() && r.date.getTime() <= win.end.getTime());
  }, [dRange, sleepDaily, anchor]);

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

  // ★ 2026-10-07：删除组件内的绝对分 scoreOfDay —— 统一改用模块级 scoreOfDayMs（个人相对分）。

  /** 当前区间的取点序列（周=每天 / 月=每天 / 年=每月均值），供双轴图使用 */
  const dualPoints: DualPoint[] = useMemo(() => {
    if (dRange === 'day') return [];
    const recs = toRecords(sleepDaily);
    const map = new Map(recs.map((r) => [dayKey(r.date), r.rec]));
    const isYear = dRange === 'year';

    if (isYear) {
      // 年 = 12 个月的月内均值（对齐原型「年用月平均」）
      // ★ 2026-10-07：**未来的月份不画**（同 windowOf 的截断口径）。
      //   看今年时，10 月之后的月份还没发生，不该出现在横轴上。
      const y = anchor.getFullYear();
      const nowY = new Date().getFullYear();
      const nowM = new Date().getMonth();          // 0-based
      const lastM = y === nowY ? nowM : (y < nowY ? 11 : -1);   // -1 ⇒ 整年都在未来（不画任何月）
      const buckets: { entries: { date: Date; rec: DayRec }[]; label: string; key: string }[] = [];
      for (let m = 0; m <= lastM; m++) {
        const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
        const inM = recs.filter((r) => dayKey(r.date).startsWith(prefix));
        buckets.push({ entries: inM.map((r) => ({ date: r.date, rec: r.rec })), label: `${m + 1}月`, key: prefix });
      }
      return buckets.map((b) => {
        const durMin = meanOf(b.entries.map((e) => (e.rec.total > 0 ? e.rec.total : null)));
        const scores = b.entries.map((e) => scoreOfDayMs(e.date.getTime())).filter((v): v is number => v != null);
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
    const win = windowOf(dRange, anchor);
    const out: DualPoint[] = [];
    const cur = new Date(win.start); cur.setHours(0, 0, 0, 0);
    const end = new Date(win.end); end.setHours(0, 0, 0, 0);
    while (cur.getTime() <= end.getTime()) {
      const dk = dayKey(cur);
      const rec = map.get(dk);
      const c = cortKindOfDay(dk);
      out.push({
        key: dk,
        label: dRange === 'week'
          ? ['日', '一', '二', '三', '四', '五', '六'][cur.getDay()]
          : String(cur.getDate()),
        durationMin: rec && rec.total > 0 ? rec.total : null,
        score: rec ? scoreOfDayMs(cur.getTime()) : null,
        cortisolAbnormal: c.abn,
        cortisolKind: c.kind,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dRange, sleepDaily, anchor, cortKindCache]);

  /** 日视图：睡眠分析卡 + 生理信号（全部真实归档字段） */
  const dayAnalysis = useMemo<{ day: DaySleepAnalysis | null; segs: SleepSegment[] | null; phys: DayPhys }>(() => {
    const dk = sleepDayKey(anchor);
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

  /** 多维度对比：当前 vs **上一同量级周期**
   *  ★ 周→上周 / 月→上月 / 年→去年（绝不把上周·上月·去年三个口径并列，维度会错位） */
  const cmpRows = useMemo<MetricRow[]>(() => {
    if (dRange === 'day') return [];
    const recs = toRecords(sleepDaily);
    if (recs.length === 0) return [];

    const cw = windowOf(dRange, anchor);
    const cur = statsOf(recs, cw.start, cw.end, (dk) => cortKindOfDay(dk).kind);
    const pw = prevWindowOf(dRange, anchor);   // 上一周 / 上月 / 去年
    const prev = statsOf(recs, pw.start, pw.end, (dk) => cortKindOfDay(dk).kind);

    const pick = <T,>(get: (s: Stats) => T | null) => ({ cur: get(cur), prev: get(prev) });

    const mk = (key: string, label: string, unit: string | undefined, dir: 'high' | 'low',
                get: (s: Stats) => number | null): MetricRow => ({ key, label, unit, dir, ...pick(get) });

    const levelBand: MetricRow['band'] = {
      正常: { text: '正常', good: true },
      偏高: { text: '偏高', good: false },
      节律紊乱: { text: '节律紊乱', good: false },
    };

    return [
      {
        key: 'cortLevel', label: '皮质醇整体水平', dir: 'high', unit: undefined,
        cur: cur.level as unknown as number,
        prev: prev.level as unknown as number,
        band: levelBand,
      },
      mk('cortAbn', '皮质醇异常天数', '天', 'low', (s) => (s.n > 0 ? s.abnDays : null)),
      mk('score', '睡眠恢复分', '分', 'high', (s) => s.score),
      mk('dur', '平均睡眠时长', 'h', 'high', (s) => (s.durH != null ? s.durH / 60 : null)),
      mk('deep', '深睡占比', '%', 'high', (s) => s.deepPct),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dRange, sleepDaily, anchor, cortKindCache]);

  /** 本周期 / 参照周期 的表头文案（随 dRange 变） */
  const cmpLabels = dRange === 'week' ? { cur: '本周', prev: '上周' }
    : dRange === 'month' ? { cur: '本月', prev: '上月' }
    : { cur: '本年', prev: '去年' };

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
          <Text style={styles.title}>睡眠恢复</Text>
          <Text style={styles.unit}>整夜分期 · 睡眠节律</Text>
        </View>
      </View>

      {/* 日视图：睡眠恢复分主结论（SleepRecoveryHero，对齐原型 v9）。
          周/月/年的区间均值改回图表卡头右上角（2026-10-09 用户反馈顶部读数空白，
          回退到原先可用的卡头位置，保证一定有数值）。 */}
      {dRange === 'day' ? <SleepRecoveryHero anchorMs={anchor.getTime()} /> : null}

      <RangeSwitch value={range} onChange={setRange} />

      {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={dRange} />

      {dRange === 'day' ? (
        /* 日：睡眠分析（可折叠，含整夜分期 + 生理信号子折叠）+ 睡眠节律（皮质醇） */
        <>
          <SleepAnalysisCard
            day={dayAnalysis.day}
            segments={dayAnalysis.segs}
            phys={dayAnalysis.phys}
          />

          <SleepRhythmCard
            dk={sleepDayKey(anchor)}
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
                    {dRange === 'week' ? '近 7 天' : dRange === 'month' ? '近 30 天' : '近 12 月'} · 柱 = 睡眠时长 · 线 = 恢复分
                  </Text>
                </View>
                {/* ★ 2026-10-09 回退：平均恢复分放回卡头右上角（顶部 hero 在你真机渲染空白） */}
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

      {/* ★ 多维度对比：当前 vs 上一同量级周期（周→上周 / 月→上月 / 年→去年）—— 周/月/年显示 */}
      {dRange !== 'day' && cmpRows.length > 0 ? (
        <View style={styles.mCard}>
          <View style={styles.mHead}>
            <Text style={styles.mTitle}>多维度对比</Text>
            <Text style={styles.mHeadSub}>{cmpLabels.cur} vs {cmpLabels.prev}</Text>
          </View>
          <SleepMultiDimCompare
            rows={cmpRows}
            curLabel={cmpLabels.cur}
            prevLabel={cmpLabels.prev}
            subtitle={`皮质醇与关键指标 · 本区间共 ${cortAbnDaysCur} 天皮质醇异常`}
          />
        </View>
      ) : null}

      {/* 睡眠 × 周期阶段 × 皮质醇 观察关联（仅月视图展示） */}
      {dRange === 'month' && (
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
  // ===== 周/月/年顶部「平均恢复分」hero（与日视图 SleepRecoveryHero 同款视觉） =====
  heroAvg: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
    paddingHorizontal: 2,
  },
  heroAvgScore: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    lineHeight: 48,
  },
  heroAvgLabel: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep },
  heroAvgSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
});
