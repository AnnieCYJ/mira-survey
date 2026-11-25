/**
 * NightBpCard —— 睡眠恢复详情页「夜间血压参考」卡（Oura 对标 · 推导指标）
 *
 * ★ 2026-11-06（用户：「除了没有体温传感器，其他的我其实应该可以做个血压……补齐了，
 *   参考开源的一些个算法……放在睡眠恢复就是睡眠模块的相应位置上」）。
 *
 * 数据与口径（全部真实数据，不造假；不做绝对血压推算——无连续 PPG 波形与个人校准，
 *   编一个血压数值反而违反「不诊断/不评分」铁律。参考 Oura 做法：睡眠页给夜间心血管
 *   相关**趋势参考**，绝对血压走手动光电测量 BpDetailScreen）：
 *  1. 最近一次血压测量（真实：healthStore bpSys/bpDia intraday 最近点，来自光电测量/健康一览）。
 *  2. 近 7 天有测量的日的均值（getDay().mean）。
 *  3. 夜间心率下降（dipping 近似参考）：★ 2026-11-11 起「夜间」按该日真实入睡/起床
 *     时刻切分（不再写死 22:00–07:00），夜间 HR 相对清醒时段 HR 的下降百分比。
 *     公开生理学口径：夜间血压/心率较日间下降 ≥10% 为正常 dipping
 *     （non-dipping 与心血管风险相关）。**此处用心率近似血压 dipping**，仅作生活方式参考，
 *     需连续夜间血压才能给出血压 dipping 本身。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { healthStore, dayKey, type TimePoint } from '../data/healthStore';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { parseClockMinutes } from '../lib/sleepTime';
// ★ 2026-11-25（用户）：夜间心率下降 / 夜间日间心率 加「?」说明；底部改成基于当前数据的分析
import InfoDot from './InfoDot';
import SleepInfoSheet, { type SleepInfoKey } from './SleepInfoSheet';

const DAY_MS = 86400000;

interface Props {
  /** 锚定日（睡眠恢复页当前选中日，默认今天） */
  anchorMs?: number;
}

/**
 * ★ 2026-11-08（用户：「夜间心率下降 / 夜间日间心率 没展示」排查）：
 *   旧实现用固定时钟窗 nightHrMean(22–06) / daytimeHrMean(07–22) 各自独立读 intraday，
 *   但精简版戒指白天有效 HR 读数很稀疏（全天约 39 个有效点，且多集中在睡眠段），
 *   导致 daytimeHrMean 经常返回 null → 两个格都因依赖 dayHr 而显示 '--'。
 *   现改为：一次性跨 [前日/当日/次日] 收集全部 HR 逐样本，
 *   - 夜间心率：取**该日真实睡眠窗口（入睡→起床）**里最低 25% 均值（静息心率近似，
 *     与 computeNightPhys 同源口径）；无睡眠记录才回退到固定 22–07 点；
 *   - 日间心率：取当日清醒时段均值；样本过少（<3）时回退到当天日均值，并标注「日=全天均值」。
 *   这样只要当天有任意 HR 数据，两个格都会显示真实数值；完全没有 HR 时才诚实地 '--'。
 */
function collectHr(days: string[]): { h: number; v: number; t: number }[] {
  const out: { h: number; v: number; t: number }[] = [];
  for (const dk of days) {
    for (const p of healthStore.getIntraday('hr', dk)) {
      if (typeof p.t === 'number' && typeof p.v === 'number' && Number.isFinite(p.v)) {
        out.push({ h: new Date(p.t).getHours(), v: p.v, t: p.t });
      }
    }
  }
  return out;
}
function meanVal(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number.isFinite(s) ? Math.round(s * 10) / 10 : null;
}
/** 静息心率近似：最低 25% 均值（夜间 HR 波动里的低段） */
function lowestQuartileMean(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const n = Math.max(1, Math.ceil(s.length * 0.25));
  return meanVal(s.slice(0, n));
}

