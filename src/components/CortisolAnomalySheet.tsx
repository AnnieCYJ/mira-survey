/**
 * CortisolAnomalySheet —— 皮质醇异常「说明弹层」
 *
 * 用途（对齐 preview/sleep-rhythm.html v9 原型）：
 *  - 用户点击「睡眠与恢复」双轴图上的红底白「!」icon，或点击「睡眠节律」卡里的
 *    「整体水平」格（偏高 / 正常 / 节律紊乱）时，弹出这一层；
 *  - 明确指出当天皮质醇**到底是偏高、还是节律偏平 / 峰值后移**，
 *    并给出成因说明 + 一条可执行建议；
 *  - 判定全部来自真实算法 `analyzeCortisol`（cosinor 拟合），
 *    这里只负责「把结论翻译成人话 + 视觉呈现」，不做任何二次判定。
 *
 * 设计约束：底部弹层（对齐原型），复用 App 的 Modal + theme token；
 * 文案口径遵守 Mira 铁律：只做「解释与提示」，不出现诊断/疗愈/激励类词汇。
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

/** 异常类型 —— 与 cortisolRhythm 的 today.{high,dys} 两布尔对应 */
export type CortAnomKind = 'high' | 'flat' | 'late' | 'normal';

/** 单一异常类型的完整说明（结论 / 成因 / 建议） */
const DETAIL: Record<CortAnomKind, { tag: string; conclusion: string; body: string; tip: string }> = {
  high: {
    tag: '晨间皮质醇偏高',
    conclusion: '皮质醇偏高（晨峰过冲）',
    body:
      '晨间皮质醇觉醒反应（CAR）过冲——起床后 30–45 分钟内的峰值明显高于你近 14 天基线。' +
      '常见于压力负荷偏高或作息不规律，可能压制当天的深睡比例与恢复质量。',
    tip: '可尝试：起床后 10 分钟接触自然光、避免晨起咖啡因叠加、今晚提前 30 分钟就寝。',
  },
  flat: {
    tag: '昼夜节律偏平',
    conclusion: '节律偏平（振幅过低）',
    body:
      '皮质醇昼夜振幅偏低，晨峰与夜间谷值的落差缩小。通常伴随慢性压力或疲劳积累，' +
      '身体难以形成清晰的「白天清醒 — 夜间修复」切换。',
    tip: '可尝试：白天增加自然光与活动量、固定进餐与就寝时间，逐步重建节律起伏。',
  },
  late: {
    tag: '峰值后移 / 夜间偏高',
    conclusion: '峰值后移（疑似节律倒置）',
    body:
      '皮质醇峰值明显后移，夜间仍处在偏高区间。提示节律相位倒置，' +
      '会直接拉长入睡潜伏期并压缩深睡比例。',
    tip: '可尝试：睡前 2 小时降光、避免夜宵与高强度工作、固定起床时间以锚定节律。',
  },
  normal: {
    tag: '节律正常',
    conclusion: '皮质醇节律正常',
    body: '当天皮质醇整体水平、昼夜起伏与峰值时刻都在你的个人基线范围内，节律形态未見明显偏移。',
    tip: '保持当前作息节奏即可。',
  },
};

export function cortKindOf(input: { high: boolean; dys: boolean } | null | undefined): CortAnomKind {
  if (!input) return 'normal';
  if (input.dys) return 'late';
  if (input.high) return 'high';
  return 'normal';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  kind: CortAnomKind;
  /** 该异常对应的日期文案（如「10/02 周四」）；为空则不显示该行 */
  dateLabel?: string | null;
}

export default function CortisolAnomalySheet({ visible, onClose, kind, dateLabel }: Props) {
  const insets = useSafeAreaInsets();
  const d = DETAIL[kind] ?? DETAIL.normal;
  // 「节律紊乱」比「偏高」更值得优先解释（它对入睡/深睡的直接影响更大）
  const isDys = kind === 'late';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mask}>
        {/* 点遮罩关闭 */}
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, theme.space.lg) + theme.space.md }]}>
          <View style={styles.handle} />

          <View style={styles.tagRow}>
            <View style={[styles.tag, isDys ? { backgroundColor: mm.colors.roseSoft } : { backgroundColor: mm.colors.honeySoft }]}>
              <Text style={[styles.tagText, { color: isDys ? mm.colors.roseDeep : mm.colors.honeyDeep }]}>{d.tag}</Text>
            </View>
            {dateLabel ? <Text style={styles.dateText}>{dateLabel}</Text> : null}
          </View>

          <Text style={styles.conclusion}>{d.conclusion}</Text>
          <Text style={styles.body}>{d.body}</Text>

          <View style={styles.tipWrap}>
            <Text style={styles.tip}>{d.tip}</Text>
          </View>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed ? { opacity: 0.6 } : null]}
            accessibilityRole="button"
            accessibilityLabel="知道了"
          >
            <Text style={styles.closeText}>知道了</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(31,29,26,0.42)' },
  sheet: {
    backgroundColor: theme.colors.bgBottom,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space.cardPad,
    paddingTop: theme.space.sm,
  },
  handle: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.cardBorder,
    alignSelf: 'center', marginBottom: theme.space.md,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  tag: { paddingHorizontal: theme.space.sm, paddingVertical: 3, borderRadius: theme.radius.pill },
  tagText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  dateText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  conclusion: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginTop: theme.space.sm,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: 21,
    marginTop: theme.space.sm,
  },
  tipWrap: {
    marginTop: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.ui.borderSoft,
  },
  tip: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: 18 },
  closeBtn: {
    marginTop: theme.space.md,
    paddingVertical: theme.space.sm + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
  },
  closeText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.accentText },
});
