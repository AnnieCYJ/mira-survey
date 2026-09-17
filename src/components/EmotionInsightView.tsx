/**
 * EmotionInsightView —— 「情绪洞察」统一视图（单一数据源，保证两处内容完全一致）
 *
 * 数据源：`computeStressReport()`（lib/stressAlgorithm.ts）
 *
 * 共用方：
 *  1) 首页 →「情绪消耗」点进去的 `EnergyDetailScreen`（type='emotion'）
 *  2) 洞察页 →「情绪压力」tab 下的情绪洞察卡（原名「压力洞察」，已统一）
 *
 * 内容两块（合并在同一张卡片内）：
 *  - 全天情绪分布：5 档情绪点阵（兴奋/愉悦/平静/压力/焦虑），基于事件 valenceLabel + severity
 *  - 情绪洞察：4 项指标（情绪消耗/恢复时间/峰值时段/唤醒分）+ 口径注释 + 5 档情绪说明
 *
 * 设计：100% design token（theme.ts），禁止裸值。
 */
import React from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { theme } from '../theme/theme';
import Card from './Card';
import { computeStressReport, type StressReport } from '../lib/stressAlgorithm';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { levelColor } from './StressInsightCard';

/** 等宽均分数据单元（与 MetricDetail statCell 同款；两处共用） */
export function StatCell({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      <Text
        style={[styles.statValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >{value}</Text>
      {sub ? <Text style={styles.statSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/**
 * 全天情绪分布：情绪事件点阵（24 小时列 × 4 行，5 档情绪着色）
 *
 * 网格语义：**一列 = 1 小时，一行 = 15 分钟**（:00 / :15 / :30 / :45）；
 * 同一格里出现多个事件时**横向并排画多个点**（不串行、不丢弃）→ 圆点数恒等于事件次数。
 *
 * ★ 两条不变量（2026-09-16 修「图上是 3 个点、文案说 4 次」）：
 *  1. **时间轴固定 0–23 全天**。旧实现把轴裁成「起床时刻 → 24」，当睡眠跨零点时
 *     （实测 00:41 入睡 / 09:41 起床）会把 00:00–09:41 这段**清醒时间**整段丢掉，
 *     落在其中的事件图上消失、却仍计入「N 次压力事件」→ 点数 ≠ 次数。标题即「全天」，就该画满 24 列。
 *  2. **不因睡眠丢事件**：睡眠时段的列只加浅底标注，事件照常画。
 */
export function StressEventStems({ events, chartH = 200 }: { events: any[]; chartH?: number }) {
  void chartH;
  // ★ 5 档情绪分类
  const COL_EXCITED = theme.colors.moodEnergy;    // 兴奋
  const COL_PLEASANT = theme.colors.moodGood;     // 愉悦
  const COL_CALM = theme.colors.stateTired;       // 平静
  const COL_STRESSED = theme.colors.stateEnergy;  // 压力
  const COL_ANXIOUS = theme.colors.danger;        // 焦虑

  // 睡眠窗口：**只用于给睡眠时段的列加浅底**，不再用来过滤事件
  let bedHour: number | null = null;
  let wakeHour: number | null = null;
  try {
    const { healthStore } = require('../data/healthStore');
    const dk = new Date().toISOString().slice(0, 10);
    const sleepSum = healthStore.getSleep(dk);
    if (sleepSum && sleepSum.total > 0) {
      const parseHM = (s: string | null | undefined): number | null => {
        if (!s) return null;
        const m = s.match(/(\d{1,2}):(\d{2})/);
        return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : null;
      };
      const bH = parseHM(sleepSum.sleepTime);
      const wH = parseHM(sleepSum.wakeTime);
      if (bH != null && wH != null) { bedHour = bH; wakeHour = wH; }
      else if (bH != null) { bedHour = bH; wakeHour = (bH + sleepSum.total / 60) % 24; }
      else if (wH != null) { wakeHour = wH; bedHour = (wH - sleepSum.total / 60 + 24) % 24; }
    }
  } catch {}

  const isSleepHour = (h: number): boolean => {
    if (bedHour == null || wakeHour == null) return false;
    if (bedHour > wakeHour) return h >= bedHour || h < wakeHour;
    return h >= bedHour && h < wakeHour;
  };

  const COLS = 24; // ★ 全天 24 列（标题即「全天」，不再按时段裁剪）
  const ROWS = 4;  // 4 行 = 每小时的 4 个 15 分钟刻度（:00/:15/:30/:45）
  const hourCols = Array.from({ length: COLS }, (_, h) => h);

  // ★ grid[col][row] = 该 15 分钟格内的事件列表（多个则同格并排画，不丢、不串行）
  const grid: any[][][] = Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => [] as any[])
  );
  for (const e of events) {
    if (!e || !Number.isFinite(e.t)) continue;
    const d = new Date(e.t);
    const col = d.getHours();
    // 一列 = 1 小时、一行 = 15 分钟：同一格里的事件**并存**（横向并排画多个点），
    // 顺延到别的行会破坏「行=分钟」的时间语义。
    const row = Math.min(ROWS - 1, Math.floor(d.getMinutes() / 15)); // :00→0 … :45→3
    grid[col][row].push(e);
  }

  // ★ 5 档情绪判定 (valenceLabel + severity 细分)
  const dotColor = (e: any): string => {
    if (!e) return 'transparent';
    const sev = e.severity || 50;
    if (e.valenceLabel === 'positive') return sev > 50 ? COL_EXCITED : COL_PLEASANT;
    if (e.valenceLabel === 'negative') return sev > 50 ? COL_ANXIOUS : COL_STRESSED;
    return COL_CALM;
  };
  const dotStyle = (e: any) => {
    const sev = e?.severity || 50;
    return { r: 6 + (sev / 100) * 7, opacity: 0.4 + (sev / 100) * 0.5 };
  };

  // 24 列比原来的 15 列更密 → 列间距收到 2px，避免网格被间隙吃掉
  const GAP = theme.sp(0.5);
  const LABEL_H = theme.sp(3);

  return (
    <View style={{ width: '100%', paddingBottom: theme.sp(2), marginTop: theme.sp(2), position: 'relative' }}>
      {/* ★ 固定 4 行格子 */}
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={{ flexDirection: 'row', marginBottom: row < ROWS - 1 ? GAP : 0 }}>
          {hourCols.map((h, col) => {
            const cell = grid[col][row];
            const has = cell.length > 0;
            return (
              <View key={`${h}-${row}`} style={{
                flex: 1, aspectRatio: 0.7,
                marginRight: col < COLS - 1 ? GAP : 0,
                borderRadius: theme.radius.sm,
                // 空格：睡眠时段给浅底（提示"这会儿在睡"），事件格用白底高亮
                backgroundColor: has
                  ? theme.colors.ui.white25
                  : isSleepHour(h) ? theme.colors.cardBgSoft + '66' : 'transparent',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: has ? 1 : 0,
                borderColor: has ? theme.colors.ui.borderSoft : 'transparent',
              }}>
                {has && (
                  <Svg width="100%" height="100%" viewBox="0 0 40 20">
                    {cell.map((e, i) => {
                      const color = dotColor(e);
                      const st = dotStyle(e);
                      // 同一格内多个事件 → 横向等分并排（整体缩小，避免糊成一团）
                      const n = cell.length;
                      const k = n === 1 ? 1 : n === 2 ? 0.64 : n === 3 ? 0.5 : 0.42;
                      const cx = (40 / (n + 1)) * (i + 1);
                      return (
                        <G key={i}>
                          <Circle cx={cx} cy={10} r={(st.r + 6) * k} fill={color} opacity={st.opacity * 0.15} />
                          <Circle cx={cx} cy={10} r={(st.r + 3) * k} fill={color} opacity={st.opacity * 0.35} />
                          <Circle cx={cx} cy={10} r={st.r * k} fill={color} opacity={st.opacity} />
                        </G>
                      );
                    })}
                  </Svg>
                )}
              </View>
            );
          })}
        </View>
      ))}

      {/* ★ X 轴时间标签：和格子行等宽对齐（flex:1 + GAP 和格子一致）。
                       首尾用 absolute 贴根容器左右边缘（根容器无 paddingHorizontal），
                       中间用 flex:1。所有 Text 显式 lineHeight 保证等高 */}
      <View style={{
        flexDirection: 'row',
        marginTop: theme.sp(1),
        height: LABEL_H,
      }}>
        {hourCols.map((h, i) => {
          const displayH = h + 1;
          const isFirst = i === 0;
          const isLast  = i === COLS - 1;
          const showMiddle = !isFirst && !isLast && h % 4 === 0;
          const baseStyle: TextStyle = {
            fontSize: theme.fontSize.micro,
            color: theme.colors.textSub,
            textAlign: 'center',
            lineHeight: LABEL_H,  // ★ 显式 lineHeight —— 所有标签等高
          };
          // 首尾也返回空 flex spacer，保证 24 列和格子对齐
          const spacer = <Text key={h} style={{ flex: 1, marginRight: i < COLS - 1 ? GAP : 0, lineHeight: LABEL_H }} />;
          if (isFirst) {
            return (
              <React.Fragment key={h}>
                {spacer}
                <Text style={{
                  position: 'absolute',
                  left: 0, top: 0,
                  ...baseStyle,
                  fontWeight: theme.weight.medium,
                }}>1</Text>
              </React.Fragment>
            );
          }
          if (isLast) {
            return (
              <React.Fragment key={h}>
                {spacer}
                <Text style={{
                  position: 'absolute',
                  right: 0, top: 0,
                  ...baseStyle,
                  fontWeight: theme.weight.medium,
                }}>24</Text>
              </React.Fragment>
            );
          }
          if (!showMiddle) return spacer;
          return (
            <Text key={h} style={{
              flex: 1,
              ...baseStyle,
              fontWeight: theme.weight.medium,
              marginRight: i < COLS - 1 ? GAP : 0,
            }}>
              {displayH}
            </Text>
          );
        })}
      </View>

      {/* ★ 5 档情绪图例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: theme.sp(2), gap: theme.space.sm }}>
        {[
          { c: COL_EXCITED, t: '兴奋' },
          { c: COL_PLEASANT, t: '愉悦' },
          { c: COL_CALM, t: '平静' },
          { c: COL_STRESSED, t: '压力' },
          { c: COL_ANXIOUS, t: '焦虑' },
        ].map(({ c, t }) => (
          <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
            <Svg width={theme.sp(3)} height={theme.sp(3)}>
              <Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={c} opacity={0.9} />
            </Svg>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>{t}</Text>
          </View>
        ))}
      </View>

      {/* 口径提示：轴固定全天、睡眠只作浅底标注 → 圆点数恒等于下方「今日 N 次压力事件」 */}
      <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1) }}>
        横轴 0–23 点 · 浅底为睡眠时段（事件不隐藏，圆点数＝下方事件次数）
      </Text>
    </View>
  );
}

