import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  SageMailContact,
  SageMailDirectory,
  SageMailEntry,
  SageMailFolder,
  SageMailbox,
  SageMailQuota,
} from "./types";
import { EveMailPanel } from "./EveMailPanel";
import "./sage-mail.css";

type SageMailButtonProps = {
  characterId?: string;
  characterName?: string;
  onReconnect?: () => void | Promise<void>;
};

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="m5 7 7 6 7-6" />
      <path d="m5 17 5.3-5M19 17l-5.3-5" />
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" />
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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 8a7 7 0 1 0 1 6" />
      <path d="M19 4v4h-4" />
    </svg>
  );
}

function relationLabel(contact: SageMailContact) {
  const labels: string[] = [];
  if (contact.relationships.includes("corporation")) labels.push("CORP");
  if (contact.relationships.includes("contact")) labels.push("EVE FRIEND");
  if (contact.relationships.includes("account")) labels.push("ALT");
  return labels;
}

function formatMailTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const now = Date.now();
  const age = Math.max(0, now - date.getTime());
  if (age < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (age < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function kindLabel(kind: SageMailEntry["kind"]) {
  if (kind === "doctrine") return "DOCTRINE";
  if (kind === "production") return "PRODUCTION";
  if (kind === "system") return "SAGE";
  return "MAIL";
}

function quotaText(quota?: SageMailQuota | null) {
  if (!quota) return "— / 50";
  if (quota.premium || quota.limit == null) return `${quota.used} / ∞`;
  return `${quota.used} / ${quota.limit}`;
}

export function SageMailButton({ characterId, characterName, onReconnect }: SageMailButtonProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  async function refreshBadge() {
    if (!characterId) {
      setUnread(0);
      return;
    }
    try {
      const mailbox = await window.sage.getSageMailbox({ characterId, folder: "inbox" });
      setUnread(Number(mailbox.unread ?? 0));
    } catch {
      setUnread(0);
    }
  }

  useEffect(() => {
    void refreshBadge();
    if (!characterId) return;
    const timer = window.setInterval(() => void refreshBadge(), 45_000);
    return () => window.clearInterval(timer);
  }, [characterId]);

  useEffect(() => {
    setOpen(false);
  }, [characterId]);

  return (
    <>
      <button
        type="button"
        className={`cc-header-action cc-mail-action${unread ? " has-unread" : ""}`}
        onClick={() => setOpen(true)}
        disabled={!characterId}
        title={characterId ? `Open ${characterName ?? "selected character"}'s Sage Mail` : "Select a character to use Sage Mail"}
        aria-label={unread ? `Sage Mail, ${unread} unread` : "Sage Mail"}
      >
        <EnvelopeIcon />
        <span>Sage Mail</span>
        {unread > 0 && <b className="cc-mail-unread">{unread > 99 ? "99+" : unread}</b>}
      </button>
      {open && characterId && createPortal(
        <SageMailWindow
          characterId={characterId}
          characterName={characterName ?? "Selected character"}
          onClose={() => {
            setOpen(false);
            void refreshBadge();
          }}
          onUnreadChange={setUnread}
          onReconnect={onReconnect}
        />,
        document.body,
      )}
    </>
  );
}

function SageMailWindow({
  characterId,
  characterName,
  onClose,
  onUnreadChange,
  onReconnect,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
  onUnreadChange: (value: number) => void;
  onReconnect?: () => void | Promise<void>;
}) {
  const [channel, setChannel] = useState<"sage" | "eve">("sage");
  const [folder, setFolder] = useState<SageMailFolder>("inbox");
  const [mailbox, setMailbox] = useState<SageMailbox | null>(null);
  const [directory, setDirectory] = useState<SageMailDirectory | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [compose, setCompose] = useState(false);
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Loading mailbox…");
  const [busy, setBusy] = useState(false);
  const [directoryBusy, setDirectoryBusy] = useState(false);

  const selected = useMemo(
    () => mailbox?.messages.find((entry) => entry.entryId === selectedEntryId) ?? null,
    [mailbox, selectedEntryId],
  );

  const contacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    const source = directory?.contacts ?? [];
    return source.filter((contact) =>
      !query ||
      contact.characterName.toLowerCase().includes(query) ||
      relationLabel(contact).some((label) => label.toLowerCase().includes(query)),
    );
  }, [directory, contactSearch]);

  async function loadMailbox(nextFolder: SageMailFolder = folder, keepSelection = true) {
    setBusy(true);
    try {
      const next = await window.sage.getSageMailbox({ characterId, folder: nextFolder });
      setMailbox(next);
      onUnreadChange(Number(next.unread ?? 0));
      if (!keepSelection || !next.messages.some((entry) => entry.entryId === selectedEntryId)) {
        setSelectedEntryId(next.messages[0]?.entryId ?? null);
      }
      setStatus(next.messages.length ? "" : nextFolder === "inbox" ? "No mail in this character's inbox." : "No sent mail stored for this character.");
      return next;
    } catch (error) {
      setMailbox(null);
      setSelectedEntryId(null);
      setStatus(error instanceof Error ? error.message : "Sage Mail is unavailable.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadDirectory() {
    setDirectoryBusy(true);
    try {
      const next = await window.sage.getSageMailDirectory(characterId);
      setDirectory(next);
      return next;
    } catch (error) {
      setDirectory(null);
      setStatus(error instanceof Error ? error.message : "Sage Mail contacts could not be loaded.");
      return null;
    } finally {
      setDirectoryBusy(false);
    }
  }

  useEffect(() => {
    void loadMailbox("inbox", false);
    void loadDirectory();
  }, [characterId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function changeFolder(next: SageMailFolder) {
    if (next === folder) return;
    setFolder(next);
    setCompose(false);
    setSelectedEntryId(null);
    await loadMailbox(next, false);
  }

  async function openMessage(entry: SageMailEntry) {
    setCompose(false);
    setSelectedEntryId(entry.entryId);
    if (entry.folder === "inbox" && !entry.readAt) {
      try {
        await window.sage.markSageMailRead({ characterId, entryId: entry.entryId });
        setMailbox((current) => current ? {
          ...current,
          unread: Math.max(0, current.unread - 1),
          messages: current.messages.map((row) =>
            row.entryId === entry.entryId ? { ...row, readAt: new Date().toISOString() } : row
          ),
        } : current);
        onUnreadChange(Math.max(0, Number(mailbox?.unread ?? 1) - 1));
      } catch {
        // Reading the message must still work if the acknowledgement cannot be persisted.
      }
    }
  }

  async function deleteMessage(entry: SageMailEntry) {
    setBusy(true);
    try {
      await window.sage.deleteSageMail({ characterId, entryId: entry.entryId });
      setSelectedEntryId(null);
      await loadMailbox(folder, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mail could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  function startCompose(contact?: SageMailContact) {
    setCompose(true);
    setSelectedEntryId(null);
    setRecipientId(contact?.characterId ?? null);
    setSubject("");
    setBody("");
    setStatus("");
    if (!directory && !directoryBusy) void loadDirectory();
  }

  function replyTo(entry: SageMailEntry) {
    if (!entry.senderCharacterId) return;
    const contact = directory?.contacts.find((item) => item.characterId === entry.senderCharacterId);
    setCompose(true);
    setSelectedEntryId(null);
    setRecipientId(entry.senderCharacterId);
    setSubject(entry.subject.toLowerCase().startsWith("re:") ? entry.subject : `Re: ${entry.subject}`);
    setBody("");
    setStatus(contact ? "" : "This sender is no longer in the selected character's Sage Mail contacts. Sending will be re-checked against current EVE relationships.");
  }

  async function send() {
    if (!recipientId || !subject.trim() || !body.trim()) {
      setStatus("Choose a contact and enter both a subject and message.");
      return;
    }
    setBusy(true);
    setStatus("Transmitting through Sage Online…");
    try {
      await window.sage.sendSageMail({
        senderCharacterId: characterId,
        recipientCharacterId: recipientId,
        subject: subject.trim(),
        body: body.trim(),
      });
      setCompose(false);
      setFolder("sent");
      setSubject("");
      setBody("");
      setStatus("Mail sent.");
      await loadMailbox("sent", false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mail could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const quota = mailbox?.quota;
  const quotaPercent = quota?.premium || !quota?.limit
    ? 0
    : Math.max(0, Math.min(100, (quota.used / quota.limit) * 100));

  return (
    <div className="sage-mail-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="sage-mail-window" role="dialog" aria-modal="true" aria-label={`${characterName} Sage Mail`}>
        <header className="sage-mail-titlebar">
          <div className="sage-mail-brand">
            <span className="sage-mail-brand-mark"><EnvelopeIcon /></span>
            <div>
              <span>{channel === "sage" ? "SAGE ONLINE · SECURE CHARACTER COMMS" : "EVE ESI · CHARACTER MAIL"}</span>
              <strong>{channel === "sage" ? "SAGE MAIL" : "EVE MAIL"}</strong>
            </div>
          </div>
          <div className="sage-mail-character">
            <small>ACTIVE MAILBOX</small>
            <strong>{characterName}</strong>
            <span>{channel === "sage" ? `${mailbox?.unread ?? 0} Sage unread` : "EVE mailbox"}</span>
          </div>
          <button className="sage-mail-close" type="button" onClick={onClose} title="Close Sage Mail">
            <CloseIcon />
          </button>
        </header>

        <div className="sage-mail-channel-tabs" role="tablist" aria-label="Mail source">
          <button type="button" className={channel === "sage" ? "active" : ""} onClick={() => setChannel("sage")}>
            <EnvelopeIcon />
            Sage Mail
            {mailbox?.unread ? <b>{mailbox.unread}</b> : null}
          </button>
          <button type="button" className={channel === "eve" ? "active" : ""} onClick={() => setChannel("eve")}>
            <EnvelopeIcon />
            EVE Mail
          </button>
        </div>

        {channel === "sage" ? <>
        <div className="sage-mail-toolbar">
          <div className="sage-mail-folder-tabs" role="tablist" aria-label="Sage Mail folders">
            <button className={folder === "inbox" && !compose ? "active" : ""} onClick={() => void changeFolder("inbox")}>
              Inbox {mailbox && folder === "inbox" && mailbox.unread > 0 ? <b>{mailbox.unread}</b> : null}
            </button>
            <button className={folder === "sent" && !compose ? "active" : ""} onClick={() => void changeFolder("sent")}>Sent</button>
          </div>
          <button className={`sage-mail-compose-button${compose ? " active" : ""}`} type="button" onClick={() => startCompose()}>
            <ComposeIcon />
            New mail
          </button>
          <button className="sage-mail-refresh" type="button" onClick={() => void loadMailbox(folder, true)} disabled={busy} title="Refresh mailbox">
            <RefreshIcon />
          </button>
          <div className={`sage-mail-quota${quota?.full ? " full" : ""}`} title="Stored mail across Inbox and Sent for this character">
            <div><span>MAIL STORAGE</span><strong>{quotaText(quota)}</strong></div>
            <i><span style={{ width: `${quotaPercent}%` }} /></i>
            <small>{quota?.premium ? "Unlimited" : "Free mailbox · delete mail to free space"}</small>
          </div>
        </div>

        <div className="sage-mail-body">
          <aside className="sage-mail-list">
            <div className="sage-mail-list-head">
              <div>
                <span>{folder === "inbox" ? "INBOX" : "SENT"}</span>
                <strong>{mailbox?.messages.length ?? 0} stored</strong>
              </div>
              {busy && <i className="sage-mail-busy-orb" aria-label="Loading" />}
            </div>
            <div className="sage-mail-list-scroll">
              {(mailbox?.messages ?? []).map((entry) => {
                const unread = entry.folder === "inbox" && !entry.readAt;
                const counterpart = entry.folder === "sent" ? entry.recipientCharacterName : entry.senderCharacterName;
                return (
                  <button
                    type="button"
                    key={entry.entryId}
                    className={`sage-mail-list-row${selectedEntryId === entry.entryId && !compose ? " selected" : ""}${unread ? " unread" : ""}`}
                    onClick={() => void openMessage(entry)}
                  >
                    <span className={`sage-mail-kind kind-${entry.kind}`}>{kindLabel(entry.kind)}</span>
                    <div className="sage-mail-row-copy">
                      <strong>{counterpart}</strong>
                      <span>{entry.subject}</span>
                    </div>
                    <time>{formatMailTime(entry.createdAt)}</time>
                    {unread && <i className="sage-mail-unread-dot" />}
                  </button>
                );
              })}
              {!busy && !(mailbox?.messages.length) && <div className="sage-mail-empty-list">{status || "Nothing here yet."}</div>}
            </div>
          </aside>

          <main className="sage-mail-reader">
            {compose ? (
              <div className="sage-mail-compose">
                <div className="sage-mail-reader-kicker">NEW MESSAGE · {characterName.toUpperCase()}</div>
                <h2>Compose mail</h2>
                <div className="sage-mail-compose-grid">
                  <label className="sage-mail-recipient-field">
                    <span>TO</span>
                    <select value={recipientId ?? ""} onChange={(event) => setRecipientId(Number(event.target.value) || null)} disabled={directoryBusy}>
                      <option value="">{directoryBusy ? "Loading Sage contacts…" : "Choose a Sage contact…"}</option>
                      {contacts.map((contact) => (
                        <option key={contact.characterId} value={contact.characterId}>
                          {contact.characterName} · {relationLabel(contact).join(" / ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sage-mail-subject-field">
                    <span>SUBJECT</span>
                    <input maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Message subject" />
                  </label>
                </div>
                <div className="sage-mail-contact-search">
                  <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Filter corporation members, EVE friends or your linked characters…" />
                  <small>
                    {directory
                      ? `${directory.contacts.length} Sage-enabled contacts · automatically sourced from corporation membership and EVE contacts`
                      : "Loading automatic contacts…"}
                  </small>
                </div>
                <div className="sage-mail-contact-chips">
                  {contacts.slice(0, 24).map((contact) => (
                    <button type="button" key={contact.characterId} className={recipientId === contact.characterId ? "active" : ""} onClick={() => setRecipientId(contact.characterId)}>
                      <strong>{contact.characterName}</strong>
                      <span>{relationLabel(contact).join(" · ")}</span>
                    </button>
                  ))}
                </div>
                {directory?.contactsSource.warning && <div className="sage-mail-warning">{directory.contactsSource.warning} Corporation and linked-character contacts remain available.</div>}
                <label className="sage-mail-message-field">
                  <span>MESSAGE</span>
                  <textarea maxLength={20000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message…" />
                  <small>{body.length.toLocaleString()} / 20,000</small>
                </label>
                <div className="sage-mail-compose-actions">
                  <button type="button" className="secondary" onClick={() => setCompose(false)} disabled={busy}>Cancel</button>
                  <button type="button" className="primary" onClick={() => void send()} disabled={busy || !recipientId || !subject.trim() || !body.trim()}>
                    <EnvelopeIcon />
                    {busy ? "Sending…" : "Send mail"}
                  </button>
                </div>
              </div>
            ) : selected ? (
              <article className="sage-mail-message">
                <div className="sage-mail-reader-kicker">{kindLabel(selected.kind)} · {selected.folder.toUpperCase()}</div>
                <h2>{selected.subject}</h2>
                <div className="sage-mail-message-meta">
                  <div><span>FROM</span><strong>{selected.senderCharacterName}</strong></div>
                  <div><span>TO</span><strong>{selected.recipientCharacterName}</strong></div>
                  <div><span>TIME</span><strong>{new Date(selected.createdAt).toLocaleString("en-GB")}</strong></div>
                </div>
                <div className="sage-mail-message-copy">{selected.body}</div>
                {selected.kind !== "normal" && (
                  <div className={`sage-mail-system-note kind-${selected.kind}`}>
                    <strong>{selected.kind === "production" ? "INDUSTRIAL EVENT" : selected.kind === "doctrine" ? "CORPORATION DOCTRINE" : "SAGE SYSTEM"}</strong>
                    <span>This message was generated by Sage for this character and is stored in the same mailbox.</span>
                  </div>
                )}
                <div className="sage-mail-message-actions">
                  {selected.folder === "inbox" && selected.senderCharacterId && selected.kind === "normal" && (
                    <button type="button" onClick={() => replyTo(selected)}>Reply</button>
                  )}
                  <button type="button" className="danger" onClick={() => void deleteMessage(selected)} disabled={busy}>
                    <TrashIcon />
                    Delete
                  </button>
                </div>
              </article>
            ) : (
              <div className="sage-mail-reader-empty">
                <EnvelopeIcon />
                <span>{busy ? "Synchronising Sage Mail…" : status || "Select a message or compose a new one."}</span>
              </div>
            )}
            {status && (compose || selected) && <div className="sage-mail-status" aria-live="polite">{status}</div>}
          </main>
        </div>
        </> : (
          <EveMailPanel characterId={characterId} characterName={characterName} onReconnect={onReconnect} />
        )}
      </section>
    </div>
  );
}
