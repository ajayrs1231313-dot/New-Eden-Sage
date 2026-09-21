import { useEffect, useMemo, useState } from "react";

type Blueprint = { item_id?: number; type_id?: number; material_efficiency?: number; time_efficiency?: number; runs?: number; scope: "personal" | "corporation" };
type ManualBlueprint = { blueprintTypeId: number; blueprintName: string; productTypeId: number; productName: string; productPerRun: number };
type OwnerType = "member" | "division" | "project";
type FoundryWorkbenchTab = "requirements" | "assignments" | "stores" | "dependencies" | "production";
const memberNameCache = new Map<number, string>();

const n = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
const pc = (value: number) => `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function IndustrialProjectFoundry({ characterId, snapshotUpdatedAt, blueprints, typeNames }: { characterId: string; corporationName: string; snapshotUpdatedAt?: string; blueprints: Blueprint[]; typeNames: Record<number, string> }) {
  const [workspace, setWorkspace] = useState<any>(null);
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"solo" | "corporation">("solo");
  const [manual, setManual] = useState(false);
  const [ownedIndex, setOwnedIndex] = useState(0);
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<ManualBlueprint[]>([]);
  const [manualBlueprint, setManualBlueprint] = useState<ManualBlueprint | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [projectQuantity, setProjectQuantity] = useState(1);
  const [me, setMe] = useState(0);
  const [te, setTe] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [message, setMessage] = useState("Loading Project Foundry...");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ownerType, setOwnerType] = useState<OwnerType>("member");
  const [ownerId, setOwnerId] = useState("");
  const [splitQuantity, setSplitQuantity] = useState(1);
  const [groupId, setGroupId] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [memberNames, setMemberNames] = useState<Record<number, string>>({});
  const [fullTree, setFullTree] = useState(false);
  const [filter, setFilter] = useState("");
  const [workbenchTab, setWorkbenchTab] = useState<FoundryWorkbenchTab>("requirements");
  const [showCreate, setShowCreate] = useState(false);
  const [storeTargetId, setStoreTargetId] = useState("__default__");
  const [storeKey, setStoreKey] = useState("personal:owner");
  const [blueprintMenuOpen, setBlueprintMenuOpen] = useState(false);

  const owned = useMemo(() => blueprints.filter((row) => Number(row.type_id ?? 0) > 0), [blueprints]);
  const selectedOwned = owned[ownedIndex] ?? owned[0];
  const project = useMemo(() => (workspace?.projects ?? []).find((row: any) => row.id === projectId) ?? workspace?.projects?.[0] ?? null, [workspace, projectId]);
  const minimumProjectQuantity = Math.max(
    1,
    Math.ceil(Number(project?.producedQuantity ?? 0)),
    (project?.productionLots ?? []).reduce((sum: number, lot: any) => sum + Math.max(0, Number(lot.quantity ?? 0)), 0),
  );
  const members = useMemo(() => (workspace?.directory?.members ?? []).map((row: any) => ({ ...row, displayName: memberNames[Number(row.id)] ?? row.name ?? `Character ${row.id}` })).sort((a: any, b: any) => a.displayName.localeCompare(b.displayName)), [workspace?.directory?.members, memberNames]);
  const divisions = workspace?.directory?.divisions ?? [];

  async function load(selectId?: string) {
    try {
      const result = await window.sage.getFoundryWorkspace({ characterId, projectId: selectId });
      setWorkspace(result);
      setProjectId(result?.selectedProject?.id ?? result?.projects?.[0]?.id ?? "");
      setMessage(result?.corporationAssetsAvailable ? "Foundry is using the latest synced corporation state." : "Foundry is ready. Corp inventory will populate when corporation asset access is available.");
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project Foundry could not load.");
      return null;
    }
  }

  useEffect(() => { void load(); }, [characterId, snapshotUpdatedAt]);
  useEffect(() => {
    if (!project) return;
    setProjectQuantity(Math.max(minimumProjectQuantity, Math.floor(Number(project.quantity ?? 1))));
  }, [project?.id, project?.quantity, minimumProjectQuantity]);
  useEffect(() => {
    if (!selectedOwned || manual) return;
    setMe(Math.max(0, Math.min(10, Number(selectedOwned.material_efficiency ?? 0))));
    setTe(Math.max(0, Math.min(20, Number(selectedOwned.time_efficiency ?? 0))));
  }, [ownedIndex, selectedOwned?.type_id, manual]);

  useEffect(() => {
    if (!manual || manualQuery.trim().length < 2) { setManualResults([]); return; }
    let dead = false;
    const timer = window.setTimeout(() => void (window.sage as any).searchFoundryBlueprints({ query: manualQuery.trim(), limit: 24 }).then((rows: any[]) => { if (!dead) setManualResults(Array.isArray(rows) ? rows : []); }).catch(() => { if (!dead) setManualResults([]); }), 180);
    return () => { dead = true; window.clearTimeout(timer); };
  }, [manual, manualQuery]);

  useEffect(() => {
    const rows = workspace?.directory?.members ?? [];
    const known: Record<number, string> = {};
    const missing: number[] = [];
    for (const row of rows) {
      const id = Number(row.id);
      const name = String(row.name ?? memberNameCache.get(id) ?? "").trim();
      if (name) { known[id] = name; memberNameCache.set(id, name); } else if (id > 0) missing.push(id);
    }
    setMemberNames((current) => ({ ...current, ...known }));
    if (!missing.length || typeof (window.sage as any).resolveTypeIds !== "function") return;
    let dead = false;
    void (async () => {
      const resolved: any[] = [];
      for (let i = 0; i < missing.length; i += 900) resolved.push(...await (window.sage as any).resolveTypeIds(missing.slice(i, i + 900)));
      if (dead) return;
      const next: Record<number, string> = {};
      for (const row of resolved) { const id = Number(row.id); const name = String(row.name ?? "").trim(); if (id > 0 && name) { memberNameCache.set(id, name); next[id] = name; } }
      setMemberNames((current) => ({ ...current, ...next }));
    })().catch(() => undefined);
    return () => { dead = true; };
  }, [workspace?.directory?.members]);

  useEffect(() => {
    if (ownerType === "member") { if (!members.some((row: any) => String(row.id) === ownerId)) setOwnerId(members[0] ? String(members[0].id) : ""); }
    else if (ownerType === "division") { if (!divisions.some((row: any) => String(row.id) === ownerId)) setOwnerId(divisions[0] ? String(divisions[0].id) : ""); }
    else setOwnerId(characterId);
  }, [ownerType, members.length, divisions.length, characterId]);

  async function createProject() {
    const blueprintTypeId = manual ? Number(manualBlueprint?.blueprintTypeId ?? 0) : Number(selectedOwned?.type_id ?? 0);
    if (!(blueprintTypeId > 0)) { setMessage(manual ? "Choose a blueprint from the SDE search first." : "Choose a synced blueprint first."); return; }
    setBusy(true); setMessage("Expanding the authoritative production hierarchy...");
    try {
      const result = await window.sage.createFoundryProject({ characterId, blueprintTypeId, materialEfficiency: me, timeEfficiency: te, quantity, name: projectName.trim() || undefined, availableRuns: !manual && Number(selectedOwned?.runs ?? -1) >= 0 ? Number(selectedOwned.runs) : undefined, mode, blueprintSource: manual ? "manual" : "owned" });
      setWorkspace(result); setProjectId(result?.selectedProject?.id ?? ""); setProjectName(""); setSelected(new Set()); setShowCreate(false); setWorkbenchTab("requirements");
      setMessage(mode === "solo" ? "Solo project created. No assignment layer is required." : "Corporation project created. Select real build rows below to divide the work.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Project creation failed."); } finally { setBusy(false); }
  }

  async function save(next: any, ok = "Project updated.") {
    setBusy(true);
    try { const result = await window.sage.updateFoundryProject({ characterId, project: next }); setWorkspace(result); setProjectId(result?.selectedProject?.id ?? next.id); setMessage(ok); return result?.selectedProject; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project update failed."); await load(next.id); return null; }
    finally { setBusy(false); }
  }

  async function applyProjectQuantity() {
    if (!project) return;
    const target = Math.max(minimumProjectQuantity, Math.floor(Number(projectQuantity) || 1));
    setProjectQuantity(target);
    if (target === Math.floor(Number(project.quantity ?? 1))) return;
    const updated = await save({ ...project, quantity: target }, `Replanning ${project.productName} output...`);
    if (!updated) return;
    const actual = Math.max(1, Math.floor(Number(updated.quantity ?? target)));
    setProjectQuantity(actual);
    setMessage(`Project now targets ${n(actual)} × ${updated.productName}. Materials, component runs and assignments have been recalculated.`);
  }

  const assignmentsByTarget = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of project?.assignments ?? []) { const list = map.get(row.targetId) ?? []; list.push(row); map.set(row.targetId, list); }
    return map;
  }, [project?.assignments]);
  const tree = (project?.buildTree ?? []).filter((row: any) => Number(row.depth ?? 0) > 0);
  const visibleTree = fullTree ? tree : tree.filter((row: any) => Number(row.depth ?? 0) <= 2);
  useEffect(() => { setStoreTargetId("__default__"); }, [project?.id]);
  const limit = (target: string) => target === "final-assembly" ? Number(project?.quantity ?? 0) : Number((project?.buildTree ?? []).find((row: any) => row.id === target)?.required ?? 0);
  const assigned = (target: string) => (assignmentsByTarget.get(target) ?? []).reduce((sum: number, row: any) => sum + Number(row.quantity ?? 0), 0);
  const remaining = (target: string) => Math.max(0, limit(target) - assigned(target));
  const toggleTarget = (target: string) => { setSelected((current) => { const next = new Set(current); next.has(target) ? next.delete(target) : next.add(target); return next; }); setSplitQuantity(Math.max(1, remaining(target))); };

  function chosenOwner() {
    if (!project) return null;
    if (ownerType === "project") return { ownerType, ownerId: project.createdByCharacterId, ownerName: project.createdByCharacterName };
    if (ownerType === "member") { const row = members.find((x: any) => String(x.id) === ownerId); return row ? { ownerType, ownerId: String(row.id), ownerName: row.displayName } : null; }
    const row = divisions.find((x: any) => String(x.id) === ownerId); return row ? { ownerType, ownerId: String(row.id), ownerName: row.name } : null;
  }

  async function assignSelected() {
    if (!project || !selected.size) { setMessage("Select one or more production rows first."); return; }
    const owner = chosenOwner(); if (!owner) { setMessage("Choose a real member or division first."); return; }
    const targets = [...selected];
    const additions = targets.flatMap((target) => { const open = remaining(target); const qty = targets.length === 1 ? Math.min(open, Math.max(1, Math.floor(splitQuantity))) : open; return qty > 0 ? [{ id: uid("assign"), targetId: target, quantity: qty, ...owner, groupId: groupId || undefined, status: "open" }] : []; });
    if (!additions.length) { setMessage("Those rows are already fully assigned."); return; }
    const groups = (project.groups ?? []).map((row: any) => row.id === groupId ? { ...row, ...owner } : row);
    setSelected(new Set());
    await save({ ...project, groups, assignments: [...(project.assignments ?? []), ...additions] }, `Assigned ${additions.length} build ${additions.length === 1 ? "line" : "lines"} to ${owner.ownerName}.`);
  }

  async function addGroup() {
    if (!project || !newGroup.trim()) return;
    const row = { id: uid("group"), name: newGroup.trim() }; setNewGroup(""); setGroupId(row.id);
    await save({ ...project, groups: [...(project.groups ?? []), row] }, `Created work group ${row.name}.`);
  }

  const stores = [
    { kind: "personal", key: "personal:owner", name: "Project owner personal assets", typeName: "Personal inventory", division: "All synced owner assets" },
    ...(workspace?.stores?.divisions ?? []),
    ...(workspace?.stores?.containers ?? []),
  ];
  const storeRoutes = project?.storeRoutes ?? [];
  const storeByKey = new Map<string, any>(stores.map((row: any) => [row.key, row]));
  const routeByTarget = new Map<string, any>(storeRoutes.map((row: any) => [row.targetId, row]));
  const routableTargets = tree.slice().sort((a: any, b: any) => Number(a.depth ?? 0) - Number(b.depth ?? 0) || String(a.name).localeCompare(String(b.name)));
  const selectedStoreTarget = storeTargetId === "__default__" ? null : routableTargets.find((row: any) => row.id === storeTargetId);
  const activeStoreBindings = storeTargetId === "__default__" ? (project?.linkedStores ?? []) : (routeByTarget.get(storeTargetId)?.stores ?? []);
  const activeStoreKeys = new Set(activeStoreBindings.map((row: any) => row.key));

  async function addStoreBinding() {
    if (!project || !storeKey) return;
    const store = storeByKey.get(storeKey);
    if (!store || activeStoreKeys.has(storeKey)) return;
    const binding = { kind: store.kind, key: store.key, itemId: store.itemId, locationFlag: store.locationFlag, name: store.name };
    if (storeTargetId === "__default__") {
      await save({ ...project, linkedStores: [...(project.linkedStores ?? []), binding] }, `Added ${store.name} to the project default source.`);
      return;
    }
    const nextRoutes = storeRoutes.filter((row: any) => row.targetId !== storeTargetId);
    nextRoutes.push({ targetId: storeTargetId, stores: [...activeStoreBindings, binding] });
    await save({ ...project, storeRoutes: nextRoutes }, `Sage will now look for ${selectedStoreTarget?.name ?? "this build line"} in ${store.name}.`);
  }

  async function removeStoreBinding(targetId: string, key: string) {
    if (!project) return;
    if (targetId === "__default__") {
      await save({ ...project, linkedStores: (project.linkedStores ?? []).filter((row: any) => row.key !== key) }, "Project default source updated.");
      return;
    }
    const nextRoutes = storeRoutes.flatMap((route: any) => {
      if (route.targetId !== targetId) return [route];
      const nextStores = (route.stores ?? []).filter((row: any) => row.key !== key);
      return nextStores.length ? [{ ...route, stores: nextStores }] : [];
    });
    await save({ ...project, storeRoutes: nextRoutes }, "Build-line source updated.");
  }

  const blockers = project?.finalAssembly?.blockers ?? [];
  const openAssignments = project?.mode === "corporation" ? tree.filter((row: any) => remaining(row.id) > 0).length + (remaining("final-assembly") > 0 ? 1 : 0) : 0;
  const requirementRows = project?.requirements ?? [];
  const requirementUnits = requirementRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.required ?? 0)), 0);
  const requirementCoveredUnits = requirementRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.required ?? 0) - Number(row.outstanding ?? 0)), 0);
  const materialProgress = requirementUnits > 0 ? Math.max(0, Math.min(1, requirementCoveredUnits / requirementUnits)) : Number(project?.progress ?? 0);
  const componentRows = tree.filter((row: any) => row.kind === "component");
  const componentUnits = componentRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.required ?? 0)), 0);
  const componentCoveredUnits = componentRows.reduce((sum: number, row: any) => sum + Math.max(0, Math.min(Number(row.required ?? 0), Number(row.availableToProject ?? 0))), 0);
  const manufacturingProgress = componentUnits > 0 ? Math.max(0, Math.min(1, componentCoveredUnits / componentUnits)) : materialProgress;
  const finalReady = Boolean(project?.finalAssembly?.ready);
  const deliveryComplete = String(project?.status ?? "").toLowerCase() === "complete";
  const pipelineStages: Array<{ label: string; detail: string; progress: number; badge: string; state: string; current: boolean; target: FoundryWorkbenchTab }> = project ? [
    { label: "Materials", detail: materialProgress >= .999999 ? "Inputs covered" : "Collect required materials", progress: materialProgress, badge: pc(materialProgress), state: materialProgress >= .999999 ? "complete" : "active", current: materialProgress < .999999, target: "requirements" },
    { label: "Research", detail: project.materialEfficiency > 0 || project.timeEfficiency > 0 ? `ME ${project.materialEfficiency} / TE ${project.timeEfficiency} in calculations` : "No blueprint research", progress: project.materialEfficiency > 0 || project.timeEfficiency > 0 ? 1 : 0, badge: project.materialEfficiency > 0 || project.timeEfficiency > 0 ? "APPLIED" : "OPTIONAL", state: "optional", current: false, target: "requirements" },
    { label: "Manufacturing", detail: manufacturingProgress >= .999999 ? "Component chain covered" : "Build subcomponents", progress: manufacturingProgress, badge: pc(manufacturingProgress), state: manufacturingProgress >= .999999 ? "complete" : materialProgress >= .999999 ? "active" : "blocked", current: materialProgress >= .999999 && manufacturingProgress < .999999, target: "dependencies" },
    { label: "Final Assembly", detail: finalReady ? "Dependencies satisfied" : `${project.finalAssembly?.blockerCount ?? 0} blocker(s)`, progress: finalReady ? 1 : 0, badge: finalReady ? "READY" : "BLOCKED", state: finalReady ? "complete" : manufacturingProgress >= .999999 ? "active" : "blocked", current: manufacturingProgress >= .999999 && !finalReady, target: "dependencies" },
    { label: "Delivery", detail: deliveryComplete ? "Project complete" : "Awaiting finished output", progress: deliveryComplete ? 1 : 0, badge: deliveryComplete ? "DONE" : "PENDING", state: deliveryComplete ? "complete" : finalReady ? "active" : "blocked", current: finalReady && !deliveryComplete, target: "production" },
  ] : [];
  const productTypeId = Number(project?.productTypeId ?? project?.product_type_id ?? 0);
  const allocationOwnerMap = new Map<string, { key: string; name: string; count: number; quantity: number }>();
  for (const row of project?.assignments ?? []) {
    const key = `${row.ownerType}:${row.ownerId}`;
    const current = allocationOwnerMap.get(key) ?? { key, name: String(row.ownerName ?? row.ownerId ?? "Unassigned"), count: 0, quantity: 0 };
    current.count += 1;
    current.quantity += Math.max(0, Number(row.quantity ?? 0));
    allocationOwnerMap.set(key, current);
  }
  const allocationOwners = [...allocationOwnerMap.values()].sort((a, b) => b.count - a.count || b.quantity - a.quantity);
  const draftBlueprintReady = manual ? Boolean(manualBlueprint) : Boolean(selectedOwned);
  const draftBlueprintName = manual
    ? (manualBlueprint?.blueprintName ?? "Choose an SDE blueprint")
    : selectedOwned
      ? (typeNames[Number(selectedOwned.type_id)] ?? `Type ${selectedOwned.type_id}`)
      : "No synced blueprint available";
  const draftProductName = manual
    ? (manualBlueprint?.productName ?? draftBlueprintName.replace(/ Blueprint$/i, ""))
    : draftBlueprintName.replace(/ Blueprint$/i, "");
  const draftSourceLabel = manual
    ? "Manual SDE blueprint"
    : selectedOwned?.scope === "corporation"
      ? "Corporation blueprint"
      : "Personal blueprint";
  const draftStockLabel = mode === "solo"
    ? "Owner synced assets"
    : workspace?.corporationAssetsAvailable
      ? "Corporation assets visible"
      : "Project stores link after creation";

  function openWorkbench(tab: FoundryWorkbenchTab, options?: { fullTree?: boolean }) {
    if (options?.fullTree) setFullTree(true);
    setWorkbenchTab(tab);
    window.requestAnimationFrame(() => {
      document.getElementById("foundry-workbench")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return <div className="industrial-foundry-workspace foundry-command-dashboard">
    <section className="foundry-commandbar" aria-label="Project Foundry command bar">
      <div className="foundry-commandbar-title">
        <span className="foundry-commandbar-icon">PF</span>
        <div><small>INDUSTRIAL / PROJECT FOUNDRY</small><strong>Project Foundry</strong><em>Plan. Assemble. Deliver.</em></div>
      </div>
      <label className="foundry-project-picker">
        <span>PROJECT</span>
        <select value={project?.id ?? ""} onChange={(event) => { setProjectId(event.target.value); setSelected(new Set()); setWorkbenchTab("requirements"); setShowCreate(false); }}>
          {(workspace?.projects ?? []).map((row: any) => <option key={row.id} value={row.id}>{row.name} · {row.quantity} × {row.productName}</option>)}
          {!(workspace?.projects ?? []).length && <option value="">No projects yet</option>}
        </select>
      </label>
      {project && <div className="foundry-project-quantity" aria-label="Project build quantity">
        <span>BUILD QTY</span>
        <div>
          <button type="button" aria-label="Decrease build quantity" disabled={busy || projectQuantity <= minimumProjectQuantity} onClick={() => setProjectQuantity((value) => Math.max(minimumProjectQuantity, Math.floor(Number(value) || 1) - 1))}>−</button>
          <input type="number" min={minimumProjectQuantity} step="1" value={projectQuantity} onChange={(event) => setProjectQuantity(Math.max(minimumProjectQuantity, Math.floor(Number(event.target.value) || 1)))} />
          <button type="button" aria-label="Increase build quantity" disabled={busy} onClick={() => setProjectQuantity((value) => Math.max(minimumProjectQuantity, Math.floor(Number(value) || 1) + 1))}>+</button>
          <button type="button" className="apply" disabled={busy || projectQuantity === Math.floor(Number(project.quantity ?? 1))} onClick={() => void applyProjectQuantity()}>Apply</button>
        </div>
        <small>{n(project.quantity)} finished unit{Number(project.quantity) === 1 ? "" : "s"} planned</small>
      </div>}
      <div className="foundry-command-actions">
        <button type="button" className="primary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Close Creator" : "+ New Project"}</button>
        {project && <button type="button" onClick={() => void save({ ...project, status: project.status === "archived" ? "planning" : "archived" }, project.status === "archived" ? "Project restored to planning." : "Project archived.")}>{project.status === "archived" ? "Restore" : "Archive"}</button>}
        {project && <button type="button" className="danger" onClick={async () => { if (!window.confirm(`Delete ${project.name}?`)) return; const result = await window.sage.deleteFoundryProject({ characterId, projectId: project.id }); setWorkspace(result); setProjectId(result?.selectedProject?.id ?? ""); setSelected(new Set()); }}>Delete</button>}
      </div>
      <div className="foundry-command-sync"><span className="live-dot" /> <strong>Live Foundry</strong><small>{workspace?.snapshotUpdatedAt ? new Date(workspace.snapshotUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Local state"}</small></div>
    </section>

    {(showCreate || !project) && <article className="industrial-panel foundry-create foundry-create-compact">
      <div className="industrial-panel-head"><div><p className="eyebrow">NEW PROJECT</p><h3>Build first. Divide second.</h3><p>Sage expands the real production tree before you organise it. Solo builds stay simple; corporation builds can be split across actual members, divisions and quantities.</p></div><span className="industrial-status live">SDE + LIVE STATE</span></div>
      <div className="foundry-creator-grid">
        <div className="foundry-mode-switch"><button className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}><strong>Solo project</strong><small>No assignment overhead</small></button><button className={mode === "corporation" ? "active" : ""} onClick={() => setMode("corporation")}><strong>Corporation project</strong><small>Split exact build stages</small></button></div>
        <label className="foundry-manual-toggle"><input type="checkbox" checked={manual} onChange={(event) => { setManual(event.target.checked); setBlueprintMenuOpen(false); setManualBlueprint(null); if (event.target.checked) { setMe(0); setTe(0); } }} /><span><strong>Manual blueprint override</strong><small>Plan any SDE blueprint even when you do not own it.</small></span></label>
        <div className="foundry-create-grid">
          {!manual ? <div className="foundry-blueprint-field wide"><span>Synced blueprint</span><div className={`foundry-blueprint-picker ${blueprintMenuOpen ? "open" : ""}`}><button type="button" className="foundry-blueprint-trigger" aria-haspopup="listbox" aria-expanded={blueprintMenuOpen} onClick={() => setBlueprintMenuOpen((value) => !value)} disabled={!owned.length}><span><strong>{selectedOwned ? `${selectedOwned.scope === "corporation" ? "CORP" : "PERSONAL"} · ${typeNames[Number(selectedOwned.type_id)] ?? `Type ${selectedOwned.type_id}`}` : "No synced blueprints available"}</strong>{selectedOwned && <small>ME {selectedOwned.material_efficiency ?? 0} / TE {selectedOwned.time_efficiency ?? 0}</small>}</span><i aria-hidden="true" /></button>{blueprintMenuOpen && owned.length > 0 && <div className="foundry-blueprint-menu" role="listbox" aria-label="Synced blueprint">{owned.map((row, index) => <button type="button" role="option" aria-selected={index === ownedIndex} className={index === ownedIndex ? "active" : ""} key={`${row.scope}-${row.item_id ?? index}`} onClick={() => { setOwnedIndex(index); setBlueprintMenuOpen(false); }}><span><strong>{typeNames[Number(row.type_id)] ?? `Type ${row.type_id}`}</strong><small>{row.scope === "corporation" ? "CORPORATION" : "PERSONAL"} · ME {row.material_efficiency ?? 0} / TE {row.time_efficiency ?? 0}</small></span>{index === ownedIndex && <b>SELECTED</b>}</button>)}</div>}</div></div> : <div className="foundry-manual-search wide"><label><span>CCP SDE blueprint search</span><input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder="Search Orca, capital component..." /></label>{manualQuery.trim().length >= 2 && <div className="foundry-search-results">{manualResults.slice(0, 8).map((row) => <button key={row.blueprintTypeId} className={manualBlueprint?.blueprintTypeId === row.blueprintTypeId ? "active" : ""} onClick={() => setManualBlueprint(row)}><span><strong>{row.productName}</strong><small>{row.blueprintName}</small></span><b>{row.productPerRun}/run</b></button>)}</div>}{manualBlueprint && <small className="foundry-picked">MANUAL · {manualBlueprint.productName} · {manualBlueprint.blueprintName}</small>}</div>}
          <label><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} /></label><label><span>ME</span><input type="number" min="0" max="10" value={me} onChange={(e) => setMe(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} /></label><label><span>TE</span><input type="number" min="0" max="20" value={te} onChange={(e) => setTe(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} /></label><label className="wide"><span>Project name</span><input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Optional" /></label><button className="foundry-primary" disabled={busy || (manual ? !manualBlueprint : !owned.length)} onClick={() => void createProject()}>{busy ? "Working..." : "Create project"}</button>
        </div>
      </div>
      <div className="industrial-notice">{message}</div>
    </article>}

    {project && <>
      <section className="foundry-summary-strip">
        <div className="foundry-progress-orb"><strong>{pc(project.progress)}</strong><span>BUILD PROGRESS</span></div>
        <div><small>CURRENT STAGE</small><strong>{project.finalAssembly?.ready ? "Final Assembly" : project.progress > 0 ? "Manufacturing" : "Materials"}</strong><span>{project.finalAssembly?.ready ? "Dependencies fulfilled" : `${n(project.missingUnits)} dependency units missing`}</span></div>
        <div className={project.finalAssembly?.blockerCount ? "warn" : "good"}><small>BLOCKERS</small><strong>{n(project.finalAssembly?.blockerCount ?? 0)}</strong><span>{project.finalAssembly?.ready ? "Clear for assembly" : "Missing materials / components"}</span></div>
        <div><small>ASSIGNED TO</small><strong>{project.mode === "solo" ? "1 owner" : `${new Set((project.assignments ?? []).map((row: any) => `${row.ownerType}:${row.ownerId}`)).size} owner(s)`}</strong><span>{project.mode === "solo" ? project.createdByCharacterName : `${project.assignments?.length ?? 0} assignment splits`}</span></div>
        <div><small>BLUEPRINT</small><strong>ME {project.materialEfficiency} / TE {project.timeEfficiency}</strong><span>{project.blueprintSource === "manual" ? "Manual SDE blueprint" : "Synced blueprint"}</span></div>
        <div><small>DELIVER TARGET</small><strong>{n(project.quantity)} units</strong><span>{String(project.status ?? "planning").toUpperCase()}</span></div>
      </section>

      <div className="foundry-dashboard-grid">
        <div className="foundry-dashboard-main">
          <article className="industrial-panel foundry-pipeline-panel">
            <div className="foundry-section-head"><div><small>BUILD PIPELINE</small><strong>Project stages and dependencies</strong></div><button type="button" onClick={() => openWorkbench("dependencies")}>View Dependencies</button></div>
            <div className="foundry-pipeline">
              {pipelineStages.map((stage, index) => <button type="button" key={stage.label} className={`${stage.state} ${stage.current ? "current" : ""}`} onClick={() => openWorkbench(stage.target)}>
                <span className="stage-number">{index + 1}</span><span className="stage-copy"><strong>{stage.label}</strong><small>{stage.detail}</small></span><span className="stage-meter"><i style={{ width: `${Math.round(stage.progress * 100)}%` }} /></span><b>{stage.badge}</b>
              </button>)}
            </div>
            <div className="foundry-product-focus">
              {productTypeId > 0 ? <img src={`https://images.evetech.net/types/${productTypeId}/render?size=128`} alt="" /> : <div className="foundry-product-placeholder">PF</div>}
              <div className="foundry-product-copy"><small>PROJECT OUTPUT</small><h3>{project.productName}</h3><p>{project.blueprintName}</p><div><span><b>{n(project.quantity)}</b><small>target units</small></span><span><b>{n(project.totalDeliveredUnits)}</b><small>dependency units ready</small></span><span><b>{n(project.missingUnits)}</b><small>units missing</small></span></div></div>
              <div className="foundry-product-status"><span className={project.finalAssembly?.ready ? "ready" : "blocked"}>{project.finalAssembly?.ready ? "ASSEMBLY READY" : "UPSTREAM BLOCKED"}</span><small>{project.finalAssembly?.ready ? "All direct inputs are physically available to this project." : blockers.slice(0, 3).map((row: any) => `${row.name} ${n(row.outstanding)}`).join(" · ")}</small></div>
            </div>
          </article>

          <article className="industrial-panel foundry-stage-focus">
            <div className="foundry-section-head"><div><small>ACTIVE BUILD LINES</small><strong>{project.productName} production hierarchy</strong></div><button type="button" onClick={() => openWorkbench("dependencies", { fullTree: true })}>Full Chain</button></div>
            <div className="foundry-compact-tree">
              <div className="heading"><span>Stage / requirement</span><span>Required</span><span>Available</span><span>Missing</span><span>Responsibility</span><span>State</span></div>
              {tree.slice(0, 7).map((row: any) => { const rows = assignmentsByTarget.get(row.id) ?? []; const open = remaining(row.id); const state = row.coverage >= .999999 ? "DELIVERED" : rows.some((x: any) => x.status === "in-progress") ? "IN PRODUCTION" : rows.length ? "ASSIGNED" : "UNASSIGNED"; return <div className={`row ${row.outstanding <= 0 ? "covered" : ""} ${selected.has(row.id) ? "selected" : ""}`} key={row.id}><span className="tree-name">{project.mode === "corporation" && <input type="checkbox" checked={selected.has(row.id)} disabled={open <= 0} onChange={() => toggleTarget(row.id)} />}<span><strong>{row.name}</strong><small>{row.kind === "component" ? `COMPONENT · ${row.runs ?? "?"} runs` : row.direct ? "DIRECT INPUT" : "MATERIAL INPUT"}</small></span></span><span>{n(row.required)}</span><span>{n(row.availableToProject)}</span><span className="missing">{n(row.outstanding)}</span><span className="who">{rows.length ? rows.map((x: any) => `${x.ownerName}: ${n(x.quantity)}`).join(" · ") : project.mode === "solo" ? project.createdByCharacterName : "Unassigned"}</span><span><b className={`state ${state.toLowerCase().replace(/\s/g, "-")}`}>{state}</b></span></div>; })}
              {!tree.length && <div className="foundry-empty-row">No expanded dependency rows are available for this project.</div>}
            </div>
          </article>
        </div>

        <aside className="foundry-dashboard-rail">
          <article className="industrial-panel foundry-rail-panel">
            <div className="foundry-section-head"><div><small>WORK ALLOCATION</small><strong>{project.mode === "solo" ? "Project owner" : "Assigned work"}</strong></div>{project.mode === "corporation" && <button type="button" onClick={() => setWorkbenchTab("assignments")}>Manage</button>}</div>
            <div className="foundry-allocation-summary">
              {project.mode === "solo" ? <div className="allocation-person"><span className="avatar-fallback">{project.createdByCharacterName?.slice(0, 1) ?? "?"}</span><span><strong>{project.createdByCharacterName}</strong><small>Owner · entire build</small></span><b>{pc(project.progress)}</b></div> : allocationOwners.slice(0, 4).map((row) => <div className="allocation-person" key={row.key}><span className="avatar-fallback">{row.name.slice(0, 1)}</span><span><strong>{row.name}</strong><small>{row.count} task{row.count === 1 ? "" : "s"}</small></span><b>{n(row.quantity)}</b></div>)}
              {project.mode === "corporation" && !allocationOwners.length && <div className="foundry-rail-empty">No work has been assigned yet.</div>}
            </div>
          </article>

          <article className="industrial-panel foundry-rail-panel foundry-groups-rail">
            <div className="foundry-section-head"><div><small>WORK GROUPS</small><strong>Organise labour</strong></div><span>{(project.groups ?? []).length}</span></div>
            {project.mode === "corporation" ? <>
              <div className="group-create compact"><input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New work group" onKeyDown={(e) => { if (e.key === "Enter") void addGroup(); }} /><button onClick={() => void addGroup()}>+</button></div>
              <div className="foundry-rail-group-list">{(project.groups ?? []).slice(0, 5).map((row: any) => <div className={groupId === row.id ? "active" : ""} key={row.id}><button type="button" onClick={() => setGroupId(row.id)}><strong>{row.name}</strong><small>{row.ownerName ?? "Owner set on assignment"}</small></button><button type="button" className="remove" onClick={() => void save({ ...project, groups: project.groups.filter((x: any) => x.id !== row.id), assignments: project.assignments.map((x: any) => x.groupId === row.id ? { ...x, groupId: undefined } : x) }, "Work group removed; assignments kept.")}>×</button></div>)}</div>
              {!(project.groups ?? []).length && <div className="foundry-rail-empty">Groups are optional. Add them when the build needs teams.</div>}
            </> : <div className="foundry-rail-empty">Solo projects do not need work groups.</div>}
          </article>

          <article className="industrial-panel foundry-rail-panel foundry-project-info">
            <div className="foundry-section-head"><div><small>PROJECT INFORMATION</small><strong>Live project metadata</strong></div></div>
            <dl><div><dt>Project Name</dt><dd>{project.name}</dd></div><div><dt>Product</dt><dd>{project.productName}</dd></div><div><dt>Quantity</dt><dd>{n(project.quantity)}</dd></div><div><dt>Blueprint</dt><dd>{project.blueprintName}</dd></div><div><dt>Mode</dt><dd>{project.mode === "solo" ? "Solo" : "Corporation"}</dd></div><div><dt>Status</dt><dd><select value={project.status} onChange={(e) => void save({ ...project, status: e.target.value }, `Status changed to ${e.target.value}.`)}><option value="planning">Planning</option><option value="active">Active</option><option value="complete">Complete</option><option value="archived">Archived</option></select></dd></div><div><dt>Owner</dt><dd>{project.createdByCharacterName}</dd></div><div><dt>Source</dt><dd>{project.blueprintSource === "manual" ? "Manual SDE" : "Synced blueprint"}</dd></div></dl>
            <div className="foundry-mode-inline"><b>MODE</b><button className={project.mode === "solo" ? "active" : ""} onClick={() => void save({ ...project, mode: "solo" }, "Switched to solo planning.")}>Solo</button><button className={project.mode === "corporation" ? "active" : ""} onClick={() => void save({ ...project, mode: "corporation" }, "Switched to corporation planning.")}>Corporation</button></div>
          </article>
        </aside>
      </div>

      <section id="foundry-workbench" className="foundry-workbench">
        <nav className="foundry-workbench-tabs" aria-label="Project Foundry workbench">
          <button type="button" className={workbenchTab === "requirements" ? "active" : ""} onClick={() => setWorkbenchTab("requirements")}>Requirements</button>
          {project.mode === "corporation" && <button type="button" className={workbenchTab === "assignments" ? "active" : ""} onClick={() => setWorkbenchTab("assignments")}>Assignments <span>{project.assignments?.length ?? 0}</span></button>}
          <button type="button" className={workbenchTab === "stores" ? "active" : ""} onClick={() => setWorkbenchTab("stores")}>Project Stores</button>
          <button type="button" className={workbenchTab === "dependencies" ? "active" : ""} onClick={() => setWorkbenchTab("dependencies")}>Dependencies <span>{tree.length}</span></button>
          <button type="button" className={workbenchTab === "production" ? "active" : ""} onClick={() => setWorkbenchTab("production")}>Production Lots <span>{project.productionLots?.length ?? 0}</span></button>
        </nav>

        {workbenchTab === "requirements" && <article className="industrial-panel foundry-ledger foundry-workbench-panel"><div className="industrial-panel-head"><div><p className="eyebrow">MATERIAL REQUIREMENTS</p><h3>Required vs available</h3><p>Direct inputs that determine whether final assembly can start.</p></div><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter materials..." /></div><div className="ledger"><div className="ledger-row heading"><span>Requirement</span><span>Required</span><span>Available</span><span>Reserved</span><span>Missing</span><span>Coverage</span></div>{(project.requirements ?? []).filter((row: any) => !filter.trim() || row.name.toLowerCase().includes(filter.toLowerCase())).map((row: any) => <div className={`ledger-row ${row.outstanding <= 0 ? "covered" : ""}`} key={row.typeId}><strong>{row.name}</strong><span>{n(row.required)}</span><span>{n(row.availableToProject)}</span><span>{n(row.reservedByOtherProjects)}</span><span className="missing">{n(row.outstanding)}</span><span><b>{pc(row.coverage)}</b></span></div>)}</div><small className="industrial-plan-scope">{workspace?.source}. Snapshot {workspace?.snapshotUpdatedAt ? new Date(workspace.snapshotUpdatedAt).toLocaleString() : "unavailable"}.</small></article>}

        {workbenchTab === "assignments" && project.mode === "corporation" && <article className="industrial-panel foundry-assign foundry-workbench-panel"><div className="industrial-panel-head"><div><p className="eyebrow">ASSIGN SELECTED WORK</p><h3>Who is doing what?</h3><p>Tick rows in Active Build Lines or Dependencies, choose a real owner, then assign.</p></div><span className="industrial-status">{selected.size} SELECTED</span></div><div className={`foundry-selection-summary ${selected.size ? "has-selection" : ""}`}><span><small>WORK SELECTED</small><strong>{selected.size ? `${selected.size} build ${selected.size === 1 ? "stage" : "stages"}` : "Choose stages in the build tree"}</strong></span><em>{selected.size === 1 ? `${n(remaining([...selected][0]))} units still open` : selected.size > 1 ? "Each stage assigns its remaining quantity" : "Checkboxes appear beside every assignable stage"}</em></div><div className="foundry-assign-controls"><div className="foundry-owner-type"><span>ASSIGN TO</span><div><button type="button" className={ownerType === "member" ? "active" : ""} onClick={() => setOwnerType("member")}><b>Member</b><small>Named pilot</small></button><button type="button" className={ownerType === "division" ? "active" : ""} onClick={() => setOwnerType("division")}><b>Division</b><small>Whole corp team</small></button><button type="button" className={ownerType === "project" ? "active" : ""} onClick={() => setOwnerType("project")}><b>Owner</b><small>Project creator</small></button></div></div>{ownerType === "member" && <label><span>Member</span><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{members.map((row: any) => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>}{ownerType === "division" && <label><span>Division</span><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{divisions.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}{ownerType === "project" && <div className="owner-fixed"><span>PROJECT OWNER</span><strong>{project.createdByCharacterName}</strong></div>}<label><span>Group</span><select value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">No group</option>{(project.groups ?? []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{selected.size === 1 && <label><span>Quantity</span><input type="number" min="1" max={Math.max(1, remaining([...selected][0]))} value={splitQuantity} onChange={(e) => setSplitQuantity(Math.max(1, Number(e.target.value) || 1))} /></label>}<button className="foundry-primary" disabled={!selected.size || busy || (ownerType !== "project" && !ownerId)} onClick={() => void assignSelected()}>Assign selected</button></div>{ownerType === "member" && !members.length && <div className="industrial-notice">No member roster is available in this snapshot.</div>}{ownerType === "division" && !divisions.length && <div className="industrial-notice">No configured corporation divisions are available yet.</div>}<div className="foundry-assignment-list">{(project.assignments ?? []).map((row: any) => <div className="assignment-row" key={row.id}><span><strong>{row.ownerName}</strong><small>{row.ownerType}{row.groupName ? ` · ${row.groupName}` : ""}</small></span><span><strong>{row.targetName}</strong><small>{n(row.quantity)} assigned · {n(row.deliveredQuantity)} delivered</small></span><b className={`state ${row.dataState}`}>{String(row.dataState).replace("-", " ").toUpperCase()}</b>{row.dataState !== "delivered" && <button className="foundry-small" onClick={() => void save({ ...project, assignments: project.assignments.map((x: any) => x.id === row.id ? { ...x, status: x.status === "in-progress" ? "open" : "in-progress" } : x) }, "Work state updated; completion remains stock-driven.")}>{row.status === "in-progress" ? "Started ✓" : "Start"}</button>}<button className="remove" onClick={() => void save({ ...project, assignments: project.assignments.filter((x: any) => x.id !== row.id) }, "Assignment removed.")}>×</button></div>)}</div></article>}

        {workbenchTab === "stores" && <article className="industrial-panel foundry-stores foundry-workbench-panel">
          <div className="industrial-panel-head"><div><p className="eyebrow">PROJECT STORES</p><h3>Source routing</h3><p>Tell Sage exactly where each part of the build should come from. A build-line route overrides the project default source.</p></div><span className="industrial-status live">{storeRoutes.length} OVERRIDE{storeRoutes.length === 1 ? "" : "S"}</span></div>
          <div className="foundry-store-router">
            <label><span>Build part</span><select value={storeTargetId} onChange={(e) => setStoreTargetId(e.target.value)}><option value="__default__">Project default / all unassigned parts</option>{routableTargets.map((row: any) => <option key={row.id} value={row.id}>{`${"—".repeat(Math.max(0, Number(row.depth ?? 1) - 1))} ${row.name} · ${n(row.required)} required`}</option>)}</select></label>
            <label><span>Look for it in</span><select value={storeKey} onChange={(e) => setStoreKey(e.target.value)}>{stores.map((row: any) => <option key={row.key} value={row.key}>{row.name}{row.kind === "container" ? ` · ${row.division ?? "Corp assets"}` : row.kind === "division" ? " · Corp hangar" : ""}</option>)}</select></label>
            <button type="button" className="foundry-primary" disabled={busy || !storeKey || activeStoreKeys.has(storeKey)} onClick={() => void addStoreBinding()}>{activeStoreKeys.has(storeKey) ? "Already routed" : "Add source"}</button>
          </div>
          <div className="foundry-store-route-summary">
            <span><small>EDITING</small><strong>{storeTargetId === "__default__" ? "Project default source" : selectedStoreTarget?.name ?? "Build line"}</strong></span>
            <em>{storeTargetId === "__default__" ? (project.mode === "solo" && !(project.linkedStores ?? []).length ? "Fallback: project owner personal assets" : "Used by every build line without its own override") : activeStoreBindings.length ? "This build line uses only the sources listed below" : "No override yet — Sage falls back to the project default"}</em>
          </div>
          <div className="foundry-store-route-list">
            <div className="foundry-store-route-heading"><span>Build part</span><span>Source</span><span>Scope</span><span></span></div>
            {(project.linkedStores ?? []).map((binding: any) => <div className="foundry-store-route-row" key={`default:${binding.key}`}><span><strong>Project default</strong><small>Fallback for unrouted build lines</small></span><span><strong>{binding.name}</strong><small>{binding.kind === "personal" ? "Owner personal assets" : binding.kind === "division" ? binding.locationFlag : "Named container + nested stock"}</small></span><b>DEFAULT</b><button type="button" className="remove" onClick={() => void removeStoreBinding("__default__", binding.key)}>×</button></div>)}
            {storeRoutes.flatMap((route: any) => { const target = routableTargets.find((row: any) => row.id === route.targetId); return (route.stores ?? []).map((binding: any) => <div className="foundry-store-route-row routed" key={`${route.targetId}:${binding.key}`}><span><strong>{target?.name ?? "Unknown build line"}</strong><small>{target ? `${target.kind === "component" ? "Component" : "Material"} · ${n(target.required)} required` : route.targetId}</small></span><span><strong>{binding.name}</strong><small>{binding.kind === "personal" ? "Owner personal assets" : binding.kind === "division" ? binding.locationFlag : "Named container + nested stock"}</small></span><b>OVERRIDE</b><button type="button" className="remove" onClick={() => void removeStoreBinding(route.targetId, binding.key)}>×</button></div>); })}
            {!(project.linkedStores ?? []).length && !storeRoutes.length && <div className="foundry-store-empty"><strong>No custom routes yet.</strong><span>{project.mode === "solo" ? "Sage currently checks all synced personal assets. Add a project default or a build-part override to narrow or redirect the source." : "Choose a build part and a corporation hangar/container above. Until a source is configured, corporation stock does not count toward the project."}</span></div>}
          </div>
          <div className="industrial-notice">Example: route <b>Capital Construction Parts</b> to <b>Corp Hangar A</b>, minerals to a named mineral container, and leave everything else on the project default. Sage evaluates each dependency against its routed source independently.</div>
        </article>}

        {workbenchTab === "dependencies" && <article className="industrial-panel foundry-tree-panel foundry-workbench-panel"><div className="industrial-panel-head"><div><p className="eyebrow">PRODUCTION HIERARCHY</p><h3>{project.productName} build tree</h3><p>Actual SDE build stages. Assign the work itself, not a generic database bucket.</p></div><button className="foundry-small" onClick={() => setFullTree((v) => !v)}>{fullTree ? "Core stages" : "Full chain"}</button></div><div className="foundry-root"><span><b>FINAL PRODUCT</b><strong>{project.quantity} × {project.productName}</strong><small>{project.blueprintName}</small></span><em className={project.finalAssembly?.ready ? "ready" : ""}>{project.finalAssembly?.ready ? "ASSEMBLY READY" : "UPSTREAM BLOCKED"}</em></div><div className="foundry-tree"><div className="foundry-tree-row heading"><span>Stage / requirement</span><span>Required</span><span>Available</span><span>Missing</span><span>Responsibility</span><span>State</span></div>{visibleTree.map((row: any) => { const rows = assignmentsByTarget.get(row.id) ?? []; const open = remaining(row.id); const state = row.coverage >= .999999 ? "DELIVERED" : rows.some((x: any) => x.status === "in-progress") ? "IN PRODUCTION" : rows.length ? "ASSIGNED" : "UNASSIGNED"; return <div className={`foundry-tree-row depth-${Math.min(4, Number(row.depth ?? 0))} kind-${row.kind} ${row.outstanding <= 0 ? "covered" : ""} ${selected.has(row.id) ? "selected" : ""}`} key={row.id}><span className="tree-name" style={{ paddingLeft: `${Math.max(0, row.depth - 1) * 15}px` }}>{project.mode === "corporation" && <input type="checkbox" checked={selected.has(row.id)} disabled={open <= 0} onChange={() => toggleTarget(row.id)} />}<span><strong>{row.name}</strong><small>{row.kind === "component" ? `COMPONENT · ${row.runs ?? "?"} runs` : row.direct ? "DIRECT INPUT" : "MATERIAL INPUT"}</small></span></span><span>{n(row.required)}</span><span>{n(row.availableToProject)}</span><span className="missing">{n(row.outstanding)}</span><span className="who">{rows.length ? rows.map((x: any) => `${x.ownerName}: ${n(x.quantity)}`).join(" · ") : project.mode === "solo" ? project.createdByCharacterName : "Unassigned"}{rows.length && open > 0 ? ` · ${n(open)} open` : ""}</span><span><b className={`state ${state.toLowerCase().replace(/\s/g, "-")}`}>{state}</b></span></div>; })}</div><div className={`foundry-final ${project.finalAssembly?.ready ? "ready" : ""}`}><span className="tree-name">{project.mode === "corporation" && <input type="checkbox" checked={selected.has("final-assembly")} disabled={remaining("final-assembly") <= 0} onChange={() => toggleTarget("final-assembly")} />}<span><strong>Final Assembly</strong><small>{project.finalAssembly?.ready ? "Dependencies satisfied" : `${project.finalAssembly?.blockerCount} blockers`}</small></span></span><b>{project.finalAssembly?.ready ? "READY TO BUILD" : "BLOCKED"}</b><span>{(assignmentsByTarget.get("final-assembly") ?? []).map((x: any) => `${x.ownerName}: ${n(x.quantity)}`).join(" · ") || (project.mode === "solo" ? project.createdByCharacterName : "Unassigned")}</span></div></article>}

        {workbenchTab === "production" && <article className="industrial-panel foundry-production-lots foundry-workbench-panel"><div className="industrial-panel-head"><div><p className="eyebrow">PRODUCTION LOTS</p><h3>Traceable output</h3><p>Every completed manufacturing run keeps a stable Sage identifier through Foundry and Wallet Ledger reconciliation.</p></div><span className="industrial-status live">{(project.productionLots ?? []).length} LOT{(project.productionLots ?? []).length === 1 ? "" : "S"}</span></div>{(project.productionLots ?? []).length ? <div className="foundry-lot-list"><div className="foundry-lot-row heading"><span>Production ID</span><span>Produced</span><span>Output</span><span>Sold</span><span>Remaining</span><span>Ledger</span></div>{(project.productionLots ?? []).map((lot: any) => <div className="foundry-lot-row" key={lot.id}><span className="foundry-lot-id"><strong>{lot.id}</strong><small>EVE job {lot.industryJobId}</small></span><span>{new Date(lot.producedAt).toLocaleString()}</span><span>{n(lot.quantity)}</span><span>{n(lot.soldQuantity)}</span><span>{n(lot.remainingQuantity)}</span><b className={`state ${lot.reconciliationStatus}`}>{String(lot.reconciliationStatus).toUpperCase()}</b></div>)}</div> : <div className="industrial-notice">No production lots have been recorded for this project yet.</div>}</article>}
      </section>

      <div className="foundry-status-line">{message}</div>
    </>}

    {!project && workspace && !showCreate && <section className="foundry-empty-dashboard" aria-label="Project Foundry empty project board">
      <article className="industrial-panel foundry-empty-primary">
        <div className="foundry-empty-hero">
          <span className="foundry-empty-mark" aria-hidden="true">PF</span>
          <div className="foundry-empty-copy">
            <small>PROJECT BOARD / READY BAY</small>
            <h3>Foundry is ready for its first production run.</h3>
            <p>The creator above is already tied to live blueprints and synced inventory. Create the project and Sage will turn this draft into the full command workspace automatically.</p>
          </div>
          <span className={`foundry-empty-state ${draftBlueprintReady ? "ready" : "needs-input"}`}>{draftBlueprintReady ? "READY TO CREATE" : "BLUEPRINT REQUIRED"}</span>
        </div>

        <div className="foundry-empty-draft">
          <div className="foundry-empty-blueprint">
            <span className="foundry-empty-blueprint-icon">BP</span>
            <span>
              <small>{draftSourceLabel}</small>
              <strong>{draftProductName || draftBlueprintName}</strong>
              <em>{draftBlueprintName} · {n(quantity)} unit{quantity === 1 ? "" : "s"} · ME {me} / TE {te}</em>
            </span>
          </div>
          <div className="foundry-empty-draft-meta">
            <span><small>PROJECT MODE</small><strong>{mode === "solo" ? "Solo" : "Corporation"}</strong></span>
            <span><small>STOCK SOURCE</small><strong>{draftStockLabel}</strong></span>
          </div>
          <button className="foundry-empty-create" type="button" disabled={busy || !draftBlueprintReady} onClick={() => void createProject()}>{busy ? "Building hierarchy..." : "Create first project"}</button>
        </div>

        <div className="foundry-empty-flow" aria-label="Foundry project workflow">
          {[
            ["01", "Blueprint", "Expand the authoritative SDE hierarchy"],
            ["02", "Materials", "Compare requirements against synced stock"],
            ["03", "Manufacturing", "Expose recursive component build lines"],
            ["04", "Assembly", "Gate final build on real dependencies"],
            ["05", "Delivery", "Track finished output into the ledger"],
          ].map(([step, label, detail]) => <div key={step}><span>{step}</span><strong>{label}</strong><small>{detail}</small></div>)}
        </div>
      </article>

      <aside className="foundry-empty-side">
        <article className="industrial-panel foundry-empty-checks">
          <div className="foundry-section-head"><div><small>PRE-FLIGHT</small><strong>Project readiness</strong></div><span>{draftBlueprintReady ? "READY" : "SETUP"}</span></div>
          <div className="foundry-empty-check-list">
            <div className={draftBlueprintReady ? "good" : "warn"}><i /><span><small>Blueprint</small><strong>{draftBlueprintReady ? draftBlueprintName : "Select a blueprint above"}</strong></span></div>
            <div className="good"><i /><span><small>Live state</small><strong>{workspace?.snapshotUpdatedAt ? `Synced ${new Date(workspace.snapshotUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Local state ready"}</strong></span></div>
            <div className="good"><i /><span><small>Planning mode</small><strong>{mode === "solo" ? "Owner-managed build" : "Corporation allocation enabled"}</strong></span></div>
            <div className={mode === "corporation" && !members.length ? "info" : "good"}><i /><span><small>Allocation directory</small><strong>{mode === "solo" ? "Not required for solo" : `${members.length} members · ${divisions.length} divisions visible`}</strong></span></div>
          </div>
        </article>

        <article className="industrial-panel foundry-empty-next">
          <div className="foundry-section-head"><div><small>AFTER CREATION</small><strong>Workspace comes online</strong></div></div>
          <div className="foundry-empty-next-list">
            <span><b>PIPELINE</b><small>Five-stage build progression appears with live readiness.</small></span>
            <span><b>BUILD LINES</b><small>Real materials and components replace generic task rows.</small></span>
            <span><b>{mode === "corporation" ? "ALLOCATION" : "OWNERSHIP"}</b><small>{mode === "corporation" ? "Assign exact quantities to real members, divisions and work groups." : "The project owner carries the build without unnecessary team workflow."}</small></span>
          </div>
        </article>
      </aside>
    </section>}
  </div>;
}
