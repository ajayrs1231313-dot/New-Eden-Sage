import type { UsageMetricEvent } from "./types";

const INSTALL_ID_KEY = "new-eden-sage-metrics-install-id";
const MAX_QUEUE = 500;
const MAX_BATCH = 120;
const FLUSH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

let initialized = false;
let installId = "";
let sessionId = "";
let appVersion = "";
let currentPage = "boot";
let sessionStartedAt = Date.now();
let pageStartedAt = sessionStartedAt;
let pageActiveMs = 0;
let activeMsSinceHeartbeat = 0;
let lastActivityTick = 0;
let lastWasActive = false;
let flushInFlight: Promise<void> | null = null;
let queue: UsageMetricEvent[] = [];
let deepestScrollBucket = 0;

function randomId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

function getInstallId() {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const created = randomId("install");
    localStorage.setItem(INSTALL_ID_KEY, created);
    return created;
  } catch {
    return randomId("install-ephemeral");
  }
}

function isActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function accrueActiveTime() {
  const now = performance.now();
  if (!lastActivityTick) {
    lastActivityTick = now;
    lastWasActive = isActive();
    return;
  }
  const elapsed = Math.max(0, Math.min(60_000, now - lastActivityTick));
  if (lastWasActive) {
    pageActiveMs += elapsed;
    activeMsSinceHeartbeat += elapsed;
  }
  lastActivityTick = now;
  lastWasActive = isActive();
}

function safeText(value: string | null | undefined, limit = 140) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function semanticElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return (target.closest(
    '[data-metric],button,a,[role="button"],[role="tab"],[role="menuitem"],input,select,textarea,summary,label',
  ) ?? target) as Element;
}

function elementPath(element: Element) {
  const parts: string[] = [];
  let cursor: Element | null = element;
  for (let depth = 0; cursor && depth < 4; depth += 1, cursor = cursor.parentElement) {
    let part = cursor.tagName.toLowerCase();
    if (cursor.id) part += `#${safeText(cursor.id, 60)}`;
    const classes = [...cursor.classList].filter(Boolean).slice(0, 3);
    if (classes.length) part += `.${classes.join(".")}`;
    parts.unshift(part);
  }
  return parts.join(" > ").slice(0, 360);
}

function describeTarget(target: EventTarget | null) {
  const element = semanticElement(target);
  if (!element) return {};
  const html = element as HTMLElement;
  const input = element instanceof HTMLInputElement;
  const textarea = element instanceof HTMLTextAreaElement;
  const select = element instanceof HTMLSelectElement;
  const label = safeText(
    element.getAttribute("data-metric")
      || element.getAttribute("aria-label")
      || element.getAttribute("title")
      || ((!input && !textarea && !select) ? html.innerText : "")
      || element.getAttribute("name")
      || element.id
      || element.tagName,
  );
  return {
    tag: element.tagName.toLowerCase(),
    role: safeText(element.getAttribute("role"), 60),
    type: input ? safeText(element.type, 40) : "",
    id: safeText(element.id, 80),
    classes: [...element.classList].slice(0, 6),
    label,
    path: elementPath(element),
  };
}

function pushEvent(type: string, data: Record<string, unknown> = {}) {
  if (!initialized) return;
  if (queue.length >= MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE + 1);
  queue.push({
    type,
    at: new Date().toISOString(),
    installId,
    sessionId,
    page: currentPage,
    appVersion,
    active: isActive(),
    data,
  });
  if (queue.length >= 40) void flushUsageMetrics();
}

export async function flushUsageMetrics() {
  if (!initialized || flushInFlight || queue.length === 0) return flushInFlight ?? Promise.resolve();
  const batch = queue.splice(0, MAX_BATCH);
  flushInFlight = (async () => {
    try {
      await window.sage.submitUsageMetrics({ events: batch });
    } catch {
      // Product analytics are best-effort. Do not replay a batch after an ambiguous
      // network failure: the server may already have committed it, which would
      // double-count clicks and page time. Later heartbeats restore continuity.
    } finally {
      flushInFlight = null;
    }
  })();
  await flushInFlight;
  if (queue.length >= 40) void flushUsageMetrics();
}

function recordStateChange(type: "visibility" | "window_focus" | "window_blur") {
  accrueActiveTime();
  pushEvent(type, {
    visibility: document.visibilityState,
    focused: document.hasFocus(),
  });
}

function scrollDepth() {
  const root = document.scrollingElement;
  if (!root) return 0;
  const available = Math.max(1, root.scrollHeight - root.clientHeight);
  return Math.max(0, Math.min(100, Math.round((root.scrollTop / available) * 100)));
}

