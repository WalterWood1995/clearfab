// Analysis report: simulation, design advice, materials, process & cost comparison, manufacturing simulation.
import * as THREE from "three";
import { $, esc, eur, num, api, busy, META } from "./common.js";

const STAGE_COL = { "材料": "#4c78a8", "下料": "#72b7b2", "编程": "#b279a2", "装夹调试": "#ff9da6", "粗加工": "#f58518",
  "精加工": "#e45756", "装夹": "#9d755d", "成形": "#54a24b", "模具": "#eeca3b", "后处理": "#bab0ac",
  "表面处理": "#88d27a", "质检": "#79706e", "包装": "#d6a5c9", "废品率": "#ff7f0e" };
const PROC_COL = { mill3: "#4c78a8", mill5: "#72b7b2", turn: "#f58518", sheet: "#54a24b", slm: "#e45756",
  sls: "#b279a2", diecast: "#eeca3b", investment: "#9d755d", imm: "#ff9da6" };
const REGION_NAMES = { DE: "德国", CN: "中国", EU_E: "东欧" };

export function renderReport(el, res, opt = {}) {
  const f = res.fea, v = opt.viewer;
  const state = { region: opt.region || "DE", proc: res.recommended };
  el.innerHTML = `
  <div class="card"><h2>① 有限元仿真（静力学）</h2>
    <div class="kpis">
      <div class="kpi ${f.ok ? "ok" : "bad"}"><div class="v">${num(f.sf)}</div><div class="l">安全系数（要求 ${f.sf_required}）</div></div>
      <div class="kpi"><div class="v">${num(f.sigma_design_mpa, 1)} MPa</div><div class="l">设计应力 σ<sub>v</sub>（99.5%）</div></div>
      <div class="kpi"><div class="v">${num(f.sigma_peak_mpa, 1)} MPa</div><div class="l">峰值（应力集中点）</div></div>
      <div class="kpi"><div class="v">${num(f.disp_max_mm, 3)} mm</div><div class="l">最大位移</div></div>
      <div class="kpi"><div class="v">${num(f.yield_mpa, 0)} MPa</div><div class="l">屈服强度${f.derate < 1 ? "（温度折减）" : ""}</div></div>
      <div class="kpi"><div class="v">${num(f.mass_kg, 3)} kg</div><div class="l">零件质量</div></div>
    </div>
    <p class="small muted">${esc(f.solver)}：${num(f.elements, 0)} 单元，体素 ${num(f.pitch_mm, 2)} mm。用时 ${res.timing.total_s} s。夹持/加载面第一层单元不计入设计应力（理想边界条件的奇异点）。</p>
    <div class="row" id="caxRow"></div>
    <div id="caxRes"></div>
    <div class="row" style="margin-top:8px"><button data-show="stress">显示应力云图</button><button data-show="part">只看零件</button></div>
  </div>
  <div class="card"><h2>② 设计优化建议</h2>
    <ul class="list">${res.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <h3>可制造性（DFM）</h3>
    <ul class="list">${res.dfm.map((d) => `<li><span class="tag ${d.level === "bad" ? "bad" : d.level === "warn" ? "warn" : ""}">${d.level === "bad" ? "问题" : d.level === "warn" ? "注意" : "提示"}</span>${esc(d.text)}</li>`).join("")}</ul>
    <div id="optBox"></div>
  </div>
  <div class="card"><h2>③ 材料比选 <span class="small muted">（同一载荷下应力与弹性模量无关，位移按 1/E 换算；价格为德国参考价，${res.req.qty} 件）</span></h2>
    <table><tr><th>材料</th><th class="n">安全系数</th><th class="n">质量 kg</th><th class="n">位移 mm</th><th>环境/温度</th><th class="n">最低 €/件</th><th>工艺</th></tr>
    ${res.materials.map((m) => `<tr class="${m.key === res.req.material ? "sel" : ""} ${m.ok ? "" : "dim"}"><td>${esc(m.name)}</td>
      <td class="n">${m.sf >= res.fea.sf_required ? `<span class="tag ok">${num(m.sf)}</span>` : `<span class="tag bad">${num(m.sf)}</span>`}</td>
      <td class="n">${num(m.mass_kg, 3)}</td><td class="n">${num(m.disp_mm, 3)}</td>
      <td>${m.issues.length ? m.issues.map((i) => `<span class="tag bad">${esc(i)}</span>`).join("") : (m.corrosion === 1 ? '<span class="tag warn">需表面处理</span>' : '<span class="tag ok">适用</span>')}</td>
      <td class="n">${eur(m.per_part_de)}</td><td class="small">${esc(m.process || "")}</td></tr>`).join("")}</table>
  </div>
  <div class="card"><h2>④ 工艺生成与成本核算 <span class="small muted">（出厂制造成本，不含物流/管理/资金/利润）</span></h2>
    <div class="row" id="regionTabs"></div>
    <div id="procTable"></div>
    <div id="procDetail"></div>
    <h3>批量 – 单件成本曲线（德国参考，对数坐标）</h3>
    <div id="curve"></div>
    <p class="note">费率、材料价、模具价为平台参考值（MVP 占位数据，待用真实供应商数据校准）。表面处理按「${esc(res.surface.name)}」计（依据使用环境自动建议）。</p>
  </div>`;

  // ---- viewer modes
  const showStress = () => { if (!v) return; v.stop(); v.clear("field"); v.stress(f.viz); v.meshOpacity(0.15); v.markers(f.fixed_center, f.load_center, res.req.force); legend(true); };
  const showPart = () => { if (!v) return; v.stop(); v.clear("field"); v.meshOpacity(1); legend(false); };
  const legend = (on) => {
    const lg = opt.legendEl; if (!lg) return;
    lg.hidden = !on;
    lg.innerHTML = `<div>von Mises 应力（MPa）</div><div class="bar"></div><div class="row" style="justify-content:space-between"><span>0</span><span>${num(f.sigma_design_mpa, 0)}（设计值）</span><span>${num(f.viz.scale_mpa, 0)}+</span></div><div><span style="color:#2b6cb0">■</span> 固定区域　<span style="color:#d9342b">●</span> 受力点</div>`;
  };
  el.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => (b.dataset.show === "stress" ? showStress() : showPart()));
  showStress();

  // ---- CAX Agent formal check
  const caxRes = (c) => {
    $("#caxRes", el).innerHTML = `<div class="note">精确校核（${esc(c.solver)}，${num(c.tets, 0)} 个二阶四面体，网格 ${c.mesh_size_mm} mm）：σ<sub>v</sub> 99.5% = <b>${num(c.p995_von_mises_Pa / 1e6, 1)} MPa</b>，峰值 ${num(c.max_von_mises_Pa / 1e6, 1)} MPa，最大位移 ${num(c.max_displacement_m * 1000, 3)} mm，安全系数（99.5%）<b>${num(c.sf_p995)}</b></div>`;
  };
  if (res.cax) caxRes(res.cax);
  if (opt.role === "buyer") {
    if (res.has_step && META.cax) {
      $("#caxRow", el).innerHTML = `<button id="caxBtn">精确校核（CAX Agent 四面体网格，约 30–60 s）</button>`;
      $("#caxBtn", el).onclick = (e) => busy(e.target, async () => caxRes(await api(`/api/analyses/${res.id}/cax-check`, { method: "POST" })));
    } else if (!res.has_step) $("#caxRow", el).innerHTML = `<span class="small muted">上传 STEP 文件可使用 CAX Agent 精确校核。</span>`;
  }

  // ---- topology optimisation
  const optBox = $("#optBox", el);
  const showOpt = (o) => {
    optBox.querySelector("#optRes").innerHTML = `
      <div class="kpis" style="margin-top:8px">
        <div class="kpi"><div class="v">${num(o.mass_kg, 3)} kg</div><div class="l">优化后质量（原 ${num(o.mass_orig_kg, 3)}）</div></div>
        <div class="kpi"><div class="v">${num((1 - o.volume_ratio) * 100, 0)} %</div><div class="l">减重</div></div>
        <div class="kpi"><div class="v">${num(o.stiffness_ratio * 100, 0)} %</div><div class="l">保留刚度</div></div>
        <div class="kpi ${o.ok ? "ok" : "bad"}"><div class="v">${num(o.sf)}</div><div class="l">优化后安全系数</div></div>
      </div><p class="small muted">${o.iterations} 次迭代，${o.time_s} s。${esc(o.note)}</p>
      <button id="optShow">在三维视图中显示优化构型</button>`;
    optBox.querySelector("#optShow").onclick = () => { v.stop(); v.clear("field"); v.voxels("field", o.viz, () => new THREE.Color(0x2fa6a6)); v.meshOpacity(0.12); legend(false); };
  };
  if (opt.role === "buyer" || res.optimization) {
    optBox.innerHTML = `<h3>拓扑优化（SIMP，在零件自身包络内去除低效材料）</h3>
      ${opt.role === "buyer" ? `<div class="row"><label class="small muted">保留体积</label><input id="vf" type="range" min="30" max="90" value="55"><span id="vfv">55%</span><button id="optBtn">运行拓扑优化（约 15–30 s）</button></div>` : ""}
      <div id="optRes"></div>`;
    if (opt.role === "buyer") {
      $("#vf", el).oninput = (e) => ($("#vfv", el).textContent = e.target.value + "%");
      $("#optBtn", el).onclick = (e) => busy(e.target, async () => { const o = await api(`/api/analyses/${res.id}/optimize`, { body: { volfrac: Number($("#vf", el).value) / 100 } }); res.optimization = o; showOpt(o); $("#optShow", el).click(); });
    }
    if (res.optimization) showOpt(res.optimization);
  }

  // ---- processes
  const regTabs = $("#regionTabs", el);
  regTabs.innerHTML = Object.keys(res.costs).map((r) => `<button data-r="${r}" class="${r === state.region ? "primary" : ""}">${REGION_NAMES[r] || r} 参考</button>`).join("");
  regTabs.querySelectorAll("button").forEach((b) => b.onclick = () => { state.region = b.dataset.r; regTabs.querySelectorAll("button").forEach((x) => x.className = x.dataset.r === state.region ? "primary" : ""); drawTable(); });
  const drawTable = () => {
    const list = res.costs[state.region];
    $("#procTable", el).innerHTML = `<table><tr><th>工艺</th><th>可行性</th><th class="n">安全系数</th><th class="n">€/件</th><th class="n">一次性费用</th><th class="n">${res.req.qty} 件总价</th><th class="n">交期(天)</th></tr>
      ${list.map((e) => e.feasible ? `<tr class="click ${e.process === state.proc ? "sel" : ""}" data-p="${e.process}"><td>${esc(e.name)} ${e.process === res.recommended ? '<span class="tag rec">推荐</span>' : ""}</td>
        <td>${e.strength_ok ? '<span class="tag ok">可行</span>' : '<span class="tag bad">强度不足</span>'}${e.material_override ? `<span class="tag">${esc(e.material_override.name)}</span>` : ""}</td>
        <td class="n">${num(e.sf)}</td><td class="n"><b>${eur(e.per_part)}</b></td><td class="n">${eur(e.one_off, 0)}</td><td class="n">${eur(e.total, 0)}</td><td class="n">${e.lead_days}</td></tr>`
        : `<tr class="dim"><td>${esc(e.name)}</td><td colspan="6" class="small">✗ ${esc(e.reason)}</td></tr>`).join("")}</table>`;
    $("#procTable", el).querySelectorAll("tr[data-p]").forEach((tr) => tr.onclick = () => { state.proc = tr.dataset.p; drawTable(); });
    drawDetail();
  };
  const drawDetail = () => {
    const e = res.costs[state.region].find((x) => x.process === state.proc && x.feasible);
    const box = $("#procDetail", el);
    if (!e) { box.innerHTML = ""; return; }
    const tot = Object.values(e.stages).reduce((a, b) => a + b, 0);
    box.innerHTML = `<h3>工艺路线：${esc(e.name)}（${REGION_NAMES[e.region]}，${e.qty} 件）</h3>
      <div class="stack">${Object.entries(e.stages).map(([k, x]) => `<span title="${k} ${eur(x)}" style="width:${(x / tot) * 100}%;background:${STAGE_COL[k] || "#999"}"></span>`).join("")}</div>
      <div class="legend-row">${Object.entries(e.stages).map(([k, x]) => `<span><i style="background:${STAGE_COL[k] || "#999"}"></i>${k} ${eur(x)}（${num((x / tot) * 100, 0)}%）</span>`).join("")}</div>
      <table style="margin-top:8px"><tr><th>#</th><th>环节</th><th>工序</th><th>计算依据</th><th class="n">工时 h</th><th class="n">费率 €/h</th><th class="n">每件</th><th class="n">每批一次性</th></tr>
      ${e.lines.map((l, i) => `<tr><td>${i + 1}</td><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${STAGE_COL[l.stage] || "#999"}"></i> ${esc(l.stage)}</td><td>${esc(l.item)}</td><td class="small">${esc(l.basis)}</td><td class="n">${l.hours == null ? "" : num(l.hours, 3)}</td><td class="n">${l.rate == null ? "" : num(l.rate, 1)}</td><td class="n">${l.unit ? eur(l.unit) : ""}</td><td class="n">${l.batch ? eur(l.batch) : ""}</td></tr>`).join("")}
      <tr><td colspan="6"><b>单件成本</b>（一次性费用按 ${e.qty} 件分摊）</td><td class="n" colspan="2"><b>${eur(e.per_part)}</b></td></tr></table>
      ${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}
      ${v ? `<div class="row" style="margin-top:8px"><button class="primary" id="simBtn">▶ 制造过程仿真</button><span class="small muted" id="simInfo"></span></div>` : ""}`;
    if (v) $("#simBtn", el).onclick = () => playProcess(e.process);
  };
  const playProcess = (p) => {
    const a = res.anim, info = $("#simInfo", el);
    legend(false); v.clear("field");
    if (p === "mill3" || p === "mill5") {
      v.animate(a.grid, a.mill.order, "remove", { setups: a.mill.setups, onStep: (s, x) => info.textContent = `${s ? "装夹方向 " + s.dir + " · " : ""}去除材料 ${num(x * 100, 0)}%（体素层切刀路，按装夹顺序）` });
    } else if (p === "turn") {
      v.animate(a.grid, a.turn.order, "remove", { onStep: (s, x) => info.textContent = `棒料由外向内车削 ${num(x * 100, 0)}%` });
    } else if (p === "sheet") {
      v.animate(a.grid, a.add.order, "add", { color: 0x8aa0b4, onStep: (s, x) => info.textContent = `激光切割展开料 → 数控折弯成形（示意）${num(x * 100, 0)}%` });
    } else if (p === "slm" || p === "sls") {
      v.animate(a.grid, a.add.order, "add", { onStep: (s, x) => info.textContent = `逐层成形 ${num(x * 100, 0)}%（构建方向 +Z）` });
    } else {
      v.animate(a.grid, a.fill.order, "add", { color: 0xd9822b, onStep: (s, x) => info.textContent = `${p === "imm" ? "熔体" : "金属液"}自浇口充型 ${num(x * 100, 0)}%` });
    }
  };
  drawTable();

  // ---- quantity curve (SVG)
  const c = res.curve, W = 640, H = 240, L = 56, B = 28;
  const all = Object.values(c.series).flat().filter((x) => x);
  const ymin = Math.min(...all), ymax = Math.max(...all);
  const lx = (q) => L + (Math.log10(q) / Math.log10(c.qty[c.qty.length - 1])) * (W - L - 10);
  const ly = (y) => H - B - ((Math.log10(y) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin) || 1)) * (H - B - 10);
  const ticks = [1, 10, 100, 1000, 10000, 100000].filter((t) => t >= ymin / 10 && t <= ymax * 10);
  $("#curve", el).innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - 10}" y1="${ly(t)}" y2="${ly(t)}"/><text x="${L - 6}" y="${ly(t) + 4}" text-anchor="end">${t >= 1000 ? t / 1000 + "k" : t} €</text>`).join("")}
    ${c.qty.map((q) => `<text x="${lx(q)}" y="${H - 8}" text-anchor="middle">${q >= 1000 ? q / 1000 + "k" : q}</text>`).join("")}
    ${Object.entries(c.series).map(([p, ys]) => `<polyline fill="none" stroke="${PROC_COL[p]}" stroke-width="2" points="${ys.map((y, i) => y ? `${lx(c.qty[i])},${ly(y)}` : "").join(" ")}"/>`).join("")}
    <line x1="${lx(res.req.qty)}" x2="${lx(res.req.qty)}" y1="10" y2="${H - B}" stroke="currentColor" stroke-dasharray="4 3" opacity=".5"/>
  </svg><div class="legend-row">${Object.keys(c.series).map((p) => `<span><i style="background:${PROC_COL[p]}"></i>${META.processes[p]}</span>`).join("")}<span>┆ 当前数量 ${res.req.qty}</span></div>`;
  return { showStress, showPart };
}

