import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Path, Text as SvgText, G } from 'react-native-svg';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { AiBadge } from './AiAnalysis';
import { analyzeCortisol } from '../lib/cortisolRhythm';

interface Props {
  healthAge?: number;
  actualAge?: number;
  overallScore?: number;
  ring?: any;
  rows?: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[];
  pending?: boolean;
}

export default function HealthAgeCard({
  healthAge = 18,
  actualAge = 22,
  overallScore = 84,
  ring,
  rows,
  pending,
}: Props) {
  const delta = healthAge - actualAge;
  const isYounger = healthAge < actualAge;
  const deltaSign = delta >= 0 ? '+' : '';
  const deltaStr = `${deltaSign}${delta.toFixed(1)}`;
  // v16 §4.2 #1：黄绿胶囊统一（#EAF0BE / #6E7A24），不再按年轻/衰老换色
  const pill = { bg: mm.colors.heroPillGreen, fg: mm.colors.limeDeep };
  // v16 端点圆点 = 黄绿 mid #BCCB62（好坏由数字与文案表达，不用红绿）
  const markerColor = mm.colors.limeMid;

  // ═══ 参考 HTML 的扁平大弧: M 5 135 A 220 220 0 0 1 385 135 ═══
  // SVG viewBox 尺寸
  const VB_W = 335;
  const VB_H = 160;
  const stroke = 24;
  // 大半径, 圆心在画布下方, 形成扁平拱
  const R = 220;
  const cx = VB_W / 2;           // 167.5
  const cy = VB_H + (R - VB_H);  // 圆心 y, 让弧落在画布底部附近
  // 弧的两个端点: 左右边缘, y=135 (接近底部)
  const x1 = 5, y1 = 95;
  const x2 = VB_W - 5, y2 = 95;
  // Path d
  const arcD = `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;

  // 弧总长 (用参考值 459 按比例缩放)
  const totalLen = 459 * (VB_W / 390);
  const pct = Math.max(0, Math.min(100, overallScore)) / 100;
  const targetLen = totalLen * pct;

  // ═══ 进度终点圆点数学 (和 reference 完全一致) ═══
  const halfAngle = Math.asin((x2 - cx) / R);   // 半角
  const dotAngle = -halfAngle + halfAngle * 2 * pct;
  const dotCx = cx;
  const dotCy = cy;
  const dotR = R;
  const markerX = dotCx + dotR * Math.sin(dotAngle);
  const markerY = dotCy - dotR * Math.cos(dotAngle);

  // ═══ 皮质醇 + 经期分析 ═══
  const analysisText = (() => {
    if (pending) return 'AI 分析中...';
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
    } catch {
      return isYounger ? '节律综合偏年轻。' : '节律偏高，建议保证作息。';
    }
  })();

  return (
    <View style={styles.cardShell}>
      {/* v16 §4.2 #1：浅黄绿渐变卡底（#F8FAE8→#FDFEF7），弧线画在其上 */}
      <ExpoLinearGradient
        colors={[mm.colors.heroGradFrom, mm.colors.heroGradTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.heroGrad}
      >
        {/* ═══ SVG 弧 (参考 HTML) ═══ */}
        <View style={{ alignItems: 'center', paddingTop: theme.sp(1.5) }}>
          <Svg width="100%" height={VB_H} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
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

          {/* ═══ 中央内容 (position: absolute 风格, 但用 View 布局) ═══ */}
          <View style={[styles.centerContent, { marginTop: -VB_H + 82 }]} pointerEvents="none">
            <View style={[styles.trendBadge, { backgroundColor: pill.bg }]}>
              <Icon name={isYounger ? 'activity' : 'breath'}
                size={theme.fontSize.sm} color={pill.fg} />
              <Text style={[styles.trendText, { color: pill.fg }]}>
                {isYounger ? '年轻' : '衰老'} {Math.abs(delta).toFixed(1)} 岁
              </Text>
            </View>

            <View style={styles.labelRow}>
              <Icon name="heart" size={theme.fontSize.sm} color={mm.colors.limeDeep} style={{ marginRight: 4 }} />
              <Text style={[styles.labelText, { color: mm.colors.limeDeep }]}>身体年龄</Text>
            </View>
          </View>
        </View>

        {/* ═══ AI 分析白卡片（渐变底上的独立白卡，SPEC「再下白卡」） ═══ */}
        <View style={styles.cardWrap}>
          <AiBadge label="AI 分析" />
          <Text style={styles.body} numberOfLines={4}>
            {analysisText}
          </Text>
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
});
