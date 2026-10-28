// Buyer: one conversation — drop a drawing / model, get a 3D model, choose material, quantity and process route,
// generate an RFQ and send it to suppliers. Prototype: AI drawing-to-3D runs on the sample sketch only.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { Viewer } from "./viewer.js";
import { esc, num, eur } from "./common.js";
import { PROCESS_OPTS, MATERIAL_OPTS, PAY_OPTS, INCOTERMS, saveRfq, nextRfqId, localRfqs, quotesFor, sampleRfqs, freightEstimate, LANDED, questionsFor, allQuestions, answerQuestion, densityOf, daysLeft } from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const msgs = $("#msgs");
const st = {};   // current part: name, kind, geo info, stl url/blob, drawing url, caseId
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function say(html, who = "bot", cls = "") {
  const d = document.createElement("div");
  d.className = `msg ${who} ${cls}`; d.innerHTML = html; msgs.appendChild(d);
  d.scrollIntoView({ behavior: "smooth", block: "end" });
  return d;
}

function welcome() {
  say(`你好，我是 ClearFab 的询价助手。<br>把你要做的<b>零件图</b>拖进下面的对话框：3D 模型、2D 图纸、手绘草图的照片都可以。我会生成 3D 数模，帮你整理成询价单（RFQ）发给供应商。
    <div class="chips" style="margin-top:10px"><button class="chip-btn" id="trySketch">用示例手绘草图试试</button><button class="chip-btn" id="try3d">用示例 3D 文件试试</button></div>`);
  $("#trySketch").onclick = async () => onFile(new File([await (await fetch("demo/sketch_bracket.png")).blob()], "支架草图.png", { type: "image/png" }), "bracket");
  $("#try3d").onclick = async () => onFile(new File([await (await fetch("demo/shaft.stl")).blob()], "shaft.stl"), "shaft");
}

// ------------------------------------------------------------------ file intake
const box = $("#box");
["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); box.classList.add("hover"); }));
["dragleave", "drop"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); box.classList.remove("hover"); }));
document.addEventListener("drop", (e) => e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]));
$("#attach").onclick = () => $("#file").click();
$("#file").onchange = (e) => e.target.files[0] && onFile(e.target.files[0]);
const sendText = () => {
  const t = $("#txt").value.trim(); if (!t) return;
  $("#txt").value = ""; say(esc(t), "me");
  st.note = (st.note ? st.note + "\n" : "") + t;
  say(st.info || st.drawing ? "收到，已记进询价单的备注里。" : "收到。先把零件图拖进来吧，3D、2D 图纸或草图照片都可以。");
};
$("#send").onclick = sendText;
$("#txt").onkeydown = (e) => e.key === "Enter" && sendText();

async function onFile(f, sampleCase = null) {
  const ext = f.name.split(".").pop().toLowerCase();
  Object.keys(st).forEach((k) => delete st[k]);
  st.name = f.name; st.caseId = sampleCase;
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    st.drawing = URL.createObjectURL(f);
    say(`<img class="thumb" src="${st.drawing}" alt="">${esc(f.name)}`, "me");
    if (await aiAvailable()) return aiModel(f);
    return sampleCase ? aiReconstruct(sampleCase) : drawingOnly("图片");
  }
  if (ext === "pdf" || ext === "dxf") { st.drawing = true; say(`📄 ${esc(f.name)}`, "me"); return (await aiAvailable()) ? aiModel(f) : drawingOnly(ext === "pdf" ? "PDF 图纸" : "DXF 图纸"); }
  if (ext === "dwg") return say(`DWG 是 Autodesk 私有格式，网页读不了。请在 CAD 里<b>另存为 DXF</b>（或导出 PDF）再拖进来；3D 模型请导出 STEP。`);
  if (["sldprt", "prt", "ipt", "catpart", "x_t", "x_b", "par"].includes(ext)) return say(`.${esc(ext)} 是 CAD 软件的原生格式。请在 CAD 里<b>导出 STEP</b>（AP214/AP242）再上传，所有供应商都能打开。`);
  if (!["stl", "obj", "step", "stp", "igs", "iges"].includes(ext)) return say(`暂不支持 .${esc(ext)} 文件。3D 请上传 STEP / IGES / STL / OBJ，2D 请上传 DXF / PDF / PNG / JPG。`);
  say(`🧊 ${esc(f.name)}`, "me");
  const m = say(`<span class="spin"></span> 正在读取 3D 模型…`);
  try {
    const buf = await f.arrayBuffer();
    let geo;
    if (ext === "stl") geo = new STLLoader().parse(buf);
    else if (ext === "obj") geo = mergeObj(new OBJLoader().parse(new TextDecoder().decode(buf)));
    else geo = await readStep(buf, ext === "igs" || ext === "iges");
    st.geo = geo; st.info = measure(geo);
    showModel(m, `已读取 3D 模型 <b>${esc(f.name)}</b>。`);
    askSpec();
  } catch (e) { m.innerHTML = `模型读取失败：${esc(e.message)}。可以换成 STL 再试。`; }
}

