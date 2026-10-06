import { log, logError, transition, type ContentPackage } from "@jarvis/core";
import type { Ctx } from "./context.ts";
import { scheduleVariants, takenSlots } from "./schedule.ts";

/**
 * Aplica as decisões tomadas no PWA (arquivos em reviews/) e expira o que
 * passou do prazo sem aprovação. Nada é publicado sem passar por aqui.
 */
export async function applyReviews(ctx: Ctx): Promise<{ applied: number; expired: number }> {
  const strategy = await ctx.store.strategy();
  const pkgs = await ctx.store.listPackages();
  const byId = new Map(pkgs.map((p) => [p.id, p]));
  const taken = takenSlots(pkgs);
  let applied = 0;

  const pending = (await ctx.store.pendingReviews()).sort((a, b) => a.review.at.localeCompare(b.review.at));
  for (const { file, review } of pending) {
    const pkg = byId.get(review.packageId);
    try {
      if (!pkg || pkg.status !== "pending_review") {
        log("reviews.ignored", { pkg: review.packageId, status: pkg?.status ?? "inexistente" });
        await ctx.store.archiveReview(file);
        continue;
      }
      let next: ContentPackage = pkg;
      if (review.decision === "approve") {
        next = {
          ...pkg,
          variants: pkg.variants.map((v) => ({
            ...v,
            caption: review.captionEdits[v.id] ?? v.caption,
            status: review.variantToggles[v.id] === false ? "disabled" : "approved",
            ...(review.schedule[v.id] ? { scheduledAt: review.schedule[v.id] } : {}),
          })),
        };
        next = transition(next, "approved", review.note, ctx.now);
        next = scheduleVariants(next, strategy, taken, ctx.now);
        next = transition(next, "scheduled", undefined, ctx.now);
      } else if (review.decision === "reject") {
        next = transition(pkg, "rejected", review.reason, ctx.now);
      } else {
        next = transition({ ...pkg, editRequests: [...pkg.editRequests, { at: review.at, note: review.note ?? review.reason ?? "" }] }, "edit_requested", undefined, ctx.now);
      }
      byId.set(next.id, next);
      await ctx.store.savePackage(next);
      await ctx.store.archiveReview(file);
      applied++;
      log("reviews.applied", { pkg: pkg.id, decision: review.decision });
    } catch (err) {
      logError("reviews.apply", err, { pkg: review.packageId });
    }
  }

  let expired = 0;
  for (const pkg of byId.values()) {
    if (pkg.status === "pending_review" && pkg.expiresAt && new Date(pkg.expiresAt) < ctx.now) {
      await ctx.store.savePackage(transition(pkg, "expired", "prazo de aprovação vencido", ctx.now));
      expired++;
    }
  }
  return { applied, expired };
}
