/**
 * SleepInfoSheet —— 睡眠指标「查看说明」底部弹层
 *
 * 文案纪律（2026-11-25 用户定稿）：
 *  - 只写「多少到多少算正常 / 偏高偏低」+「生理学上意味着什么」。
 *  - 不写工程实现口径（如「只拿到字段名 / 没拿到公式与分级线」），不写长篇免责，
 *    不做诊断结论；每条压短：区间一句 + 是什么一句 + 意味着什么一到两句。
 *
 * 阈值沿用工程既有标准（开发参考，不出现在用户文案里）：
 *  静息心率 58–85、夜间 HRV <50、血氧 ≥95 / 90–94 / <90、
 *  睡眠结构 7–9h / 15–25% / 20–25% / ≥85% / ≤3 次、入睡 >23:30。
 *
 * 视觉：弹层主题深蓝；「常见区间」块与「知道了」按钮为半透明磨砂玻璃（BlurView）。
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { theme } from '../theme/theme';

export type SleepInfoKey =
  | 'duration' | 'deep' | 'rem' | 'eff' | 'getup'
  | 'bed' | 'wake'
  | 'hr' | 'hrv' | 'spo2'
  | 'cardiacLoad' | 'dip' | 'nightDayHr'
  // 2026-11-25 扩展：血压 / 血糖 / 血液成分 / 基础指标 / 心理神经 / 身体成分
  | 'hrDay' | 'hrvDay' | 'spo2Day' | 'respRate' | 'ecg' | 'temp'
  | 'bp' | 'glucose' | 'cholesterol' | 'triglyceride' | 'hdl' | 'ldl' | 'uricAcid'
  | 'stress' | 'fatigue' | 'emotion' | 'skin' | 'sns' | 'cortisolIndex' | 'depressionRisk'
  | 'bmi' | 'bodyFat' | 'water' | 'bodyNoStandard'
  | 'sleepScore' | 'activity' | 'eda';

interface Info {
  title: string;
  /** 当前值文案（可选，如「昨夜 10小时11分」） */
  value?: string | null;
  /** 常见区间（哪段到哪段） */
  range: string;
  /** 这个指标是什么、怎么看 */
  meaning: string;
  /** 偏高/偏低分别可能意味着什么、对健康的影响 */
  impact: string;
  /** 可做的一件小事（可选） */
  tip?: string;
  /** 偏离段小标题（默认「偏高 / 偏低意味着什么」，下降类指标用自定义） */
  impactLabel?: string;
}

