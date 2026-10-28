// Shared helpers: API calls with per-portal token, formatting, login panel, header.
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = (v, d = 2) => v == null ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
export const num = (v, d = 2) => v == null ? "–" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: d });

let ROLE = "buyer";
const key = () => "cf_token_" + ROLE;
export const token = () => { try { return localStorage.getItem(key()) || ""; } catch { return ""; } };
const setToken = (t) => { try { t ? localStorage.setItem(key(), t) : localStorage.removeItem(key()); } catch {} };

export async function api(path, opts = {}) {
  const headers = { Authorization: "Bearer " + token() };
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  const r = await fetch(path, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return data;
}

export function toast(msg, ms = 3500) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

export async function busy(btn, fn) {
  const t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + t;
  try { return await fn(); } catch (e) { toast(e.message, 6000); throw e; } finally { btn.disabled = false; btn.innerHTML = t; }
}

export let META = null;
export function setMeta(m) { META = m; }
export async function boot(role, onReady) {
  ROLE = role;
  META = await api("/api/meta");
  if (!token()) return showLogin(role, onReady);
  try { const me = await api("/api/me"); if (me.user.role !== role) throw new Error(); renderHeader(me); onReady(me); }
  catch { setToken(""); showLogin(role, onReady); }
}

export async function refreshHeader() { const me = await api("/api/me"); renderHeader(me); return me; }

function renderHeader(me) {
  const u = me.user;
  $("#who").innerHTML = `${esc(u.name)} · <span class="muted">${esc(u.company)}</span>`;
  $("#wallet").innerHTML = `余额 <b>${eur(u.wallet)}</b> <button id="topup" class="small">充值</button> <button id="logout">退出</button>`;
  $("#topup").onclick = async () => {
    const v = prompt("模拟充值金额（€）。MVP 未接入真实支付。", "50");
    if (!v) return;
    await api("/api/wallet/topup", { body: { amount: Number(v) } }); refreshHeader(); toast("已模拟充值 " + v + " €");
  };
  $("#logout").onclick = () => { setToken(""); location.reload(); };
}

function showLogin(role, onReady) {
  const isBuyer = role === "buyer";
  $("main").innerHTML = `
  <div class="card login">
    <h2>${isBuyer ? "寻造台 · 买家登录" : "承造台 · 供应商登录"}</h2>
    ${META.demo ? `<div class="row" style="margin-bottom:12px">${isBuyer
      ? '<button class="primary" data-demo="buyer">演示买家一键登录</button>'
      : '<button class="primary" data-demo="maker-de">演示供应商（德国）</button><button class="primary" data-demo="maker-cn">演示供应商（中国）</button>'}</div>
      <p class="small muted">演示账号自带 100 € 模拟余额。</p>` : ""}
    <h3>邮箱登录</h3>
    <div class="form"><label>邮箱</label><input id="le"><label>密码</label><input id="lp" type="password"></div>
    <div class="row" style="margin-top:10px"><button id="lgo" class="primary">登录</button><button id="lreg">注册新账号</button></div>
    <div id="regbox" hidden>
      <h3>注册</h3>
      <div class="form">
        <label>姓名</label><input id="rn"><label>公司</label><input id="rc">
        <label>国家</label><select id="rco">${Object.entries(META.countries).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        ${isBuyer ? "" : `<label>工艺能力</label><div>${Object.entries(META.processes).map(([k, v]) => `<label class="small"><input type="checkbox" class="rp" value="${k}"> ${v}</label>`).join("<br>")}</div>
        <label>认证</label><input id="rcert" placeholder="ISO 9001, IATF 16949 …">`}
        <label>邮箱</label><input id="re"><label>密码</label><input id="rpw" type="password">
      </div>
      <button id="rgo" class="primary" style="margin-top:10px">注册并登录</button>
    </div>
  </div>`;
  const done = async (r) => { setToken(r.token); const me = await api("/api/me"); renderHeader(me); onReady(me); };
  document.querySelectorAll("[data-demo]").forEach((b) => b.onclick = () => busy(b, async () => done(await api("/api/auth/demo?who=" + b.dataset.demo, { method: "POST" }))));
  $("#lgo").onclick = (e) => busy(e.target, async () => done(await api("/api/auth/login", { body: { email: $("#le").value, password: $("#lp").value } })));
  $("#lreg").onclick = () => { $("#regbox").hidden = false; };
  $("#rgo").onclick = (e) => busy(e.target, async () => {
    const country = $("#rco").value;
    const profile = isBuyer ? {} : {
      processes: [...document.querySelectorAll(".rp:checked")].map((x) => x.value),
      certs: $("#rcert").value.split(",").map((s) => s.trim()).filter(Boolean),
      region: { CN: "CN", PL: "EU_E", CZ: "EU_E", HU: "EU_E" }[country] || "DE",
    };
    done(await api("/api/auth/register", { body: { role, name: $("#rn").value, company: $("#rc").value, country, email: $("#re").value, password: $("#rpw").value, profile } }));
  });
}

export function tabs(el, names, onSel) {
  el.innerHTML = names.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join("");
  const sel = (k) => { el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); onSel(k); };
  el.querySelectorAll("button").forEach((b) => b.onclick = () => sel(b.dataset.k));
  return sel;
}

export const fmtDate = (t) => new Date(t * 1000).toLocaleDateString("zh-CN");
