import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import Icon from '../components/Icon';
import {
  recognizeMeal, loadFoodLogs, saveFoodLog, deleteFoodLog,
  FOOD_VLM,
  BUILT_IN_FOODS, PORTION_FACTORS, dateKeyOf,
  sumMacros, macroCals,
  type MealItem, type FoodLog, type Macros,
} from '../lib/foodAi';
import { analyzeElements, analyzeHormoneImpact, ELEMENT_META, type ElementKey } from '../lib/mealAnalysis';
import { useRingState } from '../hooks/useRingState';
import { loadCycleLog } from '../data/cycleLog';
import { phaseOfDay } from '../lib/hormoneTrend';
import { PHASE_LABEL, PHASE_COLOR, type PhaseKey } from '../lib/phaseColors';
import {
  cycleNutritionTarget,
  type PhaseNutritionTarget,
} from '../lib/cycleNutrition';
import {
  buildHormoneNutritionSnapshot,
  type HormoneNutritionSnapshot,
} from '../lib/hormoneNutrition';
import type { CycleLog } from '../lib/cycleMath';
import { releaseLlama, warmupModel, suspendModel, resumeModel } from '../ai/model';

/**
 * FoodScanScreen — 饮食（工具页「饮食识别」卡入口）
 *
 * 双视图流：
 *  · home    ：状态卡（当前阶段 / 皮质醇状态 + 多吃少吃）→ 美食相册 → 常驻「饮食识别」按钮
 *  · detail  ：拍照落地页（照片 → 识别结果「这一餐」分析 → 元素分析 → 这一餐对激素的影响 + 下一餐建议）
 *
 * 拍照时**绝不** base64:true（整张照片转 base64 过桥会卡死 JS、大图 OOM）。仅在确认调 VLM 时异步读文件转码。
 */
