import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import Icon from '../components/Icon';
import {
  recognizeMeal, loadFoodLogs, saveFoodLog, deleteFoodLog,
  BUILT_IN_FOODS, PORTION_FACTORS, dateKeyOf, sumKcal,
  type MealItem, type FoodLog,
} from '../lib/foodAi';

/**
 * FoodScanScreen — 饮食识别（工具页「饮食识别」卡入口）
 *
 * 流程：拍照/选图 → VLM 识别（foodAi.recognizeMeal）
 *   ├─ 识别成功 → 结果卡（菜品/份量/热量，可逐项删）→ 保存记录
 *   └─ 未配置 VLM / 识别失败 → 兜底：内置常见菜品快速多选 + 份量系数 → 本地估算热量 → 保存
 * 记录：expo-sqlite food_logs 表，页底「今日已记录」实时刷新。
 */
export default function FoodScanScreen() {
  const navigation = useNavigation();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<'ai' | 'manual'>('manual');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [portionIdx, setPortionIdx] = useState(1);
  const [logs, setLogs] = useState<FoodLog[]>([]);

  const todayKey = dateKeyOf();
  const todayKcal = sumKcal(logs, todayKey);

  const refreshLogs = useCallback(() => setLogs(loadFoodLogs()), []);
  useEffect(() => { refreshLogs(); }, [refreshLogs]);

  const totalKcal = items.reduce((s, it) => s + it.kcal, 0);
  const manualKcal = [...picked].reduce((s, name) => {
    const f = BUILT_IN_FOODS.find((x) => x.name === name);
    return s + (f ? Math.round(f.kcal * PORTION_FACTORS[portionIdx].factor) : 0);
  }, 0);

  const pickImage = useCallback(async (useCamera: boolean) => {
    try {
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要权限', useCamera ? '请在系统设置里允许使用相机' : '请在系统设置里允许访问相册');
        return;
      }
      const res = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, allowsEditing: true, aspect: [4, 3] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true, allowsEditing: true, aspect: [4, 3] });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPhotoUri(a.uri);
      setBase64(a.base64 ?? null);
      setItems([]);
      setPicked(new Set());

      // 有 VLM 配置 → 自动识别；否则直接进手动兜底
      setScanning(true);
      const aiItems = a.base64 ? await recognizeMeal(a.base64) : null;
      setScanning(false);
      if (aiItems) {
        setItems(aiItems);
        setSource('ai');
      } else {
        setSource('manual');
      }
    } catch {
      setScanning(false);
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
    setBase64(null);
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
            <Image source={{ uri: photoUri }} style={styles.photo} />
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

        {/* 手动兜底：内置菜品快速选择 */}
        {!scanning && (source === 'manual' || (source === 'ai' && items.length === 0)) ? (
          <Card style={styles.resultCard}>
            <Text style={styles.resultTitle}>
              {photoUri ? '没认出来？选一下你吃了什么' : '选择菜品（可多选）'}
            </Text>
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

        <ScrollView style={{ height: 0 }} />
      </ScreenContainer>
    </View>
  );
}

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
  photo: { width: '100%', height: 180, borderRadius: theme.radius.sm, backgroundColor: mm.colors.emptyFill },
  photoPlaceholder: {
    height: 140, borderRadius: theme.radius.sm, backgroundColor: mm.colors.emptyFill,
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
