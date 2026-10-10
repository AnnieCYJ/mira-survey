import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Path, Text as SvgText, G } from 'react-native-svg';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { AiBadge } from './AiAnalysis';
import { analyzeCortisol } from '../lib/cortisolRhythm';

interface Props {
  healthAge?: number | null;
  actualAge?: number | null;
  onEditProfile?: () => void;
  overallScore?: number | null;
  ring?: any;
  rows?: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[];
  pending?: boolean;
  /** ★ 2026-10-06：由洞察页综合「荷尔蒙节律 + 长期健康数据」算好的分析结论（已简化）。
   *   传入后直接用，不再在卡内重复跑皮质醇逻辑；不传则回落卡内旧兜底。 */
  analysisText?: string;
  /** ★ 2026-10-06：卡片底部「建议」区的两条综合建议（最多展示 2 条）。 */
  suggestions?: string[];
}

export default function HealthAgeCard({
  healthAge = null,
  actualAge = null,
  overallScore = null,
  onEditProfile,
  ring,
  rows,
  pending,
  analysisText,
  suggestions,
}: Props) {
  const hasEstimate = healthAge != null && actualAge != null && Number.isFinite(healthAge) && Number.isFinite(actualAge);
  const delta = hasEstimate ? healthAge! - actualAge! : 0;
  const isYounger = hasEstimate && delta < 0;
  // v16 §4.2 #1：黄绿胶囊统一（#EAF0BE / #6E7A24），不再按年轻/衰老换色
  const pill = { bg: mm.colors.heroPillGreen, fg: mm.colors.limeDeep };
  // v16 端点圆点 = 黄绿 mid #BCCB62（好坏由数字与文案表达，不用红绿）
  const markerColor = mm.colors.limeMid;

  // ═══ 扁平大弧：端点 (EDGE,END_Y)→(W-EDGE,END_Y)，圆心在画布下方 ═══
  // ★ 2026-09-27 重写几何：旧实现端点/半径/圆心三者不自洽（asin 用 R=220 但真实过弦圆心
  //   在 cy≈243），marker 悬空在弧外 ~22px；且 preserveAspectRatio="none" 横向拉伸把圆点
  //   拉成椭圆。现在 onLayout 实测宽度 W，viewBox 1:1 无拉伸，R/圆心/角度全部精确互洽。
  const VB_H = 160;
  const stroke = 24;
  const END_Y = 95;
  const EDGE = 5;
  const [W, setW] = React.useState(0);
  const halfChord = W > 0 ? (W - EDGE * 2) / 2 : 0;
  // R 下限：保证弧顶 (cy-R) 不低于 stroke/2（弧顶不被画布裁掉）；再取参考稿扁平度
  const RMin = halfChord > 0 ? (halfChord * halfChord + (END_Y - stroke / 2) * (END_Y - stroke / 2)) / (2 * (END_Y - stroke / 2)) : 220;
  const R = Math.max(220, RMin + 2);
  const cx = W / 2;
  const cy = END_Y + Math.sqrt(Math.max(R * R - halfChord * halfChord, 1));
  const arcD = `M ${EDGE} ${END_Y} A ${R} ${R} 0 0 1 ${W - EDGE} ${END_Y}`;

  // 弧长（精确）：L = 2R·asin(halfChord/R)
  const halfAngle = halfChord > 0 ? Math.asin(halfChord / R) : 0;
  const totalLen = 2 * R * halfAngle;
  const pct = Math.max(0, Math.min(100, overallScore ?? 0)) / 100;
  const targetLen = totalLen * pct;

  // ═══ 进度终点圆点：θ 从 -halfAngle（左端）到 +halfAngle（右端），严格落在圆上 ═══
  const dotAngle = -halfAngle + halfAngle * 2 * pct;
  const markerX = cx + R * Math.sin(dotAngle);
  const markerY = cy - R * Math.cos(dotAngle);

  // ═══ 皮质醇 + 经期分析 ═══
  const analysisTextFallback = (() => {
    if (pending) return 'AI 分析中…';
    if (rows && rows.length > 0) return rows[0].body;
    try {
      const cortisol = ring?.intraday?.cortisol;
      let cortisolLine = '';
      if (cortisol && cortisol.length > 0) {
        const samples = cortisol
          .map((v: any, i: number) => ({ t: i * 3600 * 1000, v: v.value ?? v }))
          .filter((s: any) => Number.isFinite(s.v) && s.v > 0);
        if (samples.length < 4) {
          cortisolLine = '皮质醇节律数据不足，建议连续佩戴以捕捉完整节律。';
        } else {
          const analysis = analyzeCortisol(samples);
          const amp = analysis.cosinor?.amplitude ?? 0;
          if (analysis.status === ('dysregulated' as any)) {
            cortisolLine = `皮质醇节律紊乱，建议规律作息以恢复稳定节律。`;
          } else if (amp > 0.3) {
            cortisolLine = `皮质醇节律振幅 ${amp.toFixed(2)}，昼夜波动偏强。`;
          } else {
            cortisolLine = `皮质醇节律平稳，昼夜波动适中。`;
          }
        }
      } else {
        cortisolLine = '皮质醇节律数据不足，建议连续佩戴以捕捉完整节律。';
      }
      const cyclePrefix = ring?.female && ring?.cycle?.phase
        ? `当前处于${ring.cycle.phase}期，`
        : '';
      return `${cortisolLine} ${cyclePrefix}${
        isYounger
          ? '节律综合偏年轻，作息与活动节奏稳定。'
          : '节律偏高，近期睡眠债累积，建议优先保证作息。'
      }`;
    }     catch {
      return isYounger ? '节律综合偏年轻。' : '节律偏高，建议保证作息。';
    }
  })();
  // ★ 2026-10-06：优先用洞察页算好的综合结论（荷尔蒙节律 + 长期健康数据），没有才用卡内旧兜底
  const analysisTextResolved = analysisText ?? analysisTextFallback;

  return (
    <View style={styles.cardShell}>
      {/* v16 §4.2 #1：浅黄绿渐变卡底（#F8FAE8→#FDFEF7），弧线画在其上 */}
      <ExpoLinearGradient
        colors={[mm.colors.heroGradFrom, mm.colors.heroGradTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.heroGrad}
      >
        {/* ★ 2026-10-10（用户）：「身体年龄」移到卡片左上角；去掉「参考估算」 */}
        <View style={styles.topLabelRow}>
          <Icon name="heart" size={theme.fontSize.sm} color={mm.colors.limeDeep} style={{ marginRight: 4 }} />
          <Text style={[styles.topLabel, { color: mm.colors.limeDeep }]}>身体年龄</Text>
        </View>

        {/* ═══ SVG 弧（onLayout 实测宽度，viewBox 1:1，无拉伸变形） ═══ */}
        <View style={{ alignItems: 'center', paddingTop: theme.sp(1.5) }} onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (Math.abs(w - W) > 0.5) setW(w);
        }}>
          {W > 0 ? (
          <Svg width={W} height={VB_H} viewBox={`0 0 ${W} ${VB_H}`}>
            <Defs>
              {/* v16 §4.2 #1：进度弧黄绿阶 soft→core→mid（#EAF0BE→#D5E384→#BCCB62） */}
              <LinearGradient id="haRing" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0%" stopColor={mm.colors.limeSoft} />
                <Stop offset="50%" stopColor={mm.colors.limeCore} />
                <Stop offset="100%" stopColor={mm.colors.limeMid} />
              </LinearGradient>
            </Defs>

            {/* 背景轨道: #E7EBD4 */}
            <Path d={arcD}
              stroke={mm.colors.heroTrack} strokeWidth={stroke}
              fill="none" strokeLinecap="round" />

            {/* 进度弧: 黄绿阶渐变 */}
            {pct > 0 && (
              <Path d={arcD}
                stroke="url(#haRing)" strokeWidth={stroke}
                fill="none" strokeLinecap="round"
                strokeDasharray={`${targetLen} ${totalLen - targetLen}`} />
            )}

            {/* 进度终点 marker: 黄绿 mid 实心 + 白色高光 */}
            {pct > 0 && (
              <G>
                {/* 外圈光晕 */}
                <Circle cx={markerX} cy={markerY} r={22}
                  fill="none" stroke={markerColor} strokeWidth={1} opacity={0.25} />
                {/* 实心圆 */}
                <Circle cx={markerX} cy={markerY} r={14}
                  fill={markerColor} />
                {/* 白色高光 (左上偏移) */}
                <Circle cx={markerX - 4} cy={markerY - 4} r={5}
                  fill="rgba(255,255,255,0.55)" />
              </G>
            )}
          </Svg>
          ) : null}

          {/* ═══ 中央内容：圆环下正中 — 大号「较实际年龄低 X 岁」
              ★ 2026-10-10（用户）：5.3 岁放大居中；caption「较实际年龄低」字号加大；
              不再用 pill；「参考估算」移除；参考 Apple Health Age 文案口径 ═══ */}
          <View style={[styles.centerContent, { marginTop: -VB_H + 72 }]} pointerEvents="none">
            {hasEstimate ? (
              <>
                <Text style={[styles.deltaCap, { color: pill.fg }]}>
                  {delta === 0 ? '与实际年龄相近' : `较实际年龄${isYounger ? '低' : '高'}`}
                </Text>
                <Text style={[styles.deltaBig, { color: pill.fg }]}>
                  {Math.abs(delta).toFixed(1)} 岁
                </Text>
              </>
            ) : (
              <Text style={[styles.deltaSub, { color: theme.colors.textSub }]}>
                {actualAge == null ? '填写年龄后查看' : '数据积累中'}
              </Text>
            )}
          </View>
        </View>

        {/* ═══ AI 分析白卡片（渐变底上的独立白卡，SPEC「再下白卡」）
            ★ 2026-10-06（用户：分析与建议不要两个框，合并在一个框里） ═══ */}
        {actualAge == null && onEditProfile ? (
          <TouchableOpacity onPress={onEditProfile} accessibilityRole="button" accessibilityLabel="填写身体档案"
            style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: mm.colors.limeDeep, fontSize: theme.fontSize.body }}>填写身体档案 ›</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.cardWrap}>
          <AiBadge label="AI 分析" />
          <Text style={styles.body}>
            {analysisTextResolved}
          </Text>
          {suggestions && suggestions.length > 0 ? (
            <View style={styles.suggestInner}>
              {suggestions.slice(0, 2).map((s, i) => (
                <View style={styles.suggestItem} key={i}>
                  <Text style={styles.suggestDot}>·</Text>
                  <Text style={styles.suggestText}>{s}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ExpoLinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContent: {
    alignItems: 'center',
    width: '100%',
  },
  // ★ 2026-10-10（用户）：「身体年龄」移到卡片左上角
  topLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.sp(4),
    paddingTop: theme.sp(2.5),
    paddingBottom: theme.sp(0.5),
  },
  topLabel: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.5,
  },
  // ★ 2026-10-10（用户）：圆环下正中大号 delta —— caption 加大、数字 40pt 居中
  deltaCap: {
    fontSize: theme.fontSize.body,        // 14，旧 pill 为 12
    fontWeight: theme.weight.semibold,
    marginBottom: theme.sp(0.5),
  },
  deltaBig: {
    fontSize: 40,
    fontWeight: '300',
    letterSpacing: -1.5,
    lineHeight: 44,
    color: mm.colors.ink,
  },
  deltaSub: {
    fontSize: theme.fontSize.card,
    color: theme.colors.textSub,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  scoreNum: {
    fontSize: theme.fontSize.hero * 1.3,   // 大字号, 参考 110px
    fontWeight: '300',                       // thin
    color: theme.colors.textTitle,
    lineHeight: theme.fontSize.hero * 1.3 * 0.9,
    letterSpacing: -2,
  },
  scoreTotal: {
    fontSize: theme.fontSize.card,
    fontWeight: '300',
    color: theme.colors.textSub,
    opacity: 0.7,
    marginTop: theme.sp(2),
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1),
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1.2),
    borderRadius: theme.radius.pill,
    marginTop: theme.sp(1.5),
  },
  trendText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.sp(1.5),
  },
  labelText: {
    fontSize: theme.fontSize.card,
    fontWeight: '400',
    color: mm.colors.ink,
    letterSpacing: 0.5,
  },
  // v16：外层壳描边用黄绿系（SPEC §4.2 #1 rgba(146,168,52,.18)）；淡紫旧底废弃
  cardShell: {
    borderWidth: 1,
    borderColor: mm.colors.heroBorder,
    borderRadius: mm.radius.card,
    overflow: 'hidden',
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
    backgroundColor: mm.colors.heroGradTo,
  },
  heroGrad: {
    paddingTop: theme.sp(2),
  },
  cardWrap: {
    marginHorizontal: theme.sp(3),
    marginTop: theme.sp(2),
    marginBottom: theme.sp(3),
    backgroundColor: mm.colors.cardBg,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3),
    paddingTop: theme.sp(2.5),
    paddingBottom: theme.sp(2.5),
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  // ★ 2026-10-06：建议区（AI 分析下方的 2 条综合建议）
  //   用户要求「分析和建议不要两个框，在一个框里」→ suggestWrap/suggestTitle 不再使用，
  //   建议改为 suggestInner（渲染在 AI 分析白卡内部，与分析文案同框）。
  suggestInner: {
    marginTop: theme.sp(1.5),
    paddingTop: theme.sp(1.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mm.colors.cardBorder,
  },
  suggestWrap: {
    marginHorizontal: theme.sp(3),
    marginBottom: theme.sp(3),
    backgroundColor: mm.colors.cardBg,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3),
    paddingTop: theme.sp(2.5),
    paddingBottom: theme.sp(2.5),
  },
  suggestTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.limeDeep,
    marginBottom: theme.sp(1.5),
  },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.sp(1),
  },
  suggestDot: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold,
    color: mm.colors.limeMid,
    marginRight: theme.sp(1),
    lineHeight: theme.fontSize.sm * 1.5,
  },
  suggestText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: theme.fontSize.sm * 1.5,
  },
});
