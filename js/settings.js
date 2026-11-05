// ===== 设置：AI 接口、主题、本地数据查看 / 备份 / 恢复 / 清空 =====

const STORES = ['docs', 'papers', 'ocr'];   // 备份和清空时要处理的 IndexedDB 表

const Settings = {
  init() {
    document.body.classList.add(...[LS.get('theme', '')].filter(Boolean));
    const c = LS.get('aiConfig', DEFAULT_AI);
    $('#aiBase').value = c.base;
    $('#aiModel').value = c.model;
    $('#aiKey').value = c.key;
  },

  saveAI() {
    LS.set('aiConfig', {
      base: $('#aiBase').value.trim() || DEFAULT_AI.base,
      model: $('#aiModel').value.trim() || DEFAULT_AI.model,
      key: $('#aiKey').value.trim(),
    });
    toast('AI 设置已保存');
  },

  setTheme(name) {
    document.body.classList.remove('theme-mint', 'theme-sakura');
    if (name) document.body.classList.add(name);
    LS.set('theme', name);
  },

  async render() {
    const docs = (await DB.all('docs')).sort((a, b) => b.created - a.created);
    const papers = await DB.all('papers'), ocr = await DB.all('ocr');
    const banks = LS.get('wordbanks', []);

    $('#dataDocCount').textContent = docs.length;
    $('#dataDocs').innerHTML = docs.length ? `<table class="tbl"><thead><tr><th>文件名</th><th>课程</th><th>字数</th><th>导入时间</th><th></th></tr></thead><tbody>
      ${docs.map(d => `<tr><td class="text-left">${esc(d.name)}</td><td>${esc(d.subject)}</td><td>${d.text.length}</td>
        <td>${new Date(d.created).toLocaleString()}</td>
        <td><button class="text-red-500" data-id="${d.id}" onclick="Exam.delDoc(this.dataset.id)">删除</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="text-slate-400">还没有上传资料。</p>';

    let usage = '';
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = `<p>浏览器存储占用：${(est.usage / 1024 / 1024).toFixed(2)} MB</p>`;
    }
    $('#dataStats').innerHTML = `<h2 class="font-bold mb-1">📦 本地数据</h2>
      <p>资料：${docs.length} 份　试卷：${papers.length} 套</p><p>识别记录：${ocr.length} 条　待办：${LS.get('todos', []).length} 条</p>
      <p>词库：${banks.length} 个，共 ${banks.reduce((s, b) => s + b.words.length, 0)} 词</p>${usage}`;
  },

  // IndexedDB 全部表 + 所有 ep_ 开头的 localStorage → 一个 JSON 文件
  async backup() {
    const data = { app: 'EduPuzzle', version: 2, time: new Date().toISOString(), ls: {} };
    for (const s of STORES) data[s] = await DB.all(s);
    Object.keys(localStorage).filter(k => k.startsWith('ep_')).forEach(k => data.ls[k] = localStorage.getItem(k));
    download(`EduPuzzle备份_${today()}.json`, JSON.stringify(data), 'application/json');
  },

  async restore(input) {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'EduPuzzle') throw new Error('这不是 EduPuzzle 的备份文件');
      if (!confirm(`备份时间 ${d.time}\n资料 ${d.docs?.length || 0} 份、试卷 ${d.papers?.length || 0} 套。\n恢复后，同名记录、词库、待办和设置会被备份内容覆盖，确定？`)) return;
      for (const s of STORES) for (const row of d[s] || []) await DB.put(s, row);   // 旧版备份没有 ocr 表也能恢复
      Object.entries(d.ls || {}).filter(([k]) => k.startsWith('ep_')).forEach(([k, v]) => localStorage.setItem(k, v));
      alert('恢复完成，页面将刷新');
      location.reload();
    } catch (e) {
      toast('恢复失败：' + e.message, true);
    }
  },

  async clearAll() {
    if (!confirm('将删除本浏览器中 EduPuzzle 的全部资料、试卷、识别记录、词库、待办和设置，且无法撤销。\n建议先导出备份。确定清空？')) return;
    for (const s of STORES) await DB.clear(s);
    Object.keys(localStorage).filter(k => k.startsWith('ep_')).forEach(k => localStorage.removeItem(k));
    location.reload();
  },
};
