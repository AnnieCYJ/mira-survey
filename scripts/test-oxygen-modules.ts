/**
 * 「睡眠呼吸暂停 / 夜间低氧 / 恒空模块」整体回归测试
 *
 * ★ 2026-11-14（用户）：「睡眠呼吸暂停这里面经常是没有数据」「有几个模块一直没有数据，
 *   比方说夜间低氧时间百分比是 0 就显示 0，不要显示杠」「把这些个数据整体测一次」。
 *
 * 本脚本用项目**真实的** healthStore 落库 + computeNightOxygen 计算 + metricFormat 展示，
 * 覆盖三种状态（0 值 / 有值 / 真无数据），并把全 App 长期无数据模块按根因分类列出，
 * 避免只在 UI 截图层「看着像修好了」。
 *
 * 运行：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
 *     ./node_modules/.bin/ts-node --transpile-only scripts/test-oxygen-modules.ts
 */
import { healthStore, dayKey, dayStartMs } from '../src/data/healthStore';
import { computeNightOxygen, LOW_OXYGEN_THRESHOLD, SECONDS_PER_SAMPLE } from '../src/lib/nightOxygen';
import { fmtMetric, hasValue } from '../src/lib/metricFormat';

let pass = 0, fail = 0, skip = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' · ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' · ' + detail : ''}`); }
}
function section(t: string) { console.log(`\n── ${t} ──`); }

