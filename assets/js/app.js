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
function setDefaultPrice() {
  const f = S.car ? S.car.fuel : "petrol", st = S.from && S.from.state;
  let v, note;
  if (f === "cng") { v = S.meta.default_cng; note = "approx CNG ₹/kg · edit"; }
  else if (f === "ev") { v = S.meta.default_ev_kwh; note = "approx home charging ₹/kWh · public fast chargers cost more"; }
  else { const known = st && S.fuel[st], row = known ? S.fuel[st] : S.fuel["Delhi"]; v = row[f];
    const live = S.fuelLive && S.fuelLive.fuel[known ? st : "Delhi"];
    note = live ? `${known ? st : "Delhi"} avg ${f} today · updated ${fmtDate(S.fuelLive.updated)} · edit` : `approx ${known ? st : "Delhi"} ${f} price · edit`; }
  S.price = v; $("#price").value = v; $("#priceNote").textContent = note;
  $("#priceLbl").textContent = `⛽ ${f === "ev" ? "Power" : "Fuel"} ₹/${fuelUnit(f)}`;
}
function setFrom(f) {
  S.from = f; $("#from").value = f.name;
  if (!S.priceTouched) setDefaultPrice();
}
function combo(input, list, search, pick, wait = 250) {
  let items = [], act = -1, timer;
  const render = () => { list.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}" class="${i === act ? "act" : ""}">${it.html}</li>`).join("");
    list.classList.toggle("open", items.length > 0); };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { items = await search(input.value.trim()); act = -1; render(); }, wait); });
  input.addEventListener("focus", async () => { if (!input.dataset.typed) { items = await search(""); act = -1; render(); } });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { act = Math.min(items.length - 1, act + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { act = Math.max(0, act - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter" && items.length) { pick(items[Math.max(0, act)].v); list.classList.remove("open"); e.preventDefault(); }
    else if (e.key === "Escape") list.classList.remove("open");
  });
  list.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { pick(items[+li.dataset.i].v); list.classList.remove("open"); e.preventDefault(); } });
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
function carSearch(q) {
  const t = q.toLowerCase().split(/\s+/).filter(Boolean);
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
      <div class="facts"><div><b>${r ? Math.round(r.km) + " km" : "—"}</b><span>${r && !r.real ? "approx " : ""}one way</span></div>
        <div><b>${r ? "~" + Math.round(driveHours(r.h, hillFactor(d) + 0.1)) + " h" : "—"}</b><span>drive</span></div>
        <div><b>${c ? inr(c.total / S.pax) : "—"}</b><span>≈ per person*</span></div></div>
      <div class="cardfoot"><span class="risk"><i class="dot r${sf.lvl}"></i>${sf.label}</span>
        <span>${w ? `${w.now != null ? Math.round(w.now) + "°C now" : ""}` : ""}</span><span class="mini" aria-label="7 day snow">${bars}</span></div>
    </article>`; }).join("");
}
function renderStats() {
  const ws = S.dests.map(d => S.wx[d.id]).filter(Boolean);
  const heavy = ws.filter(w => w.snow7 >= 15).length, some = ws.filter(w => w.snow7 >= 0.5).length;
  const top = [...S.dests].sort((a, b) => (S.wx[b.id]?.snow7 || 0) - (S.wx[a.id]?.snow7 || 0))[0];
  const near = S.from ? [...S.dests].filter(d => (S.wx[d.id]?.snow7 || 0) >= 0.5).sort((a, b) => (S.road[a.id]?.km || 1e9) - (S.road[b.id]?.km || 1e9))[0] : null;
  $("#statbar").innerHTML = S.wxFail ? `<div class="stat"><b>⚠️</b><span>Snow forecast didn't load — refresh in a minute.</span></div>` : `
    <div class="stat"><b>${some}/${S.dests.length}</b><span>places with snow forecast this week</span></div>
    <div class="stat"><b>${heavy}</b><span>with heavy snow (15 cm+)</span></div>
    <div class="stat"><b>${top && S.wx[top.id] ? esc(top.name) : "—"}</b><span>most snow: ${top && S.wx[top.id] ? Math.round(S.wx[top.id].snow7) + " cm in 7 days" : ""}</span></div>
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
  return S.routeCache[key] = { km: g.distance / 1000, h: g.duration / 3600, coords, elev, segKm: (g.distance / 1000) / 99 };
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
let rMap;
function fitRouteMap(m) { // re-measure the container (it may have been hidden/animating) and fit the route
  if (!m || m !== rMap) return; const el = m.getContainer(); if (!el.offsetWidth || !el.offsetHeight) return;
  m.invalidateSize({ animate: false });
  if (m._fit) m.fitBounds(m._fit, { padding: [24, 24], animate: false });
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
      <span class="pill">${s.txt}</span>${w && w.depth ? `<span class="pill">⛄ ~${w.depth} cm on ground (model)</span>` : ""}${d.offbeat ? '<span class="pill">🌿 Offbeat</span>' : ""}</div></div>
    <div class="dsec"><h3>🛣️ Route & cost ${S.from ? `<span class="muted">from ${esc(S.from.name)}</span>` : ""}</h3><div id="routeBox">${S.from ? '<div class="skeleton" style="height:160px"></div>' : '<p class="muted">Set a starting point above to see the route and cost.</p>'}</div>
      <div id="routeMap" style="margin-top:12px"></div></div>
    <div class="dsec"><h3>🌨️ 16-day snow & temperature</h3><div class="fc">${fc}</div>
      <p class="muted">Open-Meteo model forecast at ${d.elevation_m} m${S.wxTime ? `, fetched ${S.wxTime.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} IST` : ""}. Forecasts beyond ~5 days are less reliable.</p></div>
    <div class="dsec"><h3>🛡️ Road safety</h3><div class="safety"><div class="meter l${sf.lvl}">${sf.label}</div>
      <div><p>${esc(d.safety)}</p><ul>${sf.why.map(([a, b]) => `<li><b>${esc(a)}:</b> ${esc(b)}</li>`).join("")}</ul>
      <p class="muted" style="margin-top:6px">A guide from forecast + road type, not live road status. Check with local police or your stay before driving.</p></div></div></div>
    <div class="dsec"><h3>🏡 Stays nearby</h3><div class="stays"><p>Verified partner stays are coming soon. Until then, search directly (BarfChalo does not get paid for these links):</p>
      <div class="btns"><a class="btn" target="_blank" rel="noopener" href="https://www.booking.com/searchresults.html?ss=${q}">Booking.com</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.airbnb.co.in/s/${encodeURIComponent(d.name + ", " + d.state)}/homes">Airbnb</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/homestay+near+${q}">Google Maps</a></div></div></div>
    <div class="dsec" style="padding-bottom:28px"><h3>📤 Share this trip</h3><div class="btns" id="shareBtns"></div></div>`;
  $("#sheet .sheet-card").scrollTop = 0;
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
  if (!S.from) return;
  try {
    const rt = await routeFor(d); if ($("#dName")?.textContent !== d.name) return;
    const tf = terrainFuel(rt, d), units = tf.oneWay + tf.back, fuel = units * S.price;
    const toll = round50(tf.plainKm * 1.5) * 2, total = fuel + toll, per = total / S.pax;
    const hrs = driveHours(rt.h, tf.hillKm / rt.km);
    const terr = tf.flat ? Math.round((units / tf.flat - 1) * 100) : 0, u = fuelUnit(S.car.fuel);
    const warn = S.car.fuel === "cng" ? "CNG pumps are rare in the hills — expect to run on petrol for part of the trip." :
                 S.car.fuel === "ev" ? "Fast chargers are few in the mountains. Plan charging stops before you go." : "";
    $("#routeBox").innerHTML = `<div class="tiles">
      <div class="tile"><div class="ic">🛣️</div><b>${Math.round(rt.km)} km</b><span>one way by road</span></div>
      <div class="tile"><div class="ic">⏱️</div><b>${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m</b><span>realistic drive (map says ${rt.h.toFixed(1)} h)</span></div>
      <div class="tile"><div class="ic">⛽</div><b>${units.toFixed(0)} ${u === "litre" ? "L" : u}</b><span>round trip · ${terr >= 0 ? "+" : ""}${terr}% for hills</span></div>
      <div class="tile"><div class="ic">⛰️</div><b>${tf.ascent != null ? Math.round(tf.ascent).toLocaleString("en-IN") + " m" : "—"}</b><span>total climb, highest ${Math.round(tf.maxEl).toLocaleString("en-IN")} m</span></div>
      <div class="tile big"><div class="ic">👥</div><b>${inr(per)}</b><span>per person (${S.pax}) · fuel + tolls</span></div></div>
      <table class="costs" style="margin-top:12px">
        <tr><td>⛽ Fuel there (${tf.oneWay.toFixed(1)} ${u}) + back (${tf.back.toFixed(1)} ${u}) × ₹${S.price}</td><td>${inr(fuel)}</td></tr>
        <tr><td>🧾 Tolls, round trip <span class="muted">(approx, ±30%)</span></td><td>${inr(toll)}</td></tr>
        <tr class="total"><td>Total for the car</td><td>${inr(total)}</td></tr></table>
      <p class="muted">Car: ${esc(S.car.brand + " " + S.car.model)} (${S.car.fuel}) at ~${S.mileage} km/${u === "litre" ? "l" : u} highway, worse on climbs and better on descents. Stays and food are not included. Tolls are a rough estimate (~₹1.5/km on plains highways) — check your FASTag SMS.</p>
      ${warn ? `<div class="warnbox">⚠️ ${warn}</div>` : ""}`;
    if (rMap) { const line = L.polyline(rt.coords.map(c => [c[1], c[0]]), { color: "#38bdf8", weight: 5, opacity: .9 }).addTo(rMap);
      L.circleMarker([S.from.lat, S.from.lon], { radius: 8, color: "#fff", fillColor: "#22c55e", fillOpacity: 1 }).addTo(rMap).bindPopup("Start: " + esc(S.from.name));
      rMap._fit = line.getBounds(); fitRouteMap(rMap); const m = rMap; [200, 600].forEach(t => setTimeout(() => fitRouteMap(m), t)); }
    renderShare(d, { km: rt.km, hrs, total, per });
  } catch (e) {
    console.warn(e);
    $("#routeBox").innerHTML = `<div class="warnbox">⚠️ The free routing server is busy or couldn't find a road route. <button class="btn" id="retry">Try again</button></div>`;
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
  if (!$("#sheet").hidden) return; history.replaceState(null, "", shareURL(null));
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
  if (h.d) openDetail(h.d, false);
  setInterval(() => refreshWeather(false), 30 * 60 * 1000);   // live forecast auto-refresh every 30 min
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.wxTime && Date.now() - S.wxTime > 15 * 60 * 1000) refreshWeather(false); });
  Stats.pageview(); Stats.showTrips();
}
function refresh() { renderStats(); renderCards(); }
init().catch(e => { console.error(e); $("#cards").innerHTML = `<p class="warnbox">Something went wrong loading BarfChalo. Please refresh.</p>`; });
})();
