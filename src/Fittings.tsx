import { useEffect, useMemo, useState } from "react";
import "./fittings-task11.css";
import { fitFingerprint, parseFits, validateFit, type FitValidationResult } from "./fitting-engine";
import { duplicateFit, ensureFitMeta, exportFitJson, filterAndSortFits, renameFit, summarizeFit, type FitLibraryMetaMap, type FitLibrarySort } from "./fitting-library";
import "./fittings-task12.css";

type FitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  charge?: string;
  chargeTypeId?: number;
  chargeQuantity?: number;
  activeQuantity?: number;
  attributeOverrides?: Record<string, number>;
  state?: "offline" | "online" | "active" | "overheated";
};
type ModuleState = NonNullable<FitItem["state"]>;
type ExternalEffectKind = "booster" | "projected" | "command" | "environment";
type ExternalEffectSelection = {
  id: string;
  kind: ExternalEffectKind;
  name: string;
  typeId: number;
  chargeName?: string;
  chargeTypeId?: number;
  state?: ModuleState;
  effectiveness?: number;
};
type FitModuleRack = "low" | "mid" | "high" | "rig" | "subsystem";
type Fit = {
  id: string;
  name: string;
  hull: FitItem;
  low: FitItem[];
  mid: FitItem[];
  high: FitItem[];
  rig: FitItem[];
  subsystem: FitItem[];
  drones: FitItem[];
  cargo: FitItem[];
  instructions: string[];
  source: string;
};

const FITTING_APP_INSTRUCTIONS = `HOW TO USE NEW EDEN SAGE FITTINGS

1. Ask ChatGPT to design an EVE Online fit for your ship, activity, skills and budget.
2. Tell ChatGPT to use the New Eden Sage JSON structure below.
3. Copy ChatGPT's JSON code block.
4. Open Fittings in New Eden Sage and paste it into Import fitting code.
5. Select Import and display.
6. Review the ship, slots, drones, cargo and operating instructions.
7. Select Find cheapest purchase route.
8. Choose a connected character as the route origin.
9. Leave Buy the entire fit unchecked to exclude owned assets, or check it to price everything.

Standard EFT text beginning with [Ship, Fit name] is also accepted. JSON is recommended because it preserves slot groups, drones, cargo, type IDs and operating instructions.

When asking ChatGPT for a fit, request one JSON code block only with no text outside it, using this structure:

{
  "name": "Fit name",
  "ship": { "name": "Ship name", "typeId": 0, "quantity": 1 },
  "modules": {
    "high": [{ "name": "Module", "typeId": 0, "quantity": 1, "charge": "Optional loaded charge" }],
    "mid": [],
    "low": [],
    "rig": [],
    "subsystem": []
  },
  "drones": [{ "name": "Drone", "typeId": 0, "quantity": 5 }],
  "cargo": [{ "name": "Ammo or cargo", "typeId": 0, "quantity": 1000 }],
  "instructions": [
    "Concise operating instruction",
    "Engagement limits, capacitor notes and important warnings"
  ]
}

Replace every 0 typeId with the correct EVE type ID when confident. If uncertain, omit typeId rather than inventing one. Keep modules in their correct slot arrays. Include realistic quantities for drones, ammunition, scripts, probes, nanite paste and consumables. Do not include comments inside the JSON.`;

const emptyFit = (): Fit => ({
  id: crypto.randomUUID(),
  name: "New fitting",
  hull: { name: "Unknown hull", quantity: 1 },
  low: [],
  mid: [],
  high: [],
  rig: [],
  subsystem: [],
  drones: [],
  cargo: [],
  instructions: [],
  source: "",
});
const imageUrl = (
  typeId: number | undefined,
  variation: "icon" | "render",
  size: number,
) =>
  typeId
    ? `https://images.evetech.net/types/${typeId}/${variation}?size=${size}`
    : "";

function parseItem(value: unknown): FitItem {
  if (typeof value === "string") return parseEftItem(value);
  const item = value as {
    name?: string;
    typeName?: string;
    type_id?: number;
    typeId?: number;
    quantity?: number;
    charge?: string;
    chargeQuantity?: number;
    activeQuantity?: number;
    attributeOverrides?: Record<string, number>;
    mutatedAttributes?: Record<string, number>;
  };
  return {
    name: item.name ?? item.typeName ?? "Unknown item",
    typeId: item.typeId ?? item.type_id,
    quantity: item.quantity ?? 1,
    charge: item.charge,
    chargeQuantity: item.chargeQuantity,
    activeQuantity: item.activeQuantity,
    attributeOverrides: item.attributeOverrides ?? item.mutatedAttributes,
  };
}

function parseEftItem(line: string): FitItem {
  const quantityMatch = line.match(/\s+x(\d+)\s*$/i);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const clean = line.replace(/\s+x\d+\s*$/i, "").trim();
  const [name, ...charge] = clean.split(",").map((part) => part.trim());
  return { name, quantity, charge: charge.join(", ") || undefined };
}

