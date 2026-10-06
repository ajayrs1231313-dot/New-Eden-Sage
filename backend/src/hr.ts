import type { Principal, SageEnv } from "./types";

const HR_CATEGORY_IDS = new Set([
  "identity", "corporation-history", "skills", "kill-loss", "contacts-standings", "wallet",
  "contracts", "assets", "mail", "notifications", "market", "industry", "fittings-ships",
]);
const HR_REVIEW_STATUSES = new Set(["under-review", "additional-review", "probation", "approved", "rejected", "archived"]);
const MAX_HR_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

type HrRow = {
  id:string; workspace_id:string; corporation_id:number; corporation_name:string;
  recruiter_account_id:string; recruiter_character_id:number; recruiter_name:string;
  code_hash:string; code_hint:string; requested_categories_json:string; status:string;
  created_at:string; expires_at:string; revoked_at:string|null; submitted_at:string|null; withdrawn_at:string|null;
  applicant_account_id:string|null; applicant_character_id:number|null; applicant_character_name:string|null;
  snapshot_schema_version:number|null; snapshot_json:string|null; snapshot_sha256:string|null;
  decision_by_account_id:string|null; decision_by_character_id:number|null; decision_by_character_name:string|null; decision_at:string|null;
};
type NoteRow = { id:string; recruiter_character_id:number; recruiter_name:string; note_text:string; created_at:string };

