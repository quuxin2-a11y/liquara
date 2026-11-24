/* Aorta boardroom answers: plain-language questions answered from the live model of the business.
   Every number comes from the engine; nothing is made up. When a question needs a "what if",
   it runs the simulation again with that change. */
(function (root) {
  "use strict";
  var E = root.AOE || (typeof require !== "undefined" ? require("./engine.js") : null);
  var m = function (x) { return E.money(x); }, pc = function (x) { return Math.round(x * 100) + "%"; };

  function amount(q) {
    var re = /(\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|mm|million|b|billion)?(?![\w%])/gi, x, best = null;
    while ((x = re.exec(q))) {
      var n = parseFloat(x[2].replace(/,/g, "")), u = (x[3] || "").toLowerCase(), score = (x[1] ? 2 : 0) + (u ? 2 : 0);
      if (/^(\s*(people|person|hires?|employees?|staff|weeks?|months?|years?|days?|%|percent))/i.test(q.slice(re.lastIndex))) continue;
      if (u === "k" || u === "thousand") n *= 1e3; else if (u === "m" || u === "mm" || u === "million") n *= 1e6; else if (u === "b" || u === "billion") n *= 1e9;
      if (!best || score > best.s || (score === best.s && n > best.n)) best = { n: n, s: score };
    }
    return best ? best.n : null;
  }
  function percent(q) { var x = /(-?\d+(?:\.\d+)?)\s*(%|percent)/i.exec(q); return x ? parseFloat(x[1]) : null; }
  function count(q) { var x = /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+)?(people|person|hires?|employees?|staff|engineers?|reps?|workers?|bakers?|managers?|salespeople|drivers?|nurses?|associates?|analysts?)/i.exec(q); if (!x) return null; var w = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }; return w[x[1].toLowerCase()] || +x[1]; }
  function horizon(q, FC) {
    var wk = /(\d+)\s*weeks?/i.exec(q), mo = /(\d+)\s*months?/i.exec(q);
    if (/next week/i.test(q)) return { j: 7, label: "next week" };
    if (wk) return { j: Math.min(+wk[1] * 7, FC.H), label: "in " + wk[1] + " weeks" };
    if (mo) return { j: Math.min(Math.round(+mo[1] * 30.4), FC.H), label: "in " + mo[1] + " months" };
    if (/quarter|13/i.test(q)) return { j: 91, label: "in 13 weeks" };
    if (/next month|30 days/i.test(q)) return { j: 30, label: "in 30 days" };
    if (/year|12 months|annual/i.test(q)) return { j: 365, label: "in 12 months" };
    return { j: 91, label: "in 13 weeks" };
  }
  function at(FC, j) { return FC.days[Math.min(j, FC.days.length - 1)]; }
  function dateAt(FC, j) { return E.fmtDate(E.fromKey(FC.cut + j)); }
  /* the lowest the balance is likely to get, on a careful (P10) reading */
  function careful(FC, days) { var lo = Infinity, lj = 0; for (var j = 1; j <= Math.min(days, FC.H); j++) if (FC.days[j].p10 < lo) { lo = FC.days[j].p10; lj = j; } return { v: lo, j: lj }; }

  var INTENTS = [
    { id: "accuracy", re: /accura|trust (this|the|it)|how sure|confiden|reliab|backtest|how good is/i, run: accuracy },
    { id: "afford", re: /afford|can we (hire|buy|spend|pay|add|open)|hire|hiring|new (location|store|office|plant|line)|should we (buy|spend|invest|open|expand)|capex|purchase/i, run: afford },
    { id: "price", re: /(raise|increase|cut|lower|drop) (our |the )?prices?|price (increase|rise|cut|change)/i, run: price },
    { id: "downturn", re: /recession|downturn|sales (drop|fall|decline)|revenue (drops?|falls?|declines?)|lose (\d+|some|a lot)|worst case|stress/i, run: downturn },
    { id: "lose", re: /lose (our )?(biggest|top|largest|main) (customer|client)|(biggest|top|largest) customer (leaves|left|goes)/i, run: loseTop },
    { id: "loan", re: /loan|borrow|line of credit|financing|raise (money|capital|debt)|need (funding|money|capital)/i, run: loan },
    { id: "distribute", re: /dividend|distribut|take out|owner draw|bonus|buyback|return (cash|capital)|how much (cash )?can (we|i) (take|pull|spend)|excess cash|idle cash|invest (the )?(extra|spare)/i, run: distribute },
    { id: "runway", re: /runway|run out|last|how long|survive|go broke|bankrupt/i, run: runway },
    { id: "low", re: /low(est)? point|tight|dip|crunch|short(fall)?|overdraft|make payroll/i, run: low },
    { id: "forecast", re: /forecast|projection|predict|expect|where will|end of|next (week|month|quarter|year)|in \d+ (weeks?|months?)|balance (be|look)/i, run: forecast },
    { id: "now", re: /how much (cash|money)|cash (now|today|position)|balance|bank/i, run: now },
    { id: "late", re: /late|slow pay|overdue|collect|receivable|dso|days sales|who owes/i, run: late },
    { id: "payables", re: /payable|dpo|suppliers?|vendors?|bills?|pay (our|the) (bills|suppliers)/i, run: payables },
    { id: "customers", re: /customers?|clients?|concentration|depend|who (pays|buys)/i, run: customers },
    { id: "margin", re: /margins?|profitab|worth it|which products?|services?|drop (a|the) (product|line)|product mix|gross profit|unit economics/i, run: margin },
    { id: "grow", re: /grow|growth|expand|opportunit|upside|where (can|should) we|increase (profit|revenue|sales)|scale/i, run: grow },
    { id: "cut", re: /cut costs?|save|spending|expenses?|costs? (rising|up|grow)|overhead|waste|subscriptions?|burn/i, run: cut },
    { id: "risk", re: /risks?|worr|danger|threat|red flags?|what could go wrong|exposure/i, run: risk },
    { id: "trend", re: /last year|year over year|yoy|compare|trend|better|worse|change/i, run: trend },
    { id: "summary", re: /summary|overview|brief|board|how are we doing|health|state of|tl;?dr|status/i, run: summary }
  ];

  function ask(q, C) {
    q = String(q || "").trim(); if (!q) return help();
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].re.test(q)) { try { var r = INTENTS[i].run(q, C); r.intent = INTENTS[i].id; return r; } catch (e) { return { title: "I couldn't work that out", text: "Something in that question tripped me up (" + e.message + "). Try asking it a simpler way.", intent: "error" }; } }
    var h = help(); h.title = "Here's what I can answer"; h.text = "I didn't catch that one. I answer from your own numbers, so ask about cash, runway, customers, margins, costs, growth, risks or a what-if."; return h;
  }
  function help() { return { title: "Ask the board questions", text: "Every answer is worked out from your own data and the forecast.", bullets: SUGGEST.slice(0, 8), intent: "help" }; }
  var SUGGEST = ["How much cash will we have at the end of the quarter?", "Can we afford to hire 3 people at $85k?", "What's our lowest point in the next 13 weeks?", "Which products are worth it?", "Who pays us late?", "Where can we grow?", "What if sales drop 15%?", "How much can we safely distribute?", "What are our biggest risks?", "How accurate is this forecast?", "Give me the board summary"];

  function now(q, C) {
    var A = C.analysis;
    return { title: "Cash today: " + m(A.balance), text: "As of " + E.fmtDate(A.asOf) + ". Money in averages " + m(A.inMonth) + " a month and money out " + m(A.outMonth) + " (last 90 days), so cash is " + (A.netMonth >= 0 ? "growing about " + m(A.netMonth) : "shrinking about " + m(-A.netMonth)) + " a month.", bullets: [A.cushionDays ? "That covers about " + Math.round(A.cushionDays) + " days of normal spending." : null, A.arOpen ? m(A.arOpen) + " is owed to you on open invoices." : null, A.apOpen ? m(A.apOpen) + " is owed to suppliers on open bills." : null].filter(Boolean) };
  }
  function forecast(q, C) {
    var FC = C.forecast, h = horizon(q, FC), d = at(FC, h.j);
    return { title: m(d.p50) + " " + h.label, text: "Most likely balance on " + dateAt(FC, h.j) + ". In 8 of 10 likely futures it lands between " + m(d.p10) + " and " + m(d.p90) + ".", bullets: ["Today: " + m(FC.start), "Change: " + (d.p50 >= FC.start ? "+" : "") + m(d.p50 - FC.start)], chart: { days: h.j } };
  }
  function low(q, C) {
    var FC = C.forecast, c = careful(FC, 91);
    return { title: "Lowest point: about " + m(FC.low13.value) + " around " + E.fmtDate(FC.low13.date), text: "On a careful reading (only 1 in 10 futures is worse) cash bottoms at " + m(c.v) + " around " + dateAt(FC, c.j) + ". Chance of going below zero in 13 weeks: " + pc(FC.pShort13) + ".", bullets: lowWhy(C, FC.low13.date), chart: { days: 91 } };
  }
  function lowWhy(C, date) {
    var k = E.dayKey(date), out = [];
    (C.fit.rec || []).forEach(function (r) { if (r.dir !== "-") return; var hits = 0; for (var j = k - 6; j <= k; j++) { if (r.period >= 28 && r.dom && Math.abs(E.fromKey(j).getUTCDate() - r.dom) < 1) hits++; } if (hits) out.push(r.party.replace(/\s+/g, " ") + " (" + m(Math.abs(r.amount)) + ") lands that week"); });
    return out.slice(0, 3);
  }
  function runway(q, C) {
    var A = C.analysis, FC = C.forecast;
    if (A.netMonth >= 0 && FC.pShortYear < 0.05) return { title: "No runway problem", text: "Cash is growing about " + m(A.netMonth) + " a month and the forecast doesn't go below zero in the next 12 months (" + pc(FC.pShortYear) + " chance).", bullets: ["If income stopped completely, today's cash covers about " + Math.round(A.cushionDays || 0) + " days of spending."] };
    return { title: A.runway ? "About " + A.runway.toFixed(1) + " months of runway" : "Watch cash closely", text: "At the current pace cash shrinks " + m(-A.netMonth) + " a month. Chance of going below zero: " + pc(FC.pShort13) + " in 13 weeks, " + pc(FC.pShortYear) + " in 12 months.", bullets: (A.opportunities || []).filter(function (o) { return o.kind === "cash" || o.kind === "cost"; }).slice(0, 3).map(function (o) { return o.title + ": " + m(o.value); }) };
  }
  function afford(q, C) {
    var n = count(q), amt = amount(q), sc = {}, what;
    if (n || /hire|hiring|people|staff|employee/i.test(q)) {
      n = n || 1; var pay = amt || 60000; if (pay > 1e6) pay = pay / n; var monthly = pay * 1.25 / 12;
      sc.hires = [{ count: n, monthly: monthly, month: 1 }]; what = "hiring " + n + (n > 1 ? " people" : " person") + " at " + m(pay) + " a year (" + m(monthly * n) + " a month with taxes and benefits)";
    } else if (amt) { sc.oneOff = [{ day: 14, amount: -amt }]; what = "spending " + m(amt) + " in two weeks"; }
    else return { title: "Tell me the number", text: "Say how much, for example: \"Can we afford to hire 2 people at $70k?\" or \"Can we spend $250k on new equipment?\"" };
    return compare(C, sc, "If we go ahead with " + what);
  }
  function price(q, C) { var p = percent(q) || 5; if (/cut|lower|drop/i.test(q)) p = -Math.abs(p); var r = compare(C, { pricePct: p, volumePct: p > 0 ? -p * 0.4 : -p * 0.6 }, "Prices " + (p > 0 ? "up " : "down ") + Math.abs(p) + "% (assuming " + Math.round(Math.abs(p) * (p > 0 ? 0.4 : 0.6)) + "% " + (p > 0 ? "fewer" : "more") + " sales)"); r.bullets.push("The sales response is an assumption. Try different numbers on the Decisions screen."); return r; }
  function downturn(q, C) { var p = percent(q) || 15; return compare(C, { volumePct: -Math.abs(p) }, "If sales drop " + Math.abs(p) + "%"); }
  function loseTop(q, C) { var t = C.analysis.topCustomer; if (!t) return { title: "No single big customer", text: "No one customer stands out in your receipts." }; return compare(C, { volumePct: -t.share * 100 }, "If " + t.name + " (" + pc(t.share) + " of income) left"); }
  function loan(q, C) { var amt = amount(q) || Math.max(50000, Math.round(C.analysis.outMonth * 2 / 1e4) * 1e4), r = percent(q) || 9; return compare(C, { loan: { amount: amt, rate: r, months: 36, month: 1 } }, "Borrowing " + m(amt) + " at " + r + "% over 3 years"); }
  function compare(C, sc, label) {
    var base = C.base || (C.base = E.scenario(C.model, {}, 300)), alt = E.scenario(C.model, sc, 300), b13 = at(base, 91), a13 = at(alt, 91), b12 = at(base, 365), a12 = at(alt, 365), ca = careful(alt, 365);
    var ok = ca.v > 0 && alt.pShort13 < 0.1, tight = ca.v > 0 && ca.v < C.analysis.outMonth;
    return { title: label + ": " + (ok ? (tight ? "possible, but tight" : "yes, cash holds") : "risky"), text: "In 13 weeks: " + m(a13.p50) + " instead of " + m(b13.p50) + ". In 12 months: " + m(a12.p50) + " instead of " + m(b12.p50) + ".", bullets: ["Careful low point over the year: " + m(ca.v) + " around " + dateAt(alt, ca.j), "Chance of going below zero within 13 weeks: " + pc(alt.pShort13) + " (now " + pc(base.pShort13) + ")", tight ? "That leaves less than one month of spending as a cushion." : null].filter(Boolean), scenario: sc, alt: alt };
  }
  function distribute(q, C) {
    var A = C.analysis, FC = C.forecast, c = careful(FC, 365), cushion = A.outMonth * 2, safe = Math.max(0, c.v - cushion);
    return { title: safe > 0 ? "About " + m(safe) + " could go out safely" : "Not right now", text: "On the careful reading, cash never drops below " + m(c.v) + " in the next 12 months (lowest around " + dateAt(FC, c.j) + "). Keeping two months of spending (" + m(cushion) + ") as a cushion leaves " + m(safe) + ".", bullets: ["This is cash, not profit. Check tax and loan covenants before paying it out.", "Ask \"Can we spend " + m(safe) + "?\" to see the full effect."] };
  }
  function late(q, C) {
    var A = C.analysis, s = A.slowPayers.slice(0, 5);
    return { title: A.dso ? "Customers take " + Math.round(A.dso) + " days to pay" : "Late payers", text: (A.arOverdue ? m(A.arOverdue) + " is overdue right now. " : "") + (s.length ? "The slowest, weighted by how much they owe:" : "No customer is consistently more than a week late."), bullets: s.map(function (c) { return c.name + ": " + Math.round(c.late) + " days late on average (" + m(c.in) + " a year)"; }) };
  }
  function payables(q, C) { var A = C.analysis; return { title: A.dpo ? "You pay suppliers in " + Math.round(A.dpo) + " days" : "Supplier payments", text: m(A.apOpen) + " is open on supplier bills." + (A.dpo != null && A.dpo < 25 ? " You're paying faster than most terms require." : ""), bullets: (A.opportunities || []).filter(function (o) { return /payment terms/.test(o.title); }).map(function (o) { return o.detail; }) }; }
  function customers(q, C) {
    var A = C.analysis;
    return { title: A.topCustomer ? "Largest customer: " + A.topCustomer.name + " (" + pc(A.top1) + ")" : "Customers", text: "Top 5 named customers bring in " + pc(A.top5) + " of cash received in the last 12 months." + (A.top1 > 0.2 ? " That's a lot riding on one relationship." : ""), bullets: A.customers.slice(0, 6).map(function (c) { return c.name + ": " + m(c.in) + " (" + pc(c.share) + ")" + (c.late != null ? ", pays " + (c.late > 0 ? Math.round(c.late) + " days late" : "on time") : ""); }) };
  }
  function margin(q, C) {
    var P = C.analysis.products; if (!P.length) return { title: "Add sales by product", text: "Connect or upload a sales-by-product report (product, revenue, cost) and I'll judge every line." };
    return { title: "Overall margin " + pc(C.analysis.gm || 0) + " after direct costs", text: "Ranked by the profit each one actually brings in:", bullets: P.map(function (p) { return p.name + ": " + pc(p.margin) + " margin, " + m(p.gp) + " profit. " + p.verdict + "."; }) };
  }
  function grow(q, C) { var O = C.analysis.opportunities.filter(function (o) { return o.kind === "growth" || o.kind === "margin"; }); if (!O.length) O = C.analysis.opportunities; return { title: "Best places to grow", text: "Ranked by yearly value:", bullets: O.slice(0, 5).map(function (o) { return o.title + " (" + m(o.value) + "): " + o.action; }) }; }
  function cut(q, C) { var A = C.analysis, up = A.spend.filter(function (s) { return s.change != null; }).sort(function (a, b) { return (b.amount - b.prev) - (a.amount - a.prev); }); return { title: "Where the money goes", text: "Total out in the last 12 months: " + m(A.out12) + ". Biggest increases first:", bullets: up.slice(0, 6).map(function (s) { return s.cat + ": " + m(s.amount) + " (" + (s.change >= 0 ? "+" : "") + pc(s.change) + " vs last year)"; }) }; }
  function risk(q, C) { var R = C.analysis.risks; return { title: R.length ? R.length + " risk" + (R.length > 1 ? "s" : "") + " to watch" : "No major risks found", text: R.length ? "" : "Cash, customer mix and collections look healthy in this data.", bullets: R.map(function (r) { return (r.level === "high" ? "HIGH: " : "") + r.title + ". " + r.detail; }) }; }
  function accuracy(q, C) {
    var B = C.analysis.accuracy; if (!B) return { title: "Not enough history yet", text: "With at least 8 months of bank history I forecast the past and grade myself before showing you a number." };
    return { title: "Balance forecasts were " + pc(B.accuracy) + " accurate", text: "I hid the most recent months, forecast them from older data " + B.origins + " times, and compared with what really happened. The method that did best on your business is the one in use.", bullets: [B.inflowAcc != null ? "Weekly money in: " + pc(B.inflowAcc) + " accurate" : null, B.outflowAcc != null ? "Weekly money out: " + pc(B.outflowAcc) + " accurate" : null, "Actual balance fell inside the shaded range " + pc(B.bandHit) + " of the time", "Accuracy here means 1 minus average error as a share of the balance, over 1 to 13 weeks ahead."].filter(Boolean) };
  }
  function trend(q, C) { var A = C.analysis; return { title: A.growth != null ? "Money in is " + (A.growth >= 0 ? "up " : "down ") + pc(Math.abs(A.growth)) + " on last year" : "Not enough history to compare", text: "Last 12 months: " + m(A.in12) + " in, " + m(A.out12) + " out.", bullets: A.spend.slice(0, 4).filter(function (s) { return s.change != null; }).map(function (s) { return s.cat + " " + (s.change >= 0 ? "up " : "down ") + pc(Math.abs(s.change)); }) }; }
  function summary(q, C) {
    var A = C.analysis, FC = C.forecast, d13 = at(FC, 91), y = at(FC, 365), top = A.opportunities[0];
    return { title: "Board summary", text: "Cash is " + m(A.balance) + " today and most likely " + m(d13.p50) + " in 13 weeks (" + m(d13.p10) + " to " + m(d13.p90) + ") and " + m(y.p50) + " in 12 months.", bullets: [A.growth != null ? "Money in " + (A.growth >= 0 ? "up " : "down ") + pc(Math.abs(A.growth)) + " year over year" : null, A.gm != null ? "Gross margin " + pc(A.gm) : null, A.dso ? "Customers pay in " + Math.round(A.dso) + " days" : null, top ? "Top opportunity: " + top.title + " (" + m(top.value) + ")" : null, A.risks[0] ? "Top risk: " + A.risks[0].title : "No major risks flagged", A.accuracy ? "Forecast tested at " + pc(A.accuracy.accuracy) + " accuracy on your own history" : null].filter(Boolean) };
  }

  var api = { ask: ask, suggestions: SUGGEST, parseAmount: amount };
  if (typeof module !== "undefined") module.exports = api; else root.AOQ = api;
})(typeof window !== "undefined" ? window : this);
