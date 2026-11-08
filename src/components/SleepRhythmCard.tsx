/**
 * SleepRhythmCard —— 日视图「睡眠节律」卡
 *
 * 对齐 preview/sleep-rhythm.html v9 原型：
 *   卡头「睡眠节律」+ 右侧作息类型胶囊（晚睡型 / 早起型 / 常规）；
 *   下方标题「皮质醇节律趋势图」+ 全天趋势（复用 App 的 TrendChart，与洞察页同源管线）；
 *   再下方 4 格：整体水平 / 全天峰值时刻 / 昼夜起伏幅度 / 节律模式。
 *
 * ★「整体水平」那格**可点击** → 弹出 CortisolAnomalySheet，明确指出当天皮质醇
 *   是偏高 / 节律偏平 / 峰值后移。
 *
 * 数据全部真实，且与洞察页同源：`collectSamples()` → `analyzeCortisol(samples, 14)`，
 * 历史日不套用「偏高」判定（无 14 天基线不可信），与 RhythmCalendar 的口径一致。
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { buildCortisolProxyBaseline, buildCortisolProxyToday, judgeCortisolRhythm } from '../lib/cortisolProxy';
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
import { collectSamples, TrendChart, getSleepWindow } from './CortisolRhythmCard';
import CortisolAnomalySheet, { cortKindOf } from './CortisolAnomalySheet';

/**
 * ★ 2026-10-10（用户最终定调：睡眠恢复页的峰值必须和洞察页「昼夜节律」卡一模一样，
 *   不要再各自算）：这里的峰值时刻 / 作息类型**不再用 14 天 cosinor 拟合 acrophase**
 *   （那是拟合值，与洞察页「今日实测活性最高槽」必然对不上，如 13:38 vs 11 点多），
 *   改由 lib/cortisolProxy 的 `judgeCortisolRhythm()` 产出 ——
 *   与 AllDayRecoveryCard（洞察页「昼夜节律」卡 tile/AI 分析）逐字同源：
 *   · 峰值时刻 = 今日 proxy 实测活性最高槽的时钟（不是拟合相位）；
 *   · 作息类型按峰值小时判：>12 晚睡型 / <6 早起型 / 其余常规作息。
 */

interface Props {
  /** 锚点日（YYYY-MM-DD） */
  dk: string;
  /** 该日是否为「今天」——决定能否用 14 天基线判偏高 */
  isToday: boolean;
}

