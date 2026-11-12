import json,math,re,os,time,urllib.request,urllib.parse,hashlib,html
UA={'User-Agent':'BarfChalo/1.0 (https://sahilfarooqui.github.io/barfchalo/; jcb86193@mail.grokbot.com)'}
def get(url):
  fn='cache/'+hashlib.md5(url.encode()).hexdigest()+'.json'
  if os.path.exists(fn): return json.load(open(fn))
  for k in range(4):
    try:
      j=json.loads(urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=40).read())
      json.dump(j,open(fn,'w')); time.sleep(0.15); return j
    except urllib.error.HTTPError as e:
      if e.code==404: json.dump(None,open(fn,'w')); return None
      time.sleep(3*(k+1))
    except Exception as e: time.sleep(3*(k+1))
  return None
def hav(a,b,c,d):
  R=6371;p=math.pi/180;h=math.sin((c-a)*p/2)**2+math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2;return 2*R*math.asin(math.sqrt(h))
D=json.load(open('/workspace/barfchalo/data/destinations.json'))['destinations']
OSM=json.load(open('osm.json'))
src=open('wd.py').read(); CL=eval(re.search(r'CL=(\{.*?\})\n',src).group(1))
GENERIC=re.compile(r"^(the )?(view ?point|viewpoint|view|falls?|water ?fall|waterfalls|lake|tarn|pond|cave|natural cave|large cave|boulder( cave)?|shelter|glacier|pass|saddle|attraction|temple|water|waterbank|hot water|small waterfall|scenic meadow|ridge pass|end trail|sacred trees|\d+ ?m ?(falls?|waterfall)|falls? \d+ ?m|.*\bviewpoint \d+|valley view(point)?|meadow viewpoint|view to waterfall|view of .*|.*boulder.*|tunnel.*|[^a-z]+|manali viewpoint|viewpoint|\w+ \d+)$",re.I)
BAD_DESC=re.compile(r"pakistan|china|tibet|azad kashmir|nepal|bhutan",re.I)
BASE={'waterfall':9,'viewpoint':9,'lake':8,'hot_spring':7,'meadow':7,'valley':7,'village':6,'monastery':6,'fort':6,'attraction':5,'walk':6,'temple':4,'glacier':3,'peak':3,'park':3,'pass':2,'cave':2,'bridge':3}
CAP={'viewpoint':3,'waterfall':3,'lake':2}
cands={}
# Wikidata candidates
for d in D:
  L=cands.setdefault(d['id'],[])
  items={}
  for b in json.load(open(f"wd/{d['id']}.json")):
    q=b['i']['value'].split('/')[-1]; t=CL[b['cls']['value'].split('/')[-1]]
    if t=='river': continue
    lon,lat=map(float,re.findall(r'[-\d.]+',b['coord']['value'])[:2])
    it=items.setdefault(q,{'qid':q,'name':b['iLabel']['value'],'type':t,'lat':lat,'lon':lon,'img':None,'wdesc':b.get('iDescription',{}).get('value'),'enwiki':b.get('art',{}).get('value'),'ele':None,'osm':None})
    it['img']=it['img'] or (urllib.parse.unquote(b['img']['value'].split('/')[-1]) if b.get('img') else None)
    if b.get('ele'): 
      try: it['ele']=int(float(b['ele']['value']))
      except: pass
  L+=items.values()
# OSM candidates
need=set()
for did,xs in OSM.items():
  for x in xs:
    t=x['tags']; nm=t.get('name:en') or t.get('name')
    q=t.get('wikidata')
    if q: need.add(q)
    ele=None
    try: ele=int(float(re.sub(r'[^\d.]','',t.get('ele','')) or 'x'))
    except: pass
    wp=t.get('wikipedia'); enwiki=None
    if wp and wp.startswith('en:'): enwiki='https://en.wikipedia.org/wiki/'+urllib.parse.quote(wp[3:].replace(' ','_'))
    img=None
    if t.get('wikimedia_commons','').startswith('File:'): img=t['wikimedia_commons'][5:]
    elif t.get('image','').startswith('File:'): img=t['image'][5:]
    cands[did].append({'qid':q,'name':nm,'type':x['type'],'lat':x['lat'],'lon':x['lon'],'img':img,'wdesc':None,'odesc':t.get('description:en') or t.get('description'),'enwiki':enwiki,'ele':ele,'osm':x['osm'],'heritage':bool(t.get('heritage'))})
# enrich OSM wikidata ids
need=sorted(need); WD={}
for i in range(0,len(need),50):
  j=get('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|descriptions|claims|sitelinks&languages=en&sitefilter=enwiki&ids='+'|'.join(need[i:i+50]))
  if j: WD.update(j.get('entities',{}))
for did,L in cands.items():
  for c in L:
    e=WD.get(c['qid']) if c['qid'] else None
    if not e or c['osm'] is None and False: continue
    if e and 'claims' in e:
      if not c['img'] and e['claims'].get('P18'): c['img']=e['claims']['P18'][0]['mainsnak'].get('datavalue',{}).get('value')
      if not c['wdesc']: c['wdesc']=e.get('descriptions',{}).get('en',{}).get('value')
      if not c['enwiki'] and e.get('sitelinks',{}).get('enwiki'): c['enwiki']='https://en.wikipedia.org/wiki/'+urllib.parse.quote(e['sitelinks']['enwiki']['title'].replace(' ','_'))
      lab=e.get('labels',{}).get('en',{}).get('value')
      if lab and (not c['name'] or not re.search('[a-zA-Z]',c['name'])): c['name']=lab
json.dump(cands,open('cands.json','w'))
print({k:len(v) for k,v in cands.items()})
