import { promises as fs } from "node:fs";
import path from "node:path";
import { LOG_ROOT } from "./data-paths";

export { LOG_ROOT };
export const LOG_FILE = path.join(LOG_ROOT, "new-eden-sage.log");

function safeDetails(details: Record<string, unknown>) {
  const blocked = /token|secret|authorization|api.?key|password/i;
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      blocked.test(key)
        ? "[REDACTED]"
        : value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
    ]),
  );
}

export async function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
) {
  try {
    await fs.mkdir(LOG_ROOT, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...safeDetails(details),
    });
    await fs.appendFile(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // Logging must never interrupt the app.
  }
}