function parseFit(text: string): Fit {
  const trimmed = text
    .trim()
    .replace(/^```(?:json|eft)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Record<string, any>;
    const modules = raw.modules ?? raw;
    const hull = parseItem(raw.ship ?? raw.hull ?? "Unknown hull");
    return {
      id: crypto.randomUUID(),
      name: raw.name ?? `${hull.name} fitting`,
      hull,
      low: (modules.low ?? []).map(parseItem),
      mid: (modules.mid ?? []).map(parseItem),
      high: (modules.high ?? []).map(parseItem),
      rig: (modules.rig ?? []).map(parseItem),
      subsystem: (modules.subsystem ?? []).map(parseItem),
      drones: (raw.drones ?? []).map(parseItem),
      cargo: (raw.cargo ?? []).map(parseItem),
      instructions: (raw.instructions ?? []).map(String),
      source: text,
    };
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines.shift()?.match(/^\[(.+?),\s*(.+?)\]$/);
  if (!header)
    throw new Error(
      "Use an EFT fit beginning with [Ship, Fit name], or a Sage JSON fit block.",
    );
  const groups: string[][] = [[]];
  for (const line of lines) {
    if (!line.trim()) {
      if (groups.at(-1)?.length) groups.push([]);
      continue;
    }
    if (!/^\[Empty .* slot\]$/i.test(line.trim()))
      groups.at(-1)!.push(line.trim());
  }
  const [
    low = [],
    mid = [],
    high = [],
    rig = [],
    subsystem = [],
    drones = [],
    cargo = [],
  ] = groups.filter((group) => group.length);
  return {
    id: crypto.randomUUID(),
    name: header[2],
    hull: { name: header[1], quantity: 1 },
    low: low.map(parseEftItem),
    mid: mid.map(parseEftItem),
    high: high.map(parseEftItem),
    rig: rig.map(parseEftItem),
    subsystem: subsystem.map(parseEftItem),
    drones: drones.map(parseEftItem),
    cargo: cargo.map(parseEftItem),
    instructions: [],
    source: text,
  };
}

function resolveFit(fit: Fit, names: Map<string, number>) {
  const resolve = (item: FitItem) => ({
    ...item,
    typeId:
      item.typeId && item.typeId > 0
        ? item.typeId
        : names.get(item.name.toLowerCase()),
    chargeTypeId: item.charge ? (names.get(item.charge.toLowerCase()) ?? item.chargeTypeId) : item.chargeTypeId,
  });
  return {
    ...fit,
    hull: resolve(fit.hull),
    low: fit.low.map(resolve),
    mid: fit.mid.map(resolve),
    high: fit.high.map(resolve),
    rig: fit.rig.map(resolve),
    subsystem: fit.subsystem.map(resolve),
    drones: fit.drones.map(resolve),
    cargo: fit.cargo.map(resolve),
  };
}

function fitItems(fit: Fit) {
  return [
    fit.hull,
    ...fit.low,
    ...fit.mid,
    ...fit.high,
    ...fit.rig,
    ...fit.subsystem,
    ...fit.drones,
    ...fit.cargo,
  ];
}

async function resolveFitFromEve(fit: Fit, known: Map<string, number>) {
  const locallyResolved = resolveFit(fit, known);
  const missing = [
    ...new Set(
      fitItems(locallyResolved)
        .filter((item) => !item.typeId)
        .map((item) => item.name),
    ),
  ];
  for (const item of fitItems(locallyResolved)) if (item.charge && !item.chargeTypeId) missing.push(item.charge);

  // Always ask the local SDE for bay-item metadata. EFT omits empty sections, so
  // blank-line position alone cannot reliably distinguish drones/fighters from cargo.
  const bayNames = [...new Set([...locallyResolved.drones, ...locallyResolved.cargo].map((item) => item.name))];
  const lookupNames = [...new Set([...missing, ...bayNames])];
  const resolved = lookupNames.length ? await window.sage.resolveFittingTypeNamesLocal(lookupNames) : [];
  const names = new Map(known);
  for (const item of resolved) names.set(item.name.toLowerCase(), item.id);
  const withIds = resolveFit(locallyResolved, names);
  const metadata = new Map(resolved.map((item: any) => [item.name.toLowerCase(), item]));
  const drones: FitItem[] = [];
  const cargo: FitItem[] = [];
  const classify = (item: FitItem, fallback: "drones" | "cargo") => {
    const info: any = metadata.get(item.name.toLowerCase());
    if (!info) { (fallback === "drones" ? drones : cargo).push(item); return; }
    const category = String(info.categoryName ?? "").toLowerCase();
    if (category === "drone" || category === "fighter") drones.push(item);
    else cargo.push(item);
  };
  withIds.drones.forEach((item) => classify(item, "drones"));
  withIds.cargo.forEach((item) => classify(item, "cargo"));
  return { ...withIds, drones, cargo };
}

export function FittingsWorkspace({ onExportToPlanner }: { onExportToPlanner?: (hullTypeId: number, characterId: string) => void }) {
  const [fits, setFits] = useState<Fit[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("new-eden-sage-fits") ?? "[]");
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(fits[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(
    "Paste an EFT or Sage JSON fitting block from ChatGPT.",
  );
  const [typeNames, setTypeNames] = useState(new Map<string, number>());
  const [characters, setCharacters] = useState<
    Array<{ characterId: string; character: { name: string } }>
  >([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);
  const [lastValidation, setLastValidation] = useState<FitValidationResult | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<FitLibrarySort>("recent");
  const [libraryMeta, setLibraryMeta] = useState<FitLibraryMetaMap>(() => {
    try { return JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") ?? "{}"); } catch { return {}; }
  });
  useEffect(() => {
    window.sage.listSnapshots().then((loaded) => {
      setCharacters(loaded);
      setSelectedCharacterId(
        (current) => current || loaded[0]?.characterId || "",
      );
    });
  }, []);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fits", JSON.stringify(fits));
    setLibraryMeta((current) => ensureFitMeta(fits, current));
  }, [fits]);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fit-library-meta", JSON.stringify(libraryMeta));
  }, [libraryMeta]);
  useEffect(() => {
    void window.sage.syncMcpRendererData({ savedFits: fits, fitLibraryMeta: libraryMeta });
  }, [fits, libraryMeta]);
  useEffect(() => window.sage.onMcpFitDataUpdated((value) => {
    if (Array.isArray(value.savedFits)) setFits(value.savedFits as Fit[]);
    if (value.fitLibraryMeta && typeof value.fitLibraryMeta === "object") setLibraryMeta(value.fitLibraryMeta as FitLibraryMetaMap);
  }), []);
  // Saved fits render immediately. Resolving the complete CCP DOGMA index on
  // mount used to freeze the entire app the first time Fittings was opened.
  // Type resolution now happens only when a fit is imported or analyzed.
  const active = useMemo(
    () => fits.find((fit) => fit.id === activeId) ?? fits[0],
    [fits, activeId],
  );
  const visibleFits = useMemo(() => filterAndSortFits(fits, libraryMeta, libraryQuery, librarySort), [fits, libraryMeta, libraryQuery, librarySort]);
  async function importFit() {
    try {
      const parsedFits = parseFits(input) as Fit[];
      const preflights = parsedFits.map(validateFit);
      const blocked = preflights.find((result) => !result.valid);
      setLastValidation(blocked ?? preflights[0] ?? null);
      if (blocked) {
        setStatus(`Import blocked: ${blocked.errors.map((issue) => issue.message).join("  ")}`);
        return;
      }
      const resolved = await Promise.all(parsedFits.map((fit) => resolveFitFromEve(fit, typeNames)));
      const existing = new Set(fits.map(fitFingerprint));
      const unique = resolved.filter((fit) => { const key = fitFingerprint(fit); if (existing.has(key)) return false; existing.add(key); return true; });
      const duplicateCount = resolved.length - unique.length;
      if (!unique.length) { setStatus(`Import skipped: ${duplicateCount} duplicate fitting${duplicateCount === 1 ? "" : "s"} already exist.`); return; }
      const validations = unique.map(validateFit);
      setLastValidation(validations.find((result) => result.issues.length) ?? validations[0]);
      setFits((current) => [...unique, ...current]);
      setActiveId(unique[0].id);
      const unresolved = unique.reduce((total, fit) => total + fitItems(fit).filter((item) => !item.typeId).length, 0);
      setStatus(`Imported ${unique.length} fitting${unique.length === 1 ? "" : "s"}. ${duplicateCount ? `${duplicateCount} duplicate${duplicateCount === 1 ? " was" : "s were"} skipped. ` : ""}${unresolved} item name(s) remain unresolved.`);
      setInput("");
    } catch (error) {
      setLastValidation(null);
      setStatus(
        error instanceof Error
          ? error.message
          : "The fitting could not be imported.",
      );
    }
  }
  function removeFit(id: string) {
    setFits((current) => current.filter((fit) => fit.id !== id));
    setLibraryMeta((current) => { const next = { ...current }; delete next[id]; return next; });
    if (activeId === id) setActiveId("");
  }
  function setActiveModuleState(rack: FitModuleRack, index: number, state: ModuleState) {
    if (!active) return;
    const itemName = active[rack][index]?.name ?? "Module";
    setFits((current) => current.map((fit) => {
      if (fit.id !== active.id) return fit;
      const next: Fit = { ...fit };
      next[rack] = fit[rack].map((item, itemIndex) => itemIndex === index ? { ...item, state } : item);
      return next;
    }));
    setLibraryMeta((current) => ({
      ...current,
      [active.id]: {
        ...(current[active.id] ?? { createdAt: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      },
    }));
    setStatus(`${itemName} set ${state}. Performance analysis will use this module state.`);
  }
  function setActiveDroneQuantity(index: number, activeQuantity: number) {
    if (!active) return;
    const drone = active.drones[index];
    if (!drone) return;
    const quantity = Math.max(0, Math.min(drone.quantity, Math.floor(activeQuantity)));
    setFits((current) => current.map((fit) => fit.id !== active.id ? fit : ({ ...fit, drones: fit.drones.map((item, itemIndex) => itemIndex === index ? { ...item, activeQuantity: quantity } : item) })));
    setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString() } }));
    setStatus(`${drone.name}: ${quantity} marked active for performance analysis.`);
  }
  function renameActiveFit() {
    if (!active) return;
    const nextName = window.prompt("Rename fitting", active.name);
    if (nextName == null) return;
    try {
      const renamed = renameFit(active, nextName);
      setFits((current) => current.map((fit) => fit.id === active.id ? renamed : fit));
      setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString() } }));
      setStatus(`Renamed fitting to ${renamed.name}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not rename fitting."); }
  }
  function duplicateActiveFit() {
    if (!active) return;
    const copy = duplicateFit(active);
    setFits((current) => [copy, ...current]);
    setActiveId(copy.id);
    setLibraryMeta((current) => ({ ...current, [copy.id]: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), readiness: "unknown" } }));
    setStatus(`Duplicated ${active.name}.`);
  }
  async function exportActiveFit() {
    if (!active) return;
    const verified = await window.sage.copyText(exportFitJson(active));
    setStatus(verified ? `${active.name} Sage JSON copied.` : "Clipboard verification failed.");
  }
  async function copyChatGPTInstructions() {
    const verified = await window.sage.copyText(FITTING_APP_INSTRUCTIONS);
    setStatus(
      verified
        ? "Fitting instructions copied and verified."
        : "Clipboard verification failed.",
    );
  }
  if (routeOpen && active)
    return (
      <FitRouteScreen
        fit={active}
        characters={characters}
        onBack={() => setRouteOpen(false)}
      />
    );
  return (
    <section className="fit-workspace">
      <div className="fit-library">
        <p className="eyebrow">LOCAL FIT LIBRARY</p>
        <h2>Fittings</h2>
        <div className="fit-list">
          <div className="fit-library-tools">
          <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search fits, hulls or modules" />
          <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value as FitLibrarySort)}>
            <option value="recent">Recently updated</option><option value="name">Fit name</option><option value="hull">Hull</option><option value="readiness">Readiness</option>
          </select>
        </div>
        {visibleFits.map((fit) => (
            <button
              className={fit.id === active?.id ? "active" : ""}
              onClick={() => setActiveId(fit.id)}
              key={fit.id}
            >
              <img src={imageUrl(fit.hull.typeId, "icon", 64)} />
              <span>
                <strong>{fit.name}</strong>
                <small>{fit.hull.name}</small>
                <em className={`fit-readiness ${libraryMeta[fit.id]?.readiness ?? "unknown"}`}>{libraryMeta[fit.id]?.readiness ?? "unknown"}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="fit-main">
        {active ? (
          <FitDisplay
            fit={active}
            characters={characters}
            characterId={selectedCharacterId}
            onCharacterChange={setSelectedCharacterId}
            onRemove={() => removeFit(active.id)}
            onRoute={() => setRouteOpen(true)}
            onRename={renameActiveFit}
            onDuplicate={duplicateActiveFit}
            onExport={exportActiveFit}
            onModuleStateChange={setActiveModuleState}
            onDroneActiveQuantityChange={setActiveDroneQuantity}
            onAnalysis={(readiness, missingRequirements) => setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString(), lastAnalyzedAt: new Date().toISOString(), readiness, missingRequirements } }))}
            onExportToPlanner={() => active.hull.typeId && onExportToPlanner?.(active.hull.typeId, selectedCharacterId)}
          />
        ) : (
          <div className="fit-empty">
            <span>â—‡</span>
            <h2>No fittings yet</h2>
            <p>
              Import a standard EFT block or a Sage JSON fit generated by
              ChatGPT.
            </p>
          </div>
        )}
      </div>
      <aside className="fit-import">
        <p className="eyebrow">FIT IMPORT</p>
        <h3>Import fitting code</h3>
        <p>Data is parsed locally and never executed.</p>
        <button className="copy-fit-prompt" onClick={copyChatGPTInstructions}>
          Instructions copy
        </button>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"[Ishtar, Example fit]\nDrone Damage Amplifier II\n..."}
        />
        <label className="copy-fit-prompt">
          Choose fitting file
          <input
            type="file"
            accept=".eft,.txt,.json,.xml"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try { setInput(await file.text()); setStatus(`${file.name} loaded locally. Review it, then import.`); }
              catch { setStatus(`Could not read ${file.name}.`); }
              event.target.value = "";
            }}
          />
        </label>
        <button onClick={importFit} disabled={!input.trim()}>
          Import and display
        </button>
        {active && active.instructions.length > 0 && (
          <div className="fit-instructions import-instructions">
            <h3>Operating instructions</h3>
            {active.instructions.map((instruction, index) => (
              <p key={index}>
                {index + 1}. {instruction}
              </p>
            ))}
          </div>
        )}
        <small>{status}</small>
        {lastValidation && lastValidation.issues.length > 0 && (
          <div className="fit-validation">
            <div className="fit-validation-head">
              <strong>{lastValidation.valid ? "Validation report" : "Import blocked"}</strong>
              <span>
                {lastValidation.errors.length} error(s) Â· {lastValidation.warnings.length} warning(s)
              </span>
            </div>
            {lastValidation.issues.slice(0, 8).map((issue, index) => (
              <p className={issue.level} key={`${issue.code}-${index}`}>
                <b>{issue.level.toUpperCase()}</b> {issue.message}
              </p>
            ))}
            {lastValidation.issues.length > 8 && (
              <small>+{lastValidation.issues.length - 8} more validation note(s)</small>
            )}
          </div>
        )}
        <div className="gpt-fit-note">
          <strong>ChatGPT workflow</strong>
          <p className="current-fit-help">
            Copy the instructions, paste them into ChatGPT, describe the fit you
            need, then paste its JSON response into the importer above.
          </p>
          <p>
            â€œReturn the final fit in standard EVE EFT format, followed by
            concise operating instructions.â€
          </p>
        </div>
      </aside>
    </section>
  );
}

