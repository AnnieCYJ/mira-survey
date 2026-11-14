// 离线自检：HRV 日视图 夜间/日间 分段切换逻辑（对应 MetricDetailScreen 的 hrvEffectivePart）。
// 不依赖 RN，纯逻辑验证状态陷阱是否消除。
function effectivePart(hrvPart, hrvNightAvailable) {
  return hrvNightAvailable ? hrvPart : 'day';
}
function btnState(p, hrvPart, hrvNightAvailable) {
  const eff = effectivePart(hrvPart, hrvNightAvailable);
  const on = eff === p;
  const disabled = p === 'night' && !hrvNightAvailable;
  return { on, disabled };
}

const cases = [
  // [desc, hrvPart, nightAvailable, expectNightBtn, expectDayBtn]
  ['夜间可用+选中夜间', 'night', true,
    { on: true, disabled: false }, { on: false, disabled: false }],
  ['夜间可用+选中日间', 'day', true,
    { on: false, disabled: false }, { on: true, disabled: false }],
  ['夜间不可用+默认夜间(旧陷阱)', 'night', false,
    { on: false, disabled: true }, { on: true, disabled: false }],
  ['夜间不可用+已选日间', 'day', false,
    { on: false, disabled: true }, { on: true, disabled: false }],
];

let pass = 0, fail = 0;
for (const [desc, hp, nav, en, ed] of cases) {
  const nb = btnState('night', hp, nav);
  const db = btnState('day', hp, nav);
  const okN = nb.on === en.on && nb.disabled === en.disabled;
  const okD = db.on === ed.on && db.disabled === ed.disabled;
  // 关键不变量：绝不能同时有两个选中
  const selectedCount = (nb.on ? 1 : 0) + (db.on ? 1 : 0);
  const invariant = selectedCount === 1;
  // 当夜间不可用时，选中的必须是「日间」且日间可点（消除旧陷阱：高亮夜间却禁用、点不动）
  const trapFree = nav ? true : (db.on && !db.disabled);
  const ok = okN && okD && invariant && trapFree;
  console.log(`${ok ? '✓' : '✗'} ${desc}  | 夜{on:${nb.on},disabled:${nb.disabled}} 日{on:${db.on},disabled:${db.disabled}} selected=${selectedCount}`);
  ok ? pass++ : fail++;
}
// 额外：从「夜间可用+选中夜间」切到「夜间不可用」（睡眠数据丢失）时，不应出现「夜间被选中且禁用」的卡死
{
  const before = btnState('night', 'night', true);
  const after = btnState('night', 'night', false);
  const noTrap = !(after.on && after.disabled);
  console.log(`${noTrap ? '✓' : '✗'} 睡眠数据丢失后不会卡死在「夜间选中且禁用」 (after.on=${after.on}, after.disabled=${after.disabled})`);
  noTrap ? pass++ : fail++;
}
console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail === 0 ? 0 : 1);