export function NightBpCard({ anchorMs }: Props) {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const data = useMemo(() => {
    const dayMs = anchorMs ?? Date.now();
    const dk = dayKey(dayMs);
    // ★ 2026-11-06（用户「接上真的数据」）：基础版 LunaMira 无原生光电血压（proOnly），
    //   但用户可走「手动记录」入口自填血压（写 manualBpSys/manualBpDia）。
    //   因此同时读原生(戒指光电/健康一览)与手动两路，合并取最新 / 合并日均值。
    const latestBpForDay = (d: string): { sys: number; dia: number; t: number; manual: boolean } | null => {
      const ns = healthStore.getIntraday('bpSys', d);
      const nd = healthStore.getIntraday('bpDia', d);
      const ms = healthStore.getIntraday('manualBpSys', d);
      const md = healthStore.getIntraday('manualBpDia', d);
      const sysPts = [...ns, ...ms].sort((a, b) => a.t - b.t);
      const diaPts = [...nd, ...md].sort((a, b) => a.t - b.t);
      if (!sysPts.length || !diaPts.length) return null;
      const sLast = sysPts[sysPts.length - 1];
      const dLast = diaPts[diaPts.length - 1];
      const t = Math.max(sLast.t, dLast.t);
      const manual = (ms.length > 0 && sLast.t >= ms[ms.length - 1].t)
        || (md.length > 0 && dLast.t >= md[md.length - 1].t);
      return { sys: sLast.v, dia: dLast.v, t, manual };
    };
    // 1) 最近一次血压测量（该日优先，往前找 7 天内最近一次；原生或手动任一即可）
    let sys: number | null = null;
    let dia: number | null = null;
    let measuredAt: number | null = null;
    let measuredManual = false;
    for (let i = 0; i < 7; i++) {
      const r = latestBpForDay(dayKey(dayMs - i * DAY_MS));
      if (r) { sys = r.sys; dia = r.dia; measuredAt = r.t; measuredManual = r.manual; break; }
    }
    // 2) 近 7 天有测量的日均值（≥2 天才给均值，1 天无趋势意义；原生/手动取其一，手动优先）
    const sysDays: number[] = [];
    const diaDays: number[] = [];
    let measuredDayCount = 0;
    for (let i = 0; i < 7; i++) {
      const d = dayKey(dayMs - i * DAY_MS);
      const s = healthStore.getDay('manualBpSys', d)?.mean ?? healthStore.getDay('bpSys', d)?.mean ?? null;
      const di = healthStore.getDay('manualBpDia', d)?.mean ?? healthStore.getDay('bpDia', d)?.mean ?? null;
      if (s != null && di != null) { sysDays.push(s); diaDays.push(di); measuredDayCount++; }
    }
    const sysAvg = sysDays.length >= 2 ? sysDays.reduce((a, b) => a + b, 0) / sysDays.length : null;
    const diaAvg = diaDays.length >= 2 ? diaDays.reduce((a, b) => a + b, 0) / diaDays.length : null;
    // 3) 夜间心率 dipping 近似（★ 2026-11-08 重写：跨日收集 + 静息近似 + 全天均值兜底）
    const prev = dayKey(dayMs - DAY_MS);
    const next = dayKey(dayMs + DAY_MS);
    const allHr = collectHr([prev, dk, next]);
    // ★ 2026-11-11（用户：详情页夜间时间要按真实入睡/起床）：dipping 的夜间段
    //   由该日原生 sleepTime/wakeTime 决定；无睡眠记录才回退到 22:00–07:00。
    const dayStart = new Date(`${dk}T00:00:00`).getTime();
    const sl = healthStore.getSleep(dk);
    const bedMin = parseClockMinutes(sl?.sleepTime);
    const wakeMin = parseClockMinutes(sl?.wakeTime);
    const bedH = bedMin != null ? bedMin / 60 : (sl?.bedHour ?? null);
    const wakeH = wakeMin != null ? wakeMin / 60 : (sl?.wakeHour ?? null);
    let bedPrev: number | null = null, wake: number | null = null, bedTonight: number | null = null;
    if (bedH != null && wakeH != null) {
      bedPrev = bedH >= 12 ? dayStart - (24 - bedH) * 3600_000 : dayStart + bedH * 3600_000;
      wake = dayStart + wakeH * 3600_000;
      if (wake <= bedPrev) wake += DAY_MS;
      bedTonight = bedPrev + DAY_MS;
    }
    const isNightPt = (p: { h: number; t: number }): boolean => {
      if (bedPrev != null && wake != null && bedTonight != null) {
        // 昨夜入睡 → 今早起床，以及今晚入睡 → 明早起床（若已同步次日数据）。
        return (p.t >= bedPrev && p.t <= wake)
          || (p.t >= bedTonight && p.t <= bedTonight + (wake - bedPrev));
      }
      return p.h >= 22 || p.h < 7;
    };
    const nightPts = allHr.filter(isNightPt).map((p) => p.v);
    // 清醒时段只取本页当天，避免把前/后一天的白天样本混进日间均值。
    const dayPts = allHr
      .filter((p) => p.t >= dayStart && p.t < dayStart + DAY_MS && !isNightPt(p))
      .map((p) => p.v);
    const nightHr = lowestQuartileMean(nightPts);                 // 夜间静息心率近似（最低 25% 均值）
    const dayHrDaily = healthStore.getDay('hr', dk)?.mean ?? null; // 全天均值兜底
    const dayHrRaw = dayPts.length >= 3 ? meanVal(dayPts) : null;  // 日间窗样本足够才用
    const dayHr = dayHrRaw ?? (dayHrDaily != null ? dayHrDaily : null);
    const dayHrIsDaily = dayHrRaw == null && dayHrDaily != null;
    // ★ 除零保护保留：dayHr <= 0 时直接判「无数据」，不参与百分比计算
    const dipPct = nightHr != null && dayHr != null && dayHr > 0 && Number.isFinite(nightHr) && Number.isFinite(dayHr)
      ? ((dayHr - nightHr) / dayHr) * 100
      : null;
    // ★ v18.134（审查 04 🟡-3）：负 dipPct（夜间心率**高于**日间）不能与「基本没降」共用文案。
    //   公开生理学口径：夜间较日间下降 ≥10% 为正常 dipping；3~10% 下降不足；0~3% 基本没降；
    //   < 0% 属于**反向（夜间反而更高）**，是更需警惕的昼夜节律反转形态，须单独文案。
    const dipLabel = dipPct == null
      ? null
      : dipPct >= 10 ? '下降充分'
      : dipPct >= 3 ? '下降偏少'
      : dipPct >= 0 ? '基本没降'
      : '夜间高于日间';
    const dipColor = dipPct == null ? theme.colors.textSub : dipPct >= 10 ? mm.colors.limeCore : dipPct >= 3 ? mm.colors.honeyDeep : theme.colors.danger;
    // ★ 2026-11-25：卡片口径与代码保持一致 —— 夜间按真实入睡/起床切分，不是固定 22–06。
    const hasSleepWindow = bedH != null && wakeH != null;
    const windowDesc = hasSleepWindow
      ? (dayHrIsDaily ? '夜=入睡→起床 · 日=全天均值' : '夜=入睡→起床 · 日=清醒时段')
      : (dayHrIsDaily ? '夜 22–06 · 日=全天均值' : '夜 22–06 · 日 07–22');
    return { sys, dia, measuredAt, measuredManual, sysAvg, diaAvg, measuredDayCount, dipPct, dipLabel, dipColor, nightHr, dayHr, dayHrIsDaily, windowDesc };
  }, [anchorMs, hsVer]);

  const hasBp = data.sys != null && data.dia != null;
  const [infoKey, setInfoKey] = useState<SleepInfoKey | null>(null);
  const [infoValue, setInfoValue] = useState<string | null>(null);

  /** ★ 2026-11-25（用户：底部别再写一句免责，要写一段分析）：只用当前卡片里的真实数值说话 */
  const analysis = useMemo(() => {
    const parts: string[] = [];
    if (data.sys != null && data.dia != null) {
      const when = data.measuredAt
        ? `${new Date(data.measuredAt).getMonth() + 1}/${new Date(data.measuredAt).getDate()}`
        : '';
      parts.push(`最近一次血压 ${Math.round(data.sys)}/${Math.round(data.dia)} mmHg（${data.measuredManual ? '手动记录' : '戒指光电'}${when ? ' · ' + when : ''}）`);
      if (data.sysAvg != null && data.diaAvg != null) {
        const near = Math.abs(data.sys - data.sysAvg) <= 8 && Math.abs(data.dia - data.diaAvg) <= 5;
        parts.push(`近 ${data.measuredDayCount} 天均值 ${Math.round(data.sysAvg)}/${Math.round(data.diaAvg)}，这次${near ? '与均值接近' : '与均值有差别'}`);
      } else {
        parts.push('目前只有一天的测量记录，还看不出趋势');
      }
    } else {
      parts.push('还没有血压测量记录');
    }
    if (data.dipPct != null && data.nightHr != null && data.dayHr != null) {
      parts.push(`夜间心率 ${Math.round(data.nightHr)} 比日间 ${Math.round(data.dayHr)} ${data.dipPct >= 0 ? `低 ${data.dipPct.toFixed(0)}%` : `高 ${Math.abs(data.dipPct).toFixed(0)}%`}（${data.dipLabel}）`);
    } else {
      parts.push('这一夜的心率样本还不够，暂时算不出昼夜变化');
    }
    return `${parts.join('；')}。夜间血压需要连续夜间测量才能判断，这里用心率变化看趋势。`;
  }, [data]);

  return (
    <>
    <Card>
      <Text style={styles.title}>夜间血压参考</Text>
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.label}>最近测量</Text>
          <Text style={styles.big}>
            {hasBp ? `${Math.round(data.sys!)}/${Math.round(data.dia!)}` : '--'}
            <Text style={styles.unit}> mmHg</Text>
          </Text>
          <Text style={styles.sub}>
            {hasBp
              ? data.measuredAt
                ? `${data.measuredManual ? '手动记录' : '戒指光电'} · ${new Date(data.measuredAt).getMonth() + 1}/${new Date(data.measuredAt).getDate()}`
                : data.measuredManual ? '手动记录' : '戒指光电血压'
              : '还没有血压测量'}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.label}>7 天测量均值</Text>
          <Text style={styles.big}>
            {data.sysAvg != null && data.diaAvg != null
              ? `${Math.round(data.sysAvg)}/${Math.round(data.diaAvg)}`
              : '--'}
            <Text style={styles.unit}> mmHg</Text>
          </Text>
          <Text style={styles.sub}>
            {data.measuredDayCount >= 2
              ? `近 7 天 ${data.measuredDayCount} 天有测量（含手动）`
              : data.measuredDayCount === 1
                ? '测量 1 天，暂无均值'
                : '还没有测量记录'}
          </Text>
        </View>
      </View>
      <View style={styles.grid}>
        <View style={styles.cell}>
          {/* ★ 2026-11-14（用户）：去掉「（dipping 参考）」括号注释，只留「夜间心率下降」
              ★ 2026-11-25：名称旁加「?」说明口径与常见区间 */}
          <View style={styles.labelRow}>
            <Text style={styles.label}>夜间心率下降</Text>
            <InfoDot onPress={() => {
              setInfoValue(data.dipPct != null
                ? `${data.dipPct.toFixed(0)}% · ${data.dipLabel ?? ''}`
                : null);
              setInfoKey('dip');
            }} />
          </View>
          <Text style={[styles.big, { color: data.dipColor }]}>
            {data.dipPct != null ? `${data.dipPct.toFixed(0)}%` : '--'}
          </Text>
          <Text style={[styles.sub, data.dipLabel ? { color: data.dipColor } : null]}>
            {data.dipLabel ?? (data.nightHr == null || data.dayHr == null ? '需要夜间与日间心率' : '需要心率数据')}
          </Text>
        </View>
        <View style={styles.cell}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>夜间 / 日间心率</Text>
            <InfoDot onPress={() => {
              setInfoValue(data.nightHr != null && data.dayHr != null
                ? `${Math.round(data.nightHr)}/${Math.round(data.dayHr)} bpm`
                : null);
              setInfoKey('nightDayHr');
            }} />
          </View>
          <Text style={styles.big}>
            {data.nightHr != null && data.dayHr != null
              ? `${Math.round(data.nightHr)}/${Math.round(data.dayHr)}`
              : '--'}
            <Text style={styles.unit}> bpm</Text>
          </Text>
          <Text style={styles.sub}>{data.windowDesc}</Text>
        </View>
      </View>
      {/* ★ 2026-11-25（用户）：底部不再是一句免责，改成基于本卡真实数值的一段分析 */}
      <Text style={styles.note}>{analysis}</Text>
    </Card>
    <SleepInfoSheet
      visible={infoKey != null}
      onClose={() => setInfoKey(null)}
      metric={infoKey}
      valueText={infoValue}
    />
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  grid: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(2) },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(1),
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  label: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  big: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  unit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: '400' as any },
  sub: { fontSize: theme.fontSize.micro - 2, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center' },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});

export default NightBpCard;
