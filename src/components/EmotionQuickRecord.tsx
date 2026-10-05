/**
 * EmotionQuickRecord —— 情绪洞察页「记录情绪」悬浮按钮 + 弹出卡片
 * （参考视频：单只会动的情绪小家伙居中 + 可变换表情；卡片下接带图标的事件选择）
 *
 * 行为：
 *  - 底部悬浮一个**明显的**渐变胶囊按钮「记录此刻心情」（带小号会动 MoodBlob + 加号），
 *    仅在「情绪」子 tab 出现（由 InsightScreen 控制挂载）。
 *  - 点按钮弹出底部卡片（Modal 抽屉）：
 *      · 顶部居中一只大号 MoodBlob，随所选心情实时变形/变色/换表情（参照视频的「表情居中型」）；
 *      · 下方 5 档心情选择（兴奋→开心→平静→压力→难过），点选即切换 blob；
 *      · 再下方带图标的生活事件多选（工作/运动/饮食/睡眠/社交/学习/放松/健康/家人/出行）；
 *      · 「记录此刻」接 addEmotionEntry（与日历/记录卡同一套自报存储，含 events），写后短暂显示「已记录 ✓」并自动收起。
 *
 * 挂在 InsightScreen：作为 ScreenContainer 的兄弟节点绝对定位钉在屏幕底部。
 * 仅情绪子 tab 出现；认知/其他 tab 不动。
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing, Dimensions, PanResponder, TextInput,
  Keyboard, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from './Icon';
import MoodBlob from './MoodBlob';
import Icon from './Icon';
import {
  MOOD_ORDER, MOOD_LABEL, MOOD_COLOR, addEmotionEntry,
  EVENT_KEYS, EVENT_LABEL, type MoodKey, type EventKey,
} from '../data/emotionLog';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

/** 5 档愉悦度（与 MOOD_ORDER 一致：兴奋→开心→平静→压力→难过） */
const MOODS: MoodKey[] = MOOD_ORDER;

/** 事件 → 图标映射（图标定义见 components/Icon） */
const EVENT_ICON: Record<EventKey, IconName> = {
  work: 'briefcase',
  sport: 'run',
  eat: 'food',
  sleep: 'moon',
  social: 'people',
  study: 'learn',
  relax: 'breath',
  health: 'heart',
  family: 'home',
  travel: 'plane',
};

/** 补记时间偏移档（分钟）：负向偏移 = 往回找。覆盖「刚才 / 1h / 3h / 昨天此刻」四种真实场景 */
const TIME_OFFSETS: { min: number; label: string }[] = [
  { min: 30, label: '半小时前' },
  { min: 60, label: '1 小时前' },
  { min: 180, label: '3 小时前' },
  { min: 1440, label: '昨天此刻' },
];

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = Math.min(SCREEN_H * 0.8, 540);

