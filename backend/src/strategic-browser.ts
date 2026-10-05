import type { Principal, SageEnv } from "./types";
import { classifyRequest, primaryCharacterName } from "./strategic-ai";
import { strategicPolicyForIdentity } from "./strategic-policy";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(Number.parseInt(n, 16)));
}

function stripHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|article|section|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function unsafeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1"
  ) return true;

  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe8[0-9a-f]:/i.test(host)) return true;
  return false;
}

function safeUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("That web address is invalid."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Sage AI can only open normal web pages.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed.");
  if (unsafeHost(url.hostname)) throw new Error("Private and local network addresses are not available to Sage AI.");
  return url;
}

async function logBrowserEvent(env: SageEnv, principal: Principal, input: {
  requestId?: string;
  action: "search" | "open";
  queryText?: string | null;
  targetUrl?: string | null;
  purposeText?: string | null;
  status: string;
}) {
  await env.DB.prepare(
    `INSERT INTO strategic_ai_browser_logs
      (account_id, session_id, request_id, action, query_text, target_url, purpose_text, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))`,
  ).bind(
    principal.accountId,
    principal.sessionId,
    input.requestId || null,
    input.action,
    input.queryText ?? null,
    input.targetUrl ?? null,
    input.purposeText ?? null,
    input.status,
  ).run().catch(() => undefined);
}

async function policyFor(env: SageEnv, principal: Principal) {
  const name = await primaryCharacterName(env, principal.accountId);
  return strategicPolicyForIdentity({ accountId: principal.accountId, primaryCharacterName: name });
}

async function gateBrowserIntent(env: SageEnv, principal: Principal, text: string) {
  const policy = await policyFor(env, principal);
  if (!policy.safetyGuardrails && !policy.eveSageOnly) return { policy, allowed: true };

  const gate = await classifyRequest(env, text, policy.eveSageOnly);
  if (!gate.allowed) {
    return {
      policy,
      allowed: false,
      message: policy.eveSageOnly && /domain|topic|eve|sage/i.test(gate.category + " " + gate.reason)
        ? "Web research is limited to EVE Online and New Eden Sage for this account."
        : "That web research request is not available.",
    };
  }
  return { policy, allowed: true };
}

function resultUrl(href: string) {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://html.duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch {
    return decoded;
  }
}

export async function handleStrategicBrowserSearch(request: Request, env: SageEnv, principal: Principal) {
  let body: { query?: string; max_results?: number; request_id?: string };
  try { body = await request.json() as typeof body; }
  catch { return error(400, "invalid_json", "Web search request must be valid JSON."); }

  const query = String(body.query || "").trim();
  if (!query) return error(400, "query_required", "A web search query is required.");
  const requestId = String(body.request_id || "").trim();

  let gate;
  try { gate = await gateBrowserIntent(env, principal, query); }
  catch { return error(503, "browser_policy_unavailable", "Sage AI web policy checks are temporarily unavailable."); }
  if (!gate.allowed) {
    await logBrowserEvent(env, principal, { requestId, action: "search", queryText: query, status: "blocked" });
    return error(403, "browser_policy_blocked", gate.message || "That web search is not available.");
  }

  const maxResults = Math.max(1, Math.min(10, Math.trunc(Number(body.max_results) || 6)));
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NewEdenSage/1.0; +https://new-eden-sage-online.ajayrs2512.workers.dev)",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    await logBrowserEvent(env, principal, { requestId, action: "search", queryText: query, status: "error" });
    return error(502, "web_search_failed", "Sage AI web search is temporarily unavailable.");
  }

  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blockPattern = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(html)) && results.length < maxResults) {
    const block = blockMatch[1];
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
    const href = resultUrl(link[1]);
    try { safeUrl(href); } catch { continue; }
    results.push({
      title: stripHtml(link[2]).slice(0, 300),
      url: href,
      snippet: stripHtml(snippetMatch?.[1] || "").slice(0, 800),
    });
  }

  // DuckDuckGo changes markup occasionally; fall back to direct result anchors.
  if (!results.length) {
    const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) && results.length < maxResults) {
      const href = resultUrl(match[1]);
      try { safeUrl(href); } catch { continue; }
      results.push({ title: stripHtml(match[2]).slice(0, 300), url: href, snippet: "" });
    }
  }

  await logBrowserEvent(env, principal, { requestId, action: "search", queryText: query, status: "ok" });
  return json({ query, results });
}

export async function handleStrategicBrowserOpen(request: Request, env: SageEnv, principal: Principal) {
  let body: { url?: string; purpose?: string; max_chars?: number; request_id?: string };
  try { body = await request.json() as typeof body; }
  catch { return error(400, "invalid_json", "Open-page request must be valid JSON."); }

  const rawUrl = String(body.url || "").trim();
  const purpose = String(body.purpose || "").trim();
  if (!rawUrl) return error(400, "url_required", "A web address is required.");
  if (!purpose) return error(400, "purpose_required", "Sage AI must state why it is opening a page.");
  const requestId = String(body.request_id || "").trim();

  let gate;
  try { gate = await gateBrowserIntent(env, principal, purpose); }
  catch { return error(503, "browser_policy_unavailable", "Sage AI web policy checks are temporarily unavailable."); }
  if (!gate.allowed) {
    await logBrowserEvent(env, principal, { requestId, action: "open", targetUrl: rawUrl, purposeText: purpose, status: "blocked" });
    return error(403, "browser_policy_blocked", gate.message || "That page cannot be opened for this request.");
  }

  let url: URL;
  try { url = safeUrl(rawUrl); }
  catch (cause) {
    await logBrowserEvent(env, principal, { requestId, action: "open", targetUrl: rawUrl, purposeText: purpose, status: "blocked" });
    return error(400, "unsafe_url", cause instanceof Error ? cause.message : "That web address is not available.");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NewEdenSage/1.0; +https://new-eden-sage-online.ajayrs2512.workers.dev)",
      "Accept": "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.2",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    await logBrowserEvent(env, principal, { requestId, action: "open", targetUrl: url.href, purposeText: purpose, status: "error" });
    return error(502, "web_open_failed", `Sage AI could not open that page (${response.status}).`);
  }

  let finalUrl: URL;
  try { finalUrl = safeUrl(response.url || url.href); }
  catch { return error(403, "unsafe_redirect", "The page redirected to a private or unsupported address."); }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const text = /html|xhtml/i.test(contentType) ? stripHtml(raw) : raw.trim();
  const maxChars = Math.max(2_000, Math.min(60_000, Math.trunc(Number(body.max_chars) || 30_000)));

  await logBrowserEvent(env, principal, { requestId, action: "open", targetUrl: finalUrl.href, purposeText: purpose, status: "ok" });
  return json({
    url: finalUrl.href,
    title: /html|xhtml/i.test(contentType)
      ? stripHtml(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 300)
      : "",
    content_type: contentType,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  });
}


export async function cleanupStrategicBrowserLogs(env: SageEnv) {
  await env.DB.prepare(
    `UPDATE strategic_ai_browser_logs
        SET query_text = NULL, target_url = NULL, purpose_text = NULL
      WHERE created_at < datetime('now', '-30 days')
        AND (query_text IS NOT NULL OR target_url IS NOT NULL OR purpose_text IS NOT NULL)`,
  ).run();
  await env.DB.prepare(
    "DELETE FROM strategic_ai_browser_logs WHERE created_at < datetime('now', '-90 days')",
  ).run();
}
