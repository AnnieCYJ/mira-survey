#!/usr/bin/env node
/**
 * Android 更新包发布脚本（配套设置页「检查更新」）
 * ---------------------------------------------------------------------------
 * 把当前 debug APK + 版本清单生成到 dist-update/，两个文件放到下面两个位置：
 *
 *   ① update.json（几百字节）→ 任意公网可读静态托管
 *      推荐复用已有 Worker：../mira-ring-sync/public/mira-app/update.json
 *      对应地址：https://data.lunamiraring.com/mira-app/update.json
 *      （即 src/config.ts 的 UPDATE_MANIFEST_URL）
 *
 *   ② mira-app-<version>.apk（体积大）→ 对象存储 / 本地 HTTP 服务
 *      APK 不放 Worker 静态资源（单文件有体积上限），由 update.json 里的 apkUrl 指向。
 *      可选：Cloudflare R2（免费 10GB）、GitHub Release、或 Mac 上起个 HTTP 服务同 WiFi 下载。
 *
 * 用法：
 *   # 本地同 WiFi 验证（最快）
 *   node scripts/publish-apk-update.mjs --base-url http://192.168.1.5:8765
 *   python3 -m http.server 8765 --directory dist-update
 *   adb reverse tcp:8765 tcp:8765     # 手机访问 127.0.0.1:8765 即可打到 Mac
 *
 *   # 正式发布（清单写进 Worker public 目录，APK 上传到对象存储）
 *   node scripts/publish-apk-update.mjs \
 *     --apk-url https://<你的对象存储>/mira-app-1.1.0-2.apk \
 *     --notes "回填通路修复 + 设置页检查更新" \
 *     --deploy-manifest
 *   cd ../mira-ring-sync && npx wrangler deploy
 *
 * 版本号：脚本会校验 src/version.ts 与 android/app/build.gradle 一致，不一致直接报错。
 * 每发一版，把两处 versionCode 一起 +1（Android 覆盖安装要求单调递增），versionName 可不变。
 * ---------------------------------------------------------------------------
 */

import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const APK_SRC = join(APP_ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const GRADLE = join(APP_ROOT, 'android/app/build.gradle');
const VERSION_TS = join(APP_ROOT, 'src/version.ts');
const WORKER_PUBLIC = join(APP_ROOT, '..', 'mira-ring-sync', 'public', 'mira-app');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : true;
}

function gradleField(src, field) {
  // 注意：[\d.]+ 必须优先于 \d+，否则 "1.1.0" 会被截成 "1"
  const m = src.match(new RegExp(`\\b${field}\\s+["']?([\\d.]+)["']?`));
  if (!m) throw new Error(`build.gradle 里找不到 ${field}`);
  return m[1];
}
function tsConst(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*['"]?([^'";\\n]+)['"]?`));
  if (!m) throw new Error(`src/version.ts 里找不到 ${name}`);
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}
async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

const gradle = readFileSync(GRADLE, 'utf8');
const versionTs = readFileSync(VERSION_TS, 'utf8');
const versionCode = Number(gradleField(gradle, 'versionCode'));
const versionName = gradleField(gradle, 'versionName');
const jsCode = Number(tsConst(versionTs, 'APP_VERSION_CODE'));
const jsName = tsConst(versionTs, 'APP_VERSION_NAME');

if (jsCode !== versionCode || jsName !== versionName) {
  console.error('❌ 版本号不一致，已中止：');
  console.error(`   build.gradle      versionCode=${versionCode} versionName=${versionName}`);
  console.error(`   src/version.ts   APP_VERSION_CODE=${jsCode} APP_VERSION_NAME=${jsName}`);
  console.error('   请改一致后再发布（两处一起 +1，Android 覆盖安装要求 versionCode 递增）。');
  process.exit(1);
}

if (!existsSync(APK_SRC)) {
  console.error(`❌ 找不到 APK：${APK_SRC}\n   先跑一次 android/gradlew assembleDebug --offline`);
  process.exit(1);
}

const outDir = String(arg('out', join(APP_ROOT, 'dist-update')));
const apkName = `mira-app-${versionName}-${versionCode}.apk`;
const apkDest = join(outDir, apkName);
mkdirSync(outDir, { recursive: true });

const noCopy = !!arg('no-copy'); // APK 已在对象存储 / 本地服务目录时，只算哈希不重复复制几百 MB
console.log(noCopy ? '[1/3] 跳过复制（--no-copy）' : `[1/3] 复制 APK → ${apkDest}`);
if (!noCopy && APK_SRC !== apkDest) copyFileSync(APK_SRC, apkDest);
const hashSrc = noCopy ? APK_SRC : apkDest;
const sizeBytes = statSync(hashSrc).size;

console.log('[2/3] 计算 SHA-256…');
const sha256 = await sha256File(hashSrc);

const baseUrl = arg('base-url');
let apkUrl = arg('apk-url');
if (!apkUrl && baseUrl) apkUrl = `${String(baseUrl).replace(/\/$/, '')}/${apkName}`;
if (!apkUrl) {
  console.error('❌ 需要指定 APK 的下载地址：--apk-url <URL> 或 --base-url <本地/对象存储根地址>');
  console.error('   （已生成 APK，补上参数重跑即可，不会重新复制大文件）');
  process.exit(1);
}

const manifest = {
  versionCode,
  versionName,
  apkUrl,
  sizeBytes,
  sha256,
  notes: String(arg('notes', '') || ''),
  releasedAt: new Date().toISOString(),
};
const manifestPath = join(outDir, 'update.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`[3/3] 清单 → ${manifestPath}`);
console.log(`       versionCode=${versionCode} · ${(sizeBytes / 1048576).toFixed(0)} MB · apkUrl=${apkUrl}`);

if (arg('deploy-manifest')) {
  mkdirSync(WORKER_PUBLIC, { recursive: true });
  const dest = join(WORKER_PUBLIC, 'update.json');
  writeFileSync(dest, JSON.stringify(manifest, null, 2));
  console.log(`       已写入 Worker public → ${dest}`);
  console.log('       接着跑：cd ../mira-ring-sync && npx wrangler deploy');
}

console.log('\n下一步（两件事，缺一不可）：');
console.log(`  ① 清单：把 ${basename(manifestPath)} 放到 https://data.lunamiraring.com/mira-app/update.json`);
console.log(`     cp "${manifestPath}" "${join(WORKER_PUBLIC, 'update.json')}" && cd ../mira-ring-sync && npx wrangler deploy`);
console.log(`  ② APK：把 ${apkName} 上传到 ${apkUrl}`);
console.log('     本地最快：python3 -m http.server 8765 --directory dist-update');
console.log('     然后 adb reverse tcp:8765 tcp:8765，手机点「检查更新」即可验证。');
console.log('\n⚠️ 当前 APK 约 341 MB：llama.cpp 的 .so 仍打进 4 个 ABI（实测 build.gradle');
console.log('   现有的 ndk.abiFilters 没有过滤掉预编译 .so）。正式高频发版前建议改用');
console.log('   splits { abi { enable true; reset(); include "arm64-v8a"; universalApk false } }');
console.log('   只出 arm64 包（可省约 170 MB），或改走 JS bundle OTA（只下发几 MB）。');
