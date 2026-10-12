import { dialog } from "electron";
import { promises as fs } from "node:fs";
import { SAGE_ONLINE_URL } from "./sage-online";

export type OwnerLogUser = {
  account_id: string;
  primary_character_id: number | null;
  character_name: string | null;
  ai_count: number;
  failure_count: number;
  browser_count: number;
};
export type OwnerLogUserList = { users: OwnerLogUser[]; sources: string[]; exportFormat: string };
type LogPage = { source: string; accountId: string; rows: Record<string, unknown>[]; nextOffset: number | null };

async function ownerRead<T>(token: string, path: string): Promise<T> {
  const response = await fetch(SAGE_ONLINE_URL + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(body.message || body.error || "Owner diagnostic request failed: HTTP " + response.status);
  }
  return await response.json() as T;
}

export async function listOwnerLogUsers(token: string): Promise<OwnerLogUserList> {
  return await ownerRead<OwnerLogUserList>(token, "/v1/owner/logs/users");
}

export async function downloadOwnerLogs(token: string, accountId: string): Promise<{
  saved: boolean; cancelled?: boolean; file?: string; total?: number; counts?: Record<string, number>;
}> {
  if (accountId !== "all" && !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
    throw new Error("Invalid account identifier.");
  }
  const name = accountId === "all" ? "all-users" : accountId;
  const selected = await dialog.showSaveDialog({
    title: "Export private Sage AI diagnostics",
    defaultPath: "sage-ai-logs-" + name + "-" + new Date().toISOString().slice(0, 10) + ".jsonl",
    filters: [{ name: "JSON Lines (readable text)", extensions: ["jsonl"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (selected.canceled || !selected.filePath) return { saved: false, cancelled: true };
  const handle = await fs.open(selected.filePath, "w", 0o600);
  const counts: Record<string, number> = { ai: 0, failures: 0, browser: 0 };
  try {
    const intro = { recordType: "sage_ai_owner_export", schemaVersion: 1, targetAccountId: accountId,
      exportedAt: new Date().toISOString(), sources: Object.keys(counts),
      note: "Plaintext owner-only diagnostics. Protect this file; it may contain private prompts, responses and identifiers." };
    await handle.write(JSON.stringify(intro) + "\n");
    for (const source of ["ai", "failures", "browser"]) {
      let offset = 0;
      // Export in pages to bound memory and avoid a large Worker response.
      for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
        const query = new URLSearchParams({ source, accountId, offset: String(offset), limit: "100" });
        const page = await ownerRead<LogPage>(token, "/v1/owner/logs/export?" + query);
        if (!Array.isArray(page.rows) || page.source !== source || page.accountId !== accountId) {
          throw new Error("Invalid Sage diagnostic page response.");
        }
        for (const row of page.rows) {
          await handle.write(JSON.stringify({ recordType: source, ...row }) + "\n");
          counts[source]++;
        }
        if (page.nextOffset == null) break;
        if (page.nextOffset <= offset || page.rows.length === 0 || pageNumber === 9999) {
          throw new Error("Sage AI diagnostics pagination did not complete safely.");
        }
        offset = page.nextOffset;
      }
    }
    await handle.sync();
    return { saved: true, file: selected.filePath, total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  } catch (error) {
    // Do not leave a misleading truncated evidence export on the disk.
    await handle.close();
    await fs.rm(selected.filePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
