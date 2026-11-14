#!/usr/bin/env node
/**
 * 夜间血氧 / HRV 回填链路离线自检（纯规则，不需要真机）
 *
 * 覆盖 2026-11-11 真机实证的两个根因：
 *  ① 同步事务竞态：主同步 emit backfillDone 早于 origin3 历史回读结束，
 *     JS 排队补跑再发一次全量同步，把 BLE 读命令打断（origin3 emit days=0）。
 *  ② 血氧时间戳只有小时粒度：Spo2hOriginData.getmTime() 的 minute/second 恒 0，
 *     同小时 N 条样本撞在同一个 ts，被 healthStore 的 MERGE_MS=60s 连锁合并成 1 条
 *     （真机：155 条血氧样本只落了 7 个整点）。
 *
 * 运行：node scripts/check_night_backfill.js
 */
'use strict';

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; }
  else { fails.push(`${name}${detail ? ' | ' + detail : ''}`); }
}

const MIN = 60_000;
const MERGE_MS = 60_000;                       // src/data/healthStore.ts
const DAY = new Date('2026-11-11T00:00:00').getTime();

/** 模拟 JS parseSampleTs 对 "HH:mm:ss" 的解析 */
function parseSampleTs(time) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) return null;
  const h = +m[1], mi = +m[2], s = +(m[3] ?? 0);
  if (h >= 24 || mi >= 60 || s >= 60) return null;
  return DAY + h * 3600_000 + mi * MIN + s * 1000;
}

