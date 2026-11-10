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
  // ★ 2026-11-08：端侧 1.5B 偶尔把行标签当可见文本打印（【状态解读】/【此刻行动】/第一段/第一句/分析：），
  //   这些纯标签行无正文内容 → 丢弃，避免变成垃圾行（title=综合分析、body=标签）渲染到首页。
  if (/^【[^】]{1,14}】$/.test(line)) return true;
  if (/^(第[一二三四1-4][句段行]?|分析|建议|状态解读|此刻行动|行动建议|今日建议|综合分析)[:：]?$/.test(line)) return true;
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
      .replace(/^(?:前一句|后一句)\s*[:：、,，]?\s*/i, '')
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

// ── 首页「今日状态」两行的最后一道闸门 ──────────────────────────────────────
/**
 * ★ 2026-11-09（P30 真机截图实锤）：端侧 1.5B 偶尔把 **提示词原文** 和 **数据字段名**
 *   当成正文打印出来，首页出现：
 *     · 分析区：「【第一句】分析讲今天白天的整体状态和久坐/活动提醒」
 *     · 建议胶囊：「心率与HRV：全天实测均值 76.8，基本持平，说明整体放松且精力充沛 >」
 *   `parseInsightRows` 只丢弃「纯标签行」，这类「标签 + 指令残句 / 字段名：值」会漏网。
 *   这里做确定性清洗：能修成正常句子就修，修不了返回 null → 调用方回落本地规则文案，
 *   **保证首页永远不会显示提示词、字段名、冒号栏目标题或箭头残留**。
 *
 * 纯函数：零 RN / 零 IO，可直接离线单测。
 */

/** 提示词/格式指令泄漏：这些字只可能来自 prompt，不可能出现在正常正文里 → 整行作废 */
const PROMPT_LEAK_RE =
  /分析讲|分析重点|第一句用|第二句给|只输出|只写两|不要写|不要输出|不要出现|不要以提问|句尾不带|建议方向|时段视角|严格格式|挑\s*1|用\s*1\s*[–-]\s*2|解释今天为什么|按格式|栏目标题|语气标记|用户只看到|完整自然的句子|不要把重点|自然过渡到|落点放在|只给这|不要展开|不要复述|输出要求|格式说明|提示词|第一句\s*[:：]|第二句\s*[:：]/;

/** 行首结构标签 / 序号（【】、第X句、line 1、前一句/后一句 自带边界，可不带冒号）→ 剥掉 */
const STRUCT_LABEL_RE =
  /^(?:【[^】]{1,20}】|\[[^\]]{1,20}\]|前一句|后一句|第[一二三四1-4][句段行]?|行\s*[12]|line\s*[12])\s*[:：、,，\s-]*/i;

/** 行首栏目词（结论 / 分析 / 建议…）**必须带冒号或顿号**才剥，避免误伤「分析下来今天状态不错」这类正常句子 */
const WORD_LABEL_RE = /^(?:结论|分析|解读|状态解读|此刻行动|行动建议|今日建议|建议|综合分析|正文|标题)\s*[:：、,，]\s*/i;

/** 行首数据字段名（**必须带冒号**，避免误剥「睡眠 8 小时」这类正常句子）→ 剥掉 */
const FIELD_LABEL_RE =
  /^(?:心率与\s*HRV|心率|HRV|静息心率|睡眠|身心压力|压力|情绪|活动|步数|血氧|SpO2|体温|今日状态|全天实测|数据|均值)\s*[:：]\s*/i;

/** 建议句里混进了分析句（字段化措辞）→ 作废，避免「均值 76.8…」出现在行动胶囊里 */
const ANALYSIS_WORD_RE = /均值|实测|基本持平|说明整体|评分|得分|分值|\/100|数据显示|全天(?:实测|均值|状态)|环比|占比/;

/** 行尾残留的箭头 / Markdown / 孤立标点 */
function stripTail(s: string): string {
  return s
    .replace(/[\s>›»→‹<`*•·\-–—]+$/g, '')
    .replace(/[。：:；;，,、\s]+$/g, '')
    .trim();
}

/**
 * ★ 2026-11-10（用户）：模型偶尔把提示词里的指令当可见文本吐出来
 *   （「给一条此刻最值得做的小行动：去呼吸放松」）。这些只是 prompt 指令、不是正文，
 *   且结尾常带冒号 —— 剥掉前缀，只留后面的真实建议句；若整句只剩指令则归零由调用方回落本地。
 */
const PROMPT_CMD_PREFIX_RE =
  /^(?:给\s*[0-9一二三四两]+\s*条[^\s：:，,]{0,16}|此刻最值得做的小行动|最值得做的小行动|此刻最值得做|给一个此刻)\s*[:：、,，]?\s*/;

export function sanitizeOverviewLine(
  raw: string | null | undefined,
  kind: 'analysis' | 'action' = 'analysis'
): string | null {
  if (!raw) return null;
  let s = String(raw)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*|`/g, '')
    .replace(/^[-–—•·*＋+\s>›»]+/, '')
    .replace(/^\d+\s*[.、)）]\s*/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!s || s.includes('|')) return null;
  if (PROMPT_LEAK_RE.test(s)) return null;

  // 结构标签最多剥两层（模型偶发「【第一句】分析：xxx」叠标签），再剥栏目词与字段名前缀
  s = s
    .replace(STRUCT_LABEL_RE, '')
    .replace(STRUCT_LABEL_RE, '')
    .replace(WORD_LABEL_RE, '')
    .replace(FIELD_LABEL_RE, '')
    .replace(PROMPT_CMD_PREFIX_RE, '')
    .trim();
  s = stripTail(s);
  if (!s || PROMPT_LEAK_RE.test(s)) return null;
  if (kind === 'action' && ANALYSIS_WORD_RE.test(s)) return null;
  if (!/[\u4e00-\u9fa5]/.test(s)) return null; // 纯数字 / 纯符号

  const min = kind === 'action' ? 6 : 12;
  const max = kind === 'action' ? 60 : 120;
  if (s.length < min || s.length > max) return null;
  return s;
}

export default parseInsightRows;
