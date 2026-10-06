import { join } from "node:path";
import { log, logError, transition, type ContentPackage, type Variant } from "@jarvis/core";
import { PublishError, publishersFromEnv, type Publisher, type ResolvedAsset } from "@jarvis/publishers";
import type { Ctx } from "./context.ts";
import { CdnStager } from "./cdn.ts";
import { nextSlot, slotKey, takenSlots } from "./schedule.ts";

const MAX_ATTEMPTS = 3;
/** Atrasado além disso (ex.: rede ligada depois da aprovação) não sai em rajada: volta para a agenda. */
const STALE_MS = 6 * 3_600_000;

function due(v: Variant, now: Date): boolean {
  return v.status === "approved" && !!v.scheduledAt && new Date(v.scheduledAt) <= now;
}

function settle(pkg: ContentPackage, now: Date): ContentPackage {
  const active = pkg.variants.filter((v) => v.status !== "disabled");
  if (active.some((v) => v.status === "approved" || v.status === "publishing")) return pkg;
  let next = transition(pkg, "publishing", undefined, now);
  next = active.some((v) => v.status === "published") ? transition(next, "published", undefined, now) : transition(next, "failed", undefined, now);
  return next;
}

export async function publish(ctx: Ctx, publishers: Partial<Record<string, Publisher>> = publishersFromEnv()): Promise<{ published: number; failed: number }> {
  const pkgs = (await rescheduleStale(ctx, publishers)).filter((p) => p.variants.some((v) => due(v, ctx.now)));
  const cdn = new CdnStager();
  let published = 0;
  let failed = 0;

  // 1) Resolve mídias; as plataformas que exigem URL pública passam pelo caio-cdn.
  const resolved = new Map<string, ResolvedAsset[]>();
  for (const pkg of pkgs) {
    for (const v of pkg.variants.filter((x) => due(x, ctx.now))) {
      const pub = publishers[v.platform];
      if (!pub) continue;
      const list: ResolvedAsset[] = [];
      for (const id of v.assetIds) {
        const asset = pkg.assets.find((a) => a.id === id);
        if (!asset) continue;
        const localPath = join(ctx.store.previewsDir, asset.path);
        const publicUrl = pub.needsPublicUrls && !ctx.dryRun && cdn.configured ? await cdn.stage(localPath) : undefined;
        list.push({ asset, localPath, publicUrl });
      }
      resolved.set(`${pkg.id}/${v.id}`, list);
    }
  }

  try {
    if (!ctx.dryRun) await cdn.flush();

    // 2) Publica.
    for (let pkg of pkgs) {
      for (const v of pkg.variants.filter((x) => due(x, ctx.now))) {
        const pub = publishers[v.platform];
        if (!pub) {
          log("publish.skip", { pkg: pkg.id, variant: v.id, reason: "sem credenciais" });
          continue;
        }
        const assets = resolved.get(`${pkg.id}/${v.id}`) ?? [];
        if (ctx.dryRun) {
          log("publish.dry_run", { pkg: pkg.id, variant: v.id, platform: v.platform, kind: v.kind, assets: assets.length });
          continue;
        }
        let update: Partial<Variant>;
        try {
          const r = await pub.publish(v, assets);
          update = { status: "published", externalId: r.externalId, permalink: r.permalink, publishedAt: ctx.now.toISOString(), error: undefined };
          published++;
          log("publish.ok", { pkg: pkg.id, variant: v.id, platform: v.platform });
        } catch (err) {
          const attempts = v.attempts + 1;
          const retryable = err instanceof PublishError ? err.retryable : true;
          const giveUp = attempts >= MAX_ATTEMPTS || !retryable;
          update = { attempts, error: err instanceof Error ? err.message : String(err), ...(giveUp ? { status: "failed" as const } : {}) };
          if (giveUp) failed++;
          logError("publish.variant", err, { pkg: pkg.id, variant: v.id, attempts, giveUp });
        }
        pkg = { ...pkg, variants: pkg.variants.map((x) => (x.id === v.id ? { ...x, ...update } : x)) };
        await ctx.store.savePackage(pkg); // salva a cada post: idempotência se o job cair no meio
      }
      if (!ctx.dryRun) await ctx.store.savePackage(settle(pkg, ctx.now));
    }
  } finally {
    if (!ctx.dryRun) await cdn.clear().catch((err) => logError("cdn.clear", err));
  }
  log("publish.done", { published, failed, packages: pkgs.length });
  return { published, failed };
}

async function rescheduleStale(ctx: Ctx, publishers: Partial<Record<string, Publisher>>): Promise<ContentPackage[]> {
  const all = await ctx.store.listPackages(["scheduled"]);
  const strategy = await ctx.store.strategy();
  const taken = takenSlots(all);
  const after = new Date(ctx.now.getTime() + 10 * 60_000);
  return Promise.all(
    all.map(async (pkg) => {
      const stale = (v: Variant) => due(v, ctx.now) && !!publishers[v.platform] && ctx.now.getTime() - new Date(v.scheduledAt!).getTime() > STALE_MS;
      if (!pkg.variants.some(stale)) return pkg;
      const variants = pkg.variants.map((v) => {
        if (!stale(v)) return v;
        const k = slotKey(v);
        if (!taken.has(k)) taken.set(k, new Set());
        const iso = nextSlot(strategy.slots[v.platform] ?? ["12:00"], taken.get(k)!, after);
        taken.get(k)!.add(iso);
        log("publish.rescheduled", { pkg: pkg.id, variant: v.id, platform: v.platform });
        return { ...v, scheduledAt: iso };
      });
      const next = { ...pkg, variants };
      if (!ctx.dryRun) await ctx.store.savePackage(next);
      return next;
    }),
  );
}
