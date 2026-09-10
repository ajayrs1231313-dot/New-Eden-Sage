import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./corporation-hr.css";

type CorpRecord = { characterId:string; characterName:string; corporationId:number; name:string; snapshot?:any };
type CategoryId = "identity"|"corporation-history"|"skills"|"kill-loss"|"contacts-standings"|"wallet"|"contracts"|"assets"|"mail"|"notifications"|"market"|"industry"|"fittings-ships";
type Category = { id:CategoryId; label:string; description:string; source:string; supported:boolean };
type Status = "awaiting-applicant"|"in-progress"|"submitted"|"under-review"|"additional-review"|"probation"|"approved"|"rejected"|"withdrawn"|"expired"|"revoked"|"archived";
type Request = { applicationId:string; corporationId:number; corporationName:string; recruiterCharacterId:string; recruiterName:string; requestedCategories:CategoryId[]; createdAt:string; expiresAt:string; submittedAt?:string; revokedAt?:string; status:Status; codeHint?:string };
type Section = { categoryId:CategoryId; title:string; state:"provided"|"withheld"|"unavailable"|"error"; summary:string; data?:unknown; error?:string };
type Snapshot = { schemaVersion:number; applicationId:string; applicantCharacterId:string; applicantCharacterName:string; applicantCorporationId:number|null; applicantCorporationName:string|null; applicantAllianceId:number|null; requestingCorporationName:string; requestingRecruiterName:string; capturedAt:string; sourceSnapshotUpdatedAt:string|null; submissionMethod:"sage-desktop"|"sage-website"; requestedCategories:CategoryId[]; selectedCategories:CategoryId[]; providedCategories:CategoryId[]; withheldCategories:CategoryId[]; unavailableCategories:CategoryId[]; errorCategories:CategoryId[]; sections:Section[]; evidence:Array<{id:string;categoryId:CategoryId;label:string;detail:string}>; reviewFlags:Array<{id:string;severity:string;label:string;detail:string;evidenceIds:string[]}> };
type RecordRow = { request:Request; snapshot?:Snapshot; notes:Array<{id:string;recruiterName:string;createdAt:string;text:string}>; decision?:{status:Status;recruiterName:string;decidedAt:string} };
type HrState = { workspace:any; categories:Category[]; applications:RecordRow[]; transport:"sage-online-desktop"|"local-development" };
type Resolved = { applicationId:string; corporationId:number; corporationName:string; recruiterName:string; requestedCategories:CategoryId[]; createdAt:string; expiresAt:string; status:Status; transport:"sage-online-desktop"|"local-development"; categories:Category[] };
type AnyRecord = Record<string, any>;

const DEFAULT_REQUESTED:CategoryId[]=["identity","corporation-history","skills","kill-loss","contacts-standings","wallet","contracts","assets","mail","notifications"];
const REVIEW_STATUSES:Array<{value:Status;label:string}>=[
  {value:"under-review",label:"Under Review"},{value:"additional-review",label:"Additional Review"},{value:"probation",label:"Probation"},{value:"approved",label:"Approve"},{value:"rejected",label:"Reject"},{value:"archived",label:"Archive"},
];

function date(value?:string|null){if(!value)return "-";const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():"-";}
function shortDate(value?:unknown){if(!value)return "-";const d=new Date(String(value));return Number.isFinite(d.getTime())?d.toLocaleDateString():"-";}
function age(value?:string|null){if(!value)return "unknown";const ms=Date.now()-Date.parse(value);if(!Number.isFinite(ms))return "unknown";const mins=Math.max(0,Math.floor(ms/60000));if(mins<60)return `${mins}m`;const hours=Math.floor(mins/60);if(hours<48)return `${hours}h`;return `${Math.floor(hours/24)}d`;}
function prettyStatus(value:string){return value.split("-").map(part=>part[0]?.toUpperCase()+part.slice(1)).join(" ");}
function categoryMap(categories:Category[]){return new Map(categories.map(item=>[item.id,item]));}
function portrait(characterId:string,size=96){return `https://images.evetech.net/characters/${encodeURIComponent(characterId)}/portrait?size=${size}`;}
function compactJson(value:unknown){try{return JSON.stringify(value,null,2);}catch{return "Captured data could not be rendered.";}}
function asRecord(value:unknown):AnyRecord{return value&&typeof value==="object"&&!Array.isArray(value)?value as AnyRecord:{};}
function asArray(value:unknown):any[]{return Array.isArray(value)?value:[];}
function number(value:unknown){const numeric=Number(value);return Number.isFinite(numeric)?new Intl.NumberFormat("en-GB").format(numeric):"-";}
function isk(value:unknown){const numeric=Number(value);return Number.isFinite(numeric)?`${new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(numeric)} ISK`:"-";}
function moneyCompact(value:unknown){const numeric=Number(value);if(!Number.isFinite(numeric))return "-";const abs=Math.abs(numeric);if(abs>=1_000_000_000)return `${(numeric/1_000_000_000).toFixed(2)}b ISK`;if(abs>=1_000_000)return `${(numeric/1_000_000).toFixed(2)}m ISK`;if(abs>=1_000)return `${(numeric/1_000).toFixed(1)}k ISK`;return `${numeric.toFixed(2)} ISK`;}
function text(value:unknown,fallback="-"){if(value==null||value==="")return fallback;return String(value);}
function humanize(value:unknown){return text(value).replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase());}
function unavailable(value:unknown){return Boolean(value&&typeof value==="object"&&(value as AnyRecord).unavailable===true);}
function snippet(value:unknown,limit=130){const clean=text(value,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();return clean.length>limit?`${clean.slice(0,limit-1)}…`:clean||"-";}
function readableText(value:unknown){const source=text(value,"");return source.replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/p>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/[ \t]+/g," ").replace(/\n\s*\n+/g,"\n\n").trim()||"-";}
function numericId(value:unknown){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:0;}

