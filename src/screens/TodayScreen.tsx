import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground, Animated, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Rect, Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const IMG_RECOVERY = require('../assets/card_recovery.jpg');
const IMG_EMOTION = require("../assets/card_emotion_new.png");
const IMG_COG = require("../assets/card_focus.jpg");
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
import Card from '../components/Card';
import GlassCard from '../components/GlassCard';
import Icon from '../components/Icon';
import EnergyBall from '../components/EnergyBall';
import SleepRhythmHomeCard from '../components/SleepRhythmHomeCard';
import SleepCard from '../components/SleepCard';
import { loadPeriodDays } from '../data/cycleLog';
import MindChips, { type MindChipItem } from '../components/MindChips';
import MindStatCard from '../components/MindStatCard';
import BentoCard from '../components/BentoCard';
import EmotionDots, { type MindMoodKey } from '../components/EmotionDots';
import MindWave from '../components/MindWave';
import TrendChart, { TrendAxis } from '../components/TrendChart';
import TodayTimelineCard, { type TimelineItem } from '../components/TodayTimelineCard';
import { MOODS } from '../data/metrics';
import { computeStressReport } from '../lib/stressAlgorithm';
// ★ v18.132：情绪压力改多信号融合判定（分离运动/设备故障），替代单信号 EDA 事件计数
import { computeEmotionalStress, LEVEL_LABEL, MIN_BASELINE_DAYS as ES_MIN_BASELINE_DAYS } from '../lib/emotionalStress';
import { computeCognitiveLoadReport, COG_LEVEL_LOW, COG_LEVEL_HIGH, cogLevelLabel, cogBarRatio } from '../lib/cognitiveLoad';
// ★ 认知准备度（2026-10-05）：首页「脑力」卡由「疲劳」改为「准备度」，柱状图改趋势图
import { computeReadinessSeries, readinessLevelLabel } from '../lib/cognitiveReadiness';
import MiniReadinessTrend from '../components/MiniReadinessTrend';
import { computeSleepPersonalized, sleepRecoveryTag } from '../lib/sleepPersonalized';
import { RingBle, type RingSportSession } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore'
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from '../components/CortisolRhythmCard';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { getAiInsight } from '../ai/insight';
import { MemoryStore } from '../ai/memory';
import { inferThemes } from '../ai/miraAi';
import { onAiRecord } from '../lib/aiRecordBus';
import { evaluateTodayScene, markSceneShown, initTodaySceneCounter, buildCauseNarrative, type TodayScene } from '../lib/todayScene';
import { resolveSportName } from '../lib/veepooSportTypes';
import { sportVisualOf } from '../lib/sportVisual';

/** 「今日日历」取的 AI 聊天记录（MemoryStore 单例，避免每次渲染重建） */
const memoryStore = new MemoryStore();

/** ★ 睡眠卡显示开关（2026-10-05）：用户要求**先隐藏、代码保留**。
 *  改回 true 即恢复原样 —— 组件、props、数据口径都没有改动，只是不渲染。
 *  注意：这不影响「睡眠恢复」chip（第一屏）与 EmotionCognitiveDetail 详情页。 */
const SHOW_SLEEP_CARD: boolean = false;


function EnergyMiniCard({ title, subtitle, accent, icon, value, unit, onPress, image }: {
  title: string; subtitle: string; accent: string; icon: import('../components/Icon').IconName; value: string; unit: string; onPress: () => void; image?: number;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <ImageBackground
        source={image || require('../assets/card_stress.jpg')}
        style={styles.energyMini}
        imageStyle={styles.energyMiniImg}
        resizeMode="cover"
      >
        {/* 底部渐变遮罩 */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
          style={styles.energyMiniOverlay}
        />
        <View style={styles.energyMiniLabel}>
          <Text style={styles.energyMiniTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.energyMiniValRow}>
            <Text style={styles.energyMiniVal}>{value}</Text>
            <Text style={styles.energyMiniUnit}> {unit}</Text>
          </View>
        </View>
      </ImageBackground>
    </TouchableOpacity>
  );
}


// ⚠️⚠️ **死代码，勿在此加逻辑或日志**（2026-10-03 实锤）
// `grep -nE "EnergyRowData" src/screens/TodayScreen.tsx` 只有这一行定义处命中 ——
// 它**从未被任何地方渲染**。v18.133 我把运动门控诊断加在这里，`grep 'MOTION-GATE'`
// 连续两轮 0 条日志，白排查一轮。真渲染的是下面 ~1140 行处（同文件另一个组件作用域）。
// 要改「顶部情绪压力」请去那里；要删这个组件请连同它的 esReport/stress/cognitive 一起删。
function EnergyRowData({ ring, onNav, outerOnNav }: { ring: any; onNav: (type: 'emotion' | 'cognitive' | 'activity') => void; outerOnNav: () => void }) {
  const _dk = (() => {
    try {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch { return ''; }
  })();
  // 情绪消耗 = 今日压力事件数
  // ★ v18.132 情绪压力：值改为「今日程度 0-100」（由 EDA 相对个人基线的偏离换算），
  //   不再显示「事件次数 19」—— 次数没有量纲意义，且 2026-10-03 设备漂 3 倍时全被误触发。
  //   数据源 = computeEmotionalStress()（多信号融合：排除运动 / 设备故障）。
  // ★ v18.133：把固件运动段传进去 —— 少了它，运动门控只剩 MET/步数两层，
  //   「通勤走路」这类步数不多但确有活动的时段会被误判成情绪压力。
  const esReport = (() => {
    try {
      return computeEmotionalStress(Date.now(), ring?.sportSessions ?? null);
    } catch { return null; }
  })();
  // ★ v18.140 心理压力数字：**必须过自报校准闸门**。
  //   `stressScoreVisible=false`（样本不足 / r 太低）⇒ 显「—」，只保留档位。
  //   ⚠ 死代码里的这个组件不参与渲染，但保持与 ~1200 行处口径一致，避免以后误用。
  const stress = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return '—';
      if (!esReport || esReport.deviceDrift) return '—';
      if (esReport.baselineDays < ES_MIN_BASELINE_DAYS) return '—';
      if (!esReport.stressScoreVisible) return '—';
      return esReport.meanSeverity != null ? String(esReport.meanSeverity) : '—';
    } catch { return '—'; }
  })();
  // 脑力消耗 = 全天平均疲劳度 (与柱状图同源, 0-100)
  const cognitive = (() => {
    try {
      const r = computeCognitiveLoadReport();
      return r?.avgFatigue != null ? String(r.avgFatigue) : '—';
    } catch { return '—'; }
  })();
  // 运动消耗 = 今日步数
  const activity = (() => {
    try {
      const dk = dayKey(Date.now());
      const steps = ring?.stepDaily?.[dk]?.steps ?? 0;
      return steps > 0 ? String(steps) : '—';
    } catch { return '—'; }
  })();

  // 皮质醇峰值 + 恢复水平
  const cortisolPeak = (() => {
    try {
      const samples = collectSamples();
      const r = analyzeCortisol(samples, 14);
      if (Number.isFinite(r.cosinor.acrophaseH)) {
        const h = Math.round(r.cosinor.acrophaseH);
        return `${String(h).padStart(2,'0')}:00`;
      }
      return '—';
    } catch { return '—'; }
  })();
  const cortisolRecovery = (() => {
    try {
      const samples = collectSamples();
      const r = analyzeCortisol(samples, 14);
      if (r.css > 10) return '良好';
      if (r.css < -10) return '偏晚';
      if (Number.isFinite(r.cosinor.amplitude) && Number.isFinite(r.cosinor.mesor) && r.cosinor.amplitude < 0.15 * r.cosinor.mesor) return '扁平';
      return '一般';
    } catch { return '—'; }
  })();

  // 子卡（心理压力/脑力）——图片背景 + 底部白色渐变蒙层
  // ★ v18.137：心理压力卡多一行**口径说明**（「相对你自己平时」）。
  //   没有这一行，用户会把 62 读成「压力 62 分」（绝对量），而它其实是百分位。
  //   `note` 为空则不占位（其它两张卡不受影响）。
  const subCard = (
    img: number, title: string, val: string, unit: string, onPress: () => void,
    note?: string,
  ) => (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={{ flex: 1 }}>
      <View style={{
        height: 130,
        borderRadius: theme.radius.md,
        overflow: 'hidden',
      }}>
        <ImageBackground source={img} style={{ height: '100%', width: '100%' }} resizeMode="cover">
          {/* 底部白色蒙层：只盖下半部，保证文字可读 */}
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0.75)', '#FFFFFF']}
            locations={[0.15, 0.45, 0.75, 1.0]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '95%' }}
          />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 10, paddingTop: 40 }}>
            <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.medium, marginBottom: 2 }} numberOfLines={1}>{title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ color: theme.colors.textInk, fontSize: theme.fontSize.card, fontWeight: theme.weight.bold }} numberOfLines={1} adjustsFontSizeToFit>{val}</Text>
              <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs, marginLeft: 3 }}>{unit}</Text>
            </View>
            {note ? (
              <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs, marginTop: 1 }} numberOfLines={1}>{note}</Text>
            ) : null}
          </View>
        </ImageBackground>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: theme.space.md, marginBottom: theme.space.md }}>
      {/* ★ 身体恢复 —— 参考情绪消耗卡：完整图片做背景 + 左白色渐变蒙层 + 文字 */}
      <TouchableOpacity activeOpacity={0.85} onPress={outerOnNav}>
        <Card padded={false} style={{ borderWidth: 0, shadowColor: "transparent", shadowOpacity: 0, elevation: 0 }}>
          <ImageBackground source={IMG_RECOVERY} style={{ height: 132 }} resizeMode="cover">
            {/* 白色蒙层：左纯白 → 右渐变透明，模糊过渡 */}
            <LinearGradient
              colors={[
                '#FFFFFF',
                'rgba(255,255,255,0.95)',
                'rgba(255,255,255,0.85)',
                'rgba(255,255,255,0.15)',
                'rgba(255,255,255,0)',
              ]}
              locations={[0, 0.25, 0.5, 0.75, 1.0]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            />
            {/* 右上角跳转指示 */}
            <Icon name="chevronRight" size={20} color={theme.colors.textTitle} style={{ position: 'absolute', top: 12, right: 12 }} />
            {/* 文字叠在蒙层上 — 贴底部集中在白色区域，排版与 subCard 完全一致 */}
            <View style={{ position: 'absolute', left: theme.space.cardPad, right: theme.space.md, bottom: 12, paddingTop: 40 }}>
              {/* 顶部标题 */}
              <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.medium, marginBottom: 6 }}>身体恢复</Text>
              {/* 皮质醇峰值 — 单列竖排，与 subCard title+value+unit 排版一致 */}
              <View style={{ marginTop: 2 }}>
                <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.medium, marginBottom: 2 }} numberOfLines={1}>皮质醇峰值</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={{ color: theme.colors.textInk, fontSize: theme.fontSize.card, fontWeight: theme.weight.bold }} numberOfLines={1} adjustsFontSizeToFit>{cortisolPeak}</Text>
                  <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs, marginLeft: 3 }}>点</Text>
                </View>
              </View>
            </View>
          </ImageBackground>
        </Card>
      </TouchableOpacity>

      {/* ★ 心理压力 / 脑力准备度 / 运动量 —— 并排独立小卡
          v18.137：情绪卡从「情绪消耗·次」改为「心理压力·0-100 百分位」。
          旧标题的问题：①「消耗」没定义 ②单位「次」与 0-100 分数矛盾（用户反馈「看不懂」）
          ③「心理压力」是 Oura/Garmin 在用的标准名。 */}
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {subCard(
          IMG_EMOTION, '心理压力', stress, '',
          () => onNav('emotion'),
          esReport?.stressScale ? esReport.stressScale.caption : undefined,
        )}
        {/* ★ 2026-10-06 A+C：无昨夜睡眠时 sublabel 改「今日已用脑」，避免与"剩余"口径混淆 */}
        {subCard(IMG_COG, '脑力消耗', cognitive, '/100', () => onNav('cognitive'),
          (() => {
            try {
              const rep = computeCognitiveLoadReport();
              return rep?.brainRemaining != null ? '当前剩余' : rep?.brainUsedToday != null ? '今日已用脑' : '当前剩余';
            } catch { return '当前剩余'; }
          })())}
        {subCard(IMG_ACTIVITY, '运动量', activity, '步', () => onNav('activity'))}
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// 智能建议：结合经期相位 + 能量等级 + **时段** → 双分句短句
// ★ 时段优先：晚(18-22)/深夜(22-6) 一律休息导向，不管相位和能量等级
//   （1.5B 小模型搞不定优先级链，规则确定性兜底避免幻觉）
function buildSmartAdvice(phase: string, statusIdx: number | null, asleep: boolean): string {
  if (asleep) {
    if (phase === '经期') return '经期睡眠中，安心休息助修复';
    if (phase === '黄体期') return '黄体期睡眠中，深睡稳情绪';
    return '睡眠恢复中，安心休息';
  }

  const h = new Date().getHours();
  const isEvening = h >= 18 && h < 22;
  const isNight = h >= 22 || h < 6;
  const low = statusIdx != null && statusIdx >= 2;
  const high = statusIdx === 0;

  // 时段优先：傍晚/深夜 → 休息导向
  if (isEvening || isNight) {
    if (phase === '经期')     return '收工放松，别安排高强度活动';
    if (phase === '卵泡期')   return '适合轻松阅读，早点休息养精蓄锐';
    if (phase === '排卵期')   return '今日社交已够，收工放松别熬夜';
    if (phase === '黄体期')   return '情绪易起伏，做些轻量放松后早点休息';
    return '收工放松，别熬夜';
  }

  // 白天：相位 × 能量等级 组合
  const map: Record<string, { ok: string; low: string; high: string }> = {
    经期:     { ok: '放缓节奏，温和整理与复盘', low: '以休息为主，避免高强度安排', high: '适度活动，有助缓解经期不适' },
    卵泡期:   { ok: '精力回升，适合开启新计划', low: '轻度规划，别给自己太大压力', high: '精力峰值，推进项目和头脑风暴' },
    排卵期:   { ok: '状态活跃，社交沟通黄金窗口', low: '适合一对一沟通，重大决策可稍缓', high: '能量情商双高，谈判汇报都是黄金时机' },
    黄体期:   { ok: '专注执行收尾，留意情绪起伏', low: '轻松事务为主，别做重大决策', high: '适合深度工作，别熬夜' },
  };

  const entry = map[phase];
  if (!entry) return '记录经期后，为你提供周期专属建议';
  return low ? entry.low : high ? entry.high : entry.ok;
}

