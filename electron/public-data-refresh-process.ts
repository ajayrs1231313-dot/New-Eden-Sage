import { ensureCurrentSharedMarketData } from "./shared-market-data";

function finish(message: unknown) {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  process.send(message, () => {
    if (process.connected) process.disconnect?.();
    setImmediate(() => process.exit(0));
  });
}

void ensureCurrentSharedMarketData((message, completed, total) => {
  process.send?.({ type: "progress", message, completed, total });
}).then((result) => {
  finish({ type: "complete", result });
}).catch((error) => {
  finish({ type: "error", error: error instanceof Error ? error.message : String(error) });
});
