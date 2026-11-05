// ===== 模块1：课程私有资料库 + 一键组卷 =====
// 资料 doc：{ id, name, subject(=课程名), major, text, created }
// 试卷 paper：{ id, title, subject, source, docs, created, choice, fill, judge, short, calc }

// 题型表：新增题型只要在这里加一行，并在 AI 提示词里说明格式
const SECTIONS = [
  { k: 'choice', name: '单项选择题' },
  { k: 'fill',   name: '填空题' },
  { k: 'judge',  name: '判断题' },
  { k: 'short',  name: '简答题' },
  { k: 'calc',   name: '计算题' },
];

const Exam = {
  docs: [],        // 全部资料
  papers: [],      // 全部试卷
  current: null,   // 当前预览的试卷
  showAns: false,
  mode: 'docs',    // docs 私有资料组卷 / bank 内置题库组卷

  async init() {
    this.docs = (await DB.all('docs')).sort((a, b) => b.created - a.created);
    await this.onCourse();
  },

  course() { return Course.current()?.course; },

  // 切换课程后刷新资料、考点、历史试卷、配套实验模板、课程词库
  async onCourse() {
    this.renderDocs();
    this.setMode(this.mode);
    await this.renderHistory();
    Words.renderCourseBanks(this.course());
    const tpls = templatesOf(this.course());
    $('#courseTpls').innerHTML = tpls.map(t =>
      `<button class="btn2" data-id="${t.id}" onclick="OCR.open(this.dataset.id)">${esc(t.name)}</button>`).join('')
      || '<span class="text-slate-400">这门课没有配套实验模板，可在「拍照识别计算」里搜索通用模板或自定义。</span>';
  },

  // 切换组卷模式：私有资料 / 内置题库
  setMode(mode) {
    this.mode = mode;
    $('#modeDocs').classList.toggle('hidden', mode !== 'docs');
    $('#modeBank').classList.toggle('hidden', mode !== 'bank');
    $('#tabDocs').className = (mode === 'docs' ? 'btn' : 'btn2') + ' flex-1';
    $('#tabBank').className = (mode === 'bank' ? 'btn' : 'btn2') + ' flex-1';
    if (mode === 'docs') {
      $('#genLocalLabel').textContent = '本地规则出题（离线）';
      $('#genHint').textContent = '本地规则不出计算题；AI 出题会把所选资料文字发给你配置的 AI 服务。';
      return;
    }
    const c = this.course(), outline = outlineOf(c), bank = qbankOf(c);
    $('#outlineList').innerHTML = outline ? outline.map(x => `<li>${esc(x)}</li>`).join('')
      : `<li class="text-slate-400 list-none -ml-5">这门课还没有内置考点，AI 会按「${esc(c)}」的通用本科教学大纲出题。可在 js/outlines.js 补充。</li>`;
    const n = bank ? SECTIONS.reduce((s, x) => s + (bank[x.k] || []).length, 0) : 0;
    $('#bankInfo').textContent = bank ? `离线题库：${n} 道题，未配置 AI 时可直接抽题组卷。` : '这门课暂无离线题库，需要配置 AI 才能出题。';
    $('#genLocalLabel').textContent = '离线题库抽题';
    $('#genHint').textContent = '内置题库模式不需要上传资料；AI 出题只发送 专业、学期、课程名和考点范围。';
  },

  // ---------- 资料 ----------
  async upload() {
    const files = [...$('#fileInput').files];
    if (!files.length) return toast('请先选择文件', true);
    const cur = Course.current();
    for (const f of files) {
      try {
        $('#genStatus').textContent = '正在解析：' + f.name;
        const text = (await parseFile(f)).trim();
        if (!text) throw new Error('没有提取到文字（扫描版 PDF 请用拍照识别）');
        await DB.put('docs', { id: uid(), name: f.name, subject: cur.course, major: cur.major, text, created: Date.now() });
        toast('已导入：' + f.name);
      } catch (e) {
        toast(f.name + ' 导入失败：' + e.message, true);
      }
    }
    $('#genStatus').textContent = '';
    $('#fileInput').value = '';
    await this.init();
  },

  async delDoc(id) {
    if (!confirm('确定删除这份资料？')) return;
    await DB.del('docs', id);
    await this.init();
    if (location.hash === '#settings') Settings.render();
  },

  renderDocs() {
    const list = this.docs.filter(d => d.subject === this.course());
    $('#docList').innerHTML = list.length ? list.map(d => `
      <label class="flex items-center gap-2 py-1 border-b border-white/60">
        <input type="checkbox" class="docPick" value="${d.id}" checked>
        <span class="flex-1 truncate" title="${esc(d.name)}">${esc(d.name)}</span>
        <span class="text-xs text-slate-400">${d.text.length}字</span>
        <button class="text-red-500 text-xs" data-id="${d.id}" onclick="event.preventDefault();Exam.delDoc(this.dataset.id)">删除</button>
      </label>`).join('')
      : '<p class="text-slate-400">这门课还没有资料，先在上面上传。</p>';
  },

  // ---------- 组卷 ----------
  // mode: 'paper' 模拟卷；5 / 10 随堂自测
  async generate(mode) {
    const ids = [...document.querySelectorAll('.docPick:checked')].map(x => x.value);
    const docs = this.mode === 'docs' ? this.docs.filter(d => ids.includes(d.id)) : [];
    if (this.mode === 'docs' && !docs.length) return toast('请至少勾选一份资料，或切换到「内置题库组卷」', true);

    const counts = mode === 'paper'
      ? Object.fromEntries(SECTIONS.map(s => [s.k, Math.max(0, +$('#n_' + s.k).value || 0)]))
      : mode === 5 ? { choice: 2, fill: 1, judge: 2, short: 0, calc: 0 }
                   : { choice: 4, fill: 2, judge: 3, short: 1, calc: 0 };
    if (!Object.values(counts).some(Boolean)) return toast('题量不能全为 0', true);

    const subject = this.course(), cur = Course.current();
    const useAI = $('#genAI').checked, bankMode = this.mode === 'bank';

    document.querySelectorAll('.genBtn').forEach(b => b.disabled = true);
    $('#genStatus').textContent = useAI ? 'AI 正在出题，约 20~60 秒…' : '正在出题…';
    try {
      let q;
      if (bankMode) q = useAI ? await aiGenerateBank(cur, counts) : drawFromBank(subject, counts);
      else {
        const text = pickText(docs.map(d => d.text).join('\n\n'));
        q = useAI ? await aiGenerate(text, counts, subject) : localGenerate(text, counts);
      }
      const paper = {
        id: uid(), subject,
        title: `${subject} ${mode === 'paper' ? '模拟试卷' : '随堂自测'}`,
        source: (bankMode ? '内置题库 · ' : '') + (useAI ? 'AI 出题' : bankMode ? '离线抽题' : '本地规则出题'),
        docs: bankMode ? [`${cur.term || ''} 课程考点`] : docs.map(d => d.name),
        created: Date.now(),
        ...normalizePaper(q),
      };
      await DB.put('papers', paper);
      Stats.add('questions', SECTIONS.reduce((n, s) => n + paper[s.k].length, 0));
      this.showAns = false;
      this.show(paper);
      await this.renderHistory();
    } catch (e) {
      toast('生成失败：' + e.message, true);
    } finally {
      document.querySelectorAll('.genBtn').forEach(b => b.disabled = false);
      $('#genStatus').textContent = '';
    }
  },

  // ---------- 预览 / 导出 ----------
  show(p) {
    this.current = p;
    const cn = '一二三四五';
    let sec = 0;
    let h = `<h2 class="text-xl font-bold text-center">${esc(p.title)}</h2>
      <p class="text-center text-xs text-slate-500 mb-4">${esc(p.source)} · 依据资料：${esc(p.docs.join('、'))} · ${new Date(p.created).toLocaleString()}</p>`;
    for (const s of SECTIONS) {
      const items = p[s.k] || [];          // 旧版试卷没有填空/计算字段
      if (!items.length) continue;
      h += `<h3 class="sec">${cn[sec++]}、${s.name}</h3>`;
      items.forEach((x, i) => {
        h += `<div class="q"><p class="whitespace-pre-wrap">${i + 1}. ${esc(x.q)}${s.k === 'judge' ? '（　　）' : ''}</p>`;
        if (s.k === 'choice') h += `<div class="grid sm:grid-cols-2 gap-x-4 pl-4">${x.options.map((o, j) => `<span>${'ABCD'[j]}. ${esc(o)}</span>`).join('')}</div>`;
        if (this.showAns) h += `<div class="ans whitespace-pre-wrap">${esc(answerText(s.k, x))}</div>`;
        h += '</div>';
      });
    }
    $('#paperView').innerHTML = h;
  },

  toggleAns() {
    if (!this.current) return;
    this.showAns = !this.showAns;
    this.show(this.current);
  },

  copyMd() { this.current ? copyText(paperToMd(this.current)) : toast('还没有试卷', true); },
  downloadMd() { this.current ? download(this.current.title + '.md', paperToMd(this.current)) : toast('还没有试卷', true); },

  async renderHistory() {
    this.papers = (await DB.all('papers')).sort((a, b) => b.created - a.created);
    const list = this.papers.filter(p => p.subject === this.course());
    $('#paperHistory').innerHTML = list.length ? list.map(p => `
      <li class="flex items-center gap-2">
        <button class="text-indigo-600 hover:underline flex-1 text-left truncate" data-id="${p.id}" onclick="Exam.openPaper(this.dataset.id)">${esc(p.title)}</button>
        <span class="text-xs text-slate-400">${esc(p.source)} · ${new Date(p.created).toLocaleString()}</span>
        <button class="text-red-500 text-xs" data-id="${p.id}" onclick="Exam.delPaper(this.dataset.id)">删除</button>
      </li>`).join('') : '<li class="text-slate-400">暂无</li>';
  },

  openPaper(id) { this.showAns = false; this.show(this.papers.find(p => p.id === id)); },

  async delPaper(id) {
    await DB.del('papers', id);
    if (this.current?.id === id) { this.current = null; $('#paperView').innerHTML = ''; }
    await this.renderHistory();
  },
};

