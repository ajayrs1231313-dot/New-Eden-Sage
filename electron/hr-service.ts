import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";

export const HR_SNAPSHOT_SCHEMA_VERSION = 2;
export const HR_STORE_SCHEMA_VERSION = 1;
export const HR_DEFAULT_EXPIRY_HOURS = 7 * 24;

export type HrDataCategoryId =
  | "identity"
  | "corporation-history"
  | "skills"
  | "kill-loss"
  | "contacts-standings"
  | "wallet"
  | "contracts"
  | "assets"
  | "mail"
  | "notifications"
  | "market"
  | "industry"
  | "fittings-ships";

export type HrApplicationStatus =
  | "awaiting-applicant"
  | "in-progress"
  | "submitted"
  | "under-review"
  | "additional-review"
  | "probation"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "revoked"
  | "archived";

export type HrSubmissionMethod = "sage-desktop" | "sage-website";
export type HrCategoryState = "provided" | "withheld" | "unavailable" | "error" | "not-requested";

export type HrDataCategory = {
  id: HrDataCategoryId;
  label: string;
  description: string;
  source: "public" | "esi-private" | "sage-local" | "unsupported";
  supported: boolean;
};

export const HR_DATA_CATEGORIES: HrDataCategory[] = [
  { id: "identity", label: "Character information", description: "Identity, character ID, security status, corporation and alliance IDs.", source: "public", supported: true },
  { id: "corporation-history", label: "Corporation history", description: "The character's public EVE corporation history captured in the synced snapshot.", source: "public", supported: true },
  { id: "skills", label: "Skills", description: "Total SP and the character's synced skill list/capability data.", source: "esi-private", supported: true },
  { id: "kill-loss", label: "Kill / loss history", description: "Recent authorised ESI killmails and available killmail detail.", source: "esi-private", supported: true },
  { id: "contacts-standings", label: "Contacts / standings", description: "Authorised character contacts and standings.", source: "esi-private", supported: true },
  { id: "wallet", label: "Wallet information", description: "Wallet balance plus recent journal and transaction history available to Sage.", source: "esi-private", supported: true },
  { id: "contracts", label: "Contracts", description: "Authorised character contracts and captured contract item detail.", source: "esi-private", supported: true },
  { id: "assets", label: "Assets", description: "Authorised character assets, locations and Sage's existing asset summary/valuation fields.", source: "esi-private", supported: true },
  { id: "mail", label: "Mail", description: "Recent read-only EVE mail headers and a bounded set of message bodies captured during the applicant's normal manual Sage sync.", source: "esi-private", supported: true },
  { id: "notifications", label: "Notifications", description: "Authorised character notifications captured by the normal Sage sync.", source: "esi-private", supported: true },
  { id: "market", label: "Market activity", description: "Authorised current and historical character market orders available in the snapshot.", source: "esi-private", supported: true },
  { id: "industry", label: "Industry activity", description: "Authorised character industry jobs available in the snapshot.", source: "esi-private", supported: true },
  { id: "fittings-ships", label: "Fittings / ships", description: "Saved fittings, current ship and current-ship fitted asset records from the snapshot.", source: "esi-private", supported: true },
];

export type HrApplicationRequest = {
  applicationId: string;
  codeHash: string;
  codeHint: string;
  corporationId: number;
  corporationName: string;
  recruiterCharacterId: string;
  recruiterName: string;
  requestedCategories: HrDataCategoryId[];
  createdAt: string;
  expiresAt: string;
  submittedAt?: string;
  revokedAt?: string;
  status: HrApplicationStatus;
};

export type HrSnapshotSection = {
  categoryId: HrDataCategoryId;
  title: string;
  state: HrCategoryState;
  summary: string;
  data?: unknown;
  error?: string;
};

export type HrEvidenceItem = {
  id: string;
  categoryId: HrDataCategoryId;
  label: string;
  detail: string;
};

export type HrReviewFlag = {
  id: string;
  severity: "info" | "review";
  label: string;
  detail: string;
  evidenceIds: string[];
};

