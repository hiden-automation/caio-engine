import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@jarvis/core";
import { synthesize } from "@jarvis/media";
import { body, handleOf, VisualTokens, type Look } from "@jarvis/visuals";
import { libraryCatalog, usable } from "./library.ts";

const item = (id: string, over: Partial<NonNullable<LibraryItem["tags"]>> = {}): LibraryItem => ({
  id,
  raw: `raw/${id}.jpg`,
  kind: "image",
  addedAt: "2026-10-06T00:00:00Z",
  width: 1080,
  height: 1920,
  derived: { full: `derived/${id}/full.jpg`, frames: [] },
  usage: { count: 0 },
  tags: {
    description: "Caio no estúdio",
    people: "caio",
    hasDog: false,
    expression: "sério",
    setting: "estudio",
    mood: "sóbrio",
    quality: 0.9,
    political: false,
    sensitive: false,
    uses: ["avatar", "capa"],
    focus: { x: 0.5, y: 0.3 },
    ...over,
  },
});

describe("base de mídia", () => {
  it("nunca oferece ao roteirista foto com símbolo político ou dado sensível", () => {
    const items = [item("L1", { political: true }), item("L2"), item("L3", { sensitive: true }), item("L4", { quality: 0.1 })];
    expect(items.filter(usable).map((i) => i.id)).toEqual(["L2"]);
    const catalog = libraryCatalog(items);
    expect(catalog).toContain("L2");
    expect(catalog).not.toMatch(/L1|L3|L4/);
  });

  it("faz rodízio: mídia usada 2x nos pacotes recentes descansa", () => {
    const items = [item("L2"), item("L5"), item("L6")];
    const catalog = libraryCatalog(items, new Map([["L2", 2], ["L5", 1]]));
    expect(catalog).not.toContain("L2 |");
    expect(catalog.indexOf("L6")).toBeLessThan(catalog.indexOf("L5"));
  });
});

describe("identidade visual", () => {
  const look: Look = { style: "hud", pillar: "computacao", media: {} };
  const ctx = (handle: string) => ({ index: 0, total: 3, canvas: "carousel" as const, tokens: VisualTokens.parse({ handle }), look });

  it("esconde o @ enquanto ele não foi configurado", () => {
    expect(handleOf(VisualTokens.parse({ handle: "@seu.handle" }))).toBe("");
    expect(handleOf(VisualTokens.parse({ handle: "@caio.auto" }))).toBe("@caio.auto");
    expect(body({ title: "Segue", body: "", visual: "cta" }, ctx("@seu.handle"))).not.toContain("seu.handle");
  });

  it("realça código sem vazar atributos HTML no texto", () => {
    const html = body({ title: "Código", body: "", visual: "codigo", code: 'msg = f"Novo lead: {nome}"\nreturn {"ok": True}' }, ctx("@x"));
    expect(html).not.toContain('<span class="kw">class</span>');
    expect(html).not.toContain('class=&quot;');
    expect(html.match(/<span class="st">/g)?.length).toBeGreaterThan(0);
  });
});

describe("trilha própria", () => {
  it("é determinística pela seed e não estoura", () => {
    const [a] = synthesize({ seed: 42, seconds: 3 });
    const [b] = synthesize({ seed: 42, seconds: 3 });
    const [c] = synthesize({ seed: 43, seconds: 3 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.71);
  });
});

describe("narração", () => {
  it("o locutor fala siglas e nomes do jeito certo sem mudar o texto da tela", async () => {
    const { spoken } = await import("@jarvis/media");
    expect(spoken("O ChatGPT inventa")).toBe("O Chat G P T inventa");
    expect(spoken("chat ggt")).toBe("Chat G P T");
    expect(spoken("A IA de um CEO")).toBe("A I A de um C E O");
    // A legenda volta para a escrita: "I" + "A" faladas viram "IA".
    const { writtenWords } = await import("@jarvis/media");
    const said = ["A", "I", "A", "de", "um", "C", "E", "O"].map((w, i) => ({ t: i * 0.3, d: 0.2, w }));
    const out = writtenWords("A IA de um CEO.", said);
    expect(out.map((w) => w.w)).toEqual(["A", "IA", "de", "um", "CEO"]);
    expect(out[1]).toMatchObject({ t: 0.3 });
    expect(out[1]!.d).toBeCloseTo(0.5);
  });
});
