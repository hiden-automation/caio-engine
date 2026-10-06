import type { Variant } from "@jarvis/core";
import { http, PublishError, sleep, type Insights, type Publisher, type PublishResult, type ResolvedAsset } from "./types.ts";

/** Threads API (oficial). Imagens exigem URL pública → caio-cdn. */
export class ThreadsPublisher implements Publisher {
  readonly platform = "threads" as const;
  readonly needsPublicUrls = true;
  private readonly base = "https://graph.threads.net/v1.0";

  constructor(
    private readonly userId: string,
    private readonly token: string,
  ) {}

  private post<T>(path: string, params: Record<string, string>): Promise<T> {
    return http<T>(`${this.base}/${path}`, { method: "POST", body: new URLSearchParams({ ...params, access_token: this.token }) });
  }

  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return http<T>(`${this.base}/${path}?${new URLSearchParams({ ...params, access_token: this.token })}`);
  }

  private async waitReady(id: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const { status } = await this.get<{ status: string }>(id, { fields: "status" });
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") throw new PublishError(`Container ${status}`, false);
      await sleep(4000);
    }
    throw new PublishError("Container não ficou pronto a tempo", true);
  }

  private async createAndPublish(params: Record<string, string>): Promise<string> {
    const { id: creation } = await this.post<{ id: string }>(`${this.userId}/threads`, params);
    await this.waitReady(creation);
    const { id } = await this.post<{ id: string }>(`${this.userId}/threads_publish`, { creation_id: creation });
    return id;
  }

  async publish(variant: Variant, assets: ResolvedAsset[]): Promise<PublishResult> {
    const urls = assets.map((a) => a.publicUrl).filter((u): u is string => !!u);
    let rootId: string;

    if (variant.kind === "carousel" && urls.length > 1) {
      const children: string[] = [];
      for (const url of urls.slice(0, 20)) {
        const { id } = await this.post<{ id: string }>(`${this.userId}/threads`, { media_type: "IMAGE", image_url: url, is_carousel_item: "true" });
        children.push(id);
      }
      for (const c of children) await this.waitReady(c);
      rootId = await this.createAndPublish({ media_type: "CAROUSEL", children: children.join(","), text: variant.caption });
    } else if (urls.length === 1) {
      rootId = await this.createAndPublish({ media_type: "IMAGE", image_url: urls[0]!, text: variant.caption });
    } else {
      rootId = await this.createAndPublish({ media_type: "TEXT", text: variant.caption });
    }

    // Partes seguintes da thread viram respostas encadeadas.
    let parent = rootId;
    for (const part of variant.threadParts) {
      parent = await this.createAndPublish({ media_type: "TEXT", text: part, reply_to_id: parent });
    }

    const { permalink } = await this.get<{ permalink?: string }>(rootId, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
    return { externalId: rootId, permalink };
  }

  async insights(mediaId: string): Promise<Insights> {
    const { data } = await this.get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
      `${mediaId}/insights`,
      { metric: "views,likes,replies,reposts,quotes,shares" },
    );
    const m = Object.fromEntries(data.map((d) => [d.name, d.total_value?.value ?? d.values?.[0]?.value ?? 0]));
    return { views: m.views, likes: m.likes, comments: m.replies, shares: (m.reposts ?? 0) + (m.quotes ?? 0) + (m.shares ?? 0) };
  }

  async refreshToken(): Promise<{ token: string; expiresInSec: number }> {
    const q = new URLSearchParams({ grant_type: "th_refresh_token", access_token: this.token });
    const r = await http<{ access_token: string; expires_in: number }>(`https://graph.threads.net/refresh_access_token?${q}`);
    return { token: r.access_token, expiresInSec: r.expires_in };
  }
}
