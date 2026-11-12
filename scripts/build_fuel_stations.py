"""Build data/stations/<lat>_<lon>.json tiles (1 deg x 1 deg) of fuel pumps, CNG stations and EV chargers
from OpenStreetMap (Geofabrik India zone extracts).
Usage: python3 scripts/build_fuel_stations.py northern.pbf central.pbf ...
Real OSM data only. Each row: [lat, lon, name, brand, flags]; flags: p = petrol/diesel pump (amenity=fuel),
c = CNG (fuel:cng=yes or a CNG/city-gas brand in the name), l = LPG, e = EV charger (amenity=charging_station)."""
import osmium, json, os, re, sys, math, datetime
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "stations")
CNG_NAME = re.compile(r"\bcng\b|\bigl\b|indraprastha gas|\bmgl\b|mahanagar gas|adani (total )?gas|gail gas|torrent gas|think gas|haryana city gas|bhagyanagar gas|megha gas|central u\.?p\.? gas|sabarmati gas|gujarat gas|avantika gas", re.I)
tiles, seen = {}, set()
def add(lat, lon, t):
    if not (6 < lat < 37.5 and 68 < lon < 97.5): return
    am = t.get("amenity")
    if am == "fuel":
        flags = "p"
        nm = " ".join(t.get(k, "") for k in ("name", "brand", "operator", "name:en"))
        if t.get("fuel:cng") == "yes" or CNG_NAME.search(nm): flags += "c"
        if t.get("fuel:lpg") == "yes" or t.get("fuel:autogas") == "yes": flags += "l"
    elif am == "charging_station":
        if t.get("motorcar") == "no": return
        flags = "e"
    else: return
    key = (round(lat, 4), round(lon, 4), flags)
    if key in seen: return
    seen.add(key)
    name = (t.get("name:en") or t.get("name") or "").strip()[:60]
    brand = (t.get("brand") or t.get("operator") or "").strip()[:40]
    tiles.setdefault(f"{math.floor(lat)}_{math.floor(lon)}", []).append([round(lat, 5), round(lon, 5), name, brand, flags])
for f in sys.argv[1:]:
    fp = osmium.FileProcessor(f).with_areas().with_filter(osmium.filter.TagFilter(("amenity", "fuel"), ("amenity", "charging_station")))
    for o in fp:
        t = {k.k: k.v for k in o.tags}
        if o.is_node():
            if o.location.valid(): add(o.location.lat, o.location.lon, t)
        elif o.is_area():
            try: pts = [(n.lat, n.lon) for r in o.outer_rings() for n in r]
            except Exception: continue
            if pts: add(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), t)
os.makedirs(OUT, exist_ok=True)
for fn in os.listdir(OUT): os.remove(os.path.join(OUT, fn))
for k, rows in tiles.items():
    json.dump(rows, open(os.path.join(OUT, k + ".json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump({"generated": datetime.date.today().isoformat(), "source": "OpenStreetMap contributors (ODbL), Geofabrik India extracts",
           "fields": ["lat", "lon", "name", "brand", "flags"], "flags": {"p": "petrol/diesel", "c": "CNG", "l": "LPG", "e": "EV charger"},
           "tiles": {k: len(v) for k, v in tiles.items()}}, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
allr = [r for v in tiles.values() for r in v]
print(len(tiles), "tiles;", sum("p" in r[4] for r in allr), "pumps;", sum("c" in r[4] for r in allr), "CNG;", sum("e" in r[4] for r in allr), "EV")
