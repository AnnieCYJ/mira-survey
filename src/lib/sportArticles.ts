/**
 * sportArticles —— 运动建议 · 图文文章库（v18.83）
 *
 * 与 learnArticles/glowArticles 同构：插画封面 + 分类/时长标签 + 短段落正文。
 * 内容口径：周期阶段 × 运动（雌激素/孕激素/皮质醇），背书只用真实可查的
 * （Stacey Sims、运动生理学共识、HRV 指导训练文献），平实、不做诊断承诺（Mira 铁律）。
 * 封面插画为 Mira 淡紫色系水彩（assets/sport/）。
 */
import type { LearnArticle } from './learnArticles';

export const SPORT_AUTHOR = 'Mira 编辑部';
export const SPORT_HERO_ID = 'cycletraining';

export const SPORT_ARTICLES: LearnArticle[] = [
  {
    id: 'cycletraining',
    method: {"why": "周期是安排训练的背景，今天的睡眠、恢复和主观疲劳共同决定负荷。", "steps": ["开始前看今天的恢复状态，并问自己是否疲劳或疼痛。", "感觉良好时按原计划训练；疲劳明显时减少负荷或换成轻活动。", "记下运动类型、时长和训练后的感受。"], "observe": "比较次日恢复、睡眠和同一周期阶段的体验，逐步形成个人训练节奏。"},
    eyebrow: '本周主题',
    minutes: 5,
    title: '跟着周期练：四个阶段的运动地图',
    shortTitle: '跟着周期练：四阶段运动地图',
    cover: require('../assets/sport/sport_hero.jpg'),
    date: '9 月 30 日',
    sources: [
      'Sims S.T. & Yeager S., ROAR, 2016（女性运动生理学专著）',
      'McNulty K.L. et al., Sports Med, 2020（周期相位与运动表现系统综述：差异有限且个体差异大）',
    ],
    paragraphs: [
      '女性运动生理学家 Stacey Sims 有句流传很广的话：女人不是小号男人——女性的训练不该照搬男性模板，因为激素水平整月在变，身体对同样一次训练的反应也在变。',
      '大致的地图是这样：卵泡期（月经结束后到排卵前）雌激素上行，是上强度、冲成绩的窗口；排卵后进入黄体期，孕激素让核心体温升高、恢复变慢，强度可以降一档；经期前后则以低强度和身体感受优先。',
      '这不是要把训练表做成激素课表——研究对「精确按相位分期」的收益仍有争论，但方向是一致的：高激素阶段练得进就多练，低激素阶段别硬扛。',
      'Mira 的角色是帮你看见自己的节奏：今日状态、HRV 和周期阶段放在一起看，比背一张通用时间表更可靠。',
    ],
  },
  {
    id: 'folliculartrain',
    eyebrow: '卵泡期',
    minutes: 4,
    title: '卵泡期：把大重量安排在这里',
    cover: require('../assets/sport/sport_follicular.jpg'),
    date: '9 月 30 日',
    sources: [
      'Riley J.L. et al., Pain, 1999（周期相位与疼痛敏感性 meta 分析）',
      'Shultz S.J. et al., J Athl Train, 2010（周期相位与膝关节松弛度）',
    ],
    paragraphs: [
      '月经结束到排卵前这两周左右，雌激素处于上行通道。雌激素对运动者是友好的：它支持肌肉蛋白合成、帮助恢复，研究还观察到这个阶段疼痛敏感度偏低——同样的训练，主观上没那么累。',
      '所以力量训练的「上新」安排在这里最顺：加重量、加组数、学新动作，都放在这个窗口。想要冲 PB（个人最好成绩），比赛或测试也尽量排在这个阶段。',
      '一个提醒：排卵前后韧带松弛相关激素波动，一些运动医学文献提示这个时间点前关节不稳的风险略高——深蹲硬拉上重量时，动作质量优先于重量数字。',
    ],
  },
  {
    id: 'lutealtrain',
    eyebrow: '黄体期',
    minutes: 4,
    title: '黄体期：降强度，提质量',
    cover: require('../assets/sport/sport_luteal.jpg'),
    date: '9 月 30 日',
    sources: [
      'Stachenfeld N.S. et al., J Appl Physiol, 2000（孕激素与体温调节·运动）',
      'Sims S.T. & Yeager S., ROAR, 2016（黄体期训练建议）',
    ],
    paragraphs: [
      '排卵之后，孕激素接管。它的代谢效应是让核心体温升高零点三到零点五度、呼吸略加快——意味着同样配速的有氧，这个阶段主观会更吃力，这不是你变弱了，是生理成本变高了。',
      '运动生理学圈（包括 Stacey Sims 的公开建议）对这个阶段的共识是：降强度、保频率。把大重量换成中低强度多次数，把间歇跑换成节奏跑或 Zone 2，恢复日的占比可以多一点。',
      '经前一周如果 HRV 明显走低、睡眠也差，训练的目标就从「变强」切换成「维持」——散步、瑜伽、游泳都算数。经期结束进入下一个卵泡期时，你会发现强度很自然地回来了。',
    ],
  },
  {
    id: 'periodtrain',
    eyebrow: '经期',
    minutes: 3,
    title: '经期：低强度不是躺平',
    cover: require('../assets/sport/sport_period.jpg'),
    date: '9 月 30 日',
    sources: [
      'Armour M. et al., Cochrane Database Syst Rev, 2019（运动对原发性痛经的干预证据）',
      'McNulty K.L. et al., Sports Med, 2020（各相位均可正常运动的系统综述）',
    ],
    paragraphs: [
      '关于经期要不要运动，运动医学的答案很一致：可以动，而且适度活动比完全休息感觉更好——轻中强度运动能促进盆腔血液循环，对痛经和胀闷的缓解有研究支持。',
      '合适的菜单：散步、温和瑜伽（猫牛式、婴儿式这类舒展骨盆的动作）、游泳、慢骑。避开的是在身体明确抗议时硬上大重量或高强度间歇。',
      '出血量大的前两天可以把强度压到「能边动边聊天」，后几天视感受逐步恢复。真正的红线只有一个：以身体的感受为准，而不是日历上的计划。',
    ],
  },
  {
    id: 'cortisoltrain',
    eyebrow: '皮质醇',
    minutes: 4,
    title: '运动是压力开关，也可能反向',
    cover: require('../assets/sport/sport_cortisol.jpg'),
    date: '9 月 30 日',
    sources: [
      'Meeusen R. et al., Eur J Sport Sci, 2013（过度训练：预防·诊断·恢复的共识声明）',
      'Lehmann M. et al., Med Sci Sports Exerc, 1998（过度训练的自主神经与皮质醇改变）',
    ],
    paragraphs: [
      '一次训练的本质是给身体一个可控的压力：运动中皮质醇短暂升高，训练结束后回落，身体顺势修得更强——这是运动让人「解压」的生理版本。',
      '但剂量决定方向。长期高强度训练堆得太满、恢复跟不上时，皮质醇基线会被持续抬高——过度训练综合征的核心特征之一就是它：睡眠变浅、静息心率升高、情绪变钝、表现不升反降。',
      '给自己设两道闸门：一是每周留至少一天完全休息；二是晨间 HRV 连续几天明显低于自己的基线时，当天的高强度课换成散步或拉伸。练得多不算本事，练完恢复得回来才算。',
    ],
  },
  {
    id: 'hrvtrain',
    eyebrow: '恢复',
    minutes: 4,
    title: 'HRV：你的每日训练仪表盘',
    cover: require('../assets/sport/sport_hrv.jpg'),
    date: '9 月 30 日',
    sources: [
      'Plews D.J. et al., Med Sci Sports Exerc, 2013（HRV 用于训练监测）',
      'Buchheit M., Eur J Sport Sci, 2014（HRV 与运动员恢复状态）',
    ],
    paragraphs: [
      'HRV（心率变异性）是自主神经的窗口：副交感占上风时数值偏高，身体处于「修得好」的状态；压力、睡眠不足、训练疲劳累积时走低。职业运动队用它指导训练已经有十几年。',
      '用法比数值本身重要：单天的 HRV 意义有限，真正有用的是它相对你自己基线的偏移。连续几天低于基线，是身体在说「恢复欠账了」——这天安排恢复课比硬顶更划算。',
      '把三样放在一起看最可靠：昨晚睡眠、晨间 HRV、今天的周期阶段。它们一致向好时放心上强度，互相打架时先还账。这正是 Mira 戒指每天帮你攒的三个信号。',
    ],
  },
  {
    id: 'fatloss',
    eyebrow: '体重管理',
    minutes: 5,
    title: '减肥不是和身体对抗',
    cover: require('../assets/sport/sport_fatloss.jpg'),
    date: '9 月 30 日',
    sources: [
      'Leibel R.L. et al., N Engl J Med, 1995（减重后的代谢适应经典研究）',
      'Rosenbaum M. & Leibel R.L., Int J Obes, 2010（代谢适应的生理机制综述）',
    ],
    paragraphs: [
      '节食减肥的老剧本：狠砍热量、体重掉得快、然后平台期、再反弹。生理学解释这出戏的词是代谢适应——长期大幅热量缺口下，皮质醇升高、瘦素下降、甲状腺激素下调，身体把「省电模式」全部打开，消耗越来越低，食欲越来越强。',
      '更稳的路线反着来：缺口小一点（每天 300-400 千卡就够）、蛋白质吃够、力量训练保住肌肉。肌肉是代谢的硬通货——它决定你躺着也烧多少，以及减肥后体重守不守得住。',
      '女性还有一层周期因素：黄体期孕激素上行会自然推高食欲，经前想吃是生理的，不是意志力问题。聪明的做法是把饮食上「松一点」的那几天安排在黄体期后期，而不是靠硬扛。',
      '减脂期运动的目标也随之变：不是练到力竭证明努力，而是保肌肉（力量训练）+ 提日常消耗（步数）。过量有氧叠加大缺口，恰恰是皮质醇升高、平台期加速到来的配方。',
    ],
  },
  {
    id: 'cortisolcalm',
    eyebrow: '皮质醇',
    minutes: 4,
    title: '把皮质醇降下来的四件小事',
    cover: require('../assets/sport/sport_calm.jpg'),
    date: '9 月 30 日',
    sources: [
      'Balban M.Y. et al., Cell Reports Medicine, 2023（循环叹息对照试验，斯坦福）',
      'Spiegel K. et al., Ann Intern Med, 2004（睡眠剥夺与皮质醇·饥饿素）',
      'Scheer F.A. & Buijs R.M., J Biol Rhythms, 1999（晨光与皮质醇节律校准）',
    ],
    paragraphs: [
      '皮质醇本身不是敌人——它让你早上醒得来、遇事跑得动。问题只在「该降的时候不降」：长期高压下 cortisol 全天高位，腹部脂肪堆积、对甜食和高脂食物的渴望增强，这些都是被反复观察到的关联（压力进食有大量实验证据，不是借口话术）。',
      '四件小事按性价比排序：第一是睡眠——睡眠剥夺研究的经典结论是，几个晚上睡不够，皮质醇节律就会抬高，饥饿素也跟着涨，第二天对垃圾食品的抵抗力明显变差；固定的入睡时间比多睡一小时更有用。',
      '第二是呼吸：两次短吸加一次长呼的生理性叹息，每天几分钟就有可测量的效果（斯坦福团队 2023 年的对照研究，详见「知识科普」里那篇）。第三是运动换挡：压力大的时候把高强度课换成 Zone 2 或散步——运动量超过恢复能力时，皮质醇不降反升。第四是晨光：起床后到户外见光 5-10 分钟，把皮质醇高峰校准回上午，节律顺了，晚上自然降得下来。',
      '这四件没有一件需要花钱，难的都是「每天做」。这也是为什么 Mira 把它们拆成卡片和提醒——省下记这些事的意志力，正好用在工作上。',
    ],
  },
];

export function getSportArticle(id: string): LearnArticle {
  return SPORT_ARTICLES.find((a) => a.id === id) ?? SPORT_ARTICLES[0];
}
