import { getLootAcquisition } from "./loot-engine";
import { getPlanetaryAcquisitionGuide } from "./planetary-revenue";
import { getMarketType } from "./market-static-index";
import { loadSharedFullMarketAnalysisIndex, loadSharedPublicSource } from "./shared-market-data";

export type FoundryBaseMaterial = { typeId: number; name: string; required: number };

export async function buildFoundryPlanetaryGuide(material: FoundryBaseMaterial) {
  const typeId = Number(material.typeId ?? 0);
  const piGuide = await getPlanetaryAcquisitionGuide(typeId).catch(() => null);
  if (!piGuide) return null;

  const required = Math.max(0, Number(material.required ?? 0));
  const outputPerRun = Math.max(1, Number(piGuide.outputQuantity ?? 1));
  const runsRequired = piGuide.method === "processing"
    ? Math.max(1, Math.ceil(required / outputPerRun))
    : 1;
  const recipePerRun = (piGuide.inputs ?? []).map((row: any) => ({
    ...row,
    quantity: Math.max(0, Number(row.quantity ?? 0)),
  }));
  const recipe = piGuide.method === "processing"
    ? recipePerRun.map((row: any) => ({
        ...row,
        perRun: row.quantity,
        quantity: row.quantity * runsRequired,
      }))
    : recipePerRun;
  const bestWay = piGuide.method === "processing"
    ? `Run ${runsRequired.toLocaleString()} x ${material.name} PI cycle${runsRequired === 1 ? "" : "s"} in a ${piGuide.facility}.`
    : piGuide.bestWay;
  const instructions = piGuide.method === "processing"
    ? [
        `Output target: ${required.toLocaleString()} x ${material.name}. Each cycle produces ${outputPerRun.toLocaleString()}, so Sage has calculated ${runsRequired.toLocaleString()} cycle${runsRequired === 1 ? "" : "s"}.`,
        recipe.length
          ? `Total inputs for those cycles: ${recipe.map((row: any) => `${Number(row.quantity).toLocaleString()} x ${row.name}`).join(", ")}.`
          : "Run the required PI schematic for the calculated cycle count.",
        `Facility: ${piGuide.facility}.`,
      ]
    : [piGuide.bestWay];

  return {
    typeId,
    name: material.name,
    required,
    category: "pi",
    categoryLabel: "Planetary Industry",
    badge: piGuide.tier === "unknown" ? "PI" : piGuide.tier,
    bestWay,
    instructions,
    sourceLabel: piGuide.sourceLabel,
    recipe,
    recipePerRun,
    facility: piGuide.facility,
    schematicId: piGuide.schematicId,
    runsRequired,
    outputPerRun,
    detail: piGuide.method === "extraction"
      ? (piGuide.planetTypes.length ? `Extract on ${piGuide.planetTypes.join(", ")} planets` : "Extract with an ECU")
      : `${piGuide.facility} - ${outputPerRun.toLocaleString()} output per cycle`,
  };
}

