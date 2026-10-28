// Engineering review in the buyer conversation: load case + volumes -> backend runs FEA, manufacturing analysis,
// route/volume economics, DFx review (rules + AI manufacturing manager) and the document package.
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import * as THREE from "three";
import { esc, eur } from "./common.js";

export const MAT_KEY = { "铝合金 6061-T6": "al6061", "铝合金 7075-T6": "al7075", "不锈钢 304": "ss304", "不锈钢 316L": "ss316l",
  "结构钢 S355": "s355", "调质钢 42CrMo4": "42crmo4", "碳钢 C45": "c45", POM: "pom", PA6: "pa6", ABS: "abs" };
const SIDES = { "z-": "底面 (Z−)", "z+": "顶面 (Z+)", "x-": "左端 (X−)", "x+": "右端 (X+)", "y-": "前面 (Y−)", "y+": "后面 (Y+)" };
const DIRS = { "-z": [0, 0, -1], "+z": [0, 0, 1], "-x": [-1, 0, 0], "+x": [1, 0, 0], "-y": [0, -1, 0], "+y": [0, 1, 0] };
const LEVEL = { bad: ["必须修改", "bad"], warn: ["建议修改", "warn"], info: ["提示", ""] };
const CAT = { DFM: "可制造性", DFC: "成本", DFQ: "质量/检测", DFA: "装配", DFS: "服役/维修", DFL: "物流包装", FEA: "强度" };

export function loadCaseHtml() {
  const opt = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
  return `<h3>功能与载荷 <span class="small muted">（用于有限元仿真；不确定就用默认值）</span></h3>
    <div class="form" style="grid-template-columns:90px 1fr">
      <label>固定在</label><select id="fx">${opt(SIDES, "z-")}</select>
      <label>受力位置</label><select id="ld">${opt(SIDES, "z+")}</select>
      <label>力</label><div class="row"><input id="fN" type="number" value="1000" style="width:90px"> N　方向 <select id="fd">${opt({ "-z": "向下 −Z", "+z": "向上 +Z", "-x": "−X", "+x": "+X", "-y": "−Y", "+y": "+Y" }, "-z")}</select></div>
      <label>载荷类型</label><select id="lt"><option value="static">静载</option><option value="cyclic">交变 / 疲劳</option><option value="impact">冲击</option></select>
      <label>使用环境</label><div class="row"><select id="env"><option value="indoor">室内干燥</option><option value="outdoor">户外 / 潮湿</option><option value="marine">海洋 / 盐雾</option><option value="chemical">化工腐蚀</option><option value="food">食品接触</option></select> 温度 <input id="tc" type="number" value="20" style="width:60px"> °C</div>
      <label>产品周期</label><div class="row"><input id="yrs" type="number" value="5" min="1" style="width:60px"> 年 <span class="small muted">（模具按 年需求 × 年数 摊销）</span></div>
      <label>零件号</label><div class="row"><input id="pno" placeholder="可不填" style="width:140px"> 版本 <input id="rev" value="A" style="width:40px"></div></div>`;
}

export function readLoadCase(m) {
  const v = (id) => m.querySelector("#" + id).value;
  const d = DIRS[v("fd")], F = +v("fN") || 1000;
  return { fixed: { side: v("fx") }, load: { side: v("ld") }, force: d.map((x) => x * F), load_type: v("lt"),
    environment: v("env"), temp_c: +v("tc"), years: +v("yrs") || 1, part_no: v("pno").trim(), rev: v("rev").trim() || "A" };
}

// make sure the backend has the part: AI-modelled parts already live there, others are uploaded as STL
export async function ensurePart(st, api, headers) {
  if (st.partId) return st.partId;
  const fd = new FormData();
  if (st.file && /\.(stl|step|stp|obj)$/i.test(st.file.name)) fd.append("file", st.file);
  else {
    const mesh = new THREE.Mesh(st.geo);
    fd.append("file", new Blob([new STLExporter().parse(mesh, { binary: true })]), "part.stl");
  }
  const r = await fetch(api + "ai/part", { method: "POST", body: fd, headers });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || r.status);
  return (st.partId = d.id);
}

export async function runReview({ st, api, apiUrl, headers, say, req, meta }) {
  const m = say(`<b>工程评审</b><ul class="steps-ai"><li class="run">上传零件</li></ul><span class="small muted">仿真和成本几秒钟；AI 制造经理评审约 30–60 秒</span>`);
  const ul = m.querySelector("ul"), step = (t) => { ul.lastElementChild.className = "done"; const li = document.createElement("li"); li.className = "run"; li.textContent = t; ul.appendChild(li); };
  const part = await ensurePart(st, api, headers);
  const r = await fetch(api + "ai/analyze", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ part, req, meta }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.detail || r.status);
  const ticks = ["有限元仿真 (FEA)", "可制造性分析：装夹、倒扣、壁厚", "全部工艺路线的成本与产量经济性", "AI 制造经理 DFx 评审", "生成文件包"];
  let d, k = 0; const t0 = Date.now();
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 2500));
    d = await (await fetch(apiUrl(j.poll))).json();
    if (d.status === "running" && k < ticks.length && Date.now() - t0 > k * 6000) step(ticks[k++]);
    if (d.status === "done" || d.status === "error" || !d.status) break;
    if (Date.now() - t0 > 8 * 60e3) throw new Error("超时");
  }
  if (d.status !== "done") throw new Error(d.error || d.detail || "未知错误");
  while (k < ticks.length) step(ticks[k++]);
  ul.querySelectorAll("li").forEach((li) => li.className = "done");
  return d;
}

