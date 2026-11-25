(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* pricing toggle */
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".seg button").forEach(function (x) { x.classList.toggle("on", x === b); });
      var k = +b.dataset.p, per = k === 1 ? ["month", 1] : k === 0.9 ? ["quarter", 3] : ["year", 12];
      document.querySelectorAll(".price").forEach(function (p) { var v = Math.round(+p.dataset.m * per[1] * k); p.innerHTML = "$" + v.toLocaleString() + "<span>/" + per[0] + "</span>"; });
    });
  });

  /* reveal on scroll, staggered within a group */
  var rv = document.querySelectorAll(".rv");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, sib = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.classList.contains("rv"); });
        el.style.transitionDelay = Math.min(sib.indexOf(el), 5) * 90 + "ms";
        el.classList.add("in"); io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add("in"); });

  /* count-up stats */
  var nums = document.querySelectorAll("[data-count]");
  function countUp(el) {
    var end = +el.dataset.count, t0 = null;
    if (reduce) { el.textContent = end; return; }
    function step(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(end * e); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  if ("IntersectionObserver" in window) {
    var io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); } }); }, { threshold: 0.6 });
    nums.forEach(function (n) { io2.observe(n); });
  } else nums.forEach(function (n) { n.textContent = n.dataset.count; });

  /* word-by-word scrub */
  var scrub = document.getElementById("scrub"), words = [];
  if (scrub) {
    (function wrap(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.nodeValue.split(/(\s+)/).forEach(function (w) { if (!w) return; if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(w)); else { var s = document.createElement("span"); s.className = "w"; s.textContent = w; frag.appendChild(s); words.push(s); } });
          node.replaceChild(frag, c);
        } else wrap(c);
      });
    })(scrub);
  }
  function onScroll() {
    if (scrub && words.length) {
      var r = scrub.getBoundingClientRect(), vh = innerHeight, p = (vh * 0.85 - r.top) / (r.height + vh * 0.35);
      var n = reduce ? words.length : Math.round(Math.max(0, Math.min(1, p)) * words.length);
      for (var i = 0; i < words.length; i++) words[i].classList.toggle("on", i < n);
    }
  }
  addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll); onScroll();

  /* sticky three-views story */
  var stage = document.querySelectorAll(".stage img"), steps = document.querySelectorAll(".step");
  if ("IntersectionObserver" in window && steps.length) {
    var io3 = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var v = e.target.dataset.v;
        steps.forEach(function (s) { s.classList.toggle("on", s.dataset.v === v); });
        stage.forEach(function (im) { im.classList.toggle("on", im.dataset.v === v); });
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach(function (s) { io3.observe(s); });
    steps[0].classList.add("on");
  }

  /* flowing "cash streams": lime light ribbons */
  function flow(canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d"), W = 0, H = 0, dpr = Math.min(1.5, window.devicePixelRatio || 1), t = Math.random() * 100, run = true, vis = true;
    var ribbons = opts.ribbons || 3, lines = opts.lines || 22;
    function size() { var r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      var mobile = W < 700;
      for (var r = 0; r < ribbons; r++) {
        var baseY = H * (opts.y || 0.55) + (r - (ribbons - 1) / 2) * H * (mobile ? 0.12 : 0.1), amp = H * (0.10 + r * 0.035), ph = r * 1.7;
        for (var l = 0; l < lines; l++) {
          var k = l / (lines - 1), off = (k - 0.5) * (mobile ? 70 : 120) * (1 + r * 0.3);
          var alpha = (0.07 + 0.42 * Math.pow(1 - Math.abs(k - 0.5) * 2, 2)) * (opts.alpha || 1);
          ctx.strokeStyle = r === 1 ? "rgba(46,230,176," + alpha * 0.8 + ")" : "rgba(200,255,77," + alpha + ")";
          ctx.lineWidth = l === Math.floor(lines / 2) ? 1.6 : 0.8;
          ctx.beginPath();
          for (var x = -40; x <= W + 40; x += 14) {
            var u = x / W, y = baseY + off * (0.4 + 0.6 * Math.sin(u * 3.1 + t * 0.35 + ph)) + Math.sin(u * 4.2 + t * 0.6 + ph + k * 0.9) * amp * (0.5 + u * 0.7) + Math.cos(u * 9 + t * 0.9 + l * 0.15) * 6;
            if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }
    function loop() { if (!run) return; if (vis) { t += 0.012; draw(); } requestAnimationFrame(loop); }
    size(); addEventListener("resize", function () { size(); if (reduce) draw(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }).observe(canvas);
    if (reduce) draw(); else loop();
  }
  flow(document.getElementById("flow"), { ribbons: 3, lines: 24, y: innerWidth < 700 ? 0.78 : 0.6 });
  flow(document.getElementById("flow2"), { ribbons: 2, lines: 18, y: 0.5, alpha: 0.7 });
})();
/* signed-in customers: the header button opens their dashboard */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("ao.s") || "{}");
    if (!(s.license && s.license.until > Date.now())) return;
    document.querySelectorAll(".demobtn").forEach(function (b) { b.textContent = "My dashboard"; b.setAttribute("href", "app#account"); });
  } catch (e) { }
})();
