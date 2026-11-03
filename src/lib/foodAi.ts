// 饮食识别核心库
// ─────────────────────────────────────────────────────────────
// 识别链路：拍照 → base64 → VLM（OpenAI 兼容 /chat/completions，多模态）
//   * FOOD_VLM 配置了 endpoint+apiKey+model 时走真识别（返回菜品+份量+热量）
//   * 未配置时走「内置菜品库快速选择」兜底（本地估算热量），见 FoodScanScreen
// 记录存储：expo-sqlite `food_logs` 表（与 AI memory/context 同一持久化栈）
// ─────────────────────────────────────────────────────────────

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';

export interface MealItem {
  name: string;
  /** 份量描述，如「1 碗」「150g」 */
  portion: string;
  /** 该项估算热量 kcal */
  kcal: number;
  /** 蛋白质克数（可选，VLM 未返回时兜底为 0） */
  protein?: number;
  /** 碳水化合物克数 */
  carbs?: number;
  /** 脂肪克数 */
  fat?: number;
  /** 模型估算的激素相关元素含量（毫克；叶酸 fa、硒 se 为微克 μg）。仅拍照识别返回，手动兜底时为 undefined。仅供参考，非化验值。 */
  elements?: Partial<Record<'mg' | 'zn' | 'fe' | 'ca' | 'b6' | 'fa' | 'se', number>>;
}

/** 宏量营养素聚合（克） */
export interface Macros {
  protein: number;
  carbs: number;
  fat: number;
}

/** 聚合一组菜品的宏量营养素（克） */
export function sumMacros(items: MealItem[]): Macros {
  return items.reduce<Macros>(
    (a, it) => ({
      protein: a.protein + (it.protein ?? 0),
      carbs: a.carbs + (it.carbs ?? 0),
      fat: a.fat + (it.fat ?? 0),
    }),
    { protein: 0, carbs: 0, fat: 0 }
  );
}

/** 宏量营养素折算热量（蛋白/碳水 4kcal/g，脂肪 9kcal/g） */
export function macroCals(m: Macros): { protein: number; carbs: number; fat: number; total: number } {
  const p = m.protein * 4;
  const c = m.carbs * 4;
  const f = m.fat * 9;
  return { protein: p, carbs: c, fat: f, total: p + c + f };
}

export interface FoodLog {
  id: string;
  /** YYYY-MM-DD */
  dateKey: string;
  ts: number;
  source: 'ai' | 'manual';
  items: MealItem[];
  totalKcal: number;
  /** 本地照片 uri（仅本次安装有效，可不存图只存数据） */
  photoUri?: string;
}

// ═══ 1. VLM 配置（填入即启用拍照识别；留空 = 走手动兜底）═══
// OpenAI 兼容多模态端点：POST {endpoint}/chat/completions
// model 需支持 image 输入（gpt-4o-mini / qwen-vl-plus / glm-4v-flash 等）
export const FOOD_VLM = {
  endpoint: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '6ddc2611586f4bc6872c827b7c83ed12.WW6v8SMnx99bf03t',
  model: 'glm-4v-flash',
};

/** 可识别的激素相关元素键（毫克；叶酸 fa、硒 se 为微克 μg） */
export const ELEMENT_KEYS = ['mg', 'zn', 'fe', 'ca', 'b6', 'fa', 'se'] as const;
type ElementField = Partial<Record<(typeof ELEMENT_KEYS)[number], number>>;

/** 把 VLM 返回的任意元素对象规整为合法数值字段（仅保留正数，四舍五入） */
function normalizeElements(raw?: Record<string, unknown>): ElementField | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const k of ELEMENT_KEYS) {
    const v = Number((raw as Record<string, unknown>)[k]);
    if (Number.isFinite(v) && v > 0) out[k] = Math.round(v);
  }
  return Object.keys(out).length ? (out as ElementField) : undefined;
}

const RECOGNIZE_PROMPT = `你是饮食记录助手。识别照片中的食物，返回 JSON（不要多余文字）：
{"items":[{"name":"菜品名","portion":"份量描述如1碗/150g","kcal":估算热量整数,"protein":蛋白质克数,"carbs":碳水克数,"fat":脂肪克数,"elements":{"mg":镁毫克,"zn":锌毫克,"fe":铁毫克,"ca":钙毫克,"b6":维生素B6毫克,"fa":叶酸微克,"se":硒微克}}]}
规则：每样食物单独一项；kcal 与宏量按常见做法估算；elements 为该菜品可食部常见含量的估算（毫克 mg，叶酸用微克 μg），识别不出某项就省略该键；最多 6 项；识别不出就返回 {"items":[]}。`;

/** 调 VLM 识别餐食照片；任何失败返回 null（调用方走兜底）。
 *  ★ 2026-11-03（用户：识别慢且老是失败）：
 *  ① max_tokens 500→1500 —— 8 道菜×7 元素字段的 JSON 会被 500 截断 → 解析失败 =「识别不出来」的主因；
 *  ② 20s AbortController 超时（之前无超时，spinner 可以挂很久）；
 *  ③ 失败/空结果自动重试 1 次（flash 模型偶发返回 items:[] 或截断，重试可救回一大半）；
 *  ④ 菜品上限 8→6，降低截断概率。 */
