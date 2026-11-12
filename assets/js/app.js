/* BarfChalo — static snow trip planner. All data fetched from free public APIs in the browser. */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
const round50 = n => Math.round(n / 50) * 50;
const OSRM = "https://router.project-osrm.org";
const STATE_SHORT = {"Himachal Pradesh":"Himachal","Uttarakhand":"Uttarakhand","Jammu & Kashmir":"Kashmir & Jammu","Sikkim":"Sikkim"};
const S = { dests: [], cars: [], fuel: {}, meta: {}, from: null, car: null, pax: 4, price: null, priceTouched: false,
            mileage: null, milTouched: false, wx: {}, road: {}, filter: "all", offbeat: false, sort: "best", routeCache: {} };

/* ---------- privacy-friendly counters (Abacus, no cookies, no personal data) ---------- */
const Stats = (() => {
  const API = "https://abacus.jasoncameron.dev", NS = "barfchalo";
  const off = navigator.webdriver || /^(localhost|127\.)/.test(location.hostname) || /[?&#]nocount/.test(location.href) || localStorage.getItem("bc_nocount") === "1";
  const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).replace(/-/g, "");
  const hit = k => off ? Promise.resolve(null) : fetch(`${API}/hit/${NS}/${k}`, { keepalive: true }).then(r => r.json()).catch(() => null);
  const once = (flag, fn) => { try { if (localStorage.getItem(flag)) return; localStorage.setItem(flag, "1"); } catch { return; } fn(); };
  let tripsOpened = new Set();
  return {
    pageview() { hit("pageviews"); hit("pv-" + day());
      once("bc_seen", () => hit("visitors")); once("bc_seen_" + day(), () => hit("uv-" + day())); },
    trip() { const k = location.hash; if (tripsOpened.has(k)) return; tripsOpened.add(k);
      hit("trips").then(r => r && r.value != null && setTrips(r.value)); hit("trips-" + day()); },
    event(k) { hit(k); hit(k + "-" + day()); },
    async showTrips() { try { const r = await fetch(`${API}/get/${NS}/trips`).then(r => r.json()); if (r.value != null) setTrips(r.value); } catch {} }
  };
  function setTrips(n) { const el = document.getElementById("tripCount"); if (el) { el.hidden = false; el.innerHTML = `🧭 <b>${Number(n).toLocaleString("en-IN")}</b> trip${n === 1 ? "" : "s"} planned on BarfChalo so far`; } }
})();

/* ---------- helpers ---------- */
function hav(a, b, c, d) { const R = 6371, r = Math.PI / 180, dp = (c - a) * r, dl = (d - b) * r;
  const h = Math.sin(dp/2)**2 + Math.cos(a*r) * Math.cos(c*r) * Math.sin(dl/2)**2; return 2 * R * Math.asin(Math.sqrt(h)); }
async function getJSON(url, ms = 20000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function normState(s) { if (!s) return null; s = s.replace(/^NCT of /, "").replace(" and ", " & ").replace("Jammu And Kashmir","Jammu & Kashmir");
  if (/delhi/i.test(s)) return "Delhi"; return Object.keys(S.fuel).find(k => k.toLowerCase() === s.toLowerCase()) || null; }
function fmtTime(d) { return new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST"; }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) + ", " + fmtTime(d); }
function fuelUnit(f) { return f === "cng" ? "kg" : f === "ev" ? "kWh" : "litre"; }
function wIcon(code, snow) { if (snow > 0.2 || [71,73,75,77,85,86].includes(code)) return "🌨️";
  if ([95,96,99].includes(code)) return "⛈️"; if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "🌧️";
  if (code === 45 || code === 48) return "🌫️"; if (code === 3) return "☁️"; if (code === 1 || code === 2) return "⛅"; return "☀️"; }

/* ---------- URL state ---------- */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)); const o = {};
  if (p.get("from")) { const [lat, lon, ...n] = p.get("from").split(","); if (+lat && +lon) o.from = { lat: +lat, lon: +lon, name: n.join(",") || "Shared start", state: p.get("st") || null }; }
  ["car","pax","fp","mil","d"].forEach(k => p.get(k) && (o[k] = p.get(k))); return o;
}
function shareURL(destId) {
  const p = new URLSearchParams();
  if (S.from) { p.set("from", `${S.from.lat.toFixed(4)},${S.from.lon.toFixed(4)},${S.from.name}`); if (S.from.state) p.set("st", S.from.state); }
  if (S.car) p.set("car", S.car.id); p.set("pax", S.pax);
  if (S.priceTouched) p.set("fp", S.price); if (S.milTouched) p.set("mil", S.mileage);
  if (destId) p.set("d", destId);
  return location.origin + location.pathname + "#" + p.toString();
}

/* ---------- planner inputs ---------- */
function setCar(car, keepMileage) {
  S.car = car; $("#car").value = `${car.brand} ${car.model} · ${car.fuel.toUpperCase()}`;
  if (!keepMileage) { S.mileage = car.hwy; S.milTouched = false; }
  $("#mileage").value = S.mileage;
  const u = car.fuel === "cng" ? "km/kg" : car.fuel === "ev" ? "km/kWh" : "km/l";
  $("#milLbl").textContent = `📏 Mileage, highway (${u})`;
  $("#milNote").textContent = `approx real-world: city ${car.city} · hwy ${car.hwy} ${u}`;
  if (!S.priceTouched) setDefaultPrice();
}
function updateMoreSum() { const el = $("#moreSum"); if (!el || !S.car) return;
  const u = S.car.fuel === "cng" ? "km/kg" : S.car.fuel === "ev" ? "km/kWh" : "km/l";
  el.textContent = `${S.pax} log · ${S.mileage} ${u} · ₹${S.price}/${fuelUnit(S.car.fuel) === "litre" ? "L" : fuelUnit(S.car.fuel)}`; }
