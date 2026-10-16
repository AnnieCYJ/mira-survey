import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Text as SvgText } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { RingBle, type RingState, type EcgReading, type EcgAnalysis } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';

/** ECG 波形路径：点自适应归一化到 W×H 视窗（传入的已是 mV 值）。 */
function wavePath(values: number[], W: number, H: number): string {
  if (!values || values.length < 4) return '';
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || 1;
  const step = W / values.length;
  let d = '';
  for (let i = 0; i < values.length; i++) {
    const x = i * step;
    const y = H - ((values[i] - mn) / span) * H * 0.82 - H * 0.09;
    d += (i === 0 ? 'M ' : 'L ') + `${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

/** 心电图纸背景网格（红色细/粗线），让波形像打印在 ECG 纸上。 */
function EcgGrid({ W, H }: { W: number; H: number }) {
  const minor = 10;
  const major = 50;
  const lines: React.ReactElement[] = [];
  for (let x = 0; x <= W; x += minor) {
    const isMajor = x % major === 0;
    lines.push(<Line key={`v${x}`} x1={x} y1={0} x2={x} y2={H} stroke={mm.colors.ecgRed} strokeOpacity={isMajor ? 0.22 : 0.08} strokeWidth={1} />);
  }
  for (let y = 0; y <= H; y += minor) {
    const isMajor = y % major === 0;
    lines.push(<Line key={`h${y}`} x1={0} y1={y} x2={W} y2={y} stroke={mm.colors.ecgRed} strokeOpacity={isMajor ? 0.22 : 0.08} strokeWidth={1} />);
  }
  return <>{lines}</>;
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

const STATUS_COLOR = { normal: '#3FB984', high: '#E8A23D', low: '#5AA9E6' } as const;
type Status = keyof typeof STATUS_COLOR;

/** 医学指标卡：值 + 单位 + 参考区间 + 中性状态点（不写诊断结论）。 */
function MetricCell({ label, value, unit, refText, status }: { label: string; value: string; unit: string; refText: string; status?: Status }) {
  return (
    <View style={styles.metricCell}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.metricLabel}>{label}</Text>
        {status ? <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} /> : null}
      </View>
      <Text style={styles.metricValue}>
        {value}<Text style={styles.metricUnit}> {unit}</Text>
      </Text>
      <Text style={styles.metricRef}>参考 {refText}</Text>
    </View>
  );
}

/** 六风险雷达图（正六边形）。 */
function RiskRadar({ data }: { data: { label: string; value: number }[] }) {
  const size = 220;
  const cx = size / 2, cy = size / 2, R = 88;
  const n = data.length;
  const pt = (i: number, r: number) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  };
  const ringR = [0.25, 0.5, 0.75, 1].map((f) => f * R);
  const axisPts = data.map((_, i) => pt(i, R));
  const valPts = data.map((d, i) => pt(i, Math.min(1, (d.value ?? 0) / 99) * R));
  const valPoly = valPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <Svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
      {ringR.map((r, i) => {
        const d = `M ${pt(0, r).x},${pt(0, r).y} ` + data.map((_, k) => `L ${pt(k, r).x},${pt(k, r).y} `).join('') + 'Z';
        return <Path key={`r${i}`} d={d} fill="none" stroke="rgba(157,138,240,0.25)" strokeWidth={1} />;
      })}
      {axisPts.map((p, i) => (
        <Line key={`a${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(157,138,240,0.3)" strokeWidth={1} />
      ))}
      <Path d={`M ${valPoly.split(' ')[0]} L ${valPoly.split(' ').slice(1).join(' L ')} Z`} fill="rgba(245,138,184,0.28)" stroke={mm.colors.pink} strokeWidth={2} strokeLinejoin="round" />
      {valPts.map((p, i) => (
        <Path key={`v${i}`} d={`M ${p.x - 2.5},${p.y} L ${p.x + 2.5},${p.y} L ${p.x},${p.y + 3} Z`} fill={mm.colors.pink} />
      ))}
      {axisPts.map((p, i) => (
        <SvgText key={`t${i}`} x={p.x} y={p.y > cy ? p.y + 14 : p.y - 8} fontSize={10} fill={mm.colors.inkSoft} textAnchor="middle">{data[i].label}</SvgText>
      ))}
    </Svg>
  );
}

function RiskBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(99, value ?? 0));
  // 中性分级：<50 偏低/平稳，50–75 适中，>75 偏高（仅描述强度，不开诊断）
  const level = v > 75 ? 'high' : v > 50 ? 'mid' : 'low';
  const color = level === 'high' ? '#E8A23D' : level === 'mid' ? '#9D8AF0' : '#3FB984';
  return (
    <View style={styles.riskRow}>
      <View style={styles.riskHead}>
        <Text style={styles.riskLabel}>{label}</Text>
        <Text style={[styles.riskValue, { color }]}>{v}</Text>
      </View>
      <View style={styles.riskTrack}>
        <View style={[styles.riskFill, { width: `${(v / 99) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function EcgDetailScreen() {
  const navigation = useNavigation<any>();
  const ring = useRingState();
  const [measuring, setMeasuring] = useState(false);
  const [tab, setTab] = useState<'metrics' | 'risk'>('metrics');

  useEffect(() => {
    if (measuring && ring.ecg) setMeasuring(false);
  }, [measuring, ring.ecg]);

  const measureEcg = useCallback(() => {
    if (measuring) return;
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring]);

  const stopEcg = useCallback(() => {
    RingBle.stopEcg();
    setMeasuring(false);
  }, []);

  const history = ring.ecgHistory ?? [];
  const latest = history.length > 0 ? history[0] : null;
  const a: EcgAnalysis | undefined = latest?.analysis;

  // 医学指标（参考区间中性描述）
  const metrics: { label: string; value: string; unit: string; refText: string; status?: Status }[] = [
    { label: '平均心率', value: `${Math.round(latest?.aveHeart ?? 0)}`, unit: 'bpm', refText: '60–100', status: (latest?.aveHeart ?? 0) > 100 ? 'high' : (latest?.aveHeart ?? 0) < 60 ? 'low' : 'normal' },
    { label: 'HRV', value: `${Math.round(latest?.aveHrv ?? 0)}`, unit: 'ms', refText: '通常 20–100' },
    { label: 'SDNN', value: a?.sdnn != null ? `${Math.round(a.sdnn)}` : '—', unit: 'ms', refText: '102–180', status: a?.sdnn != null ? (a.sdnn > 180 ? 'high' : a.sdnn < 102 ? 'low' : 'normal') : undefined },
    { label: 'RMSSD', value: a?.rmssd != null ? `${Math.round(a.rmssd)}` : '—', unit: 'ms', refText: '15–39', status: a?.rmssd != null ? (a.rmssd > 39 ? 'high' : a.rmssd < 15 ? 'low' : 'normal') : undefined },
    { label: 'QTc', value: a?.qtc != null ? `${Math.round(a.qtc)}` : '—', unit: 'ms', refText: '女 <460', status: a?.qtc != null ? (a.qtc > 460 ? 'high' : 'normal') : undefined },
    { label: 'QRS 时限', value: a?.qrsTime != null ? `${Math.round(a.qrsTime)}` : '—', unit: 'ms', refText: '60–100', status: a?.qrsTime != null ? (a.qrsTime > 110 ? 'high' : 'normal') : undefined },
    { label: 'QRS 振幅', value: a?.qrsAmp != null ? `${(a.qrsAmp / 100).toFixed(2)}` : '—', unit: 'mV', refText: '0.5–1.5', status: a?.qrsAmp != null ? (a.qrsAmp / 100 > 1.5 ? 'high' : a.qrsAmp / 100 < 0.5 ? 'low' : 'normal') : undefined },
    { label: 'ST 段', value: a?.stMeanAmp != null ? `${(a.stMeanAmp / 100).toFixed(2)}` : '—', unit: 'mV', refText: '−0.05–0.10', status: a?.stMeanAmp != null ? (Math.abs(a.stMeanAmp / 100) > 0.1 ? 'high' : 'normal') : undefined },
    { label: 'PWV', value: a?.pwvMeanVal != null ? `${(a.pwvMeanVal / 10).toFixed(1)}` : '—', unit: 'm/s', refText: '6–20', status: a?.pwvMeanVal != null ? (a.pwvMeanVal / 10 > 15 ? 'high' : 'normal') : undefined },
  ];

  const risks: { label: string; value: number }[] = [
    { label: '心律失常', value: a?.arrhythmiaRisk ?? 0 },
    { label: '精神压力', value: a?.stressIndex ?? 0 },
    { label: '疲劳', value: a?.fatigueIndex ?? 0 },
    { label: '心肌炎', value: a?.myocarditisRisk ?? 0 },
    { label: '冠心病', value: a?.chdRisk ?? 0 },
    { label: '血管硬化', value: a?.angiosclerosisRisk ?? 0 },
  ];

  return (
    <View style={{ flex: 1 }}>
      <BgGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer compactTop topFadeColor={theme.colors.textWhite}>
        <View style={styles.head}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Text style={{ fontSize: 20 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>心电图</Text>
            <Text style={styles.sub}>{ring.status === 'connected' ? 'HK18 ECG 硬件' : '连接戒指后测量'}</Text>
          </View>
        </View>

        {/* 最新一次：心电图（医学网格） */}
        {latest ? (
          <View style={styles.latestBox}>
            <View style={styles.latestTop}>
              <Text style={styles.latestTime}>最新一次 · {fmtDateTime(latest.ts)}</Text>
              <Text style={styles.scaleTag}>25 mm/s · 10 mm/mV</Text>
            </View>
            <Svg width="100%" height={120} viewBox="0 0 320 120" preserveAspectRatio="none" style={{ marginTop: 8, backgroundColor: 'rgba(255,240,243,0.6)', borderRadius: 8 }}>
              <EcgGrid W={320} H={120} />
              <Defs>
                <LinearGradient id="ecgLatest" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0%" stopColor={mm.colors.ecgRed} stopOpacity={0.6} />
                  <Stop offset="100%" stopColor={mm.colors.ecgRed} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              {latest.waveform && latest.waveform.length > 0 ? (
                <Path d={wavePath(latest.waveform, 320, 120)} fill="none" stroke="url(#ecgLatest)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
            </Svg>
          </View>
        ) : null}

        {/* 测量按钮 */}
        {measuring ? (
          <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={[styles.btn, { backgroundColor: theme.colors.danger }]}>
            <Text style={styles.btnLabel}>
              {ring.ecgProgress?.progress
                ? `测量中 ${Math.round(ring.ecgProgress.progress)}%${ring.ecgProgress.hr ? ` · ${Math.round(ring.ecgProgress.hr)} bpm` : ''}`
                : '测量中…（请保持手指接触电极）'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} style={styles.btn}>
            <Text style={styles.btnLabel}>{latest ? '重新测量心电图' : '开始心电图测量'}</Text>
          </TouchableOpacity>
        )}

        {/* 分段：医学指标 / 风险分析 */}
        {latest?.analysis ? (
          <>
            <View style={styles.segment}>
              {(['metrics', 'risk'] as const).map((k) => (
                <TouchableOpacity key={k} style={[styles.segBtn, tab === k && styles.segBtnOn]} onPress={() => setTab(k)}>
                  <Text style={[styles.segTxt, tab === k && styles.segTxtOn]}>{k === 'metrics' ? '医学指标' : '风险分析'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'metrics' ? (
              <View style={styles.metricGrid}>
                {metrics.map((m) => (<MetricCell key={m.label} {...m} />))}
              </View>
            ) : (
              <View style={styles.riskBox}>
                <RiskRadar data={risks} />
                <Text style={styles.riskHint}>数值为设备评估参考（0–99，越靠外强度越高）</Text>
                <View style={{ marginTop: 4 }}>
                  {risks.map((r) => (<RiskBar key={r.label} {...r} />))}
                </View>
              </View>
            )}

            <Text style={styles.disclaimer}>
              以上数据来自戒指硬件评估，仅作健康参考，不构成医疗诊断建议。如有不适请咨询专业医生。
            </Text>
          </>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>{latest ? '本次测量暂未返回分析报告，可重新测量获取。' : '还没有心电图测量记录。点击上方按钮开始第一次测量。'}</Text>
          </View>
        )}

        {/* 历史列表 */}
        <Text style={styles.sectionTitle}>历史测量 · {history.length} 次</Text>
        {history.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>还没有心电图测量记录。</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {history.map((r: EcgReading, i: number) => (
              <View key={`${r.ts}-${i}`} style={styles.historyItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.hTime}>{fmtDateTime(r.ts)}</Text>
                  <Text style={styles.hRel}>{fmtRelative(r.ts)}</Text>
                </View>
                {r.waveform && r.waveform.length > 0 ? (
                  <Svg width="100%" height={44} viewBox="0 0 160 44" preserveAspectRatio="none">
                    <Path d={wavePath(r.waveform, 160, 44)} fill="none" stroke={mm.colors.ecgRed} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
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
    </View>
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
  latestTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  latestTime: { fontSize: 13, color: theme.colors.textSub },
  scaleTag: { fontSize: 10, color: mm.colors.ecgRed, fontWeight: '600' },

  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.ecgRed,
    marginBottom: 16,
  },
  btnLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textWhite },

  segment: { flexDirection: 'row', backgroundColor: 'rgba(157,138,240,0.12)', borderRadius: theme.radius.md, padding: 4, marginBottom: 12 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: theme.radius.sm },
  segBtnOn: { backgroundColor: theme.colors.textWhite, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segTxt: { fontSize: 13, fontWeight: '600', color: theme.colors.textSub },
  segTxtOn: { color: theme.colors.textTitle },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCell: {
    width: '31%',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
  },
  metricLabel: { fontSize: 11, color: theme.colors.textSub },
  metricValue: { fontSize: 17, fontWeight: '700', color: theme.colors.textTitle, marginVertical: 3 },
  metricUnit: { fontSize: 10, fontWeight: '500', color: theme.colors.textSub },
  metricRef: { fontSize: 9.5, color: theme.colors.textSub },
  dot: { width: 7, height: 7, borderRadius: 4 },

  riskBox: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: 14, marginBottom: 12 },
  riskHint: { fontSize: 10.5, color: theme.colors.textSub, textAlign: 'center', marginTop: 4, marginBottom: 10 },
  riskRow: { marginBottom: 12 },
  riskHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  riskLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.textTitle },
  riskValue: { fontSize: 13, fontWeight: '700' },
  riskTrack: { height: 7, backgroundColor: 'rgba(157,138,240,0.14)', borderRadius: 4, overflow: 'hidden' },
  riskFill: { height: '100%', borderRadius: 4 },

  disclaimer: { fontSize: 10.5, color: theme.colors.textSub, lineHeight: 15, marginVertical: 10 },

  sectionTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.textTitle, marginBottom: 8, marginTop: 4 },
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

  emptyBox: { alignItems: 'center', paddingVertical: 22 },
  emptyText: { fontSize: 13, color: theme.colors.textSub, textAlign: 'center' },
});
