/**
 * OxygenApneaSection —— 呼吸暂停（OSAHS）分析卡
 *
 * ★ 2026-11-05（用户 E）：原本只在「血氧」详情页渲染；用户要求**睡眠恢复详情页**也展示
 *   OSAHS（阻塞性睡眠呼吸暂停低通气综合征），因为呼吸暂停本质上是睡眠期现象。
 *   因此把该组件抽成独立可复用组件，血氧页与睡眠恢复页共用同一份实现与样式。
 *
 * ★ 2026-11-14（用户）：「睡眠呼吸暂停这里面经常是没有数据」，以及「几个模块一直没有数据，
 *   比方说夜间低氧时间百分比是 0 就显示 0，不要显示杠」。两个根因：
 *
 *   ① 整卡空态：旧实现只认 `ring.oxygenAnalysis`。那条通道走原生 readOriginDataBySetting
 *      回读设备 SpO2 原始历史包，要求戒指当时已连接 + 设备端全天血氧自动监测开着 +
 *      最近几夜真的落了原始点。真机现场日志实证：进页面时直接 `[O2-ANALYSIS] ring_not_connected`，
 *      随后 20s 连接超时，整卡就一直空着。而同一天 healthStore 里其实有 160 个真实血氧点
 *      （`[Batch] ✅ spo2 n=160`），数据一直在，只是没被用。
 *      → 现在改用 `computeNightOxygen()` 从**已落库的夜间血氧逐样本**兜底算客观指标，
 *        设备原生分析只负责 OSAHS 分级 / 心脏负荷这类推不出来的字段。
 *
 *   ② 0 被显示成杠：旧代码 5 处 `a.xxx || '--'` + `!a.xxx` 提示，把「整夜没有低氧事件」
 *      这种**合法且健康的 0** 当成「没数据」，还附一句误导的「需全天血氧监测数据」。
 *      → 全部改成 nullish 判断，0 如实显示 0；只有 null / undefined 才显示 '--'。
 *      → 新增「夜间低氧占比 %」：0% 就显示 0%，不显示杠。
 *
 * 数据纪律：不编造任何数值，全部来自已同步的真实血氧样本或设备原生分析；
 *          来源与统计口径在卡底如实标注。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { useRingState } from '../hooks/useRingState';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { RingBle } from '../ble/RingBleManager';
import { dayKey } from '../data/healthStore';
import { computeNightOxygen } from '../lib/nightOxygen';
import { fmtMetric, hasValue } from '../lib/metricFormat';

export const OSAHS_LEVELS: { [k: number]: { label: string; color: string } } = {
  [-1]: { label: '暂无结果', color: theme.colors.textSub },
  0: { label: '正常', color: mm.colors.skyDeep },
  1: { label: '轻度', color: mm.colors.honeyCore },
  2: { label: '中度', color: mm.colors.roseMid },
  3: { label: '重度', color: mm.colors.roseDeep },
};

/** 原生错误码 → 用户能看懂的中文原因（旧实现直接把 ring_not_connected 甩给用户） */
function explainError(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = String(code);
  if (/ring_not_connected|戒指未连接/i.test(c)) return '戒指当时还没连上，已自动改用本机已同步的血氧数据。';
  if (/no_data|暂无夜间血氧原始记录/i.test(c)) return '设备端还没有可回读的夜间血氧原始记录，已改用本机已同步的血氧数据。';
  if (/parse_failed|解析失败/i.test(c)) return '设备血氧原始记录解析失败，已改用本机已同步的血氧数据。';
  if (/read_failed|读取失败/i.test(c)) return '读取设备血氧历史失败，已改用本机已同步的血氧数据。';
  return `血氧分析未完成（${c}），已改用本机已同步的血氧数据。`;
}

