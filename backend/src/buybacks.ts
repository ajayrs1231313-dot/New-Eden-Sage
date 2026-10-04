type Helpers = {
  hasPermission: (workspaceId:string, accountId:string, permission:string, characterId?:number)=>Promise<boolean>;
  getActiveMembership: (workspaceId:string, accountId:string, characterId?:number)=>Promise<any>;
  parseStringArray: (value:string|null)=>string[];
  newId: (prefix:string)=>string;
  json: (value:unknown,status?:number)=>Response;
  error: (status:number,code:string,message:string)=>Response;
};

function parsePayload(value: string | null | undefined) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function serializeRow(row: any) {
  if (!row) return row;
  const { payload_json, ...rest } = row;
  return { ...rest, payload: parsePayload(payload_json) };
}

export async function handleBuybackWorkspaceApi(
  request: Request,
  env: any,
  url: URL,
  principal: any,
  workspaceId: string,
  tail: string,
  h: Helpers,
): Promise<Response | null> {
  if (tail === "buybacks" && request.method === "GET") {
    const actorCharacterId = Number(url.searchParams.get("character_id") ?? request.headers.get("X-Sage-Character-ID") ?? 0);
    const canManage = Number.isSafeInteger(actorCharacterId) && actorCharacterId > 0
      ? await h.hasPermission(workspaceId, principal.accountId, "buyback.manage", actorCharacterId)
      : false;
    const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
    const mineOnly = !canManage || url.searchParams.get("mine") === "true";
    const clauses = ["workspace_id = ?1"];
    const bindings: unknown[] = [workspaceId];
    if (mineOnly) {
      bindings.push(principal.accountId);
      clauses.push("issuer_account_id = ?" + bindings.length);
    }
    if (status) {
      bindings.push(status);
      clauses.push("status = ?" + bindings.length);
    }
    const result = await env.DB.prepare(
      "SELECT * FROM buyback_requests WHERE " + clauses.join(" AND ") + " ORDER BY submitted_at DESC, created_at DESC LIMIT 1000"
    ).bind(...bindings).all();
    const rows = result.results.map(serializeRow);
    const eventsByRequest: Record<string, unknown[]> = {};
    for (const row of rows) {
      const requestId = String((row as any).id ?? "");
      if (!requestId) continue;
      const events = await env.DB.prepare(
        "SELECT id,event_type,actor_account_id,actor_character_id,actor_character_name,detail_json,created_at FROM buyback_events WHERE request_id=?1 ORDER BY id ASC"
      ).bind(requestId).all();
      eventsByRequest[requestId] = events.results.map((event:any) => {
        const { detail_json, ...rest } = event;
        return { ...rest, detail: parsePayload(String(detail_json ?? "")) };
      });
    }
    return h.json({ requests: rows.map((row:any) => ({ ...row, events: eventsByRequest[String(row.id)] ?? [] })), can_manage: canManage });
  }

  if (tail === "buybacks" && request.method === "POST") {
    const actorCharacterId = Number(request.headers.get("X-Sage-Character-ID") ?? 0);
    if (!Number.isSafeInteger(actorCharacterId) || actorCharacterId <= 0) return h.error(400,"character_required","Select the corporation character submitting this buyback.");
    const membership = await h.getActiveMembership(workspaceId, principal.accountId, actorCharacterId);
    if (!membership) return h.error(403,"character_not_member","The selected character is not an active member of this corporation Sage account.");
    const identity = await env.DB.prepare("SELECT character_name,corporation_id FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1")
      .bind(actorCharacterId, principal.accountId).first();
    const workspace = await env.DB.prepare("SELECT eve_corporation_id FROM workspaces WHERE id=?1 LIMIT 1").bind(workspaceId).first();
    let body:any;
    try { body=await request.json(); } catch { return h.error(400,"invalid_json","Buyback request must be valid JSON."); }
    const contractId=Number(body?.contract_id??0);
    const corporationId=Number(body?.corporation_id??0);
    const issuerCharacterId=Number(body?.issuer_character_id??0);
    const title=String(body?.contract_title??"").trim();
    const items=Array.isArray(body?.items)?body.items:[];
    const gross=Number(body?.gross_value_isk??0);
    const payout=Number(body?.payout_isk??0);
    const percent=Number(body?.payout_percent??0);
    if(!Number.isSafeInteger(contractId)||contractId<=0)return h.error(400,"contract_required","A valid EVE contract ID is required.");
    if(issuerCharacterId!==actorCharacterId)return h.error(403,"issuer_mismatch","The buyback contract must have been issued by the selected Sage character.");
    if(!workspace?.eve_corporation_id||corporationId!==Number(workspace.eve_corporation_id)||corporationId!==Number(identity?.corporation_id??0))return h.error(403,"corporation_mismatch","The buyback contract must be assigned to the selected character's current corporation.");
    if(!/buyback/i.test(title))return h.error(400,"buyback_title_required","The EVE contract title must contain BUYBACK.");
    if(!items.length)return h.error(400,"buyback_items_required","The contract does not contain eligible buyback items.");
    if(!Number.isFinite(gross)||gross<0||!Number.isFinite(payout)||payout<0||!Number.isFinite(percent)||percent<0||percent>100)return h.error(400,"invalid_valuation","The submitted buyback valuation is invalid.");

    const existing = await env.DB.prepare("SELECT * FROM buyback_requests WHERE workspace_id=?1 AND contract_id=?2 LIMIT 1").bind(workspaceId,contractId).first();
    if(existing) {
      if(String(existing.issuer_account_id)!==principal.accountId)return h.error(409,"contract_already_submitted","That contract is already attached to another Sage buyback request.");
      return h.json({ request: serializeRow(existing), idempotent_replay:true });
    }

    const now=new Date().toISOString();
    const id=h.newId("bb");
    const characterName=String(identity?.character_name??("Character "+actorCharacterId));
    const payload={
      items,
      valuation_source: body?.valuation_source??null,
      quote_created_at: String(body?.quote_created_at??now),
      contract_price_isk: Number(body?.contract_price_isk??0),
      start_location_id: Number(body?.start_location_id??0)||null,
      contract_type: String(body?.contract_type??"item_exchange"),
      contract_snapshot: body?.contract_snapshot??null,
    };
    const itemCount=items.reduce((sum:number,item:any)=>sum+Math.max(0,Number(item?.quantity??0)||0),0);
    const margin=Math.max(0,gross-payout);

    await env.DB.batch([
      env.DB.prepare("INSERT INTO buyback_requests (id,workspace_id,contract_id,issuer_character_id,issuer_account_id,issuer_character_name,corporation_id,contract_title,contract_status,contract_issued_at,contract_expires_at,detected_at,submitted_at,last_synced_at,gross_value_isk,payout_isk,payout_percent,corp_margin_isk,item_count,payload_json,status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,'pending')")
        .bind(id,workspaceId,contractId,actorCharacterId,principal.accountId,characterName,corporationId,title,String(body?.contract_status??"outstanding"),body?.contract_issued_at??null,body?.contract_expires_at??null,String(body?.detected_at??now),now,now,gross,payout,percent,margin,itemCount,JSON.stringify(payload)),
      env.DB.prepare("INSERT INTO buyback_events (workspace_id,request_id,contract_id,event_type,actor_account_id,actor_character_id,actor_character_name,detail_json,created_at) VALUES (?1,?2,?3,'submitted',?4,?5,?6,?7,?8)")
        .bind(workspaceId,id,contractId,principal.accountId,actorCharacterId,characterName,JSON.stringify({gross_value_isk:gross,payout_isk:payout,payout_percent:percent,item_count:itemCount}),now),
      env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,'buyback.submit','buyback.request',?3,?4)")
        .bind(workspaceId,principal.accountId,id,JSON.stringify({contract_id:contractId,issuer_character_id:actorCharacterId,payout_isk:payout})),
    ]);

    const members=await env.DB.prepare("SELECT wm.account_id,ei.roles_json FROM workspace_members wm LEFT JOIN eve_identities ei ON ei.character_id=wm.eve_character_id WHERE wm.workspace_id=?1 AND wm.membership_state='active'").bind(workspaceId).all();
    const directorAccounts=new Set<string>();
    for(const row of members.results) if(h.parseStringArray(row.roles_json).includes("Director")) directorAccounts.add(String(row.account_id));
    for(const accountId of directorAccounts){
      const notificationId="buyback:"+id+":"+accountId;
      await env.DB.prepare("INSERT OR IGNORE INTO buyback_notifications (id,workspace_id,request_id,recipient_account_id,title,message,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
        .bind(notificationId,workspaceId,id,accountId,"New buyback request - "+characterName,"Contract #"+contractId+" - "+Math.round(payout).toLocaleString("en-US")+" ISK pending payment",now).run();
    }
    const inserted=await env.DB.prepare("SELECT * FROM buyback_requests WHERE id=?1").bind(id).first();
    return h.json({ request: serializeRow(inserted), notified_director_accounts: directorAccounts.size },201);
  }

  const stateMatch=tail.match(/^buybacks\/([^/]+)\/state$/);
  if(stateMatch && request.method==="POST"){
    const requestId=decodeURIComponent(stateMatch[1]);
    const actorCharacterId=Number(request.headers.get("X-Sage-Character-ID")??0);
    if(!Number.isSafeInteger(actorCharacterId)||actorCharacterId<=0||!(await h.hasPermission(workspaceId,principal.accountId,"buyback.manage",actorCharacterId)))return h.error(403,"permission_denied","Director authority is required to close a buyback request.");
    const identity=await env.DB.prepare("SELECT character_name FROM eve_identities WHERE character_id=?1 AND account_id=?2 LIMIT 1").bind(actorCharacterId,principal.accountId).first();
    let body:any;
    try{body=await request.json();}catch{return h.error(400,"invalid_json","Buyback action must be valid JSON.");}
    const next=String(body?.status??"").toLowerCase();
    if(next!=="paid"&&next!=="rejected")return h.error(400,"invalid_buyback_state","A director may mark this request Paid or Rejected.");
    const current=await env.DB.prepare("SELECT * FROM buyback_requests WHERE id=?1 AND workspace_id=?2 LIMIT 1").bind(requestId,workspaceId).first();
    if(!current)return h.error(404,"buyback_not_found","Buyback request not found.");
    if(current.status!=="pending")return h.error(409,"buyback_already_closed","Only pending buyback requests can be closed.");
    const now=new Date().toISOString();
    const name=String(identity?.character_name??("Character "+actorCharacterId));
    if(next==="paid"){
      await env.DB.prepare("UPDATE buyback_requests SET status='paid',paid_by_account_id=?1,paid_by_character_id=?2,paid_by_character_name=?3,paid_at=?4,updated_at=?4 WHERE id=?5 AND workspace_id=?6")
        .bind(principal.accountId,actorCharacterId,name,now,requestId,workspaceId).run();
    }else{
      await env.DB.prepare("UPDATE buyback_requests SET status='rejected',rejected_by_account_id=?1,rejected_by_character_id=?2,rejected_by_character_name=?3,rejected_at=?4,rejection_note=?5,updated_at=?4 WHERE id=?6 AND workspace_id=?7")
        .bind(principal.accountId,actorCharacterId,name,now,String(body?.note??"").trim(),requestId,workspaceId).run();
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO buyback_events (workspace_id,request_id,contract_id,event_type,actor_account_id,actor_character_id,actor_character_name,detail_json,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
        .bind(workspaceId,requestId,Number(current.contract_id),next,principal.accountId,actorCharacterId,name,JSON.stringify({note:String(body?.note??"").trim()}),now),
      env.DB.prepare("INSERT INTO audit_log (workspace_id,actor_account_id,action,resource_type,resource_id,detail_json) VALUES (?1,?2,?3,'buyback.request',?4,?5)")
        .bind(workspaceId,principal.accountId,"buyback."+next,requestId,JSON.stringify({contract_id:Number(current.contract_id),actor_character_id:actorCharacterId})),
      env.DB.prepare("UPDATE buyback_notifications SET acknowledged_at=COALESCE(acknowledged_at,?1) WHERE request_id=?2").bind(now,requestId),
    ]);
    const updated=await env.DB.prepare("SELECT * FROM buyback_requests WHERE id=?1").bind(requestId).first();
    return h.json({ request: serializeRow(updated) });
  }

  return null;
}

