import json,urllib.request,urllib.parse,time,os
D=json.load(open('/workspace/barfchalo/data/destinations.json'))['destinations']
os.makedirs('wd',exist_ok=True)
CL={"Q6017969":"viewpoint","Q34038":"waterfall","Q23397":"lake","Q9430":"lake","Q211302":"lake","Q35666":"glacier","Q133056":"pass","Q177380":"hot_spring","Q39816":"valley","Q570116":"attraction","Q57821":"fort","Q46169":"park","Q35509":"cave","Q160742":"monastery","Q842402":"temple","Q44539":"temple","Q532":"village","Q8502":"peak","Q54050":"peak","Q207326":"peak","Q1144661":"park","Q473972":"park","Q2143825":"walk","Q190429":"meadow","Q1640628":"meadow","Q2659904":"park","Q1107656":"attraction","Q22698":"park","Q15324":"lake","Q12280":"bridge","Q4022":"river","Q3240715":"lake"}
vals=" ".join("wd:"+k for k in CL)
for d in D:
  fn=f"wd/{d['id']}.json"
  if os.path.exists(fn): continue
  q=f"""SELECT ?i ?iLabel ?iDescription ?cls ?img ?coord ?dist ?art ?ele ?sl WHERE {{
  SERVICE wikibase:around {{ ?i wdt:P625 ?coord . bd:serviceParam wikibase:center "Point({d['lon']} {d['lat']})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "25" . bd:serviceParam wikibase:distance ?dist . }}
  ?i wdt:P31 ?cls . VALUES ?cls {{ {vals} }}
  OPTIONAL {{ ?i wdt:P18 ?img }} OPTIONAL {{ ?i wdt:P2044 ?ele }}
  OPTIONAL {{ ?art schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> }}
  OPTIONAL {{ ?i wikibase:sitelinks ?sl }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }} }}"""
  for k in range(3):
    try:
      r=urllib.request.urlopen(urllib.request.Request("https://query.wikidata.org/sparql?"+urllib.parse.urlencode({'query':q,'format':'json'}),headers={'User-Agent':'BarfChalo/1.0 (https://sahilfarooqui.github.io/barfchalo/; jcb86193@mail.grokbot.com)'}),timeout=90).read()
      j=json.loads(r)['results']['bindings']; open(fn,'w').write(json.dumps(j)); print(d['id'],len(j),flush=True); break
    except Exception as e: print('err',d['id'],e,flush=True); time.sleep(8)
  time.sleep(1.5)
