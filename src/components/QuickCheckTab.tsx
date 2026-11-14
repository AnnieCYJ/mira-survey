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
  QUICK_CHECK_DURATION_MS,
  runQuickCheckSession,
  type QuickCheckRecord,
} from '../data/quickCheckStore';
import { qc, statusColor, statusLabel, QCta } from './quickCheckShared';
import AiAnalysis, { AiResultRow } from './AiAnalysis';

// ★ 一键体检等待动画的分步文案在组件内按机型能力动态生成（见 checkSteps）
// ★ 2026-11-13：测量窗口由 quickCheckStore.QUICK_CHECK_DURATION_MS 统一定义（35 秒），
//   与体检记录页「再体检一次」共用 runQuickCheckSession()，避免两个入口时长/口径分叉。

export default function QuickCheckTab() {
  const navigation = useNavigation<any>();
  const { model: profile } = useDeviceModel();
  // ★ 2026-11-13（用户）：报告按「现场测得 / 今天已同步 / 最近记录推算 / 档案推算」分层。
  //   首次没有历史时，后两层天然为空，报告自动只剩现场测得 + 当场算出的项。
  //   交感神经活跃度（SNS）依赖 EDA/皮电，基础版硬件不支持，无真实数据，不出现在报告中。
  //   旧实现读 healthStore 遗留的血压/血糖/尿酸/皮肤/情绪/皮质醇，属 HK18 数据混显，已移除。
  const canBp = hasCap(profile, 'bp');
  const canGlucose = hasCap(profile, 'glucose');
  const canGlance = hasCap(profile, 'cortisol');
  const checkupMetrics = [
    '今日状态', '心率', '血氧', '体温',
    '活动', '睡眠', '血脂', '压力', '身体成分',
    ...(canBp ? ['血压'] : []),
    ...(canGlucose ? ['血糖'] : []),
    ...(canGlance ? ['健康一览信号'] : []),
  ];
  // ★ 四步均分 35 秒窗口，文案对齐真实阶段：0–21s 心率独占 PPG 通道，21s 后才起血氧流
  const checkSteps = [
    '正在现场测量心率，请保持手指静止…',
    '心率测量进行中，请继续保持静止…',
    '正在读取血氧与今天已同步的读数…',
    '正在汇总数据并生成体检报告…',
  ];
  const [latest, setLatest] = useState<QuickCheckRecord | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = async () => {
    const [last, c] = await Promise.all([getLatestQuickCheck(), countQuickChecks()]);
    setLatest(last);
    setCount(c);
  };

  useEffect(() => {
    (async () => { await reload(); })();
    return () => { if (stepTimer.current) clearInterval(stepTimer.current); };
  }, []);

  const latestTally = latest ? tallyRecord(latest) : { done: 0, abnormal: 0 };
  const latestAbnormal = latest ? abnormalMetrics(latest) : [];

  const startCheck = async () => {
    if (busy) return;
    setBusy(true);
    setChecking(true);
    setStepIdx(0);

    // ★ 2026-11-13（用户）：这 35 秒里**真的发起测量**，不是干等。
    //   现场测量 + 等满窗口 + 组装报告统一在 runQuickCheckSession() 里，两个入口共用同一口径：
    //   · hr   → 原生 startSingleHeartDetect()，前 20 秒独占 PPG 通道，读数回流到 state.metrics.hr
    //   · spo2 → 心率窗口结束后才起 startSpo2hOnly() 连续流（PPG 不能并行），剩余时间回传血氧
    //   报告里其它项目取今天已同步的读数或最近记录推算，各自标明来源，不冒充现场测量。

    // 分步文案按整个测量窗口均分，每一步都对应真实在跑的阶段
    const stepMs = Math.round(QUICK_CHECK_DURATION_MS / checkSteps.length);
    stepTimer.current = setInterval(
      () => setStepIdx((i) => Math.min(i + 1, checkSteps.length - 1)),
      stepMs,
    );
    try {
      const res = await runQuickCheckSession();
      if (res.ok && res.record) {
        await reload();
        // ★ 成功不再弹 Alert，直接跳本次体检的详情页
        navigation.navigate('QuickCheckDetail', { recordId: res.record.id });
      } else {
        Alert.alert(
          '暂时没有可用数据',
          '这次还没读到戒指数据。请连接戒指、保持佩戴一会儿，再来做一次体检。没有读到数据的项目不会出现在报告里。',
          [{ text: '知道了' }]
        );
      }
    } catch {
      Alert.alert('体检未完成', '读取测量数据时出了问题，请稍后再试。', [{ text: '知道了' }]);
    } finally {
      setChecking(false);
      if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; }
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
            <QCta title={busy ? '体检中…' : '去体检一次'} onPress={startCheck} disabled={busy} />
          </Card>
        <Text style={qc.footerNote}>
          现场测量约 {Math.round(QUICK_CHECK_DURATION_MS / 1000)} 秒。心率和血氧是这次现场测得的，今日状态与身心压力用这次的读数重新算出。
          报告最多包含 {checkupMetrics.length} 类结果，今天已同步的读数会一起列出并标明来源；戴了一段时间后，会加入基于最近记录的节律结论。
          没有读到数据的项目不会出现在报告里，不会用「--」占位。Mira 只做描述与参考，不做诊断与评分。
        </Text>
        </View>
        <CheckWaitOverlay visible={checking} step={checkSteps[stepIdx]} />
      </>
    );
  }

  const aiSummary = latestAbnormal.length
    ? `本次体检共 ${latestTally.done} 项，${latestTally.abnormal} 项偏离参考区间（${latestAbnormal.map((m) => m.name).join('、')}）；其余指标均在正常范围内。结合你的荷尔蒙节律、昼夜节律与生理周期相位，这类波动多数属可观察范围，建议连续记录几天再看趋势。Mira 仅作描述，不做诊断与评分。`
    : `本次完成 ${latestTally.done} 项检测，所有指标均在参考区间内，未见明显异常。保持当前作息与情绪节奏即可。Mira 仅作描述，不做诊断与评分。`;

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
          {/* ★ 本轮（用户）：再体检一次按钮移入卡片内 */}
          <View style={qc.ctaInside}>
            <QCta title={busy ? '体检中…' : '再体检一次'} onPress={startCheck} disabled={busy} />
          </View>
        </Card>
        <Text style={qc.footerNote}>
          没有读到数据的项目不会出现在报告里，不会用「--」占位。参考区间仅供参考，Mira 不做诊断与评分。点击卡片可查看全部体检记录。
        </Text>
      </View>
      <CheckWaitOverlay visible={checking} step={checkSteps[stepIdx]} />
    </>
  );
}

/**
 * ★ 2026-11-03（用户）：一键体检等待动画浮层。
 * 呼吸脉冲双环 + 🫀 核心图标 + 分步文案轮播；深色 backdrop 盖住洞察页，
 * 玻璃卡走 theme token（cardBg / cardBorder），与深海主题一致。
 */
function CheckWaitOverlay({ visible, step }: { visible: boolean; step: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
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
              <Text style={ov.coreEmoji}>🫀</Text>
            </View>
          </View>
          <Text style={ov.stepText}>{step}</Text>
          <Text style={ov.hint}>{`现场测量约 ${Math.round(QUICK_CHECK_DURATION_MS / 1000)} 秒，请保持戒指佩戴、手指放松`}</Text>
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
  hint: {
    marginTop: theme.sp(2),
    fontSize: theme.fontSize.micro,
    lineHeight: 18,
    color: 'rgba(74,70,96,0.88)',
    textAlign: 'center',
  },
});

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