const INFO: Record<SleepInfoKey, Omit<Info, 'value'>> = {
  duration: {
    title: '总睡眠时长',
    range: '7–9 小时。',
    meaning: '昨夜实际睡着的时长。',
    impact: '偏短常伴随白天困倦、注意力下降；偏长多见于补觉。看连续几晚比单晚更准。',
    tip: '固定起床时间。',
  },
  deep: {
    title: '深睡占比',
    range: '15–25%。',
    meaning: '深睡时长占总睡眠的比例，是身体修复最集中的阶段。',
    impact: '偏低多见于睡眠浅、易醒或时长不足；随年龄增长会自然减少，不是越高越好。',
  },
  rem: {
    title: 'REM 占比',
    range: '20–25%。',
    meaning: 'REM 与记忆整理、情绪调节有关。',
    impact: '偏低与睡眠不足、作息不规律有关；单晚波动大，看一段时间的平均。',
  },
  eff: {
    title: '睡眠效率',
    range: '≥85% 良好，<70% 偏低。',
    meaning: '实际睡着的时间占卧床时间的比例。',
    impact: '偏低说明卧床时清醒太久，多与入睡慢、夜里易醒有关。',
    tip: '困了再上床，醒太久先起身。',
  },
  getup: {
    title: '夜间清醒',
    range: '≤3 次。',
    meaning: '睡眠中醒来的次数，不含最终起床。',
    impact: '偏多会打断睡眠连续性、压缩深睡。',
  },
  bed: {
    title: '入睡时刻',
    range: '23:30 前较从容，晚于 23:30 偏晚。',
    meaning: '昨夜开始入睡的时间。',
    impact: '长期偏晚会压缩总睡眠，让作息与身体节律错位。',
    tip: '先固定起床时间。',
  },
  wake: {
    title: '起床时刻',
    range: '因作息而异，没有统一标准。',
    meaning: '睡眠结束、最终起床的时间。',
    impact: '早晚本身不分好坏，关键是作息稳定、睡够。',
  },
  hr: {
    title: '睡眠静息心率',
    range: '58–85 次/分；>85 偏高，<58 偏低。',
    meaning: '睡眠中最低一段心率的均值。',
    impact: '偏高常见于疲劳、饮酒或睡眠不踏实；偏低多见于心肺功能较好。和自己的既往值比更有意义。',
  },
  hrv: {
    title: '夜间 HRV（RMSSD）',
    range: '≥50ms 恢复较好，<50ms 偏低。',
    meaning: '心跳间隔的变化，反映自主神经的恢复状态。',
    impact: '偏低常与疲劳未恢复、压力大或睡眠不足有关；重点看自己的长期趋势。',
  },
  spo2: {
    title: '夜间血氧',
    range: '≥95% 理想，90–94% 偏低，<90% 需留意。',
    meaning: '睡眠期间血液的氧饱和度。',
    impact: '偏低与打鼾、呼吸不畅或通风差有关；多次偏低或伴白天嗜睡值得关注。',
  },
  cardiacLoad: {
    title: '心脏负荷（夜间）',
    range: '暂无统一参考区间，看自己前几晚的变化。',
    meaning: '夜间血氧分析附带的心脏负担指数。',
    impact: '相对自己平时偏高，通常说明那几晚夜间恢复不足，可结合血氧、心率一起看。',
  },
  dip: {
    title: '夜间心率下降',
    range: '≥10% 下降充分，3–10% 偏少，<3% 基本没降，夜间反高为反向。',
    meaning: '夜间心率比日间低的幅度。',
    impact: '下降充分说明夜间更容易放松；下降少或反向与睡眠浅、起夜多、疲劳、饮酒有关，也可能与血压昼夜节律变化有关。',
    impactLabel: '下降充分 / 偏少意味着什么',
  },
  nightDayHr: {
    title: '夜间 / 日间心率',
    range: '没有统一及格线，重点看夜间比日间降多少。',
    meaning: '夜间取睡眠最低一段心率，日间取清醒时段均值。',
    impact: '夜间高于日间或差别很小，常与睡眠不踏实、夜间醒来、疲劳或饮酒有关。',
    impactLabel: '夜间偏高 / 偏低意味着什么',
  },

  // ── 基础指标 ──
  hrDay: {
    title: '心率',
    range: '成人静息 60–100 次/分。',
    meaning: '心脏每分钟跳动的次数。',
    impact: '偏快常见于活动、紧张、饮酒或睡得少；偏慢可见于心肺功能好或深度睡眠。安静时的数值才有参考价值。',
  },
  spo2Day: {
    title: '血氧',
    range: '≥95% 正常，90–94% 偏低，<90% 明显偏低。',
    meaning: '血液里氧气的饱和度。',
    impact: '偏低与呼吸不畅、打鼾或环境通风差有关；持续低于 90% 值得关注。',
  },
  hrvDay: {
    title: '心率变异性',
    range: '没有统一及格线，看自己长期均值。',
    meaning: '相邻两次心跳间隔的变化，反映自主神经的恢复状态。',
    impact: '连续低于自己平时，常和疲劳、压力或睡眠不足有关；单日高低不必当结论。',
  },
  respRate: {
    title: '呼吸率',
    range: '安静时 12–20 次/分。',
    meaning: '每分钟呼吸的次数，这里取 ECG 测量时附带的值。',
    impact: '偏快常见于活动后、紧张或发热；偏慢可见于深度睡眠与良好的心肺状态。',
  },
  ecg: {
    title: '心电图 ECG',
    range: '平均心率参考 60–100 次/分；波形需专业判读。',
    meaning: '记录心脏电活动，同时给出平均心率、HRV、呼吸率等指标。',
    impact: '心跳持续过快或过慢、波形明显异常时，拿着报告找医生看。',
  },
  temp: {
    title: '体温',
    range: '常用腋温 36.0–37.2℃；戒指回读的是日均值。',
    meaning: '一天里的平均体温，测量部位不同数值会有差异。',
    impact: '相对自己平时持续升高，多见于感染、炎症或睡眠不足；单次偏高先看测量条件。',
  },

  // ── 血压 · 血糖 · 血液成分（临床标准）──
  bp: {
    title: '血压',
    range: '理想 <120/80；正常 120–129 / 80–84；正常高值 130–139 / 85–89；≥140/90 属高血压范围。',
    meaning: '收缩压是心脏收缩时的压力，舒张压是心脏放松时的压力。',
    impact: '持续偏高会让心脏和血管长期承受更大压力；正常高值常与盐分、体重、睡眠有关。单次受姿势和紧张影响，连续多天同一水平才有意义。',
  },
  glucose: {
    title: '血糖',
    range: '空腹 3.9–6.1 mmol/L，餐后 2 小时 <7.8。',
    meaning: '血液中的葡萄糖浓度，是身体供能与代谢的直接指标。',
    impact: '低于 3.9 可能头晕、心慌；持续高于空腹范围与饮食、体重、活动量有关。先看是空腹还是餐后。',
  },
  cholesterol: {
    title: '总胆固醇',
    range: '合适 <5.2 mmol/L。',
    meaning: '血液中各类胆固醇的总量。',
    impact: '持续偏高会增加动脉粥样硬化风险，和饮食、体重、遗传都有关。',
  },
  triglyceride: {
    title: '甘油三酯',
    range: '正常 <1.7 mmol/L。',
    meaning: '血液中油脂类物质的浓度。',
    impact: '偏高常与精制碳水、饮酒和体重上升有关，也是代谢负担的信号。',
  },
  hdl: {
    title: '高密度脂蛋白',
    range: '≥1.0 mmol/L，越高越有利。',
    meaning: '常被称为「好胆固醇」，帮助把血管里的脂质运走。',
    impact: '偏低常与久坐、体重上升、吸烟有关；规律运动有助于回升。',
  },
  ldl: {
    title: '低密度脂蛋白',
    range: '合适 <3.4 mmol/L；已有心血管风险者目标更低。',
    meaning: '常被称为「坏胆固醇」。',
    impact: '偏高会让脂质更容易沉积在血管壁，是动脉粥样硬化的重要风险因素。',
  },
  uricAcid: {
    title: '尿酸',
    range: '常见参考 155–428 μmol/L，女性上限通常更严格。',
    meaning: '嘌呤代谢的最终产物，经肾脏排出。',
    impact: '偏高与高嘌呤饮食、饮水不足、代谢有关，持续升高可能引起关节不适；偏低临床意义通常较小。',
  },

  // ── 心理神经（设备指数，无医学诊断线）──
  stress: {
    title: '压力',
    range: '0–30 放松，30–60 正常，60–80 中等，>80 偏高（设备指数）。',
    meaning: '戒指综合生理信号给出的紧张度读数。',
    impact: '持续偏高说明身体一直处在紧绷状态，睡眠和恢复往往也会跟着变差。',
  },
  fatigue: {
    title: '疲劳度',
    range: '<30 较低，30–55 适中，>55 偏高（设备指数）。',
    meaning: '结合睡眠与活动给出的身体疲劳程度。',
    impact: '持续偏高多见于睡眠不足或连续消耗，白天容易注意力下降。',
  },
  emotion: {
    title: '情绪',
    range: '−3~4 平静，4~7 开心，7~10 兴奋；−7~−3 压力，−10~−7 难过。',
    meaning: '设备把情绪活动落在 −10 到 10 的刻度上。',
    impact: '看一段时间里主要落在哪一段，比单次数值更能反映近期状态。',
  },
  skin: {
    title: '皮肤含水量',
    range: '<40 偏干，40–65 适中，>65 润泽（设备指数）。',
    meaning: '与皮肤电相关的相对读数。',
    impact: '偏低可见于饮水少、干燥环境或出汗后，和周期阶段也有关系。',
  },
  sns: {
    title: '交感神经活跃',
    range: '<30 较低，30–55 正常，>55 偏高（设备指数）。',
    meaning: '交感神经兴奋程度的相对读数。',
    impact: '持续偏高说明身体更容易处在「随时准备行动」的状态，常与压力和睡眠有关。',
  },
  cortisolIndex: {
    title: '皮质醇节律',
    range: '0–100 相对指数，通常晨高夜低。',
    meaning: '由心率、皮电等信号推算的昼夜活性，不是激素浓度检测。',
    impact: '节律变平或夜间偏高，常与睡眠不足、持续压力有关。',
  },
  depressionRisk: {
    title: '抑郁风险',
    range: '0 正常，1 轻度，2 重度（设备评估）。',
    meaning: '设备按当日状态给出的风险分级。',
    impact: '单次分级受当天状态影响；连续为 1 或 2 时，再结合情绪记录一起看。',
  },

  // ── 身体成分 ──
  bmi: {
    title: 'BMI',
    range: '中国成人 18.5–23.9 正常，24–27.9 超重，≥28 肥胖。',
    meaning: '体重（kg）除以身高（m）的平方。',
    impact: '偏高与心血管代谢风险相关；肌肉量大时 BMI 会高估脂肪。',
  },
  bodyFat: {
    title: '体脂率',
    range: '女性 20–30%，男性 10–20%。',
    meaning: '脂肪占体重的比例，由身高、体重、年龄估算。',
    impact: '偏高与代谢风险相关，偏低多见于体重过低或运动量大；估算值不能替代体成分仪。',
  },
  water: {
    title: '身体水分',
    range: '50–65%。',
    meaning: '体内水分占体重的比例，由去脂体重估算。',
    impact: '偏低常与脱水、体重变化有关；短期波动多来自饮水和出汗。',
  },
  bodyNoStandard: {
    title: '身体成分指标',
    range: '暂无统一参考区间，看自己前后几次的变化。',
    meaning: '由身高、体重、年龄等估算的身体组成指标。',
    impact: '相对自己明显变化，多与体重、饮食、水分或测量条件有关，单独一次高低不代表问题。',
  },
  sleepScore: {
    title: '睡眠评分',
    range: '设备综合评分，没有临床标准。',
    meaning: '按入睡时长与睡眠结构给出的整夜评分。',
    impact: '看自己连续几晚的走向，比单晚分数更有意义。',
  },
  activity: {
    title: '活动量',
    range: '没有统一正常值，按自己的目标看。',
    meaning: '全天累计的步数、距离或活动消耗。',
    impact: '相对自己平时的变化反映活动节奏，单日高低不代表健康状况。',
  },
  eda: {
    title: '皮电',
    range: '没有统一参考区间，看自己的趋势。',
    meaning: '与皮肤电相关的相对读数。',
    impact: '随出汗、紧张和环境温度变化，适合和同时间段的压力读数一起看。',
  },
};

