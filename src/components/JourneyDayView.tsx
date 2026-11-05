/**
 * JourneyDayView —— 单日旅程（曲线流）
 *
 * 使用位置：
 *   · ★ 2026-10-12 起：Calendar 月历**点某一天 → 下抽屉**（DayDrawer）里展示那一天；
 *     Calendar 页顶部原「日 / 月」tab 已移除。
 *   · 不传 `date` 时锚点 = 今天（等同旧的「今日旅程」行为）。
 *
 * ★ 2026-10-10（用户，方案 A + 补充）：顶部日期条横滑——
 *   选中那天**自动滚动居中 + 紫底变色**，中央渐变曲线**从选中格正下方引出**、
 *   向下延伸，左右交替白卡挂两侧；曲线加粗（4.5）+ 卡片收窄（50%）保证线明显可见。
 *   数据 = buildTodayTimeline(date)（真实生理数据 + 用户自报，无 AI，品牌铁律）。
 *
 * ⚠️ 布局采用**固定行高 + 逐点生成 SVG 路径**（见 docs/design-tokens.md §10.9，禁 aspectRatio）。
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { buildTodayTimeline } from '../lib/buildTodayTimeline';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import type { TimelineItem } from './TodayTimelineCard';
import { getSelfReportsForDaySync, ensureSelfReportsLoaded, onSelfReport, sortByTime } from '../data/selfReportLog';
// ★ 本轮（用户）：呼吸 / 冥想完成后，其完成记录落在 interventionLog，
//   回顾·日 原本只读 selfReportLog，导致「做完呼吸回顾里啥也没有」——这里把 interventionLog 也并进来。
import { ensureInterventionLogLoaded, allInterventionEntries } from '../data/interventionLog';

const ROW_H = theme.sp(26);          // 每行 104：卡片区高
const CARD_W = '46%';                // ★ 卡片收窄，中央留出蛇形曲线的通道
const DOT_AMP = 9;                   // ★ 节点在中心线两侧的摆幅（小振幅 → 大半径圆滑 S 弯）
const STRIP_BACK = 9;                // 日期条：锚点前 9 天
const STRIP_FWD = 4;                 // 日期条：锚点后 4 天（并裁剪到今天）
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CELL_W = theme.sp(11);         // 日期格 44
const CELL_GAP = theme.sp(2);        // 格间距 8

/** #RRGGBB 与白混合（做图标方块的浅底） */
function mixWhite(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#F6F4F1';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - ratio) + 255 * ratio);
  const g = Math.round(((n >> 8) & 255) * (1 - ratio) + 255 * ratio);
  const b = Math.round((n & 255) * (1 - ratio) + 255 * ratio);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 兜底 emoji */
function emojiFor(title: string): string {
  if (/起床|睡眠/.test(title)) return '☀️';
  if (/情绪/.test(title)) return '💗';
  if (/脑力/.test(title)) return '🧠';
  if (/步|活动/.test(title)) return '🏃‍♀️';
  if (/对话/.test(title)) return '💬';
  if (/洞察/.test(title)) return '✨';
  return '🌸';
}

/** 该日是否有旅程数据（睡眠 / 步数），用于日期条小圆点 */
function hasDayData(d: Date): boolean {
  try {
    const dk = dayKey(d.getTime());
    if (healthStore.getSleep(dk)) return true;
    const steps = (RingBle.getState()?.stepDaily as any)?.[dk]?.steps ?? 0;
    return steps > 0;
  } catch { return false; }
}

/**
 * ★ S 型蛇形曲线（对齐序日参考图）：**从第一个卡片的节点开始**（用户 23:20：
 *   "线的头就从第一个卡片那个点开始"，不再从日期条引出长线），到最后一个节点结束。
 *   节点左右小幅交替（±DOT_AMP）贴卡片内缘，Catmull-Rom → 贝塞尔平滑样条。
 *
 * ★ 2026-10-12（用户：「线要从卵泡期旁边那个点连到脑力消耗左边那个点」）——
 *   坐标系改为**与行容器同源**：SVG 现在挂在行容器内部（top:0），y 直接取
 *   「第 i 行垂直中心 = i*ROW_H + ROW_H/2」，与 styles.dot 的 top:'50%' 完全重合。
 *   旧实现把 SVG 绝对定位在含日期条的 wrap 上、再用 CURVE_TOP 手算偏移，
 *   结果整条曲线比圆点高了整整半行（日期条 60 − CURVE_TOP 8 = 52 = ROW_H/2），
 *   头尾都对不上两端的点。
 */
function buildWavePath(height: number, count: number): string {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x = 22 + (i % 2 === 0 ? -DOT_AMP : DOT_AMP); // 左卡 → 节点偏左；右卡 → 偏右
    pts.push({ x, y: i * ROW_H + ROW_H / 2 });
  }
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * ★ 2026-10-12（用户）：支持从月历点某一天打开 —— 传 `date` 即以该日为锚点
 *   （日期条窗口跟着那天走、选中那天居中），不传则等同旧行为（锚点=今天）。
 */
export default function JourneyDayView({ date }: { date?: Date } = {}) {
  const anchor = useMemo(() => {
    const d = date ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, [date]);

  // 日期条：锚点前 9 天 ~ 后 4 天（升序；不展示未来，故裁剪到今天）。
  // 锚点=今天时窗口正好是「今天往前 14 天」，与旧实现完全一致。
  const days = useMemo(() => {
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const arr: Date[] = [];
    for (let i = -STRIP_BACK; i <= STRIP_FWD; i++) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i);
      if (d.getTime() > today.getTime()) continue;
      arr.push(d);
    }
    return arr;
  }, [anchor]);

  const [selDate, setSelDate] = useState<Date>(anchor);

  const stripRef = useRef<ScrollView>(null);
  const stripW = useRef(0);
  const initialScrollDone = useRef(false);

  // ★ 选中格居中：条宽测量后 + 每次选择后都滚到中间
  const centerSel = useCallback((date: Date, animated: boolean) => {
    const idx = days.findIndex((d) => sameDay(d, date));
    if (idx < 0 || stripW.current <= 0) return;
    const target = idx * (CELL_W + CELL_GAP) + CELL_W / 2 - stripW.current / 2;
    stripRef.current?.scrollTo({ x: Math.max(0, target), animated });
  }, [days]);

  useEffect(() => {
    if (!initialScrollDone.current && stripW.current > 0) {
      initialScrollDone.current = true;
      centerSel(selDate, false);
    }
  }, [selDate, centerSel]);

  // ★ 2026-10-12：锚点变化（月历换了另一天打开）→ 选中日同步 + 重新居中
  useEffect(() => {
    setSelDate(anchor);
    initialScrollDone.current = false;
    if (stripW.current > 0) {
      initialScrollDone.current = true;
      centerSel(anchor, false);
    }
  }, [anchor, centerSel]);

  // ★ 本轮（用户）：进入回顾即拉起回顾补充数据源；新记录产生（如用户在别的页刚完成饮食/心情）
  //   即时合并进时间线，无需手动刷新。
  const [, setRecapTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void ensureSelfReportsLoaded().then(() => { if (alive) setRecapTick((n) => n + 1); });
    // ★ 本轮（用户）：呼吸 / 冥想记录同样要即时并入时间线
    void ensureInterventionLogLoaded().then(() => { if (alive) setRecapTick((n) => n + 1); });
    const off = onSelfReport(() => { if (alive) setRecapTick((n) => n + 1); });
    return () => { alive = false; off(); };
  }, []);

  const result = useMemo(() => {
    try { return buildTodayTimeline(undefined, selDate); } catch { return null; }
  }, [selDate]);

  // ★ 本轮（用户）：回顾补充数据源——用户在胶囊建议里完成的饮食 / 心情记录，
  //   按时间插进当日生理时间线，让「刚做完的事」立刻出现在回顾·今日。
  const recapItems: TimelineItem[] = useMemo(() => {
    const dk = dayKey(selDate.getTime());
    return getSelfReportsForDaySync(dk).map((sr) => ({
      time: sr.time,
      color: sr.color,
      title: sr.title,
      sub: sr.sub,
      emoji: sr.emoji,
      goalMet: false,
      analysis: sr.analysis,
      imageUri: sr.imageUri,
    }));
  }, [selDate]);

  // ★ 本轮（用户）：呼吸 / 冥想完成记录（interventionLog）并入回顾·日——
  //   否则「做完呼吸，回顾里啥也没有」。带前后状态变化时一并写出。
  const interventionItems: TimelineItem[] = useMemo(() => {
    const dk = dayKey(selDate.getTime());
    return allInterventionEntries()
      .filter((e) => dayKey(e.ts) === dk)
      .map((e) => {
        const d = new Date(e.ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mn = String(d.getMinutes()).padStart(2, '0');
        const isBreath = e.kind === 'breath';
        let sub = e.detail ?? '';
        if (e.stateBefore && e.stateAfter && e.stateBefore !== e.stateAfter) {
          sub += ` · 状态 ${e.stateBefore}→${e.stateAfter}`;
        } else if (
          e.valueBefore != null && e.valueAfter != null &&
          Math.abs(e.valueAfter - e.valueBefore) >= 2
        ) {
          sub += ` · ${e.valueBefore}→${e.valueAfter}`;
        }
        return {
          time: `${hh}:${mn}`,
          color: isBreath ? mm.colors.limeDeep : mm.colors.purpleCore,
          title: isBreath ? '呼吸练习' : '正念冥想',
          sub,
          emoji: isBreath ? '🌬️' : '🧘',
          goalMet: false,
          analysis: undefined,
          imageUri: undefined,
        } as TimelineItem;
      });
  }, [selDate]);

  const items: TimelineItem[] = useMemo(
    () => sortByTime<TimelineItem>([...(result?.items ?? []), ...recapItems, ...interventionItems]),
    [result, recapItems, interventionItems],
  );
  const totalH = Math.max(items.length, 1) * ROW_H;
  const wavePath = buildWavePath(totalH, items.length);
  const isSelToday = sameDay(selDate, new Date());

  return (
    <View style={styles.wrap}>
      {/* ── 方案 A：日期条（选中格居中 + 紫底变色；有记录的日带点；今天绿描边）── */}
      <View style={styles.stripWrap}>
        <ScrollView
          ref={stripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripContent}
          onLayout={(e) => {
            stripW.current = e.nativeEvent.layout.width;
            if (!initialScrollDone.current) centerSel(selDate, false);
          }}
        >
          {days.map((d) => {
            const sel = sameDay(d, selDate);
            const today = sameDay(d, new Date());
            const has = hasDayData(d);
            return (
              <TouchableOpacity
                key={d.getTime()}
                activeOpacity={0.7}
                onPress={() => { setSelDate(d); centerSel(d, true); }}
              >
                <View style={[styles.cell, sel && styles.cellSel, today && !sel && styles.cellToday]}>
                  <Text style={[styles.cellW, sel && styles.cellWSel]}>{WEEKDAYS[d.getDay()]}</Text>
                  <Text style={[styles.cellN, sel && styles.cellNSel]}>{d.getDate()}</Text>
                  {has ? <View style={[styles.cellDot, sel && styles.cellDotSel]} /> : <View style={styles.cellDotNone} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── 曲线层：从选中格（居中）正下方引出，向下波浪延伸 ── */}
      {items.length === 0 ? (
        <View style={[styles.empty, { marginTop: theme.sp(3) }]}>
          <Text style={styles.emptyTitle}>{isSelToday ? '今天还没有记录' : '这一天还没有记录'}</Text>
          <Text style={styles.emptyText}>打卡、写日记或戴上戒指走一走，这一天就会在这里留下痕迹。</Text>
        </View>
      ) : (
        <>
          {/* ★ 2026-10-12：曲线与行共用同一个容器（曲线 top:0 定位在行区内），
              这样曲线端点与圆点严格重合——从第一条记录的点连到最后一条记录的点。 */}
          <View style={[styles.rows, { height: items.length * ROW_H }]}>
          {/* ★ 只有 ≥2 条记录才画曲线（1 个点无曲线；空 d 的 Path 会让 SVG 把渐变整块渲染成色块） */}
          {items.length >= 2 && (
            <Svg width={44} height={totalH} style={styles.curve} pointerEvents="none">
              <Defs>
                <SvgGrad id="journeyGrad" x1="22" y1="0" x2="22" y2={totalH} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={mm.colors.purpleCore} />
                  <Stop offset="0.5" stopColor={mm.colors.roseCore} />
                  <Stop offset="1" stopColor={mm.colors.limeMid} />
                </SvgGrad>
              </Defs>
              <Path d={wavePath} stroke="url(#journeyGrad)" strokeWidth={4.5} strokeLinecap="round" fill="none" />
            </Svg>
          )}

          {/* 事件行：左右交替，节点圆点贴卡片内缘、落在曲线上 */}
            {items.map((it, i) => {
              const left = i % 2 === 0;
              const dotOff = left ? -DOT_AMP : DOT_AMP;
              return (
                <View key={`${it.time}-${i}`} style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: it.color, marginLeft: dotOff - theme.sp(1.5) }]} />
                  <View style={[styles.card, { width: CARD_W }, left ? styles.cardL : styles.cardR]}>
                    {/* ★ 本轮（用户 #245）：达标 → 卡片右上角画星 */}
                    {it.goalMet ? <Text style={styles.goalStar}>👑</Text> : null}
                    <View style={styles.cardHead}>
                      <View style={[styles.icon, { backgroundColor: mixWhite(it.color, 0.82) }]}>
                        <Text style={styles.iconTxt}>{it.emoji ?? emojiFor(it.title)}</Text>
                      </View>
                      <Text style={styles.cardTitle} numberOfLines={2}>{it.title}</Text>
                    </View>
                    {!!it.sub && <Text style={styles.cardSub} numberOfLines={2}>{it.sub}</Text>}
                    {/* ★ 本轮（用户 #248）：卡片底部补一句分析 */}
                    {!!it.analysis && <Text style={styles.cardAnalysis} numberOfLines={2}>{it.analysis}</Text>}
                    {/* ★ 本轮（用户）：饮食等带图记录，卡片内附图 */}
                    {!!it.imageUri && (
                      <Image source={{ uri: it.imageUri }} style={styles.cardPhoto} resizeMode="cover" />
                    )}
                    <Text style={styles.cardTime}>{it.time}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* 汇总条 */}
          <View style={styles.sumBar}>
            <Text style={styles.sumText} numberOfLines={1}>
              {isSelToday ? '今日' : `${selDate.getMonth() + 1}月${selDate.getDate()}日`}共{' '}
              <Text style={styles.sumNum}>{items.length}</Text> 条记录
              {items.length > 1 ? ` · 从 ${items[0].time} 到 ${items[items.length - 1].time}` : ''}
            </Text>
            {items.length >= 2 && (
              <Text style={styles.valueText} numberOfLines={2}>
                当天先记录「{items[0].title}」，之后又出现「{items[items.length - 1].title}」；这是一条可继续观察的变化线索。
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', marginTop: theme.sp(1) },

  /* 日期条 */
  stripWrap: { marginBottom: theme.sp(1) },
  stripContent: { alignItems: 'center', paddingHorizontal: theme.sp(1) },
  cell: {
    width: CELL_W, height: theme.sp(14), marginHorizontal: CELL_GAP / 2,
    borderRadius: theme.radius.md, backgroundColor: 'rgba(31,29,26,0.04)',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  cellSel: { backgroundColor: mm.colors.purpleCore },
  cellToday: { borderWidth: 1.5, borderColor: mm.colors.limeMid },
  cellW: { fontSize: theme.fontSize.micro - 1, color: mm.colors.inkFaint },
  cellWSel: { color: 'rgba(255,255,255,0.85)' },
  cellN: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  cellNSel: { color: theme.colors.textWhite },
  cellDot: { width: theme.sp(1.25), height: theme.sp(1.25), borderRadius: theme.sp(0.625), backgroundColor: mm.colors.limeMid },
  cellDotSel: { backgroundColor: theme.colors.textWhite },
  cellDotNone: { width: theme.sp(1.25), height: theme.sp(1.25) },

  /* 曲线与行 */
  // ★ 2026-10-12：曲线与行同容器（曲线以本容器 top:0 定位），保证端点与圆点重合
  rows: { position: 'relative', width: '100%' },
  curve: { position: 'absolute', top: 0, left: '50%', marginLeft: -22 },
  row: {
    width: '100%', height: ROW_H, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', position: 'relative',
  },
  dot: {
    position: 'absolute', left: '50%', top: '50%',
    width: theme.sp(3), height: theme.sp(3), marginLeft: -theme.sp(1.5), marginTop: -theme.sp(1.5),
    borderRadius: theme.sp(1.5), borderWidth: 2.5, borderColor: theme.colors.cardBg, zIndex: 1,
  },
  card: {
    position: 'relative',
    backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPadCompact,
    shadowColor: mm.shadow.color, shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius, shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
    zIndex: 2,
  },
  cardL: { marginRight: 'auto' },
  cardR: { marginLeft: 'auto' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  icon: {
    width: theme.sp(7.5), height: theme.sp(7.5), borderRadius: mm.radius.iconSq,
    alignItems: 'center', justifyContent: 'center',
  },
  iconTxt: { fontSize: theme.fs(15) },
  cardTitle: {
    flex: 1, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, lineHeight: theme.fontSize.sm * 1.3,
  },
  cardSub: {
    fontSize: theme.fontSize.micro, color: mm.colors.inkFaint,
    lineHeight: theme.fontSize.micro * 1.4, marginTop: theme.sp(1.25),
  },
  cardTime: { fontSize: theme.fontSize.micro - 1, color: mm.colors.inkFaint, marginTop: theme.sp(1.5) },
  // ★ 本轮（用户 #261）：达标皇冠，卡片右上角（放大 + 明亮黄绿，更醒目、鼓励感更强）
  goalStar: {
    position: 'absolute', top: theme.sp(1.25), right: theme.sp(1.5),
    fontSize: theme.fs(20), color: mm.colors.limeCore, fontWeight: theme.weight.bold as never,
    zIndex: 3,
  },
  // ★ 本轮（用户 #261）：卡片底部分析句，改用明亮黄绿（limeCore）替代看不清的深绿（limeDeep）
  cardAnalysis: {
    fontSize: theme.fontSize.micro, color: mm.colors.limeCore,
    lineHeight: theme.fontSize.micro * 1.45, marginTop: theme.sp(1),
  },
  // ★ 本轮（用户）：饮食记录卡片内附图
  cardPhoto: {
    marginTop: theme.sp(1.5),
    width: '100%',
    height: theme.sp(22),
    borderRadius: theme.radius.sm,
    backgroundColor: mm.colors.btnBusyBg,
  },

  // ★ 本轮（用户 #261）：底部总结去掉胶囊背景，纯文字置底居中
  sumBar: {
    marginTop: theme.sp(3), alignSelf: 'center', maxWidth: '100%',
    paddingHorizontal: theme.sp(5),
  },
  valueText: {
    marginTop: theme.sp(1.25), fontSize: theme.fontSize.micro, lineHeight: theme.fs(16),
    color: mm.colors.inkFaint, textAlign: 'center',
  },
  sumText: { fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, textAlign: 'center' },
  sumNum: { fontWeight: theme.weight.bold as never, color: mm.colors.ink },

  empty: {
    backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card, padding: theme.space.cardPad, alignItems: 'center',
  },
  emptyTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  emptyText: {
    fontSize: theme.fontSize.sm, color: mm.colors.inkFaint,
    textAlign: 'center', marginTop: theme.sp(1.5), lineHeight: theme.fontSize.sm * 1.5,
  },
});
