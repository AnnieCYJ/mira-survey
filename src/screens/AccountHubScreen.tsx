/**
 * AccountHubScreen —— 账户 / 家庭中枢（"首页账户 → 详情"此前未做，本次补齐）
 *
 * ★ 2026-10-19（用户需求）：账户详情 + 绑定家人（爸爸/妈妈/老公/孩子…）。
 *   · 本人资料卡；
 *   · "我的家庭"：已绑定成员列表（关系 chip + TA今日状态），点击看 MemberDetail；
 *   · 待绑定成员 → "完成绑定"直接唤起绑定仪式；
 *   · "添加家人" → Sheet 选关系 + 填名 → 进入 BindingRitual 绑定仪式。
 *   · 隐私说明：家人只看状态结论，原始数据留在本人设备。
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, StatusBar } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import { theme } from '../theme/theme';
import { userStore } from '../data/userStore';
import {
  familyStore, useFamilyMembers, REL_LABEL, REL_EMOJI, familyToneColor, FAMILY_NO_DATA_LABEL,
  type Relationship,
} from '../data/familyStore';
import Sheet, { SheetHead } from '../components/Sheet';
import EmotionFaceIcon from '../components/EmotionFaceIcon';
import Icon from '../components/Icon';

const ADDABLE: Relationship[] = ['spouse', 'father', 'mother', 'child', 'sibling', 'other'];

export default function AccountHubScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'AccountHub'>>();
  const insets = useSafeAreaInsets();
  const members = useFamilyMembers();
  const me = members.find((m) => m.relationship === 'self')!;
  const bound = members.filter((m) => m.bound && m.relationship !== 'self');
  const pending = members.filter((m) => !m.bound);

  const [addOpen, setAddOpen] = useState(false);
  const [rel, setRel] = useState<Relationship>('spouse');
  const [name, setName] = useState('');

  const startAdd = () => {
    if (!name.trim()) return;
    /* ★ 2026-11-06（用户：「我点击了添加家人，然后之后直接添加就 OK 了，不要展示那个动画了，
       那动画太丑了。」）
       → 不再跳 BindingRitual 仪式页，直接写入家人并关闭 Sheet。 */
    familyStore.bindMember(rel, name.trim());
    setName('');
    setAddOpen(false);
  };
  const startPending = (m: typeof pending[number]) => {
    // 第二枚戒指激活：带上 memberId，让仪式只标记该成员为已绑定（不重复建人）
    navigation.navigate('BindingRitual', { relationship: m.relationship, name: m.name, memberId: m.id });
  };

  return (
    <View style={[s.root, { backgroundColor: theme.colors.bgBottom }]}>
      {/* ★ 2026-11-03：背景与设置页一致 = App 深海渐变（bgGradStops 顶→底） */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xl }}>
        {/* 头部 */}
        <View style={[s.head, { paddingTop: insets.top + theme.space.xl }]}>
          <Text style={s.headTitle}>账户</Text>
        </View>

        {/* 本人资料卡 */}
        <View style={s.profileCard}>
          <View style={[s.bigAvatar, { backgroundColor: me.avatarColor }]}>
            <Text style={s.bigAvatarL}>{me.avatarLetter}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{me.name}</Text>
            <Text style={s.profileSub}>Mira 会员 · 第 2 个月</Text>
          </View>
        </View>

        {/* 我的家庭 */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>我的家庭</Text>
          <Text style={s.sectionCount}>{bound.length} 位已连接</Text>
        </View>

        {bound.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={s.memberCard}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
          >
            <View style={[s.memberAvatar, { backgroundColor: m.avatarColor }]}>
              <Text style={s.memberAvatarL}>{m.avatarLetter}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.memberTop}>
                <Text style={s.memberName}>{m.name}</Text>
                <View style={[s.relChip, { backgroundColor: m.avatarColor }]}>
                  <Text style={s.relChipTxt}>{REL_EMOJI[m.relationship]} {REL_LABEL[m.relationship]}</Text>
                </View>
              </View>
              <View style={s.memberStatus}>
                <EmotionFaceIcon mood={m.mood ?? 'calm'} color={m.avatarColor} size={18} />
                <Text style={[s.memberStatusTxt, { color: familyToneColor(m.statusTone) ?? theme.colors.textSub }]}>
                  {m.statusLabel ? `${m.statusLabel} ${m.statusEmoji ?? ''}`.trim() : FAMILY_NO_DATA_LABEL}
                </Text>
                {m.lastSyncLabel ? <Text style={s.memberSync}>· {m.lastSyncLabel}</Text> : null}
              </View>
            </View>
            <Icon name="back" size={18} color={theme.colors.textSub} strokeWidth={2} style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>
        ))}

        {/* 待绑定（演示第二枚戒指激活） */}
        {pending.length > 0 ? (
          <View style={s.pendingWrap}>
            <Text style={s.pendingTitle}>待绑定</Text>
            {pending.map((m) => (
              <View key={m.id} style={s.pendingCard}>
                <Text style={s.pendingTxt}>第二枚戒指已激活：{m.name}（{REL_LABEL[m.relationship]}）</Text>
                <TouchableOpacity style={s.bindBtn} activeOpacity={0.85} onPress={() => startPending(m)}>
                  <Text style={s.bindBtnTxt}>完成绑定</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {/* 添加家人 */}
        <TouchableOpacity style={s.addBtn} activeOpacity={0.85} onPress={() => { setRel('spouse'); setName(''); setAddOpen(true); }}>
          <Text style={s.addBtnTxt}>＋ 添加家人</Text>
        </TouchableOpacity>

        {/* 退出登录 */}
        <TouchableOpacity style={s.logoutBtn} activeOpacity={0.85} onPress={() => { void userStore.signOut(); }}>
          <Text style={s.logoutTxt}>退出登录</Text>
        </TouchableOpacity>

        {/* 隐私说明 */}
        <View style={s.privacy}>
          <Text style={s.privacyTxt}>家人之间只共享「状态结论」（今天状态好不好），原始健康数据始终留在你自己的设备上。</Text>
        </View>
      </ScrollView>

      {/* 添加家人 Sheet */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <SheetHead title="添加家人" subtitle="选择关系，给 TA 起个名字" onBack={() => setAddOpen(false)} />
        <View style={s.sheetBody}>
          <View style={s.relRow}>
            {ADDABLE.map((r) => (
              <TouchableOpacity
                key={r}
                style={[s.relPick, rel === r && s.relPickOn]}
                onPress={() => setRel(r)}
                activeOpacity={0.8}
              >
                <Text style={[s.relPickTxt, rel === r && s.relPickTxtOn]}>{REL_EMOJI[r]} {REL_LABEL[r]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={s.nameInput}
            placeholder="TA 的名字 / 称呼"
            placeholderTextColor={theme.colors.textSub}
            value={name}
            onChangeText={setName}
          />
          <TouchableOpacity
            style={[s.confirmBtn, !name.trim() && s.confirmOff]}
            activeOpacity={0.85}
            onPress={startAdd}
            disabled={!name.trim()}
          >
            <Text style={s.confirmTxt}>添加</Text>
          </TouchableOpacity>
        </View>
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space.screen, paddingTop: theme.space.xl, paddingBottom: theme.space.sm },
  headTitle: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  gear: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBg, alignItems: 'center', justifyContent: 'center' },
  profileCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.space.screen, padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  bigAvatar: { width: theme.sp(11), height: theme.sp(11), borderRadius: theme.sp(5.5), alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2.5) },
  bigAvatarL: { color: '#fff', fontSize: theme.fontSize.h1, fontWeight: '700' },
  profileName: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  profileSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  ghostBtn: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.5), borderRadius: theme.radius.pill, backgroundColor: 'rgba(255,255,255,0.14)' },
  ghostTxt: { color: '#fff', fontSize: theme.fontSize.micro },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.space.screen, marginTop: theme.space.lg, marginBottom: theme.sp(2) },
  sectionTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  sectionCount: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  memberCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.space.screen, marginBottom: theme.sp(2), padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  memberAvatar: { width: theme.sp(8), height: theme.sp(8), borderRadius: theme.sp(4), alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2.5) },
  memberAvatarL: { color: '#fff', fontSize: theme.fontSize.card, fontWeight: '700' },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) },
  memberName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
  relChip: { paddingHorizontal: theme.sp(1.5), paddingVertical: 2, borderRadius: theme.radius.pill },
  relChipTxt: { color: '#fff', fontSize: theme.fontSize.micro, fontWeight: '600' },
  memberStatus: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1), marginTop: 4 },
  memberStatusTxt: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any },
  memberSync: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  pendingWrap: { marginHorizontal: theme.space.screen, marginTop: theme.sp(1) },
  pendingTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  pendingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.space.cardPad, borderRadius: theme.radius.card, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.cardBorder, marginBottom: theme.sp(2) },
  pendingTxt: { flex: 1, color: theme.colors.textBody, fontSize: theme.fontSize.micro, lineHeight: 18 },
  bindBtn: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.5), borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid },
  bindBtnTxt: { color: '#fff', fontSize: theme.fontSize.micro, fontWeight: '600' },
  addBtn: { marginHorizontal: theme.space.screen, marginTop: theme.sp(2), paddingVertical: theme.sp(2.5), borderRadius: theme.radius.card, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.cardBorder, alignItems: 'center' },
  addBtnTxt: { color: theme.colors.textTitle, fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any },
  privacy: { marginHorizontal: theme.space.screen, marginTop: theme.sp(3) },
  privacyTxt: { color: theme.colors.textSub, fontSize: theme.fontSize.micro, lineHeight: 18 },
  logoutBtn: {
    marginHorizontal: theme.space.screen,
    marginTop: theme.space.lg,
    height: 50,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  logoutTxt: { color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.medium as any },
  sheetBody: { paddingHorizontal: theme.space.screen, paddingTop: theme.space.md },
  relRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5) },
  relPick: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.5), borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  relPickOn: { backgroundColor: theme.colors.accentSolid, borderColor: theme.colors.accentSolid },
  relPickTxt: { color: theme.colors.textTitle, fontSize: theme.fontSize.sm },
  relPickTxtOn: { color: '#fff' },
  nameInput: { marginTop: theme.sp(3), paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(2.5), borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder, color: theme.colors.textTitle, fontSize: theme.fontSize.body },
  confirmBtn: { marginTop: theme.sp(3), paddingVertical: theme.sp(3), borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid, alignItems: 'center' },
  confirmOff: { backgroundColor: 'rgba(255,255,255,0.14)' },
  confirmTxt: { color: '#fff', fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any },
});
