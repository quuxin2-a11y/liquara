/* Liquara boot: frame guard, Content Security Policy (website and Android app), then the offline service worker. */
(function () {
  /* never run inside someone else's page: a hidden frame is how people get tricked into tapping things */
  try { if (window.top !== window.self) { document.documentElement.style.display = "none"; window.top.location = window.self.location.href; } } catch (e) { try { document.documentElement.style.display = "none"; } catch (x) { } }
  var inApp = (location.hostname === "localhost" && !location.port && location.protocol === "https:") || /[?&]apk=1/.test(location.search);
  /* the website gets its own look (html.web); the Android app keeps the app look */
  if (!inApp) {
    document.documentElement.className += " web";
    var an = document.createElement("script"); an.src = "analytics.js"; an.defer = true; document.head.appendChild(an);
    /* the website's two typefaces come from this site itself, so no visitor's browser has to contact a font service */
    var addCss = function (href) { var f = document.createElement("link"); f.rel = "stylesheet"; f.href = href; document.head.appendChild(f); };
    addCss("fonts.css");
    window.LQ_EXT_FONTS = function () { if (!window.LQ_EXT_DONE) { window.LQ_EXT_DONE = true; addCss("fonts-ext.css"); } };      /* extra letters, fetched only for Vietnamese */
    try { if (/"lang":"vi"/.test((localStorage.getItem("ao.s") || "") + (localStorage.getItem("ao.d") || ""))) window.LQ_EXT_FONTS(); } catch (e) { }
  }
  /* Only Liquara's own code may run, on the website and in the app. Even if a bad file or a bad answer slipped some
     code onto the page, the browser refuses to run it. */
  var m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy";
  m.content = "default-src 'self'; script-src 'self' https://js.stripe.com https://static.cloudflareinsights.com; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-src https://js.stripe.com https://checkout.stripe.com https://*.stripe.com; base-uri 'none'; form-action 'none'";
  document.head.appendChild(m);
  window.addEventListener("load", function () { if ("serviceWorker" in navigator && location.protocol === "https:" && !window.Capacitor) navigator.serviceWorker.register("sw.js").catch(function () { }); });
})();
