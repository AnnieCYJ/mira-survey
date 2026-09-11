/**
 * CortisolDailyChart —— 身体恢复详情页「今日皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致：
 *   collectSamples → analyzeCortisol → TrendChart（30min 槽位 + cosinor 填补 + 睡眠阴影 + 14天基线对比）
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Card from './Card';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples, getSleepWindow, TrendChart } from './CortisolRhythmCard';

export default function CortisolDailyChart() {
  const navigation = useNavigation<any>();
  const samples = collectSamples();
  const sleepWindow = getSleepWindow();

  const goDetail = () => {
    navigation.navigate('MetricDetail', {
      key: 'cortisol',
      name: '皮质醇',
      unit: 'nmol/L',
      yMin: 0,
      yMax: 120,
      color: '#7C6AE0',
    });
  };

  if (samples.length < 4) {
    return (
      <Card>
        <Text style={styles.title}>今日皮质醇全天趋势</Text>
        <Text style={{ fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          暂无足够的皮质醇数据，连上戒指开启自动监测后即可查看
        </Text>
      </Card>
    );
  }

  const r = analyzeCortisol(samples, 14);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={goDetail}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <Text style={styles.title}>今日皮质醇全天趋势</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentSolid }}>详情 ›</Text>
        </View>
        <TrendChart r={r} sleepWindow={sleepWindow} />
      </Card>
    </TouchableOpacity>
  );
}

const styles = {
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
};
