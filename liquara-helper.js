/* Liquara helper: a Cloudflare Worker.
   Paste this whole file into a new Cloudflare Worker, then add these settings (Settings → Variables and Secrets):
     STRIPE_SECRET        your Stripe secret key (sk_live_, rk_live_ or a test key)            [secret]
     LICENSE_KEY          the private key from getliquara.com/setup-keys                       [secret]
     ANTHROPIC_KEY        your Claude API key (for AI reading and the savings finder)          [secret]
     ADMIN_KEY            a long random password for the Liquara Admin app                     [secret]
     RESEND_KEY           your Resend API key, to email license keys to customers              [secret]
     PRICES               JSON, e.g. {"owner_month":"price_...", ... "enterprise_year":"price_..."}
     APP_ORIGIN           where the app lives, e.g. https://getliquara.com
     MAIL_FROM            optional, e.g. Liquara <support@getliquara.com>
     MODEL                optional, Claude model name (default claude-sonnet-5-5)
   And one storage binding (Settings → Bindings → KV namespace):  variable name  LQ
   No card numbers ever touch this helper: Stripe's embedded form talks to Stripe directly. */

const VERSION = "2.2";
const DAY = 864e5;
const OK_STATUS = ["trialing", "active", "past_due"];
const DEVICE_LIMIT = { owner: 2, business: 5, enterprise: 25 };
const SAVINGS_PER_MONTH = { owner: 20, business: 100, enterprise: 500 };
const READS_PER_DAY = { owner: 60, business: 200, enterprise: 1000 };
const NEWS_PER_DAY = { owner: 6, business: 15, enterprise: 40 };
const COMPETE_PER_MONTH = { owner: 4, business: 15, enterprise: 50 };
const TIERS = ["owner", "business", "enterprise"], TIER_MAX = { owner: 10e6, business: 100e6 };
/* plan a business must be on, from yearly money in; 15% leeway so one big month doesn't trip it */
function tierFor(rev) { rev = +rev || 0; if (rev > TIER_MAX.business * 1.15) return "enterprise"; if (rev > TIER_MAX.owner * 1.15) return "business"; return "owner"; }
const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const rank = (t) => Math.max(0, TIERS.indexOf(t));
const HEADERS = "Content-Type, X-Liquara-License, X-Liquara-Device, X-Liquara-Admin";

class HttpErr extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || ""; } }
const J = (o, s = 200, origin = "*") => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", "Vary": "Origin" } });

/* ---------- Stripe ---------- */
async function stripe(env, path, params, method = "POST") {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v === undefined || v === null) return; if (typeof v === "object") Object.entries(v).forEach(([kk, vv]) => add(`${k}[${kk}]`, vv)); else body.append(k, String(v)); };
  Object.entries(params || {}).forEach(([k, v]) => add(k, v));
  const r = await fetch("https://api.stripe.com/v1/" + path + (method === "GET" && params ? "?" + body : ""), { method, headers: { Authorization: "Bearer " + env.STRIPE_SECRET, "Content-Type": "application/x-www-form-urlencoded" }, body: method === "GET" ? undefined : body });
  const j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || "Stripe error"); return j;
}
async function listAll(env, path, params, max = 1000) {
  const out = []; let after;
  while (out.length < max) {
    const p = Object.assign({ limit: 100 }, params); if (after) p.starting_after = after;
    const page = await stripe(env, path, p, "GET"); out.push(...page.data);
    if (!page.has_more || !page.data.length) break; after = page.data[page.data.length - 1].id;
  }
  return out;
}
const periodEnd = (sub) => sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || sub.trial_end || null;

