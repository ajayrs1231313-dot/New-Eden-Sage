import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PveLocationAnalysis, PveLocationKind, PveLocationOpportunity } from "./types";
import { IskGlyph } from "./IskIcons";
import "./pve-task8.css";

type KindFilter = "all" | PveLocationKind;
type SecurityFilter = "all" | "high" | "low" | "null";
type SortMode = "score" | "jumps" | "safety" | "npc" | "traffic";
type LocationArchetype = "highsec" | "lowsec" | "nullsec" | "wormhole" | "abyssal";

const kindLabels: Record<PveLocationKind, string> = {
  incursion: "Incursion",
  "mission-staging": "Mission staging",
  "ded-search": "DED / combat search",
  "lowsec-ratting": "Low-sec ratting",
  "nullsec-ratting": "Null-sec ratting",
};

const kindShortLabels: Record<PveLocationKind, string> = {
  incursion: "Incursions",
  "mission-staging": "Missions",
  "ded-search": "DED / Combat",
  "lowsec-ratting": "Low-sec",
  "nullsec-ratting": "Null-sec",
};

const archetypeIconUrls: Record<LocationArchetype, string> = {
  highsec: new URL("./pve-location-assets/archetype-icons/highsec-skull.png", import.meta.url).href,
  lowsec: new URL("./pve-location-assets/archetype-icons/lowsec-skull.png", import.meta.url).href,
  nullsec: new URL("./pve-location-assets/archetype-icons/nullsec-crossed-swords.png", import.meta.url).href,
  wormhole: new URL("./pve-location-assets/archetype-icons/wormhole-vortex.png", import.meta.url).href,
  abyssal: new URL("./pve-location-assets/archetype-icons/abyssal-star.png", import.meta.url).href,
};
const archetypeThumbSprite = new URL("./pve-location-assets/archetypes/thumbs-sprite.webp", import.meta.url).href;

const archetypeVisuals: Record<LocationArchetype, { label: string; accent: string; thumbPosition: string }> = {
  highsec: { label: "High Sec", accent: "#35cfff", thumbPosition: "0%" },
  lowsec: { label: "Low Sec", accent: "#f4ad43", thumbPosition: "25%" },
  nullsec: { label: "Null Sec", accent: "#ff5b52", thumbPosition: "50%" },
  wormhole: { label: "Wormhole", accent: "#bd73ff", thumbPosition: "75%" },
  abyssal: { label: "Abyssal", accent: "#22dfda", thumbPosition: "100%" },
};
const kindAccent: Record<PveLocationKind, string> = {
  incursion: "#20d7c8",
  "mission-staging": "#55d9ff",
  "ded-search": "#bd73ff",
  "lowsec-ratting": "#f5b54a",
  "nullsec-ratting": "#ff5d54",
};

