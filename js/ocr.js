// ===== 模块2：拍照 OCR 识别 → 校对 → 计算模板 → 结果 =====
// 识别用 Tesseract.js，在浏览器本地运行，图片不上传。
// 识别历史存在 IndexedDB 的 ocr 表：{ id, text, thumb(缩略图), created }

const OCR = {
  img: null,      // 当前图片（URL 或 dataURL）
  stream: null,   // 摄像头视频流
  tpl: null,      // 当前计算模板
  md: '',         // 当前结果的 Markdown 表格

  init() {
    this.renderTplSelect();
    this.pickTpl(TEMPLATES[0].id);
    this.renderHistory();
  },

  // ---------- 图片来源 ----------
  loadImage(input) {
    const f = input.files[0];
    input.value = '';
    if (f) this.setImage(URL.createObjectURL(f));
  },

  setImage(src) {
    this.img = src;
    $('#ocrImg').src = src;
    $('#ocrImg').classList.remove('hidden');
    $('#ocrEmpty').classList.add('hidden');
  },

  async camera() {
    if (this.stream) return this.snap();          // 摄像头已开 → 这次点击是拍照
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      $('#ocrVideo').srcObject = this.stream;
      $('#ocrVideo').classList.remove('hidden');
      $('#camBtn').textContent = '📸 拍照';
    } catch (e) {
      toast('无法打开摄像头：' + e.message, true);
    }
  },

  snap() {
    const v = $('#ocrVideo'), c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    this.setImage(c.toDataURL('image/jpeg', 0.9));
    this.stopCam();
  },

  stopCam() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    $('#ocrVideo').classList.add('hidden');
    $('#camBtn').textContent = '📷 打开电脑摄像头';
  },

  // ---------- 识别 ----------
  async recognize() {
    if (!this.img) return toast('请先上传或拍一张图片', true);
    if (!window.Tesseract) return toast('OCR 库没加载，请刷新页面', true);
    $('#ocrStatus').textContent = '加载识别模型…';
    // 程序、wasm 核心、语言包全部从本地 lib/tesseract 读取，不访问外网（离线 / PWA / EXE 都能用）
    const worker = await Tesseract.createWorker($('#ocrLang').value, 1, {
      workerPath: libUrl('tesseract/worker.min.js'),
      corePath: libUrl('tesseract/'),          // 目录：自动选 simd-lstm（新设备）或 lstm（旧设备）
      langPath: libUrl('tesseract/lang'),      // 读取 lang/chi_sim.traineddata.gz、eng.traineddata.gz
      logger: m => { if (m.status === 'recognizing text') $('#ocrStatus').textContent = `识别中 ${Math.round(m.progress * 100)}%`; },
    });
    try {
      const { data } = await worker.recognize(this.img);
      // Tesseract 会在中文字之间插空格（「混合 碱 测定」），去掉
      const text = data.text.replace(/(?<=[一-龥]) +(?=[一-龥])/g, '').trim();
      $('#ocrText').value = text;
      await this.saveHistory(text);
      toast('识别完成，请校对后提取数据');
    } catch (e) {
      toast('识别失败：' + e.message, true);
    } finally {
      await worker.terminate();
      $('#ocrStatus').textContent = '';
    }
  },

  // 每行取出数字，按模板列数填进数据表
  // 取每行【最后】n 个数字：行首常是序号；跳过紧跟字母的数字（表头里的 V1、T2 之类）
  extract() {
    const n = this.tpl.cols.length;
    const lines = $('#ocrText').value.replace(/，/g, ',').replace(/。/g, '.').split(/\r?\n/)
      .map(l => (l.match(/(?<![A-Za-z\d.])-?\d+(?:\.\d+)?/g) || []).map(Number));
    const rows = n === 1 ? lines.flat().map(x => [x]) : lines.filter(r => r.length >= n).map(r => r.slice(-n));
    if (!rows.length) return toast(`没找到每行至少 ${n} 个数字的数据，可以手动修改识别文字`, true);
    this.setRows(rows);
    toast(`已提取 ${rows.length} 行数据`);
  },

  // OCR 文字常有错位、错字，让 AI 按模板列整理（需联网 + API Key）
  async aiExtract() {
    const text = $('#ocrText').value.trim();
    if (!text) return toast('先识别或粘贴文字', true);
    $('#ocrStatus').textContent = 'AI 正在整理数据…';
    try {
      const prompt = `下面是 OCR 从实验记录/数据表图片中识别出的文字，可能有错字和错位。
请按列【${this.tpl.cols.join('、')}】把其中的原始数据整理成数据行，明显的识别错误（如 O→0、l→1）请修正。
只输出一个 JSON 二维数组，每行 ${this.tpl.cols.length} 个数字，例如 [[1.2,3.4],[5.6,7.8]]，不要输出任何其他文字。

${text}`;
      const rows = parseAIJson(await aiChat(prompt), '[', ']').map(r => [].concat(r).map(Number));
      this.setRows(rows);
      toast(`AI 整理出 ${rows.length} 行数据，请核对`);
    } catch (e) {
      toast('AI 整理失败：' + e.message, true);
    } finally {
      $('#ocrStatus').textContent = '';
    }
  },

  // ---------- 识别历史 ----------
  async saveHistory(text) {
    await DB.put('ocr', { id: uid(), text, thumb: await thumbnail(this.img), created: Date.now() });
    const all = (await DB.all('ocr')).sort((a, b) => b.created - a.created);
    for (const old of all.slice(20)) await DB.del('ocr', old.id);   // 只保留最近 20 条
    this.renderHistory();
  },

  async renderHistory() {
    this.history = (await DB.all('ocr')).sort((a, b) => b.created - a.created);
    $('#ocrHistory').innerHTML = this.history.map(h => `
      <li class="flex items-center gap-2 bg-white/50 rounded-xl p-1 cursor-pointer" data-id="${h.id}" onclick="OCR.loadHistory(this.dataset.id)">
        ${h.thumb ? `<img src="${h.thumb}" class="w-12 h-12 object-cover rounded-lg">` : ''}
        <span class="flex-1 truncate">${esc(h.text.slice(0, 40))}</span>
        <span class="text-xs text-slate-400">${new Date(h.created).toLocaleString()}</span>
      </li>`).join('') || '<li class="text-slate-400">暂无</li>';
  },

  loadHistory(id) { $('#ocrText').value = this.history.find(h => h.id === id).text; },

  // ---------- 模板库：按课程分组 + 搜索 ----------
  allTpl() { return [...TEMPLATES, ...LS.get('customTpl', []).map(customToTpl)]; },

  renderTplSelect() {
    const all = this.allTpl();
    // 课程筛选下拉：无机及分析化学实验排第一（本项目重点）
    const courses = [...new Set(all.map(t => t.course))];
    const cur = $('#tplCourse').value;
    $('#tplCourse').innerHTML = `<option value="">全部课程（${all.length} 个模板）</option>`
      + courses.map(c => `<option value="${esc(c)}">${esc(c)}（${all.filter(t => t.course === c).length}）</option>`).join('');
    $('#tplCourse').value = courses.includes(cur) ? cur : '';

    const kw = $('#tplSearch').value.trim().toLowerCase();
    const list = all.filter(t => (!$('#tplCourse').value || t.course === $('#tplCourse').value)
      && (!kw || `${t.course} ${t.cat} ${t.name}`.toLowerCase().includes(kw)));
    const groups = {};
    list.forEach(t => (groups[t.course] ||= []).push(t));
    $('#tplSelect').innerHTML = Object.entries(groups).map(([course, ts]) =>
      `<optgroup label="${esc(course)}">${ts.map(t => `<option value="${t.id}">【${esc(t.cat)}】${esc(t.name)}${t.custom ? '（自定义）' : ''}</option>`).join('')}</optgroup>`).join('');
    $('#tplCount').textContent = `显示 ${list.length} / ${all.length}`;
    if (this.tpl && list.some(t => t.id === this.tpl.id)) $('#tplSelect').value = this.tpl.id;
  },

  // 从课程页跳过来：打开指定模板
  open(id) {
    location.hash = '#ocr';
    $('#tplSearch').value = '';
    $('#tplCourse').value = '';
    this.renderTplSelect();
    this.pickTpl(id);
  },

  pickTpl(id) {
    this.tpl = this.allTpl().find(t => t.id === id);
    $('#tplSelect').value = id;
    $('#tplTitle').textContent = `${this.tpl.course} · ${this.tpl.name}`;
    $('#tplFormula').textContent = this.tpl.formula;
    $('#tplDel').classList.toggle('hidden', !this.tpl.custom);
    $('#tplParams').innerHTML = (this.tpl.params || []).map(p =>
      `<label>${esc(p.label)}<input class="inp tplParam" data-k="${p.k}" type="number" step="any" value="${p.v}" oninput="OCR.calc()"></label>`).join('');
    $('#tplHead').innerHTML = `<tr>${this.tpl.cols.map(c => `<th>${esc(c)}</th>`).join('')}<th></th></tr>`;
    this.setRows(this.tpl.demo);
  },

  setRows(rows) {
    $('#tplRows').innerHTML = '';
    rows.forEach(r => this.addRow(r));
    this.calc();
  },

  addRow(vals = []) {
    const tr = document.createElement('tr');
    tr.innerHTML = this.tpl.cols.map((_, i) =>
      `<td><input class="inp text-center !py-1" type="number" step="any" value="${vals[i] ?? ''}" oninput="OCR.calc()"></td>`).join('')
      + '<td><button class="text-red-500" onclick="this.closest(\'tr\').remove();OCR.calc()">✕</button></td>';
    $('#tplRows').appendChild(tr);
  },

  // 只取填完整的行
  rows() {
    return [...$('#tplRows').querySelectorAll('tr')]
      .map(tr => [...tr.querySelectorAll('input')].map(i => parseFloat(i.value)))
      .filter(r => r.every(Number.isFinite));
  },

  params() {
    return Object.fromEntries([...document.querySelectorAll('.tplParam')].map(i => [i.dataset.k, parseFloat(i.value)]));
  },

  calc() {
    const rows = this.rows();
    if (!rows.length) return this.out({ msg: '在左侧数据表填入数据，或从识别结果提取。' });
    try { this.out(this.tpl.calc(rows, this.params())); }
    catch (e) { this.out({ msg: '计算出错：' + e.message }); }
  },

  // 输出 HTML 表格（+ 拟合图），同时生成 Markdown
  out(r) {
    if (r.msg) { $('#calcOut').innerHTML = `<p class="text-slate-400 text-sm">${esc(r.msg)}</p>`; this.md = ''; return; }
    $('#calcOut').innerHTML = `<p class="text-xs text-slate-500 mb-2">${esc(r.note)}</p>
      <table class="tbl"><thead><tr>${r.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${r.body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${r.warn ? `<p class="text-amber-600 text-sm mt-2">⚠ ${esc(r.warn)}</p>` : ''}
      ${r.plot ? plotSvg(r.plot) : ''}
      ${r.tips ? `<div class="mt-3 text-sm bg-white/50 rounded-2xl p-3"><b>💡 结果讨论提示</b><p class="mt-1 text-slate-600">${esc(r.tips)}</p></div>` : ''}`;
    this.md = [`### ${this.tpl.name}`, '', `> ${r.note}`, '', `| ${r.head.join(' | ')} |`, `|${r.head.map(() => ' :-: ').join('|')}|`,
      ...r.body.map(row => `| ${row.join(' | ')} |`), r.warn ? `\n> ⚠ ${r.warn}` : '', r.tips ? `\n**结果讨论提示：** ${r.tips}` : ''].join('\n');
  },

  // ---------- 自定义模板 ----------
  saveCustom() {
    const name = $('#ctName').value.trim(), cols = $('#ctCols').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const formula = $('#ctFormula').value.trim(), result = $('#ctResult').value.trim() || '结果';
    if (!name || !cols.length || !formula) return toast('模板名、数据列、公式都要填', true);
    if (cols.length > 10) return toast('最多 10 列', true);
    const course = $('#ctCat').value.trim() || '我的模板';
    const c = { id: 'c_' + uid(), course, cat: '自定义', name, cols, formula, result };
    try { new Function(...'abcdefghij'.slice(0, cols.length), `with (Math) { return (${formula}); }`)(...cols.map(() => 1)); }   // 先试算一次，公式写错立刻提示
    catch (e) { return toast('公式有误：' + e.message, true); }
    LS.set('customTpl', [...LS.get('customTpl', []), c]);
    ['#ctName', '#ctCat', '#ctCols', '#ctFormula', '#ctResult'].forEach(s => $(s).value = '');
    this.renderTplSelect();
    this.pickTpl(c.id);
    toast('模板已保存');
  },

  delCustom() {
    if (!this.tpl.custom || !confirm(`删除模板「${this.tpl.name}」？`)) return;
    LS.set('customTpl', LS.get('customTpl', []).filter(c => c.id !== this.tpl.id));
    this.renderTplSelect();
    this.pickTpl(TEMPLATES[0].id);
  },
};

