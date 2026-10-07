import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const UA = "caio-engine/0.1 (https://github.com/hiden-automation/caio-engine; hiden.automacao@gmail.com)";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
  return (await r.json()) as T;
}

export async function download(url: string, dst: string): Promise<void> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  await writeFile(dst, Buffer.from(await r.arrayBuffer()));
}

const LICENSE_LABEL = (l: string, v?: string) => (l === "cc0" ? "CC0" : l === "pdm" ? "domínio público" : `CC ${l.toUpperCase()}${v ? ` ${v}` : ""}`);

export interface ImageCandidate {
  url: string;
  thumb: string;
  credit: string;
  width: number;
  height: number;
}

/**
 * Imagem do assunto em bancos com licença que permite uso comercial
 * (Openverse: Flickr, Wikimedia e outros). O crédito sai pronto.
 */
export async function searchImages(query: string, limit = 6): Promise<ImageCandidate[]> {
  const q = new URLSearchParams({ q: query, license_type: "commercial", page_size: "20", mature: "false" });
  const d = await getJson<{ results: { url: string; thumbnail: string; creator?: string; license: string; license_version?: string; width?: number; height?: number; source?: string }[] }>(
    `https://api.openverse.org/v1/images/?${q}`,
  );
  return d.results
    .filter((r) => (r.width ?? 0) >= 700 && (r.height ?? 0) >= 500)
    .slice(0, limit)
    .map((r) => ({
      url: r.url,
      thumb: r.thumbnail,
      width: r.width ?? 0,
      height: r.height ?? 0,
      credit: `Foto: ${r.creator?.trim() || r.source || "autor desconhecido"} · ${LICENSE_LABEL(r.license, r.license_version)}`,
    }));
}

/** Baixa e normaliza para JPEG (lado maior ≤ 1600). */
export async function fetchImage(url: string, dst: string): Promise<void> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`imagem ${r.status}`);
  await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(dst);
}

export interface VideoCandidate {
  url: string;
  page: string;
  title: string;
  credit: string;
  durationSec: number;
  width: number;
  height: number;
}

/** Vídeos com licença livre (Wikimedia Commons), para o react em tela dividida. */
export async function searchVideos(query: string, limit = 8): Promise<VideoCandidate[]> {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `filetype:video ${query}`,
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  const d = await getJson<{ query?: { pages: Record<string, { title: string; imageinfo: { url: string; descriptionurl: string; width: number; height: number; duration?: number; extmetadata?: Record<string, { value: string }> }[] }> } }>(
    `https://commons.wikimedia.org/w/api.php?${q}`,
  );
  const strip = (h = "") => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return Object.values(d.query?.pages ?? {})
    .map((p) => {
      const ii = p.imageinfo[0]!;
      const m = ii.extmetadata ?? {};
      return {
        url: ii.url,
        page: ii.descriptionurl,
        title: p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
        credit: `${strip(m.Artist?.value) || "Wikimedia Commons"} · ${strip(m.LicenseShortName?.value) || "licença livre"}`.slice(0, 90),
        durationSec: ii.duration ?? 0,
        width: ii.width,
        height: ii.height,
      };
    })
    .filter((v) => v.durationSec >= 8 && v.durationSec <= 900 && v.width >= 480)
    .sort((a, b) => b.width - a.width)
    .slice(0, limit);
}
