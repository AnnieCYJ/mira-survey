/**
 * ringIdentity —— 云端身份 + 设备令牌（Phase 1 端云骨架）
 *
 * ══ 为什么要这个 ══
 * 之前 App 调云端只有一个「全局 token」配置项：
 *   · 没配 = 后端开发态放行，谁都能写任何 device_id 的数据；
 *   · 配了 = 一把钥匙开所有用户的锁，泄了就全泄。
 * 现在改成**按设备隔离**：
 *   · 手机首次联网时向云端要一枚**本机令牌**（POST /v1/ring/device/token），
 *     云端只在签发那一刻返回一次明文，库里只留 sha256 哈希；
 *   · 之后这台手机的每次上传/读取都带自己的令牌；
 *   · 云端收到 device 角色的令牌，只认它自己那一个 device_id（读别人 → 收敛回自己，
 *     写别人 → 403）。
 *
 * ⚠ **令牌只存本机沙盒**（expo-file-system JSON），不上传任何第三方，
 *    不进日志、不进 URL 查询参数（只走 Authorization 头）。
 *
 * 存储写法照抄 habitSuggestions.ts（expo-file-system + JSON + 串行写队列），不引新依赖。
 */
import * as FileSystem from 'expo-file-system';
import { BACKEND_BASE_URL, RING_SYNC_TOKEN } from '../config';
import { getStoredDeviceInfo, getDeviceProfileId, getProfile } from '../config/deviceModel';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_ring_identity.json';

interface IdentityFile {
  /** 本机稳定 id（戒指未连上时用；连上后以戒指地址为准） */
  deviceId: string | null;
  /** 云端签发的设备令牌明文 */
  token: string | null;
  /** 这枚令牌是给哪个 device_id 签的（换戒指后要重新签，否则云端会 403） */
  tokenDeviceId: string | null;
  /** 签发时间（epoch ms） */
  tokenAt: number;
}

function emptyFile(): IdentityFile {
  return { deviceId: null, token: null, tokenDeviceId: null, tokenAt: 0 };
}

function normalize(j: any): IdentityFile {
  const out = emptyFile();
  if (j && typeof j === 'object') {
    if (typeof j.deviceId === 'string' && j.deviceId) out.deviceId = j.deviceId;
    if (typeof j.token === 'string' && j.token) out.token = j.token;
    if (typeof j.tokenDeviceId === 'string' && j.tokenDeviceId) out.tokenDeviceId = j.tokenDeviceId;
    const t = Number(j.tokenAt);
    if (Number.isFinite(t)) out.tokenAt = t;
  }
  return out;
}

let mem: IdentityFile | null = null;
let loading: Promise<IdentityFile> | null = null;
let writes: Promise<void> = Promise.resolve();
/** 签发令牌的并发闸（同 device_id 重复签发会轮换令牌，必须串行） */
let minting: Promise<string | null> | null = null;

function readIdentity(): Promise<IdentityFile> {
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

function updateIdentity<T>(change: (f: IdentityFile) => T): Promise<T> {
  const update = writes.then(async () => {
    const previous = await readIdentity();
    const next: IdentityFile = { ...previous };
    const result = change(next);
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(next));
    mem = next;
    return result;
  });
  writes = update.then(() => {}, () => {});
  return update;
}

/** 读整个身份文件（含令牌） */
export async function loadIdentity(): Promise<IdentityFile> {
  try { return await readIdentity(); } catch { return emptyFile(); }
}

/**
 * 本机稳定 id：没连上戒指时也要有一个（云端按它归档数据）。
 * 首次调用会生成一个 'local-xxxxxxxx' 并落盘。
 */
export async function getLocalDeviceId(): Promise<string> {
  const f = await readIdentity();
  // 优先使用最近成功认证的戒指标识，使问答查询与上传归档一致。
  if (f.tokenDeviceId) return f.tokenDeviceId;
  if (f.deviceId) return f.deviceId;
  const id = 'local-' + Math.random().toString(36).slice(2, 10);
  await updateIdentity((x) => { x.deviceId = id; });
  return id;
}

