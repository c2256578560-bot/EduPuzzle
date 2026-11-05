// ===== 模块2：自定义单词闯关 =====
// 词库存在 localStorage 的 ep_wordbanks：[{ id, name, course, major, term, unlocked, words: [{ w, m, wrong }] }]
// course / major / term 是绑定的「专业 · 学期 · 课程」，和课程库打通（课程页会列出本课程的词库）

const LEVEL_SIZE = 10;     // 每关单词数
const PASS_RATE = 0.8;     // 过关正确率

// 首次打开时内置的示例词库，方便演示
const DEMO_WORDS = `titration,滴定
indicator,指示剂
burette,滴定管
pipette,移液管
volumetric flask,容量瓶
equivalence point,化学计量点
end point,滴定终点
standard solution,标准溶液
primary standard,基准物质
complexometric titration,配位滴定
chelate,螯合物
buffer solution,缓冲溶液
activation energy,活化能
rate constant,速率常数
catalyst,催化剂
equilibrium constant,平衡常数
precipitate,沉淀
oxidation,氧化
reduction,还原
molarity,物质的量浓度`;

const Words = {
  banks() { return LS.get('wordbanks', []); },
  bank() { return this.banks().find(b => b.id === $('#bankSelect').value); },

  // 修改当前词库并保存
  updateBank(fn) {
    const all = this.banks();
    const b = all.find(x => x.id === $('#bankSelect').value);
    if (!b) return;
    fn(b);
    LS.set('wordbanks', all);
  },

  init() {
    // 旧版示例词库绑定的是「无机化学」或没绑定，改绑到大一上的「无机及分析化学」
    const old = this.banks();
    if (old.some(b => b.id === 'demo' && (!b.course || b.course === '无机化学'))) {
      LS.set('wordbanks', old.map(b => b.id === 'demo' ? { ...b, course: '无机及分析化学', term: '大一上' } : b));
    }
    if (!this.banks().length) {
      LS.set('wordbanks', [{ id: 'demo', name: '示例：化学专业词汇', course: '无机及分析化学', term: '大一上', unlocked: 1, words: this.parseLines(DEMO_WORDS) }]);
    }
    this.renderBanks();
  },

  // 每行 "单词,释义"，支持中英文逗号、Tab、空格分隔
  parseLines(text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.+?)\s*[,，\t]\s*(.+)$/) || l.match(/^(\S+)\s+(.+)$/);
      return m && { w: m[1].trim(), m: m[2].trim(), wrong: false };
    }).filter(x => x && !/^(word|单词)$/i.test(x.w));   // 去掉表头
  },

  renderBanks(selectId) {
    const all = this.banks();
    const cur = selectId || $('#bankSelect').value;
    $('#bankSelect').innerHTML = all.map(b => `<option value="${b.id}">【${b.term ? esc(b.term) + '·' : ''}${esc(b.course || '未绑定')}】${esc(b.name)}（${b.words.length} 词）</option>`).join('');
    if (all.some(b => b.id === cur)) $('#bankSelect').value = cur;
    this.renderLevels();
    this.renderCourseBanks(Course.current()?.course);
  },

  // 课程页里的「本课程词库」卡片
  renderCourseBanks(course) {
    const list = this.banks().filter(b => b.course === course);
    $('#courseBanks').innerHTML = list.map(b =>
      `<button class="btn2" data-id="${b.id}" onclick="Words.open(this.dataset.id)">${esc(b.name)}（${b.words.length} 词）</button>`).join('')
      || '<span class="text-slate-400">还没有绑定这门课的词库，去「单词闯关」导入词表时填上课程名即可。</span>';
  },

  open(id) {
    location.hash = '#words';
    this.renderBanks(id);
  },

  renderLevels() {
    const b = this.bank();
    if (!b) {
      $('#levelGrid').innerHTML = '<p class="text-slate-400 text-sm col-span-full">请先导入词表</p>';
      $('#wrongList').innerHTML = ''; $('#wrongCount').textContent = 0; $('#wordLog').innerHTML = '';
      return;
    }
    const n = Math.ceil(b.words.length / LEVEL_SIZE);
    $('#levelGrid').innerHTML = Array.from({ length: n }, (_, i) => {
      const lv = i + 1, open = lv <= b.unlocked;
      return `<button class="lv ${open ? '' : 'locked'}" ${open ? '' : 'disabled'} onclick="Words.start(${lv})">${open ? '第 ' + lv + ' 关' : '🔒 ' + lv}</button>`;
    }).join('');

    const wrong = b.words.filter(w => w.wrong);
    $('#wrongCount').textContent = wrong.length;
    $('#wrongList').innerHTML = wrong.map(w => `<li><b>${esc(w.w)}</b>　${esc(w.m)}</li>`).join('') || '<li class="text-slate-400">暂无错题</li>';

    const log = LS.get('wordlog', []).filter(l => l.bank === b.id).slice(-8).reverse();
    $('#wordLog').innerHTML = log.map(l =>
      `<li>${new Date(l.time).toLocaleString()}　${esc(l.label)}　正确率 <b>${Math.round(l.score * 100)}%</b></li>`).join('') || '<li class="text-slate-400">还没有记录</li>';
  },

  async importFile(input) {
    const f = input.files[0];
    if (!f) return;
    const words = this.parseLines(await parseFile(f));
    input.value = '';
    if (!words.length) return toast('没有识别到单词，请检查格式：单词,释义', true);
    const id = uid();
    // 绑定：填了课程名就用填的；没填就绑定课程库里当前选中的 专业 · 学期 · 课程
    const cur = Course.current() || {}, typed = $('#bankCourse').value.trim();
    const bind = typed && typed !== cur.course ? { course: typed } : { course: cur.course || '公共英语', major: cur.major, term: cur.term };
    LS.set('wordbanks', [...this.banks(), { id, name: f.name.replace(/\.\w+$/, ''), ...bind, unlocked: 1, words }]);
    this.renderBanks(id);
    toast(`导入成功：${words.length} 个词`);
  },

  addWord() {
    const w = $('#newWord').value.trim(), m = $('#newMeaning').value.trim();
    if (!w || !m) return toast('单词和释义都要填', true);
    if (!this.bank()) {
      LS.set('wordbanks', [{ id: 'my', name: '我的词库', course: Course.current()?.course || '公共英语', unlocked: 1, words: [] }]);
      this.renderBanks('my');
    }
    this.updateBank(b => b.words.push({ w, m, wrong: false }));
    $('#newWord').value = $('#newMeaning').value = '';
    this.renderBanks();
    toast('已添加：' + w);
  },

  deleteBank() {
    const b = this.bank();
    if (!b || !confirm(`删除词库「${b.name}」？闯关进度也会删除。`)) return;
    LS.set('wordbanks', this.banks().filter(x => x.id !== b.id));
    this.renderBanks();
  },

  // ---------- 答题流程 ----------
  start(lv) {
    const b = this.bank();
    this.queue = b.words.slice((lv - 1) * LEVEL_SIZE, lv * LEVEL_SIZE).map(x => x.w);
    this.level = lv;
    this.mode = 'level';
    this.begin();
  },

  startWrong() {
    const b = this.bank();
    this.queue = b ? b.words.filter(w => w.wrong).map(w => w.w) : [];
    if (!this.queue.length) return toast('没有错题，继续保持！');
    this.mode = 'wrong';
    this.begin();
  },

  begin() {
    if (this.bank().words.length < 2) return toast('词库至少需要 2 个词才能出选项', true);
    shuffle(this.queue);
    this.idx = 0;
    this.right = 0;
    $('#quizBox').classList.remove('hidden');
    $('#quizBox').scrollIntoView({ behavior: 'smooth' });
    this.next();
  },

  next() {
    if (this.idx >= this.queue.length) return this.finish();
    const b = this.bank();
    this.cur = b.words.find(x => x.w === this.queue[this.idx]);
    // 从同一词库随机取 3 个其它释义做干扰项
    const others = shuffle([...new Set(b.words.map(x => x.m).filter(m => m !== this.cur.m))]).slice(0, 3);
    const opts = shuffle([this.cur.m, ...others]);
    $('#quizProgress').textContent = `${this.mode === 'wrong' ? '错题复习' : '第 ' + this.level + ' 关'} · ${this.idx + 1} / ${this.queue.length}`;
    $('#quizWord').textContent = this.cur.w;
    $('#quizOpts').innerHTML = opts.map(o => `<button class="opt" data-m="${esc(o)}" onclick="Words.answer(this)">${esc(o)}</button>`).join('');
  },

  answer(btn) {
    const ok = btn.dataset.m === this.cur.m;
    document.querySelectorAll('#quizOpts .opt').forEach(b => {
      b.disabled = true;
      if (b.dataset.m === this.cur.m) b.classList.add('right');
    });
    if (!ok) btn.classList.add('wrong');
    if (ok) this.right++;

    // 答错进错题本；错题模式下答对则移出错题本
    const w = this.cur.w, mode = this.mode;
    this.updateBank(b => {
      const x = b.words.find(y => y.w === w);
      if (!ok) x.wrong = true;
      else if (mode === 'wrong') x.wrong = false;
    });
    this.idx++;
    setTimeout(() => this.next(), ok ? 600 : 1500);
  },

  finish() {
    const score = this.right / this.queue.length;
    const label = this.mode === 'wrong' ? '错题复习' : `第 ${this.level} 关`;
    let msg = `${label}完成：${this.right} / ${this.queue.length}，正确率 ${Math.round(score * 100)}%`;

    if (this.mode === 'level') {
      if (score >= PASS_RATE) {
        let unlocked = false;
        this.updateBank(b => {
          const total = Math.ceil(b.words.length / LEVEL_SIZE);
          if (this.level === b.unlocked && b.unlocked < total) { b.unlocked++; unlocked = true; }
        });
        msg += unlocked ? ' 🎉 已解锁下一关！' : ' 🎉 过关！';
      } else {
        msg += `，未达到 ${PASS_RATE * 100}%，再试一次吧`;
      }
    }
    LS.set('wordlog', [...LS.get('wordlog', []), { bank: this.bank().id, label, score, time: Date.now() }].slice(-200));

    $('#quizProgress').textContent = '';
    $('#quizWord').textContent = msg;
    $('#quizWord').className = 'text-lg font-bold text-center my-6';
    $('#quizOpts').innerHTML = `<button class="btn" onclick="Words.restart()">再来一次</button>
      <button class="btn2" onclick="$('#quizBox').classList.add('hidden')">收起</button>`;
    this.renderLevels();
  },

  restart() {
    $('#quizWord').className = 'text-3xl font-bold text-center my-6';
    this.mode === 'wrong' ? this.startWrong() : this.start(this.level);
  },
};
