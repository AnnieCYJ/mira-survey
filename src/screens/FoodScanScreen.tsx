import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
  BUILT_IN_FOODS, PORTION_FACTORS, dateKeyOf, sumKcal,
  type MealItem, type FoodLog,
} from '../lib/foodAi';
import { releaseLlama, warmupModel, suspendModel, resumeModel } from '../ai/model';
import { NUTRITION_ARTICLES } from '../lib/nutritionArticles';

/**
 * FoodScanScreen — 饮食识别（工具页「饮食识别」卡入口）
 *
 * 流程：拍照/选图 → VLM 识别（foodAi.recognizeMeal）
 *   ├─ 识别成功 → 结果卡（菜品/份量/热量，可逐项删）→ 保存记录
 *   └─ 未配置 VLM / 识别失败 → 兜底：内置常见菜品快速多选 + 份量系数 → 本地估算热量 → 保存
 * 记录：expo-sqlite food_logs 表，页底「今日已记录」实时刷新。
 *
 * 性能铁律：拍照时**绝不**要 base64:true——整张照片转 base64 过桥会卡死 JS 线程、
 * 大图直接 OOM 闪退。只在确认要调 VLM 时才用 expo-file-system 异步读文件转码。
 */
export default function FoodScanScreen() {
  const navigation = useNavigation();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<'ai' | 'manual'>('manual');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [portionIdx, setPortionIdx] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logs, setLogs] = useState<FoodLog[]>([]);

  const todayKey = dateKeyOf();
  const todayKcal = sumKcal(logs, todayKey);

  const refreshLogs = useCallback(() => setLogs(loadFoodLogs()), []);
  useEffect(() => { refreshLogs(); }, [refreshLogs]);

  // ★ 内存腾挪：进页挂起端侧大模型并释放（~1GB，use_mlock 时更是 wired 钉死），
  //   防后台洞察任务重载；离页恢复+预热。真机 Jetsam 铁证：模型常驻时全机 free 仅 27MB，
  //   相机缓冲区分配失败 → launchCameraAsync 永不返回（点拍照没反应的直接原因）。
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

  // ★ 从工具页卡点进来：直接拉起相机（card 直达，免再点一次「拍照识别」）
  const route = useRoute<RouteProp<{ FoodScan: { autoCamera?: boolean } | undefined }, 'FoodScan'>>();
  const autoFired = React.useRef(false);
  useEffect(() => {
    if (route.params?.autoCamera && !autoFired.current) {
      autoFired.current = true;
      pickImage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.autoCamera]);

  const totalKcal = items.reduce((s, it) => s + it.kcal, 0);
  const manualKcal = [...picked].reduce((s, name) => {
    const f = BUILT_IN_FOODS.find((x) => x.name === name);
    return s + (f ? Math.round(f.kcal * PORTION_FACTORS[portionIdx].factor) : 0);
  }, 0);

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
    setLogs(saveFoodLog({ dateKey: todayKey, source, items: finalItems, totalKcal: total }));
    setItems([]);
    setPicked(new Set());
    setPhotoUri(null);
  };

  const hasResult = source === 'ai' ? items.length > 0 : picked.size > 0;

  return (
    <View style={styles.page}>
      <LinearGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer compactTop topFadeColor={theme.colors.textWhite}>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.7} style={styles.back} onPress={() => navigation.goBack()}>
            <Icon name="chevronLeft" size={22} color={mm.colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>饮食识别</Text>
        </View>
        <Text style={styles.subtitle}>拍下餐食，自动识别菜品与热量并记录</Text>

        {/* 拍照区 */}
        <Card style={styles.scanCard}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Icon name="food" size={theme.fs(34)} color={mm.colors.honeyDeep} strokeWidth={1.6} />
              <Text style={styles.photoHint}>还没有照片</Text>
            </View>
          )}
          <View style={styles.scanBtnRow}>
            {/* 渐变按钮铁律：圆角+padding 全在渐变层，Touchable 只留裁切 */}
            <TouchableOpacity activeOpacity={0.85} style={styles.scanBtnWrap} onPress={() => pickImage(true)}>
              <LinearGradient
                colors={[mm.colors.honeyCore, mm.colors.honeyDeep]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.scanBtnGrad}
              >
                <Icon name="food" size={16} color={theme.colors.textWhite} strokeWidth={2} />
                <Text style={styles.scanBtnText}>拍照识别</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={styles.albumBtn} onPress={() => pickImage(false)}>
              <Text style={styles.albumBtnText}>从相册选</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* 识别中 */}
        {scanning ? (
          <Card style={styles.resultCard}>
            <ActivityIndicator color={mm.colors.honeyDeep} />
            <Text style={styles.scanningText}>AI 正在识别餐食…</Text>
          </Card>
        ) : null}

        {/* AI 识别结果 */}
        {!scanning && source === 'ai' && items.length > 0 ? (
          <Card style={styles.resultCard}>
            <View style={styles.resultHead}>
              <Text style={styles.resultTitle}>识别结果</Text>
              <TouchableOpacity onPress={() => { setItems([]); setSource('manual'); }}>
                <Text style={styles.rematch}>重新识别</Text>
              </TouchableOpacity>
            </View>
            {items.map((it, i) => (
              <View key={`${it.name}-${i}`} style={styles.itemRow}>
                <Text style={styles.itemName}>{it.name}</Text>
                <Text style={styles.itemPortion}>{it.portion}</Text>
                <Text style={styles.itemKcal}>{it.kcal} kcal</Text>
                <TouchableOpacity onPress={() => setItems(items.filter((_, j) => j !== i))}>
                  <Icon name="close" size={16} color={theme.colors.textSub} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>合计</Text>
              <Text style={styles.totalVal}>{totalKcal} kcal</Text>
            </View>
            <TouchableOpacity activeOpacity={0.85} style={styles.saveBtnWrap} onPress={onSave}>
              <LinearGradient
                colors={[mm.colors.honeyCore, mm.colors.honeyDeep]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.scanBtnGrad}
              >
                <Text style={styles.scanBtnText}>保存记录</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Card>
        ) : null}

        {/* 手动兜底：内置菜品快速选择（可收起） */}
        {!scanning && (source === 'manual' || (source === 'ai' && items.length === 0)) ? (
          <Card style={styles.resultCard}>
            <TouchableOpacity
              style={styles.pickerHead}
              activeOpacity={0.7}
              onPress={() => setPickerOpen((v) => !v)}
            >
              <Text style={styles.resultTitle}>
                {photoUri ? '没认出来？选一下你吃了什么' : '选择菜品（可多选）'}
              </Text>
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
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>估算热量</Text>
              <Text style={styles.totalVal}>{manualKcal} kcal</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.saveBtnWrap, !hasResult && { opacity: 0.4 }]}
              disabled={!hasResult}
              onPress={onSave}
            >
              <LinearGradient
                colors={[mm.colors.honeyCore, mm.colors.honeyDeep]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.scanBtnGrad}
              >
                <Text style={styles.scanBtnText}>保存记录</Text>
              </LinearGradient>
            </TouchableOpacity>
              </>
            ) : null}
          </Card>
        ) : null}

        {/* 今日已记录 */}
        <Card style={styles.logCard}>
          <View style={styles.resultHead}>
            <Text style={styles.resultTitle}>今日已记录</Text>
            <Text style={styles.todayTotal}>{todayKcal} kcal</Text>
          </View>
          {logs.filter((l) => l.dateKey === todayKey).length === 0 ? (
            <Text style={styles.emptyLog}>还没有记录，拍一张餐食照片试试</Text>
          ) : (
            logs.filter((l) => l.dateKey === todayKey).map((l) => (
              <View key={l.id} style={styles.logRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logName} numberOfLines={1}>
                    {l.items.map((it) => it.name).join(' + ')}
                  </Text>
                  <Text style={styles.logTime}>
                    {new Date(l.ts).getHours()}:{String(new Date(l.ts).getMinutes()).padStart(2, '0')} · {l.source === 'ai' ? 'AI 识别' : '手动'}
                  </Text>
                </View>
                <Text style={styles.logKcal}>{l.totalKcal} kcal</Text>
                <TouchableOpacity onPress={() => setLogs(deleteFoodLog(l.id))}>
                  <Icon name="close" size={15} color={theme.colors.textSub} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>

        {/* 荷尔蒙×营养科普（v18.85）：静态内容，与珠雨/拍照流程无状态耦合 */}
        <NutritionSection />

        <ScrollView style={{ height: 0 }} />
      </ScreenContainer>
    </View>
  );
}

/* ── 荷尔蒙×营养 · 图文版块（v18.85）────────────────────────
 * 与知识科普系列同构的文章卡列表（无 hero，落地页底部版块）。
 * 数据全部来自 nutritionArticles.ts 静态文章库，无假数据。
 * 模块级组件 + 模块级样式：拍照/识别/记录的 state 变化不会重建本版块。
 */
function NutritionSection() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  return (
    <>
      <View style={ns.secHead}>
        <Text style={ns.secTitle}>荷尔蒙和营养</Text>
        <Text style={ns.secCount}>{NUTRITION_ARTICLES.length} 篇</Text>
      </View>
      {NUTRITION_ARTICLES.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={ns.articleCard}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'nutrition' })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={ns.thumb} resizeMode="cover" />
          <View style={ns.articleBody}>
            <Text style={ns.articleEyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={ns.articleTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={ns.articleLink}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

const ns = StyleSheet.create({
  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  secTitle: {
    fontSize: theme.fs(15),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  secCount: {
    fontSize: theme.fs(12),
    color: mm.colors.inkFaint,
  },
  articleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(2.5),
  },
  thumb: {
    width: theme.sp(14),
    height: theme.sp(14),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  articleBody: {
    flex: 1,
    marginLeft: theme.sp(3),
  },
  articleEyebrow: {
    fontSize: theme.fs(10.5),
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(0.5),
  },
  articleTitle: {
    fontSize: theme.fs(14),
    lineHeight: theme.fs(19),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  articleLink: {
    fontSize: theme.fs(11.5),
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
  },
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
  subtitle: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, marginBottom: theme.space.md },
  scanCard: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  photo: { width: '100%', height: 280, borderRadius: theme.radius.sm, backgroundColor: mm.colors.emptyFill },
  photoPlaceholder: {
    height: 240, borderRadius: theme.radius.sm, backgroundColor: mm.colors.emptyFill,
    alignItems: 'center', justifyContent: 'center', gap: theme.sp(1),
  },
  photoHint: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  scanBtnRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginTop: theme.space.md },
  scanBtnWrap: { borderRadius: theme.radius.pill, overflow: 'hidden' },
  scanBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
    paddingHorizontal: theme.space.md, paddingVertical: theme.sp(2),
  },
  scanBtnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: theme.colors.textWhite },
  albumBtn: {
    paddingHorizontal: theme.space.md, paddingVertical: theme.sp(2), borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.textWhite,
  },
  albumBtnText: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, fontWeight: theme.weight.medium as never },
  resultCard: { padding: theme.space.cardPadCompact, marginBottom: theme.space.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) },
  resultTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1) },
  pickerCount: { fontSize: theme.fontSize.xs, color: mm.colors.honeyDeep, fontWeight: theme.weight.medium as never, marginLeft: 'auto' },
  chev: { transform: [{ rotate: '0deg' }] },
  chevOpen: { transform: [{ rotate: '90deg' }] },
  rematch: { fontSize: theme.fontSize.xs, color: theme.colors.accentText, fontWeight: theme.weight.medium as never },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
    paddingVertical: theme.sp(1.5), borderBottomWidth: 1, borderBottomColor: 'rgba(31,29,26,0.06)',
  },
  itemName: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.textBody },
  itemPortion: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  itemKcal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.honeyDeep },
  totalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.sp(1.5), paddingTop: theme.sp(1.5),
    borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.09)',
  },
  totalLabel: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft },
  totalVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },
  saveBtnWrap: { alignSelf: 'flex-start', borderRadius: theme.radius.pill, overflow: 'hidden', marginTop: theme.space.md },
  scanningText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1) },
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
  logCard: { padding: theme.space.cardPadCompact, marginBottom: theme.space.xl },
  todayTotal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },
  logRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2),
    paddingVertical: theme.sp(1.5), borderBottomWidth: 1, borderBottomColor: 'rgba(31,29,26,0.06)',
  },
  logName: { fontSize: theme.fontSize.sm, color: theme.colors.textBody },
  logTime: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  logKcal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.honeyDeep },
  emptyLog: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, paddingVertical: theme.sp(2) },
});
