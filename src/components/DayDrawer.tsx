/**
 * DayDrawer —— 月历点开某一天的「下抽屉」（全屏弹层）
 *
 * 用途（用户 2026-10-12）：「我想点击每一个日期，可以从下抽屉那种，然后弹出一个
 *   就是原先日的那种，中间是曲线，两边是那个活动卡片的那个页面。」
 *   → 内容 = 原先 Calendar「日」tab 的旅程视图 `JourneyDayView`
 *     （中央渐变蛇形曲线 + 左右交替的活动卡片 + 顶部日期条）。
 *
 * 视觉（2026-10-27 修订）：
 *   · 全屏展示（不再只是 82% 高的底部小抽屉），背景复用 App 首页同款深海渐变
 *     （theme.colors.bgGradStops / bgGradLocs），与页面无缝衔接、不突兀变黑。
 *   · 顶部「✕」关闭按钮（全屏后无遮罩可点，必须有显式关闭入口）。
 *   · 内层 JourneyDayView 沿用白色文字 + 半透明白卡，在渐变底上清晰可读。
 *
 * 口径：只做「展示这一天的真实记录」，不做任何判定 / 评分（品牌铁律）。
 */
import React from 'react';
import {
  Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import JourneyDayView from './JourneyDayView';
import { sleepRecoveryScoreForDay } from '../lib/sleepPersonalized';
import { dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** ★ 2026-11-05（用户）：当日「达标 / 状态不错 / 有活动」→ 右上角显示奖励 icon（⭐）。
 *   判定：睡眠恢复分 ≥ 60（个人相对口径，恢复良好）或当天有步数（活跃日）。 */
function dayRewarded(date: Date): boolean {
  try {
    const rec = sleepRecoveryScoreForDay(date.getTime());
    const dk = dayKey(date.getTime());
    const steps = (RingBle.getState()?.stepDaily as any)?.[dk]?.steps ?? 0;
    return (rec != null && rec >= 60) || steps > 0;
  } catch {
    return false;
  }
}

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
        <LinearGradient
          colors={[...theme.colors.bgGradStops] as unknown as string[]}
          locations={[...theme.colors.bgGradLocs] as unknown as number[]}
          style={[
            styles.sheet,
            {
              paddingTop: insets.top + theme.space.md,
              paddingBottom: Math.max(insets.bottom, theme.space.lg),
            },
          ]}
        >
          {date ? (
            <>
              <View style={styles.head}>
                <View style={styles.headLeft}>
                  <Text style={styles.headTitle}>{`${date.getMonth() + 1}月${date.getDate()}日`}</Text>
                  <Text style={styles.headSub}>{`周${WEEK[date.getDay()]}`}</Text>
                </View>
                <View style={styles.headRight}>
                  {dayRewarded(date) ? (
                    <View style={styles.rewardBadge}>
                      <Text style={styles.rewardTxt}>★</Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={onClose}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                  >
                    <Text style={styles.headClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.body}
                nestedScrollEnabled
              >
                {/* 原先「日」页的旅程视图：中间曲线 + 两侧活动卡片 */}
                <JourneyDayView date={date} showDatePicker={false} />
              </ScrollView>
            </>
          ) : null}
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 全屏：去掉底部小抽屉的 flex-end / 遮罩，整屏即弹层
  mask: { flex: 1 },
  sheet: {
    flex: 1,
    paddingHorizontal: theme.space.screen,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLeft: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(2) },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  headTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
    letterSpacing: -0.3,
  },
  headSub: { fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.6)' },
  headClose: { fontSize: theme.fontSize.h2, color: 'rgba(255,255,255,0.8)', paddingHorizontal: theme.sp(1) },
  rewardBadge: {
    width: theme.fs(26), height: theme.fs(26),
    borderRadius: theme.fontSize.xs,
    backgroundColor: 'rgba(245,196,110,0.18)',
    borderWidth: 1, borderColor: 'rgba(245,196,110,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  rewardTxt: { fontSize: theme.fontSize.body, color: '#F0C46E', fontWeight: theme.weight.bold as never },
  body: { paddingBottom: theme.space.lg },
});
