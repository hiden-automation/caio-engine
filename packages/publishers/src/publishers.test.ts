import { describe, expect, it } from "vitest";
import { toLittleText } from "./linkedin.ts";
import { oauth1Header } from "./x.ts";
import { InstagramPublisher } from "./instagram.ts";

describe("LinkedIn little text", () => {
  it("escapa reservados e mantém hashtag clicável", () => {
    expect(toLittleText("Automação (de verdade) #IA")).toBe("Automação \\(de verdade\\) {hashtag|\\#|IA}");
  });
});

describe("OAuth 1.0a do X", () => {
  // Vetor de exemplo da documentação oficial do X (Creating a signature).
  it("gera a assinatura esperada", () => {
    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      "1318622958",
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });
});

describe("Instagram stories em sequência", () => {
  it("publica cada quadro em ordem, como vídeo", async () => {
    const calls: { path: string; body: Record<string, string> }[] = [];
    let n = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const body = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
      calls.push({ path, body });
      const json = init?.method === "POST" ? { id: `c${++n}` } : { status_code: "FINISHED" };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch;
    try {
      const ig = new InstagramPublisher("u1", "tok");
      const asset = (i: number) => ({
        asset: { id: `video-${i}`, kind: "video" as const, path: `x/story-${i}.mp4`, role: "story" as const, order: i },
        localPath: "",
        publicUrl: `https://cdn/story-${i}.mp4`,
      });
      const variant = { id: "instagram-story", platform: "instagram", kind: "story", caption: "", threadParts: [], assetIds: [], status: "approved", attempts: 0, aiLabel: true } as never;
      await ig.publish(variant, [asset(1), asset(2), asset(3)]);
      const created = calls.filter((c) => c.path.endsWith("/u1/media")).map((c) => c.body);
      expect(created.map((b) => b.video_url)).toEqual(["https://cdn/story-1.mp4", "https://cdn/story-2.mp4", "https://cdn/story-3.mp4"]);
      expect(created.every((b) => b.media_type === "STORIES")).toBe(true);
      expect(calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(3);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
