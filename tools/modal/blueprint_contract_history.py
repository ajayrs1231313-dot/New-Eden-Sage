from __future__ import annotations
import gzip,json,math,os,statistics
from collections import defaultdict
from datetime import datetime,timedelta,timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION=2
DEFAULT_RETENTION_DAYS=120
DERIVED_CACHE_NAME="blueprint-contract-index-v2.json.gz"
EVIDENCE_BASIS="retained public contract asking-price evidence"
MAX_MATERIAL_EFFICIENCY=10
MAX_TIME_EFFICIENCY=20
MARKET_CLUSTER_TOLERANCE=.20
MIN_CLEAR_CLUSTER_SAMPLES=2
EXTREMELY_CLOSE_RESEARCH_DISTANCE=.10
NEARBY_RESEARCH_DISTANCE=.30

def _utc_now(): return datetime.now(timezone.utc)
def _parse_time(v):
    if not v:return None
    try:
        d=datetime.fromisoformat(str(v).replace("Z","+00:00"));return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError,ValueError):return None
def _iso(v): return v.astimezone(timezone.utc).isoformat().replace("+00:00","Z") if v else None
def _finite(v):
    try:n=float(v)
    except (TypeError,ValueError):return None
    return n if math.isfinite(n) else None
def _integer(v,fallback=None):
    n=_finite(v);return int(n) if n is not None else fallback
def _load(path,fallback=None):
    try:
        with gzip.open(path,"rt",encoding="utf-8") as h:return json.load(h)
    except (OSError,json.JSONDecodeError):return fallback
def _write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);partial=path.with_name(f"{path.name}.{os.getpid()}.partial")
    with gzip.open(partial,"wt",encoding="utf-8",compresslevel=6) as h:json.dump(value,h,separators=(",",":"))
    os.replace(partial,path)
def _history_files(root,days,now):
    src=root/"public-contracts"
    if not src.is_dir():return []
    cutoff=(now-timedelta(days=days)).date().isoformat();out=[]
    for day in sorted(src.iterdir()):
        if day.is_dir() and day.name>=cutoff:out.extend(sorted(x for x in day.glob("*.json.gz") if x.is_file()))
    return out
def _iter_checkpoint(data):
    for region in data.get("regions") or []:
        if isinstance(region,dict):
            rid=_integer(region.get("regionId"),0) or 0
            for c in region.get("publicContracts") or []:
                if isinstance(c,dict):yield rid,c

def _identity(item):
    tid=_integer(item.get("typeId"),0) or 0;me=_integer(item.get("materialEfficiency"));te=_integer(item.get("timeEfficiency"))
    if tid<=0:return None,"invalid-type-id"
    if me is None or te is None:return None,"missing-blueprint-research"
    flag=item.get("isBlueprintCopy")
    if flag is True:kind="BPC"
    elif flag is False or flag is None:kind="BPO"
    else:return None,"invalid-blueprint-copy-flag"
    runs=_integer(item.get("runs"))
    if kind=="BPC" and (runs is None or runs<=0):return None,"bpc-missing-positive-runs"
    return (tid,kind,me,te,runs if kind=="BPC" else None),"accepted"

