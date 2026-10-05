import { SAGE_ACTION_MANIFEST } from "./sage-action-manifest";
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
  | "capture_sage_page"
  | "list_sage_pages"
  | "get_sage_page_values"
  | "navigate_sage_page"
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


async function executeSageScript(target: BrowserWindow, script: string, userGesture = true): Promise<any> {
  const reply = await target.webContents.executeJavaScript(`(async () => {
    try { return { ok: true, value: await (${script}) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  })()`, userGesture) as { ok: boolean; value?: unknown; error?: string };
  if (!reply.ok) throw new Error(reply.error || "Sage renderer action failed");
  return reply.value;
}

async function listSagePages(getWindow: () => BrowserWindow | null) {
  return executeSageScript(liveWindow(getWindow), `(() => ({
    currentPageId: document.documentElement.dataset.sagePage,
    pages: JSON.parse(document.documentElement.dataset.sagePages || "[]").map(page => ({
      ...page, mounted: page.id === document.documentElement.dataset.sagePage ||
        !!document.querySelector('[data-sage-page="' + page.id + '"]')
    }))
  }))()`, true);
}

async function navigateSagePage(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  const pageId = String(input.pageId ?? "");
  const pages = await listSagePages(getWindow) as { pages: Array<{ id: string }> };
  if (!pages.pages.some(page => page.id === pageId)) throw new Error("Unknown Sage page: " + pageId);
  await executeSageScript(target, `window.dispatchEvent(new CustomEvent("sage:mcp-navigate", { detail: { pageId: ${JSON.stringify(pageId)} } }))`, true);
  // Wait for React to commit the destination, without starting any refresh loop.
  await executeSageScript(target, `new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (document.documentElement.dataset.sagePage === ${JSON.stringify(pageId)}) resolve(true);
      else if (Date.now() - started > 5000) reject(new Error("Sage navigation timed out"));
      else setTimeout(check, 20);
    }; check();
  })`, true);
  return { success: true, pageId };
}

async function getSagePageValues(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const payload = JSON.stringify({ offset: Number(input.offset ?? 0), limit: Number(input.limit ?? 500), query: String(input.query ?? ""), includeHidden: input.includeHidden === true });
  return executeSageScript(liveWindow(getWindow), `(() => {
    const input = ${payload};
    const hidden = element => !!element.closest('[hidden],[aria-hidden="true"]') ||
      getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden" || !element.getClientRects().length;
    const state = globalThis.__sageMcpValueState || (globalThis.__sageMcpValueState = { nextId: 1 });
    const values = [];
    const add = (element, kind, value) => {
      if (!value || (!input.includeHidden && hidden(element))) return;
      if (element.closest('script,style,noscript,input[type="password"]')) return;
      let valueId = element.getAttribute("data-sage-mcp-value-id");
      if (!valueId) { valueId = "sage-value-" + state.nextId++; element.setAttribute("data-sage-mcp-value-id", valueId); }
      values.push({ valueId, kind, value, tag: element.tagName.toLowerCase(),
        label: element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("name") || undefined,
        pageId: element.closest('[data-sage-page]')?.getAttribute('data-sage-page') || document.documentElement.dataset.sagePage,
        hidden: hidden(element) });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim();
      if (node.parentElement && text) add(node.parentElement, "text", text);
    }
    for (const element of document.querySelectorAll('input,textarea,select,meter,progress,img,svg,canvas,time,[title],[aria-label],[aria-valuenow]')) {
      if (element instanceof HTMLInputElement && element.type === "password") continue;
      if ('value' in element) add(element, "value", String(element.value));
      for (const attr of ['title','aria-label','aria-valuenow','aria-valuetext','alt','datetime']) add(element, attr, element.getAttribute(attr));
      if (element instanceof HTMLSelectElement) for (const option of element.options) add(element, "option", JSON.stringify({ value: option.value, text: option.text, selected: option.selected, disabled: option.disabled }));
      if ('checked' in element) add(element, "checked", String(element.checked));
      if (element instanceof HTMLCanvasElement) add(element, "graphic", "Canvas graphic; use page-specific data actions for underlying values");
    }
    const filtered = values.filter(item => !input.query || JSON.stringify(item).toLowerCase().includes(input.query.toLowerCase()));
    return { pageId: document.documentElement.dataset.sagePage, capturedAt: new Date().toISOString(),
      total: filtered.length, offset: input.offset, values: filtered.slice(input.offset, input.offset + input.limit),
      nextOffset: input.offset + input.limit < filtered.length ? input.offset + input.limit : null };
  })()`, true);
}

