import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, logError, type ContentPackage, type Slide } from "@jarvis/core";
import { describeSource, pickImage, type BrandContext, type Llm } from "@jarvis/llm";
import { download, fetchImage, framesAt, prepareSource, probe, searchImages, searchVideos } from "@jarvis/media";

/**
 * Imagem do assunto (Vader, Chapéu Seletor, padaria…): busca em banco com
 * licença livre, a IA escolhe a melhor entre as candidatas, crédito automático.
 * Sem imagem boa, o slide cai para um visual só de texto.
 */
export async function resolveImages(llm: Llm, brand: BrandContext, pkg: ContentPackage, outDir: string, relDir: string): Promise<ContentPackage> {
  const cache = new Map<string, Slide["image"] | null>();
  const slides: Slide[] = [];
  for (const [i, s] of pkg.slides.entries()) {
    const wants = s.visual === "imagem" || s.visual === "capa:img";
    if (!wants) {
      slides.push(s);
      continue;
    }
    const q = (s.imageQuery ?? "").trim().toLowerCase();
    if (s.image && s.image.path) {
      slides.push(s);
      continue;
    }
    let image = q ? cache.get(q) : null;
    if (q && image === undefined) {
      image = null;
      const work = await mkdtemp(join(tmpdir(), "jarvis-img-"));
      try {
        const cands = await searchImages(q);
        const thumbs: string[] = [];
        for (const [k, c] of cands.entries()) {
          const f = join(work, `c${k + 1}.jpg`);
          try {
            await fetchImage(c.thumb, f);
            thumbs.push(f);
          } catch {
            thumbs.push("");
          }
        }
        const valid = cands.map((c, k) => ({ c, thumb: thumbs[k]! })).filter((x) => x.thumb);
        if (valid.length) {
          const pick = await pickImage(llm, brand, q, valid.map((v) => v.thumb));
          const chosen = valid[pick.index - 1];
          if (chosen) {
            await mkdir(outDir, { recursive: true });
            const file = `imagem-${i + 1}.jpg`;
            await fetchImage(chosen.c.url, join(outDir, file));
            image = { path: `${relDir}/${file}`, credit: chosen.c.credit };
          }
        }
      } catch (err) {
        logError("produce.image", err, { pkg: pkg.id });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      cache.set(q, image);
    }
    if (image) slides.push({ ...s, image });
    else slides.push({ ...s, visual: s.visual === "capa:img" ? "capa" : "texto" });
  }
  return { ...pkg, slides };
}

export interface ReactSourceReady {
  file: string;
  durationSec: number;
  credit: string;
  url: string;
  downloadUrl?: string;
  description: string;
  moments: string;
  work: string;
}

/**
 * React: acha um vídeo de terceiro com licença livre (ou o que o Caio mandou),
 * prepara e deixa a IA "assistir" (quadros espalhados) para comentar.
 */
export async function prepareReact(
  llm: Llm,
  brand: BrandContext,
  query: string,
  ref?: { file?: string; downloadUrl?: string; credit: string; url?: string },
  opts: { describe?: boolean } = {},
): Promise<ReactSourceReady | undefined> {
  const work = await mkdtemp(join(tmpdir(), "jarvis-react-"));
  try {
    let raw: string;
    let credit: string;
    let url: string;
    let downloadUrl: string | undefined;
    if (ref?.file) {
      raw = ref.file;
      credit = ref.credit;
      url = ref.url ?? "";
    } else if (ref?.downloadUrl) {
      raw = join(work, "bruto");
      await download(ref.downloadUrl, raw);
      credit = ref.credit;
      url = ref.url ?? "";
      downloadUrl = ref.downloadUrl;
    } else {
      // Busca do mais específico ao mais amplo (o acervo livre é menor que o YouTube).
      const words = query.split(/\s+/).filter(Boolean);
      const queries = [...new Set([query, words.slice(0, 2).join(" "), words[0] ?? query].filter(Boolean))];
      let cands: Awaited<ReturnType<typeof searchVideos>> = [];
      for (const q of queries) {
        cands = await searchVideos(q);
        if (cands.length) break;
      }
      const chosen = cands[0];
      if (!chosen) {
        log("produce.react_no_source", { query });
        return undefined;
      }
      raw = join(work, "bruto");
      await download(chosen.url, raw);
      credit = chosen.credit;
      url = chosen.page;
      downloadUrl = chosen.url;
    }
    const file = join(work, "fonte.mp4");
    await prepareSource(raw, file, 120);
    const { durationSec } = await probe(file);
    // Re-render (mesmo roteiro) não precisa que a IA assista de novo.
    if (opts.describe === false) return { file, durationSec, credit, url, downloadUrl, description: "", moments: "", work };
    const times = Array.from({ length: 6 }, (_, k) => Math.max(0.2, (durationSec * (k + 0.5)) / 6));
    const frames = await framesAt(file, join(work, "quadros"), times);
    const brief = await describeSource(llm, brand, frames.map((f, k) => ({ file: f, atSec: times[k]! })), `${credit}; ${Math.round(durationSec)} s`);
    return {
      file,
      durationSec,
      credit,
      url,
      downloadUrl,
      description: brief.description,
      moments: brief.moments.map((m) => `${m.atSec.toFixed(1)} s: ${m.what}`).join("; "),
      work,
    };
  } catch (err) {
    logError("produce.react_source", err, { query });
    await rm(work, { recursive: true, force: true });
    return undefined;
  }
}
