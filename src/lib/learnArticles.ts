/**
 * learnArticles —— 知识科普图文文章库（v18.70）
 *
 * 参考图文科普样式：插画封面 + 分类/时长标签 + 短段落正文。
 * 封面插画为 Mira 淡紫色系水彩（assets/learn/），一次生成、全文章共用一套。
 * 文案口径：平实、带原因、不做诊断承诺（Mira 铁律）。
 */

export interface LearnArticle {
  id: string;
  /** 分类标签（列表卡/详情页眉行） */
  eyebrow: string;
  /** 预计阅读分钟数（真实正文长度估算，不做假时长） */
  minutes: number;
  title: string;
  /** 列表卡上的短标题（详情页用 title 全称） */
  shortTitle?: string;
  cover: number;
  date: string;
  paragraphs: string[];
  /** 参考出处（v18.86：荷尔蒙系列文章附真实文献；可选，有则渲染「参考出处」块） */
  sources?: string[];
}

export const LEARN_AUTHOR = 'Mira 编辑部';

export const LEARN_ARTICLES: LearnArticle[] = [
  {
    id: 'levers',
    eyebrow: '本周主题',
    minutes: 5,
    title: '平衡激素的四根杠杆：光 · 睡 · 压 · 动',
    shortTitle: '平衡激素的四根杠杆',
    cover: require('../assets/learn/learn_hero.jpg'),
    date: '9 月 29 日',
    sources: [
      'Czeisler C.A. et al., Science, 1989（亮光重置人体昼夜节律）',
      'Balban M.Y. et al., Cell Reports Medicine, 2023（生理性叹息调节自主神经，斯坦福）',
    ],
    paragraphs: [
      '激素不是一个开关，更像一套跟着节律走的系统。光、睡眠、压力、运动这四件事，是日常里最容易调整、也最影响节律的四个支点。',
      '光是最准的校准器：起床后一小时内到户外见光 5-10 分钟，皮质醇准点爬升，褪黑素才能准点到来。睡是修复窗口：深睡时段身体完成大部分修复与整理，时间点比时长更值得在意。',
      '压力本身不是坏事，短暂升高后能回落才是关键——两次短吸加一次长呼的生理性叹息，是最快的降温方式。动是长期底盘：每周几次「还能对话」节奏的有氧，加上适量力量训练，激素才有平稳运转的地基。',
      '四根杠杆不用一次全动。先挑本周最容易做到的一根，节奏顺了，其余的会跟着顺。',
    ],
  },
  {
    id: 'estrogen',
    eyebrow: '周期与大脑',
    minutes: 4,
    title: '雌激素与大脑敏感性',
    cover: require('../assets/learn/learn_estrogen.jpg'),
    date: '9 月 26 日',
    sources: [
      'McEwen B.S. & Alves S.E., Endocr Rev, 1999（雌激素与大脑：血清素/多巴胺通路综述）',
      'Barth C. et al., Neurosci Biobehav Rev, 2015（月经周期与大脑结构·认知综述）',
    ],
    paragraphs: [
      '雌激素不只影响身体，也影响大脑。它会提升血清素与多巴胺通路的敏感性，这也是卵泡期精力与心情容易上扬的生理基础。',
      '卵泡期里，不少人对新任务的接受度更高、学习更顺手——把需要开创性的事安排在这个窗口，往往更省力。',
      '随后雌激素回落，敏感度也会跟着回落。这不是「变差了」，而是节律的正常起伏；提前知道，就能提前安排。',
    ],
  },
  {
    id: 'progesterone',
    eyebrow: '周期与大脑',
    minutes: 4,
    title: '孕激素的镇静与代价',
    cover: require('../assets/learn/learn_progesterone.jpg'),
    date: '9 月 26 日',
    sources: [
      'Majewska M.D. et al., Science, 1986（孕激素代谢物 ALLO 是 GABA-A 受体正向调制剂）',
      'Timby E. et al., Psychoneuroendocrinology, 2016（黄体期 ALLO 波动与 GABA 受体敏感性）',
    ],
    paragraphs: [
      '黄体期孕激素升高，它的代谢产物会作用于 GABA 受体——大脑里负责「踩刹车」的系统。所以这个阶段更容易困、更想缩起来，是生理性的镇静。',
      '代价是情绪波动也更常见：镇静与迟钝常常是同一件事的两面。',
      '这个阶段更适合把节奏放慢：减少并列任务、把重要沟通安排在精力高点。嗜睡不是偷懒，是身体在要求恢复。',
    ],
  },
  {
    id: 'cortisol',
    eyebrow: '压力与节律',
    minutes: 3,
    title: '皮质醇的晨峰意义',
    cover: require('../assets/learn/learn_cortisol.jpg'),
    date: '9 月 24 日',
    sources: [
      'Scheer F.A. & Buijs R.M., J Biol Rhythms, 1999（光照对晨间皮质醇的影响）',
      'Fries E. et al., Psychoneuroendocrinology, 2009（皮质醇觉醒反应综述）',
    ],
    paragraphs: [
      '健康的皮质醇节律是「晨高夜低」：起床后半小时左右到峰值帮你清醒，夜里落到低位，让褪黑素接手。',
      '如果节律偏晚——晚上精神、早上起不来——多半不是意志力问题，而是光照和作息把钟拨晚了。',
      '晨光是最准的校准器：固定时间起床、起床后见光，几天就能看到晨峰往前挪。上午有精神，是从早上那束光开始的。',
    ],
  },
  {
    id: 'dopamine',
    eyebrow: '专注力',
    minutes: 4,
    title: '多巴胺基线：别喂廉价刺激',
    cover: require('../assets/learn/learn_dopamine.jpg'),
    date: '9 月 22 日',
    sources: [
      'Schultz W., J Neurophysiol, 1998（多巴胺奖赏预测信号）',
      'Berridge K.C. & Robinson T.E., Brain Res Rev, 1993（诱因敏化：廉价刺激抬基线）',
    ],
    paragraphs: [
      '多巴胺负责「值得做」的感觉。刷手机、糖、频繁切换任务都在用低成本方式抬高它，代价是基线上移后，难事显得更无趣。',
      '早上第一小时是基线最容易被定调的时段。先做一件稍有难度但值得的事，再碰娱乐信息，一天里「想做难事」的意愿会不一样。',
      '不是要戒掉娱乐，而是把顺序换过来：先难后易，廉价刺激就只是饭后甜点。',
    ],
  },
  {
    id: 'ring',
    eyebrow: '关于数据',
    minutes: 3,
    title: '为什么戒指测不了激素',
    cover: require('../assets/learn/learn_ring.jpg'),
    date: '9 月 20 日',
    sources: [
      'Shilaih M. et al., Sci Rep, 2018（可穿戴连续体温追踪排卵窗口）',
      'Bull J.R. et al., npj Digit Med, 2019（60 万真实周期的大数据分析）',
    ],
    paragraphs: [
      '激素分子需要生化检测（血液、唾液）才能直接定量，戒指无法替代这一点。',
      '戒指读的是激素留下的「生理足迹」：皮肤温度、心率、HRV 的昼夜变化会跟着周期起伏。借助这些足迹，可以估计周期阶段。',
      '这也是 Mira 的口径：戒指给的是身体信号，你的感受是第一手数据。两者对照着看，比任何单一来源都更接近真实。',
    ],
  },
  {
    id: 'hormCognition',
    eyebrow: '激素 × 认知',
    minutes: 4,
    title: '雌激素上行的那两周，脑子确实更好使',
    cover: require('../assets/learn/learn_cognition.jpg'),
    date: '9 月 30 日',
    sources: [
      'Hampson E., Cerebral Cortex, 1990（周期相位与认知任务表现）',
      'Maki P.M., Climacteric, 2015（雌激素与认知综述）',
    ],
    paragraphs: [
      '这不是错觉。认知心理学家 Hampson 在上世纪 90 年代的经典实验里发现：语言流畅度这类任务的表现会跟着周期起伏，雌激素高位的卵泡期普遍更好。后续三十年的研究大体延续了这一结论——方向真实，只是个体差异不小。',
      '机理解释也相对清楚：雌激素能上调脑内乙酰胆碱系统、支持海马可塑性，还影响多巴胺通路——它对认知的作用是「结构级」的，不只是让人感觉良好。',
      '落地版：把需要口才、创造力、学新东西的任务排在卵泡期（约月经结束到排卵前），把重复性、收尾类的工作留给黄体期——顺着激素节奏分工，比逆着它硬撑高效。',
    ],
  },
  {
    id: 'hormEmotion',
    eyebrow: '激素 × 情绪',
    minutes: 4,
    title: '经前情绪波动，从 GABA 受体说起',
    cover: require('../assets/learn/learn_emotion.jpg'),
    date: '9 月 30 日',
    sources: [
      'Majewska M.D. et al., Science, 1986（孕激素代谢物是 GABA-A 受体正向调制剂）',
      'Epperson C.N. et al., Am J Psychiatry, 2012（经前焦虑障碍与 ALLO 水平研究）',
    ],
    paragraphs: [
      '孕激素本身是「镇静」的，但它的主要代谢物 ALLO（别孕烷醇酮）才是主角：1986 年《Science》上的经典研究确认，ALLO 是 GABA-A 受体的强力正向调制剂——和抗焦虑药作用在同一个靶点，所以排卵后很多女性会先感到一阵平静。',
      '戏剧性在后面：对经前情绪敏感的人群，2012 年《Am J Psychiatry》的研究观察到，她们的 ALLO 水平在黄体期的波动模式与不敏感者不同——问题不在激素总量，而在神经系统对激素「撤落」的敏感度。经前那几天情绪变脆，是生理事件，不是性格问题。',
      '知道这一点有两个用处：一是把重要的艰难对话尽量避开黄体期后期；二是经前的低落值得用生理手段回应（睡眠、光照、运动、生理性叹息），而不是自我批评。',
    ],
  },
  {
    id: 'hormMetabolism',
    eyebrow: '激素 × 代谢',
    minutes: 3,
    title: '黄体期每天多烧 100-300 千卡，是真的',
    cover: require('../assets/learn/learn_metabolism.jpg'),
    date: '9 月 30 日',
    sources: [
      'Solomon S.J. et al., Am J Clin Nutr, 1982（周期与静息代谢率）',
      'Bisdee J.T. et al., Metabolism, 1989（黄体期静息代谢率升高 5%-11%）',
    ],
    paragraphs: [
      '黄体期「更容易饿、更想吃」，对应的另一面是：身体真的在多烧能量。八十年代两项经典代谢研究都测到，黄体期静息代谢率比卵泡期升高约 5%-11%——按普通女性的基础代谢折算，大约每天多烧 100-300 千卡。',
      '这解释了经前食欲上行的生理合理性：需求是真的。对应策略不是压抑，而是「加量不加 junk」——正餐蛋白质和主食吃够，把经前的甜食渴望在餐后体面地满足掉。',
      '顺带修正一个流行误解：经期后体重快速下降主要是孕激素保水效应消退、水肿回落——那几天的体重变化是水，不是脂肪。看体重趋势，请跨周期比较同一相位。',
    ],
  },
  {
    id: 'hormSleep',
    eyebrow: '激素 × 睡眠',
    minutes: 4,
    title: '为什么经前一周睡得特别差',
    cover: require('../assets/learn/learn_hormsleep.jpg'),
    date: '9 月 30 日',
    sources: [
      'Lancel M., Biol Psychiatry, 1999（孕激素对人类睡眠结构的影响）',
      'Shechter A. & Boivin D.B., Sleep Med Rev, 2010（月经周期与睡眠·昼夜节律综述）',
    ],
    paragraphs: [
      '黄体期的睡眠挑战是双重的：一方面，孕激素升高让核心体温高出零点三到零点五度——而入睡的生理开关恰恰是核心体温下降，体温降不下来，入睡就慢；另一方面，黄体后期激素「撤落」伴随睡眠变浅、夜醒增多，综述研究显示经前一周的睡眠质量自评是整个周期里最差的。',
      '有一点反直觉的安慰：孕激素本身其实助眠——它通过 GABA 系统缩短入睡时间、加深深睡。所以黄体早期困得早、睡得沉是真实的；难熬的是激素撤落的经前一周。',
      '针对性做法：那一周把卧室调凉一点（温水澡后入睡、室温比平时低一两度）、睡前一小时灯光调暗、固定的起床时间撑住节律。熬过去就是卵泡期——睡眠会自己回来。',
    ],
  },
  {
    id: 'hormRecovery',
    eyebrow: '激素 × 恢复',
    minutes: 4,
    title: 'HRV 的月度节奏：黄体期低一点是正常的',
    cover: require('../assets/learn/learn_recovery.jpg'),
    date: '9 月 30 日',
    sources: [
      'Yildirir A. et al., Gynecol Endocrinol, 2002（月经周期对心率变异性的影响）',
      'Sato N. et al., Clin Auton Res, 1996（周期各相位自主神经活动观察）',
    ],
    paragraphs: [
      '不少用户的困惑：同样的训练量和睡眠，为什么黄体期测出来的 HRV 就是低一截？多项观察研究（含九十年代以来的自主神经与 HRV 研究）给出了方向一致的答案：黄体期孕激素上行会推高交感张力、降低副交感占比，HRV 走低是这个阶段的常态，而不是身体变差了。',
      '这就是「相对基线」思维的用武之地：别拿今天的 HRV 和上周的绝对值比，拿它和「同相位的历史区间」比——Mira 按周期阶段放基线，就是这个原因。黄体期 HRV 低 5-10%，大概率只是激素背景噪音。',
      '实操口径：训练强度看「同相位基线 + 昨晚睡眠 + 主观感受」三票。三票里有票反对，就降一档——黄体期降的强度，卵泡期会连本带利还给你。',
    ],
  },
];

export function getLearnArticle(id: string): LearnArticle {
  return LEARN_ARTICLES.find((a) => a.id === id) ?? LEARN_ARTICLES[0];
}

/** 首页 hero 卡对应的文章 id */
export const LEARN_HERO_ID = 'levers';
