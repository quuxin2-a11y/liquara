/* Liquara boot: Content Security Policy for the web version, then the offline service worker. */
(function () {
  var inApp = location.hostname === "localhost" && !location.port && location.protocol === "https:";
  if (!inApp) {
    var m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy";
    m.content = "default-src 'self'; script-src 'self' https://js.stripe.com; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-src https://js.stripe.com https://checkout.stripe.com https://*.stripe.com; base-uri 'none'; form-action 'none'";
    document.head.appendChild(m);
  }
  window.addEventListener("load", function () { if ("serviceWorker" in navigator && location.protocol === "https:" && !window.Capacitor) navigator.serviceWorker.register("sw.js").catch(function () { }); });
})();
