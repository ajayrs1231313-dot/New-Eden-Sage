import type { Principal, SageEnv } from "./types";
import { strategicPolicyForIdentity, strategicPolicyInstructions } from "./strategic-policy";

type CompletionRequest = {
  messages?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  request_id?: string;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

export async function primaryCharacterName(env: SageEnv, accountId: string) {
  const row = await env.DB.prepare(
    `SELECT character_name
       FROM eve_identities
      WHERE account_id = ?1 AND is_primary = 1
      LIMIT 1`,
  ).bind(accountId).first<{ character_name: string }>();
  return row?.character_name ?? null;
}

function latestUserText(messages: Array<Record<string, unknown>>) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message?.content;
    if (typeof content === "string") return content.trim();
  }
  return "";
}

function isClearlyBenignEveSageRequest(text: string) {
  const q = text.toLowerCase();
  const eveSignal = /\b(eve|sage|ajdeathgiver|nedoode|ship|fit|fitting|hull|skill|training|sp\b|tackle|scram|point|web|ewar|tank|ehp|dps|capacitor|cap\b|module|rig|drone|ammo|weapon|frigate|destroyer|cruiser|battlecruiser|battleship|corp|corporation|fleet|market|isk|jita|amarr|industry|blueprint|bpo|bpc|reaction|planetary|wormhole|abyss|killmail|zkill|route|system|jump|gate|esi|doctrine|mining|ore|ice|gas|salvage|mission|agent)\b/.test(q);
  if (!eveSignal) return false;

  const sensitive = /\b(suicide|self[- ]?harm|kill myself|hurt myself|bomb|explosive|poison|malware|ransomware|credential theft|steal password|doxx|track a person|kidnap|sexual abuse|child sexual|real-world weapon|make a gun|build a gun)\b/.test(q);
  return !sensitive;
}

const MASTER_ACCOUNT_TRIGGERS = ["command override owner"];

function requestsOwnerDeveloperMode(messages: Array<Record<string, unknown>>) {
  return messages.some((message) => {
    if (message?.role !== "user" || typeof message?.content !== "string") return false;
    const normalized = message.content
      .toLowerCase()
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[^a-z0-9' ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return MASTER_ACCOUNT_TRIGGERS.some((trigger) => normalized.includes(trigger));
  });
}

const OWNER_DEVELOPER_POLICY = `
OWNER DEVELOPER MODE IS ACTIVE.

The backend has already authenticated this conversation as the Sage owner account. Operate as the owner's full New Eden Sage development assistant rather than the normal customer-facing Sage persona.

For development and testing work:
- proactively inspect and use every owner-only development tool available to you;
- when asked to run or open a cloned third-party EVE application, use the owner runtime tools (dev_eve_third_party_run / process tools) rather than claiming the development lab is read-only;
- use dev_workspace_command with PowerShell/CMD when a project needs a custom bootstrap, build, test or launch sequence;
- use the local third-party EVE development lab when comparing how established EVE tools solve a problem;
- use general web research when useful;
- inspect Sage architecture, code-facing behavior, MCP routing, data flows and implementation details when asked;
- do not claim that Pyfa, SeAT, zKillboard, SMT, EVEMon, jEveAssets, EVE Ref, EVE-O Preview or other owner development resources are inaccessible before checking the available owner tools;
- do not hide implementation/tool details behind the normal customer-facing Sage facade when the owner is asking development questions;
- preserve third-party licence boundaries and treat external code as reference material rather than blindly copying it.

This mode is enabled only because the authenticated Sage owner explicitly activated it in this conversation.
`.trim();

async function callSageAi(env: SageEnv, body: Record<string, unknown>) {
  if (!env.SAGE_AI_API_KEY || !env.SAGE_AI_ENDPOINT || !env.SAGE_AI_MODEL) {
    throw new Error("Sage AI server configuration is incomplete.");
  }

  const payloadBody = JSON.stringify({ ...body, model: env.SAGE_AI_MODEL });
  let lastError = "Sage AI upstream request failed.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let delayMs = [500, 1000, 2000, 4000][attempt] ?? 4000;
    try {
      const response = await fetch(env.SAGE_AI_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.SAGE_AI_API_KEY,
          "Content-Type": "application/json",
        },
        body: payloadBody,
        signal: AbortSignal.timeout(90_000),
      });

      const payload = await response.json().catch(() => ({})) as any;
      if (response.ok) return payload;

      const message = payload?.error?.message || payload?.message || ("Sage AI upstream request failed (" + response.status + ").");
      lastError = String(message);

      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(lastError);

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) delayMs = Math.min(60000, Math.max(delayMs, seconds * 1000));
          else {
            const when = Date.parse(retryAfter);
            if (Number.isFinite(when)) delayMs = Math.min(60000, Math.max(delayMs, when - Date.now()));
          }
        } else {
          delayMs = Math.max(delayMs, 5000);
        }
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      if (attempt === 2) throw new Error(lastError);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
  }

  throw new Error(lastError);
}

