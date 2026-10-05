import { CURATED_CACHE_URLS, EVE_KNOWLEDGE_SOURCES, htmlToText, knowledgeStatus, writeKnowledgePack, type KnowledgeArticle } from "./eve-knowledge";

const UNIWIKI_API = "https://wiki.eveuniversity.org/api.php";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Progress = (message: string, completed?: number, total?: number) => void;

async function fetchJson(url: URL) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "NewEdenSage/1.0 (offline knowledge updater)",
      "Accept": "application/json",
    },
  });
  if (!response.ok) throw new Error(`Knowledge source request failed (${response.status}) for ${url.hostname}.`);
  return response.json() as Promise<any>;
}

async function fetchUniWiki(progress?: Progress) {
  const pageRefs: Array<{ pageid: number; title: string }> = [];
  let apcontinue = "";

  do {
    const url = new URL(UNIWIKI_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("list", "allpages");
    url.searchParams.set("apnamespace", "0");
    url.searchParams.set("aplimit", "max");
    if (apcontinue) url.searchParams.set("apcontinue", apcontinue);

    const payload = await fetchJson(url);
    const pages = Array.isArray(payload?.query?.allpages) ? payload.query.allpages : [];
    for (const page of pages) {
      const pageid = Number(page?.pageid || 0);
      const title = String(page?.title || "").trim();
      if (pageid > 0 && title) pageRefs.push({ pageid, title });
    }
    apcontinue = String(payload?.continue?.apcontinue || "");
    progress?.(`Indexing EVE University Wiki… ${pageRefs.length.toLocaleString()} article titles`, pageRefs.length);
  } while (apcontinue);

  const articles: KnowledgeArticle[] = [];
  const batchSize = 40;
  for (let offset = 0; offset < pageRefs.length; offset += batchSize) {
    const batch = pageRefs.slice(offset, offset + batchSize);
    const url = new URL(UNIWIKI_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("pageids", batch.map((page) => String(page.pageid)).join("|"));
    url.searchParams.set("prop", "info|revisions");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("rvprop", "timestamp|content");
    url.searchParams.set("rvslots", "main");

    const payload = await fetchJson(url);
    const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
    const fetchedAt = new Date().toISOString();

    for (const page of pages) {
      const title = String(page?.title || "").trim();
      const text = String(page?.revisions?.[0]?.slots?.main?.content || "").trim();
      if (!title || !text) continue;
      articles.push({
        id: `uniwiki:${String(page.pageid || title)}`,
        sourceId: "uniwiki",
        title,
        url: String(page?.fullurl || `https://wiki.eveuniversity.org/${encodeURIComponent(title.replace(/ /g, "_"))}`),
        text,
        fetchedAt,
        revisedAt: String(page?.revisions?.[0]?.timestamp || "") || null,
        license: "CC BY-SA",
        tags: ["eve", "uniwiki"],
      });
    }

    progress?.(
      `Caching EVE University Wiki… ${articles.length.toLocaleString()}/${pageRefs.length.toLocaleString()} articles`,
      Math.min(offset + batch.length, pageRefs.length),
      pageRefs.length,
    );
  }

  return { articles, batches: Math.ceil(pageRefs.length / batchSize) };
}

async function fetchCuratedPage(sourceId: string, rawUrl: string, tags: readonly string[]): Promise<KnowledgeArticle | null> {
  const response = await fetch(rawUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NewEdenSage/1.0; offline knowledge cache)",
      "Accept": "text/html,text/plain,application/xhtml+xml",
    },
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const text = /html|xhtml/i.test(contentType) ? htmlToText(raw) : raw.trim();
  if (!text) return null;
  const title = /html|xhtml/i.test(contentType)
    ? htmlToText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || rawUrl)
    : rawUrl;

  return {
    id: `curated:${sourceId}:${encodeURIComponent(rawUrl)}`,
    sourceId,
    title: title.slice(0, 300),
    url: response.url || rawUrl,
    text: text.slice(0, 400_000),
    fetchedAt: new Date().toISOString(),
    revisedAt: response.headers.get("last-modified"),
    license: null,
    tags: [...tags],
  };
}