export async function buildFoundryLootGuide(material: FoundryBaseMaterial) {
  const typeId = Number(material.typeId ?? 0);
  const acquisition = await getLootAcquisition(typeId).catch(() => null);
  const routes = acquisition?.routes ?? [];
  const priority = ["reaction", "manufacturing", "reprocessing", "deadspace", "officer", "invention", "copying"];
  const route = routes.slice().sort((a: any, b: any) => priority.indexOf(a.kind) - priority.indexOf(b.kind))[0];
  if (!route) {
    return {
      typeId,
      name: material.name,
      required: material.required,
      category: "other",
      categoryLabel: "Other acquisition",
      badge: "OTHER",
      bestWay: "No deterministic production route is present in Sage's installed CCP data. Check player market/contracts or the item's specific loot source.",
      sourceLabel: "CCP EVE Static Data / Sage acquisition index",
      recipe: [],
      facility: null,
      detail: "No verified direct production route",
    };
  }

  const category = route.kind === "reaction" ? "reactions"
    : route.kind === "manufacturing" || route.kind === "invention" || route.kind === "copying" ? "manufacturing"
    : route.kind === "reprocessing" ? "reprocessing"
    : route.kind === "deadspace" || route.kind === "officer" ? "loot"
    : "other";
  const categoryLabel = category === "reactions" ? "Reactions"
    : category === "manufacturing" ? "Manufacturing"
    : category === "reprocessing" ? "Reprocessing / salvage"
    : category === "loot" ? "Loot / PvE"
    : "Other acquisition";
  const baseRecipe = (route.details?.materials ?? []).map((row: any) => ({
    typeId: Number(row.typeId),
    name: String(row.name),
    quantity: Number(row.quantity),
  }));
  const scalableProduction = route.kind === "reaction" || route.kind === "manufacturing";
  const productionProduct = scalableProduction
    ? (route.details?.products ?? []).find((row: any) => Number(row.typeId) === typeId) ?? (route.details?.products ?? [])[0]
    : null;
  const outputPerRun = scalableProduction ? Math.max(1, Number(productionProduct?.quantity ?? 1)) : 1;
  const runsRequired = scalableProduction ? Math.max(1, Math.ceil(Number(material.required ?? 0) / outputPerRun)) : 1;
  const recipe = scalableProduction
    ? baseRecipe.map((row: any) => ({ ...row, perRun: row.quantity, quantity: row.quantity * runsRequired }))
    : baseRecipe;
  const reactionGroup = String(acquisition?.item?.group ?? "");
  const reactorService = /hybrid polymer/i.test(reactionGroup)
    ? "Standup Hybrid Reactor I"
    : /biochemical|molecular-forged/i.test(reactionGroup)
      ? "Standup Biochemical Reactor I"
      : "Standup Composite Reactor I";
  const reactionStructure = route.kind === "reaction"
    ? `Athanor or Tatara with ${reactorService} online`
    : null;
  const reactionSecurity = route.kind === "reaction"
    ? "Low-sec 0.1-0.4, null-sec 0.0 and below, or wormhole space. Reactions cannot run in high-sec."
    : null;
  const reactionFormula = String(route.details?.blueprintName ?? route.title);
  const bestWay = route.kind === "reaction"
    ? `Run ${runsRequired} × ${reactionFormula} in a low-sec/null-sec/wormhole Upwell Refinery using ${reactorService}.`
    : route.steps?.[0] ?? route.summary ?? route.title;
  const instructions = route.kind === "reaction"
    ? [
        `Facility: use an Upwell Refinery (Athanor or Tatara) with ${reactorService} online.`,
        `Security restriction: ${reactionSecurity}`,
        `Output target: ${Number(material.required ?? 0).toLocaleString()} × ${material.name}. The formula produces ${outputPerRun.toLocaleString()} per base run, so Sage has calculated ${runsRequired.toLocaleString()} reaction run${runsRequired === 1 ? "" : "s"}.`,
        recipe.length
          ? `Load for those runs: ${recipe.map((row: any) => `${Number(row.quantity).toLocaleString()} × ${row.name}`).join(", ")}.`
          : "Load the formula's required reaction inputs for the calculated run count.",
        "Composite/Hybrid/Biochemical reaction efficiency rigs can reduce material or time requirements where applicable; structure and security-space bonuses may change the exact optimized job numbers.",
      ]
    : [
        bestWay,
        ...(route.steps ?? []).filter((step: string) => step && step !== bestWay),
        ...(route.sourceLabel ? [`Source: ${route.sourceLabel}`] : []),
      ];

  return {
    typeId,
    name: material.name,
    required: material.required,
    category,
    categoryLabel,
    badge: route.kind.toUpperCase(),
    bestWay,
    instructions,
    sourceLabel: route.sourceLabel,
    recipe,
    recipePerRun: baseRecipe,
    runsRequired,
    outputPerRun,
    security: reactionSecurity,
    facility: reactionStructure,
    reactorService: route.kind === "reaction" ? reactorService : null,
    detail: route.details?.blueprintName ?? route.title,
  };
}