// 某道题的答案文字（预览和 Markdown 共用）
function answerText(k, x) {
  const exp = x.explain ? '　解析：' + x.explain : '';
  if (k === 'choice') return '答案：' + x.answer + exp;
  if (k === 'judge') return '答案：' + (x.answer ? '√ 正确' : '× 错误') + exp;
  return (k === 'fill' ? '答案：' : '参考答案：') + x.answer + exp;
}

// ===== 出题用的资料文字 =====
// shortcut: 资料超过 1.2 万字时均匀截取 12 段，可能漏掉部分考点；要全覆盖可改成分段多次出题再合并
function pickText(text, max = 12000) {
  if (text.length <= max) return text;
  const n = 12, size = Math.floor(max / n), step = Math.floor(text.length / n);
  return Array.from({ length: n }, (_, i) => text.slice(i * step, i * step + size)).join('\n……\n');
}

// ===== AI 出题 =====
async function aiGenerate(text, counts, subject) {
  const prompt = `你是青岛科技大学「${subject}」课程的出题老师。请严格只依据下面【复习资料】中的内容出题，不得引入资料以外的知识点。
题量：单项选择题 ${counts.choice} 道，填空题 ${counts.fill} 道，判断题 ${counts.judge} 道，简答题 ${counts.short} 道，计算题 ${counts.calc} 道（为 0 的题型返回空数组）。
要求：选择题 4 个选项且只有一个正确；填空题用 ____ 表示空；判断题正误大致各半；计算题考查资料中的公式或方法，数据可自拟但要合理，答案写出步骤和结果；资料里没有可计算内容时计算题返回空数组。解析要指出资料中的依据。
只输出一个 JSON 对象，不要输出任何其他文字，格式如下：
{"choice":[{"q":"题干","options":["选项1","选项2","选项3","选项4"],"answer":"A","explain":"解析"}],
 "fill":[{"q":"含 ____ 的句子","answer":"答案","explain":"解析"}],
 "judge":[{"q":"陈述句","answer":true,"explain":"解析"}],
 "short":[{"q":"问题","answer":"参考答案要点"}],
 "calc":[{"q":"计算题题干","answer":"解题步骤与结果"}]}

【复习资料】
${text}`;
  return parseAIJson(await aiChat(prompt));
}

