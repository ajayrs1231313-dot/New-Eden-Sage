import { FormEvent, useEffect, useMemo, useState } from "react";

type SystemHit = { systemId:number; name:string; regionName:string; constellationName:string; securityStatus:number };
type Activity = { shipKills:number; podKills:number; npcKills:number; jumps:number };
type Risk = {
  coverage:"complete"|"partial"|"none";
  cachedKills30d:number;
  miningLosses30d:number;
  topMiningGankCorporationId:number|null;
  topMiningGankKillmails:number;
  topMiningGankShare:number;
  repeatedMiningGankPattern:boolean;
};
type Candidate = {
  score:number;
  confidence:"high"|"partial"|"structural";
  risk:"low"|"moderate"|"high"|"unknown";
  system:{systemId:number;name:string;regionName:string;constellationName:string;securityStatus:number;displayedSecurityStatus:number;stationCount:number;moonCount:number};
  ice:{systemId:number;name:string;jumps:number;securityStatus:number;displayedSecurityStatus:number;stationCount:number;moonCount:number};
  pairMoonCount:number;
  relocation:{jumps:number|null;highSecOnly:boolean;routeFound:boolean};
  current:{home:Activity;ice:Activity};
  intel:{home:Risk;ice:Risk};
  reasons:string[];
};
type Result = { generatedAt:string; candidateCount:number; candidates:Candidate[]; filters:any; iceReference:{source:string;reviewedAt:string;systemCount:number} };

type Props = { corporation:any | null };

const WATCHED_KEY = "new-eden-sage-watched-systems";
const RESULT_BATCH_SIZE = 8;

function number(value:number) { return new Intl.NumberFormat("en-GB").format(Number(value ?? 0)); }
function percent(value:number) { return `${Math.round(Number(value ?? 0) * 100)}%`; }
function riskLabel(value:Candidate["risk"]) { return value === "unknown" ? "Intel unknown" : `${value[0].toUpperCase()}${value.slice(1)} risk`; }