export async function buildFoundryAcquisitionGuide(material: FoundryBaseMaterial) {
  return (await buildFoundryPlanetaryGuide(material)) ?? buildFoundryLootGuide(material);
}

export function attachFoundryAcquisitionGuides(plan: any, acquisitionGuides: any[]) {
  const acquisitionGroups = [...new Map(acquisitionGuides.map((row: any) => [row.category, {
    key: row.category,
    label: row.categoryLabel,
    rows: acquisitionGuides.filter((candidate: any) => candidate.category === row.category),
  }])).values()];

  return {
    ...plan,
    materials: (plan.materials ?? []).map((row: any) => {
      const guide = acquisitionGuides.find((candidate: any) => Number(candidate.typeId) === Number(row.typeId));
      return guide ? { ...row, acquisition: guide } : row;
    }),
    nonOreMaterials: (plan.nonOreMaterials ?? []).map((row: any) => {
      const guide = acquisitionGuides.find((candidate: any) => Number(candidate.typeId) === Number(row.typeId));
      return guide ? { ...row, acquisition: guide } : row;
    }),
    acquisitionGroups,
  };
}


export type FoundryAcquisitionReach = "high" | "low" | "null";

type FoundrySellOrder = {
  price: number;
  volumeRemain: number;
  regionName?: string | null;
  locationName?: string | null;
  systemName?: string | null;
};

type FoundryPurchaseQuote = {
  typeId: number;
  sellOrders: FoundrySellOrder[];
  referenceUnitPrice: number | null;
  referenceSource: string | null;
  marketCreatedAt: string | null;
};

let purchaseQuoteCache: { expiresAt: number; values: Map<number, FoundryPurchaseQuote> } | null = null;

async function foundryPurchaseQuotes(typeIds: number[]) {
  const wanted = [...new Set(typeIds.map(Number).filter((value) => value > 0))];
  if (!wanted.length) return new Map<number, FoundryPurchaseQuote>();
  const now = Date.now();
  if (purchaseQuoteCache && purchaseQuoteCache.expiresAt > now && wanted.every((id) => purchaseQuoteCache!.values.has(id))) {
    return new Map(wanted.map((id) => [id, purchaseQuoteCache!.values.get(id)!]));
  }

  const [market, referenceSource] = await Promise.all([
    loadSharedFullMarketAnalysisIndex().catch(() => null),
    loadSharedPublicSource<Array<{ type_id: number; average_price?: number; adjusted_price?: number }>>("markets-prices").catch(() => null),
  ]);
  const references = new Map<number, { value: number; source: string }>();
  for (const row of referenceSource?.data ?? []) {
    const average = Number(row.average_price);
    const adjusted = Number(row.adjusted_price);
    if (Number.isFinite(average) && average > 0) references.set(Number(row.type_id), { value: average, source: "ESI average market price" });
    else if (Number.isFinite(adjusted) && adjusted > 0) references.set(Number(row.type_id), { value: adjusted, source: "ESI adjusted reference price" });
  }

  const cacheValues = purchaseQuoteCache?.values ?? new Map<number, FoundryPurchaseQuote>();
  for (const typeId of wanted) {
    const item = market?.items.get(typeId);
    const reference = references.get(typeId);
    cacheValues.set(typeId, {
      typeId,
      sellOrders: (item?.sells ?? [])
        .map((sell: any) => ({
          price: Number(sell.price),
          volumeRemain: Math.max(0, Number(sell.volumeRemain ?? 0)),
          regionName: sell.regionName ?? null,
          locationName: sell.locationName ?? null,
          systemName: sell.systemName ?? null,
        }))
        .filter((sell: FoundrySellOrder) => Number.isFinite(sell.price) && sell.price > 0 && sell.volumeRemain > 0)
        .sort((a: FoundrySellOrder, b: FoundrySellOrder) => a.price - b.price),
      referenceUnitPrice: reference?.value ?? null,
      referenceSource: reference?.source ?? null,
      marketCreatedAt: market?.createdAt ?? null,
    });
  }
  purchaseQuoteCache = { expiresAt: now + 15 * 60_000, values: cacheValues };
  return new Map(wanted.map((id) => [id, cacheValues.get(id)!]));
}

