/* Liquara boot: Content Security Policy for the web version, then the offline service worker. */
(function () {
  var inApp = (location.hostname === "localhost" && !location.port && location.protocol === "https:") || /[?&]apk=1/.test(location.search);
  /* the website gets its own look (html.web); the Android app keeps the app look */
  if (!inApp) {
    document.documentElement.className += " web";
    var f = document.createElement("link"); f.rel = "stylesheet"; f.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap"; document.head.appendChild(f);
  }
  if (!inApp) {
    var m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy";
    m.content = "default-src 'self'; script-src 'self' https://js.stripe.com; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; frame-src https://js.stripe.com https://checkout.stripe.com https://*.stripe.com; base-uri 'none'; form-action 'none'";
    document.head.appendChild(m);
  }
  window.addEventListener("load", function () { if ("serviceWorker" in navigator && location.protocol === "https:" && !window.Capacitor) navigator.serviceWorker.register("sw.js").catch(function () { }); });
})();
