export type FitterFactionId =
  | "gallente" | "caldari" | "amarr" | "minmatar" | "ore"
  | "guristas" | "serpentis" | "angel-cartel" | "blood-raiders" | "sansha"
  | "sisters-of-eve" | "mordus-legion" | "triglavian" | "edencom"
  | "interbus" | "concord" | "syndicate" | "society-of-conscious-thought" | "deathless-circle" | "jovian" | "pirate" | "new-eden";

export type FitterFactionPresentation = {
  id: FitterFactionId;
  name: string;
  eyebrow: string;
  flavour: string[];
  sigil: string;
  artKey: string;
  className: string;
};

const FACTIONS: Record<FitterFactionId, FitterFactionPresentation> = {
  gallente: { id:"gallente", name:"Gallente", eyebrow:"FEDERATION", flavour:["LIBERTY","INNOVATION","PROGRESS"], sigil:"G", artKey:"faction-gallente", className:"faction-gallente" },
  caldari: { id:"caldari", name:"Caldari", eyebrow:"STATE", flavour:["DUTY","PRECISION","INDUSTRY"], sigil:"C", artKey:"faction-caldari", className:"faction-caldari" },
  amarr: { id:"amarr", name:"Amarr", eyebrow:"EMPIRE", flavour:["FAITH","ORDER","DOMINION"], sigil:"A", artKey:"faction-amarr", className:"faction-amarr" },
  minmatar: { id:"minmatar", name:"Minmatar", eyebrow:"REPUBLIC", flavour:["TRIBES","FREEDOM","RESILIENCE"], sigil:"M", artKey:"faction-minmatar", className:"faction-minmatar" },
  ore: { id:"ore", name:"ORE", eyebrow:"INDUSTRIAL", flavour:["EXTRACTION","LOGISTICS","YIELD"], sigil:"O", artKey:"faction-ore", className:"faction-ore" },
  guristas: { id:"guristas", name:"Guristas", eyebrow:"PIRATE", flavour:["RAIDERS","PROFIT","DEFIANCE"], sigil:"G", artKey:"faction-guristas", className:"faction-guristas" },
  serpentis: { id:"serpentis", name:"Serpentis", eyebrow:"CORPORATION", flavour:["SYNTHESIS","WEALTH","CONTROL"], sigil:"S", artKey:"faction-serpentis", className:"faction-serpentis" },
  "angel-cartel": { id:"angel-cartel", name:"Angel Cartel", eyebrow:"CARTEL", flavour:["VELOCITY","FIREPOWER","DOMINANCE"], sigil:"AC", artKey:"faction-angel-cartel", className:"faction-angel-cartel" },
  "blood-raiders": { id:"blood-raiders", name:"Blood Raiders", eyebrow:"COVENANT", flavour:["RITUAL","ENERGY","ASCENDANCY"], sigil:"BR", artKey:"faction-blood-raiders", className:"faction-blood-raiders" },
  sansha: { id:"sansha", name:"Sansha's Nation", eyebrow:"NATION", flavour:["UNITY","CONTROL","PERFECTION"], sigil:"SN", artKey:"faction-sansha", className:"faction-sansha" },
  "sisters-of-eve": { id:"sisters-of-eve", name:"Sisters of EVE", eyebrow:"SERVANT SISTERS", flavour:["RESCUE","SCIENCE","EXPLORATION"], sigil:"SOE", artKey:"faction-sisters-of-eve", className:"faction-sisters-of-eve" },
  "mordus-legion": { id:"mordus-legion", name:"Mordu's Legion", eyebrow:"LEGION", flavour:["DISCIPLINE","MISSILES","MOBILITY"], sigil:"ML", artKey:"faction-mordus-legion", className:"faction-mordus-legion" },
  triglavian: { id:"triglavian", name:"Triglavian", eyebrow:"CLADES", flavour:["PROVING","ADAPTATION","CONVERGENCE"], sigil:"T", artKey:"faction-triglavian", className:"faction-triglavian" },
  edencom: { id:"edencom", name:"EDENCOM", eyebrow:"DEFENSE INITIATIVE", flavour:["VIGILANCE","COORDINATION","RESPONSE"], sigil:"E", artKey:"faction-edencom", className:"faction-edencom" },
  "society-of-conscious-thought": { id:"society-of-conscious-thought", name:"Society of Conscious Thought", eyebrow:"SOCT", flavour:["KNOWLEDGE","BALANCE","ENLIGHTENMENT"], sigil:"SCT", artKey:"faction-soct", className:"faction-soct" },
  "deathless-circle": { id:"deathless-circle", name:"Deathless Circle", eyebrow:"ZARZAK", flavour:["INSURGENCY","SECRECY","ASCENDANCY"], sigil:"DC", artKey:"faction-deathless", className:"faction-deathless" },
  jovian: { id:"jovian", name:"Jovian", eyebrow:"DIRECTORATE", flavour:["LEGACY","SCIENCE","TRANSCENDENCE"], sigil:"J", artKey:"faction-jovian", className:"faction-jovian" },
  interbus: { id:"interbus", name:"InterBus", eyebrow:"NETWORK", flavour:["TRANSIT","TRADE","CONNECTION"], sigil:"IB", artKey:"faction-interbus", className:"faction-interbus" },
  concord: { id:"concord", name:"CONCORD", eyebrow:"ASSEMBLY", flavour:["SECURITY","LAW","STABILITY"], sigil:"C", artKey:"faction-concord", className:"faction-concord" },
  syndicate: { id:"syndicate", name:"The Syndicate", eyebrow:"INTAKI SYNDICATE", flavour:["INDEPENDENCE","COMMERCE","INTRIGUE"], sigil:"SY", artKey:"faction-syndicate", className:"faction-syndicate" },
  pirate: { id:"pirate", name:"Independent", eyebrow:"PIRATE HULL", flavour:["BLACK MARKET","ADAPTATION","SURVIVAL"], sigil:"P", artKey:"faction-pirate", className:"faction-pirate" },
  "new-eden": { id:"new-eden", name:"New Eden", eyebrow:"CAPSULEER HULL", flavour:["CAPSULEER","TECHNOLOGY","DEPLOYMENT"], sigil:"NE", artKey:"faction-new-eden", className:"faction-new-eden" },
};

