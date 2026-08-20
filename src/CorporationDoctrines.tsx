import { useEffect, useState } from "react";
import { DoctrineTacticalMap } from "./DoctrineTacticalMap";

export type DoctrineCorporation = {
  corporationId: number;
  name: string;
  data?: any;
};

type DoctrineFit = {
  id: string;
  fitName: string;
  hullName: string;
  hullTypeId: number;
  fit: any;
  addedAt: string;
};

type DoctrineSlot = {
  slot: number;
  name: string;
  notes: string;
  fits: DoctrineFit[];
  updatedAt: string | null;
  publishedObjectId?: string;
  publishedVersion?: number;
  assignments?: Record<string, string>;
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

function assetUrl(typeId: number, size = 128) {
  return typeId > 0 ? `sage-asset://type/${typeId}/render?size=${size}` : "";
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function emptyDoctrineSlots(): DoctrineSlot[] {
  return Array.from({ length: 5 }, (_, index) => ({
    slot: index + 1,
    name: "",
    notes: "",
    fits: [],
    updatedAt: null,
  }));
}

function loadDoctrineSlots(corporationId: number): DoctrineSlot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(doctrineStorageKey(corporationId)) ?? "[]") as DoctrineSlot[];
    const bySlot = new Map((Array.isArray(parsed) ? parsed : []).map((item) => [Number(item.slot), item]));
    return emptyDoctrineSlots().map((blank) => {
      const saved = bySlot.get(blank.slot);
      return saved
        ? { ...blank, ...saved, slot: blank.slot, fits: Array.isArray(saved.fits) ? saved.fits.slice(0, 10) : [], assignments: saved.assignments && typeof saved.assignments === "object" ? saved.assignments : {} }
        : blank;
    });
  } catch {
    return emptyDoctrineSlots();
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
  const [slots, setSlots] = useState<DoctrineSlot[]>(() => loadDoctrineSlots(corporation.corporationId));
  const [pending, setPending] = useState<PendingDoctrineFit | null>(() => {
    const queued = readPending();
    return queued && (!queued.corporationId || Number(queued.corporationId) === corporation.corporationId) ? queued : null;
  });
  const [targetSlot, setTargetSlot] = useState(() => Number(pending?.targetSlot ?? 1));
  const [pendingName, setPendingName] = useState(pending?.doctrineName ?? "");
  const [message, setMessage] = useState("Five corporation doctrine slots · up to ten ship fits per doctrine.");
  const [tacticalSlot, setTacticalSlot] = useState<number | null>(null);

  useEffect(() => {
    const loaded = loadDoctrineSlots(corporation.corporationId);
    setSlots(loaded);
    const queued = readPending();
    if (queued && (!queued.corporationId || Number(queued.corporationId) === corporation.corporationId)) {
      setPending(queued);
      setPendingName(queued.doctrineName);
      const matching = loaded.find(
        (item) => item.name.trim().toLowerCase() === queued.doctrineName.trim().toLowerCase() && item.fits.length < 10,
      );
      const empty = loaded.find((item) => !item.name && item.fits.length < 10);
      const preferred = loaded.find((item) => item.slot === Number(queued.targetSlot) && item.fits.length < 10);
      const available = preferred ?? matching ?? empty ?? loaded.find((item) => item.fits.length < 10);
      if (available) setTargetSlot(available.slot);
    } else {
      setPending(null);
    }
  }, [corporation.corporationId]);

  useEffect(() => {
    localStorage.setItem(doctrineStorageKey(corporation.corporationId), JSON.stringify(slots));
  }, [corporation.corporationId, slots]);

  function updateSlot(slotNumber: number, patch: Partial<DoctrineSlot>) {
    setSlots((current) =>
      current.map((item) =>
        item.slot === slotNumber ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
      ),
    );
  }

  function addPendingFit() {
    if (!pending) return;
    const slot = slots.find((item) => item.slot === targetSlot);
    if (!slot) return;
    if (slot.fits.length >= 10) {
      setMessage(`Doctrine slot ${targetSlot} already has ten fits.`);
      return;
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
    const withoutDuplicate = slot.fits.filter((item) => item.id !== fitId);
    const name = pendingName.trim() || slot.name || pending.doctrineName || "Unnamed doctrine";
    updateSlot(slot.slot, { name, fits: [...withoutDuplicate, nextFit].slice(0, 10) });
    sessionStorage.removeItem(PENDING_DOCTRINE_FIT_KEY);
    setPending(null);
    setMessage(`${nextFit.fitName} added to ${name}.`);
  }

  function removeFit(slotNumber: number, fitId: string) {
    const slot = slots.find((item) => item.slot === slotNumber);
    if (!slot) return;
    updateSlot(slotNumber, { fits: slot.fits.filter((item) => item.id !== fitId) });
  }

  function clearSlot(slotNumber: number) {
    if (!window.confirm(`Clear Doctrine ${slotNumber}? This removes its local name, notes and fits.`)) return;
    setSlots((current) =>
      current.map((item) =>
        item.slot === slotNumber
          ? { slot: slotNumber, name: "", notes: "", fits: [], updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }

  function publishDraft(slot: DoctrineSlot) {
    if (!slot.fits.length) return;
    setMessage(
      `${slot.name || `Doctrine ${slot.slot}`} is ready to publish. The verified Sage Online corporation workspace is the next connection before this button transmits anything.`,
    );
  }

  return (
    <div className="corp-data-view doctrine-view">
      <div className="doctrine-heading">
        <div>
          <p className="eyebrow">CORPORATION · FLEET DOCTRINES</p>
          <h3>Doctrine Library</h3>
          <p>Five doctrine slots. Each doctrine can carry up to ten complete Sage fittings plus its own fleet notes.</p>
        </div>
        <div className="doctrine-capacity">
          <strong>{slots.reduce((sum, item) => sum + item.fits.length, 0)} / 50</strong>
          <span>fit positions used</span>
        </div>
      </div>

      {pending && (
        <div className="doctrine-import-banner">
          <div className="doctrine-import-ship">
            {Number(pending.fit?.hull?.typeId ?? 0) > 0 ? (
              <img src={assetUrl(Number(pending.fit.hull.typeId))} alt="" />
            ) : (
              <span>+</span>
            )}
          </div>
          <div className="doctrine-import-copy">
            <span>FIT EXPORTED FROM FITTER</span>
            <strong>{String(pending.fit?.name ?? "Unnamed fit")}</strong>
            <small>{String(pending.fit?.hull?.name ?? "Unknown hull")}</small>
          </div>
          <label>
            Doctrine name
            <input value={pendingName} onChange={(event) => setPendingName(event.target.value)} />
          </label>
          <label>
            Doctrine slot
            <select value={targetSlot} onChange={(event) => setTargetSlot(Number(event.target.value))}>
              {slots.map((item) => (
                <option key={item.slot} value={item.slot} disabled={item.fits.length >= 10}>
                  Slot {item.slot}{item.name ? ` · ${item.name}` : " · Empty"} ({item.fits.length}/10)
                </option>
              ))}
            </select>
          </label>
          <button onClick={addPendingFit}>Add fit to doctrine</button>
          <button
            className="doctrine-import-cancel"
            onClick={() => {
              sessionStorage.removeItem(PENDING_DOCTRINE_FIT_KEY);
              setPending(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="doctrine-slot-list">
        {slots.map((slot) => (
          <article className={`doctrine-slot-card ${slot.fits.length ? "occupied" : "empty"}`} key={slot.slot}>
            <div className="doctrine-slot-head">
              <div className="doctrine-slot-number">
                <span>DOCTRINE</span>
                <strong>{String(slot.slot).padStart(2, "0")}</strong>
              </div>
              <div className="doctrine-slot-title">
                <input
                  value={slot.name}
                  onChange={(event) => updateSlot(slot.slot, { name: event.target.value })}
                  placeholder={`Doctrine ${slot.slot} name…`}
                />
                <small>
                  {slot.fits.length}/10 fits
                  {slot.updatedAt ? ` · updated ${formatDate(slot.updatedAt)}` : " · unused slot"}
                </small>
              </div>
              <div className="doctrine-slot-actions">
                <button className="doctrine-tactical-button" onClick={() => setTacticalSlot(slot.slot)} disabled={!slot.fits.length}>Tactical Map</button>
                <button onClick={() => publishDraft(slot)} disabled={!slot.fits.length}>Publish to Members</button>
                <button
                  className="danger"
                  onClick={() => clearSlot(slot.slot)}
                  disabled={!slot.name && !slot.notes && !slot.fits.length}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="doctrine-slot-body">
              <div className="doctrine-fit-grid">
                {Array.from({ length: 10 }, (_, index) => {
                  const fit = slot.fits[index];
                  return fit ? (
                    <div className="doctrine-fit-tile" key={fit.id}>
                      <div className="doctrine-fit-image">
                        {fit.hullTypeId > 0 ? <img src={assetUrl(fit.hullTypeId)} alt="" /> : <span>?</span>}
                        <button title="Remove fit" onClick={() => removeFit(slot.slot, fit.id)}>×</button>
                      </div>
                      <strong>{fit.hullName}</strong>
                      <small>{fit.fitName}</small>
                    </div>
                  ) : (
                    <div className="doctrine-fit-tile placeholder" key={index}>
                      <div className="doctrine-fit-image"><span>+</span></div>
                      <strong>Fit {index + 1}</strong>
                      <small>Empty</small>
                    </div>
                  );
                })}
              </div>

              <label className="doctrine-notes">
                <span>Doctrine notes / FC instructions</span>
                <textarea
                  value={slot.notes}
                  onChange={(event) => updateSlot(slot.slot, { notes: event.target.value })}
                  placeholder="Form-up rules, ammo, anchors, engagement notes, replacement policy, special instructions…"
                />
              </label>
            </div>
          </article>
        ))}
      </div>

      <div className="system-status">{message}</div>
      {tacticalSlot != null && (() => {
        const doctrine = slots.find((item) => item.slot === tacticalSlot);
        return doctrine ? (
          <DoctrineTacticalMap
            doctrine={doctrine}
            corporation={corporation}
            snapshots={snapshots}
            onAssignmentsChange={(assignments) => updateSlot(doctrine.slot, { assignments })}
            onClose={() => setTacticalSlot(null)}
          />
        ) : null;
      })()}
    </div>
  );
}