def classify_blueprint_contract(contract,region_id=0,observed_at=""):
    ctype=str(contract.get("contractType") or "")
    if ctype!="item_exchange":return None,f"contract-type:{ctype or 'missing'}"
    price=_finite(contract.get("price"))
    if price is None or price<=0:return None,"non-positive-or-invalid-price"
    items=contract.get("items")
    if not isinstance(items,list):return None,"items-not-loaded"
    if contract.get("itemsPending") is True:return None,"items-pending"
    if any(isinstance(x,dict) and x.get("included") is False for x in items):return None,"requested-items"
    inc=[x for x in items if isinstance(x,dict) and x.get("included") is True]
    if not inc:return None,"no-included-items"
    identity=None;qty=0
    for item in inc:
        cur,reason=_identity(item)
        if cur is None:return None,f"ambiguous-included-item:{reason}"
        if identity is None:identity=cur
        elif cur!=identity:return None,"mixed-or-ambiguous-included-items"
        q=_integer(item.get("quantity"),0) or 0
        if q<=0:return None,"non-positive-included-quantity"
        qty+=q
    cid=_integer(contract.get("contractId"),0) or 0
    if cid<=0:return None,"invalid-contract-id"
    tid,kind,me,te,runs=identity
    return {"contractId":cid,"typeId":tid,"blueprintKind":kind,"materialEfficiency":me,"timeEfficiency":te,"runs":runs,"price":price/qty,"contractPrice":price,"priceableUnitQuantity":qty,"regionId":region_id,"contractType":ctype,"issuedAt":contract.get("dateIssued") or None,"expiresAt":contract.get("expires") or None,"firstSeenAt":observed_at,"lastSeenAt":observed_at,"removedAt":None,"activeAtLastObservation":True,"evidenceBasis":EVIDENCE_BASIS},"accepted"
def _clean_blueprint_sample(c,r,o):return classify_blueprint_contract(c,r,o)[0]
def _upsert(samples,s):
    k=str(s["contractId"]);cur=samples.get(k)
    if cur is None:samples[k]=s;return
    first=min(str(cur.get("firstSeenAt") or s["firstSeenAt"]),str(s["firstSeenAt"]))
    samples[k]={**cur,**s,"firstSeenAt":first,"lastSeenAt":max(str(cur.get("lastSeenAt") or s["lastSeenAt"]),str(s["lastSeenAt"])),"removedAt":cur.get("removedAt"),"activeAtLastObservation":cur.get("removedAt") is None}
def _apply(samples,payload):
    obs=str(payload.get("observedAt") or "");data=payload.get("data")
    if not obs or not isinstance(data,dict):return
    kind=str(data.get("kind") or "")
    if kind=="checkpoint":
        for rid,c in _iter_checkpoint(data):
            s=_clean_blueprint_sample(c,rid,obs)
            if s:_upsert(samples,s)
    elif kind=="delta":
        for c in data.get("upserts") or []:
            if isinstance(c,dict):
                s=_clean_blueprint_sample(c,_integer(c.get("regionId"),0) or 0,obs)
                if s:_upsert(samples,s)
        for cid in data.get("removedContractIds") or []:
            cur=samples.get(str(_integer(cid,0) or 0))
            if cur:cur["removedAt"]=obs;cur["activeAtLastObservation"]=False;cur["lastSeenAt"]=max(str(cur.get("lastSeenAt") or obs),obs)
def _cache_path(root):return root/"_derived"/DERIVED_CACHE_NAME
def _load_cache(root):
    v=_load(_cache_path(root));return v if isinstance(v,dict) and v.get("schemaVersion")==SCHEMA_VERSION else None
def build_or_update_index(history_root,retention_days=DEFAULT_RETENTION_DAYS,now=None,force_rebuild=False):
    root=Path(history_root);current=now or _utc_now();days=max(1,int(retention_days));files=_history_files(root,days,current);rels=[x.relative_to(root).as_posix() for x in files]
    cached=None if force_rebuild else _load_cache(root);samples={};start=0;state="rebuild"
    if cached and cached.get("retentionDays")==days and isinstance(cached.get("samples"),dict):
        last=str(cached.get("lastHistoryFile") or "");samples={str(k):v for k,v in cached["samples"].items() if isinstance(v,dict)};state="incremental"
        if last:
            start=next((i+1 for i,n in enumerate(rels) if n==last),0)
            if start==0 and rels and last>=rels[0]:samples={};state="rebuild"
    processed=0
    for f in files[start:]:
        v=_load(f)
        if isinstance(v,dict):_apply(samples,v)
        processed+=1
    cutoff=current-timedelta(days=days)
    for k in list(samples):
        if (_parse_time(samples[k].get("lastSeenAt")) or datetime.min.replace(tzinfo=timezone.utc))<cutoff:del samples[k]
    times=[_parse_time(x.get("lastSeenAt")) for x in samples.values()];times=[x for x in times if x]
    firsts=[_parse_time(x.get("firstSeenAt")) for x in samples.values()];firsts=[x for x in firsts if x]
    out={"schemaVersion":SCHEMA_VERSION,"builtAt":_iso(current),"retentionDays":days,"lastHistoryFile":rels[-1] if rels else None,"sourceFileCount":len(rels),"processedFilesThisBuild":processed,"prunedSamplesThisBuild":0,"sampleCount":len(samples),"oldestRetainedAt":_iso(min(firsts)) if firsts else None,"newestRetainedAt":_iso(max(times)) if times else None,"cacheState":state,"samples":samples}
    _write(_cache_path(root),out);return out


