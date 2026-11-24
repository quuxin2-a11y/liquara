/* Liquara helper: a Cloudflare Worker.
   Paste this whole file into a new Cloudflare Worker, then add these settings (Settings → Variables and Secrets):
     STRIPE_SECRET        your Stripe secret key (sk_live_... or sk_test_...)              [secret]
     LICENSE_KEY          the private key from getliquara.com/setup-keys                          [secret]
     ANTHROPIC_KEY        your Claude API key (for AI reading and the savings finder)      [secret]
     PRICES               JSON, e.g. {"owner_month":"price_...","owner_quarter":"price_...", ... "enterprise_year":"price_..."}
     APP_ORIGIN           where the app lives, e.g. https://getliquara.com
     MODEL                optional, Claude model name (default claude-sonnet-5-5)
     ADMIN_KEY            a long random password for the Liquara Admin app             [secret]
   No card numbers ever touch this helper: Stripe's embedded form talks to Stripe directly. */

const J = (o, s = 200, origin = "*") => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, X-Liquara-License, X-Liquara-Device, X-Liquara-Admin", "Access-Control-Allow-Methods": "POST, OPTIONS" } });

async function stripe(env, path, params, method = "POST") {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v === undefined || v === null) return; if (typeof v === "object") Object.entries(v).forEach(([kk, vv]) => add(`${k}[${kk}]`, vv)); else body.append(k, String(v)); };
  Object.entries(params || {}).forEach(([k, v]) => add(k, v));
  const r = await fetch("https://api.stripe.com/v1/" + path + (method === "GET" && params ? "?" + body : ""), { method, headers: { Authorization: "Bearer " + env.STRIPE_SECRET, "Content-Type": "application/x-www-form-urlencoded" }, body: method === "GET" ? undefined : body });
  const j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || "Stripe error"); return j;
}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function sign(env, payload) {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.LICENSE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = "LQ1." + b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return head + "." + b64u(sig);
}
function readCode(code) { try { const p = String(code || "").split("."); return JSON.parse(new TextDecoder().decode(unb64u(p[1]))); } catch (e) { return null; } }
async function licenseFor(env, subId, device) {
  const sub = await stripe(env, "subscriptions/" + subId, null, "GET");
  if (!["trialing", "active", "past_due"].includes(sub.status)) throw new Error("Subscription is " + sub.status);
  const end = (sub.current_period_end || (sub.items && sub.items.data[0] && sub.items.data[0].current_period_end) || sub.trial_end) * 1000;
  return sign(env, { p: (sub.metadata && sub.metadata.plan) || "owner", e: end + 3 * 864e5, s: sub.id, d: device || "" });
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
function sameKey(a, b) { a = String(a || ""); b = String(b || ""); if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

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

export default {
  async fetch(req, env) {
    const origin = env.APP_ORIGIN && req.headers.get("Origin") === env.APP_ORIGIN ? env.APP_ORIGIN : "*";
    if (req.method === "OPTIONS") return J({}, 204, origin);
    if (req.method !== "POST") return J({ ok: true, service: "Liquara helper" }, 200, origin);
    const path = new URL(req.url).pathname;
    let body = {}; try { body = await req.json(); } catch (e) { }
    try {
      if (path === "/checkout") {
        const prices = JSON.parse(env.PRICES || "{}"), price = prices[body.plan + "_" + body.period];
        if (!price) return J({ error: "That plan isn't set up yet" }, 400, origin);
        const s = await stripe(env, "checkout/sessions", { ui_mode: "embedded", mode: "subscription", redirect_on_completion: "never", "line_items[0][price]": price, "line_items[0][quantity]": 1, subscription_data: { trial_period_days: body.trialDays || 14, metadata: { plan: body.plan, device: body.device || "" } }, customer_email: body.email || undefined, payment_method_collection: "always", metadata: { plan: body.plan, period: body.period } });
        return J({ clientSecret: s.client_secret, session: s.id }, 200, origin);
      }
      if (path === "/license") {
        const s = await stripe(env, "checkout/sessions/" + body.session, null, "GET");
        if (s.status !== "complete" || !s.subscription) return J({ error: "Checkout isn't finished" }, 400, origin);
        return J({ code: await licenseFor(env, s.subscription, body.device) }, 200, origin);
      }
      if (path === "/renew") {
        const p = readCode(req.headers.get("X-Liquara-License")); if (!p || !p.s) return J({ error: "No license" }, 400, origin);
        return J({ code: await licenseFor(env, p.s, p.d) }, 200, origin);
      }
      if (path === "/portal") {
        const p = readCode(req.headers.get("X-Liquara-License")); if (!p || !p.s) return J({ error: "Subscribe first" }, 400, origin);
        const sub = await stripe(env, "subscriptions/" + p.s, null, "GET");
        const ps = await stripe(env, "billing_portal/sessions", { customer: sub.customer, return_url: (env.APP_ORIGIN || "https://getliquara.com") + "/app" });
        return J({ url: ps.url }, 200, origin);
      }
      if (path === "/extract") {
        if (!req.headers.get("X-Liquara-Device") && !req.headers.get("X-Liquara-License")) return J({ error: "Unknown device" }, 401, origin);
        const content = [];
        if (body.text) content.push({ type: "text", text: "File: " + body.name + "\n\n" + String(body.text).slice(0, 180000) });
        else if (/pdf/i.test(body.mime) || /\.pdf$/i.test(body.name)) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.data } });
        else if (/image/i.test(body.mime) || /\.(png|jpe?g|webp)$/i.test(body.name)) content.push({ type: "image", source: { type: "base64", media_type: body.mime || "image/jpeg", data: body.data } });
        else return J({ error: "Send this file as PDF, image or text" }, 400, origin);
        content.push({ type: "text", text: EXTRACT_PROMPT });
        return J(await claude(env, content, undefined, 16000), 200, origin);
      }
      if (path === "/admin") {
        if (!env.ADMIN_KEY) return J({ error: "Add an ADMIN_KEY secret to the helper first" }, 403, origin);
        if (!sameKey(req.headers.get("X-Liquara-Admin"), env.ADMIN_KEY)) return J({ error: "Wrong admin key" }, 401, origin);
        const since = Math.floor(Date.now() / 1000) - 60 * 864e2;
        const [subs, sessions] = await Promise.all([
          listAll(env, "subscriptions", { status: "all", "expand[]": "data.customer" }),
          listAll(env, "checkout/sessions", { "created[gte]": since }, 500)
        ]);
        const subOut = subs.map(s => {
          const it = (s.items && s.items.data && s.items.data[0]) || {}, pr = it.price || {}, rc = pr.recurring || {}, c = typeof s.customer === "object" ? s.customer : { id: s.customer };
          return { id: s.id, status: s.status, plan: (s.metadata && s.metadata.plan) || pr.nickname || "", interval: rc.interval || "month", every: rc.interval_count || 1, amount: (pr.unit_amount || 0) * (it.quantity || 1) / 100, currency: (pr.currency || s.currency || "usd").toUpperCase(),
            created: s.created, trialEnd: s.trial_end, periodEnd: s.current_period_end || it.current_period_end || null, cancelAtEnd: !!s.cancel_at_period_end, canceledAt: s.canceled_at, endedAt: s.ended_at,
            customer: { id: c.id, email: c.email || "", name: c.name || "", phone: c.phone || "" } };
        });
        const sesOut = sessions.filter(s => s.mode === "subscription").map(s => ({ id: s.id, status: s.status, created: s.created, email: (s.customer_details && s.customer_details.email) || s.customer_email || "", name: (s.customer_details && s.customer_details.name) || "", amount: (s.amount_total || 0) / 100, currency: (s.currency || "usd").toUpperCase(), customer: typeof s.customer === "string" ? s.customer : s.customer && s.customer.id || null, subscription: typeof s.subscription === "string" ? s.subscription : s.subscription && s.subscription.id || null, plan: (s.metadata && s.metadata.plan) || "" }));
        return J({ at: Date.now(), live: String(env.STRIPE_SECRET || "").startsWith("sk_live"), subscriptions: subOut, sessions: sesOut }, 200, origin);
      }
      if (path === "/translate") {
        if (!req.headers.get("X-Liquara-Device") && !req.headers.get("X-Liquara-License")) return J({ error: "Unknown device" }, 401, origin);
        const names = { en: "English", es: "Spanish", fr: "French", pt: "Brazilian Portuguese", de: "German", zh: "Simplified Chinese", ja: "Japanese", ko: "Korean", vi: "Vietnamese", tl: "Tagalog (Filipino)", hi: "Hindi", ar: "Arabic" };
        const to = names[body.lang]; const list = (body.strings || []).slice(0, 80).map(s => String(s).slice(0, 600));
        if (!to || !list.length) return J({ error: "Nothing to translate" }, 400, origin);
        const out = await claude(env, [{ type: "text", text: "Translate each string into " + to + " for a business cash-forecasting app used by owners and CFOs. Keep it short, plain and natural. Keep numbers, money amounts, dates, currency codes, file names, company and product names, and symbols exactly as they are. If a string is already in " + to + " or is only a name, return it unchanged. Return ONLY JSON: {\"out\":[...]} with exactly " + list.length + " strings in the same order.\n\n" + JSON.stringify(list) }], undefined, 8000);
        return J({ out: out.out || [] }, 200, origin);
      }
      if (path === "/savings") {
        if (!req.headers.get("X-Liquara-Device") && !req.headers.get("X-Liquara-License")) return J({ error: "Unknown device" }, 401, origin);
        const out = await claude(env, [{ type: "text", text: SAVINGS_PROMPT(body) }], [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }], 4000);
        out.checked = out.checked || new Date().toISOString().slice(0, 10);
        return J(out, 200, origin);
      }
      return J({ error: "Unknown request" }, 404, origin);
    } catch (e) { return J({ error: e.message }, 500, origin); }
  }
};
