import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Path, Text as SvgText, G } from 'react-native-svg';
import { theme } from '../theme/theme';
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
  const deltaColor = isYounger ? theme.colors.success : theme.colors.danger;

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
    <View>
      {/* ═══ SVG 弧 (参考 HTML) ═══ */}
      <View style={{ alignItems: 'center', paddingTop: theme.sp(1.5) }}>
        <Svg width="100%" height={VB_H} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="haRing" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={theme.colors.success} />
              <Stop offset="100%" stopColor={isYounger ? theme.colors.accent1 : theme.colors.danger} />
            </LinearGradient>
          </Defs>

          {/* 背景弧: 半透明白 */}
          <Path d={arcD}
            stroke="rgba(255,255,255,0.22)" strokeWidth={stroke}
            fill="none" strokeLinecap="round" />

          {/* 进度弧: 纯白 */}
          {pct > 0 && (
            <Path d={arcD}
              stroke="#FFFFFF" strokeWidth={stroke}
              fill="none" strokeLinecap="round"
              strokeDasharray={`${targetLen} ${totalLen - targetLen}`} />
          )}

          {/* 进度终点 marker: 红色实心 + 白色高光 (参考 .arc-dot + .arc-dot-highlight) */}
          {pct > 0 && (
            <G>
              {/* 外圈光晕 */}
              <Circle cx={markerX} cy={markerY} r={22}
                fill="none" stroke={deltaColor} strokeWidth={1} opacity={0.25} />
              {/* 红色实心圆 */}
              <Circle cx={markerX} cy={markerY} r={14}
                fill={deltaColor} />
              {/* 白色高光 (左上偏移) */}
              <Circle cx={markerX - 4} cy={markerY - 4} r={5}
                fill="rgba(255,255,255,0.55)" />
            </G>
          )}
        </Svg>

        {/* ═══ 中央内容 (position: absolute 风格, 但用 View 布局) ═══ */}
        <View style={[styles.centerContent, { marginTop: -VB_H + 82 }]} pointerEvents="none">
          <View style={[styles.trendBadge, { backgroundColor: deltaColor, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: {width: 0, height: 2}, elevation: 3 }]}>
            <Icon name={isYounger ? 'activity' : 'breath'}
              size={theme.fontSize.sm} color={'#FFFFFF'} />
            <Text style={[styles.trendText, { color: '#FFFFFF' }]}>
              {isYounger ? '年轻' : '衰老'} {Math.abs(delta).toFixed(1)} 岁
            </Text>
          </View>

          <View style={styles.labelRow}>
            <Icon name="heart" size={theme.fontSize.sm} color={'#FFFFFF'} style={{ marginRight: 4 }} />
            <Text style={styles.labelText}>身体年龄</Text>
          </View>
        </View>
      </View>

      {/* ═══ AI 分析白卡片 ═══ */}
      <View style={styles.cardWrap}>
        <AiBadge label="AI 分析" />
        <Text style={styles.body} numberOfLines={4}>
          {analysisText}
        </Text>
      </View>
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
    color: '#FFFFFF',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.sp(1.5),
  },
  labelText: {
    fontSize: theme.fontSize.card,
    fontWeight: '400',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  cardWrap: {
    marginHorizontal: theme.sp(3),
    marginTop: theme.sp(2.5),
    marginBottom: theme.sp(2),
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(2.5),
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.card,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: theme.fontSize.sm * 1.5,
  },
});
