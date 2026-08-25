import { createDiscordActionProof, createDiscordDeviceRegistrationProof } from "./sage-discord-device";
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
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? `Sage Online: ${body.error}` : `Sage Online request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number; code?: string; currentVersion?: number };
    error.status = response.status;
    error.code = typeof body.error === "string" ? body.error : undefined;
    const currentVersion = Number(body.current_version ?? 0);
    if (Number.isSafeInteger(currentVersion) && currentVersion > 0) error.currentVersion = currentVersion;
    throw error;
  }
  return body as T;
}

async function fetchSageOnlineRead(url:string,headers:HeadersInit,attempts=3){
  let lastError:unknown=null;
  let lastResponse:Response|null=null;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetch(url,{headers});
      if(response.status<500||attempt===attempts-1)return response;
      lastResponse=response;
    }catch(error){
      lastError=error;
      if(attempt===attempts-1)throw error;
    }
    await new Promise(resolve=>setTimeout(resolve,150*Math.pow(2,attempt)));
  }
  if(lastResponse)return lastResponse;
  throw lastError instanceof Error?lastError:new Error("Sage Online read failed.");
}
async function sha256Text(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function registerDiscordDevice(sageSessionToken:string,eveAccessToken:string){
  const proof=await createDiscordDeviceRegistrationProof();
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/discord/device/register`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"X-EVE-Access-Token":eveAccessToken,"Content-Type":"application/json"},body:JSON.stringify(proof)});
  return parseResponse<{registered:boolean;deviceId:string;fingerprint:string}>(response);
}