/* ---------- signed passes (short-lived, renewed online) ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function sign(env, payload) {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.LICENSE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = "LQ1." + b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return head + "." + b64u(sig);
}
async function verifyPass(env, code, allowExpired) {
  try {
    const parts = String(code || "").trim().split("."); if (parts.length !== 3 || parts[0] !== "LQ1") return null;
    const j = JSON.parse(env.LICENSE_KEY), pub = { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
    const key = await crypto.subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
    if (!allowExpired && p.e && p.e < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}
function sameKey(a, b) { a = String(a || ""); b = String(b || ""); if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

/* ---------- license records (Cloudflare KV, binding name LQ) ---------- */
function store(env) { if (!env.LQ) throw new HttpErr(500, "The helper's license storage isn't connected yet (KV binding named LQ)."); return env.LQ; }
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newKey() { const b = crypto.getRandomValues(new Uint8Array(12)); let s = ""; for (let i = 0; i < 12; i++) { s += ALPHA[b[i] % ALPHA.length]; if (i === 3 || i === 7) s += "-"; } return "LQ-" + s; }
const cleanKey = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^LQ/, "").replace(/(.{4})(.{4})(.{4}).*/, "LQ-$1-$2-$3");
async function getLic(env, key) { const v = await store(env).get("lic:" + key); return v ? JSON.parse(v) : null; }
async function putLic(env, lic) {
  await store(env).put("lic:" + lic.key, JSON.stringify(lic), { metadata: { k: lic.key, e: lic.email || "", m: lic.name || "", p: lic.plan, s: lic.sub, st: lic.status || "", r: lic.revoked ? 1 : 0, n: Object.keys(lic.devices || {}).length, c: lic.lastCheck || 0, t: lic.created, x: lic.periodEnd || 0, em: lic.emailed || 0, rv: lic.rev || 0, nd: lic.needs || "" } });
}
async function licForSub(env, sub, email, name) {
  const S = store(env), idx = await S.get("sub:" + sub.id);
  if (idx) { const l = await getLic(env, idx); if (l) return l; }
  let key; do { key = newKey(); } while (await S.get("lic:" + key));
  const lic = { key, sub: sub.id, cust: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id, email: email || "", name: name || "", plan: (sub.metadata && sub.metadata.plan) || "owner", created: Date.now(), devices: {}, revoked: false, status: sub.status, periodEnd: periodEnd(sub), trialEnd: sub.trial_end || null };
  await putLic(env, lic); await S.put("sub:" + sub.id, key);
  return lic;
}
async function customerOf(env, sub) { try { const c = typeof sub.customer === "object" ? sub.customer : await stripe(env, "customers/" + sub.customer, null, "GET"); return { email: c.email || "", name: c.name || "" }; } catch (e) { return { email: "", name: "" }; } }

/* Checks everything on the server, then issues a 2-day pass for one device. */
async function issue(env, lic, sub, device) {
  if (lic.revoked) throw new HttpErr(403, "This license has been turned off. Contact support@getliquara.com.", "revoked");
  lic.status = sub.status; lic.periodEnd = periodEnd(sub);
  { const pid = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id, hit = Object.entries(JSON.parse(env.PRICES || "{}")).find(([, v]) => v === pid); if (hit) lic.plan = hit[0].split("_")[0]; }
  if (lic.needs && rank(lic.needs) <= rank(lic.plan)) lic.needs = ""; lic.trialEnd = sub.trial_end || lic.trialEnd || null;
  if (!OK_STATUS.includes(sub.status)) { await putLic(env, lic); throw new HttpErr(402, sub.status === "canceled" ? "Your plan has ended. Choose a plan to keep going." : "Your plan isn't active (" + sub.status + "). Update your card in Manage billing.", "inactive"); }
  device = String(device || "").slice(0, 64); if (!device) throw new HttpErr(400, "Missing device");
  lic.devices = lic.devices || {};
  if (!lic.devices[device]) {
    const limit = DEVICE_LIMIT[lic.plan] || 2, n = Object.keys(lic.devices).length;
    if (n >= limit) throw new HttpErr(409, "This license is already used on " + n + " devices, the most your plan allows. Ask support@getliquara.com to free one up.", "devices");
  }
  lic.devices[device] = Date.now(); lic.lastCheck = Date.now();
  await putLic(env, lic);
  const pe = lic.periodEnd ? lic.periodEnd * 1000 + DAY : Date.now() + 2 * DAY;
  const e = Math.min(Date.now() + 2 * DAY, Math.max(pe, Date.now() + 6 * 3600e3));
  return sign(env, { p: lic.plan, e, s: lic.sub, l: lic.key, d: device });
}

/* AI features need a valid, current pass and a license that hasn't been turned off. */
async function needLicense(env, req) {
  const p = await verifyPass(env, req.headers.get("X-Liquara-License"), false);
  if (!p || !p.l) throw new HttpErr(401, "Start your free trial to use AI features.", "nolicense");
  const lic = await getLic(env, p.l);
  if (!lic || lic.revoked) throw new HttpErr(403, "This license has been turned off.", "revoked");
  if (!OK_STATUS.includes(lic.status)) throw new HttpErr(402, "Your plan isn't active.", "inactive");
  if (lic.needs && rank(lic.needs) > rank(lic.plan)) throw new HttpErr(402, "Your business has outgrown the " + cap(lic.plan) + " plan. Switch to " + cap(lic.needs) + " to keep using AI features.", "tier");
  return { p, lic };
}
async function bump(env, key, add, limit, ttl, msg) {
  const S = store(env), n = +(await S.get(key) || 0);
  if (n + add > limit) throw new HttpErr(429, msg, "limit");
  await S.put(key, String(n + add), { expirationTtl: ttl });
}
const today = () => new Date().toISOString().slice(0, 10), month = () => new Date().toISOString().slice(0, 7);

