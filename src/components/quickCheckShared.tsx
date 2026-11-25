/**
 * quickCheckShared —— 「一键体检」三页面共用的渲染件与样式
 * ---------------------------------------------------------------------------
 * 概览卡（InsightScreen 子 tab）/ 体检记录列表页 / 微体检报告详情页 三者复用：
 *   - 状态色与状态文案（正常/偏高/偏低/风险）
 *   - 分段刻度条 ScaleBar
 *   - 单指标行 MetricRow
 *   - 分组块 GroupBlock（标题 + 玻璃卡，含抑郁症风险大卡）
 *   - 共享样式表 qc（与洞察页 InsightScreen 同源：白玻璃 cardBg / cardBorder）
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import type { QCMetric, QCStatus, QCGroup, QuickCheckRecord } from '../data/quickCheckStore';
import { classifyRecord } from '../data/quickCheckStore';
import { requestMetricInterpretation } from '../ai/quickCheckAi';

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
      <View style={{ height: 6, borderRadius: theme.radius.xs, flexDirection: 'row', overflow: 'hidden' }}>
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
 * 数值排版统一（2026-11-08，用户反馈「血压数字一下变大、一看就不统一」）
 * ---------------------------------------------------------------------------
 * 根因不是数值错，而是量纲 / 字符数不同却共用了同一个 32px 大数字字号：
 *   HRV `45`、血氧 `98` 是单个两位数；血压 `116/76` 是「两个三位数 + 斜杠」，
 *   在 stat(32) 下整块宽度约为别人的 3 倍，看上去像数字突然变大。
 *
 * 统一规则（只改渲染，不动 groups / QCMetric.value，历史报告无需迁移）：
 *   1. 纯数字（含小数、千分位）保持 stat 基准字号；
 *   2. 复合值 `A/B`（血压）、5 位以上长数字 → 降一级到 orb(24)，分隔符弱化小字；
 *   3. 文本值（「稳定」「黄体期」「5小时40分」）→ 降到 lg(20)，汉字方块不再顶满；
 *   4. 单位一律 micro 弱化小字，跟在数字主体后面。
 * 目的：让不同量纲的指标在视觉上「等高、同基准」，不做横向数值比较。
 */
const PLAIN_NUM_RE = /^\d[\d,]*(?:\.\d+)?$/;
const PAIR_NUM_RE = /^(\d[\d,]*(?:\.\d+)?)\s*\/\s*(\d[\d,]*(?:\.\d+)?)$/;
const CJK_RE = /[\u4e00-\u9fff]/;

export function MetricValue({ value, unit, style }: { value: string; unit?: string; style?: StyleProp<ViewStyle> }) {
  const v = String(value ?? '').trim();
  const pair = PAIR_NUM_RE.exec(v);
  const plain = PLAIN_NUM_RE.test(v);
  const long = plain && v.replace(/[,\s]/g, '').length >= 5;
  const hasCjk = CJK_RE.test(v);
  const size = hasCjk ? theme.fontSize.lg : pair || long ? theme.fontSize.orb : theme.fontSize.stat;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline' }, style]}>
      {pair ? (
        <Text style={[qc.metricValue, { fontSize: size }]}>
          {pair[1]}
          <Text style={{ fontSize: size * 0.6, fontWeight: '400', color: theme.colors.textSub }}> / </Text>
          {pair[2]}
        </Text>
      ) : (
        <Text style={[qc.metricValue, { fontSize: size }]}>{v}</Text>
      )}
      {unit ? <Text style={qc.metricUnit}>{unit}</Text> : null}
    </View>
  );
}

/**
 * 单指标行。报告里每条指标只展示：名称 + 数值 + 状态（正常/偏高/偏低/风险）
 * + 一段「意义 · 分析 · 建议」说明（来源标注统一移到分组级，不在每条下面写实测/估算）。
 *
 * ★ AI 解读（useAi=true 时，仅详情页开启）：手写解读先显示，端侧本地模型生成更口语的
 *   解读到货后静默替换；模型不可用 / 超时 / 输出不合法则保留手写解读，绝不空白。
 */
/** ★ 2026-11-13（用户）：雌激素 / 孕激素固定用与洞察页同源的手写话术，
 *  不让端侧模型的随机输出替换成另一种口径（尤其别再冒出推算/来源说明）。 */
const FIXED_NOTE_KEYS = new Set(['estrogen', 'progesterone']);