export function priceFoundrySellDepth(orders: FoundrySellOrder[], quantity: number) {
  const required = Math.max(0, Number(quantity) || 0);
  if (required === 0) return { filled: true, totalCost: 0, averageUnitPrice: 0, region: null, location: null, orderCount: 0 };
  let remaining = required;
  let totalCost = 0;
  const used: FoundrySellOrder[] = [];

  for (const order of orders.slice().sort((a, b) => a.price - b.price)) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(order.volumeRemain) || 0);
    const price = Number(order.price);
    if (!available || !Number.isFinite(price) || price <= 0) continue;
    const take = Math.min(remaining, available);
    totalCost += take * price;
    remaining -= take;
    used.push(order);
  }

  if (remaining > 0) return { filled: false, totalCost: null, averageUnitPrice: null, region: null, location: null, orderCount: used.length };

  const regions = [...new Set(used.map((order) => order.regionName).filter(Boolean))];
  const locations = [...new Set(used.map((order) => order.locationName ?? order.systemName).filter(Boolean))];
  return {
    filled: true,
    totalCost,
    averageUnitPrice: totalCost / required,
    region: regions.length === 1 ? String(regions[0]) : regions.length > 1 ? "Multiple regions" : null,
    location: locations.length === 1 ? String(locations[0]) : locations.length > 1 ? "Multiple locations" : null,
    orderCount: used.length,
  };
}

function withPurchaseCost(row: any, quote: FoundryPurchaseQuote | undefined, quantity: number) {
  const required = Math.max(0, Number(quantity) || 0);
  const depth = priceFoundrySellDepth(quote?.sellOrders ?? [], required);
  const useDepth = Boolean(depth.filled && depth.averageUnitPrice != null);
  const referenceUnitPrice = quote?.referenceUnitPrice ?? null;
  const unitPrice = useDepth ? depth.averageUnitPrice : referenceUnitPrice;
  const buyCost = useDepth
    ? depth.totalCost
    : unitPrice == null
      ? null
      : required * unitPrice;
  const priceSource = useDepth
    ? depth.orderCount === 1
      ? "Executable retained public sell order"
      : `Executable retained public sell depth (${depth.orderCount} orders)`
    : referenceUnitPrice != null
      ? `${quote?.referenceSource ?? "ESI reference price"} - retained sell depth insufficient for quantity`
      : "No retained market price with enough volume";

  return {
    ...row,
    buyUnitPrice: unitPrice,
    buyCost,
    buyPriceSource: priceSource,
    buyRegion: useDepth ? depth.region : null,
    buyLocation: useDepth ? depth.location : null,
    buyDepthOrders: useDepth ? depth.orderCount : 0,
    marketCreatedAt: quote?.marketCreatedAt ?? null,
  };
}

function isAdvancedT2ComponentMarketType(meta: Awaited<ReturnType<typeof getMarketType>>) {
  if (!meta) return false;
  const marketPath = (meta.marketGroupPath ?? []).map((value) => String(value).toLowerCase());
  return marketPath.some((value) => value === "advanced components" || value === "advanced capital components")
    || /advanced capital construction components/i.test(meta.groupName);
}

function reachRank(reach: FoundryAcquisitionReach) {
  return reach === "high" ? 0 : reach === "low" ? 1 : 2;
}

