import path from "node:path";
import { app } from "electron";
import { USER_DATA_ROOT } from "./data-paths";

export function sageMcpLaunch() {
  const command = app.getPath("exe");
  const script = path.join(app.getAppPath(), "dist-electron", "mcp-cli.js");
  return {
    command,
    args: [script],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT,
    },
  };
}
