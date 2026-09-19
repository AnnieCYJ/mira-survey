import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Rect, Path, Defs, LinearGradient as SvgLinear, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';

const IMG_RECOVERY = require('../assets/card_recovery.jpg');
const IMG_EMOTION = require("../assets/card_emotion_new.png");
const IMG_COG = require("../assets/card_focus.jpg");
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
import Card from '../components/Card';
import Icon from '../components/Icon';
import { MoonDot, phaseToMoonStyle } from '../components/CycleMoonPhase';
import EnergyBall from '../components/EnergyBall';
import AllDayRecoveryCard from '../components/AllDayRecoveryCard';
import TrendChart, { TrendAxis } from '../components/TrendChart';
import ListCard, { type ListItem } from '../components/ListCard';
import { MOODS } from '../data/metrics';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore'
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from '../components/CortisolRhythmCard';
import { curveLevel, CURVE_DEFAULTS, type CurveStatus } from '../lib/dailyStatus';
import { getAiInsight } from '../ai/insight';

const ADVICE_STATIC: ListItem[] = [
  {
    dot: theme.colors.stateTense,
    title: '14:00 会议前安排 5 分钟呼吸',
    sub: '该时段连续两天出现压力峰值',
  },
  {
    dot: theme.colors.stateTired,
    title: '入睡时间提前 20 分钟',
    sub: '深睡窗口稳定，可再争取一个完整周期',
  },
];

