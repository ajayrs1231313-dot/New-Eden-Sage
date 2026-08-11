import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import "./industrial-command.css";

type IndustrialTab = "overview" | "blueprints" | "jobs" | "materials" | "research" | "production";

type BlueprintRecord = {
  item_id?: number;
  type_id?: number;
  location_id?: number;
  location_flag?: string;
  quantity?: number;
  material_efficiency?: number;
  time_efficiency?: number;
  runs?: number;
};

type IndustryJobRecord = {
  job_id?: number;
  activity_id?: number;
  blueprint_type_id?: number;
  product_type_id?: number;
  blueprint_location_id?: number;
  output_location_id?: number;
  facility_id?: number;
  installer_id?: number;
  runs?: number;
  cost?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  completed_date?: string;
  successful_runs?: number;
};

type EnrichedAsset = {
  item_id?: number;
  type_id?: number;
  item?: string;
  quantity?: number;
  station?: string | null;
  system?: string | null;
  location_flag?: string;
  estimatedValue?: number;
};

const tabs: Array<{ id: IndustrialTab; label: string }> = [
  { id: "overview", label: "Command Overview" },
  { id: "blueprints", label: "Blueprint Library" },
  { id: "jobs", label: "Industry Jobs" },
  { id: "materials", label: "Materials" },
  { id: "research", label: "Research & Invention" },
  { id: "production", label: "Production Planner" },
];

const activityNames: Record<number, string> = {
  1: "Manufacturing",
  3: "TE Research",
  4: "ME Research",
  5: "Copying",
  7: "Reverse Engineering",
  8: "Invention",
  9: "Reactions",
  11: "Reactions",
};

