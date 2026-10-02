/**
 * lastViewDate —— 记住两个「记录页」（饮食 / 运动）最后查看的日期。
 *
 * 背景：DateAnchorPicker 选中的历史日期原本是页面内的 useState，切走再回来、
 * 或杀进程重开都会被重置成今天，用户选好的「看哪天」丢了。
 * 这里用 expo-file-system 存一个极小的 JSON（和拍照图同一个沙盒目录），
 * 按 key（'food' / 'sport'）记住各页最后停留的 YYYY-MM-DD。
 *
 * 读取是异步的：页面先用今天初始化，mount 后在 effect 里回填存储值，
 * 切日期时同步写入。失败静默降级（内存态不影响其它功能）。
 */
import * as FileSystem from 'expo-file-system';

const FILE = `${FileSystem.documentDirectory}lastViewDate.json`;
type Store = Record<string, string>;

let cache: Store | null = null;

async function readStore(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await FileSystem.readAsStringAsync(FILE);
    cache = JSON.parse(raw) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

/** 读取某页最后停留的日期 key（无记录返回 null） */
export async function loadLastViewDate(key: string): Promise<string | null> {
  const s = await readStore();
  return s[key] ?? null;
}

/** 写入某页最后停留的日期 key */
export async function saveLastViewDate(key: string, dateKey: string): Promise<void> {
  const s = await readStore();
  s[key] = dateKey;
  cache = s;
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(s));
  } catch {
    /* 静默：存储失败不阻塞主流程 */
  }
}
