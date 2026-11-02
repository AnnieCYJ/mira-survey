/**
 * QuickCheckTab —— 洞察页「身体指标」下的「一键体检」子 tab（概览卡，方案 B 清单式）
 * ---------------------------------------------------------------------------
 * 只展示「最近一次体检」的简短概览：
 *   · 最近一次体检时间
 *   · 正常 X 项 / 异常 Y 项 两个大数字
 *   · 异常项清单（无异常则显示「未见异常」）
 *   · 「查看全部 N 次体检记录 →」跳转独立全屏页 QuickCheckHistory
 *   · 「开始一键体检」按钮：从 healthStore 现有真实测量组装一次体检并落库
 *
 * 数据：quickCheckStore（无演示数据；从未体检过则为空状态，触发后才出现真实记录）。
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
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

export default function QuickCheckTab() {
  const navigation = useNavigation<any>();
  const [latest, setLatest] = useState<QuickCheckRecord | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [last, c] = await Promise.all([getLatestQuickCheck(), countQuickChecks()]);
    setLatest(last);
    setCount(c);
  };

  useEffect(() => {
    (async () => { await reload(); })();
  }, []);

  const latestTally = latest ? tallyRecord(latest) : { done: 0, abnormal: 0 };
  const latestAbnormal = latest ? abnormalMetrics(latest) : [];

  const startCheck = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await assembleQuickCheckFromRealtime();
      if (res.ok) {
        await reload();
        Alert.alert('体检完成', '已根据戒指最近一次真实测量生成体检记录。');
      } else {
        Alert.alert(
          '暂时没有可用数据',
          '这次还没读到真实测量值。请先连接戒指并佩戴一会儿，让 App 采集到心率、血压、血液等指标后，再来做一次体检。',
          [{ text: '知道了' }]
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // ★ 空状态：从未体检过 → 引导用户触发一次真实体检
  if (count === 0 && !busy) {
    return (
      <View>
        <Card style={qc.overviewCard}>
          <Text style={qc.label}>一键体检</Text>
          <View style={{ alignItems: 'center', paddingVertical: theme.sp(4) }}>
            <Text style={[qc.abEmpty, { textAlign: 'center', fontSize: theme.fontSize.sm, lineHeight: 22 }]}>
              暂时还没有体检记录。{'\n'}连接戒指并佩戴后，点下面按钮做一次真实体检。
            </Text>
          </View>
          <QCta title={busy ? '体检中…' : '去体检一次'} onPress={startCheck} disabled={busy} />
        </Card>
        <Text style={qc.footerNote}>
          体检数据来自戒指的真实测量（心率 / 血压 / 血氧 / 血液指标 / 压力 / 疲劳等），Mira 只做描述与参考，不做诊断与评分。
        </Text>
      </View>
    );
  }

  return (
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
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('QuickCheckHistory')}
          style={qc.linkRow}
        >
          <Text style={qc.linkText}>查看全部 {count} 次体检记录</Text>
          <Text style={qc.linkArrow}>›</Text>
        </TouchableOpacity>
        <QCta title={busy ? '体检中…' : '再体检一次'} onPress={startCheck} disabled={busy} />
      </Card>
      <Text style={qc.footerNote}>
        「--」表示该检测项本次未测成功。参考区间来自常见医学资料，仅供参考，Mira 不做诊断与评分。
      </Text>
    </View>
  );
}

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
