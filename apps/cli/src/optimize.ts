import { log, mulberry32 } from "@jarvis/core";
import { optimizeStrategy } from "@jarvis/optimizer";
import type { Ctx } from "./context.ts";

/**
 * Roda o bandit: aplica sozinho o que está dentro dos limites e grava as
 * mudanças maiores como propostas para o Caio aprovar na tela Estratégia.
 */
export async function optimize(ctx: Ctx): Promise<{ changed: boolean; proposals: number }> {
  const strategy = await ctx.store.strategy();
  const result = optimizeStrategy({
    strategy,
    packages: await ctx.store.listPackages(),
    snapshots: await ctx.store.loadSnapshots(),
    now: ctx.now,
    rng: mulberry32(ctx.now.getTime() % 2 ** 31),
  });

  const day = ctx.now.toISOString().slice(0, 10);
  if (result.changed) await ctx.store.saveStrategy(result.strategy);
  await ctx.store.writeJson("strategy-proposals.json", {
    createdAt: ctx.now.toISOString(),
    basedOnVersion: strategy.version,
    proposals: result.proposals,
  });
  await ctx.store.writeText(
    `reports/estrategia-${day}.md`,
    [`# Relatório de estratégia — ${day}`, "", ...result.report.map((l) => `- ${l}`), "", `Propostas fora do limite automático: ${result.proposals.length}`].join("\n") + "\n",
  );
  log("optimize.done", { changed: result.changed, proposals: result.proposals.length });
  return { changed: result.changed, proposals: result.proposals.length };
}
