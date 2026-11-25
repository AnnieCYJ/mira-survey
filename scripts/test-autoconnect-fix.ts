/**
 * BUG-20261116-02 · 冷启动「戴上戒指却连不上」自动连接兜底 · 离线回归
 *
 * 场景：首次安装 / 清数据 / 换机用户没有 mira_active_ring_v1.json，
 * activeDeviceKey 被兜底成过时 MAC 41:42:E7:17:9B:1C（本轮不广播、本机从没扫到过）。
 * 旧逻辑 decideAfterScan 的 hitLast 落空 → 无脑「全部列出等用户选」→ 戴着戒指也连不上。
 *
 * 修复：pickAutoConnectRingId 在「幽灵 lastId + 在播设备唯一 BASE 款」时返回其 MAC 自动直连；
 * 护栏：lastId 本机真正见过（seen / knownIds）时返回 null，绝不误切另一枚戒指。
 *
 * 运行：npx tsx scripts/test-autoconnect-fix.ts
 */
import assert from 'node:assert';

// 复刻 pickAutoConnectRingId 的纯逻辑（与 RingBleManager.ts 保持逐行一致）。
// guessModelFromName 的 BASE 判定规则来自 deviceModel.ts:681-688：
//   'luna mira'/'lunamira' 且不含 pro/hk18 → BASE_UI；含 pro/hk18 → PRO_UI。
type Dev = { id: string; name: string };
const norm = (x: unknown) => String(x ?? '').trim().toUpperCase();

function guessModelFromName(deviceName: string | null | undefined): 'PRO_UI' | 'BASE_UI' | null {
  const n = String(deviceName ?? '').trim().toLowerCase();
  if (!n) return null;
  const hasLunaMira = n.includes('luna mira') || n.includes('lunamira');
  if (hasLunaMira && (n.includes('pro') || n.includes('hk18'))) return 'PRO_UI';
  if (hasLunaMira) return 'BASE_UI';
  if (n.includes('hk18')) return 'PRO_UI';
  return null;
}

// resolveBroadcastName 在扫描帧里拿到的是实时广播名（source='live'），等价于直接用 d.name。
function pickAutoConnectRingId(params: {
  lastId: string | null | undefined;
  seenIds: Array<string> | Set<string>;
  knownIds: Array<string>;
  devices: Dev[];
}): string | null {
  const last = norm(params.lastId);
  const seen = new Set((Array.isArray(params.seenIds) ? params.seenIds : [...params.seenIds]).map(norm));
  const known = params.knownIds.map(norm);
  if (last && (seen.has(last) || known.includes(last))) return null;
  const baseOnly = (params.devices ?? []).filter((d) => guessModelFromName(d.name) === 'BASE_UI');
  if (baseOnly.length !== 1) return null;
  return norm(baseOnly[0].id) || null;
}

const BASE = { id: '41:42:14:AE:49:C9', name: 'Luna Mira' };   // 用户戴的精简版（广播 Lunamira）
const PRO = { id: 'F0:77:5D:ED:A8:5B', name: 'Lunamira Pro' }; // 另一枚 Pro
const STALE = '41:42:E7:17:9B:1C';                              // 过时兜底 MAC
let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('  ✅ ' + name); };

console.log('=== 场景组 A：幽灵 lastId（首次装/清数据/换机）—— 应自动直连唯一 BASE ===');
t('A1 过时兜底 MAC + 现场 BASE&Pro 两枚 → 自动连 BASE(49:C9)', () => {
  const r = pickAutoConnectRingId({
    lastId: STALE,
    seenIds: [BASE.id, PRO.id],
    knownIds: [BASE.id, PRO.id],   // confirmMultiRing 已记录的在播两枚（不含过时 STALE）
    devices: [BASE, PRO],
  });
  assert.equal(r, BASE.id);
});
t('A2 lastId 为空 + 只播 BASE 一枚 → 自动连 BASE', () => {
  const r = pickAutoConnectRingId({ lastId: null, seenIds: [BASE.id], knownIds: [], devices: [BASE] });
  assert.equal(r, BASE.id);
});
t('A3 过时兜底 MAC + Pro 拿走只剩 BASE 在播 → 自动连 BASE', () => {
  const r = pickAutoConnectRingId({
    lastId: STALE, seenIds: [BASE.id], knownIds: [BASE.id, PRO.id], devices: [BASE],
  });
  assert.equal(r, BASE.id);
});
t('A4 大小写/空格归一化 → 仍返回标准大写 MAC', () => {
  const r = pickAutoConnectRingId({
    lastId: '  41:42:e7:17:9b:1c ', seenIds: [BASE.id], knownIds: [],
    devices: [{ id: '  41:42:14:ae:49:c9 ', name: 'lunamira' }],
  });
  assert.equal(r, BASE.id);
});

console.log('=== 场景组 B：护栏 —— 本机真正见过的上次戒指，绝不自动切 ===');
t('B1 lastId 本轮正在广播 → 返回 null（交给 hitLast 直连那枚）', () => {
  const r = pickAutoConnectRingId({
    lastId: PRO.id, seenIds: [BASE.id, PRO.id], knownIds: [BASE.id, PRO.id], devices: [BASE, PRO],
  });
  assert.equal(r, null);
});
t('B2 上次连的 Pro 此刻没广播、但在 knownIds → 返回 null（不切到 BASE）', () => {
  const r = pickAutoConnectRingId({
    lastId: PRO.id, seenIds: [BASE.id], knownIds: [BASE.id, PRO.id], devices: [BASE],
  });
  assert.equal(r, null);
});
t('B3 上次连的 BASE 此刻没广播、但在 knownIds → 返回 null（不误连 Pro）', () => {
  const r = pickAutoConnectRingId({
    lastId: BASE.id, seenIds: [PRO.id], knownIds: [BASE.id, PRO.id], devices: [PRO],
  });
  assert.equal(r, null);
});

console.log('=== 场景组 C：含糊场景 —— 维持列出待选（返回 null）===');
t('C1 在播两枚都是 BASE → 无法唯一确定，返回 null', () => {
  const r = pickAutoConnectRingId({
    lastId: STALE, seenIds: [], knownIds: [], devices: [BASE, { id: 'AA:BB:CC:DD:EE:FF', name: 'Luna Mira' }],
  });
  assert.equal(r, null);
});
t('C2 只有 Pro 在播 → 不自动连 Pro，返回 null', () => {
  const r = pickAutoConnectRingId({ lastId: STALE, seenIds: [PRO.id], knownIds: [], devices: [PRO] });
  assert.equal(r, null);
});
t('C3 没有在播设备 → 返回 null', () => {
  const r = pickAutoConnectRingId({ lastId: STALE, seenIds: [], knownIds: [], devices: [] });
  assert.equal(r, null);
});
t('C4 广播名分不清型号 → 返回 null', () => {
  const r = pickAutoConnectRingId({
    lastId: STALE, seenIds: [], knownIds: [], devices: [{ id: '11:22:33:44:55:66', name: 'Unknown' }],
  });
  assert.equal(r, null);
});

console.log(`\n=== RESULT: ${pass}/${pass} PASS ===`);
