const SAGE_ONLINE_URL = "https://new-eden-sage-online.ajayrs2512.workers.dev";
const PACKET_SCHEMA = "new-eden-sage.packet.v1" as const;

type SagePacket<T extends Record<string, unknown>> = {
  schema: typeof PACKET_SCHEMA;
  packet_id: string;
  message_type: string;
  sent_at: string;
  client: {
    application: "New Eden Sage";
    component: "desktop";
    transport: "https-json";
  };
  payload: T;
};

type ClaimResponse = {
  account_id: string;
  primary_character_id: number;
  primary_character_name: string;
  session_token: string;
  session_expires_at: string;
  recovered: boolean;
};

type LinkResponse = {
  account_id: string;
  character_id: number;
  character_name: string;
  primary: boolean;
};

function packet<T extends Record<string, unknown>>(messageType: string, payload: T): SagePacket<T> {
  return {
    schema: PACKET_SCHEMA,
    packet_id: crypto.randomUUID(),
    message_type: messageType,
    sent_at: new Date().toISOString(),
    client: {
      application: "New Eden Sage",
      component: "desktop",
      transport: "https-json",
    },
    payload,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `Sage Online request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function claimSageIdentity(eveAccessToken: string): Promise<ClaimResponse> {
  const body = packet("identity.claim_primary", {
    action: "create_or_recover_sage_identity",
    identity_anchor: "verified_eve_character_id",
  });
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/identity/claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${eveAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseResponse<ClaimResponse>(response);
}

export async function linkSageCharacter(sageSessionToken: string, eveAccessToken: string): Promise<LinkResponse> {
  const body = packet("identity.link_character", {
    action: "link_verified_eve_character",
    relationship: "linked_character",
  });
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/identity/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sageSessionToken}`,
      "X-EVE-Access-Token": eveAccessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseResponse<LinkResponse>(response);
}

export async function getSageOnlineIdentity(sageSessionToken: string) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/identity`, {
    headers: { Authorization: `Bearer ${sageSessionToken}` },
  });
  return parseResponse<Record<string, unknown>>(response);
}

export type SageCorporationWorkspace = {
  workspace_id: string;
  workspace_type: "corporation";
  corporation_id: number;
  corporation_name: string;
  character_id: number;
  character_name: string;
  can_publish_routes: boolean;
  roles: string[];
  titles: string[];
  member_access: "active";
};

export type SageSharedRouteSummary = {
  id: string;
  object_type: "sage.route";
  current_version: number;
  visibility: "workspace" | "restricted";
  created_at: string;
  updated_at: string;
  published_at?: string;
};

export type SageSharedRouteObject = SageSharedRouteSummary & {
  payload: Record<string, unknown>;
  published_by_account_id?: string;
};

export async function ensureSageCorporationWorkspace(sageSessionToken: string, eveAccessToken: string): Promise<SageCorporationWorkspace> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/corporation/ensure`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sageSessionToken}`, "X-EVE-Access-Token": eveAccessToken, "Content-Type": "application/json" },
    body: JSON.stringify(packet("workspace.ensure_corporation", { action: "verify_membership" })),
  });
  return parseResponse<SageCorporationWorkspace>(response);
}

export async function listSageSharedRoutes(sageSessionToken: string, workspaceId: string): Promise<SageSharedRouteSummary[]> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects?type=sage.route`, { headers: { Authorization: `Bearer ${sageSessionToken}` } });
  const body = await parseResponse<{ objects?: SageSharedRouteSummary[] }>(response);
  return Array.isArray(body.objects) ? body.objects : [];
}

export async function getSageSharedRoute(sageSessionToken: string, workspaceId: string, objectId: string): Promise<SageSharedRouteObject> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, { headers: { Authorization: `Bearer ${sageSessionToken}` } });
  return parseResponse<SageSharedRouteObject>(response);
}

export async function publishSageSharedRoute(sageSessionToken: string, workspaceId: string, input: { route: Record<string, unknown>; visibility?: "workspace" | "restricted"; recipientCharacterIds?: number[] }) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sageSessionToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ object_type: "sage.route", payload: input.route, visibility: input.visibility ?? "workspace", recipient_character_ids: input.recipientCharacterIds ?? [], idempotency_key: `route:${String(input.route.routeId ?? crypto.randomUUID())}:${String(input.route.version ?? 1)}` }),
  });
  return parseResponse<{ id: string; object_type: "sage.route"; version: number; idempotent_replay?: boolean }>(response);
}

export async function updateSageSharedRoute(sageSessionToken: string, workspaceId: string, objectId: string, input: { route: Record<string, unknown>; expectedVersion: number }) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${sageSessionToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ payload: input.route, expected_version: input.expectedVersion, idempotency_key: `route-update:${objectId}:${input.expectedVersion}:${String(input.route.version ?? 1)}` }),
  });
  return parseResponse<{ id: string; object_type: "sage.route"; version: number }>(response);
}
