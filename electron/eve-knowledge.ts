import path from "node:path";
import { promises as fs } from "node:fs";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { USER_DATA_ROOT } from "./data-paths";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const EVE_KNOWLEDGE_ROOT = path.join(USER_DATA_ROOT, "eve-knowledge");
const UNIWIKI_PATH = path.join(EVE_KNOWLEDGE_ROOT, "uniwiki.json.gz");
const CURATED_PATH = path.join(EVE_KNOWLEDGE_ROOT, "curated-pages.json.gz");
const MANIFEST_PATH = path.join(EVE_KNOWLEDGE_ROOT, "manifest.json");

export type KnowledgeArticle = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  text: string;
  fetchedAt: string;
  revisedAt?: string | null;
  license?: string | null;
  tags?: string[];
};

export const EVE_KNOWLEDGE_SOURCES = [
  {
    id: "uniwiki",
    name: "EVE University UniWiki",
    homepage: "https://wiki.eveuniversity.org/Main_Page",
    role: "Broad mechanics and gameplay reference",
    authority: "community-reference",
    offline: "full-corpus",
    license: "CC BY-SA",
    verifyOnline: true,
  },
  {
    id: "ccp-support",
    name: "EVE Online Support",
    homepage: "https://support.eveonline.com/",
    role: "Authoritative current game mechanics and account/support rules",
    authority: "official",
    offline: "curated-cache",
    verifyOnline: true,
  },
  {
    id: "ccp-news",
    name: "EVE Online News / Patch Notes",
    homepage: "https://www.eveonline.com/news",
    role: "Current releases, balance changes, patch notes and dev blogs",
    authority: "official",
    offline: "curated-cache",
    verifyOnline: true,
  },
  {
    id: "brave-dojo",
    name: "Brave Dojo",
    homepage: "https://wiki.bravecollective.com/public/dojo/wiki/start",
    role: "Practical PvP, fleet, ratting, mining, hauling and new-player strategy",
    authority: "community-strategy",
    offline: "curated-cache",
    verifyOnline: true,
  },
  {
    id: "eve-workbench",
    name: "EVE Workbench",
    homepage: "https://www.eveworkbench.com/",
    role: "Community fittings and fitting discovery",
    authority: "community-fitting",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "zkillboard",
    name: "zKillboard",
    homepage: "https://zkillboard.com/",
    role: "Current PvP losses, kills and real-world fit/meta evidence",
    authority: "live-pvp-evidence",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "pyfa",
    name: "Pyfa",
    homepage: "https://github.com/pyfa-org/Pyfa",
    role: "Independent fitting reference and simulation cross-check",
    authority: "fitting-tool",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "dotlan",
    name: "DOTLAN EVEMaps",
    homepage: "https://evemaps.dotlan.net/",
    role: "Map, sovereignty and route context",
    authority: "community-reference",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "anoikis",
    name: "Anoik.is",
    homepage: "https://anoik.is/",
    role: "Wormhole system and static reference",
    authority: "specialist-reference",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "abyss-tracker",
    name: "Abyss Tracker",
    homepage: "https://abysstracker.com/",
    role: "Abyssal fits, runs and practical PvE evidence",
    authority: "specialist-strategy",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "adam4eve",
    name: "Adam4EVE",
    homepage: "https://www.adam4eve.eu/",
    role: "Industry and market analysis",
    authority: "specialist-market",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "eve-ref",
    name: "EVE Ref",
    homepage: "https://everef.net/",
    role: "Static item, type, blueprint and reference-data lookup",
    authority: "specialist-reference",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "fuzzwork",
    name: "Fuzzwork Enterprises",
    homepage: "https://www.fuzzwork.co.uk/",
    role: "Industry calculations, blueprint and market utilities",
    authority: "specialist-industry",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "janice",
    name: "Janice",
    homepage: "https://janice.e-351.com/",
    role: "Item appraisal and market-value cross-checking",
    authority: "specialist-market",
    offline: "directory-only",
    verifyOnline: true,
  },
  {
    id: "eve-tycoon",
    name: "EVE Tycoon",
    homepage: "https://evetycoon.com/",
    role: "Market and trading analysis",
    authority: "specialist-market",
    offline: "directory-only",
    verifyOnline: true,
  },
] as const;

