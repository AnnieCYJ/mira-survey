/**
 * parseRows.ts —— 「AI 分点行」解析（**纯函数，零 RN / 零 IO 依赖 → 可离线单测**）
 *
 * 为什么单独成文件：端侧 1.5B 模型（Qwen2.5）**不保证**严格输出 `tone|标题|正文`。
 * 早期实现要求三段齐全、缺一段就整行丢弃，解析结果为空时 UI 会**静默回落规则兜底**，
 * 表现就是「无论怎么改提示词，页面上的 AI 分析都没变」。
 *
 * 现在的策略：按「越严格越优先」的四级降级，**只要模型说了人话就一定渲染成行**：
 *   ① tone|标题|正文（含全角 ｜丨┃│）
 *   ② tone|正文（缺标题 → 按关键词猜标题）
 *   ③ warn：正文 / neutral:标题:正文（冒号式）
 *   ④ 纯自然语言一行（无任何标记 → 关键词推断 tone + 标题，保留原文）
 */

export type AiTone = 'good' | 'warn' | 'neutral';

export interface AiInsightRow {
  tone: AiTone;
  title: string;
  body: string;
}

/** 行内分隔符：半角竖线 / 全角竖线 / 制表符 */
const PIPE = /\s*[|｜丨┃│\t]\s*/;

/** 显式语气 token → tone（对不上返回 null，交给关键词推断） */
function toneFromToken(tok: string): AiTone | null {
  const t = (tok || '').toLowerCase().replace(/[^a-z\u4e00-\u9fa5]/g, '');
  if (!t) return null;
  if (/^(good|positive|ok|好|良好|积极|正常)$/.test(t)) return 'good';
  if (/^(warn|warning|bad|negative|alert|注意|警告|异常|风险|需注意)$/.test(t)) return 'warn';
  if (/^(neutral|info|中性|一般|提示|普通)$/.test(t)) return 'neutral';
  return null;
}

/** 需注意信号（顺序优先于 good，避免「恢复正常」被误判为 warn） */
const WARN_RE =
  /紊乱|偏高|偏低|不足|异常|下降|降低|升高|偏少|偏短|偏晚|偏多|超标|注意|负债|不佳|偏差|压力大|疲劳|过度|恢复差|偏轻|偏低|不规律/;
const GOOD_RE = /正常|平稳|不错|良好|稳定|健康|充足|优秀|理想|很好|恢复不错|在正常范围/;

export function inferTone(line: string): AiTone {
  if (WARN_RE.test(line)) return 'warn';
  if (GOOD_RE.test(line)) return 'good';
  return 'neutral';
}

/** 标题推断：命中关键词就用标准指标名，保证同一指标在多处叫同一个名字 */
const TITLE_HINTS: [RegExp, string][] = [
  [/^[💡✨⚠️❗️]*\s*(建议|推荐|可以试试|不妨|记得|小建议)/, '今日建议'],
  [/皮质醇|节律/, '皮质醇节律'],
  [/HRV|心率变异/i, 'HRV'],
  [/静息心率|心率/, '心率'],
  [/睡眠|深睡|浅睡|REM|入睡|就寝|睡眠负债/i, '睡眠恢复'],
  [/体温|基础体温|BBT/i, '体温'],
  [/压力|情绪|应激|焦虑/, '情绪压力'],
  [/脑力|认知|专注|疲劳指数|恢复力/, '脑力负荷'],
  [/血氧|SpO2/i, '血氧'],
  [/建议|提前|咖啡因|自然光|睡前/, '今日建议'],
];

export function inferTitle(line: string): string {
  for (const [re, t] of TITLE_HINTS) if (re.test(line)) return t;
  return '综合分析';
}

/** 模型废话 / 复述格式 / 分隔线 → 直接丢弃 */
function isNoise(line: string): boolean {
  if (/^(tone|语气)?\s*\|?\s*标题\s*\|?\s*正文/.test(line)) return true;
  if (/^[-—–_=]{2,}$/.test(line)) return true;
  if (/^(好的|收到|以下是|以下为|分析如下|这是今天|根据你的数据|输出|示例)[，,：:]?$/.test(line)) return true;
  return false;
}

/** 超长单行（模型没分行）→ 取前两句，避免一行糊满整张卡 */
function clipSentences(line: string, max = 160): string {
  if (line.length <= max) return line;
  const sents = line.split('。').filter((s) => s.trim().length > 0);
  const two = sents.slice(0, 2).join('。');
  const out = two.length >= 12 ? `${two}。` : line.slice(0, max);
  return out;
}

export function parseInsightRows(text: string | null | undefined): AiInsightRow[] | null {
  if (!text) return null;
  const out: AiInsightRow[] = [];

  for (const raw of String(text).split(/\n+/)) {
    const line = raw
      .trim()
      .replace(/^[-–—•·*＋+\s]+/, '')
      .replace(/^\d+\s*[.、)）]\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
    if (!line || line.length < 4 || isNoise(line)) continue;

    // ① tone|标题|正文
    const parts = line.split(PIPE).filter((p) => p.trim().length > 0);
    if (parts.length >= 3) {
      const tone = toneFromToken(parts[0]) ?? inferTone(line);
      // ★ 2026-11-03：14 → 18 —— 标题升级为「一句人话结论」（如「昨晚睡得太晚，白天有点虚」），14 字不够用
      const title = parts[1].trim().slice(0, 18);
      const body = parts.slice(2).join(' ').trim();
      if (title && body) out.push({ tone, title, body });
      continue;
    }

    // ② tone|正文
    if (parts.length === 2) {
      const tone = toneFromToken(parts[0]);
      if (tone) {
        const body = parts[1].trim();
        if (body.length >= 4) out.push({ tone, title: inferTitle(body), body });
        continue;
      }
    }

    // ③ 冒号式：warn：正文  /  warn：标题：正文
    const m = line.match(/^(good|warn|warning|neutral|好|注意|中性|正常|异常)\s*[:：]\s*(.+)$/i);
    if (m) {
      const tone = toneFromToken(m[1]) ?? inferTone(m[2]);
      const rest = m[2].trim();
      const mm = rest.match(/^(.{2,18}?)\s*[:：]\s*(.+)$/);
      if (mm) out.push({ tone, title: mm[1].trim(), body: mm[2].trim() });
      else out.push({ tone, title: inferTitle(rest), body: rest });
      continue;
    }

    // ④ 无标记自然语言：推断 tone/标题，保留原文（宁可粗，也不要整段丢掉回落兜底）
    if (line.length >= 8) out.push({ tone: inferTone(line), title: inferTitle(line), body: clipSentences(line) });
  }

  return out.length ? out.slice(0, 6) : null;
}

export default parseInsightRows;
