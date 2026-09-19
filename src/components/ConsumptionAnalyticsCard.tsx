/**
 * ConsumptionAnalyticsCard —— 首页「今日消耗」卡
 * 左：大右半圆 + 中心综合消耗率 %
 * 右：三个方卡（emotion/brain/sport）
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { computeConsumption, fmtShare, type NavType } from './ConsumptionCard';

const IMG_EMOTION = require('../assets/card_emotion_new.png');
const IMG_COG = require('../assets/card_focus.jpg');
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
const ITEM_IMGS = [IMG_EMOTION, IMG_COG, IMG_ACTIVITY];

const SVG_W = 140;
const SVG_H = 280;
const R = 115;

// ★ design token 色映射
const SEG_TOKENS = [
  { id: 'grad-emotion', main: theme.colors.stateTense,  light: '#F5D8C3',  glow: theme.colors.cardGlowEmotion },
  { id: 'grad-brain',   main: theme.colors.accent1,     light: '#D8D1FB',  glow: theme.colors.cardGlowBrain },
  { id: 'grad-sport',   main: theme.colors.accent2,     light: '#C3DCFB',  glow: theme.colors.cardGlowSport },
];

export default function ConsumptionAnalyticsCard({
  ring,
  onNav,
}: {
  ring: any;
  onNav?: (type: NavType) => void;
}) {
  const { segs, overall } = useMemo(() => computeConsumption(ring), [ring]);

  const semiPath = `M 0 30 A ${R} ${R} 0 0 1 0 ${SVG_H - 30}`;
  const circumference = Math.PI * R;

  let acc = 0;
  const segDraws = segs.map((s, i) => {
    const len = Math.max(1, s.share * circumference);
    const dashOffset = -acc * circumference;
    acc += s.share;
    return { ...s, len, dashOffset, grad: SEG_TOKENS[i] };
  });

  return (
    <View style={styles.wrap}>
      {/* ★ 标题行：只有「今日消耗」，去掉日期/副标题 */}
      <View style={styles.headRow}>
        <Text style={styles.title}>今日消耗</Text>
      </View>

      <View style={styles.body}>
        {/* 左：大半圆 SVG + 中心 % */}
        <View style={styles.semiBox}>
          <Svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
            <Defs>
              {SEG_TOKENS.map((t) => (
                <SvgGrad key={t.id} id={t.id} x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0%" stopColor={t.light} />
                  <Stop offset="100%" stopColor={t.main} />
                </SvgGrad>
              ))}
            </Defs>

            <Path d={semiPath} stroke={theme.colors.bgMidAlt} strokeWidth={20} strokeLinecap="butt" fill="none" />
            {segDraws.map((sd) => (
              <Path
                key={sd.key}
                d={semiPath}
                stroke={`url(#${sd.grad.id})`}
                strokeWidth={20}
                strokeLinecap="butt"
                fill="none"
                strokeDasharray={`${sd.len.toFixed(2)} ${(circumference - sd.len).toFixed(2)}`}
                strokeDashoffset={sd.dashOffset.toFixed(2)}
              />
            ))}
          </Svg>

          {/* 中心：综合消耗率 % */}
          <View style={styles.centerLabel} pointerEvents="none">
            <Text style={styles.centerPct}>
              {overall ?? 0}
              <Text style={styles.centerPctSmall}>%</Text>
            </Text>
            <Text style={styles.centerSub}>今日消耗</Text>
          </View>
        </View>

        {/* 右：三个方形 item 卡片 */}
        <View style={styles.itemsCol}>
          {segs.map((s, i) => {
            const img = ITEM_IMGS[i];
            const tok = SEG_TOKENS[i];
            return (
              <TouchableOpacity
                key={s.key}
                activeOpacity={0.85}
                disabled={!onNav}
                onPress={() => onNav?.(s.nav)}
                style={styles.itemOuter}
              >
                <ImageBackground source={img} style={styles.itemImg} resizeMode="cover">
                  <LinearGradient
                    colors={['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.88)', '#FFFFFF']}
                    locations={[0.05, 0.35, 0.65, 0.95]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  />
                  <View style={styles.itemTextOverlay}>
                    <View style={styles.itemHeadRow}>
                      <Text style={styles.itemLabel} numberOfLines={1}>{s.label}</Text>
                      <Text style={[styles.itemShare, { color: tok.main }]} numberOfLines={1}>
                        占 {fmtShare(s.share)}
                      </Text>
                    </View>
                    <View style={styles.itemValueRow}>
                      <Text style={styles.itemValue} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
                      <Text style={styles.itemUnit}>{s.unit}</Text>
                    </View>
                  </View>
                </ImageBackground>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    ...theme.shadow.card,
  },
  headRow: { marginBottom: theme.space.sm },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.bold,
    color: theme.colors.textInk,
  },
  body: { flexDirection: 'row', alignItems: 'center' },

  // —— 左半圆 ——
  semiBox: {
    width: SVG_W,
    height: SVG_H,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    position: 'absolute',
    top: SVG_H / 2 - 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPct: {
    fontSize: theme.fs(38),
    fontWeight: theme.weight.bold,
    color: theme.colors.textInk,
  },
  centerPctSmall: {
    fontSize: theme.fs(14),
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
  },
  centerSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 2,
  },

  // —— 右侧三个方卡 ——
  itemsCol: {
    flex: 1,
    flexDirection: 'column',
    marginLeft: theme.sp(2),
    gap: theme.sp(2),
  },
  itemOuter: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  itemImg: {
    width: '100%',
    height: 130,
    justifyContent: 'center',
  },
  itemTextOverlay: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  itemHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    fontSize: theme.fs(13),
    color: theme.colors.textTitle,
    fontWeight: theme.weight.medium,
  },
  itemShare: {
    fontSize: theme.fs(9),
    fontWeight: theme.weight.semibold,
  },
  itemValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
    justifyContent: 'center',
  },
  itemValue: {
    fontSize: theme.fs(20),
    fontWeight: theme.weight.bold,
    color: theme.colors.textInk,
    flexShrink: 1,
  },
  itemUnit: {
    fontSize: theme.fs(11),
    color: theme.colors.textSub,
    marginLeft: 2,
  },
});
