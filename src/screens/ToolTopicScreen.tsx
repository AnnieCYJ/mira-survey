/**
 * ToolTopicScreen —— 工具页通用内容页（v18.70）
 *
 * 承接工具页六宫格中尚无独立模块的三类：提升颜值 / 运动建议 / 知识科普。
 * 结构：标题 + 副标题 + 一条「今日状态」数据驱动提示 + 知识条目（ListCard）。
 * v18.70：知识科普（learn）改版为图文科普样式——hero 插画卡 + 文章列表卡，
 *         点进 LearnRead 阅读详情页（参考图文阅读排版）。
 * 内容口径：平实、带原因、不做诊断承诺（Mira 文案铁律）。
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ImageBackground, TouchableOpacity, Image, type ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { useNavigation, useRoute, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import ListCard, { type ListItem } from '../components/ListCard';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import {
  SPORT_KINDS, SPORT_KIND_MAP, estimateKcal,
  todaySportLogs, saveSportLog,
  type SportLog,
} from '../lib/sportLog';
import { resolveSportName, estimateSportKcal } from '../lib/veepooSportTypes';
import {
  sportVisualOf, heartZoneOf, HEART_ZONES,
  formatClock, formatDistance, formatPace, paceOf, sportTimeLabel,
} from '../lib/sportVisual';
import { buildTodayWorkout, type TodayWorkout } from '../lib/todayWorkout';
import type { Caution } from '../lib/workoutLibrary';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { dateKeyOf } from '../lib/foodAi';
import type { RingSportSession } from '../ble/RingBleManager';
import { LEARN_ARTICLES, LEARN_HERO_ID, getLearnArticle } from '../lib/learnArticles';
import { GLOW_ARTICLES, GLOW_HERO_ID, getGlowArticle } from '../lib/glowArticles';
import { SPORT_ARTICLES, SPORT_HERO_ID, getSportArticle } from '../lib/sportArticles';
import { NUTRITION_ARTICLES, getNutritionArticle } from '../lib/nutritionArticles';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type TopicKey = 'glow' | 'sport' | 'learn' | 'nutrition' | 'sportArticles';

const TOPIC_META: Record<TopicKey, { title: string; sub: string }> = {
  glow: { title: '提升颜值', sub: '跟着周期节奏，把气色养回来' },
  sport: { title: '运动建议', sub: '按今天的状态开运动处方' },
  learn: { title: '知识科普', sub: '平衡激素的四根杠杆：光 · 睡 · 压 · 动' },
  nutrition: { title: '饮食营养', sub: '吃对了，激素才稳' },
  sportArticles: { title: '运动科普', sub: '周期 × 荷尔蒙的运动科学' },
};

const ACCENT: Record<TopicKey, string> = {
  glow: theme.colors.stateTense,
  sport: '#22C55E',
  learn: theme.colors.accent2,
  nutrition: '#E08A3C',
  sportArticles: '#22C55E',
};

export default function ToolTopicScreen() {
  const route = useRoute<{ key: string; name: string; params: { topic: TopicKey } }>();
  const navigation = useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>>();
  const topic: TopicKey = (route.params?.topic ?? 'learn') as TopicKey;
  const meta = TOPIC_META[topic] ?? TOPIC_META.learn;
  const scrollY = useRef(new Animated.Value(0)).current;
  /** 交给 ScreenContainer：供运动页「进入今日运动建议」滚到方案卡 */
  const scrollRef = useRef<ScrollView>(null);
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  // ── 当天数据（缺项静默降级，不编数字） ──
  const ring = RingBle.getState();
  const now = Date.now();
  const sleep = (() => {
    try { return healthStore.getSleep(dayKey(now)) ?? healthStore.getSleep(dayKey(now - 86400000)); } catch { return null; }
  })();
  const sleepScore = sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  const steps = (() => { try { return ring?.stepDaily?.[dayKey(now)]?.steps ?? 0; } catch { return 0; } })();
  const phase = ring?.curveStatus?.phaseLabel ?? '未记录';
  const value = ring?.curveStatus?.value ?? null;
  const dayInCycle = ring?.curveStatus?.dayInCycle ?? null;
  /** 今天的「今日状态」半小时轨迹（curve 模型每 30 分钟累积一个点，不是固定分）——
   *  给 UI 画迷你条，也是「比今早低 X 分」的唯一真实来源，没有就不显示差值。 */
  const todayTimeline = (() => {
    const list = (ring?.statusTimeline ?? []) as { t?: number; value?: number }[] | null;
    if (!list?.length) return null;
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const pts = list.filter((p) => p && p.t != null && (p.t as number) >= start && Number.isFinite(p.value));
    return pts.length ? (pts as { t: number; value: number }[]) : null;
  })();
  /** 皮质醇节律标签（正常 / 偏高 / 节律紊乱）——只有 ≥4 个样本才算，否则整行不显示 */
  const cortisolLabel = (() => {
    try {
      const samples = (healthStore.getIntraday?.('cortisol', dayKey(now)) ?? []) as { t: number; v: number }[];
      if (!Array.isArray(samples) || samples.length < 4) return null;
      const r = analyzeCortisol(samples, 14);
      const lv = (r as { todayLevel?: string }).todayLevel;
      return lv === 'high' ? '偏高' : lv === 'dysregulated' ? '节律紊乱' : '正常';
    } catch {
      return null;
    }
  })();
  const levelIdx = value != null ? (value >= 65 ? 0 : value >= 30 ? 1 : value >= 5 ? 2 : 3) : null;
  const hrv = (() => { try { return ring?.hrvDaily?.[dayKey(now)] ?? null; } catch { return null; } })();
  /** 昨日睡眠（dayKey(now) = 昨天，睡的是昨夜）→ 总/深睡时长（分钟） */
  const sleepLast = (() => {
    try {
      return healthStore.getSleep(dayKey(now)) ?? healthStore.getSleep(dayKey(now - 86400000));
    } catch { return null; }
  })();
  /** 最近几天的「今日状态」均值 / HRV 均值（不含今天），用于对比分析 */
  const recentAvg = (daily: Record<string, number> | undefined, days: number): number | null => {
    if (!daily) return null;
    const keys = Object.keys(daily).sort().slice(-days - 1, -1); // 不含今天
    const nums = keys.map((k) => daily[k]).filter((v) => Number.isFinite(v) && v > 0);
    if (!nums.length) return null;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  };
  const statusAvg = (() => { try { return recentAvg(ring?.statusDaily, 7); } catch { return null; } })();
  const hrvAvg = (() => { try { return recentAvg(ring?.hrvDaily, 7); } catch { return null; } })();
  /** 今日建议：周期阶段 × 今日状态 × 最近健康情况 → 分析 + 大概建议 + 可执行方案（v18.89→v18.90）；
   *  数据缺失时退到保守通用档，分析行不会出现不存在的「今日状态 X / 睡眠 Y 分」。 */
  const plan = buildTodayWorkout({
    phase, value, statusAvg, sleepScore, now,
    sleepTotalMin: sleepLast?.total ?? null,
    sleepDeepMin: sleepLast?.deep ?? null,
    hrv, hrvAvg, steps, dayInCycle,
    timeline: todayTimeline,
    cortisolLabel,
  });

  // ── 「今日」一条数据驱动提示 ──
  const today: ListItem = (() => {
    if (topic === 'glow') {
      if (sleepScore == null) return { dot: ACCENT.glow, title: '睡眠与气色', sub: '连续佩戴记录睡眠后，这里会告诉你昨晚的修复给气色加了多少分。' };
      return sleepScore >= 80
        ? { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: `${phase}期皮肤修复窗口在线——今天防晒做好，气色能保住。` }
        : { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: '皮肤屏障修复主要发生在深睡——今晚提前 30 分钟放下手机。' };
    }
    if (topic === 'sport') {
      if (levelIdx == null) return { dot: ACCENT.sport, title: '今日运动建议', sub: '戴上戒指后，这里会按你的今日状态、昨晚睡眠和周期阶段给一段分析和建议。' };
      if (phase === '经期') return { dot: ACCENT.sport, title: `今日状态 ${Math.round(value!)}`, sub: '经期以低强度为主：散步、拉伸、温和瑜伽都合适。' };
      if (levelIdx === 0) return { dot: ACCENT.sport, title: `今日状态 ${Math.round(value!)}`, sub: '状态在高位，可以适度加一点训练量，但别一次冲满。' };
      return { dot: ACCENT.sport, title: `今日状态 ${Math.round(value!)}`, sub: '状态偏低，先快走 15 分钟活动代谢，别硬扛大强度。' };
    }
    // learn
    return phase === '未记录'
      ? { dot: ACCENT.learn, title: '周期与大脑', sub: '记录经期后，科普内容会跟着你的周期阶段一起更新。' }
      : { dot: ACCENT.learn, title: `当前 ${phase}`, sub: '本阶段激素如何影响精力与情绪，下方条目按你的周期定制。' };
  })();

  // ── 静态知识条目 ──
  // v18.42：原条目全保留，下方追加斯坦福平衡激素法则条目；
  // 与其他模块重复的内容不在这里重复（睡眠类并进「稳定睡眠」页，NSDR 并进呼吸冥想）
  const items: ListItem[] = topic === 'glow'
    ? [
        { dot: ACCENT.glow, title: '卵泡期：皮肤血流量增加', sub: '雌激素上行让皮肤供血变好，是上妆最服帖的窗口。' },
        { dot: ACCENT.glow, title: '黄体期：出油与敏感上行', sub: '孕激素升高伴随体温上升，精简护肤、少叠加功效品。' },
        { dot: ACCENT.glow, title: '糖化是暗沉主因之一', sub: '高糖饮食后的糖化终产物让肤色发黄，先从含糖饮料下手。' },
        { dot: ACCENT.glow, title: '防晒是性价比最高的护肤', sub: '紫外线贡献了外源性衰老的大头，阴天也有 UVA。' },
        { dot: ACCENT.glow, title: '晨光：免费的气色开关', sub: '起床 30-60 分钟内到户外见光 5-10 分钟——皮质醇准点爬升、褪黑素准点到来，节律顺了气色是结果。' },
        { dot: ACCENT.glow, title: '压力皮质醇是暗沉推手', sub: '长期高压让皮质醇持续偏高，出油、爆痘跟着来；两次短吸加一次长呼的生理性叹息能快速降温。' },
      ]
    : topic === 'sport'
      ? [
          { dot: ACCENT.sport, title: '卵泡期：适合上强度', sub: '雌激素高位时肌肉恢复快、疼痛敏感低，力量训练安排在这里。' },
          { dot: ACCENT.sport, title: '黄体期后期：降强度提频次', sub: '核心体温升高、恢复变慢，把大重量换成中低强度多次数。' },
          { dot: ACCENT.sport, title: 'HRV 是强度调节器', sub: '晨间 HRV 明显低于基线时，把当天的强度课换成恢复课。' },
          { dot: ACCENT.sport, title: '步数是底线不是目标', sub: '每天 7000 步以上的日常活动量，比一周一次大练更养线粒体。' },
          { dot: ACCENT.sport, title: 'Zone 2 是激素底盘', sub: '每周 2-3 次「还能对话」节奏的有氧，改善线粒体与胰岛素敏感性——所有激素平稳运转的地基。' },
          { dot: ACCENT.sport, title: '力量训练是激素杠杆', sub: '每周 2-4 次复合动作优先的力量训练，对胰岛素敏感性和情绪韧性都有长期回报。' },
        ]
      : [
          { dot: ACCENT.learn, title: '雌激素与大脑敏感性', sub: '雌激素影响血清素与多巴胺通路，卵泡期精力上扬有生理基础。' },
          { dot: ACCENT.learn, title: '孕激素的镇静与代价', sub: '黄体期孕激素代谢物作用于 GABA 受体，嗜睡与情绪波动的来源。' },
          { dot: ACCENT.learn, title: '皮质醇的晨峰意义', sub: '晨起皮质醇高峰帮你清醒；节律偏晚，上午就没精神——晨光是最准的校准器。' },
          { dot: ACCENT.learn, title: '多巴胺基线：别喂廉价刺激', sub: '刷手机、糖、频繁切换任务都在抬高多巴胺基线，难事显得无趣；早上第一小时别喂手机。' },
          { dot: ACCENT.learn, title: '为什么戒指测不了激素', sub: '激素分子需要生化检测；戒指测的是它们留下的生理足迹。' },
        ];

  return (
    <View style={styles.page}>
      <LinearGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer scrollY={scrollY} scrollRef={scrollRef} topFadeColor={theme.colors.textWhite}>
        {/* 返回按钮 */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
        </TouchableOpacity>

        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>{meta.title}</Text>
          <Text style={styles.subtitle}>{meta.sub}</Text>
        </Animated.View>
        {(topic === 'learn' || topic === 'glow' || topic === 'sport' || topic === 'nutrition' || topic === 'sportArticles') ? (
          topic === 'learn'
            ? <LearnSection phase={phase} navigation={navigation} />
            : topic === 'glow'
              ? <GlowSection sleepScore={sleepScore} navigation={navigation} />
              : topic === 'sport'
                ? <SportSection navigation={navigation} plan={plan} />
                : topic === 'nutrition'
                  ? <NutritionSection navigation={navigation} />
                  : <SportArticlesSection navigation={navigation} />
        ) : (
          <>
            <ListCard title="今天" items={[today]} />
            <View style={{ height: theme.space.md }} />
            <ListCard title="为什么 & 怎么做" items={items} />
          </>
        )}
      </ScreenContainer>
    </View>
  );
}