function categoryAvailable(snapshot:any,id:CategoryId){
  if(!snapshot||snapshot.snapshotState!=="synced")return false;
  const extended=snapshot.extended??{};
  switch(id){
    case "identity": return Boolean(snapshot.character?.name);
    case "corporation-history": return !unavailable(snapshot.character?.corporation_history??extended?.corporation?.history);
    case "skills": return !unavailable(snapshot.skills)&&Boolean(snapshot.skills);
    case "kill-loss": return !unavailable(extended.killmailDetails??extended.killmails);
    case "contacts-standings": return !(unavailable(extended.contacts)&&unavailable(extended.standings));
    case "wallet": return typeof snapshot.wallet==="number"&&!(unavailable(extended.walletJournal)&&unavailable(extended.walletTransactions));
    case "contracts": return !unavailable(extended.contracts);
    case "assets": return !unavailable(extended.assets);
    case "mail": return Boolean(extended.mail)&&!unavailable(extended.mail);
    case "notifications": return !unavailable(extended.notifications);
    case "market": return !unavailable(extended.marketOrders);
    case "industry": return !unavailable(extended.industryJobs);
    case "fittings-ships": return !unavailable(extended.fittings);
  }
}

function useResolvedNames(ids:number[]){
  const [names,setNames]=useState<Map<number,string>>(new Map());
  const key=useMemo(()=>[...new Set(ids.filter(id=>Number.isSafeInteger(id)&&id>0))].sort((a,b)=>a-b).join(","),[ids]);
  useEffect(()=>{
    let cancelled=false;
    const unique=key?key.split(",").map(Number):[];
    if(!unique.length||typeof (window.sage as any).resolveTypeIds!=="function"){setNames(new Map());return;}
    void (async()=>{
      const resolved:Array<{id:number;name:string}>=[];
      for(let index=0;index<unique.length;index+=900){
        const rows=await (window.sage as any).resolveTypeIds(unique.slice(index,index+900));
        if(Array.isArray(rows))resolved.push(...rows);
      }
      if(!cancelled)setNames(new Map(resolved.map(item=>[Number(item.id),String(item.name)])));
    })().catch(()=>{if(!cancelled)setNames(new Map());});
    return()=>{cancelled=true;};
  },[key]);
  return names;
}

function idsForSection(section:Section){
  const data=asRecord(section.data);const ids:number[]=[];const add=(value:unknown)=>{const id=numericId(value);if(id)ids.push(id);};
  if(section.categoryId==="identity"){add(data.corporationId);add(data.allianceId);}
  if(section.categoryId==="corporation-history")for(const row of asArray(section.data).slice(0,80))add(row?.corporation_id);
  if(section.categoryId==="skills")for(const row of asArray(data.skills).slice(0,80))add(row?.skill_id);
  if(section.categoryId==="kill-loss")for(const row of asArray(section.data).slice(0,50)){const detail=asRecord(row?.detail??row);add(detail.solar_system_id);add(detail?.victim?.ship_type_id);add(detail?.victim?.character_id);for(const attacker of asArray(detail.attackers).slice(0,5)){add(attacker?.character_id);add(attacker?.ship_type_id);}}
  if(section.categoryId==="contacts-standings"){for(const row of asArray(data.contacts).slice(0,100))add(row?.contact_id);for(const row of asArray(data.standings).slice(0,100))add(row?.from_id);}
  if(section.categoryId==="wallet"){for(const row of asArray(data.journal).slice(0,60)){add(row?.first_party_id);add(row?.second_party_id);}for(const row of asArray(data.transactions).slice(0,60)){add(row?.type_id);add(row?.client_id);}}
  if(section.categoryId==="contracts")for(const row of asArray(data.contracts).slice(0,60)){add(row?.issuer_id);add(row?.issuer_corporation_id);add(row?.assignee_id);add(row?.acceptor_id);}
  if(section.categoryId==="assets")for(const row of asArray(data.assets).slice(0,80))add(row?.type_id);
  if(section.categoryId==="mail")for(const row of asArray(data.headers).slice(0,80)){add(row?.from);for(const recipient of asArray(row?.recipients).slice(0,8))add(recipient?.recipient_id);}
  if(section.categoryId==="notifications")for(const row of asArray(section.data).slice(0,80))add(row?.sender_id);
  if(section.categoryId==="market")for(const row of asArray(section.data).slice(0,80))add(row?.type_id);
  if(section.categoryId==="industry")for(const row of asArray(section.data).slice(0,80)){add(row?.blueprint_type_id);add(row?.product_type_id);add(row?.installer_id);}
  if(section.categoryId==="fittings-ships"){add(data?.ship?.ship_type_id);for(const fit of asArray(data.fittings).slice(0,40)){add(fit?.ship_type_id);for(const item of asArray(fit?.items).slice(0,25))add(item?.type_id);}for(const item of asArray(data.currentShipFit).slice(0,50))add(item?.type_id);}
  return [...new Set(ids)].slice(0,800);
}

function Metric({label,value,detail}:{label:string;value:ReactNode;detail?:ReactNode}){return <div className="corp-hr-data-metric"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>;}
function HrTable({headers,rows,empty="No records in this snapshot."}:{headers:string[];rows:ReactNode[][];empty?:string}){
  if(!rows.length)return <div className="corp-hr-data-empty">{empty}</div>;
  return <div className="corp-hr-human-table" style={{"--hr-cols":headers.length} as any}>
    <div className="corp-hr-human-row heading">{headers.map(header=><span key={header}>{header}</span>)}</div>
    {rows.map((row,index)=><div className="corp-hr-human-row" key={index}>{row.map((cell,cellIndex)=><span key={cellIndex}>{cell}</span>)}</div>)}
  </div>;
}
function RawPayload({value}:{value:unknown}){return <details className="corp-hr-raw"><summary>Raw ESI payload</summary><pre>{compactJson(value)}</pre></details>;}
function SectionTitle({children,detail}:{children:ReactNode;detail?:ReactNode}){return <div className="corp-hr-data-subhead"><strong>{children}</strong>{detail&&<small>{detail}</small>}</div>;}