export async function listBuybackNotifications(env:any,principal:any,includeAcknowledged=false,limit=50){
  const query=includeAcknowledged
    ? env.DB.prepare("SELECT n.*,r.contract_id,r.payout_isk,r.issuer_character_name FROM buyback_notifications n JOIN buyback_requests r ON r.id=n.request_id WHERE n.recipient_account_id=?1 ORDER BY n.created_at DESC LIMIT ?2")
    : env.DB.prepare("SELECT n.*,r.contract_id,r.payout_isk,r.issuer_character_name FROM buyback_notifications n JOIN buyback_requests r ON r.id=n.request_id WHERE n.recipient_account_id=?1 AND n.acknowledged_at IS NULL ORDER BY n.created_at DESC LIMIT ?2");
  const rows=await query.bind(principal.accountId,Math.max(1,Math.min(100,limit))).all();
  return rows.results.map((row:any)=>({
    eventId:String(row.id),
    requestId:String(row.request_id),
    ruleVersion:1,
    sageId:"corporation-buyback",
    kind:"corporation.buyback_request",
    title:String(row.title),
    message:String(row.message),
    data:{buybackRequestId:String(row.request_id),contractId:Number(row.contract_id),payoutIsk:Number(row.payout_isk),issuerCharacterName:String(row.issuer_character_name),workspaceId:String(row.workspace_id)},
    triggeredAt:String(row.created_at),
    acknowledged:Boolean(row.acknowledged_at),
  }));
}

export async function acknowledgeBuybackNotification(env:any,principal:any,eventId:string){
  const now=new Date().toISOString();
  const result=await env.DB.prepare("UPDATE buyback_notifications SET acknowledged_at=?1 WHERE id=?2 AND recipient_account_id=?3")
    .bind(now,eventId,principal.accountId).run();
  return { acknowledged:Number(result.meta?.changes??0)>0,eventId,acknowledgedAt:now };
}
