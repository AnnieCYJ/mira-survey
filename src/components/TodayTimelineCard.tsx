import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import Icon from './Icon';

/**
 * 今日时间轴卡（参考「APP 时间轴 UI」：左侧时间胶囊 + 彩色竖轨 + 右侧事项）
 * 数据由调用方组装（睡眠/相位/情绪峰值/脑力高峰/活动/AI 洞察），本组件纯展示。
 */
export interface TimelineItem {
  /** 时间胶囊文字，如 "07:20" / "全天" / "现在" */
  time: string;
  /** 该段轨道/圆点/胶囊主色（必须传 theme token） */
  color: string;
  title: string;
  sub?: string;
}

interface Props {
  title: string;
  dateLabel?: string;
  items: TimelineItem[];
}

export default function TodayTimelineCard({ title, dateLabel, items }: Props) {
  return (
    <Card style={{ paddingVertical: theme.sp(3.5) }}>
      {/* 头部：大标题 + 日期（参考稿 Your journey / Today）+ 右上箭头 */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {dateLabel ? <Text style={styles.dateLabel}>{dateLabel}</Text> : null}
        </View>
        <Icon name="chevronRight" size={18} color={theme.colors.textSub} />
      </View>

      {/* 时间轴主体 */}
      <View style={styles.list}>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <View key={`${it.time}-${i}`} style={styles.row}>
              {/* 左：时间胶囊 */}
              <View style={[styles.timePill, { backgroundColor: `${it.color}1F` }]}>
                <Text style={[styles.timeText, { color: it.color }]} numberOfLines={1}>
                  {it.time}
                </Text>
              </View>
              {/* 中：圆点 + 彩色竖轨 */}
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: it.color }]} />
                {!last && <View style={[styles.line, { backgroundColor: `${it.color}55` }]} />}
              </View>
              {/* 右：事项 */}
              <View style={[styles.body, !last && { paddingBottom: theme.sp(3) }]}>
                <Text style={styles.itemTitle} numberOfLines={1}>{it.title}</Text>
                {it.sub ? <Text style={styles.itemSub} numberOfLines={2}>{it.sub}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(3),
    paddingHorizontal: theme.space.cardPad,
  },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  dateLabel: {
    fontSize: theme.fontSize.body,
    color: theme.colors.accentSolid,
    marginTop: theme.space.xs,
    fontWeight: theme.weight.medium,
  },
  list: {
    paddingHorizontal: theme.space.cardPad,
  },
  row: {
    flexDirection: 'row',
  },
  timePill: {
    width: 64,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp(1),
    paddingHorizontal: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginTop: theme.sp(0.5),
  },
  timeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
  },
  rail: {
    width: 16,
    alignItems: 'center',
    marginHorizontal: theme.sp(2),
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginTop: theme.sp(1),
  },
  line: {
    width: 3,
    flex: 1,
    borderRadius: 1.5,
    marginTop: theme.sp(1),
    marginBottom: -theme.sp(1),
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.5),
  },
  itemSub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.sm * 1.45,
  },
});
