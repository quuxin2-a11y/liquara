/* Liquara: the Android app is handed only to people with a license key.
   The key is checked by the Liquara helper, which answers with a private download link that works for 15 minutes. */
(function () {
  var W = (window.LQ_CONFIG && window.LQ_CONFIG.worker || "").replace(/\/+$/, ""), inp = document.getElementById("dlkey"), btn = document.getElementById("dlgo"), msg = document.getElementById("dlmsg");
  if (!inp || !btn || !msg) return;
  var KEY = /^LQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  function clean(k) { k = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^LQ/, ""); return k.length >= 12 ? "LQ-" + k.slice(0, 4) + "-" + k.slice(4, 8) + "-" + k.slice(8, 12) : String(inp.value || "").trim().toUpperCase(); }
  function say(t, bad) { msg.textContent = t; msg.className = "tiny " + (bad ? "dlbad" : "dlok"); }
  /* the key can arrive with the link from the welcome email, or be known because this browser already uses Liquara */
  try {
    var m = /[#&]k=([A-Za-z0-9-]{10,24})/.exec(location.hash);
    if (m) { inp.value = clean(m[1]); history.replaceState(null, "", location.pathname + location.search + "#get"); }
    else { var s = JSON.parse(localStorage.getItem("ao.s") || "{}"); if (s.license && KEY.test(String(s.license.key || ""))) inp.value = s.license.key; }
  } catch (e) { }
  async function go() {
    var k = clean(inp.value);
    if (!KEY.test(k)) { inp.focus(); return say("Enter your license key. It looks like LQ-XXXX-XXXX-XXXX and is in your welcome email.", true); }
    if (!W) return say("Downloads aren't switched on yet. Email support@getliquara.com.", true);
    inp.value = k; btn.disabled = true; var label = btn.textContent; btn.textContent = "Checking your key…";
    try {
      var r = await fetch(W + "/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || "We couldn't check that key just now (" + r.status + "). Please try again.");
      if (String(j.url || "").indexOf(W + "/download?") !== 0) throw new Error("That didn't work. Please try again.");
      say("Your download is starting. When it finishes, tap the file, then Install.");
      location.href = j.url;
    } catch (e) { say(e.message || "That didn't work. Please try again.", true); }
    btn.disabled = false; btn.textContent = label;
  }
  btn.addEventListener("click", go);
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-getapp]"), function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); var box = document.getElementById("get"); if (box && box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (x) { inp.focus(); } }, 450); });
  });
})();
