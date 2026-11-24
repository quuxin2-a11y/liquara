document.querySelectorAll(".seg button").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".seg button").forEach(function (x) { x.classList.toggle("on", x === b); });
    var k = +b.dataset.p, per = k === 1 ? ["month", 1] : k === 0.9 ? ["quarter", 3] : ["year", 12];
    document.querySelectorAll(".price").forEach(function (p) { var v = Math.round(+p.dataset.m * per[1] * k); p.innerHTML = "$" + v.toLocaleString() + "<span>/" + per[0] + "</span>"; });
  });
});
