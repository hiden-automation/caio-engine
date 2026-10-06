import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { log, logError, type Signal } from "@jarvis/core";
import type { TrendsConfig } from "./config.ts";

export type Collector = (now: Date) => Promise<Signal[]>;

const UA = "jarvis-trends/0.1 (+https://github.com)";

function sid(collector: string, key: string): string {
  return `${collector}:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function hoursSince(iso: string | number | undefined, now: Date): number {
  if (iso === undefined) return 24;
  const t = typeof iso === "number" ? iso * 1000 : new Date(iso).getTime();
  return Math.max(0.5, (now.getTime() - t) / 3_600_000);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- parsers puros (testáveis com fixtures) -------------------------------

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
}

export function parseHackerNews(json: { hits: HnHit[] }, now: Date): Signal[] {
  return json.hits
    .filter((h) => h.title)
    .map((h) => ({
      id: sid("hn", h.objectID),
      collector: "hackernews",
      title: h.title!,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      observedAt: now.toISOString(),
      value: h.points ?? 0,
      velocity: (h.points ?? 0) / hoursSince(h.created_at_i, now),
      tags: ["tech"],
    }));
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(x: T | T[] | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
}

/** "200+", "10 mil+", "2K+" → número aproximado de buscas. */
export function parseApproxTraffic(s: string | number | undefined): number {
  if (s === undefined) return 0;
  const str = String(s).toLowerCase().replace(/\s|\+/g, "");
  const n = parseFloat(str.replace(",", "."));
  if (Number.isNaN(n)) return 0;
  if (/mil|k/.test(str)) return n * 1000;
  if (/mi|m$/.test(str)) return n * 1_000_000;
  return n;
}

export function parseGoogleTrendsRss(text: string, now: Date): Signal[] {
  const doc = xml.parse(text);
  return asArray(doc?.rss?.channel?.item).map((it: Record<string, unknown>) => {
    const traffic = parseApproxTraffic(it["ht:approx_traffic"] as string);
    const title = String(it.title);
    return {
      id: sid("gtrends", title.toLowerCase()),
      collector: "google_trends",
      title,
      url: typeof it.link === "string" ? it.link : undefined,
      observedAt: now.toISOString(),
      value: traffic,
      velocity: traffic / hoursSince(it.pubDate as string, now),
      tags: ["busca"],
    };
  });
}

export function parseRss(text: string, feed: { name: string; tags: string[] }, now: Date): Signal[] {
  const doc = xml.parse(text);
  const items = asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry);
  return items.slice(0, 20).map((it: Record<string, unknown>) => {
    const title = String((it.title as { "#text"?: string })?.["#text"] ?? it.title);
    const link = typeof it.link === "string" ? it.link : ((it.link as { "@_href"?: string })?.["@_href"] ?? undefined);
    const published = (it.pubDate ?? it.published ?? it.updated) as string | undefined;
    const age = hoursSince(published, now);
    return {
      id: sid(`rss`, link ?? title),
      collector: `rss:${feed.name}`,
      title,
      url: link,
      observedAt: now.toISOString(),
      value: 1,
      // Notícia não tem métrica de engajamento: frescor vira a "velocidade".
      velocity: 1 / age,
      tags: feed.tags,
    };
  });
}

interface YtVideo {
  id: string;
  snippet: { title: string; channelTitle: string; publishedAt: string };
  statistics: { viewCount?: string };
}

export function parseYoutubeVideos(json: { items: YtVideo[] }, collector: string, now: Date): Signal[] {
  return json.items.map((v) => {
    const views = Number(v.statistics.viewCount ?? 0);
    return {
      id: sid("yt", v.id),
      collector,
      platform: "youtube" as const,
      title: v.snippet.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      observedAt: now.toISOString(),
      value: views,
      velocity: views / hoursSince(v.snippet.publishedAt, now),
      tags: ["video"],
      summary: `Canal: ${v.snippet.channelTitle}`,
    };
  });
}

// ---- coletores ---------------------------------------------------------------

export function buildCollectors(cfg: TrendsConfig, env: NodeJS.ProcessEnv = process.env): Record<string, Collector> {
  const c: Record<string, Collector> = {};

  if (cfg.hackerNews) {
    c.hackernews = async (now) =>
      parseHackerNews((await getJson("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30")) as { hits: HnHit[] }, now);
  }

  c.google_trends = async (now) =>
    parseGoogleTrendsRss(await getText(`https://trends.google.com/trending/rss?geo=${cfg.googleTrendsGeo}`), now);

  for (const feed of cfg.rss) {
    c[`rss:${feed.name}`] = async (now) => parseRss(await getText(feed.url), feed, now);
  }

  for (const sub of cfg.reddit) {
    c[`reddit:${sub}`] = async (now) => {
      const json = (await getJson(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=15`)) as {
        data: { children: { data: { id: string; title: string; ups: number; permalink: string; created_utc: number } }[] };
      };
      return json.data.children.map(({ data: d }) => ({
        id: sid("reddit", d.id),
        collector: `reddit:${sub}`,
        title: d.title,
        url: `https://www.reddit.com${d.permalink}`,
        observedAt: now.toISOString(),
        value: d.ups,
        velocity: d.ups / hoursSince(d.created_utc, now),
        tags: ["comunidade"],
      }));
    };
  }

  if (cfg.githubTrending) {
    c.github = async (now) => {
      const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const json = (await getJson(
        `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=15`,
        env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {},
      )) as { items: { id: number; full_name: string; description: string | null; html_url: string; stargazers_count: number; created_at: string }[] };
      return json.items.map((r) => ({
        id: sid("gh", String(r.id)),
        collector: "github",
        title: `${r.full_name}${r.description ? ` — ${r.description}` : ""}`,
        url: r.html_url,
        observedAt: now.toISOString(),
        value: r.stargazers_count,
        velocity: r.stargazers_count / hoursSince(r.created_at, now),
        tags: ["tech", "opensource"],
      }));
    };
  }

  if (cfg.huggingFace) {
    c.huggingface = async (now) => {
      const json = (await getJson("https://huggingface.co/api/models?sort=trendingScore&limit=15")) as {
        id: string;
        likes?: number;
        trendingScore?: number;
      }[];
      return json.map((m) => ({
        id: sid("hf", m.id),
        collector: "huggingface",
        title: `Modelo em alta no Hugging Face: ${m.id}`,
        url: `https://huggingface.co/${m.id}`,
        observedAt: now.toISOString(),
        value: m.likes ?? 0,
        velocity: m.trendingScore ?? 0,
        tags: ["ia"],
      }));
    };
  }

  if (env.YOUTUBE_API_KEY) {
    const key = env.YOUTUBE_API_KEY;
    c.youtube_trending = async (now) =>
      parseYoutubeVideos(
        (await getJson(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=BR&maxResults=25&key=${key}`,
        )) as { items: YtVideo[] },
        "youtube_trending",
        now,
      );
    for (const kw of cfg.youtubeKeywords) {
      c[`youtube_search:${kw}`] = async (now) => {
        const after = new Date(now.getTime() - 48 * 3_600_000).toISOString();
        const search = (await getJson(
          `https://www.googleapis.com/youtube/v3/search?part=id&type=video&order=viewCount&maxResults=10&relevanceLanguage=pt&publishedAfter=${after}&q=${encodeURIComponent(kw)}&key=${key}`,
        )) as { items: { id: { videoId: string } }[] };
        const ids = search.items.map((i) => i.id.videoId).join(",");
        if (!ids) return [];
        return parseYoutubeVideos(
          (await getJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}&key=${key}`)) as { items: YtVideo[] },
          `youtube_search:${kw}`,
          now,
        );
      };
    }
  }
  return c;
}

/** Roda todos os coletores; falha de um não derruba os outros. */
export async function collectAll(collectors: Record<string, Collector>, now = new Date()): Promise<Signal[]> {
  const results = await Promise.allSettled(Object.entries(collectors).map(async ([name, fn]) => ({ name, signals: await fn(now) })));
  const out: Signal[] = [];
  for (const [i, r] of results.entries()) {
    const name = Object.keys(collectors)[i]!;
    if (r.status === "fulfilled") {
      log("trends.collector", { collector: name, count: r.value.signals.length });
      out.push(...r.value.signals);
    } else {
      logError("trends.collector", r.reason, { collector: name });
    }
  }
  return out;
}
