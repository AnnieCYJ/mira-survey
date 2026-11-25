import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Dimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Text as SvgText } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { RingBle, type RingState, type EcgReading, type EcgAnalysis } from '../ble/RingBleManager';
import { useRingState } from '../hooks/useRingState';
import EcgMeasureSheet from '../components/EcgMeasureSheet';
// ★ 2026-11-06 审查（docs/audit/03 🔴#3）：机型能力门禁（ECG 硬件是否存在）
import { useDeviceModel, hasCap } from '../config/deviceModel';
// ★ 2026-11-06 审查（docs/audit/03 🔴#4）：ECG 数值兜底格式化
import { fmtEcgNum, ecgStatus } from '../lib/ecgFormat';

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

/** 心电波形「不压缩」查看器：按自然横向比例铺开（PX_PER_SAMPLE 像素/采样点），超出屏幕宽度时用横向滚动看全部；
 *  点击可放大到全屏。竖向按本段 min/max 自适应高度，避免压扁形态。 */
const PX_PER_SAMPLE = 0.7;
/** ★ 2026-11-20(v65) 崩溃修复：设备一次测量可回传数万个波形点（实测 38000+），
 *  旧逻辑 W=点数×0.7≈26000px + 每10px一条网格线 → SVG bitmap 105MB，
 *  超出 Android 单 bitmap 上限触发 `Canvas: trying to draw too large bitmap` 崩溃。
 *  绘制前等距下采样到 ≤3600 点（W≈2520px，bitmap <2MB），形态保留、不再崩。 */
