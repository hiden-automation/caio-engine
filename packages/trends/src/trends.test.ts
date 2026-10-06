import { describe, expect, it } from "vitest";
import type { Signal } from "@jarvis/core";
import { parseApproxTraffic, parseGoogleTrendsRss, parseHackerNews, parseRss } from "./collectors.ts";
import { hypeScore, mergeSignals, scoreSignals } from "./hype.ts";

const now = new Date("2026-10-06T15:00:00Z");

const GT_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>novo iphone</title><ht:approx_traffic>200 mil+</ht:approx_traffic><pubDate>Tue, 6 Oct 2026 13:00:00 +0000</pubDate></item>
<item><title>inteligência artificial</title><ht:approx_traffic>2K+</ht:approx_traffic><pubDate>Tue, 6 Oct 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`;

const NEWS_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Reforma tributária muda regras para PMEs</title><link>https://exemplo.com/a</link><pubDate>Tue, 6 Oct 2026 14:00:00 +0000</pubDate></item>
</channel></rss>`;

describe("parsers dos coletores", () => {
  it("Hacker News: velocidade = pontos por hora", () => {
    const s = parseHackerNews({ hits: [{ objectID: "1", title: "Show HN", points: 100, created_at_i: now.getTime() / 1000 - 4 * 3600 }] }, now);
    expect(s[0]!.velocity).toBeCloseTo(25);
  });

  it("Google Trends: interpreta tráfego aproximado", () => {
    expect(parseApproxTraffic("200 mil+")).toBe(200_000);
    expect(parseApproxTraffic("2K+")).toBe(2000);
    const s = parseGoogleTrendsRss(GT_RSS, now);
    expect(s.map((x) => x.title)).toEqual(["novo iphone", "inteligência artificial"]);
    expect(s[0]!.velocity).toBeGreaterThan(s[1]!.velocity);
  });

  it("RSS genérico", () => {
    const s = parseRss(NEWS_RSS, { name: "teste", tags: ["noticia"] }, now);
    expect(s[0]!.url).toBe("https://exemplo.com/a");
    expect(s[0]!.collector).toBe("rss:teste");
  });
});

function sig(id: string, collector: string, title: string, velocity: number): Signal {
  return { id, collector, title, observedAt: now.toISOString(), value: velocity, velocity, tags: [] };
}

describe("hype score", () => {
  it("dá mais nota ao que aparece em várias fontes", () => {
    const scored = scoreSignals(
      [
        sig("a", "hn", "OpenAI lança novo modelo de raciocínio", 50),
        sig("b", "gtrends", "novo modelo openai raciocínio", 10),
        sig("c", "reddit", "modelo openai raciocínio benchmark", 10),
        sig("d", "hn", "Rust 2.0 released", 40),
      ],
      now,
    );
    const a = scored.find((s) => s.signal.id === "a")!;
    const d = scored.find((s) => s.signal.id === "d")!;
    expect(a.crossPlatform).toBeGreaterThan(d.crossPlatform);
    expect(scored[0]!.signal.id).toBe("a");
  });

  it("sem aderência aos pilares a nota é zero; risco derruba", () => {
    const [s] = scoreSignals([sig("a", "hn", "x", 1)], now);
    expect(hypeScore(s!, { pillarFit: 0.1, risk: 0, saturation: 0 })).toBe(0);
    const safe = hypeScore(s!, { pillarFit: 0.9, risk: 0, saturation: 0 });
    const risky = hypeScore(s!, { pillarFit: 0.9, risk: 0.8, saturation: 0 });
    expect(risky).toBeLessThan(safe);
  });

  it("mergeSignals mantém a primeira observação", () => {
    const old = { ...sig("a", "hn", "t", 1), observedAt: "2026-10-06T10:00:00.000Z" };
    const merged = mergeSignals([old], [sig("a", "hn", "t", 5)]);
    expect(merged[0]!.observedAt).toBe("2026-10-06T10:00:00.000Z");
    expect(merged[0]!.velocity).toBe(5);
  });
});
