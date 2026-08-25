import { useEffect, useMemo, useState } from "react";
import { DoctrineTacticalMap } from "./DoctrineTacticalMap";
import {
  appendDoctrine,
  migrateDoctrineRecords,
  removeDoctrineById,
  type DoctrineFit,
  type DoctrineRecord,
} from "./doctrine-model";

export type DoctrineCorporation = {
  corporationId: number;
  name: string;
  data?: any;
};

type PendingDoctrineFit = {
  corporationId?: number;
  targetSlot?: number;
  doctrineName: string;
  exportedAt: string;
  fit: any;
};

export const PENDING_DOCTRINE_FIT_KEY = "new-eden-sage-pending-doctrine-fit";
const doctrineStorageKey = (corporationId: number) => `new-eden-sage-corp-doctrines-v1:${corporationId}`;

function assetUrl(typeId: number, size = 256) {
  return typeId > 0 ? `sage-asset://type/${typeId}/render?size=${size}` : "";
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function loadDoctrines(corporationId: number): DoctrineRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(doctrineStorageKey(corporationId)) ?? "[]");
    return migrateDoctrineRecords(parsed);
  } catch {
    return migrateDoctrineRecords([]);
  }
}

function readPending(): PendingDoctrineFit | null {
  try {
    const raw = sessionStorage.getItem(PENDING_DOCTRINE_FIT_KEY);
    return raw ? (JSON.parse(raw) as PendingDoctrineFit) : null;
  } catch {
    return null;
  }
}