// ─────────────────────────────────────────────────────────────
// ★ 模块级组件：必须放在组件外部。
//   反例（2026-09-20 修）：这些组件原先定义在 TodayScreen 内部，导致每次 setState
//   都产生「新的组件类型」，React 会把整棵 SVG 子树卸载重建 —— 这是整屏卡顿的根因。
//   新增图表/卡片一律写在模块作用域，并用 React.memo 包裹。
// ─────────────────────────────────────────────────────────────
// 通用 mini chart 尺寸
const MW=168, MH=88, AXIS_H=16, CH=MH-AXIS_H;

// —— 情绪消耗：每小时压力事件数柱状图（柱高=次数，颜色=低/中/高三档）——
//   ★ 为什么不用点阵：每小时在图上只有 7px 宽，3 个事件画 3 个点必然挤成一坨糊点，
//     看上去像一块「小热力图」，与卡片上的「N 次」对不上。
//     改成柱状后：柱高 = 该小时事件数，24 根柱高之和正好 = 卡片大数字（次数），两者同源。
const MiniStressBars = React.memo(function MiniStressBars({ events, condensed }: { events: any[]; condensed?: boolean }) {
  const W = condensed ? 80 : MW;
  const H = condensed ? 44 : MH;
  const AX = condensed ? 0 : AXIS_H;
  const CH = H - AX;
  const N=24, bw=W/N-1, CAP=5;              // CAP: 每小时 5 次事件 = 柱满高
  const ev = (events ?? []).filter((e:any)=>e&&Number.isFinite(e.t));
  const cnt = new Array(N).fill(0);
  ev.forEach((e:any)=>{
    const h = new Date(e.t).getHours();
    if (h >= 0 && h < N) cnt[h] += 1;
  });
  const bars: any[] = [];
  for (let h = 0; h < N; h++) {
    if (cnt[h] === 0) continue;
    const bh = Math.max(3, Math.min(1, cnt[h] / CAP) * CH);
    // 颜色 = 该小时「事件数」低/中/高三档（与卡片数字同口径，不再用严重度色）
    const col = cnt[h] >= 4 ? theme.colors.danger : cnt[h] >= 2 ? theme.colors.warn : theme.colors.success;
    bars.push(<Rect key={'b'+h} x={h*(W/N)+0.5} y={CH-bh} width={bw} height={bh} rx={1.5} fill={col} />);
  }
  const peakH = cnt.indexOf(Math.max(...cnt));
  const popX = peakH*(W/N)+bw/2;
  // ★ NaN 防御：Math.max/min 遇 NaN 会原样传播，NaN 一旦进入 left/x 就是 native 红屏
  //   （此前的 RNSVGText x=NaN / RCTView left=NaN 红屏即此路径）
  const PopX = Number.isFinite(popX) ? Math.max(18, Math.min(W-36, popX-14)) : 0;
  const ticks=[0,6,12,18,24];
  return (
    <View style={{ width: W, height: H }}>
      <Svg width={W} height={H}>
        {bars}
        {!condensed && ticks.map(h=>{ const eL=h===0,eR=h===24; return (<SvgText key={'t'+h} x={eL?1:eR?W-1:h*(W/N)+bw/2} y={CH+AX-3} textAnchor={eL?'start':eR?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.55)">{String(h).padStart(2,'0')}</SvgText>); })}
      </Svg>
      {!condensed && ev.length>0 ? (
        <View style={{ position:'absolute', left: PopX, top: -4, backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor: theme.colors.stateTense + '44' }}>
          <Text style={{ fontSize:10, color: theme.colors.stateTense, fontWeight:'700' }}>{ev.length} 次</Text>
        </View>
      ):null}
    </View>
  );
});

// —— 脑力消耗：24h 柱状 + 横坐标 + 峰值 pop ——
// ★ hour = 钟点 0–23（computeHourlyLoad 已收敛为 24 整点桶）；柱色与详情页大图、Hero 共用
//   统一三档：低<40 绿 / 中 40–70 黄 / 高≥70 红（COG_LEVEL_LOW / COG_LEVEL_HIGH）
// 无真实数据时的空骨架数据源（模块级常量，引用稳定不触发 memo 重绘）
// ★ 2026-10-06：准备度粒度统一为 30 分钟 → 48 槽
const COG_EMPTY_HOURLY = Array.from({ length: 48 }, (_, h) => ({ hour: h, score: 0, hasData: false }));
const MiniCognitiveBars = React.memo(function MiniCognitiveBars({ hourly, condensed }: { hourly: { hour: number; score: number; hasData?: boolean }[]; condensed?: boolean }) {
  // ★ 宽度 onLayout 实测：固定 168 会超出半宽卡片内框（横坐标「24」溢出卡片边界）
  const [measuredW, setMeasuredW] = React.useState(0);
  const W = condensed ? 80 : measuredW;
  const H = condensed ? 44 : MH;
  const AX = condensed ? 0 : AXIS_H;
  const CH = H - AX;
  const N=24;
  const rows = Array.from({length:N},(_,i)=>{ const b:any = hourly?.find((h:any)=>h.hour===i); return { v: b?.score ?? 0, has: !!b?.hasData }; });
  const bw=W/N-1;
  // ★ 峰值/最新值只取「有实测」的小时；睡眠段与未到时段的占位桩不算数据
  const lastIdx = rows.map((r,i)=>({...r,i})).filter(x=>x.has).slice(-1)[0]?.i ?? 0;
  const popVal = rows[lastIdx]?.v ?? 0;
  const hasAny = rows.some(r=>r.has);
  const popX = lastIdx*(W/N)+bw/2;
  const PopX = Number.isFinite(popX) ? Math.max(18, Math.min(W-36, popX-14)) : 0;
  const ticks=[0,6,12,18,24];
  const barColor = (v:number)=> v>=COG_LEVEL_HIGH ? theme.colors.danger : v>=COG_LEVEL_LOW ? theme.colors.warn : theme.colors.success;
  const NO_DATA = 'rgba(120,110,160,0.13)';   // 无实测时段(睡眠/未到) = 浅灰占位，不用彩色
  return (
    <View
      onLayout={!condensed ? (e) => { const cw = e.nativeEvent.layout.width; if (cw > 0 && Math.abs(cw - measuredW) > 1) setMeasuredW(cw); } : undefined}
      style={{ width: condensed ? 80 : '100%', height: H }}
    >
      {!condensed && W <= 0 ? null : (
      <>
      <Svg width={W} height={H}>
        {/* ★ v18.129 柱高改**档位离散**（用户：只分低/中/高三个高度，同档等高）。
            原先用 (r.v/100)*CH 连续映射 → 12/16/19 同属「低」档却画出三根不同高度，
            视觉上像在说 19 比 12 累得多（同档内无此含义）。现在高度只由档位决定。 */}
        {rows.map((r,i)=>{ const ratio=r.has?cogBarRatio(r.v):null;
          const h=ratio==null?1.5:Math.max(2,ratio*CH), x=i*(W/N)+0.5, y=CH-h;
          const col=r.has?barColor(r.v):NO_DATA; return <Rect key={'b'+i} x={x} y={y} width={bw} height={h} rx={1} fill={col} />; })}
        {ticks.map(h=>{ const eL=h===0,eR=h===24; return (<SvgText key={'t'+h} x={eL?1:eR?W-1:h*(W/N)+bw/2} y={CH+AX-3} textAnchor={eL?'start':eR?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.6)">{String(h).padStart(2,'0')}</SvgText>); })}
      </Svg>
      {!condensed && hasAny && popVal>0 ? (
        <View style={{ position:'absolute', left: PopX, top: -2, backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor: theme.colors.accentSolid + '33' }}>
          <Text style={{ fontSize:10, color: theme.colors.stateTired, fontWeight:'700' }}>{Math.round(popVal)}</Text>
        </View>
      ):null}
      </>
      )}
    </View>
  );
});

// —— v18.52 经期日期圈（参考图 Activity 卡的圆圈行）：最近 7 天，圈 = 日期数字。
//   经期日（有 PeriodDayLog 自记）= lime 深色实心白字；今天 = 深色描边；其余白底。
const PeriodDayCircles = React.memo(function PeriodDayCircles({ marked }: { marked: Record<string, true> }) {
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const todayKey = keyOf(new Date());
  return (
    <View style={styles.pdRow}>
      {days.map((d) => {
        const k = keyOf(d);
        const isPeriod = !!marked[k];
        const isToday = k === todayKey;
        return (
          <View
            key={k}
            style={[
              styles.pdCircle,
              isPeriod && { backgroundColor: mm.chipBg.lav.fg },
              isToday && !isPeriod && { borderWidth: 2, borderColor: mm.chipBg.lav.fg },
            ]}
          >
            <Text style={[styles.pdCircleText, isPeriod && { color: mm.colors.cardBg }]}>{d.getDate()}</Text>
          </View>
        );
      })}
    </View>
  );
});

// —— 运动消耗：近 7 天步数曲线 + 横坐标(一二三四五六日) + 今日 pop ——
// ★ 全零步数 = 无数据态：只画灰色虚线基线 + 横坐标（不画蓝色实曲线，不冒充数据）
const MiniActivityCurve = React.memo(function MiniActivityCurve({ weekSteps, condensed }: { weekSteps: { dayKey: string; steps: number; date: Date }[]; condensed?: boolean }) {
  const W = condensed ? 80 : MW;
  const H = condensed ? 44 : MH;
  const AX = condensed ? 0 : AXIS_H;
  const CH = H - AX;
  const series = weekSteps.slice(-7);
  // ★ 防御：不足 7 天（新装/数据缺失）时按实际条数画，避免 pts[N-1] 为 undefined 直接崩溃
  if (series.length < 2) return null;
  const N = series.length, MON=['一','二','三','四','五','六','日'];
  const steps = series.map(s=>s.steps);
  const isEmpty = !steps.some(v=>v>0);
  const max = Math.max(1,...steps);
  const pts = steps.map((v,i)=>({x:(i/(N-1))*(W-8)+4, y:CH-(v/max)*CH*0.85-3}));
  let p = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for(let i=0;i<N-1;i++){ const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(N-1,i+2)]; p+=` C ${(p1.x+(p2.x-p0.x)*0.25).toFixed(1)} ${(p1.y+(p2.y-p0.y)*0.25).toFixed(1)}, ${(p2.x-(p3.x-p1.x)*0.25).toFixed(1)} ${(p2.y-(p3.y-p1.y)*0.25).toFixed(1)}, ${p2.x.toFixed(1)} ${pts[i+1].y.toFixed(1)}`; }
  const area = p+` L ${pts[N-1].x.toFixed(1)} ${CH} L ${pts[0].x.toFixed(1)} ${CH} Z`;
  const last = pts[N-1];
  const PopX = Number.isFinite(last.x) ? Math.max(18, Math.min(MW-48, last.x-20)) : 0;
  return (
    <View style={{ width: W, height: H }}>
      <Svg width={W} height={H}>
        {!isEmpty && (
          <Defs>
            <SvgLinear id="actFill2" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#7EA6F8" stopOpacity={0.35} />
              <Stop offset="100%" stopColor="#7EA6F8" stopOpacity={0.02} />
            </SvgLinear>
          </Defs>
        )}
        {isEmpty ? (
          <Path d={`M ${pts[0].x.toFixed(1)} ${CH-3} L ${pts[N-1].x.toFixed(1)} ${CH-3}`} fill="none" stroke="rgba(120,110,160,0.35)" strokeWidth={1.5} strokeDasharray="4 4" />
        ) : (
          <>
            <Path d={area} fill="url(#actFill2)" />
            <Path d={p} fill="none" stroke="#7EA6F8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((pt,i)=>(<Circle key={'pt'+i} cx={pt.x} cy={pt.y} r={2.5} fill="#7EA6F8" />))}
          </>
        )}
        {series.map((s,i)=>(<SvgText key={'t'+i} x={pts[i].x} y={CH+AX-3} textAnchor={i===0?'start':i===N-1?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.6)">{MON[s.date.getDay()===0?6:s.date.getDay()-1]}</SvgText>))}
      </Svg>
      {!condensed && !isEmpty && steps[N-1]>0 ? (
        <View style={{ position:'absolute', left: PopX, top: Math.max(0,last.y-22), backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor:'rgba(126,166,248,0.25)' }}>
          <Text style={{ fontSize:10, color: theme.colors.stateTired, fontWeight:'700' }}>{steps[N-1]}</Text>
        </View>
      ):null}
    </View>
  );
});

const BigStatCard = React.memo(function BigStatCard({ title, value, unit, sub, trend, chartEl, gradientColors, onPress, height, layout }: any) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressTo = (v: number) =>
    Animated.timing(pressScale, { toValue: v, duration: theme.motion.instant, easing: theme.motion.easeStandard, useNativeDriver: true }).start();
  const h = height ?? 150;
  const isHorizontal = layout === 'horizontal';
  const isBig = h >= 200;
  const titleSize = isBig ? theme.fontSize.body : theme.fontSize.sm;
  const padH = isBig ? theme.space.md : theme.space.sm;
  const padV = isBig ? theme.space.sm : theme.space.xs;

  if (isHorizontal) {
    // ★ 横卡:left = title + 数字 + caption(weight 1), right = chartEl(weight ~0.7)
    const numFont = h >= 110 ? 30 : 26;
    const unitFont = h >= 110 ? theme.fontSize.sm : theme.fontSize.micro;
    return (
      <Pressable onPress={onPress} onPressIn={() => pressTo(theme.press.scaleCard)} onPressOut={() => pressTo(1)}
        style={{ width: '100%' }} accessibilityRole="button" accessibilityLabel={`${title} ${value}${unit}`}>
        <Animated.View style={{ transform: [{ scale: pressScale }] }}>
          <GlassCard padded={false} style={{ height: h }}>
            <LinearGradient colors={gradientColors} start={{ x: 0.5, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
            <View style={{ paddingHorizontal: padH, paddingVertical: padV, flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              {/* 左侧:title + 数字 + caption + trend */}
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.colors.textInk, fontSize: titleSize, fontWeight: theme.weight.semibold }} numberOfLines={1}>{title}</Text>
                  {trend ? (
                    <Text style={{
                      color: trend.dir === 'flat' ? theme.colors.textSub : (trend.favorable ? theme.colors.trendUp : theme.colors.trendDown),
                      fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold,
                      backgroundColor: trend.favorable ? theme.colors.successSoft : trend.dir === 'down' ? theme.colors.dangerSoft : 'transparent',
                      paddingHorizontal: 6, paddingVertical: 1, borderRadius: theme.radius.pill,
                    }}>
                      {trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '—'} {trend.label}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                  <Text style={{ color: theme.colors.textInk, fontSize: numFont, fontWeight: theme.weight.bold, lineHeight: numFont + 4 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                  <Text style={{ color: theme.colors.textSub, fontSize: unitFont, marginLeft: 3 }}>{unit}</Text>
                </View>
                {!!sub && <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: 2 }} numberOfLines={1}>{sub}</Text>}
              </View>
              {/* 右侧:图 */}
              {chartEl && <View style={{ width: '38%', alignItems: 'stretch', marginLeft: padH * 0.6 }}>{chartEl}</View>}
            </View>
          </GlassCard>
        </Animated.View>
      </Pressable>
    );
  }

  /* 方案3 固定比例:title ~10% / 图 ~45% / gap / 数字 ~35% */
  const chartAreaH = isBig ? 88 : 44;
  const numAreaH = isBig ? 52 : 34;
  return (
    <Pressable onPress={onPress} onPressIn={() => pressTo(theme.press.scaleCard)} onPressOut={() => pressTo(1)}
      style={{ width: '100%' }} accessibilityRole="button" accessibilityLabel={`${title} ${value}${unit}`}>
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <GlassCard padded={false} style={{ height: h }}>
          <LinearGradient colors={gradientColors} start={{ x: 0.5, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
          <View style={{ paddingHorizontal: padH, paddingTop: padV, paddingBottom: padV * 0.6, flexDirection: 'column' }}>
            {/* 顶行:title + trend badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 22 }}>
              <Text style={{ color: theme.colors.textInk, fontSize: titleSize, fontWeight: theme.weight.semibold }} numberOfLines={1}>{title}</Text>
              {trend ? (
                <Text style={{
                  color: trend.dir === 'flat' ? theme.colors.textSub : (trend.favorable ? theme.colors.trendUp : theme.colors.trendDown),
                  fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold,
                  backgroundColor: trend.favorable ? theme.colors.successSoft : trend.dir === 'down' ? theme.colors.dangerSoft : 'transparent',
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill,
                }}>
                  {trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '—'} {trend.label}
                </Text>
              ) : null}
            </View>
            {/* 中间:图固定高 */}
            {chartEl && <View style={{ height: chartAreaH, marginTop: isBig ? 6 : 4, alignItems: 'stretch' }}>{chartEl}</View>}
            <View style={{ height: isBig ? 8 : 4 }} />
            {/* 底部:数字区 */}
            <View style={{ height: numAreaH, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ color: theme.colors.textInk, fontSize: isBig ? 34 : 22, fontWeight: theme.weight.bold, lineHeight: isBig ? 38 : 26 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                <Text style={{ color: theme.colors.textSub, fontSize: isBig ? theme.fontSize.sm : theme.fontSize.micro, marginLeft: 3 }}>{unit}</Text>
              </View>
              {!!sub && <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: isBig ? 3 : 1 }} numberOfLines={1}>{sub}</Text>}
            </View>
          </View>
        </GlassCard>
      </Animated.View>
    </Pressable>
  );
});

/**
 * ★ 全天状态面板底部圆弧的「羽化层」（2026-09-21）。
 * 目的：白面板与弧下紫雾之间原来是**几何硬切**（像素级突变），用户反馈「边缘过于清晰」。
 * 做法：把同一条弧路径**多层下移 + 逐层降 alpha** 叠在白、紫之间，硬边被摊成一条 ~12pt 的过渡带，
 *      形成「白 → 淡紫 → 主题紫」的自然弥散。
 * 为什么不用 SVG filter（高斯模糊）：react-native-svg 的 Filter 平台支持/性能都不稳，多路径叠加零风险。
 * 调参：层数（长度）、`dy` 步长（过渡带宽度）、`opacity` 区间（柔化强度）三处。
 */
const ARC_FEATHER = Array.from({ length: 6 }, (_, i) => ({
  /** 越靠下（i 越小）下移越多、越淡 */
  dy: theme.sp(0.5) * (6 - i),
  opacity: 0.12 + (i / 5) * 0.66,
}));

export default function TodayScreen() {
  const { width } = useWindowDimensions();

  // ─────────────────────────────────────────────────────────────
  // ★ 滚动联动（2026-09-20 新增）。所有插值只驱动 opacity / transform → 走**原生驱动**，
  //   滚动过程中 JS 线程不参与。强度就下面这几个数字，调整改这里即可：
  //     头部：scrollY 0 → 110px 淡出 1 → 0，同时上移 0 → -14px（给出「离开」的动势）
  //   顶部「化入」遮罩已经统一收进 ScreenContainer（所有页面共用），这里只需传白色覆盖默认的 bgTop。
  //   注意：动效只跟「位置」有关，不跟时间，所以上下滑都成立、不消耗额外性能。
  // ─────────────────────────────────────────────────────────────
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });
  const dims = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [chartW, setChartW] = useState(0);
  const [todayTab, setTodayTab] = useState<'rhythm' | 'diary'>('rhythm');
  // ★ v18.52 经期日期圈：真实自记经期日（PeriodDayLog 按日期 key），最近 7 天圈行用
  const [periodMarks, setPeriodMarks] = useState<Record<string, true>>({});
  useEffect(() => {
    let alive = true;
    loadPeriodDays()
      .then((p) => { if (alive) setPeriodMarks(Object.fromEntries(Object.keys(p).map((k) => [k, true as const]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [ring, setRing] = useState(() => RingBle.getState());

  // ★ 今日日历数据源之二：今天与 Mira 的对话记录（MemoryStore）
  //   写入发生在 miraAi.ask 结束（memory.add）后 → 经 aiRecordBus 广播即时刷新；
  //   另外每次回到首页（focus）再兜底拉一次，覆盖在别的页面聊天的情况。
  const [aiRecords, setAiRecords] = useState<{ text: string; ts: number }[]>([]);
  const loadAiRecords = useCallback(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    memoryStore
      .listSince(start.getTime())
      .then(setAiRecords)
      .catch(() => setAiRecords([]));
  }, []);
  useEffect(() => {
    loadAiRecords();
    return onAiRecord(loadAiRecords);
  }, [loadAiRecords]);
  useFocusEffect(useCallback(() => { loadAiRecords(); }, [loadAiRecords]));

  // ★ v18.140 心理压力数字的**真正定义在下方**（`stressValue`，esReport 声明之后）。
  //   ⚠⚠ 这里原来读的是 `computeStressReport().events.length`（旧算法的「压力事件次数」）——
  //   顶部 chip 标着「心理压力」但显示的是事件数（当年那个「19」就是它），
  //   与 v18.134~139 算的百分位**完全不是一回事**。
  // ⚠⚠ **不能在本行调 `computeEmotionalStress(..., sportSessions)`**：
  //   `sportSessions` 在本作用域**后面才声明**（TS2448/TS2454），
  //   必须复用下方已算好的 `esReport`，否则要么编译不过、要么算出两份不一致的数据。
  //   （这个坑与 v18.133 那次「诊断加在死代码里」同源：作用域顺序必须先确认。）
  // ★ 脑力准备度 = **当前剩余**（brainRemaining），随当天用脑实时下降（用户 2026-10-05 口径：「全天运脑，随着运脑会下降」）。
  //   与 v18.128 的「晨起固定值 brainReserve」不同：这里展示的是此刻还剩多少认知能量，
  //   早上接近储备、越用越低，更贴合「准备度」直觉，也与 Oura 的实时能量/准备度分拉开差异。
  //   科学依据不变（睡眠→次日认知 meta：Lowe 2017 g=−0.383、持续性注意 −0.409；Wüst 2024 一晚即损），
  //   只是把「一天一个数」改成「随昼夜能量线走」——储备仍由睡眠驱动，剩余是在储备上扣当天用脑。
  //   诚实边界：系数仍是经验值，**量纲未校准**（不能说 72 比 65「认知好 7%」）。后续用用户自报回归校准。
  const cognitive = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return '—';
      const r = computeCognitiveLoadReport();
      if (r?.brainRemaining != null) return String(r.brainRemaining);
      // ★ 2026-10-06 A+C（用户）：无昨夜睡眠时「剩余百分比」不存在，但「今日已用脑量」是
      //   白天实测 HRV↓/SNS↑ 累加的真实结果 → 显它而不是杠（tag 会切成「已用脑」）。
      if (r?.brainUsedToday != null) return String(r.brainUsedToday);
      return '—';
    } catch { return '—'; }
  })();
  const activity = (() => { try { const dk = dayKey(Date.now()); const s = ring?.stepDaily?.[dk]?.steps ?? 0; return s > 0 ? String(s) : '—'; } catch { return '—'; } })(); // 顶部 chip 备用：当日步数
  // 恢复 = 最近一晚睡眠评分 0-100（与「全天恢复」卡 AllDayRecoveryCard 同一取数口径）。
  // ★ v18.98（用户口径：对齐 Oura）：只认**昨晚**这一夜 ——
  //   今天的睡眠摘要，或昨天那条但起床时刻落在今早；再往前的旧归档一律不算（→ 显示「—」）。
  // ★ 2026-10-06（用户铁律：无今日睡眠即「—」，绝不挪用旧归档/昨日睡眠）：
  //   **只认今日睡眠**（dayKey(now)，按起床日归档）。删除原「昨日回退」——
  //   它会把任何历史晨间睡眠（含被错误归档到昨天的旧觉）当作今晚睡眠，
  //   正是圆环上方「睡眠恢复」冒出 59 等旧分数的根源。
  const recoverySleep = (() => {
    try {
      const t = healthStore.getSleep(dayKey(Date.now()));
      return (t && (t.total ?? 0) > 0) ? t : null;
    } catch { return null; }
  })();
  // ★ v18.98（用户口径：对齐 Oura，且明确「不要写『昨』」）：
  //   恢复分只认**昨晚**的睡眠。没有任何日期标注、也不写「昨」——
  //   拿不到昨晚睡眠就直接是「—」（见下方 recovery），而不是拿旧数据 + 一行溯源小字。
  const recoveryIsStale = false;
  // ★ v18.100 断流即空态（用户 2026-10-03 选定，覆盖 v18.97「没连戒指保留断开前值」）：
  //   戒指超过 3 小时没给 App 送采样（curveStatus.dataStale）时，页面上的恢复/脑力/情绪
  //   全是旧快照里的数，一律显示「—」，不许再挂一个数字让人当成实时。
  //   真机取证：00:29 之后一直到 12:22 都没有新采样，而首页还挂着恢复 96/脑力 39/圆环 62。
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;
  // ★ v18.144 改用「个人相对口径」（对比自己 14 天基线，Oura 同款）而非固定目标达标分。
  //   旧口径是绝对分（7.5h 满分 / 深睡 20% 满分），会出现「平时也睡 9h 却被轻扣」这类不合理。
  //   ⚠ dataStale 判定保持不变：断流时一律「—」，不许挂旧快照的数。
  const sleepPers = (() => { try { return computeSleepPersonalized(); } catch { return null; } })();
  const recovery =
    dataStale || !recoverySleep || sleepPers?.score == null
      ? '—'
      : String(sleepPers.score);
  // 副标：把「口径」和「还差几天进入个人化」说清楚，否则口径切换会被当成分数忽高忽低。
  const recoverySub = (() => {
    if (sleepPers?.mode === 'absolute' && sleepPers.daysToReady > 0) {
      return `还需 ${sleepPers.daysToReady} 晚建立个人基线`;
    }
    return null;
  })();
  const recoverySubDur = (() => {
    const t = recoverySleep?.total;
    if (t == null || !Number.isFinite(t) || t <= 0) return '暂无';
    const h = Math.floor(t / 60), m = Math.round(t % 60);
    const dur = m > 0 ? `${h}h${m}m` : `${h}h`;
    return dur;
  })();

  // ★ 三张消耗卡的涨跌 = 真实数据，且**同口径比较**（今天「至今」 vs 昨天「同一时刻」）。
  //   为什么必须同口径：拿今天到 15:00 的累计值去比昨天的全天值，每天上午都会显示暴跌，
  //   那是另一种形式的假数字。拿不到可比数据时整块隐藏，绝不回落到占位/硬编码。
  //   方向用箭头、好坏用颜色（两重编码，色盲用户也能读）。
  const trendCmp = (() => {
    const nowD = new Date();
    const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
    const nowHour = nowD.getHours();
    const tMs = Date.now();
    const yMs = tMs - 86400000;

    // 情绪消耗：比较「到当前小时为止」的压力事件数
    const evUpTo = (ms: number): number | null => {
      try {
        const r = computeStressReport(ms);
        if (!r) return null;
        return (r.events ?? []).filter((e: any) => Number.isFinite(e.hour) && e.hour <= nowHour).length;
      } catch { return null; }
    };
    // 认知准备度：当前剩余 vs 昨日同时刻剩余（同一 ODE 能量线，直接可比）
    const cogAt = (ms: number): number | null => {
      try {
        return computeCognitiveLoadReport(ms)?.brainRemaining ?? null;
      } catch { return null; }
    };
    // 运动消耗：步数采样可能是「当日累计快照」也可能是「每段增量」——
    //   用昨天的全天总数当参照反推属于哪种（自校准），再取同一时刻的值。
    const stepsUpTo = (dk: string, dayTotal: number | null): number | null => {
      try {
        const pts = (healthStore.getIntraday('steps' as any, dk) ?? [])
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
        if (pts.length === 0) return null;
        const upToNow = pts.filter((p) => {
          const d = new Date(p.t);
          return d.getHours() * 60 + d.getMinutes() <= nowMin;
        });
        if (upToNow.length === 0) return null;
        const mx = Math.max(...pts.map((p) => p.v));
        const sum = pts.reduce((a, p) => a + p.v, 0);
        // 与全天总数更接近的那个模型，就是这套采样真实的语义
        const isCumulative = dayTotal == null ? true : Math.abs(mx - dayTotal) <= Math.abs(sum - dayTotal);
        return isCumulative ? upToNow[upToNow.length - 1].v : upToNow.reduce((a, p) => a + p.v, 0);
      } catch { return null; }
    };
    // 组装涨跌：|Δ|<3% 视为持平；昨天为 0/无数据 → 不给结论
    const cmp = (today: number | null, yest: number | null, upIsGood: boolean) => {
      if (today == null || yest == null || !Number.isFinite(today) || !Number.isFinite(yest) || yest <= 0) return null;
      const pct = ((today - yest) / yest) * 100;
      if (Math.abs(pct) < 3) return { dir: 'flat' as const, favorable: true, label: '持平' };
      const dir = pct > 0 ? ('up' as const) : ('down' as const);
      return { dir, favorable: dir === 'up' ? upIsGood : !upIsGood, label: `${pct > 0 ? '+' : ''}${Math.round(pct)}%` };
    };

    const dkT = dayKey(tMs);
    const dkY = dayKey(yMs);
    return {
      emotion: cmp(evUpTo(tMs), evUpTo(yMs), false),      // 情绪波动变多 = 不利
      cognitive: cmp(cogAt(tMs), cogAt(yMs), true),        // 准备度（剩余）更高 = 有利
      activity: cmp(
        stepsUpTo(dkT, ring?.stepDaily?.[dkT]?.steps ?? null),
        stepsUpTo(dkY, ring?.stepDaily?.[dkY]?.steps ?? null),
        true,                                             // 步数变多 = 有利
      ),
    };
  })();

  const stressReport = (() => { try { return computeStressReport(); } catch { return null; } })();
  const cogReport = (() => { try { return computeCognitiveLoadReport(); } catch { return null; } })();
  // ★ v18.69：认知图门槛加「戒指今日同步过」——lastSyncedAt 非今日 = 今天没连过戒指，
  //   不该出现任何「今日疲劳」图形（用户实锤：没戴戒指怎么还有认知疲劳度趋势图）
  const ringSyncedToday = (() => {
    const ls = ring?.lastSyncedAt as number | null | undefined;
    if (!ls) return false;
    const a = new Date(ls);
    const b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  })();
  // 认知柱状图只在「今日同步过 + 有真实 HRV 采样的时段」渲染（首页卡片无数据不放示意图）
  const cogHasData = ringSyncedToday && (cogReport?.hourly ?? []).some((h: any) => h.hasData);
  // ★ 认知准备度序列（与上面同一数据源 hourlyInstant，仅做「反向映射 + 节律塑形」）
  //   computeReadinessSeries 内部已按 nowMs 缓存报告的 key，这里直接算即可，无需 useMemo。
  const cogReadiness = cogReport ? computeReadinessSeries(cogReport) : null;
  // ★ 2026-10-06（用户："大卡片还是显示状态中等"）：大卡 value 用档位文字，标签判断必须和
  //   顶部 chip / 详情页同源（都用 brainRemaining），否则同一屏出现两个矛盾数字。
  //   cogReadyLabel 仅在没有 brainRemaining 时才用（此时它读能量线，是唯一可用口径）。  // ★ 2026-10-07(用户："不要状态中等，要么跟圆环一样显示数字，要么显示消耗%")
  // ★ 2026-10-07：首页大卡显示**今日脑力消耗%**（能量线从晨起到睡前的掉幅）
  //   圆环仍然显示当前剩余准备度（两者口径不同，不矛盾）
  const cogConsumptionPct = (() => {
    if (!cogReport) return null;
    const half = (cogReport as any).energyHalfHourly as { slot: number; value: number }[] | undefined;
    if (!half || half.length === 0) return null;
    const sleep = cogReport.sleepWindow ?? null;
    const wakeHour = sleep?.wakeHour ?? 7;
    const wakeSlot = Math.max(0, Math.floor(wakeHour * 2));
    // morning: 起床后 1h 内 3 槽均值
    const mSlots = half.filter((p) => p.slot >= wakeSlot && p.slot <= wakeSlot + 2);
    const morning = mSlots.length ? mSlots.reduce((a, b) => a + b.value, 0) / mSlots.length : null;
    // evening: 睡前槽 或 槽 46(23:00)
    const bedHour = sleep?.bedHour ?? null;
    const targetSlot = (bedHour != null && Number.isFinite(bedHour))
      ? Math.max(0, Math.min(47, Math.floor(bedHour * 2) - 1))
      : 46;
    const eSlot = half.find((p) => p.slot === targetSlot) ?? half.find((p) => p.slot === 46);
    const evening = eSlot?.value ?? null;
    if (morning != null && evening != null && morning > 0) {
      return Math.max(0, Math.round(((morning - evening) / morning) * 100));
    }
    // fallback: peak→trough
    const awake = half.filter((p) => {
      if (!sleep) return true;
      const bedS = Math.floor((sleep.bedHour ?? 22) * 2);
      const wakeS = Math.floor((sleep.wakeHour ?? 7) * 2);
      return !(p.slot >= bedS || p.slot <= wakeS);
    });
    if (awake.length >= 2) {
      const peak = awake.reduce((a, b) => (b.value > a.value ? b : a)).value;
      const trough = awake.reduce((a, b) => (b.value < a.value ? b : a)).value;
      if (peak > trough && peak > 0) return Math.round(((peak - trough) / peak) * 100);
    }
    return null;
  })();
  const cogCardValue = cogConsumptionPct != null ? String(cogConsumptionPct) : '—';
  const cogCardSub = cogConsumptionPct != null ? '今日脑力消耗' : '暂无数据';
  // 近 7 天步数
  const weekSteps = (() => {
    const out: { dayKey: string; steps: number; date: Date }[] = [];
    const now = new Date();
    for(let i=6;i>=0;i--){
      const d=new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
      const dk=dayKey(d.getTime());
      const s = ring?.stepDaily?.[dk]?.steps ?? 0;
      out.push({ dayKey:dk, steps:s, date:d });
    }
    return out;
  })();


  // ★ 节流订阅：BLE 状态推送（回填期约 ≥500ms 一次）会带动整屏重渲染，而本屏 render 里还要跑
  //   computeStressReport/computeCognitiveLoadReport/皮质醇分析。用 rAF 把同一帧内的多次推送合并成
  //   一次 setRing，避免叠加重渲染造成「点击/切 tab 卡顿」。（与 InsightScreen 同款写法）
  useEffect(() => {
    let pending: ReturnType<typeof RingBle.getState> | null = null;
    let scheduled = false;
    const throttled = (s: ReturnType<typeof RingBle.getState>) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRing(pending);
        });
      }
    };
    return RingBle.onState(throttled);
  }, []);
  const cardWidth =
    Math.min(width, theme.layout.maxWidth) - theme.space.screen * 2 - theme.space.cardPad * 2;
  // 全天状态面板是「全宽」的（左右不留边），宽度 = 屏宽（桌面上限 maxWidth）
  const panelW = Math.min(width, theme.layout.maxWidth);
  // 面板底部圆弧高度（方案 A：两端上扬、中间最低）
  const panelArcH = theme.sp(6); // 弧度高度更小, 图离边缘更近
  // 圆弧路径：控制点 y = 1.335×arcH 时，曲线最低点正好落在 arcH
  // 弧下弥散紫的纵向长度（渐变由此高度从紫收到透明）
  const panelUnderH = theme.sp(50);
  const panelArcR = theme.radius.card * 2; // 弧度更大
  const panelArcD = `M0,0 H${panelW} V${(panelArcH - panelArcR).toFixed(1)} A${panelArcR},${panelArcR} 0 0 1 ${(panelW - panelArcR).toFixed(1)},${panelArcH} H${panelArcR} A${panelArcR},${panelArcR} 0 0 1 0,${(panelArcH - panelArcR).toFixed(1)} V0 Z`;

  // 圆环下方分析胶囊：状态胶囊（跟随心情色）+ 相位标签（软底彩字）+ 建议（描述文字），统一走 design token
  const status = ring.curveStatus;
  const statusIdx = status && status.value != null ? curveLevel(status.value, CURVE_DEFAULTS).index : null;
  const phase = status?.phaseLabel ?? '未记录';
  const phaseKnown = phase !== '未记录';
  // ★ 真实睡眠检测：用最近一次 healthStore 中记录的睡眠窗口（sleepTime / wakeTime HH:mm）
  //   healthStore 里存的是「今天结束的那次睡眠」，跨午夜睡眠（23:30 → 07:00）正常工作。
  const todaySleep = healthStore.getSleep(dayKey(Date.now()));
  const { isAsleep, isNap } = (() => {
    const sl = todaySleep;
    if (!sl?.sleepTime || !sl?.wakeTime) return { isAsleep: false, isNap: false };
    const toMs = (hhmm: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
      if (!m) return null;
      const d = new Date();
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return d.getTime();
    };
    const s = toMs(sl.sleepTime);
    const w = toMs(sl.wakeTime);
    if (s == null || w == null || s === w) return { isAsleep: false, isNap: false };
    const now = Date.now();
    const inWindow = s < w ? now >= s && now <= w : now >= s || now <= w;
    const h = new Date().getHours();
    return { isAsleep: inWindow && (h >= 22 || h < 7), isNap: inWindow && h >= 8 && h < 22 };
  })();

  // AI 建议：每次进入首页都调 getAiInsight('today')，绕过 hook 缓存层
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 睡眠中不跑 AI，直接用硬文案
    if (isAsleep) { setAiAdvice(null); return; }
    setAiAdvice(null);
    const timer = setTimeout(() => {
      getAiInsight('today')
        .then((t) => { if (!cancelled) setAiAdvice(t); })
        .catch(() => { if (!cancelled) setAiAdvice(null); });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phase, statusIdx, isAsleep, status?.value, status?.level]);

  const fallbackAdvice = buildSmartAdvice(phase, statusIdx, isNap);

  // ★ v18.37 场景建议引擎：圈内 = 短建议词（≤6 字），胶囊 = 具体解释（≤2 行）。
  //   优先级：睡眠窗口 > 睡前1h(个人入睡习惯-60min) > 情绪尖峰 > 晨间满电
  //           > 饭前低今日状态 > 久坐 > 午后低谷 > 傍晚收工；无场景 → 常规相位句。
  //   频控：每词每日 ≤3 次（多数 ≤1）+ 最短冷却，持久化跨重启（lib/todayScene）。
  const scene: TodayScene | null = (() => {
    try {
      const nowMs = Date.now();
      const stepsPts = healthStore.getTimeRange('steps' as any, nowMs - 2 * 3600e3, nowMs, { maxPoints: 60 });
      const stepsLast2h = stepsPts.length >= 2 ? Math.max(0, stepsPts[stepsPts.length - 1].v - stepsPts[0].v) : 0;
      const spo2Pts = healthStore.getTimeRange('spo2' as any, nowMs - 3 * 3600e3, nowMs, { maxPoints: 20 });
      const spo2Latest = spo2Pts.length > 0 ? spo2Pts[spo2Pts.length - 1].v : null;
      const stressRecent1h = (stressReport?.events ?? []).filter((e: any) => Number.isFinite(e.t) && e.t >= nowMs - 3600e3).length;
      return evaluateTodayScene({
        now: nowMs,
        isAsleep,
        statusValue: status?.value ?? null,
        sleepScore: recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null,
        wakeTimeStr: recoverySleep?.wakeTime ?? null,
        stressRecent1h,
        stepsLast2h,
        spo2Latest,
      });
    } catch { return null; }
  })();

  // 频控计数：同一次持续触发只记一次（key 变化再重新计），跨重启由文件持久化
  const markedSceneRef = useRef<string | null>(null);
  useEffect(() => { initTodaySceneCounter(); }, []);
  useEffect(() => {
    if (scene?.key && markedSceneRef.current !== scene.key) {
      markedSceneRef.current = scene.key;
      markSceneShown(scene.key);
    }
  }, [scene?.key]);

  const advice = isAsleep
    ? (phase === '经期' ? '经期睡眠中，安心休息助修复' : phase === '黄体期' ? '黄体期睡眠中，深睡稳情绪' : '睡眠恢复中，安心休息')
    : fallbackAdvice;
  if (__DEV__) console.log(`[TodayAdvice] ai=${aiAdvice ?? 'null'} fallback=${fallbackAdvice} phase=${phase} idx=${statusIdx} scene=${scene?.key ?? 'none'}`);
  const isAiText = false;  // 圆环下建议用规则更准（1.5B 模型搞不定时段优先级）
  const showPill = statusIdx != null || phaseKnown;
  // ★ 无场景触发时：胶囊 = 多因分析段（相位→雌/孕激素→皮质醇→睡眠，挂钩周期激素数据但不跳转）
  const causeNarrative = (() => {
    try {
      // 皮质醇晨峰/节律（14 天 cosinor，与洞察页同一套拟合）
      let cortisolPeak = '—';
      let cortisolRhythm = '—';
      const samples = collectSamples();
      const cr = analyzeCortisol(samples, 14);
      if (cr && Number.isFinite(cr.cosinor?.acrophaseH)) {
        cortisolPeak = `${String(Math.round(cr.cosinor.acrophaseH)).padStart(2, '0')}:00`;
        if (cr.css > 10) cortisolRhythm = '良好';
        else if (cr.css < -10) cortisolRhythm = '偏晚';
        else if (Number.isFinite(cr.cosinor.amplitude) && Number.isFinite(cr.cosinor.mesor) && cr.cosinor.amplitude < 0.15 * cr.cosinor.mesor) cortisolRhythm = '扁平';
        else cortisolRhythm = '一般';
      }
      return buildCauseNarrative({
        phaseLabel: phase,
        dayInCycle: status?.dayInCycle ?? null,
        estrogenIndex: status?.estrogenIndex ?? null,
        cortisolPeak,
        cortisolRhythm,
        sleepScore: recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null,
      });
    } catch { return ''; }
  })();
  // ★ v18.109 断流即空态：戒指超过 3 小时没回传采样（dataStale）时，圆环下方不写任何相位/多因分析
  //   （旧实现会继续输出「孕激素升高，能量天生易偏低」这类周期文案，看着像今天有数据其实是推算的），
  //   统一写「暂无数据，请佩戴戒指。约半小时会更新最新数据。」，与 curveStatus.narrative 同口径。
  const narrative = dataStale
    ? '暂无数据，请佩戴戒指。约半小时会更新最新数据。'
    : scene
      ? scene.explain
      : causeNarrative || (showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析');

  // ★ v18.96（审计 2-3）：全天状态趋势图只画**今天**的曲线点。
  //   旧实现直接把 ring.statusTimeline 整条传进 TrendChart（组件内无日期过滤），
  //   与 DailyStatusCard / EnergyBall 的当日口径不一致 → 跨天时会画出昨天的曲线。
  const todayStatusTimeline = (ring.statusTimeline ?? []).filter((p: any) => {
    if (!Number.isFinite(p?.t)) return false;
    const d = new Date(p.t);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });

  // ★ 今日日历：把「真实生理数据」+「与 Mira 的对话记录」按一天的时间顺序编排（约 6~7 条）
  const fmtMin = (min: number | null | undefined): string => {
    if (min == null || !Number.isFinite(min) || min <= 0) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ''}` : `${m}分钟`;
  };
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const now0 = new Date();
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateLabel = `${now0.getMonth() + 1}月${now0.getDate()}日 · ${WEEKDAYS[now0.getDay()]}`;
  /** 当前时刻（当天分钟数）——凡是「还没发生的时段」一律不写死标签，回落到现在已经过到的位置 */
  const curMin = now0.getHours() * 60 + now0.getMinutes();

  // 排序键 = 当天分钟数（'全天'=-1 置顶，'现在'=1440 置底）
  type DatedItem = TimelineItem & { k: number };
  const dated: DatedItem[] = [];
  const pushItem = (it: TimelineItem, k: number) => dated.push({ ...it, k });

  // 1. 周期相位（当天背景事项，置顶）
  const cs = ring.curveStatus;
  if (cs?.hasLog && cs.phaseLabel) {
    pushItem({
      time: '全天',
      color: theme.colors.accent1,
      // ★ v18.48：全天事项标题只显示相位名（如"黄体期"），不再拼"第 N 天"
      title: cs.phaseLabel,
      sub: cs.phaseLabel === '黄体期' ? '激素回落，留意情绪与能量起伏' : cs.phaseLabel === '经期' ? '以温和舒缓为主，适合休息' : '激素节律影响今日状态节奏',
    }, -1);
  }
  // 2. 起床（真实睡眠窗口）
  // ★ v18.104：断流时这条只留「起床时刻」这个事实，睡眠评分/时长/深睡全部改空态文案 ——
  //   不把 0:29 那次同步的昨夜睡眠当成今天早上刚测到的（与圆环/昼夜节律卡同一口径）。
  if (todaySleep?.wakeTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(todaySleep.wakeTime.trim());
    pushItem({
      time: todaySleep.wakeTime,
      color: theme.colors.stateTired,
      title: dataStale ? '起床' : `起床 · 睡眠评分 ${todaySleep.score ?? '—'}`,
      sub: dataStale
        ? '戒指暂无新数据，昨夜睡眠明细暂不显示'
        : `睡眠 ${fmtMin(todaySleep.total)} · 深睡 ${fmtMin(todaySleep.deep)}`,
    }, m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60);
  }
  // 3. 情绪波动峰值事件
  const evs = stressReport?.events ?? [];
  const peakEvent = evs.length > 0 ? evs.reduce((a: any, b: any) => (b.severity > a.severity ? b : a)) : null;
  if (peakEvent) {
    pushItem({
      time: `${pad2(peakEvent.hour)}:${pad2(peakEvent.minute)}`,
      color: theme.colors.stateTense,
      title: `情绪波动 ${evs.length} 次`,
      sub: `峰值强度 ${Math.round(peakEvent.severity)} · 前后可安排 5 分钟呼吸调整`,
    }, peakEvent.hour * 60 + peakEvent.minute);
  }
  // 4. 脑力消耗：数字与柱状图同源（avgFatigue）；高峰时刻取「已观测小时柱」最高点，不写未来时刻
  if (cogReport?.avgFatigue != null) {
    const barsPast = (cogReport.hourly ?? []).filter(h => h.hasData && h.hour * 60 <= curMin);
    const peakBar = barsPast.length > 0 ? barsPast.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    pushItem({
      time: peakBar ? `${pad2(peakBar.hour)}:00` : '今日',
      color: theme.colors.stateTired,
      title: `脑力消耗 ${cogReport.avgFatigue} · ${cogLevelLabel(cogReport.avgFatigue)}`,
      sub: '高峰时段安排专注任务更高效',
    }, peakBar ? peakBar.hour * 60 : curMin);
  }
  // 5. 活动量：累计步数——时间用「最后一次计步采样的真实时刻」，没有采样就不写时间标签
  const dkToday = dayKey(Date.now());
  const stepsToday = ring?.stepDaily?.[dkToday]?.steps ?? 0;
  if (stepsToday > 0) {
    let lastStepMin: number | null = null;
    try {
      const pts = healthStore.getIntraday('steps' as any, dkToday) ?? [];
      const last = pts.length > 0 ? pts[pts.length - 1] : null;
      if (last && Number.isFinite(last.t)) {
        const d = new Date(last.t);
        const m = d.getHours() * 60 + d.getMinutes();
        // 只信任「已经发生」的采样时刻，避免脏样本把条目推到未来
        if (m <= curMin) lastStepMin = m;
      }
    } catch { lastStepMin = null; }
    pushItem({
      time: lastStepMin != null ? `${pad2(Math.floor(lastStepMin / 60))}:${pad2(lastStepMin % 60)}` : '今日',
      color: theme.colors.stateCalm,
      title: `活动 ${stepsToday} 步`,
      sub: '保持轻量活动，助力晚间恢复',
    }, lastStepMin ?? curMin);
  }
  // 6. AI 对话记录：★ 真实聊天记忆（MemoryStore），对话产生关键信息后即时刷新
  const latestRecord = aiRecords[0];
  if (latestRecord) {
    const d = new Date(latestRecord.ts);
    const themes = inferThemes(latestRecord.text);
    const snippet = latestRecord.text.length > 30 ? `${latestRecord.text.slice(0, 30)}…` : latestRecord.text;
    pushItem({
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
      color: theme.colors.accent2,
      title: themes.length ? `AI 对话 · ${themes.join('/')}` : 'AI 对话 · 与 Mira',
      sub: aiRecords.length > 1 ? `今日 ${aiRecords.length} 条记录 · ${snippet}` : snippet,
    }, d.getHours() * 60 + d.getMinutes());
  }
  // 7. AI 今日洞察（异步生成，兜底用规则文案，置底）
  pushItem({
    time: '现在',
    color: theme.colors.accent2,
    title: 'AI 今日洞察',
    sub: aiAdvice ?? narrative,
  }, 24 * 60);

  const timelineItems: TimelineItem[] = dated
    .sort((a, b) => a.k - b.k)
    .slice(0, 7)
    .map((it) => ({ time: it.time, color: it.color, title: it.title, sub: it.sub }));

  // 三张消耗卡的副标题：一律由真实数据推导，不写死「峰值集中在傍晚」「19 kcal」这类未发生或编造的结论
  const stressSub = peakEvent ? `峰值 ${pad2(peakEvent.hour)}:${pad2(peakEvent.minute)}` : '暂无压力事件';
  // ★ v18.127：档位改用**瞬时**疲劳度均值（与柱状图同源，v18.125 前用的是累积量 avgFatigue）
  const cogLevelTxt = cogLevelLabel(cogReport?.avgFatigueInstant);
  // 峰值时刻取「已观测小时柱」最高点（与卡片柱状图完全同源）；未观测到就只给档位，不写未来时刻
  const cogPeakBar = (() => {
    const bars = (cogReport?.hourlyInstant ?? []).filter(h => h.hasData && h.hour * 60 <= curMin);
    return bars.length > 0 ? bars.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  })();
  const cognitiveSub = cogPeakBar
    ? `疲劳最高 ${pad2(cogPeakBar.hour)}:00`
    : `${cogLevelTxt}疲劳`;
  // ★ 2026-10-06（用户口径）：峰谷行**不再依赖 cogHasData**——节律预测（皮质醇昼夜模型）即使没有昨晚睡眠也能推算，
  //   故「脑力峰值 / 脑力低谷」两行始终展示（无值显「—」），让卡片在断流/无睡眠时也是完整的「分 + 峰 + 谷」三行。
  const cogPeakTroughLines = (() => {
    const f: any = (cogReport as any)?.forecast;
    const seg = (h: number) => `${pad2(h)}–${pad2((h + 1) % 24)}时`;
    // 真实峰谷：只取「已完全过去」的实测小时（h+1 点 ≤ 当前分钟），且至少 2 个实测小时才有峰谷意义
    // ★ v18.127：峰谷也改用**瞬时**序列（与柱状图/chip 同源）
    // ★ 2026-10-05 改「准备度」后峰谷方向反转：准备度 **峰 = 分数最高（状态最好）**、
    //   谷 = 分数最低。旧疲劳口径是「峰 = 分数最低」，直接沿用会把最好/最差说反。
    const passed = (cogReport?.hourlyInstant ?? []).filter((h) => h.hasData && (h.hour + 1) * 60 <= curMin);
    const realPeak = passed.length >= 2 ? passed.reduce((a, b) => (b.score <= a.score ? b : a)) : null;
    const realTrough = passed.length >= 2 ? passed.reduce((a, b) => (b.score >= a.score ? b : a)) : null;
    // 预测窗已完全过去 → 改用该端实测峰谷（同语义）；否则用节律预测值（无需睡眠即可得）
    const peakHour = f?.peak?.hour != null
      ? ((f.peak.hour + 1) * 60 <= curMin ? realPeak?.hour ?? f.peak.hour : f.peak.hour)
      : null;
    const troughHour = f?.trough?.hour != null
      ? ((f.trough.hour + 1) * 60 <= curMin ? realTrough?.hour ?? f.trough.hour : f.trough.hour)
      : null;
    // ★ 2026-10-06（用户问"无睡眠时峰谷还要不要展示"）：**要展示**。
    //   预测来自 `forecast`（皮质醇昼夜模型 + 昼夜相位），**不依赖睡眠归档**；
    //   预测窗已过去的端点改用当天实测峰谷（≥2 个实测小时才有意义，否则留预测值）。
    //   副标注「预测/实测」让用户知道这行的来源，不把预测当成实测。
    const peakIsReal = f?.peak?.hour != null && (f.peak.hour + 1) * 60 <= curMin && realPeak != null;
    const troughIsReal = f?.trough?.hour != null && (f.trough.hour + 1) * 60 <= curMin && realTrough != null;
    return [
      peakHour != null ? `脑力峰值 ${seg(peakHour)}${peakIsReal ? ' 实测' : ' 预测'}` : '脑力峰值 —',
      troughHour != null ? `脑力低谷 ${seg(troughHour)}${troughIsReal ? ' 实测' : ' 预测'}` : '脑力低谷 —',
    ];
  })();
  const stepKcalToday = (() => { try { return ring?.stepDaily?.[dkToday]?.calorie ?? 0; } catch { return 0; } })();
  const stepDistToday = (() => { try { return ring?.stepDaily?.[dkToday]?.distance ?? 0; } catch { return 0; } })();
  // 运动卡数据口径：卡路里为主数字（kcal），脚注行=步数(stepsToday 复用上方声明)+距离；今日有任何步数即视为有数据
  const activityHasData = (stepsToday > 0) || weekSteps.some((w) => w.steps > 0);
  // 戒指固件已按类型分类的运动段（多运动识别）：把识别出的运动类型与各自消耗塞进「运动消耗」卡
  const sportSessions: RingSportSession[] | null = ring?.sportSessions ?? null;
  const hasSportSessions = !!sportSessions && sportSessions.length > 0;
  const sportKcalTotal = hasSportSessions
    ? sportSessions.reduce((acc, s) => acc + (s.totalCal || 0), 0)
    : 0;
  // 原生只映射固件枚举前 53 项，超出会回「未知(N)」→ 按 type 用全量表还原（VEEPOO_SPORT_NAMES 0–188）
  const sportNames = hasSportSessions
    ? sportSessions.map((s) => resolveSportName(s.type, s.typeName)).filter(Boolean).join(' · ')
    : '';
  // ★ v18.88 首页运动卡副行：首段类型名按运动类别上色（嵌套 Text），段数走右上角 aside，
  //   整行刻意压短（「跑步 等 3 段」）——130pt 高的窄卡里超一行就会被 numberOfLines:1 吃成省略号。
  const sportFirst = hasSportSessions ? resolveSportName(sportSessions?.[0]?.type, sportSessions?.[0]?.typeName) : '';
  const sportFirstColor = hasSportSessions ? sportVisualOf(sportSessions?.[0]?.type).color : '';
  const sportCount = hasSportSessions ? (sportSessions?.length ?? 0) : 0;
  // 右上角 aside 放总时长的短写法（≥1h 用 1:36 时钟式，否则用「96 分钟」）——
  // 段数放副行，时长放 aside，两边不重复同一句话
  const sportTotalSec = hasSportSessions
    ? sportSessions.reduce((a, s) => a + (s.totalTime || 0), 0)
    : 0;
  const sportTotalMin = Math.round(sportTotalSec / 60);
  const sportAside = hasSportSessions
    ? (sportTotalMin >= 60
      ? `${Math.floor(sportTotalMin / 60)}:${String(sportTotalMin % 60).padStart(2, '0')}`
      : `${sportTotalMin} 分钟`)
    : undefined;

  // ★ chips 数据标签（数值下方一行小字）：全部由当天真实数据推导档位，无数据不给词
  // ★ v18.144：档位阈值随口径切换。
  //   ⚠ 这是必须的，不是可选：绝对口径下「80 = 睡够 7.5h+」，
  //   相对口径下「50 = 和你平时一样」⇒ 两套口径共用 80/60 阈值会得到相反的结论。
  //   （这正是 MEMORY 里「同一指标两界面口径不同 ⇒ 自相矛盾」的同类问题。）
  const recTag = (() => {
    if (recovery == null || recovery === '—') return undefined;
    const s = Number(recovery);
    if (!Number.isFinite(s)) return undefined;
    // ★ v18.156：档位词收成唯一实现（`sleepRecoveryTag`），与「睡眠节律」卡 badge 同源。
    //   此前 chip（58/42「高于平时」）与卡片（62/45「恢复较好」）各写一套，
    //   同一个 61 在首页出现两种说法 —— 用户 2026-10-05 的困惑点正是这个。
    return sleepRecoveryTag(s, sleepPers?.mode === 'relative' ? 'relative' : 'absolute');
  })();
  // ★ v18.128：档位按**晨起准备度剩余**判（与 chip 数值同一口径、同一个字段 brainReserve）。
  //   数值方向 = 准备度（高 = 更好），所以 ≥70 准备度高 / 40~70 准备度中 / <40 准备度低。
  //   阈值沿用 COG_LEVEL_HIGH/LOW（70/40），与 WHOOP 67 / Oura 70 的通行区间对齐。
  //   历史坑（v18.125）：曾用 `brainUsed`（已消耗）判档而数值读 `brainRemaining`（剩余），
  //   两者方向相反 → 「值 82 · 标签 高消耗」自相矛盾。**标签与数值必须取同一字段。**
  const cogTag = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return undefined;
      const rep = computeCognitiveLoadReport();
      // ★ 2026-10-06（用户指正："圆环上面写 59，但显示准备度高，这肯定不对"）：
      //   根因 —— chip 的**值**读 `brainRemaining`（此刻剩余），而**标签**读 `brainReserve`（晨起起点）。
      //   两者不是同一个量：晨起 80、此刻用到 59 是完全正常的，但拿 80 去判档就出现「59 · 准备度高」。
      //   ★ 铁律：**标签与数值必须取同一字段**（同源），否则用户永远会认为算错。
      //   现在统一按「此刻剩余」判档。
      const remain = rep?.brainRemaining;
      if (remain == null || !Number.isFinite(remain)) {
        // 无昨夜睡眠 → 顶部显「已用脑量」，tag 相应改成消耗口径
        const used = rep?.brainUsedToday;
        if (used != null && Number.isFinite(used)) {
          return used >= 40 ? '已用脑 · 偏多' : '已用脑 · 正常';
        }
        return undefined;
      }
      return remain >= COG_LEVEL_HIGH ? '准备度高' : remain >= COG_LEVEL_LOW ? '准备度中' : '准备度低';
    } catch { return undefined; }
  })();
  // ★ v18.132：情绪压力（多信号融合）在 TodayScreen 侧再取一次，供 chip 小字用。
  //   （与 EnergyRowData 里的 esReport 属不同组件作用域，各自算；healthStore 有内部缓存，代价小）
  // ★ v18.133：同 EnergyRowData，必须传 sportSessions，否则两处算出来的 moving 槽数会不一致
  //   （chip 说「平稳」、下面卡片说有运动 ⇒ 用户看到的图就自相矛盾）。
  const esReport = (() => {
    try { return computeEmotionalStress(Date.now(), sportSessions); } catch { return null; }
  })();
  // ★ v18.141 心理压力 0-100 —— **显示，不再被校准闸门挡住**。
  //   ⚠⚠ v18.140 我加的 `stressScoreVisible` 闸门把数字全挡成「—」，
  //   但那时候**生理分其实算得出来**（41/42 槽、全天 55 分）。
  //   ⇒ 这是我拿「还没验证准不准」当「不给看」的理由，**过度保守**：
  //   用户要的是「今天压力多少」，一个标着「未校准」的 55 分比空白有用得多
  //   —— 前者还能用来观察趋势，后者什么都看不到。
  //   现在口径：数字**照出**，但副标必须写明未校准（`stressNote`），
  //   且 `calibration.level === 'invalid'`（r<0.2，证明这套数据对你没用）时才真正不给数。
  // ★ v18.142 诊断已取证（moving 18→4，MET 均值口径误判），按纪律移除。
  //   需要复查时重新加，打 `[PS-DEBUG] value/dataSlots/moving/byReason/calLevel`。
  // ★ v18.143 诊断已取证（加权后 value=51 / moving=4 / wSum=0.414），按纪律移除。
  //   需复查时重加，打 `[RB-DEBUG] value/dataSlots/moving/baseDays/drift/avgUsed/wSum`。
  // ★ v18.144 诊断已取证（relative/47/reg=96/midSd=13.9），按纪律移除。
  //   需复查时重加，打 `[SLEEP-P] score/mode/baseDays/daysToReady/reg/midSd/wakeSd/bedSd/regDays`。
  const stressValue = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return '—';
      if (!esReport || !esReport.stressScale) return '—';
      if (esReport.baselineDays < ES_MIN_BASELINE_DAYS) return '—';
      // 只在「已证明无效」时不给数（r < 0.2）；样本不足（insufficient）照给，只是标未校准
      if (esReport.calibration?.level === 'invalid') return '—';
      return String(esReport.stressScale.value);
    } catch { return '—'; }
  })();
  // ★ v18.133 运动门控诊断：**已取证完毕（fw=NO / 戒指未连上），按「排查 log 同轮清掉」纪律移除。**
  //   需要复查时把下面这段 uncomment 即可（依赖已就绪，字段都在）：
  //   ⚠ 位置说明：这段必须在**真正渲染的组件作用域**里。同文件的 `EnergyRowData` 看着像，
  //     但它**从未被任何地方使用**（`grep EnergyRowData` 只有定义处命中）——往那里加日志永远不打印。
  //   useEffect(() => {
  //     const d = esReport?.motionDiag; if (!d) return;
  //     console.log(`[MOTION-GATE] fw=${d.hasFirmwareSessions?'YES':'NO'} gate=[${d.gateSummary}] ` +
  //       `layers=${JSON.stringify(d.byReason)} moving=${esReport.movingSlots}/${esReport.dataSlots} ` +
  //       `stress=${esReport.stressSlots} peak=${esReport.peakLevel??'-'} sev=${esReport.meanSeverity??'-'} ` +
  //       `driftZ=${d.driftZ??'-'} edaScale=${d.edaScalePool??'-'} baseDays=${esReport.baselineDays}`);
  //   }, [esReport?.dataSlots, esReport?.movingSlots, esReport?.stressSlots, esReport?.meanSeverity, esReport?.deviceDrift, sportSessions?.length]);
  // ★ v18.134 6 特征融合诊断：**已取证（avgUsed=0 的根因是今日 EDA 真实漂移 2.65×，
  //   deviceDrift 正确拦下全部 40 槽），按「排查 log 同轮清掉」纪律移除。**
  //   需要复查时 uncomment 下面这段（字段都在 esReport.featureDetail）。
  //   ⚠ 位置：必须在真正渲染的组件作用域（EnergyRowData 是死代码，别放那儿）。
  // useEffect(() => {
  //   if (!esReport) return;
  //   const fd = esReport.featureDetail;
  //   console.log(`[FEAT-6] avgUsed=${fd.avgUsedCount} moving=${esReport.movingSlots}/${esReport.dataSlots} ` +
  //     `stress=${esReport.stressSlots} peak=${esReport.peakLevel ?? '-'} sev=${esReport.meanSeverity ?? '-'} ` +
  //     `drift=${esReport.deviceDrift} driftZ=${esReport.motionDiag.driftZ} baseDays=${esReport.baselineDays}`);
  // }, [esReport?.dataSlots, esReport?.stressSlots, esReport?.meanSeverity]);
  // ★ v18.137：chip 小字用 `stressScale.bandLabel`（「压力中/压力低/压力高」）。
  // ★ v18.141 修正：**档位不再被校准状态吃掉**。
  //   旧逻辑：`calibration.level === 'insufficient'` 直接 return「记录情绪可校准」，
  //   **排在档位判断之前** ⇒ 用户只看到引导文案，看不到「压力中」这个有效结论。
  //   为什么改：档位是**有数据的结论**（41/42 槽算得出、全天 55 分），
  //   校准只影响「这个数字可不可信」，不该把结论一起藏掉。
  //   ⇒ 改为：档位照常显示，**校准不足时在副标追加一句提示**。
  const emoTag = (() => {
    try {
      if ((ring?.curveStatus as any)?.dataStale) return undefined;
      if (!esReport) return undefined;
      if (esReport.baselineDays < ES_MIN_BASELINE_DAYS) return '建立基线中';
      const ss = esReport.stressScale;
      if (!ss) return undefined;
      if (ss.confidence === 'low') return '信号较少';
      return ss.bandLabel;
    } catch { return undefined; }
  })();
  // ★ v18.141：校准不足时的**副标提示**（不占档位名，只在卡片小字出现）。
  //   empty = 不显示（已校准通过时）。
  const stressNote = (() => {
    try {
      const cal = esReport?.calibration;
      if (!cal) return undefined;
      if (cal.level === 'insufficient') {
        return cal.stressReports === 0
          ? '记录情绪可校准'
          : `压力时记录 ${cal.stressReports}/3`;
      }
      if (cal.level === 'weak') return `准确度 ${cal.r?.toFixed(2) ?? '—'}·仅参考`;
      if (cal.level === 'invalid') return '身体数据分不出压力大小';
      return undefined;
    } catch { return undefined; }
  })();
  // ★ v18.153：`actTag`（活动偏少 / 轻度活动 / 活力充足）随「运动消耗」chip 一并移除 ——
  //   它的唯一消费方就是那颗 chip；第二屏的「运动消耗」Bento 卡用的是 stepsToday / sportKcalTotal，
  //   与此 IIFE 无关，不受影响。

  /**
   * ★ 顶部指标 chips（MindMate v10 Reskin）：白卡 chip = pastel 方块 icon + 灰标签 + 数值。
   * 数据与消耗卡**同源同口径**：恢复=睡眠评分、脑力=准备度（脑力账户剩余）、情绪=事件数、经期=当前相位。
   * 无数据显式传 '—'，不编数字。
   * ★ v18.153：**移除「运动消耗」chip**（用户口径）——圆环上面那排只保留恢复/脑力/情绪/经期，
   *   正好 4 张排满一行（不再有一条半截卡提示右滑）。运动消耗仍在第二屏
   *   「消耗与恢复节律」的 Bento 卡里，数据与点击入口都没丢。
   */
  // 经期卡：月相图标与圆环四个象限点同一套（经期=满月/卵泡=上弦/黄体=全紫/排卵=下弦）
  const PHASE_MOON: Record<string, 'full' | 'quarterR' | 'allPurple' | 'quarterL'> = {
    经期: 'full', 卵泡期: 'quarterR', 黄体期: 'allPurple', 排卵期: 'quarterL',
  };
  const phaseMoon = status?.phaseLabel != null ? PHASE_MOON[status.phaseLabel] : undefined;

  // ★ v18.107 撤回 staleSleepTip：用户明确反对「戒指已 N 小时没有新数据 · 数据截至 HH:MM」这类
  //   时效小字（口径还会和真实采样时刻 00:29 打架，看着像没用的东西）。
  //   断流就画空图表（中间一行「暂无数据」）+ 圆环下方分析写「暂无数据，请佩戴戒指。约半小时会更新最新数据。」

  const metricChips: MindChipItem[] = [
    // ★ v18.155：睡眠恢复 chip 的单位随口径切换。
    //   相对口径的锚点是 50（= 和你平时一样），挂「/100」会被读成「睡眠只有 61 分」——
    //   这正是 sleepScore.ts 头注明确警告过的误读。相对口径不显示单位，参照系交给下面的 tag。
    { key: 'rec', icon: 'leaf', tone: 'lime', label: '睡眠恢复', value: recovery, unit: sleepPers?.mode === 'relative' ? undefined : '/100', tag: recTag, onPress: () => navigation.navigate('SleepDetail') },
    { key: 'cog', icon: 'nodes', tone: 'lav', label: '脑力消耗', value: cognitive, unit: '/100', tag: cogTag, onPress: () => navigation.navigate('EnergyDetail', { type: 'cognitive' }) },
    { key: 'emo', icon: 'heart', tone: 'pink', label: '心理压力', value: stressValue, unit: '/100', tag: emoTag, onPress: () => navigation.navigate('EnergyDetail', { type: 'emotion' }) },
    { key: 'period', icon: 'moon', tone: 'lav', label: '生理周期', value: status?.dayInCycle != null ? `第 ${status.dayInCycle} 天` : '—', tag: status?.phaseLabel ?? undefined, moonStyle: phaseMoon, onPress: () => navigation.navigate('CycleCalendar') },
  ];

  /** 睡眠恢复卡数据（MindMate v10：纯数字无图表）。全部来自真实睡眠摘要，缺项显式 '—'。 */
  const sleepCard = (() => {
    const s = recoverySleep;
    if (!s) return null;
    const deepPct = s.total > 0 && Number.isFinite(s.deep) ? Math.round((s.deep / s.total) * 100) : null;
    const wakeCount = s.awake ?? s.insomnia ?? null;
    const h = Math.floor((s.total ?? 0) / 60);
    const m = Math.round((s.total ?? 0) % 60);
    const total = h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
    return {
      score: Number.isFinite(s.score) ? Math.round(s.score) : null,
      deepPct,
      wakeCount,
      total,
      sleepTime: s.sleepTime ?? null,
      wakeTime: s.wakeTime ?? null,
    };
  })();

  /**
   * 情绪点阵 96 槽映射（15 分钟/点）。★ v18.60 口径（用户定稿）：展示「睡醒时间段」的情绪，
   * **没有数据 = 灰色（none）**，有数据按档位上色：
   * · 睡眠窗口（真实睡眠摘要 sleepTime→wakeTime，跨午夜）→ none（灰，无情绪数据）
   * · 未到时段（未来）→ none（灰）
   * · 压力事件所在的 15 分钟槽（真实 EDA 事件）→ stress
   * · 清醒且有「今日状态曲线」档位 → 充沛=energy / 平静=calm / 偏低·不足=tired
   * · 清醒但曲线未覆盖 → none（灰，不冒充数据）
   */
  const emotionSlots: MindMoodKey[] = (() => {
    const slots: MindMoodKey[] = new Array(96).fill('none');
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const parseHM = (s?: string | null): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const sleepStart = parseHM(recoverySleep?.sleepTime);
    const sleepEnd = parseHM(recoverySleep?.wakeTime);
    const inSleep = (m: number) =>
      sleepStart != null && sleepEnd != null
        ? sleepStart > sleepEnd ? (m >= sleepStart || m < sleepEnd) : (m >= sleepStart && m < sleepEnd)
        : false;
    const lvlMap: Record<string, MindMoodKey> = { '充沛': 'energy', '平稳': 'calm', '偏低': 'tired', '不足': 'tired' };
    // ★ v18.96（审计 2-1）：状态曲线只取**今天**的点。旧实现只比时分、不比日期，
    //   昨天某时段的 level 会被画进今天同一时刻的槽位（跨天清零后此处本已无残留，加过滤做防御）。
    const todayKeyStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const pts = (ring.statusTimeline ?? []).filter((p: any) => {
      if (!Number.isFinite(p?.t)) return false;
      const d = new Date(p.t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKeyStr;
    });
    for (let i = 0; i < 96; i++) {
      const m = i * 15;
      if (inSleep(m)) { slots[i] = 'none'; continue; }
      if (m > nowMin) { slots[i] = 'none'; continue; }
      let lvl: string | null = null;
      for (const p of pts) {
        const d = new Date(p.t);
        const pm = d.getHours() * 60 + d.getMinutes();
        if (pm <= m + 15 && m - pm < 60) lvl = p.level;
      }
      slots[i] = lvl ? (lvlMap[lvl] ?? 'none') : 'none';
    }
    for (const e of stressReport?.events ?? []) {
      if (Number.isFinite(e.hour) && Number.isFinite(e.minute)) {
        const idx = Math.min(95, Math.max(0, Math.floor((e.hour * 60 + e.minute) / 15)));
        slots[idx] = 'stress';
      }
    }
    return slots;
  })();

  // ★ v18.56.1 Bento 情绪卡点阵：96 槽(15min) → 48 点(30min/点，覆盖全天)。
  //   有数据档优先保留（stress > energy > tired > calm > none），压力事件点不因抽样丢失。
  const emotionDots48: MindMoodKey[] = (() => {
    const out: MindMoodKey[] = [];
    for (let j = 0; j < 48; j++) {
      const a = emotionSlots[j * 2];
      const b = emotionSlots[j * 2 + 1] ?? a;
      out.push(
        a === 'stress' || b === 'stress' ? 'stress'
        : a === 'energy' || b === 'energy' ? 'energy'
        : a === 'tired' || b === 'tired' ? 'tired'
        : a === 'calm' || b === 'calm' ? 'calm'
        : 'none',
      );
    }
    return out;
  })();

  return (
    <View style={styles.page}>
      {/* MindMate v10：首页背景全白（SPEC §0 规则 1）。原「上白下紫」分屏收起——
          状态面板圆弧在纯白底上自然隐形，页面成为一个连续白面。 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
      {/* ★ v18.50 整屏吸附翻页（Full-page Scroll Snap）：外层垂直分页 ScrollView，
          每屏高度 = 屏幕高，snapToInterval 让滑动后自动吸附到下一屏顶部。 */}
      <ScrollView
        style={styles.pagerScroll}
        contentContainerStyle={styles.pagerContent}
        snapToInterval={dims.height}
        snapToAlignment="start"
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/* ===== 第一屏：状态区（整屏） ===== */}
        <View style={[styles.pageSnap, { height: dims.height }]}>
          <View style={[styles.pageInner, { paddingTop: insets.top + theme.space.xl }]}>
            {/* v18.45 头部单行：Today 居左，头像+名字移到右侧（整屏模式下不再滚动淡出） */}
            <View style={styles.head}>
              <Text style={styles.title}>Today</Text>
              <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>K</Text>
                </View>
                <Text style={styles.name}>Kristina</Text>
              </TouchableOpacity>
            </View>

        {/* ─────────────────────────────────────────────────────────────
            ★ 顶部指标 chips（MindMate v10）：白卡 chip + pastel 方块 icon。
            · 数据与消耗卡同源同口径。
            · ★ v18.153 间距 md(16) → sm(12)：一屏纵向预算收紧（见 statusPanel 注释），
              给下方趋势图让出 4pt，图例才落在一屏内。
            ───────────────────────────────────────────────────────────── */}
        <View style={{ marginBottom: theme.space.sm }}>
          <MindChips items={metricChips} />
        </View>

        {/* ─────────────────────────────────────────────────────────────
            ★ 全天状态面板（2026-09-21）：圆环 + 全天状态趋势 = **同一块全宽白面**。
            · 上/左/右不留边界：负 margin 抵消 ScreenContainer 的 24pt 内边距实现全宽铺满，
              且与页面上半部分的纯白底同色 → 接缝不可见，读起来是「一个整体、同一份数据」。
            · 只在最下方用一段**向上圆弧**收边（两端上扬、中间最低），呼应圆环的圆形。
            · 无标题文字（原来也没有）；箭头改成玻璃感小圆按钮，放在趋势图右侧，不突兀。
            ───────────────────────────────────────────────────────────── */}
        <View style={styles.statusPanel}>
          <View style={styles.energyWrap}>
            <View style={styles.energyBallCol}>
              <EnergyBall status={ring.curveStatus} centerLabelOverride={scene?.word ?? (isAsleep ? '睡眠恢复中' : undefined)} />
            </View>
            <View style={styles.statusPill}>
              {/* v18.41 胶囊限 1.5 行：源头已压短（多因分析≤2条/逐句精简），此处兜底防溢出 */}
              <Text style={styles.statusNarr} numberOfLines={2} ellipsizeMode="tail">{narrative}</Text>
            </View>
          </View>

          <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('StatusTrendDetail')}>
            {/* 玻璃小圆改为**绝对定位浮在图上** → 趋势图因此占满整宽、左右真正居中
                （原来右侧留出 44pt 给按钮，会把图整体压左） */}
            <View style={styles.trendWrap}>
              <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
                {/* ★ v18.105：全天状态趋势图也要「断流即空」——旧实现把今天所有点连成一条平滑线，
                    0:29 之后没再戴戒指，曲线却一路铺到现在（用户：中间都应该是空的）。 */}
                {chartW > 0 ? <TrendChart width={chartW} timeline={todayStatusTimeline} stale={dataStale} /> : null}
              </View>
              <View style={styles.trendChevBtn} pointerEvents="none">
                <Icon name="chevronRight" size={theme.fontSize.body} color={theme.colors.ui.chipText} />
              </View>
            </View>
            {chartW > 0 ? <TrendAxis width={chartW} /> : null}
            <View style={styles.legend}>
              {MOODS.map((m) => (
                <LegendDot key={m.key} color={m.color} label={m.label} />
              ))}
            </View>
          </TouchableOpacity>
        </View>

        {/* 面板底部「向上圆弧」收边：独立一层全宽 SVG。
            曲线 M(0,0)→H(W,0)→C 回到 (0,0)，控制点 y = 1.335×arcH 时最低点正好落在 arcH。

            ★ 2026-09-21 修正三点（用户反馈）：
            ① 弧下的弥散紫改用 **页面本来的主题紫 `colors.bgTop`**（不再是偏蓝的 periwinkle）——
               它与 App 根渐变顶部同源，所以弧下的紫和页面底色是同一支紫，衔接自然。
            ② **去掉圆弧的「紫色柔边」两层描边**：不再有那一圈人工描边。
            ③ **弧线边缘羽化**（下同）：白与紫之间不再是几何硬切，用 `ARC_FEATHER` 多层白弧摊成过渡带。 */}
        <Svg
          width={panelW}
          height={panelArcH}
          style={[styles.statusPanelArc, { marginBottom: theme.space.sm }]}
        >

          {/* ★ 羽化层（由下往上、由淡到浓）：把「白 ↔ 紫雾」的硬边摊成一条柔和过渡带 */}
          {ARC_FEATHER.map((f, i) => (
            <Path
              key={i}
              d={panelArcD}
              fill={theme.colors.cardBg}
              opacity={f.opacity}
              transform={`translate(0, ${f.dy})`}
            />
          ))}
          {/* 卡本体白弧（最后画，保证面板本体是纯白、不被羽化层影响） */}
          <Path d={panelArcD} fill={theme.colors.cardBg} />
        </Svg>

            {/* 第一屏底部：向下滑动提示（避免用户以为下面是空的） */}
            <View style={styles.snapHint}>
              <View style={{ transform: [{ rotate: '90deg' }] }}>
                <Icon name="chevronRight" size={theme.fontSize.card} color={theme.colors.textSub} />
              </View>
              <Text style={styles.snapHintText}>滑动查看 消耗与恢复节律</Text>
            </View>
          </View>{/* /pageInner 第一屏 */}
        </View>{/* /pageSnap 第一屏 */}

        {/* ===== 第二屏：消耗与恢复节律 / 今日旅程（整屏，Tab 吸顶 + 屏内滚动） ===== */}
        <View style={[styles.pageSnap, { height: dims.height }]}>
          <View style={[styles.pageInner, { paddingTop: insets.top + theme.space.md }]}>
            <View style={styles.tabBarSticky}>
              <TouchableOpacity onPress={() => setTodayTab('rhythm')}
                style={[styles.todayTabBtn, todayTab === 'rhythm' && styles.todayTabBtnOn]}>
                <Text style={[styles.todayTabLabel, todayTab === 'rhythm' && styles.todayTabLabelOn]}>消耗与恢复节律</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTodayTab('diary')}
                style={[styles.todayTabBtn, todayTab === 'diary' && styles.todayTabBtnOn]}>
                <Text style={[styles.todayTabLabel, todayTab === 'diary' && styles.todayTabLabelOn]}>今日旅程</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.page2Scroll} contentContainerStyle={{ paddingBottom: insets.bottom + theme.space.sm }} nestedScrollEnabled showsVerticalScrollIndicator={false}>

        {/* Tab 内容（v18.51 Bento 网格：参考用户 health metrics 风格——柔和彩底大圆角块 + 白圆 chip 图标 + 大数字）
            ★ v18.53.2：恢复=黄(butter)、认知=绿(lime)（用户指定）；高度压缩保证第二屏所有卡完整展示在一屏 */}
        {todayTab === 'rhythm' ? (
          <View style={{ gap: theme.space.xs }}>
            {/* ★ v18.145 睡眠卡（新）：昨晚这一觉 = 分数 + 作息规律 + 入睡/起床/时长。
                ⚠ 放在 AllDayRecoveryCard **之前**：那张是「全天节律曲线」，
                   这张是「昨晚具体事件」，用户先看具体的、再看趋势更符合阅读顺序。
                   dataStale 与首页圆环同源（同一判据，不另设口径）。
                ★ 2026-10-05：暂时隐藏（见文件顶部 SHOW_SLEEP_CARD），代码与 props 原样保留。 */}
            {SHOW_SLEEP_CARD ? (
              <SleepCard dataStale={dataStale} onPress={() => navigation.navigate('SleepDetail')} />
            ) : null}

            {/* 最上面 = 全天恢复（★ v18.62 去彩底回白卡：颜色留给 lime chip/badge + 趋势曲线） */}
            {/* ★ 2026-10-06：用户要求「睡眠节律」卡点进去 = 洞察页睡眠 tab「睡眠结构」卡点进去的
                同一页（SleepDetail，昨天改的睡眠结构/节律详情），不再是昼夜节律/皮质醇页。 */}
            <SleepRhythmHomeCard onPress={() => navigation.navigate('SleepDetail')} />

            {/* 中排：左高块 = 脑力（lime：24h 疲劳柱状图 + 预测/真实峰谷行）；右列 = 情绪 / 运动
                ★ v18.68：去准备度（只在脑力消耗详情展示）；★ v18.126 标题「认知」→「脑力」（与顶部 chip 口径统一）
                ★ v18.59：两小卡一律固定高 sp(32.5)=130（130+8+130=268 正好占满）——flex:1 的 flexGrow 分配在 Fabric 下
                  与 stretch/gap 组合会把运动卡压成 ~30pt 细条（真机实锤），禁用 flexGrow 依赖 */}
            <View style={{ flexDirection: 'row', gap: theme.space.xs, height: theme.sp(67) }}>
              <BentoCard
                bg={mm.colors.cardBg}
                chipBg={mm.chipBg.lime.bg}
                icon="nodes"
                iconFg={mm.chipBg.lime.fg}
                title="脑力消耗"
                sub={cogCardSub}
                value={cogCardValue != null && cogCardValue !== "—" ? cogCardValue + "%" : cogCardValue}
                chart={cogReadiness
                  ? <View style={{ marginTop: 'auto', marginBottom: theme.sp(1.5) }}><MiniReadinessTrend points={cogReadiness.points} /></View>
                  : undefined}
                footLines={cogPeakTroughLines}
                style={{ width: '53%' }}
                onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })}
              />
              <View style={{ flex: 1, gap: theme.space.xs }}>
                <BentoCard
                  bg={mm.colors.cardBg}
                  chipBg={mm.chipBg.pink.bg}
                  icon="heart"
                  iconFg={mm.chipBg.pink.fg}
                  // ★ v18.140：标题从「情绪消耗·次峰值」改为「心理压力」，
                  //   值从「事件次数」改为 0-100 百分位（`stressValue`）。
                  //   旧标题三重矛盾（同 v18.137）：「消耗」没定义 / 单位「次」与分数不符 /
                  //   「峰值」是事件计数的概念，用户看不懂。
                  //   ⚠ 事件次数仍保留在内部（`emotionDots48` 点阵图需要它做时间轴），
                  //     只是不再当「压力大小」展示。
                  // ★ v18.141：`sub` 写档位 + 校准提示（原来只有 `unit`）。
                  title="心理压力"
                  value={stressValue}
                  sub={(() => {
                    try {
                      const b = esReport?.stressScale?.bandLabel;
                      const n = stressNote;
                      return n ? `${b ?? ''}·${n}` : b;
                    } catch { return undefined; }
                  })()}
                  unit=""
                  chart={<EmotionDots slots={emotionDots48} columns={12} dotSize={theme.fs(5.5)} gap={theme.fs(2.25)} tight />}
                  compact
                  style={{ height: theme.sp(32.5), flexGrow: 0, flexShrink: 0 }}
                  onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })}
                />
                <BentoCard
                  bg={mm.colors.cardBg}
                  chipBg={mm.chipBg.cyan.bg}
                  icon="bolt"
                  iconFg={mm.chipBg.cyan.fg}
                  title="运动消耗"
                  aside={sportAside}
                  subLine={hasSportSessions ? (
                    <Text style={{ fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium, color: mm.colors.inkSoft }}>
                      <Text style={{ color: sportFirstColor, fontWeight: theme.weight.semibold as never }}>
                        {sportFirst}
                      </Text>
                      {sportCount > 1 ? ` 等 ${sportCount} 段` : ''}
                    </Text>
                  ) : (activityHasData ? `${stepsToday.toLocaleString('en-US')} 步 · ${stepDistToday >= 1 ? stepDistToday.toFixed(1) : stepDistToday.toFixed(2)} km` : '连上戒指后自动同步')}
                  value={hasSportSessions ? String(Math.round(sportKcalTotal)) : (activityHasData ? String(Math.round(stepKcalToday)) : '—')}
                  unit={(hasSportSessions || activityHasData) ? 'kcal' : undefined}
                  compact
                  style={{ height: theme.sp(32.5), flexGrow: 0, flexShrink: 0 }}
                  onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })}
                />
              </View>
            </View>

            {/* 底部：经期卡——处于什么时期 + 第 N 天 + 最近 7 天日期圈 */}
            <BentoCard
              bg={mm.colors.cardBg}
              chipBg={mm.chipBg.lav.bg}
              icon="moon"
              iconFg={mm.chipBg.lav.fg}
              moonStyle={phaseMoon}
              title="经期"
              aside={status?.phaseLabel ?? undefined}
              dayBadge={status?.dayInCycle ?? null}
              dayBadgeBg={mm.colors.purpleDeep}
              dayBadgeFg={'#FFFFFF'}
              chart={<View style={{ marginTop: theme.sp(1.5) }}><PeriodDayCircles marked={periodMarks} /></View>}
              style={{ height: theme.sp(28), flexGrow: 0 }}
              onPress={() => navigation.navigate('CycleCalendar')}
            />
          </View>
        ) : (
          <View style={styles.adviceWrap}>
            <TodayTimelineCard title="今日日历" dateLabel={dateLabel} items={timelineItems} />
          </View>
        )}
            </ScrollView>{/* /page2Scroll 第二屏内容 */}
          </View>{/* /pageInner 第二屏 */}
        </View>{/* /pageSnap 第二屏 */}
      </ScrollView>{/* /pager 整屏吸附 */}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%' },
  // ★ v18.50 整屏吸附分页
  pagerScroll: { flex: 1, width: '100%' },
  pagerContent: {},
  pageSnap: { width: '100%', alignItems: 'center' },
  pageInner: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.screen,
    flex: 1,
    position: 'relative',
  },
  snapHint: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xs,
  },
  snapHintText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium,
  },
  tabBarSticky: {
    flexDirection: 'row',
    marginTop: theme.space.sm,     // ★ v18.53.3 lg(20)→sm(12)：一屏预算
    marginBottom: theme.space.xs,  // ★ sm(12)→xs(8)
  },
  page2Scroll: { flex: 1, width: '100%' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.xl * 1.5,
  },
  avatarName: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.avatarBgLight,
    borderWidth: 1,
    borderColor: theme.colors.avatarBorderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.sm,
  },
  avatarLetter: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  name: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  /**
   * ★ v18.153（用户：「趋势图往上一点，把下面的图例露出来」）：
   *   一屏纵向预算：head(36+36) + chips(87+12) + [环 + 胶囊 + 趋势图 + 时间轴 + 图例] + 底部圆弧。
   *   环本身已由 EnergyBall 收回画布底部空带（−0.07×svgSize ≈ −21pt）；
   *   这里再把「胶囊 → 趋势图」的间距从 16 收到 8（marginBottom 归零，留给 trendWrap.marginTop），
   *   合计让趋势图与图例整体上移 **≈45pt** → 图例不再被顶出一屏 / 被底部滑动提示压住。
   *   ⚠ 若还要更多空间，下一个旋钮是 EnergyBall 的 size 系数 0.70（环视觉会一起变小），
   *     不要再来动这里的间距。
   */
  energyWrap: { marginBottom: 0, alignItems: 'center' },
  energyBallCol: { alignItems: 'center' },
  // ★ v18.50 修复：不要 flex:1——整屏吸附后 pageInner 是确定高度，flex:1（flexBasis=0）
  // 会让胶囊在自适应父容器里塌成 0 高，分析文字整句不可见。自动高度即可。
  statusPill: { marginTop: theme.space.xs },
  // ★ v18.52 经期日期圈（PeriodDayCircles）
  pdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  pdCircle: {
    width: theme.fs(30),
    height: theme.fs(30),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,   // ★ v18.62 白卡上未标记日期圈改中性浅灰（cardBg 白圈会隐形）
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdCircleText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  statusChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: theme.space.xs,
  },
  statusChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  statusChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.orbTextInk,
  },
  phaseChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  phaseChipIcon: {
    fontSize: theme.fontSize.xs,
    marginRight: theme.sp(1),
    lineHeight: theme.fs(12),
  },
  phaseChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.stateTired,
  },
  statusNarr: {
    // ★ v18.49：保留 A 的 16px/居中/留白28，但降浓——常规字重 + 柔和灰，不再浓黑
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.textSub,
    fontWeight: theme.weight.regular,
    // 面板改成全宽、左右对称之后，文字也居中（原来左对齐会显得偏）
    textAlign: 'center',
    paddingHorizontal: 28,
  },
  // ★ 全天状态面板：全宽白面（负 margin 抵消 ScreenContainer 的 24pt 内边距）
  statusPanel: {
    backgroundColor: theme.colors.cardBg,
    marginHorizontal: -theme.space.screen,
    paddingHorizontal: theme.space.screen,
  },
  // marginBottom 补回原来 trendCard 的 marginBottom(space.lg)：否则下一张「全天恢复」卡会贴着圆弧
  statusPanelArc: {
    marginHorizontal: -theme.space.screen,
    marginTop: -1,
  },
  trendWrap: { position: 'relative', marginTop: theme.space.xs },
  trendChevBtn: {
    position: 'absolute',
    right: 0,
    top: '50%',
    marginTop: -theme.sp(4),
    width: theme.sp(8),
    height: theme.sp(8),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // 玻璃感：沿用 App 的 glassMorph 语言（半透明白 + 白色高光描边 + 柔紫投影）
    backgroundColor: theme.colors.ui.glassBg,
    borderWidth: 1,
    borderColor: theme.colors.ui.glassBorder,
    shadowColor: theme.colors.ui.glassShadow,
    shadowOffset: { width: 0, height: theme.sp(0.5) },
    shadowOpacity: 1,
    shadowRadius: theme.sp(2),
    elevation: 2,
  },

  energyCol: {
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.md,
  },
  energyMini: {
    flex: 1,
    height: 130,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  energyMiniImg: {
    borderRadius: theme.radius.md,
  },
  energyMiniOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 70,
  },
  energyMiniLabel: {
    position: 'absolute', left: 10, right: 10, bottom: 10,
  },
  energyMiniTitle: {
    fontSize: theme.fontSize.micro,
    color: '#fff',
    fontWeight: theme.weight.medium,
  },
  energyMiniValRow: {
    flexDirection: 'row', alignItems: 'baseline',
    marginTop: 2,
  },
  energyMiniVal: {
    fontSize: theme.fontSize.card,
    color: '#fff',
    fontWeight: theme.weight.semibold,
  },
  energyMiniUnit: {
    fontSize: theme.fontSize.micro,
    color: 'rgba(255,255,255,0.85)',
  },
  adviceWrap: { marginTop: theme.space.md },
  cardTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  trendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  axisY: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.stateTired,
    fontWeight: theme.weight.medium,
    marginBottom: theme.sp(1),
  },
  legend: {
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 收紧：让底部圆弧离图表更近（原 12）
    marginTop: theme.space.xs,
    // ★ v18.153 再收 12 → 8：一屏预算（图例必须落在可视区内）
    marginBottom: theme.space.xs,
    gap: theme.space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.sp(1) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  todayTabBtn: {
    flex: 1,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    // ★ 2026-10-06（用户口径）：无底色纯文字；未选无边框，选中只描边（lime）。
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    marginHorizontal: theme.space.xs,
  },
  todayTabBtnOn: {
    borderColor: mm.colors.limeMid,
  },
  todayTabLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  todayTabLabelOn: {
    color: mm.colors.ink,
    fontWeight: theme.weight.semibold,
  },
});
