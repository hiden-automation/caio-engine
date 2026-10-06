import { log, logError, type MetricSnapshot, type Platform } from "@jarvis/core";
import { publishersFromEnv, type Publisher } from "@jarvis/publishers";
import type { Ctx } from "./context.ts";

const WINDOWS_H = [1, 6, 24, 72, 168];
/** Leitura no X é paga: só nas janelas que importam para o otimizador. */
const WINDOWS_BY_PLATFORM: Partial<Record<Platform, number[]>> = { x: [24, 168] };

export function bucket(ageH: number, windows: number[]): number | undefined {
  return [...windows].reverse().find((w) => ageH >= w);
}

export async function snapshot(ctx: Ctx, publishers: Partial<Record<Platform, Publisher>> = publishersFromEnv()): Promise<number> {
  const existing = await ctx.store.loadSnapshots();
  const done = new Set(
    existing.map((s) => `${s.variantId}@${bucket(s.ageHours, WINDOWS_BY_PLATFORM[s.platform] ?? WINDOWS_H)}`),
  );
  const pkgs = await ctx.store.listPackages(["published", "scheduled"]);
  const snaps: MetricSnapshot[] = [];

  for (const pkg of pkgs) {
    for (const v of pkg.variants) {
      if (v.status !== "published" || !v.externalId || !v.publishedAt) continue;
      const pub = publishers[v.platform];
      if (!pub?.insights) continue;
      const ageHours = (ctx.now.getTime() - new Date(v.publishedAt).getTime()) / 3_600_000;
      const windows = WINDOWS_BY_PLATFORM[v.platform] ?? WINDOWS_H;
      const b = bucket(ageHours, windows);
      if (b === undefined || ageHours > 192 || done.has(`${v.id}@${b}`)) continue;
      try {
        const m = await pub.insights(v.externalId);
        snaps.push({
          packageId: pkg.id,
          variantId: v.id,
          platform: v.platform,
          externalId: v.externalId,
          takenAt: ctx.now.toISOString(),
          ageHours: Math.round(ageHours * 10) / 10,
          ...Object.fromEntries(Object.entries(m).filter(([, x]) => x !== undefined)),
        });
        done.add(`${v.id}@${b}`);
      } catch (err) {
        logError("snapshot.variant", err, { pkg: pkg.id, variant: v.id });
      }
    }
  }
  await ctx.store.appendSnapshots(snaps);
  log("snapshot.done", { taken: snaps.length });
  return snaps.length;
}
