import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground, Animated, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Rect, Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';

const IMG_RECOVERY = require('../assets/card_recovery.jpg');
const IMG_EMOTION = require("../assets/card_emotion_new.png");
const IMG_COG = require("../assets/card_focus.jpg");
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
import Card from '../components/Card';
import GlassCard from '../components/GlassCard';
import Icon from '../components/Icon';
import EnergyBall from '../components/EnergyBall';
import AllDayRecoveryCard from '../components/AllDayRecoveryCard';
import MindChips, { type MindChipItem } from '../components/MindChips';
import MindStatCard from '../components/MindStatCard';
import EmotionDots, { type MindMoodKey } from '../components/EmotionDots';
import MindWave from '../components/MindWave';
import TrendChart, { TrendAxis } from '../components/TrendChart';
import TodayTimelineCard, { type TimelineItem } from '../components/TodayTimelineCard';
import { MOODS } from '../data/metrics';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport, COG_LEVEL_LOW, COG_LEVEL_HIGH, cogLevelLabel } from '../lib/cognitiveLoad';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore'
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from '../components/CortisolRhythmCard';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { getAiInsight } from '../ai/insight';
import { MemoryStore } from '../ai/memory';
import { inferThemes } from '../ai/miraAi';
import { onAiRecord } from '../lib/aiRecordBus';
import { evaluateTodayScene, markSceneShown, initTodaySceneCounter, buildCauseNarrative, type TodayScene } from '../lib/todayScene';

/** 「今日日历」取的 AI 聊天记录（MemoryStore 单例，避免每次渲染重建） */
const memoryStore = new MemoryStore();


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


