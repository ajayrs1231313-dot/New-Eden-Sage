import { useCallback, useEffect, useRef, useState } from "react";
import type { SageNotificationEvent, SageNotificationRule } from "./types";
import { notificationKindLabel } from "./notifications";
import { PanelPager } from "./PanelPager";
import "./custom-notifications.css";


function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "now";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function compactRulePresentation(rule: SageNotificationRule) {
  const raw = String(rule.label || notificationKindLabel(rule.kind)).trim();
  const title = raw.split("·")[0]?.trim() || raw;
  const condition = rule.condition ?? {};
  const side = String(condition.side ?? "").toLowerCase();
  const sideLabel = side === "buy" ? "Buy" : side === "sell" ? "Sell" : "";

  let alertType = notificationKindLabel(rule.kind);
  if (rule.kind === "market.custom_condition") {
    const hasPrice = String(condition.priceOperator ?? "any") !== "any";
    const hasVolume = String(condition.volumeOperator ?? "any") !== "any";
    const subject = hasPrice && hasVolume ? "price & volume" : hasPrice ? "price" : hasVolume ? "volume" : "market";
    alertType = `${sideLabel ? `${sideLabel} ` : ""}${subject} alert`;
  } else if (rule.kind === "market.price_below" || rule.kind === "market.price_above") {
    alertType = `${sideLabel ? `${sideLabel} ` : ""}price alert`;
  } else if (rule.kind === "market.available") {
    alertType = `${sideLabel ? `${sideLabel} ` : ""}availability alert`;
  } else if (rule.kind === "market.order_undercut") {
    alertType = side === "buy" ? "Buy order outbid alert" : "Sell order undercut alert";
  } else if (rule.kind === "contract.auction_bid") {
    alertType = "Auction bid alert";
  }

  return { title, alertType };
}

function loadPlayedNotificationIds() {
  try {
    const raw = window.localStorage.getItem("new-eden-sage-played-notification-sounds");
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function persistPlayedNotificationIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(
      "new-eden-sage-played-notification-sounds",
      JSON.stringify([...ids].slice(-150)),
    );
  } catch {
    // Sound history is a client-side convenience only.
  }
}

function playNotificationBell() {
  try {
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.95);
    master.connect(context.destination);

    const partials = [
      { frequency: 880, gain: 0.95 },
      { frequency: 1320, gain: 0.48 },
      { frequency: 1760, gain: 0.24 },
    ];

    partials.forEach(({ frequency, gain }) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      envelope.gain.setValueAtTime(gain, context.currentTime);
      envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.9);
    });

    window.setTimeout(() => void context.close(), 1_150);
  } catch {
    // Never let an audio failure affect notifications.
  }
}

function AlertBellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.25a4.5 4.5 0 0 0-4.5 4.5v2.2c0 1.95-.62 3.42-1.85 4.42l-.62.5c-.59.48-.25 1.43.51 1.43h12.92c.76 0 1.1-.95.51-1.43l-.62-.5c-1.23-1-1.85-2.47-1.85-4.42v-2.2a4.5 4.5 0 0 0-4.5-4.5Z" />
    <path d="M9.75 18.1a2.25 2.25 0 0 0 4.5 0" />
  </svg>;
}

function TriggeredNotificationCard({
  title,
  message,
  time,
  onDismiss,
  onOpenInEve,
  opening,
}: {
  title: string;
  message: string;
  time: string;
  onDismiss: () => void;
  onOpenInEve: () => void;
  opening: boolean;
}) {
  return <div className="custom-notification-event custom-notification-event--triggered">
    <span className="custom-notification-event__icon" aria-hidden="true">
      <span className="custom-notification-event__icon-ring" />
      <span className="custom-notification-event__icon-core"><AlertBellIcon /></span>
    </span>
    <button type="button" className="custom-notification-event__body" onClick={onDismiss} title="Dismiss notification">
      <span className="custom-notification-event__title-row">
        <strong>{title}</strong>
        <span className="custom-notification-event__badge">TRIGGERED</span>
        <span className="custom-notification-event__chevrons" aria-hidden="true">///</span>
      </span>
      <small>{message}</small>
    </button>
    <span className="custom-notification-event__actions">
      <em>{time}</em>
      <button type="button" onClick={onOpenInEve} disabled={opening} title="Open this notification target in EVE">
        {opening ? "OPENING" : "EVE ↗"}
      </button>
    </span>
  </div>;
}

