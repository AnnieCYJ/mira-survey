/**
 * CycleMoonPhase —— 经期详情页顶部的「月相视图」Hero
 *
 * 只画月相本身，**不带背景**（融入页面原有的浅色渐变）：
 *  1. 中央大月亮：按「周期第几天」映射月相（经期首日=新月，排卵日≈满月），
 *     暗部用半透明浅紫，保证新月时仍能看到完整的月亮轮廓
 *  2. 外围月相环：周期每一天一个「小月牙」，按当天相位着色，满月附近体积更大，
 *     当前日加一圈同色光晕
 *  3. 中心文字：当前相位 + 第几天；下方「记录今天」按钮（打开当日记录 Sheet）
 *
 * ★ 全部为实时绘制：月相角度来自 cycleInfo.dayInCycle、环上每天的相位来自
 *   log.cycleLength / periodLength / lutealLength —— 没有任何图片资源，
 *   经期记录一变（本机记录或戒指回传），整个月相即刻跟着变。
 *
 * 说明：月相与周期相位均为日历/体温推算的**可视化表达**，非硬件实测，不代表医学结论。
 */
import React, { useMemo } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { PHASE_COLOR, PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';
import type { CycleInfo, CycleLog } from '../lib/cycleMath';

const MOON_LIT = '#F2C75C';
const MOON_DARK = 'rgba(150,130,235,0.16)';
const MOON_GLOW = '#F2C75C';
const MOON_PURPLE = theme.colors.accent1; // 月相暗面 / 全紫色（与 phaseColors 黄体紫 #9D8AF0 统一，引用 token）

/**
 * 四种月相样式（对应四个经期象限）。
 *  - full      满月：全黄            → 经期
 *  - quarterR  上弦月：右黄左紫带弧  → 卵泡期
 *  - quarterL  下弦月：左黄右紫带弧  → 排卵期
 *  - allPurple 全紫色：全紫          → 黄体期
 */
export type MoonStyle = 'full' | 'quarterR' | 'quarterL' | 'allPurple';

export function phaseToMoonStyle(phase: PhaseKey): MoonStyle {
  switch (phase) {
    case 'period': return 'full';
    case 'follicular': return 'quarterR';
    case 'ovulation': return 'quarterL';
    case 'luteal': return 'allPurple';
    default: return 'allPurple';
  }
}

/**
 * 单个月相点（自包含 SVG，居中绘制），供首页圆环 / 其他视图复用，保证画法一致。
 *  - full      满月：全黄
 *  - quarterR  上弦月：右黄左紫（带弧）
 *  - quarterL  下弦月：左黄右紫（带弧）
 *  - allPurple 全紫
 */
export function MoonDot({ style, size }: { style: MoonStyle; size: number }) {
  const c = size / 2;
  const r = size * 0.46;
  const rr = r.toFixed(2);
  const x = c.toFixed(2);
  if (style === 'full') {
    return (
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} fill={MOON_LIT} />
      </Svg>
    );
  }
  if (style === 'allPurple') {
    return (
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} fill={MOON_PURPLE} />
      </Svg>
    );
  }
  const right = style === 'quarterR';
  const outerSweep = right ? 1 : 0;
  const innerSweep = right ? 0 : 1;
  const rx = (r * 0.425).toFixed(2);
  const litPath =
    `M ${x} ${(c - r).toFixed(2)} A ${rr} ${rr} 0 0 ${outerSweep} ${x} ${(c + r).toFixed(2)} ` +
    `A ${rx} ${rr} 0 0 ${innerSweep} ${x} ${(c - r).toFixed(2)} Z`;
  return (
    <Svg width={size} height={size}>
      <Circle cx={c} cy={c} r={r} fill={MOON_PURPLE} />
      <Path d={litPath} fill={MOON_LIT} />
    </Svg>
  );
}

