import { startMcpServer } from "./mcp-server";

startMcpServer().catch((error) => {
  process.stderr.write(`New Eden Sage MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
