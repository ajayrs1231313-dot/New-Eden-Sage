import { spawn } from "node:child_process";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { EXTERNAL_MCP_ACCESS_DENIED, loadExternalMcpOwnerToken } from "./mcp-owner-access";

async function run() {
  const proof = await loadExternalMcpOwnerToken();
  const script = path.join(__dirname, "mcp-cli.js");
  const child = spawn(process.execPath, [script], {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT,
      SAGE_EXTERNAL_MCP: "1",
      SAGE_EXTERNAL_MCP_PROOF: proof,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : EXTERNAL_MCP_ACCESS_DENIED}\n`);
  process.exitCode = 1;
});