/**
 * 生成月相形状的 SVG path。
 *
 * @param t 相位 0..1：0=新月、0.25=上弦、0.5=满月、0.75=下弦、1=回到新月
 *
 * 原理：亮面由两段圆弧围成 ——
 *  - 外弧：亮侧的标准半圆（渐盈时在右，渐亏时在左）
 *  - 内弧：明暗分界线，是一条横向半径 rx = R·|cos(2πt)| 的椭圆弧
 *      rx = R（t=0/0.5）→ 与外弧重合/互补，得到空面/满圆
 *      rx = 0（t=0.25/0.75）→ 退化成直线，得到半圆
 *    内弧的 sweep 方向决定是「月牙」还是「凸月」。
 */
export function moonPath(cx: number, cy: number, R: number, t: number): string {
  const p = ((t % 1) + 1) % 1;
  const waxing = p < 0.5;
  const k = Math.abs(Math.cos(Math.PI * 2 * p));
  const rx = Math.max(0.0001, R * k);
  const outerSweep = waxing ? 1 : 0;
  // 渐盈的前半段(新月→上弦) / 渐亏的后半段(下弦→新月) 是「月牙」，其余是「凸月」
  const crescent = waxing ? p < 0.25 : p > 0.75;
  const innerSweep = crescent ? outerSweep : 1 - outerSweep;
  return `M ${cx.toFixed(2)} ${(cy - R).toFixed(2)} A ${R.toFixed(2)} ${R.toFixed(2)} 0 0 ${outerSweep} ${cx.toFixed(2)} ${(cy + R).toFixed(2)} A ${rx.toFixed(2)} ${R.toFixed(2)} 0 0 ${innerSweep} ${cx.toFixed(2)} ${(cy - R).toFixed(2)} Z`;
}

interface Props {
  cycleInfo: CycleInfo | null;
  log: CycleLog | null;
  /** 点「记录今天」时回调（通常打开当日记录 Sheet）；不传则不显示该按钮 */
  onLogToday?: () => void;
  /**
   * 覆盖默认尺寸（默认 = min(屏宽 × 0.84, 350)）。
   * 放进有内边距的容器（如 Card）时容器可用宽度小于屏宽，需显式传更小的值，否则会溢出。
   */
  size?: number;
  /**
   * 覆盖容器高度（默认 = size，即正方形）。
   * 在紧凑布局（如洞察页卡片）中可传更小值以减少环下方的留白（环仅占上方 ~75%）。
   */
  height?: number;
}