// ===== 内置题库模式：AI 按 专业 + 学期 + 课程 + 考点范围 出题 =====
async function aiGenerateBank(cur, counts) {
  const outline = outlineOf(cur.course);
  const scope = outline ? '【考点范围】\n' + outline.map((x, i) => `${i + 1}. ${x}`).join('\n')
    : `【考点范围】按「${cur.course}」课程通用本科教学大纲中适合${cur.term || ''}阶段的内容。`;
  const prompt = `你是青岛科技大学${cur.college}「${cur.major}」专业${cur.term || ''}《${cur.course}》课程的出题老师。
请只在下面的考点范围内出一套难度适中的期末模拟题，题目要符合本科${cur.term || ''}学生的学习进度，不要超纲。
题量：单项选择题 ${counts.choice} 道，填空题 ${counts.fill} 道，判断题 ${counts.judge} 道，简答题 ${counts.short} 道，计算题 ${counts.calc} 道（为 0 的题型返回空数组）。
要求：选择题 4 个选项且只有一个正确；填空题用 ____ 表示空；判断题正误大致各半；计算题给出合理数据，答案写出步骤和结果；每题附简短解析。
只输出一个 JSON 对象，不要输出任何其他文字，格式如下：
{"choice":[{"q":"题干","options":["选项1","选项2","选项3","选项4"],"answer":"A","explain":"解析"}],
 "fill":[{"q":"含 ____ 的句子","answer":"答案","explain":"解析"}],
 "judge":[{"q":"陈述句","answer":true,"explain":"解析"}],
 "short":[{"q":"问题","answer":"参考答案要点"}],
 "calc":[{"q":"计算题题干","answer":"解题步骤与结果"}]}

${scope}`;
  return parseAIJson(await aiChat(prompt));
}

