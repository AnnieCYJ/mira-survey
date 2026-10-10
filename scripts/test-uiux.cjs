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
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = name => name in mocks ? mocks[name] : require(name);
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}
const validate = load('src/lib/profileForm.ts').validateProfile;
const draft = { weight: '55.5', height: '165', age: '28', sex: 'female' };
test('profile accepts decimals and trims whitespace', () => {
  assert.equal(validate(draft).ok, true);
  assert.equal(validate({ ...draft, weight: ' 55.5 ' }).inputs.weight, 55.5);
});
test('profile rejects malformed, missing and out of range input', () => {
  for (const [key, values] of Object.entries({ weight: ['', '55kg', 'NaN', 'Infinity', '1e2', '0', '301'], height: ['79', '251'], age: ['17', '121', '28.5'] })) {
    for (const value of values) {
      const result = validate({ ...draft, [key]: value });
      assert.equal(result.ok, false, `${key}: ${value}`);
      assert.ok(result.errors[key]);
    }
  }
});
function storeHarness(options = {}) {
  const file = { documentDirectory: '/test/', getInfoAsync: async () => {
    if (options.readFails) throw Error('read failed');
    return { exists: !!options.initial };
  }, readAsStringAsync: async () => JSON.stringify(options.initial), writeAsStringAsync: async (_, text) => {
    if (options.writeFails) throw Error('disk full');
    options.disk = JSON.parse(text);
  } };
  return { store: load('src/data/habitSuggestions.ts', { 'expo-file-system': file }), options };
}
test('failed collection does not publish a habit; retry saves exactly once', async () => {
  const { store, options } = storeHarness({ writeFails: true });
  await assert.rejects(store.keepHabit({ id: 'a', headline: 'A' }));
  assert.deepEqual(await store.listHabits(), []);
  options.writeFails = false;
  await store.keepHabit({ id: 'a', headline: 'A' });
  assert.equal((await store.listHabits())[0].count, 1);
});
test('failed read cannot overwrite existing habits with an empty file', async () => {
  const { store, options } = storeHarness({ readFails: true });
  await assert.rejects(store.keepHabit({ id: 'a' }));
  assert.equal(options.disk, undefined);
});
test('concurrent saves, dismissal and undo preserve other records', async () => {
  const { store, options } = storeHarness();
  await Promise.all([store.keepHabit({ id: 'a' }), store.keepHabit({ id: 'b' }), store.keepHabit({ id: 'a' })]);
  assert.equal((await store.listHabits()).find(h => h.id === 'a').count, 2);
  await Promise.all([store.dismissSuggestion('b'), store.undoHabit('a')]);
  assert.deepEqual(options.disk.habits.map(h => h.id), ['b']);
  assert.ok(options.disk.dismissed.b);
});
test('failed undo preserves the saved habit', async () => {
  const { store, options } = storeHarness();
  await store.keepHabit({ id: 'a' }); options.writeFails = true;
  await assert.rejects(store.undoHabit('a'));
  assert.equal((await store.listHabits()).length, 1);
});
// Component event tests isolate native controls and storage without a simulator.
function hooks() {
  const slots = []; let index = 0; let effects = [];
  return { react: {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn, deps) {
      const i = index++;
      if (!(i in slots) || !deps || deps.some((v, n) => v !== slots[i][n])) effects.push(fn);
      slots[i] = deps;
    },
  }, render(Component, props = {}) { index = 0; return Component(props); },
  effects() { const pending = effects; effects = []; pending.forEach(fn => fn()); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
}
const theme = { sp: n => n * 4, fs: n => n, space: { xs: 8, sm: 12, cardPadCompact: 12 }, radius: { sm: 9 }, fontSize: { body: 15, xs: 13, micro: 11, card: 18 }, weight: { medium: '500', semibold: '600' }, press: { opacity: 0.7 }, colors: new Proxy({ ui: {} }, { get: (target, key) => target[key] ?? '#333333' }) };
const mm = { colors: new Proxy({}, { get: () => '#333333' }) };
function formHarness(options = {}) {
  const h = hooks(); const calls = [];
  const exam = { getLatestExamRecord: async () => options.record ?? null, saveExamRecord: async inputs => {
    if (options.fail) throw Error('disk full');
    calls.push(inputs); return { id: 'record', inputs, metrics: [{ key: 'bmi' }] };
  } };
  const Form = load('src/components/ExamTab.tsx', {
    react: h.react,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'Button', StyleSheet: { create: s => s } },
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }) },
    '../theme/theme': { theme }, '../theme/mindmate': { mm }, './Card': { default: 'Card', __esModule: true },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '../lib/profileForm': { validateProfile: validate }, '../data/examStore': exam,
    '../ble/RingBleManager': { RingBle: { getUserProfile: () => null, setUserInfo() {} } },
  }).default;
  return { render: () => h.render(Form), h, calls, options };
}
function fill(form) {
  let tree = form.render();
  for (const [label, value] of [['体重', '55.5'], ['身高', '165'], ['年龄', '28']]) {
    nodes(tree).find(n => n.type === 'TextInput' && n.props.accessibilityLabel.startsWith(label)).props.onChangeText(value);
    tree = form.render();
  }
  return tree;
}
test('filled form retains submit until save succeeds and can be edited again', async () => {
  const f = formHarness(); f.render(); f.h.effects(); await Promise.resolve();
  let tree = fill(f);
  const submit = nodes(tree).find(n => n.props?.accessibilityLabel === '生成估算报告');
  assert.ok(submit);
  await submit.props.onPress(); tree = f.render();
  assert.equal(f.calls.length, 1);
  assert.equal(nodes(tree).filter(n => n.type === 'TextInput').length, 0);
  nodes(tree).find(n => n.props?.accessibilityLabel === '修改身体档案').props.onPress();
  tree = f.render();
  assert.equal(nodes(tree).find(n => n.type === 'TextInput').props.value, '55.5');
});
test('save failure retains entered values and exposes a retry', async () => {
  const f = formHarness({ fail: true }); f.render(); f.h.effects(); await Promise.resolve();
  let tree = fill(f);
  await nodes(tree).find(n => n.props?.accessibilityLabel === '生成估算报告').props.onPress();
  tree = f.render(); assert.match(text(tree), /未保存成功/);
  assert.equal(nodes(tree).filter(n => n.type === 'TextInput').length, 3);
  f.options.fail = false;
  await nodes(tree).find(n => n.props?.accessibilityLabel === '生成估算报告').props.onPress();
  assert.equal(f.calls.length, 1);
});
test('invalid values are reported beside fields and never saved', async () => {
  const f = formHarness(); const tree = f.render();
  await nodes(tree).find(n => n.props?.accessibilityLabel === '生成估算报告').props.onPress();
  assert.equal(f.calls.length, 0); assert.match(text(f.render()), /20–300 kg/);
});
const estimateAge = load('src/lib/healthAgeEstimate.ts').estimateHealthAge;
test('body age uses the actual profile age and preserves the existing adjustment', () => {
  assert.equal(estimateAge(28, 80, true, true), 22.8);
  assert.equal(estimateAge(45, 80, true, true), 39.8);
});
test('body age has no result for missing or invalid age, score or rhythm data', () => {
  assert.equal(estimateAge(null, 80, true, true), null);
  assert.equal(estimateAge(28, null, true, true), null);
  assert.equal(estimateAge(28, 80, false, false), null);
  assert.equal(estimateAge(28, NaN, true, true), null);
  assert.equal(estimateAge(17, 80, true, true), null);
});
test('late history loading does not overwrite user edits', async () => {
  const f = formHarness({ record: { id: 'old', inputs: { weight: 60, height: 170, age: 30, sex: 'female' }, metrics: [] } });
  let tree = f.render(); f.h.effects();
  nodes(tree).find(n => n.type === 'TextInput').props.onChangeText('57');
  await Promise.resolve(); tree = f.render();
  assert.equal(nodes(tree).find(n => n.type === 'TextInput').props.value, '57');
});
test('double submit creates only one report', async () => {
  const f = formHarness(); let tree = fill(f);
  const submit = nodes(tree).find(n => n.props?.accessibilityLabel === '生成估算报告').props.onPress;
  await Promise.all([submit(), submit()]); assert.equal(f.calls.length, 1);
});
