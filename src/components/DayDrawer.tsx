/**
 * DayDrawer —— 月历点开某一天的「下抽屉」（底部弹层）
 *
 * 用途（用户 2026-10-12）：「我想点击每一个日期，可以从下抽屉那种，然后弹出一个
 *   就是原先日的那种，中间是曲线，两边是那个活动卡片的那个页面。」
 *   → 内容 = 原先 Calendar「日」tab 的旅程视图 `JourneyDayView`
 *     （中央渐变蛇形曲线 + 左右交替的活动卡片 + 顶部日期条）。
 *
 * 交互与 App 既有底部弹层一致（对齐 CortisolAnomalySheet / DateAnchorPicker 的日历弹层）：
 *   · Modal transparent + animationType="slide"
 *   · 点遮罩关闭；顶部一个 handle 小横条
 *   · 抽屉高度上限约屏幕 82%，内部纵向滚动
 *
 * 口径：只做「展示这一天的真实记录」，不做任何判定 / 评分（品牌铁律）。
 */
import React from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import JourneyDayView from './JourneyDayView';

const SCREEN_H = Dimensions.get('window').height;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

interface Props {
  /** 要点开的那一天；传 null 表示关闭 */
  date: Date | null;
  onClose: () => void;
}

export default function DayDrawer({ date, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const visible = !!date;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mask}>
        {/* 点遮罩关闭 */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, theme.space.lg) }]}>
          <View style={styles.handle} />

          {date ? (
            <>
              <View style={styles.head}>
                <Text style={styles.headTitle}>{`${date.getMonth() + 1}月${date.getDate()}日`}</Text>
                <Text style={styles.headSub}>{`周${WEEK[date.getDay()]}`}</Text>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.body}
                nestedScrollEnabled
              >
                {/* 原先「日」页的旅程视图：中间曲线 + 两侧活动卡片 */}
                <JourneyDayView date={date} />
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
  sheet: {
    maxHeight: SCREEN_H * 0.82,
    backgroundColor: theme.colors.cardBgStrong,
    borderTopLeftRadius: mm.radius.card,
    borderTopRightRadius: mm.radius.card,
    paddingTop: theme.space.sm,
    paddingHorizontal: theme.space.screen,
    shadowColor: mm.shadow.color,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: theme.sp(9),
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(31,29,26,0.14)',
    marginBottom: theme.space.md,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(2) },
  headTitle: {
    fontSize: theme.fs(20),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    letterSpacing: -0.3,
  },
  headSub: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft },
  body: { paddingBottom: theme.space.lg },
});
