import { useEffect, useMemo, useState } from "react";

type FitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  charge?: string;
};
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
  };
  return {
    name: item.name ?? item.typeName ?? "Unknown item",
    typeId: item.typeId ?? item.type_id,
    quantity: item.quantity ?? 1,
    charge: item.charge,
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
  if (!missing.length) return locallyResolved;
  const resolved = await window.sage.resolveTypeNames(missing);
  const names = new Map(known);
  for (const item of resolved) names.set(item.name.toLowerCase(), item.id);
  return resolveFit(locallyResolved, names);
}

export function FittingsWorkspace() {
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
  }, [fits]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(fits.map((fit) => resolveFitFromEve(fit, typeNames)))
      .then((resolved) => {
        if (!cancelled) {
          setFits(resolved);
          const unresolved = resolved.reduce(
            (total, fit) =>
              total + fitItems(fit).filter((item) => !item.typeId).length,
            0,
          );
          setStatus(
            unresolved
              ? `${unresolved} saved fitting item name(s) could not be matched to EVE's type index.`
              : "Saved fitting item images resolved from EVE.",
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Backfill type IDs for fits saved before direct EVE lookup was added.
  }, [typeNames]);
  const active = useMemo(
    () => fits.find((fit) => fit.id === activeId) ?? fits[0],
    [fits, activeId],
  );
  async function importFit() {
    try {
      const fit = await resolveFitFromEve(parseFit(input), typeNames);
      setFits((current) => [fit, ...current]);
      setActiveId(fit.id);
      setStatus(
        `Imported ${fit.name}. ${fitItems(fit).filter((item) => !item.typeId).length} item names could not be matched to EVE's type index.`,
      );
      setInput("");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The fitting could not be imported.",
      );
    }
  }
  function removeFit(id: string) {
    setFits((current) => current.filter((fit) => fit.id !== id));
    if (activeId === id) setActiveId("");
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
          {fits.map((fit) => (
            <button
              className={fit.id === active?.id ? "active" : ""}
              onClick={() => setActiveId(fit.id)}
              key={fit.id}
            >
              <img src={imageUrl(fit.hull.typeId, "icon", 64)} />
              <span>
                <strong>{fit.name}</strong>
                <small>{fit.hull.name}</small>
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
          />
        ) : (
          <div className="fit-empty">
            <span>◇</span>
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
        <div className="gpt-fit-note">
          <strong>ChatGPT workflow</strong>
          <p className="current-fit-help">
            Copy the instructions, paste them into ChatGPT, describe the fit you
            need, then paste its JSON response into the importer above.
          </p>
          <p>
            “Return the final fit in standard EVE EFT format, followed by
            concise operating instructions.”
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
}: {
  fit: Fit;
  characters: Array<{ characterId: string; character: { name: string } }>;
  characterId: string;
  onCharacterChange(id: string): void;
  onRemove(): void;
  onRoute(): void;
}) {
  const [tab, setTab] = useState<"fitting" | "performance">("fitting");
  const [analysis, setAnalysis] = useState<any>(null);
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
      })
      .then((result) => {
        if (!cancelled) {
          setAnalysis(result);
          setAnalysisStatus(
            result.missingRequirements.length
              ? `${result.missingRequirements.length} missing or undertrained requirement(s).`
              : "All identified fitting skill requirements are met.",
          );
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
  }, [tab, characterId, fit.id, fit.hull.typeId]);
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
          <button className="route-fit" onClick={onRoute}>
            Find cheapest purchase route
          </button>
          <button onClick={onRemove}>Delete fit</button>
        </div>
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
              <SlotRack title="High slots" side="high" items={fit.high} />
              <SlotRack title="Mid slots" side="mid" items={fit.mid} />
              <SlotRack title="Low slots" side="low" items={fit.low} />
              <SlotRack title="Rigs" side="rig" items={fit.rig} />
              {fit.subsystem.length > 0 && (
                <SlotRack
                  title="Subsystems"
                  side="subsystem"
                  items={fit.subsystem}
                />
              )}
            </div>
          </div>
          <div className="fit-bays">
            <ItemBay title="Drone bay" items={fit.drones} />
            <ItemBay title="Cargo and charges" items={fit.cargo} />
          </div>
        </>
      ) : (
        <FitPerformance analysis={analysis} status={analysisStatus} fit={fit} />
      )}
    </div>
  );
}

function FitPerformance({
  analysis,
  status,
  fit,
}: {
  analysis: any;
  status: string;
  fit: Fit;
}) {
  return (
    <div className="fit-performance">
      <div className="performance-note">
        <strong>{status}</strong>
        <small>
          Hull figures are base EVE attributes. Skill requirements use the
          selected character's latest sync; exact fitted DPS, EHP, capacitor
          stability, heat and stacking penalties are not simulated yet.
        </small>
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
          <h3>Ship and module skill audit</h3>
          <div className="requirement-list">
            {analysis.requirements.map((item: any) => (
              <article
                className={item.usable ? "ready" : "missing"}
                key={item.typeId}
              >
                <strong>{item.item}</strong>
                <span>{item.usable ? "Usable" : "Missing requirements"}</span>
                {item.skills.map((skill: any) => (
                  <small key={skill.skillId}>
                    {skill.skill}: {skill.trainedLevel}/{skill.requiredLevel}
                  </small>
                ))}
              </article>
            ))}
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
}: {
  title: string;
  side: string;
  items: FitItem[];
}) {
  return (
    <div className={`slot-rack ${side}`}>
      <span>{title}</span>
      <div>
        {items.length ? (
          items.map((item, index) => (
            <ItemIcon item={item} key={`${item.name}-${index}`} />
          ))
        ) : (
          <small>No modules</small>
        )}
      </div>
    </div>
  );
}
function ItemIcon({ item }: { item: FitItem }) {
  return (
    <div
      className="fit-item"
      title={`${item.name}${item.charge ? `, ${item.charge}` : ""}`}
    >
      {item.typeId ? <img src={imageUrl(item.typeId, "icon", 64)} /> : <b>?</b>}
      {item.quantity > 1 && <em>{item.quantity}</em>}
      <span>{item.name}</span>
    </div>
  );
}
function ItemBay({ title, items }: { title: string; items: FitItem[] }) {
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
            </span>
          </div>
        ))
      ) : (
        <p>Empty</p>
      )}
    </div>
  );
}