// 生成 160px 宽缩略图存历史，避免把原图塞进浏览器存储
function thumbnail(src) {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = Math.round(im.height * 160 / im.width);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    im.onerror = () => resolve('');
    im.src = src;
  });
}

// 散点 + 拟合直线的小图（SVG，可直接截图放进实验报告）
function plotSvg({ xs, ys, slope, intercept, xl, yl }) {
  const W = 360, H = 220, P = 40;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = x => P + (x - x0) / (x1 - x0 || 1) * (W - 2 * P);
  const sy = y => H - P - (y - y0) / (y1 - y0 || 1) * (H - 2 * P);
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-md mt-3 bg-white/50 rounded-2xl">
    <line x1="${P}" y1="${H - P}" x2="${W - P / 2}" y2="${H - P}" stroke="#94a3b8"/><line x1="${P}" y1="${P / 2}" x2="${P}" y2="${H - P}" stroke="#94a3b8"/>
    <line x1="${sx(x0)}" y1="${sy(slope * x0 + intercept)}" x2="${sx(x1)}" y2="${sy(slope * x1 + intercept)}" stroke="#6366f1" stroke-width="2"/>
    ${xs.map((x, i) => `<circle cx="${sx(x)}" cy="${sy(ys[i])}" r="4" fill="#0ea5e9"/>`).join('')}
    <text x="${W / 2}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#475569">${esc(xl)}</text>
    <text x="12" y="${H / 2}" font-size="12" text-anchor="middle" fill="#475569" transform="rotate(-90 12 ${H / 2})">${esc(yl)}</text>
  </svg>`;
}
