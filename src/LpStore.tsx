import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import { appendShoppingList, OPEN_SHOPPING_LIST_PENDING_KEY } from "./shopping-list";
import "./lp-store.css";

type NamedHub = "Jita" | "Amarr" | "Dodixie" | "Rens" | "Hek";
type SaleMode = "quick" | "patient";
type LpBalance = { corporation_id: number; loyalty_points: number };
type CorpName = { corporationId: number; corporationName: string };
type RequiredItem = { typeId: number; name: string; quantity: number; unitMarketCost: number | null; marketCost: number | null };
type HubMetric = {
  hub: NamedHub;
  systemId: number;
  quickProceeds: number | null;
  quickUnitPrice: number | null;
  quickCoveredUnits: number;
  quickCoveragePercent: number;
  patientProceeds: number | null;
  patientUnitPrice: number | null;
  buyDepthUnits: number;
  sellDepthUnits: number;
  buyOrderCount: number;
  sellOrderCount: number;
  spreadPercent: number | null;
};
type Offer = {
  offerId: number;
  outputTypeId: number;
  outputName: string;
  outputQuantity: number;
  lpCost: number;
  iskCost: number;
  akCost: number;
  requiredItems: RequiredItem[];
  requiredItemsCost: number | null;
  requiredItemsFullyPriced: boolean;
  capitalRequired: number | null;
  categoryName: string;
  groupName: string;
  packagedVolumeM3: number;
  isBlueprint: boolean;
  hubs: Record<NamedHub, HubMetric>;
  bestHub: NamedHub | null;
  bestQuickHub: NamedHub | null;
  bestPatientHub: NamedHub | null;
  quickProceeds: number | null;
  patientProceeds: number | null;
  quickNetProfit: number | null;
  patientNetProfit: number | null;
  quickIskPerLp: number | null;
  patientIskPerLp: number | null;
  roiPercent: number | null;
  marketValue: number | null;
  dailyVolume: number | null;
  saleTimeDays: number | null;
  saleTimeLabel: string;
  liquidityLabel: string;
  score: number;
  scoreComponents: { profitability: number; liquidity: number; absoluteProfit: number; capitalEfficiency: number; stability: number; confidence: number };
  classifications: string[];
  warnings: string[];
};
type Analysis = {
  corporationId: number;
  corporationName: string;
  generatedAt: string;
  marketAsOf: string | null;
  hubSystems: Array<{ name: NamedHub; systemId: number }>;
  offers: Offer[];
  warnings: string[];
};
type RouteRow = { systemId: number; systemName: string; jumps: number; withinRange: boolean };
type CachedAnalysis = { revision: number; data: Analysis };
type OfferRow = { corporationId: number; corporationName: string; lpBalance: number; offer: Offer };
type QuickFilter = "All Items" | "Blueprints" | "Ships" | "Modules" | "Drones" | "Implants" | "Ammunition" | "Materials" | "Skins" | "Other";
type SortKey = "market-value" | "profit" | "roi" | "isk-lp" | "lp-cost" | "score";
type PlanLine = { corporationId: number; offerId: number; quantity: number };
type IconName = "lp" | "wallet" | "items" | "market" | "coins" | "search" | "settings" | "optimize" | "cart" | "more" | "grid" | "list" | "chevron";

type Props = {
  snapshot?: CharacterSnapshot;
  marketDataRevision: number;
  onOpenShoppingList(): void;
  onOpenIndustry(): void;
  onManageStandings(): void;
};

const HUBS: NamedHub[] = ["Jita", "Amarr", "Dodixie", "Rens", "Hek"];
const QUICK_FILTERS: QuickFilter[] = ["All Items", "Blueprints", "Ships", "Modules", "Drones", "Implants", "Ammunition", "Materials", "Skins", "Other"];
const PAGE_CHUNK = 120;
const int = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const isk = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${compact.format(value)} ISK`;
const iskFull = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${int.format(value)} ISK`;
const icon = (typeId: number) => `sage-asset://type/${typeId}/icon?size=64`;
const rowKey = (corporationId: number, offerId: number) => `${corporationId}:${offerId}`;

