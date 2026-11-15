/**
 * ToolTopicScreen —— 工具页通用内容页（v18.70）
 *
 * 承接工具页六宫格中尚无独立模块的三类：提升颜值 / 运动建议 / 知识科普。
 * 结构：标题 + 副标题 + 一条「今日状态」数据驱动提示 + 知识条目（ListCard）。
 * v18.70：知识科普（learn）改版为图文科普样式——hero 插画卡 + 文章列表卡，
 *         点进 LearnRead 阅读详情页（参考图文阅读排版）。
 * 内容口径：平实、带原因、不做诊断承诺（Mira 文案铁律）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ImageBackground, TouchableOpacity, Image, Modal, type ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, CompositeNavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import BackButton from '../components/BackButton';
import MiraTag from '../components/MiraTag';
import { ArcGauge } from '../components/ArcGauge';
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
import { buildTodayWorkout, buildSportBrief, sportStatusReason } from '../lib/todayWorkout';
import { collectWorkoutInput } from '../lib/workoutInput';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { dateKeyOf } from '../lib/foodAi';
import { loadLastViewDate, saveLastViewDate } from '../lib/lastViewDate';
import type { RingSportSession } from '../ble/RingBleManager';
import { LEARN_ARTICLES, LEARN_HERO_ID, getLearnArticle } from '../lib/learnArticles';
import { GLOW_ARTICLES, GLOW_HERO_ID, getGlowArticle } from '../lib/glowArticles';
import { SPORT_ARTICLES, SPORT_HERO_ID, getSportArticle } from '../lib/sportArticles';
import { NUTRITION_ARTICLES, getNutritionArticle } from '../lib/nutritionArticles';
import type { LearnArticle } from '../lib/learnArticles';
import { useShowCycle } from '../data/cycleScope';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

type TopicKey = 'glow' | 'sport' | 'learn' | 'nutrition' | 'sportArticles';

/** 步进器中心文案：「10月2日 · 今天」（SPEC §1） */
function dayLabel(d: Date): string {
  const t = new Date();
  const same = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return `${d.getMonth() + 1}月${d.getDate()}日${same ? ' · 今天' : ''}`;
}

const TOPIC_META: Record<TopicKey, { title: string; sub: string }> = {
  glow: { title: '提升颜值', sub: '跟着周期节奏，把气色养回来' },
  sport: { title: '运动建议', sub: '按今天的状态开运动处方' },
  learn: { title: '知识科普', sub: '平衡激素的四根杠杆：光 · 睡 · 压 · 动' },
  nutrition: { title: '饮食营养', sub: '吃对了，激素才稳' },
  sportArticles: { title: '运动科普', sub: '周期 × 荷尔蒙的运动科学' },
};

/** ★ 2026-11-14：男性用户专用副标题 —— 不带生理周期 / 荷尔蒙口径。 */
const GENERAL_SUB: Record<TopicKey, string> = {
  glow: '睡好、吃稳、防晒，把状态养回来',
  sport: '按今天的状态开运动处方',
  learn: '光 · 睡 · 压 · 动，四件影响状态的小事',
  nutrition: '吃对了，一天的精力才稳',
  sportArticles: '状态和恢复，决定今天怎么练',
};

/**
 * ★ 2026-11-14（用户：选了男性，饮食建议和报告里还会出现经期、雌激素内容吗）
 * 文章库里绑定女性生理周期的条目一律不进男性内容池。只看标题 / 短标题 / 眉行，
 * 不扫正文（正文里「皮质醇也有昼夜周期」这类通用表述不该误伤）。
 * 过滤后若为空，调用方会退回中性 hero，保证页面不塌。
 */
const ARTICLE_CYCLE_RE = /经期|月经|排卵|黄体|卵泡|雌激素|孕激素|孕酮|雌二醇|经前|PMS|周期|荷尔蒙|易孕期|备孕|怀孕|女性营养|女性最|暖宫|补铁时机/i;
function visibleArticles<T extends LearnArticle>(all: T[], showCycle: boolean): T[] {
  if (showCycle) return all;
  return all.filter((a) => !ARTICLE_CYCLE_RE.test(`${a.title} ${a.shortTitle ?? ''} ${a.eyebrow}`));
}

