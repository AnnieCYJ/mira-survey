/**
 * nutritionArticles —— 饮食营养 · 荷尔蒙×营养文章库（v18.85）
 *
 * 与 learnArticles 系列同构：插画封面 + 分类/时长标签 + 短段落正文。
 * 展示位置：饮食识别页（FoodScanScreen）底部版块。
 * 内容口径：真实可查的营养科学（进食顺序/铁/蛋白质/经前食欲/肠脑轴），
 * 平实、带原因、不做诊断承诺（Mira 铁律）。
 * 封面插画为 Mira 淡紫色系水彩（assets/nutrition/）。
 */
import type { LearnArticle } from './learnArticles';

export const NUTRITION_AUTHOR = 'Mira 编辑部';

export const NUTRITION_ARTICLES: LearnArticle[] = [
  {
    id: 'bloodsugar',
    eyebrow: '血糖与精力',
    minutes: 4,
    title: '血糖过山车：饭后犯困的真凶',
    cover: require('../assets/nutrition/nutri_sugar.jpg'),
    date: '9 月 30 日',
    sources: [
      'Shukla A.P. et al., Diabetes Care, 2015（进食顺序对餐后血糖的影响）',
      'DiPietro L. et al., Diabetes Care, 2013（饭后散步降低血糖峰值）',
    ],
    paragraphs: [
      '一顿以精制碳水为主的饭后，血糖快速冲高又快速回落——「过山车」的谷底就是那种下午三点的困倦、走神和莫名想吃甜的东西。这不是懒，是血糖动力学的直接结果。',
      '稳住它有个几乎没有成本的技巧：换个进食顺序。同样的饭菜，先吃蔬菜和蛋白质、把主食放在后面，餐后血糖峰值会明显更平缓——进食顺序研究近两年被多项对照试验验证，效果真实存在。',
      '再加两条：碳水别单独吃（搭配蛋白质或脂肪一起，消化曲线就缓了），饭后走十分钟（肌肉动起来会自己「吃糖」，血糖峰直接被削掉一截）。',
      '和激素的关联：血糖大起大落会连带胰岛素和皮质醇波动——它不只影响下午的精力，也在给整天的情绪和食欲添乱。',
    ],
  },
  {
    id: 'ironwomen',
    eyebrow: '女性营养',
    minutes: 4,
    title: '铁：女性最容易缺的一样',
    cover: require('../assets/nutrition/nutri_iron.jpg'),
    date: '9 月 30 日',
    sources: [
      'Pasricha S.R. et al., Lancet, 2021（女性铁缺乏诊治综述）',
      'Hallberg L. et al., Am J Clin Nutr, 1989（维生素 C 与铁吸收、单宁抑制吸收）',
    ],
    paragraphs: [
      '经期每次出血都在流失铁，这是女性缺铁风险远高于男性的直接原因——研究里育龄女性缺铁性贫血和「铁储备不足但还没贫血」的比例都不低。常年的疲劳、脸色发白、爬两层楼就喘，都可能是铁在报警。',
      '食补的两条规则：一是铁要「搭对朋友」——红肉、动物肝、深色蔬菜里的铁，配上维生素 C（柑橘、彩椒、番茄）吸收率明显提高；二是「避开小偷」——茶和咖啡里的单宁会明显抑制铁吸收，这两杯和正餐隔开一小时以上再喝。',
      '一个提醒：要不要补铁剂值得先验血再决定——铁过量同样伤身，血清铁蛋白查一次就有答案。食疗管日常，数据管决定。',
    ],
  },
  {
    id: 'proteinhormone',
    eyebrow: '蛋白质',
    minutes: 3,
    title: '蛋白质：激素的原料库',
    cover: require('../assets/nutrition/nutri_protein.jpg'),
    date: '9 月 30 日',
    sources: [
      'Paddon-Jones D. et al., Am J Clin Nutr, 2008（蛋白质的饱腹感与食物热效应）',
      'Mamerow M.M. et al., J Nutr, 2014（蛋白质均匀分布到三餐的吸收优势）',
    ],
    paragraphs: [
      '激素本身及其「施工队」都要靠蛋白质造：胰岛素是多肽，甲状腺激素的原料酪氨酸来自蛋白质，连运送激素的结合蛋白也是蛋白质。长期蛋白质吃不够，身体造这些「零件」的物料就是紧的。',
      '对减脂和运动的人它还有一层作用：同等热量下，蛋白质的饱腹感最强、食物热效应最高——同样的缺口，蛋白质吃够会更不饿，肌肉也保得住。',
      '实操一条就够：每餐都有手掌大小的一块蛋白质（蛋、鱼、瘦肉、豆制品都行），分散到三餐比一顿猛吃吸收效率更好。不需要算克数到小数点。',
    ],
  },
  {
    id: 'cravings',
    eyebrow: '食欲与周期',
    minutes: 4,
    title: '经前想吃甜的，不是你的错',
    cover: require('../assets/nutrition/nutri_craving.jpg'),
    date: '9 月 30 日',
    sources: [
      'Bisdee J.T. et al., Metabolism, 1989（黄体期静息代谢率升高 5%-11%）',
      'Dye L. & Blundell J.E., Hum Reprod, 1997（月经周期与食欲调控）',
    ],
    paragraphs: [
      '黄体期食欲上升是写进生理学的：孕激素上行推高体温和代谢率，身体对能量的需求真实增加了——多项研究观察到黄体期每日消耗和食欲都有可观的上行。经前想吃，是身体在报需求，不是意志力打折。',
      '硬压通常以报复性进食收场。更稳的两步：第一步「不饿肚子」——三餐蛋白质和主食吃够，经前的甜食渴望会在餐后明显变弱（饿着的时候渴望最凶）；第二步「聪明地满足」——想吃就正经吃一小份，配着餐后吃而不是深夜空腹吃，黑巧克力配一撮坚果，比一整袋饼干体面得多。',
      '如果这几天水肿和体重波动让你慌：那是孕激素的保水效应，月经来潮后几天内自然回落。体重秤在经前看到的是水，不是脂肪。',
    ],
  },
  {
    id: 'gutmood',
    eyebrow: '肠脑轴',
    minutes: 4,
    title: '肠道菌群：第二个情绪器官',
    cover: require('../assets/nutrition/nutri_gut.jpg'),
    date: '9 月 30 日',
    sources: [
      'Wastyk H.C. et al., Cell, 2021（发酵食品十周对照试验，斯坦福）',
      'Cryan J.F. et al., Physiol Rev, 2019（肠脑轴·微生物组综述）',
    ],
    paragraphs: [
      '人体约九成的血清素在肠道里，肠子和大脑之间有一条双向高速（迷走神经 + 激素 + 免疫信号），菌群代谢物能实实在在影响情绪与压力反应——「肠脑轴」这十年是神经科学的热门方向，证据还在积累，但方向已清晰。',
      '斯坦福团队 2021 年发表在《Cell》的对照试验给了个简单的抓手：连续十周每天吃发酵食品（酸奶、泡菜、康普茶这类）的组，菌群多样性上升、多项炎症标志物下降——多样性高与更好的代谢和免疫状态相关。',
      '落地版：每天一小份发酵食品 + 主食里换点全谷物/薯类（膳食纤维是菌群的主粮），比任何昂贵的益生菌补剂都基础。肠道养顺了，连皮肤的响应都会慢半拍变好——肠和脸也是通的。',
    ],
  },
];

export function getNutritionArticle(id: string): LearnArticle {
  return NUTRITION_ARTICLES.find((a) => a.id === id) ?? NUTRITION_ARTICLES[0];
}
