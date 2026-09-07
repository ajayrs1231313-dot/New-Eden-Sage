import { USER_DATA_ROOT } from "./data-paths";
import crypto from "node:crypto";
import http from "node:http";
import { app, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { refreshEveToken } from "./eve";
import { importFits, validateImportedFit, type ImportedFit, type ImportedFitItem } from "./fitting-import";
import { resolveFittingTypeNamesLocal } from "./fitting-dogma";
import { readCanonicalFittingStore, saveCanonicalFittingStore } from "./fitting-persistence";

type BridgeAction =
  | "save_sage_fit"
  | "delete_sage_fit"
  | "push_eve_fitting"
  | "delete_eve_fitting"
  | "list_sage_controls"
  | "invoke_sage_control"
  | "list_sage_actions"
  | "invoke_sage_action";

type RendererData = { savedFits: Array<Record<string, unknown>>; fitLibraryMeta: Record<string, unknown> };
type RendererFitUpdate = RendererData & { selectedFitId?: string };
let server: http.Server | null = null;

function bridgePath() { return path.join(USER_DATA_ROOT, "mcp-write-bridge.json"); }
function rendererPath() { return path.join(USER_DATA_ROOT, "mcp-renderer-data.json"); }

async function readRendererData(): Promise<RendererData> {
  const value = await readCanonicalFittingStore();
  return { savedFits: value.savedFits, fitLibraryMeta: value.fitLibraryMeta };
}

async function mergeWindowRendererData(value: RendererData, getWindow: () => BrowserWindow | null): Promise<RendererData> {
  if (value.savedFits.length || Object.keys(value.fitLibraryMeta).length) return value;
  const window = getWindow();
  if (!window || window.isDestroyed()) return value;
  try {
    const local = await window.webContents.executeJavaScript(`(() => {
      try {
        return {
          savedFits: JSON.parse(localStorage.getItem("new-eden-sage-fits") || "[]"),
          fitLibraryMeta: JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") || "{}")
        };
      } catch { return { savedFits: [], fitLibraryMeta: {} }; }
    })()`, true) as Partial<RendererData>;
    const merged = [...value.savedFits];
    for (const fit of Array.isArray(local.savedFits) ? local.savedFits : []) {
      if (!merged.some((item) => item.id === fit.id)) merged.push(fit);
    }
    return { savedFits: merged, fitLibraryMeta: { ...(local.fitLibraryMeta ?? {}), ...value.fitLibraryMeta } };
  } catch { return value; }
}

async function saveRendererData(value: RendererData, getWindow: () => BrowserWindow | null, selectedFitId?: string) {
  const persisted = await saveCanonicalFittingStore({ ...value, ...(selectedFitId ? { selectedFitId } : {}) }, USER_DATA_ROOT, { allowEmptyOverwrite: true });
  const update: RendererFitUpdate = { savedFits: persisted.savedFits, fitLibraryMeta: persisted.fitLibraryMeta, ...(persisted.selectedFitId ? { selectedFitId: persisted.selectedFitId } : {}) };
  const window = getWindow();
  if (window && !window.isDestroyed()) window.webContents.send("mcp:fit-data-updated", update);
  return update;
}

async function resolveFitForStorage(fit: ImportedFit): Promise<ImportedFit> {
  const racks = ["low", "mid", "high", "rig", "subsystem", "drones", "fighters", "cargo", "implants", "boosters"] as const;
  const items = [fit.hull, ...racks.flatMap((rack) => fit[rack])];
  const names = [...new Set(items.flatMap((item) => [
    !item.typeId ? item.name : "",
    item.charge && !item.chargeTypeId ? item.charge : "",
  ]).map((name) => name.trim()).filter(Boolean))];
  const resolved = names.length ? await resolveFittingTypeNamesLocal(names) : [];
  const byName = new Map(resolved.map((item) => [item.name.toLowerCase(), item]));
  const resolveItem = (item: ImportedFitItem): ImportedFitItem => {
    const match = !item.typeId ? byName.get(item.name.toLowerCase()) : undefined;
    const chargeMatch = item.charge && !item.chargeTypeId ? byName.get(item.charge.toLowerCase()) : undefined;
    return {
      ...item,
      name: match?.name ?? item.name,
      typeId: item.typeId ?? match?.id,
      charge: chargeMatch?.name ?? item.charge,
      chargeTypeId: item.chargeTypeId ?? chargeMatch?.id,
    };
  };
  const expandRack = (rackItems: ImportedFitItem[]) => rackItems.flatMap((item) => {
    const resolvedItem = resolveItem(item);
    return Array.from(
      { length: Math.max(1, Math.floor(resolvedItem.quantity || 1)) },
      () => ({ ...resolvedItem, quantity: 1 }),
    );
  });
  const result: ImportedFit = {
    ...fit,
    hull: resolveItem(fit.hull),
    low: expandRack(fit.low),
    mid: expandRack(fit.mid),
    high: expandRack(fit.high),
    rig: expandRack(fit.rig),
    subsystem: expandRack(fit.subsystem),
    drones: fit.drones.map(resolveItem),
    fighters: fit.fighters.map(resolveItem),
    cargo: fit.cargo.map(resolveItem),
    implants: fit.implants.map(resolveItem),
    boosters: fit.boosters.map(resolveItem),
  };
  const unresolved = [result.hull, ...racks.flatMap((rack) => result[rack])].filter((item) => !item.typeId);
  if (unresolved.length) {
    throw new Error(`Sage could not resolve ${unresolved.length} fitting item name(s) against the local SDE: ${[...new Set(unresolved.map((item) => item.name))].slice(0, 8).join(", ")}${unresolved.length > 8 ? "..." : ""}`);
  }
  return result;
}

async function accessToken(characterId: string) {
  const config = await readConfig();
  const stored = config.encryptedRefreshTokens[characterId];
  if (!stored) throw new Error("Character is not connected to Sage. Reconnect it in Settings first.");
  const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
  if (tokens.refresh_token) {
    config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
    await writeConfig(config);
  }
  return tokens.access_token;
}

async function eveRequest(characterId: string, pathname: string, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(`https://esi.evetech.net${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(characterId)}`,
      "Content-Type": "application/json",
      "X-Compatibility-Date": "2026-08-02",
      "X-User-Agent": "NewEdenSage/0.1.12",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`EVE fitting action failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  if (response.status === 204) return { success: true };
  return response.json() as Promise<unknown>;
}

type SageControlAction = "click" | "set_value" | "select_option" | "set_checked" | "focus" | "blur" | "press_key" | "scroll_into_view";

function liveWindow(getWindow: () => BrowserWindow | null) {
  const target = getWindow();
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    throw new Error("Open New Eden Sage before using live Sage controls.");
  }
  return target;
}

async function listSageControls(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  const payload = JSON.stringify({
    query: String(input.query ?? "").trim(),
    includeHidden: input.includeHidden === true,
    limit: Math.max(1, Math.min(2000, Number(input.limit ?? 500))),
  });
  return target.webContents.executeJavaScript(`(() => {
    const input = ${payload};
    const selector = [
      "button",
      "input",
      "select",
      "textarea",
      "a[href]",
      "summary",
      "[contenteditable='true']",
      "[role='button']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='menuitemcheckbox']",
      "[role='menuitemradio']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='combobox']",
      "[role='slider']",
      "[role='spinbutton']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const state = globalThis.__sageMcpControlState || (globalThis.__sageMcpControlState = { nextId: 1 });
    const elements = Array.from(document.querySelectorAll(selector));
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      const hidden = Boolean(
        element.hidden ||
        element.closest("[hidden],[aria-hidden='true']") ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0
      );
      let controlId = element.getAttribute("data-sage-mcp-control-id");
      if (!controlId) {
        controlId = "sage-control-" + state.nextId++;
        element.setAttribute("data-sage-mcp-control-id", controlId);
      }
      const tag = element.tagName.toLowerCase();
      const inputType = tag === "input" ? String(element.type || "text").toLowerCase() : undefined;
      const rawText = String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
      const label = String(
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        (element.labels && element.labels[0] && element.labels[0].innerText) ||
        element.getAttribute("placeholder") ||
        rawText ||
        element.getAttribute("name") ||
        element.id ||
        controlId
      ).replace(/\\s+/g, " ").trim();
      const value = tag === "input" || tag === "textarea" || tag === "select"
        ? (inputType === "password" ? "[hidden]" : String(element.value ?? ""))
        : undefined;
      return {
        controlId,
        tag,
        type: inputType,
        role: element.getAttribute("role") || undefined,
        label: label.slice(0, 300),
        text: rawText.slice(0, 500),
        value,
        checked: typeof element.checked === "boolean" ? element.checked : undefined,
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        hidden,
        id: element.id || undefined,
        name: element.getAttribute("name") || undefined,
        placeholder: element.getAttribute("placeholder") || undefined,
        href: tag === "a" ? String(element.href || "") : undefined,
        selectedText: tag === "select" && element.selectedIndex >= 0 ? String(element.options[element.selectedIndex]?.text || "") : undefined,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    };
    const query = input.query.toLowerCase();
    const all = elements.map(describe);
    const filtered = all.filter((control) => {
      if (!input.includeHidden && control.hidden) return false;
      if (!query) return true;
      return [control.controlId, control.label, control.text, control.id, control.name, control.placeholder, control.role, control.type]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
    return {
      url: globalThis.location.href,
      title: document.title,
      totalDiscovered: all.length,
      matching: filtered.length,
      returned: Math.min(filtered.length, input.limit),
      controls: filtered.slice(0, input.limit)
    };
  })()`, true);
}

async function invokeSageControl(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  const payload = JSON.stringify({
    controlId: String(input.controlId ?? ""),
    action: String(input.action ?? ""),
    value: input.value,
    key: input.key == null ? undefined : String(input.key),
  });
  return target.webContents.executeJavaScript(`(() => {
    const input = ${payload};
    const element = Array.from(document.querySelectorAll("[data-sage-mcp-control-id]"))
      .find((candidate) => candidate.getAttribute("data-sage-mcp-control-id") === input.controlId);
    if (!element) throw new Error("Sage control is no longer present. Call list_sage_controls again to refresh live control IDs.");
    const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
    if (disabled && !["focus", "blur", "scroll_into_view"].includes(input.action)) {
      throw new Error("Sage control is disabled in the current UI state.");
    }
    const dispatchValueEvents = () => {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const setNativeValue = (value) => {
      if (element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter ? setter.call(element, value) : (element.value = value);
      } else if (element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter ? setter.call(element, value) : (element.value = value);
      } else if (element instanceof HTMLSelectElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        setter ? setter.call(element, value) : (element.value = value);
      } else if (element.isContentEditable) {
        element.textContent = value;
      } else {
        throw new Error("This Sage control does not accept a text value.");
      }
      dispatchValueEvents();
    };
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    switch (input.action) {
      case "click":
        element.click();
        break;
      case "set_value":
        setNativeValue(String(input.value ?? ""));
        break;
      case "select_option":
        if (!(element instanceof HTMLSelectElement)) throw new Error("select_option requires a select control.");
        if (!Array.from(element.options).some((option) => option.value === String(input.value ?? ""))) {
          throw new Error("No option with that value exists on the Sage control.");
        }
        setNativeValue(String(input.value ?? ""));
        break;
      case "set_checked": {
        if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) {
          throw new Error("set_checked requires a checkbox or radio control.");
        }
        const desired = Boolean(input.value);
        if (element.type === "checkbox" && element.checked !== desired) {
          element.click();
        } else if (element.type === "radio" && desired && !element.checked) {
          element.click();
        } else if (element.type === "radio" && !desired && element.checked) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          setter ? setter.call(element, false) : (element.checked = false);
          dispatchValueEvents();
        }
        break;
      }
      case "focus":
        element.focus();
        break;
      case "blur":
        element.blur();
        break;
      case "press_key": {
        const key = String(input.key || input.value || "");
        if (!key) throw new Error("press_key requires key.");
        element.focus();
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
        break;
      }
      case "scroll_into_view":
        break;
      default:
        throw new Error("Unsupported Sage control action: " + input.action);
    }
    const rect = element.getBoundingClientRect();
    return {
      success: true,
      controlId: input.controlId,
      action: input.action,
      tag: element.tagName.toLowerCase(),
      label: String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
      value: element instanceof HTMLInputElement && element.type === "password"
        ? "[hidden]"
        : ("value" in element ? String(element.value ?? "") : undefined),
      checked: typeof element.checked === "boolean" ? element.checked : undefined,
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  })()`, true);
}

async function listSageActions(getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  return target.webContents.executeJavaScript(`(() => {
    const sage = globalThis.sage;
    if (!sage || typeof sage !== "object") throw new Error("The Sage renderer bridge is not available.");
    return {
      bridgeInfo: sage.bridgeInfo ?? null,
      actions: Object.keys(sage).sort().filter((name) => typeof sage[name] === "function").map((name) => ({
        name,
        kind: /^on[A-Z]/.test(name) ? "event-subscription" : "action"
      }))
    };
  })()`, true);
}

async function invokeSageAction(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  const payload = JSON.stringify({
    actionName: String(input.actionName ?? ""),
    args: Array.isArray(input.args) ? input.args : [],
  });
  return target.webContents.executeJavaScript(`(async () => {
    const input = ${payload};
    const sage = globalThis.sage;
    if (!sage || typeof sage !== "object") throw new Error("The Sage renderer bridge is not available.");
    if (!Object.prototype.hasOwnProperty.call(sage, input.actionName) || typeof sage[input.actionName] !== "function") {
      throw new Error("Unknown Sage renderer action: " + input.actionName);
    }
    if (/^on[A-Z]/.test(input.actionName)) {
      throw new Error("Event subscription functions are discoverable but are not one-shot MCP actions.");
    }
    return await sage[input.actionName](...input.args);
  })()`, true);
}

async function perform(action: BridgeAction, input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  if (action === "list_sage_controls") return listSageControls(input, getWindow);
  if (action === "invoke_sage_control") return invokeSageControl(input, getWindow);
  if (action === "list_sage_actions") return listSageActions(getWindow);
  if (action === "invoke_sage_action") return invokeSageAction(input, getWindow);
  if (action === "save_sage_fit") {
    const payload = input.fit ?? input.payload ?? input.text;
    const parsed = importFits(payload).map(validateImportedFit);
    if (!parsed.length) throw new Error("No fitting could be parsed from the MCP payload.");
    const imported = await Promise.all(parsed.map(resolveFitForStorage));
    const data = await mergeWindowRendererData(await readRendererData(), getWindow);
    const operations: Array<{ fitId: string; operation: "created" | "updated" }> = [];
    for (const fit of imported) {
      const index = data.savedFits.findIndex((item) => item.id === fit.id);
      if (index >= 0) data.savedFits[index] = fit; else data.savedFits.push(fit);
      operations.push({ fitId: fit.id, operation: index >= 0 ? "updated" : "created" });
    }
    await saveRendererData(data, getWindow, operations[0]?.fitId);
    return { success: true, count: imported.length, fits: operations, fitId: operations[0]?.fitId, operation: operations[0]?.operation };
  }
  if (action === "delete_sage_fit") {
    const fitId = String(input.fitId ?? "");
    const data = await mergeWindowRendererData(await readRendererData(), getWindow);
    const before = data.savedFits.length;
    data.savedFits = data.savedFits.filter((item) => item.id !== fitId);
    delete data.fitLibraryMeta[fitId];
    await saveRendererData(data, getWindow);
    return { success: true, fitId, deleted: data.savedFits.length < before };
  }
  const characterId = String(input.characterId ?? "");
  if (!/^\d+$/.test(characterId)) throw new Error("A valid connected character ID is required.");
  if (action === "push_eve_fitting") {
    return eveRequest(characterId, `/characters/${characterId}/fittings/`, "POST", input.fitting);
  }
  const fittingId = Number(input.fittingId);
  if (!Number.isSafeInteger(fittingId) || fittingId <= 0) throw new Error("A valid EVE fitting ID is required.");
  return eveRequest(characterId, `/characters/${characterId}/fittings/${fittingId}/`, "DELETE");
}

export async function startMcpWriteBridge(getWindow: () => BrowserWindow | null) {
  if (server) return;
  const token = crypto.randomBytes(32).toString("base64url");
  server = http.createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "POST" || request.url !== "/action" || request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(404).end(); return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action: BridgeAction; input?: Record<string, unknown> };
        const result = await perform(body.action, body.input ?? {}, getWindow);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => server!.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the Sage MCP write bridge.");
  await fs.writeFile(bridgePath(), JSON.stringify({ port: address.port, token }), { encoding: "utf8", mode: 0o600 });
}

export async function stopMcpWriteBridge() {
  await fs.rm(bridgePath(), { force: true });
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}