function EnergyRowData({ ring, onNav, outerOnNav }: { ring: any; onNav: (type: 'emotion' | 'cognitive' | 'activity') => void; outerOnNav: () => void }) {
  const _dk = (() => {
    try {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch { return ''; }
  })();
  // 情绪消耗 = 今日压力事件数
  const stress = (() => {
    try {
      const r = computeStressReport();
      return r?.events?.length > 0 ? String(r.events.length) : '—';
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

  // 子卡（情绪/脑力）——图片背景 + 底部白色渐变蒙层
  const subCard = (img: number, title: string, val: string, unit: string, onPress: () => void) => (
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

      {/* ★ 情绪消耗 / 脑力消耗 / 运动消耗 —— 并排独立小卡 */}
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {subCard(IMG_EMOTION, '情绪消耗', stress, '次', () => onNav('emotion'))}
        {subCard(IMG_COG, '脑力消耗', cognitive, '/100', () => onNav('cognitive'))}
        {subCard(IMG_ACTIVITY, '运动消耗', activity, '步', () => onNav('activity'))}
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
const COG_EMPTY_HOURLY = Array.from({ length: 24 }, (_, h) => ({ hour: h, score: 0, hasData: false }));
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
        {rows.map((r,i)=>{ const h=Math.max(1.5,(r.v/100)*CH),x=i*(W/N)+0.5,y=CH-h,col=r.has?barColor(r.v):NO_DATA; return <Rect key={'b'+i} x={x} y={y} width={bw} height={h} rx={1} fill={col} />; })}
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
  const navigation = useNavigation<any>();
  const [chartW, setChartW] = useState(0);
  const [todayTab, setTodayTab] = useState<'rhythm' | 'diary'>('rhythm');
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

  const stress = (() => { try { const r = computeStressReport(); return r?.events?.length > 0 ? String(r.events.length) : '0'; } catch { return '—'; } })();
  // 认知准备度 = 脑力账户当前剩余（早上从准备度/储备起步，白天随消耗下降，只算脑）；无数据 → 诚实显示 —
  const cognitive = (() => { try { const r = computeCognitiveLoadReport(); return r?.brainRemaining != null ? String(r.brainRemaining) : '—'; } catch { return '—'; } })();
  const activity = (() => { try { const dk = dayKey(Date.now()); const s = ring?.stepDaily?.[dk]?.steps ?? 0; return s > 0 ? String(s) : '—'; } catch { return '—'; } })(); // 顶部 chip 备用：当日步数
  // 恢复 = 最近一晚睡眠评分 0-100（与「全天恢复」卡 AllDayRecoveryCard 同一取数口径：
  // 优先今天、其次昨天——跨午夜的睡眠常记在前一日）。没有睡眠记录就诚实留 —，不编数字。
  const recoverySleep = (() => {
    try {
      return healthStore.getSleep(dayKey(Date.now())) ?? healthStore.getSleep(dayKey(Date.now() - 86400000)) ?? null;
    } catch { return null; }
  })();
  const recovery = recoverySleep && Number.isFinite(recoverySleep.score) ? String(Math.round(recoverySleep.score)) : '—';
  const recoverySub = (() => {
    const t = recoverySleep?.total;
    if (t == null || !Number.isFinite(t) || t <= 0) return '暂无';
    const h = Math.floor(t / 60), m = Math.round(t % 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
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
  // 认知柱状图只在有真实采样时渲染（首页卡片无数据不放示意图，副标题提示点开查看）
  const cogHasData = (cogReport?.hourly ?? []).some((h: any) => h.hasData);
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
  //           > 饭前低电量 > 久坐 > 午后低谷 > 傍晚收工；无场景 → 常规相位句。
  //   频控：每词每日 ≤3 次（多数 ≤1）+ 最短冷却，持久化跨重启（lib/todayScene）。
  const scene: TodayScene | null = (() => {
    try {
      const nowMs = Date.now();
      const stepsPts = healthStore.getTimeRange('steps' as any, nowMs - 2 * 3600e3, nowMs, { maxPoints: 60 });
      const stepsLast2h = stepsPts.length >= 2 ? Math.max(0, stepsPts[stepsPts.length - 1].v - stepsPts[0].v) : 0;
      const stressRecent1h = (stressReport?.events ?? []).filter((e: any) => Number.isFinite(e.t) && e.t >= nowMs - 3600e3).length;
      return evaluateTodayScene({
        now: nowMs,
        isAsleep,
        statusValue: status?.value ?? null,
        sleepScore: recoverySleep && Number.isFinite(recoverySleep.score) ? recoverySleep.score : null,
        wakeTimeStr: recoverySleep?.wakeTime ?? null,
        stressRecent1h,
        stepsLast2h,
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
  const narrative = scene ? scene.explain : (causeNarrative || (showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析'));

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
      title: `${cs.phaseLabel}${cs.dayInCycle != null ? ` 第 ${cs.dayInCycle} 天` : ''}`,
      sub: cs.phaseLabel === '黄体期' ? '激素回落，留意情绪与能量起伏' : cs.phaseLabel === '经期' ? '以温和舒缓为主，适合休息' : '激素节律影响今日状态节奏',
    }, -1);
  }
  // 2. 起床（真实睡眠窗口）
  if (todaySleep?.wakeTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(todaySleep.wakeTime.trim());
    pushItem({
      time: todaySleep.wakeTime,
      color: theme.colors.stateTired,
      title: `起床 · 睡眠评分 ${todaySleep.score ?? '—'}`,
      sub: `睡眠 ${fmtMin(todaySleep.total)} · 深睡 ${fmtMin(todaySleep.deep)}`,
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
  const cogLevelTxt = cogLevelLabel(cogReport?.avgFatigue);
  // 峰值时刻取「已观测小时柱」最高点（与卡片柱状图完全同源）；未观测到就只给档位，不写未来时刻
  const cogPeakBar = (() => {
    const bars = (cogReport?.hourly ?? []).filter(h => h.hasData && h.hour * 60 <= curMin);
    return bars.length > 0 ? bars.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  })();
  const cognitiveSub = cogPeakBar
    ? `峰值 ${pad2(cogPeakBar.hour)}:00 · ${cogLevelTxt}`
    : `全天${cogLevelTxt}疲劳`;
  const stepKcalToday = (() => { try { return ring?.stepDaily?.[dkToday]?.calorie ?? 0; } catch { return 0; } })();
  const stepDistToday = (() => { try { return ring?.stepDaily?.[dkToday]?.distance ?? 0; } catch { return 0; } })();
  // 运动卡数据口径：卡路里为主数字（kcal），脚注行=步数(stepsToday 复用上方声明)+距离；今日有任何步数即视为有数据
  const activityHasData = (stepsToday > 0) || weekSteps.some((w) => w.steps > 0);

  // ★ chips 数据标签（数值下方一行小字）：全部由当天真实数据推导档位，无数据不给词
  const recTag = (() => {
    if (recovery == null || recovery === '—') return undefined;
    const s = Number(recovery);
    return s >= 80 ? '恢复良好' : s >= 60 ? '恢复中' : '恢复偏弱';
  })();
  const cogTag = (() => {
    try {
      const used = computeCognitiveLoadReport()?.brainUsed;
      if (used == null) return undefined;
      return used < 20 ? '低消耗' : used < 45 ? '中等消耗' : '高消耗';
    } catch { return undefined; }
  })();
  const emoTag = (() => {
    if (stress === '—') return undefined;
    const n = Number(stress);
    if (!Number.isFinite(n)) return undefined;
    return n === 0 ? '平稳' : n <= 2 ? '有波动' : '消耗偏高';
  })();
  const actTag = (() => {
    if (!activityHasData || stepsToday <= 0) return undefined;
    return stepsToday < 3000 ? '活动偏少' : stepsToday < 7000 ? '轻度活动' : '活力充足';
  })();

  /**
   * ★ 顶部四指标 chips（MindMate v10 Reskin）：白卡 chip = pastel 方块 icon + 灰标签 + 数值。
   * 数据与消耗卡**同源同口径**：认知=准备度（脑力账户剩余）、情绪=事件数、运动=当日步数、恢复=睡眠评分。
   * 无数据显式传 '—'，不编数字。
   */
  const metricChips: MindChipItem[] = [
    { key: 'rec', icon: 'leaf', tone: 'lime', label: '恢复程度', value: recovery, unit: '/100', tag: recTag, onPress: () => navigation.navigate('EmotionCognitiveDetail') },
    { key: 'cog', icon: 'nodes', tone: 'lav', label: '脑力值', value: cognitive, unit: '/100', tag: cogTag, onPress: () => navigation.navigate('EnergyDetail', { type: 'cognitive' }) },
    { key: 'emo', icon: 'heart', tone: 'pink', label: '情绪负荷', value: stress, tag: emoTag, onPress: () => navigation.navigate('EnergyDetail', { type: 'emotion' }) },
    { key: 'act', icon: 'bolt', tone: 'cyan', label: '运动消耗', value: activityHasData ? `${Math.round(stepKcalToday)} kcal` : '—', tag: actTag, onPress: () => navigation.navigate('EnergyDetail', { type: 'activity' }) },
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
   * 情绪点阵 96 槽映射（15 分钟/点）。**只用真实数据，不编状态**：
   * · 睡眠窗口（真实睡眠摘要 sleepTime→wakeTime，跨午夜）→ sleep
   * · 压力事件所在的 15 分钟槽（真实 EDA 事件）→ stress
   * · 其余清醒时段 → 取「今日状态曲线」（每 30 分钟一个真实档位）：
   *   充沛→元气、平稳→平静、偏低/不足→疲惫；无曲线覆盖时回落平静（中性底色）。
   * 专注档无对应数据源，不参与映射（图例不展示，仅颜色编码）。
   */
  const emotionSlots: MindMoodKey[] = (() => {
    const slots: MindMoodKey[] = new Array(96).fill('calm');
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
    const pts = ring.statusTimeline ?? [];
    for (let i = 0; i < 96; i++) {
      const m = i * 15;
      if (inSleep(m)) { slots[i] = 'sleep'; continue; }
      if (m > nowMin) { slots[i] = 'calm'; continue; }
      let lvl: string | null = null;
      for (const p of pts) {
        if (!Number.isFinite(p.t)) continue;
        const d = new Date(p.t);
        const pm = d.getHours() * 60 + d.getMinutes();
        if (pm <= m + 15 && m - pm < 60) lvl = p.level;
      }
      slots[i] = lvl ? (lvlMap[lvl] ?? 'calm') : 'calm';
    }
    for (const e of stressReport?.events ?? []) {
      if (Number.isFinite(e.hour) && Number.isFinite(e.minute)) {
        const idx = Math.min(95, Math.max(0, Math.floor((e.hour * 60 + e.minute) / 15)));
        slots[idx] = 'stress';
      }
    }
    return slots;
  })();

  return (
    <View style={styles.page}>
      {/* MindMate v10：首页背景全白（SPEC §0 规则 1）。原「上白下紫」分屏收起——
          状态面板圆弧在纯白底上自然隐形，页面成为一个连续白面。 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer scrollY={scrollY} topFadeColor={theme.colors.textWhite}>
        <Animated.View
          style={[styles.head, { opacity: headOpacity, transform: [{ translateY: headLift }] }]}
        >
          {/* v18.45 头部单行：Today 居左（原头像位），头像+名字移到右侧 */}
          <Text style={styles.title}>Today</Text>
          <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>K</Text>
            </View>
            <Text style={styles.name}>Kristina</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ─────────────────────────────────────────────────────────────
            ★ 顶部四指标 chips（MindMate v10）：白卡 chip + pastel 方块 icon。
            · 数据与消耗卡同源同口径；间距沿用 head 的 marginBottom(36)。
            ───────────────────────────────────────────────────────────── */}
        <View style={{ marginBottom: theme.space.md }}>
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
                {chartW > 0 ? <TrendChart width={chartW} timeline={ring.statusTimeline} /> : null}
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
          style={[styles.statusPanelArc, { marginBottom: theme.space.lg }]}
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

        {/* Tab 切换器: 消耗与恢复节律 / 日记 */}
        <View style={{ flexDirection: 'row', marginTop: theme.space.lg, marginBottom: theme.space.sm }}>
          <TouchableOpacity onPress={() => setTodayTab('rhythm')}
            style={[styles.todayTabBtn, todayTab === 'rhythm' && styles.todayTabBtnOn]}>
            <Text style={[styles.todayTabLabel, todayTab === 'rhythm' && styles.todayTabLabelOn]}>消耗与恢复节律</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTodayTab('diary')}
            style={[styles.todayTabBtn, todayTab === 'diary' && styles.todayTabBtnOn]}>
            <Text style={[styles.todayTabLabel, todayTab === 'diary' && styles.todayTabLabelOn]}>今日旅程</Text>
          </TouchableOpacity>
        </View>

        {/* Tab 内容（MindMate v10：睡眠+情绪 / 认知+运动 两行白卡；无 AI 建议卡——用户明确首页不放） */}
        {todayTab === 'rhythm' ? (
          <View style={{ gap: theme.space.sm }}>
            <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
              <MindStatCard
                title="睡眠恢复"
                cornerIcon="moon"
                cornerTone="lav"
                sub={sleepCard ? `恢复得分 ${sleepCard.score != null ? `${sleepCard.score}/100` : '—'} · 深睡 ${sleepCard.deepPct != null ? `${sleepCard.deepPct}%` : '—'}` : '暂无睡眠记录'}
                value={sleepCard ? sleepCard.total : '—'}
                foot={sleepCard ? `入睡 ${sleepCard.sleepTime ?? '—'} · 夜间醒来 ${sleepCard.wakeCount != null ? sleepCard.wakeCount : '—'} 次` : undefined}
                onPress={() => navigation.navigate('SleepDetail')}
              />
              <MindStatCard
                title="情绪消耗"
                cornerIcon="heart"
                cornerTone="pink"
                sub="15 分钟 / 点 · 全天 96 点"
                value={stress}
                unit="次峰值"
                chart={<EmotionDots slots={emotionSlots} />}
                onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
              <MindStatCard
                title="认知消耗"
                cornerIcon="nodes"
                cornerTone="lav"
                sub="认知疲劳度 · 全天趋势"
                value={cogHasData ? `${cogLevelTxt}疲劳` : '暂无数据'}
                chart={<MiniCognitiveBars hourly={cogHasData ? cogReport!.hourly : COG_EMPTY_HOURLY} />}
                onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })}
              />
              <MindStatCard
                title="运动消耗"
                cornerIcon="bolt"
                cornerTone="cyan"
                sub="今日活动消耗"
                value={activityHasData ? String(Math.round(stepKcalToday)) : '暂无数据'}
                unit={activityHasData ? 'kcal' : undefined}
                foot={activityHasData
                  ? undefined
                  : '连上戒指后自动同步今日活动'}
                footLines={activityHasData
                  ? [`步数 ${stepsToday.toLocaleString('en-US')}`, `距离 ${stepDistToday >= 1 ? stepDistToday.toFixed(1) : stepDistToday.toFixed(2)} km`]
                  : undefined}
                onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })}
              />
            </View>

            {/* 全天恢复：只在「消耗与恢复节律」tab 显示（2026-09-24 用户要求日历 tab 下去掉） */}
            <AllDayRecoveryCard onPress={() => navigation.navigate('EmotionCognitiveDetail')} />
          </View>
        ) : (
          <View style={styles.adviceWrap}>
            <TodayTimelineCard title="今日日历" dateLabel={dateLabel} items={timelineItems} />
          </View>
        )}
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%' },
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
  energyWrap: { marginBottom: theme.space.xs, alignItems: 'center' },
  energyBallCol: { alignItems: 'center' },
  statusPill: { flex: 1, marginTop: theme.space.xs, justifyContent: 'center' },
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
    fontSize: theme.fs(12),
    marginRight: theme.sp(1),
    lineHeight: theme.fs(12),
  },
  phaseChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.stateTired,
  },
  statusNarr: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.55,
    color: theme.colors.textSub,
    // 面板改成全宽、左右对称之后，文字也居中（原来左对齐会显得偏）
    textAlign: 'center',
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
    marginBottom: theme.space.sm,
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
    // v16 统一 tab 样式：未选 = 中性灰浅底（与洞察页 Segmented/子 tab 同款，无描边）
    backgroundColor: mm.colors.btnBusyBg,
    marginHorizontal: theme.space.xs,
  },
  todayTabBtnOn: {
    backgroundColor: mm.colors.limeSoft,
  },
  todayTabLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  todayTabLabelOn: {
    color: mm.colors.limeDeep,
    fontWeight: theme.weight.semibold,
  },
});
