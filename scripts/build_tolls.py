"""Build data/tolls.json from the open NHAI toll plaza dataset.

Source: https://github.com/ForceGT/india-toll-plazas (data/latest.json), which republishes
NHAI RajMargyatra / TIS plaza records (location + Car/Jeep/Van fares) plus curated
state-highway plazas (fares from TollGuru where known). Nothing here is estimated:
a fare that is missing or 0 in the source is stored as null and shown as "fare unknown".
"""
import json, math, re, html, urllib.request, datetime, os

SRC = "https://raw.githubusercontent.com/ForceGT/india-toll-plazas/main/data/latest.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "tolls.json")

def hav(a, b, c, d):
    R = 6371; p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def num(v):
    try:
        v = float(str(v).strip())
        return int(round(v)) if v > 0 else None
    except Exception:
        return None

def clean(s):
    s = html.unescape(html.unescape(str(s or ""))).strip()
    s = re.sub(r"\s+", " ", s)
    return s

def main():
    raw = json.loads(urllib.request.urlopen(SRC, timeout=60).read())
    rows = []
    for p in raw:
        if p.get("active") is False:
            continue
        try:
            lat, lon = float(p["latitude"]), float(p["longitude"])
        except Exception:
            continue
        if not (6 < lat < 37.5 and 68 < lon < 97.5):
            continue
        name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", clean(p.get("tollplaza_name")))
        closed = bool(re.search(r"clos(e|ed)\s*loop|entry exit", name, re.I))
        src = p.get("data_source")
        date = (p.get("rate_effective_date") or p.get("last_updated") or "")[:10] or None
        rows.append({
            "name": name, "lat": round(lat, 5), "lon": round(lon, 5),
            "hw": clean(p.get("nh_no")) or None,
            "state": clean(p.get("state_name")).title() or None,
            "single": num(p.get("car_single")), "ret": num(p.get("car_return")),
            "closed": closed, "src": "nhai" if src == "nhai" else "state", "date": date,
        })
    # Drop state-curated duplicates that sit on top of an NHAI plaza (NHAI record wins).
    nh = [r for r in rows if r["src"] == "nhai"]
    keep = []
    for r in rows:
        if r["src"] == "state" and any(abs(r["lat"] - n["lat"]) < 0.02 and abs(r["lon"] - n["lon"]) < 0.02
                                       and hav(r["lat"], r["lon"], n["lat"], n["lon"]) < 1.5 for n in nh):
            continue
        keep.append(r)
    for r in keep:  # a return fare that is not cheaper than 2 singles is useless; keep it only if real
        if r["ret"] and r["single"] and r["ret"] >= 2 * r["single"]:
            r["ret"] = None
    fields = ["name", "lat", "lon", "hw", "state", "single", "ret", "closed", "src", "date"]
    out = {
        "generated": datetime.date.today().isoformat(),
        "vehicle": "Car / Jeep / Van (FASTag)",
        "source": "NHAI toll plaza data (RajMargyatra / TIS), republished at github.com/ForceGT/india-toll-plazas; state-highway plazas curated there (car fares from TollGuru where known)",
        "source_url": "https://github.com/ForceGT/india-toll-plazas",
        "notes": "single = one-way car fare; ret = return fare (valid 24 h); null = fare not published in the source; closed = closed-loop expressway charged by distance at exit",
        "fields": fields,
        "rows": [[r[f] for f in fields] for r in keep],
    }
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(len(raw), "source records ->", len(keep), "plazas;", sum(1 for r in keep if r["single"]), "with car fare")

if __name__ == "__main__":
    main()
