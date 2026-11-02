#!/usr/bin/env node
/**
 * Mira 自托管 OTA 发布脚本
 * ----------------------------------------------------------------------------
 * 作用：把当前 mira-app 的 iOS JS bundle 导出，托管到 data.lunamiraring.com 的
 *       /updates 路径下，并生成 expo-updates 经典 manifest。手机端 expo-updates
 *       启动时自动拉取，实现「改完 JS 推一条命令、真机免重装」。
 *
 * 前置条件（第二拍原生集成完成后才需要）：
 *   1) 已 `npx expo install expo-updates`，且原生已 bake 进 App
 *      （Info.plist 的 EXUpdatesURL 指向 https://data.lunamiraring.com/updates/manifest.json）
 *   2) app.json 的 expo.updates.runtimeVersion 与本脚本读取的版本一致
 *   3) 已能 `wrangler deploy` 部署 mira-ring-sync（CLOUDFLARE_API_TOKEN 可用）
 *
 * 用法（在 mira-app 根目录）：
 *   npm run publish-update
 *
 * 流程：expo export → 复制 bundle+assets 到 ../mira-ring-sync/public/updates
 *       → 写 manifest.json → wrangler deploy
 * --------------------------------------------------------------------------
 */

import { execSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WORKER_ROOT = process.env.MIRA_WORKER_ROOT
  || join(APP_ROOT, '..', 'mira-ring-sync'); // mira-ring-sync 与 mira-app 同级
const EXPORT_DIR = join(APP_ROOT, 'update-export');
const UPDATES_DIR = join(WORKER_ROOT, 'public', 'updates');
const MANIFEST_URL = 'https://data.lunamiraring.com/updates/manifest.json';

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function contentTypeFor(ext) {
  const map = {
    '.js': 'application/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf',
    '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// 读取 app.json 的 runtimeVersion，保证 manifest 与 App 一致
function readRuntimeVersion() {
  const appJson = JSON.parse(readFileSync(join(APP_ROOT, 'app.json'), 'utf8'));
  const rv = appJson?.expo?.updates?.runtimeVersion
    || appJson?.expo?.runtimeVersion
    || appJson?.expo?.version;
  if (!rv) throw new Error('无法从 app.json 读取 runtimeVersion，请在 expo.updates 中设置');
  return String(rv);
}

// 在导出目录里定位 iOS launch bundle（.js）
function findIosBundle() {
  const candidates = [
    join(EXPORT_DIR, 'ios', 'index.js'),
    join(EXPORT_DIR, 'ios-index.js'),
    join(EXPORT_DIR, 'index.ios.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // 兜底：扫描导出目录里最大的 .js
  let best = null, bestSize = -1;
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const fp = join(dir, e);
      const st = statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (extname(fp) === '.js' && st.size > bestSize) { bestSize = st.size; best = fp; }
    }
  };
  walk(EXPORT_DIR);
  return best;
}

console.log('[1/5] expo export (iOS)…');
execSync(
  `npx expo export --platform ios --output-dir "${EXPORT_DIR}" --non-interactive`,
  { cwd: APP_ROOT, stdio: 'inherit' },
);

console.log('[2/5] 读取 metadata + 定位 bundle…');
const metaPath = join(EXPORT_DIR, 'metadata.json');
if (!existsSync(metaPath)) throw new Error(`未找到 ${metaPath}`);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const bundleSrc = findIosBundle();
if (!bundleSrc) throw new Error('未找到 iOS launch bundle (.js)');
const runtimeVersion = readRuntimeVersion();
console.log(`       runtimeVersion=${runtimeVersion}, bundle=${basename(bundleSrc)}`);

console.log('[3/5] 复制 bundle + assets 到 public/updates…');
mkdirSync(join(UPDATES_DIR, 'assets'), { recursive: true });
const bundleDest = join(UPDATES_DIR, 'index.ios.js');
cpSync(bundleSrc, bundleDest);
const bundleHash = sha256(bundleDest);

const assets = [];
const fileMeta = meta.fileMetadata?.ios || {};
const assetList = fileMeta.assets || [];
for (const a of assetList) {
  const src = join(EXPORT_DIR, a.path || a.key || '');
  if (!existsSync(src)) { console.warn(`       ⚠️ 跳过缺失 asset: ${a.path}`); continue; }
  const ext = extname(src);
  const hash = a.hash || sha256(src);
  const dest = join(UPDATES_DIR, 'assets', `${hash}${ext}`);
  cpSync(src, dest);
  assets.push({
    hash,
    key: a.key || hash,
    contentType: a.contentType || contentTypeFor(ext),
    url: `${new URL(MANIFEST_URL).origin}/updates/assets/${hash}${ext}`,
  });
}

console.log('[4/5] 生成 manifest.json…');
const manifest = {
  id: createHash('sha256').update(`${runtimeVersion}:${Date.now()}`).digest('hex').slice(0, 32),
  createdAt: new Date().toISOString(),
  runtimeVersion,
  launchAsset: {
    hash: bundleHash,
    key: 'bundle',
    contentType: 'application/javascript',
    url: `${new URL(MANIFEST_URL).origin}/updates/index.ios.js`,
  },
  assets,
};
writeFileSync(join(UPDATES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`       launchAsset=${manifest.launchAsset.url} (${assets.length} 个资源)`);

console.log('[5/5] wrangler deploy（部署 mira-ring-sync，含 /updates 静态资源）…');
execSync('npx wrangler deploy', { cwd: WORKER_ROOT, stdio: 'inherit' });

console.log('\n✅ OTA 发布完成。手机下次启动会拉取新 bundle（runtimeVersion=%s）。', runtimeVersion);
console.log('   如需立刻生效：手机杀掉 App 重开即可（EXUpdatesCheckOnLaunch=ALWAYS）。');
