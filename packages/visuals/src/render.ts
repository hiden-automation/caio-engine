import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { CANVAS, documentHtml, type Canvas } from "./templates.ts";
import type { VisualTokens } from "./tokens.ts";

export interface RenderResult {
  /** JPEGs na ordem dos slides (o Instagram só aceita JPEG). */
  images: string[];
  /** PDF com todos os slides (carrossel de documento no LinkedIn). */
  pdf?: string;
}

export class Renderer {
  private browser?: Browser;

  async open(): Promise<void> {
    this.browser ??= await chromium.launch();
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  async render(
    slides: Slide[],
    opts: { canvas: Canvas; tokens: VisualTokens; outDir: string; prefix: string; pdf?: boolean; sim?: GaRun },
  ): Promise<RenderResult> {
    await this.open();
    const { w, h } = CANVAS[opts.canvas];
    await mkdir(opts.outDir, { recursive: true });
    const html = documentHtml(slides, opts);
    const page = await this.browser!.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    try {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
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
      await page.close();
    }
  }

  /** Grava o HTML para inspeção/depuração (útil nos testes de snapshot). */
  static async dumpHtml(slides: Slide[], opts: { canvas: Canvas; tokens: VisualTokens; file: string; sim?: GaRun }): Promise<void> {
    await writeFile(opts.file, documentHtml(slides, opts), "utf8");
  }
}