export function MetricRow({ m, useAi, groupTitle }: { m: QCMetric; useAi?: boolean; groupTitle?: string }) {
  const [aiNote, setAiNote] = useState<string | null>(null);
  useEffect(() => {
    if (!useAi || FIXED_NOTE_KEYS.has(m.key)) return;
    let cancelled = false;
    requestMetricInterpretation({
      name: m.name,
      value: m.value,
      unit: m.unit,
      ref: m.ref,
      status: m.status,
      groupTitle,
    })
      .then((t) => {
        if (t && !cancelled) setAiNote(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [useAi, m.name, m.value, m.unit, m.ref, m.status, groupTitle]);
  const note = aiNote ?? m.note;
  return (
    <View style={qc.metricRow}>
      <View style={{ flex: 1, marginRight: theme.sp(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={qc.metricName}>{m.name}</Text>
        </View>
        {m.ref ? <Text style={qc.metricRef}>{m.ref}</Text> : null}
        {m.scale ? <ScaleBar scale={m.scale} /> : null}
        {note ? <Text style={qc.metricNote}>{note}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <MetricValue value={m.value} unit={m.unit} />
        <Text style={[qc.metricStatus, { color: statusColor(m) }]}>{statusLabel(m)}</Text>
      </View>
    </View>
  );
}

/** 渲染一个分组（核心体征 / 血液 / 心理 / 压力疲劳通用）。 */
/**
 * ★ 2026-11-18（用户：一键体检心电组要展示小的心电图预览）：
 * 本次现场心电的迷你波形卡（降采样 ~160 点，单位 0.1mV，已在组装时归一采样）。
 *Svg viewBox 320x64 + preserveAspectRatio="none" 横向铺满；基线灰线 + 心电绿色走线。
 */
function EcgWavePreview({ wave }: { wave: number[] }) {
  const W = 320, H = 64;
  const n = wave.length;
  const lo = Math.min(...wave);
  const hi = Math.max(...wave);
  const span = Math.max(0.1, hi - lo);
  // y 轴：0.1mV 单位，反转（mV 越高 y 越小）；上下留 6px 边距
  const pts = wave.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * W : W / 2;
    const y = 6 + (1 - (v - lo) / span) * (H - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const baseline = (6 + (1 - (0 - lo) / span) * (H - 12)).toFixed(1);
  return (
    <View style={{ marginTop: theme.sp(1), marginBottom: theme.sp(2) }}>
      <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, overflow: 'hidden', backgroundColor: 'rgba(10,22,20,0.35)' }}>
        <Svg width="100%" height={92} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <Path d={`M0,${baseline} L${W},${baseline}`} stroke="rgba(255,255,255,0.22)" strokeWidth={0.6} fill="none" />
          <Path d={`M${pts.join(' L')}`} stroke={theme.colors.success} strokeWidth={1.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      </View>
      <Text style={[qc.metricNote, { marginTop: theme.sp(1) }]}>本次 90 秒心电记录的波形缩略</Text>
    </View>
  );
}

export function GroupBlock({ group, useAi }: { group: QCGroup; useAi?: boolean }) {
  const g = group;
  const inner: React.ReactNode[] = [];
  // ★ 2026-11-18：心电组的迷你心电图预览（波形置顶，风险指数行跟在后面）
  if (g.key === 'ecg' && g.ecgWave && g.ecgWave.length > 10) {
    inner.push(<EcgWavePreview key="ecg-wave" wave={g.ecgWave} />);
  }
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
              <MetricValue value={s.value} unit={s.unit} style={{ marginTop: theme.sp(1) }} />
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
  (g.metrics ?? []).forEach((m) => inner.push(<MetricRow key={m.key} m={m} useAi={useAi} groupTitle={g.title} />));
  return (
    <View key={g.key}>
      <View style={qc.groupTitle}>
        <Text style={qc.groupTitleText}>{g.title}</Text>
      </View>
      <View style={qc.groupCard}>
        {/* ★ 本次依据说明（现场测得 / 今天已同步 / 当场重算 / 最近记录推算）置顶显示。
            单独字段，不经过解读引擎的 note 清理，保证用户一定看得到数据从哪来。 */}
        {g.basisNote ? <Text style={[qc.metricNote, { marginBottom: theme.sp(2) }]}>{g.basisNote}</Text> : null}
        {g.note ? <Text style={[qc.metricNote, { marginBottom: theme.sp(2) }]}>{g.note}</Text> : null}
        {inner}
        {(g.standalone ?? []).map((m) => (
          <View key={m.key}>
            <MetricRow m={m} useAi={useAi} groupTitle={g.title} />
            {m.levels ? <Text style={qc.metricNote}>{m.levels}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * ★ 2026-11-08 B 稿「异常概览」落地（用户拍板：白卡，异常数据改黄色，不加黄色框）
 * ---------------------------------------------------------------------------
 * 报告详情页顶部第一张卡。三分类诚实口径：
 *   - 大标题「N 项需要留意」（无异常时「未见异常」）
 *   - 副行「共 X 项 · M 项正常 · K 项推算/模型，不参与判定」
 *   - 三段比例条：正常绿 / 需留意黄 / 推算模型蓝（推算与模型值用蓝点区别，不吓人）
 *   - 异常清单：白卡上只把异常数值/状态标黄，一条一句解读，不堆字
 *   - 口径说明：「正常/异常只针对有参考区间的测量项」——Mira 不做评分与诊断
 */
/**
 * ★ 2026-11-08 续（用户拍板）：体检报告顶部概览改为「两张横卡 + 一段分析」。
 *  - 不套外层卡片；检测时间一行在最上；
 *  - 左卡「正常 X 项」(绿) / 右卡「需留意 Y 项」(无异常时置灰)；
 *  - 下方一段分析：正常几项、哪些异常（异常项名点出）；推算/模型值在段落里说明不参与判定。
 *  - 诚实口径：正常/异常只针对有参考区间的测量项；推算与模型值不做判定。
 */
export function AbnormalOverview({ record, createdAt }: { record: QuickCheckRecord; createdAt: number }) {
  const t = classifyRecord(record);
  const hasFlag = t.flagged > 0;
  const names = t.flaggedMetrics.map((m) => m.name).slice(0, 3).join('、');
  const more = t.flaggedMetrics.length > 3 ? `等 ${t.flaggedMetrics.length} 项` : '';
  const para = hasFlag
    ? `本次共 ${t.total} 项测量，${t.ok} 项正常，${t.flagged} 项需留意（${names}${more}）。可结合连续几天的趋势观察，必要时以专业检测确认。`
    : `本次共 ${t.total} 项测量均在参考区间内，整体平稳。${t.model > 0 ? `另有 ${t.model} 项推算/模型值仅供参考，不参与判定。` : ''}`;
  return (
    <View>
      <Text style={qc.sumTime}>检测时间 {fmtDate(createdAt)}</Text>
      <View style={qc.ovCardsRow}>
        <View style={[qc.ovCountCard, { borderColor: theme.colors.success }]}>
          <Text style={[qc.ovCountLabel, { color: theme.colors.success }]}>正常</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[qc.ovCountNum, { color: theme.colors.success }]}>{t.ok}</Text>
            <Text style={qc.ovCountUnit}>项</Text>
          </View>
        </View>
        <View style={[qc.ovCountCard, { borderColor: hasFlag ? theme.colors.warn : theme.colors.cardBorder }]}>
          <Text style={[qc.ovCountLabel, { color: hasFlag ? theme.colors.warn : theme.colors.textSub }]}>需留意</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[qc.ovCountNum, { color: hasFlag ? theme.colors.warn : theme.colors.textSub }]}>{t.flagged}</Text>
            <Text style={qc.ovCountUnit}>项</Text>
          </View>
        </View>
      </View>
      <Text style={qc.ovPara}>{para}</Text>
    </View>
  );
}

/**
 * 一键体检共用渐变 CTA 按钮 —— 与「心电图」测量按钮同源：
 * 黄绿→粉 对角渐变（mm.colors.btnGradFrom → btnGradTo），白字、胶囊形。
 */
export function QCta({ title, onPress, disabled }: { title: string; onPress: () => void | Promise<void>; disabled?: boolean }) {
  return (
    <TouchableOpacity activeOpacity={disabled ? 1 : 0.7} onPress={onPress} style={[qc.cta, disabled && qc.ctaDisabled]} disabled={disabled}>
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
  // ★ 本轮（用户）：「再体检一次」按钮移入卡片内，与 AI 分析块留间距
  ctaInside: { marginTop: theme.sp(3) },
  bigStatRow: { flexDirection: 'row', gap: theme.sp(3), marginTop: theme.sp(3) },
  bigStat: {
    flex: 1,
    backgroundColor: theme.colors.cardBgStrong,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(2.5),
    alignItems: 'center',
  },
  bigStatNum: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold },
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
  linkText: { fontSize: theme.fontSize.sm, color: mm.colors.limeCore, fontWeight: theme.weight.semibold },
  linkArrow: { fontSize: theme.fontSize.card, color: mm.colors.limeCore },
  cta: {
    marginTop: theme.sp(4),
    marginBottom: theme.sp(4),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  ctaDisabled: { opacity: 0.45 },
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
  sumTime: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  // ★ 2026-11-08 续：顶部概览改为两张横卡 + 一段分析（不套外层卡）
  ovCardsRow: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(3) },
  ovCountCard: {
    flex: 1,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.sp(3),
  },
  ovCountLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium },
  ovCountNum: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.bold, lineHeight: theme.fontSize.h1 },
  ovCountUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: theme.sp(1) },
  ovPara: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(3),
    lineHeight: theme.fontSize.sm * 1.5,
  },
  groupTitle: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(5), marginBottom: theme.sp(2) },
  groupIcon: { fontSize: theme.fontSize.body, marginRight: theme.sp(2) },
  groupTitleText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  groupCard: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: theme.sp(2.5),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
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
    backgroundColor: theme.colors.cardBgStrong,
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
