/* Liquara app: screens, charts, connections and the board pack. The math lives in engine.js. */
(function () {
  "use strict";
  var E = window.AOE, Q = window.AOQ, DEMO = window.AODemo;
  var app = document.getElementById("app"), nav = document.getElementById("nav");
  var VERSION = "1.0.0";
  var S = loadS(), ST = { sources: [], tab: "home", qa: [], hz: "13w", ins: "margins", sc: defSc(), charts: {}, busy: false };
  function defSc() { return { pricePct: 0, volumePct: 0, hires: 0, salary: 70000, collectFaster: 0, payLater: 0, cutCat: "", cutPct: 0, spend: 0, spendWeek: 4, loan: 0, loanRate: 9, loanMonths: 36 }; }

  /* ---------- storage: settings in localStorage, data in IndexedDB, all on this device ---------- */
  function loadS() { try { return JSON.parse(localStorage.getItem("ao.s") || "{}"); } catch (e) { return {}; } }
  /* Two separate workspaces, like any SaaS: the customer's ACCOUNT (ao.s + their files) and the SAMPLE company (ao.d).
     Exploring the sample never touches the account, and leaving it brings the account back exactly as it was. */
  var WS = "account", ACC = null;
  function stKey() { return WS === "demo" ? "ao.d" : "ao.s"; }
  function acc() { return WS === "demo" ? (ACC || {}) : S; }
  /* the account's own state, even while the sample company is open (licenses and PINs always belong to the account) */
  function accS() { if (WS !== "demo") return S; if (!ACC) ACC = loadS(); return ACC; }
  function saveAcc() { if (WS === "demo") { try { localStorage.setItem("ao.s", JSON.stringify(accS())); } catch (e) { } } else saveS(); }
  function ownerOf(key, email) { return String(email || "").trim().toLowerCase() || String(key || ""); }
  function saveS() { try { localStorage.setItem(stKey(), JSON.stringify(S)); } catch (e) { } if (WS === "account" && typeof markDirty === "function") markDirty(); }
  var dbp = null;
  function db() { if (dbp) return dbp; dbp = new Promise(function (ok, no) { var r = indexedDB.open("aorta", 1); r.onupgradeneeded = function () { r.result.createObjectStore("src", { keyPath: "id" }); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); return dbp; }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (ok, no) { var t = d.transaction("src", mode), s = t.objectStore("src"), out = fn(s); t.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { no(t.error); }; }); }); }
  function allSrc() { return tx("readonly", function (s) { return s.getAll(); }); }
  function putSrc(o) { return tx("readwrite", function (s) { s.put(o); if (o.origin !== "manual" && o.origin !== "demo") s.delete("manual"); }).then(function (x) { if (o.origin !== "demo" && typeof markDirty === "function") markDirty(); return x; }); }
  function delSrc(id) { return tx("readwrite", function (s) { s.delete(id); }).then(function (x) { if (typeof markDirty === "function") markDirty(); return x; }); }
  function clearSrc() { return tx("readwrite", function (s) { s.clear(); }); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  /* ================= Sync across devices (license-based, encrypted on the device) ================= */
  var LOCAL_ONLY = ["license", "device", "lang", "theme", "helperUrl", "demo", "pin", "syncRev", "syncAt", "syncDirty", "sync", "rates", "licMsg", "trial", "devName", "owner", "syncErr"];
  var SYNC = { t: 0, busy: false, applying: false };
  function syncOn() { return WS === "account" && paid() && !S.demo && S.license && S.license.key && S.sync !== false && helperReady() && window.JSZip && crypto && crypto.subtle; }
  async function syncKey() { var base = await crypto.subtle.importKey("raw", new TextEncoder().encode("liquara-sync|" + S.license.key), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode("liquara-sync-v1"), iterations: 120000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function packData() {
    var s = {}; Object.keys(S).forEach(function (k) { if (LOCAL_ONLY.indexOf(k) < 0) s[k] = S[k]; });
    var src = (await allSrc()).filter(function (x) { return x.origin !== "demo"; });
    var z = new JSZip(); z.file("d.json", JSON.stringify({ v: 1, s: s, src: src }));
    var raw = await z.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    var iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, await syncKey(), raw));
    return "v1." + b64(iv) + "." + b64(ct);
  }
  async function unpackData(blob) {
    var p = String(blob).split("."); if (p[0] !== "v1") throw new Error("Unknown sync format");
    var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p[1]) }, await syncKey(), unb64(p[2]));
    var z = await JSZip.loadAsync(raw); return JSON.parse(await z.file("d.json").async("string"));
  }
  function devName() { if (S.devName) return S.devName; return isNative() ? "Android app" : /Android|iPhone|iPad/i.test(navigator.userAgent) ? "phone browser" : "computer"; }
  function markDirty() { if (WS !== "account" || SYNC.applying || S.demo || !paid()) return; S.syncDirty = Date.now(); try { localStorage.setItem("ao.s", JSON.stringify(S)); } catch (e) { } clearTimeout(SYNC.t); SYNC.t = setTimeout(function () { syncPush(false); }, 4000); }
  async function syncPush(force) {
    if (!syncOn() || SYNC.busy) return;
    if (!S.syncRev && !SYNC.checked) { SYNC.checked = true; await syncPull(false); if (S.syncRev || SYNC.busy || !syncOn()) return; }
    if (!hasOwnData()) return; /* never overwrite the saved copy with an empty device */
    SYNC.busy = true;
    try {
      var blob = await packData(), r;
      try { r = await helper("/sync/push", { blob: blob, base: S.syncRev || 0, devName: devName(), force: !!force }); }
      catch (e) { if (e.status === 409) { SYNC.busy = false; await syncPull(true); return; } throw e; }
      S.syncRev = r.rev; S.syncAt = r.at; delete S.syncDirty; saveRaw();
    } catch (e) { S.syncErr = e.message; saveRaw(); }
    SYNC.busy = false;
  }
  function saveRaw() { try { localStorage.setItem(stKey(), JSON.stringify(S)); } catch (e) { } }
  function enterDemo() {
    if (WS === "demo") return;
    try { localStorage.setItem("ao.s", JSON.stringify(S)); } catch (e) { }
    ACC = S; WS = "demo";
    var d = {}; try { d = JSON.parse(localStorage.getItem("ao.d") || "{}"); } catch (e) { }
    ["lang", "theme", "device", "helperUrl"].forEach(function (k) { if (ACC[k] !== undefined) d[k] = ACC[k]; });
    S = d; try { sessionStorage.setItem("lq_ws", "demo"); } catch (e) { }
    ST.res = null; ST.model = null; ST.qa = []; ST.sc = defSc(); ST.tab = "home"; ST.planOnly = false; ST.gateMsg = null;
  }
  /* switches back to the account straight away (so a file picker can still open), then reloads its numbers */
  function leaveDemo() {
    if (WS !== "demo") return Promise.resolve();
    try { localStorage.setItem("ao.d", JSON.stringify(S)); } catch (e) { }
    var look = { lang: S.lang, theme: S.theme };
    S = ACC || loadS(); ACC = null; WS = "account";
    Object.keys(look).forEach(function (k) { if (look[k] !== undefined) S[k] = look[k]; });
    try { sessionStorage.removeItem("lq_ws"); } catch (e) { }
    ST.res = null; ST.model = null; ST.qa = []; ST.sc = defSc(); ST.tab = "home"; ST.ob = null; ST.planOnly = false; ST.gateMsg = null;
    return (async function () { try { ST.sources = await allSrc(); } catch (e) { ST.sources = []; } if (ST.sources.length || (S.costs || []).length) await analyze(); renewNow(false); })();
  }
  async function syncPull(afterConflict) {
    if (!syncOn() || SYNC.busy) return false; SYNC.busy = true; var changed = false;
    try {
      var r = await helper("/sync/pull", { have: S.syncRev || 0 });
      if (r.empty) { SYNC.busy = false; if (hasOwnData()) syncPush(false); return false; }
      if (r.same) { SYNC.busy = false; if (S.syncDirty) syncPush(false); return false; }
      /* a device that has never synced always takes the saved copy first; after that, the newest change wins */
      if (S.syncRev && S.syncDirty && !afterConflict && S.syncDirty > (r.at || 0) && hasOwnData()) { SYNC.busy = false; await syncPush(true); return false; }
      var d = await unpackData(r.blob);
      SYNC.applying = true;
      var keep = {}; LOCAL_ONLY.forEach(function (k) { if (S[k] !== undefined) keep[k] = S[k]; });
      S = Object.assign({}, d.s || {}, keep); delete S.demo; S.syncRev = r.rev; S.syncAt = r.at; delete S.syncDirty; saveRaw();
      await clearSrc(); for (var i = 0; i < (d.src || []).length; i++) await putSrc(d.src[i]);
      ST.sources = await allSrc(); ST.res = null; ST.model = null;
      if (ST.sources.length || (S.costs || []).length) await analyze();
      SYNC.applying = false; changed = true;
      toast("Your data is here, synced from your " + (r.dev || "other device"));
    } catch (e) { SYNC.applying = false; if (/decrypt|operation/i.test(e.message || "")) S.syncErr = "Couldn't unlock the synced data"; }
    SYNC.busy = false; if (changed) render(); return changed;
  }
  function hasOwnData() { return !S.demo && ((ST.sources && ST.sources.filter(function (x) { return x.origin !== "demo"; }).length) || (S.costs || []).length || S.company || S.size); }
  function syncPanel() {
    if (!paid() || S.demo || WS !== "account") return "";
    var on = S.sync !== false;
    return '<div class="panel"><div class="eyebrow">Sync across your devices</div><p class="small mute" style="margin:0 0 10px">' + (on ? "Your company setup, files and settings follow your license to the website and the app. They're scrambled with your license key on this device before they're stored." : "Sync is off. Your data stays only on this device.") + "</p>" +
      (on ? '<div class="tiny mute" style="margin-bottom:10px">' + (S.syncAt ? "Last synced " + new Date(S.syncAt).toLocaleString() : "Not synced yet") + (S.syncErr ? ' · <span class="warn">' + esc(S.syncErr) + "</span>" : "") + "</div>" : "") +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' + (on ? '<button class="btn sm" data-act="syncnow">Sync now</button>' : "") + '<button class="btn ghost sm" data-act="synctoggle">' + (on ? "Turn sync off" : "Turn sync on") + "</button></div></div>";
  }

  /* ---------- install on a computer (Chrome / Edge) ---------- */
  var INSTALL = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); INSTALL = e; if (ST.tab === "settings") render(); });
  window.addEventListener("appinstalled", function () { INSTALL = null; toast("Liquara is installed. Find it on your desktop or Start menu."); });
  function installPanel() {
    if (isNative()) return "";
    var standalone = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
    if (standalone) return "";
    return '<div class="panel"><div class="eyebrow">Install Liquara</div><p class="small mute" style="margin:0 0 10px">' + (INSTALL ? "Put Liquara on this computer with its own icon and window, like a normal program." : /iPhone|iPad/i.test(navigator.userAgent) ? "On iPhone: tap Share, then Add to Home Screen." : "In Chrome or Edge, use the Install icon at the right end of the address bar. On Android, get the app from the Mobile app page.") + '</p><div class="row" style="gap:8px;flex-wrap:wrap">' + (INSTALL ? '<button class="btn pri" data-act="install">Install on this computer</button>' : "") + '<a class="btn ghost" href="mobile" target="_blank" rel="noopener">Android app</a><a class="btn ghost" href="account" target="_blank" rel="noopener">My account</a></div></div>';
  }

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var m = function (x) { return E.money(x); }, pc = function (x) { return Math.round(x * 100) + "%"; }, fd = function (d) { return E.fmtDate(d); };
  function sd(d) { return d.toLocaleDateString(langLoc(), { month: "short", day: "numeric", timeZone: "UTC" }); }
  function toast(t) { var x = document.createElement("div"); x.className = "toast"; x.textContent = t; document.body.appendChild(x); setTimeout(function () { x.remove(); }, 2600); }
  function plug(n) { var c = window.Capacitor; return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins[n] || null; }
  function buzz() { var h = plug("Haptics"); if (h) h.impact({ style: "LIGHT" }).catch(function () { }); else if (navigator.vibrate) navigator.vibrate(8); }
  var I = {
    home: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="M8 16 12 6l4 10"/><path d="M6.5 13.5c2 0 3-1.5 5.5-1.5s3.5 1.5 5.5 1.5"/>',
    fc: '<path d="M3 17c3 0 4-5 7-5s3 3 5 3"/><path d="M15 15l6-6M15 15l6 1" opacity=".7"/><circle cx="15" cy="15" r="1.6"/>',
    ins: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    dec: '<path d="M12 3v18M5 21h14M4 8l-2 6a4 4 0 0 0 4 0L4 8Zm16 0-2 6a4 4 0 0 0 4 0l-2-6ZM4 8h16"/>',
    ask: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 10h8M8 13h5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    demo: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
    pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.4V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z"/>',
    data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24">' + I[n] + "</svg>"; }
  var MARK = '<svg class="mk" viewBox="0 0 100 100"><defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e3a8"/><stop offset=".5" stop-color="#d9b45f"/><stop offset="1" stop-color="#a8822f"/></linearGradient></defs><circle cx="50" cy="50" r="47" fill="#0a1836" stroke="url(#hg)" stroke-width="3"/><path d="M27 80C33 62 41 38 50 20C59 38 67 62 73 80" fill="none" stroke="url(#hg)" stroke-width="7" stroke-linecap="round"/><path d="M50 60L86 46L86 72Z" fill="#c8ff4d" opacity=".28"/><path d="M12 66C20 66 22 57 29 60S37 67 43 61 48 58 50 60" fill="none" stroke="#9fe9ff" stroke-width="3.4" stroke-linecap="round"/><circle cx="50" cy="60" r="4.6" fill="#0a1836" stroke="#e9fbff" stroke-width="2"/></svg>';

  /* ---------- reading sources ---------- */
  async function tablesOf(src) {
    var t = src.type;
    if (t === "ai") return [{ name: src.name, table: src.data, currency: src.currency }];
    if (t === "typed") return [];
    if (t === "bai2") return [{ name: src.name, table: E.parseBAI2(src.data) }];
    if (t === "mt940") return [{ name: src.name, table: E.parseMT940(src.data) }];
    if (t === "camt") return [{ name: src.name, table: E.parseCAMT(src.data) }];
    if (t === "xlsx") return (await E.parseXLSX(src.data)).map(function (tb, i) { return { name: src.name + (i ? " (sheet " + (i + 1) + ")" : ""), table: tb }; });
    if (t === "json") return [{ name: src.name, table: E.parseJSON(src.data) }];
    if (t === "ofx") return [{ name: src.name, table: E.parseOFX(src.data) }];
    return [{ name: src.name, table: E.parseCSV(src.data) }];
  }
  function typeOf(name, text) { if (/\.xlsx$/i.test(name)) return "xlsx"; var sn = E.sniff(name, text || ""); if (sn) return sn; if (/\.(pdf|png|jpe?g|webp|heic|docx?|txt|eml)$/i.test(name)) return "needs-ai"; if (/\.(ofx|qfx|qbo)$/i.test(name) || /<OFX>/i.test(text || "")) return "ofx"; if (/\.json$/i.test(name) || /^\s*[\[{]/.test(text || "")) return "json"; return "csv"; }
  async function demoSources(id) { var c = DEMO.get(id); return c.files.map(function (f) { return { id: "demo-" + f.name, name: f.name, type: "csv", data: f.text, origin: "demo", currency: f.currency }; }); }

  async function analyze() {
    var srcs = S.demo ? await demoSources(S.demo) : ST.sources, items = [];
    for (var i = 0; i < srcs.length; i++) { try { var tbs = await tablesOf(srcs[i]); tbs.forEach(function (x) { var inf = E.infer(x.table, x.name); if (srcs[i].kind) inf.kind = srcs[i].kind; items.push({ name: x.name, table: x.table, inferred: inf, origin: srcs[i].origin, scale: srcs[i].scale, kind: srcs[i].kind, currency: srcs[i].currency || x.currency || x.table.currency || (typeof srcs[i].data === "string" ? E.currencyHint(srcs[i].data) : null) || null }); }); } catch (e) { toast("Couldn't read " + srcs[i].name + ": " + e.message); } }
    if (!items.length) { ST.model = null; ST.res = null; return null; }
    var base = S.ccy || (S.demo ? DEMO.get(S.demo).currency : "USD") || "USD"; S.ccy = S.ccy || base; E.setLocale(langLoc()); E.setCurrency(base, langLoc());
    var M = E.build(items, { base: base, rate: function (c) { return fxFactor(c); } });
    if (M.balanceUnknown && S.balance != null) { M.balance = +S.balance; M.balanceUnknown = false; M.warnings = []; }
    if (!M.tx.length) { ST.model = M; ST.res = null; ST.items = items; return M; }
    var sc = {}; if (S.adj) { sc.volumePct = S.adj.inPct || 0; sc.costPct = S.adj.outPct || 0; }
    var rc = (S.costs || []).filter(function (c) { return c.forecast; }).map(function (c) { return { amount: c.amount, every: c.every }; }); if (rc.length) sc.recurring = rc;
    var R = E.run(M, { sims: 500, scenario: sc });
    ST.model = M; ST.res = R; ST.items = items; ST.ctx = { model: M, analysis: R.analysis, forecast: R.forecast, fit: R.fit };
    return M;
  }
  function companyName() { if (S.company) return S.company; if (S.demo) return DEMO.get(S.demo).name; return "Your business"; }

  /* ---------- the fan chart ---------- */
  function fan(id, o) {
    /* o: { hist:[{k,v}], fc: forecast, days, alt, h } */
    var W = chartW(), H = o.h || 250, pl = 6, pr = 58, pt = 14, pb = 26, FC = o.fc, cut = FC.cut, days = o.days;
    var step = days > 120 ? 7 : 1, pts = [], altp = [];
    for (var j = 0; j <= days; j += step) { var d = FC.days[Math.min(j, FC.days.length - 1)]; pts.push({ k: cut + j, lo: d.p10, md: d.p50, hi: d.p90 }); if (o.alt) { var a = o.alt.days[Math.min(j, o.alt.days.length - 1)]; altp.push({ k: cut + j, lo: a.p10, md: a.p50, hi: a.p90 }); } }
    var hist = o.hist || [], k0 = hist.length ? hist[0].k : cut, k1 = cut + days, vals = [];
    hist.forEach(function (p) { vals.push(p.v); }); pts.concat(altp).forEach(function (p) { vals.push(p.lo, p.hi); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    if (lo > 0 && lo < (hi - lo) * 0.35) lo = 0;
    var X = function (k) { return pl + (k - k0) / (k1 - k0) * (W - pl - pr); }, Y = function (v) { return pt + (hi - v) / (hi - lo) * (H - pt - pb); };
    function path(arr, f) { return arr.map(function (p, i) { return (i ? "L" : "M") + X(p.k).toFixed(1) + " " + Y(f(p)).toFixed(1); }).join(""); }
    function band(arr) { return path(arr, function (p) { return p.hi; }) + arr.slice().reverse().map(function (p) { return "L" + X(p.k).toFixed(1) + " " + Y(p.lo).toFixed(1); }).join("") + "Z"; }
    var g = "", ticks = 4;
    for (var i = 0; i <= ticks; i++) { var v = lo + (hi - lo) * i / ticks, y = Y(v); g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(150,180,230,.1)"/><text x="' + (W - pr + 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#6c7a97" font-size="11">' + m(v) + "</text>"; }
    if (lo < 0 && hi > 0) g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#ff7d7d" stroke-dasharray="4 4" opacity=".7"/><text x="' + (pl + 4) + '" y="' + (Y(0) - 5) + '" fill="#ff7d7d" font-size="10.5">ZERO</text>';
    /* month labels */
    var d0 = E.fromKey(k0), lab = "", nlab = 0;
    for (var mo = 0; mo < 30; mo++) { var dd = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + mo, 1)), kk = E.dayKey(dd); if (kk < k0) continue; if (kk > k1) break; nlab++; }
    var every = Math.max(1, Math.ceil(nlab / 6));
    for (var mo2 = 0, c = 0; mo2 < 30; mo2++) { var dd2 = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + mo2, 1)), kk2 = E.dayKey(dd2); if (kk2 < k0) continue; if (kk2 > k1) break; if (c++ % every) continue; lab += '<text x="' + X(kk2).toFixed(1) + '" y="' + (H - 6) + '" fill="#6c7a97" font-size="11" text-anchor="middle">' + dd2.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (dd2.getUTCMonth() === 0 ? " ’" + String(dd2.getUTCFullYear()).slice(2) : "") + "</text>"; }
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="fg' + id + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c8ff4d" stop-opacity=".38"/><stop offset="1" stop-color="#c8ff4d" stop-opacity=".12"/></linearGradient><linearGradient id="ag' + id + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fb4ff" stop-opacity=".4"/><stop offset="1" stop-color="#7fb4ff" stop-opacity=".14"/></linearGradient></defs>' + g + lab;
    s += '<path d="' + band(pts) + '" fill="url(#fg' + id + ')"/>';
    if (altp.length) s += '<path d="' + band(altp) + '" fill="url(#ag' + id + ')"/><path d="' + path(altp, function (p) { return p.md; }) + '" fill="none" stroke="#7fb4ff" stroke-width="2.4"/>';
    if (hist.length) s += '<path d="' + hist.map(function (p, i) { return (i ? "L" : "M") + X(p.k).toFixed(1) + " " + Y(p.v).toFixed(1); }).join("") + '" fill="none" stroke="#eef2fb" stroke-width="2.2" stroke-linejoin="round"/>';
    s += '<path d="' + path(pts, function (p) { return p.md; }) + '" fill="none" stroke="#c8ff4d" stroke-width="2.4" stroke-dasharray="' + (altp.length ? "5 4" : "0") + '"/>';
    s += '<line x1="' + X(cut) + '" x2="' + X(cut) + '" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#7fb4ff" stroke-dasharray="2 3" opacity=".8"/><text x="' + (X(cut) + 5) + '" y="' + (pt + 10) + '" fill="#7fb4ff" font-size="10.5" letter-spacing="1">TODAY</text>';
    s += '<circle cx="' + X(cut) + '" cy="' + Y(FC.days[0].p50) + '" r="5" fill="#0a1836" stroke="#e9fbff" stroke-width="2"/>';
    if (o.low && FC.low13 && days >= 60) { var lk = E.dayKey(FC.low13.date); if (lk > cut && lk <= k1) s += '<circle cx="' + X(lk) + '" cy="' + Y(FC.low13.value) + '" r="4" fill="#ffc562"/><text x="' + X(lk) + '" y="' + (Y(FC.low13.value) + 17) + '" fill="#ffc562" font-size="10.5" text-anchor="middle">LOW</text>'; }
    s += '<line class="cur" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#eef2fb" opacity="0"/></svg>';
    ST.charts[id] = { X: X, k0: k0, k1: k1, W: W, pl: pl, pr: pr, hist: hist, pts: pts, alt: altp, cut: cut };
    return '<div class="chart" data-chart="' + id + '">' + s + '<div class="tip"></div></div>';
  }
  function chartW() { var w = window.innerWidth; return Math.round(Math.max(290, Math.min(w >= 900 ? Math.min(1180, w) * 0.57 - 40 : w - 62, 760))); }
  function wireCharts() {
    app.querySelectorAll("[data-chart]").forEach(function (el) {
      var C = ST.charts[el.getAttribute("data-chart")]; if (!C) return; var tip = el.querySelector(".tip"), cur = el.querySelector(".cur");
      function show(ev) {
        var r = el.getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, vx = x / r.width * C.W, k = C.k0 + (vx - C.pl) / (C.W - C.pl - C.pr) * (C.k1 - C.k0), html;
        if (k < C.k0 || k > C.k1) return hide();
        if (k <= C.cut && C.hist.length) { var h = C.hist.reduce(function (a, b) { return Math.abs(b.k - k) < Math.abs(a.k - k) ? b : a; }); html = "<b>" + sd(E.fromKey(h.k)) + "</b> actual " + m(h.v); k = h.k; }
        else { var p = C.pts.reduce(function (a, b) { return Math.abs(b.k - k) < Math.abs(a.k - k) ? b : a; }); k = p.k; html = "<b>" + sd(E.fromKey(p.k)) + "</b> likely <span class=cy>" + m(p.md) + "</span><br><span class=dim>" + m(p.lo) + " to " + m(p.hi) + "</span>"; if (C.alt.length) { var q = C.alt.reduce(function (a, b) { return Math.abs(b.k - k) < Math.abs(a.k - k) ? b : a; }); html += "<br>with decision <span class=gold>" + m(q.md) + "</span>"; } }
        var px = C.X(k) / C.W * r.width; tip.innerHTML = html; tip.style.display = "block"; tip.style.left = Math.max(70, Math.min(r.width - 70, px)) + "px"; tip.style.top = "-6px"; tip.style.transform = "translate(-50%,-100%)";
        cur.setAttribute("x1", C.X(k)); cur.setAttribute("x2", C.X(k)); cur.setAttribute("opacity", ".35");
      }
      function hide() { tip.style.display = "none"; cur.setAttribute("opacity", "0"); }
      el.addEventListener("pointermove", show); el.addEventListener("pointerdown", show); el.addEventListener("pointerleave", hide); el.addEventListener("touchmove", show, { passive: true });
    });
  }
  function histPts(weeks) { var M = ST.model, cut = ST.res.forecast.cut, out = [], first = M.tx[0].k; for (var w = weeks; w >= 0; w--) { var k = cut - w * 7; if (k >= first) out.push({ k: k, v: E.balanceAtKey(M, k) }); } return out; }

  /* ---------- shell ---------- */
  var TABS = [["home", "Pulse", "home"], ["forecast", "Forecast", "fc"], ["insights", "Insights", "ins"], ["decide", "Decide", "dec"], ["ask", "Ask", "ask"]];
  function syncNav(show) { nav.style.display = show ? "" : "none"; nav.innerHTML = '<div class="in">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (ST.tab === t[0] ? "on" : "") + '" aria-label="' + t[1] + '">' + ic(t[2]) + "<span>" + t[1] + "</span></button>"; }).join("") + "</div>"; }
  function head(sub) {
    var tp = WS === "account" && paid() ? licStatus() : null;
    var live = S.demo ? '<span class="badge">Demo</span>' : tp && tp.kind === "due" ? '<button class="pill due" data-act="portal">Payment due</button>' : tp && tp.kind === "trial" ? '<button class="pill" data-act="tplans">Trial · ' + tp.days + "d left</button>" : (S.conns && S.conns.length ? '<span class="live"><i></i>Live link</span>' : "");
    return '<div class="top"><button class="homebtn" data-act="home" aria-label="Home" title="Home">' + HEART + "</button>" + '<div style="min-width:0"><div class="nm">Liquara</div><div class="co">' + esc(sub || companyName()) + '</div></div><div class="sp"></div>' + live + '<button class="ib" data-act="theme" aria-label="Light or dark">' + (S.theme === "light" ? "☾" : "☀") + '</button><button class="ib" data-act="menu" aria-label="Menu">' + ic("menu") + "</button></div>";
  }
  /* ================= Website wow layer (html.web only; the Android app never runs this) ================= */
  var WEBFX = { tab: null, flow: false };
  function isWeb() { return document.documentElement.classList.contains("web"); }
  function calm() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function webFlow() {
    if (WEBFX.flow) return; WEBFX.flow = true;
    var host = document.querySelector(".bgfx"); if (!host) return;
    var cv = document.createElement("canvas"); cv.id = "webflow"; host.appendChild(cv);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(1.5, window.devicePixelRatio || 1), t = Math.random() * 50;
    function size() { W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function draw() {
      ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = "lighter";
      var light = S.theme === "light", lines = W < 700 ? 14 : 20;
      for (var r = 0; r < 2; r++) {
        var baseY = H * (r ? 0.86 : 0.18), amp = H * (0.06 + r * 0.03), ph = r * 2.1;
        for (var l = 0; l < lines; l++) {
          var k = l / (lines - 1), off = (k - 0.5) * (W < 700 ? 60 : 110);
          var a = Math.min(0.6, (0.04 + 0.22 * Math.pow(1 - Math.abs(k - 0.5) * 2, 2)) * (light ? 0.9 : 1) * (WEBFX.boost || 1));
          ctx.strokeStyle = light ? (r ? "rgba(11,138,99," + a + ")" : "rgba(110,150,0," + a + ")") : (r ? "rgba(46,230,176," + a * 0.85 + ")" : "rgba(200,255,77," + a + ")");
          ctx.lineWidth = l === Math.floor(lines / 2) ? 1.4 : 0.7; ctx.beginPath();
          for (var x = -40; x <= W + 40; x += 16) {
            var u = x / W, y = baseY + off * (0.4 + 0.6 * Math.sin(u * 2.6 + t * 0.3 + ph)) + Math.sin(u * 3.8 + t * 0.5 + ph + k * 0.8) * amp + Math.cos(u * 8 + t * 0.8 + l * 0.15) * 5;
            if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }
    function loop() { if (!document.hidden && WEBFX.live !== false) { t += 0.008; draw(); } requestAnimationFrame(loop); }
    size(); addEventListener("resize", function () { size(); draw(); });
    if (calm()) draw(); else loop();
    /* glow that follows the mouse across cards */
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var c = e.target.closest && e.target.closest(".tile, .panel, .kpi"); if (!c) return;
      var r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
    addEventListener("scroll", function () { document.documentElement.classList.toggle("scrolled", scrollY > 8); }, { passive: true });
  }
  function countUp(el) {
    var txt = el.textContent, mt = /^([^\d\-]*)(-?)([\d,]*\.?\d+)([KMB%]?)(.*)$/.exec(txt.trim()); if (!mt) return;
    var target = parseFloat(mt[3].replace(/,/g, "")); if (!isFinite(target) || target === 0) return;
    var dec = (mt[3].split(".")[1] || "").length, comma = mt[3].indexOf(",") >= 0, t0 = performance.now(), dur = 900 + Math.min(500, target % 7 * 60);
    function fmt(v) { var s = v.toFixed(dec); if (comma) s = Number(s).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }); return mt[1] + mt[2] + s + mt[4] + mt[5]; }
    (function step(now) { var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(target * e); if (p < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = txt; })(t0);
  }
  /* no holes: every grid row on the website is filled edge to edge */
  function fillGrids() {
    if (!isWeb()) return;
    app.querySelectorAll(".bento, .kpis, .g3w, .rstrip, .three, .plans, .dgrid, .lmeta, .lcalc").forEach(function (g) {
      var kids = Array.prototype.filter.call(g.children, function (c) { return c.offsetParent !== null || getComputedStyle(c).display !== "none"; }); if (kids.length < 2) return;
      kids.forEach(function (c) { if (c.dataset.fill) { c.style.gridColumn = ""; delete c.dataset.fill; } });
      if (!g.classList.contains("bento")) g.style.gridTemplateColumns = "";
      var cols = getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length; if (cols < 2) return;
      if (!g.classList.contains("bento")) {
        var n = kids.length; if (n <= cols) { g.style.gridTemplateColumns = "repeat(" + n + ", minmax(0, 1fr))"; return; }
        for (var k = cols; k >= 2; k--) if (n % k === 0) { g.style.gridTemplateColumns = "repeat(" + k + ", minmax(0, 1fr))"; return; }
      }
      /* measure the real layout and widen the last card of any row that stops short */
      var gs = getComputedStyle(g), gap = parseFloat(gs.columnGap) || 0;
      if (getComputedStyle(g).position === "static") g.style.position = "relative";
      for (var pass = 0; pass < 8; pass++) {
        var GW = g.clientWidth - (parseFloat(gs.paddingLeft) || 0) - (parseFloat(gs.paddingRight) || 0), colW = (GW - gap * (cols - 1)) / cols, rows = {}, changed = false, pl = parseFloat(gs.paddingLeft) || 0;
        kids.forEach(function (c) { if (!c.offsetWidth) return; (rows[c.offsetTop] = rows[c.offsetTop] || []).push(c); });
        Object.keys(rows).map(Number).sort(function (x, y) { return x - y; }).some(function (key) {
          var row = rows[key].sort(function (x, y) { return (x.offsetLeft + x.offsetWidth) - (y.offsetLeft + y.offsetWidth); }), last = row[row.length - 1], room = pl + GW - (last.offsetLeft + last.offsetWidth);
          if (room > colW * 0.5) { var sp = Math.round((last.offsetWidth + gap) / (colW + gap)), add = Math.round((room + 0.5) / (colW + gap)); last.style.gridColumn = "span " + Math.min(cols, sp + add); last.dataset.fill = "1"; changed = true; return true; }
          return false;
        });
        if (!changed) break;
      }
    });
  }
  /* two-column pages: long tables scroll inside their card so both columns end level */
  function balanceCols() {
    if (!isWeb()) return;
    app.querySelectorAll(".wide2").forEach(function (w) {
      var cols = Array.prototype.filter.call(w.children, function (c) { return c.offsetWidth; }); if (cols.length !== 2 || cols[0].offsetTop !== cols[1].offsetTop) { w.querySelectorAll(".tw").forEach(function (t) { t.style.maxHeight = ""; }); return; }
      w.querySelectorAll(".tw").forEach(function (t) { t.style.maxHeight = "none"; }); w.style.alignItems = "start"; cols.forEach(function (c) { c.style.display = "block"; });
      var nat = function (c) { return c.getBoundingClientRect().height; };
      var h0 = nat(cols[0]), h1 = nat(cols[1]), tall = h0 > h1 ? cols[0] : cols[1], diff = Math.abs(h0 - h1), tw = tall.querySelector(".tw");
      w.style.alignItems = ""; cols.forEach(function (c) { c.style.display = ""; });
      if (tw && diff > 40) tw.style.maxHeight = Math.max(260, tw.scrollHeight - diff) + "px";
    });
  }
  var fillT = 0; addEventListener("resize", function () { clearTimeout(fillT); fillT = setTimeout(function () { fillGrids(); balanceCols(); }, 150); });
  /* the phone app shows the same live ribbons as the website */
  function phoneFlow() {
    WEBFX.boost = ST.res ? 1 : 2;
    if (isWeb()) return;
    var on = !calm(); WEBFX.live = on; /* ribbons everywhere, like the website; brighter on welcome screens */
    if (on) webFlow();
    var cv = document.getElementById("webflow"); if (cv) cv.style.opacity = on ? "1" : "0";
  }
  function webFx() {
    phoneFlow();
    if (!isWeb()) return;
    webFlow(); fillGrids(); balanceCols();
    var key = (ST.res ? "app:" : "ob:") + ST.tab + ":" + (S.lens || "") + ":" + (ST.hz || "") + ":" + (ST.compSec || "") + ":" + (ST.ob || "") + ":" + !!S.demo; if (key === WEBFX.tab) return; WEBFX.tab = key;
    if (calm()) return;
    var cards = app.querySelectorAll(".tile, .panel, .kpi, .opt, .lcard, .cocard"), i = 0;
    cards.forEach(function (c) { if (i > 24) return; c.style.setProperty("--d", (i++ * 55) + "ms"); c.classList.remove("fxin"); void c.offsetWidth; c.classList.add("fxin"); });
    var nums = app.querySelectorAll(".big, .big2, .mid, .kpi .v, .ring .rv, .tile .num, .cbig span"); for (var n = 0; n < Math.min(14, nums.length); n++) countUp(nums[n]);
    app.querySelectorAll("[data-chart] path, .chart path").forEach(function (p) {
      var st = p.getAttribute("stroke"), fill = p.getAttribute("fill"); if (!st || st === "none" || (fill && fill !== "none") || (p.getAttribute("stroke-dasharray") || "0") !== "0") return;
      try { var L = p.getTotalLength(); if (!L || L < 40) return; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; p.getBoundingClientRect(); p.style.transition = "stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1) .25s"; p.style.strokeDashoffset = "0"; setTimeout(function () { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; p.style.transition = ""; }, 1800); } catch (e) { }
    });
  }
  function render() {
    ST.charts = {}; var ask = document.querySelector(".askbar"); if (ask) ask.remove();
    applyTheme();
    if (accS().pin && !unlocked) { syncNav(false); app.innerHTML = viewLock(); applyLang(); setTimeout(function () { var p = document.getElementById("pinin"); if (p) p.focus(); }, 50); return; }
    if (ST.launch) { syncNav(false); app.innerHTML = viewLaunch(); applyLang(); launchFlow(); return; }
    if (ST.ob === "signin" && !(WS === "account" && paid())) { syncNav(false); app.innerHTML = viewOnboard(); applyLang(); webFx(); return; }
    if (ST.planOnly && !paid()) { syncNav(false); app.innerHTML = '<div class="obtop"><a class="homebtn" href="./" aria-label="Back to the website" title="Back to the website">' + HEART + '</a><b>Liquara</b><button class="btn ghost sm" style="margin-inline-start:auto" data-act="plandemo">Try the demo first</button></div><div class="planpage">' + viewPlans().replace(head(), "") + "</div>"; applyLang(); webFx(); return; }
    /* signed-in customer who hasn't added numbers yet: a real, fully navigable account at $0 */
    if (!ST.res && WS === "account" && paid() && setupDone()) {
      var free = { settings: viewSettings, plans: viewPlans, data: viewData, about: viewAbout, news: viewNews, compete: viewCompete };
      syncNav(true); app.innerHTML = free[ST.tab] ? free[ST.tab]() : ST.tab === "home" ? viewStarter() : viewNeedData(); applyLang(); webFx(); return;
    }
    if (!ST.res) { syncNav(false); app.innerHTML = ST.model && !ST.model.tx.length ? viewNoBank() : viewOnboard(); applyLang(); webFx(); return; }
    if (locked() && ["plans", "settings", "about"].indexOf(ST.tab) < 0) ST.tab = "plans";
    if (tierNeeded() && ["plans", "settings", "about", "data"].indexOf(ST.tab) < 0) ST.tab = "fit";
    syncNav(true);
    var v = { home: viewPulse, alerts: viewAlerts, budget: viewBudget, actions: viewActions, goals: viewGoals, plans: viewPlans, savings: viewSavings, news: viewNews, compete: viewCompete, loans: viewLoans, fit: viewFit, forecast: viewForecast, insights: viewInsights, decide: viewDecide, ask: viewAsk, data: viewData, settings: viewSettings, about: viewAbout }[ST.tab] || viewHome;
    app.innerHTML = v(); wireCharts();
    if (ST.tab === "ask") mountAsk();
    if (ST.tab === "decide") runDecision(true);
    applyLang(); webFx();
  }
  function go(tab) { ST.tab = tab; if (!ST.popping) { try { history.pushState({ tab: tab, planOnly: !!ST.planOnly }, ""); } catch (e) { } } render(); window.scrollTo(0, 0); }

  /* ---------- welcome and connection ---------- */
  function viewWelcome() {
    return '<div class="hero"><img class="seal" src="logo.svg" alt="Liquara seal"><h1>Liquara</h1><p class="gold" style="font-family:var(--serif);font-size:17px;margin-top:4px">Cash intelligence connected to the heart of your business</p><p>Connect your bank, books or any system. Liquara finds the money data on its own, learns how cash really moves, forecasts it with odds, grades itself against your past, and answers the questions a board asks.</p></div>' +
      '<div style="max-width:560px;margin:18px auto 0"><div class="eyebrow">Get started</div>' +
      '<button class="opt" data-act="pick">' + '<div class="ic">' + ic("up") + '</div><div><b>Upload files from your systems</b><span>Bank statements, invoices, bills, sales reports. CSV, Excel, JSON or bank OFX. Any layout.</span></div></button>' +
      '<button class="opt" data-act="api">' + '<div class="ic">' + ic("link") + '</div><div><b>Connect a live system</b><span>Stripe, Square or any system with a JSON API. Refreshes every time you open Liquara.</span></div></button>' +
      '<div class="eyebrow" style="margin-top:20px">Or see it work first</div>' +
      DEMO.list.map(function (d) { return '<button class="opt" data-act="demo" data-id="' + d[0] + '"><div class="ic">' + ic("demo") + '</div><div><b>' + esc(d[1]) + '</b><span>' + esc(DEMO.get(d[0]).about) + "</span></div></button>"; }).join("") +
      '<p class="note">Everything is worked out on this device. Your data is never sent to us. Live connections go straight from your phone to your own system.</p></div><div class="foot">AORTA ' + VERSION + "</div>";
  }
  function viewNoBank() {
    return head() + '<div class="panel gold"><div class="eyebrow">One more file</div><h2>Add a bank statement</h2><p class="mute">Liquara found ' + ST.items.map(function (x) { return esc(x.name) + " (" + kindName(x.inferred.kind) + ")"; }).join(", ") + '. To forecast cash it needs at least one bank account history (a CSV, Excel or OFX export from online banking, ideally 12 months or more).</p><button class="btn pri full" data-act="pick">' + ic("up") + " Add files</button></div>";
  }
  function kindName(k) { return { bank: "bank transactions", ar: "customer invoices", ap: "supplier bills", sales: "sales by product" }[k] || k; }
  async function scanAndShow(label) {
    syncNav(false); ST.busy = true;
    app.innerHTML = '<div class="hero" style="padding-top:8px"><img class="seal" src="logo.svg" alt="" style="width:120px"></div><div class="panel gold scan" style="max-width:620px;margin:0 auto"><div class="eyebrow">' + esc(label || "Connecting") + '</div><h2>Finding your money data</h2><div class="cord"></div><div id="steps"></div></div>';
    var box = document.getElementById("steps");
    function step(t, sub) { var d = document.createElement("div"); d.className = "step"; d.innerHTML = '<div class="dot"></div><div class="grow"><div>' + t + '</div><div class="map">' + (sub || "") + "</div></div>"; box.appendChild(d); requestAnimationFrame(function () { d.classList.add("in"); }); return d; }
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var srcs = S.demo ? await demoSources(S.demo) : ST.sources;
    for (var i = 0; i < srcs.length; i++) {
      var st = step("Reading <b>" + esc(srcs[i].name) + "</b>"); await wait(260);
      try { var tbs = await tablesOf(srcs[i]); tbs.forEach(function (x) { var inf = E.infer(x.table, x.name); st.querySelector(".map").innerHTML = "Found " + kindName(inf.kind) + ", " + x.table.rows.length.toLocaleString() + " rows, " + pc(inf.confidence) + " sure. " + Object.keys(inf.map).map(function (r) { return "<code>" + esc(inf.map[r]) + "</code> = " + r; }).join(" "); }); } catch (e) { st.querySelector(".map").textContent = "Couldn't read: " + e.message; }
      st.classList.add("done"); await wait(200);
    }
    var s2 = step("Learning recurring payments, payroll and how late each customer pays"); await wait(80);
    await analyze(); s2.classList.add("done");
    if (ST.res) {
      var F = ST.res.fit, B = ST.model.bt;
      s2.querySelector(".map").textContent = F.rec.length + " recurring payments, " + Object.keys(F.arD.by).length + " customer payment patterns, " + Object.keys(F.apD.by).length + " supplier patterns.";
      var s3 = step("Grading itself: forecasting the past and checking against what really happened"); await wait(350);
      s3.querySelector(".map").textContent = B ? "Balance forecasts were " + pc(B.accuracy) + " accurate over " + B.origins + " tests. Using the method that did best on your data." : "Not enough history to test yet (needs about 8 months).";
      s3.classList.add("done");
      var s4 = step("Running " + ST.res.forecast.sims + " possible futures for the next 12 months"); await wait(350); s4.classList.add("done");
      await wait(500);
    }
    ST.busy = false; ST.tab = "home"; render();
  }

  /* ---------- overview ---------- */
  function viewHome() {
    var A = ST.res.analysis, FC = ST.res.forecast, B = ST.model.bt, d13 = FC.days[91], ch = d13.p50 - FC.start;
    var h = head();
    if (ST.model.warnings.length) h += '<div class="panel" style="border-color:rgba(255,197,98,.4)"><b class="warn">Check this</b><div class="small mute">' + ST.model.warnings.map(esc).join("<br>") + '</div><button class="btn ghost" style="margin-top:8px" data-go="settings">Set cash balance</button></div>';
    h += '<div class="wide2"><div><div class="panel gold"><div class="eyebrow">Cash position · ' + fd(A.asOf) + '</div><div class="between"><div><div class="big">' + m(FC.start) + '</div><div class="small mute">in the bank today</div></div><div style="text-align:right"><div class="mid cy">' + m(d13.p50) + '</div><div class="small mute">likely in 13 weeks <span class="' + (ch >= 0 ? "pos" : "neg") + '">' + (ch >= 0 ? "+" : "") + m(ch) + "</span></div></div></div>" +
      fan("home", { hist: histPts(13), fc: FC, days: 91, h: 210, low: true }) +
      '<div class="legend"><span><i style="background:#eef2fb"></i>Actual</span><span><i style="background:#c8ff4d"></i>Most likely</span><span><i style="background:rgba(127,224,255,.35);height:8px"></i>8 in 10 futures</span></div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap">' + (B ? '<span class="badge cy" data-go="forecast">Tested ' + pc(B.accuracy) + " accurate on your history</span>" : '<span class="badge a">Needs more history to self-test</span>') + '<span class="badge">' + FC.sims + " futures simulated</span></div></div>";
    var shortTxt = FC.pShort13 < 0.01 ? "Under 1%" : pc(FC.pShort13);
    h += '<div class="kpis" style="margin-bottom:12px">' +
      kpi(A.netMonth < 0 ? "Runway" : "Cushion", A.netMonth < 0 && A.runway ? A.runway.toFixed(1) + " mo" : Math.round(A.cushionDays || 0) + " days", A.netMonth < 0 ? "at current burn" : "of spending in bank") +
      kpi("Low point", m(FC.low13.value), sd(FC.low13.date) + ", next 13 wks") +
      kpi("Shortfall odds", shortTxt, "below zero in 13 wks", FC.pShort13 > 0.1 ? "neg" : "pos") +
      kpi("Paid in", A.dso ? Math.round(A.dso) + " days" : "n/a", "average customer") +
      kpi("Growth", A.growth != null ? (A.growth >= 0 ? "+" : "") + pc(A.growth) : "n/a", "cash in vs last year", A.growth >= 0 ? "pos" : "neg") +
      kpi("Gross margin", A.gm != null ? pc(A.gm) : "add sales", "after direct costs") + "</div></div><div>";
    h += '<div class="panel"><div class="eyebrow">Biggest opportunities</div><div class="list">' + (A.opportunities.slice(0, 3).map(oppLi).join("") || '<div class="mute small">Add invoices, bills and sales by product to find more.</div>') + '</div><button class="btn ghost full" style="margin-top:8px" data-ins="growth">See all</button></div>';
    h += '<div class="panel"><div class="eyebrow">Risks</div>' + (A.risks.length ? '<div class="list">' + A.risks.slice(0, 3).map(riskLi).join("") + "</div>" : '<div class="row"><span class="badge g">Clear</span><span class="small mute">No cash, customer or collection risks flagged.</span></div>') + "</div>";
    h += '<div class="panel"><div class="eyebrow">Ask the board question</div><div class="chips">' + Q.suggestions.slice(0, 6).map(function (q) { return '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div></div></div></div>";
    return h + foot();
  }
  function kpi(l, v, s, cls) { return '<div class="kpi"><div class="l">' + l + '</div><div class="v ' + (cls || "") + '">' + v + '</div><div class="s">' + s + "</div></div>"; }
  function oppLi(o) { var k = { cash: "$", margin: "%", growth: "↗", cost: "✂" }[o.kind] || "•"; return '<div class="li"><div class="ic">' + k + '</div><div class="grow"><div class="t">' + esc(o.title) + '</div><div class="d">' + esc(o.detail) + '</div><div class="d" style="color:var(--ink);margin-top:4px">' + esc(o.action) + '</div></div><div class="amt gold">' + m(o.value) + '<div class="tiny dim">' + (o.kind === "cash" ? "freed" : "a year") + "</div></div></div>"; }
  function riskLi(r) { return '<div class="li"><div class="ic" style="background:' + (r.level === "high" ? "rgba(255,125,125,.14);color:var(--red)" : "rgba(255,197,98,.14);color:var(--amber)") + '">!</div><div class="grow"><div class="t">' + esc(r.title) + '</div><div class="d">' + esc(r.detail) + "</div></div></div>"; }
  function foot() { return '<div class="foot">LIQUARA · ' + (S.ccy || "USD") + " · " + (S.demo ? "FICTIONAL DEMO DATA" : "COMPUTED ON THIS DEVICE") + " · " + (ST.res && ST.res.analysis ? fd(ST.res.analysis.asOf) : fd(new Date())).toUpperCase() + "</div>"; }


  /* ---------- clean address: show getliquara.com instead of /app while using the app ---------- */
  (function () {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;
      if (!/\/app(\.html)?$/.test(location.pathname)) return;
      sessionStorage.setItem("lq_inapp", "1");
      history.replaceState(history.state, "", location.pathname.replace(/app(\.html)?$/, "") + location.search + location.hash);
    } catch (e) { }
  })();
  /* ---------- languages ---------- */
  var I18N = window.LQ_I18N || { langs: [["en", "English", "en-US"]], dict: {} };
  function lang() { if (!S.lang) { var nl = (navigator.language || "en").slice(0, 2).toLowerCase(); if (nl === "fi") nl = "tl"; S.lang = I18N.langs.some(function (l) { return l[0] === nl; }) ? nl : "en"; } return S.lang; }
  function langLoc() { var L = lang(); return (I18N.langs.filter(function (l) { return l[0] === L; })[0] || [0, 0, "en-US"])[2]; }
  function T(s) { var d = I18N.dict[lang()]; return (d && d[s]) || trCache()[s] || s; }
  var TRC = {};
  function trCache() { var L = lang(); if (!TRC[L]) { try { TRC[L] = JSON.parse(localStorage.getItem("lq_tr_" + L) || "{}"); } catch (e) { TRC[L] = {}; } } return TRC[L]; }
  var trQueue = {}, trTimer = null, trBusy = false, trDone = {};
  function helperUrl() { return CFG.worker || ""; }
  function wantAI() { return S.aiTranslate !== false && helperUrl(); }
  function trText(t) {
    var core = t.trim(); if (!core || !/[A-Za-z]{2}/.test(core)) return null;
    var d = I18N.dict[lang()] || {}, v = d[core] || trCache()[core];
    if (v) return t.replace(core, v);
    if (wantAI() && !trDone[core] && core.length < 600) { trQueue[core] = 1; clearTimeout(trTimer); trTimer = setTimeout(flushTr, 500); }
    return null;
  }
  var trObs = null, origText = new WeakMap();
  function applyLang(root) {
    var L = lang(); document.documentElement.lang = L; document.documentElement.dir = L === "ar" ? "rtl" : "ltr";
    if (L === "en") return;
    if (trObs) trObs.disconnect();
    var w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT), n, todo = [];
    while ((n = w.nextNode())) { var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) || p.closest("[data-notr],svg")) continue; if (origText.has(n) && origText.get(n).out === n.nodeValue) continue; todo.push(n); }
    todo.forEach(function (n) { var r = trText(n.nodeValue); if (r != null && r !== n.nodeValue) { n.nodeValue = r; origText.set(n, { out: r }); } });
    (root || document.body).querySelectorAll("[placeholder],[aria-label]").forEach(function (el) { ["placeholder", "aria-label"].forEach(function (at) { var v = el.getAttribute(at); if (v && !el["__tr" + at]) { var r = trText(v); if (r) { el.setAttribute(at, r); el["__tr" + at] = 1; } } }); });
    watchLang();
  }
  function watchLang() {
    if (lang() === "en") return;
    if (!trObs) trObs = new MutationObserver(function () { cancelAnimationFrame(watchLang.f); watchLang.f = requestAnimationFrame(function () { applyLang(); }); });
    trObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  async function flushTr() {
    if (trBusy) { trTimer = setTimeout(flushTr, 800); return; }
    var list = Object.keys(trQueue).slice(0, 80); if (!list.length) return;
    list.forEach(function (k) { delete trQueue[k]; trDone[k] = 1; });
    trBusy = true;
    try {
      var j = await helper("/translate", { lang: lang(), strings: list }), c = trCache(); (j.out || []).forEach(function (v, i) { if (v && list[i]) c[list[i]] = v; }); try { localStorage.setItem("lq_tr_" + lang(), JSON.stringify(c)); } catch (e) { } applyLang();
      if (r.ok) { var j = await r.json(), c = trCache(); (j.out || []).forEach(function (v, i) { if (v && list[i]) c[list[i]] = v; }); try { localStorage.setItem("lq_tr_" + lang(), JSON.stringify(c)); } catch (e) { } applyLang(); }
    } catch (e) { } finally { trBusy = false; if (Object.keys(trQueue).length) trTimer = setTimeout(flushTr, 300); }
  }
  function setLang(L) { S.lang = L; saveS(); E.setLocale(langLoc()); try { E.setCurrency(S.ccy || "USD", langLoc()); } catch (e) { } if (L === "en") location.reload(); else render(); }
  function langSelect(id) { return '<select class="in" id="' + id + '" data-notr>' + I18N.langs.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang() ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select>"; }


  /* ---------- Android app home: a launcher, not a web page ---------- */
  function isNative() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
  function viewLaunch() {
    var hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    var lic = paid(), plan = lic && (acc().license || {}).plan ? PLANS[acc().license.plan] : null;
    var h = '<div class="launch"><div class="lhead">' + HEART + '<b>Liquara</b><span class="lchip ' + (lic ? "on" : "") + '">' + (lic ? (plan ? plan.name : "Active") : "Free preview") + '</span></div>';
    h += '<div class="lhero"><canvas id="lflow" aria-hidden="true"></canvas><div class="lhin"><div class="lgreet">' + greet + '</div><h1>Know where your cash is going.</h1></div></div>';
    if (ST.res) {
      var FC = ST.res.forecast, A = ST.res.analysis, low = Infinity; for (var i = 0; i <= 91 && i < FC.days.length; i++) low = Math.min(low, FC.days[i].p50);
      var nm = S.demo ? DEMO.get(S.demo).name : (S.biz || "Your business");
      h += '<button class="lsnap" data-act="lgo" data-to="pulse"><div class="lsrow"><span class="lslab">' + esc(nm) + (S.demo ? ' · sample' : "") + '</span><span class="lsgo">Open →</span></div><div class="lsnums"><div><b>' + m(FC.start) + '</b><span>Cash now</span></div><div><b class="lime">' + Math.round(A.cushionDays || 0) + '</b><span>Days of cash</span></div><div><b>' + m(low) + '</b><span>Low point · 13 wks</span></div></div></button>';
    }
    var cards = [["Owner", "Are we OK?", "One glance. Plain words.", "M4 12l5 5L20 6"], ["CFO", "The full picture", "Last 13 and next 13 weeks.", "M4 18V9M10 18V5M16 18v-7M22 18H2"], ["Board", "Ready when they ask", "A one-page brief and PDF.", "M4 5h16v11H4zM9 20h6M12 16v4"]];
    h += '<div class="lsec">Three views</div><div class="lcards">' + cards.map(function (c) { return '<button class="lcard" data-act="lgo" data-to="lens" data-l="' + c[0] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + c[3] + '"/></svg><span class="ltag">' + c[0] + "</span><b>" + c[1] + "</b><span>" + c[2] + "</span></button>"; }).join("") + "</div>";
    h += '<div class="lsec">Your market</div><div class="lcards two"><button class="lcard" data-act="lgo" data-to="news"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5"/></svg><span class="ltag">News</span><b>What it means for you</b><span>Act now, plan ahead, on the radar.</span></button><button class="lcard" data-act="lgo" data-to="compete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 3M7 6H4a3 3 0 0 0 3 3"/></svg><span class="ltag">Rivals</span><b>Climb your ranking</b><span>Step by step, big leaps, buying.</span></button></div>';
    h += '<div class="lacts">';
    if (lic) h += '<button class="btn pri big full" data-act="lgo" data-to="pulse">Open my dashboard</button>' + (S.demo ? '<button class="btn full" data-act="lgo" data-to="data">Add my own data</button>' : "");
    else h += '<button class="btn pri big full" data-act="lgo" data-to="plans">Start 14-day free trial</button><button class="btn full" data-act="lgo" data-to="sample">Explore a sample company</button><button class="btn ghost full" data-act="lgo" data-to="key">I have a license key</button>';
    h += '</div><div class="lfoot">getliquara.com · support@getliquara.com</div></div>';
    return h;
  }
  var lflowRun = 0;
  function launchFlow() {
    var c = document.getElementById("lflow"); if (!c || !c.getContext) return;
    var ctx = c.getContext("2d"), run = ++lflowRun, dpr = Math.min(2, window.devicePixelRatio || 1), t = Math.random() * 50, W, H;
    function size() { var r = c.getBoundingClientRect(); W = r.width; H = r.height; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function draw() {
      ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = "lighter";
      for (var r = 0; r < 2; r++) for (var l = 0; l < 18; l++) {
        var k = l / 17, a = (0.06 + 0.4 * Math.pow(1 - Math.abs(k - 0.5) * 2, 2)) * (r ? 0.7 : 1);
        ctx.strokeStyle = r ? "rgba(46,230,176," + a + ")" : "rgba(200,255,77," + a + ")"; ctx.lineWidth = l === 9 ? 1.6 : 0.8; ctx.beginPath();
        for (var x = -20; x <= W + 20; x += 10) { var u = x / W, y = H * (0.62 + r * 0.08) + (k - 0.5) * 60 * (0.5 + 0.5 * Math.sin(u * 3 + t * 0.4 + r)) + Math.sin(u * 4 + t * 0.6 + r * 1.7 + k) * H * 0.14; if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    function loop() { if (run !== lflowRun || !document.body.contains(c)) return; t += 0.014; draw(); requestAnimationFrame(loop); }
    size(); if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) draw(); else loop();
  }

  /* ---------- forecast ---------- */
  function hzSeg() { return '<div class="seg" style="margin-bottom:12px">' + [["p13", T("Last 13 weeks")], ["13w", T("Next 13 weeks")], ["12m", T("Next 12 months")]].map(function (o) { return '<button data-hz="' + o[0] + '" class="' + ((ST.hz || "13w") === o[0] ? "on" : "") + '">' + o[1] + "</button>"; }).join("") + "</div>"; }
  function viewPast() {
    var pw = E.pastWeeks(ST.model, 13), h = head() + hzSeg();
    if (!pw.length || !ST.model.tx.length) return h + '<div class="panel"><p class="mute small">' + T("Add bank history to see the last 13 weeks.") + "</p></div>" + foot();
    var ti = 0, to = 0, mx = 1; pw.forEach(function (w) { ti += w.in; to += w.out; mx = Math.max(mx, w.in, w.out); });
    var best = pw.slice().sort(function (a, b) { return (b.in - b.out) - (a.in - a.out); })[0], worst = pw.slice().sort(function (a, b) { return (a.in - a.out) - (b.in - b.out); })[0];
    var chg = pw[pw.length - 1].close - pw[0].open;
    var bars = pw.map(function (w) { return '<div class="wb" title="' + sd(E.fromKey(w.k)) + ": in " + m(w.in) + ", out " + m(w.out) + '"><i class="bi" style="height:' + (w.in / mx * 90).toFixed(0) + 'px"></i><i class="bo" style="height:' + (w.out / mx * 90).toFixed(0) + 'px"></i></div>'; }).join("");
    h += '<div class="wide2"><div><div class="panel gold"><div class="eyebrow">' + T("Last 13 weeks · what actually happened") + '</div><div class="between"><div><div class="mid ' + (chg >= 0 ? "pos" : "neg") + '">' + (chg >= 0 ? "+" : "") + m(chg) + '</div><div class="small mute">' + T("change in cash") + " · " + m(pw[0].open) + " → " + m(pw[pw.length - 1].close) + '</div></div><div style="text-align:right" class="small"><span class="pos">' + T("In") + " " + m(ti) + '</span><br><span class="neg">' + T("Out") + " " + m(to) + '</span></div></div><div class="wbars" style="height:100px;margin-top:12px">' + bars + '</div><div class="between tiny mute"><span>' + sd(E.fromKey(pw[0].k)) + "</span><span>" + sd(E.fromKey(pw[12].k)) + '</span></div><div class="kpis" style="margin-top:12px">' + kpi(T("Best week"), m(best.in - best.out), sd(E.fromKey(best.k)), "pos") + kpi(T("Hardest week"), m(worst.in - worst.out), sd(E.fromKey(worst.k)), worst.in - worst.out < 0 ? "neg" : "") + "</div></div></div><div>";
    h += '<div class="panel"><div class="eyebrow">' + T("Week by week") + '</div><div class="tw"><table class="t"><tr><th>' + T("Week ending") + "</th><th>" + T("In") + "</th><th>" + T("Out") + "</th><th>" + T("Net") + "</th><th>" + T("Ending cash") + "</th></tr>" + pw.slice().reverse().map(function (w) { var n = w.in - w.out; return "<tr><td>" + sd(E.fromKey(w.k)) + '</td><td class="pos">' + m(w.in) + '</td><td class="dim">' + m(w.out) + '</td><td class="' + (n >= 0 ? "pos" : "neg") + '">' + (n >= 0 ? "+" : "") + m(n) + "</td><td><b>" + m(w.close) + "</b></td></tr>"; }).join("") + '</table></div><p class="note">' + T("From your bank data. Put this next to Next 13 weeks to show a lender or board where you've been and where you're going.") + "</p></div></div></div>";
    return h + foot();
  }
  function viewForecast() {
    if (ST.hz === "p13") return viewPast();
    var FC = ST.res.forecast, B = ST.model.bt, y = ST.hz === "12m", days = y ? 365 : 91, end = FC.days[days], h = head();
    h += hzSeg();
    h += '<div class="wide2"><div><div class="panel gold"><div class="eyebrow">' + (y ? "12-month outlook" : "13-week cash forecast") + '</div><div class="between"><div><div class="mid cy">' + m(end.p50) + '</div><div class="small mute">most likely on ' + fd(E.fromKey(FC.cut + days)) + '</div></div><div style="text-align:right"><div class="small">' + m(end.p10) + " to " + m(end.p90) + '</div><div class="tiny dim">8 in 10 futures</div></div></div>' + fan("fc", { hist: histPts(y ? 52 : 13), fc: FC, days: days, h: 260, low: true }) + '<div class="legend"><span><i style="background:#eef2fb"></i>Actual</span><span><i style="background:#c8ff4d"></i>Most likely</span><span><i style="background:rgba(127,224,255,.35);height:8px"></i>Likely range</span><span><i style="background:#ffc562;width:8px;height:8px;border-radius:50%"></i>Low point</span></div><p class="small mute" style="margin:10px 0 0">Touch the chart to read any day. Chance cash goes below zero: <b class="' + (FC.pShort13 > 0.1 ? "neg" : "") + '">' + pc(FC.pShort13) + "</b> in 13 weeks, <b>" + pc(FC.pShortYear) + "</b> in 12 months.</p></div>";
    var rows = y ? FC.months : FC.weeks;
    h += '<div class="panel"><div class="eyebrow">' + (y ? "Month by month" : "Week by week") + '</div><div class="tw"><table class="t"><tr><th>' + (y ? "Month end" : "Week ending") + "</th><th>Low</th><th>Likely</th><th>High</th></tr>" + rows.map(function (r) { return "<tr><td>" + sd(E.fromKey(r.k)) + '</td><td class="dim">' + m(r.p10) + '</td><td><b>' + m(r.p50) + '</b></td><td class="dim">' + m(r.p90) + "</td></tr>"; }).join("") + "</table></div></div></div><div>";
    var rec = ST.res.fit.rec.slice().sort(function (a, b) { return Math.abs(b.amount) * 30 / b.period - Math.abs(a.amount) * 30 / a.period; }).slice(0, 12);
    h += '<div class="panel"><div class="eyebrow">What moves your cash</div><p class="small mute" style="margin:0 0 6px">Found on its own: payments that repeat on a schedule. Customer invoices and supplier bills are forecast one by one using how late each one usually pays.</p><div class="list">' + rec.map(function (r) { var nx = nextOf(r); return '<div class="li"><div class="grow"><div class="t">' + esc(tidy(r.party)) + '</div><div class="d">' + esc(r.cat) + " · " + r.label + (nx ? " · next " + sd(nx) : "") + '</div></div><div class="amt ' + (r.dir === "+" ? "pos" : "") + '">' + (r.dir === "+" ? "+" : "") + m(r.amount) + "</div></div>"; }).join("") + "</div></div>";
    h += accuracyPanel(B) + "</div></div>";
    return h + foot();
  }
  function tidy(p) { return String(p).replace(/\s+(Payment|Card settlement batch|Bill)\b.*$/i, "").replace(/\s+/g, " ").replace(/\b(\w+)\s+\1\b/gi, "$1").trim(); }
  function nextOf(r) { var c = ST.res.forecast.cut, k = r.last; while (k <= c) k += r.period; return E.fromKey(Math.round(k)); }
  function accuracyPanel(B) {
    if (!B) return '<div class="panel"><div class="eyebrow">Self-test</div><p class="mute small">With at least 8 months of bank history, Liquara hides the latest months, forecasts them from older data, and shows you how close it got before you rely on it.</p></div>';
    var rows = B.recent, W = chartW(), H = 180, pl = 6, pr = 58, pt = 10, pb = 22, vals = []; rows.forEach(function (r) { vals.push(r.actBal, r.lo, r.hi); }); var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * .1 || 1; lo -= pad; hi += pad;
    var X = function (i) { return pl + i / (rows.length - 1 || 1) * (W - pl - pr); }, Y = function (v) { return pt + (hi - v) / (hi - lo) * (H - pt - pb); };
    var band = rows.map(function (r, i) { return (i ? "L" : "M") + X(i) + " " + Y(r.hi); }).join("") + rows.slice().reverse().map(function (r, i) { return "L" + X(rows.length - 1 - i) + " " + Y(r.lo); }).join("") + "Z";
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet"><path d="' + band + '" fill="rgba(127,224,255,.16)"/><path d="' + rows.map(function (r, i) { return (i ? "L" : "M") + X(i) + " " + Y(r.predBal); }).join("") + '" fill="none" stroke="#c8ff4d" stroke-width="2.2" stroke-dasharray="5 4"/><path d="' + rows.map(function (r, i) { return (i ? "L" : "M") + X(i) + " " + Y(r.actBal); }).join("") + '" fill="none" stroke="#eef2fb" stroke-width="2.2"/>' + rows.map(function (r, i) { return '<circle cx="' + X(i) + '" cy="' + Y(r.actBal) + '" r="3" fill="' + (r.actBal >= r.lo && r.actBal <= r.hi ? "#5fd39a" : "#ff7d7d") + '"/>'; }).join("") + '<text x="' + (W - pr + 8) + '" y="' + (Y(hi) + 14) + '" fill="#6c7a97" font-size="11">' + m(hi) + '</text><text x="' + (W - pr + 8) + '" y="' + Y(lo) + '" fill="#6c7a97" font-size="11">' + m(lo) + '</text><text x="' + pl + '" y="' + (H - 4) + '" fill="#6c7a97" font-size="11">Week 1</text><text x="' + (W - pr) + '" y="' + (H - 4) + '" fill="#6c7a97" font-size="11" text-anchor="end">Week 13</text></svg>';
    var names = { seasonal: "seasonal", trend: "trend", recent: "recent average" };
    return '<div class="panel gold"><div class="eyebrow">Self-test · how it did on your past</div><div class="verdict"><div class="ring" style="border:3px solid var(--cyan);color:var(--cyan)">' + pc(B.accuracy) + '</div><div class="small">Liquara hid your most recent months, forecast them from older data <b>' + B.origins + " times</b>, and compared with what really happened. Balance accuracy " + pc(B.accuracy) + ", actual balance inside the likely range " + pc(B.bandHit) + " of the time.</div></div>" +
      '<div class="chart" style="margin-top:12px">' + svg + '</div><div class="legend"><span><i style="background:#eef2fb"></i>What happened</span><span><i style="background:#c8ff4d"></i>What it predicted ' + sd(E.fromKey(B.cut)) + '</span><span><i style="background:#5fd39a;width:8px;height:8px;border-radius:50%"></i>Inside range</span></div>' +
      '<div class="kpis" style="margin-top:12px">' + kpi("Money in", B.inflowAcc != null ? pc(B.inflowAcc) : "n/a", "weekly accuracy") + kpi("Money out", B.outflowAcc != null ? pc(B.outflowAcc) : "n/a", "weekly accuracy") + "</div>" +
      '<div class="tw" style="margin-top:10px"><table class="t"><tr><th>Method tried</th><th>Accuracy</th></tr>' + B.compared.map(function (c) { var on = c.methods[0] === B.methods[0] && c.methods[1] === B.methods[1]; return "<tr><td>" + (on ? '<b class="gold">' : "") + "In: " + names[c.methods[0]] + ", out: " + names[c.methods[1]] + (on ? " (in use)</b>" : "") + "</td><td>" + pc(c.accuracy) + "</td></tr>"; }).join("") + '</table></div><p class="note">Accuracy = 1 minus the average error as a share of the balance, 1 to 13 weeks ahead. Weekly money in and out are lumpier, so their accuracy is lower. The range is widened using its own past misses, so it isn\'t over-confident.</p></div>';
  }

  /* ---------- insights ---------- */
  var INS = [["margins", "Margins"], ["customers", "Customers"], ["spending", "Spending"], ["collections", "Collections"], ["growth", "Growth"], ["risks", "Risks"]];
  function viewInsights() {
    var A = ST.res.analysis, h = head() + '<div class="seg" style="margin-bottom:12px">' + INS.map(function (t) { return '<button data-ins="' + t[0] + '" class="' + (ST.ins === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var t = ST.ins;
    if (t === "margins") {
      if (!A.products.length) h += '<div class="panel"><h3>Add sales by product</h3><p class="mute small">Upload a sales report with product or service, revenue and cost (most point-of-sale and accounting systems export one). Liquara will judge every line: grow it, keep it, reprice it or cut it.</p><button class="btn pri" data-act="pick">' + ic("up") + " Add file</button></div>";
      else {
        h += '<div class="panel gold"><div class="eyebrow">Which lines are worth it</div><div class="between"><div><div class="mid">' + pc(A.gm) + '</div><div class="small mute">overall margin after direct costs</div></div><div class="small mute" style="text-align:right">Ranked by profit,<br>not by sales</div></div></div><div class="grid g3w" style="display:grid;gap:12px">';
        A.products.forEach(function (p) { var b = { "Grow": "g", "Keep": "cy", "Reprice": "a", "Fix or cut": "r", "Add costs": "" }[p.verdict]; h += '<div class="panel" style="margin:0"><div class="between"><h3>' + esc(p.name) + '</h3><span class="badge ' + b + '">' + p.verdict + '</span></div><div class="kpis" style="margin-top:10px">' + kpi("Margin", pc(p.margin), m(p.gp) + " profit") + kpi("Share", pc(p.share), "of sales · " + pc(p.gpShare) + " of profit") + '</div><div class="bar ' + (p.margin < .2 ? "" : "cy") + '"><i style="width:' + Math.max(2, Math.min(100, p.margin * 100)) + '%"></i></div><p class="small mute" style="margin:8px 0 0">' + esc(p.why) + "</p></div>"; });
        h += "</div>";
      }
    } else if (t === "customers") {
      h += '<div class="panel gold"><div class="eyebrow">Who you depend on</div><div class="kpis">' + kpi("Largest customer", A.topCustomer ? pc(A.top1) : "n/a", A.topCustomer ? esc(A.topCustomer.name) : "", A.top1 > .2 ? "warn" : "") + kpi("Top 5", pc(A.top5), "of cash received") + '</div></div><div class="panel"><div class="list">' + A.customers.slice(0, 15).map(function (c) { return '<div class="li"><div class="grow"><div class="between"><div class="t">' + esc(c.name) + '</div><div class="amt">' + m(c.in) + '</div></div><div class="bar cy"><i style="width:' + Math.max(1, c.share / (A.customers[0].share || 1) * 100) + '%"></i></div><div class="d">' + pc(c.share) + " of cash in" + (c.late != null ? " · " + (c.late > 3 ? '<span class="warn">pays ' + Math.round(c.late) + " days late</span>" : "pays on time") : "") + "</div></div></div>"; }).join("") + "</div></div>";
    } else if (t === "spending") {
      h += '<div class="panel gold"><div class="eyebrow">Where money goes · last 12 months</div><div class="mid">' + m(A.out12) + '</div><div class="small mute">out, against ' + m(A.in12) + " in</div></div>";
      h += '<div class="panel"><div class="list">' + A.spend.slice(0, 14).map(function (s) { var c = s.change; return '<div class="li"><div class="grow"><div class="between"><div class="t">' + esc(s.cat) + '</div><div class="amt">' + m(s.amount) + '</div></div><div class="bar"><i style="width:' + Math.max(1, s.share / (A.spend[0].share || 1) * 100) + '%"></i></div><div class="d">' + pc(s.share) + " of spending" + (c != null ? ' · <span class="' + (c > .15 ? "neg" : c < -.05 ? "pos" : "") + '">' + (c >= 0 ? "+" : "") + pc(c) + " vs last year</span>" : "") + "</div></div></div>"; }).join("") + "</div></div>";
      var subs = ST.res.fit.rec.filter(function (r) { return r.dir === "-" && r.cat === "Software"; });
      if (subs.length) h += '<div class="panel"><div class="eyebrow">Software and subscriptions</div><div class="list">' + subs.map(function (r) { return '<div class="li"><div class="grow"><div class="t">' + esc(tidy(r.party)) + '</div><div class="d">' + r.label + (r.trend > 0.0003 ? ' · <span class="warn">creeping up</span>' : "") + '</div></div><div class="amt">' + m(-r.amount * 365 / r.period) + '<div class="tiny dim">a year</div></div></div>'; }).join("") + "</div></div>";
    } else if (t === "collections") {
      h += '<div class="panel gold"><div class="eyebrow">Working capital</div><div class="kpis">' + kpi("Customers pay in", A.dso ? Math.round(A.dso) + " days" : "n/a", "from invoice date") + kpi("You pay in", A.dpo ? Math.round(A.dpo) + " days" : "n/a", "from bill date") + kpi("Owed to you", m(A.arOpen), m(A.arOverdue) + " overdue", A.arOverdue > 0 ? "warn" : "") + kpi("You owe", m(A.apOpen), "open bills") + "</div></div>";
      h += '<div class="panel"><div class="eyebrow">Slowest payers</div>' + (A.slowPayers.length ? '<div class="list">' + A.slowPayers.slice(0, 8).map(function (c) { return '<div class="li"><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="d">' + Math.round(c.late) + " days late on average · " + m(c.in) + ' a year</div></div><div class="amt warn">' + m(c.in / 365 * c.late) + '<div class="tiny dim">tied up</div></div></div>'; }).join("") + "</div>" : '<p class="mute small">' + (ST.model.ar.length ? "No customer is regularly more than a week late." : "Add a customer invoice export to see who pays late.") + "</p>") + "</div>";
    } else if (t === "growth") {
      h += '<div class="panel gold"><div class="eyebrow">Opportunities, ranked by value</div><p class="small mute" style="margin:0">Each one is worked out from your own numbers. "Freed" is cash released once; "a year" is yearly profit.</p></div><div class="panel"><div class="list">' + (A.opportunities.map(oppLi).join("") || '<p class="mute small">Add invoices, bills and sales by product to find opportunities.</p>') + "</div></div>";
    } else if (t === "risks") {
      h += '<div class="panel">' + (A.risks.length ? '<div class="list">' + A.risks.map(riskLi).join("") + "</div>" : '<div class="row"><span class="badge g">Clear</span><span class="small mute">No cash, customer or collection risks in this data.</span></div>') + "</div>";
      h += '<div class="panel"><div class="eyebrow">Stress tests</div><p class="small mute" style="margin:0 0 8px">Tap one to see what happens to cash.</p><div class="chips" style="flex-wrap:wrap">' + ["What if sales drop 20%?", "What if we lose our biggest customer?", "What if sales drop 35%?"].map(function (q) { return '<button class="chip" data-q="' + q + '">' + q + "</button>"; }).join("") + "</div></div>";
    }
    return h + foot();
  }

  /* ---------- decide ---------- */
  var PRE = [["Hire", { hires: 2, salary: 75000 }], ["Big purchase", { spend: 0.5 }], ["Raise prices", { pricePct: 5, volumePct: -2 }], ["Recession test", { volumePct: -20 }], ["Collect faster", { collectFaster: 10 }], ["Borrow", { loan: 1 }]];
  function viewDecide() {
    var A = ST.res.analysis, c = ST.sc, cats = A.spend.map(function (s) { return s.cat; }), mo = A.outMonth;
    var h = head() + '<div class="panel gold"><div class="eyebrow">Decision simulator</div><h2>Test a tough call before you make it</h2><p class="small mute" style="margin:6px 0 10px">Move anything below. Liquara reruns hundreds of futures with the change and compares them with doing nothing.</p><div class="chips">' + PRE.map(function (p, i) { return '<button class="chip" data-pre="' + i + '">' + p[0] + "</button>"; }).join("") + '<button class="chip" data-pre="reset">Reset</button></div></div>';
    h += '<div class="wide2"><div><div class="panel"><div class="eyebrow">Result</div><div id="dres"><span class="spin"></span></div></div></div><div><div class="panel sliders">';
    h += sl("pricePct", "Prices", c.pricePct, -20, 20, 1, function (v) { return (v > 0 ? "+" : "") + v + "%"; });
    h += sl("volumePct", "Sales volume", c.volumePct, -50, 50, 1, function (v) { return (v > 0 ? "+" : "") + v + "%"; });
    h += sl("hires", "New hires", c.hires, 0, 50, 1, function (v) { return v; });
    h += sl("salary", "Pay per hire (a year)", c.salary, 20000, 300000, 5000, m);
    h += sl("collectFaster", "Collect from customers sooner", c.collectFaster, 0, 45, 1, function (v) { return v + " days"; });
    h += sl("payLater", "Pay suppliers later", c.payLater, 0, 30, 1, function (v) { return v + " days"; });
    h += '<label class="f"><span>Cut a spending category</span><select class="in" data-sc="cutCat"><option value="">None</option>' + cats.map(function (x) { return "<option" + (x === c.cutCat ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select></label>";
    h += sl("cutPct", "Cut by", c.cutPct, 0, 100, 5, function (v) { return v + "%"; });
    var bigMax = Math.max(1e4, Math.round(mo * 6 / 1e3) * 1e3);
    h += sl("spend", "One-time spend", c.spend, 0, bigMax, Math.max(500, Math.round(bigMax / 200 / 500) * 500), m);
    h += sl("spendWeek", "Spend in week", c.spendWeek, 1, 52, 1, function (v) { return "week " + v; });
    h += sl("loan", "Borrow", c.loan, 0, bigMax, Math.max(500, Math.round(bigMax / 200 / 500) * 500), m);
    h += sl("loanRate", "Loan rate", c.loanRate, 0, 25, 0.5, function (v) { return v + "%"; });
    h += sl("loanMonths", "Pay back over", c.loanMonths, 6, 120, 6, function (v) { return v + " months"; });
    h += '<p class="note">Price changes assume sales volume stays as you set it. Hires include 25% for taxes and benefits.</p><button class="btn full" data-act="savescn">Save this scenario</button></div>' + savedScenarios() + '</div></div>';
    return h + foot();
  }
  function savedScenarios() {
    var L = S.scenarios || []; if (!L.length) return "";
    var base = baseline(), rows = L.map(function (x, i) { var alt = E.scenario(ST.model, toScenario(Object.assign(defSc(), x.sc)), 200), lo = Infinity; for (var j = 1; j <= 365; j++) lo = Math.min(lo, alt.days[j].p10); return "<tr><td><a href=\"#\" data-scn=\"" + i + "\">" + esc(x.name) + "</a></td><td>" + m(alt.days[91].p50) + "</td><td>" + m(alt.days[365].p50) + '</td><td class="' + (lo > 0 ? "" : "neg") + '">' + m(lo) + '</td><td><a href="#" data-scndel="' + i + '">✕</a></td></tr>'; }).join("");
    return '<div class="panel"><div class="eyebrow">Saved scenarios, side by side</div><div class="tw"><table class="t"><tr><th>Scenario</th><th>13 wks</th><th>12 mo</th><th>Careful low</th><th></th></tr><tr><td>Doing nothing</td><td>' + m(base.days[91].p50) + "</td><td>" + m(base.days[365].p50) + "</td><td></td><td></td></tr>" + rows + "</table></div></div>";
  }
  function sl(k, label, v, mn, mx, st, f) { return '<div class="slider"><div class="between"><span class="small">' + label + '</span><b data-lbl="' + k + '">' + f(v) + '</b></div><input type="range" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + v + '" data-sc="' + k + '" data-f="' + k + '"></div>'; }
  var FMT = { pricePct: function (v) { return (v > 0 ? "+" : "") + v + "%"; }, volumePct: function (v) { return (v > 0 ? "+" : "") + v + "%"; }, hires: function (v) { return v; }, salary: function (v) { return m(v); }, collectFaster: function (v) { return v + " days"; }, payLater: function (v) { return v + " days"; }, cutPct: function (v) { return v + "%"; }, spend: function (v) { return m(v); }, spendWeek: function (v) { return "week " + v; }, loan: function (v) { return m(v); }, loanRate: function (v) { return v + "%"; }, loanMonths: function (v) { return v + " months"; } };
  function toScenario(c) {
    var sc = { pricePct: +c.pricePct, volumePct: +c.volumePct, collectFaster: +c.collectFaster, payLater: +c.payLater };
    if (+c.hires) sc.hires = [{ count: +c.hires, monthly: +c.salary * 1.25 / 12, month: 1 }];
    if (c.cutCat && +c.cutPct) { sc.cuts = {}; sc.cuts[c.cutCat] = +c.cutPct; }
    if (+c.spend) sc.oneOff = [{ day: +c.spendWeek * 7, amount: -c.spend }];
    if (+c.loan) sc.loan = { amount: +c.loan, rate: +c.loanRate, months: +c.loanMonths, month: 1 };
    return sc;
  }
  var decT = null;
  function runDecision(now) {
    clearTimeout(decT); decT = setTimeout(function () {
      var el = document.getElementById("dres"); if (!el) return;
      var base = baseline(), alt = E.scenario(ST.model, Object.assign(adjSc(), toScenario(ST.sc), { volumePct: (adjSc().volumePct || 0) + (toScenario(ST.sc).volumePct || 0) }), 300), b13 = base.days[91], a13 = alt.days[91], b12 = base.days[365], a12 = alt.days[365];
      var lowA = Infinity, lowJ = 0; for (var j = 1; j <= 365; j++) if (alt.days[j].p10 < lowA) { lowA = alt.days[j].p10; lowJ = j; }
      var A = ST.res.analysis, cushion = A.outMonth, ok = lowA > 0 && alt.pShort13 < .1, tight = ok && lowA < cushion, col = ok ? (tight ? "var(--amber)" : "var(--green)") : "var(--red)", word = ok ? (tight ? "Tight" : "Safe") : "Risky";
      el.innerHTML = '<div class="verdict"><div class="ring" style="border:3px solid ' + col + ";color:" + col + '">' + word + '</div><div class="small">' + (ok ? (tight ? "Cash stays positive, but the careful low point leaves less than a month of spending as a cushion." : "Cash stays comfortably positive in 9 of 10 futures over the next year.") : "In the careful case cash goes below zero. Chance within 13 weeks: " + pc(alt.pShort13) + ".") + "</div></div>" +
        fan("dec", { hist: histPts(8), fc: base, alt: alt, days: 365, h: 230 }) +
        '<div class="legend"><span><i style="background:#c8ff4d"></i>Doing nothing</span><span><i style="background:#7fb4ff"></i>With this decision</span></div>' +
        '<div class="tw" style="margin-top:10px"><table class="t"><tr><th></th><th>Now</th><th>With decision</th><th>Change</th></tr>' +
        trow("In 13 weeks", b13.p50, a13.p50) + trow("In 12 months", b12.p50, a12.p50) + '<tr><td>Careful low point</td><td colspan="3">' + m(lowA) + " around " + sd(E.fromKey(alt.cut + lowJ)) + "</td></tr></table></div>";
      ST.charts.dec && wireChartEl(el);
    }, now ? 0 : 180);
  }
  function wireChartEl() { wireCharts(); }
  /* the "doing nothing" run uses the same random futures as the decision run, so only the decision moves the numbers */
  function baseline() { if (!ST.res.base300) ST.res.base300 = E.scenario(ST.model, adjSc(), 300); return ST.res.base300; }
  function adjSc() { var sc = {}; if (S.adj) { sc.volumePct = S.adj.inPct || 0; sc.costPct = S.adj.outPct || 0; } var rc = (S.costs || []).filter(function (c) { return c.forecast; }).map(function (c) { return { amount: c.amount, every: c.every }; }); if (rc.length) sc.recurring = rc; return sc; }
  function trow(l, a, b) { var d = b - a; return "<tr><td>" + l + "</td><td>" + m(a) + "</td><td><b>" + m(b) + '</b></td><td class="' + (d >= 0 ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "") + m(d) + "</td></tr>"; }

  /* ---------- ask ---------- */
  function viewAsk() {
    var h = head() + '<div class="panel gold"><div class="eyebrow">Boardroom</div><h2>Ask anything about the money</h2><p class="small mute" style="margin:6px 0 0">Ask anything in your own words. Common questions are worked out instantly from your forecast; anything else is answered by AI from your numbers, and it tells you when it\'s estimating and which data would make it exact.</p></div><div class="qa" id="qa">';
    if (!ST.qa.length) h += '<div class="chips" style="flex-wrap:wrap">' + Q.suggestions.map(function (q) { return '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>";
    ST.qa.forEach(function (x) { h += msgHtml(x); });
    return h + '</div><div style="height:70px"></div>';
  }
  function msgHtml(x) {
    var a = x.a, id = "q" + x.id, body = '<div class="msg me">' + esc(x.q) + '</div><div class="msg ai"><div class="panel">' + (a.intent === "ai" ? '<div class="aibadge">' + (a.estimate ? "AI answer · includes estimates" : "AI answer from your numbers") + (a.conf ? " · " + esc(a.conf) + " confidence" : "") + "</div>" : "") + (a.intent === "wait" ? '<span class="spin"></span> ' : "") + '<h3 class="gold">' + esc(a.title) + "</h3>" + (a.text ? '<div class="small" style="margin-top:6px">' + esc(a.text) + "</div>" : "") + (a.bullets && a.bullets.length ? "<ul class=small>" + a.bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" : "");
    if (a.alt) body += fan(id, { hist: histPts(8), fc: ST.res.forecast, alt: a.alt, days: 365, h: 180 }) + '<div class="legend"><span><i style="background:#c8ff4d"></i>Now</span><span><i style="background:#7fb4ff"></i>With change</span></div>';
    else if (a.chart) body += fan(id, { hist: histPts(13), fc: ST.res.forecast, days: Math.max(28, a.chart.days), h: 170, low: true });
    if (a.intent === "help") body += '<div class="chips" style="flex-wrap:wrap;margin-top:8px">' + Q.suggestions.map(function (q) { return '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>";
    return body + "</div></div>";
  }
  function mountAsk() {
    var bar = document.createElement("div"); bar.className = "askbar"; bar.innerHTML = '<form class="in"><input class="in" id="qin" placeholder="e.g. Can we afford to hire 2 people at $70k?" autocomplete="off" enterkeyhint="send"><button class="btn pri" type="submit">Ask</button></form>';
    document.body.appendChild(bar);
    bar.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); var v = document.getElementById("qin").value.trim(); if (v) ask(v); });
  }
  async function toEnglish(q) {
    if (lang() === "en" || !helperUrl()) return q;
    try { var j = await helper("/translate", { lang: "en", strings: [q] }); return (j.out && j.out[0]) || q; } catch (e) { }
    return q;
  }
  /* a compact picture of the business for the AI: only figures Liquara already worked out */
  function aiContext() {
    var A = ST.res.analysis, FC = ST.res.forecast, r0 = function (v) { return v == null || !isFinite(v) ? null : Math.round(v); }, pc = function (v) { return v == null ? null : Math.round(v * 1000) / 10; };
    var at = function (j) { var d = FC.days[Math.min(j, FC.days.length - 1)]; return d ? { likely: r0(d.p50), low: r0(d.p10), high: r0(d.p90) } : null; };
    var DL = (typeof debts === "function") ? debts() : [];
    return {
      company: { name: companyName(), industry: industry()[1], size: (SIZES.filter(function (x) { return x[0] === S.size; })[0] || [0, ""])[1], region: S.region || null, currency: S.ccy || "USD", sample: !!S.demo, dataAsOf: A.asOf ? String(A.asOf).slice(0, 10) : null, sources: (ST.sources || []).map(function (s) { return s.name; }).slice(0, 12) },
      cash: { balanceToday: r0(A.balance), daysOfCash: r0(A.cushionDays), runwayMonths: A.runway ? Math.round(A.runway * 10) / 10 : null, monthlyIn: r0(A.inMonth), monthlyOut: r0(A.outMonth), monthlyNet: r0(A.netMonth), last12In: r0(A.in12), growthVsPriorYearPct: pc(A.growth), loanPaymentsMonthly: r0(A.debtMonth), ownerDrawsMonthly: r0(A.ownerMonth) },
      forecast: { in4Weeks: at(28), in13Weeks: at(91), in6Months: at(182), in12Months: at(365), chanceCashShortIn13WeeksPct: pc(FC.pShort13), modelAccuracyPct: ST.model && ST.model.bt ? pc(ST.model.bt.accuracy) : null },
      receivables: { owedToYou: r0(A.arOpen), daysToCollect: r0(A.dso), payables: r0(A.apOpen), daysToPay: r0(A.dpo) },
      topCustomers: (A.customers || []).slice(0, 8).map(function (c) { return { name: c.name, last12: r0(c.in), sharePct: pc(c.share), avgDaysLate: c.late == null ? null : Math.round(c.late) }; }),
      spendByCategory: (A.spend || []).slice(0, 12).map(function (s) { return { category: s.cat, last12: r0(s.amount), changePct: pc(s.change) }; }),
      recurring: ((ST.res.fit && ST.res.fit.rec) || []).slice(0, 15).map(function (r) { return { who: r.party, every: r.label, amount: r0(r.amount), category: r.cat }; }),
      products: (A.products || []).slice(0, 10).map(function (p) { return { name: p.name, revenue: r0(p.revenue), marginPct: pc(p.margin), verdict: p.verdict }; }),
      risks: (A.risks || []).slice(0, 6).map(function (r) { return r.title; }),
      opportunities: (A.opportunities || []).slice(0, 6).map(function (o) { return { what: o.title, value: r0(o.value) }; }),
      debts: DL.slice(0, 8).map(function (d) { return { name: d.name, type: d.type || null, balance: d.balance || null, ratePct: d.rate || null, monthlyPayment: r0(monthlyPay(d)) }; })
    };
  }
  async function askAI(q, hint) {
    var cx = aiContext(); if (hint) cx.liquaraCalculation = { forThisQuestion: hint.title + ". " + (hint.text || ""), details: (hint.bullets || []).slice(0, 6) };
    var r = await helper("/ask", { q: q, ctx: cx, history: ST.qa.slice(-4).map(function (x) { return { q: x.q, a: x.a.title + ". " + (x.a.text || "") }; }), lang: lang() });
    var b = (r.bullets || []).slice(0, 8);
    if (r.needs && r.needs.length) b = b.concat(["To make this more accurate, add: " + r.needs.join("; ")]);
    return { title: r.title || "Here's what I found", text: r.answer || "", bullets: b, intent: "ai", estimate: !!r.estimate, conf: r.confidence || "" };
  }
  async function ask(q0, quick) {
    var q = await toEnglish(q0), a = Q.ask(q, ST.ctx), built = a;
    /* suggested questions answer instantly; anything typed goes to AI, with Liquara's own calculation attached when it has one */
    if (!quick && q.length > 3 && helperReady() && (paid() || S.demo)) {
      ST.qa.push({ id: uid(), q: q0, a: { title: "Thinking…", text: "Reading your numbers to answer this.", intent: "wait" } }); render();
      setTimeout(function () { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }, 30);
      try { var hint = built.intent !== "help" && built.intent !== "error" ? built : null; a = await askAI(q, hint); if (hint) { a.alt = hint.alt; a.chart = hint.chart; } } catch (e) {
        if (built.intent !== "help" && built.intent !== "error") a = built; else a = e.code === "tier" || e.code === "limit" || e.status === 429 ? { title: "AI answers are paused", text: e.message, intent: "error" } : { title: "I couldn't reach the AI just now", text: e.message + " Try again, or pick one of the questions below.", bullets: Q.suggestions.slice(0, 6), intent: "error" }; }
      ST.qa.pop();
    }
    q = q0; ST.qa.push({ id: uid(), q: q, a: a }); if (ST.qa.length > 30) ST.qa.shift(); buzz();
    if (ST.tab !== "ask") { ST.tab = "ask"; render(); } else { render(); }
    setTimeout(function () { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }, 30);
  }

  /* ---------- data and connections ---------- */
  var SYSTEMS = [
    ["Any bank", "Online banking → Statements or Activity → Download → CSV, Excel or OFX/QFX. 12 to 24 months is best.", "file"],
    ["QuickBooks Online", "Reports → Transaction List by Date (bank), A/R Aging Detail or Invoice List, Unpaid Bills, Sales by Product/Service Summary → Export to Excel.", "file"],
    ["Xero", "Accounting → Reports → Account Transactions, Aged Receivables Detail, Aged Payables Detail → Export → Excel or CSV.", "file"],
    ["NetSuite", "Saved search or report → Export → CSV. Transactions, open invoices and open bills.", "file"],
    ["Sage / Dynamics / SAP / Oracle", "Export the bank ledger, open receivables and open payables reports to Excel or CSV.", "file"],
    ["Stripe", "Direct live link: Developers → API keys → create a restricted key with read access to Balance transactions. Use the Stripe preset.", "api"],
    ["Square", "Direct live link: Developer dashboard → your app → Production access token. Use the Square preset.", "api"],
    ["Shopify / Toast / Clover", "Export orders or payouts to CSV, or use any JSON API your plan offers with the custom connection.", "file"],
    ["Your own systems (ERP, data warehouse, internal API)", "Any web address that returns JSON. Liquara finds the dates, amounts and names on its own.", "api"]
  ];
  var PRESETS = {
    stripe: { name: "Stripe balance", url: "https://api.stripe.com/v1/balance_transactions?limit=100", hdrName: "Authorization", hdrPrefix: "Bearer ", scale: 0.01, kind: "bank", help: "Paste a restricted key (starts with rk_live_)." },
    square: { name: "Square payments", url: "https://connect.squareup.com/v2/payments?limit=100", hdrName: "Authorization", hdrPrefix: "Bearer ", scale: 0.01, kind: "bank", help: "Paste your production access token." },
    custom: { name: "My system", url: "https://", hdrName: "Authorization", hdrPrefix: "", scale: 1, kind: "", help: "Any address that returns JSON. Add a key or token if it needs one." }
  };
  function viewData() {
    var h = head() + '<div class="panel gold"><div class="eyebrow">Data & connections</div><h2>What Liquara is connected to</h2><div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn pri" data-act="pick">' + ic("up") + ' Add files</button><button class="btn" data-act="api">' + ic("link") + " Connect</button>" + (S.conns && S.conns.length ? '<button class="btn ghost" data-act="sync">' + ic("sync") + " Refresh</button>" : "") + "</div></div>";
    if (S.demo) h += '<div class="panel"><div class="between"><div><b>Demo: ' + esc(DEMO.get(S.demo).name) + '</b><div class="small mute">Fictional company. Adding your own files replaces it.</div></div><button class="btn ghost" data-act="demo" data-id="' + (S.demo === "bakery" ? "northwind" : "bakery") + '">Switch</button></div></div>';
    h += '<div class="panel"><div class="eyebrow">Found in your data</div><div class="list">' + (ST.items || []).map(function (x) { var inf = x.inferred; return '<div class="li"><div class="ic">' + ({ bank: "$", ar: "IN", ap: "OUT", sales: "%" }[inf.kind] || "?") + '</div><div class="grow"><div class="t" style="word-break:break-all">' + esc(x.name) + '</div><div class="d">' + kindName(inf.kind) + " · " + x.table.rows.length.toLocaleString() + " rows · " + pc(inf.confidence) + ' sure</div><div class="map">' + Object.keys(inf.map).map(function (r) { return "<code>" + esc(inf.map[r]) + "</code> " + r; }).join(" ") + "</div></div></div>"; }).join("") + "</div>";
    if (!S.demo) h += '<div class="row" style="margin-top:10px;flex-wrap:wrap">' + ST.sources.filter(function (s) { return s.origin !== "api"; }).map(function (s) { return '<button class="chip" data-del="' + s.id + '">Remove ' + esc(s.name.slice(0, 28)) + " ✕</button>"; }).join("") + "</div>";
    h += "</div>";
    if (S.conns && S.conns.length) h += '<div class="panel"><div class="eyebrow">Live links</div><div class="list">' + S.conns.map(function (c) { return '<div class="li"><div class="ic">' + ic("link") + '</div><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="d" style="word-break:break-all">' + esc(c.url) + '</div><div class="d">' + (c.last ? "Last refreshed " + new Date(c.last).toLocaleString() : "Not refreshed yet") + (c.err ? ' · <span class="neg">' + esc(c.err) + "</span>" : "") + '</div></div><button class="ib" data-delc="' + c.id + '" aria-label="Remove">' + ic("x") + "</button></div>"; }).join("") + '</div><p class="note">Live links refresh every time Liquara opens, straight from this phone to your system.</p></div>';
    h += '<div class="panel"><div class="eyebrow">Your bank, whichever it is</div><div class="list">' +
      li("Statement download · works today", "Chase, Wells Fargo, Byline, any bank or credit union: download transactions as CSV, Excel, QFX/OFX or PDF and add the file. PDFs are read by the AI reader.") +
      li("Corporate bank files · works today", "BAI2, SWIFT MT940 and ISO 20022 camt.053, the files treasury and commercial banking already send every morning.") +
      li("Automatic bank connection · needs setup", "Plaid, MX, Finicity or Teller connect thousands of banks and refresh daily. Turns on once the Liquara helper and a provider account are set up.") +
      li("Through your accounting software · works today", "If your bank feeds QuickBooks, Xero or NetSuite, their exports carry the bank data in.") + "</div></div>";
    if (!S.demo && ST.sources.length) h += '<div class="panel"><div class="eyebrow">Currency of each file</div>' + ST.sources.map(function (x) { return '<div class="between small" style="margin:6px 0"><span style="word-break:break-all">' + esc(x.name) + '</span><select class="in" style="max-width:110px;min-height:36px" data-srcccy="' + x.id + '"><option value="">Auto</option>' + ccyList().map(function (c) { return "<option" + (x.currency === c ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select></div>"; }).join("") + "</div>";
    h += '<div class="panel"><div class="eyebrow">Works with</div><div class="list">' + SYSTEMS.map(function (s) { return '<div class="li"><div class="grow"><div class="between"><div class="t">' + esc(s[0]) + '</div><span class="badge ' + (s[2] === "api" ? "g" : "cy") + '">' + (s[2] === "api" ? "Live link today" : "Export today") + '</span></div><div class="d">' + esc(s[1]) + "</div></div></div>"; }).join("") + '</div><p class="note">One-tap sign-in for QuickBooks, Xero, NetSuite and bank aggregators needs partner approval from each company. It\'s on the roadmap. Until then, their standard exports work and Liquara maps them automatically.</p></div>';
    return h + foot();
  }
  function apiSheet(preset) {
    var p = PRESETS[preset || "custom"];
    sheet('<div class="between"><h2>Connect a live system</h2><button class="ib" data-close>' + ic("x") + '</button></div><div class="seg" style="margin-top:12px">' + Object.keys(PRESETS).map(function (k) { return '<button data-preset="' + k + '" class="' + (k === (preset || "custom") ? "on" : "") + '">' + { stripe: "Stripe", square: "Square", custom: "Any JSON API" }[k] + "</button>"; }).join("") + '</div>' +
      '<label class="f"><span>Name</span><input class="in" id="cn" value="' + esc(p.name) + '"></label><label class="f"><span>Web address (https)</span><input class="in" id="cu" value="' + esc(p.url) + '" inputmode="url" autocapitalize="off" spellcheck="false"></label>' +
      '<label class="f"><span>Key or token (optional)</span><input class="in" id="ck" type="password" autocapitalize="off" spellcheck="false" placeholder="' + esc(p.help) + '"></label>' +
      '<label class="f"><span>What is it?</span><select class="in" id="ckind"><option value="">Let Liquara work it out</option><option value="bank"' + (p.kind === "bank" ? " selected" : "") + '>Money in and out (bank, payments)</option><option value="ar">Customer invoices</option><option value="ap">Supplier bills</option><option value="sales">Sales by product</option></select></label>' +
      '<label class="f"><span>Amounts are in</span><select class="in" id="cs"><option value="1"' + (p.scale === 1 ? " selected" : "") + '>Dollars</option><option value="0.01"' + (p.scale === 0.01 ? " selected" : "") + '>Cents</option></select></label>' +
      '<input type="hidden" id="chn" value="' + esc(p.hdrName) + '"><input type="hidden" id="chp" value="' + esc(p.hdrPrefix) + '">' +
      '<button class="btn pri full" style="margin-top:16px" data-act="savec">Connect and test</button><p class="note">The key is kept only on this phone. Use a read-only key. The first page of results is read each time (100 records for Stripe and Square).</p>');
  }
  async function fetchJSON(url, headers) {
    var H = plug("CapacitorHttp");
    if (H) { var r = await H.get({ url: url, headers: headers, responseType: "text" }); if (r.status >= 400) throw new Error("The system said " + r.status); return typeof r.data === "string" ? r.data : JSON.stringify(r.data); }
    var res = await fetch(url, { headers: headers }); if (!res.ok) throw new Error("The system said " + res.status); return await res.text();
  }
  async function pull(c) {
    var hd = {}; if (c.key) hd[c.hdrName || "Authorization"] = (c.hdrPrefix || "") + c.key; hd.Accept = "application/json";
    var text = await fetchJSON(c.url, hd); JSON.parse(text);
    var src = { id: "api-" + c.id, name: c.name + ".json", type: "json", data: text, origin: "api", scale: c.scale, kind: c.kind || undefined };
    await putSrc(src); c.last = Date.now(); c.err = ""; return src;
  }
  async function syncAll(quiet) {
    if (!S.conns || !S.conns.length) return;
    var n = 0; for (var i = 0; i < S.conns.length; i++) { try { await pull(S.conns[i]); n++; } catch (e) { S.conns[i].err = e.message || "Couldn't reach it"; if (!quiet) toast(S.conns[i].name + ": " + S.conns[i].err); } }
    saveS(); if (n) { ST.sources = await allSrc(); await analyze(); render(); if (!quiet) toast("Refreshed " + n + " live link" + (n > 1 ? "s" : "")); }
  }

  /* ---------- settings, about ---------- */
  function viewSettings() {
    var opt = function (L, v) { return L.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === v ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join(""); };
    var h = head() + accountPanel() + '<div class="panel' + (WS === "account" && paid() ? "" : " gold") + '"><div class="eyebrow">' + (WS === "demo" ? "Sample company" : "Your business") + '</div>' + (WS === "demo" ? "" : coFinder("set")) + '<label class="f"><span>Company name</span><input class="in" id="sco" value="' + esc(S.company || "") + '" placeholder="' + esc(companyName()) + '"></label>' +
      '<label class="f"><span>Size (yearly revenue)</span><select class="in" id="ssz">' + opt(SIZES, S.size) + '</select></label><label class="f"><span>Kind of business</span><select class="in" id="sind">' + opt(INDUSTRIES, S.industry) + '</select></label>' +
      '<label class="f"><span>Where you operate (city, state or country)</span><input class="in" id="sreg" value="' + esc(S.region || "") + '" placeholder="e.g. Houston, Texas"></label><label class="f"><span>Report in this currency</span><select class="in" id="sccy">' + ccyList().map(function (c) { return "<option" + (c === (S.ccy || "USD") ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select></label>' +
      '<label class="f"><span>Cash in the bank today (only if your bank file has no balance column)</span><input class="in" id="sbal" inputmode="decimal" value="' + (S.balance != null ? S.balance : "") + '" placeholder="e.g. 250000"></label>' +
      '<label class="f"><span>Liquara helper address (for AI reading, savings checks and payments)</span><input class="in" id="shelper" value="' + esc(S.helperUrl || CFG.worker || "") + '" placeholder="https://liquara-helper.yourname.workers.dev" autocapitalize="off"></label><button class="btn pri" style="margin-top:12px" data-act="saveset">Save</button></div>';
    h += '<div class="panel"><div class="eyebrow">Exchange rates</div><p class="small mute" style="margin:0 0 8px">European Central Bank reference rates, saved for offline use. Last updated ' + esc((S.fx || FX_BUILTIN).date) + '.</p><button class="btn ghost" data-act="fxrefresh">Update rates now</button><div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap"><input class="in" id="cva" inputmode="decimal" value="1000" style="max-width:120px"><select class="in" id="cvf" style="max-width:100px">' + ccyList().map(function (c) { return "<option" + (c === "USD" ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select><span>→</span><select class="in" id="cvt" style="max-width:100px">' + ccyList().map(function (c) { return "<option" + (c === "EUR" ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select><button class="btn" data-act="fxconv">Convert</button></div><div class="mid" id="cvr" style="margin-top:8px"></div><div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap"><input class="in" id="fmc" placeholder="Code, e.g. NGN" style="max-width:150px"><input class="in" id="fmr" placeholder="Per 1 USD" inputmode="decimal" style="max-width:130px"><button class="btn ghost" data-act="fxmanual">Add my own rate</button></div></div>';
    h += '<div class="panel"><div class="eyebrow">Look and alerts</div><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="theme">' + (S.theme === "light" ? "Switch to dark" : "Switch to light") + '</button><button class="btn ghost" data-act="brief">Monday cash brief: ' + (S.brief ? "on" : "off") + '</button></div></div>';
    h += '<div class="panel"><div class="eyebrow">Language</div>' + langSelect("slang") + '<label class="row" style="gap:8px;margin-top:10px;align-items:center"><input type="checkbox" id="sai"' + (S.aiTranslate !== false ? " checked" : "") + '> <span class="small">Translate everything with AI</span></label><p class="note">Main screens are built in. With the Liquara helper set up, the rest (explanations, answers, file names) is translated by AI once and saved on this device. Ask understands questions in any of these languages when the helper is on.</p></div>';
    if (WS === "account") h += '<div class="panel"><div class="eyebrow">Security</div>' + (S.pin ? '<p class="small mute">A PIN protects Liquara on this device.</p><div class="row" style="gap:8px"><input class="in" id="pin0" type="password" inputmode="numeric" placeholder="Current PIN" style="max-width:180px"><button class="btn ghost" data-act="clearpin">Remove PIN</button></div>' : '<p class="small mute">Optional. Ask for a PIN every time Liquara opens.</p><div class="row" style="gap:8px"><input class="in" id="pin1" type="password" inputmode="numeric" placeholder="4 to 8 digits" style="max-width:180px"><button class="btn" data-act="setpin">Set PIN</button></div>') + '</div>';
    h += syncPanel() + installPanel();
    h += '<div class="panel"><div class="eyebrow">Your data</div><p class="small mute" style="margin:0 0 10px">' + (WS === "account" && paid() && S.sync !== false && !S.demo ? "Saved on this device and synced (scrambled with your license key) to your other devices. AI reading and live checks send only what they need." : "Everything stays in Liquara on this device unless you choose AI reading or live checks.") + '</p><button class="btn ghost" data-act="wipe" style="border-color:rgba(255,125,125,.4);color:var(--red)">Erase all data and start over</button></div>';
    return h + foot();
  }
  function viewAbout() {
    return head() + '<div class="hero"><img class="seal" src="logo.svg" alt="" style="width:170px"><h1>Liquara</h1><p class="gold" style="font-family:var(--serif)">Cash intelligence connected to the heart of your business</p></div>' +
      '<div class="panel"><div class="eyebrow">How it works</div><div class="list">' +
      li("Finds the data on its own", "Reads any layout of bank, invoice, bill and sales exports or JSON from a live system, and works out which column is the date, the amount, the customer and so on.") +
      li("Learns how cash really moves", "Spots payroll, rent, loans, taxes and subscriptions by their rhythm, learns how late each customer pays and how fast you pay suppliers, and picks up seasons and trends.") +
      li("Forecasts with odds, not one guess", "Simulates hundreds of possible futures and shows the most likely path with the range that 8 in 10 futures fall inside.") +
      li("Grades itself first", "Forecasts your past from older data, compares with what happened, picks the method that did best on your business, and widens the range by its own past misses.") +
      li("Turns it into decisions", "Margins by product, customer dependence, late payers, rising costs, ranked opportunities, risks, a decision simulator and plain-language answers.") + "</div></div>" +
      '<div class="panel"><div class="eyebrow">Privacy</div><p class="small mute" style="margin:0">Your files and results live in Liquara on your devices. With sync on, they\'re scrambled with your license key before they leave the device, so they travel to your other devices and no one else can read them. AI reading and live checks send only what they need. Live links go straight from your device to the system you connect. Version ' + VERSION + '.</p></div><div class="panel"><div class="eyebrow">Honest limits</div><p class="small mute" style="margin:0">A forecast is an estimate. The self-test shows how close Liquara got on your own history; results depend on how complete your data is. Not financial, tax or legal advice.</p></div>' + foot();
  }
  function li(t, d) { return '<div class="li"><div class="grow"><div class="t">' + t + '</div><div class="d">' + d + "</div></div></div>"; }
  function sheet(html) { closeSheet(); var s = document.createElement("div"); s.className = "sheet"; s.id = "sheet"; s.innerHTML = '<div class="bd">' + html + "</div>"; s.addEventListener("click", function (e) { if (e.target === s || e.target.closest("[data-close]")) closeSheet(); }); document.body.appendChild(s); }
  function closeSheet() { var s = document.getElementById("sheet"); if (s) s.remove(); }
  function menu() {
    var it = [["data", "data", "Data & connections"], ["news", "info", "Sector news"], ["compete", "ins", "Competitors & growth"], ["loans", "pdf", "Loans & borrowing"], ["savings", "dec", "Savings finder"], ["alerts", "info", "Payment alerts"], ["budget", "ins", "Budget vs actual"], ["actions", "fc", "Action tracker"], ["goals", "home", "Cash goal"], ["pdf", "pdf", "Board pack (PDF)"], ["lender", "pdf", "Lender packet (PDF)"], ["xlsx", "up", "Excel export"], ["tour", "info", "Replay the walkthrough"], ["plans", "link", "Plan & billing"], ["settings", "gear", "Settings"], ["about", "info", "How it works & privacy"]];
    var acts = [];
    if (WS === "account" && paid()) acts = [["myaccount", "link", "My account", "Billing, devices, license key"], ["exploredemo", "demo", "Explore the sample company", "Your account stays exactly as it is"], ["help", "info", "Help & support", "Email a real person"], ["signout", "x", "Sign out", ""]];
    else if (WS === "demo" && paid()) acts = [["exitdemo", "home", "Back to my account", "Leave the sample company"], ["help", "info", "Help & support", "Email a real person"]];
    else acts = [["obtrial", "up", "Start a free trial", "14 days free"], ["signinnow", "link", "Sign in", "Customers: email and license key or password"], ["help", "info", "Help & support", "Email a real person"]].concat(WS === "account" && (S.owner || S.company || hasOwnData()) ? [["signout", "x", "Sign out", "Remove this account's data from this device"]] : []);
    if (WS === "demo") it = it.filter(function (x) { return ["plans"].indexOf(x[0]) < 0 || !paid(); });
    if (WS === "account" && !paid()) it = it.filter(function (x) { return ["about", "plans", "tour"].indexOf(x[0]) >= 0; });
    if (!ST.res) it = it.filter(function (x) { return ["pdf", "lender", "xlsx"].indexOf(x[0]) < 0; });
    sheet('<div class="between"><h2>Menu</h2><button class="ib" data-close>' + ic("x") + "</button></div>" + acts.map(function (x) { return '<button class="opt" data-act="' + x[0] + '"><div class="ic">' + ic(x[1]) + "</div><div><b>" + x[2] + "</b>" + (x[3] ? "<span>" + x[3] + "</span>" : "") + "</div></button>"; }).join("") + '<div class="menusep"></div>' + it.map(function (x) { return '<button class="opt" data-menu="' + x[0] + '"><div class="ic">' + ic(x[1]) + "</div><div><b>" + x[2] + "</b></div></button>"; }).join(""));
  }

  /* ---------- board pack PDF ---------- */
  async function boardPack(kind) {
    var LENDER = kind === "lender";
    toast("Building the board pack…");
    var L = window.PDFLib, A = ST.res.analysis, FC = ST.res.forecast, B = ST.model.bt, doc = await L.PDFDocument.create(), serif = await doc.embedFont(L.StandardFonts.TimesRoman), serifB = await doc.embedFont(L.StandardFonts.TimesRomanBold), sans = await doc.embedFont(L.StandardFonts.Helvetica), sansB = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var navy = L.rgb(0.04, 0.09, 0.21), gold = L.rgb(0.72, 0.57, 0.25), ink = L.rgb(0.1, 0.12, 0.18), mute = L.rgb(0.4, 0.44, 0.52), cy = L.rgb(0.1, 0.55, 0.75), red = L.rgb(0.75, 0.2, 0.2), green = L.rgb(0.15, 0.55, 0.35);
    var icon = null; try { icon = await doc.embedPng(await (await fetch("icon-512.png")).arrayBuffer()); } catch (e) { }
    var W = 612, Hh = 792, page, y;
    function txt(s) { return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/•/g, "-").replace(/[^\x20-\x7e]/g, ""); }
    function newPage(title, sec) { page = doc.addPage([W, Hh]); page.drawRectangle({ x: 0, y: Hh - 64, width: W, height: 64, color: navy }); if (icon) page.drawImage(icon, { x: 40, y: Hh - 54, width: 44, height: 44 }); page.drawText("Liquara", { x: 94, y: Hh - 32, size: 15, font: serifB, color: L.rgb(0.89, 0.76, 0.48) }); page.drawText(txt(companyName() + "  |  " + (LENDER ? "Lender packet" : "Board pack") + "  |  " + fd(A.asOf)), { x: 94, y: Hh - 48, size: 9, font: sans, color: L.rgb(0.8, 0.84, 0.92) }); page.drawText(txt(sec), { x: 40, y: Hh - 92, size: 8, font: sansB, color: gold }); page.drawLine({ start: { x: 40, y: Hh - 98 }, end: { x: W - 40, y: Hh - 98 }, thickness: 0.6, color: gold }); page.drawText(txt(title), { x: 40, y: Hh - 124, size: 22, font: serifB, color: ink }); y = Hh - 150; page.drawText(txt("Prepared with Liquara on " + new Date().toLocaleDateString() + (S.demo ? "  |  FICTIONAL DEMO DATA" : "") + "  |  Page " + doc.getPageCount()), { x: 40, y: 28, size: 7.5, font: sans, color: mute }); }
    function wrap(s, font, size, maxW) { var words = txt(s).split(" "), lines = [], cur = ""; words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; }
    function para(s, o) { o = o || {}; var f = o.font || sans, sz = o.size || 10, x = o.x || 40, mw = o.w || W - 80; wrap(s, f, sz, mw).forEach(function (l) { if (y < 46) newPage(o.cont || "Continued", "CONTINUED"); page.drawText(l, { x: x, y: y, size: sz, font: f, color: o.color || ink }); y -= sz * 1.4; }); y -= o.after != null ? o.after : 4; }
    function kv(items) { var cw = (W - 80) / items.length; items.forEach(function (it, i) { var x = 40 + i * cw; page.drawRectangle({ x: x + 2, y: y - 46, width: cw - 4, height: 50, borderColor: L.rgb(0.85, 0.82, 0.74), borderWidth: 0.7 }); page.drawText(txt(it[0]).toUpperCase(), { x: x + 10, y: y - 10, size: 6.5, font: sansB, color: mute }); page.drawText(txt(it[1]), { x: x + 10, y: y - 28, size: 15, font: serifB, color: it[2] || ink }); if (it[3]) page.drawText(txt(it[3]), { x: x + 10, y: y - 40, size: 7, font: sans, color: mute }); }); y -= 62; }
    function chart(days) {
      var cx = 40, cw = W - 120, ch = 170, cy0 = y - ch, hist = histPts(days > 120 ? 52 : 13), k0 = hist[0].k, k1 = FC.cut + days, vals = [];
      hist.forEach(function (p) { vals.push(p.v); }); for (var j = 0; j <= days; j += 7) vals.push(FC.days[j].p10, FC.days[j].p90);
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pd = (hi - lo) * .08; lo -= pd; hi += pd;
      var X = function (k) { return cx + (k - k0) / (k1 - k0) * cw; }, Y = function (v) { return cy0 + (v - lo) / (hi - lo) * ch; };
      for (var g = 0; g <= 4; g++) { var v = lo + (hi - lo) * g / 4; page.drawLine({ start: { x: cx, y: Y(v) }, end: { x: cx + cw, y: Y(v) }, thickness: 0.3, color: L.rgb(0.85, 0.85, 0.88) }); page.drawText(txt(m(v)), { x: cx + cw + 6, y: Y(v) - 3, size: 7, font: sans, color: mute }); }
      for (var j2 = 0; j2 < days; j2 += 7) { var a = FC.days[j2], b = FC.days[Math.min(days, j2 + 7)]; page.drawSvgPath("M" + X(FC.cut + j2) + " " + (Hh - Y(a.p90)) + " L" + X(FC.cut + j2 + 7) + " " + (Hh - Y(b.p90)) + " L" + X(FC.cut + j2 + 7) + " " + (Hh - Y(b.p10)) + " L" + X(FC.cut + j2) + " " + (Hh - Y(a.p10)) + " Z", { x: 0, y: Hh, color: L.rgb(0.75, 0.9, 0.97), borderWidth: 0 }); }
      for (var i = 1; i < hist.length; i++) page.drawLine({ start: { x: X(hist[i - 1].k), y: Y(hist[i - 1].v) }, end: { x: X(hist[i].k), y: Y(hist[i].v) }, thickness: 1.4, color: navy });
      for (var j3 = 0; j3 < days; j3 += 7) page.drawLine({ start: { x: X(FC.cut + j3), y: Y(FC.days[j3].p50) }, end: { x: X(FC.cut + Math.min(days, j3 + 7)), y: Y(FC.days[Math.min(days, j3 + 7)].p50) }, thickness: 1.6, color: cy });
      page.drawLine({ start: { x: X(FC.cut), y: cy0 }, end: { x: X(FC.cut), y: cy0 + ch }, thickness: 0.6, color: gold, dashArray: [2, 2] }); page.drawText("TODAY", { x: X(FC.cut) + 3, y: cy0 + ch - 8, size: 6.5, font: sansB, color: gold });
      if (lo < 0 && hi > 0) page.drawLine({ start: { x: cx, y: Y(0) }, end: { x: cx + cw, y: Y(0) }, thickness: 0.6, color: red, dashArray: [3, 3] });
      y = cy0 - 14; page.drawText("Dark line: actual balance.  Blue line: most likely.  Shaded: range 8 in 10 futures fall inside.", { x: cx, y: y, size: 7.5, font: sans, color: mute }); y -= 18;
    }
    /* page 1: summary */
    newPage("Cash position and outlook", "SECTION 1  |  SUMMARY");
    var d13 = FC.days[91], d12 = FC.days[365];
    kv([["Cash today", m(FC.start)], ["Likely in 13 weeks", m(d13.p50), cy, m(d13.p10) + " to " + m(d13.p90)], ["Likely in 12 months", m(d12.p50), cy, m(d12.p10) + " to " + m(d12.p90)], ["Self-tested accuracy", B ? pc(B.accuracy) : "n/a", green, B ? B.origins + " tests on own history" : ""]]);
    kv([["Low point, 13 weeks", m(FC.low13.value), FC.low13.value < 0 ? red : ink, sd(FC.low13.date)], ["Chance below zero", pc(FC.pShort13), FC.pShort13 > .1 ? red : green, "within 13 weeks"], ["Cash in vs last year", A.growth != null ? (A.growth >= 0 ? "+" : "") + pc(A.growth) : "n/a"], ["Gross margin", A.gm != null ? pc(A.gm) : "n/a"]]);
    chart(91);
    if (LENDER) {
      page.drawText("Monthly cash history", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 16;
    var hist = {}; ST.model.tx.forEach(function (t) { var k = t.d.toISOString().slice(0, 7), a = hist[k] = hist[k] || [0, 0, 0]; if (t.a > 0) a[0] += t.a; else a[1] -= t.a; a[2] = E.balanceAtKey(ST.model, t.k); });
      var hx = [40, 150, 270, 390]; ["Month", "Money in", "Money out", "Ending cash"].forEach(function (h, i) { page.drawText(h.toUpperCase(), { x: hx[i], y: y, size: 7, font: sansB, color: mute }); }); y -= 12;
      Object.keys(hist).sort().slice(-16).forEach(function (k) { if (y < 50) return; [k, m(hist[k][0]), m(hist[k][1]), m(hist[k][2])].forEach(function (v, i) { page.drawText(txt(v), { x: hx[i], y: y, size: 8.5, font: sans, color: ink }); }); y -= 11.5; });
    } else {
    page.drawText("Board answers", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 18;
    ["Give me the board summary", "What's our lowest point in the next 13 weeks?", "How much can we safely distribute?"].forEach(function (q) { var a = Q.ask(q, ST.ctx); para(a.title, { font: serifB, size: 11, after: 1 }); if (a.text) para(a.text, { size: 9, color: mute, after: 6 }); });
    }
    /* page 2: forecast detail */
    newPage("13-week and 12-month forecast", "SECTION 2  |  FORECAST");
    chart(365);
    var colsX = [40, 170, 290, 410]; ["Week ending", "Low", "Likely", "High"].forEach(function (h, i) { page.drawText(h.toUpperCase(), { x: colsX[i], y: y, size: 7, font: sansB, color: mute }); }); y -= 13;
    function trows(list) { list.forEach(function (r) { [sd(E.fromKey(r.k)), m(r.p10), m(r.p50), m(r.p90)].forEach(function (v, i) { page.drawText(txt(v), { x: colsX[i], y: y, size: 9, font: i === 2 ? sansB : sans, color: i === 2 ? ink : mute }); }); y -= 12.5; }); }
    trows(FC.weeks.slice(0, 13)); y -= 10;
    ["Month end", "Low", "Likely", "High"].forEach(function (h, i) { page.drawText(h.toUpperCase(), { x: colsX[i], y: y, size: 7, font: sansB, color: mute }); }); y -= 13;
    trows(FC.months.slice(0, 12));
    if (!LENDER) {
    /* page 3: analysis */
    newPage("Where to grow, what to fix", "SECTION 3  |  ANALYSIS");
    if (A.products.length) { page.drawText("Margins by product or service", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 18; A.products.forEach(function (p) { para(p.name + "  -  " + pc(p.margin) + " margin, " + m(p.gp) + " profit, " + pc(p.share) + " of sales.  " + p.verdict.toUpperCase() + ": " + p.why, { size: 9, after: 3 }); }); y -= 6; }
    page.drawText("Opportunities ranked by value", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 18;
    A.opportunities.slice(0, 6).forEach(function (o) { para(o.title + "  (" + m(o.value) + (o.kind === "cash" ? " freed" : " a year") + ")", { font: sansB, size: 9.5, after: 1 }); para(o.detail + " " + o.action, { size: 8.5, color: mute, after: 5 }); });
    y -= 4; page.drawText("Risks", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 18;
    if (A.risks.length) A.risks.forEach(function (r) { para((r.level === "high" ? "HIGH  " : "") + r.title + ". " + r.detail, { size: 9, after: 4 }); }); else para("No cash, customer or collection risks flagged in this data.", { size: 9 });
    } else newPage("Method and data quality", "SECTION 3  |  METHOD");
    y -= 6; page.drawText("Method", { x: 40, y: y, size: 13, font: serifB, color: ink }); y -= 18;
    para("Liquara read " + ST.items.length + " data sources, detected " + ST.res.fit.rec.length + " recurring payments and the payment habits of " + Object.keys(ST.res.fit.arD.by).length + " customers, simulated " + FC.sims + " futures, and widened the range by its own past errors. " + (B ? "On " + B.origins + " tests against this company's own history, balance forecasts 1-13 weeks ahead were " + pc(B.accuracy) + " accurate." : "") + " Forecasts are estimates, not financial advice.", { size: 8.5, color: mute });
    var bytes = await doc.save(), name = (companyName().replace(/[^A-Za-z0-9]+/g, "-") + (LENDER ? "-lender-packet.pdf" : "-board-pack.pdf"));
    var FS = plug("Filesystem"), SH = plug("Share");
    if (FS && SH) { try { var b64 = ""; for (var i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); var w = await FS.writeFile({ path: name, data: btoa(b64), directory: "CACHE" }); await SH.share({ title: name, files: [w.uri] }); return; } catch (e) { if (!/cancel/i.test(e.message || "")) toast("Share failed: " + (e.message || e)); return; } }
    try { var file = new File([bytes], name, { type: "application/pdf" }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    var u = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); toast("Downloaded " + name);
  }

  /* ---------- files ---------- */
  var picker = document.createElement("input"); picker.type = "file"; picker.multiple = true; picker.style.display = "none"; document.body.appendChild(picker);
  picker.addEventListener("change", async function () {
    var fl = Array.prototype.slice.call(picker.files || []); picker.value = ""; if (!fl.length) return;
    if (gate("Your own files unlock with your free trial.")) return;
    if (S.demo) { delete S.demo; delete S.budget; S.ccy = null; saveS(); }
    closeSheet(); syncNav(false);
    var done = 0, notes = [];
    function prog(msg) { app.innerHTML = '<div class="ob"><div class="obtop">' + HEART + '<b>Liquara</b></div><h2>Reading your files</h2><div class="cord"></div><p class="mute">' + done + " of " + fl.length + " done. " + esc(msg || "") + '</p><p class="small mute">Big uploads can take a few minutes. Liquara files every item in the right place on its own.</p>' + notes.map(function (n) { return '<div class="small">' + n + "</div>"; }).join("") + "</div>"; }
    for (var i = 0; i < fl.length; i++) {
      var f = fl[i], bin = /\.(xlsx|pdf|png|jpe?g|webp|heic|docx?)$/i.test(f.name), bytes = bin ? new Uint8Array(await f.arrayBuffer()) : null, text = bin ? null : await f.text(), type = typeOf(f.name, text || ""), src = null;
      prog("Reading " + f.name);
      try {
        if (type !== "needs-ai") {
          src = { id: uid(), name: f.name, type: type, data: bin ? bytes : text, origin: "file", added: Date.now() };
          var tbs = await tablesOf(src), best = tbs.reduce(function (mx, x) { var inf = E.infer(x.table, x.name); return Math.max(mx, inf.confidence * (x.table.rows.length > 2 ? 1 : 0)); }, 0);
          if (best < 0.5) src = null;
        }
        if (!src) {
          if (!helperReady()) { notes.push("⚠ " + esc(f.name) + ": needs the AI reader (connect the Liquara helper in Settings)."); done++; continue; }
          if (!(await askConsent())) { notes.push("Skipped " + esc(f.name)); done++; continue; }
          prog("AI is reading " + f.name);
          var r = await aiRead(f, bytes || new TextEncoder().encode(text), bin ? null : text);
          if (r.costs && r.costs.length) { S.costs = (S.costs || []).concat(r.costs.map(function (c) { return { id: uid(), vendor: c.vendor, amount: +c.amount, every: +c.every || 30.4, cat: c.category || "Read from " + f.name, forecast: false }; })); saveS(); }
          if (r.rows && r.rows.length) src = { id: uid(), name: f.name, type: "ai", data: { header: r.header, rows: r.rows }, kind: r.kind, currency: r.currency, origin: "ai", added: Date.now() };
          notes.push("✓ " + esc(f.name) + ": " + (r.rows ? r.rows.length : 0) + " items" + (r.costs ? ", " + r.costs.length + " costs" : "") + (r.kind ? " (" + kindName(r.kind) + ")" : ""));
        } else notes.push("✓ " + esc(f.name));
        if (src) await putSrc(src);
      } catch (e) { notes.push("⚠ " + esc(f.name) + ": " + esc(e.message)); }
      done++;
    }
    ST.sources = await allSrc(); scanAndShow("Connecting your files");
  });

  /* ================= Liquara additions ================= */
  var CFG = window.LQ_CONFIG || {};
  var INDUSTRIES = [["restaurant", "Restaurant, café or food", 16, 1], ["retail", "Retail or shop", 19, 1], ["construction", "Construction or trades", 27, 0], ["services", "Personal or repair services", 23, 1], ["professional", "Professional services", 31, 1], ["health", "Healthcare", 27, 0], ["manufacturing", "Manufacturing", 38, 1], ["realestate", "Real estate", 47, 1], ["software", "Software or tech services", 31, 1], ["wholesale", "Wholesale or distribution", 27, 0], ["other", "Something else", 27, 0]];
  var SIZES = [["s1", "Under $1M a year", "bakery", "owner"], ["s2", "$1M – $10M", "bakery", "owner"], ["s3", "$10M – $100M", "northwind", "business"], ["s4", "$100M – $1B", "halvorsen", "enterprise"], ["s5", "Over $1B", "halvorsen", "enterprise"]];
  var PLANS = { owner: { name: "Owner", m: 39, who: "Under $10M revenue", checks: 20 }, business: { name: "Business", m: 249, who: "$10M – $100M", checks: 100 }, enterprise: { name: "Enterprise", m: 1500, who: "$100M and up", checks: 500 } };
  var PERIODS = { month: ["Monthly", 1, 1], quarter: ["Quarterly", 3, 0.9], year: ["Yearly", 12, 0.8] };
  var TRIAL_DAYS = 14;
  function industry() { var id = S.industry || "other"; return INDUSTRIES.filter(function (x) { return x[0] === id; })[0] || INDUSTRIES[10]; }
  function planFor() { var s = SIZES.filter(function (x) { return x[0] === S.size; })[0]; return s ? s[3] : "owner"; }
  function priceOf(plan, per) { var p = PLANS[plan], q = PERIODS[per]; return Math.round(p.m * q[1] * q[2]); }
  function applyTheme() { document.documentElement.setAttribute("data-theme", S.theme === "light" ? "light" : "dark"); var mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = S.theme === "light" ? "#f3f6fb" : "#070b16"; }
  function trialLeft() { if (!S.trial) return null; return Math.max(0, TRIAL_DAYS - Math.floor((Date.now() - S.trial) / 864e5)); }
  function paid() { var L = acc().license; return !!(L && L.until > Date.now()); }
  function gate(why) { if (paid()) return false; ST.gateMsg = why || "Your own data unlocks with your free trial."; closeSheet(); ST.tab = "plans"; render(); try { window.scrollTo(0, 0); } catch (e) { } return true; }
  function locked() { return !S.demo && !paid() && ((ST.sources && ST.sources.length) || (S.conns && S.conns.length)); }

  /* ---------- currencies ---------- */
  var FX_BUILTIN = { date: "2026-11-23", rates: { USD: 1, EUR: 0.91416, GBP: 0.76491, CAD: 1.4362, MXN: 19.2458, JPY: 159.07, CNY: 6.6647, INR: 92.92, AUD: 1.5113, CHF: 0.83975, BRL: 5.9979, KRW: 1348.85, PHP: 63.855, SGD: 1.2912, HKD: 7.8409, SEK: 10.2729, NOK: 9.8076, DKK: 6.833, PLN: 4.0761, ZAR: 17.5074, NZD: 1.8355, TRY: 50.59, THB: 34.045, IDR: 18222, MYR: 4.123, ILS: 3.3498, CZK: 22.356, HUF: 340.32, RON: 4.8892, ISK: 125.42 } };
  function fxRates() { var r = Object.assign({}, (S.fx || FX_BUILTIN).rates); Object.keys(S.fxManual || {}).forEach(function (c) { r[c] = +S.fxManual[c]; }); return r; }
  /* how many units of the reporting currency one unit of ccy is worth */
  function fxFactor(ccy) { var r = fxRates(), base = S.ccy || "USD"; if (ccy === base) return 1; if (!r[ccy] || !r[base]) return null; return r[base] / r[ccy]; }
  async function refreshFx(quiet) {
    try { var t = await fetchJSON("https://api.frankfurter.dev/v1/latest?from=USD", {}); var j = JSON.parse(t); j.rates.USD = 1; S.fx = { date: j.date, rates: j.rates }; saveS(); if (!quiet) toast("Exchange rates updated (" + j.date + ")"); return true; }
    catch (e) { if (!quiet) toast("Couldn't update rates; using saved rates from " + (S.fx || FX_BUILTIN).date); return false; }
  }
  function ccyList() { return Object.keys(fxRates()).sort(); }

  /* ---------- extra readers: corporate bank files, typed costs ---------- */
  function parseTyped(text) {
    var rows = [], per = { day: 1, daily: 1, week: 7, weekly: 7, month: 30.4, monthly: 30.4, mo: 30.4, quarter: 91.3, quarterly: 91.3, year: 365, yearly: 365, annual: 365, annually: 365, yr: 365 };
    String(text).split(/\n|;/).forEach(function (line) {
      var l = line.trim(); if (!l) return;
      var a = /\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m)?/i.exec(l); if (!a) return;
      var amt = parseFloat(a[1].replace(/,/g, "")) * (/k/i.test(a[2] || "") ? 1e3 : /m/i.test(a[2] || "") ? 1e6 : 1);
      var f = /(?:a|per|\/|every|each)\s*(day|week|month|mo|quarter|year|yr)|\b(daily|weekly|monthly|quarterly|yearly|annually|annual)\b/i.exec(l), every = f ? per[(f[1] || f[2]).toLowerCase()] : 30.4;
      var vendor = l.replace(a[0], "").replace(/(?:we\s+)?(?:pay|spend|for|on|costs?|is|at|about|around)\b/gi, " ").replace(/(?:a|per|\/|every|each)\s*(day|week|month|mo|quarter|year|yr)|\b(daily|weekly|monthly|quarterly|yearly|annually|annual)\b/gi, " ").replace(/[^\w&.' -]/g, " ").replace(/\s+/g, " ").trim() || "Cost";
      rows.push({ vendor: vendor, amount: amt, every: every });
    });
    return rows;
  }

  /* ---------- onboarding: size, industry, walkthrough, sample ---------- */
  var HEART = '<svg viewBox="88 96 336 336" class="mk"><path d="M256 420 C 150 352, 92 292, 92 214 C 92 150, 138 104, 196 104 C 226 104, 246 118, 256 138 C 266 118, 286 104, 316 104 C 374 104, 420 150, 420 214 C 420 292, 362 352, 256 420 Z" fill="#c8ff4d"/><circle cx="318" cy="200" r="30" fill="#0b1226"/></svg>';
  function viewOnboard() {
    if (WS === "account" && paid() && !setupDone() && ST.ob !== "welcome") return viewSetup('<div class="obtop"><button class="homebtn" data-act="home" aria-label="Home" title="Home">' + HEART + "</button>" + '<b>Liquara</b><span style="margin-inline-start:auto;max-width:150px">' + langSelect("oblang") + "</span></div>");
    var step = ST.ob || (WS === "demo" ? (S.size ? (S.industry ? "start" : "industry") : "size") : "welcome");
    var top = '<div class="obtop"><button class="homebtn" data-act="home" aria-label="Home" title="Home">' + HEART + "</button>" + '<b>Liquara</b><span style="margin-inline-start:auto;max-width:150px">' + langSelect("oblang") + "</span></div>";
    if (step === "welcome") return top + '<div class="ob obw"><div class="obhero">' + HEART + '</div><h1>Know where your cash is going. <em>With odds.</em></h1><p class="mute">Forecasts, alerts and plain answers for your business, in your pocket.</p>' +
      '<button class="obpath pri" data-ob="signin"><span class="oi">' + ic("link") + '</span><span><b>I\'m a customer</b><em>Sign in with your email and license key</em></span><i>›</i></button>' +
      '<button class="obpath" data-ob="size"><span class="oi">' + ic("demo") + '</span><span><b>Explore a sample company</b><em>No sign-up. See Liquara on a business your size</em></span><i>›</i></button>' +
      '<button class="obpath" data-act="obtrial"><span class="oi">' + ic("up") + '</span><span><b>Start a free trial</b><em>14 days free, then use your own numbers</em></span><i>›</i></button>' +
      '<p class="tiny mute obtrust">14-day free trial · Cancel any time · Your data stays yours</p></div>';
    if (step === "signin") return top + '<div class="ob obw"><button class="lnk obback" data-ob="welcome">‹ Back</button><div class="eyebrow">Customer sign-in</div><h1>Welcome back</h1><p class="mute">Use the email you subscribed with and the license key from your welcome email. Your company and data come right over.</p>' +
      '<label class="f"><span>Email</span><input class="in" id="si_em" type="email" autocomplete="email" autocapitalize="off" placeholder="you@company.com" value="' + esc(S.lastEmail || "") + '"></label>' +
      '<div class="atabs2"><button class="' + (ST.siMode !== "pw" ? "on" : "") + '" data-act="simode" data-m="key">License key</button><button class="' + (ST.siMode === "pw" ? "on" : "") + '" data-act="simode" data-m="pw">Password</button></div>' +
      (ST.siMode === "pw" ? '<label class="f"><span>Password</span><input class="in" id="si_pw" type="password" autocomplete="current-password"></label>' : '<label class="f"><span>License key</span><input class="in" id="si_key" autocapitalize="characters" autocomplete="off" placeholder="LQ-XXXX-XXXX-XXXX"></label>') +
      '<p class="small" id="si_msg" style="min-height:20px;color:var(--red);margin:10px 0 4px"></p><button class="btn pri full" style="min-height:52px;font-size:17px" data-act="obsignin">Sign in</button>' +
      (ST.siMode === "pw" ? '<button class="btn ghost full" style="margin-top:10px" data-act="forgotpw">Forgot password?</button>' : '<button class="btn ghost full" style="margin-top:10px" data-act="obsendkey">Email me my license key</button>') + '<p class="tiny mute" style="text-align:center;margin-top:14px">Not a customer yet? <button class="lnk" data-ob="welcome">Go back</button> and explore a sample or start a free trial.</p></div>';
    if (step === "size") return top + '<div class="ob">' + (paid() ? '<button class="lnk obback" data-act="exitdemo">‹ Back to my account</button>' : '<button class="lnk obback" data-ob="welcome">‹ Back</button>') + '<div class="eyebrow">Step 1 of 2</div><h1>How big is your business?</h1><p class="mute">Yearly revenue. We\'ll show you Liquara running a company your size.</p>' + coFinder("ob") + '<div class="ordiv"><span>or pick a size</span></div><div class="obgrid">' + SIZES.map(function (x) { return '<button class="opt" data-size="' + x[0] + '"><div class="ic">' + ic("data") + '</div><div><b>' + x[1] + '</b><span>' + ({ s1: "Owner-run shops and studios", s2: "Growing small businesses", s3: "Mid-size companies with a finance team", s4: "Large companies, several entities", s5: "Enterprises and groups" })[x[0]] + "</span></div></button>"; }).join("") + "</div></div>";
    if (step === "industry") return top + '<div class="ob"><div class="eyebrow">Step 2 of 2</div><h1>What kind of business?</h1><p class="mute">Used to compare you with businesses like yours.</p><div class="chips" style="flex-wrap:wrap">' + INDUSTRIES.map(function (x) { return '<button class="chip" data-ind="' + x[0] + '">' + x[1] + "</button>"; }).join("") + '</div><button class="btn ghost obback" style="margin-top:18px" data-ob="size">Back</button></div>';
    var cc = S.co ? '<div class="cocard" style="margin-bottom:16px"><div class="grow"><div class="tiny mute">We found your company</div><b>' + esc(S.co.name) + "</b>" + (S.co.tickers && S.co.tickers[0] ? ' <span class="chip">' + esc(S.co.tickers[0]) + "</span>" : "") + '<div class="tiny mute">' + esc([S.co.sector, [S.co.city, S.co.state].filter(Boolean).join(", "), S.co.revenue ? "~" + m(S.co.revenue) + " revenue" : ""].filter(Boolean).join(" · ")) + '</div></div></div>' : "";
    if (WS === "account" && paid() && !S.demo) return top + '<div class="ob"><h1>' + (S.company ? "Welcome, " + esc(S.company) : "You're all set") + '</h1><p class="mute">Your license is active' + (S.size ? " and your company is set up" : "") + '. Add your bank file or connect your systems to see your own numbers.</p>' + cc + '<button class="btn pri full" data-act="pick">Add my bank file</button><button class="btn ghost full" style="margin-top:10px" data-act="obdata">Other ways to connect</button><button class="btn ghost full" style="margin-top:10px" data-act="syncnow">Bring in my data from my other device</button></div>';
    return top + '<div class="ob"><button class="lnk obback" data-ob="industry">‹ Back</button><h1>Ready when you are</h1>' + cc + '<button class="btn pri full" data-act="tour">Watch how it works (60 sec)</button><button class="btn ghost full" style="margin-top:10px" data-act="sample">Skip to the sample company</button></div>';
  }
  /* the walkthrough plays like a short video, built from the sample company's real results */
  var TOUR = null;
  async function startTour() {
    enterDemo();
    var sz = SIZES.filter(function (x) { return x[0] === S.size; })[0] || SIZES[0];
    S.demo = DEMO.pick ? DEMO.pick(S.industry || "other", S.size || "s2") : sz[2]; saveS(); syncNav(false);
    app.innerHTML = '<div class="tour"><div class="spin"></div></div>';
    await analyze();
    var A = ST.res.analysis, FC = ST.res.forecast, B = ST.model.bt, F = ST.res.fit, nm = DEMO.get(S.demo).name;
    var scenes = [
      ["Connect anything", "Bank downloads, Excel, PDFs, photos of bills, BAI2 / MT940 / camt.053 bank files, Stripe, Square or any API. Typed costs work too.", '<div class="flow">' + ["CSV", "Excel", "PDF", "Photo", "BAI2", "MT940", "API"].map(function (x, i) { return '<span style="animation-delay:' + i * 0.15 + 's">' + x + "</span>"; }).join("") + '<div class="flowheart">' + HEART + "</div></div>"],
      ["It finds the data on its own", "Meet " + nm + " (a sample company). Liquara read " + ST.items.length + " files and worked out every column by itself.", '<div class="maps">' + ST.items.slice(0, 4).map(function (x, i) { return '<div style="animation-delay:' + i * 0.3 + 's"><b>' + esc(x.name.replace(/\.csv$/, "")) + "</b> → " + kindName(x.inferred.kind) + "</div>"; }).join("") + "</div>"],
      ["It learns how cash really moves", F.rec.length + " repeating payments found, plus how late each customer pays.", '<div class="maps">' + F.rec.slice(0, 5).map(function (r, i) { return '<div style="animation-delay:' + i * 0.25 + 's">' + esc(tidy(r.party)) + " · " + r.label + " · <b>" + m(Math.abs(r.amount)) + "</b></div>"; }).join("") + "</div>"],
      ["A forecast with odds, not one guess", FC.sims + " possible futures. Most likely " + m(FC.days[91].p50) + " in 13 weeks.", '<div class="draw">' + fan("tour", { hist: histPts(13), fc: FC, days: 91, h: 190, low: true }) + "</div>"],
      ["It grades itself first", "It forecast this company's past from older data " + (B ? B.origins : 0) + " times and checked the answers.", '<div class="bigstat">' + (B ? pc(B.accuracy) : "–") + '<span>accurate on its own history</span></div>'],
      ["One app, three views", "Owners get plain answers. CFOs get flows and variance. Boards get a forward-looking brief.", '<div class="lenses"><span>Owner</span><span>CFO</span><span>Board</span></div>'],
      ["Money it finds for you", "Ranked moves worth " + m(A.opportunities.slice(0, 3).reduce(function (s, o) { return s + o.value; }, 0)) + ", odd payments flagged, and cheaper options for your bills.", '<div class="maps">' + A.opportunities.slice(0, 3).map(function (o, i) { return '<div style="animation-delay:' + i * 0.3 + 's">' + esc(o.title) + " · <b>" + m(o.value) + "</b></div>"; }).join("") + "</div>"],
      ["Your turn", "Explore the sample. When you're ready, start your free " + TRIAL_DAYS + "-day trial.", '<div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap"><button class="btn pri" data-act="sample">Explore the sample</button><button class="btn" data-act="pick">Connect my data</button></div>']
    ];
    TOUR = { i: 0, scenes: scenes, paused: false, t: null }; showScene();
  }
  function showScene() {
    clearTimeout(TOUR.t); var s = TOUR.scenes[TOUR.i], n = TOUR.scenes.length; ST.charts = {};
    app.innerHTML = '<div class="tour"><div class="tbar">' + TOUR.scenes.map(function (_, i) { return '<i class="' + (i < TOUR.i ? "done" : i === TOUR.i ? "on" + (TOUR.paused ? " paused" : "") : "") + '"></i>'; }).join("") + '</div><div class="scene"><div class="eyebrow">' + (TOUR.i + 1) + " / " + n + "</div><h1>" + s[0] + '</h1><p class="mute">' + s[1] + '</p><div class="vis">' + s[2] + '</div></div><div class="tctl"><button class="btn ghost" data-act="tprev">Back</button><button class="btn ghost" data-act="tpause">' + (TOUR.paused ? "Play" : "Pause") + '</button><button class="btn ghost" data-act="tnext">' + (TOUR.i === n - 1 ? "Done" : "Next") + '</button><button class="btn ghost" data-act="sample">Skip</button></div></div>';
    wireCharts();
    if (!TOUR.paused && TOUR.i < n - 1) TOUR.t = setTimeout(function () { TOUR.i++; showScene(); }, 7500);
  }

  /* ---------- Pulse: one screen, three lenses ---------- */
  function lensBar() { var L = S.lens || "Owner"; return '<div class="seg lens">' + ["Owner", "CFO", "Board"].map(function (x) { return '<button data-lens="' + x + '" class="' + (x === L ? "on" : "") + '">' + x + "</button>"; }).join("") + "</div>"; }
  function banner() {
    if (S.demo) return '<div class="banner"><span><b>Sample company.</b> Everything here is fictional.</span>' + (paid() ? '<button class="btn pri sm" data-act="exitdemo">Back to my account</button>' : '<button class="btn pri sm" data-act="obtrial">Start free trial</button>') + '</div>';
    var t = trialLeft(); if (paid() || t == null) return "";
    return '<div class="banner"><span><b>' + t + " day" + (t === 1 ? "" : "s") + " left</b> in your free trial.</span><button class=\"btn pri sm\" data-go=\"plans\">Choose a plan</button></div>";
  }
  function viewPulse() {
    var L = S.lens || "Owner", h = head() + banner() + lensBar();
    if (ST.model.warnings.length) h += '<div class="panel warnp"><b class="warn">Check this</b><div class="small mute">' + ST.model.warnings.map(esc).join("<br>") + "</div></div>";
    h += L === "CFO" ? lensCFO() : L === "Board" ? lensBoard() : lensOwner();
    return h + foot();
  }
  function tile(inner, cls, attr) { return '<div class="tile ' + (cls || "") + '" ' + (attr || "") + ">" + inner + "</div>"; }
  function lab(t, cls) { return '<div class="lab ' + (cls || "") + '">' + t + "</div>"; }
  function ring(v, max, label) { var r = 50, c = 2 * Math.PI * r, f = Math.min(1, v / max); return '<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="' + r + '" class="rbg"/><circle cx="60" cy="60" r="' + r + '" class="rfg" stroke-dasharray="' + (c * f).toFixed(1) + ' 999" transform="rotate(-90 60 60)"/><text x="60" y="60" text-anchor="middle" class="rv">' + v + '</text><text x="60" y="80" text-anchor="middle" class="rl">' + label + "</text></svg>"; }
  function spark(vals, cls) { vals = vals.filter(function (v) { return v != null; }); if (vals.length < 2) return ""; var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), n = vals.length - 1; return '<svg viewBox="0 0 120 30" class="spark ' + (cls || "") + '" preserveAspectRatio="none"><path d="' + vals.map(function (v, i) { return (i ? "L" : "M") + (i / n * 120).toFixed(1) + " " + (27 - (v - lo) / ((hi - lo) || 1) * 24).toFixed(1); }).join("") + '"/></svg>'; }
  function lensOwner() {
    var A = ST.res.analysis, FC = ST.res.forecast, B = ST.model.bt, days = Math.round(A.cushionDays || 0), ind = industry(), small = !S.size || S.size === "s1" || S.size === "s2";
    var ok = FC.pShort13 < 0.05 && days >= 14, sentence = ok ? "Yes. Cash covers " + days + " days of bills even if no money comes in." : FC.pShort13 >= 0.05 ? "Careful. There's a " + pc(FC.pShort13) + " chance cash runs short in the next 13 weeks." : "Tight. Cash covers only " + days + " days of bills.";
    var bench = small ? '<div class="small mute">Typical ' + (ind[3] ? esc(ind[1].toLowerCase()) : "small business") + ": <b>" + ind[2] + " days</b> (JPMorgan Chase Institute)</div>" : "";
    var h = '<div class="bento">' + tile('<div class="hero2">' + ring(days, Math.max(60, days * 1.25), "DAYS OF CASH") + '<div>' + lab("Are we OK?", "lime") + '<div class="answer">' + sentence + "</div>" + bench + "</div></div>", "span2 heroT");
    h += tile('<div class="between">' + lab("Cash · next 13 weeks") + (B ? '<span class="tiny okc">✓ ' + pc(B.accuracy) + " accurate on your past</span>" : "") + '</div><div class="nums"><b>' + m(FC.start) + '</b><span class="mute">→</span><b class="lime">' + m(FC.days[91].p50) + '</b><span class="small mute">' + m(FC.days[91].p10) + "–" + m(FC.days[91].p90) + "</span></div>" + fan("own", { hist: histPts(13), fc: FC, days: 91, h: 150, low: true }) + '<div class="row" style="gap:6px;flex-wrap:wrap"><button class="chip" data-act="adjust">✎ Adjust forecast</button><button class="chip" data-act="why">Why this number?</button>' + (S.adj && (S.adj.inPct || S.adj.outPct) ? '<span class="badge a">Your adjustment is on</span>' : "") + "</div>", "span2");
    var cal = E.calendar(ST.model, 14), outs = cal.map(function (d) { return d.in - d.out; }), avgOut = A.outMonth / 30.4;
    var cells = cal.map(function (d) { var net = d.in - d.out, c = net < -avgOut * 2.5 ? "c3" : net < -avgOut ? "c2" : net > avgOut ? "c1" : "c0", dt = E.fromKey(ST.res.forecast.cut + cal.indexOf(d) + 1); return '<div class="cal ' + c + '" title="' + sd(dt) + ": " + m(net) + '"><span>' + dt.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }) + "</span><i></i></div>"; }).join("");
    var bigs = []; cal.forEach(function (d, i) { d.items.forEach(function (it) { if (Math.abs(it.amount) > avgOut * 1.5) bigs.push([i, it]); }); });
    bigs.sort(function (a, b) { return Math.abs(b[1].amount) - Math.abs(a[1].amount); });
    h += tile(lab("Next 14 days · surprise radar") + '<div class="calrow">' + cells + '</div><div class="small">' + (bigs.slice(0, 3).map(function (x) { return sd(E.fromKey(ST.res.forecast.cut + x[0] + 1)) + ": " + esc(tidy(x[1].name)) + " <b class='" + (x[1].amount < 0 ? "neg" : "pos") + "'>" + m(x[1].amount) + "</b>"; }).join(" · ") || "No big surprises in the next two weeks.") + "</div>", "span2");
    var al = E.anomalies(ST.model);
    h += tile(lab("Alerts") + (al.length ? '<b class="big2 neg">' + al.length + '</b><div class="small">' + esc(al[0].type === "duplicate" ? "Possible double payment: " + tidy(al[0].party) : al[0].type === "new" ? "Large first payment: " + tidy(al[0].party) : "Unusual amount: " + tidy(al[0].party)) + "</div>" : '<b class="big2 pos">0</b><div class="small mute">Nothing odd found</div>'), "", 'data-go="alerts" role="button"');
    h += tile(lab("Owed to you") + '<b class="big2">' + m(A.arOpen) + '</b><div class="small ' + (A.arOverdue ? "neg" : "mute") + '">' + (A.arOverdue ? m(A.arOverdue) + " overdue" : "Nothing overdue") + "</div>");
    var top = A.opportunities[0];
    if (top) h += tile(lab("Best move", "dark") + '<b class="big2 dark">' + m(top.value) + '</b><div class="small dark">' + esc(top.title) + '</div><button class="chip darkchip" data-track="0">Track this</button>', "limeT span2");
    { var dl = debts(), dpay = dl.reduce(function (s, d) { return s + monthlyPay(d); }, 0) || A.debtMonth || 0;
      h += tile(lab("A typical month") + '<div class="mrow"><div><span>In</span><b class="pos">' + m(A.inMonth) + '</b></div><div><span>Out</span><b class="neg">' + m(A.outMonth) + '</b></div><div><span>Kept</span><b class="' + (A.netMonth >= 0 ? "pos" : "neg") + '">' + m(A.netMonth) + "</b></div></div>" +
        '<div class="tiny mute" style="margin-top:6px">Last 3 months, averaged' + (dpay ? " · loan payments " + m(dpay) + '/mo · <button class="lnk" data-act="lgo2" data-to="loans">Loans</button>' : ' · <button class="lnk" data-act="lgo2" data-to="loans">What could I borrow?</button>') + "</div>", "span2 monthT"); }
    if (S.goal) { var g = goalTarget(), gd = E.goalDate(FC, g), prog = Math.max(0, Math.min(1, FC.start / g)); h += tile(lab("Goal · " + esc(goalLabel())) + '<div class="bar cy"><i style="width:' + Math.round(prog * 100) + '%"></i></div><div class="small">' + (FC.start >= g ? "<b class='pos'>Reached.</b>" : gd ? "Likely around <b>" + fd(gd.date) + "</b>" : "Not reached in the next 12 months on the current path.") + "</div>", "span2", 'data-go="goals" role="button"'); }
    return h + "</div>";
  }
  function lensCFO() {
    var A = ST.res.analysis, B = ST.model.bt, wk = E.weeklyFlows(ST.model, 13), mx = Math.max.apply(null, wk.map(function (w) { return Math.max(w.in, w.out); })) || 1;
    var bars = wk.map(function (w) { return '<div class="wb" title="' + sd(E.fromKey(w.k)) + ": in " + m(w.in) + ", out " + m(w.out) + '"><i class="bi" style="height:' + (w.in / mx * 48).toFixed(0) + 'px"></i><i class="bo" style="height:' + (w.out / mx * 48).toFixed(0) + 'px"></i></div>'; }).join("");
    var h = '<div class="bento">' + tile('<div class="between">' + lab("13-week cash flow") + '<span class="tiny"><span class="pos">■</span> in <span class="neg">■</span> out</span></div><div class="wbars">' + bars + '</div><div class="between tiny mute"><span>' + sd(E.fromKey(wk[0].k)) + "</span><span>" + sd(E.fromKey(wk[12].k)) + "</span></div>", "span2");
    var tr = E.trends(ST.model, 7), dso = tr.map(function (t) { return t.dso; }), dpo = tr.map(function (t) { return t.dpo; });
    h += tile(lab("Days to collect") + '<b class="big2 warn">' + (A.dso ? Math.round(A.dso) : "–") + 'd</b><div class="tiny mute">target 30</div>' + spark(dso, "sw"));
    h += tile(lab("Days to pay") + '<b class="big2">' + (A.dpo ? Math.round(A.dpo) : "–") + 'd</b><div class="tiny mute">terms ~30</div>' + spark(dpo, "sn"));
    var v = E.variance(ST.model);
    if (v) { var row = function (l, f, a, flip) { var d = f ? (a - f) / Math.abs(f) : 0, good = flip ? d <= 0 : d >= 0; return "<tr><td>" + l + "</td><td>" + m(f) + "</td><td>" + m(a) + '</td><td class="' + (good ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "") + (d * 100).toFixed(1) + "%</td></tr>"; }; h += tile(lab("Last week · forecast vs actual") + '<table class="t"><tr><th></th><th>Forecast</th><th>Actual</th><th>Diff</th></tr>' + row("Money in", v.fIn, v.aIn) + row("Money out", v.fOut, v.aOut, true) + row("Ending cash", v.fEnd, v.aEnd) + "</table>", "span2"); }
    if (B) h += tile('<div class="between">' + lab("Model · self-test") + '<span class="tiny mute">' + B.origins + " back-tests · " + ST.res.forecast.sims + ' futures</span></div><div class="row" style="gap:18px"><div><b class="big2 lime">' + pc(B.accuracy) + '</b><div class="tiny mute">balance accuracy</div></div><div><b class="big2">' + pc(B.bandHit) + '</b><div class="tiny mute">inside range</div></div></div>' + (S.adj && (S.adj.inPct || S.adj.outPct) ? '<div class="small note">Your override: money in ' + (S.adj.inPct > 0 ? "+" : "") + (S.adj.inPct || 0) + "%, money out " + (S.adj.outPct > 0 ? "+" : "") + (S.adj.outPct || 0) + "%</div>" : ""), "span2", 'data-go="forecast" role="button"');
    var bv = budgetRows().filter(function (r) { return r.past; }).slice(-3);
    if (bv.length) h += tile(lab("Budget vs actual · last 3 months") + '<table class="t"><tr><th>Month</th><th>Net plan</th><th>Net actual</th></tr>' + bv.map(function (r) { return "<tr><td>" + r.label + "</td><td>" + m(r.bin - r.bout) + '</td><td class="' + (r.ain - r.aout >= r.bin - r.bout ? "pos" : "neg") + '">' + m(r.ain - r.aout) + "</td></tr>"; }).join("") + "</table>", "span2", 'data-go="budget" role="button"');
    var ex = exposure(); if (ex.length > 1) h += tile(lab("Currency exposure · last 12 months") + ex.map(function (e) { return '<div class="between small"><span>' + e.ccy + '</span><span>' + pc(e.share) + " of money in</span></div><div class=\"bar cy\"><i style=\"width:" + Math.round(e.share * 100) + '%"></i></div>'; }).join(""), "span2");
    return h + "</div>";
  }
  function exposure() { var by = {}, tot = 0, last = ST.model.tx.length ? ST.model.tx[ST.model.tx.length - 1].k : 0; ST.model.tx.forEach(function (t) { if (t.a > 0 && t.k > last - 365) { by[t.ccy || "?"] = (by[t.ccy || "?"] || 0) + t.a; tot += t.a; } }); return Object.keys(by).map(function (c) { return { ccy: c, share: tot ? by[c] / tot : 0 }; }).sort(function (a, b) { return b.share - a.share; }); }
  function lensBoard() {
    var A = ST.res.analysis, FC = ST.res.forecast, d13 = FC.days[91], top = A.opportunities[0], need = FC.pShortYear > 0.1;
    var head1 = (FC.pShort13 < 0.05 ? "Liquidity strong." : "Liquidity needs attention.") + (top ? " Top fix worth " + m(top.value) + "." : "") + (need ? " Financing may be needed within 12 months." : " No financing needed in 12 months.");
    var h = '<div class="bento">' + tile(lab("Board brief · " + fd(A.asOf), "lime") + '<div class="answer">' + head1 + '</div><div class="tiny mute">Prepared automatically · every number traces to source data</div>', "span2 heroT");
    h += '<div class="span2 three">' + tile(lab("Cash 13 wks") + "<b class='big3'>" + m(d13.p50) + "</b><div class='tiny mute'>" + m(d13.p10) + "–" + m(d13.p90) + "</div>") + tile(lab("Shortfall odds") + "<b class='big3'>" + (FC.pShortYear < 0.01 ? "<1%" : pc(FC.pShortYear)) + "</b><div class='tiny mute'>next 12 months</div>") + tile(lab("Growth") + "<b class='big3'>" + (A.growth != null ? (A.growth >= 0 ? "+" : "") + pc(A.growth) : "–") + "</b><div class='tiny mute'>cash in, YoY</div>") + "</div>";
    h += tile(lab("Decisions for the board") + A.opportunities.slice(0, 3).map(function (o, i) { return '<div class="dec"><span class="n n' + i + '">' + (i + 1) + "</span><span class='grow'>" + esc(o.title) + "</span><b>" + m(o.value) + "</b></div>"; }).join("") + (A.opportunities.length ? "" : '<div class="small mute">No decisions pending.</div>'), "span2");
    var plan = budgetRows().filter(function (r) { return !r.past; }).slice(0, 3), on = plan.length ? plan.every(function (r) { return r.fin - r.fout >= (r.bin - r.bout) * 0.95 - Math.abs(r.bin - r.bout) * 0.05; }) : null;
    if (plan.length) h += tile(lab("On plan?") + '<b class="big2 ' + (on ? "pos" : "warn") + '">' + (on ? "On track" : "Off plan") + '</b><div class="small mute">Next 3 months, forecast vs budget</div>', "", 'data-go="budget" role="button"');
    var acts = (S.actions || []).filter(function (a) { return a.status !== "done"; }); h += tile(lab("Actions in progress") + '<b class="big2">' + acts.length + '</b><div class="small mute">' + (acts[0] ? esc(acts[0].title) : "Track a move to see results") + "</div>", "", 'data-go="actions" role="button"');
    h += tile(lab("Top risks") + (A.risks.length ? A.risks.slice(0, 3).map(function (r) { return '<div class="small" style="margin-top:6px"><span class="dot ' + (r.level === "high" ? "dr" : "da") + '"></span>' + esc(r.title) + "</div>"; }).join("") : '<div class="small mute">No major risks flagged.</div>'), "span2");
    h += '<div class="tile span2">' + lab("Share with your board") + '<div class="small mute" style="margin:2px 0 10px">One-page brief, live slides, a lender-ready packet or the full numbers.</div><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" data-act="pdf">Board pack PDF</button><button class="btn" data-act="present">Present mode</button><button class="btn ghost" data-act="lender">Lender packet</button><button class="btn ghost" data-act="xlsx">Excel export</button></div></div>';
    return h + "</div>";
  }

  /* ---------- goals ---------- */
  function goalTarget() { var g = S.goal; return g.type === "days" ? g.value * ST.res.analysis.outMonth / 30.4 : g.value; }
  function goalLabel() { var g = S.goal; return g.type === "days" ? g.value + " days of cash" : m(g.value) + " in the bank"; }
  function viewGoals() {
    var h = head() + '<div class="panel gold"><div class="eyebrow">Cash goal</div><p class="small mute">Set a cushion to aim for. Liquara tracks progress and the likely date you\'ll reach it.</p><label class="f"><span>Goal type</span><select class="in" id="gt"><option value="days"' + (S.goal && S.goal.type === "days" ? " selected" : "") + '>Days of cash on hand</option><option value="amount"' + (S.goal && S.goal.type === "amount" ? " selected" : "") + '>Amount in the bank</option></select></label><label class="f"><span>Target</span><input class="in" id="gv" inputmode="decimal" value="' + (S.goal ? S.goal.value : 60) + '"></label><div class="row" style="gap:8px;margin-top:12px"><button class="btn pri" data-act="savegoal">Save goal</button>' + (S.goal ? '<button class="btn ghost" data-act="cleargoal">Remove</button>' : "") + "</div></div>";
    if (S.goal) { var FC = ST.res.forecast, gd = E.goalDate(FC, goalTarget()); h += '<div class="panel"><div class="eyebrow">' + esc(goalLabel()) + '</div><div class="mid">' + m(goalTarget()) + '</div><div class="small mute">target · today ' + m(FC.start) + '</div><p>' + (FC.start >= goalTarget() ? "You're already there." : gd ? "On the likely path you reach it around <b>" + fd(gd.date) + "</b>" + (gd.sure ? " (even in the careful case)." : ". In the careful case it takes longer.") : "Not reached in the next 12 months. Try the Decide screen to see what would get you there.") + "</p></div>"; }
    return h + foot();
  }

  /* ---------- alerts ---------- */
  function viewAlerts() {
    var al = E.anomalies(ST.model);
    var h = head() + '<div class="panel gold"><div class="eyebrow">Payment alerts</div><p class="small mute" style="margin:0">Liquara checks every payment for double charges, large first-time payees and amounts far above normal. Check with your bank before acting.</p></div>';
    h += '<div class="panel"><div class="list">' + (al.map(function (a) { return '<div class="li"><div class="ic" style="color:var(--' + (a.level === "high" ? "red" : "amber") + ')">!</div><div class="grow"><div class="t">' + ({ duplicate: "Possible double payment", "new": "Large first payment to a new payee", jump: "Unusual amount" })[a.type] + '</div><div class="d">' + esc(tidy(a.party)) + " · " + fd(a.date) + " · " + esc(a.detail) + '</div></div><div class="amt">' + m(a.amount) + "</div></div>"; }).join("") || '<div class="small mute">Nothing odd in your payments.</div>') + "</div></div>";
    return h + foot();
  }

  /* ---------- budget vs actual ---------- */
  function monthKey(d) { return d.toISOString().slice(0, 7); }
  function budgetRows() {
    if (!ST.res) return [];
    var M = ST.model, FC = ST.res.forecast, last = M.tx.length ? M.tx[M.tx.length - 1].d : new Date(), act = {}, B = S.budget;
    M.tx.forEach(function (t) { var k = monthKey(t.d), a = act[k] = act[k] || { in: 0, out: 0 }; if (t.a > 0) a.in += t.a; else a.out -= t.a; });
    if (!B || B.demo !== S.demo) { B = { demo: S.demo || null, months: {} }; for (var i = -6; i < 6; i++) { var d = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + i, 1)), py = act[monthKey(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)))]; if (py) B.months[monthKey(d)] = { in: Math.round(py.in * 1.08), out: Math.round(py.out * 1.06) }; } B.auto = true; S.budget = B; saveS(); }
    var fl = E.weeklyFlows(M, 26), fm = {}; fl.forEach(function (w) { var k = monthKey(E.fromKey(w.k)), a = fm[k] = fm[k] || { in: 0, out: 0 }; a.in += w.in; a.out += w.out; });
    var cur = monthKey(last);
    return Object.keys(B.months).sort().map(function (k) { var b = B.months[k], a = act[k] || { in: 0, out: 0 }, f = fm[k] || { in: 0, out: 0 }; return { k: k, label: new Date(k + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }), bin: b.in, bout: b.out, ain: a.in, aout: a.out, fin: f.in, fout: f.out, past: k < cur }; });
  }
  function viewBudget() {
    var rows = budgetRows(), h = head() + '<div class="panel gold"><div class="eyebrow">Budget vs actual</div><p class="small mute" style="margin:0 0 8px">' + (S.budget && S.budget.auto ? "Starter budget: last year plus 8% money in and 6% money out. Type your own numbers or import a sheet with Month, In, Out columns." : "Your plan.") + '</p><button class="btn ghost" data-act="budgetimport">Import budget sheet</button></div>';
    h += '<div class="panel"><div class="tw"><table class="t"><tr><th>Month</th><th>Plan in</th><th>Plan out</th><th>Actual / forecast net</th><th>vs plan</th></tr>' + rows.map(function (r) { var net = r.past ? r.ain - r.aout : r.fin - r.fout, pn = r.bin - r.bout, d = net - pn; return "<tr><td>" + r.label + (r.past ? "" : ' <span class="tiny mute">fcst</span>') + '</td><td><input class="cellin" data-bud="' + r.k + '|in" value="' + Math.round(r.bin) + '"></td><td><input class="cellin" data-bud="' + r.k + '|out" value="' + Math.round(r.bout) + '"></td><td>' + m(net) + '</td><td class="' + (d >= 0 ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "") + m(d) + "</td></tr>"; }).join("") + "</table></div></div>";
    return h + foot();
  }

  /* ---------- action tracker ---------- */
  function trackOpp(i) {
    var o = ST.res.analysis.opportunities[i]; if (!o) return;
    var a = { id: uid(), title: o.title, kind: o.kind, expected: o.value, owner: "", due: E.iso(new Date(Date.now() + 30 * 864e5)), start: ST.model.tx.length ? ST.model.tx[ST.model.tx.length - 1].k - (S.demo === "bakery" && /Hill Country/.test(o.title) ? 70 : 0) : E.dayKey(new Date()), status: "open" };
    var cm = /Get (.+) to pay on time/.exec(o.title); if (cm) a.party = cm[1];
    S.actions = (S.actions || []).concat([a]); saveS(); toast("Tracking: " + o.title); go("actions");
  }
  function measure(a) {
    var M = ST.model, before = [], after = [];
    M.ar.forEach(function (x) { if (!x.paid || (a.party && x.party !== a.party)) return; var late = (x.paid - x.due) / 864e5, k = E.dayKey(x.issued || x.due); (k >= a.start ? after : before).push([late, x.amount]); });
    if (a.kind !== "cash" || after.length < 2) return null;
    var avg = function (L) { var s = 0, w = 0; L.forEach(function (v) { s += v[0] * v[1]; w += v[1]; }); return w ? s / w : 0; };
    var yearly = after.concat(before).reduce(function (s, v) { return s + v[1]; }, 0) / Math.max(1, (M.ar.length ? 2 : 1)), d = avg(before) - avg(after);
    return { daysFaster: d, freed: yearly / 365 * d, n: after.length };
  }
  function viewActions() {
    var L = S.actions || [], h = head() + '<div class="panel gold"><div class="eyebrow">Action tracker</div><p class="small mute" style="margin:0">Moves you decided to make, who owns them, and the cash they actually produced. Tap "Track this" on any opportunity to add it.</p></div>';
    h += L.length ? L.map(function (a) { var r = measure(a); return '<div class="panel"><div class="between"><h3>' + esc(a.title) + '</h3><span class="badge ' + (a.status === "done" ? "g" : "") + '">' + (a.status === "done" ? "Done" : "Open") + '</span></div><div class="small mute">Expected ' + m(a.expected) + " · due " + esc(a.due) + '</div><label class="f"><span>Owner</span><input class="in" data-aown="' + a.id + '" value="' + esc(a.owner || "") + '" placeholder="Who is responsible?"></label><div class="note">' + (r ? (r.daysFaster > 0 ? "<b class='pos'>Working:</b> paying " + r.daysFaster.toFixed(0) + " days faster since you started, about <b>" + m(r.freed) + "</b> freed so far (" + r.n + " invoices)." : "No change yet across " + r.n + " invoices.") : "Measuring. Results appear once new data arrives after the start date.") + '</div><div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost sm" data-adone="' + a.id + '">' + (a.status === "done" ? "Reopen" : "Mark done") + '</button><button class="btn ghost sm" data-adel="' + a.id + '">Remove</button></div></div>'; }).join("") : '<div class="panel small mute">Nothing tracked yet.</div>';
    return h + foot();
  }

  /* ---------- AI helper (Cloudflare Worker) ---------- */
  function helperReady() { return !!CFG.worker; }
  async function helper(path, body) {
    if (!helperReady()) throw new Error("The Liquara helper isn't set up yet");
    var H = plug("CapacitorHttp"), url = CFG.worker.replace(/\/$/, "") + path, hd = { "Content-Type": "application/json" };
    var AL = accS().license; if (AL && AL.code) hd["X-Liquara-License"] = AL.code; if (S.device) hd["X-Liquara-Device"] = S.device;
    var fail = function (st, d) { var e = new Error((d && d.error) || "Helper said " + st); e.status = st; e.code = (d && d.code) || ""; if (e.code === "tier" && accS().license) { var mt = /Switch to (\w+)/.exec(e.message); if (mt && PLANS[mt[1].toLowerCase()]) { accS().license.needs = mt[1].toLowerCase(); saveAcc(); setTimeout(render, 0); } } return e; };
    if (H) { var r = await H.post({ url: url, headers: hd, data: body }); var rd = typeof r.data === "string" ? (function () { try { return JSON.parse(r.data); } catch (x) { return {}; } })() : r.data; if (r.status >= 400) throw fail(r.status, rd); return rd; }
    var res = await fetch(url, { method: "POST", headers: hd, body: JSON.stringify(body) }); var j = await res.json().catch(function () { return {}; }); if (!res.ok) throw fail(res.status, j); return j;
  }
  function askConsent() { return new Promise(function (ok) { if (S.aiOk) return ok(true); sheet('<h2>Use AI to read this?</h2><p class="mute">Files Liquara can\'t read on the device (PDFs, photos, unusual layouts) are sent securely to the AI service to be read, then filed in the right place. Liquara keeps no copy on any server.</p><div class="row" style="gap:8px"><button class="btn pri" id="aiyes">Yes, use AI</button><button class="btn ghost" id="aino">No</button></div>'); document.getElementById("aiyes").onclick = function () { S.aiOk = true; saveS(); closeSheet(); ok(true); }; document.getElementById("aino").onclick = function () { closeSheet(); ok(false); }; }); }
  function b64of(u8) { var s = ""; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  /* AI reads anything into rows the engine understands */
  async function aiRead(file, bytes, text) {
    if (/\.docx$/i.test(file.name)) { try { var z = await window.JSZip.loadAsync(bytes), x = await z.file("word/document.xml").async("string"); text = x.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); } catch (e) { } }
    var body = { name: file.name, mime: file.type || "", text: text || null, data: text ? null : b64of(bytes) };
    var r = await helper("/extract", body); /* { kind, currency, header, rows, costs } */
    return r;
  }

  /* ---------- costs you type or upload, and the savings finder ---------- */
  function viewSavings() {
    var rec = ST.res.fit.rec.filter(function (r) { return r.dir === "-" && ["Payroll", "Taxes", "Loans & interest", "Owner & distributions", "Transfers"].indexOf(r.cat) < 0; }).map(function (r) { return { vendor: tidy(r.party), monthly: Math.abs(r.amount) * 30.4 / r.period, cat: r.cat, src: "Found in your bank data" }; });
    var sup = {}; ST.model.ap.forEach(function (x) { sup[x.party] = (sup[x.party] || 0) + x.amount; }); var yrs = 2; Object.keys(sup).forEach(function (k) { rec.push({ vendor: k, monthly: sup[k] / 12 / yrs, cat: "Supplier", src: "From your bills" }); });
    (S.costs || []).forEach(function (c) { rec.push({ vendor: c.vendor, monthly: c.amount * 30.4 / c.every, cat: c.cat || "Typed in", src: "You added this", own: c.id }); });
    rec.sort(function (a, b) { return b.monthly - a.monthly; });
    var h = head() + '<div class="panel gold"><div class="eyebrow">Savings finder</div><p class="small mute" style="margin:0 0 10px">Checks your bills against cheaper options: similar tools for less, and different approaches that save more. Prices are looked up live, with the source and date shown. Always confirm a quote before switching.</p><label class="f"><span>Add a cost to check (type it the way you\'d say it)</span><textarea class="in" id="costin" placeholder="ServiceMax 1800 a month&#10;Fleet insurance 14,000 a year"></textarea></label><div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><label class="chk"><input type="checkbox" id="costfc"> Not in my bank data yet (add to forecast)</label></div><div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn pri" data-act="addcost">Add</button><button class="btn ghost" data-act="pick">Upload a list, invoices or contracts</button></div>' + (helperReady() ? "" : '<p class="note">Live price checks turn on once the Liquara helper is connected (Settings → Helper).</p>') + "</div>";
    h += '<div class="panel"><div class="list">' + rec.slice(0, 40).map(function (r, i) { var res = (S.savings || {})[r.vendor]; return '<div class="li"><div class="grow"><div class="t">' + esc(r.vendor) + '</div><div class="d">' + esc(r.cat) + " · " + esc(r.src) + "</div>" + (res ? savingsHtml(res) : "") + '</div><div class="amt">' + m(r.monthly) + '<div class="tiny dim">a month</div><button class="chip" style="margin-top:6px" data-save="' + i + '">' + (res ? "Re-check" : "Find cheaper") + "</button>" + (r.own ? '<button class="chip" style="margin-top:6px" data-cdel="' + r.own + '">Remove</button>' : "") + "</div></div>"; }).join("") + "</div></div>";
    ST.savingsList = rec;
    return h + foot();
  }
  function savingsHtml(r) {
    var sec = function (t, L) { return L && L.length ? '<div class="sv"><div class="lab">' + t + "</div>" + L.map(function (o) { return '<div class="svi"><b>' + esc(o.name) + "</b> · " + esc(o.price || "price on request") + (o.saves ? ' · <span class="pos">saves ~' + esc(o.saves) + "</span>" : "") + (o.note ? '<div class="tiny mute">' + esc(o.note) + "</div>" : "") + (o.url ? '<a class="tiny" href="' + esc(o.url) + '" target="_blank" rel="noopener">source</a>' : "") + "</div>"; }).join("") + "</div>" : ""; };
    return sec("Similar, cheaper", r.similar) + sec("Different approach, bigger savings", r.different) + '<div class="tiny mute">Checked ' + esc(r.checked || "") + ". Confirm quotes before switching.</div>";
  }
  /* ================= Market intelligence: sector news, competitors, plan fit ================= */
  var TIER_ORDER = ["owner", "business", "enterprise"], TIER_CAP = { owner: 10e6, business: 100e6 };
  var SIZE_REV = { s1: 0, s2: 0, s3: 12e6, s4: 120e6, s5: 1.2e9 };
  function tierOf(rev) { if (rev > TIER_CAP.business * 1.15) return "enterprise"; if (rev > TIER_CAP.owner * 1.15) return "business"; return "owner"; }
  function trank(t) { return Math.max(0, TIER_ORDER.indexOf(t)); }
  function dataRev() { if (S.demo || !ST.res || !ST.res.analysis) return 0; return Math.max(0, Math.round((ST.res.analysis.inMonth || 0) * 12)); }
  function sizeRev() { return S.demo ? 0 : SIZE_REV[S.size] || 0; }
  function fitRev() { return Math.max(dataRev(), sizeRev(), coRev()); }
  /* the plan this business must be on; never suggests going down */
  function tierNeeded() {
    if (!paid() || S.demo || WS !== "account" || !S.license) return "";
    var cur = S.license.plan || "owner", need = tierOf(fitRev());
    if (S.license.needs && trank(S.license.needs) > trank(need)) need = S.license.needs;
    return trank(need) > trank(cur) ? need : "";
  }
  function viewFit() {
    var need = tierNeeded(), cur = (accS().license || {}).plan || "owner", P = PLANS[need] || PLANS.business, C = PLANS[cur] || PLANS.owner;
    return head() + '<div class="panel gold fitbox"><div class="eyebrow">Plan check</div><h2>Your business has grown past ' + esc(C.name) + '</h2>' +
      '<p class="small mute">' + (coRev() >= Math.max(dataRev(), sizeRev()) ? esc(S.co.name) + "'s latest yearly revenue is about <b>" + m(coRev()) + "</b> (" + esc(S.co.source || "") + ")." : dataRev() > sizeRev() ? "Your own numbers show about <b>" + m(dataRev()) + "</b> coming in a year." : "You told us your business brings in " + esc((SIZES.filter(function (x) { return x[0] === S.size; })[0] || [0, ""])[1]) + " a year.") + " The " + esc(C.name) + " plan is for " + esc(C.who.replace(/^Under/, "under")) + ". You fit <b>" + esc(P.name) + "</b> (" + esc(P.who) + ").</p>" +
      '<div class="fitcmp"><div><span>Now</span><b>' + esc(C.name) + "</b></div><div class=\"arrow\">→</div><div class=\"on\"><span>Your fit</span><b>" + esc(P.name) + "</b><em>from " + m(P.m) + " a month</em></div></div>" +
      '<p class="small mute">You keep everything you\'ve set up. Stripe only charges the difference for the days left in this billing period. Until you switch, your dashboards and AI features are paused. Settings and your data stay open.</p>' +
      '<button class="btn pri full" style="padding:15px;font-size:17px" data-act="upgrade" data-plan="' + need + '">Switch to ' + esc(P.name) + '</button>' +
      '<button class="btn ghost full" style="margin-top:8px" data-act="fitwrong">These numbers aren\'t right</button></div>' +
      '<div class="panel"><div class="eyebrow">Why we check</div><p class="small mute" style="margin:0">Each plan is priced for a size of business, so smaller companies pay less. We never move anyone down: if you chose a bigger plan than you need, you keep it and the room to grow.</p></div>' + foot();
  }
  async function doUpgrade(plan) {
    if (!helperReady()) { toast("The Liquara helper isn't connected"); return; }
    toast("Switching your plan…");
    try { var r = await helper("/upgrade", { plan: plan }); await setLicense(r.code, r); if (accS().license) accS().license.needs = ""; saveAcc(); toast("You're on " + PLANS[r.plan].name + " now"); go("home"); }
    catch (e) { toast("Couldn't switch: " + e.message); }
  }

  /* ---------- find your company (stock ticker or name) ---------- */
  function sicInd(sic) {
    sic = +sic || 0;
    if (sic >= 5800 && sic < 5900) return "restaurant"; if (sic >= 7370 && sic < 7380) return "software"; if (sic >= 8000 && sic < 8100) return "health";
    if (sic >= 1500 && sic < 1800) return "construction"; if (sic >= 2000 && sic < 4000) return "manufacturing"; if (sic >= 5000 && sic < 5200) return "wholesale";
    if (sic >= 5200 && sic < 6000) return "retail"; if (sic >= 6500 && sic < 6600) return "realestate"; if ((sic >= 7200 && sic < 7300) || (sic >= 7500 && sic < 7700)) return "services";
    if ((sic >= 8100 && sic < 9000) || (sic >= 7300 && sic < 7370) || (sic >= 7380 && sic < 7400)) return "professional"; return "other";
  }
  function sizeOf(rev) { return rev >= 1e9 ? "s5" : rev >= 100e6 ? "s4" : rev >= 10e6 ? "s3" : rev >= 1e6 ? "s2" : "s1"; }
  function sector() { return S.co && S.co.sector && !S.demo ? S.co.sector : industry()[1]; }
  function coRev() { return S.co && !S.demo ? +S.co.revenue || 0 : 0; }
  function coFinder(where) {
    var c = S.co && !S.demo ? S.co : null;
    return '<div class="cofind"><label class="f"><span>Find your company: name or stock ticker</span><input class="in" id="cofq" data-cof="' + where + '" autocomplete="off" autocapitalize="off" placeholder="e.g. Acme Bakery, or AAPL"></label><div class="cofl" id="cofl"></div>' +
      (c ? '<div class="cocard"><div class="grow"><b>' + esc(c.name) + "</b>" + (c.tickers && c.tickers[0] ? ' <span class="chip">' + esc(c.tickers[0]) + (c.exchanges && c.exchanges[0] ? " · " + esc(c.exchanges[0]) : "") + "</span>" : "") + '<div class="tiny mute">' + esc([c.sector, [c.city, c.state].filter(Boolean).join(", "), c.revenue ? "~" + m(c.revenue) + " revenue" + (c.revenueYear ? " (" + String(c.revenueYear).slice(0, 4) + ")" : "") : ""].filter(Boolean).join(" · ")) + '</div><div class="tiny dim">' + esc(c.source || "") + '</div></div><button class="chip" data-act="counlink">Remove</button></div>' : "") + "</div>";
  }
  var cofT = 0, cofSeq = 0;
  function cofList(html) { var l = document.getElementById("cofl"); if (l) l.innerHTML = html; }
  function cofSearch(q) {
    clearTimeout(cofT); q = q.trim(); if (!q) { cofList(""); return; }
    cofT = setTimeout(async function () {
      var my = ++cofSeq;
      if (!helperReady()) { cofList('<div class="cofi msg">Company search turns on once the Liquara helper is connected.</div>'); return; }
      cofList('<div class="cofi"><span class="spin"></span></div>');
      try {
        var r = await helper("/company/search", { q: q }); if (my !== cofSeq) return; ST.cofq = q;
        cofList((r.results || []).map(function (x) { return '<button class="cofi" data-act="copick" data-cik="' + x.cik + '"><b>' + esc(x.ticker || "") + "</b><span>" + esc(x.name) + '</span><em>' + esc(x.exchange || "") + "</em></button>"; }).join("") +
          '<button class="cofi web" data-act="cofweb">' + (r.results && r.results.length ? "Not these?" : "Not on the stock market?") + " Search the web for “" + esc(q) + "”</button>");
      } catch (e) { if (my === cofSeq) cofList('<div class="cofi msg">' + esc(e.message) + "</div>"); }
    }, 250);
  }
  function applyCo(c) {
    S.co = c; S.company = c.name; if (c.city || c.state) S.region = [c.city, c.state].filter(Boolean).join(", ");
    if (c.sic) S.industry = sicInd(c.sic); else if (c.ind) S.industry = c.ind;
    if (c.revenue) S.size = sizeOf(c.revenue); saveS();
  }
  async function pickCo(cik) {
    cofList('<div class="cofi"><span class="spin"></span> Reading the company\'s filings…</div>');
    try { var c = await helper("/company", { cik: cik }); applyCo(c); toast("Filled in from " + c.name + "'s SEC filings"); if (!ST.res) ST.ob = "start"; render(); }
    catch (e) { cofList('<div class="cofi msg">' + esc(e.message) + "</div>"); }
  }
  async function webCo() {
    var q = ST.cofq || (document.getElementById("cofq") || {}).value || "";
    if (!paid()) { cofList('<div class="cofi msg">Private companies can be looked up once your trial starts. For now, just pick your size and kind of business below.</div>'); return; }
    cofList('<div class="cofi"><span class="spin"></span> Searching the web for “' + esc(q) + '”…</div>');
    try {
      var r = await helper("/company/find", { name: q, region: region() }); ST.webCo = r.matches || [];
      cofList(ST.webCo.length ? ST.webCo.map(function (x, i) { return '<button class="cofi" data-act="cowebpick" data-i="' + i + '"><b>' + esc(x.name) + "</b><span>" + esc([x.industry, [x.city, x.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")) + "</span><em>" + (x.revenue ? "~" + m(x.revenue) : "") + "</em></button>"; }).join("") : '<div class="cofi msg">No match found. Type your company name in Settings and pick your size.</div>');
    } catch (e) { cofList('<div class="cofi msg">' + esc(e.message) + "</div>"); }
  }
  function pickWebCo(i) {
    var x = ST.webCo[i]; if (!x) return;
    var ind = INDUSTRIES.filter(function (k) { return x.industry && new RegExp(k[1].split(/[ ,]/)[0], "i").test(x.industry); })[0];
    applyCo({ name: x.name, sector: x.industry || "", city: x.city || "", state: x.state || "", website: x.website || "", revenue: +x.revenue || 0, ind: ind ? ind[0] : S.industry, tickers: x.ticker ? [x.ticker] : [], listed: !!x.listed, source: "Web search" + (x.revenueNote ? " · revenue: " + x.revenueNote : "") });
    toast("Filled in " + x.name); render();
  }

  /* ================= Loans & borrowing ================= */
  var LOAN_TYPES = { term: "Term loan", sba: "SBA loan", loc: "Line of credit", equipment: "Equipment loan", vehicle: "Vehicle loan", mortgage: "Real estate loan", card: "Business credit card", mca: "Cash advance", other: "Other" };
  var LOAN_MKT = { term: "bankTerm", sba: "sba7a", loc: "loc", equipment: "equipment", vehicle: "equipment", mortgage: "sba504", mca: "mca" };
  var LPROD = [
    ["sbaMicro", "SBA microloan", "Small needs: equipment, inventory, working capital", 50000, 6, "2–6 weeks", "Some collateral and a personal guarantee", ["s1", "s2"], "about Prime + 4–8%", 4],
    ["sba7a", "SBA 7(a) loan", "Almost anything: working capital, buying a business, refinancing", 5e6, 10, "1–3 months", "Personal guarantee from 20%+ owners; collateral if available", ["s1", "s2", "s3"], "Prime + up to 3–6.5% (SBA caps it; smaller loans can cost more)", 3],
    ["sba504", "SBA 504 loan", "Buying a building or big equipment, fixed rate", 5.5e6, 20, "2–3 months", "The property itself, about 10% down", ["s2", "s3"], "fixed, tied to the 10-year Treasury", 1.5],
    ["bankTerm", "Bank term loan", "A set amount repaid monthly over a few years", 0, 5, "2–6 weeks", "Business assets, often a personal guarantee", ["s2", "s3", "s4"], "about Prime + 1–4%", 2],
    ["loc", "Line of credit", "Covering cash gaps; you pay interest only on what you use", -1, 1, "1–4 weeks", "Receivables and inventory, or unsecured for small lines", ["s1", "s2", "s3", "s4"], "about Prime + 1–8%", 3],
    ["equipment", "Equipment financing", "Vehicles, machines, kitchen gear: the equipment is the collateral", 0, 5, "a few days", "The equipment", ["s1", "s2", "s3", "s4"], "about 6–20% depending on credit", 3],
    ["invoice", "Invoice financing", "Cash now for invoices customers haven't paid yet", -2, 0.25, "a few days", "Your unpaid invoices", ["s1", "s2", "s3"], "about 1–5% of the invoice per month", 0],
    ["rbf", "Revenue-based financing", "Repaid as a share of monthly sales", -3, 1, "a few days", "Future sales", ["s1", "s2", "s3"], "costly: often 20–50%+ a year", 0],
    ["mca", "Merchant cash advance", "Last resort only: the most expensive option", -3, 0.75, "1–2 days", "Future card sales", ["s1", "s2"], "very costly: often 40–150%+ a year", 0],
    ["abl", "Asset-based loan", "A large line backed by receivables and inventory", -4, 3, "4–8 weeks", "Receivables, inventory, equipment", ["s3", "s4", "s5"], "about SOFR + 1.5–4%", 2],
    ["revolver", "Revolving credit facility", "A big company's standing credit line from a bank group", -5, 5, "1–3 months", "Usually company-wide, with covenants", ["s4", "s5"], "about SOFR + 1–2.5%", 1.5],
    ["privateCredit", "Private credit", "Growth, buying companies or refinancing beyond what banks will do", 0, 6, "4–10 weeks", "Company-wide, tighter covenants", ["s3", "s4", "s5"], "about SOFR + 5–8%", 6]
  ];
  function bench(name) { var R = S.rates && S.rates.data, b = R && (R.benchmarks || []).filter(function (x) { return x.name && x.name.toLowerCase().indexOf(name) === 0; })[0]; var v = b && parseFloat(String(b.value).replace(/[^\d.]/g, "")); return isFinite(v) && v > 0 ? v : null; }
  function prime() { return bench("prime") || 7.5; }
  function sofr() { return bench("sofr") || 4.3; }
  function mktRate(id) {
    var R = S.rates && S.rates.data, p = R && R.products && R.products[id], nums = p && String(p.rate || "").match(/\d+(\.\d+)?/g);
    if (nums && nums.length) { var ns = nums.map(Number).filter(function (n) { return n > 0.5 && n < 60; }); if (ns.length) return ns.length > 1 ? (ns[0] + ns[1]) / 2 : ns[0]; }
    var P = LPROD.filter(function (x) { return x[0] === id; })[0]; if (!P) return prime() + 3;
    if (id === "sba504") return (bench("10-year") || 4.4) + 1.5; if (["abl", "revolver", "privateCredit"].indexOf(id) >= 0) return sofr() + P[9];
    if (id === "rbf") return 30; if (id === "mca") return 60; if (id === "invoice") return 24; if (id === "equipment") return prime() + 2;
    return prime() + P[9];
  }
  function my(d) { return d.toLocaleDateString(langLoc(), { month: "short", year: "numeric" }); }
  function pmtM(amount, apr, years) { var r = apr / 1200, n = Math.max(1, Math.round(years * 12)); return r ? amount * r / (1 - Math.pow(1 + r, -n)) : amount / n; }
  function pvM(pay, apr, years) { var r = apr / 1200, n = Math.max(1, Math.round(years * 12)); return r ? pay * (1 - Math.pow(1 + r, -n)) / r : pay * n; }
  function loanRec() { return ((ST.res && ST.res.fit && ST.res.fit.rec) || []).filter(function (r) { return r.dir === "-" && r.cat === "Loans & interest"; }); }
  function debts() {
    var saved = S.debts || [], seen = {}; saved.forEach(function (d) { if (d.key) seen[d.key] = 1; });
    var found = loanRec().filter(function (r) { return !seen[r.key] && !(S.debtHide || []).some(function (k) { return k === r.key; }); }).map(function (r) { return { id: "r:" + r.key, key: r.key, name: r.party || r.key, payment: Math.abs(r.amount), every: r.period || 30.4, found: true }; });
    return saved.concat(found);
  }
  function monthlyPay(d) { return (+d.payment || 0) * 30.4 / (+d.every || 30.4); }
  function payoff(d) {
    var B = +d.balance || 0, P = monthlyPay(d), r = (+d.rate || 0) / 1200;
    if (!B || !P) return null; if (d.type === "loc" || d.type === "card") { if (P <= B * r) return { never: true }; }
    if (r && P <= B * r) return { never: true };
    var n = r ? -Math.log(1 - r * B / P) / Math.log(1 + r) : B / P; n = Math.ceil(n);
    var end = new Date(); end.setMonth(end.getMonth() + n);
    return { months: n, interest: Math.max(0, n * P - B), end: end };
  }
  function debtPlan(extra) {
    var L = debts().filter(function (d) { return +d.balance > 0 && monthlyPay(d) > 0; }).map(function (d) { return { b: +d.balance, r: (+d.rate || 0) / 1200, p: monthlyPay(d), id: d.id }; });
    if (!L.length) return null;
    function run(x) {
      var bs = L.map(function (d) { return d.b; }), m = 0, int = 0, freed = 0;
      while (bs.some(function (b) { return b > 0.5; }) && m < 600) {
        m++; var pool = x + freed; freed = 0;
        var order = L.map(function (d, i) { return i; }).filter(function (i) { return bs[i] > 0.5; }).sort(function (a, b) { return L[b].r - L[a].r; });
        L.forEach(function (d, i) { if (bs[i] <= 0.5) return; var it = bs[i] * d.r; int += it; bs[i] += it; var pay = Math.min(bs[i], d.p); bs[i] -= pay; if (bs[i] <= 0.5) freed += d.p - pay; });
        pool += 0; order.forEach(function (i) { if (pool <= 0 || bs[i] <= 0.5) return; var pay = Math.min(bs[i], pool); bs[i] -= pay; pool -= pay; });
        L.forEach(function (d, i) { if (bs[i] <= 0.5 && !d.done) { d.done = m; } });
      }
      L.forEach(function (d) { delete d.done; });
      return { months: m, interest: int, stuck: m >= 600 };
    }
    var base = run(0), plan = run(extra || 0);
    return { base: base, plan: plan };
  }
  function lendScore() {
    var A = ST.res.analysis, M = ST.model, items = [], score = 0;
    var cfads = A.netMonth + (A.debtMonth || 0), dm = (A.debtMonth || 0) + 0, dscr = dm > 0 ? cfads / dm : null;
    function add(ok, pts, good, fix) { items.push([ok, good, fix]); if (ok) score += pts; }
    add(cfads > 0 && (dscr == null || dscr >= 1.25), 30, dscr == null ? "Cash left over each month with no loan payments yet" : "Debt coverage " + dscr.toFixed(2) + "x (lenders want 1.25x+)", cfads <= 0 ? "More going out than coming in over 3 months. Fix that first; it's the #1 thing lenders check" : "Debt coverage " + (dscr || 0).toFixed(2) + "x is under the 1.25x lenders want");
    var span = M && M.tx.length ? (M.tx[M.tx.length - 1].k - M.tx[0].k) / 30.4 : 0;
    add(span >= 23, 15, "About " + Math.round(span / 12 * 10) / 10 + " years of history on file", "Lenders want 2 years of records; you've loaded about " + Math.max(1, Math.round(span)) + " months. Add older bank files");
    add(A.cushionDays != null && A.cushionDays >= 45, 15, Math.round(A.cushionDays || 0) + " days of cash on hand", "Only " + Math.round(A.cushionDays || 0) + " days of cash on hand; 45+ looks much safer to a lender");
    add(A.growth == null || A.growth >= -0.05, 15, A.growth == null ? "Sales look steady" : "Sales " + (A.growth >= 0 ? "up " : "down ") + Math.abs(Math.round(A.growth * 100)) + "% on last year", "Sales fell " + Math.round(-A.growth * 100) + "% on last year; have a short explanation ready");
    var dtr = A.inMonth > 0 ? debts().reduce(function (s, d) { return s + (+d.balance || 0); }, 0) / (A.inMonth * 12) : 0;
    add(dtr < 0.35, 10, "Existing debt is " + Math.round(dtr * 100) + "% of a year's sales", "Existing debt is " + Math.round(dtr * 100) + "% of a year's sales; lenders get cautious past about 35%");
    add(!A.dso || A.dso <= 45, 15, A.dso ? "Customers pay in about " + Math.round(A.dso) + " days" : "No slow-paying customers found", "Customers take " + Math.round(A.dso) + " days to pay; collecting faster raises what you can borrow");
    return { score: score, items: items, dscr: dscr, cfads: cfads };
  }
  function viewLoans() {
    var A = ST.res.analysis, R = S.rates && S.rates.data, busy = ST.ratesBusy, sz = S.size || "s2", L = lendScore(), DL = debts();
    var rev = (A.inMonth || 0) * 12, existing = DL.reduce(function (s, d) { return s + monthlyPay(d); }, 0) || A.debtMonth || 0, room = Math.max(0, L.cfads / 1.25 - existing);
    var owed = DL.reduce(function (s, d) { return s + (+d.balance || 0); }, 0), lev = Math.max(0, L.cfads * 12 * 3 - owed); /* lenders rarely let total debt pass ~3x a year's cash flow */
    var h = head() + '<div class="panel gold"><div class="eyebrow">Loans & borrowing</div><h2>What you owe, what you could borrow, and what it would cost</h2><p class="small mute" style="margin:6px 0 0">Built from your own cash flow and today\'s rates. Estimates, not loan offers.</p></div>';

    /* ---- current debt ---- */
    var tot = DL.reduce(function (s, d) { return s + (+d.balance || 0); }, 0), wr = 0, wb = 0, intLeft = 0, missing = 0;
    DL.forEach(function (d) { if (+d.balance && +d.rate) { wr += d.balance * d.rate; wb += +d.balance; } var po = payoff(d); if (po && po.interest) intLeft += po.interest; if (!d.balance || !d.rate) missing++; });
    h += '<div class="panel"><div class="eyebrow">Your current debt</div>';
    if (!DL.length) h += '<p class="small mute">No loan payments found in your data yet. Add any loans, lines of credit or cards your business pays.</p>';
    else {
      h += '<div class="kpis">' + kpi("Owed in total", tot ? m(tot) : "–", tot ? DL.length + " " + (DL.length === 1 ? "loan" : "loans") : "add balances") + kpi("Paid each month", m(existing), "all loans") + kpi("Average rate", wb ? (wr / wb).toFixed(1) + "%" : "–", wb ? "weighted by balance" : "add rates") + kpi("Interest left", intLeft ? m(intLeft) : "–", "if paid as scheduled") + "</div>";
      h += '<div class="dlist">' + DL.map(function (d, i) {
        var po = payoff(d), mk = LOAN_MKT[d.type || "term"], mr = mk ? mktRate(mk) : null, refi = "";
        if (po && !po.never && d.rate && mr && d.rate > mr + 1.5 && po.months > 6 && d.type !== "mca") { var np = pmtM(+d.balance, mr, po.months / 12), save = monthlyPay(d) - np; if (save > 20) refi = '<div class="nwm mv"><span>Refinance check</span>Today\'s typical rate for this kind of loan is about ' + mr.toFixed(1) + "%. Refinancing could save about <b>" + m(save) + "/month</b> (" + m(save * po.months) + " total). Ask about fees first.</div>"; }
        return '<div class="dcard"><div class="between"><div class="grow"><b>' + esc(d.name) + "</b>" + (d.found ? ' <span class="chip">found in your bank data</span>' : "") + '<div class="tiny mute">' + esc([LOAN_TYPES[d.type] || (d.found ? "Loan payment" : ""), d.lender].filter(Boolean).join(" · ")) + '</div></div><div class="amt neg">' + m(monthlyPay(d)) + '<span class="tiny mute">/mo</span></div></div>' +
          '<div class="dgrid"><div><span>Balance</span><b>' + (d.balance ? m(+d.balance) : "?") + "</b></div><div><span>Rate</span><b>" + (d.rate ? (+d.rate).toFixed(2) + "%" : "?") + "</b></div><div><span>Paid off</span><b>" + (po ? po.never ? "never at this payment" : my(po.end) : d.end ? esc(d.end) : "?") + "</b></div><div><span>Interest left</span><b>" + (po && po.interest ? m(po.interest) : "?") + "</b></div></div>" +
          (d.limit && d.type === "loc" ? '<div class="bar"><i style="width:' + Math.min(100, (+d.balance || 0) / d.limit * 100) + '%"></i></div><div class="tiny mute">' + m(+d.balance || 0) + " used of " + m(+d.limit) + " · " + m(Math.max(0, d.limit - (d.balance || 0))) + " available</div>" : "") +
          (po && po.never ? '<div class="nwm" style="--lv:#ff6b6b"><span>Heads up</span>This payment barely covers the interest, so the balance won\'t go down. Pay more or refinance.</div>' : "") + refi +
          '<div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost sm" data-act="debtedit" data-i="' + esc(d.id) + '">' + (d.found || !d.balance ? "Add details" : "Edit") + "</button>" + (d.found ? '<button class="btn ghost sm" data-act="debthide" data-k="' + esc(d.key) + '">Not a loan</button>' : "") + "</div></div>";
      }).join("") + "</div>";
      if (missing) h += '<p class="tiny mute">Add balance and rate to each loan to see payoff dates, interest left and refinance savings.</p>';
    }
    h += '<button class="btn ghost full" data-act="debtedit" data-i="new" style="margin-top:8px">+ Add a loan, line or card</button></div>';

    /* ---- payoff planner ---- */
    var plan = debtPlan(ST.extra || 0);
    if (plan) h += '<div class="panel"><div class="eyebrow">Pay it off faster</div><p class="small mute" style="margin:0 0 8px">Extra money each month goes to the highest-rate debt first (the cheapest way to get out of debt).</p><label class="f"><span>Extra each month: <b id="ppv">' + m(ST.extra || 0) + '</b></span><input type="range" class="slider" id="pp_extra" min="0" max="' + Math.max(500, Math.round(existing * 2 / 100) * 100) + '" step="50" value="' + (ST.extra || 0) + '"></label><div id="ppout">' + planOut(plan) + "</div></div>";

    /* ---- borrowing power ---- */
    h += '<div class="panel"><div class="eyebrow">What you could likely borrow</div>';
    if (L.cfads <= 0) h += '<p class="small">Over the last 3 months more cash went out than came in, so most lenders would say no to a regular loan right now. Better routes: ' + (A.arOpen > 0 ? "invoice financing against the " + m(A.arOpen) + " customers owe you, " : "") + "an SBA microloan, or improving cash flow first (try the Savings finder).</p>";
    else {
      var cap5 = Math.min(lev, pvM(room, mktRate("bankTerm"), 5)), cap10 = Math.min(lev, pvM(room, mktRate("sba7a"), 10));
      var lo5 = Math.round(cap5 / 1000) * 1000, hi10 = Math.round(Math.min(cap10, 5e6) / 1000) * 1000;
      h += '<div class="lbig">' + (hi10 - lo5 > lo5 * 0.05 ? "<span>" + m(lo5) + "</span><em>to</em><span>" + m(hi10) + "</span>" : "<em>up to</em><span>" + m(hi10) + "</span>") + '</div><p class="small mute" style="margin:4px 0 10px">' + (hi10 - lo5 > lo5 * 0.05 ? "A 5-year bank loan up to a 10-year SBA loan. " : "") + 'Based on ' + m(L.cfads) + " a month of cash available to repay, keeping the 1.25x coverage lenders require and total debt under about 3x a year's cash flow" + (existing ? ", after your current " + m(existing) + "/month in payments" : "") + ".</p>";
      h += '<div class="kpis">' + kpi("Room for new payments", m(room) + "/mo", "at 1.25x coverage") + kpi("Line of credit", "~" + m(Math.round(rev * 0.1 / 1000) * 1000), "about 10% of yearly sales") + (A.arOpen > 0 ? kpi("Against invoices", "~" + m(A.arOpen * 0.85), "85% of what's owed to you") : "") + kpi("Debt coverage", L.dscr ? L.dscr.toFixed(2) + "x" : "no debt", "1.25x+ is the bar") + "</div>";
    }
    h += "</div>";

    /* ---- lender-ready score ---- */
    h += '<div class="panel"><div class="between"><div class="eyebrow" style="flex:1">Lender-ready score</div></div><div class="lscore"><div class="lring" style="--p:' + L.score + '"><b>' + L.score + "</b><span>of 100</span></div><div class=\"grow\">" + L.items.map(function (x) { return '<div class="lchk ' + (x[0] ? "ok" : "no") + '"><i>' + (x[0] ? "✓" : "!") + "</i>" + esc(x[0] ? x[1] : x[2]) + "</div>"; }).join("") + "</div></div></div>";

    /* ---- today's rates ---- */
    h += '<div class="panel"><div class="eyebrow">Today\'s rates</div>';
    if (R) h += '<div class="rstrip">' + (R.benchmarks || []).map(function (b) { return '<div><span>' + esc(b.name) + "</span><b>" + esc(String(b.value)) + (/%/.test(String(b.value)) ? "" : "%") + "</b>" + (b.url ? '<a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.source || "source") + " ↗</a>" : '<em>' + esc(b.source || "") + "</em>") + "</div>"; }).join("") + "</div>" + (R.takeaway ? '<p class="small" style="margin:10px 0 0">' + esc(R.takeaway) + "</p>" : "") + '<p class="tiny mute">As of ' + esc(R.asOf || "") + ". Checked " + esc(new Date(R.checked || Date.now()).toLocaleString()) + ".</p>";
    else h += '<p class="small mute">' + (busy ? '<span class="spin"></span> Looking up today\'s prime rate, SOFR and loan rates…' : helperReady() ? "Tap to look up today's prime rate, SOFR, Treasury and typical loan rates." : "Live rates turn on once the Liquara helper is connected. Below are typical ranges.") + "</p>";
    if (helperReady() && !busy) h += '<button class="btn ghost sm" data-act="rates">' + (R ? "Refresh rates" : "Get today's rates") + "</button>";
    h += "</div>";

    /* ---- loan options ---- */
    var prods = LPROD.filter(function (p) { return p[7].indexOf(sz) >= 0; });
    h += '<div class="panel"><div class="eyebrow">Loan options for a business your size</div>' + prods.map(function (p) {
      var live = R && R.products && R.products[p[0]], rate = live && live.rate ? live.rate : p[8], r = mktRate(p[0]), amt = "";
      if (p[3] > 0 || p[3] === 0) { var c = L.cfads > 0 ? Math.min(lev, pvM(room, r, p[4])) : 0; if (p[3] > 0) c = Math.min(c, p[3]); amt = c > 1000 ? "up to ~" + m(Math.round(c / 1000) * 1000) + " for you" : p[3] > 0 ? "up to " + m(p[3]) : ""; }
      if (p[3] === -1) amt = "~" + m(Math.round(rev * 0.1 / 1000) * 1000) + " line for you"; if (p[3] === -2) amt = A.arOpen > 0 ? "~" + m(A.arOpen * 0.85) + " against today's invoices" : "needs unpaid invoices"; if (p[3] === -3) amt = "usually 1–2 months of sales";
      var fit = p[0] === "mca" ? ["Avoid if you can", "ch"] : p[0] === "rbf" ? ["Costly", "cm"] : p[3] === -2 && !(A.arOpen > 0) ? ["Not for you yet", "cm"] : L.cfads <= 0 && ["bankTerm", "sba7a", "sba504", "privateCredit", "revolver"].indexOf(p[0]) >= 0 ? ["Hard right now", "cm"] : ["Good fit", "cl"];
      return '<div class="lprod"><div class="between"><b>' + esc(p[1]) + '</b><span class="ctag ' + fit[1] + '">' + fit[0] + '</span></div><div class="small">' + esc(p[2]) + '</div><div class="lmeta"><div><span>Rate</span>' + esc(rate) + "</div><div><span>Amount</span>" + esc(amt || "varies") + "</div><div><span>Repay over</span>" + (p[4] < 1 ? "weeks to months" : p[0] === "loc" ? "1 yr, renews" : p[4] + " yrs") + "</div><div><span>Speed</span>" + esc(p[5]) + "</div><div><span>Backed by</span>" + esc(p[6]) + "</div></div>" + (live && live.url ? '<a class="tiny" href="' + esc(live.url) + '" target="_blank" rel="noopener">Rate source ↗</a>' : "") + "</div>";
    }).join("") + "</div>";

    /* ---- calculator ---- */
    var c0 = ST.calc || { amt: Math.max(10000, Math.round(Math.min(L.cfads > 0 ? Math.min(lev, pvM(room, mktRate("bankTerm"), 5)) : 50000, 2e6) / 5000) * 5000), rate: Math.round(mktRate("bankTerm") * 4) / 4, yrs: 5 }; ST.calc = c0;
    h += '<div class="panel gold"><div class="eyebrow">Try a loan</div><div class="lcalc"><label class="f"><span>Amount</span><input class="in" id="lc_amt" inputmode="numeric" value="' + c0.amt + '"></label><label class="f"><span>Rate %</span><input class="in" id="lc_rate" inputmode="decimal" value="' + c0.rate + '"></label><label class="f"><span>Years</span><input class="in" id="lc_yrs" inputmode="decimal" value="' + c0.yrs + '"></label></div><div id="lcout">' + calcOut() + '</div><button class="btn ghost full" data-act="lgo2" data-to="decide" style="margin-top:8px">See it in your forecast (Decide)</button></div>';

    /* ---- what lenders ask for ---- */
    var docs = [["13-week cash forecast", true], ["Bank statements (last 12–24 months)", true], ["Customers who owe you, by age (A/R aging)", A.arOpen > 0], ["Profit & loss and balance sheet (2–3 years + this year)", false], ["Business and personal tax returns (2–3 years)", false], ["List of current debts (this page)", DL.length > 0], ["Personal financial statement (SBA Form 413 for SBA loans)", false], ["What the money is for, and how it pays back", false], ["Ownership documents and IDs for 20%+ owners", false]];
    h += '<div class="panel"><div class="eyebrow">What lenders will ask for</div>' + docs.map(function (d) { return '<div class="lchk ' + (d[1] ? "ok" : "") + '"><i>' + (d[1] ? "✓" : "○") + "</i>" + esc(d[0]) + (d[1] ? ' <span class="tiny" style="color:var(--green)">Liquara has this</span>' : "") + "</div>"; }).join("") +
      '<button class="btn pri full" data-act="lender" style="margin-top:12px">Download my lender packet (PDF)</button><p class="tiny mute">Also helps: a personal credit score of 680+ for SBA and bank loans, and a business credit file (Dun & Bradstreet, Experian Business).</p></div>';

    /* ---- where to apply ---- */
    var LF = S.lenders && S.lenders.data;
    h += '<div class="panel"><div class="eyebrow">Where to apply</div>' +
      '<div class="gstep"><span class="gn">1</span><div class="grow"><b>Your own bank or credit union</b><div class="small mute">They already see your deposits. Ask for a business banker.</div></div></div>' +
      '<div class="gstep"><span class="gn">2</span><div class="grow"><b>SBA Lender Match</b><div class="small mute">Free SBA tool: answer a few questions and SBA lenders contact you.</div><a class="tiny" href="https://www.sba.gov/funding-programs/loans/lender-match" target="_blank" rel="noopener">sba.gov ↗</a></div></div>' +
      '<div class="gstep"><span class="gn">3</span><div class="grow"><b>Community lenders (CDFIs)</b><div class="small mute">Mission-driven lenders that often say yes when banks say no.</div><a class="tiny" href="https://ofn.org/cdfi-locator/" target="_blank" rel="noopener">CDFI locator ↗</a></div></div>' +
      (LF ? (LF.lenders || []).map(function (x) { return '<div class="gstep"><span class="gn">' + HEART_SM + '</span><div class="grow"><b>' + esc(x.name) + '</b> <span class="chip">' + esc(x.type || "") + '</span><div class="small">' + esc(x.why || "") + '</div><div class="tiny mute">' + esc([x.products, x.speed].filter(Boolean).join(" · ")) + (x.url ? ' · <a href="' + esc(x.url) + '" target="_blank" rel="noopener">site ↗</a>' : "") + "</div></div></div>"; }).join("") + ((LF.tips || []).length ? '<div class="nwm mv"><span>Tips to get approved</span>' + LF.tips.map(esc).join("<br>") + "</div>" : "") : "") +
      (paid() && !S.demo ? '<button class="btn ghost full" data-act="lenders" style="margin-top:10px"' + (ST.lendBusy ? " disabled" : "") + ">" + (ST.lendBusy ? '<span class="spin"></span> Finding lenders near you…' : LF ? "Find lenders again" : "Find lenders that fit me") + "</button>" : '<p class="note">Lenders matched to your business and city unlock with your plan.</p>') + "</div>";
    h += '<p class="tiny mute" style="text-align:center">Estimates from your own numbers and public rates. Not a loan offer or financial advice; every lender decides for itself.</p>';
    if (!R && helperReady() && !busy && !ST.ratesTried) { ST.ratesTried = true; setTimeout(function () { getRates(false); }, 50); }
    return h + foot();
  }
  function calcOut() {
    var c = ST.calc, A = ST.res.analysis, L = lendScore(), existing = debts().reduce(function (s, d) { return s + monthlyPay(d); }, 0) || A.debtMonth || 0;
    var pay = pmtM(+c.amt || 0, +c.rate || 0, +c.yrs || 1), tot = pay * Math.round((+c.yrs || 1) * 12), dscr = (existing + pay) > 0 ? L.cfads / (existing + pay) : null, left = L.cfads - existing - pay;
    return '<div class="kpis">' + kpi("Monthly payment", m(pay), "for " + c.yrs + " years") + kpi("Total interest", m(Math.max(0, tot - c.amt)), "over the loan") + kpi("Cash left each month", m(left), "after all loan payments", left < 0 ? "neg" : "pos") + kpi("Debt coverage", dscr ? dscr.toFixed(2) + "x" : "–", dscr && dscr >= 1.25 ? "lenders would be comfortable" : "below the 1.25x most lenders want", dscr && dscr >= 1.25 ? "pos" : "neg") + "</div>";
  }
  function planOut(p) {
    if (!p) return "";
    if (p.base.stuck) return '<p class="small">At today\'s payments some debt never gets paid off. Add extra each month to see a payoff date.</p>';
    var mo = p.base.months - p.plan.months, sv = p.base.interest - p.plan.interest, end = new Date(); end.setMonth(end.getMonth() + p.plan.months);
    return '<div class="kpis">' + kpi("Debt-free by", my(end), p.plan.months + " months") + kpi("Time saved", mo > 0 ? mo + " months" : "–", "vs. paying the minimum") + kpi("Interest saved", sv > 1 ? m(sv) : "–", "vs. paying the minimum", "pos") + "</div>";
  }
  function debtSheet(id) {
    var d = id === "new" ? { id: "d" + Date.now(), type: "term", every: 30.4 } : debts().filter(function (x) { return x.id === id; })[0]; if (!d) return; ST.debtEd = d;
    sheet('<h2>' + (id === "new" ? "Add a loan" : esc(d.name)) + '</h2><p class="small mute">The more you fill in, the better the payoff and refinance numbers. Check a recent statement.</p>' +
      '<label class="f"><span>Name</span><input class="in" id="de_name" value="' + esc(d.name || "") + '" placeholder="e.g. Chase equipment loan"></label>' +
      '<label class="f"><span>Kind</span><select class="in" id="de_type">' + Object.keys(LOAN_TYPES).map(function (k) { return '<option value="' + k + '"' + ((d.type || "term") === k ? " selected" : "") + ">" + LOAN_TYPES[k] + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>Lender</span><input class="in" id="de_lender" value="' + esc(d.lender || "") + '" placeholder="Bank or company"></label>' +
      '<div class="lcalc"><label class="f"><span>Balance owed today</span><input class="in" id="de_bal" inputmode="decimal" value="' + (d.balance || "") + '"></label><label class="f"><span>Interest rate %</span><input class="in" id="de_rate" inputmode="decimal" value="' + (d.rate || "") + '"></label></div>' +
      '<div class="lcalc"><label class="f"><span>Payment</span><input class="in" id="de_pay" inputmode="decimal" value="' + (d.payment ? Math.round(d.payment * 100) / 100 : "") + '"></label><label class="f"><span>How often</span><select class="in" id="de_every"><option value="7"' + (d.every <= 8 ? " selected" : "") + '>Weekly</option><option value="30.4"' + (d.every > 8 && d.every < 60 ? " selected" : "") + '>Monthly</option><option value="91"' + (d.every >= 60 && d.every < 200 ? " selected" : "") + '>Quarterly</option><option value="365"' + (d.every >= 200 ? " selected" : "") + ">Yearly</option></select></label></div>" +
      '<div class="lcalc"><label class="f"><span>Credit limit (lines and cards)</span><input class="in" id="de_limit" inputmode="decimal" value="' + (d.limit || "") + '"></label><label class="f"><span>Ends (month and year)</span><input class="in" id="de_end" type="month" value="' + esc(d.end || "") + '"></label></div>' +
      '<label class="f"><span>Personal guarantee?</span><select class="in" id="de_pg"><option value="">Not sure</option><option value="yes"' + (d.pg === "yes" ? " selected" : "") + '>Yes</option><option value="no"' + (d.pg === "no" ? " selected" : "") + ">No</option></select></label>" +
      '<button class="btn pri full" data-act="debtsave" style="margin-top:14px">Save</button>' + (id !== "new" && !d.found ? '<button class="btn ghost full" data-act="debtdel" style="margin-top:8px">Remove this loan</button>' : ""));
  }
  async function getRates(fresh) {
    if (!helperReady()) { toast("Connect the Liquara helper first"); return; }
    ST.ratesBusy = true; render();
    try { var r = await helper("/rates", { fresh: !!fresh }); S.rates = { at: Date.now(), data: r }; saveS(); } catch (e) { toast("Couldn't get rates: " + e.message); }
    ST.ratesBusy = false; render();
  }
  async function getLenders() {
    if (gate("Lender matching unlocks with your free trial.")) return;
    ST.lendBusy = true; render();
    try { var r = await helper("/lenders", { industry: sector(), region: region() || "United States", revenue: coRev() || dataRev() || sizeRev() || undefined, amount: ST.calc && ST.calc.amt, purpose: "" }); S.lenders = { at: Date.now(), data: r }; saveS(); }
    catch (e) { toast((e.code === "tier" || e.code === "limit") ? e.message : "Couldn't find lenders: " + e.message); }
    ST.lendBusy = false; render();
  }

  /* ================= Account: status, menu, sign out, portal ================= */
  async function acctApi(path, body, tok) {
    if (!helperReady()) throw new Error("Sign-in isn't available right now");
    var url = CFG.worker.replace(/\/$/, "") + path, hd = { "Content-Type": "application/json" }, H = plug("CapacitorHttp"), d; if (tok) hd["X-Liquara-Account"] = tok;
    if (H) { var r = await H.post({ url: url, headers: hd, data: body || {} }); d = typeof r.data === "string" ? (function () { try { return JSON.parse(r.data); } catch (x) { return {}; } })() : r.data || {}; if (r.status >= 400) { var e = new Error(d.error || "Sign-in failed"); e.code = d.code; throw e; } return d; }
    var res = await fetch(url, { method: "POST", headers: hd, body: JSON.stringify(body || {}) }); d = await res.json().catch(function () { return {}; }); if (!res.ok) { var e2 = new Error(d.error || "Sign-in failed"); e2.code = d.code; throw e2; } return d;
  }
  /* same stretching as the My account page, so one password works everywhere and never leaves the device */
  async function stretchPw(email, pw) {
    var k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    var b = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode("liquara-acct|" + email.trim().toLowerCase()), iterations: 150000, hash: "SHA-256" }, k, 256);
    return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }
  function licStatus() {
    var L = acc().license || {}, now = Date.now();
    if (L.status === "past_due" || L.status === "unpaid") return { kind: "due", text: "Payment due · update your card" };
    if (L.status === "trialing" && L.trialEnd) { var d = Math.max(0, Math.ceil((L.trialEnd * 1000 - now) / 864e5)); return { kind: "trial", days: d, text: "Free trial · " + d + (d === 1 ? " day" : " days") + " left" + (L.cancelAt ? " · set to cancel" : "") }; }
    if (L.cancelAt && L.cancelAt * 1000 > now) return { kind: "cancel", text: "Active until " + new Date(L.cancelAt * 1000).toLocaleDateString(langLoc(), { month: "short", day: "numeric", year: "numeric" }) };
    return { kind: "ok", text: "Active" };
  }
  function portalUrl() { var L = acc().license || {}, base = isNative() ? "https://getliquara.com/account" : "account"; return base + (L.key ? "#k=" + encodeURIComponent(L.key) + (L.email ? "&e=" + encodeURIComponent(L.email) : "") : ""); }
  function openOut(url) { var x = document.createElement("a"); x.href = url; x.target = "_blank"; x.rel = "noopener"; document.body.appendChild(x); x.click(); x.remove(); }
  function accountPanel() {
    if (WS !== "account" || !paid()) return "";
    var L = S.license || {}, st = licStatus();
    return '<div class="panel gold"><div class="eyebrow">Your account</div><div class="acctline"><div class="av">' + esc((S.company || L.email || "L").charAt(0).toUpperCase()) + '</div><div class="grow"><b>' + esc(S.company || "Your business") + '</b><div class="small mute">' + esc(L.email || "") + '</div><div class="small ' + (st.kind === "due" ? "neg" : "") + '">' + esc((PLANS[L.plan] ? PLANS[L.plan].name + " plan · " : "") + st.text) + '</div></div></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn sm" data-act="portal">Manage billing</button><button class="btn ghost sm" data-act="myaccount">My account</button><button class="btn ghost sm" data-act="signout">Sign out</button></div></div>';
  }
  function addWays() {
    return '<div class="addways"><button class="addway pri" data-act="pick"><span class="oi">' + ic("up") + '</span><b>Upload a bank file</b><em>CSV, Excel, PDF or a photo. Best results.</em></button>' +
      '<button class="addway" data-act="manual"><span class="oi">' + ic("dec") + '</span><b>Enter numbers by hand</b><em>Cash today, income and regular bills. Two minutes.</em></button>' +
      '<button class="addway" data-act="obdata"><span class="oi">' + ic("link") + '</span><b>Connect a system</b><em>Stripe, Square, accounting software or an API.</em></button></div>';
  }
  function viewNeedData() {
    var names = { forecast: "Forecast", insights: "Insights", decide: "Decision simulator", ask: "Ask", loans: "Loans & borrowing", savings: "Savings finder", alerts: "Payment alerts", budget: "Budget vs actual", actions: "Action tracker", goals: "Cash goal", fit: "Plan check" };
    return head() + '<div class="panel gold"><div class="eyebrow">' + esc(names[ST.tab] || "Your numbers") + '</div><h2>This fills in once your numbers are in</h2><p class="small mute" style="margin:6px 0 12px">Add a bank file or type in a few figures and every screen comes alive with your own data.</p>' + addWays() + "</div>" + foot();
  }
  function signOutSheet() {
    var T = accS(), own = WS === "account" ? hasOwnData() : !!(T.company || T.size), risky = own && (T.sync === false || !paid());
    sheet('<h2>Sign out of Liquara?</h2><p class="small mute">' + (risky ? (T.sync === false && paid() ? "<b>Sync is off</b>, so the numbers on this device aren't saved to your account and will be removed. Turn sync on in Settings first to keep them." : "Your numbers on this device aren't saved to an active account, so signing out removes them from this device.") : "Your company, files and settings are saved to your account. Sign in again any time with your email and license key (or password) and everything comes back.") + '</p><button class="btn pri full" data-act="signoutyes" style="margin-top:12px">Sign out</button><button class="btn ghost full" data-close style="margin-top:8px">Cancel</button>');
  }
  async function signOut(force) {
    closeSheet(); toast("Signing out…");
    if (WS === "demo") await leaveDemo();
    if (!force && syncOn() && hasOwnData() && (S.syncDirty || !S.syncRev)) {
      for (var w = 0; w < 24 && SYNC.busy; w++) await new Promise(function (r) { setTimeout(r, 250); });
      try { await Promise.race([syncPush(true), new Promise(function (r) { setTimeout(r, 9000); })]); } catch (e) { }
      if (S.syncDirty || !S.syncRev) { sheet('<h2>Your latest changes aren\'t saved yet</h2><p class="small mute">Liquara couldn\'t reach your account just now, so changes made on this device would be lost if you sign out. Check your connection and try again.</p><button class="btn pri full" data-act="signoutyes" style="margin-top:12px">Try again</button><button class="btn ghost full" data-act="signoutforce" style="margin-top:8px">Sign out anyway</button><button class="btn ghost full" data-close style="margin-top:8px">Cancel</button>'); return; }
    }
    try { if (S.license && helperReady()) await Promise.race([helper("/release", {}), new Promise(function (r) { setTimeout(r, 4000); })]); } catch (e) { }
    S = { device: S.device, lang: S.lang, theme: S.theme, helperUrl: S.helperUrl, lastEmail: (S.license && S.license.email) || S.lastEmail, v: 2 }; saveRaw();
    try { await clearSrc(); } catch (e) { }
    try { localStorage.removeItem("lq_acct"); localStorage.removeItem("ao.d"); sessionStorage.removeItem("lq_ws"); } catch (e) { }
    ST.res = null; ST.model = null; ST.sources = []; ST.qa = []; ST.tab = "home"; ST.ob = "welcome"; ST.planOnly = false; ST.gateMsg = null; SYNC.checked = false;
    render(); window.scrollTo(0, 0); toast("You're signed out");
  }

  /* ================= New customer: business setup, starter dashboard, numbers by hand ================= */
  function setupDone() { return !!(S.setupDone || (S.company && S.size && S.industry && !S.demo)); }
  function viewSetup(top) {
    var L = S.license || {};
    return top + '<div class="ob obw"><div class="eyebrow">You\'re in</div><h1>Set up your business</h1><p class="mute">One minute. This is what Liquara uses for your forecasts, benchmarks, news and lender packet.</p>' +
      '<div class="setkey"><span>Your license key</span><b data-notr>' + esc(L.key || "Active") + '</b><em>Unlocked on this device' + (L.email ? " · also emailed to " + esc(L.email) + " (check junk if you don't see it)" : "") + "</em></div>" +
      coFinder("setup") +
      '<label class="f"><span>Business name</span><input class="in" id="su_name" value="' + esc(S.company || "") + '" placeholder="e.g. Acme Bakery LLC"></label>' +
      '<label class="f"><span>EIN (optional)</span><input class="in" id="su_ein" inputmode="numeric" value="' + esc(S.ein || "") + '" placeholder="12-3456789" maxlength="10"></label>' +
      '<label class="f"><span>Kind of business</span><select class="in" id="su_ind">' + INDUSTRIES.map(function (x) { return '<option value="' + x[0] + '"' + ((S.industry || "") === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>Yearly revenue</span><select class="in" id="su_size">' + SIZES.map(function (x) { return '<option value="' + x[0] + '"' + ((S.size || "s2") === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>Where you operate (city, state)</span><input class="in" id="su_reg" value="' + esc(S.region || "") + '" placeholder="e.g. Austin, Texas"></label>' +
      '<p class="small" id="su_msg" style="min-height:20px;color:var(--red);margin:10px 0 4px"></p><button class="btn pri full" style="min-height:52px;font-size:17px" data-act="setupsave">Unlock my dashboard</button>' +
      '<p class="tiny mute" style="text-align:center;margin-top:12px">You can change any of this later in Settings.</p></div>';
  }
  function viewStarter() {
    var nm = S.company || "Your business", z = m(0);
    var flat = '<svg viewBox="0 0 320 110" class="flatfc" preserveAspectRatio="none"><line x1="0" y1="80" x2="320" y2="80" stroke="currentColor" stroke-dasharray="5 6" stroke-width="2"/><text x="160" y="50" text-anchor="middle">Your forecast appears here</text></svg>';
    var h = head() + '<div class="panel gold strt"><div class="eyebrow">Welcome</div><h2>' + esc(nm) + ', your dashboard is ready</h2><p class="small mute" style="margin:6px 0 12px">Everything shows $0 until Liquara has your numbers. Add them any of these ways:</p>' +
      '<div class="addways"><button class="addway pri" data-act="pick"><span class="oi">' + ic("up") + '</span><b>Upload a bank file</b><em>CSV, Excel, PDF or a photo. Best results.</em></button>' +
      '<button class="addway" data-act="manual"><span class="oi">' + ic("dec") + '</span><b>Enter numbers by hand</b><em>Cash today, income and regular bills. Two minutes.</em></button>' +
      '<button class="addway" data-act="obdata"><span class="oi">' + ic("link") + '</span><b>Connect a system</b><em>Stripe, Square, accounting software or an API.</em></button></div>' +
      '<p class="tiny mute" style="margin:10px 0 0">How to get a bank file: in your online banking, open the account, choose <b>Download</b> or <b>Export</b>, and pick CSV or Excel for the last 12 months.</p></div>';
    h += '<div class="bento">' + tile('<div class="hero2">' + ring(0, 60, "DAYS OF CASH") + '<div>' + lab("Are we OK?", "lime") + '<div class="answer">Add your numbers to find out.</div><div class="small mute">Liquara will compare you with ' + esc(industry()[1].toLowerCase()) + " businesses.</div></div></div>", "span2 heroT") +
      tile(lab("Cash · next 13 weeks") + '<div class="mid">' + z + ' <span class="mute small">→ ' + z + "</span></div>" + flat, "span2") +
      tile(lab("Next 14 days · surprise radar") + '<div class="calrow">' + Array.apply(null, Array(14)).map(function () { return '<i class="cz"></i>'; }).join("") + '</div><div class="small mute">No upcoming payments yet.</div>', "span2") +
      tile(lab("Alerts") + '<div class="mid">0</div><div class="small mute">Nothing to flag yet</div>') + tile(lab("Owed to you") + '<div class="mid">' + z + '</div><div class="small mute">No invoices yet</div>') +
      tile(lab("A typical month") + '<div class="mrow"><div><span>In</span><b>' + z + "</b></div><div><span>Out</span><b>" + z + "</b></div><div><span>Kept</span><b>" + z + "</b></div></div>", "span2") +
      tile(lab("Your setup") + '<div class="chk ok">✓ License active</div><div class="chk ok">✓ Business details</div><div class="chk">○ Add your numbers</div>' + (isNative() ? '<div class="chk ok">✓ Phone app installed</div>' : '<div class="chk">○ <a class="lnk" href="mobile" target="_blank" rel="noopener">Get the phone app</a></div>') + '', "span2") + "</div>";
    return h + foot();
  }
  function manualSheet() {
    var M = S.manual || { cash: "", inMonth: "", inHow: "daily", bills: [["Rent", "", "30"], ["Payroll", "", "14"], ["Utilities", "", "30"], ["Software and subscriptions", "", "30"], ["Insurance", "", "91"]] };
    var row = function (b, i) { return '<div class="mbill"><input class="in" data-mb="n' + i + '" value="' + esc(b[0]) + '" placeholder="Bill name"><input class="in" data-mb="a' + i + '" inputmode="decimal" value="' + esc(b[1]) + '" placeholder="$ amount"><select class="in" data-mb="e' + i + '">' + [["7", "Weekly"], ["14", "Every 2 weeks"], ["30", "Monthly"], ["91", "Quarterly"], ["365", "Yearly"]].map(function (o) { return '<option value="' + o[0] + '"' + (String(b[2]) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>"; };
    sheet('<h2>Enter your numbers</h2><p class="small mute">Round numbers are fine. Liquara builds an estimated history from these so your forecast works right away. Upload a bank file any time for exact results.</p>' +
      '<label class="f"><span>Cash in the bank today</span><input class="in" id="mn_cash" inputmode="decimal" value="' + esc(M.cash) + '" placeholder="e.g. 85000"></label>' +
      '<label class="f"><span>Money coming in, in a typical month</span><input class="in" id="mn_in" inputmode="decimal" value="' + esc(M.inMonth) + '" placeholder="e.g. 120000"></label>' +
      '<label class="f"><span>How it usually arrives</span><select class="in" id="mn_how"><option value="daily"' + (M.inHow === "daily" ? " selected" : "") + '>Every day (card sales, shop)</option><option value="weekly"' + (M.inHow === "weekly" ? " selected" : "") + '>Weekly deposits</option><option value="monthly"' + (M.inHow === "monthly" ? " selected" : "") + ">Monthly invoices</option></select></label>" +
      '<div class="eyebrow" style="margin-top:16px">Regular bills</div><div id="mn_bills">' + M.bills.map(row).join("") + '</div><button class="btn ghost sm" data-act="manualrow" style="margin-top:6px">+ Add a bill</button>' +
      '<p class="small" id="mn_msg" style="min-height:18px;color:var(--red);margin:10px 0 4px"></p><button class="btn pri full" data-act="manualsave">Build my dashboard</button>');
  }
  function readManual() {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }, num = function (v) { v = parseFloat(String(v).replace(/[^\d.]/g, "")); return isFinite(v) ? v : 0; };
    var bills = [], i = 0; while (document.querySelector('[data-mb="n' + i + '"]')) { var q = function (k) { return document.querySelector('[data-mb="' + k + i + '"]').value.trim(); }; bills.push([q("n"), q("a"), q("e")]); i++; }
    return { cash: g("mn_cash"), inMonth: g("mn_in"), inHow: g("mn_how"), bills: bills, _num: num };
  }
  /* turns typed figures into 6 months of estimated transactions, ending at today's cash */
  function manualCsv(M) {
    var num = M._num, cash = num(M.cash), inM = num(M.inMonth), days = 182, end = new Date(), rows = [], seed = 7;
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (var d = days; d >= 1; d--) {
      var dt = new Date(end.getTime() - d * 864e5), dow = dt.getDay(), key = dt.toISOString().slice(0, 10);
      if (inM > 0) {
        if (M.inHow === "daily" && dow !== 0) rows.push([key, inM / 26 * (0.85 + rnd() * 0.3), "Customer payments (estimated)"]);
        if (M.inHow === "weekly" && dow === 5) rows.push([key, inM * 12 / 52 * (0.9 + rnd() * 0.2), "Weekly deposit (estimated)"]);
        if (M.inHow === "monthly" && (dt.getDate() === 5 || dt.getDate() === 20)) rows.push([key, inM / 2 * (0.9 + rnd() * 0.2), "Customer invoices (estimated)"]);
      }
      M.bills.forEach(function (b) { var amt = num(b[1]), ev = +b[2] || 30; if (!amt || !b[0]) return; var hit = ev === 30 ? dt.getDate() === 1 + (b[0].length % 25) : ev === 91 ? dt.getDate() === 15 && dt.getMonth() % 3 === 0 : ev === 365 ? dt.getDate() === 15 && dt.getMonth() === 0 : (d % ev === 0); if (hit) rows.push([key, -amt, b[0] + " (estimated)"]); });
    }
    var total = rows.reduce(function (s, r) { return s + r[1]; }, 0), bal = cash - total, out = ["Date,Amount,Description,Balance"];
    rows.forEach(function (r) { bal += r[1]; out.push([r[0], r[1].toFixed(2), '"' + r[2].replace(/"/g, "") + '"', bal.toFixed(2)].join(",")); });
    return out.join("\n");
  }

  /* ---------- sector news ---------- */
  var LEVELS = { now: ["Act now", "Likely to hit your cash or operations within weeks", "lvnow"], soon: ["Plan ahead", "A clear effect in the next few months", "lvsoon"], watch: ["On the radar", "Worth knowing; could matter later", "lvwatch"] };
  function region() { return S.region || ""; }
  function sampleNews() {
    var ind = industry()[1].toLowerCase();
    return { sample: true, takeaway: "Costs are steady, borrowing is getting a little cheaper, and customers are spending carefully: a good time to lock in prices and lean on loyal regulars.", checked: new Date().toISOString(), items: [
      { level: "now", headline: "Main supplier raises delivery fees from next month", source: "Sample trade journal", date: "", summary: "Large distributors in your area are adding a fuel and delivery surcharge.", forYou: "Expect supply bills about 2-4% higher starting next month.", move: "Ask your top two suppliers for a fixed-price quote this week.", confidence: "medium" },
      { level: "now", headline: "State raises minimum wage on January 1", source: "Sample state labor office", date: "", summary: "The hourly minimum goes up, with no exemption for small employers.", forYou: "Payroll for hourly staff likely rises about 3-5% from January.", move: "Run 'What if payroll goes up 4%?' in Decide before setting next year's prices.", confidence: "high" },
      { level: "soon", headline: "Central bank signals another rate cut", source: "Sample business wire", date: "", summary: "Officials hinted borrowing costs could fall again early next year.", forYou: "A line of credit or equipment loan could get cheaper in a few months.", move: "Hold off on fixed-rate borrowing unless you need it now.", confidence: "medium" },
      { level: "soon", headline: "Shoppers trade down as holiday budgets tighten", source: "Sample national paper", date: "", summary: "Surveys show people buying fewer but cheaper items.", forYou: "Average sale size may slip a few percent through the season for a " + ind + ".", move: "Push a simple bundle or loyalty offer instead of discounting everything.", confidence: "medium" },
      { level: "watch", headline: "New payment rules for card processors under review", source: "Sample regulator release", date: "", summary: "A proposal would cap some card fees for small merchants.", forYou: "If passed, card fees could drop slightly next year.", move: "Nothing to do yet. Liquara will flag it if it moves.", confidence: "low" }
    ] };
  }
  function newsCard(n) {
    return '<div class="nwi"><div class="nwh">' + esc(n.headline) + '</div><div class="tiny dim">' + esc(n.source || "") + (n.date ? " · " + esc(n.date) : "") + (n.confidence ? " · " + esc(n.confidence) + " confidence" : "") + '</div>' +
      (n.summary ? '<p class="small">' + esc(n.summary) + "</p>" : "") +
      '<div class="nwm"><span>What it means for you</span>' + esc(n.forYou || n.means || "") + "</div>" +
      (n.move ? '<div class="nwm mv"><span>Your move</span>' + esc(n.move) + "</div>" : "") +
      (n.url ? '<a class="tiny" href="' + esc(n.url) + '" target="_blank" rel="noopener">Read the source ↗</a>' : "") + "</div>";
  }
  function viewNews() {
    var real = paid() && !S.demo, d = real ? (S.news && S.news.data) : sampleNews(), busy = ST.newsBusy;
    var h = head() + '<div class="panel gold"><div class="eyebrow">Sector news</div><h2>What the world\'s news means for your business</h2><p class="small mute" style="margin:6px 0 10px">AI reads many trusted sources, keeps only what matters to a business like yours, and says what it means in plain words.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><span class="chip">' + esc(real ? sector() : industry()[1]) + '</span><span class="chip">' + esc(region() || "Add where you operate in Settings") + "</span></div>" +
      (real ? '<button class="btn pri" style="margin-top:12px" data-act="news"' + (busy ? " disabled" : "") + ">" + (busy ? '<span class="spin"></span> Reading the news…' : d ? "Refresh" : "Get my news") + "</button>" : '<p class="note">This is a sample. Your own live news briefing unlocks with your plan.</p>') + "</div>";
    if (!d) return h + foot();
    if (d.takeaway) h += '<div class="panel nwtake"><div class="eyebrow">The big picture</div><p style="margin:0">' + esc(d.takeaway) + "</p></div>";
    ["now", "soon", "watch"].forEach(function (lv) {
      var L = (d.items || []).filter(function (x) { return (x.level || "watch") === lv; }); if (!L.length) return;
      h += '<div class="panel ' + LEVELS[lv][2] + '"><div class="lvh"><b>' + LEVELS[lv][0] + "</b><span>" + LEVELS[lv][1] + "</span></div>" + L.map(newsCard).join("") + "</div>";
    });
    h += '<p class="tiny mute" style="text-align:center">' + (d.sample ? "Sample briefing" : "Checked " + esc(new Date(d.checked).toLocaleString())) + ". News summaries are a starting point, not advice; open the source before acting.</p>";
    return h + foot();
  }
  async function getNews(fresh) {
    if (gate("Your live news briefing unlocks with your free trial.")) return;
    if (!helperReady()) { toast("Connect the Liquara helper in Settings first"); return; }
    ST.newsBusy = true; render();
    try { var r = await helper("/news", { industry: sector(), region: region() || "United States", size: (SIZES.filter(function (x) { return x[0] === S.size; })[0] || [0, ""])[1], fresh: !!fresh }); S.news = { at: Date.now(), key: industry()[0] + "|" + region(), data: r }; saveS(); }
    catch (e) { toast((e.code === "tier" || e.code === "limit") ? e.message : "Couldn't get the news: " + e.message); }
    ST.newsBusy = false; render();
  }

  /* ---------- competitors and growth ---------- */
  function sampleCompete() {
    var nm = S.demo ? DEMO.get(S.demo).name : "You";
    return { sample: true, market: "Independent and chain businesses serving the same customers in your area", position: { place: 4, of: 7, summary: "You're a solid mid-pack player: well liked, but smaller and with fewer ways to buy than the top three." },
      rank: [{ name: "Regional chain (sample)", est: "~$40M, 22 locations", strengths: "Brand, buying power, app ordering" }, { name: "Local leader (sample)", est: "~$9M, 4 locations", strengths: "Catering contracts, strong reviews" }, { name: "Fast-growing newcomer (sample)", est: "~$5M, 2 locations", strengths: "Delivery-first, heavy social media" }, { name: nm, est: "Your numbers", strengths: "Loyal regulars, quality", you: true }, { name: "Neighborhood shop (sample)", est: "~$1.5M, 1 location", strengths: "Low prices" }, { name: "Older family business (sample)", est: "~$1.2M, 1 location", strengths: "Long history; owner nearing retirement" }, { name: "Market stall (sample)", est: "under $0.5M", strengths: "Weekend markets" }],
      nextRung: { name: "Fast-growing newcomer (sample)", gap: "About 40% more sales, mostly from delivery and online orders.", closeIt: "Add online ordering and one delivery partner; most of the gap is reach, not product." },
      stepByStep: [{ step: "Turn on online ordering and one delivery app", why: "Closes the biggest gap with the next rung", timeframe: "2-4 weeks", cost: "low" }, { step: "Win 3 office or event catering accounts", why: "Big, repeat orders smooth cash flow", timeframe: "1-3 months", cost: "low" }, { step: "Raise prices 3% on best sellers", why: "Costs are rising; regulars rarely notice small moves", timeframe: "now", cost: "low" }, { step: "Ask every happy customer for a review", why: "Reviews decide local rankings", timeframe: "ongoing", cost: "low" }],
      bigLeap: [{ move: "Open a second location in a busy area", why: "Could double sales and pass two rivals", risk: "Ties up cash for 12-18 months", cost: "high" }, { move: "Wholesale to grocers and cafés", why: "New revenue without new storefronts", risk: "Thinner margins, bigger orders to fund", cost: "medium" }],
      buy: { sameField: [{ target: "The older family business whose owner is retiring", why: "Instant second location, existing customers, staff already trained", price: "typically 2-3x yearly profit", pay: "Seller financing plus a small bank or SBA loan", risk: "Customers may leave with the owner; keep them involved for a few months" }],
        newFields: [{ field: "Catering and event services", why: "Same kitchen, same suppliers, bigger orders", entry: "Buy a small caterer or start in-house", price: "typically 2-4x yearly profit", risk: "Seasonal; needs a deposit policy" }, { field: "Packaged goods for local grocers", why: "Sells your best products through other people's shelves", entry: "Partner first, buy later", price: "varies", risk: "Labeling and food-safety rules" }],
        ready: "Possible in about a year: build three months of cash cushion, get two years of clean books, and talk to a lender before approaching a seller." },
      tools: [{ name: "Online ordering system", what: "Takes orders and payments online", fit: "Closes the delivery gap", price: "from about $50/month" }, { name: "AI review responder", what: "Drafts replies to reviews in your voice", fit: "More and better reviews, less time", price: "from about $20/month" }, { name: "AI social post scheduler", what: "Plans a month of posts in an hour", fit: "Matches the newcomer's social reach", price: "from about $15/month" }],
      liquara: ["Use Decide to test a second location: rent, staff and ramp-up time against your cash.", "Set a cash goal in Liquara for the down payment on an acquisition.", "Run the Savings finder before you expand so you grow on a lean cost base.", "Send the lender packet when you're ready to borrow."] };
  }
  function costTag(c) { c = String(c || "").toLowerCase(); return c ? '<span class="ctag c' + (c.indexOf("high") >= 0 ? "h" : c.indexOf("med") >= 0 ? "m" : "l") + '">' + esc(c) + " cost</span>" : ""; }
  function viewCompete() {
    var real = paid() && !S.demo, d = real ? S.compete : sampleCompete(), busy = ST.compBusy, sec = ST.compSec || "climb";
    var h = head() + '<div class="panel gold"><div class="eyebrow">Competitors & growth</div><h2>Where you stand, and how to climb</h2><p class="small mute" style="margin:6px 0 10px">AI maps the real businesses competing for your customers, ranks them, and builds a plan to move up: step by step, with a big leap, or by buying.</p>' +
      (real ? '<label class="f"><span>What you sell and who buys it (optional, makes it sharper)</span><textarea class="in" id="cnotes" placeholder="e.g. Artisan bakery, wholesale to 6 cafés, catering for offices">' + esc(S.compNotes || "") + '</textarea></label><button class="btn pri" style="margin-top:10px" data-act="compete"' + (busy ? " disabled" : "") + ">" + (busy ? '<span class="spin"></span> Mapping your market…' : d ? "Rebuild my report" : "Build my report") + "</button>" : '<p class="note">This is a sample. Your own live report unlocks with your plan.</p>') + "</div>";
    if (!d) return h + foot();
    var P = d.position || {};
    h += '<div class="panel cpos"><div class="cbig"><span>#' + esc(P.place || "?") + '</span><em>of ' + esc(P.of || (d.rank || []).length) + "</em></div><div><div class=\"eyebrow\">Your position</div><p class=\"small\" style=\"margin:0\">" + esc(P.summary || "") + "</p><p class=\"tiny mute\" style=\"margin:6px 0 0\">" + esc(d.market || "") + "</p></div></div>";
    h += '<div class="panel"><div class="eyebrow">The ladder</div><ol class="ladder">' + (d.rank || []).map(function (r, i) { return '<li class="' + (r.you ? "you" : "") + '"><span class="lr">' + (i + 1) + '</span><div class="grow"><b>' + esc(r.name) + (r.you ? " · you" : "") + '</b><div class="tiny mute">' + esc(r.est || "") + (r.strengths ? " · " + esc(r.strengths) : "") + "</div></div>" + (r.url ? '<a class="tiny" href="' + esc(r.url) + '" target="_blank" rel="noopener">↗</a>' : "") + "</li>"; }).join("") + "</ol>" +
      (d.nextRung && d.nextRung.name ? '<div class="nwm mv"><span>Next rung: ' + esc(d.nextRung.name) + "</span>" + esc(d.nextRung.gap || "") + (d.nextRung.closeIt ? "<br><b>Close it:</b> " + esc(d.nextRung.closeIt) : "") + "</div>" : "") + "</div>";
    var tabs = [["climb", "Step by step"], ["leap", "Big leap"], ["buy", "Grow by buying"], ["tools", "Tools"]];
    h += '<div class="seg" style="margin-bottom:12px">' + tabs.map(function (t) { return '<button data-act="csec" data-s="' + t[0] + '" class="' + (sec === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div><div class=\"panel\">";
    if (sec === "climb") h += '<div class="eyebrow">Climb one rung at a time</div>' + (d.stepByStep || []).map(function (s, i) { return '<div class="gstep"><span class="gn">' + (i + 1) + '</span><div class="grow"><b>' + esc(s.step) + '</b><div class="tiny mute">' + esc(s.why || "") + (s.timeframe ? " · " + esc(s.timeframe) : "") + "</div></div>" + costTag(s.cost) + "</div>"; }).join("");
    if (sec === "leap") h += '<div class="eyebrow">Jump several places</div>' + (d.bigLeap || []).map(function (s) { return '<div class="gstep"><div class="grow"><b>' + esc(s.move) + '</b><div class="small">' + esc(s.why || "") + '</div><div class="tiny warn">Risk: ' + esc(s.risk || "") + "</div></div>" + costTag(s.cost) + "</div>"; }).join("") + '<button class="btn ghost full" style="margin-top:8px" data-act="lgo2" data-to="decide">Test a big move against your cash</button>';
    if (sec === "buy") { var B = d.buy || {};
      h += '<div class="eyebrow">Buy within your field</div>' + (B.sameField || []).map(function (s) { return '<div class="gstep"><div class="grow"><b>' + esc(s.target) + '</b><div class="small">' + esc(s.why || "") + '</div><div class="tiny mute">Typical price: ' + esc(s.price || "varies") + " · How it's paid for: " + esc(s.pay || "") + '</div><div class="tiny warn">Risk: ' + esc(s.risk || "") + "</div></div></div>"; }).join("") +
        '<div class="eyebrow" style="margin-top:14px">Expand into a new field</div>' + (B.newFields || []).map(function (s) { return '<div class="gstep"><div class="grow"><b>' + esc(s.field) + '</b><div class="small">' + esc(s.why || "") + '</div><div class="tiny mute">How to enter: ' + esc(s.entry || "") + " · Typical price: " + esc(s.price || "varies") + '</div><div class="tiny warn">Risk: ' + esc(s.risk || "") + "</div></div></div>"; }).join("") +
        (B.ready ? '<div class="nwm mv"><span>Are you ready to buy?</span>' + esc(B.ready) + "</div>" : "") + '<button class="btn ghost full" style="margin-top:8px" data-act="lgo2" data-to="decide">Can I afford it? Test it in Decide</button><p class="tiny mute">Prices are typical ranges, not quotes. Talk to a business broker, lender and accountant before making an offer.</p>'; }
    if (sec === "tools") h += '<div class="eyebrow">Tools to speed it up</div>' + (d.tools || []).map(function (s) { return '<div class="gstep"><div class="grow"><b>' + esc(s.name) + '</b><div class="small">' + esc(s.what || "") + (s.fit ? " · " + esc(s.fit) : "") + '</div><div class="tiny mute">' + esc(s.price || "") + (s.url ? ' · <a href="' + esc(s.url) + '" target="_blank" rel="noopener">site ↗</a>' : "") + "</div></div></div>"; }).join("") +
      ((d.liquara || []).length ? '<div class="eyebrow" style="margin-top:14px">How Liquara helps</div>' + d.liquara.map(function (x) { return '<div class="gstep"><span class="gn">' + HEART_SM + '</span><div class="grow small">' + esc(x) + "</div></div>"; }).join("") : "");
    h += "</div>";
    h += '<p class="tiny mute" style="text-align:center">' + (d.sample ? "Sample report with made-up businesses" : "Built " + esc(new Date(d.checked).toLocaleString()) + ". Sizes are estimates from public sources") + ". Not financial or legal advice.</p>";
    return h + foot();
  }
  var HEART_SM = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="#c8ff4d" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  async function getCompete() {
    if (gate("Your competitor report unlocks with your free trial.")) return;
    if (!helperReady()) { toast("Connect the Liquara helper in Settings first"); return; }
    var nt = document.getElementById("cnotes"); if (nt) S.compNotes = nt.value.trim();
    ST.compBusy = true; render();
    try { var r = await helper("/compete", { industry: sector(), region: region() || "United States", revenue: coRev() || dataRev() || sizeRev() || undefined, name: S.company || "", ticker: S.co && S.co.tickers && S.co.tickers[0] || "", notes: S.compNotes || "" }); S.compete = r; ST.compSec = "climb"; saveS(); }
    catch (e) { toast((e.code === "tier" || e.code === "limit") ? e.message : "Couldn't build the report: " + e.message); }
    ST.compBusy = false; render();
  }
  async function findSavings(i) {
    var r = ST.savingsList[i]; if (!r) return;
    if (!helperReady()) { toast("Connect the Liquara helper in Settings to run live price checks"); return; }
    toast("Checking prices for " + r.vendor + "…");
    try { var res = await helper("/savings", { vendor: r.vendor, category: r.cat, monthly: Math.round(r.monthly), currency: S.ccy || "USD", industry: industry()[1], size: (SIZES.filter(function (x) { return x[0] === S.size; })[0] || [0, ""])[1] }); S.savings = S.savings || {}; S.savings[r.vendor] = res; saveS(); render(); }
    catch (e) { toast("Couldn't check: " + e.message); }
  }

  /* ---------- plans, trial and in-app checkout ---------- */
  function viewPlans() {
    var per = ST.per || "month", rec = planFor(), t = null;
    if (!paid() && S.licMsg && !ST.gateMsg) ST.gateMsg = S.licMsg;
    var gm = !paid() && ST.gateMsg ? '<div class="panel" style="border-color:rgba(200,255,77,.5)"><b>' + esc(ST.gateMsg) + '</b><p class="small mute" style="margin:6px 0 0">Until then you can explore the sample company as much as you like.</p><button class="btn ghost sm" data-act="backdemo" style="margin-top:10px">Back to the sample</button></div>' : "";
    var PL = acc().license || {}, cur = paid() ? PL.plan || "owner" : "", pst = paid() ? licStatus() : null;
    var h = head() + gm + '<div class="panel gold"><div class="eyebrow">Plans</div><h2>' + (paid() ? (pst.kind === "trial" ? "You're on your free trial" : pst.kind === "due" ? "Your payment needs attention" : "You're subscribed") : t != null ? (t ? t + " days left in your trial" : "Your free trial has ended") : "Start your " + TRIAL_DAYS + "-day free trial") + '</h2><p class="small mute" style="margin:6px 0 0">' + (paid() ? "You're on the " + esc((PLANS[cur] || PLANS.owner).name) + " plan · " + esc(pst.text) + ". Manage your card or cancel below." : "Your card is saved securely by Stripe and charged when the trial ends. Cancel any time in the app.") + '</p></div><div class="seg" style="margin-bottom:12px">' + Object.keys(PERIODS).map(function (k) { return '<button data-per="' + k + '" class="' + (per === k ? "on" : "") + '">' + PERIODS[k][0] + (PERIODS[k][2] < 1 ? " · save " + Math.round((1 - PERIODS[k][2]) * 100) + "%" : "") + "</button>"; }).join("") + '</div><div class="plans">';
    h += Object.keys(PLANS).map(function (k) { var p = PLANS[k], price = priceOf(k, per); return '<div class="panel plan ' + (k === rec ? "rec" : "") + '">' + (k === rec ? '<span class="badge g">Fits your size</span>' : "") + "<h3>" + p.name + '</h3><div class="small mute">' + p.who + '</div><div class="price">' + m(price).replace(/\.0K/, "K") + '<span>/' + ({ month: "month", quarter: "quarter", year: "year" })[per] + '</span></div><ul class="small"><li>All three views, forecasting and alerts</li><li>' + p.checks + " AI savings checks a month</li><li>" + (k === "owner" ? "1 company" : k === "business" ? "Up to 5 companies, budget vs actual" : "Unlimited companies, currencies, bank files, priority help") + '</li></ul><button class="btn ' + (paid() ? (trank(k) > trank(cur) ? "pri" : "ghost") : k === rec ? "pri" : "") + ' full" ' + (!paid() ? 'data-buy="' + k + '"' : k === cur ? "disabled" : trank(k) > trank(cur) ? 'data-act="upgrade" data-plan="' + k + '"' : 'data-act="planhelp" data-plan="' + k + '"') + '>' + (!paid() ? "Start free trial" : k === cur ? "Your plan" : trank(k) > trank(cur) ? "Upgrade to " + p.name : "Talk to us about " + p.name) + '</button><div class="cobox" id="co-' + k + '"></div></div>'; }).join("");
    h += '</div>' + (paid() ? '<button class="btn ghost" data-act="portal">Update card or cancel</button>' : "") + (paid() && PL.key ? '<div class="panel"><div class="eyebrow">Your license key</div><div class="between"><b style="font-size:18px;letter-spacing:.06em" data-notr>' + esc(PL.key) + '</b><button class="btn ghost sm" data-act="copykey">Copy</button></div><p class="small mute" style="margin:8px 0 0">Use it to unlock Liquara on your other devices.' + (PL.email ? " We also emailed it to " + esc(PL.email) + "." : "") + "</p></div>" : '<div class="panel"><div class="eyebrow">Have a license key?</div><div class="row" style="gap:8px"><input class="in" id="lic" placeholder="LQ-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" data-notr><button class="btn" data-act="lic">Unlock</button></div><p class="small mute" style="margin:8px 0 0">It\'s in the email we sent when your trial started.</p></div>');
    return h + foot();
  }
  function loadStripe() { return new Promise(function (ok, no) { if (window.Stripe) return ok(); var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/"; s.onload = ok; s.onerror = function () { no(new Error("Couldn't load the secure payment form")); }; document.head.appendChild(s); }); }
  async function buy(plan) {
    var per = ST.per || "month", box = document.getElementById("co-" + plan) || document.getElementById("checkout");
    document.querySelectorAll(".cobox").forEach(function (b) { if (b !== box) b.innerHTML = ""; });
    if (!helperReady() || !CFG.stripePk) { box.innerHTML = '<div class="panel note">Payments aren\'t switched on yet. Once the Stripe and helper setup is done, the secure card form opens right here.</div>'; box.scrollIntoView({ behavior: "smooth" }); return; }
    box.innerHTML = '<div class="panel"><span class="spin"></span></div>'; box.scrollIntoView({ behavior: "smooth" });
    try {
      await loadStripe(); S.device = S.device || uid() + uid(); saveS();
      var r = await helper("/checkout", { plan: plan, period: per, trialDays: TRIAL_DAYS, device: S.device, email: S.email || "" });
      var stripe = window.Stripe(CFG.stripePk); box.innerHTML = '<div class="panel" id="ckmount"></div>';
      var co = await stripe.initEmbeddedCheckout({ clientSecret: r.clientSecret, onComplete: async function () { try { var L = await helper("/license", { session: r.session, device: S.device }); co.destroy();
            var carry = WS === "demo" ? { size: S.size, industry: S.industry } : null; if (WS === "demo") await leaveDemo();
            if (carry) { if (!S.size && carry.size) S.size = carry.size; if (!S.industry && carry.industry) S.industry = carry.industry; }
            S.owner = ownerOf(L.key, L.email); await setLicense(L.code, L); ST.gateMsg = null; ST.planOnly = false; delete S.demo; if (!(S.company && S.size && S.industry)) S.setupDone = false; ST.res = null; ST.model = null; ST.ob = null; ST.tab = "home"; saveRaw(); render(); window.scrollTo(0, 0); toast("Welcome to Liquara " + PLANS[plan].name + (L.emailed && L.email ? ". Your license key was emailed to " + L.email + " (check junk if you don't see it)" : "")); } catch (e) { toast("Paid, but unlocking failed: " + e.message + ". Use 'Have a license code?'"); } } });
      co.mount("#ckmount");
    } catch (e) { box.innerHTML = '<div class="panel note">' + esc(e.message) + "</div>"; }
  }
  /* license codes: LQ1.<payload>.<signature>, verified with the public key in license-pub.js */
  /* the public half of the signing key comes from license-pub.js, or straight from the helper if that file is empty (kept in memory only) */
  var PUBK = null;
  async function serverPub() {
    if (PUBK) return PUBK; if (!helperReady()) return null;
    try { var u = CFG.worker.replace(/\/$/, "") + "/", H = plug("CapacitorHttp"), j;
      if (H) { var r = await H.get({ url: u }); j = typeof r.data === "string" ? JSON.parse(r.data) : r.data; } else { j = await (await fetch(u)).json(); }
      if (j && j.pub && j.pub.x) PUBK = j.pub; } catch (e) { }
    return PUBK;
  }
  async function setLicense(code, info) {
    var P = window.LQ_LICENSE_PUB;
    if (!P || !P.x) P = await serverPub();
    if (!P) throw new Error("Couldn't reach Liquara to check your license. Check your connection and try again.");
    var parts = String(code).trim().split("."); if (parts.length !== 3 || parts[0] !== "LQ1") throw new Error("That isn't a Liquara code");
    var dec = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
    var key = await crypto.subtle.importKey("jwk", P, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    var ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, dec(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!ok && P !== PUBK) { var P2 = await serverPub(); if (P2 && P2.x !== P.x) { var k2 = await crypto.subtle.importKey("jwk", P2, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k2, dec(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1])); } }
    if (!ok) throw new Error("That code isn't valid");
    var p = JSON.parse(new TextDecoder().decode(dec(parts[1])));
    if (p.e && p.e < Date.now()) throw new Error("That code has expired");
    var T = accS(), old = T.license || {};
    if (old.key && p.l && old.key !== p.l) old = {};
    T.license = { code: code.trim(), plan: p.p, until: p.e || 8.64e15, firm: p.f, key: (info && info.key) || p.l || old.key || "", email: (info && info.email) || old.email || "", needs: info && info.needs !== undefined ? info.needs : old.needs || "", status: (info && info.status) || old.status || "", trialEnd: info && info.trialEnd !== undefined ? info.trialEnd : old.trialEnd || null, periodEnd: (info && info.periodEnd) || old.periodEnd || null, cancelAt: info && info.cancelAt !== undefined ? info.cancelAt : old.cancelAt || null, checked: Date.now() };
    if (!T.owner) T.owner = ownerOf(T.license.key, T.license.email); else if (T.license.email && T.owner === T.license.key) T.owner = ownerOf(T.license.key, T.license.email);
    delete T.licMsg; saveAcc();
  }
  /* another customer's numbers must never carry over: if this device holds someone else's data, clear it before signing in */
  async function adoptOwner(key, email) {
    var who = ownerOf(key, email), prev = S.owner || "";
    if (prev && prev !== who && prev !== key && prev !== String(email || "").trim().toLowerCase()) {
      var keep = {}; ["license", "device", "lang", "theme", "helperUrl", "lastEmail", "v"].forEach(function (k) { if (S[k] !== undefined) keep[k] = S[k]; });
      S = keep; saveRaw(); try { await clearSrc(); } catch (e) { }
      ST.sources = []; ST.res = null; ST.model = null; ST.qa = []; SYNC.checked = false;
    }
    S.owner = who; saveRaw();
  }
  /* the server decides: renew on launch and every few hours; lock if it says no */
  async function renewNow(force) {
    var T = accS(); if (!T.license || !helperReady()) return;
    if (!force && T.license.checked && Date.now() - T.license.checked < 6 * 3600e3 && T.license.until - Date.now() > 864e5) return;
    var inAcct = WS === "account" && !S.demo; /* the sample company's numbers never count toward the plan check */
    try { var r = await helper("/renew", { device: T.device || S.device, rev: inAcct ? fitRev() : undefined, cik: inAcct && S.co && S.co.cik ? S.co.cik : undefined }); await setLicense(r.code, r);
      T = accS(); if (r.name && !T.company) { T.company = r.name; }
      if (T.license) T.license.needs = r.needs || ""; saveAcc();
      if (WS === "account" && r.syncRev && r.syncRev > (S.syncRev || 0)) syncPull(false); }
    catch (e) { if (e.code === "revoked" || e.code === "inactive" || e.code === "invalid" || e.code === "devices") { T = accS(); T.licMsg = e.message; delete T.license; saveAcc(); ST.gateMsg = e.message; render(); } }
  }
  async function activateKey(v) {
    v = String(v || "").trim(); if (!v) throw new Error("Paste your license key");
    if (WS === "demo") await leaveDemo();
    if (/^LQ1\./.test(v)) { await setLicense(v); await adoptOwner(S.license.key, S.license.email); await renewNow(true); if (!S.license) throw new Error(S.licMsg || "That license isn't active"); return; }
    if (!helperReady()) throw new Error("The Liquara helper isn't set up yet");
    var r = await helper("/activate", { key: v, device: S.device });
    await adoptOwner(r.key, r.email); await setLicense(r.code, r);
    if (r.name && !S.company) { S.company = r.name; saveRaw(); }
    var got = await syncPull(false);
    if (!got && !ST.res && !S.size) toast("License active. Set up your company to start.");
  }

  /* ---------- PIN lock ---------- */
  async function sha(s) { var b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
  var unlocked = false;
  function viewLock() { return '<div class="ob" style="text-align:center"><div class="obtop" style="justify-content:center">' + HEART + "<b>Liquara</b></div><h2>Enter your PIN</h2><input class=\"in pin\" id=\"pinin\" type=\"password\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"off\"><button class=\"btn pri full\" style=\"margin-top:12px\" data-act=\"unlock\">Unlock</button><button class=\"btn ghost full\" style=\"margin-top:8px\" data-act=\"forgotpin\">Forgot PIN</button></div>"; }

  /* ---------- Monday brief ---------- */
  async function scheduleBrief() {
    var LN = plug("LocalNotifications"); if (!LN) return false;
    try { await LN.requestPermissions(); await LN.cancel({ notifications: [{ id: 101 }] }); if (!S.brief || !ST.res) return true;
      var FC = ST.res.forecast, al = E.anomalies(ST.model).length, body = "Cash " + m(FC.start) + ". Likely " + m(FC.days[91].p50) + " in 13 weeks." + (al ? " " + al + " alert" + (al > 1 ? "s" : "") + " to check." : "");
      await LN.schedule({ notifications: [{ id: 101, title: "Your Monday cash brief", body: body, schedule: { on: { weekday: 2, hour: 8, minute: 0 }, allowWhileIdle: true } }] }); return true; } catch (e) { return false; }
  }

  /* ---------- Excel export ---------- */
  async function exportXlsx() {
    var Z = new window.JSZip(), FC = ST.res.forecast, x = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
    function sheet(rows) { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map(function (r, i) { return '<row r="' + (i + 1) + '">' + r.map(function (c) { return typeof c === "number" ? "<c><v>" + Math.round(c * 100) / 100 + "</v></c>" : '<c t="inlineStr"><is><t>' + x(c) + "</t></is></c>"; }).join("") + "</row>"; }).join("") + "</sheetData></worksheet>"; }
    var ccy = S.ccy || "USD", w = [["Week ending", "Low (" + ccy + ")", "Likely", "High"]].concat(FC.weeks.slice(0, 13).map(function (r) { return [E.iso(E.fromKey(r.k)), r.p10, r.p50, r.p90]; }));
    var mo = [["Month end", "Low (" + ccy + ")", "Likely", "High"]].concat(FC.months.map(function (r) { return [E.iso(E.fromKey(r.k)), r.p10, r.p50, r.p90]; }));
    var fl = [["Week ending", "Money in", "Money out", "Net"]].concat(E.weeklyFlows(ST.model, 13).map(function (r) { return [E.iso(E.fromKey(r.k)), r.in, r.out, r.in - r.out]; }));
    var pw = [["Week ending", "Money in", "Money out", "Net", "Ending cash"]].concat(E.pastWeeks(ST.model, 13).map(function (r) { return [E.iso(E.fromKey(r.k)), r.in, r.out, r.in - r.out, r.close]; }));
    var hist = {}; ST.model.tx.forEach(function (t) { var k = monthKey(t.d), a = hist[k] = hist[k] || [0, 0]; if (t.a > 0) a[0] += t.a; else a[1] -= t.a; });
    var hs = [["Month", "Money in", "Money out", "Net"]].concat(Object.keys(hist).sort().map(function (k) { return [k, hist[k][0], hist[k][1], hist[k][0] - hist[k][1]]; }));
    var names = ["Last 13 weeks", "13-week forecast", "12-month forecast", "13-week flows", "History by month"], sheets = [pw, w, mo, fl, hs];
    Z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>");
    Z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    Z.file("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map(function (n, i) { return '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets></workbook>");
    Z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") + "</Relationships>");
    sheets.forEach(function (s, i) { Z.file("xl/worksheets/sheet" + (i + 1) + ".xml", sheet(s)); });
    var bytes = await Z.generateAsync({ type: "uint8array" });
    await deliver(bytes, companyName().replace(/[^A-Za-z0-9]+/g, "-") + "-liquara-forecast.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  async function deliver(bytes, name, mime) {
    var FS = plug("Filesystem"), SH = plug("Share");
    if (FS && SH) { try { var w = await FS.writeFile({ path: name, data: b64of(bytes), directory: "CACHE" }); await SH.share({ title: name, files: [w.uri] }); return; } catch (e) { if (!/cancel/i.test(e.message || "")) toast("Share failed: " + (e.message || e)); return; } }
    var u = URL.createObjectURL(new Blob([bytes], { type: mime })), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); toast("Downloaded " + name);
  }

  /* ---------- adjust / why / present ---------- */
  function adjustSheet() { var a = S.adj || {}; sheet('<div class="between"><h2>Adjust the forecast</h2><button class="ib" data-close>' + ic("x") + '</button></div><p class="small mute">You know things the data doesn\'t. Nudge it and every screen updates.</p><div class="slider"><div class="between"><span class="small">Money coming in</span><b id="ail">' + (a.inPct || 0) + '%</b></div><input type="range" min="-30" max="30" step="1" id="ai" value="' + (a.inPct || 0) + '"></div><div class="slider"><div class="between"><span class="small">Money going out</span><b id="aol">' + (a.outPct || 0) + '%</b></div><input type="range" min="-30" max="30" step="1" id="ao" value="' + (a.outPct || 0) + '"></div><div class="row" style="gap:8px;margin-top:12px"><button class="btn pri" data-act="saveadj">Apply</button><button class="btn ghost" data-act="clearadj">Reset</button></div>'); ["ai", "ao"].forEach(function (id) { var el = document.getElementById(id); el.oninput = function () { document.getElementById(id + "l").textContent = el.value + "%"; }; }); }
  function whySheet() {
    var F = ST.res.fit, FC = ST.res.forecast, cal = E.calendar(ST.model, 91), rin = 0, rout = 0, ar = 0, ap = 0, typ = 0;
    cal.forEach(function (d) { d.items.forEach(function (it) { if (it.kind === "Customer payment") ar += it.amount; else if (it.kind === "Supplier bill") ap += it.amount; else if (it.amount > 0) rin += it.amount; else rout += it.amount; }); });
    var tot = cal.reduce(function (s, d) { return s + d.in - d.out; }, 0); typ = tot - rin - rout - ar - ap;
    sheet('<div class="between"><h2>Why ' + m(FC.days[91].p50) + "?</h2><button class=\"ib\" data-close>" + ic("x") + '</button></div><table class="t"><tr><td>Cash today</td><td>' + m(FC.start) + "</td></tr><tr><td>Repeating payments in (" + F.rec.filter(function (r) { return r.dir === "+"; }).length + ")</td><td class=\"pos\">+" + m(rin) + "</td></tr><tr><td>Repeating payments out (" + F.rec.filter(function (r) { return r.dir === "-"; }).length + ")</td><td class=\"neg\">" + m(rout) + "</td></tr><tr><td>Open invoices, by each customer's habits</td><td class=\"pos\">+" + m(ar) + "</td></tr><tr><td>Open bills, by your habits</td><td class=\"neg\">" + m(ap) + "</td></tr><tr><td>Everything else, from your weekly pattern</td><td>" + (typ >= 0 ? "+" : "") + m(typ) + '</td></tr><tr><td><b>Expected in 13 weeks</b></td><td><b>' + m(FC.start + tot) + '</b></td></tr></table><p class="note">The headline uses the middle of ' + FC.sims + " simulated futures, so it can differ slightly from this simple sum. The range is widened by the forecast's own past errors.</p>");
  }
  function presentMode() {
    var A = ST.res.analysis, FC = ST.res.forecast, slides = [
      ["Cash position", m(FC.start), "Likely " + m(FC.days[91].p50) + " in 13 weeks (" + m(FC.days[91].p10) + "–" + m(FC.days[91].p90) + ")"],
      ["Risk of running short", FC.pShortYear < 0.01 ? "<1%" : pc(FC.pShortYear), "Chance cash goes below zero in the next 12 months"],
      ["Top decision", A.opportunities[0] ? m(A.opportunities[0].value) : "–", A.opportunities[0] ? A.opportunities[0].title : ""],
      ["Forecast quality", ST.model.bt ? pc(ST.model.bt.accuracy) : "–", "Accuracy when tested on this company's own history"]];
    var i = 0, ov = document.createElement("div"); ov.className = "present";
    function draw() { var s = slides[i]; ov.innerHTML = '<div class="pslide"><div class="obtop">' + HEART + "<b>Liquara · " + esc(companyName()) + '</b></div><div class="eyebrow">' + s[0] + '</div><div class="pbig">' + s[1] + '</div><div class="psub">' + esc(s[2]) + '</div><div class="pnav">' + (i + 1) + " / " + slides.length + " · tap to continue · Esc to close</div></div>"; }
    ov.onclick = function () { i++; if (i >= slides.length) ov.remove(); else draw(); }; document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", k); } }); draw(); document.body.appendChild(ov);
    if (ov.requestFullscreen) ov.requestFullscreen().catch(function () { });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-tab],[data-act],[data-go],[data-ins],[data-hz],[data-q],[data-pre],[data-menu],[data-preset],[data-del],[data-delc],[data-size],[data-ind],[data-ob],[data-lens],[data-track],[data-save],[data-cdel],[data-per],[data-buy],[data-adone],[data-adel],[data-scn],[data-scndel]"); if (!t) return;
    var d = t.dataset;
    if (d.size) { S.size = d.size; saveS(); ST.ob = "industry"; render(); return; }
    if (d.ind) { S.industry = d.ind; saveS(); ST.ob = "start"; render(); return; }
    if (d.ob) { if (d.ob === "size") enterDemo(); else if ((d.ob === "welcome" || d.ob === "signin") && WS === "demo") await leaveDemo(); ST.ob = d.ob; render(); window.scrollTo(0, 0); return; }
    if (d.lens) { S.lens = d.lens; saveS(); render(); return; }
    if (d.track) { trackOpp(+d.track); return; }
    if (d.save) { if (gate("AI savings checks are part of your free trial. Start it to check real prices.")) return; findSavings(+d.save); return; }
    if (d.cdel) { S.costs = (S.costs || []).filter(function (c) { return c.id !== d.cdel; }); saveS(); await analyze(); render(); return; }
    if (d.per) { ST.per = d.per; render(); return; }
    if (d.buy) { buy(d.buy); return; }
    if (d.adone) { (S.actions || []).forEach(function (a) { if (a.id === d.adone) a.status = a.status === "done" ? "open" : "done"; }); saveS(); render(); return; }
    if (d.adel) { S.actions = (S.actions || []).filter(function (a) { return a.id !== d.adel; }); saveS(); render(); return; }
    if (d.scn) { ST.sc = Object.assign(defSc(), S.scenarios[+d.scn].sc); go("decide"); return; }
    if (d.scndel) { S.scenarios.splice(+d.scndel, 1); saveS(); render(); return; }
    var A_ = d.act;
    if (A_ === "install") { if (!INSTALL) return; INSTALL.prompt(); try { await INSTALL.userChoice; } catch (er) { } INSTALL = null; render(); return; }
    if (A_ === "setupsave") {
      var gv = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }, sm = document.getElementById("su_msg");
      var nm = gv("su_name"), ein = gv("su_ein").replace(/[^\d]/g, "");
      if (!nm) { if (sm) sm.textContent = "Add your business name."; return; }
      if (ein && ein.length !== 9) { if (sm) sm.textContent = "An EIN has 9 digits, like 12-3456789. Or leave it blank."; return; }
      S.company = nm; S.ein = ein ? ein.slice(0, 2) + "-" + ein.slice(2) : undefined; S.industry = gv("su_ind") || "other"; S.size = gv("su_size") || "s2"; S.region = gv("su_reg") || S.region; S.setupDone = true; delete S.demo; saveS();
      ST.ob = null; ST.tab = "home"; render(); window.scrollTo(0, 0); toast("Your dashboard is unlocked"); return;
    }
    if (A_ === "manual") { if (WS === "demo") { if (!paid()) { gate("Your own numbers unlock with your free trial."); return; } await leaveDemo(); } manualSheet(); return; }
    if (A_ === "manualrow") { var box = document.getElementById("mn_bills"), n = box.querySelectorAll(".mbill").length, cur = readManual(); cur.bills.push(["", "", "30"]); delete cur._num; S.manual = cur; saveRaw(); manualSheet(); return; }
    if (A_ === "manualsave") {
      var Mv = readManual(), mm = document.getElementById("mn_msg");
      if (!(Mv._num(Mv.inMonth) > 0) && !Mv.bills.some(function (b) { return Mv._num(b[1]) > 0; })) { if (mm) mm.textContent = "Add your monthly income or at least one bill."; return; }
      var csv = manualCsv(Mv), keep = { cash: Mv.cash, inMonth: Mv.inMonth, inHow: Mv.inHow, bills: Mv.bills }; S.manual = keep; saveS();
      await putSrc({ id: "manual", name: "Typed-in figures (estimated).csv", type: "csv", data: csv, origin: "manual", added: Date.now() });
      ST.sources = await allSrc(); closeSheet(); await analyze(); ST.tab = "home"; render(); window.scrollTo(0, 0);
      toast(ST.res ? "Your dashboard is built from your typed figures" : "Saved. Add a bank file for a full forecast"); return;
    }
    if (A_ === "exitdemo") { closeSheet(); await leaveDemo(); if (!paid()) ST.ob = "welcome"; try { history.pushState({ tab: ST.tab }, ""); } catch (er) { } render(); window.scrollTo(0, 0); if (paid()) toast("Back in your account"); return; }
    if (A_ === "exploredemo") { closeSheet(); enterDemo(); if (S.demo) { await analyze(); ST.ob = null; } else ST.ob = "size"; try { history.pushState({ tab: ST.tab }, ""); } catch (er) { } render(); window.scrollTo(0, 0); return; }
    if (A_ === "signinnow") { closeSheet(); if (WS === "demo") await leaveDemo(); ST.ob = "signin"; render(); window.scrollTo(0, 0); return; }
    if (A_ === "signout") { closeSheet(); signOutSheet(); return; }
    if (A_ === "signoutyes") { await signOut(false); return; }
    if (A_ === "signoutforce") { await signOut(true); return; }
    if (A_ === "myaccount") { closeSheet(); openOut(portalUrl()); return; }
    if (A_ === "help") { closeSheet(); var hl = acc().license || {}; location.href = "mailto:support@getliquara.com?subject=" + encodeURIComponent("Help with Liquara") + "&body=" + encodeURIComponent("\n\n---\nCompany: " + (acc().company || "") + "\nLicense: " + (hl.key || "none") + "\nApp: " + (isNative() ? "Android" : "web")); return; }
    if (A_ === "tplans") { go("plans"); return; }
    if (A_ === "plandemo") { ST.planOnly = false; enterDemo(); if (S.demo) { await analyze(); ST.ob = null; } else ST.ob = "size"; render(); window.scrollTo(0, 0); return; }
    if (A_ === "obtrial") { closeSheet(); ST.planOnly = true; try { history.pushState({ tab: ST.tab, planOnly: true }, ""); } catch (er) { } render(); window.scrollTo(0, 0); return; }
    if (A_ === "obsignin" || A_ === "obsendkey") {
      if (WS === "demo") await leaveDemo();
      var sem = (document.getElementById("si_em") || {}).value || "", skey = ((document.getElementById("si_key") || {}).value || "").trim(), smsg = document.getElementById("si_msg"), say = function (x, ok) { if (smsg) { smsg.textContent = x; smsg.style.color = ok ? "var(--green)" : "var(--red)"; } };
      sem = sem.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sem)) { say("Enter the email you subscribed with."); return; }
      if (!helperReady()) { say("Sign-in isn't available right now. Email support@getliquara.com."); return; }
      S.lastEmail = sem; saveRaw();
      if (A_ === "obsendkey") { t.disabled = true; try { await helper("/account/sendkey", { email: sem }); say("If that email has a Liquara plan, your key is on its way. Check your inbox and spam.", true); } catch (er) { say(er.message); } t.disabled = false; return; }
      var spw = ((document.getElementById("si_pw") || {}).value || "");
      if (ST.siMode === "pw" ? !spw : !skey) { say(ST.siMode === "pw" ? "Enter your password." : "Paste the license key from your welcome email."); return; }
      t.disabled = true; t.textContent = "Signing in…";
      try {
        var tok;
        if (ST.siMode === "pw") {
          tok = (await acctApi("/account/login", { email: sem, h: await stretchPw(sem, spw) })).token;
          var me = await acctApi("/account/me", {}, tok), L0 = (me.licenses || []).filter(function (l) { return ["trialing", "active", "past_due"].indexOf(l.status) >= 0; })[0] || (me.licenses || [])[0];
          if (!L0) throw new Error("There's no Liquara plan on this email yet. Start a free trial, or sign in with the email you subscribed with.");
          skey = L0.key;
        } else tok = (await helper("/account/keylogin", { email: sem, key: skey })).token;
        try { if (tok) localStorage.setItem("lq_acct", tok); } catch (er) { }
        delete S.demo; saveRaw();
        await activateKey(skey);
        if (!ST.res) { ST.ob = null; ST.tab = "home"; }
        else { ST.ob = null; ST.tab = "home"; }
        toast("Signed in. Welcome back" + (S.company ? ", " + S.company : "") + "."); render(); window.scrollTo(0, 0);
      } catch (er) { say(er.message); t.disabled = false; t.textContent = "Sign in"; }
      return;
    }
    if (A_ === "simode") { ST.siMode = t.dataset.m; var keepEm = (document.getElementById("si_em") || {}).value; render(); var e2 = document.getElementById("si_em"); if (e2 && keepEm) e2.value = keepEm; return; }
    if (A_ === "forgotpw") { var fem = ((document.getElementById("si_em") || {}).value || "").trim(); openOut((isNative() ? "https://getliquara.com/account" : "account") + "#forgot" + (fem ? "=" + encodeURIComponent(fem) : "")); return; }
    if (A_ === "syncnow") { if (!paid()) { toast("Add your license key first"); return; } if (S.sync === false) { S.sync = true; saveRaw(); } toast("Syncing…"); var got = await syncPull(false); if (!got) { await syncPush(false); toast(S.syncErr ? "Couldn't sync: " + S.syncErr : "Up to date"); } render(); return; }
    if (A_ === "synctoggle") { S.sync = S.sync === false; saveRaw(); if (S.sync) syncPush(false); render(); return; }
    if (A_ === "obdata") { closeSheet(); if (WS === "demo") await leaveDemo(); go("data"); return; }
    if (A_ === "rates") { getRates(true); return; }
    if (A_ === "lenders") { getLenders(); return; }
    if (A_ === "debtedit") { debtSheet(t.dataset.i); return; }
    if (A_ === "debthide") { S.debtHide = (S.debtHide || []).concat([t.dataset.k]); saveS(); render(); return; }
    if (A_ === "debtdel") { var dd = ST.debtEd; S.debts = (S.debts || []).filter(function (x) { return x.id !== dd.id; }); saveS(); closeSheet(); render(); return; }
    if (A_ === "debtsave") {
      var e0 = ST.debtEd, g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }, num = function (id) { var v = parseFloat(g(id).replace(/[^\d.]/g, "")); return isFinite(v) ? v : undefined; };
      var nd = { id: e0.found ? "d" + Date.now() : e0.id, key: e0.key, name: g("de_name") || e0.name || "Loan", type: g("de_type"), lender: g("de_lender"), balance: num("de_bal"), rate: num("de_rate"), payment: num("de_pay"), every: +g("de_every") || 30.4, limit: num("de_limit"), end: g("de_end"), pg: g("de_pg") };
      S.debts = (S.debts || []).filter(function (x) { return x.id !== nd.id; }).concat([nd]); saveS(); closeSheet(); toast("Saved"); render(); return;
    }
    if (A_ === "copick") { pickCo(t.dataset.cik); return; }
    if (A_ === "cofweb") { webCo(); return; }
    if (A_ === "cowebpick") { pickWebCo(+t.dataset.i); return; }
    if (A_ === "counlink") { delete S.co; saveS(); render(); return; }
    if (A_ === "news") { getNews(!!(S.news && S.news.data)); return; }
    if (A_ === "compete") { getCompete(); return; }
    if (A_ === "csec") { ST.compSec = t.dataset.s; render(); return; }
    if (A_ === "lgo2") { go(t.dataset.to); return; }
    if (A_ === "upgrade") { doUpgrade(t.dataset.plan); return; }
    if (A_ === "planhelp") { var phL = acc().license || {}; location.href = "mailto:support@getliquara.com?subject=" + encodeURIComponent("Change my plan to " + ((PLANS[t.dataset.plan] || {}).name || t.dataset.plan)) + "&body=" + encodeURIComponent("License: " + (phL.key || "") + "\nEmail: " + (phL.email || "")); return; }
    if (A_ === "fitwrong") { location.href = "mailto:support@getliquara.com?subject=" + encodeURIComponent("My plan check looks wrong") + "&body=" + encodeURIComponent("License: " + (S.license && S.license.key || "") + "\nWhat Liquara sees: about " + m(fitRev()) + " a year\nWhat's actually right: "); return; }
    if (A_ === "lgo") {
      var to = t.dataset.to; ST.launch = false;
      if (to === "lens") { S.lens = t.dataset.l; saveS(); }
      if (to === "plans" || to === "key") { if (!ST.res) { render(); toast("Pick a size first, then choose your plan"); return; } go("plans"); if (to === "key") setTimeout(function () { var f = document.getElementById("lic"); if (f) { f.scrollIntoView({ behavior: "smooth", block: "center" }); f.focus(); } }, 120); return; }
      if (to === "data") { go("data"); return; }
      if (to === "news" || to === "compete") { if (!ST.res) { render(); toast("Pick a size first"); return; } go(to); return; }
      if (!ST.res) { render(); return; }
      go("home"); return;
    }
    if (A_ === "home") { var nat = false; try { nat = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (er) { } if (nat) { if (ST.res) go("home"); else { render(); window.scrollTo(0, 0); } } else { try { sessionStorage.removeItem("lq_inapp"); } catch (er) { } location.href = "./"; } return; }
    if (A_ === "backdemo") { ST.gateMsg = null; if (WS !== "demo") { enterDemo(); if (S.demo) await analyze(); else ST.ob = "size"; } ST.tab = "home"; render(); window.scrollTo(0, 0); return; }
    if (A_ === "theme") { S.theme = S.theme === "light" ? "dark" : "light"; saveS(); render(); return; }
    if (A_ === "tour") { startTour(); return; }
    if (A_ === "sample") { enterDemo(); if (TOUR) clearTimeout(TOUR.t); TOUR = null; var sz = SIZES.filter(function (x) { return x[0] === S.size; })[0] || SIZES[0]; S.demo = S.demo || (DEMO.pick ? DEMO.pick(S.industry || "other", S.size || "s2") : sz[2]); saveS(); await analyze(); ST.tab = "home"; render(); return; }
    if (A_ === "tprev" && TOUR) { TOUR.i = Math.max(0, TOUR.i - 1); showScene(); return; }
    if (A_ === "tnext" && TOUR) { if (TOUR.i >= TOUR.scenes.length - 1) { TOUR = null; ST.tab = "home"; render(); } else { TOUR.i++; showScene(); } return; }
    if (A_ === "tpause" && TOUR) { TOUR.paused = !TOUR.paused; showScene(); return; }
    if (A_ === "adjust") { adjustSheet(); return; }
    if (A_ === "why") { whySheet(); return; }
    if (A_ === "saveadj") { S.adj = { inPct: +document.getElementById("ai").value, outPct: +document.getElementById("ao").value }; saveS(); closeSheet(); await analyze(); render(); toast("Forecast adjusted"); return; }
    if (A_ === "clearadj") { delete S.adj; saveS(); closeSheet(); await analyze(); render(); return; }
    if (A_ === "present") { presentMode(); return; }
    if (A_ === "pdf" || A_ === "lender") { boardPack(A_).catch(function (er) { toast("Couldn't build the PDF: " + er.message); }); return; }
    if (A_ === "xlsx") { exportXlsx().catch(function (er) { toast("Couldn't export: " + er.message); }); return; }
    if (A_ === "savegoal") { S.goal = { type: document.getElementById("gt").value, value: +document.getElementById("gv").value.replace(/[^\d.]/g, "") }; saveS(); render(); return; }
    if (A_ === "cleargoal") { delete S.goal; saveS(); render(); return; }
    if (A_ === "budgetimport") { if (gate("Import your own budget once your free trial starts.")) return; budgetPicker.click(); return; }
    if (A_ === "addcost") { if (gate("Add your own costs once your free trial starts.")) return; var rows = parseTyped(document.getElementById("costin").value), fc = document.getElementById("costfc").checked; if (!rows.length) { toast("Add an amount, like: Uniforms 600 a month"); return; } S.costs = (S.costs || []).concat(rows.map(function (r) { return { id: uid(), vendor: r.vendor, amount: r.amount, every: r.every, forecast: fc }; })); if (!S.demo && !S.trial) S.trial = Date.now(); saveS(); await analyze(); render(); toast("Added " + rows.length + " cost" + (rows.length > 1 ? "s" : "")); return; }
    if (A_ === "portal") { try { var pr = await helper("/portal", { device: S.device }); var w = window.open(pr.url, "_blank"); if (!w) location.href = pr.url; } catch (er) { toast(er.message); } return; }
    if (A_ === "lic") { t.disabled = true; try { if (WS === "demo") await leaveDemo(); await activateKey(document.getElementById("lic").value); ST.gateMsg = null; toast("Unlocked"); render(); } catch (er) { toast(er.message); t.disabled = false; } return; }
    if (A_ === "copykey") { var ck = (acc().license || {}).key || ""; try { await navigator.clipboard.writeText(ck); toast("License key copied"); } catch (er) { toast(ck); } return; }
    if (A_ === "unlock") { var pv = document.getElementById("pinin").value; var PN = accS().pin; if (PN && await sha(PN.salt + pv) === PN.hash) { unlocked = true; render(); } else { toast("Wrong PIN"); buzz(); } return; }
    if (A_ === "forgotpin") { if (!confirmTwice(t)) return; var FA = accS(); try { await clearSrc(); } catch (er) { } try { localStorage.setItem("ao.s", JSON.stringify({ device: FA.device, lang: FA.lang, theme: FA.theme, helperUrl: FA.helperUrl, lastEmail: (FA.license && FA.license.email) || FA.lastEmail, v: 2 })); localStorage.removeItem("ao.d"); localStorage.removeItem("lq_acct"); sessionStorage.removeItem("lq_ws"); } catch (er) { } location.reload(); return; }
    if (A_ === "setpin") { var p1 = document.getElementById("pin1").value; if (!/^\d{4,8}$/.test(p1)) { toast("Use 4 to 8 digits"); return; } var salt = uid(); S.pin = { salt: salt, hash: await sha(salt + p1) }; unlocked = true; saveS(); toast("PIN set"); render(); return; }
    if (A_ === "clearpin") { var p0 = document.getElementById("pin0").value; if (await sha(S.pin.salt + p0) !== S.pin.hash) { toast("Enter your current PIN to remove it"); return; } delete S.pin; saveS(); toast("PIN removed"); render(); return; }
    if (A_ === "fxrefresh") { await refreshFx(false); await analyze(); render(); return; }
    if (A_ === "fxconv") { var amt = +document.getElementById("cva").value || 0, f1 = fxRates()[document.getElementById("cvf").value], f2 = fxRates()[document.getElementById("cvt").value]; document.getElementById("cvr").textContent = f1 && f2 ? (amt / f1 * f2).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + document.getElementById("cvt").value : "No rate"; return; }
    if (A_ === "fxmanual") { var mc = document.getElementById("fmc").value.trim().toUpperCase(), mr = +document.getElementById("fmr").value; if (!/^[A-Z]{3}$/.test(mc) || !(mr > 0)) { toast("Enter a 3-letter code and how many per 1 US dollar"); return; } S.fxManual = S.fxManual || {}; S.fxManual[mc] = mr; saveS(); await analyze(); render(); return; }
    if (A_ === "brief") { S.brief = !S.brief; saveS(); var okb = await scheduleBrief(); toast(S.brief ? (okb ? "Monday brief on: Mondays at 8 AM" : "Monday brief works in the Android app") : "Monday brief off"); render(); return; }
    if (A_ === "savescn") { var nm = prompt("Name this scenario", "Plan " + ((S.scenarios || []).length + 1)); if (!nm) return; S.scenarios = (S.scenarios || []).concat([{ name: nm, sc: Object.assign({}, ST.sc) }]); saveS(); render(); return; }
    if (d.tab) { buzz(); go(d.tab); }
    else if (d.go) go(d.go);
    else if (d.ins) { ST.ins = d.ins; go("insights"); }
    else if (d.hz) { ST.hz = d.hz; render(); }
    else if (d.q) ask(d.q, true);
    else if (d.menu) { closeSheet(); if (d.menu === "pdf" || d.menu === "lender") boardPack(d.menu).catch(function (er) { toast("Couldn't build the PDF: " + er.message); }); else if (d.menu === "xlsx") exportXlsx().catch(function (er) { toast("Couldn't export: " + er.message); }); else if (d.menu === "tour") startTour(); else go(d.menu); }
    else if (d.preset) { if (gate("Live connections unlock with your free trial.")) return; apiSheet(d.preset); }
    else if (d.del) { await delSrc(d.del); ST.sources = await allSrc(); await analyze(); render(); }
    else if (d.delc) { S.conns = (S.conns || []).filter(function (c) { return c.id !== d.delc; }); saveS(); await delSrc("api-" + d.delc); ST.sources = await allSrc(); await analyze(); render(); }
    else if (d.pre) {
      if (d.pre === "reset") ST.sc = defSc();
      else { var p = PRE[+d.pre][1], mo = ST.res.analysis.outMonth; ST.sc = Object.assign(defSc(), p); if (p.spend) ST.sc.spend = Math.round(mo * 2 / 1e3) * 1e3; if (p.loan) ST.sc.loan = Math.round(mo * 2 / 1e3) * 1e3; }
      render();
    }
    else if (d.act === "menu") menu();
    else if (d.act === "pick") { if (gate("Upload your own bank files and statements once your free trial starts.")) return; if (WS === "demo") { var lp = leaveDemo(); picker.click(); lp.then(render); return; } picker.click(); }
    else if (d.act === "api") { if (gate("Live connections unlock with your free trial.")) return; apiSheet("custom"); }
    else if (d.act === "sync") syncAll(false);
    else if (d.act === "demo") { enterDemo(); delete S.budget; S.ccy = null; S.demo = d.id; delete S.company; saveS(); ST.qa = []; ST.sc = defSc(); scanAndShow("Demo: " + DEMO.get(d.id).name); }
    else if (d.act === "saveset") { S.company = document.getElementById("sco").value.trim() || undefined; var bv = document.getElementById("sbal").value.replace(/[$,\s]/g, ""); S.balance = bv === "" ? undefined : +bv; S.industry = document.getElementById("sind").value; S.size = document.getElementById("ssz").value; S.ccy = document.getElementById("sccy").value; S.region = document.getElementById("sreg").value.trim() || undefined; var hw = document.getElementById("shelper"); if (hw) S.helperUrl = hw.value.trim(); if (S.helperUrl) CFG.worker = S.helperUrl; saveS(); await analyze(); toast("Saved"); go("home"); }
    else if (d.act === "wipe") {
      if (!confirmTwice(t)) return;
      if (WS === "demo") { await leaveDemo(); try { localStorage.removeItem("ao.d"); } catch (er) { } if (!paid()) ST.ob = "welcome"; render(); window.scrollTo(0, 0); toast("The sample company was reset"); return; }
      if (paid() && S.license && S.license.key && helperReady()) { try { await helper("/sync/delete", {}); } catch (er) { } }
      /* a true fresh start: every company, sample, upload, connection and report goes. Only the license, this device's id, language, look and helper address stay. */
      try { await clearSrc(); } catch (er) { }
      var keep = {}; ["license", "device", "lang", "theme", "helperUrl", "owner", "v"].forEach(function (k) { if (S[k] !== undefined) keep[k] = S[k]; });
      S = keep; saveRaw();
      try { Object.keys(localStorage).forEach(function (k) { if (k !== "ao.s" && k.indexOf("lq_tr_") !== 0) localStorage.removeItem(k); }); sessionStorage.removeItem("lq_inapp"); } catch (er) { }
      try { if (window.indexedDB && indexedDB.databases) (await indexedDB.databases()).forEach(function (db) { if (db.name) indexedDB.deleteDatabase(db.name); }); } catch (er) { }
      toast("Everything's erased. Starting fresh.");
      setTimeout(function () { location.replace(isNative() ? "index.html" : "app"); }, 600);
    }
    else if (d.act === "savec") {
      if (gate("Live connections unlock with your free trial.")) return;
      var c = { id: uid(), name: document.getElementById("cn").value.trim() || "Live system", url: document.getElementById("cu").value.trim(), key: document.getElementById("ck").value.trim(), hdrName: document.getElementById("chn").value, hdrPrefix: document.getElementById("chp").value, scale: +document.getElementById("cs").value, kind: document.getElementById("ckind").value };
      if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(c.url)) { toast("Enter a full https:// address"); return; }
      t.disabled = true; t.textContent = "Connecting…";
      try { await pull(c); S.conns = (S.conns || []).concat([c]); if (S.demo) delete S.demo; saveS(); ST.sources = await allSrc(); closeSheet(); scanAndShow("Live link: " + c.name); }
      catch (er) { t.disabled = false; t.textContent = "Connect and test"; toast("Couldn't connect: " + (er.message || er) + (window.Capacitor ? "" : ". In a web browser many systems block this; it works in the Android app.")); }
    }
  });
  function confirmTwice(btn) { if (btn.dataset.armed) return true; btn.dataset.armed = "1"; btn.textContent = "Tap again to erase everything"; setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Erase all data and start over"; } }, 4000); return false; }
  document.addEventListener("change", function (e) {
    if (e.target.id === "slang" || e.target.id === "oblang") { setLang(e.target.value); return; }
    if (e.target.id === "sai") { S.aiTranslate = e.target.checked; saveS(); if (S.aiTranslate) applyLang(); return; }
    var bd = e.target.dataset && e.target.dataset.bud; if (bd) { var p = bd.split("|"); S.budget.months[p[0]][p[1]] = +e.target.value.replace(/[^\d.-]/g, "") || 0; S.budget.auto = false; saveS(); render(); }
    var ow = e.target.dataset && e.target.dataset.aown; if (ow) { (S.actions || []).forEach(function (a) { if (a.id === ow) a.owner = e.target.value; }); saveS(); }
    var sc2 = e.target.dataset && e.target.dataset.srcccy; if (sc2) { tx("readwrite", function (st) { ST.sources.forEach(function (x) { if (x.id === sc2) { x.currency = e.target.value || null; st.put(x); } }); }).then(analyze).then(render); }
  });
  var budgetPicker = document.createElement("input"); budgetPicker.type = "file"; budgetPicker.accept = ".csv,.xlsx"; budgetPicker.style.display = "none"; document.body.appendChild(budgetPicker);
  budgetPicker.addEventListener("change", async function () {
    var f = budgetPicker.files[0]; budgetPicker.value = ""; if (!f) return;
    var tb = /\.xlsx$/i.test(f.name) ? (await E.parseXLSX(new Uint8Array(await f.arrayBuffer())))[0] : E.parseCSV(await f.text()), H = tb.header, mc = H.filter(function (h) { return /month|period|date/i.test(h); })[0] || H[0], ic2 = H.filter(function (h) { return /in|receipt|revenue|sales/i.test(h); })[0], oc = H.filter(function (h) { return /out|spend|cost|expense/i.test(h); })[0];
    var n = 0; S.budget = { demo: S.demo || null, months: {} }; tb.rows.forEach(function (r) { var d = E.parseDate(r[mc]); if (!d) return; S.budget.months[d.toISOString().slice(0, 7)] = { in: E.parseAmount(r[ic2]) || 0, out: Math.abs(E.parseAmount(r[oc]) || 0) }; n++; });
    saveS(); toast("Imported " + n + " months"); render();
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "cofq") { cofSearch(e.target.value); return; }
    if (/^lc_/.test(e.target.id || "")) { ST.calc = { amt: parseFloat((document.getElementById("lc_amt").value || "").replace(/[^\d.]/g, "")) || 0, rate: parseFloat(document.getElementById("lc_rate").value) || 0, yrs: parseFloat(document.getElementById("lc_yrs").value) || 1 }; var lo = document.getElementById("lcout"); if (lo) lo.innerHTML = calcOut(); return; }
    if (e.target.id === "pp_extra") { ST.extra = +e.target.value; var pv = document.getElementById("ppv"); if (pv) pv.textContent = m(ST.extra); var po = document.getElementById("ppout"); if (po) po.innerHTML = planOut(debtPlan(ST.extra)); return; }
    var k = e.target.dataset && e.target.dataset.sc; if (!k) return;
    ST.sc[k] = e.target.tagName === "SELECT" ? e.target.value : +e.target.value;
    var lb = document.querySelector('[data-lbl="' + k + '"]'); if (lb && FMT[k]) lb.textContent = FMT[k](ST.sc[k]);
    runDecision(false);
  });
  var back = plug("App"); if (back) back.addListener("backButton", function () {
    if (document.getElementById("sheet")) { closeSheet(); return; }
    var pr = document.querySelector(".present"); if (pr) { pr.remove(); return; }
    if (TOUR && app.querySelector(".tour")) { var tx = app.querySelector(".tctl [data-act=sample]"); if (tx) { tx.click(); return; } }
    if (ST.planOnly && !paid()) { ST.planOnly = false; render(); window.scrollTo(0, 0); return; }
    var onboarding = !ST.res && !(WS === "account" && paid() && setupDone()) && !(accS().pin && !unlocked);
    if (onboarding) { var bb = app.querySelector(".obback"); if (bb) { bb.click(); return; } }
    else if (ST.tab !== "home") { go("home"); return; }
    if (WS === "demo" && paid()) { leaveDemo().then(function () { render(); window.scrollTo(0, 0); toast("Back in your account"); }); return; }
    back.exitApp();
  });

  /* ---------- start ---------- */
  /* one-time tidy-up for people on older versions: an account never stays in sample mode */
  function migrate() {
    if ((S.v || 0) >= 2) return;
    if (S.demo) {
      if (S.license) { delete S.demo; delete S.budget; }
      else { var d = {}; try { d = JSON.parse(localStorage.getItem("ao.d") || "{}"); } catch (e) { } d.demo = S.demo; if (S.size) d.size = S.size; if (S.industry) d.industry = S.industry; try { localStorage.setItem("ao.d", JSON.stringify(d)); } catch (e) { } delete S.demo; delete S.size; delete S.industry; delete S.budget; delete S.company; }
    }
    if (S.license && S.company && S.size && S.industry && S.setupDone === undefined) S.setupDone = true;
    S.v = 2; try { localStorage.setItem("ao.s", JSON.stringify(S)); } catch (e) { }
  }
  function migrateOwner() { if (S.license && !S.owner) { S.owner = ownerOf(S.license.key, S.license.email); try { localStorage.setItem("ao.s", JSON.stringify(S)); } catch (e) { } } }
  (async function start() {
    migrate(); migrateOwner();
    applyTheme(); if (S.helperUrl) CFG.worker = S.helperUrl; if (!S.device) { S.device = uid() + uid(); saveS(); }
    ST.launch = false;
    renewNow(true);
    setInterval(function () { renewNow(false); }, 3600e3);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { renewNow(false); syncPull(false); } else if (S.syncDirty) syncPush(false); });
    try { ST.sources = await allSrc(); } catch (e) { ST.sources = []; }
    setTimeout(function () { syncPull(false); }, 1500);
    var hs = location.hash, ownData = ST.sources.length || (S.costs || []).length, dS = {}; try { dS = JSON.parse(localStorage.getItem("ao.d") || "{}"); } catch (e) { }
    var nav0 = {}; try { nav0 = performance.getEntriesByType("navigation")[0] || {}; } catch (e) { }
    var again = nav0.type === "reload" || nav0.type === "back_forward"; try { if (sessionStorage.getItem("lq_reload") === "1") again = true; sessionStorage.removeItem("lq_reload"); } catch (e) { }
    var wasDemo = (function () { try { return sessionStorage.getItem("lq_ws") === "demo"; } catch (e) { return false; } })();
    var wantDemo = /^#demo/.test(hs) || (!/[#&](lic|plans|account)/.test(hs) && ((again && wasDemo) || (!paid() && !ownData && dS.demo)));
    if (wantDemo) { enterDemo(); if (/^#demo/.test(hs) && !S.demo) ST.ob = "size"; }
    else { try { sessionStorage.removeItem("lq_ws"); } catch (e) { } }
    if (/^#plans/.test(hs) && !paid()) { ST.planOnly = true; }
    window.addEventListener("popstate", function (e) { var t = e.state && e.state.tab; if (!t) return; ST.popping = true; closeSheet(); ST.planOnly = !!e.state.planOnly && !paid(); ST.tab = t; render(); ST.popping = false; });
    try { history.replaceState({ tab: ST.tab, planOnly: !!ST.planOnly }, ""); } catch (e) { }
    if (/^#(plans|demo|account)/.test(location.hash)) { try { history.replaceState({ tab: ST.tab, planOnly: !!ST.planOnly }, "", location.pathname + location.search); } catch (er) { } }
    var lm = /[#&]lic=([A-Za-z0-9-]+)/.exec(location.hash);
    if (lm) { if (WS === "demo") await leaveDemo(); try { history.replaceState({ tab: "home" }, "", location.pathname + location.search); } catch (er) { } if (!paid() || (S.license && S.license.key !== lm[1].toUpperCase())) { toast("Unlocking with your license…"); activateKey(decodeURIComponent(lm[1])).then(function () { toast("Unlocked. Welcome back."); render(); }).catch(function (er) { toast(er.message); }); } }
    if (!S.demo && !ST.sources.length && !(S.costs || []).length) { render(); return; }
    await analyze(); render();
    if (S.conns && S.conns.length) syncAll(true);
    if (!S.fx || Date.now() - (S.fxAt || 0) > 864e5) refreshFx(true).then(function (ok) { if (ok) { S.fxAt = Date.now(); saveS(); } });
    if (S.brief) scheduleBrief();
  })().catch(function (e) { app.innerHTML = '<div class="panel"><b>Something went wrong starting Liquara.</b><p class="small mute">' + esc(e.message) + '</p><button class="btn" id="rst">Reset</button></div>'; var r = document.getElementById("rst"); if (r) r.onclick = function () { localStorage.clear(); indexedDB.deleteDatabase("aorta"); location.reload(); }; });
})();