async function secureDiscordMutation<T>(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,action:string,path:string,method:"POST"|"PUT"|"DELETE",body:Record<string,unknown>){
  await registerDiscordDevice(sageSessionToken,eveAccessToken);
  const bodyText=JSON.stringify(body);
  const payloadHash=await sha256Text(bodyText);
  const proof=await createDiscordActionProof(workspaceId,characterId,action,payloadHash);
  const ticketResponse=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/action-ticket`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Device-ID":proof.deviceId,"X-Sage-Request-Time":String(proof.timestampMs),"X-Sage-Nonce":proof.nonce,"X-Sage-Signature":proof.signatureB64},body:JSON.stringify({action,payload_hash:payloadHash,character_id:characterId})});
  const ticket=await parseResponse<{ticket:string;expiresInSeconds:number}>(ticketResponse);
  const response=await fetch(`${SAGE_ONLINE_URL}${path}`,{method,headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Action-Ticket":ticket.ticket,"X-Sage-Character-ID":String(characterId)},body:bodyText});
  return parseResponse<T>(response);
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
  can_manage_wormholes?: boolean;
  can_manage_fleet_ops?: boolean;
  can_approve_fleet_ops?: boolean;
  can_configure_permissions?: boolean;
  is_corporation_ceo?: boolean;
  can_manage_discord?: boolean;
  roles: string[];
  titles: string[];
  member_access: "active";
};

export type SageOperationSummary = {
  id:string;
  object_type:"sage.operation";
  current_version:number;
  visibility:"workspace"|"restricted";
  created_at:string;
  updated_at:string;
  published_at?:string;
};
export type SageOperationObject = SageOperationSummary & { payload:Record<string,unknown>; published_by_account_id?:string };

export async function listSageOperations(sageSessionToken:string,workspaceId:string):Promise<SageOperationSummary[]> {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects?type=sage.operation`,{headers:{Authorization:`Bearer ${sageSessionToken}`}});
  const body=await parseResponse<{objects?:SageOperationSummary[]}>(response);
  return Array.isArray(body.objects)?body.objects:[];
}
export async function getSageOperation(sageSessionToken:string,workspaceId:string,objectId:string):Promise<SageOperationObject> {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`,{headers:{Authorization:`Bearer ${sageSessionToken}`}});
  return parseResponse<SageOperationObject>(response);
}
export async function publishSageOperation(sageSessionToken:string,workspaceId:string,characterId:number,payload:Record<string,unknown>) {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Character-ID":String(characterId)},body:JSON.stringify({object_type:"sage.operation",payload,visibility:"workspace",idempotency_key:`operation:${workspaceId}:${String(payload.operationId??crypto.randomUUID())}`})});
  return parseResponse<{id:string;object_type:"sage.operation";version:number}>(response);
}
export async function updateSageOperation(sageSessionToken:string,workspaceId:string,characterId:number,objectId:string,payload:Record<string,unknown>,expectedVersion:number) {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`,{method:"PUT",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Character-ID":String(characterId)},body:JSON.stringify({payload,expected_version:expectedVersion,idempotency_key:`operation-update:${objectId}:${expectedVersion}:${String(payload.updatedAt??Date.now())}`})});
  return parseResponse<{id:string;object_type:"sage.operation";version:number}>(response);
}
export async function applySageOperationRole(sageSessionToken:string,workspaceId:string,objectId:string,input:{characterId:number;roleId:string;fitName?:string;fitText?:string;hullName?:string}) {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/apply`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json"},body:JSON.stringify({character_id:input.characterId,role_id:input.roleId,fit_name:input.fitName??"",fit_text:input.fitText??"",hull_name:input.hullName??""})});
  return parseResponse<{id:string;object_type:"sage.operation";version:number;payload:Record<string,unknown>}>(response);
}
export async function takeSageOperationOwnership(sageSessionToken:string,workspaceId:string,characterId:number,objectId:string){
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/ownership`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Character-ID":String(characterId)},body:"{}"});
  return parseResponse<{id:string;object_type:"sage.operation";version:number;payload:Record<string,unknown>}>(response);
}
export async function setSageOperationApplicationNotifications(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,objectId:string,enabled:boolean){
  return secureDiscordMutation<{id:string;object_type:"sage.operation";version:number;payload:Record<string,unknown>}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.operation_notifications",`/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/application-notifications`,"PUT",{enabled});
}
export async function decideSageOperationApplication(sageSessionToken:string,workspaceId:string,characterId:number,objectId:string,applicationId:string,input:{decision:"approved"|"denied";message?:string}) {
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/applications/${encodeURIComponent(applicationId)}/decision`,{method:"POST",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Character-ID":String(characterId)},body:JSON.stringify(input)});
  return parseResponse<{id:string;object_type:"sage.operation";version:number;payload:Record<string,unknown>}>(response);
}
export type SageCorporationAuthority = { type:"eve_role"|"eve_title"; value:string };
export type SageCorporationPermissionState = {
  can_configure:boolean;
  is_corporation_ceo:boolean;
  is_director:boolean;
  administrators:Array<{key:string;label:string;locked:boolean}>;
  available_roles:Array<{key:string;label:string}>;
  available_titles:Array<{value:string;label:string}>;
  permissions:Array<{key:string;label:string;description:string;selected_authorities:SageCorporationAuthority[];selected_role_keys:string[];selected_title_values:string[];administrator_keys:string[]}>;
};
export async function getSageCorporationPermissions(sageSessionToken:string,workspaceId:string,characterId:number):Promise<SageCorporationPermissionState>{
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/permissions?character_id=${encodeURIComponent(String(characterId))}`,{headers:{Authorization:`Bearer ${sageSessionToken}`}});
  return parseResponse<SageCorporationPermissionState>(response);
}
export async function updateSageCorporationPermission(sageSessionToken:string,workspaceId:string,characterId:number,permissionKey:string,authorities:SageCorporationAuthority[]):Promise<SageCorporationPermissionState>{
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/permissions/${encodeURIComponent(permissionKey)}`,{method:"PUT",headers:{Authorization:`Bearer ${sageSessionToken}`,"Content-Type":"application/json","X-Sage-Character-ID":String(characterId)},body:JSON.stringify({authorities})});
  return parseResponse<SageCorporationPermissionState>(response);
}

export type SageDiscordStatus = {
  integration:{guildId:string;channelId:string;allowedChannelIds:string[];enabled:boolean;updatedAt:string}|null;
  link:{discordUserId:string;username:string;globalName:string|null;dmEnabled:boolean;linkedAt:string;linkedViaCharacterId?:number}|null;
  notificationCharacters:Array<{characterId:number;characterName:string;enabled:boolean}>;
  linkedUserCount:number;
  canManage:boolean;
  inviteUrl:string|null;
  botInstalled:boolean;
  channelAccessible:boolean;
};
export type SageDiscordServerStructure={
  guildId:string;
  guildName:string;
  categories:Array<{id:string;name:string;position:number;channels:Array<{id:string;name:string;type:number;position:number}>}>;
  uncategorized:Array<{id:string;name:string;type:number;position:number}>;
  sendableChannelIds:string[];
  roles:Array<{id:string;name:string;position:number;color:number;managed:boolean;mentionable:boolean}>;
  members:Array<{id:string;username:string;globalName:string|null;displayName:string;roleIds:string[]}>;
  membersAvailable:boolean;
  membersTruncated:boolean;
};
export async function getSageDiscordStatus(sageSessionToken:string,workspaceId:string,characterId:number):Promise<SageDiscordStatus>{
  const response=await fetchSageOnlineRead(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/discord?character_id=${encodeURIComponent(String(characterId))}`,{Authorization:`Bearer ${sageSessionToken}`});return parseResponse<SageDiscordStatus>(response);
}
export async function getSageDiscordServerStructure(sageSessionToken:string,workspaceId:string,characterId:number):Promise<SageDiscordServerStructure>{
  const response=await fetchSageOnlineRead(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/server-structure?character_id=${encodeURIComponent(String(characterId))}`,{Authorization:`Bearer ${sageSessionToken}`});return parseResponse<SageDiscordServerStructure>(response);
}
export async function configureSageDiscord(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,input:{guildId:string;channelId:string;allowedChannelIds?:string[];enabled:boolean}){
  return secureDiscordMutation<SageDiscordStatus>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.configure",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord`,"PUT",{guild_id:input.guildId,channel_id:input.channelId,allowed_channel_ids:input.allowedChannelIds??[],enabled:input.enabled});
}
export async function getSageDiscordLinkUrl(sageSessionToken:string,workspaceId:string,characterId:number){
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/link-url?character_id=${encodeURIComponent(String(characterId))}`,{headers:{Authorization:`Bearer ${sageSessionToken}`}});return parseResponse<{url:string;expiresInSeconds:number}>(response);
}
export async function sendSageDiscordAnnouncement(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,input:{content:string;channelId?:string;roleIds?:string[];userIds?:string[]}){
  return secureDiscordMutation<{sent:boolean;messageId?:string;channelId?:string;roleIds?:string[];mentionEveryone?:boolean}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.announce",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/announce`,"POST",{content:input.content,channel_id:input.channelId??"",role_ids:input.roleIds??[],user_ids:input.userIds??[]});
}
export async function updateSageDiscordNotificationTargets(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,characterIds:number[]){
  return secureDiscordMutation<SageDiscordStatus>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.notifications",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/notification-targets`,"PUT",{character_ids:characterIds});
}
export async function announceSageOperationToDiscord(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,objectId:string){
  return secureDiscordMutation<{sent:boolean;messageId?:string;channelId?:string;roleIds?:string[];mentionEveryone?:boolean}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.operation_announce",`/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/announce`,"POST",{object_id:objectId});
}
export async function cancelSageOperation(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number,objectId:string,cancellationMessage:string){
  return secureDiscordMutation<{id:string;object_type:"sage.operation";version:number;payload:Record<string,unknown>;discordDeleted:boolean;discordCleanupWarning?:string;legacyLookup?:boolean;discordCancellationSent?:boolean;discordCancellationMessageId?:string;discordCancellationWarning?:string}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.operation_cancel",`/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(objectId)}/cancel`,"POST",{object_id:objectId,cancellation_message:cancellationMessage});
}
export async function sendSageDiscordDm(sageSessionToken:string,eveAccessToken:string,workspaceId:string,actorCharacterId:number,targetCharacterId:number,content:string){
  return secureDiscordMutation<{sent:boolean;messageId?:string}>(sageSessionToken,eveAccessToken,workspaceId,actorCharacterId,"discord.dm",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/dm`,"POST",{character_id:targetCharacterId,content});
}
export async function testSageDiscordDm(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number){
  return secureDiscordMutation<{sent:boolean;messageId?:string}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.test_dm",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/test-dm`,"POST",{character_id:characterId});
}
export async function unlinkSageDiscord(sageSessionToken:string,eveAccessToken:string,workspaceId:string,characterId:number){
  return secureDiscordMutation<{unlinked:boolean}>(sageSessionToken,eveAccessToken,workspaceId,characterId,"discord.unlink",`/v1/workspaces/${encodeURIComponent(workspaceId)}/discord/link?character_id=${encodeURIComponent(String(characterId))}`,"DELETE",{});
}

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


