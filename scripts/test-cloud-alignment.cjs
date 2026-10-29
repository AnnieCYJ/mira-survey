// Run with: node scripts/test-cloud-alignment.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = new Module(filename, module);
  mod.require = id => { if (id in mocks) return mocks[id]; throw new Error('Unexpected import: ' + id); };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return mod.exports;
}
async function main() {
  const { ringUploadExtFields } = load('src/lib/ringUploadFields.ts');
  assert.deepEqual(ringUploadExtFields({ bloodSugar: 5.2, bpSys: 115, bpDia: 75 }), { bloodSugar: 5.2, bpSys: 115, bpDia: 75 });
  assert.deepEqual(ringUploadExtFields({ bloodSugar: 0, bpSys: NaN, bpDia: Infinity, hdl: null }), { bloodSugar: 0 });
  assert.deepEqual(ringUploadExtFields(undefined), {});
  let disk = JSON.stringify({ deviceId: 'local-old', token: 'token-ring-a', tokenDeviceId: 'ring-a', tokenAt: 1 });
  const identity = load('src/data/ringIdentity.ts', {
    'expo-file-system': { documentDirectory: '/mock/', getInfoAsync: async () => ({ exists: true }), readAsStringAsync: async () => disk, writeAsStringAsync: async (_, value) => { disk = value; } },
    '../config': { BACKEND_BASE_URL: 'https://example.invalid', RING_SYNC_TOKEN: '' },
  });
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    await new Promise(resolve => setTimeout(resolve, 1));
    return { ok: true, status: 200, json: async () => url.endsWith('/token') ? { token: 'token-' + JSON.parse(init.body).device_id } : {} };
  };
  try {
    assert.equal(await identity.getLocalDeviceId(), 'ring-a');
    const [b, c] = await Promise.all([identity.ensureDeviceToken('ring-b'), identity.ensureDeviceToken('ring-c')]);
    assert.equal(b, 'token-ring-b');
    assert.equal(c, 'token-ring-c');
    await identity.apiFetch('/read-b', { headers: identity.authHeaders(b) });
    assert.equal(requests.at(-1).init.headers.Authorization, 'Bearer token-ring-b');
    await identity.apiFetch('/read-no-token', { headers: identity.authHeaders(null) });
    assert.equal(requests.at(-1).init.headers.Authorization, undefined);
  } finally { global.fetch = originalFetch; }
  const calls = [];
  const patterns = load('src/ai/cloudPatterns.ts', {
    '../data/ringIdentity': { getLocalDeviceId: async () => 'a', ensureDeviceToken: async id => id, authHeaders: token => ({ Authorization: token }), apiFetch: async url => { calls.push(url); await new Promise(resolve => setTimeout(resolve, 1)); return { ok: true, data: { observations: [], window_days: 30 } }; } },
    '../data/patternStore': { upsertObservations: async () => {}, listVisiblePatterns: async () => [], peekLifeContext: () => [], peekPendingObservations: () => [] },
    './patterns': { computeLocalPatterns: () => [], mergeObservations: (a,b) => [...a,...b] },
  });
  await patterns.syncPatterns({ deviceId: 'a', days: 30 });
  await patterns.syncPatterns({ deviceId: 'a', days: 30 });
  assert.equal(calls.length, 1);
  await patterns.syncPatterns({ deviceId: 'b', days: 30 });
  await patterns.syncPatterns({ deviceId: 'b', days: 7 });
  assert.equal(calls.length, 3);
  await Promise.all([patterns.syncPatterns({ deviceId: 'c' }), patterns.syncPatterns({ deviceId: 'd' })]);
  assert.equal(calls.length, 5);
  assert.ok(calls.at(-1).includes('device_id=d'));
  console.log('PASS: extension fields, device identity, concurrent tokens, request headers and scoped cache');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