function UiIcon({ name }: { name: IconName }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (name) {
    case "lp": return <svg {...common}><path d="M12 2 20 7v10l-8 5-8-5V7l8-5Z"/><path d="m8.5 9 3.5-2 3.5 2v6L12 17l-3.5-2V9Z"/><path d="M12 9v6"/></svg>;
    case "wallet": return <svg {...common}><path d="M4 6.5h14a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h11"/><path d="M15 10h6v4h-6a2 2 0 0 1 0-4Z"/><circle cx="16" cy="12" r=".75"/></svg>;
    case "items": return <svg {...common}><path d="m12 3 8 4.3v9.4L12 21l-8-4.3V7.3L12 3Z"/><path d="m4.5 7.6 7.5 4 7.5-4M12 11.6V21"/></svg>;
    case "market": return <svg {...common}><path d="M5 20v-6h3v6H5Zm6 0V9h3v11h-3Zm6 0V4h3v16h-3Z"/></svg>;
    case "coins": return <svg {...common}><ellipse cx="9" cy="6" rx="5" ry="2.5"/><path d="M4 6v4c0 1.4 2.2 2.5 5 2.5S14 11.4 14 10V6"/><path d="M4 10v4c0 1.4 2.2 2.5 5 2.5 1.1 0 2.1-.2 3-.5"/><ellipse cx="16" cy="15" rx="5" ry="2.5"/><path d="M11 15v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>;
    case "search": return <svg {...common}><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .35 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.35 1.7 1.7 0 0 0-1 1.55V21h-4v-.1A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.9.35l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.55-1H3v-4h.1A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.35-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.65 1.7 1.7 0 0 0 10 3.1V3h4v.1A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.9-.35l.1-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 19.35 9a1.7 1.7 0 0 0 1.55 1h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
    case "optimize": return <svg {...common}><path d="M4 19v-4h3v4H4Zm6 0v-7h3v7h-3Zm6 0V8h3v11h-3Z"/><path d="m4 10 5-4 4 2 6-5"/><path d="M16 3h3v3"/></svg>;
    case "cart": return <svg {...common}><path d="M3 4h2l2 11h10l2-7H6"/><circle cx="9" cy="19" r="1.2"/><circle cx="16" cy="19" r="1.2"/></svg>;
    case "more": return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case "grid": return <svg {...common}><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>;
    case "list": return <svg {...common}><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>;
    case "chevron": return <svg {...common}><path d="m9 5 7 7-7 7"/></svg>;
  }
}

function CorpSigil({ name }: { name: string }) {
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.map(word => word[0]).slice(0, 2).join("").toUpperCase() || "LP";
  return <svg className="lp-corp-sigil" viewBox="0 0 42 42" aria-hidden="true">
    <path className="sigil-ring" d="M21 3 35 11v20L21 39 7 31V11L21 3Z"/>
    <circle className="sigil-core" cx="21" cy="21" r="10"/>
    <path className="sigil-mark" d="M21 7v7M21 28v7M7 21h7M28 21h7"/>
    <text x="21" y="24" textAnchor="middle">{initials}</text>
  </svg>;
}

function asBalances(snapshot?: CharacterSnapshot): LpBalance[] {
  const value = (snapshot?.extended as any)?.loyaltyPoints;
  if (!Array.isArray(value)) return [];
  return value.map((row: any) => ({
    corporation_id: Number(row?.corporation_id ?? 0),
    loyalty_points: Math.max(0, Math.floor(Number(row?.loyalty_points ?? 0) || 0)),
  })).filter((row: LpBalance) => row.corporation_id > 0 && row.loyalty_points > 0)
    .sort((a: LpBalance, b: LpBalance) => b.loyalty_points - a.loyalty_points);
}

function ownedByType(snapshot?: CharacterSnapshot) {
  const map = new Map<number, number>();
  const assets = Array.isArray(snapshot?.extended?.assets) ? snapshot!.extended!.assets! : [];
  for (const row of assets as any[]) {
    const typeId = Number(row?.type_id ?? 0);
    const quantity = Math.max(0, Math.floor(Number(row?.quantity ?? 0) || 0));
    if (typeId > 0 && quantity > 0) map.set(typeId, (map.get(typeId) ?? 0) + quantity);
  }
  return map;
}

function metricOf(offer: Offer, hub: NamedHub) { return offer.hubs?.[hub] ?? null; }
function proceedsOf(offer: Offer, hub: NamedHub, mode: SaleMode) {
  const metric = metricOf(offer, hub);
  return mode === "quick" ? metric?.quickProceeds ?? null : metric?.patientProceeds ?? null;
}
function profitOf(offer: Offer, hub: NamedHub, mode: SaleMode) {
  const proceeds = proceedsOf(offer, hub, mode);
  return proceeds == null || offer.capitalRequired == null ? null : proceeds - offer.capitalRequired;
}
function iskLpOf(offer: Offer, hub: NamedHub, mode: SaleMode) {
  const profit = profitOf(offer, hub, mode);
  return profit == null || offer.lpCost <= 0 ? null : profit / offer.lpCost;
}
function roiOf(offer: Offer, hub: NamedHub) {
  const profit = profitOf(offer, hub, "patient");
  return profit == null || offer.capitalRequired == null || offer.capitalRequired <= 0 ? null : (profit / offer.capitalRequired) * 100;
}

