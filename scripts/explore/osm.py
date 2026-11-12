import osmium,json,math,re
D=json.load(open('/workspace/barfchalo/data/destinations.json'))['destinations']
boxes=[(d['id'],d['lat'],d['lon']) for d in D]
def near(lat,lon):
  out=[]
  for i,a,b in boxes:
    if abs(lat-a)<0.25 and abs(lon-b)<0.32:
      out.append(i)
  return out
def kind(t):
  g=t.get
  if g('tourism')=='viewpoint': return 'viewpoint'
  if g('natural')=='waterfall' or g('waterway')=='waterfall': return 'waterfall'
  if g('natural')=='glacier': return 'glacier'
  if g('natural')=='hot_spring': return 'hot_spring'
  if g('natural')=='cave_entrance': return 'cave'
  if g('water') in ('lake','reservoir','pond') or (g('natural')=='water' and (g('wikidata') or g('water')=='lake')): return 'lake'
  if g('mountain_pass')=='yes' or g('natural') in ('saddle',): return 'pass'
  if g('natural')=='peak' and (g('wikidata') or g('wikipedia')): return 'peak'
  if g('natural') in ('meadow','valley') or g('landuse')=='meadow' and g('name'): return 'meadow'
  if g('amenity')=='place_of_worship' and (g('wikidata') or g('wikipedia') or g('heritage')): return 'temple' if g('religion')!='buddhist' else 'monastery'
  if g('historic') in ('fort','castle'): return 'fort'
  if g('tourism') in ('attraction','picnic_site'): return 'attraction'
  if g('leisure') in ('park','nature_reserve') and g('wikidata'): return 'park'
  if g('place') in ('village','hamlet') and (g('wikidata') or g('wikipedia')): return 'village'
  return None
res={}
class H(osmium.SimpleHandler):
  def emit(self,o,lat,lon,typ):
    t={k.k:k.v for k in o.tags}
    if not t.get('name') and not t.get('name:en'): return
    k=kind(t)
    if not k: return
    for i in near(lat,lon):
      res.setdefault(i,[]).append({'osm':f"{typ}/{o.id}",'lat':lat,'lon':lon,'type':k,'tags':t})
  def node(self,n):
    if not n.tags or not n.location.valid(): return
    self.emit(n,n.location.lat,n.location.lon,'node')
  def area(self,a):
    if not a.tags: return
    try:
      pts=[(n.lat,n.lon) for r in a.outer_rings() for n in r]
    except Exception: return
    if not pts: return
    lat=sum(p[0] for p in pts)/len(pts); lon=sum(p[1] for p in pts)/len(pts)
    self.emit(a,lat,lon,'way' if a.from_way() else 'relation')
for f in ['north.pbf','ne.pbf','central.pbf']:
  fp=osmium.FileProcessor(f).with_areas().with_filter(osmium.filter.KeyFilter('tourism','natural','waterway','water','mountain_pass','amenity','historic','leisure','place'))
  h=H()
  for o in fp:
    if o.is_node(): h.node(o)
    elif o.is_area(): h.area(o)
json.dump(res,open('osm.json','w'))
print({k:len(v) for k,v in res.items()})
