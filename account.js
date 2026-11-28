/* Liquara: My account.
   Two ways in. A license key opens that one license. A password opens every plan under your email, and a password
   can only be set from a link we send to your inbox, so nobody can claim an email that isn't theirs. */
(function () {
  var W = (window.LQ_CONFIG && window.LQ_CONFIG.worker || "").replace(/\/+$/, ""), el = document.getElementById("acct"), TK = "lq_acct", tab = "key", me = null, msg = "", msgOk = false;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tok() { try { return localStorage.getItem(TK) || ""; } catch (e) { return ""; } }
  function setTok(t) { try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch (e) { } }
  async function api(path, body) {
    if (!W) throw new Error("Accounts aren't switched on yet. Email support@getliquara.com.");
    var r = await fetch(W + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Liquara-Account": tok() }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || "Something went wrong (" + r.status + ")"); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  /* the password is stretched here, so it never leaves this device */
  async function stretch(email, pw) {
    var k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    var b = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode("liquara-acct|" + email.trim().toLowerCase()), iterations: 150000, hash: "SHA-256" }, k, 256);
    return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }
  /* Is this password easy to guess, or already in a known data breach? For the breach check only the first 5 characters
     of a scrambled copy leave this device; the password itself never does. Returns "" when the password is fine. */
  async function weak(pw, email) {
    if (pw.length < 8) return "Use at least 8 characters.";
    var low = pw.toLowerCase(), name = String(email || "").split("@")[0].toLowerCase();
    if (/^(.)\1+$/.test(pw) || /^(12345678|123456789|1234567890|0123456789|87654321|abcdefgh|qwertyui|qwerty12|password|passw0rd|letmein|iloveyou|welcome1|admin123)/.test(low) || low.indexOf("liquara") >= 0 || (name.length >= 4 && low.indexOf(name) >= 0))
      return "That password is too easy to guess. Three or four random words work well.";
    try {
      var d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw)), h = Array.from(new Uint8Array(d)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("").toUpperCase();
      var j = await api("/pwcheck", { p: h.slice(0, 5) }), rest = h.slice(5);
      var hit = String(j.list || "").split(/\r?\n/).some(function (ln) { var p = ln.split(":"); return p[0] === rest && +p[1] > 0; });
      if (hit) return "That password has turned up in a known data breach, so hackers already try it. Please choose a different one.";
    } catch (e) { }
    return "";
  }
  function stripeLink(u) { u = String(u || ""); return /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(u) ? u : ""; }
  function v(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
  function busy(btn, on, txt) { if (!btn) return; btn.disabled = on; if (txt) btn.textContent = txt; }
  function d(t) { return t ? new Date(t > 2e10 ? t : t * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "–"; }
  function ago(t) { if (!t) return "never"; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
  function plan(p) { p = String(p || ""); return p ? p.charAt(0).toUpperCase() + p.slice(1) : ""; }
  function money(pr) { if (!pr || pr.amount == null) return ""; var per = pr.interval === "year" ? "year" : pr.count === 3 ? "quarter" : "month"; try { return (pr.amount / 100).toLocaleString("en-US", { style: "currency", currency: (/^[a-z]{3}$/i.test(pr.currency || "") ? pr.currency : "usd").toUpperCase(), maximumFractionDigits: 0 }) + " / " + per; } catch (e) { return ""; } }
  function state(l) {
    if (l.status === "revoked") return ["Turned off", "bad", "Contact support@getliquara.com."];
    if (l.status === "trialing") return ["Free trial", "ok", "Trial ends " + d(l.trialEnd || l.periodEnd) + (l.manual ? "." : l.cancelAt ? ". Set to cancel, so you won't be charged." : ". Your card is charged after that unless you cancel.")];
    if (l.status === "active") return ["Active", "ok", l.cancelAt ? "Cancels on " + d(l.cancelAt) + "." : l.manual ? "Runs until " + d(l.periodEnd) + "." : "Renews " + d(l.periodEnd) + "."];
    if (l.status === "past_due") return ["Payment due", "warn", "Your last payment didn't go through. Update your card to keep Liquara on."];
    return ["Ended", "bad", "This plan has ended. Choose a plan in the app to start again."];
  }
  function show(h) { el.innerHTML = h; }
  function remembered() { try { return sessionStorage.getItem("lq_em") || ""; } catch (e) { return ""; } }
  function amsg(id) { return '<p class="amsg' + (msgOk ? " ok" : "") + '" id="' + id + '">' + esc(msg) + "</p>"; }
  function signedOut() {
    var reset = /#reset=([a-f0-9]{64})\b/.exec(location.hash);
    if (reset) {
      show('<div class="acard"><h1>Choose a new password</h1><p class="tiny">This link came to your inbox, which is how we know this email is yours.</p>' +
        '<label class="af"><span>Your email</span><input id="em" type="email" autocomplete="email" autocapitalize="off"></label>' +
        '<label class="af"><span>New password (8+ characters)</span><input id="np1" type="password" autocomplete="new-password"></label>' +
        '<label class="af"><span>Type it again</span><input id="np2" type="password" autocomplete="new-password"></label>' +
        amsg("m") + '<button class="btn pri big full" data-a="reset" data-t="' + reset[1] + '">Save password</button></div>');
      return;
    }
    show('<div class="acard"><h1>Sign in</h1><p class="tiny">Manage your plan, billing, devices and synced data.</p>' +
      '<div class="atabs"><button class="' + (tab === "key" ? "on" : "") + '" data-a="tab" data-t="key">License key</button><button class="' + (tab !== "key" ? "on" : "") + '" data-a="tab" data-t="pw">Password</button></div>' +
      '<label class="af"><span>Email</span><input id="em" type="email" autocomplete="email" autocapitalize="off" placeholder="you@company.com" value="' + esc(remembered()) + '"></label>' +
      (tab === "key" ? '<label class="af"><span>License key</span><input id="lk" autocapitalize="characters" autocomplete="off" placeholder="LQ-XXXX-XXXX-XXXX"></label>' + amsg("m") + '<button class="btn pri big full" data-a="keylogin">Sign in</button><p class="tiny center">Your key is in your Liquara welcome email. Lost it? <a href="mailto:support@getliquara.com">Email support</a>.</p>'
        : tab === "pw" ? '<label class="af"><span>Password</span><input id="pw" type="password" autocomplete="current-password"></label>' + amsg("m") + '<button class="btn pri big full" data-a="login">Sign in</button><p class="tiny center"><a href="#" data-a="tab" data-t="forgot">Forgot password, or never set one?</a></p>'
        : '<p class="amsg' + (msgOk || !msg ? " ok" : "") + '" id="m">' + esc(msg || "We'll email you a link to set a password.") + '</p><button class="btn pri big full" data-a="forgot">Email me a link</button><p class="tiny center"><a href="#" data-a="tab" data-t="pw">Back to sign in</a></p>') +
      '</div><div class="acard alt"><b>Not a customer yet?</b><p class="tiny">Try Liquara free for 14 days.</p><a class="btn ghost" href="app#plans">See plans</a></div>');
  }
  function signedIn() {
    var L = me.licenses || [], first = String(me.name || "").split(" ")[0];
    var h = '<div class="ahead"><div><h1>' + (first ? "Hi, " + esc(first) : "Your account") + '</h1><p class="tiny">' + esc(me.email) + '</p></div><button class="btn ghost" data-a="signout">Sign out</button></div>';
    if (me.scope === "key") h += '<p class="anote">You signed in with a license key, so this page shows that license. To see every plan under your email, sign in with a password.</p>';
    if (!L.length) h += '<div class="acard"><b>No plans on this email yet.</b><p class="tiny">If you subscribed with a different email, sign in with that one.</p></div>';
    L.forEach(function (l, i) {
      var s = state(l), K = esc(l.key);
      h += '<div class="acard lic"><div class="lt"><div><span class="pill ' + s[1] + '">' + s[0] + '</span><h2>' + esc(plan(l.plan)) + (l.manual ? ' <small>' + (l.kind === "trial" ? "free trial from Liquara" : "set up by Liquara") + "</small>" : "") + '</h2><p class="tiny">' + esc(s[2]) + (money(l.price) ? " · " + esc(money(l.price)) : "") + '</p></div><div class="acts">' +
        (l.status !== "revoked" ? '<a class="btn pri" href="app#lic=' + encodeURIComponent(l.key) + '">Open Liquara</a>' : "") + (l.hasBilling ? '<button class="btn ghost" data-a="billing" data-k="' + K + '">Manage billing</button>' : "") + '</div></div>' +
        '<div class="agrid"><div><span>License key</span><b class="mono" id="k' + i + '">' + esc(String(l.key).slice(0, 3)) + "••••-••••-" + esc(String(l.key).slice(-4)) + '</b><div class="ln"><a href="#" data-a="reveal" data-i="' + i + '" data-k="' + K + '">Show</a> · <a href="#" data-a="copy" data-k="' + K + '">Copy</a> · <a href="#" data-a="resend" data-k="' + K + '">Email it to me</a></div></div>' +
        '<div><span>Devices</span><b>' + (+l.devices || 0) + " of " + (+l.limit || 0) + '</b><div class="ln"><a href="#" data-a="devices" data-k="' + K + '">Free up devices</a></div></div>' +
        '<div><span>Synced data</span><b>' + (l.sync ? esc(ago(+l.sync.at)) : "Not synced yet") + "</b>" + (l.sync ? '<div class="ln">from your ' + esc(l.sync.dev || "device") + " · " + (+l.sync.size > 1e6 ? (+l.sync.size / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(+l.sync.size / 1e3)) + " KB") + ' · <a href="#" data-a="syncdelete" data-k="' + K + '">Delete</a></div>' : '<div class="ln">Starts when you use Liquara with this key</div>') + "</div>" +
        '<div><span>Member since</span><b>' + esc(d(l.created)) + "</b></div></div></div>";
    });
    var live = L.filter(function (l) { return l.status === "active" || l.status === "trialing" || l.status === "past_due"; })[0];
    h += '<div class="acard"><div class="eyebrow">Get Liquara everywhere</div><div class="agrid three"><div><b>Android phone</b><p class="tiny">Download the app, tap <strong>Have a license key?</strong> and paste your key.</p>' + (live ? '<button class="btn ghost" data-a="getapp" data-k="' + esc(live.key) + '">Download for Android</button>' : '<a class="btn ghost" href="mobile">About the Android app</a>') + '</div><div><b>Computer</b><p class="tiny">Open Liquara in Chrome or Edge, then <strong>Settings → Install on this computer</strong>.</p><a class="btn ghost" href="app">Open Liquara</a></div><div><b>iPhone</b><p class="tiny">Open getliquara.com/app in Safari, then Share → <strong>Add to Home Screen</strong>.</p><a class="btn ghost" href="mobile">Mobile app details</a></div></div><p class="amsg" id="m3"></p></div>';
    h += '<div class="acard"><div class="eyebrow">Sign-in</div>' + (me.hasPassword
      ? '<p class="tiny">You can sign in with your email and password, or your email and license key.</p><label class="af"><span>Current password</span><input id="op" type="password" autocomplete="current-password"></label><label class="af"><span>New password (8+ characters)</span><input id="np1" type="password" autocomplete="new-password"></label><p class="amsg" id="m2"></p><div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn" data-a="setpw">Change password</button><button class="btn ghost" data-a="signoutall">Sign out on every device</button></div>'
      : '<p class="tiny">You sign in with your email and license key. Want a password too? We\'ll email a link to <b>' + esc(me.email) + '</b>. Setting it from your inbox is what proves the email is yours, and a password shows every plan under your email in one place.</p><p class="amsg" id="m2"></p><div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn" data-a="linkpw">Email me a link to set a password</button><button class="btn ghost" data-a="signoutall">Sign out on every device</button></div>') + "</div>";
    h += '<p class="tiny center">Billing questions? <a href="mailto:billing@getliquara.com">billing@getliquara.com</a> · Help with the app? <a href="mailto:support@getliquara.com">support@getliquara.com</a></p>';
    show(h);
  }
  /* seamless sign-in: from the app's "My account" link, or because this browser is already signed in to Liquara */
  async function autoSignIn() {
    var h = location.hash, m = /[#&]k=([^&]+)/.exec(h), em = /[#&]e=([^&]+)/.exec(h), key = "", email = "";
    try { key = m ? decodeURIComponent(m[1]) : ""; email = em ? decodeURIComponent(em[1]) : ""; } catch (e) { key = ""; email = ""; }
    var f = /#forgot(?:=([^&]*))?/.exec(h); if (f) { tab = "forgot"; try { if (f[1]) sessionStorage.setItem("lq_em", decodeURIComponent(f[1])); } catch (e) { } history.replaceState(null, "", location.pathname); return false; }
    if (m) history.replaceState(null, "", location.pathname);
    var noAuto = false; try { noAuto = sessionStorage.getItem("lq_noauto") === "1"; } catch (e) { }
    if (!key && !noAuto) { try { var s = JSON.parse(localStorage.getItem("ao.s") || "{}"); if (s.license && s.license.until > Date.now() && s.license.key) { key = s.license.key; email = email || s.license.email || ""; } } catch (e) { } }
    if (!key || !email) { if (email) try { sessionStorage.setItem("lq_em", email); } catch (e) { } return false; }
    try { var r = await api("/account/keylogin", { email: email, key: key }); setTok(r.token); return true; } catch (e) { if (m) setTok(""); return false; }
  }
  async function load(again) {
    if (/#reset=[a-f0-9]{64}\b/.test(location.hash)) return signedOut();          /* a set-password link always opens the password form, signed in or not */
    if (!tok() || /[#&]k=/.test(location.hash)) await autoSignIn();
    if (!tok()) return signedOut();
    try { me = await api("/account/me"); signedIn(); }
    catch (e) {
      if (e.code === "signin") { setTok(""); if (!again && (await autoSignIn())) return load(true); msg = ""; msgOk = false; signedOut(); }
      else show('<div class="acard"><b>Couldn\'t load your account.</b><p class="tiny">' + esc(e.message) + '</p><button class="btn" data-a="reload">Try again</button></div>');
    }
  }
  function say(t, id, okay) { var m = document.getElementById(id || "m"); if (m) { m.textContent = t; m.className = "amsg" + (okay ? " ok" : ""); } if (!id) { msg = t; msgOk = !!okay; } }
  var LABEL = { keylogin: "Sign in", login: "Sign in", forgot: "Email me a link", reset: "Save password", setpw: "Change password", linkpw: "Email me a link to set a password", billing: "Manage billing", getapp: "Download for Android" };
  document.addEventListener("click", async function (ev) {
    var t = ev.target.closest("[data-a]"); if (!t) return; var a = t.dataset.a; if (t.tagName === "A") ev.preventDefault();
    try {
      if (a === "tab") { var em = v("em"); if (em) try { sessionStorage.setItem("lq_em", em); } catch (e) { } tab = t.dataset.t; msg = ""; msgOk = false; signedOut(); return; }
      if (a === "reload") return load();
      if (a === "keylogin") { try { sessionStorage.removeItem("lq_noauto"); } catch (e) { } busy(t, true, "Signing in…"); var r = await api("/account/keylogin", { email: v("em"), key: v("lk") }); setTok(r.token); msg = ""; return load(); }
      if (a === "login") { if (!v("pw")) return say("Enter your password."); busy(t, true, "Signing in…"); var r2 = await api("/account/login", { email: v("em"), h: await stretch(v("em"), v("pw")) }); setTok(r2.token); msg = ""; return load(); }
      if (a === "forgot") { if (!v("em")) return say("Enter your email first."); busy(t, true, "Sending…"); await api("/account/forgot", { email: v("em") }); say("If that email has a Liquara plan, a link is on its way. Check your inbox and spam.", null, true); busy(t, false, LABEL.forgot); return; }
      if (a === "reset") {
        var p1 = v("np1"); if (!v("em")) return say("Enter your email."); if (p1 !== v("np2")) return say("The two passwords don't match.");
        busy(t, true, "Checking…"); var w1 = await weak(p1, v("em")); if (w1) { busy(t, false, LABEL.reset); return say(w1); }
        busy(t, true, "Saving…"); var r3 = await api("/account/reset", { token: t.dataset.t, email: v("em"), h: await stretch(v("em"), p1) }); setTok(r3.token); history.replaceState(null, "", location.pathname); msg = ""; return load();
      }
      if (a === "signout") { setTok(""); try { sessionStorage.setItem("lq_noauto", "1"); } catch (e) { } me = null; msg = ""; msgOk = false; return signedOut(); }
      if (a === "signoutall") { await api("/account/signout-all"); setTok(""); try { sessionStorage.setItem("lq_noauto", "1"); } catch (e) { } me = null; msg = "Signed out on every device."; msgOk = true; return signedOut(); }
      if (a === "billing") { busy(t, true, "Opening…"); var b = await api("/account/billing", { key: t.dataset.k }), bu = stripeLink(b.url); if (!bu) throw new Error("That billing link didn't look right. Please try again."); location.href = bu; return; }
      if (a === "getapp") {
        busy(t, true, "Checking your key…"); var g = await api("/download", { key: t.dataset.k });
        if (!W || String(g.url || "").indexOf(W + "/download?") !== 0) throw new Error("That didn't work. Please try again.");
        say("Your download is starting. When it finishes, tap the file, then Install.", "m3", true); busy(t, false, LABEL.getapp); location.href = g.url; return;
      }
      if (a === "reveal") { var k = document.getElementById("k" + t.dataset.i); if (k) k.textContent = t.dataset.k; t.style.display = "none"; return; }
      if (a === "copy") { try { await navigator.clipboard.writeText(t.dataset.k); t.textContent = "Copied"; } catch (e) { prompt("Copy your key:", t.dataset.k); } return; }
      if (a === "resend") { t.textContent = "Sending…"; await api("/account/action", { key: t.dataset.k, action: "resend" }); t.textContent = "Sent to " + me.email; return; }
      if (a === "devices") { if (!confirm("Sign this key out of every phone and computer? Each one asks for the key again next time.")) return; await api("/account/action", { key: t.dataset.k, action: "devices" }); return load(); }
      if (a === "syncdelete") { if (!confirm("Delete the synced copy of your data? Each device keeps its own copy until you erase it there.")) return; await api("/account/action", { key: t.dataset.k, action: "syncdelete" }); return load(); }
      if (a === "linkpw") { busy(t, true, "Sending…"); await api("/account/password", {}); say("Check your inbox: we've emailed you a link to set your password.", "m2", true); busy(t, false, LABEL.linkpw); return; }
      if (a === "setpw") {
        var np = v("np1"); if (!v("op")) return say("Enter your current password.", "m2");
        busy(t, true, "Checking…"); var w2 = await weak(np, me.email); if (w2) { busy(t, false, LABEL.setpw); return say(w2, "m2"); }
        busy(t, true, "Saving…"); var r4 = await api("/account/password", { old: await stretch(me.email, v("op")), h: await stretch(me.email, np) }); if (r4.token) setTok(r4.token); return load();
      }
    } catch (e) {
      var calm = e.code === "emailed" || e.code === "verify";      /* not an error: "we've emailed you a link" */
      say(e.message, null, calm); say(e.message, "m2", calm); if (a === "getapp") say(e.message, "m3");
      busy(t, false, LABEL[a] || t.textContent.replace(/…$/, ""));
    }
  });
  load();
})();
