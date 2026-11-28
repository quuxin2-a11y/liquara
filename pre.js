/* Liquara: runs first on the account and download pages. Frame guard, tidy address, back-to-the-app on reload. */
try { if (window.top !== window.self) { document.documentElement.style.display = "none"; window.top.location = window.self.location.href; } } catch (e) { try { document.documentElement.style.display = "none"; } catch (x) { } }
document.documentElement.className += " js";
/* the Android app now downloads from the app page, with a license key: old links land there */
if (location.pathname === "/liquara.apk") location.replace("/mobile#get");
try {
  if (/\.html$/.test(location.pathname)) history.replaceState(null, "", location.pathname.replace(/(index)?\.html$/, "") + location.search + location.hash);
  var n = performance.getEntriesByType("navigation")[0];
  if (sessionStorage.getItem("lq_inapp") === "1" && n && n.type === "reload") { sessionStorage.setItem("lq_reload", "1"); location.replace("/app"); } else sessionStorage.removeItem("lq_inapp");
} catch (e) { }
