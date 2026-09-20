import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Rect, Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
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
import TrendChart, { TrendAxis } from '../components/TrendChart';
import TodayTimelineCard, { type TimelineItem } from '../components/TodayTimelineCard';
import { MOODS } from '../data/metrics';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore'
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from '../components/CortisolRhythmCard';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { getAiInsight } from '../ai/insight';
import { MemoryStore } from '../ai/memory';
import { inferThemes } from '../ai/miraAi';
import { onAiRecord } from '../lib/aiRecordBus';

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
  // 脑力消耗 = 认知负荷分 0-100
  const cognitive = (() => {
    try {
      const r = computeCognitiveLoadReport();
      return r?.loadScore != null ? String(Math.round(r.loadScore)) : '—';
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
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
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

export default function TodayScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const [chartW, setChartW] = useState(0);
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
  const cognitive = (() => { try { const r = computeCognitiveLoadReport(); return r?.loadScore != null ? String(Math.round(r.loadScore)) : '—'; } catch { return '—'; } })();
  const activity = (() => { try { const dk = dayKey(Date.now()); const s = ring?.stepDaily?.[dk]?.steps ?? 0; return s > 0 ? String(s) : '—'; } catch { return '—'; } })();

  // 通用 mini chart 尺寸
  const MW=168, MH=88, AXIS_H=16, CHART_H=MH-AXIS_H;

  // —— 情绪消耗：点状图 (24h × 5 严重度网格) + 横坐标 + 最新事件 pop ——
  const MiniStressDots = ({ events }: { events: any[] }) => {
    const C=24, R=5, cw=MW/C, rh=CHART_H/R;
    const ev = (events ?? []).filter((e:any)=>e&&Number.isFinite(e.t));
    // 聚合到 (hour, severityBucket) 格子，取最大 severity
    const grid: number[][] = Array.from({length:C},()=>Array(R).fill(0));
    ev.forEach((e:any)=>{ const h=new Date(e.t).getHours(); const s=e.severity??3; const b=Math.min(R-1,Math.floor(s/2)); if(s>grid[h][b]) grid[h][b]=s; });
    const dots:any[]=[];
    for(let cc=0;cc<C;cc++) for(let r=0;r<R;r++){
      const s=grid[cc][r];
      if(s>0){ const color=s>=5?'#E879F9':s>=3?'#F5A87C':'#F8C5A5'; dots.push(<Circle key={`d${cc}${r}`} cx={cc*cw+cw/2} cy={r*rh+rh/2} r={3.2} fill={color} opacity={0.92} />); }
    }
    // 空态：淡色散点示意
    const phDots:any[]=[];
    if(dots.length===0){
      const ph=[[2,3],[4,2],[6,3],[9,1],[11,3],[13,2],[15,4],[17,2],[19,3],[21,2]];
      ph.forEach(([h,r],i)=>{ phDots.push(<Circle key={'ph'+i} cx={h*cw+cw/2} cy={r*rh+rh/2} r={3} fill="#E879F9" opacity={0.18} />); });
    }
    const popHour = ev.length>0 ? new Date(ev[ev.length-1].t).getHours() : new Date().getHours();
    const popX = popHour*cw+cw/2;
    const PopX = Math.max(18, Math.min(MW-36, popX-18));
    const ticks=[0,6,12,18,24];
    return (
      <View style={{ width: MW, height: MH }}>
        <Svg width={MW} height={MH}>
          {/* 与情绪详情页点状图一致：无横向网格线 */}
          {phDots}
          {dots}
          {ticks.map(h=>{ const eL=h===0,eR=h===24; return (<SvgText key={'t'+h} x={eL?1:eR?MW-1:h*cw+cw/2} y={CHART_H+AXIS_H-3} textAnchor={eL?'start':eR?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.55)">{String(h).padStart(2,'0')}</SvgText>); })}
        </Svg>
        {ev.length>0 ? (
          <View style={{ position:'absolute', left: PopX, top: -4, backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor:'rgba(232,121,249,0.25)' }}>
            <Text style={{ fontSize:10, color:'#E879F9', fontWeight:'700' }}>{ev.length} 次</Text>
          </View>
        ):null}
      </View>
    );
  };

  // —— 脑力消耗：24h 柱状 + 横坐标 + 峰值 pop ——
  const MiniCognitiveBars = ({ hourly }: { hourly: { hour: number; score: number }[] }) => {
    const N=24, scores=Array.from({length:N},(_,i)=>hourly?.find(h=>h.hour===i)?.score??0);
    const max=Math.max(10,...scores), bw=MW/N-1;
    const lastIdx = scores.map((v,i)=>({v,i})).filter(x=>x.v>0).slice(-1)[0]?.i ?? 0;
    const popVal = scores[lastIdx];
    const popX = lastIdx*(MW/N)+bw/2;
    const PopX = Math.max(18, Math.min(MW-36, popX-14));
    const ticks=[0,6,12,18,24];
    return (
      <View style={{ width: MW, height: MH }}>
        <Svg width={MW} height={MH}>
          {scores.map((v,i)=>{ const h=Math.max(1.5,(v/max)*CHART_H),x=i*(MW/N)+0.5,y=CHART_H-h,col=v>70?'#7C3AED':v>40?'#9D8AF0':'#C4B5FD'; return <Rect key={'b'+i} x={x} y={y} width={bw} height={h} rx={1} fill={col} />; })}
          {ticks.map(h=>{ const eL=h===0,eR=h===24; return (<SvgText key={'t'+h} x={eL?1:eR?MW-1:h*(MW/N)+bw/2} y={CHART_H+AXIS_H-3} textAnchor={eL?'start':eR?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.6)">{String(h).padStart(2,'0')}</SvgText>); })}
        </Svg>
        {popVal>0 ? (
          <View style={{ position:'absolute', left: PopX, top: -2, backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor:'rgba(124,58,237,0.2)' }}>
            <Text style={{ fontSize:10, color:'#7C3AED', fontWeight:'700' }}>{Math.round(popVal)}</Text>
          </View>
        ):null}
      </View>
    );
  };

  // —— 运动消耗：近 7 天步数曲线 + 横坐标(一二三四五六日) + 今日 pop ——
  const MiniActivityCurve = ({ weekSteps }: { weekSteps: { dayKey: string; steps: number; date: Date }[] }) => {
    const N=7, MON=['一','二','三','四','五','六','日'];
    const series = weekSteps.slice(-7);
    const steps = series.map(s=>s.steps);
    const max = Math.max(1,...steps);
    const pts = steps.map((v,i)=>({x:(i/(N-1))*(MW-8)+4, y:CHART_H-(v/max)*CHART_H*0.85-3}));
    let p = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for(let i=0;i<N-1;i++){ const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(N-1,i+2)]; p+=` C ${(p1.x+(p2.x-p0.x)*0.25).toFixed(1)} ${(p1.y+(p2.y-p0.y)*0.25).toFixed(1)}, ${(p2.x-(p3.x-p1.x)*0.25).toFixed(1)} ${(p2.y-(p3.y-p1.y)*0.25).toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`; }
    const area = p+` L ${pts[N-1].x.toFixed(1)} ${CHART_H} L ${pts[0].x.toFixed(1)} ${CHART_H} Z`;
    const last = pts[N-1];
    const PopX = Math.max(18, Math.min(MW-48, last.x-20));
    return (
      <View style={{ width: MW, height: MH }}>
        <Svg width={MW} height={MH}>
          <Defs>
            <SvgLinear id="actFill2" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#7EA6F8" stopOpacity={0.35} />
              <Stop offset="100%" stopColor="#7EA6F8" stopOpacity={0.02} />
            </SvgLinear>
          </Defs>
          <Path d={area} fill="url(#actFill2)" />
          <Path d={p} fill="none" stroke="#7EA6F8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((pt,i)=>(<Circle key={'pt'+i} cx={pt.x} cy={pt.y} r={2.5} fill="#7EA6F8" />))}
          {series.map((s,i)=>(<SvgText key={'t'+i} x={pts[i].x} y={CHART_H+AXIS_H-3} textAnchor={i===0?'start':i===N-1?'end':'middle'} fontSize={8} fill="rgba(120,110,160,0.6)">{MON[s.date.getDay()===0?6:s.date.getDay()-1]}</SvgText>))}
        </Svg>
        {steps[N-1]>0 ? (
          <View style={{ position:'absolute', left: PopX, top: Math.max(0,last.y-22), backgroundColor:'#fff', borderRadius:6, paddingHorizontal:6, paddingVertical:3, shadowColor:'rgba(0,0,0,0.12)', shadowOffset:{width:0,height:2}, shadowOpacity:1, shadowRadius:4, elevation:3, borderWidth:1, borderColor:'rgba(126,166,248,0.25)' }}>
            <Text style={{ fontSize:10, color:'#7EA6F8', fontWeight:'700' }}>{steps[N-1]}</Text>
          </View>
        ):null}
      </View>
    );
  };

  const stressReport = (() => { try { return computeStressReport(); } catch { return null; } })();
  const cogReport = (() => { try { return computeCognitiveLoadReport(); } catch { return null; } })();
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

  const BigStatCard = ({ title, value, unit, sub, trendUp, trendPct, chartEl, gradientColors, onPress }: any) => (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={{ width: '100%' }}>
      <GlassCard padded={false} style={{ height: 150 }}>
        <LinearGradient colors={gradientColors} start={{ x: 0.5, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, height: '100%', justifyContent: 'space-between', paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textInk, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold }}>{title}</Text>
              <Text style={{ color: trendUp ? '#10B981' : '#EF4444', fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold }}>{trendUp?'↑':'↓'} {trendPct}</Text>
            </View>
            <View style={{ paddingTop: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ color: theme.colors.textInk, fontSize: 44, fontWeight: theme.weight.bold, lineHeight: 48 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.sm, marginLeft: 4 }}>{unit}</Text>
              </View>
              <Text style={{ color: 'rgba(120,110,160,0.6)', fontSize: theme.fontSize.micro, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
            </View>
          </View>
          <View style={{ marginLeft: 4, alignItems: 'flex-end', justifyContent: 'flex-end' }}>{chartEl}</View>
        </View>
        <Icon name="chevronRight" size={18} color={theme.colors.textSub} style={{ position: 'absolute', top: 12, right: 12, zIndex: 3 }} />
      </GlassCard>
    </TouchableOpacity>
  );

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
  const advice = isAsleep
    ? (phase === '经期' ? '经期睡眠中，安心休息助修复' : phase === '黄体期' ? '黄体期睡眠中，深睡稳情绪' : '睡眠恢复中，安心休息')
    : fallbackAdvice;
  if (__DEV__) console.log(`[TodayAdvice] ai=${aiAdvice ?? 'null'} fallback=${fallbackAdvice} phase=${phase} idx=${statusIdx}`);
  const isAiText = false;  // 圆环下建议用规则更准（1.5B 模型搞不定时段优先级）
  const showPill = statusIdx != null || phaseKnown;
  const narrative = showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析';

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
  // 4. 脑力负荷高峰（峰值来自已观测的小时数据；高峰段尚未到来时只显示「今日」，不写未来时刻）
  if (cogReport?.loadScore != null) {
    const span = cogReport.peakLoadSpan;
    const spanMin = span ? span.startHour * 60 : null;
    const spanPast = spanMin != null && spanMin <= curMin;
    pushItem({
      time: spanPast ? `${pad2(span!.startHour)}:00` : '今日',
      color: theme.colors.accentSolid,
      title: `脑力负荷 ${Math.round(cogReport.loadScore)}`,
      sub: '高峰时段安排专注任务更高效',
    }, spanPast ? spanMin! : curMin);
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
  const cogSpan = cogReport?.peakLoadSpan ?? null;
  const cognitiveSub = cogSpan && cogSpan.startHour * 60 <= curMin ? `峰值 ${pad2(cogSpan.startHour)}:00` : '认知状态平稳';
  const stepKcalToday = (() => { try { return ring?.stepDaily?.[dkToday]?.calorie ?? 0; } catch { return 0; } })();
  const activitySub = activity === '—' || activity === '0'
    ? '今日暂无运动'
    : stepKcalToday > 0 ? `${Math.round(stepKcalToday)} kcal 已消耗` : '今日活动进行中';

  return (
    <View style={styles.page}>
      {/* 仅 Today 页：上白下紫的分屏背景，其他页面保留 App 根渐变 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite, theme.colors.bgMidAlt, theme.colors.bgTop]}
        locations={[0, 0.42, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer>
        <View style={styles.head}>
          <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>K</Text>
            </View>
            <Text style={styles.name}>Kristina</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Today</Text>
        </View>

        <View style={styles.energyWrap}>
          <View style={styles.energyBallCol}>
            <EnergyBall status={ring.curveStatus} centerLabelOverride={isAsleep ? '睡眠恢复中' : undefined} />
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusNarr}>{narrative}</Text>
          </View>
        </View>

        <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('StatusTrendDetail')}>
          <Card style={styles.trendCard}>
          <View style={styles.cardChevronRow}>
            <Icon name="chevronRight" size={18} color={theme.colors.textSub} />
          </View>
          <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
            {chartW > 0 ? <TrendChart width={chartW} timeline={ring.statusTimeline} /> : null}
          </View>
          {chartW > 0 ? <TrendAxis width={chartW} /> : null}
          <View style={styles.legend}>
            {MOODS.map((m) => (
              <LegendDot key={m.key} color={m.color} label={m.label} />
            ))}
          </View>
          </Card>
        </TouchableOpacity>

        {/* ★ 新增「全天恢复」卡：上半睡眠恢复 + 皮质醇峰值，下半皮质醇全天趋势（渐变卡）。
            放在「全天状态趋势」正下方；原有卡片（身体恢复 / 三个消耗小卡）保持不变。 */}
        <AllDayRecoveryCard onPress={() => navigation.navigate('EmotionCognitiveDetail')} />


        <View style={{ height: theme.space.lg }} />

        <View style={{ flexDirection: 'column', gap: theme.space.md }}>
          <BigStatCard title="情绪消耗" value={stress} unit="次" sub={stressSub} trendUp={true} trendPct="+5.2%" chartEl={<MiniStressDots events={stressReport?.events ?? []} />} gradientColors={['rgba(255,255,255,0)', 'rgba(253,232,240,0.4)', 'rgba(253,232,240,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })} />
          <BigStatCard title="脑力消耗" value={cognitive} unit="/100" sub={cognitiveSub} trendUp={true} trendPct="+3.1%" chartEl={<MiniCognitiveBars hourly={cogReport?.hourly ?? []} />} gradientColors={['rgba(255,255,255,0)', 'rgba(221,214,254,0.4)', 'rgba(221,214,254,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })} />
          <BigStatCard title="运动消耗" value={activity} unit="步" sub={activitySub} trendUp={true} trendPct="+12%" chartEl={<MiniActivityCurve weekSteps={weekSteps} />} gradientColors={['rgba(255,255,255,0)', 'rgba(191,219,254,0.4)', 'rgba(191,219,254,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })} />
        </View>

        <View style={styles.adviceWrap}>
          <TodayTimelineCard title="今日日历" dateLabel={dateLabel} items={timelineItems} />
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%' },
  head: { marginBottom: theme.space.xl * 1.5 },
  avatarName: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.space.xs },
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
    marginTop: theme.space.xs,
  },
  energyWrap: { marginBottom: theme.space.sm, alignItems: 'center' },
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
    color: theme.colors.accentSolid,
  },
  statusNarr: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.55,
    color: theme.colors.textSub,
    textAlign: 'left',
  },
  trendCard: { marginTop: theme.space.md, marginBottom: theme.space.lg },
  cardChevronRow: { flexDirection: 'row', justifyContent: 'flex-end' },

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
    color: theme.colors.accentSolid,
    fontWeight: theme.weight.medium,
    marginBottom: theme.sp(1),
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.space.sm,
    gap: theme.space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.sp(1) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