async function classifyT2Input(typeId: number, selectedReach: FoundryAcquisitionReach) {
  const pi = await getPlanetaryAcquisitionGuide(typeId).catch(() => null);
  if (pi) {
    return {
      reach: "high" as const,
      action: "source" as const,
      label: pi.method === "extraction" ? "HIGH-SEC PI" : "HIGH-SEC PI / FACTORY",
      detail: pi.bestWay,
      unavailableInsideReach: false,
    };
  }
  const acquisition = await getLootAcquisition(typeId).catch(() => null);
  const routes = acquisition?.routes ?? [];
  const reaction = routes.find((row: any) => row.kind === "reaction");
  if (reaction) {
    const unavailableInsideReach = reachRank(selectedReach) < 1;
    return {
      reach: "low" as const,
      action: unavailableInsideReach ? "buy" as const : "source" as const,
      label: unavailableInsideReach ? "BUY - NO HIGH-SEC REACTION" : "REACT IN LOW-SEC",
      detail: unavailableInsideReach
        ? "This input is reaction-produced and cannot be made in high-sec."
        : "Path of least resistance: run the reaction in low-sec; null/wormhole is not required.",
      unavailableInsideReach,
    };
  }
  const manufacturing = routes.find((row: any) => row.kind === "manufacturing");
  if (manufacturing) {
    return {
      reach: "high" as const,
      action: "source" as const,
      label: "MANUFACTURE IN HIGH-SEC",
      detail: manufacturing.steps?.[0] ?? manufacturing.summary ?? manufacturing.title,
      unavailableInsideReach: false,
    };
  }
  const reprocessing = routes.find((row: any) => row.kind === "reprocessing");
  if (reprocessing) {
    return {
      reach: "high" as const,
      action: "source" as const,
      label: "SOURCE / REPROCESS IN HIGH-SEC",
      detail: reprocessing.steps?.[0] ?? reprocessing.summary ?? reprocessing.title,
      unavailableInsideReach: false,
    };
  }
  return {
    reach: "high" as const,
    action: "buy" as const,
    label: "BUY",
    detail: "No deterministic high/low/null production route is installed for this input.",
    unavailableInsideReach: true,
  };
}

export async function buildFoundryT2ComponentGuides(materials: FoundryBaseMaterial[], selectedReach: FoundryAcquisitionReach) {
  const rows: any[] = [];
  for (const material of materials) {
    const typeId = Number(material.typeId ?? 0);
    const meta = await getMarketType(typeId).catch(() => null);
    if (!isAdvancedT2ComponentMarketType(meta)) continue;

    const acquisition = await getLootAcquisition(typeId).catch(() => null);
    const manufacturing = (acquisition?.routes ?? []).find((route: any) => route.kind === "manufacturing");
    if (!manufacturing) continue;

    const product = (manufacturing.details?.products ?? []).find((row: any) => Number(row.typeId) === typeId)
      ?? (manufacturing.details?.products ?? [])[0];
    const outputPerRun = Math.max(1, Number(product?.quantity ?? 1));
    const runsRequired = Math.max(1, Math.ceil(Number(material.required ?? 0) / outputPerRun));
    const recipePerRun = (manufacturing.details?.materials ?? []).map((row: any) => ({
      typeId: Number(row.typeId),
      name: String(row.name),
      quantity: Number(row.quantity),
    }));
    const recipe = recipePerRun.map((row: any) => ({
      ...row,
      perRun: row.quantity,
      quantity: row.quantity * runsRequired,
    }));
    const inputPlans: any[] = [];
    for (const part of recipe) {
      inputPlans.push({ ...part, ...(await classifyT2Input(part.typeId, selectedReach)) });
    }

    rows.push({
      typeId,
      name: material.name,
      required: material.required,
      category: "t2-components",
      categoryLabel: "T2 Components",
      badge: "T2 COMPONENT",
      bestWay: "Manufacture " + runsRequired.toLocaleString() + " x " + String(manufacturing.details?.blueprintName ?? manufacturing.title) + " in high-sec.",
      instructions: [
        "Build the component in high-sec; there is no reason to move the component manufacturing job into lower security space.",
        selectedReach === "high"
          ? "For reaction-produced inputs that cannot be made in high-sec, buy the required quantity instead."
          : "For reaction-produced inputs, use low-sec first. Null-sec/wormhole is only needed if the lower-resistance route is unavailable to you.",
        "Output target: " + Number(material.required ?? 0).toLocaleString() + " x " + material.name + "; " + runsRequired.toLocaleString() + " run" + (runsRequired === 1 ? "" : "s") + " at " + outputPerRun.toLocaleString() + " per run.",
      ],
      sourceLabel: manufacturing.sourceLabel,
      recipe,
      recipePerRun,
      runsRequired,
      outputPerRun,
      inputPlans,
      selectedReach,
      security: "HIGH-SEC MANUFACTURING",
      facility: "Manufacturing-capable NPC station or Upwell structure",
      detail: manufacturing.details?.blueprintName ?? manufacturing.title,
      marketGroupPath: meta?.marketGroupPath ?? [],
    });
  }
  return rows;
}

