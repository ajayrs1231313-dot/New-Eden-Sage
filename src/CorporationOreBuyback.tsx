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

type BuybackResourceKind = "ore" | "ice" | "gas" | "salvage";

const BUYBACK_RESOURCE_LABELS: Record<BuybackResourceKind, string> = {
  ore: "Ore",
  ice: "Ice",
  gas: "Gas",
  salvage: "T2 Salvage",
};


type BuybackContractCandidate = {
  contractId:number;
  contract:any;
  items:Array<any>;
  rejected:Array<any>;
  eligible:boolean;
  error?:string;
  grossValueIsk?:number;
  payoutIsk?:number;
  payoutPercent?:number;
  corpMarginIsk?:number;
  quoteCreatedAt?:string;
  valuationSource?:unknown;
  fullMarketDepthSufficient?:boolean;
};

function displayIsk(value: unknown) {
  const numeric=Number(value??0);
  return `${new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}).format(Number.isFinite(numeric)?numeric:0)} ISK`;
}

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
    `Corp Resource Buyback — ${quote.locationName}`,
    `Gross realised Jita value: ${isk(quote.grandTotalRealisedIsk)} ISK`,
    `Corp payout (${payoutPercent}%): ${isk(payout)} ISK`,
    "",
    ...quote.items.map((item) => `${item.itemName}: ${qty(item.filledQuantity)}/${qty(item.requestedQuantity)} filled @ ${isk(item.weightedAverageRealisedUnitPrice)} avg = ${isk(item.totalRealisedIsk)} ISK${item.unfilledQuantity ? ` — UNFILLED ${qty(item.unfilledQuantity)}` : ""}`),
  ];
  return lines.join("\n");
}

