// 饮食识别核心库
// ─────────────────────────────────────────────────────────────
// 识别链路：拍照 → base64 → VLM（OpenAI 兼容 /chat/completions，多模态）
//   * FOOD_VLM 配置了 endpoint+apiKey+model 时走真识别（返回菜品+份量+热量）
//   * 未配置时走「内置菜品库快速选择」兜底（本地估算热量），见 FoodScanScreen
// 记录存储：expo-sqlite `food_logs` 表（与 AI memory/context 同一持久化栈）
// ─────────────────────────────────────────────────────────────

import * as SQLite from 'expo-sqlite';

export interface MealItem {
  name: string;
  /** 份量描述，如「1 碗」「150g」 */
  portion: string;
  /** 该项估算热量 kcal */
  kcal: number;
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

const RECOGNIZE_PROMPT = `你是饮食记录助手。识别照片中的食物，返回 JSON（不要多余文字）：
{"items":[{"name":"菜品名","portion":"份量描述如1碗/150g","kcal":估算热量整数}]}
规则：每样食物单独一项；kcal 按常见做法估算；最多 8 项；识别不出就返回 {"items":[]}。`;

/** 调 VLM 识别餐食照片；任何失败返回 null（调用方走兜底） */
export async function recognizeMeal(base64Jpeg: string): Promise<MealItem[] | null> {
  if (!FOOD_VLM.endpoint || !FOOD_VLM.apiKey || !FOOD_VLM.model) return null;
  try {
    const res = await fetch(`${FOOD_VLM.endpoint}/chat/completions`, {
      method: 'POST',
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
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      console.warn('[FoodScan] VLM 请求失败:', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { items?: MealItem[] };
    const items = (parsed.items || [])
      .filter((it) => it && it.name && Number.isFinite(Number(it.kcal)))
      .slice(0, 8)
      .map((it) => ({ name: String(it.name), portion: String(it.portion || '1 份'), kcal: Math.round(Number(it.kcal)) }));
    console.log('[FoodScan] VLM 识别成功:', items.length, '项 |', text.slice(0, 120));
    return items.length ? items : null;
  } catch {
    return null;
  }
}

// ═══ 2. 内置常见菜品热量表（手动兜底/编辑用，单份常见摄入量）═══
export const BUILT_IN_FOODS: { name: string; kcal: number; portion: string; emoji: string }[] = [
  { name: '米饭', kcal: 230, portion: '1 碗', emoji: '🍚' },
  { name: '面条', kcal: 380, portion: '1 碗', emoji: '🍜' },
  { name: '饺子', kcal: 420, portion: '10 个', emoji: '🥟' },
  { name: '馒头', kcal: 220, portion: '1 个', emoji: '🥠' },
  { name: '鸡蛋', kcal: 90, portion: '1 个', emoji: '🥚' },
  { name: '番茄炒蛋', kcal: 260, portion: '1 份', emoji: '🍅' },
  { name: '红烧肉', kcal: 520, portion: '1 份', emoji: '🍖' },
  { name: '清蒸鱼', kcal: 240, portion: '1 份', emoji: '🐟' },
  { name: '鸡胸肉', kcal: 180, portion: '100g', emoji: '🍗' },
  { name: '炒青菜', kcal: 120, portion: '1 份', emoji: '🥬' },
  { name: '西兰花', kcal: 55, portion: '100g', emoji: '🥦' },
  { name: '豆腐', kcal: 150, portion: '1 份', emoji: '🧊' },
  { name: '牛奶', kcal: 160, portion: '1 杯', emoji: '🥛' },
  { name: '豆浆', kcal: 90, portion: '1 杯', emoji: '🥤' },
  { name: '咖啡（无糖）', kcal: 5, portion: '1 杯', emoji: '☕' },
  { name: '苹果', kcal: 95, portion: '1 个', emoji: '🍎' },
  { name: '香蕉', kcal: 105, portion: '1 根', emoji: '🍌' },
  { name: '酸奶', kcal: 120, portion: '1 杯', emoji: '🍶' },
  { name: '坚果', kcal: 180, portion: '1 小把', emoji: '🥜' },
  { name: '沙拉', kcal: 160, portion: '1 份', emoji: '🥗' },
  { name: '三明治', kcal: 350, portion: '1 个', emoji: '🥪' },
  { name: '汉堡', kcal: 550, portion: '1 个', emoji: '🍔' },
  { name: '披萨', kcal: 480, portion: '2 块', emoji: '🍕' },
  { name: '蛋糕', kcal: 320, portion: '1 块', emoji: '🍰' },
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
  }
  return _db;
}

export function dateKeyOf(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rowToLog(r: { id: string; date_key: string; ts: number; source: string; items: string; total_kcal: number }): FoodLog {
  let items: MealItem[] = [];
  try { items = JSON.parse(r.items); } catch { /* 容错：坏行当空 */ }
  return { id: r.id, dateKey: r.date_key, ts: r.ts, source: r.source as FoodLog['source'], items, totalKcal: r.total_kcal };
}

export function loadFoodLogs(): FoodLog[] {
  try {
    const rows = db().getAllSync(
      'SELECT id, date_key, ts, source, items, total_kcal FROM food_logs ORDER BY ts DESC LIMIT 200',
      []
    ) as Array<{ id: string; date_key: string; ts: number; source: string; items: string; total_kcal: number }>;
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
      'INSERT OR REPLACE INTO food_logs (id, date_key, ts, source, items, total_kcal) VALUES (?, ?, ?, ?, ?, ?)',
      [full.id, full.dateKey, full.ts, full.source, JSON.stringify(full.items), Math.round(full.totalKcal)]
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
