import { useEffect, useMemo, useState } from "react";
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

const DEFAULT_REQUESTED:CategoryId[]=["identity","corporation-history","skills","kill-loss","contacts-standings","wallet","contracts","assets","mail","notifications"];
const REVIEW_STATUSES:Array<{value:Status;label:string}>=[
  {value:"under-review",label:"Under Review"},{value:"additional-review",label:"Additional Review"},{value:"probation",label:"Probation"},{value:"approved",label:"Approve"},{value:"rejected",label:"Reject"},{value:"archived",label:"Archive"},
];

function date(value?:string|null){if(!value)return "—";const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():"—";}
function age(value?:string|null){if(!value)return "unknown";const ms=Date.now()-Date.parse(value);if(!Number.isFinite(ms))return "unknown";const mins=Math.max(0,Math.floor(ms/60000));if(mins<60)return `${mins}m`;const hours=Math.floor(mins/60);if(hours<48)return `${hours}h`;return `${Math.floor(hours/24)}d`;}
function prettyStatus(value:string){return value.split("-").map(part=>part[0]?.toUpperCase()+part.slice(1)).join(" ");}
function categoryMap(categories:Category[]){return new Map(categories.map(item=>[item.id,item]));}
function portrait(characterId:string,size=96){return `https://images.evetech.net/characters/${encodeURIComponent(characterId)}/portrait?size=${size}`;}
function compactJson(value:unknown){try{return JSON.stringify(value,null,2);}catch{return "Captured data could not be rendered.";}}

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
  const pending=applications.filter(row=>!row.snapshot && ["awaiting-applicant","in-progress"].includes(row.request.status));
  const selected=applications.find(row=>row.request.applicationId===selectedId)??completed[0]??null;
  const syncedSnapshots=snapshots.filter(item=>item?.snapshotState==="synced" && item?.characterId);

  function toggleRequested(id:CategoryId){setRequested(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});}
  function toggleApplicant(id:CategoryId){setApplicantSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});}

  async function createRequest(){
    setBusy(true);setCreated(null);
    try{
      const result=await (window.sage as any).createCorporationHrRequest({characterId:corporation.characterId,requestedCategories:[...requested],expiresInHours:expiryHours});
      setCreated(result);await load();
    }catch(error){setLoadError(error instanceof Error?error.message:"Could not create the HR request.");}finally{setBusy(false);}
  }
  async function revoke(applicationId:string){
    setBusy(true);try{await (window.sage as any).revokeCorporationHrRequest({characterId:corporation.characterId,applicationId});await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not revoke the HR request.");}finally{setBusy(false);}
  }
  async function resolveCode(){
    setApplicantStatus("");setResolved(null);setConsent(false);
    try{
      const result=await (window.sage as any).resolveCorporationHrCode(applicationCode.trim()) as Resolved;
      setResolved(result);
      setApplicantSelected(new Set(result.requestedCategories.filter(id=>result.categories.find(row=>row.id===id)?.supported!==false)));
      const first=syncedSnapshots[0]?.characterId;setApplicantCharacterId(first?String(first):"");
      setApplicantStatus("Code resolved. Nothing has been submitted yet.");
    }catch(error){setApplicantStatus(error instanceof Error?error.message:"Application code could not be resolved.");}
  }
  async function submitApplicant(){
    if(!resolved||!applicantCharacterId||!consent)return;
    setBusy(true);
    try{
      const result=await (window.sage as any).submitCorporationHrSnapshot({code:applicationCode.trim(),characterId:applicantCharacterId,selectedCategories:[...applicantSelected]});
      setApplicantStatus(`Submitted one-time snapshot at ${date(result?.snapshot?.capturedAt)}. No ongoing access was granted.`);
      setConsent(false);setResolved(null);await load();
    }catch(error){setApplicantStatus(error instanceof Error?error.message:"Snapshot submission failed.");}finally{setBusy(false);}
  }
  async function withdrawApplicant(){
    if(!resolved)return;setBusy(true);
    try{await (window.sage as any).withdrawCorporationHrRequest(applicationCode.trim());setApplicantStatus("Application request declined/withdrawn. No snapshot was sent.");setConsent(false);setResolved(null);setApplicationCode("");}
    catch(error){setApplicantStatus(error instanceof Error?error.message:"Could not withdraw this application request.");}
    finally{setBusy(false);}
  }
  async function addNote(){
    if(!selected||!note.trim())return;setBusy(true);
    try{await (window.sage as any).addCorporationHrNote({characterId:corporation.characterId,applicationId:selected.request.applicationId,text:note.trim()});setNote("");await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not add recruiter note.");}finally{setBusy(false);}
  }
  async function setDecision(status:Status){
    if(!selected)return;setBusy(true);
    try{await (window.sage as any).setCorporationHrDecision({characterId:corporation.characterId,applicationId:selected.request.applicationId,status});await load();}catch(error){setLoadError(error instanceof Error?error.message:"Could not update application status.");}finally{setBusy(false);}
  }
  async function copy(value:string){try{await (window.sage as any).copyText(value);}catch{await navigator.clipboard.writeText(value);}}

  return <div className="corp-hr">
    <header className="corp-hr-hero">
      <div><p className="eyebrow">CORPORATION PERSONNEL COMMAND</p><h3>HR & Applicant Vetting</h3><p>Consensual recruitment intelligence built from immutable, one-time applicant snapshots. Submission never grants the corporation reusable ESI credentials or background access.</p></div>
      <button className="primary" onClick={()=>setApplicantOpen(value=>!value)}>{applicantOpen?"Close applicant submission":"Submit an application code"}</button>
    </header>

    {applicantOpen&&<section className="corp-hr-applicant-panel">
      <div className="corp-hr-one-time"><strong>ONE-TIME SNAPSHOT</strong><span>The applicant chooses exactly what is included. The corporation receives a report, not your EVE token, and Sage does not keep refreshing this application after submission.</span></div>
      {!resolved?<div className="corp-hr-code-entry"><input value={applicationCode} onChange={event=>setApplicationCode(event.target.value)} placeholder="Paste NES-HR application code"/><button className="primary" onClick={()=>void resolveCode()} disabled={!applicationCode.trim()}>Resolve code</button></div>:<>
        <div className="corp-hr-request-identity"><div><small>REQUESTING CORPORATION</small><strong>{resolved.corporationName}</strong><span>Recruiter: {resolved.recruiterName}</span></div><div><small>CODE EXPIRES</small><strong>{date(resolved.expiresAt)}</strong><span>Desktop-to-desktop via Sage Online</span></div></div>
        <label className="corp-hr-character-picker"><span>Character being submitted</span><select value={applicantCharacterId} onChange={event=>setApplicantCharacterId(event.target.value)}>{syncedSnapshots.map(item=><option key={item.characterId} value={item.characterId}>{item?.character?.name??`Character ${item.characterId}`} — synced {date(item.updatedAt)}</option>)}</select></label>
        <div className="corp-hr-consent-grid">{resolved.categories.map(category=>{const wanted=resolved.requestedCategories.includes(category.id);const checked=applicantSelected.has(category.id);return <label key={category.id} className={`corp-hr-consent-card ${checked?"selected":""} ${!category.supported?"unsupported":""}`}><input type="checkbox" checked={checked} disabled={!category.supported} onChange={()=>toggleApplicant(category.id)}/><span><strong>{category.label}</strong><small>{wanted?"REQUESTED BY CORPORATION":"OPTIONAL / NOT REQUESTED"}</small><p>{category.description}</p>{!category.supported&&<em>Not currently available from Sage; it will be reported as unavailable rather than treated as withheld.</em>}</span></label>;})}</div>
        <div className="corp-hr-consent-summary"><strong>What will be sent</strong><span>Selected: {[...applicantSelected].map(id=>labels.get(id)?.label??id).join(", ")||"Nothing"}</span><span>Requested but excluded: {resolved.requestedCategories.filter(id=>!applicantSelected.has(id)).map(id=>labels.get(id)?.label??id).join(", ")||"None"}</span></div>
        <label className="corp-hr-confirm"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I confirm that this sends a one-time snapshot of the selected information to <strong>{resolved.corporationName}</strong>. It does not give the corporation ongoing access to my EVE account.</span></label>
        <button className="primary corp-hr-submit" disabled={!consent||!applicantCharacterId||busy} onClick={()=>void submitApplicant()}>{busy?"Submitting snapshot...":"Submit one-time snapshot"}</button><button className="corp-hr-decline" disabled={busy} onClick={()=>void withdrawApplicant()}>Decline / withdraw request</button>
      </>}
      {applicantStatus&&<div className="corp-hr-status-line">{applicantStatus}</div>}
    </section>}

    <div className="corp-hr-tabs"><button className={tab==="command"?"active":""} onClick={()=>setTab("command")}>Command</button><button className={tab==="applications"?"active":""} onClick={()=>setTab("applications")}>Applications <span>{completed.length}</span></button></div>
    {loadError&&<div className="corp-hr-warning">{loadError}<small>Applicant code submission remains separate from recruiter authority.</small></div>}

    {tab==="command"?<div className="corp-hr-command">
      <section className="corp-hr-panel">
        <div className="corp-hr-panel-head"><div><p className="eyebrow">NEW VETTING REQUEST</p><h4>Choose what you would like the applicant to provide</h4><p>These are requests, not compulsory permissions. The applicant can remove any supported category before submission.</p></div><div className="corp-hr-expiry"><span>Expires</span><select value={expiryHours} onChange={event=>setExpiryHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={336}>14 days</option><option value={720}>30 days</option></select></div></div>
        <div className="corp-hr-category-grid">{(state?.categories??[]).map(category=><label key={category.id} className={`${requested.has(category.id)?"selected":""} ${!category.supported?"unsupported":""}`}><input type="checkbox" checked={requested.has(category.id)} disabled={!category.supported||!state?.workspace?.can_manage_hr} onChange={()=>toggleRequested(category.id)}/><span><strong>{category.label}</strong><small>{category.source}</small><p>{category.description}</p></span></label>)}</div>
        <div className="corp-hr-create-row"><span>{requested.size} categories requested</span><button className="primary" disabled={!state?.workspace?.can_manage_hr||!requested.size||busy} onClick={()=>void createRequest()}>{busy?"Creating...":"Generate application code"}</button></div>
      </section>
      {created&&<section className="corp-hr-generated"><p className="eyebrow">APPLICATION CREATED</p><h4>Single-use applicant code</h4><div className="corp-hr-generated-code"><code>{created.applicationCode}</code><button onClick={()=>void copy(created.applicationCode)}>Copy code</button></div><div className="corp-hr-desktop-handoff"><strong>Send this code to the applicant</strong><p>They open New Eden Sage → Corporation Management → HR → Submit an application code, paste it, choose their character and exactly what they consent to send. The code works across Sage desktop installations and can be used only once.</p></div></section>}
      <section className="corp-hr-panel"><div className="corp-hr-panel-head"><div><p className="eyebrow">OUTSTANDING REQUESTS</p><h4>Awaiting applicants</h4></div><button onClick={()=>void load()}>Refresh</button></div>{!pending.length?<div className="system-empty">No live one-time applicant codes.</div>:<div className="corp-hr-request-list">{pending.map(row=><article key={row.request.applicationId}><div><strong>{row.request.applicationId.slice(0,8)}</strong><span>{row.request.requestedCategories.length} categories · expires {date(row.request.expiresAt)}</span><small>Code hint …{row.request.codeHint??""}</small></div><span className={`corp-hr-pill ${row.request.status}`}>{prettyStatus(row.request.status)}</span><button disabled={busy||!state?.workspace?.can_manage_hr} onClick={()=>void revoke(row.request.applicationId)}>Revoke</button></article>)}</div>}</section>
    </div>:<div className="corp-hr-applications">
      <aside className="corp-hr-dossier-list">{!completed.length?<div className="system-empty">No completed applicant snapshots yet.</div>:completed.map(row=><button key={row.request.applicationId} className={selected?.request.applicationId===row.request.applicationId?"active":""} onClick={()=>setSelectedId(row.request.applicationId)}><img src={portrait(row.snapshot!.applicantCharacterId,64)} alt=""/><span><strong>{row.snapshot!.applicantCharacterName}</strong><small>{row.snapshot!.applicantCorporationName??"Corporation unavailable"}</small><em>{prettyStatus(row.request.status)} · {date(row.snapshot!.capturedAt)}</em></span><b>{row.snapshot!.withheldCategories.length?`${row.snapshot!.withheldCategories.length} withheld`:"complete"}</b></button>)}</aside>
      <main className="corp-hr-dossier">{selected?.snapshot?<>
        <header className="corp-hr-dossier-head"><img src={portrait(selected.snapshot.applicantCharacterId,128)} alt=""/><div><p className="eyebrow">RECRUITMENT INTELLIGENCE / APPLICANT DOSSIER</p><h3>{selected.snapshot.applicantCharacterName}</h3><p>{selected.snapshot.applicantCorporationName??"Corporation unavailable"}{selected.snapshot.applicantAllianceId?` · Alliance ${selected.snapshot.applicantAllianceId}`:""}</p><div className="corp-hr-dossier-meta"><span>Application {selected.request.applicationId.slice(0,8)}</span><span>Sage Desktop</span><span>Schema v{selected.snapshot.schemaVersion}</span></div></div><span className={`corp-hr-pill ${selected.request.status}`}>{prettyStatus(selected.request.status)}</span></header>
        <div className="corp-hr-snapshot-banner"><strong>ONE-TIME SNAPSHOT — {date(selected.snapshot.capturedAt)}</strong><span>Snapshot age {age(selected.snapshot.capturedAt)} · source character sync {date(selected.snapshot.sourceSnapshotUpdatedAt)}</span><small>The factual snapshot below is immutable. Recruiter notes and decisions are stored separately.</small></div>
        <div className="corp-hr-completeness"><div><strong>{selected.snapshot.providedCategories.length}</strong><span>Provided</span></div><div><strong>{selected.snapshot.withheldCategories.length}</strong><span>Withheld</span></div><div><strong>{selected.snapshot.unavailableCategories.length}</strong><span>Unavailable</span></div><div><strong>{selected.snapshot.errorCategories.length}</strong><span>Collection errors</span></div></div>
        {selected.snapshot.reviewFlags.length>0&&<section className="corp-hr-flags"><p className="eyebrow">EVIDENCE-BACKED REVIEW FLAGS</p>{selected.snapshot.reviewFlags.map(flag=>{const evidence=(selected.snapshot?.evidence??[]).filter(item=>flag.evidenceIds.includes(item.id));return <article key={flag.id} className={flag.severity==="review"?"review":"info"}><strong>{flag.label}</strong><p>{flag.detail}</p>{evidence.length>0&&<div className="corp-hr-flag-evidence">{evidence.map(item=><small key={item.id}><b>{item.label}:</b> {item.detail}</small>)}</div>}</article>;})}<small className="corp-hr-flag-disclaimer">Flags identify evidence worth reviewing. They are not an automated spy verdict and should be interpreted with the underlying snapshot.</small></section>}
        <section className="corp-hr-report-sections"><p className="eyebrow">SNAPSHOT SECTIONS</p>{selected.snapshot.sections.map(section=><details key={section.categoryId} className={`corp-hr-report-section ${section.state}`}><summary><span><strong>{section.title}</strong><small>{section.summary}</small></span><b>{section.state==="withheld"?"WITHHELD BY APPLICANT":section.state.toUpperCase()}</b></summary>{section.error&&<p className="corp-hr-section-error">{section.error}</p>}{section.data!==undefined&&<pre>{compactJson(section.data)}</pre>}</details>)}</section>
        <section className="corp-hr-review"><div className="corp-hr-review-actions"><p className="eyebrow">RECRUITER STATUS</p><div>{REVIEW_STATUSES.map(option=><button key={option.value} disabled={busy||(!state?.workspace?.can_review_hr&&!state?.workspace?.can_manage_hr)} className={selected.request.status===option.value?"active":""} onClick={()=>void setDecision(option.value)}>{option.label}</button>)}</div></div><div className="corp-hr-notes"><p className="eyebrow">RECRUITER NOTES</p>{selected.notes.map(item=><article key={item.id}><strong>{item.recruiterName}</strong><small>{date(item.createdAt)}</small><p>{item.text}</p></article>)}<div className="corp-hr-note-entry"><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Add evidence-based recruiter notes. Notes never modify the submitted snapshot."/><button className="primary" disabled={!note.trim()||busy||(!state?.workspace?.can_review_hr&&!state?.workspace?.can_manage_hr)} onClick={()=>void addNote()}>Add note</button></div></div></section>
      </>:<div className="system-empty">Select a submitted applicant dossier.</div>}</main>
    </div>}
  </div>;
}
