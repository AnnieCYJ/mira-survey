/**
 * emotionArticles —— 情绪调节 · 图文文章库（v18.82）
 *
 * 从 learnArticles 移入（v18.81）：4 篇简单可落地的情绪调节方法。
 * 展示位置：工具页「情绪调节」→ 情绪记录页底部「情绪调节的方法」版块。
 * 背书全部真实可查（Seligman / UCLA / UVA / 斯坦福 / Pennebaker），无编造引言。
 * 封面复用 assets/learn/ 插画（同一套水彩）。
 */
import type { LearnArticle } from './learnArticles';

export const EMOTION_ARTICLES: LearnArticle[] = [
  {
    id: 'threeGood',
    method: { why: '睡前把注意力从反复回放的压力切回当天真实发生的好事。', steps: ['写下三件小事。', '每件补一句“它为什么会发生”。', '连续记录一周，再回看哪类事情最能让你放松。'], observe: '观察睡前情绪、入睡和第二天精神状态的变化。' },
    eyebrow: '情绪调节',
    minutes: 3,
    title: '三件好事：被验证最多的幸福练习',
    cover: require('../assets/learn/learn_threegood.jpg'),
    date: '9 月 30 日',
    sources: [
      'Seligman M.E.P. et al., Am Psychol, 2005（三件好事练习对照实验）',
    ],
    paragraphs: [
      '积极心理学奠基人 Martin Seligman 在 2005 年发表过一项对照实验：每天睡前写下今天的三件好事，再各写一句「它为什么会发生」，连续一周。坚持做的人幸福感上升、抑郁得分下降，效果在六个月后仍能测到。',
      '它有效的原因不玄：好事天然会被大脑略过，坏事天然会被反复回放——这个练习是把注意力系统手动校准回来。',
      '落地只要三行字：睡前五分钟，三件小事，一句为什么。天气不错、午饭好吃、朋友回了消息，都算。写在本子上或手机备忘录都行，关键是连续。',
    ],
  },
  {
    id: 'talkFriend',
    eyebrow: '情绪调节',
    minutes: 4,
    title: '和朋友聊聊：倾诉是被研究过的方法',
    cover: require('../assets/learn/learn_talk.jpg'),
    date: '9 月 30 日',
    sources: [
      'Lieberman M.D. et al., Psychol Sci, 2007（情绪标注降低杏仁核反应，UCLA）',
      'Coan J.A. et al., Psychol Sci, 2006（陪伴减弱大脑威胁反应，UVA）',
    ],
    paragraphs: [
      '倾诉常被当成「软弱」，但研究给的结果正相反——它是有效的情绪调节工具。',
      '两个被广泛引用的发现：加州大学洛杉矶分校的脑成像研究显示，把情绪「说出来、叫出名字」的瞬间，大脑杏仁核（警报器）的反应就会下降——很多话在说出口的过程中，强度已经掉了一半。弗吉尼亚大学的另一组实验发现，有人陪同时大脑面对威胁的反应明显变小——身边有人，压力是真的会打折。',
      '落地三步：找一个让你放松的人；约 20 分钟，说事实也说感受（「这事让我挺委屈的」比「我没事」有用得多）；不追求当场解决，说完就算完成。',
      '一个小提醒：想倾诉的时候直接找那个人，别绕道发一条欲言又止的朋友圈。',
    ],
  },
  {
    id: 'sigh',
    method: { why: '情绪上行或生理唤醒偏高时，先用短呼吸把节奏降下来。', steps: ['两次短吸，接一次更长的呼气，做 3 轮。', '完成后记录当下情绪和身体紧绷程度。', '如果舒服，再把它放进固定的睡前或工作间隙。'], observe: '比较练习前后的情绪、心率和压力变化，找到最适合你的时间。' },
    eyebrow: '情绪调节',
    minutes: 3,
    title: '生理性叹息：最快的降温开关',
    cover: require('../assets/learn/learn_sigh.jpg'),
    date: '9 月 30 日',
    sources: [
      'Balban M.Y. et al., Cell Reports Medicine, 2023（循环叹息对照试验，斯坦福）',
    ],
    paragraphs: [
      '做法只有一句：两次短吸，再来一次长长的呼气。这是身体自己调节情绪的原生动作——大哭、疲惫、委屈之后的那串抽气，就是它的自动版。',
      '它有正经背书：斯坦福大学的团队 2023 年在《Cell Reports Medicine》发表对照研究，让一组人每天练 5 分钟循环叹息，结果改善情绪、让呼吸放缓的效果，优于同样时长的正念冥想。',
      '落地两种用法：情绪上头的当下，来三轮，几分钟内就能感到降温；想建立长期基线，每天固定 5 分钟。站着坐着都行，不需要任何设备。',
    ],
  },
  {
    id: 'expressiveWrite',
    eyebrow: '情绪调节',
    minutes: 3,
    title: '把烦心事写下来：最便宜的整理术',
    cover: require('../assets/learn/learn_write.jpg'),
    date: '9 月 30 日',
    sources: [
      'Pennebaker J.W. & Beall S.K., J Abnorm Psychol, 1986（表达性书写原始研究）',
      'Frattaroli J., Psychol Bull, 2006（146 项表达性书写研究的 meta 分析）',
    ],
    paragraphs: [
      '表达性书写是心理学里被复现次数最多的练习之一：连续四天、每天二十分钟，把最烦心的事不加修饰地写下来——写感受，不写流水账。',
      '提出这套方法的 Pennebaker 团队和后续几十项研究得到的结论比较一致：写的人睡眠改善、情绪症状下降，甚至免疫力指标都有变化。机制大概是：写下来会把脑子里打转的「情绪云」变成有结构的「事情」，大脑就不用一直后台挂着它。',
      '落地规则很宽：手机或纸都行，写完可以撕、可以删、不用给任何人看。卡住的时候就写「我现在感觉……」，写下去就会顺。',
    ],
  },
];

export function getEmotionArticle(id: string): LearnArticle {
  return EMOTION_ARTICLES.find((a) => a.id === id) ?? EMOTION_ARTICLES[0];
}
