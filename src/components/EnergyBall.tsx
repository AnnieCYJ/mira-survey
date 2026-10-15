import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { theme } from '../theme/theme';
import { DEFAULT_MOOD, MOODS, type MoodIndex } from '../data/metrics';
import { type CurveStatus } from '../lib/dailyStatus';
import { MoonDot, type MoonStyle } from './CycleMoonPhase';
import { PHASE_COLOR, PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';


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

  // 当前所处经期象限（来自今日状态预测）；无数据时为 null（仅用于环上高亮，中央相位文字已移除）
  const currentPhase: PhaseKey | null =
    status?.phaseLabel != null ? LABEL_TO_PHASE[status.phaseLabel] ?? null : null;
  // 当前经期相位对应的月相样式（用于环中央放大展示，与环上四相位月相点同源）
  const phaseMoonStyle: MoonStyle =
    currentPhase != null
      ? (HOME_PHASES.find((p) => p.key === currentPhase)?.style ?? 'full')
      : 'full';

  // 呼吸光晕：只作用于中间弥散的彩色，不缩放文字
  const halo = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  // 轨道公转：整层绕中心缓慢旋转，让四个状态点像行星环绕
  const orbit = useRef(new Animated.Value(0)).current;
  const orbitRotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
    if (reducedMotion) { halo.setValue(0.45); orbit.setValue(0); return; }
    const ease = Easing.inOut(Easing.ease);

    // ★ 呼吸光晕走**原生驱动**：把「改圆的半径」改成「缩放一个固定半径的圆」——
    //   半径驱动的是 SVG 属性（只能 JS 线程），而 scale/opacity 是 View 样式（可原生驱动）。
    //   原来是 useNativeDriver:false 的常驻循环，首页挂着就一直占 JS 线程，与滚动争资源。
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, {
          toValue: 1,
          duration: theme.motion.breath.halo / 2,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.timing(halo, {
          toValue: 0,
          duration: theme.motion.breath.halo / 2,
          easing: ease,
          useNativeDriver: true,
        }),
      ])
    );
    haloLoop.start();

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

    return () => {
      haloLoop.stop();
      orbitLoop.stop();
    };
  }, [halo, orbit, reducedMotion]);

  // 中间彩色光晕：半径与透明度一起呼吸，范围明显更大、更弥散。
  // ★ 圆固定画在最大半径，用 scale 表达「呼吸」——映射与原实现等值：[ringR*0.45, ringR*1.6] → [0.28, 1]。
  //   渐变是相对圆的包围盒定义的（r="50%"），所以缩放后视觉等价。
  const GLOW_MAX_R = ringR * 1.6;
  const glowScale = halo.interpolate({
    inputRange: [0, 1],
    outputRange: [(ringR * 0.45) / GLOW_MAX_R, 1],
  });
  const glowOpacity = halo.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0.96],
  });

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
        </Defs>

        <Circle cx={c} cy={c} r={svgSize / 2} fill="url(#aura)" />
        {/* 四个状态点所在的环：跟随情绪色切换；无数据时统一紫色 */}
        <Circle cx={c} cy={c} r={ringR} stroke={ringColor} strokeWidth={2.8} fill="none" opacity={0.92} />
      </Svg>

      {/* 中央弥散彩色呼吸光晕：独立图层，整层 scale/opacity → 可走原生驱动。
          固定画在最大半径，靠 scale 呼吸；渐变 r="50%" 相对包围盒，缩放后视觉等价。
          key 强制按颜色重挂，避免渐变缓存。 */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      >
        <Svg width={svgSize} height={svgSize}>
          <Defs>
            <RadialGradient key={ringColor} id="moodGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={ringColor} stopOpacity="0.86" />
              <Stop offset="38%" stopColor={ringColor} stopOpacity="0.54" />
              <Stop offset="70%" stopColor={ringColor} stopOpacity="0.16" />
              <Stop offset="100%" stopColor={ringColor} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={c} cy={c} r={GLOW_MAX_R} fill="url(#moodGlow)" />
        </Svg>
      </Animated.View>

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
        {/* ★ 2026-10-15 晚：环中央放大显示当前经期相位月相 + 相位名（如「卵泡期」），与环上四相位月相点同源 */}
        {currentPhase && (
          <View style={styles.phaseInCenter}>
            <MoonDot style={phaseMoonStyle} size={theme.sp(13)} />
            <Text style={[styles.phaseCenterLabel, { color: PHASE_COLOR[currentPhase] }]}>{PHASE_LABEL[currentPhase]}</Text>
          </View>
        )}
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
    textShadowColor: 'rgba(255,255,255,0.55)',
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
  phaseInCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.sp(1.25),
    marginBottom: theme.sp(0.5),
  },
  phaseCenterLabel: {
    fontSize: theme.fs(15),
    fontWeight: theme.weight.semibold,
  },
});
