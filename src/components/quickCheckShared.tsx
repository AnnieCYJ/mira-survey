/**
 * quickCheckShared —— 「一键体检」三页面共用的渲染件与样式
 * ---------------------------------------------------------------------------
 * 概览卡（InsightScreen 子 tab）/ 体检记录列表页 / 微体检报告详情页 三者复用：
 *   - 状态色与状态文案（正常/偏高/偏低/风险）
 *   - 分段刻度条 ScaleBar
 *   - 单指标行 MetricRow
 *   - 分组块 GroupBlock（标题 + 玻璃卡，含抑郁症风险大卡）
 *   - 共享样式表 qc（与全站深海深底 + 玻璃 token 同源）
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import type { QCMetric, QCStatus, QCGroup } from '../data/quickCheckStore';

export const STATUS_LABEL: Record<QCStatus, string> = {
  ok: '正常',
  high: '偏高',
  low: '偏低',
  risk: '风险',
};
export const STATUS_COLOR: Record<QCStatus, string> = {
  ok: theme.colors.success,
  high: theme.colors.warn,
  low: theme.colors.accent2,
  risk: theme.colors.danger,
};
export const statusLabel = (m: QCMetric) => m.label ?? STATUS_LABEL[m.status];
export const statusColor = (m: QCMetric) => STATUS_COLOR[m.status];

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 分段刻度条：4 色区间 + 三角标记定位到当前值比例。 */
export function ScaleBar({ scale }: { scale: { min: number; max: number; v: number } }) {
  const pct = Math.max(0, Math.min(100, ((scale.v - scale.min) / (scale.max - scale.min)) * 100));
  const segs = [theme.colors.accent2, theme.colors.success, theme.colors.warn, theme.colors.danger];
  return (
    <View style={{ marginTop: theme.sp(2), position: 'relative' }}>
      <View style={{ height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' }}>
        {segs.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
      <View style={{ position: 'absolute', top: -4, left: `${pct}%`, transform: [{ translateX: -4 }] }}>
        <Text style={{ fontSize: theme.fontSize.tiny, color: theme.colors.textTitle }}>▼</Text>
      </View>
    </View>
  );
}

/**
 * 单指标行。★ 2026-11-05：带来源徽标（实测 / 估算）——用户要求
 * 「一键体检里估算出来的数据必须明确标注，不能冒充戒指实测」。
 */
export function MetricRow({ m }: { m: QCMetric }) {
  const estimated = m.source === 'estimated';
  return (
    <View style={qc.metricRow}>
      <View style={{ flex: 1, marginRight: theme.sp(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={qc.metricName}>{m.name}</Text>
          {m.source ? (
            <Text style={{
              fontSize: theme.fontSize.micro ?? 10,
              color: estimated ? '#F0C46E' : '#8FE3C4',
              backgroundColor: estimated ? 'rgba(240,196,110,0.14)' : 'rgba(143,227,196,0.12)',
              paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
            }}>
              {estimated ? '估算' : '实测'}
            </Text>
          ) : null}
        </View>
        {m.ref ? <Text style={qc.metricRef}>{m.ref}</Text> : null}
        {m.scale ? <ScaleBar scale={m.scale} /> : null}
        {m.note ? <Text style={qc.metricNote}>{m.note}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={qc.metricValue}>{m.value}</Text>
          {m.unit ? <Text style={qc.metricUnit}>{m.unit}</Text> : null}
        </View>
        <Text style={[qc.metricStatus, { color: statusColor(m) }]}>{statusLabel(m)}</Text>
      </View>
    </View>
  );
}

/** 渲染一个分组（核心体征 / 血液 / 心理 / 压力疲劳通用）。 */
export function GroupBlock({ group }: { group: QCGroup }) {
  const g = group;
  const inner: React.ReactNode[] = [];
  if (g.risk) {
    inner.push(
      <View key={`r-${g.key}`} style={{ marginBottom: theme.sp(2) }}>
        <View style={qc.riskHead}>
          <Text style={qc.riskName}>{g.risk.name}</Text>
          <Text style={[qc.metricStatus, { color: STATUS_COLOR[g.risk.status] }]}>{g.risk.label}</Text>
        </View>
        <View style={qc.grid2}>
          {(g.risk.sub ?? []).map((s) => (
            <View key={s.key} style={qc.gcell}>
              <Text style={qc.metricName}>{s.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: theme.sp(1) }}>
                <Text style={qc.metricValue}>{s.value}</Text>
                {s.unit ? <Text style={qc.metricUnit}>{s.unit}</Text> : null}
              </View>
              <Text style={[qc.metricStatus, { color: statusColor(s), fontSize: theme.fontSize.micro, marginTop: 2 }]}>
                {statusLabel(s)}
              </Text>
            </View>
          ))}
        </View>
        {g.risk.note ? <Text style={qc.metricNote}>{g.risk.note}</Text> : null}
      </View>
    );
  }
  (g.metrics ?? []).forEach((m) => inner.push(<MetricRow key={m.key} m={m} />));
  return (
    <View key={g.key}>
      <View style={qc.groupTitle}>
        {g.icon ? <Text style={qc.groupIcon}>{g.icon}</Text> : null}
        <Text style={qc.groupTitleText}>{g.title}</Text>
      </View>
      <View style={qc.groupCard}>
        {g.note ? <Text style={[qc.metricNote, { marginBottom: theme.sp(2) }]}>{g.note}</Text> : null}
        {inner}
        {(g.standalone ?? []).map((m) => (
          <View key={m.key}>
            <MetricRow m={m} />
            {m.levels ? <Text style={qc.metricNote}>{m.levels}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * 一键体检共用渐变 CTA 按钮 —— 与「心电图」测量按钮同源：
 * 黄绿→粉 对角渐变（mm.colors.btnGradFrom → btnGradTo），白字、胶囊形。
 */
export function QCta({ title, onPress, disabled }: { title: string; onPress: () => void | Promise<void>; disabled?: boolean }) {
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={qc.cta} disabled={disabled}>
      <LinearGradient
        colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={qc.ctaGrad}
      >
        <Text style={qc.ctaText}>{title}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

/**
 * ★ 2026-11-06 审查（docs/audit/02）：已删除 DemoBadge。
 *   它原本用于标注「演示数据 · 非真实测量」—— 现在一键体检已完全去演示化
 *   （quickCheckStore 不再 seed 任何演示记录），所有数值都来自真实戒指测量，
 *   标这个徽章反而会误导用户以为数据不可信。
 *
 * 保留位置说明：如后续重新引入任何非真实数据源，必须在此处恢复徽章并标注来源。
 */

export const qc = StyleSheet.create({
  label: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  overviewCard: { padding: theme.space.cardPad },
  overviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bigStatRow: { flexDirection: 'row', gap: theme.sp(3), marginTop: theme.sp(4) },
  bigStat: {
    flex: 1,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(4),
    alignItems: 'center',
  },
  bigStatNum: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold },
  bigStatKey: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  abList: { marginTop: theme.sp(4) },
  abItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.sp(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  abEmpty: { marginTop: theme.sp(4), fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.sp(4),
  },
  linkText: { fontSize: theme.fontSize.sm, color: mm.colors.limeDeep, fontWeight: theme.weight.semibold },
  linkArrow: { fontSize: theme.fontSize.card, color: mm.colors.limeDeep },
  cta: {
    marginTop: theme.sp(4),
    marginBottom: theme.sp(4),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  ctaGrad: {
    paddingVertical: theme.sp(3.5),
    alignItems: 'center',
  },
  ctaText: {
    textAlign: 'center',
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
  },
  footerNote: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(3),
    lineHeight: theme.fontSize.micro * 1.6,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(2) },
  backBtn: {
    width: 34, height: 34, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2),
  },
  backArrow: { fontSize: theme.fontSize.h2, color: theme.colors.textTitle, lineHeight: 24 },
  histTitle: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  shareIcon: { fontSize: theme.fontSize.card, color: theme.colors.textSub },
  histSub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginBottom: theme.sp(3) },
  histCard: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(3),
  },
  histHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  histDate: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  dot: { width: 9, height: 9, borderRadius: 5 },
  histMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.sp(2) },
  histDone: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold, color: theme.colors.textTitle },
  histAb: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  histMeta: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1.5) },
  sumBox: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(3),
  },
  sumTime: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  sumMain: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, marginTop: theme.sp(1), lineHeight: theme.fontSize.card * 1.4 },
  sumNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2.5), lineHeight: theme.fontSize.micro * 1.6 },
  groupTitle: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(5), marginBottom: theme.sp(2) },
  groupIcon: { fontSize: theme.fontSize.body, marginRight: theme.sp(2) },
  groupTitleText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  groupCard: { padding: theme.space.cardPadCompact },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: theme.sp(2.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  metricName: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  metricRef: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  metricValue: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold, color: theme.colors.textTitle },
  metricUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 3 },
  metricStatus: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, marginTop: 4 },
  metricNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1.5), lineHeight: theme.fontSize.micro * 1.55 },
  riskHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(2) },
  riskName: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2) },
  gcell: {
    width: '47%',
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.sm,
    padding: theme.sp(2.5),
  },
  delRow: { alignItems: 'center', marginTop: theme.sp(5), marginBottom: theme.sp(3) },
  delText: { fontSize: theme.fontSize.sm, color: theme.colors.danger },
  toast: {
    position: 'absolute',
    left: theme.sp(2),
    right: theme.sp(2),
    bottom: theme.sp(5),
    backgroundColor: 'rgba(20,26,42,0.92)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.sp(4),
  },
  toastText: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, textAlign: 'center' },
});
