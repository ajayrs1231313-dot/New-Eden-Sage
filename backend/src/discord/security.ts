import { verifyEveAccessToken } from "../identity";
import type { Principal, SageEnv } from "../types";

const DEVICE_CLOCK_SKEW_MS=120_000;
const ACTION_TICKET_SECONDS=45;
const DEVICE_ID_RE=/^dev_[a-zA-Z0-9-]{20,80}$/;
const HASH_RE=/^[a-f0-9]{64}$/;
const NONCE_RE=/^[a-zA-Z0-9_-]{16,120}$/;
const ALLOWED_ACTIONS=new Set(["discord.configure","discord.announce","discord.operation_announce","discord.operation_cancel","discord.operation_notifications","discord.notifications","discord.dm","discord.test_dm","discord.unlink"]);
const ACTION_RATE_LIMITS:Record<string,{seconds:number;limit:number}>={
  "discord.configure":{seconds:600,limit:20},
  "discord.announce":{seconds:60,limit:6},
  "discord.operation_announce":{seconds:60,limit:6},
  "discord.operation_cancel":{seconds:300,limit:12},
  "discord.operation_notifications":{seconds:300,limit:20},
  "discord.notifications":{seconds:300,limit:12},
  "discord.dm":{seconds:60,limit:12},
  "discord.test_dm":{seconds:300,limit:5},
  "discord.unlink":{seconds:300,limit:10},
};

function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
function fail(status:number,code:string,message:string){return json({error:code,message},status);}
function b64ToBytes(value:string){const binary=atob(value);return Uint8Array.from(binary,char=>char.charCodeAt(0));}
function bytesToB64Url(bytes:Uint8Array){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
async function sha256Bytes(bytes:Uint8Array){const source=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return new Uint8Array(await crypto.subtle.digest("SHA-256",source));}
async function sha256Hex(value:string|Uint8Array){const bytes=typeof value==="string"?new TextEncoder().encode(value):value;const digest=await sha256Bytes(bytes);return [...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function importP256PublicKey(spkiB64:string){return crypto.subtle.importKey("spki",b64ToBytes(spkiB64),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);}
async function verifyP256(publicKeySpkiB64:string,signatureB64:string,message:string){try{const key=await importP256PublicKey(publicKeySpkiB64);return crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,b64ToBytes(signatureB64),new TextEncoder().encode(message));}catch{return false;}}
function freshTimestamp(raw:string|null){const value=Number(raw??NaN);return Number.isFinite(value)&&Math.abs(Date.now()-value)<=DEVICE_CLOCK_SKEW_MS?value:null;}

export async function registerDiscordDevice(request:Request,env:SageEnv,principal:Principal){
  let body:{device_id?:string;public_key_spki_b64?:string;fingerprint_sha256?:string;platform?:string;label?:string;timestamp_ms?:number;nonce?:string;signature_b64?:string};
  try{body=await request.json();}catch{return fail(400,"invalid_json","Discord device registration must be valid JSON.");}
  const deviceId=String(body.device_id??"").trim();
  const publicKey=String(body.public_key_spki_b64??"").trim();
  const fingerprint=String(body.fingerprint_sha256??"").toLowerCase();
  const nonce=String(body.nonce??"").trim();
  const signature=String(body.signature_b64??"").trim();
  const timestamp=Number(body.timestamp_ms??0);
  if(!DEVICE_ID_RE.test(deviceId)||!publicKey||publicKey.length>2048||!HASH_RE.test(fingerprint)||!NONCE_RE.test(nonce)||!signature)return fail(400,"discord_device_invalid","Discord device proof is incomplete or invalid.");
  if(!freshTimestamp(String(timestamp)))return fail(401,"discord_device_stale","Discord device proof expired. Check the system clock and try again.");
  let publicBytes:Uint8Array;
  try{publicBytes=b64ToBytes(publicKey);}catch{return fail(400,"discord_device_key_invalid","Discord device public key is invalid.");}
  if(await sha256Hex(publicBytes)!==fingerprint)return fail(400,"discord_device_fingerprint","Discord device fingerprint did not match its public key.");
  const canonical=`NES-DISCORD-DEVICE-V1\n${deviceId}\n${timestamp}\n${nonce}\n${fingerprint}`;
  if(!(await verifyP256(publicKey,signature,canonical)))return fail(401,"discord_device_signature","Discord device possession proof was invalid.");

  const eveToken=request.headers.get("X-EVE-Access-Token")??"";
  if(!eveToken)return fail(401,"discord_device_eve_required","A current EVE identity proof is required to register this Sage device.");
  let eveIdentity;
  try{eveIdentity=await verifyEveAccessToken(eveToken,env);}catch{return fail(401,"discord_device_eve_invalid","The EVE identity proof for this Sage device was invalid.");}
  const owned=await env.DB.prepare("SELECT 1 AS ok FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1").bind(eveIdentity.characterId,principal.accountId).first();
  if(!owned)return fail(403,"discord_device_account_mismatch","This EVE character is not linked to the active Sage account.");

  const session=await env.DB.prepare("SELECT device_id FROM sessions WHERE id=?1 AND account_id=?2 LIMIT 1").bind(principal.sessionId,principal.accountId).first<{device_id:string|null}>();
  if(!session)return fail(401,"invalid_session","The Sage Online session is invalid or expired.");
  if(session.device_id&&session.device_id!==deviceId)return fail(409,"discord_session_device_locked","This Sage session is already locked to another device.");
  const existingDevice=await env.DB.prepare("SELECT account_id FROM devices WHERE id=?1 LIMIT 1").bind(deviceId).first<{account_id:string}>();
  if(existingDevice&&existingDevice.account_id!==principal.accountId)return fail(409,"discord_device_conflict","This Sage device identity belongs to another account.");

  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (id,account_id,label,platform,last_seen_at) VALUES (?1,?2,?3,?4,datetime('now')) ON CONFLICT(id) DO UPDATE SET label=excluded.label,platform=excluded.platform,last_seen_at=datetime('now')").bind(deviceId,principal.accountId,String(body.label??"New Eden Sage Desktop").slice(0,100),String(body.platform??"desktop").slice(0,60)),
    env.DB.prepare("INSERT INTO discord_device_keys (device_id,account_id,public_key_spki_b64,fingerprint_sha256,last_seen_at) VALUES (?1,?2,?3,?4,datetime('now')) ON CONFLICT(device_id) DO UPDATE SET public_key_spki_b64=excluded.public_key_spki_b64,fingerprint_sha256=excluded.fingerprint_sha256,last_seen_at=datetime('now'),revoked_at=NULL").bind(deviceId,principal.accountId,publicKey,fingerprint),
    env.DB.prepare("UPDATE sessions SET device_id=?1,last_seen_at=datetime('now') WHERE id=?2 AND account_id=?3 AND (device_id IS NULL OR device_id=?1)").bind(deviceId,principal.sessionId,principal.accountId),
    env.DB.prepare("INSERT INTO audit_log (actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,'discord.device.register','sage.device',?2,?3)").bind(principal.accountId,deviceId,JSON.stringify({fingerprint,character_id:eveIdentity.characterId})),
  ]);
  return json({registered:true,deviceId,fingerprint});
}