/**
 * 「情绪洞察」主体：全天情绪分布 + 4 项指标 + 口径注释 + 5 档说明。
 * 可选 anchorMs：传则展示该「锚定日」的全天（历史日 23:59:59.999，今天=此刻）；
 * 不传=今天（洞察页「情绪压力」tab 沿用默认，行为不变）。
 */
export default function EmotionInsightView({ anchorMs }: { anchorMs?: number } = {}) {
  const report: StressReport = computeStressReport(reportNowMsForDay(anchorMs ?? Date.now()));
  const color = levelColor(report.level);
  const hasData = report.sampleCount >= 5;

  if (!hasData) {
    return (
      <Card>
        <Text style={styles.emptyText}>
          还没有足够的 EDA 数据。连上戒指后开启自动监测，约 30 分钟后开始生成个人基线。
        </Text>
      </Card>
    );
  }

  // ★ 全天情绪分布 + 情绪洞察 合并为同一张卡片：
  //   洞察页「情绪压力」tab 与首页「情绪消耗」详情共用此视图，合并后两处仍完全一致。
  return (
    <Card padded={false}>
      <View style={styles.pad}>
        {/* 图在最上面 —— 全天情绪分布（5 档情绪点阵） */}
        {report.events.length > 0 && (
          <>
            <Text style={[styles.chartTitle, { fontSize: theme.fontSize.card, marginBottom: theme.sp(2) }]}>
              全天情绪分布
            </Text>
            <StressEventStems events={report.events} chartH={200} />
            {/* 与下方「情绪洞察」拉开间距，还原原两卡之间的视觉间隔 */}
            <View style={{ height: theme.sp(4) }} />
          </>
        )}

        {/* 情绪洞察：大分数 + 4 项子指标 + 口径注释 + 5 档说明 */}
        <Text style={styles.cardTitle}>情绪洞察</Text>
        {report.events.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>今日 {report.events.length} 次压力事件</Text>
          </View>
        )}

        <View style={styles.statGrid}>
          <StatCell
            label="情绪消耗"
            value={report.emotionalLoad != null ? `${report.emotionalLoad}` : '—'}
            sub={report.emotionalLoad != null
              ? (report.emotionalLoad > 60 ? '高消耗 · 需要休息' : report.emotionalLoad > 30 ? '中等 · 恢复较快' : '低消耗 · 状态良好')
              : ''}
            valueColor={report.emotionalLoad != null && report.emotionalLoad > 60 ? theme.colors.danger : undefined}
          />
          <StatCell
            label="恢复时间"
            value={report.avgRecoverySec != null ? `${report.avgRecoverySec}s` : '—'}
            sub={report.avgRecoverySec != null && report.avgRecoverySec > 120 ? '偏慢' : '正常'}
          />
          <StatCell
            label="峰值时段"
            value={report.peakHour != null ? `${String(Math.floor(report.peakHour)).padStart(2, '0')}:00` : '—'}
            sub={report.peakHour != null ? '事件最多' : ''}
          />
          <StatCell
            label="唤醒分"
            value={
              report.level === 'calm' ? '平静' :
              report.level === 'mild' ? '轻度唤醒' :
              report.level === 'moderate' ? '中度唤醒' :
              report.level === 'high' ? '高度唤醒' : '—'
            }
            valueColor={color}
            sub={
              report.level === 'calm' ? '唤醒分<45 · 身心放松' :
              report.level === 'mild' ? '唤醒分 45–55 · 正常活动' :
              report.level === 'moderate' ? '唤醒分 55–65 · 有些紧张' :
              report.level === 'high' ? '唤醒分>65 · 焦虑/兴奋' : ''
            }
          />
        </View>

        {/* ★ 指标口径注释 */}
        <View style={{ marginTop: theme.sp(2), gap: theme.sp(1) }}>
          <Text style={styles.note}>
            {'● 情绪消耗（0–100）：0–30 低消耗 · 31–60 中等消耗 · 61–100 高消耗'}
          </Text>
          <Text style={styles.note}>
            {'● 唤醒分（0–100）：<45 平静 · 45–55 轻度唤醒 · 55–65 中度唤醒 · >65 高度唤醒'}
          </Text>
          <Text style={styles.note}>
            {'● 计算因子：事件密度 · 平均强度 · HRV 偏离 · 交感(sns)偏离 · SCR 恢复 · 皮质醇偏离 · 疲劳偏离（各因子等权，以个人 2 日基线为参考）'}
          </Text>
        </View>

        {/* ★ 5 档情绪说明 */}
        <View style={{ marginTop: theme.sp(1.5), gap: theme.sp(0.5) }}>
          <Text style={styles.catTitle}>情绪分类（5 档）</Text>
          <Text style={styles.note}>{'兴奋 / 愉悦 / 平静 · 压力 / 焦虑'}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { padding: theme.space.cardPad },
  cardTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(2),
  },
  chartTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1),
  },
  badge: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.stateTense + '22',
    alignSelf: 'flex-start',
    marginBottom: theme.sp(2),
  },
  badgeText: { fontSize: theme.fontSize.micro, color: theme.colors.stateTense },

  statGrid: { flexDirection: 'row' },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2),
    paddingHorizontal: theme.sp(1),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
    marginHorizontal: theme.sp(0.5),
  },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  statValue: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    lineHeight: theme.fontSize.card * 1.2,
    textAlign: 'center',
  },
  statSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
    textAlign: 'center',
    lineHeight: theme.fontSize.micro * 1.4,
  },

  note: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: theme.fontSize.xs * 1.5 },
  catTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textInkSoft, fontWeight: theme.weight.medium as any },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },
});
