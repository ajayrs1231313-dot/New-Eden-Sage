import { SAGE_ONLINE_URL } from "./sage-online";

export type SageMailKind = "normal" | "doctrine" | "production" | "system";
export type SageMailFolder = "inbox" | "sent";

export type SageMailContact = {
  characterId: number;
  characterName: string;
  corporationId: number | null;
  allianceId: number | null;
  relationships: Array<"account" | "corporation" | "contact">;
};

export type SageMailDirectory = {
  characterId: number;
  characterName: string;
  contacts: SageMailContact[];
  contactsSource: {
    corporationId: number | null;
    eveContactsAvailable: boolean;
    warning: string | null;
  };
};

export type SageMailEntry = {
  entryId: number;
  messageId: string;
  folder: SageMailFolder;
  kind: SageMailKind;
  senderCharacterId: number | null;
  senderCharacterName: string;
  recipientCharacterId: number;
  recipientCharacterName: string;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export type SageMailQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  premium: boolean;
  full: boolean;
};

export type SageMailbox = {
  characterId: number;
  characterName: string;
  folder: SageMailFolder;
  messages: SageMailEntry[];
  unread: number;
  quota: SageMailQuota;
};

async function request<T>(
  path: string,
  sageSessionToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sageSessionToken}`);
  headers.set("Accept", "application/json");
  if (init.body != null) headers.set("Content-Type", "application/json");

  const response = await fetch(`${SAGE_ONLINE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { message: text }; }
  }
  if (!response.ok) {
    const message = String(body?.message ?? body?.error ?? `Sage Mail request failed (${response.status}).`);
    const error = new Error(message) as Error & { code?: string; status?: number; quota?: SageMailQuota };
    error.code = typeof body?.error === "string" ? body.error : undefined;
    error.status = response.status;
    if (body?.quota) error.quota = body.quota;
    throw error;
  }
  return body as T;
}

function eveHeaders(accessToken: string, characterId: number) {
  return {
    "X-EVE-Access-Token": accessToken,
    "X-Sage-Character-ID": String(characterId),
  };
}

export function getSageMailMailbox(
  sageSessionToken: string,
  characterId: number,
  folder: SageMailFolder = "inbox",
) {
  const query = new URLSearchParams({
    character_id: String(characterId),
    folder,
    limit: "50",
  });
  return request<SageMailbox>(`/v1/mail/mailbox?${query.toString()}`, sageSessionToken);
}

export function getSageMailDirectory(
  sageSessionToken: string,
  eveAccessToken: string,
  characterId: number,
) {
  const query = new URLSearchParams({ character_id: String(characterId) });
  return request<SageMailDirectory>(`/v1/mail/directory?${query.toString()}`, sageSessionToken, {
    headers: eveHeaders(eveAccessToken, characterId),
  });
}

export function sendSageMail(
  sageSessionToken: string,
  eveAccessToken: string,
  input: {
    senderCharacterId: number;
    recipientCharacterId: number;
    subject: string;
    body: string;
  },
) {
  return request<{
    sent: boolean;
    messageId: string;
    senderCharacterId: number;
    recipientCharacterId: number;
    relationships: string[];
    senderQuota: SageMailQuota;
  }>("/v1/mail/send", sageSessionToken, {
    method: "POST",
    headers: eveHeaders(eveAccessToken, input.senderCharacterId),
    body: JSON.stringify({
      sender_character_id: input.senderCharacterId,
      recipient_character_id: input.recipientCharacterId,
      subject: input.subject,
      body: input.body,
    }),
  });
}

export function markSageMailRead(
  sageSessionToken: string,
  characterId: number,
  entryId: number,
) {
  const query = new URLSearchParams({ character_id: String(characterId) });
  return request<{ read: boolean; entryId: number; quota: SageMailQuota }>(
    `/v1/mail/entries/${encodeURIComponent(String(entryId))}/read?${query.toString()}`,
    sageSessionToken,
    { method: "POST" },
  );
}

export function deleteSageMail(
  sageSessionToken: string,
  characterId: number,
  entryId: number,
) {
  const query = new URLSearchParams({ character_id: String(characterId) });
  return request<{ deleted: boolean; entryId: number; quota: SageMailQuota }>(
    `/v1/mail/entries/${encodeURIComponent(String(entryId))}?${query.toString()}`,
    sageSessionToken,
    { method: "DELETE" },
  );
}

export function sendSageProductionMail(
  sageSessionToken: string,
  eveAccessToken: string,
  input: {
    characterId: number;
    subject: string;
    body: string;
    dedupKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<{
    delivered: boolean;
    duplicate: boolean;
    full: boolean;
    messageId?: string;
    characterId: number;
    quota: SageMailQuota;
  }>("/v1/mail/system/self", sageSessionToken, {
    method: "POST",
    headers: eveHeaders(eveAccessToken, input.characterId),
    body: JSON.stringify({
      character_id: input.characterId,
      kind: "production",
      subject: input.subject,
      body: input.body,
      dedup_key: input.dedupKey,
      metadata: input.metadata ?? {},
    }),
  });
}

export function sendSageDoctrineMail(
  sageSessionToken: string,
  eveAccessToken: string,
  input: {
    characterId: number;
    subject: string;
    body: string;
    dedupKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<{
    sent: boolean;
    corporationId: number;
    eligibleRecipients: number;
    delivered: number;
    duplicates: number;
    skippedFull: number;
  }>("/v1/mail/system/corporation", sageSessionToken, {
    method: "POST",
    headers: eveHeaders(eveAccessToken, input.characterId),
    body: JSON.stringify({
      character_id: input.characterId,
      kind: "doctrine",
      subject: input.subject,
      body: input.body,
      dedup_key: input.dedupKey,
      metadata: input.metadata ?? {},
    }),
  });
}
