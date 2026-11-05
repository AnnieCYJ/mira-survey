import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import GlassCard from './GlassCard';
import Icon from './Icon';

/**
 * 今日日历卡 —— 与首页其他卡一致的「拟态玻璃」外观（GlassCard）。
 * 左侧彩色竖轨 + 时间胶囊 + 右侧事项；数据由调用方组装（真实生理数据 + AI 对话记录）。
 * 全部尺寸/间距/字号均取自 theme token，不写裸值。
 */
export interface TimelineItem {
  /** 时间胶囊文字，如 "07:20" / "全天" / "现在" */
  time: string;
  /** 该段轨道/圆点/胶囊主色（必须传 theme token） */
  color: string;
  title: string;
  sub?: string;
  /** ★ 2026-10-10（日历页「日」Tab 曲线旅程 JourneyDayView）：条目图标 emoji，由 push 站点按语义给 */
  emoji?: string;
  /** ★ 本轮（用户 #245）：该条是否达到当日目标，达标则在卡片右上角画一颗星 */
  goalMet?: boolean;
  /** ★ 本轮（用户 #248）：卡片底部补一句分析 / 解读（可选，缺省不渲染） */
  analysis?: string;
  /** ★ 本轮（用户：回顾页展示完成的饮食/心情）：卡片内附图（如饮食照片，可选） */
  imageUri?: string;
}

interface Props {
  title: string;
  dateLabel?: string;
  items: TimelineItem[];
}

export default function TodayTimelineCard({ title, dateLabel, items }: Props) {
  return (
    <GlassCard style={{ paddingVertical: theme.sp(3.5) }}>
      {/* 头部：大标题 + 日期（参考稿 Your journey / Today）+ 右上箭头 */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {dateLabel ? <Text style={styles.dateLabel}>{dateLabel}</Text> : null}
        </View>
        <Icon name="chevronRight" size={18} color={theme.colors.textSub} />
      </View>

      {/* 时间轴主体：竖轨靠左，时间胶囊居中，事项居右 */}
      <View style={styles.list}>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <View key={`${it.time}-${i}`} style={styles.row}>
              {/* 左：圆点 + 彩色竖轨（时间轴靠左） */}
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: it.color }]} />
                {!last && <View style={[styles.line, { backgroundColor: `${it.color}55` }]} />}
              </View>
              {/* 中：时间胶囊 —— 底色保留状态色相，文字用深色（同色系文字压同色底必然低对比，实测仅 1.62~3.40） */}
              <View style={[styles.timePill, { backgroundColor: `${it.color}1F` }]}>
                <Text style={styles.timeText} numberOfLines={1}>
                  {it.time}
                </Text>
              </View>
              {/* 右：事项 */}
              <View style={[styles.body, !last && { paddingBottom: theme.sp(3) }]}>
                <View style={styles.itemHead}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{it.title}</Text>
                  {it.goalMet ? <Text style={styles.itemStar}>★</Text> : null}
                </View>
                {it.sub ? <Text style={styles.itemSub} numberOfLines={2}>{it.sub}</Text> : null}
                {it.analysis ? <Text style={styles.itemAnalysis} numberOfLines={2}>{it.analysis}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  dateLabel: {
    fontSize: theme.fontSize.sm,
    /** accentSolid 作小字在玻璃卡上仅 3.06~3.91 → 用专门的 accentText（4.55~6.27） */
    color: theme.colors.accentText,
    marginTop: theme.space.xs,
    fontWeight: theme.weight.medium,
  },
  list: {
    // 不再叠加 paddingHorizontal：Card 已提供 cardPad 水平内边距，避免内容过度右移
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rail: {
    width: theme.sp(4),
    alignItems: 'center',
    marginRight: theme.space.sm,
  },
  dot: {
    width: theme.sp(2.25),
    height: theme.sp(2.25),
    borderRadius: theme.radius.pill,
    marginTop: theme.sp(1),
  },
  line: {
    width: theme.sp(0.75),
    flex: 1,
    borderRadius: theme.radius.pill,
    marginTop: theme.sp(1),
    marginBottom: -theme.sp(1),
  },
  timePill: {
    width: theme.sp(16),
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp(1),
    paddingHorizontal: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginTop: theme.sp(0.25),
  },
  timeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    /** 深色文字（而不是状态色本身）：chipText 在各状态色 12% 底上实测 4.58~6.15，全部达标 */
    color: theme.colors.ui.chipText,
  },
  body: {
    flex: 1,
    minWidth: 0,
    marginLeft: theme.space.sm,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  itemTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    flex: 1,
  },
  itemStar: { fontSize: theme.fs(12), color: theme.colors.success, fontWeight: theme.weight.bold as any },
  itemSub: {
    fontSize: theme.fontSize.sm,
    /** 玻璃底上用 chipText（比 textSub 深），保证浅色卡片上的小字对比度 */
    color: theme.colors.ui.chipText,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.sm * 1.45,
  },
  /** ★ 本轮（用户 #248）：事项底部补一句分析，比 itemSub 弱一档 */
  itemAnalysis: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.success,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.xs * 1.45,
  },
});
