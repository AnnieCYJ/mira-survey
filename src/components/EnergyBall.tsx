import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop, Path, Ellipse, ClipPath, LinearGradient, G } from 'react-native-svg';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { theme } from '../theme/theme';
import { DEFAULT_MOOD, MOODS, type MoodIndex } from '../data/metrics';
import { type CurveStatus } from '../lib/dailyStatus';
import { MoonDot, type MoonStyle } from './CycleMoonPhase';
import { PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';


interface Props {
  /** 当前「今日状态」曲线结果；传入后圆环按计算出的状态等级 + 今日状态值展示，否则回退为默认心情 */
  status?: CurveStatus | null;
  /** 覆盖圆环中央文字（如睡眠场景显示「睡眠恢复中」） */
  centerLabelOverride?: string;
}

// 计算等级（充沛/平稳/偏低/不足）→ 圆环四色点序号
const LEVEL_MOOD_IDX: Record<string, MoodIndex> = {
  充沛: 0,
  平稳: 1,
  偏低: 2,
  不足: 3,
};

// 首页圆环上的四个月相点：对应四个经期象限
// 排列顺序按「月相规律」：满月↔全紫在对立位置（180°），上弦/下弦在两侧
const HOME_PHASES: { key: PhaseKey; style: MoonStyle; label: string }[] = [
  { key: 'period', style: 'full', label: PHASE_LABEL.period },       // -90° 顶部 → 满月
  { key: 'follicular', style: 'quarterR', label: PHASE_LABEL.follicular }, // 0°  右侧 → 黄底紫月牙
  { key: 'luteal', style: 'allPurple', label: PHASE_LABEL.luteal },        // 90° 底部 → 全紫（与满月对立）
  { key: 'ovulation', style: 'quarterL', label: PHASE_LABEL.ovulation },   // 180° 左侧 → 紫底黄月牙
];
// 当前经期象限标签 → PhaseKey
const LABEL_TO_PHASE: Record<string, PhaseKey> = {
  经期: 'period',
  卵泡期: 'follicular',
  排卵期: 'ovulation',
  黄体期: 'luteal',
};

/* ─────────────────────────────────────────────────────────────
 * ★ 2026-10-16：圆环内部「能量水波」（首页圆环里面水流动）
 * · 保留：外圈光晕 / 状态色环描边 / 四月相点公转 / 中央文字
 * · ★ 2026-10-16（用户：「圆环中间的文字背景的颜色也去掉」）：中央弥散彩色柔光层**整体移除**——
 *   文字直接坐在水波之上（水色为状态色高比混合浅色，深色文字 + 白色柔影即可读）；
 *   该层此前的「呼吸」已在同日早些时候改为静态，现连颜色一并去掉。
 * · 新增：环内浅水底色 + 双层正弦波无缝横移 + 水面呼吸升降 + 气泡上浮 + 玻璃体积
 * · 水色由状态色（ringColor）派生，四等级自动同色
 * · ★ 回退开关：把 WATER_RING_ENABLED 改 false 即恢复纯光晕圆环（其余代码不动）
 *   （亦可 git checkout eefe0c8 -- src/components/EnergyBall.tsx 回到改造前）
 * ───────────────────────────────────────────────────────────── */
const WATER_RING_ENABLED = true;

const AnimatedG = Animated.createAnimatedComponent(G);

/** hex 混色：t=0 → a，t=1 → b（用于从状态色派生水色） */
function mixHex(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 无缝正弦波路径：宽 = 2×画布宽，横向位移一个波长即循环（零跳变）。
 * open=true 只取水面线（画白色高光描边用）。
 */
function wavePathD(amp: number, wl: number, phase: number, base: number, width: number, bottom: number, open: boolean): string {
  let d = `M0 ${base.toFixed(2)}`;
  for (let x = 0; x <= width; x += 3) {
    const y = base + amp * Math.sin((x / wl) * Math.PI * 2 + phase);
    d += ` L${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  if (!open) d += ` L${width.toFixed(1)} ${bottom.toFixed(1)} L0 ${bottom.toFixed(1)} Z`;
  return d;
}

export default function EnergyBall({ status, centerLabelOverride }: Props) {
  const { width: winW } = useWindowDimensions();
  const avail = Math.min(winW, theme.layout.maxWidth) - theme.space.screen * 2;
  // ★ 2026-09-29：圆环略收（0.74→0.70 / 1.32→1.28）——此前面板被圆环撑太高，
  //   下方趋势图压到底部 tab 栏。收 ~7% 换图表上移 ~28pt，视觉几乎无感。
  // ★ 2026-10-15：首页移除趋势图后圆环下方空出空间，用户要求「圆环稍大一点」→ 0.70 → 0.78。
  // ★ 2026-10-15（V4）：底部气泡改「暮色深玻璃 + 标题行 + 2 建议」后实高 ~224，圆环回收 0.78 → 0.74
  //   换 ~16pt 给气泡（一屏不滑动铁律），环本体视觉几乎无感。
  const size = avail * 0.74;
  const svgSize = size * 1.28;
  const c = svgSize / 2;
  const ringR = (size / 2) * 0.843;
  /**
   * ★ 2026-10-05：**画布底部空带不参与排版**。
   *   svgSize(1.28×size) 比可见圆环(直径 0.843×size)大一圈 —— 环下沿到画布底还留着
   *   svgSize/2 − ringR ≈ 52pt 的空高（size=239 时），那里只有最外圈光晕（透明度 0.22→0）。
   *   这段空高对排版却是实打实的：它把下方「状态分析」胶囊和全天状态趋势图整体往下压，
   *   首页一屏装不下 → 趋势图下的 4 等级图例被顶出可视区（用户实测「图例没露出来」）。
   *   用等量负 margin 收回：**环的尺寸与位置一个像素都不动**，只让下方内容上移。
   *   取 0.07×svgSize = aura 最后一个可见 stop(86% 画布半径) 到画布边缘的那一段
   *   （0.22 → 0 的收尾，本来就看不见），所以收起后不存在任何可见重叠。
   *   只改外框，不改内部：中央文字/光晕都按 svgSize 居中，与这个外框无关。
   */
  const bottomBlank = svgSize * 0.07;
  // 四个经期象限的月相点将均匀分布在白色环上（半径同环）

  // 有计算状态时，圆环跟随计算结果（等级 + 今日状态值）；否则回退为默认心情
  const hi: MoodIndex =
    status?.level != null && LEVEL_MOOD_IDX[status.level] != null
      ? LEVEL_MOOD_IDX[status.level]
      : DEFAULT_MOOD;
  const mood = MOODS[hi];
  // 空状态（无数据）：圆环统一紫色，中间显示「暂无数据」
  const EMPTY_COLOR = theme.colors.stateEnergy;
  const moodColor = MOODS[hi].color;
  const hasData = !!(status?.hasData && status.value != null);
  const ringColor = hasData ? moodColor : EMPTY_COLOR;
  const centerLabel = !hasData ? '暂无数据' : (centerLabelOverride ?? mood.label);
  const statusValue = hasData ? Math.round(status.value as number) : null;

  // ★ v18.118/119：数据更新时刻（HH:MM，整点/半点）。
  //   数据源用 `lastPointAt`（今日最后一个状态点的时刻）—— 全天状态按 30 分钟窗口累积，
  //   `pushStatusPoint` 写入前必过 `alignBoundaryTs()` 对齐到 :00/:30，所以天然是整点/半点。
  //   显示 `lastSampleAt`（如 16:05）会与曲线上的点对不上。
  //   ★ v18.121：断开期间**照常显示**（旧口径下 dataStale 会把它藏起来）。
  //     用户口径：「3 点断开 → 看到 3 点的值；4 点看还是 3 点的值；连上戒指数据才更新」。
  //     而「更新于」正是这句话的载体 —— 3 点断开后一直显示「更新于 15:00」，
  //     用户自己就能看出数据停在 3 点，**不需要额外的「停止更新」提示文案**。
  const updatedClock = (() => {
    const ts = status?.lastPointAt ?? null;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  })();

  // 当前所处经期象限（来自今日状态预测）；无数据时为 null（仅用于环上高亮）
  const currentPhase: PhaseKey | null =
    status?.phaseLabel != null ? LABEL_TO_PHASE[status.phaseLabel] ?? null : null;

  const reducedMotion = useReducedMotion();
  // 轨道公转：整层绕中心缓慢旋转，让四个状态点像行星环绕
  const orbit = useRef(new Animated.Value(0)).current;
  const orbitRotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── 能量水波动效（2026-10-16）：全部 native driver，UI 线程运行 ──
  // 几何按 ringR 比例缩放（与预览稿 breathing-wave-energy.html 同一套参数）
  const drift1 = useRef(new Animated.Value(0)).current;   // 前层波横移 0 → -wl1
  const drift2 = useRef(new Animated.Value(0)).current;   // 后层波横移 0 → -wl2
  const bob = useRef(new Animated.Value(0)).current;      // 水面呼吸 0(低) → 1(高)
  const rise1 = useRef(new Animated.Value(0)).current;    // 气泡 1..4 上浮进度
  const rise2 = useRef(new Animated.Value(0)).current;
  const rise3 = useRef(new Animated.Value(0)).current;
  const rise4 = useRef(new Animated.Value(0)).current;

  const water = useMemo(() => {
    const s = ringR; // 以环半径为比例尺
    const surf1 = c + s * 0.28;   // 前层波水面（环中心下方 28% 环半径）
    const surf2 = c + s * 0.375;  // 后层波水面（更低更缓）
    const bottom = c + s * 1.25;  // 路径收底（裁剪圈外即可）
    const pathW = svgSize * 2;    // 2×画布宽，位移一个波长无缝循环
    return {
      wl1: s * 1.52,
      wl2: s * 1.92,
      bobAmp: s * 0.056,
      riseH: s * 0.49,
      d1: wavePathD(s * 0.056, s * 1.52, 0, surf1, pathW, bottom, false),
      d1c: wavePathD(s * 0.056, s * 1.52, 0, surf1, pathW, bottom, true),
      d2: wavePathD(s * 0.075, s * 1.92, 2.4, surf2, pathW, bottom, false),
      bubs: [
        { x: c - s * 0.54, y: c + s * 0.72, r: s * 0.024, dur: 3800, delay: 0 },
        { x: c, y: c + s * 0.72, r: s * 0.03, dur: 5000, delay: 1200 },
        { x: c + s * 0.51, y: c + s * 0.7, r: s * 0.019, dur: 4400, delay: 2400 },
        { x: c + s * 0.71, y: c + s * 0.73, r: s * 0.026, dur: 6000, delay: 600 },
      ],
      gloss: { cx: c, cy: c - s * 0.98, rx: s * 1.2, ry: s * 0.58 },
      shade: { cx: c, cy: c + s * 1.3, rx: s * 1.41, ry: s * 0.62 },
      colors: {
        bowlTop: mixHex(ringColor, '#FFFFFF', 0.92),
        bowlMid: mixHex(ringColor, '#FFFFFF', 0.85),
        bowlBot: mixHex(ringColor, '#FFFFFF', 0.78),
        wTop: mixHex(ringColor, '#FFFFFF', 0.45),
        wMid: mixHex(ringColor, '#FFFFFF', 0.15),
        wBot: mixHex(ringColor, '#000000', 0.1),
        w2Top: mixHex(ringColor, '#FFFFFF', 0.62),
        w2Bot: mixHex(ringColor, '#FFFFFF', 0.38),
      },
    };
  }, [c, ringR, svgSize, ringColor]);

  const riseVals = [rise1, rise2, rise3, rise4];
  const riseYs = riseVals.map((v) =>
    v.interpolate({ inputRange: [0, 1], outputRange: [water.bobAmp, water.bobAmp - water.riseH] })
  );
  const riseOps = riseVals.map((v) =>
    v.interpolate({ inputRange: [0, 0.14, 0.8, 1], outputRange: [0, 0.9, 0.45, 0] })
  );

  useEffect(() => {
    // ★ 2026-10-16（用户：「圆环中间的文字背景的颜色也去掉」）：中央弥散彩色柔光层已整体移除，
    //   不再有 halo 状态需要初始化；月相点公转与水波动画不受影响。

    if (reducedMotion) {
      orbit.setValue(0);
      // 水波静态降级：水面停在低位、气泡隐藏（不做循环）
      drift1.setValue(0);
      drift2.setValue(0);
      bob.setValue(0);
      rise1.setValue(0);
      rise2.setValue(0);
      rise3.setValue(0);
      rise4.setValue(0);
      return;
    }
    const ease = Easing.inOut(Easing.ease);

    // 行星环绕：整体匀速公转（约 32 秒一圈，缓慢移动）
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 32000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    orbitLoop.start();

    // ── 能量水波（2026-10-16）：双波层无缝横移 + 水面呼吸升降 + 气泡错峰上浮 ──
    const drift1Loop = Animated.loop(
      Animated.timing(drift1, {
        toValue: -water.wl1, // 位移恰为一个波长 → 循环零跳变
        duration: 6400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const drift2Loop = Animated.loop(
      Animated.timing(drift2, {
        toValue: -water.wl2,
        duration: 9800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 4000, easing: ease, useNativeDriver: true }), // 吸气涨
        Animated.timing(bob, { toValue: 0, duration: 4000, easing: ease, useNativeDriver: true }), // 呼气落
      ])
    );
    const bubLoops = riseVals.map((v, i) =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: water.bubs[i].dur,
          delay: water.bubs[i].delay,
          easing: Easing.in(Easing.sin),
          useNativeDriver: true,
        })
      )
    );
    if (WATER_RING_ENABLED) {
      drift1Loop.start();
      drift2Loop.start();
      bobLoop.start();
      bubLoops.forEach((l) => l.start());
    }

    return () => {
      orbitLoop.stop();
      drift1Loop.stop();
      drift2Loop.stop();
      bobLoop.stop();
      bubLoops.forEach((l) => l.stop());
    };
    // 注意：water / riseVals 不进 deps —— water 仅随 ringR/ringColor 变（波长只依赖 ringR，稳定），
    // riseVals 每渲染都是新数组（放进去会害得循环被反复重启）。与原 effect 口径保持一致。
  }, [orbit, reducedMotion]);

  // 四个经期象限月相点：均匀分布在环上，当前所处相位稍大 + 光晕
  // 大小与原来 4 个心情色点一致（约 sp(3.5)），不大不小刚好
  const dotSize = Math.max(theme.sp(5), ringR * 0.115);
  const phaseDots = useMemo(
    () =>
      HOME_PHASES.map((p, i) => {
        const ang = (-90 + i * 90) * (Math.PI / 180);
        return {
          ...p,
          x: c + ringR * Math.cos(ang),
          y: c + ringR * Math.sin(ang),
          isCurrent: p.key === currentPhase,
        };
      }),
    [c, ringR, currentPhase, dotSize]
  );

  return (
    <View style={{ width: svgSize, height: svgSize, alignSelf: 'center', marginBottom: -bottomBlank }}>
      <Svg width={svgSize} height={svgSize}>
        <Defs>
          {/* 外圈光晕：跟随情绪色，向环外大幅扩散 */}
          <RadialGradient key={`aura-${ringColor}`} id="aura" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={ringColor} stopOpacity="0" />
            <Stop offset="46%" stopColor={ringColor} stopOpacity="0" />
            <Stop offset="60%" stopColor={ringColor} stopOpacity="0.14" />
            <Stop offset="74%" stopColor={ringColor} stopOpacity="0.40" />
            <Stop offset="86%" stopColor={ringColor} stopOpacity="0.22" />
            <Stop offset="100%" stopColor={ringColor} stopOpacity="0" />
          </RadialGradient>
          {/* ── 能量水波渐变（2026-10-16）：颜色由状态色派生，随等级自动切换 ── */}
          {WATER_RING_ENABLED ? (
            <>
              <ClipPath key="waterClip" id="waterClip">
                <Circle cx={c} cy={c} r={ringR} />
              </ClipPath>
              <RadialGradient key={`bowl-${ringColor}`} id="bowlGrad" cx="38%" cy="26%" r="85%">
                <Stop offset="0%" stopColor={water.colors.bowlTop} />
                <Stop offset="58%" stopColor={water.colors.bowlMid} />
                <Stop offset="100%" stopColor={water.colors.bowlBot} />
              </RadialGradient>
              <LinearGradient key={`wg-${ringColor}`} id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={water.colors.wTop} />
                <Stop offset="60%" stopColor={water.colors.wMid} />
                <Stop offset="100%" stopColor={water.colors.wBot} />
              </LinearGradient>
              <LinearGradient key={`wg2-${ringColor}`} id="waterGrad2" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={water.colors.w2Top} />
                <Stop offset="100%" stopColor={water.colors.w2Bot} />
              </LinearGradient>
              <RadialGradient id="waterGloss" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
                <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </RadialGradient>
              <RadialGradient id="waterShade" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#000000" stopOpacity="0.1" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </RadialGradient>
            </>
          ) : null}
        </Defs>

        <Circle cx={c} cy={c} r={svgSize / 2} fill="url(#aura)" />
        {/* 四个状态点所在的环：跟随情绪色切换；无数据时统一紫色 */}
        <Circle cx={c} cy={c} r={ringR} stroke={ringColor} strokeWidth={2.8} fill="none" opacity={0.92} />

        {/* ── 能量水波（2026-10-16）：环内水体，裁剪进圆环；月相点/文字层不变 ── */}
        {WATER_RING_ENABLED ? (
          <G clipPath="url(#waterClip)">
            {/* 浅水底色（整环有水体质感） */}
            <Circle cx={c} cy={c} r={ringR} fill="url(#bowlGrad)" />
            {/* 后层波：更低更缓，拉出水的深度 */}
            <AnimatedG transform={[{ translateX: drift2 }, { translateY: bob }]}>
              <Path d={water.d2} fill="url(#waterGrad2)" opacity={0.78} />
            </AnimatedG>
            {/* 前层波 + 水面白色高光 */}
            <AnimatedG transform={[{ translateX: drift1 }, { translateY: bob }]}>
              <Path d={water.d1} fill="url(#waterGrad)" />
              <Path d={water.d1c} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.6} />
            </AnimatedG>
            {/* 气泡：错峰上浮渐隐 */}
            {water.bubs.map((b, i) => (
              <AnimatedG key={`bub-${i}`} transform={[{ translateY: riseYs[i] }]} opacity={riseOps[i]}>
                <Circle cx={b.x} cy={b.y} r={b.r} fill="#FFFFFF" />
              </AnimatedG>
            ))}
            {/* 玻璃高光 + 底部体积阴影 */}
            <Ellipse cx={water.gloss.cx} cy={water.gloss.cy} rx={water.gloss.rx} ry={water.gloss.ry} fill="url(#waterGloss)" />
            <Ellipse cx={water.shade.cx} cy={water.shade.cy} rx={water.shade.rx} ry={water.shade.ry} fill="url(#waterShade)" />
          </G>
        ) : null}
      </Svg>

      {/* ★ 2026-10-16（用户：「圆环中间的文字背景的颜色也去掉」）：原「中央弥散彩色柔光」独立图层
          （moodGlow RadialGradient + halo 呼吸/静态缩放）已整体移除 —— 它是圆环中间文字背后的
          彩色底色。移除后中央文字直接坐在水波上；如日后想恢复，从 git 历史取回该 Animated.View
          与 halo/glowScale/glowOpacity 三段即可（水波层之上、轨道层之下的原位置）。 */}

      {/* 轨道层：四个状态点像行星一样绕中心缓慢公转（中心文字不转） */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { pointerEvents: 'box-none', transform: [{ rotate: orbitRotate }] },
        ]}
      >
        {phaseDots.map((d) => {
          const scale = d.isCurrent ? 1.34 : 1.0;
          return (
            <View
              key={`moon-${d.key}`}
              style={[
                styles.moonDotWrap,
                {
                  left: d.x - dotSize / 2,
                  top: d.y - dotSize / 2,
                  width: dotSize,
                  height: dotSize,
                  transform: [{ scale }],
                  zIndex: d.isCurrent ? 3 : 2,
                  shadowColor: d.isCurrent ? theme.colors.warn : 'transparent',
                  shadowOpacity: d.isCurrent ? 0.85 : 0,
                  shadowRadius: d.isCurrent ? 14 : 0,
                },
              ]}
            >
              <MoonDot style={d.style} size={dotSize} />
            </View>
          );
        })}
      </Animated.View>

      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.label, !hasData && styles.emptyLabel]}>{centerLabel}</Text>
        {statusValue != null && <Text style={styles.statusValue}>状态值：{statusValue}</Text>}
        {/* ★ v18.118：状态值下方显示「数据更新于 HH:MM」。
            口径：只写**更新时刻**，不写「已 N 小时没有新数据」——
            v18.107 用户明确说过后者「没用」（且和真实采样时刻口径打架）。
            数据源 = curveStatus.lastSampleAt（指标级 lastUpdated 的最大值 = 最近一次真实采样时刻）。
            无数据（断流/从没戴过）时不显示 —— 避免出现一个孤零零的时间戳。 */}
        {updatedClock ? (
          <Text style={styles.updatedAt}>更新于 {updatedClock}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  moonDotWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: theme.fs(28),
    color: theme.colors.orbTextInk,
    fontWeight: theme.weight.semibold,
    textShadowColor: theme.colors.ui.white55,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  emptyLabel: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    fontWeight: theme.weight.medium,
    textShadowColor: 'transparent',
    textShadowRadius: 0,
  },
  statusValue: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.orbTextInkSub,
    marginTop: 8, // ★ 十六改：2 → 8（用户「状态良好和底下的状态值、更新于几点，位置稍微拉开一点点距离」）
    fontWeight: theme.weight.medium,
  },
  // ★ v18.118：状态值下方的「数据更新于 HH:MM」——比状态值更弱一级（信息层级：值 > 时效）
  updatedAt: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.orbTextInkFaint,
    marginTop: 2, // ★ 十六改：1 → 2（与状态值同排呼吸，间距主要由上一行拉开）
    fontWeight: theme.weight.regular,
  },
  // ★ 2026-10-15 晚：环中央经期相位块（放大的月相 + 相位名）
});