export function CorporationDoctrines({ corporation, snapshots }: { corporation: DoctrineCorporation; snapshots: any[] }) {
  const [doctrines, setDoctrines] = useState<DoctrineRecord[]>(() => loadDoctrines(corporation.corporationId));
  const [selectedDoctrineId, setSelectedDoctrineId] = useState<string>(() => loadDoctrines(corporation.corporationId)[0]?.id ?? "");
  const [pending, setPending] = useState<PendingDoctrineFit | null>(() => {
    const queued = readPending();
    return queued && (!queued.corporationId || Number(queued.corporationId) === corporation.corporationId) ? queued : null;
  });
  const [pendingName, setPendingName] = useState(pending?.doctrineName ?? "");
  const [targetDoctrineId, setTargetDoctrineId] = useState("");
  const [message, setMessage] = useState("Doctrine library ready. Add doctrines and fits as your corporation needs them.");
  const [tacticalDoctrineId, setTacticalDoctrineId] = useState<string | null>(null);
  const doctrineHullSignature = useMemo(() => doctrines.flatMap((doctrine) => doctrine.fits.map((fit) => `${fit.id}:${fit.hullTypeId}:${fit.hullName}`)).join("|"), [doctrines]);

  useEffect(() => {
    const loaded = loadDoctrines(corporation.corporationId);
    setDoctrines(loaded);
    setSelectedDoctrineId(loaded[0]?.id ?? "");
    const queued = readPending();
    if (queued && (!queued.corporationId || Number(queued.corporationId) === corporation.corporationId)) {
      setPending(queued);
      setPendingName(queued.doctrineName);
      const preferred = loaded.find((item) => item.slot === Number(queued.targetSlot));
      const matching = loaded.find((item) => item.name.trim().toLowerCase() === queued.doctrineName.trim().toLowerCase());
      const target = preferred ?? matching ?? loaded[0];
      setTargetDoctrineId(target?.id ?? "");
      if (target) setSelectedDoctrineId(target.id);
    } else {
      setPending(null);
      setTargetDoctrineId(loaded[0]?.id ?? "");
    }
  }, [corporation.corporationId]);

  useEffect(() => {
    localStorage.setItem(doctrineStorageKey(corporation.corporationId), JSON.stringify(doctrines));
  }, [corporation.corporationId, doctrines]);

  useEffect(() => {
    let cancelled = false;
    const fits = doctrines.flatMap((doctrine) => doctrine.fits.map((fit) => ({ doctrineId: doctrine.id, fit })));
    if (!fits.length) return () => { cancelled = true; };
    void (async () => {
      const validById = new Map<number, string>();
      const ids = [...new Set(fits.map(({ fit }) => Number(fit.hullTypeId ?? 0)).filter((id) => id > 0))];
      if (ids.length) {
        const rows = await window.sage.resolveFittingTypeIdsLocal(ids);
        for (const row of Array.isArray(rows) ? rows : []) validById.set(Number(row.id), String(row.name ?? ""));
      }
      const needsRepair = fits.filter(({ fit }) => {
        const id = Number(fit.hullTypeId ?? 0);
        const resolvedName = validById.get(id);
        return id <= 0 || !resolvedName || resolvedName.trim().toLowerCase() !== String(fit.hullName ?? "").trim().toLowerCase();
      });
      if (!needsRepair.length || cancelled) return;
      const names = [...new Set(needsRepair.map(({ fit }) => String(fit.hullName ?? "").trim()).filter(Boolean))];
      const resolved = await window.sage.resolveFittingTypeNamesLocal(names);
      if (cancelled) return;
      const idByName = new Map((Array.isArray(resolved) ? resolved : []).map((row) => [String(row.name ?? "").trim().toLowerCase(), Number(row.id)]));
      let changed = false;
      setDoctrines((current) => current.map((doctrine) => ({
        ...doctrine,
        fits: doctrine.fits.map((fit) => {
          const repairedId = idByName.get(String(fit.hullName ?? "").trim().toLowerCase());
          if (!(Number(repairedId) > 0) || Number(repairedId) === Number(fit.hullTypeId)) return fit;
          changed = true;
          return { ...fit, hullTypeId: Number(repairedId), fit: fit.fit?.hull ? { ...fit.fit, hull: { ...fit.fit.hull, typeId: Number(repairedId) } } : fit.fit };
        }),
      })));
      if (changed) setMessage("Doctrine ship identities repaired from Sage's local type data.");
    })().catch(() => { if (!cancelled) setMessage("Doctrine ship image lookup could not be repaired yet; saved fits were left intact."); });
    return () => { cancelled = true; };
  }, [corporation.corporationId, doctrineHullSignature]);

  const selected = useMemo(
    () => doctrines.find((item) => item.id === selectedDoctrineId) ?? doctrines[0] ?? null,
    [doctrines, selectedDoctrineId],
  );

  function updateDoctrine(id: string, patch: Partial<DoctrineRecord>) {
    setDoctrines((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }

  function createDoctrine(select = true) {
    const result = appendDoctrine(doctrines);
    setDoctrines(result.records);
    if (select) setSelectedDoctrineId(result.created.id);
    setMessage(`${result.created.name} created.`);
    return result.created;
  }

  function deleteDoctrine(doctrine: DoctrineRecord) {
    if (!window.confirm(`Delete ${doctrine.name || `Doctrine ${doctrine.slot}`}? Its local fits, notes and assignments will be removed.`)) return;
    const next = removeDoctrineById(doctrines, doctrine.id);
    setDoctrines(next);
    const nextSelected = next.find((item) => item.id !== doctrine.id) ?? next[0];
    setSelectedDoctrineId(nextSelected?.id ?? "");
    setTacticalDoctrineId((current) => current === doctrine.id ? null : current);
    setMessage(`${doctrine.name || `Doctrine ${doctrine.slot}`} deleted.`);
  }

  function addPendingFit() {
    if (!pending) return;
    let target = doctrines.find((item) => item.id === targetDoctrineId);
    let nextRecords = doctrines;
    if (!target) {
      const result = appendDoctrine(doctrines);
      target = result.created;
      nextRecords = result.records;
    }
    const fit = pending.fit ?? {};
    const fitId = String(fit.id ?? crypto.randomUUID());
    const nextFit: DoctrineFit = {
      id: fitId,
      fitName: String(fit.name ?? "Unnamed fit"),
      hullName: String(fit.hull?.name ?? "Unknown hull"),
      hullTypeId: Number(fit.hull?.typeId ?? 0),
      fit: JSON.parse(JSON.stringify(fit)),
      addedAt: new Date().toISOString(),
    };
    const desiredName = pendingName.trim() || target.name || pending.doctrineName || `Doctrine ${target.slot}`;
    const updated: DoctrineRecord = {
      ...target,
      name: desiredName,
      fits: [...target.fits.filter((item) => item.id !== fitId), nextFit],
      updatedAt: new Date().toISOString(),
    };
    setDoctrines(nextRecords.map((item) => item.id === target!.id ? updated : item));
    setSelectedDoctrineId(updated.id);
    setTargetDoctrineId(updated.id);
    sessionStorage.removeItem(PENDING_DOCTRINE_FIT_KEY);
    setPending(null);
    setMessage(`${nextFit.fitName} added to ${updated.name}.`);
  }

  function removeFit(doctrineId: string, fitId: string) {
    const doctrine = doctrines.find((item) => item.id === doctrineId);
    if (!doctrine) return;
    updateDoctrine(doctrineId, { fits: doctrine.fits.filter((item) => item.id !== fitId) });
  }

  function publishDraft(doctrine: DoctrineRecord) {
    if (!doctrine.fits.length) return;
    setMessage(`${doctrine.name} is ready to publish. The verified Sage Online corporation workspace is the next connection before this button transmits anything.`);
  }

  return (
    <div className="corp-data-view doctrine-view">
      <div className="doctrine-heading">
        <div>
          <p className="eyebrow">FLEET COMMAND · DOCTRINES</p>
          <h3>Doctrine Library</h3>
          <p>One doctrine in focus at a time. Add as many doctrines and complete Sage fittings as your corporation needs.</p>
        </div>
        <div className="doctrine-capacity">
          <strong>{doctrines.reduce((sum, item) => sum + item.fits.length, 0)}</strong>
          <span>stored fleet fits</span>
        </div>
      </div>

      <div className="doctrine-selector-bar">
        <div className="doctrine-selector-strip">
          {doctrines.map((doctrine) => (
            <button
              key={doctrine.id}
              type="button"
              className={doctrine.id === selected?.id ? "active" : ""}
              onClick={() => setSelectedDoctrineId(doctrine.id)}
            >
              <strong>{doctrine.name || `Doctrine ${doctrine.slot}`}</strong>
              <small>{doctrine.fits.length} fit{doctrine.fits.length === 1 ? "" : "s"}</small>
            </button>
          ))}
        </div>
        <button className="doctrine-new-button" type="button" onClick={() => createDoctrine(true)}>+ New Doctrine</button>
      </div>

      {pending && (
        <div className="doctrine-import-banner">
          <div className="doctrine-import-ship">
            {Number(pending.fit?.hull?.typeId ?? 0) > 0 ? <img src={assetUrl(Number(pending.fit.hull.typeId))} alt="" /> : <span>+</span>}
          </div>
          <div className="doctrine-import-copy">
            <span>FIT EXPORTED FROM FITTER</span>
            <strong>{String(pending.fit?.name ?? "Unnamed fit")}</strong>
            <small>{String(pending.fit?.hull?.name ?? "Unknown hull")}</small>
          </div>
          <label>Doctrine name<input value={pendingName} onChange={(event) => setPendingName(event.target.value)} /></label>
          <label>
            Target doctrine
            <select value={targetDoctrineId} onChange={(event) => setTargetDoctrineId(event.target.value)}>
              {doctrines.map((item) => <option key={item.id} value={item.id}>{item.name || `Doctrine ${item.slot}`} · {item.fits.length} fits</option>)}
              <option value="">+ Create new doctrine</option>
            </select>
          </label>
          <button onClick={addPendingFit}>Add fit to doctrine</button>
          <button className="doctrine-import-cancel" onClick={() => { sessionStorage.removeItem(PENDING_DOCTRINE_FIT_KEY); setPending(null); }}>Cancel</button>
        </div>
      )}

      {selected && (
        <article className={`doctrine-slot-card ${selected.fits.length ? "occupied" : "empty"}`} key={selected.id}>
          <div className="doctrine-slot-head">
            <div className="doctrine-slot-number"><span>DOCTRINE</span><strong>{String(selected.slot).padStart(2, "0")}</strong></div>
            <div className="doctrine-slot-title">
              <input value={selected.name} onChange={(event) => updateDoctrine(selected.id, { name: event.target.value })} placeholder={`Doctrine ${selected.slot} name…`} />
              <small>{selected.fits.length} fits{selected.updatedAt ? ` · updated ${formatDate(selected.updatedAt)}` : ""}</small>
            </div>
            <div className="doctrine-slot-actions">
              <button className="doctrine-tactical-button" onClick={() => setTacticalDoctrineId(selected.id)} disabled={!selected.fits.length}>Tactical Map</button>
              <button onClick={() => publishDraft(selected)} disabled={!selected.fits.length}>Publish to Members</button>
              <button className="danger" onClick={() => deleteDoctrine(selected)}>Delete Doctrine</button>
            </div>
          </div>

          <div className="doctrine-slot-body">
            {selected.fits.length ? (
              <div className="doctrine-fit-grid">
                {selected.fits.map((fit) => (
                  <div className="doctrine-fit-tile" key={fit.id}>
                    <div className="doctrine-fit-image">
                      {fit.hullTypeId > 0 ? <img src={assetUrl(fit.hullTypeId)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("image-fallback"); }} /> : <span>?</span>}
                      <button title="Remove fit" onClick={() => removeFit(selected.id, fit.id)}>×</button>
                    </div>
                    <strong>{fit.hullName}</strong>
                    <small>{fit.fitName}</small>
                  </div>
                ))}
              </div>
            ) : <div className="industrial-notice">No fleet fits in this doctrine yet. Export a fit from Fitting Command to add it here.</div>}

            <label className="doctrine-notes">
              <span>Doctrine notes / FC instructions</span>
              <textarea value={selected.notes} onChange={(event) => updateDoctrine(selected.id, { notes: event.target.value })} placeholder="Form-up rules, ammo, anchors, engagement notes, replacement policy, special instructions…" />
            </label>
          </div>
        </article>
      )}

      <div className="system-status">{message}</div>
      {tacticalDoctrineId != null && (() => {
        const doctrine = doctrines.find((item) => item.id === tacticalDoctrineId);
        return doctrine ? (
          <DoctrineTacticalMap
            doctrine={doctrine}
            corporation={corporation}
            snapshots={snapshots}
            onAssignmentsChange={(assignments) => updateDoctrine(doctrine.id, { assignments })}
            onClose={() => setTacticalDoctrineId(null)}
          />
        ) : null;
      })()}
    </div>
  );
}