function mergeObj(obj) {
  const parts = []; obj.traverse((c) => c.isMesh && parts.push(c.geometry.toNonIndexed()));
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3);
  let o = 0; parts.forEach((g) => { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; });
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); return geo;
}

async function readStep(buf, iges = false) {   // OpenCascade compiled to WebAssembly (occt-import-js)
  const base = "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/";
  if (!window.occtimportjs) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = base + "occt-import-js.js"; s.onload = ok; s.onerror = () => bad(new Error("STEP 解析库加载失败")); document.head.appendChild(s); });
  const occt = await window.occtimportjs({ locateFile: (n) => base + n });
  const r = iges ? occt.ReadIgesFile(new Uint8Array(buf), null) : occt.ReadStepFile(new Uint8Array(buf), null);
  if (!r.success || !r.meshes.length) throw new Error("文件里没有可读取的实体");
  const pos = [];
  for (const m of r.meshes) {
    const p = m.attributes.position.array, idx = m.index.array;
    for (let i = 0; i < idx.length; i++) pos.push(p[3 * idx[i]], p[3 * idx[i] + 1], p[3 * idx[i] + 2]);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); return geo;
}

function measure(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position.array;
  let vol = 0, area = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i + 1], p[i + 2]); b.set(p[i + 3], p[i + 4], p[i + 5]); c.set(p[i + 6], p[i + 7], p[i + 8]);
    vol += a.dot(t.copy(b).cross(c)) / 6;
    area += t.copy(b).sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  geo.computeBoundingBox(); const s = geo.boundingBox.getSize(new THREE.Vector3());
  return { bbox: [s.x, s.y, s.z], volume_cm3: Math.abs(vol) / 1000, area_cm2: area / 100 };
}

