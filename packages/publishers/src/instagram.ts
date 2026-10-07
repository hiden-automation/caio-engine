import type { Variant } from "@jarvis/core";
import { http, PublishError, sleep, type Insights, type Publisher, type PublishResult, type ResolvedAsset } from "./types.ts";

/**
 * Instagram API com Instagram Login (conta profissional). O app em modo de
 * desenvolvimento publica na conta do próprio dono sem App Review.
 * Imagens precisam de URL pública em JPEG → caio-cdn.
 */
export class InstagramPublisher implements Publisher {
  readonly platform = "instagram" as const;
  readonly needsPublicUrls = true;
  private readonly base: string;

  constructor(
    private readonly userId: string,
    private readonly token: string,
    version = process.env.IG_API_VERSION ?? "v24.0",
  ) {
    this.base = `https://graph.instagram.com/${version}`;
  }

  private post<T>(path: string, params: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: this.token });
    return http<T>(`${this.base}/${path}`, { method: "POST", body });
  }

  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const q = new URLSearchParams({ ...params, access_token: this.token });
    return http<T>(`${this.base}/${path}?${q}`);
  }

  private async waitReady(containerId: string, tries = 30): Promise<void> {
    for (let i = 0; i < tries; i++) {
      const { status_code } = await this.get<{ status_code: string }>(containerId, { fields: "status_code" });
      if (status_code === "FINISHED") return;
      if (status_code === "ERROR" || status_code === "EXPIRED") throw new PublishError(`Container ${status_code}`, false);
      await sleep(5000);
    }
    throw new PublishError("Container não ficou pronto a tempo", true);
  }

  async publish(variant: Variant, assets: ResolvedAsset[]): Promise<PublishResult> {
    const urls = assets.map((a) => {
      if (!a.publicUrl) throw new PublishError("Instagram exige URL pública da mídia", false);
      return a.publicUrl;
    });

    let creationId: string;
    if (variant.kind === "reel") {
      const video = assets.find((a) => a.asset.kind === "video")?.publicUrl;
      const cover = assets.find((a) => a.asset.kind === "image")?.publicUrl;
      if (!video) throw new PublishError("Reel sem vídeo", false);
      ({ id: creationId } = await this.post<{ id: string }>(`${this.userId}/media`, {
        media_type: "REELS",
        video_url: video,
        caption: variant.caption,
        share_to_feed: "true",
        ...(cover ? { cover_url: cover } : {}),
      }));
      // Vídeo demora para processar no servidor da Meta.
      await this.waitReady(creationId, 90);
    } else if (variant.kind === "carousel" && urls.length > 1) {
      const children: string[] = [];
      for (const url of urls.slice(0, 10)) {
        const { id } = await this.post<{ id: string }>(`${this.userId}/media`, { image_url: url, is_carousel_item: "true" });
        children.push(id);
      }
      for (const c of children) await this.waitReady(c);
      ({ id: creationId } = await this.post<{ id: string }>(`${this.userId}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: variant.caption,
      }));
    } else if (variant.kind === "story") {
      // Sequência: cada quadro é um story; publica em ordem e o último segue o fluxo normal.
      const frames: Record<string, string>[] = assets.map((a): Record<string, string> => ({ [a.asset.kind === "video" ? "video_url" : "image_url"]: a.publicUrl! }));
      for (const f of frames.slice(0, -1)) {
        const { id } = await this.post<{ id: string }>(`${this.userId}/media`, { media_type: "STORIES", ...f });
        await this.waitReady(id, "video_url" in f ? 90 : 30);
        await this.post<{ id: string }>(`${this.userId}/media_publish`, { creation_id: id });
      }
      const lastFrame = frames.at(-1)!;
      ({ id: creationId } = await this.post<{ id: string }>(`${this.userId}/media`, { media_type: "STORIES", ...lastFrame }));
      if ("video_url" in lastFrame) await this.waitReady(creationId, 90);
    } else if (variant.kind === "image" || variant.kind === "carousel") {
      ({ id: creationId } = await this.post<{ id: string }>(`${this.userId}/media`, { image_url: urls[0]!, caption: variant.caption }));
    } else {
      throw new PublishError(`Tipo ${variant.kind} ainda não suportado no Instagram`, false);
    }

    await this.waitReady(creationId);
    const { id } = await this.post<{ id: string }>(`${this.userId}/media_publish`, { creation_id: creationId });
    const { permalink } = await this.get<{ permalink?: string }>(id, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
    return { externalId: id, permalink };
  }

  async insights(mediaId: string): Promise<Insights> {
    const read = async (metrics: string) => {
      const { data } = await this.get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
        `${mediaId}/insights`,
        { metric: metrics },
      );
      return Object.fromEntries(data.map((d) => [d.name, d.total_value?.value ?? d.values?.[0]?.value ?? 0]));
    };
    const m = await read("reach,likes,comments,shares,saved,views");
    // "follows" não existe para todo tipo de mídia: tentativa opcional.
    const extra = await read("follows").catch(() => ({}) as Record<string, number>);
    return { reach: m.reach, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saved, views: m.views, follows: extra.follows };
  }

  /** Renova o token de longa duração (60 dias). Rodar semanalmente no doctor. */
  async refreshToken(): Promise<{ token: string; expiresInSec: number }> {
    const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: this.token });
    const r = await http<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?${q}`);
    return { token: r.access_token, expiresInSec: r.expires_in };
  }
}
