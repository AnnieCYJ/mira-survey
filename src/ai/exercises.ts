import type { PlutchikLabel } from '../lib/emotionEngine';

/**
 * 积极心理学 + CBT 轻量练习库
 * 
 * 所有练习来自已发表的干预研究（Emmons 2003, Seligman 2005, Pennebaker 1988, Beck 1976）
 * 不输出"治疗指导"，只输出"陪做"的步骤 + Mira 的 AI 引导话术
 * ———
 * 用法：
 *   import { pickExercise, recommendExercise, PROTOCOLS } from './ai/exercises';
 *   const ex = pickExercise('gratitude-journal');
 *   // ex.prompts[0] → "今晚写三件事...为什么..."
 *   // ex.systemPrompt → Mira 在这个模式下的语气规范
 */

export type ExerciseId =
  | 'gratitude-journal'
  | 'gratitude-letter'
  | 'expressive-writing'
  | 'cognitive-restructuring'
  | 'three-good-things'
  | 'breathing-478'
  | 'progressive-relaxation';

export interface ExerciseProtocol {
  id: ExerciseId;
  name: string;
  tag: string;
  durationMin: number;
  scienceRef: string;
  protocol: string[];
  aiPrompts: string[];
  systemPrompt: string;
  triggerWhen?: string;
  warning?: string;
}

const GRATITUDE_JOURNAL: ExerciseProtocol = {
  id: 'gratitude-journal', name: '感恩日记', tag: '🙏 感恩练习', durationMin: 5,
  scienceRef: 'Emmons & McCullough (2003) — 每周 3 次感恩日记, 10 周后 well-being 显著提升',
  triggerWhen: '低落/丧/没动力/复盘时',
  warning: '不要写"感恩我有手有脚"这种套话——要具体、要近期、要有人',
  protocol: [
    '今晚睡前，拿出 5 分钟',
    '写 3 件今天让你感到"还好"的事——必须具体（不是"感恩家人"，是"感恩妈妈发了个可爱表情包"）',
    '每件事后面补一句"为什么会发生"——"因为我昨天给她打了电话"',
    '写完不用再读，就放着',
  ],
  aiPrompts: ['来，咱俩一起写。先想一件今天哪怕很小的好事——不用伟大，只要让你嘴角有过一丝上扬的那种，比如：', '好，开始。先写第一件——要具体，别写"感恩家人"这种套话，要写"感恩今天同事帮我带了杯冰美式"。'],
  systemPrompt: '你在陪用户做 Emmons 感恩日记。引导她选具体小事 + 为什么发生。不要评判、不要夸张。语气轻柔、慢。',
};

const GRATITUDE_LETTER: ExerciseProtocol = {
  id: 'gratitude-letter', name: '感恩信', tag: '💌 给某人的信', durationMin: 10,
  scienceRef: 'Seligman et al. (2005) — 感恩拜访信, 对幸福指数的提升持续 1 个月',
  triggerWhen: '想修复关系/很久没联系一个重要的人',
  protocol: ['想一个很久没好好感谢过的人', '写一封 150-300 字的信：开头 + 一件具体的事 + 感谢', '可以不寄出——重要的是写的过程'],
  aiPrompts: ['来，想一个人——不用是闺蜜也不用是家人，任何一个让你曾经心里暖过一下的人。想起了吗？', '好，开头："亲爱的 X，去年 [场景]，你做了 [小事]，我记到现在"。'],
  systemPrompt: '你在陪用户写 Seligman 感恩信。引导她选具体的人 + 具体的事。不要让她写泛泛的感谢。',
};

const EXPRESSIVE_WRITING: ExerciseProtocol = {
  id: 'expressive-writing', name: '写出来', tag: '🖋️ 情绪释放', durationMin: 15,
  scienceRef: 'Pennebaker (1988, 2006) — 连续 4 天写 15 分钟"最深的情绪经历", 免疫功能改善 + 去医院次数↓',
  triggerWhen: '心里有事放不下/反复想一件事/睡不着/有情绪堵着',
  warning: '如果写的时候情绪太强烈（发抖/哭到喘不上），停下来做深呼吸，不用硬撑',
  protocol: ['先问自己：此刻脑子里最想冒出来的那件事是什么——不用想, 就写', '写 15 分钟不停笔，不管语法、不管通顺', '必须同时写事实（"他说XX"）和感受（"我像被浇了冷水"）', '写完不要立刻重读。1 天后再翻'],
  aiPrompts: ['来。先做 3 次深呼吸。好——现在把脑子里最先冒出来的那件事告诉我, 我陪你写。', '不用组织语言。你想骂人就骂人, 想哭就哭。越不加修饰越好。'],
  systemPrompt: '你在陪用户做 Pennebaker 表达性写作。不要纠正她的情绪。帮她同时写"事实 + 感受"。不评判、不分析、不给方案——就接住、就陪写。',
};