export function CorporationOreBuyback({ corporation }: { corporation?: { characterId?: string; characterName?: string; name?: string } | null }) {
  const [text, setText] = useState(EXAMPLE);
  const [payoutPercent, setPayoutPercent] = useState(90);
  const [resourceKind, setResourceKind] = useState<BuybackResourceKind>("ore");
  const [oreSearch, setOreSearch] = useState("");
  const [oreMatches, setOreMatches] = useState<OreSearchMatch[]>([]);
  const [selectedOre, setSelectedOre] = useState<OreSearchMatch | null>(null);
  const [addQuantity, setAddQuantity] = useState("");
  const [oreSearchBusy, setOreSearchBusy] = useState(false);
  const [oreSearchMessage, setOreSearchMessage] = useState("Search ore market types, then add the stack to the list.");
  const [quote, setQuote] = useState<DepthQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Paste resources and quantities. Sage resolves exact EVE types, then values them against live Jita 4-4 ESI buy orders.");
  const parsed = useMemo(() => parseCorpOreBuybackText(text), [text]);

  const characterId = String(corporation?.characterId ?? "");
  const [contractCandidates,setContractCandidates]=useState<BuybackContractCandidate[]>([]);
  const [buybackLedger,setBuybackLedger]=useState<any[]>([]);
  const [canManageBuybacks,setCanManageBuybacks]=useState(false);
  const [contractBusy,setContractBusy]=useState(false);
  const [contractMessage,setContractMessage]=useState("Create an Item Exchange contract to the corporation with BUYBACK in the title, then sync it here.");
  const [historyStatus,setHistoryStatus]=useState("all");
  const [historySearch,setHistorySearch]=useState("");
  const [historyFrom,setHistoryFrom]=useState("");
  const [historyTo,setHistoryTo]=useState("");

  async function loadBuybackLedger() {
    if(!characterId) return;
    try {
      const result=await window.sage.listBuybackRequests({characterId});
      setBuybackLedger(Array.isArray(result?.requests)?result.requests:[]);
      setCanManageBuybacks(Boolean(result?.can_manage));
    } catch (error) {
      setContractMessage(error instanceof Error ? error.message : "Could not load corporation buyback history.");
    }
  }

  useEffect(()=>{ void loadBuybackLedger(); },[characterId]);

  async function syncContracts() {
    if(!characterId) return;
    setContractBusy(true);
    setContractMessage("Reading your outstanding corporation BUYBACK contracts from EVE and valuing eligible items...");
    try {
      const result=await window.sage.syncBuybackContracts(characterId);
      const found=Array.isArray(result?.contracts)?result.contracts:[];
      setContractCandidates(found);
      setContractMessage(found.length ? `Found ${found.length} BUYBACK contract${found.length===1?"":"s"}. Review the payout and submit the one you want paid.` : "No outstanding Item Exchange contracts to your corporation with BUYBACK in the title were found.");
      await loadBuybackLedger();
    } catch(error) {
      setContractMessage(error instanceof Error ? error.message : "Buyback contract sync failed.");
    } finally {
      setContractBusy(false);
    }
  }

  async function submitContract(candidate:BuybackContractCandidate) {
    if(!characterId) return;
    setContractBusy(true);
    try {
      const result=await window.sage.submitBuybackRequest({characterId,candidate,detectedAt:new Date().toISOString()});
      const replay=Boolean(result?.idempotent_replay);
      setContractMessage(replay ? `Contract #${candidate.contractId} was already submitted.` : `Contract #${candidate.contractId} submitted. Corporation directors have been notified in Sage.`);
      await loadBuybackLedger();
    } catch(error) {
      setContractMessage(error instanceof Error ? error.message : "Could not submit this buyback.");
    } finally {
      setContractBusy(false);
    }
  }

  async function closeBuyback(requestId:string,status:"paid"|"rejected") {
    if(!characterId) return;
    const note=status==="rejected" ? (window.prompt("Reason for rejecting this buyback (optional):") ?? "") : "";
    setContractBusy(true);
    try {
      await window.sage.setBuybackRequestState({characterId,requestId,status,note});
      setContractMessage(status==="paid" ? "Buyback marked paid and permanently timestamped in history." : "Buyback rejected and recorded in the audit history.");
      await loadBuybackLedger();
    } catch(error) {
      setContractMessage(error instanceof Error ? error.message : "Could not update this buyback.");
    } finally {
      setContractBusy(false);
    }
  }

  const filteredBuybackLedger=useMemo(()=>{
    const needle=historySearch.trim().toLowerCase();
    const from=historyFrom ? new Date(`${historyFrom}T00:00:00`).getTime() : null;
    const to=historyTo ? new Date(`${historyTo}T23:59:59.999`).getTime() : null;
    return buybackLedger.filter((row:any)=>{
      if(historyStatus!=="all" && String(row.status)!==historyStatus) return false;
      if(needle && !`${row.issuer_character_name??""} ${row.contract_id??""} ${row.contract_title??""} ${row.paid_by_character_name??""} ${row.status??""}`.toLowerCase().includes(needle)) return false;
      const submitted=new Date(String(row.submitted_at??0)).getTime();
      if(from!=null && submitted<from) return false;
      if(to!=null && submitted>to) return false;
      return true;
    });
  },[buybackLedger,historyStatus,historySearch,historyFrom,historyTo]);

  async function exportHistory(format:"csv"|"xlsx",all=false) {
    const rows=all?buybackLedger:filteredBuybackLedger;
    const path=await window.sage.exportBuybackHistory({format,rows,label:all?"All history":"Current filtered view"});
    if(path) setContractMessage(`Buyback history exported to ${path}`);
  }


  useEffect(() => {
    const query = oreSearch.trim();
    if (selectedOre?.name === query) return;
    if (query.length < 2) {
      setOreMatches([]);
      setOreSearchBusy(false);
      if (query) setOreSearchMessage(`Type at least 2 characters to search ${BUYBACK_RESOURCE_LABELS[resourceKind].toLowerCase()} market types.`);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setOreSearchBusy(true);
      void window.sage.searchOreMarketTypes(query, 12, resourceKind).then((matches) => {
        if (cancelled) return;
        setOreMatches(matches);
        setOreSearchMessage(matches.length ? `Choose a ${BUYBACK_RESOURCE_LABELS[resourceKind].toLowerCase()} item, enter the quantity, then add it.` : `No ${BUYBACK_RESOURCE_LABELS[resourceKind].toLowerCase()} market type matched that search.`);
      }).catch((error) => {
        if (cancelled) return;
        setOreMatches([]);
        setOreSearchMessage(error instanceof Error ? error.message : "Ore search failed.");
      }).finally(() => {
        if (!cancelled) setOreSearchBusy(false);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [oreSearch, selectedOre, resourceKind]);

  function chooseOre(match: OreSearchMatch) {
    setSelectedOre(match);
    setOreSearch(match.name);
    setOreMatches([]);
    setOreSearchMessage(`Selected ${match.name}. Enter the stack quantity.`);
  }

  function addOreToList() {
    if (!selectedOre) { setOreSearchMessage(`Choose a ${BUYBACK_RESOURCE_LABELS[resourceKind].toLowerCase()} type from the search results first.`); return; }
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

  async function calculate(_fresh = true) {
    if (!parsed.items.length || parsed.errors.length) { setMessage(parsed.errors[0] ?? "Add at least one resource stack."); return; }
    setBusy(true);
    setMessage("Requesting the latest Jita 4-4 buy orders directly from ESI…");
    try {
      const result = await window.sage.quoteMarketDepth({
        items: parsed.items,
        regionId: 10000002,
        locationId: 60003760,
        side: "buy",
        fresh: true,
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

    <section className="corp-buyback-workflow">
      <div className="corp-buyback-workflow-head">
        <div>
          <span>CONTRACT WORKFLOW</span>
          <strong>{canManageBuybacks ? "Director payment queue + history" : "Your corporation buyback requests"}</strong>
          <small>Eligible EVE Item Exchange contracts must be assigned to the corporation and contain BUYBACK in the title.</small>
        </div>
        <div className="corp-buyback-workflow-actions">
          <button className="primary" disabled={contractBusy || !characterId} onClick={()=>void syncContracts()}>{contractBusy ? "SYNCING..." : "Sync Buyback Contracts"}</button>
          <button disabled={contractBusy || !characterId} onClick={()=>void loadBuybackLedger()}>{canManageBuybacks ? "Sync All Requests" : "Refresh My Requests"}</button>
        </div>
      </div>

      {contractCandidates.length>0 && <div className="corp-buyback-contracts">
        {contractCandidates.map((candidate)=>{
          const submitted=buybackLedger.some((row:any)=>Number(row.contract_id)===candidate.contractId);
          return <article key={candidate.contractId} className={candidate.eligible?"":"warning"}>
            <header>
              <div><strong>{String(candidate.contract?.title??`BUYBACK #${candidate.contractId}`)}</strong><small>Contract #{candidate.contractId} · {String(candidate.contract?.status??"unknown")}</small></div>
              <span>{candidate.eligible?displayIsk(candidate.payoutIsk):"NOT ELIGIBLE"}</span>
            </header>
            {candidate.eligible ? <>
              <div className="corp-buyback-contract-summary">
                <span><small>Jita gross</small><b>{displayIsk(candidate.grossValueIsk)}</b></span>
                <span><small>Member payout</small><b>{displayIsk(candidate.payoutIsk)}</b></span>
                <span><small>Effective rate</small><b>{Number(candidate.payoutPercent??0).toFixed(1)}%</b></span>
                <span><small>Eligible stacks</small><b>{candidate.items.length}</b></span>
              </div>
              <div className="corp-buyback-contract-items">
                {candidate.items.map((item:any)=><div key={`${item.typeId}-${item.quantity}`}><span>{item.itemName}</span><span>{qty(item.quantity)}</span><span>{item.payoutPercent}%</span><span>{displayIsk(item.payoutIsk)}</span></div>)}
              </div>
              {candidate.rejected.length>0 && <small className="corp-buyback-contract-warning">{candidate.rejected.length} unsupported stack{candidate.rejected.length===1?"":"s"} excluded from valuation.</small>}
              {!candidate.fullMarketDepthSufficient && <small className="corp-buyback-contract-warning">Jita buy-order depth is insufficient for at least one stack. Review before submitting.</small>}
              <footer>
                <button disabled={contractBusy||submitted} onClick={()=>void submitContract(candidate)}>{submitted?"ALREADY SUBMITTED":"Submit Buyback"}</button>
              </footer>
            </> : <p>{candidate.error}</p>}
          </article>;
        })}
      </div>}

      <div className="corp-buyback-ledger-head">
        <div><strong>{canManageBuybacks?"Corporation Buyback Ledger":"My Buyback History"}</strong><small>All Sage actions are timestamped. Paid records remain in permanent history.</small></div>
        <div className="corp-buyback-export-actions">
          <button onClick={()=>void exportHistory("csv")}>Export Filtered CSV</button>
          <button onClick={()=>void exportHistory("xlsx")}>Export Filtered Excel</button>
          <button onClick={()=>void exportHistory("xlsx",true)}>Export All Excel</button>
        </div>
      </div>
      <div className="corp-buyback-ledger-filters">
        <select value={historyStatus} onChange={e=>setHistoryStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option>
        </select>
        <input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="Member, contract, title, director..." />
        <label><span>From</span><input type="date" value={historyFrom} onChange={e=>setHistoryFrom(e.target.value)} /></label>
        <label><span>To</span><input type="date" value={historyTo} onChange={e=>setHistoryTo(e.target.value)} /></label>
      </div>
      <div className="corp-buyback-ledger-table-wrap">
        <table className="corp-buyback-ledger-table">
          <thead><tr><th>Submitted</th><th>Member</th><th>Contract</th><th>Status</th><th>Gross</th><th>Rate</th><th>Payout</th><th>Paid by / at</th><th>Actions</th></tr></thead>
          <tbody>
            {filteredBuybackLedger.map((row:any)=><tr key={row.id} className={`status-${row.status}`}>
              <td>{row.submitted_at?new Date(row.submitted_at).toLocaleString():"—"}</td>
              <td>{row.issuer_character_name}</td>
              <td><strong>#{row.contract_id}</strong><small>{row.contract_title}</small></td>
              <td>{String(row.status??"").toUpperCase()}</td>
              <td>{displayIsk(row.gross_value_isk)}</td>
              <td>{Number(row.payout_percent??0).toFixed(1)}%</td>
              <td><strong>{displayIsk(row.payout_isk)}</strong></td>
              <td>{row.paid_at?<><strong>{row.paid_by_character_name??"Director"}</strong><small>{new Date(row.paid_at).toLocaleString()}</small></>:row.rejected_at?<><strong>{row.rejected_by_character_name??"Director"}</strong><small>Rejected {new Date(row.rejected_at).toLocaleString()}</small></>:"—"}</td>
              <td>{canManageBuybacks&&row.status==="pending"?<div className="corp-buyback-row-actions">
                <button onClick={()=>void navigator.clipboard.writeText(String(Math.round(Number(row.payout_isk??0))))}>Copy ISK</button>
                <button className="paid" disabled={contractBusy} onClick={()=>void closeBuyback(row.id,"paid")}>Mark Paid</button>
                <button className="reject" disabled={contractBusy} onClick={()=>void closeBuyback(row.id,"rejected")}>Reject</button>
              </div>:"—"}</td>
            </tr>)}
            {!filteredBuybackLedger.length&&<tr><td colSpan={9}>No buyback records match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="system-status">{contractMessage}</div>
    </section>

    <div className="corp-buyback-manual-divider"><span>MANUAL VALUATION TOOL</span></div>
    <div className="corp-buyback-head">
      <div><p className="eyebrow">CORPORATION · MARKET OPERATIONS</p><h3>Corp Resource Buyback</h3><p>Ore, ice, gas and T2 exploration salvage are valued against the latest Jita 4-4 buy orders returned directly by ESI.</p></div>
      <div className="corp-buyback-hub"><span>PRICING HUB</span><strong>Jita 4-4</strong><small>Station 60003760 · Buy orders</small></div>
    </div>

    <div className="corp-buyback-controls">
      <div className="corp-buyback-entry">
        <div className="corp-buyback-kind-tabs" role="tablist" aria-label="Buyback resource type">
          {(Object.keys(BUYBACK_RESOURCE_LABELS) as BuybackResourceKind[]).map((kind) => <button
            type="button"
            key={kind}
            role="tab"
            aria-selected={resourceKind === kind}
            className={resourceKind === kind ? "active" : ""}
            onClick={() => {
              setResourceKind(kind);
              setOreSearch("");
              setSelectedOre(null);
              setOreMatches([]);
              setOreSearchMessage(`Search ${BUYBACK_RESOURCE_LABELS[kind].toLowerCase()} market types, then add the stack to the list.`);
            }}
          >{BUYBACK_RESOURCE_LABELS[kind]}</button>)}
        </div>
        <div className="corp-buyback-quick-add">
          <div className="corp-buyback-search-field">
            <span>Jita {BUYBACK_RESOURCE_LABELS[resourceKind]} search</span>
            <input
              className="corp-buyback-search-input"
              value={oreSearch}
              onChange={(event) => { setOreSearch(event.target.value); setSelectedOre(null); }}
              placeholder={`Search ${BUYBACK_RESOURCE_LABELS[resourceKind].toLowerCase()} type…`}
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
        <label><span>Resources + quantities</span><textarea value={text} onChange={(event) => { setText(event.target.value); setQuote(null); }} spellCheck={false} /></label>
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
