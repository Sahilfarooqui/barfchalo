#!/usr/bin/env python3
"""Refresh state-average petrol/diesel prices into data/fuel.json from GoodReturns' public state tables.
Run daily by .github/workflows/refresh-data.yml. Keeps the previous file if parsing looks wrong."""
import json, re, html, sys, urllib.request, datetime, os
UA = {"User-Agent": "Mozilla/5.0 (BarfChalo daily fuel refresh; github.com/Sahilfarooqui/barfchalo)"}
SRC = {"petrol": "https://www.goodreturns.in/petrol-price.html", "diesel": "https://www.goodreturns.in/diesel-price.html"}
ROW = re.compile(r'<a href="/(?:petrol|diesel)-price-in-[^"]+-s\d+\.html"[^>]*>([^<]+)</a>\s*</td>\s*<td>\s*(?:&#x20b9;|₹)\s*([\d.]+)', re.I)
def norm(s):
    s = html.unescape(s).strip().replace(" and ", " & ")
    return {"Jammu And Kashmir": "Jammu & Kashmir", "Andaman & Nicobar Islands": "Andaman & Nicobar", "Chhatisgarh": "Chhattisgarh", "Pondicherry": "Puducherry", "New Delhi": "Delhi"}.get(s, s)
out = {}
for fuel, url in SRC.items():
    page = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
    for name, price in ROW.findall(page):
        p = float(price)
        if 60 < p < 160: out.setdefault(norm(name), {})[fuel] = p
good = {k: v for k, v in out.items() if "petrol" in v and "diesel" in v}
if len(good) < 20:
    print("Parsed only", len(good), "states; keeping old file"); sys.exit(1)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
data = {"updated": now.isoformat(timespec="minutes"), "source": "GoodReturns state-average retail prices (goodreturns.in)",
        "source_url": SRC["petrol"], "note": "State averages; your city's pump price can differ by a few rupees.", "fuel": dict(sorted(good.items()))}
os.makedirs("data", exist_ok=True)
json.dump(data, open("data/fuel.json", "w"), ensure_ascii=False, indent=1)
print("ok", len(good), "states", now)
