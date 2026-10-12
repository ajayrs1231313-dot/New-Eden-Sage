import { characterSnapshotRevision, getSnapshot } from "./database";
import { mentionsName } from "./strategic-router";
import { estimateTrainingSeconds } from "./skill-training";
import type { AppConfig } from "./config";

type History = Array<{ role: string; content: string }>;
type LocalCharacter = { characterId: string; name: string; updatedAt: string; snapshot: any; summary: Record<string, unknown> };
export type StrategicLocalContext = { characters: LocalCharacter[]; summary: Record<string, unknown> };
type LocalConfig = Pick<AppConfig, "sageAccountId" | "encryptedRefreshTokens">;
type Dependencies = { revision(): string; snapshot(id: string): unknown };
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const money = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ISK`;

function summarise(snapshot: any) {
  const assets = Array.isArray(snapshot.extended?.assets) ? snapshot.extended.assets : null;
  const seen = new Set<string>();
  let assetValue = 0, unpriced = 0, stacks = 0;
  for (const asset of assets ?? []) {
    const id = asset.item_id == null ? undefined : String(asset.item_id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    stacks++;
    const value = number(asset.estimatedValue);
    if (value == null || value <= 0 || /unpriced|identity-unavailable/.test(String(asset.valuation_source ?? ""))) unpriced++;
    else assetValue += value;
  }
  return {
    characterId: String(snapshot.characterId), name: String(snapshot.character?.name ?? "Unknown"),
    snapshotState: snapshot.snapshotState ?? "unknown", updatedAt: snapshot.updatedAt ?? null,
    coreUpdatedAt: snapshot.coreUpdatedAt ?? snapshot.updatedAt ?? null,
    walletUpdatedAt: snapshot.walletUpdatedAt ?? snapshot.coreUpdatedAt ?? snapshot.updatedAt ?? null,
    wallet: number(snapshot.wallet), retainedAssetValue: assets ? assetValue : null, assetStacks: stacks, unpricedAssetStacks: unpriced,
    totalSp: number(snapshot.skills?.total_sp), unallocatedSp: number(snapshot.skills?.unallocated_sp),
    queueEntries: Array.isArray(snapshot.queue) ? snapshot.queue.length : null,
    ship: snapshot.ship?.ship_type_name ?? null, location: snapshot.location?.place_name ?? snapshot.location?.solar_system_name ?? null,
    availableSections: [...Object.keys(snapshot), ...Object.keys(snapshot.extended ?? {})].filter((key) => !/token|secret|password|encrypted|authorization|key/i.test(key)),
  };
}

// Full private snapshots stay in the existing encrypted SQLite store. This index
// is in process memory only and is invalidated by DB revision or account scope.
export function createStrategicLocalReader(deps: Dependencies) {
  let cached: StrategicLocalContext | undefined, revision = "", scope = "";
  return (config: LocalConfig): StrategicLocalContext => {
    const ids = Object.keys(config.encryptedRefreshTokens ?? {}).filter((id) => /^\d+$/.test(id)).sort();
    const nextScope = JSON.stringify([config.sageAccountId ?? "", ids]);
    const nextRevision = deps.revision();
    if (cached && scope === nextScope && revision === nextRevision) return cached;
    // Drop the previous account's data before loading the next account.
    cached = undefined; scope = nextScope; revision = nextRevision;
    const characters: LocalCharacter[] = [];
    if (config.sageAccountId) for (const id of ids) {
      const snapshot = deps.snapshot(id) as any;
      if (!snapshot || String(snapshot.characterId) !== id) continue;
      characters.push({ characterId: id, name: String(snapshot.character?.name ?? "Unknown"), updatedAt: String(snapshot.updatedAt ?? ""), snapshot, summary: summarise(snapshot) });
    }
    cached = { characters, summary: { source: "Local encrypted Sage snapshots; no live EVE request was made.",
      characters: characters.map((character) => character.summary),
      valuationScope: "Retained personal asset estimates and wallet only; orders, escrow, contracts, corporate holdings and unpriced assets are not included." } };
    return cached;
  };
}

export const readStrategicLocalContext = createStrategicLocalReader({ revision: characterSnapshotRevision, snapshot: getSnapshot });

export function localCharacterSection(context: StrategicLocalContext, characterId: string, section: string) {
  const snapshot = context.characters.find((character) => character.characterId === characterId)?.snapshot;
  if (!snapshot) throw new Error("Character is not linked to this Sage account.");
  return { structuredContent: { data: { characterId, section, data: snapshot[section] ?? snapshot.extended?.[section] ?? null } } };
}

function duration(seconds: number) {
  const minutes = Math.ceil(Math.max(0, seconds) / 60), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes % 60 ? `${minutes % 60}m` : ""].filter(Boolean).join(" ") || "under a minute";
}
function freshness(character: LocalCharacter, field = "coreUpdatedAt") {
  const raw = character.summary[field] ?? character.updatedAt;
  const time = typeof raw === "string" ? Date.parse(raw) : NaN;
  return `Local snapshot: ${Number.isFinite(time) ? new Date(time).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "sync time unavailable"}.`;
}

export function answerLocalCharacterQuestion(message: string, history: History, context: StrategicLocalContext, now = Date.now()): string | undefined {
  const q = message.trim().toLowerCase().replace(/[’]/g, "'");
  // Avoid silently answering just one part of a recommendation/action request.
  if (/\b(buy|sell|invest|fit|build|optimise|optimize|recommend|best|refresh|sync|transfer|send|delete|compare|why)\b/.test(q)) return undefined;
  const worth = /\b(net worth|how much (?:am i|is .+?) worth|how wealthy|total wealth|total asset value|value of my assets|what are my assets worth)\b/.test(q);
  const wallet = !worth && /\b(wallet balance|how much isk (?:do i|does .+?) have|how much money (?:do i|does .+?) have|my balance)\b/.test(q);
  const training = /\b(how long|training time|time to train|when will|when does)\b/.test(q) && /\b(train|training|queue|skill|finish|complete)\b/.test(q);
  const currentShip = /\b(?:what|which) ship (?:am i|is .+?) (?:currently )?in\b/.test(q);
  const location = /\bwhere (?:am i|is .+?) (?:currently|docked|located)\b/.test(q) || /^where am i[?.!]*$/.test(q);
  if (!worth && !wallet && !training && !currentShip && !location) return undefined;
  const named = context.characters.filter((character) => mentionsName(message, character.name));
  let selected = named;
  if (!selected.length && /\b(this|that|it|him|her|them)\b/.test(q)) {
    const previous = [...history].reverse().find((entry) => entry.role === "user");
    if (previous) selected = context.characters.filter((character) => mentionsName(previous.content, character.name));
  }
  if (!selected.length && context.characters.length === 1) selected = context.characters;
  const all = /\b(all|combined|overall|across|total)\b/.test(q) && /\b(characters|pilots|accounts|wealth|net worth)\b/.test(q);
  if (all && (worth || wallet)) selected = context.characters;
  if (!selected.length) return context.characters.length
    ? `Which character should I use: ${context.characters.map((character) => character.name).join(", ")}? I can also total all linked characters.`
    : "No linked character snapshot is available locally. Connect and sync a character in Sage first.";
  if ((training || currentShip || location) && selected.length !== 1) return "Choose one character for this question.";
  if (worth || wallet) {
    let total = 0, complete = true;
    const answers = selected.map((character) => {
      const s = character.summary;
      const balance = number(s.wallet), assets = number(s.retainedAssetValue);
      if (balance == null || worth && assets == null) complete = false;
      total += (balance ?? 0) + (worth ? assets ?? 0 : 0);
      return `**${character.name}**\nWallet: ${balance == null ? "not downloaded" : money(balance)}.`
        + (worth ? `\nRetained asset estimate: ${assets == null ? "not downloaded" : money(assets)}.\nWallet + priced assets: ${balance != null && assets != null ? money(balance + assets) : "incomplete"}.${Number(s.unpricedAssetStacks) ? ` ${s.unpricedAssetStacks} asset stacks have no retained valuation.` : ""}` : "")
        + `\n${freshness(character, "walletUpdatedAt")}${worth ? ` Asset snapshot: ${character.updatedAt || "unknown"}.` : ""}`;
    });
    return answers.join("\n\n") + (selected.length > 1 ? `\n\n${complete ? "Combined" : "Known subtotal (incomplete)"}: **${money(total)}**.` : "")
      + (worth ? "\n\nThis is a local wallet-and-assets estimate, not a complete liquidation value. Unpriced items, orders/escrow, contracts and corporation holdings are excluded; retained prices may be old." : "");
  }
  const character = selected[0], snapshot = character.snapshot;
  if (currentShip) return `**${character.name}**: ${snapshot.ship?.ship_type_name || "current ship not downloaded"}.\n${freshness(character)}`;
  if (location) return `**${character.name}**: ${snapshot.location?.place_name || snapshot.location?.solar_system_name || "location not downloaded"}.\n${freshness(character)}`;
  if (training) {
    if (/\b(queue|training finish|training complete)\b/.test(q) && !/\btrain .+ (?:to|level)\b/.test(q)) {
      if (!Array.isArray(snapshot.queue)) return `Training queue is not downloaded for ${character.name}.`;
      if (!snapshot.queue.length) return `${character.name}'s downloaded training queue is empty.\n${freshness(character)}`;
      const finish = snapshot.queue.map((entry: any) => Date.parse(entry.finish_date)).filter(Number.isFinite).sort((a: number, b: number) => b - a)[0];
      if (!finish) return `The downloaded queue has no scheduled finish time.\n${freshness(character)}`;
      return finish > now ? `${character.name}'s downloaded queue is scheduled to finish in **${duration((finish - now) / 1000)}**, at ${new Date(finish).toISOString()}.\n${freshness(character)} The schedule may have changed since sync.`
        : `The saved queue's finish date has passed (${new Date(finish).toISOString()}). Sync to confirm completion.\n${freshness(character)}`;
    }
    const skills = Array.isArray(snapshot.skills?.skills) ? snapshot.skills.skills : [];
    let matched = skills.filter((skill: any) => skill.name && mentionsName(message, skill.name));
    if (!matched.length && /\b(this|that|it)\b/.test(q)) {
      const previous = history.at(-1)?.content ?? "";
      matched = skills.filter((skill: any) => skill.name && mentionsName(previous, skill.name));
    }
    if (matched.length !== 1) return undefined;
    const skill = matched[0];
    const levelToken = q.match(/\b(?:to|level|lvl)\s+(?:level\s+)?(iv|iii|ii|v|i|[1-5])\b/i)?.[1]
      ?? q.match(new RegExp(skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+(iv|iii|ii|v|i|[1-5])\\b", "i"))?.[1];
    const level = levelToken ? Number(levelToken) || ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5 } as Record<string, number>)[levelToken.toLowerCase()] : undefined;
    if (!level) return `What level of **${skill.name}** should I calculate for ${character.name}?`;
    if (Number(skill.trained_skill_level) >= level) return `${character.name} already has **${skill.name} ${level}** trained in the local snapshot.\n${freshness(character)}`;
    const queued = snapshot.queue?.find((entry: any) => entry.skill_id === skill.skill_id && entry.finished_level === level);
    const finish = Date.parse(queued?.finish_date);
    if (Number.isFinite(finish) && finish > now) return `**${skill.name} ${level}** is scheduled to finish in **${duration((finish - now) / 1000)}** for ${character.name}, at ${new Date(finish).toISOString()}.\n${freshness(character)} This uses the saved queue schedule.`;
    const computed = snapshot.attributes && skill.rank && Number.isFinite(skill.skillpoints_in_skill)
      ? estimateTrainingSeconds(skill, snapshot.attributes, skill.skillpoints_in_skill, level, "omega") : null;
    const seconds = computed ?? skill.timeToLevels?.find((entry: any) => entry.level === level)?.seconds;
    if (!Number.isFinite(seconds) || seconds < 0) return `Sage does not have enough local training-rate data for **${skill.name} ${level}**. Sync that character's skills and attributes.`;
    return `**${skill.name} ${level}**: approximately **${duration(seconds)}** for ${character.name} at Omega training speed, from the saved skill points and attributes.\n${freshness(character)} This excludes waiting behind other queued skills and assumes no remap, implant or training-rate change. Alpha eligibility is not checked.`;
  }
  return undefined;
}
