/**
 * EmotionLogCard —— 情绪记录卡片（Mooda 式入口卡）
 *
 * 位置：EmotionInsightView 内「情绪负荷」图表区之下（情绪消耗详情页 + 洞察页情绪 tab 共用）。
 * 内容：一排迷你情绪球（入口感）+ 今日最新自报记录（球 + 档位 + 备注 + 时刻）；
 *       未记录 → 引导文案。点击 → EmotionLogScreen（Matter.js 情绪珠雨选心情）。
 * 数据：data/emotionLog.ts（用户自报，与 EDA 推断的情绪负荷独立）。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import {
  MOOD_EMOJI, MOOD_LABEL, MOOD_COLOR,
  ensureEmotionLogLoaded, getLatestForDay, onEmotionLog,
} from '../data/emotionLog';
import { dayKey } from '../data/healthStore';

/** 入口装饰球：固定 5 个（亮→沉），预览「记录页里的珠子」长什么样 */
const PREVIEW_MOODS = ['excited', 'happy', 'calm', 'stressed', 'anxious'] as const;

function EmotionLogCardImpl() {
  const navigation = useNavigation<any>();
  const [entry, setEntry] = useState<ReturnType<typeof getLatestForDay>>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      ensureEmotionLogLoaded().then(() => {
        if (alive) setEntry(getLatestForDay(dayKey(Date.now())));
      });
    };
    refresh();
    return alive ? onEmotionLog(refresh) : undefined;
  }, []);

  const color = entry ? MOOD_COLOR[entry.mood] : mm.colors.inkFaint;
  const timeText = entry
    ? `${String(new Date(entry.t).getHours()).padStart(2, '0')}:${String(new Date(entry.t).getMinutes()).padStart(2, '0')}`
    : '';

  return (
    <Pressable
      onPress={() => navigation.navigate('EmotionLog')}
      android_ripple={{ color: mm.colors.cardBorder }}
      accessibilityRole="button"
      accessibilityLabel="情绪记录"
    >
      <View style={styles.inner}>
        {/* 标题行 */}
        <View style={styles.headRow}>
          <Text style={styles.title}>情绪记录</Text>
          <View style={[styles.plusChip, { backgroundColor: color + '22' }]}>
            <Text style={{ fontSize: theme.fs(14), lineHeight: theme.fs(16), color }}>+</Text>
          </View>
        </View>

        {/* 迷你情绪球排（入口感：进页后这些珠子会从顶部落下堆积） */}
        <View style={styles.ballRow}>
          {PREVIEW_MOODS.map((k) => (
            <View key={k} style={[styles.miniBall, { backgroundColor: MOOD_COLOR[k] + '3D', borderColor: MOOD_COLOR[k] }]}>
              <Text style={styles.miniEmoji}>{MOOD_EMOJI[k]}</Text>
            </View>
          ))}
        </View>

        {/* 今日最新记录（无 → 引导） */}
        {entry ? (
          <View style={styles.row}>
            <View style={[styles.ball, { backgroundColor: color + '2E' }]}>
              <Text style={styles.ballEmoji}>{MOOD_EMOJI[entry.mood]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
                <Text style={styles.moodLabel}>{MOOD_LABEL[entry.mood]}</Text>
                <Text style={styles.time}>{timeText} 记录</Text>
              </View>
              <Text style={styles.note} numberOfLines={1}>
                {entry.note ?? '点此补充一句此刻的感受'}
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </View>
        ) : (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.moodLabel}>今天还没记录</Text>
              <Text style={styles.note}>点进去接住一颗此刻的心情</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default React.memo(EmotionLogCardImpl);

const styles = StyleSheet.create({
  inner: {
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBg,
    padding: theme.sp(3),
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  title: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: theme.colors.textTitle },
  plusChip: {
    width: theme.sp(5.5),
    height: theme.sp(5.5),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballRow: { flexDirection: 'row', gap: theme.sp(2), marginBottom: theme.sp(2.5) },
  miniBall: {
    width: theme.sp(8),
    height: theme.sp(8),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniEmoji: { fontSize: theme.fs(13) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5) },
  ball: {
    width: theme.sp(11),
    height: theme.sp(11),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballEmoji: { fontSize: theme.fs(20) },
  moodLabel: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: theme.colors.textTitle },
  time: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(0.3) },
  chev: { fontSize: theme.fs(20), color: theme.colors.textSub, fontWeight: theme.weight.regular as never },
});
