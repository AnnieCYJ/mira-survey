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
import { addDays, daysBetween } from '../lib/cycleMath';

const MOON_LIT = '#F2C75C';
const MOON_DARK = 'rgba(150,130,235,0.16)';
const MOON_GLOW = '#F2C75C';
const MOON_PURPLE = theme.colors.accent1; // 月相暗面 / 全紫色（与 phaseColors 黄体紫 #9D8AF0 统一，引用 token）

/**
 * 四种月相样式（对应四个经期象限）。
 *  - full      满月：全黄            → 经期
 *  - quarterR  凸月：黄底 + 紫色细月牙(右) → 卵泡期
 *  - quarterL  凸月：紫底 + 黄色细月牙(左) → 排卵期
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
 *  - quarterR  凸月：黄底 + 紫色细月牙（右）
 *  - quarterL  凸月：紫底 + 黄色细月牙（左）
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
  // ★ 2026-10-06（用户最终口径）：两个紫黄点改画**清晰的月牙（凸月）**——
  //   quarterR = 黄底 + 紫色月牙（右侧），即「黄色面积大、紫色是月牙」；
  //   quarterL = 紫底 + 黄色月牙（左侧），即「紫色面积大、黄色是月牙」。
  //   复用 moonPath：t 取 0.19(右月牙)/0.81(左月牙)——比之前的 0.12/0.88 更宽，
  //   月牙面积更大、圆环上四个点看得更清（用户反馈 0.12 太细看不清）。
  const right = style === 'quarterR';
  const bg = right ? MOON_LIT : MOON_PURPLE;   // 底色（大面积）
  const fg = right ? MOON_PURPLE : MOON_LIT;   // 月牙色（小面积）
  const t = right ? 0.19 : 0.81;
  return (
    <Svg width={size} height={size}>
      <Circle cx={c} cy={c} r={r} fill={bg} />
      <Path d={moonPath(c, c, r, t)} fill={fg} />
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
   * 覆盖容器高度（默认 = 0.84 × size —— 刚好包住底部月牙，环下方不再留大片空白）。
   * 需要更大留白时可显式传值。
   */
  height?: number;
  /** ★ 2026-10-07（用户：点「上一个周期」也该显示圆环）：覆盖「当前日」高亮；不传则用 cycleInfo.dayInCycle */
  activeDay?: number | null;
  /** ★ 覆盖中央主标题（如历史周期显示日期区间）；不传则用「相位 第 N 天」 */
  headLabel?: string;
  /** ★ 覆盖中央副标题（如历史周期显示「共 N 天」）；不传则用距下次经期 */
  subLabel?: string;
  /**
   * ★ 本轮（用户 #323）：真实经期区间（derivePeriodRuns 产出）。传入后，已记录的日期用真实区间覆盖，
   * 经期结束后环上对应的点不再画成「经期」（满黄），而是按真实相位着色。
   * 不传时退回日历口径（兼容洞察页小环等无 periodDays 的调用方）。
   */
  periodRuns?: { start: string; end: string; source: 'flow' | 'explicit' }[];
  /** ★ 2026-10-12（用户：洞察页环缩到 220 后，环内文字显大）：compact 模式缩小中央文字，
   *  供 InsightScreen·CyclePhaseCard（小环）使用；周期日历页（大环 350）不传，保持原大小。 */
  compact?: boolean;
}

export default function CycleMoonPhase({
  cycleInfo,
  log,
  onLogToday,
  size: sizeProp,
  height: heightProp,
  activeDay,
  headLabel,
  subLabel,
  periodRuns,
  compact,
}: Props) {
  const screenW = Dimensions.get('window').width;
  const size = sizeProp ?? Math.round(Math.min(screenW * 0.84, 350));
  const h = heightProp ?? Math.round(size * 0.84);
  const cx = size / 2;
  // ★ 2026-10-07（用户：环最上面两个点看着像被遮掉了一小部分 → 整个圆环稍微往下一点，别压到上面的点）：
  //   原来 环心 0.385 / 半径 0.37，最上面那个点的外缘会顶到画布 y<0，被裁掉约 2px。
  //   现在整环下移 TOP_PAD、半径略收 1.5%：顶部净空 = 0.08·size（size 328 时约 26px，
  //   月牙本体外缘约 19px、当前日光晕也在画布内），底部月牙外缘 ≈ 0.79·size，
  //   与默认高度 0.84·size 匹配（方形画布下方那 ~70px 空白也随之收掉）。
  const TOP_PAD = size * 0.05;       // 顶部净空（想让环再往下就加大这个值）
  const cy = size * 0.385 + TOP_PAD; // 月相环圆心
  const ringR = size * 0.355;        // 环半径
  const moonR = size * 0.118; // 中央月亮
  const MOON_UP = size * 0.082;   // 中央内容(月亮+文字+按钮)整体上移量（大幅上移避免压底部月牙）
  const moonCy = cy - MOON_UP;   // 内容中心：与环心解耦，避免压住底部月牙

  const cycleLen = Math.max(1, Math.round(log?.cycleLength || 28));
  // ★ 历史周期：调用方显式传 activeDay（该周期末日），不依赖 cycleInfo
  const day = activeDay !== undefined ? activeDay : cycleInfo?.dayInCycle ?? null;
  const periodLen = log?.periodLength || 5;
  const lutealLen = log?.lutealLength || 14;
  const ovDay = Math.max(1, cycleLen - lutealLen);

  /** 周期第 d 天属于哪个相位（与 cycleMath 的日历法口径一致） */
  const dayInCycle = cycleInfo?.dayInCycle ?? null;
  const periodStart = log?.lastPeriodStart ?? null;
  const inRun = (d: number): boolean => {
    if (!periodRuns || !periodStart) return false;
    const dt = addDays(periodStart, d - 1);
    return periodRuns.some((r) => daysBetween(r.start, dt) >= 0 && daysBetween(dt, r.end) >= 0);
  };
  const phaseOfDay = (d: number): PhaseKey => {
    // ★ 本轮（用户 #323）：已记录的日期用真实经期区间覆盖，经期结束后不再显示「经期」
    if (periodRuns && periodStart && dayInCycle != null && d <= dayInCycle) {
      if (inRun(d)) return 'period';
      if (Math.abs(d - ovDay) <= 2) return 'ovulation';
      if (d > ovDay) return 'luteal';
      return 'follicular';
    }
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
          <Text style={[styles.phaseLine, compact && styles.phaseLineCompact]}>
            {headLabel ?? (day != null ? `${phaseText} 第 ${day} 天` : phaseText)}
          </Text>
          <Text style={[styles.subLine, compact && styles.subLineCompact]}>
            {subLabel ??
              (cycleInfo?.daysToNextPeriod != null
                ? `距下次经期约 ${cycleInfo.daysToNextPeriod} 天`
                : `周期 ${cycleLen} 天`)}
          </Text>
          {onLogToday ? (
            <TouchableOpacity
              activeOpacity={0.7}
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
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.4,
  },
  subLine: {
    marginTop: theme.sp(3),
    color: theme.colors.textSub,
    fontSize: theme.fontSize.xs,
  },
  /* ★ 2026-10-12：compact（小环）模式——中央文字整体降一档，避免 220 环里显得拥挤 */
  phaseLineCompact: { fontSize: theme.fontSize.sm, letterSpacing: 0.2 },
  subLineCompact: { fontSize: theme.fontSize.micro, marginTop: theme.sp(2) },
  logBtnCompact: {
    marginTop: theme.sp(4),
    paddingHorizontal: theme.sp(6),
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1.2,
    backgroundColor: '#fff',
  },
  logBtnTextCompact: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
  },
});
