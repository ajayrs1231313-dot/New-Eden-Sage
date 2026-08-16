import nodeFs, { promises as fs } from "node:fs";
import path from "node:path";
import { LOG_ROOT } from "./data-paths";

export { LOG_ROOT };
export const LOG_FILE = path.join(LOG_ROOT, "new-eden-sage.log");
export const CRASH_LOG_FILE = path.join(LOG_ROOT, "crashes.jsonl");

let processErrorLoggingInstalled = false;

function serialiseError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error
        ? {
            name: error.cause.name,
            message: error.cause.message,
            stack: error.cause.stack,
          }
        : error.cause,
    };
  }
  return { message: String(error) };
}

function safeDetails(details: Record<string, unknown>) {
  const blocked = /token|secret|authorization|api.?key|password/i;
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      blocked.test(key)
        ? "[REDACTED]"
        : value instanceof Error
          ? serialiseError(value)
          : value,
    ]),
  );
}

/** Synchronous by design: fatal processes may exit before an async append completes. */
export function logCrash(event: string, details: Record<string, unknown> = {}) {
  try {
    nodeFs.mkdirSync(LOG_ROOT, { recursive: true });
    nodeFs.appendFileSync(CRASH_LOG_FILE, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      pid: process.pid,
      processType: process.type ?? "node",
      ...safeDetails(details),
    })}\n`, "utf8");
  } catch {
    // A crash reporter must never become the crash.
  }
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
      pid: process.pid,
      ...safeDetails(details),
    });
    await fs.appendFile(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // Logging must never interrupt the app.
  }
}

export function installProcessErrorLogging(source = "main") {
  if (processErrorLoggingInstalled) return;
  processErrorLoggingInstalled = true;
  logCrash("crash_recorder.installed", { source, argv: process.argv.slice(0, 3) });

  process.on("uncaughtException", (error) => {
    logCrash("process.uncaught_exception", { source, error });
    void logEvent("error", "process.uncaught_exception", {
      source,
      error,
    });
  });

  process.on("unhandledRejection", (reason) => {
    logCrash("process.unhandled_rejection", { source, error: reason instanceof Error ? reason : new Error(String(reason)) });
    void logEvent("error", "process.unhandled_rejection", {
      source,
      error: reason instanceof Error ? reason : new Error(String(reason)),
    });
  });

  process.on("warning", (warning) => {
    void logEvent("warn", "process.warning", {
      source,
      warning,
    });
  });
}
