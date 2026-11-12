import json,re,urllib.parse,html,datetime
exec(open('build.py').read().split('D=json.load')[0])
D={d['id']:d for d in json.load(open('/workspace/barfchalo/data/destinations.json'))['destinations']}
import os;pool=json.load(open(os.environ.get('POOL','pool2.json')))
BASE={'waterfall':9,'viewpoint':8.5,'lake':8,'hot_spring':7.5,'meadow':7,'valley':7,'village':6,'monastery':6,'fort':6,'attraction':5,'walk':6,'temple':4,'glacier':3.5,'peak':3,'park':2.5,'pass':2.5,'cave':2,'bridge':3}
CAP={'viewpoint':3,'waterfall':3,'lake':2,'village':2,'temple':1,'monastery':2,'glacier':1,'peak':1,'park':1,'pass':1,'meadow':2,'valley':1,'attraction':2,'hot_spring':1,'fort':1,'cave':1,'bridge':1}
def sc(c): return BASE.get(c['type'],3)+(4 if c['img'] else 0)+(3 if c.get('enwiki') else 0)+(1.5 if c.get('qid') else 0)-c['km']*0.22
JUNK=re.compile(r"^(village neen|mountains|tempel|damp|stream|very tall waterfall|point of view|viewdeck|hot spring|ivri round about|railway board building|sardar ajit singh|(lower|upper|small|big) waterfall|seruvalsar and manimahesh lake|kambu qucain|abandand cottage|accient well|gulmarg ski resort area phase 2)$|^(\S+\s+){5,}\S+$|^view ?point,|\b(pass|ghati|col)\b.*",re.I)
REGION=re.compile(r"^(spiti|kangra|doon|lahaul|satluj|baspa|lidder|johar|tilail|piristhan|sangla|kullu|parvati|chamba|pin) valley",re.I)
DRIVE_PASS=re.compile(r"rohtang|zoji|chanshal|jalori|razdan|sinthan|nathu|kunzum|indrahar|dongkha|kupup|chopta",re.I)
def keep(c,d):
  n=c['name'].strip(); t=c['type']
  base=re.sub(r'[^a-z]','',d['name'].split(' /')[0].lower())
  if base and base in re.sub(r'[^a-z]','',n.lower()) and c['km']<4 and t in('village','attraction','valley','meadow'): return False
  if t=='park': return False
  if t=='pass' or re.search(r'\b(pass|ghati|col|la)\b',n,re.I) and t in('viewpoint','pass'):
    return bool(DRIVE_PASS.search(n))
  if JUNK.search(n): return False
  if REGION.search(n): return False
  if t=='temple' and not c.get('enwiki'): return False
  if t=='village' and c['km']>15: return False
  if n.isupper() and len(n)>12: return False
  return True
pool={k:[c for c in v if keep(c,D[k])] for k,v in pool.items()}
CANDS=json.load(open('cands.json'))
for k,v in pool.items():
  if len(v)>=4: continue
  d=D[k]; names={norm_(c['name']) for c in v} if False else {c['name'] for c in v}
  extra=[]
  for c in CANDS[k]:
    c['km']=hav(d['lat'],d['lon'],c['lat'],c['lon'])
    n=(c['name'] or '')
    if c['km']>25 or re.match(r'^Q\d+$',n) or n in names: continue
    if (c['type']=='temple' and c['img']) or (c['type']=='village' and c.get('enwiki') and c['km']<=20) or (c['type'] in('peak','lake','waterfall','viewpoint') and (c['img'] or c.get('enwiki'))):
      if c not in extra: extra.append(c); names.add(n)
  extra.sort(key=lambda c:(0 if c['img'] else 1, c['km']))
  v+=extra[:4-len(v)+1]
chosen={}
for did,L in pool.items():
  L=sorted(L,key=lambda c:-sc(c)); out=[]; cnt={}
  for relax in (0,1):
    for c in L:
      if c in out or len(out)>=8: continue
      if not relax and cnt.get(c['type'],0)>=CAP.get(c['type'],1): continue
      if relax and len(out)>=4: break
      out.append(c); cnt[c['type']]=cnt.get(c['type'],0)+1
  chosen[did]=sorted(out,key=lambda c:-sc(c))
