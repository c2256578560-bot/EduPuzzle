// ===== 个人工作台：待办、番茄钟、学习数据看板 =====
// 待办存在 localStorage 的 ep_todos：[{ id, text, type, due, done, pinned, created }]

const RING = 2 * Math.PI * 80;   // 番茄钟圆环周长（半径 80）

const Dash = {
  mode: 'focus',   // focus 专注 / break 休息
  left: 0,         // 剩余秒数
  endAt: 0,        // 结束时间戳（用时间戳计时，切到别的页面也不会走慢）
  tick: null,

  init() {
    this.renderTodos();
    this.timerReset();
    this.refresh();
  },

  // 问候语 + 看板数字，每次回到首页都刷新
  refresh() {
    const h = new Date().getHours();
    $('#greet').textContent = (h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好') + '，青科大同学 👋';
    $('#today').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const c = Course.current();
    $('#dashCourse').textContent = c ? `当前课程：${c.college} · ${c.major} · ${c.term ? c.term + ' · ' : ''}${c.course}` : '还没有选择课程，去「课程库」选一门吧';
    this.renderStats();
  },

  renderStats() {
    const s = Stats.get();
    $('#stFocus').textContent = s.focus || 0;
    $('#stQ').textContent = s.questions || 0;
    const banks = Words.banks();
    const total = banks.reduce((n, b) => n + Math.ceil(b.words.length / LEVEL_SIZE), 0);
    $('#stWords').textContent = `${banks.reduce((n, b) => n + Math.min(b.unlocked, Math.ceil(b.words.length / LEVEL_SIZE)), 0)}/${total}`;
    $('#stTodo').textContent = this.todos().filter(t => !t.done).length;

    const wrong = banks.reduce((n, b) => n + b.words.filter(w => w.wrong).length, 0);
    $('#dashWrong').textContent = wrong ? `错题本里还有 ${wrong} 个词等你复习。` : '错题本是空的，继续保持！';

    // 近 7 天专注柱状图
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
    const vals = days.map(d => Stats.get(today(d)).focus || 0);
    const max = Math.max(25, ...vals);
    $('#weekChart').innerHTML = days.map((d, i) => `
      <div class="flex-1 flex flex-col items-center justify-end h-full gap-1">
        <span class="text-xs text-slate-500">${vals[i] || ''}</span>
        <div class="w-full rounded-t-xl bg-gradient-to-t from-indigo-500/70 to-sky-400/70" style="height:${vals[i] / max * 100}%;min-height:4px"></div>
        <span class="text-xs text-slate-500">${i === 6 ? '今天' : '周' + '日一二三四五六'[d.getDay()]}</span>
      </div>`).join('');
  },

  // ---------- 待办 ----------
  todos() { return LS.get('todos', []); },

  addTodo() {
    const text = $('#todoText').value.trim();
    if (!text) return toast('先写点内容', true);
    LS.set('todos', [...this.todos(), { id: uid(), text, type: $('#todoType').value, due: $('#todoDue').value, done: false, pinned: false, created: Date.now() }]);
    $('#todoText').value = $('#todoDue').value = '';
    this.renderTodos();
    this.renderStats();
  },

  // field: 'done' 或 'pinned'，切换真假
  toggleTodo(id, field) {
    LS.set('todos', this.todos().map(t => t.id === id ? { ...t, [field]: !t[field] } : t));
    this.renderTodos();
    this.renderStats();
  },

  delTodo(id) {
    LS.set('todos', this.todos().filter(t => t.id !== id));
    this.renderTodos();
    this.renderStats();
  },

  renderTodos() {
    const color = { 任务: 'bg-indigo-500/10 text-indigo-700', 课程通知: 'bg-sky-500/10 text-sky-700', 实验安排: 'bg-emerald-500/10 text-emerald-700', 考试: 'bg-rose-500/10 text-rose-700' };
    // 排序：置顶 → 未完成 → 截止时间早的在前（没有截止时间的放后面）
    const list = this.todos().sort((a, b) =>
      (b.pinned - a.pinned) || (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
    $('#todoList').innerHTML = list.map(t => {
      const overdue = !t.done && t.due && new Date(t.due) < new Date();
      return `<li class="flex items-center gap-2 bg-white/50 rounded-2xl px-3 py-2 ${t.done ? 'opacity-50' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}" onchange="Dash.toggleTodo(this.dataset.id,'done')">
        <span class="chip ${color[t.type] || ''}">${esc(t.type)}</span>
        <span class="flex-1 ${t.done ? 'line-through' : ''}">${esc(t.text)}</span>
        ${t.due ? `<span class="text-xs ${overdue ? 'text-red-500 font-medium' : 'text-slate-500'}">${overdue ? '已逾期 ' : ''}${t.due.replace('T', ' ')}</span>` : ''}
        <button title="置顶" class="${t.pinned ? '' : 'opacity-30'}" data-id="${t.id}" onclick="Dash.toggleTodo(this.dataset.id,'pinned')">📌</button>
        <button title="删除" class="text-slate-400 hover:text-red-500" data-id="${t.id}" onclick="Dash.delTodo(this.dataset.id)">✕</button>
      </li>`;
    }).join('') || '<li class="text-sm text-slate-400">暂无待办，添加一条学习任务吧</li>';
  },

  // ---------- 番茄钟 ----------
  mins() { return Math.max(1, +$(this.mode === 'focus' ? '#focusMin' : '#breakMin').value || (this.mode === 'focus' ? 25 : 5)); },

  timerReset() {
    clearInterval(this.tick);
    this.tick = null;
    this.left = this.mins() * 60;
    this.drawTimer();
  },

  timerToggle() {
    if (this.tick) {                       // 暂停：按结束时间算出精确剩余秒数
      clearInterval(this.tick);
      this.tick = null;
      this.left = Math.max(0, (this.endAt - Date.now()) / 1000);
    } else {                               // 开始 / 继续
      this.endAt = Date.now() + this.left * 1000;
      this.tick = setInterval(() => this.step(), 250);
    }
    this.drawTimer();
  },

  switchMode(m) {
    this.mode = m;
    this.timerReset();
  },

  step() {
    this.left = Math.max(0, (this.endAt - Date.now()) / 1000);
    if (this.left > 0) return this.drawTimer();
    // 一轮结束：记录专注时长，自动切换到休息 / 专注
    this.beep();
    if (this.mode === 'focus') {
      Stats.add('focus', this.mins());
      toast('🍅 专注完成！休息一下吧');
    } else {
      toast('休息结束，开始下一轮专注');
    }
    this.mode = this.mode === 'focus' ? 'break' : 'focus';
    this.timerReset();
    this.renderStats();
  },

  drawTimer() {
    const t = Math.ceil(this.left);
    const text = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    $('#timerText').textContent = text;
    $('#ring').setAttribute('stroke-dashoffset', RING * (1 - this.left / (this.mins() * 60)));
    $('#timerBtn').textContent = this.tick ? '暂停' : (this.left < this.mins() * 60 ? '继续' : '开始');
    $('#timerMode').textContent = this.mode === 'focus' ? (this.tick ? '专注中…' : '准备专注') : (this.tick ? '休息中…' : '准备休息');
    $('#modeFocus').className = this.mode === 'focus' ? 'btn' : 'btn2';
    $('#modeBreak').className = this.mode === 'break' ? 'btn' : 'btn2';
    document.title = this.tick ? `${text} ${this.mode === 'focus' ? '专注' : '休息'} · EduPuzzle` : 'EduPuzzle 青科大学生全能学习工作台';
  },

  // 结束提示音（浏览器自带音频接口，不需要音频文件）
  beep() {
    try {
      const ctx = new AudioContext(), o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    } catch { /* 浏览器不支持就不响 */ }
  },
};