export type HrApplicantSnapshot = {
  schemaVersion: number;
  applicationId: string;
  applicantCharacterId: string;
  applicantCharacterName: string;
  applicantCorporationId: number | null;
  applicantCorporationName: string | null;
  applicantAllianceId: number | null;
  requestingCorporationId: number;
  requestingCorporationName: string;
  requestingRecruiterName: string;
  capturedAt: string;
  sourceSnapshotUpdatedAt: string | null;
  submissionMethod: HrSubmissionMethod;
  requestedCategories: HrDataCategoryId[];
  selectedCategories: HrDataCategoryId[];
  providedCategories: HrDataCategoryId[];
  withheldCategories: HrDataCategoryId[];
  unavailableCategories: HrDataCategoryId[];
  errorCategories: HrDataCategoryId[];
  sections: HrSnapshotSection[];
  evidence: HrEvidenceItem[];
  reviewFlags: HrReviewFlag[];
};

export type HrRecruiterNote = {
  id: string;
  recruiterCharacterId: string;
  recruiterName: string;
  createdAt: string;
  text: string;
};

export type HrApplicationDecision = {
  status: Extract<HrApplicationStatus, "under-review" | "additional-review" | "probation" | "approved" | "rejected" | "archived">;
  recruiterCharacterId: string;
  recruiterName: string;
  decidedAt: string;
};

export type HrApplicationRecord = {
  request: HrApplicationRequest;
  snapshot?: HrApplicantSnapshot;
  notes: HrRecruiterNote[];
  decision?: HrApplicationDecision;
};

type HrStore = {
  storeSchemaVersion: number;
  applications: HrApplicationRecord[];
};

export type HrCreateRequestInput = {
  corporationId: number;
  corporationName: string;
  recruiterCharacterId: string;
  recruiterName: string;
  requestedCategories: HrDataCategoryId[];
  expiresInHours?: number;
};

export type HrCreateRequestResult = {
  request: Omit<HrApplicationRequest, "codeHash">;
  applicationCode: string;
  shareUrl: string;
  transport: "local-development";
};

export type HrResolvedRequest = {
  applicationId: string;
  corporationId: number;
  corporationName: string;
  recruiterName: string;
  requestedCategories: HrDataCategoryId[];
  createdAt: string;
  expiresAt: string;
  status: HrApplicationStatus;
  transport: "local-development";
  categories: HrDataCategory[];
};

export type HrApplicantSubmissionInput = {
  code: string;
  characterSnapshot: any;
  selectedCategories: HrDataCategoryId[];
  submissionMethod: HrSubmissionMethod;
  now?: Date;
};

export interface HrApplicationService {
  listForCorporation(corporationId: number): Promise<HrApplicationRecord[]>;
  createRequest(input: HrCreateRequestInput, now?: Date): Promise<HrCreateRequestResult>;
  resolveCode(code: string, now?: Date): Promise<HrResolvedRequest>;
  revokeRequest(applicationId: string, corporationId: number, now?: Date): Promise<HrApplicationRecord>;
  submitSnapshot(input: HrApplicantSubmissionInput): Promise<HrApplicationRecord>;
  addRecruiterNote(applicationId: string, corporationId: number, note: Omit<HrRecruiterNote, "id" | "createdAt">, now?: Date): Promise<HrApplicationRecord>;
  setDecision(applicationId: string, corporationId: number, decision: Omit<HrApplicationDecision, "decidedAt">, now?: Date): Promise<HrApplicationRecord>;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value.trim()).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dedupeCategories(values: unknown): HrDataCategoryId[] {
  const allowed = new Set(HR_DATA_CATEGORIES.map((item) => item.id));
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter((value): value is HrDataCategoryId => allowed.has(value as HrDataCategoryId)))];
}

function isUnavailable(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).unavailable === true);
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:^|_)(?:access|refresh)?_?token$|authorization|client_secret|password/i.test(key)) continue;
    clean[key] = scrubSecrets(item);
  }
  return clean;
}

