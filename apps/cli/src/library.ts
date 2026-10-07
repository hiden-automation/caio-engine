import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { log, logError, type LibraryItem } from "@jarvis/core";
import { tagMedia } from "@jarvis/llm";
import { avatarFromCutout, cutoutMany, keyframes, normalizeImage, probe, verticalClip } from "@jarvis/media";
import type { Ctx } from "./context.ts";

const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const TAG_BATCH = 4;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const rel = (ctx: Ctx, p: string) => relative(ctx.libraryDir, p).replaceAll("\\", "/");
const abs = (ctx: Ctx, p: string) => join(ctx.libraryDir, p);

/** Mídia que pode aparecer em arte: nada político (período eleitoral) nem sensível. */
export function usable(item: LibraryItem): boolean {
  return !!item.tags && !item.tags.political && !item.tags.sensitive && item.tags.quality >= 0.35;
}

/**
 * "Jogar na base": tudo o que o Caio sobe pelo PWA cai em `raw/` na branch
 * library. Aqui cada arquivo novo é normalizado, etiquetado pela IA (visão),
 * recortado (pessoa/cachorro) e, se for vídeo, vira b-roll vertical.
 */
export async function processLibrary(ctx: Ctx): Promise<{ added: number; tagged: number; removed: number }> {
  const all = await ctx.store.library();
  const metaStart = await ctx.store.libraryMeta();
  let next = Math.max(metaStart.lastId ?? 0, ...all.map((i) => Number(i.id.slice(1)) || 0)) + 1;

  // 0) Apagadas no PWA (o arquivo original sumiu da branch library): saem do índice e não voltam.
  const exists = (p: string) => access(abs(ctx, p)).then(() => true, () => false);
  const items: LibraryItem[] = [];
  let removed = 0;
  for (const it of all) {
    if (await exists(it.raw)) {
      items.push(it);
      continue;
    }
    removed++;
    await rm(join(ctx.libraryDir, "derived", it.id), { recursive: true, force: true });
    log("library.removed", { id: it.id });
  }
  if (removed && metaStart.avatarFrom && !items.some((i) => i.id === metaStart.avatarFrom)) {
    // O avatar vinha de uma foto apagada: some até achar outra boa.
    await rm(join(ctx.libraryDir, "derived", "avatar.jpg"), { force: true });
    await ctx.store.saveLibraryMeta({ ...metaStart, avatar: undefined, avatarFrom: undefined });
  }
  const known = new Set(items.map((i) => i.raw));
  let added = 0;

  // 1) Ingestão.
  for (const file of (await walk(join(ctx.libraryDir, "raw"))).sort()) {
    const raw = rel(ctx, file);
    if (known.has(raw) || !(IMAGE.test(file) || VIDEO.test(file))) continue;
    const id = `L${next++}`;
    const dir = join(ctx.libraryDir, "derived", id);
    await mkdir(dir, { recursive: true });
    try {
      if (IMAGE.test(file)) {
        const full = join(dir, "full.jpg");
        const { width, height } = await normalizeImage(file, full);
        items.push({ id, raw, kind: "image", addedAt: (await stat(file)).mtime.toISOString(), width, height, derived: { full: rel(ctx, full), frames: [] }, usage: { count: 0 } });
      } else {
        const p = await probe(file);
        const frames = await keyframes(file, dir, 3);
        items.push({
          id,
          raw,
          kind: "video",
          addedAt: (await stat(file)).mtime.toISOString(),
          width: p.width,
          height: p.height,
          durationSec: Math.round(p.durationSec * 10) / 10,
          derived: { full: rel(ctx, frames[1] ?? frames[0]!), frames: frames.map((f) => rel(ctx, f)) },
          usage: { count: 0 },
        });
      }
      added++;
      log("library.added", { id, kind: IMAGE.test(file) ? "image" : "video" });
    } catch (err) {
      logError("library.ingest", err, { id });
    }
  }

  // 2) Etiquetas por visão, em lotes.
  const brand = await ctx.brand();
  const untagged = items.filter((i) => !i.tags);
  let tagged = 0;
  for (let i = 0; i < untagged.length; i += TAG_BATCH) {
    const batch = untagged.slice(i, i + TAG_BATCH);
    try {
      const out = await tagMedia(
        ctx.llm(),
        brand,
        batch.map((it) => ({ id: it.id, kind: it.kind, files: (it.kind === "video" ? it.derived.frames : [it.derived.full]).map((f) => abs(ctx, f)) })),
      );
      for (const t of out) {
        const it = items.find((x) => x.id === t.id);
        if (!it) continue;
        const { id: _, ...tags } = t;
        it.tags = { ...tags, quality: Math.max(0, Math.min(1, tags.quality)), focus: { x: Math.max(0, Math.min(1, tags.focus.x)), y: Math.max(0, Math.min(1, tags.focus.y)) } };
        tagged++;
      }
    } catch (err) {
      logError("library.tag", err, { batch: batch.map((b) => b.id).join(",") });
    }
  }

  // 3) Recortes (Caio/cachorro) e b-roll vertical. Recorte de mídia que a IA não aprovou para isso sai de uso.
  for (const it of items) if (it.derived.cutout && !it.tags?.uses.includes("recorte")) delete it.derived.cutout;
  const toCut = items.filter((i) => i.kind === "image" && usable(i) && !i.derived.cutout && i.tags!.uses.includes("recorte"));
  const pairs = toCut.map((i): [string, string] => [abs(ctx, i.derived.full), join(ctx.libraryDir, "derived", i.id, "cutout.png")]);
  if (pairs.length && (await cutoutMany(pairs))) {
    for (const [k, it] of toCut.entries()) it.derived.cutout = rel(ctx, pairs[k]![1]);
  }
  for (const it of items.filter((i) => i.kind === "video" && usable(i) && !i.derived.clip && i.tags!.uses.includes("broll"))) {
    const clip = join(ctx.libraryDir, "derived", it.id, "clip.mp4");
    try {
      await verticalClip(abs(ctx, it.raw), clip, it.tags!.focus.x);
      it.derived.clip = rel(ctx, clip);
    } catch (err) {
      logError("library.clip", err, { id: it.id });
    }
  }

  // 4) Avatar: o rosto mais nítido do Caio, de frente.
  const meta = await ctx.store.libraryMeta();
  const candidates = items
    .filter((i) => usable(i) && i.derived.cutout && i.tags!.people === "caio" && i.tags!.uses.includes("avatar"))
    .sort((a, b) => b.tags!.quality - a.tags!.quality + (b.tags!.setting === "estudio" ? 0.2 : 0) - (a.tags!.setting === "estudio" ? 0.2 : 0));
  const best = candidates[0];
  if (best && meta.avatarFrom !== best.id) {
    const file = join(ctx.libraryDir, "derived", "avatar.jpg");
    try {
      await avatarFromCutout(abs(ctx, best.derived.cutout!), file);
      await ctx.store.saveLibraryMeta({ ...meta, avatar: rel(ctx, file), avatarFrom: best.id, lastId: next - 1 });
      log("library.avatar", { from: best.id });
    } catch (err) {
      logError("library.avatar", err);
    }
  }

  await ctx.store.saveLibrary(items);
  await ctx.store.saveLibraryMeta({ ...(await ctx.store.libraryMeta()), lastId: next - 1 });
  log("library.done", { added, tagged, removed, total: items.length });
  return { added, tagged, removed };
}

/** Usos recentes acima disso: a mídia "descansa" (o feed não pode repetir a mesma foto em sequência). */
export const REST_AFTER = 2;

/** Catálogo curto para o roteirista escolher mídias pelo id (a mais descansada primeiro). */
export function libraryCatalog(items: LibraryItem[], recentUses: Map<string, number> = new Map()): string {
  return items
    .filter(usable)
    .filter((i) => (recentUses.get(i.id) ?? 0) < REST_AFTER)
    .sort((a, b) => (recentUses.get(a.id) ?? 0) - (recentUses.get(b.id) ?? 0))
    .map((i) => {
      const t = i.tags!;
      const has = [i.derived.cutout ? "recorte" : "", i.derived.clip ? `b-roll ${i.durationSec}s` : ""].filter(Boolean).join(", ");
      return `- ${i.id} | ${i.kind === "video" ? "vídeo" : "foto"} | ${t.description} | pessoas: ${t.people}${t.hasDog ? ", cachorro" : ""} | expressão: ${t.expression} | lugar: ${t.setting} | usos: ${t.uses.join(", ")}${has ? ` | tem: ${has}` : ""} | usada ${i.usage.count}x no total`;
    })
    .join("\n");
}
