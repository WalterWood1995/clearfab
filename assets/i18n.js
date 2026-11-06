// UI language layer (2026-11-05). The pages are written in Chinese; this script translates what they show.
// Load it as a classic script in <head>, before the page modules:  <script src="i18n.js"></script>
//
// - Language: ?lang=xx, else localStorage cf_lang, else the browser language, else English.
// - Dictionaries: i18n/<lang>.json = { "<Chinese source text>": "<translation>" } (built by tools/i18n_build.py).
// - Text nodes, placeholders, titles, alert/confirm/prompt and canvas labels are translated as they appear
//   (MutationObserver). A text equal to a source string is replaced whole, otherwise every known fragment in it
//   is replaced, longest first. Elements with translate="no" (and inputs/textareas) are left alone, so what users
//   typed stays in the language they wrote it in.
// - Same-origin fetches carry X-UI-Lang, so the AI answers in the page language (server/ai_model.lang_note).
(function () {
  "use strict";
  var LANGS = [
    ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"],
    ["pt", "Português"], ["pl", "Polski"], ["cs", "Čeština"], ["sk", "Slovenčina"], ["hu", "Magyar"],
    ["tr", "Türkçe"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"], ["vi", "Tiếng Việt"], ["th", "ไทย"]
  ];
  var CODES = LANGS.map(function (l) { return l[0]; });
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } }
  };
  function pick() {
    var q = new URLSearchParams(location.search).get("lang");
    if (q && CODES.indexOf(q) >= 0) { store.set("cf_lang", q); return q; }
    var s = store.get("cf_lang");
    if (CODES.indexOf(s) >= 0) return s;
    var navs = navigator.languages || [navigator.language || "en"];
    for (var i = 0; i < navs.length; i++) {
      var c = String(navs[i]).toLowerCase().slice(0, 2);
      if (CODES.indexOf(c) >= 0) return c;
    }
    return "en";
  }
  var LANG = pick();
  // extra API origins that should also get X-UI-Lang (static site with a separate backend):
  // <script src="i18n.js" data-api-origins="https://host:8443"></script>
  var me = document.currentScript;
  var API_ORIGINS = ((me && me.getAttribute("data-api-origins")) || "").split(",").filter(Boolean);
  var BASE = (me && me.getAttribute("data-dict-base")) || "i18n/";
  window.CF_LANG = LANG;
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : LANG;

  // same-origin requests tell the server the page language
  var ofetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    try {
      var url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin || API_ORIGINS.indexOf(url.origin) >= 0) {
        var h = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
        if (!h.has("X-UI-Lang")) h.set("X-UI-Lang", LANG);
        init = Object.assign({}, init, { headers: h });
      }
    } catch (e) { /* leave the request as it is */ }
    return ofetch.call(this, input, init);
  };

  var DICT = null, RE = null;
  var CJK = /[㐀-鿿]/;
  var CJK_LANG = LANG === "zh" || LANG === "ja";
  var PUNCT = { "，": ", ", "。": ". ", "：": ": ", "；": "; ", "（": " (", "）": ")", "、": ", ", "“": "\"", "”": "\"",
                "‘": "'", "’": "'", "！": "! ", "？": "? ", "《": "\"", "》": "\"", "【": "[", "】": "]", "～": "~" };
  if (LANG !== "zh") {
    try {
      var x = new XMLHttpRequest();
      x.open("GET", BASE + LANG + ".json", false);   // synchronous on purpose: translate before the first paint
      x.send();
      if (x.status === 200) DICT = JSON.parse(x.responseText);
    } catch (e) { DICT = null; }
  }
  if (DICT) {
    var keys = Object.keys(DICT).filter(function (k) { return k && DICT[k] && CJK.test(k); });
    keys.sort(function (a, b) { return b.length - a.length; });
    if (keys.length) RE = new RegExp(keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "g");
  }

  function tr(s) {
    if (!RE || !s || !CJK.test(s)) return s;
    var t = s.trim();
    var out;
    if (Object.prototype.hasOwnProperty.call(DICT, t)) out = s.replace(t, DICT[t]);
    // fragments: in languages with spaces, keep a space where two pieces (or a piece and a word) meet
    else out = s.replace(RE, function (m, off, str) {
      var prev = off > 0 ? str.charAt(off - 1) : "";
      return (!CJK_LANG && prev && /[A-Za-z0-9㐀-鿿]/.test(prev) ? " " : "") + DICT[m];
    });
    if (!CJK_LANG) out = out.replace(/[，。：；（）、“”‘’！？《》【】～]/g, function (c) { return PUNCT[c]; }).replace(/ {2,}/g, " ").replace(/\( /g, "(");
    return out;
  }
  window.cfT = tr;

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.tagName] || e.getAttribute("translate") === "no" || e.isContentEditable) return true;
    }
    return false;
  }
  // what this script wrote last: never translate its own output again (Japanese output still contains kanji,
  // re-translating it looped forever)
  var DONE = new WeakMap();
  function doText(n) {
    var v = n.nodeValue;
    if (!v || !CJK.test(v) || DONE.get(n) === v || skipped(n.parentNode)) return;
    var t = tr(v);
    if (t === v) return;
    // an <option> without value submits its text: pin the original so the server still gets the Chinese key
    var p = n.parentNode;
    if (p && p.tagName === "OPTION" && !p.hasAttribute("value")) p.setAttribute("value", v);
    DONE.set(n, t);
    n.nodeValue = t;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      var seen = DONE.get(el) || {};
      if (v && CJK.test(v) && seen[ATTRS[i]] !== v) {
        var t = tr(v);
        if (t !== v) { seen[ATTRS[i]] = t; DONE.set(el, seen); el.setAttribute(ATTRS[i], t); }
      }
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && CJK.test(el.value)) el.value = tr(el.value);
  }
  function walk(root) {
    if (!RE || !root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipped(root)) return; doAttrs(root); }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  window.cfTranslate = walk;

  if (RE) {
    var oalert = window.alert, oconfirm = window.confirm, oprompt = window.prompt;
    window.alert = function (m) { return oalert.call(window, tr(String(m))); };
    window.confirm = function (m) { return oconfirm.call(window, tr(String(m))); };
    window.prompt = function (m, d) { return oprompt.call(window, tr(String(m)), d); };
    var ofill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s) {
      var a = Array.prototype.slice.call(arguments); a[0] = tr(String(s)); return ofill.apply(this, a);
    };
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") { if (!skipped(m.target)) doAttrs(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      if (CJK.test(document.title)) document.title = tr(document.title);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function picker() {
    if (document.getElementById("cfLang")) return;
    var head = document.querySelector("header.top") || document.querySelector("header") || document.querySelector("nav");
    var sel = document.createElement("select");
    sel.id = "cfLang"; sel.className = "lang"; sel.setAttribute("aria-label", "Language"); sel.setAttribute("translate", "no");
    LANGS.forEach(function (l) {
      var o = document.createElement("option"); o.value = l[0]; o.textContent = l[1]; if (l[0] === LANG) o.selected = true; sel.appendChild(o);
    });
    sel.onchange = function () {
      store.set("cf_lang", sel.value);
      var u = new URL(location.href); u.searchParams.delete("lang"); location.href = u.toString();
    };
    if (head) head.appendChild(sel);
    else { sel.style.cssText = "position:fixed;top:10px;right:12px;z-index:9999"; document.body.appendChild(sel); }
  }
  document.addEventListener("DOMContentLoaded", function () {
    walk(document.body);
    if (RE && CJK.test(document.title)) document.title = tr(document.title);
    var md = document.querySelector('meta[name="description"]');
    if (md && RE) md.setAttribute("content", tr(md.getAttribute("content") || ""));
    picker();
  });
})();