export async function issueDiscordActionTicket(request:Request,env:SageEnv,principal:Principal,workspaceId:string){
  let body:{action?:string;payload_hash?:string;character_id?:number};
  try{body=await request.json();}catch{return fail(400,"invalid_json","Discord action ticket request must be valid JSON.");}
  const action=String(body.action??"");
  const payloadHash=String(body.payload_hash??"").toLowerCase();
  const characterId=Number(body.character_id??0);
  if(!ALLOWED_ACTIONS.has(action)||!HASH_RE.test(payloadHash)||!Number.isSafeInteger(characterId)||characterId<=0)return fail(400,"discord_action_invalid","Discord action, character, or payload hash is invalid.");
  const membership=await env.DB.prepare("SELECT 1 AS ok FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND membership_state='active' LIMIT 1").bind(workspaceId,principal.accountId,characterId).first();
  if(!membership)return fail(403,"discord_character_not_member","The selected EVE character is not an active member of this corporation workspace.");
  const deviceId=String(request.headers.get("X-Sage-Device-ID")??"");
  const timestamp=freshTimestamp(request.headers.get("X-Sage-Request-Time"));
  const nonce=String(request.headers.get("X-Sage-Nonce")??"");
  const signature=String(request.headers.get("X-Sage-Signature")??"");
  if(!DEVICE_ID_RE.test(deviceId)||timestamp===null||!NONCE_RE.test(nonce)||!signature)return fail(401,"discord_device_proof_required","A fresh signed Sage device proof is required for Discord commands.");
  const row=await env.DB.prepare("SELECT s.device_id,dk.public_key_spki_b64 FROM sessions s JOIN discord_device_keys dk ON dk.device_id=s.device_id AND dk.account_id=s.account_id WHERE s.id=?1 AND s.account_id=?2 AND s.revoked_at IS NULL AND dk.revoked_at IS NULL LIMIT 1").bind(principal.sessionId,principal.accountId).first<{device_id:string;public_key_spki_b64:string}>();
  if(!row||row.device_id!==deviceId)return fail(401,"discord_device_required","Register this Sage desktop device before issuing Discord commands.");
  const canonical=`NES-DISCORD-ACTION-V1\n${workspaceId}\n${characterId}\n${action}\n${payloadHash}\n${timestamp}\n${nonce}`;
  if(!(await verifyP256(row.public_key_spki_b64,signature,canonical)))return fail(401,"discord_device_signature","The Sage device signature was invalid.");
  try{await env.DB.prepare("INSERT INTO discord_command_nonces (device_id,nonce,request_time_ms,expires_at) VALUES (?1,?2,?3,datetime('now','+3 minutes'))").bind(deviceId,nonce,timestamp).run();}
  catch{return fail(409,"discord_command_replay","This signed Discord command proof has already been used.");}
  const ticketBytes=crypto.getRandomValues(new Uint8Array(32));
  const ticket=bytesToB64Url(ticketBytes);
  const ticketHash=await sha256Hex(ticket);
  await env.DB.prepare("INSERT INTO discord_action_tickets (token_hash,workspace_id,account_id,session_id,device_id,eve_character_id,action,payload_hash,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,datetime('now','+45 seconds'))").bind(ticketHash,workspaceId,principal.accountId,principal.sessionId,deviceId,characterId,action,payloadHash).run();
  return json({ticket,expiresInSeconds:ACTION_TICKET_SECONDS});
}

