/**
 * BentoCard —— v18.51 Bento 网格卡（用户提供的 health metrics 参考风格）。
 * 结构：柔和彩底大圆角块 + 白圆 chip 图标 + 大数字(+小单位) + 图表槽 + 可选脚注。
 * 首页「消耗与恢复节律」tab 改版用：认知高块 / 情绪·运动小块 / 经期块（日期圈）。
 * ★ v18.52 修复：布局样式（width/height/flex）移到 Pressable 层——之前传到 Animated.View，
 *   flex:1 的父级 Pressable 无高度 → 卡体塌成一条（与 statusPill 同一类塌陷）。
 *   卡体 flexGrow:1 填满 Pressable 实际高度。
 * ★ 铁律遵守：颜色/尺寸全部走 theme/mm token，组件层零裸 hex。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { MindIcon, type MindIconName } from './MindIcons';

interface Props {
  /** 卡底色 —— ★ v18.62 全部白卡（用户：背景去掉，颜色留在图表和数据里），传 mm.colors.cardBg */
  bg: string;
  /** 白圆 chip 的底色（白卡上 chip 不能也是白色）——传对应 tone 的 mm.chipBg[tone].bg 软色 */
  chipBg?: string;
  /** 白圆 chip 里的图标 */
  icon: MindIconName;
  /** 图标色（传 mm.chipBg[tone].fg） */
  iconFg: string;
  title: string;
  value?: string;
  unit?: string;
  sub?: string;
  /** 大数字上方的小指标行（如「准备度 62/100」）——v18.53.2 认知卡用 */
  statTop?: string;
  /** 顶行右侧小标签（参考图 Activity 卡的「4 days streak」位） */
  aside?: string;
  /** 标题行下方的独立整行小字（如运动卡「8,432 步 · 6.1 km」）——窄卡里不能塞 topRow，会截断。
   *  ★ v18.88 放宽为 ReactNode：运动卡要按运动类别上色（嵌套 Text 同排混色），
   *    string 仍可直接传，不影响其它调用点。 */
  subLine?: string | React.ReactNode;
  /** 图表槽（MiniCognitiveBars / 日期圈行等），占卡中部 */
  chart?: React.ReactNode;
  foot?: string;
  footLines?: string[];
  /** 大数字放顶行右侧（参考图 Weight 卡）；默认放底部（Heart rate 卡） */
  numTop?: boolean;
  /** ★ v18.61 紧凑档（右列 130pt 小卡专用）：chip 36→28、大数字 30→26——
   *  否则 topRow 39 + 四排点阵 36 + 大数字 36 ≈ 111pt > 内高 98pt，数字必然压点阵 */
  compact?: boolean;
  /** 布局样式（width/height/flex）——作用于 Pressable，卡体 flexGrow 填满 */
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