function offerKind(offer: Offer): QuickFilter {
  if (offer.isBlueprint) return "Blueprints";
  const text = `${offer.categoryName} ${offer.groupName} ${offer.outputName}`.toLowerCase();
  if (/\bskin\b/.test(text)) return "Skins";
  if (/implant/.test(text)) return "Implants";
  if (/drone|fighter/.test(text)) return "Drones";
  if (/ammunition|ammo|charge|missile|rocket|torpedo|projectile|frequency crystal|hybrid charge/.test(text)) return "Ammunition";
  if (/material|mineral|component|commodity|datacore|salvage|fuel block|moon material/.test(text)) return "Materials";
  if (/ship|frigate|destroyer|cruiser|battlecruiser|battleship|industrial|hauler|barge|exhumer|capital/.test(text)) return "Ships";
  if (/module|turret|launcher|shield|armor|armour|propulsion|engineering|electronic|rig|weapon|booster/.test(text)) return "Modules";
  return "Other";
}

function maxAffordableRedemptions(offer: Offer, lpBalance: number, wallet: number, owned: Map<number, number>) {
  if (offer.lpCost <= 0) return 0;
  const maxLp = Math.max(0, Math.floor(lpBalance / offer.lpCost));
  if (!maxLp) return 0;
  const cost = (quantity: number) => {
    let total = quantity * offer.iskCost;
    for (const item of offer.requiredItems) {
      const needed = Math.max(0, quantity * item.quantity - (owned.get(item.typeId) ?? 0));
      if (needed && item.unitMarketCost == null) return Infinity;
      total += needed * Number(item.unitMarketCost ?? 0);
    }
    return total;
  };
  let low = 0;
  let high = maxLp;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cost(mid) <= wallet) low = mid;
    else high = mid - 1;
  }
  return low;
}

