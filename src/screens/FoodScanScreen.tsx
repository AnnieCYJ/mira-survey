import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from '../components/Card';
import Icon from '../components/Icon';
import MiraTag from '../components/MiraTag';
import { ArcGauge } from '../components/ArcGauge';
import DateAnchorPicker from '../components/DateAnchorPicker';
import {
  recognizeMeal, loadFoodLogs, saveFoodLog, deleteFoodLog,
  FOOD_VLM,
  BUILT_IN_FOODS, PORTION_FACTORS, dateKeyOf,
  sumMacros, macroCals,
  type MealItem, type FoodLog, type Macros,
} from '../lib/foodAi';
import { analyzeElements, ELEMENT_META, type ElementKey } from '../lib/mealAnalysis';
import { useRingState } from '../hooks/useRingState';
import { loadLastViewDate, saveLastViewDate } from '../lib/lastViewDate';
import { loadCycleLog } from '../data/cycleLog';
import { phaseOfDay } from '../lib/hormoneTrend';
import { PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';
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
 * FoodScanScreen — 饮食（工具页「营养搭配」卡入口）
 *
 * 版式 = mira-diet-v1.html（Cal AI 框逻辑 · 2 屏）：
 *  · home   「今日记录」：日期导航 → 热量环 hero（还能吃 + 三大营养素 3 列条 + 激素矿物质已补/还缺）
 *           → Mira AI 建议/不建议 → 餐次分组卡（缩略图四角标 + 明细行 + 元素标签）→ 科普 / 拍一餐
 *  · detail 「拍照识别」：取景框（四角角标 + AI 渐变 pill）→ 识别结果卡（大字 kcal + 占预算
 *           + 三大营养素行 + 元素提示）→ 识别明细（行元素标签）→ 确认记录 / 重拍
 *
 * 色彩口径：热量/能量 = honey（蜜）；三大营养素分类编码色 蛋白=蓝 · 碳水=蜜 · 脂肪=粉；
 * AI 徽章 = 紫→蓝渐变；主 CTA = 黄绿→粉渐变。卡底一律白，颜色只上图形。
 * 拍照时绝不 base64:true（大图过桥 OOM），仅在确认调 VLM 时异步转码。
 */

/* ── 三大营养素分类编码色（蛋白=蓝 · 碳水=蜜 · 脂肪=黄绿）──
 *  v18.98 多巴胺配色：与运动页 stat3 同族 tint（skyTint/honeyTint/limeTint），
 *  格底 = 各自 tint，圆点/进度条 = core 色，明快但不刺眼。 */
const MACRO_COLOR: Record<'protein' | 'carbs' | 'fat', { fg: string; deep: string; bg: string; label: string }> = {
  protein: { fg: mm.colors.skyCore, deep: mm.colors.skyDeep, bg: mm.colors.skyTint, label: '蛋白质' },
  carbs: { fg: mm.colors.honeyCore, deep: mm.colors.honeyDeep, bg: mm.colors.honeyTint, label: '碳水' },
  fat: { fg: mm.colors.limeMid, deep: mm.colors.limeDeep, bg: mm.colors.limeTint, label: '脂肪' },
};

/* ── 元素小标签：只列激素相关四项（镁/锌/铁/钙），「有/无」不算克数 ── */
const TAG_KEYS: ElementKey[] = ['mg', 'zn', 'fe', 'ca'];
function elemTags(items: MealItem[]): Array<{ key: ElementKey; label: string; on: boolean }> {
  const res = analyzeElements(items);
  return TAG_KEYS.map((k) => {
    const r = res.find((x) => x.key === k);
    return { key: k, label: ELEMENT_META[k].label, on: Boolean(r?.present) };
  });
}

/** 去掉菜名开头的 emoji（识别/手动菜名都带前缀图标） */
function stripEmoji(name: string): string {
  return name.replace(/^[^\u4e00-\u9fa5A-Za-z0-9·]+/, '').trim();
}

/** 餐次名：按记录时间分早/午/晚/夜 */
function mealNameOf(ts: number): string {
  const h = new Date(ts).getHours();
  if (h < 10) return '早餐';
  if (h < 14) return '午餐';
  if (h < 17) return '下午加餐';
  if (h < 21) return '晚餐';
  return '夜宵';
}

/** 步进器中心文案：「10月2日 · 今天」（SPEC §1） */
function dayLabel(d: Date): string {
  const t = new Date();
  const same = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return `${d.getMonth() + 1}月${d.getDate()}日${same ? ' · 今天' : ''}`;
}
/** 餐次卡标题：「今天」/「10月1日」（SPEC §3.5） */
function dayCardTitle(dateKey: string): string {
  const t = new Date();
  const d = new Date(`${dateKey}T00:00:00`);
  const same = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return same ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;
}
function dateKeyOfFromDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function FoodScanScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const ring = useRingState();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<'ai' | 'manual'>('manual');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [portionIdx, setPortionIdx] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [mode, setMode] = useState<'home' | 'detail'>('home');
  /** 今日记录页选中的日期（YYYY-MM-DD，可左右切最近 14 天） */
  const [selDate, setSelDate] = useState<string>(() => dateKeyOf());

  const todayKey = dateKeyOf();

  const refreshLogs = useCallback(() => setLogs(loadFoodLogs()), []);
  useEffect(() => { refreshLogs(); }, [refreshLogs]);

  /* ★ 记住最后查看的日期：切走/杀进程后再回来仍停在同一天（spec：「历史保留」） */
  useEffect(() => {
    loadLastViewDate('food').then((k) => { if (k) setSelDate(k); }).catch(() => {});
  }, []);

  const onFoodDateChange = useCallback((d: Date) => {
    const k = dateKeyOfFromDate(d);
    setSelDate(k);
    void saveLastViewDate('food', k);
  }, []);

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

  // ★ 内存腾挪：进页挂起端侧大模型并释放，防相机缓冲区分配失败。
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

  /* MIRA AI 区块首行：你处于什么阶段 · 皮质醇怎么样 · 今天状态（有数据才拼，不编） */
  const todayStatusScore = (() => {
    try {
      const v = ring?.statusDaily?.[todayKey];
      return Number.isFinite(v) ? Math.round(Number(v)) : null;
    } catch { return null; }
  })();

  // ★ 从工具页卡点进来：直接拉起相机
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
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要权限', useCamera ? '请在系统设置里允许使用相机' : '请在系统设置里允许访问相册');
        return;
      }
      const options = { quality: 0.6, base64: false, exif: false } as const;
      const res = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPhotoUri(a.uri);
      setItems([]);
      setPicked(new Set());
      setMode('detail');

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

  const onSave = async () => {
    const finalItems = source === 'ai'
      ? items
      : [...picked].map((name) => {
          const f = BUILT_IN_FOODS.find((x) => x.name === name)!;
          return { name: `${f.emoji} ${f.name}`, portion: f.portion, kcal: Math.round(f.kcal * PORTION_FACTORS[portionIdx].factor) };
        });
    if (!finalItems.length) return;
    // 照片持久化：拷进沙盒 document 再入库。**只存文件名**——绝对路径里的容器 UUID
    // 在 iOS 重装/迁移后会变，存了必失效；读取侧（rowToLog.resolvePhotoUri）按当前容器重建。
    let persistUri: string | undefined;
    if (photoUri) {
      try {
        const name = `food_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: photoUri, to: `${FileSystem.documentDirectory}${name}` });
        persistUri = name;
      } catch { persistUri = photoUri; }
    }
    const total = finalItems.reduce((s, it) => s + it.kcal, 0);
    setLogs(saveFoodLog({ dateKey: todayKey, source, items: finalItems, totalKcal: total, photoUri: persistUri }));
    setItems([]);
    setPicked(new Set());
    setPhotoUri(null);
    setMode('home');
  };

  const hasResult = source === 'ai' ? items.length > 0 : picked.size > 0;
  const currentItems: MealItem[] = source === 'ai' ? items : mealItemsForAnalysis;

  /* ── 今日记录页当日数据 ── */
  const dayLogs = useMemo(
    () => logs.filter((l) => l.dateKey === selDate).sort((a, b) => b.ts - a.ts),
    [logs, selDate]
  );
  const dayItems = useMemo(() => dayLogs.flatMap((l) => l.items), [dayLogs]);
  const dayKcal = dayLogs.reduce((s, l) => s + l.totalKcal, 0);
  const dayMacros = useMemo(() => sumMacros(dayItems), [dayItems]);

  return (
    <View style={styles.page}>
      <LinearGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
      {/* 固定列结构：头部 + 内容（自己滚）+ 底栏（钉死屏幕底）。
       *  不再包 ScreenContainer——它自带外层 ScrollView，底栏会被外层滚动拖着走，永远钉不住。 */}
      <View style={[styles.col, { paddingTop: theme.space.screen + insets.top }]}>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{mode === 'home' ? '饮食记录' : '拍照识别'}</Text>
            <Text style={styles.subtitle}>{mode === 'home' ? '拍照记一餐 · 看懂今天的热量' : '对准食物 · 自动识别'}</Text>
          </View>
        </View>

        {mode === 'home' ? (
          <View style={styles.homeStack}>
            <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyScrollContent} showsVerticalScrollIndicator={false} bounces>
              {/* 日期步进器（SPEC §1：复用 DateAnchorPicker，±1 天 / 点中间弹日历 / 不可选未来） */}
              <DateAnchorPicker
                value={new Date(`${selDate}T00:00:00`)}
                onChange={onFoodDateChange}
                range="day"
                formatLabel={dayLabel}
              />

              {/* ① 汇总 + AI 建议合一卡（SPEC §3.1–3.4） */}
              <Card style={[hs.card, { borderRadius: mm.radius.card }]}>
                {/* 卡路里环（居中，SPEC §3.2） */}
                <View style={hs.ringWrap}>
                  <CalorieRing
                    kcal={dayKcal}
                    pct={target.kcal > 0 ? (dayKcal / target.kcal) * 100 : 0}
                    targetKcal={target.kcal}
                  />
                </View>
                {/* 环下行：还剩 X · N 餐（数字来自真实记录，不编） */}
                <Text style={hs.remainText}>
                  {dayLogs.length > 0 ? (
                    <>还剩 <Text style={hs.remainBold}>{Math.max(0, target.kcal - dayKcal)}</Text> · {dayLogs.length} 餐</>
                  ) : (
                    <>还没记录 · 目标 <Text style={hs.remainBold}>{target.kcal}</Text> kcal</>
                  )}
                </Text>

                {/* 三大营养素 3 格（值 = 当日真实克数，SPEC §3.3） */}
                <View style={hs.mmacros}>
                  {(['protein', 'carbs', 'fat'] as const).map((k) => {
                    const goal = k === 'protein' ? target.proteinG : k === 'carbs' ? target.carbsG : target.fatG;
                    const got = dayMacros[k];
                    const pct = goal > 0 ? Math.min(100, Math.round((got / goal) * 100)) : 0;
                    const c = MACRO_COLOR[k];
                    return (
                      <View key={k} style={[hs.mm, { backgroundColor: c.bg }]}>
                        <View style={hs.mmLabel}>
                          <View style={[hs.mmDot, { backgroundColor: c.fg }]} />
                          <Text style={hs.mmLabelText}>{c.label}</Text>
                        </View>
                        <Text style={hs.mmVal}>{Math.round(got)}<Text style={hs.mmUnit}> g</Text></Text>
                        <View style={hs.mmBar}>
                          <View style={[hs.mmBarFill, { width: `${pct}%`, backgroundColor: c.fg }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* 激素相关矿物质 chips：已补（粉底）/ 还差（虚线）（SPEC §3.3，数据 = analyzeElements） */}
                {dayItems.length > 0 ? <MineralChips items={dayItems} /> : null}

                {/* MIRA AI · 今日建议（仅今天）：状态句（阶段·皮质醇·今日状态）→ 推荐多吃 / 少碰。
                 *  v18.99：原来的「推荐多吃/少碰」与 AI 建议行内容重复，合并成一块。 */}
                {selDate === todayKey ? (
                  <View style={hs.aiWrap}>
                    <View style={hs.aiSep} />

                    <View style={hs.conclusion}>
                      <Text style={hs.conclusionTitle}>今天适合稳住能量</Text>
                      <Text style={hs.conclusionSub}>均衡吃、少刺激，给下午和晚上的状态留出余地。</Text>
                    </View>
                    {/* 状态胶囊：你处于 X · 皮质醇 · 今天状态（有数据才出，不编） */}
                    <View style={hs.statusTags}>
                      <View style={[hs.statusPill, { backgroundColor: mm.colors.purpleSoft }]}>
                        <Text style={[hs.statusPillText, { color: mm.colors.purpleDeep }]}>{PHASE_LABEL[phase]}</Text>
                      </View>
                      {(() => {
                        const c = hormoneSnap?.cortisol;
                        if (!c?.ready) return (
                          <View style={[hs.statusPill, { backgroundColor: mm.colors.skySoft }]}>
                            <Text style={[hs.statusPillText, { color: mm.colors.skyDeep }]} numberOfLines={1}>皮质醇待同步</Text>
                          </View>
                        );
                        let bg: string = mm.colors.limeSoft, fg: string = mm.colors.limeDeep, t: string = '皮质醇平稳';
                        if (c.level === 'high') { bg = mm.colors.roseSoft; fg = mm.colors.roseDeep; t = '皮质醇偏高'; }
                        else if (c.level === 'dysregulated') { bg = mm.colors.honeySoft; fg = mm.colors.honeyDeep; t = '皮质醇节律略乱'; }
                        return (
                          <View style={[hs.statusPill, { backgroundColor: bg }]}>
                            <Text style={[hs.statusPillText, { color: fg }]}>{t}</Text>
                          </View>
                        );
                      })()}
                      <View style={[hs.statusPill, { backgroundColor: mm.colors.honeySoft }]}>
                        <Text style={[hs.statusPillText, { color: mm.colors.honeyDeep }]} numberOfLines={1}>今天状态 {todayStatusScore ?? '待同步'}</Text>
                      </View>
                    </View>

                    <View style={hs.adviceGrid}>
                      <View style={[hs.adviceCard, hs.adviceEat]}>
                        <Text style={hs.adviceCardTitle}>✦ 推荐多吃</Text>
                        {target.focus.map((f) => <Text key={f} style={[hs.adviceLine, hs.adviceEatLine]}>{f}</Text>)}
                      </View>
                      <View style={[hs.adviceCard, hs.adviceAvoid]}>
                        <Text style={[hs.adviceCardTitle, hs.adviceAvoidTitle]}>↓ 先少碰</Text>
                        {target.avoid.length > 0 ? target.avoid.map((f) => <Text key={f} style={[hs.adviceLine, hs.adviceAvoidLine]}>{f}</Text>) : <Text style={[hs.adviceLine, hs.adviceAvoidLine]}>减少高糖和过度刺激</Text>}
                      </View>
                    </View>
                  </View>
                ) : null}
              </Card>

              {/* ② 餐次卡「今天」：emoji 格 + 餐名 + kcal（SPEC §3.5） */}
              {dayLogs.length > 0 ? (
                <Card style={[hs.card, { borderRadius: mm.radius.card }]}>
                  <Text style={hs.mealTitle}>{dayCardTitle(selDate)}</Text>
                  {dayLogs.map((l, i) => <MealRow key={l.id} log={l} index={i} onDelete={(id) => setLogs(deleteFoodLog(id))} />)}
                </Card>
              ) : (
                <Card style={[hs.card, { borderRadius: mm.radius.card }]}>
                  <Text style={hs.emptyTitle}>还没有记录</Text>
                  <Text style={hs.emptySub}>点下方「拍一餐」拍下你的饭，热量和营养会自动记到这里。</Text>
                </Card>
              )}

              <View style={{ height: theme.space.lg }} />
            </ScrollView>

            {/* 底部操作栏：贴住屏幕底（外层 paddingBottom 已清 0，这里只补 Home indicator 安全区） */}
            <View style={[styles.scanBtnWrap, { paddingBottom: Math.max(theme.sp(2), Math.round(insets.bottom * 0.4)) }]}>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={hs.sciPill}
                  onPress={() => (navigation as any).navigate('ToolTopic', { topic: 'nutrition' })}
                  accessibilityRole="button"
                  accessibilityLabel="更多科普"
                >
                  <Text style={hs.sciPillText}>科普</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => pickImage(true)}>
                  <LinearGradient
                    colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.scanBtnGrad}
                  >
                    <Text style={styles.scanBtnIco}>📷</Text>
                    <Text style={styles.scanBtnText}>拍一餐</Text>
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

            <ScrollView style={dt.scroll} contentContainerStyle={dt.scrollContent} showsVerticalScrollIndicator={false} bounces>
              {/* 取景框：照片 + 四角角标 + AI pill（识别中盖遮罩） */}
              {photoUri ? (
                <View style={dt.vf}>
                  <Image source={{ uri: photoUri }} style={dt.vfPhoto} resizeMode="cover" />
                  <View style={dt.vfDim} />
                  <View style={[dt.ck, dt.ckTL]} />
                  <View style={[dt.ck, dt.ckTR]} />
                  <View style={[dt.ck, dt.ckBL]} />
                  <View style={[dt.ck, dt.ckBR]} />
                  {scanning ? (
                    <View style={dt.vfScanning}>
                      <ActivityIndicator color={theme.colors.textWhite} />
                      <Text style={dt.vfScanningText}>AI 正在识别餐食…</Text>
                    </View>
                  ) : (
                    <LinearGradient
                      colors={['#9D8AF0', '#7EA6F8']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={dt.aiPill}
                    >
                      <Text style={dt.aiPillText}>✦</Text>
                      <Text style={dt.aiPillText}>
                        {hasResult ? `Mira AI · 已识别 ${currentItems.length} 项` : 'Mira AI · 没认出来，手动选一下'}
                      </Text>
                    </LinearGradient>
                  )}
                </View>
              ) : null}

              {!scanning && hasResult ? (
                <>
                  {/* 识别结果汇总卡 */}
                  <ResultCard items={currentItems} source={source} target={target} />
                  {/* 识别明细 */}
                  <ItemList items={currentItems} photoUri={photoUri} onRemove={(i) => {
                    if (source === 'ai') setItems(items.filter((_, j) => j !== i));
                    else {
                      const name = [...picked][i];
                      const next = new Set(picked);
                      next.delete(name);
                      setPicked(next);
                    }
                  }} />
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
            </ScrollView>

            {/* 底部操作栏：确认记录（渐变）+ 重拍（ghost）——贴底 */}
            {!scanning && hasResult ? (
              <View style={[styles.scanBtnWrap, { paddingBottom: Math.max(theme.sp(2), Math.round(insets.bottom * 0.4)) }]}>
                <View style={dt.ctaRow}>
                  <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => { void onSave(); }}>
                    <LinearGradient
                      colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={styles.scanBtnGrad}
                    >
                      <Icon name="check" size={18} color={mm.colors.btnTextOnGrad} strokeWidth={2} />
                      <Text style={styles.scanBtnText}>确认记录</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={dt.retakePill}
                    onPress={() => { setItems([]); setPicked(new Set()); pickImage(true); }}
                    accessibilityRole="button" accessibilityLabel="重拍"
                  >
                    <Text style={dt.retakeText}>重拍</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

/* ══════════════════ 通用小组件 ══════════════════ */

/** 卡路里弧（★ 2026-10-11 改：整圈圆环 → 宽扁大弧，样式对齐身体年龄）：弧 = 已摄入/目标，轨道 emptyFill。
 *  内容不变：中央仍是「kcal / target kcal」。 */
function CalorieRing({ kcal, pct, targetKcal }: {
  kcal: number; pct: number; targetKcal: number;
}) {
  return (
    <ArcGauge pct={pct} color={mm.colors.honeyCore}>
      <View style={{ alignItems: 'center' }}>
        <Text style={mc.ringKcal}>{kcal.toLocaleString('en-US')}</Text>
        <Text style={mc.ringTarget}>/ {targetKcal} kcal</Text>
      </View>
    </ArcGauge>
  );
}

/** 元素小标签行（镁·有 锌·无…，8.5px 圆角小方块） */
function ElemTags({ items }: { items: MealItem[] }) {
  const tags = elemTags(items);
  return (
    <View style={et.wrap}>
      {tags.map((t) => (
        <View key={t.key} style={[et.tag, t.on ? et.tagOn : et.tagNo]}>
          <Text style={[et.tagText, { color: t.on ? mm.colors.limeDeep : mm.colors.inkFaint }]}>
            {t.label}·{t.on ? '有' : '无'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 激素相关矿物质 chips（SPEC §3.3）：已补 = roseTint 底 roseDeep 字；还差 = 透明底虚线框。
 *  数据 = analyzeElements 逐元素判断（镁/锌/铁/钙），不写死。 */
function MineralChips({ items }: { items: MealItem[] }) {
  const res = analyzeElements(items);
  const chips = TAG_KEYS.map((k) => {
    const r = res.find((x) => x.key === k);
    return { label: ELEMENT_META[k].label, on: Boolean(r?.present) };
  });
  return (
    <View style={ms2.wrap}>
      {chips.map((c) => (c.on ? (
        <View key={c.label} style={[ms2.chip, { backgroundColor: mm.colors.roseTint }]}>
          <Text style={[ms2.chipText, { color: mm.colors.roseDeep }]}>{c.label} · 已补</Text>
        </View>
      ) : (
        <View key={c.label} style={ms2.chipOff}>
          <Text style={ms2.chipOffText}>{c.label} · 还差</Text>
        </View>
      )))}
    </View>
  );
}

/** 餐次行（SPEC §3.5）：tint 色 emoji 格 + 餐名 · 首菜 + 右侧 kcal + 删除 */
const MEAL_TILE_BG = [mm.colors.honeyTint, mm.colors.limeTint, mm.colors.skyTint];
/** 菜名开头的 emoji（识别/手动菜名都带前缀图标） */
function leadingEmoji(name: string): string {
  const m = name.match(/^([^\u4e00-\u9fa5A-Za-z0-9·]+)/);
  return m ? m[1] : '🍽';
}
function MealRow({ log, onDelete, index }: { log: FoodLog; onDelete: (id: string) => void; index: number }) {
  const first = log.items[0] ? stripEmoji(log.items[0].name).slice(0, 8) : '记录';
  const emoji = log.items[0] ? leadingEmoji(log.items[0].name) : '🍽';
  // 当餐三大营养素（克）与热量占比
  const macros = sumMacros(log.items);
  const c = macroCals(macros);
  const totalC = Math.max(1, c.total);
  const pPct = Math.round((c.protein / totalC) * 100);
  const cPct = Math.round((c.carbs / totalC) * 100);
  const fPct = Math.max(0, 100 - pPct - cPct);
  // 当餐元素（钙 / 铁 / 锌 / 硒）
  const els = analyzeElements(log.items);
  const elOn = (k: ElementKey) => Boolean(els.find((e) => e.key === k)?.present);
  return (
    <View style={mr.row}>
      <View style={mr.top}>
        {log.photoUri ? (
          <Image source={{ uri: log.photoUri }} style={mr.tilePhoto} resizeMode="cover" />
        ) : (
          <View style={[mr.tile, { backgroundColor: MEAL_TILE_BG[index % MEAL_TILE_BG.length] }]}>
            <Text style={mr.tileEmoji}>{emoji}</Text>
          </View>
        )}
        <View style={mr.main}>
          <Text style={mr.name} numberOfLines={1}>{mealNameOf(log.ts)} · {first}</Text>
          <Text style={mr.kcal}>{log.totalKcal} kcal</Text>
        </View>
        <TouchableOpacity onPress={() => onDelete(log.id)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name="close" size={15} color={theme.colors.textSub} />
        </TouchableOpacity>
      </View>

      {c.total > 1 ? (
        <>
          {/* 宏量比例条（按热量占比）+ 图例 */}
          <View style={mr.macroBar}>
            <View style={[mr.seg, { flex: pPct, backgroundColor: MACRO_COLOR.protein.fg }]} />
            <View style={[mr.seg, { flex: cPct, backgroundColor: MACRO_COLOR.carbs.fg }]} />
            <View style={[mr.seg, { flex: fPct, backgroundColor: MACRO_COLOR.fat.fg }]} />
          </View>
          <View style={mr.legend}>
            <View style={mr.legItem}><View style={[mr.legDot, { backgroundColor: MACRO_COLOR.protein.fg }]} /><Text style={mr.legText}>蛋白 {Math.round(macros.protein)}g · {pPct}%</Text></View>
            <View style={mr.legItem}><View style={[mr.legDot, { backgroundColor: MACRO_COLOR.carbs.fg }]} /><Text style={mr.legText}>碳水 {Math.round(macros.carbs)}g · {cPct}%</Text></View>
            <View style={mr.legItem}><View style={[mr.legDot, { backgroundColor: MACRO_COLOR.fat.fg }]} /><Text style={mr.legText}>脂肪 {Math.round(macros.fat)}g · {fPct}%</Text></View>
          </View>
        </>
      ) : null}

      {/* 元素标签：钙 / 铁 / 锌 / 硒（有 / 少） */}
      <View style={mr.elRow}>
        {(['ca', 'fe', 'zn', 'se'] as ElementKey[]).map((k) => {
          const on = elOn(k);
          return (
            <View key={k} style={[mr.elTag, on ? mr.elOn : mr.elOff]}>
              <Text style={[mr.elText, { color: on ? mm.colors.limeDeep : mm.colors.inkFaint }]}>{ELEMENT_META[k].label}·{on ? '有' : '少'}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** 识别结果汇总卡（HTML ① 的 card + kcalrow + macros + ehint） */
function ResultCard({ items, source, target }: {
  items: MealItem[];
  source: 'ai' | 'manual';
  target: PhaseNutritionTarget;
}) {
  const mealKcal = items.reduce((s, it) => s + it.kcal, 0);
  const macros = sumMacros(items);
  const c = macroCals(macros);
  const pct = target.kcal > 0 ? Math.min(100, Math.round((mealKcal / target.kcal) * 100)) : 0;
  const total = Math.max(1, c.total);
  const pPct = Math.round((c.protein / total) * 100);
  const cPct = Math.round((c.carbs / total) * 100);
  const fPct = Math.max(0, 100 - pPct - cPct);
  const hasMacro = c.total > 0;

  const wordFor = (k: 'protein' | 'carbs' | 'fat', v: number) =>
    k === 'protein' ? (v >= 25 ? '充足' : v >= 15 ? '适中' : '偏少')
      : k === 'carbs' ? (v >= 50 ? '主要来源' : v >= 35 ? '适中' : '偏少')
        : (v >= 40 ? '偏重' : v >= 25 ? '适中' : '清爽');

  const res = analyzeElements(items);
  const rich = TAG_KEYS.map((k) => res.find((x) => x.key === k)).filter((r) => r && r.present).map((r) => r!.label).slice(0, 2);
  const lack = TAG_KEYS.map((k) => res.find((x) => x.key === k)).filter((r) => r && !r.present).map((r) => r!.label).slice(0, 2);

  const rows: Array<{ k: 'protein' | 'carbs' | 'fat'; pct: number }> = [
    { k: 'protein', pct: pPct },
    { k: 'carbs', pct: cPct },
    { k: 'fat', pct: fPct },
  ];

  return (
    <Card style={[rc.card, { borderRadius: mm.radius.card }]}>
      <View style={rc.head}>
        <View style={{ flex: 1 }}>
          <Text style={rc.title}>识别结果</Text>
          <Text style={rc.sub}>共 {items.length} 项菜品 · {source === 'ai' ? 'AI 按图估算' : '手动选择'}</Text>
        </View>
        <View style={rc.conf}>
          <Text style={rc.confText}>{source === 'ai' ? 'AI 识别' : '手动选择'}</Text>
        </View>
      </View>

      <View style={rc.kcalRow}>
        <Text style={rc.kcal}>{mealKcal}</Text>
        <Text style={rc.kcalUnit}>kcal</Text>
        <View style={rc.share}>
          <Text style={rc.shareLabel}>占今日预算</Text>
          <Text style={rc.shareVal}>{pct}%</Text>
        </View>
      </View>

      <View style={rc.macros}>
        {rows.map(({ k, pct: v }) => {
          const cfg = MACRO_COLOR[k];
          return (
            <View key={k} style={rc.mrow}>
              <View style={[rc.md, { backgroundColor: cfg.fg }]} />
              <Text style={rc.ml}>{cfg.label}</Text>
              <View style={rc.track}>
                <View style={[rc.fill, { width: `${hasMacro ? v : 0}%`, backgroundColor: cfg.fg }]} />
              </View>
              <Text style={[rc.mv, { color: cfg.deep }]}>
                {hasMacro ? `${wordFor(k, v)} · ${v}%` : '暂无 · 0%'}
              </Text>
            </View>
          );
        })}
      </View>

      {(rich.length > 0 || lack.length > 0) ? (
        <Text style={rc.ehint}>
          {rich.length > 0 ? `本餐已补 ${rich.join(' · ')}` : ''}
          {rich.length > 0 && lack.length > 0 ? ' ｜ ' : ''}
          {lack.length > 0 ? `还缺 ${lack.join(' · ')}` : ''}
          {' —— AI 按食材估算，无需手动输入'}
        </Text>
      ) : null}
    </Card>
  );
}

/** 识别明细列表：每行 缩略图（emoji 占位）+ 名/份量 + 元素标签 + kcal + 删除 */
function ItemList({ items, photoUri, onRemove }: {
  items: MealItem[];
  photoUri: string | null;
  onRemove: (index: number) => void;
}) {
  return (
    <View style={il.wrap}>
      {items.map((it, i) => {
        const name = stripEmoji(it.name);
        return (
          <View key={`${it.name}-${i}`} style={il.row}>
            <View style={il.thumb}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={il.thumbImg} resizeMode="cover" />
              ) : (
                <View style={[il.thumbImg, { backgroundColor: mm.colors.honeySoft, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={il.thumbInitial}>{name.charAt(0)}</Text>
                </View>
              )}
            </View>
            <View style={il.box}>
              <Text style={il.name} numberOfLines={1}>{name}</Text>
              <Text style={il.portion}>{it.portion}</Text>
              <ElemTags items={[it]} />
            </View>
            <Text style={il.kcal}>{it.kcal}<Text style={il.kcalUnit}> kcal</Text></Text>
            <TouchableOpacity onPress={() => onRemove(i)} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <Icon name="close" size={15} color={theme.colors.textSub} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

/* ══════════════════ 样式 ══════════════════ */

/* ── home（今日记录）── */
const hs = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  /* 环居中（SPEC §3.2） */
  ringWrap: { alignItems: 'center', marginTop: theme.sp(2) },
  /* 环下行「还剩 X · N 餐」 */
  remainText: { fontSize: theme.fontSize.xs, fontWeight: '600' as never, color: mm.colors.inkFaint, textAlign: 'center', marginTop: theme.sp(1.5) },
  remainBold: { fontSize: theme.fontSize.sm, fontWeight: '700' as never, color: mm.colors.inkSoft },
  mmacros: {
    flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(3.5),
  },
  /* macro 三格：surface-2 底（inline 设置），值 18/600 + 单位（SPEC §3.3） */
  mm: { flex: 1, minWidth: 0, borderRadius: theme.sp(3), paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(2.25) },
  mmLabel: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.25) },
  mmDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.75) },
  mmLabelText: { fontSize: theme.fontSize.micro, fontWeight: '700' as never, color: mm.colors.inkSoft },
  mmVal: { fontSize: theme.fs(18), fontWeight: '600' as never, color: mm.colors.ink, marginTop: theme.sp(0.75) },
  mmUnit: { fontSize: theme.fontSize.micro, fontWeight: '700' as never, color: mm.colors.inkFaint },
  mmBar: { height: theme.sp(1), borderRadius: theme.radius.pill, backgroundColor: 'rgba(31,29,26,0.08)', marginTop: theme.sp(1), overflow: 'hidden' },
  mmBarFill: { height: '100%', borderRadius: theme.radius.pill },
  /* 推荐多吃 / 先少碰（v18.99 起并入 MIRA AI 区块；v19.1 标签按语义换色：推荐多吃=lime / 先少碰=honey） */
  focusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5) },
  focusChip: {
    backgroundColor: mm.colors.limeTint, borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(2.75), paddingVertical: theme.sp(1.25),
  },
  focusChipText: { fontSize: theme.fontSize.xs, fontWeight: '700' as never, color: mm.colors.limeDeep },
  avoidList: { fontSize: theme.fontSize.sm, fontWeight: '600' as never, color: mm.colors.honeyDeep, lineHeight: theme.fs(19) },
  /* MIRA AI 区块（v18.99：状态句 + 推荐多吃/少碰，合并去重；v19.0 标签化） */
  aiWrap: { marginTop: theme.sp(2) },
  aiSep: { borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.08)', marginBottom: theme.sp(3) },
  aiTag: { marginBottom: theme.sp(3) },
  conclusion: { marginBottom: theme.sp(2), alignItems: 'flex-start' },
  conclusionTitle: { fontSize: theme.fontSize.card, lineHeight: theme.fs(24), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  conclusionSub: { marginTop: theme.sp(1), fontSize: theme.fontSize.xs, lineHeight: theme.fs(17), color: mm.colors.inkFaint },
  /* 状态胶囊行：你处于 X · 皮质醇 · 今天状态 */
  statusTags: { flexDirection: 'row', flexWrap: 'nowrap', gap: theme.sp(1) },
  statusPill: { flex: 1, minWidth: 0, borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(1.25), alignItems: 'center' },
  statusPillText: { fontSize: theme.fontSize.xs, fontWeight: '700' as never, lineHeight: theme.fs(17), textAlign: 'center' },
  focusTag: { marginTop: theme.sp(3), marginBottom: theme.sp(1.5) },
  avoidTag: { marginTop: theme.sp(3), marginBottom: theme.sp(1.5) },
  adviceGrid: { flexDirection: 'row', gap: theme.sp(2), marginTop: theme.sp(3) },
  adviceCard: { flex: 1, minWidth: 0, borderRadius: theme.sp(4), padding: theme.sp(3) },
  adviceEat: { backgroundColor: mm.colors.limeTint },
  adviceAvoid: { backgroundColor: mm.colors.honeyTint },
  adviceCardTitle: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.bold as never, color: mm.colors.limeDeep, marginBottom: theme.sp(1.5) },
  adviceAvoidTitle: { color: mm.colors.honeyDeep },
  adviceLine: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(18), color: mm.colors.inkSoft, marginTop: theme.sp(1) },
  // ★ 对比度修复：adviceEat(limeTint)/adviceAvoid(honeyTint) 浅底上 inkSoft(白 78%) 不可读 → 按卡分色
  adviceEatLine: { color: mm.colors.limeDeep },
  adviceAvoidLine: { color: mm.colors.honeyDeep },
  /* 餐次卡（SPEC §3.5） */
  mealTitle: { fontSize: theme.fontSize.body, fontWeight: '700' as never, color: mm.colors.ink, marginBottom: theme.sp(1) },
  emptyTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  emptySub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: theme.fs(17) },
  sciPill: {
    width: theme.sp(18.5), height: theme.sp(12), borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  sciPillText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint },
});

/* ── 元素小标签 ── */
const et = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: theme.sp(1), marginTop: theme.sp(1) },
  tag: { borderRadius: 5, paddingHorizontal: theme.sp(1.25), paddingVertical: 1.5 },
  tagOn: { backgroundColor: mm.colors.limeSoft },
  tagNo: { backgroundColor: 'rgba(31,29,26,0.05)' },
  tagText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.bold as never, lineHeight: theme.fs(15) },
});

/* ── 识别结果卡 ── */
const rc = StyleSheet.create({
  card: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium as never, color: mm.colors.inkFaint, marginTop: 2 },
  conf: {
    backgroundColor: mm.colors.limeSoft, borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(0.875),
  },
  confText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.bold as never, color: mm.colors.limeDeep },
  kcalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.sp(2), marginTop: theme.sp(2) },
  kcal: { fontSize: theme.fs(38), fontWeight: theme.weight.medium as never, color: mm.colors.honeyDeep, lineHeight: theme.fs(40), letterSpacing: -0.5 },
  kcalUnit: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.honeyDeep, paddingBottom: theme.sp(0.75) },
  share: { marginLeft: 'auto', alignItems: 'flex-end', paddingBottom: theme.sp(0.5) },
  shareLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, fontWeight: theme.weight.medium as never },
  shareVal: { fontSize: theme.fontSize.body, fontWeight: theme.weight.bold as never, color: mm.colors.ink, lineHeight: theme.fs(17) },
  macros: { marginTop: theme.sp(3.5), paddingTop: theme.sp(3), borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.07)', gap: theme.sp(2.5) },
  mrow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5) },
  md: { width: theme.sp(2.25), height: theme.sp(2.25), borderRadius: 3 },
  ml: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft, width: theme.sp(11.5) },
  track: { flex: 1, height: theme.sp(2), borderRadius: theme.radius.pill, backgroundColor: 'rgba(31,29,26,0.07)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: theme.radius.pill },
  mv: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.bold as never, width: theme.sp(17.5), textAlign: 'right' },
  ehint: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft, lineHeight: theme.fs(16), marginTop: theme.sp(3), paddingTop: theme.sp(2.5), borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.07)' },
});

/* ── 识别明细 ── */
const il = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: mm.radius.card, paddingHorizontal: theme.space.cardPadCompact, paddingVertical: theme.sp(1),
    marginBottom: theme.space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.75), paddingVertical: theme.sp(2.75), borderBottomWidth: 1, borderBottomColor: 'rgba(31,29,26,0.06)' },
  thumb: { width: theme.sp(9.5), height: theme.sp(9.5), borderRadius: mm.radius.iconSqMd, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(31,29,26,0.08)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbInitial: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },
  box: { flex: 1, minWidth: 0 },
  name: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, lineHeight: theme.fs(16) },
  portion: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium as never, color: mm.colors.inkFaint, marginTop: 1 },
  kcal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.bold as never, color: mm.colors.honeyDeep },
  kcalUnit: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium as never, color: mm.colors.inkFaint },
});

/* ── detail（拍照识别）── */
const dt = StyleSheet.create({
  scroll: { flex: 1, width: '100%' },
  scrollContent: { paddingBottom: theme.sp(4) },
  vf: {
    width: '100%', aspectRatio: 1024 / 921, borderRadius: mm.radius.card, overflow: 'hidden',
    backgroundColor: mm.colors.emptyFill, marginBottom: theme.space.md,
  },
  vfPhoto: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  vfDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(31,29,26,0.06)' },
  ck: { position: 'absolute', width: theme.sp(6), height: theme.sp(6), borderColor: theme.colors.textWhite },
  ckTL: { left: theme.sp(3), top: theme.sp(3), borderTopWidth: 2.6, borderLeftWidth: 2.6, borderTopLeftRadius: 8 },
  ckTR: { right: theme.sp(3), top: theme.sp(3), borderTopWidth: 2.6, borderRightWidth: 2.6, borderTopRightRadius: 8 },
  ckBL: { left: theme.sp(3), bottom: theme.sp(3), borderBottomWidth: 2.6, borderLeftWidth: 2.6, borderBottomLeftRadius: 8 },
  ckBR: { right: theme.sp(3), bottom: theme.sp(3), borderBottomWidth: 2.6, borderRightWidth: 2.6, borderBottomRightRadius: 8 },
  vfScanning: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(31,29,26,0.35)', gap: theme.sp(2) },
  vfScanningText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: theme.colors.textWhite },
  aiPill: {
    position: 'absolute', left: theme.sp(3), bottom: theme.sp(3),
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
    borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(1.5),
  },
  aiPillText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.bold as never, color: theme.colors.textWhite },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5), marginTop: theme.sp(1) },
  retakePill: {
    height: theme.sp(12), paddingHorizontal: theme.sp(3.25), borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  retakeText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint },
});

/* ── 页面骨架（沿用）── */
const styles = StyleSheet.create({
  page: { flex: 1 },
  /** 固定列：头部 + 内容 + 底栏，整列占满屏幕（paddingTop 运行时补 insets.top） */
  col: {
    flex: 1, width: '100%',
    paddingHorizontal: theme.space.screen,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.space.lg },
  back: {
    width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as never, color: theme.colors.textTitle },
  headText: { flex: 1 },
  subtitle: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  backDetail: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5), marginBottom: theme.space.md },
  backDetailText: { fontSize: theme.fontSize.sm, color: mm.colors.ink, fontWeight: theme.weight.medium as never },
  resultCard: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
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
  bodyScroll: { flex: 1, width: '100%' },
  bodyScrollContent: { paddingBottom: theme.sp(4) },
  homeStack: { flex: 1, width: '100%', position: 'relative' },
  scanBtnWrap: {
    paddingHorizontal: theme.sp(2), paddingTop: theme.sp(2),
    backgroundColor: theme.colors.bgBottom,
  },
  scanBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.sp(2),
    paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill,
  },
  scanBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.btnTextOnGrad },
  scanBtnIco: { fontSize: theme.fs(16) },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5) },
});

/* ── 环中心文字 ── */
const mc = StyleSheet.create({
  ringKcal: { fontSize: theme.fs(30), fontWeight: '500' as never, color: mm.colors.ink, lineHeight: theme.fs(32), letterSpacing: -0.3 },
  ringTarget: { fontSize: theme.fontSize.sm, fontWeight: '700' as never, color: mm.colors.inkFaint, marginTop: 3 },
});

/* ── 矿物质 chips（SPEC §3.3：已补 roseTint / 还差 虚线）── */
const ms2 = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginTop: theme.sp(3) },
  chip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(2.75), paddingVertical: theme.sp(1.25),
  },
  chipText: { fontSize: theme.fontSize.xs, fontWeight: '700' as never },
  chipOff: {
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: 'rgba(31,29,26,0.14)', borderStyle: 'dashed',
    paddingHorizontal: theme.sp(2.75), paddingVertical: theme.sp(1.25),
  },
  chipOffText: { fontSize: theme.fontSize.xs, fontWeight: '600' as never, color: mm.colors.inkFaint },
});

/* ── 餐次行（SPEC §3.5：左侧拍照图/emoji 格 + 餐名 + kcal + 宏量比例 + 元素标签）── */
const mr = StyleSheet.create({
  row: {
    paddingVertical: theme.sp(2.75),
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(31,29,26,0.06)',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5) },
  tile: {
    width: theme.sp(10), height: theme.sp(10), borderRadius: theme.sp(3),
    alignItems: 'center', justifyContent: 'center',
  },
  tilePhoto: {
    width: theme.sp(10), height: theme.sp(10), borderRadius: theme.sp(3),
    borderWidth: 1, borderColor: 'rgba(31,29,26,0.08)',
  },
  tileEmoji: { fontSize: theme.fs(18) },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: theme.fontSize.body, fontWeight: '700' as never, color: mm.colors.ink },
  kcal: { fontSize: theme.fontSize.xs, fontWeight: '600' as never, color: mm.colors.inkFaint, marginTop: 2 },
  /* 宏量比例条（按热量占比） */
  macroBar: {
    flexDirection: 'row', gap: 2, height: theme.sp(1.5), borderRadius: theme.radius.pill,
    overflow: 'hidden', marginTop: theme.sp(2.25), backgroundColor: 'rgba(31,29,26,0.06)',
  },
  seg: { height: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2), marginTop: theme.sp(1.5) },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  legDot: { width: theme.sp(1.75), height: theme.sp(1.75), borderRadius: theme.radius.pill },
  legText: { fontSize: theme.fontSize.micro, fontWeight: '600' as never, color: mm.colors.inkSoft },
  /* 元素标签：钙 / 铁 / 锌 / 硒（有 = 黄绿底深字，少 = 浅灰） */
  elRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginTop: theme.sp(2) },
  elTag: { borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1) },
  elOn: { backgroundColor: mm.colors.limeSoft },
  elOff: { backgroundColor: 'rgba(31,29,26,0.05)' },
  elText: { fontSize: theme.fontSize.micro, fontWeight: '700' as never, lineHeight: theme.fs(15) },
});
