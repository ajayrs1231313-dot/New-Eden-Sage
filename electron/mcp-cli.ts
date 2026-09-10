import { configureSnapshotEncryptionKey } from "./snapshot-crypto";
import { loadMcpPrivateDataEncryptionKey } from "./mcp-private-key";

async function run() {
  const privateDataKey = await loadMcpPrivateDataEncryptionKey();
  configureSnapshotEncryptionKey(privateDataKey);
  const { startMcpServer } = await import("./mcp-server.js");
  await startMcpServer();
}

run().catch((error) => {
  process.stderr.write(`New Eden Sage MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
