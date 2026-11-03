/**
 * CardioDetailScreen —— 心肺能力（VO₂max）详情页
 *
 * 对标 Oura「Cardio Capacity」/ Garmin·Apple「VO₂ Max / Cardio Fitness」。
 * 数据全部来自 lib/vo2max.ts（权威非运动估算法），本页只做可视化与透明拆解：
 *   · Hero：主估计 + 同龄同性别常模分档
 *   · 你的输入：年龄/性别/BMI/静息心率/最大心率(年龄预测)/活动评级
 *   · 两种权威算法拆解：Jackson 1990（主） + Uth 心率比法（交叉验证）
 *   · 常模参考：ACSM/Cooper Institute 七档
 *   · 诚实声明 + 文献出处（不假装是实验室测量值）
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { estimateVo2maxFromStore, gatherVo2Inputs, tanakaHrmax } from '../lib/vo2max';

const CARD = 'rgba(255,255,255,0.06)';
const CARD_BORDER = 'rgba(255,255,255,0.12)';
const SUB = 'rgba(255,255,255,0.62)';
const FAINT = 'rgba(255,255,255,0.42)';

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.rowValue}>{value}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function CardioDetailScreen() {
  const navigation = useNavigation();
  const result = useMemo(() => estimateVo2maxFromStore(Date.now()), []);
  const inputs = useMemo(() => gatherVo2Inputs(Date.now()), []);

  if (!result || !inputs) {
    return (
      <ScreenContainer>
        <LinearGradient colors={['#113861', '#0A294F']} style={StyleSheet.absoluteFill} />
        <View style={s.wrap}>
          <Text style={s.h1}>心肺能力</Text>
          <View style={[s.card, { marginTop: 16 }]}>
            <Text style={s.empty}>暂无可用的数据。</Text>
            <Text style={s.emptySub}>
              需要：档案里的年龄 / 身高 / 体重，以及近 7 晚的夜间静息心率（戴上戒指睡几晚即可）。{'\n'}
              这些都齐了，我会用权威的非运动估算法给你一个心肺能力值。
            </Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const hrmaxEst = tanakaHrmax(inputs.age);
  const sexZh = inputs.sex === 'male' ? '男' : '女';
  const parZh = `${inputs.par} / 7`;
  const methodZh = result.method === 'jackson' ? 'Jackson 1990 非运动方程（主）' : 'Uth 心率比法（主）';

  return (
    <ScreenContainer>
      <LinearGradient colors={['#113861', '#0A294F']} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={s.wrap} showsVerticalScrollIndicator={false}>
        <Text style={s.h1}>心肺能力</Text>
        <Text style={s.h2}>VO₂max · 最大摄氧量</Text>

        {/* Hero */}
        <View style={s.hero}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={s.heroNum}>{Math.round(result.estimate)}</Text>
            <Text style={s.heroUnit}>ml/kg·min</Text>
          </View>
          <View style={[s.bandPill, { backgroundColor: result.bandRank >= 4 ? mm.colors.limeCore : 'rgba(255,255,255,0.14)' }]}>
            <Text style={[s.bandPillTxt, { color: result.bandRank >= 4 ? '#10241A' : '#fff' }]}>{result.band}</Text>
          </View>
          <Text style={s.heroSub}>
            较同龄同性别常模：第 {result.bandRank + 1} / 7 档（Poor → Superior）
          </Text>
          <Text style={s.heroAnalysis}>
            {(() => {
              const r = result.bandRank;
              if (r >= 5) return '心肺能力在同龄中处于上游，规律运动帮了大忙，继续保持。';
              if (r >= 3) return '心肺能力中等偏上，再加点规律有氧还能往上提。';
              if (r >= 1) return '心肺能力处于中等水平，规律快走、骑车这类有氧会慢慢见效。';
              return '心肺能力偏低，从低强度有氧（快走、游泳）开始更容易坚持。';
            })()}
          </Text>
        </View>

        {/* 输入数据 */}
        <Section title="你的输入数据">
          <Row label="年龄" value={`${inputs.age} 岁`} />
          <Row label="性别" value={sexZh} />
          <Row label="BMI" value={`${result.bmi}`} sub="体重 / 身高²" />
          <Row label="静息心率" value={`${Math.round(inputs.rhr)} bpm`} sub="近 7 晚睡眠最低心率中位数" />
          <Row label="最大心率（预测）" value={`${Math.round(hrmaxEst)} bpm`} sub="Tanaka: 208 − 0.7×年龄" />
          <Row label="活动评级 PAR" value={parZh} sub="由近期步数 / 运动段推导" />
        </Section>

        {/* 算法拆解 */}
        <Section title="两种权威算法（透明拆解）">
          <Text style={s.note}>
            主估计采用 <Text style={{ color: '#fff' }}>{methodZh}</Text>；另一种作为独立交叉验证一并列出。
          </Text>
          <View style={s.methodBlock}>
            <Text style={s.methodName}>① Jackson 1990 非运动方程</Text>
            <Text style={s.formula}>VO₂max = 56.363 + 1.921·PAR − 0.381·年龄 − 0.754·BMI + 10.987·性别</Text>
            <Row label="结果" value={result.jackson != null ? `${result.jackson} ml/kg·min` : '—'} sub="性别 男=1 / 女=0；2,009 人验证" />
          </View>
          <View style={s.methodBlock}>
            <Text style={s.methodName}>② Uth 心率比法（2004）</Text>
            <Text style={s.formula}>VO₂max = 15.3 × (HRmax / HRrest)</Text>
            <Row label="结果" value={result.usop != null ? `${result.usop} ml/kg·min` : '—'} sub="含 Voutilainen 普通人群常数修正" />
          </View>
          <Text style={s.note}>
            说明：心率比法常数 15.3 是针对训练男性的上限；普通人群（尤其女性）按 Voutilainen 2020 向下修正，
            因此 Jackson（性别特异、含 BMI 与活动量）作为主估计更稳。
          </Text>
        </Section>

        {/* 常模参考 */}
        <Section title="同龄同性别常模（ACSM / Cooper Institute）">
          <Text style={s.note}>
            数值按年龄×性别分七档，源自 ACSM《运动测试与处方指南》第 11 版表 4.7（Cooper Institute 队列，n&gt;80,000 直接气体分析）。
          </Text>
          <Text style={s.bandList}>
            偏低 · 略低 · 平均 · 中上 · 良好 · 优秀 · 卓越{'\n'}
            你所在档：<Text style={{ color: '#fff' }}>{result.band}</Text>
          </Text>
          <Text style={s.note}>
            参考点：35 ≈ 代谢健康基线；45 ≈ 活跃业余运动者中位；55+ ≈ 竞技业余跑者；65+ ≈ 次精英耐力运动员。
          </Text>
        </Section>

        {/* 诚实声明 + 出处 */}
        <Section title="关于这个数字">
          <Text style={s.note}>
            这是基于可穿戴静息心率 + 体成分的<Text style={{ color: '#fff' }}>非运动估算</Text>，不是实验室气体交换直接测量值。
            可穿戴估算与真值存在 ±5–10 ml/kg·min 的个体偏差（群体均值准、个体偏差大），更适合<Text style={{ color: '#fff' }}>看自己的长期趋势</Text>，而非单次精确值。
            服用影响心率的药物（如 β 受体阻滞剂）、疾病、高温、高原等会显著影响心率类估算。
          </Text>
          <Text style={s.refTitle}>文献出处</Text>
          {result.references.map((r, i) => (
            <Text key={i} style={s.ref}>{`${i + 1}. ${r}`}</Text>
          ))}
        </Section>
      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40 },
  h1: { fontSize: theme.fontSize.h2, fontWeight: '700', color: mm.colors.ink, letterSpacing: 0.5 },
  h2: { fontSize: theme.fontSize.xs, color: SUB, marginTop: 2, marginBottom: 12 },
  hero: {
    backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.lg,
    paddingVertical: 22, alignItems: 'center', marginBottom: 14,
  },
  // ★ 2026-11-03：裸 58 → fontSize.hero(46)，与 MetricDetail/StatusTrend 等 hero 数字同 token
  heroNum: { fontSize: theme.fontSize.hero, fontWeight: '800', color: mm.colors.ink, lineHeight: 48 },
  heroUnit: { fontSize: theme.fontSize.sm, color: SUB, marginLeft: 8, marginBottom: 10 },
  bandPill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: theme.radius.pill, marginTop: 6 },
  bandPillTxt: { fontSize: theme.fontSize.xs, fontWeight: '700' },
  heroSub: { fontSize: theme.fontSize.xs, color: FAINT, marginTop: 8 },
  /* ★ 2026-11-03（用户·统一 hero 结构）：数字下方短分析（深色主题，沿用 FAINT/SUB） */
  heroAnalysis: { fontSize: theme.fontSize.xs, color: SUB, lineHeight: 19, marginTop: 10 },
  card: {
    backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.lg,
    padding: 16, marginBottom: 14,
  },
  cardTitle: { fontSize: theme.fontSize.body, fontWeight: '700', color: mm.colors.ink, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  rowLabel: { fontSize: theme.fontSize.xs, color: SUB, width: 110 },
  rowValue: { fontSize: theme.fontSize.sm, fontWeight: '600', color: mm.colors.ink },
  rowSub: { fontSize: theme.fontSize.micro, color: FAINT, marginTop: 2 },
  note: { fontSize: theme.fontSize.xs, color: SUB, lineHeight: 18, marginBottom: 8 },
  methodBlock: { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: theme.radius.md, padding: 12, marginBottom: 10 },
  methodName: { fontSize: theme.fontSize.sm, fontWeight: '700', color: mm.colors.ink, marginBottom: 4 },
  formula: { fontSize: theme.fontSize.xs, color: '#BFE3FF', fontStyle: 'italic', marginBottom: 6 },
  bandList: { fontSize: theme.fontSize.xs, color: SUB, lineHeight: 20, marginBottom: 6 },
  refTitle: { fontSize: theme.fontSize.xs, fontWeight: '700', color: mm.colors.ink, marginTop: 4, marginBottom: 6 },
  ref: { fontSize: theme.fontSize.tiny, color: FAINT, lineHeight: 15, marginBottom: 5 },
  empty: { fontSize: theme.fontSize.body, fontWeight: '600', color: mm.colors.ink, marginBottom: 8 },
  emptySub: { fontSize: theme.fontSize.xs, color: SUB, lineHeight: 19 },
});
