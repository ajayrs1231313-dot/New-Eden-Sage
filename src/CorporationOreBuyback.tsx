import { useEffect, useMemo, useState } from "react";

type DepthItem = {
  inputName?: string | null;
  itemName: string;
  typeId: number | null;
  requestedQuantity: number;
  filledQuantity: number;
  unfilledQuantity: number;
  highestBidUsed: number | null;
  lowestBidCrossed: number | null;
  weightedAverageRealisedUnitPrice: number | null;
  ordersCrossed: number;
  totalRealisedIsk: number;
  fullMarketDepthSufficient: boolean;
  error?: string;
};

type OreSearchMatch = {
  typeId: number;
  name: string;
  categoryId: number;
  categoryName: string;
};

type DepthQuote = {
  createdAt: string;
  locationName: string;
  source: { kind: string; createdAt: string; freshRequested: boolean };
  items: DepthItem[];
  grandTotalRealisedIsk: number;
  totalUnfilledQuantity: number;
  fullMarketDepthSufficient: boolean;
};

const EXAMPLE = [
  "Hedbergite II: 34,416",
  "Hedbergite III: 13,120",
  "Hedbergite: 36,781",
  "Mordunium II: 1,529,270",
  "Mordunium IV: 3,438,525",
  "Omber II: 87,838",
  "Omber III: 97,721",
  "Omber IV: 167,962",
].join("\n");

function isk(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(Number(value));
}

function qty(value: number | null | undefined) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function parseCorpOreBuybackText(text: string) {
  const items: Array<{ name: string; quantity: number }> = [];
  const errors: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.match(/^(.+?)\s*[:=\t]\s*([0-9][0-9,._ ]*)$/);
    const space = !colon ? line.match(/^(.+?)\s{2,}([0-9][0-9,._ ]*)$/) : null;
    const match = colon ?? space;
    if (!match) { errors.push(`Line ${index + 1}: use “Item: quantity”.`); continue; }
    const name = match[1].trim();
    const quantity = Number(match[2].replace(/[,_ .]/g, ""));
    if (!name || !Number.isSafeInteger(quantity) || quantity <= 0) { errors.push(`Line ${index + 1}: invalid item or quantity.`); continue; }
    items.push({ name, quantity });
  }
  return { items, errors };
}

function buildSummary(quote: DepthQuote, payoutPercent: number) {
  const payout = quote.grandTotalRealisedIsk * payoutPercent / 100;
  const lines = [
    `Corp Ore Buyback — ${quote.locationName}`,
    `Gross realised Jita value: ${isk(quote.grandTotalRealisedIsk)} ISK`,
    `Corp payout (${payoutPercent}%): ${isk(payout)} ISK`,
    "",
    ...quote.items.map((item) => `${item.itemName}: ${qty(item.filledQuantity)}/${qty(item.requestedQuantity)} filled @ ${isk(item.weightedAverageRealisedUnitPrice)} avg = ${isk(item.totalRealisedIsk)} ISK${item.unfilledQuantity ? ` — UNFILLED ${qty(item.unfilledQuantity)}` : ""}`),
  ];
  return lines.join("\n");
}

