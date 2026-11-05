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
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing, Dimensions, TextInput,
  Keyboard, ScrollView, KeyboardAvoidingView, Platform,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from './Icon';
import MoodBlob from './MoodBlob';
import Icon from './Icon';
import {
  MOOD_ORDER, MOOD_LABEL, MOOD_COLOR, MOOD_EMOJI, addEmotionEntry,
  EVENT_KEYS, EVENT_LABEL, type MoodKey, type EventKey,
} from '../data/emotionLog';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { logSelfReport } from '../data/selfReportLog';

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

/**
 * 顶部大号心情小团（表情居中）
 *
 * ★ 2026-10-07（用户实锤「上面那个表情一直在闪」）：
 *   **必须定义在模块级**。之前它写在 EmotionQuickRecord 的 render 内部，
 *   每次父组件重渲染都会产生一个**新的函数身份**，React 会把整个子树
 *   卸载重挂 → MoodBlob 里的呼吸 / 两层蠕动交叉淡化三个 Animated.loop 被反复
 *   从头启动，加上 pop 弹动反复重播 → 看起来就是「表情一直在闪」。
 *   现在提到模块级 + React.memo，只有档位真正变化时才弹一下。
 */
function BlobBlock({ mood, index }: { mood: MoodKey; index: number }) {
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    pop.setValue(1);
    const anim = Animated.sequence([
      Animated.timing(pop, { toValue: 1.12, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [index, pop]);
  return (
    <View style={styles.blobBlock}>
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <MoodBlob mood={mood} size={theme.sp(26)} variant={0} />
      </Animated.View>
      <Text style={styles.blobMood}>{MOOD_LABEL[mood]}</Text>
    </View>
  );
}
const MemoBlobBlock = React.memo(BlobBlock);

const { height: SCREEN_H } = Dimensions.get('window');
// ★ 2026-10-07：抽屉加高（0.8→0.9 / 540→660）。“记录时刻”+时分滚轮一共约 320px，
//   旧高度下滚轮恰好被挤到折叠线下方，用户反馈「没有显示时间选择器」。
const SHEET_H = Math.min(SCREEN_H * 0.9, 660);

/* ───────── 时间滚轮选择器（无第三方依赖：ScrollView + snapToInterval） ─────────
 * 每行高 ITEM_H，可视 5 行 → 中心行就是选中项。
 * 上下各垫 2 行空白（PAD_PAD），保证第 0 项也能滚到中心位。
 * ───────────────────────────────────────────────────────────────────────── */
const ITEM_H = theme.sp(10);          // 每行高度
const VISIBLE = 5;                    // 可见行数（奇数，中间那行 = 选中）
const WHEEL_PAD = ITEM_H * ((VISIBLE - 1) / 2);
const WHEEL_H = ITEM_H * VISIBLE;

/** 单列滚轮 */
function WheelColumn({
  values, fmt, value, onPick, unit,
}: {
  values: number[];
  fmt: (v: number) => string;
  value: number;
  onPick: (v: number) => void;
  unit: string;
}) {
  const initialIdx = Math.max(0, values.indexOf(value));
  const [idx, setIdx] = useState(initialIdx);
  const svRef = useRef<ScrollView>(null);
  const laidOut = useRef(false);

  // 外部改动（如切换今天/昨天重置）→ 滚回对应位置
  useEffect(() => {
    const i = Math.max(0, values.indexOf(value));
    setIdx(i);
    if (laidOut.current) svRef.current?.scrollTo({ y: i * ITEM_H, animated: false });
  }, [value]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(y / ITEM_H)));
    setIdx(i);
    onPick(values[i]);
  };

  return (
    <View style={{ height: WHEEL_H, flex: 1 }}>
      <ScrollView
        ref={svRef}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        onLayout={() => {
          const i = Math.max(0, values.indexOf(value));
          if (laidOut.current) return;
          laidOut.current = true;
          svRef.current?.scrollTo({ y: i * ITEM_H, animated: false });
        }}
        contentContainerStyle={{
          paddingTop: WHEEL_PAD,
          paddingBottom: WHEEL_PAD,
        }}
      >
        {values.map((v, i) => {
          const on = i === idx;
          return (
            <View key={v} style={styles.wheelItem}>
              <Text
                style={[
                  styles.wheelText,
                  on && styles.wheelTextOn,
                  { opacity: on ? 1 : 0.28 + 0.42 * (1 - Math.min(1, Math.abs(i - idx) / 2)) },
                ]}
              >{fmt(v)}</Text>
            </View>
          );
        })}
      </ScrollView>
      {/* 中间高亮横条（纯装饰，不挡触摸） */}
      <View style={styles.wheelHighlight} pointerEvents="none" />
      <Text style={styles.wheelUnit}>{unit}</Text>
    </View>
  );
}

/** 时 + 分 双列滚轮（HOURS/MINUTES 放模块级：数组引用必须稳定，
 *  否则 WheelColumn 里依赖 `values` 的 useEffect 每次渲染都会重跑并强制 scrollTo，跟用户滚动打架） */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function TimeWheel({ hour, minute, onChange }: { hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={styles.wheelRow}>
      <WheelColumn values={HOURS} value={hour} fmt={pad} unit="时" onPick={(h) => onChange(h, minute)} />
      <View style={styles.wheelColon}><Text style={styles.wheelColonText}>:</Text></View>
      <WheelColumn values={MINUTES} value={minute} fmt={pad} unit="分" onPick={(m) => onChange(hour, m)} />
    </View>
  );
}

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
  const [atCustomMs, setAtCustomMs] = useState<number | null>(null);
  // ★ 时间选择器的三个分量（今天/昨天 + 时 + 分）。atCustomMs 是唯一写入源，
  //   这三个分量只是它的「显示形态」，改任何一个都立刻回写 atCustomMs。
  const [pickDayOffset, setPickDayOffset] = useState<0 | 1>(0);
  const [pickH, setPickH] = useState(() => new Date().getHours());
  const [pickM, setPickM] = useState(() => new Date().getMinutes());
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ★ 主体滚动容器：点「选时刻」后把滚轮滚到可见区（否则滚轮在折叠线下，看着像「没反应」）
  const bodyScrollRef = useRef<ScrollView>(null);
  const revealWheel = () => setTimeout(() => bodyScrollRef.current?.scrollToEnd({ animated: true }), 60);

  /** 把绝对时刻按「今天/昨天 + 时分」落地。dayOffset=1 → 昨天同一时刻 */
  const commitAt = (dayOffset: 0 | 1, h: number, m: number) => {
    const t = new Date();
    t.setDate(t.getDate() - dayOffset);
    t.setHours(h, m, 0, 0);
    setPickDayOffset(dayOffset);
    setPickH(h);
    setPickM(m);
    setAtCustomMs(t.getTime());
  };

  /** 点「选时刻」：以当前值（或此刻）初始化滚轮，再把当前所在的天对到「今天/昨天」桶上 */
  const openWheel = () => {
    const base = atCustomMs ?? Date.now();
    const d = new Date(base);
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const off: 0 | 1 = base < today0.getTime() ? 1 : 0;
    commitAt(off, d.getHours(), d.getMinutes());
  };

  /** 滚轮滚动：只改时分，日期保持当前桶 */
  const applyWheel = (h: number, m: number) => commitAt(pickDayOffset, h, m);
  /** 今天/昨天切换：保持时分不变 */
  const changeDay = (off: 0 | 1) => commitAt(off, pickH, pickM);

  // 抽屉位移：offY（完全在屏幕下方）→ 0（停靠底部）
  const offY = useRef(new Animated.Value(SHEET_H)).current;
  const scrimOp = useRef(new Animated.Value(0)).current;

  const mood = MOODS[index];

  // 打开时重置选择 + 播放进入动画
  const open = () => {
    setIndex(2);
    setEvents([]);
    setCustomSel([]);
    setCustomText('');
    setShowAdd(false);
    setSaved(false);
    setAtOffsetMin(null);   // 每次打开默认「此刻」
    setAtCustomMs(null);
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

  // ── 情绪滑条（React Native Community Slider, 原生丝滑） ──
  const [trackW, setTrackW] = useState(0);
  const sliderStep = 1 / (MOODS.length - 1);

  /** 实际写入的时刻：atOffsetMin=null → 此刻；否则 = 此刻 - atOffsetMin 分钟 */
  const recordAtMs = (): number => {
    if (atCustomMs != null) return atCustomMs;
    if (atOffsetMin != null) return Date.now() - atOffsetMin * 60000;
    return Date.now();
  };
  const atHHMM = (() => {
    const d = new Date(recordAtMs());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();
  const isBackfill = (atOffsetMin != null && atOffsetMin > 0) || atCustomMs != null;

  const onRecord = async () => {
    if (saved) return;
    addEmotionEntry(mood, undefined, events, customSel.length > 0 ? customSel : undefined, recordAtMs());
    // ★ 本轮（用户）：记录心情时，同时写一条回顾摘要，让「刚记的心情」立刻出现在回顾·今日。
    const at = recordAtMs();
    const d = new Date(at);
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const parts = [MOOD_LABEL[mood], ...events.map((e) => EVENT_LABEL[e]), ...(customSel.length > 0 ? customSel : [])];
    await logSelfReport({
      type: 'mood',
      dk,
      time: hhmm,
      title: '记录心情',
      sub: parts.join(' · '),
      analysis: '你的感受，值得被接住。',
      emoji: MOOD_EMOJI[mood],
      color: MOOD_COLOR[mood],
    });
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => close(), 1300);
  };

  return (
    <>
      {/* ── 悬浮按钮（明显、渐变胶囊 + 会动小团） ── */}
      {!visible && (
      <View style={[styles.fab, { bottom: insets.bottom + theme.sp(8) }]}>
        <TouchableOpacity activeOpacity={0.7} onPress={open} style={styles.fabTouch}>
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
      )}

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

            {/* 可滚动主体
                ★ 2026-10-07：不能用 TouchableWithoutFeedback 包 ScrollView ——它会把监听手势抢走，
                  抽屉滚不动 → 折叠线下的「记录时刻 / 时间选择器」永远看不到。改成按滚动收键盘。 */}
            <ScrollView
              ref={bodyScrollRef}
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              onScrollBeginDrag={Keyboard.dismiss}
            >
              {/* 居中大号会动小团 + 当前心情文字（切档时轻微弹一下） */}
              <MemoBlobBlock mood={mood} index={index} />

              {/* 情绪滑条（复刻参考视频）：细轨 + 小点 + 半透明软胶囊光标，无彩色填充条 */}
              <View style={styles.sliderBlock}>
                {/* 5 档小点 (自定义在 Slider 上方) */}
                <View style={styles.tickRow} pointerEvents="none">
                  {MOOD_ORDER.map((m, i) => (
                    <View
                      key={m}
                      style={[
                        styles.tickDot,
                        index === i && styles.tickDotActive,
                        { backgroundColor: MOOD_COLOR[m] },
                      ]}
                    />
                  ))}
                </View>
                <Slider
                  value={index / (MOODS.length - 1)}
                  minimumValue={0}
                  maximumValue={1}
                  step={0}
                  tapToSeek
                  onValueChange={(v) => setIndex(Math.round(v * (MOODS.length - 1)))}
                  minimumTrackTintColor={mm.colors.purpleDeep}
                  maximumTrackTintColor={mm.colors.purpleSoft}
                  thumbTintColor={'#FFFFFF'}
                  style={{ width: '100%', height: 40 }}
                />
                {/* 档位标签 */}
                <View style={styles.tickRow}>
                  {MOOD_ORDER.map((m, i) => (
                    <Text
                      key={m}
                      style={[
                        styles.tickLabel,
                        index === i && styles.tickLabelActive,
                      ]}
                    >{i === 0 ? '兴奋' : i === 4 ? '难过' : ''}</Text>
                  ))}
                </View>
              </View>

              {/* ★ 记录时刻：默认此刻，可选相对档位，也可以拉出时分滚轮挑一个具体时刻 */}
              <Text style={styles.evTitle}>记录时刻</Text>
              {/* ★ 2026-10-07（用户截图实锤）：chips 必须用 TouchableOpacity + 内层 Text。
                  旧写法把样式直接挂在 Text 上（含 overflow:'hidden' + 合并的选中/未选中样式），
                  在 iOS 上会出现「占位但一字不画」的空白条 —— 这就是一直「没看见时间选择器」的真因。
                  现改成同屏「工作/运动/饮食」一样的可见组合，并把容器样式与文字样式拆开。 */}
              <View style={styles.timeRow}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => { setAtOffsetMin(null); setAtCustomMs(null); }}
                  style={[styles.timeChip, !isBackfill && styles.timeChipOn]}>
                  <Text style={[styles.timeChipText, !isBackfill && styles.timeChipTextOn]}>此刻</Text>
                </TouchableOpacity>
                {TIME_OFFSETS.map((o) => {
                  const sel = atOffsetMin === o.min && atCustomMs == null;
                  return (
                    <TouchableOpacity
                      key={o.min}
                      activeOpacity={0.7}
                      onPress={() => { setAtOffsetMin(o.min); setAtCustomMs(null); }}
                      style={[styles.timeChip, sel && styles.timeChipOn]}
                    >
                      <Text style={[styles.timeChipText, sel && styles.timeChipTextOn]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity activeOpacity={0.7} onPress={() => { setAtOffsetMin(null); openWheel(); revealWheel(); }}
                  style={[styles.timeChip, atCustomMs != null && styles.timeChipOn]}>
                  <Text style={[styles.timeChipText, atCustomMs != null && styles.timeChipTextOn]}>选时刻</Text>
                </TouchableOpacity>
              </View>
              {/* ★ 时间选择器：日期（今天/昨天）+ 时分滚轮 */}
              {atCustomMs != null && (
                <View style={styles.pickerWrap}>
                  <View style={styles.dayToggle}>
                    {[{ off: 0, label: '今天' }, { off: 1, label: '昨天' }].map((d) => {
                      const on = pickDayOffset === d.off;
                      return (
                        <TouchableOpacity
                          key={d.off}
                          activeOpacity={0.7}
                          onPress={() => changeDay(d.off as 0 | 1)}
                          style={[styles.dayBtn, on && styles.dayBtnOn]}
                        >
                          <Text style={[styles.dayBtnText, on && styles.dayBtnTextOn]}>{d.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TimeWheel hour={pickH} minute={pickM} onChange={applyWheel} />
                </View>
              )}
              <Text style={styles.timeHint}>
                将记录到 <Text style={styles.timeHintStrong}>{atHHMM}</Text>
                {atCustomMs != null
                  ? `（${pickDayOffset === 1 ? '昨天' : '今天'}）`
                  : atOffsetMin != null && atOffsetMin >= 1440 ? '（昨天）' : ''}
              </Text>

              {/* 带图标的生活事件多选（＋添加 放在出行旁边） */}
              <Text style={styles.evTitle}>发生了什么？（可选）</Text>
              <View style={styles.evGrid}>
                {EVENT_KEYS.map((ev) => {
                  const sel = events.includes(ev);
                  return (
                    <TouchableOpacity
                      key={ev}
                      activeOpacity={0.7}
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
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowAdd((v) => !v)} style={[styles.evChip, styles.addChip]}>
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
                  <TouchableOpacity activeOpacity={0.7} onPress={confirmCustom} style={styles.addConfirm}>
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
                        activeOpacity={0.7}
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

            {/* 底部记录按钮（钉在抽屉底） */}
            <View style={[styles.foot, { paddingBottom: insets.bottom + theme.sp(2) }]}>
              <TouchableOpacity activeOpacity={0.7} onPress={onRecord} style={styles.recWrap}>
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
    backgroundColor: theme.colors.bgBottom,
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
    paddingTop: theme.sp(1),
    paddingBottom: theme.sp(4),
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
    marginBottom: theme.sp(1.5),
  },
  tickRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.sp(1), marginBottom: theme.sp(0.5) },
  tickDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.radius.pill, opacity: 0.4 },
  tickDotActive: { opacity: 1, transform: [{ scale: 1.2 }] },
  tickLabel: { fontSize: theme.fs(10), color: mm.colors.inkSoft, textAlign: 'center', minWidth: 40 },
  tickLabelActive: { color: mm.colors.purpleDeep, fontWeight: '700' as never },
  customRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: theme.sp(1.5), gap: theme.sp(2.5) },
  customBtn: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.sp(4), backgroundColor: mm.colors.purpleSoft },
  customBtnText: { fontSize: theme.fs(12), color: mm.colors.purpleDeep, fontWeight: '600' as never },
  customNow: { fontSize: theme.fs(15), fontWeight: '700' as never, color: mm.colors.ink, fontVariant: ['tabular-nums'] },

  /* ── 时间选择器 ── */
  pickerWrap: {
    marginTop: theme.sp(1.5),
    backgroundColor: mm.colors.purpleSoft,
    borderRadius: theme.radius.card,
    paddingTop: theme.sp(1.5),
    paddingBottom: theme.sp(1),
  },
  dayToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.pill,
    padding: 3,
    marginBottom: theme.sp(0.5),
  },
  dayBtn: {
    paddingHorizontal: theme.sp(3.5),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
  },
  dayBtnOn: { backgroundColor: mm.colors.purpleDeep },
  dayBtnText: { fontSize: theme.fs(12), color: mm.colors.inkSoft, fontWeight: '600' as never },
  dayBtnTextOn: { color: theme.colors.textWhite },
  wheelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  wheelItem: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  wheelText: {
    fontSize: theme.fs(20),
    fontWeight: '600' as never,
    color: mm.colors.purpleDeep, // ★ 对比度修复：白字压 purpleSoft 浅紫滚轮底不可读 → purpleDeep（深浅底通用）
    fontVariant: ['tabular-nums'],
  },
  wheelTextOn: { color: mm.colors.purpleDeep, fontWeight: '700' as never, fontSize: theme.fs(22) },
  wheelHighlight: {
    position: 'absolute',
    left: theme.sp(1.5), right: theme.sp(1.5),
    top: WHEEL_PAD,
    height: ITEM_H,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.textWhite,
    opacity: 0.75,
  },
  wheelUnit: {
    position: 'absolute',
    top: WHEEL_PAD - theme.sp(0.5),
    right: theme.sp(3),
    fontSize: theme.fs(10),
    color: mm.colors.inkSoft,
  },
  wheelColon: { width: theme.sp(3), alignItems: 'center' },
  wheelColonText: { fontSize: theme.fs(20), fontWeight: '700' as never, color: mm.colors.inkSoft, marginTop: -ITEM_H * 2 },

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
  // ★ 容器样式与文字样式必须拆开：选中/未选中的文字颜色要能独立覆盖
  timeChip: {
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill,
  },
  timeChipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
  },
  timeChipOn: {
    backgroundColor: mm.colors.purpleSoft,
    borderColor: mm.colors.purpleMid,
  },
  timeChipTextOn: {
    color: mm.colors.purpleDeep,
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
    backgroundColor: theme.colors.bgBottom,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
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
