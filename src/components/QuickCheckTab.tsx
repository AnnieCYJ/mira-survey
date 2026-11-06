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
  assembleQuickCheckFromRealtime,
  type QuickCheckRecord,
} from '../data/quickCheckStore';
import { qc, statusColor, statusLabel, QCta } from './quickCheckShared';

// ★ 一键体检等待动画的分步文案在组件内按机型能力动态生成（见 checkSteps）

export default function QuickCheckTab() {
  const navigation = useNavigation<any>();
  const { model: profile } = useDeviceModel();
  // ★ 2026-11-05：体检按「机型能力 + 当前戒指真实回读」组装。
  //   基础版 Luna Mira 实测项：心率/HRV/血氧/体温/交感/活动/睡眠/血脂三项；
  //   估算项：今日状态、压力（HRV 推算）、身体成分（首次注册录入的身高体重推算）。
  //   旧实现读 healthStore 遗留的血压/血糖/尿酸/皮肤/情绪/皮质醇，属 HK18 数据混显，已移除。
  const canBp = hasCap(profile, 'bp');
  const canGlucose = hasCap(profile, 'glucose');
  const canGlance = hasCap(profile, 'cortisol');
  const checkupMetrics = [
    '今日状态', '心率', 'HRV', '血氧', '体温', '交感神经活跃度',
    '活动', '睡眠', '血脂', '压力（估算）', '身体成分（按身高体重估算）',
    ...(canBp ? ['血压'] : []),
    ...(canGlucose ? ['血糖'] : []),
    ...(canGlance ? ['健康一览信号'] : []),
  ];
  const checkSteps = [
    '正在读取心率、HRV 与血氧…',
    '正在汇总活动、睡眠与血脂数据…',
    '正在估算今日状态与身体成分…',
    '正在生成体检报告…',
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
    // 分步文案每 600ms 走一步，配合最短 1.8s 的等待体感
    stepTimer.current = setInterval(
      () => setStepIdx((i) => Math.min(i + 1, checkSteps.length - 1)),
      600,
    );
    const minWait = new Promise<void>((r) => setTimeout(r, 1800));
    try {
      const [res] = await Promise.all([assembleQuickCheckFromRealtime(), minWait] as const);
      setChecking(false);
      if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; }
      if (res.ok && res.record) {
        await reload();
        // ★ 成功不再弹 Alert，直接跳本次体检的详情页
        navigation.navigate('QuickCheckDetail', { recordId: res.record.id });
      } else {
        Alert.alert(
          '暂时没有可用数据',
          '这次还没读到戒指数据。请连接戒指并佩戴一会儿，再来做一次体检。',
          [{ text: '知道了' }]
        );
      }
    } catch {
      setChecking(false);
      if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; }
      Alert.alert('体检未完成', '读取测量数据时出了问题，请稍后再试。', [{ text: '知道了' }]);
    } finally {
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
                还没有体检记录。{'\n'}点下面按钮，用当前 HRV 与戒指数据算出今天的「今日状态」，结果会同步到首页。
              </Text>
            </View>
            <QCta title={busy ? '体检中…' : '去体检一次'} onPress={startCheck} disabled={busy} />
          </Card>
        <Text style={qc.footerNote}>
          最多覆盖{checkupMetrics.length}类结果，实际以本次戒指回读到的数据为准，没有回读到的项目不会出现在报告里。
          标「实测」的是戒指真实回读（心率 / HRV / 血氧 / 体温 / 交感 / 活动 / 睡眠 / 血脂）；
          标「估算」的是按当前 HRV 与你首次填写的身高体重推算（今日状态 / 压力 / 身体成分），不是戒指直接测量。
          Mira 只做描述与参考，不做诊断与评分。
        </Text>
        </View>
        <CheckWaitOverlay visible={checking} step={checkSteps[stepIdx]} />
      </>
    );
  }

  return (
    <>
      <View>
        <Card style={qc.overviewCard}>
          <View style={qc.overviewHead}>
            <Text style={qc.label}>最近一次体检</Text>
            <Text style={qc.label}>{latest ? fmtDateLocal(latest.createdAt) : '—'}</Text>
          </View>
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
          {/* ★ 2026-11-05（用户）：去掉「查看全部 N 次体检记录」跳转链接；
              正常/异常已在上方大数字汇总（X 项正常 / Y 项异常），底部仅保留「再体检一次」。 */}
          <QCta title={busy ? '体检中…' : '再体检一次'} onPress={startCheck} disabled={busy} />
        </Card>
        <Text style={qc.footerNote}>
          「--」表示该检测项本次未测成功。参考区间来自常见医学资料，仅供参考，Mira 不做诊断与评分。
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
          <Text style={ov.hint}>实测数据 + 按 HRV 与身高体重的估算，请稍候</Text>
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
    width: 260,
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(6),
    paddingHorizontal: theme.sp(5),
  },
  ringWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: theme.sp(4) },
  ringOuter: {
    position: 'absolute',
    width: 96, height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: theme.colors.textWhite,
  },
  ringMid: {
    position: 'absolute',
    width: 72, height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: theme.colors.textWhite,
  },
  core: {
    width: 52, height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreEmoji: { fontSize: theme.fontSize.orb },
  stepText: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
    textAlign: 'center',
  },
  hint: {
    marginTop: theme.sp(2),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
});

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
