import { useEffect, useMemo, useState } from "react";

type Blueprint = { item_id?: number; type_id?: number; material_efficiency?: number; time_efficiency?: number; runs?: number; scope: "personal" | "corporation" };
type ManualBlueprint = { blueprintTypeId: number; blueprintName: string; productTypeId: number; productName: string; productPerRun: number };
type OwnerType = "member" | "division" | "project";
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

  const owned = useMemo(() => blueprints.filter((row) => Number(row.type_id ?? 0) > 0), [blueprints]);
  const selectedOwned = owned[ownedIndex] ?? owned[0];
  const project = useMemo(() => (workspace?.projects ?? []).find((row: any) => row.id === projectId) ?? workspace?.projects?.[0] ?? null, [workspace, projectId]);
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
      setWorkspace(result); setProjectId(result?.selectedProject?.id ?? ""); setProjectName(""); setSelected(new Set());
      setMessage(mode === "solo" ? "Solo project created. No assignment layer is required." : "Corporation project created. Select real build rows below to divide the work.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Project creation failed."); } finally { setBusy(false); }
  }

  async function save(next: any, ok = "Project updated.") {
    setBusy(true);
    try { const result = await window.sage.updateFoundryProject({ characterId, project: next }); setWorkspace(result); setProjectId(result?.selectedProject?.id ?? next.id); setMessage(ok); return result?.selectedProject; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project update failed."); await load(next.id); return null; }
    finally { setBusy(false); }
  }

  const assignmentsByTarget = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of project?.assignments ?? []) { const list = map.get(row.targetId) ?? []; list.push(row); map.set(row.targetId, list); }
    return map;
  }, [project?.assignments]);
  const tree = (project?.buildTree ?? []).filter((row: any) => Number(row.depth ?? 0) > 0);
  const visibleTree = fullTree ? tree : tree.filter((row: any) => Number(row.depth ?? 0) <= 2);
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

  const linked = new Set((project?.linkedStores ?? []).map((row: any) => row.key));
  const stores = [...(workspace?.stores?.divisions ?? []), ...(workspace?.stores?.containers ?? [])];
  const blockers = project?.finalAssembly?.blockers ?? [];
  const openAssignments = project?.mode === "corporation" ? tree.filter((row: any) => remaining(row.id) > 0).length + (remaining("final-assembly") > 0 ? 1 : 0) : 0;

  return <div className="industrial-foundry-workspace">
    <article className="industrial-panel foundry-create">
      <div className="industrial-panel-head"><div><p className="eyebrow">PROJECT FOUNDRY</p><h3>Build first. Divide second.</h3><p>Sage expands the real production tree before you organise it. Solo builds stay simple; corporation builds can be split across actual members, divisions and quantities.</p></div><span className="industrial-status live">SDE + LIVE STATE</span></div>
      <div className="foundry-mode-switch"><button className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}><strong>Solo project</strong><small>No assignment overhead</small></button><button className={mode === "corporation" ? "active" : ""} onClick={() => setMode("corporation")}><strong>Corporation project</strong><small>Split exact build stages</small></button></div>
      <label className="foundry-manual-toggle"><input type="checkbox" checked={manual} onChange={(event) => { setManual(event.target.checked); setManualBlueprint(null); if (event.target.checked) { setMe(0); setTe(0); } }} /><span><strong>Manual blueprint override</strong><small>Plan any SDE blueprint even when you do not own it.</small></span></label>
      <div className="foundry-create-grid">
        {!manual ? <label className="wide"><span>Synced blueprint</span><select value={Math.min(ownedIndex, Math.max(0, owned.length - 1))} onChange={(e) => setOwnedIndex(Number(e.target.value))}>{owned.map((row, index) => <option value={index} key={`${row.scope}-${row.item_id ?? index}`}>{row.scope === "corporation" ? "CORP" : "PERSONAL"} · {typeNames[Number(row.type_id)] ?? `Type ${row.type_id}`} · ME {row.material_efficiency ?? 0} / TE {row.time_efficiency ?? 0}</option>)}</select></label> : <div className="foundry-manual-search wide"><label><span>CCP SDE blueprint search</span><input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder="Search Orca, capital component..." /></label>{manualQuery.trim().length >= 2 && <div className="foundry-search-results">{manualResults.slice(0, 8).map((row) => <button key={row.blueprintTypeId} className={manualBlueprint?.blueprintTypeId === row.blueprintTypeId ? "active" : ""} onClick={() => setManualBlueprint(row)}><span><strong>{row.productName}</strong><small>{row.blueprintName}</small></span><b>{row.productPerRun}/run</b></button>)}</div>}{manualBlueprint && <small className="foundry-picked">MANUAL · {manualBlueprint.productName} · {manualBlueprint.blueprintName}</small>}</div>}
        <label><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} /></label><label><span>ME</span><input type="number" min="0" max="10" value={me} onChange={(e) => setMe(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} /></label><label><span>TE</span><input type="number" min="0" max="20" value={te} onChange={(e) => setTe(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} /></label><label className="wide"><span>Project name</span><input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Optional" /></label><button className="foundry-primary" disabled={busy || (manual ? !manualBlueprint : !owned.length)} onClick={() => void createProject()}>{busy ? "Working..." : "Create project"}</button>
      </div>
      <div className="industrial-notice">{message}</div>
    </article>

    {(workspace?.projects ?? []).length > 0 && <div className="foundry-project-strip">{workspace.projects.map((row: any) => <button key={row.id} className={row.id === project?.id ? "active" : ""} onClick={() => { setProjectId(row.id); setSelected(new Set()); }}><span><strong>{row.name}</strong><small>{row.quantity} × {row.productName} · {row.mode === "solo" ? "SOLO" : "CORP"}</small></span><b>{pc(row.progress)}</b></button>)}</div>}

    {project && <>
      <article className="industrial-panel foundry-overview">
        <div className="foundry-overview-head"><div><p className="eyebrow">PROJECT COMMAND</p><h2>{project.name}</h2><p>{project.quantity} × {project.productName} · {project.blueprintName} · ME {project.materialEfficiency} / TE {project.timeEfficiency}</p></div><div className="foundry-actions"><label className="foundry-status-control"><span>PROJECT STATUS</span><select value={project.status} onChange={(e) => void save({ ...project, status: e.target.value }, `Status changed to ${e.target.value}.`)}><option value="planning">Planning</option><option value="active">Active</option><option value="complete">Complete</option><option value="archived">Archived</option></select></label><button className="danger" onClick={async () => { if (!window.confirm(`Delete ${project.name}?`)) return; const result = await window.sage.deleteFoundryProject({ characterId, projectId: project.id }); setWorkspace(result); setProjectId(result?.selectedProject?.id ?? ""); }}>Delete</button></div></div>
        <div className="foundry-mode-inline"><b>MODE</b><button className={project.mode === "solo" ? "active" : ""} onClick={() => void save({ ...project, mode: "solo" }, "Switched to solo planning.")}>Solo</button><button className={project.mode === "corporation" ? "active" : ""} onClick={() => void save({ ...project, mode: "corporation" }, "Switched to corporation planning.")}>Corporation</button><small>{project.blueprintSource === "manual" ? "Manual SDE blueprint" : "Synced blueprint"} · owner {project.createdByCharacterName}</small></div>
        <div className="foundry-intel"><span><small>READINESS</small><strong>{pc(project.progress)}</strong><em>{n(project.totalDeliveredUnits)} / {n(project.totalRequiredUnits)} dependency units</em></span><span><small>BLOCKERS</small><strong>{n(project.finalAssembly?.blockerCount ?? 0)}</strong><em>{n(project.missingUnits)} units missing</em></span><span><small>FINAL ASSEMBLY</small><strong className={project.finalAssembly?.ready ? "good" : "warn"}>{project.finalAssembly?.ready ? "READY" : "BLOCKED"}</strong><em>{project.finalAssembly?.ready ? "Dependencies fulfilled" : "Waiting upstream"}</em></span><span><small>RESPONSIBILITY</small><strong>{project.mode === "solo" ? "OWNER" : `${openAssignments} OPEN`}</strong><em>{project.mode === "solo" ? project.createdByCharacterName : `${project.assignments?.length ?? 0} assignment splits`}</em></span><span><small>BLUEPRINT</small><strong>ME {project.materialEfficiency} / TE {project.timeEfficiency}</strong><em>Research feeds calculations</em></span></div>
        <div className="foundry-progress"><span style={{ width: pc(project.progress) }} /><b>{pc(project.progress)} READY</b></div>
        <div className={`foundry-blocker ${project.finalAssembly?.ready ? "ready" : ""}`}><strong>{project.finalAssembly?.ready ? "Final assembly is ready." : "Final assembly is blocked."}</strong><span>{project.finalAssembly?.ready ? "All direct inputs are physically available to this project." : blockers.slice(0, 5).map((row: any) => `${row.name} ${n(row.outstanding)}`).join(" · ")}</span></div>
      </article>

      {(project.productionLots ?? []).length > 0 && <article className="industrial-panel foundry-production-lots">
        <div className="industrial-panel-head"><div><p className="eyebrow">PRODUCTION LOTS</p><h3>Traceable output</h3><p>Every completed manufacturing run keeps a stable Sage identifier through Foundry and Wallet Ledger reconciliation.</p></div><span className="industrial-status live">{(project.productionLots ?? []).length} LOT{(project.productionLots ?? []).length === 1 ? "" : "S"}</span></div>
        <div className="foundry-lot-list"><div className="foundry-lot-row heading"><span>Production ID</span><span>Produced</span><span>Output</span><span>Sold</span><span>Remaining</span><span>Ledger</span></div>{(project.productionLots ?? []).map((lot: any) => <div className="foundry-lot-row" key={lot.id}><span className="foundry-lot-id"><strong>{lot.id}</strong><small>EVE job {lot.industryJobId}</small></span><span>{new Date(lot.producedAt).toLocaleString()}</span><span>{n(lot.quantity)}</span><span>{n(lot.soldQuantity)}</span><span>{n(lot.remainingQuantity)}</span><b className={`state ${lot.reconciliationStatus}`}>{String(lot.reconciliationStatus).toUpperCase()}</b></div>)}</div>
      </article>}

      <article className="industrial-panel foundry-tree-panel">
        <div className="industrial-panel-head"><div><p className="eyebrow">PRODUCTION HIERARCHY</p><h3>{project.productName} build tree</h3><p>These are actual SDE build stages. Assign the work itself, not a generic database bucket.</p></div><button className="foundry-small" onClick={() => setFullTree((v) => !v)}>{fullTree ? "Core stages" : "Full chain"}</button></div>
        <div className="foundry-root"><span><b>FINAL PRODUCT</b><strong>{project.quantity} × {project.productName}</strong><small>{project.blueprintName}</small></span><em className={project.finalAssembly?.ready ? "ready" : ""}>{project.finalAssembly?.ready ? "ASSEMBLY READY" : "UPSTREAM BLOCKED"}</em></div>
        <div className="foundry-tree"><div className="foundry-tree-row heading"><span>Stage / requirement</span><span>Required</span><span>Available</span><span>Missing</span><span>Responsibility</span><span>State</span></div>{visibleTree.map((row: any) => { const rows = assignmentsByTarget.get(row.id) ?? []; const open = remaining(row.id); const state = row.coverage >= .999999 ? "DELIVERED" : rows.some((x: any) => x.status === "in-progress") ? "IN PRODUCTION" : rows.length ? "ASSIGNED" : "UNASSIGNED"; return <div className={`foundry-tree-row depth-${Math.min(4, Number(row.depth ?? 0))} kind-${row.kind} ${row.outstanding <= 0 ? "covered" : ""} ${selected.has(row.id) ? "selected" : ""}`} key={row.id}><span className="tree-name" style={{ paddingLeft: `${Math.max(0, row.depth - 1) * 15}px` }}>{project.mode === "corporation" && <input type="checkbox" checked={selected.has(row.id)} disabled={open <= 0} onChange={() => toggleTarget(row.id)} />}<span><strong>{row.name}</strong><small>{row.kind === "component" ? `COMPONENT · ${row.runs ?? "?"} runs` : row.direct ? "DIRECT INPUT" : "MATERIAL INPUT"}</small></span></span><span>{n(row.required)}</span><span>{n(row.availableToProject)}</span><span className="missing">{n(row.outstanding)}</span><span className="who">{rows.length ? rows.map((x: any) => `${x.ownerName}: ${n(x.quantity)}`).join(" · ") : project.mode === "solo" ? project.createdByCharacterName : "Unassigned"}{rows.length && open > 0 ? ` · ${n(open)} open` : ""}</span><span><b className={`state ${state.toLowerCase().replace(/\s/g, "-")}`}>{state}</b></span></div>; })}</div>
        <div className={`foundry-final ${project.finalAssembly?.ready ? "ready" : ""}`}><span className="tree-name">{project.mode === "corporation" && <input type="checkbox" checked={selected.has("final-assembly")} disabled={remaining("final-assembly") <= 0} onChange={() => toggleTarget("final-assembly")} />}<span><strong>Final Assembly</strong><small>{project.finalAssembly?.ready ? "Dependencies satisfied" : `${project.finalAssembly?.blockerCount} blockers`}</small></span></span><b>{project.finalAssembly?.ready ? "READY TO BUILD" : "BLOCKED"}</b><span>{(assignmentsByTarget.get("final-assembly") ?? []).map((x: any) => `${x.ownerName}: ${n(x.quantity)}`).join(" · ") || (project.mode === "solo" ? project.createdByCharacterName : "Unassigned")}</span></div>
      </article>

      {project.mode === "corporation" ? <div className="foundry-corp-grid">
        <article className="industrial-panel foundry-assign"><div className="industrial-panel-head"><div><p className="eyebrow">ASSIGN SELECTED WORK</p><h3>Who is doing what?</h3><p>Tick rows above, choose a real owner, then assign. Select one row to split its quantity.</p></div><span className="industrial-status">{selected.size} SELECTED</span></div>
          <div className={`foundry-selection-summary ${selected.size ? "has-selection" : ""}`}><span><small>WORK SELECTED</small><strong>{selected.size ? `${selected.size} build ${selected.size === 1 ? "stage" : "stages"}` : "Choose stages in the build tree"}</strong></span><em>{selected.size === 1 ? `${n(remaining([...selected][0]))} units still open` : selected.size > 1 ? "Each stage assigns its remaining quantity" : "Checkboxes appear beside every assignable stage"}</em></div>
          <div className="foundry-assign-controls"><div className="foundry-owner-type"><span>ASSIGN TO</span><div><button type="button" className={ownerType === "member" ? "active" : ""} onClick={() => setOwnerType("member")}><b>Member</b><small>Named pilot</small></button><button type="button" className={ownerType === "division" ? "active" : ""} onClick={() => setOwnerType("division")}><b>Division</b><small>Whole corp team</small></button><button type="button" className={ownerType === "project" ? "active" : ""} onClick={() => setOwnerType("project")}><b>Owner</b><small>Project creator</small></button></div></div>{ownerType === "member" && <label><span>Member</span><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{members.map((row: any) => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>}{ownerType === "division" && <label><span>Division</span><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{divisions.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}{ownerType === "project" && <div className="owner-fixed"><span>PROJECT OWNER</span><strong>{project.createdByCharacterName}</strong></div>}<label><span>Group</span><select value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">No group</option>{(project.groups ?? []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{selected.size === 1 && <label><span>Quantity</span><input type="number" min="1" max={Math.max(1, remaining([...selected][0]))} value={splitQuantity} onChange={(e) => setSplitQuantity(Math.max(1, Number(e.target.value) || 1))} /></label>}<button className="foundry-primary" disabled={!selected.size || busy || (ownerType !== "project" && !ownerId)} onClick={() => void assignSelected()}>Assign selected</button></div>
          {ownerType === "member" && !members.length && <div className="industrial-notice">No member roster is available in this snapshot.</div>}{ownerType === "division" && !divisions.length && <div className="industrial-notice">No configured corporation divisions are available yet. Sync/reconnect with corporation division access; Sage will use the real ESI names.</div>}
          <div className="foundry-assignment-list">{(project.assignments ?? []).map((row: any) => <div className="assignment-row" key={row.id}><span><strong>{row.ownerName}</strong><small>{row.ownerType}{row.groupName ? ` · ${row.groupName}` : ""}</small></span><span><strong>{row.targetName}</strong><small>{n(row.quantity)} assigned · {n(row.deliveredQuantity)} delivered</small></span><b className={`state ${row.dataState}`}>{String(row.dataState).replace("-", " ").toUpperCase()}</b>{row.dataState !== "delivered" && <button className="foundry-small" onClick={() => void save({ ...project, assignments: project.assignments.map((x: any) => x.id === row.id ? { ...x, status: x.status === "in-progress" ? "open" : "in-progress" } : x) }, "Work state updated; completion remains stock-driven.")}>{row.status === "in-progress" ? "Started ✓" : "Start"}</button>}<button className="remove" onClick={() => void save({ ...project, assignments: project.assignments.filter((x: any) => x.id !== row.id) }, "Assignment removed.")}>×</button></div>)}</div>
        </article>
        <article className="industrial-panel foundry-groups"><div className="industrial-panel-head"><div><p className="eyebrow">WORK GROUPS</p><h3>Organise it your way</h3><p>Optional labels only: Mining Team, Capital Components, Hauling, Dave's Stuff.</p></div><span className="industrial-status">OPTIONAL · {(project.groups ?? []).length}</span></div><div className="group-create"><input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New work group" onKeyDown={(e) => { if (e.key === "Enter") void addGroup(); }} /><button onClick={() => void addGroup()}>Add</button></div>{(project.groups ?? []).map((row: any) => <div className={`group-row ${groupId === row.id ? "active" : ""}`} key={row.id}><input defaultValue={row.name} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== row.name) void save({ ...project, groups: project.groups.map((x: any) => x.id === row.id ? { ...x, name } : x) }, "Work group renamed."); }} /><small>{row.ownerName ?? "Owner set when work is assigned"}</small><button onClick={() => setGroupId(row.id)}>{groupId === row.id ? "Selected" : "Use"}</button><button className="remove" onClick={() => void save({ ...project, groups: project.groups.filter((x: any) => x.id !== row.id), assignments: project.assignments.map((x: any) => x.groupId === row.id ? { ...x, groupId: undefined } : x) }, "Work group removed; assignments kept.")}>×</button></div>)}</article>
      </div> : <article className="industrial-panel foundry-solo"><div><p className="eyebrow">SOLO PROJECT</p><h3>No fake team workflow.</h3><p>Sage treats {project.createdByCharacterName} as owner of the entire build and calculates readiness from that character's synced personal assets.</p></div><span><small>OWNER</small><strong>{project.createdByCharacterName}</strong><em>{pc(project.progress)} ready</em></span></article>}

      {project.mode === "corporation" && <article className="industrial-panel foundry-stores"><div className="industrial-panel-head"><div><p className="eyebrow">PROJECT STORES</p><h3>Where delivered work counts</h3><p>Link actual corporation divisions or named containers. Nested stock is read automatically.</p></div></div><div className="store-list">{stores.map((row: any) => <button key={row.key} className={linked.has(row.key) ? "linked" : ""} onClick={() => { const next = linked.has(row.key) ? project.linkedStores.filter((x: any) => x.key !== row.key) : [...project.linkedStores, { kind: row.kind, key: row.key, itemId: row.itemId, locationFlag: row.locationFlag, name: row.name }]; void save({ ...project, linkedStores: next }, `${linked.has(row.key) ? "Unlinked" : "Linked"} ${row.name}.`); }}><span><strong>{row.name}</strong><small>{row.kind === "container" ? `${row.typeName ?? "Named container"} · ${row.division ?? "corp assets"}` : `${row.itemCount ?? 0} asset records`}</small></span><b>{linked.has(row.key) ? "LINKED" : "LINK"}</b></button>)}</div>{!stores.length && <div className="industrial-notice">Corporation stores are not visible to this character yet.</div>}</article>}

      <article className="industrial-panel foundry-ledger"><div className="industrial-panel-head"><div><p className="eyebrow">FINAL ASSEMBLY DEPENDENCIES</p><h3>Required vs available</h3><p>These direct inputs determine whether final assembly can start.</p></div><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter..." /></div><div className="ledger"><div className="ledger-row heading"><span>Requirement</span><span>Required</span><span>Available</span><span>Reserved</span><span>Missing</span><span>Coverage</span></div>{(project.requirements ?? []).filter((row: any) => !filter.trim() || row.name.toLowerCase().includes(filter.toLowerCase())).map((row: any) => <div className={`ledger-row ${row.outstanding <= 0 ? "covered" : ""}`} key={row.typeId}><strong>{row.name}</strong><span>{n(row.required)}</span><span>{n(row.availableToProject)}</span><span>{n(row.reservedByOtherProjects)}</span><span className="missing">{n(row.outstanding)}</span><span><b>{pc(row.coverage)}</b></span></div>)}</div><small className="industrial-plan-scope">{workspace?.source}. Snapshot {workspace?.snapshotUpdatedAt ? new Date(workspace.snapshotUpdatedAt).toLocaleString() : "unavailable"}.</small></article>
    </>}

    {!project && workspace && <article className="industrial-panel industrial-planned"><p className="eyebrow">PROJECT BOARD</p><h3>No Foundry projects yet</h3><p>Create a solo or corporation project above. Sage will build the production hierarchy first and only introduce assignment controls when a corporation project needs them.</p></article>}
  </div>;
}