const noStandard = (title: string, meaning: string): Omit<Info, 'value'> => ({
  title,
  range: '暂无统一参考区间，看自己前后几次的变化。',
  meaning,
  impact: '相对自己明显变化，多与体重、饮食、水分或测量条件有关，单独一次高低不代表问题。',
});
Object.assign(INFO, {
  fatMass: noStandard('脂肪量', '体内脂肪的总重量。'),
  leanBodyMass: noStandard('瘦体重', '去掉脂肪后的身体重量。'),
  muscleMass: noStandard('肌肉量', '全身肌肉的总重量。'),
  muscleRate: noStandard('肌肉率', '肌肉占体重的比例。'),
  skeletalMuscleRate: noStandard('骨骼肌率', '骨骼肌占体重的比例。'),
  subcutaneousFat: noStandard('皮下脂肪', '皮肤下方的脂肪比例。'),
  boneMass: noStandard('骨量', '骨骼矿物质的重量。'),
  proteinAmount: noStandard('蛋白质', '体内蛋白质总量。'),
  basalMetabolicRate: noStandard('基础代谢率', '静息状态下维持生命所需的最低能量。'),
});

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 2026-11-25 起同时接受睡眠与其他模块指标 key（见 lib/metricVerdict.infoKeyFor） */
  metric: SleepInfoKey | string | null;
  /** 当前值文案，如「昨夜 73 bpm」 */
  valueText?: string | null;
}

