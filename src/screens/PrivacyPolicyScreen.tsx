import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from '../components/Icon';
import ScreenContainer from '../components/ScreenContainer';

const EFFECTIVE_DATE = '2026-10-25';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '一、我们收集什么',
    body:
      'Mira 通过你佩戴的智能戒指与每日自报，收集以下健康与生活方式数据：心率、心率变异性（HRV）、' +
      '血氧、皮肤温度、呼吸率、皮电反应（EDA）、睡眠时长与分期、身体活动，以及你在 App 内主动记录的' +
      '情绪、压力与生理周期。这些数据用于生成你的个人健康洞察与陪伴式建议。',
  },
  {
    title: '二、本地优先，云端可选',
    body:
      '你佩戴戒指积累的数据默认保存在本机设备，不会自动离开你的手机。只有当你在「设置 → 数据备份（云端）」' +
      '中主动点击「上传云端」时，每日汇总的匿名数据才会被发送到 Mira 的云存储（Cloudflare Workers + D1）。' +
      '本机数据始终完整保留，上传不会删除本地副本。',
  },
  {
    title: '三、我们不做的事',
    body:
      'Mira 不提供医疗诊断、不输出疾病判定、不对你做认知评分或"表现评价"。所有分析与建议均为描述性观察' +
      '与陪伴式引导，不能替代专业医疗意见。我们不会把你的个人健康数据出售给第三方，也不会用于广告投放。',
  },
  {
    title: '四、你的权利',
    body:
      '你可以随时：① 在「设置 → 数据备份（云端）」停止上传并请求删除云端数据；' +
      '② 删除本机数据（卸载 App 或清空存储）；③ 在 Mira AI 中要求删除某条"个人上下文"（你长期规律的记忆）。' +
      '我们尊重你对自身数据的完全主权。',
  },
  {
    title: '五、开源与第三方组件致谢',
    body:
      'Mira 的端侧 AI 陪伴能力建立在开源成果之上，我们在此致谢并声明归属：\n\n' +
      '• CBT-Copilot 模型：本 App 内置的端侧对话模型 CBT-Copilot.Q4_K_M.gguf 基于 Apache-2.0 许可发布。' +
      'Apache-2.0 许可原文见 http://www.apache.org/licenses/LICENSE-2.0 。本产品包含该模型，特此声明其版权与许可归属原作者，' +
      '并按 Apache-2.0 要求保留相应通知。\n\n' +
      '• 陪伴练习（认知重构 / 感恩练习 / 表达性写作 / 4-7-8 呼吸 / 身体扫描等）的方法学源自公开发表的干预研究，' +
      '包括 Beck (1976) 认知行为疗法、Seligman et al. (2005) 积极心理学干预、Pennebaker (1988, 2006) 表达性写作、' +
      'Emmons & McCullough (2003) 感恩日记、Weil (2015) 呼吸训练、Jacobsen (1924) 渐进式放松。' +
      '这些方法以"陪你做"的陪伴形式呈现，不构成医疗建议。',
  },
  {
    title: '六、联系我们',
    body: '关于隐私或数据处理的任何问题，可通过 Mira 官方渠道联系我们。本隐私政策最终解释权归 Mira 团队所有。',
  },
];

function PolicyHeader({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + theme.sp(2) }]}>
      <TouchableOpacity onPress={onBack} style={styles.back} accessibilityLabel="返回">
        <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
      </TouchableOpacity>
      <View style={styles.headText}>
        <Text style={styles.title}>隐私政策</Text>
        <Text style={styles.sub}>Mira 数据如何处理 · 开源致谢（含 Apache-2.0）</Text>
      </View>
    </View>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.root}>
      <PolicyHeader onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main' as never))} />
      <ScreenContainer>
        <Text style={styles.effective}>生效日期：{EFFECTIVE_DATE}</Text>
        {SECTIONS.map((s) => (
          <Section key={s.title} title={s.title} body={s.body} />
        ))}
        <View style={{ height: theme.space.xl }} />
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.textWhite },
  header: {
    paddingHorizontal: theme.space.screen,
    paddingBottom: theme.sp(2),
    backgroundColor: theme.colors.textWhite,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.cardBorder,
  },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { marginTop: theme.sp(1.5) },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginTop: 2 },
  effective: {
    fontSize: theme.fontSize.xs,
    color: mm.colors.inkFaint,
    marginBottom: theme.space.md,
    fontWeight: theme.weight.medium,
  },
  section: { marginBottom: theme.space.lg },
  sectionTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1.5),
  },
  sectionBody: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textBody,
  },
});