export const CURATED_CACHE_URLS = [
  { sourceId: "ccp-support", url: "https://support.eveonline.com/hc/en-us/articles/213021829-Upwell-Structures", tags: ["structures","upwell"] },
  { sourceId: "ccp-support", url: "https://support.eveonline.com/hc/en-us/articles/208289605-Structure-Management", tags: ["structures","management"] },
  { sourceId: "ccp-support", url: "https://support.eveonline.com/hc/en-us/articles/208289385-Upwell-Structures-Vulnerability-States", tags: ["structures","warfare"] },
  { sourceId: "ccp-support", url: "https://support.eveonline.com/hc/en-us/articles/209985225-Upwell-Structures-Quick-Facts", tags: ["structures","upwell"] },
  { sourceId: "brave-dojo", url: "https://wiki.bravecollective.com/public/dojo/wiki/start", tags: ["strategy","index"] },
  { sourceId: "brave-dojo", url: "https://wiki.bravecollective.com/public/dojo/wiki/newbie", tags: ["new-player","strategy"] },
  { sourceId: "brave-dojo", url: "https://wiki.bravecollective.com/public/dojo/wiki/tackling", tags: ["pvp","tackle"] },
  { sourceId: "brave-dojo", url: "https://wiki.bravecollective.com/public/dojo/wiki/interdictors", tags: ["pvp","interdictor"] },
  { sourceId: "brave-dojo", url: "https://wiki.bravecollective.com/public/dojo/wiki/logistics", tags: ["pvp","logistics"] },
] as const;

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_m,n)=>String.fromCharCode(Number(n)));
}

export function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/[ \t]+/g," ")
    .replace(/\n\s+/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim());
}

export async function readKnowledgeArticles(): Promise<KnowledgeArticle[]> {
  const out: KnowledgeArticle[] = [];
  for (const file of [UNIWIKI_PATH, CURATED_PATH]) {
    try {
      const parsed = JSON.parse((await gunzipAsync(await fs.readFile(file))).toString("utf8"));
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch { /* not installed yet */ }
  }
  return out;
}

function scoreArticle(article: KnowledgeArticle, query: string) {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((x)=>x.length>1);
  const title = article.title.toLowerCase();
  const text = article.text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 12;
    const first = text.indexOf(term);
    if (first >= 0) score += first < 1500 ? 4 : 1;
  }
  return score;
}

export async function searchEveKnowledge(query: string, limit = 8) {
  const articles = await readKnowledgeArticles();
  return articles
    .map((article)=>({ article, score: scoreArticle(article, query) }))
    .filter((entry)=>entry.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0, Math.max(1, Math.min(25, limit)))
    .map(({article,score})=>({
      id: article.id,
      sourceId: article.sourceId,
      title: article.title,
      url: article.url,
      fetchedAt: article.fetchedAt,
      revisedAt: article.revisedAt,
      license: article.license,
      tags: article.tags,
      score,
      excerpt: article.text.slice(0, 3000),
    }));
}

export async function getEveKnowledgeArticle(id: string) {
  return (await readKnowledgeArticles()).find((article)=>article.id===id) ?? null;
}

export async function knowledgeStatus() {
  let manifest: any = null;
  try { manifest = JSON.parse(await fs.readFile(MANIFEST_PATH,"utf8")); } catch {}
  const articles = await readKnowledgeArticles();
  return {
    installed: articles.length>0,
    articleCount: articles.length,
    manifest,
    sources: EVE_KNOWLEDGE_SOURCES,
  };
}

async function writeGzipJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await gzipAsync(Buffer.from(JSON.stringify(value),"utf8"), { level: 9 }));
}

export async function writeKnowledgePack(input: { uniwiki?: KnowledgeArticle[]; curated?: KnowledgeArticle[]; manifest?: unknown }) {
  await fs.mkdir(EVE_KNOWLEDGE_ROOT, { recursive: true });
  if (input.uniwiki) await writeGzipJson(UNIWIKI_PATH, input.uniwiki);
  if (input.curated) await writeGzipJson(CURATED_PATH, input.curated);
  if (input.manifest) await fs.writeFile(MANIFEST_PATH, JSON.stringify(input.manifest,null,2),"utf8");
}
