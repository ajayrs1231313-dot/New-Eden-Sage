import { useEffect, useMemo, useState } from "react";

export type TacticalDoctrineFit = {
  id: string;
  fitName: string;
  hullName: string;
  hullTypeId: number;
};

export type TacticalDoctrine = {
  slot: number;
  name: string;
  fits: TacticalDoctrineFit[];
  assignments?: Record<string, string>;
};

export type TacticalCorporation = {
  corporationId: number;
  name: string;
  data?: any;
};

type Snapshot = {
  characterId?: string;
  character?: {
    name?: string;
    corporation_id?: number;
  };
};

type Pilot = {
  characterId: string;
  name: string;
};

function assetUrl(typeId: number, size = 128) {
  return typeId > 0 ? `sage-asset://type/${typeId}/render?size=${size}` : "";
}

export function DoctrineTacticalMap({
  doctrine,
  corporation,
  snapshots,
  onAssignmentsChange,
  onClose,
}: {
  doctrine: TacticalDoctrine;
  corporation: TacticalCorporation;
  snapshots: Snapshot[];
  onAssignmentsChange(assignments: Record<string, string>): void;
  onClose(): void;
}) {
  const [resolvedNames, setResolvedNames] = useState<Map<number, string>>(new Map());
  const [selectedPilotId, setSelectedPilotId] = useState<string>("");
  const [pickers, setPickers] = useState<Record<string, string>>({});

  const corporationSnapshots = useMemo(
    () => snapshots.filter((snapshot) => Number(snapshot?.character?.corporation_id ?? 0) === corporation.corporationId),
    [snapshots, corporation.corporationId],
  );

  const memberIds = useMemo(() => {
    const esiMembers = Array.isArray(corporation.data?.members) ? corporation.data.members.map(Number).filter((id: number) => id > 0) : [];
    const connected = corporationSnapshots.map((snapshot) => Number(snapshot.characterId ?? 0)).filter((id) => id > 0);
    return [...new Set([...esiMembers, ...connected])];
  }, [corporation.data?.members, corporationSnapshots]);

  useEffect(() => {
    let cancelled = false;
    if (!memberIds.length || typeof (window.sage as any).resolveTypeIds !== "function") {
      setResolvedNames(new Map());
      return;
    }
    void (async () => {
      const rows: Array<{ id: number; name: string }> = [];
      for (let index = 0; index < memberIds.length; index += 900) {
        const batch = await (window.sage as any).resolveTypeIds(memberIds.slice(index, index + 900));
        if (Array.isArray(batch)) rows.push(...batch);
      }
      if (!cancelled) setResolvedNames(new Map(rows.map((row) => [Number(row.id), String(row.name)])));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [memberIds.join(",")]);

  const connectedNames = useMemo(
    () => new Map(corporationSnapshots.map((snapshot) => [String(snapshot.characterId ?? ""), String(snapshot.character?.name ?? "")])),
    [corporationSnapshots],
  );

  const pilots = useMemo<Pilot[]>(
    () => memberIds
      .map((id) => ({
        characterId: String(id),
        name: connectedNames.get(String(id)) || resolvedNames.get(id) || `Character ${id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [memberIds, connectedNames, resolvedNames],
  );

  const assignments = doctrine.assignments ?? {};
  const fitById = useMemo(() => new Map(doctrine.fits.map((fit) => [fit.id, fit])), [doctrine.fits]);
  const pilotById = useMemo(() => new Map(pilots.map((pilot) => [pilot.characterId, pilot])), [pilots]);
  const assignedEntries = Object.entries(assignments).filter(([, fitId]) => fitById.has(fitId));
  const unassigned = pilots.filter((pilot) => !assignments[pilot.characterId]);

  const nodes = assignedEntries.map(([characterId, fitId], index) => {
    const fit = fitById.get(fitId)!;
    const pilot = pilotById.get(characterId) ?? { characterId, name: `Character ${characterId}` };
    const total = Math.max(1, assignedEntries.length);
    const ring = index % 2 === 0 ? 34 : 25;
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    return {
      characterId,
      pilot,
      fit,
      x: 50 + Math.cos(angle) * ring,
      y: 50 + Math.sin(angle) * ring,
    };
  });

  const selectedPilot = selectedPilotId ? pilotById.get(selectedPilotId) : undefined;
  const selectedFit = selectedPilotId ? fitById.get(assignments[selectedPilotId]) : undefined;

  function assign(characterId: string, fitId: string) {
    if (!characterId || !fitId) return;
    onAssignmentsChange({ ...assignments, [characterId]: fitId });
    setSelectedPilotId(characterId);
  }

  function unassign(characterId: string) {
    const next = { ...assignments };
    delete next[characterId];
    onAssignmentsChange(next);
    if (selectedPilotId === characterId) setSelectedPilotId("");
  }

  return (
    <div className="doctrine-tactical-backdrop" onMouseDown={onClose}>
      <section className="doctrine-tactical-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="doctrine-tactical-head">
          <div>
            <p className="eyebrow">FLEET COMMAND · TACTICAL MAP</p>
            <h2>{doctrine.name || `Doctrine ${doctrine.slot}`}</h2>
            <p>{corporation.name} · assign doctrine ships to actual corporation characters.</p>
          </div>
          <div className="doctrine-tactical-summary">
            <span><strong>{assignedEntries.length}</strong> assigned</span>
            <span><strong>{unassigned.length}</strong> unassigned</span>
            <span><strong>{doctrine.fits.length}</strong> fits</span>
            <button onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="doctrine-tactical-layout">
          <aside className="doctrine-tactical-roster">
            <div className="doctrine-tactical-roster-title">
              <strong>Doctrine assignments</strong>
              <small>{pilots.length} visible corporation character{pilots.length === 1 ? "" : "s"}</small>
            </div>

            {doctrine.fits.map((fit) => {
              const fitPilots = assignedEntries
                .filter(([, fitId]) => fitId === fit.id)
                .map(([characterId]) => pilotById.get(characterId) ?? { characterId, name: `Character ${characterId}` });
              return (
                <article className="doctrine-tactical-fit-row" key={fit.id}>
                  <div className="doctrine-tactical-fit-head">
                    <div className="doctrine-tactical-fit-icon">
                      {fit.hullTypeId > 0 ? <img src={assetUrl(fit.hullTypeId, 64)} alt="" /> : <span>?</span>}
                    </div>
                    <div><strong>{fit.hullName}</strong><small>{fit.fitName} · {fitPilots.length} assigned</small></div>
                  </div>
                  <div className="doctrine-tactical-pills">
                    {fitPilots.map((pilot) => (
                      <button key={pilot.characterId} onClick={() => setSelectedPilotId(pilot.characterId)}>{pilot.name}</button>
                    ))}
                    {!fitPilots.length && <span>No pilots assigned</span>}
                  </div>
                  <div className="doctrine-tactical-assign-control">
                    <select
                      value={pickers[fit.id] ?? ""}
                      onChange={(event) => setPickers((current) => ({ ...current, [fit.id]: event.target.value }))}
                    >
                      <option value="">Assign corporation member…</option>
                      {pilots.map((pilot) => (
                        <option key={pilot.characterId} value={pilot.characterId}>{pilot.name}{assignments[pilot.characterId] ? " · move assignment" : ""}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const characterId = pickers[fit.id] ?? "";
                        assign(characterId, fit.id);
                        setPickers((current) => ({ ...current, [fit.id]: "" }));
                      }}
                      disabled={!pickers[fit.id]}
                    >Assign</button>
                  </div>
                </article>
              );
            })}
          </aside>

          <div className="doctrine-space-map">
            <svg className="doctrine-space-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {nodes.map((node) => <line key={node.characterId} x1="50" y1="50" x2={node.x} y2={node.y} />)}
            </svg>
            <div className="doctrine-space-anchor">
              <span>DOCTRINE</span>
              <strong>{doctrine.name || `Doctrine ${doctrine.slot}`}</strong>
              <small>{assignedEntries.length} ships assigned</small>
            </div>
            {nodes.map((node) => (
              <button
                key={node.characterId}
                className={`doctrine-space-node ${selectedPilotId === node.characterId ? "selected" : ""}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onClick={() => setSelectedPilotId(node.characterId)}
                title={`${node.pilot.name} · ${node.fit.hullName} · ${node.fit.fitName}`}
              >
                <span className="doctrine-space-node-ship">
                  {node.fit.hullTypeId > 0 ? <img src={assetUrl(node.fit.hullTypeId, 128)} alt="" /> : <b>?</b>}
                </span>
                <strong>{node.pilot.name}</strong>
                <small>{node.fit.hullName}</small>
              </button>
            ))}
            {!nodes.length && (
              <div className="doctrine-space-empty">
                <strong>No ships assigned yet</strong>
                <span>Assign corporation members to doctrine fits from the roster on the left.</span>
              </div>
            )}
          </div>

          <aside className="doctrine-tactical-inspector">
            <p className="eyebrow">ASSIGNMENT DETAIL</p>
            {selectedPilot && selectedFit ? (
              <>
                <div className="doctrine-tactical-inspector-ship">
                  {selectedFit.hullTypeId > 0 && <img src={assetUrl(selectedFit.hullTypeId, 256)} alt="" />}
                </div>
                <h3>{selectedPilot.name}</h3>
                <strong>{selectedFit.hullName}</strong>
                <span>{selectedFit.fitName}</span>
                <small>Character {selectedPilot.characterId}</small>
                <button className="doctrine-tactical-unassign" onClick={() => unassign(selectedPilot.characterId)}>Remove assignment</button>
              </>
            ) : (
              <div className="doctrine-tactical-inspector-empty">Select an assigned ship on the map to inspect its pilot and doctrine fit.</div>
            )}
            <div className="doctrine-tactical-legend">
              <strong>Map purpose</strong>
              <p>This is an FC planning view. It represents doctrine assignments, not live EVE positions.</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
