import { useEffect, useMemo, useState } from "react";
import type { EveMailHeader, EveMailMailbox, EveMailMessage } from "./types";
import "./eve-mail.css";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="m5 7 7 6 7-6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 8a7 7 0 1 0 1 6" />
      <path d="M19 4v4h-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4l10-10-4-4L5 15v4Z" />
      <path d="m13.5 6.5 4 4M4 20h16" />
    </svg>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const age = Date.now() - date.getTime();
  if (age < 24 * 60 * 60 * 1000) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (age < 7 * 24 * 60 * 60 * 1000) return date.toLocaleDateString("en-GB", { weekday: "short" });
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function eveHtmlToText(value: string) {
  const source = String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/tr\s*>/gi, "\n");
  try {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return String(doc.body.textContent ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return source.replace(/<[^>]*>/g, "").trim();
  }
}

type Filter = "inbox" | "sent" | "unread" | "all";

export function EveMailPanel({
  characterId,
  characterName,
  onReconnect,
}: {
  characterId: string;
  characterName: string;
  onReconnect?: () => void | Promise<void>;
}) {
  const [mailbox, setMailbox] = useState<EveMailMailbox | null>(null);
  const [filter, setFilter] = useState<Filter>("inbox");
  const [selectedMailId, setSelectedMailId] = useState<number | null>(null);
  const [message, setMessage] = useState<EveMailMessage | null>(null);
  const [compose, setCompose] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Loading EVE Mail…");
  const [busy, setBusy] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const filtered = useMemo(() => {
    const rows = mailbox?.headers ?? [];
    if (filter === "sent") return rows.filter((row) => row.direction === "sent");
    if (filter === "unread") return rows.filter((row) => row.direction === "received" && !row.isRead);
    if (filter === "all") return rows;
    return rows.filter((row) => row.direction === "received");
  }, [mailbox, filter]);

  const selectedHeader = useMemo(
    () => mailbox?.headers.find((row) => row.mailId === selectedMailId) ?? null,
    [mailbox, selectedMailId],
  );

  function noteError(error: unknown, fallback: string) {
    const text = error instanceof Error ? error.message : fallback;
    setStatus(text);
    if (/reconnect/i.test(text) || /permission/i.test(text) || /scope/i.test(text)) setNeedsReconnect(true);
  }

  async function load(keepSelection = true) {
    setBusy(true);
    setNeedsReconnect(false);
    try {
      const next = await window.sage.getEveMailbox({ characterId, limit: 250 });
      setMailbox(next);
      const current = keepSelection ? selectedMailId : null;
      const visible = next.headers.filter((row) =>
        filter === "all"
          || (filter === "sent" ? row.direction === "sent"
          : filter === "unread" ? row.direction === "received" && !row.isRead
          : row.direction === "received"),
      );
      const nextSelected = current && next.headers.some((row) => row.mailId === current)
        ? current
        : visible[0]?.mailId ?? null;
      setSelectedMailId(nextSelected);
      if (!keepSelection) setMessage(null);
      setStatus(next.headers.length ? "" : "No EVE Mail returned for this character.");
      return next;
    } catch (error) {
      setMailbox(null);
      setSelectedMailId(null);
      setMessage(null);
      noteError(error, "EVE Mail could not be loaded.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, [characterId]);

  useEffect(() => {
    if (compose) return;
    const next = filtered[0]?.mailId ?? null;
    if (selectedMailId == null || !filtered.some((row) => row.mailId === selectedMailId)) {
      setSelectedMailId(next);
      setMessage(null);
    }
  }, [filter, mailbox]);

  async function openMail(header: EveMailHeader) {
    setCompose(false);
    setSelectedMailId(header.mailId);
    setBusy(true);
    try {
      const detail = await window.sage.getEveMailMessage({ characterId, mailId: header.mailId });
      setMessage(detail);
      setStatus("");
      if (!header.isRead && header.direction === "received" && mailbox?.capabilities.organize) {
        try {
          await window.sage.markEveMailRead({ characterId, mailId: header.mailId, labels: header.labels });
          setMailbox((current) => current ? {
            ...current,
            unread: Math.max(0, current.unread - 1),
            headers: current.headers.map((row) => row.mailId === header.mailId ? { ...row, isRead: true } : row),
          } : current);
          setMessage((current) => current ? { ...current, isRead: true } : current);
        } catch {
          // Reading still succeeds even if EVE refuses the organize update.
        }
      }
    } catch (error) {
      noteError(error, "EVE Mail message could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  function startCompose(prefill?: { recipient?: string; subject?: string }) {
    setCompose(true);
    setSelectedMailId(null);
    setMessage(null);
    setRecipients(prefill?.recipient ?? "");
    setSubject(prefill?.subject ?? "");
    setBody("");
    setStatus("");
  }

  async function send() {
    const to = recipients.split(/[;,\n]+/).map((value) => value.trim()).filter(Boolean);
    if (!to.length || !subject.trim() || !body.trim()) {
      setStatus("Enter at least one EVE recipient, a subject, and a message.");
      return;
    }
    setBusy(true);
    setNeedsReconnect(false);
    setStatus("Sending through EVE ESI…");
    try {
      await window.sage.sendEveMail({
        characterId,
        recipients: to,
        subject: subject.trim(),
        body: body.trim(),
      });
      setCompose(false);
      setFilter("sent");
      setRecipients("");
      setSubject("");
      setBody("");
      setStatus("EVE Mail sent.");
      await load(false);
    } catch (error) {
      noteError(error, "EVE Mail could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(header: EveMailHeader) {
    if (!mailbox?.capabilities.organize) {
      setStatus("Reconnect this character to allow Sage to delete or organize EVE Mail.");
      setNeedsReconnect(true);
      return;
    }
    setBusy(true);
    try {
      await window.sage.deleteEveMail({ characterId, mailId: header.mailId });
      setMessage(null);
      setSelectedMailId(null);
      setStatus("EVE Mail deleted.");
      await load(false);
    } catch (error) {
      noteError(error, "EVE Mail could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const current = message ?? selectedHeader;
  const recipientNames = current?.recipients.map((row) => row.name).join(", ") ?? "";
  const matchingLabels = current
    ? (mailbox?.labels ?? []).filter((label) => current.labels.includes(label.labelId))
    : [];

  return (
    <>
      <div className="sage-mail-toolbar eve-mail-toolbar">
        <div className="sage-mail-folder-tabs eve-mail-folder-tabs">
          {([
            ["inbox", "Inbox"],
            ["sent", "Sent"],
            ["unread", "Unread"],
            ["all", "All mail"],
          ] as Array<[Filter, string]>).map(([key, label]) => (
            <button key={key} className={filter === key && !compose ? "active" : ""} onClick={() => { setFilter(key); setCompose(false); }}>
              {label}
              {key === "unread" && mailbox?.unread ? <b>{mailbox.unread}</b> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`sage-mail-compose-button${compose ? " active" : ""}`}
          onClick={() => startCompose()}
          disabled={Boolean(mailbox && !mailbox.capabilities.send)}
          title={mailbox?.capabilities.send ? "Compose EVE Mail" : "Reconnect this character to enable EVE Mail sending"}
        >
          <ComposeIcon />
          New EVE mail
        </button>
        <button className="sage-mail-refresh" type="button" onClick={() => void load(true)} disabled={busy} title="Refresh EVE Mail">
          <RefreshIcon />
        </button>
        <div className="eve-mail-capabilities">
          <span className={mailbox?.capabilities.read ? "ready" : "missing"}>READ</span>
          <span className={mailbox?.capabilities.send ? "ready" : "missing"}>SEND</span>
          <span className={mailbox?.capabilities.organize ? "ready" : "missing"}>MANAGE</span>
          <small>Direct EVE SSO / ESI · {mailbox?.headers.length ?? 0} headers loaded</small>
        </div>
      </div>

      <div className="sage-mail-body eve-mail-body">
        <aside className="sage-mail-list">
          <div className="sage-mail-list-head">
            <div>
              <span>{filter.toUpperCase()}</span>
              <strong>{filtered.length} EVE mail{filtered.length === 1 ? "" : "s"}</strong>
            </div>
            {busy && <i className="sage-mail-busy-orb" aria-label="Loading" />}
          </div>
          <div className="sage-mail-list-scroll">
            {filtered.map((entry) => {
              const unread = entry.direction === "received" && !entry.isRead;
              const counterpart = entry.direction === "sent"
                ? entry.recipients.map((row) => row.name).join(", ") || "Recipients"
                : entry.fromName;
              return (
                <button
                  type="button"
                  key={entry.mailId}
                  className={`sage-mail-list-row eve-mail-row${selectedMailId === entry.mailId && !compose ? " selected" : ""}${unread ? " unread" : ""}`}
                  onClick={() => void openMail(entry)}
                >
                  <span className={`sage-mail-kind ${entry.direction === "sent" ? "eve-sent" : "eve-received"}`}>
                    {entry.direction === "sent" ? "SENT" : "EVE"}
                  </span>
                  <div className="sage-mail-row-copy">
                    <strong>{counterpart}</strong>
                    <span>{entry.subject}</span>
                  </div>
                  <time>{formatTime(entry.timestamp)}</time>
                  {unread && <i className="sage-mail-unread-dot" />}
                </button>
              );
            })}
            {!busy && !filtered.length && <div className="sage-mail-empty-list">{status || "No EVE Mail in this view."}</div>}
          </div>
        </aside>

        <main className="sage-mail-reader eve-mail-reader">
          {compose ? (
            <div className="sage-mail-compose eve-mail-compose">
              <div className="sage-mail-reader-kicker">EVE MAIL · {characterName.toUpperCase()}</div>
              <h2>Compose EVE Mail</h2>
              {!mailbox?.capabilities.send && (
                <div className="eve-mail-scope-warning">
                  <div>
                    <strong>EVE MAIL SEND PERMISSION REQUIRED</strong>
                    <span>This character was connected before Sage requested EVE's send-mail scope.</span>
                  </div>
                  {onReconnect && <button type="button" onClick={() => void onReconnect()}>Reconnect character</button>}
                </div>
              )}
              <div className="sage-mail-compose-grid eve-mail-compose-grid">
                <label>
                  <span>TO</span>
                  <input
                    value={recipients}
                    onChange={(event) => setRecipients(event.target.value)}
                    placeholder="Character, corporation, alliance or mailing list · separate multiple with commas"
                  />
                </label>
                <label>
                  <span>SUBJECT</span>
                  <input maxLength={1000} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="EVE Mail subject" />
                </label>
              </div>
              <label className="sage-mail-message-field">
                <span>MESSAGE</span>
                <textarea maxLength={9000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write EVE Mail…" />
                <small>{body.length.toLocaleString()} / 9,000 plain-text characters</small>
              </label>
              <div className="eve-mail-compose-note">
                Names are resolved through EVE. Sage also matches your EVE mailing lists. Plain text is safely converted to EVE mail formatting before sending.
              </div>
              <div className="sage-mail-compose-actions">
                <button type="button" className="secondary" onClick={() => setCompose(false)} disabled={busy}>Cancel</button>
                <button type="button" className="primary" onClick={() => void send()} disabled={busy || !mailbox?.capabilities.send || !recipients.trim() || !subject.trim() || !body.trim()}>
                  <MailIcon />
                  {busy ? "Sending…" : "Send through EVE"}
                </button>
              </div>
            </div>
          ) : current ? (
            <article className="sage-mail-message eve-mail-message">
              <div className="sage-mail-reader-kicker">EVE MAIL · {current.direction === "sent" ? "SENT" : current.isRead ? "READ" : "UNREAD"}</div>
              <h2>{current.subject}</h2>
              <div className="sage-mail-message-meta">
                <div><span>FROM</span><strong>{current.fromName}</strong></div>
                <div><span>TO</span><strong>{recipientNames || "—"}</strong></div>
                <div><span>TIME</span><strong>{current.timestamp ? new Date(current.timestamp).toLocaleString("en-GB") : "—"}</strong></div>
              </div>
              {matchingLabels.length > 0 && (
                <div className="eve-mail-labels">
                  {matchingLabels.map((label) => <span key={label.labelId}>{label.name}</span>)}
                </div>
              )}
              <div className="sage-mail-message-copy eve-mail-message-copy">
                {message ? eveHtmlToText(message.body) || "(empty message)" : busy ? "Loading message…" : "Select this message to load its body from EVE."}
              </div>
              <div className="sage-mail-message-actions">
                {current.direction === "received" && current.fromName && current.from && (
                  <button type="button" onClick={() => startCompose({
                    recipient: current.fromName,
                    subject: current.subject.toLowerCase().startsWith("re:") ? current.subject : `Re: ${current.subject}`,
                  })}>
                    Reply
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void remove(current)} disabled={busy || !mailbox?.capabilities.organize}>
                  <TrashIcon />
                  Delete from EVE
                </button>
              </div>
            </article>
          ) : (
            <div className="sage-mail-reader-empty">
              <MailIcon />
              <span>{busy ? "Synchronising EVE Mail…" : status || "Select an EVE Mail or compose a new one."}</span>
            </div>
          )}

          {(status || needsReconnect || (mailbox && (!mailbox.capabilities.send || !mailbox.capabilities.organize))) && (
            <div className={`sage-mail-status eve-mail-status${needsReconnect ? " warning" : ""}`}>
              <span>{status || (!mailbox?.capabilities.send || !mailbox?.capabilities.organize
                ? "Reconnect this character once to enable EVE Mail sending and mailbox management."
                : "")}</span>
              {(needsReconnect || (mailbox && (!mailbox.capabilities.send || !mailbox.capabilities.organize))) && onReconnect && (
                <button type="button" onClick={() => void onReconnect()}>Reconnect</button>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