async function fetchBraveDojoCorpus(progress?: Progress) {
  const indexUrl = "https://wiki.bravecollective.com/public/dojo/wiki/start";
  const response = await fetch(indexUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NewEdenSage/1.0; offline knowledge cache)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) return [] as KnowledgeArticle[];

  const html = await response.text();
  const urls = new Set<string>([indexUrl]);
  const hrefPattern = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html))) {
    try {
      const url = new URL(match[1], indexUrl);
      if (url.hostname !== "wiki.bravecollective.com") continue;
      if (!url.pathname.startsWith("/public/dojo/wiki/")) continue;
      url.search = "";
      url.hash = "";
      urls.add(url.href);
      if (urls.size >= 180) break;
    } catch { /* ignore malformed links */ }
  }

  const articles: KnowledgeArticle[] = [];
  const queue = [...urls];
  for (let index = 0; index < queue.length; index += 1) {
    progress?.(`Caching Brave Dojo strategy guides… ${index + 1}/${queue.length}`, index + 1, queue.length);
    try {
      const article = await fetchCuratedPage("brave-dojo", queue[index], ["strategy", "brave-dojo"]);
      if (article) articles.push(article);
    } catch {
      // Continue through individual stale/moved guide links.
    }
  }
  return articles;
}

async function fetchCurated(progress?: Progress) {
  const articles: KnowledgeArticle[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < CURATED_CACHE_URLS.length; index += 1) {
    const entry = CURATED_CACHE_URLS[index];
    progress?.(`Refreshing curated EVE knowledge… ${index + 1}/${CURATED_CACHE_URLS.length}`, index + 1, CURATED_CACHE_URLS.length);
    try {
      const article = await fetchCuratedPage(entry.sourceId, entry.url, entry.tags);
      if (article && !seen.has(article.url)) {
        seen.add(article.url);
        articles.push(article);
      }
    } catch {
      // One community site being unavailable must not break the whole knowledge update.
    }
  }

  const brave = await fetchBraveDojoCorpus(progress);
  for (const article of brave) {
    if (seen.has(article.url)) continue;
    seen.add(article.url);
    articles.push(article);
  }

  return articles;
}

export async function ensureCurrentEveKnowledge(progress?: Progress, force = false) {
  const current = await knowledgeStatus();
  const refreshedAt = Date.parse(String(current?.manifest?.refreshedAt || ""));
  if (!force && current.installed && Number.isFinite(refreshedAt) && Date.now() - refreshedAt < MAX_AGE_MS) {
    progress?.(`EVE knowledge current — ${current.articleCount.toLocaleString()} cached articles.`, current.articleCount, current.articleCount);
    return { changed: false, articleCount: current.articleCount, refreshedAt: current.manifest?.refreshedAt };
  }

  progress?.("Building Sage offline EVE knowledge pack…");
  const uniwiki = await fetchUniWiki(progress);
  const curated = await fetchCurated(progress);
  const refreshedAtIso = new Date().toISOString();

  await writeKnowledgePack({
    uniwiki: uniwiki.articles,
    curated,
    manifest: {
      schemaVersion: 1,
      refreshedAt: refreshedAtIso,
      fullCorpus: {
        sourceId: "uniwiki",
        articleCount: uniwiki.articles.length,
        license: "CC BY-SA",
        attribution: "EVE University UniWiki",
        source: "https://wiki.eveuniversity.org/",
      },
      curatedArticleCount: curated.length,
      sourceDirectory: EVE_KNOWLEDGE_SOURCES,
      verificationPolicy: "Offline knowledge is advisory. Current actionable advice must be checked against live authoritative/current sources before recommendation.",
    },
  });

  progress?.(`EVE knowledge ready — ${(uniwiki.articles.length + curated.length).toLocaleString()} cached articles.`, uniwiki.articles.length + curated.length, uniwiki.articles.length + curated.length);
  return {
    changed: true,
    articleCount: uniwiki.articles.length + curated.length,
    uniwikiArticles: uniwiki.articles.length,
    curatedArticles: curated.length,
    refreshedAt: refreshedAtIso,
  };
}
