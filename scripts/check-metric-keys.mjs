#!/usr/bin/env node
/**
 * ★ v18.134（审查 04 🔴-1 配套自检）：原生 emitMetric key ↔ JS 规范 MetricKey 一致性校验。
 *
 * 背景：「key 不一致被 TS 静默丢弃」曾两次成真（39℃ 体温脏值、洞察页交感神经空卡）。
 * 本脚本扫描 ios/VeepooRing/VeepooRing.m 里所有 emitMetric 调用的 key，与
 * src/data/metricKeyMap.ts 的映射结果比对：任何一个原生 key 若 hsKeyFor 返回 null
 * （即未在 healthStore.ALL_METRIC_KEYS / 别名表登记），立即失败退出。
 *
 * 用法：node scripts/check-metric-keys.mjs   （CI / 提交前手动跑）
 * 退出码：0 = 全部已登记；1 = 存在未登记 key。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 轻量解析 metricKeyMap.ts / healthStore.ts，避免引 TS 运行时 ──
// 1) 规范 key：healthStore.ts 的 MetricKey 类型联合
const hsSrc = readFileSync(join(root, 'src/data/healthStore.ts'), 'utf8');
const typeBlock = hsSrc.match(/export type MetricKey\s*=\s*([\s\S]*?);/);
if (!typeBlock) { console.error('❌ 无法从 healthStore.ts 解析 MetricKey 联合类型'); process.exit(1); }
const REGISTERED = new Set([...typeBlock[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));

// 2) 别名表：metricKeyMap.ts 的 ALIAS_TO_HS（key: 'value', 形式）
const mapSrc = readFileSync(join(root, 'src/data/metricKeyMap.ts'), 'utf8');
const aliasBlock = mapSrc.match(/const ALIAS_TO_HS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
const ALIASES = new Map();
if (aliasBlock) {
  for (const m of aliasBlock[1].matchAll(/([a-zA-Z]+):\s*'([a-zA-Z]+)'/g)) ALIASES.set(m[1], m[2]);
}

function hsKeyFor(k) {
  if (ALIASES.has(k)) return ALIASES.get(k);
  return REGISTERED.has(k) ? k : null;
}

// ── 扫描 iOS 原生桥里的 emitMetric key（递归 ios/ 全目录）──
const nativeKeys = new Set();
const scanDir = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'build' || name === 'Pods') continue; // 构建产物 / CocoaPods 不扫
    try {
      if (readdirSync(p)) { scanDir(p); continue; } // 目录 → 递归
    } catch { /* 非目录 → 当文件处理 */ }
    if (name.endsWith('.m') || name.endsWith('.swift')) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/emitMetric\s*:\s*@"([a-zA-Z]+)"/g)) nativeKeys.add(m[1]);
      for (const m of src.matchAll(/emitMetric\(\s*"([a-zA-Z]+)"/g)) nativeKeys.add(m[1]);
    }
  }
};
scanDir(join(root, 'ios'));

console.log(`规范 key ${REGISTERED.size} 个；显式别名 ${ALIASES.size} 个；原生 emitMetric key ${nativeKeys.size} 个`);
let bad = 0;
for (const k of [...nativeKeys].sort()) {
  const hk = hsKeyFor(k);
  if (!hk) { console.error(`  ❌ "${k}" 未登记（hsKeyFor → null，运行时会静默丢弃）`); bad++; }
  else if (hk !== k) console.log(`  ↪️ "${k}" → "${hk}"（别名映射）`);
}
if (bad > 0) {
  console.error(`\n❌ ${bad} 个原生 key 未在 JS 侧登记。请按 metricKeyMap.ts 文件头的三步补齐。`);
  process.exit(1);
}
console.log('\n✅ 全部原生 emitMetric key 均可映射到 healthStore 规范 key。');
