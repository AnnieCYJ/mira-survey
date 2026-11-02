/**
 * patternStore —— 「人生上下文」库（Phase 2）
 *
 * ══ 这是什么 ══
 * 用户长期使用 Mira 之后，会积累出一些**只属于他自己的规律**：
 * 「我一到周一就睡不好」「晚睡 1 小时第二天心率变异性就掉」「周末能多睡 50 分钟」。
 * 这些规律一开始只是**观察**（机器算出来的候选），用户点一次「挺准」，
 * 它才升格成「人生上下文」——之后 Mira 说话时会引用它。
 *
 * ══ 无门禁软闭环（用户拍板）══
 * 观察 → **直接写进日历观察区**（不问、不弹窗、不要求确认）
 *      → 用户在首页/日历点「挺准」→ 记录用户认可（confirmCount++，不改变数据置信度）
 *      → 用户认可的条目进入「人生上下文」，被 AI 引用
 *      → 用户随时可以手动删（数据主权兜底），删了不再复活、不再被引用
 *
 * ══ 口径边界（Mira 铁律）══
 * · 只做**描述性观察**：不下诊断、不评分、不做认知反馈、不说"你应该"；
 * · 每条都必须带证据（样本量 n、相关系数 r / 组间差）与置信度；
 * · 样本不够就不出观察（宁可少说，不编）。
 *
 * 存储：expo-file-system + JSON（照抄 habitSuggestions.ts 的写法），只在本机，不外传。
 */
import * as FileSystem from 'expo-file-system';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_patterns.json';

export type PatternKind = 'correlation' | 'group_diff' | 'rhythm' | 'coverage';
export type PatternConfidence = 'high' | 'medium' | 'low' | 'context';
export type PatternSource = 'local' | 'cloud';

export interface PatternObservation {
  /** 稳定 id（云端/端侧用同一套 id，例如 'sleep_nextday_hrv'） */
  id: string;
  kind: PatternKind;
  title: string;
  text: string;
  /** 证据：样本量 n、相关系数 r（-1~1）、人话补充 */
  evidence: { n: number; r?: number; detail?: string };
  confidence: PatternConfidence;
  /** 0~1，机器算出的置信度 */
  confidenceScore: number;
  source: PatternSource;
  /** 观察窗口天数 */
  windowDays: number;
  /** 观察产生时间 */
  observedAt: number;
}

export interface PatternEntry extends PatternObservation {
  /** 数据置信度与用户反馈分离的存储版本；旧分数等待新观察刷新。 */
  evidenceVersion?: 2;
  latestFeedback?: 'accurate' | 'inaccurate';
  /** 当前认可次数；最近一次否定后归零，退出人生上下文。 */
  confirmCount: number;
  /** 用户手动删掉了 —— 保留墓碑，永不复活、永不被引用 */
  dismissed: boolean;
  firstAt: number;
  lastAt: number;
}

interface PatternFile {
  entries: PatternEntry[];
}

function emptyFile(): PatternFile {
  return { entries: [] };
}

function clamp01(x: unknown): number {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizeEntry(j: any): PatternEntry | null {
  if (!j || typeof j !== 'object') return null;
  if (typeof j.id !== 'string' || !j.id) return null;
  const conf: PatternConfidence =
    j.confidence === 'high' || j.confidence === 'medium' || j.confidence === 'low' || j.confidence === 'context'
      ? j.confidence
      : 'low';
  const kind: PatternKind =
    j.kind === 'correlation' || j.kind === 'group_diff' || j.kind === 'rhythm' || j.kind === 'coverage'
      ? j.kind
      : 'rhythm';
  const ev = j.evidence && typeof j.evidence === 'object' ? j.evidence : {};
  const n = Number(ev.n);
  const r = ev.r == null ? null : Number(ev.r);
  const now = Date.now();
  return {
    id: String(j.id),
    kind,
    title: String(j.title ?? ''),
    text: String(j.text ?? ''),
    evidence: {
      n: Number.isFinite(n) ? n : 0,
      ...(r != null && Number.isFinite(r) ? { r } : {}),
      ...(typeof ev.detail === 'string' ? { detail: ev.detail } : {}),
    },
    confidence: j.evidenceVersion === 2 ? conf : 'low',
    confidenceScore: j.evidenceVersion === 2 ? clamp01(j.confidenceScore) : 0,
    ...(j.evidenceVersion === 2 ? { evidenceVersion: 2 as const } : {}),
    source: j.source === 'cloud' ? 'cloud' : 'local',
    windowDays: Number(j.windowDays) || 30,
    observedAt: Number(j.observedAt) || now,
    ...(j.latestFeedback === 'accurate' || j.latestFeedback === 'inaccurate' ? { latestFeedback: j.latestFeedback } : {}),
    confirmCount: Math.max(0, Number(j.confirmCount) || 0),
    dismissed: j.dismissed === true,
    firstAt: Number(j.firstAt) || now,
    lastAt: Number(j.lastAt) || now,
  };
}

function normalize(j: any): PatternFile {
  const out = emptyFile();
  if (j && typeof j === 'object' && Array.isArray(j.entries)) {
    for (const e of j.entries) {
      const n = normalizeEntry(e);
      if (n) out.entries.push(n);
    }
  }
  return out;
}

let mem: PatternFile | null = null;
let loading: Promise<PatternFile> | null = null;
let writes: Promise<void> = Promise.resolve();

function readFile(): Promise<PatternFile> {
  if (mem) return Promise.resolve(mem);
  if (!loading) {
    loading = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(PATH);
        const file = info.exists
          ? normalize(JSON.parse(await FileSystem.readAsStringAsync(PATH)))
          : emptyFile();
        mem = file;
        return file;
      } catch {
        const file = emptyFile();
        mem = file;
        return file;
      }
    })().finally(() => { loading = null; });
  }
  return loading;
}