function sectionPayload(snapshot: any, categoryId: HrDataCategoryId): { data?: unknown; summary: string; unavailable?: boolean } {
  const extended = snapshot?.extended ?? {};
  switch (categoryId) {
    case "identity":
      return {
        summary: `${String(snapshot?.character?.name ?? "Unknown character")} — security ${Number(snapshot?.character?.security_status ?? 0).toFixed(2)}`,
        data: {
          characterId: String(snapshot?.characterId ?? ""),
          name: snapshot?.character?.name ?? null,
          securityStatus: snapshot?.character?.security_status ?? null,
          corporationId: snapshot?.character?.corporation_id ?? null,
          corporationName: snapshot?.character?.corporation_name ?? null,
          allianceId: snapshot?.character?.alliance_id ?? null,
        },
      };
    case "corporation-history": {
      const data = snapshot?.character?.corporation_history ?? extended?.corporation?.history;
      return isUnavailable(data)
        ? { summary: "Corporation history was unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(data) ? data.length : 0} corporation-history entries captured.`, data: data ?? [] };
    }
    case "skills": {
      const data = snapshot?.skills;
      return isUnavailable(data)
        ? { summary: "Skills were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Number(data?.total_sp ?? 0).toLocaleString("en-GB")} total SP; ${Array.isArray(data?.skills) ? data.skills.length : 0} trained skill records.`, data };
    }
    case "kill-loss": {
      const data = Array.isArray(extended?.killmailDetails) ? extended.killmailDetails : extended?.killmails;
      return isUnavailable(data)
        ? { summary: "Kill / loss history was unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(data) ? data.length : 0} recent killmail records captured.`, data: data ?? [] };
    }
    case "contacts-standings": {
      const contacts = extended?.contacts;
      const standings = extended?.standings;
      const unavailable = isUnavailable(contacts) && isUnavailable(standings);
      return unavailable
        ? { summary: "Contacts and standings were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(contacts) ? contacts.length : 0} contacts; ${Array.isArray(standings) ? standings.length : 0} standings entries.`, data: { contacts, standings } };
    }
    case "wallet": {
      const journal = extended?.walletJournal;
      const transactions = extended?.walletTransactions;
      return isUnavailable(journal) && isUnavailable(transactions)
        ? { summary: "Wallet history was unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Number(snapshot?.wallet ?? 0).toLocaleString("en-GB")} ISK balance; ${Array.isArray(journal) ? journal.length : 0} journal and ${Array.isArray(transactions) ? transactions.length : 0} transaction records.`, data: { balance: snapshot?.wallet ?? null, journal, transactions } };
    }
    case "contracts": {
      const contracts = extended?.contracts;
      return isUnavailable(contracts)
        ? { summary: "Contracts were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(contracts) ? contracts.length : 0} contracts captured.`, data: { contracts: contracts ?? [], contractItems: extended?.contractItems ?? [] } };
    }
    case "assets": {
      const assets = extended?.assets;
      return isUnavailable(assets)
        ? { summary: "Assets were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(assets) ? assets.length : 0} asset records captured.`, data: { summary: extended?.assetSummary ?? null, assets: assets ?? [] } };
    }
    case "mail": {
      const data = extended?.mail;
      if (isUnavailable(data) || !data) return { summary: "Mail was unavailable in the source snapshot. The character may need to be reconnected with the read-only mail scope and manually synced again.", unavailable: true };
      const headers = Array.isArray(data?.headers) ? data.headers : [];
      const details = Array.isArray(data?.details) ? data.details : [];
      return { summary: `${headers.length} recent mail headers and ${details.length} message bodies captured from the applicant's manual Sage sync.`, data };
    }
    case "notifications": {
      const data = extended?.notifications;
      return isUnavailable(data)
        ? { summary: "Notifications were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(data) ? data.length : 0} notifications captured.`, data: data ?? [] };
    }
    case "market": {
      const data = extended?.marketOrders;
      return isUnavailable(data)
        ? { summary: "Market activity was unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(data) ? data.length : 0} market order records captured.`, data: data ?? [] };
    }
    case "industry": {
      const data = extended?.industryJobs;
      return isUnavailable(data)
        ? { summary: "Industry activity was unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(data) ? data.length : 0} industry job records captured.`, data: data ?? [] };
    }
    case "fittings-ships": {
      const fittings = extended?.fittings;
      return isUnavailable(fittings)
        ? { summary: "Fittings were unavailable in the source snapshot.", unavailable: true }
        : { summary: `${Array.isArray(fittings) ? fittings.length : 0} saved fittings plus current ship context captured.`, data: { ship: snapshot?.ship ?? null, currentShipFit: extended?.currentShipFit ?? [], fittings: fittings ?? [] } };
    }
  }
}

function deriveHrReviewEvidence(input: { characterSnapshot:any; sections:HrSnapshotSection[]; evidence:HrEvidenceItem[]; reviewFlags:HrReviewFlag[]; now:Date }) {
  const provided = new Map(input.sections.filter(section => section.state === "provided").map(section => [section.categoryId, section]));
  const add = (categoryId:HrDataCategoryId, id:string, label:string, detail:string, severity:"info"|"review"="info") => {
    const evidenceId = `evidence-derived-${id}`;
    input.evidence.push({ id:evidenceId, categoryId, label, detail });
    input.reviewFlags.push({ id:`flag-derived-${id}`, severity, label, detail, evidenceIds:[evidenceId] });
  };

  const identity = provided.get("identity")?.data as any;
  const securityStatus = Number(identity?.securityStatus);
  if (Number.isFinite(securityStatus) && securityStatus <= -5) {
    add("identity", "low-security-status", "Very low security status", `Captured character security status is ${securityStatus.toFixed(2)}. This is a factual activity signal for recruiter review, not a finding of hostile intent.`, "review");
  }

  const history = provided.get("corporation-history")?.data as any;
  if (Array.isArray(history) && history.length) {
    const starts = history.map((entry:any) => ({ corporationId:Number(entry?.corporation_id ?? 0), start:Date.parse(String(entry?.start_date ?? "")) })).filter((entry:any) => Number.isFinite(entry.start)).sort((a:any,b:any)=>b.start-a.start);
    const recent180 = starts.filter((entry:any) => input.now.getTime() - entry.start <= 180*86400000 && input.now.getTime() >= entry.start);
    if (recent180.length >= 4) add("corporation-history", "rapid-corp-changes", "Frequent recent corporation changes", `${recent180.length} corporation-history entries began during the last 180 days in the captured public history. Review the timeline and reasons for those moves.`, "review");
    else if (history.length >= 12) add("corporation-history", "long-corp-history", "Long corporation history", `${history.length} corporation-history entries are present. This is context for manual review and is not inherently suspicious.`);
    const newest=starts[0];if(newest && input.now.getTime()-newest.start < 14*86400000) add("corporation-history", "recent-corp-change", "Recent corporation transition", `The newest captured corporation-history entry began ${Math.max(0,Math.floor((input.now.getTime()-newest.start)/86400000))} days before this snapshot.`);
  }

  const killData = provided.get("kill-loss")?.data as any;
  if (Array.isArray(killData)) {
    const applicantId=Number(input.characterSnapshot?.characterId ?? 0);
    const losses=killData.filter((row:any)=>Number(row?.detail?.victim?.character_id ?? 0)===applicantId).length;
    if (losses >= 8) add("kill-loss", "recent-loss-volume", "High recent loss volume", `${losses} of the captured recent killmails show this character as the victim. Treat this as combat-history context, not a spy indicator.`, "review");
    else if (losses >= 3) add("kill-loss", "recent-loss-context", "Recent ship-loss activity", `${losses} captured recent killmails show this character as the victim.`);
  }

  const wallet = provided.get("wallet")?.data as any;
  const journal = Array.isArray(wallet?.journal) ? wallet.journal : [];
  if (journal.length) {
    const transfers = new Map<number,{count:number;total:number}>();
    for (const row of journal) {
      if (String(row?.ref_type ?? "") !== "player_donation") continue;
      const amount=Number(row?.amount ?? 0);if (!(amount < 0)) continue;
      const counterparty=Number(row?.second_party_id ?? row?.first_party_id ?? 0);if(!counterparty)continue;
      const prior=transfers.get(counterparty)??{count:0,total:0};prior.count+=1;prior.total+=Math.abs(amount);transfers.set(counterparty,prior);
    }
    const large=[...transfers.entries()].filter(([,value])=>value.total>=1_000_000_000 || (value.count>=3&&value.total>=300_000_000));
    if(large.length){const [party,value]=large.sort((a,b)=>b[1].total-a[1].total)[0];add("wallet","repeated-large-transfer","Repeated large player transfers",`${value.count} captured outgoing player-donation entries total about ${Math.round(value.total).toLocaleString("en-GB")} ISK to counterparty ID ${party}. This may be entirely legitimate; review the surrounding journal context.`,"review");}
  }

  const contacts = provided.get("contacts-standings")?.data as any;
  const contactRows=Array.isArray(contacts?.contacts)?contacts.contacts:[];
  const strongPositive=contactRows.filter((row:any)=>Number(row?.standing??0)>=5).length;
  const strongNegative=contactRows.filter((row:any)=>Number(row?.standing??0)<=-5).length;
  if(strongPositive||strongNegative)add("contacts-standings","standing-summary","Strong contact standings present",`Captured contacts include ${strongPositive} at +5 or above and ${strongNegative} at -5 or below. Use the contact records as context rather than treating standing alone as proof of affiliation.`);

  const mail = provided.get("mail")?.data as any;
  if(mail){const headers=Array.isArray(mail?.headers)?mail.headers:[];const unread=headers.filter((row:any)=>row?.is_read===false).length;input.evidence.push({id:"evidence-derived-mail-coverage",categoryId:"mail",label:"Mail coverage",detail:`${headers.length} mail headers were captured; ${unread} were marked unread at sync time. Only the bounded mail window in this immutable snapshot is available to recruiters.`});}

  const sourceTime=Date.parse(String(input.characterSnapshot?.updatedAt??""));
  if(Number.isFinite(sourceTime)){const ageHours=(input.now.getTime()-sourceTime)/3600000;if(ageHours>24)add("identity","stale-source-snapshot","Source snapshot is over 24 hours old",`The applicant's underlying Sage character sync was about ${Math.floor(ageHours)} hours old when the one-time HR snapshot was created. Consider requesting a newer manual sync before making a time-sensitive decision.`,"review");}
}

export function buildHrApplicantSnapshot(input: {
  request: HrApplicationRequest;
  characterSnapshot: any;
  selectedCategories: HrDataCategoryId[];
  submissionMethod: HrSubmissionMethod;
  now?: Date;
}): HrApplicantSnapshot {
  const now = input.now ?? new Date();
  const selected = dedupeCategories(input.selectedCategories);
  const requested = dedupeCategories(input.request.requestedCategories);
  const selectedSet = new Set(selected);
  const sections: HrSnapshotSection[] = [];
  const evidence: HrEvidenceItem[] = [];
  const reviewFlags: HrReviewFlag[] = [];
  const provided: HrDataCategoryId[] = [];
  const unavailable: HrDataCategoryId[] = [];
  const errors: HrDataCategoryId[] = [];
  const withheld = requested.filter((id) => !selectedSet.has(id));

  for (const category of HR_DATA_CATEGORIES) {
    if (!selectedSet.has(category.id)) {
      if (requested.includes(category.id)) {
        sections.push({ categoryId: category.id, title: category.label, state: "withheld", summary: "WITHHELD BY APPLICANT" });
        const evidenceId = `evidence-${category.id}-withheld`;
        evidence.push({ id: evidenceId, categoryId: category.id, label: `${category.label} withheld`, detail: "The corporation requested this category and the applicant explicitly did not include it in the one-time snapshot." });
        reviewFlags.push({ id: `flag-${category.id}-withheld`, severity: "info", label: "Information requested but withheld", detail: `${category.label} was requested but withheld by the applicant. This is a consent choice, not an API failure or finding of suspicious activity.`, evidenceIds: [evidenceId] });
      }
      continue;
    }
    try {
      const payload = sectionPayload(input.characterSnapshot, category.id);
      if (payload.unavailable || !category.supported) {
        unavailable.push(category.id);
        sections.push({ categoryId: category.id, title: category.label, state: "unavailable", summary: payload.summary });
      } else {
        provided.push(category.id);
        sections.push({ categoryId: category.id, title: category.label, state: "provided", summary: payload.summary, data: scrubSecrets(payload.data) });
      }
    } catch (error) {
      errors.push(category.id);
      sections.push({ categoryId: category.id, title: category.label, state: "error", summary: "Collection failed while building the one-time local snapshot.", error: error instanceof Error ? error.message : String(error) });
    }
  }

  deriveHrReviewEvidence({ characterSnapshot: input.characterSnapshot, sections, evidence, reviewFlags, now });

  return {
    schemaVersion: HR_SNAPSHOT_SCHEMA_VERSION,
    applicationId: input.request.applicationId,
    applicantCharacterId: String(input.characterSnapshot?.characterId ?? ""),
    applicantCharacterName: String(input.characterSnapshot?.character?.name ?? "Unknown character"),
    applicantCorporationId: Number(input.characterSnapshot?.character?.corporation_id ?? 0) || null,
    applicantCorporationName: input.characterSnapshot?.character?.corporation_name ? String(input.characterSnapshot.character.corporation_name) : null,
    applicantAllianceId: Number(input.characterSnapshot?.character?.alliance_id ?? 0) || null,
    requestingCorporationId: input.request.corporationId,
    requestingCorporationName: input.request.corporationName,
    requestingRecruiterName: input.request.recruiterName,
    capturedAt: now.toISOString(),
    sourceSnapshotUpdatedAt: input.characterSnapshot?.updatedAt ? String(input.characterSnapshot.updatedAt) : null,
    submissionMethod: input.submissionMethod,
    requestedCategories: requested,
    selectedCategories: selected,
    providedCategories: provided,
    withheldCategories: withheld,
    unavailableCategories: unavailable,
    errorCategories: errors,
    sections,
    evidence,
    reviewFlags,
  };
}

function emptyStore(): HrStore {
  return { storeSchemaVersion: HR_STORE_SCHEMA_VERSION, applications: [] };
}

export class LocalHrApplicationService implements HrApplicationService {
  private readonly storePath: string;
  constructor(storePath = path.join(USER_DATA_ROOT, "corporation-hr-v1.json")) { this.storePath = storePath; }

  private async readStore(): Promise<HrStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.storePath, "utf8")) as HrStore;
      if (!parsed || !Array.isArray(parsed.applications)) return emptyStore();
      return { storeSchemaVersion: Number(parsed.storeSchemaVersion ?? HR_STORE_SCHEMA_VERSION), applications: parsed.applications };
    } catch {
      return emptyStore();
    }
  }

  private async writeStore(store: HrStore) {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const temp = `${this.storePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(temp, this.storePath);
  }

  private normalizeExpiry(record: HrApplicationRecord, now = new Date()) {
    if (record.request.status === "awaiting-applicant" && Date.parse(record.request.expiresAt) <= now.getTime()) {
      record.request.status = "expired";
    }
  }

  async listForCorporation(corporationId: number): Promise<HrApplicationRecord[]> {
    const store = await this.readStore();
    let changed = false;
    for (const record of store.applications) {
      const before = record.request.status;
      this.normalizeExpiry(record);
      if (before !== record.request.status) changed = true;
    }
    if (changed) await this.writeStore(store);
    return clone(store.applications.filter((record) => record.request.corporationId === corporationId).sort((a, b) => Date.parse(b.request.createdAt) - Date.parse(a.request.createdAt)));
  }

  async createRequest(input: HrCreateRequestInput, now = new Date()): Promise<HrCreateRequestResult> {
    const corporationId = Number(input.corporationId);
    if (!Number.isInteger(corporationId) || corporationId <= 0) throw new Error("A valid requesting corporation is required.");
    const requestedCategories = dedupeCategories(input.requestedCategories);
    if (!requestedCategories.length) throw new Error("Select at least one requested information category.");
    const store = await this.readStore();
    let applicationCode = "";
    let codeHash = "";
    do {
      applicationCode = `NES-HR-${crypto.randomBytes(15).toString("base64url").toUpperCase()}`;
      codeHash = sha256(applicationCode);
    } while (store.applications.some((record) => record.request.codeHash === codeHash));
    const hours = Math.max(1, Math.min(24 * 30, Number(input.expiresInHours ?? HR_DEFAULT_EXPIRY_HOURS)));
    const request: HrApplicationRequest = {
      applicationId: crypto.randomUUID(),
      codeHash,
      codeHint: applicationCode.slice(-6),
      corporationId,
      corporationName: String(input.corporationName || `Corporation ${corporationId}`),
      recruiterCharacterId: String(input.recruiterCharacterId ?? ""),
      recruiterName: String(input.recruiterName || "Corporation recruiter"),
      requestedCategories,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString(),
      status: "awaiting-applicant",
    };
    store.applications.push({ request, notes: [] });
    await this.writeStore(store);
    const { codeHash: _codeHash, ...publicRequest } = request;
    return {
      request: clone(publicRequest),
      applicationCode,
      shareUrl: `https://newedensage.com/hr/apply/${encodeURIComponent(applicationCode)}`,
      transport: "local-development",
    };
  }

  async resolveCode(code: string, now = new Date()): Promise<HrResolvedRequest> {
    const normalized = String(code ?? "").trim();
    if (!normalized) throw new Error("Paste an application code first.");
    const store = await this.readStore();
    const record = store.applications.find((item) => item.request.codeHash === sha256(normalized));
    if (!record) throw new Error("That HR application code was not found in this Sage development service.");
    const before = record.request.status;
    this.normalizeExpiry(record, now);
    if (before !== record.request.status) await this.writeStore(store);
    if (record.request.status === "expired") throw new Error("This HR application code has expired.");
    if (record.request.status === "revoked") throw new Error("This HR application code has been revoked.");
    if (record.request.status !== "awaiting-applicant" && record.request.status !== "in-progress") throw new Error("This HR application code has already been submitted and is single-use.");
    return {
      applicationId: record.request.applicationId,
      corporationId: record.request.corporationId,
      corporationName: record.request.corporationName,
      recruiterName: record.request.recruiterName,
      requestedCategories: clone(record.request.requestedCategories),
      createdAt: record.request.createdAt,
      expiresAt: record.request.expiresAt,
      status: record.request.status,
      transport: "local-development",
      categories: clone(HR_DATA_CATEGORIES),
    };
  }

  async revokeRequest(applicationId: string, corporationId: number, now = new Date()): Promise<HrApplicationRecord> {
    const store = await this.readStore();
    const record = store.applications.find((item) => item.request.applicationId === applicationId && item.request.corporationId === corporationId);
    if (!record) throw new Error("HR application not found for this corporation.");
    if (record.snapshot) throw new Error("Submitted snapshots are immutable; revoke is only available before submission.");
    record.request.status = "revoked";
    record.request.revokedAt = now.toISOString();
    await this.writeStore(store);
    return clone(record);
  }

  async submitSnapshot(input: HrApplicantSubmissionInput): Promise<HrApplicationRecord> {
    const now = input.now ?? new Date();
    const normalized = String(input.code ?? "").trim();
    const store = await this.readStore();
    const record = store.applications.find((item) => item.request.codeHash === sha256(normalized));
    if (!record) throw new Error("That HR application code was not found in this Sage development service.");
    this.normalizeExpiry(record, now);
    if (record.request.status === "expired") throw new Error("This HR application code has expired.");
    if (record.request.status === "revoked") throw new Error("This HR application code has been revoked.");
    if (record.snapshot || !["awaiting-applicant", "in-progress"].includes(record.request.status)) throw new Error("This HR application code has already been used.");
    if (!input.characterSnapshot || input.characterSnapshot?.snapshotState !== "synced") throw new Error("The selected applicant character needs a completed Sage sync before a one-time HR snapshot can be created.");
    const snapshot = buildHrApplicantSnapshot({ request: record.request, characterSnapshot: input.characterSnapshot, selectedCategories: input.selectedCategories, submissionMethod: input.submissionMethod, now });
    if (!snapshot.applicantCharacterId) throw new Error("Applicant character identity is missing from the local snapshot.");
    record.snapshot = snapshot;
    record.request.status = "submitted";
    record.request.submittedAt = snapshot.capturedAt;
    await this.writeStore(store);
    return clone(record);
  }

  async addRecruiterNote(applicationId: string, corporationId: number, note: Omit<HrRecruiterNote, "id" | "createdAt">, now = new Date()): Promise<HrApplicationRecord> {
    const text = String(note.text ?? "").trim();
    if (!text) throw new Error("Recruiter note cannot be empty.");
    const store = await this.readStore();
    const record = store.applications.find((item) => item.request.applicationId === applicationId && item.request.corporationId === corporationId);
    if (!record?.snapshot) throw new Error("A submitted HR application is required before recruiter notes can be added.");
    record.notes.push({ id: crypto.randomUUID(), recruiterCharacterId: String(note.recruiterCharacterId), recruiterName: String(note.recruiterName), createdAt: now.toISOString(), text });
    await this.writeStore(store);
    return clone(record);
  }

  async setDecision(applicationId: string, corporationId: number, decision: Omit<HrApplicationDecision, "decidedAt">, now = new Date()): Promise<HrApplicationRecord> {
    const allowed = new Set(["under-review", "additional-review", "probation", "approved", "rejected", "archived"]);
    if (!allowed.has(decision.status)) throw new Error("Unsupported HR review status.");
    const store = await this.readStore();
    const record = store.applications.find((item) => item.request.applicationId === applicationId && item.request.corporationId === corporationId);
    if (!record?.snapshot) throw new Error("A submitted HR application is required before a review decision can be recorded.");
    record.decision = { ...decision, recruiterCharacterId: String(decision.recruiterCharacterId), recruiterName: String(decision.recruiterName), decidedAt: now.toISOString() };
    record.request.status = decision.status;
    await this.writeStore(store);
    return clone(record);
  }
}

export const localHrApplicationService = new LocalHrApplicationService();