function HrSectionContent({section,applicantCharacterId}:{section:Section;applicantCharacterId:string}){
  const ids=useMemo(()=>idsForSection(section),[section]);
  const names=useResolvedNames(ids);
  const named=(value:unknown,prefix="ID")=>{const id=numericId(value);return id?(names.get(id)??`${prefix} ${id}`):"-";};
  const data=asRecord(section.data);
  const raw=<RawPayload value={section.data}/>;
  let body:ReactNode=null;

  switch(section.categoryId){
    case "identity": {
      body=<div className="corp-hr-data-grid">
        <Metric label="Character" value={text(data.name)}/><Metric label="Character ID" value={text(data.characterId)}/>
        <Metric label="Corporation" value={named(data.corporationId,"Corporation")}/><Metric label="Alliance" value={data.allianceId?named(data.allianceId,"Alliance"):"None"}/>
        <Metric label="Security status" value={Number.isFinite(Number(data.securityStatus))?Number(data.securityStatus).toFixed(2):"-"}/>
      </div>;
      break;
    }
    case "corporation-history": {
      const rows=asArray(section.data).slice().sort((a,b)=>Date.parse(String(b?.start_date??0))-Date.parse(String(a?.start_date??0))).slice(0,80);
      body=<><SectionTitle detail={`${asArray(section.data).length} history records`}>Corporation timeline</SectionTitle><HrTable headers={["Corporation","Joined","Record"]} rows={rows.map(row=>[named(row?.corporation_id,"Corporation"),shortDate(row?.start_date),text(row?.record_id)])}/></>;
      break;
    }
    case "skills": {
      const skills=asArray(data.skills).slice().sort((a,b)=>Number(b?.skillpoints_in_skill??0)-Number(a?.skillpoints_in_skill??0));
      body=<><div className="corp-hr-data-grid"><Metric label="Total skill points" value={number(data.total_sp)}/><Metric label="Unallocated SP" value={number(data.unallocated_sp??0)}/><Metric label="Trained skills" value={number(skills.length)}/></div><SectionTitle detail="Highest SP first">Skill list</SectionTitle><HrTable headers={["Skill","Trained","Active","SP"]} rows={skills.slice(0,80).map(row=>[text(row?.name,named(row?.skill_id,"Skill")),`Level ${number(row?.trained_skill_level)}`,`Level ${number(row?.active_skill_level)}`,number(row?.skillpoints_in_skill)])}/>{skills.length>80&&<div className="corp-hr-data-more">Showing 80 of {skills.length} skills.</div>}</>;
      break;
    }
    case "kill-loss": {
      const kills=asArray(section.data);
      body=<><div className="corp-hr-data-grid"><Metric label="Recent killmails" value={number(kills.length)}/></div><HrTable headers={["Result","Date","Ship","System","Attackers"]} rows={kills.slice(0,60).map(row=>{const detail=asRecord(row?.detail??row);const victim=asRecord(detail.victim);const loss=String(victim.character_id??"")===String(applicantCharacterId);return [<b className={loss?"hr-loss":"hr-kill"}>{loss?"LOSS":"KILL"}</b>,date(detail.killmail_time),named(victim.ship_type_id,"Ship type"),named(detail.solar_system_id,"System"),number(asArray(detail.attackers).length)];})}/>{kills.length>60&&<div className="corp-hr-data-more">Showing 60 of {kills.length} recent killmails.</div>}</>;
      break;
    }
    case "contacts-standings": {
      const contacts=asArray(data.contacts);const standings=asArray(data.standings);
      body=<><div className="corp-hr-data-grid"><Metric label="Contacts" value={number(contacts.length)}/><Metric label="NPC standings" value={number(standings.length)}/></div><SectionTitle>Contacts</SectionTitle><HrTable headers={["Name","Type","Standing","Flags"]} rows={contacts.slice(0,100).map(row=>[named(row?.contact_id,humanize(row?.contact_type)),humanize(row?.contact_type),Number(row?.standing??0).toFixed(1),[row?.is_blocked?"Blocked":"",row?.is_watched?"Watchlisted":"",asArray(row?.label_ids).length?`${asArray(row.label_ids).length} label(s)`:""].filter(Boolean).join(" · ")||"-"])}/><SectionTitle>Standings</SectionTitle><HrTable headers={["Entity","Type","Standing"]} rows={standings.slice(0,100).map(row=>[named(row?.from_id,humanize(row?.from_type)),humanize(row?.from_type),Number(row?.standing??0).toFixed(2)])}/></>;
      break;
    }
    case "wallet": {
      const journal=asArray(data.journal);const transactions=asArray(data.transactions);
      body=<><div className="corp-hr-data-grid"><Metric label="Wallet balance" value={isk(data.balance)}/><Metric label="Journal records" value={number(journal.length)}/><Metric label="Market transactions" value={number(transactions.length)}/></div><SectionTitle detail="Most recent captured entries">Wallet journal</SectionTitle><HrTable headers={["Date","Reference","Amount","Balance","Counterparty"]} rows={journal.slice(0,70).map(row=>[date(row?.date),humanize(row?.ref_type),<b className={Number(row?.amount)<0?"hr-negative":"hr-positive"}>{moneyCompact(row?.amount)}</b>,moneyCompact(row?.balance),named(row?.second_party_id||row?.first_party_id,"Entity")])}/><SectionTitle detail="Most recent captured entries">Transactions</SectionTitle><HrTable headers={["Date","Side","Item","Quantity","Unit price","Total","Client"]} rows={transactions.slice(0,70).map(row=>[date(row?.date),row?.is_buy?"BUY":"SELL",named(row?.type_id,"Type"),number(row?.quantity),moneyCompact(row?.unit_price),moneyCompact(Number(row?.quantity??0)*Number(row?.unit_price??0)),named(row?.client_id,"Client")])}/>{(journal.length>70||transactions.length>70)&&<div className="corp-hr-data-more">Large histories are capped on-screen; the raw payload remains available below.</div>}</>;
      break;
    }
    case "contracts": {
      const contracts=asArray(data.contracts);const items=asArray(data.contractItems);const itemCounts=new Map<number,number>();for(const packet of items){const id=Number(packet?.contractId??packet?.contract_id??0);if(id)itemCounts.set(id,asArray(packet?.items).length);}
      body=<><div className="corp-hr-data-grid"><Metric label="Contracts" value={number(contracts.length)}/><Metric label="Captured item rows" value={number([...itemCounts.values()].reduce((sum,value)=>sum+value,0))}/></div><HrTable headers={["Status","Type","Issuer","Assignee","Price / reward","Issued","Completed","Items"]} rows={contracts.slice(0,70).map(row=>[<b>{humanize(row?.status)}</b>,humanize(row?.type),named(row?.issuer_id,"Character"),row?.assignee_id?named(row.assignee_id,"Assignee"):humanize(row?.availability),row?.reward?`Reward ${moneyCompact(row.reward)}`:row?.price?moneyCompact(row.price):row?.collateral?`Collateral ${moneyCompact(row.collateral)}`:"-",date(row?.date_issued),date(row?.date_completed),number(itemCounts.get(Number(row?.contract_id))??0)])}/>{contracts.length>70&&<div className="corp-hr-data-more">Showing 70 of {contracts.length} contracts.</div>}</>;
      break;
    }
    case "assets": {
      const assets=asArray(data.assets);const summary=asRecord(data.summary);const totalQty=assets.reduce((sum,row)=>sum+Math.max(0,Number(row?.quantity??0)),0);const estimated=assets.reduce((sum,row)=>sum+Math.max(0,Number(row?.estimatedValue??row?.estimated_value??0)),0);
      body=<><div className="corp-hr-data-grid"><Metric label="Asset records" value={number(assets.length)}/><Metric label="Units" value={number(totalQty)}/><Metric label="Estimated value" value={estimated?moneyCompact(estimated):moneyCompact(summary.totalValue??summary.estimatedValue)}/></div><HrTable headers={["Item","Quantity","Location / flag","Estimated value"]} rows={assets.slice(0,80).map(row=>[text(row?.name??row?.typeName??row?.type_name,named(row?.type_id,"Type")),number(row?.quantity),`${humanize(row?.location_flag)} · ${text(row?.location_id,"-")}`,moneyCompact(row?.estimatedValue??row?.estimated_value)])}/>{assets.length>80&&<div className="corp-hr-data-more">Showing 80 of {assets.length} asset records.</div>}</>;
      break;
    }
    case "mail": {
      const headers=asArray(data.headers);const details=asArray(data.details);const headerById=new Map(headers.map(row=>[Number(row?.mail_id),row]));
      body=<><div className="corp-hr-data-grid"><Metric label="Mail headers" value={number(headers.length)}/><Metric label="Bodies captured" value={number(details.length)}/><Metric label="Unread at capture" value={number(headers.filter(row=>row?.is_read===false).length)}/></div><SectionTitle detail="Captured ESI mail headers">Message index</SectionTitle><HrTable headers={["Date","From","Subject","State","Recipients"]} rows={headers.slice(0,80).map(row=>[date(row?.timestamp),named(row?.from,"Character"),text(row?.subject,"(no subject)"),row?.is_read===false?"UNREAD":"Read",asArray(row?.recipients).slice(0,4).map(recipient=>named(recipient?.recipient_id,humanize(recipient?.recipient_type))).join(", ")||"-"])}/>{headers.length>80&&<div className="corp-hr-data-more">Showing 80 of {headers.length} captured mail headers.</div>}<SectionTitle detail={details.length+" bodies captured"}>Message contents</SectionTitle><div className="corp-hr-mail-bodies">{details.slice(0,60).map((packet,index)=>{const detail=asRecord(packet?.detail);const header=headerById.get(Number(packet?.mailId??packet?.mail_id))??{};return <details className="corp-hr-mail-card" key={Number(packet?.mailId??packet?.mail_id)||index}><summary><span><strong>{text(detail.subject??header?.subject,"(no subject)")}</strong><small>{date(detail.timestamp??header?.timestamp)} - From {named(detail.from??header?.from,"Character")}</small></span><b>OPEN</b></summary><div className="corp-hr-mail-body">{readableText(detail.body)}</div></details>;})}</div>{details.length>60&&<div className="corp-hr-data-more">Showing 60 of {details.length} message bodies.</div>}</>;
      break;
    }
    case "notifications": {
      const rows=asArray(section.data);
      body=<><div className="corp-hr-data-grid"><Metric label="Notifications" value={number(rows.length)}/></div><HrTable headers={["Date","Type","Sender","Summary"]} rows={rows.slice(0,80).map(row=>[date(row?.timestamp),humanize(row?.type),named(row?.sender_id,"Entity"),snippet(row?.text)])}/></>;
      break;
    }
    case "market": {
      const orders=asArray(section.data);const active=orders.filter(row=>String(row?.state??"open")==="open");
      body=<><div className="corp-hr-data-grid"><Metric label="Orders captured" value={number(orders.length)}/><Metric label="Open" value={number(active.length)}/></div><HrTable headers={["State","Side","Item","Remaining","Price","Issued"]} rows={orders.slice(0,80).map(row=>[humanize(row?.state??"open"),row?.is_buy_order?"BUY":"SELL",named(row?.type_id,"Type"),`${number(row?.volume_remain)} / ${number(row?.volume_total)}`,moneyCompact(row?.price),date(row?.issued)])}/></>;
      break;
    }
    case "industry": {
      const jobs=asArray(section.data);
      body=<><div className="corp-hr-data-grid"><Metric label="Industry jobs" value={number(jobs.length)}/><Metric label="Active" value={number(jobs.filter(row=>!["delivered","cancelled","reverted"].includes(String(row?.status))).length)}/></div><HrTable headers={["Status","Activity","Blueprint","Product","Runs","Start","End"]} rows={jobs.slice(0,80).map(row=>[humanize(row?.status),text(row?.activity_id),named(row?.blueprint_type_id,"Blueprint type"),row?.product_type_id?named(row.product_type_id,"Product type"):"-",number(row?.runs),date(row?.start_date),date(row?.end_date??row?.completed_date)])}/></>;
      break;
    }
    case "fittings-ships": {
      const ship=asRecord(data.ship);const fittings=asArray(data.fittings);const current=asArray(data.currentShipFit);
      body=<><div className="corp-hr-data-grid"><Metric label="Current ship" value={text(ship.ship_type_name,named(ship.ship_type_id,"Ship type"))} detail={text(ship.ship_name,"-")}/><Metric label="Saved fittings" value={number(fittings.length)}/><Metric label="Current-ship asset rows" value={number(current.length)}/></div><SectionTitle>Saved fittings</SectionTitle><HrTable headers={["Fit","Hull","Items"]} rows={fittings.slice(0,60).map(row=>[text(row?.name,"Unnamed fitting"),named(row?.ship_type_id,"Ship type"),number(asArray(row?.items).length)])}/><SectionTitle>Current ship fitting context</SectionTitle><HrTable headers={["Item","Flag","Quantity"]} rows={current.slice(0,60).map(row=>[text(row?.name??row?.type_name,named(row?.type_id,"Type")),humanize(row?.location_flag),number(row?.quantity)])}/></>;
      break;
    }
  }
  return <div className="corp-hr-section-human">{body}{raw}</div>;
}

