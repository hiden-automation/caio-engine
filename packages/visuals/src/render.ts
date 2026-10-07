import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type { Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { CANVAS, documentHtml, type Canvas, type Look } from "./templates.ts";
import type { VisualTokens } from "./tokens.ts";

export interface RenderResult {
  /** JPEGs na ordem dos slides (o Instagram só aceita JPEG). */
  images: string[];
  /** PDF com todos os slides (carrossel de documento no LinkedIn). */
  pdf?: string;
}

export interface RenderOptions {
  canvas: Canvas;
  tokens: VisualTokens;
  look: Look;
  outDir: string;
  prefix: string;
  pdf?: boolean;
  sim?: GaRun;
}

export class Renderer {
  private browser?: Browser;

  async open(): Promise<Browser> {
    // Arquivo local (file://) pode carregar as fotos da base, que também são locais.
    this.browser ??= await chromium.launch({ args: ["--allow-file-access-from-files"] });
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  /** Abre um HTML gravado em disco (para as imagens file:// carregarem). */
  async page(html: string, w: number, h: number): Promise<{ page: Page; dispose: () => Promise<void> }> {
    const browser = await this.open();
    const dir = await mkdtemp(join(tmpdir(), "jarvis-render-"));
    const file = join(dir, "index.html");
    await writeFile(file, html, "utf8");
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
    });
    return {
      page,
      dispose: async () => {
        await page.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  async render(slides: Slide[], opts: RenderOptions): Promise<RenderResult> {
    const { w, h } = CANVAS[opts.canvas];
    await mkdir(opts.outDir, { recursive: true });
    const { page, dispose } = await this.page(documentHtml(slides, opts), w, h);
    try {
      const sections = await page.$$("section.slide");
      const images: string[] = [];
      for (const [i, el] of sections.entries()) {
        const file = join(opts.outDir, `${opts.prefix}-${String(i + 1).padStart(2, "0")}.jpg`);
        await el.screenshot({ path: file, type: "jpeg", quality: 92 });
        images.push(file);
      }
      let pdf: string | undefined;
      if (opts.pdf) {
        pdf = join(opts.outDir, `${opts.prefix}.pdf`);
        await page.pdf({ path: pdf, width: `${w}px`, height: `${h}px`, printBackground: true });
      }
      return { images, pdf };
    } finally {
      await dispose();
    }
  }

  /** Grava o HTML para inspeção/depuração (útil nos testes de snapshot). */
  static async dumpHtml(slides: Slide[], opts: { canvas: Canvas; tokens: VisualTokens; look: Look; file: string; sim?: GaRun }): Promise<void> {
    await writeFile(opts.file, documentHtml(slides, opts), "utf8");
  }
}
