import json,re,urllib.parse
exec(open('build.py').read().split('D=json.load')[0])
exec(open('select.py').read().split('OUT={}')[0].split("cands=json.load")[0].split("D={d['id']")[0])
pool=json.load(open('pool.json'))
STOP={'lake','falls','fall','waterfall','waterfalls','temple','mandir','valley','pass','top','view','viewpoint','point','glacier','national','park','the','tal','taal','river','village','hot','spring','springs','peak','devi','mata','shri','sri','india','himachal','pradesh','kashmir','sikkim','uttarakhand','district','road','meadow'}
def toks(n): return [t for t in re.findall(r'[a-z]{4,}',n.lower()) if t not in STOP]
def pre(c): return {'waterfall':9,'viewpoint':8.5,'lake':8,'hot_spring':7.5,'meadow':7,'valley':7,'village':6,'monastery':6,'fort':6,'attraction':5}.get(c['type'],3)+(3 if c.get('enwiki') else 0)-c['km']*0.22
found=0;tried=0
for did,L in pool.items():
  for c in sorted([c for c in L if not c['img']],key=lambda c:-pre(c))[:12]:
    tk=toks(c['name'])
    if not tk: continue
    tried+=1
    j=get(f"https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord={c['lat']:.5f}|{c['lon']:.5f}&gsradius=1500&gslimit=50&gsnamespace=6&format=json")
    if not j: continue
    best=None
    for g in j.get('query',{}).get('geosearch',[]):
      t=g['title'][5:]; tl=t.lower()
      if not re.search(r'\.(jpe?g|png|webp)$',tl): continue
      if all(x in tl for x in tk[:2]) or (len(tk)==1 and tk[0] in tl):
        best=t;break
    if best: c['img']=best; c['img_geo']=True; found+=1
json.dump(pool,open('pool2.json','w'))
print('tried',tried,'found',found)
for did in pool: print(did,sum(1 for c in pool[did] if c['img']),end='; ')