export function showReview(d, say, apiUrl) {
  const f = d.fea;
  say(`<h3>① 强度 (FEA) <span class="tag ${f.ok ? "ok" : "bad"}">安全系数 ${f.sf}</span></h3>
    <p>设计应力 ${f.sigma_design_mpa} MPa · 最大位移 ${f.disp_max_mm} mm · 重量 ${f.mass_kg} kg（要求 SF ≥ ${f.sf_required}）</p>
    <ul class="list">${d.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <p class="small muted">工程分析报告预览免费；<b>正式版报告</b>（可签字存档，含网格与模型说明）按份收费。</p>`, "bot", "wide");
  const items = [...d.dfx].sort((a, b) => ["bad", "warn", "info"].indexOf(a.level) - ["bad", "warn", "info"].indexOf(b.level));
  const top = items.filter((i) => i.level !== "info" || i.source !== "规则").slice(0, 12);
  say(`<h3>② 设计评审 DFx <span class="small muted">像制造经理一样看你的图</span></h3>
    ${d.dfx_summary ? `<p><b>总评：</b>${esc(d.dfx_summary)}</p>` : ""}
    <table><tr><th>级别</th><th>类别</th><th>问题与建议</th><th>负责</th></tr>${top.map((i) => `<tr><td><span class="tag ${LEVEL[i.level]?.[1] || ""}">${LEVEL[i.level]?.[0] || ""}</span></td>
      <td class="small">${esc(CAT[i.cat] || i.cat)}</td><td><b>${esc(i.title)}</b><div class="small">${esc(i.detail || "")}</div><div class="small">→ ${esc(i.action || "")}${i.saving ? ` <span class="tag ok">${esc(i.saving)}</span>` : ""}</div></td>
      <td class="small">${esc((i.who || []).join("、"))}<div class="muted">${esc(i.source)}</div></td></tr>`).join("")}</table>
    <p class="small muted">共 ${items.length} 条，完整清单（含该工艺的设计规则）见文件包「DFx 设计评审报告」。</p>`, "bot", "wide");
  say(`<h3>③ 工艺路线与成本 <span class="small muted">终身产量 ${d.lifetime.toLocaleString()} 件</span></h3>
    <table><tr><th>工艺路线</th><th>材料</th><th class="n">系列单价</th><th class="n">首批单价</th><th class="n">模具/一次性</th><th class="n">交期</th></tr>
    ${d.routes.slice(0, 8).map((r) => `<tr class="${r.process === d.route.process ? "sel" : ""}"><td>${r.process === d.route.process ? "● " : ""}${esc(r.name)}${r.strength_ok === false ? ' <span class="tag bad">强度不足</span>' : ""}</td>
      <td class="small">${esc(r.material || "")}${r.keeps_material === false ? ' <span class="tag warn">需换材</span>' : ""}</td>
      <td class="n">${eur(r.series)}</td><td class="n">${eur(r.first_lot)}</td><td class="n">${eur(r.one_off, 0)}</td><td class="n">${r.lead_days} 天</td></tr>`).join("")}</table>
    ${d.breakeven.length ? `<p class="small">${d.breakeven.map((b) => `${esc(b.a)} ↔ ${esc(b.b)}：终身产量 ${b.qty_between[0].toLocaleString()}–${b.qty_between[1].toLocaleString()} 件时交叉`).join("<br>")}</p>` : ""}
    <h3>成本核算（${esc(d.route.name)}，€/件）</h3>
    <table>${d.sheet.scheme.map((s) => `<tr class="${s.name.startsWith("=") ? "sel" : ""}"><td>${esc(s.name)}</td><td class="n">${s.eur.toFixed(2)}</td><td class="small muted">${esc(s.note)}</td></tr>`).join("")}</table>
    <p class="small muted">模具/工装一次性约 ${eur(d.sheet.tooling, 0)}（建议单独付款、所有权归你）。间接费率是平台默认假设，供应商会用自己的费率；运费、关税、CBAM 见核算单的到岸部分。</p>`, "bot", "wide");
  const docs = Object.entries(d.docs).filter(([k]) => k !== "index");
  say(`<h3>④ 文件包 <span class="small muted">按部门分发</span></h3>
    <div class="chips">${docs.map(([k, u]) => `<a class="chip-btn" href="${apiUrl(u)}" target="_blank">${esc(d.doc_names[k])}</a>`).join("")}</div>
    <p class="small"><a href="${apiUrl(d.docs.index)}" target="_blank">文件包与分发清单</a>：研发 ← 工程报告、DFx；工艺 ← 工艺路线卡；采购 ← RFQ、核算单；质量 ← 检验与验收规范；物流/关务 ← 交付与到岸成本；财务 ← 模具投资与产量经济性。</p>`, "bot", "wide");
}