// 首条建议：跟随真实周期相位 + 雌激素建模指数（替代写死的「雌激素峰值窗口」）。
// 雌激素指数由 computeCycle 用真实排卵日（含体温确认覆盖）算出，非编数据。
function cycleAdviceItem(cs: CurveStatus | null): ListItem {
  if (!cs || !cs.hasLog || cs.dayInCycle == null) {
    return {
      dot: theme.colors.stateTired,
      title: '记录经期后开启周期建议',
      sub: '今天先以身体感受为准，灵活安排节奏',
    };
  }
  const e = cs.estrogenIndex;
  const eTxt = e != null ? `（指数 ${e}）` : '';
  switch (cs.phaseLabel) {
    case '经期':
      return {
        dot: theme.colors.stateTired,
        title: '今天以温和舒缓为主',
        sub: `经期第 ${cs.dayInCycle} 天，雌激素低位${eTxt}，适合休息与轻活动`,
      };
    case '卵泡期':
      return {
        dot: theme.colors.stateEnergy,
        title: '适合开启新计划与创造性工作',
        sub: `雌激素回升${eTxt}，精力逐步走高`,
      };
    case '排卵期':
      return {
        dot: theme.colors.stateEnergy,
        title: '状态活跃，适合社交与重要沟通',
        sub: `雌激素峰值${eTxt}，恢复能力处于本月高位`,
      };
    case '黄体期':
      return {
        dot: theme.colors.stateTense,
        title: '适合专注执行与收尾',
        sub: `雌激素回落${eTxt}，留意情绪与能量起伏`,
      };
    default:
      return {
        dot: theme.colors.stateTired,
        title: '记录经期后开启周期建议',
        sub: '今天先以身体感受为准',
      };
  }
}


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

  const stress = (() => { try { const r = computeStressReport(); return r?.events?.length > 0 ? String(r.events.length) : '0'; } catch { return '—'; } })();
  const cognitive = (() => { try { const r = computeCognitiveLoadReport(); return r?.loadScore != null ? String(Math.round(r.loadScore)) : '—'; } catch { return '—'; } })();
  const activity = (() => { try { const dk = dayKey(Date.now()); const s = ring?.stepDaily?.[dk]?.steps ?? 0; return s > 0 ? String(s) : '—'; } catch { return '—'; } })();

  const GlassCard = ({ children, style }: any) => (
    <View style={[{ backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: theme.radius.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', shadowColor: 'rgba(80,60,140,0.12)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 20, elevation: 6, overflow: 'hidden' }, style]}>{children}</View>
  );

  const MiniStressDots = ({ events }: { events: any[] }) => {
    const W=140,H=56,C=24,R=4,cw=W/C,rh=H/R;
    const c1='#7FD4A0',c2='#E5D9C5',c3='#F5A87C',c4='#E879F9';
    const g: any[][][] = Array.from({length:C},()=>Array.from({length:R},()=>[]));
    (events??[]).forEach((e:any)=>{ if(!e||!Number.isFinite(e.t)) return; const d=new Date(e.t); g[d.getHours()][Math.min(3,Math.floor(d.getMinutes()/15))].push(e); });
    const dots:any[]=[];
    for(let cc=0;cc<C;cc++) for(let r=0;r<R;r++) g[cc][r].slice(0,3).forEach((e:any,j)=>{ dots.push(<Circle key={`d${cc}${r}${j}`} cx={cc*cw+cw/2+(j-1)*3.5} cy={r*rh+rh/2} r={2.4} fill={e.severity>=5?c4:c3} />); });
    if(dots.length===0){ const ph=Array.from({length:14},(_,i)=>({cx:((i*7)%C)*cw+cw/2,cy:((i*3)%R)*rh+rh/2,col:[c1,c2,c1,c2,c1][i%5],o:0.25+(i%3)*0.1})); return <Svg width={W} height={H}>{ph.map((d,i)=>(<Circle key={'p'+i} cx={d.cx} cy={d.cy} r={2.8} fill={d.col} opacity={d.o} />))}</Svg>; }
    return <Svg width={W} height={H}>{dots}</Svg>;
  };

  const MiniCognitiveBars = ({ hourly }: { hourly: { hour: number; score: number }[] }) => {
    const W=140,H=56,N=24;
    const scores=Array.from({length:N},(_,i)=>hourly?.find(h=>h.hour===i)?.score??0);
    const max=Math.max(10,...scores),bw=W/N-1.2;
    return <Svg width={W} height={H}>{scores.map((v,i)=>{ const h=Math.max(1.5,(v/max)*H),x=i*(W/N)+0.6,y=H-h,col=v>70?'#7C3AED':v>40?'#9D8AF0':'#C4B5FD'; return <Rect key={'b'+i} x={x} y={y} width={bw} height={h} rx={1} fill={col} />; })}</Svg>;
  };

  const MiniActivityCurve = ({ bins }: { bins: number[] }) => {
    const W=140,H=56,N=bins.length,max=Math.max(1,...bins);
    const pts=bins.map((v,i)=>({x:(i/(N-1))*W,y:H-(v/max)*H*0.9-3}));
    let p=`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for(let i=0;i<N-1;i++){ const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(N-1,i+2)]; p+=` C ${(p1.x+(p2.x-p0.x)/6).toFixed(1)} ${(p1.y+(p2.y-p0.y)/6).toFixed(1)}, ${(p2.x-(p3.x-p1.x)/6).toFixed(1)} ${(p2.y-(p3.y-p1.y)/6).toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`; }
    const area=p+` L ${pts[N-1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;
    return <Svg width={W} height={H}><Defs><SvgLinear id="actFill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#BFDBFE" stopOpacity={0.7} /><Stop offset="100%" stopColor="#BFDBFE" stopOpacity={0.02} /></SvgLinear></Defs><Path d={area} fill="url(#actFill)" /><Path d={p} fill="none" stroke="#7EA6F8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  };

  const stressReport = (() => { try { return computeStressReport(); } catch { return null; } })();
  const cogReport = (() => { try { return computeCognitiveLoadReport(); } catch { return null; } })();
  const activityBins = (() => { const b=new Array(24).fill(0); try { const dk=dayKey(Date.now()),sd=ring?.stepDaily?.[dk]; if(sd?.steps>0){for(let h=7;h<=22;h++)b[h]=Math.round(sd.steps/20);b[12]=Math.round(sd.steps/10);b[13]=Math.round(sd.steps/14);} } catch {} return b; })();

  const BigStatCard = ({ title, value, unit, sub, trendUp, trendPct, chartEl, gradientColors, onPress }: any) => (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={{ width: '100%' }}>
      <GlassCard style={{ height: 150 }}>
        <LinearGradient colors={gradientColors} start={{ x: 0.5, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, height: '100%', justifyContent: 'space-between', paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
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
  const mood = statusIdx != null ? MOODS[statusIdx] : null;
  const phase = status?.phaseLabel ?? '未记录';
  const phaseKnown = phase !== '未记录';
  // 月相：与首页圆环一致，用 CycleMoonPhase 的 MoonDot
  const phaseKeyMap: Record<string, 'period' | 'follicular' | 'ovulation' | 'luteal'> = {
    '经期': 'period',
    '卵泡期': 'follicular',
    '排卵期': 'ovulation',
    '黄体期': 'luteal',
  };
  const phaseMoonStyle = phaseKeyMap[phase] ? phaseToMoonStyle(phaseKeyMap[phase]) : null;
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
  const hasStatus = !!mood;
  const showPill = hasStatus || phaseKnown;
  const narrative = showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析';

  // 今日建议：首条跟随真实周期相位 + 雌激素指数，其余为通用建议
  const ADVICE: ListItem[] = [cycleAdviceItem(ring.curveStatus), ...ADVICE_STATIC];

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
          <EnergyBall status={ring.curveStatus} centerLabelOverride={isAsleep ? '睡眠恢复中' : undefined} />
          <View style={styles.statusPill}>
            {showPill && (
              <View style={styles.statusChipRow}>
                {mood && (
                  <View style={[styles.statusChip, { backgroundColor: mood.color }]}>
                    <Text style={styles.statusChipText}>{mood.label}</Text>
                  </View>
                )}
                {phaseKnown && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={styles.phaseChip}>
                      {phaseMoonStyle ? <MoonDot style={phaseMoonStyle} size={theme.fs(14)} /> : null}
                      <Text style={styles.phaseChipText}>{phase}</Text>
                    </View>
                    {isAiText && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.colors.accentSoft, marginRight: theme.space.xs, marginBottom: theme.space.xs }}>
                        <Text style={{ fontSize: 10, color: theme.colors.accentSolid, fontWeight: theme.weight.medium }}>AI</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}
            <Text style={styles.statusNarr}>{narrative}</Text>
          </View>
        </View>

        <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('StatusTrendDetail')}>
          <Card style={styles.trendCard}>
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
        <AllDayRecoveryCard />


        <View style={{ height: theme.space.lg }} />

        <View style={{ flexDirection: 'column', gap: theme.space.md }}>
          <BigStatCard title="情绪消耗" value={stress} unit="次" sub={stress === '—' || stress === '0' ? '暂无压力事件' : '峰值集中在傍晚'} trendUp={true} trendPct="+5.2%" chartEl={<MiniStressDots events={stressReport?.events ?? []} />} gradientColors={['rgba(255,255,255,0)', 'rgba(253,232,240,0.4)', 'rgba(253,232,240,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })} />
          <BigStatCard title="脑力消耗" value={cognitive} unit="/100" sub={cogReport?.peakLoadSpan ? `峰值 ${String(cogReport.peakLoadSpan.startHour).padStart(2,'0')}:00` : '认知状态良好'} trendUp={true} trendPct="+3.1%" chartEl={<MiniCognitiveBars hourly={cogReport?.hourly ?? []} />} gradientColors={['rgba(255,255,255,0)', 'rgba(221,214,254,0.4)', 'rgba(221,214,254,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })} />
          <BigStatCard title="运动消耗" value={activity} unit="步" sub={activity === '—' || activity === '0' ? '今日暂无运动' : '19 kcal 已消耗'} trendUp={true} trendPct="+12%" chartEl={<MiniActivityCurve bins={activityBins} />} gradientColors={['rgba(255,255,255,0)', 'rgba(191,219,254,0.4)', 'rgba(191,219,254,0.7)']} onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })} />
        </View>

        <View style={styles.adviceWrap}>
          <ListCard title="今日建议" items={ADVICE} />
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
  statusPill: { marginTop: theme.space.sm, alignSelf: 'center', width: '100%', backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, paddingVertical: theme.space.xs },
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
    textAlign: 'center',
  },
  trendCard: { marginTop: theme.space.md, marginBottom: theme.space.lg },

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
