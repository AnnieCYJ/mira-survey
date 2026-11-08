import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Sheet, { SheetHead } from './Sheet';
import Icon from './Icon';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { healthStore, dayKey } from '../data/healthStore';

export type ManualMeasureMode = 'bp' | 'glucose' | null;

interface Props {
  visible: boolean;
  mode: ManualMeasureMode;
  onClose: () => void;
}

const BP_SYS_MIN = 60, BP_SYS_MAX = 260, BP_DIA_MIN = 30, BP_DIA_MAX = 200;
const GLU_MIN = 1.0, GLU_MAX = 40.0;

/**
 * 手动自测记录浮层（血压 / 血糖）。
 * ★ 2026-11-06（用户：基础版 LunaMira 无血压/血糖传感器，需手动记录 + 趋势）：
 *   - 与戒指原生 bp/glucose（proOnly）完全解耦，走 manualBpSys/manualBpDia/manualGlucose 独立 key；
 *   - 用户自填袖带/指尖血实测值，落 healthStore（趋势 + 日值 + 记录列表）；
 *   - 明确标注「仅供参考，不替代专业测量与诊断」，符合 Mira「用户自报为主 / 不诊断」口径。
 */
export default function ManualMeasureSheet({ visible, mode, onClose }: Props) {
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [glu, setGlu] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setSys(''); setDia(''); setGlu(''); setErr(null); }
  }, [visible, mode]);

  const save = () => {
    const dk = dayKey(Date.now());
    const ts = Date.now();
    if (mode === 'bp') {
      const s = Number(sys);
      const d = Number(dia);
      if (!Number.isFinite(s) || !Number.isFinite(d)) { setErr('请填写收缩压和舒张压'); return; }
      if (s < BP_SYS_MIN || s > BP_SYS_MAX || d < BP_DIA_MIN || d > BP_DIA_MAX) {
        setErr('数值超出合理范围，请检查后重填'); return;
      }
      if (s <= d) { setErr('收缩压应高于舒张压'); return; }
      healthStore.upsertManualSample('manualBpSys', dk, s, ts, 'manual');
      healthStore.upsertManualSample('manualBpDia', dk, d, ts, 'manual');
    } else if (mode === 'glucose') {
      const g = Number(glu);
      if (!Number.isFinite(g)) { setErr('请填写血糖值'); return; }
      if (g < GLU_MIN || g > GLU_MAX) { setErr('数值超出合理范围，请检查后重填'); return; }
      healthStore.upsertManualSample('manualGlucose', dk, g, ts, 'manual');
    } else {
      return;
    }
    onClose();
  };

  const isBp = mode === 'bp';
  const title = isBp ? '记录血压' : '记录血糖';
  const subtitle = isBp
    ? '填写血压计实测值（mmHg）'
    : '填写血糖仪实测值（mmol/L）';

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHead title={title} subtitle={subtitle} onBack={onClose} />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {isBp ? (
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>收缩压</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="120"
                placeholderTextColor={mm.colors.inkFaint}
                value={sys}
                onChangeText={setSys}
                maxLength={3}
              />
              <Text style={styles.unit}>mmHg</Text>
            </View>
            <View style={styles.slash}>
              <Text style={styles.slashText}>/</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>舒张压</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="80"
                placeholderTextColor={mm.colors.inkFaint}
                value={dia}
                onChangeText={setDia}
                maxLength={3}
              />
              <Text style={styles.unit}>mmHg</Text>
            </View>
          </View>
        ) : (
          <View style={styles.fieldFull}>
            <Text style={styles.label}>血糖</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="5.3"
              placeholderTextColor={mm.colors.inkFaint}
              value={glu}
              onChangeText={setGlu}
              maxLength={5}
            />
            <Text style={styles.unit}>mmol/L</Text>
          </View>
        )}

        <Text style={styles.hint}>
          {isBp
            ? '正常参考：<120 / 80 mmHg。请填写你用血压计实测的数值。'
            : '正常空腹参考：3.9–6.1 mmol/L。请填写你用血糖仪实测的数值。'}
        </Text>
        <Text style={styles.note}>
          手动记录仅用于个人趋势参考，不替代专业医疗测量与诊断。
        </Text>

        {err ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        ) : null}

        <TouchableOpacity activeOpacity={0.7} onPress={save} style={styles.btnWrap}>
          <LinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btnGrad}
          >
            <Text style={styles.btnLabel}>保存记录</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.xl,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.md },
  field: { flex: 1 },
  fieldFull: { width: '100%' },
  slash: { paddingBottom: theme.sp(8) },
  slashText: { fontSize: theme.fontSize.h1, color: mm.colors.inkFaint },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginBottom: theme.sp(2),
  },
  input: {
    borderWidth: 1,
    borderColor: mm.colors.chipBorder,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(3),
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  unit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
  },
  hint: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    lineHeight: theme.fontSize.micro * 1.6,
    marginTop: theme.space.md,
  },
  note: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkFaint,
    marginTop: theme.sp(2),
    lineHeight: theme.fontSize.micro * 1.6,
  },
  errBox: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginTop: theme.space.md,
  },
  errText: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.ecgRed,
    textAlign: 'center',
  },
  btnWrap: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    marginTop: theme.space.lg,
  },
  btnGrad: { paddingVertical: theme.space.md, alignItems: 'center' },
  btnLabel: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: mm.colors.btnTextOnGrad,
  },
});
