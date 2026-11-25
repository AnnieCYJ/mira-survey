/**
 * 问卷数字范围校验 · 离线回归（2026-11-16）
 *
 * 背景（用户）：填问卷时体重被填成 5555 kg，超出人类极限，应拦截重填。
 * 本测试复刻 OnboardingScreen.validateNumberAnswer 的纯逻辑，验证 6 个数字题的范围：
 *   年龄 1-120 / 身高 80-250 / 体重 20-300
 *   生理期几天前 0-60 / 持续 1-15 / 平均周期 15-90
 *
 * 运行：npx tsx scripts/test-onboard-number-validation.ts
 */
import assert from 'node:assert';

type Q = { id: string; min?: number; max?: number };
const RULES: Record<string, { min: number; max: number }> = {
  age: { min: 1, max: 120 },
  height: { min: 80, max: 250 },
  weight: { min: 20, max: 300 },
  periodStart: { min: 0, max: 60 },
  periodDuration: { min: 1, max: 15 },
  periodCycle: { min: 15, max: 90 },
};

function validateNumberAnswer(q: Q, raw: string): string | null {
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v)) return '请输入有效的数字';
  const { min, max } = RULES[q.id];
  if (min != null && v < min) return `这个数值偏小，请填写 ${min}–${max} 之间的数字`;
  if (max != null && v > max) return `这个数值超出正常范围（${min}–${max}），请重新填写`;
  return null;
}

let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('  ✅ ' + name); };

console.log('=== 场景组 A：用户实测问题 —— 5555 kg 必须拦截 ===');
t('A1 体重 5555 kg → 拦截', () => {
  assert.ok(validateNumberAnswer({ id: 'weight' }, '5555')?.includes('超出正常范围'));
});
t('A2 身高 5555 cm → 拦截', () => {
  assert.ok(validateNumberAnswer({ id: 'height' }, '5555')?.includes('超出正常范围'));
});

console.log('=== 场景组 B：各题上界越界拦截 ===');
t('B1 年龄 999 → 拦截', () => assert.ok(validateNumberAnswer({ id: 'age' }, '999')));
t('B2 身高 300 → 拦截（>250）', () => assert.ok(validateNumberAnswer({ id: 'height' }, '300')));
t('B3 体重 301 → 拦截（>300）', () => assert.ok(validateNumberAnswer({ id: 'weight' }, '301')));
t('B4 经期持续 30 天 → 拦截（>15）', () => assert.ok(validateNumberAnswer({ id: 'periodDuration' }, '30')));
t('B5 平均周期 200 天 → 拦截（>90）', () => assert.ok(validateNumberAnswer({ id: 'periodCycle' }, '200')));
t('B6 生理期几天前 100 → 拦截（>60）', () => assert.ok(validateNumberAnswer({ id: 'periodStart' }, '100')));

console.log('=== 场景组 C：下界越界拦截 ===');
t('C1 年龄 0 → 拦截（偏小）', () => assert.ok(validateNumberAnswer({ id: 'age' }, '0')?.includes('偏小')));
t('C2 身高 50 → 拦截（<80）', () => assert.ok(validateNumberAnswer({ id: 'height' }, '50')));
t('C3 体重 10 → 拦截（<20）', () => assert.ok(validateNumberAnswer({ id: 'weight' }, '10')));
t('C4 平均周期 5 → 拦截（<15）', () => assert.ok(validateNumberAnswer({ id: 'periodCycle' }, '5')));

console.log('=== 场景组 D：正常值放行 ===');
t('D1 年龄 28 / 身高 165 / 体重 55 → 全放行', () => {
  assert.equal(validateNumberAnswer({ id: 'age' }, '28'), null);
  assert.equal(validateNumberAnswer({ id: 'height' }, '165'), null);
  assert.equal(validateNumberAnswer({ id: 'weight' }, '55'), null);
});
t('D2 边界值放行（年龄1/120，身高80/250，体重20/300）', () => {
  assert.equal(validateNumberAnswer({ id: 'age' }, '1'), null);
  assert.equal(validateNumberAnswer({ id: 'age' }, '120'), null);
  assert.equal(validateNumberAnswer({ id: 'height' }, '80'), null);
  assert.equal(validateNumberAnswer({ id: 'height' }, '250'), null);
  assert.equal(validateNumberAnswer({ id: 'weight' }, '20'), null);
  assert.equal(validateNumberAnswer({ id: 'weight' }, '300'), null);
});
t('D3 经期字段正常值放行', () => {
  assert.equal(validateNumberAnswer({ id: 'periodStart' }, '14'), null);
  assert.equal(validateNumberAnswer({ id: 'periodDuration' }, '5'), null);
  assert.equal(validateNumberAnswer({ id: 'periodCycle' }, '28'), null);
});
t('D4 生理期几天前 0 → 放行（今天刚开始）', () => {
  assert.equal(validateNumberAnswer({ id: 'periodStart' }, '0'), null);
});

console.log('=== 场景组 E：非法输入 ===');
t('E1 空串 → 拦截', () => assert.ok(validateNumberAnswer({ id: 'weight' }, '')));
t('E2 非数字 → 拦截', () => assert.ok(validateNumberAnswer({ id: 'weight' }, 'abc')));

console.log(`\n=== RESULT: ${pass}/${pass} PASS ===`);