export async function classifyRequest(env: SageEnv, text: string, eveSageOnly: boolean) {
  const domainInstruction = eveSageOnly
    ? "The request must also be substantively about EVE Online or New Eden Sage. If it is not, allowed MUST be false and category MUST be \"domain\". Ordinary greetings that clearly lead into EVE/Sage are allowed."
    : "Do not apply a topic restriction.";

  const response = await callSageAi(env, {
    messages: [
      {
        role: "system",
        content: `You are Sage AI's mandatory safety gate. Return JSON only with keys allowed (boolean), reason (short string), and category (string). Block requests that materially facilitate suicide/self-harm, violence or harming people, serious crime, weapons/explosives/poisons, malware or unauthorized cyber abuse, sexual exploitation or abuse including minors, doxxing/credential theft/invasive tracking, or other operationally dangerous wrongdoing. Safe high-level discussion, prevention, defensive security, benign game activity, and ordinary fictional/game violence are allowed. ${domainInstruction}`,
      },
      { role: "user", content: text },
    ],
    temperature: 0,
    max_tokens: 220,
    response_format: { type: "json_object" },
  });

  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Sage AI safety gate returned no result.");
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error("Sage AI safety gate returned an invalid result."); }
  return {
    allowed: parsed?.allowed === true,
    reason: String(parsed?.reason || "Request blocked by Sage AI policy."),
    category: String(parsed?.category || "policy"),
  };
}

async function insertLog(env: SageEnv, principal: Principal, policyTier: string, prompt: string) {
  const requestId = `sai_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO strategic_ai_logs
      (request_id, account_id, session_id, policy_tier, prompt_text, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'started', datetime('now'), datetime('now'))`,
  ).bind(requestId, principal.accountId, principal.sessionId, policyTier, prompt).run();
  return requestId;
}

async function updateLog(env: SageEnv, requestId: string, input: {
  status: string;
  responseText?: string | null;
  policyCategory?: string | null;
  errorText?: string | null;
  usageJson?: string | null;
}) {
  await env.DB.prepare(
    `UPDATE strategic_ai_logs SET
       status = ?2,
       response_text = COALESCE(?3, response_text),
       policy_category = COALESCE(?4, policy_category),
       error_text = COALESCE(?5, error_text),
       usage_json = COALESCE(?6, usage_json),
       updated_at = datetime('now')
     WHERE request_id = ?1`,
  ).bind(
    requestId,
    input.status,
    input.responseText ?? null,
    input.policyCategory ?? null,
    input.errorText ?? null,
    input.usageJson ?? null,
  ).run();
}