function formatAge(value: string | null | undefined) {
  if (!value) return "market time unavailable";
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(ageMinutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function estimateBalanceValue(selectedCorpIds: number[], balances: LpBalance[], analyses: Analysis[], hub: NamedHub, mode: SaleMode) {
  if (!selectedCorpIds.length || analyses.length !== selectedCorpIds.length) return null;
  let total = 0;
  for (const corporationId of selectedCorpIds) {
    const balance = balances.find(row => row.corporation_id === corporationId)?.loyalty_points ?? 0;
    const analysis = analyses.find(row => row.corporationId === corporationId);
    if (!analysis) return null;
    const rates = analysis.offers.map(offer => iskLpOf(offer, hub, mode)).filter((value): value is number => value != null && value > 0 && Number.isFinite(value));
    if (!rates.length) continue;
    total += balance * Math.max(...rates);
  }
  return total;
}

export function LpStore({ snapshot, marketDataRevision, onOpenShoppingList, onOpenIndustry, onManageStandings }: Props) {
  const balances = useMemo(() => asBalances(snapshot), [snapshot]);
  const owned = useMemo(() => ownedByType(snapshot), [snapshot]);
  const balanceIdsKey = balances.map(row => row.corporation_id).join(",");
  const [names, setNames] = useState<Record<number, string>>({});
  const [selectedCorpIds, setSelectedCorpIds] = useState<number[]>([]);
  const [analysisByCorp, setAnalysisByCorp] = useState<Record<number, CachedAnalysis>>({});
  const [loadingByCorp, setLoadingByCorp] = useState<Record<number, boolean>>({});
  const [errorsByCorp, setErrorsByCorp] = useState<Record<number, string>>({});
  const [corpQuery, setCorpQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("All Items");
  const [hub, setHub] = useState<NamedHub>("Jita");
  const [sort, setSort] = useState<SortKey>("market-value");
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [routes, setRoutes] = useState<Record<number, RouteRow>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanLine[]>([]);
  const [status, setStatus] = useState("");
  const [rowLimit, setRowLimit] = useState(PAGE_CHUNK);

  useEffect(() => {
    setSelectedCorpIds(balances[0] ? [balances[0].corporation_id] : []);
    setExpanded(null);
    setPlan([]);
    setStatus("");
    setCorpQuery("");
    setItemQuery("");
    setQuickFilter("All Items");
    setRowLimit(PAGE_CHUNK);
  }, [snapshot?.characterId]);

  useEffect(() => {
    setSelectedCorpIds(current => {
      const valid = current.filter(id => balances.some(row => row.corporation_id === id));
      if (valid.length || !balances.length) return valid;
      return [balances[0].corporation_id];
    });
  }, [balanceIdsKey]);

  useEffect(() => {
    const ids = balances.map(row => row.corporation_id);
    if (!ids.length) { setNames({}); return; }
    let cancelled = false;
    void window.sage.getLpCorporations(ids).then((rows: CorpName[]) => {
      if (cancelled) return;
      setNames(Object.fromEntries(rows.map(row => [row.corporationId, row.corporationName])));
    }).catch(() => {
      if (!cancelled) setNames(Object.fromEntries(ids.map(id => [id, `Corporation ${id}`])));
    });
    return () => { cancelled = true; };
  }, [snapshot?.characterId, balanceIdsKey]);

  const selectedKey = selectedCorpIds.join(",");
  useEffect(() => {
    for (const corporationId of selectedCorpIds) {
      const cached = analysisByCorp[corporationId];
      if (cached?.revision === marketDataRevision || loadingByCorp[corporationId]) continue;
      setLoadingByCorp(current => ({ ...current, [corporationId]: true }));
      setErrorsByCorp(current => { const copy = { ...current }; delete copy[corporationId]; return copy; });
      void window.sage.getLpStoreOffers(corporationId, marketDataRevision).then((result: Analysis) => {
        setAnalysisByCorp(current => ({ ...current, [corporationId]: { revision: marketDataRevision, data: result } }));
      }).catch(error => {
        setErrorsByCorp(current => ({ ...current, [corporationId]: error instanceof Error ? error.message : "LP Store intelligence could not be loaded." }));
      }).finally(() => {
        setLoadingByCorp(current => ({ ...current, [corporationId]: false }));
      });
    }
  }, [selectedKey, marketDataRevision]);

  const selectedAnalyses = useMemo(() => selectedCorpIds.map(id => analysisByCorp[id]).filter(entry => entry?.revision === marketDataRevision).map(entry => entry.data), [selectedKey, analysisByCorp, marketDataRevision]);
  const routeTargetIds = useMemo(() => [...new Set(selectedAnalyses.map(analysis => analysis.hubSystems.find(row => row.name === hub)?.systemId).filter((value): value is number => Number.isFinite(value)))], [selectedAnalyses, hub]);
  const routeTargetKey = routeTargetIds.join(",");

  useEffect(() => {
    if (!snapshot?.location?.solar_system_name || !routeTargetIds.length) { setRoutes({}); return; }
    let cancelled = false;
    void window.sage.getIndustrialOpportunityRouteScope({ systemQuery: snapshot.location.solar_system_name, targetSystemIds: routeTargetIds, maxJumps: 100 })
      .then((result: any) => {
        if (cancelled) return;
        const rows = Array.isArray(result?.routes) ? result.routes as RouteRow[] : [];
        setRoutes(Object.fromEntries(rows.map(row => [row.systemId, row])));
      }).catch(() => { if (!cancelled) setRoutes({}); });
    return () => { cancelled = true; };
  }, [snapshot?.location?.solar_system_name, routeTargetKey]);

  useEffect(() => { setRowLimit(PAGE_CHUNK); }, [selectedKey, itemQuery, quickFilter, hub, sort, affordableOnly]);

  if (!snapshot) return <section className="lp-store-empty"><p className="eyebrow">LOYALTY POINT COMMAND</p><h2>Connect a character to analyse loyalty points</h2><p>Sage uses the selected character&apos;s synced LP, wallet and retained market intelligence.</p></section>;
  if (!balances.length) return <section className="lp-store-empty"><p className="eyebrow">LOYALTY POINT COMMAND</p><h2>No loyalty-point balances in the synced snapshot</h2><p>Run a normal character sync after earning LP. Opening this tab does not force another sync.</p></section>;

  const totalLp = balances.reduce((sum, row) => sum + row.loyalty_points, 0);
  const offerRows: OfferRow[] = selectedAnalyses.flatMap(analysis => {
    const lpBalance = balances.find(row => row.corporation_id === analysis.corporationId)?.loyalty_points ?? 0;
    return analysis.offers.map(offer => ({ corporationId: analysis.corporationId, corporationName: analysis.corporationName, lpBalance, offer }));
  });
  const allSelectedLoaded = selectedCorpIds.length > 0 && selectedAnalyses.length === selectedCorpIds.length;
  const estimatedWalletValue = estimateBalanceValue(selectedCorpIds, balances, selectedAnalyses, hub, "quick");
  const totalLpValue = estimateBalanceValue(selectedCorpIds, balances, selectedAnalyses, hub, "patient");
  const estimatedMarketValue = allSelectedLoaded ? offerRows.reduce((sum, row) => sum + (proceedsOf(row.offer, hub, "patient") ?? row.offer.marketValue ?? 0), 0) : null;
  const newestMarketAsOf = selectedAnalyses.map(row => row.marketAsOf).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const loadingCount = selectedCorpIds.filter(id => loadingByCorp[id]).length;

  const corpNeedle = corpQuery.trim().toLowerCase();
  const visibleCorporations = balances.filter(row => !corpNeedle || (names[row.corporation_id] ?? `Corporation ${row.corporation_id}`).toLowerCase().includes(corpNeedle));
  const itemNeedle = itemQuery.trim().toLowerCase();
  const visibleRows = offerRows.filter(row => {
    const offer = row.offer;
    if (itemNeedle && !`${offer.outputName} ${offer.categoryName} ${offer.groupName} ${offer.requiredItems.map(item => item.name).join(" ")} ${row.corporationName}`.toLowerCase().includes(itemNeedle)) return false;
    if (quickFilter !== "All Items" && offerKind(offer) !== quickFilter) return false;
    if (affordableOnly && maxAffordableRedemptions(offer, row.lpBalance, snapshot.wallet, owned) <= 0) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "market-value") return (proceedsOf(b.offer, hub, "patient") ?? -Infinity) - (proceedsOf(a.offer, hub, "patient") ?? -Infinity);
    if (sort === "profit") return (profitOf(b.offer, hub, "patient") ?? -Infinity) - (profitOf(a.offer, hub, "patient") ?? -Infinity);
    if (sort === "roi") return (roiOf(b.offer, hub) ?? -Infinity) - (roiOf(a.offer, hub) ?? -Infinity);
    if (sort === "isk-lp") return (iskLpOf(b.offer, hub, "patient") ?? -Infinity) - (iskLpOf(a.offer, hub, "patient") ?? -Infinity);
    if (sort === "lp-cost") return a.offer.lpCost - b.offer.lpCost;
    return b.offer.score - a.offer.score;
  });
  const displayedRows = visibleRows.slice(0, rowLimit);

  const planRows = plan.map(line => {
    const row = offerRows.find(candidate => candidate.corporationId === line.corporationId && candidate.offer.offerId === line.offerId);
    return row ? { ...line, row } : null;
  }).filter((value): value is PlanLine & { row: OfferRow } => Boolean(value));
  const planLp = planRows.reduce((sum, line) => sum + line.quantity * line.row.offer.lpCost, 0);
  const planDirectIsk = planRows.reduce((sum, line) => sum + line.quantity * line.row.offer.iskCost, 0);
  const requirementTotals = new Map<number, { typeId: number; name: string; quantity: number; unitMarketCost: number | null }>();
  for (const line of planRows) for (const item of line.row.offer.requiredItems) {
    const current = requirementTotals.get(item.typeId) ?? { typeId: item.typeId, name: item.name, quantity: 0, unitMarketCost: item.unitMarketCost };
    current.quantity += line.quantity * item.quantity;
    if (current.unitMarketCost == null) current.unitMarketCost = item.unitMarketCost;
    requirementTotals.set(item.typeId, current);
  }
  const missingRequirements = [...requirementTotals.values()].map(row => ({ ...row, missing: Math.max(0, row.quantity - (owned.get(row.typeId) ?? 0)) })).filter(row => row.missing > 0);
  const missingCostKnown = missingRequirements.every(row => row.unitMarketCost != null);
  const missingCost = missingCostKnown ? missingRequirements.reduce((sum, row) => sum + row.missing * Number(row.unitMarketCost), 0) : null;
  const planCapital = missingCost == null ? null : planDirectIsk + missingCost;
  const planRevenue = planRows.reduce<number | null>((sum, line) => {
    const value = proceedsOf(line.row.offer, hub, "patient");
    return sum == null || value == null ? null : sum + value * line.quantity;
  }, 0);
  const planProfit = planCapital == null || planRevenue == null ? null : planRevenue - planCapital;

  function toggleCorporation(corporationId: number) {
    setSelectedCorpIds(current => current.includes(corporationId) ? current.filter(id => id !== corporationId) : [...current, corporationId]);
    setExpanded(null);
    setPlan([]);
  }

  function addOfferToPlan(row: OfferRow) {
    setPlan(current => {
      const existing = current.find(line => line.corporationId === row.corporationId && line.offerId === row.offer.offerId);
      if (existing) return current.map(line => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { corporationId: row.corporationId, offerId: row.offer.offerId, quantity: 1 }];
    });
    setStatus(`${row.offer.outputName} added to your redemption plan.`);
  }

  function runOptimizer() {
    if (!offerRows.length) { setStatus("Select at least one corporation with prepared LP offers first."); return; }
    const candidates = offerRows.map(row => ({ row, rate: iskLpOf(row.offer, hub, "patient"), profit: profitOf(row.offer, hub, "patient") }))
      .filter(candidate => candidate.rate != null && candidate.rate > 0 && candidate.profit != null && candidate.profit > 0 && candidate.row.offer.lpCost > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.row.offer.score - a.row.offer.score);
    const lpLeft = new Map(balances.map(row => [row.corporation_id, row.loyalty_points]));
    const availableOwned = new Map(owned);
    let walletLeft = Math.max(0, snapshot!.wallet);
    const output: PlanLine[] = [];
    const purchaseCost = (offer: Offer, quantity: number) => {
      let total = quantity * offer.iskCost;
      for (const item of offer.requiredItems) {
        const needed = Math.max(0, quantity * item.quantity - (availableOwned.get(item.typeId) ?? 0));
        if (needed && item.unitMarketCost == null) return Infinity;
        total += needed * Number(item.unitMarketCost ?? 0);
      }
      return total;
    };
    for (const candidate of candidates) {
      const { row } = candidate;
      const currentLp = lpLeft.get(row.corporationId) ?? 0;
      const lpCap = Math.floor(currentLp / row.offer.lpCost);
      if (lpCap <= 0) continue;
      const depth = metricOf(row.offer, hub)?.sellDepthUnits ?? 0;
      const depthCap = depth > 0 ? Math.max(1, Math.floor((depth * 0.15) / Math.max(1, row.offer.outputQuantity))) : 1;
      let low = 0;
      let high = Math.min(lpCap, depthCap, 500);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (purchaseCost(row.offer, mid) <= walletLeft) low = mid;
        else high = mid - 1;
      }
      const take = low;
      if (!take) continue;
      const cash = purchaseCost(row.offer, take);
      walletLeft -= cash;
      lpLeft.set(row.corporationId, currentLp - take * row.offer.lpCost);
      for (const item of row.offer.requiredItems) {
        const have = availableOwned.get(item.typeId) ?? 0;
        availableOwned.set(item.typeId, Math.max(0, have - take * item.quantity));
      }
      output.push({ corporationId: row.corporationId, offerId: row.offer.offerId, quantity: take });
      if (output.length >= 10) break;
    }
    setPlan(output);
    setStatus(output.length ? `Optimised a ${output.length}-reward LP basket using ${hub} pricing, retained market depth, wallet capital and owned ingredients.` : "No safely priced, profitable basket fits the selected LP balances and current capital.");
  }

  function exportPlanRequirements() {
    if (!missingRequirements.length) { setStatus("Every required redemption ingredient in this plan is already present in the selected character's synced assets."); return; }
    appendShoppingList(missingRequirements.map(row => ({ typeId: row.typeId, name: row.name, quantity: row.missing })), "LP redemption ingredients exported to Shopping List.");
    sessionStorage.setItem(OPEN_SHOPPING_LIST_PENDING_KEY, "1");
    onOpenShoppingList();
  }

  return <section className={`lp-store-page lp-view-${viewMode}`}>
    <header className="lp-command-hero">
      <div className="lp-command-hero-copy">
        <p className="lp-command-kicker">LOYALTY POINT COMMAND</p>
        <h2>{snapshot.character.name.toUpperCase()} - LP STORE</h2>
        <p>Turn your loyalty points into rewards. Compare offers, plan purchases and get the most from your standings.</p>
      </div>
      <div className="lp-command-motto">STANDINGS TODAY.<br/>OPPORTUNITIES TOMORROW.</div>
    </header>

    <div className="lp-command-summary">
      <article><span className="lp-summary-icon"><UiIcon name="lp"/></span><div><small>LOYALTY POINTS</small><strong>{int.format(totalLp)}</strong><p>Available across all corporations</p></div></article>
      <article><span className="lp-summary-icon"><UiIcon name="wallet"/></span><div><small>EST. WALLET VALUE</small><strong>{isk(estimatedWalletValue)}</strong><p>At current {hub} quick-sale prices</p></div></article>
      <article><span className="lp-summary-icon"><UiIcon name="items"/></span><div><small>ITEMS AVAILABLE</small><strong>{allSelectedLoaded ? int.format(offerRows.length) : "—"}</strong><p>Across selected corporations</p></div></article>
      <article><span className="lp-summary-icon"><UiIcon name="market"/></span><div><small>EST. MARKET VALUE</small><strong>{isk(estimatedMarketValue)}</strong><p>Total estimated value of available offers</p></div></article>
      <article className="lp-summary-total"><span className="lp-summary-icon"><UiIcon name="coins"/></span><div><small>TOTAL LP VALUE</small><strong>{totalLpValue == null ? "—" : compact.format(totalLpValue)}</strong><p>Using current {hub} market prices</p></div><span className="lp-summary-chevron"><UiIcon name="chevron"/></span></article>
    </div>

    <section className="lp-corporation-picker">
      <div className="lp-section-line">
        <div><h3>SELECT CORPORATIONS</h3><p>Choose one or more corporations to view their LP store items.</p></div>
        <div className="lp-corp-tools">
          <label className="lp-search-box"><UiIcon name="search"/><input value={corpQuery} onChange={event => setCorpQuery(event.target.value)} placeholder="Search corporations..."/></label>
          <button type="button" className="lp-outline-action" onClick={onManageStandings}><UiIcon name="settings"/>MANAGE STANDINGS</button>
        </div>
      </div>
      <div className="lp-corp-grid">
        {visibleCorporations.map(row => {
          const selected = selectedCorpIds.includes(row.corporation_id);
          const corporationName = names[row.corporation_id] ?? `Corporation ${row.corporation_id}`;
          return <button type="button" key={row.corporation_id} className={selected ? "selected" : ""} onClick={() => toggleCorporation(row.corporation_id)}>
            <CorpSigil name={corporationName}/>
            <span className="lp-corp-copy"><strong>{corporationName}</strong><small>{int.format(row.loyalty_points)} LP</small></span>
            <span className={`lp-corp-check ${selected ? "checked" : ""}`}>{selected ? "✓" : ""}</span>
          </button>;
        })}
        {!visibleCorporations.length && <div className="lp-corp-no-match">No corporation matches that search.</div>}
      </div>
    </section>

    <section className="lp-store-browser">
      <div className="lp-quick-filter-row">
        <strong>QUICK FILTERS</strong>
        <div>{QUICK_FILTERS.map(filter => <button type="button" key={filter} className={quickFilter === filter ? "active" : ""} onClick={() => setQuickFilter(filter)}>{filter}</button>)}</div>
      </div>

      <div className="lp-browser-controls">
        <label className="lp-item-search"><UiIcon name="search"/><input value={itemQuery} onChange={event => setItemQuery(event.target.value)} placeholder="Search items, blueprints or requirements..."/></label>
        <label className="lp-select-control"><span>PRICE SOURCE</span><select value={hub} onChange={event => setHub(event.target.value as NamedHub)}>{HUBS.map(name => <option key={name} value={name}>{name}{name === "Jita" ? " (The Forge)" : ""}</option>)}</select></label>
        <label className="lp-select-control lp-sort-control"><span>SORT BY</span><select value={sort} onChange={event => setSort(event.target.value as SortKey)}><option value="market-value">Market Value (High → Low)</option><option value="profit">Profit (High → Low)</option><option value="roi">ROI (High → Low)</option><option value="isk-lp">ISK / LP (High → Low)</option><option value="lp-cost">LP Cost (Low → High)</option><option value="score">Sage Score</option></select></label>
        <div className="lp-view-toggle" aria-label="LP Store view mode"><button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="Comfortable rows"><UiIcon name="grid"/></button><button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="Compact rows"><UiIcon name="list"/></button></div>
      </div>

      <div className="lp-browser-actions">
        <label className="lp-affordable"><input type="checkbox" checked={affordableOnly} onChange={event => setAffordableOnly(event.target.checked)}/><span/>Show only affordable items</label>
        <button type="button" className="lp-optimize-button" disabled={!offerRows.length || loadingCount > 0} onClick={runOptimizer}><UiIcon name="optimize"/>OPTIMISE MY LP</button>
      </div>

      {status && <div className="lp-command-status">{status}</div>}
      {(loadingCount > 0 || Object.keys(errorsByCorp).some(key => selectedCorpIds.includes(Number(key)))) && <div className="lp-load-strip">
        {loadingCount > 0 && <span>Preparing retained LP intelligence for {loadingCount} selected corporation{loadingCount === 1 ? "" : "s"}…</span>}
        {Object.entries(errorsByCorp).filter(([id]) => selectedCorpIds.includes(Number(id))).map(([id, message]) => <span className="error" key={id}>{names[Number(id)] ?? `Corporation ${id}`}: {message}</span>)}
      </div>}

      {planRows.length > 0 && <div className="lp-plan-strip">
        <div><small>REDEMPTION PLAN</small><strong>{planRows.length} reward{planRows.length === 1 ? "" : "s"} · {int.format(planLp)} LP · {isk(planProfit)} est. profit</strong><span>{isk(planCapital)} capital · {missingRequirements.length} missing ingredient type{missingRequirements.length === 1 ? "" : "s"}</span></div>
        <div><button type="button" disabled={!missingRequirements.length} onClick={exportPlanRequirements}>Export missing items</button><button type="button" onClick={() => setPlan([])}>Clear</button></div>
      </div>}

      <div className="lp-offer-table" role="table" aria-label="LP Store offers">
        <div className="lp-offer-table-head" role="row">
          <span>ITEM</span><span>LP COST</span><span>ISK COST</span><span>REQUIRED ITEMS</span><span>EST. VALUE</span><span>PROFIT</span><span>ROI</span><span>AVAILABILITY</span><span>LOCATION</span><span>TAGS</span><span>ACTIONS</span>
        </div>
        <div className="lp-offer-table-body">
          {displayedRows.map(row => {
            const offer = row.offer;
            const metric = metricOf(offer, hub);
            const value = proceedsOf(offer, hub, "patient");
            const profit = profitOf(offer, hub, "patient");
            const roi = roiOf(offer, hub);
            const route = metric ? routes[metric.systemId] : undefined;
            const affordable = maxAffordableRedemptions(offer, row.lpBalance, snapshot.wallet, owned);
            const key = rowKey(row.corporationId, offer.offerId);
            const tags = [offerKind(offer), ...offer.classifications].filter((tag, index, list) => list.indexOf(tag) === index).slice(0, 2);
            const firstRequirement = offer.requiredItems[0];
            const plannedQuantity = plan.find(line => line.corporationId === row.corporationId && line.offerId === offer.offerId)?.quantity ?? 0;
            return <article key={key} className={`${expanded === key ? "expanded" : ""} ${plannedQuantity ? "planned" : ""}`} role="row">
              <div className="lp-offer-item"><img src={icon(offer.outputTypeId)} alt="" loading="lazy"/><span><strong>{offer.outputQuantity > 1 ? `${offer.outputQuantity}× ` : ""}{offer.outputName}</strong><small><em>{offer.groupName || offer.categoryName || "Reward"}</em>{offer.score >= 70 && <em className="hot">TOP PICK</em>}</small></span></div>
              <div><strong>{int.format(offer.lpCost)} LP</strong>{plannedQuantity > 0 && <small>{plannedQuantity} planned</small>}</div>
              <div><strong>{iskFull(offer.iskCost)}</strong></div>
              <div className="lp-required-cell">{firstRequirement ? <><strong>{firstRequirement.quantity}× {firstRequirement.name}</strong><small>{offer.requiredItems.length > 1 ? `+${offer.requiredItems.length - 1} more · ` : ""}{isk(offer.requiredItemsCost)}</small></> : <><strong>None</strong><small>No ingredients</small></>}</div>
              <div><strong className="value">{isk(value)}</strong><small>{metric?.patientUnitPrice ? `${iskFull(metric.patientUnitPrice)} / unit` : "No retained sell quote"}</small></div>
              <div><strong className={profit != null && profit >= 0 ? "positive" : "negative"}>{isk(profit)}</strong></div>
              <div><strong className={roi != null && roi >= 0 ? "positive" : "negative"}>{roi == null ? "—" : `${pct.format(roi)}%`}</strong></div>
              <div><strong>{metric ? `${int.format(metric.sellDepthUnits)} units` : "—"}</strong><small>{route ? `${route.jumps} jump${route.jumps === 1 ? "" : "s"} (${hub})` : hub}</small></div>
              <div className="lp-location-cell"><strong>{row.corporationName} LP Store</strong><small>{route?.systemName ?? hub}{route ? ` · ${route.jumps} jumps` : " · market hub"}</small></div>
              <div className="lp-tags-cell">{tags.map(tag => <em key={tag}>{tag}</em>)}{affordable > 0 && <em className="affordable">AFFORDABLE</em>}</div>
              <div className="lp-row-actions"><button type="button" title="Add to redemption plan" onClick={() => addOfferToPlan(row)}><UiIcon name="cart"/></button><button type="button" title="Offer details" onClick={() => setExpanded(current => current === key ? null : key)}><UiIcon name="more"/></button></div>
              {expanded === key && <div className="lp-offer-expanded">
                <div className="lp-expanded-metrics">
                  <span><small>QUICK CASH</small><strong>{isk(metric?.quickProceeds)}</strong><em>{metric ? `${pct.format(metric.quickCoveragePercent)}% covered` : "No quote"}</em></span>
                  <span><small>PATIENT SALE</small><strong>{isk(metric?.patientProceeds)}</strong><em>{metric ? `${int.format(metric.sellDepthUnits)} sell depth` : "No quote"}</em></span>
                  <span><small>ISK / LP</small><strong>{iskLpOf(offer, hub, "patient") == null ? "—" : `${int.format(iskLpOf(offer, hub, "patient")!)} ISK/LP`}</strong><em>{offer.liquidityLabel} liquidity</em></span>
                  <span><small>REDEEMABLE NOW</small><strong>{int.format(affordable)}</strong><em>{int.format(Math.floor(row.lpBalance / Math.max(1, offer.lpCost)))} by LP</em></span>
                  <span><small>CARGO</small><strong>{compact.format(offer.packagedVolumeM3)} m³</strong><em>Sage score {offer.score}/100</em></span>
                </div>
                {offer.requiredItems.length > 0 && <div className="lp-expanded-requirements"><strong>Redemption requirements</strong>{offer.requiredItems.map(item => <span key={item.typeId}>{item.quantity}× {item.name}<small>{int.format(owned.get(item.typeId) ?? 0)} owned · {isk(item.marketCost)}</small></span>)}</div>}
                {offer.warnings.length > 0 && <div className="lp-expanded-warnings">{offer.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>}
                {offer.isBlueprint && <button type="button" className="lp-industry-link" onClick={() => { sessionStorage.setItem("new-eden-sage-lp-industry-handoff-v1", JSON.stringify({ characterId: snapshot.characterId, blueprintTypeId: offer.outputTypeId, targetQuantity: 1, sentAt: Date.now() })); onOpenIndustry(); }}>SEND BLUEPRINT TO INDUSTRY</button>}
              </div>}
            </article>;
          })}
          {!displayedRows.length && loadingCount === 0 && <div className="lp-empty-results">{selectedCorpIds.length ? "No LP Store items match the current filters." : "Select one or more corporations to browse their LP Store items."}</div>}
        </div>
      </div>

      <footer className="lp-browser-footer">
        <span>Showing {int.format(displayedRows.length)} of {int.format(visibleRows.length)} items <i/> Prices updated {formatAge(newestMarketAsOf)}</span>
        {rowLimit < visibleRows.length && <button type="button" onClick={() => setRowLimit(current => current + PAGE_CHUNK)}>Show more</button>}
        <strong>Fly smart. Spend smarter.</strong>
      </footer>
    </section>
  </section>;
}