function setDefaultPrice() {
  const f = S.car ? S.car.fuel : "petrol", st = S.from && S.from.state;
  let v, note;
  if (f === "cng") { v = S.meta.default_cng; note = "approx CNG ₹/kg · edit"; }
  else if (f === "ev") { v = S.meta.default_ev_kwh; note = "approx home charging ₹/kWh · public fast chargers cost more"; }
  else { const known = st && S.fuel[st], row = known ? S.fuel[st] : S.fuel["Delhi"]; v = row[f];
    const live = S.fuelLive && S.fuelLive.fuel[known ? st : "Delhi"];
    note = live ? `${known ? st : "Delhi"} avg ${f} today · updated ${fmtDate(S.fuelLive.updated)} · edit` : `approx ${known ? st : "Delhi"} ${f} price · edit`; }
  S.price = v; $("#price").value = v; $("#priceNote").textContent = note;
  $("#priceLbl").textContent = `⛽ ${f === "ev" ? "Power" : "Fuel"} ₹/${fuelUnit(f)}`; updateMoreSum();
}
function setFrom(f) {
  S.from = f; $("#from").value = f.name;
  if (!S.priceTouched) setDefaultPrice();
}
function combo(input, list, search, pick, wait = 250) {
  let items = [], act = -1, timer;
  const render = () => { list.innerHTML = items.map((it, i) => it.grp ? `<li class="grp" aria-hidden="true">${it.html}</li>` : `<li role="option" data-i="${i}" class="${i === act ? "act" : ""}">${it.html}</li>`).join("");
    list.classList.toggle("open", items.length > 0); };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { items = await search(input.value.trim()); act = -1; render(); }, wait); });
  input.addEventListener("focus", async () => { if (!input.dataset.typed) { items = await search(""); act = -1; render(); } });
  input.addEventListener("keydown", e => {
    const nx = (i, st) => { do i += st; while (items[i] && items[i].grp); return items[i] ? i : act; };
    if (e.key === "ArrowDown") { act = nx(act, 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { act = nx(act, -1); render(); e.preventDefault(); }
    else if (e.key === "Enter" && items.some(x => !x.grp)) { pick(items[act >= 0 ? act : items.findIndex(x => !x.grp)].v); list.classList.remove("open"); e.preventDefault(); }
    else if (e.key === "Escape") list.classList.remove("open");
  });
  list.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li && li.dataset.i != null) { pick(items[+li.dataset.i].v); list.classList.remove("open"); e.preventDefault(); } });
  input.addEventListener("blur", () => setTimeout(() => list.classList.remove("open"), 150));
}
async function placeSearch(q) {
  if (q.length < 2) return [];
  try {
    const d = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&bbox=68,6,97.5,37.2&layer=city&layer=locality&layer=district&layer=county&layer=state`, 8000);
    const seen = new Set();
    return d.features.filter(f => { const p = f.properties, k = p.name + "|" + (p.state || "");
      if (p.countrycode !== "IN" || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 7).map(f => {
      const p = f.properties, sub = [p.district || p.county || p.city, p.state].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x !== p.name).join(", ");
      return { html: `📍 <span>${esc(p.name)}</span><small>${esc(sub)}</small>`,
               v: { name: p.name + (p.state && p.name !== p.state ? ", " + p.state : ""), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], state: normState(p.state || (p.type === "state" ? p.name : null)) } };
    });
  } catch { return []; }
}
const POPULAR = ["maruti-swift-petrol","hyundai-creta-petrol","mahindra-xuv700-diesel","mahindra-scorpio-n-diesel","mahindra-thar-diesel","maruti-brezza-petrol","tata-nexon-petrol","toyota-innova-crysta-diesel","maruti-ertiga-cng","maruti-baleno-petrol","toyota-fortuner-diesel","kia-seltos-petrol"];
function carItem(c) { return { html: `<span><b>${esc(c.model)}</b> <span class="muted">${esc(c.brand)}</span></span><span class="fuel ${c.fuel}">${c.fuel}</span><small>~${c.hwy} ${c.fuel === "cng" ? "km/kg" : c.fuel === "ev" ? "km/kWh" : "km/l"}</small>`, v: c }; }
function carSearch(q) {
  const t = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) { const pop = POPULAR.map(id => S.cars.find(c => c.id === id)).filter(Boolean);
    return [{ html: "⭐ Popular", v: null, grp: 1 }, ...pop.map(carItem), { html: "All cars (A–Z)", v: null, grp: 1 },
      ...[...S.cars].sort((a, b) => (a.brand + a.model).localeCompare(b.brand + b.model)).map(carItem)]; }
  return S.cars.filter(c => t.every(w => `${c.brand} ${c.model} ${c.fuel}`.toLowerCase().includes(w))).slice(0, 40)
    .map(c => ({ html: `<span><b>${esc(c.model)}</b> <span class="muted">${esc(c.brand)}</span></span><span class="fuel ${c.fuel}">${c.fuel}</span><small>~${c.hwy} ${c.fuel === "cng" ? "km/kg" : c.fuel === "ev" ? "km/kWh" : "km/l"}</small>`, v: c }));
}
function useMyLocation() {
  if (!navigator.geolocation) return toast("Location is not available in this browser");
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords; let name = "My location", state = null;
    try { const r = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lon}`, 8000);
      const a = r.address || {}; state = normState(a.state); name = [a.city || a.town || a.village || a.county || a.state_district, a.state].filter(Boolean).join(", ") || name; } catch {}
    setFrom({ lat, lon, name, state }); run();
  }, () => toast("Couldn't get your location — type your city instead"), { timeout: 10000 });
}

/* ---------- data: weather + road distances ---------- */
async function loadWeather() {
  const d = S.dests, u = "https://api.open-meteo.com/v1/forecast?latitude=" + d.map(x => x.lat).join(",") + "&longitude=" + d.map(x => x.lon).join(",") +
    "&elevation=" + d.map(x => x.elevation_m).join(",") + "&daily=snowfall_sum,temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
    "&current=snow_depth,temperature_2m&forecast_days=16&timezone=Asia%2FKolkata";
  try {
    let r = await getJSON(u, 25000); if (!Array.isArray(r)) r = [r];
    r.forEach((w, i) => { const dd = w.daily, snow = dd.snowfall_sum.map(v => v || 0);
      S.wx[d[i].id] = { days: dd.time.map((t, j) => ({ t, snow: snow[j], max: dd.temperature_2m_max[j], min: dd.temperature_2m_min[j], pp: dd.precipitation_probability_max[j], code: dd.weather_code[j] })),
        snow7: snow.slice(0, 7).reduce((a, b) => a + b, 0), snow3: snow.slice(0, 3).reduce((a, b) => a + b, 0), snow16: snow.reduce((a, b) => a + b, 0),
        snowDays7: snow.slice(0, 7).filter(v => v >= 0.5).length, depth: Math.round((w.current?.snow_depth || 0) * 100), now: w.current?.temperature_2m,
        min3: Math.min(...dd.temperature_2m_min.slice(0, 3)) }; });
    S.wxTime = new Date();
  } catch (e) { console.warn("weather", e); S.wxFail = true; }
}
async function loadRoad() {
  S.road = {}; if (!S.from) return;
  const coords = [S.from, ...S.dests].map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  try {
    const r = await getJSON(`${OSRM}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`, 25000);
    S.dests.forEach((d, i) => { const km = r.distances[0][i + 1], s = r.durations[0][i + 1];
      if (km != null) S.road[d.id] = { km: km / 1000, h: s / 3600, real: true }; });
  } catch (e) { console.warn("osrm table", e); }
  S.dests.forEach(d => { if (!S.road[d.id]) { const k = hav(S.from.lat, S.from.lon, d.lat, d.lon) * 1.45; S.road[d.id] = { km: k, h: k / 42, real: false }; } });
}

/* ---------- model ---------- */
function hillMileage() { return S.car.city * 1.05 * (S.mileage / S.car.hwy); } // winding mountain roads ≈ city mileage
function driveHours(h, hillShare) { return h * (1 + Math.min(0.6, hillShare * 1.1)) + Math.floor(h / 4) * 0.5; }
function hillFactor(d) { return d.elevation_m > 2500 ? 0.3 : d.elevation_m > 1800 ? 0.22 : 0.15; }
function quickCost(d) { // before the exact terrain route is computed
  const r = S.road[d.id]; if (!r || !S.car) return null;
  const hf = hillFactor(d), m = S.mileage, hill = hillMileage();
  const units = 2 * r.km * ((1 - hf) / m + hf / (hill * 0.85));
  const toll = round50(2 * r.km * (1 - hf - 0.1) * 1.5);
  return { units, fuel: units * S.price, toll, total: units * S.price + toll };
}
function snowLevel(w) { if (!w) return { cls: "b-none", txt: "Forecast loading", k: 0 };
  if (w.snow7 >= 15) return { cls: "b-heavy", txt: `❄ ${Math.round(w.snow7)} cm snow this week`, k: 2 };
  if (w.snow7 >= 3) return { cls: "b-some", txt: `🌨 ${Math.round(w.snow7)} cm snow likely`, k: 1 };
  if (w.snow7 >= 0.5) return { cls: "b-some", txt: "🌨 Light snow possible", k: 1 };
  if (w.depth >= 5) return { cls: "b-some", txt: `⛄ ~${w.depth} cm on ground`, k: 1 };
  return { cls: "b-none", txt: "No snow forecast", k: 0 }; }