export async function attachFoundryPurchaseCosts(plan: any) {
  const typeIds: number[] = [];
  for (const row of plan.buyMaterials ?? []) typeIds.push(Number(row.typeId));
  for (const group of plan.acquisitionGroups ?? []) {
    for (const row of group.rows ?? []) {
      typeIds.push(Number(row.typeId));
      for (const part of row.recipe ?? []) typeIds.push(Number(part.typeId));
      for (const part of row.inputPlans ?? []) typeIds.push(Number(part.typeId));
    }
  }
  const quotes = await foundryPurchaseQuotes(typeIds);

  const buyMaterials = (plan.buyMaterials ?? []).map((row: any) =>
    withPurchaseCost(row, quotes.get(Number(row.typeId)), Number(row.buyQuantity ?? 0)));

  const acquisitionGroups = (plan.acquisitionGroups ?? []).map((group: any) => ({
    ...group,
    rows: (group.rows ?? []).map((row: any) => {
      const pricedRecipe = (row.recipe ?? []).map((part: any) =>
        withPurchaseCost(part, quotes.get(Number(part.typeId)), Number(part.quantity ?? 0)));
      const pricedInputPlans = (row.inputPlans ?? []).map((part: any) =>
        withPurchaseCost(part, quotes.get(Number(part.typeId)), Number(part.quantity ?? 0)));
      const priced = withPurchaseCost(row, quotes.get(Number(row.typeId)), Number(row.required ?? 0));
      const buyOnlyInputs = pricedInputPlans.filter((part: any) => part.action === "buy");
      const recipeBuyCost = pricedRecipe.length && pricedRecipe.every((part: any) => part.buyCost != null)
        ? pricedRecipe.reduce((sum: number, part: any) => sum + Number(part.buyCost ?? 0), 0)
        : null;
      const inputBuyCost = buyOnlyInputs.length && buyOnlyInputs.every((part: any) => part.buyCost != null)
        ? buyOnlyInputs.reduce((sum: number, part: any) => sum + Number(part.buyCost ?? 0), 0)
        : buyOnlyInputs.length ? null : 0;

      const finishedBuyCost = priced.buyCost == null ? null : Number(priced.buyCost);
      const costComparisonAvailable = group.key !== "t2-components"
        && recipeBuyCost != null
        && finishedBuyCost != null
        && Number.isFinite(recipeBuyCost)
        && Number.isFinite(finishedBuyCost);
      const recommendationAction = costComparisonAvailable
        ? (finishedBuyCost <= Number(recipeBuyCost) ? "buy" : "make")
        : row.recipe?.length ? "unknown" : "source";
      const recommendationSavings = costComparisonAvailable
        ? Math.abs(finishedBuyCost - Number(recipeBuyCost))
        : null;

      return {
        ...priced,
        recipe: pricedRecipe,
        inputPlans: pricedInputPlans,
        recipeBuyCost,
        makeCost: recipeBuyCost,
        inputBuyCost,
        recommendationAction,
        recommendationSavings,
        recommendationCost: recommendationAction === "buy"
          ? finishedBuyCost
          : recommendationAction === "make"
            ? recipeBuyCost
            : null,
        costComparisonAvailable,
      };
    }),
  }));

  return {
    ...plan,
    buyMaterials,
    acquisitionGroups,
    totals: {
      ...(plan.totals ?? {}),
      buyCost: buyMaterials.length && buyMaterials.every((row: any) => row.buyCost != null)
        ? buyMaterials.reduce((sum: number, row: any) => sum + Number(row.buyCost ?? 0), 0)
        : buyMaterials.length ? null : 0,
    },
  };
}