export default function ToolTopicScreen() {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const route = useRoute<{ key: string; name: string; params: { topic: TopicKey } }>();
  const navigation = useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>>();
  const topic: TopicKey = (route.params?.topic ?? 'learn') as TopicKey;
  const meta = TOPIC_META[topic] ?? TOPIC_META.learn;
  /** 男性用户：标题保留，副标题换中性口径；内容池 / 提示行 / 节律卡同源开关。 */
  const showCycle = useShowCycle();
  const sub = showCycle ? meta.sub : (GENERAL_SUB[topic] ?? meta.sub);
  const scrollY = useRef(new Animated.Value(0)).current;
  /** 交给 ScreenContainer：供运动页「进入今日运动建议」滚到方案卡 */
  const scrollRef = useRef<ScrollView>(null);
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });
  const insets = useSafeAreaInsets();
  /** 添加运动弹卡开关（提级到页面层：底栏钉在屏幕底，「添加运动」按钮在页面层渲染） */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 运动建议页选中日期（SPEC §1 顶部步进器；睡眠/步数按这天取真实历史） */
  const [sportDate, setSportDate] = useState(() => new Date());

  /* ★ 记住最后查看的日期：切走/杀进程后再回来仍停在同一天（spec：「历史保留」） */
  useEffect(() => {
    loadLastViewDate('sport').then((k) => {
      if (k) setSportDate(new Date(`${k}T00:00:00`));
    }).catch(() => {});
  }, []);

  const onSportDateChange = useCallback((d: Date) => {
    setSportDate(d);
    void saveLastViewDate('sport', dateKeyOf(d.getTime()));
  }, []);

  // ── 当天数据（缺项静默降级，不编数字）──
  // 运动建议页（sport）在 SportRedesign 内按所选日期自行取数；这里只留 learn/glow 用得到的。
  const ring = RingBle.getState();
  const now = Date.now();
  const sleep = (() => {
    try { return healthStore.getSleep(dayKey(now)) ?? healthStore.getSleep(dayKey(now - 86400000)); } catch { return null; }
  })();
  // ★ v18.98：睡眠只取「昨晚」，不标注来源日期（用户口径：不要写「昨」，没有就是「—」）。
  const sleepIsStale = false;
  const sleepScore = sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  const phase = ring?.curveStatus?.phaseLabel ?? '未记录';

  // ── 运动建议页：固定列结构（同 FoodScanScreen）——内容自己滚 + 底栏钉死贴底。
  //  不再包 ScreenContainer：它自带外层 ScrollView，底栏会被外层滚动拖着走，永远钉不住。 ──
  if (topic === 'sport') {
    return (
      <View style={styles.page}>
        <LinearGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
        <View style={[styles.col, { paddingTop: theme.space.xl + insets.top }]}>
          <Animated.ScrollView
            ref={scrollRef}
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            {/* 头部：返回圈 + 标题同行 + 右侧相位 chip（SPEC §2.1 dhead） */}
            <View style={styles.head}>
              <BackButton onPress={() => navigation.goBack()} />
              <Animated.View style={[styles.headText, { opacity: headOpacity, transform: [{ translateY: headLift }] }]}>
                <Text style={styles.title}>{meta.title}</Text>
                <Text style={styles.subtitle}>{sub}</Text>
              </Animated.View>
              {/* v18.99：右上角相位 chip 删除——周期阶段已在分析卡的「周期」理由行里说清，不重复 */}
            </View>

            {/* 日期步进器（SPEC §1：左右 ±1 天、点中间弹日历、不可选未来） */}
            <DateAnchorPicker value={sportDate} onChange={onSportDateChange} range="day" formatLabel={dayLabel} />
            {/* ★ 本轮（用户）：时间选择器 ↔ 弧 拉开距离 */}
            <View style={{ height: theme.sp(4) }} />

            {/* 卡1 分析（先）→ 卡2 推荐（后）+ 运动记录 + 记录面板 */}
            <SportRedesign sportDate={sportDate} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} />
          </Animated.ScrollView>

          {/* 底部操作行：科普 · 添加运动 —— 贴住屏幕底（同饮食页 ~14pt 口径） */}
          <View style={[ss.actionBar, { paddingBottom: Math.max(theme.sp(2), Math.round(insets.bottom * 0.4)) }]}>
            <View style={ss.actionRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={ss.sciBtn}
                onPress={() => navigation.navigate('ToolTopic', { topic: 'sportArticles' })}
                accessibilityRole="button"
                accessibilityLabel="科普"
              >
                <Text style={ss.sciBtnText}>科普</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => setPickerOpen(true)}>
                <LinearGradient
                  colors={[mm.colors.btnGradFrom, mm.colors.limeSoft, mm.colors.btnGradTo]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={ss.recordGrad}
                >
                  <Text style={ss.recordBtnText}>添加运动</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <LinearGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
      <ScreenContainer scrollY={scrollY} scrollRef={scrollRef} topFadeColor={theme.colors.bgTop}>
        {/* 返回按钮 */}
        {/* 头部：返回圈 + 标题同行（与呼吸冥想页同款） */}
        <View style={styles.head}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="back" size={theme.fontSize.h2} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <Animated.View style={[styles.headText, { opacity: headOpacity, transform: [{ translateY: headLift }] }]}>
            <Text style={styles.title}>{meta.title}</Text>
            <Text style={styles.subtitle}>{sub}</Text>
          </Animated.View>
        </View>
        {topic === 'learn'
          ? <LearnSection phase={showCycle ? phase : '未记录'} showCycle={showCycle} navigation={navigation} />
          : topic === 'glow'
            ? <GlowSection sleepScore={sleepScore} sleepIsStale={sleepIsStale} showCycle={showCycle} navigation={navigation} />
            : topic === 'nutrition'
              ? <NutritionSection showCycle={showCycle} navigation={navigation} />
              : <SportArticlesSection showCycle={showCycle} navigation={navigation} />}
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

function LearnSection({ phase, showCycle, navigation }: { phase: string; showCycle: boolean; navigation: TopicNav }) {
  const pool = visibleArticles(LEARN_ARTICLES, showCycle);
  const hero = pool.find((a) => a.id === LEARN_HERO_ID) ?? pool[0] ?? getLearnArticle(LEARN_HERO_ID);
  const articles = pool.filter((a) => a.id !== hero.id);
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

      {/* 周期关联提示（诚实口径：未记录就直说）；男性改中性状态口径 */}
      <Text style={ls.phaseTip}>
        {!showCycle
          ? '按今天的睡眠、压力和精力，挑一件能马上做的小事。'
          : phase === '未记录'
            ? '记录经期后，内容会跟着你的周期阶段更新。'
            : `当前 ${phase} · 内容跟着你的周期阶段更新`}
      </Text>

      <RhythmMethodStrip phase={phase} showCycle={showCycle} navigation={navigation} />

      {/* 列表区标题 */}
      <View style={ls.secHead}>
        <Text style={ls.secTitle}>{showCycle ? '为你现在的阶段挑的' : '从基础开始'}</Text>
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

/** 把节律理论拆成可执行的三张图文卡：先解释窗口，再给一个动作。 */
function RhythmMethodStrip({ phase, showCycle, navigation }: { phase: string; showCycle: boolean; navigation: TopicNav }) {
  const cards = showCycle ? [
    { id: 'cortisol', title: '晨光校准', text: '起床后见光，让白天的节律先站稳。', tone: '晨间节律' },
    { id: phase === '黄体期' || phase === '经期' ? 'progesterone' : 'estrogen', title: phase === '黄体期' || phase === '经期' ? '给恢复留空间' : '把难事放在上行段', text: phase === '黄体期' || phase === '经期' ? '减少并列任务，先把睡眠和恢复稳住。' : '把需要创造力的事放在精力上行时段。', tone: '周期节律' },
    { id: 'dopamine', title: '先难后易', text: '把最需要专注的事放在脑力上行时段。', tone: '脑力节律' },
  ] : [
    { id: 'cortisol', title: '晨光校准', text: '起床后见光，让白天的节律先站稳。', tone: '晨间节律' },
    { id: 'ring', title: '先看清数据边界', text: '戒指给的是趋势，不是化验值。', tone: '读数据' },
    { id: 'dopamine', title: '先难后易', text: '把最需要专注的事放在脑力上行时段。', tone: '脑力节律' },
  ];
  return (
    <>
      <View style={ls.methodHead}>
        <Text style={ls.secTitle}>今天可以这样做</Text>
        <Text style={ls.methodHint}>按你的节律挑一件</Text>
      </View>
      <View style={ls.methodRow}>
        {cards.map((card) => {
          const article = getLearnArticle(card.id);
          return (
            <TouchableOpacity
              key={card.id}
              activeOpacity={theme.press.opacity}
              style={ls.methodCard}
              onPress={() => navigation.navigate('LearnRead', { articleId: article.id })}
              accessibilityRole="button"
              accessibilityLabel={`${card.title}，${card.text}`}
            >
              <ImageBackground source={article.cover} style={ls.methodImage} imageStyle={{ borderRadius: theme.radius.md }} resizeMode="cover">
                <View style={ls.methodShade} />
                <View style={ls.methodCopy}>
                  <Text style={ls.methodTone}>{card.tone}</Text>
                  <Text style={ls.methodTitle} numberOfLines={1}>{card.title}</Text>
                  <Text style={ls.methodText} numberOfLines={2}>{card.text}</Text>
                </View>
              </ImageBackground>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

function TopicMethodStrip({
  title,
  hint,
  cards,
  navigation,
}: {
  title: string;
  hint: string;
  cards: Array<{ id: string; title: string; text: string; tone: string; cover: any; collection: 'emotion' | 'sport' | 'learn' | 'glow' | 'nutrition' }>;
  navigation: TopicNav;
}) {
  return (
    <>
      <View style={ls.methodHead}>
        <Text style={ls.secTitle}>{title}</Text>
        <Text style={ls.methodHint}>{hint}</Text>
      </View>
      <View style={ls.methodRow}>
        {cards.map((card) => (
          <TouchableOpacity
            key={card.id}
            activeOpacity={theme.press.opacity}
            style={ls.methodCard}
            onPress={() => navigation.navigate('LearnRead', { articleId: card.id, collection: card.collection })}
            accessibilityRole="button"
            accessibilityLabel={`${card.title}，${card.text}`}
          >
            <ImageBackground source={card.cover} style={ls.methodImage} imageStyle={{ borderRadius: theme.radius.md }} resizeMode="cover">
              <View style={ls.methodShade} />
              <View style={ls.methodCopy}>
                <Text style={ls.methodTone}>{card.tone}</Text>
                <Text style={ls.methodTitle} numberOfLines={1}>{card.title}</Text>
                <Text style={ls.methodText} numberOfLines={2}>{card.text}</Text>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

/* ── 提升颜值 · 图文版块（v18.79）────────────────────────
 * 与知识科普完全同构（hero 插画卡 + 文章列表卡，复用 ls 样式）。
 * 内容：斯坦福皮肤科共识 + 明星极简护肤路线（glowArticles.ts，静态无假数据）。
 * 顶部提示行带昨晚睡眠分（有数据才展示，诚实口径）。
 */
function GlowSection({ sleepScore, sleepIsStale, showCycle, navigation }: { sleepScore: number | null; sleepIsStale?: boolean; showCycle: boolean; navigation: TopicNav }) {
  const pool = visibleArticles(GLOW_ARTICLES, showCycle);
  const hero = pool.find((a) => a.id === GLOW_HERO_ID) ?? pool[0] ?? getGlowArticle(GLOW_HERO_ID);
  const articles = pool.filter((a) => a.id !== hero.id);
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

/* ── 运动建议 · V3 版式（v18.97，按 mira-design/SPORT-DIET-SPEC-v1.md §2）──────────
 * 卡1「为什么今天这么动」分析在前：强度环（5 段，当前相位亮色）+ stat3 三格 + 理由×2（周期/状态）；
 * 卡2「今天推荐 · 三选二」建议在后：推荐条目×3 + 依据行。
 * 数据：相位/睡眠/步数/HRV/皮质醇按所选日期取真实来源；文案表见 todayWorkout.ts（SPEC §2.7）。
 * 之后保留运动记录和分析 + 记录运动面板（既有功能，未动）。
 */
function SportRedesign({ sportDate, pickerOpen, setPickerOpen }: {
  sportDate: Date; pickerOpen: boolean; setPickerOpen: (v: boolean) => void;
}) {
  const ring = RingBle.getState();
  const dayTs = sportDate.getTime();
  const startOfSel = new Date(sportDate.getFullYear(), sportDate.getMonth(), sportDate.getDate()).getTime();
  const startOfToday = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); })();
  const isToday = startOfSel === startOfToday;
  const sk = dayKey(dayTs);

  /* ── 按所选日期取真实数据（缺项静默降级，不编数字）── */
  // ★ v18.98：睡眠只取「昨晚」，不标注来源日期（用户口径：不要写「昨」，没有就是「—」）。
  const sleepSel = (() => {
    try { return healthStore.getSleep(sk) ?? (isToday ? healthStore.getSleep(dayKey(dayTs - 86400000)) : null); }
    catch { return null; }
  })();
  const cortisolLabel = (() => {
    try {
      const samples = (healthStore.getIntraday?.('cortisol', sk) ?? []) as { t: number; v: number }[];
      if (!Array.isArray(samples) || samples.length < 4) return null;
      const r = analyzeCortisol(samples, 14);
      const lv = (r as { todayLevel?: string }).todayLevel;
      return lv === 'high' ? '偏高' : lv === 'dysregulated' ? '节律紊乱' : '正常';
    } catch {
      return null;
    }
  })();
  // ★ 2026-11-14：男性用户强制「未记录」相位 —— 周期同步训练法不适用，
  //   否则理由行会出现「记一次经期，这里换成阶段定制版」。
  const cycleOn = useShowCycle();
  const phase = cycleOn ? (ring?.curveStatus?.phaseLabel ?? '未记录') : '未记录';
  // ★ 2026-10-12：运动建议采数与「运动消耗」详情页的「今日运动建议」卡共用同一 helper
  //   （collectWorkoutInput）——单一事实来源，保证工具页与卡片给出的处方完全一致，点进去不打架。
  const workoutInput = collectWorkoutInput(ring, dayTs);
  if (!cycleOn) workoutInput.phase = '未记录';
  const plan = buildTodayWorkout(workoutInput);
  const brief = buildSportBrief(phase, plan.timeSlot, !cycleOn);
  const statusLine = sportStatusReason({
    sleepTotalMin: sleepSel?.total ?? null,
    sleepDeepMin: sleepSel?.deep ?? null,
    cortisolLabel,
    gearName: brief.gearName,
    sleepIsStale: false, // ★ v18.98：不再挂「昨（日期）」溯源小字，拿不到昨晚睡眠就是「—」
    sleepDateLabel: undefined,
  });

  /* ── 记录运动：运动种类选择 + 时长 + 保存（v18.87 既有功能）────────── */
  const todayKey = dateKeyOf();
  const [kind, setKind] = useState<number>(1);
  const [minutes, setMinutes] = useState('30');
  const [records, setRecords] = useState<SportLog[]>(() => todaySportLogs(dateKeyOf()));

  // 打开面板时刷新当天记录（原 openPicker 行为）
  useEffect(() => {
    if (pickerOpen) setRecords(todaySportLogs(dateKeyOf()));
  }, [pickerOpen]);

  const kindName = SPORT_KIND_MAP[kind]?.typeName ?? '跑步';
  const minutesNum = Math.max(1, Number(minutes) || 0);
  const previewKcal = estimateKcal(kind, minutesNum);

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
      {/* ① 今日状态分析（环 + stat3 + 理由；按反馈不显示顶部「为什么今天这么动」标签，内容保留） */}
      <SportAnalysisCard plan={plan} brief={brief} statusLine={statusLine} sleepScore={sleepSel?.score ?? null} sleepTotalMin={sleepSel?.total ?? null} />
      <View style={{ height: theme.sp(6) }} />

      {/* ② 今天推荐 · 三选二（建议在后） */}
      <SportRecCard brief={brief} />
      <View style={{ height: theme.sp(6) }} />

      {/* ③ 运动记录和分析（既有功能） */}
      <SportRecordsSection />

      {/* ④ 添加运动：弹出小卡（Modal，高由内容决定，不用整页） */}
      <Modal visible={pickerOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setPickerOpen(false)}>
        {/* 遮罩：点按可关 */}
        <View style={ss.addMask}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPickerOpen(false)} accessibilityLabel="关闭添加运动" />
          <View style={ss.addCard}>
            <View style={ss.addGrabber} />
            <Text style={ss.addTitle}>添加运动</Text>

            <Text style={ss.addSection}>运动种类</Text>
            <View style={ss.kindRow}>
              {SPORT_KINDS.map((k) => {
                const active = k.type === kind;
                return (
                  <TouchableOpacity
                    key={k.type}
                    activeOpacity={0.7}
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
                  activeOpacity={0.7}
                  style={ss.minuteBtn}
                  onPress={() => setMinutes(String(Math.max(1, minutesNum - 5)))}
                  accessibilityRole="button"
                  accessibilityLabel="减少 5 分钟"
                >
                  <Text style={ss.minuteBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={ss.minuteValue}>{minutesNum}</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
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
              <TouchableOpacity activeOpacity={0.7} style={ss.pickerCancel} onPress={() => setPickerOpen(false)} accessibilityRole="button">
                <Text style={ss.pickerCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={confirmRecord}>
                <LinearGradient
                  colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={ss.recordGrad}
                >
                  <Text style={ss.recordBtnText}>保存</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ── V3 展示组件（SPEC §2.2–2.5）────────────────────────────── */

/**
 * ★ 2026-10-11（用户：「运动建议最上面的环不要做成环，做成身体年龄那种弧形」）：
 * 原来的整圈 5 段环 → 宽扁大弧（ArcGauge，几何对齐身体年龄）。
 * 内容不变：中央仍是档位名 + 副标（gearName / gearSub），颜色仍是当前相位的 ringColor。
 *
 * 弧的填充比例 = 当前档位的「强度档序」映射（5 档：恢复→平稳→燃脂→黄金窗口→巅峰），
 * 让弧长和"今天练多狠"对应，而不是原来的"5 段里只亮 1 段"。仅视觉映射，不改动任何数据。
 */
const GEAR_FRACTION: Record<string, number> = {
  恢复: 0.2,
  平稳: 0.4,
  燃脂: 0.55,
  黄金窗口: 0.8,
  巅峰: 1.0,
};
function IntensityRing({ color, gearName, gearSub }: { color: string; gearName: string; gearSub: string }) {
  const pct = (GEAR_FRACTION[gearName] ?? 0.6) * 100;
  return (
    <ArcGauge pct={pct} color={color}>
      <View style={sp2.ringCenter} pointerEvents="none">
        <Text style={sp2.ringGear}>{gearName}</Text>
        <Text style={sp2.ringGearSub}>{gearSub}</Text>
      </View>
    </ArcGauge>
  );
}

/** stat3 状态三格（心率 / 体感 / 时段，tint 底 + 圆点） */
function StatTile({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <View style={sp2.statTile}>
      <View style={[sp2.statDot, { backgroundColor: dot }]} />
      <Text style={sp2.statLabel}>{label}</Text>
      <Text style={sp2.statValue}>{value}</Text>
    </View>
  );
}

/** 理由行（adv）：tag 胶囊 soft 底 deep 字 + 正文，行间细分隔线 */
function AdvRow({ tag, tagBg, tagFg, text, last }: { tag: string; tagBg: string; tagFg: string; text: string; last?: boolean }) {
  return (
    <View style={[sp2.advRow, !last && sp2.advRowLine]}>
      <View style={[sp2.advTag, { backgroundColor: tagBg }]}>
        <Text style={[sp2.advTagText, { color: tagFg }]}>{tag}</Text>
      </View>
      <Text style={sp2.advText}>{text}</Text>
    </View>
  );
}

/** 卡1「为什么今天这么动」：环 + stat3 + 理由×2 */
function SportAnalysisCard({ plan, brief, statusLine, sleepScore, sleepTotalMin }: {
  plan: ReturnType<typeof buildTodayWorkout>;
  brief: ReturnType<typeof buildSportBrief>;
  statusLine: string;
  sleepScore: number | null;
  sleepTotalMin: number | null;
}) {
  const z = plan.targetZone;
  const hrText = z.min > 0 ? `${z.min}–${z.max}` : `≤ ${z.max}`;
  const feelText =
    plan.intensity === 'intense' ? '短句可说'
      : plan.intensity === 'moderate' ? '能说话'
        : plan.intensity === 'recovery' ? '轻松'
          : '待同步';
  const conclusion =
    plan.intensity === 'intense' ? '今天适合短时发力' :
    plan.intensity === 'moderate' ? '今天适合保持节奏' :
    plan.intensity === 'recovery' ? '今天适合温和恢复' : '今天先等数据同步';
  return (
    <>
      <View style={sp2.heroRing}>
        <IntensityRing color={brief.ringColor} gearName={brief.gearName} gearSub={brief.gearSub} />
      </View>
      <View style={sp2.card}>
      <View style={sp2.conclusion}>
        <Text style={sp2.conclusionTitle}>{conclusion}</Text>
        <Text style={sp2.conclusionSub}>睡眠恢复不错，适合中低强度。{brief.reason} · {statusLine}</Text>
      </View>
      <View style={sp2.stat3}>
        <StatTile dot={mm.colors.skyCore} label="恢复" value={sleepScore != null ? `${Math.round(sleepScore)}` : "—"} />
        <StatTile dot={mm.colors.honeyCore} label="睡眠" value={sleepTotalMin != null ? `${Math.floor(sleepTotalMin / 60)}h${String(sleepTotalMin % 60).padStart(2, "0")}` : "—"} />
        <StatTile dot={mm.colors.roseCore} label="建议强度" value={brief.gearName === "恢复" ? "低" : brief.gearName === "平稳" ? "中低" : "中"} />
      </View>
      </View>
    </>
  );
}

/** 推荐条目 tag 用色随运动类型轮换（蜜 → 黄绿 → 蓝，SPEC §2.5） */
const REC_TAG_COLORS = [
  { bg: mm.colors.honeySoft, fg: mm.colors.honeyDeep },
  { bg: mm.colors.limeSoft, fg: mm.colors.limeDeep },
  { bg: mm.colors.skySoft, fg: mm.colors.skyDeep },
];

/** 卡2「今天推荐 · 三选二」：推荐条目×3 + 依据行（固定文案） */
function SportRecCard({ brief }: { brief: ReturnType<typeof buildSportBrief> }) {
  return (
    <View>
      <View style={sp2.sectionHead}>
        <Text style={sp2.sectionTitle}>今天适合做什么</Text>
        <Text style={sp2.sectionLink}>选一个开始</Text>
      </View>
      {brief.recs.map((r, i) => {
        const t = REC_TAG_COLORS[i % REC_TAG_COLORS.length];
        return (
          <View key={`${r.name}-${i}`} style={sp2.workoutCard}>
            <View style={[sp2.workoutIcon, { backgroundColor: t.bg }]}><Text style={[sp2.workoutIconText, { color: t.fg }]}>{i === 0 ? '↗' : i === 1 ? '◒' : '✦'}</Text></View>
            <View style={sp2.workoutBody}>
              <Text style={sp2.workoutName}>{r.name}</Text>
              <Text style={sp2.workoutMeta}>{r.minutes} 分钟 · {r.timeLabel}</Text>
              <Text style={sp2.workoutWhy}>{r.why}</Text>
            </View>
            <TouchableOpacity style={sp2.startButton} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`开始记录${r.name}`}>
              <Text style={sp2.startButtonText}>开始记录</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
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
          <Text style={ss.emptySub}>点下方「添加运动」选个种类就能记一笔；佩戴 Mira 戒指完成运动，这里也会自动出现识别到的类型与时间距离。</Text>
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
    backgroundColor: theme.colors.bgMid,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.cardPadCompact,
    paddingVertical: theme.space.cardPadCompact,
    marginLeft: theme.sp(3),
    marginTop: theme.sp(3),
  },
  heroEyebrow: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.8,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(1),
  },
  heroTitle: {
    fontSize: theme.fontSize.card,
    lineHeight: theme.fontSize.orb,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  heroLinkRow: { flexDirection: 'row' },
  heroLink: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.chipBg.lav.fg,
  },
  phaseTip: {
    fontSize: theme.fontSize.xs,
    color: mm.colors.inkFaint,
    marginTop: theme.sp(2.5),
    marginBottom: theme.space.lg,
  },
  methodHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  methodHint: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },
  methodRow: { flexDirection: 'row', gap: theme.sp(2), marginBottom: theme.space.lg },
  methodCard: { flex: 1, minWidth: 0 },
  methodImage: { height: theme.sp(31), justifyContent: 'flex-end', overflow: 'hidden' },
  methodShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,24,42,0.22)' },
  methodCopy: { padding: theme.sp(2) },
  methodTone: { color: theme.colors.ui.white82, fontSize: theme.fontSize.micro, marginBottom: theme.sp(0.5) },
  methodTitle: { color: theme.colors.textWhite, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, marginBottom: theme.sp(0.5) },
  methodText: { color: theme.colors.ui.white92, fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.body },
  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  secTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  secCount: {
    fontSize: theme.fontSize.xs,
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
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.5,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(0.5),
  },
  articleTitle: {
    fontSize: theme.fontSize.body,
    lineHeight: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  articleLink: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
  },
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  /** 运动页固定列：内容自己滚 + 底栏钉死（paddingTop 运行时补 insets.top） */
  col: { flex: 1, width: '100%', paddingHorizontal: theme.space.screen },
  bodyScroll: { flex: 1, width: '100%' },
  bodyContent: { paddingBottom: theme.sp(4) },
  backBtn: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.space.lg },
  headText: { flex: 1 },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1),
  },
  subtitle: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginBottom: theme.space.md,
  },
});

/* ── 饮食营养 · 图文版块（v18.86 新增）────────────────────────
 * 与 learn/glow/sport 同构（hero 插画卡 + 文章列表卡，复用 ls 样式）。
 * 内容：荷尔蒙 × 营养（nutritionArticles.ts，静态无假数据）。
 * 「更多科普」按钮落点之一（饮食页底部「更多科普」→ ToolTopic nutrition）。
 */
function NutritionSection({ showCycle, navigation }: { showCycle: boolean; navigation: TopicNav }) {
  const pool = visibleArticles(NUTRITION_ARTICLES, showCycle);
  const hero = pool[0] ?? NUTRITION_ARTICLES[0];
  const articles = pool.slice(1);
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

      <Text style={ls.phaseTip}>{showCycle ? '真实可查的营养科学，吃对了激素才稳。' : '真实可查的营养科学，先把一天的精力稳住。'}</Text>

      <TopicMethodStrip
        title="今天可以这样吃"
        hint="按节律挑一件"
        navigation={navigation}
        cards={showCycle ? [
          { id: 'cravings', title: '稳住餐后精力', text: '先吃蛋白质和纤维，再安排主食。', tone: '血糖节律', cover: getNutritionArticle('cravings').cover, collection: 'nutrition' },
          { id: 'proteinhormone', title: '给周期补对燃料', text: '根据阶段调整碳水和脂肪，不用硬扛。', tone: '周期营养', cover: getNutritionArticle('proteinhormone').cover, collection: 'nutrition' },
        ] : [
          { id: 'cravings', title: '稳住餐后精力', text: '先吃蛋白质和纤维，再安排主食。', tone: '血糖节律', cover: getNutritionArticle('cravings').cover, collection: 'nutrition' },
          { id: 'proteinhormone', title: '蛋白质先吃够', text: '每餐有一掌心蛋白质，饱腹感更稳。', tone: '蛋白质', cover: getNutritionArticle('proteinhormone').cover, collection: 'nutrition' },
        ]}
      />

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
function SportArticlesSection({ showCycle, navigation }: { showCycle: boolean; navigation: TopicNav }) {
  const pool = visibleArticles(SPORT_ARTICLES, showCycle);
  const hero = pool.find((a) => a.id === SPORT_HERO_ID) ?? pool[0] ?? getSportArticle(SPORT_HERO_ID);
  const articles = pool.filter((a) => a.id !== hero.id);
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

      <Text style={ls.phaseTip}>{showCycle ? '周期阶段 × 荷尔蒙，给你可执行的训练节奏。' : '状态 × 恢复，给你可执行的训练节奏。'}</Text>

      <TopicMethodStrip
        title="今天怎么动"
        hint={showCycle ? '看周期，也看恢复' : '看恢复，也看状态'}
        navigation={navigation}
        cards={showCycle ? [
          { id: 'cycletraining', title: '把强度放对时段', text: '上行段挑战，恢复段保留余量。', tone: '训练节律', cover: getSportArticle('cycletraining').cover, collection: 'sport' },
          { id: 'lutealtrain', title: '经前给恢复留空间', text: '保持频率，降低单次强度和并列任务。', tone: '黄体期', cover: getSportArticle('lutealtrain').cover, collection: 'sport' },
        ] : [
          { id: 'cortisoltrain', title: '把强度放对时段', text: '状态好再往上加，别硬顶。', tone: '训练节律', cover: getSportArticle('cortisoltrain').cover, collection: 'sport' },
          { id: 'hrvtrain', title: '看 HRV 定强度', text: '连续偏低就先降一档。', tone: '恢复信号', cover: getSportArticle('hrvtrain').cover, collection: 'sport' },
        ]}
      />

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

/* ── 运动工具页专用样式（v18.86）──────────────────────── */
const ss = StyleSheet.create({
  /* 底部操作栏（钉在屏幕底）：深蓝紫实底托住滚过的内容（mira-ocean：原白底 → 深底，避免与深色主题冲突） */
  actionBar: { paddingTop: theme.sp(2), backgroundColor: theme.colors.bgBottom, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.cardBorder },
  /* ── 添加运动 · 弹出小卡（v18.98：Modal 底部小卡，高由内容决定，不占整页）── */
  addMask: { flex: 1, backgroundColor: theme.colors.ui.black50, justifyContent: 'flex-end' },
  addCard: {
    backgroundColor: theme.colors.bgBottom,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.cardBorder,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space.cardPad, paddingTop: theme.sp(2),
    paddingBottom: theme.sp(5),
  },
  addGrabber: {
    alignSelf: 'center', width: theme.sp(9), height: theme.sp(1), borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBorder, marginBottom: theme.sp(2.5),
  },
  addTitle: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginBottom: theme.sp(3) },
  addSection: { fontSize: theme.fontSize.micro, fontWeight: '800' as never, letterSpacing: 0.6, color: mm.colors.inkFaint, marginBottom: theme.sp(2) },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  /* ghost「科普」：高 48 pill，白底细描边，弱化（SPEC §2.6） */
  sciBtn: {
    width: theme.sp(18.5), height: theme.sp(12),
    borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardBg,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  sciBtnText: { fontSize: theme.fontSize.xs, fontWeight: '700' as never, color: mm.colors.inkFaint },
  recordGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: theme.sp(3.5), borderRadius: theme.radius.pill },
  recordBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad },
  recWrap: {
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: 'rgba(121, 103, 210, 0.20)',
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  secHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  secTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  secCount: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },
  /* ── 运动记录卡（v18.88 参考 Apple Fitness / Garmin / Keep 范式）────── */
  secSumRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) },
  secSumChip: {
    paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
  },
  secSumText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft },
  wkCard: {
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: 'rgba(121, 103, 210, 0.20)',
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(3),
  },
  wkHead: { flexDirection: 'row', alignItems: 'center' },
  wkIco: {
    width: theme.sp(13), height: theme.sp(13), borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  wkEmoji: { fontSize: theme.sp(7) },
  wkHeadBody: { flex: 1, marginLeft: theme.sp(3), marginRight: theme.sp(2) },
  wkName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  wkMeta: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, marginTop: theme.sp(0.75) },
  wkDur: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  wkStats: {
    flexDirection: 'row', marginTop: theme.sp(3), paddingTop: theme.sp(3),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
  wkStat: { flex: 1, alignItems: 'flex-start' },
  wkStatVal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  wkStatLabel: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint, marginTop: theme.sp(0.5) },
  wkZone: { marginTop: theme.sp(3) },
  wkZoneTop: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(2) },
  wkZoneTag: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.radius.sm },
  wkZoneTagText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never },
  wkZoneHint: { marginLeft: 'auto', fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },
  /* 心率条：容器整条圆角 + overflow hidden，内部 4 段无缝拼接（Garmin/Apple 那种分段条），
     比「每段各自圆角」更干净，也避免 6pt 细条套 radius.sm 变成 4 个小胶囊 */
  wkZoneBar: { flexDirection: 'row', height: theme.sp(2), borderRadius: theme.sp(1), overflow: 'hidden' },
  wkZoneSeg: { flex: 1, backgroundColor: theme.colors.ui.offTrack },
  emptyCard: { paddingVertical: theme.sp(4), alignItems: 'center' },
  emptyIco: {
    width: theme.sp(13), height: theme.sp(13), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.sp(2.5),
  },
  emptyIcoText: { fontSize: theme.sp(7) },
  emptyTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: theme.sp(1) },
  emptySub: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, textAlign: 'center', lineHeight: theme.fs(19) },
  recFoot: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, marginTop: theme.sp(1), lineHeight: theme.fontSize.card },

  /* ── 记录运动 · 运动种类选择面板（v18.87）──────────────── */
  pickerWrap: {
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: 'rgba(121, 103, 210, 0.20)',
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(1),
  },
  pickerTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, marginBottom: theme.sp(2) },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2), marginBottom: theme.sp(3) },
  kindChip: {
    paddingHorizontal: theme.sp(3.5), paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  kindChipActive: { backgroundColor: mm.colors.limeSoft ?? mm.chipBg.lav.bg },
  kindChipText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.medium as never, color: mm.colors.inkSoft },
  kindChipTextActive: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.limeDeep }, // ★ 对比度修复：浅 lav 字压 limeSoft 底不可读 → limeDeep
  minuteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1.5) },
  minuteLabel: { fontSize: theme.fontSize.body, color: mm.colors.inkSoft },
  minuteStepper: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(3) },
  minuteBtn: {
    width: theme.sp(8), height: theme.sp(8), borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg, alignItems: 'center', justifyContent: 'center',
  },
  minuteBtnText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.chipBg.lav.fg },
  minuteValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, minWidth: theme.sp(10), textAlign: 'center' },
  kcalHint: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, marginBottom: theme.sp(3) },
  pickerActionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  pickerCancel: {
    paddingHorizontal: theme.sp(4.5), paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill, backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerCancelText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.inkSoft },

  /* ── 今日训练建议卡（v18.89）────────────────────────────── */

  /* ── 今日状态分析卡（v18.90）────────────────────────────── */
  /* 未同步时不是「没有分数」的空洞，而是浅一档的数字，读起来不重也不假 */
  /* 当前点：用左侧负 margin 把圆点中心对齐到 left% 位置（StyleSheet 静态，不能按 pct 改 width） */



  /* ── 方案卡脚注（依据）────────────────────────────────── */

  /* ── ① 今日状态卡（每 30 分钟一跳，带半小时小条）───────── */
  /* ── ② 为什么今天这么动（三枚软色圆 chip + 分析行 + 结论）── */

});