# images
files=sorted({c['img'] for L in chosen.values() for c in L if c['img']})
II={}
for i in range(0,len(files),40):
  t='|'.join('File:'+f for f in files[i:i+40])
  j=get('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&titles='+urllib.parse.quote(t))
  if not j: continue
  norm={n['to']:n['from'] for n in j['query'].get('normalized',[])}
  for pg in j['query']['pages'].values():
    if 'imageinfo' not in pg: continue
    ii=pg['imageinfo'][0]; m=ii.get('extmetadata',{})
    lic=(m.get('LicenseShortName',{}).get('value') or '').strip()
    if not re.search(r'CC|Public domain|PD|GFDL|Attribution',lic,re.I): continue
    art=re.sub(r'<[^>]+>','',html.unescape(m.get('Artist',{}).get('value','') or 'Unknown')).strip()
    art=re.sub(r'\s+',' ',art)[:60]
    title=pg['title']; key=norm.get(title,title)[5:]
    II[key]={'src':ii.get('thumburl') or ii['url'],'page':ii['descriptionurl'],'author':art,'license':lic}
    II[title[5:]]=II[key]
TN={'viewpoint':'Viewpoint','waterfall':'Waterfall','lake':'Lake','hot_spring':'Hot spring','meadow':'Meadow','valley':'Valley','village':'Village','monastery':'Monastery','fort':'Fort','attraction':'Sight','temple':'Temple','glacier':'Glacier','peak':'Peak','park':'Protected forest area','pass':'Mountain pass','cave':'Cave','bridge':'Bridge','walk':'Walk'}
GEN=re.compile(r'^(lake|mountain|waterfall|village|glacier|mountain pass|hill|valley|peak|temple|hindu temple|wildlife sanctuary|national park|river|summit|human settlement)( in [^,]+(, ?india)?)?$',re.I)
def first_sentence(t):
  t=re.sub(r'\s*\([^()]*\)','',t).strip()
  m=re.match(r'(.+?[a-z\)]{2}\.)(\s|$)',t)
  s=m.group(1) if m else t
  if len(s)>170: s=s[:167].rsplit(' ',1)[0]+'…'
  return s
spots={}; n=0; withph=0
for did,L in chosen.items():
  d=D[did]; dn=d['name'].split(' /')[0]; arr=[]
  for c in L:
    desc=None
    if c.get('enwiki'):
      title=urllib.parse.unquote(c['enwiki'].split('/wiki/')[1])
      j=get('https://en.wikipedia.org/api/rest_v1/page/summary/'+urllib.parse.quote(title,safe=''))
      tok=[t for t in re.findall(r'[a-z]{4,}',c['name'].lower()) if t not in('lake','falls','temple','valley','peak','waterfall','glacier','pass','village')]
      if j and j.get('type')=='standard' and j.get('extract') and (not tok or any(t in j['extract'].lower() for t in tok)): desc=first_sentence(j['extract'])
      elif j and j.get('type')=='standard': c['enwiki']=None
      elif j and j.get('type')=='disambiguation': c['enwiki']=None
    if not desc and c.get('wdesc') and not GEN.match(c['wdesc'].strip()) and len(c['wdesc'])>12: desc=c['wdesc'][0].upper()+c['wdesc'][1:]+'.'
    if not desc and c.get('odesc') and len(c['odesc'])>12 and re.search('[a-z]',c['odesc']): desc=c['odesc'].strip().rstrip('.')+'.'
    if not desc:
      desc=f"{TN.get(c['type'],'Spot')} {('about '+str(round(c['km']))+' km') if c['km']>=1 else 'right'} {'from' if c['km']>=1 else 'at'} {dn}"+(f", at {c['ele']:,} m" if c.get('ele') and c['ele']>500 else '')+'.'
    ph=II.get(c['img']) if c['img'] else None
    if ph: withph+=1
    arr.append({'name':c['name'],'type':c['type'],'lat':round(c['lat'],5),'lon':round(c['lon'],5),'km':round(c['km'],1),'ele':c.get('ele') if c.get('ele') and c['ele']>500 else None,
      'desc':desc,'photo':ph,'wiki':c.get('enwiki'),'osm':('https://www.openstreetmap.org/'+c['osm']) if c.get('osm') else None,'wikidata':c.get('qid')})
    n+=1
  spots[did]=arr
out={'generated':datetime.date.today().isoformat(),
 'sources':'OpenStreetMap (© OpenStreetMap contributors, ODbL; Geofabrik extract 2026-11-11), Wikidata (CC0), Wikipedia summaries (CC BY-SA), photos Wikimedia Commons (licence per photo)',
 'spots':spots}
json.dump(out,open('/workspace/barfchalo/data/explore.json','w'),ensure_ascii=False,separators=(',',':'))
print('spots',n,'with photo',withph,'dests',len(spots),'min',min(len(v) for v in spots.values()))
for did,v in spots.items(): print(did,len(v),sum(1 for x in v if x['photo']),'|',', '.join(f"{x['name']}({x['type'][:4]})" for x in v))
