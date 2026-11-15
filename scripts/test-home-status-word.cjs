/**
 * 首页圆环中心「场景词」回落回归（2026-11-15）
 *
 * 用户反馈：触发「收个工」后，从傍晚一直挂到晚上七八点，档位没变也不回到底层词。
 * 旧实现回落时把 active 清空，下一帧又被当成「新场景」重新武装 → 死循环。
 *
 * 运行：node scripts/test-home-status-word.cjs
 * 与 test-uiux.cjs 同款：typescript.transpileModule 直接加载 TS，零构建产物。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => (name in mocks ? mocks[name] : require(name));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

const timePhase = load('src/lib/timePhase.ts');
const hsw = load('src/lib/homeStatusWord.ts', { './timePhase': timePhase });

const DAY = '2026-11-15';
const at = (h, m, dayOffset = 0) => new Date(2026, 10, 15 + dayOffset, h, m, 0).getTime();
const phaseAt = (ms) => timePhase.dayPhase(new Date(ms));
const call = (ms, level = 2, sedentary = false, phase) =>
  hsw.pickHomeWord({ phase: phase ?? phaseAt(ms), level, sedentary, now: ms });

/** 从 18:00 起每 10 分钟采一次，直到 21:20（不跨 bedtime） */
function eveningSweep(level = 2, sedentary = false) {
  const out = [];
  for (let m = 0; m <= 200; m += 10) {
    const ms = at(18, 0) + m * 60000;
    out.push({ minute: m, ms, ...call(ms, level, sedentary) });
  }
  return out;
}

test('① 傍晚场景词只显示 30 分钟，之后整晚回落到档位词（旧 bug 会在这里挂满全程）', () => {
  hsw.resetHomeWord();
  const seq = eveningSweep();

  const atMin = (m) => seq.find((s) => s.minute === m);
  assert.equal(seq[0].word, '收个工');
  assert.equal(seq[0].reason, 'scenario-start');
  assert.equal(seq[0].isScenario, true);
  // 触发后 <30min：仍是场景词
  assert.equal(atMin(10).word, '收个工', '18:10 应仍显示场景词');
  assert.equal(atMin(20).word, '收个工', '18:20 应仍显示场景词');
  // 到 30min：回落「平平静静」
  assert.equal(atMin(30).word, '平平静静');
  assert.equal(atMin(30).reason, 'scenario-expired');
  assert.equal(atMin(30).isScenario, false);
  // 关键回归：19:00 / 20:00 / 21:00 都不能再冒出「收个工」
  const after = seq.filter((s) => s.minute >= 30);
  assert.equal(after.filter((s) => s.isScenario).length, 0,
    '回落后不得重新武装（旧版 19:10/20:10/21:10 会重新显示）');
  assert.ok(after.every((s) => s.word === '平平静静'));
  assert.ok(seq.filter((s) => s.word === '收个工').length <= 3,
    '场景词采样点不应超过 3 个（30min 窗口，10min 一步）');
});

test('② 回落后档位变化：底层词跟着变，场景词不复活', () => {
  hsw.resetHomeWord();
  const ms = at(19, 0); // 已回落
  call(at(18, 0));
  call(ms);
  assert.equal(call(ms, 0).word, '元气满满');
  assert.equal(call(ms, 1).word, '状态良好');
  assert.equal(call(ms, 2).word, '平平静静');
  assert.equal(call(ms, 3).word, '休息一下');
  assert.equal(call(ms, 2).isScenario, false);
});

test('③ 场景切换可触发新词，旧场景不复活；新词同样 30 分钟后回落', () => {
  hsw.resetHomeWord();
  call(at(18, 0));                       // 收个工
  call(at(18, 40));                      // 已回落
  const b = call(at(21, 30));            // bedtime
  assert.equal(b.word, '该歇了');
  assert.equal(b.isScenario, true);
  assert.equal(call(at(22, 10)).word, '平平静静', '睡前词 30min 后回落');
  // 人为把时段拨回 evening（例如系统时区/校时）：offWork 已 done，不能复活
  const back = call(at(22, 20), 2, false, 'evening');
  assert.equal(back.word, '平平静静');
  assert.equal(back.reason, 'already-done');
});

test('④ 午后久坐：信号消失即回落，同一场景当天不重复触发', () => {
  hsw.resetHomeWord();
  assert.equal(call(at(14, 0), 2, true).word, '摸个鱼吧');
  assert.equal(call(at(14, 10), 2, false).word, '平平静静', '久坐信号消失 → 回落');
  assert.equal(call(at(14, 20), 2, true).word, '平平静静', '再次久坐不得重复挂场景词');
  assert.equal(call(at(15, 30), 2, true).reason, 'already-done');
});

test('⑤ 跨天清零：第二天同一场景可以重新短暂出现', () => {
  hsw.resetHomeWord();
  call(at(18, 0));
  call(at(19, 0));
  const next = call(at(18, 0, 1));
  assert.equal(next.word, '收个工');
  assert.equal(next.reason, 'scenario-start');
  assert.equal(call(at(18, 40, 1)).word, '平平静静');
});

test('⑥ 持久化：hydrate 前不覆盖磁盘；重启后已展示场景不再冒出来', async () => {
  const disk = { value: null };
  hsw.configureHomeWordPersist({
    load: async () => disk.value,
    save: (s) => { disk.value = JSON.parse(JSON.stringify(s)); },
  });

  hsw.resetHomeWord();
  // 首帧 render 发生在 hydrate 之前：不能把磁盘里「今天已展示过」的记录冲掉
  disk.value = { dk: DAY, done: ['offWork'], active: null, startedAt: 0 };
  assert.equal(call(at(18, 10)).word, '收个工');
  assert.deepEqual(disk.value.done, ['offWork'], 'hydrate 前禁止写盘');

  await hsw.hydrateHomeWord();
  const r = call(at(18, 10));
  assert.equal(r.word, '平平静静');
  assert.equal(r.reason, 'already-done');
  assert.equal(call(at(20, 0)).word, '平平静静');
});

test('⑦ 持久化：恢复未过期的 active 时，展示到 TTL 才回落', async () => {
  const disk = { value: null };
  hsw.configureHomeWordPersist({
    load: async () => disk.value,
    save: (s) => { disk.value = JSON.parse(JSON.stringify(s)); },
  });
  hsw.resetHomeWord();
  disk.value = { dk: DAY, done: [], active: 'offWork', startedAt: at(18, 0) };
  await hsw.hydrateHomeWord();
  assert.equal(call(at(18, 10)).word, '收个工');
  assert.equal(call(at(18, 29)).word, '收个工');
  const expired = call(at(18, 30));
  assert.equal(expired.word, '平平静静');
  assert.equal(expired.reason, 'scenario-expired');
  assert.ok(disk.value.done.includes('offWork'), '回落状态要写回磁盘');
  hsw.configureHomeWordPersist(null);
});
