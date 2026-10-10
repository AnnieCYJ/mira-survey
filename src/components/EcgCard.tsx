import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { RingBle, type RingState } from '../ble/RingBleManager';

interface Props {
  ring: RingState;
  onPress: () => void;
  compactMode?: boolean;
}

/** ECG 波形路径：原始 ADC 点归一化到 160×32 视窗的迷你折线。 */
function miniWaveform(values: number[]): string {
  if (!values || values.length < 4) return '';
  const W = 160, H = 32;
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || 1;
  const step = W / values.length;
  let d = '';
  for (let i = 0; i < values.length; i++) {
    const x = i * step;
    const y = H - ((values[i] - mn) / span) * H * 0.85 - H * 0.075;
    d += (i === 0 ? 'M ' : 'L ') + `${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

export default function EcgCard({ ring, onPress, compactMode = false }: Props) {
  const prog = ring.ecgProgress;
  const latest = ring.ecg;

  // ★ 完全数据驱动：根据 ring.ecgProgress 判断状态
  // progress in [0, 99] → 正在测量
  // progress = 100 → 刚完成（等待 handleEcg 写入 ring.ecg）
  // progress = null → 空闲
  const progress = prog?.progress ?? 0;
  const isMeasuring = prog != null && progress >= 0 && progress < 100;
  const isDone = prog != null && progress >= 100;

  // ★ 平滑进度：HK18 固件 ECG 的 progress 回调长期停在低位（如 6%）才跳完成，
  // 原生无补间，UI 看着像卡死。这里用计时器把显示进度平滑推到 99 封顶（不再写死 92，
  // 避免「卡在92%」错觉），与「原生真实 progress」取较大值，complete 时由原生跳 100。
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    if (!isMeasuring) { setAnim(0); return; }
    const id = setInterval(() => {
      setAnim((p) => (p >= 99 ? p : Math.min(99, p + 1.2)));
    }, 250);
    return () => clearInterval(id);
  }, [isMeasuring]);
  const displayProgress = isMeasuring ? Math.max(progress, anim) : progress;

  const measureEcg = useCallback(() => {
    if (isMeasuring) return; // 正在测，忽略重复点击
    if (isDone) return;      // 刚完成，等结果落盘
    const st = RingBle.getState();
    if (!st.deviceId) { Alert.alert('提示', '请先连接戒指'); return; }
    if (st.status !== 'connected') { Alert.alert('提示', '戒指未连接（当前: ' + st.status + '）'); return; }
    RingBle.measure('ecg'); // measure() 内部先清残留 ecgProgress 再调原生
  }, [isMeasuring, isDone]);

  const stopEcg = useCallback(() => {
    RingBle.stopEcg();
  }, []);

  return (
    <View style={compactMode ? {} : styles.card}>
      {/* ★ 统一头部：图标方 + 名称 + 状态 pill */}
      <View style={styles.ucTop}>
        <View style={styles.ucId}>
          <View style={styles.ic}>
            <Svg width={15} height={15} viewBox="0 0 24 24">
              <Path
                d="M2 12h5l2-6 4 12 3-9 2 3h4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.ucName}>心电图 ECG</Text>
        </View>
        <View style={[styles.pill, latest ? styles.pillLive : styles.pillOff]}>
          <Text style={[styles.pillText, latest ? styles.pillTextLive : styles.pillTextOff]}>
            {latest ? '已测' : '待接入'}
          </Text>
        </View>
      </View>

      {/* 迷你波形 / 占位 */}
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.waveBox}>
        {latest && latest.waveform && latest.waveform.length > 0 ? (
          <Svg width="100%" height={36} viewBox="0 0 160 32" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="ecgMini" x1="0" y1="0" x2="1" y2="0">
                {/* 心电波形 = 专业红（ecgRed）；线必为红，不与 anomaly 异常语义混用 */}
                <Stop offset="0%" stopColor={mm.colors.ecgRed} stopOpacity={0.45} />
                <Stop offset="100%" stopColor={mm.colors.ecgRed} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Path d={miniWaveform(latest.waveform)} fill="none" stroke="url(#ecgMini)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : (
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>点击查看历史测量记录</Text>
        )}
      </TouchableOpacity>

      {/* 派生指标（有值时显示） */}
      {latest ? (
        <View style={{ flexDirection: 'row', marginTop: 10, gap: 12 }}>
          {[
            ['心率', `${Math.round(latest.aveHeart)}`, 'bpm'],
            ['HRV', `${Math.round(latest.aveHrv)}`, 'ms'],
            ['呼吸', `${Math.round(latest.aveResRate)}`, '次/分'],
          ].map(([k, v, u]) => (
            <View key={k} style={{ flex: 1, alignItems: 'center', backgroundColor: theme.colors.ui.white55, borderRadius: theme.radius.sm, paddingVertical: theme.sp(1.5) }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{k}</Text>
              <Text style={{ fontSize: theme.fontSize.body, fontWeight: theme.weight.bold, color: theme.colors.textTitle }}>{v}</Text>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{u}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 测量按钮（数据驱动三种状态） */}
      {isMeasuring ? (
        // 状态 1：正在测量 → 红色按钮 + 进度 + 停止
        <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={[styles.btn, styles.btnMeasuring]}>
          <View style={styles.btnContent}>
            <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.btnLabel}>
              测量中 {Math.round(displayProgress)}%{prog?.hr ? ` · ${Math.round(prog.hr)} bpm` : ''}
            </Text>
          </View>
          {/* 进度条 */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(displayProgress, 100)}%` }]} />
          </View>
        </TouchableOpacity>
      ) : isDone ? (
        // 状态 2：刚完成（100%）→ 短暂过渡态，等 ring.ecg 写入
        <View style={[styles.btn, { backgroundColor: theme.colors.success || '#22c55e' }]}>
          <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.btnLabel}>处理结果中…</Text>
        </View>
      ) : (
        // 状态 3：空闲 → v10 渐变按钮（lime→粉，全 app 按钮统一）
        <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} style={styles.btn}>
          <ExpoLinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btnGrad}
          >
            <Text style={styles.btnLabelGrad}>{latest ? '重新测量' : '开始心电图测量'}</Text>
          </ExpoLinearGradient>
        </TouchableOpacity>
      )}

      {/* ★ 统一底部入口（整卡可点进趋势详情；此处为统一视觉入口） */}
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.enter}>
        <Text style={styles.enterTxt}>查看趋势图</Text>
        <Text style={styles.enterArr}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },
  // 统一头部
  ucTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ucId: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 },
  ic: {
    width: 26,
    height: 26,
    borderRadius: mm.radius.iconSq,
    backgroundColor: mm.colors.ecgRedSoft,
    color: mm.colors.ecgRed,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  ucName: { fontSize: 14, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  pill: { paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill, alignSelf: 'flex-start' },
  pillLive: { backgroundColor: theme.colors.successSoft },
  pillOff: { backgroundColor: theme.colors.ui.offTrack },
  pillText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  pillTextLive: { color: theme.colors.success },
  pillTextOff: { color: theme.colors.textSub },
  // 统一底部入口
  enter: {
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enterTxt: { fontSize: 12, fontWeight: theme.weight.semibold, color: mm.colors.ecgRed },
  enterArr: { fontSize: 13, fontWeight: theme.weight.bold, color: mm.colors.ecgRed },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  time: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  waveBox: {
    height: 40,
    backgroundColor: theme.colors.ui.white55,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btn: {
    marginTop: 12,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  btnGrad: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  btnLabelGrad: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.btnTextOnGrad,
  },
  btnMeasuring: {
    backgroundColor: theme.colors.danger,
    paddingVertical: 10,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
  progressTrack: {
    marginTop: 8,
    width: '100%',
    height: 4,
    backgroundColor: theme.colors.ui.white25,
    borderRadius: theme.sp(0.5),
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.textWhite,
    borderRadius: theme.sp(0.5),
  },
});
