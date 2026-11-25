/* Aorta demo companies: fictional, generated from a fixed seed so every run is the same.
   Produces the kind of exports a real business has (bank CSV, invoices, bills, sales by product)
   so the demo runs through the same automatic data finding as real files. */
(function (root) {
  "use strict";
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function D(y, m, d) { return new Date(Date.UTC(y, m, d)); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function us(d) { return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear(); }
  function add(d, n) { return new Date(d.getTime() + n * 864e5); }
  function money(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  function csv(rows) { return rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\n"); }
  function normal(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function build(cfg) {
    var r = rng(cfg.seed), start = cfg.start, end = cfg.end, bank = [], ar = [], ap = [], sales = [], SC = cfg.scale || 1;
    function tx(d, amt, party, memo) { if (d > end) return; bank.push({ d: d, a: amt * SC, p: party, m: memo }); }
    var days = Math.round((end - start) / 864e5);
    for (var i = 0; i <= days; i++) {
      var d = add(start, i), dow = d.getUTCDay(), mon = d.getUTCMonth(), dom = d.getUTCDate(), yrs = i / 365;
      var grow = Math.pow(1 + cfg.growth, yrs), seas = cfg.season[mon];
      if (cfg.daily) { var w = cfg.daily.dow[dow]; if (w > 0) { var amt = cfg.daily.base * w * seas * grow * (1 + 0.12 * normal(r)); tx(d, amt, cfg.daily.party, "Card settlement batch"); } }
      cfg.fixed.forEach(function (f) {
        var hit = false;
        if (f.every === "month") hit = dom === f.day;
        else if (f.every === "quarter") hit = dom === f.day && mon % 3 === f.off;
        else if (f.every === "biweekly") hit = dow === 5 && Math.floor(i / 7) % 2 === 0;
        else if (f.every === "semimonth") hit = dom === 15 || dom === (new Date(Date.UTC(d.getUTCFullYear(), mon + 1, 0))).getUTCDate();
        else if (f.every === "week") hit = dow === f.dow;
        if (hit && (!f.from || d >= f.from)) { var a = f.amt * (f.grow ? Math.pow(1 + f.grow, yrs) : 1) * (f.seas ? f.seas[mon] : 1) * (1 + (f.cv || 0) * normal(r)); tx(f.every === "biweekly" || dom !== f.day ? d : d, -a, f.party, f.memo); }
      });
    }
    (cfg.oneoff || []).forEach(function (o) { tx(o.d, o.a, o.p, o.m); });
    /* invoices to customers (accounts receivable) */
    var inv = 1000;
    cfg.customers.forEach(function (c) {
      for (var d = new Date(start); d <= end; d = add(d, c.every + Math.round(r() * 3))) {
        var yrs = (d - start) / 864e5 / 365, amt = c.amt * Math.pow(1 + cfg.growth, yrs) * cfg.season[d.getUTCMonth()] * (1 + 0.15 * normal(r));
        if (c.until && d > c.until) break;
        var lt = c.lateAfter && d >= c.lateAfter.from ? c.lateAfter.late : c.late;
        var due = add(d, c.terms), late = Math.max(-5, Math.round(lt + c.lateSd * normal(r))), paid = add(due, late);
        var num = "INV-" + (inv++);
        ar.push([num, c.name, iso(d), iso(due), money(amt * SC), paid <= end ? iso(paid) : "", paid <= end ? "Paid" : "Open"]);
        if (paid <= end) tx(paid, amt, c.name, "Payment " + num);
      }
    });
    /* bills from suppliers (accounts payable) */
    var bill = 500;
    cfg.suppliers.forEach(function (s) {
      for (var d = new Date(start); d <= end; d = add(d, s.every + Math.round(r() * 2))) {
        var yrs = (d - start) / 864e5 / 365, amt = s.amt * Math.pow(1 + cfg.growth * 0.9, yrs) * cfg.season[d.getUTCMonth()] * (1 + 0.1 * normal(r));
        var due = add(d, s.terms), paid = add(due, Math.round(s.late + 2 * normal(r)));
        var num = "B-" + (bill++);
        ap.push([num, s.name, iso(d), iso(due), money(amt * SC), paid <= end ? iso(paid) : "", paid <= end ? "Paid" : "Open"]);
        if (paid <= end) tx(paid, -amt, s.name, "Bill " + num);
      }
    });
    /* sales by product, last 12 months */
    var y1 = add(end, -365);
    cfg.products.forEach(function (p) {
      for (var m = 0; m < 12; m++) {
        var d = new Date(Date.UTC(y1.getUTCFullYear(), y1.getUTCMonth() + m + 1, 1)), q = Math.round(p.qty * SC * cfg.season[d.getUTCMonth()] * (1 + 0.1 * normal(r)) * (1 + (p.trend || 0) * m / 12));
        sales.push([d.toISOString().slice(0, 7), p.name, q, money(q * p.price), money(q * p.cost)]);
      }
    });
    bank.sort(function (a, b) { return a.d - b.d; });
    if (cfg.measure) { var y = add(end, -365), supN = {}; cfg.suppliers.forEach(function (s) { supN[s.name] = 1; }); var st = { inY: 0, outY: 0, supY: 0, total: 0 };
      bank.forEach(function (t) { st.total += t.a; if (t.d > y) { if (t.a > 0) st.inY += t.a; else { st.outY -= t.a; if (supN[t.p]) st.supY -= t.a; } } }); return st; }
    var bal = cfg.opening * SC;
    var bankRows = [["Posted Date", "Description", "Debit", "Credit", "Balance"]];
    bank.forEach(function (t) { bal += t.a; bankRows.push([us(t.d), (t.p + " " + t.m).trim(), t.a < 0 ? money(-t.a) : "", t.a > 0 ? money(t.a) : "", money(bal)]); });
    return {
      name: cfg.name, about: cfg.about, currency: cfg.currency || "USD",
      files: [
        { name: cfg.slug + "-bank-statement.csv", text: csv(bankRows) },
        { name: cfg.slug + "-invoices.csv", text: csv([["Invoice #", "Customer", "Invoice Date", "Due Date", "Amount", "Date Paid", "Status"]].concat(ar)) },
        { name: cfg.slug + "-bills.csv", text: csv([["Bill No", "Vendor", "Bill Date", "Due Date", "Total", "Paid On", "Status"]].concat(ap)) },
        { name: cfg.slug + "-sales-by-product.csv", text: csv([["Month", "Product", "Units", "Revenue", "Cost of Goods"]].concat(sales)) }
      ]
    };
  }

  var END = D(2026, 10, 23), START = D(2024, 10, 24);
  var SEAS_B = [0.86, 0.84, 0.92, 0.97, 1.02, 1.0, 0.98, 0.96, 0.98, 1.02, 1.12, 1.38];
  var SEAS_N = [0.92, 0.95, 1.04, 1.02, 1.03, 1.0, 0.94, 0.96, 1.05, 1.06, 1.02, 0.98];
  var COMPANIES = {
    bakery: function () {
      return build({
        seed: 7, slug: "sunrise-bakery", name: "Sunrise Bakery", about: "Family bakery and cafe, Austin TX, about $1.1M revenue a year (fictional).", start: START, end: END, opening: 38000, growth: 0.07, season: SEAS_B,
        daily: { party: "SQUARE INC", base: 2350, dow: [1.3, 0, 0.75, 0.8, 0.9, 1.15, 1.6] },
        fixed: [
          { every: "month", day: 1, amt: 5200, party: "Lamar Properties", memo: "Rent" },
          { every: "biweekly", amt: 19000, party: "Gusto Payroll", memo: "Payroll", grow: 0.06, cv: 0.04 },
          { every: "month", day: 10, amt: 640, party: "Austin Energy", memo: "Utilities", seas: [1.1, 1.05, 0.9, 0.85, 0.95, 1.2, 1.35, 1.35, 1.15, 0.9, 0.9, 1.05], cv: 0.05 },
          { every: "month", day: 12, amt: 1290, party: "Frost Bank Loan", memo: "Equipment loan payment" },
          { every: "month", day: 28, amt: 3500, party: "Owner Draw", memo: "Owner distribution" },
          { every: "month", day: 5, amt: 79, party: "Toast POS", memo: "Subscription" },
          { every: "month", day: 7, amt: 45, party: "QuickBooks Online", memo: "Subscription" },
          { every: "month", day: 15, amt: 420, party: "Meta Ads", memo: "Marketing", cv: 0.2 },
          { every: "quarter", day: 20, off: 0, amt: 1350, party: "Hartford Insurance", memo: "Insurance" },
          { every: "quarter", day: 20, off: 1, amt: 6900, party: "Texas Comptroller", memo: "Sales tax", grow: 0.07, cv: 0.08 },
          { every: "month", day: 18, amt: 129, party: "Canva Pro", memo: "Subscription", from: D(2025, 6, 1) },
          { every: "month", day: 22, amt: 199, party: "7shifts", memo: "Scheduling subscription", from: D(2026, 0, 1) }
        ],
        oneoff: [{ d: D(2025, 7, 14), a: -8400, p: "Hobart Service", m: "Oven repair" }, { d: D(2026, 3, 2), a: -12600, p: "Restaurant Depot", m: "Display case" }, { d: D(2026, 10, 16), a: -1874.32, p: "Restaurant Depot", m: "Order 55120" }, { d: D(2026, 10, 17), a: -1874.32, p: "Restaurant Depot", m: "Order 55120" }, { d: D(2026, 10, 19), a: -6400, p: "BrightPath Marketing LLC", m: "Invoice 1" }],
        customers: [
          { name: "Bean There Cafe", every: 14, amt: 1850, terms: 30, late: 6, lateSd: 5 },
          { name: "Hill Country Market", every: 14, amt: 2600, terms: 30, late: 21, lateSd: 9, lateAfter: { from: D(2026, 8, 15), late: 6 } },
          { name: "Eastside Coffee Co", every: 30, amt: 1400, terms: 15, late: 2, lateSd: 3 },
          { name: "Blue Bonnet Catering", every: 30, amt: 3900, terms: 30, late: 14, lateSd: 10 }
        ],
        suppliers: [
          { name: "Central Texas Mill", every: 7, amt: 1750, terms: 15, late: 0 },
          { name: "Dairy Fresh Co", every: 7, amt: 980, terms: 10, late: 1 },
          { name: "Sysco", every: 14, amt: 1900, terms: 21, late: 2 },
          { name: "PackRite Packaging", every: 30, amt: 760, terms: 30, late: 5 }
        ],
        products: [
          { name: "Sourdough loaves", qty: 2600, price: 9, cost: 2.6 },
          { name: "Croissants & pastries", qty: 5200, price: 4.5, cost: 1.4 },
          { name: "Custom cakes", qty: 140, price: 85, cost: 31, trend: 0.15 },
          { name: "Coffee & drinks", qty: 6100, price: 4.75, cost: 1.05 },
          { name: "Catering trays", qty: 90, price: 120, cost: 101 },
          { name: "Wholesale bread", qty: 3300, price: 4.2, cost: 3.55, trend: 0.08 }
        ]
      });
    },
    northwind: function () { return industrial({ seed: 42, slug: "northwind-components", name: "Northwind Components", about: "Industrial parts maker, 700 employees, about $100M revenue a year (fictional).", scale: 1.6 }); },
    halvorsen: function () {
      var us = industrial({ seed: 101, slug: "halvorsen-us", name: "Halvorsen Group", scale: 7.7 }),
        eu = industrial({ seed: 202, slug: "halvorsen-eu", name: "Halvorsen Europe", scale: 3.2, currency: "EUR", plain: true, rename: EU, customers: EU_CUST, opening: 7200000 }),
        uk = industrial({ seed: 303, slug: "halvorsen-uk", name: "Halvorsen UK", scale: 1.25, currency: "GBP", plain: true, rename: UK, customers: UK_CUST, opening: 6000000 });
      function tag(c, ccy) { return c.files.map(function (f) { return { name: f.name, text: f.text, currency: ccy }; }); }
      return { name: "Halvorsen Group", about: "Industrial group with US, euro and UK businesses, about $800M revenue a year (fictional).", currency: "USD", files: tag(us, "USD").concat(tag(eu, "EUR"), tag(uk, "GBP")) };
    }
  };
  var EU = { "ADP Payroll": "Personio Payroll", "Prologis": "Segro Europe", "Blue Cross Blue Shield": "AOK Benefits", "Oncor Electric": "E.ON Energie", "JPMorgan Term Loan": "Deutsche Bank Loan", "IRS": "Finanzamt", "Travelers Insurance": "Allianz", "Nucor Steel": "Thyssenkrupp Steel", "Alcoa": "Hydro Aluminium", "Grainger": "Wurth", "Fastenal": "Hoffmann Group", "UPS Freight": "DB Schenker", "Sherwin-Williams": "AkzoNobel", "Haas Automation": "DMG Mori", "Fanuc America": "KUKA Robotics", "Apex Logistix Inc": "Nordwerk Handels GmbH", "Kingsway Industrial Supply": "Rheinland Industriebedarf" };
  var UK = { "ADP Payroll": "Sage Payroll", "Prologis": "Segro UK", "Blue Cross Blue Shield": "Bupa", "Oncor Electric": "British Gas Business", "JPMorgan Term Loan": "Barclays Loan", "IRS": "HMRC", "Travelers Insurance": "Aviva", "Nucor Steel": "British Steel", "Alcoa": "Hydro UK", "Grainger": "RS Components", "Fastenal": "Screwfix Trade", "UPS Freight": "DHL UK", "Sherwin-Williams": "Dulux Trade", "Haas Automation": "Yamazaki Mazak UK", "Fanuc America": "ABB Robotics UK", "Apex Logistix Inc": "Thameside Trading Ltd", "Kingsway Industrial Supply": "Pennine Industrial Ltd" };
  var EU_CUST = ["Brandt Maschinenbau", "Lindqvist Energi", "Vogel Lebensmittel", "Moreau Fabrication", "Kessler Klinikum", "Aurora Aviazione", "Granit Logistik", "Hafen Marine", "Eisenholz Bau", "Tannen Handel", "Ostwerk Versorgung", "Lago Automotive", "Mercator Medizin", "Nordbergbau", "Orbis Verteidigung", "Pakko Verpackung", "Steinbruch AG", "Rotholz Papier"];
  var UK_CUST = ["Albion Engineering", "Brightwater Energy", "Cotswold Foods", "Dunmore Fabrication", "Elmfield Health", "Fenwick Aerospace", "Granby Logistics", "Harbourside Marine", "Ironbridge Construction", "Juniper Retail UK", "Kestrel Utilities", "Lakeland Motors", "Marlow Medical", "Northmoor Mining", "Oakham Defence", "Penrose Packaging", "Quarrystone Materials", "Redcliffe Paper"];
  function industrial(o) {
      var custs = [], names = o.customers || ["Apex Industrial", "Brightline Energy", "Cascade Foods", "Delta Fabrication", "Evergreen Health", "Falcon Aerospace", "Granite Logistics", "Harbor Marine", "Ironwood Construction", "Juniper Retail", "Keystone Utilities", "Lakeshore Automotive", "Meridian Medical", "Northstar Mining", "Orion Defense", "Pinnacle Packaging", "Quarry Materials", "Redwood Paper"];
      names.forEach(function (n, i) { custs.push({ name: n, every: 30, amt: i === 0 ? 1050000 : 95000 + (i * 37000) % 260000, terms: i % 3 === 0 ? 60 : 45, late: i === 4 ? 34 : i === 9 ? 27 : 4 + (i % 5) * 2, lateSd: 6 }); });
      var cfg = {
        seed: o.seed, slug: o.slug, name: o.name, about: o.about, scale: o.scale, currency: o.currency, start: START, end: END, opening: o.opening || 9500000, growth: 0.09, season: SEAS_N,
        fixed: [
          { every: "semimonth", amt: 720000, party: "ADP Payroll", memo: "Payroll", grow: 0.05, cv: 0.02 },
          { every: "month", day: 1, amt: 185000, party: "Prologis", memo: "Plant lease" },
          { every: "month", day: 3, amt: 96000, party: "Blue Cross Blue Shield", memo: "Benefits", grow: 0.08 },
          { every: "month", day: 12, amt: 74000, party: "Oncor Electric", memo: "Utilities", cv: 0.07 },
          { every: "month", day: 15, amt: 210000, party: "JPMorgan Term Loan", memo: "Loan payment" },
          { every: "month", day: 6, amt: 38000, party: "Salesforce", memo: "Subscription", grow: 0.12 },
          { every: "month", day: 8, amt: 22000, party: "Microsoft 365", memo: "Subscription", grow: 0.1 },
          { every: "month", day: 9, amt: 31000, party: "NetSuite", memo: "Subscription" },
          { every: "month", day: 11, amt: 17500, party: "AWS", memo: "Cloud hosting", grow: 0.25, cv: 0.06 },
          { every: "month", day: 19, amt: 26000, party: "Snowflake", memo: "Data platform", from: D(2025, 8, 1), grow: 0.3 },
          { every: "quarter", day: 15, off: 0, amt: 800000, party: "IRS", memo: "Estimated tax", grow: 0.09 },
          { every: "quarter", day: 25, off: 2, amt: 260000, party: "Travelers Insurance", memo: "Insurance" }
        ],
        oneoff: [{ d: D(2025, 4, 20), a: -2400000, p: "Haas Automation", m: "CNC machines capex" }, { d: D(2026, 5, 2), a: -1350000, p: "Fanuc America", m: "Robotics cell capex" }, { d: D(2026, 10, 12), a: -148250, p: "Apex Logistix Inc", m: "Wire" }, { d: D(2026, 10, 18), a: -87430.15, p: "Kingsway Industrial Supply", m: "PO 7781" }, { d: D(2026, 10, 19), a: -87430.15, p: "Kingsway Industrial Supply", m: "PO 7781" }],
        customers: custs,
        suppliers: [
          { name: "Nucor Steel", every: 14, amt: 380000, terms: 30, late: 2 },
          { name: "Alcoa", every: 14, amt: 240000, terms: 30, late: 1 },
          { name: "Grainger", every: 7, amt: 55000, terms: 30, late: 3 },
          { name: "Fastenal", every: 7, amt: 35000, terms: 30, late: 0 },
          { name: "UPS Freight", every: 7, amt: 60000, terms: 15, late: 1 },
          { name: "Sherwin-Williams", every: 30, amt: 120000, terms: 45, late: 4 }
        ],
        products: [
          { name: "Hydraulic fittings", qty: 41000, price: 34, cost: 19.5 },
          { name: "Precision gears", qty: 12500, price: 118, cost: 71 },
          { name: "Custom brackets", qty: 26000, price: 22, cost: 20.2, trend: 0.1 },
          { name: "Bearing assemblies", qty: 9800, price: 96, cost: 52 },
          { name: "Valve bodies", qty: 6400, price: 155, cost: 128 },
          { name: "Aftermarket service kits", qty: 7200, price: 64, cost: 21, trend: 0.2 }
        ]
      };
      if (o.plain) cfg.oneoff = cfg.oneoff.slice(0, 2);
      if (o.rename) { var rn = function (n) { return o.rename[n] || n; }; cfg.fixed.forEach(function (f) { f.party = rn(f.party); }); cfg.suppliers.forEach(function (x) { x.name = rn(x.name); }); cfg.oneoff.forEach(function (x) { x.p = rn(x.p); }); }
      return build(cfg);
  }
  /* ---------- a fictional sample company for every industry and size ---------- */
  var SCALE = { s1: 0.45, s2: 2.2, s3: 26, s4: 260, s5: 1900 };
  var BAND = { s1: "about $550K", s2: "about $2.7M", s3: "about $32M", s4: "about $320M", s5: "about $2.3B" };
  var IND = {
    restaurant: { names: ["Sunrise Bakery", "Sunrise Bakery", "Harvest Table Group", "Copper Kettle Restaurants", "Golden Fork Hospitality"], what: "restaurant group", city: "Austin, TX", daily: 0.92, card: "SQUARE INC", season: "B",
      cust: ["Lakeside Offices", "Bean There Cafe", "Hill Country Market", "Blue Bonnet Catering"], sup: ["Sysco", "US Foods", "Central Texas Mill", "Dairy Fresh Co"],
      prod: [["Dine-in meals", 22, 7.4, 1800], ["Takeout & delivery", 19, 6.8, 1400], ["Coffee & drinks", 4.75, 1.05, 3500], ["Catering trays", 120, 92, 60], ["Desserts", 6.5, 2.1, 1300], ["Private events", 900, 520, 8]] },
    retail: { names: ["Maple & Thread Boutique", "Maple & Thread", "Brightway Outfitters", "Brightway Stores", "Brightway Retail Group"], what: "retailer", city: "Denver, CO", daily: 0.95, card: "SHOPIFY PAYMENTS", season: "R",
      cust: ["Corporate gift orders", "Wholesale partners"], sup: ["Pacific Apparel Co", "Northline Footwear", "Summit Supply", "Uline"],
      prod: [["Apparel", 48, 22, 900], ["Footwear", 85, 44, 280], ["Accessories", 26, 9, 700], ["Outdoor gear", 120, 70, 160], ["Gift cards", 50, 50, 120], ["Clearance", 18, 15, 400]] },
    construction: { names: ["Ridgeline Renovations", "Ridgeline Builders", "Ironwood Construction", "Ironwood Construction Group", "Ironwood Infrastructure"], what: "builder", city: "Phoenix, AZ", daily: 0, season: "C",
      cust: ["Desert Ridge HOA", "Maricopa School District", "Camelback Properties", "Sonoran Medical Plaza", "Valley Retail Partners"], sup: ["Home Depot Pro", "Ferguson Supply", "Sunbelt Rentals", "ABC Concrete", "84 Lumber"],
      prod: [["Remodels", 42000, 31000, 1.2], ["New builds", 260000, 214000, 0.15], ["Commercial fit-outs", 85000, 66000, 0.35], ["Repairs & service calls", 650, 300, 30], ["Roofing", 14000, 10200, 0.6], ["Change orders", 3200, 1700, 2]] },
    services: { names: ["Shine Auto Detail", "Shine Auto Care", "Clearpath Home Services", "Clearpath Services", "Clearpath Services Group"], what: "service company", city: "Charlotte, NC", daily: 0.8, card: "STRIPE PAYOUT", season: "N",
      cust: ["Fleet accounts", "Property managers", "Apartment communities"], sup: ["Grainger", "AutoZone Commercial", "Cintas", "Shell Fleet"],
      prod: [["Standard service", 120, 38, 380], ["Premium service", 260, 85, 120], ["Memberships", 39, 6, 600], ["Repairs", 340, 150, 60], ["Add-ons", 35, 8, 500], ["Fleet contracts", 2200, 1300, 4]] },
    professional: { names: ["Clark & Rivera CPAs", "Clark & Rivera Advisors", "Meridian Consulting Partners", "Meridian Advisory", "Meridian Global Advisory"], what: "advisory firm", city: "Chicago, IL", daily: 0.1, card: "STRIPE PAYOUT", season: "P",
      cust: ["Lakeshore Health", "Prairie Logistics", "Union Street Bank", "Northside Schools", "Greenline Energy", "Wabash Foods"], sup: ["WeWork", "Thomson Reuters", "LinkedIn Sales", "Gusto Benefits"],
      prod: [["Monthly retainers", 3500, 1600, 12], ["Tax & audit", 6800, 3400, 3], ["Projects", 24000, 13000, 0.6], ["Advisory hours", 220, 95, 120], ["Training", 1500, 500, 3], ["Software resale", 400, 310, 10]] },
    health: { names: ["Bright Smile Dental", "Bright Smile Dental", "Riverbend Family Clinics", "Riverbend Health Partners", "Riverbend Health System"], what: "healthcare practice", city: "Columbus, OH", daily: 0.35, card: "PATIENT PAYMENTS", season: "N",
      cust: ["Aetna", "UnitedHealthcare", "Medicare", "Blue Cross", "Cigna"], sup: ["Henry Schein", "McKesson", "Medline", "Quest Diagnostics"],
      prod: [["Office visits", 165, 70, 380], ["Procedures", 950, 420, 25], ["Cleanings & preventive", 140, 45, 220], ["Lab work", 85, 40, 140], ["Imaging", 320, 120, 30], ["Products", 30, 12, 140]] },
    manufacturing: { names: ["Precision Craft Works", "Precision Craft Works", "Northwind Components", "Northwind Components", "Halvorsen Group"], what: "manufacturer", city: "Milwaukee, WI", daily: 0, season: "N",
      cust: ["Apex Industrial", "Brightline Energy", "Cascade Foods", "Delta Fabrication", "Harbor Marine"], sup: ["Nucor Steel", "Grainger", "Fastenal", "UPS Freight"],
      prod: [["Machined parts", 34, 19.5, 1100], ["Assemblies", 118, 71, 250], ["Custom work", 22, 20.2, 600], ["Service kits", 64, 21, 180], ["Repairs", 450, 210, 12], ["Prototypes", 2500, 1600, 2]] },
    realestate: { names: ["Oakline Rentals", "Oakline Property Co", "Keystone Property Management", "Keystone Properties", "Keystone Real Estate Trust"], what: "property company", city: "Atlanta, GA", daily: 0, season: "N",
      cust: ["Tenant rents (Unit block A)", "Tenant rents (Unit block B)", "Commercial tenant: Peachtree Dental", "Commercial tenant: Midtown Fitness", "Management fees"], sup: ["Atlanta Water", "Georgia Power", "Mr. Handyman", "Waste Management", "Brightview Landscaping"],
      prod: [["Residential rent", 1650, 420, 42], ["Commercial rent", 6200, 1500, 3], ["Management fees", 900, 300, 6], ["Parking & storage", 85, 10, 60], ["Late fees", 50, 0, 15], ["Application fees", 45, 10, 25]] },
    software: { names: ["Pixel Lane Studio", "Pixel Lane Software", "Cloudnest Software", "Cloudnest Inc", "Cloudnest Global"], what: "software company", city: "Seattle, WA", daily: 0.6, card: "STRIPE PAYOUT", season: "N",
      cust: ["Acme Logistics (annual plan)", "Brightpath Schools", "Coastal Credit Union", "Driftwood Retail", "Evergreen Clinics"], sup: ["AWS", "Google Workspace", "HubSpot", "Upwork contractors"],
      prod: [["Starter plans", 29, 4, 1100], ["Pro plans", 99, 12, 420], ["Enterprise plans", 1800, 260, 8], ["Implementation", 4500, 2600, 1], ["Support add-on", 49, 10, 150], ["Custom development", 12000, 7800, 0.5]] },
    wholesale: { names: ["Gulf Coast Supply", "Gulf Coast Distributors", "Atlas Wholesale", "Atlas Distribution", "Atlas Distribution Group"], what: "distributor", city: "Houston, TX", daily: 0, season: "N",
      cust: ["H-E-B Stores", "Bayou Grocers", "Lone Star Restaurants", "Coastal Hardware", "Westpark Convenience", "Harris County Schools"], sup: ["Cargill", "General Mills Foodservice", "Ryder Logistics", "Sealed Air"],
      prod: [["Dry goods", 24, 19.4, 1500], ["Frozen", 46, 37, 520], ["Paper & packaging", 31, 24, 600], ["Beverages", 18, 13.8, 1100], ["Cleaning supplies", 27, 19, 400], ["Equipment", 650, 540, 8]] },
    other: { names: ["Bluebird Co", "Bluebird & Co", "Summit Holdings", "Summit Group", "Summit Global"], what: "business", city: "Kansas City, MO", daily: 0.5, card: "STRIPE PAYOUT", season: "N",
      cust: ["Prairie Partners", "Riverfront Co", "Union Station Group", "Westport Ventures"], sup: ["Staples Business", "Uline", "FedEx", "Cintas"],
      prod: [["Core product", 60, 26, 650], ["Services", 180, 80, 120], ["Subscriptions", 29, 6, 500], ["Custom orders", 900, 540, 10], ["Add-ons", 25, 7, 300], ["Wholesale", 30, 24, 300]] }
  };
  var SEAS = { B: [0.86, 0.84, 0.92, 0.97, 1.02, 1.0, 0.98, 0.96, 0.98, 1.02, 1.12, 1.38], R: [0.78, 0.8, 0.92, 0.96, 1.0, 0.98, 0.97, 1.02, 0.95, 1.0, 1.18, 1.55], C: [0.78, 0.82, 0.98, 1.06, 1.12, 1.15, 1.14, 1.12, 1.06, 1.0, 0.92, 0.82], P: [1.05, 1.12, 1.3, 1.35, 0.95, 0.92, 0.85, 0.88, 1.0, 1.0, 0.92, 0.9], N: [0.92, 0.95, 1.04, 1.02, 1.03, 1.0, 0.94, 0.96, 1.05, 1.06, 1.02, 0.98] };
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function industryCo(ind, size) {
    var t = IND[ind] || IND.other, tier = { s1: 0, s2: 1, s3: 2, s4: 3, s5: 4 }.hasOwnProperty(size) ? { s1: 0, s2: 1, s3: 2, s4: 3, s5: 4 }[size] : 1, sc = SCALE[size] || 1, big = tier >= 2, seedBase = 11 + tier * 7 + Object.keys(IND).indexOf(ind) * 31;
    var name = t.names[tier], rev = 100000; /* monthly revenue at scale 1 */
    var dailyRev = rev * t.daily, invRev = rev - dailyRev;
    var cust = t.cust.map(function (n, i) { var share = (t.cust.length - i) / (t.cust.length * (t.cust.length + 1) / 2); return { name: n, every: 30, amt: invRev * share, terms: [30, 45, 30, 15, 60, 30][i % 6], late: [4, 12, 2, 21, 6, 9][i % 6], lateSd: 5 }; });
    if (!invRev) cust = [];
    var sup = t.sup.map(function (n, i) { return { name: n, every: [14, 30, 7, 30, 14][i % 5], amt: [9000, 7000, 2500, 3500, 4000][i % 5] * ([14, 30, 7, 30, 14][i % 5] / 30), terms: [30, 30, 15, 45, 21][i % 5], late: [2, 4, 0, 6, 1][i % 5] }; });
    var fixed = [
      { every: "month", day: 1, amt: 6000, party: big ? "Prologis" : "Oak Street Properties", memo: big ? "Lease" : "Rent" },
      { every: big ? "semimonth" : "biweekly", amt: big ? 19500 : 18000, party: big ? "ADP Payroll" : "Gusto Payroll", memo: "Payroll", grow: 0.05, cv: 0.03 },
      { every: "month", day: 10, amt: 700, party: big ? "Duke Energy" : "City Utilities", memo: "Utilities", cv: 0.06 },
      { every: "month", day: 12, amt: 1300, party: big ? "JPMorgan Term Loan" : "Community Bank Loan", memo: "Loan payment" },
      { every: "month", day: 6, amt: 260, party: big ? "Salesforce" : "QuickBooks Online", memo: "Subscription", grow: 0.08 },
      { every: "month", day: 15, amt: 600, party: big ? "Google Ads" : "Meta Ads", memo: "Marketing", cv: 0.2 },
      { every: "quarter", day: 20, off: 0, amt: 1500, party: big ? "Travelers Insurance" : "Hartford Insurance", memo: "Insurance" },
      { every: "quarter", day: 15, off: 1, amt: 5200, party: big ? "IRS" : "IRS EFTPS", memo: "Estimated tax", grow: 0.07, cv: 0.08 }
    ];
    if (!big) fixed.push({ every: "month", day: 28, amt: 3500, party: "Owner Draw", memo: "Owner distribution" });
    var cfg = { seed: seedBase, slug: slugify(name), name: name, start: START, end: END, opening: 52000, growth: 0.06 + (tier % 3) * 0.01, season: SEAS[t.season] || SEAS.N, scale: sc,
      daily: dailyRev ? { party: t.card, base: dailyRev * 12 / 312, dow: [ind === "restaurant" || ind === "retail" ? 1.3 : 0.3, 0, 0.9, 0.95, 1.0, 1.15, ind === "restaurant" || ind === "retail" ? 1.6 : 0.9] } : null,
      fixed: fixed, oneoff: [{ d: D(2025, 7, 14), a: -8000, p: big ? "Capital project" : "Equipment repair", m: "One-time" }, { d: D(2026, 3, 2), a: -11000, p: big ? "Systems upgrade" : "New equipment", m: "One-time" }],
      customers: cust, suppliers: sup, products: t.prod.map(function (p) { return { name: p[0], price: p[1], cost: p[2], qty: p[3] }; }) };
    /* tune to a typical margin and cash cushion for the industry */
    var MARGIN = { restaurant: 0.06, retail: 0.07, construction: 0.08, services: 0.1, professional: 0.14, health: 0.11, manufacturing: 0.09, realestate: 0.18, software: 0.15, wholesale: 0.04, other: 0.09 }[ind] || 0.09;
    cfg.measure = true; var st = build(cfg); cfg.measure = false;
    var wantOut = st.inY * (1 - MARGIN), otherOut = st.outY - st.supY, f = st.supY > 0 ? Math.max(0.2, (wantOut - otherOut) / st.supY) : 1;
    cfg.suppliers.forEach(function (s) { s.amt *= f; });
    cfg.measure = true; st = build(cfg); cfg.measure = false;
    var cushionDays = 38 + (seedBase % 5) * 9, wantEnd = cushionDays * (st.outY / 365);
    cfg.opening = Math.max(wantEnd * 0.25, wantEnd - st.total) / sc;
    var c = build(cfg);
    c.about = "Fictional " + t.what + " in " + t.city + ", " + BAND[size] + " revenue a year.";
    return c;
  }
  var api = { get: function (k) { if (/^ind:/.test(k)) { var q = k.split(":"); return industryCo(q[1], q[2]); } return COMPANIES[k](); }, pick: function (ind, size) {
      if (ind === "restaurant" && (size === "s1" || size === "s2")) return "bakery";
      if (ind === "manufacturing") return size === "s3" ? "northwind" : size === "s4" || size === "s5" ? "halvorsen" : "ind:manufacturing:" + size;
      return "ind:" + (IND[ind] ? ind : "other") + ":" + (SCALE[size] ? size : "s2"); }, list: [["bakery", "Sunrise Bakery", "Small business · about $1.1M"], ["northwind", "Northwind Components", "Mid-size · about $100M"], ["halvorsen", "Halvorsen Group", "Large, 3 currencies · about $800M"]] };
  if (typeof module !== "undefined") module.exports = api; else root.AODemo = api;
})(typeof window !== "undefined" ? window : this);