export default function FoodScanScreen() {
  const navigation = useNavigation();
  const ring = useRingState();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<'ai' | 'manual'>('manual');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [portionIdx, setPortionIdx] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  // home = 状态卡 + 相册 + 常驻「饮食识别」；detail = 拍照落地页（照片 + 识别分析 + 元素 + 激素影响）
  const [mode, setMode] = useState<'home' | 'detail'>('home');

  const todayKey = dateKeyOf();

  const refreshLogs = useCallback(() => setLogs(loadFoodLogs()), []);
  useEffect(() => { refreshLogs(); }, [refreshLogs]);

  // 周期阶段：用于阶段化热量/营养目标与建议
  const [cycleLog, setCycleLog] = useState<CycleLog | null>(null);
  useEffect(() => { void loadCycleLog().then((l) => setCycleLog(l)); }, []);
  const phase: PhaseKey = phaseOfDay(cycleLog, new Date(), ring);
  const target: PhaseNutritionTarget = cycleNutritionTarget(phase);

  // 激素 × 饮食营养：把皮质醇 / 雌激素 / 孕激素的真实推算状态接到饮食建议
  const [hormoneSnap, setHormoneSnap] = useState<HormoneNutritionSnapshot | null>(null);
  useEffect(() => {
    if (!cycleLog) return;
    try {
      setHormoneSnap(buildHormoneNutritionSnapshot(cycleLog, ring));
    } catch {
      /* 异常时保持 null，UI 走空态 */
    }
  }, [cycleLog, ring]);

  // ★ 内存腾挪：进页挂起端侧大模型并释放（~1GB，use_mlock 时更是 wired 钉死），防相机缓冲区分配失败。
  useEffect(() => {
    suspendModel();
    releaseLlama().then(
      () => console.log('[FoodScan] 端侧模型已释放，为相机腾内存'),
      () => {}
    );
    return () => {
      resumeModel();
      warmupModel();
    };
  }, []);

  // ★ 从工具页卡点进来：直接拉起相机（card 直达，免再点一次）
  const route = useRoute<RouteProp<{ FoodScan: { autoCamera?: boolean } | undefined }, 'FoodScan'>>();
  const autoFired = React.useRef(false);
  useEffect(() => {
    if (route.params?.autoCamera && !autoFired.current) {
      autoFired.current = true;
      pickImage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.autoCamera]);

  const mealItemsForAnalysis: MealItem[] = source === 'ai'
    ? items
    : [...picked].map((name) => {
        const f = BUILT_IN_FOODS.find((x) => x.name === name)!;
        const k = PORTION_FACTORS[portionIdx].factor;
        return {
          name: `${f.emoji} ${f.name}`,
          portion: f.portion,
          kcal: Math.round(f.kcal * k),
          protein: f.protein * k,
          carbs: f.carbs * k,
          fat: f.fat * k,
        };
      });

  const pickImage = useCallback(async (useCamera: boolean) => {
    try {
      console.log('[FoodScan] tap:', useCamera ? '相机' : '相册');
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('[FoodScan] 权限:', perm.granted, perm.status);
      if (!perm.granted) {
        Alert.alert('需要权限', useCamera ? '请在系统设置里允许使用相机' : '请在系统设置里允许访问相册');
        return;
      }
      const options = { quality: 0.6, base64: false, exif: false } as const;
      const res = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      console.log('[FoodScan] picker 返回:', res.canceled ? '已取消' : res.assets?.[0]?.uri ?? '无资源');
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPhotoUri(a.uri);
      setItems([]);
      setPicked(new Set());
      setMode('detail');

      // 仅在 VLM 已配置时才识别（异步读文件转 base64，不阻塞拍照返回）
      const vlmReady = Boolean(FOOD_VLM.endpoint && FOOD_VLM.apiKey && FOOD_VLM.model);
      if (!vlmReady) {
        setSource('manual');
        return;
      }
      setScanning(true);
      let aiItems: MealItem[] | null = null;
      try {
        const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
        aiItems = await recognizeMeal(b64);
      } catch { aiItems = null; }
      setScanning(false);
      if (aiItems) {
        setItems(aiItems);
        setSource('ai');
      } else {
        setSource('manual');
      }
    } catch (e) {
      setScanning(false);
      console.warn('[FoodScan] 拍照/读图失败:', e);
      Alert.alert('出错了', '拍照或读取照片失败，请重试');
    }
  }, []);

  const togglePick = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const onSave = () => {
    const finalItems = source === 'ai'
      ? items
      : [...picked].map((name) => {
          const f = BUILT_IN_FOODS.find((x) => x.name === name)!;
          return { name: `${f.emoji} ${f.name}`, portion: f.portion, kcal: Math.round(f.kcal * PORTION_FACTORS[portionIdx].factor) };
        });
    if (!finalItems.length) return;
    const total = finalItems.reduce((s, it) => s + it.kcal, 0);
    setLogs(saveFoodLog({ dateKey: todayKey, source, items: finalItems, totalKcal: total, photoUri: photoUri ?? undefined }));
    setItems([]);
    setPicked(new Set());
    setPhotoUri(null);
    setMode('home');
  };

  const hasResult = source === 'ai' ? items.length > 0 : picked.size > 0;
  const currentItems: MealItem[] = source === 'ai' ? items : mealItemsForAnalysis;

  return (
    <View style={styles.page}>
      <LinearGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer compactTop topFadeColor={theme.colors.textWhite} contentStyle={{ flexGrow: 1 }} stretchInner>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
            <Icon name="chevronLeft" size={22} color={mm.colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>饮食</Text>
        </View>

        {mode === 'home' ? (
          <View style={styles.homeStack}>
            {/* 滚动区：状态卡 + 美食相册；CTA 绝对贴底，内容再短也钉在屏幕最下方 */}
            <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyScrollContent} showsVerticalScrollIndicator={false} bounces>
              <Text style={styles.homeSub}>你现在的阶段，和今天适合吃什么</Text>
              <FoodStatusCard phase={phase} target={target} hormoneSnap={hormoneSnap} />
              <FoodGallery logs={logs} onDelete={(id) => setLogs(deleteFoodLog(id))} />
              <View style={{ height: theme.space.lg }} />
            </ScrollView>

            {/* 固定底部操作行：左「更多科普」(→ 营养科普合集) · 右「饮食识别」(主操作) */}
            <View style={styles.scanBtnWrap}>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.moreSciBtn}
                  onPress={() => (navigation as any).navigate('ToolTopic', { topic: 'nutrition' })}
                  accessibilityRole="button"
                  accessibilityLabel="更多科普"
                >
                  <Text style={styles.moreSciText}>更多科普</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.85} style={{ flex: 1 }} onPress={() => pickImage(true)}>
                  <LinearGradient
                    colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.scanBtnGrad}
                  >
                    <Text style={styles.scanBtnIco}>🍽</Text>
                    <Text style={styles.scanBtnText}>饮食识别</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* 拍照落地页 */}
            <TouchableOpacity activeOpacity={0.7} style={styles.backDetail} onPress={() => setMode('home')}>
              <Icon name="chevronLeft" size={20} color={mm.colors.ink} />
              <Text style={styles.backDetailText}>返回</Text>
            </TouchableOpacity>

            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
            ) : null}

            {scanning ? (
              <Card style={styles.resultCard}>
                <ActivityIndicator color={mm.colors.honeyDeep} />
                <Text style={styles.scanningText}>AI 正在识别餐食…</Text>
              </Card>
            ) : null}

            {!scanning && hasResult ? (
              <>
                <MealCard
                  items={currentItems}
                  source={source}
                  target={target}
                  onRemove={(i) => {
                    if (source === 'ai') setItems(items.filter((_, j) => j !== i));
                    else {
                      const name = [...picked][i];
                      const next = new Set(picked);
                      next.delete(name);
                      setPicked(next);
                    }
                  }}
                  onRematch={() => { setItems([]); setSource('manual'); }}
                  onSave={onSave}
                />
                <MealElementAnalysis items={currentItems} />
                <MealHormoneImpact items={currentItems} hormoneSnap={hormoneSnap} />
              </>
            ) : null}

            {!scanning && !hasResult ? (
              <Card style={styles.resultCard}>
                <TouchableOpacity style={styles.pickerHead} activeOpacity={0.7} onPress={() => setPickerOpen((v) => !v)}>
                  <Text style={styles.resultTitle}>{photoUri ? '没认出来？选一下你吃了什么' : '选择菜品（可多选）'}</Text>
                  {picked.size > 0 ? <Text style={styles.pickerCount}>已选 {picked.size}</Text> : null}
                  <View style={[styles.chev, pickerOpen && styles.chevOpen]}>
                    <Icon name="chevronRight" size={16} color={theme.colors.textSub} />
                  </View>
                </TouchableOpacity>
                {pickerOpen ? (
                  <>
                    <View style={styles.chipWrap}>
                      {BUILT_IN_FOODS.map((f) => {
                        const on = picked.has(f.name);
                        return (
                          <TouchableOpacity
                            key={f.name}
                            onPress={() => togglePick(f.name)}
                            style={[styles.chip, on && { backgroundColor: mm.colors.honeySoft, borderColor: mm.colors.honeyDeep }]}
                          >
                            <Text style={[styles.chipText, on && { color: mm.colors.honeyDeep, fontWeight: theme.weight.semibold }]}>
                              {f.emoji} {f.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.portionRow}>
                      {PORTION_FACTORS.map((p, i) => (
                        <TouchableOpacity
                          key={p.label}
                          onPress={() => setPortionIdx(i)}
                          style={[styles.portionChip, i === portionIdx && styles.portionChipOn]}
                        >
                          <Text style={[styles.portionText, i === portionIdx && styles.portionTextOn]}>{p.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </ScreenContainer>
    </View>
  );
}

/* ── 宏量营养素可视化（参考 Cal AI：每道菜拆热量+三大宏量，当日汇总进度）── */
const MACRO: Record<'protein' | 'carbs' | 'fat', { fg: string; label: string }> = {
  protein: { fg: mm.chipBg.cyan.fg, label: '蛋白质' },
  carbs: { fg: mm.chipBg.lime.fg, label: '碳水' },
  fat: { fg: mm.chipBg.pink.fg, label: '脂肪' },
};

/** 宏量堆叠条 + 图例（克数 + 占热量比例）。无数据时显示占位 */
function MacroBar({ macros }: { macros: Macros }) {
  const c = macroCals(macros);
  if (c.total <= 0) {
    return <View style={mb.bar}><View style={[mb.seg, { flex: 1, backgroundColor: mm.colors.emptyFill }]} /></View>;
  }
  const segs: Array<{ key: keyof typeof MACRO; val: number }> = [
    { key: 'protein', val: c.protein },
    { key: 'carbs', val: c.carbs },
    { key: 'fat', val: c.fat },
  ];
  return (
    <View style={{ marginTop: theme.sp(2) }}>
      <View style={mb.bar}>
        {segs.map((s) => (
          <View
            key={s.key}
            style={[mb.seg, { backgroundColor: MACRO[s.key].fg, width: `${(s.val / c.total) * 100}%` }]}
          />
        ))}
      </View>
      <View style={mb.legend}>
        {segs.map((s) => (
          <View key={s.key} style={mb.legendItem}>
            <View style={[mb.legendDot, { backgroundColor: MACRO[s.key].fg }]} />
            <Text style={mb.legendLabel}>{MACRO[s.key].label}</Text>
            <Text style={mb.legendVal}>{Math.round(macros[s.key])}g · {Math.round((s.val / c.total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 卡里路环形图（Cal AI 风格）：圆环进度 = 这一餐热量 / 今日（周期阶段）目标，正中显示大数字 kcal。 */
function CalorieRing({ kcal, pct, size = 136 }: { kcal: number; pct: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circ * (1 - clamped / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cx} r={r} stroke={mm.colors.honeySoft} strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx} cy={cx} r={r}
          stroke={mm.colors.honeyCore} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={mc.ringKcal}>{kcal}</Text>
        <Text style={mc.ringUnit}>kcal</Text>
      </View>
    </View>
  );
}

/** 这一餐单餐视图（Cal AI 参考）：卡里路环形图 + 宏量分段条 + 三格宏量 + 菜品清单 + 营养解读。
 * 颜色全走 app token（honey = 能量/代谢），仅做事实描述与温和建议，不做评分/诊断。 */
function MealCard({ items, target, source, onRemove, onRematch, onSave }: {
  items: MealItem[];
  target: PhaseNutritionTarget;
  source: 'ai' | 'manual';
  onRemove: (index: number) => void;
  onRematch?: () => void;
  onSave: () => void;
}) {
  const mealKcal = items.reduce((s, it) => s + it.kcal, 0);
  const macros = sumMacros(items);
  const c = macroCals(macros);
  const pct = target.kcal > 0 ? Math.round((mealKcal / target.kcal) * 100) : 0;
  const total = Math.max(1, c.total);
  const pPct = Math.round((c.protein / total) * 100);
  const cPct = Math.round((c.carbs / total) * 100);
  const fPct = Math.max(0, 100 - pPct - cPct);
  const hasMacro = c.total > 0;

  const lines: string[] = [];
  lines.push(
    pct >= 50 ? `这一餐约占今日目标的 ${pct}%，是一餐较扎实的摄入。`
      : pct >= 30 ? `这一餐约占今日目标的 ${pct}%，分量适中。`
      : `这一餐约占今日目标的 ${pct}%。`
  );
  if (hasMacro) {
    lines.push(
      pPct >= 30 ? `蛋白质供能约 ${pPct}%，本餐蛋白质来源较充足。`
        : pPct < 15 ? `蛋白质供能约 ${pPct}%，可搭配蛋奶豆或瘦肉。`
        : `蛋白质供能约 ${pPct}%。`
    );
    lines.push(
      cPct >= 55 ? `碳水供能约 ${cPct}%，是这餐的主要能量来源。`
        : cPct < 40 ? `碳水供能约 ${cPct}%，主食偏少。`
        : `碳水供能约 ${cPct}%。`
    );
    lines.push(
      fPct >= 40 ? `脂肪供能约 ${fPct}%，油星略重，下次可少些。`
        : fPct <= 20 ? `脂肪供能约 ${fPct}%，整体较清爽。`
        : `脂肪供能约 ${fPct}%。`
    );
  }

  return (
    <Card style={mc.card}>
      <View style={mc.head}>
        <Text style={mc.title}>这一餐</Text>
        <View style={mc.headRight}>
          <View style={mc.tag}><Text style={mc.tagText}>{source === 'ai' ? 'AI 识别' : '手动选择'}</Text></View>
          {onRematch ? (
            <TouchableOpacity onPress={onRematch}><Text style={mc.rematch}>重新识别</Text></TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={mc.ringWrap}>
        <CalorieRing kcal={mealKcal} pct={pct} />
      </View>

      {hasMacro ? (
        <>
          <MacroBar macros={macros} />
          <View style={mc.tiles}>
            {(['protein', 'carbs', 'fat'] as const).map((k) => (
              <View key={k} style={mc.tile}>
                <View style={[mc.tileDot, { backgroundColor: MACRO[k].fg }]} />
                <Text style={mc.tileVal}>{Math.round(macros[k])}g</Text>
                <Text style={mc.tileName}>{MACRO[k].label}</Text>
                <Text style={mc.tilePct}>{Math.round((c[k] / total) * 100)}%</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={mc.note}>本餐已记录热量，但宏量数据不足，暂无法拆解三大营养素供能。</Text>
      )}

      {/* 菜品清单（可逐项删除） */}
      <View style={mc.foodList}>
        {items.map((it, i) => (
          <View key={`${it.name}-${i}`} style={mc.foodRow}>
            <View style={mc.thumb}><Text style={mc.thumbText}>{it.name.trim().charAt(0)}</Text></View>
            <View style={mc.foodMain}>
              <Text style={mc.foodName} numberOfLines={1}>{it.name}</Text>
              <Text style={mc.foodPortion}>{it.portion}</Text>
            </View>
            <Text style={mc.foodKcal}>{it.kcal} kcal</Text>
            <TouchableOpacity onPress={() => onRemove(i)} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <Icon name="close" size={16} color={theme.colors.textSub} />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* 营养解读 */}
      {hasMacro ? (
        <View style={mc.insight}>
          {lines.map((t, i) => (
            <View key={i} style={mc.insightRow}>
              <View style={mc.insightDot} />
              <Text style={mc.insightText}>{t}</Text>
            </View>
          ))}
          <Text style={mc.note}>以上为图像 / 选择估算，仅供记录参考，不作营养诊断。</Text>
        </View>
      ) : null}

      <TouchableOpacity activeOpacity={0.85} style={mc.saveWrap} onPress={onSave}>
        <LinearGradient
          colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.scanBtnGrad}
        >
          <Icon name="check" size={18} color={mm.colors.btnTextOnGrad} strokeWidth={2} />
          <Text style={styles.scanBtnText}>保存记录</Text>
        </LinearGradient>
      </TouchableOpacity>
    </Card>
  );
}

/**
 * 首页状态卡：当前阶段 + 激素状态（皮质醇 / 孕激素 / 雌激素）→ 一句状态，
 * 再给出「多吃 / 少吃」的温和建议。口径：只描述状态 + 温和建议，不评分、不诊断。
 */
function FoodStatusCard({ phase, target, hormoneSnap }: {
  phase: PhaseKey;
  target: PhaseNutritionTarget;
  hormoneSnap: HormoneNutritionSnapshot | null;
}) {
  let statusLine = '激素数据积累中，先按阶段给参考';
  let statusColor: string = theme.colors.textSub;
  if (hormoneSnap) {
    const c = hormoneSnap.cortisol;
    if (c.ready && c.level !== 'normal') {
      statusLine = `皮质醇${c.label} · 今天饮食宜清淡`;
      statusColor = theme.colors.trendDown;
    } else if (hormoneSnap.progesterone.ready && hormoneSnap.progesterone.status === 'insufficient') {
      statusLine = '孕激素偏弱 · 可留意镁与 B6';
      statusColor = theme.colors.trendDown;
    } else if (hormoneSnap.estrogen.ready && hormoneSnap.estrogen.trend === 'rising') {
      statusLine = '雌激素上行 · 状态不错';
      statusColor = mm.chipBg.lime.fg;
    } else if (c.ready) {
      statusLine = '皮质醇平稳 · 状态不错';
      statusColor = mm.chipBg.lime.fg;
    }
  }

  const eatMore = target.focus;
  const eatLess = [...target.avoid];
  if (hormoneSnap?.cortisol?.ready && hormoneSnap.cortisol.level !== 'normal') {
    eatLess.push('咖啡因（咖啡·浓茶·可乐）', '高糖（甜点·含糖饮料）');
  }

  return (
    <Card style={st.card}>
      <View style={st.phaseRow}>
        <View style={[st.phaseDot, { backgroundColor: PHASE_COLOR[phase] }]} />
        <Text style={st.phaseLabel}>{PHASE_LABEL[phase]}</Text>
        <Text style={st.phaseTag}>阶段营养</Text>
      </View>
      <Text style={[st.statusLine, { color: statusColor }]}>{statusLine}</Text>

      <View style={st.suggestBlock}>
        <Text style={st.suggestHead}>多吃</Text>
        <View style={st.chipRow}>
          {eatMore.map((f, i) => (
            <View key={`m${i}`} style={[st.chip, { backgroundColor: mm.chipBg.lime.fg + '1A' }]}>
              <Text style={[st.chipText, { color: mm.chipBg.lime.fg }]}>↑ {f}</Text>
            </View>
          ))}
        </View>
      </View>
      {eatLess.length > 0 ? (
        <View style={st.suggestBlock}>
          <Text style={st.suggestHead}>少吃</Text>
          <View style={st.chipRow}>
            {eatLess.map((a, i) => (
              <View key={`l${i}`} style={[st.chip, { backgroundColor: theme.colors.trendDown + '1A' }]}>
                <Text style={[st.chipText, { color: theme.colors.trendDown }]}>↓ {a}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * 美食相册：按日期倒序分组，每组显示日期 + 当日总 kcal + 餐食照片网格；
 * 无照片时用首字占位。点删除可移除该条记录。呼应 Mira「看见自己」叙事。
 */
function FoodGallery({ logs, onDelete }: { logs: FoodLog[]; onDelete: (id: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, FoodLog[]>();
    logs.forEach((l) => {
      const arr = map.get(l.dateKey) ?? [];
      arr.push(l);
      map.set(l.dateKey, arr);
    });
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [logs]);

  if (groups.length === 0) {
    return (
      <Card style={gl.card}>
        <Text style={gl.empty}>还没有记录</Text>
        <Text style={gl.emptySub}>点下方「饮食识别」拍下你的饭，这里会按日期帮你收好。</Text>
      </Card>
    );
  }

  return (
    <View style={gl.wrap}>
      {groups.map(([dateKey, group]) => {
        const d = new Date(`${dateKey}T00:00:00`);
        const label = `${d.getMonth() + 1}月${d.getDate()}日`;
        const kcal = group.reduce((s, l) => s + l.totalKcal, 0);
        return (
          <View key={dateKey} style={gl.group}>
            <View style={gl.groupHead}>
              <Text style={gl.groupDate}>{label}</Text>
              <Text style={gl.groupKcal}>{kcal} kcal</Text>
            </View>
            <View style={gl.grid}>
              {group.map((l) => (
                <View key={l.id} style={gl.tile}>
                  {l.photoUri ? (
                    <Image source={{ uri: l.photoUri }} style={gl.tileImg} resizeMode="cover" />
                  ) : (
                    <View style={gl.tilePlaceholder}>
                      <Text style={gl.tileInitial}>{l.items[0]?.name?.trim().charAt(0) ?? '🍽'}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={gl.tileDel}
                    onPress={() => onDelete(l.id)}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <Icon name="close" size={13} color={theme.colors.textWhite} />
                  </TouchableOpacity>
                  <View style={gl.tileKcal}><Text style={gl.tileKcalText}>{l.totalKcal}</Text></View>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 这一餐的元素分析：优先用识别模型返回的元素估算，无则退回菜名关键词兜底。 */
function MealElementAnalysis({ items }: { items: MealItem[] }) {
  const results = analyzeElements(items);
  const rich = results.filter((r) => r.present);
  const lack = results.filter((r) => !r.present);
  const foodsShort = (key: ElementKey) => ELEMENT_META[key].foods.split(' / ').slice(0, 2).join('·');
  return (
    <Card style={el.card}>
      <View style={el.head}>
        <Text style={el.title}>这餐的元素</Text>
        <View style={el.tag}><Text style={el.tagText}>估算</Text></View>
      </View>
      {rich.length > 0 ? (
        <View style={el.chipRow}>
          {rich.map((r) => (
            <View key={r.key} style={[el.chip, { backgroundColor: mm.chipBg.lime.fg + '1A' }]}>
              <View style={[el.dot, { backgroundColor: mm.chipBg.lime.fg }]} />
              <Text style={[el.chipText, { color: mm.chipBg.lime.fg }]}>
                {r.mg ? `富含 ${r.label}（${foodsShort(r.key)}）≈${r.mg}${ELEMENT_META[r.key].unit}` : `富含 ${r.label}（${foodsShort(r.key)}）`}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={el.note}>暂未识别到明显富含激素相关元素的来源。</Text>
      )}
      {lack.length > 0 ? (
        <View style={el.lackRow}>
          <Text style={el.lackLabel}>可留意补充</Text>
          <Text style={el.lackText}>{lack.map((r) => `${r.label}（${foodsShort(r.key)}）`).join('  ')}</Text>
        </View>
      ) : null}
      <Text style={el.note}>元素含量由识别模型按菜品估算（叶酸为微克），非精确检测，仅供参考。</Text>
    </Card>
  );
}

/** 这一餐对激素的影响：结合当餐宏量 + 元素 + 当前激素推算快照，给温和影响描述 + 下一餐建议。 */
function MealHormoneImpact({ items, hormoneSnap }: { items: MealItem[]; hormoneSnap: HormoneNutritionSnapshot | null }) {
  const r = analyzeHormoneImpact(items, hormoneSnap);
  return (
    <Card style={hi.card}>
      <View style={hi.head}>
        <Text style={hi.title}>这餐对激素的影响</Text>
        <View style={hi.tag}><Text style={hi.tagText}>估算</Text></View>
      </View>
      {r.impacts.length > 0 ? (
        <View style={hi.lines}>
          {r.impacts.map((t, i) => (
            <View key={i} style={hi.lineRow}>
              <View style={hi.dot} />
              <Text style={hi.lineText}>{t}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={hi.note}>记录更多菜品后，这里会给出这餐对激素的影响参考。</Text>
      )}
      {r.nextTip ? <Text style={hi.nextTip}>下一餐 · {r.nextTip}</Text> : null}
      <Text style={hi.note}>以上为基于菜品的估算，非诊断，不替代专业建议。</Text>
    </Card>
  );
}

const st = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1.5) },
  phaseDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(2.5) },
  phaseLabel: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  phaseTag: { marginLeft: 'auto', fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.medium as never },
  statusLine: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, marginBottom: theme.sp(2) },
  suggestBlock: { marginTop: theme.sp(1) },
  suggestHead: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, fontWeight: theme.weight.semibold as never, marginBottom: theme.sp(1) },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.75) },
  chip: { paddingHorizontal: theme.sp(2.75), paddingVertical: theme.sp(1.5), borderRadius: theme.radius.pill },
  chipText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never },
});

const gl = StyleSheet.create({
  wrap: { marginBottom: theme.space.md },
  card: { padding: theme.space.cardPadCompact },
  empty: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  emptySub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: theme.fontSize.sm + 5 },
  group: { marginBottom: theme.space.md },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  groupDate: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  groupKcal: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5) },
  tile: { width: '31%', aspectRatio: 1, borderRadius: theme.radius.sm, overflow: 'hidden', backgroundColor: mm.colors.emptyFill },
  tileImg: { width: '100%', height: '100%' },
  tilePlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: mm.colors.honeySoft },
  tileInitial: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },
  tileDel: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(31,29,26,0.55)', alignItems: 'center', justifyContent: 'center' },
  tileKcal: { position: 'absolute', left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(31,29,26,0.5)', paddingVertical: 2 },
  tileKcalText: { textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textWhite, fontWeight: theme.weight.medium as never },
});

const el = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  tag: { paddingHorizontal: theme.sp(1.5), paddingVertical: 3, borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg },
  tagText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.medium as never },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1) },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: theme.sp(1.5), paddingVertical: 5, borderRadius: theme.radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never },
  lackRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginTop: theme.sp(1.5) },
  lackLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  lackText: { flex: 1, fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1.5), lineHeight: theme.fontSize.micro + 4 },
});

const hi = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  tag: { paddingHorizontal: theme.sp(1.5), paddingVertical: 3, borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg },
  tagText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.medium as never },
  lines: { gap: theme.sp(1) },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(1.5) },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: mm.colors.honeyDeep, marginTop: 6 },
  lineText: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, lineHeight: theme.fontSize.sm + 5 },
  nextTip: { fontSize: theme.fontSize.sm, color: mm.colors.honeyDeep, fontWeight: theme.weight.medium as never, marginTop: theme.sp(2) },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.fontSize.micro + 4 },
});

const mb = StyleSheet.create({
  bar: { flexDirection: 'row', height: theme.sp(2.5), borderRadius: theme.radius.pill, overflow: 'hidden', backgroundColor: mm.colors.emptyFill },
  seg: { height: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2), marginTop: theme.sp(1.5) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legendVal: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as never, color: mm.colors.ink },
});

const mc = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  tag: { paddingHorizontal: theme.sp(1.5), paddingVertical: 3, borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg },
  tagText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.medium as never },
  rematch: { fontSize: theme.fontSize.xs, color: theme.colors.accentText, fontWeight: theme.weight.medium as never },
  ringWrap: { alignItems: 'center', marginVertical: theme.sp(1.5) },
  ringKcal: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep, lineHeight: theme.fontSize.h1 + 2 },
  ringUnit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 2 },
  tiles: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(2.5), marginBottom: theme.sp(1) },
  tile: { flex: 1, alignItems: 'center', backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm, paddingVertical: theme.sp(2) },
  tileDot: { width: 7, height: 7, borderRadius: 3.5, marginBottom: 4 },
  tileVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  tileName: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 1 },
  tilePct: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginTop: 1 },
  foodList: { marginTop: theme.sp(3), borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.08)', paddingTop: theme.sp(2) },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), paddingVertical: theme.sp(1.5) },
  thumb: { width: theme.sp(8), height: theme.sp(8), borderRadius: theme.radius.sm, backgroundColor: mm.colors.honeySoft, alignItems: 'center', justifyContent: 'center' },
  thumbText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },
  foodMain: { flex: 1, marginLeft: theme.sp(1) },
  foodName: { fontSize: theme.fontSize.sm, color: theme.colors.textBody },
  foodPortion: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 1 },
  foodKcal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.honeyDeep },
  insight: { marginTop: theme.sp(2.5), borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.08)', paddingTop: theme.sp(2) },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(1.5), marginBottom: theme.sp(1) },
  insightDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: mm.colors.honeyDeep, marginTop: 6 },
  insightText: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, lineHeight: theme.fontSize.sm + 5 },
  saveWrap: { alignSelf: 'stretch', borderRadius: theme.radius.pill, overflow: 'hidden', marginTop: theme.space.md },
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.fontSize.micro + 4 },
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.sp(1) },
  back: {
    width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as never, color: mm.colors.ink },
  homeSub: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, marginBottom: theme.space.md },
  backDetail: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5), marginBottom: theme.space.md },
  backDetailText: { fontSize: theme.fontSize.sm, color: mm.colors.ink, fontWeight: theme.weight.medium as never },
  photo: { width: '100%', height: 280, borderRadius: theme.radius.sm, backgroundColor: mm.colors.emptyFill, marginBottom: theme.space.md },
  resultCard: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) },
  resultTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1) },
  pickerCount: { fontSize: theme.fontSize.xs, color: mm.colors.honeyDeep, fontWeight: theme.weight.medium as never, marginLeft: 'auto' },
  chev: { transform: [{ rotate: '0deg' }] },
  chevOpen: { transform: [{ rotate: '90deg' }] },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginTop: theme.sp(1) },
  chip: {
    paddingHorizontal: theme.space.md, paddingVertical: theme.sp(1.5), borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.cardBg,
  },
  chipText: { fontSize: theme.fontSize.xs, color: theme.colors.textBody },
  portionRow: { flexDirection: 'row', gap: theme.sp(1.5), marginTop: theme.space.md },
  portionChip: {
    paddingHorizontal: theme.space.md, paddingVertical: theme.sp(1), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
  },
  portionChipOn: { backgroundColor: mm.colors.honeySoft, borderWidth: 1, borderColor: mm.colors.honeyDeep },
  portionText: { fontSize: theme.fontSize.xs, color: theme.colors.textBody },
  portionTextOn: { color: mm.colors.honeyDeep, fontWeight: theme.weight.semibold as never },
  scanningText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1) },
  bodyScroll: { flex: 1, width: '100%' },
  bodyScrollContent: { paddingBottom: theme.sp(22) },
  homeStack: { flex: 1, width: '100%', position: 'relative' },
  scanBtnWrap: {
    position: 'absolute', left: 0, right: 0, bottom: theme.sp(2), paddingHorizontal: theme.sp(2),
  },
  scanBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.sp(2),
    paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill,
  },
  scanBtnText: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.btnTextOnGrad },
  scanBtnIco: { fontSize: theme.fs(18) },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  moreSciBtn: {
    paddingHorizontal: theme.sp(5), paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  moreSciText: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.chipBg.lav.fg },
});
