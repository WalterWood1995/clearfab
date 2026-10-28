// Supplier: RFQ hall -> RFQ with process file, quantity, delivery address -> quote with several variants
// (price, lead time, payment terms, delivery terms). Prototype: quotes and questions are stored in this browser.
import { Viewer } from "./viewer.js";
import { esc, num, eur } from "./common.js";
import { allRfqs, quotesFor, saveQuote, PAY_OPTS, INCOTERMS, PROCESS_OPTS, freightEstimate, LANDED, questionsFor, addQuestion, daysLeft } from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
// demo supplier profile: capabilities drive the match score
const ME = { maker: "demo-maker", makerName: "苏州精工机械（演示供应商）", makerInfo: "中国苏州 · ISO 9001 / IATF 16949 · 12 年",
  origin: "CN", procs: ["mill", "turn", "sheet", "diecast", "imm", "weld", "deburr", "anodize", "zinc", "powder", "inspect"],
  maxSize: 800, materials: ["铝", "钢", "不锈钢", "POM", "PA6", "ABS"] };

function match(r) {
  const need = r.procs || [], have = need.filter((p) => ME.procs.includes(p));
  const procScore = need.length ? have.length / need.length : 1;
  const sizeOk = !r.bbox || Math.max(...r.bbox) <= ME.maxSize;
  const matOk = ME.materials.some((m) => r.material.includes(m));
  const score = Math.round(100 * procScore * (sizeOk ? 1 : 0.5) * (matOk ? 1 : 0.6));
  const gaps = need.filter((p) => !ME.procs.includes(p)).map((p) => PROCESS_OPTS[p]);
  if (!sizeOk) gaps.push("尺寸超出设备行程"); if (!matOk) gaps.push("材料不在常用范围");
  return { score, gaps };
}

const buyerLine = (r) => r.rating ? `${esc(r.industry)} · 平台下单 ${r.rating.orders} 次 · 询价转订单 ${Math.round(r.rating.rate * 100)}% · 按时付款 ${Math.round(r.rating.paid_on_time * 100)}%` : "新买家，暂无记录";

async function hall() {
  const list = await allRfqs();
  const fams = ["全部", "匹配度 ≥ 80", "铣削", "车削", "钣金", "铸", "注塑", "3D 打印"];
  main.innerHTML = `<h2 style="margin:6px 0 2px">询价单大厅</h2><p class="small muted">${list.length} 张开放询价单，按与你工厂能力的匹配度排序。打开后可看工艺文件、交货地址、付款期望，并可向买家提问（正式版按份收取查看费，内测期免费）。</p>
    <div class="hall-filter">${fams.map((f, i) => `<button class="chip-btn ${i ? "" : "on"}" data-f="${f}">${f}</button>`).join("")}</div>
    <div class="rfqs" id="cards"></div>`;
  const rows = list.map((r) => ({ r, m: match(r) })).sort((a, b) => b.m.score - a.m.score);
  const draw = (f) => {
    $("#cards").innerHTML = rows.filter(({ r, m }) => f === "全部" || (f.startsWith("匹配") ? m.score >= 80 : r.process_name.includes(f))).map(({ r, m }) => {
      const left = daysLeft(r.quote_by), nq = quotesFor(r.id).length;
      const est = r.ref_total ? r.ref_total[ME.origin === "CN" ? "CN" : "DE"] : null;
      return `<div class="rfq"><div class="row"><h4 style="flex:1">${esc(r.id)} · ${esc(r.title)}</h4><span class="tag ${m.score >= 80 ? "ok" : m.score >= 50 ? "warn" : "bad"}">匹配 ${m.score}%</span></div>
        <div class="row">${[r.process_name, r.material, r.qty + " 件/批", num(r.annual, 0) + " 件/年"].map((x) => `<span class="tag">${esc(x)}</span>`).join("")}${r.sample ? "" : '<span class="tag warn">你刚发布的</span>'}</div>
        <div class="small">${est ? `平台估算出厂成本 <b>${eur(est, 0)}</b>（你所在地区）` : ""}${r.target ? ` · 买家目标单价 <b>${eur(r.target)}</b>` : ""}</div>
        <div class="small muted">买家：${buyerLine(r)}</div>
        <div class="small muted">交货 ${esc(r.address)} · ${esc(r.incoterm)} · 付款 ${esc(r.pay)}</div>
        <div class="small">${left != null ? `<b>${left > 0 ? "报价截止还剩 " + left + " 天" : "报价已截止"}</b> · ` : ""}${r.views || 0} 家看过 · ${nq} 份报价</div>
        ${m.gaps.length ? `<div class="small" style="color:var(--warn)">缺口：${esc(m.gaps.join("、"))}（可外协）</div>` : ""}
        <button class="primary" data-id="${esc(r.id)}">打开询价单</button></div>`; }).join("") || '<p class="muted">没有符合的询价单。</p>';
    document.querySelectorAll("[data-id]").forEach((b) => b.onclick = () => { location.hash = b.dataset.id; });
  };
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { document.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); draw(b.dataset.f); });
  draw("全部");
}

