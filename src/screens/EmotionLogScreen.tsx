/**
 * EmotionLogScreen —— 情绪记录页（Mooda 式：选心情球 + 一句话 + 当月心情日历）
 *
 * 口径：情绪=用户自报（Mira 不做情绪推断/评分）；与情绪负荷图（EDA 推断）独立并排。
 * 入口：情绪消耗详情页「情绪负荷」下的情绪记录卡片 → 整卡点击进本页。
 * 数据：data/emotionLog.ts（documentDirectory/emotionLog.json）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import {
  MOOD_ORDER, MOOD_LABEL, MOOD_EMOJI, type MoodKey,
  ensureEmotionLogLoaded, getLatestForDay, monthMoodMap,
  addEmotionEntry, onEmotionLog,
} from '../data/emotionLog';
import { dayKey } from '../data/healthStore';

/** 5 档情绪 → theme token 色（与情绪负荷点阵 StressEventStems 同源） */
const MOOD_COLOR: Record<MoodKey, string> = {
  excited: theme.colors.moodEnergy,
  pleasant: theme.colors.moodGood,
  calm: theme.colors.stateTired,
  stressed: theme.colors.stateEnergy,
  anxious: theme.colors.danger,
};

/** 心情球：pastel 底圆 + emoji；选中放大 + 深色描边 */
function MoodBall({ mood, selected, onPress }: { mood: MoodKey; selected: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(selected ? 1.12 : 1)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: selected ? 1.12 : 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  }, [selected, scale]);
  const c = MOOD_COLOR[mood];
  return (
    <TouchableOpacity
      activeOpacity={theme.press.opacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${MOOD_LABEL[mood]}${selected ? '（已选）' : ''}`}
      style={styles.ballTouch}
    >
      <Animated.View
        style={[
          styles.ball,
          { transform: [{ scale }], backgroundColor: c + (selected ? '' : '55'), borderColor: selected ? c : 'transparent' },
        ]}
      >
        <Text style={styles.ballEmoji}>{MOOD_EMOJI[mood]}</Text>
      </Animated.View>
      <Text style={[styles.ballLabel, selected && { color: mm.colors.ink, fontWeight: theme.weight.semibold as never }]}>
        {MOOD_LABEL[mood]}
      </Text>
    </TouchableOpacity>
  );
}

/** 当月心情日历（Mooda 式：有记录的天画情绪色点，今日描边） */
function MoodCalendar({ anchor }: { anchor: Date }) {
  const [ver, setVer] = useState(0);
  useEffect(() => onEmotionLog(() => setVer((v) => v + 1)), []);
  void ver; // 仅触发重渲染

  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay(); // 0=日
  const todayDk = dayKey(Date.now());
  const moodMap = useMemo(() => monthMoodMap(y, m), [y, m, ver]);

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <View>
      <View style={styles.calHead}>
        {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
          <Text key={w} style={[styles.calHeadText, (i === 0 || i === 6) && { color: mm.colors.inkSoft }]}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: Math.ceil(cells.length / 7) }, (_, row) => (
        <View key={row} style={styles.calRow}>
          {cells.slice(row * 7, row * 7 + 7).map((d, col) => {
            if (d == null) return <View key={`e${row}-${col}`} style={styles.calCell} />;
            const dk = dayKey(new Date(y, m, d).getTime());
            const mood = moodMap[dk];
            const isToday = dk === todayDk;
            return (
              <View
                key={dk}
                style={[styles.calCell, isToday && { borderWidth: 1.5, borderColor: theme.colors.accentSolid, borderRadius: theme.radius.md }]}
              >
                <Text style={styles.calDay}>{d}</Text>
                <View
                  style={[
                    styles.calDot,
                    { backgroundColor: mood ? MOOD_COLOR[mood] : 'transparent' },
                  ]}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function EmotionLogScreen() {
  const navigation = useNavigation<any>();
  const [selected, setSelected] = useState<MoodKey | null>(null);
  const [note, setNote] = useState('');
  const [savedTick, setSavedTick] = useState(false);

  // 进页载入历史；今天已有记录 → 预选最新一条
  useEffect(() => {
    let alive = true;
    ensureEmotionLogLoaded().then(() => {
      if (!alive) return;
      const latest = getLatestForDay(dayKey(Date.now()));
      if (latest) {
        setSelected(latest.mood);
        setNote(latest.note ?? '');
      }
    });
    return () => { alive = false; };
  }, []);

  const save = () => {
    if (!selected) return;
    addEmotionEntry(selected, note);
    setSavedTick(true);
    setTimeout(() => {
      setSavedTick(false);
      navigation.goBack();
    }, 700);
  };

  return (
    <ScreenContainer>
      <View style={styles.stack}>
        {/* 返回头（与详情页同构） */}
        <View style={styles.head}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>情绪记录</Text>
            <Text style={styles.sub}>此刻的心情，由你来记</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} bounces>
          {/* 选心情（Mooda 式 5 球） */}
          <View style={styles.ballRow}>
            {MOOD_ORDER.map((k) => (
              <MoodBall key={k} mood={k} selected={selected === k} onPress={() => setSelected(k)} />
            ))}
          </View>

          {/* 一句话备注（选中后出现） */}
          {selected ? (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="记一句此刻的感受（可选）"
              placeholderTextColor={mm.colors.inkFaint}
              multiline
              maxLength={80}
              style={styles.noteInput}
            />
          ) : null}

          {/* 保存（渐变按钮铁律：渐变层为正常流子元素、自带 padding/radius） */}
          <TouchableOpacity
            disabled={!selected || savedTick}
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="保存情绪记录"
            style={{ alignSelf: 'stretch', marginTop: theme.sp(2) }}
          >
            {selected ? (
              <LinearGradient
                colors={savedTick ? [mm.colors.limeDeep, mm.colors.limeDeep] : [mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveBtn}
              >
                <Text style={{ fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: savedTick ? mm.colors.limeSoft : mm.colors.btnTextOnGrad }}>
                  {savedTick ? '已记录 ✓' : '记下此刻'}
                </Text>
              </LinearGradient>
            ) : (
              <View style={[styles.saveBtn, { backgroundColor: mm.colors.btnBusyBg }]}>
                <Text style={{ fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint }}>
                  选一个心情
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* 当月心情日历 */}
          <View style={styles.calCard}>
            <Text style={styles.calTitle}>
              {anchorLabel()}
            </Text>
            <MoodCalendar anchor={new Date()} />
          </View>
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

function anchorLabel(): string {
  const d = new Date();
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月的心情`;
}

const styles = StyleSheet.create({
  stack: { flex: 1, gap: theme.sp(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  back: { width: theme.sp(8), height: theme.sp(8), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, marginTop: theme.sp(0.2) },

  ballRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp(1),
    marginTop: theme.sp(2),
  },
  ballTouch: { alignItems: 'center', gap: theme.sp(1) },
  ball: {
    width: theme.sp(13),
    height: theme.sp(13),
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballEmoji: { fontSize: theme.fs(24) },
  ballLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },

  noteInput: {
    marginTop: theme.sp(3),
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(2.5),
    fontSize: theme.fs(14),
    color: mm.colors.ink,
    minHeight: theme.sp(11),
    textAlignVertical: 'top',
  },

  saveBtn: {
    paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  calCard: {
    marginTop: theme.sp(4),
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: theme.fs(14),
    padding: theme.sp(3.5),
  },
  calTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginBottom: theme.sp(2.5) },
  calHead: { flexDirection: 'row' },
  calHeadText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginBottom: theme.sp(1) },
  calRow: { flexDirection: 'row' },
  calCell: { flex: 1, aspectRatio: 0.9, alignItems: 'center', justifyContent: 'center', gap: theme.sp(0.4), margin: 1 },
  calDay: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft },
  calDot: { width: theme.sp(1.6), height: theme.sp(1.6), borderRadius: theme.radius.pill },
});