export default function CycleMoonPhase({ cycleInfo, log, onLogToday, size: sizeProp, height: heightProp }: Props) {
  const screenW = Dimensions.get('window').width;
  const size = sizeProp ?? Math.round(Math.min(screenW * 0.84, 350));
  const h = heightProp ?? size;
  const cx = size / 2;
  const cy = size * 0.385;    // 月相环圆心
  const ringR = size * 0.37;  // 环半径
  const moonR = size * 0.118; // 中央月亮
  const MOON_UP = size * 0.082;   // 中央内容(月亮+文字+按钮)整体上移量（大幅上移避免压底部月牙）
  const moonCy = cy - MOON_UP;   // 内容中心：与环心解耦，避免压住底部月牙

  const cycleLen = Math.max(1, Math.round(log?.cycleLength || 28));
  const day = cycleInfo?.dayInCycle ?? null;
  const periodLen = log?.periodLength || 5;
  const lutealLen = log?.lutealLength || 14;
  const ovDay = Math.max(1, cycleLen - lutealLen);

  /** 周期第 d 天属于哪个相位（与 cycleMath 的日历法口径一致） */
  const phaseOfDay = (d: number): PhaseKey => {
    if (d <= periodLen) return 'period';
    if (d >= ovDay - 1 && d <= ovDay + 1) return 'ovulation';
    if (d > ovDay + 1) return 'luteal';
    return 'follicular';
  };

  /** 环上每天一个小月牙：按当天在周期中的位置算出月相形状，按相位着色，当前日放大+光晕 */
  const dots = useMemo(() => {
    const baseR = size * 0.022; // 月牙比圆点略大一点才看得清弧度
    return Array.from({ length: cycleLen }, (_, i) => {
      const d = i + 1;
      const t = d / cycleLen;           // 当天的月相相位 0..1
      const ang = -Math.PI / 2 + ((i / cycleLen) * Math.PI * 2);
      const phase = phaseOfDay(d);
      return {
        d,
        t,
        x: cx + ringR * Math.cos(ang),
        y: cy + ringR * Math.sin(ang),
        r: baseR,
        active: d === day,
        color: PHASE_COLOR[phase],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleLen, day, cx, cy, ringR, size, periodLen, ovDay]);

  /** 环上每个点：小月牙形状（moonPath），颜色=当天相位色，当前日放大+光晕 */
  const renderDot = (d: { d: number; t: number; x: number; y: number; r: number; active: boolean; color: string }) => {
    const r = d.active ? d.r * 1.35 : d.r;
    const op = d.active ? 1 : 0.82;
    return (
      <React.Fragment key={d.d}>
        {d.active ? <Circle cx={d.x} cy={d.y} r={d.r * 2.0} fill={d.color} opacity={0.18} /> : null}
        {/* 暗底（半透明紫）+ 亮面（相位色月牙）= 有立体感的月牙 */}
        <Circle cx={d.x} cy={d.y} r={r} fill={MOON_DARK} opacity={op} />
        <Path d={moonPath(d.x, d.y, r, d.t)} fill={d.color} opacity={op} />
      </React.Fragment>
    );
  };

  const moonT = day ? (day - 1) / cycleLen : 0;
  const phaseKey: PhaseKey = (cycleInfo?.phase ?? 'unknown') as PhaseKey;
  const phaseText = PHASE_LABEL[phaseKey] ?? '未记录';
  const accent = PHASE_COLOR[phaseKey];

  return (
    <View style={[styles.wrap, { width: size, height: h }]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="cmGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={MOON_GLOW} stopOpacity={0.34} />
            <Stop offset="64%" stopColor={MOON_GLOW} stopOpacity={0.07} />
            <Stop offset="100%" stopColor={MOON_GLOW} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <G>
          {dots.map((d) => renderDot(d))}
        </G>

        <Circle cx={cx} cy={moonCy} r={moonR * 2.2} fill="url(#cmGlow)" />
        <Circle cx={cx} cy={moonCy} r={moonR} fill={MOON_DARK} />
        <Path d={moonPath(cx, moonCy, moonR, moonT)} fill={MOON_LIT} />
      </Svg>

      {/* 中央内容列：文字 + 按钮，整体在月亮正下方、环内中心区 */}
      <View style={[StyleSheet.absoluteFill]} pointerEvents="box-none">
        <View
          style={[styles.contentCol, { top: moonCy + moonR + size * 0.015 }]}
          pointerEvents="box-none"
        >
          <Text style={styles.phaseLine}>
            {day != null ? `${phaseText} 第 ${day} 天` : phaseText}
          </Text>
          <Text style={styles.subLine}>
            {cycleInfo?.daysToNextPeriod != null
              ? `距下次经期约 ${cycleInfo.daysToNextPeriod} 天`
              : `周期 ${cycleLen} 天`}
          </Text>
          {onLogToday ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onLogToday}
              style={[styles.logBtnCompact, { borderColor: accent }]}
            >
              <Text style={[styles.logBtnTextCompact, { color: accent }]}>＋ 记录</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  contentCol: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  phaseLine: {
    color: theme.colors.textTitle,
    fontSize: theme.fs(18),
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.4,
  },
  subLine: {
    marginTop: theme.sp(3),
    color: theme.colors.textSub,
    fontSize: theme.fs(12),
  },
  logBtnCompact: {
    marginTop: theme.sp(4),
    paddingHorizontal: theme.sp(6),
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1.2,
    backgroundColor: '#fff',
  },
  logBtnTextCompact: {
    fontSize: theme.fs(9.5),
    fontWeight: theme.weight.medium,
  },
});