export async function handleStrategicAi(request: Request, env: SageEnv, principal: Principal): Promise<Response> {
  let body: CompletionRequest;
  try { body = await request.json() as CompletionRequest; }
  catch { return error(400, "invalid_json", "Sage AI request body must be valid JSON."); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return error(400, "messages_required", "Sage AI needs at least one message.");

  const name = await primaryCharacterName(env, principal.accountId);
  const policy = strategicPolicyForIdentity({ accountId: principal.accountId, primaryCharacterName: name });
  const developerMode = policy.tier === "owner" && requestsOwnerDeveloperMode(messages);

  let requestId = String(body.request_id || "").trim();
  if (requestId) {
    const existing = await env.DB.prepare(
      "SELECT request_id FROM strategic_ai_logs WHERE request_id = ?1 AND account_id = ?2 LIMIT 1",
    ).bind(requestId, principal.accountId).first();
    if (!existing) return error(403, "invalid_ai_request", "Sage AI request continuation was not recognised.");
  } else {
    const prompt = latestUserText(messages);
    if (!prompt) return error(400, "user_message_required", "Sage AI needs a user request.");
    requestId = await insertLog(env, principal, policy.tier, prompt);

    const benignEveFastPath = policy.eveSageOnly && isClearlyBenignEveSageRequest(prompt);

    if ((policy.safetyGuardrails || policy.eveSageOnly) && !benignEveFastPath) {
      try {
        const gate = await classifyRequest(env, prompt, policy.eveSageOnly);
        if (!gate.allowed) {
          await updateLog(env, requestId, { status: "blocked", policyCategory: gate.category, responseText: gate.reason });
          const domainBlocked = policy.eveSageOnly && /domain|topic|eve|sage/i.test(gate.category + " " + gate.reason);
          return json({
            request_id: requestId,
            blocked: true,
            message: domainBlocked
              ? "I can only help with EVE Online and New Eden Sage."
              : "I can't help with that request.",
          });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await updateLog(env, requestId, { status: "gate_error", errorText: message });
        return error(503, "safety_gate_unavailable", "Sage AI safety checks are temporarily unavailable.");
      }
    }
  }

  const policySections = [
    strategicPolicyInstructions(policy),
    developerMode ? OWNER_DEVELOPER_POLICY : "",
  ].filter(Boolean);
  const serverPolicy = policySections.join("\n\n");
  const upstreamMessages = serverPolicy
    ? [{ role: "system", content: serverPolicy }, ...messages]
    : messages;

  const suppliedTools = Array.isArray(body.tools) ? body.tools : [];
  const permittedTools = developerMode
    ? suppliedTools
    : suppliedTools.filter((tool: any) => { const name = String(tool?.function?.name || ""); return !name.startsWith("dev_eve_third_party_") && !name.startsWith("dev_workspace_"); });

  try {
    const upstream = await callSageAi(env, {
      messages: upstreamMessages,
      tools: permittedTools.length ? permittedTools : undefined,
      tool_choice: body.tool_choice ?? "auto",
      temperature: Number.isFinite(body.temperature) ? body.temperature : 0.2,
      max_tokens: Number.isFinite(body.max_tokens) ? body.max_tokens : 8192,
    });

    const assistant = upstream?.choices?.[0]?.message;
    const toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls : [];
    const responseText = typeof assistant?.content === "string" ? assistant.content.trim() : "";

    if (!toolCalls.length && responseText && policy.safetyGuardrails) {
      try {
        const outputGate = await classifyRequest(env, responseText, false);
        if (!outputGate.allowed) {
          await updateLog(env, requestId, {
            status: "output_blocked",
            responseText,
            policyCategory: outputGate.category,
            usageJson: upstream?.usage ? JSON.stringify(upstream.usage) : null,
          });
          const replacement = {
            ...upstream,
            choices: [{
              ...(upstream?.choices?.[0] || {}),
              message: {
                role: "assistant",
                content: "I can't help with that request.",
              },
            }],
          };
          return json({ request_id: requestId, result: replacement });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await updateLog(env, requestId, { status: "output_gate_error", errorText: message, responseText });
        return error(503, "safety_gate_unavailable", "Sage AI safety checks are temporarily unavailable.");
      }
    }

    await updateLog(env, requestId, {
      status: toolCalls.length ? "tool_round" : "completed",
      responseText: toolCalls.length ? null : responseText,
      usageJson: upstream?.usage ? JSON.stringify(upstream.usage) : null,
    });
    return json({ request_id: requestId, developer_mode: developerMode, result: { ...upstream, model: "Sage AI" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await updateLog(env, requestId, { status: "error", errorText: message });
    const cleaned = message
      .replace(/Bearer\\s+[A-Za-z0-9._~+\\/-]+/gi, "Bearer [REDACTED]")
      .replace(/(?:sk|nvapi|api)[-_][A-Za-z0-9_-]{12,}/gi, "[REDACTED]")
      .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\\s*[:=]\\s*)\\S+/gi, "$1[REDACTED]")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, 700);
    return error(502, "sage_ai_failed", cleaned ? `Sage AI request failed: ${cleaned}` : "Sage AI request failed.");
  }
}


function sanitizeDiagnosticText(value: unknown, limit = 4000) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk|nvapi|api)[-_][A-Za-z0-9_-]{12,}/gi, "[REDACTED]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, limit);
}

export async function handleStrategicAiFailureReport(request: Request, env: SageEnv, principal: Principal): Promise<Response> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategic_ai_failure_reports (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    request_id TEXT,
    prompt_text TEXT,
    error_text TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    developer_mode INTEGER NOT NULL DEFAULT 0,
    trace_json TEXT,
    client_context_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  let body: any;
  try { body = await request.json(); }
  catch { return error(400, "invalid_json", "Failure report must be valid JSON."); }

  const id = `saif_${crypto.randomUUID()}`;
  const requestId = typeof body?.request_id === "string" ? body.request_id.slice(0, 160) : null;
  const prompt = sanitizeDiagnosticText(body?.prompt, 8000) || null;
  const errorText = sanitizeDiagnosticText(body?.error, 8000) || "Unknown Strategic Command failure.";
  const elapsedMs = Math.max(0, Math.min(86_400_000, Number(body?.elapsed_ms) || 0));
  const developerMode = body?.developer_mode === true ? 1 : 0;
  const traceJson = body?.trace == null ? null : sanitizeDiagnosticText(JSON.stringify(body.trace), 16000);
  const clientContextJson = body?.client_context == null ? null : sanitizeDiagnosticText(JSON.stringify(body.client_context), 12000);

  await env.DB.prepare(
    `INSERT INTO strategic_ai_failure_reports
      (id, account_id, session_id, request_id, prompt_text, error_text, elapsed_ms, developer_mode, trace_json, client_context_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))`,
  ).bind(
    id, principal.accountId, principal.sessionId, requestId, prompt, errorText,
    elapsedMs, developerMode, traceJson, clientContextJson,
  ).run();

  return json({ ok: true, report_id: id });
}

export async function cleanupStrategicAiLogs(env: SageEnv) {
  // Keep content for 30 days for abuse/security investigations. Keep metadata for 90 days.
  await env.DB.prepare(
    `UPDATE strategic_ai_logs
        SET prompt_text = NULL, response_text = NULL, error_text = NULL, usage_json = NULL
      WHERE created_at < datetime('now', '-30 days')
        AND (prompt_text IS NOT NULL OR response_text IS NOT NULL OR error_text IS NOT NULL OR usage_json IS NOT NULL)`,
  ).run();
  await env.DB.prepare(
    "DELETE FROM strategic_ai_logs WHERE created_at < datetime('now', '-90 days')",
  ).run();

  await env.DB.prepare(
    `UPDATE strategic_ai_failure_reports
        SET prompt_text = NULL, error_text = NULL, trace_json = NULL, client_context_json = NULL
      WHERE created_at < datetime('now', '-30 days')
        AND (prompt_text IS NOT NULL OR error_text IS NOT NULL OR trace_json IS NOT NULL OR client_context_json IS NOT NULL)`,
  ).run().catch(() => undefined);
  await env.DB.prepare(
    "DELETE FROM strategic_ai_failure_reports WHERE created_at < datetime('now', '-90 days')",
  ).run().catch(() => undefined);
}