export function CorporationOreBuyback() {
  const [text, setText] = useState(EXAMPLE);
  const [payoutPercent, setPayoutPercent] = useState(90);
  const [oreSearch, setOreSearch] = useState("");
  const [oreMatches, setOreMatches] = useState<OreSearchMatch[]>([]);
  const [selectedOre, setSelectedOre] = useState<OreSearchMatch | null>(null);
  const [addQuantity, setAddQuantity] = useState("");
  const [oreSearchBusy, setOreSearchBusy] = useState(false);
  const [oreSearchMessage, setOreSearchMessage] = useState("Search published ore and ice types, then add the stack to the list.");
  const [quote, setQuote] = useState<DepthQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Paste ore and quantities. Sage resolves exact EVE types before walking Jita 4-4 buy-order depth.");
  const parsed = useMemo(() => parseCorpOreBuybackText(text), [text]);

  useEffect(() => {
    const query = oreSearch.trim();
    if (selectedOre?.name === query) return;
    if (query.length < 2) {
      setOreMatches([]);
      setOreSearchBusy(false);
      if (query) setOreSearchMessage("Type at least 2 characters to search ore and ice market types.");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setOreSearchBusy(true);
      void window.sage.searchOreMarketTypes(query, 12).then((matches) => {
        if (cancelled) return;
        setOreMatches(matches);
        setOreSearchMessage(matches.length ? "Choose a Jita buyback item, enter the quantity, then add it." : "No ore or ice market type matched that search.");
      }).catch((error) => {
        if (cancelled) return;
        setOreMatches([]);
        setOreSearchMessage(error instanceof Error ? error.message : "Ore search failed.");
      }).finally(() => {
        if (!cancelled) setOreSearchBusy(false);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [oreSearch, selectedOre]);

  function chooseOre(match: OreSearchMatch) {
    setSelectedOre(match);
    setOreSearch(match.name);
    setOreMatches([]);
    setOreSearchMessage(`Selected ${match.name}. Enter the stack quantity.`);
  }

  function addOreToList() {
    if (!selectedOre) { setOreSearchMessage("Choose an ore or ice type from the search results first."); return; }
    const amount = Number(addQuantity.replace(/[,_ .]/g, ""));
    if (!Number.isSafeInteger(amount) || amount <= 0) { setOreSearchMessage("Enter a positive whole-number quantity."); return; }
    const line = `${selectedOre.name}: ${qty(amount)}`;
    setText((current) => {
      const trimmed = current.trimEnd();
      return trimmed ? `${trimmed}\n${line}` : line;
    });
    setQuote(null);
    setOreSearch("");
    setSelectedOre(null);
    setAddQuantity("");
    setOreMatches([]);
    setOreSearchMessage(`Added ${selectedOre.name} × ${qty(amount)} to the buyback list.`);
  }

  async function calculate(fresh = false) {
    if (!parsed.items.length || parsed.errors.length) { setMessage(parsed.errors[0] ?? "Add at least one ore stack."); return; }
    setBusy(true);
    setMessage(fresh ? "Refreshing exact Jita depth…" : "Walking Jita 4-4 market depth…");
    try {
      const result = await window.sage.quoteMarketDepth({
        items: parsed.items,
        regionId: 10000002,
        locationId: 60003760,
        side: "buy",
        fresh,
      }) as DepthQuote;
      setQuote(result);
      const failures = result.items.filter((item) => item.error || item.unfilledQuantity > 0);
      setMessage(failures.length ? `Calculated with ${failures.length} item${failures.length === 1 ? "" : "s"} needing attention.` : "Full requested quantity can be instant-sold into the captured Jita depth.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Market-depth calculation failed.");
    } finally { setBusy(false); }
  }

  async function copy(textValue: string, label: string) {
    await navigator.clipboard.writeText(textValue);
    setMessage(label);
  }

  const payout = quote ? quote.grandTotalRealisedIsk * payoutPercent / 100 : 0;
  return <div className="corp-buyback">
    <div className="corp-buyback-head">
      <div><p className="eyebrow">CORPORATION · MARKET OPERATIONS</p><h3>Corp Ore Buyback</h3><p>Instant-sell valuation walks the actual Jita 4-4 buy book. It does not multiply the whole stack by the top bid.</p></div>
      <div className="corp-buyback-hub"><span>PRICING HUB</span><strong>Jita 4-4</strong><small>Station 60003760 · Buy orders</small></div>
    </div>

    <div className="corp-buyback-controls">
      <div className="corp-buyback-entry">
        <div className="corp-buyback-quick-add">
          <div className="corp-buyback-search-field">
            <span>Jita ore search</span>
            <input
              className="corp-buyback-search-input"
              value={oreSearch}
              onChange={(event) => { setOreSearch(event.target.value); setSelectedOre(null); }}
              placeholder="Search ore / ice type…"
              autoComplete="off"
              spellCheck={false}
            />
            {(oreMatches.length > 0 || oreSearchBusy) && <div className="corp-buyback-search-results">
              {oreSearchBusy && <div className="corp-buyback-search-loading">Searching…</div>}
              {!oreSearchBusy && oreMatches.map((match) => <button type="button" key={match.typeId} onClick={() => chooseOre(match)}>
                <strong>{match.name}</strong><small>Type {match.typeId} · {match.categoryName}</small>
              </button>)}
            </div>}
          </div>
          <label className="corp-buyback-add-quantity"><span>Quantity</span><input
            value={addQuantity}
            onChange={(event) => setAddQuantity(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOreToList(); } }}
            placeholder="e.g. 250,000"
            inputMode="numeric"
          /></label>
          <button type="button" className="corp-buyback-add-button" disabled={!selectedOre || !addQuantity.trim()} onClick={addOreToList}>Add to list</button>
        </div>
        <div className="corp-buyback-search-message">{oreSearchMessage}</div>
        <label><span>Ore + quantities</span><textarea value={text} onChange={(event) => { setText(event.target.value); setQuote(null); }} spellCheck={false} /></label>
      </div>
      <div className="corp-buyback-policy">
        <label><span>Corp payout %</span><input type="number" min="0" max="100" step="0.1" value={payoutPercent} onChange={(event) => setPayoutPercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label>
        <small>The underlying quote stays at 100%. This percentage is applied only to the displayed corp payout.</small>
        <button className="primary" disabled={busy || !parsed.items.length || parsed.errors.length > 0} onClick={() => void calculate(false)}>{busy ? "Calculating…" : "Calculate"}</button>
        <button className="sync" disabled={busy || !parsed.items.length || parsed.errors.length > 0} onClick={() => void calculate(true)}>Recalculate using fresh market data</button>
      </div>
    </div>
    {parsed.errors.length > 0 && <div className="corp-buyback-errors">{parsed.errors.map((error) => <div key={error}>{error}</div>)}</div>}

    {quote && <>
      <div className="corp-buyback-totals">
        <article><span>Gross realised value</span><strong>{isk(quote.grandTotalRealisedIsk)} ISK</strong><small>100% executable Jita value</small></article>
        <article><span>Corp payout</span><strong>{isk(payout)} ISK</strong><small>{payoutPercent}% of realised value</small></article>
        <article className={quote.fullMarketDepthSufficient ? "" : "warning"}><span>Market depth</span><strong>{quote.fullMarketDepthSufficient ? "SUFFICIENT" : "INSUFFICIENT"}</strong><small>{quote.totalUnfilledQuantity ? `${qty(quote.totalUnfilledQuantity)} units unfilled` : "All stacks filled"}</small></article>
      </div>
      <div className="corp-buyback-actions">
        <button onClick={() => void copy(JSON.stringify(quote, null, 2), "Detailed results copied.")}>Copy Results</button>
        <button onClick={() => void copy(buildSummary(quote, payoutPercent), "Buyback summary copied.")}>Copy Summary</button>
        <span>Source: {quote.source.kind} · {new Date(quote.source.createdAt).toLocaleString()}</span>
      </div>
      <div className="corp-buyback-table-wrap"><table className="corp-buyback-table">
        <thead><tr><th>Item</th><th>Quantity</th><th>Best Bid</th><th>Weighted Avg.</th><th>Lowest Bid Used</th><th>Orders Crossed</th><th>Filled</th><th>Unfilled</th><th>Total ISK</th></tr></thead>
        <tbody>{quote.items.map((item, index) => <tr key={`${item.typeId ?? item.itemName}-${index}`} className={item.error || !item.fullMarketDepthSufficient ? "warning" : ""}>
          <td><strong>{item.itemName}</strong><small>{item.typeId ? `Type ${item.typeId}` : item.error ?? "Unresolved"}</small>{item.error && <em>{item.error}</em>}</td>
          <td>{qty(item.requestedQuantity)}</td><td>{isk(item.highestBidUsed)}</td><td>{isk(item.weightedAverageRealisedUnitPrice)}</td><td>{isk(item.lowestBidCrossed)}</td><td>{qty(item.ordersCrossed)}</td><td>{qty(item.filledQuantity)}</td><td>{qty(item.unfilledQuantity)}</td><td>{isk(item.totalRealisedIsk)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <div className="system-status">{message}</div>
  </div>;
}
