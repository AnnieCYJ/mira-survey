import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import Icon from './Icon';
import { RingBle, type RingState } from '../ble/RingBleManager';

/**
 * 代谢 tab · 血液成分卡片（甘油三酯 / HDL / LDL / 总胆固醇 / 尿酸）。
 *
 * 协议确认：血液成分是戒指自动监测功能（VPSettingAutomaticBloodCompTest），
 * 不需要手动触发。但戒指自动检测间隔较长（可能几小时），右上角留一个「补测」按钮。
 *
 * UI 风格：单 Card + 右上角 icon 按钮（与其他 BasicMetricCard/Card 一致），
 * 不单独做大按钮，保持 design token 一致性。
 */

interface Props {
  ring: RingState;
  onOpenDetail: (key: string, name: string, unit: string, yMin: number, yMax: number) => void;
  /** 不带 header，嵌入到其他卡片底部 */
  headerless?: boolean;
}

interface BCItem {
  key: string;
  name: string;
  unit: string;
  yMin: number;
  yMax: number;
  range: string;
}

const BC_ITEMS: BCItem[] = [
  { key: 'triglyceride', name: '甘油三酯', unit: 'mmol/L', yMin: 0, yMax: 6,   range: '正常 < 1.7' },
  { key: 'hdl',          name: 'HDL',       unit: 'mmol/L', yMin: 0, yMax: 3,   range: '正常 > 1.0' },
  { key: 'ldl',          name: 'LDL',       unit: 'mmol/L', yMin: 0, yMax: 6,   range: '正常 < 3.4' },
  { key: 'cholesterol', name: '总胆固醇',   unit: 'mmol/L', yMin: 0, yMax: 10,  range: '参考报告' },
  { key: 'uricAcid',     name: '尿酸',       unit: 'μmol/L', yMin: 50, yMax: 600, range: '正常 155–428' },
];

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null || Number.isNaN(v)) return '—';
  return unit === 'μmol/L' ? v.toFixed(1) : v.toFixed(2);
}

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '待检测';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function BloodComponentPanel({ ring, onOpenDetail, headerless = false }: Props) {
  const [measuring, setMeasuring] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // 收到任意新值 → 结束测量态
  useEffect(() => {
    if (!measuring) return;
    const anyLive = BC_ITEMS.some(it => (ring as any).daily?.[it.key] > 0);
    if (anyLive) setMeasuring(false);
  });

  const onSpotCheck = () => {
    if (measuring) return;
    setMeasuring(true);
    RingBle.measure('bloodComponent');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMeasuring(false), 15_000);
  };

  // 最近一次测量时间（5 项中最新的那个）
  const lastTs = BC_ITEMS.reduce((best, it) => {
    const ts: any = (ring as any).lastUpdated?.[it.key];
    if (typeof ts === 'number' && ts > best) return ts;
    return best;
  }, 0) || null;

  const Wrap: any = headerless ? View : Card;
  return (
    <Wrap {...(headerless ? {} : { style: { padding: theme.space.cardPadCompact } })}>
      {!headerless && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="drop" size={theme.fontSize.card + 2} color={theme.colors.textSub} style={{ marginRight: theme.sp(1) }} />
            <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle }}>血液成分</Text>
          </View>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{lastTs ? timeAgo(lastTs) : '待检测'}</Text>
        </View>
      )}

      {/* 5 项汇总：3 列网格（最后一行两列居中更美观） */}
      <View style={styles.grid}>
        {BC_ITEMS.map((it) => {
          const v = (ring as any).daily?.[it.key] ?? null;
          const live = v != null && v > 0;
          return (
            <TouchableOpacity
              key={it.key}
              activeOpacity={0.92}
              style={styles.item}
              onPress={() => onOpenDetail(it.key, it.name, it.unit, it.yMin, it.yMax)}
            >
              <Text style={styles.itemName}>{it.name}</Text>
              <Text style={[styles.itemVal, live ? styles.itemValLive : styles.itemValIdle]}>
                {fmt(v, it.unit)}
              </Text>
              <Text style={styles.itemUnit}>{live ? it.unit : '待检测'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.sp(1.5),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  // compact 复用
  sub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 2,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(1.25),
  },
  refreshBtnBusy: { backgroundColor: theme.colors.ui.offTrack },
  refreshIcon: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
    marginRight: theme.sp(1),
  },
  refreshIconBusy: { color: theme.colors.textSub },
  refreshLabel: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  refreshLabelBusy: { color: theme.colors.textSub },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.sp(1.5),
  },
  item: {
    width: '30%',
    paddingVertical: theme.sp(1.25),
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  itemName: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
    marginBottom: 2,
  },
  itemVal: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
  },
  itemValLive: { color: theme.colors.textTitle },
  itemValIdle: { color: theme.colors.textSub },
  itemUnit: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 1,
  },
});
