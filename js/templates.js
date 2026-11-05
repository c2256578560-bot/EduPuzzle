// ===== 实验计算模板库 =====
// 每个模板是一个对象：
//   id       唯一标识
//   course   配套课程（课程页「本课程配套实验模板」按它匹配，搜索也会用到）
//   cat      实验类型（酸碱滴定 / 配位滴定 / 分光光度 / 重量分析 …）
//   name     实验名称
//   cols     数据表列名（OCR 提取的数字按顺序填进这些列）
//   params   额外参数 [{ k, label, v }]，可省略
//   formula  计算公式说明
//   tips     结果讨论提示（会附在结果和导出的 Markdown 里）
//   demo     示例数据
//   calc(rows, p) → { head, body, note, warn?, plot?, tips? } 或 { msg: '提示文字' }
//
// 新增模板最省事的方法：照着下面同类模板复制一份，改 cols / params / outs 即可。
//   · 「每行算一个结果再求平均」的实验 → 用 perRow({...})，只写每行怎么算（outs）
//   · 「标准曲线」类实验 → 用 stdCurve({...})
//   · 其它需要拟合的 → 直接写 calc

// ---------- 通用数学工具 ----------
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)) : 0;
const rad = a => mean(a.map(x => Math.abs(x - mean(a)))) / Math.abs(mean(a)) * 100;   // 相对平均偏差 %
const pos = x => x > 0 ? x : NaN;            // 体积等必须为正，否则这一行作废

// 最小二乘直线 y = slope·x + intercept
function linfit(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; });
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? sxy * sxy / (sxx * syy) : 1 };
}

// 数字显示：默认 4 位有效数字（保留末尾的 0，如 0.01000），太大太小用科学计数法
const fmt = (x, d = 4) => !Number.isFinite(x) ? '—'
  : (x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-4)) ? x.toExponential(d - 1) : x.toPrecision(d);

// t 分布 95% 双侧临界值，自由度 1~30；更大时近似 1.96
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
  2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
const t95 = df => T95[df - 1] || 1.96;

// 滴定读数：最后两列是 初读数、终读数
const READ = ['初读数/mL', '终读数/mL'];
const dV = r => r.at(-1) - r.at(-2);
const VOUT = { name: 'V/mL', f: r => dV(r), fix: 2, sum: false };   // 显示消耗体积，不参与平均

// ---------- 模板工厂 1：每行算结果 → 平均值、相对平均偏差、标准偏差 ----------
// def.outs: [{ name, f(row, p), fix?(小数位), sum?(false=不汇总), text?(文字结果) }]
// def.radLimit: 相对平均偏差超过多少 % 给出警告（滴定一般 0.2）
// def.extra(p, avg): 追加的结论行 [[标签, 值], ...]，avg 是各结果列的平均值
function perRow(def) {
  return {
    ...def,
    calc(rows, p) {
      const bad = def.check?.(p);
      if (bad) return { msg: bad };
      const vals = rows.map(r => def.outs.map(o => { const v = o.f(r, p); return o.text ? v : (Number.isFinite(v) ? v : NaN); }));
      const show = (v, o) => o.text ? v : !Number.isFinite(v) ? '—' : o.fix != null ? v.toFixed(o.fix) : fmt(v);
      const colOf = j => vals.map(v => v[j]).filter(Number.isFinite);
      const sumCols = def.outs.map((o, j) => o.sum !== false && !o.text && colOf(j).length ? j : -1).filter(j => j >= 0);
      // 没有任何有效数字结果才算无效（雷诺实验这类不求平均的模板没有汇总列）
      if (!def.outs.some((o, j) => !o.text && colOf(j).length)) return { msg: def.emptyMsg || '没有有效数据：请检查读数（终读数应大于初读数）和参数' };

      const pad = Array(def.cols.length).fill('');
      const sumRow = (label, fn) => [label, ...pad, ...def.outs.map((o, j) => sumCols.includes(j) ? fn(colOf(j), o) : '')];
      const body = rows.map((r, i) => [i + 1, ...r, ...vals[i].map((v, j) => show(v, def.outs[j]))]);
      if (sumCols.length) body.push(sumRow('平均值', (a, o) => show(mean(a), o)));
      if (sumCols.length && rows.length > 1) body.push(sumRow('相对平均偏差', a => rad(a).toFixed(2) + '%'), sumRow('标准偏差 s', a => fmt(sd(a), 2)));
      const avg = def.outs.map((_, j) => sumCols.includes(j) ? mean(colOf(j)) : NaN);
      const width = 1 + def.cols.length + def.outs.length;
      // 结论行（如相对误差）：平均值无效时算出来是 NaN，直接不显示
      (def.extra?.(p, avg) || []).filter(([, v]) => !/NaN|Infinity/.test(v))
        .forEach(([k, v]) => body.push([k, ...Array(width - 2).fill(''), v]));

      const over = def.radLimit && rows.length > 1 && sumCols.some(j => rad(colOf(j)) > def.radLimit);
      return {
        head: ['序号', ...def.cols, ...def.outs.map(o => o.name)], body,
        note: typeof def.note === 'function' ? def.note(p, avg) : def.formula,
        warn: over ? `相对平均偏差超过 ${def.radLimit}%，建议检查读数或补做平行实验。` : '',
        tips: def.tips,
      };
    },
  };
}

// 滴定类模板：在 perRow 基础上默认显示消耗体积、偏差限 0.2%
const titration = def => perRow({ radLimit: 0.2, ...def, cols: [...(def.pre || []), ...READ], outs: [VOUT, ...def.outs] });

// ---------- 模板工厂 2：标准曲线法（分光光度、浊度等）----------
// def.x(row, p): 把第一列换算成横坐标浓度；def.unknown(p, cx): 由曲线浓度换算出最终结果 [[标签, 值], ...]
function stdCurve(def) {
  return {
    ...def,
    calc(rows, p) {
      if (rows.length < 3) return { msg: '标准曲线至少需要 3 个点' };
      const xs = rows.map(r => def.x ? def.x(r, p) : r[0]), ys = rows.map(r => r[1]);
      const f = linfit(xs, ys);
      const cx = (p.Ax - f.intercept) / f.slope;
      const extra = def.unknown ? def.unknown(p, cx, f) : [['试样浓度', fmt(cx * (p.dil || 1))]];
      return {
        head: ['序号', ...def.cols, def.xName || 'x'],
        body: [...rows.map((r, i) => [i + 1, ...r, fmt(xs[i])]),
          ['回归方程', '', '', `${def.yl} = ${fmt(f.slope)}·x ${f.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(f.intercept), 3)}`],
          ['相关系数 R²', '', '', f.r2.toFixed(5)], ...extra.map(([k, v]) => [k, '', '', v])],
        note: def.formula,
        warn: f.r2 < 0.999 ? 'R² < 0.999，标准曲线线性不够好，检查是否有点偏离过大。' : '',
        plot: { xs, ys, ...f, xl: def.xName || 'x', yl: def.yl },
        tips: def.tips,
      };
    },
  };
}