function ReportSection({section,applicantCharacterId}:{section:Section;applicantCharacterId:string}){
  const [open,setOpen]=useState(false);
  return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className={`corp-hr-report-section ${section.state}`}>
    <summary><span><strong>{section.title}</strong><small>{section.summary}</small></span><b>{section.state==="withheld"?"WITHHELD BY APPLICANT":section.state.toUpperCase()}</b></summary>
    {open&&<>{section.error&&<p className="corp-hr-section-error">{section.error}</p>}{section.data!==undefined&&<HrSectionContent section={section} applicantCharacterId={applicantCharacterId}/>}</>}
  </details>;
}

export function CorporationHr({corporation,snapshots}:{corporation:CorpRecord;snapshots:any[]}){
  const [tab,setTab]=useState<"command"|"applications">("command");
  const [state,setState]=useState<HrState|null>(null);
  const [loadError,setLoadError]=useState("");
  const [busy,setBusy]=useState(false);
  const [requested,setRequested]=useState<Set<CategoryId>>(new Set(DEFAULT_REQUESTED));
  const [expiryHours,setExpiryHours]=useState(168);
  const [created,setCreated]=useState<any>(null);
  const [selectedId,setSelectedId]=useState("");
  const [note,setNote]=useState("");
  const [applicantOpen,setApplicantOpen]=useState(false);
  const [applicationCode,setApplicationCode]=useState("");
  const [resolved,setResolved]=useState<Resolved|null>(null);
  const [applicantCharacterId,setApplicantCharacterId]=useState("");
  const [applicantSelected,setApplicantSelected]=useState<Set<CategoryId>>(new Set());
  const [consent,setConsent]=useState(false);
  const [applicantStatus,setApplicantStatus]=useState("");
  const [applicantRefreshBusy,setApplicantRefreshBusy]=useState(false);
  const [localSnapshots,setLocalSnapshots]=useState<any[]>(snapshots);

  useEffect(()=>setLocalSnapshots(snapshots),[snapshots]);

  async function load(){
    setLoadError("");
    try{
      const next=await (window.sage as any).getCorporationHrState(corporation.characterId) as HrState;
      setState(next);
      if(!selectedId){const first=next.applications.find(row=>row.snapshot)?.request.applicationId??"";setSelectedId(first);}
    }catch(error){setState(null);setLoadError(error instanceof Error?error.message:"Corporation HR command data is unavailable for this character.");}
  }
  useEffect(()=>{void load();},[corporation.characterId]);

  const categories=state?.categories??resolved?.categories??[];
  const labels=useMemo(()=>categoryMap(categories),[categories]);
  const applications=state?.applications??[];
  const completed=applications.filter(row=>Boolean(row.snapshot));
  const pending=applications.filter(row=>!row.snapshot&&["awaiting-applicant","in-progress"].includes(row.request.status));
  const selected=applications.find(row=>row.request.applicationId===selectedId)??completed[0]??null;
  const connectedSnapshots=localSnapshots.filter(item=>item?.characterId);
  const applicantSnapshot=connectedSnapshots.find(item=>String(item.characterId)===String(applicantCharacterId));
  const applicantReady=applicantSnapshot?.snapshotState==="synced";

  function toggleRequested(id:CategoryId){setRequested(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});}
  function toggleApplicant(id:CategoryId){setApplicantSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});}

  async function createRequest(){
    setBusy(true);setCreated(null);
    try{const result=await (window.sage as any).createCorporationHrRequest({characterId:corporation.characterId,requestedCategories:[...requested],expiresInHours:expiryHours});setCreated(result);await load();}
    catch(error){setLoadError(error instanceof Error?error.message:"Could not create the HR request.");}finally{setBusy(false);}
  }
  async function revoke(applicationId:string){setBusy(true);try{await (window.sage as any).revokeCorporationHrRequest({characterId:corporation.characterId,applicationId});await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not revoke the HR request.");}finally{setBusy(false);}}
  async function resolveCode(){
    setApplicantStatus("");setResolved(null);setConsent(false);
    try{
      const result=await (window.sage as any).resolveCorporationHrCode(applicationCode.trim()) as Resolved;
      setResolved(result);
      setApplicantSelected(new Set(result.requestedCategories.filter(id=>result.categories.find(row=>row.id===id)?.supported!==false)));
      const first=connectedSnapshots[0]?.characterId;setApplicantCharacterId(first?String(first):"");
      setApplicantStatus("Code resolved. Nothing has been submitted yet. Refresh ESI before submission if you want the report built from current data.");
    }catch(error){setApplicantStatus(error instanceof Error?error.message:"Application code could not be resolved.");}
  }
  async function refreshApplicantEsi(){
    if(!applicantCharacterId)return;
    setApplicantRefreshBusy(true);
    setApplicantStatus("Refreshing the selected character from ESI using Sage's stored authorization…");
    try{
      const result=await (window.sage as any).runMasterUpdate({characterIds:[applicantCharacterId]});
      if(result?.alreadyRunning)throw new Error("Another Sage private-data refresh is already running. Wait for it to finish and try again.");
      const latest=await (window.sage as any).listSnapshots();
      const rows=Array.isArray(latest)?latest:[];setLocalSnapshots(rows);
      const fresh=rows.find((item:any)=>String(item?.characterId)===String(applicantCharacterId));
      if(!fresh||fresh.snapshotState!=="synced")throw new Error("ESI refresh finished without a complete synced snapshot for this character.");
      const selectedIds=[...applicantSelected];
      const ready=selectedIds.filter(id=>categoryAvailable(fresh,id));
      const missing=selectedIds.filter(id=>!categoryAvailable(fresh,id));
      setApplicantStatus(`ESI refreshed ${date(fresh.updatedAt)}. ${ready.length}/${selectedIds.length} selected categories are available${missing.length?`; unavailable: ${missing.map(id=>labels.get(id)?.label??id).join(", ")}. If EVE returned a missing-scope error, update that character's authorization once in Settings.`:". The submission will use this fresh local snapshot."}`);
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      setApplicantStatus(`ESI refresh failed: ${message} Sage reuses the stored refresh token; reconnecting is only required if EVE has revoked it or the character lacks a newly required scope.`);
    }finally{setApplicantRefreshBusy(false);}
  }
  async function submitApplicant(){
    if(!resolved||!applicantCharacterId||!consent||!applicantReady)return;
    setBusy(true);
    try{const result=await (window.sage as any).submitCorporationHrSnapshot({code:applicationCode.trim(),characterId:applicantCharacterId,selectedCategories:[...applicantSelected]});setApplicantStatus(`Submitted one-time snapshot at ${date(result?.snapshot?.capturedAt)}. No ongoing access was granted.`);setConsent(false);setResolved(null);await load();}
    catch(error){setApplicantStatus(error instanceof Error?error.message:"Snapshot submission failed.");}finally{setBusy(false);}
  }
  async function withdrawApplicant(){if(!resolved)return;setBusy(true);try{await (window.sage as any).withdrawCorporationHrRequest(applicationCode.trim());setApplicantStatus("Application request declined/withdrawn. No snapshot was sent.");setConsent(false);setResolved(null);setApplicationCode("");}catch(error){setApplicantStatus(error instanceof Error?error.message:"Could not withdraw this application request.");}finally{setBusy(false);}}
  async function addNote(){if(!selected||!note.trim())return;setBusy(true);try{await (window.sage as any).addCorporationHrNote({characterId:corporation.characterId,applicationId:selected.request.applicationId,text:note.trim()});setNote("");await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not add recruiter note.");}finally{setBusy(false);}}
  async function setDecision(status:Status){if(!selected)return;setBusy(true);try{await (window.sage as any).setCorporationHrDecision({characterId:corporation.characterId,applicationId:selected.request.applicationId,status});await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not update application status.");}finally{setBusy(false);}}
  async function copy(value:string){try{await (window.sage as any).copyText(value);}catch{await navigator.clipboard.writeText(value);}}

  return <div className="corp-hr">
    <header className="corp-hr-hero"><div><p className="eyebrow">CORPORATION PERSONNEL COMMAND</p><h3>HR & Applicant Vetting</h3><p>Consensual recruitment intelligence built from immutable, one-time applicant snapshots. Submission never grants the corporation reusable ESI credentials or background access.</p></div><button className="primary" onClick={()=>setApplicantOpen(value=>!value)}>{applicantOpen?"Close applicant submission":"Submit an application code"}</button></header>

    {applicantOpen&&<section className="corp-hr-applicant-panel">
      <div className="corp-hr-one-time"><strong>ONE-TIME SNAPSHOT</strong><span>The applicant chooses exactly what is included. The corporation receives a report, not your EVE token, and Sage does not keep refreshing this application after submission.</span></div>
      {!resolved?<div className="corp-hr-code-entry"><input value={applicationCode} onChange={event=>setApplicationCode(event.target.value)} placeholder="Paste NES-HR application code"/><button className="primary" onClick={()=>void resolveCode()} disabled={!applicationCode.trim()}>Resolve code</button></div>:<>
        <div className="corp-hr-request-identity"><div><small>REQUESTING CORPORATION</small><strong>{resolved.corporationName}</strong><span>Recruiter: {resolved.recruiterName}</span></div><div><small>CODE EXPIRES</small><strong>{date(resolved.expiresAt)}</strong><span>Desktop-to-desktop via Sage Online</span></div></div>
        <label className="corp-hr-character-picker"><span>Character being submitted</span><select value={applicantCharacterId} onChange={event=>{setApplicantCharacterId(event.target.value);setConsent(false);}}>{connectedSnapshots.map(item=><option key={item.characterId} value={item.characterId}>{item?.character?.name??`Character ${item.characterId}`} · {item.snapshotState==="synced"?`synced ${date(item.updatedAt)}`:"needs ESI refresh"}</option>)}</select></label>
        <div className={`corp-hr-refresh-strip ${applicantReady?"ready":"needs-refresh"}`}><div><strong>{applicantReady?"LOCAL ESI SNAPSHOT READY":"ESI REFRESH REQUIRED"}</strong><span>{applicantSnapshot?.updatedAt?`Last refreshed ${date(applicantSnapshot.updatedAt)}`:"This character has not completed a private ESI sync yet."}</span><small>Refresh reuses Sage's stored EVE refresh token. It does not reconnect the character or send credentials to the recruiter. Only the categories you leave checked below are submitted.</small></div><button className="primary" disabled={!applicantCharacterId||applicantRefreshBusy} onClick={()=>void refreshApplicantEsi()}>{applicantRefreshBusy?"Refreshing ESI…":"Refresh applicant ESI"}</button></div>
        <div className="corp-hr-consent-grid">{resolved.categories.map(category=>{const wanted=resolved.requestedCategories.includes(category.id);const checked=applicantSelected.has(category.id);const available=applicantSnapshot?categoryAvailable(applicantSnapshot,category.id):false;return <label key={category.id} className={`corp-hr-consent-card ${checked?"selected":""} ${!category.supported?"unsupported":""}`}><input type="checkbox" checked={checked} disabled={!category.supported} onChange={()=>toggleApplicant(category.id)}/><span><strong>{category.label}</strong><small>{wanted?"REQUESTED BY CORPORATION":"OPTIONAL / NOT REQUESTED"} {applicantReady?`· ${available?"READY":"UNAVAILABLE"}`:""}</small><p>{category.description}</p>{!category.supported&&<em>Not currently available from Sage; it will be reported as unavailable rather than treated as withheld.</em>}</span></label>;})}</div>
        <div className="corp-hr-consent-summary"><strong>What will be sent</strong><span>Selected: {[...applicantSelected].map(id=>labels.get(id)?.label??id).join(", ")||"Nothing"}</span><span>Requested but excluded: {resolved.requestedCategories.filter(id=>!applicantSelected.has(id)).map(id=>labels.get(id)?.label??id).join(", ")||"None"}</span></div>
        <label className="corp-hr-confirm"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I confirm that this sends a one-time snapshot of the selected information to <strong>{resolved.corporationName}</strong>. It does not give the corporation ongoing access to my EVE account.</span></label>
        <button className="primary corp-hr-submit" disabled={!consent||!applicantCharacterId||!applicantReady||busy||applicantRefreshBusy} onClick={()=>void submitApplicant()}>{!applicantReady?"Refresh ESI before submitting":busy?"Submitting snapshot…":"Submit one-time snapshot"}</button><button className="corp-hr-decline" disabled={busy||applicantRefreshBusy} onClick={()=>void withdrawApplicant()}>Decline / withdraw request</button>
      </>}
      {applicantStatus&&<div className="corp-hr-status-line">{applicantStatus}</div>}
    </section>}

    <div className="corp-hr-tabs"><button className={tab==="command"?"active":""} onClick={()=>setTab("command")}>Command</button><button className={tab==="applications"?"active":""} onClick={()=>setTab("applications")}>Applications <span>{completed.length}</span></button></div>
    {loadError&&<div className="corp-hr-warning">{loadError}<small>Applicant code submission remains separate from recruiter authority.</small></div>}

    {tab==="command"?<div className="corp-hr-command">
      <section className="corp-hr-panel"><div className="corp-hr-panel-head"><div><p className="eyebrow">NEW VETTING REQUEST</p><h4>Choose what you would like the applicant to provide</h4><p>These are requests, not compulsory permissions. The applicant can remove any supported category before submission.</p></div><div className="corp-hr-expiry"><span>Expires</span><select value={expiryHours} onChange={event=>setExpiryHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={336}>14 days</option><option value={720}>30 days</option></select></div></div>
        <div className="corp-hr-category-grid">{(state?.categories??[]).map(category=><label key={category.id} className={`${requested.has(category.id)?"selected":""} ${!category.supported?"unsupported":""}`}><input type="checkbox" checked={requested.has(category.id)} disabled={!category.supported||!state?.workspace?.can_manage_hr} onChange={()=>toggleRequested(category.id)}/><span><strong>{category.label}</strong><small>{category.source}</small><p>{category.description}</p></span></label>)}</div>
        <div className="corp-hr-create-row"><span>{requested.size} categories requested</span><button className="primary" disabled={!state?.workspace?.can_manage_hr||!requested.size||busy} onClick={()=>void createRequest()}>{busy?"Creating…":"Generate application code"}</button></div>
      </section>
      {created&&<section className="corp-hr-generated"><p className="eyebrow">APPLICATION CREATED</p><h4>Single-use applicant code</h4><div className="corp-hr-generated-code"><code>{created.applicationCode}</code><button onClick={()=>void copy(created.applicationCode)}>Copy code</button></div><div className="corp-hr-desktop-handoff"><strong>Send this code to the applicant</strong><p>They open New Eden Sage → Corporation Management → HR → Submit an application code, paste it, choose their character, refresh ESI if needed, and choose exactly what they consent to send. The code works across Sage desktop installations and can be used only once.</p></div></section>}
      <section className="corp-hr-panel"><div className="corp-hr-panel-head"><div><p className="eyebrow">OUTSTANDING REQUESTS</p><h4>Awaiting applicants</h4></div><button onClick={()=>void load()}>Refresh</button></div>{!pending.length?<div className="system-empty">No live one-time applicant codes.</div>:<div className="corp-hr-request-list">{pending.map(row=><article key={row.request.applicationId}><div><strong>{row.request.applicationId.slice(0,8)}</strong><span>{row.request.requestedCategories.length} categories · expires {date(row.request.expiresAt)}</span><small>Code hint …{row.request.codeHint??""}</small></div><span className={`corp-hr-pill ${row.request.status}`}>{prettyStatus(row.request.status)}</span><button disabled={busy||!state?.workspace?.can_manage_hr} onClick={()=>void revoke(row.request.applicationId)}>Revoke</button></article>)}</div>}</section>
    </div>:<div className="corp-hr-applications">
      <aside className="corp-hr-dossier-list">{!completed.length?<div className="system-empty">No completed applicant snapshots yet.</div>:completed.map(row=><button key={row.request.applicationId} className={selected?.request.applicationId===row.request.applicationId?"active":""} onClick={()=>setSelectedId(row.request.applicationId)}><img src={portrait(row.snapshot!.applicantCharacterId,64)} alt=""/><span><strong>{row.snapshot!.applicantCharacterName}</strong><small>{row.snapshot!.applicantCorporationName??"Corporation unavailable"}</small><em>{prettyStatus(row.request.status)} · {date(row.snapshot!.capturedAt)}</em></span><b>{row.snapshot!.withheldCategories.length?`${row.snapshot!.withheldCategories.length} withheld`:"complete"}</b></button>)}</aside>
      <main className="corp-hr-dossier">{selected?.snapshot?<>
        <header className="corp-hr-dossier-head"><img src={portrait(selected.snapshot.applicantCharacterId,128)} alt=""/><div><p className="eyebrow">RECRUITMENT INTELLIGENCE / APPLICANT DOSSIER</p><h3>{selected.snapshot.applicantCharacterName}</h3><p>{selected.snapshot.applicantCorporationName??"Corporation unavailable"}{selected.snapshot.applicantAllianceId?` · Alliance ${selected.snapshot.applicantAllianceId}`:""}</p><div className="corp-hr-dossier-meta"><span>Application {selected.request.applicationId.slice(0,8)}</span><span>Sage Desktop</span><span>Schema v{selected.snapshot.schemaVersion}</span></div></div><span className={`corp-hr-pill ${selected.request.status}`}>{prettyStatus(selected.request.status)}</span></header>
        <div className="corp-hr-snapshot-banner"><strong>ONE-TIME SNAPSHOT · {date(selected.snapshot.capturedAt)}</strong><span>Snapshot age {age(selected.snapshot.capturedAt)} · source character sync {date(selected.snapshot.sourceSnapshotUpdatedAt)}</span><small>The factual snapshot below is immutable. Recruiter notes and decisions are stored separately.</small></div>
        <div className="corp-hr-completeness"><div><strong>{selected.snapshot.providedCategories.length}</strong><span>Provided</span></div><div><strong>{selected.snapshot.withheldCategories.length}</strong><span>Withheld</span></div><div><strong>{selected.snapshot.unavailableCategories.length}</strong><span>Unavailable</span></div><div><strong>{selected.snapshot.errorCategories.length}</strong><span>Collection errors</span></div></div>
        {selected.snapshot.reviewFlags.length>0&&<section className="corp-hr-flags"><p className="eyebrow">EVIDENCE-BACKED REVIEW FLAGS</p>{selected.snapshot.reviewFlags.map(flag=>{const evidence=(selected.snapshot?.evidence??[]).filter(item=>flag.evidenceIds.includes(item.id));return <article key={flag.id} className={flag.severity==="review"?"review":"info"}><strong>{flag.label}</strong><p>{flag.detail}</p>{evidence.length>0&&<div className="corp-hr-flag-evidence">{evidence.map(item=><small key={item.id}><b>{item.label}:</b> {item.detail}</small>)}</div>}</article>;})}<small className="corp-hr-flag-disclaimer">Flags identify evidence worth reviewing. They are not an automated spy verdict and should be interpreted with the underlying snapshot.</small></section>}
        <section className="corp-hr-report-sections"><p className="eyebrow">SNAPSHOT SECTIONS</p>{selected.snapshot.sections.map(section=><ReportSection key={section.categoryId} section={section} applicantCharacterId={selected.snapshot!.applicantCharacterId}/>)}</section>
        <section className="corp-hr-review"><div className="corp-hr-review-actions"><p className="eyebrow">RECRUITER STATUS</p><div>{REVIEW_STATUSES.map(option=><button key={option.value} disabled={busy||(!state?.workspace?.can_review_hr&&!state?.workspace?.can_manage_hr)} className={selected.request.status===option.value?"active":""} onClick={()=>void setDecision(option.value)}>{option.label}</button>)}</div></div><div className="corp-hr-notes"><p className="eyebrow">RECRUITER NOTES</p>{selected.notes.map(item=><article key={item.id}><strong>{item.recruiterName}</strong><small>{date(item.createdAt)}</small><p>{item.text}</p></article>)}<div className="corp-hr-note-entry"><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Add evidence-based recruiter notes. Notes never modify the submitted snapshot."/><button className="primary" disabled={!note.trim()||busy||(!state?.workspace?.can_review_hr&&!state?.workspace?.can_manage_hr)} onClick={()=>void addNote()}>Add note</button></div></div></section>
      </>:<div className="system-empty">Select a submitted applicant dossier.</div>}</main>
    </div>}
  </div>;
}