export function CorporationFindHome({ corporation }:Props) {
  const sage = window.sage as any;
  const snapshotOriginId = Number(corporation?.snapshot?.location?.solar_system_id ?? 0) || null;
  const snapshotOriginName = String(corporation?.snapshot?.location?.solar_system_name ?? "");
  const [origin, setOrigin] = useState<{systemId:number;name:string}|null>(() => snapshotOriginId ? { systemId:snapshotOriginId, name:snapshotOriginName || `System ${snapshotOriginId}` } : null);
  const [originQuery, setOriginQuery] = useState("");
  const [originHits, setOriginHits] = useState<SystemHit[]>([]);
  const [minSecurity, setMinSecurity] = useState(0.45);
  const [maxSecurity, setMaxSecurity] = useState(0.55);
  const [minMoons, setMinMoons] = useState(20);
  const [minStations, setMinStations] = useState(1);
  const [maxIceJumps, setMaxIceJumps] = useState(1);
  const [maxRelocationJumps, setMaxRelocationJumps] = useState(50);
  const [highSecRouteOnly, setHighSecRouteOnly] = useState(true);
  const [result, setResult] = useState<Result|null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState<number|null>(null);
  const [message, setMessage] = useState("Set the constraints Sage should use to rank corporation homes.");
  const [visibleCount, setVisibleCount] = useState(RESULT_BATCH_SIZE);

  useEffect(() => {
    if (!origin && snapshotOriginId) setOrigin({ systemId:snapshotOriginId, name:snapshotOriginName || `System ${snapshotOriginId}` });
  }, [snapshotOriginId, snapshotOriginName]);

  const finderInput = useMemo(() => ({
    originSystemId:origin?.systemId ?? null,
    minSecurity,
    maxSecurity,
    minMoons,
    minStations,
    maxIceJumps,
    maxRelocationJumps,
    highSecRouteOnly,
    limit:40,
  }), [origin, minSecurity, maxSecurity, minMoons, minStations, maxIceJumps, maxRelocationJumps, highSecRouteOnly]);

  async function runFinder(showStatus = true) {
    if (showStatus) setMessage("Ranking corporation-home candidates…");
    setBusy(true);
    try {
      const value = await sage.findCorporationHomes(finderInput);
      const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
      setResult(value);
      setVisibleCount(Math.min(RESULT_BATCH_SIZE, candidates.length));
      if (showStatus) setMessage(`Found ${number(value?.candidateCount ?? 0)} matching systems. Showing the first ${number(Math.min(RESULT_BATCH_SIZE, candidates.length))} of the top ${number(candidates.length)} ranked candidates.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Home finder failed.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    setResult(null);
    setVisibleCount(RESULT_BATCH_SIZE);
    setMessage(origin ? "Filters ready. Rank homes when you want Sage to run the search." : "Choose an origin system, then rank homes.");
  }, [finderInput]);

  useEffect(() => {
    if (typeof sage.onSystemKillmailsUpdated !== "function") return;
    return sage.onSystemKillmailsUpdated((payload:any) => {
      if (!result?.candidates?.length) return;
      const visibleIds = new Set(result.candidates.flatMap((candidate) => [candidate.system.systemId, candidate.ice.systemId]));
      if (!(payload?.systemIds ?? []).some((id:any) => visibleIds.has(Number(id)))) return;
      setMessage("System News intel changed for ranked systems. Refresh the ranking when you are ready.");
    });
  }, [result?.generatedAt]);

  async function searchOrigin(event?:FormEvent) {
    event?.preventDefault();
    const query = originQuery.trim();
    if (!query) { setOriginHits([]); return; }
    try { setOriginHits(await sage.searchSolarSystems(query, 12)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Origin search failed."); }
  }

  function chooseOrigin(hit:SystemHit) {
    setOrigin({ systemId:hit.systemId, name:hit.name });
    setOriginQuery("");
    setOriginHits([]);
  }

  async function deepScan(candidate:Candidate) {
    setScanning(candidate.system.systemId);
    setMessage(`Queueing a full 30-day System News scan for ${candidate.system.name}${candidate.ice.systemId === candidate.system.systemId ? "" : ` and ${candidate.ice.name}`}…`);
    try {
      const ids = [...new Set([candidate.system.systemId, candidate.ice.systemId])];
      const response = await sage.scanCorporationHomeCandidate({ systemIds:ids });
      const status = response?.killmailRefresh;
      if ((status?.queuedBackfills ?? 0) > 0) {
        setMessage(`Scan accepted. ${status.queuedBackfills} 30-day backfill request${status.queuedBackfills === 1 ? "" : "s"} queued. Results stay responsive while System News fills the cache; refresh the ranking when the scan updates arrive.`);
      } else {
        setMessage("Candidate intelligence refreshed. Re-ranking with the latest cache.");
        await runFinder(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Candidate scan failed.");
    } finally { setScanning(null); }
  }

  function watchPair(candidate:Candidate) {
    let watched:Array<{systemId:number;name:string}> = [];
    try { const parsed = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? "[]"); watched = Array.isArray(parsed) ? parsed : []; } catch { watched = []; }
    const byId = new Map(watched.map((item) => [Number(item.systemId), item]));
    byId.set(candidate.system.systemId, { systemId:candidate.system.systemId, name:candidate.system.name });
    byId.set(candidate.ice.systemId, { systemId:candidate.ice.systemId, name:candidate.ice.name });
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...byId.values()]));
    setMessage(`${candidate.system.name}${candidate.ice.systemId === candidate.system.systemId ? "" : ` + ${candidate.ice.name}`} added to System News watched systems.`);
  }

  const top = result?.candidates?.[0] ?? null;
  const visibleCandidates = result?.candidates.slice(0, visibleCount) ?? [];

  return <div className="corp-home-finder">
    <div className="home-finder-head">
      <div>
        <p className="eyebrow">CORPORATION · RELOCATION INTELLIGENCE</p>
        <h2>Find a Home</h2>
        <p>Rank high-sec corporation bases using the CCP universe graph, NPC stations, moon density, confirmed ice-system proximity, relocation safety, live ESI traffic and Sage&apos;s retained System News killmail history.</p>
      </div>
      {top && <div className="home-best-callout"><span>{top.confidence === "structural" ? "BEST STRUCTURAL MATCH" : "BEST CURRENT MATCH"}</span><strong>{top.system.name}</strong><small>{top.score}/100 · {top.ice.jumps === 0 ? "ice in system" : `${top.ice.name} ${top.ice.jumps} jump away`}</small></div>}
    </div>

    <div className="home-origin-panel">
      <div className="home-origin-current"><span>RELOCATION ORIGIN</span><strong>{origin?.name ?? "Not set"}</strong><small>{origin ? `System ${origin.systemId}` : "Choose a system to calculate relocation distance."}</small></div>
      <form onSubmit={searchOrigin}><input value={originQuery} onChange={(event) => { setOriginQuery(event.target.value); if (!event.target.value) setOriginHits([]); }} placeholder="Change origin system…"/><button>Search</button></form>
      {originHits.length > 0 && <div className="home-origin-results">{originHits.map((hit) => <button key={hit.systemId} type="button" onClick={() => chooseOrigin(hit)}><strong>{hit.name}</strong><span>{hit.regionName} · {hit.securityStatus.toFixed(3)}</span></button>)}</div>}
    </div>

    <div className="home-filter-grid">
      <label><span>Raw security min</span><input type="number" min="-1" max="1" step="0.01" value={minSecurity} onChange={(e) => setMinSecurity(Number(e.target.value))}/></label>
      <label><span>Raw security max</span><input type="number" min="-1" max="1" step="0.01" value={maxSecurity} onChange={(e) => setMaxSecurity(Number(e.target.value))}/></label>
      <label><span>Minimum moons</span><input type="number" min="0" max="200" value={minMoons} onChange={(e) => setMinMoons(Number(e.target.value))}/></label>
      <label><span>NPC stations</span><input type="number" min="0" max="50" value={minStations} onChange={(e) => setMinStations(Number(e.target.value))}/></label>
      <label><span>Ice within gates</span><input type="number" min="0" max="5" value={maxIceJumps} onChange={(e) => setMaxIceJumps(Number(e.target.value))}/></label>
      <label><span>Max relocation jumps</span><input type="number" min="0" max="200" value={maxRelocationJumps} onChange={(e) => setMaxRelocationJumps(Number(e.target.value))}/></label>
      <label className="home-toggle"><input type="checkbox" checked={highSecRouteOnly} onChange={(e) => setHighSecRouteOnly(e.target.checked)}/><span>High-sec-only relocation route</span></label>
      <button className="home-rank-button" onClick={() => void runFinder()} disabled={busy}>{busy ? "Ranking…" : "Rank homes"}</button>
    </div>

    {result && <div className="home-finder-summary">
      <div><span>Matches</span><strong>{number(result.candidateCount)}</strong></div>
      <div><span>Ice systems referenced</span><strong>{number(result.iceReference.systemCount)}</strong></div>
      <div><span>Ice list reviewed</span><strong>{new Date(result.iceReference.reviewedAt + "T00:00:00Z").toLocaleDateString()}</strong></div>
      <div><span>Risk model</span><strong>30-day System News</strong></div>
    </div>}

    <div className="home-candidate-list">
      {visibleCandidates.map((candidate, index) => {
        const sameIce = candidate.system.systemId === candidate.ice.systemId;
        const combinedKills = candidate.intel.home.cachedKills30d + (sameIce ? 0 : candidate.intel.ice.cachedKills30d);
        const miningLosses = candidate.intel.home.miningLosses30d + (sameIce ? 0 : candidate.intel.ice.miningLosses30d);
        const currentKills = candidate.current.home.shipKills + (sameIce ? 0 : candidate.current.ice.shipKills);
        const repeatedCorp = candidate.intel.home.repeatedMiningGankPattern ? candidate.intel.home : candidate.intel.ice.repeatedMiningGankPattern ? candidate.intel.ice : null;
        return <article className={`home-candidate risk-${candidate.risk}`} key={candidate.system.systemId}>
          <div className="home-candidate-rank"><span>#{index + 1}</span><strong>{candidate.score}</strong><small>SAGE SCORE</small></div>
          <div className="home-candidate-main">
            <div className="home-candidate-title">
              <div><p className="eyebrow">{candidate.system.regionName} · {candidate.system.constellationName}</p><h3>{candidate.system.name}</h3><span>{candidate.system.securityStatus.toFixed(3)} true sec · displays {candidate.system.displayedSecurityStatus.toFixed(1)}</span></div>
              <div className="home-risk-badges"><em className={`risk ${candidate.risk}`}>{riskLabel(candidate.risk)}</em><em>{candidate.confidence === "high" ? "30d intel complete" : candidate.confidence === "partial" ? "partial killmail intel" : "deep scan needed"}</em></div>
            </div>
            <div className="home-stat-grid">
              <div><span>NPC stations</span><strong>{candidate.system.stationCount}</strong></div>
              <div><span>Home moons</span><strong>{candidate.system.moonCount}</strong></div>
              <div><span>Pair moons</span><strong>{candidate.pairMoonCount}</strong></div>
              <div><span>Relocation</span><strong>{candidate.relocation.jumps == null ? "—" : `${candidate.relocation.jumps} jumps`}</strong><small>{candidate.relocation.highSecOnly ? "high-sec only" : "shortest gate route"}</small></div>
              <div><span>Ice access</span><strong>{sameIce ? "In system" : `${candidate.ice.jumps} jump · ${candidate.ice.name}`}</strong><small>{sameIce ? `${candidate.system.moonCount} moons here` : `${candidate.ice.moonCount} moons in ice system`}</small></div>
              <div><span>Current PvP</span><strong>{currentKills} ship kills</strong><small>{number(candidate.current.home.jumps + (sameIce ? 0 : candidate.current.ice.jumps))} recent jumps</small></div>
              <div><span>Cached kills · 30d</span><strong>{combinedKills}</strong><small>{candidate.confidence === "structural" ? "coverage incomplete" : "retained System News"}</small></div>
              <div><span>Mining losses · 30d</span><strong>{miningLosses}</strong><small>{repeatedCorp ? `repeat corp ${repeatedCorp.topMiningGankKillmails} kills · ${percent(repeatedCorp.topMiningGankShare)}` : "no concentrated gank signature"}</small></div>
            </div>
            <div className="home-reasons">{candidate.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
            <div className="home-candidate-actions"><button onClick={() => void deepScan(candidate)} disabled={scanning != null}>{scanning === candidate.system.systemId ? "Scanning…" : "Deep scan 30 days"}</button><button onClick={() => watchPair(candidate)}>Watch pair in System News</button></div>
          </div>
        </article>;
      })}
      {result && result.candidates.length > visibleCandidates.length && <div className="home-batch-controls">
        <span>Showing {number(visibleCandidates.length)} of {number(result.candidates.length)} ranked candidates</span>
        <button type="button" onClick={() => setVisibleCount((current) => Math.min(result.candidates.length, current + RESULT_BATCH_SIZE))}>Load next {number(Math.min(RESULT_BATCH_SIZE, result.candidates.length - visibleCandidates.length))}</button>
      </div>}
            {result && !result.candidates.length && <div className="system-empty">No systems match those constraints. Widen the security range, lower the moon requirement, allow another ice jump, or increase the relocation radius.</div>}
    </div>
    <div className="system-status">{message}</div>
  </div>;
}
