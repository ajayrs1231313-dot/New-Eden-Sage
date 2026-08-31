import { useEffect, useMemo, useState } from "react";
import { IskGlyph } from "./IskIcons";

type InventionCategory = "all" | "t1" | "ship" | "module" | "rig" | "drone" | "charge" | "subsystem" | "other";
type InventionSort = "expected" | "roi" | "chance" | "attempt" | "run";
type SuccessFloor = "all" | "25" | "40" | "50" | "60";
type TechFilter = "all" | "2" | "3";

interface Props {
  analysis: any;
  busy: boolean;
  decryptor: string;
  onDecryptorChange(value: string): void;
  onRefresh(): void;
}

const PAGE_SIZE = 12;
const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 });

function isk(value: unknown, compactValue = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unpriced";
  return `${compactValue ? compact.format(number) : integer.format(number)} ISK`;
}

function probability(value: unknown, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : "—";
}

function categoryLabel(value: string) {
  return value === "ship" ? "Ships"
    : value === "module" ? "Ship Modules"
    : value === "rig" ? "Rig Components"
    : value === "drone" || value === "fighter" ? "Drones & Fighters"
    : value === "charge" ? "Ammo & Charges"
    : value === "subsystem" ? "Subsystems"
    : "Other";
}

function categoryGlyph(value: string) {
  return value === "ship" ? "◆"
    : value === "module" ? "⬢"
    : value === "rig" ? "◈"
    : value === "drone" || value === "fighter" ? "✦"
    : value === "charge" ? "▰"
    : value === "subsystem" ? "◇"
    : "●";
}

function expectedRoi(item: any) {
  const attempt = Number(item.attemptCost);
  const manufacturing = Number(item.manufacturingCost);
  const chance = Number(item.probability);
  const profit = Number(item.expectedProfitPerAttempt);
  if (![attempt, manufacturing, chance, profit].every(Number.isFinite)) return null;
  const expectedCapitalConsumed = attempt + Math.max(0, chance) * manufacturing;
  return expectedCapitalConsumed > 0 ? profit / expectedCapitalConsumed * 100 : null;
}

function matchesCategory(item: any, category: InventionCategory) {
  if (category === "all") return true;
  if (category === "t1") return item.sourceTechLevel === 1 || item.sourceMetaGroupId === 1;
  if (category === "drone") return item.productCategory === "drone" || item.productCategory === "fighter";
  if (category === "other") return !["ship", "module", "rig", "drone", "fighter", "charge", "subsystem"].includes(String(item.productCategory));
  return item.productCategory === category;
}

function rowKey(item: any) {
  return `${item.sourceBlueprintTypeId}:${item.inventedBlueprintTypeId}`;
}

