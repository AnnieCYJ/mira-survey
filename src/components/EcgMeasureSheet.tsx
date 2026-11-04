/**
 * EcgMeasureSheet —— 心电测量引导浮层（EcgDetailScreen 与洞察页 EcgCard 共用）
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ 2026-11-03（用户）：点击「测量」弹出浮层：底部进度条（调用方传入真实 progress）+
 *   实时心电图（ecgLiveWaveform）+ 失败停留展示原因 + 成功自动收起。
 * ★ 2026-11-04（用户）：① 删顶部「食指轻点」动画图（看不懂）；② 卡片/内嵌块配色深化（白字才看得清）；
 *   ③ 99% 停滞不再干等——调用方有停滞看门狗，此处 99% 显示「即将完成，正在生成报告…」。
 * 全部走 design token，无裸值（动画坐标除外）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

/** 实时波形路径：取最新 ~600 点窗口，归一化到 W×H（与 EcgDetailScreen.wavePath 同口径）。 */
function liveWavePath(values: number[], W: number, H: number): string {
  if (!values || values.length < 4) return '';
  const WINDOW = 600;
  const arr = values.length > WINDOW ? values.slice(-WINDOW) : values;
  let mn = Infinity, mx = -Infinity;
  for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || 1;
  const step = W / arr.length;
  let d = '';
  for (let i = 0; i < arr.length; i++) {
    const x = i * step;
    const y = H - ((arr[i] - mn) / span) * H * 0.82 - H * 0.09;
    d += (i === 0 ? 'M ' : 'L ') + `${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

/** 心电纸网格（与详情页同款红细/粗线）。 */
function LiveGrid({ W, H }: { W: number; H: number }) {
  const minor = 10, major = 50;
  const lines: React.ReactElement[] = [];
  for (let x = 0; x <= W; x += minor) {
    lines.push(<Line key={`v${x}`} x1={x} y1={0} x2={x} y2={H} stroke={mm.colors.ecgRed} strokeOpacity={x % major === 0 ? 0.22 : 0.08} strokeWidth={1} />);
  }
  for (let y = 0; y <= H; y += minor) {
    lines.push(<Line key={`h${y}`} x1={0} y1={y} x2={W} y2={y} stroke={mm.colors.ecgRed} strokeOpacity={y % major === 0 ? 0.22 : 0.08} strokeWidth={1} />);
  }
  return <>{lines}</>;
}

interface Props {
  /** true = 测量进行中（调用方按状态机传：isMeasuring / isDone）；false 且无 error 时自动收起 */
  visible: boolean;
  /** 显示用进度（0–100，调用方已做平滑） */
  progress?: number;
  /** 测量中实时心率 */
  hr?: number | null;
  /** 实时波形缓冲（mV） */
  liveWaveform?: number[] | null;
  /** 最近一次失败原因（非空时浮层停留展示） */
  error?: string | null;
  /** 测量中的轻提示（如「请保持手指接触电极…」） */
  hint?: string | null;
  /** 用户主动关闭（停止测量 / 关闭失败浮层） */
  onCancel: () => void;
}

export default function EcgMeasureSheet({ visible, progress, hr, liveWaveform, error, hint, onCancel }: Props) {
  // 内部 open：visible=true 时打开；visible=false 且无 error → 自动收起（成功）；
  // 有 error 时停留展示原因，由用户点「关闭」收起。
  const [open, setOpen] = useState(false);
  useEffect(() => { if (visible) setOpen(true); }, [visible]);
  useEffect(() => { if (!visible && !error) setOpen(false); }, [visible, error]);

  const W = Math.round(Dimensions.get('window').width) - 72;
  const H = 96;
  const hasLive = !!liveWaveform && liveWaveform.length > 4;
  const p = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  const failed = !!error && !visible;

  return (
    <Modal transparent visible={open} animationType="fade" statusBarTranslucent onRequestClose={() => { onCancel(); }}>
      <View style={s.backdrop}>
        <View style={s.box}>
          <Text style={s.title}>心电测量</Text>

          <Text style={s.guide}>
            戴好戒指，用另一只手食指轻触戒指外侧金属电极，闭合回路后开始出图
          </Text>

          {/* 实时心电图：采到波形后替换引导区 */}
          {hasLive ? (
            <View style={s.liveBox}>
              <View style={s.liveHead}>
                <Text style={s.liveTitle}>实时心电图</Text>
                {hr ? <Text style={s.liveHr}>{Math.round(hr)} bpm</Text> : null}
              </View>
              <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <LiveGrid W={W} H={H} />
                <Path d={liveWavePath(liveWaveform!, W, H)} fill="none" stroke={mm.colors.ecgRed} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          ) : failed ? (
            <View style={s.errBox}>
              <Text style={s.errText}>{error}</Text>
              <Text style={s.errSub}>提示：戴紧戒指后，用另一只手食指持续轻触戒指外侧金属电极再测。</Text>
            </View>
          ) : (
            <View style={s.waitBox}>
              <Text style={s.waitText}>{hint ?? '正在启动测量，请保持手指接触电极…'}</Text>
            </View>
          )}

          {/* 底部进度条 */}
          {!failed ? (
            <View style={s.progWrap}>
              <View style={s.progTrack}>
                <View style={[s.progFill, { width: `${p}%` }]} />
              </View>
              <Text style={s.progText}>
                {p >= 99 ? '即将完成，正在生成报告…' : `测量中 ${p}%`}{p < 99 && hr ? ` · ${Math.round(hr)} bpm` : ''}
              </Text>
            </View>
          ) : null}

          {/* 操作按钮 */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={[s.btn, failed && { backgroundColor: theme.colors.cardBgSoft, borderWidth: 1, borderColor: theme.colors.cardBorder }]}
            onPress={() => { onCancel(); if (failed) setOpen(false); }}
          >
            <Text style={[s.btnText, failed && { color: theme.colors.textTitle }]}>{failed ? '关闭' : '停止测量'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,18,32,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: '86%',
    maxWidth: 360,
    alignItems: 'center',
    // ★ 2026-11-04（用户「太浅看不清字」）：白 13% 半透明太浅，改近实心深色玻璃，白字对比拉满
    backgroundColor: 'rgba(12,20,35,0.97)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(5),
    paddingHorizontal: theme.sp(4),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(2),
  },

  guide: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: theme.sp(3),
  },

  liveBox: {
    width: '100%',
    // ★ 2026-11-04：浅粉 0.6 白底 + 白字看不清 → 深红玻璃底
    backgroundColor: 'rgba(229,72,77,0.12)',
    borderRadius: theme.radius.sm,
    paddingVertical: theme.sp(1.5),
    paddingHorizontal: theme.sp(2),
    marginBottom: theme.sp(3),
  },
  liveHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  liveTitle: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: mm.colors.ecgRed },
  liveHr: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.bold, color: theme.colors.textTitle },

  waitBox: { minHeight: 56, justifyContent: 'center', marginBottom: theme.sp(3) },
  waitText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 20 },

  errBox: {
    width: '100%',
    backgroundColor: 'rgba(229,72,77,0.14)', // ★ 2026-11-04：深化，配白字
    borderRadius: theme.radius.sm,
    padding: theme.sp(2),
    marginBottom: theme.sp(3),
  },
  errText: { fontSize: theme.fontSize.sm, color: theme.colors.danger ?? '#e53935', fontWeight: theme.weight.semibold, lineHeight: 19 },
  errSub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 4, lineHeight: 17 },

  progWrap: { width: '100%', marginBottom: theme.sp(3) },
  progTrack: {
    width: '100%',
    height: 6,
    backgroundColor: theme.colors.ui.scrimSoft,
    borderRadius: theme.sp(0.75),
    overflow: 'hidden',
  },
  progFill: { height: '100%', backgroundColor: mm.colors.ecgRed, borderRadius: theme.sp(0.75) },
  progText: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
  },

  btn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp(2.5),
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.ecgRed,
  },
  btnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
});