function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
function error(status:number,code:string,message:string){return json({error:code,message},status);}
function parseCategories(value:unknown){
  const raw=Array.isArray(value)?value:[];
  return [...new Set(raw.map(String).filter(item=>HR_CATEGORY_IDS.has(item)))];
}
function normalizeCode(value:string){return String(value??"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function makeCode(){
  const bytes=new Uint8Array(15);crypto.getRandomValues(bytes);
  let raw="";for(const byte of bytes)raw+=CODE_ALPHABET[byte%CODE_ALPHABET.length];
  return `NES-HR-${raw.slice(0,5)}-${raw.slice(5,10)}-${raw.slice(10,15)}`;
}
function requestView(row:HrRow){
  return {
    applicationId:row.id, corporationId:Number(row.corporation_id), corporationName:row.corporation_name,
    recruiterCharacterId:String(row.recruiter_character_id), recruiterName:row.recruiter_name,
    requestedCategories:parseCategories(safeJson(row.requested_categories_json,[])), createdAt:row.created_at,
    expiresAt:row.expires_at, submittedAt:row.submitted_at??undefined, revokedAt:row.revoked_at??undefined,
    status:row.status, codeHint:row.code_hint,
  };
}
function safeJson<T>(value:string|null|undefined,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
async function noteViews(env:SageEnv,applicationId:string){
  const rows=await env.DB.prepare("SELECT id,recruiter_character_id,recruiter_name,note_text,created_at FROM corporation_hr_notes WHERE application_id=?1 ORDER BY created_at ASC").bind(applicationId).all<NoteRow>();
  return rows.results.map(row=>({id:row.id,recruiterCharacterId:String(row.recruiter_character_id),recruiterName:row.recruiter_name,createdAt:row.created_at,text:row.note_text}));
}
async function recordView(env:SageEnv,row:HrRow,includeSnapshot=true){
  const notes=await noteViews(env,row.id);
  const snapshot=includeSnapshot&&row.snapshot_json?safeJson<Record<string,unknown>|undefined>(row.snapshot_json,undefined):undefined;
  const decision=row.decision_at&&row.decision_by_character_id?{
    status:row.status,recruiterCharacterId:String(row.decision_by_character_id),recruiterName:row.decision_by_character_name??`Character ${row.decision_by_character_id}`,decidedAt:row.decision_at,
  }:undefined;
  return {request:requestView(row),...(snapshot?{snapshot}:{}),notes,...(decision?{decision}:{})};
}
async function rowById(env:SageEnv,workspaceId:string,applicationId:string){
  return env.DB.prepare("SELECT * FROM corporation_hr_applications WHERE id=?1 AND workspace_id=?2 LIMIT 1").bind(applicationId,workspaceId).first<HrRow>();
}
async function rowByCode(env:SageEnv,code:string){
  const normalized=normalizeCode(code);if(!normalized)return null;
  const hash=await sha256Hex(normalized);
  return env.DB.prepare("SELECT * FROM corporation_hr_applications WHERE code_hash=?1 LIMIT 1").bind(hash).first<HrRow>();
}
async function expireIfNeeded(env:SageEnv,row:HrRow){
  if((row.status==="awaiting-applicant"||row.status==="in-progress")&&Date.parse(row.expires_at)<=Date.now()){
    await env.DB.prepare("UPDATE corporation_hr_applications SET status='expired',updated_at=datetime('now') WHERE id=?1 AND snapshot_json IS NULL AND status IN ('awaiting-applicant','in-progress')").bind(row.id).run();
    row.status="expired";
  }
  return row;
}
function sensitivePath(value:unknown,path="snapshot",depth=0):string|null{
  if(depth>64)return `${path} (excessive nesting)`;
  if(Array.isArray(value)){for(let i=0;i<value.length;i++){const hit=sensitivePath(value[i],`${path}[${i}]`,depth+1);if(hit)return hit;}return null;}
  if(!value||typeof value!=="object")return null;
  for(const [key,item] of Object.entries(value as Record<string,unknown>)){
    if(/^(?:access_?token|refresh_?token|session_?token|authorization|client_?secret|password|api_?key)$/i.test(key))return `${path}.${key}`;
    const hit=sensitivePath(item,`${path}.${key}`,depth+1);if(hit)return hit;
  }
  return null;
}
async function actorName(env:SageEnv,principal:Principal,characterId:number){
  const row=await env.DB.prepare("SELECT character_name FROM eve_identities WHERE account_id=?1 AND character_id=?2 LIMIT 1").bind(principal.accountId,characterId).first<{character_name:string}>();
  return row?.character_name??`Character ${characterId}`;
}
async function audit(env:SageEnv,workspaceId:string,principal:Principal,action:string,applicationId:string,detail:Record<string,unknown>={}){
  await env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,?3,'corporation.hr',?4,?5)")
    .bind(workspaceId,principal.accountId,action,applicationId,JSON.stringify(detail)).run();
}

export async function handleHrApplicantApi(request:Request,env:SageEnv,url:URL,principal:Principal):Promise<Response|null>{
  if(!url.pathname.startsWith("/v1/hr/applications/"))return null;
  if(url.pathname==="/v1/hr/applications/resolve"&&request.method==="GET"){
    const row=await rowByCode(env,url.searchParams.get("code")??"");
    if(!row)return error(404,"hr_code_invalid","That HR application code is invalid.");
    await expireIfNeeded(env,row);
    if(row.status!=="awaiting-applicant"&&row.status!=="in-progress")return error(409,"hr_code_unavailable",`That HR application is ${row.status}.`);
    return json({applicationId:row.id,corporationId:Number(row.corporation_id),corporationName:row.corporation_name,recruiterName:row.recruiter_name,requestedCategories:parseCategories(safeJson(row.requested_categories_json,[])),createdAt:row.created_at,expiresAt:row.expires_at,status:row.status,transport:"sage-online-desktop"});
  }
  if(url.pathname==="/v1/hr/applications/submit"&&request.method==="POST"){
    let body:{code?:string;character_id?:number;snapshot?:unknown};try{body=await request.json();}catch{return error(400,"invalid_json","HR submission must be valid JSON.");}
    const row=await rowByCode(env,String(body.code??""));if(!row)return error(404,"hr_code_invalid","That HR application code is invalid.");
    await expireIfNeeded(env,row);
    if(row.status!=="awaiting-applicant"&&row.status!=="in-progress")return error(409,"hr_code_unavailable",`That HR application is ${row.status}.`);
    const characterId=Number(body.character_id??0);if(!Number.isSafeInteger(characterId)||characterId<=0)return error(400,"hr_character_required","Select a linked Sage character to submit.");
    const identity=await env.DB.prepare("SELECT character_name FROM eve_identities WHERE account_id=?1 AND character_id=?2 LIMIT 1").bind(principal.accountId,characterId).first<{character_name:string}>();
    if(!identity)return error(403,"hr_character_not_owned","The submitted character is not linked to this Sage account.");
    const snapshot=body.snapshot;if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))return error(400,"hr_snapshot_invalid","The one-time HR snapshot is missing or invalid.");
    const s=snapshot as Record<string,any>;
    if(String(s.applicationId??"")!==row.id)return error(409,"hr_application_mismatch","The snapshot application ID does not match this code.");
    if(String(s.applicantCharacterId??"")!==String(characterId))return error(409,"hr_character_mismatch","The snapshot character does not match the linked character being submitted.");
    if(String(s.submissionMethod??"")!=="sage-desktop")return error(400,"hr_submission_method_invalid","This endpoint accepts Sage Desktop snapshots only.");
    const requested=parseCategories(safeJson(row.requested_categories_json,[]));
    if(JSON.stringify(parseCategories(s.requestedCategories))!==JSON.stringify(requested))return error(409,"hr_request_categories_mismatch","The snapshot request categories do not match the original recruiter request.");
    const sensitive=sensitivePath(snapshot);if(sensitive)return error(400,"hr_snapshot_contains_credentials",`The HR snapshot contains a credential-like field at ${sensitive}.`);
    const snapshotJson=JSON.stringify(snapshot);const bytes=new TextEncoder().encode(snapshotJson).byteLength;
    if(bytes>MAX_HR_SNAPSHOT_BYTES)return error(413,"hr_snapshot_too_large",`The HR snapshot is ${(bytes/1048576).toFixed(1)} MB; the desktop submission limit is 8 MB.`);
    const snapshotHash=await sha256Hex(snapshotJson);const now=new Date().toISOString();
    const result=await env.DB.prepare(`UPDATE corporation_hr_applications SET status='submitted',submitted_at=?2,applicant_account_id=?3,applicant_character_id=?4,applicant_character_name=?5,snapshot_schema_version=?6,snapshot_json=?7,snapshot_sha256=?8,updated_at=?2 WHERE id=?1 AND snapshot_json IS NULL AND status IN ('awaiting-applicant','in-progress') AND julianday(expires_at)>julianday('now')`)
      .bind(row.id,now,principal.accountId,characterId,identity.character_name,Number(s.schemaVersion??1),snapshotJson,snapshotHash).run();
    if(Number(result.meta.changes??0)!==1)return error(409,"hr_snapshot_already_finalized","That one-time HR request was already submitted, revoked, withdrawn or expired.");
    await audit(env,row.workspace_id,principal,"corporation.hr.submit",row.id,{applicant_character_id:characterId,snapshot_sha256:snapshotHash,provided_categories:Array.isArray(s.providedCategories)?s.providedCategories.length:0,withheld_categories:Array.isArray(s.withheldCategories)?s.withheldCategories.length:0});
    const updated=await rowById(env,row.workspace_id,row.id);return updated?json(await recordView(env,updated,true)):error(500,"hr_submission_missing","Submitted HR record could not be reloaded.");
  }
  if(url.pathname==="/v1/hr/applications/withdraw"&&request.method==="POST"){
    let body:{code?:string};try{body=await request.json();}catch{return error(400,"invalid_json","HR withdrawal must be valid JSON.");}
    const row=await rowByCode(env,String(body.code??""));if(!row)return error(404,"hr_code_invalid","That HR application code is invalid.");
    if(row.snapshot_json)return error(409,"hr_already_submitted","A submitted immutable snapshot cannot be withdrawn or altered through the application code.");
    if(row.status!=="awaiting-applicant"&&row.status!=="in-progress")return error(409,"hr_code_unavailable",`That HR application is ${row.status}.`);
    const now=new Date().toISOString();await env.DB.prepare("UPDATE corporation_hr_applications SET status='withdrawn',withdrawn_at=?2,updated_at=?2 WHERE id=?1 AND snapshot_json IS NULL").bind(row.id,now).run();
    await audit(env,row.workspace_id,principal,"corporation.hr.withdraw",row.id,{});return json({withdrawn:true,applicationId:row.id});
  }
  return null;
}

