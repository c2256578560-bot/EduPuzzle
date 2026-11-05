// ===== 公共工具 + AI 调用 + 学习统计 + 页面路由 + 启动 =====

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 把文字转义后再塞进 HTML，防止资料里的 < > 破坏页面
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bg-red-500', !!err);
  t.classList.toggle('bg-slate-800', !err);
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), err ? 4000 : 2000);
}

async function copyText(text) {
  if (!text) return toast('没有可复制的内容', true);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('已复制到剪贴板');
}

function download(name, text, type = 'text/markdown') {
  if (!text) return toast('没有可导出的内容', true);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ===== AI 调用（OpenAI 兼容接口，组卷和 OCR 整理共用）=====
const DEFAULT_AI = { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: '' };

async function aiChat(prompt) {
  const cfg = LS.get('aiConfig', DEFAULT_AI);
  if (!cfg.key) throw new Error('请先在「设置」页填写 AI 接口的 API Key');
  const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.7 }),
  });
  if (!res.ok) {
    const hint = { 401: 'API Key 无效或已过期，请到「设置」页检查', 402: 'AI 账户余额不足，请充值', 429: '请求太频繁，请稍后再试' }[res.status];
    throw new Error(hint ? `${hint}（${res.status}）` : `AI 接口返回 ${res.status}：${(await res.text()).slice(0, 150)}`);
  }
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// 模型有时会包一层 ```json``` 或加说明文字，只截取最外层括号里的部分
function parseAIJson(text, open = '{', close = '}') {
  try { return JSON.parse(text.slice(text.indexOf(open), text.lastIndexOf(close) + 1)); }
  catch { throw new Error('AI 返回的不是有效 JSON，请重试'); }
}

// ===== 学习统计：按日期记录专注分钟、刷题数 =====
const today = (d = new Date()) => d.toLocaleDateString('sv');   // 2026-11-05 格式
const Stats = {
  add(key, n) {
    const all = LS.get('stats', {});
    const d = all[today()] ||= {};
    d[key] = (d[key] || 0) + n;
    LS.set('stats', all);
  },
  get(date = today()) { return LS.get('stats', {})[date] || {}; },
};

// ===== 运行环境 =====
// lib/ 下文件的绝对地址。Tesseract、pdf.js 在 Worker 里加载文件，必须给绝对地址，
// 这样在 GitHub Pages 子目录、本地服务器、Tauri（http://tauri.localhost）里都能找到。
const libUrl = path => new URL('lib/' + path, location.href).href;

// Tauri 桌面版：资源已打包进 EXE，不需要 Service Worker
const IS_TAURI = location.hostname === 'tauri.localhost' || location.protocol === 'tauri:';

// 注册 Service Worker（PWA 离线缓存）。只在 https / localhost 下可用，双击打开 html（file://）时跳过
function registerSW() {
  if (!('serviceWorker' in navigator) || IS_TAURI || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('service-worker.js').catch(e => console.warn('Service Worker 注册失败', e));
}

// ===== 路由：根据 #hash 显示对应页面 =====
function route() {
  const page = location.hash.slice(1) || 'home';
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + page));
  document.querySelectorAll('.navlink').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if (page === 'home') Dash.refresh();
  if (page === 'settings') Settings.render();
  if (page !== 'ocr') OCR.stopCam();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = libUrl('pdfjs/pdf.worker.min.js');
  registerSW();
  Settings.init();
  Words.init();
  OCR.init();
  Course.init();
  await Exam.init();
  Dash.init();
  route();
});