function showModel(msgEl, lead) {
  const i = st.info;
  msgEl.classList.add("wide");
  msgEl.innerHTML = `${lead}<div class="viewer"><div class="hud">拖动旋转 · 滚轮缩放</div></div>
    <div class="small muted">包络 ${i.bbox.map((x) => num(x, 1)).join(" × ")} mm · 体积 ${num(i.volume_cm3, 1)} cm³ · 表面积 ${num(i.area_cm2, 0)} cm²</div>`;
  const v = new Viewer($(".viewer", msgEl)); v.setGeometry(st.geo.clone());
  msgEl.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function aiReconstruct(caseId) {
  const m = say(`<b>AI 识图建模</b> <span class="proto">演示</span><ul class="steps-ai"></ul>`);
  const ul = $("ul", m);
  for (const s of ["识别视图：主视图 + 俯视图", "读取尺寸：120 × 60 × 50 mm，底板 12，立板 14，加强筋 t=10", "识别特征：4 × Ø9 底板通孔，2 × Ø9 立板通孔", "材料备注：AlMgSi（6061 系），数量约 50 件", "生成参数化 3D 数模（STEP）"]) {
    const li = document.createElement("li"); li.className = "run"; li.textContent = s; ul.appendChild(li);
    m.scrollIntoView({ behavior: "smooth", block: "end" }); await sleep(650); li.className = "done";
  }
  st.geo = new STLLoader().parse(await (await fetch(`demo/${caseId}.stl`)).arrayBuffer());
  st.info = measure(st.geo); st.step = "demo/bracket.step";
  st.preset = { material: "铝合金 6061-T6", qty: 50 };
  const m2 = say("");
  showModel(m2, `3D 数模已生成，请核对形状和尺寸。<a href="demo/bracket.step" download>下载 STEP</a>`);
  askSpec();
}

// real AI modelling through the ClearFab backend (only when the page is served by it and a key is configured)
const API = new URL("../api/", location.href).href;
let aiState = null;
async function aiAvailable() {
  if (aiState === null) {
    try { const r = await fetch(API + "ai/status"); aiState = r.ok && (await r.json()).available; } catch { aiState = false; }
  }
  return aiState;
}

async function aiModel(f) {
  const m = say(`<b>AI 识图建模</b><ul class="steps-ai"><li class="run">上传图纸</li></ul><span class="small muted">通常 30–90 秒</span>`);
  const ul = $("ul", m);
  const tick = ["Claude 读取视图和尺寸", "生成参数化建模代码", "OpenCascade 建模、导出 STEP"];
  let k = 0;
  const timer = setInterval(() => {
    if (k >= tick.length) return;
    ul.lastElementChild.className = "done";
    const li = document.createElement("li"); li.className = "run"; li.textContent = tick[k++]; ul.appendChild(li);
  }, 9000);
  const fd = new FormData(); fd.append("file", f); fd.append("note", st.note || "");
  try {
    const r = await fetch(API + "ai/model", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.status);
    clearInterval(timer); ul.querySelectorAll("li").forEach((li) => li.className = "done");
    const sp = d.spec;
    st.geo = new STLLoader().parse(await (await fetch(new URL(d.stl, location.href))).arrayBuffer());
    st.info = measure(st.geo); st.step = new URL(d.step, location.href).href; st.stl = new URL(d.stl, location.href).href;
    st.preset = { material: MATERIAL_OPTS.find((x) => sp.material_hint && x.includes(sp.material_hint.replace(/[^0-9A-Za-z]/g, "").slice(0, 4))) || null, qty: sp.quantity_hint || null };
    const list = (t, a) => a && a.length ? `<h3>${t}</h3><ul class="list">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    const m2 = say("");
    showModel(m2, `<b>${esc(sp.name || "零件")}</b>：${esc(sp.summary || "")} <span class="tag ${sp.confidence === "high" ? "ok" : "warn"}">置信度 ${esc(sp.confidence || "?")}</span> <a href="${st.step}" download>下载 STEP</a>`);
    m2.insertAdjacentHTML("beforeend", list("尺寸", sp.dimensions) + list("特征", sp.features) + list("AI 自行假设的尺寸（请核对）", sp.assumptions)
      + `<p class="small muted">建模尝试 ${d.attempts} 次。请核对形状和尺寸；不对的地方直接在下面输入框告诉我，或重新上传更清楚的图。</p>`);
    askSpec();
  } catch (e) {
    clearInterval(timer);
    m.innerHTML = `AI 建模没有成功：${esc(e.message)}`;
    drawingOnly("图纸");
  }
}

function drawingOnly(kind) {
  const m = say(`收到你的${kind}。<br><span class="proto">内测</span> AI 读图生成 3D 数模的功能正在内测，这个公开演示站还不能处理你自己的图纸；正式版大约 1 分钟出数模。<br>现在你可以：
    <div class="chips"><button class="chip-btn" data-a="go">直接按图纸询价（供应商按图报价）</button><button class="chip-btn" data-a="3d">改传 3D 文件</button><button class="chip-btn" data-a="demo">用示例草图体验 AI 建模</button></div>`);
  m.querySelectorAll("[data-a]").forEach((b) => b.onclick = async () => {
    if (b.dataset.a === "go") askSpec();
    else if (b.dataset.a === "3d") $("#file").click();
    else onFile(new File([await (await fetch("demo/sketch_bracket.png")).blob()], "支架草图.png", { type: "image/png" }), "bracket");
  });
}

// ------------------------------------------------------------------ requirements
function suggestProcesses(material) {
  const i = st.info, out = new Set(["deburr"]);
  if (i) {
    const [a, b] = [...i.bbox].sort((x, y) => x - y), t = 2 * i.volume_cm3 * 1000 / (i.area_cm2 * 100);
    if (t <= 6.5 && b >= 8 * t) out.add("sheet");
    else if (Math.abs(i.bbox[0] - i.bbox[1]) < 0.02 * Math.max(...i.bbox) && st.name.match(/shaft|轴/i)) out.add("turn");
    else out.add(st.caseId === "shaft" ? "turn" : "mill");
  } else out.add("mill");
  if (/铝/.test(material)) out.add("anodize"); else if (/钢 S355|C45|42CrMo4/.test(material)) out.add("zinc");
  if (/42CrMo4/.test(material)) out.add("heat");
  return out;
}

function askSpec() {
  const pre = st.preset || {};
  const mat0 = pre.material || (st.caseId === "shaft" ? "碳钢 C45" : "铝合金 6061-T6");
  const m = say(`接下来确认<b>材料、数量和工艺</b>：
    <h3>材料</h3><div class="chips" id="mats">${MATERIAL_OPTS.map((x) => `<button class="chip-btn ${x === mat0 ? "on" : ""}">${x}</button>`).join("")}<input id="matOther" placeholder="其他材料" style="width:120px"></div>
    <h3>数量与产能</h3><div class="row">本批 <input id="qty" type="number" value="${pre.qty || (st.caseId === "shaft" ? 200 : 50)}" min="1"> 件　年需求 <input id="annual" type="number" value="${st.caseId === "shaft" ? 2400 : 600}"> 件/年</div>
    <h3>工艺路线 <span class="small muted">（已按零件形状和材料预选，可增减）</span></h3><div class="chips" id="procs"></div>
    <h3>质量</h3><div class="row"><select id="tol"><option>ISO 2768-m（一般）</option><option>ISO 2768-f（精细）</option><option>IT7（精密配合）</option></select>
      <select id="cert"><option>无证书</option><option selected>材质证书 EN 10204 3.1</option><option>首件检验 FAI / EMPB</option><option>PPAP</option></select></div>
    <h3>交货</h3><div class="form" style="grid-template-columns:90px 1fr">
      <label>交货地址</label><input id="addr" placeholder="公司、街道、邮编、城市、国家">
      <label>交付方式</label><select id="inc">${Object.entries(INCOTERMS).map(([k, v]) => `<option value="${k}" ${k === "DAP" ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label>期望付款</label><select id="pay">${PAY_OPTS.map((x) => `<option ${x === "发货后 30 天" ? "selected" : ""}>${x}</option>`).join("")}</select>
      <label>期望交期</label><input id="dl" type="date"></div>
    <h3>报价规则</h3><div class="form" style="grid-template-columns:90px 1fr">
      <label>目标单价 €</label><div class="row"><input id="tp" type="number" step="0.01" placeholder="可不填"><span class="small muted">填了供应商更容易判断值不值得报</span></div>
      <label>报价截止</label><input id="qb" type="date"></div>
    <button class="primary" id="gen" style="margin-top:12px">生成询价单</button>`, "bot", "wide");
  const procs = $("#procs", m);
  const drawProcs = (mat) => {
    const on = suggestProcesses(mat);
    procs.innerHTML = Object.entries(PROCESS_OPTS).map(([k, v]) => `<button class="chip-btn ${on.has(k) ? "on" : ""}" data-p="${k}">${v}</button>`).join("");
    procs.querySelectorAll("button").forEach((b) => b.onclick = () => b.classList.toggle("on"));
  };
  drawProcs(mat0);
  $("#mats", m).querySelectorAll("button").forEach((b) => b.onclick = () => { $("#mats", m).querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); $("#matOther", m).value = ""; drawProcs(b.textContent); });
  $("#gen", m).onclick = () => {
    const material = $("#matOther", m).value.trim() || $("#mats .on", m)?.textContent || "";
    const sel = [...procs.querySelectorAll(".on")].map((b) => b.dataset.p);
    if (!material) return alert("请选择材料");
    if (!sel.length) return alert("请至少勾选一道工艺");
    if (!$("#addr", m).value.trim()) return alert("请填写交货地址");
    buildRfq({ material, qty: +$("#qty", m).value, annual: +$("#annual", m).value, procs: sel, quality: `${$("#tol", m).value} · ${$("#cert", m).value}`,
      address: $("#addr", m).value.trim(), incoterm: $("#inc", m).value, pay: $("#pay", m).value, deadline: $("#dl", m).value,
      target: +$("#tp", m).value || null, quote_by: $("#qb", m).value });
  };
}

const ROUTE = {
  mill: [["下料", "锯切方料"], ["粗加工", "CNC 铣削开粗"], ["精加工", "CNC 精铣轮廓、平面、孔"]],
  turn: [["下料", "锯切圆棒"], ["粗加工", "CNC 粗车"], ["精加工", "精车、切槽、切断"]],
  sheet: [["下料", "光纤激光切割展开料"], ["成形", "数控折弯"]],
  diecast: [["模具", "压铸模具设计制造"], ["成形", "冷室压铸"], ["后处理", "切边、去浇口"], ["精加工", "配合面与孔后加工"]],
  investment: [["模具", "蜡模压型"], ["成形", "制壳、浇注、清理"], ["精加工", "关键面后加工"]],
  imm: [["模具", "注塑模具设计制造"], ["成形", "注塑"]],
  print3d: [["成形", "3D 打印"], ["后处理", "去支撑、喷砂"]],
  weld: [["成形", "焊接"]], heat: [["后处理", "热处理"]], deburr: [["后处理", "去毛刺、清洗"]],
  anodize: [["表面处理", "阳极氧化"]], zinc: [["表面处理", "电镀锌 + 钝化"]], powder: [["表面处理", "静电粉末喷涂"]],
  inspect: [["质检", "全检 / 三坐标测量"]],
};

async function buildRfq(spec) {
  const id = nextRfqId();
  const ORDER = ["diecast", "investment", "imm", "print3d", "sheet", "turn", "mill", "weld", "heat", "deburr", "anodize", "zinc", "powder", "inspect"];
  spec.procs.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const route = spec.procs.flatMap((p) => ROUTE[p].map(([stage, op]) => ({ stage, op, basis: "" })));
  route.push({ stage: "质检", op: "出货检验", basis: spec.quality }, { stage: "包装", op: "防锈包装、发运", basis: INCOTERMS[spec.incoterm] });
  let ref = null;
  if (st.caseId) {   // the sample parts have a full platform analysis
    const s = (await sampleRfqs()).find((r) => r.caseId === st.caseId);
    if (s && spec.qty === s.qty) ref = s.ref_total;
  }
  const i = st.info;
  const rfq = { id, created: new Date().toISOString().slice(0, 10), title: `${spec.material} 零件 · ${spec.qty} 件`, buyer: "我（本浏览器）",
    files: { stl: st.stl || (st.caseId ? `demo/${st.caseId}.stl` : null), step: st.step || null, drawing: !!st.drawing, name: st.name },
    bbox: i?.bbox, volume_cm3: i?.volume_cm3, material: spec.material, qty: spec.qty, annual: spec.annual, quality: spec.quality,
    address: spec.address, incoterm: spec.incoterm, pay: spec.pay, deadline: spec.deadline, process_name: spec.procs.map((p) => PROCESS_OPTS[p]).join(" → "),
    route, ref_total: ref, note: st.note || "", caseId: st.caseId, procs: spec.procs, target: spec.target, quote_by: spec.quote_by,
    mass_kg: i ? i.volume_cm3 * densityOf(spec.material) / 1000 : null, industry: "（你的行业）", views: 0 };
  const m = say(`询价单已生成，请确认：${rfqDoc(rfq)}
    <div class="row" style="margin-top:10px"><button class="primary" id="pub">发布给供应商</button><button id="edit">修改</button></div>`, "bot", "wide");
  $("#edit", m).onclick = askSpec;
  $("#pub", m).onclick = () => {
    saveRfq(rfq); $("#pub", m).disabled = true;
    say(`已发布 <b>${id}</b>。供应商可以在<a href="maker.html#${id}">供应商端</a>看到这张询价单并报价；报价会出现在右上角「我的询价单」里。<br><span class="small muted">演示站：询价单只保存在你这个浏览器里。</span>`);
  };
}

export function rfqDoc(r) {
  return `<div class="rfq-doc"><h3>${esc(r.id)} · ${esc(r.title)}</h3><dl class="kv">
    <dt>零件文件</dt><dd>${esc(r.files.name || "")}${r.files.step ? ' · <a href="' + r.files.step + '" download>STEP 数模</a>' : r.files.drawing ? " · 2D 图纸（无 3D）" : ""}</dd>
    ${r.bbox ? `<dt>尺寸</dt><dd>${r.bbox.map((x) => num(x, 1)).join(" × ")} mm · ${num(r.volume_cm3, 1)} cm³</dd>` : ""}
    <dt>材料</dt><dd>${esc(r.material)}</dd><dt>数量</dt><dd>本批 ${r.qty} 件 · 年需求 ${num(r.annual, 0)} 件</dd>
    <dt>工艺路线</dt><dd>${r.route.map((s, k) => `${k + 1}. ${esc(s.op)}`).join("<br>")}</dd>
    <dt>质量</dt><dd>${esc(r.quality)}</dd><dt>交货地址</dt><dd>${esc(r.address)}</dd>
    <dt>交付 / 付款</dt><dd>${esc(INCOTERMS[r.incoterm])} · ${esc(r.pay)}</dd><dt>期望交期</dt><dd>${esc(r.deadline || "尽快")}</dd>
    <dt>报价规则</dt><dd>${r.target ? "目标单价 " + eur(r.target) + " · " : ""}报价截止 ${esc(r.quote_by || "未设")}</dd>
    ${r.ref_total ? `<dt>平台参考成本</dt><dd>德国 ${eur(r.ref_total.DE, 0)} · 中国 ${eur(r.ref_total.CN, 0)}（出厂制造成本，<a href="demo.html?case=${r.caseId}" target="_blank">查看仿真与成本分析</a>）</dd>` : ""}
    ${r.note ? `<dt>备注</dt><dd>${esc(r.note).replace(/\n/g, "<br>")}</dd>` : ""}</dl></div>`;
}

// ------------------------------------------------------------------ my RFQs: quotes on one basis + supplier questions
function landed(r, q, v) {
  // goods + one-off + freight (if not delivered) + import duty (if from China and not DDP) — assumptions in LANDED
  const goods = v.unit * r.qty, fromCN = q.origin === "CN";
  const delivered = v.incoterm === "DAP" || v.incoterm === "DDP";
  const freight = delivered ? 0 : (r.mass_kg ? freightEstimate(r.mass_kg * r.qty, fromCN) : 0);
  const duty = fromCN && v.incoterm !== "DDP" ? (goods + freight) * LANDED.dutyCN : 0;
  return { goods, freight, duty, total: goods + (v.oneoff || 0) + freight + duty };
}

$("#myRfqs").onclick = (e) => {
  e.preventDefault();
  const list = localRfqs();
  if (!list.length) return say("你还没有发布询价单。");
  const qa = allQuestions();
  const html = list.map((r) => {
    const rows = quotesFor(r.id).flatMap((q) => q.variants.map((v, k) => ({ q, v, k, L: landed(r, q, v) })));
    rows.sort((a, b) => a.L.total - b.L.total);
    const ref = r.ref_total?.DE;
    const left = daysLeft(r.quote_by);
    const qs = qa.map((x, i) => ({ ...x, i })).filter((x) => x.rfq === r.id);
    return `<div class="rfq-doc" style="margin-top:10px"><h3>${esc(r.id)} · ${esc(r.title)}</h3>
      <div class="small muted">${rows.length ? new Set(rows.map((x) => x.q.maker)).size : 0} 家报价 · ${rows.length} 个方案${left != null ? ` · 距报价截止 ${left} 天` : ""}${r.target ? ` · 目标单价 ${eur(r.target)}` : ""}</div>
      ${rows.length ? `<table style="margin-top:6px"><tr><th>供应商 / 方案</th><th class="n">单价</th><th class="n">货值</th><th class="n">一次性</th><th class="n">运费估</th><th class="n">关税估</th><th class="n"><b>到岸总价</b></th><th class="n">vs 平台参考</th><th>交期 · 交付 · 付款</th></tr>
        ${rows.map((x, n) => `<tr class="${n ? "" : "sel"}"><td><b>${esc(x.q.makerName)}</b> ${String.fromCharCode(65 + x.k)}<div class="small muted">${esc(x.q.makerInfo)}</div>${x.v.note ? `<div class="small">${esc(x.v.note)}</div>` : ""}</td>
          <td class="n">${eur(x.v.unit)}${r.target ? `<div class="small ${x.v.unit <= r.target ? "" : "muted"}">${x.v.unit <= r.target ? "✓ 达到目标价" : "高于目标 " + Math.round((x.v.unit / r.target - 1) * 100) + "%"}</div>` : ""}</td>
          <td class="n">${eur(x.L.goods, 0)}</td><td class="n">${eur(x.v.oneoff || 0, 0)}</td><td class="n">${x.L.freight ? eur(x.L.freight, 0) : "含"}</td><td class="n">${x.L.duty ? eur(x.L.duty, 0) : "–"}</td>
          <td class="n"><b>${eur(x.L.total, 0)}</b></td><td class="n">${ref ? (x.L.goods >= ref ? "+" : "") + Math.round((x.L.goods / ref - 1) * 100) + "%" : "–"}</td>
          <td class="small">${x.v.lead} 天 · ${esc(x.v.incoterm)} ${esc(x.v.place || "")} · ${esc(x.v.pay)}</td></tr>`).join("")}</table>
        <p class="small muted">到岸总价 = 货值 + 一次性费用 + 运费（非 DAP/DDP 时按重量估算）+ 关税（中国发货且非 DDP 时按 ${LANDED.dutyCN * 100}% 假设，实际按 HS 编码）。第一行为最低。</p>`
        : '<p class="small muted">还没有报价。</p>'}
      ${qs.length ? `<h3>供应商提问</h3>${qs.map((x) => `<div class="small" style="margin:6px 0"><b>${esc(x.makerName)}：</b>${esc(x.text)}<br>${x.answer ? `<span class="muted">你的回答：${esc(x.answer)}</span>` : `<input data-qa="${x.i}" placeholder="回答（所有报价方可见）" style="width:70%"><button data-qa-send="${x.i}">回答</button>`}</div>`).join("")}` : ""}
    </div>`;
  }).join("");
  const m = say(`<b>我的询价单</b>${html}`, "bot", "wide");
  m.querySelectorAll("[data-qa-send]").forEach((b) => b.onclick = () => {
    const inp = m.querySelector(`[data-qa="${b.dataset.qaSend}"]`); if (!inp.value.trim()) return;
    answerQuestion(+b.dataset.qaSend, inp.value.trim()); inp.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "你的回答：" + inp.value.trim() })); b.remove();
  });
};

welcome();