function downsampleWaveForDraw(values: number[], max = 3600): number[] {
  if (!values || values.length <= max) return values;
  const out: number[] = [];
  const stride = values.length / max;
  for (let i = 0; i < max; i++) out.push(values[Math.floor(i * stride)]);
  return out;
}
function EcgScrollTrace({ waveform, height = 150, color = mm.colors.ecgRed, onTap }: { waveform: number[]; height?: number; color?: string; onTap?: () => void }) {
  const wave = downsampleWaveForDraw(waveform);
  const W = Math.max(320, wave.length * PX_PER_SAMPLE);
  const Inner = (
    <Svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
      <EcgGrid W={W} H={height} />
      {wave.length > 4 ? (
        <Path d={wavePath(wave, W, height)} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </Svg>
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={{ paddingVertical: 4 }}
      style={{ backgroundColor: 'rgba(255,240,243,0.6)', borderRadius: theme.radius.sm }}
    >
      {onTap ? <TouchableOpacity activeOpacity={0.9} onPress={onTap}>{Inner}</TouchableOpacity> : Inner}
    </ScrollView>
  );
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

const STATUS_COLOR = { normal: theme.colors.success, high: theme.colors.warn, low: theme.colors.stateTired } as const;
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
  // ★ 2026-11-20（用户：补上竞品那种"较低/中等/较高"分级措辞）：
  //   仅把设备返回值的强度区间翻译成大白话，与既有配色共用同一套阈值，
  //   文字与颜色永不矛盾；不做评分、不开诊断，口径见风险页 hint 文案。
  const level = v > 75 ? 'high' : v > 50 ? 'mid' : 'low';
  const levelText = level === 'high' ? '较高' : level === 'mid' ? '中等' : '较低';
  const color = level === 'high' ? theme.colors.warn : level === 'mid' ? theme.colors.accentSolid : theme.colors.success;
  return (
    <View style={styles.riskRow}>
      <View style={styles.riskHead}>
        <Text style={styles.riskLabel}>{label}</Text>
        <View style={styles.riskHeadRight}>
          <Text style={[styles.riskLevelTag, { color, borderColor: color }]}>{levelText}</Text>
          <Text style={[styles.riskValue, { color }]}>{v}</Text>
        </View>
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
  // ★ 2026-11-06 审查（docs/audit/03 🔴#3）：机型能力门禁 ——
  //   基础版（无 ECG 传感器）整页不再显示「HK18 ECG 硬件 + 开始测量」的空壳界面。
  const { model: dmModel } = useDeviceModel();
  const ecgSupported = hasCap(dmModel, 'ecg');
  const [measuring, setMeasuring] = useState(false);
  const [tab, setTab] = useState<'metrics' | 'risk'>('metrics');
  const [zoom, setZoom] = useState(false);
  const liveWave = ring.ecgLiveWaveform;
  const zoomH = Math.round(Dimensions.get('window').height * 0.55);

  // ★ 2026-11-19（用户：测完心电图没跳分析、又回到测量里）：
  //   根因——旧实现 `measuring && ring.ecg` 用「全局有没有心电图」判断本次是否测完，
  //   但进页面时 ring.ecg 已经是上一次的旧报告（非零），于是刚点测量就被误判完成，
  //   measuring 立刻被 set false → 浮层收起、退回「重新测量」按钮，看起来像又回到测量里。
  //   正确口径：记录「本次测量开始时的报告 ts」作基线；只有本次真的落库了更新的
  //   ecg（ts 变大）或写出 ecgError 才退出测量态。旧报告/历史值一律不算完成。
  const ecgBaseTs = useRef<number | null>(null);
  useEffect(() => {
    if (!measuring) return;
    const base = ecgBaseTs.current ?? 0;
    const gotNewReport = !!ring.ecg && Number.isFinite(ring.ecg.ts) && ring.ecg.ts > base;
    const gotError = !!ring.ecgError;
    if (gotNewReport || gotError) setMeasuring(false);
  }, [measuring, ring.ecg?.ts, ring.ecgError]);

  // ★ 2026-10-16：测量超时兜底（与 EcgCard 一致）：120s 内无结果则 abort + 写 ecgError
  useEffect(() => {
    if (!measuring) return;
    const id = setTimeout(() => RingBle.abortEcg(), 120000);
    return () => clearTimeout(id);
  }, [measuring]);

  // ★ 2026-11-04（用户：「99% 卡住不动」）：进度停滞看门狗 —— progress 连续 12s 不涨（SDK 卡在末段等最终结果）
  //   就不再干等满 120s，直接中止并给出明确失败原因，浮层立即回到可重试状态。
  useEffect(() => {
    if (!measuring) return;
    let lastP = -1;
    let lastWaveLen = -1;
    let lastChangeAt = Date.now();
    const startedAt = Date.now();
    let reached100At = 0;
    const iv = setInterval(() => {
      const st = RingBle.getState();
      const p = st.ecgProgress?.progress ?? 0;
      const waveLen = st.ecgLiveWaveform?.length ?? 0;
      // ★ 结果一旦落库/报错就停止看门狗（避免 abort 已经出值的结果）
      if (st.ecg || st.ecgError) return;
      const advanced = p !== lastP || waveLen !== lastWaveLen;
      if (advanced) {
        lastP = p;
        lastWaveLen = waveLen;
        lastChangeAt = Date.now();
      }
      // ★ 2026-11-17 二次修复：进度到 100 后独立计时。
      //   100% 是这台戒指的"测量完成"信号，原生会在 1.5s 兜底出值；
      //   但若原生链路整体失效，JS 这里 12s 后必须主动中止，绝不让 UI 永久停在"生成报告"。
      if (p >= 100 && reached100At === 0) reached100At = Date.now();
      const wait100Stuck = reached100At > 0 && Date.now() - reached100At > 12000;
      const progressStalled = p < 100 && Date.now() - lastChangeAt > 15000;
      const noDataAtAll = Date.now() - startedAt > 25000 && p < 100 && waveLen === 0;
      if (wait100Stuck || progressStalled || noDataAtAll) {
        RingBle.abortEcg();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [measuring]);

  /**
   * ★ 2026-11-06 审查（docs/audit/03 🔴#3）：测量入口三重前置检查。
   *   旧实现无任何检查 → 基础版点「开始测量」后直接进入无限「测量中」，
   *   连「请先连接戒指」都得不到（对比 EcgCard 已有这三道检查）。
   */
  const measureEcg = useCallback(() => {
    if (measuring) return;
    const st = RingBle.getState();
    if (!st.deviceId) { Alert.alert('提示', '请先连接戒指'); return; }
    if (st.status !== 'connected') { Alert.alert('提示', '戒指未连接（当前: ' + st.status + '）'); return; }
    if (!ecgSupported) { Alert.alert('提示', '当前戒指硬件不支持 ECG 测量'); return; }
    // 基线 = 开始这次测量前的报告时间；只有比它更新的 ecg 才算本次结果（防旧报告误判完成）
    ecgBaseTs.current = Number.isFinite(st.ecg?.ts) ? st.ecg!.ts : 0;
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring, ecgSupported]);

  const stopEcg = useCallback(() => {
    RingBle.stopEcg();
    setMeasuring(false);
  }, []);

  const history = ring.ecgHistory ?? [];
  const latest = history.length > 0 ? history[0] : null;
  const zoomWave = downsampleWaveForDraw(latest?.waveform ?? []); // v65：全屏同样下采样，防 bitmap 过大崩溃
  const fullW = Math.max(320, zoomWave.length * PX_PER_SAMPLE);
  const a: EcgAnalysis | undefined = latest?.analysis;

  // 医学指标（参考区间中性描述）
  const metrics: { label: string; value: string; unit: string; refText: string; status?: Status }[] = [
    // ★ 2026-11-06 审查（docs/audit/03 🔴#4）：快照恢复的旧 ecg 对象可能缺字段
    //   （aveQT / avePWV 是后加的）→ Math.round(undefined) = NaN 会直接显示给用户。
    //   一律走 fmtEcgNum：无有效值显示 '—'；status 无值时为 undefined（走中性样式）。
    { label: '平均心率', value: fmtEcgNum(latest?.aveHeart), unit: 'bpm', refText: '60–100', status: ecgStatus(latest?.aveHeart, 60, 100) as 'high' | 'low' | 'normal' | undefined },
    { label: 'HRV', value: fmtEcgNum(latest?.aveHrv), unit: 'ms', refText: '通常 20–100' },
    { label: 'SDNN', value: a?.sdnn != null ? `${Math.round(a.sdnn)}` : '—', unit: 'ms', refText: '102–180', status: a?.sdnn != null ? (a.sdnn > 180 ? 'high' : a.sdnn < 102 ? 'low' : 'normal') : undefined },
    { label: 'RMSSD', value: a?.rmssd != null ? `${Math.round(a.rmssd)}` : '—', unit: 'ms', refText: '15–39', status: a?.rmssd != null ? (a.rmssd > 39 ? 'high' : a.rmssd < 15 ? 'low' : 'normal') : undefined },
    { label: 'QTc', value: a?.qtc != null ? `${Math.round(a.qtc)}` : '—', unit: 'ms', refText: '女 <460', status: a?.qtc != null ? (a.qtc > 460 ? 'high' : 'normal') : undefined },
    { label: 'QRS 时限', value: a?.qrsTime != null ? `${Math.round(a.qrsTime)}` : '—', unit: 'ms', refText: '60–100', status: a?.qrsTime != null ? (a.qrsTime > 110 ? 'high' : 'normal') : undefined },
    { label: 'QRS 振幅', value: a?.qrsAmp != null ? `${(a.qrsAmp / 100).toFixed(2)}` : '—', unit: 'mV', refText: '0.5–1.5', status: a?.qrsAmp != null ? (a.qrsAmp / 100 > 1.5 ? 'high' : a.qrsAmp / 100 < 0.5 ? 'low' : 'normal') : undefined },
    { label: 'ST 段', value: a?.stMeanAmp != null ? `${(a.stMeanAmp / 100).toFixed(2)}` : '—', unit: 'mV', refText: '−0.05–0.10', status: a?.stMeanAmp != null ? (Math.abs(a.stMeanAmp / 100) > 0.1 ? 'high' : 'normal') : undefined },
    { label: 'PWV', value: a?.pwvMeanVal != null ? `${(a.pwvMeanVal / 10).toFixed(1)}` : '—', unit: 'm/s', refText: '6–20', status: a?.pwvMeanVal != null ? (a.pwvMeanVal / 10 > 15 ? 'high' : 'normal') : undefined },
  ];

  // ★ 2026-11-18：风险项来自设备多诊断报告；本机未回传时不能显示 0（=误导成"正常"）。
  //   hasRiskReport=false 时整个"风险分析"改为明确的"本次未获取"空态，不画塌缩雷达图。
  const riskVals: (number | undefined)[] = [
    a?.arrhythmiaRisk, a?.stressIndex, a?.fatigueIndex,
    a?.myocarditisRisk, a?.chdRisk, a?.angiosclerosisRisk,
  ];
  const riskLabels = ['心律失常', '精神压力', '疲劳', '心肌炎', '冠心病', '血管硬化'];
  const hasRiskReport = riskVals.some((v) => typeof v === 'number' && v > 0);
  const risks: { label: string; value: number }[] = riskLabels.map((label, i) => ({
    label, value: riskVals[i] ?? 0,
  }));

  // ★ 2026-11-06 审查（docs/audit/03 🔴#3）：整页早退门禁 ——
  //   基础版（无 ECG 传感器）不应该看到「HK18 ECG 硬件 + 开始心电图测量」的完整界面，
  //   那等于把「不支持」说成了「支持」。这里直接给出明确说明并给出返回路径。
  if (!ecgSupported) {
    return (
      <View style={{ flex: 1 }}>
        <BgGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
          locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
        <ScreenContainer compactTop topFadeColor={theme.colors.bgTop}>
          <View style={styles.head}>
            <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
              <Text style={{ fontSize: theme.fontSize.lg }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>心电图</Text>
              <Text style={styles.sub}>当前设备不支持 ECG 测量</Text>
            </View>
          </View>
          <View style={{ alignItems: 'center', paddingVertical: theme.sp(16), paddingHorizontal: theme.space.screen }}>
            <Text style={{
              fontSize: theme.fontSize.body,
              color: theme.colors.textSub,
              textAlign: 'center',
              lineHeight: theme.fontSize.body * 1.7,
            }}>
              当前这枚戒指没有心电传感器，无法进行心电图测量。
            </Text>
          </View>
        </ScreenContainer>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <BgGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
      <ScreenContainer compactTop topFadeColor={theme.colors.bgTop}>
        <View style={styles.head}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Text style={{ fontSize: theme.fontSize.lg }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>心电图</Text>
            {/* ★ 2026-11-06 审查（docs/audit/03 🔴#3）：副标题不得写死机型名。
                基础版连接成功后也会显示「HK18 ECG 硬件」—— 属于把「不支持」说成了「支持」。 */}
            <Text style={styles.sub}>
              {!ecgSupported
                ? '当前设备不支持 ECG 测量'
                : ring.status === 'connected'
                  ? (dmModel.id === 'PRO_UI' ? 'HK18 ECG 硬件' : 'ECG 硬件')
                  : '连接戒指后测量'}
            </Text>
          </View>
        </View>

        {/* 最新一次：心电图（不压缩 · 横向滚动看全部） */}
        {latest ? (
          <View style={styles.latestBox}>
            <View style={styles.latestTop}>
              <Text style={styles.latestTime}>最新一次 · {fmtDateTime(latest.ts)}</Text>
              <Text style={styles.scaleTag}>不压缩 · 左右滑动</Text>
            </View>
            <EcgScrollTrace waveform={latest.waveform} height={150} onTap={() => setZoom(true)} />
            <TouchableOpacity style={styles.zoomBtn} activeOpacity={0.7} onPress={() => setZoom(true)}>
              <Text style={styles.zoomBtnText}>⤢ 全屏查看完整波形</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* 测量过程中：实时波形（不压缩 · 随采集滚动） */}
        {measuring ? (
          <View style={styles.liveBox}>
            <View style={styles.latestTop}>
              <Text style={styles.latestTime}>测量中实时波形</Text>
              <Text style={styles.scaleTag}>{liveWave && liveWave.length > 4 ? '采集中 · 滚动查看' : '正在启动…'}</Text>
            </View>
            {liveWave && liveWave.length > 4 ? (
              <EcgScrollTrace waveform={liveWave} height={120} color={mm.colors.ecgRed} />
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>正在采集波形，请用另一只手食指轻触戒指外侧金属电极闭合回路…</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* ★ 2026-10-29：ECG 前置引导——单导联需闭合回路：戴好戒指 + 用另一只手食指轻触外侧电极 */}
        {!measuring ? (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: theme.radius.md, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12 }}>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textWhite, lineHeight: 18 }}>
              测量方法：戴好戒指，用另一只手食指轻触戒指外侧金属电极，闭合回路后才会开始出图（单导联心电）。
            </Text>
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

        {/* ★ 2026-10-16：ECG 最近失败原因常驻显示（导联脱落/设备忙/无效读数/超时） */}
        {ring.ecgError ? (
          <View style={styles.ecgErrBox}>
            <Text style={styles.ecgErrText}>{ring.ecgError}</Text>
            {/(导联|脱落|接触|回路)/.test(ring.ecgError) ? (
              <Text style={[styles.ecgErrText, { marginTop: 6, color: theme.colors.textWhite, opacity: 0.85 }]}>
                提示：单导联 ECG 需要闭合回路——戴好戒指后，用另一只手食指轻触戒指外侧金属电极再点测量。
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* 分段：医学指标 / 风险分析 */}
        {latest?.analysis ? (
          <>
            {/* ★ 2026-11-03（用户·统一 hero 结构）：心电无单一大数字 hero，这里加短解读摘要 */}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: theme.radius.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 }}>
              <Text style={{ fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.textWhite, marginBottom: 4 }}>心电解读</Text>
              <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textWhite, opacity: 0.85, lineHeight: 18 }}>
                {(() => {
                  // ★ 2026-11-06 审查（docs/audit/03 🔴#4）：无有效值时不说「平均心率 0 bpm」。
                  const hrTxt = fmtEcgNum(latest?.aveHeart);
                  const hrvTxt = fmtEcgNum(latest?.aveHrv);
                  const highs = risks.filter((r) => r.value >= 60).map((r) => r.label);
                  const base = hrTxt === '—' && hrvTxt === '—'
                    ? '本次测量缺少心率与 HRV 数值'
                    : `本次平均心率 ${hrTxt} bpm，HRV ${hrvTxt} ms`;
                  if (highs.length) return `${base}；有 ${highs.length} 项风险指标偏高（${highs.join('、')}），建议关注并咨询医生。`;
                  // ★ 无诊断报告时不说"各项在参考范围内"（那是把"没数据"说成"正常"）
                  // ★ 2026-11-19(v62)：SDNN/RMSSD 已由 RR 间期本地补算，解读文案同步更新
                  if (!hasRiskReport) {
                    const local = a?.sdnn != null || a?.rmssd != null;
                    return local
                      ? `${base}。SDNN/RMSSD 由本次 RR 间期本地计算；设备诊断报告仅在检出异常时回传，正常读数不包含，属协议设计。数据仅作健康参考，不构成诊断。`
                      : `${base}。设备本次未返回诊断分析数据。数据仅作健康参考，不构成诊断。`;
                  }
                  return `${base}，各项指标在参考范围内。数据仅作健康参考，不构成诊断。`;
                })()}
              </Text>
            </View>
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
            ) : hasRiskReport ? (
              <View style={styles.riskBox}>
                <RiskRadar data={risks} />
                <Text style={styles.riskHint}>数值为设备评估参考（0–99，越靠外强度越高）；较低/中等/较高仅描述强度区间，不构成诊断</Text>
                <View style={{ marginTop: 4 }}>
                  {risks.map((r) => (<RiskBar key={r.label} {...r} />))}
                </View>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>本次测量设备未返回诊断分析数据，风险项暂不可用。可重新测量获取；如多次如此，可能是当前戒指固件未开放该报告。</Text>
              </View>
            )}

            <Text style={styles.disclaimer}>
              {a?.sdnnSource === 'rr-local' || a?.rmssdSource === 'rr-local'
                ? 'SDNN/RMSSD 由本次测量的 RR 间期序列本地计算；其余医学指标与风险分析来自戒指硬件评估（设备仅在检出异常时回传诊断报告，正常读数不含这些字段，显示"—"属预期）。仅作健康参考，不构成医疗诊断建议。'
                : '以上数据来自戒指硬件评估，仅作健康参考，不构成医疗诊断建议。如有不适请咨询专业医生。'}
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
                  <Text style={styles.hStat}>心率 <Text style={styles.hStatVal}>{fmtEcgNum(r.aveHeart)}</Text> bpm</Text>
                  <Text style={styles.hStat}>HRV <Text style={styles.hStatVal}>{fmtEcgNum(r.aveHrv)}</Text> ms</Text>
                  <Text style={styles.hStat}>呼吸 <Text style={styles.hStatVal}>{fmtEcgNum(r.aveResRate)}</Text>{r.rrSource === 'estimated' ? ' 次/分·波形估算' : ''}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ★ 2026-11-03（用户）：测量弹出「食指按戒指」引导动画浮层 —— 动画示意 + 底部进度条 + 实时心电图；
            失败时浮层停留展示原因，成功自动收起并回填最新读数 */}
        <EcgMeasureSheet
          visible={measuring}
          progress={ring.ecgProgress?.progress ?? 0}
          hr={ring.ecgProgress?.hr ?? null}
          liveWaveform={liveWave}
          error={ring.ecgError}
          hint={ring.ecgHint}
          onCancel={stopEcg}
        />

        {/* 全屏放大查看：完整波形，不压缩，横向滚动 */}
        <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
          <View style={styles.zoomMask}>
            <View style={styles.zoomBar}>
              <Text style={styles.zoomTitle}>心电图 · 完整波形</Text>
              <TouchableOpacity onPress={() => setZoom(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.zoomClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {latest ? (
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingVertical: 10 }}>
                <Svg width={fullW} height={zoomH} viewBox={`0 0 ${fullW} ${zoomH}`}>
                  <EcgGrid W={fullW} H={zoomH} />
                  {zoomWave.length > 4 ? (
                    <Path d={wavePath(zoomWave, fullW, zoomH)} fill="none" stroke={mm.colors.ecgRed} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  ) : null}
                </Svg>
              </ScrollView>
            ) : (
              <View style={styles.emptyBox}><Text style={styles.emptyText}>暂无波形数据</Text></View>
            )}
            <Text style={styles.zoomHint}>← 左右滑动查看全部 · 波形不压缩 →</Text>
          </View>
        </Modal>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 12 },
  back: { width: 36, height: 36, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ui.white70, marginRight: 8 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 2 },

  latestBox: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },
  latestTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  latestTime: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  scaleTag: { fontSize: theme.fontSize.tiny, color: mm.colors.ecgRed, fontWeight: '600' },

  liveBox: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 14,
    marginBottom: 12,
  },

  ecgErrBox: {
    marginTop: 10,
    paddingVertical: theme.sp(1.5),
    paddingHorizontal: theme.sp(2),
    backgroundColor: theme.colors.dangerSoft,
    borderRadius: theme.radius.sm,
  },
  ecgErrText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.danger,
    lineHeight: 18,
  },

  zoomBtn: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(229,80,138,0.1)',
  },
  zoomBtnText: { fontSize: theme.fontSize.xs, fontWeight: '600', color: mm.colors.ecgRed },

  zoomMask: {
    flex: 1,
    backgroundColor: 'rgba(20,14,18,0.92)',
    paddingTop: 48,
    paddingBottom: 32,
  },
  zoomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.screen,
    marginBottom: 12,
  },
  zoomTitle: { fontSize: theme.fontSize.body, fontWeight: '600', color: theme.colors.textWhite },
  zoomClose: { fontSize: theme.fontSize.h2, color: theme.colors.textWhite, fontWeight: '500' },
  zoomHint: { fontSize: theme.fontSize.micro, color: theme.colors.ui.white65, textAlign: 'center', marginTop: 8 },

  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.ecgRed,
    marginBottom: 16,
  },
  btnLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textWhite },

  // ★ mira-ocean（2026-10-17）：淡紫轨道 → 玻璃白
  segment: { flexDirection: 'row', backgroundColor: theme.colors.ui.white10, borderRadius: theme.radius.md, padding: 4, marginBottom: 12 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: theme.radius.sm },
  segBtnOn: { backgroundColor: theme.colors.textWhite, shadowColor: theme.colors.ui.shadowBlack, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segTxt: { fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.textSub },
  // ★ mira-ocean：白 pill 上选中文字 → 深蓝（原 textTitle 已随主题变白，白底白字）
  segTxtOn: { color: theme.colors.bgMid },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCell: {
    width: '31%',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
  },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: '700', color: theme.colors.textTitle, marginVertical: 3 },
  metricUnit: { fontSize: theme.fontSize.tiny, fontWeight: '500', color: theme.colors.textSub },
  metricRef: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub },
  dot: { width: 7, height: 7, borderRadius: 4 },

  riskBox: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: 14, marginBottom: 12 },
  riskHint: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, textAlign: 'center', marginTop: 4, marginBottom: 10 },
  riskRow: { marginBottom: 12 },
  riskHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  riskLabel: { fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.textTitle },
  riskHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskLevelTag: { fontSize: theme.fontSize.tiny, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  riskValue: { fontSize: theme.fontSize.xs, fontWeight: '700' },
  riskTrack: { height: 7, backgroundColor: 'rgba(157,138,240,0.14)', borderRadius: 4, overflow: 'hidden' },
  riskFill: { height: '100%', borderRadius: 4 },

  disclaimer: { fontSize: theme.fontSize.tiny, color: theme.colors.textSub, lineHeight: 15, marginVertical: 10 },

  sectionTitle: { fontSize: theme.fontSize.body, fontWeight: '600', color: theme.colors.textTitle, marginBottom: 8, marginTop: 4 },
  historyItem: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
    marginBottom: 8,
  },
  hTime: { fontSize: theme.fontSize.xs, color: theme.colors.textInk, fontWeight: '600' },
  hRel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hStat: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  hStatVal: { fontSize: theme.fontSize.xs, fontWeight: '700', color: theme.colors.textTitle },

  emptyBox: { alignItems: 'center', paddingVertical: 22 },
  emptyText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, textAlign: 'center' },
});