const IAC = '无机及分析化学实验';   // 本次重点课程

const TEMPLATES = [
  // ======================= 无机及分析化学实验（大一上） =======================
  titration({
    id: 'naoh', course: IAC, cat: '酸碱滴定', name: '1. NaOH 标准溶液的标定（邻苯二甲酸氢钾）',
    pre: ['KHP 质量 m/g'],
    outs: [{ name: 'c(NaOH)/(mol·L⁻¹)', f: r => r[0] / 204.22 / (pos(dV(r)) / 1000) }],
    formula: 'c(NaOH) = m(KHP) / [M(KHP)·V]，M(KHP) = 204.22 g/mol，酚酞指示剂',
    tips: '① KHP 使用前需在 105~110℃ 干燥；② 近终点半滴操作，微红色 30 s 不褪即为终点；③ NaOH 易吸收 CO₂，应用新煮沸冷却的蒸馏水配制。',
    demo: [[0.5105, 0.00, 24.98], [0.5012, 0.10, 24.62], [0.5220, 0.05, 25.60]],
  }),
  titration({
    id: 'hcl', course: IAC, cat: '酸碱滴定', name: '1. HCl 标准溶液的标定（无水碳酸钠）',
    pre: ['Na₂CO₃ 质量 m/g'],
    outs: [{ name: 'c(HCl)/(mol·L⁻¹)', f: r => 2 * r[0] / 105.99 / (pos(dV(r)) / 1000) }],
    formula: 'Na₂CO₃ + 2HCl → 2NaCl + CO₂ + H₂O；c(HCl) = 2m / [M(Na₂CO₃)·V]，M = 105.99 g/mol，甲基橙指示剂',
    tips: '① Na₂CO₃ 需在 270~300℃ 灼烧至恒重；② 甲基橙由黄变橙为终点，近终点可加热除去 CO₂ 使终点更敏锐。',
    demo: [[0.1325, 0.00, 25.00], [0.1310, 0.05, 24.77], [0.1342, 0.10, 25.42]],
  }),
  titration({
    id: 'vinegar', course: IAC, cat: '酸碱滴定', name: '2. 食醋总酸度的测定',
    params: [{ k: 'c', label: 'c(NaOH)/(mol·L⁻¹)', v: 0.1000 }, { k: 'Vs', label: '吸取食醋 Vs/mL', v: 10.00 },
             { k: 'V0', label: '定容体积 V₀/mL', v: 100 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    outs: [{ name: 'ρ(HAc)/(g·100 mL⁻¹)', f: (r, p) => p.c * pos(dV(r)) / 1000 * 60.05 / (p.Vs * p.Va / p.V0) * 100 }],
    formula: 'ρ(HAc) = c(NaOH)·V·M(HAc) / (Vs·Vₐ/V₀) × 100，M(HAc) = 60.05 g/mol，以 HAc 计',
    tips: '① 计量点在碱性区，用酚酞而不用甲基橙；② 食醋颜色较深时可稀释或用活性炭脱色；③ 食醋中还含其它有机酸，结果为「总酸度」。',
    demo: [[0.00, 18.72], [0.10, 18.85], [0.20, 18.90]],
  }),
  perRow({
    id: 'mixalk', course: IAC, cat: '酸碱滴定', name: '3. 混合碱的测定（双指示剂法）', radLimit: 0.3,
    cols: ['V₁ 酚酞终点/mL', 'V₂ 甲基橙终点(续滴)/mL'],
    params: [{ k: 'c', label: 'c(HCl)/(mol·L⁻¹)', v: 0.1000 }, { k: 'm', label: '试样质量 m/g', v: 2.000 },
             { k: 'V0', label: '定容体积 V₀/mL', v: 250 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    outs: [
      { name: 'w(NaOH)/%', f: ([v1, v2], p) => v1 > v2 ? p.c * (v1 - v2) / 1000 * 40.00 / (p.m * p.Va / p.V0) * 100 : NaN },
      { name: 'w(Na₂CO₃)/%', f: ([v1, v2], p) => p.c * Math.min(v1, v2) / 1000 * 105.99 / (p.m * p.Va / p.V0) * 100 },
      { name: 'w(NaHCO₃)/%', f: ([v1, v2], p) => v2 > v1 ? p.c * (v2 - v1) / 1000 * 84.01 / (p.m * p.Va / p.V0) * 100 : NaN },
    ],
    note: (p, avg) => `判断：${Number.isFinite(avg[0]) ? 'V₁ > V₂，试样为 NaOH + Na₂CO₃' : Number.isFinite(avg[2]) ? 'V₁ < V₂，试样为 Na₂CO₃ + NaHCO₃' : 'V₁ = V₂，试样为 Na₂CO₃'}。M(NaOH)=40.00，M(Na₂CO₃)=105.99，M(NaHCO₃)=84.01`,
    tips: '① 第一终点（酚酞红→无色）要慢滴、充分摇动，防止局部 HCl 过浓生成 CO₂ 逸出；② V₁ > V₂ 为 NaOH + Na₂CO₃，V₁ < V₂ 为 Na₂CO₃ + NaHCO₃；③ 试样溶液应现配现测，防止吸收 CO₂。',
    demo: [[26.32, 11.32], [26.30, 11.30], [26.35, 11.33]],
  }),
  titration({
    id: 'edta', course: IAC, cat: '配位滴定', name: '4. EDTA 标准溶液的标定',
    params: [{ k: 'M', label: '基准物 M/(g·mol⁻¹)（CaCO₃ 100.09，ZnO 81.38）', v: 100.09 },
             { k: 'm', label: '基准物质量 m/g', v: 0.2500 }, { k: 'V0', label: '定容体积 V₀/mL', v: 250 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    check: p => p.M > 0 && p.m > 0 && p.V0 > 0 && p.Va > 0 ? '' : '请填写基准物质参数',
    outs: [{ name: 'c(EDTA)/(mol·L⁻¹)', f: (r, p) => p.m * (p.Va / p.V0) / p.M / (pos(dV(r)) / 1000) }],
    formula: 'c(EDTA) = m·(Vₐ/V₀) / (M·V)',
    tips: '① CaCO₃ 作基准物：pH≥12 用钙指示剂，或 pH≈10 用铬黑T（需加少量 Mg-EDTA）；② ZnO 作基准物：pH 5~6 用二甲酚橙，紫红→亮黄；③ 配位反应较慢，近终点要慢滴。',
    demo: [[0.02, 24.98], [0.10, 25.10], [0.05, 25.01]],
  }),
  titration({
    id: 'hardness', course: IAC, cat: '配位滴定', name: '4. 水的总硬度测定（EDTA 法）',
    params: [{ k: 'c', label: 'c(EDTA)/(mol·L⁻¹)', v: 0.01000 }, { k: 'Vw', label: '水样体积 V水/mL', v: 100.0 }],
    outs: [
      { name: '总硬度 ρ(CaCO₃)/(mg·L⁻¹)', f: (r, p) => p.c * pos(dV(r)) * 100.09 / p.Vw * 1000 },
      { name: '德国度 /°dH', f: (r, p) => p.c * pos(dV(r)) * 56.08 / p.Vw * 1000 / 10 },
    ],
    formula: 'ρ(CaCO₃) = c·V·M(CaCO₃)/V水 ×1000 (mg/L)；1°dH = 10 mg/L CaO',
    tips: '① pH≈10 的 NH₃-NH₄Cl 缓冲溶液，铬黑T 由酒红变纯蓝；② Fe³⁺、Al³⁺ 干扰时加三乙醇胺掩蔽；③ 水样 Mg²⁺ 很少时终点不敏锐，可加 Mg-EDTA。',
    demo: [[0.00, 20.02], [0.05, 20.10], [0.10, 20.08]],
  }),
  perRow({
    id: 'pbbi', course: IAC, cat: '配位滴定', name: '5. 铅铋混合液的连续配位滴定', radLimit: 0.3,
    cols: ['V₁ 滴 Bi³⁺(pH≈1)/mL', 'V₂ 滴 Pb²⁺(pH 5~6)/mL'],
    params: [{ k: 'c', label: 'c(EDTA)/(mol·L⁻¹)', v: 0.02000 }, { k: 'Vs', label: '试液体积 Vs/mL', v: 25.00 }],
    outs: [
      { name: 'ρ(Bi)/(g·L⁻¹)', f: ([v1], p) => p.c * pos(v1) * 208.98 / p.Vs },
      { name: 'ρ(Pb)/(g·L⁻¹)', f: ([, v2], p) => p.c * pos(v2) * 207.2 / p.Vs },
    ],
    formula: 'ρ(Bi) = c·V₁·M(Bi)/Vs，ρ(Pb) = c·V₂·M(Pb)/Vs；M(Bi)=208.98，M(Pb)=207.2；V₂ 为滴完 Bi 后继续消耗的体积',
    tips: '① 利用 lgK(BiY)=27.9 与 lgK(PbY)=18.0 相差大，控制酸度分步滴定；② 二甲酚橙指示剂，紫红→亮黄；③ 先 pH≈1 滴 Bi³⁺，再加六亚甲基四胺调至 pH 5~6 滴 Pb²⁺。',
    demo: [[15.10, 18.20], [15.12, 18.18], [15.08, 18.24]],
  }),
  titration({
    id: 'kmno4', course: IAC, cat: '氧化还原滴定', name: '6. KMnO₄ 标准溶液的标定（草酸钠）',
    pre: ['Na₂C₂O₄ 质量 m/g'],
    outs: [{ name: 'c(KMnO₄)/(mol·L⁻¹)', f: r => 2 / 5 * r[0] / 134.00 / (pos(dV(r)) / 1000) }],
    formula: '2MnO₄⁻ + 5C₂O₄²⁻ + 16H⁺ → 2Mn²⁺ + 10CO₂ + 8H₂O；c(KMnO₄) = (2/5)·m / [M(Na₂C₂O₄)·V]，M = 134.00 g/mol',
    tips: '① 加热到 75~85℃ 滴定，温度过高草酸分解；② 开始反应慢，待第一滴褪色后再加下一滴（Mn²⁺ 自催化）；③ 自身指示剂，微红 30 s 不褪为终点；④ 读数读液面上沿。',
    demo: [[0.1675, 0.00, 25.00], [0.1660, 0.10, 24.88], [0.1702, 0.05, 25.45]],
  }),
  titration({
    id: 'h2o2', course: IAC, cat: '氧化还原滴定', name: '6. 过氧化氢含量的测定（KMnO₄ 法）',
    params: [{ k: 'c', label: 'c(KMnO₄)/(mol·L⁻¹)', v: 0.02000 }, { k: 'Vs', label: '吸取 H₂O₂ 原液 Vs/mL', v: 10.00 },
             { k: 'V0', label: '定容体积 V₀/mL', v: 250 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    outs: [{ name: 'ρ(H₂O₂)/(g·L⁻¹)', f: (r, p) => 5 / 2 * p.c * pos(dV(r)) * 34.01 / (p.Vs * p.Va / p.V0) }],
    formula: '2MnO₄⁻ + 5H₂O₂ + 6H⁺ → 2Mn²⁺ + 5O₂ + 8H₂O；ρ(H₂O₂) = (5/2)·c·V·M(H₂O₂)/(Vs·Vₐ/V₀)，M = 34.01 g/mol',
    tips: '① 室温滴定，不能加热（H₂O₂ 受热分解）；② 可先加 1~2 滴 MnSO₄ 催化；③ 用 H₂SO₄ 调酸度，不能用 HCl。',
    demo: [[0.00, 17.62], [0.10, 17.75], [0.05, 17.70]],
  }),
  titration({
    id: 'na2s2o3', course: IAC, cat: '氧化还原滴定', name: '7. Na₂S₂O₃ 标准溶液的标定（K₂Cr₂O₇）',
    params: [{ k: 'm', label: 'K₂Cr₂O₇ 质量 m/g', v: 1.2260 }, { k: 'V0', label: '定容体积 V₀/mL', v: 250 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    outs: [{ name: 'c(Na₂S₂O₃)/(mol·L⁻¹)', f: (r, p) => 6 * p.m * (p.Va / p.V0) / 294.18 / (pos(dV(r)) / 1000) }],
    formula: 'Cr₂O₇²⁻ + 6I⁻ + 14H⁺ → 2Cr³⁺ + 3I₂；I₂ + 2S₂O₃²⁻ → 2I⁻ + S₄O₆²⁻；n(Cr₂O₇²⁻):n(S₂O₃²⁻) = 1:6，M(K₂Cr₂O₇) = 294.18',
    tips: '① 加 KI 后盖好在暗处放置 5 min，使反应完全；② 滴至浅黄绿色再加淀粉，蓝色→亮绿色为终点，淀粉过早加入会吸附 I₂；③ 防止 I₂ 挥发和 I⁻ 被空气氧化。',
    demo: [[0.00, 25.00], [0.10, 25.12], [0.05, 25.03]],
  }),
  titration({
    id: 'cu', course: IAC, cat: '氧化还原滴定', name: '7. 硫酸铜中铜含量的测定（间接碘量法）',
    pre: ['试样质量 m/g'],
    params: [{ k: 'c', label: 'c(Na₂S₂O₃)/(mol·L⁻¹)', v: 0.1000 }],
    outs: [{ name: 'w(Cu)/%', f: (r, p) => p.c * pos(dV(r)) / 1000 * 63.55 / r[0] * 100 }],
    formula: '2Cu²⁺ + 4I⁻ → 2CuI↓ + I₂；n(Cu):n(S₂O₃²⁻) = 1:1；w(Cu) = c·V·M(Cu)/m，M(Cu) = 63.55',
    tips: '① CuSO₄·5H₂O 中铜理论含量 25.45%，可与结果比较；② 近终点加 KSCN，使 CuI 转化为 CuSCN，释放被吸附的 I₂；③ 保持弱酸性（pH 3~4），酸度过高 I⁻ 易被氧化。',
    demo: [[0.6000, 0.00, 24.03], [0.5980, 0.10, 24.05], [0.6050, 0.05, 24.28]],
  }),
  titration({
    id: 'fecr', course: IAC, cat: '氧化还原滴定', name: '8. 重铬酸钾法测定铁含量',
    params: [{ k: 'c', label: 'c(K₂Cr₂O₇)/(mol·L⁻¹)', v: 0.01667 }, { k: 'm', label: '试样质量 m/g', v: 2.500 },
             { k: 'V0', label: '定容体积 V₀/mL', v: 250 }, { k: 'Va', label: '每次移取 Vₐ/mL', v: 25.00 }],
    outs: [{ name: 'w(Fe)/%', f: (r, p) => 6 * p.c * pos(dV(r)) / 1000 * 55.85 / (p.m * p.Va / p.V0) * 100 }],
    formula: 'Cr₂O₇²⁻ + 6Fe²⁺ + 14H⁺ → 2Cr³⁺ + 6Fe³⁺ + 7H₂O；w(Fe) = 6c·V·M(Fe)/(m·Vₐ/V₀)，M(Fe) = 55.85',
    tips: '① SnCl₂-TiCl₃ 联合预还原 Fe³⁺，过量 Ti³⁺ 用 K₂Cr₂O₇ 氧化（钨蓝褪色）；② 二苯胺磺酸钠指示剂，绿→紫；③ 加 H₃PO₄ 与 Fe³⁺ 配位，降低 Fe³⁺/Fe²⁺ 电位、消除 Fe³⁺ 黄色。',
    demo: [[0.00, 22.38], [0.10, 22.50], [0.05, 22.40]],
  }),
  stdCurve({
    id: 'spec', course: IAC, cat: '分光光度', name: '9. 分光光度法测铁 · 标准曲线法（通用，其它物质也适用）',
    cols: ['标准溶液浓度 c', '吸光度 A'], xName: 'c', yl: 'A',
    params: [{ k: 'Ax', label: '试样吸光度 Aₓ', v: 0.250 }, { k: 'dil', label: '试样稀释倍数', v: 1 }],
    formula: '朗伯-比尔定律 A = εbc；以标准系列 A 对 c 作图，由试样 Aₓ 在曲线上求浓度，再乘稀释倍数',
    tips: '① 用试剂空白作参比；② 吸光度控制在 0.2~0.8 误差较小；③ 标准曲线 R² 一般应 ≥ 0.999；④ 试样与标准系列在相同条件下显色、测定。',
    demo: [[0, 0.002], [1, 0.101], [2, 0.198], [3, 0.302], [4, 0.399], [5, 0.502]],
  }),
  titration({
    id: 'vc', course: IAC, cat: '氧化还原滴定', name: '13. 维生素 C 含量测定（直接碘量法）',
    pre: ['试样质量 m/g'],
    params: [{ k: 'c', label: 'c(I₂)/(mol·L⁻¹)', v: 0.05000 }],
    outs: [{ name: 'w(Vc)/%', f: (r, p) => p.c * pos(dV(r)) / 1000 * 176.12 / r[0] * 100 }],
    formula: 'C₆H₈O₆ + I₂ → C₆H₆O₆ + 2HI；n(Vc):n(I₂) = 1:1；w = c·V·M(Vc)/m，M(Vc) = 176.12',
    tips: '① 在 HAc 介质中滴定，减少 Vc 被空气氧化；② 试样溶解后立即滴定；③ 淀粉作指示剂，出现蓝色 30 s 不褪为终点。',
    demo: [[0.2000, 0.00, 22.48], [0.2015, 0.10, 22.75], [0.1990, 0.05, 22.42]],
  }),
  perRow({
    id: 'hacka', course: IAC, cat: '电位法', name: '10. 醋酸解离常数的测定（pH 法）',
    cols: ['c(HAc)/(mol·L⁻¹)', 'pH'],
    params: [{ k: 'ref', label: 'Ka 文献值（25℃）', v: 1.75e-5 }],
    outs: [
      { name: '[H⁺]/(mol·L⁻¹)', f: ([, ph]) => 10 ** -ph, sum: false },
      { name: '解离度 α/%', f: ([c, ph]) => 10 ** -ph / c * 100, sum: false },
      { name: 'Ka', f: ([c, ph]) => { const h = 10 ** -ph; return c > h ? h * h / (c - h) : NaN; } },
    ],
    extra: (p, avg) => [['与文献值相对误差', ((avg[2] - p.ref) / p.ref * 100).toFixed(1) + '%']],
    formula: 'HAc ⇌ H⁺ + Ac⁻；[H⁺] = 10^(−pH)，Ka = [H⁺]² / (c − [H⁺])，α = [H⁺]/c',
    tips: '① 由稀到浓依次测定 pH，减少电极残留误差；② 酸度计用标准缓冲溶液校准；③ 记录溶液温度，Ka 随温度变化；④ 浓度越稀，解离度越大。',
    demo: [[0.1000, 2.88], [0.05000, 3.03], [0.02500, 3.18], [0.01250, 3.34]],
  }),
  perRow({
    id: 'baso4', course: IAC, cat: '重量分析', name: '11. BaSO₄ 沉淀重量法测定硫酸根（硫）',
    cols: ['试样质量 m/g', '空坩埚质量/g', '坩埚+BaSO₄/g'],
    outs: [
      { name: 'm(BaSO₄)/g', f: r => pos(r[2] - r[1]), fix: 4, sum: false },
      { name: 'w(SO₄²⁻)/%', f: r => pos(r[2] - r[1]) * 96.06 / 233.39 / r[0] * 100 },
      { name: 'w(S)/%', f: r => pos(r[2] - r[1]) * 32.06 / 233.39 / r[0] * 100 },
    ],
    formula: 'Ba²⁺ + SO₄²⁻ → BaSO₄↓；换算因数 F(SO₄²⁻) = 96.06/233.39，F(S) = 32.06/233.39',
    tips: '① 在稀、热的 HCl 溶液中慢慢加入沉淀剂，得到大颗粒晶形沉淀；② 沉淀需陈化；③ 灼烧至恒重（两次称量差 ≤ 0.3 mg）；④ 洗涤至无 Cl⁻（AgNO₃ 检验）。',
    demo: [[0.4000, 20.1234, 20.6434], [0.4010, 19.8765, 20.3978], [0.3995, 21.0021, 21.5208]],
  }),
  stdCurve({
    id: 'phen', course: IAC, cat: '分光光度', name: '12. 邻二氮菲分光光度法测定铁',
    cols: ['铁标液体积 V/mL', '吸光度 A'], xName: 'ρ(Fe)/(μg·mL⁻¹)', yl: 'A',
    params: [{ k: 'rho', label: '铁标准溶液 ρ/(μg·mL⁻¹)', v: 10.0 }, { k: 'Vf', label: '容量瓶体积/mL', v: 50 },
             { k: 'Ax', label: '试样吸光度 Aₓ', v: 0.300 }, { k: 'Vs', label: '试样取样体积/mL', v: 5.00 }],
    x: (r, p) => p.rho * r[0] / p.Vf,
    unknown: (p, cx, f) => [['容量瓶中 ρ(Fe)', fmt(cx) + ' μg/mL'], ['原试液 ρ(Fe)', fmt(cx * p.Vf / p.Vs) + ' μg/mL'],
      ['摩尔吸光系数 ε（1 cm 比色皿）', fmt(f.slope * 55.85 * 1000, 3) + ' L·mol⁻¹·cm⁻¹']],
    formula: 'Fe²⁺ 与邻二氮菲生成橙红色配合物，λmax ≈ 510 nm；ρᵢ = ρ标·Vᵢ/V瓶，由标准曲线求 ρₓ，原试液 = ρₓ·V瓶/V样',
    tips: '① 先加盐酸羟胺把 Fe³⁺ 还原为 Fe²⁺；② 用 NaAc 控制 pH≈5；③ 显色后放置 10 min 再测；④ 文献 ε ≈ 1.1×10⁴ L·mol⁻¹·cm⁻¹，可与结果比较。',
    demo: [[0, 0.000], [2, 0.080], [4, 0.157], [6, 0.237], [8, 0.314], [10, 0.395]],
  }),

  // ======================= 大学物理实验 =======================
  perRow({
    id: 'pendulum', course: '大学物理实验', cat: '力学', name: '单摆测重力加速度',
    cols: ['摆长 L/cm', '全振动次数 n', '总时间 t/s'],
    params: [{ k: 'g0', label: '当地标准 g/(m·s⁻²)', v: 9.80 }],
    outs: [{ name: '周期 T/s', f: r => r[2] / r[1], fix: 3, sum: false }, { name: 'g/(m·s⁻²)', f: r => 4 * Math.PI ** 2 * (r[0] / 100) / (r[2] / r[1]) ** 2 }],
    extra: (p, avg) => [['相对误差', ((avg[1] - p.g0) / p.g0 * 100).toFixed(2) + '%']],
    formula: 'T = t/n，g = 4π²L/T²（L 为悬点到摆球球心距离）',
    tips: '① 摆角小于 5°；② 从摆球经过最低点时开始计时；③ 测 30~50 次全振动减小计时误差。',
    demo: [[100.0, 30, 60.18], [100.0, 30, 60.15], [100.0, 30, 60.22]],
  }),
  {
    id: 'young', course: '大学物理实验', cat: '力学', name: '拉伸法测杨氏模量（光杠杆）',
    cols: ['砝码质量 m/kg', '标尺读数 n/cm'],
    params: [{ k: 'L', label: '钢丝长 L/m', v: 0.800 }, { k: 'D', label: '镜面到标尺 D/m', v: 1.500 },
             { k: 'd', label: '钢丝直径 d/mm', v: 0.600 }, { k: 'b', label: '光杠杆前后足距 b/cm', v: 7.00 }],
    formula: 'E = 8FLD / (πd²b·Δn)；对 n ~ F 线性拟合得斜率 k = Δn/F，E = 8LD/(πd²b·k)，F = mg',
    tips: '① 加减砝码各测一次取平均，消除弹性滞后；② 钢丝直径在不同位置多次测量；③ 光杠杆调好后实验中不能碰动。',
    demo: [[0, 2.00], [1, 2.59], [2, 3.19], [3, 3.78], [4, 4.38], [5, 4.97]],
    calc(rows, p) {
      if (rows.length < 3) return { msg: '至少需要 3 组数据' };
      const F = rows.map(r => r[0] * 9.8), n = rows.map(r => r[1] / 100);
      const f = linfit(F, n), E = 8 * p.L * p.D / (Math.PI * (p.d / 1000) ** 2 * (p.b / 100) * f.slope);
      return {
        head: ['序号', 'm/kg', 'n/cm', 'F/N'], body: [...rows.map((r, i) => [i + 1, r[0], r[1], fmt(F[i])]),
          ['斜率 k', '', '', fmt(f.slope) + ' m/N'], ['R²', '', '', f.r2.toFixed(5)], ['杨氏模量 E', '', '', fmt(E, 3) + ' Pa']],
        note: this.formula, plot: { xs: F, ys: n, ...f, xl: 'F / N', yl: 'n / m' }, tips: this.tips,
      };
    },
  },
  perRow({
    id: 'wheatstone', course: '大学物理实验', cat: '电学', name: '惠斯通电桥测电阻',
    cols: ['比例臂 R₁/Ω', '比例臂 R₂/Ω', '平衡时 Rs/Ω'],
    outs: [{ name: 'Rₓ/Ω', f: r => r[0] / r[1] * r[2] }],
    formula: '电桥平衡时 Rₓ = (R₁/R₂)·Rs',
    tips: '① 选择合适比例臂，使 Rs 有 4 位有效数字；② 交换 Rₓ 与 Rs 位置再测一次可消除比例臂误差。',
    demo: [[100, 100, 512.3], [100, 1000, 5123], [1000, 100, 51.24]],
  }),
  {
    id: 'photo', course: '大学物理实验', cat: '近代物理', name: '光电效应测普朗克常量',
    cols: ['频率 ν/(10¹⁴ Hz)', '截止电压 U₀/V'],
    params: [{ k: 'h0', label: 'h 公认值/(J·s)', v: 6.626e-34 }],
    formula: 'eU₀ = hν − W，对 U₀ ~ ν 线性拟合，h = 斜率 × e，逸出功 W = −截距 (eV)',
    tips: '① 测量前预热汞灯和仪器 20 min；② 每换一次滤光片都要重新调零；③ 暗电流和反向电流会使截止电压测量偏差。',
    demo: [[5.19, 0.150], [5.49, 0.268], [6.88, 0.848], [7.41, 1.062], [8.22, 1.402]],
    calc(rows, p) {
      if (rows.length < 3) return { msg: '至少需要 3 组数据' };
      const xs = rows.map(r => r[0]), ys = rows.map(r => r[1]), f = linfit(xs, ys);
      const h = f.slope * 1.602e-19 / 1e14;
      return {
        head: ['序号', 'ν/(10¹⁴ Hz)', 'U₀/V'], body: [...rows.map((r, i) => [i + 1, r[0], r[1]]),
          ['斜率 h/e', '', fmt(f.slope / 1e14) + ' V·s'], ['普朗克常量 h', '', fmt(h) + ' J·s'],
          ['相对误差', '', ((h - p.h0) / p.h0 * 100).toFixed(2) + '%'], ['逸出功 W', '', fmt(-f.intercept, 3) + ' eV'], ['R²', '', f.r2.toFixed(5)]],
        note: this.formula, plot: { xs, ys, ...f, xl: 'ν / 10¹⁴ Hz', yl: 'U₀ / V' }, tips: this.tips,
      };
    },
  },
  {
    id: 'hooke', course: '大学物理实验', cat: '力学', name: '胡克定律测弹簧劲度系数',
    cols: ['拉力 F/N', '伸长量 x/cm'],
    formula: 'F = k·x，对 F ~ x 线性拟合，斜率即劲度系数 k（x 换算为 m）',
    tips: '① 不要超过弹簧弹性限度；② 加载和卸载各读一次取平均。',
    demo: [[0.5, 1.02], [1.0, 2.01], [1.5, 2.98], [2.0, 4.03], [2.5, 5.00]],
    calc(rows) {
      if (rows.length < 2) return { msg: '至少需要 2 组数据' };
      const xs = rows.map(r => r[1] / 100), ys = rows.map(r => r[0]), f = linfit(xs, ys);
      return {
        head: ['序号', 'F/N', 'x/cm', 'x/m'],
        body: [...rows.map((r, i) => [i + 1, r[0], r[1], fmt(xs[i])]),
          ['劲度系数 k', '', '', fmt(f.slope) + ' N/m'], ['截距', '', '', fmt(f.intercept, 3) + ' N'], ['R²', '', '', f.r2.toFixed(5)]],
        note: this.formula, plot: { xs, ys, ...f, xl: 'x / m', yl: 'F / N' }, tips: this.tips,
      };
    },
  },
  perRow({
    id: 'freefall', course: '大学物理实验', cat: '力学', name: '自由落体测重力加速度',
    cols: ['下落高度 h/m', '时间 t/s'],
    params: [{ k: 'g0', label: '当地标准 g/(m·s⁻²)', v: 9.80 }],
    outs: [{ name: 'g/(m·s⁻²)', f: ([h, t]) => 2 * h / pos(t) ** 2 }],
    extra: (p, avg) => [['相对误差', ((avg[0] - p.g0) / p.g0 * 100).toFixed(2) + '%']],
    formula: 'g = 2h / t²',
    tips: '① 光电门要与下落路径对正；② 小球从静止释放。',
    demo: [[1.000, 0.452], [1.000, 0.451], [1.000, 0.453]],
  }),
  {
    id: 'ohm', course: '大学物理实验', cat: '电学', name: '伏安法测电阻',
    cols: ['电压 U/V', '电流 I/mA'],
    formula: 'Rᵢ = U / I；同时对 U ~ I 线性拟合，斜率即电阻 R',
    tips: '① 根据 Rₓ 与电表内阻大小选择电流表内接或外接；② 通电时间不宜过长，防止电阻发热。',
    demo: [[1.0, 10.1], [2.0, 19.8], [3.0, 30.2], [4.0, 39.9]],
    calc(rows) {
      const ok = rows.filter(r => r[1] !== 0);
      if (ok.length < 2) return { msg: '至少需要 2 组电流不为 0 的数据' };
      const xs = ok.map(r => r[1] / 1000), ys = ok.map(r => r[0]), R = ok.map(([u, i]) => u / (i / 1000)), f = linfit(xs, ys);
      return {
        head: ['序号', 'U/V', 'I/mA', 'R/Ω'],
        body: [...ok.map((r, i) => [i + 1, r[0], r[1], fmt(R[i])]), ['平均值', '', '', fmt(mean(R)) + ' Ω'],
          ['相对平均偏差', '', '', rad(R).toFixed(2) + '%'], ['拟合电阻（斜率）', '', '', fmt(f.slope) + ' Ω'], ['R²', '', '', f.r2.toFixed(5)]],
        note: this.formula, plot: { xs, ys, ...f, xl: 'I / A', yl: 'U / V' }, tips: this.tips,
      };
    },
  },

  // ======================= 化工原理实验 =======================
  perRow({
    id: 'reynolds', course: '化工原理实验', cat: '流体流动', name: '雷诺实验（流型判断）',
    cols: ['接水体积 V/mL', '时间 t/s'],
    params: [{ k: 'd', label: '管内径 d/mm', v: 20 }, { k: 'nu', label: '运动黏度 ν/(10⁻⁶ m²·s⁻¹)（20℃ 水 1.004）', v: 1.004 }],
    outs: [
      { name: '流速 u/(m·s⁻¹)', f: ([V, t], p) => V * 1e-6 / pos(t) / (Math.PI * (p.d / 1000) ** 2 / 4), sum: false },
      { name: 'Re', f: ([V, t], p) => V * 1e-6 / pos(t) / (Math.PI * (p.d / 1000) ** 2 / 4) * (p.d / 1000) / (p.nu * 1e-6), sum: false },
      { name: '流型', text: true, f: ([V, t], p) => { const re = V * 1e-6 / t / (Math.PI * (p.d / 1000) ** 2 / 4) * (p.d / 1000) / (p.nu * 1e-6); return re < 2000 ? '层流' : re > 4000 ? '湍流' : '过渡流'; } },
    ],
    emptyMsg: '时间必须大于 0',
    formula: 'u = V/(t·πd²/4)，Re = u·d/ν；Re < 2000 层流，2000~4000 过渡流，Re > 4000 湍流',
    tips: '① 实验中保持水箱液位稳定（溢流）；② 记录水温查运动黏度；③ 观察红墨水线形态与计算结果是否一致。',
    demo: [[473, 20.0], [1250, 20.0], [2600, 20.0]],
  }),
  perRow({
    id: 'heat', course: '化工原理实验', cat: '传热', name: '套管换热器总传热系数测定',
    cols: ['空气流量 q/(m³·h⁻¹)', '进口 t₁/℃', '出口 t₂/℃', '蒸汽温度 T/℃'],
    params: [{ k: 'A', label: '传热面积 A/m²', v: 0.120 }, { k: 'rho', label: '空气密度 ρ/(kg·m⁻³)', v: 1.205 }, { k: 'cp', label: '空气比热 cp/(J·kg⁻¹·K⁻¹)', v: 1005 }],
    outs: [
      { name: 'Q/W', f: ([q, t1, t2], p) => q / 3600 * p.rho * p.cp * (t2 - t1), sum: false },
      { name: 'Δtm/℃', f: ([, t1, t2, T]) => ((T - t1) - (T - t2)) / Math.log((T - t1) / (T - t2)), sum: false },
      { name: 'K/(W·m⁻²·K⁻¹)', f: ([q, t1, t2, T], p) => q / 3600 * p.rho * p.cp * (t2 - t1) / (p.A * ((T - t1) - (T - t2)) / Math.log((T - t1) / (T - t2))) },
    ],
    formula: 'Q = qᵥρcₚ(t₂ − t₁)，Δtm = [(T−t₁) − (T−t₂)] / ln[(T−t₁)/(T−t₂)]，K = Q/(A·Δtm)',
    tips: '① 每改变一次流量要等温度稳定后再读数；② 及时排除不凝性气体；③ K 随空气流量增大而增大，可讨论原因（对流传热系数增大）。',
    demo: [[20, 20, 70, 100], [30, 20, 65, 100], [40, 20, 61, 100]],
  }),

  // ======================= 环境监测 =======================
  perRow({
    id: 'cod', course: '环境监测', cat: '水质分析', name: 'COD 测定（重铬酸钾法）',
    cols: ['空白消耗 V₀/mL', '水样消耗 V₁/mL'],
    params: [{ k: 'c', label: 'c[(NH₄)₂Fe(SO₄)₂]/(mol·L⁻¹)', v: 0.1000 }, { k: 'Vw', label: '水样体积/mL', v: 20.00 }],
    outs: [{ name: 'COD/(mg·L⁻¹)', f: ([v0, v1], p) => pos(v0 - v1) * p.c * 8 * 1000 / p.Vw }],
    formula: 'COD(O₂, mg/L) = (V₀ − V₁)·c·8·1000 / V水',
    tips: '① 加 Ag₂SO₄ 催化，加 HgSO₄ 掩蔽 Cl⁻；② 回流 2 h；③ 试亚铁灵指示剂，黄→蓝绿→红褐为终点。',
    demo: [[24.80, 18.50], [24.80, 18.55], [24.80, 18.45]],
  }),
  stdCurve({
    id: 'turbidity', course: '环境监测', cat: '水质分析', name: '浊度测定（标准曲线法）',
    cols: ['标准浊度/NTU', '吸光度（或散射光读数）'], xName: '浊度/NTU', yl: '读数',
    params: [{ k: 'Ax', label: '水样读数', v: 0.180 }, { k: 'dil', label: '稀释倍数', v: 1 }],
    unknown: (p, cx) => [['水样浊度', fmt(cx * (p.dil || 1), 3) + ' NTU']],
    formula: '以福尔马肼标准浊度系列作标准曲线，由水样读数求浊度',
    tips: '① 比色皿外壁擦干净，无气泡；② 水样摇匀后立即测定。',
    demo: [[0, 0.000], [10, 0.052], [20, 0.101], [40, 0.205], [60, 0.304], [80, 0.401]],
  }),

  // ======================= 物理化学实验 =======================
  perRow({
    id: 'freeze', course: '物理化学实验', cat: '热力学', name: '凝固点降低法测摩尔质量',
    cols: ['溶质 m_B/g', '溶剂 m_A/g', '凝固点降低 ΔTf/K'],
    params: [{ k: 'Kf', label: '溶剂 Kf/(K·kg·mol⁻¹)（环己烷 20.0，水 1.86）', v: 20.0 }],
    outs: [{ name: 'M_B/(g·mol⁻¹)', f: ([mb, ma, dt], p) => p.Kf * mb * 1000 / (pos(dt) * ma) }],
    formula: 'ΔTf = Kf·b_B，M_B = Kf·m_B·1000 / (ΔTf·m_A)',
    tips: '① 控制过冷程度不超过 0.5 K；② 搅拌速度保持一致；③ 溶液浓度不宜过大，否则偏离稀溶液规律。',
    demo: [[0.1500, 20.00, 1.170], [0.1500, 20.00, 1.165], [0.1500, 20.00, 1.175]],
  }),
  {
    id: 'viscosity', course: '物理化学实验', cat: '高分子溶液', name: '黏度法测高聚物分子量',
    cols: ['浓度 c/(g·mL⁻¹)', '流出时间 t/s'],
    params: [{ k: 't0', label: '纯溶剂流出时间 t₀/s', v: 100.0 }, { k: 'K', label: 'K/(mL·g⁻¹)', v: 0.0666 }, { k: 'a', label: 'α', v: 0.64 }],
    formula: 'ηr = t/t₀，ηsp = ηr − 1；ηsp/c 对 c 外推到 c→0 得特性黏度 [η]；M = ([η]/K)^(1/α)（K、α 按体系查表，默认聚乙烯醇-水 30℃）',
    tips: '① 恒温槽温度波动 ≤ ±0.05℃；② 每个浓度流出时间测 3 次，相差不超过 0.3 s；③ 黏度计必须垂直放置。',
    demo: [[0.0020, 112.58], [0.0015, 109.32], [0.0010, 106.14], [0.0005, 103.04]],
    calc(rows, p) {
      if (rows.length < 3) return { msg: '至少需要 3 个浓度' };
      const xs = rows.map(r => r[0]), sp = rows.map(r => r[1] / p.t0 - 1), ys = sp.map((s, i) => s / xs[i]);
      const f = linfit(xs, ys), M = (f.intercept / p.K) ** (1 / p.a);
      return {
        head: ['序号', 'c/(g·mL⁻¹)', 't/s', 'ηsp', 'ηsp/c'],
        body: [...rows.map((r, i) => [i + 1, r[0], r[1], fmt(sp[i]), fmt(ys[i])]),
          ['特性黏度 [η]', '', '', '', fmt(f.intercept) + ' mL/g'], ['R²', '', '', '', f.r2.toFixed(5)], ['黏均分子量 M', '', '', '', fmt(M, 3)]],
        note: this.formula, plot: { xs, ys, ...f, xl: 'c / (g·mL⁻¹)', yl: 'ηsp/c' }, tips: this.tips,
      };
    },
  },
  {
    id: 'arrhenius', course: '物理化学实验', cat: '动力学', name: '反应活化能（阿伦尼乌斯）',
    cols: ['温度/℃', '速率常数 k'],
    formula: 'ln k = ln A − Ea/(R·T)，对 ln k ~ 1/T 线性拟合，Ea = −斜率 × R，R = 8.314 J·mol⁻¹·K⁻¹',
    tips: '① 各温度下恒温充分后再测；② 至少测 3~4 个温度点。',
    demo: [[25, 0.0115], [35, 0.0302], [45, 0.0751]],
    calc(rows) {
      const pts = rows.map(([t, k]) => [t + 273.15, k]).filter(([T, k]) => T > 0 && k > 0);
      if (pts.length < 2 || new Set(pts.map(q => q[0])).size < 2) return { msg: '至少需要 2 个不同温度、k > 0 的数据' };
      const xs = pts.map(q => 1 / q[0]), ys = pts.map(q => Math.log(q[1])), f = linfit(xs, ys), Ea = -f.slope * 8.314;
      return {
        head: ['序号', 'T/K', '(1/T)/K⁻¹', 'k', 'ln k'],
        body: [...pts.map((q, i) => [i + 1, q[0].toFixed(2), xs[i].toExponential(4), q[1], ys[i].toFixed(4)]),
          ['斜率', '', fmt(f.slope) + ' K', '', ''], ['R²', '', f.r2.toFixed(5), '', ''],
          ['活化能 Ea', '', (Ea / 1000).toFixed(2) + ' kJ·mol⁻¹', '', ''], ['指前因子 A', '', fmt(Math.exp(f.intercept)), '', '']],
        note: this.formula, warn: f.r2 < 0.99 && pts.length > 2 ? 'R² < 0.99，线性较差，建议检查数据。' : '',
        plot: { xs, ys, ...f, xl: '1/T', yl: 'ln k' }, tips: this.tips,
      };
    },
  },

  // ======================= 通用数据处理 =======================
  {
    id: 'stats', course: '通用数据处理', cat: '统计', name: '重复测量数据统计（含 Q 检验）',
    cols: ['测量值'],
    params: [{ k: 'truth', label: '真值 / 标准值（可不填）', v: '' }],
    formula: '平均值、相对平均偏差、标准偏差 s（n−1）、RSD、95% 置信区间 x̄ ± t·s/√n；Q 检验判断可疑值（90% 置信度）',
    tips: '① 先用 Q 检验判断最大、最小值是否应舍弃；② 填写真值可计算相对误差。',
    demo: [[10.12], [10.15], [10.09], [10.14], [10.11]],
    calc(rows, p) {
      const v = rows.map(r => r[0]), n = v.length;
      if (n < 2) return { msg: '至少需要 2 个测量值' };
      const m = mean(v), s = sd(v), half = t95(n - 1) * s / Math.sqrt(n);
      const body = [...v.map((x, i) => [i + 1, x, fmt(x - m, 3)]),
        ['n', '', n], ['平均值', '', fmt(m, 5)], ['相对平均偏差', '', rad(v).toFixed(2) + '%'], ['标准偏差 s', '', fmt(s, 3)],
        ['RSD', '', fmt(s / m * 100, 3) + '%'], ['95% 置信区间', '', `${fmt(m, 5)} ± ${fmt(half, 3)}`]];
      // Q 检验（90% 置信度临界值，n = 3~10）
      const Q90 = { 3: 0.94, 4: 0.76, 5: 0.64, 6: 0.56, 7: 0.51, 8: 0.47, 9: 0.44, 10: 0.41 };
      if (Q90[n]) {
        const sv = [...v].sort((a, b) => a - b), range = sv[n - 1] - sv[0];
        const qLow = range ? (sv[1] - sv[0]) / range : 0, qHigh = range ? (sv[n - 1] - sv[n - 2]) / range : 0;
        body.push(['Q 检验（最小值 ' + sv[0] + '）', '', `Q=${qLow.toFixed(2)}，${qLow > Q90[n] ? '应舍弃' : '保留'}`],
                  ['Q 检验（最大值 ' + sv[n - 1] + '）', '', `Q=${qHigh.toFixed(2)}，${qHigh > Q90[n] ? '应舍弃' : '保留'}`]);
      }
      if (Number.isFinite(p.truth)) body.push(['相对误差', '', fmt((m - p.truth) / p.truth * 100, 3) + '%']);
      return { head: ['序号', '测量值', '偏差 xᵢ − x̄'], body, note: `t(0.95, ${n - 1}) = ${t95(n - 1)}`, tips: this.tips };
    },
  },
];

// 课程配套模板：课程名完全一致，或课程名包含模板课程名（如「大学物理实验（上）」匹配「大学物理实验」）
const templatesOf = course => course ? TEMPLATES.filter(t => course === t.course || course.includes(t.course)) : [];

// 用户自定义模板 → 统一成上面的模板格式
// 自定义模板：{ id, course, cat, name, cols: [...], formula: 'c/(a*b)', result: '比热容' }
function customToTpl(c) {
  const vars = 'abcdefghij'.slice(0, c.cols.length).split('');
  // shortcut: 公式用 new Function 执行，只适合在自己浏览器里用自己写的公式；不要导入别人的模板
  const fn = new Function(...vars, `with (Math) { return (${c.formula}); }`);
  return perRow({
    ...c, course: c.course || c.cat || '我的模板', cat: c.cat || '自定义', custom: true, demo: [[]],
    outs: [{ name: c.result, f: r => fn(...r) }],
    formula: `${c.result} = ${c.formula}（${c.cols.map((x, i) => vars[i] + ' = ' + x).join('，')}）`,
    emptyMsg: '公式没有算出有效数字，请检查数据或公式',
  });
}

// 自检：打开控制台若看到「自检失败」说明公式被改坏了
(function selfTest() {
  const T = id => TEMPLATES.find(t => t.id === id);
  const Ea = 50000, A = 1e7;
  const r = T('arrhenius').calc([300, 320, 340].map(K => [K - 273.15, A * Math.exp(-Ea / (8.314 * K))]));
  console.assert(r.body.some(row => row[2] === '50.00 kJ·mol⁻¹'), '活化能计算自检失败');
  // 0.2500 g CaCO₃ 定容 250 mL 取 25 mL，消耗 25.00 mL → c = 1/100.09
  const e = T('edta').calc([[0, 25], [0.1, 25.1]], { M: 100.09, m: 0.25, V0: 250, Va: 25 });
  console.assert(e.body.find(x => x[0] === '平均值')[4] === fmt(1 / 100.09), 'EDTA 计算自检失败');
  // 0.5105 g KHP 消耗 24.98 mL → 0.1001 mol/L
  const k = T('naoh').calc([[0.5105, 0, 24.98]], {});
  console.assert(k.body[0][5] === '0.1001', 'NaOH 标定自检失败');
  // 混合碱：V1 > V2 时只有 NaOH 和 Na₂CO₃
  const mx = T('mixalk').calc([[26.32, 11.32]], { c: 0.1, m: 2, V0: 250, Va: 25 });
  console.assert(mx.body[0][3] === '30.00' && mx.body[0][5] === '—', '混合碱自检失败');
  const f = linfit([1, 2, 3], [2, 4, 6]);
  console.assert(Math.abs(f.slope - 2) < 1e-12 && Math.abs(f.r2 - 1) < 1e-12, '线性拟合自检失败');
})();
