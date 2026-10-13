// Mira AI 编排器（对应 mira-ios architecture-v4 的 8 步对话编排）
// 加载角色卡 → 注入话术锚点 → recall 记忆 → load 上下文 → 注入健康数据 → Qwen 生成 → 写回记忆/上下文
// 流式 token 回调给 UI。

import { runOnModel } from './model';
import { MemoryStore } from './memory';
import { ChatContextStore, type ChatContextSnapshot } from './context';
import { CHARACTER, buildCompanionInjection } from './character';
import { buildHealthSnapshot } from './health';
import { emitAiRecord } from '../lib/aiRecordBus';

const memory = new MemoryStore();
const context = new ChatContextStore();

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskOptions {
  history?: ChatHistoryItem[];
  onToken?: (tok: string) => void;
  onDone?: (full: string) => void;
  onError?: (e: Error) => void;
}

/** ★ 2026-10-12（用户深夜被问「早上好」）：模型没有时间感知，全靠训练先验猜问候，
 *  必须在 prompt 里注入真实当前时间。问候/提到早晚一律以本块为准。 */
export function buildTimeBlock(now: Date = new Date()): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const hh = now.getHours();
  const mm = now.getMinutes();
  const hhmm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const period =
    hh < 5 ? '凌晨' : hh < 8 ? '早上' : hh < 12 ? '上午' : hh < 13 ? '中午'
    : hh < 18 ? '下午' : hh < 23 ? '晚上' : '深夜';
  return `【当前时间】\n现在是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${weekdays[now.getDay()]} ${hhmm}（${period}）。`;
}

/** 主入口：问 Mira 一句，流式返回 */
export async function ask(userText: string, opts: AskOptions = {}): Promise<string> {
  const recentText = [userText, ...(opts.history || []).map((m) => m.content)].join('\n');
  // ★ 人设与知识锚点分开发：
  //   lightSystem 只装人设（压缩控首字延迟）；世界书按关键词命中单独成一条 system。
  //   旧实现把 companion 拼进 system 后一起 slice(0,400)，世界书知识从来没真正送到过模型。
  // 不截断统一协议：后半段包含“先接住感受、再看健康数据、不要编造或诊断”等硬规则。
  // 世界书仍按关键词单独注入，避免把专业边界截掉后只剩人设语气。
  const lightSystem = CHARACTER.system_prompt;
  const companion = buildCompanionInjection(recentText);

  const recalls = await memory.recall(userText, 2);
  const memBlock = recalls.length
    ? `【你记得关于用户的事（聊到过即可，不必每次提）】\n` + recalls.map((r) => `- ${r}`).join('\n')
    : '';

  const ctxSnap = await context.load();
  const ctxBlock = ctxSnap
    ? `【上次聊到的延续】\n情绪：${ctxSnap.moodLabel}；话题：${ctxSnap.recentThemes.join('、')}；笔记：${ctxSnap.summary}`
    : '';

  // 健康快照只在用户问了相关问题时才**计算并**注入：
  // buildHealthSnapshot 要同步跑皮质醇 30 天 / 激素 60 天 / 压力 / 准备度等重计算（全在 JS 线程阻塞），
  // 且占 ~800 token prefill。闲聊 / 情绪 / 一般建议问题根本用不到它，
  // 此前无条件先计算再丢弃 = 每次对话白卡几秒 + 多吃 prefill。按需计算后这部分问题首字延迟大幅下降。
  const healthKeywords = ['睡眠', '心率', '压力', '周期', '经期', '激素', '皮质醇', '体温', '血氧', 'HRV', '能量', '疲劳', '指标', '数据', '健康'];
  const needsHealth = healthKeywords.some(k => userText.includes(k));
  const health = needsHealth ? buildHealthSnapshot() : '';

  const messages: { role: string; content: string }[] = [
    // ★ 时间放最前面：问候/早晚判断的唯一事实来源（2026-10-12 修「早上好」bug）
    { role: 'system', content: buildTimeBlock() },
    { role: 'system', content: lightSystem },
    ...(companion ? [{ role: 'system', content: companion }] : []),
    ...(memBlock ? [{ role: 'system', content: memBlock }] : []),
    ...(ctxBlock ? [{ role: 'system', content: ctxBlock }] : []),
    ...(needsHealth && health ? [{ role: 'system', content: health }] : []),
    ...(opts.history || []).slice(-3).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  let full = '';
  try {
    // ★ 走全局推理队列：与「AI 分析」共用同一条串行链。
    //   端侧 ctx 单例，两者并发会抛 "Context is busy" 且被静默降级（聊天表现为答非所问/无内容）。
    const res = await runOnModel((ctx) =>
      ctx.completion(
        {
          messages,
          n_predict: 150,
          temperature: 0.8,
          top_p: 0.9,
          stop: ['<|im_end|>', 'User:', '用户：', '用户:'],
        },
        (data) => {
          const tok = (data && data.token) || '';
          if (tok) {
            full += tok;
            opts.onToken?.(tok);
          }
        }
      )
    );
    full = res?.text || full;
  } finally {
    // 无论如何都写回记忆 + 上下文（延续性）
    try {
      await memory.add(userText);
      // ★ 广播：首页「今日日历」订阅此事件，对话产生关键信息后时间轴即时刷新
      emitAiRecord();
      // 只有真的生成出内容才更新「上次聊到的延续」：
      // 否则推理失败会把空的 summary 写进去、抹掉上一轮的上下文。
      if (full) {
        const snap: ChatContextSnapshot = {
          moodLabel: inferMood(userText),
          recentThemes: inferThemes(userText),
          lastUserTopic: userText.slice(0, 40),
          healthNote: '',
          summary: full.slice(0, 120),
          updatedAt: Date.now(),
        };
        await context.save(snap);
      }
    } catch (e) {
      console.warn('[MiraAI] 写回记忆/上下文失败:', e);
    }
  }

  opts.onDone?.(full);
  return full;
}

// —— 轻量情绪/主题推断（替代原 PersonaEngine 关键词法，仅用于 chat_context 连续性，不进入人格系统）——
const MOOD_MAP: { words: string[]; label: string }[] = [
  { words: ['崩溃', '焦虑', '失眠', '害怕', '紧张', '喘不过气'], label: '焦虑' },
  { words: ['难受', '难过', '委屈', '低落', '郁闷', '丧', '不开心', '烦'], label: '低落' },
  { words: ['开心', '高兴', '太好了', '喜欢', '爱', '不错', '好呀'], label: '愉悦' },
  { words: ['累', '疲惫', '没劲', '困'], label: '疲惫' },
];

export function inferMood(text: string): string {
  for (const m of MOOD_MAP) {
    if (m.words.some((w) => text.includes(w))) return m.label;
  }
  return '平静';
}

const THEME_KEYS: { words: string[]; label: string }[] = [
  { words: ['睡眠', '失眠', '睡不着', '熬夜'], label: '睡眠' },
  { words: ['压力', '焦虑', '紧张', '崩'], label: '压力' },
  { words: ['周期', '经期', '排卵', '月经', '来事儿'], label: '周期' },
  { words: ['运动', '训练', '锻炼', '拉伸'], label: '运动' },
  { words: ['喝水', '饮食', '吃'], label: '饮食' },
  { words: ['孤独', '社交', '朋友'], label: '社交' },
];

export function inferThemes(text: string): string[] {
  const out: string[] = [];
  for (const t of THEME_KEYS) {
    if (t.words.some((w) => text.includes(w))) out.push(t.label);
  }
  return out;
}
