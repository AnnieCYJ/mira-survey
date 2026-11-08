/**
 * QuickCheckHistoryScreen —— 「一键体检」体检记录列表（独立全屏页）
 * ---------------------------------------------------------------------------
 * 顶部「体检记录」+「共 N 次」，按时间倒序列出每次体检卡（日期 + 完成项数 +
 * 异常项状态点 + 异常项摘要）。点卡进入 QuickCheckDetail 报告详情页。
 * 无记录时显示空状态 + 触发真实体检的入口。
 * 背景沿用全站深海渐变（ScreenContainer withGradient），与洞察页同源。
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import {
  getAllQuickChecks,
  countQuickChecks,
  deleteQuickCheck,
  abnormalMetrics,
  tallyRecord,
  assembleQuickCheckFromRealtime,
  type QuickCheckRecord,
} from '../data/quickCheckStore';
import { qc, statusColor, QCta } from '../components/quickCheckShared';

export default function QuickCheckHistoryScreen() {
  const navigation = useNavigation<any>();
  const [records, setRecords] = useState<QuickCheckRecord[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [recs, c] = await Promise.all([getAllQuickChecks(), countQuickChecks()]);
    setRecords([...recs].sort((a, b) => b.createdAt - a.createdAt));
    setCount(c);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

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

  return (
    <ScreenContainer withGradient>
      <View style={qc.backRow}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={qc.backBtn}>
          <Text style={qc.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={qc.histTitle}>体检记录</Text>
      </View>
      <Text style={qc.histSub}>共 {count} 次体检</Text>

      <QCta title={busy ? '体检中…' : (count === 0 ? '去体检一次' : '再体检一次')} onPress={startCheck} disabled={busy} />

      {count === 0 && !busy ? (
        <View style={{ alignItems: 'center', paddingVertical: theme.sp(6) }}>
          <Text style={[qc.abEmpty, { textAlign: 'center', fontSize: theme.fontSize.sm, lineHeight: 22 }]}>
            还没有体检记录。{'\n'}连接戒指并佩戴后，点上方按钮做一次真实体检。
          </Text>
        </View>
      ) : null}

      {records.map((r) => {
        const t = tallyRecord(r);
        const ab = abnormalMetrics(r);
        return (
          <TouchableOpacity
            key={r.id}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('QuickCheckDetail', { recordId: r.id })}
            style={qc.histCard}
          >
            <View style={qc.histHead}>
              <Text style={qc.histDate}>{fmtDateLocal(r.createdAt)}</Text>
              <View style={[qc.dot, { backgroundColor: t.abnormal ? theme.colors.ui.status.warn : theme.colors.ui.status.good }]} />
            </View>
            <View style={qc.histMetaRow}>
              <Text style={qc.histDone}>{t.done} 项</Text>
              <Text style={[qc.histAb, { color: t.abnormal ? statusColor(ab[0]) : theme.colors.ui.status.good }]}>
                {t.abnormal ? `${t.abnormal} 项异常` : '未见异常'}
              </Text>
            </View>
            <Text style={qc.histMeta}>
              {ab.length ? ab.map((m) => m.name).join('、') + ' 异常' : '全部指标在参考区间内'}
            </Text>
          </TouchableOpacity>
        );
      })}

      <Text style={qc.footerNote}>
        「--」表示该检测项本次未测成功。参考区间来自常见医学资料，仅供参考，Mira 不做诊断与评分。
      </Text>
    </ScreenContainer>
  );
}

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
