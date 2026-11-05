// ===== 专业课程库：学院 → 专业 → 年级学期 → 课程 =====
// 当前选择存在 ep_myCourse：{ college, major, term, course }
// 用户自定义课程存在 ep_customCourses：{ '专业名|学期': ['课程', ...] }
// 资料、试卷按「课程名」归档；不同学期内容不同的课程用不同课程名区分（如 高等数学（上）/（下））。

const Course = {
  current() { return LS.get('myCourse', null); },
  custom() { return LS.get('customCourses', {}); },

  init() {
    $('#selCollege').innerHTML = QUST.map((c, i) => `<option value="${i}">${esc(c.college)}（${c.campus}）</option>`).join('');
    $('#selTerm').innerHTML = TERMS.map(t => `<option>${t}</option>`).join('');
    // 课程名联想列表（单词页绑定课程用）
    const all = new Set(COMMON_COURSES);
    QUST.forEach(c => c.majors.forEach(m => TERMS.forEach(t => this.termCourses(c, m, t).forEach(x => all.add(x)))));
    Object.values(this.custom()).flat().forEach(x => all.add(x));
    $('#courseList').innerHTML = [...all, '公共英语'].map(x => `<option value="${esc(x)}">`).join('');

    // 恢复上次的选择
    const cur = this.current();
    const ci = cur ? QUST.findIndex(c => c.college === cur.college) : 0;
    $('#selCollege').value = Math.max(ci, 0);
    if (cur?.term) $('#selTerm').value = cur.term;
    this.onCollege(cur?.major);
  },

  college() { return QUST[+$('#selCollege').value]; },
  major() { return this.college().majors.find(m => m.name === $('#selMajor').value); },

  onCollege(major) {
    const col = this.college(), majors = col.majors;
    // 告诉用户这个学院的专业名单是否核对过、出处在哪
    $('#courseNote').textContent = (col.verified ? '✓ 专业名单已对照学院官网核对' : '⚠ 专业名单未能完整核对，可用下方「添加课程」补充')
      + `（${col.src}）。学期课表为参考培养方案整理，请以本校培养方案为准。`;
    $('#selMajor').innerHTML = majors.map(m => `<option>${esc(m.name)}</option>`).join('');
    if (major && majors.some(m => m.name === major)) $('#selMajor').value = major;
    this.renderCourses();
  },

  // 某专业某学期的课程：
  //   专业写了 terms → 直接用；
  //   否则 = 公共课学期表 + 专业核心课按顺序平均分到 大一下 ~ 大三下
  termCourses(col, major, term) {
    if (!major) return [];
    if (major.terms) return major.terms[term] || [];
    const common = (col.arts ? ARTS_COMMON_TERMS : COMMON_TERMS)[term] || [];
    const core = major.courses || [];
    const ti = TERMS.indexOf(term);
    // shortcut: 核心课按数组顺序分学期，不是真实培养方案；有培养方案时给专业写 terms 覆盖
    // 第 i 门核心课均匀铺到 大一下(1) ~ 大三下(5)，首尾学期都有课
    const termOf = i => core.length > 1 ? 1 + Math.round(i * 4 / (core.length - 1)) : 1;
    const mine = ti < 1 ? [] : core.filter((_, i) => termOf(i) === ti);
    return [...common, ...mine];
  },

  // 当前专业 + 学期 的课程（含自定义），去重
  coursesNow() {
    const key = `${$('#selMajor').value}|${$('#selTerm').value}`;
    return [...new Set([...this.termCourses(this.college(), this.major(), $('#selTerm').value), ...(this.custom()[key] || [])])];
  },

  renderCourses() {
    const cur = this.current();
    const list = this.coursesNow();
    $('#courseGrid').innerHTML = list.map(c => `
      <button class="course ${cur?.course === c ? 'active' : ''}" data-c="${esc(c)}" onclick="Course.pick(this.dataset.c)">
        ${esc(c)}${outlineOf(c) ? ' <span class="opacity-60 text-xs">📚</span>' : ''}${templatesOf(c).length ? ' <span class="opacity-60 text-xs">🧪</span>' : ''}
      </button>`).join('') || '<span class="text-sm text-slate-400">这个学期还没有课程，可以在下面自定义添加。</span>';
    this.renderPanel();
  },

  addCustom() {
    const name = $('#newCourse').value.trim();
    if (!name) return;
    const key = `${$('#selMajor').value}|${$('#selTerm').value}`, all = this.custom();
    all[key] = [...new Set([...(all[key] || []), name])];
    LS.set('customCourses', all);
    $('#newCourse').value = '';
    this.pick(name);
  },

  pick(course) {
    LS.set('myCourse', { college: this.college().college, major: $('#selMajor').value, term: $('#selTerm').value, course });
    this.renderCourses();
    Exam.onCourse();
  },

  renderPanel() {
    const cur = this.current();
    $('#coursePanel').classList.toggle('hidden', !cur);
    if (!cur) return;
    $('#courseTitle').innerHTML = `📖 ${esc(cur.course)}　<span class="text-sm font-normal text-slate-500">${esc(cur.college)} · ${esc(cur.major)} · ${esc(cur.term || '')}</span>`;
  },
};