/* ── 知识科普 · 图文科普版块（v18.70）────────────────────────
 * 参考图文科普样式：hero 插画大卡（本周主题）+ 文章列表卡
 * （左缩略图 + 分类·时长眉行 + 标题 + 阅读全文 →）。
 * 数据全部来自 learnArticles.ts 静态文章库，无假数据。
 */
type TopicNav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  StackNavigationProp<RootStackParamList>
>;

function LearnSection({ phase, navigation }: { phase: string; navigation: TopicNav }) {
  const hero = getLearnArticle(LEARN_HERO_ID);
  const articles = LEARN_ARTICLES.filter((a) => a.id !== LEARN_HERO_ID);
  return (
    <>
      {/* Hero 插画卡：图铺满，左上叠白色信息卡 */}
      <TouchableOpacity
        activeOpacity={theme.press.opacity}
        onPress={() => navigation.navigate('LearnRead', { articleId: hero.id })}
        accessibilityRole="button"
        accessibilityLabel={`阅读 ${hero.title}`}
      >
        <ImageBackground
          source={hero.cover}
          style={ls.hero}
          imageStyle={{ borderRadius: theme.radius.card }}
          resizeMode="cover"
        >
          <View style={ls.heroCard}>
            <Text style={ls.heroEyebrow}>{hero.eyebrow}</Text>
            <Text style={ls.heroTitle} numberOfLines={2}>{hero.shortTitle ?? hero.title}</Text>
            <View style={ls.heroLinkRow}>
              <Text style={ls.heroLink}>开始阅读</Text>
              <Text style={ls.heroLink}> →</Text>
            </View>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      {/* 周期关联提示（诚实口径：未记录就直说） */}
      <Text style={ls.phaseTip}>
        {phase === '未记录'
          ? '记录经期后，内容会跟着你的周期阶段更新。'
          : `当前 ${phase} · 内容跟着你的周期阶段更新`}
      </Text>

      {/* 列表区标题 */}
      <View style={ls.secHead}>
        <Text style={ls.secTitle}>为你现在的阶段挑的</Text>
        <Text style={ls.secCount}>{articles.length} 篇</Text>
      </View>

      {/* 文章列表卡 */}
      {articles.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={ls.articleCard}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={ls.thumb} resizeMode="cover" />
          <View style={ls.articleBody}>
            <Text style={ls.articleEyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={ls.articleTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={ls.articleLink}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

/* ── 提升颜值 · 图文版块（v18.79）────────────────────────
 * 与知识科普完全同构（hero 插画卡 + 文章列表卡，复用 ls 样式）。
 * 内容：斯坦福皮肤科共识 + 明星极简护肤路线（glowArticles.ts，静态无假数据）。
 * 顶部提示行带昨晚睡眠分（有数据才展示，诚实口径）。
 */
function GlowSection({ sleepScore, navigation }: { sleepScore: number | null; navigation: TopicNav }) {
  const hero = getGlowArticle(GLOW_HERO_ID);
  const articles = GLOW_ARTICLES.filter((a) => a.id !== GLOW_HERO_ID);
  return (
    <>
      <TouchableOpacity
        activeOpacity={theme.press.opacity}
        onPress={() => navigation.navigate('LearnRead', { articleId: hero.id, collection: 'glow' })}
        accessibilityRole="button"
        accessibilityLabel={`阅读 ${hero.title}`}
      >
        <ImageBackground
          source={hero.cover}
          style={ls.hero}
          imageStyle={{ borderRadius: theme.radius.card }}
          resizeMode="cover"
        >
          <View style={ls.heroCard}>
            <Text style={ls.heroEyebrow}>{hero.eyebrow}</Text>
            <Text style={ls.heroTitle} numberOfLines={2}>{hero.shortTitle ?? hero.title}</Text>
            <View style={ls.heroLinkRow}>
              <Text style={ls.heroLink}>开始阅读</Text>
              <Text style={ls.heroLink}> →</Text>
            </View>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      {/* 状态提示行（诚实口径：睡眠没记录就直说） */}
      <Text style={ls.phaseTip}>
        {sleepScore != null
          ? `昨晚睡眠 ${sleepScore} 分 · 皮肤修复主要发生在深睡`
          : '记录睡眠后，这里会告诉你昨晚的修复给气色加了多少分。'}
      </Text>

      <View style={ls.secHead}>
        <Text style={ls.secTitle}>简单方法，先做稳的</Text>
        <Text style={ls.secCount}>{articles.length} 篇</Text>
      </View>

      {articles.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={ls.articleCard}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'glow' })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={ls.thumb} resizeMode="cover" />
          <View style={ls.articleBody}>
            <Text style={ls.articleEyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={ls.articleTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={ls.articleLink}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

/* ── 运动建议 · 图文版块（v18.83）────────────────────────
 * 与知识科普/提升颜值同构（hero 插画卡 + 文章列表卡，复用 ls 样式）。
 * 内容：周期阶段 × 荷尔蒙运动科学（sportArticles.ts，静态无假数据）。
 * 顶部提示行带今日步数/今日状态（有数据才展示，诚实口径）。
 */
function SportSection({ navigation, plan }: {
  navigation: TopicNav; plan: TodayWorkout;
}) {
  /* ── 记录运动：运动种类选择 + 时长 + 保存（v18.87）────────── */
  const todayKey = dateKeyOf();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<number>(1);
  const [minutes, setMinutes] = useState('30');
  const [records, setRecords] = useState<SportLog[]>(() => todaySportLogs(dateKeyOf()));

  const kindName = SPORT_KIND_MAP[kind]?.typeName ?? '跑步';
  const minutesNum = Math.max(1, Number(minutes) || 0);
  const previewKcal = estimateKcal(kind, minutesNum);

  const openPicker = () => {
    setRecords(todaySportLogs(dateKeyOf()));
    setPickerOpen(true);
  };
  const closePicker = () => setPickerOpen(false);
  const confirmRecord = () => {
    const next = saveSportLog({
      dateKey: todayKey, type: kind, typeName: kindName,
      totalTime: minutesNum * 60, totalCal: previewKcal,
    });
    setRecords(next.filter((r) => r.dateKey === todayKey));
    setPickerOpen(false);
  };

  return (
    <>
      {/* ① 为什么今天这么动（激素 / 皮质醇 / 昨晚）→ 结论 */}
      <SportWhyCard plan={plan} />
      <View style={{ height: theme.space.md }} />

      {/* ③ 今日运动建议（方案 + 三段动作；无 CTA，落点只有底部「记录运动」） */}
      <SportPlanCard plan={plan} />
      <View style={{ height: theme.space.md }} />
      <SportCautionCard cautions={plan.cautions} />
      <View style={{ height: theme.space.md }} />

      {/* 底部：运动记录和分析 */}
      <SportRecordsSection />

      {/* 记录运动：展开运动种类选择面板 */}
      {pickerOpen && (
        <View style={ss.pickerWrap}>
          <Text style={ss.pickerTitle}>选择运动种类</Text>
          <View style={ss.kindRow}>
            {SPORT_KINDS.map((k) => {
              const active = k.type === kind;
              return (
                <TouchableOpacity
                  key={k.type}
                  activeOpacity={0.8}
                  style={[ss.kindChip, active && ss.kindChipActive]}
                  onPress={() => setKind(k.type)}
                  accessibilityRole="button"
                  accessibilityLabel={k.typeName}
                >
                  <Text style={[ss.kindChipText, active && ss.kindChipTextActive]}>{k.typeName}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={ss.minuteRow}>
            <Text style={ss.minuteLabel}>时长（分钟）</Text>
            <View style={ss.minuteStepper}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={ss.minuteBtn}
                onPress={() => setMinutes(String(Math.max(1, minutesNum - 5)))}
                accessibilityRole="button"
                accessibilityLabel="减少 5 分钟"
              >
                <Text style={ss.minuteBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={ss.minuteValue}>{minutesNum}</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                style={ss.minuteBtn}
                onPress={() => setMinutes(String(minutesNum + 5))}
                accessibilityRole="button"
                accessibilityLabel="增加 5 分钟"
              >
                <Text style={ss.minuteBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={ss.kcalHint}>
            {kindName} · {minutesNum} 分钟 ≈ {previewKcal} kcal（按 55kg 粗估）
          </Text>

          <View style={ss.pickerActionRow}>
            <TouchableOpacity activeOpacity={0.8} style={ss.pickerCancel} onPress={closePicker} accessibilityRole="button">
              <Text style={ss.pickerCancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={{ flex: 1 }} onPress={confirmRecord}>
              <LinearGradient
                colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={ss.recordGrad}
              >
                <Text style={ss.recordBtnText}>保存记录</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 底部操作行：左 查看更多科普 · 右 记录运动 */}
      <View style={ss.actionRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={ss.moreSciBtn}
          onPress={() => navigation.navigate('ToolTopic', { topic: 'sportArticles' })}
          accessibilityRole="button"
          accessibilityLabel="查看更多科普"
        >
          <Text style={ss.moreSciText}>查看更多科普</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} style={{ flex: 1 }} onPress={pickerOpen ? closePicker : openPicker}>
          <LinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={ss.recordGrad}
          >
            <Text style={ss.recordBtnText}>{pickerOpen ? '收起' : '记录运动'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

/* ── 运动记录和分析（参考 Apple Fitness / Garmin / Keep 的运动记录卡）──────────
 * 每段运动一张独立卡：类别色图标 + 名称/来源/时间 + 时长大字，
 * 下方指标列（距离 · 消耗 · 步数 · 平均心率），有心率时再挂一条 4 段心率区间条。
 * 字段口径：戒指固件 VPDeviceSportModel 里本来就有这些（totalDis/totalStep/averHeart），
 * 只是原生桥没全部透传，这里用已有字段自算配速，不编数据。
 */
interface WorkoutItem {
  key: string;
  name: string;
  type?: number;
  source: 'ring' | 'manual';
  /** 固件时间 "yyyy-MM-dd HH:mm:ss" */
  beginTime?: string;
  /** 手动记录时间戳(ms) */
  ts?: number;
  seconds: number;
  kcal: number;
  distanceM?: number;
  steps?: number;
  heart?: number;
}

const SMALL_INK = mm.colors.inkSoft;

function SportWorkoutCard({ item }: { item: WorkoutItem }) {
  const vis = sportVisualOf(item.type);
  const zone = heartZoneOf(item.heart);
  const pace = item.distanceM ? paceOf(item.distanceM, item.seconds) : null;
  const paceText = pace ? `${formatPace(pace)}"/km` : '';

  // 指标列：只放真实有的数据（无数据不占位）
  const stats: { label: string; value: string }[] = [];
  if (item.distanceM && item.distanceM > 0) stats.push({ label: '距离', value: formatDistance(item.distanceM) });
  if (item.kcal > 0) stats.push({ label: '消耗', value: `${Math.round(item.kcal)}` });
  if (item.steps && item.steps > 0) stats.push({ label: '步数', value: item.steps.toLocaleString('en-US') });
  if (item.heart && item.heart > 0) stats.push({ label: '心率', value: `${item.heart}` });

  // 副行：来源 · 时间 · 配速（有才显示）
  const metaParts = [
    item.source === 'ring' ? '戒指识别' : '手动记录',
    item.beginTime ? sportTimeLabel(item.beginTime) : '',
    paceText,
  ].filter(Boolean);

  return (
    <View style={ss.wkCard}>
      {/* 顶行：类别色圆图标 + 名称/副行 + 时长大字 */}
      <View style={ss.wkHead}>
        <View style={[ss.wkIco, { backgroundColor: vis.color }]}>
          <Text style={ss.wkEmoji}>{vis.emoji}</Text>
        </View>
        <View style={ss.wkHeadBody}>
          <Text style={ss.wkName} numberOfLines={1}>{item.name}</Text>
          {!!metaParts.length && <Text style={ss.wkMeta} numberOfLines={1}>{metaParts.join(' · ')}</Text>}
        </View>
        <Text style={ss.wkDur}>{formatClock(item.seconds)}</Text>
      </View>

      {/* 指标列 */}
      {!!stats.length && (
        <View style={ss.wkStats}>
          {stats.map((s) => (
            <View key={s.label} style={ss.wkStat}>
              <Text style={ss.wkStatVal}>{s.value}</Text>
              <Text style={ss.wkStatLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 心率区间条（Garmin/Apple 那种 4 段，当前区间高亮） */}
      {!!zone && (
        <View style={ss.wkZone}>
          <View style={ss.wkZoneTop}>
            <View style={[ss.wkZoneTag, { backgroundColor: zone.zone.color }]}>
              <Text style={[ss.wkZoneTagText, { color: zone.zone.onColor }]}>{zone.zone.label}</Text>
            </View>
            <Text style={ss.wkZoneHint}>平均心率 {item.heart} bpm</Text>
          </View>
          <View style={ss.wkZoneBar}>
            {HEART_ZONES.map((z, i) => (
              <View
                key={z.label}
                style={[ss.wkZoneSeg, i <= zone.index ? { backgroundColor: z.color } : null]}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function SportRecordsSection() {
  const ring = RingBle.getState();
  const sessions: RingSportSession[] = ring?.sportSessions ?? [];
  const [manual, setManual] = useState<SportLog[]>(() => todaySportLogs(dateKeyOf()));

  // 手动记录与戒指识别段合并展示（戒指那侧不落库，重连即刷新）
  const items: WorkoutItem[] = [
    ...manual.map((m) => ({
      key: `m-${m.id}`,
      name: m.typeName,
      type: m.type,
      source: 'manual' as const,
      ts: m.ts,
      seconds: m.totalTime,
      kcal: m.totalCal,
    })),
    ...sessions.map((s) => ({
      key: `r-${s.beginTime ?? s.endTime ?? Date.now()}-${s.type}`,
      // 原生 sportNameForType: 只映射前 53 项，超出会回「未知(N)」→ 用 VPDeviceRuningMode 全量表按 type 还原
      name: resolveSportName(s.type, s.typeName),
      type: s.type,
      source: 'ring' as const,
      beginTime: s.beginTime,
      seconds: s.totalTime,
      // 固件没给消耗时按 MET 粗估，不显示 0
      kcal: s.totalCal > 0 ? s.totalCal : estimateSportKcal(s.type, Math.round((s.totalTime || 0) / 60)),
      distanceM: s.totalDis,
      steps: s.totalStep,
      heart: s.averHeart || undefined,
    })).sort((a, b) => String(b.beginTime ?? '').localeCompare(String(a.beginTime ?? ''))),
  ];
  const has = items.length > 0;
  const totalKcal = items.reduce((a, r) => a + r.kcal, 0);
  const totalSec = items.reduce((a, r) => a + r.seconds, 0);
  const ringCount = sessions.length;

  return (
    <View style={ss.recWrap}>
      <View style={ss.secHead}>
        <Text style={ss.secTitle}>运动记录和分析</Text>
        {has && (
          <View style={ss.secSumRow}>
            <View style={ss.secSumChip}>
              <Text style={ss.secSumText}>{items.length} 段</Text>
            </View>
            <View style={ss.secSumChip}>
              <Text style={ss.secSumText}>{formatClock(totalSec)}</Text>
            </View>
            <View style={ss.secSumChip}>
              <Text style={ss.secSumText}>{Math.round(totalKcal)} kcal</Text>
            </View>
          </View>
        )}
      </View>

      {has ? (
        items.map((it) => <SportWorkoutCard key={it.key} item={it} />)
      ) : (
        <View style={ss.emptyCard}>
          <View style={ss.emptyIco}>
            <Text style={ss.emptyIcoText}>🏃‍♀️</Text>
          </View>
          <Text style={ss.emptyTitle}>还没有运动记录</Text>
          <Text style={ss.emptySub}>点下方「记录运动」选个种类就能记一笔；佩戴 Mira 戒指完成运动，这里也会自动出现识别到的类型与时间距离。</Text>
        </View>
      )}

      {ringCount === 0 && has && (
        <Text style={ss.recFoot}>戒指还没同步到多运动段，当前只显示你手动记的 {items.length} 段。</Text>
      )}
    </View>
  );
}

const ls = StyleSheet.create({
  hero: {
    height: theme.sp(42),
    justifyContent: 'flex-start',
  },
  heroCard: {
    alignSelf: 'flex-start',
    maxWidth: '78%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.cardPadCompact,
    paddingVertical: theme.space.cardPadCompact,
    marginLeft: theme.sp(3),
    marginTop: theme.sp(3),
  },
  heroEyebrow: {
    fontSize: theme.fs(10.5),
    fontWeight: theme.weight.semibold,
    letterSpacing: 1,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(1),
  },
  heroTitle: {
    fontSize: theme.fs(15.5),
    lineHeight: theme.fs(21),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  heroLinkRow: { flexDirection: 'row' },
  heroLink: {
    fontSize: theme.fs(12),
    fontWeight: theme.weight.semibold,
    color: mm.chipBg.lav.fg,
  },
  phaseTip: {
    fontSize: theme.fs(12),
    color: mm.colors.inkFaint,
    marginTop: theme.sp(2.5),
    marginBottom: theme.space.lg,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  secTitle: {
    fontSize: theme.fs(15),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  secCount: {
    fontSize: theme.fs(12),
    color: mm.colors.inkFaint,
  },
  articleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(2.5),
  },
  thumb: {
    width: theme.sp(14),
    height: theme.sp(14),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  articleBody: {
    flex: 1,
    marginLeft: theme.sp(3),
  },
  articleEyebrow: {
    fontSize: theme.fs(10.5),
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(0.5),
  },
  articleTitle: {
    fontSize: theme.fs(14),
    lineHeight: theme.fs(19),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  articleLink: {
    fontSize: theme.fs(11.5),
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
  },
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.inkSoft,
    marginBottom: theme.space.md,
  },
});

/* ── 饮食营养 · 图文版块（v18.86 新增）────────────────────────
 * 与 learn/glow/sport 同构（hero 插画卡 + 文章列表卡，复用 ls 样式）。
 * 内容：荷尔蒙 × 营养（nutritionArticles.ts，静态无假数据）。
 * 「更多科普」按钮落点之一（饮食页底部「更多科普」→ ToolTopic nutrition）。
 */
function NutritionSection({ navigation }: { navigation: TopicNav }) {
  const hero = NUTRITION_ARTICLES[0];
  const articles = NUTRITION_ARTICLES.slice(1);
  return (
    <>
      <TouchableOpacity
        activeOpacity={theme.press.opacity}
        onPress={() => navigation.navigate('LearnRead', { articleId: hero.id, collection: 'nutrition' })}
        accessibilityRole="button"
        accessibilityLabel={`阅读 ${hero.title}`}
      >
        <ImageBackground
          source={hero.cover}
          style={ls.hero}
          imageStyle={{ borderRadius: theme.radius.card }}
          resizeMode="cover"
        >
          <View style={ls.heroCard}>
            <Text style={ls.heroEyebrow}>{hero.eyebrow}</Text>
            <Text style={ls.heroTitle} numberOfLines={2}>{hero.shortTitle ?? hero.title}</Text>
            <View style={ls.heroLinkRow}>
              <Text style={ls.heroLink}>开始阅读</Text>
              <Text style={ls.heroLink}> →</Text>
            </View>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      <Text style={ls.phaseTip}>真实可查的营养科学，吃对了激素才稳。</Text>

      <View style={ls.secHead}>
        <Text style={ls.secTitle}>饮食营养科普</Text>
        <Text style={ls.secCount}>{articles.length} 篇</Text>
      </View>

      {articles.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={ls.articleCard}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'nutrition' })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={ls.thumb} resizeMode="cover" />
          <View style={ls.articleBody}>
            <Text style={ls.articleEyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={ls.articleTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={ls.articleLink}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

/* ── 运动科普 · 图文版块（v18.86 从 SportSection 拆出）────────────────────────
 * 「查看更多科普」的落点：完整运动科学文章列表。
 */
function SportArticlesSection({ navigation }: { navigation: TopicNav }) {
  const hero = getSportArticle(SPORT_HERO_ID);
  const articles = SPORT_ARTICLES.filter((a) => a.id !== SPORT_HERO_ID);
  return (
    <>
      <TouchableOpacity
        activeOpacity={theme.press.opacity}
        onPress={() => navigation.navigate('LearnRead', { articleId: hero.id, collection: 'sport' })}
        accessibilityRole="button"
        accessibilityLabel={`阅读 ${hero.title}`}
      >
        <ImageBackground
          source={hero.cover}
          style={ls.hero}
          imageStyle={{ borderRadius: theme.radius.card }}
          resizeMode="cover"
        >
          <View style={ls.heroCard}>
            <Text style={ls.heroEyebrow}>{hero.eyebrow}</Text>
            <Text style={ls.heroTitle} numberOfLines={2}>{hero.shortTitle ?? hero.title}</Text>
            <View style={ls.heroLinkRow}>
              <Text style={ls.heroLink}>开始阅读</Text>
              <Text style={ls.heroLink}> →</Text>
            </View>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      <Text style={ls.phaseTip}>周期阶段 × 荷尔蒙，给你可执行的训练节奏。</Text>

      <View style={ls.secHead}>
        <Text style={ls.secTitle}>运动科普</Text>
        <Text style={ls.secCount}>{articles.length} 篇</Text>
      </View>

      {articles.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={ls.articleCard}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'sport' })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={ls.thumb} resizeMode="cover" />
          <View style={ls.articleBody}>
            <Text style={ls.articleEyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={ls.articleTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={ls.articleLink}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
      <View style={{ height: theme.space.xl }} />
    </>
  );
}

/* ── 今日训练建议卡（v18.89 参考 Garmin Daily Suggested Workout / Keep 今日训练 / Flo 周期化建议）──────
 * 成熟 App 给「建议」的做法不是列一堆小提示，而是：一个具体动作 + 为什么今天这么安排
 * （真实数据当理由）+ 目标心率 + 分段动作 + 一处 CTA。注意事项作为附属小块，弱化处理。
 */
/**
 * 今日状态分析卡（v18.90）——放在「今日运动建议」正上方：
 *   一段基于真实数据的分析（今日状态 / 昨晚睡眠 / 晨间 HRV / 步数）
 *   + 一句大概建议（结论）
 *   + 一条「今日状态」刻度（四档口语名，替代看不懂的低/中/高强度）
 *   + 一个「进入今日运动建议」入口。
 * 不编数据：每一项分析只在对应字段存在时渲染，缺了就不显示。
 */
/** 三枚软色圆 chip 的图标（参考 App 五色相：紫=周期 · 粉=皮质醇 · 黄绿=今日状态） */
function ChipIcon({ kind }: { kind: 'cycle' | 'cortisol' | 'bolt' }) {
  const color = kind === 'cycle' ? mm.colors.purpleDeep : kind === 'cortisol' ? mm.colors.roseDeep : mm.colors.limeDeep;
  if (kind === 'cycle') {
    return (
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Circle cx={12} cy={12} r={8.5} />
        <Path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5" />
        <Circle cx={12} cy={12} r={3.2} />
      </Svg>
    );
  }
  if (kind === 'cortisol') {
    return (
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M3 15c2.5 0 3-10 6-10s2.5 13 5.5 13 2-6 3.5-6 2 3 3 3" />
      </Svg>
    );
  }
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
    </Svg>
  );
}

/* ── ② 为什么今天这么动（激素 / 皮质醇 / 昨晚 → 一句结论）── */
function SportWhyCard({ plan }: { plan: TodayWorkout }) {
  return (
    <View style={ss.whCard}>
      <Text style={ss.whKicker}>为什么今天这么动</Text>

      {/* 三枚软色圆 chip：周期（紫）· 皮质醇（粉）· 今日状态（黄绿）
       *  文案全部来自 plan（chipHormone / chipCortisol / stateScore），不写死 */}
      <View style={ss.whChips}>
        <View style={[ss.whChip, { backgroundColor: mm.colors.purpleTint }]}>
          <View style={[ss.whChipIco, { backgroundColor: mm.colors.purpleSoft }]}>
            <ChipIcon kind="cycle" />
          </View>
          <Text style={ss.whChipText} numberOfLines={2}>
            {plan.chipHormone[0]}{plan.chipHormone[1] ? `\n${plan.chipHormone[1]}` : ''}
          </Text>
        </View>
        <View style={[ss.whChip, { backgroundColor: mm.colors.roseTint }]}>
          <View style={[ss.whChipIco, { backgroundColor: mm.colors.roseSoft }]}>
            <ChipIcon kind="cortisol" />
          </View>
          <Text style={ss.whChipText} numberOfLines={2}>
            {plan.chipCortisol[1] ? `${plan.chipCortisol[0]}\n${plan.chipCortisol[1]}` : plan.chipCortisol[0]}
          </Text>
        </View>
        <View style={[ss.whChip, { backgroundColor: mm.colors.limeTint }]}>
          <View style={[ss.whChipIco, { backgroundColor: mm.colors.limeSoft }]}>
            <ChipIcon kind="bolt" />
          </View>
          <Text style={ss.whChipText} numberOfLines={2}>{`今日状态\n${plan.stateScore ?? '待同步'}`}</Text>
        </View>
      </View>

      {/* 分析行：每条自带 tag（激素/皮质醇/状态/昨晚…），不再靠下标猜 */}
      {plan.analysis.map((row, i) => (
        <View key={i} style={ss.whFact}>
          <Text style={[ss.whTag, i === 0 && ss.whTagP, i === 1 && ss.whTagR, i > 1 && ss.whTagL]}>{row.tag}</Text>
          <Text style={ss.whFactText}>{row.text}</Text>
        </View>
      ))}

      {/* 结论：一句大概建议 */}
      <View style={ss.whConclusion}>
        <Text style={ss.whConclusionText}>{plan.conclusion}</Text>
      </View>
    </View>
  );
}

function SportPlanCard({ plan }: { plan: TodayWorkout }) {
  return (
    <View style={ss.planCard}>
      {/* 头：类别色圆图标 + 方案标题 + 右侧总时长大字 */}
      <View style={ss.planHead}>
        <View style={[ss.planIco, { backgroundColor: mm.colors.skySoft }]}>
          <Text style={ss.planEmoji}>{plan.emoji}</Text>
        </View>
        <View style={ss.planHeadBody}>
          <Text style={ss.planKicker}>今日运动建议</Text>
          <Text style={ss.planHeadline} numberOfLines={2}>{plan.headline}</Text>
        </View>
        <View style={ss.planDurWrap}>
          <Text style={ss.planDur}>{plan.totalMinutes}</Text>
          <Text style={ss.planDurUnit}>分钟</Text>
        </View>
      </View>

      {/* 无真实数据时，明说这是通用保守方案，别让方案被误读成戒指给的结论 */}
      {!!plan.fallbackNote && (
        <Text style={ss.planFallbackNote}>{plan.fallbackNote}</Text>
      )}

      {/* 目标心率 */}
      <View style={ss.hrRow}>
        <Text style={ss.hrLabel}>目标心率</Text>
        <View style={[ss.hrZoneDot, { backgroundColor: plan.targetZone.color }]} />
        <Text style={ss.hrZoneName}>{plan.targetZone.label}</Text>
        <Text style={ss.hrValue}>{plan.hrTarget}</Text>
      </View>

      {/* 分段动作（热身 / 主项 / 收尾）：竖时间线，不用编号方块 */}
      <View style={ss.stepList}>
        {plan.steps.map((s, i) => {
          const last = i === plan.steps.length - 1;
          return (
            <View key={i} style={ss.stepRow}>
              <View style={ss.stepRail}>
                <View style={ss.stepDot} />
                {!last && <View style={ss.stepLine} />}
              </View>
              <View style={ss.stepBody}>
                <View style={ss.stepTop}>
                  <Text style={ss.stepPhase}>{s.phase}</Text>
                  <Text style={ss.stepMin}>{Math.round(s.seconds / 60)} 分钟</Text>
                </View>
                <Text style={ss.stepName}>{s.name}</Text>
                {!!s.note && <Text style={ss.stepNote}>{s.note}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {/* 依据脚注：出处写在方案里，别让用户以为这是随便编的 */}
      <Text style={ss.planSource}>{plan.sourceLine}</Text>
    </View>
  );
}

/** 注意事项：跟当前方案联动（经期档和强度档文案不同），弱化成小条目 */
/** 注意事项：跟当前方案联动，弱化成「两字小标签 + 一句」的条目（对齐真机那版） */
function SportCautionCard({ cautions }: { cautions: Caution[] }) {
  return (
    <View style={ss.cautionCard}>
      <Text style={ss.cautionTitle}>注意这几点</Text>
      {cautions.map((c, i) => (
        <View key={i} style={ss.cautionRow}>
          <Text style={[ss.cautionTag, CAUTION_TAG_BG[i % CAUTION_TAG_BG.length]]}>{c.tag}</Text>
          <Text style={ss.cautionText}>{c.text}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── 运动工具页专用样式（v18.86）──────────────────────── */
const ss = StyleSheet.create({
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginTop: theme.sp(1) },
  moreSciBtn: {
    paddingHorizontal: theme.sp(5), paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  moreSciText: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold, color: mm.chipBg.lav.fg },
  recordGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill },
  recordBtnText: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad },
  recWrap: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  secHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  secTitle: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold, color: mm.colors.ink },
  secCount: { fontSize: theme.fs(12), color: mm.colors.inkFaint },
  /* ── 运动记录卡（v18.88 参考 Apple Fitness / Garmin / Keep 范式）────── */
  secSumRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) },
  secSumChip: {
    paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
  },
  secSumText: { fontSize: theme.fs(11), fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft },
  wkCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(3),
  },
  wkHead: { flexDirection: 'row', alignItems: 'center' },
  wkIco: {
    width: theme.sp(13), height: theme.sp(13), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  wkEmoji: { fontSize: theme.sp(7) },
  wkHeadBody: { flex: 1, marginLeft: theme.sp(3), marginRight: theme.sp(2) },
  wkName: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  wkMeta: { fontSize: theme.fs(11), color: mm.colors.inkFaint, marginTop: theme.sp(0.75) },
  wkDur: { fontSize: theme.fs(17), fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  wkStats: {
    flexDirection: 'row', marginTop: theme.sp(3), paddingTop: theme.sp(3),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(31,29,26,0.08)',
  },
  wkStat: { flex: 1, alignItems: 'flex-start' },
  wkStatVal: { fontSize: theme.fs(14), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  wkStatLabel: { fontSize: theme.fs(10.5), color: mm.colors.inkFaint, marginTop: theme.sp(0.5) },
  wkZone: { marginTop: theme.sp(3) },
  wkZoneTop: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(2) },
  wkZoneTag: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.radius.sm },
  wkZoneTagText: { fontSize: theme.fs(10.5), fontWeight: theme.weight.semibold as never },
  wkZoneHint: { marginLeft: 'auto', fontSize: theme.fs(11), color: mm.colors.inkFaint },
  /* 心率条：容器整条圆角 + overflow hidden，内部 4 段无缝拼接（Garmin/Apple 那种分段条），
     比「每段各自圆角」更干净，也避免 6pt 细条套 radius.sm 变成 4 个小胶囊 */
  wkZoneBar: { flexDirection: 'row', height: theme.sp(2), borderRadius: theme.sp(1), overflow: 'hidden' },
  wkZoneSeg: { flex: 1, backgroundColor: 'rgba(31,29,26,0.10)' },
  emptyCard: { paddingVertical: theme.sp(4), alignItems: 'center' },
  emptyIco: {
    width: theme.sp(13), height: theme.sp(13), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.sp(2.5),
  },
  emptyIcoText: { fontSize: theme.sp(7) },
  emptyTitle: { fontSize: theme.fs(13), fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: theme.sp(1) },
  emptySub: { fontSize: theme.fs(11.5), color: mm.colors.inkFaint, textAlign: 'center', lineHeight: theme.fs(16) },
  recFoot: { fontSize: theme.fs(11), color: mm.colors.inkFaint, marginTop: theme.sp(1), lineHeight: theme.fs(15) },

  /* ── 记录运动 · 运动种类选择面板（v18.87）──────────────── */
  pickerWrap: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(1),
  },
  pickerTitle: { fontSize: theme.fs(13.5), fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginBottom: theme.sp(2) },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2), marginBottom: theme.sp(3) },
  kindChip: {
    paddingHorizontal: theme.sp(3.5), paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  kindChipActive: { backgroundColor: mm.colors.limeSoft ?? mm.chipBg.lav.bg },
  kindChipText: { fontSize: theme.fs(12.5), fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft },
  kindChipTextActive: { fontSize: theme.fs(12.5), fontWeight: theme.weight.semibold as never, color: mm.chipBg.lav.fg },
  minuteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  minuteLabel: { fontSize: theme.fs(12.5), color: mm.colors.inkSoft },
  minuteStepper: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(3) },
  minuteBtn: {
    width: theme.sp(8), height: theme.sp(8), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center',
  },
  minuteBtnText: { fontSize: theme.fs(16), fontWeight: theme.weight.semibold as never, color: mm.chipBg.lav.fg },
  minuteValue: { fontSize: theme.fs(16), fontWeight: theme.weight.semibold as never, color: mm.colors.ink, minWidth: theme.sp(10), textAlign: 'center' },
  kcalHint: { fontSize: theme.fs(11.5), color: mm.colors.inkFaint, marginBottom: theme.sp(3) },
  pickerActionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  pickerCancel: {
    paddingHorizontal: theme.sp(4.5), paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerCancelText: { fontSize: theme.fs(14), fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft },

  /* ── 今日训练建议卡（v18.89）────────────────────────────── */
  planCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  planHead: { flexDirection: 'row', alignItems: 'center' },
  planIco: {
    width: theme.sp(13), height: theme.sp(13), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  planEmoji: { fontSize: theme.sp(7) },
  planHeadBody: { flex: 1, marginLeft: theme.sp(3), marginRight: theme.sp(2) },
  planKicker: { fontSize: theme.fs(10.5), fontWeight: theme.weight.semibold as never, letterSpacing: 0.6, color: mm.colors.inkFaint },
  planHeadline: {
    fontSize: theme.fs(13.5), lineHeight: theme.fs(19), fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, marginTop: theme.sp(0.5),
  },
  planDurWrap: { alignItems: 'center', justifyContent: 'center' },
  planDur: { fontSize: theme.fs(19), fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  planDurUnit: { fontSize: theme.fs(10), color: mm.colors.inkFaint, marginTop: theme.sp(0.5) },

  /* ── 今日状态分析卡（v18.90）────────────────────────────── */
  anaCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  anaKicker: {
    fontSize: theme.fs(10.5), fontWeight: theme.weight.semibold as never, letterSpacing: 0.6,
    color: mm.colors.inkFaint,
  },
  anaHead: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2) },
  anaScoreWrap: { flexDirection: 'row', alignItems: 'baseline' },
  anaScore: { fontSize: theme.fs(30), fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  /* 未同步时不是「没有分数」的空洞，而是浅一档的数字，读起来不重也不假 */
  anaScoreEmpty: { color: mm.colors.inkFaint },
  anaScoreUnit: { fontSize: theme.fs(11), color: mm.colors.inkFaint, marginLeft: theme.sp(1) },
  anaHeadBody: { flex: 1, marginLeft: theme.sp(3) },
  anaLevelRow: { flexDirection: 'row', alignItems: 'center' },
  anaLevelDot: {
    width: theme.sp(1.75), height: theme.sp(1.75), borderRadius: theme.radius.pill, backgroundColor: mm.colors.ink,
    marginRight: theme.sp(1.5),
  },
  anaLevelText: { fontSize: theme.fs(13), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  anaHeadSub: { fontSize: theme.fs(11), lineHeight: theme.fs(16), color: mm.colors.inkSoft, marginTop: theme.sp(1) },
  anaTickWrap: { marginTop: theme.sp(3) },
  anaTickTrack: {
    height: theme.sp(1.5), borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    flexDirection: 'row', alignItems: 'center',
  },
  anaTickCut: { width: StyleSheet.hairlineWidth, height: theme.sp(2.5), backgroundColor: 'rgba(31,29,26,0.18)' },
  /* 当前点：用左侧负 margin 把圆点中心对齐到 left% 位置（StyleSheet 静态，不能按 pct 改 width） */
  anaTickDot: {
    position: 'absolute', top: -theme.sp(1.25), width: theme.sp(4), height: theme.sp(4),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.ink, marginLeft: -theme.sp(2),
  },
  anaTickLabels: { flexDirection: 'row', marginTop: theme.sp(1.5) },
  anaTickLabel: { flex: 1, textAlign: 'center', fontSize: theme.fs(10), color: mm.colors.inkSoft },
  anaFactList: { marginTop: theme.sp(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(31,29,26,0.07)', paddingTop: theme.sp(2.5) },
  anaFactRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.sp(1.5) },
  anaFactBullet: { fontSize: theme.fs(13), color: mm.colors.inkFaint, marginRight: theme.sp(1.5), lineHeight: theme.fs(18) },
  anaFactText: { flex: 1, fontSize: theme.fs(12), lineHeight: theme.fs(18), color: mm.colors.inkSoft },
  anaConclusion: {
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    padding: theme.sp(3), marginTop: theme.sp(2.5),
  },
  anaConclusionText: { fontSize: theme.fs(12.5), lineHeight: theme.fs(19), fontWeight: theme.weight.medium as never, color: mm.colors.ink },
  anaEnter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg, marginTop: theme.sp(2.5),
  },
  anaEnterText: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  anaEnterArrow: { fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft, marginLeft: theme.sp(1) },

  planFallbackNote: {
    fontSize: theme.fs(11), lineHeight: theme.fs(16), color: mm.colors.inkFaint,
    marginTop: theme.sp(1.5),
  },
  hrRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2.5) },
  hrLabel: { fontSize: theme.fs(11.5), color: mm.colors.inkFaint, marginRight: theme.sp(1.5) },
  hrZoneDot: { width: theme.sp(1.75), height: theme.sp(1.75), borderRadius: theme.radius.pill },
  hrZoneName: { fontSize: theme.fs(11.5), fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft, marginRight: theme.sp(1.5) },
  hrValue: { fontSize: theme.fs(11.5), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },

  stepList: { marginTop: theme.sp(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(31,29,26,0.07)', paddingTop: theme.sp(1) },
  stepRow: { flexDirection: 'row' },
  stepRail: { width: theme.sp(4), alignItems: 'center' },
  stepDot: {
    width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.skyCore, marginTop: theme.sp(1),
  },
  stepLine: {
    flex: 1, width: 2, borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(31,29,26,0.10)', marginTop: theme.sp(0.5),
  },
  stepBody: { flex: 1, marginLeft: theme.sp(1.5), paddingBottom: theme.sp(3) },
  stepTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepPhase: { fontSize: theme.fs(11), fontWeight: theme.weight.semibold as never, letterSpacing: 0.4, color: mm.colors.skyDeep },
  stepMin: { fontSize: theme.fs(11), fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft },
  stepName: { fontSize: theme.fs(13), fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginTop: theme.sp(0.5) },
  stepNote: { fontSize: theme.fs(11), color: mm.colors.inkFaint, marginTop: theme.sp(0.5) },

  /* ── 方案卡脚注（依据）────────────────────────────────── */
  planSource: {
    fontSize: theme.fs(10.5), lineHeight: theme.fs(15), color: mm.colors.inkFaint,
    marginTop: theme.sp(3), paddingTop: theme.sp(2.5),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(31,29,26,0.07)',
  },

  /* ── ① 今日状态卡（每 30 分钟一跳，带半小时小条）───────── */
  stCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  /* ── ② 为什么今天这么动（三枚软色圆 chip + 分析行 + 结论）── */
  whCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  whKicker: {
    fontSize: theme.fs(10.5), fontWeight: theme.weight.semibold as never, letterSpacing: 0.6, color: mm.colors.inkFaint,
    marginBottom: theme.sp(2.5),
  },
  whChips: { flexDirection: 'row', gap: theme.sp(2), marginBottom: theme.sp(3) },
  whChip: {
    flex: 1, alignItems: 'center',
    paddingHorizontal: theme.sp(1.5), paddingTop: theme.sp(2.5), paddingBottom: theme.sp(2),
    borderRadius: theme.radius.md, backgroundColor: mm.colors.btnBusyBg,
  },
  whChipIco: {
    width: theme.sp(8.5), height: theme.sp(8.5), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.sp(1.5),
  },
  whChipText: {
    fontSize: theme.fs(10.5), lineHeight: theme.fs(14), fontWeight: theme.weight.semibold as never,
    color: mm.colors.ink, textAlign: 'center',
  },
  whFact: { flexDirection: 'row', alignItems: 'flex-start', marginTop: theme.sp(2) },
  whTag: {
    width: theme.sp(12), paddingHorizontal: theme.sp(1), paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg, marginRight: theme.sp(2),
    marginTop: theme.sp(0.5), textAlign: 'center',
  },
  whTagP: { backgroundColor: mm.colors.purpleSoft },
  whTagR: { backgroundColor: mm.colors.roseSoft },
  whTagL: { backgroundColor: mm.colors.limeSoft },
  whFactText: { flex: 1, fontSize: theme.fs(11.5), lineHeight: theme.fs(17), color: mm.colors.inkSoft },
  whConclusion: {
    backgroundColor: mm.colors.btnBusyBg, borderRadius: theme.radius.md,
    padding: theme.sp(3), marginTop: theme.sp(3),
  },
  whConclusionText: {
    fontSize: theme.fs(12.5), lineHeight: theme.fs(19), fontWeight: theme.weight.medium as never, color: mm.colors.ink,
  },

  cautionTag: {
    minWidth: theme.sp(10), paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill, marginRight: theme.sp(2), marginTop: theme.sp(0.5),
    textAlign: 'center',
  },
  cautionCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  cautionTitle: { fontSize: theme.fs(13.5), fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginBottom: theme.sp(2) },
  cautionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.sp(2) },
  cautionText: { flex: 1, fontSize: theme.fs(11.5), lineHeight: theme.fs(18), color: mm.colors.inkSoft },
});

/** 注意事项小标签的底色（按条目轮换，跟五色相分工一致：蓝强度 / 绿状态 / 粉身体 / 黄时长） */
const CAUTION_TAG_BG = [
  { backgroundColor: mm.colors.skySoft, color: mm.colors.skyDeep },
  { backgroundColor: mm.colors.limeSoft, color: mm.colors.limeDeep },
  { backgroundColor: mm.colors.roseSoft, color: mm.colors.roseDeep },
  { backgroundColor: mm.colors.honeySoft, color: mm.colors.honeyDeep },
];
