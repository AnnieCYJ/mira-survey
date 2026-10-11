import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Path, G } from 'react-native-svg';
import { mm } from '../theme/mindmate';

interface Props {
  /** 进度 0–100（超出自动夹紧） */
  pct: number;
  /** 进度弧颜色（品牌色，如 honeyCore / 相位 ringColor） */
  color: string;
  /** 轨道色，默认 emptyFill */
  trackColor?: string;
  /** 端点圆点颜色，默认同 color */
  markerColor?: string;
  /** 弧中央内容（数字 / 档位名等），绝对居中于弧内 */
  children?: React.ReactNode;
}

/**
 * ★ 2026-10-11（用户：「工具页营养搭配 / 运动建议最上面的环，不要做成环，
 *   做成身体年龄那种弧形」）：把原来的整圈圆环改成「宽扁大弧」——
 *   几何完全复刻 HealthAgeCard 的弧（端点 (EDGE,END_Y)→(W-EDGE,END_Y)，
 *   圆心落在画布下方，弧向上微拱），只是这里用纯色填充 + 端点圆点，
 *   不挂三档渐变（营养/运动的品牌色是单 hex）。
 *
 * 只改弧形，不改任何文字内容：children 透传原环中央的数字/档位名。
 */
const VB_H = 128;   // SVG 画布高度
const STROKE = 20;  // 弧线宽
const END_Y = 78;   // 弧两端所在水平线
const EDGE = 5;     // 两端内缩
// 中央内容垂直居中到弦线（END_Y）所需的下压量
const CONTENT_PAD_TOP = END_Y - VB_H / 2;

export function ArcGauge({ pct, color, trackColor, markerColor, children }: Props) {
  const [W, setW] = React.useState(0);
  const halfChord = W > 0 ? (W - EDGE * 2) / 2 : 0;
  // R 下限：保证弧顶 (cy-R) 不低于 STROKE/2（不被画布裁掉）
  const RMin = halfChord > 0
    ? (halfChord * halfChord + (END_Y - STROKE / 2) * (END_Y - STROKE / 2)) / (2 * (END_Y - STROKE / 2))
    : 180;
  const R = Math.max(180, RMin + 2);
  const cx = W / 2;
  const cy = END_Y + Math.sqrt(Math.max(R * R - halfChord * halfChord, 1));
  const arcD = `M ${EDGE} ${END_Y} A ${R} ${R} 0 0 1 ${W - EDGE} ${END_Y}`;

  const halfAngle = halfChord > 0 ? Math.asin(halfChord / R) : 0;
  const totalLen = 2 * R * halfAngle;
  const cp = Math.max(0, Math.min(100, pct)) / 100;
  const targetLen = totalLen * cp;

  // 端点圆点：严格落在圆上
  const dotAngle = -halfAngle + halfAngle * 2 * cp;
  const markerX = cx + R * Math.sin(dotAngle);
  const markerY = cy - R * Math.cos(dotAngle);

  return (
    <View
      style={styles.box}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - W) > 0.5) setW(w);
      }}
    >
      {W > 0 ? (
        <Svg width={W} height={VB_H} viewBox={`0 0 ${W} ${VB_H}`}>
          {/* 轨道 */}
          <Path
            d={arcD}
            stroke={trackColor ?? mm.colors.emptyFill}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
          {/* 进度弧 */}
          {cp > 0 && (
            <Path
              d={arcD}
              stroke={color}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${targetLen} ${totalLen - targetLen}`}
            />
          )}
          {/* 端点圆点 */}
          {cp > 0 && (
            <G>
              <Circle cx={markerX} cy={markerY} r={STROKE * 1.1} fill="none" stroke={markerColor ?? color} strokeWidth={1} opacity={0.25} />
              <Circle cx={markerX} cy={markerY} r={STROKE * 0.6} fill={markerColor ?? color} />
              <Circle cx={markerX - 4} cy={markerY - 4} r={4} fill="rgba(255,255,255,0.55)" />
            </G>
          )}
        </Svg>
      ) : null}

      {/* 中央内容：绝对居中于弧内弦线 */}
      <View style={[styles.center, { paddingTop: CONTENT_PAD_TOP }]} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: VB_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
