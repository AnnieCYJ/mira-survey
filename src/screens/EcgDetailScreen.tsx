import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import { RingBle, type RingState, type EcgReading } from '../ble/RingBleManager';

/** ECG 波形路径：原始 ADC 点归一化到 W×H 视窗。 */
function wavePath(values: number[], W: number, H: number): string {
  if (!values || values.length < 4) return '';
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

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtRelative(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

export default function EcgDetailScreen() {
  const navigation = useNavigation<any>();
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);
  useEffect(() => {
    if (measuring && ring.ecg) setMeasuring(false);
  }, [measuring, ring.ecg]);

  const measureEcg = useCallback(() => {
    if (measuring) return;
    console.log('[EcgMeasure] RingBle.measure(ecg) called, status=', RingBle.getState().status, 'deviceId=', RingBle.getState().deviceId);
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring]);

  const stopEcg = useCallback(() => {
    console.log('[EcgMeasure] RingBle.stopEcg()');
    RingBle.stopEcg();
    setMeasuring(false);
  }, []);

  const history = ring.ecgHistory ?? [];
  const latest = history.length > 0 ? history[0] : null;

  return (
    <ScreenContainer compactTop>
      {/* Header */}
      <View style={styles.head}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 20 }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>心电图</Text>
          <Text style={styles.sub}>{ring.status === 'connected' ? 'HK18 ECG 硬件' : '连接戒指后测量'}</Text>
        </View>
      </View>

      {/* 最新一次结果 Hero */}
      {latest ? (
        <View style={styles.latestBox}>
          <Text style={styles.latestTime}>最新一次 · {fmtDateTime(latest.ts)}</Text>
          {latest.waveform && latest.waveform.length > 0 ? (
            <Svg width="100%" height={72} viewBox="0 0 320 72" preserveAspectRatio="none" style={{ marginTop: 10 }}>
              <Defs>
                <LinearGradient id="ecgLatest" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.5} />
                  <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Path d={wavePath(latest.waveform, 320, 72)} fill="none" stroke="url(#ecgLatest)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
            {[
              ['平均心率', `${Math.round(latest.aveHeart)}`, 'bpm'],
              ['HRV', `${Math.round(latest.aveHrv)}`, 'ms'],
              ['呼吸率', `${Math.round(latest.aveResRate)}`, '次/分'],
              ['QT', `${Math.round(latest.aveQT)}`, 'ms'],
              ['PWV', `${Math.round(latest.avePWV)}`, 'cm/s'],
            ].map(([k, v, u]) => (
              <View key={k} style={styles.ecgCell}>
                <Text style={styles.ecgLabel}>{k}</Text>
                <Text style={styles.ecgValue}>{v}</Text>
                <Text style={styles.ecgUnit}>{u}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* 测量按钮 */}
      {measuring ? (
        <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={[styles.btn, { backgroundColor: theme.colors.danger }]}>
          <Text style={styles.btnLabel}>
            {ring.ecgProgress?.progress
              ? `测量中 ${ring.ecgProgress.progress}%${ring.ecgProgress.hr ? ` · ${Math.round(ring.ecgProgress.hr)} bpm` : ''}`
              : '测量中…（请保持手指接触电极）'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} style={styles.btn}>
          <Text style={styles.btnLabel}>{latest ? '重新测量心电图' : '开始心电图测量'}</Text>
        </TouchableOpacity>
      )}

      {/* 历史列表 */}
      <Text style={styles.sectionTitle}>
        历史测量 · {history.length} 次
      </Text>
      {history.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>还没有心电图测量记录。点击上方按钮开始第一次测量。</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 400 }}>
          {history.map((r: EcgReading, i: number) => (
            <View key={`${r.ts}-${i}`} style={styles.historyItem}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.hTime}>{fmtDateTime(r.ts)}</Text>
                <Text style={styles.hRel}>{fmtRelative(r.ts)}</Text>
              </View>
              {r.waveform && r.waveform.length > 0 ? (
                <Svg width="100%" height={44} viewBox="0 0 160 44" preserveAspectRatio="none">
                  <Path d={wavePath(r.waveform, 160, 44)} fill="none" stroke={theme.colors.accentSolid} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
                </Svg>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <Text style={styles.hStat}>心率 <Text style={styles.hStatVal}>{Math.round(r.aveHeart)}</Text> bpm</Text>
                <Text style={styles.hStat}>HRV <Text style={styles.hStatVal}>{Math.round(r.aveHrv)}</Text> ms</Text>
                <Text style={styles.hStat}>呼吸 <Text style={styles.hStatVal}>{Math.round(r.aveResRate)}</Text></Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', marginRight: 8 },
  title: { fontSize: 20, fontWeight: '600', color: theme.colors.textTitle },
  sub: { fontSize: 12, color: theme.colors.textSub, marginTop: 2 },

  latestBox: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },
  latestTime: { fontSize: 13, color: theme.colors.textSub },
  ecgCell: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: theme.radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  ecgLabel: { fontSize: 10, color: theme.colors.textSub, marginBottom: 2 },
  ecgValue: { fontSize: 18, fontWeight: '700', color: theme.colors.textTitle },
  ecgUnit: { fontSize: 10, color: theme.colors.textSub },

  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentSolid,
    marginBottom: 16,
  },
  btnLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textWhite },

  sectionTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.textTitle, marginBottom: 8 },
  historyItem: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
    marginBottom: 8,
  },
  hTime: { fontSize: 12, color: theme.colors.textInk, fontWeight: '600' },
  hRel: { fontSize: 11, color: theme.colors.textSub },
  hStat: { fontSize: 11, color: theme.colors.textSub },
  hStatVal: { fontSize: 12, fontWeight: '700', color: theme.colors.textTitle },

  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { fontSize: 13, color: theme.colors.textSub, textAlign: 'center' },
});
