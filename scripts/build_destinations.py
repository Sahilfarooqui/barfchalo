#!/usr/bin/env python3
"""Build data/destinations.json: reuses curated spots from the old planner and adds new ones.
Coordinates: Nominatim (falls back to the seed if search is empty or > 20 km off).
Elevation: Open-Meteo elevation API (Copernicus DEM). Photos: Wikimedia Commons, free licences only."""
import json, math, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, "scripts")
from seeds import SEEDS
UA = "BarfChalo/1.0 (static snow trip planner; github.com/Sahilfarooqui/barfchalo)"
def get(url, timeout=60):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
        except Exception as e:
            err = e; time.sleep(2 + 2*i)
    raise err
def hav(a, b, c, d):
    R=6371; p1,p2=math.radians(a),math.radians(c); dp=p2-p1; dl=math.radians(d-b)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2; return 2*R*math.asin(math.sqrt(h))
def commons(q, n=4):
    url=("https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch="
         +urllib.parse.quote(q)+"&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=900")
    time.sleep(0.4)
    try: data=get(url)
    except Exception as e: print("commons fail",q,e); return []
    pages=sorted(((data.get("query") or {}).get("pages") or {}).values(), key=lambda p:p.get("index",99))
    out=[]
    for p in pages:
        info=(p.get("imageinfo") or [None])[0]
        if not info or info.get("mime") not in ("image/jpeg","image/png","image/webp"): continue
        if (info.get("width") or 0) < (info.get("height") or 0): continue  # landscape only for cards
        m=info.get("extmetadata") or {}
        g=lambda k:((m.get(k) or {}).get("value") or "").strip()
        lic=g("LicenseShortName"); lu=g("LicenseUrl").lower(); l=lic.lower()
        if not (l.startswith("cc") or "public domain" in l or "creativecommons" in lu or "publicdomain" in lu): continue
        author=re.sub(r"<[^>]+>","",g("Artist")).replace("&amp;","&").strip() or "Unknown"
        out.append({"title":p["title"].replace("File:",""),"author":author[:80],"license":lic or "CC",
                    "src":info.get("thumburl") or info.get("url"),
                    "page":"https://commons.wikimedia.org/wiki/"+urllib.parse.quote(p["title"].replace(" ","_"))})
        if len(out)>=n: break
    return out

old = {s["id"]: s for s in json.load(open("/workspace/snow-trip-planner/public/data/spots.json"))["spots"]}
REUSE = {  # id: (area, state, risk, offbeat)
 "sissu":("Lahaul","Himachal Pradesh",3,False), "solang":("near Manali","Himachal Pradesh",2,False),
 "narkanda":("Shimla hills","Himachal Pradesh",1,False), "kufri":("above Shimla","Himachal Pradesh",1,False),
 "chitkul":("Kinnaur","Himachal Pradesh",3,True), "sangla":("Kinnaur","Himachal Pradesh",2,True),
 "kalpa":("Kinnaur","Himachal Pradesh",2,True), "rakchham":("Kinnaur","Himachal Pradesh",3,True),
 "jalori_jibhi":("Banjar","Himachal Pradesh",2,True), "chanshal":("Rohru","Himachal Pradesh",3,True),
 "auli":("Joshimath","Uttarakhand",2,False), "harsil":("Uttarkashi","Uttarakhand",2,True),
 "chakrata":("Jaunsar","Uttarakhand",1,True)}
def clean(t):
    t=re.sub(r"\s*Closest[^.]*(Shaheen Bagh|Delhi)[^.]*\.","",t)
    return t.replace("This page is about","").strip()

dests=[]
for sid,(area,state,risk,off) in REUSE.items():
    s=old[sid]
    ph=[{"title":p["title"],"author":p["author"][:80],"license":p["license"],"src":p["thumb"],"page":p["page"]} for p in s["photos"][:4]]
    dests.append({"id":sid,"name":s["name"],"area":area,"state":state,"lat":round(s["lat"],5),"lon":round(s["lon"],5),
                  "elevation_m":s["elevation_m"],"risk":risk,"offbeat":off,"safety":clean(s["safety"]),"photos":ph,
                  "snow_months":s.get("snow_months","")})
for sid,name,area,state,lat,lon,q,risk,off,pq,safety in SEEDS:
    time.sleep(1.1)
    src="seed"
    try:
        r=get("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+urllib.parse.quote(q))
        if r:
            glat,glon=float(r[0]["lat"]),float(r[0]["lon"])
            if hav(lat,lon,glat,glon)<20: lat,lon,src=glat,glon,"nominatim"
            else: print("  far geocode", sid, glat, glon)
    except Exception as e: print("geocode fail",sid,e)
    dests.append({"id":sid,"name":name,"area":area,"state":state,"lat":round(lat,5),"lon":round(lon,5),"coord_src":src,
                  "risk":risk,"offbeat":off,"safety":safety,"photos":commons(pq),"snow_months":""})
    print(sid, src, len(dests[-1]["photos"]), flush=True)
need=[d for d in dests if "elevation_m" not in d]
el=get("https://api.open-meteo.com/v1/elevation?latitude="+",".join(str(d["lat"]) for d in need)+"&longitude="+",".join(str(d["lon"]) for d in need))["elevation"]
for d,e in zip(need,el): d["elevation_m"]=round(e)
json.dump({"generated":time.strftime("%Y-%m-%d"),"destinations":dests},open("data/destinations.json","w"),ensure_ascii=False,indent=1)
print("done",len(dests))
