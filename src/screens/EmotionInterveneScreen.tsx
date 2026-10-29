/**
 * EmotionInterveneScreen —— 情绪干预（v18.92，按 mira-design 情绪干预 5 屏稿落地）
 *
 * 结构：本文件导出 5 个页面组件，共用一套头部/卡片/CTA 样式（ei）：
 *   - EmotionInterveneHome  工具页「情绪调节」入口：四个方案平铺 + 「直接跟 Mira AI 说」
 *   - EmotionGrounding      缓一缓 · 5-4-3-2-1 接地（sky 蓝）
 *   - EmotionReframe        换个说法 · 认知重构三步（紫）
 *   - EmotionGratitude      睡前记两笔 · 感恩（honey 蜜，第三问是主位）
 *   - EmotionActivate       动一动 / 说出来 · 行为激活 + 跟 AI 说（sky 蓝）
 *
 * 三条纪律（设计稿原文）：
 *   ① 5-4-3-2-1 证据薄 → 每步都给出口（想不出也没关系 / 跳过这一步 / 先停），不变成安全行为；
 *   ② 感恩的疗效来自 Seligman 第三问 → 「你起了什么作用」做成主位；
 *   ③ 不做评分、不做连续天数、不做勋章；危机转介外包，不出诊断/治疗口径。
 * 数据：data/interventionLog.ts（documentDirectory/interventionLog.json，只存设备）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Clipboard, Modal, Image } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { RingBle } from '../ble/RingBleManager';
import { addInterventionEntry, ensureInterventionLogLoaded } from '../data/interventionLog';

type Nav = ReturnType<typeof useNavigation<any>>;

/* ── 公共：周期相位徽标（黄体期 第 4 天 / 未记录不显示） ── */
function usePhasePill(): string | null {
  return useMemo(() => {
    try {
      const cs = RingBle.getState()?.curveStatus;
      if (!cs?.phaseLabel || cs.phaseLabel === '未记录') return null;
      return cs.dayInCycle ? `${cs.phaseLabel} 第 ${cs.dayInCycle} 天` : cs.phaseLabel;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ── 公共：页头（关闭圈 + 标题 + 相位/时长徽标，徽标颜色按页传；弹卡内 onClose 收起） ── */
function Head({ title, pill, pillBg, pillColor, onClose }: { title: string; pill?: string | null; pillBg?: string; pillColor?: string; onClose: () => void }) {
  return (
    <View style={ei.head}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onClose}
        style={ei.back}
        accessibilityRole="button"
        accessibilityLabel="收起"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
      </TouchableOpacity>
      <Text style={ei.headTitle}>{title}</Text>
      {pill ? (
        <View style={[ei.pill, pillBg ? { backgroundColor: pillBg } : null]}>
          <Text style={[ei.pillText, pillColor ? { color: pillColor } : null]}>{pill}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ── 公共：底部 CTA 行（渐变主钮 + ghost 副钮）+ 底注 ── */
function CtaRow({ main, onMain, sub, onSub, foot }: {
  main: string; onMain: () => void; sub?: string; onSub?: () => void; foot?: string;
}) {
  return (
    <View style={ei.ctaWrap}>
      <View style={ei.ctaRow}>
        <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={onMain} accessibilityRole="button" accessibilityLabel={main}>
          <LinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={ei.ctaGrad}
          >
            <Text style={ei.ctaGradText}>✓ {main}</Text>
          </LinearGradient>
        </TouchableOpacity>
        {sub ? (
          <TouchableOpacity activeOpacity={0.7} style={ei.ctaGhost} onPress={onSub} accessibilityRole="button" accessibilityLabel={sub}>
            <Text style={ei.ctaGhostText}>{sub}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {foot ? <Text style={ei.foot}>{foot}</Text> : null}
    </View>
  );
}

/* ── 公共：Mira AI 提示卡（紫色徽章 + 一句话） ── */
function AiNote({ children }: { children: React.ReactNode }) {
  return (
    <View style={ei.aiCard}>
      <View style={ei.aiBadge}>
        <Text style={ei.aiBadgeText}>+ Mira AI</Text>
      </View>
      <Text style={ei.aiText}>{children}</Text>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   Hub —— 工具页「情绪调节」入口（按 out-iv2/0-plans.png）
   分组列表：情绪来了（4）+ 每天一件小事（4）+ 筛选 chips + Mira AI 行
   ══════════════════════════════════════════════════════════ */
type PlanGroup = 'emo' | 'daily';
const PLANS: { key: string; name: string; sub: string; group: PlanGroup; grad: [string, string]; thumb: any }[] = [
  { key: 'grounding', name: '缓一缓', sub: '5-4-3-2-1 · 两三分钟', group: 'emo', grad: [mm.colors.skyMid, mm.colors.skySoft], thumb: require('../assets/breathing/thumb_calm.jpg') },
  { key: 'reframe', name: '换个说法', sub: '认知重构 · 3 步 · 约 5 分钟', group: 'emo', grad: [mm.colors.purpleMid, mm.colors.purpleSoft], thumb: require('../assets/learn/learn_cognition.jpg') },
  { key: 'activate', name: '动一动', sub: '走一走 · 3 分钟 · 戒指记前后', group: 'emo', grad: [mm.colors.skyMid, mm.colors.skySoft], thumb: require('../assets/sport/sport_hero.jpg') },
  { key: 'gratitude', name: '睡前记两笔', sub: '两件顺的事 + 你起了什么作用', group: 'emo', grad: [mm.colors.honeyMid, mm.colors.honeyTint], thumb: require('../assets/breathing/thumb_sleep.jpg') },
  { key: 'compliment', name: '夸一个人', sub: '写一句具体的话 · 2 分钟', group: 'daily', grad: [mm.colors.roseMid, mm.colors.roseSoft], thumb: require('../assets/glow/glow_sun.jpg') },
  { key: 'savoring', name: '品味小事', sub: '把这一刻多留 20 秒', group: 'daily', grad: [mm.colors.honeyCore, mm.colors.honeySoft], thumb: require('../assets/card_relax.jpg') },
  { key: 'future', name: '给未来写信', sub: '写给三个月后的自己', group: 'daily', grad: [mm.colors.purpleMid, mm.colors.purpleSoft], thumb: require('../assets/learn/learn_dopamine.jpg') },
  { key: 'outdoor', name: '到户外去', sub: '10 分钟 · 楼下也算', group: 'daily', grad: [mm.colors.skyMid, mm.colors.skySoft], thumb: require('../assets/breathing/thumb_energize.jpg') },
];

type FilterKey = 'all' | 'emo' | 'daily' | 'bed';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'emo', label: '情绪来了' },
  { key: 'daily', label: '每天一件小事' },
  { key: 'bed', label: '睡前' },
];

/** 单行方案：播放圆钮 + 名称/一句话 + 右侧渐变色块 */
function PlanRow({ plan, onPress }: { plan: typeof PLANS[number]; onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={theme.press.opacity}
      style={ei.pRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={plan.name}
    >
      <View style={ei.playCircle}>
        <Icon name="play" size={theme.fs(13)} color={mm.colors.ink} strokeWidth={2.2} />
      </View>
      <View style={ei.pBody}>
        <Text style={ei.pName}>{plan.name}</Text>
        <Text style={ei.pSub}>{plan.sub}</Text>
      </View>
      <Image source={plan.thumb} style={ei.thumbImg} resizeMode="cover" />
    </TouchableOpacity>
  );
}

/** 分组小标题：左标签 + 右说明 */
function SecHead({ left, right }: { left: string; right: string }) {
  return (
    <View style={ei.secRow}>
      <Text style={ei.secLbl}>{left}</Text>
      <Text style={ei.secRight}>{right}</Text>
    </View>
  );
}

/* ── 方案弹卡：底部滑入的暖白大卡（内容不多，不再整页跳转） ──
 * visible 时按 key 渲染对应方案；Modal 卸载 = 每次打开都是干净状态。
 * 点遮罩 / Android 返回键均可收起。 */
function PlanSheet({ open, onClose }: { open: string | null; onClose: () => void }) {
  return (
    <Modal transparent animationType="slide" visible={open != null} onRequestClose={onClose} statusBarTranslucent>
      <View style={ei.sheetOverlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} accessibilityLabel="收起" />
        <View style={ei.sheetCard}>
          <View style={ei.sheetGrabber} />
          {open === 'grounding' ? <EmotionGrounding onClose={onClose} />
            : open === 'reframe' ? <EmotionReframe onClose={onClose} />
            : open === 'gratitude' ? <EmotionGratitude onClose={onClose} />
            : open === 'activate' ? <EmotionActivate onClose={onClose} />
            : open === 'compliment' ? <EmotionCompliment onClose={onClose} />
            : open === 'savoring' ? <EmotionSavoring onClose={onClose} />
            : open === 'future' ? <EmotionFuture onClose={onClose} />
            : open === 'outdoor' ? <EmotionOutdoor onClose={onClose} />
            : null}
        </View>
      </View>
    </Modal>
  );
}

export function EmotionInterveneHome() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [open, setOpen] = useState<string | null>(null);

  const showEmo = filter === 'all' || filter === 'emo' || filter === 'bed';
  const showDaily = filter === 'all' || filter === 'daily';
  const emoRows = PLANS.filter((p) => p.group === 'emo' && (filter === 'all' || filter === 'emo' || (filter === 'bed' && p.key === 'gratitude')));
  const dailyRows = PLANS.filter((p) => p.group === 'daily' && showDaily);

  return (
    <ScreenContainer style={{ backgroundColor: theme.colors.cardBg }} topFadeColor={theme.colors.cardBg}>
      <View style={ei.head}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
          style={ei.back}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={ei.headText}>
          <Text style={ei.title}>情绪调节</Text>
          <Text style={ei.sub}>情绪调节只需两三分钟</Text>
        </View>
      </View>

      {/* 筛选 chips */}
      <View style={ei.chipsRow}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.7}
              style={[ei.chip, on && ei.chipOn]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityLabel={f.label}
            >
              <Text style={[ei.chipText, on && ei.chipTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 组一：情绪来了（睡前筛选时只留 睡前记两笔，不出组头） */}
      {showEmo ? (
        <>
          {filter !== 'bed' ? <SecHead left="情绪来了 · 挑一个" right="两三分钟" /> : null}
          {emoRows.map((p) => (
            <PlanRow key={p.key} plan={p} onPress={() => setOpen(p.key)} />
          ))}
        </>
      ) : null}

      {/* 组二：每天一件小事 */}
      {showDaily ? (
        <>
          <SecHead left="每天一件小事 · 不用打卡" right="每天任意一件" />
          {dailyRows.map((p) => (
            <PlanRow key={p.key} plan={p} onPress={() => setOpen(p.key)} />
          ))}
        </>
      ) : null}

      {/* 不在计划里? 直接跟 Mira AI 说 */}
      <TouchableOpacity
        activeOpacity={theme.press.opacity}
        style={ei.aiRow}
        onPress={() => navigation.navigate('MiraAI' as never)}
        accessibilityRole="button"
        accessibilityLabel="直接跟 Mira AI 说"
      >
        <View style={ei.aiPlus}>
          <Text style={ei.aiPlusText}>+</Text>
        </View>
        <Text style={ei.aiRowText}>不在计划里? 直接跟 Mira AI 说</Text>
        <Icon name="chevronRight" size={theme.fs(16)} color={mm.colors.inkFaint} strokeWidth={2} />
      </TouchableOpacity>

      <PlanSheet open={open} onClose={() => setOpen(null)} />
    </ScreenContainer>
  );
}

/* ══════════════════════════════════════════════════════════
   ① 缓一缓 · 5-4-3-2-1 接地（sky 蓝）
   ══════════════════════════════════════════════════════════ */
const GROUND_STEPS = [
  { n: 5, sense: '看见', unit: '样东西', hint: '眼前有的就行，慢慢看 —— 想不出 5 样也没关系' },
  { n: 4, sense: '听见', unit: '种声音', hint: '远的近的都算，冰箱嗡嗡声也算一种' },
  { n: 3, sense: '摸到', unit: '样东西', hint: '衣服的边、椅子的面，脚踩着的也算' },
  { n: 2, sense: '闻到', unit: '种气味', hint: '闻不到就回忆一种熟悉的气味' },
  { n: 1, sense: '尝到', unit: '种味道', hint: '嘴里的、刚喝过的，都算' },
];

export function EmotionGrounding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  /** 每步的输入：grounding[step][slot] */
  const [vals, setVals] = useState<string[][]>(GROUND_STEPS.map((s) => Array.from({ length: s.n }, () => '')));
  const pill = usePhasePill();
  const cur = GROUND_STEPS[step];
  const curVals = vals[step];

  const setSlot = (i: number, t: string) => {
    setVals((prev) => prev.map((arr, si) => (si === step ? arr.map((v, vi) => (vi === i ? t : v)) : arr)));
  };

  const next = () => {
    if (step < GROUND_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      const total = vals.reduce((a, arr) => a + arr.filter((v) => v.trim()).length, 0);
      addInterventionEntry('grounding', `缓一缓 · 写下 ${total} 样`);
      onClose();
    }
  };

  const last = step === GROUND_STEPS.length - 1;
  const nextLabel = last ? '记下，收工' : `下一件 · ${GROUND_STEPS[step + 1].sense}的 ${GROUND_STEPS[step + 1].n} ${GROUND_STEPS[step + 1].unit}`;

  return (
    <View style={ei.sheetBody}>
      <Head title="缓一缓" pill={pill} onClose={onClose} />
      {/* 5 段进度条 */}
      <View style={ei.progRow}>
        {GROUND_STEPS.map((_, i) => (
          <View key={i} style={[ei.progSeg, i <= step && ei.progSegOn]} />
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }}>
        <Text style={ei.h1}>说出你{cur.sense}的 {cur.n} {cur.unit}</Text>
        <Text style={ei.h1Sub}>{cur.hint}</Text>

        {curVals.map((v, i) => {
          const on = v.trim().length > 0;
          return (
            <View key={i} style={[ei.gRow, !on && ei.gRowEmpty]}>
              <View style={[ei.gNum, on ? { backgroundColor: mm.colors.skySoft } : null]}>
                <Text style={[ei.gNumText, on && { color: mm.colors.skyDeep }]}>{i + 1}</Text>
              </View>
              <TextInput
                value={v}
                onChangeText={(t) => setSlot(i, t)}
                placeholder="还没想到…"
                placeholderTextColor={mm.colors.inkFaint}
                style={ei.gInput}
                accessibilityLabel={`${cur.sense}第 ${i + 1} 样`}
              />
            </View>
          );
        })}

        {/* 出口一：跳过这一步 */}
        <TouchableOpacity activeOpacity={0.7} style={ei.skipRow} onPress={next} accessibilityRole="button" accessibilityLabel="跳过这一步">
          <Text style={ei.skipText}>跳过这一步</Text>
          <Icon name="chevronRight" size={theme.fs(14)} color={mm.colors.inkFaint} strokeWidth={2} />
        </TouchableOpacity>
      </ScrollView>

      <CtaRow
        main={nextLabel}
        onMain={next}
        sub="先停"
        onSub={onClose}
        foot="做着不舒服就随时停下来。这只是把你拉回眼前，不是任务。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ② 换个说法 · 认知重构三步（紫）
   ══════════════════════════════════════════════════════════ */
export function EmotionReframe({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [thought, setThought] = useState('');
  const [forList, setForList] = useState<string[]>([]);   // 站在这句话这边的事
  const [againstList, setAgainstList] = useState<string[]>([]); // 不站在这句话这边的事
  const [forDraft, setForDraft] = useState('');
  const [againstDraft, setAgainstDraft] = useState('');
  const [reframe, setReframe] = useState('');
  const pill = usePhasePill();

  const done = () => {
    const short = thought.trim().slice(0, 12) || '一句话';
    addInterventionEntry('reframe', `换个说法 · 「${short}…」`);
    onClose();
  };

  return (
    <View style={ei.sheetBody}>
      <Head title="换个说法" pill={pill} onClose={onClose} />
      {/* 三步进度：✓那句话 — ②找找证据 — ③换个说法 */}
      <View style={ei.rfStepper}>
        {['那句话', '找找证据', '换个说法'].map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <View style={ei.rfLine} />}
            <View style={[ei.rfDot, i < step && ei.rfDotDone, i === step && ei.rfDotOn]}>
              <Text style={[ei.rfDotText, i <= step && ei.rfDotTextOn]}>{i < step ? '✓' : i + 1}</Text>
            </View>
            <Text style={[ei.rfLabel, i === step && ei.rfLabelOn]}>{label}</Text>
          </React.Fragment>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }}>
        {step === 0 && (
          <>
            <Text style={ei.h1}>心里那句最难听的话，原样写下来</Text>
            <Text style={ei.h1Sub}>不用修饰，它平时怎么响就怎么写</Text>
            <View style={ei.quoteCard}>
              <Text style={ei.quoteMeta}>{new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')} 记</Text>
              <TextInput
                value={thought}
                onChangeText={setThought}
                placeholder="「我连这点事都做不好」"
                placeholderTextColor={mm.colors.inkFaint}
                style={ei.quoteInput}
                multiline
                maxLength={60}
              />
            </View>
          </>
        )}

        {step === 1 && (
          <>
            {thought.trim() ? (
              <View style={ei.quoteCard}>
                <Text style={ei.quoteMeta}>刚才记的</Text>
                <Text style={ei.quoteText}>「{thought.trim()}」</Text>
              </View>
            ) : null}
            <Text style={ei.h1}>找找证据</Text>
            <Text style={ei.h1Sub}>两栏不用一样多，想到什么写什么</Text>

            {([true, false] as const).map((isFor) => {
              const list = isFor ? forList : againstList;
              const setList = isFor ? setForList : setAgainstList;
              const draft = isFor ? forDraft : againstDraft;
              const setDraft = isFor ? setForDraft : setAgainstDraft;
              return (
                <View key={String(isFor)} style={ei.evCard}>
                  <View style={ei.evHead}>
                    <Text style={ei.evTitle}>{isFor ? '站在这句话这边的事' : '不站在这句话这边的事'}</Text>
                    <Text style={ei.evCount}>{list.length} 条</Text>
                  </View>
                  {list.map((t, i) => (
                    <View key={i} style={ei.evItem}>
                      <View style={[ei.evDot, { backgroundColor: isFor ? mm.colors.roseCore : mm.colors.skyCore }]} />
                      <Text style={ei.evText}>{t}</Text>
                    </View>
                  ))}
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="再想一条…"
                    placeholderTextColor={mm.colors.inkFaint}
                    style={ei.evInput}
                    onSubmitEditing={() => {
                      const t = draft.trim();
                      if (!t) return;
                      setList([...list, t]);
                      setDraft('');
                    }}
                    accessibilityLabel={isFor ? '补充支持这条想法的事' : '补充反对这条想法的事'}
                  />
                </View>
              );
            })}

            <AiNote>两栏不用一样多，也不是要说服自己 —— 只是让「<Text style={{ fontWeight: theme.weight.bold as never }}>不只是那一件</Text>」被写下来、被看见。</AiNote>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={ei.h1}>换个说法</Text>
            <Text style={ei.h1Sub}>不用更积极，只要更完整 —— 把两栏都算进去</Text>
            <View style={ei.quoteCard}>
              <Text style={ei.quoteMeta}>原来的</Text>
              <Text style={ei.quoteText}>「{thought.trim() || '那句话'}」</Text>
            </View>
            <View style={[ei.quoteCard, { borderColor: mm.colors.purpleMid, backgroundColor: mm.colors.purpleTint }]}>
              {/* ★ 对比度修复：purpleTint 浅底上白系 quoteMeta/输入文字不可读 → purpleDeep */}
              <Text style={[ei.quoteMeta, { color: mm.colors.purpleDeep }]}>现在的</Text>
              <TextInput
                value={reframe}
                onChangeText={setReframe}
                placeholder="「这件事没做好，但上周那次是做完了的」"
                placeholderTextColor="rgba(110,88,200,0.55)"
                style={[ei.quoteInput, { color: mm.colors.purpleDeep }]}
                multiline
                maxLength={80}
              />
            </View>
          </>
        )}
      </ScrollView>

      <CtaRow
        main={step === 0 ? '下一步 · 找找证据' : step === 1 ? '下一步 · 换个说法' : '记下这个说法'}
        onMain={() => {
          if (step < 2) { setStep(step + 1); } else { done(); }
        }}
        sub="先不做了"
        onSub={onClose}
        foot="这是梳理自己想法的工具，不能替代医生的诊断或治疗。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ③ 睡前记两笔 · 感恩（honey 蜜；第三问是主位）
   ══════════════════════════════════════════════════════════ */
export function EmotionGratitude({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [you, setYou] = useState('');
  const pill = usePhasePill();

  const save = () => {
    const first = (a.trim() || b.trim()).slice(0, 16);
    addInterventionEntry('gratitude', `睡前记两笔 · ${you.trim() ? '写了你做的' : first ? `「${first}…」` : '空过一次'}`);
    onClose();
  };

  return (
    <View style={ei.sheetBody}>
      <Head title="睡前记两笔" pill={pill} onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }}>
        <Text style={ei.h1}>今天有什么是顺的?</Text>
        <Text style={ei.h1Sub}>不用是大事，两笔就够 —— 想不出来可以跳过</Text>

        {[
          { v: a, set: setA, i: 1 },
          { v: b, set: setB, i: 2 },
        ].map(({ v, set, i }) => (
          <View key={i} style={[ei.grRow, v.trim() ? null : ei.grRowEmpty]}>
            <View style={[ei.gNum, { backgroundColor: mm.colors.honeySoft }]}>
              <Text style={[ei.gNumText, { color: mm.colors.honeyDeep }]}>{i}</Text>
            </View>
            <View style={ei.grBody}>
              <Text style={ei.grLabel}>发生的</Text>
              <TextInput
                value={v}
                onChangeText={set}
                placeholder={i === 1 ? '中午跟同事一起吃饭，聊了会' : '还没想到…'}
                placeholderTextColor={mm.colors.inkFaint}
                style={ei.grInput}
                accessibilityLabel={`第 ${i} 件顺的事`}
              />
            </View>
          </View>
        ))}

        {/* 主位：Seligman 第三问 —— 疗效来源 */}
        <View style={ei.grKey}>
          <View style={[ei.pill, { backgroundColor: mm.colors.honeySoft, alignSelf: 'flex-start' }]}>
            <Text style={[ei.pillText, { color: mm.colors.honeyDeep }]}>这一问才是关键</Text>
          </View>
          <Text style={ei.grKeyTitle}>这件事里，你起了什么作用?</Text>
          <Text style={ei.grLabel}>你做的</Text>
          <TextInput
            value={you}
            onChangeText={setYou}
            placeholder="我先问了她周末去哪"
            placeholderTextColor={mm.colors.inkFaint}
            style={ei.grInput}
            accessibilityLabel="你起的作用"
          />
          <View style={ei.grKeyLine} />
          <Text style={ei.grKeyExpl}>写「你做了什么」，比写「发生了什么」有用得多 —— 前者是你带得走的东西。</Text>
        </View>

        <AiNote>这一笔会跟这周的睡眠、心率放在一起看。它<Text style={{ fontWeight: theme.weight.bold as never }}>不是被打卡的东西</Text>，纯粹是给你睡前换个落点。</AiNote>
      </ScrollView>

      <CtaRow
        main="记下，去睡"
        onMain={save}
        sub="今天跳过"
        onSub={onClose}
        foot="只在睡前出现，不占白天的干预位。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ④ 动一动 / 说出来 · 行为激活 + 跟 AI 说（sky 蓝）
   ══════════════════════════════════════════════════════════ */
const WALK_SECONDS = 180;

export function EmotionActivate({ onClose }: { onClose: () => void }) {
  const navigation = useNavigation<Nav>();
  const [walking, setWalking] = useState(false);
  const [left, setLeft] = useState(WALK_SECONDS);
  const [doneWalk, setDoneWalk] = useState(false);
  const hrBefore = useRef<number | null>(null);
  const hrAfter = useRef<number | null>(null);
  const [say, setSay] = useState('');
  const pill = usePhasePill();

  useEffect(() => {
    ensureInterventionLogLoaded();
  }, []);

  useEffect(() => {
    if (!walking) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          setWalking(false);
          setDoneWalk(true);
          try { hrAfter.current = RingBle.getState()?.metrics?.hr ?? null; } catch { hrAfter.current = null; }
          addInterventionEntry('activate', '动一动 · 3 分钟走完');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [walking]);

  const startWalk = () => {
    try { hrBefore.current = RingBle.getState()?.metrics?.hr ?? null; } catch { hrBefore.current = null; }
    setLeft(WALK_SECONDS);
    setWalking(true);
  };

  const mmss = `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')}`;
  const hrDiff = hrBefore.current != null && hrAfter.current != null ? hrAfter.current - hrBefore.current : null;

  return (
    <View style={ei.sheetBody}>
      <Head title="动一动 / 说出来" pill={pill} onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.sp(4) }}>
        {/* 卡一：起来走一走 */}
        <View style={ei.card}>
          <View style={ei.actHead}>
            <View style={[ei.planIco, { backgroundColor: mm.colors.skySoft }]}>
              <Icon name="run" size={theme.fs(17)} color={mm.colors.skyDeep} strokeWidth={2} />
            </View>
            <View style={ei.planBody}>
              <Text style={ei.planName}>起来走一走</Text>
              <Text style={ei.planDesc}>不用换衣服，不用出门</Text>
            </View>
          </View>
          <Text style={ei.actBody}>走到窗边站三分钟也算 —— 把身上这股劲用掉一点，它就不会全堆在脑子里。</Text>
          <View style={ei.walkBar}>
            <Text style={ei.walkLabel}>{doneWalk ? '刚才' : '现在'} <Text style={ei.walkTime}>{doneWalk ? '3 分钟' : walking ? mmss : '3 分钟'}</Text></Text>
            {!walking && !doneWalk ? (
              <TouchableOpacity activeOpacity={0.7} style={ei.walkBtn} onPress={startWalk} accessibilityRole="button" accessibilityLabel="开始走">
                <Text style={ei.walkBtnText}>开始走</Text>
              </TouchableOpacity>
            ) : walking ? (
              <View style={[ei.walkBtn, { backgroundColor: mm.colors.skySoft }]}>
                <Text style={ei.walkBtnText}>走着…</Text>
              </View>
            ) : null}
          </View>
          {doneWalk && hrDiff != null ? (
            <Text style={ei.walkHr}>走之前 {Math.round(hrBefore.current!)} → 走完 {Math.round(hrAfter.current!)} bpm（{hrDiff > 0 ? '+' : ''}{hrDiff}）</Text>
          ) : doneWalk ? (
            <Text style={ei.walkHr}>这次戒指没记到心率，走了就算数。</Text>
          ) : (
            <Text style={ei.walkNote}>走的时候戒指会记下心率和呼吸，回来能看到前后的差别。</Text>
          )}
        </View>

        {/* 卡二：直接跟 Mira AI 说 */}
        <View style={ei.card}>
          <View style={ei.actHead}>
            <View style={[ei.planIco, { backgroundColor: mm.colors.purpleSoft }]}>
              <Icon name="mic" size={theme.fs(17)} color={mm.colors.purpleDeep} strokeWidth={2} />
            </View>
            <View style={ei.planBody}>
              <Text style={ei.planName}>直接跟 Mira AI 说</Text>
              <Text style={ei.planDesc}>不用组织语言，说半句也行</Text>
            </View>
          </View>
          <View style={ei.sayBar}>
            <TextInput
              value={say}
              onChangeText={setSay}
              placeholder="我现在有点烦，说不清为什么…"
              placeholderTextColor={mm.colors.inkFaint}
              style={ei.sayInput}
              onSubmitEditing={() => {
                const q = say.trim();
                if (!q) return;
                addInterventionEntry('activate', '说出来了 · 交给 Mira AI');
                onClose(); // 先收卡再跳，否则 Modal 会盖住对话页
                navigation.navigate('VoiceChat' as never, { question: q } as never);
              }}
              accessibilityLabel="跟 Mira AI 说"
            />
            <TouchableOpacity
              activeOpacity={0.7}
              style={ei.sayBtn}
              onPress={() => {
                const q = say.trim();
                if (!q) return;
                addInterventionEntry('activate', '说出来了 · 交给 Mira AI');
                onClose(); // 先收卡再跳
                navigation.navigate('VoiceChat' as never, { question: q } as never);
              }}
              accessibilityRole="button"
              accessibilityLabel="发送给 Mira AI"
            >
              <Icon name="send" size={theme.fs(15)} color={theme.colors.textWhite} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
          <Text style={ei.sayHint}>不想打字，就按住底栏中间那个直接说。</Text>
        </View>

        {/* 接回程 */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={ei.returnRow}
          onPress={() => navigation.navigate('MiraAI' as never)}
          accessibilityRole="button"
          accessibilityLabel="做完回来告诉 Mira AI"
        >
          <Icon name="chevronRight" size={theme.fs(14)} color={mm.colors.inkFaint} strokeWidth={2} />
          <Text style={ei.skipText}>做完回来，告诉我好点没</Text>
        </TouchableOpacity>
        <Text style={ei.homeFoot}>对话与记录只存在你的设备上，不会上传。</Text>
      </ScrollView>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ⑤ 夸一个人 · 具体化赞美（rose 粉；2 分钟）
   ══════════════════════════════════════════════════════════ */
export function EmotionCompliment({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const specific = text.trim().length >= 12; // 说到具体的事才提示可发

  const saveOnly = () => {
    if (text.trim()) addInterventionEntry('compliment', `夸一个人 · 存了一句没发的话`);
    onClose();
  };
  const copyAndGo = () => {
    try { Clipboard.setString(text.trim()); } catch { /* 复制失败不阻塞 */ }
    addInterventionEntry('compliment', '夸一个人 · 复制去发了');
    onClose();
  };

  return (
    <View style={ei.sheetBody}>
      <Head title="夸一个人" pill="2 分钟" pillBg={mm.colors.roseSoft} pillColor={mm.colors.roseDeep} onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <Text style={ei.h1}>想一个最近让你觉得「还好有她」的人</Text>
        <Text style={ei.h1Sub}>不用是大事，也不一定要发出去</Text>

        <View style={ei.cmpCard}>
          <Text style={ei.grLabel}>写成一句具体的话</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={'「昨天你替我接住了那个电话，让我把会开完 —— 那一下我松了一口气。谢谢你后来还问我怎么样。」'}
            placeholderTextColor={mm.colors.inkFaint}
            style={ei.cmpInput}
            multiline
            maxLength={120}
            accessibilityLabel="写给那个人的话"
          />
          <View style={ei.cmpLine} />
          <Text style={ei.cmpHint}>别说「你真好」。说清是哪件事、当时对你有什么影响 —— 具体的才落得进去，也不像客套。</Text>
        </View>

        {specific ? (
          <View style={ei.cmpOk}>
            <View style={[ei.aiBadge, { backgroundColor: mm.colors.purpleSoft }]}>
              <Text style={ei.aiBadgeText}>+</Text>
            </View>
            <Text style={ei.cmpOkText}>这句里既有具体的事，也说了它对你的影响 —— 已经可以发出去了。</Text>
          </View>
        ) : null}
      </ScrollView>

      <CtaRow
        main="复制，去发给 TA"
        onMain={specific ? copyAndGo : saveOnly}
        sub="先存着"
        onSub={saveOnly}
        foot="只存在你的设备上。发不发、发给谁，你自己定。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ⑥ 品味小事 · savoring（honey 蜜；20 秒再放一遍）
   ══════════════════════════════════════════════════════════ */
const SAVOR_SECONDS = 20;
const SAVOR_CHIPS = ['一口热的', '晒到了太阳', '有人等我回家'];

export function EmotionSavoring({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [editingCustom, setEditingCustom] = useState(false);
  const [left, setLeft] = useState(SAVOR_SECONDS);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { clearInterval(t); setRunning(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const pick = (m: string) => {
    setPicked(m);
    setLeft(SAVOR_SECONDS);
    setRunning(true);
  };

  const save = () => {
    const what = (picked === '__custom' ? custom.trim() : picked) || '那一刻';
    addInterventionEntry('savoring', `品味小事 · ${what.slice(0, 12)}`);
    onClose();
  };

  const R = 62;
  const CIRC = 2 * Math.PI * R;
  const frac = left / SAVOR_SECONDS;

  return (
    <View style={ei.sheetBody}>
      <Head title="品味小事" pill="2 分钟" onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <Text style={ei.h1}>今天有哪一刻，是舒服的?</Text>
        <Text style={ei.h1Sub}>不用是大事 —— 一口热的、晒到的一小会儿太阳都算</Text>

        {/* 时刻选择 chips */}
        <View style={ei.svChips}>
          {SAVOR_CHIPS.map((m) => (
            <TouchableOpacity
              key={m}
              activeOpacity={0.7}
              style={[ei.svChip, picked === m && ei.svChipOn]}
              onPress={() => pick(m)}
              accessibilityRole="button"
              accessibilityLabel={m}
            >
              <Text style={[ei.svChipText, picked === m && ei.svChipTextOn]}>{m}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            activeOpacity={0.7}
            style={[ei.svChip, editingCustom && ei.svChipOn]}
            onPress={() => { setEditingCustom(true); setPicked('__custom'); }}
            accessibilityRole="button"
            accessibilityLabel="自己写"
          >
            <Text style={[ei.svChipText, editingCustom && ei.svChipTextOn]}>+ 自己写</Text>
          </TouchableOpacity>
        </View>
        {editingCustom ? (
          <TextInput
            value={custom}
            onChangeText={(t) => { setCustom(t); setPicked('__custom'); }}
            placeholder="哪一刻？一句话就行"
            placeholderTextColor={mm.colors.inkFaint}
            style={ei.svCustomInput}
            maxLength={30}
            accessibilityLabel="自己写的一刻"
          />
        ) : null}

        {/* 20 秒圆形倒计时：再放一遍那一刻 */}
        <View style={ei.svRingWrap}>
          <Svg width={theme.sp(40)} height={theme.sp(40)} viewBox="0 0 160 160">
            <Circle cx="80" cy="80" r={R} stroke={mm.colors.btnBusyBg} strokeWidth="8" fill="none" />
            <Circle
              cx="80" cy="80" r={R} stroke={mm.colors.honeyCore} strokeWidth="8" fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              transform="rotate(-90 80 80)"
            />
          </Svg>
          <View style={ei.svRingCenter} pointerEvents="none">
            <Text style={ei.svRingNum}>{left}</Text>
            <Text style={ei.svRingLabel}>{running || left === 0 ? '秒 · 回到那一刻' : '秒 · 再放一遍'}</Text>
          </View>
        </View>

        {/* 三条回味提示 */}
        <View style={ei.svPrompts}>
          <View style={ei.svPrompt}><Icon name="drop" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>当时是什么温度、什么声音</Text></View>
          <View style={ei.svPrompt}><Icon name="sparkle" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>是哪一下让你松了下来</Text></View>
          <View style={ei.svPrompt}><Icon name="heart" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>现在身上还剩多少那个感觉</Text></View>
        </View>
      </ScrollView>

      <CtaRow
        main="把这一刻存下来"
        onMain={save}
        sub="再来一遍"
        onSub={() => { setLeft(SAVOR_SECONDS); setRunning(true); }}
        foot="这一步只是让好的感受多停一会儿，不用得出什么结论。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ⑦ 给未来写信 · future self（purple 紫；3 个月后打开）
   ══════════════════════════════════════════════════════════ */
function futureDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function EmotionFuture({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const openOn = useMemo(futureDate, []);

  const seal = () => {
    addInterventionEntry('future', `给未来写信 · ${openOn} 打开`);
    onClose();
  };

  return (
    <View style={ei.sheetBody}>
      <Head title="给未来写信" pill="3 个月后打开" pillBg={mm.colors.purpleSoft} pillColor={mm.colors.purpleDeep} onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <Text style={ei.h1}>如果三个月后的你，回来说一句话 —— 会是什么?</Text>
        <Text style={ei.h1Sub}>写给那个已经走完这段路的自己</Text>

        <View style={ei.ftCard}>
          <Text style={ei.grLabel}>给 {openOn} 的你</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={'「你现在应该已经过了最烦的那阵子。如果还没过，就再等等 —— 我这边也还在走，没有停。」'}
            placeholderTextColor={mm.colors.inkFaint}
            style={ei.cmpInput}
            multiline
            maxLength={200}
            accessibilityLabel="给未来的话"
          />
          <View style={ei.cmpLine} />
          <Text style={ei.cmpHint}>不用写长，一句就够；也不催你立什么目标。</Text>
        </View>

        <View style={ei.ftDeliver}>
          <Icon name="calendar" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} />
          <Text style={ei.svPromptText}>这封信会在 {openOn} 的晚上给你看</Text>
        </View>
      </ScrollView>

      <CtaRow
        main="封起来"
        onMain={seal}
        sub="先不写"
        onSub={onClose}
        foot="只有你能看到；想删随时删。"
      />
    </View>
  );
}

/* ══════════════════════════════════════════════════════════
   ⑧ 到户外去 · outdoor（sky 蓝；10 分钟）
   ══════════════════════════════════════════════════════════ */
const OUT_SECONDS = 600;

export function EmotionOutdoor({ onClose }: { onClose: () => void }) {
  const [left, setLeft] = useState(OUT_SECONDS);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          setRunning(false);
          addInterventionEntry('outdoor', '到户外去 · 10 分钟待完');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const mmss = `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')}`;
  const R = 62;
  const CIRC = 2 * Math.PI * R;
  const frac = left / OUT_SECONDS;

  return (
    <View style={ei.sheetBody}>
      <Head title="到户外去" pill="10 分钟" pillBg={mm.colors.skySoft} pillColor={mm.colors.skyDeep} onClose={onClose} />
      <ScrollView showsVerticalScrollIndicator={false} bounces style={{ flex: 1 }}>
        <Text style={ei.h1}>出去待 10 分钟，楼下也算</Text>
        <Text style={ei.h1Sub}>不是让你去运动 —— 是换个地方待一会儿</Text>

        {/* 10:00 圆形倒计时 */}
        <View style={ei.svRingWrap}>
          <Svg width={theme.sp(40)} height={theme.sp(40)} viewBox="0 0 160 160">
            <Circle cx="80" cy="80" r={R} stroke={mm.colors.btnBusyBg} strokeWidth="8" fill="none" />
            <Circle
              cx="80" cy="80" r={R} stroke={mm.colors.skyCore} strokeWidth="8" fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              transform="rotate(-90 80 80)"
            />
          </Svg>
          <View style={ei.svRingCenter} pointerEvents="none">
            <Text style={ei.svRingNumBig}>{running || left === 0 ? mmss : '10:00'}</Text>
            <Text style={ei.svRingLabel}>{running ? '走吧' : left === 0 ? '待完了' : '走吧'}</Text>
          </View>
        </View>

        <View style={ei.svPrompts}>
          <View style={ei.svPrompt}><Icon name="drop" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>阳台、楼下、有树的地方都算，不用走远</Text></View>
          <View style={ei.svPrompt}><Icon name="ring" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>这段的步数、心率、呼吸，戒指会记下来</Text></View>
          <View style={ei.svPrompt}><Icon name="check" size={theme.fs(14)} color={mm.colors.inkSoft} strokeWidth={2} /><Text style={ei.svPromptText}>不计距离、不比步数；走两分钟就回来也算</Text></View>
        </View>
      </ScrollView>

      <CtaRow
        main={running ? '走着…' : left === 0 ? '记下这次' : '开始 · 10 分钟'}
        onMain={() => {
          if (running) return;
          if (left === 0) { addInterventionEntry('outdoor', '到户外去 · 手动记下'); onClose(); return; }
          setLeft(OUT_SECONDS);
          setRunning(true);
        }}
        sub="待会儿"
        onSub={() => { setRunning(false); setLeft(OUT_SECONDS); }}
        foot="只是换个地方待一会儿。累了就回来，没什么要完成的。"
      />
    </View>
  );
}


const ei = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.space.lg },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as never, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  back: {
    width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  headTitle: { flex: 1, fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as never, color: theme.colors.textTitle },
  pill: { borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(1), backgroundColor: mm.colors.honeySoft },
  pillText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never, color: mm.colors.honeyDeep },

  /* 弹卡（PlanSheet）：遮罩 + 底部滑入的深色大卡（mira-ocean：原 cardBg 13% 玻璃太透，文字透底叠影 → 改深蓝紫实底） */
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetCard: {
    height: '78%', backgroundColor: theme.colors.bgBottom,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.cardBorder,
    overflow: 'hidden',
  },
  sheetGrabber: {
    alignSelf: 'center', width: theme.sp(9), height: theme.sp(1),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.cardBorder,
    marginTop: theme.sp(1.5), marginBottom: theme.sp(1),
  },
  sheetBody: { flex: 1, paddingHorizontal: theme.space.screen, paddingTop: theme.sp(2) },

  /* Hub（out-iv2/0-plans.png）：筛选 chips + 分组行 */
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginBottom: theme.sp(2.5) },
  chip: { borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(3.5), paddingVertical: theme.sp(1.5), backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder },
  chipOn: { backgroundColor: mm.colors.limeSoft, borderColor: mm.colors.limeSoft },
  chipText: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },
  chipTextOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold as never },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.sp(1), marginBottom: theme.sp(1.5) },
  secLbl: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint },
  secRight: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint },
  pRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.space.md,
    backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.md,
    padding: theme.space.cardPad, marginBottom: theme.sp(2),
    shadowColor: theme.colors.ui.shadowBlack, shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 2,
  },
  playCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center' },
  pBody: { flex: 1 },
  pName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: theme.colors.textBody },
  pSub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  thumbImg: { width: 52, height: 52, borderRadius: theme.radius.sm },
  aiPlus: { width: theme.sp(5.5), height: theme.sp(5.5), borderRadius: theme.radius.pill, backgroundColor: mm.colors.purpleCore, alignItems: 'center', justifyContent: 'center' },
  aiPlusText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: theme.colors.textWhite, lineHeight: theme.fs(15) },

  planIco: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  planBody: { flex: 1 },
  planName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  planDesc: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft, marginTop: theme.sp(0.3) },
  aiRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2),
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(3),
  },
  aiRowText: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.ink },
  homeFoot: { fontSize: theme.fontSize.micro, lineHeight: theme.fs(17), color: mm.colors.inkFaint, textAlign: 'center', marginTop: theme.sp(1) },

  aiCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(3),
  },
  aiBadge: { backgroundColor: mm.colors.purpleSoft, borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), alignSelf: 'flex-start', marginBottom: theme.sp(1.5) },
  aiBadgeText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as never, color: mm.colors.purpleDeep },
  aiText: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(19), color: mm.colors.inkSoft },

  /* 进度条（缓一缓 5 段） */
  progRow: { flexDirection: 'row', gap: theme.sp(1), marginBottom: theme.sp(3) },
  progSeg: { flex: 1, height: theme.sp(1), borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg },
  progSegOn: { backgroundColor: mm.colors.limeMid },

  h1: { fontSize: theme.fontSize.h2, lineHeight: theme.fs(28), fontWeight: theme.weight.bold as never, color: mm.colors.ink, letterSpacing: -0.2 },
  h1Sub: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(18), color: mm.colors.inkSoft, marginTop: theme.sp(1), marginBottom: theme.sp(3) },

  /* 缓一缓输入行 */
  gRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5),
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md, paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2.5), marginBottom: theme.sp(2),
  },
  gRowEmpty: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  gNum: { width: theme.sp(5.5), height: theme.sp(5.5), borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center' },
  gNumText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint },
  gInput: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.ink, paddingVertical: 0 },
  skipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.sp(1), paddingVertical: theme.sp(2.5), marginTop: theme.sp(1) },
  skipText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft },

  /* 换个说法 */
  rfStepper: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(3) },
  rfLine: { flex: 1, height: 1, backgroundColor: theme.colors.cardBorder, marginHorizontal: theme.sp(1) },
  rfDot: { width: theme.sp(5), height: theme.sp(5), borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center' },
  rfDotOn: { backgroundColor: mm.colors.limeSoft },
  rfDotDone: { backgroundColor: mm.colors.limeMid },
  rfDotText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint },
  rfDotTextOn: { color: mm.colors.limeDeep },
  rfLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginLeft: theme.sp(1) },
  rfLabelOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold as never },
  quoteCard: {
    backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md,
    padding: theme.space.cardPadCompact, marginBottom: theme.sp(3),
  },
  quoteMeta: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginBottom: theme.sp(1) },
  quoteText: { fontSize: theme.fontSize.body, lineHeight: theme.fs(22), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  quoteInput: { fontSize: theme.fontSize.body, lineHeight: theme.fs(22), fontWeight: theme.weight.semibold as never, color: mm.colors.ink, paddingVertical: 0, minHeight: theme.sp(6) },
  evCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(2.5),
  },
  evHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  evTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  evCount: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.3), overflow: 'hidden' },
  evItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), paddingVertical: theme.sp(1) },
  evDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.radius.pill },
  evText: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: theme.fs(19), color: mm.colors.inkSoft },
  evInput: { fontSize: theme.fontSize.sm, color: mm.colors.ink, paddingVertical: theme.sp(1) },

  /* 感恩 */
  grRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(2.5),
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md, paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2.5), marginBottom: theme.sp(2),
  },
  grRowEmpty: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  grBody: { flex: 1 },
  grLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginBottom: theme.sp(0.5) },
  grInput: { fontSize: theme.fontSize.sm, color: mm.colors.ink, paddingVertical: 0 },
  grKey: {
    backgroundColor: mm.colors.honeyTint, borderWidth: 1, borderColor: mm.colors.honeyMid,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(1), marginBottom: theme.sp(1),
  },
  grKeyTitle: { fontSize: theme.fontSize.card, lineHeight: theme.fs(22), fontWeight: theme.weight.bold as never, color: mm.colors.honeyDeep, marginTop: theme.sp(1.5), marginBottom: theme.sp(1.5) }, // ★ 对比度修复：honeyTint 浅底上白字不可读
  grKeyLine: { height: StyleSheet.hairlineWidth, backgroundColor: mm.colors.honeyMid, marginVertical: theme.sp(2) },
  grKeyExpl: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(17), color: 'rgba(151,111,26,0.9)' }, // ★ 对比度修复：honeyDeep 90% 压浅米黄

  /* 动一动 */
  card: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(2.5),
  },
  actHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5), marginBottom: theme.sp(2) },
  actBody: { fontSize: theme.fontSize.sm, lineHeight: theme.fs(20), color: mm.colors.ink, marginBottom: theme.sp(2.5) },
  walkBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2),
  },
  walkLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },
  walkTime: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  walkBtn: { backgroundColor: theme.colors.cardBg, borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(3.5), paddingVertical: theme.sp(1.5), borderWidth: 1, borderColor: mm.colors.cardBorder },
  walkBtnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.skyDeep },
  walkNote: { fontSize: theme.fontSize.micro, lineHeight: theme.fs(16), color: mm.colors.inkFaint, marginTop: theme.sp(2) },
  walkHr: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(17), color: mm.colors.skyDeep, marginTop: theme.sp(2) },
  sayBar: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2),
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    paddingLeft: theme.sp(3), paddingRight: theme.sp(1.5), paddingVertical: theme.sp(1.5),
  },
  sayInput: { flex: 1, fontSize: theme.fontSize.sm, color: mm.colors.ink, paddingVertical: theme.sp(1) },
  sayBtn: { width: theme.sp(7), height: theme.sp(7), borderRadius: theme.radius.pill, backgroundColor: mm.colors.purpleCore, alignItems: 'center', justifyContent: 'center' },
  sayHint: { fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginTop: theme.sp(2) },
  returnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.sp(1), paddingVertical: theme.sp(2.5), marginTop: theme.sp(1) },

  /* ⑤ 夸一个人 */
  cmpCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(2.5),
  },
  cmpInput: { fontSize: theme.fontSize.body, lineHeight: theme.fs(22), color: mm.colors.ink, paddingVertical: theme.sp(1), minHeight: theme.sp(14), textAlignVertical: 'top' },
  cmpLine: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.cardBorder, marginVertical: theme.sp(1.5) },
  cmpHint: { fontSize: theme.fontSize.xs, lineHeight: theme.fs(17), color: mm.colors.inkSoft },
  cmpOk: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(1.5), marginTop: theme.sp(1) },
  cmpOkText: { flex: 1, fontSize: theme.fontSize.xs, lineHeight: theme.fs(19), color: mm.colors.inkSoft },

  /* ⑥/⑧ 圆形倒计时 + 提示行 */
  svChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1.5), marginBottom: theme.sp(2) },
  svChip: { borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(1.5), backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder },
  svChipOn: { backgroundColor: mm.colors.limeSoft, borderColor: mm.colors.limeSoft },
  svChipText: { fontSize: theme.fontSize.xs, color: mm.colors.inkSoft },
  svChipTextOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold as never },
  svCustomInput: {
    fontSize: theme.fontSize.sm, color: mm.colors.ink, backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md, paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2), marginBottom: theme.sp(2),
  },
  svRingWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: theme.sp(3) },
  svRingCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  svRingNum: { fontSize: theme.fs(40), fontWeight: theme.weight.bold as never, color: mm.colors.ink, lineHeight: theme.fs(46) },
  svRingNumBig: { fontSize: theme.fs(34), fontWeight: theme.weight.bold as never, color: mm.colors.ink, lineHeight: theme.fs(40) },
  svRingLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginTop: theme.sp(0.5) },
  svPrompts: { gap: theme.sp(1.5), marginBottom: theme.sp(2) },
  svPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2),
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2.5),
  },
  svPromptText: { flex: 1, fontSize: theme.fontSize.xs, color: mm.colors.ink },

  /* ⑦ 给未来写信 */
  ftCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(2.5),
  },
  ftDeliver: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2),
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3), paddingVertical: theme.sp(2.5), marginBottom: theme.sp(2),
  },

  /* 底部 CTA */
  ctaWrap: { paddingTop: theme.sp(1), paddingBottom: theme.sp(1) },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  ctaGrad: { paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaGradText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.btnTextOnGrad },
  ctaGhost: { borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(4), paddingVertical: theme.sp(3.5), backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder },
  ctaGhostText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft },
  foot: { fontSize: theme.fontSize.micro, lineHeight: theme.fs(16), color: mm.colors.inkFaint, textAlign: 'center', marginTop: theme.sp(2) },
});