/* ---------- email (Resend) ---------- */
async function sendKeyEmail(env, lic) {
  if (!env.RESEND_KEY || !lic.email) return false;
  const plan = lic.plan.charAt(0).toUpperCase() + lic.plan.slice(1), app = (env.APP_ORIGIN || "https://getliquara.com");
  const trial = lic.trialEnd && lic.trialEnd * 1000 > Date.now() ? new Date(lic.trialEnd * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#070b16;color:#f3f6fb;padding:32px"><div style="max-width:520px;margin:0 auto">
<p style="color:#c8ff4d;font-weight:700;letter-spacing:.12em;font-size:12px;margin:0 0 12px">LIQUARA</p>
<h1 style="font-size:26px;margin:0 0 12px">Welcome to Liquara ${plan}</h1>
<p style="color:#b8c3da;line-height:1.6">Here is your license key. Keep this email: you'll need the key to unlock Liquara on another phone or computer.</p>
<div style="background:#111a2e;border:1px solid #c8ff4d;border-radius:14px;padding:18px;text-align:center;font-size:24px;font-weight:800;letter-spacing:.08em;color:#c8ff4d;margin:20px 0">${lic.key}</div>
<p style="color:#b8c3da;line-height:1.6"><b style="color:#f3f6fb">To use it:</b> open <a href="${app}" style="color:#c8ff4d">${app.replace(/^https?:\/\//, "")}</a> or the Android app → Menu → Plan &amp; billing → <i>Have a license key?</i> → paste it → Unlock.</p>
${trial ? `<p style="color:#b8c3da;line-height:1.6">Your free trial runs until <b style="color:#f3f6fb">${trial}</b>. Cancel any time in the app under Manage billing.</p>` : ""}
<p style="color:#93a0bd;font-size:13px;line-height:1.6;margin-top:24px">Each key works on up to ${DEVICE_LIMIT[lic.plan] || 2} devices. Questions? Reply to this email or write to support@getliquara.com.</p></div></div>`;
  const text = `Welcome to Liquara ${plan}\n\nYour license key: ${lic.key}\n\nTo use it: open ${app} or the Android app, go to Menu > Plan & billing > Have a license key?, paste it and tap Unlock.\n${trial ? "Your free trial runs until " + trial + ".\n" : ""}\nQuestions? support@getliquara.com`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM || "Liquara <support@getliquara.com>", to: [lic.email], reply_to: "support@getliquara.com", subject: "Your Liquara license key", html, text }) });
  if (!r.ok) return false;
  lic.emailed = Date.now(); await putLic(env, lic); return true;
}


/* ---------- company lookup (SEC EDGAR: free, official, US-listed companies) ---------- */
const SEC_UA = { "User-Agent": "Liquara support@getliquara.com", "Accept": "application/json" };
let TICKERS = null, TICKERS_AT = 0;
async function tickers(env) {
  if (TICKERS && Date.now() - TICKERS_AT < 12 * 3600e3) return TICKERS;
  let raw = await store(env).get("sec:tickers");
  if (!raw) {
    const r = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: SEC_UA });
    if (!r.ok) throw new HttpErr(502, "The company list is busy. Try again in a minute.");
    const j = await r.json(); raw = JSON.stringify((j.data || []).map(d => [d[0], d[1], d[2], d[3]])); /* cik, name, ticker, exchange */
    await store(env).put("sec:tickers", raw, { expirationTtl: 86400 });
  }
  TICKERS = JSON.parse(raw).map(x => [x[0], x[1], x[2], x[3], String(x[1]).toLowerCase()]); TICKERS_AT = Date.now(); return TICKERS;
}
const KEEP_UP = /^(LLC|LP|LLP|PLC|NV|SA|AG|SE|ADR|REIT|USA|US|II|III|IV|AT&T|IBM|3M|UPS|CVS|HP|PNC|AES|NRG)$/;
function nice(s) { s = String(s || ""); if (/[a-z]/.test(s)) return s; return s.toLowerCase().replace(/[a-z0-9&'.]+/g, (w) => KEEP_UP.test(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).replace(/\/(?:De|Ny|Md|Pa|Nv|Ca|Tx|Wa)\/?$/i, "").trim(); }
function searchCo(list, q) {
  q = String(q || "").trim(); if (q.length < 1) return [];
  const t = q.toUpperCase().replace(/^\$/, ""), l = q.toLowerCase(), seen = new Set(), out = [];
  const add = (x) => { if (!seen.has(x[0]) && out.length < 8) { seen.add(x[0]); out.push({ cik: x[0], name: nice(x[1]), ticker: x[2], exchange: x[3] }); } };
  list.filter(x => x[2] === t).forEach(add);
  list.filter(x => x[4].startsWith(l)).forEach(add);
  if (l.length >= 3) list.filter(x => x[4].includes(l) || (x[2] && x[2].startsWith(t))).forEach(add);
  return out;
}
const REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerIncludingAssessedTax"];
async function secCompany(env, cik) {
  cik = String(parseInt(cik, 10) || ""); if (!cik) throw new HttpErr(400, "Pick a company from the list");
  const ck = "sec:co:" + cik, hit = await store(env).get(ck); if (hit) return JSON.parse(hit);
  const pad = cik.padStart(10, "0"), r = await fetch("https://data.sec.gov/submissions/CIK" + pad + ".json", { headers: SEC_UA });
  if (!r.ok) throw new HttpErr(404, "We couldn't find that company's filings");
  const s = await r.json(), ad = (s.addresses && s.addresses.business) || {};
  let rev = 0, fy = "";
  const facts = await Promise.all(REV_TAGS.map(tag => fetch("https://data.sec.gov/api/xbrl/companyconcept/CIK" + pad + "/us-gaap/" + tag + ".json", { headers: SEC_UA }).then(x => x.ok ? x.json() : null).catch(() => null)));
  let best = null;
  facts.forEach(f => ((f && f.units && f.units.USD) || []).forEach(v => {
    const days = (new Date(v.end) - new Date(v.start)) / 864e5;
    if (/^10-K/.test(v.form || "") && days > 340 && days < 380 && v.val > 0 && (!best || v.end > best.end || (v.end === best.end && v.val > best.val))) best = v;
  }));
  if (best) { rev = best.val; fy = best.end; }
  const out = { cik, name: nice(s.name), tickers: s.tickers || [], exchanges: s.exchanges || [], sic: s.sic || "", sector: s.sicDescription || "", city: nice(ad.city || ""), state: ad.stateOrCountryDescription || ad.stateOrCountry || "", website: s.website || "", revenue: rev, revenueYear: fy, listed: true, source: "SEC EDGAR" };
  await store(env).put(ck, JSON.stringify(out), { expirationTtl: 7 * 86400 });
  return out;
}
const FIND_PROMPT = (q) => `Find the real business called "${q.name}"${q.region ? " in or near " + q.region : ""}. Search the web. Return ONLY JSON:
{"matches":[{"name":"official name","industry":"what it does, a few words","city":"","state":"state or country","website":"","revenue":0,"revenueNote":"where the revenue figure comes from, or 'estimate'","employees":"","listed":false,"ticker":""}]}
Up to 3 matches, best first. "revenue" is yearly revenue in US dollars from a public source, or a careful estimate from employees and locations (say so in revenueNote), or 0 if you can't tell. Never invent a business that doesn't exist.`;

/* ---------- AI ---------- */
async function claude(env, content, tools, maxTokens = 4000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: env.MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, tools, messages: [{ role: "user", content }] }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || "AI error");
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error("The AI didn't return data"); return JSON.parse(m[0]);
}
const EXTRACT_PROMPT = `You read business financial documents of any kind (bank statements, invoices, bills, receipts, contracts, spreadsheets, price lists, notes) and return ONLY JSON, no other text:
{"kind":"bank"|"ar"|"ap"|"sales"|"costs","currency":"ISO code or null","header":[...column names...],"rows":[{...one object per line item...}],"costs":[{"vendor":"","amount":0,"every":30.4,"category":""}]}
Rules: for "bank" use header ["Date","Amount","Description","Balance"] with money out negative. For "ar" (invoices to customers) use ["Invoice #","Customer","Invoice Date","Due Date","Amount","Date Paid","Status"]. For "ap" (bills from suppliers) use ["Bill No","Vendor","Bill Date","Due Date","Total","Paid On","Status"]. For "sales" use ["Month","Product","Units","Revenue","Cost of Goods"]. Dates as YYYY-MM-DD. Put recurring costs (subscriptions, contracts, rent, insurance, services) in "costs" with "every" = days between payments (30.4 monthly, 91.3 quarterly, 365 yearly). Never invent numbers; skip anything unreadable.`;
const SAVINGS_PROMPT = (q) => `A ${q.size || ""} ${q.industry || ""} business pays "${q.vendor}" (${q.category || "service"}) about ${q.monthly} ${q.currency} per month.
Search the web for current pricing and return ONLY JSON:
{"similar":[{"name":"","price":"","saves":"","note":"","url":""}],"different":[{"name":"","price":"","saves":"","note":"","url":""}],"checked":"YYYY-MM-DD"}
"similar": 3-5 products that do the same job for less. "different": 2-4 different approaches that still meet the same need but save more (e.g. a lighter tool plus another app, bundled plans, renegotiation, in-house). Use real published prices with the source page URL; if a price isn't public say "quote only". "saves" is the estimated monthly saving versus ${q.monthly} ${q.currency}. Note the main trade-off in "note". Be accurate; never invent prices.`;

const NEWS_PROMPT = (q) => `You brief the owner of a ${q.size ? q.size + " " : ""}${q.industry} business in ${q.region}. Search the web for news from the last 14 days that could affect this kind of business: prices of what they buy, demand from customers, interest rates and lending, labor and wages, regulation and taxes, tariffs and trade, weather and disasters, technology shifts, big competitor moves, local economy. Use several different, reputable sources (wire services, national and regional papers, trade publications, government releases). Skip anything that doesn't matter to this business.
Return ONLY JSON:
{"items":[{"headline":"","source":"publication name","url":"","date":"YYYY-MM-DD","level":"now"|"soon"|"watch","summary":"","forYou":"","move":"","confidence":"high"|"medium"|"low"}],"takeaway":""}
Rules: 6-10 items, most important first. "level": "now" = likely to hit this business's cash or operations within weeks, act this week; "soon" = clear effect in the next few months, plan for it; "watch" = worth knowing, could matter later. "summary": 1-2 plain sentences, no jargon. "forYou": what it most likely means for THIS kind of business in plain words, with direction and rough size when possible (e.g. "food costs up about 3-5%"). "move": one concrete action. "takeaway": one sentence on the overall picture. Only real articles with working URLs; never invent news, numbers or sources.`;
const COMPETE_PROMPT = (q) => `A ${q.industry || "business"} in ${q.region || "the United States"} brings in about ${q.revenue ? "$" + Math.round(q.revenue).toLocaleString("en-US") : "an unknown amount"} a year${q.name ? " (business name: " + q.name + ")" : ""}${q.ticker ? ". It is publicly traded as " + String(q.ticker).slice(0, 10) + ": use its filings and rank it against both public and private competitors" : ""}${q.notes ? ". Notes from the owner: " + q.notes : ""}.
Search the web to map its competitive field: the real businesses competing for the same customers in the same market (local if it's a local business, national or global if it's larger). Estimate each one's size from public sources (revenue, locations, employees, reviews, funding) and rank them.
Return ONLY JSON:
{"market":"one-line description of the market","rank":[{"name":"","est":"e.g. ~$40M revenue, 12 locations","strengths":"","url":"","you":false}],"position":{"place":0,"of":0,"summary":""},"nextRung":{"name":"","gap":"what separates them, concretely","closeIt":""},"stepByStep":[{"step":"","why":"","timeframe":"","cost":"low|medium|high"}],"bigLeap":[{"move":"","why":"","risk":"","cost":"low|medium|high"}],"tools":[{"name":"","what":"","fit":"","price":"","url":""}],"buy":{"sameField":[{"target":"kind of business or a real example","why":"","price":"typical price range, e.g. 2-4x yearly profit","pay":"how a business this size usually pays: cash, SBA/bank loan, seller financing, earn-out, shares","risk":""}],"newFields":[{"field":"","why":"how it connects to what they already do (same customers, same skills, same suppliers)","entry":"buy a small player, start one, or partner","price":"","risk":""}],"ready":"plain-English check of whether this business looks ready to buy now, and what to have in place first (cash cushion, clean books, lender, advisor)"},"liquara":["how to use Liquara's own features (forecast, decision simulator, savings finder, alerts, budget vs actual, board pack) to support this plan, including testing whether they can afford an acquisition"]}
Rules: 5-10 competitors plus one entry with "you":true placed where this business most likely ranks by size, named "${q.name || "You"}". "position.place" is that rank. "stepByStep": 4-6 practical moves to climb one rung at a time. "bigLeap": 2-3 bolder moves that could jump several places, with honest risks. "buy.sameField": 2-4 acquisition ideas inside their field (competitors, suppliers, local players near retirement, struggling rivals). "buy.newFields": 2-3 adjacent or new fields worth entering by acquisition. Use realistic small-business or mid-market price multiples for that industry from public sources and say they are typical ranges, not quotes. Be honest when buying is too early for this size. "tools": 4-6 real tools, including AI tools, that would streamline the plan, with real published prices or "quote only". Plain English. Never invent companies, numbers or URLs; if estimates are uncertain, say "estimate".`;
const LANGS = { en: "English", es: "Spanish", fr: "French", pt: "Brazilian Portuguese", de: "German", zh: "Simplified Chinese", ja: "Japanese", ko: "Korean", vi: "Vietnamese", tl: "Tagalog (Filipino)", hi: "Hindi", ar: "Arabic" };

function admin(env, req) {
  if (!env.ADMIN_KEY) throw new HttpErr(403, "Add an ADMIN_KEY secret to the helper first");
  if (!sameKey(req.headers.get("X-Liquara-Admin"), env.ADMIN_KEY)) throw new HttpErr(401, "Wrong admin key");
}

export default {
  async fetch(req, env) {
    const origin = env.APP_ORIGIN && req.headers.get("Origin") === env.APP_ORIGIN ? env.APP_ORIGIN : "*";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": HEADERS, "Access-Control-Max-Age": "86400", "Vary": "Origin" } });
    if (req.method !== "POST") return J({ ok: true, service: "Liquara helper", version: VERSION, checkout: "embedded_page", storage: !!env.LQ, email: !!env.RESEND_KEY }, 200, origin);
    const path = new URL(req.url).pathname;
    let body = {}; try { body = await req.json(); } catch (e) { }
    try {
      if (path === "/checkout") {
        const prices = JSON.parse(env.PRICES || "{}"), price = prices[body.plan + "_" + body.period];
        if (!price) return J({ error: "That plan isn't set up yet" }, 400, origin);
        const s = await stripe(env, "checkout/sessions", { ui_mode: "embedded_page", mode: "subscription", redirect_on_completion: "never", "line_items[0][price]": price, "line_items[0][quantity]": 1, subscription_data: { trial_period_days: Math.min(14, body.trialDays || 14), metadata: { plan: body.plan, device: body.device || "" } }, customer_email: body.email || undefined, payment_method_collection: "always", metadata: { plan: body.plan, period: body.period } });
        return J({ clientSecret: s.client_secret, session: s.id }, 200, origin);
      }
      if (path === "/license") {
        store(env);
        const s = await stripe(env, "checkout/sessions/" + encodeURIComponent(body.session || ""), null, "GET");
        if (s.status !== "complete" || !s.subscription) return J({ error: "Checkout isn't finished" }, 400, origin);
        const sub = await stripe(env, "subscriptions/" + s.subscription, null, "GET");
        const cd = s.customer_details || {}, lic = await licForSub(env, sub, cd.email || s.customer_email || "", cd.name || "");
        const code = await issue(env, lic, sub, body.device);
        let emailed = !!lic.emailed; if (!emailed) emailed = await sendKeyEmail(env, lic);
        return J({ code, key: lic.key, email: lic.email, emailed }, 200, origin);
      }
      if (path === "/activate") {
        const key = cleanKey(body.key), lic = /^LQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) ? await getLic(env, key) : null;
        if (!lic) return J({ error: "We couldn't find that license key. Check it against your email.", code: "notfound" }, 404, origin);
        const sub = await stripe(env, "subscriptions/" + lic.sub, null, "GET");
        return J({ code: await issue(env, lic, sub, body.device), key: lic.key, email: lic.email }, 200, origin);
      }
      if (path === "/renew") {
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), true);
        if (!p || !p.s) return J({ error: "That license isn't valid.", code: "invalid" }, 401, origin);
        const sub = await stripe(env, "subscriptions/" + p.s, null, "GET");
        let lic = p.l ? await getLic(env, p.l) : null;
        if (!lic) { const c = await customerOf(env, sub); lic = await licForSub(env, sub, c.email, c.name); }
        if (body.cik) { try { const co = await secCompany(env, body.cik); lic.cik = co.cik; if (co.revenue) body.rev = Math.max(+body.rev || 0, co.revenue); } catch (e) { } }
        if (body.rev !== undefined && isFinite(+body.rev)) { lic.rev = Math.max(lic.rev || 0, Math.round(+body.rev)); const need = tierFor(lic.rev); lic.needs = rank(need) > rank(lic.plan) ? need : ""; }
        const code = await issue(env, lic, sub, p.d || body.device);
        return J({ code, key: lic.key, email: lic.email, needs: lic.needs || "" }, 200, origin);
      }
      if (path === "/portal") {
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), true); if (!p || !p.s) return J({ error: "Subscribe first" }, 400, origin);
        const sub = await stripe(env, "subscriptions/" + p.s, null, "GET");
        const ps = await stripe(env, "billing_portal/sessions", { customer: sub.customer, return_url: (env.APP_ORIGIN || "https://getliquara.com") + "/app" });
        return J({ url: ps.url }, 200, origin);
      }
      if (path === "/extract") {
        const { lic } = await needLicense(env, req);
        await bump(env, "use:" + lic.key + ":read:" + today(), 1, READS_PER_DAY[lic.plan] || 60, 2 * 86400, "You've reached today's limit for AI file reading. It resets tomorrow.");
        const content = [];
        if (body.text) content.push({ type: "text", text: "File: " + body.name + "\n\n" + String(body.text).slice(0, 180000) });
        else if (/pdf/i.test(body.mime) || /\.pdf$/i.test(body.name)) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.data } });
        else if (/image/i.test(body.mime) || /\.(png|jpe?g|webp)$/i.test(body.name)) content.push({ type: "image", source: { type: "base64", media_type: body.mime || "image/jpeg", data: body.data } });
        else return J({ error: "Send this file as PDF, image or text" }, 400, origin);
        content.push({ type: "text", text: EXTRACT_PROMPT });
        return J(await claude(env, content, undefined, 16000), 200, origin);
      }
      if (path === "/savings") {
        const { lic } = await needLicense(env, req);
        await bump(env, "use:" + lic.key + ":save:" + month(), 1, SAVINGS_PER_MONTH[lic.plan] || 20, 40 * 86400, "You've used this month's AI savings checks for your plan.");
        const out = await claude(env, [{ type: "text", text: SAVINGS_PROMPT(body) }], [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }], 4000);
        out.checked = out.checked || new Date().toISOString().slice(0, 10);
        return J(out, 200, origin);
      }
      if (path === "/translate") {
        const to = LANGS[body.lang]; const list = (body.strings || []).slice(0, 80).map(s => String(s).slice(0, 600));
        if (!to || !list.length) return J({ error: "Nothing to translate" }, 400, origin);
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), false);
        if (p && p.l) await bump(env, "use:" + p.l + ":tr:" + today(), list.length, 6000, 2 * 86400, "Translation limit reached for today.");
        else await bump(env, "tr:" + (req.headers.get("CF-Connecting-IP") || "x") + ":" + today(), list.length, 600, 2 * 86400, "Translation limit reached for today. Start your free trial for full translation.");
        const out = await claude(env, [{ type: "text", text: "Translate each string into " + to + " for a business cash-forecasting app used by owners and CFOs. Keep it short, plain and natural. Keep numbers, money amounts, dates, currency codes, file names, company and product names, and symbols exactly as they are. If a string is already in " + to + " or is only a name, return it unchanged. Return ONLY JSON: {\"out\":[...]} with exactly " + list.length + " strings in the same order.\n\n" + JSON.stringify(list) }], undefined, 8000);
        return J({ out: out.out || [] }, 200, origin);
      }
      if (path === "/company/search") {
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), false);
        if (!p) await bump(env, "cs:" + (req.headers.get("CF-Connecting-IP") || "x") + ":" + today(), 1, 300, 2 * 86400, "Search limit reached for today.");
        return J({ results: searchCo(await tickers(env), body.q) }, 200, origin);
      }
      if (path === "/company") {
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), false);
        if (!p) await bump(env, "cd:" + (req.headers.get("CF-Connecting-IP") || "x") + ":" + today(), 1, 40, 2 * 86400, "Lookup limit reached for today.");
        return J(await secCompany(env, body.cik), 200, origin);
      }
      if (path === "/company/find") {
        const { lic } = await needLicense(env, req);
        await bump(env, "use:" + lic.key + ":find:" + today(), 1, 10, 2 * 86400, "You've searched the web for companies as often as today's limit allows.");
        const out = await claude(env, [{ type: "text", text: FIND_PROMPT({ name: String(body.name || "").slice(0, 120), region: String(body.region || "").slice(0, 80) }) }], [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }], 3000);
        return J({ matches: (out.matches || []).slice(0, 3) }, 200, origin);
      }
      if (path === "/upgrade") {
        const p = await verifyPass(env, req.headers.get("X-Liquara-License"), true); if (!p || !p.l) return J({ error: "Start your trial first" }, 400, origin);
        const lic = await getLic(env, p.l); if (!lic) return J({ error: "License not found" }, 404, origin);
        const to = TIERS.includes(body.plan) ? body.plan : lic.needs; if (!to || rank(to) <= rank(lic.plan)) return J({ error: "You're already on that plan or higher" }, 400, origin);
        const sub = await stripe(env, "subscriptions/" + lic.sub, null, "GET"), item = sub.items && sub.items.data && sub.items.data[0];
        const rc = item && item.price && item.price.recurring || {}, per = rc.interval === "year" ? "year" : rc.interval_count === 3 ? "quarter" : "month";
        const price = JSON.parse(env.PRICES || "{}")[to + "_" + per]; if (!price || !item) return J({ error: "That plan isn't set up yet" }, 400, origin);
        const up = await stripe(env, "subscriptions/" + lic.sub, { items: { 0: { id: item.id, price } }, proration_behavior: "create_prorations", metadata: { plan: to } });
        lic.plan = to; lic.needs = rank(tierFor(lic.rev)) > rank(to) ? tierFor(lic.rev) : "";
        return J({ code: await issue(env, lic, up, p.d), plan: to }, 200, origin);
      }
      if (path === "/news") {
        const { lic } = await needLicense(env, req);
        const ind = String(body.industry || "small business").slice(0, 80), reg = String(body.region || "United States").slice(0, 80), slot = new Date().toISOString().slice(0, 13).replace(/T(\d\d)/, (m, h) => "T" + String(Math.floor(h / 6) * 6).padStart(2, "0"));
        const ck = "news:" + (ind + "|" + reg).toLowerCase().replace(/[^a-z0-9|]+/g, "-") + ":" + slot;
        const cached = await store(env).get(ck); if (cached && !body.fresh) return J(JSON.parse(cached), 200, origin);
        await bump(env, "use:" + lic.key + ":news:" + today(), 1, NEWS_PER_DAY[lic.plan] || 6, 2 * 86400, "You've refreshed the news as often as today's limit allows. It refreshes on its own every few hours.");
        const out = await claude(env, [{ type: "text", text: NEWS_PROMPT({ industry: ind, region: reg, size: body.size }) }], [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }], 6000);
        out.items = (out.items || []).filter(i => i && i.headline && i.url).slice(0, 12); out.checked = new Date().toISOString(); out.industry = ind; out.region = reg;
        await store(env).put(ck, JSON.stringify(out), { expirationTtl: 6 * 3600 });
        return J(out, 200, origin);
      }
      if (path === "/compete") {
        const { lic } = await needLicense(env, req);
        await bump(env, "use:" + lic.key + ":compete:" + month(), 1, COMPETE_PER_MONTH[lic.plan] || 4, 40 * 86400, "You've used this month's competitor reports for your plan.");
        const out = await claude(env, [{ type: "text", text: COMPETE_PROMPT(body) }], [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }], 8000);
        out.checked = new Date().toISOString();
        return J(out, 200, origin);
      }
      if (path === "/admin") {
        admin(env, req);
        const since = Math.floor(Date.now() / 1000) - 60 * 864e2;
        const [subs, sessions] = await Promise.all([
          listAll(env, "subscriptions", { status: "all", "expand[]": "data.customer" }),
          listAll(env, "checkout/sessions", { "created[gte]": since }, 500)
        ]);
        const subOut = subs.map(s => {
          const it = (s.items && s.items.data && s.items.data[0]) || {}, pr = it.price || {}, rc = pr.recurring || {}, c = typeof s.customer === "object" ? s.customer : { id: s.customer };
          return { id: s.id, status: s.status, plan: (s.metadata && s.metadata.plan) || pr.nickname || "", interval: rc.interval || "month", every: rc.interval_count || 1, amount: (pr.unit_amount || 0) * (it.quantity || 1) / 100, currency: (pr.currency || s.currency || "usd").toUpperCase(),
            created: s.created, trialEnd: s.trial_end, periodEnd: periodEnd(s), cancelAtEnd: !!s.cancel_at_period_end, canceledAt: s.canceled_at, endedAt: s.ended_at,
            customer: { id: c.id, email: c.email || "", name: c.name || "", phone: c.phone || "" } };
        });
        const sesOut = sessions.filter(s => s.mode === "subscription").map(s => ({ id: s.id, status: s.status, created: s.created, email: (s.customer_details && s.customer_details.email) || s.customer_email || "", name: (s.customer_details && s.customer_details.name) || "", amount: (s.amount_total || 0) / 100, currency: (s.currency || "usd").toUpperCase(), customer: typeof s.customer === "string" ? s.customer : s.customer && s.customer.id || null, subscription: typeof s.subscription === "string" ? s.subscription : s.subscription && s.subscription.id || null, plan: (s.metadata && s.metadata.plan) || "" }));
        const statusBySub = {}; subOut.forEach(s => { statusBySub[s.id] = s.status; });
        const licenses = [];
        if (env.LQ) {
          let cursor; for (let i = 0; i < 10; i++) {
            const page = await env.LQ.list({ prefix: "lic:", cursor });
            page.keys.forEach(k => { const m = k.metadata || {}; licenses.push({ key: m.k || k.name.slice(4), email: m.e || "", name: m.m || "", plan: m.p || "owner", sub: m.s || "", status: statusBySub[m.s] || m.st || "", revoked: !!m.r, devices: m.n || 0, limit: DEVICE_LIMIT[m.p] || 2, lastCheck: m.c || 0, created: m.t || 0, periodEnd: m.x || 0, emailed: m.em || 0, rev: m.rv || 0, needs: m.nd || "" }); });
            if (page.list_complete) break; cursor = page.cursor;
          }
        }
        return J({ at: Date.now(), live: /^(sk|rk)_live_/.test(String(env.STRIPE_SECRET || "")), storage: !!env.LQ, email: !!env.RESEND_KEY, subscriptions: subOut, sessions: sesOut, licenses }, 200, origin);
      }
      if (path === "/admin/license") {
        admin(env, req);
        const lic = await getLic(env, cleanKey(body.key)); if (!lic) return J({ error: "License not found" }, 404, origin);
        if (body.action === "revoke") lic.revoked = true;
        else if (body.action === "restore") lic.revoked = false;
        else if (body.action === "devices") lic.devices = {};
        else if (body.action === "cleartier") { lic.rev = 0; lic.needs = ""; }
        else if (body.action === "resend") { lic.emailed = 0; const ok = await sendKeyEmail(env, lic); if (!ok) return J({ error: env.RESEND_KEY ? "The email couldn't be sent" : "Email isn't set up (RESEND_KEY)" }, 400, origin); return J({ ok: true }, 200, origin); }
        else return J({ error: "Unknown action" }, 400, origin);
        await putLic(env, lic);
        return J({ ok: true, revoked: lic.revoked, devices: Object.keys(lic.devices || {}).length }, 200, origin);
      }
      return J({ error: "Unknown request" }, 404, origin);
    } catch (e) { return J({ error: e.message, code: e.code || "" }, e.status || 500, origin); }
  }
};
