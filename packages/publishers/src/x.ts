import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Variant } from "@jarvis/core";
import { PublishError, type Insights, type Publisher, type PublishResult, type ResolvedAsset } from "./types.ts";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Assinatura OAuth 1.0a (user context): tokens que não expiram. */
export function oauth1Header(
  method: string,
  url: string,
  creds: XCredentials,
  extraParams: Record<string, string> = {},
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...Object.fromEntries(u.searchParams), ...extraParams, ...oauth };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k]!)}`)
    .join("&");
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(paramStr)].join("&");
  const signature = createHmac("sha1", `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`).update(base).digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ")
  );
}

/**
 * X API (pay-per-use): ~US$ 0,015 por post, ~US$ 0,20 se houver link —
 * por isso o QA bloqueia links no X.
 */
export class XPublisher implements Publisher {
  readonly platform = "x" as const;
  readonly needsPublicUrls = false;

  constructor(private readonly creds: XCredentials) {}

  private async call<T>(method: string, url: string, body?: BodyInit, contentType?: string): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { authorization: oauth1Header(method, url, this.creds), ...(contentType ? { "content-type": contentType } : {}) },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new PublishError(`HTTP ${res.status} em ${new URL(url).pathname}`, res.status === 429 || res.status >= 500, res.status);
    return (await res.json()) as T;
  }

  private async uploadImage(file: string): Promise<string> {
    const form = new FormData();
    form.append("media", new Blob([await readFile(file)], { type: "image/jpeg" }));
    form.append("media_category", "tweet_image");
    const r = await this.call<{ data: { id: string } }>("POST", "https://api.x.com/2/media/upload", form);
    return r.data.id;
  }

  private tweet(payload: Record<string, unknown>): Promise<{ data: { id: string } }> {
    return this.call("POST", "https://api.x.com/2/tweets", JSON.stringify(payload), "application/json");
  }

  async publish(variant: Variant, assets: ResolvedAsset[]): Promise<PublishResult> {
    const images = assets.filter((a) => a.asset.kind === "image").slice(0, 4);
    const mediaIds: string[] = [];
    for (const img of images) mediaIds.push(await this.uploadImage(img.localPath));

    const first = await this.tweet({ text: variant.caption, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) });
    let parent = first.data.id;
    for (const part of variant.threadParts) {
      parent = (await this.tweet({ text: part, reply: { in_reply_to_tweet_id: parent } })).data.id;
    }
    return { externalId: first.data.id, permalink: `https://x.com/i/status/${first.data.id}` };
  }

  /** Leitura paga (~US$ 0,005): o snapshot coleta X só em amostra. */
  async insights(id: string): Promise<Insights> {
    const r = await this.call<{ data: { public_metrics: Record<string, number> } }>(
      "GET",
      `https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`,
    );
    const m = r.data.public_metrics;
    return {
      views: m.impression_count,
      likes: m.like_count,
      comments: m.reply_count,
      shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
      saves: m.bookmark_count,
    };
  }
}
