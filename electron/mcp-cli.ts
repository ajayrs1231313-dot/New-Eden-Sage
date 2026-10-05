import { configureSnapshotEncryptionKey } from "./snapshot-crypto";
import { loadMcpPrivateDataEncryptionKey } from "./mcp-private-key";
import { assertExternalMcpOwnerProof, EXTERNAL_MCP_ACCESS_DENIED } from "./mcp-owner-access";

async function run() {
  if (process.env.SAGE_EXTERNAL_MCP === "1") {
    await assertExternalMcpOwnerProof(process.env.SAGE_EXTERNAL_MCP_PROOF);
  }
  const privateDataKey = await loadMcpPrivateDataEncryptionKey();
  configureSnapshotEncryptionKey(privateDataKey);
  const { startMcpServer } = await import("./mcp-server.js");
  await startMcpServer();
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message || EXTERNAL_MCP_ACCESS_DENIED}\n`);
  process.exitCode = 1;
});
