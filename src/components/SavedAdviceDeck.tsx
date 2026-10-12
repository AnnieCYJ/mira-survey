import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TouchableWithoutFeedback, ScrollView, Dimensions, Image,
} from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { habitHeadline, type HabitEntry } from '../data/habitSuggestions';

/* ★ 2026-10-11（用户）：每条建议左边加小图，风格与首页泡泡建议卡一致。
   缩略图直接复用首页同款资产 card_*.jpg/png，按 cta 屏幕映射，再补文本兜底。 */
const ADVICE_THUMB: Record<string, any> = {
  Breathing: require('../assets/card_meditation.jpg'),
  ToolTopic: require('../assets/card_learn.png'),
  LearnRead: require('../assets/card_learn.png'),
  FoodScan: require('../assets/card_food.jpg'),
};
const THUMB_MED = require('../assets/card_meditation.jpg');
const THUMB_ACT = require('../assets/card_activity.jpg');
const THUMB_FOOD = require('../assets/card_food.jpg');
const THUMB_LEARN = require('../assets/card_learn.png');
const THUMB_DEFAULT = require('../assets/card_emotion.jpg');

function thumbForHabit(h: HabitEntry): any {
  if (h.cta && ADVICE_THUMB[h.cta.screen]) return ADVICE_THUMB[h.cta.screen];
  const s = `${h.action ?? ''}${h.headline ?? ''}`;
  if (/呼吸|冥想|睡/.test(s)) return THUMB_MED;
  if (/动|跑|运|步/.test(s)) return THUMB_ACT;
  if (/吃|食|饮|营养|餐/.test(s)) return THUMB_FOOD;
  if (/学|科普|读|知/.test(s)) return THUMB_LEARN;
  return THUMB_DEFAULT;
}

/* ★ 2026-10-11 用户定稿：「我收藏的建议」横滑卡。
   置于工具页底部（图标条 / 工具卡下方）：
   - 顶部标题「我收藏的建议」+ 右侧「共 N 条 ›」；
   - 卡片一屏一张、可左右滑（最多 3 张，右侧露出下一张的边缘）；用户要求再小一点；
   - 每条建议左侧加小图（复用首页泡泡同款 card_* 缩略图，按 cta 屏幕映射 + 文本兜底），
     右列为标题 +「确认有帮助 N 次 · {证据}」+「最近一次：…」，底部紫色「再做一次」药丸；
   - 卡片底色改干净白卡、弱化投影（去掉之前的灰块感）；点卡片 → 底部弹出清单看全部，每条可「再做一次 / 移除」。 */

