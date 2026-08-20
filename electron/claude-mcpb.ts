import AdmZip from "adm-zip";

export type SageMcpLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type ClaudeMcpbManifestInput = {
  version: string;
  platform: NodeJS.Platform;
  launch: SageMcpLaunch;
};

export function buildClaudeMcpbManifest(input: ClaudeMcpbManifestInput) {
  return {
    $schema: "https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json",
    manifest_version: "0.4",
    name: "new-eden-sage",
    display_name: "New Eden Sage",
    version: input.version,
    description: "Connect Claude Desktop to New Eden Sage's local EVE Online intelligence and tools.",
    long_description: "Local-first MCP access to the EVE Online data already stored by New Eden Sage, including connected character snapshots, skills, assets, fittings, market intelligence and other Sage datasets. Credentials, refresh tokens and encrypted secrets are not exposed through MCP.",
    author: { name: "New Eden Sage contributors" },
    repository: {
      type: "git",
      url: "https://github.com/ajayrs1231313-dot/New-Eden-Sage",
    },
    homepage: "https://github.com/ajayrs1231313-dot/New-Eden-Sage",
    server: {
      type: "node",
      entry_point: "server/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.js"],
        env: {
          NEW_EDEN_SAGE_MCP_COMMAND: input.launch.command,
          NEW_EDEN_SAGE_MCP_ARGS_JSON: JSON.stringify(input.launch.args),
          NEW_EDEN_SAGE_MCP_ENV_JSON: JSON.stringify(input.launch.env),
        },
      },
    },
    tools_generated: true,
    keywords: ["eve-online", "new-eden-sage", "mcp", "market", "fittings"],
    compatibility: {
      claude_desktop: ">=1.0.0",
      platforms: [input.platform],
      runtimes: { node: ">=18.0.0" },
    },
  };
}

export function claudeMcpbProxySource() {
  return `"use strict";
const { spawn } = require("node:child_process");

function parseJson(name, fallback) {
  try { return JSON.parse(process.env[name] || fallback); }
  catch (error) {
    process.stderr.write("New Eden Sage MCP extension could not parse " + name + ": " + error.message + "\\n");
    process.exit(1);
  }
}

const command = process.env.NEW_EDEN_SAGE_MCP_COMMAND;
if (!command) {
  process.stderr.write("New Eden Sage MCP extension is missing its Sage launch path. Reinstall the extension from Sage Settings.\\n");
  process.exit(1);
}
const args = parseJson("NEW_EDEN_SAGE_MCP_ARGS_JSON", "[]");
const extraEnv = parseJson("NEW_EDEN_SAGE_MCP_ENV_JSON", "{}");
const child = spawn(command, args, {
  env: { ...process.env, ...extraEnv },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on("error", (error) => {
  process.stderr.write("New Eden Sage MCP server failed to start: " + error.message + "\\n");
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.stderr.write("New Eden Sage MCP server stopped with signal " + signal + "\\n");
  process.exit(code == null ? 1 : code);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
`;
}

export function buildClaudeMcpbBuffer(input: ClaudeMcpbManifestInput) {
  const manifest = buildClaudeMcpbManifest(input);
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  zip.addFile("server/index.js", Buffer.from(claudeMcpbProxySource(), "utf8"));
  return { manifest, buffer: zip.toBuffer() };
}
