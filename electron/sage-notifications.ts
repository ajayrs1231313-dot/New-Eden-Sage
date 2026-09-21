import { sharedMarketServerBaseUrl } from "./shared-market-data";

export type SageNotificationRepeatMode = "edge" | "change" | "once" | "always";

export interface SageNotificationRuleInput {
  kind: string;
  label?: string;
  enabled?: boolean;
  repeatMode?: SageNotificationRepeatMode;
  target?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SageNotificationRule extends SageNotificationRuleInput {
  schemaVersion: number;
  requestId: string;
  version: number;
  sageId: string;
  enabled: boolean;
  repeatMode: SageNotificationRepeatMode;
  target: Record<string, unknown>;
  condition: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  state?: Record<string, unknown> | null;
}

export interface SageNotificationEvent {
  eventId: string;
  requestId: string;
  ruleVersion: number;
  sageId: string;
  kind: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  triggeredAt: string;
  acknowledged: boolean;
}

export interface SageNotificationInbox {
  events: SageNotificationEvent[];
  unread: number;
}

async function notificationRequest<T>(
  path: string,
  sageSessionToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sageSessionToken}`);
  headers.set("Accept", "application/json");
  if (init.body != null) headers.set("Content-Type", "application/json");
  const response = await fetch(`${sharedMarketServerBaseUrl()}${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail ?? "")
      : String(payload ?? "");
    throw new Error(detail || `Sage notification service returned HTTP ${response.status}.`);
  }
  return payload as T;
}

export async function createSageNotificationRule(sageSessionToken: string, input: SageNotificationRuleInput) {
  return notificationRequest<{ rule: SageNotificationRule }>("/v1/notifications/rules", sageSessionToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listSageNotificationRules(sageSessionToken: string) {
  return notificationRequest<{ rules: SageNotificationRule[] }>("/v1/notifications/rules", sageSessionToken);
}

export async function updateSageNotificationRule(sageSessionToken: string, requestId: string, input: Partial<SageNotificationRuleInput>) {
  return notificationRequest<{ rule: SageNotificationRule }>(`/v1/notifications/rules/${encodeURIComponent(requestId)}`, sageSessionToken, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteSageNotificationRule(sageSessionToken: string, requestId: string) {
  return notificationRequest<{ deleted: boolean; requestId: string }>(`/v1/notifications/rules/${encodeURIComponent(requestId)}`, sageSessionToken, {
    method: "DELETE",
  });
}

export async function getSageNotificationInbox(
  sageSessionToken: string,
  options: { limit?: number; includeAcknowledged?: boolean } = {},
) {
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)))),
    include_acknowledged: options.includeAcknowledged ? "true" : "false",
  });
  return notificationRequest<SageNotificationInbox>(`/v1/notifications/inbox?${query.toString()}`, sageSessionToken);
}

export async function acknowledgeSageNotification(sageSessionToken: string, eventId: string) {
  return notificationRequest<{ acknowledged: boolean; eventId: string; acknowledgedAt: string }>(
    `/v1/notifications/inbox/${encodeURIComponent(eventId)}/ack`,
    sageSessionToken,
    { method: "POST" },
  );
}
