/* Aorta engine: finds the money data in whatever files or systems it is given, learns how cash
   really moves (recurring obligations, how late each customer pays, seasonality), forecasts with
   probability bands, grades itself against the past, and turns it into decisions.
   Runs entirely on the device. */
(function (root) {
  "use strict";
  var DAY = 864e5;

  /* ---------- small helpers ---------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function mean(a) { if (!a.length) return 0; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a) { if (a.length < 2) return 0; var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }
  function pct(sorted, p) { if (!sorted.length) return 0; var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
  function dayKey(d) { return Math.floor(d.getTime() / DAY); }
  function fromKey(k) { return new Date(k * DAY); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function clean(s) { return String(s == null ? "" : s).trim(); }

  /* ---------- reading values ---------- */
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(v, order) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
    var s = clean(v), m;
    if (/^\d{10}$/.test(s)) return parseDate(new Date(+s * 1000));
    if (/^\d{13}$/.test(s)) return parseDate(new Date(+s));
    if (/^\d{5}(\.\d+)?$/.test(s)) { var n = +s; if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * DAY); }
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return mk(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(s)) && /^\d{8}/.test(s)) return mk(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s))) { var a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; if (order === "dmy" || a > 12) return mk(y, b - 1, a); return mk(y, a - 1, b); }
    if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{2,4})/.exec(s))) { var mo = MON[m[2].slice(0, 4).toLowerCase()]; if (mo == null) mo = MON[m[2].slice(0, 3).toLowerCase()]; var yy = +m[3]; if (yy < 100) yy += 2000; if (mo != null) return mk(yy, mo, +m[1]); }
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s))) { var mo2 = MON[m[1].slice(0, 3).toLowerCase()]; if (mo2 != null) return mk(+m[3], mo2, +m[2]); }
    if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return mk(+m[1], +m[2] - 1, 1);
    return null;
    function mk(y, mo, d) { if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1980 || y > 2100) return null; return new Date(Date.UTC(y, mo, d)); }
  }
  function parseAmount(v) {
    if (v == null) return null; if (typeof v === "number") return isFinite(v) ? v : null;
    var s = clean(v); if (!s || s === "-") return null;
    var neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s) || /\bCR\b/i.test(s) && false;
    if (/\bDR\b/i.test(s)) neg = true;
    s = s.replace(/[^\d.,-]/g, "").replace(/^-/, "").replace(/-$/, "");
    if (!s) return null;
    if (/,\d{1,2}$/.test(s) && /\./.test(s.slice(0, -3))) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/,\d{1,2}$/.test(s) && !/\./.test(s)) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s); if (!isFinite(n)) return null; return neg ? -n : n;
  }

  /* ---------- reading files ---------- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    var first = text.split(/\r?\n/).slice(0, 6), best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (c) { var counts = first.map(function (l) { return l.split(c).length - 1; }).filter(function (n) { return n > 0; }); if (counts.length && counts.length >= Math.min(2, first.length)) { var sc = mean(counts) - sd(counts) * 2; if (sc > bestScore) { bestScore = sc; best = c; } } });
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === best) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(function (c) { return c !== ""; })) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some(function (c) { return c !== ""; })) rows.push(row);
    return table(rows);
  }
  /* pick the header row (some exports have title lines first) and turn rows into objects */
  function table(rows) {
    if (!rows.length) return { header: [], rows: [] };
    var hi = 0, bestS = -1;
    for (var i = 0; i < Math.min(10, rows.length); i++) { var r = rows[i], s = r.filter(function (c) { return /[A-Za-z]/.test(c) && !parseDate(c) && parseAmount(c) == null; }).length + (r.length >= 3 ? 1 : 0); if (s > bestS) { bestS = s; hi = i; } }
    var header = rows[hi].map(function (h, k) { return clean(h) || "Column " + (k + 1); });
    var out = rows.slice(hi + 1).filter(function (r) { return r.length > 1; }).map(function (r) { var o = {}; header.forEach(function (h, k) { o[h] = r[k] == null ? "" : r[k]; }); return o; });
    return { header: header, rows: out };
  }
  function parseJSON(text) {
    var data = typeof text === "string" ? JSON.parse(text) : text;
    var arr = findArray(data);
    var flat = arr.map(function (o) { var f = {}; flatten(o, "", f); return f; });
    var header = []; flat.slice(0, 50).forEach(function (o) { Object.keys(o).forEach(function (k) { if (header.indexOf(k) < 0) header.push(k); }); });
    return { header: header, rows: flat };
    function findArray(o) { if (Array.isArray(o)) { if (o.length && typeof o[0] === "object") return o; } if (o && typeof o === "object") { var best = []; for (var k in o) { var a = findArray(o[k]); if (a.length > best.length) best = a; } return best; } return []; }
    function flatten(o, p, out) { for (var k in o) { var v = o[k], key = p ? p + "." + k : k; if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out); else if (!Array.isArray(v)) out[key] = v; } }
  }
  function parseOFX(text) {
    var rows = [], re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi, m;
    function tag(b, t) { var x = new RegExp("<" + t + ">([^<\\r\\n]*)", "i").exec(b); return x ? x[1].trim() : ""; }
    while ((m = re.exec(text))) { var b = m[1]; rows.push({ Date: tag(b, "DTPOSTED").slice(0, 8), Amount: tag(b, "TRNAMT"), Name: tag(b, "NAME"), Memo: tag(b, "MEMO") }); }
    return { header: ["Date", "Amount", "Name", "Memo"], rows: rows };
  }
  async function parseXLSX(bytes) {
    var Z = root.JSZip || (typeof JSZip !== "undefined" ? JSZip : null) || (typeof global !== "undefined" ? global.JSZip : null); if (!Z) throw new Error("Excel reader not loaded");
    var zip = await Z.loadAsync(bytes), ss = [], ssx = zip.file("xl/sharedStrings.xml");
    if (ssx) { var sx = await ssx.async("string"); ss = (sx.match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) { return (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) { return dec(t.replace(/<[^>]+>/g, "")); }).join(""); }); }
    var wb = await zip.file("xl/workbook.xml").async("string"), dateStyles = {};
    var stx = zip.file("xl/styles.xml");
    if (stx) { var st = await stx.async("string"), cx = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st); if (cx) { var xfs = cx[1].match(/<xf [^>]*>/g) || []; xfs.forEach(function (x, i) { var id = +((/numFmtId="(\d+)"/.exec(x) || [])[1] || 0); if ((id >= 14 && id <= 22) || (id >= 164 && /yy|dd|mmm/i.test(numFmt(st, id)))) dateStyles[i] = 1; }); } }
    var sheets = Object.keys(zip.files).filter(function (f) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(f); }).sort();
    var results = [];
    for (var s = 0; s < sheets.length; s++) {
      var xml = await zip.file(sheets[s]).async("string"), rows = [];
      (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rx) {
        var row = [];
        (rx.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (cx) {
          var ref = (/r="([A-Z]+)\d+"/.exec(cx) || [])[1] || "", col = 0; for (var i = 0; i < ref.length; i++) col = col * 26 + ref.charCodeAt(i) - 64; col--;
          var t = (/t="(\w+)"/.exec(cx) || [])[1], sIdx = +((/s="(\d+)"/.exec(cx) || [])[1] || -1), v = (/<v>([\s\S]*?)<\/v>/.exec(cx) || [])[1], is = (/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cx) || [])[1];
          var val = t === "s" ? ss[+v] : t === "inlineStr" ? dec(is || "") : v == null ? "" : dec(v);
          if (dateStyles[sIdx] && /^\d+(\.\d+)?$/.test(val)) val = iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(+val) * DAY));
          row[col < 0 ? row.length : col] = val;
        });
        for (var k = 0; k < row.length; k++) if (row[k] == null) row[k] = "";
        if (row.some(function (c) { return c !== ""; })) rows.push(row);
      });
      if (rows.length > 1) results.push(table(rows));
    }
    void wb;
    return results;
    function dec(x) { return String(x).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
    function numFmt(st, id) { var m = new RegExp('numFmtId="' + id + '"[^>]*formatCode="([^"]*)"').exec(st); return m ? m[1] : ""; }
  }

  /* ---------- corporate bank statement formats ---------- */
  function yymmdd(s) { s = clean(s); if (!/^\d{6}$/.test(s)) return ""; return "20" + s.slice(0, 2) + "-" + s.slice(2, 4) + "-" + s.slice(4, 6); }
  /* BAI2 (US banks): 02 group date, 03 account and balances, 16 transactions, 88 continuation, 49 account end */
  function parseBAI2(text) {
    var lines = String(text).replace(/\r/g, "").split("\n"), rows = [], date = "", ccy = "", close = null, recs = [], cur = null;
    lines.forEach(function (l) { l = l.replace(/\/\s*$/, ""); if (!l) return; if (/^88,/.test(l) && cur) cur.push.apply(cur, l.slice(3).split(",")); else { cur = l.split(","); recs.push(cur); } });
    recs.forEach(function (r) {
      var t = r[0];
      if (t === "02") date = yymmdd(r[4]);
      else if (t === "03") { ccy = r[2] || ccy; close = null; for (var i = 3; i + 1 < r.length; i += 4) { if (r[i] === "015") close = +r[i + 1] / 100; else if (r[i] === "010" && close == null) close = +r[i + 1] / 100; } }
      else if (t === "16") { var code = +r[1], amt = +r[2] / 100, credit = code >= 100 && code < 400, desc = r.slice(6).join(" ").trim() || r.slice(4, 6).join(" ").trim(); if (!isFinite(amt)) return; rows.push({ Date: date, Amount: (credit ? amt : -amt).toFixed(2), Description: desc, Balance: "" }); }
      else if (t === "49" && rows.length && close != null) rows[rows.length - 1].Balance = close.toFixed(2);
    });
    return { header: ["Date", "Amount", "Description", "Balance"], rows: rows, currency: ccy || null, format: "BAI2" };
  }
  /* SWIFT MT940 */
  function parseMT940(text) {
    var t = String(text).replace(/\r/g, ""), rows = [], ccy = null, m, re = /:61:(\d{6})(\d{4})?(R?[CD])[A-Z]?([\d,]+)[^\n]*\n(?::86:([\s\S]*?)(?=\n:\d{2}[A-Z]?:|\n-|$))?/g;
    var o = /:60[FM]:[CD]\d{6}([A-Z]{3})/.exec(t); if (o) ccy = o[1];
    while ((m = re.exec(t))) { var a = parseFloat(m[4].replace(",", ".")), dc = m[3].replace("R", ""); rows.push({ Date: yymmdd(m[1]), Amount: (dc === "C" ? a : -a).toFixed(2), Description: clean((m[5] || "").replace(/\n/g, " ")), Balance: "" }); }
    var c = /:62F:([CD])(\d{6})[A-Z]{3}([\d,]+)/.exec(t); if (c && rows.length) rows[rows.length - 1].Balance = ((c[1] === "C" ? 1 : -1) * parseFloat(c[3].replace(",", "."))).toFixed(2);
    return { header: ["Date", "Amount", "Description", "Balance"], rows: rows, currency: ccy, format: "MT940" };
  }
  /* ISO 20022 camt.053 */
  function parseCAMT(text) {
    var x = String(text), rows = [], ccy = null, tag = function (b, n) { var r = new RegExp("<(?:\\w+:)?" + n + "[^>]*>([^<]*)<").exec(b); return r ? r[1].trim() : ""; };
    (x.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) || []).forEach(function (b) {
      var am = /<(?:\w+:)?Amt Ccy="([A-Z]{3})">([\d.]+)</.exec(b); if (!am) return; ccy = ccy || am[1];
      var dc = tag(b, "CdtDbtInd"), bi = b.search(/BookgDt/), dd = bi >= 0 ? /<(?:\w+:)?(?:Dt|DtTm)>([\d-]{10})/.exec(b.slice(bi)) : null;
      rows.push({ Date: dd ? dd[1] : "", Amount: ((dc === "DBIT" ? -1 : 1) * +am[2]).toFixed(2), Description: tag(b, "Nm") || tag(b, "Ustrd") || tag(b, "AddtlNtryInf"), Balance: "" });
    });
    (x.match(/<(?:\w+:)?Bal>[\s\S]*?<\/(?:\w+:)?Bal>/g) || []).forEach(function (b) { if (/>CLBD</.test(b) && rows.length) { var am = /<(?:\w+:)?Amt Ccy="([A-Z]{3})">([\d.]+)</.exec(b); if (am) rows[rows.length - 1].Balance = ((/>DBIT</.test(b) ? -1 : 1) * +am[2]).toFixed(2); } });
    return { header: ["Date", "Amount", "Description", "Balance"], rows: rows, currency: ccy, format: "camt.053" };
  }
  function sniff(name, text) { var t = String(text).slice(0, 3000); if (/^01,/.test(t) || /\.bai2?$/i.test(name)) return "bai2"; if (/\.(mt940|sta)$/i.test(name) || /:20:[\s\S]*:61:/.test(t)) return "mt940"; if (/camt\.053|BkToCstmrStmt/.test(t)) return "camt"; return null; }
  function currencyHint(text) { var t = String(text).slice(0, 20000); if (/€/.test(t)) return "EUR"; if (/£/.test(t)) return "GBP"; if (/¥/.test(t)) return "JPY"; if (/₹/.test(t)) return "INR"; return null; }

  /* ---------- finding the data on its own: schema inference ---------- */
  var NAMES = {
    date: /^(posted|post|trans(action)?|txn|value|booking|book|invoice|bill|doc(ument)?|issue[d]?|created|order)?[ _.-]*date$|^date$|^dt|posted on|date posted|timestamp|created_at|txn_date|transactiondate/i,
    due: /due/i,
    paid: /paid|payment date|date paid|paid on|settled|cleared|closed/i,
    amount: /^(net |gross |total |invoice |bill )?(amount|amt|total|value|sum|net|gross|balance due|amount due|total due|txn ?amt|trnamt)$|amount|total/i,
    debit: /debit|withdraw|money out|paid out|outflow|spent|^dr$|payment(s)?$/i,
    credit: /credit|deposit|money in|paid in|inflow|received|^cr$/i,
    party: /payee|payer|vendor|supplier|customer|client|merchant|counterparty|name|company|contact|description|narrative|details|memo/i,
    memo: /memo|description|narrative|details|reference|note|particulars/i,
    status: /status|state|paid\?/i,
    product: /product|item|sku|service|line|category|segment|offering/i,
    revenue: /revenue|sales|income|price total|net sales|gross sales/i,
    cost: /cost|cogs|cost of goods|expense/i,
    qty: /qty|quantity|units|volume|count/i,
    category: /categor|account|class|type|gl/i,
    balance: /balance|running/i,
    number: /invoice ?(#|no|num|number|id)|bill ?(#|no|num|number|id)|^(#|no|number|id|ref)$/i
  };
  function colStats(rows, h) {
    var n = 0, dates = 0, nums = 0, texts = 0, uniq = {}, ints = 0, posNeg = { p: 0, n: 0 };
    rows.slice(0, 400).forEach(function (r) { var v = clean(r[h]); if (!v) return; n++; uniq[v] = 1; var a = parseAmount(v); if (parseDate(v) && !/^\d+(\.\d+)?$/.test(v)) dates++; else if (/^(\d{8}|\d{10}|\d{13})$/.test(v) && parseDate(v)) dates++; else if (a != null && /^[\s$€£¥(+-]*[\d.,]+[)\s-]*(DR|CR)?$/i.test(v)) { nums++; if (a < 0) posNeg.n++; else posNeg.p++; if (Number.isInteger(a)) ints++; } else texts++; });
    return { n: n, date: n ? dates / n : 0, num: n ? nums / n : 0, text: n ? texts / n : 0, uniq: Object.keys(uniq).length, ints: nums ? ints / nums : 0, signs: posNeg };
  }
  function infer(t, fileName) {
    var H = t.header, rows = t.rows, S = {}, map = {}, used = {};
    H.forEach(function (h) { S[h] = colStats(rows, h); });
    function pick(role, test, extra) {
      var best = null, bs = 0;
      H.forEach(function (h) { if (used[h]) return; var s = (NAMES[role] && NAMES[role].test(h) ? 2 : 0) + (test ? test(S[h], h) : 0) + (extra ? extra(h) : 0); if (s > bs) { bs = s; best = h; } });
      if (best && bs >= 1.5) { map[role] = best; used[best] = 1; } return best;
    }
    var nm = (fileName || "") + " " + H.join(" ");
    var kind = /invoice|receivable|\bar\b|customer/i.test(nm) && /due/i.test(nm) ? "ar" : /\bbill|payable|\bap\b|vendor|supplier/i.test(nm) && /due/i.test(nm) ? "ap" : (/product|sku|item/i.test(nm) && /revenue|sales|price/i.test(nm) && /cost|cogs/i.test(nm)) ? "sales" : "bank";
    var dateT = function (s) { return s.date > 0.7 ? 1.5 : 0; }, numT = function (s) { return s.num > 0.7 ? 1 : 0; }, textT = function (s) { return s.text > 0.6 && s.uniq > 1 ? 1 : 0; };
    if (kind === "ar" || kind === "ap") {
      pick("due", dateT); pick("paid", function (s) { return s.date > 0.2 ? 1 : 0; });
      pick("date", dateT, function (h) { return /invoice|bill|issue|date/i.test(h) ? 0.5 : 0; });
      pick("amount", numT, function (h) { return /amount|total|due|balance/i.test(h) ? 0.5 : 0; });
      pick("party", textT, function (h) { return kind === "ar" ? (/customer|client|bill to/i.test(h) ? 1 : 0) : (/vendor|supplier|payee/i.test(h) ? 1 : 0); });
      pick("number", function (s) { return s.uniq > rows.length * 0.8 ? 0.5 : 0; }); pick("status", function (s) { return s.uniq <= 6 && s.text > 0.8 ? 1 : 0; });
    } else if (kind === "sales") {
      pick("date", function (s) { return s.date > 0.7 ? 1.5 : 0; }, function (h) { return /month|period|date/i.test(h) ? 0.5 : 0; });
      pick("product", textT); pick("revenue", numT); pick("cost", numT); pick("qty", function (s) { return s.num > 0.7 && s.ints > 0.9 ? 1 : 0; });
    } else {
      pick("date", dateT, function (h) { return /post|trans|date/i.test(h) ? 0.5 : 0; });
      var hasDC = H.some(function (h) { return NAMES.debit.test(h) && S[h].num + (S[h].n < rows.length ? 0.3 : 0) > 0.3; }) && H.some(function (h) { return NAMES.credit.test(h); });
      if (hasDC) { pick("debit", function (s) { return s.num > 0.3 ? 1 : 0; }); pick("credit", function (s) { return s.num > 0.3 ? 1 : 0; }); }
      else pick("amount", function (s) { return s.num > 0.7 ? (s.signs.n > 0 && s.signs.p > 0 ? 1.5 : 0.8) : 0; }, function (h) { return NAMES.balance.test(h) ? -2 : 0; });
      pick("party", textT, function (h) { return /payee|vendor|merchant|name|counterparty/i.test(h) ? 1 : /description|narrative|details/i.test(h) ? 0.6 : 0; });
      pick("memo", textT); pick("category", function (s) { return s.text > 0.6 && s.uniq < Math.max(4, rows.length * 0.2) ? 0.5 : 0; });
      pick("balance", numT);
      if (!map.amount && !map.debit) { var amtCol = H.filter(function (h) { return !used[h] && S[h].num > 0.7; })[0]; if (amtCol) { map.amount = amtCol; used[amtCol] = 1; } }
    }
    var need = kind === "sales" ? ["product", "revenue"] : kind === "bank" ? ["date"] : ["date", "amount", "party"];
    var missing = need.filter(function (r) { return !map[r]; });
    if (kind === "bank" && !map.amount && !map.debit) missing.push("amount");
    var conf = Math.max(0, Math.min(1, 1 - missing.length * 0.35 - (rows.length < 5 ? 0.3 : 0)));
    /* day-first or month-first? look at the date column */
    var order = "mdy"; if (map.date) { rows.slice(0, 300).some(function (r) { var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.]/.exec(clean(r[map.date])); if (m && +m[1] > 12) { order = "dmy"; return true; } return false; }); }
    return { kind: kind, map: map, missing: missing, confidence: conf, order: order, rows: rows.length, header: H };
  }

  /* ---------- turning rows into one model of the business ---------- */
  var CATS = [
    ["Payroll", /payroll|gusto|adp|paychex|salar|wages|rippling|justworks|trinet/i],
    ["Rent & facilities", /rent|lease|propert|prologis|landlord|cbre|regus|wework/i],
    ["Taxes", /\birs\b|tax|comptroller|treasury|hmrc|revenue service|franchise/i],
    ["Loans & interest", /loan|interest|credit line|\bloc\b|mortgage|financing|sba/i],
    ["Software", /subscription|software|saas|salesforce|microsoft|google workspace|quickbooks|netsuite|xero|adobe|slack|zoom|toast pos|canva|7shifts|atlassian|hubspot|snowflake|aws|azure|gcp|cloud|hosting/i],
    ["Utilities", /energy|electric|utilit|water|gas co|comcast|at&t|verizon|internet|phone/i],
    ["Insurance & benefits", /insurance|hartford|travelers|blue cross|benefit|health plan|aetna|cigna/i],
    ["Marketing", /ads|advertis|marketing|meta|facebook|google ads|linkedin|promo/i],
    ["Owner & distributions", /owner|draw|distribution|dividend/i],
    ["Equipment & capex", /capex|equipment|machine|robot|repair|service call|display case|haas|fanuc|hobart/i],
    ["Shipping", /ups|fedex|usps|dhl|freight|shipping/i],
    ["Card & platform sales", /square|stripe|shopify|paypal|toast|clover|settlement|merchant deposit/i],
    ["Transfers", /transfer|xfer|sweep|between accounts/i]
  ];
  function norm(p) { return clean(p).toLowerCase().replace(/(payment|bill|inv|invoice|ach|debit|credit|pos|purchase|card|batch|settlement|#)\s*[-\w]*\d[\w-]*/g, "").replace(/\d{3,}/g, "").replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" "); }
  function category(party, memo, amount, hint) { var s = party + " " + (memo || ""); for (var i = 0; i < CATS.length; i++) if (CATS[i][1].test(s)) return CATS[i][0]; if (hint) return hint; return amount > 0 ? "Customer receipts" : "Suppliers & other"; }

  function build(sources, opts) {
    opts = opts || {};
    var M = { tx: [], ar: [], ap: [], sales: [], sources: [], opening: null, warnings: [], base: opts.base || "USD", accounts: [] };
    function fx(ccy, k) { if (!ccy || ccy === M.base || !opts.rate) return 1; var r = opts.rate(ccy, k); if (r == null) { if (M.warnings.indexOf("No exchange rate for " + ccy + ": add one in Settings.") < 0) M.warnings.push("No exchange rate for " + ccy + ": add one in Settings."); return 1; } return r; }
    sources.forEach(function (src, si) {
      var t = src.table, inf = src.inferred || infer(t, src.name), map = inf.map, kind = src.kind || inf.kind, SC = src.scale || 1;
      function amt(v) { var x = parseAmount(v); return x == null ? null : x * SC; }
      M.sources.push({ name: src.name, kind: kind, rows: t.rows.length, confidence: inf.confidence, map: map, missing: inf.missing, origin: src.origin || "file" });
      var CCY = src.currency || t.currency || M.base;
      if (kind === "bank") {
        var lastBal = null, firstRow = null;
        t.rows.forEach(function (r) {
          var d = parseDate(r[map.date], inf.order); if (!d) return;
          var a = map.amount ? amt(r[map.amount]) : ((amt(r[map.credit]) || 0) - Math.abs(amt(r[map.debit]) || 0));
          if (a == null || a === 0) return;
          var f = fx(CCY, dayKey(d)); a *= f;
          var party = clean(r[map.party] || r[map.memo] || ""), memo = map.memo && map.memo !== map.party ? clean(r[map.memo]) : "";
          var o = { src: si, ccy: CCY, d: d, k: dayKey(d), a: a, party: party, key: norm(party) || norm(memo) || (a > 0 ? "deposit" : "payment"), memo: memo, cat: category(party, memo, a, map.category ? clean(r[map.category]) : "") };
          M.tx.push(o);
          if (map.balance) { var b = amt(r[map.balance]); if (b != null) { b *= f; if (!firstRow || d < firstRow.d) firstRow = { d: d, b: b, a: a }; if (!lastBal || d >= lastBal.d) lastBal = { d: d, b: b }; } }
        });
        M.accounts.push({ src: si, name: src.name, ccy: CCY, last: lastBal });
      } else if (kind === "ar" || kind === "ap") {
        t.rows.forEach(function (r) {
          var a = amt(r[map.amount]), issued = parseDate(r[map.date], inf.order), due = parseDate(r[map.due], inf.order) || (issued ? new Date(issued.getTime() + 30 * DAY) : null), paid = parseDate(r[map.paid], inf.order);
          if (a == null || !due) return; a *= fx(CCY, dayKey(issued || due));
          var st = clean(r[map.status]).toLowerCase(), open = paid ? false : /open|unpaid|due|overdue|outstanding|partial|sent|awaiting/.test(st) || !st || !/paid|closed|void|cancel/.test(st);
          if (/void|cancel|draft/.test(st)) return;
          (kind === "ar" ? M.ar : M.ap).push({ num: clean(r[map.number]), party: clean(r[map.party]), key: norm(r[map.party]), issued: issued, due: due, paid: paid, amount: Math.abs(a), open: open });
        });
      } else if (kind === "sales") {
        t.rows.forEach(function (r) { var rev = amt(r[map.revenue]); if (rev == null) return; var sd = parseDate(r[map.date]), sf = fx(CCY, sd ? dayKey(sd) : 0); M.sales.push({ ccy: CCY, d: sd, product: clean(r[map.product]) || "Other", revenue: rev * sf, cost: map.cost ? sf * Math.abs(amt(r[map.cost]) || 0) : null, qty: map.qty ? amt(r[map.qty]) : null }); });
      }
    });
    M.tx.sort(function (a, b) { return a.k - b.k; });
    M.asOf = M.tx.length ? fromKey(M.tx[M.tx.length - 1].k) : (M.ar.length ? new Date(Math.max.apply(null, M.ar.map(function (x) { return x.issued || x.due; }))) : new Date());
    var known = 0, missing = 0;
    M.accounts.forEach(function (ac) { if (!ac.last) { missing++; return; } var lk = dayKey(ac.last.d); ac.balance = ac.last.b + M.tx.filter(function (t) { return t.src === ac.src && t.k > lk; }).reduce(function (s, t) { return s + t.a; }, 0); known += ac.balance; });
    M.balance = M.accounts.length && missing < M.accounts.length ? known : null;
    if (missing && M.balance != null) M.warnings.push(missing + " bank file(s) have no balance column, so their cash isn't counted in today's total.");
    if (M.balance == null) { M.warnings.push("No running balance column found: set your current cash balance."); M.balance = 0; M.balanceUnknown = true; }
    return M;
  }

  /* ---------- learning the rhythm: recurring obligations and receipts ---------- */
  var PERIODS = [[7, "weekly"], [14, "every 2 weeks"], [15.2, "twice a month"], [30.4, "monthly"], [91.3, "quarterly"], [365, "yearly"]];
  function recurring(tx, uptoKey) {
    var groups = {};
    tx.forEach(function (t) { if (t.k > uptoKey) return; var g = (t.a > 0 ? "+" : "-") + t.key; (groups[g] = groups[g] || []).push(t); });
    var out = [];
    Object.keys(groups).forEach(function (g) {
      var L = groups[g]; if (L.length < 3) return;
      var days = {}; L.forEach(function (t) { days[t.k] = (days[t.k] || 0) + t.a; });
      var ks = Object.keys(days).map(Number).sort(function (a, b) { return a - b; }); if (ks.length < 3) return;
      var gaps = []; for (var i = 1; i < ks.length; i++) gaps.push(ks[i] - ks[i - 1]);
      var gm = median(gaps), per = null;
      PERIODS.forEach(function (p) { if (Math.abs(gm - p[0]) <= Math.max(2, p[0] * 0.12) && (!per || Math.abs(gm - p[0]) < Math.abs(gm - per[0]))) per = p; });
      if (!per) return;
      var good = gaps.filter(function (x) { return Math.abs(x - per[0]) <= Math.max(3, per[0] * 0.2); }).length / gaps.length;
      if (good < 0.7) return;
      if (uptoKey - ks[ks.length - 1] > per[0] * 2.2) return; /* stopped */
      var amts = ks.map(function (k) { return days[k]; }), recent = amts.slice(-6), med = median(recent), cv = Math.abs(sd(recent) / (med || 1));
      if (cv > 0.45 && per[0] < 60) return;
      /* gentle trend from the last year */
      var trend = 0; if (amts.length >= 6) { var h1 = mean(amts.slice(0, amts.length >> 1)), h2 = mean(amts.slice(amts.length >> 1)), span = (ks[ks.length - 1] - ks[0]) / 2 || 1; trend = h1 ? (h2 / h1 - 1) / span : 0; trend = Math.max(-0.002, Math.min(0.002, trend)); }
      var dom = per[0] >= 28 ? median(ks.map(function (k) { return fromKey(k).getUTCDate(); })) : null;
      out.push({ key: g.slice(1), dir: g[0], party: L[L.length - 1].party, cat: L[L.length - 1].cat, period: per[0], label: per[1], amount: med, cv: cv, trend: trend, last: ks[ks.length - 1], dom: dom, count: ks.length });
    });
    return out;
  }
  function nextDates(r, fromK, toK) {
    var out = [], k = r.last;
    if (r.period === 15.2) { var d = fromKey(r.last); for (var m = 0; m < 30; m++) { [15, 0].forEach(function (dd) { var x = dd ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 15)) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)); var xk = dayKey(x); if (xk > fromK && xk <= toK) out.push(xk); }); } return out.sort(function (a, b) { return a - b; }); }
    if (r.dom && r.period >= 28) { var d0 = fromKey(r.last), step = Math.round(r.period / 30.4); for (var i = 1; i < 40; i++) { var md = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i * step, 1)), last = new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 0)).getUTCDate(); var xk2 = dayKey(new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth(), Math.min(Math.round(r.dom), last)))); if (xk2 > toK) break; if (xk2 > fromK) out.push(xk2); } return out; }
    while (k + r.period <= toK) { k += r.period; if (k > fromK) out.push(Math.round(k)); }
    return out;
  }

  /* ---------- how late each customer pays (and how late we pay) ---------- */
  function delays(list, uptoKey) {
    var by = {}, all = [];
    list.forEach(function (x) { if (!x.paid || dayKey(x.paid) > uptoKey) return; var dl = Math.round((x.paid - x.due) / DAY); all.push(dl); (by[x.key] = by[x.key] || []).push(dl); });
    return { by: by, all: all.length ? all : [0] };
  }
  function openAt(list, k) { return list.filter(function (x) { var iss = x.issued ? dayKey(x.issued) : dayKey(x.due) - 30; return iss <= k && (!x.paid || dayKey(x.paid) > k); }); }

  /* ---------- the remaining flows: learn level, trend and season ---------- */
  function weekly(tx, fromK, toK, filter) { var n = Math.ceil((toK - fromK) / 7), w = []; for (var i = 0; i < n; i++) w.push(0); tx.forEach(function (t) { if (t.k <= fromK || t.k > toK || (filter && !filter(t))) return; var i2 = Math.floor((t.k - fromK - 1) / 7); if (i2 >= 0 && i2 < n) w[i2] += t.a; }); return w; }
  var METHODS = {
    recent: function (h) { return mean(h.slice(-13)); },
    trend: function (h, i) { var y = h.slice(-52), n = y.length; if (n < 8) return mean(h.slice(-13)); var xm = (n - 1) / 2, ym = mean(y), b = 0, d = 0; for (var j = 0; j < n; j++) { b += (j - xm) * (y[j] - ym); d += (j - xm) * (j - xm); } b = d ? b / d : 0; return ym + b * (n - 1 - xm + 1 + i) * 0.6; },
    seasonal: function (h, i) { if (h.length < 66) return METHODS.trend(h, i); var ly = h.length - 52 + i, base = mean(h.slice(Math.max(0, ly - 1), ly + 2)), r1 = mean(h.slice(-13)), r0 = mean(h.slice(-65, -52)); var ratio = r0 ? r1 / r0 : 1; if (!isFinite(ratio) || ratio < 0.3 || ratio > 3) ratio = 1; return base * ratio; }
  };

  /* fit everything from data up to cutoff key */
  function fit(M, cutK) {
    var arKeys = {}, apKeys = {}; M.ar.forEach(function (x) { arKeys[x.key] = 1; }); M.ap.forEach(function (x) { apKeys[x.key] = 1; });
    /* invoices and bills are modelled one by one, so they are not also treated as recurring */
    var rec = recurring(M.tx, cutK).filter(function (r) { return !(r.dir === "+" && arKeys[r.key]) && !(r.dir === "-" && apKeys[r.key]); }), recKeys = {}; rec.forEach(function (r) { recKeys[r.dir + r.key] = 1; });
    var firstK = M.tx.length ? M.tx[0].k : cutK - 7;
    var weeks = Math.floor((cutK - firstK) / 7), startK = cutK - weeks * 7;
    function resid(t) { return !recKeys[(t.a > 0 ? "+" : "-") + t.key] && !(t.a > 0 && arKeys[t.key]) && !(t.a < 0 && apKeys[t.key]); }
    return {
      rec: rec, arD: delays(M.ar, cutK), apD: delays(M.ap, cutK),
      resIn: weekly(M.tx, startK, cutK, function (t) { return t.a > 0 && resid(t); }),
      resOut: weekly(M.tx, startK, cutK, function (t) { return t.a < 0 && resid(t); }),
      arIn: weekly(M.tx, startK, cutK, function (t) { return t.a > 0 && arKeys[t.key]; }),
      apOut: weekly(M.tx, startK, cutK, function (t) { return t.a < 0 && apKeys[t.key]; }),
      cut: cutK
    };
  }

  /* ---------- the forecast: thousands of possible futures ---------- */
  function simulate(M, F, o) {
    o = o || {};
    var H = o.days || 371, sims = o.sims || 500, r = rng(o.seed || 11), cut = F.cut, sc = o.scenario || {}, meth = o.methods || M.methods || { in: "seasonal", out: "trend", ar: "seasonal", ap: "trend" };
    var noiseIn = o.noise ? o.noise.in : sd(F.resIn.slice(-26)), noiseOut = o.noise ? o.noise.out : sd(F.resOut.slice(-26));
    var W = Math.ceil(H / 7), base = { in: [], out: [], ar: [], ap: [] };
    for (var w = 0; w < W; w++) { base.in.push(Math.max(0, METHODS[meth.in](F.resIn, w))); base.out.push(Math.min(0, METHODS[meth.out](F.resOut, w))); base.ar.push(Math.max(0, METHODS[meth.ar](F.arIn, w))); base.ap.push(Math.min(0, METHODS[meth.ap](F.apOut, w))); }
    var openAR = o.openAR || openAt(M.ar, cut), openAP = o.openAP || openAt(M.ap, cut);
    var arOpenTotal = openAR.reduce(function (s, x) { return s + x.amount; }, 0), apOpenTotal = openAP.reduce(function (s, x) { return s + x.amount; }, 0);
    var avgARweek = mean(F.arIn.slice(-13)) || 1, avgAPweek = -mean(F.apOut.slice(-13)) || 1;
    var arCover = arOpenTotal / avgARweek, apCover = apOpenTotal / avgAPweek; /* weeks of flow already invoiced */
    var priceK = 1 + (sc.pricePct || 0) / 100, volK = 1 + (sc.volumePct || 0) / 100, costK = 1 + (sc.costPct || 0) / 100, cutMap = sc.cuts || {};
    var paths = [], start = o.startBalance != null ? o.startBalance : M.balance;
    for (var s = 0; s < sims; s++) {
      var flow = new Float64Array(H + 1);
      /* recurring obligations and receipts */
      F.rec.forEach(function (rc) {
        var cutP = cutMap[rc.cat] ? 1 - cutMap[rc.cat] / 100 : 1;
        nextDates(rc, cut, cut + H).forEach(function (k) { var j = k - cut + (rc.period < 20 ? 0 : Math.round(gauss(r) * 0.8)); if (j < 1 || j > H) return; var a = rc.amount * (1 + rc.trend * (k - rc.last)) * (1 + gauss(r) * Math.min(0.15, rc.cv * 0.6)); if (rc.dir === "+") a *= priceK * volK; else a *= cutP * costK; flow[j] += a; });
      });
      /* invoices already sent: collected when this customer usually pays */
      openAR.forEach(function (x) { var dl = F.arD.by[x.key] && F.arD.by[x.key].length >= 2 ? F.arD.by[x.key] : F.arD.all, d = dl[Math.floor(r() * dl.length)] - (sc.collectFaster || 0); var j = dayKey(x.due) + Math.max(d, -10) - cut; if (j < 1) j = 1 + Math.floor(r() * 10); if (j <= H) flow[j] += x.amount; });
      openAP.forEach(function (x) { var dl = F.apD.by[x.key] && F.apD.by[x.key].length >= 2 ? F.apD.by[x.key] : F.apD.all, d = dl[Math.floor(r() * dl.length)] + (sc.payLater || 0); var j = dayKey(x.due) + d - cut; if (j < 1) j = 1 + Math.floor(r() * 5); if (j <= H) flow[j] -= x.amount; });
      /* future invoices and bills, and everything else, from learned weekly patterns */
      for (var w2 = 0; w2 < W; w2++) {
        var rampAR = Math.min(1, Math.max(0, (w2 + 1 - arCover * 0.6) / Math.max(1, arCover * 0.8))), rampAP = Math.min(1, Math.max(0, (w2 + 1 - apCover * 0.6) / Math.max(1, apCover * 0.8)));
        if (!M.ar.length) rampAR = 1; if (!M.ap.length) rampAP = 1;
        var wi = base.in[w2] * priceK * volK + gauss(r) * noiseIn * 0.7, wo = base.out[w2] * costK + gauss(r) * noiseOut * 0.7;
        var wa = base.ar[w2] * rampAR * priceK * volK, wp = base.ap[w2] * rampAP * costK;
        var tot = Math.max(0, wi) + wa + Math.min(0, wo) + wp;
        for (var dd = 1; dd <= 7; dd++) { var j2 = w2 * 7 + dd; if (j2 <= H) flow[j2] += tot / 7; }
      }
      /* decisions */
      (sc.hires || []).forEach(function (hh) { var mk = monthKeys(cut, H); mk.forEach(function (mm, i) { if (i + 1 >= (hh.month || 1)) { var j3 = mm - cut; if (j3 >= 1 && j3 <= H) flow[j3] -= hh.count * hh.monthly; } }); });
      (sc.recurring || []).forEach(function (c) { for (var jr = Math.max(1, Math.round(c.first || c.every)); jr <= H; jr += c.every) flow[Math.round(jr)] -= c.amount; });
      (sc.oneOff || []).forEach(function (x) { var j4 = x.day || 1; if (j4 <= H) flow[j4] += x.amount; });
      if (sc.loan && sc.loan.amount) { var lj = (sc.loan.month || 1) * 30 - 29; if (lj <= H) flow[lj] += sc.loan.amount; var pay = sc.loan.amount * ((sc.loan.rate || 8) / 1200) / (1 - Math.pow(1 + (sc.loan.rate || 8) / 1200, -(sc.loan.months || 36))); for (var q = 1; q <= (sc.loan.months || 36); q++) { var pj = lj + q * 30; if (pj <= H) flow[pj] -= pay; } }
      var bal = new Float64Array(H + 1); bal[0] = start; for (var t = 1; t <= H; t++) bal[t] = bal[t - 1] + flow[t];
      paths.push(bal);
    }
    return summarize(paths, cut, H);
  }
  function monthKeys(cut, H) { var d = fromKey(cut), out = []; for (var i = 1; i <= Math.ceil(H / 30) + 1; i++) out.push(dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)))); return out; }
  function summarize(paths, cut, H) {
    var n = paths.length, days = [], weeks = [], months = [];
    function at(j) { var v = []; for (var i = 0; i < n; i++) v.push(paths[i][j]); v.sort(function (a, b) { return a - b; }); return { p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9) }; }
    for (var j = 0; j <= H; j++) days.push(at(j));
    for (var w = 1; w * 7 <= H; w++) weeks.push(Object.assign({ k: cut + w * 7 }, days[w * 7]));
    monthKeys(cut, H).forEach(function (mk) { var j2 = mk - cut - 1; if (j2 > 0 && j2 <= H) months.push(Object.assign({ k: mk - 1 }, days[j2])); });
    /* lowest point and chance of running short */
    var mins = []; for (var i = 0; i < n; i++) { var m = Infinity, mj = 0; for (var j3 = 1; j3 <= Math.min(H, 91); j3++) if (paths[i][j3] < m) { m = paths[i][j3]; mj = j3; } mins.push([m, mj]); }
    mins.sort(function (a, b) { return a[0] - b[0]; });
    var low = mins[Math.floor(n / 2)], below0 = mins.filter(function (x) { return x[0] < 0; }).length / n;
    var below0y = 0; for (var i2 = 0; i2 < n; i2++) { for (var j4 = 1; j4 <= H; j4++) if (paths[i2][j4] < 0) { below0y++; break; } }
    return { start: days[0].p50, days: days, weeks: weeks, months: months, low13: { value: low[0], date: fromKey(cut + low[1]) }, pShort13: below0, pShortYear: below0y / n, cut: cut, H: H, sims: n };
  }

  /* ---------- grading itself: forecast the past, compare with what happened ---------- */
  function backtest(M) {
    if (!M.tx.length) return null;
    var lastK = M.tx[M.tx.length - 1].k, firstK = M.tx[0].k, origins = [];
    [13, 17, 21, 26, 30, 35, 39].forEach(function (w) { var c = lastK - w * 7; if (c - firstK > 7 * 30) origins.push(c); });
    if (!origins.length) return null;
    var combos = [["seasonal", "trend"], ["trend", "trend"], ["recent", "recent"], ["seasonal", "seasonal"]], best = null, results = [];
    combos.forEach(function (cmb) {
      var errB = [], errIn = [], errOut = [], scaleB = [];
      origins.forEach(function (cut) {
        var F = fit(M, cut), balAt = balanceAtKey(M, cut);
        var f = simulate(M, F, { days: 91, sims: 40, startBalance: balAt, methods: { in: cmb[0], out: cmb[1], ar: cmb[0], ap: cmb[1] }, seed: 3 });
        for (var w = 1; w <= 13; w++) {
          var k = cut + w * 7, act = balanceAtKey(M, k), pred = f.days[w * 7].p50;
          errB.push(Math.abs(pred - act)); scaleB.push(Math.abs(act));
          var ai = 0, ao = 0; M.tx.forEach(function (t) { if (t.k > k - 7 && t.k <= k) { if (t.a > 0) ai += t.a; else ao -= t.a; } });
          errIn.push([ai, ai]); errOut.push([ao, ao]);
        }
        void errIn; void errOut;
      });
      var acc = 1 - mean(errB) / (mean(scaleB) || 1);
      results.push({ methods: cmb, accuracy: acc });
      if (!best || acc > best.accuracy) best = { methods: cmb, accuracy: acc };
    });
    /* weekly in/out accuracy with the chosen methods, from the most recent origin */
    var cut0 = origins[0], F0 = fit(M, cut0), fl = flowForecast(M, F0, { in: best.methods[0], out: best.methods[1], ar: best.methods[0], ap: best.methods[1] }, 13), ei = 0, si = 0, eo = 0, so = 0, rows = [];
    for (var w2 = 1; w2 <= 13; w2++) { var k2 = cut0 + w2 * 7, ai2 = 0, ao2 = 0; M.tx.forEach(function (t) { if (t.k > k2 - 7 && t.k <= k2) { if (t.a > 0) ai2 += t.a; else ao2 -= t.a; } }); ei += Math.abs(fl.in[w2 - 1] - ai2); si += ai2; eo += Math.abs(fl.out[w2 - 1] - ao2); so += ao2; rows.push({ week: w2, predBal: null, actIn: ai2, predIn: fl.in[w2 - 1], actOut: ao2, predOut: fl.out[w2 - 1] }); }
    var F1 = fit(M, cut0), sim1 = simulate(M, F1, { days: 91, sims: 120, startBalance: balanceAtKey(M, cut0), methods: { in: best.methods[0], out: best.methods[1], ar: best.methods[0], ap: best.methods[1] }, seed: 5 }), inBand = 0;
    rows.forEach(function (rw) { var d = sim1.days[rw.week * 7], act = balanceAtKey(M, cut0 + rw.week * 7); rw.predBal = d.p50; rw.actBal = act; rw.lo = d.p10; rw.hi = d.p90; if (act >= d.p10 && act <= d.p90) inBand++; });
    /* calibrate the bands from its own misses: how far off was it, by how far ahead it looked */
    var norm = [];
    origins.forEach(function (cut, oi) {
      var Fo = fit(M, cut), so = simulate(M, Fo, { days: 91, sims: 60, startBalance: balanceAtKey(M, cut), methods: { in: best.methods[0], out: best.methods[1], ar: best.methods[0], ap: best.methods[1] }, seed: 9 + oi });
      for (var h = 1; h <= 13; h++) { var e = balanceAtKey(M, cut + h * 7) - so.days[h * 7].p50; norm.push(Math.abs(e) / Math.sqrt(h)); }
    });
    norm.sort(function (a, b) { return a - b; });
    var calib = pct(norm, 0.8), hit = 0;
    rows.forEach(function (rw) { var sd2 = calib / 1.2816 * Math.sqrt(rw.week) * 1.2816; rw.lo = rw.predBal - Math.sqrt(Math.pow(rw.predBal - rw.lo, 2) + sd2 * sd2); rw.hi = rw.predBal + Math.sqrt(Math.pow(rw.hi - rw.predBal, 2) + sd2 * sd2); if (rw.actBal >= rw.lo && rw.actBal <= rw.hi) hit++; });
    inBand = hit;
    return { calib: calib, accuracy: Math.max(0, best.accuracy), methods: best.methods, compared: results, origins: origins.length, inflowAcc: si ? Math.max(0, 1 - ei / si) : null, outflowAcc: so ? Math.max(0, 1 - eo / so) : null, bandHit: inBand / rows.length, recent: rows, cut: cut0 };
  }
  function flowForecast(M, F, meth, weeks) {
    var inn = [], out = [], openAR = openAt(M.ar, F.cut), openAP = openAt(M.ap, F.cut), avgAR = mean(F.arIn.slice(-13)) || 1, avgAP = -mean(F.apOut.slice(-13)) || 1;
    var arCover = openAR.reduce(function (s, x) { return s + x.amount; }, 0) / avgAR, apCover = openAP.reduce(function (s, x) { return s + x.amount; }, 0) / avgAP;
    for (var w = 0; w < weeks; w++) {
      var lo = F.cut + w * 7, hi = lo + 7, i = Math.max(0, METHODS[meth.in](F.resIn, w)), o = -Math.min(0, METHODS[meth.out](F.resOut, w));
      var rA = M.ar.length ? Math.min(1, Math.max(0, (w + 1 - arCover * 0.6) / Math.max(1, arCover * 0.8))) : 1, rP = M.ap.length ? Math.min(1, Math.max(0, (w + 1 - apCover * 0.6) / Math.max(1, apCover * 0.8))) : 1;
      i += Math.max(0, METHODS[meth.ar](F.arIn, w)) * rA; o += -Math.min(0, METHODS[meth.ap](F.apOut, w)) * rP;
      F.rec.forEach(function (rc) { nextDates(rc, lo, hi).forEach(function () { if (rc.dir === "+") i += rc.amount; else o -= rc.amount; }); });
      openAR.forEach(function (x) { var dl = F.arD.by[x.key] && F.arD.by[x.key].length >= 2 ? median(F.arD.by[x.key]) : median(F.arD.all), k = dayKey(x.due) + dl; if (k <= F.cut) k = F.cut + 3; if (k > lo && k <= hi) i += x.amount; });
      openAP.forEach(function (x) { var dl = F.apD.by[x.key] && F.apD.by[x.key].length >= 2 ? median(F.apD.by[x.key]) : median(F.apD.all), k = dayKey(x.due) + dl; if (k <= F.cut) k = F.cut + 2; if (k > lo && k <= hi) o += x.amount; });
      inn.push(i); out.push(o);
    }
    return { in: inn, out: out };
  }
  function balanceAtKey(M, k) { var b = M.balance; for (var i = M.tx.length - 1; i >= 0 && M.tx[i].k > k; i--) b -= M.tx[i].a; return b; }

  /* ---------- understanding the business ---------- */
  function analyze(M, FC, BT) {
    var last = M.tx.length ? M.tx[M.tx.length - 1].k : dayKey(new Date()), y1 = last - 365, y0 = last - 730, q = last - 91;
    var A = { asOf: fromKey(last) };
    function sum(f) { return M.tx.reduce(function (s, t) { return f(t) ? s + t.a : s; }, 0); }
    A.in90 = sum(function (t) { return t.k > q && t.a > 0; }); A.out90 = -sum(function (t) { return t.k > q && t.a < 0; });
    A.inMonth = A.in90 / 3; A.outMonth = A.out90 / 3; A.netMonth = A.inMonth - A.outMonth;
    A.in12 = sum(function (t) { return t.k > y1 && t.a > 0; }); A.inPrev12 = sum(function (t) { return t.k > y0 && t.k <= y1 && t.a > 0; });
    A.out12 = -sum(function (t) { return t.k > y1 && t.a < 0; });
    A.growth = A.inPrev12 > 0 ? A.in12 / A.inPrev12 - 1 : null;
    A.balance = M.balance; A.runway = A.netMonth < 0 ? M.balance / -A.netMonth : null; A.cushionDays = A.outMonth ? M.balance / (A.outMonth / 30.4) : null;
    /* customers */
    var cust = {}; M.tx.forEach(function (t) { if (t.a > 0 && t.k > y1 && t.cat !== "Transfers" && t.cat !== "Loans & interest") { var c = cust[t.key] = cust[t.key] || { name: t.party.replace(/\s*(Payment|Card settlement).*$/i, "") || t.key, in: 0, n: 0 }; c.in += t.a; c.n++; } });
    var arD = delays(M.ar, last);
    A.customers = Object.keys(cust).map(function (k) { var c = cust[k], dl = arD.by[k]; var pooled = M.tx.some(function (t) { return t.key === k && t.cat === "Card & platform sales"; }); return { key: k, name: pooled ? c.name.replace(/\s+(inc|llc)\b.*$/i, "") + " card sales (many customers)" : c.name, pooled: pooled, in: c.in, share: A.in12 ? c.in / A.in12 : 0, late: dl && dl.length ? mean(dl) : null }; }).sort(function (a, b) { return b.in - a.in; });
    var named = A.customers.filter(function (c) { return !c.pooled; });
    A.topCustomer = named[0] || null;
    A.top1 = named[0] ? named[0].share : 0; A.top5 = named.slice(0, 5).reduce(function (s, c) { return s + c.share; }, 0);
    /* spending */
    var cats = {}, catsPrev = {}; M.tx.forEach(function (t) { if (t.a >= 0) return; if (t.k > y1) cats[t.cat] = (cats[t.cat] || 0) - t.a; else if (t.k > y0) catsPrev[t.cat] = (catsPrev[t.cat] || 0) - t.a; });
    A.spend = Object.keys(cats).map(function (c) { return { cat: c, amount: cats[c], prev: catsPrev[c] || 0, change: catsPrev[c] ? cats[c] / catsPrev[c] - 1 : null, share: A.out12 ? cats[c] / A.out12 : 0 }; }).sort(function (a, b) { return b.amount - a.amount; });
    /* receivables and payables */
    var openAR = M.ar.filter(function (x) { return x.open; }), openAP = M.ap.filter(function (x) { return x.open; });
    A.arOpen = openAR.reduce(function (s, x) { return s + x.amount; }, 0); A.apOpen = openAP.reduce(function (s, x) { return s + x.amount; }, 0);
    A.arOverdue = openAR.filter(function (x) { return dayKey(x.due) < last; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var paidAR = M.ar.filter(function (x) { return x.paid && x.issued && dayKey(x.paid) > y1; }), paidAP = M.ap.filter(function (x) { return x.paid && x.issued && dayKey(x.paid) > y1; });
    A.dso = paidAR.length ? paidAR.reduce(function (s, x) { return s + (x.paid - x.issued) / DAY * x.amount; }, 0) / paidAR.reduce(function (s, x) { return s + x.amount; }, 0) : null;
    A.dpo = paidAP.length ? paidAP.reduce(function (s, x) { return s + (x.paid - x.issued) / DAY * x.amount; }, 0) / paidAP.reduce(function (s, x) { return s + x.amount; }, 0) : null;
    A.slowPayers = A.customers.filter(function (c) { return c.late != null && c.late > 7; }).sort(function (a, b) { return b.late * b.in - a.late * a.in; });
    /* margins by product or service */
    var prod = {}; M.sales.forEach(function (s) { var p = prod[s.product] = prod[s.product] || { name: s.product, revenue: 0, cost: 0, qty: 0, hasCost: false, first: 0, lastQ: 0 }; p.revenue += s.revenue; if (s.cost != null) { p.cost += s.cost; p.hasCost = true; } p.qty += s.qty || 0; });
    var totRev = 0, totGP = 0; Object.keys(prod).forEach(function (k) { totRev += prod[k].revenue; totGP += prod[k].revenue - prod[k].cost; });
    A.gm = totRev ? totGP / totRev : null;
    A.products = Object.keys(prod).map(function (k) {
      var p = prod[k], gp = p.revenue - p.cost, m = p.revenue ? gp / p.revenue : 0, verdict, why;
      if (!p.hasCost) { verdict = "Add costs"; why = "No cost data, so the margin can't be judged."; }
      else if (m >= Math.max(0.5, (A.gm || 0.3) + 0.1)) { verdict = "Grow"; why = "High margin: every extra sale adds a lot of profit. Put sales and marketing effort here."; }
      else if (m >= 0.3) { verdict = "Keep"; why = "Healthy margin. Protect pricing."; }
      else if (m >= 0.12) { verdict = "Reprice"; why = "Thin margin: a small price rise or cost cut matters a lot here."; }
      else { verdict = "Fix or cut"; why = "Barely profitable after direct costs, before overhead. Raise prices, change the supplier, or consider dropping it."; }
      return { name: p.name, revenue: p.revenue, cost: p.cost, gp: gp, margin: m, share: totRev ? p.revenue / totRev : 0, gpShare: totGP ? gp / totGP : 0, qty: p.qty, verdict: verdict, why: why };
    }).sort(function (a, b) { return b.gp - a.gp; });
    A.recurring = (M.fitNow ? M.fitNow.rec : []).slice().sort(function (a, b) { return Math.abs(b.amount * 30 / b.period) - Math.abs(a.amount * 30 / a.period); });
    /* opportunities, worth in cash, ranked */
    var ops = [];
    A.slowPayers.slice(0, 3).forEach(function (c) { var freed = c.in / 365 * c.late; if (freed > 0) ops.push({ kind: "cash", title: "Get " + c.name + " to pay on time", value: freed, detail: c.name + " pays " + Math.round(c.late) + " days late on average. Paying on terms would free about " + money(freed) + " of cash for good.", action: "Send reminders before the due date, offer a 1% early-payment discount, or require a card on file." }); });
    if (A.dso && A.dso > 35) { var free2 = A.in12 / 365 * (A.dso - 30); ops.push({ kind: "cash", title: "Bring collection time down to 30 days", value: free2, detail: "Customers take " + Math.round(A.dso) + " days on average to pay. Cutting that to 30 days frees about " + money(free2) + ".", action: "Invoice on delivery, shorten terms for new customers, and automate reminders." }); }
    A.products.filter(function (p) { return p.verdict === "Reprice" || p.verdict === "Fix or cut"; }).forEach(function (p) { var up = p.revenue * 0.05; ops.push({ kind: "margin", title: (p.verdict === "Fix or cut" ? "Fix or drop " : "Reprice ") + p.name, value: up, detail: p.name + " keeps only " + Math.round(p.margin * 100) + "% after direct costs. A 5% price rise adds about " + money(up) + " a year in profit, with no new customers.", action: p.verdict === "Fix or cut" ? "Test a price rise first; if customers leave, compare the lost profit with the time and space freed." : "Raise prices 5% at the next renewal or menu change." }); });
    A.products.filter(function (p) { return p.verdict === "Grow"; }).slice(0, 2).forEach(function (p) { var gain = p.gp * 0.1; ops.push({ kind: "growth", title: "Sell more " + p.name, value: gain, detail: p.name + " earns " + Math.round(p.margin * 100) + "% margin. Growing it 10% adds about " + money(gain) + " a year in profit.", action: "Feature it first, train staff to suggest it, and aim marketing at it." }); });
    A.spend.filter(function (s) { return s.change != null && s.change > 0.25 && s.amount > A.out12 * 0.01; }).slice(0, 3).forEach(function (s) { var cutV = (s.amount - s.prev) * 0.5; ops.push({ kind: "cost", title: "Review rising " + s.cat.toLowerCase() + " spending", value: cutV, detail: s.cat + " is up " + Math.round(s.change * 100) + "% from last year, to " + money(s.amount) + ". Halving the increase saves about " + money(cutV) + " a year.", action: "List every vendor in this group, cancel what isn't used, and renegotiate the largest." }); });
    if (A.dpo != null && A.dpo < 25 && A.apOpen > 0) { var gain3 = A.out12 * 0.4 / 365 * (30 - A.dpo); if (gain3 > 0) ops.push({ kind: "cash", title: "Use your full payment terms", value: gain3, detail: "You pay suppliers in " + Math.round(A.dpo) + " days on average. Paying on day 30 (still on time) keeps about " + money(gain3) + " more in the bank.", action: "Schedule payments for the due date instead of on receipt." }); }
    A.opportunities = ops.sort(function (a, b) { return b.value - a.value; });
    /* risks */
    var risks = [];
    if (FC && FC.pShort13 > 0.05) risks.push({ level: FC.pShort13 > 0.25 ? "high" : "medium", title: "Chance of running out of cash in 13 weeks: " + Math.round(FC.pShort13 * 100) + "%", detail: "The lowest point is likely around " + fmtDate(FC.low13.date) + " at " + money(FC.low13.value) + "." });
    if (A.top1 > 0.2) risks.push({ level: A.top1 > 0.35 ? "high" : "medium", title: "One customer is " + Math.round(A.top1 * 100) + "% of cash coming in", detail: "Losing " + A.topCustomer.name + " would cut income by that much. Aim for no customer above 20%." });
    if (A.growth != null && A.growth < 0) risks.push({ level: "medium", title: "Cash coming in fell " + Math.round(-A.growth * 100) + "% from last year", detail: "Check whether it's fewer customers, smaller orders or slower payments." });
    if (A.arOverdue > A.inMonth * 0.25) risks.push({ level: "medium", title: money(A.arOverdue) + " of invoices are overdue", detail: "That's more than a week of normal income sitting with customers." });
    if (A.cushionDays != null && A.cushionDays < 30) risks.push({ level: "high", title: "Less than a month of spending in the bank", detail: "Cash covers about " + Math.round(A.cushionDays) + " days of normal spending." });
    A.risks = risks;
    A.accuracy = BT;
    return A;
  }
  var SYM = "$";
  function setCurrency(code, locale) { try { var p = new Intl.NumberFormat(locale || "en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0); SYM = (p.filter(function (x) { return x.type === "currency"; })[0] || {}).value || code + " "; } catch (e) { SYM = code + " "; } }
  function money(x) { var a = Math.abs(x), s = a >= 1e9 ? (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B" : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "K" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : Math.round(a).toString(); return (x < 0 ? "-" : "") + SYM + s; }
  var LOC = "en-US"; function setLocale(l) { LOC = l || "en-US"; }
  function fmtDate(d) { return d.toLocaleDateString(LOC, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

  /* ---------- one call does it all ---------- */
  function run(M, opts) {
    opts = opts || {};
    var cut = M.tx.length ? M.tx[M.tx.length - 1].k : dayKey(M.asOf);
    var BT = opts.skipBacktest ? M.bt : backtest(M);
    if (BT) M.methods = { in: BT.methods[0], out: BT.methods[1], ar: BT.methods[0], ap: BT.methods[1] };
    var F = fit(M, cut); M.fitNow = F;
    var FC = calibrate(simulate(M, F, { days: 371, sims: opts.sims || 500, scenario: opts.scenario }), BT);
    M.bt = BT;
    return { forecast: FC, analysis: analyze(M, FC, BT), fit: F };
  }
  function scenario(M, sc, sims) { return calibrate(simulate(M, M.fitNow, { days: 371, sims: sims || 300, scenario: sc }), M.bt); }
  /* widen the simulated bands by the error it actually made on this business's past */
  function Phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  function calibrate(FC, BT) {
    if (!BT || !BT.calib) return FC;
    var k = BT.calib / 1.2816;
    function widen(o, j) { var s = k * Math.sqrt(Math.max(1, j) / 7), lo = Math.sqrt(Math.pow(o.p50 - o.p10, 2) + Math.pow(1.2816 * s, 2)), hi = Math.sqrt(Math.pow(o.p90 - o.p50, 2) + Math.pow(1.2816 * s, 2)); o.p10 = o.p50 - lo; o.p90 = o.p50 + hi; o.sd = s; }
    FC.days.forEach(function (o, j) { if (j) widen(o, j); });
    FC.weeks.forEach(function (o) { widen(o, o.k - FC.cut); });
    FC.months.forEach(function (o) { widen(o, o.k - FC.cut); });
    var p13 = FC.pShort13, py = FC.pShortYear;
    FC.days.forEach(function (o, j) { if (!j || !o.sd) return; var p = Phi(-o.p50 / o.sd); if (j <= 91) p13 = Math.max(p13, p); py = Math.max(py, p); });
    FC.pShort13 = p13; FC.pShortYear = py; FC.calibrated = true;
    return FC;
  }


  /* ---------- what the lenses need ---------- */
  function meth(M) { return M.methods || { in: "seasonal", out: "trend", ar: "seasonal", ap: "trend" }; }
  function lastKey(M) { return M.tx.length ? M.tx[M.tx.length - 1].k : dayKey(M.asOf); }
  /* expected money in and out, day by day, with the named items behind it */
  function calendar(M, days) {
    var F = M.fitNow, cut = F.cut, out = [];
    for (var j = 0; j <= days; j++) out.push({ k: cut + j, in: 0, out: 0, items: [] });
    function add(k, amt, name, kind) { var j = k - cut; if (j < 1 || j > days) return; var d = out[j]; if (amt > 0) d.in += amt; else d.out -= amt; d.items.push({ name: name, amount: amt, kind: kind }); }
    F.rec.forEach(function (r) { nextDates(r, cut, cut + days).forEach(function (k) { add(k, r.amount, r.party, r.cat); }); });
    openAt(M.ar, cut).forEach(function (x) { var dl = F.arD.by[x.key] && F.arD.by[x.key].length >= 2 ? median(F.arD.by[x.key]) : median(F.arD.all), k = Math.max(cut + 2, dayKey(x.due) + Math.round(dl)); add(k, x.amount, x.party, "Customer payment"); });
    openAt(M.ap, cut).forEach(function (x) { var dl = F.apD.by[x.key] && F.apD.by[x.key].length >= 2 ? median(F.apD.by[x.key]) : median(F.apD.all), k = Math.max(cut + 1, dayKey(x.due) + Math.round(dl)); add(k, -x.amount, x.party, "Supplier bill"); });
    var fl = flowForecast(M, F, meth(M), Math.ceil(days / 7) + 1), rest = [];
    for (var w = 0; w * 7 < days; w++) {
      var named = { in: 0, out: 0 }; for (var j2 = w * 7 + 1; j2 <= Math.min(days, w * 7 + 7); j2++) { named.in += out[j2].in; named.out += out[j2].out; }
      var ri = Math.max(0, fl.in[w] - named.in), ro = Math.max(0, fl.out[w] - named.out);
      for (var j3 = w * 7 + 1; j3 <= Math.min(days, w * 7 + 7); j3++) { out[j3].in += ri / 7; out[j3].out += ro / 7; out[j3].typical = true; }
    }
    return out.slice(1);
  }
  function weeklyFlows(M, weeks) { var F = M.fitNow, fl = flowForecast(M, F, meth(M), weeks), r = []; for (var w = 0; w < weeks; w++) r.push({ k: F.cut + (w + 1) * 7, in: fl.in[w], out: fl.out[w] }); return r; }
  /* what actually happened, week by week, ending at the latest transaction */
  function pastWeeks(M, weeks) {
    var last = lastKey(M), r = [];
    for (var w = weeks - 1; w >= 0; w--) {
      var b = last - w * 7, a = b - 7, ins = 0, outs = 0;
      M.tx.forEach(function (t) { if (t.k > a && t.k <= b) { if (t.a > 0) ins += t.a; else outs -= t.a; } });
      r.push({ k: b, in: ins, out: outs, open: balanceAtKey(M, a), close: balanceAtKey(M, b) });
    }
    return r;
  }
  /* what we said a week ago vs what happened */
  function variance(M) {
    var last = lastKey(M), cut = last - 7; if (!M.tx.length || cut - M.tx[0].k < 120) return null;
    var F = fit(M, cut), fl = flowForecast(M, F, meth(M), 1), ai = 0, ao = 0;
    M.tx.forEach(function (t) { if (t.k > cut && t.k <= last) { if (t.a > 0) ai += t.a; else ao -= t.a; } });
    var start = balanceAtKey(M, cut);
    return { fIn: fl.in[0], aIn: ai, fOut: fl.out[0], aOut: ao, fEnd: start + fl.in[0] - fl.out[0], aEnd: balanceAtKey(M, last) };
  }
  /* days to collect and days to pay, month by month */
  function trends(M, months) {
    var last = lastKey(M), d = fromKey(last), out = [];
    for (var i = months - 1; i >= 0; i--) {
      var a = dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i - 2, 1))), b = dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1)));
      function w(list) { var s = 0, n = 0; list.forEach(function (x) { if (x.paid && x.issued) { var k = dayKey(x.paid); if (k >= a && k < b) { s += (x.paid - x.issued) / DAY * x.amount; n += x.amount; } } }); return n ? s / n : null; }
      out.push({ k: b, dso: w(M.ar), dpo: w(M.ap) });
    }
    return out;
  }
  /* payments that look wrong: duplicates, brand-new payees, amounts far above normal */
  function anomalies(M) {
    var last = lastKey(M), out = [], recent = last - 45, by = {};
    M.tx.forEach(function (t) { if (t.a < 0) (by[t.key] = by[t.key] || []).push(t); });
    var outs = M.tx.filter(function (t) { return t.a < 0; }).map(function (t) { return -t.a; }), big = pct(outs.slice().sort(function (a, b) { return a - b; }), 0.9);
    Object.keys(by).forEach(function (key) {
      var L = by[key];
      for (var i = 1; i < L.length; i++) { var a = L[i - 1], b = L[i]; if (b.k >= recent && b.k - a.k <= 3 && Math.abs(a.a - b.a) <= Math.abs(a.a) * 0.005) out.push({ type: "duplicate", level: "high", party: b.party, amount: -b.a, date: fromKey(b.k), detail: "Paid twice within " + (b.k - a.k || 0) + " days for the same amount." }); }
      var first = L[0];
      if (first.k >= recent && L.length <= 2 && -first.a >= big) out.push({ type: "new", level: "medium", party: first.party, amount: -first.a, date: fromKey(first.k), detail: "First payment ever to this payee, and a large one." });
      if (L.length >= 6) { var prev = L.slice(0, -1).map(function (t) { return -t.a; }), med = median(prev.slice(-12)), lt = L[L.length - 1]; if (lt.k >= recent && -lt.a > med * 1.6 && -lt.a - med > big * 0.15) out.push({ type: "jump", level: "medium", party: lt.party, amount: -lt.a, usual: med, date: fromKey(lt.k), detail: "Usually about " + money(med) + "." }); }
    });
    return out.sort(function (a, b) { return b.amount - a.amount; });
  }
  /* when will a goal be reached, on the likely path */
  function goalDate(FC, target) { for (var j = 1; j < FC.days.length; j++) if (FC.days[j].p50 >= target) return { j: j, date: fromKey(FC.cut + j), sure: FC.days[j].p10 >= target }; return null; }

  var api = { parseBAI2: parseBAI2, parseMT940: parseMT940, parseCAMT: parseCAMT, sniff: sniff, currencyHint: currencyHint, setCurrency: setCurrency, setLocale: setLocale, calendar: calendar, weeklyFlows: weeklyFlows, pastWeeks: pastWeeks, variance: variance, trends: trends, anomalies: anomalies, goalDate: goalDate, parseCSV: parseCSV, parseJSON: parseJSON, parseOFX: parseOFX, parseXLSX: parseXLSX, infer: infer, build: build, run: run, scenario: scenario, backtest: backtest, money: money, fmtDate: fmtDate, fromKey: fromKey, dayKey: dayKey, parseDate: parseDate, parseAmount: parseAmount, CATS: CATS.map(function (c) { return c[0]; }), iso: iso, balanceAtKey: balanceAtKey };
  if (typeof module !== "undefined") module.exports = api; else root.AOE = api;
})(typeof window !== "undefined" ? window : this);