def robust_price_statistics(samples):
    priced=[(s,_finite(s.get("price"))) for s in samples];priced=[(s,float(v)) for s,v in priced if v is not None and v>0];priced.sort(key=lambda x:(x[1],_integer(x[0].get("contractId"),0) or 0))
    if not priced:return {"samples":[],"sampleCount":0,"midpointValue":None,"medianValue":None,"trimmedMeanValue":None,"minValue":None,"maxValue":None,"outlierCount":0}

    kept=list(priced)
    # A robust median establishes the market centre without letting a handful of absurd listings
    # drag the centre toward themselves. Re-apply the +/-20% band until membership stabilizes.
    # Only accept a filter pass when it leaves a clear cluster: at least two samples and at
    # least half of the currently considered market. Otherwise the market is too sparse/split
    # to justify throwing prices away as outliers.
    while len(kept)>=3:
        centre=float(statistics.median([x[1] for x in kept]))
        lower=centre*(1.0-MARKET_CLUSTER_TOLERANCE);upper=centre*(1.0+MARKET_CLUSTER_TOLERANCE)
        clustered=[x for x in kept if lower<=x[1]<=upper]
        minimum_clear=max(MIN_CLEAR_CLUSTER_SAMPLES,(len(kept)+1)//2)
        if len(clustered)<minimum_clear or len(clustered)==len(kept):break
        kept=clustered

    vals=[x[1] for x in kept];lo=min(vals);hi=max(vals)
    return {"samples":[x[0] for x in kept],"sampleCount":len(vals),"midpointValue":(lo+hi)/2,"medianValue":statistics.median(vals),"trimmedMeanValue":statistics.fmean(vals),"minValue":lo,"maxValue":hi,"outlierCount":len(priced)-len(kept)}

def _normalized_query(q):
    tid=_integer(q.get("typeId"),0) or 0;kind=str(q.get("blueprintKind") or "").upper();me=_integer(q.get("materialEfficiency"));te=_integer(q.get("timeEfficiency"));runs=_integer(q.get("runs"))
    if tid<=0:raise ValueError("typeId must be a positive integer")
    if kind not in {"BPO","BPC"}:raise ValueError("blueprintKind must be BPO or BPC")
    if me is None or te is None:raise ValueError("materialEfficiency and timeEfficiency are required")
    if kind=="BPC" and (runs is None or runs<=0):raise ValueError("BPC queries require a positive runs value")
    return {"typeId":tid,"blueprintKind":kind,"materialEfficiency":me,"timeEfficiency":te,"runs":runs if kind=="BPC" else None}
def validate_query_payload(payload,retention_days=DEFAULT_RETENTION_DAYS):
    if not isinstance(payload,dict):raise ValueError("request body must be an object")
    qs=payload.get("queries")
    if not isinstance(qs,list) or not qs:raise ValueError("queries must be a non-empty array")
    if len(qs)>250:raise ValueError("at most 250 blueprint queries are allowed per request")
    norm=[_normalized_query(x) for x in qs if isinstance(x,dict)]
    if len(norm)!=len(qs):raise ValueError("every query must be an object")
    look=_integer(payload.get("lookbackDays"),retention_days) or retention_days
    return {"queries":norm,"lookbackDays":max(1,min(int(retention_days),look))}
def _same(sample,q):
    if sample.get("typeId")!=q["typeId"] or sample.get("blueprintKind")!=q["blueprintKind"]:return False
    return q["blueprintKind"]=="BPO" or sample.get("runs")==q["runs"]
def _exact(sample,q):return _same(sample,q) and sample.get("materialEfficiency")==q["materialEfficiency"] and sample.get("timeEfficiency")==q["timeEfficiency"]
def research_progress(me,te):return (max(0,min(1,me/MAX_MATERIAL_EFFICIENCY))+max(0,min(1,te/MAX_TIME_EFFICIENCY)))/2
def _distance(me,te,q):return (abs(me-q["materialEfficiency"])/MAX_MATERIAL_EFFICIENCY+abs(te-q["timeEfficiency"])/MAX_TIME_EFFICIENCY)/2
def _confidence(match,n):
    if n<=0:return "none"
    if match=="exact":return "high" if n>=5 else "medium" if n>=2 else "low"
    if match=="research-interpolation":return "medium" if n>=4 else "low"
    if match=="extremely-close":return "medium" if n>=2 else "low"
    return "low"
def _dates(samples):
    v=[_parse_time(s.get("issuedAt")) or _parse_time(s.get("firstSeenAt")) for s in samples];return [x for x in v if x]
def _removed(samples):
    n=0
    for s in samples:
        r=_parse_time(s.get("removedAt"));e=_parse_time(s.get("expiresAt"))
        if r and e and r<e:n+=1
    return n

def _query_one(samples,q,lookback,now):
    cutoff=now-timedelta(days=lookback);eligible=[s for s in samples if _same(s,q) and (_parse_time(s.get("lastSeenAt")) or datetime.min.replace(tzinfo=timezone.utc))>=cutoff]
    exact=[s for s in eligible if _exact(s,q)];other=[s for s in eligible if not _exact(s,q)];estats=robust_price_statistics(exact);groups=defaultdict(list)
    for s in other:
        me=_integer(s.get("materialEfficiency"));te=_integer(s.get("timeEfficiency"))
        if me is not None and te is not None:groups[(me,te)].append(s)
    gstats={k:robust_price_statistics(v) for k,v in groups.items()};rank=sorted(((_distance(k[0],k[1],q),-v["sampleCount"],k,v) for k,v in gstats.items() if v["sampleCount"]),key=lambda x:(x[0],x[1],x[2]));nearest=rank[0] if rank else None
    nearest_stats=robust_price_statistics([sample for row in rank if nearest and abs(row[0]-nearest[0])<1e-12 for sample in row[3]["samples"]]) if nearest else robust_price_statistics([])
    estimated=None;selected=robust_price_statistics([]);sel=[];match="none";source="no-contract-history";base=maxanchor=premium=fraction=None;comp=0
    if estats["sampleCount"]:
        selected=estats;sel=estats["samples"];estimated=estats["midpointValue"];match="exact";source="bpc-contract-history" if q["blueprintKind"]=="BPC" else "contract-history-exact"
    elif nearest and nearest[0]<=EXTREMELY_CLOSE_RESEARCH_DISTANCE:
        selected=nearest_stats;sel=selected["samples"];estimated=selected["midpointValue"];match="extremely-close";comp=selected["sampleCount"];source="bpc-contract-history" if q["blueprintKind"]=="BPC" else "contract-history-comparable"
    else:
        bs=gstats.get((0,0),robust_price_statistics([]));ms=gstats.get((MAX_MATERIAL_EFFICIENCY,MAX_TIME_EFFICIENCY),robust_price_statistics([]))
        if q["blueprintKind"]=="BPO" and ms["sampleCount"]:
            maxanchor=float(ms["midpointValue"]);fraction=research_progress(q["materialEfficiency"],q["timeEfficiency"]);selected=ms;sel=ms["samples"];estimated=maxanchor;match="max-research-reference";comp=selected["sampleCount"];source="contract-history-comparable"
        elif q["blueprintKind"]=="BPC" and bs["sampleCount"] and ms["sampleCount"]:
            base=float(bs["midpointValue"]);maxanchor=float(ms["midpointValue"])
            if maxanchor>=base:
                fraction=research_progress(q["materialEfficiency"],q["timeEfficiency"]);premium=maxanchor-base;estimated=base+premium*fraction;sel=list(bs["samples"])+list(ms["samples"]);vals=[float(s["price"]) for s in sel];selected={"samples":sel,"sampleCount":len(sel),"midpointValue":estimated,"medianValue":statistics.median(vals),"trimmedMeanValue":statistics.fmean(vals),"minValue":min(vals),"maxValue":max(vals),"outlierCount":bs["outlierCount"]+ms["outlierCount"]};match="research-interpolation";comp=len(sel);source="bpc-contract-history"
        if estimated is None and nearest and nearest[0]<=NEARBY_RESEARCH_DISTANCE:
            selected=nearest_stats;sel=selected["samples"];estimated=selected["midpointValue"];match="nearby";comp=selected["sampleCount"];source="bpc-contract-history" if q["blueprintKind"]=="BPC" else "contract-history-comparable"
    ds=_dates(sel)
    return {**q,"estimatedValue":estimated,"calculatedMidpointValue":selected["midpointValue"],"medianValue":selected["medianValue"],"trimmedMeanValue":selected["trimmedMeanValue"],"minValue":selected["minValue"],"maxValue":selected["maxValue"],"lowestAcceptedPrice":selected["minValue"],"highestAcceptedPrice":selected["maxValue"],"sampleCount":selected["sampleCount"],"rawExactMatchCount":len(exact),"rawComparableMatchCount":len(other),"exactMatchCount":estats["sampleCount"],"comparableMatchCount":comp,"outlierCount":selected["outlierCount"],"rejectedOutlierCount":selected["outlierCount"],"confidence":_confidence(match,selected["sampleCount"]),"researchMatch":match,"researchMatchType":match,"runsMatch":q["blueprintKind"]=="BPO" or all(s.get("runs")==q["runs"] for s in sel),"baseBlueprintValue":base,"maxResearchAnchor":maxanchor,"derivedResearchPremium":premium,"appliedResearchFraction":fraction,"lookbackDays":lookback,"newestSampleAt":_iso(max(ds)) if ds else None,"oldestSampleAt":_iso(min(ds)) if ds else None,"removedBeforeExpiryCount":_removed(sel),"valuationSource":source,"evidenceBasis":EVIDENCE_BASIS,"observedSaleEvidence":False,"evidenceNote":"Retained CCP public-contract asking-price evidence; a removed or expired listing is not treated as proof of a completed sale."}


def query_blueprint_valuations(history_root,payload,retention_days=DEFAULT_RETENTION_DAYS,now=None):
    current=now or _utc_now();norm=validate_query_payload(payload,retention_days);index=build_or_update_index(history_root,retention_days=retention_days,now=current);samples=list(index.get("samples",{}).values());results=[_query_one(samples,q,norm["lookbackDays"],current) for q in norm["queries"]]
    return {"schemaVersion":SCHEMA_VERSION,"generatedAt":_iso(current),"historyRevision":str(index.get("lastHistoryFile") or "empty"),"historyRetentionDays":int(retention_days),"historyOldestRetainedAt":index.get("oldestRetainedAt"),"historyNewestRetainedAt":index.get("newestRetainedAt"),"historySampleCount":index.get("sampleCount",0),"cacheState":index.get("cacheState","unknown"),"evidenceBasis":EVIDENCE_BASIS,"observedSaleEvidence":False,"results":results}
