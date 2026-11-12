# BarfChalo ❄ — find snow in India, plan the drive, split the cost

**Live:** https://sahilfarooqui.github.io/barfchalo/

A free, fully static snow-trip planner for anyone in India:

- Type any start point (Photon/OpenStreetMap autocomplete) or use your location
- Pick your car from ~90 popular Indian car variants (approx real-world mileage), override mileage and fuel price
- 43 snow destinations across Himachal, Uttarakhand, Jammu & Kashmir and Sikkim, incl. offbeat villages, with Wikimedia Commons photos (credited)
- Real road routes (public OSRM server) on a Leaflet + OpenStreetMap map
- Round-trip fuel with a terrain adjustment from the route's elevation profile (Open-Meteo elevation API), approx tolls, cost per person
- Live 16-day snow + temperature forecast and modelled snow depth (Open-Meteo), "snow this week" badges, ranking by snow + distance + risk
- Road-safety indicator, WhatsApp/share links that rebuild the exact trip

## Honesty rules
Mileage, state fuel prices and tolls are **approximate** and labelled so in the UI. No reviews, users or listings are invented. "Stays nearby" only links to public search pages until real partners exist.

## Data
- `data/destinations.json` — built by `scripts/build_destinations.py` (Nominatim coords, Open-Meteo DEM elevation, Commons photos). Seeds in `scripts/seeds.py`.
- `data/cars.json` — generated from `scripts/cars.py` (+ approx state fuel prices).

## Run locally
```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Limits
Public OSRM demo server, Photon and Nominatim are free community services with fair-use rate limits — fine for early traffic, but for scale move to a self-hosted or paid router (e.g. OpenRouteService key, GraphHopper) and a commercial tile provider.
