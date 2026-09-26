const ESI = "https://esi.evetech.net";
const COMPATIBILITY_DATE = "2026-08-02";
const USER_AGENT = "NewEdenSage/1.1.27";

export type EveMailRecipientType = "character" | "corporation" | "alliance" | "mailing_list";

export type EveMailRecipient = {
  recipientId: number;
  recipientType: EveMailRecipientType;
  name: string;
};

export type EveMailHeader = {
  mailId: number;
  from: number | null;
  fromName: string;
  isRead: boolean;
  labels: number[];
  recipients: EveMailRecipient[];
  subject: string;
  timestamp: string;
  direction: "sent" | "received";
};

export type EveMailLabel = {
  labelId: number;
  name: string;
  color: string | null;
  unreadCount: number;
};

export type EveMailMailbox = {
  characterId: number;
  headers: EveMailHeader[];
  labels: EveMailLabel[];
  mailingLists: Array<{ mailingListId: number; name: string }>;
  unread: number;
  capabilities: {
    read: boolean;
    send: boolean;
    organize: boolean;
  };
};

export type EveMailMessage = EveMailHeader & {
  body: string;
};

function scopes(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return [] as string[];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { scp?: string[] | string };
    if (Array.isArray(claims.scp)) return claims.scp.map(String);
    if (typeof claims.scp === "string") return claims.scp.split(/\s+/).filter(Boolean);
  } catch {
    // Missing/invalid claims are handled by ESI itself.
  }
  return [] as string[];
}

function capabilities(accessToken: string) {
  const granted = new Set(scopes(accessToken));
  return {
    read: granted.has("esi-mail.read_mail.v1"),
    send: granted.has("esi-mail.send_mail.v1"),
    organize: granted.has("esi-mail.organize_mail.v1"),
  };
}

