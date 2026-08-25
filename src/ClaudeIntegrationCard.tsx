import "./claude-integration.css";
import type { ClaudeCompatibilityStatus } from "./types";

type Setup = { claudeCode: string } | null;
type Props = {
  status: ClaudeCompatibilityStatus | null;
  setup: Setup;
  busy: boolean;
  onInstall(): void;
  onVerify(): void;
  onShowBundle(): void;
  onDirectRepair(): void;
  onCopyCode(): void;
};

function desktopLabel(status: ClaudeCompatibilityStatus["desktop"] | undefined) {
  if (!status) return "Detecting";
  if (!status.detected) return "Not detected";
  if (status.verified) return "Connected & verified";
  if (status.restartRequired) return "Restart Claude";
  if (status.installPending) return status.manualInstallRequired ? "Manual install needed" : "Approve in Claude";
  if (status.extensionInstalled) return "Installed · unverified";
  if (status.directConfigPresent) return "Config present · unverified";
  return "Ready to install";
}
function desktopClass(status: ClaudeCompatibilityStatus["desktop"] | undefined) {
  if (status?.verified) return "ready";
  if (status?.detected) return "attention";
  return "muted";
}

export function ClaudeIntegrationCard({ status, setup, busy, onInstall, onVerify, onShowBundle, onDirectRepair, onCopyCode }: Props) {
  const desktop = status?.desktop;
  const code = status?.code;
  return <section className="mcp-claude-panel settings-integration-card claude-integration-card">
    <div className="settings-integration-head">
      <div><span>CLAUDE</span><strong>Desktop & Code</strong></div>
      <b className={desktopClass(desktop)}>{desktopLabel(desktop)}</b>
    </div>
    <p><b>Recommended:</b> Claude Desktop Extension (MCPB). Sage prepares the extension and asks Claude to open its own install confirmation. Sage only reports success after Claude actually initializes the MCP server and lists its tools.</p>

    <div className="mcp-client-status-grid claude-status-grid">
      <div>
        <span>Claude Desktop</span>
        <b className={desktopClass(desktop)}>{desktopLabel(desktop)}</b>
        {desktop?.verifiedAt && <small>Verified {new Date(desktop.verifiedAt).toLocaleString()}</small>}
        {desktop?.evidence && <small className="claude-evidence">{desktop.evidence}</small>}
        {desktop?.method === "mcpb" && desktop.extensionInstalled && <small>Desktop Extension installed.</small>}
        {desktop?.directConfigPresent && <small>Legacy direct MCP entry is also present.</small>}
        {desktop?.restartRequired && <small className="mcp-client-warning">Fully quit and reopen Claude Desktop, then click Verify.</small>}
        {desktop?.installPending && !desktop.manualInstallRequired && <small>Claude should be showing an extension install/permission confirmation. Approve it there, then return to Sage.</small>}
        {desktop?.error && <small className="mcp-client-error">{desktop.error}</small>}
      </div>
      <div>
        <span>Claude Code</span>
        <b className={code?.configured ? "ready" : code?.detected ? "attention" : "muted"}>{code?.configured ? "Configured (user scope)" : code?.detected ? "Needs repair" : "Not detected"}</b>
        {code?.evidence && <small>{code.evidence}</small>}
        {code?.path && <small>{code.path}</small>}
        {code?.error && <small className="mcp-client-error">{code.error}</small>}
      </div>
    </div>

    <div className="mcp-setup-actions claude-actions">
      <button className="primary" disabled={busy || !desktop?.detected} onClick={onInstall}>{desktop?.extensionInstalled ? "Reinstall / repair extension" : "Install in Claude Desktop"}</button>
      <button disabled={busy} onClick={onVerify}>Verify connection</button>
      <button disabled={busy} onClick={onShowBundle}>Show MCPB file</button>
      {setup && <button disabled={busy} onClick={onCopyCode}>Copy Code command</button>}
    </div>

    {!desktop?.detected && <div className="claude-callout warning"><strong>Claude Desktop is not detected.</strong><span>Install Claude Desktop and open it once. Then return here and click Verify connection.</span></div>}
    {desktop?.verified && <div className="claude-callout success"><strong>Claude can use New Eden Sage.</strong><span>A normal Claude Desktop conversation should now be able to see the Sage MCP tools. In Claude you can also use the + button → Connectors to inspect connected tools.</span></div>}

    <details className="claude-manual" open={Boolean(desktop?.manualInstallRequired)}>
      <summary><span>Manual install / troubleshooting</span><small>Full instructions if one-click installation does not work</small></summary>
      <div className="claude-manual-body">
        <strong>Manual MCPB installation</strong>
        <ol>
          <li>Click <b>Show MCPB file</b> above. Sage will highlight <code>new-eden-sage.mcpb</code>.</li>
          <li>Open <b>Claude Desktop</b>.</li>
          <li>Go to <b>Settings → Extensions → Advanced settings</b>.</li>
          <li>Under the Extension Developer section choose <b>Install Extension…</b>.</li>
          <li>Select the highlighted <code>new-eden-sage.mcpb</code> file.</li>
          <li>Review the extension details/permissions and choose <b>Install</b> in Claude.</li>
          <li>Return to Sage and click <b>Verify connection</b>. Sage will not call it connected until Claude has actually initialized the server and listed its tools.</li>
        </ol>
        {desktop?.bundlePath && <div className="claude-path"><span>MCPB file</span><code>{desktop.bundlePath}</code></div>}

        <strong>If Claude says the extension is installed but the tools are missing</strong>
        <ol>
          <li>Fully quit Claude Desktop, including any tray/background instance.</li>
          <li>Open Claude Desktop again.</li>
          <li>Open a normal chat, click the <b>+</b> button and check <b>Connectors</b> for New Eden Sage.</li>
          <li>Return here and click <b>Verify connection</b>.</li>
        </ol>
        {desktop?.logPath && <div className="claude-path"><span>Last verification log</span><code>{desktop.logPath}</code></div>}

        <details className="claude-direct-fallback">
          <summary>Legacy direct-config fallback</summary>
          <div>
            <p>Use this only if the supported MCPB/Desktop Extension installer cannot be made to work on this Claude installation. Sage will merge <code>new-eden-sage</code> into <code>claude_desktop_config.json</code> without deleting existing settings or MCP servers.</p>
            <p><b>Claude Desktop does not reliably hot-reload this file.</b> After using the fallback, fully quit and reopen Claude Desktop, then click Verify connection.</p>
            <button disabled={busy} onClick={onDirectRepair}>Apply direct-config fallback</button>
            {desktop?.configPath && <div className="claude-path"><span>Config location</span><code>{desktop.configPath}</code></div>}
          </div>
        </details>
      </div>
    </details>
  </section>;
}