// 内置题库模式（离线）：从 QBANK 按题型随机抽题
function drawFromBank(course, counts) {
  const bank = qbankOf(course);
  if (!bank) throw new Error(`「${course}」暂无离线题库，请在设置里配置 AI 后选「AI 出题」`);
  const out = {};
  for (const s of SECTIONS) out[s.k] = shuffle([...(bank[s.k] || [])]).slice(0, counts[s.k]);
  // 选择题选项也打乱，同一道题每次顺序不同
  out.choice = out.choice.map(x => {
    const right = x.options['ABCD'.indexOf(x.answer)], options = shuffle([...x.options]);
    return { ...x, options, answer: 'ABCD'[options.indexOf(right)] };
  });
  return out;
}

// 统一题目格式，防止 AI 返回的字段缺失或类型不对
function normalizePaper(q) {
  const arr = v => Array.isArray(v) ? v.filter(x => x && x.q) : [];
  const base = x => ({ q: String(x.q), answer: String(x.answer ?? ''), explain: x.explain ? String(x.explain) : '' });
  return {
    choice: arr(q.choice).filter(x => Array.isArray(x.options)).map(x => ({
      ...base(x), options: x.options.slice(0, 4).map(String), answer: String(x.answer || '').trim().toUpperCase().charAt(0),
    })),
    fill: arr(q.fill).map(base),
    judge: arr(q.judge).map(x => ({ ...base(x), answer: x.answer === true || /^(true|对|正确|√)$/i.test(String(x.answer)) })),
    short: arr(q.short).map(base),
    calc: arr(q.calc).map(base),
  };
}

// ===== 本地规则出题（离线，不调用任何接口）=====
const STOP = new Set('我们 你们 他们 这个 那个 一个 可以 进行 以及 或者 因为 所以 如果 但是 然后 其中 通过 由于 对于 关于 没有 不是 就是 还是 而且 这些 那些 什么 如何 为了 主要 需要 已经 同时 一般 一种 之间 以上 以下 作为 从而 资料 提纲 复习 基本 能力 单位 例如 通常 非常 不一定 这种 能够 称为 是指 the and for are with that this from'.split(' '));