type HrRecruiterContextResult =
  | { error: Response }
  | {
      workspace: { id:string; eve_corporation_id:number; name:string };
      identity: { character_id:number; character_name:string; corporation_id:number|null };
    };

async function resolveHrRecruiterContext(
  env:SageEnv,
  principal:Principal,
  characterId:number,
  corporationId:number,
  corporationName?:string,
):Promise<HrRecruiterContextResult>{
  if(!Number.isSafeInteger(characterId)||characterId<=0)return {error:error(400,"character_required","A valid Sage character is required.")};
  if(!Number.isSafeInteger(corporationId)||corporationId<=0)return {error:error(400,"corporation_required","A valid corporation is required.")};

  const identity=await env.DB.prepare(
    "SELECT character_id,character_name,corporation_id FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1"
  ).bind(characterId,principal.accountId).first<{character_id:number;character_name:string;corporation_id:number|null}>();
  if(!identity)return {error:error(403,"hr_character_not_linked","That character is not linked to this Sage account.")};
  if(Number(identity.corporation_id??0)!==corporationId){
    return {error:error(409,"hr_corporation_mismatch","The selected character's stored Sage corporation does not match this HR workspace. Refresh the character if their corporation recently changed.")};
  }

  let workspace=await env.DB.prepare(
    "SELECT id,eve_corporation_id,name FROM workspaces WHERE type='corporation' AND eve_corporation_id=?1 AND archived_at IS NULL LIMIT 1"
  ).bind(corporationId).first<{id:string;eve_corporation_id:number;name:string}>();

  if(!workspace){
    const workspaceId=`corp_${corporationId}`;
    const safeName=String(corporationName||`Corporation ${corporationId}`).trim().slice(0,200)||`Corporation ${corporationId}`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO workspaces (id,type,eve_corporation_id,name,created_at,updated_at) VALUES (?1,'corporation',?2,?3,datetime('now'),datetime('now'))"
    ).bind(workspaceId,corporationId,safeName).run();
    workspace=await env.DB.prepare(
      "SELECT id,eve_corporation_id,name FROM workspaces WHERE type='corporation' AND eve_corporation_id=?1 AND archived_at IS NULL LIMIT 1"
    ).bind(corporationId).first<{id:string;eve_corporation_id:number;name:string}>();
  }
  if(!workspace)return {error:error(500,"hr_workspace_missing","HR workspace could not be resolved.")};

  await env.DB.prepare(
    "INSERT OR REPLACE INTO workspace_members (workspace_id,account_id,eve_character_id,membership_state,last_verified_at,created_at) VALUES (?1,?2,?3,'active',datetime('now'),COALESCE((SELECT created_at FROM workspace_members WHERE workspace_id=?1 AND account_id=?2 AND eve_character_id=?3),datetime('now')))"
  ).bind(workspace.id,principal.accountId,characterId).run();

  return {workspace,identity};
}

