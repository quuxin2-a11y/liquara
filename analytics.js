/* Liquara visitor stats (Cloudflare Web Analytics: free, no cookies, no personal data).
   To turn it on: paste your token from Cloudflare between the quotes below and commit. */
(function () {
  var TOKEN = "";
  if (!TOKEN || window.Capacitor) return;
  var s = document.createElement("script"); s.defer = true; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN })); document.head.appendChild(s);
})();
