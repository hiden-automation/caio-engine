import { readFile } from "node:fs/promises";
import type { Variant } from "@jarvis/core";
import { PublishError, type Publisher, type PublishResult, type ResolvedAsset } from "./types.ts";

/**
 * O "commentary" da Posts API usa o formato little text: caracteres
 * reservados precisam de escape, senão o post é cortado. Hashtags viram o
 * template oficial para continuarem clicáveis.
 */
export function toLittleText(text: string): string {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/u);
  return parts
    .map((p) => {
      if (/^#[\p{L}\p{N}_]+$/u.test(p)) return `{hashtag|\\#|${p.slice(1)}}`;
      return p.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
    })
    .join("");
}

/** LinkedIn Posts API ("Share on LinkedIn", escopo w_member_social). */
export class LinkedInPublisher implements Publisher {
  readonly platform = "linkedin" as const;
  readonly needsPublicUrls = false;

  constructor(
    private readonly personUrn: string,
    private readonly token: string,
    private readonly version = process.env.LINKEDIN_VERSION ?? "202608",
  ) {}

  private headers(json = true): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "linkedin-version": this.version,
      "x-restli-protocol-version": "2.0.0",
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new PublishError(`HTTP ${res.status} em ${new URL(url).pathname}`, res.status === 429 || res.status >= 500, res.status);
    return res;
  }

  private async upload(kind: "documents" | "images", file: string): Promise<string> {
    const init = await this.call(`https://api.linkedin.com/rest/${kind}?action=initializeUpload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ initializeUploadRequest: { owner: this.personUrn } }),
    });
    const { value } = (await init.json()) as { value: { uploadUrl: string; document?: string; image?: string } };
    await this.call(value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${this.token}` }, body: await readFile(file) });
    return (value.document ?? value.image)!;
  }

  async publish(variant: Variant, assets: ResolvedAsset[]): Promise<PublishResult> {
    let content: Record<string, unknown> | undefined;
    if (variant.kind === "document") {
      const pdf = assets.find((a) => a.asset.kind === "pdf");
      if (!pdf) throw new PublishError("Variante document sem PDF", false);
      const firstLine = variant.caption.split("\n")[0]!.slice(0, 100);
      content = { media: { title: firstLine, id: await this.upload("documents", pdf.localPath) } };
    } else if (variant.kind === "image") {
      content = { media: { id: await this.upload("images", assets[0]!.localPath) } };
    } else if (variant.kind !== "text") {
      throw new PublishError(`Tipo ${variant.kind} ainda não suportado no LinkedIn`, false);
    }

    const res = await this.call("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        author: this.personUrn,
        commentary: toLittleText(variant.caption),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    const urn = res.headers.get("x-restli-id");
    if (!urn) throw new PublishError("LinkedIn não devolveu o id do post", false);
    return { externalId: urn, permalink: `https://www.linkedin.com/feed/update/${urn}/` };
  }
}
