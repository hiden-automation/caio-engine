import type { ContentPackage } from "@jarvis/core";
import type { Ctx } from "./context.ts";

/** Resumo de um pacote agendado/publicado para Agenda e Painel. */
function summary(p: ContentPackage) {
  return {
    id: p.id,
    topic: p.topic,
    pillar: p.pillar,
    format: p.format,
    status: p.status,
    cover: p.assets.find((a) => a.role === "cover" || a.role === "story")?.path,
    variants: p.variants.map((v) => ({
      id: v.id,
      platform: v.platform,
      kind: v.kind,
      status: v.status,
      scheduledAt: v.scheduledAt,
      publishedAt: v.publishedAt,
      permalink: v.permalink,
      error: v.error,
    })),
  };
}

/**
 * Tudo que o PWA precisa num arquivo só (pwa/feed.json): fila para aprovar,
 * agenda, publicados recentes, saúde, gasto e propostas do otimizador.
 */
export async function writeFeed(ctx: Ctx): Promise<void> {
  const pkgs = await ctx.store.listPackages();
  const byNewest = (a: ContentPackage, b: ContentPackage) => b.createdAt.localeCompare(a.createdAt);
  const readOptional = async (rel: string) => ((await ctx.store.exists(rel)) ? JSON.parse(await ctx.store.readText(rel)) : null);

  await ctx.store.writeJson("pwa/feed.json", {
    generatedAt: ctx.now.toISOString(),
    pending: pkgs
      .filter((p) => p.status === "pending_review")
      .sort((a, b) => Number(b.express) - Number(a.express) || byNewest(a, b)),
    scheduled: pkgs.filter((p) => p.status === "scheduled").map(summary),
    published: pkgs
      .filter((p) => p.status === "published" || p.status === "failed")
      .sort(byNewest)
      .slice(0, 30)
      .map(summary),
    counts: Object.fromEntries(
      [...new Set(pkgs.map((p) => p.status))].map((s) => [s, pkgs.filter((p) => p.status === s).length]),
    ),
    spendBrl: Math.round((await ctx.budget.totalBrl()) * 100) / 100,
    health: await readOptional("health.json"),
    proposals: await readOptional("strategy-proposals.json"),
    strategy: await ctx.store.strategy(),
  });
}