function variantHtml(k, v = {}, r) {
  return `<div class="variant" data-k="${k}"><h4>方案 ${String.fromCharCode(65 + k)}</h4>${k ? '<button class="rm">删除</button>' : ""}
    <div class="form" style="grid-template-columns:96px 1fr">
      <label>单价 €/件</label><input class="v-unit" type="number" step="0.01" value="${v.unit ?? ""}">
      <label>一次性费用 €</label><div class="row"><input class="v-oneoff" type="number" value="${v.oneoff ?? 0}"><span class="small muted">模具、夹具、首件、编程</span></div>
      <label>批量 / 起订</label><input class="v-moq" type="number" value="${v.moq ?? r.qty}">
      <label>交期（天）</label><input class="v-lead" type="number" value="${v.lead ?? 25}">
      <label>交付方式</label><div class="row"><select class="v-inc">${Object.entries(INCOTERMS).map(([c, n]) => `<option value="${c}" ${c === (v.incoterm || r.incoterm) ? "selected" : ""}>${n}</option>`).join("")}</select><input class="v-place" placeholder="交付地点" value="${esc(v.place ?? "")}"></div>
      <label>付款方式</label><select class="v-pay">${PAY_OPTS.map((p) => `<option ${p === (v.pay || r.pay) ? "selected" : ""}>${p}</option>`).join("")}</select>
      <label>方案说明</label><input class="v-note" placeholder="例：用库存料可提前 5 天 / 预付可再降 3%" value="${esc(v.note ?? "")}">
    </div><div class="small muted v-landed" style="margin-top:6px"></div></div>`;
}