function BentoCardImpl({
  bg, chipBg, icon, iconFg, title, value, unit, sub, statTop, aside, subLine, chart, foot, footLines, numTop, compact, style, onPress,
}: Props) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressTo = (v: number) =>
    Animated.timing(pressScale, { toValue: v, duration: theme.motion.instant, easing: theme.motion.easeStandard, useNativeDriver: true }).start();
  return (
    <Pressable
      style={[styles.wrap, style]}
      onPress={onPress}
      onPressIn={() => pressTo(theme.press.scaleCard)}
      onPressOut={() => pressTo(1)}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${value ?? ''}${unit ?? ''}`}
    >
      <Animated.View style={[styles.card, { backgroundColor: bg }, { transform: [{ scale: pressScale }] }]}>
        {/* 顶行：白圆图标 + 标题（+ aside 右标签 / 顶行大数字） */}
        <View style={styles.topRow}>
          <View style={[styles.chip, chipBg ? { backgroundColor: chipBg } : null, compact && styles.chipCompact]}>
            <MindIcon name={icon} size={compact ? theme.fs(14) : theme.fs(17)} color={iconFg} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.ttl, compact && styles.ttlCompact]} numberOfLines={1}>{title}</Text>
            {!!sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}
          </View>
          {!!aside && (
            <Text style={styles.aside} numberOfLines={1}>{aside}</Text>
          )}
          {numTop && value != null ? (
            <View style={styles.numRowTop}>
              <Text style={styles.num} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
              {!!unit && <Text style={styles.unit}>{unit}</Text>}
            </View>
          ) : null}
        </View>
        {/* 标题行下方独立整行小字（窄卡防截断） */}
        {!!subLine && (
          <Text style={styles.subLine} numberOfLines={1}>{subLine}</Text>
        )}
        {/* 图表槽 */}
        {chart}
        {/* 底部大数字（statTop 有值时：小指标行贴在大数字上方，整块压底） */}
        {!numTop && value != null && !!statTop ? (
          <View style={styles.numBlock}>
            <Text style={styles.statTop} numberOfLines={1}>{statTop}</Text>
            <View style={styles.numRowInner}>
              <Text style={styles.num} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
              {!!unit && <Text style={styles.unit}>{unit}</Text>}
            </View>
          </View>
        ) : !numTop && value != null ? (
          <View style={styles.numRowBottom}>
            <Text style={[styles.num, compact && styles.numCompact]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
            {!!unit && <Text style={styles.unit}>{unit}</Text>}
          </View>
        ) : null}
        {!!foot && (
          <View style={styles.foot}>
            <Text style={styles.footText} numberOfLines={1}>{foot}</Text>
          </View>
        )}
        {!!footLines?.length && (
          <View style={styles.foot}>
            {footLines.map((line, i) => (
              <Text key={i} style={styles.footLineText} numberOfLines={1}>{line}</Text>
            ))}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default React.memo(BentoCardImpl);

const styles = StyleSheet.create({
  wrap: { flexGrow: 0 },                    // ★ v18.53.4：flexGrow:1 会和显式 width 叠加吃掉兄弟空间（认知卡变横卡、情绪/运动压成细条）——卡体 card flexGrow:1 已保证纵向填满，Pressable 不再 grow
  card: {
    flexGrow: 1,                            // 填满 Pressable 实际高度（矮卡同高）
    borderRadius: theme.radius.xl,          // bento 大圆角 24
    padding: theme.sp(4),
    overflow: 'hidden',
    borderWidth: 1,                         // ★ v18.62 白卡细描边（与全 app 白卡规格一致，否则白卡融进页面底色）
    borderColor: mm.colors.cardBorder,
    shadowColor: mm.shadow.color,
    shadowOffset: { width: 0, height: theme.sp(mm.shadow.height) },
    shadowOpacity: mm.shadow.opacity * 0.6,
    shadowRadius: theme.sp(mm.shadow.radius),
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.sp(0.75),           // ★ v18.60：1.5→0.75（用户：icon 行往上收，给四排点阵+底部数字让位）
  },
  chip: {
    width: theme.fs(36),
    height: theme.fs(36),
    borderRadius: theme.radius.pill,        // 白圆 chip（参考图比例 ~36pt）
    backgroundColor: mm.colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  chipCompact: {
    width: theme.fs(28),
    height: theme.fs(28),
    marginRight: theme.sp(1.5),
  },
  ttlCompact: {
    fontSize: theme.fontSize.xs,
  },
  ttl: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  sub: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.2),
  },
  subLine: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.5),
  },
  aside: {
    marginLeft: 'auto',
    paddingLeft: theme.sp(2),
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  numRowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginLeft: 'auto',
    paddingLeft: theme.sp(2),
  },
  numRowBottom: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 'auto',                      // 数字压底（高块时图表居中）
    paddingTop: theme.sp(0.5),              // ★ v18.60：1→0.5（用户：数字再靠下）
  },
  // ★ v18.53.2：statTop + 大数字整块压底（认知卡：准备度行贴在「中度疲劳」上方）
  numBlock: {
    marginTop: 'auto',
    paddingTop: theme.sp(1),
  },
  statTop: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(0.4),
  },
  numRowInner: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  num: {
    fontSize: theme.fs(30),
    fontWeight: theme.weight.bold,
    color: mm.colors.ink,
    lineHeight: theme.fs(34),
    flexShrink: 1,
  },
  numCompact: {
    fontSize: theme.fs(26),
    lineHeight: theme.fs(30),
  },
  unit: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.inkSoft,
    marginLeft: theme.sp(0.5),
  },
  foot: {
    marginTop: theme.sp(2),
    paddingTop: theme.sp(1.75),
    borderTopWidth: 1,
    borderTopColor: 'rgba(31,29,26,0.08)',   // ★ v18.59：dashed 在 Fabric 报「Unsupported dashed/dotted border style」红条，改实线浅色
  },
  footText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  footLineText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginTop: theme.sp(0.75),
  },
});
