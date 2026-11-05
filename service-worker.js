// ===== EduPuzzle Service Worker：PWA 离线缓存 =====
// 策略：
//   · 安装时预缓存「核心资源」（页面、脚本、样式库、图标），装好后断网也能打开
//   · OCR 引擎和语言包（约 12 MB）第一次用到时再缓存，避免手机安装时一次下太多
//   · 同源请求先用缓存秒开，同时后台更新缓存（下次打开就是新版）
//   · AI 接口等跨域请求不经过缓存
// 发布新版本时把 VERSION 改一下，旧缓存会被自动清掉。

const VERSION = 'edupuzzle-v4.0.1';

const CORE = [
  './', 'index.html', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'lib/tailwind.js', 'lib/pdfjs/pdf.min.js', 'lib/pdfjs/pdf.worker.min.js', 'lib/mammoth.browser.min.js',
  'lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js',
  'js/courses.js', 'js/outlines.js', 'js/app.js', 'js/db.js', 'js/parser.js', 'js/dashboard.js', 'js/course.js',
  'js/exam.js', 'js/templates.js', 'js/ocr.js', 'js/words.js', 'js/settings.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

// 激活时删除旧版本缓存
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;   // 跨域（AI 接口）直接走网络

  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }       // 有缓存：立即返回，后台更新
    const res = await network;
    if (res) return res;
    // 断网且没缓存：打开页面时退回首页
    if (req.mode === 'navigate') return cache.match('index.html');
    return new Response('离线状态下无法获取：' + req.url, { status: 503 });
  }));
});
