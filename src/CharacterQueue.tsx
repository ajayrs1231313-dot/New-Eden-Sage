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

export function CharacterQueue({ snapshot }: { snapshot?: CharacterSnapshot }) {
  if (!snapshot) return <section className="empty"><p className="eyebrow">NO CAPSULEER SELECTED</p><h2>Connect a character to view the queue</h2></section>;
  const skillNames = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill.name ?? `Skill ${skill.skill_id}`]));
  const queue = [...snapshot.queue].sort((a, b) => Date.parse(a.finish_date ?? "") - Date.parse(b.finish_date ?? ""));
  const lastFinish = queue.map((item) => item.finish_date).filter(Boolean).map((value) => Date.parse(value!)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const total = lastFinish ? compactDuration(lastFinish - Date.now()) : "No active finish time";

  return <section className="character-queue-workspace">
    <div className="character-queue-summary">
      <article><span>QUEUE STATUS</span><strong>{queue.length} item{queue.length === 1 ? "" : "s"} queued</strong><small>Live ESI training queue</small></article>
      <article><span>QUEUE TOTAL</span><strong>{total}</strong><small>Remaining from now</small></article>
    </div>
    <article className="character-queue-panel">
      <div className="character-queue-title"><div><p className="eyebrow">QUEUED TRAINING</p><h3>Current skill queue</h3></div><small>Dates shown in local time</small></div>
      {queue.length ? <div className="character-queue-scroll">
        <div className="character-queue-table">
          <div className="character-queue-row heading"><span>Skill</span><span>Target</span><span>Start</span><span>Finish</span></div>
          {queue.map((item, index) => <div className="character-queue-row" key={`${item.skill_id}-${item.finished_level}-${index}`}>
            <span className="skill"><strong>{skillNames.get(item.skill_id) ?? `Skill ${item.skill_id}`}</strong><small>Queue position {index + 1}</small></span>
            <span className="target">Level {item.finished_level}</span>
            <span className="date">{dateTime(item.start_date)}</span>
            <span className="date finish">{dateTime(item.finish_date)}</span>
          </div>)}
        </div>
      </div> : <div className="character-queue-empty">No skills are currently queued.</div>}
    </article>
  </section>;
}