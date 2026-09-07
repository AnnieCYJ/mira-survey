import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { RingBle, type RingState } from '../ble/RingBleManager';

interface Props {
  ring: RingState;
  onPress: () => void;
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

export default function EcgCard({ ring, onPress }: Props) {
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
    <View style={styles.card}>
      {/* 头部 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={styles.title}>心电图 ECG</Text>
        {latest ? (
          <Text style={styles.time}>
            {(() => {
              const diff = Math.floor((Date.now() - latest.ts) / 60000);
              if (diff < 1) return '刚刚';
              if (diff < 60) return `${diff}分钟前`;
              return `${Math.floor(diff / 60)}小时前`;
            })()}
          </Text>
        ) : (
          <Text style={styles.time}>尚未测量</Text>
        )}
      </View>

      {/* 迷你波形 / 占位 */}
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.waveBox}>
        {latest && latest.waveform && latest.waveform.length > 0 ? (
          <Svg width="100%" height={36} viewBox="0 0 160 32" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="ecgMini" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.4} />
                <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Path d={miniWaveform(latest.waveform)} fill="none" stroke="url(#ecgMini)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : (
          <Text style={{ fontSize: 12, color: theme.colors.textSub }}>点击查看历史测量记录</Text>
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
            <View key={k} style={{ flex: 1, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: theme.radius.sm, paddingVertical: 6 }}>
              <Text style={{ fontSize: 11, color: theme.colors.textSub }}>{k}</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textTitle }}>{v}</Text>
              <Text style={{ fontSize: 10, color: theme.colors.textSub }}>{u}</Text>
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
        // 状态 3：空闲 → 绿色按钮开始/重测
        <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} style={styles.btn}>
          <Text style={styles.btnLabel}>{latest ? '重新测量' : '开始心电图测量'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.textTitle },
  time: { fontSize: 12, color: theme.colors.textSub },
  waveBox: {
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btn: {
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentSolid,
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
  btnLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textWhite },
  progressTrack: {
    marginTop: 8,
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
});
