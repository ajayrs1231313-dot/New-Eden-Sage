export type UsageMetricEvent = {
  type: string;
  at: string;
  installId: string;
  sessionId: string;
  page?: string;
  appVersion?: string;
  active?: boolean;
  data?: Record<string, unknown>;
};

export type UsageMetricBatch = {
  events: UsageMetricEvent[];
};

export type UsagePresence = {
  connected: number;
  windowSeconds: number;
  asOf?: string;
};

const DEFAULT_METRICS_BASE_URL =
  "https://newedensage--new-eden-sage-market-benchmark-metrics-web.modal.run";

function metricsBaseUrl() {
  return String(process.env.NEW_EDEN_SAGE_METRICS_BASE_URL || DEFAULT_METRICS_BASE_URL).replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function submitUsageMetrics(batch: UsageMetricBatch) {
  const events = Array.isArray(batch?.events) ? batch.events.slice(0, 200) : [];
  if (!events.length) return { accepted: 0 };
  const response = await fetchWithTimeout(
    `${metricsBaseUrl()}/v1/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    },
  );
  if (!response.ok) {
    throw new Error(`Sage metrics server returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { accepted?: number; connected?: number };
  return {
    accepted: Math.max(0, Number(body.accepted ?? 0)),
    connected: Math.max(0, Number(body.connected ?? 0)),
  };
}

export async function getUsagePresence(): Promise<UsagePresence> {
  const response = await fetchWithTimeout(
    `${metricsBaseUrl()}/v1/presence/count`,
    { method: "GET", headers: { Accept: "application/json" } },
    4500,
  );
  if (!response.ok) {
    throw new Error(`Sage metrics presence returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as Partial<UsagePresence>;
  return {
    connected: Math.max(0, Math.floor(Number(body.connected ?? 0))),
    windowSeconds: Math.max(1, Math.floor(Number(body.windowSeconds ?? 75))),
    asOf: typeof body.asOf === "string" ? body.asOf : undefined,
  };
}