export async function recognizeMeal(base64Jpeg: string): Promise<MealItem[] | null> {
  if (!FOOD_VLM.endpoint || !FOOD_VLM.apiKey || !FOOD_VLM.model) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(`${FOOD_VLM.endpoint}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${FOOD_VLM.apiKey}`,
        },
        body: JSON.stringify({
          model: FOOD_VLM.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: RECOGNIZE_PROMPT },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } },
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.2,
        }),
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        console.warn('[FoodScan] VLM 请求失败:', res.status, (await res.text()).slice(0, 200));
        continue; // 重试
      }
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) { console.warn('[FoodScan] VLM 返回无 JSON（第', attempt, '次）:', text.slice(0, 100)); continue; }
      let parsed: { items?: Array<MealItem & { elements?: Record<string, number> }> };
      try {
        parsed = JSON.parse(m[0]) as { items?: Array<MealItem & { elements?: Record<string, number> }> };
      } catch {
        console.warn('[FoodScan] VLM JSON 截断/非法（第', attempt, '次）:', m[0].slice(-80));
        continue; // 截断 → 重试
      }
      const items = (parsed.items || [])
        .filter((it) => it && it.name && Number.isFinite(Number(it.kcal)))
        .slice(0, 6)
        .map((it) => ({
          name: String(it.name),
          portion: String(it.portion || '1 份'),
          kcal: Math.round(Number(it.kcal)),
          protein: Number.isFinite(Number(it.protein)) ? Math.round(Number(it.protein)) : 0,
          carbs: Number.isFinite(Number(it.carbs)) ? Math.round(Number(it.carbs)) : 0,
          fat: Number.isFinite(Number(it.fat)) ? Math.round(Number(it.fat)) : 0,
          elements: normalizeElements(it.elements),
        }));
      console.log('[FoodScan] VLM 识别成功:', items.length, '项 |', Date.now() - t0, 'ms');
      if (items.length) return items;
      // items:[] 空结果也重试一次
    } catch (e: unknown) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      console.warn('[FoodScan] VLM 请求异常（第', attempt, '次）:', aborted ? '超时 20s' : e);
    }
  }
  return null;
}

// ═══ 2. 内置常见菜品热量表（手动兜底/编辑用，单份常见摄入量 + 宏量营养素克数）═══
export const BUILT_IN_FOODS: { name: string; kcal: number; portion: string; emoji: string; protein: number; carbs: number; fat: number }[] = [
  { name: '米饭', kcal: 230, portion: '1 碗', emoji: '🍚', protein: 4, carbs: 50, fat: 0.5 },
  { name: '面条', kcal: 380, portion: '1 碗', emoji: '🍜', protein: 13, carbs: 72, fat: 2 },
  { name: '饺子', kcal: 420, portion: '10 个', emoji: '🥟', protein: 18, carbs: 55, fat: 14 },
  { name: '馒头', kcal: 220, portion: '1 个', emoji: '🥠', protein: 7, carbs: 45, fat: 1 },
  { name: '鸡蛋', kcal: 90, portion: '1 个', emoji: '🥚', protein: 8, carbs: 1, fat: 6 },
  { name: '番茄炒蛋', kcal: 260, portion: '1 份', emoji: '🍅', protein: 12, carbs: 10, fat: 18 },
  { name: '红烧肉', kcal: 520, portion: '1 份', emoji: '🍖', protein: 28, carbs: 12, fat: 42 },
  { name: '清蒸鱼', kcal: 240, portion: '1 份', emoji: '🐟', protein: 34, carbs: 0, fat: 11 },
  { name: '鸡胸肉', kcal: 180, portion: '100g', emoji: '🍗', protein: 31, carbs: 0, fat: 4 },
  { name: '炒青菜', kcal: 120, portion: '1 份', emoji: '🥬', protein: 3, carbs: 9, fat: 7 },
  { name: '西兰花', kcal: 55, portion: '100g', emoji: '🥦', protein: 4, carbs: 11, fat: 1 },
  { name: '豆腐', kcal: 150, portion: '1 份', emoji: '🧊', protein: 12, carbs: 4, fat: 9 },
  { name: '牛奶', kcal: 160, portion: '1 杯', emoji: '🥛', protein: 8, carbs: 12, fat: 8 },
  { name: '豆浆', kcal: 90, portion: '1 杯', emoji: '🥤', protein: 8, carbs: 4, fat: 4 },
  { name: '咖啡（无糖）', kcal: 5, portion: '1 杯', emoji: '☕', protein: 0, carbs: 1, fat: 0 },
  { name: '苹果', kcal: 95, portion: '1 个', emoji: '🍎', protein: 0, carbs: 25, fat: 0 },
  { name: '香蕉', kcal: 105, portion: '1 根', emoji: '🍌', protein: 1, carbs: 27, fat: 0 },
  { name: '酸奶', kcal: 120, portion: '1 杯', emoji: '🍶', protein: 5, carbs: 12, fat: 4 },
  { name: '坚果', kcal: 180, portion: '1 小把', emoji: '🥜', protein: 5, carbs: 6, fat: 16 },
  { name: '沙拉', kcal: 160, portion: '1 份', emoji: '🥗', protein: 4, carbs: 14, fat: 10 },
  { name: '三明治', kcal: 350, portion: '1 个', emoji: '🥪', protein: 16, carbs: 35, fat: 16 },
  { name: '汉堡', kcal: 550, portion: '1 个', emoji: '🍔', protein: 26, carbs: 45, fat: 28 },
  { name: '披萨', kcal: 480, portion: '2 块', emoji: '🍕', protein: 20, carbs: 55, fat: 18 },
  { name: '蛋糕', kcal: 320, portion: '1 块', emoji: '🍰', protein: 5, carbs: 45, fat: 14 },
];

