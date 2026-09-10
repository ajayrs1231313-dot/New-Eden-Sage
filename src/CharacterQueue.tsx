import type { CharacterSnapshot } from "./types";

function compactDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function dateTime(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type QueueGlyphKind = "drone" | "missile" | "navigation" | "generic";
type QueueSummaryGlyphKind = "stack" | "clock" | "list";

function queueGlyphKind(name: string): QueueGlyphKind {
  const value = name.toLowerCase();
  if (value.includes("drone")) return "drone";
  if (value.includes("navigation") || value.includes("target")) return "navigation";
  if (value.includes("missile") || value.includes("warhead") || value.includes("rocket")) return "missile";
  return "generic";
}

function QueueGlyph({ kind }: { kind: QueueGlyphKind }) {
  if (kind === "drone") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="4"/><path d="M16 4v7M16 21v7M4 16h7M21 16h7M7.5 7.5l5 5M19.5 19.5l5 5M24.5 7.5l-5 5M12.5 19.5l-5 5"/><circle className="queue-glyph-orbit" cx="16" cy="16" r="11"/></svg>;
  if (kind === "navigation") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="4"/><circle className="queue-glyph-orbit" cx="16" cy="16" r="10"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M8.2 8.2l2.8 2.8M21 21l2.8 2.8M23.8 8.2L21 11M11 21l-2.8 2.8"/></svg>;
  if (kind === "missile") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20.4 4.8c3.1.4 5.2 2.5 5.6 5.6L14.7 21.7l-6.4 1.9 1.9-6.4L20.4 4.8Z"/><path d="m9.7 21.8-4 4M13.3 24.1l-1.1 4.2M7.4 18.4l-4.2 1.1"/><circle cx="20.6" cy="10.4" r="2.2"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 6.5h11.8L24 10.7v14.8H8z"/><path d="M19.8 6.5v4.2H24M11.5 15h9M11.5 19h9M11.5 23h6"/></svg>;
}

function QueueSummaryGlyph({ kind }: { kind: QueueSummaryGlyphKind }) {
  if (kind === "clock") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10.5"/><path d="M16 9.5v7l4.5 2.5"/></svg>;
  if (kind === "list") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12 9h13M12 16h13M12 23h13"/><circle cx="7" cy="9" r="1.5"/><circle cx="7" cy="16" r="1.5"/><circle cx="7" cy="23" r="1.5"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 5 10 5.5L16 16 6 10.5 16 5Z"/><path d="m7 15.5 9 5 9-5M7 20.5l9 5 9-5"/></svg>;
}

export function CharacterQueue({ snapshot }: { snapshot?: CharacterSnapshot }) {
  if (!snapshot) return <section className="empty"><p className="eyebrow">NO CAPSULEER SELECTED</p><h2>Connect a character to view the queue</h2></section>;
  const skillNames = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill.name ?? `Skill ${skill.skill_id}`]));
  const queue = [...snapshot.queue].sort((a, b) => Date.parse(a.finish_date ?? "") - Date.parse(b.finish_date ?? ""));
  const lastFinish = queue.map((item) => item.finish_date).filter(Boolean).map((value) => Date.parse(value!)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const total = lastFinish ? compactDuration(lastFinish - Date.now()) : "No active finish time";

  return <section className="character-queue-workspace">
    <div className="character-queue-summary">
      <article className="queue-summary-card queue-summary-status">
        <span className="queue-summary-icon"><QueueSummaryGlyph kind="stack" /></span>
        <div className="queue-summary-copy"><span>QUEUE STATUS</span><strong>{queue.length} item{queue.length === 1 ? "" : "s"} queued</strong><small>Live ESI training queue</small></div>
      </article>
      <article className="queue-summary-card queue-summary-total">
        <span className="queue-summary-icon"><QueueSummaryGlyph kind="clock" /></span>
        <div className="queue-summary-copy"><span>QUEUE TOTAL</span><strong>{total}</strong><small>Remaining from now</small></div>
        <div className="queue-summary-rail" aria-hidden="true"><span>TRAIN</span><span>PLAN</span><span>PROGRESS</span></div>
      </article>
    </div>
    <article className="character-queue-panel">
      <div className="character-queue-title">
        <div className="character-queue-title-main"><span className="character-queue-title-icon"><QueueSummaryGlyph kind="list" /></span><div><p className="eyebrow">QUEUED TRAINING</p><h3>Current skill queue</h3></div></div>
        <small>Dates shown in local time</small>
      </div>
      {queue.length ? <div className="character-queue-scroll">
        <div className="character-queue-table">
          <div className="character-queue-row heading"><span>Skill</span><span>Target</span><span>Start</span><span>Finish</span><span aria-hidden="true" /></div>
          {queue.map((item, index) => {
            const name = skillNames.get(item.skill_id) ?? `Skill ${item.skill_id}`;
            return <div className="character-queue-row" key={`${item.skill_id}-${item.finished_level}-${index}`}>
              <span className="skill"><span className="skill-icon"><QueueGlyph kind={queueGlyphKind(name)} /></span><span className="skill-copy"><strong>{name}</strong><small>Queue position {index + 1}</small></span></span>
              <span className="target"><b>Level {item.finished_level}</b></span>
              <span className="date">{dateTime(item.start_date)}</span>
              <span className="date finish">{dateTime(item.finish_date)}</span>
              <span className="queue-row-chevron" aria-hidden="true">›</span>
            </div>;
          })}
        </div>
      </div> : <div className="character-queue-empty">No skills are currently queued.</div>}
    </article>
  </section>;
}