export default function EmotionQuickRecord() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(2); // 默认 平静
  const [events, setEvents] = useState<EventKey[]>([]);
  const [saved, setSaved] = useState(false);
  // 自建事件（「添加」自由输入）：pool 跨次打开保留，sel 每次打开重置
  const [customText, setCustomText] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [customPool, setCustomPool] = useState<string[]>([]);
  const [customSel, setCustomSel] = useState<string[]>([]);
  // ★ 记录时刻：默认此刻，可改为「今天任意时刻」或「昨天同一时刻」（回想补记）
  const [atOffsetMin, setAtOffsetMin] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 抽屉位移：offY（完全在屏幕下方）→ 0（停靠底部）
  const offY = useRef(new Animated.Value(SHEET_H)).current;
  const scrimOp = useRef(new Animated.Value(0)).current;

  const mood = MOODS[index];

  // 打开时重置选择 + 播放进入动画
  const open = () => {
    setIndex(2);
    indexRef.current = 2;
    pos.setValue(0.5);
    setEvents([]);
    setCustomSel([]);
    setCustomText('');
    setShowAdd(false);
    setSaved(false);
    setAtOffsetMin(null);   // 每次打开默认「此刻」
    setVisible(true);
    offY.setValue(SHEET_H);
    scrimOp.setValue(0);
    Animated.parallel([
      Animated.timing(offY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrimOp, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  };

  const close = () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    Animated.parallel([
      Animated.timing(offY, { toValue: SHEET_H, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrimOp, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => setVisible(false));
  };

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const toggleEvent = (ev: EventKey) => {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  };

  // ── 自建事件：「添加」自由输入 ──
  const confirmCustom = () => {
    const t = customText.trim();
    if (!t) return;
    setCustomPool((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setCustomSel((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setCustomText('');
    setShowAdd(false);
  };
  const toggleCustom = (t: string) => {
    setCustomSel((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  // ── 情绪滑条（复刻参考视频）：一颗半透明软胶囊光标贴轨滑动，全程只动一个原生动画值 ──
  // 拖动路径零 React 状态更新：index 只在跨过档位阈值时由 pos 监听器触发一次 setState。
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0); // ★ ref 持有宽度，避免 PanResponder 闭包捕获首帧 0 导致卡死
  const THUMB_W = theme.sp(9);  // 软胶囊光标宽度（比档位间距大，滑过时"吞过"小点，参考视频同款）
  const pos = useRef(new Animated.Value(0.5)).current; // 0..1 归一化位置（唯一动效真源）
  const pop = useRef(new Animated.Value(1)).current;    // 切档时表情轻微弹一下
  const indexRef = useRef(index);
  indexRef.current = index;
  const liveRatioRef = useRef(0.5); // 实时归一化位置（松手吸附用，避免依赖四舍五入后的 index 造成错位）

  // 拖动中只 setValue（原生驱动）；跨档时才 setIndex → 最大程度消灭重渲闪烁
  const setFromX = (x: number) => {
    const w = trackWRef.current;
    if (w <= 0) return;
    pos.stopAnimation(); // 拖动时打断吸附动画，避免跳动
    pos.setValue(Math.min(1, Math.max(0, x / w)));
  };
  // 点按（无拖拽）时让光标平滑滑到目标位置，而不是瞬移
  const glideTo = (x: number) => {
    const w = trackWRef.current;
    if (w <= 0) return;
    Animated.spring(pos, {
      toValue: Math.min(1, Math.max(0, x / w)),
      tension: 120, friction: 14, useNativeDriver: true,
    }).start();
  };
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => glideTo(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        // 松手吸附到最近档（弹簧，丝滑收尾）
        const nearest = Math.round(liveRatioRef.current * (MOODS.length - 1)) / (MOODS.length - 1);
        Animated.spring(pos, {
          toValue: nearest,
          tension: 120, friction: 14, useNativeDriver: true,
        }).start();
      },
    }),
  ).current;
  // pos 监听：仅在最近档位变化时更新 React 状态（blob/文字重渲，每划一次最多 4 次）
  useEffect(() => {
    const id = pos.addListener(({ value }) => {
      liveRatioRef.current = value;
      const next = Math.round(value * (MOODS.length - 1));
      if (next !== indexRef.current) {
        indexRef.current = next;
        setIndex(next);
      }
    });
    return () => pos.removeListener(id);
  }, [pos]);
  // 切档时表情轻轻弹一下
  useEffect(() => {
    pop.setValue(1);
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.14, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [index, pop]);

  /** 实际写入的时刻：atOffsetMin=null → 此刻；否则 = 此刻 - atOffsetMin 分钟 */
  const recordAtMs = (): number => (atOffsetMin == null ? Date.now() : Date.now() - atOffsetMin * 60000);
  const atHHMM = (() => {
    const d = new Date(recordAtMs());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();
  const isBackfill = atOffsetMin != null && atOffsetMin > 0;

  const onRecord = () => {
    if (saved) return;
    addEmotionEntry(mood, undefined, events, customSel.length > 0 ? customSel : undefined, recordAtMs());
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => close(), 1300);
  };

  return (
    <>
      {/* ── 悬浮按钮（明显、渐变胶囊 + 会动小团） ── */}
      <View style={[styles.fab, { bottom: insets.bottom + theme.sp(8) }]}>
        <TouchableOpacity activeOpacity={0.92} onPress={open} style={styles.fabTouch}>
          <LinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabGrad}
          >
            <MoodBlob mood={mood} size={theme.sp(11)} variant={1} />
            <Text style={styles.fabText}>记录此刻心情</Text>
            <Icon name="plus" size={theme.fs(16)} color={theme.colors.textWhite} style={styles.fabPlus} />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── 弹出卡片（Modal 底部抽屉） ── */}
      <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
        <View style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.ui.scrim, opacity: scrimOp }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { Keyboard.dismiss(); close(); }} />
          </Animated.View>

          <KeyboardAvoidingView
            style={styles.sheetKav}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY: offY }] }]}>
            <View style={styles.handle} />

            {/* 头部 */}
            <View style={styles.head}>
              <Text style={styles.headTitle}>记录此刻心情</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={theme.fs(20)} color={mm.colors.inkSoft} />
              </TouchableOpacity>
            </View>

            {/* 可滚动主体（点空白处收起键盘） */}
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* 居中大号会动小团 + 当前心情文字（切档时轻微弹一下） */}
              <View style={styles.blobBlock}>
                <Animated.View style={{ transform: [{ scale: pop }] }}>
                  <MoodBlob mood={mood} size={theme.sp(26)} variant={0} />
                </Animated.View>
                <Text style={styles.blobMood}>{MOOD_LABEL[mood]}</Text>
              </View>

              {/* 情绪滑条（复刻参考视频）：细轨 + 小点 + 半透明软胶囊光标，无彩色填充条 */}
              <View style={styles.sliderBlock}>
                <View
                  style={styles.trackWrap}
                  onLayout={(e) => { trackWRef.current = e.nativeEvent.layout.width; setTrackW(e.nativeEvent.layout.width); }}
                  {...panResponder.panHandlers}
                >
                  <View style={styles.track} />
                  {/* 5 个档位小点（参考视频：细轨上淡淡的档位点） */}
                  {MOODS.map((m, i) => (
                    <View
                      key={m}
                      style={[styles.tick, { left: `${(i / (MOODS.length - 1)) * 100}%`, backgroundColor: MOOD_COLOR[m] }]}
                    />
                  ))}
                  {/* 软胶囊光标（半透明白，原生 transform 连续跟手，滑过时「吞过」小点） */}
                  <Animated.View
                    style={[
                      styles.thumb,
                      {
                        transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(1, trackW - THUMB_W)] }) }],
                      },
                    ]}
                  />
                </View>
              </View>

              {/* ★ 记录时刻：默认此刻，可回填「更早 / 1小时前 / 3小时前 / 昨天此刻」 */}
              <Text style={styles.evTitle}>记录时刻</Text>
              <View style={styles.timeRow}>
                <Text style={[styles.timeChip, !isBackfill && styles.timeChipOn]} onPress={() => setAtOffsetMin(null)}>此刻</Text>
                {TIME_OFFSETS.map((o) => {
                  const sel = atOffsetMin === o.min;
                  return (
                    <Text
                      key={o.min}
                      style={[styles.timeChip, sel && styles.timeChipOn]}
                      onPress={() => setAtOffsetMin(o.min)}
                    >{o.label}</Text>
                  );
                })}
              </View>
              <Text style={styles.timeHint}>
                将记录到 <Text style={styles.timeHintStrong}>{atHHMM}</Text>
                {atOffsetMin != null && atOffsetMin >= 1440 ? '（昨天）' : ''}
                {' · '}可在下方全天点阵里对照查看
              </Text>

              {/* 带图标的生活事件多选（＋添加 放在出行旁边） */}
              <Text style={styles.evTitle}>发生了什么？（可选）</Text>
              <View style={styles.evGrid}>
                {EVENT_KEYS.map((ev) => {
                  const sel = events.includes(ev);
                  return (
                    <TouchableOpacity
                      key={ev}
                      activeOpacity={0.85}
                      onPress={() => toggleEvent(ev)}
                      style={[styles.evChip, sel && styles.evChipOn]}
                    >
                      <Icon
                        name={EVENT_ICON[ev]}
                        size={theme.fs(15)}
                        color={sel ? mm.colors.purpleDeep : mm.colors.inkSoft}
                      />
                      <Text style={[styles.evLabel, sel && styles.evLabelOn]}>{EVENT_LABEL[ev]}</Text>
                    </TouchableOpacity>
                  );
                })}
                {/* ＋添加：点开输入自己的事件 */}
                <TouchableOpacity activeOpacity={0.8} onPress={() => setShowAdd((v) => !v)} style={[styles.evChip, styles.addChip]}>
                  <Icon name="plus" size={theme.fs(14)} color={mm.colors.purpleDeep} />
                  <Text style={styles.addChipText}>添加</Text>
                </TouchableOpacity>
              </View>

              {/* 「添加」：弹出自有事件输入框 */}
              {showAdd && (
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.addInput}
                    value={customText}
                    onChangeText={setCustomText}
                    placeholder="输入你的事件"
                    placeholderTextColor={mm.colors.inkSoft}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmCustom}
                    maxLength={20}
                  />
                  <TouchableOpacity activeOpacity={0.85} onPress={confirmCustom} style={styles.addConfirm}>
                    <Text style={styles.addConfirmText}>添加</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 用户自建事件 chips（可多选） */}
              {customPool.length > 0 && (
                <View style={styles.evGrid}>
                  {customPool.map((t) => {
                    const sel = customSel.includes(t);
                    return (
                      <TouchableOpacity
                        key={t}
                        activeOpacity={0.85}
                        onPress={() => toggleCustom(t)}
                        style={[styles.evChip, sel && styles.evChipOn]}
                      >
                        <Text style={[styles.evLabel, sel && styles.evLabelOn]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
            </TouchableWithoutFeedback>

            {/* 底部记录按钮（钉在抽屉底） */}
            <View style={[styles.foot, { paddingBottom: insets.bottom + theme.sp(2) }]}>
              <TouchableOpacity activeOpacity={0.92} onPress={onRecord} style={styles.recWrap}>
                <LinearGradient
                  colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.recGrad}
                >
                  <Text style={styles.recText}>
                    {saved ? '已记录 ✓' : isBackfill ? `记录到 ${atHHMM}` : '记录此刻'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // 悬浮按钮
  fab: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    zIndex: 30,
    pointerEvents: 'box-none',
  },
  fabTouch: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    shadowColor: '#6E58C8',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  fabGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: theme.sp(4.5),
  },
  fabText: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as never,
    marginLeft: theme.sp(1.5),
  },
  fabPlus: { marginLeft: theme.sp(1.5) },

  // 弹出抽屉
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetKav: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    backgroundColor: theme.colors.textWhite,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.sp(4),
    shadowColor: '#1F1D1A',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(31,29,26,0.16)',
    alignSelf: 'center',
    marginVertical: theme.sp(1.5),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(1.5),
  },
  headTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as never,
    color: theme.colors.textTitle,
  },
  bodyScroll: {
    flex: 1,
  },
  body: {
    paddingBottom: theme.sp(3),
  },
  blobBlock: {
    alignItems: 'center',
    marginTop: theme.sp(1.5),
    marginBottom: theme.sp(2),
  },
  blobMood: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as never,
    color: theme.colors.textTitle,
    marginTop: theme.sp(1.5),
  },
  sliderBlock: {
    marginBottom: theme.sp(3),
  },
  trackWrap: {
    height: theme.sp(7),
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0, right: 0,
    height: theme.sp(0.75),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(31,29,26,0.08)',
  },
  tick: {
    position: 'absolute',
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    borderRadius: theme.sp(0.75),
    marginLeft: -theme.sp(0.75),
    opacity: 0.85,
  },
  // 半透明软胶囊光标（参考视频同款：大而软、磨砂白，滑过档位点）
  thumb: {
    position: 'absolute',
    top: theme.sp(0.25),
    left: 0,
    width: theme.sp(9),
    height: theme.sp(6.5),
    borderRadius: theme.radius.pill,
    marginLeft: -theme.sp(4.5),
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(31,29,26,0.05)',
    shadowColor: '#8A8AA0',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  evTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as never,
    color: theme.colors.textSub,
    marginBottom: theme.sp(2),
  },
  // 记录时刻选择
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginBottom: theme.sp(1.5) },
  timeChip: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  timeChipOn: {
    color: mm.colors.purpleDeep,
    backgroundColor: mm.colors.purpleSoft,
    borderColor: mm.colors.purpleMid,
    fontWeight: theme.weight.semibold as never,
  },
  timeHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(3) },
  timeHintStrong: { color: theme.colors.textTitle, fontWeight: theme.weight.semibold as never },
  addChip: {
    backgroundColor: mm.colors.purpleSoft,
    borderColor: mm.colors.purpleDeep,
    borderWidth: 1,
  },
  addChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as never,
    color: mm.colors.purpleDeep,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(2),
    marginTop: theme.sp(2),
  },
  addInput: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTitle,
    paddingVertical: theme.sp(1.5),
    paddingHorizontal: theme.sp(3),
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.btnBusyBg,
    borderWidth: 1,
    borderColor: 'rgba(31,29,26,0.06)',
  },
  addConfirm: {
    paddingHorizontal: theme.sp(4),
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.purpleDeep,
  },
  addConfirmText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as never,
    color: theme.colors.textWhite,
  },
  evGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp(2),
  },
  evChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1.25),
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1.75),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
    borderWidth: 1,
    borderColor: 'rgba(31,29,26,0.04)',
  },
  evChipOn: {
    backgroundColor: mm.colors.purpleSoft,
    borderColor: mm.colors.purpleDeep,
  },
  evLabel: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.inkSoft,
  },
  evLabelOn: {
    color: mm.colors.purpleDeep,
    fontWeight: theme.weight.semibold as never,
  },
  foot: {
    paddingTop: theme.sp(2),
    paddingHorizontal: theme.sp(4),
    marginHorizontal: -theme.sp(4),
    backgroundColor: theme.colors.textWhite,
    borderTopWidth: 1,
    borderTopColor: 'rgba(31,29,26,0.06)',
  },
  recWrap: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  recGrad: {
    alignItems: 'center',
    paddingVertical: theme.sp(2.25),
    borderRadius: theme.radius.pill,
  },
  recText: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as never,
  },
});