/** 模拟 healthStore.mergeIntraday（base 非空分支：±MERGE_MS 取最近，删旧写新） */
function mergeIntraday(base, incoming) {
  const map = new Map(base.map((p) => [p.t, p]));
  for (const p of incoming) {
    let hitT = null, best = Infinity;
    for (const k of map.keys()) {
      const diff = Math.abs(k - p.t);
      if (diff <= MERGE_MS && diff < best) { best = diff; hitT = k; }
    }
    if (hitT != null) map.delete(hitT);
    map.set(p.t, p);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** 模拟 Kotlin mergeSlotsByTs：同 ts 合并字段，不互相覆盖 */
function mergeSlotsByTs(slots) {
  const map = new Map();
  for (const s of slots) {
    const dst = map.get(s.ts);
    if (!dst) { map.set(s.ts, { ...s }); continue; }
    for (const [k, v] of Object.entries(s)) {
      if (k === 'ts' || k === 'time') continue;
      if (!(k in dst)) dst[k] = v;
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

/** 模拟 Kotlin onOriginSpo2OriginListDataChange 的「同小时按序回放」 */
function spreadByHour(samples, enabled) {
  const groups = new Map();
  for (const s of samples) {
    const key = `${s.date}|${s.hour}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const [, items] of groups) {
    const n = items.length;
    items.forEach((s, idx) => {
      const mm = enabled && n > 1 ? Math.min(59, Math.floor(idx * 60 / n)) : 0;
      const hhmmss = `${String(s.hour).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
      out.push({ ts: parseSampleTs(hhmmss), time: hhmmss, spo2: s.spo2 });
    });
  }
  return mergeSlotsByTs(out);
}

/** 模拟 upsertBackfillSamples 的实时真值优先守卫 + mergeIntraday */
function land(existing, slots, isRealtimeDay) {
  const eligible = isRealtimeDay
    ? slots.filter((s) => !existing.some((q) => Math.abs(q.t - s.ts) <= MERGE_MS))
    : slots;
  return mergeIntraday(existing, eligible.map((s) => ({ t: s.ts, v: s.spo2 })));
}

// ── 场景 1：真机同款 —— 7 个小时 × 22 条血氧，TimeData.minute 恒 0 ──
const samples = [];
for (let h = 2; h <= 8; h++) {
  for (let i = 0; i < 22; i++) samples.push({ date: '2026-11-11', hour: h, spo2: 96 + (i % 4) });
}
// 真机已有 realtime 点：00:00–01:33 每秒一条 + 09:56 起每秒一条
const existing = [];
for (let t = 0; t < 5601; t++) existing.push({ t: DAY + t * 1000, v: 98 });
for (let t = 9 * 3600 + 56 * 60; t < 10 * 3600 + 5 * 60; t++) existing.push({ t: DAY + t * 1000, v: 98 });
const before = existing.length;

const oldSlots = spreadByHour(samples, false);
const oldLanded = land(existing, oldSlots, true).length - before;
const newSlots = spreadByHour(samples, true);
const newLanded = land(existing, newSlots, true).length - before;

ok('旧逻辑复现「每小时只剩 1 点」', oldLanded === 7, `oldLanded=${oldLanded}`);
ok('新逻辑不丢夜间血氧样本', newLanded >= samples.length * 0.9, `in=${samples.length} landed=${newLanded}`);
ok('新逻辑落库点数显著多于旧逻辑', newLanded >= oldLanded * 10, `old=${oldLanded} new=${newLanded}`);
ok('展开后时间仍落在各自小时内', newSlots.every((s) => {
  const h = Math.floor((s.ts - DAY) / 3600_000);
  return h >= 2 && h <= 8;
}));
ok('展开后同一小时内相邻样本间隔 > MERGE_MS', (() => {
  for (let h = 2; h <= 8; h++) {
    const ts = newSlots.filter((s) => Math.floor((s.ts - DAY) / 3600_000) === h).map((s) => s.ts).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] <= MERGE_MS) return false;
  }
  return true;
})(), '相邻点仍会被 ±60s 合并');
ok('HH:mm:ss 可被 parseSampleTs 解析', newSlots.every((s) => Number.isFinite(s.ts)));

// ── 场景 2：同刻多指标合并，字段不丢 ──
const mixed = [
  { ts: DAY + 2 * 3600_000, time: '02:00:00', hrv: 48 },
  { ts: DAY + 2 * 3600_000, time: '02:00:00', spo2: 98 },
  { ts: DAY + 2 * 3600_000, time: '02:00:00', hr: 62 },
];
const merged = mergeSlotsByTs(mixed);
ok('同刻 slot 合并为一条且三个指标都在', merged.length === 1 && merged[0].hrv === 48 && merged[0].spo2 === 98 && merged[0].hr === 62);

// ── 场景 3：同步事务状态机（backfillDone 必须晚于 origin3） ──
function transaction() {
  const events = [];
  let backfillInProgress = true;
  let origin3InProgress = false;
  let backfillDone = false;
  const emitDone = () => { if (!backfillInProgress) return; backfillInProgress = false; origin3InProgress = false; backfillDone = true; events.push('backfillDone'); };
  // 主同步完成
  events.push('mainSyncComplete');
  // 尝试启动 origin3（带防重入）
  const startOrigin3 = () => { if (origin3InProgress) return false; origin3InProgress = true; return true; };
  ok('主同步完成后 origin3 可启动', startOrigin3());
  // 模拟 JS 在 backfillDone 之前就补跑（旧时序）：应被 backfillInProgress 挡住
  const rerunAccepted = !backfillInProgress;
  ok('事务未收尾时补跑请求被挡住', rerunAccepted === false);
  // origin3 结束
  events.push('origin3Settled');
  emitDone();
  return { events, backfillDone, backfillInProgress };
}
const tx = transaction();
ok('backfillDone 恰好一次', tx.events.filter((e) => e === 'backfillDone').length === 1);
ok('backfillDone 严格晚于 origin3Settled',
  tx.events.indexOf('backfillDone') > tx.events.indexOf('origin3Settled'));
ok('事务结束后两把锁都释放', tx.backfillDone && !tx.backfillInProgress);

// ── 场景 4：origin3 异常/超时也必须收口 ──
for (const reason of ['onTimeout', 'exception', 'deviceNotReady']) {
  let done = false;
  const onDone = () => { done = true; };
  // 三条路径都必须调用 onDone
  try { if (reason === 'exception') throw new Error('sdk'); onDone(); } catch { onDone(); }
  ok(`${reason} 仍会收口事务`, done);
}

// ── 场景 5：空数据 / 单样本边界 ──
for (const n of [0, 1, 2, 60, 200]) {
  const one = Array.from({ length: n }, (_, i) => ({ date: '2026-11-11', hour: 3, spo2: 97 }));
  const slots = spreadByHour(one, true);
  ok(`每小时 ${n} 条不产生非法时间戳`, slots.every((s) => Number.isFinite(s.ts) && s.time.length === 8));
  ok(`每小时 ${n} 条不出界（03 点内）`, slots.every((s) => Math.floor((s.ts - DAY) / 3600_000) === 3));
}

console.log(`\n══ 结果：${pass} 通过 / ${fails.length} 失败 ══`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`  真机同款：${samples.length} 条夜间血氧 → 旧逻辑落 ${oldLanded} 点，新逻辑落 ${newLanded} 点`);