const MAX_VISIBLE = 3;          // 一屏最多露出 3 张（可滑动查看）
const PEEK = 48;                // 右侧留给「下一张」的露出宽度
const GAP = 12;                 // 卡间距
const CARD_MIN_H = 76;          // 卡片最小高度（用户：要更扁、高度再减小）
const MAX_SHEET_H = Dimensions.get('window').height * 0.82;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 「最近一次」的时间口径：今天 HH:MM / 昨天 HH:MM / M月D日 HH:MM（与 sportTimeLabel 同风格） */
function lastSeenLabel(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const now = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return `今天 ${hm}`;
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (same(d, y)) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function adviceTitle(h: HabitEntry) {
  return h.headline || habitHeadline(h.action);
}
/** 证据行：确认有帮助 N 次 · {真实指标短语}（无指标时只留次数，不编造） */
function adviceEvidence(h: HabitEntry) {
  const base = `确认有帮助 ${Math.max(1, h.count)} 次`;
  return h.metric ? `${base} · ${h.metric}` : base;
}

export default function SavedAdviceDeck({
  habits,
  width,
  navigation,
  onRemove,
}: {
  habits: HabitEntry[];
  width?: number;
  navigation: any;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullList, setFullList] = useState(false);   // ★ 2026-10-11（用户）：「共 N 条」→ 打开完整页面
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);

  const W = width ?? Dimensions.get('window').width - 52;
  const CARD_W = Math.max(120, W - PEEK);
  const SNAP = CARD_W + GAP;

  const go = (h: HabitEntry) => {
    if (h.cta && h.cta.screen) {
      try { navigation.navigate(h.cta.screen, h.cta.params); } catch { /* 静默 */ }
    }
  };

  const onScroll = useCallback((e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.max(0, Math.round(x / (SNAP || 1)));
    if (idx !== pageRef.current) {
      pageRef.current = idx;
      setPage(idx);
    }
  }, [SNAP]);

  // ★ 空态：仍占一个卡位，给清晰引导（不整块消失）
  if (habits.length === 0) {
    return (
      <View style={[styles.deck, { width: W, alignSelf: 'center' }]}>
        <View style={styles.deckHeader}>
          <Text style={styles.deckTitle}>我收藏的建议</Text>
        </View>
        <View style={[styles.card, styles.emptyCard, { width: CARD_W }]}>
          <Text style={styles.emptyText}>还没有收藏的建议</Text>
          <Text style={styles.emptyHint}>在首页确认 Mira 的建议后，会收在这里。</Text>
        </View>
      </View>
    );
  }

  const stack = habits.slice(0, MAX_VISIBLE);

  return (
    <View style={[styles.deck, { width: W, alignSelf: 'center' }]}>
      <View style={styles.deckHeader}>
        <Text style={styles.deckTitle}>我收藏的建议</Text>
        <TouchableOpacity style={styles.deckMore} activeOpacity={theme.press.opacity} onPress={() => setFullList(true)}>
          <Text style={styles.deckMoreText}>共 {habits.length} 条 ›</Text>
        </TouchableOpacity>
      </View>

      {/* ★ 横滑大卡：一屏一张，最多 3 张，右侧露出下一张边缘提示可滑 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP}
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ paddingRight: GAP }}
      >
        {stack.map((h) => {
          return (
            <TouchableOpacity
              key={h.id}
              activeOpacity={0.97}
              style={[styles.card, { width: CARD_W, marginRight: GAP }]}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={`${adviceTitle(h)}，点按查看全部收藏建议`}
            >
              <View style={styles.cardTop}>
                <Image source={thumbForHabit(h)} style={styles.cardThumb} />
                <View style={styles.cardCol}>
                  <Text style={styles.cTitle} numberOfLines={1}>{adviceTitle(h)}</Text>
                  <Text style={styles.cDesc} numberOfLines={1}>{adviceEvidence(h)}</Text>
                  <Text style={styles.cTime} numberOfLines={1}>最近一次：{lastSeenLabel(h.lastAt)}</Text>
                </View>
              </View>
              <View style={styles.cardFoot}>
                <TouchableOpacity
                  style={styles.pill}
                  activeOpacity={theme.press.opacity}
                  onPress={(e: any) => { e.stopPropagation(); go(h); }}
                >
                  <Text style={styles.pillText}>再做一次</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ★ 2026-10-12（用户：把那排像进度条的东西去掉）—— 页码指示点已移除 */}

      {/* ★ 展开态：底部弹出全部清单 */}
      <Modal visible={expanded} transparent animationType="slide" onRequestClose={() => setExpanded(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableWithoutFeedback onPress={() => setExpanded(false)}>
            <View style={styles.sheetScrim} />
          </TouchableWithoutFeedback>
          <View style={[styles.sheet, { maxHeight: MAX_SHEET_H }]}>
            <View style={styles.sheetGrab} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>我收藏的建议</Text>
              <Text style={styles.sheetCount}>共 {habits.length} 条</Text>
              <TouchableOpacity style={styles.sheetClose} activeOpacity={theme.press.opacity} onPress={() => setExpanded(false)}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
              {habits.map((h) => {
                return (
                  <View key={h.id} style={styles.sRow}>
                    <Image source={thumbForHabit(h)} style={styles.sThumb} />
                    <View style={styles.sText}>
                      <Text style={styles.sTitle} numberOfLines={2}>{adviceTitle(h)}</Text>
                      <Text style={styles.sDesc} numberOfLines={2}>{adviceEvidence(h)}</Text>
                      <Text style={styles.sTime}>最近一次：{lastSeenLabel(h.lastAt)}</Text>
                    </View>
                    <View style={styles.sRight}>
                      <TouchableOpacity
                        style={styles.sPill}
                        activeOpacity={theme.press.opacity}
                        onPress={() => { go(h); setExpanded(false); }}
                      >
                        <Text style={styles.sPillText}>再做一次</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sRemove}
                        activeOpacity={theme.press.opacity}
                        onPress={() => { onRemove(h.id); }}
                      >
                        <Text style={styles.sRemoveText}>移除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ★ 2026-10-11（用户）：「共 N 条」点开 = 完整页面（全屏，非底部 sheet） */}
      <Modal visible={fullList} transparent={false} animationType="slide" onRequestClose={() => setFullList(false)}>
        <View style={styles.fullPage}>
          <View style={styles.fullHead}>
            <TouchableOpacity style={styles.fullBack} activeOpacity={theme.press.opacity} onPress={() => setFullList(false)}>
              <Text style={styles.fullBackText}>‹ 返回</Text>
            </TouchableOpacity>
            <Text style={styles.fullTitle}>我收藏的建议</Text>
            <Text style={styles.fullCount}>共 {habits.length} 条</Text>
          </View>
          <ScrollView style={styles.fullScroll} contentContainerStyle={styles.fullScrollContent}>
            {habits.map((h) => (
              <View key={h.id} style={styles.sRow}>
                <Image source={thumbForHabit(h)} style={styles.sThumb} />
                <View style={styles.sText}>
                  <Text style={styles.sTitle} numberOfLines={2}>{adviceTitle(h)}</Text>
                  <Text style={styles.sDesc} numberOfLines={2}>{adviceEvidence(h)}</Text>
                  <Text style={styles.sTime}>最近一次：{lastSeenLabel(h.lastAt)}</Text>
                </View>
                <View style={styles.sRight}>
                  <TouchableOpacity style={styles.sPill} activeOpacity={theme.press.opacity} onPress={() => { go(h); setFullList(false); }}>
                    <Text style={styles.sPillText}>再做一次</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sRemove} activeOpacity={theme.press.opacity} onPress={() => onRemove(h.id)}>
                    <Text style={styles.sRemoveText}>移除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { marginTop: theme.sp(6), marginBottom: theme.space.sm },

  deckHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: theme.sp(2.5),
  },
  deckTitle: {
    fontSize: theme.fs(17), fontWeight: theme.weight.semibold,
    color: mm.colors.ink, letterSpacing: -0.3,
  },
  deckMore: { paddingVertical: theme.sp(1) },
  deckMoreText: {
    fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, fontWeight: theme.weight.medium,
  },

  // ★ 横滑卡（再小一点；底色改干净白卡、弱化投影，去掉之前的灰块感；左图右文 + 右侧药丸）
  card: {
    minHeight: CARD_MIN_H,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.card,
    borderWidth: 1, borderColor: 'rgba(31,29,26,0.07)',
    paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(3.5),
    shadowColor: '#1F1D1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  // ★ 上排：图左 + 文右（A 版：按钮在文字下方右对齐）
  cardTop: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
  },
  cardFoot: {
    flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.sp(2),
  },
  cardThumb: {
    width: 56, height: 56, borderRadius: theme.radius.md,
    marginRight: theme.sp(3), backgroundColor: theme.colors.cardBgSoft, flexShrink: 0,
  },
  cardCol: { flex: 1, minWidth: 0 },
  cTitle: {
    fontSize: theme.fs(14), fontWeight: theme.weight.semibold,
    color: mm.colors.ink, letterSpacing: -0.3, lineHeight: theme.fs(18),
  },
  cDesc: {
    marginTop: theme.sp(0.5),
    fontSize: theme.fontSize.xs, fontWeight: theme.weight.regular,
    color: mm.colors.inkSoft, lineHeight: theme.fs(15),
  },
  cTime: {
    marginTop: theme.sp(0.5),
    fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular,
    color: mm.colors.inkFaint, lineHeight: theme.fs(13),
  },

  // 紫色药丸（放在卡片底部，右对齐；浅紫底 + 紫字）
  pill: {
    flexDirection: 'row', alignItems: 'center', flexShrink: 0,
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.sp(1.5), paddingHorizontal: theme.sp(3),
  },
  pillText: {
    fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.accentText,
  },

  emptyCard: { alignItems: 'flex-start', justifyContent: 'center' },
  emptyText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.inkSoft },
  emptyHint: {
    fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginTop: 4, lineHeight: theme.fs(18),
  },

  // ★ 展开 sheet
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(31,29,26,0.35)',
  },
  sheet: {
    backgroundColor: theme.colors.cardBg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: theme.space.md, paddingTop: theme.sp(2), paddingBottom: theme.space.lg,
    shadowColor: '#1F1D1A',
    shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.16, shadowRadius: 20, elevation: 8,
  },
  sheetGrab: {
    width: theme.sp(11), height: 4, borderRadius: 2,
    backgroundColor: 'rgba(31,29,26,0.14)', alignSelf: 'center', marginBottom: theme.sp(3),
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(3) },
  sheetTitle: {
    fontSize: theme.fs(19), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3,
  },
  sheetCount: {
    fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginLeft: theme.sp(2), fontWeight: theme.weight.medium,
  },
  sheetClose: { marginLeft: 'auto', padding: theme.sp(1.5), marginRight: -theme.sp(1.5) },
  sheetCloseText: { fontSize: theme.fontSize.card, color: mm.colors.inkFaint },
  sheetScroll: {},
  sheetScrollContent: { paddingBottom: theme.sp(2) },

  sRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.card, borderWidth: 1, borderColor: mm.colors.cardBorder,
    paddingVertical: theme.sp(3), paddingHorizontal: theme.sp(3), marginBottom: theme.sp(2),
  },
  sThumb: {
    width: 48, height: 48, borderRadius: theme.radius.md,
    marginRight: theme.sp(3), backgroundColor: theme.colors.cardBgSoft, flexShrink: 0,
  },
  sText: { flex: 1, minWidth: 0 },
  sTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  sDesc: {
    fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: 2, lineHeight: theme.fs(18),
  },
  sTime: {
    fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginTop: 3, lineHeight: theme.fs(16),
  },
  sRight: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: theme.sp(2), paddingTop: theme.sp(0.5) },
  sPill: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.sp(1.5), paddingHorizontal: theme.sp(3),
  },
  sPillText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: theme.colors.accentText },
  sRemove: { marginTop: theme.sp(2) },
  sRemoveText: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },

  // ★ 完整页面（「共 N 条」点开，全屏）
  fullPage: { flex: 1, backgroundColor: '#FFFFFF' },
  fullHead: {
    flexDirection: 'row', alignItems: 'center', height: 52,
    paddingHorizontal: theme.sp(3),
    borderBottomWidth: 1, borderColor: mm.colors.cardBorder, backgroundColor: '#FFFFFF',
  },
  fullBack: { paddingVertical: theme.sp(1), paddingRight: theme.sp(2) },
  fullBackText: { fontSize: theme.fontSize.body, color: mm.colors.inkSoft },
  fullTitle: {
    flex: 1, textAlign: 'center',
    fontSize: theme.fs(17), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3,
  },
  fullCount: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginLeft: theme.sp(2) },
  fullScroll: { flex: 1, backgroundColor: '#FFFFFF' },
  fullScrollContent: {
    paddingHorizontal: theme.space.md, paddingTop: theme.sp(3), paddingBottom: theme.space.lg,
  },
});