async function listSageControls(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  const payload = JSON.stringify({
    query: String(input.query ?? "").trim(),
    includeHidden: input.includeHidden === true,
    limit: Math.max(1, Math.min(2000, Number(input.limit ?? 500))),
    offset: Math.max(0, Number(input.offset ?? 0)),
  });
  return executeSageScript(target, `(() => {
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
    const eventsFor = element => {
      const key = Object.keys(element).find(key => key.startsWith("__reactProps$"));
      const props = key ? element[key] : null;
      return props ? Object.keys(props).filter(name => /^on[A-Z]/.test(name) && typeof props[name] === "function") : [];
    };
    const elements = Array.from(document.querySelectorAll("*"))
      .filter(element => element.matches(selector) || eventsFor(element).length || element.matches('canvas,[draggable="true"]'));
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
      const referencedText = (attribute) => String(element.getAttribute(attribute) || "")
        .split(/\\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
      const label = String(
        element.getAttribute("aria-label") ||
        referencedText("aria-labelledby") ||
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
      const events = eventsFor(element);
      const role = element.getAttribute("role");
      const explicitDescription = element.getAttribute("data-sage-mcp-description");
      const accessibleDescription = element.getAttribute("aria-description") || referencedText("aria-describedby");
      const tooltip = element.getAttribute("title");
      const region = element.closest('dialog,[role="dialog"],fieldset,section,article,[role="region"],form');
      const heading = region?.querySelector('legend,h1,h2,h3,h4,h5,h6');
      const context = String(heading?.textContent || "").replace(/\\s+/g, " ").trim();
      const hasMeaningfulLabel = label !== controlId && !/^[+×✕?…⋮⋯−-]$/.test(label);
      const subject = hasMeaningfulLabel ? JSON.stringify(label) : "this unlabeled control";
      let behavior;
      const supportedActions = ["focus", "blur", "scroll_into_view", "press_key"];
      if (tag === "select") { behavior = "Choose an option for " + subject + ". Use select_option with an option's value, not its display text."; supportedActions.push("select_option"); }
      else if (inputType === "file") { behavior = "Import local files using " + subject + ". Use upload_files with absolute file paths."; supportedActions.push("upload_files"); }
      else if (["checkbox", "radio"].includes(inputType) || ["checkbox", "radio", "switch"].includes(role)) { behavior = "Change the enabled or selected state of " + subject + ". The checked field reports the current state."; supportedActions.push("click"); if (["checkbox", "radio"].includes(inputType)) supportedActions.push("set_checked"); }
      else if (["input", "textarea"].includes(tag) || element.isContentEditable) { behavior = "Enter or edit " + subject + ". Use set_value; changes are sent through the page's input handlers."; if (!element.readOnly) supportedActions.push("set_value"); }
      else if (tag === "summary") { behavior = "Expand or collapse " + subject + " to show or hide its details."; supportedActions.push("click"); }
      else if (role === "tab" || element.closest('[role="tablist"]')) { behavior = "Open the " + subject + " section in the current Sage workspace."; supportedActions.push("click"); }
      else if (tag === "a") { behavior = "Follow the " + subject + " link. The href field identifies its destination."; supportedActions.push("click"); }
      else if (tag === "form") { behavior = "Submit " + subject + " after filling its fields; normal form validation still applies."; supportedActions.push("submit"); }
      else if (tag === "canvas") { behavior = "Interact with this graphical view. Use capture_sage_page to inspect it and the listed events to identify available gestures."; supportedActions.push("click"); }
      else { behavior = "Activate " + subject + ". Its precise effect is only known when the label, tooltip or explicit description explains it."; if (tag === "button" || role === "button" || events.includes("onClick")) supportedActions.push("click"); }
      if (events.some(name => /MouseEnter|MouseOver|MouseMove|PointerEnter|PointerMove/.test(name))) { behavior += " Responds to hovering or pointer movement; inspect the page after hovering for any tooltip or changed state."; supportedActions.push("hover"); }
      if (events.includes("onContextMenu")) { behavior += " Right-click opens its context action or information."; supportedActions.push("right_click"); }
      if (events.includes("onDoubleClick")) { behavior += " A double-click handler is available."; supportedActions.push("double_click"); }
      if (events.some(name => /Drag|Drop/.test(name)) || element.draggable) { behavior += " Supports drag/drop interaction; use a discovered destination control."; supportedActions.push("drag_drop"); }
      if (events.includes("onPointerDown") || events.includes("onMouseDown")) supportedActions.push("pointer_drag");
      if (events.includes("onWheel")) { behavior += " Wheel input is available for this view."; supportedActions.push("wheel"); }
      if (element.readOnly) behavior += " This field is read-only.";
      const descriptionSource = explicitDescription ? "explicit" : accessibleDescription ? "accessibility" : tooltip ? "tooltip" : hasMeaningfulLabel ? "label-and-control-type" : "control-type-only";
      const description = [explicitDescription || accessibleDescription || tooltip, behavior, context ? "Context: " + context + "." : ""].filter(Boolean).join(" ");
      return {
        controlId,
        tag,
        type: inputType,
        role: element.getAttribute("role") || undefined,
        label,
        description,
        descriptionSource,
        purposeNeedsClarification: !explicitDescription && !accessibleDescription && !tooltip && !hasMeaningfulLabel,
        context: context || undefined,
        supportedActions,
        text: rawText,
        events,
        pageId: element.closest("[data-sage-page]")?.getAttribute("data-sage-page") || document.documentElement.dataset.sagePage,
        options: tag === "select" ? Array.from(element.options).map(option => ({ value: option.value, text: option.text, disabled: option.disabled, selected: option.selected })) : undefined,
        value,
        checked: typeof element.checked === "boolean" ? element.checked : element.getAttribute("aria-checked") === "true" ? true : element.getAttribute("aria-checked") === "false" ? false : undefined,
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
      return [control.controlId, control.label, control.description, control.context, control.text, control.id, control.name, control.placeholder, control.role, control.type]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
    return {
      url: globalThis.location.href,
      title: document.title,
      totalDiscovered: all.length,
      matching: filtered.length,
      returned: Math.min(Math.max(0, filtered.length - input.offset), input.limit),
      offset: input.offset,
      nextOffset: input.offset + input.limit < filtered.length ? input.offset + input.limit : null,
      controls: filtered.slice(input.offset, input.offset + input.limit)
    };
  })()`, true);
}

