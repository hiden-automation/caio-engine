import { readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { log, type ContentPackage } from "@jarvis/core";
import type { Ctx } from "./context.ts";

const KEEP_DAYS = 14;
const DONE = new Set(["published", "rejected", "expired", "discarded", "failed"]);

/** Arquivos da branch previews que ainda servem a algum pacote vivo ou recente. */
export function referencedPaths(pkgs: ContentPackage[], now: Date): Set<string> {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const keep = new Set<string>();
  for (const p of pkgs) {
    if (DONE.has(p.status) && new Date(p.updatedAt).getTime() < cutoff) continue;
    for (const a of p.assets) keep.add(a.path);
  }
  return keep;
}

/**
 * Apaga do checkout da branch previews o que não é mais referenciado. O
 * workflow gc.yml recria a branch como commit órfão, então o histórico some.
 */
export async function gc(ctx: Ctx): Promise<number> {
  const keep = referencedPaths(await ctx.store.listPackages(), ctx.now);
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        if (!(await readdir(full)).length) await rm(full, { recursive: true });
      } else if (!keep.has(relative(ctx.store.previewsDir, full).replaceAll("\\", "/"))) {
        await rm(full);
        removed++;
      }
    }
  };
  await walk(ctx.store.previewsDir).catch(() => undefined);
  log("gc.done", { removed, kept: keep.size });
  return removed;
}