/* ── 运动页 V3 样式（mira-design/SPORT-DIET-SPEC-v1.md §2.2–2.6）──────────────────────── */
const sp2 = StyleSheet.create({
  /* 白卡通用 ★ 本轮：bgMid 实底 → cardBg 磨砂玻璃（对齐首页/饮食页），可辨识 */
  card: {
    backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card, padding: theme.space.cardPadCompact,
  },
  /* ★ 本轮：弧与下方内容间距拉开（-3 负重叠 → +4 留白） */
  /* ★ 本轮（用户）：弧 ↔ 下方卡片 拉开距离（4 → 6） */
  heroRing: { alignItems: 'center', paddingTop: theme.sp(1), paddingBottom: 0, marginBottom: theme.sp(6) },
  conclusion: { marginBottom: theme.sp(1), alignItems: 'flex-start' },
  conclusionTitle: { fontSize: theme.fontSize.card, lineHeight: theme.fontSize.orb, fontWeight: theme.weight.semibold as never, color: mm.colors.ink, textAlign: 'left' },
  conclusionSub: { marginTop: theme.sp(1), fontSize: theme.fontSize.sm, lineHeight: theme.fs(19), color: mm.colors.inkFaint, textAlign: 'left' },
  kickerWrap: { marginBottom: theme.sp(1.5) },
  /* 推荐卡头部：主标签(MiraTag) + 小字说明，对齐饮食页层级 */
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  sectionTitle: { fontSize: theme.fontSize.card, lineHeight: theme.fontSize.orb, fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  sectionLink: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.lg, color: mm.colors.inkFaint },
  workoutCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder, borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginBottom: theme.sp(2) },
  workoutIcon: { width: theme.sp(12), height: theme.sp(12), borderRadius: theme.sp(4), alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(2.5) },
  workoutIconText: { fontSize: theme.fs(27), fontWeight: '500' as never },
  workoutBody: { flex: 1, minWidth: 0 },
  workoutName: { fontSize: theme.fontSize.card, lineHeight: theme.fs(23), fontWeight: theme.weight.semibold as never, color: mm.colors.ink },
  workoutMeta: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.lg, color: mm.colors.inkSoft, marginTop: 2 },
  workoutWhy: { fontSize: theme.fontSize.micro, lineHeight: theme.fs(16), color: mm.colors.inkFaint, marginTop: 2 },
  startButton: { backgroundColor: mm.colors.limeMid, borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1.75) },
  startButtonText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  recHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2), marginBottom: theme.sp(1.5) },
  recHeadSub: { fontSize: theme.fontSize.sm, fontWeight: '600' as never, color: mm.colors.inkFaint },

  /* 强度环：150×150 居中，上方留白 8（SPEC §2.2） */
  ringBox: { alignItems: 'center', marginTop: theme.sp(2), position: 'relative' },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  /* 档位名最大 4 字（黄金窗口），fs(24) 保证不溢出环内径 */
  ringGear: { fontSize: theme.fontSize.orb, fontWeight: '500' as never, color: mm.colors.ink, letterSpacing: -0.3 },
  ringGearSub: { fontSize: theme.fontSize.micro, fontWeight: '700' as never, color: mm.colors.inkFaint, marginTop: theme.sp(0.75) },

  /* stat3 三格：环下方 10px，3 列 gap 8，tint 底（SPEC §2.3） */
  stat3: { flexDirection: 'row', gap: theme.sp(1.5), marginTop: theme.sp(2) },
  /* ★ 本轮：tint 实底 → cardBg 磨砂玻璃（对齐首页/饮食页），白字在磨砂底上可读，彩色用 statDot 保留 */
  statTile: { flex: 1, borderRadius: theme.sp(3), paddingHorizontal: theme.sp(1.75), paddingVertical: theme.sp(1.75), backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder },
  statDot: { width: theme.sp(1.75), height: theme.sp(1.75), borderRadius: theme.radius.pill, marginBottom: theme.sp(1.25) },
  statLabel: { fontSize: theme.fontSize.xs, fontWeight: '700' as never, color: mm.colors.inkSoft },
  statValue: { fontSize: theme.fontSize.body, fontWeight: '700' as never, color: mm.colors.ink, marginTop: 2 },

  /* 理由行（adv）：tag 胶囊 soft 底 deep 字 + 正文，行间细分隔线（SPEC §2.4） */
  advList: { marginTop: theme.sp(1.5) },
  advRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: theme.sp(2) },
  advRowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.ui.borderSoft },
  advTag: {
    minWidth: theme.sp(10), paddingHorizontal: theme.sp(2.25), paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill, marginRight: theme.sp(2), marginTop: theme.sp(0.25),
    alignItems: 'center', justifyContent: 'center',
  },
  advTagText: { fontSize: theme.fontSize.xs, fontWeight: '800' as never, lineHeight: theme.fs(16) },
  advText: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: theme.fs(19), fontWeight: '600' as never, color: mm.colors.inkSoft },

  /* 推荐行（SPEC §2.5）：加粗「时长 · 时间」+ why */
  recRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: theme.sp(2) },
  recBody: { flex: 1, minWidth: 0 },
  recMain: { fontSize: theme.fontSize.body, fontWeight: '700' as never, color: mm.colors.ink },
  recWhy: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.card, fontWeight: '600' as never, color: mm.colors.inkSoft, marginTop: 2 },

  /* 依据行：固定文案，居中（SPEC §2.5 + §4 红线 4） */
  sourceLine: {
    fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, textAlign: 'center',
    marginTop: theme.sp(1.5), paddingTop: theme.sp(2),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
  },
});
