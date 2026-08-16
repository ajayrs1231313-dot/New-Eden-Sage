import { useEffect, useRef, useState } from "react";
import "./Loot.css";

type LootSearchResult = {
  typeId: number;
  name: string;
  category: string;
  group: string;
  marketGroup: string;
};

type LootRoute = {
  id: string;
  kind: "invention" | "manufacturing" | "reaction" | "copying" | "reprocessing" | "deadspace" | "officer";
  title: string;
  summary: string;
  steps: string[];
  sourceLabel: string;
  sourceUrl?: string;
  chanceNote?: string;
  intelligence: {
    heading: string;
    classification: string;
    facts: Array<{ label: string; value: string }>;
    chain?: string[];
    finding?: string[];
    warnings?: string[];
    probability: { status: "verified" | "unverified"; label: string; value?: number };
  };
  details?: {
    blueprintTypeId?: number;
    blueprintName?: string;
    sourceBlueprintTypeId?: number;
    sourceBlueprintName?: string;
    materials?: Array<{ typeId: number; name: string; quantity: number }>;
    skills?: Array<{ typeId: number; name: string; level: number }>;
    products?: Array<{ typeId: number; name: string; quantity: number; probability: number | null }>;
    site?: string;
    rating?: string;
    faction?: string;
    regions?: string[];
    npc?: string;
  };
};

type LootResult = {
  item: { typeId: number; name: string; category: string; group: string; marketGroup: string };
  routes: LootRoute[];
  exact: boolean;
  note: string;
  sources: string[];
};

const routeLabels: Record<LootRoute["kind"], string> = {
  invention: "Invention",
  manufacturing: "Manufacturing",
  reaction: "Reaction",
  copying: "Blueprint copy",
  reprocessing: "Reprocessing",
  deadspace: "PvE / Deadspace",
  officer: "Officer drop",
};

