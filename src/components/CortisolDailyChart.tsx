/**
 * CortisolDailyChart —— 身体恢复详情页「今日皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致：
 *   collectSamples → analyzeCortisol → TrendChart（30min 槽位 + cosinor 填补 + 睡眠阴影 + 14天基线对比）
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Card from './Card';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples, getSleepWindow, TrendChart } from './CortisolRhythmCard';

export default function CortisolDailyChart() {
  const navigation = useNavigation<any>();
  const samples = collectSamples();
  const sleepWindow = getSleepWindow();

  const goDetail = () => {
    navigation.navigate('MetricDetail', {
      key: 'cortisol',
      name: '皮质醇',
      unit: 'nmol/L',
      yMin: 0,
      yMax: 120,
      color: '#7C6AE0',
    });
  };

  if (samples.length < 4) {
    return (
      <Card>
        <Text style={styles.title}>今日皮质醇全天趋势</Text>
        <Text style={{ fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          暂无足够的皮质醇数据，连上戒指开启自动监测后即可查看
        </Text>
      </Card>
    );
  }

  const r = analyzeCortisol(samples, 14);

  // ── 节律状态 meta ──
  const levelMeta: Record<string, { label: string; color: string }> = {
    normal: { label: '节律正常', color: '#2ECC71' },
    sustained_high: { label: '持续偏高', color: theme.colors.danger },
    dysregulated: { label: '节律紊乱', color: theme.colors.stateTense },
  };
  const meta = levelMeta[r.status.level] ?? levelMeta.normal;
  const cos = r.cosinor;
  const hasCos = Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude);

  // ── 节律解读文字 ──
  const insights: string[] = [];
  if (r.status.level === 'normal') {
    insights.push('皮质醇节律弹性好，晨起皮质醇能正常爬升，入睡时能正常下降。');
  }
  if (r.status.level === 'sustained_high') {
    insights.push(`连续 ${r.sustainedHighStreak} 天皮质醇水平偏高，HPA 轴处于持续激活状态，身体在慢性应激模式。`);
  }
  if (r.status.level === 'dysregulated') {
    insights.push('节律弹性丢失——身体记不住正常的昼夜节奏，可能和睡眠不规律、长期压力或激素波动有关。');
  }
  if (hasCos && cos.amplitude < 0.15 * cos.mesor) {
    insights.push('昼夜波动幅度偏低，节律扁平——皮质醇早上起不来、晚上降不去。');
  }
  if (hasCos && Number.isFinite(cos.acrophaseH)) {
    if (cos.acrophaseH < 6) insights.push(`峰值出现在 ${cos.acrophaseH.toFixed(0)}:00，皮质醇起得太早，可能后半夜已经开始分泌。`);
    else if (cos.acrophaseH > 11) insights.push(`峰值出现在 ${cos.acrophaseH.toFixed(0)}:00，偏晚的皮质醇节律可能影响夜间睡眠。`);
  }
  if (Number.isFinite(r.css) && r.css < 0) {
    insights.push('皮质醇节律偏晚间型，"夜猫子"模式，长期可能导致社交时差。');
  }
  if (r.status.level !== 'normal') {
    insights.push('💡 建议：保持固定睡眠节律、减少下午 3 点后咖啡因、上午接触自然光 30 分钟。');
  }

  const fmtHour = (h: number) => {
    if (!Number.isFinite(h)) return '—';
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  };
  const fmtAmpPct = () => {
    if (!hasCos || cos.mesor <= 0) return '—';
    return `${Math.round(cos.amplitude / cos.mesor * 100)}%`;
  };

  return (
    <Card>
      {/* 趋势图区域：可点击跳转详情 */}
      <TouchableOpacity activeOpacity={0.85} onPress={goDetail}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <Text style={styles.title}>今日皮质醇全天趋势</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentSolid }}>详情 ›</Text>
        </View>
        <TrendChart r={r} sleepWindow={sleepWindow}  />
      </TouchableOpacity>

      {/* ── 节律分析 ── */}
      <View style={styles.divider} />

      {/* 状态 + flags */}
      <View style={styles.rhythmHead}>
        <Text style={styles.rhythmTitle}>节律分析</Text>
        <View style={[styles.levelChip, { backgroundColor: meta.color + '22' }]}>
          <View style={[styles.levelDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.levelText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* 2×2 SumCell 摘要 */}
      <View style={styles.summaryGrid}>
        <SumCell
          label="整体压力水平"
          value={hasCos ? cos.mesor.toFixed(1) : '—'}
          sub={
            hasCos && Number.isFinite(r.baseline.p75)
              ? cos.mesor > r.baseline.p75 ? '高于个人基线 P75'
                : cos.mesor < r.baseline.p25 ? '低于个人基线 P25'
                : '在正常区间内'
              : '全天压力代理均值'
          }
        />
        <SumCell
          label="峰值时刻"
          value={fmtHour(cos.acrophaseH)}
          sub={
            Number.isFinite(cos.acrophaseH)
              ? cos.acrophaseH >= 6 && cos.acrophaseH <= 11 ? '正常范围 06–11 点'
                : cos.acrophaseH < 6 ? '过早（早醒风险）'
                : '偏晚（夜猫子型）'
              : '—'
          }
        />
      </View>
      <View style={[styles.summaryGrid, { marginTop: theme.sp(1) }]}>
        <SumCell
          label="昼夜波动幅度"
          value={fmtAmpPct()}
          sub={
            hasCos
              ? cos.amplitude < 0.15 * cos.mesor ? '节律扁平 ⚠️'
                : cos.amplitude >= 0.3 * cos.mesor ? '节律弹性好'
                : '适中'
              : '—'
          }
        />
        <SumCell
          label="作息类型"
          value={
            Number.isFinite(r.css)
              ? r.css > 10 ? '早起型'
                : Math.abs(r.css) < 10 ? '不明显'
                : '晚睡型'
              : '—'
          }
          sub={
            Number.isFinite(r.css)
              ? r.css > 10 ? '皮质醇晨高夜低（正常）'
                : Math.abs(r.css) < 10 ? '昼夜无明显差异'
                : '皮质醇夜高晨低，建议调整'
              : '—'
          }
        />
      </View>

      {/* AI 洞察文字 */}
      {insights.length > 0 && (
        <View style={styles.insightBox}>
          <Text style={styles.insightTitle}>📊 节律洞察</Text>
          {insights.map((line, i) => (
            <Text key={i} style={styles.insightLine}>{line}</Text>
          ))}
        </View>
      )}

      {/* 个人基线 + 持续偏高 */}
      {r.sustainedHighStreak > 0 && (
        <Text style={styles.streakText}>
          ⚠️ 已连续 {r.sustainedHighStreak} 天皮质醇偏高
        </Text>
      )}
    </Card>
  );
}

/** SumCell —— 与 EmotionCognitiveDetailScreen 同款 */
function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },

  // ── 节律分析区 ──
  divider: { height: 1, backgroundColor: theme.colors.cardBorder2, marginTop: theme.sp(3), marginBottom: theme.sp(2) },
  rhythmHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(2) },
  rhythmTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  // SumCell
  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  // AI 洞察
  insightBox: { backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md, padding: theme.sp(2.5), marginTop: theme.sp(2) },
  insightTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  insightLine: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55, marginBottom: theme.sp(0.5) },

  streakText: { fontSize: theme.fontSize.sm, color: theme.colors.danger, marginTop: theme.sp(1.5), fontWeight: theme.weight.semibold as any },
});