export default function SleepInfoSheet({ visible, onClose, metric, valueText }: Props) {
  const insets = useSafeAreaInsets();
  const base = metric ? (INFO as Record<string, Omit<Info, 'value'>>)[metric] : null;
  const info: Info | null = base ? { ...base, value: valueText ?? null } : null;
  if (!info) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mask}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, theme.space.lg) + theme.space.md }]}>
          <View style={styles.handle} />
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{info.title}</Text>
            {info.value ? <Text style={styles.value}>{info.value}</Text> : null}

            <BlurView intensity={26} tint="light" style={styles.rangeBox}>
              <Text style={styles.rangeLabel}>常见区间</Text>
              <Text style={styles.rangeText}>{info.range}</Text>
            </BlurView>

            <Section label="这个指标是什么" text={info.meaning} />
            <Section label={info.impactLabel ?? '偏高 / 偏低意味着什么'} text={info.impact} />
            {info.tip ? <Section label="可以做什么" text={info.tip} /> : null}
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed ? { opacity: 0.6 } : null]}
            accessibilityRole="button"
            accessibilityLabel="知道了"
          >
            <BlurView intensity={26} tint="light" style={styles.closeBtnGlass}>
              <Text style={styles.closeText}>知道了</Text>
            </BlurView>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.ui.scrim },
  sheet: {
    maxHeight: '88%',
    // ★ 2026-11-25（用户定稿）：弹层本身用主题统一的深海蓝 bgMid，
    //   不换白卡、不另调亮；里面的「常见区间」方块和「知道了」按钮
    //   改成半透明磨砂玻璃（BlurView + 白阶玻璃 token），靠内部材质体现层级。
    backgroundColor: theme.colors.bgMid,
    ...theme.shadow.sheet,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
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
  // ★ 2026-11-25：末尾说明与「知道了」按钮之间留白，滚动到底不被按钮压字
  scroll: { width: '100%', paddingBottom: theme.space.sm },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  value: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 4 },
  // ★ 磨砂玻璃小块：透明度来自既有玻璃 token，真模糊由 <BlurView> 提供
  rangeBox: {
    marginTop: theme.space.sm,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    overflow: 'hidden',
  },
  rangeLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 4 },
  rangeText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, lineHeight: 20 },
  section: { marginTop: theme.space.sm },
  sectionLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, marginBottom: 6 },
  sectionText: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: 21 },
  closeBtn: { marginTop: theme.space.md },
  closeBtnGlass: {
    paddingVertical: theme.space.sm + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
    overflow: 'hidden',
  },
  closeText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
});