function number(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function isk(value: number) {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)} ISK`;
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

function sourceUnavailable(value: unknown) {
  return Boolean(value && typeof value === "object" && "unavailable" in value);
}

export function IndustrialCommand({
  snapshots,
  activeCharacterId,
  onSelectCharacter,
}: {
  snapshots: CharacterSnapshot[];
  activeCharacterId?: string;
  onSelectCharacter(characterId: string): void;
}) {
  const [tab, setTab] = useState<IndustrialTab>("overview");
  const [blueprintFilter, setBlueprintFilter] = useState("");
  const [typeNames, setTypeNames] = useState<Record<number, string>>({});
  const [selectedBlueprintIndex, setSelectedBlueprintIndex] = useState(0);
  const [targetQuantity, setTargetQuantity] = useState(1);
  const [manufacturingPlan, setManufacturingPlan] = useState<any>(null);
  const [manufacturingStatus, setManufacturingStatus] = useState("Choose a blueprint and output quantity.");
  const [blueprintActivities, setBlueprintActivities] = useState<any>(null);
  const [activityStatus, setActivityStatus] = useState("Choose an owned blueprint to inspect CCP activity data.");
  const [systemCostIndex, setSystemCostIndex] = useState<any>(null);
  const [includeConnectedStock, setIncludeConnectedStock] = useState(false);
  const [systemCostStatus, setSystemCostStatus] = useState("Current-system cost index not loaded.");
  const active = snapshots.find((item) => item.characterId === activeCharacterId) ?? snapshots[0];

  const industrial = useMemo(() => {
    const characters = snapshots.map((snapshot) => {
      const extended = snapshot.extended as any;
      const blueprints: BlueprintRecord[] = isArray<BlueprintRecord>(extended?.blueprints) ? extended.blueprints : [];
      const jobs: IndustryJobRecord[] = isArray<IndustryJobRecord>(extended?.industryJobs) ? extended.industryJobs : [];
      const assets: EnrichedAsset[] = isArray<EnrichedAsset>(extended?.assets) ? extended.assets : [];
      const corpBlueprints: BlueprintRecord[] = isArray<BlueprintRecord>(extended?.corporation?.blueprints)
        ? extended.corporation.blueprints
        : [];
      const corpJobs: IndustryJobRecord[] = isArray<IndustryJobRecord>(extended?.corporation?.industryJobs)
        ? extended.corporation.industryJobs
        : [];
      const facilities: any[] = isArray<any>(extended?.corporation?.facilities)
        ? extended.corporation.facilities
        : [];
      return {
        snapshot,
        blueprints,
        jobs,
        assets,
        corpBlueprints,
        corpJobs,
        facilities,
        blueprintUnavailable: sourceUnavailable(extended?.blueprints),
        jobsUnavailable: sourceUnavailable(extended?.industryJobs),
      };
    });
    return characters;
  }, [snapshots]);

  useEffect(() => {
    const typeIds = [...new Set(
      industrial.flatMap((item) => [
        ...item.blueprints.map((blueprint) => blueprint.type_id),
        ...item.jobs.flatMap((job) => [job.blueprint_type_id, job.product_type_id]),
      ]).filter((typeId): typeId is number => typeof typeId === "number" && typeId > 0 && !typeNames[typeId]),
    )];
    if (!typeIds.length) return;
    window.sage.resolveTypeIds(typeIds).then((resolved) => {
      setTypeNames((current) => ({
        ...current,
        ...Object.fromEntries(resolved.map((item) => [item.id, item.name])),
      }));
    }).catch(() => undefined);
  }, [industrial, typeNames]);

  useEffect(() => {
    setSelectedBlueprintIndex(0);
    setManufacturingPlan(null);
    setManufacturingStatus("Choose a blueprint and output quantity.");
    setBlueprintActivities(null);
    setActivityStatus("Choose an owned blueprint to inspect CCP activity data.");
  }, [active?.characterId]);

  if (!active) {
    return (
      <section className="industrial-command industrial-empty">
        <div className="industrial-construction-ribbon">UNDER CONSTRUCTION</div>
        <p className="eyebrow">INDUSTRIAL COMMAND</p>
        <h2>Connect a character to initialise industry intelligence</h2>
        <p>Sage will keep each character&apos;s blueprints, jobs and assets separately identified.</p>
      </section>
    );
  }

  const activeData = industrial.find((item) => item.snapshot.characterId === active.characterId)!;
  const allCharacterBlueprints = industrial.reduce((total, item) => total + item.blueprints.length, 0);
  const allCharacterJobs = industrial.reduce((total, item) => total + item.jobs.length, 0);
  const activeJobs = industrial.flatMap((item) =>
    item.jobs.filter((job) => !["delivered", "cancelled", "reverted"].includes(job.status ?? "")),
  );
  const totalJobCost = activeJobs.reduce((total, job) => total + (job.cost ?? 0), 0);
  const ownedMaterialStacks = industrial.reduce(
    (total, item) => total + item.assets.filter((asset) => (asset.quantity ?? 0) > 0).length,
    0,
  );

  const selectedBlueprint = activeData.blueprints[selectedBlueprintIndex] ?? activeData.blueprints[0];
  async function buildManufacturingPlan() {
    if (!selectedBlueprint?.type_id) {
      setManufacturingStatus("Choose a manufacturing blueprint first.");
      return;
    }
    setManufacturingStatus("Expanding CCP manufacturing materials and subtracting owned stock…");
    try {
      const result = await (window.sage as any).getManufacturingPlan({
        characterId: active.characterId,
        blueprintTypeId: selectedBlueprint.type_id,
        materialEfficiency: selectedBlueprint.material_efficiency ?? 0,
        timeEfficiency: selectedBlueprint.time_efficiency ?? 0,
        targetQuantity: Math.max(1, Math.floor(targetQuantity)),
        availableRuns: (selectedBlueprint.runs ?? -1) >= 0 ? selectedBlueprint.runs : undefined,
        includeConnectedStock,
      });
      setManufacturingPlan(result);
      setManufacturingStatus(result.totalMissingStacks ? `${result.totalMissingStacks} material type(s) still need sourcing.` : "Owned stock covers the complete blueprint bill of materials.");
    } catch (error) {
      setManufacturingPlan(null);
      setManufacturingStatus(error instanceof Error ? error.message : "Manufacturing analysis failed.");
    }
  }
  async function loadSystemCostIndex() {
    setSystemCostStatus("Loading current-system ESI industry indices…");
    try {
      const result = await (window.sage as any).getIndustrySystemCostIndex({ characterId: active.characterId });
      setSystemCostIndex(result);
      setSystemCostStatus(result.available ? "Current-system industry indices loaded." : "No cost-index record is available for this system.");
    } catch (error) {
      setSystemCostIndex(null);
      setSystemCostStatus(error instanceof Error ? error.message : "Industry cost-index lookup failed.");
    }
  }

  async function loadBlueprintActivities() {
    if (!selectedBlueprint?.type_id) { setActivityStatus("Choose a blueprint first."); return; }
    setActivityStatus("Loading CCP research, copying and invention activities…");
    try {
      const result = await (window.sage as any).getBlueprintActivities({ characterId: active.characterId, blueprintTypeId: selectedBlueprint.type_id });
      setBlueprintActivities(result);
      setActivityStatus(`${result.activities.length} CCP activity definition(s) available.`);
    } catch (error) {
      setBlueprintActivities(null);
      setActivityStatus(error instanceof Error ? error.message : "Blueprint activity analysis failed.");
    }
  }
  const filteredBlueprints = activeData.blueprints.filter((blueprint) => {
    const typeName = blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Blueprint";
    return typeName.toLowerCase().includes(blueprintFilter.toLowerCase());
  });

  return (
    <section className="industrial-command">
      <div className="industrial-construction-ribbon">UNDER CONSTRUCTION</div>
      <div className="industrial-hero">
        <div>
          <p className="eyebrow">CAPSULEER PRODUCTION CONTROL</p>
          <h2>Industrial Command</h2>
          <p>
            Blueprint ownership, industry jobs and material holdings are live from synced ESI data.
            Production-chain costing and invention intelligence will build on this foundation.
          </p>
        </div>
        <div className="industrial-owner-card">
          <span>ACTIVE INDUSTRIAL OWNER</span>
          <strong>{active.character.name}</strong>
          <small>{active.character.corporation_name ?? "Independent capsuleer"}</small>
        </div>
      </div>

      <div className="industrial-character-strip" aria-label="Industrial character ownership">
        {industrial.map(({ snapshot, blueprints, jobs }) => (
          <button
            key={snapshot.characterId}
            className={snapshot.characterId === active.characterId ? "active" : ""}
            onClick={() => onSelectCharacter(snapshot.characterId)}
          >
            <strong>{snapshot.character.name}</strong>
            <span>{blueprints.length} BP · {jobs.length} jobs</span>
          </button>
        ))}
      </div>

      <div className="skills-tabs industrial-tabs" role="tablist" aria-label="Industrial Command sections">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="industrial-metrics">
            <IndustrialMetric label="Character blueprints" value={number(allCharacterBlueprints)} detail="Across connected characters · identities preserved" />
            <IndustrialMetric label="Industry jobs" value={number(allCharacterJobs)} detail={`${activeJobs.length} currently active or pending`} />
            <IndustrialMetric label="Committed job cost" value={isk(totalJobCost)} detail="Active/pending ESI job cost" />
            <IndustrialMetric label="Asset stacks" value={number(ownedMaterialStacks)} detail="Available to future material analysis" />
          </div>

          <div className="industrial-grid">
            <article className="industrial-panel">
              <div className="industrial-panel-head">
                <div>
                  <p className="eyebrow">CURRENT CHARACTER</p>
                  <h3>{active.character.name}</h3>
                </div>
                <span className="industrial-status live">LIVE ESI</span>
              </div>
              <div className="industrial-stat-list">
                <IndustrialStat label="Personal blueprints" value={activeData.blueprintUnavailable ? "Reconnect required" : number(activeData.blueprints.length)} />
                <IndustrialStat label="Personal jobs" value={activeData.jobsUnavailable ? "Reconnect required" : number(activeData.jobs.length)} />
                <IndustrialStat label="Asset stacks" value={number(activeData.assets.length)} />
                <IndustrialStat label="Corporation blueprints visible" value={number(activeData.corpBlueprints.length)} />
                <IndustrialStat label="Corporation jobs visible" value={number(activeData.corpJobs.length)} />
                <IndustrialStat label="Corporation facilities visible" value={number(activeData.facilities.length)} />
              </div>
            </article>

            <article className="industrial-panel">
              <div className="industrial-panel-head">
                <div>
                  <p className="eyebrow">ACTIVE PIPELINE</p>
                  <h3>Jobs requiring attention</h3>
                </div>
                <span className="industrial-status">{activeData.jobs.length} tracked</span>
              </div>
              <JobList jobs={activeData.jobs.slice(0, 8)} typeNames={typeNames} />
            </article>
          </div>

          <div className="industrial-roadmap-grid">
            <RoadmapCard title="Manufacturing" state="Foundation live" text="Character jobs, blueprint ownership and assets are connected. Material and cost expansion follows." />
            <RoadmapCard title="Invention & research" state="Next pass" text="ME/TE, copying, invention inputs, datacores and probability intelligence." />
            <RoadmapCard title="Build vs buy" state="Queued" text="Use Sage's full-market dataset for material sourcing and finished-product comparisons." />
            <RoadmapCard title="Multi-character planning" state="Foundation live" text="Ownership is already separated per character; shared plans will reference owners explicitly." />
          </div>
        </>
      )}

      {tab === "blueprints" && (
        <div className="industrial-panel industrial-full-panel">
          <div className="industrial-panel-head blueprint-head">
            <div>
              <p className="eyebrow">PERSONAL BLUEPRINT LIBRARY</p>
              <h3>{active.character.name}</h3>
              <p>BPO/BPC identity, ME/TE and remaining runs from ESI.</p>
            </div>
            <input value={blueprintFilter} onChange={(event) => setBlueprintFilter(event.target.value)} placeholder="Filter blueprints…" />
          </div>
          {activeData.blueprintUnavailable ? (
            <div className="industrial-notice">Blueprint scope is unavailable for this stored login. Reconnect the character to grant the current Sage ESI scopes.</div>
          ) : filteredBlueprints.length ? (
            <div className="industrial-table">
              <div className="industrial-table-row heading">
                <span>Blueprint type</span><span>Kind</span><span>ME</span><span>TE</span><span>Runs</span><span>Location</span>
              </div>
              {filteredBlueprints.map((blueprint, index) => (
                <div className="industrial-table-row" key={blueprint.item_id ?? `${blueprint.type_id}-${index}`}>
                  <strong>{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Unknown blueprint"}</strong>
                  <span>{blueprint.quantity === -1 ? "BPO" : "BPC"}</span>
                  <span>{blueprint.material_efficiency ?? 0}%</span>
                  <span>{blueprint.time_efficiency ?? 0}%</span>
                  <span>{blueprint.quantity === -1 ? "∞" : blueprint.runs ?? 0}</span>
                  <span>{blueprint.location_flag ?? blueprint.location_id ?? "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="industrial-notice">No personal blueprints are present in the latest synced snapshot.</div>
          )}
          {activeData.corpBlueprints.length > 0 && (
            <div className="industrial-corp-note">Corporation access detected: {number(activeData.corpBlueprints.length)} corporation blueprints are available for the corporation-management/industrial crossover pass.</div>
          )}
        </div>
      )}

      {tab === "jobs" && (
        <div className="industrial-panel industrial-full-panel">
          <div className="industrial-panel-head">
            <div>
              <p className="eyebrow">INDUSTRY JOB LEDGER</p>
              <h3>{active.character.name}</h3>
              <p>Current and completed character jobs retained from ESI.</p>
            </div>
            <span className="industrial-status live">{activeData.jobs.length} records</span>
          </div>
          {activeData.jobsUnavailable ? (
            <div className="industrial-notice">Industry-job scope is unavailable for this stored login. Reconnect the character to refresh authorization.</div>
          ) : (
            <JobList jobs={activeData.jobs} expanded typeNames={typeNames} />
          )}
        </div>
      )}

      {tab === "materials" && (
        <div className="industrial-grid">
          <article className="industrial-panel">
            <div className="industrial-panel-head">
              <div><p className="eyebrow">OWNED MATERIALS</p><h3>{active.character.name}</h3></div>
              <span className="industrial-status live">ASSETS LIVE</span>
            </div>
            <div className="industrial-material-list">
              {activeData.assets.slice(0, 12).map((asset, index) => (
                <div key={asset.item_id ?? index}>
                  <span><strong>{asset.item ?? `Type ${asset.type_id}`}</strong><small>{asset.station ?? asset.system ?? asset.location_flag ?? "Unresolved location"}</small></span>
                  <span>{number(Math.max(1, asset.quantity ?? 1))}</span>
                </div>
              ))}
              {!activeData.assets.length && <div className="industrial-notice">No enriched asset data is available in this snapshot.</div>}
            </div>
          </article>
          <article className="industrial-panel industrial-planned">
            <p className="eyebrow">MATERIAL REQUIREMENTS ENGINE</p>
            <h3>Production bill of materials</h3>
            <p>This panel is reserved for blueprint material expansion, owned-stock subtraction, sourcing, hauling volume and market cost.</p>
            <div className="industrial-inline-banner">UNDER CONSTRUCTION</div>
          </article>
        </div>
      )}

      {tab === "research" && (
        <div className="industrial-production-workspace">
          <article className="industrial-panel industrial-production-control">
            <div className="industrial-panel-head"><div><p className="eyebrow">RESEARCH & INVENTION</p><h3>Blueprint activity intelligence</h3><p>Inspect copying, ME/TE research, invention inputs, output options and skill requirements directly from CCP's local SDE.</p></div><span className="industrial-status live">OFFLINE SDE</span></div>
            {activeData.blueprints.length ? <><div className="industrial-production-controls research-controls"><label><span>Owned blueprint</span><select value={Math.min(selectedBlueprintIndex, Math.max(0, activeData.blueprints.length - 1))} onChange={(event) => { setSelectedBlueprintIndex(Number(event.target.value)); setBlueprintActivities(null); }}>
              {activeData.blueprints.map((blueprint, index) => <option key={blueprint.item_id ?? index} value={index}>{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Unknown blueprint"} · ME {blueprint.material_efficiency ?? 0} / TE {blueprint.time_efficiency ?? 0}</option>)}
            </select></label><button type="button" onClick={loadBlueprintActivities}>Analyse activities</button></div><div className="industrial-notice">{activityStatus}</div></> : <div className="industrial-notice">No personal blueprints are available for this character.</div>}
          </article>
          {blueprintActivities ? <BlueprintActivityView data={blueprintActivities} /> : <article className="industrial-panel industrial-planned"><p className="eyebrow">CCP ACTIVITY MAP</p><h3>Research and invention ready</h3><p>Choose an owned blueprint to reveal copying, research, invention and manufacturing definitions, including base activity time, required materials, possible outputs and trained skill readiness.</p></article>}
        </div>
      )}
      {tab === "production" && (
        <div className="industrial-production-workspace">
          <article className="industrial-panel industrial-production-control">
            <div className="industrial-panel-head">
              <div><p className="eyebrow">PRODUCTION CHAIN PLANNER</p><h3>Manufacturing target</h3><p>Uses the selected character's real blueprint ME/TE and personal asset stock.</p></div>
              <span className="industrial-status live">CCP SDE</span>
            </div>
            {activeData.blueprints.length ? <>
              <div className="industrial-production-controls">
                <label><span>Blueprint</span><select value={Math.min(selectedBlueprintIndex, Math.max(0, activeData.blueprints.length - 1))} onChange={(event) => { setSelectedBlueprintIndex(Number(event.target.value)); setManufacturingPlan(null); }}>
                  {activeData.blueprints.map((blueprint, index) => <option key={blueprint.item_id ?? index} value={index}>{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Unknown blueprint"} · ME {blueprint.material_efficiency ?? 0} / TE {blueprint.time_efficiency ?? 0}{(blueprint.runs ?? -1) >= 0 ? ` · ${blueprint.runs} runs` : " · BPO"}</option>)}
                </select></label>
                <label><span>Target output</span><input type="number" min="1" step="1" value={targetQuantity} onChange={(event) => setTargetQuantity(Math.max(1, Number(event.target.value) || 1))} /></label>
                <label className="industrial-stock-toggle"><input type="checkbox" checked={includeConnectedStock} onChange={(event) => { setIncludeConnectedStock(event.target.checked); setManufacturingPlan(null); }} /><span>Use connected characters' stock</span></label>
                <button type="button" onClick={buildManufacturingPlan}>Build production plan</button>
              </div>
              <div className="industrial-system-index"><div><span>CURRENT SYSTEM</span><strong>{active.location?.solar_system_name ?? "Unknown system"}</strong><small>{systemCostIndex?.available ? `Manufacturing cost index ${(Number(systemCostIndex.indices?.manufacturing ?? 0) * 100).toFixed(3)}%` : systemCostStatus}</small></div><button type="button" onClick={loadSystemCostIndex}>Load current system index</button></div>
              <div className="industrial-notice">{manufacturingStatus}</div>
            </> : <div className="industrial-notice">No personal blueprints are available for this character.</div>}
          </article>
          {manufacturingPlan ? <ManufacturingPlanView plan={manufacturingPlan} /> : <article className="industrial-panel industrial-planned"><p className="eyebrow">MATERIAL REQUIREMENTS ENGINE</p><h3>Ready for a target</h3><p>Select an owned blueprint and Sage will expand its manufacturing bill of materials using CCP's local SDE, apply that exact blueprint's ME/TE, and subtract the selected owner's stock.</p><div className="industrial-production-steps"><span>1 · Choose owned blueprint</span><span>2 · Set output quantity</span><span>3 · Expand CCP materials</span><span>4 · Apply ME/TE</span><span>5 · Subtract stock</span><span>6 · Identify shortages</span></div></article>}
        </div>
      )}
    </section>
  );
}

function IndustrialMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="industrial-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function IndustrialStat({ label, value }: { label: string; value: string }) {
  return <div className="industrial-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function JobList({ jobs, expanded = false, typeNames }: { jobs: IndustryJobRecord[]; expanded?: boolean; typeNames: Record<number, string> }) {
  if (!jobs.length) return <div className="industrial-notice">No industry jobs in the latest synced snapshot.</div>;
  return (
    <div className={`industrial-job-list ${expanded ? "expanded" : ""}`}>
      {jobs.map((job, index) => (
        <div className="industrial-job" key={job.job_id ?? index}>
          <div>
            <strong>{activityNames[job.activity_id ?? 0] ?? `Activity ${job.activity_id ?? "—"}`}</strong>
            <small>{job.blueprint_type_id ? typeNames[job.blueprint_type_id] ?? `Blueprint ${job.blueprint_type_id}` : "Unknown blueprint"}{job.product_type_id ? ` · ${typeNames[job.product_type_id] ?? `Product ${job.product_type_id}`}` : ""}</small>
          </div>
          <span><small>Status</small><strong>{job.status ?? "unknown"}</strong></span>
          <span><small>Runs</small><strong>{job.runs ?? "—"}</strong></span>
          <span><small>Cost</small><strong>{job.cost == null ? "—" : isk(job.cost)}</strong></span>
          <span><small>Ends</small><strong>{job.end_date ? new Date(job.end_date).toLocaleString() : "—"}</strong></span>
        </div>
      ))}
    </div>
  );
}

function RoadmapCard({ title, state, text }: { title: string; state: string; text: string }) {
  return <article className="industrial-roadmap-card"><span>{state}</span><h3>{title}</h3><p>{text}</p></article>;
}

function duration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes ? minutes + "m" : ""].filter(Boolean).join(" ") || "<1m";
}

function ManufacturingPlanView({ plan }: { plan: any }) {
  return <div className="industrial-production-results">
    <div className="industrial-metrics">
      <IndustrialMetric label="Output" value={number(plan.outputQuantity)} detail={plan.productName} />
      <IndustrialMetric label="Manufacturing runs" value={number(plan.runs)} detail={plan.availableRuns == null ? "Original blueprint" : plan.runsAvailable ? plan.availableRuns + " BPC runs available" : "INSUFFICIENT BPC RUNS"} />
      <IndustrialMetric label="Blueprint time" value={duration(plan.blueprintTimeSeconds)} detail={`TE ${plan.timeEfficiency}% · before character/facility bonuses`} />
      <IndustrialMetric label="Missing volume" value={plan.missingVolumeM3.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " m³"} detail={plan.totalMissingStacks + " material type(s) to source"} />
    </div>
    {plan.market?.available && <div className="industrial-metrics industrial-market-metrics">
      <IndustrialMetric label="Cash to complete" value={plan.market.shortageMarketCost == null ? "—" : isk(plan.market.shortageMarketCost)} detail="Cheapest retained all-region sell quotes for shortages" />
      <IndustrialMetric label="Full BOM market" value={plan.market.fullBomMarketCost == null ? "—" : isk(plan.market.fullBomMarketCost)} detail="Opportunity-cost value of all required materials" />
      <IndustrialMetric label="Buy finished" value={plan.market.finishedBuyCost == null ? "—" : isk(plan.market.finishedBuyCost)} detail={plan.market.productSellRegion ? `Best retained sell · ${plan.market.productSellRegion}` : "No retained sell quote"} />
      <IndustrialMetric label="Immediate sale" value={plan.market.immediateSaleRevenue == null ? "—" : isk(plan.market.immediateSaleRevenue)} detail="Best retained all-region buy order" />
    </div>}
    {plan.market?.available && <article className="industrial-build-buy-strip"><span><small>Cash build vs buy</small><strong>{plan.market.cashBuildVsBuyDelta == null ? "—" : `${plan.market.cashBuildVsBuyDelta >= 0 ? "+" : ""}${isk(plan.market.cashBuildVsBuyDelta)}`}</strong></span><span><small>Economic build vs buy</small><strong>{plan.market.economicBuildVsBuyDelta == null ? "—" : `${plan.market.economicBuildVsBuyDelta >= 0 ? "+" : ""}${isk(plan.market.economicBuildVsBuyDelta)}`}</strong></span><small>Positive = manufacturing materials are cheaper than buying the finished output. Job installation cost, facility/rig modifiers, taxes and hauling are not yet included.</small></article>}
    {plan.productionChain?.some((node: any) => node.mode === "build" || node.mode === "mixed-build-market") && <ProductionChainView plan={plan} />}
    <article className="industrial-panel industrial-full-panel">
      <div className="industrial-panel-head"><div><p className="eyebrow">BILL OF MATERIALS</p><h3>{plan.productName}</h3><p>{plan.blueprintName} · ME {plan.materialEfficiency}% / TE {plan.timeEfficiency}%</p></div><span className={`industrial-status ${plan.runsAvailable && plan.skillsReady ? "live" : ""}`}>{plan.runsAvailable && plan.skillsReady ? "READY" : "CHECK REQUIREMENTS"}</span></div>
      <div className="industrial-table industrial-material-table">
        <div className="industrial-table-row heading"><span>Material</span><span>Base</span><span>Required</span><span>Owned</span><span>Use stock</span><span>Owners</span><span>Missing</span><span>Shortage cost</span></div>
        {plan.materials.map((material: any) => <div className={`industrial-table-row ${material.missing > 0 ? "shortage" : "covered"}`} key={material.typeId}><span className="industrial-material-name"><strong>{material.name}</strong>{material.buildOptions?.length > 0 && <small>Buildable: {material.buildOptions.map((option: any) => `${option.characterName} · ${option.blueprintName} · ${option.runsNeeded} run${option.runsNeeded === 1 ? "" : "s"}${option.skillRequirements?.every((skill: any) => skill.met) ? " · skills ready" : " · skill blocked"}${option.canCoverRuns ? "" : " · insufficient BPC runs"}`).join(" | ")}</small>}</span><span>{number(material.baseRequired)}</span><span>{number(material.required)}</span><span>{number(material.owned)}</span><span>{number(material.usedFromStock)}</span><span className="industrial-owner-breakdown">{material.ownership?.length ? material.ownership.filter((owner: any) => owner.used > 0).map((owner: any) => `${owner.characterName}: ${number(owner.used)}`).join(" · ") : "—"}</span><span>{number(material.missing)}</span><span>{material.missingMarketCost == null ? "—" : isk(material.missingMarketCost)}</span></div>)}
      </div>
      <div className="industrial-skill-strip">{plan.skills.map((skill: any) => <span className={skill.met ? "ready" : "missing"} key={skill.typeId}>{skill.name} {skill.requiredLevel} · trained {skill.trainedLevel}</span>)}</div>
      {plan.stockSources?.length > 1 && <div className="industrial-stock-sources"><strong>Stock pool</strong><span>{plan.stockSources.map((source: any) => source.characterName).join(" · ")}</span></div>}
      <small className="industrial-plan-scope">{plan.scope}</small>
    </article>
  </div>;
}

function ProductionChainView({ plan }: { plan: any }) {
  const buildNodes = plan.productionChain.filter((node: any) => node.mode === "build" || node.mode === "mixed-build-market");
  function nodeView(node: any): any {
    const built = node.mode === "build" || node.mode === "mixed-build-market";
    return <div className={`industrial-chain-node depth-${Math.min(5, node.depth ?? 0)}`} key={`${node.depth}-${node.typeId}-${node.name}`}>
      <div className="industrial-chain-node-head">
        <span><strong>{node.name}</strong><small>{number(node.required)} required · {number(node.stockUsed ?? 0)} from stock</small></span>
        <span className={`industrial-status ${built ? "live" : ""}`}>{built ? node.mode === "mixed-build-market" ? "PARTIAL BUILD" : "BUILD" : node.mode === "stock" ? "STOCK" : "MARKET"}</span>
      </div>
      {built && <div className="industrial-chain-blueprint"><strong>{node.blueprint.characterName}</strong><span>{node.blueprint.blueprintName} · ME {node.blueprint.materialEfficiency}% / TE {node.blueprint.timeEfficiency}% · {number(node.blueprint.runs)} run{node.blueprint.runs === 1 ? "" : "s"}</span>{node.marketRemainder > 0 && <small>{number(node.marketRemainder)} unit(s) still need market sourcing after available BPC runs.</small>}{node.blueprint.skillRequirements?.some((skill: any) => !skill.met) && <small>Skill gap: {node.blueprint.skillRequirements.filter((skill: any) => !skill.met).map((skill: any) => `${skill.name} ${skill.requiredLevel}`).join(" · ")}</small>}</div>}
      {node.children?.length > 0 && <div className="industrial-chain-children">{node.children.map((child: any) => nodeView(child))}</div>}
    </div>;
  }
  return <article className="industrial-panel industrial-full-panel industrial-chain-panel">
    <div className="industrial-panel-head"><div><p className="eyebrow">OWNED PRODUCTION CHAIN</p><h3>Build subcomponents before buying</h3><p>Sage consumes pooled stock once, then recursively follows blueprints the connected characters actually own. BPC run shortages fall back to market leaves.</p></div><span className="industrial-status live">{buildNodes.length} build path{buildNodes.length === 1 ? "" : "s"}</span></div>
    {plan.market?.ownedChainMarketCost != null && <div className="industrial-chain-cost"><span>Market cash after owned sub-builds</span><strong>{isk(plan.market.ownedChainMarketCost)}</strong></div>}
    <div className="industrial-chain-tree">{plan.productionChain.map((node: any) => nodeView(node))}</div>
    {plan.chainLeafRequirements?.length > 0 && <div className="industrial-chain-leaves"><strong>Remaining market leaves</strong>{plan.chainLeafRequirements.map((leaf: any) => <span key={leaf.typeId}>{leaf.name}<b>{number(leaf.quantity)}{leaf.marketCost == null ? "" : ` · ${isk(leaf.marketCost)}`}</b></span>)}</div>}
  </article>;
}
function BlueprintActivityView({ data }: { data: any }) {
  const visible = data.activities.filter((activity: any) => activity.id !== "manufacturing");
  return <div className="industrial-activity-grid">
    {visible.length ? visible.map((activity: any) => <article className="industrial-panel industrial-activity-card" key={activity.id}>
      <div className="industrial-panel-head"><div><p className="eyebrow">{activity.id.toUpperCase().replaceAll("_", " ")}</p><h3>{activity.label}</h3></div><span className="industrial-status">{duration(activity.baseTimeSeconds)}</span></div>
      {activity.materials.length > 0 && <div className="industrial-activity-section"><strong>Inputs</strong>{activity.materials.map((item: any) => <span key={item.typeId}>{item.name}<b>{number(item.quantity)}</b></span>)}</div>}
      {activity.products.length > 0 && <div className="industrial-activity-section"><strong>Outputs</strong>{activity.products.map((item: any) => <span key={item.typeId}>{item.name}<b>{item.probability == null ? number(item.quantity) : `${(item.probability * 100).toFixed(1)}% base`}</b></span>)}</div>}
      {activity.skills.length > 0 && <div className="industrial-skill-strip">{activity.skills.map((skill: any) => <span className={skill.met ? "ready" : "missing"} key={skill.typeId}>{skill.name} {skill.requiredLevel} · trained {skill.trainedLevel}</span>)}</div>}
      {!activity.materials.length && !activity.products.length && <div className="industrial-notice">No consumable material/output record is defined for this activity in the current CCP SDE.</div>}
    </article>) : <article className="industrial-panel"><div className="industrial-notice">This blueprint has no copying, research or invention activities in the current CCP SDE.</div></article>}
  </div>;
}
