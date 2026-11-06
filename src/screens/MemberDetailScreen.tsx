/**
 * MemberDetailScreen —— 绑定家人的健康结论（隐私优先）
 *
 * ★ 2026-10-19（用户需求）：绑定后点卡片看家人健康信息。
 *   只给"结论"：今日状态 / 恢复指数 / 睡眠 / 心情，绝不给逐点原始曲线；
 *   附"仅显示对方愿意分享的状态结论"说明。家人数据均为模拟。
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import { theme } from '../theme/theme';
import { familyStore, REL_LABEL, REL_EMOJI, familyToneColor, FAMILY_NO_DATA_LABEL } from '../data/familyStore';
import EmotionFaceIcon from '../components/EmotionFaceIcon';
import Icon from '../components/Icon';

export default function MemberDetailScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'MemberDetail'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'MemberDetail'>>();
  const id = route.params?.memberId;
  const m = id ? familyStore.getMember(id) : undefined;

  return (
    <View style={[s.root, { backgroundColor: theme.colors.bgBottom }]}>
      <StatusBar barStyle="light-content" />
      <View style={s.head}>
        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Icon name="back" size={22} color={theme.colors.textTitle} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={s.headTitle}>{m ? `${REL_LABEL[m.relationship]} · ${m.name}` : '家人'}</Text>
        <View style={{ width: theme.sp(9) }} />
      </View>

      {!m ? (
        <View style={s.empty}><Text style={s.emptyTxt}>未找到该成员</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: theme.space.screen, paddingTop: theme.sp(2) }}>
          {/* 顶部：头像 + 状态结论 */}
          <View style={s.topCard}>
            <View style={[s.avatar, { backgroundColor: m.avatarColor }]}>
              <Text style={s.avatarL}>{m.avatarLetter}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: theme.sp(2.5) }}>
              <Text style={s.name}>{m.name}</Text>
              <View style={[s.relChip, { backgroundColor: m.avatarColor }]}>
                <Text style={s.relChipTxt}>{REL_EMOJI[m.relationship]} {REL_LABEL[m.relationship]}</Text>
              </View>
            </View>
          </View>

          <View style={s.statusCard}>
            <EmotionFaceIcon mood={m.mood ?? 'calm'} color={m.avatarColor} size={40} />
            <Text style={[s.statusLabel, { color: familyToneColor(m.statusTone) ?? theme.colors.textSub }]}>
              TA今日 · {m.statusLabel ? `${m.statusLabel} ${m.statusEmoji ?? ''}`.trim() : FAMILY_NO_DATA_LABEL}
            </Text>
            <Text style={s.statusSub}>最近同步：{m.lastSyncLabel}</Text>
          </View>

          {/* 有限指标（只给结论数值，不给曲线） */}
          <View style={s.tiles}>
            <Tile label="恢复指数" value={m.recoveryScore != null ? `${m.recoveryScore}` : '—'} sub="/100" />
            <Tile label="睡眠" value={m.sleepHours != null ? `${m.sleepHours}` : '—'} sub="小时" />
            <Tile label="心情" value={m.mood ? moodLabel(m.mood) : '—'} sub={m.mood ?? ''} />
          </View>

          {m.menstrualPhase ? (
            <View style={s.phaseCard}>
              <Text style={s.phaseTxt}>生理周期 · {m.menstrualPhase}</Text>
            </View>
          ) : null}

          <View style={s.privacy}>
            <Text style={s.privacyTxt}>仅显示 {m.name} 愿意分享的状态结论。原始健康数据始终留在 TA 自己的设备上，Mira 不做跨设备的逐点同步。</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function moodLabel(m: string): string {
  const map: Record<string, string> = { excited: '兴奋', happy: '开心', calm: '平静', stressed: '压力', sad: '难过' };
  return map[m] ?? m;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <View style={s.tileValRow}>
        <Text style={s.tileVal}>{value}</Text>
        {sub ? <Text style={s.tileSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space.screen, paddingTop: theme.space.xl, paddingBottom: theme.sp(2) },
  back: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBg, alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: theme.colors.textSub, fontSize: theme.fontSize.body },
  topCard: { flexDirection: 'row', alignItems: 'center', padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  avatar: { width: theme.sp(11), height: theme.sp(11), borderRadius: theme.sp(5.5), alignItems: 'center', justifyContent: 'center' },
  avatarL: { color: '#fff', fontSize: theme.fontSize.h1, fontWeight: '700' },
  name: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  relChip: { alignSelf: 'flex-start', marginTop: theme.sp(1), paddingHorizontal: theme.sp(1.5), paddingVertical: 2, borderRadius: theme.radius.pill },
  relChipTxt: { color: '#fff', fontSize: theme.fontSize.micro, fontWeight: '600' },
  statusCard: { marginTop: theme.sp(2), padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder, alignItems: 'center' },
  statusLabel: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, marginTop: theme.sp(1.5) },
  statusSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  tiles: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(2) },
  tile: { flex: 1, padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder, alignItems: 'center' },
  tileLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  tileValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: theme.sp(1) },
  tileVal: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  tileSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 2 },
  phaseCard: { marginTop: theme.sp(2), padding: theme.space.cardPadCompact, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg },
  phaseTxt: { color: theme.colors.textBody, fontSize: theme.fontSize.sm, textAlign: 'center' },
  privacy: { marginTop: theme.sp(3) },
  privacyTxt: { color: theme.colors.textSub, fontSize: theme.fontSize.micro, lineHeight: 18 },
});
