import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Path, Text as SvgText, G } from 'react-native-svg';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { analyzeCortisol } from '../lib/cortisolRhythm';

interface Props {
  healthAge?: number | null;
  actualAge?: number | null;
  onEditProfile?: () => void;
  /** ★ 2026-10-10（用户）：点卡片进身体年龄详情页；仅在有估算值时生效（无年龄时不劫持「填写身体档案」CTA）。 */
  onPress?: () => void;
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
  onPress,
  ring,
  rows,
  pending,
  analysisText,
  suggestions,
}: Props) {
  const hasEstimate = healthAge != null && actualAge != null && Number.isFinite(healthAge) && Number.isFinite(actualAge);
  const delta = hasEstimate ? healthAge! - actualAge! : 0;
  const isYounger = hasEstimate && delta < 0;
  /** 与实际年龄相近（|Δ| < 0.5 岁）时既不算低也不算高 → 中性 */
  const isFlat = hasEstimate && Math.abs(delta) < 0.5;

  /**
   * ★ 2026-10-10（用户：「比实际年龄高了是不是应该变成粉色？这个逻辑是什么样的」）
   *
   * 改前的逻辑：**颜色恒定黄绿，完全不随身体年龄变化**
   * （旧注释写死「v16 §4.2 #1：黄绿胶囊统一，不再按年轻/衰老换色」）。
   * 结果是「低 5.4 岁」和「高 5.4 岁」长得一模一样，视觉上完全没有反馈。
   *
   * 改后的语义色（只表达**方向和量级**，不做诊断、不做奖惩）：
   *   比实际年龄**低**（年轻）→ 黄绿系 lime（现状的主色，代表状态好）
   *   比实际年龄**高**（偏高）→ 粉色系 rose（中性提示「偏高」，不是红色警告）
   *   与实际年龄**相近**（|Δ|<0.5）→ 中性墨色系，不染色
   * 为什么用粉不用红：Mira 品牌铁律规避「监测/预警/诊断」口吻；
   * 红=危险/告警，粉=「这个数字比基准线高」，语气是陈述而非警告。
   */
  const tone = isFlat ? 'flat' : isYounger ? 'young' : 'high';
  // ★ mira-ocean（2026-10-17）：hero 改深海玻璃底 → 弧渐变取中档（浅档在深底上发灰）、
  //   pill.fg 改亮档（limeCore / roseCore；flat 走 textSub 白阶）。
  const PALETTE = {
    young: {
      gradFrom: mm.colors.limeMid, gradMid: mm.colors.limeCore, gradTo: mm.colors.limeMid,
      marker: mm.colors.limeMid, fg: '#D5E384',
    },
    high: {
      gradFrom: mm.colors.roseMid, gradMid: mm.colors.roseCore, gradTo: mm.colors.roseDeep,
      marker: mm.colors.roseCore, fg: '#F2A3C6',
    },
    flat: {
      gradFrom: 'rgba(255,255,255,0.62)', gradMid: 'rgba(255,255,255,0.78)', gradTo: 'rgba(255,255,255,0.78)',
      marker: 'rgba(255,255,255,0.78)', fg: theme.colors.textSub,
    },
  } as const;
  const pal = PALETTE[tone];
  const pill = { bg: mm.colors.heroPillGreen, fg: pal.fg };
  const markerColor = pal.marker;

  // ═══ 扁平大弧：端点 (EDGE,END_Y)→(W-EDGE,END_Y)，圆心在画布下方 ═══
  // ★ 2026-09-27 重写几何：旧实现端点/半径/圆心三者不自洽（asin 用 R=220 但真实过弦圆心
  //   在 cy≈243），marker 悬空在弧外 ~22px；且 preserveAspectRatio="none" 横向拉伸把圆点
  //   拉成椭圆。现在 onLayout 实测宽度 W，viewBox 1:1 无拉伸，R/圆心/角度全部精确互洽。
  const VB_H = 160;
  const stroke = 24;
  const END_Y = 95;
  const EDGE = 5;
  const [W, setW] = React.useState(0);
  // ★ 2026-10-10（用户）：弧上圆点「沿弧跑到位」的入场动画——animPct 0→1，按角度驱动进度弧与圆点
  const [animPct, setAnimPct] = React.useState(0);
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
  // ★ 动画进度：entrance 时从 0 涨到目标 pct（圆点沿弧运动、进度弧生长）
  const effPct = animPct * pct;
  const targetLen = totalLen * effPct;

  // ═══ 进度终点圆点：θ 从 -halfAngle（左端）到 +halfAngle（右端），严格落在圆上 ═══
  const dotAngle = -halfAngle + halfAngle * 2 * effPct;
  const markerX = cx + R * Math.sin(dotAngle);
  const markerY = cy - R * Math.cos(dotAngle);

  // ★ 入场动画：overallScore 变化时，圆点沿弧从起点跑到目标位（easeOutCubic）
  React.useEffect(() => {
    let raf = 0;
    let start = 0;
    const dur = 900;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimPct(eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pct]);

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
    <TouchableOpacity
      activeOpacity={onPress && actualAge != null ? 0.7 : 1}
      onPress={onPress && actualAge != null ? onPress : undefined}
      style={styles.cardShell}
    >
      {/* v16 §4.2 #1：浅黄绿渐变卡底（#F8FAE8→#FDFEF7），弧线画在其上 */}
      <ExpoLinearGradient
        colors={[mm.colors.heroGradFrom, mm.colors.heroGradTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.heroGrad}
      >
        {/* ★ 2026-10-10（用户）：「身体年龄」移到卡片左上角；去掉「参考估算」 */}
        <View style={[styles.topLabelRow, { justifyContent: 'space-between' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="heart" size={theme.fontSize.sm} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={[styles.topLabel, { color: '#FFFFFF' }]}>身体年龄</Text>
          </View>
          <Icon name="chevronRight" size={16} color="rgba(255,255,255,0.72)" />
        </View>

        {/* ═══ SVG 弧（onLayout 实测宽度，viewBox 1:1，无拉伸变形） ═══ */}
        <View style={{ alignItems: 'center', paddingTop: theme.sp(1.5) }} onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (Math.abs(w - W) > 0.5) setW(w);
        }}>
          {W > 0 ? (
          <Svg width={W} height={VB_H} viewBox={`0 0 ${W} ${VB_H}`}>
            <Defs>
              {/* ★ 2026-10-10（用户）：进度弧渐变随「低/高」换色 —— 低=黄绿、高=粉、相近=中性墨 */}
              <LinearGradient id="haRing" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0%" stopColor={pal.gradFrom} />
                <Stop offset="50%" stopColor={pal.gradMid} />
                <Stop offset="100%" stopColor={pal.gradTo} />
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
            <Text style={{ color: '#BFCBFF', fontSize: theme.fontSize.body }}>填写身体档案 ›</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.cardWrap}>
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
    </TouchableOpacity>
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
    color: '#D5E384',
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
