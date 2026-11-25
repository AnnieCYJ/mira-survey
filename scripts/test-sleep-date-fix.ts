/**
 * 睡眠日期错配修复 · 离线回归（纯函数，Node/tsx 可跑）
 *
 * 背景（用户 2026-11-16 反馈）：
 *   戒指带历史睡眠数据、昨天寄出、今早新用户首次连上，App 立刻显示"今天"有一整晚睡眠。
 *   真因：Veepoo SDK 读"今天"槽位时，若今天无记录会回传设备里最后一晚并把 SleepData.date
 *   标成请求日（今天）。旧实现完全信任这个 date → 历史睡眠被写进今天。
 *
 * 本测试验证三层修复的纯逻辑部分：
 *   ① Kotlin onSleepDataChange：优先用 sleepUp 的年月日（起床日 = App 归档日）做 key；
 *   ② Kotlin buildDaily：下发 sleepUpDate/sleepDownDate 完整日期（JS 才能校验）；
 *   ③ JS handleBatch：拒绝"标成今天、但起床日不是今天"的睡眠写入今天。
 */
import assert from 'node:assert';

// ── 复刻 Kotlin onSleepDataChange 的 key 计算 ─────────────────────────────
function kotlinSleepKey(args: {
  upYear: number; upMonth: number; upDay: number;
  sdkDate: string | null; day: string | null;
}): { key: string; wakeKey: string | null; sdkKey: string | null; mismatched: boolean } {
  const { upYear: y, upMonth: mo, upDay: dd, sdkDate, day } = args;
  // Kotlin: if (y in 2020..2030 && mo in 1..12 && dd in 1..31) ...
  const wakeKey = (y >= 2020 && y <= 2030 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31)
    ? `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    : null;
  const sdkKey = sdkDate ? normDateKey(sdkDate) : null;
  const key = wakeKey ?? sdkKey ?? (day ? normDateKey(day) : null);
  assert.ok(key, 'key 不应为空');
  return { key: key!, wakeKey, sdkKey, mismatched: !!wakeKey && !!sdkKey && wakeKey !== sdkKey };
}

function normDateKey(s: string): string {
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
}

// ── 复刻 JS handleBatch 的 todaySleepMismatch 拦截 ────────────────────────
function jsShouldWriteToday(args: {
  dk: string; todayKey: string; sleepUpDate: string | null; hasSleep: boolean;
}): { write: boolean; blocked: boolean } {
  const isToday = args.dk === args.todayKey;
  const todaySleepMismatch = isToday && !!args.sleepUpDate && args.sleepUpDate !== args.dk;
  return { write: args.hasSleep && !todaySleepMismatch, blocked: todaySleepMismatch };
}

const TODAY = '2026-11-16';
let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('  ✅ ' + name); };

console.log('=== ① Kotlin 归档 key（起床日优先） ===');
t('正常昨夜睡眠：起床=今天、SDK也标今天 → key=今天，无错配', () => {
  const r = kotlinSleepKey({ upYear: 2026, upMonth: 11, upDay: 16, sdkDate: '2026-11-16', day: '2026-11-16' });
  assert.equal(r.key, '2026-11-16');
  assert.equal(r.mismatched, false);
});
t('★ 用户场景：历史睡眠被 SDK 标成今天，但起床日是 11-10 → key=11-10，错配告警', () => {
  const r = kotlinSleepKey({ upYear: 2026, upMonth: 11, upDay: 10, sdkDate: '2026-11-16', day: '2026-11-16' });
  assert.equal(r.key, '2026-11-10');          // 归档到真实历史日，不进今天
  assert.notEqual(r.key, TODAY);
  assert.equal(r.mismatched, true);            // 打日志
});
t('SDK 日期缺失时回退到 sleepUp 起床日', () => {
  const r = kotlinSleepKey({ upYear: 2026, upMonth: 11, upDay: 16, sdkDate: null, day: '2026-11-16' });
  assert.equal(r.key, '2026-11-16');
});
t('年月日无效（固件未填）时回退到 SDK date', () => {
  const r = kotlinSleepKey({ upYear: 0, upMonth: 0, upDay: 0, sdkDate: '2026-11-16', day: '2026-11-16' });
  assert.equal(r.wakeKey, null);
  assert.equal(r.key, '2026-11-16');
});
t('非补零 SDK 日期归一（2026-9-3 → 2026-09-03）', () => {
  assert.equal(normDateKey('2026-9-3'), '2026-09-03');
});

console.log('=== ② JS 今日拦截（todaySleepMismatch） ===');
t('★ 标今天 + 起床日=历史日 → 拦截，不写今天', () => {
  const r = jsShouldWriteToday({ dk: TODAY, todayKey: TODAY, sleepUpDate: '2026-11-10', hasSleep: true });
  assert.equal(r.blocked, true);
  assert.equal(r.write, false);
});
t('标今天 + 起床日=今天 → 正常写入', () => {
  const r = jsShouldWriteToday({ dk: TODAY, todayKey: TODAY, sleepUpDate: '2026-11-16', hasSleep: true });
  assert.equal(r.blocked, false);
  assert.equal(r.write, true);
});
t('标历史日（非今天）→ 不触发今日拦截，按原逻辑写历史', () => {
  const r = jsShouldWriteToday({ dk: '2026-11-10', todayKey: TODAY, sleepUpDate: '2026-11-10', hasSleep: true });
  assert.equal(r.blocked, false);
  assert.equal(r.write, true);
});
t('无 sleepUpDate（旧固件）→ 不误拦，保持原行为', () => {
  const r = jsShouldWriteToday({ dk: TODAY, todayKey: TODAY, sleepUpDate: null, hasSleep: true });
  assert.equal(r.blocked, false);
  assert.equal(r.write, true);
});
t('今天无睡眠数据 → 本来就不写', () => {
  const r = jsShouldWriteToday({ dk: TODAY, todayKey: TODAY, sleepUpDate: TODAY, hasSleep: false });
  assert.equal(r.write, false);
});

console.log(`\n=== RESULT: ${pass}/${pass} PASS ===`);