/** 当前设备令牌（没签发过则 null） */
export async function getDeviceToken(): Promise<string | null> {
  const f = await readIdentity();
  return f.token;
}

/** 同步快照：AI / 网络层用，不触发读盘 */
export function peekToken(): string | null {
  return mem?.token ?? null;
}

/**
 * 确保有可用令牌：没有就去云端签发一枚。
 * · 签发成功 → 落盘并返回；
 * · **换了 device_id（换戒指）→ 重新签发** —— 旧令牌在云端是绑在旧 device_id 上的，
 *   拿旧令牌写新设备会被 403 挡下来（这是隔离设计的正确表现，不是 bug）。
 * · 签发失败（离线 / 后端还没上迁移）→ 返回 null，调用方按「无令牌」降级
 *   （后端开发态放行，不会挡住上传）。
 */
export async function ensureDeviceToken(deviceId: string): Promise<string | null> {
  const f = await readIdentity();
  if (f.token && f.tokenDeviceId && f.tokenDeviceId === deviceId) return f.token;
  if (f.token && !f.tokenDeviceId && deviceId) {
    // 老版本存的文件没有 tokenDeviceId 字段：保守处理，重新签一枚（旧的自动失效）
  }
  if (!deviceId) return null;
  // ⚠ 并发保护：同一台设备重复签发会**轮换**令牌（旧令牌立刻失效），
  //   冷启动拉规律 + 上传同时触发时会互相把对方的令牌作废 → 这里串行化。
  if (minting) {
    await minting;
    // 上一个签发任务可能属于另一台戒指，不能返回它的令牌。
    return ensureDeviceToken(deviceId);
  }
  minting = (async () => {
    try {
      // ★ 2026-11-05（用户：按真机收敛）：上报型号以「连接时真机识别出的 Profile」为准，
      //   不再写死 'HK18'（基础版 LunaMira 本体无 ECG，不该被标成 HK18/全功能）。
      const { modelNumber } = await getStoredDeviceInfo();
      const profId = await getDeviceProfileId();
      const model = modelNumber || getProfile(profId).label;
      const res = await fetch(`${BACKEND_BASE_URL}/v1/ring/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, name: 'Mira Ring', model }),
      });
      if (!res.ok) return null;
      const j: any = await res.json().catch(() => ({}));
      const token = typeof j.token === 'string' ? j.token : null;
      if (!token) return null;
      await updateIdentity((x) => {
        x.token = token;
        x.tokenDeviceId = deviceId;
        x.tokenAt = Date.now();
      });
      return token;
    } catch {
      return null;
    } finally {
      minting = null;
    }
  })();
  return minting;
}

/** 主动作废本机令牌（换手机 / 注销）：同时通知云端删掉这枚令牌 */
export async function revokeDeviceToken(deviceId: string): Promise<void> {
  await updateIdentity((x) => { x.token = null; x.tokenDeviceId = null; x.tokenAt = 0; });
  try {
    await fetch(`${BACKEND_BASE_URL}/v1/ring/device/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });
  } catch {
    /* 云端删不掉不影响本机（下次签发会覆盖旧令牌） */
  }
}

/**
 * 请求头：带设备令牌（没令牌就不带）。
 * ⚠ config 里的 RING_SYNC_TOKEN（全局令牌）优先级更高 —— 那是运维/联调用，
 *    正常装机走设备令牌。
 */
export function authHeaders(token: string | null = peekToken()): Record<string, string> {
  if (RING_SYNC_TOKEN) return { Authorization: `Bearer ${RING_SYNC_TOKEN}` };
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 带鉴权的 fetch 包装（自动补 Authorization + 超时 + JSON 解析） */
export async function apiFetch(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; data: any }> {
  const timeoutMs = init?.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // 显式请求头属于已解析的设备，不混入之后切换设备的全局令牌。
        ...(init?.headers === undefined ? authHeaders() : {}),
        ...((init?.headers as Record<string, string>) || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: String(e?.message || e) } };
  } finally {
    clearTimeout(timer);
  }
}