export function Loot() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LootSearchResult[]>([]);
  const [selected, setSelected] = useState<LootSearchResult | null>(null);
  const [result, setResult] = useState<LootResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setMatches([]);
      setSearching(false);
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      (window.sage as any)
        .searchLootItems(needle, 60)
        .then((rows: LootSearchResult[]) => {
          if (sequence !== searchSequence.current) return;
          setMatches(rows);
          setError("");
        })
        .catch((value: unknown) => {
          if (sequence !== searchSequence.current) return;
          setMatches([]);
          setError(value instanceof Error ? value.message : String(value));
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false);
        });
    }, 130);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function choose(item: LootSearchResult) {
    setSelected(item);
    setMatches([]);
    setQuery(item.name);
    setLoading(true);
    setError("");
    try {
      const value = (await (window.sage as any).getLootAcquisition(item.typeId)) as LootResult;
      setResult(value);
    } catch (value) {
      setResult(null);
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="loot-workspace">
      <header className="loot-hero">
        <div>
          <div className="loot-eyebrow">ACQUISITION INTELLIGENCE</div>
          <h2>Find the actual source</h2>
          <p>Search any item and Sage will show how to obtain it without simply buying it.</p>
        </div>
        <div className="loot-rule">Verified routes only</div>
      </header>

      <div className="loot-search-shell">
        <label htmlFor="loot-search">Item</label>
        <div className="loot-search-row">
          <input
            id="loot-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            autoComplete="off"
            placeholder="Hulk Blueprint, Pithum C-Type Medium Shield Booster, Estamel's Modified..."
          />
          <span className={searching ? "loot-search-state active" : "loot-search-state"}>{searching ? "Searching…" : "EVE item search"}</span>
        </div>
        {matches.length > 0 && !selected && (
          <div className="loot-results" role="listbox" aria-label="Loot item search results">
            {matches.map((item) => (
              <button key={item.typeId} type="button" onClick={() => void choose(item)}>
                <span className="loot-result-name">{item.name}</span>
                <span className="loot-result-meta">{item.group} · {item.category}</span>
              </button>
            ))}
          </div>
        )}
        {!searching && query.trim() && !selected && matches.length === 0 && !error && (
          <div className="loot-empty-search">No published EVE item matched that search.</div>
        )}
      </div>

      {error && <div className="loot-error">{error}</div>}

      {loading && (
        <div className="loot-loading">
          <strong>Tracing acquisition routes…</strong>
          <span>Checking industry, PvE and item-source records.</span>
        </div>
      )}

      {!loading && result && (
        <div className="loot-detail">
          <div className="loot-item-heading">
            <div>
              <div className="loot-eyebrow">SELECTED ITEM</div>
              <h2>{result.item.name}</h2>
              <p>{result.item.marketGroup} · {result.item.group}</p>
            </div>
            <div className={result.exact ? "loot-verdict exact" : "loot-verdict"}>{result.exact ? `${result.routes.length} verified route${result.routes.length === 1 ? "" : "s"}` : "No verified route"}</div>
          </div>

          <div className="loot-note">{result.note}</div>

          {result.routes.length > 0 ? (
            <div className="loot-route-list">
              {result.routes.map((route, routeIndex) => (
                <div className="loot-route-pair" key={route.id}>
                <article className="loot-route">
                  <div className="loot-route-topline">
                    <span className="loot-route-number">{String(routeIndex + 1).padStart(2, "0")}</span>
                    <span className={`loot-route-kind ${route.kind}`}>{routeLabels[route.kind]}</span>
                  </div>
                  <h3>{route.title}</h3>
                  <p className="loot-route-summary">{route.summary}</p>

                  <ol className="loot-steps">
                    {route.steps.map((step, index) => <li key={`${route.id}:step:${index}`}>{step}</li>)}
                  </ol>

                  {(route.details?.materials?.length || route.details?.skills?.length || route.details?.products?.length) ? (
                    <div className="loot-route-data">
                      {route.details?.materials && route.details.materials.length > 0 && (
                        <div>
                          <strong>Inputs</strong>
                          <ul>{route.details.materials.map((item) => <li key={`${route.id}:m:${item.typeId}`}>{item.quantity}× {item.name}</li>)}</ul>
                        </div>
                      )}
                      {route.details?.skills && route.details.skills.length > 0 && (
                        <div>
                          <strong>Required skills</strong>
                          <ul>{route.details.skills.map((item) => <li key={`${route.id}:s:${item.typeId}`}>{item.name} {item.level}</li>)}</ul>
                        </div>
                      )}
                      {route.details?.products && route.details.products.length > 0 && (
                        <div>
                          <strong>{route.kind === "reprocessing" ? "Example source items" : "Outputs"}</strong>
                          <ul>{route.details.products.map((item) => <li key={`${route.id}:p:${item.typeId}`}>{item.quantity}× {item.name}{item.probability != null ? ` · ${(item.probability * 100).toFixed(1)}% base` : ""}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {route.chanceNote && <div className="loot-chance">{route.chanceNote}</div>}
                  <footer className="loot-source"><span>Source</span>{route.sourceLabel}</footer>
                </article>
                <aside className="loot-intelligence" aria-label={`Source intelligence for ${route.title}`}>
                  <div className="loot-intelligence-title">
                    <div>
                      <div className="loot-eyebrow">SOURCE INTELLIGENCE</div>
                      <h3>{route.intelligence.heading}</h3>
                    </div>
                    <span>{route.intelligence.classification}</span>
                  </div>

                  <dl className="loot-intelligence-facts">
                    {route.intelligence.facts.map((fact, index) => (
                      <div key={`${route.id}:fact:${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                    ))}
                  </dl>

                  {route.intelligence.chain && route.intelligence.chain.length > 0 && (
                    <div className="loot-chain">
                      <strong>Acquisition chain</strong>
                      <ol>{route.intelligence.chain.map((step, index) => <li key={`${route.id}:chain:${index}`}>{step}</li>)}</ol>
                    </div>
                  )}

                  {route.intelligence.finding && route.intelligence.finding.length > 0 && (
                    <div className="loot-guidance">
                      <strong>{route.kind === "deadspace" ? "Finding the site" : "How to obtain it"}</strong>
                      {route.intelligence.finding.map((line, index) => <p key={`${route.id}:finding:${index}`}>{line}</p>)}
                    </div>
                  )}

                  <div className={`loot-probability ${route.intelligence.probability.status}`}>
                    <strong>{route.intelligence.probability.label}</strong>
                    {route.intelligence.probability.value != null && <span>{(route.intelligence.probability.value * 100).toFixed(1)}%</span>}
                  </div>

                  {route.intelligence.warnings && route.intelligence.warnings.length > 0 && (
                    <ul className="loot-warnings">{route.intelligence.warnings.map((warning, index) => <li key={`${route.id}:warning:${index}`}>{warning}</li>)}</ul>
                  )}
                </aside>
                </div>
              ))}
            </div>
          ) : (
            <div className="loot-no-route">
              <strong>Sage has no source it can prove for this item yet.</strong>
              <p>It will not invent an escalation, NPC, mission, LP store or drop location just to fill the box.</p>
            </div>
          )}
        </div>
      )}

      {!loading && !result && !error && (
        <div className="loot-start">
          <div className="loot-start-mark">⌖</div>
          <strong>Pick an item above.</strong>
          <span>Market purchasing is excluded by design.</span>
        </div>
      )}
    </section>
  );
}