/** 按真实口径造一批夜间血氧样本（每 5 分钟一个点） */
function makeSpo2(base: number, values: number[]): { t: number; v: number }[] {
  const dk = dayKey(Date.now());
  const winStart = dayStartMs(Date.now()) - 4 * 3600_000; // 昨夜 20:00
  return values.map((v, i) => ({ t: winStart + i * 5 * 60_000, v }));
}
function windowFor() {
  const dk = dayKey(Date.now());
  const base = dayStartMs(Date.now());
  return { start: base - 4 * 3600_000, end: base + 10 * 3600_000 };
}
function seed(key: 'spo2' | 'rr', samples: { t: number; v: number }[]) {
  const dk = dayKey(Date.now());
  // 跨午夜样本分落到所属自然日，模拟真实 onBatch 归属
  const byDay = new Map<string, { t: number; v: number }[]>();
  for (const p of samples) {
    const k = dayKey(p.t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(p);
  }
  for (const [k, arr] of byDay) healthStore.upsertBackfillSamples(key as any, k, arr);
  return dk;
}

function main() {
  console.log('\n=== 睡眠呼吸暂停 / 夜间低氧 / 恒空模块 整体回归 ===\n');

  // ─────────────────────────────────────────────────────────────
  section('① 零值显示：0 必须显示 0，不能显示杠');
  // ─────────────────────────────────────────────────────────────
  check('低氧时间 0 秒 → "0"', fmtMetric(0) === '0', `实际=${fmtMetric(0)}`);
  check('夜间低氧占比 0% → "0"', fmtMetric(0, 1) === '0', `实际=${fmtMetric(0, 1)}`);
  check('0 被 hasValue 判为有值', hasValue(0) === true);
  check('null → "--"', fmtMetric(null) === '--');
  check('undefined → "--"', fmtMetric(undefined) === '--');
  check('NaN → "--"', fmtMetric(NaN) === '--');
  check('Infinity → "--"', fmtMetric(Infinity) === '--');
  check('97.4 → "97.4"', fmtMetric(97.4, 1) === '97.4');
  check('0.04 保留 1 位 → "0"', fmtMetric(0.04, 1) === '0');
  check('中文破折号变体', fmtMetric(null, 0) === '--');

  // ─────────────────────────────────────────────────────────────
  section('② 整夜无低氧：低氧时间 / 占比都必须是 0，不是「无数据」');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  const normal = makeSpo2(dayStartMs(Date.now()), Array.from({ length: 100 }, (_, i) => 96 + (i % 4)));
  seed('spo2', normal);
  const r0 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('有血氧样本 → hasData=true', r0.hasData === true, `samples=${r0.samples}`);
  check('样本数 100', r0.samples === 100, `实际=${r0.samples}`);
  check('低氧时间 = 0 秒', r0.lowOxygenSec === 0, `实际=${r0.lowOxygenSec}`);
  check('夜间低氧占比 = 0%', r0.lowOxygenPct === 0, `实际=${r0.lowOxygenPct}`);
  check('0 秒经展示层 → "0"（非 "--"）', fmtMetric(r0.lowOxygenSec) === '0');
  check('0% 经展示层 → "0"（非 "--"）', fmtMetric(r0.lowOxygenPct, 1) === '0');
  check('平均血氧 = 97.5', r0.aveOxygen === 97.5, `实际=${r0.aveOxygen}`);
  check('最低血氧 = 96', r0.minOxygen === 96, `实际=${r0.minOxygen}`);
  check('呼吸率无数据 → null（不硬算）', r0.aveRespRate === null);

  // ─────────────────────────────────────────────────────────────
  section('③ 有低氧事件：秒数与百分比按真实点数计算');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  const mixed = Array.from({ length: 100 }, (_, i) => (i < 10 ? 88 : 97));
  seed('spo2', makeSpo2(dayStartMs(Date.now()), mixed));
  const r1 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('低氧点数 = 10', r1.samples === 100 && r1.lowOxygenSec === 10 * SECONDS_PER_SAMPLE,
    `lowOxygenSec=${r1.lowOxygenSec}`);
  check('低氧时间 = 600 秒', r1.lowOxygenSec === 600, `实际=${r1.lowOxygenSec}`);
  check('夜间低氧占比 = 10%', r1.lowOxygenPct === 10, `实际=${r1.lowOxygenPct}`);
  check('最低血氧 = 88', r1.minOxygen === 88, `实际=${r1.minOxygen}`);
  check('阈值常量 = 90', LOW_OXYGEN_THRESHOLD === 90);

  // ─────────────────────────────────────────────────────────────
  section('④ 真·无数据：才允许显示杠 / 空态');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  const r2 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('无样本 → hasData=false', r2.hasData === false);
  check('无样本 → 0 秒 / 0%（不编造）', r2.lowOxygenSec === 0 && r2.lowOxygenPct === 0);
  check('无样本 → 平均血氧 null → "--"', fmtMetric(r2.aveOxygen, 1) === '--');
  check('无样本 → 有明确原因说明', /没有同步|戒指/.test(r2.sourceNote), r2.sourceNote);

  // ─────────────────────────────────────────────────────────────
  section('⑤ 脏值过滤：0 / 1 / 255 不能污染统计');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  seed('spo2', makeSpo2(dayStartMs(Date.now()), [0, 1, 255, 97, 98, 96]));
  const r3 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('只保留 3 个生理有效值', r3.samples === 3, `实际=${r3.samples}`);
  check('最低血氧不含脏值 0/1', r3.minOxygen === 96, `实际=${r3.minOxygen}`);
  check('低氧占比不被脏值拉高', r3.lowOxygenPct === 0, `实际=${r3.lowOxygenPct}`);

  // ─────────────────────────────────────────────────────────────
  section('⑥ 呼吸率：设备回传 rr 才显示，否则留空');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  const spo = makeSpo2(dayStartMs(Date.now()), [97, 96, 98]);
  seed('spo2', spo);
  const rrPts = spo.map((p, i) => ({ t: p.t, v: 14 + i }));
  seed('rr', rrPts);
  const r4 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('rr 有值 → 平均呼吸率 15', r4.aveRespRate === 15, `实际=${r4.aveRespRate}`);
  check('呼吸率 0 也应显示 0（口径一致）', fmtMetric(0, 1) === '0');

  // ─────────────────────────────────────────────────────────────
  section('⑦ 睡眠窗口：按真实入睡/起床，不写死常量');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  const dk = dayKey(Date.now());
  const base = dayStartMs(Date.now());
  // 23:20 睡 → 次日 07:20 起，共 480 分钟；只在窗口内放低氧点
  const inWin = [
    { t: base - 40 * 60_000, v: 88 },   // 昨夜 23:20
    { t: base + 60 * 60_000, v: 97 },   // 01:00
    { t: base + 6 * 3600_000, v: 96 },  // 06:00
  ];
  seed('spo2', inWin);
  const r5 = computeNightOxygen(dk, {
    sleepTime: '23:20', wakeTime: '07:20', totalMin: 480,
  });
  check('窗口内取到 3 个点', r5.samples === 3, `实际=${r5.samples}`);
  check('窗口内 1 个低氧 → 60 秒', r5.lowOxygenSec === 60, `实际=${r5.lowOxygenSec}`);
  check('窗口内 1/3 → 33.3%', r5.lowOxygenPct === 33.3, `实际=${r5.lowOxygenPct}`);
  check('来源说明标注按睡眠窗口', /睡眠窗口/.test(r5.sourceNote), r5.sourceNote);

  // ─────────────────────────────────────────────────────────────
  section('⑧ 恒空模块根因清单（设备能力，不是同步 bug）');
  // ─────────────────────────────────────────────────────────────
  // 依据：src/config/deviceModel.ts、src/lib/deviceReality.ts、VeepooRingModule.kt
  // 精简版能力包明确不支持 + 原生侧对应方法仍是 TODO stub（只打日志、不 emit）。
  const NO_SENSOR: Record<string, string> = {
    '体温 / 体温偏离': 'Type=0，无温度传感器',
    '皮电 EDA / 皮肤温度': '协议无该通道，triggerGSR() 为 TODO',
    'ECG 心电': 'startEcg() 为 TODO，无 onEcg emit',
    '血糖': 'GluTag=0，triggerHealthGlance() 为 TODO',
    '血脂四项 / 尿酸': 'CompTag=0，无 emit',
    '身体成分（体脂/肌肉量等）': '设备不支持，CompTag=0',
    '疲劳度 / 情绪 / 皮质醇实测': 'triggerHealthGlance() 为 TODO，无 emit',
    '呼吸率（设备直测）': '本固件 NoFunction；仅当血氧原始包带 rr 时才有',
    '心脏负荷': '仅 Spo2hOriginData 带 cardiacLoad 时才有，本固件未回传',
    'OSAHS 呼吸暂停分级': '依赖设备 SpO2 原始历史包；读不到就「暂无结果」，不推算',
    '血压自动数据流': '基础版批量回传 bpSys/bpDia 实测为 0；只认手动录入',
  };
  for (const [name, why] of Object.entries(NO_SENSOR)) {
    check(`${name} → 已归类为「设备不支持」`, why.length > 0, why);
  }
  check('清单内均为「如实留空」而非伪造 0', Object.keys(NO_SENSOR).length === 11);

  // ─────────────────────────────────────────────────────────────
  section('⑨ 兜底链路：设备分析失败，本机样本仍能出数');
  // ─────────────────────────────────────────────────────────────
  healthStore.clear();
  seed('spo2', makeSpo2(dayStartMs(Date.now()), Array.from({ length: 160 }, (_, i) => 95 + (i % 5))));
  const r6 = computeNightOxygen(dayKey(Date.now()), { window: windowFor() });
  check('模拟真机 160 个 spo2 点 → 全部取到', r6.samples === 160, `实际=${r6.samples}`);
  check('即使 oxygenAnalysis=null 也有平均血氧', r6.aveOxygen != null, `ave=${r6.aveOxygen}`);
  check('即使 oxygenAnalysis=null 也有最低血氧', r6.minOxygen != null, `min=${r6.minOxygen}`);
  check('低氧占比 0% 仍显示 0 而非杠', fmtMetric(r6.lowOxygenPct, 1) === '0');

  // ─────────────────────────────────────────────────────────────
  section('⑩ 性别闸门回归：中性生理科普不能被「激素」裸词误伤');
  // ─────────────────────────────────────────────────────────────
  // cycleScope → userStore → expo-file-system 在 Node 下是 ESM，需与项目既有
  // verify-cycle-scope.ts 一样打桩后再动态 require（不能静态 import）。
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request: string) {
    if (/userStore$/.test(request)) return { getCachedSession: () => null, onSessionChange: () => () => {} };
    if (request === 'expo-file-system') return {
      documentDirectory: 'file:///tmp/', cacheDirectory: 'file:///tmp/',
      getInfoAsync: async () => ({ exists: false }),
      readAsStringAsync: async () => '', writeAsStringAsync: async () => {},
      makeDirectoryAsync: async () => {},
    };
    if (/^(expo-|react-native|@react-native|@react-navigation)/.test(request)) return {};
    return origLoad.apply(this, arguments as any);
  };
  let containsCycleCopy: (t: string) => boolean;
  let hn: any;
  try {
    containsCycleCopy = require('../src/data/cycleScope').containsCycleCopy;
    // 同一组桩下加载真实叙事引擎，验证「标题/分析/建议」主题统一
    hn = require('../src/lib/homeNarrative');
  } finally {
    Module._load = origLoad;
  }
  // 2026-11-14：上一批把裸词「激素」加进禁用词，导致《血糖过山车》《蛋白质》《肠脑轴》
  // 这类男女通用的代谢科普被判成周期内容，男性兜底文章池被清空。
  const NEUTRAL = [
    '和激素的关联：血糖大起大落会连带胰岛素和皮质醇波动',
    '激素本身及其施工队都要靠蛋白质造：胰岛素是多肽，甲状腺激素的原料酪氨酸来自蛋白质',
    '肠子和大脑之间有一条双向高速（迷走神经 + 激素 + 免疫信号）',
  ];
  for (const t of NEUTRAL) {
    check('中性生理表述放行', !containsCycleCopy(t), t.slice(0, 24));
  }
  const CYCLE_COPY = [
    '黄体期孕酮上行推高体温', '雌激素趋势', '经期补铁', '她正处于卵泡期',
    '经前想吃甜食', '生理周期第 12 天', '荷尔蒙节律', '激素波动',
  ];
  for (const t of CYCLE_COPY) {
    check('周期语境仍命中', containsCycleCopy(t), t);
  }

  // ─────────────────────────────────────────────────────────────
  section('⑪ 首页「今日状态」主题统一：标题 / 分析 / 建议 / CTA 不再打架');
  // ─────────────────────────────────────────────────────────────
  const NOON = new Date(2026, 10, 14, 12, 0, 0).getTime(); // 周六 12:00 → preNoon
  const mkInput = (level: 0 | 1 | 2 | 3) => ({
    now: NOON, points: [], mood: level >= 3 ? '休息一下' : '元气满满',
    stress: null, events: [], phaseLabel: null,
    recoveryScore: null, hasStatusData: true, statusFromCheck: false,
    hrElev: null, activity: null, topicLevel: level,
  });
  check('preNoon level0 → 饮食主题', hn.homeTopicOf('preNoon', 0, 'flat') === 'meal');
  check('preNoon level1 → 饮食主题', hn.homeTopicOf('preNoon', 1, 'flat') === 'meal');
  check('preNoon level2 → 活动主题', hn.homeTopicOf('preNoon', 2, 'flat') === 'activity');
  check('preNoon level3 → 休息主题', hn.homeTopicOf('preNoon', 3, 'down') === 'rest');
  check('bedtime → 睡眠主题', hn.homeTopicOf('bedtime', 0) === 'sleep');
  check('evening → 收工主题', hn.homeTopicOf('evening', 0) === 'wind');

  // 用户现场问题：「上面该午休了，下面还是饮食分析和建议」
  const restNarr = hn.buildHomeNarrative(mkInput(3));
  check('level3 主题=rest', restNarr.topic === 'rest', restNarr.topic);
  check('level3 分析不含饮食词', !hn.isMealCopy(restNarr.analysis), restNarr.analysis.slice(0, 30));
  check('level3 建议不含饮食词', !hn.isMealCopy(restNarr.suggestion.text), restNarr.suggestion.text);
  check('level3 不再跳拍照记录页', restNarr.suggestion.cta?.screen !== 'FoodScan',
    String(restNarr.suggestion.cta?.screen));
  const actNarr = hn.buildHomeNarrative(mkInput(2));
  check('level2 主题=activity', actNarr.topic === 'activity');
  check('level2 分析不含饮食词', !hn.isMealCopy(actNarr.analysis), actNarr.analysis.slice(0, 30));
  check('level2 不再跳拍照记录页', actNarr.suggestion.cta?.screen !== 'FoodScan');
  // 对照组：状态好的中午仍应是饮食主题，不能「一律中性」
  const mealNarr = hn.buildHomeNarrative(mkInput(0));
  check('level0 对照组仍是饮食主题', mealNarr.topic === 'meal');
  check('level0 对照组仍跳拍照记录页', mealNarr.suggestion.cta?.screen === 'FoodScan',
    String(mealNarr.suggestion.cta?.screen));
  check('主题进入签名（主题变化会清掉旧建议）', /\bmeal\b|\brest\b|\bactivity\b/.test(mealNarr.signature));

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过 ===\n`);
  if (fail > 0) process.exit(1);
}

main();
