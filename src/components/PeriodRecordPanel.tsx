/**
 * PeriodRecordPanel —— 经期记录内联展开面板
 *
 * 由 CyclePhaseCard 的「记录经期」按钮在月相环下方展开（非弹窗）。
 * 内容参考 Clue / Flo / 美柚 等经期 App 的日志维度：
 *   - 记录日期选择（近 60 天，可回填）
 *   - 经量（💧 点滴/量少/正常/量多）
 *   - 疼痛程度（无痛/轻微/中度/严重）
 *   - 心情（😊 单选）
 *   - 身体症状（🤕 emoji 图标多选网格）
 *   - 「设为本次经期第一天」开关 → 展开周期长度步进，写入戒指设备
 *   - 查看历史：按天累积的日记录列表（点某一天 = 回填到上面的表单继续编辑）。
 *     ★ 2026-10-07（用户：经期记录本该每天一条 → 历史要存下来，并在记录页里能「查看历史」）。
 *     数据本来就按天存在 periodLog.json（loadPeriodDays），这里只是补一个入口与列表。
 *
 * 数据：当日自感状态 → PeriodDayLog（本机沙盒）；经期开始日 → CycleLog + 戒指 female。
 * 全部走 design token，无裸值。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import {
  dayKey,
  type CycleLog,
} from '../lib/cycleMath';
import {
  loadPeriodDay,
  loadPeriodDays,
  savePeriodDay,
  saveCycleLog,
  FLOW_LABEL,
  PAIN_LABEL,
  SYMPTOM_TAGS,
  MOOD_OPTIONS,
  type FlowLevel,
  type PainLevel,
  type PeriodDayLog,
} from '../data/cycleLog';
import { RingBle, type FemaleInfo } from '../ble/RingBleManager';

const FLOWS: FlowLevel[] = ['spotting', 'light', 'normal', 'heavy'];
const PAINS: PainLevel[] = ['none', 'mild', 'moderate', 'severe'];

export default function PeriodRecordPanel({
  female,
  currentLog,
  onSaved,
}: {
  female: FemaleInfo | null;
  currentLog: CycleLog | null;
  onSaved: () => void;
}) {
  const todayKey = dayKey(new Date());
  const [selDate, setSelDate] = useState(todayKey);
  const [flow, setFlow] = useState<FlowLevel>('');
  const [pain, setPain] = useState<PainLevel>('');
  const [mood, setMood] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isStart, setIsStart] = useState(false);
  const [cycleLen, setCycleLen] = useState(
    female?.menstrualCircle ?? currentLog?.cycleLength ?? 28,
  );
  const [justSaved, setJustSaved] = useState(false);

  // ★ 2026-10-07：历史记录（按天累积，最新在上）—— 只列出真的填过内容的那些天
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<PeriodDayLog[]>([]);
  const refreshHistory = () => {
    void loadPeriodDays().then((all) => {
      const list = Object.values(all)
        .filter((e) => e && (e.flow || e.pain || e.mood || (e.tags && e.tags.length)))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      setHistory(list);
    });
  };
  useEffect(() => {
    refreshHistory();
  }, []);
  const toggleHistory = () => {
    setHistoryOpen((v) => {
      if (!v) refreshHistory();
      return !v;
    });
  };
  /** 'YYYY-MM-DD' → 'M/D' */
  const fmtDay = (k: string) => {
    const [, m, d] = k.split('-');
    return `${Number(m)}/${Number(d)}`;
  };

  // 近 60 天日期 chip（可回填历史经期/症状）
  const chips: { key: string; label: string }[] = [];
  const t = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(t);
    d.setDate(d.getDate() - i);
    chips.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }

  // 切换日期 → 载入该日已有记录用于回填
  useEffect(() => {
    let cancelled = false;
    void loadPeriodDay(selDate).then((e) => {
      if (cancelled) return;
      setFlow(e?.flow ?? '');
      setPain(e?.pain ?? '');
      setMood(e?.mood ?? '');
      setTags(e?.tags ?? []);
    });
    setIsStart(!!(currentLog && selDate === currentLog.lastPeriodStart));
    return () => {
      cancelled = true;
    };
  }, [selDate, currentLog]);

  const toggleTag = (k: string) =>
    setTags((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const onSave = async () => {
    const entry: PeriodDayLog = {
      date: selDate,
      flow,
      pain,
      mood: mood || undefined,
      tags: tags.length ? tags : undefined,
      updatedAt: Date.now(),
    };
    // 1) 当日自感状态：立即保存，保证「点击必有反应」
    await savePeriodDay(entry);

    // 2) 若标记为本次经期第一天：写入主记录（本地 + 戒指设备）
    if (isStart) {
      const next: CycleLog = {
        lastPeriodStart: selDate,
        cycleLength: cycleLen,
        lutealLength: 14,
        periodLength: 5,
      };
      await saveCycleLog(next);
      try {
        await RingBle.writeFemale(selDate, cycleLen, 5);
      } catch {
        /* 戒指未写入：本地已存，不阻塞 */
      }
      void RingBle.refreshLocalCycle();
    }

    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
    refreshHistory(); // ★ 保存后历史列表立即跟上
    onSaved();
  };

  return (
    <View style={styles.panel}>
      {/* ★ 2026-10-07（用户：记录页里加一个「查看历史」）—— 历史入口 + 列表 */}
      <View style={styles.histRow}>
        <Text style={styles.histLabel}>{history.length > 0 ? `已有 ${history.length} 天记录` : '暂无历史记录'}</Text>
        <TouchableOpacity activeOpacity={0.8} onPress={toggleHistory}>
          <Text style={styles.histLink}>{historyOpen ? '收起历史' : '查看历史 ›'}</Text>
        </TouchableOpacity>
      </View>

      {historyOpen ? (
        <View style={styles.histList}>
          {history.length === 0 ? (
            <Text style={styles.histEmpty}>还没有历史记录，保存一次就会出现。</Text>
          ) : (
            history.map((h) => {
              const tags = (h.tags ?? [])
                .map((t) => SYMPTOM_TAGS.find((s) => s.key === t)?.emoji ?? '')
                .join('');
              const moodEmoji = h.mood ? MOOD_OPTIONS.find((mo) => mo.key === h.mood)?.emoji ?? '' : '';
              const line = [
                h.flow ? `经量 ${FLOW_LABEL[h.flow]}` : '',
                h.pain ? `疼痛 ${PAIN_LABEL[h.pain]}` : '',
                moodEmoji,
                tags,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <TouchableOpacity
                  key={h.date}
                  activeOpacity={0.75}
                  style={styles.histItem}
                  onPress={() => {
                    setSelDate(h.date); // 回填到上面的表单继续编辑
                    setHistoryOpen(false);
                  }}
                >
                  <Text style={styles.histDate}>{fmtDay(h.date)}</Text>
                  <Text style={styles.histTags} numberOfLines={1}>{line || '—'}</Text>
                  <Text style={styles.histGo}>›</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      ) : null}

      {/* 记录日期 */}
      <Text style={styles.sectionTitle}>记录日期</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        {chips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.dateChip, selDate === c.key && styles.dateChipOn]}
            onPress={() => setSelDate(c.key)}
          >
            <Text style={[styles.chipText, selDate === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 经量 */}
      <Text style={styles.sectionTitle}>经量 💧</Text>
      <View style={styles.row}>
        {FLOWS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.pill, flow === f && styles.pillOn]}
            onPress={() => setFlow(flow === f ? '' : f)}
          >
            <Text style={[styles.chipText, flow === f && styles.chipTextOn]}>{FLOW_LABEL[f]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 疼痛 */}
      <Text style={styles.sectionTitle}>疼痛程度</Text>
      <View style={styles.row}>
        {PAINS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.pill, pain === p && styles.pillOn]}
            onPress={() => setPain(pain === p ? '' : p)}
          >
            <Text style={[styles.chipText, pain === p && styles.chipTextOn]}>{PAIN_LABEL[p]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 心情 */}
      <Text style={styles.sectionTitle}>心情</Text>
      <View style={styles.row}>
        {MOOD_OPTIONS.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.moodChip, mood === m.key && styles.moodChipOn]}
            onPress={() => setMood(mood === m.key ? '' : m.key)}
          >
            <Text style={styles.moodEmoji}>{m.emoji}</Text>
            <Text style={[styles.moodLabel, mood === m.key && styles.moodLabelOn]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 身体症状 */}
      <Text style={styles.sectionTitle}>身体症状</Text>
      <View style={styles.symptomGrid}>
        {SYMPTOM_TAGS.map((s) => {
          const on = tags.includes(s.key);
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.symptomTile, on && styles.symptomTileOn]}
              onPress={() => toggleTag(s.key)}
            >
              <Text style={styles.symptomEmoji}>{s.emoji}</Text>
              <Text style={[styles.symptomLabel, on && styles.symptomLabelOn]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 设为本次经期第一天 */}
      <TouchableOpacity style={styles.startToggle} onPress={() => setIsStart((v) => !v)}>
        <View style={[styles.checkbox, isStart && styles.checkboxOn]}>
          {isStart ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <View style={styles.startTextWrap}>
          <Text style={styles.startTitle}>设为本次经期第一天</Text>
          <Text style={styles.startSub}>用于推算周期、排卵期与下次经期</Text>
        </View>
      </TouchableOpacity>

      {isStart ? (
        <View style={styles.stepperRow}>
          <Text style={styles.stepperLabel}>月经周期长度</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setCycleLen((v) => Math.max(21, v - 1))}>
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepValue}>{cycleLen} 天</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setCycleLen((v) => Math.min(40, v + 1))}>
              <Text style={styles.stepBtnText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* v21：保存 CTA=紫实底（周期域紫主控）；渐变层自带 padding，Touchable 只留裁切 */}
      <TouchableOpacity style={styles.saveBtn} onPress={onSave} activeOpacity={0.85}>
        <LinearGradient
          colors={[mm.colors.purpleBtn, mm.colors.purpleBtn]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.saveBtnGrad}
        >
          <Text style={styles.saveBtnText}>{justSaved ? '已保存 ✓' : '保存记录'}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    marginTop: 0,
  },
  /* ★ 2026-10-07：历史入口 + 列表（不铺灰底，用描边框区分） */
  histRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.xs },
  histLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  histLink: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.accentSolid },
  histList: { marginTop: theme.space.xs, borderWidth: 1, borderColor: theme.colors.cardBorder, borderRadius: theme.radius.sm },
  histItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs },
  histDate: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, minWidth: theme.sp(9) },
  histTags: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  histGo: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  histEmpty: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, padding: theme.space.sm },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.space.md,
    marginBottom: theme.space.xs,
  },
  chipScroll: { maxHeight: 52 },
  dateChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
    marginRight: 8,
  },
  dateChipOn: { backgroundColor: theme.colors.accentSolid }, // v21：周期域选中=紫实底
  chipText: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft },
  chipTextOn: { color: theme.colors.textWhite, fontWeight: theme.weight.semibold as any },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
    marginRight: 8,
    marginBottom: 8,
  },
  pillOn: { backgroundColor: theme.colors.accentSolid },

  moodChip: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: mm.colors.btnBusyBg,
    marginRight: 8,
    marginBottom: 8,
    minWidth: 52,
  },
  moodChipOn: { backgroundColor: theme.colors.accentSolid },
  moodEmoji: { fontSize: 20, marginBottom: 2 },
  moodLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft },
  moodLabelOn: { color: theme.colors.textWhite, fontWeight: theme.weight.semibold as any },

  symptomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  symptomTile: {
    width: '23%',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    backgroundColor: mm.colors.btnBusyBg,
    marginBottom: 8,
  },
  symptomTileOn: { backgroundColor: theme.colors.accentSolid },
  symptomEmoji: { fontSize: 22, marginBottom: 3 },
  symptomLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft },
  symptomLabelOn: { color: theme.colors.textWhite, fontWeight: theme.weight.semibold as any },

  startToggle: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.md },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.colors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.xs,
  },
  checkboxOn: { backgroundColor: theme.colors.accentSolid },
  checkMark: { color: theme.colors.textWhite, fontSize: 14, fontWeight: theme.weight.bold as any },
  startTextWrap: { flex: 1 },
  startTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  startSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 1 },

  stepperRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.space.md },
  stepperLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, color: theme.colors.accentSolid, fontWeight: theme.weight.bold as any },
  stepValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginHorizontal: 16, minWidth: 48, textAlign: 'center' },

  // v16：保存按钮 = lime→粉 渐变（Touchable 只留圆角+裁切，padding 在渐变层）
  saveBtn: {
    marginTop: theme.space.lg,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  saveBtnGrad: {
    alignItems: 'center',
    paddingVertical: 13,
  },
  saveBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textWhite },
});