function FitDisplay({
  fit,
  characters,
  characterId,
  onCharacterChange,
  onRemove,
  onRoute,
  onRename,
  onDuplicate,
  onExport,
  onModuleStateChange,
  onDroneActiveQuantityChange,
  onAnalysis,
  onExportToPlanner,
}: {
  fit: Fit;
  characters: Array<{ characterId: string; character: { name: string } }>;
  characterId: string;
  onCharacterChange(id: string): void;
  onRemove(): void;
  onRoute(): void;
  onRename(): void;
  onDuplicate(): void;
  onExport(): void;
  onModuleStateChange(rack: FitModuleRack, index: number, state: ModuleState): void;
  onDroneActiveQuantityChange(index: number, quantity: number): void;
  onAnalysis(readiness: "ready" | "missing", missingRequirements: number): void;
  onExportToPlanner(): void;
}) {
  const [tab, setTab] = useState<"fitting" | "performance">("fitting");
  const [analysis, setAnalysis] = useState<any>(null);
  const [targetProfile, setTargetProfile] = useState({ rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 });
  const [damageProfilePreset, setDamageProfilePreset] = useState<"omni" | "em" | "thermal" | "kinetic" | "explosive">("omni");
  const [externalEffects, setExternalEffects] = useState<ExternalEffectSelection[]>([]);
  const addExternalEffect = async (input: { kind: ExternalEffectKind; name: string; chargeName?: string }) => {
    const name = input.name.trim();
    const chargeName = input.chargeName?.trim() ?? "";
    if (!name) return "Enter an exact EVE item/effect name.";
    const requested = chargeName ? [name, chargeName] : [name];
    const resolved = await window.sage.resolveFittingTypeNamesLocal(requested);
    const byName = new Map(resolved.map((item) => [item.name.toLowerCase(), item]));
    const effect = byName.get(name.toLowerCase());
    if (!effect) return "No current CCP SDE type matched “" + name + "”.";
    const charge = chargeName ? byName.get(chargeName.toLowerCase()) : undefined;
    if (chargeName && !charge) return "No current CCP SDE charge/script matched “" + chargeName + "”.";
    if (externalEffects.some((item) => item.kind === input.kind && item.typeId === effect.id && item.chargeTypeId === charge?.id)) return "That external effect is already selected.";
    setExternalEffects((current) => [...current, { id: crypto.randomUUID(), kind: input.kind, name: effect.name, typeId: effect.id, chargeName: charge?.name, chargeTypeId: charge?.id, state: "active", effectiveness: 1 }]);
    return null;
  };
  const updateExternalEffect = (id: string, patch: Partial<ExternalEffectSelection>) => setExternalEffects((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeExternalEffect = (id: string) => setExternalEffects((current) => current.filter((item) => item.id !== id));
  const damageProfile = damageProfilePreset === "em" ? { em: 1, thermal: 0, kinetic: 0, explosive: 0 } : damageProfilePreset === "thermal" ? { em: 0, thermal: 1, kinetic: 0, explosive: 0 } : damageProfilePreset === "kinetic" ? { em: 0, thermal: 0, kinetic: 1, explosive: 0 } : damageProfilePreset === "explosive" ? { em: 0, thermal: 0, kinetic: 0, explosive: 1 } : { em: 0.25, thermal: 0.25, kinetic: 0.25, explosive: 0.25 };
  const [analysisStatus, setAnalysisStatus] = useState(
    "Select Performance & skills to analyze this fit.",
  );
  useEffect(() => {
    if (tab !== "performance" || !characterId || !fit.hull.typeId) return;
    let cancelled = false;
    setAnalysis(null);
    setAnalysisStatus("Checking hull attributes and character skills...");
    window.sage
      .analyzeFitting({
        characterId,
        hullTypeId: fit.hull.typeId,
        itemTypeIds: fitItems(fit)
          .map((item) => item.typeId)
          .filter((id): id is number => Boolean(id)),
        targetProfile,
        damageProfile,
        boosterTypeIds: externalEffects.filter((item) => item.kind === "booster").map((item) => item.typeId),
        projectedItems: externalEffects.filter((item) => item.kind === "projected").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        commandBurstItems: externalEffects.filter((item) => item.kind === "command").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        environmentTypeIds: externalEffects.filter((item) => item.kind === "environment").map((item) => item.typeId),
        items: (["low", "mid", "high", "rig", "subsystem", "drones", "cargo"] as const).flatMap((rack) =>
          fit[rack].flatMap((item) => item.typeId ? [{ typeId: item.typeId, quantity: item.quantity, activeQuantity: item.activeQuantity, chargeTypeId: item.chargeTypeId, chargeQuantity: item.chargeQuantity, attributeOverrides: item.attributeOverrides, state: item.state ?? (rack === "rig" || rack === "subsystem" ? "online" : "active"), rack: rack === "drones" ? "drone" : rack === "cargo" ? "cargo" : rack }] : []),
        ),
      })
      .then((result) => {
        if (!cancelled) {
          setAnalysis(result);
          const missingCount = result.missingRequirements.length;
          setAnalysisStatus(missingCount ? `${missingCount} missing or undertrained requirement(s).` : "All identified fitting skill requirements are met.");
          onAnalysis(missingCount ? "missing" : "ready", missingCount);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setAnalysisStatus(
            error instanceof Error ? error.message : "Fitting analysis failed.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [tab, characterId, fit.id, fit.hull.typeId, fit.low, fit.mid, fit.high, fit.rig, fit.subsystem, fit.drones, fit.cargo, targetProfile.rangeM, targetProfile.signatureRadiusM, targetProfile.transverseVelocityMps, targetProfile.velocityMps, damageProfilePreset, externalEffects]);
  const fitSummary = summarizeFit(fit);
  return (
    <div className="fit-display">
      <div className="fit-title">
        <div>
          <p className="eyebrow">SHIP FITTING</p>
          <h2>{fit.name}</h2>
          <span>{fit.hull.name}</span>
        </div>
        <div className="fit-title-actions">
          <select
            value={characterId}
            onChange={(event) => onCharacterChange(event.target.value)}
          >
            {characters.map((character) => (
              <option key={character.characterId} value={character.characterId}>
                {character.character.name}
              </option>
            ))}
          </select>
          <button onClick={onRename}>Rename</button>
          <button onClick={onDuplicate}>Duplicate</button>
          <button onClick={onExport}>Copy JSON</button>
          <button className="route-fit" onClick={onRoute}>
            Find cheapest purchase route
          </button>
          <button onClick={onRemove}>Delete fit</button>
        </div>
      </div>
      <div className="fit-library-summary">
        <span>{fitSummary.moduleCount} modules</span><span>{fitSummary.droneCount} drones</span><span>{fitSummary.resolvedItems} resolved</span><span>{fitSummary.unresolvedItems} unresolved</span>
      </div>
      <div className="fit-tabs">
        <button
          className={tab === "fitting" ? "active" : ""}
          onClick={() => setTab("fitting")}
        >
          Fitting
        </button>
        <button
          className={tab === "performance" ? "active" : ""}
          onClick={() => setTab("performance")}
        >
          Performance & skills
        </button>
      </div>
      {tab === "fitting" ? (
        <>
          <div className="fit-stage">
            <div className="ship-portrait">
              {fit.hull.typeId ? (
                <img src={imageUrl(fit.hull.typeId, "render", 512)} />
              ) : (
                <div>?</div>
              )}
              <strong>{fit.hull.name}</strong>
            </div>
            <div className="slot-racks">
              <SlotRack title="High slots" side="high" items={fit.high} onStateChange={onModuleStateChange} />
              <SlotRack title="Mid slots" side="mid" items={fit.mid} onStateChange={onModuleStateChange} />
              <SlotRack title="Low slots" side="low" items={fit.low} onStateChange={onModuleStateChange} />
              <SlotRack title="Rigs" side="rig" items={fit.rig} onStateChange={onModuleStateChange} />
              {fit.subsystem.length > 0 && (
                <SlotRack
                  title="Subsystems"
                  side="subsystem"
                  items={fit.subsystem}
                  onStateChange={onModuleStateChange}
                />
              )}
            </div>
          </div>
          <div className="fit-bays">
            <ItemBay title="Drone bay" items={fit.drones} activeDroneSelection onActiveQuantityChange={onDroneActiveQuantityChange} />
            <ItemBay title="Cargo and charges" items={fit.cargo} />
          </div>
        </>
      ) : (
        <FitPerformance analysis={analysis} status={analysisStatus} fit={fit} targetProfile={targetProfile} onTargetProfileChange={setTargetProfile} damageProfilePreset={damageProfilePreset} onDamageProfilePresetChange={setDamageProfilePreset} externalEffects={externalEffects} onAddExternalEffect={addExternalEffect} onUpdateExternalEffect={updateExternalEffect} onRemoveExternalEffect={removeExternalEffect} onExportToPlanner={onExportToPlanner} />
      )}
    </div>
  );
}

function FitPerformance({
  analysis,
  status,
  fit,
  targetProfile,
  onTargetProfileChange,
  damageProfilePreset,
  onDamageProfilePresetChange,
  externalEffects,
  onAddExternalEffect,
  onUpdateExternalEffect,
  onRemoveExternalEffect,
  onExportToPlanner,
}: {
  analysis: any;
  status: string;
  fit: Fit;
  targetProfile: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };
  onTargetProfileChange(value: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number }): void;
  damageProfilePreset: "omni" | "em" | "thermal" | "kinetic" | "explosive";
  onDamageProfilePresetChange(value: "omni" | "em" | "thermal" | "kinetic" | "explosive"): void;
  externalEffects: ExternalEffectSelection[];
  onAddExternalEffect(input: { kind: ExternalEffectKind; name: string; chargeName?: string }): Promise<string | null>;
  onUpdateExternalEffect(id: string, patch: Partial<ExternalEffectSelection>): void;
  onRemoveExternalEffect(id: string): void;
  onExportToPlanner(): void;
}) {
  const [externalKind, setExternalKind] = useState<ExternalEffectKind>("environment");
  const [externalName, setExternalName] = useState("");
  const [externalCharge, setExternalCharge] = useState("");
  const [externalStatus, setExternalStatus] = useState("");
  const submitExternalEffect = async () => {
    setExternalStatus("Resolving from local CCP SDE...");
    try {
      const error = await onAddExternalEffect({ kind: externalKind, name: externalName, chargeName: externalCharge || undefined });
      if (error) setExternalStatus(error);
      else { setExternalStatus("External effect added."); setExternalName(""); setExternalCharge(""); }
    } catch (error) { setExternalStatus(error instanceof Error ? error.message : "Could not add external effect."); }
  };
  return (
    <div className="fit-performance">
      <div className="performance-note">
        <strong>{status}</strong>
        <small>
          Offline CCP dogma validates fitting resources, slots, hardpoints and
          character requirements. Effect simulation is being expanded toward
          full Pyfa parity.
        </small>
      </div>
      <h3>Damage profile</h3>
      <div className="damage-profile-controls"><label>Incoming damage<select value={damageProfilePreset} onChange={(event) => onDamageProfilePresetChange(event.target.value as typeof damageProfilePreset)}><option value="omni">Omni 25/25/25/25</option><option value="em">100% EM</option><option value="thermal">100% Thermal</option><option value="kinetic">100% Kinetic</option><option value="explosive">100% Explosive</option></select></label></div>
      <h3>Target application</h3>
      <div className="target-profile-controls">
        <label>Range km<input type="number" min="0" step="1" value={targetProfile.rangeM / 1000} onChange={(event) => onTargetProfileChange({ ...targetProfile, rangeM: Math.max(0, Number(event.target.value) * 1000) })} /></label>
        <label>Signature m<input type="number" min="1" step="1" value={targetProfile.signatureRadiusM} onChange={(event) => onTargetProfileChange({ ...targetProfile, signatureRadiusM: Math.max(1, Number(event.target.value)) })} /></label>
        <label>Transversal m/s<input type="number" min="0" step="10" value={targetProfile.transverseVelocityMps} onChange={(event) => onTargetProfileChange({ ...targetProfile, transverseVelocityMps: Math.max(0, Number(event.target.value)) })} /></label>
        <label>Velocity m/s<input type="number" min="0" step="10" value={targetProfile.velocityMps} onChange={(event) => onTargetProfileChange({ ...targetProfile, velocityMps: Math.max(0, Number(event.target.value)) })} /></label>
      </div>
      <h3>External effects</h3>
      <div className="external-effects-panel">
        <div className="external-effect-add">
          <label>Type<select value={externalKind} onChange={(event) => setExternalKind(event.target.value as ExternalEffectKind)}><option value="environment">Environment</option><option value="booster">Booster</option><option value="projected">Projected module</option><option value="command">Command burst</option></select></label>
          <label>Exact CCP name<input value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder={externalKind === "environment" ? "Class 1 Pulsar Effects" : externalKind === "booster" ? "Strong Blue Pill Booster" : externalKind === "command" ? "Shield Command Burst II" : "Stasis Webifier II"} /></label>
          {(externalKind === "projected" || externalKind === "command") && <label>Charge / script<input value={externalCharge} onChange={(event) => setExternalCharge(event.target.value)} placeholder={externalKind === "command" ? "Shield Extension Charge" : "Optional script"} /></label>}
          <button type="button" onClick={submitExternalEffect}>Add effect</button>
        </div>
        {externalStatus && <small className="external-effect-status">{externalStatus}</small>}
        {externalEffects.length > 0 && <div className="external-effect-list">{externalEffects.map((item) => <div className="external-effect-row" key={item.id}><div><strong>{item.name}</strong><small>{item.kind}{item.chargeName ? <> · {item.chargeName}</> : null}</small></div>{(item.kind === "projected" || item.kind === "command") && <><label>State<select value={item.state ?? "active"} onChange={(event) => onUpdateExternalEffect(item.id, { state: event.target.value as ModuleState })}><option value="active">Active</option><option value="overheated">Overheated</option></select></label><label>Effect %<input type="number" min="0" max="100" step="1" value={Math.round((item.effectiveness ?? 1) * 100)} onChange={(event) => onUpdateExternalEffect(item.id, { effectiveness: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /></label></>}<button type="button" onClick={() => onRemoveExternalEffect(item.id)}>Remove</button></div>)}</div>}
      </div>
      {analysis && (
        <>
          <div className="performance-summary">
            <article>
              <span>Pilot</span>
              <strong>{analysis.character}</strong>
              <small>
                {analysis.totalSkillPoints.toLocaleString()} total SP
              </small>
            </article>
            <article>
              <span>Fit readiness</span>
              <strong>
                {analysis.missingRequirements.length
                  ? "Requirements missing"
                  : "Ready"}
              </strong>
              <small>
                {analysis.requirements.length} ship/module types checked
              </small>
            </article>
            <article>
              <span>Slots used</span>
              <strong>
                {fit.high.length}H / {fit.mid.length}M / {fit.low.length}L /{" "}
                {fit.rig.length}R
              </strong>
              <small>Modules grouped by imported fitting slots</small>
            </article>
          </div>
          <h3>Base hull performance</h3>
          {analysis.resources && (
            <div className="base-stat-grid">
              {(["cpu", "powergrid", "calibration"] as const).map((key) => (
                <article key={key}>
                  <span>{key}</span>
                  <strong>{analysis.resources.used[key].toFixed(1)} / {analysis.resources.capacity[key].toFixed(1)}</strong>
                </article>
              ))}
            </div>
          )}
          {analysis.capacitor && (
            <div className="base-stat-grid">
              <article><span>Capacitor demand</span><strong>{analysis.capacitor.demandGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Peak recharge</span><strong>{analysis.capacitor.peakRechargeGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Capacitor state</span><strong>{analysis.capacitor.stable ? `Stable Â· ${analysis.capacitor.stablePercent.toFixed(1)}%` : `${Math.round(analysis.capacitor.depletionSeconds)}s`}</strong></article>
            </div>
          )}
          {analysis.damage && (
            <div className="base-stat-grid">
              <article><span>Raw paper DPS</span><strong>{analysis.damage.totalDps.toFixed(1)}</strong></article>
              <article><span>Weapon / drone DPS</span><strong>{analysis.damage.weaponDps.toFixed(1)} / {analysis.damage.droneDps.toFixed(1)}</strong></article>
              <article><span>Total volley</span><strong>{analysis.damage.totalVolley.toFixed(1)}</strong></article>
              <article><span>Active drones</span><strong>{analysis.damage.activeDrones.length}</strong><small>{analysis.damage.activeDrones.map((drone: any) => drone.name).join(", ") || "None selected"}</small></article>
              {analysis.damage.weaponProfiles.map((weapon: any, index: number) => <article key={`${weapon.typeId}-${index}`}><span>{weapon.name}</span><strong>{weapon.kind === "turret" ? `${(weapon.optimalM / 1000).toFixed(1)} + ${(weapon.falloffM / 1000).toFixed(1)} km` : `${(weapon.maximumRangeM / 1000).toFixed(1)} km`}</strong><small>{weapon.kind === "turret" ? `${weapon.tracking.toFixed(3)} tracking` : `${weapon.explosionRadiusM.toFixed(0)} m explosion Â· ${weapon.explosionVelocity.toFixed(0)} m/s`}</small></article>)}
            </div>
          )}
          {analysis.defence && (
            <div className="base-stat-grid">
              <article><span>Profile EHP</span><strong>{Math.round(analysis.defence.totalEhp).toLocaleString()}</strong></article>
              <article><span>Shield / armor / hull</span><strong>{analysis.defence.shieldHp} / {analysis.defence.armorHp} / {analysis.defence.structureHp}</strong></article>
              <article><span>Raw active repair</span><strong>{(analysis.defence.shieldRepairPerSecond + analysis.defence.armorRepairPerSecond + analysis.defence.structureRepairPerSecond).toFixed(1)} HP/s</strong></article>
              <article><span>Effective active tank</span><strong>{(analysis.defence.effectiveShieldRepairPerSecond + analysis.defence.effectiveArmorRepairPerSecond + analysis.defence.effectiveStructureRepairPerSecond).toFixed(1)} EHP/s</strong></article>
              <article><span>Peak passive shield</span><strong>{analysis.defence.passiveShieldPeak.toFixed(1)} HP/s · {analysis.defence.effectivePassiveShieldPeak.toFixed(1)} EHP/s</strong></article>
            </div>
          )}
          {analysis.navigation && analysis.targeting && (
            <div className="base-stat-grid">
              <article><span>Align time</span><strong>{analysis.navigation.alignSeconds.toFixed(2)} s</strong></article>
              <article><span>Base speed / warp</span><strong>{analysis.navigation.maximumVelocity.toFixed(0)} m/s Â· {analysis.navigation.warpSpeedAuPerSecond.toFixed(1)} AU/s</strong></article>
              <article><span>Targeting</span><strong>{(analysis.targeting.maximumRangeM / 1000).toFixed(1)} km Â· {analysis.targeting.scanResolution.toFixed(0)} mm</strong></article>
              <article><span>Signature / sensors</span><strong>{analysis.targeting.signatureRadiusM.toFixed(0)} m Â· {analysis.targeting.sensorStrength.toFixed(1)}</strong></article>
            </div>
          )}
          {analysis.heat && (
            <>
              <h3>Heat & overload</h3>
              <div className="performance-note">
                <strong>Expected heat behaviour</strong>
                <small>Heat damage is probabilistic in EVE. Burnout values are expected outcomes from CCP rack heat, occupied-slot and attenuation mechanics, not guaranteed timers.</small>
              </div>
              {analysis.heat.racks.some((rack: any) => rack.overheatedModules > 0) ? analysis.heat.racks.filter((rack: any) => rack.overheatedModules > 0).map((rack: any) => (
                <div key={rack.rack}>
                  <div className="base-stat-grid">
                    <article><span>{rack.rack} rack heat · 30s</span><strong>{(rack.heatAt30Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>{rack.rack} rack heat · 60s</span><strong>{(rack.heatAt60Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>Expected first burnout</span><strong>{rack.firstExpectedBurnoutSeconds > 0 ? Math.floor(rack.firstExpectedBurnoutSeconds / 60) + "m " + Math.round(rack.firstExpectedBurnoutSeconds % 60) + "s" : "Beyond 60m / none"}</strong></article>
                    <article><span>Heat attenuation</span><strong>{rack.attenuation.toFixed(2)}</strong><small>{rack.overheatedModules} overloaded · {(rack.occupiedSlotFactor * 100).toFixed(1)}% occupied-slot factor</small></article>
                  </div>
                  <div className="requirement-list">
                    {rack.modules.filter((module: any) => module.state === "overheated" || module.expectedBurnoutSeconds > 0).map((module: any) => (
                      <article className={module.state === "overheated" ? "missing" : "ready"} key={rack.rack + "-" + module.position + "-" + module.typeId}>
                        <strong>{module.name}</strong>
                        <span>{module.state === "overheated" ? "Overheated source" : "Rack position " + (module.position + 1)}</span>
                        <small>{module.heatDamage.toFixed(2)} heat damage · {module.cycleSeconds.toFixed(2)}s cycle · {module.expectedBurnoutSeconds > 0 ? "expected burnout " + Math.floor(module.expectedBurnoutSeconds / 60) + "m " + Math.round(module.expectedBurnoutSeconds % 60) + "s" : "no expected burnout within 60m"}</small>
                      </article>
                    ))}
                  </div>
                </div>
              )) : <div className="performance-note"><small>No fitted modules are currently set to Overheated.</small></div>}
            </>
          )}
          {analysis.issues?.length > 0 && <div className="requirement-list">{analysis.issues.map((issue: any, index: number) => <article className={issue.level === "error" ? "missing" : "ready"} key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small></article>)}</div>}
          <div className="base-stat-grid">
            {analysis.baseStats.map((stat: any) => (
              <article key={stat.id}>
                <span>{stat.label}</span>
                <strong>
                  {Math.round(stat.value).toLocaleString()} {stat.unit}
                </strong>
              </article>
            ))}
          </div>
          <div className="planner-panel-title">
            <div><p className="eyebrow">FIT PROGRESSION</p><h3>Continue in Progression</h3></div>
            <button onClick={onExportToPlanner}>Export to Progression Ship Planner</button>
          </div>
        </>
      )}
    </div>
  );
}

function FitRouteScreen({
  fit,
  characters,
  onBack,
}: {
  fit: Fit;
  characters: Array<{ characterId: string; character: { name: string } }>;
  onBack(): void;
}) {
  const [characterId, setCharacterId] = useState(
    characters[0]?.characterId ?? "",
  );
  const [buyEntireFit, setBuyEntireFit] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState(
    "Choose a character whose current location will be the route origin.",
  );
  async function calculate() {
    setStatus("Comparing owned assets, prices and secure routes...");
    setResult(null);
    try {
      const items = [
        fit.hull,
        ...fit.low,
        ...fit.mid,
        ...fit.high,
        ...fit.rig,
        ...fit.subsystem,
        ...fit.drones,
        ...fit.cargo,
      ];
      const next = await window.sage.buildFitShoppingRoute({
        characterId,
        buyEntireFit,
        items,
      });
      setResult(next);
      setStatus(`Route calculated from ${next.origin}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Route calculation failed.",
      );
    }
  }
  return (
    <section className="fit-route-screen">
      <div className="route-head">
        <div>
          <p className="eyebrow">FIT PROCUREMENT</p>
          <h2>{fit.name}</h2>
          <p>{status}</p>
        </div>
        <button onClick={onBack}>Back to fitting</button>
      </div>
      <div className="route-controls">
        <select
          value={characterId}
          onChange={(event) => setCharacterId(event.target.value)}
        >
          {characters.map((character) => (
            <option value={character.characterId} key={character.characterId}>
              {character.character.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={buyEntireFit}
            onChange={(event) => setBuyEntireFit(event.target.checked)}
          />
          Buy the entire fit; ignore owned assets
        </label>
        <button onClick={calculate} disabled={!characterId}>
          Calculate optimal route
        </button>
      </div>
      {result && (
        <>
          <div className="route-metrics">
            <article>
              <span>Total purchase</span>
              <strong>
                {Math.round(result.totalCost).toLocaleString()} ISK
              </strong>
            </article>
            <article>
              <span>Qualifying saving</span>
              <strong>
                {Math.round(result.estimatedSavings).toLocaleString()} ISK
              </strong>
            </article>
            <article>
              <span>Station stops</span>
              <strong>{result.stops}</strong>
            </article>
          </div>
          <div className="route-table">
            <div className="route-row heading">
              <span>Item</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Station</span>
              <span>Jumps</span>
              <span>Saving</span>
            </div>
            {result.purchases.map((purchase: any, index: number) => (
              <div className="route-row" key={`${purchase.typeId}-${index}`}>
                <span>{purchase.item}</span>
                <span>{purchase.quantity.toLocaleString()}</span>
                <span>{Math.round(purchase.total).toLocaleString()} ISK</span>
                <span>
                  <strong>{purchase.system}</strong>
                  <small>{purchase.station}</small>
                </span>
                <span>{purchase.jumps}</span>
                <span>
                  {purchase.savingVsLocal === null
                    ? "Required travel"
                    : `${Math.round(purchase.savingVsLocal).toLocaleString()} ISK`}
                </span>
              </div>
            ))}
          </div>
          {result.unavailable.length > 0 && (
            <div className="route-unavailable">
              <h3>Still required</h3>
              {result.unavailable.map((item: any) => (
                <p key={item.item}>
                  {item.item} x{item.quantity}: {item.reason}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SlotRack({
  title,
  side,
  items,
  onStateChange,
}: {
  title: string;
  side: FitModuleRack;
  items: FitItem[];
  onStateChange(rack: FitModuleRack, index: number, state: ModuleState): void;
}) {
  const states: ModuleState[] = side === "rig" || side === "subsystem"
    ? ["offline", "online"]
    : ["offline", "online", "active", "overheated"];
  return (
    <div className={`slot-rack ${side}`}>
      <span>{title}</span>
      <div>
        {items.length ? (
          items.map((item, index) => (
            <ItemIcon
              item={item}
              states={states}
              onStateChange={(state) => onStateChange(side, index, state)}
              key={`${item.name}-${index}`}
            />
          ))
        ) : (
          <small>No modules</small>
        )}
      </div>
    </div>
  );
}
function ItemIcon({
  item,
  states,
  onStateChange,
}: {
  item: FitItem;
  states: ModuleState[];
  onStateChange(state: ModuleState): void;
}) {
  const defaultState: ModuleState = states.includes("active") ? "active" : "online";
  const currentState = item.state && states.includes(item.state) ? item.state : defaultState;
  return (
    <div
      className={`fit-item state-${currentState}`}
      title={`${item.name}${item.charge ? `, ${item.charge}` : ""}`}
    >
      {item.typeId ? <img src={imageUrl(item.typeId, "icon", 64)} /> : <b>?</b>}
      {item.quantity > 1 && <em>{item.quantity}</em>}
      <span>{item.name}</span>
      <select
        className="fit-module-state"
        value={currentState}
        aria-label={`${item.name} module state`}
        onChange={(event) => onStateChange(event.target.value as ModuleState)}
      >
        {states.map((state) => <option value={state} key={state}>{state}</option>)}
      </select>
    </div>
  );
}
function ItemBay({ title, items, activeDroneSelection = false, onActiveQuantityChange }: { title: string; items: FitItem[]; activeDroneSelection?: boolean; onActiveQuantityChange?: (index: number, quantity: number) => void }) {
  return (
    <div className="item-bay">
      <h3>{title}</h3>
      {items.length ? (
        items.map((item, index) => (
          <div key={`${item.name}-${index}`}>
            <img src={imageUrl(item.typeId, "icon", 64)} />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.quantity} unit{item.quantity === 1 ? "" : "s"}
              </small>
              {activeDroneSelection && <label className="drone-active-selector">Active <input aria-label={`${item.name} active drones`} type="number" min="0" max={item.quantity} step="1" value={item.activeQuantity ?? ""} placeholder="Auto" onChange={(event) => onActiveQuantityChange?.(index, event.target.value === "" ? 0 : Number(event.target.value))} /></label>}
            </span>
          </div>
        ))
      ) : (
        <p>Empty</p>
      )}
    </div>
  );
}