function updateFile<T>(change: (f: PatternFile) => T): Promise<T> {
  const update = writes.then(async () => {
    const previous = await readFile();
    const next: PatternFile = { entries: previous.entries.map((e) => ({ ...e })) };
    const result = change(next);
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(next));
    mem = next;
    return result;
  });
  writes = update.then(() => {}, () => {});
  return update;
}

/** 读全部条目（含用户删掉的墓碑） */
export async function loadPatternStore(): Promise<PatternEntry[]> {
  try { return (await readFile()).entries; } catch { return []; }
}

/** 同步快照（AI snapshot 用）：没读盘时返回空并顺带预热 */
export function peekPatterns(): PatternEntry[] {
  if (!mem) void readFile();
  return mem?.entries ?? [];
}

/**
 * 把新观察并进库里。
 * · 同 id 已存在 → 更新文案/证据/置信度，**保留** confirmCount 与 dismissed；
 * · dismissed（用户删过）→ 只更新底层数据但保持墓碑，不复活、不展示；
 * · 新观察 → 直接落库（无门禁：观察直接写进日历观察区）。
 */
export async function upsertObservations(obs: PatternObservation[]): Promise<PatternEntry[]> {
  if (!obs.length) return loadPatternStore();
  return updateFile((f) => {
    const now = Date.now();
    for (const o of obs) {
      const exist = f.entries.find((e) => e.id === o.id);
      if (exist) {
        exist.kind = o.kind;
        exist.title = o.title;
        exist.text = o.text;
        exist.evidence = o.evidence;
        exist.confidence = o.confidence;
        exist.confidenceScore = o.confidenceScore;
        exist.evidenceVersion = 2;
        exist.source = o.source;
        exist.windowDays = o.windowDays;
        exist.observedAt = o.observedAt;
        exist.lastAt = now;
      } else {
        f.entries.push({
          ...o,
          evidenceVersion: 2,
          confirmCount: 0,
          dismissed: false,
          firstAt: now,
          lastAt: now,
        });
      }
    }
    return f.entries;
  });
}

/** 用户认可只改变个性化引用资格，不提升机器证据置信度。 */
export async function confirmPattern(id: string): Promise<PatternEntry | null> {
  return feedbackPattern(id, 'accurate');
}

/**
 * 最近一次「不太像」立即停止该规律的个性化引用。
 * 保留原始观察和证据；只有用户重新认可后才再次进入个人上下文。
 */
export async function feedbackPattern(
  id: string,
  verdict: 'accurate' | 'inaccurate',
): Promise<PatternEntry | null> {
  return updateFile((f) => {
    const e = f.entries.find((x) => x.id === id);
    // 过期卡片的反馈不得复活已删除的规律，恢复须走 restorePattern。
    if (!e || e.dismissed) return null;
    e.confirmCount = verdict === 'accurate' ? e.confirmCount + 1 : 0;
    e.latestFeedback = verdict;
    e.lastAt = Date.now();
    return e;
  });
}

/** 用户手动删掉一条观察（数据主权）：留墓碑，不复活、不被引用 */
export async function dismissPattern(id: string): Promise<void> {
  await updateFile((f) => {
    const e = f.entries.find((x) => x.id === id);
    if (e) { e.dismissed = true; e.lastAt = Date.now(); }
  });
}

/** 撤销删除（误删） */
export async function restorePattern(id: string): Promise<void> {
  await updateFile((f) => {
    const e = f.entries.find((x) => x.id === id);
    if (e) { e.dismissed = false; e.lastAt = Date.now(); }
  });
}

/** 可见列表（用户删掉的过滤掉）：确认多的排前面，其次置信度高、观察新的 */
export async function listVisiblePatterns(): Promise<PatternEntry[]> {
  const all = await loadPatternStore();
  return all
    .filter((e) => !e.dismissed)
    .sort(
      (a, b) =>
        b.confirmCount - a.confirmCount ||
        b.confidenceScore - a.confidenceScore ||
        b.observedAt - a.observedAt,
    );
}

/**
 * 「人生上下文」= 用户点过「挺准」的条目（confirmCount ≥ 1）。
 * 只有被用户认过的规律才允许进 AI 语境 —— 这是"不编"的最后一道闸。
 */
export async function listLifeContext(): Promise<PatternEntry[]> {
  const all = await listVisiblePatterns();
  return all.filter((e) => e.confirmCount >= 1);
}

/** 同步版人生上下文（供 AI snapshot 直接拼字符串） */
export function peekLifeContext(): PatternEntry[] {
  return peekPatterns()
    .filter((e) => !e.dismissed && e.confirmCount >= 1)
    .sort((a, b) => b.confirmCount - a.confirmCount || b.confidenceScore - a.confidenceScore);
}

/** 待确认的观察（还没被用户点过「挺准」的） */
export function peekPendingObservations(): PatternEntry[] {
  return peekPatterns()
    .filter((e) => !e.dismissed && e.latestFeedback !== 'inaccurate' && e.confirmCount < 1 && e.kind !== 'coverage')
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}
