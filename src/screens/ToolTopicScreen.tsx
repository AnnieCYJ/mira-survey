/**
 * ToolTopicScreen —— 工具页通用内容页（v18.70）
 *
 * 承接工具页六宫格中尚无独立模块的三类：提升颜值 / 运动建议 / 知识科普。
 * 结构：标题 + 副标题 + 一条「今日状态」数据驱动提示 + 知识条目（ListCard）。
 * v18.70：知识科普（learn）改版为图文科普样式——hero 插画卡 + 文章列表卡，
 *         点进 LearnRead 阅读详情页（参考图文阅读排版）。
 * 内容口径：平实、带原因、不做诊断承诺（Mira 文案铁律）。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, ImageBackground, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import ListCard, { type ListItem } from '../components/ListCard';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { LEARN_ARTICLES, LEARN_HERO_ID, getLearnArticle } from '../lib/learnArticles';
import { GLOW_ARTICLES, GLOW_HERO_ID, getGlowArticle } from '../lib/glowArticles';
import { SPORT_ARTICLES, SPORT_HERO_ID, getSportArticle } from '../lib/sportArticles';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type TopicKey = 'glow' | 'sport' | 'learn';

const TOPIC_META: Record<TopicKey, { title: string; sub: string }> = {
  glow: { title: '提升颜值', sub: '跟着周期节奏，把气色养回来' },
  sport: { title: '运动建议', sub: '按今天的状态开运动处方' },
  learn: { title: '知识科普', sub: '平衡激素的四根杠杆：光 · 睡 · 压 · 动' },
};

const ACCENT: Record<TopicKey, string> = {
  glow: theme.colors.stateTense,
  sport: '#22C55E',
  learn: theme.colors.accent2,
};

export default function ToolTopicScreen() {
  const route = useRoute<{ key: string; name: string; params: { topic: TopicKey } }>();
  const navigation = useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>>();
  const topic: TopicKey = (route.params?.topic ?? 'learn') as TopicKey;
  const meta = TOPIC_META[topic] ?? TOPIC_META.learn;
  const scrollY = useRef(new Animated.Value(0)).current;
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
  const levelIdx = value != null ? (value >= 65 ? 0 : value >= 30 ? 1 : value >= 5 ? 2 : 3) : null;

  // ── 「今日」一条数据驱动提示 ──
  const today: ListItem = (() => {
    if (topic === 'glow') {
      if (sleepScore == null) return { dot: ACCENT.glow, title: '睡眠与气色', sub: '连续佩戴记录睡眠后，这里会告诉你昨晚的修复给气色加了多少分。' };
      return sleepScore >= 80
        ? { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: `${phase}期皮肤修复窗口在线——今天防晒做好，气色能保住。` }
        : { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: '皮肤屏障修复主要发生在深睡——今晚提前 30 分钟放下手机。' };
    }
    if (topic === 'sport') {
      if (levelIdx == null) return { dot: ACCENT.sport, title: '今日运动建议', sub: '佩戴后按实时电量与恢复状态给出运动强度建议。' };
      if (phase === '经期') return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '经期以低强度为主：散步、拉伸、温和瑜伽都合适。' };
      if (levelIdx === 0) return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量在高位，适合安排一次有强度训练，HRV 基线也会受益。' };
      return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量偏低，先快走 15 分钟恢复代谢，别硬扛高强度。' };
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
      <ScreenContainer scrollY={scrollY} topFadeColor={theme.colors.textWhite}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>{meta.title}</Text>
          <Text style={styles.subtitle}>{meta.sub}</Text>
        </Animated.View>
        {(topic === 'learn' || topic === 'glow' || topic === 'sport') ? (
          topic === 'learn'
            ? <LearnSection phase={phase} navigation={navigation} />
            : topic === 'glow'
              ? <GlowSection sleepScore={sleepScore} navigation={navigation} />
              : <SportSection steps={steps} phase={phase} levelIdx={levelIdx} navigation={navigation} />
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
 * 顶部提示行带今日步数/电量（有数据才展示，诚实口径）。
 */
function SportSection({ steps, phase, levelIdx, navigation }: { steps: number; phase: string; levelIdx: number | null; navigation: TopicNav }) {
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

      {/* 状态提示行（诚实口径：未佩戴就直说） */}
      <Text style={ls.phaseTip}>
        {levelIdx == null
          ? '佩戴戒指后，这里会按今天的电量与恢复状态给运动提示。'
          : phase === '未记录'
            ? `今日 ${steps} 步 · 记录经期后，运动内容会跟着你的周期阶段更新。`
            : `今日 ${steps} 步 · 当前 ${phase} · 运动跟着周期阶段调强度`}
      </Text>

      <View style={ls.secHead}>
        <Text style={ls.secTitle}>按荷尔蒙节奏安排训练</Text>
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
