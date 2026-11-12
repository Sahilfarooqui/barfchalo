# BarfChalo ❄ — find snow in India, plan the drive, split the cost

**Live:** https://sahilfarooqui.github.io/barfchalo/

A free, fully static snow-trip planner for anyone in India:

- Type any start point (Photon/OpenStreetMap autocomplete) or use your location
- Pick your car from ~90 popular Indian car variants (approx real-world mileage), override mileage and fuel price
- 43 snow destinations across Himachal, Uttarakhand, Jammu & Kashmir and Sikkim, incl. offbeat villages, with Wikimedia Commons photos (credited)
- Real road routes (public OSRM server) on a Leaflet + OpenStreetMap map
- Round-trip fuel with a terrain adjustment from the route's elevation profile (Open-Meteo elevation API), real toll plazas on the route with NHAI car fares, cost per person
- Live 16-day snow + temperature forecast and modelled snow depth (Open-Meteo), "snow this week" badges, ranking by snow + distance + risk
- Explore & photo spots (viewpoints, waterfalls, lakes, villages, famous temples/monasteries) per destination, with credited Commons photos
- Fuel pumps / CNG stations / EV chargers along the route for the selected car, with long-gap warnings for CNG/EV
- Road-safety indicator, WhatsApp/share links that rebuild the exact trip

## Honesty rules
Mileage and state fuel prices are **approximate**; toll fares come from NHAI data, and plazas with no published fare are shown as unknown with an approx fallback, and labelled so in the UI. No reviews, users or listings are invented. "Stays nearby" only links to public search pages until real partners exist.

## Data
- `data/destinations.json` — built by `scripts/build_destinations.py` (Nominatim coords, Open-Meteo DEM elevation, Commons photos). Seeds in `scripts/seeds.py`.
- `data/cars.json` — generated from `scripts/cars.py` (+ approx state fuel prices).
- `data/tolls.json` — `scripts/build_tolls.py`: NHAI toll plazas (RajMargyatra/TIS, via the open github.com/ForceGT/india-toll-plazas dataset) with Car/Jeep/Van single + return fares. Matched in the browser to plazas within 300 m of the OSRM route. Re-run monthly / after April fare revisions.
- `data/explore.json` — `scripts/explore/` pipeline: OpenStreetMap features from Geofabrik India extracts (`osm.py`) + Wikidata geo search (`wd.py`) → filter/score (`build.py`, `select.py`) → Commons photo lookup (`photos.py`) → Wikipedia one-liners, photo credits (`finalize.py`). Only free-licence photos are kept.
- `data/stations/` — `scripts/build_fuel_stations.py`: amenity=fuel and amenity=charging_station from OpenStreetMap (Geofabrik India extracts), 1°×1° tiles loaded only for the tiles the route crosses. CNG = fuel:cng=yes or a city-gas brand name. CNG/EV also get a live Overpass top-up when the server answers.

## Run locally
```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Limits
Public OSRM demo server, Photon and Nominatim are free community services with fair-use rate limits — fine for early traffic, but for scale move to a self-hosted or paid router (e.g. OpenRouteService key, GraphHopper) and a commercial tile provider.

## Freshness
- Snow, weather, snow depth and current temperature: fetched live from Open-Meteo on every page load, auto-refreshed every 30 min (and when the tab comes back after 15+ min). The "Updated" time is shown above the results.
- Routes, distances and elevation profiles: live from OSRM / Open-Meteo per request.
- Fuel prices: `data/fuel.json`, state averages scraped from goodreturns.in by `scripts/update_fuel.py`. Refreshed daily at 06:00 IST by `.github/workflows/refresh-data.yml`. Falls back to approx values in `data/cars.json` for missing states.

## Reach
Privacy-friendly counters via the free Abacus API (no cookies/personal data). Dashboard: https://sahilfarooqui.github.io/barfchalo/stats.html. Counting is disabled on localhost, in automated browsers, and with `?nocount`.
