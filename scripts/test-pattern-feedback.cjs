// Run with: node scripts/test-pattern-feedback.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const observation = { id: 'sleep', kind: 'correlation', title: '睡眠观察', text: '描述性关系', evidence: { n: 8, r: 0.3 }, confidence: 'low', confidenceScore: 0.3, source: 'local', windowDays: 30, observedAt: 1 };
let disk = JSON.stringify({ entries: [{ ...observation, confidence: 'high', confidenceScore: 0.9, confirmCount: 3, dismissed: false, firstAt: 1, lastAt: 1 }] });
function loadStore() {
  const filename = path.resolve(__dirname, '../src/data/patternStore.ts');
  const mod = new Module(filename, module);
  mod.require = id => {
    if (id !== 'expo-file-system') throw new Error('Unexpected import: ' + id);
    return { documentDirectory: '/mock/', getInfoAsync: async () => ({ exists: true }), readAsStringAsync: async () => disk, writeAsStringAsync: async (_, value) => { disk = value; } };
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return mod.exports;
}
async function main() {
  let store = loadStore();
  const [legacy] = await store.loadPatternStore();
  assert.equal(legacy.confidenceScore, 0);
  assert.equal(legacy.confirmCount, 3);
  await store.upsertObservations([observation]);
  await store.confirmPattern('sleep');
  const entry = await store.confirmPattern('sleep');
  assert.equal(entry.confidenceScore, 0.3);
  assert.equal(entry.confidence, 'low');
  assert.equal((await store.listLifeContext()).length, 1);
  await store.feedbackPattern('sleep', 'inaccurate');
  assert.equal((await store.listLifeContext()).length, 0);
  assert.equal(store.peekPendingObservations().length, 0);
  await store.upsertObservations([{ ...observation, observedAt: 2 }]);
  assert.equal(store.peekPendingObservations().length, 0);
  store = loadStore();
  await store.loadPatternStore();
  assert.equal(store.peekPendingObservations().length, 0);
  assert.equal((await store.listLifeContext()).length, 0);
  await store.confirmPattern('sleep');
  assert.equal((await store.listLifeContext()).length, 1);
  await store.dismissPattern('sleep');
  assert.equal(await store.confirmPattern('sleep'), null);
  assert.equal((await store.listLifeContext()).length, 0);
  await store.restorePattern('sleep');
  assert.equal((await store.listLifeContext()).length, 1);
  console.log('PASS: legacy migration, separate evidence, denial, refresh, persistence and dismissal');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