async function detail(id) {
  const r = (await allRfqs()).find((x) => x.id === id);
  if (!r) return hall();
  const mine = quotesFor(id).find((q) => q.maker === ME.maker);
  const m = match(r), left = daysLeft(r.quote_by);
  const fr = r.mass_kg ? freightEstimate(r.mass_kg * r.qty, ME.origin === "CN") : null;
  main.innerHTML = `<button id="back">← 询价单大厅</button>
  <div class="card" style="margin-top:10px"><div class="row"><h2 style="flex:1;margin:0">${esc(r.id)} · ${esc(r.title)}</h2><span class="tag ${m.score >= 80 ? "ok" : "warn"}">匹配 ${m.score}%</span></div>
    <div class="row" style="margin-top:6px">${[r.process_name, r.material, r.qty + " 件/批", num(r.annual, 0) + " 件/年"].map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
    <p class="small" style="margin:6px 0 0">买家：${esc(r.buyer)} · ${buyerLine(r)}</p>
    <p class="small muted" style="margin:2px 0 0">${left != null ? `报价截止 ${esc(r.quote_by)}（还剩 ${left} 天）· ` : ""}${r.views || 0} 家看过 · ${quotesFor(id).length} 份报价 · 联系方式在买家打开你的报价后互相可见</p></div>
  <div class="grid2">
    <div>${r.files.stl ? `<div class="viewer" id="vw"><div class="hud">零件 3D 数模</div></div>` : `<div class="card">买家只提供了 2D 图纸（${esc(r.files.name || "")}），正式版可在此查看和下载。</div>`}
      <div class="card" style="margin-top:12px"><h2>交付要求</h2><dl class="kv">
        <dt>数量</dt><dd>本批 ${r.qty} 件 · 年需求 ${num(r.annual, 0)} 件</dd>
        <dt>交货地址</dt><dd>${esc(r.address)}</dd><dt>期望交付</dt><dd>${esc(INCOTERMS[r.incoterm])}</dd>
        <dt>期望付款</dt><dd>${esc(r.pay)}</dd><dt>期望交期</dt><dd>${esc(r.deadline || "尽快")}</dd>
        <dt>质量</dt><dd>${esc(r.quality)}</dd>
        ${r.target ? `<dt>目标单价</dt><dd>${eur(r.target)}</dd>` : ""}
        ${r.bbox ? `<dt>尺寸 / 重量</dt><dd>${r.bbox.map((x) => num(x, 1)).join(" × ")} mm${r.mass_kg ? " · " + num(r.mass_kg, 3) + " kg/件 · 整批约 " + num(r.mass_kg * r.qty * 1.2, 0) + " kg（含包装）" : ""}</dd>` : ""}
        ${r.files.step ? `<dt>文件</dt><dd><a href="${r.files.step}" download>STEP 数模</a></dd>` : ""}
        ${r.note ? `<dt>买家备注</dt><dd>${esc(r.note)}</dd>` : ""}</dl>
        ${fr ? `<p class="small" style="margin-top:8px">物流参考（从${ME.origin === "CN" ? "中国" : "欧洲"}发往交货地）：运费约 <b>${eur(fr, 0)}</b>${ME.origin === "CN" ? `，进口关税按 ${LANDED.dutyCN * 100}% 假设约 <b>${eur(((r.ref_total?.CN || 0) + fr) * LANDED.dutyCN, 0)}</b>（实际按 HS 编码）` : ""}。买家要求 ${esc(r.incoterm)}${["DAP", "DDP"].includes(r.incoterm) ? "，需含在报价里" : "，买家自提运费"}。</p>` : ""}</div>
      <div class="card"><h2>工艺文件</h2>
        <table><tr><th>#</th><th>环节</th><th>工序</th><th>依据 / 要求</th></tr>${r.route.map((s, k) => `<tr><td>${k + 1}</td><td>${esc(s.stage)}</td><td>${esc(s.op)}</td><td class="small">${esc(s.basis)}</td></tr>`).join("")}</table>
        ${m.gaps.length ? `<p class="small" style="color:var(--warn)">你的工厂缺少：${esc(m.gaps.join("、"))}，可在方案说明里写明外协安排。</p>` : ""}
        ${r.ref_total ? `<p class="small" style="margin-top:8px">平台参考出厂成本：德国 <b>${eur(r.ref_total.DE, 0)}</b> · 中国 <b>${eur(r.ref_total.CN, 0)}</b>（${r.qty} 件）· <a href="demo.html?case=${r.caseId}" target="_blank">逐工序成本与仿真</a></p>` : ""}</div>
      <div class="card"><h2>向买家提问</h2><div id="qa"></div>
        <div class="row" style="margin-top:8px"><input id="qText" placeholder="例：Ø9 孔是否需要倒角？表面处理颜色？" style="flex:1"><button id="qSend">提问</button></div>
        <p class="small muted">问题和回答对所有报价方可见，避免信息不对称。</p></div>
    </div>
    <div class="card"><h2>我的报价</h2>
      <p class="small muted">可以给出多个方案，突出你的优势：不同交期、付款方式、交付方式或批量价格。每个方案下方显示买家视角的到岸总价。</p>
      <div class="variants" id="vars"></div>
      <div class="row" style="margin-top:10px"><button id="addVar">＋ 添加方案</button></div>
      <h3>给买家的话</h3><textarea id="msg" placeholder="产能、设备、认证、类似零件经验…">${esc(mine?.message || "")}</textarea>
      <button class="primary" id="submit" style="margin-top:10px;width:100%">${mine ? "更新报价" : "提交报价"}</button>
      <p class="small muted">合同由买卖双方直接签署，ClearFab 不是合同当事方。</p></div>
  </div>`;
  $("#back").onclick = () => { location.hash = ""; };
  if (r.files.stl) { const v = new Viewer($("#vw")); v.loadSTL(r.files.stl); }
  const drawQa = () => { const qs = questionsFor(id); $("#qa").innerHTML = qs.length ? qs.map((q) => `<div class="small" style="margin:4px 0"><b>${esc(q.makerName)}：</b>${esc(q.text)}<br><span class="muted">${q.answer ? "买家回答：" + esc(q.answer) : "等待买家回答"}</span></div>`).join("") : '<p class="small muted">还没有提问。</p>'; };
  drawQa();
  $("#qSend").onclick = () => { const t = $("#qText").value.trim(); if (!t) return; addQuestion({ rfq: id, maker: ME.maker, makerName: ME.makerName, text: t, created: new Date().toISOString() }); $("#qText").value = ""; drawQa(); };
  const vars = $("#vars");
  const landedNote = (el) => {
    const unit = +$(".v-unit", el).value, inc = $(".v-inc", el).value;
    if (!(unit > 0)) { $(".v-landed", el).textContent = ""; return; }
    const goods = unit * r.qty, f = ["DAP", "DDP"].includes(inc) ? 0 : (fr || 0), duty = ME.origin === "CN" && inc !== "DDP" ? (goods + f) * LANDED.dutyCN : 0;
    const tot = goods + (+$(".v-oneoff", el).value || 0) + f + duty;
    $(".v-landed", el).innerHTML = `买家视角到岸总价 ≈ <b>${eur(tot, 0)}</b>（货值 ${eur(goods, 0)}${f ? " + 运费 " + eur(f, 0) : ""}${duty ? " + 关税 " + eur(duty, 0) : ""}）${r.target ? ` · 单价${unit <= r.target ? "达到" : "高于"}目标价` : ""}`;
  };
  const add = (v) => { vars.insertAdjacentHTML("beforeend", variantHtml(vars.children.length, v, r)); const el = vars.lastElementChild; $(".rm", el)?.addEventListener("click", () => el.remove()); el.addEventListener("input", () => landedNote(el)); landedNote(el); };
  (mine?.variants || [{}]).forEach(add);
  $("#addVar").onclick = () => add({ pay: "30% 预付 + 70% 发货前", incoterm: "FCA" });
  $("#submit").onclick = () => {
    const variants = [...vars.children].map((el) => ({ unit: +$(".v-unit", el).value, oneoff: +$(".v-oneoff", el).value || 0, moq: +$(".v-moq", el).value,
      lead: +$(".v-lead", el).value, incoterm: $(".v-inc", el).value, place: $(".v-place", el).value, pay: $(".v-pay", el).value, note: $(".v-note", el).value }));
    if (variants.some((v) => !(v.unit > 0))) return alert("每个方案都要填单价");
    saveQuote({ rfq: id, ...ME, variants, message: $("#msg").value, created: new Date().toISOString() });
    $("#submit").textContent = "已提交 ✓ 可继续修改";
  };
}

const route = () => (location.hash.length > 1 ? detail(decodeURIComponent(location.hash.slice(1))) : hall());
window.addEventListener("hashchange", route);
route();