export const SDE_SHIP_FACTION_BY_ID: Readonly<Record<number,FitterFactionId>> = Object.freeze({
  500001:"caldari",
  500002:"minmatar",
  500003:"amarr",
  500004:"gallente",
  500005:"jovian",
  500006:"concord",
  500009:"syndicate",
  500010:"guristas",
  500011:"angel-cartel",
  500012:"blood-raiders",
  500014:"ore",
  500016:"sisters-of-eve",
  500017:"society-of-conscious-thought",
  500018:"mordus-legion",
  500019:"sansha",
  500020:"serpentis",
  500026:"triglavian",
  500027:"edencom",
  500029:"deathless-circle",
});

export type FitterFactionContext = {
  factionId?:number;
  factionName?:string;
  raceId?:number;
  raceName?:string;
  marketSegments?:string[];
  hullName?:string;
};

const FACTION_MATCHERS: Array<[RegExp, FitterFactionId]> = [
  [/sisters? of eve|servant sisters|\bsoe\b/i,"sisters-of-eve"],
  [/mordu'?s|mordu/i,"mordus-legion"],
  [/blood raid/i,"blood-raiders"],
  [/angel cartel/i,"angel-cartel"],
  [/sansha/i,"sansha"],
  [/guristas/i,"guristas"],
  [/serpentis/i,"serpentis"],
  [/triglav/i,"triglavian"],
  [/edencom/i,"edencom"],
  [/society of conscious thought|\bsoct\b/i,"society-of-conscious-thought"],
  [/deathless|zarzakh/i,"deathless-circle"],
  [/jovian|jove/i,"jovian"],
  [/interbus/i,"interbus"],
  [/concord/i,"concord"],
  [/intaki syndicate|the syndicate|\bsyndicate\b/i,"syndicate"],
  [/\bore\b|outer ring excavations/i,"ore"],
  [/gallente/i,"gallente"],
  [/caldari/i,"caldari"],
  [/amarr/i,"amarr"],
  [/minmatar/i,"minmatar"],
];

export function resolveFitterFaction(context:FitterFactionContext): FitterFactionPresentation;
export function resolveFitterFaction(marketSegments:string[], hullName?:string): FitterFactionPresentation;
export function resolveFitterFaction(contextOrSegments:FitterFactionContext|string[], legacyHullName=""): FitterFactionPresentation {
  const context:FitterFactionContext = Array.isArray(contextOrSegments)
    ? {marketSegments:contextOrSegments,hullName:legacyHullName}
    : contextOrSegments;
  const mapped = context.factionId == null ? undefined : SDE_SHIP_FACTION_BY_ID[Number(context.factionId)];
  if (mapped) return FACTIONS[mapped];
  const haystack = [context.factionName,context.raceName,...(context.marketSegments??[]),context.hullName]
    .filter((value):value is string=>Boolean(value))
    .join(" / ");
  for (const [matcher,id] of FACTION_MATCHERS) if (matcher.test(haystack)) return FACTIONS[id];
  if (/pirate|faction/i.test(haystack)) return FACTIONS.pirate;
  return FACTIONS["new-eden"];
}

export type ShipFrame = { scale:number; x:number; y:number; rotate:number };
const DEFAULT_FRAME: ShipFrame = { scale:1.18, x:0, y:0, rotate:0 };
const GROUP_FRAMES: Array<[RegExp, ShipFrame]> = [
  [/frigate|shuttle|corvette/i,{scale:1.34,x:0,y:0,rotate:0}],
  [/destroyer/i,{scale:1.22,x:0,y:0,rotate:0}],
  [/cruiser|strategic cruiser/i,{scale:1.16,x:0,y:0,rotate:0}],
  [/battlecruiser/i,{scale:1.08,x:0,y:0,rotate:0}],
  [/battleship|marauder|black ops/i,{scale:1.02,x:0,y:0,rotate:0}],
  [/industrial command|industrial ship|transport ship/i,{scale:1.02,x:0,y:0,rotate:0}],
  [/mining barge|exhumer/i,{scale:1.08,x:0,y:1,rotate:0}],
  [/freighter|jump freighter/i,{scale:.92,x:0,y:0,rotate:0}],
  [/carrier|dreadnought|force auxiliary|supercarrier|titan|capital/i,{scale:.88,x:0,y:0,rotate:0}],
];
const HULL_FRAMES: Record<string, ShipFrame> = {
  alligator:{scale:.92,x:-1,y:0,rotate:0},
  brutix:{scale:1.05,x:-1,y:1,rotate:0},
  gila:{scale:1.13,x:0,y:0,rotate:0},
  ishtar:{scale:1.12,x:0,y:0,rotate:0},
  proteus:{scale:1.10,x:0,y:0,rotate:0},
  hulk:{scale:1.08,x:1,y:0,rotate:0},
  impel:{scale:.98,x:0,y:0,rotate:0},
  "iteron mark v":{scale:.88,x:-1,y:0,rotate:0},
  bowhead:{scale:.82,x:0,y:0,rotate:0},
  providence:{scale:.78,x:0,y:0,rotate:0},
  obelisk:{scale:.80,x:0,y:0,rotate:0},
  charon:{scale:.80,x:0,y:0,rotate:0},
  fenrir:{scale:.82,x:0,y:0,rotate:0},
};
export function resolveShipFrame(hullName:string, groupName:string): ShipFrame {
  const exact = HULL_FRAMES[hullName.trim().toLowerCase()];
  if (exact) return exact;
  for (const [matcher,frame] of GROUP_FRAMES) if (matcher.test(groupName)) return frame;
  return DEFAULT_FRAME;
}

export type FitterHeroTargeting = {
  hullNames?: string[];
  hullTypeIds?: number[];
  factionIds?: FitterFactionId[];
  groupNames?: string[];
};
export type FitterHeroRule = {
  id: string;
  enabled: boolean;
  kind: "hero" | "promotion";
  artwork: string;
  priority?: number;
  headline?: string;
  supportingText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaAction?: string;
  campaignStart?: string;
  campaignEnd?: string;
  targeting?: FitterHeroTargeting;
};
export type FitterHeroContext = { hullName:string; hullTypeId?:number; factionId:FitterFactionId; groupName:string; now?:Date };

const defaultHero: FitterHeroRule = { id:"default-hangar", enabled:true, kind:"hero", artwork:"./fitter-assets/fitter-hero-hangar-generated.webp", priority:0 };

// Content lives here instead of in React so it can be replaced by a future remote/admin content source without changing the fitter component.
// Rules support hull -> faction -> group -> global fallbacks and scheduled/targeted promotions.
export const FITTER_HERO_CONTENT: FitterHeroRule[] = [
  defaultHero,
];

function targetSpecificity(targeting:FitterHeroTargeting|undefined, context:FitterHeroContext) {
  if (!targeting) return 0;
  if (targeting.hullTypeIds?.includes(context.hullTypeId ?? -1) || targeting.hullNames?.some(name=>name.toLowerCase()===context.hullName.toLowerCase())) return 400;
  if (targeting.factionIds?.includes(context.factionId)) return 300;
  if (targeting.groupNames?.some(name=>name.toLowerCase()===context.groupName.toLowerCase())) return 200;
  return Object.keys(targeting).length ? -1 : 0;
}
function campaignActive(rule:FitterHeroRule, now:Date) {
  const start = rule.campaignStart ? new Date(rule.campaignStart) : null;
  const end = rule.campaignEnd ? new Date(rule.campaignEnd) : null;
  return (!start || Number.isNaN(start.valueOf()) || now >= start) && (!end || Number.isNaN(end.valueOf()) || now <= end);
}
function matchesTargeting(targeting:FitterHeroTargeting|undefined, context:FitterHeroContext) {
  if (!targeting) return true;
  if (targeting.hullTypeIds?.length && !targeting.hullTypeIds.includes(context.hullTypeId ?? -1)) return false;
  if (targeting.hullNames?.length && !targeting.hullNames.some(name=>name.toLowerCase()===context.hullName.toLowerCase())) return false;
  if (targeting.factionIds?.length && !targeting.factionIds.includes(context.factionId)) return false;
  if (targeting.groupNames?.length && !targeting.groupNames.some(name=>name.toLowerCase()===context.groupName.toLowerCase())) return false;
  return true;
}

const assetModules = import.meta.glob("./fitter-assets/**/*", { eager:true, query:"?url", import:"default" }) as Record<string,string>;
export function resolveFitterArtwork(artwork:string) {
  if (/^(?:https?:|data:|blob:|file:|sage-asset:)/i.test(artwork)) return artwork;
  const bundled = assetModules[artwork] ?? assetModules[artwork.replace(/^\.\//,"./")];
  if (bundled) return bundled;
  const relative = artwork.replace(/\\/g,"/").replace(/^\.\//,"").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return relative ? "sage-asset://fitter-content/" + relative : artwork;
}
export function resolveFactionArtwork(faction:FitterFactionPresentation) {
  return resolveFitterArtwork(`./fitter-assets/factions/${faction.id}.webp`);
}

export function resolveFitterHero(context:FitterHeroContext, rules:FitterHeroRule[] = FITTER_HERO_CONTENT): FitterHeroRule & { resolvedArtwork:string } {
  const now = context.now ?? new Date();
  const candidates = rules
    .filter(rule=>rule.enabled && campaignActive(rule,now) && matchesTargeting(rule.targeting,context))
    .map(rule=>({rule,specificity:targetSpecificity(rule.targeting,context)}))
    .filter(item=>item.specificity>=0);
  const promotions = candidates.filter(item=>item.rule.kind==="promotion").sort((a,b)=>(b.rule.priority??0)-(a.rule.priority??0) || b.specificity-a.specificity);
  const heroes = candidates.filter(item=>item.rule.kind==="hero").sort((a,b)=>b.specificity-a.specificity || (b.rule.priority??0)-(a.rule.priority??0));
  const rule = promotions[0]?.rule ?? heroes[0]?.rule ?? defaultHero;
  return { ...rule, resolvedArtwork: resolveFitterArtwork(rule.artwork) };
}

export function coerceFitterHeroRules(value: unknown): FitterHeroRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw,index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const kind = item.kind === "promotion" ? "promotion" : item.kind === "hero" ? "hero" : null;
    const artwork = typeof item.artwork === "string" ? item.artwork.trim() : "";
    if (!kind || !artwork) return [];
    const strings = (input:unknown) => Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : undefined;
    const numbers = (input:unknown) => Array.isArray(input) ? input.map(Number).filter((entry) => Number.isFinite(entry)) : undefined;
    const targetingRaw = item.targeting && typeof item.targeting === "object" ? item.targeting as Record<string,unknown> : undefined;
    const targeting = targetingRaw ? {
      hullNames: strings(targetingRaw.hullNames),
      hullTypeIds: numbers(targetingRaw.hullTypeIds),
      factionIds: strings(targetingRaw.factionIds) as FitterFactionId[] | undefined,
      groupNames: strings(targetingRaw.groupNames),
    } : undefined;
    return [{
      id: typeof item.id === "string" && item.id.trim() ? item.id : `external-${index}`,
      enabled: item.enabled !== false,
      kind, artwork,
      priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
      headline: typeof item.headline === "string" ? item.headline : undefined,
      supportingText: typeof item.supportingText === "string" ? item.supportingText : undefined,
      ctaLabel: typeof item.ctaLabel === "string" ? item.ctaLabel : undefined,
      ctaUrl: typeof item.ctaUrl === "string" ? item.ctaUrl : undefined,
      ctaAction: typeof item.ctaAction === "string" ? item.ctaAction : undefined,
      campaignStart: typeof item.campaignStart === "string" ? item.campaignStart : undefined,
      campaignEnd: typeof item.campaignEnd === "string" ? item.campaignEnd : undefined,
      targeting,
    } satisfies FitterHeroRule];
  });
}
