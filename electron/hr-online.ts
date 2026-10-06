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
    const backendStage = typeof body.hr_stage === "string" ? body.hr_stage : "backend_unclassified";
    const code = typeof body.error === "string" ? body.error : "unknown_error";
    const detail = typeof body.message === "string" ? body.message : "Sage Online HR request failed.";
    const error = new Error("[HR_STAGE=http_response/"+backendStage+"] status="+response.status+" code="+code+": "+detail) as Error & { status?: number; code?: string; hrStage?: string };
    error.status = response.status;
    error.code = code;
    error.hrStage = backendStage;
    throw error;
  }
  return body as T;
}

async function getJson<T>(path: string, sageSessionToken: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(SAGE_ONLINE_URL+path, { headers: { Authorization: "Bearer "+sageSessionToken } });
      if (response.status < 500 || attempt === 2) return parseResponse<T>(response);
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("[HR_STAGE=")) throw error;
        throw new Error("[HR_STAGE=http_fetch] path="+path+": "+message);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * Math.pow(2, attempt)));
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error("[HR_STAGE=http_fetch_exhausted] path="+path+": "+message);
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

export function listSageHrApplications(sageSessionToken: string, characterId: number, corporationId: number, corporationName: string) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    corporation_id: String(corporationId),
    corporation_name: corporationName,
  });
  return getJson<{ workspace: Record<string, any>; applications: SageHrApplicationRecord[]; transport: "sage-online-desktop" }>(
    `/v1/hr/recruiter/state?${query.toString()}`,
    sageSessionToken,
  );
}

export function createSageHrRequest(
  sageSessionToken: string,
  characterId: number,
  corporationId: number,
  corporationName: string,
  input: { requestedCategories: SageHrDataCategoryId[]; expiresInHours?: number },
) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    corporation_id: String(corporationId),
    corporation_name: corporationName,
  });
  return mutateJson<{ request: Record<string, any>; applicationCode: string; transport: "sage-online-desktop" }>(
    `/v1/hr/recruiter/request?${query.toString()}`, sageSessionToken, "POST",
    { requested_categories: input.requestedCategories, expires_in_hours: input.expiresInHours },
  );
}

export function revokeSageHrRequest(
  sageSessionToken: string,
  characterId: number,
  corporationId: number,
  corporationName: string,
  applicationId: string,
) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    corporation_id: String(corporationId),
    corporation_name: corporationName,
  });
  return mutateJson<SageHrApplicationRecord>(
    `/v1/hr/recruiter/applications/${encodeURIComponent(applicationId)}/revoke?${query.toString()}`,
    sageSessionToken, "POST",
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

export function addSageHrNote(
  sageSessionToken: string,
  characterId: number,
  corporationId: number,
  corporationName: string,
  applicationId: string,
  text: string,
) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    corporation_id: String(corporationId),
    corporation_name: corporationName,
  });
  return mutateJson<SageHrApplicationRecord>(
    `/v1/hr/recruiter/applications/${encodeURIComponent(applicationId)}/notes?${query.toString()}`,
    sageSessionToken, "POST", { text },
  );
}

export function setSageHrDecision(
  sageSessionToken: string,
  characterId: number,
  corporationId: number,
  corporationName: string,
  applicationId: string,
  status: string,
) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    corporation_id: String(corporationId),
    corporation_name: corporationName,
  });
  return mutateJson<SageHrApplicationRecord>(
    `/v1/hr/recruiter/applications/${encodeURIComponent(applicationId)}/decision?${query.toString()}`,
    sageSessionToken, "POST", { status },
  );
}

