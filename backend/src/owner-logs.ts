import type { Principal, SageEnv } from "./types";
import { strategicPolicyForIdentity } from "./strategic-policy";

type Source = "ai" | "failures" | "browser";
const SOURCES = {
  ai: { table: "strategic_ai_logs", orderId: "request_id" },
  failures: { table: "strategic_ai_failure_reports", orderId: "id" },
  browser: { table: "strategic_ai_browser_logs", orderId: "id" },
} as const;
const headers = {
  "Cache-Control": "no-store, private",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** The server is authoritative; the UI visibility check is never sufficient. */
export async function requireOwnerLogsAccess(env: SageEnv, principal: Principal): Promise<boolean> {
  if (strategicPolicyForIdentity({ accountId: principal.accountId }).tier !== "owner") return false;
  const row = await env.DB.prepare(
    "SELECT id FROM accounts WHERE id = ?1 AND primary_eve_character_id = ?2 AND status = 'active' LIMIT 1",
  ).bind(principal.accountId, 569399317).first<{ id: string }>();
  return Boolean(row);
}

function wholeNumber(raw: string | null, defaultValue: number, ceiling: number): number | null {
  if (raw == null) return defaultValue;
  if (!/^\d{1,8}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= ceiling ? n : null;
}

export async function handleOwnerLogsApi(
  request: Request, env: SageEnv, principal: Principal, url: URL,
): Promise<Response> {
  if (!await requireOwnerLogsAccess(env, principal)) {
    return respond({ error: "not_found", message: "Resource not found." }, 404);
  }
  if (request.method !== "GET") return respond({ error: "method_not_allowed" }, 405);

  if (url.pathname === "/v1/owner/logs/users") {
    const sql = [
      "WITH active AS (",
      "SELECT account_id FROM strategic_ai_logs UNION",
      "SELECT account_id FROM strategic_ai_failure_reports UNION",
      "SELECT account_id FROM strategic_ai_browser_logs)",
      "SELECT a.account_id, ac.primary_eve_character_id AS primary_character_id,",
      "(SELECT e.character_name FROM eve_identities e WHERE e.account_id = a.account_id",
      "ORDER BY e.is_primary DESC, e.character_name ASC LIMIT 1) AS character_name,",
      "(SELECT COUNT(*) FROM strategic_ai_logs l WHERE l.account_id = a.account_id) AS ai_count,",
      "(SELECT COUNT(*) FROM strategic_ai_failure_reports f WHERE f.account_id = a.account_id) AS failure_count,",
      "(SELECT COUNT(*) FROM strategic_ai_browser_logs b WHERE b.account_id = a.account_id) AS browser_count",
      "FROM active a LEFT JOIN accounts ac ON ac.id = a.account_id",
      "ORDER BY ai_count + failure_count + browser_count DESC, a.account_id ASC LIMIT 1000",
    ].join(" ");
    const result = await env.DB.prepare(sql).all();
    return respond({
      users: result.results,
      sources: ["ai", "failures", "browser"],
      storage: "Cloudflare D1 managed at-rest encryption; diagnostic fields are saved as readable data",
      exportFormat: "UTF-8 JSONL (plaintext when saved)",
    });
  }

  if (url.pathname === "/v1/owner/logs/export") {
    const source = url.searchParams.get("source") as Source | null;
    if (!source || !Object.prototype.hasOwnProperty.call(SOURCES, source)) {
      return respond({ error: "invalid_source" }, 400);
    }
    const accountId = url.searchParams.get("accountId");
    if (!accountId || (accountId !== "all" && !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId))) {
      return respond({ error: "invalid_account" }, 400);
    }
    const limit = wholeNumber(url.searchParams.get("limit"), 100, 250);
    const offset = wholeNumber(url.searchParams.get("offset"), 0, 1000000);
    if (limit === null || limit < 1 || offset === null) {
      return respond({ error: "invalid_pagination" }, 400);
    }
    const def = SOURCES[source];
    const where = accountId === "all" ? "" : "WHERE account_id = ?1";
    const sql = "SELECT * FROM " + def.table + " " + where +
      " ORDER BY created_at ASC, " + def.orderId + " ASC LIMIT " +
      (accountId === "all" ? "?1" : "?2") + " OFFSET " + (accountId === "all" ? "?2" : "?3");
    const stmt = env.DB.prepare(sql);
    const result = await (accountId === "all"
      ? stmt.bind(limit, offset)
      : stmt.bind(accountId, limit, offset)).all();
    const rows = result.results || [];
    await env.DB.prepare(
      "INSERT INTO owner_log_export_audit (id, owner_account_id, target_account_id, source, row_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
    ).bind(crypto.randomUUID(), principal.accountId, accountId, source, rows.length).run();
    return respond({
      source, accountId, rows, offset, nextOffset: rows.length < limit ? null : offset + rows.length,
    });
  }
  return respond({ error: "not_found" }, 404);
}
