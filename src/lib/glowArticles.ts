/**
 * glowArticles —— 提升颜值 · 图文文章库（v18.79）
 *
 * 与 learnArticles 同构：插画封面 + 分类/时长标签 + 短段落正文。
 * 内容口径：斯坦福皮肤科的公开共识（防晒/屏障/睡眠修复）+ 明星圈流行的
 * 「极简护肤」路线（skinimalism：步骤少而稳），平实、带原因、不做诊断承诺（Mira 铁律）。
 * 封面插画为 Mira 淡紫色系水彩（assets/glow/）。
 */
import type { LearnArticle } from './learnArticles';

export const GLOW_AUTHOR = 'Mira 编辑部';

export const GLOW_ARTICLES: LearnArticle[] = [
  {
    id: 'minimal',
    eyebrow: '本周主题',
    minutes: 5,
    title: '极简护肤：三步就够',
    shortTitle: '极简护肤：三步就够',
    cover: require('../assets/glow/glow_hero.jpg'),
    date: '9 月 30 日',
    sources: [
      'American Academy of Dermatology 官方护肤建议（温和清洁·保湿·防晒三步）',
      'Sethi A. et al., Indian J Dermatol, 2016（保湿剂与皮肤屏障修复）',
    ],
    paragraphs: [
      '皮肤科有一条共识被反复验证：皮肤自身就是好的修复器官，护肤要做的不是「多」，而是「少而稳」。斯坦福皮肤科医生公开讲过的建议里，核心从来只有三步——温和清洁、保湿、防晒。',
      '这也是不少长期皮肤状态稳定的人的共同点：步骤少、产品固定、不追新品。叠加太多功效品，屏障反而更容易被刺激，泛红、敏感大多从这里来。',
      '三步怎么落：早上清水或温和洁面，随后保湿，最后防晒；晚上卸掉防晒和一天的油污，再补一层保湿就够了。给皮肤留一点「什么都不涂」的余地，它自己会把节奏找回来。',
      '换任何新产品，先在耳后或下颌试三天。皮肤需要的不是惊喜，是一致性。',
    ],
  },
  {
    id: 'sunscreen',
    eyebrow: '极简护肤',
    minutes: 4,
    title: '防晒是性价比最高的一步',
    cover: require('../assets/glow/glow_sun.jpg'),
    date: '9 月 30 日',
    sources: [
      'Flament F. et al., Clin Cosmet Investig Dermatol, 2013（日常防晒减缓可见光老化）',
      'American Academy of Dermatology 防晒指南（用量与补涂频率）',
    ],
    paragraphs: [
      '皮肤科医生常挂在嘴边的一句话：如果只能保留一步护肤，留防晒。外源性皮肤衰老的大头来自紫外线，色斑、细纹、粗糙都和它有关。',
      '阴天也有 UVA，它能穿过云层和玻璃，所以防晒不是太阳大才做的事。帽子、伞、口罩这些硬防晒是最稳的一层，防晒霜补足露出来的部分。',
      '用量是最常见的坑：脸+颈一次大约一元硬币大小的量，出门前 15 分钟涂，长时间在户外中午补一次。涂得薄，指数再高也打折扣。',
    ],
  },
  {
    id: 'sleepskin',
    eyebrow: '修复窗口',
    minutes: 4,
    title: '睡眠是皮肤的夜间修复班',
    cover: require('../assets/glow/glow_sleep.jpg'),
    date: '9 月 30 日',
    sources: [
      'Van Cauter E. et al., JAMA, 2000（深睡与生长激素分泌）',
      'Chang A.M. et al., PNAS, 2015（睡前亮光推迟褪黑素）',
    ],
    paragraphs: [
      '深睡时段，生长激素分泌到全天高点，皮肤细胞的更新和屏障修复主要发生在这里。连续睡不好的那几天，气色先知道。',
      '想让修复班准点开工，两件事最有效：固定的入睡时间，和睡前一小时把灯光调暗——亮光会推迟褪黑素，也顺带推迟了修复窗口。',
      '两个小细节：枕套勤换（螨虫和油脂是闷痘的常见来路），睡前别大量喝水（凌晨的浮肿多半是它）。这些不花钱，比任何精华都稳。',
    ],
  },
  {
    id: 'sugar',
    eyebrow: '饮食与皮肤',
    minutes: 3,
    title: '糖化：暗沉不只是熬夜的事',
    cover: require('../assets/glow/glow_sugar.jpg'),
    date: '9 月 30 日',
    sources: [
      'Danby F.W., Clin Dermatol, 2010（糖化终产物与皮肤老化）',
      'Shukla A.P. et al., Diabetes Care, 2015（进食顺序对餐后血糖的影响）',
    ],
    paragraphs: [
      '血液里的糖会和胶原蛋白结合，生成叫「糖化终产物」的东西——胶原因此变硬变黄，肤色发黄、失去弹性，这个过程叫糖化。',
      '它没法逆转，但速度可以放慢。最见效的一刀是含糖饮料：液体糖吸收快、血糖冲得高，是日常里最容易改的一处。',
      '顺序也有讲究：先吃菜和蛋白质、再吃主食，同样的餐食血糖曲线平缓很多。不用戒什么，把顺序和饮料调过来，就是长期回报最高的两步。',
    ],
  },
  {
    id: 'cycleskin',
    eyebrow: '周期与皮肤',
    minutes: 4,
    title: '周期与皮肤：跟着阶段换打法',
    cover: require('../assets/glow/glow_cycle.jpg'),
    date: '9 月 30 日',
    sources: [
      'Shah M.G. & Maibach H.I., Am J Clin Dermatol, 2001（雌激素与皮肤综述）',
      'Williams M. & Cunliffe W.J., Lancet, 1973（经前皮脂分泌与痤疮加重）',
    ],
    paragraphs: [
      '皮肤是激素的显示屏。卵泡期雌激素上行，皮肤供血变好、含水量上升——这是上妆最服帖、皮肤最容光的一段，可以放心安排重要场合。',
      '黄体期孕激素升高、体温上行，出油和敏感跟着增加，经前爆痘大多在这个窗口。这时候把步骤减下来：温和清洁、简单保湿，少叠加功效品，给屏障留余地。',
      '不是皮肤变差了，是节律的正常起伏。提前知道自己在哪个阶段，就能提前把打法换过来——这也正是 Mira 把周期和护肤放在一起讲的原因。',
    ],
  },
  {
    id: 'stressskin',
    eyebrow: '压力与皮肤',
    minutes: 3,
    title: '压力痘的来路',
    cover: require('../assets/glow/glow_stress.jpg'),
    date: '9 月 30 日',
    sources: [
      'Chiu A. et al., J Am Acad Dermatol, 2003（心理压力与痤疮关联）',
      'Yosipovitch G. et al., Acta Derm Venereol, 2007（考试压力与皮脂·痤疮实测）',
    ],
    paragraphs: [
      '长期高压下，皮质醇持续偏高，皮肤两条路都受影响：出油变多，屏障变弱——油多了堵、屏障弱了容易发炎，压力痘就是这么来的。',
      '护肤品解决不了激素的事。真正把皮质醇拉下来的是老三样：规律睡眠、中等强度运动、以及短平快的降压动作——两次短吸加一次长呼的生理性叹息，几分钟内就能见效。',
      '皮肤是慢变量：这些事做一周看不出变化，做三个月，气色的差距是攒出来的。',
    ],
  },
  {
    id: 'follicularskin',
    eyebrow: '周期与皮肤 · 卵泡期',
    minutes: 4,
    title: '卵泡期：功效品的窗口期',
    cover: require('../assets/glow/glow_follicular.jpg'),
    date: '9 月 30 日',
    sources: [
      'Mukherjee S. et al., Clin Interv Aging, 2006（维A类抗老证据综述）',
      'Shah M.G. & Maibach H.I., Am J Clin Dermatol, 2001（雌激素与皮肤屏障·含水量）',
    ],
    paragraphs: [
      '卵泡期雌激素上行，皮肤供血和含水量都在高位，皮脂分泌平稳、耐受性也更好。同样的功效品，在这个窗口刺激感更轻、恢复更快。',
      '所以想用维A类、酸类这类功效成分的人，可以把「上新」和「加频」安排在卵泡期。维A类也是皮肤科共识里证据最充分的抗老成分之一——值得用，但要给皮肤适应的时间：从每周两晚、豌豆大小开始。',
      '反过来，皮肤状态差的日子不要急着换猛药。先看周期：如果正处在黄体期，刺激感重很可能不是产品的问题，是时机的问题。',
      '打法很简单：卵泡期进阶，黄体期减法。同一个产品，换窗口用，体验完全不同。',
    ],
  },
  {
    id: 'lutealskin',
    eyebrow: '周期与皮肤 · 黄体期',
    minutes: 4,
    title: '黄体期：给皮肤做轮换',
    cover: require('../assets/glow/glow_luteal.jpg'),
    date: '9 月 30 日',
    sources: [
      'Williams M. & Cunliffe W.J., Lancet, 1973（经前出油与痤疮加重的经典观察）',
      'Whitney Bowe M.D. 提出的 skin cycling 方法（2022 年起流行，非期刊论文）',
    ],
    paragraphs: [
      '黄体期孕激素升高、核心体温上行，出油和敏感跟着增加，经前爆痘大多出现在这个窗口。这时候还在按卵泡期的强度用功效品，泛红和刺痛是常见后果。',
      '这几年在欧美明星圈流行的「皮肤循环」（skin cycling）正适合这个阶段：功效夜、修复夜轮换——一晚用酸类或维A，接着一两晚只用保湿和修护，给屏障留出恢复时间。这个方法由皮肤科医生 Whitney Bowe 提出，逻辑就是「刺激与修复交替」，和黄体期的需求天然契合。',
      '落到日常：黄体期把功效频次砍半，多出的夜晚只做温和清洁加保湿。出油多也别频繁洗脸，一天两次温和清洁足够，洗太狠反而刺激出更多油。',
    ],
  },
  {
    id: 'periodskin',
    eyebrow: '周期与皮肤 · 经期',
    minutes: 3,
    title: '经期：屏障优先，做减法',
    cover: require('../assets/glow/glow_period.jpg'),
    date: '9 月 30 日',
    sources: [
      'Shah M.G. & Maibach H.I., Am J Clin Dermatol, 2001（激素低落期与皮肤状态）',
      'Pasricha S.R. et al., Lancet, 2021（女性铁缺乏的诊治综述）',
    ],
    paragraphs: [
      '经期激素落到低位，皮肤屏障偏弱、痛觉也更敏感——平时没感觉的产品，这几天可能突然刺痛。这不是产品坏了，是皮肤此刻的阈值低了。',
      '明星化妆师圈流传的「生理期做减法」就是这个道理：停掉所有酸类和去角质，只留温和清洁、保湿和防晒三件事。彩妆能简则简，卸妆时少揉搓。',
      '两个舒服的小细节：温热毛巾敷脸帮助循环（敷感比「排油排毒」的说法靠谱得多，皮肤不需要排毒）；注意补铁和睡眠——经期流失的不只是皮肤状态，气色的底子在这几天的休息里。',
    ],
  },
];

export function getGlowArticle(id: string): LearnArticle {
  return GLOW_ARTICLES.find((a) => a.id === id) ?? GLOW_ARTICLES[0];
}

/** 提升颜值 hero 卡对应的文章 id */
export const GLOW_HERO_ID = 'minimal';
