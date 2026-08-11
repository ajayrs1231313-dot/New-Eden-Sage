export type EveNewsCategory = "ccp" | "market" | "war" | "events";

export interface EveNewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
  category: EveNewsCategory;
}

let cachedAt = 0;
let cachedItems: EveNewsItem[] = [];
const CACHE_MS = 15 * 60 * 1000;

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function categoryFor(title: string, summary: string): EveNewsCategory {
  const headline = title.toLowerCase();
  const intro = summary.slice(0, 700).toLowerCase();
  const text = `${headline} ${intro}`;
  if (/monthly economic report|plex|market|econom|mineral|industry|trade|price|sale|store|omega|bundle/.test(headline)) return "market";
  if (/war|battle|sovereignty|nullsec|invasion|frontline|faction warfare|conflict|military campaign/.test(headline)) return "war";
  if (/event|harvest|proving|fanfest|celebration|login|capsuleer day|winter nexus|operation avalon/.test(headline)) return "events";
  if (/major battle|sovereignty|frontline|warzone|military campaign/.test(text)) return "war";
  if (/limited-time event|seasonal event|event begins|event returns/.test(text)) return "events";
  return "ccp";
}

export async function getEveNews(force = false): Promise<EveNewsItem[]> {
  if (!force && cachedItems.length && Date.now() - cachedAt < CACHE_MS) return cachedItems;
  const response = await fetch("https://www.eveonline.com/rss", {
    headers: { "User-Agent": "NewEdenSage/0.1.1" },
  });
  if (!response.ok) throw new Error(`EVE news feed failed (${response.status}).`);
  const xml = await response.text();
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  cachedItems = blocks.slice(0, 40).map((block, index) => {
    const title = tag(block, "title") || "EVE Online update";
    const link = tag(block, "link");
    const summary = tag(block, "description");
    const publishedAt = tag(block, "pubDate");
    return {
      id: link || `${publishedAt}-${index}`,
      title,
      link,
      summary,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
      category: categoryFor(title, summary),
    };
  });
  cachedAt = Date.now();
  return cachedItems;
}
