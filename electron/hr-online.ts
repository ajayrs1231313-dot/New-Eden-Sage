const SAGE_ONLINE_URL = "https://new-eden-sage-online.ajayrs2512.workers.dev";

export type SageHrDataCategoryId =
  | "identity" | "corporation-history" | "skills" | "kill-loss" | "contacts-standings"
  | "wallet" | "contracts" | "assets" | "mail" | "notifications" | "market" | "industry"
  | "fittings-ships";

export type SageHrApplicationRecord = {
  request: Record<string, any>;
  snapshot?: Record<string, any>;
  notes: Array<Record<string, any>>;
  decision?: Record<string, any>;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? `Sage Online: ${body.error}`
        : `Sage Online HR request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = typeof body.error === "string" ? body.error : undefined;
    throw error;
  }
  return body as T;
}

async function getJson<T>(path: string, sageSessionToken: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${SAGE_ONLINE_URL}${path}`, {
        headers: { Authorization: `Bearer ${sageSessionToken}` },
      });
      if (response.status < 500 || attempt === 2) return parseResponse<T>(response);
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * Math.pow(2, attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error("Sage Online HR read failed.");
}

async function mutateJson<T>(path: string, sageSessionToken: string, method: "POST" | "PUT" | "DELETE", body?: unknown, characterId?: number): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${sageSessionToken}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (characterId) headers["X-Sage-Character-ID"] = String(characterId);
  const response = await fetch(`${SAGE_ONLINE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export function listSageHrApplications(sageSessionToken: string, workspaceId: string, characterId: number) {
  return getJson<{ applications: SageHrApplicationRecord[]; transport: "sage-online-desktop" }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/hr/applications?character_id=${encodeURIComponent(String(characterId))}`,
    sageSessionToken,
  );
}

export function createSageHrRequest(sageSessionToken: string, workspaceId: string, characterId: number, input: { requestedCategories: SageHrDataCategoryId[]; expiresInHours?: number }) {
  return mutateJson<{ request: Record<string, any>; applicationCode: string; transport: "sage-online-desktop" }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/hr/applications`, sageSessionToken, "POST",
    { requested_categories: input.requestedCategories, expires_in_hours: input.expiresInHours }, characterId,
  );
}

export function revokeSageHrRequest(sageSessionToken: string, workspaceId: string, characterId: number, applicationId: string) {
  return mutateJson<SageHrApplicationRecord>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/hr/applications/${encodeURIComponent(applicationId)}/revoke`, sageSessionToken, "POST", undefined, characterId,
  );
}

export function resolveSageHrCode(sageSessionToken: string, code: string) {
  return getJson<Record<string, any>>(`/v1/hr/applications/resolve?code=${encodeURIComponent(code)}`, sageSessionToken);
}

export function submitSageHrSnapshot(sageSessionToken: string, code: string, characterId: number, snapshot: Record<string, unknown>) {
  return mutateJson<SageHrApplicationRecord>(
    "/v1/hr/applications/submit", sageSessionToken, "POST", { code, character_id: characterId, snapshot },
  );
}

export function withdrawSageHrRequest(sageSessionToken: string, code: string) {
  return mutateJson<{ withdrawn: boolean; applicationId: string }>(
    "/v1/hr/applications/withdraw", sageSessionToken, "POST", { code },
  );
}

export function addSageHrNote(sageSessionToken: string, workspaceId: string, characterId: number, applicationId: string, text: string) {
  return mutateJson<SageHrApplicationRecord>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/hr/applications/${encodeURIComponent(applicationId)}/notes`, sageSessionToken, "POST", { text }, characterId,
  );
}

export function setSageHrDecision(sageSessionToken: string, workspaceId: string, characterId: number, applicationId: string, status: string) {
  return mutateJson<SageHrApplicationRecord>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/hr/applications/${encodeURIComponent(applicationId)}/decision`, sageSessionToken, "POST", { status }, characterId,
  );
}