function localGenerate(text, counts) {
  // 1. 分句，只留长度适中的句子，跳过章节标题
  const sents = [...new Set(text.split(/[。！？!?\n；;]+/).map(s => s.replace(/\s+/g, ' ').trim()))]
    .filter(s => s.length >= 10 && s.length <= 120 && !/^(第.{1,4}[章节部分篇]|[一二三四五六七八九十]+[、.])/.test(s));

  // 2. 分词并统计词频（浏览器自带中文分词；旧浏览器退化为正则）
  const seg = window.Intl?.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const words = s => (seg ? [...seg.segment(s)].filter(x => x.isWordLike).map(x => x.segment)
                          : s.match(/[一-龥]{2,4}|[A-Za-z]{3,}/g) || [])
    .filter(w => w.length >= 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const freq = {};
  const info = sents.map(s => { const ws = words(s); ws.forEach(w => freq[w] = (freq[w] || 0) + 1); return { s, ws }; });
  const terms = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 100);
  if (terms.length < 4 || sents.length < 3) throw new Error('资料文字太少，本地规则无法出题，请多上传一些或改用 AI 出题');

  // 每个句子选「词频 × 词长」最大的术语作为考点
  const score = w => freq[w] * w.length;
  const keyOf = it => it.ws.filter(w => terms.includes(w)).sort((a, b) => score(b) - score(a))[0];
  const pool = shuffle(info.filter(keyOf));
  // 干扰项只从其它句子的考点词里挑，优先和正确答案字数相同
  const keys = [...new Set(info.map(keyOf).filter(Boolean))];
  const others = (key, s) => shuffle(keys.filter(t => t !== key && !s.includes(t)))
    .sort((a, b) => Math.abs(a.length - key.length) - Math.abs(b.length - key.length));
  const free = () => pool.filter(it => !it.used);
  const out = { choice: [], fill: [], judge: [], short: [], calc: [] };

  // 3. 简答题：含定义类关键词的句子
  const defRe = /是指|定义|称为|叫做|是一种|包括|特点|原理|作用|意义|条件/;
  for (const it of free().filter(it => defRe.test(it.s))) {
    if (out.short.length >= counts.short) break;
    out.short.push({ q: `根据资料，简述「${keyOf(it)}」的相关内容。`, answer: it.s, explain: '' });
    it.used = true;
  }
  // 4. 选择题：挖空考点词 + 3 个干扰项
  for (const it of free()) {
    if (out.choice.length >= counts.choice) break;
    const key = keyOf(it), wrong = others(key, it.s).slice(0, 3);
    if (wrong.length < 3) continue;
    const options = shuffle([key, ...wrong]);
    out.choice.push({ q: it.s.replace(key, '______'), options, answer: 'ABCD'[options.indexOf(key)], explain: '原文：' + it.s });
    it.used = true;
  }
  // 5. 填空题：挖空考点词，不给选项
  for (const it of free()) {
    if (out.fill.length >= counts.fill) break;
    const key = keyOf(it);
    out.fill.push({ q: it.s.replace(key, '______'), answer: key, explain: '原文：' + it.s });
    it.used = true;
  }
  // 6. 判断题：一半原句（正确），一半替换考点词（错误）
  for (const it of free()) {
    if (out.judge.length >= counts.judge) break;
    const key = keyOf(it), fake = others(key, it.s)[0];
    const truth = Math.random() < 0.5 || !fake;
    out.judge.push({ q: truth ? it.s : it.s.replace(key, fake), answer: truth, explain: '原文：' + it.s });
    it.used = true;
  }
  return out;
}

// ===== 试卷 → Markdown（答案统一放在最后，方便打印）=====
function paperToMd(p) {
  const L = [`# ${p.title}`, '', `> ${p.source} · 依据资料：${p.docs.join('、')} · ${new Date(p.created).toLocaleString()}`, ''];
  const ans = [];
  const cn = '一二三四五';
  let sec = 0;
  for (const s of SECTIONS) {
    const items = p[s.k] || [];
    if (!items.length) continue;
    L.push(`## ${cn[sec++]}、${s.name}`, '');
    items.forEach((x, i) => {
      L.push(`${i + 1}. ${x.q}${s.k === 'judge' ? '（　　）' : ''}`, '');
      if (s.k === 'choice') L.push(...x.options.map((o, j) => `   ${'ABCD'[j]}. ${o}`), '');
      if (s.k === 'short' || s.k === 'calc') L.push('', '');
      ans.push(`- ${s.name} ${i + 1}：${answerText(s.k, x).replace(/^(参考)?答案：/, '')}`);
    });
  }
  L.push('---', '', '## 参考答案', '', ...ans, '');
  return L.join('\n');
}