async function invokeSageControl(input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  const target = liveWindow(getWindow);
  if (input.action === "upload_files") {
    const files = Array.isArray(input.filePaths) ? input.filePaths.map(String) : [];
    for (const file of files) {
      if (!path.isAbsolute(file)) throw new Error("Upload requires absolute file paths");
      if (!(await fs.stat(file)).isFile()) throw new Error("Upload path is not a file");
    }
    await executeSageScript(target, `(() => {
      const el=Array.from(document.querySelectorAll("[data-sage-mcp-control-id]")).find(el=>el.getAttribute("data-sage-mcp-control-id")===${JSON.stringify(String(input.controlId))});
      if (!(el instanceof HTMLInputElement) || el.type!=="file") throw new Error("upload_files requires a file input");
      if(el.disabled) throw new Error("File input is disabled");
      if(!el.multiple && ${files.length}>1) throw new Error("This input accepts only one file");
    })()`);
    const debuggerApi = target.webContents.debugger;
    const attachedHere = !debuggerApi.isAttached();
    if (attachedHere) debuggerApi.attach("1.3");
    try {
      const {root} = await debuggerApi.sendCommand("DOM.getDocument");
      const {nodeId} = await debuggerApi.sendCommand("DOM.querySelector", {nodeId:root.nodeId,selector:'[data-sage-mcp-control-id='+JSON.stringify(String(input.controlId))+']'});
      if(!nodeId) throw new Error("File input is no longer present");
      await debuggerApi.sendCommand("DOM.setFileInputFiles",{nodeId,files});
    } finally {if(attachedHere) debuggerApi.detach();}
    return {success:true,controlId:input.controlId,action:input.action,fileCount:files.length};
  }
  if (["pointer_drag", "wheel"].includes(String(input.action))) {
    const bounds = await executeSageScript(target, `(async () => {
      const element = Array.from(document.querySelectorAll("[data-sage-mcp-control-id]")).find(el => el.getAttribute("data-sage-mcp-control-id") === ${JSON.stringify(String(input.controlId))});
      if (!element) throw new Error("Control is no longer present; rediscover controls");
      if (element.disabled || element.getAttribute("aria-disabled") === "true" || element.closest("[hidden],[inert]")) throw new Error("Control is disabled or hidden");
      element.scrollIntoView({block:"nearest"}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`) as { x: number; y: number; width: number; height: number };
    const x = Math.round(bounds.x + Number(input.x ?? bounds.width / 2));
    const y = Math.round(bounds.y + Number(input.y ?? bounds.height / 2));
    target.webContents.sendInputEvent({type:"mouseMove",x,y});
    await new Promise(resolve=>setTimeout(resolve,30));
    if (input.action === "wheel") {
      const deltaX = Number(input.deltaX ?? 0);
      const deltaY = Number(input.deltaY ?? 0);
      await executeSageScript(target, `(() => { const element=Array.from(document.querySelectorAll("[data-sage-mcp-control-id]")).find(el=>el.getAttribute("data-sage-mcp-control-id")===${JSON.stringify(String(input.controlId))}); if(!element) throw new Error("Control is no longer present; rediscover controls"); element.dispatchEvent(new WheelEvent("wheel",{deltaX:${deltaX},deltaY:${deltaY},clientX:${x},clientY:${y},bubbles:true,cancelable:true})); return true; })()`);
    }
    else {
      target.webContents.sendInputEvent({type:"mouseDown",x,y,button:"left",clickCount:1});
      try {
        const endX=Math.round(bounds.x+Number(input.endX ?? bounds.width / 2)), endY=Math.round(bounds.y+Number(input.endY ?? bounds.height / 2));
        for(let step=1;step<=10;step++) {
          target.webContents.sendInputEvent({type:"mouseMove",x:Math.round(x+(endX-x)*step/10),y:Math.round(y+(endY-y)*step/10)});
          await new Promise(resolve=>setTimeout(resolve,16));
        }
        target.webContents.sendInputEvent({type:"mouseUp",x:endX,y:endY,button:"left",clickCount:1});
      } catch(error) { target.webContents.sendInputEvent({type:"mouseUp",x,y,button:"left",clickCount:1}); throw error; }
    }
    return {success:true,controlId:input.controlId,action:input.action};
  }
  const payload = JSON.stringify({
    controlId: String(input.controlId ?? ""),
    action: String(input.action ?? ""),
    value: input.value,
    key: input.key == null ? undefined : String(input.key),
    targetControlId: input.targetControlId,
    data: input.data,
    modifiers: input.modifiers,
    x: input.x, y: input.y,
  });
  return executeSageScript(target, `(() => {
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
      if (element.readOnly) throw new Error("This Sage field is read-only.");
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
        if (input.x != null || input.y != null || element instanceof HTMLCanvasElement || element instanceof SVGElement) {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: rect.x + Number(input.x ?? rect.width / 2), clientY: rect.y + Number(input.y ?? rect.height / 2) }));
        } else element.click();
        break;
      case "hover":
      case "double_click":
      case "right_click": {
        const rect = element.getBoundingClientRect();
        const clientX = rect.x + Number(input.x ?? rect.width / 2);
        const clientY = rect.y + Number(input.y ?? rect.height / 2);
        const names = input.action === "hover" ? ["mouseover", "mouseenter", "mousemove"] : input.action === "right_click" ? ["contextmenu"] : ["dblclick"];
        for (const name of names) element.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, clientX, clientY, button: input.action === "right_click" ? 2 : 0 }));
        if (input.action === "hover") for (const name of ["pointerover", "pointerenter", "pointermove"]) element.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse" }));
        break;
      }
      case "drag_drop": {
        const destination = Array.from(document.querySelectorAll("[data-sage-mcp-control-id]")).find(candidate => candidate.getAttribute("data-sage-mcp-control-id") === input.targetControlId);
        if (!destination) throw new Error("Destination control is no longer present; rediscover controls.");
        if (destination.disabled || destination.getAttribute("aria-disabled") === "true") throw new Error("Destination is disabled.");
        const dataTransfer = new DataTransfer();
        for (const [type, value] of Object.entries(input.data || {})) dataTransfer.setData(type, String(value));
        const fire = (node, type) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
        fire(element, "dragstart"); fire(destination, "dragenter"); fire(destination, "dragover"); fire(destination, "drop"); fire(element, "dragend");
        break;
      }
      case "submit": {
        const form = element instanceof HTMLFormElement ? element : element.form || element.closest("form");
        if (!form) throw new Error("submit requires a form or form control");
        form.requestSubmit();
        break;
      }
      case "set_value":
        setNativeValue(String(input.value ?? ""));
        break;
      case "select_option":
        if (!(element instanceof HTMLSelectElement)) throw new Error("select_option requires a select control.");
        if (!Array.from(element.options).some((option) => option.value === String(input.value ?? "") && !option.disabled)) {
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
        element.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey:input.modifiers?.includes("control"),shiftKey:input.modifiers?.includes("shift"),altKey:input.modifiers?.includes("alt"),metaKey:input.modifiers?.includes("meta"), bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key, ctrlKey:input.modifiers?.includes("control"),shiftKey:input.modifiers?.includes("shift"),altKey:input.modifiers?.includes("alt"),metaKey:input.modifiers?.includes("meta"), bubbles: true, cancelable: true }));
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
  const manifest = JSON.stringify(SAGE_ACTION_MANIFEST);
  return executeSageScript(target, `(() => {
    const sage = globalThis.sage;
    if (!sage || typeof sage !== "object") throw new Error("The Sage renderer bridge is not available.");
    return {
      bridgeInfo: sage.bridgeInfo ?? null,
      actions: Object.keys(sage).sort().filter((name) => typeof sage[name] === "function").map((name) => ({
        name,
        ...(${manifest}[name] || {}),
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
  return executeSageScript(target, `(async () => {
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
  if (action === "capture_sage_page") {
    const image = await liveWindow(getWindow).webContents.capturePage();
    return { mimeType: "image/png", data: image.toPNG().toString("base64") };
  }
  if (action === "list_sage_pages") return listSagePages(getWindow);
  if (action === "navigate_sage_page") return navigateSagePage(input, getWindow);
  if (action === "get_sage_page_values") return getSagePageValues(input, getWindow);
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
    if (input.openInFitter === true) {
      await navigateSagePage({ pageId: "fittings" }, getWindow);
      // The destination may have mounted after the initial IPC update.
      await saveRendererData(data, getWindow, operations[0]?.fitId);
    }
    return { success: true, count: imported.length, fits: operations, fitId: operations[0]?.fitId, operation: operations[0]?.operation, openedInFitter: input.openInFitter === true };
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