function selectedUiContext() {
  const selector = [
    '[role="tab"][aria-selected="true"]',
    '[role="tab"].active',
    '.tabs button.active',
    '.tab-strip button.active',
    '.subtabs button.active',
    'nav button.active',
    'button[aria-pressed="true"]',
  ].join(",");
  const seen = new Set<string>();
  const selected: Array<{ label: string; path: string }> = [];
  for (const element of document.querySelectorAll(selector)) {
    const html = element as HTMLElement;
    const rect = html.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const described = describeTarget(element) as { label?: unknown; path?: unknown };
    const label = safeText(typeof described.label === "string" ? described.label : "", 120);
    const path = safeText(typeof described.path === "string" ? described.path : "", 300);
    const key = `${label}|${path}`;
    if (!label || seen.has(key)) continue;
    seen.add(key);
    selected.push({ label, path });
    if (selected.length >= 12) break;
  }
  return selected;
}

function maybeRecordScrollDepth() {
  const depth = scrollDepth();
  const bucket = depth >= 90 ? 90 : depth >= 75 ? 75 : depth >= 50 ? 50 : depth >= 25 ? 25 : 0;
  if (bucket <= deepestScrollBucket) return;
  deepestScrollBucket = bucket;
  pushEvent("scroll_depth", { percent: bucket });
}

function heartbeat() {
  accrueActiveTime();
  const activeMs = Math.round(activeMsSinceHeartbeat);
  activeMsSinceHeartbeat = 0;
  pushEvent("heartbeat", {
    activeMs,
    pageActiveMs: Math.round(pageActiveMs),
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    scrollDepthPercent: scrollDepth(),
    selectedControls: selectedUiContext(),
  });
}

export function setUsageMetricsAppVersion(version: string) {
  appVersion = safeText(version, 40);
}

export function setUsageMetricPage(page: string) {
  const next = safeText(page, 180) || "unknown";
  if (next === currentPage) return;
  accrueActiveTime();
  if (initialized) {
    pushEvent("page_leave", {
      page: currentPage,
      durationMs: Math.max(0, Date.now() - pageStartedAt),
      activeMs: Math.round(pageActiveMs),
    });
  }
  currentPage = next;
  pageStartedAt = Date.now();
  pageActiveMs = 0;
  activeMsSinceHeartbeat = 0;
  deepestScrollBucket = 0;
  if (initialized) pushEvent("page_view", { page: currentPage });
}

export function initializeUsageMetrics() {
  if (initialized) return () => undefined;
  initialized = true;
  installId = getInstallId();
  sessionId = randomId("session");
  sessionStartedAt = Date.now();
  pageStartedAt = sessionStartedAt;
  lastActivityTick = performance.now();
  lastWasActive = isActive();

  const onClick = (event: MouseEvent) => pushEvent("click", {
    button: event.button,
    x: Math.round(event.clientX),
    y: Math.round(event.clientY),
    ...describeTarget(event.target),
  });
  const onDoubleClick = (event: MouseEvent) => pushEvent("double_click", describeTarget(event.target));
  const onContextMenu = (event: MouseEvent) => pushEvent("context_menu", describeTarget(event.target));
  const onChange = (event: Event) => {
    const target = event.target;
    const state: Record<string, unknown> = describeTarget(target);
    if (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")) {
      state.checked = target.checked;
    } else if (target instanceof HTMLSelectElement) {
      state.selectedIndex = target.selectedIndex;
    }
    pushEvent("control_change", state);
  };
  const onSubmit = (event: SubmitEvent) => pushEvent("form_submit", describeTarget(event.target));
  const onVisibility = () => recordStateChange("visibility");
  const onFocus = () => recordStateChange("window_focus");
  const onBlur = () => recordStateChange("window_blur");
  const onResize = () => pushEvent("viewport_resize", {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  });
  const onPageHide = () => {
    accrueActiveTime();
    pushEvent("page_leave", {
      page: currentPage,
      durationMs: Math.max(0, Date.now() - pageStartedAt),
      activeMs: Math.round(pageActiveMs),
      reason: "app_close",
    });
    pushEvent("session_end", { sessionDurationMs: Math.max(0, Date.now() - sessionStartedAt) });
    void flushUsageMetrics();
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("visibilitychange", onVisibility, true);
  document.addEventListener("scroll", maybeRecordScrollDepth, { capture: true, passive: true });
  window.addEventListener("focus", onFocus, true);
  window.addEventListener("blur", onBlur, true);
  window.addEventListener("resize", onResize, true);
  window.addEventListener("pagehide", onPageHide, true);

  pushEvent("session_start", {
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    screen: { width: window.screen.width, height: window.screen.height },
    language: navigator.language,
  });
  pushEvent("page_view", { page: currentPage });
  void flushUsageMetrics();

  const flushTimer = window.setInterval(() => void flushUsageMetrics(), FLUSH_INTERVAL_MS);
  const heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  return () => {
    window.clearInterval(flushTimer);
    window.clearInterval(heartbeatTimer);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("visibilitychange", onVisibility, true);
    document.removeEventListener("scroll", maybeRecordScrollDepth, true);
    window.removeEventListener("focus", onFocus, true);
    window.removeEventListener("blur", onBlur, true);
    window.removeEventListener("resize", onResize, true);
    window.removeEventListener("pagehide", onPageHide, true);
  };
}
