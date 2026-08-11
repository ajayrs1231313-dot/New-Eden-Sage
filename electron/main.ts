import { app } from "electron";

if (process.argv.includes("--mcp")) {
  void app.whenReady().then(async () => {
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer();
  });
} else {
  void import("./market-intelligence-ipc.js");
  void import("./main-task9.js");
}