function safety(d) {
  const w = S.wx[d.id]; let score = d.risk; const why = [];
  why.push(["Road access", ["", "usually open, busy hill road", "narrow / closes after heavy snow", "remote, high or permit area"][d.risk]]);
  if (w) {
    if (w.snow3 >= 25) { score += 2; why.push(["Fresh snow (3 days)", `${Math.round(w.snow3)} cm — roads may close`]); }
    else if (w.snow3 >= 8) { score += 1; why.push(["Fresh snow (3 days)", `${Math.round(w.snow3)} cm — chains likely`]); }
    else why.push(["Fresh snow (3 days)", w.snow3 >= 0.5 ? `${w.snow3.toFixed(1)} cm` : "none forecast"]);
    if (w.min3 <= -10) { score += 1; why.push(["Coldest night", `${Math.round(w.min3)}°C — black ice likely`]); }
    else why.push(["Coldest night", `${Math.round(w.min3)}°C${w.min3 < 0 ? " — icy mornings" : ""}`]);
  }
  const lvl = score <= 1 ? 1 : score <= 3 ? 2 : 3;
  return { lvl, label: ["", "Low risk", "Take care", "High risk"][lvl], why };
}
function score(d) { const w = S.wx[d.id] || { snow7: 0, depth: 0, snowDays7: 0 }, r = S.road[d.id];
  const snow = Math.min(100, w.snow7 * 4 + Math.min(w.depth, 60) * 0.5 + w.snowDays7 * 4);
  return snow - (r ? r.km / 25 : 0) - d.risk * 4; }

/* ---------- render list ---------- */
function visible() {
  let L = S.dests.filter(d => (S.filter === "all" || d.state === S.filter) && (!S.offbeat || d.offbeat));
  const key = { best: d => -score(d), snow: d => -((S.wx[d.id]?.snow7 || 0) + (S.wx[d.id]?.depth || 0) / 100),
    near: d => S.road[d.id]?.km ?? 1e9, cheap: d => quickCost(d)?.total ?? 1e9 }[S.sort];
  return L.sort((a, b) => key(a) - key(b));
}
function photoHTML(d, cls = "") { const p = d.photos[0];
  return p ? `<img loading="lazy" src="${esc(p.src)}" alt="${esc(d.name)}" referrerpolicy="no-referrer" onerror="this.remove()">
    <a class="credit" href="${esc(p.page)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📷 ${esc(p.author)} · ${esc(p.license)}</a>` : `<div class="noimg">🏔️</div>`; }
function renderCards() {
  const L = visible(), el = $("#cards");
  if (!L.length) { el.innerHTML = `<p class="muted">No places match these filters.</p>`; return; }
  el.innerHTML = L.map((d, i) => {
    const w = S.wx[d.id], s = snowLevel(w), r = S.road[d.id], c = quickCost(d), sf = safety(d);
    const bars = w ? w.days.slice(0, 7).map(x => `<i class="${x.snow >= 0.5 ? "s" : ""}" style="height:${Math.min(26, 3 + x.snow * 1.6)}px" title="${x.t}: ${x.snow.toFixed(1)} cm"></i>`).join("") : "";
    return `<article class="card" data-id="${d.id}" tabindex="0">
      <div class="ph">${photoHTML(d)}<span class="badge ${s.cls}">${s.txt}</span>${d.offbeat ? '<span class="tagoff">Offbeat</span>' : ""}<span class="rank">${i + 1}</span>
        <div class="t"><h3>${esc(d.name)}</h3><p>${esc(d.area)}, ${esc(STATE_SHORT[d.state] || d.state)} · ${d.elevation_m.toLocaleString("en-IN")} m</p></div></div>
      <div class="facts"><div><b>${w ? (w.snow7 >= 0.5 ? Math.round(w.snow7) + " cm" : "0 cm") : "—"}</b><span>snow · 7 days</span></div>
        <div><b>${r ? Math.round(r.km) + " km" : "—"}</b><span>${r && !r.real ? "approx " : ""}~${r ? Math.round(driveHours(r.h, hillFactor(d) + 0.1)) : "?"} h drive</span></div>
        <div><b>${c ? inr(c.total / S.pax) : "—"}</b><span>per person</span></div></div>
      <div class="cardfoot"><span class="safe-badge l${sf.lvl}">${["", "✅", "⚠️", "⛔"][sf.lvl]} ${sf.label}</span>
        <span class="mini" aria-label="7 day snow">${bars}</span><span class="open">Details →</span></div>
    </article>`; }).join("");
}
function renderStats() {
  const ws = S.dests.map(d => S.wx[d.id]).filter(Boolean);
  const heavy = ws.filter(w => w.snow7 >= 15).length, some = ws.filter(w => w.snow7 >= 0.5).length;
  const top = [...S.dests].sort((a, b) => (S.wx[b.id]?.snow7 || 0) - (S.wx[a.id]?.snow7 || 0))[0];
  const near = S.from ? [...S.dests].filter(d => (S.wx[d.id]?.snow7 || 0) >= 0.5).sort((a, b) => (S.road[a.id]?.km || 1e9) - (S.road[b.id]?.km || 1e9))[0] : null;
  $("#statbar").innerHTML = S.wxFail ? `<div class="stat"><b>⚠️</b><span>Snow forecast didn't load — refresh in a minute.</span></div>` : `
    <div class="stat"><b>${some}/${S.dests.length}</b><span>places with snow this week${heavy ? ` · ${heavy} heavy` : ""}</span></div>
    <div class="stat"><b>${near ? esc(near.name) : "—"}</b><span>${near ? "nearest snow · " + Math.round(S.road[near.id].km) + " km" : "set a start point for distances"}</span></div>`;
}
function renderLive() {
  const el = $("#liveline"); if (!el) return;
  const wx = S.wxFail ? `⚠️ Snow forecast didn't load` : S.wxTime ? `🟢 Live snow & weather · updated ${fmtTime(S.wxTime)}` : "Loading live forecast…";
  const fu = S.fuelLive ? `⛽ Fuel prices updated ${fmtDate(S.fuelLive.updated)} (<a href="${esc(S.fuelLive.source_url)}" target="_blank" rel="noopener">GoodReturns</a>)` : "⛽ Fuel prices approx";
  el.innerHTML = `<span>${wx}</span><span>${fu}</span><span>🛣️ Routes live from OSRM</span><button class="linkbtn" id="refreshNow">↻ Refresh</button>`;
  $("#refreshNow").onclick = () => refreshWeather(true);
}
async function refreshWeather(manual) {
  if (manual) toast("Refreshing live forecast…");
  S.wxFail = false; S.wxPromise = loadWeather(); await S.wxPromise;
  renderLive(); renderStats(); renderCards(); renderOverview();
}
function renderChips() {
  const st = ["all", ...new Set(S.dests.map(d => d.state))];
  $("#stateChips").innerHTML = st.map(s => `<button class="chip ${S.filter === s ? "on" : ""}" data-s="${esc(s)}">${s === "all" ? "All" : esc(STATE_SHORT[s] || s)}</button>`).join("");
}
let ovMap, ovLayer;
function renderOverview() {
  if (!window.L) return;
  if (!ovMap) { ovMap = L.map("overview", { scrollWheelZoom: false, attributionControl: false }).setView([31, 78], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(ovMap);
    ovLayer = L.layerGroup().addTo(ovMap); L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(ovMap); }
  ovLayer.clearLayers(); const pts = [];
  S.dests.forEach(d => { const w = S.wx[d.id], s7 = w ? w.snow7 : 0, col = s7 >= 15 ? "#0ea5e9" : s7 >= 3 ? "#8b5cf6" : "#64748b";
    pts.push([d.lat, d.lon]);
    L.circleMarker([d.lat, d.lon], { radius: 7 + Math.min(10, s7 / 3), color: "#fff", weight: 2, fillColor: col, fillOpacity: .9 })
      .bindPopup(`<b>${esc(d.name)}</b><br>${w ? Math.round(s7) + " cm snow in 7 days" : ""}<br><button data-open="${d.id}">Plan this trip</button>`).addTo(ovLayer); });
  if (S.from) { L.marker([S.from.lat, S.from.lon]).bindPopup("Start: " + esc(S.from.name)).addTo(ovLayer); pts.push([S.from.lat, S.from.lon]); }
  ovMap.fitBounds(pts, { padding: [30, 30] });
}

/* ---------- detail ---------- */
function sampleRoute(coords, n) { // coords [[lon,lat]...] -> n points equally spaced + total km
  const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i-1] + hav(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]));
  const tot = cum[cum.length - 1], out = []; let j = 0;
  for (let k = 0; k < n; k++) { const t = tot * k / (n - 1); while (j < cum.length - 2 && cum[j+1] < t) j++;
    const seg = cum[j+1] - cum[j] || 1, f = Math.min(1, Math.max(0, (t - cum[j]) / seg));
    out.push([coords[j][1] + (coords[j+1][1] - coords[j][1]) * f, coords[j][0] + (coords[j+1][0] - coords[j][0]) * f]); }
  return { pts: out, tot };
}
async function routeFor(d) {
  const key = `${S.from.lat.toFixed(3)},${S.from.lon.toFixed(3)}>${d.id}`; if (S.routeCache[key]) return S.routeCache[key];
  const r = await getJSON(`${OSRM}/route/v1/driving/${S.from.lon},${S.from.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`, 25000);
  if (r.code !== "Ok") throw new Error(r.code);
  const g = r.routes[0], coords = g.geometry.coordinates, smp = sampleRoute(coords, 100);
  let elev = null;
  try { const e = await getJSON("https://api.open-meteo.com/v1/elevation?latitude=" + smp.pts.map(p => p[0].toFixed(4)).join(",") + "&longitude=" + smp.pts.map(p => p[1].toFixed(4)).join(","), 15000); elev = e.elevation; } catch {}
  return S.routeCache[key] = { key, km: g.distance / 1000, h: g.duration / 3600, coords, elev, segKm: (g.distance / 1000) / 99 };
}
function terrainFuel(rt, d) {
  const hwy = S.mileage, hill = hillMileage();
  let up = 0, down = 0, flat = 0, plainKm = 0, hillKm = 0, ascent = 0, maxEl = 0;
  if (!rt.elev) { const hf = hillFactor(d); const one = rt.km * ((1 - hf) / hwy + hf / (hill * 0.85));
    return { oneWay: one, back: one * 0.92, flat: rt.km / hwy * 2, plainKm: rt.km * (1 - hf - 0.1), hillKm: rt.km * hf, ascent: null, maxEl: d.elevation_m }; }
  const E = rt.elev, s = rt.segKm;
  for (let i = 1; i < E.length; i++) {
    const dz = E[i] - E[i-1], g = dz / (s * 1000), avg = (E[i] + E[i-1]) / 2, base = avg > 900 ? hill : hwy;
    if (avg < 700) plainKm += s; else hillKm += s; if (dz > 0) ascent += dz; maxEl = Math.max(maxEl, E[i]);
    const fu = g > 0 ? 1 / (1 + 9 * g) : Math.min(1.15, 1 - 3 * g), fd = -g > 0 ? 1 / (1 + 9 * -g) : Math.min(1.15, 1 + 3 * g);
    up += s / (base * fu); down += s / (base * fd); flat += 2 * s / hwy;
  }
  return { oneWay: up, back: down, flat, plainKm, hillKm, ascent, maxEl };
}
/* ---------- real toll plazas on the route (data/tolls.json, NHAI) ---------- */
function loadTolls() { return S.tollsP || (S.tollsP = getJSON("data/tolls.json", 20000).then(j => {
  const F = j.fields; S.tollMeta = j; const rows = j.rows.map(r => Object.fromEntries(F.map((f, i) => [f, r[i]])));
  const fs = rows.filter(r => r.src === "nhai" && r.single).map(r => r.single).sort((a, b) => a - b); S.tollMedian = fs.length ? fs[fs.length >> 1] : 100; return rows; }).catch(e => { console.warn("tolls", e); S.tollsP = null; return null; })); }
