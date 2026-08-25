const SAGE_ONLINE_URL = "https://new-eden-sage-online.ajayrs2512.workers.dev";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? `Sage Online: ${body.error}` : `Sage Online request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?:number; code?:string; currentVersion?:number };
    error.status = response.status;
    error.code = typeof body.error === "string" ? body.error : undefined;
    const version = Number(body.current_version ?? 0);
    if (Number.isSafeInteger(version) && version > 0) error.currentVersion = version;
    throw error;
  }
  return body as T;
}

export type SagePiSharedObjectType = "sage.pi-survey" | "sage.pi-template";
export type SagePiSharedObjectSummary = {
  id:string;
  object_type:SagePiSharedObjectType;
  current_version:number;
  visibility:"workspace"|"restricted";
  created_at:string;
  updated_at:string;
  published_at?:string;
};
export type SagePiSharedObject = SagePiSharedObjectSummary & { payload:Record<string,unknown>; published_by_account_id?:string };

export async function listSagePiObjects(sessionToken:string, workspaceId:string, objectType:SagePiSharedObjectType):Promise<SagePiSharedObjectSummary[]> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects?type=${encodeURIComponent(objectType)}`, { headers:{ Authorization:`Bearer ${sessionToken}` } });
  const body = await parseResponse<{objects?:SagePiSharedObjectSummary[]}>(response);
  return Array.isArray(body.objects) ? body.objects : [];
}

export async function getSagePiObject(sessionToken:string, workspaceId:string, objectId:string):Promise<SagePiSharedObject> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, { headers:{ Authorization:`Bearer ${sessionToken}` } });
  return parseResponse<SagePiSharedObject>(response);
}

export async function publishSagePiObject(sessionToken:string, workspaceId:string, input:{objectType:SagePiSharedObjectType;payload:Record<string,unknown>;idempotencyKey:string;visibility?:"workspace"|"restricted";recipientCharacterIds?:number[]}) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects`, {
    method:"POST",
    headers:{ Authorization:`Bearer ${sessionToken}`, "Content-Type":"application/json" },
    body:JSON.stringify({ object_type:input.objectType, payload:input.payload, visibility:input.visibility??"workspace", recipient_character_ids:input.recipientCharacterIds??[], idempotency_key:input.idempotencyKey }),
  });
  return parseResponse<{id:string;object_type:SagePiSharedObjectType;version:number;idempotent_replay?:boolean}>(response);
}

export async function updateSagePiObject(sessionToken:string, workspaceId:string, objectId:string, input:{payload:Record<string,unknown>;expectedVersion:number;idempotencyKey:string}) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, {
    method:"PUT",
    headers:{ Authorization:`Bearer ${sessionToken}`, "Content-Type":"application/json" },
    body:JSON.stringify({ payload:input.payload, expected_version:input.expectedVersion, idempotency_key:input.idempotencyKey }),
  });
  return parseResponse<{id:string;object_type:SagePiSharedObjectType;version:number}>(response);
}

export async function unpublishSagePiObject(sessionToken:string, workspaceId:string, objectId:string) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, { method:"DELETE", headers:{ Authorization:`Bearer ${sessionToken}` } });
  return parseResponse<{id:string;object_type:SagePiSharedObjectType;archived:boolean}>(response);
}
