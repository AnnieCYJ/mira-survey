/**
 * QuickCheckTab —— 洞察页「身体指标」下的「一键体检」子 tab（概览卡，方案 B 清单式）
 * ---------------------------------------------------------------------------
 * 只展示「最近一次体检」的简短概览：
 *   · 最近一次体检时间
 *   · 正常 X 项 / 异常 Y 项 两个大数字
 *   · 异常项清单（无异常则显示「未见异常」）
 *   · 「查看全部 N 次体检记录 →」跳转独立全屏页 QuickCheckHistory
 *   · 「开始一键体检」按钮：按机型能力 + 当前戒指真实回读组装一次体检并落库
 *
 * 数据：quickCheckStore（无演示数据；从未体检过则为空状态，触发后才出现真实记录）。
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, Animated, Easing, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { useDeviceModel, hasCap } from '../config/deviceModel';
import Card from './Card';
import {
  getLatestQuickCheck,
  countQuickChecks,
  abnormalMetrics,
  tallyRecord,
  runQuickCheckSession,
  isDefinitelyNotWorn,
  type QuickCheckRecord,
} from '../data/quickCheckStore';
import { qc, statusColor, statusLabel, QCta } from './quickCheckShared';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
// ★ 一键体检等待浮层文案由 runQuickCheckSession 的 onPhase 阶段回调实时驱动（见 startCheck）

export default function QuickCheckTab() {
  const navigation = useNavigation<any>();
  const { model: profile } = useDeviceModel();
  // ★ 2026-11-13（用户）：报告按「现场测得 / 今天已同步 / 最近记录推算 / 档案推算」分层。
  //   首次没有历史时，后两层天然为空，报告自动只剩现场测得 + 当场算出的项。
  //   交感神经活跃度（SNS）依赖 EDA/皮电，基础版硬件不支持，无真实数据，不出现在报告中。
  //   旧实现读 healthStore 遗留的血压/血糖/尿酸/皮肤/情绪/皮质醇，属 HK18 数据混显，已移除。
  const canBp = hasCap(profile, 'bp');
  const canGlucose = hasCap(profile, 'glucose');
  const canEc = hasCap(profile, 'ecg');
  const canBloodComp = hasCap(profile, 'bloodComponents') || hasCap(profile, 'cholesterol');
  const canGlance = hasCap(profile, 'cortisol');
  const checkupMetrics = [
    '今日状态', '心率', '心率变异性', '血氧', '体温',
    '活动', '睡眠', '血脂', '压力', '身体成分',
    ...(canBp ? ['血压'] : []),
    ...(canGlucose ? ['血糖'] : []),
    ...(canEc ? ['心电'] : []),
    ...(canGlance ? ['健康一览信号'] : []),
  ];
  // ★ 2026-11-14（用户拍板「血压不出值自动重试」）：等待文案改为**阶段驱动** ——
  //   runQuickCheckSession 每进入一个真实阶段回调 onPhase，浮层文案跟着切；
  //   不再按总时长均分猜测（血压可能重试一轮，均分计时必然错位）。
  const PHASE_STEPS: Record<string, string> = {
    hr: '正在现场测量心率，请保持手指静止…',
    bp: '正在测量血压，请保持手部放松、与心脏同高，不要说话…',
    'bp-retry': '血压信号还没采够，正在再测一次，请保持手不动…',
    hrv: '正在测量心率变异性…',
    spo2: '正在读取血氧与今天已同步的读数…',
    ecg: '正在测量心电，请用另一只手食指轻触戒指外侧电极、保持静止…',
    glucose: '正在测量血糖，请保持戒指佩戴、手指放松…',
    bloodcomp: '正在测量血液成分（尿酸/血脂），请保持戒指佩戴、手指放松…',
    assemble: '正在汇总数据并生成体检报告…',
  };
  // ★ 2026-11-17（用户：体检到底多长时间、一直没显示）：浮层显示「第 N/M 步 · 已用 Xs」。
  //   步骤随机型能力增减（血压/心电/血糖仅支持的机型才有），血压重试归入同一"血压"步。
  const STEP_ORDER = [
    'hr',
    ...(canBp ? ['bp'] : []),
    'hrv',
    'spo2',
    ...(canEc ? ['ecg'] : []),
    ...(canGlucose ? ['glucose'] : []),
    ...(canBloodComp ? ['bloodcomp'] : []),
    'assemble',
  ];
  // ★ 2026-11-18（用户：不知道要等多久）：每步「典型耗时」→ 整体进度百分比 + 预计剩余时间。
  //   取真机实测典型值（不是超时上限）：心率固定 21s；血压典型 40s（出值即提前结束）；
  //   HRV 10s；血氧 10s；心电固件实测 ~90s 进度走到 100% 出值（18:05 真机轮实锤支持，取 90s，
  //   出值即提前结束）；血糖实测 ~15s 出值取 20s；血液成分 30-60s 取 55s；汇总 3s。
  //   完整档 PRO_UI 合计 ≈249s（约 4 分钟）；快检档序列（ecg/glucose/assemble）预算 ≈113s（1-2 分钟，
  //   ★ 心电第 0 秒启动占 90s 固件计时，血糖仅当日无值才现场补测）；血压重试运行时 +40s；完整档最坏 ≈5 分钟。
  const STEP_EXPECTED_SEC: Record<string, number> = {
    hr: 21, bp: 40, 'bp-retry': 40, hrv: 10, spo2: 10,
    ecg: 90, glucose: 20, bloodcomp: 55, assemble: 3,
  };
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  // ★ 2026-11-18（用户：不知道要等多久）：整体进度 0-100% 与预计剩余秒数（浮层进度条）。
  const [qcProgress, setQcProgress] = useState(0);
  const [qcRemain, setQcRemain] = useState(0);
  // 进度核算 refs：phaseStart=当前阶段开始时刻；completedElapsed=已完成阶段实际耗时之和；
  // plannedTotal=全流程预算 ms（bp-retry 运行时追加）；phaseKey=当前阶段 key（查典型耗时用）。
  const phaseStartRef = useRef(0);
  const completedElapsedRef = useRef(0);
  const plannedTotalRef = useRef(0);
  const phaseKeyRef = useRef('hr');
  const [latest, setLatest] = useState<QuickCheckRecord | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  // ★ 2026-11-18(2)：双档位——fast 快检（1-2 分钟，心电第 0 秒启动，其余走当日同步值）/ full 完整体检（3-5 分钟）。
  const [qcSteps, setQcSteps] = useState<string[]>(STEP_ORDER);
  const stepOrderRef = useRef<string[]>(STEP_ORDER);
  const [phaseText, setPhaseText] = useState('正在现场测量心率，请保持手指静止…');
  // ★ 2026-11-16：摘下戒指点体检 → 浮层显示「未佩戴」提示（不启动真实测量、不造数据）
  const [notWorn, setNotWorn] = useState(false);

  const reload = async () => {
    const [last, c] = await Promise.all([getLatestQuickCheck(), countQuickChecks()]);
    setLatest(last);
    setCount(c);
  };

  useEffect(() => {
    (async () => { await reload(); })();
  }, []);

  // ★ 2026-11-17：体检进行中每秒累计用时（纯展示，让浮层显示已等待时长）。未佩戴提示态不计时。
  // ★ 2026-11-18：同一计时器顺带算整体进度 =（已完成阶段实际耗时 + 当前阶段已用/典型耗时封顶）
  //   ÷ 全流程预算；到 99% 封顶（不谎报 100，出值跳转瞬间由 finish 分支置 100）。
  useEffect(() => {
    if (!checking || notWorn) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      setElapsedSec(Math.floor((now - t0) / 1000));
      const curExpected = (STEP_EXPECTED_SEC[phaseKeyRef.current] ?? 10) * 1000;
      const done = completedElapsedRef.current + Math.min(now - phaseStartRef.current, curExpected);
      const total = Math.max(1, plannedTotalRef.current);
      setQcProgress(Math.min(99, Math.floor((done / total) * 100)));
      setQcRemain(Math.max(0, Math.round((total - done) / 1000)));
    }, 1000);
    return () => { clearInterval(iv); setElapsedSec(0); };
  }, [checking, notWorn]);

  const latestTally = latest ? tallyRecord(latest) : { done: 0, abnormal: 0 };
  const latestAbnormal = latest ? abnormalMetrics(latest) : [];

  const startCheck = async (mode: 'fast' | 'full' = 'fast') => {
    if (busy) return;

    // ★ 2026-11-18(10)（用户：摘了戒指就几秒弹未佩戴，不要跑满 90 秒）：
    //   原生看门狗已判脱手 + 贴肤帧静默 → 入口直接弹框，不启动任何测量、不出现等待浮层。
    //   双判据任一存疑（worn=null / 帧还在到）都不拦，保持"直接放行"策略，绝不误拒戴戒用户。
    if (isDefinitelyNotWorn()) {
      Alert.alert(
        '未佩戴戒指',
        '这次没有读到戒指数据，请先戴上戒指、让电极贴住皮肤，再开始一键体检。',
        [{ text: '知道了' }]
      );
      return;
    }

    // ★ 2026-11-16（用户：摘了戒指点一键体检，应在动画中间展示「未佩戴，需要佩戴才能测量」）：
    //   原生已判定摘下（worn=false）时，打开浮层但切到未佩戴提示态，不发起任何真实测量命令
    //   （摘下时测心率/血压只会拿到接触性脏值）。停留数秒后自动关闭，用户戴上再点即可。
    //   ★ 2026-11-18（快检误报未佩戴修复）：worn 是推断值、有滞后——真机实锤戴着戒指但血氧读数
    //   短时=0 时被看门狗判成脱手。复核：最近 15s 内仍有原生实时生理帧到达 → 戒指还在传数据、
    //   物理上戴着，放行测量；只有「worn=false 且近期确实无任何帧」才认定真摘下、提示未佩戴。
    // ★ 2026-11-18(5)（用户拍板「直接放行，测量失败再提示」）：取消基于 worn 的前置拦截。
    //   worn 是靠血氧流推断的状态，戒指戴着但在读数=0 / PPG 让出 / 测量恢复期会被误判脱手，
    //   导致点快检被拒。现在一律直接测量；真没戴时测量会失败，走下方 res.ok=false 的
    //   「暂时没有可用数据，请保持佩戴」提示——既不误拒，也不静默给脏数据。
    //   佩戴状态不再作为体检入口的门禁。

    // ★ 2026-11-18(2)：快检流程=心电第 0 秒启动 + 血糖(当日无值才补测) + 汇总；
    //   心率/血压/血氧/血液成分走当日已同步值，不占现场步骤（用户：这些历史都有）。
    // ★ 2026-11-18(3)（用户「完整体检为什么还要 3-5 分钟」）：完整档重排=心电第 0 秒启动
    //   + 只补测当日缺失项（血压/血液成分/血糖，有当日值直接跳过）+ 汇总，典型 ≈2-3 分钟。
    const order = mode === 'fast'
      ? [...(canEc ? ['ecg'] : []), ...(canGlucose ? ['glucose'] : []), 'assemble']
      : [...(canEc ? ['ecg'] : []), 'bp', ...(canBloodComp ? ['bloodcomp'] : []), ...(canGlucose ? ['glucose'] : []), 'assemble'];
    stepOrderRef.current = order;
    setQcSteps(order);

    setBusy(true);
    setChecking(true);
    setNotWorn(false);
    setPhaseText(PHASE_STEPS.hr);
    // ★ 2026-11-18：重置整体进度核算（预算 = 本档位各步典型耗时之和）
    completedElapsedRef.current = 0;
    phaseStartRef.current = Date.now();
    phaseKeyRef.current = 'hr';
    plannedTotalRef.current = order.reduce((s, k) => s + (STEP_EXPECTED_SEC[k] ?? 0), 0) * 1000;
    setQcProgress(0);
    setQcRemain(Math.round(plannedTotalRef.current / 1000));

    // ★ 2026-11-13（用户）：这个窗口里**真的发起测量**，不是干等。
    //   现场测量 + 等待 + 组装报告统一在 runQuickCheckSession() 里，两个入口共用同一口径：
    //   · hr   → 原生 startSingleHeartDetect()，前 20 秒独占 PPG 通道，读数回流到 state.metrics.hr
    //   · bp   → 2026-11-14 新增：startDetectBP 主动测量，≤45s 没出值自动再测一轮，
    //            阶段结束无论成败都 stopMeasure('bp') 归还 PPG
    //   · hrv  → 2026-11-14 新增：startDetectHrv 主动测量（固件支持 App 主动测时才有读数）
    //   · spo2 → 前面测量结束后才起 startSpo2hOnly() 连续流（PPG 不能并行），回传血氧
    //   报告里其它项目取今天已同步的读数或最近记录推算，各自标明来源，不冒充现场测量。

    // 每进入一个真实阶段回调一次，浮层文案实时跟随（血压重试时文案会切到「再测一次」）
    try {
      const res = await runQuickCheckSession({ mode,
        onPhase: (p) => {
          setPhaseText(PHASE_STEPS[p] ?? PHASE_STEPS.hr);
          // ★ 2026-11-18：阶段切换 → 结算上一阶段实际耗时（进度按真实推进走，
          //   血压提前出值时进度条会明显前跳），bp-retry 运行时把预算 +40s。
          const now = Date.now();
          completedElapsedRef.current += now - phaseStartRef.current;
          phaseStartRef.current = now;
          phaseKeyRef.current = p;
          if (p === 'bp-retry') plannedTotalRef.current += (STEP_EXPECTED_SEC['bp-retry'] ?? 0) * 1000;
          const key = p === 'bp-retry' ? 'bp' : p; // 重试不额外占一步
          const idx = stepOrderRef.current.indexOf(key);
          if (idx >= 0) setStepIdx(idx + 1);
        },
      });
      // ★ 2026-11-18：会话结束（无论成败）→ 进度定格 100%，浮层随即关闭
      setQcProgress(100);
      if (res.ok && res.record) {
        await reload();
        // ★ 成功不再弹 Alert，直接跳本次体检的详情页
        navigation.navigate('QuickCheckDetail', { recordId: res.record.id });
      } else if (res.reason === 'not-worn') {
        // ★ 2026-11-18(7)（用户：真没戴就弹「未佩戴」）：本次窗口内没读到任何戒指数据 →
        //   明确提示未佩戴，不再拿当日历史值拼一份假报告。
        Alert.alert(
          '未佩戴戒指',
          '这次没有读到戒指数据，请先戴上戒指、让电极贴住皮肤，再开始一键体检。',
          [{ text: '知道了' }]
        );
      } else {
        Alert.alert(
          '暂时没有可用数据',
          '这次还没读到戒指数据。请确认戒指已连接、并且正戴在手上（测量需要佩戴），保持静止一会儿再试一次。',
          [{ text: '知道了' }]
        );
      }
    } catch {
      Alert.alert('体检未完成', '读取测量数据时出了问题，请稍后再试。', [{ text: '知道了' }]);
    } finally {
      setChecking(false);
      setBusy(false);
    }
  };

  // ★ 空状态：从未体检过 → 引导用户触发一次真实体检
  if (count === 0 && !busy) {
    return (
      <>
        <View>
          <Card style={qc.overviewCard}>
            <Text style={qc.label}>一键体检</Text>
            <View style={{ alignItems: 'center', paddingVertical: theme.sp(4) }}>
              <Text style={[qc.abEmpty, { textAlign: 'center', fontSize: theme.fontSize.sm, lineHeight: 22 }]}>
                还没有体检记录。{'\n'}点下面按钮，现场测量心率与血氧，并算出今天的「今日状态」和「身心压力」。戴久一点，报告里会逐步加入睡眠、血压与节律。
              </Text>
            </View>
            {/* ★ 2026-11-18(6)（用户）：只保留一个「一键体检」按钮，去掉完整体检次按钮。 */}
            <QCta title={busy ? '体检中…' : '一键体检'} onPress={() => startCheck('fast')} disabled={busy} />
          </Card>
        </View>
        <CheckWaitOverlay visible={checking} step={phaseText} notWorn={notWorn} stepIdx={stepIdx} totalSteps={qcSteps.length} elapsedSec={elapsedSec} qcProgress={qcProgress} qcRemain={qcRemain} />
      </>
    );
  }

  // ★ 2026-11-14（用户）：「最近一次体检的分析」要说清三件事 ——
  //   共测了多少项、哪几项偏离参考区间（带数值）、这类偏离通常意味着什么。
  const abnormalDesc = latestAbnormal
    .map((m) => `${m.name} ${m.value}${m.unit || ''}（${statusLabel(m)}）`)
    .join('、');
  const aiSummary = latestAbnormal.length
    ? `本次体检共完成 ${latestTally.done} 项，其中 ${latestTally.abnormal} 项偏离参考区间：${abnormalDesc}。单项偏离多与当下状态有关，比如刚活动过、情绪紧张或测量姿势不同；安静 5 分钟后复测一次，再对照近几天的趋势，比看单次数值更有意义。Mira 只描述不诊断。`
    : `本次体检共完成 ${latestTally.done} 项，全部落在参考区间内，未见异常，说明当下身体状态平稳。保持当前作息与运动节奏即可。Mira 只描述不诊断。`;

  return (
    <>
      <View>
        <Card style={qc.overviewCard}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('QuickCheckHistory')}>
            <View style={qc.overviewHead}>
              <Text style={qc.label}>最近一次体检</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={qc.label}>{latest ? fmtDateLocal(latest.createdAt) : '—'}</Text>
                <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.card }}>›</Text>
              </View>
            </View>
          </TouchableOpacity>
            <View style={qc.bigStatRow}>
              <View style={[qc.bigStat, { borderColor: theme.colors.success + '55' }]}>
                <Text style={[qc.bigStatNum, { color: theme.colors.success }]}>{latestTally.done - latestTally.abnormal}</Text>
                <Text style={qc.bigStatKey}>项正常</Text>
              </View>
              <View style={[qc.bigStat, { borderColor: latestTally.abnormal ? theme.colors.warn + '55' : theme.colors.success + '55' }]}>
                <Text style={[qc.bigStatNum, { color: latestTally.abnormal ? theme.colors.warn : theme.colors.success }]}>{latestTally.abnormal}</Text>
                <Text style={qc.bigStatKey}>项异常</Text>
              </View>
            </View>
            {latestAbnormal.length ? (
              <View style={qc.abList}>
                {latestAbnormal.map((m) => (
                  <View key={m.key} style={qc.abItem}>
                    <Text style={qc.metricName}>{m.name}</Text>
                    <Text style={[qc.metricStatus, { color: statusColor(m) }]}>{statusLabel(m)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={qc.abEmpty}>本次完成 {latestTally.done} 项检测，未见异常。</Text>
            )}
            {/* ★ 本轮（用户）：两个大数字卡下方加一段 AI 分析（异常项 / 其余正常，结合节律语境） */}
            <AiAnalysis compact>
              <AiResultRow compact tone={latestTally.abnormal ? 'warn' : 'good'} bodyColor={theme.colors.textBody}>
                {aiSummary}
              </AiResultRow>
            </AiAnalysis>
          {/* ★ 2026-11-18(6)（用户）：只保留一个「一键体检」按钮，去掉完整体检次按钮。 */}
          <View style={qc.ctaInside}>
            <QCta title={busy ? '体检中…' : '一键体检'} onPress={() => startCheck('fast')} disabled={busy} />
          </View>
        </Card>
        {/* ★ 2026-11-14（用户）：「没有读到数据的项目不会出现在报告里」这句去掉 */}
        <Text style={qc.footerNote}>
          参考区间仅供参考，Mira 不做诊断与评分。点击卡片可查看全部体检记录。
        </Text>
      </View>
      <CheckWaitOverlay visible={checking} step={phaseText} notWorn={notWorn} stepIdx={stepIdx} totalSteps={qcSteps.length} elapsedSec={elapsedSec} qcProgress={qcProgress} qcRemain={qcRemain} />
    </>
  );
}

/**
 * ★ 2026-11-03（用户）：一键体检等待动画浮层。
 * 呼吸脉冲双环 + 🫀 核心图标 + 分步文案轮播；深色 backdrop 盖住洞察页，
 * 玻璃卡走 theme token（cardBg / cardBorder），与深海主题一致。
 */
function CheckWaitOverlay({ visible, step, notWorn = false, stepIdx = 0, totalSteps = 0, elapsedSec = 0, qcProgress = 0, qcRemain = 0 }: {
  visible: boolean; step: string; notWorn?: boolean; stepIdx?: number; totalSteps?: number; elapsedSec?: number; qcProgress?: number; qcRemain?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // ★ 2026-11-16：未佩戴提示态不跑测量脉冲动画（没有正在进行的测量）
    if (!visible || notWorn) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [visible, pulse]);

  const outerScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.18] });
  const outerOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });
  const midScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 0.95] });
  const midOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.45] });

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={ov.backdrop}>
        <View style={ov.box}>
          <View style={ov.ringWrap}>
            <Animated.View style={[ov.ringOuter, { transform: [{ scale: outerScale }], opacity: outerOpacity }]} />
            <Animated.View style={[ov.ringMid, { transform: [{ scale: midScale }], opacity: midOpacity }]} />
            <View style={ov.core}>
              {/* ★ 2026-11-16：未佩戴用💤手势提示，测量中用🫀 */}
              <Text style={ov.coreEmoji}>{notWorn ? '🚫' : '🫀'}</Text>
            </View>
          </View>
          {notWorn ? (
            <>
              <Text style={ov.stepText}>检测到你没有佩戴戒指</Text>
              <Text style={[ov.hint, ov.hintWarn]}>请先戴上戒指，再开始一键体检。{'\n'}需要佩戴才能测量心率、血压和血氧。</Text>
            </>
          ) : (
            <>
              <Text style={ov.stepText}>{step}</Text>
              {/* ★ 2026-11-18（用户：不知道要等多久）：整体进度条 + 百分比 + 预计剩余时间。
                  进度按每步典型耗时加权（阶段提前出值会前跳），99% 封顶、出值完成才到 100。 */}
              <View style={ov.barWrap}>
                <View style={[ov.barFill, { width: `${Math.max(3, qcProgress)}%` as any }]} />
              </View>
              <Text style={ov.progressLine}>
                {`${qcProgress}% · 预计还需约 ${qcRemain > 0 ? (qcRemain >= 60 ? `${Math.floor(qcRemain / 60)} 分 ${qcRemain % 60} 秒` : `${qcRemain} 秒`) : '1 分钟内'}`}
              </Text>
              {/* ★ 2026-11-17（用户：体检时间一直没显示）：客观展示当前步序与已用秒数 */}
              {totalSteps > 0 && (
                <Text style={ov.progressLine}>
                  {`第 ${Math.max(1, stepIdx)} / ${totalSteps} 步 · 已用 ${elapsedSec} 秒`}
                </Text>
              )}
              <Text style={ov.hint}>{'请保持戒指佩戴、手指放松；测血压时手与心脏同高、不要说话'}</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const ov = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,18,32,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 268,
    alignItems: 'center',
    // ★ 2026-11-09（用户：弹窗颜色还是不对，太浅看不清字）：
    //   上一版用 cardBgStrong = 白 16% 半透明，叠在 0.62 深色遮罩上几乎全透，
    //   背后的体检卡片（数字/雷达图/分析段）会穿透成重影；而 onGlassInk 是深墨色，
    //   压在暗底上对比度严重不足 → 字发灰看不清。
    //   修法：仍是用户要的「白玻璃磨砂」，但改成近实心浅底（白 97%），
    //   墨色字才真正落在浅底上（对比约 12:1），背景内容也被完全挡住。
    //   注意：不要用 theme.colors.cardBgStrong —— 那是深色主题里给白字卡片用的玻璃。
    backgroundColor: 'rgba(248,246,253,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(118,108,146,0.30)',
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(6),
    paddingHorizontal: theme.sp(5),
    shadowColor: '#000',
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  ringWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: theme.sp(4) },
  ringOuter: {
    position: 'absolute',
    width: 96, height: 96,
    borderRadius: 48,
    borderWidth: 2,
    // 浅底上用带透明度的墨色环，避免实色 #2E2A3A 两圈太压眼
    borderColor: 'rgba(46,42,58,0.55)',
  },
  ringMid: {
    position: 'absolute',
    width: 72, height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: 'rgba(46,42,58,0.32)',
  },
  core: {
    width: 52, height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(46,42,58,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(46,42,58,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreEmoji: { fontSize: theme.fontSize.orb },
  stepText: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold,
    lineHeight: 24,
    // 近实心浅底上必须用深墨字（onGlassInk），换成 textTitle 白字会再次不可读
    color: theme.colors.ui.onGlassInk,
    textAlign: 'center',
  },
  // ★ 2026-11-18：进度条样式（浅底上墨色描边槽 + 品牌墨色填充，宽随 qcProgress）
  barWrap: {
    width: 208,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(46,42,58,0.12)',
    overflow: 'hidden',
    marginTop: theme.sp(2),
  },
  barFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(46,42,58,0.78)',
  },
  progressLine: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    lineHeight: 18,
    color: 'rgba(74,70,96,0.92)',
    textAlign: 'center',
  },
  hint: {
    marginTop: theme.sp(2),
    fontSize: theme.fontSize.micro,
    lineHeight: 18,
    color: 'rgba(74,70,96,0.88)',
    textAlign: 'center',
  },
  // ★ 2026-11-16：未佩戴提示的强调文案（品牌墨色，不用刺眼红）
  hintWarn: {
    color: theme.colors.ui.onGlassInk,
    fontWeight: theme.weight.medium,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
  },
});

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