function loadExplore() { return S.exploreP || (S.exploreP = getJSON("data/explore.json", 20000).then(j => (S.exploreMeta = j, j.spots)).catch(e => { console.warn("explore", e); S.exploreP = null; return null; })); }
function matchTolls(coords, plazas, maxKm = 0.3) { // plazas within maxKm of the route polyline, in driving order
  let a = 90, b = 180, c = -90, e = -180; coords.forEach(([x, y]) => { if (y < a) a = y; if (y > c) c = y; if (x < b) b = x; if (x > e) e = x; });
  const pad = 0.01, near = plazas.filter(p => p.lat > a - pad && p.lat < c + pad && p.lon > b - pad && p.lon < e + pad);
  if (!near.length) return [];
  const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i-1] + hav(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]));
  const out = [];
  near.forEach(p => { const kx = Math.cos(p.lat * Math.PI / 180) * 111.32, ky = 110.57; let best = 1e9, at = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const ax = (coords[i][0] - p.lon) * kx, ay = (coords[i][1] - p.lat) * ky, bx = (coords[i+1][0] - p.lon) * kx, by = (coords[i+1][1] - p.lat) * ky;
      if (Math.min(Math.abs(ax), Math.abs(bx)) > 5 && ax * bx > 0) continue; if (Math.min(Math.abs(ay), Math.abs(by)) > 5 && ay * by > 0) continue;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const dd = Math.hypot(ax + t * dx, ay + t * dy); if (dd < best) { best = dd; at = cum[i] + t * (cum[i+1] - cum[i]); } }
    if (best <= maxKm) out.push({ ...p, off: best, at }); });
  out.sort((x, y) => x.at - y.at);
  return out.filter((p, i) => !out.slice(0, i).some(q => Math.abs(q.at - p.at) < 0.3 && q.name === p.name));
}
function tollTotals(list) {
  const known = list.filter(p => p.single), unknown = list.filter(p => !p.single);
  const one = known.reduce((t, p) => t + p.single, 0);
  const ret24 = known.reduce((t, p) => t + Math.min(p.ret || 2 * p.single, 2 * p.single), 0);
  const approx = unknown.length * (S.tollMedian || 100); // fallback for plazas with no published fare, always labelled approx
  return { one, round: 2 * one, ret24, known, unknown, approx, oneAll: one + approx, roundAll: 2 * (one + approx) };
}
function tollRowsHTML(list) {
  if (!list.length) return `<p class="muted">No toll plazas found on this route in the NHAI data.</p>`;
  return `<ol class="tolllist">${list.map(p => `<li><span><b>${esc(p.name)}</b><small>${p.hw ? "NH " + esc(String(p.hw).replace(/^NH[\s-]*/i, "")) + " · " : ""}${Math.round(p.at)} km from start${p.src === "state" ? " · state highway data" : ""}</small></span>
    <span class="fare">${p.single ? `${inr(p.single)}<small>${p.ret ? `return ${inr(p.ret)}` : "one way"}</small>` : `<em>${p.closed ? "by distance" : "fare unknown"}</em><small>${p.closed ? "closed-loop, paid at exit" : "not published"}</small>`}</span></li>`).join("")}</ol>`;
}
const SPOT_IC = { viewpoint: "🔭", waterfall: "💧", lake: "🏞️", glacier: "🧊", peak: "⛰️", village: "🏘️", temple: "🛕", monastery: "☸️", walk: "🥾", meadow: "🌾", pass: "🛣️", hot_spring: "♨️", fort: "🏰", park: "🌲", attraction: "📍", river: "🌊", cave: "🕳️" };
function exploreHTML(d, spots) {
  if (!spots || !spots.length) return `<p class="muted">No verified spots listed yet.</p>`;
  return `<div class="spots">${spots.map((p, i) => `<article class="spot">
    <div class="sph">${p.photo ? `<img loading="lazy" src="${esc(p.photo.src)}" alt="${esc(p.name)}" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noph');this.remove()">
      <a class="credit" href="${esc(p.photo.page)}" target="_blank" rel="noopener">📷 ${esc(p.photo.author)} · ${esc(p.photo.license)}</a>` : ""}<span class="spn">${i + 1}</span><span class="spt">${SPOT_IC[p.type] || "📍"} ${esc(p.type.replace("_", " "))}</span></div>
    <div class="spb"><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p>
      <div class="spf"><span>${p.km < 1 ? "in " + esc(d.name.split(" /")[0]) : `${p.km.toFixed(p.km < 10 ? 1 : 0)} km away`}${p.ele ? ` · ${p.ele.toLocaleString("en-IN")} m` : ""}</span>
      <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Google Maps ↗</a>${p.wiki ? `<a href="${esc(p.wiki)}" target="_blank" rel="noopener">Wiki</a>` : ""}</div></div></article>`).join("")}</div>
    <p class="muted">Spots from OpenStreetMap${S.exploreMeta ? " & Wikipedia/Wikidata" : ""}; photos from Wikimedia Commons (credited). Straight-line distance from ${esc(d.name)} — roads to some spots close in heavy snow.</p>`;
}
function spotMarkers(map, spots, layer) {
  (spots || []).forEach((p, i) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "pin-spot", html: `<span>${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
    .bindPopup(`<b>${SPOT_IC[p.type] || "📍"} ${esc(p.name)}</b><br>${esc(p.desc)}<br><a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Open in Google Maps</a>`).addTo(layer || map));
}
/* ---------- fuel stations along the route (OSM tiles in data/stations, live Overpass top-up for CNG/EV) ---------- */
function thinCoords(coords, maxPts = 2500) { if (coords.length <= maxPts) return coords; const k = Math.ceil(coords.length / maxPts), o = [];
  for (let i = 0; i < coords.length; i += k) o.push(coords[i]); o.push(coords[coords.length - 1]); return o; }
function stationKind(car) { return car.fuel === "cng" ? "c" : car.fuel === "ev" ? "e" : "p"; }
const ST_LABEL = { p: ["⛽", "Pumps", "fuel pump"], c: ["🟢", "CNG", "CNG station"], e: ["🔌", "Chargers", "EV charger"] };
async function stationsFor(rt, kind) {
  const key = (rt.key || "") + kind; S.stCache = S.stCache || {}; if (S.stCache[key]) return S.stCache[key];
  if (!S.stIdx) S.stIdx = getJSON("data/stations/index.json", 15000).catch(() => null);
  const idx = await S.stIdx; const thin = thinCoords(rt.coords), need = new Set();
  thin.forEach(([x, y]) => { for (const dy of [-0.02, 0.02]) for (const dx of [-0.02, 0.02]) need.add(`${Math.floor(y + dy)}_${Math.floor(x + dx)}`); });
  const tiles = [...need].filter(k => !idx || idx.tiles[k]);
  const rows = (await Promise.all(tiles.map(k => getJSON(`data/stations/${k}.json`, 15000).catch(() => [])))).flat();
  let pts = rows.filter(r => r[4].includes(kind)).map(r => ({ lat: r[0], lon: r[1], name: r[2], brand: r[3], flags: r[4] }));
  let live = false;
  if (kind !== "p") { // CNG & chargers are thinly mapped: try a live Overpass top-up along the route, silently fall back to the tiles
    try { const smp = sampleRoute(rt.coords, Math.min(80, Math.max(10, Math.round(rt.km / 8)))).pts.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(",");
      const q = kind === "c" ? `node["amenity"="fuel"]["fuel:cng"="yes"](around:2000,${smp});node["amenity"="fuel"]["name"~"CNG|IGL|MGL",i](around:2000,${smp});` : `nwr["amenity"="charging_station"](around:2000,${smp});`;
      const j = await getJSON("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(`[out:json][timeout:12];(${q});out center 400;`), 14000);
      (j.elements || []).forEach(e => { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) return;
        if (!pts.some(p => Math.abs(p.lat - la) < 0.0008 && Math.abs(p.lon - lo) < 0.0008)) pts.push({ lat: la, lon: lo, name: e.tags?.name || "", brand: e.tags?.brand || e.tags?.operator || "", flags: kind }); });
      live = true; } catch (e) { /* Overpass busy: tiles only */ }
  }
  const m = matchTolls(thin, pts, 1.5);
  return S.stCache[key] = { list: m, live };
}
function stationGaps(list, km, kind) {
  const lim = kind === "p" ? 100 : 80, out = []; let prev = { at: 0, name: "the start" };
  [...list, { at: km, end: true }].forEach(p => { if (p.at - prev.at > lim) out.push({ from: prev, to: p, gap: p.at - prev.at }); if (!p.end) prev = p; });
  return out;
}
let stLayer = null;
function drawStations(map, list, kind) {
  if (stLayer) { map.removeLayer(stLayer); map.off("zoomend", stLayer._redraw); }
  stLayer = L.layerGroup(); const [ic, , what] = ST_LABEL[kind];
  const pop = p => `<b>${ic} ${esc(p.name || p.brand || what)}</b>${p.brand && p.name && !p.name.includes(p.brand) ? `<br>${esc(p.brand)}` : ""}<br>${Math.round(p.at)} km from start${p.flags.includes("c") && kind === "p" ? " · CNG too" : ""}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">Directions ↗</a>`;
  const lay = stLayer;
  lay._redraw = () => { lay.clearLayers(); const z = map.getZoom(), cells = {};
    list.forEach(p => { const pt = map.project([p.lat, p.lon], z), k = Math.floor(pt.x / 46) + ":" + Math.floor(pt.y / 46); (cells[k] = cells[k] || []).push(p); });
    Object.values(cells).forEach(g => { if (g.length === 1 || z >= 14) g.forEach(p => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "pin-fuel k" + kind, html: ic, iconSize: [20, 20], iconAnchor: [10, 10] }) }).bindPopup(pop(p)).addTo(lay));
      else { const la = g.reduce((t, p) => t + p.lat, 0) / g.length, lo = g.reduce((t, p) => t + p.lon, 0) / g.length;
        L.marker([la, lo], { icon: L.divIcon({ className: "pin-fuel cl k" + kind, html: `${ic}<b>${g.length}</b>`, iconSize: [38, 22], iconAnchor: [19, 11] }) })
          .on("click", () => map.fitBounds(L.latLngBounds(g.map(p => [p.lat, p.lon])), { padding: [30, 30], maxZoom: 15 })).addTo(lay); } }); };
  map.on("zoomend", lay._redraw); lay._redraw(); lay.addTo(map); return lay;
}
function fuelBoxHTML(st, rt, d, kind) {
  const [ic, lbl, what] = ST_LABEL[kind], list = st.list, gaps = stationGaps(list, rt.km, kind), last = list[list.length - 1];
  const nm = p => p.name || p.brand ? esc(p.name || p.brand) : `an unnamed ${what}`;
  let warn = "";
  if (kind !== "p") warn = gaps.map(g => `<div class="warnbox">⚠️ No ${kind === "c" ? "CNG" : "charger"} mapped for the next <b>${Math.round(g.gap)} km</b> ${g.from.at === 0 ? "from the start" : `after <b>${nm(g.from)}</b> (km ${Math.round(g.from.at)})`}${g.to.end ? `, all the way to ${esc(d.name.split(" /")[0])}` : ""}. ${g.from.at > 0 ? `Fill up at ${nm(g.from)}.` : "Start with a full tank."}${kind === "c" ? " Keep petrol as backup." : ""}</div>`).join("");
  const lastTxt = last ? `Last ${what} before ${esc(d.name.split(" /")[0])}: <b>${nm(last)}</b>, ${Math.round(rt.km - last.at)} km before you arrive.` : `No ${what} mapped on this route.`;
  return `<div class="fuelbar"><button class="chip on" id="stToggle" aria-pressed="true">${ic} ${lbl} on route (${list.length})</button><span class="muted">${lastTxt}</span></div>${warn}
    <p class="muted">${what[0].toUpperCase() + what.slice(1)}s within 1.5 km of the route, from OpenStreetMap${st.live ? " + a live Overpass check" : ""}. Tap a pin for directions.${kind !== "p" ? " OSM misses some stations, so also check the IGL/MGL or charger apps." : ""}</p>`;
}
let rMap;
function fitRouteMap(m) { // re-measure the container (it may have been hidden/animating) and fit the route
  if (!m || m !== rMap) return; const el = m.getContainer(); if (!el.offsetWidth || !el.offsetHeight) return;
  m.invalidateSize({ animate: false });
  if (m._fit) m.fitBounds(m._fit, { paddingTopLeft: [24, 48], paddingBottomRight: [24, 24], animate: false });
}
async function openDetail(id, push = true) {
  const d = S.dests.find(x => x.id === id); if (!d) return;
  if (push) history.replaceState(null, "", shareURL(id));
  Stats.trip();
  const w = S.wx[d.id], s = snowLevel(w), sf = safety(d);
  $("#sheet").hidden = false; document.body.style.overflow = "hidden";
  const gal = d.photos.length ? d.photos.map(p => `<figure><img src="${esc(p.src)}" alt="${esc(d.name)}" referrerpolicy="no-referrer"><figcaption><a href="${esc(p.page)}" target="_blank" rel="noopener">📷 ${esc(p.author)} · ${esc(p.license)} · Wikimedia Commons</a></figcaption></figure>`).join("")
    : `<figure><div class="noimg" style="display:grid;place-items:center;height:100%;font-size:80px">🏔️</div></figure>`;
  const fc = w ? w.days.map(x => { const dt = new Date(x.t + "T00:00");
    return `<div class="day ${x.snow >= 0.5 ? "snow" : ""}"><div>${dt.toLocaleDateString("en-IN", { weekday: "short" })}</div><div class="tt">${dt.getDate()}/${dt.getMonth() + 1}</div>
      <div class="w">${wIcon(x.code, x.snow)}</div><b>${x.snow >= 0.1 ? x.snow.toFixed(1) + " cm" : "–"}</b><div class="tt">${Math.round(x.max)}° / ${Math.round(x.min)}°</div></div>`; }).join("")
    : `<p class="muted">Forecast unavailable right now.</p>`;
  const q = encodeURIComponent(`${d.name} ${d.state}`);
  $("#detail").innerHTML = `
    <div class="gallery">${gal}</div>
    <div class="dhead"><h2 id="dName">${esc(d.name)}</h2>
      <div class="pills"><span class="pill">📍 ${esc(d.area)}, ${esc(d.state)}</span><span class="pill">⛰️ ${d.elevation_m.toLocaleString("en-IN")} m</span>
      <span class="pill">${s.txt}</span><span class="pill safe-badge l${sf.lvl}">${["", "✅", "⚠️", "⛔"][sf.lvl]} ${sf.label}</span>${d.offbeat ? '<span class="pill">🌿 Offbeat</span>' : ""}</div></div>
    <nav class="dnav" aria-label="Sections"><a href="#s-map">🗺️ Map</a><a href="#s-cost">💸 Cost</a><a href="#s-tolls">🧾 Tolls</a><a href="#s-explore">📸 Explore</a><a href="#s-weather">🌨️ Weather</a><a href="#s-safety">🛡️ Safety</a><a href="#s-share">📤 Share</a></nav>
    <div class="dsec" id="s-map"><h3>🗺️ Map ${S.from ? `<span class="muted">${esc(S.from.name)} → ${esc(d.name)}</span>` : ""}</h3>
      <div id="routeMap"></div>
      <div class="maplegend"><span><i style="background:#22c55e;border-radius:50%"></i>Start</span><span><i style="background:#38bdf8"></i>Route</span><span><i style="background:#f59e0b;border-radius:3px"></i>Toll plaza</span><span><i style="background:#ec4899;border-radius:50%"></i>Explore spot</span><span><i style="background:#16a34a;border-radius:50%"></i>${ST_LABEL[stationKind(S.car)][1]}</span></div>
      <div id="fuelBox"></div></div>
    <div class="dsec" id="s-cost"><h3>💸 Cost</h3><div id="routeBox">${S.from ? '<div class="skeleton" style="height:160px"></div>' : '<p class="muted">Set a starting point above to see the route and cost.</p>'}</div></div>
    <div class="dsec" id="s-tolls"><h3>🧾 Tolls on the way</h3><div id="tollBox">${S.from ? '<div class="skeleton" style="height:90px"></div>' : '<p class="muted">Set a starting point to see toll plazas.</p>'}</div></div>
    <div class="dsec" id="s-explore"><h3>📸 Explore & photo spots</h3><div id="exploreBox"><div class="skeleton" style="height:120px"></div></div></div>
    <div class="dsec" id="s-weather"><h3>🌨️ Weather · 16 days</h3><div class="fc">${fc}</div>
      <p class="muted">Open-Meteo model forecast at ${d.elevation_m} m${S.wxTime ? `, fetched ${S.wxTime.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} IST` : ""}. Beyond ~5 days it is less reliable.</p></div>
    <div class="dsec" id="s-safety"><h3>🛡️ Road safety</h3><div class="safety"><div class="meter l${sf.lvl}">${sf.label}</div>
      <div><p>${esc(d.safety)}</p><ul>${sf.why.map(([a, b]) => `<li><b>${esc(a)}:</b> ${esc(b)}</li>`).join("")}</ul>
      <p class="muted" style="margin-top:6px">A guide from forecast + road type, not live road status. Check with local police or your stay before driving.</p></div></div></div>
    <div class="dsec"><h3>🏡 Stays nearby</h3><div class="stays"><p>Search directly (BarfChalo does not get paid for these links):</p>
      <div class="btns"><a class="btn" target="_blank" rel="noopener" href="https://www.booking.com/searchresults.html?ss=${q}">Booking.com</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.airbnb.co.in/s/${encodeURIComponent(d.name + ", " + d.state)}/homes">Airbnb</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/homestay+near+${q}">Google Maps</a></div></div></div>
    <div class="dsec" id="s-share" style="padding-bottom:28px"><h3>📤 Share this trip</h3><div class="btns" id="shareBtns"></div></div>`;
  $("#sheet .sheet-card").scrollTop = 0;
  $("#detail .dnav").onclick = e => { const a = e.target.closest("a"); if (!a) return; e.preventDefault(); const t = $(a.getAttribute("href")); t && t.scrollIntoView({ behavior: "smooth", block: "start" }); };
  rMap && rMap.remove(); rMap = null;
  if (window.L) { rMap = L.map("routeMap", { scrollWheelZoom: false, attributionControl: false, zoomSnap: 0.25 }).setView([d.lat, d.lon], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · Route: OSRM' }).addTo(rMap);
    L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(rMap); L.marker([d.lat, d.lon]).addTo(rMap).bindPopup(esc(d.name));
    rMap._fit = null; const m = rMap;
    // The sheet has just been un-hidden and is animating: re-measure once it is laid out, then fit again.
    requestAnimationFrame(() => requestAnimationFrame(() => fitRouteMap(m)));
    [150, 400, 900].forEach(t => setTimeout(() => fitRouteMap(m), t));
    $("#sheet .sheet-card").addEventListener("animationend", () => fitRouteMap(m), { once: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => fitRouteMap(m)); ro.observe($("#routeMap")); m.on("unload", () => ro.disconnect()); } }
  renderShare(d, null);
  // Explore spots load independently of routing
  loadExplore().then(all => { if ($("#dName")?.textContent !== d.name) return; const sp = all ? all[d.id] || [] : null;
    $("#exploreBox").innerHTML = all ? exploreHTML(d, sp) : `<p class="muted">Couldn't load spots right now.</p>`;
    if (rMap && sp && sp.length) { spotMarkers(rMap, sp); rMap._spots = sp;
      rMap._fit = rMap._fit ? L.latLngBounds(rMap._fit.getSouthWest(), rMap._fit.getNorthEast()).extend(L.latLngBounds(sp.map(p => [p.lat, p.lon]))) : (!S.from ? L.latLngBounds([[d.lat, d.lon], ...sp.map(p => [p.lat, p.lon])]) : null);
      fitRouteMap(rMap); } });
  if (!S.from) return;
  try {
    const [rt, plazas] = await Promise.all([routeFor(d), loadTolls()]); if ($("#dName")?.textContent !== d.name) return;
    const tf = terrainFuel(rt, d), units = tf.oneWay + tf.back, fuel = units * S.price;
    let toll, tollNote, tl = null, tt = null;
    if (plazas) { tl = matchTolls(rt.coords, plazas); tt = tollTotals(tl); toll = tt.roundAll;
      tollNote = `${tt.known.length} plaza${tt.known.length === 1 ? "" : "s"} × 2${tt.unknown.length ? ` · ${tt.unknown.length} unknown fare${tt.unknown.length === 1 ? "" : "s"} ≈ approx` : ""}`; }
    else { toll = round50(tf.plainKm * 1.5) * 2; tollNote = "approx ±30%, toll data didn't load"; }
    const total = fuel + toll, per = total / S.pax;
    const hrs = driveHours(rt.h, tf.hillKm / rt.km);
    const terr = tf.flat ? Math.round((units / tf.flat - 1) * 100) : 0, u = fuelUnit(S.car.fuel);
    const warn = S.car.fuel === "cng" ? "CNG pumps are rare in the hills — expect to run on petrol for part of the trip." :
                 S.car.fuel === "ev" ? "Fast chargers are few in the mountains. Plan charging stops before you go." : "";
    $("#routeBox").innerHTML = `<div class="tiles">
      <div class="tile big"><div class="ic">👥</div><b>${inr(per)}</b><span>per person (${S.pax} log) · fuel + tolls, round trip</span></div>
      <div class="tile"><div class="ic">🛣️</div><b>${Math.round(rt.km)} km</b><span>one way by road</span></div>
      <div class="tile"><div class="ic">⏱️</div><b>${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m</b><span>realistic drive (map says ${rt.h.toFixed(1)} h)</span></div>
      <div class="tile"><div class="ic">⛽</div><b>${units.toFixed(0)} ${u === "litre" ? "L" : u}</b><span>round trip · ${terr >= 0 ? "+" : ""}${terr}% for hills</span></div>
      <div class="tile"><div class="ic">⛰️</div><b>${tf.ascent != null ? Math.round(tf.ascent).toLocaleString("en-IN") + " m" : "—"}</b><span>total climb, highest ${Math.round(tf.maxEl).toLocaleString("en-IN")} m</span></div></div>
      <table class="costs" style="margin-top:12px">
        <tr><td>⛽ Fuel there (${tf.oneWay.toFixed(1)} ${u}) + back (${tf.back.toFixed(1)} ${u}) × ₹${S.price}</td><td>${inr(fuel)}</td></tr>
        <tr><td>🧾 Tolls, round trip <span class="muted">(${tollNote})</span></td><td>${inr(toll)}</td></tr>
        <tr class="total"><td>Total for the car</td><td>${inr(total)}</td></tr></table>
      <p class="muted">${esc(S.car.brand + " " + S.car.model)} (${S.car.fuel}) at ~${S.mileage} km/${u === "litre" ? "l" : u} highway, worse on climbs. Stays and food not included.</p>
      ${warn ? `<div class="warnbox">⚠️ ${warn}</div>` : ""}`;
    $("#tollBox").innerHTML = tt ? `<div class="tollsum"><div><b>${tt.approx ? "≈ " : ""}${inr(tt.oneAll)}</b><span>one way${tt.approx ? " (approx)" : ""}</span></div><div><b>${tt.approx ? "≈ " : ""}${inr(tt.roundAll)}</b><span>round trip (2 × one way)</span></div><div><b>${tt.approx ? "≈ " : ""}${inr(tt.ret24 + 2 * tt.approx)}</b><span>if back within 24 h (return pass)</span></div></div>
      ${tt.unknown.length ? `<div class="warnbox">Known NHAI fares: ${inr(tt.one)} one way. ${tt.unknown.length} plaza${tt.unknown.length === 1 ? " has" : "s have"} no published fare, so we add ≈ ${inr(S.tollMedian || 100)} each (typical NHAI car fare) — <b>approx</b>.</div>` : ""}
      ${tollRowsHTML(tl)}
      <p class="muted">Car/Jeep/Van FASTag fares from NHAI toll plaza data${S.tollMeta ? ` (open dataset, fetched ${esc(S.tollMeta.generated)})` : ""}, matched within 300 m of this route. A return pass is valid only for 24 h, so a multi-day trip pays one way twice. Cash/no-FASTag pays double. Some state entry taxes and city barriers aren't listed.</p>`
      : `<div class="warnbox">Toll data didn't load — using a rough estimate of ${inr(toll)} round trip (approx).</div>`;
    if (rMap) { const line = L.polyline(rt.coords.map(c => [c[1], c[0]]), { color: "#38bdf8", weight: 5, opacity: .9 }).addTo(rMap);
      L.circleMarker([S.from.lat, S.from.lon], { radius: 8, color: "#fff", fillColor: "#22c55e", fillOpacity: 1 }).addTo(rMap).bindPopup("Start: " + esc(S.from.name));
      (tl || []).forEach(p => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "pin-toll", html: "₹", iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 500 }).addTo(rMap)
        .bindPopup(`<b>🧾 ${esc(p.name)}</b><br>${p.single ? `Car: ${inr(p.single)} one way${p.ret ? ` · ${inr(p.ret)} return (24 h)` : ""}` : p.closed ? "Closed-loop expressway: charged by distance at exit" : "Fare not published"}${p.hw ? `<br>NH ${esc(p.hw)}` : ""}`));
      rMap._fit = line.getBounds(); if (rMap._spots) rMap._fit.extend(L.latLngBounds(rMap._spots.map(p => [p.lat, p.lon]))); fitRouteMap(rMap); const m = rMap; [200, 600].forEach(t => setTimeout(() => fitRouteMap(m), t)); }
    renderShare(d, { km: rt.km, hrs, total, per });
    const kind = stationKind(S.car);
    stationsFor(rt, kind).then(st => { if ($("#dName")?.textContent !== d.name || !$("#fuelBox")) return;
      $("#fuelBox").innerHTML = fuelBoxHTML(st, rt, d, kind);
      const lay = rMap ? drawStations(rMap, st.list, kind) : null;
      $("#stToggle").onclick = e => { const on = e.currentTarget.classList.toggle("on"); e.currentTarget.setAttribute("aria-pressed", on); if (lay && rMap) on ? lay.addTo(rMap) : rMap.removeLayer(lay); };
    }).catch(e => { console.warn("stations", e); $("#fuelBox") && ($("#fuelBox").innerHTML = `<p class="muted">Fuel stations couldn't load right now.</p>`); });
  } catch (e) {
    console.warn(e);
    $("#routeBox").innerHTML = `<div class="warnbox">⚠️ The free routing server is busy or couldn't find a road route. <button class="btn" id="retry">Try again</button></div>`;
    $("#tollBox").innerHTML = `<p class="muted">Needs the route — try again above.</p>`;
    $("#retry").onclick = () => openDetail(id, false);
  }
}
function renderShare(d, r) {
  const url = shareURL(d.id), w = S.wx[d.id];
  const txt = `❄ ${d.name} (${d.state}) trip — via BarfChalo\n` + (w ? `Snow next 7 days: ${Math.round(w.snow7)} cm (forecast)\n` : "") +
    (r ? `🚗 ${S.from.name} → ${d.name}: ${Math.round(r.km)} km, ~${Math.round(r.hrs)} h one way\n⛽ Fuel + tolls ≈ ${inr(r.total)} → ${inr(r.per)} each for ${S.pax}\n` : "") + url;
  $("#shareBtns").innerHTML = `<a class="btn wa" id="waBtn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(txt)}">🟢 WhatsApp</a>
    <button class="btn pri" id="copyBtn">🔗 Copy link</button>${navigator.share ? '<button class="btn" id="natBtn">📤 Share</button>' : ""}`;
  $("#waBtn").onclick = () => Stats.event("whatsapp");
  $("#copyBtn").onclick = async () => { Stats.event("shares"); try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link", url); } };
  $("#natBtn") && ($("#natBtn").onclick = () => { Stats.event("shares"); navigator.share({ title: `${d.name} snow trip`, text: txt, url }).catch(() => {}); });
}
function closeDetail() { $("#sheet").hidden = true; document.body.style.overflow = ""; history.replaceState(null, "", shareURL(null)); }

/* ---------- flow ---------- */
async function run() {
  $("#cards").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  await Promise.all([S.wxPromise, loadRoad()]);
  renderLive(); renderStats(); renderCards(); renderOverview();
  if (!$("#sheet").hidden) return;
  // Keep a destination id already in the hash (share links) so a refresh still opens that trip.
  history.replaceState(null, "", shareURL(readHash().d || null));
}
function snowfx() {
  const c = $("#snowfx"), x = c.getContext("2d"); let W, H, F;
  const size = () => { W = c.width = c.offsetWidth; H = c.height = c.offsetHeight;
    F = Array.from({ length: Math.min(110, W / 9) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2.2 + .6, s: Math.random() * .6 + .25, d: Math.random() * 1.5 })); };
  size(); addEventListener("resize", size);
  (function tick() { x.clearRect(0, 0, W, H); x.fillStyle = "rgba(255,255,255,.8)";
    F.forEach(f => { f.y += f.s; f.x += Math.sin((f.y + f.d * 100) / 40) * .3; if (f.y > H) { f.y = -5; f.x = Math.random() * W; }
      x.beginPath(); x.arc(f.x, f.y, f.r, 0, 7); x.fill(); }); requestAnimationFrame(tick); })();
}
async function init() {
  snowfx();
  const [dj, cj] = await Promise.all([getJSON("data/destinations.json"), getJSON("data/cars.json")]);
  S.dests = dj.destinations; S.cars = cj.cars; S.fuel = { ...cj.fuel }; S.meta = cj;
  try { const fl = await fetch("data/fuel.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json());
    if (fl && fl.fuel) { S.fuelLive = fl; Object.entries(fl.fuel).forEach(([k, v]) => S.fuel[k] = v); } } catch {}
  S.wxPromise = loadWeather();
  const h = readHash();
  setFrom(h.from || { name: "New Delhi, Delhi", lat: 28.6139, lon: 77.209, state: "Delhi" });
  setCar(S.cars.find(c => c.id === h.car) || S.cars.find(c => c.id === "maruti-swift-petrol"));
  if (h.pax) S.pax = Math.max(1, Math.min(12, +h.pax || 4)); $("#pax").textContent = S.pax;
  if (h.mil) { S.mileage = +h.mil; S.milTouched = true; $("#mileage").value = S.mileage; }
  if (h.fp) { S.price = +h.fp; S.priceTouched = true; $("#price").value = S.price; $("#priceNote").textContent = "your price"; }
  combo($("#from"), $("#fromList"), placeSearch, v => { $("#from").dataset.typed = 1; setFrom(v); run(); });
  combo($("#car"), $("#carList"), async q => carSearch(q.includes("·") ? "" : q), v => setCar(v) || refresh(), 0);
  $("#car").addEventListener("focus", e => e.target.select());
  $("#locBtn").onclick = useMyLocation;
  $$(".stepper button").forEach(b => b.onclick = () => { S.pax = Math.max(1, Math.min(12, S.pax + +b.dataset.step)); $("#pax").textContent = S.pax; refresh(); });
  $("#price").addEventListener("input", e => { if (+e.target.value > 0) { S.price = +e.target.value; S.priceTouched = true; $("#priceNote").textContent = "your price"; refresh(); } });
  $("#mileage").addEventListener("input", e => { if (+e.target.value > 0) { S.mileage = +e.target.value; S.milTouched = true; $("#milNote").textContent = "your mileage"; refresh(); } });
  $("#goBtn").onclick = () => { run(); $("#results").scrollIntoView({ behavior: "smooth" }); };
  $("#stateChips").onclick = e => { const b = e.target.closest(".chip"); if (b) { S.filter = b.dataset.s; renderChips(); renderCards(); } };
  $("#offbeat").onchange = e => { S.offbeat = e.target.checked; renderCards(); };
  $("#sort").onchange = e => { S.sort = e.target.value; renderCards(); };
  $("#cards").onclick = e => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); };
  $("#cards").onkeydown = e => { const c = e.target.closest(".card"); if (c && e.key === "Enter") openDetail(c.dataset.id); };
  document.addEventListener("click", e => { const o = e.target.closest("[data-open]"); if (o) openDetail(o.dataset.open); if (e.target.closest("[data-close]")) closeDetail(); });
  addEventListener("keydown", e => e.key === "Escape" && !$("#sheet").hidden && closeDetail());
  renderChips(); await run();
  if (h.d) openDetail(h.d, true);
  setInterval(() => refreshWeather(false), 30 * 60 * 1000);   // live forecast auto-refresh every 30 min
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.wxTime && Date.now() - S.wxTime > 15 * 60 * 1000) refreshWeather(false); });
  Stats.pageview(); Stats.showTrips();
}
function refresh() { updateMoreSum(); renderStats(); renderCards(); }
init().catch(e => { console.error(e); $("#cards").innerHTML = `<p class="warnbox">Something went wrong loading BarfChalo. Please refresh.</p>`; });
})();
