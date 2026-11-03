/**
 * BindingRitualScreen —— 极致的"绑定仪式感"
 *
 * ★ 2026-10-19（用户需求）：当第二枚戒指（伴侣/父母）激活绑定时，两束光/两个光环由两侧
 *   缓缓靠近、交叠、最终融合；伴随手机轻微震动，弹出"从此，你的节律有了共鸣"，并生成一张
 *   专属"双人绑定纪念卡"，供用户发朋友圈。
 *   → 开启双人连接的第一秒就定下浪漫基调，而非冷冰冰的设备配对。
 *
 * 实现：Animated 双 halo（accent + 关系色）由 ±SEP 平移汇聚至中心 → 融合瞬间
 *   Vibration 轻微震动 + Confetti 庆祝 → 渲染融合 orb + 文案 + 纪念卡（Share.share 分享）。
 *   真实场景：此屏由"添加家人"确认后进入，参数带 relationship + name；完成后写 familyStore。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Vibration, Dimensions, Share, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import { theme } from '../theme/theme';
import { familyStore, REL_LABEL, REL_COLOR, type Relationship } from '../data/familyStore';
import Confetti from '../components/Confetti';

const { width } = Dimensions.get('window');
const SEP = width * 0.2;

type NavProp = StackNavigationProp<RootStackParamList, 'BindingRitual'>;
type RouteProp_ = RouteProp<RootStackParamList, 'BindingRitual'>;

interface Params { relationship?: Relationship; name?: string; memberId?: string }

function Halo({ color, style }: { color: string; style?: any }) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
      <View style={[styles.glow, { backgroundColor: color, opacity: 0.10, transform: [{ scale: 2.4 }] }]} />
      <View style={[styles.glow, { backgroundColor: color, opacity: 0.20, transform: [{ scale: 1.6 }] }]} />
      <View style={[styles.glow, { backgroundColor: color, opacity: 0.95 }]} />
    </View>
  );
}

export default function BindingRitualScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp_>();
  const params: Params = route.params ?? {};
  const relationship: Relationship = params.relationship ?? 'spouse';
  const name = params.name ?? '陈屿';

  const selfMember = familyStore.getMember('self');
  const ownerColor = selfMember?.avatarColor ?? '#9D8AF0';
  const ownerLetter = selfMember?.avatarLetter ?? 'K';
  const ownerName = selfMember?.name ?? 'Kristina';
  const inColor = REL_COLOR[relationship] ?? '#7EA6F8';

  const [phase, setPhase] = useState<'merging' | 'done'>('merging');
  const [confetti, setConfetti] = useState(false);

  const leftX = useRef(new Animated.Value(-SEP)).current;
  const rightX = useRef(new Animated.Value(SEP)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    StatusBar.setBarStyle('light-content', true);
    Animated.parallel([
      Animated.timing(leftX, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(rightX, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]).start(() => {
      setPhase('done');
      Vibration.vibrate([0, 30, 45, 30]);
      setConfetti(true);
      setTimeout(() => setConfetti(false), 3000);
    });
  }, [leftX, rightX]);

  useEffect(() => {
    if (phase !== 'done') return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [phase, pulse]);

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  const finish = () => {
    if (params.memberId) {
      // 第二枚戒指激活：标记已有的"待绑定"成员为已绑定
      familyStore.markBound(params.memberId);
    } else {
      // 全新添加：写入一位新家人并标记已绑定
      familyStore.bindMember(relationship, name);
    }
    navigation.goBack();
  };
  const share = () => {
    Share.share({
      title: 'Mira 双人绑定纪念',
      message: `从此，你的节律有了共鸣 💞\n我和${name}在 Mira 绑定了双人节律。`,
    });
  };

  return (
    <View style={[s.root, { backgroundColor: theme.colors.bgBottom }]}>
      <LinearGradient style={StyleSheet.absoluteFill} colors={['#0A294F', '#113861', '#1F4C7E']} locations={[0, 0.55, 1]} />
      <Confetti visible={confetti} count={90} duration={3000} />

      <TouchableOpacity style={s.close} onPress={() => navigation.goBack()} activeOpacity={0.7}>
        <Text style={s.closeX}>✕</Text>
      </TouchableOpacity>

      <View style={s.stage}>
        {phase === 'merging' ? (
          <>
            <Animated.View style={[styles.haloPos, { transform: [{ translateX: leftX }] }]}>
              <Halo color={ownerColor} />
            </Animated.View>
            <Animated.View style={[styles.haloPos, { transform: [{ translateX: rightX }] }]}>
              <Halo color={inColor} />
            </Animated.View>
            <Animated.Text style={[s.mergingText, { opacity: pulse }]}>正在建立连接…</Animated.Text>
          </>
        ) : (
          <Animated.View style={[styles.mergedOrb, { transform: [{ scale: pulse }] }]}>
            <View style={[styles.glow, { backgroundColor: inColor, opacity: 0.18, transform: [{ scale: 2.6 }] }]} />
            <View style={[styles.mergedCore, { backgroundColor: inColor }]}>
              <Text style={s.mergedInitial}>{name.slice(0, 1)}</Text>
            </View>
          </Animated.View>
        )}
      </View>

      {phase === 'done' ? (
        <View style={s.doneWrap}>
          <Text style={s.headline}>从此，你的节律有了共鸣</Text>
          <Text style={s.subline}>你和 {name}（{REL_LABEL[relationship]}）的生命节律，开始彼此照应。</Text>

          {/* 双人绑定纪念卡 */}
          <View style={s.card}>
            <Text style={s.cardTag}>双人绑定纪念 · Mira</Text>
            <View style={s.cardAvatars}>
              <View style={[s.cardAvatar, { backgroundColor: ownerColor, marginRight: -theme.sp(2) }]}>
                <Text style={s.cardAvatarL}>{ownerLetter}</Text>
              </View>
              <View style={[s.cardAvatar, { backgroundColor: inColor, borderWidth: 2, borderColor: theme.colors.bgBottom }]}>
                <Text style={s.cardAvatarL}>{name.slice(0, 1)}</Text>
              </View>
            </View>
            <Text style={s.cardNames}>{ownerName} & {name}</Text>
            <Text style={s.cardDate}>{today}</Text>
            <Text style={s.cardQuote}>你们的生命节律，从此开始共振。</Text>
          </View>

          <View style={s.btnRow}>
            <TouchableOpacity style={s.shareBtn} onPress={share} activeOpacity={0.85}>
              <Text style={s.shareTxt}>分享到朋友圈</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.doneBtn} onPress={finish} activeOpacity={0.85}>
              <Text style={s.doneTxt}>完成</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { width: 120, height: 120, borderRadius: 60 },
  haloPos: { position: 'absolute', top: '50%', left: '50%', marginLeft: -60, marginTop: -60 },
  mergedOrb: { alignItems: 'center', justifyContent: 'center' },
  mergedCore: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
});
// 注：s.* 在下方 StyleSheet.create 中定义（与 styles.* 分区，便于阅读）
const s = StyleSheet.create({
  root: { flex: 1 },
  close: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  closeX: { color: '#fff', fontSize: theme.fontSize.card },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mergingText: { position: 'absolute', bottom: '22%', color: 'rgba(255,255,255,0.85)', fontSize: theme.fontSize.body },
  mergedInitial: { color: '#fff', fontSize: theme.fontSize.hero, fontWeight: '700' },
  doneWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: theme.space.screen, paddingBottom: theme.space.xl, alignItems: 'center' },
  headline: { color: '#fff', fontSize: theme.fontSize.h1, fontWeight: theme.weight.semibold as any, textAlign: 'center' },
  subline: { color: 'rgba(255,255,255,0.78)', fontSize: theme.fontSize.body, textAlign: 'center', marginTop: theme.sp(1.5), lineHeight: 22 },
  card: { width: '100%', marginTop: theme.sp(4), padding: theme.space.cardPad, borderRadius: theme.radius.xl, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center' },
  cardTag: { color: theme.colors.accentText, fontSize: theme.fontSize.micro, letterSpacing: 1 },
  cardAvatars: { flexDirection: 'row', marginTop: theme.sp(2), marginBottom: theme.sp(1) },
  cardAvatar: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.sp(4.5), alignItems: 'center', justifyContent: 'center' },
  cardAvatarL: { color: '#fff', fontSize: theme.fontSize.h2, fontWeight: '700' },
  cardNames: { color: '#fff', fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any },
  cardDate: { color: 'rgba(255,255,255,0.7)', fontSize: theme.fontSize.micro, marginTop: theme.sp(0.5) },
  cardQuote: { color: 'rgba(255,255,255,0.85)', fontSize: theme.fontSize.sm, textAlign: 'center', marginTop: theme.sp(1.5), lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: theme.sp(2.5), marginTop: theme.sp(4), width: '100%' },
  shareBtn: { flex: 1, paddingVertical: theme.sp(2.5), borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid, alignItems: 'center' },
  shareTxt: { color: '#fff', fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any },
  doneBtn: { flex: 1, paddingVertical: theme.sp(2.5), borderRadius: theme.radius.pill, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center' },
  doneTxt: { color: '#fff', fontSize: theme.fontSize.card, fontWeight: theme.weight.medium as any },
});