export default function SleepRhythmCard({ dk }: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // ★ 2026-10-10（用户最终定调：睡眠节律卡的皮质醇数据必须和洞察页「一模一样」，不再各自算）：
  //   曲线复用洞察页同款 `analyzeCortisol(collectSamples(), 14)`（同一份窗口、同一套算法、同一个 r）；
  //   峰值时刻 / 作息类型改走洞察页「昼夜节律」卡（AllDayRecoveryCard）同款 **proxy 实测判定**：
  //   `buildCortisolProxyBaseline(14)` → `buildCortisolProxyToday` → `judgeCortisolRhythm`。
  //   两条口径都对齐洞察页后，睡眠恢复页与洞察页的曲线、峰值线、峰值时刻逐位一致。
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const data = useMemo(() => {
    const samples = collectSamples();
    if (samples.length < 4) return null;
    const r = analyzeCortisol(samples, 14);
    const kind = cortKindOf({ high: r.today.high, dys: r.today.dys });
    const bl = buildCortisolProxyBaseline(14);
    const built = buildCortisolProxyToday(bl);
    const judge = judgeCortisolRhythm(built.vals, built.real);
    return { r, kind, n: samples.length, judge, baselineDays: bl.days };
  }, [hsRefresh]);

  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>睡眠节律</Text>
        <Text style={styles.empty}>
          这一天暂无足够的皮质醇数据。连上戒指并开启自动监测后，约 1 天即可开始分析昼夜节律。
        </Text>
      </View>
    );
  }

  const { r, kind, n, judge } = data;
  const co = r.cosinor;
  // ★ 2026-10-10：峰值时刻 / 作息类型 = 洞察页「昼夜节律」卡同款 proxy 实测判定（judgeCortisolRhythm），
  //   不再用 14 天 cosinor 拟合 acrophase —— 拟合相位与实测最高槽天然不同（曾出现 13:38 对不上洞察页 11 点多）。
  const cortReady = judge.ready;
  const peakClock = cortReady ? judge.peakClock : '—';
  const peakH = cortReady ? judge.peakH : null;
  const chronoLabel = peakH == null ? '—' : peakH > 12 ? '晚睡型' : peakH < 6 ? '早起型' : '常规作息';
  const chronoStyle: 'night' | 'lark' | 'flat' | null =
    peakH == null ? null : peakH > 12 ? 'night' : peakH < 6 ? 'lark' : 'flat';
  const ampOk = Number.isFinite(co.amplitude) && co.amplitude > 0;
  // 昼夜起伏幅度：cosinor 振幅（相对中值的百分比），过低即节律偏平
  const ampPct = ampOk && co.mesor > 0 ? (co.amplitude / co.mesor) * 100 : null;
  const ampFlat = ampPct != null && ampPct < 45;
  const levelText = kind === 'normal' ? '正常' : kind === 'high' ? '偏高' : kind === 'late' ? '节律紊乱' : '偏低';
  const sleepWindow = getSleepWindow(dk);

  // ★ 2026-10-10：原「节律规律性状态」黄色框（rhythmStatus）按用户要求移除，
  //   作息类型已下移到曲线下方（chronoTime），节律规律性改由「详细数据」内的
  //   昼夜起伏幅度 / 节律模式（均取自 14 天 cosinor）承载。

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>睡眠节律</Text>
      </View>

      {/* ★ 2026-10-10（用户：把「晚睡型 · 峰值」放到「睡眠节律」标题正下方，对齐睡眠分析「时长」的排版）：
          作息类型(晚睡型/早起型/常规作息) + 峰值时刻，字号 h2 semibold ink；
          数值取自洞察页「昼夜节律」卡同款 proxy 实测判定（judgeCortisolRhythm），两页逐位一致。 */}
      {chronoStyle ? (
        <View style={styles.chronoTimeRow}>
          <Text style={styles.chronoTime}>{chronoLabel} · 峰值 {peakClock}</Text>
        </View>
      ) : null}

      <Text style={styles.chartTitle}>皮质醇节律趋势图</Text>
      <View style={{ marginTop: theme.space.xs }}>
        {/* ★ 2026-10-10：睡眠恢复页这张皮质醇趋势图 = 洞察页同款 TrendChart（同一个 r、同一个组件，
            峰值竖线走 gMain.peakIdx＝今日曲线真实最高点，与洞察页图逐位一致）。
            撤掉上一版的 peakHourOverride —— 那会把峰值线钉在 14 天拟合相位上（曾落到 13:30 等
            与洞察页不符的时刻），正是「图和字对不上、跨页对不上」的元凶。 */}
        <TrendChart r={r} sleepWindow={sleepWindow} />
      </View>

      {/* ★ 2026-10-09：曲线常驻显示，4 项指标收进「详细数据」（默认收起、可展开） */}
      <Pressable onPress={() => { setDetailsOpen((v) => !v); }} style={styles.moreHead}
        accessibilityRole="button" accessibilityLabel={detailsOpen ? '收起详细数据' : '展开详细数据'}>
        <Text style={styles.moreTitle}>详细数据</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.moreCount}><Text style={styles.moreCountText}>4 项</Text></View>
          <View style={[styles.chev, detailsOpen && styles.chevOpen]}>
            <Icon name="chevronRight" size={16} color={theme.colors.textSub} />
          </View>
        </View>
      </Pressable>

      {detailsOpen ? (
      <View style={styles.block}>
        <Row
          name="整体水平（vs 14 天基线）"
          value={levelText}
          tone={kind === 'normal' ? 'ok' : kind === 'late' ? 'bad' : 'warn'}
          hint="点击查看说明"
          onPress={() => setSheetOpen(true)}
        />
        <Divider />
        <Row
          name="全天峰值时刻"
          value={peakClock}
          note="正常 06–10"
        />
        <Divider />
        <Row
          name="昼夜起伏"
          value={ampPct != null ? (ampFlat ? '偏平' : '正常') : '—'}
          tone={ampFlat ? 'warn' : 'ok'}
        />
        <Divider />
        <Row
          name="作息类型"
          value={chronoLabel}
          note="按峰值时段"
          last
        />
      </View>
      ) : null}

      <Text style={styles.disclaimer}>
        基于戒指压力代理值（非化验级皮质醇）· 近14天样本 {n} 条 · 仅供参考
      </Text>

      <CortisolAnomalySheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        kind={kind}
        dateLabel={dk}
      />
    </View>
  );
}

/** 行式指标：标签左 · 数值右（可带参考说明 / 点击提示） */
function Row({
  name, value, note, hint, tone, onPress, last,
}: {
  name: string; value: string; note?: string; hint?: string;
  tone?: 'ok' | 'warn' | 'bad'; onPress?: () => void; last?: boolean;
}) {
  const valStyle = tone === 'ok' ? styles.rowValOk : tone === 'warn' ? styles.rowValWarn : tone === 'bad' ? styles.rowValBad : null;
  const body = (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowName}>{name}</Text>
      <View style={styles.rowRight}>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
        <Text style={[styles.rowVal, valStyle]}>{value}</Text>
        {hint ? <Text style={styles.rowHint}>›</Text> : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
      accessibilityRole="button"
      accessibilityLabel={`${name} ${value}${hint ? '，' + hint : ''}`}
    >
      {body}
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
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
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  chartTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.md },
  // ★ 2026-10-10：作息类型（晚睡型/早起型/常规作息）+ 峰值时刻，下移到曲线下方，
  //   字号对齐睡眠分析「时长」（h2 semibold ink），与洞察页峰值时段同源。
  chronoTimeRow: { marginTop: theme.space.sm },
  chronoTime: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  // 行式指标（替代原 2×2 数字格）
  block: { marginTop: theme.space.md },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: theme.space.sm,
  },
  rowLast: { paddingBottom: 0 },
  rowName: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  rowVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  rowValOk: { color: mm.colors.limeCore },
  rowValWarn: { color: mm.colors.honeyDeep },
  rowValBad: { color: mm.colors.roseDeep },
  rowNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  rowHint: { fontSize: theme.fontSize.micro, color: theme.colors.accentText },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.ui.borderSoft },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.sm, lineHeight: 20 },
  disclaimer: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, opacity: 0.8 },
  // 「详细数据」折叠头（2026-10-10：改 G 样式——扁平行 + 顶部发丝线，去掉灰底描边盒）
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
  chev: { transform: [{ rotate: '90deg' }], marginLeft: theme.space.sm },
  chevOpen: { transform: [{ rotate: '-90deg' }] },
});
