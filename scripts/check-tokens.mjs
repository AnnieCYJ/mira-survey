#!/usr/bin/env node
/**
 * Mira Design Token 门禁（lint gate）
 * ---------------------------------------------------------------------------
 * 防止「组件层裸值」回潮。CI / pre-commit 调用：
 *   node scripts/check-tokens.mjs
 * 退出码 0 = 通过；1 = 发现违禁裸值（打印位置，不自动改）。
 *
 * 规则（与 docs/audit/02-design-token-final.md 一致）：
 *   1. 裸白/黑字面量（深底场景）：'#fff' '#FFFFFF' '#fff' '#000' '#000000'
 *      —— 这些在样式属性上应走 theme.colors.* / theme.colors.ui.*
 *   2. 裸 rgba 白阶：rgba(255,255,255,*) 与 rgba(0,0,0,*) 字面量
 *      —— 应走 theme.colors.ui.whiteXX / shadow*
 *   3. borderRadius 裸数字（>0 且 <1000 的整数/小数，非 token）：应走 theme.radius.*
 *      —— 但放行常见语义常量（pill=999 / 0 / 9999 等明确意图值交由人工复核，仅告警不拦）
 *
 * 故意放行：
 *   - *.svg 资源文件、node_modules、/e2e、venv
 *   - 颜色哈希/品牌渐变（如 '#9D8AF0' 等具体色相）—— 由 colour-token 审查单独处理
 *   - 已使用 theme.* 的写法
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const SKIP = /(node_modules|\.git|dist|build|e2e|venv|\.svg$)/;

// 裸白/黑（仅当出现在「样式属性值」位置才算违禁）
const BARE_WHITE_BLACK =
  /\b(?:color|backgroundColor|borderColor|shadowColor|tintColor|textShadowColor|textDecorationColor)\s*:\s*['"]#(?:fff|ffffff|FFF|FFFFFF|000|000000)\b['"]/g;

// 裸 rgba 白/黑字面量（任意位置）
const BARE_RGBA =
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[\d.]+\s*\)|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/g;

// borderRadius 裸数字（排除 0 / 999 / 9999 这种明确意图值）
const BARE_RADIUS =
  /\bborderRadius\s*:\s*(\d+(?:\.\d+)?)\b(?![\s,]*\*\/)/g;

const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (SKIP.test(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(p);
  }
}
walk(SRC);

const violations = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const check = (re, kind) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const lineNo = src.slice(0, m.index).split('\n').length;
      const col = m.index - src.lastIndexOf('\n', m.index - 1);
      violations.push({ file: path.relative(ROOT, file), line: lineNo, col, kind, text: m[0].slice(0, 48) });
    }
  };
  check(BARE_WHITE_BLACK, 'bare-white-black');
  check(BARE_RGBA, 'bare-rgba');
  check(BARE_RADIUS, 'bare-radius');
}

// bare-radius 仅告警（不拦），其余拦
const hard = violations.filter((v) => v.kind !== 'bare-radius');
const soft = violations.filter((v) => v.kind === 'bare-radius');

if (hard.length) {
  console.error(`\n❌ Design token 门禁未通过：${hard.length} 处裸色/裸 rgba 违禁\n`);
  for (const v of hard) console.error(`  ${v.file}:${v.line}:${v.col}  [${v.kind}]  ${v.text}`);
} else {
  console.log(`\n✅ 无裸白/黑/裸 rgba 违禁（扫描 ${files.length} 文件）`);
}

if (soft.length) {
  console.warn(`\n⚠️  ${soft.length} 处 borderRadius 裸数字（仅提醒，不阻断）：`);
  for (const v of soft.slice(0, 40)) console.warn(`  ${v.file}:${v.line}  ${v.text}`);
}

process.exit(hard.length ? 1 : 0);