/** 份量系数：小 0.7 / 标准 1 / 大 1.3 */
export const PORTION_FACTORS = [
  { label: '小份', factor: 0.7 },
  { label: '标准', factor: 1 },
  { label: '大份', factor: 1.3 },
];

// ═══ 3. 记录存储（expo-sqlite，items 存 JSON 文本）═══
let _db: SQLite.SQLiteDatabase | null = null;
function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('mira.db');
    _db.execSync(
      `CREATE TABLE IF NOT EXISTS food_logs (
        id TEXT PRIMARY KEY NOT NULL,
        date_key TEXT NOT NULL,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        items TEXT NOT NULL,
        total_kcal INTEGER NOT NULL
      )`
    );
    // 迁移：已有库缺 photo_uri 列时补上（列已存在会抛错，忽略即可）
    try {
      _db.execSync('ALTER TABLE food_logs ADD COLUMN photo_uri TEXT');
    } catch { /* 列已存在 */ }
  }
  return _db;
}

export function dateKeyOf(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * ★ 修「拍的照片过阵子就不显示」（2026-10-01 真机实锤）：
 *   以前入库的是 file:// **绝对路径**，里面带 App 数据容器的 UUID。
 *   iOS 重装/更新/容器迁移都会换 UUID（实测：16:26 存的 D2AD6D2C-…，16:31 后容器变成
 *   E3066767-…），绝对路径立刻失效 → 缩略图全挂。文件本身还在新容器的 Documents 里。
 *   所以：入库只存文件名，读取时一律按**当前** documentDirectory 重建路径。
 */
function resolvePhotoUri(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  // 入库只存文件名（容器 UUID 会变），读取时一律按当前 documentDirectory 重建完整路径
  if (uri.startsWith('food_')) return `${FileSystem.documentDirectory}${uri}`;
  if (uri.startsWith('file://')) {
    const name = uri.split('/').pop();
    if (name && name.startsWith('food_')) return `${FileSystem.documentDirectory}${name}`;
  }
  return uri;
}

function rowToLog(r: { id: string; date_key: string; ts: number; source: string; items: string; total_kcal: number; photo_uri?: string | null }): FoodLog {
  let items: MealItem[] = [];
  try { items = JSON.parse(r.items); } catch { /* 容错：坏行当空 */ }
  return { id: r.id, dateKey: r.date_key, ts: r.ts, source: r.source as FoodLog['source'], items, totalKcal: r.total_kcal, photoUri: resolvePhotoUri(r.photo_uri) };
}

export function loadFoodLogs(): FoodLog[] {
  try {
    const rows = db().getAllSync(
      'SELECT id, date_key, ts, source, items, total_kcal, photo_uri FROM food_logs ORDER BY ts DESC LIMIT 200',
      []
    ) as Array<{ id: string; date_key: string; ts: number; source: string; items: string; total_kcal: number; photo_uri?: string | null }>;
    return rows.map(rowToLog);
  } catch {
    return [];
  }
}

export function saveFoodLog(log: Omit<FoodLog, 'id' | 'ts'> & { id?: string; ts?: number }): FoodLog[] {
  try {
    const full: FoodLog = {
      ...log,
      id: log.id ?? `food-${Date.now()}`,
      ts: log.ts ?? Date.now(),
    };
    db().runSync(
      'INSERT OR REPLACE INTO food_logs (id, date_key, ts, source, items, total_kcal, photo_uri) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [full.id, full.dateKey, full.ts, full.source, JSON.stringify(full.items), Math.round(full.totalKcal), full.photoUri ?? null]
    );
    return loadFoodLogs();
  } catch {
    return loadFoodLogs();
  }
}

export function deleteFoodLog(id: string): FoodLog[] {
  try {
    db().runSync('DELETE FROM food_logs WHERE id = ?', [id]);
  } catch { /* 忽略 */ }
  return loadFoodLogs();
}

export function sumKcal(logs: FoodLog[], dateKey: string): number {
  return logs.filter((l) => l.dateKey === dateKey).reduce((s, l) => s + l.totalKcal, 0);
}
