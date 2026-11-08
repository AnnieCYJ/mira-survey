/**
 * QuickCheckDetailScreen —— 「一键体检」微体检报告详情（独立全屏页）
 * ---------------------------------------------------------------------------
 * 顶部「微体检报告」+ 返回 + 分享占位；主体：检测时间摘要框 + 按组展开
 * （核心体征 / 血液健康 / 心理健康 / 压力疲劳），每条指标含大数值 + 状态标签 +
 * 分段刻度条 + 描述性说明。底部「删除本次记录」（删除后返回列表）。
 * 背景沿用全站深海渐变（ScreenContainer withGradient），与洞察页同源。
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考，不构成诊断建议。
 * ───────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import { theme } from '../theme/theme';
import {
  getQuickCheckById,
  deleteQuickCheck,
  tallyRecord,
  type QuickCheckRecord,
} from '../data/quickCheckStore';
import { qc, GroupBlock } from '../components/quickCheckShared';
import BackButton from '../components/BackButton';

export default function QuickCheckDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const recordId = route.params?.recordId as string | undefined;
  const [record, setRecord] = useState<QuickCheckRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!recordId) {
      setRecord(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await getQuickCheckById(recordId);
    setRecord(r);
    setLoading(false);
  }, [recordId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <ScreenContainer withGradient>
        <View style={qc.backRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={qc.histTitle}>微体检报告</Text>
        </View>
        <View style={{ paddingVertical: theme.sp(8), alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.textSub} />
          <Text style={[qc.histMeta, { marginTop: theme.sp(2) }]}>报告加载中…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!record) {
    return (
      <ScreenContainer withGradient>
        <View style={qc.backRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={qc.histTitle}>微体检报告</Text>
        </View>
        <Text style={qc.histMeta}>未找到该体检记录，可能已被删除。</Text>
      </ScreenContainer>
    );
  }

  const t = tallyRecord(record);

  const onDelete = () => {
    if (deleting) return;
    Alert.alert('删除本次体检记录', '删除后无法恢复，确定删除吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          await deleteQuickCheck(record.id);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <ScreenContainer withGradient>
      <View style={qc.backRow}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={qc.backBtn}>
          <Text style={qc.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={qc.histTitle}>微体检报告</Text>
        <View style={{ flex: 1 }} />
        <Text style={qc.shareIcon}>↗</Text>
      </View>

      <View style={qc.sumBox}>
        <Text style={qc.sumTime}>检测时间 {fmtDateLocal(record.createdAt)}</Text>
        <Text style={qc.sumMain}>
          本次完成 {t.done} 项检测，
          {t.abnormal ? `${t.abnormal} 项偏高/偏低` : '未见异常'}
        </Text>
        <Text style={qc.sumNote}>
          下面按本次测量到的结果逐项解读：每一项都说明它代表什么、当前是否正常、可能的原因，以及可参考的日常建议。
          所有结论只帮你了解自己的状态，不构成诊断或评分。
        </Text>
      </View>

      {record.groups.map((g) => (
        <GroupBlock key={g.key} group={g} useAi />
      ))}

      <TouchableOpacity activeOpacity={0.7} onPress={onDelete} style={qc.delRow} disabled={deleting}>
        {deleting ? (
          <ActivityIndicator color={theme.colors.danger} />
        ) : (
          <Text style={qc.delText}>删除本次记录</Text>
        )}
      </TouchableOpacity>
    </ScreenContainer>
  );
}

function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