export async function consumeDiscordActionTicket(request:Request,env:SageEnv,principal:Principal,workspaceId:string,action:string):Promise<Response|null>{
  const ticket=String(request.headers.get("X-Sage-Action-Ticket")??"");
  const characterId=Number(request.headers.get("X-Sage-Character-ID")??0);
  if(!ticket||!Number.isSafeInteger(characterId)||characterId<=0)return fail(401,"discord_action_ticket_required","A one-use Sage Online Discord action ticket bound to the selected character is required.");
  const bodyText=await request.clone().text();
  const payloadHash=await sha256Hex(bodyText);
  const ticketHash=await sha256Hex(ticket);
  const row=await env.DB.prepare("SELECT token_hash,device_id,eve_character_id FROM discord_action_tickets WHERE token_hash=?1 AND workspace_id=?2 AND account_id=?3 AND session_id=?4 AND eve_character_id=?5 AND action=?6 AND payload_hash=?7 AND used_at IS NULL AND expires_at>datetime('now') LIMIT 1").bind(ticketHash,workspaceId,principal.accountId,principal.sessionId,characterId,action,payloadHash).first<{token_hash:string;device_id:string;eve_character_id:number}>();
  if(!row)return fail(401,"discord_action_ticket_invalid","The Sage Online Discord action ticket is invalid, expired, already used, or does not match this character/command.");
  const consumed=await env.DB.prepare("UPDATE discord_action_tickets SET used_at=datetime('now') WHERE token_hash=?1 AND used_at IS NULL").bind(ticketHash).run();
  if(Number(consumed.meta?.changes??0)!==1)return fail(409,"discord_action_replay","This Discord action ticket has already been consumed.");
  const rule=ACTION_RATE_LIMITS[action]??{seconds:60,limit:10};
  const since=new Date(Date.now()-rule.seconds*1000).toISOString().replace("T"," ").replace(/\.\d{3}Z$/,"");
  const count=(await env.DB.prepare("SELECT COUNT(*) AS count FROM discord_command_events WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3 AND action=?4 AND created_at>=?5").bind(workspaceId,principal.accountId,characterId,action,since).first<{count:number}>())?.count??0;
  if(Number(count)>=rule.limit)return fail(429,"discord_rate_limited","Too many Discord commands were requested from this Sage character. Wait a moment and try again.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO discord_command_events (workspace_id,account_id,session_id,device_id,eve_character_id,action,payload_hash) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(workspaceId,principal.accountId,principal.sessionId,row.device_id,characterId,action,payloadHash),
    env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'discord.command.accepted','discord.command',?3,?4)").bind(workspaceId,principal.accountId,action,JSON.stringify({device_id:row.device_id,eve_character_id:characterId,payload_hash:payloadHash})),
  ]);
  return null;
}

export async function cleanupDiscordSecurity(env:SageEnv){
  await env.DB.batch([
    env.DB.prepare("DELETE FROM discord_command_nonces WHERE expires_at<=datetime('now')"),
    env.DB.prepare("DELETE FROM discord_action_tickets WHERE expires_at<=datetime('now') OR used_at<datetime('now','-1 day')"),
    env.DB.prepare("DELETE FROM discord_command_events WHERE created_at<datetime('now','-7 days')"),
  ]).catch(()=>undefined);
}
