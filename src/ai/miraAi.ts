// Mira AI 编排器（对应 mira-ios architecture-v4 的 8 步对话编排）
// 加载角色卡 → 注入话术锚点 → recall 记忆 → load 上下文 → 注入健康数据 → Qwen 生成 → 写回记忆/上下文
// 流式 token 回调给 UI。

import { getLlamaContext } from './model';
import { MemoryStore } from './memory';
import { ChatContextStore, type ChatContextSnapshot } from './context';
import { buildSystemPrompt } from './character';
import { buildHealthSnapshot } from './health';

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

/** 主入口：问 Mira 一句，流式返回 */
export async function ask(userText: string, opts: AskOptions = {}): Promise<string> {
  const ctx = await getLlamaContext();

  const recentText = [userText, ...(opts.history || []).map((m) => m.content)].join('\n');
  const system = buildSystemPrompt(recentText);

  const recalls = await memory.recall(userText, 3);
  const memBlock = recalls.length
    ? `【你记得关于用户的事（聊到过即可，不必每次提）】\n` + recalls.map((r) => `- ${r}`).join('\n')
    : '';

  const ctxSnap = await context.load();
  const ctxBlock = ctxSnap
    ? `【上次聊到的延续】\n情绪：${ctxSnap.moodLabel}；话题：${ctxSnap.recentThemes.join('、')}；笔记：${ctxSnap.summary}`
    : '';

  const health = buildHealthSnapshot();

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: system },
    ...(memBlock ? [{ role: 'system', content: memBlock }] : []),
    ...(ctxBlock ? [{ role: 'system', content: ctxBlock }] : []),
    ...(health ? [{ role: 'system', content: health }] : []),
    ...(opts.history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  let full = '';
  try {
    const res = await ctx.completion(
      {
        messages,
        n_predict: 220,
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
    );
    full = res?.text || full;
  } finally {
    // 无论如何都写回记忆 + 上下文（延续性）
    try {
      await memory.add(userText);
      const snap: ChatContextSnapshot = {
        moodLabel: inferMood(userText),
        recentThemes: inferThemes(userText),
        lastUserTopic: userText.slice(0, 40),
        healthNote: '',
        summary: (full || '').slice(0, 120),
        updatedAt: Date.now(),
      };
      await context.save(snap);
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