export type SageSharedWormholeChainSummary = {
  id: string;
  object_type: "sage.wormhole-chain";
  current_version: number;
  visibility: "workspace" | "restricted";
  created_at: string;
  updated_at: string;
  published_at?: string;
};

export type SageSharedWormholeChainObject = SageSharedWormholeChainSummary & {
  payload: Record<string, unknown>;
  published_by_account_id?: string;
};

export async function listSageSharedWormholeChains(sageSessionToken: string, workspaceId: string): Promise<SageSharedWormholeChainSummary[]> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects?type=sage.wormhole-chain`, {
    headers: { Authorization: `Bearer ${sageSessionToken}` },
  });
  const body = await parseResponse<{ objects?: SageSharedWormholeChainSummary[] }>(response);
  return Array.isArray(body.objects) ? body.objects : [];
}

export async function getSageSharedWormholeChain(sageSessionToken: string, workspaceId: string, objectId: string): Promise<SageSharedWormholeChainObject> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, {
    headers: { Authorization: `Bearer ${sageSessionToken}` },
  });
  return parseResponse<SageSharedWormholeChainObject>(response);
}

export async function publishSageSharedWormholeChain(sageSessionToken: string, workspaceId: string, input: { chain: Record<string, unknown>; visibility?: "workspace" | "restricted"; recipientCharacterIds?: number[] }) {
  const revision = String(input.chain.sharedRevision ?? input.chain.updatedAt ?? Date.now());
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sageSessionToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      object_type: "sage.wormhole-chain",
      payload: input.chain,
      visibility: input.visibility ?? "workspace",
      recipient_character_ids: input.recipientCharacterIds ?? [],
      idempotency_key: `wormhole-chain:${workspaceId}:${revision}`,
    }),
  });
  return parseResponse<{ id: string; object_type: "sage.wormhole-chain"; version: number; idempotent_replay?: boolean }>(response);
}

export async function updateSageSharedWormholeChain(sageSessionToken: string, workspaceId: string, objectId: string, input: { chain: Record<string, unknown>; expectedVersion: number }) {
  const revision = String(input.chain.sharedRevision ?? input.chain.updatedAt ?? Date.now());
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${sageSessionToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: input.chain,
      expected_version: input.expectedVersion,
      idempotency_key: `wormhole-chain-update:${objectId}:${input.expectedVersion}:${revision}`,
    }),
  });
  return parseResponse<{ id: string; object_type: "sage.wormhole-chain"; version: number }>(response);
}

export async function listSageWorkspaceEvents(sageSessionToken: string, workspaceId: string, after = 0) {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/event-log?after=${Math.max(0, Math.floor(after))}`, {
    headers: { Authorization: `Bearer ${sageSessionToken}` },
  });
  const body = await parseResponse<{ events?: Array<{ sequence: number; workspace_id: string; event_type: string; object_id?: string; object_version?: number; created_at: string }> }>(response);
  return Array.isArray(body.events) ? body.events : [];
}

export type SageWorkspaceAuditEntry = { id:number; actor_account_id?:string; action:string; resource_type?:string; resource_id?:string; detail?:Record<string,unknown>|null; created_at:string };
export async function listSageWorkspaceAudit(sageSessionToken:string,workspaceId:string,resourceType?:string):Promise<SageWorkspaceAuditEntry[]> {
  const suffix=resourceType?`?resource_type=${encodeURIComponent(resourceType)}`:"";
  const response=await fetch(`${SAGE_ONLINE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/audit-log${suffix}`,{headers:{Authorization:`Bearer ${sageSessionToken}`}});
  const body=await parseResponse<{audit?:SageWorkspaceAuditEntry[]}>(response);
  return Array.isArray(body.audit)?body.audit:[];
}