function updateAge(timestamp: string | null | undefined) {
  if (!timestamp) return "unknown";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "unknown";
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function InventionIntelligence({ analysis, busy, decryptor, onDecryptorChange, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<InventionCategory>("all");
  const [tech, setTech] = useState<TechFilter>("all");
  const [successFloor, setSuccessFloor] = useState<SuccessFloor>("all");
  const [sort, setSort] = useState<InventionSort>("expected");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const opportunities: any[] = Array.isArray(analysis?.opportunities) ? analysis.opportunities : [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const successMinimum = successFloor === "all" ? null : Number(successFloor) / 100;
    return opportunities
      .filter((item) => !needle || `${item.sourceBlueprintName ?? ""} ${item.inventedBlueprintName ?? ""} ${item.productName ?? ""} ${item.productGroupName ?? ""}`.toLowerCase().includes(needle))
      .filter((item) => matchesCategory(item, category))
      .filter((item) => tech === "all" || Number(item.productTechLevel) === Number(tech))
      .filter((item) => successMinimum == null || Number(item.probability) >= successMinimum)
      .filter((item) => !ownedOnly || Boolean(item.ownsSourceOriginal))
      .filter((item) => !profitableOnly || Number(item.expectedProfitPerAttempt) > 0)
      .sort((left, right) => {
        if (sort === "chance") return Number(right.probability ?? -Infinity) - Number(left.probability ?? -Infinity);
        if (sort === "attempt") return Number(left.attemptCost ?? Infinity) - Number(right.attemptCost ?? Infinity);
        if (sort === "run") return Number(right.successfulRunProfit ?? -Infinity) - Number(left.successfulRunProfit ?? -Infinity);
        if (sort === "roi") return Number(expectedRoi(right) ?? -Infinity) - Number(expectedRoi(left) ?? -Infinity);
        return Number(right.expectedProfitPerAttempt ?? -Infinity) - Number(left.expectedProfitPerAttempt ?? -Infinity);
      });
  }, [opportunities, query, category, tech, successFloor, ownedOnly, profitableOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = filtered.find((item) => rowKey(item) === selectedKey) ?? pageRows[0] ?? filtered[0] ?? null;

  useEffect(() => {
    if (selected && selectedKey == null) setSelectedKey(rowKey(selected));
  }, [selected, selectedKey]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const metrics = useMemo(() => {
    const positive = opportunities
      .filter((item) => Number(item.expectedProfitPerAttempt) > 0)
      .sort((a, b) => Number(b.expectedProfitPerAttempt) - Number(a.expectedProfitPerAttempt));
    const top50Potential = positive.slice(0, 50).reduce((sum, item) => sum + Number(item.expectedProfitPerAttempt), 0);
    const best = positive[0] ?? opportunities[0] ?? null;
    const chances = opportunities.map((item) => Number(item.probability)).filter(Number.isFinite);
    const rois = opportunities.map(expectedRoi).filter((value): value is number => value != null && Number.isFinite(value));
    const averageChance = chances.length ? chances.reduce((sum, value) => sum + value, 0) / chances.length : null;
    const averageRoi = rois.length ? rois.reduce((sum, value) => sum + value, 0) / rois.length : null;
    return { positive, top50Potential, best, averageChance, averageRoi };
  }, [opportunities]);

  const hotspots = useMemo(() => {
    const grouped = new Map<string, { category: string; value: number; count: number }>();
    for (const item of opportunities) {
      const profit = Number(item.expectedProfitPerAttempt);
      if (!Number.isFinite(profit) || profit <= 0) continue;
      const key = String(item.productCategory ?? "other");
      const bucket = grouped.get(key) ?? { category: key, value: 0, count: 0 };
      bucket.value += profit;
      bucket.count += 1;
      grouped.set(key, bucket);
    }
    return [...grouped.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  }, [opportunities]);

  const profitableCount = metrics.positive.length;
  const ownedProfitableCount = metrics.positive.filter((item) => item.ownsSourceOriginal).length;
  const maxTrainingGain = opportunities.reduce((best, item) => Math.max(best, Number(item.trainingProbabilityGain) || 0), 0);
  const pricedCount = opportunities.filter((item) => Number.isFinite(Number(item.expectedProfitPerAttempt))).length;
  const best = metrics.best;

  const setFilter = (setter: () => void) => {
    setter();
    setPage(1);
  };

  return (
    <section className="invention-intelligence">
      <div className="ii-kpi-grid">
        <article className="ii-kpi ii-kpi-gold">
          <div><span>TOTAL PROFIT POTENTIAL</span><strong>{metrics.top50Potential > 0 ? isk(metrics.top50Potential, true) : "—"}</strong><small>Positive expected profit across top 50 routes</small></div>
          <b className="ii-kpi-icon"><IskGlyph name="bars" /></b>
        </article>
        <article className="ii-kpi">
          <div><span>BEST SINGLE OPPORTUNITY</span><strong>{best?.expectedProfitPerAttempt != null ? isk(best.expectedProfitPerAttempt, true) : "—"}</strong><small>{best?.productName ?? "No priced route"}</small></div>
          <b className="ii-kpi-icon ii-medal">★</b>
        </article>
        <article className="ii-kpi">
          <div><span>SUCCESS RATE (AVG)</span><strong>{metrics.averageChance == null ? "—" : probability(metrics.averageChance)}</strong><small>Current character skills + decryptor</small></div>
          <b className="ii-kpi-icon"><IskGlyph name="target" /></b>
        </article>
        <article className="ii-kpi ii-kpi-gold">
          <div><span>BLUEPRINTS ANALYSED</span><strong>{Number(analysis?.candidateCount ?? opportunities.length).toLocaleString()}</strong><small>{Number(analysis?.ownedSourceCount ?? 0).toLocaleString()} routes use an owned source BPO</small></div>
          <b className="ii-kpi-icon"><IskGlyph name="contract" /></b>
        </article>
        <article className="ii-kpi ii-kpi-gold">
          <div><span>EXPECTED ROI (AVG)</span><strong>{metrics.averageRoi == null ? "—" : `${metrics.averageRoi.toFixed(1)}%`}</strong><small>Expected profit vs expected consumed capital</small></div>
          <b className="ii-kpi-icon"><IskGlyph name="coin" /></b>
        </article>
      </div>

      <div className="ii-filter-bar">
        <label className="ii-search"><IskGlyph name="search" /><input value={query} onChange={(event) => setFilter(() => setQuery(event.target.value))} placeholder="Filter blueprints or final products..." /></label>
        <label><span>CATEGORY</span><select value={category} onChange={(event) => setFilter(() => setCategory(event.target.value as InventionCategory))}><option value="all">All Categories</option><option value="t1">T1 Source Blueprints</option><option value="ship">Ships</option><option value="module">Ship Modules</option><option value="rig">Rigs</option><option value="drone">Drones & Fighters</option><option value="charge">Ammo & Charges</option><option value="subsystem">Subsystems</option><option value="other">Other</option></select></label>
        <label><span>TECH LEVEL</span><select value={tech} onChange={(event) => setFilter(() => setTech(event.target.value as TechFilter))}><option value="all">All Tech Levels</option><option value="2">Tech II Outputs</option><option value="3">Tech III Outputs</option></select></label>
        <label><span>SUCCESS CHANCE</span><select value={successFloor} onChange={(event) => setFilter(() => setSuccessFloor(event.target.value as SuccessFloor))}><option value="all">All Chances</option><option value="25">25%+</option><option value="40">40%+</option><option value="50">50%+</option><option value="60">60%+</option></select></label>
        <label><span>SORT BY</span><select value={sort} onChange={(event) => setFilter(() => setSort(event.target.value as InventionSort))}><option value="expected">Expected Profit / Invention</option><option value="roi">Expected ROI</option><option value="chance">Success Chance</option><option value="run">Profit / Successful Run</option><option value="attempt">Lowest Invention Cost</option></select></label>
        <details className="ii-advanced">
          <summary>Advanced Filters <IskGlyph name="bars" /></summary>
          <div>
            <label><span>DECRYPTOR</span><select value={decryptor} onChange={(event) => onDecryptorChange(event.target.value)}><option value="">No decryptor</option>{(analysis?.decryptors ?? []).map((item: any) => <option value={item.typeId} key={item.typeId}>{item.name} · x{Number(item.probabilityMultiplier ?? 1).toFixed(1)} chance · {item.runModifier >= 0 ? "+" : ""}{item.runModifier} runs</option>)}</select></label>
            <label className="ii-check"><input type="checkbox" checked={ownedOnly} onChange={(event) => setFilter(() => setOwnedOnly(event.target.checked))} /><span>Owned source BPO only</span></label>
            <label className="ii-check"><input type="checkbox" checked={profitableOnly} onChange={(event) => setFilter(() => setProfitableOnly(event.target.checked))} /><span>Positive expected profit only</span></label>
          </div>
        </details>
      </div>

      <div className="ii-workspace">
        <aside className="ii-left-rail">
          <section className="ii-side-card ii-hotspots">
            <header><span className="ii-flame">♦</span><div><strong>PROFIT HOTSPOTS</strong><small>Where the expected ISK is concentrated</small></div></header>
            <div className="ii-hotspot-list">
              {hotspots.map((item, index) => <div key={item.category}><b>{index + 1}</b><i>{categoryGlyph(item.category)}</i><span>{categoryLabel(item.category)}<small>{item.count} profitable routes</small></span><strong>{isk(item.value, true)}</strong></div>)}
              {!hotspots.length && <p>No positive expected-profit categories in the current priced set.</p>}
            </div>
          </section>
          <section className="ii-side-card ii-tip">
            <header><span className="ii-bulb">☼</span><strong>TIP OF THE DAY</strong></header>
            <p>{maxTrainingGain > 0.001 ? `Your remaining invention training can add up to ${(maxTrainingGain * 100).toFixed(2)} percentage points of success chance on some routes. Compare that gain before paying for a probability-focused decryptor.` : "Compare expected profit per invention, not just successful-run profit: failed attempts still consume datacores and any selected decryptor."}</p>
            <small>Facility, tax and job-installation modifiers are not yet included in these figures.</small>
          </section>
        </aside>

        <section className="ii-table-panel">
          <div className="ii-table-head">
            <span>BLUEPRINT / PRODUCT</span><span>SUCCESS<br />CHANCE</span><span>MATERIAL COST<br />(1 RUN)</span><span>INVENTION COST<br />(ATTEMPT)</span><span>EXPECTED PROFIT<br />(INVENTION)</span><span>PROFIT / RUN</span><span>ROI</span>
          </div>
          <div className="ii-table-body">
            {pageRows.map((item) => {
              const roi = expectedRoi(item);
              const selectedRow = selected && rowKey(selected) === rowKey(item);
              return <button type="button" className={`ii-result-row${selectedRow ? " selected" : ""}`} key={rowKey(item)} onClick={() => { setSelectedKey(rowKey(item)); setShowBreakdown(false); }}>
                <span className="ii-product-cell"><img src={`sage-asset://type/${item.productTypeId}/icon?size=64`} alt="" /><span><strong>{item.inventedBlueprintName}</strong><small>{item.productName} · {item.productGroupName ?? categoryLabel(String(item.productCategory))}</small>{item.ownsSourceOriginal && <em>OWNED BPO</em>}</span></span>
                <span className="ii-chance"><strong>{probability(item.probability)}</strong><i style={{ "--chance": `${Math.max(0, Math.min(100, Number(item.probability ?? 0) * 100))}%` } as React.CSSProperties} /></span>
                <span>{item.manufacturingCostPerRun == null ? "Unpriced" : isk(item.manufacturingCostPerRun)}</span>
                <span>{item.attemptCost == null ? "Unpriced" : isk(item.attemptCost)}</span>
                <span className={`ii-profit ${Number(item.expectedProfitPerAttempt) >= 0 ? "positive" : "negative"}`}>{item.expectedProfitPerAttempt == null ? "Unpriced" : isk(item.expectedProfitPerAttempt)}</span>
                <span className={Number(item.successfulRunProfit) >= 0 ? "positive" : "negative"}>{item.successfulRunProfit == null ? "Unpriced" : isk(item.successfulRunProfit)}</span>
                <span className={roi != null && roi >= 0 ? "positive ii-roi" : "negative ii-roi"}>{roi == null ? "—" : `${roi.toFixed(1)}%`}</span>
              </button>;
            })}
            {!pageRows.length && <div className="ii-empty">No invention routes match the current filters.</div>}
          </div>
          <footer className="ii-pagination"><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><span>Page {safePage} of {pageCount} · {filtered.length.toLocaleString()} routes</span><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></footer>
        </section>

        <aside className="ii-right-rail">
          <section className="ii-side-card ii-calculator">
            <header><IskGlyph name="bars" /><strong>INVENTION PROFIT<br />CALCULATOR</strong></header>
            {selected ? <>
              <div className="ii-selected-product"><img src={`sage-asset://type/${selected.productTypeId}/icon?size=64`} alt="" /><span><strong>{selected.productName}</strong><small>{selected.inventedBlueprintName}</small></span></div>
              <p>Select a blueprint row to inspect:</p>
              <ul><li>Material Requirements <b>✓</b></li><li>Datacore / Invention Inputs <b>✓</b></li><li>Success Probability <b>✓</b></li><li>Profit Projection <b>✓</b></li></ul>
              <button className="ii-outline-button" onClick={() => setShowBreakdown((value) => !value)}>{showBreakdown ? "Close Breakdown" : "Open Calculator"}</button>
              {showBreakdown && <div className="ii-breakdown">
                <div><span>Success chance</span><strong>{probability(selected.probability, 2)}</strong></div>
                <div><span>Attempt cost</span><strong>{selected.attemptCost == null ? "Unpriced" : isk(selected.attemptCost)}</strong></div>
                <div><span>BPC result</span><strong>{selected.outputRuns} runs · ME {selected.materialEfficiency} · TE {selected.timeEfficiency}</strong></div>
                <div><span>Expected profit</span><strong className={Number(selected.expectedProfitPerAttempt) >= 0 ? "positive" : "negative"}>{selected.expectedProfitPerAttempt == null ? "Unpriced" : isk(selected.expectedProfitPerAttempt)}</strong></div>
                <h5>Invention inputs</h5>
                {(selected.inventionMaterials ?? []).map((line: any, index: number) => <small key={`${line.typeId}:${index}`}>{line.quantity}× {line.name}<b>{line.cost == null ? "No quote" : isk(line.cost)}</b></small>)}
              </div>}
            </> : <p>No route is selected.</p>}
          </section>

          <section className="ii-side-card ii-insights">
            <header><IskGlyph name="pulse" /><strong>MARKET INSIGHTS</strong></header>
            <div><span><b>{profitableCount.toLocaleString()}</b> routes currently have positive expected invention profit</span><i>↗</i></div>
            <div><span><b>{ownedProfitableCount.toLocaleString()}</b> profitable routes use a source BPO already owned by this character</span><i>{ownedProfitableCount ? "↗" : "="}</i></div>
            <div><span><b>{pricedCount.toLocaleString()} / {opportunities.length.toLocaleString()}</b> routes have a complete expected-profit price basis</span><i>{pricedCount === opportunities.length ? "=" : "!"}</i></div>
            <div><span>Maximum remaining skill improvement: <b>+{(maxTrainingGain * 100).toFixed(2)} pp</b></span><i>{maxTrainingGain > 0.001 ? "↗" : "="}</i></div>
          </section>
        </aside>
      </div>

      <footer className="ii-premium-banner">
        <span>★</span><strong>PREMIUM OPPORTUNITY</strong><p>{best ? `${best.productName} leads the current ranked set at ${isk(best.expectedProfitPerAttempt, true)} expected profit per invention attempt.` : "No positive expected-profit route is currently priced."}</p><small>Last updated: {updateAge(analysis?.generatedAt)}</small><button onClick={onRefresh} disabled={busy} title="Refresh invention prices"><IskGlyph name="reset" /></button>
      </footer>
    </section>
  );
}
