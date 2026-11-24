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
  function saveS() { try { localStorage.setItem("ao.s", JSON.stringify(S)); } catch (e) { } }
  var dbp = null;
  function db() { if (dbp) return dbp; dbp = new Promise(function (ok, no) { var r = indexedDB.open("aorta", 1); r.onupgradeneeded = function () { r.result.createObjectStore("src", { keyPath: "id" }); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); return dbp; }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (ok, no) { var t = d.transaction("src", mode), s = t.objectStore("src"), out = fn(s); t.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { no(t.error); }; }); }); }
  function allSrc() { return tx("readonly", function (s) { return s.getAll(); }); }
  function putSrc(o) { return tx("readwrite", function (s) { s.put(o); }); }
  function delSrc(id) { return tx("readwrite", function (s) { s.delete(id); }); }
  function clearSrc() { return tx("readwrite", function (s) { s.clear(); }); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

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
    var live = S.demo ? '<span class="badge">Demo</span>' : (S.conns && S.conns.length ? '<span class="live"><i></i>Live link</span>' : "");
    return '<div class="top"><button class="homebtn" data-act="home" aria-label="Home" title="Home">' + HEART + "</button>" + '<div style="min-width:0"><div class="nm">Liquara</div><div class="co">' + esc(sub || companyName()) + '</div></div><div class="sp"></div>' + live + '<button class="ib" data-act="theme" aria-label="Light or dark">' + (S.theme === "light" ? "☾" : "☀") + '</button><button class="ib" data-act="menu" aria-label="Menu">' + ic("menu") + "</button></div>";
  }
  function render() {
    ST.charts = {}; var ask = document.querySelector(".askbar"); if (ask) ask.remove();
    applyTheme();
    if (S.pin && !unlocked) { syncNav(false); app.innerHTML = viewLock(); applyLang(); setTimeout(function () { var p = document.getElementById("pinin"); if (p) p.focus(); }, 50); return; }
    if (!ST.res) { syncNav(false); app.innerHTML = ST.model && !ST.model.tx.length ? viewNoBank() : viewOnboard(); applyLang(); return; }
    if (locked() && ["plans", "settings", "about"].indexOf(ST.tab) < 0) ST.tab = "plans";
    syncNav(true);
    var v = { home: viewPulse, alerts: viewAlerts, budget: viewBudget, actions: viewActions, goals: viewGoals, plans: viewPlans, savings: viewSavings, forecast: viewForecast, insights: viewInsights, decide: viewDecide, ask: viewAsk, data: viewData, settings: viewSettings, about: viewAbout }[ST.tab] || viewHome;
    app.innerHTML = v(); wireCharts();
    if (ST.tab === "ask") mountAsk();
    if (ST.tab === "decide") runDecision(true);
    applyLang();
  }
  function go(tab) { ST.tab = tab; render(); window.scrollTo(0, 0); }

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
  function foot() { return '<div class="foot">LIQUARA · ' + (S.ccy || "USD") + " · " + (S.demo ? "FICTIONAL DEMO DATA" : "COMPUTED ON THIS DEVICE") + " · " + fd(ST.res.analysis.asOf).toUpperCase() + "</div>"; }


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
    h += '<div class="wide2"><div><div class="panel"><div class="eyebrow">Result</div><div id="dres"><span class="spin"></span></div></div></div><div><div class="panel">';
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
    var h = head() + '<div class="panel gold"><div class="eyebrow">Boardroom</div><h2>Ask anything about the money</h2><p class="small mute" style="margin:6px 0 0">Answers are worked out from your own data and forecast, and every what-if reruns the simulation. Nothing is guessed.</p></div><div class="qa" id="qa">';
    if (!ST.qa.length) h += '<div class="chips" style="flex-wrap:wrap">' + Q.suggestions.map(function (q) { return '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>";
    ST.qa.forEach(function (x) { h += msgHtml(x); });
    return h + '</div><div style="height:70px"></div>';
  }
  function msgHtml(x) {
    var a = x.a, id = "q" + x.id, body = '<div class="msg me">' + esc(x.q) + '</div><div class="msg ai"><div class="panel"><h3 class="gold">' + esc(a.title) + "</h3>" + (a.text ? '<div class="small" style="margin-top:6px">' + esc(a.text) + "</div>" : "") + (a.bullets && a.bullets.length ? "<ul class=small>" + a.bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" : "");
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
  async function ask(q0) {
    var q = await toEnglish(q0), a = Q.ask(q, ST.ctx); q = q0; ST.qa.push({ id: uid(), q: q, a: a }); if (ST.qa.length > 30) ST.qa.shift(); buzz();
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
    var h = head() + '<div class="panel gold"><div class="eyebrow">Your business</div><label class="f"><span>Company name</span><input class="in" id="sco" value="' + esc(S.company || "") + '" placeholder="' + esc(companyName()) + '"></label>' +
      '<label class="f"><span>Size (yearly revenue)</span><select class="in" id="ssz">' + opt(SIZES, S.size) + '</select></label><label class="f"><span>Kind of business</span><select class="in" id="sind">' + opt(INDUSTRIES, S.industry) + '</select></label>' +
      '<label class="f"><span>Report in this currency</span><select class="in" id="sccy">' + ccyList().map(function (c) { return "<option" + (c === (S.ccy || "USD") ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select></label>' +
      '<label class="f"><span>Cash in the bank today (only if your bank file has no balance column)</span><input class="in" id="sbal" inputmode="decimal" value="' + (S.balance != null ? S.balance : "") + '" placeholder="e.g. 250000"></label>' +
      '<label class="f"><span>Liquara helper address (for AI reading, savings checks and payments)</span><input class="in" id="shelper" value="' + esc(S.helperUrl || CFG.worker || "") + '" placeholder="https://liquara-helper.yourname.workers.dev" autocapitalize="off"></label><button class="btn pri" style="margin-top:12px" data-act="saveset">Save</button></div>';
    h += '<div class="panel"><div class="eyebrow">Exchange rates</div><p class="small mute" style="margin:0 0 8px">European Central Bank reference rates, saved for offline use. Last updated ' + esc((S.fx || FX_BUILTIN).date) + '.</p><button class="btn ghost" data-act="fxrefresh">Update rates now</button><div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap"><input class="in" id="cva" inputmode="decimal" value="1000" style="max-width:120px"><select class="in" id="cvf" style="max-width:100px">' + ccyList().map(function (c) { return "<option" + (c === "USD" ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select><span>→</span><select class="in" id="cvt" style="max-width:100px">' + ccyList().map(function (c) { return "<option" + (c === "EUR" ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select><button class="btn" data-act="fxconv">Convert</button></div><div class="mid" id="cvr" style="margin-top:8px"></div><div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap"><input class="in" id="fmc" placeholder="Code, e.g. NGN" style="max-width:150px"><input class="in" id="fmr" placeholder="Per 1 USD" inputmode="decimal" style="max-width:130px"><button class="btn ghost" data-act="fxmanual">Add my own rate</button></div></div>';
    h += '<div class="panel"><div class="eyebrow">Look and alerts</div><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="theme">' + (S.theme === "light" ? "Switch to dark" : "Switch to light") + '</button><button class="btn ghost" data-act="brief">Monday cash brief: ' + (S.brief ? "on" : "off") + '</button></div></div>';
    h += '<div class="panel"><div class="eyebrow">Language</div>' + langSelect("slang") + '<label class="row" style="gap:8px;margin-top:10px;align-items:center"><input type="checkbox" id="sai"' + (S.aiTranslate !== false ? " checked" : "") + '> <span class="small">Translate everything with AI</span></label><p class="note">Main screens are built in. With the Liquara helper set up, the rest (explanations, answers, file names) is translated by AI once and saved on this device. Ask understands questions in any of these languages when the helper is on.</p></div>';
    h += '<div class="panel"><div class="eyebrow">Security</div>' + (S.pin ? '<p class="small mute">A PIN protects Liquara on this device.</p><div class="row" style="gap:8px"><input class="in" id="pin0" type="password" inputmode="numeric" placeholder="Current PIN" style="max-width:180px"><button class="btn ghost" data-act="clearpin">Remove PIN</button></div>' : '<p class="small mute">Optional. Ask for a PIN every time Liquara opens.</p><div class="row" style="gap:8px"><input class="in" id="pin1" type="password" inputmode="numeric" placeholder="4 to 8 digits" style="max-width:180px"><button class="btn" data-act="setpin">Set PIN</button></div>') + '</div>';
    h += '<div class="panel"><div class="eyebrow">Your data</div><p class="small mute" style="margin:0 0 10px">Everything stays in Liquara on this device unless you choose AI reading or live checks.</p><button class="btn ghost" data-act="wipe" style="border-color:rgba(255,125,125,.4);color:var(--red)">Erase all data and start over</button></div>';
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
      '<div class="panel"><div class="eyebrow">Privacy</div><p class="small mute" style="margin:0">Liquara has no server. Files and results stay on this device. Live links go directly from this phone to the system you connect. Version ' + VERSION + '.</p></div><div class="panel"><div class="eyebrow">Honest limits</div><p class="small mute" style="margin:0">A forecast is an estimate. The self-test shows how close Liquara got on your own history; results depend on how complete your data is. Not financial, tax or legal advice.</p></div>' + foot();
  }
  function li(t, d) { return '<div class="li"><div class="grow"><div class="t">' + t + '</div><div class="d">' + d + "</div></div></div>"; }
  function sheet(html) { closeSheet(); var s = document.createElement("div"); s.className = "sheet"; s.id = "sheet"; s.innerHTML = '<div class="bd">' + html + "</div>"; s.addEventListener("click", function (e) { if (e.target === s || e.target.closest("[data-close]")) closeSheet(); }); document.body.appendChild(s); }
  function closeSheet() { var s = document.getElementById("sheet"); if (s) s.remove(); }
  function menu() {
    var it = [["data", "data", "Data & connections"], ["savings", "dec", "Savings finder"], ["alerts", "info", "Payment alerts"], ["budget", "ins", "Budget vs actual"], ["actions", "fc", "Action tracker"], ["goals", "home", "Cash goal"], ["pdf", "pdf", "Board pack (PDF)"], ["lender", "pdf", "Lender packet (PDF)"], ["xlsx", "up", "Excel export"], ["tour", "info", "Replay the walkthrough"], ["plans", "link", "Plan & billing"], ["settings", "gear", "Settings"], ["about", "info", "How it works & privacy"]];
    sheet('<div class="between"><h2>Menu</h2><button class="ib" data-close>' + ic("x") + "</button></div>" + it.map(function (x) { return '<button class="opt" data-menu="' + x[0] + '"><div class="ic">' + ic(x[1]) + "</div><div><b>" + x[2] + "</b></div></button>"; }).join(""));
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
  function paid() { return S.license && S.license.until > Date.now(); }
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
    var step = ST.ob || (S.size ? (S.industry ? "start" : "industry") : "size");
    var top = '<div class="obtop"><button class="homebtn" data-act="home" aria-label="Home" title="Home">' + HEART + "</button>" + '<b>Liquara</b><span style="margin-inline-start:auto;max-width:150px">' + langSelect("oblang") + "</span></div>";
    if (step === "size") return top + '<div class="ob"><div class="eyebrow">Step 1 of 2</div><h1>How big is your business?</h1><p class="mute">Yearly revenue. We\'ll show you Liquara running a company your size.</p><div class="obgrid">' + SIZES.map(function (x) { return '<button class="opt" data-size="' + x[0] + '"><div class="ic">' + ic("data") + '</div><div><b>' + x[1] + '</b><span>' + ({ s1: "Owner-run shops and studios", s2: "Growing small businesses", s3: "Mid-size companies with a finance team", s4: "Large companies, several entities", s5: "Enterprises and groups" })[x[0]] + "</span></div></button>"; }).join("") + "</div></div>";
    if (step === "industry") return top + '<div class="ob"><div class="eyebrow">Step 2 of 2</div><h1>What kind of business?</h1><p class="mute">Used to compare you with businesses like yours.</p><div class="chips" style="flex-wrap:wrap">' + INDUSTRIES.map(function (x) { return '<button class="chip" data-ind="' + x[0] + '">' + x[1] + "</button>"; }).join("") + '</div><button class="btn ghost" style="margin-top:18px" data-ob="size">Back</button></div>';
    return top + '<div class="ob"><h1>Ready when you are</h1><button class="btn pri full" data-act="tour">Watch how it works (60 sec)</button><button class="btn ghost full" style="margin-top:10px" data-act="sample">Skip to the sample company</button></div>';
  }
  /* the walkthrough plays like a short video, built from the sample company's real results */
  var TOUR = null;
  async function startTour() {
    var sz = SIZES.filter(function (x) { return x[0] === S.size; })[0] || SIZES[0];
    S.demo = sz[2]; saveS(); syncNav(false);
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
    if (S.demo) return '<div class="banner"><span><b>Sample company.</b> Everything here is fictional.</span><button class="btn pri sm" data-act="pick">' + (paid() ? "Connect my data" : "Start free trial") + '</button></div>';
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
    h += '<div class="span2 row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" data-act="pdf">Board pack PDF</button><button class="btn" data-act="present">Present mode</button><button class="btn ghost" data-act="lender">Lender packet</button><button class="btn ghost" data-act="xlsx">Excel export</button></div>';
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
    if (S.license && S.license.code) hd["X-Liquara-License"] = S.license.code; if (S.device) hd["X-Liquara-Device"] = S.device;
    if (H) { var r = await H.post({ url: url, headers: hd, data: body }); if (r.status >= 400) throw new Error((r.data && r.data.error) || "Helper said " + r.status); return typeof r.data === "string" ? JSON.parse(r.data) : r.data; }
    var res = await fetch(url, { method: "POST", headers: hd, body: JSON.stringify(body) }); var j = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error(j.error || "Helper said " + res.status); return j;
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
    var gm = !paid() && ST.gateMsg ? '<div class="panel" style="border-color:rgba(200,255,77,.5)"><b>' + esc(ST.gateMsg) + '</b><p class="small mute" style="margin:6px 0 0">Until then you can explore the sample company as much as you like.</p><button class="btn ghost sm" data-act="backdemo" style="margin-top:10px">Back to the sample</button></div>' : "";
    var h = head() + gm + '<div class="panel gold"><div class="eyebrow">Plans</div><h2>' + (paid() ? "You're subscribed" : t != null ? (t ? t + " days left in your trial" : "Your free trial has ended") : "Start your " + TRIAL_DAYS + "-day free trial") + '</h2><p class="small mute" style="margin:6px 0 0">' + (paid() ? "Plan: " + esc(S.license.plan) + ". Manage your card or cancel below." : "Your card is saved securely by Stripe and charged when the trial ends. Cancel any time in the app.") + '</p></div><div class="seg" style="margin-bottom:12px">' + Object.keys(PERIODS).map(function (k) { return '<button data-per="' + k + '" class="' + (per === k ? "on" : "") + '">' + PERIODS[k][0] + (PERIODS[k][2] < 1 ? " · save " + Math.round((1 - PERIODS[k][2]) * 100) + "%" : "") + "</button>"; }).join("") + '</div><div class="plans">';
    h += Object.keys(PLANS).map(function (k) { var p = PLANS[k], price = priceOf(k, per); return '<div class="panel plan ' + (k === rec ? "rec" : "") + '">' + (k === rec ? '<span class="badge g">Fits your size</span>' : "") + "<h3>" + p.name + '</h3><div class="small mute">' + p.who + '</div><div class="price">' + m(price).replace(/\.0K/, "K") + '<span>/' + ({ month: "month", quarter: "quarter", year: "year" })[per] + '</span></div><ul class="small"><li>All three views, forecasting and alerts</li><li>' + p.checks + " AI savings checks a month</li><li>" + (k === "owner" ? "1 company" : k === "business" ? "Up to 5 companies, budget vs actual" : "Unlimited companies, currencies, bank files, priority help") + '</li></ul><button class="btn ' + (k === rec ? "pri" : "") + ' full" data-buy="' + k + '">' + (paid() ? "Switch" : "Start free trial") + "</button></div>"; }).join("");
    h += '</div><div id="checkout"></div>' + (paid() ? '<button class="btn ghost" data-act="portal">Update card or cancel</button>' : "") + '<div class="panel"><div class="eyebrow">Have a license code?</div><div class="row" style="gap:8px"><input class="in" id="lic" placeholder="LQ1…"><button class="btn" data-act="lic">Unlock</button></div></div>';
    return h + foot();
  }
  function loadStripe() { return new Promise(function (ok, no) { if (window.Stripe) return ok(); var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/"; s.onload = ok; s.onerror = function () { no(new Error("Couldn't load the secure payment form")); }; document.head.appendChild(s); }); }
  async function buy(plan) {
    var per = ST.per || "month", box = document.getElementById("checkout");
    if (!helperReady() || !CFG.stripePk) { box.innerHTML = '<div class="panel note">Payments aren\'t switched on yet. Once the Stripe and helper setup is done, the secure card form opens right here.</div>'; box.scrollIntoView({ behavior: "smooth" }); return; }
    box.innerHTML = '<div class="panel"><span class="spin"></span></div>'; box.scrollIntoView({ behavior: "smooth" });
    try {
      await loadStripe(); S.device = S.device || uid() + uid(); saveS();
      var r = await helper("/checkout", { plan: plan, period: per, trialDays: TRIAL_DAYS, device: S.device, email: S.email || "" });
      var stripe = window.Stripe(CFG.stripePk); box.innerHTML = '<div class="panel" id="ckmount"></div>';
      var co = await stripe.initEmbeddedCheckout({ clientSecret: r.clientSecret, onComplete: async function () { try { var L = await helper("/license", { session: r.session, device: S.device }); await setLicense(L.code); co.destroy(); render(); toast("Welcome to Liquara " + PLANS[plan].name); } catch (e) { toast("Paid, but unlocking failed: " + e.message + ". Use 'Have a license code?'"); } } });
      co.mount("#ckmount");
    } catch (e) { box.innerHTML = '<div class="panel note">' + esc(e.message) + "</div>"; }
  }
  /* license codes: LQ1.<payload>.<signature>, verified with the public key in license-pub.js */
  async function setLicense(code) {
    var P = window.LQ_LICENSE_PUB; if (!P) throw new Error("License checking isn't set up yet");
    var parts = String(code).trim().split("."); if (parts.length !== 3 || parts[0] !== "LQ1") throw new Error("That isn't a Liquara code");
    var dec = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
    var key = await crypto.subtle.importKey("jwk", P, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    var ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, dec(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!ok) throw new Error("That code isn't valid");
    var p = JSON.parse(new TextDecoder().decode(dec(parts[1])));
    if (p.e && p.e < Date.now()) throw new Error("That code has expired");
    S.license = { code: code.trim(), plan: p.p, until: p.e || 8.64e15, firm: p.f }; saveS();
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
    if (d.ob) { ST.ob = d.ob; render(); return; }
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
    if (A_ === "home") { var nat = false; try { nat = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (er) { } if (nat) { ST.tab = "pulse"; render(); window.scrollTo(0, 0); } else { try { sessionStorage.removeItem("lq_inapp"); } catch (er) { } location.href = "./"; } return; }
    if (A_ === "backdemo") { ST.gateMsg = null; ST.tab = "pulse"; render(); window.scrollTo(0, 0); return; }
    if (A_ === "theme") { S.theme = S.theme === "light" ? "dark" : "light"; saveS(); render(); return; }
    if (A_ === "tour") { startTour(); return; }
    if (A_ === "sample") { if (TOUR) clearTimeout(TOUR.t); TOUR = null; var sz = SIZES.filter(function (x) { return x[0] === S.size; })[0] || SIZES[0]; S.demo = S.demo || sz[2]; saveS(); await analyze(); ST.tab = "home"; render(); return; }
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
    if (A_ === "lic") { try { await setLicense(document.getElementById("lic").value); toast("Unlocked"); render(); } catch (er) { toast(er.message); } return; }
    if (A_ === "unlock") { var pv = document.getElementById("pinin").value; if (await sha(S.pin.salt + pv) === S.pin.hash) { unlocked = true; render(); } else { toast("Wrong PIN"); buzz(); } return; }
    if (A_ === "forgotpin") { if (!confirmTwice(t)) return; await clearSrc(); S = {}; saveS(); location.reload(); return; }
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
    else if (d.q) ask(d.q);
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
    else if (d.act === "pick") { if (gate("Upload your own bank files and statements once your free trial starts.")) return; picker.click(); }
    else if (d.act === "api") { if (gate("Live connections unlock with your free trial.")) return; apiSheet("custom"); }
    else if (d.act === "sync") syncAll(false);
    else if (d.act === "demo") { delete S.budget; S.ccy = null; S.demo = d.id; delete S.company; saveS(); ST.qa = []; ST.sc = defSc(); scanAndShow("Demo: " + DEMO.get(d.id).name); }
    else if (d.act === "saveset") { S.company = document.getElementById("sco").value.trim() || undefined; var bv = document.getElementById("sbal").value.replace(/[$,\s]/g, ""); S.balance = bv === "" ? undefined : +bv; S.industry = document.getElementById("sind").value; S.size = document.getElementById("ssz").value; S.ccy = document.getElementById("sccy").value; var hw = document.getElementById("shelper"); if (hw) S.helperUrl = hw.value.trim(); if (S.helperUrl) CFG.worker = S.helperUrl; saveS(); await analyze(); toast("Saved"); go("home"); }
    else if (d.act === "wipe") { if (!confirmTwice(t)) return; await clearSrc(); S = {}; saveS(); ST.sources = []; ST.qa = []; ST.res = null; ST.model = null; render(); }
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
    var k = e.target.dataset && e.target.dataset.sc; if (!k) return;
    ST.sc[k] = e.target.tagName === "SELECT" ? e.target.value : +e.target.value;
    var lb = document.querySelector('[data-lbl="' + k + '"]'); if (lb && FMT[k]) lb.textContent = FMT[k](ST.sc[k]);
    runDecision(false);
  });
  var back = plug("App"); if (back) back.addListener("backButton", function () { if (document.getElementById("sheet")) closeSheet(); else if (ST.tab !== "home" && ST.res) go("home"); else back.exitApp(); });

  /* ---------- start ---------- */
  (async function start() {
    applyTheme(); if (S.helperUrl) CFG.worker = S.helperUrl; if (!S.device) { S.device = uid() + uid(); saveS(); }
    if (S.license && helperReady() && S.license.until - Date.now() < 5 * 864e5) helper("/renew", {}).then(function (r) { return setLicense(r.code); }).catch(function () { });
    try { ST.sources = await allSrc(); } catch (e) { ST.sources = []; }
    if (!S.demo && !ST.sources.length && !(S.costs || []).length) { render(); return; }
    await analyze(); render();
    if (S.conns && S.conns.length) syncAll(true);
    if (!S.fx || Date.now() - (S.fxAt || 0) > 864e5) refreshFx(true).then(function (ok) { if (ok) { S.fxAt = Date.now(); saveS(); } });
    if (S.brief) scheduleBrief();
  })().catch(function (e) { app.innerHTML = '<div class="panel"><b>Something went wrong starting Liquara.</b><p class="small mute">' + esc(e.message) + '</p><button class="btn" id="rst">Reset</button></div>'; var r = document.getElementById("rst"); if (r) r.onclick = function () { localStorage.clear(); indexedDB.deleteDatabase("aorta"); location.reload(); }; });
})();
