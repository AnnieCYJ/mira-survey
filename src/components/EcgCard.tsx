import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
  const [measuring, setMeasuring] = useState(false);
  const ecgRunningRef = useRef(false);

  useEffect(() => {
    if (measuring && ring.ecg) setMeasuring(false);
  }, [measuring, ring.ecg]);

  const measureEcg = useCallback(() => {
    if (ecgRunningRef.current) { console.log('[EcgMeasure] already running, skip'); return; }
    const st = RingBle.getState();
    if (!st.deviceId) { Alert.alert('提示', '请先连接戒指'); return; }
    if (st.status !== 'connected') { Alert.alert('提示', '戒指未连接（当前: ' + st.status + '）'); return; }
    try {
      console.log('[EcgMeasure] → RingBle.measure(ecg)');
      ecgRunningRef.current = true;
      setMeasuring(true);
      RingBle.measure('ecg');
    } catch (e: any) {
      Alert.alert('ECG 测量失败', String(e?.message || e));
      ecgRunningRef.current = false;
      setMeasuring(false);
    }
  }, []);

  const stopEcg = useCallback(() => {
    console.log('[EcgMeasure] RingBle.stopEcg()');
    ecgRunningRef.current = false;
    RingBle.stopEcg();
    setMeasuring(false);
  }, []);

  const latest = ring.ecg;
  const prog = ring.ecgProgress;

  // 收到完整波形或 progress=100 自动解锁
  useEffect(() => {
    const p = typeof prog === 'number' ? prog : prog?.progress ?? 0;
    if (p >= 100 || (latest && latest.waveform && latest.waveform.length > 0)) {
      ecgRunningRef.current = false;
      setMeasuring(false);
    }
  }, [prog, latest?.waveform?.length]);

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

      {/* 测量按钮 */}
      {measuring ? (
        <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={[styles.btn, { backgroundColor: theme.colors.danger }]}>
          <Text style={styles.btnLabel}>
            {prog?.progress
              ? `测量中 ${prog.progress}%${prog.hr ? ` · ${Math.round(prog.hr)} bpm` : ''}`
              : '测量中…（约 30 秒）'}
          </Text>
        </TouchableOpacity>
      ) : (
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
  btnLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textWhite },
});
