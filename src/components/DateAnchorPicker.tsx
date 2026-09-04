/**
 * DateAnchorPicker —— 详情页「日/周/月/年」下方的日期步进器。
 *
 * 交互（对齐用户参考图）：
 *  - 形如  ◀  2026/09/03  ▶
 *  - 点左右箭头：按当前 range 单位步进（日=±1天 / 周=±1自然周 / 月=±1自然月 / 年=±1自然年）
 *  - 点中间日期：弹出日历选择器，选定日期后作为新的锚点
 *  - range=day  → 锚点即所选日；week → 视图取包含锚点的自然周(周一~周日)；
 *    month → 锚点所在自然月；year → 锚点所在自然年。
 *
 * 纯 TS 实现，无原生 datetimepicker 依赖（改此文件 Metro 热更即生效，无需 ⌘R）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Icon from './Icon';
import {
  startOfDay,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  addYears,
  calendarDays,
  formatDate,
  formatMonth,
  formatYear,
} from '../lib/dateUtils';

type RangeKey = 'day' | 'week' | 'month' | 'year';

interface Props {
  /** 当前锚点日期（详情页所有 range 以此为基准） */
  value: Date;
  /** 选中确认后的回调 */
  onChange: (d: Date) => void;
  /** 当前 range 单位，决定步进粒度与中间标签格式 */
  range: RangeKey;
  /** 可选：最大可选日期（含），默认今天，不可选未来 */
  maxDate?: Date;
  /** 可选：最小可选日期（含），默认去年 1/1 */
  minDate?: Date;
}

function clamp(d: Date, min: Date, max: Date): Date {
  if (d.getTime() < min.getTime()) return new Date(min);
  if (d.getTime() > max.getTime()) return new Date(max);
  return d;
}

function step(value: Date, range: RangeKey, dir: 1 | -1): Date {
  switch (range) {
    case 'day':
      return addDays(value, dir);
    case 'week':
      return addDays(value, dir * 7);
    case 'month':
      return addMonths(value, dir);
    case 'year':
      return addYears(value, dir);
  }
}

function centerLabel(value: Date, range: RangeKey): string {
  switch (range) {
    case 'day':
      return formatDate(value);
    case 'week': {
      const s = startOfWeek(value);
      const e = endOfWeek(value);
      return `${formatDate(s)} – ${formatDate(e)}`;
    }
    case 'month':
      return formatMonth(value);
    case 'year':
      return formatYear(value);
  }
}

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

export default function DateAnchorPicker({ value, onChange, range, maxDate, minDate }: Props) {
  const today = startOfDay(new Date());
  const max = startOfDay(maxDate ?? today);
  const min = startOfDay(minDate ?? new Date(today.getFullYear() - 1, 0, 1));

  const [open, setOpen] = useState(false);
  // 日历当前展示的年月（打开时重置到锚点所在月）
  const [calY, setCalY] = useState(value.getFullYear());
  const [calM, setCalM] = useState(value.getMonth() + 1);

  const goPrev = () => onChange(clamp(step(value, range, -1), min, max));
  const goNext = () => onChange(clamp(step(value, range, 1), min, max));

  const openCalendar = () => {
    setCalY(value.getFullYear());
    setCalM(value.getMonth() + 1);
    setOpen(true);
  };

  // 日历点击：把锚点设为所选日（周/月/年视图会据此派生各自窗口）
  const pickDay = (d: Date) => {
    onChange(clamp(startOfDay(d), min, max));
    setOpen(false);
  };

  const days = useMemo(() => calendarDays(calY, calM), [calY, calM]);
  const isSelected = (d: Date) => startOfDay(d).getTime() === startOfDay(value).getTime();
  const inMonth = (d: Date) => d.getMonth() + 1 === calM;
  const disabled = (d: Date) => {
    const t = startOfDay(d).getTime();
    return t < min.getTime() || t > max.getTime();
  };

  return (
    <>
      {/* 步进器：◀ 当前选择 ▶，点中间弹日历 */}
      <View style={styles.stepper}>
        <TouchableOpacity style={styles.arrow} onPress={goPrev} hitSlop={8}>
          <Icon name="chevronLeft" size={theme.fs(20)} color={theme.colors.textTitle} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.center} onPress={openCalendar} activeOpacity={0.85}>
          <Icon name="calendar" size={theme.fs(15)} color={theme.colors.accentSolid} />
          <Text style={styles.centerText}>{centerLabel(value, range)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.arrow} onPress={goNext} hitSlop={8}>
          <Icon name="chevronRight" size={theme.fs(20)} color={theme.colors.textTitle} />
        </TouchableOpacity>
      </View>

      {/* 日历弹窗 */}
      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={styles.cancel}>取消</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>选择日期</Text>
            <TouchableOpacity onPress={() => pickDay(today)}>
              <Text style={styles.todayBtn}>今天</Text>
            </TouchableOpacity>
          </View>

          {/* 年月导航 */}
          <View style={styles.calNav}>
            <TouchableOpacity
              style={styles.calArrow}
              onPress={() => {
                const p = addMonths(new Date(calY, calM - 1, 1), -1);
                setCalY(p.getFullYear());
                setCalM(p.getMonth() + 1);
              }}
            >
              <Icon name="chevronLeft" size={theme.fs(18)} color={theme.colors.textTitle} />
            </TouchableOpacity>
            <Text style={styles.calTitle}>{calY}年{calM}月</Text>
            <TouchableOpacity
              style={styles.calArrow}
              onPress={() => {
                const p = addMonths(new Date(calY, calM - 1, 1), 1);
                setCalY(p.getFullYear());
                setCalM(p.getMonth() + 1);
              }}
            >
              <Icon name="chevronRight" size={theme.fs(18)} color={theme.colors.textTitle} />
            </TouchableOpacity>
          </View>

          {/* 星期表头 */}
          <View style={styles.weekHead}>
            {WEEK_HEAD.map((w, i) => (
              <Text key={i} style={styles.weekHeadCell}>
                {w}
              </Text>
            ))}
          </View>

          {/* 日期网格（42 格，含前后补全日） */}
          <View style={styles.grid}>
            {days.map((d, i) => {
              const dim = !inMonth(d);
              const sel = isSelected(d);
              const dis = disabled(d);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.cell, sel && styles.cellOn]}
                  disabled={dis}
                  onPress={() => pickDay(d)}
                >
                  <Text
                    style={[
                      styles.cellText,
                      dim && styles.cellDim,
                      sel && styles.cellTextOn,
                      dis && styles.cellDis,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  arrow: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xs,
    borderWidth: 1,
    borderColor: theme.colors.accentSolid,
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.sp(1.5),
  },
  centerText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.cardBgStrong,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    paddingBottom: theme.space.lg,
    paddingTop: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  cancel: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  sheetTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  todayBtn: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.accentSolid },
  calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.space.md },
  calArrow: { padding: theme.sp(1) },
  calTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  weekHead: { flexDirection: 'row', marginTop: theme.space.sm },
  weekHeadCell: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space.xs },
  cell: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: theme.colors.accentSolid, borderRadius: theme.radius.sm },
  cellText: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle },
  cellDim: { color: theme.colors.textSub },
  cellTextOn: { color: '#fff', fontWeight: theme.weight.semibold },
  cellDis: { color: 'rgba(138,138,168,0.4)' },
});
