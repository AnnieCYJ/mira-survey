/**
 * 每枚戒指的「身份名片」：按 MAC 记住上次连接时读到的固件版本、电量、连接时间。
 *
 * 背景（2026-11-13 真机验收）：Veepoo SDK 只在连接后的 confirmDevicePwd → PwdData
 * 回调里给 deviceVersion，扫描阶段拿不到固件。用户有两枚同名 Lunamira，
 * 选戒指时只看到「MAC …9B:1C」这种尾号，分不清哪枚是哪枚。
 * 所以把每次连接读到的固件/电量按 MAC 落盘，扫描列表直接展示，
 * 让用户在**点选之前**就能区分设备；没连过的显示「固件待读取」。
 *
 * 与数据分桶（mira_ring_state_v1_<MAC>.json）一样放在 App 私有目录，覆盖安装不丢。
 */
import * as FileSystem from 'expo-file-system';

export interface RingDeviceCardInfo {
  name: string;
  firmware: string | null;
  battery: number | null;
  lastConnectedAt: number | null;
}

const FILE_NAME = 'mira_ring_device_cards_v1.json';

/** 内存副本：扫描列表渲染时同步读，避免每次 render 都走一次异步文件 IO。 */
let cards: Record<string, RingDeviceCardInfo> = {};

const emptyCard = (): RingDeviceCardInfo => ({
  name: 'Luna Mira',
  firmware: null,
  battery: null,
  lastConnectedAt: null,
});

function filePath(): string | null {
  return FileSystem.documentDirectory ? FileSystem.documentDirectory + FILE_NAME : null;
}

function normMac(mac: string | null | undefined): string {
  return String(mac ?? '').trim().toUpperCase();
}

/** App 启动时恢复名片，失败/损坏按「无记录」处理，不影响连接。 */
export async function loadRingDeviceCards(): Promise<void> {
  const p = filePath();
  if (!p) return;
  try {
    const info = await FileSystem.getInfoAsync(p);
    if (!info.exists) return;
    const obj = JSON.parse(await FileSystem.readAsStringAsync(p));
    const saved = obj?.cards;
    if (!saved || typeof saved !== 'object') return;
    Object.keys(saved).forEach((k) => {
      const v = saved[k];
      if (!v || typeof v !== 'object') return;
      const key = normMac(k);
      if (!key) return;
      cards[key] = {
        name: typeof v.name === 'string' ? v.name : 'Luna Mira',
        firmware: typeof v.firmware === 'string' && v.firmware ? v.firmware : null,
        battery: typeof v.battery === 'number' && Number.isFinite(v.battery) ? v.battery : null,
        lastConnectedAt: typeof v.lastConnectedAt === 'number' ? v.lastConnectedAt : null,
      };
    });
  } catch {
    // 存档损坏按无记录处理
  }
}

/** 同步读：给扫描列表补充展示字段。 */
export function ringDeviceCardOf(mac: string | null | undefined): RingDeviceCardInfo | null {
  const key = normMac(mac);
  return key ? (cards[key] ?? null) : null;
}

/** 连接后调用：写入/更新这枚戒指的名片（只更新传入字段，其余保留）。 */
export async function rememberRingDeviceCard(
  mac: string | null | undefined,
  patch: Partial<RingDeviceCardInfo>,
): Promise<void> {
  const key = normMac(mac);
  if (!key) return;
  const prev = cards[key] ?? emptyCard();
  const next: RingDeviceCardInfo = {
    name: patch.name ?? prev.name,
    firmware: patch.firmware ?? prev.firmware,
    battery: patch.battery ?? prev.battery,
    lastConnectedAt: patch.lastConnectedAt ?? prev.lastConnectedAt ?? Date.now(),
  };
  cards = { ...cards, [key]: next };
  const p = filePath();
  if (!p) return;
  try {
    await FileSystem.writeAsStringAsync(p, JSON.stringify({ cards, at: Date.now() }));
  } catch {
    // 写盘失败不影响内存副本，本次会话仍可展示
  }
}

/** 「上次连接」的短日期，避免依赖 Hermes 的 toLocaleDateString 实现差异。 */
export function shortRingLastSeen(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
