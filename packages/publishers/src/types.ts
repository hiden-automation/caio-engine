import type { Asset, MetricSnapshot, Platform, Variant } from "@jarvis/core";

export interface ResolvedAsset {
  asset: Asset;
  /** Arquivo no runner (checkout da branch `previews`). */
  localPath: string;
  /** URL pública temporária no caio-cdn (IG e Threads exigem). */
  publicUrl?: string;
}

export interface PublishResult {
  externalId: string;
  permalink?: string;
}

export type Insights = Pick<MetricSnapshot, "views" | "reach" | "likes" | "comments" | "shares" | "saves" | "follows" | "avgWatchSec">;

export interface Publisher {
  readonly platform: Platform;
  /** Precisa de URL pública das mídias (caio-cdn)? */
  readonly needsPublicUrls: boolean;
  publish(variant: Variant, assets: ResolvedAsset[]): Promise<PublishResult>;
  insights?(externalId: string): Promise<Insights>;
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function http<T = unknown>(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    // Não incluímos o corpo na mensagem: pode ecoar legenda/token nos logs públicos.
    throw new PublishError(`HTTP ${res.status} em ${new URL(url).pathname}`, res.status === 429 || res.status >= 500, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
