// Supplier: RFQ hall -> RFQ with process file, quantity, delivery address -> quote with several variants
// (price, lead time, payment terms, delivery terms). Prototype: quotes are stored in this browser.
import { Viewer } from "./viewer.js";
import { esc, num, eur } from "./common.js";
import { allRfqs, quotesFor, saveQuote, PAY_OPTS, INCOTERMS } from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const ME = { maker: "demo-maker", makerName: "苏州精工机械（演示供应商）", makerInfo: "中国苏州 · ISO 9001 / IATF 16949 · 12 年" };

async function hall() {
  const list = await allRfqs();
  const fams = ["全部", "铣削", "车削", "钣金", "铸", "注塑", "3D 打印"];
  main.innerHTML = `<h2 style="margin:6px 0 2px">询价单大厅</h2><p class="small muted">${list.length} 张开放询价单。打开询价单可以看到工艺文件、数量、交货地址和付款期望（正式版按份收取查看费，内测期免费）。</p>
    <div class="hall-filter">${fams.map((f, i) => `<button class="chip-btn ${i ? "" : "on"}" data-f="${f}">${f}</button>`).join("")}</div>
    <div class="rfqs" id="cards"></div>`;
  const draw = (f) => {
    $("#cards").innerHTML = list.filter((r) => f === "全部" || r.process_name.includes(f.replace("铸", "铸"))).map((r) => `
      <div class="rfq"><h4>${esc(r.id)} · ${esc(r.title)}</h4>
        <div class="row">${[r.process_name, r.material, r.qty + " 件/批", num(r.annual, 0) + " 件/年"].map((x) => `<span class="tag">${esc(x)}</span>`).join("")}${r.sample ? "" : '<span class="tag warn">你刚发布的</span>'}</div>
        <div class="small muted">${r.bbox ? "包络 " + r.bbox.map((x) => num(x, 0)).join("×") + " mm · " : ""}交货 ${esc(r.address)} · ${esc(r.incoterm)}</div>
        <div class="small muted">期望交期 ${esc(r.deadline || "尽快")} · 付款期望 ${esc(r.pay)}${quotesFor(r.id).length ? ' · <span class="tag ok">已报价</span>' : ""}</div>
        <button class="primary" data-id="${esc(r.id)}">打开询价单</button></div>`).join("") || '<p class="muted">没有符合的询价单。</p>';
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
    </div></div>`;
}

async function detail(id) {
  const r = (await allRfqs()).find((x) => x.id === id);
  if (!r) return hall();
  const mine = quotesFor(id).find((q) => q.maker === ME.maker);
  main.innerHTML = `<button id="back">← 询价单大厅</button>
  <div class="card" style="margin-top:10px"><h2>${esc(r.id)} · ${esc(r.title)}</h2>
    <div class="row">${[r.process_name, r.material, r.qty + " 件/批", num(r.annual, 0) + " 件/年"].map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
    <p class="small muted">买家：${esc(r.buyer)}（联系方式在报价被买家打开后互相可见）· 发布 ${esc(r.created)}</p></div>
  <div class="grid2">
    <div>${r.files.stl ? `<div class="viewer" id="vw"><div class="hud">零件 3D 数模</div></div>` : `<div class="card">买家只提供了 2D 图纸（${esc(r.files.name || "")}），正式版可在此查看和下载。</div>`}
      <div class="card" style="margin-top:12px"><h2>交付要求</h2><dl class="kv">
        <dt>数量</dt><dd>本批 ${r.qty} 件 · 年需求 ${num(r.annual, 0)} 件</dd>
        <dt>交货地址</dt><dd>${esc(r.address)}</dd><dt>期望交付</dt><dd>${esc(INCOTERMS[r.incoterm])}</dd>
        <dt>期望付款</dt><dd>${esc(r.pay)}</dd><dt>期望交期</dt><dd>${esc(r.deadline || "尽快")}</dd>
        <dt>质量</dt><dd>${esc(r.quality)}</dd>
        ${r.bbox ? `<dt>尺寸 / 重量</dt><dd>${r.bbox.map((x) => num(x, 1)).join(" × ")} mm${r.mass_kg ? " · " + num(r.mass_kg, 3) + " kg/件" : ""}</dd>` : ""}
        ${r.files.step ? `<dt>文件</dt><dd><a href="${r.files.step}" download>STEP 数模</a></dd>` : ""}
        ${r.note ? `<dt>买家备注</dt><dd>${esc(r.note)}</dd>` : ""}</dl></div>
      <div class="card"><h2>工艺文件</h2>
        <table><tr><th>#</th><th>环节</th><th>工序</th><th>依据 / 要求</th></tr>${r.route.map((s, k) => `<tr><td>${k + 1}</td><td>${esc(s.stage)}</td><td>${esc(s.op)}</td><td class="small">${esc(s.basis)}</td></tr>`).join("")}</table>
        ${r.ref_total ? `<p class="small" style="margin-top:8px">平台参考出厂成本：德国 <b>${eur(r.ref_total.DE, 0)}</b> · 中国 <b>${eur(r.ref_total.CN, 0)}</b>（${r.qty} 件）· <a href="demo.html?case=${r.caseId}" target="_blank">逐工序成本与仿真</a></p>` : ""}</div>
    </div>
    <div class="card"><h2>我的报价</h2>
      <p class="small muted">可以给出多个方案，突出你的优势：不同交期、付款方式、交付方式或批量价格。</p>
      <div class="variants" id="vars"></div>
      <div class="row" style="margin-top:10px"><button id="addVar">＋ 添加方案</button></div>
      <h3>给买家的话</h3><textarea id="msg" placeholder="产能、设备、认证、类似零件经验…">${esc(mine?.message || "")}</textarea>
      <button class="primary" id="submit" style="margin-top:10px;width:100%">${mine ? "更新报价" : "提交报价"}</button>
      <p class="small muted">合同由买卖双方直接签署，ClearFab 不是合同当事方。</p></div>
  </div>`;
  $("#back").onclick = () => { location.hash = ""; };
  if (r.files.stl) { const v = new Viewer($("#vw")); v.loadSTL(r.files.stl); }
  const vars = $("#vars");
  const add = (v) => { vars.insertAdjacentHTML("beforeend", variantHtml(vars.children.length, v, r)); const el = vars.lastElementChild; $(".rm", el)?.addEventListener("click", () => el.remove()); };
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