export function OxygenApneaSection({ title = '呼吸暂停分析' }: { title?: string }) {
  const ring = useRingState();
  // ★ 兜底读的是 healthStore，不经过 RingState；离线回填完成时若不订阅就不会刷新卡片。
  const hsVer = useHealthStoreVersion();
  const [loading, setLoading] = useState(false);
  const a = ring.oxygenAnalysis;
  const osahs = a ? (OSAHS_LEVELS[a.osahsResult] ?? OSAHS_LEVELS[-1]) : null;
  const freqTimes: string[] = Array.isArray(a?.freqTimes) ? a.freqTimes : [];

  /**
   * ★ 2026-11-14：兜底数据源。用已落库的夜间血氧逐样本算客观指标。
   * 真机实证每天有 100~160 个 spo2 点，不依赖「设备那次 25s 回读」是否成功。
   */
  const local = useMemo(() => {
    const dk = dayKey(Date.now());
    const sum = (ring.sleepDaily as any)?.[dk]
      ?? (ring.sleepDaily as any)?.[dayKey(Date.now() - 86400_000)]
      ?? null;
    return computeNightOxygen(dk, {
      sleepTime: sum?.sleepTime ?? (ring as any)?.sleepTime ?? null,
      wakeTime: sum?.wakeTime ?? (ring as any)?.wakeTime ?? null,
      totalMin: sum?.total ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, hsVer]);

  /** 设备值与本地值合并：本地样本优先（更全、不依赖单次回读），设备值补本地算不出的字段。
   *  ★ 2026-11-14（用户）：设备分析通道的呼吸率恒回 0（固件没算），0 次/分不是真实读数，
   *  必须按生理下限（≥3 次/分）过滤掉，没数据就如实显示「—」。 */
  const v = useMemo(() => ({
    aveOxygen: local.hasData ? local.aveOxygen : (hasValue(a?.aveOxygen) && a!.aveOxygen > 0 ? a!.aveOxygen : null),
    minOxygen: local.hasData ? local.minOxygen : (hasValue(a?.minOxygen) && a!.minOxygen > 0 ? a!.minOxygen : null),
    aveRespRate: local.aveRespRate ?? (hasValue(a?.aveRespRate) && a!.aveRespRate >= 3 ? a!.aveRespRate : null),
    lowOxygenSec: local.hasData ? local.lowOxygenSec : (hasValue(a?.aveLowOxygenTime) ? a!.aveLowOxygenTime : null),
    lowOxygenPct: local.hasData ? local.lowOxygenPct : null,
    aveCardiacLoad: hasValue(a?.aveCardiacLoad) ? a!.aveCardiacLoad : null,
    samples: local.samples,
  }), [local, a]);

  // 触发去重：两个页面实例 + 挂载/ready 两个 effect 会并发多次发起原生 25s 回读。
  const inFlightRef = useRef(false);
  const lastTriggerRef = useRef(0);
  const reload = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    const now = Date.now();
    // 成功过就不重复拉；失败也至少隔 60s 再试，避免每次进页面都空等 26s。
    if (!force && (a || now - lastTriggerRef.current < 60_000)) return;
    inFlightRef.current = true;
    lastTriggerRef.current = now;
    setLoading(true);
    try { await RingBle.triggerOxygenAnalysis(); } finally {
      inFlightRef.current = false;
    }
  }, [a]);

  // 进入页面：仅在戒指已连接时才触发设备回读；未连接不发起必然失败的调用。
  useEffect(() => {
    if (ring.status === 'connected') void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 连接恢复后补跑一次（原生 ready 晚于 JS status 时有用）
  const ready = ring.status === 'connected';
  useEffect(() => {
    if (ready && !a) void reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ★ loading 由「结果或错误到达」驱动结束，不再死等固定 26s。
  useEffect(() => {
    if (a || ring.oxygenAnalysisError) setLoading(false);
  }, [a, ring.oxygenAnalysisError]);
  // 兜底上限：原生最多 25s，多给 1s
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 26_000);
    return () => clearTimeout(t);
  }, [loading]);

  const errText = explainError(ring.oxygenAnalysisError);
  /** 只有「设备分级没有」且「本机也没有血氧样本」时才是真的整卡无数据 */
  const noDataAtAll = !a && !local.hasData;

  return (
    <Card>
      <Text style={styles.ecgTitle}>{title}</Text>

      {noDataAtAll ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {errText ?? '这一夜还没有同步到血氧样本。连接戒指并完成一次夜间佩戴后，这里会自动出现数据。'}
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均血氧</Text>
              <Text style={[styles.statValue, { color: (v.aveOxygen ?? 0) >= 95 ? mm.colors.limeMid : (v.aveOxygen ?? 0) >= 90 ? mm.colors.honeyCore : (v.aveOxygen ?? 0) > 0 ? mm.colors.roseDeep : theme.colors.textTitle }]}>
                {fmtMetric(v.aveOxygen, 1)}<Text style={styles.statLabel}> %</Text>
              </Text>
              {!hasValue(v.aveOxygen) ? <Text style={styles.statHint}>暂无血氧样本</Text> : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低血氧</Text>
              <Text style={[styles.statValue, { color: (v.minOxygen ?? 0) >= 95 ? mm.colors.limeMid : (v.minOxygen ?? 0) >= 90 ? mm.colors.honeyCore : (v.minOxygen ?? 0) > 0 ? mm.colors.roseDeep : theme.colors.textTitle }]}>
                {fmtMetric(v.minOxygen)}<Text style={styles.statLabel}> %</Text>
              </Text>
              {!hasValue(v.minOxygen) ? <Text style={styles.statHint}>暂无血氧样本</Text> : null}
            </View>
            <View style={styles.statCell}>
              {/* ★ 2026-11-14（用户）：标题改「呼吸暂停风险」；没有风险事件时（分级正常或暂无设备分级）
                  统一写「暂无风险」，不写「无，暂无风险」这类冗余前缀。 */}
              <Text style={styles.statLabel}>呼吸暂停风险</Text>
              <Text style={[styles.statValue, { color: osahs && a && a.osahsResult >= 1 ? osahs.color : theme.colors.textTitle, fontSize: theme.fontSize.body }]}>
                {a && a.osahsResult >= 1 ? (osahs?.label ?? '暂无结果') : '暂无风险'}
              </Text>
            </View>
          </View>

          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>低氧时间</Text>
              {/* ★ 0 秒 = 整夜没有低氧事件，是健康的真实结果，必须显示 0，不能显示杠 */}
              <Text style={styles.statValue}>{fmtMetric(v.lowOxygenSec)}<Text style={styles.statLabel}> s</Text></Text>
              {!hasValue(v.lowOxygenSec) ? <Text style={styles.statHint}>暂无血氧样本</Text> : null}
            </View>
            <View style={styles.statCell}>
              {/* ★ 2026-11-14（用户）：呼吸率格整格去掉 —— 本机型固件恒不回传呼吸率（实测恒 0），
                  过滤后永远显示「—」，按「没数据就删」纪律下线。 */}
              <Text style={styles.statLabel}>夜间低氧占比</Text>
              <Text style={styles.statValue}>{fmtMetric(v.lowOxygenPct, 1)}<Text style={styles.statLabel}> %</Text></Text>
              {!local.hasData ? <Text style={styles.statHint}>暂无血氧样本</Text> : null}
            </View>
          </View>

          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>心脏负荷（均）</Text>
              <Text style={styles.statValue}>{fmtMetric(v.aveCardiacLoad, 1)}</Text>
              {hasValue(v.aveCardiacLoad)
                ? <Text style={styles.statHint}>设备按夜间血氧与心率算出的负荷指数</Text>
                : <Text style={styles.statHint}>本机型未回传心脏负荷</Text>}
            </View>
          </View>

          {freqTimes.length > 0 ? (
            <View style={styles.note}>
              <Text style={styles.note}>呼吸暂停频现时段：{freqTimes.join('、')}</Text>
            </View>
          ) : null}

          {errText ? <Text style={styles.note}>{errText}</Text> : null}
          <Text style={styles.note}>
            低氧时间按每点约 1 分钟计，0 表示这一夜没有低氧事件。
          </Text>
          <Text style={styles.note}>数据来自戒指血氧测量，仅供参考，不作为睡眠呼吸暂停综合征诊断依据。</Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  ecgTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  statGrid: {
    flexDirection: 'row',
    gap: theme.sp(2),
    marginTop: theme.sp(1),
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(1),
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  statValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  statHint: { fontSize: theme.fontSize.micro - 2, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});
