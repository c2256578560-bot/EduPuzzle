// ===== 把网页源码复制到 dist/ =====
// 三个产物共用这一份 dist：
//   · Tauri 打包 EXE 时把 dist 嵌进程序（tauri.conf.json → frontendDist）
//   · GitHub Pages 部署 dist（PWA 主程序 + download.html 分享页 + release/ 下的 EXE）
// 用法：node scripts/build-web.mjs            → 网页 / PWA / Pages 用（含 release/）
//       node scripts/build-web.mjs --tauri    → 打包 EXE 用（不含 release/，避免把 EXE 塞进 EXE）
// 只用 Node 自带模块，不需要 npm install。

import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const forTauri = process.argv.includes('--tauri');

// 要发布的文件 / 文件夹（新增静态资源时加到这里）
const ITEMS = ['index.html', 'download.html', 'manifest.json', 'service-worker.js', 'js', 'lib', 'icons', '示例资料', 'docs/screenshots'];
if (!forTauri) ITEMS.push('release');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const item of ITEMS) {
  const src = join(root, item);
  if (!existsSync(src)) { console.log('跳过（不存在）：' + item); continue; }
  cpSync(src, join(dist, item), { recursive: true });
  console.log('已复制：' + item);
}
console.log(`完成 → ${dist}${forTauri ? '（Tauri 模式）' : ''}`);