function ageLabel(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function compactIsk(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString("en-GB");
}

function iskPerHour(row: PveLocationOpportunity) {
  const low = row.earnings?.lowPerHour;
  const high = row.earnings?.highPerHour;
  if (low == null || high == null) return "Unavailable";
  return `${compactIsk(low)} - ${compactIsk(high)}`;
}

function securityBucket(row: PveLocationOpportunity): Exclude<SecurityFilter, "all"> {
  if (row.securityStatus >= 0.45) return "high";
  if (row.securityStatus > 0) return "low";
  return "null";
}

function securityText(row: PveLocationOpportunity) {
  return `${row.securityStatus.toFixed(2)} ${securityBucket(row).toUpperCase()}`;
}

function riskClass(row: PveLocationOpportunity) {
  const risk = String(row.risk ?? "").toLowerCase();
  if (risk.includes("high")) return "high";
  if (risk.includes("medium")) return "medium";
  return "low";
}

function activityBars(row: PveLocationOpportunity) {
  const signals = [
    Math.max(0, row.npcKills),
    Math.max(0, row.shipJumps),
    Math.max(0, row.shipKills * 25),
    Math.max(0, row.podKills * 40),
  ];
  const peak = Math.max(1, ...signals);
  const seed = Math.abs(row.systemId) % 97;
  return Array.from({ length: 14 }, (_, index) => {
    const signal = signals[index % signals.length] / peak;
    const phase = 0.35 + 0.65 * Math.abs(Math.sin((seed + index * 13) * 0.17));
    return Math.round(16 + 78 * Math.min(1, signal * 0.82 + phase * 0.36));
  });
}

function shipRenderUrl(typeId: number | null) {
  return typeId ? `sage-asset://type/${typeId}/render?size=512` : "";
}

function rowArchetype(row: PveLocationOpportunity): LocationArchetype {
  const context = `${row.label} ${row.availability} ${row.kind}`.toLowerCase();
  if (context.includes("abyss")) return "abyssal";
  if (context.includes("wormhole")) return "wormhole";
  const bucket = securityBucket(row);
  return bucket === "high" ? "highsec" : bucket === "low" ? "lowsec" : "nullsec";
}

function archetypeSecurityLabel(row: PveLocationOpportunity, archetype: LocationArchetype) {
  if (archetype === "wormhole") return "Classed Wormhole";
  if (archetype === "abyssal") return "Abyssal Deadspace";
  return `${row.securityStatus.toFixed(1)} ${archetypeVisuals[archetype].label}`;
}

function travelTime(minutes: number) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `~${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `~${hours}h ${mins}m` : `~${hours}h`;
}

function readinessAssessment(percent: number | null) {
  if (percent == null) return { title: "Readiness unavailable", detail: "No resolved capability score" };
  if (percent >= 75) return { title: "Good Match", detail: "Strong ship / skills" };
  if (percent >= 45) return { title: "Fair Match", detail: "Some gaps to review" };
  return { title: "Poor Match", detail: "Significant capability gaps" };
}

function activityStatus(row: PveLocationOpportunity) {
  if (row.npcKills >= 500 || row.shipJumps >= 1000) return "Very Active";
  if (row.npcKills >= 100 || row.shipJumps >= 250) return "Active";
  return "Observed";
}

function ArchetypeIcon({ archetype, className = "" }: { archetype: LocationArchetype; className?: string }) {
  return <img
    className={`pve-archetype-icon ${className}`.trim()}
    src={archetypeIconUrls[archetype]}
    alt=""
    aria-hidden="true"
    draggable={false}
  />;
}

function MapArchetypeNode({ archetype, x, y, count }: { archetype: Exclude<LocationArchetype, "lowsec">; x: number; y: number; count: number }) {
  const visual = archetypeVisuals[archetype];
  return <g className={`pve-map-archetype-node node-${archetype}`} transform={`translate(${x} ${y})`} style={{ color: visual.accent }}>
    <circle className="pve-map-node-pulse" r="39" />
    <circle className="pve-map-node-ring outer" r="31" />
    <circle className="pve-map-node-ring inner" r="25" />
    <foreignObject className="pve-map-node-icon-object" x="-31" y="-31" width="62" height="62">
      <div className="pve-map-node-icon-host">
        <ArchetypeIcon archetype={archetype} className="pve-map-archetype-icon" />
      </div>
    </foreignObject>
    <text className="pve-map-node-title" y="50">{visual.label}</text>
    <text className="pve-map-node-count" y="64">{count} LEAD{count === 1 ? "" : "S"}</text>
  </g>;
}

function PveIntelMap({ analysis, busy }: { analysis: PveLocationAnalysis; busy: boolean }) {
  const systemName = analysis.character.systemName;
  const current = systemName.length > 16 ? systemName.slice(0, 15) + "..." : systemName;
  const archetypeCounts = analysis.locations.reduce<Record<LocationArchetype, number>>((counts, row) => {
    counts[rowArchetype(row)] += 1;
    return counts;
  }, { highsec: 0, lowsec: 0, nullsec: 0, wormhole: 0, abyssal: 0 });
  const transitNodes = [
    [226, 82, "blue"], [285, 103, "blue"], [349, 126, "gold"], [412, 145, "gold"],
    [548, 137, "gold"], [614, 113, "gold"], [684, 94, "red"], [744, 84, "red"],
    [253, 226, "teal"], [315, 207, "teal"], [377, 182, "gold"],
    [561, 183, "gold"], [626, 202, "purple"], [689, 222, "purple"], [748, 236, "purple"],
  ] as const;
  const microNodes = [
    [46, 116], [75, 92], [101, 110], [119, 63], [183, 58], [207, 119], [272, 55], [322, 82],
    [638, 55], [697, 49], [726, 119], [836, 57], [877, 99], [897, 145], [851, 188], [884, 229],
    [90, 218], [124, 249], [166, 206], [221, 274], [302, 257], [672, 269], [727, 281], [847, 268],
  ] as const;

  return <div className="pve-star-map pve-star-map-redesign" aria-label={"Current location " + systemName}>
    <svg viewBox="0 0 960 320" preserveAspectRatio="xMidYMid slice" role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id="pveRouteBlueGold" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#39ceff"/><stop offset=".64" stopColor="#46c8e9"/><stop offset="1" stopColor="#ffd16b"/></linearGradient>
        <linearGradient id="pveRouteTealGold" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#23dfd3"/><stop offset=".7" stopColor="#30c9c4"/><stop offset="1" stopColor="#ffd16b"/></linearGradient>
        <linearGradient id="pveRouteGoldRed" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#ffd16b"/><stop offset=".47" stopColor="#f5a642"/><stop offset="1" stopColor="#ff5752"/></linearGradient>
        <linearGradient id="pveRouteGoldPurple" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#ffd16b"/><stop offset=".48" stopColor="#db8b7e"/><stop offset="1" stopColor="#bd73ff"/></linearGradient>
        <radialGradient id="pveBlueMist"><stop stopColor="#1698d1" stopOpacity=".28"/><stop offset=".42" stopColor="#07567b" stopOpacity=".15"/><stop offset="1" stopColor="#021018" stopOpacity="0"/></radialGradient>
        <radialGradient id="pveGoldMist"><stop stopColor="#f0ae3d" stopOpacity=".24"/><stop offset=".45" stopColor="#82501c" stopOpacity=".13"/><stop offset="1" stopColor="#120b03" stopOpacity="0"/></radialGradient>
        <radialGradient id="pveRedMist"><stop stopColor="#e54249" stopOpacity=".26"/><stop offset=".44" stopColor="#791821" stopOpacity=".15"/><stop offset="1" stopColor="#110306" stopOpacity="0"/></radialGradient>
        <radialGradient id="pvePurpleMist"><stop stopColor="#a950df" stopOpacity=".24"/><stop offset=".46" stopColor="#502074" stopOpacity=".14"/><stop offset="1" stopColor="#0d0515" stopOpacity="0"/></radialGradient>
        <filter id="pveMapGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="pveMapSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
      </defs>

      <g className="pve-map-mist" filter="url(#pveMapSoft)">
        <ellipse cx="150" cy="88" rx="215" ry="119" fill="url(#pveBlueMist)" />
        <ellipse cx="480" cy="157" rx="210" ry="126" fill="url(#pveGoldMist)" />
        <ellipse cx="805" cy="82" rx="180" ry="104" fill="url(#pveRedMist)" />
        <ellipse cx="798" cy="248" rx="183" ry="96" fill="url(#pvePurpleMist)" />
      </g>

      <g className="pve-map-nebula-ribbons">
        <path className="blue" d="M-14 131C79 53 159 43 259 95c49 25 87 29 143 11-54 53-131 73-219 57-87-15-144-12-197-32Z" />
        <path className="amber" d="M265 166c63-90 160-113 259-68 47 21 86 25 143 16-45 52-116 83-192 78-76-5-142 1-210-26Z" />
        <path className="red" d="M595 107c76-70 166-80 276-38-41 58-100 86-176 81-44-3-77-17-100-43Z" />
        <path className="purple" d="M591 207c82-18 180-2 301 55-65 36-143 43-229 20-45-12-76-39-72-75Z" />
      </g>

      <g className="pve-map-current-orbits">
        {[46, 67, 91, 118].map((r) => <circle key={r} cx="480" cy="160" r={r} />)}
        <path d="M350 160C378 111 428 88 482 92c62 4 113 34 143 84" />
        <path d="M345 181c55 44 129 53 197 27 38-14 72-39 95-72" />
      </g>

      <g className="pve-map-local-network">
        <path className="left" d="M21 139 59 96 96 110 129 67 169 91 207 61 260 103 313 75 352 117" />
        <path className="left" d="M43 183 88 153 128 174 171 144 211 171 257 140 318 163" />
        <path className="right" d="M604 118 649 78 691 97 731 62 782 83 839 57 920 87" />
        <path className="right" d="M616 182 659 195 702 172 744 198 793 180 848 204 925 180" />
        <path className="left lower" d="M72 257 118 224 160 247 205 215 257 240 308 209" />
        <path className="right lower" d="M650 268 690 235 734 253 784 226 834 247 906 222" />
        {microNodes.map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r={index % 5 === 0 ? 2.4 : 1.45} />)}
      </g>

      <g className="pve-map-route-glows">
        <path className="high" d="M150 81C235 70 327 101 464 153" />
        <path className="abyssal" d="M194 244C281 233 348 199 463 166" />
        <path className="null" d="M497 153C606 112 698 78 806 81" />
        <path className="wormhole" d="M498 166C610 187 700 221 806 243" />
      </g>
      <g className="pve-map-route-lines">
        <path className="route high" d="M150 81C235 70 327 101 464 153" />
        <path className="route high ghost" d="M151 83C232 96 326 127 462 158" />
        <path className="route abyssal" d="M194 244C281 233 348 199 463 166" />
        <path className="route abyssal ghost" d="M198 242C291 217 365 186 462 163" />
        <path className="route null" d="M497 153C606 112 698 78 806 81" />
        <path className="route null ghost" d="M499 158C613 137 713 105 805 83" />
        <path className="route wormhole" d="M498 166C610 187 700 221 806 243" />
        <path className="route wormhole ghost" d="M500 162C615 177 714 204 804 241" />
      </g>

      <g className="pve-map-transit-nodes" filter="url(#pveMapGlow)">
        {transitNodes.map(([cx, cy, tone], index) => <g key={index} className={tone}><circle className="halo" cx={cx} cy={cy} r={5.4}/><circle className="core" cx={cx} cy={cy} r={2.25}/></g>)}
      </g>

      <MapArchetypeNode archetype="highsec" x={150} y={81} count={archetypeCounts.highsec} />
      <MapArchetypeNode archetype="abyssal" x={194} y={244} count={archetypeCounts.abyssal} />

      <g className="pve-map-current-node" transform="translate(480 160)" filter="url(#pveMapGlow)">
        <circle className="pve-current-aura" r="54" />
        <circle className="pve-current-ring orbit" r="43" />
        <circle className="pve-current-ring outer" r="35" />
        <circle className="pve-current-ring inner" r="28" />
        <foreignObject className="pve-current-icon-object" x="-33" y="-33" width="66" height="66">
          <div className="pve-map-current-icon-host"><ArchetypeIcon archetype="lowsec" className="pve-map-current-icon" /></div>
        </foreignObject>
        <text className="pve-current-system-label" y="57">{current}</text>
        <text className="pve-current-system-state" y="73">{busy ? "REFRESHING LIVE LOCATION" : "CURRENT LOCATION"}</text>
      </g>

      <MapArchetypeNode archetype="nullsec" x={806} y={81} count={archetypeCounts.nullsec} />
      <MapArchetypeNode archetype="wormhole" x={806} y={244} count={archetypeCounts.wormhole} />
    </svg>
  </div>;
}
export function PveLocationIntel({ analysis, busy = false, onRefresh }: { analysis: PveLocationAnalysis; busy?: boolean; onRefresh?: () => void }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [security, setSecurity] = useState<SecurityFilter>("all");
  const [sort, setSort] = useState<SortMode>("score");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return analysis.locations
      .filter((row) => kind === "all" || row.kind === kind)
      .filter((row) => security === "all" || securityBucket(row) === security)
      .filter((row) => !needle || `${row.systemName} ${row.regionName} ${row.constellationName ?? ""} ${row.label} ${row.corporationName ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === "jumps") return a.jumps - b.jumps || b.score - a.score;
        if (sort === "safety") return a.shipKills - b.shipKills || a.podKills - b.podKills || b.score - a.score;
        if (sort === "npc") return b.npcKills - a.npcKills || b.score - a.score;
        if (sort === "traffic") return b.shipJumps - a.shipJumps || b.score - a.score;
        return b.score - a.score || a.jumps - b.jumps;
      });
  }, [analysis.locations, kind, security, sort, search]);

  const currentShipReadiness = analysis.character.shipReadiness && Number.isFinite(analysis.character.shipReadiness.percent)
    ? Math.max(0, Math.min(100, Math.round(analysis.character.shipReadiness.percent)))
    : null;
  const currentShipAssessment = readinessAssessment(currentShipReadiness);
  const currentShipTier = analysis.character.shipReadiness?.label ?? analysis.character.shipReadiness?.tier ?? "Readiness unavailable";
  const currentShipImage = shipRenderUrl(analysis.character.shipTypeId);
  const freshTone = analysis.dataStatus.stale ? "stale" : "good";
  const selected = selectedId ? analysis.locations.find((row) => row.id === selectedId) ?? null : null;

  return <section className="pve-intel pve-reference">
    <header className="pve-hero">
      <div className="pve-hero-copy">
        <p className="eyebrow">PVE &nbsp; LOCATIONS</p>
        <h2>Where should I go?</h2>
        <p>Ranked locations and system intelligence to plan your next expedition. Filter by security, activity, readiness and travel distance from your live position.</p>
        <div className="pve-current-ship">
          <div className="pve-ship-art">
            <IskGlyph name="pve" className="pve-ship-fallback" />
            {currentShipImage && <img src={currentShipImage} alt="" onLoad={(event) => event.currentTarget.parentElement?.classList.add("has-ship-render")} onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.remove("has-ship-render"); }} />}
          </div>
          <div className="pve-ship-copy">
            <span>CURRENT SHIP</span>
            <strong>{analysis.character.shipName ?? "Unknown ship"}</strong>
            <small>{currentShipTier} | PvE combat profile</small>
          </div>
          <div className={`pve-readiness-ring ${currentShipReadiness == null ? "unresolved" : ""}`} style={currentShipReadiness == null ? undefined : { background: `conic-gradient(#27e2d4 ${currentShipReadiness}%, #15343d 0)` }}>
            <span><strong>{currentShipReadiness == null ? "--" : `${currentShipReadiness}%`}</strong><small>READY</small></span>
          </div>
          <ul>
            <li>{currentShipReadiness == null ? "Readiness not resolved" : currentShipAssessment.title}</li>
            <li>{analysis.character.shipReadiness ? "Skills matched to current hull" : "Hull capability unavailable"}</li>
            <li>Current position | {analysis.character.systemName}</li>
          </ul>
        </div>
      </div>

      <PveIntelMap analysis={analysis} busy={busy} />

      <aside className="pve-load-card">
        <button type="button" onClick={onRefresh} disabled={busy}><IskGlyph name="route" />{busy ? "LOADING LIVE INTELLIGENCE..." : "LOAD PVE INTELLIGENCE"}</button>
        <div className="pve-cache-meta"><span>{analysis.dataStatus.stale ? "SCANNING / PARTIAL INTEL" : "PUBLIC INTEL ONLINE"}</span><small>{ageLabel(analysis.dataStatus.ageMinutes)}</small></div>
        <div className="pve-freshness"><div><span>Intel freshness</span><strong className={freshTone}>{analysis.dataStatus.stale ? "CHECK" : "GOOD"}</strong></div><i><b style={{ width: `${Math.max(8, 100 - Math.min(90, analysis.dataStatus.ageMinutes * 4))}%`} } /></i><small>{analysis.dataStatus.source}</small></div>
      </aside>
    </header>

    <nav className="pve-kind-tabs" aria-label="PvE location types">
      <button type="button" className={kind === "all" ? "active all" : "all"} onClick={() => setKind("all")}><IskGlyph name="bars" /><span>All</span><b>{analysis.locations.length}</b></button>
      {(Object.keys(kindShortLabels) as PveLocationKind[]).map((value) => <button type="button" key={value} className={`${kind === value ? "active " : ""}kind-${value}`} onClick={() => setKind(value)}><i aria-hidden="true" /><span>{kindShortLabels[value]}</span><b>{analysis.counts[value]}</b></button>)}
    </nav>

    <div className="pve-search-toolbar">
      <label className="pve-search"><span>SEARCH</span><div><IskGlyph name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search systems, regions, corporations..." /></div></label>
      <label><span>SECURITY</span><select value={security} onChange={(event) => setSecurity(event.target.value as SecurityFilter)}><option value="all">All Security</option><option value="high">High-sec</option><option value="low">Low-sec</option><option value="null">Null-sec</option></select></label>
      <label><span>SORT BY</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="score">Best Overall</option><option value="jumps">Shortest travel</option><option value="safety">Lowest danger</option><option value="npc">Most NPC activity</option><option value="traffic">Most traffic</option></select></label>
      <div className="pve-showing"><span>SHOWING</span><strong>{filtered.length}<small> / {analysis.locations.length}</small></strong><em>locations</em></div>
    </div>

    <div className="pve-result-table">
      <div className="pve-result-head"><span>LOCATION</span><span>TYPE</span><span className="pve-score-head" aria-hidden="true"></span><span>READINESS</span><span>ACTIVITY / DANGER</span><span>EST. ISK/HR</span><span>TRAVEL</span></div>
      <div className="pve-result-body">
        {filtered.map((row) => {
          const isSelected = selectedId === row.id;
          const ready = row.readiness && Number.isFinite(row.readiness.percent) ? Math.max(0, Math.min(100, Math.round(row.readiness.percent))) : null;
          const assessment = readinessAssessment(ready);
          const bars = activityBars(row);
          const archetype = rowArchetype(row);
          const visual = archetypeVisuals[archetype];
          const accent = visual.accent;
          return <div className={`pve-result-wrap kind-${row.kind} archetype-${archetype} ${isSelected ? "selected" : ""}`} style={{ "--kind-accent": accent } as CSSProperties} key={row.id}>
            <button type="button" className={`pve-result-row kind-${row.kind}`} style={{ "--kind-accent": accent } as CSSProperties} onClick={() => setSelectedId(isSelected ? null : row.id)}>
              <span className="pve-location-cell">
                <span className="pve-location-thumb">
                  <span className="pve-location-scene" aria-hidden="true" style={{ backgroundImage: `url(${archetypeThumbSprite})`, backgroundPositionY: visual.thumbPosition }} />
                  <span className="pve-location-glass" aria-hidden="true" />
                  <span className="pve-category-badge"><ArchetypeIcon archetype={archetype} /></span>
                </span>
                <span className="pve-location-copy" style={{ "--location-accent": visual.accent } as CSSProperties}>
                  <strong>{row.systemName}</strong>
                  <small>{row.regionName}</small>
                  <em>{archetypeSecurityLabel(row, archetype)}</em>
                </span>
              </span>
              <span className="pve-type-cell"><strong>{kindLabels[row.kind]}</strong><em>{row.availability.replaceAll("-", " ")}</em><small>{row.confidence} confidence</small></span>
              <span className="pve-score-cell"><strong>{Math.round(row.score)}</strong><small>{row.score >= 80 ? "High" : row.score >= 65 ? "Good" : "Fair"}</small></span>
              <span className="pve-ready-cell">
                <i className={ready == null ? "unresolved" : ""} style={ready == null ? undefined : { background: `conic-gradient(${accent} ${ready}%, #17343d 0)` }}><b>{ready == null ? "--" : `${ready}%`}</b></i>
                <span><strong>{assessment.title}</strong><small>{row.readiness?.bestRoute ?? assessment.detail}</small><em>{row.readiness?.tier ?? "No readiness score"}</em></span>
              </span>
              <span className="pve-activity-cell">
                <strong>{row.npcKills.toLocaleString("en-GB")} NPC</strong><small>{activityStatus(row)}</small><em>{row.shipKills} ship | {row.podKills} pod kills</em>
                <i title="Relative activity signature derived from current public NPC, traffic and kill signals.">{bars.map((height, index) => <b key={index} style={{ height: `${height}%` }} />)}</i>
              </span>
              <span className="pve-isk-cell"><strong>{iskPerHour(row)}</strong><small>Avg. Range</small>{row.earnings && <em>Gross estimate</em>}</span>
              <span className="pve-travel-cell"><strong><IskGlyph name="route" />{row.jumps} Jump{row.jumps === 1 ? "" : "s"}</strong><small>{travelTime(row.estimatedMinutes)}</small><em className={riskClass(row)}>{row.risk} risk</em><IskGlyph name="chevron" className="pve-row-chevron" /></span>
            </button>
            {isSelected && <LocationDetail row={row} />}
          </div>;
        })}
        {!filtered.length && <div className="pve-empty">No PvE/location leads match these filters.</div>}
      </div>
    </div>

    {selected && <div className="pve-selection-footer"><span><IskGlyph name="target" /> SELECTED LEAD</span><strong>{selected.systemName} | {kindLabels[selected.kind]}</strong><small>{selected.action}</small></div>}

    <footer className="pve-statusbar"><span>DATA STATUS <i className={freshTone} /> {analysis.dataStatus.stale ? "Cached/partial public intel" : "Public activity data nominal"}</span><span>LIVE LOCATION | {analysis.character.systemName}</span><span>SYNCED {ageLabel(Math.max(0, Math.round((Date.now() - Date.parse(analysis.generatedAt)) / 60000)))}</span></footer>
  </section>;
}

function LocationDetail({ row }: { row: PveLocationOpportunity }) {
  return <div className="pve-location-detail">
    <div><p className="eyebrow">WHY SAGE RANKED THIS</p><h4>{row.label}</h4>{row.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>
    <div><p className="eyebrow">NEXT ACTION</p><strong>{row.action}</strong><small>{row.caveat}</small></div>
    <div className="pve-detail-stats"><span><small>SECURITY</small><strong>{securityText(row)}</strong></span><span><small>NPC KILLS</small><strong>{row.npcKills.toLocaleString("en-GB")}</strong></span><span><small>TRAFFIC</small><strong>{row.shipJumps.toLocaleString("en-GB")}</strong></span><span><small>TRAVEL</small><strong>{row.jumps} jumps</strong></span></div>
  </div>;
}