const COGNITIVE_RESTRUCTURING: ExerciseProtocol = {
  id: 'cognitive-restructuring', name: '认知重构', tag: '🔧 换个角度', durationMin: 10,
  scienceRef: 'Beck (1976) — CBT 核心: 自动想法 → 情绪 → 行为 的循环可被"检验想法"打破',
  triggerWhen: '陷在一个想法里反复转',
  warning: '不是"想开心的事"——是"想有没有别的角度看同一件事"',
  protocol: ['写下来那个反复转的念头（"我总是做不好"）', '检验它——有没有反例？"那次我做对了 XX，其实没那么糟"', '换个更灵活的说法——"这次没做好，但不代表下次也不行"'],
  aiPrompts: ['好，现在把那句在脑子里转来转去的话告诉我——完整说，不要润色。', '那有没有哪怕一件事，跟你这句话有点对不上的？比如……有没有哪次你其实做对了？'],
  systemPrompt: '你在陪用户做 Beck CBT 认知重构三列法。不要说"你想多了"——要说"我好奇有没有可能是另一种解读"。',
};

const THREE_GOOD_THINGS: ExerciseProtocol = {
  id: 'three-good-things', name: '三件好事', tag: '✨ 每天 2 分钟', durationMin: 2,
  scienceRef: 'Seligman (2005) — 每天睡前写 3 件好事, 6 个月后幸福指数显著提升',
  triggerWhen: '睡前/情绪一般/想快速拉一点好心情',
  protocol: ['睡前花 2 分钟，写 3 件好事——什么都算', '不用是大事："奶茶好喝""阳光照进来了""猫蹭了我一下"'],
  aiPrompts: ['来，2 分钟。第一件——今天有啥哪怕一秒让你嘴角动了一下的事？'],
  systemPrompt: '轻快、短、有活力。让她快速报 3 件小事。语气像朋友在问"今天有没有啥好东西吃了"。',
};

const BREATHING_478: ExerciseProtocol = {
  id: 'breathing-478', name: '4-7-8 呼吸', tag: '🌬️ 1 分钟减压', durationMin: 2,
  scienceRef: 'Weil (2015) — 4-7-8 呼吸激活 parasympathetic, 2 分钟可降低皮质醇 10-15%',
  triggerWhen: '焦虑上来了/要炸了/睡不着',
  protocol: ['4 秒吸气', '7 秒屏息', '8 秒呼气', '重复 4 次 = 约 1 分钟'],
  aiPrompts: ['来, 跟着我。4 秒吸气——好, 屏息 7——呼 8——再来一次。'],
  systemPrompt: '语速慢、声音稳、每一步之间真的等够秒数再引导下一句。不要急、不要啰嗦。',
};

const PROGRESSIVE_RELAXATION: ExerciseProtocol = {
  id: 'progressive-relaxation', name: '身体扫描', tag: '💆 从头到脚', durationMin: 5,
  scienceRef: 'Jacobsen (1924) — 现代心理治疗中最长寿的放松技术, 降低生理唤醒 15-25%',
  triggerWhen: '身体紧绷/累但睡不着/坐了一天',
  protocol: ['找个舒服的姿势坐下', '从脚趾开始：紧绷 5 秒 → 松 10 秒', '顺序: 脚趾→小腿→大腿→腹部→手→手臂→肩膀→脸→头顶', '肩膀多停一下——很多人的紧张都卡在这里'],
  aiPrompts: ['好, 先把手机放下, 找个舒服的姿势坐好。从脚趾开始——现在脚趾绷起来, 5, 4, 3, 2, 1, 松……让它沉下去。'],
  systemPrompt: '语速慢、每块肌肉之间留足够的停顿。格式："现在 [部位] 紧绷——5, 4, 3, 2, 1——松……让它沉下去"。',
};

export const PROTOCOLS: Record<ExerciseId, ExerciseProtocol> = {
  'gratitude-journal': GRATITUDE_JOURNAL,
  'gratitude-letter': GRATITUDE_LETTER,
  'expressive-writing': EXPRESSIVE_WRITING,
  'cognitive-restructuring': COGNITIVE_RESTRUCTURING,
  'three-good-things': THREE_GOOD_THINGS,
  'breathing-478': BREATHING_478,
  'progressive-relaxation': PROGRESSIVE_RELAXATION,
};

export function recommendExercise(mood: string | PlutchikLabel, domain?: string): ExerciseProtocol | null {
  const m = String(mood).toLowerCase();
  if (m.includes('sad') || m.includes('难') || m.includes('哭')) return GRATITUDE_JOURNAL;
  if (m.includes('angry') || m.includes('生气') || m.includes('焦虑')) return BREATHING_478;
  if (m.includes('fear') || m.includes('怕') || m.includes('担心')) return COGNITIVE_RESTRUCTURING;
  if (m.includes('stuck') || m.includes('卡') || m.includes('反复想')) return EXPRESSIVE_WRITING;
  if (m.includes('good') || m.includes('平') || m.includes('一般')) return THREE_GOOD_THINGS;
  if (domain === 'sleep') return PROGRESSIVE_RELAXATION;
  if (domain === 'stress') return BREATHING_478;
  return THREE_GOOD_THINGS;
}

export function pickExercise(id: ExerciseId): ExerciseProtocol {
  return PROTOCOLS[id];
}