export async function handleHrRecruiterApi(
  request:Request,
  env:SageEnv,
  url:URL,
  principal:Principal,
):Promise<Response|null>{
  if(!url.pathname.startsWith("/v1/hr/recruiter"))return null;

  const characterId=Number(url.searchParams.get("character_id")??request.headers.get("X-Sage-Character-ID")??0);
  const corporationId=Number(url.searchParams.get("corporation_id")??request.headers.get("X-Sage-Corporation-ID")??0);
  const corporationName=url.searchParams.get("corporation_name")??request.headers.get("X-Sage-Corporation-Name")??undefined;
  const ctx=await resolveHrRecruiterContext(env,principal,characterId,corporationId,corporationName);
  if("error" in ctx)return ctx.error;
  const {workspace,identity}=ctx;

  if(url.pathname==="/v1/hr/recruiter/state"&&request.method==="GET"){
    await env.DB.prepare("UPDATE corporation_hr_applications SET status='expired',updated_at=datetime('now') WHERE workspace_id=?1 AND snapshot_json IS NULL AND status IN ('awaiting-applicant','in-progress') AND julianday(expires_at)<=julianday('now')").bind(workspace.id).run();
    const rows=await env.DB.prepare("SELECT * FROM corporation_hr_applications WHERE workspace_id=?1 ORDER BY created_at DESC LIMIT 500").bind(workspace.id).all<HrRow>();
    const applications=[];for(const row of rows.results)applications.push(await recordView(env,row,true));
    return json({workspace:{workspace_id:workspace.id,corporation_id:workspace.eve_corporation_id,name:workspace.name,character_id:identity.character_id,character_name:identity.character_name,can_manage_hr:true,can_review_hr:true},applications,transport:"sage-online-desktop"});
  }

  if(url.pathname==="/v1/hr/recruiter/request"&&request.method==="POST"){
    let body:{requested_categories?:unknown[];expires_in_hours?:number};
    try{body=await request.json();}catch{return error(400,"invalid_json","HR request must be valid JSON.");}
    const requested=parseCategories(body.requested_categories);
    if(!requested.length)return error(400,"hr_categories_required","Select at least one HR information category.");
    const hours=Math.max(1,Math.min(720,Number(body.expires_in_hours??168)||168));
    const now=new Date();const expires=new Date(now.getTime()+hours*3600000).toISOString();
    let code="",hash="";
    for(let attempt=0;attempt<8;attempt++){
      code=makeCode();hash=await sha256Hex(normalizeCode(code));
      const exists=await env.DB.prepare("SELECT 1 AS ok FROM corporation_hr_applications WHERE code_hash=?1 LIMIT 1").bind(hash).first();
      if(!exists)break;
      if(attempt===7)return error(503,"hr_code_generation_failed","Could not allocate a unique application code.");
    }
    const id=`hr_${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO corporation_hr_applications (id,workspace_id,corporation_id,corporation_name,recruiter_account_id,recruiter_character_id,recruiter_name,code_hash,code_hint,requested_categories_json,status,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'awaiting-applicant',?11,?12)")
      .bind(id,workspace.id,corporationId,workspace.name,principal.accountId,characterId,identity.character_name,hash,code.slice(-5),JSON.stringify(requested),now.toISOString(),expires).run();
    await audit(env,workspace.id,principal,"corporation.hr.create",id,{recruiter_character_id:characterId,requested_categories:requested,expires_at:expires});
    const row=await rowById(env,workspace.id,id);
    return row?json({request:requestView(row),applicationCode:code,transport:"sage-online-desktop"},201):error(500,"hr_create_missing","HR request could not be reloaded.");
  }

  const revoke=url.pathname.match(/^\/v1\/hr\/recruiter\/applications\/([^/]+)\/revoke$/);
  if(revoke&&request.method==="POST"){
    const id=decodeURIComponent(revoke[1]);const row=await rowById(env,workspace.id,id);
    if(!row)return error(404,"hr_application_not_found","HR application not found.");
    if(row.snapshot_json)return error(409,"hr_already_submitted","Submitted snapshots are immutable and cannot be revoked.");
    const now=new Date().toISOString();
    const result=await env.DB.prepare("UPDATE corporation_hr_applications SET status='revoked',revoked_at=?3,updated_at=?3 WHERE id=?1 AND workspace_id=?2 AND snapshot_json IS NULL AND status IN ('awaiting-applicant','in-progress')").bind(id,workspace.id,now).run();
    if(Number(result.meta.changes??0)!==1)return error(409,"hr_not_revocable",`This application is ${row.status}.`);
    await audit(env,workspace.id,principal,"corporation.hr.revoke",id,{actor_character_id:characterId});
    const updated=await rowById(env,workspace.id,id);return updated?json(await recordView(env,updated,true)):error(500,"hr_revoke_missing","Revoked record could not be reloaded.");
  }

  const note=url.pathname.match(/^\/v1\/hr\/recruiter\/applications\/([^/]+)\/notes$/);
  if(note&&request.method==="POST"){
    const id=decodeURIComponent(note[1]);const row=await rowById(env,workspace.id,id);
    if(!row)return error(404,"hr_application_not_found","HR application not found.");
    if(!row.snapshot_json)return error(409,"hr_snapshot_required","Recruiter notes can be added after the applicant submits a snapshot.");
    let body:{text?:string};try{body=await request.json();}catch{return error(400,"invalid_json","Recruiter note must be valid JSON.");}
    const noteText=String(body.text??"").trim();if(!noteText)return error(400,"hr_note_required","Recruiter note text is required.");
    if(noteText.length>5000)return error(413,"hr_note_too_large","Recruiter notes are limited to 5,000 characters.");
    const noteId=`hrnote_${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO corporation_hr_notes (id,application_id,recruiter_account_id,recruiter_character_id,recruiter_name,note_text,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
      .bind(noteId,id,principal.accountId,characterId,identity.character_name,noteText,new Date().toISOString()).run();
    await audit(env,workspace.id,principal,"corporation.hr.note",id,{note_id:noteId,actor_character_id:characterId});
    const updated=await rowById(env,workspace.id,id);return updated?json(await recordView(env,updated,true)):error(500,"hr_note_missing","HR record could not be reloaded.");
  }

  const decision=url.pathname.match(/^\/v1\/hr\/recruiter\/applications\/([^/]+)\/decision$/);
  if(decision&&request.method==="POST"){
    const id=decodeURIComponent(decision[1]);const row=await rowById(env,workspace.id,id);
    if(!row)return error(404,"hr_application_not_found","HR application not found.");
    if(!row.snapshot_json)return error(409,"hr_snapshot_required","A submitted applicant snapshot is required before recording a review status.");
    let body:{status?:string};try{body=await request.json();}catch{return error(400,"invalid_json","HR decision must be valid JSON.");}
    const status=String(body.status??"");if(!HR_REVIEW_STATUSES.has(status))return error(400,"hr_status_invalid","Unsupported HR review status.");
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE corporation_hr_applications SET status=?3,decision_by_account_id=?4,decision_by_character_id=?5,decision_by_character_name=?6,decision_at=?7,updated_at=?7 WHERE id=?1 AND workspace_id=?2 AND snapshot_json IS NOT NULL")
      .bind(id,workspace.id,status,principal.accountId,characterId,identity.character_name,now).run();
    await audit(env,workspace.id,principal,"corporation.hr.decision",id,{status,actor_character_id:characterId});
    const updated=await rowById(env,workspace.id,id);return updated?json(await recordView(env,updated,true)):error(500,"hr_decision_missing","HR record could not be reloaded.");
  }

  return null;
}