async function esi<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("X-Compatibility-Date", COMPATIBILITY_DATE);
  headers.set("X-User-Agent", USER_AGENT);
  headers.set("Accept", "application/json");
  if (init.body != null) headers.set("Content-Type", "application/json");

  const response = await fetch(`${ESI}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as { error?: string };
      detail = body?.error ? ` · ${body.error}` : "";
    } catch {
      detail = "";
    }
    const error = new Error(`EVE Mail request failed (${response.status})${detail}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function publicEsi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Compatibility-Date", COMPATIBILITY_DATE);
  headers.set("X-User-Agent", USER_AGENT);
  headers.set("Accept", "application/json");
  if (init.body != null) headers.set("Content-Type", "application/json");
  const response = await fetch(`${ESI}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`EVE public lookup failed (${response.status}).`);
  return response.json() as Promise<T>;
}

async function resolveNames(ids: number[]) {
  const wanted = [...new Set(ids.filter((value) => Number.isSafeInteger(value) && value > 0))];
  const names = new Map<number, string>();
  for (let i = 0; i < wanted.length; i += 900) {
    const chunk = wanted.slice(i, i + 900);
    const rows = await publicEsi<Array<{ id: number; name: string; category: string }>>("/universe/names/", {
      method: "POST",
      body: JSON.stringify(chunk),
    }).catch(() => []);
    for (const row of rows) names.set(Number(row.id), String(row.name ?? row.id));
  }
  return names;
}

type RawHeader = {
  mail_id: number;
  from?: number;
  is_read?: boolean;
  labels?: number[];
  recipients?: Array<{ recipient_id: number; recipient_type: EveMailRecipientType }>;
  subject?: string;
  timestamp?: string;
};

type RawDetail = {
  body?: string;
  from?: number;
  labels?: number[];
  read?: boolean;
  recipients?: Array<{ recipient_id: number; recipient_type: EveMailRecipientType }>;
  subject?: string;
  timestamp?: string;
};

function normalizeHeader(
  characterId: number,
  header: RawHeader,
  names: Map<number, string>,
  mailingLists: Map<number, string>,
): EveMailHeader {
  const from = Number(header.from ?? 0) || null;
  const recipients = (header.recipients ?? []).map((recipient) => {
    const id = Number(recipient.recipient_id);
    const type = recipient.recipient_type;
    return {
      recipientId: id,
      recipientType: type,
      name: type === "mailing_list"
        ? mailingLists.get(id) ?? `Mailing List ${id}`
        : names.get(id) ?? `${type} ${id}`,
    };
  });
  return {
    mailId: Number(header.mail_id),
    from,
    fromName: from ? names.get(from) ?? `Character ${from}` : "EVE System",
    isRead: Boolean(header.is_read),
    labels: Array.isArray(header.labels) ? header.labels.map(Number) : [],
    recipients,
    subject: String(header.subject ?? "(no subject)"),
    timestamp: String(header.timestamp ?? ""),
    direction: from === characterId ? "sent" : "received",
  };
}

export async function getEveMailMailbox(
  characterId: number,
  accessToken: string,
  limit = 250,
): Promise<EveMailMailbox> {
  const caps = capabilities(accessToken);
  if (!caps.read) {
    const error = new Error("This character must be reconnected with EVE Mail permission before Sage can read EVE Mail.") as Error & { code?: string };
    error.code = "eve_mail_reconnect_required";
    throw error;
  }

  const safeLimit = Math.max(50, Math.min(500, Math.trunc(limit || 250)));
  const [labelsResponse, mailingListsResponse] = await Promise.all([
    esi<{ labels?: Array<{ label_id?: number; name?: string; color?: string; unread_count?: number }>; total_unread_count?: number }>(
      `/characters/${characterId}/mail/labels/`,
      accessToken,
    ).catch(() => ({ labels: [], total_unread_count: 0 })),
    esi<Array<{ mailing_list_id: number; name: string }>>(
      `/characters/${characterId}/mail/lists/`,
      accessToken,
    ).catch(() => []),
  ]);

  const raw: RawHeader[] = [];
  let lastMailId: number | null = null;
  while (raw.length < safeLimit) {
    const suffix: string = lastMailId ? `?last_mail_id=${lastMailId}` : "";
    const page: RawHeader[] = await esi<RawHeader[]>(`/characters/${characterId}/mail/${suffix}`, accessToken);
    if (!Array.isArray(page) || !page.length) break;
    raw.push(...page.slice(0, safeLimit - raw.length));
    if (page.length < 50) break;
    const ids: number[] = page.map((row) => Number(row.mail_id ?? 0)).filter((id) => id > 0);
    const next: number = ids.length ? Math.min(...ids) : 0;
    if (!next || next === lastMailId) break;
    lastMailId = next;
  }

  const mailingLists = new Map<number, string>(
    (mailingListsResponse ?? []).map((row) => [Number(row.mailing_list_id), String(row.name ?? row.mailing_list_id)]),
  );
  const ids = raw.flatMap((row) => [
    Number(row.from ?? 0),
    ...(row.recipients ?? [])
      .filter((recipient) => recipient.recipient_type !== "mailing_list")
      .map((recipient) => Number(recipient.recipient_id ?? 0)),
  ]);
  const names = await resolveNames(ids);
  const headers = raw
    .map((row) => normalizeHeader(characterId, row, names, mailingLists))
    .sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""));

  const labels = (labelsResponse?.labels ?? []).map((row) => ({
    labelId: Number(row.label_id ?? 0),
    name: String(row.name ?? "Label"),
    color: row.color ? String(row.color) : null,
    unreadCount: Number(row.unread_count ?? 0),
  }));

  return {
    characterId,
    headers,
    labels,
    mailingLists: [...mailingLists.entries()].map(([mailingListId, name]) => ({ mailingListId, name })),
    unread: Number(labelsResponse?.total_unread_count ?? headers.filter((row) => !row.isRead && row.direction === "received").length),
    capabilities: caps,
  };
}

export async function getEveMailMessage(
  characterId: number,
  accessToken: string,
  mailId: number,
): Promise<EveMailMessage> {
  const detail = await esi<RawDetail>(`/characters/${characterId}/mail/${mailId}/`, accessToken);
  const mailingListRows = await esi<Array<{ mailing_list_id: number; name: string }>>(
    `/characters/${characterId}/mail/lists/`,
    accessToken,
  ).catch(() => []);
  const mailingLists = new Map<number, string>(
    mailingListRows.map((row) => [Number(row.mailing_list_id), String(row.name ?? row.mailing_list_id)]),
  );
  const ids = [
    Number(detail.from ?? 0),
    ...(detail.recipients ?? [])
      .filter((recipient) => recipient.recipient_type !== "mailing_list")
      .map((recipient) => Number(recipient.recipient_id ?? 0)),
  ];
  const names = await resolveNames(ids);
  const normalized = normalizeHeader(characterId, {
    mail_id: mailId,
    from: detail.from,
    is_read: detail.read ?? false,
    labels: detail.labels ?? [],
    recipients: detail.recipients ?? [],
    subject: detail.subject ?? "(no subject)",
    timestamp: detail.timestamp ?? "",
  }, names, mailingLists);

  return {
    ...normalized,
    body: String(detail.body ?? ""),
  };
}

function requireScope(accessToken: string, scope: string, message: string) {
  if (!new Set(scopes(accessToken)).has(scope)) {
    const error = new Error(message) as Error & { code?: string };
    error.code = "eve_mail_reconnect_required";
    throw error;
  }
}

export async function markEveMailRead(
  characterId: number,
  accessToken: string,
  mailId: number,
  labels?: number[],
) {
  requireScope(
    accessToken,
    "esi-mail.organize_mail.v1",
    "Reconnect this character to allow Sage to mark or organize EVE Mail.",
  );
  await esi<void>(`/characters/${characterId}/mail/${mailId}/`, accessToken, {
    method: "PUT",
    body: JSON.stringify({
      read: true,
      ...(Array.isArray(labels) ? { labels } : {}),
    }),
  });
  return { read: true, mailId };
}

export async function deleteEveMail(
  characterId: number,
  accessToken: string,
  mailId: number,
) {
  requireScope(
    accessToken,
    "esi-mail.organize_mail.v1",
    "Reconnect this character to allow Sage to delete EVE Mail.",
  );
  await esi<void>(`/characters/${characterId}/mail/${mailId}/`, accessToken, { method: "DELETE" });
  return { deleted: true, mailId };
}

function escapeEveText(text: string) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

async function resolveRecipientNames(
  characterId: number,
  accessToken: string,
  names: string[],
): Promise<{ recipients: Array<{ recipient_id: number; recipient_type: EveMailRecipientType; name: string }>; unresolved: string[] }> {
  const requested = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 50);
  if (!requested.length) return { recipients: [], unresolved: [] };

  const mailingLists = await esi<Array<{ mailing_list_id: number; name: string }>>(
    `/characters/${characterId}/mail/lists/`,
    accessToken,
  ).catch(() => []);
  const listByName = new Map(mailingLists.map((row) => [String(row.name).toLowerCase(), row]));

  const recipients: Array<{ recipient_id: number; recipient_type: EveMailRecipientType; name: string }> = [];
  const unresolvedNames: string[] = [];
  const universeNames: string[] = [];

  for (const name of requested) {
    const list = listByName.get(name.toLowerCase());
    if (list) {
      recipients.push({ recipient_id: Number(list.mailing_list_id), recipient_type: "mailing_list", name: String(list.name) });
    } else {
      universeNames.push(name);
    }
  }

  if (universeNames.length) {
    const resolved: {
      characters?: Array<{ id: number; name: string }>;
      corporations?: Array<{ id: number; name: string }>;
      alliances?: Array<{ id: number; name: string }>;
    } = await publicEsi<{
      characters?: Array<{ id: number; name: string }>;
      corporations?: Array<{ id: number; name: string }>;
      alliances?: Array<{ id: number; name: string }>;
    }>("/universe/ids/", {
      method: "POST",
      body: JSON.stringify(universeNames),
    }).catch(() => ({}));

    const lookup = new Map<string, { recipient_id: number; recipient_type: EveMailRecipientType; name: string }>();
    for (const row of resolved.characters ?? []) lookup.set(row.name.toLowerCase(), { recipient_id: row.id, recipient_type: "character", name: row.name });
    for (const row of resolved.corporations ?? []) lookup.set(row.name.toLowerCase(), { recipient_id: row.id, recipient_type: "corporation", name: row.name });
    for (const row of resolved.alliances ?? []) lookup.set(row.name.toLowerCase(), { recipient_id: row.id, recipient_type: "alliance", name: row.name });

    for (const name of universeNames) {
      const match = lookup.get(name.toLowerCase());
      if (match) recipients.push(match);
      else unresolvedNames.push(name);
    }
  }

  return { recipients, unresolved: unresolvedNames };
}

export async function sendEveMail(
  characterId: number,
  accessToken: string,
  input: { recipients: string[]; subject: string; body: string },
) {
  requireScope(
    accessToken,
    "esi-mail.send_mail.v1",
    "Reconnect this character to enable EVE Mail sending in Sage.",
  );

  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!subject) throw new Error("Enter an EVE Mail subject.");
  if (!body) throw new Error("Enter an EVE Mail message.");
  if (subject.length > 1_000) throw new Error("EVE Mail subjects are limited to 1,000 characters.");
  if (body.length > 9_000) throw new Error("Keep EVE Mail messages below 9,000 plain-text characters so EVE markup stays within the 10,000-character API limit.");

  const resolved = await resolveRecipientNames(characterId, accessToken, input.recipients);
  if (resolved.unresolved.length) {
    throw new Error(`Could not resolve EVE recipient${resolved.unresolved.length === 1 ? "" : "s"}: ${resolved.unresolved.join(", ")}`);
  }
  if (!resolved.recipients.length) throw new Error("Enter at least one EVE character, corporation, alliance, or mailing-list recipient.");

  const mailId = await esi<number>(`/characters/${characterId}/mail/`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      recipients: resolved.recipients.map(({ recipient_id, recipient_type }) => ({ recipient_id, recipient_type })),
      subject,
      body: escapeEveText(body),
    }),
  });

  return {
    sent: true,
    mailId: Number(mailId),
    recipients: resolved.recipients,
  };
}
