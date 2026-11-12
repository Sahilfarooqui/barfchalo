import json,math,re,os,urllib.parse,sys
sys.argv=['x'];exec(open('build.py').read().split('D=json.load')[0])  # get(), hav(), UA
D={d['id']:d for d in json.load(open('/workspace/barfchalo/data/destinations.json'))['destinations']}
cands=json.load(open('cands.json'))
GENERIC=re.compile(r"^(the |a )?((view ?point|viewpoint|view|falls?|water ?falls?|lake|tarn|pond|cave|natural cave|large cave|shelter|glacier|pass|saddle|attraction|temple|water|waterbank|hot water|sacred hot spring|small waterfall|scenic meadow|ridge pass|end trail|sacred trees|cave shelter|meadow|pass of .*|animals pass|animal lake|old .* view)|\d+ ?m ?(falls?|waterfall)|falls? \d+ ?m|.*boulder.*|tunnel.*|.*\d{3,}.*|valley view(point)?|meadow viewpoint|view to .*|view of .*|.* viewpoint|.* view)$",re.I)
OKVIEW=re.compile(r"(point|top|dhar|tibba|peak|ridge|tiba|danda)",re.I)
BAD=re.compile(r"pakistan|china|tibet|azad kashmir|nepal|bhutan|hydro|barrage|reservoir|weavers|welfare|project|dam\b",re.I)
BASE={'waterfall':9,'viewpoint':8.5,'lake':8,'hot_spring':7.5,'meadow':7,'valley':7,'village':6,'monastery':6,'fort':6,'attraction':5,'walk':6,'temple':4,'glacier':3.5,'peak':3,'park':2.5,'pass':2,'cave':2,'bridge':3}
CAP={'viewpoint':3,'waterfall':3,'lake':2,'village':2,'temple':1,'monastery':2,'glacier':1,'peak':1,'park':1,'pass':1,'meadow':2,'valley':2,'attraction':2,'hot_spring':1,'fort':1,'cave':1}
def norm(n): return re.sub(r'[^a-z]','',re.sub(r'\b(lake|tal|taal|falls?|waterfalls?|temple|mandir|valley|pass|top|glacier|national park|sanctuary|wls|viewpoint|view point)\b','',n.lower()))
def ok(c,d):
  n=(c['name'] or '').strip()
  if not n or not re.search('[A-Za-z]{3}',n) or re.match(r'^Q\d+$',n): return False
  if BAD.search(n) or BAD.search(c.get('wdesc') or ''): return False
  t=c['type']
  if GENERIC.match(n) and not (t=='viewpoint' and OKVIEW.search(n) and not re.match(r'(?i)^(manali|kullu|valley|old manali)\b',n)): 
    if not c.get('enwiki'): return False
  if t=='temple' and not (c['img'] and (c.get('enwiki') or c.get('heritage'))): return False
  if t=='pass' and not (c.get('enwiki') or c['img']): return False
  if t in('glacier','peak') and not (c['img'] and c.get('enwiki')): return False
  if t=='park' and not c.get('enwiki'): return False
  if t=='village' and not (c['img'] or c.get('enwiki')): return False
  if t=='cave' and not c.get('enwiki'): return False
  return True
def pre(c): return BASE.get(c['type'],3)+(4 if c['img'] else 0)+(3 if c.get('enwiki') else 0)+(1.5 if c.get('qid') else 0)-c['km']*0.22
OUT={}
for did,L in cands.items():
  d=D[did]; pool=[]
  for c in L:
    c['km']=hav(d['lat'],d['lon'],c['lat'],c['lon'])
    if c['km']>25 or not ok(c,d): continue
    pool.append(c)
  # merge duplicates (same qid or same normalized name within 3 km, or same type within 250 m)
  pool.sort(key=lambda c:-pre(c)); merged=[]
  for c in pool:
    dup=None
    for m in merged:
      if (c.get('qid') and c['qid']==m.get('qid')) or (norm(c['name']) and norm(c['name'])==norm(m['name']) and hav(c['lat'],c['lon'],m['lat'],m['lon'])<3) or hav(c['lat'],c['lon'],m['lat'],m['lon'])<0.25 and c['type']==m['type']:
        dup=m;break
    if dup:
      for k in ('img','enwiki','qid','osm','ele','wdesc','odesc'):
        if not dup.get(k) and c.get(k): dup[k]=c[k]
      if c.get('osm') and dup['type'] in ('attraction','park','valley') and c['type'] in ('viewpoint','waterfall','lake'): pass
    else: merged.append(c)
  OUT[did]=merged
json.dump(OUT,open('pool.json','w'))
for did in OUT: print(did,len(OUT[did]),sum(1 for c in OUT[did] if c['img']))