export function CustomNotificationsPanel({ characterId }: { characterId: string }) {
  const [rules, setRules] = useState<SageNotificationRule[]>([]);
  const [events, setEvents] = useState<SageNotificationEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panelPage, setPanelPage] = useState(0);
  const [openingEventId, setOpeningEventId] = useState("");
  const playedSoundIds = useRef<Set<string> | null>(null);

  if (playedSoundIds.current === null) playedSoundIds.current = loadPlayedNotificationIds();

  const refresh = useCallback(async (showBusy = false) => {
    if (showBusy) setBusy(true);
    try {
      const [ruleResult, inbox] = await Promise.all([
        window.sage.getNotificationRules(),
        window.sage.getNotificationInbox({ limit: 12, includeAcknowledged: false }),
      ]);
      setRules(ruleResult.rules);
      setEvents(inbox.events);
      setUnread(inbox.unread);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method .*?: Error: /, "") : "Notifications unavailable.");
    } finally {
      if (showBusy) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const dispose = window.sage.onNotificationsUpdated((inbox) => {
      setEvents(inbox.events);
      setUnread(inbox.unread);
      void window.sage.getNotificationRules().then((value) => setRules(value.rules)).catch(() => undefined);
    });
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { dispose(); window.clearInterval(timer); };
  }, [refresh]);

  async function acknowledge(event: SageNotificationEvent) {
    try {
      await window.sage.acknowledgeNotification(event.eventId);
      setEvents((current) => current.filter((item) => item.eventId !== event.eventId));
      setUnread((current) => Math.max(0, current - 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not dismiss notification.");
    }
  }

  async function removeRule(rule: SageNotificationRule) {
    try {
      await window.sage.deleteNotificationRule(rule.requestId);
      setRules((current) => current.filter((item) => item.requestId !== rule.requestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove notification.");
    }
  }

  async function openNotificationInEve(event: SageNotificationEvent) {
    const rule = rules.find((item) => item.requestId === event.requestId);
    const eventTarget = event.data?.notificationTarget;
    const target = eventTarget && typeof eventTarget === "object"
      ? eventTarget as Record<string, unknown>
      : rule?.target ?? {};

    const contractId = Number(target.contractId ?? event.data?.contractId);
    const typeId = Number(target.typeId ?? event.data?.typeId);

    setOpeningEventId(event.eventId);
    try {
      if (Number.isSafeInteger(contractId) && contractId > 0) {
        await window.sage.openEveContract({ characterId, contractId });
      } else if (Number.isSafeInteger(typeId) && typeId > 0) {
        await window.sage.openEveMarketType({ characterId, typeId });
      } else {
        throw new Error("This notification does not have an EVE UI target.");
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method .*?: Error: /, "") : "Could not open this notification in EVE.");
    } finally {
      setOpeningEventId("");
    }
  }

  const active = rules.filter((rule) => rule.enabled !== false);
  const displayedUnread = unread;
  const triggeredItems = events.map((event) => ({
    key: event.eventId,
    event,
    title: event.title,
    message: event.message,
    time: relativeTime(event.triggeredAt),
    dismiss: () => void acknowledge(event),
    openInEve: () => void openNotificationInEve(event),
  }));
  const showingTriggered = triggeredItems.length > 0;
  const panelPageSize = showingTriggered ? 3 : 4;
  const panelItemCount = showingTriggered ? triggeredItems.length : active.length;
  const panelPageCount = Math.max(1, Math.ceil(panelItemCount / panelPageSize));
  const safePanelPage = Math.min(panelPage, panelPageCount - 1);
  const visibleTriggeredItems = triggeredItems.slice(safePanelPage * panelPageSize, safePanelPage * panelPageSize + panelPageSize);
  const visibleRules = active.slice(safePanelPage * panelPageSize, safePanelPage * panelPageSize + panelPageSize);

  useEffect(() => {
    setPanelPage((current) => Math.min(current, panelPageCount - 1));
  }, [panelPageCount, showingTriggered]);

  useEffect(() => {
    const idsToConsider = events.map((event) => event.eventId);
    const nextId = idsToConsider.find((id) => !playedSoundIds.current?.has(id));
    if (!nextId || !playedSoundIds.current) return;

    playedSoundIds.current.add(nextId);
    persistPlayedNotificationIds(playedSoundIds.current);
    playNotificationBell();
  }, [events]);

  return <article className={`capability-next-moves custom-notifications-panel frontpage-card${displayedUnread ? " has-triggered-alert" : ""}`}>
    <div className="capability-heading frontpage-card__header">
      <div><p className="eyebrow">CUSTOM NOTIFICATIONS</p><h3>{displayedUnread ? `${displayedUnread} unread alert${displayedUnread === 1 ? "" : "s"}` : `${active.length} active watch${active.length === 1 ? "" : "es"}`}</h3></div>
      <button className="custom-notifications-refresh" type="button" onClick={() => void refresh(true)} disabled={busy} title="Refresh notifications">↻</button>
    </div>
    <div className="custom-notifications-content frontpage-card__body">
      {error ? <div className="custom-notifications-error">{error}</div> : events.length ? (
        <div className="custom-notification-events">
          {visibleTriggeredItems.map((item) => <TriggeredNotificationCard
            key={item.key}
            title={item.title}
            message={item.message}
            time={item.time}
            onDismiss={item.dismiss}
            onOpenInEve={item.openInEve}
            opening={openingEventId === item.event.eventId}
          />)}
        </div>
      ) : active.length ? (
        <div className="custom-notification-rules">
          {visibleRules.map((rule) => {
            const display = compactRulePresentation(rule);
            return <div className="custom-notification-rule" key={rule.requestId}>
              <span className="custom-notification-rule__dot" aria-hidden="true" />
              <span className="custom-notification-rule__body">
                <strong>{display.title}</strong>
                <small className="custom-notification-rule__type">{display.alertType}</small>
              </span>
              <button type="button" onClick={() => void removeRule(rule)} title="Remove alert">×</button>
            </div>;
          })}
        </div>
      ) : (
        <div className="custom-notifications-empty">
          <strong>No custom alerts yet</strong>
          <small>Use the bell buttons in Market Search, Order Desk and auction Contracts.</small>
        </div>
      )}
    </div>
    <PanelPager page={safePanelPage} pageCount={panelPageCount} onPageChange={setPanelPage} label="Notification pages" />
  </article>;
}
