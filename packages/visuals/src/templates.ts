import type { Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { routeSvg } from "./sim-svg.ts";
import type { VisualTokens } from "./tokens.ts";

export type Canvas = "carousel" | "story";
export const CANVAS: Record<Canvas, { w: number; h: number }> = {
  carousel: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Escolhe o tamanho da fonte pelo comprimento do texto (auto-fit simples). */
function fit(text: string, steps: [number, number][]): number {
  const len = [...text].length;
  for (const [maxLen, size] of steps) if (len <= maxLen) return size;
  return steps[steps.length - 1]![1];
}

/** **negrito** vira destaque na cor de acento. */
function rich(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="hl">$1</strong>').replaceAll("\n", "<br>");
}

const KEYWORDS = /\b(def|return|for|in|if|else|elif|import|from|const|let|function|async|await|class|while|new|true|false|True|False|None)\b/g;

function highlight(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const e = esc(line);
      if (/^\s*(#|\/\/)/.test(line)) return `<span class="cm">${e}</span>`;
      return e.replace(KEYWORDS, '<span class="kw">$1</span>');
    })
    .join("\n");
}

export interface SlideContext {
  index: number;
  total: number;
  canvas: Canvas;
  tokens: VisualTokens;
  sim?: GaRun;
}

function body(slide: Slide, ctx: SlideContext): string {
  const [kind, arg] = (slide.visual ?? "texto").split(":");
  const title = rich(slide.title);
  const text = rich(slide.body);

  switch (kind) {
    case "capa":
      return `<div class="center">
        <div class="kicker">${esc(ctx.tokens.name)}</div>
        <h1 style="font-size:${fit(slide.title, [[40, 104], [70, 88], [110, 72], [999, 60]])}px">${title}</h1>
        ${slide.body ? `<p class="lead">${text}</p>` : ""}
      </div>`;
    case "lista": {
      const items = slide.body.split("\n").map((l) => l.replace(/^\s*[-•\d.)]+\s*/, "")).filter(Boolean);
      return `<h2>${title}</h2><ol class="list">${items.map((i) => `<li>${rich(i)}</li>`).join("")}</ol>`;
    }
    case "codigo":
      return `<h2>${title}</h2>${slide.body ? `<p class="small">${text}</p>` : ""}<pre class="code">${highlight(slide.code ?? "")}</pre>`;
    case "comparacao": {
      const [a = "", b = ""] = slide.body.split("||");
      return `<h2>${title}</h2><div class="cmp"><div class="col before"><span class="tag">antes</span>${rich(a.trim())}</div><div class="col after"><span class="tag">depois</span>${rich(b.trim())}</div></div>`;
    }
    case "numero":
      return `<div class="center"><div class="big">${title}</div><p class="lead">${text}</p></div>`;
    case "citacao":
      return `<div class="center"><div class="quote">“${title}”</div>${slide.body ? `<p class="small">${text}</p>` : ""}</div>`;
    case "cta":
      return `<div class="center"><h1 style="font-size:84px">${title}</h1><p class="lead">${text}</p><div class="handle-big">${esc(ctx.tokens.handle)}</div></div>`;
    case "sim": {
      if (!ctx.sim) return `<h2>${title}</h2><p>${text}</p>`;
      const gen = Number(arg ?? 0);
      const rec = ctx.sim.history[Math.min(gen, ctx.sim.history.length - 1)]!;
      return `<h2 style="font-size:52px">${title}</h2>
        <div class="sim">${routeSvg(ctx.sim, gen, ctx.tokens, ctx.canvas === "story" ? 900 : 760)}</div>
        <div class="stats"><span>geração <b>${rec.gen}</b></span><span>rota <b>${rec.bestKm.toLocaleString("pt-BR")} km</b></span></div>
        ${slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
    default:
      return `<h2 style="font-size:${fit(slide.title, [[50, 72], [90, 60], [999, 50]])}px">${title}</h2><p style="font-size:${fit(slide.body, [[120, 46], [220, 40], [999, 34]])}px">${text}</p>`;
  }
}

function css(t: VisualTokens, canvas: Canvas): string {
  const { w, h } = CANVAS[canvas];
  const c = t.colors;
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:${c.bg}}
  .slide{width:${w}px;height:${h}px;position:relative;overflow:hidden;background:
    radial-gradient(1200px 600px at 110% -10%, ${c.accent}22, transparent 60%),
    radial-gradient(900px 500px at -20% 120%, ${c.accent2}14, transparent 60%), ${c.bg};
    color:${c.fg};font-family:'${t.fonts.body}',system-ui,sans-serif;padding:${canvas === "story" ? "220px 96px" : "96px"};
    display:flex;flex-direction:column;gap:36px;page-break-after:always}
  .top{position:absolute;top:44px;left:96px;right:96px;display:flex;justify-content:space-between;font-family:'${t.fonts.mono}',monospace;font-size:26px;color:${c.muted}}
  .top .dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.accent};margin-right:12px;vertical-align:middle}
  .bottom{position:absolute;bottom:48px;left:96px;right:96px;display:flex;justify-content:space-between;align-items:center;font-family:'${t.fonts.mono}',monospace;font-size:26px;color:${c.muted}}
  .bar{position:absolute;bottom:0;left:0;height:10px;background:${c.accent}}
  .content{flex:1;display:flex;flex-direction:column;justify-content:center;gap:36px;padding:40px 0}
  h1,h2,.big,.quote{font-family:'${t.fonts.display}',sans-serif;letter-spacing:-0.02em;line-height:1.05}
  h2{font-size:64px}
  p{font-size:40px;line-height:1.4;color:${c.fg}}
  .lead{font-size:44px;color:${c.muted};line-height:1.35}
  .small{font-size:32px;color:${c.muted}}
  .hl{color:${c.accent};font-weight:700}
  .center{flex:1;display:flex;flex-direction:column;justify-content:center;gap:40px}
  .kicker{font-family:'${t.fonts.mono}',monospace;color:${c.accent};font-size:30px;text-transform:uppercase;letter-spacing:.2em}
  .big{font-size:220px;color:${c.accent}}
  .quote{font-size:76px}
  .list{list-style:none;counter-reset:i;display:flex;flex-direction:column;gap:30px}
  .list li{counter-increment:i;font-size:40px;line-height:1.3;padding-left:96px;position:relative}
  .list li::before{content:counter(i);position:absolute;left:0;top:-4px;width:64px;height:64px;border-radius:16px;background:${c.surface};color:${c.accent};font-family:'${t.fonts.mono}',monospace;font-size:34px;display:flex;align-items:center;justify-content:center}
  .code{background:${c.surface};border-radius:24px;padding:40px;font-family:'${t.fonts.mono}',monospace;font-size:30px;line-height:1.5;white-space:pre-wrap;color:${c.fg};border:1px solid ${c.muted}33}
  .code .kw{color:${c.accent}}.code .cm{color:${c.muted}}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:28px;min-height:420px}
  .col{background:${c.surface};border-radius:24px;padding:40px;font-size:36px;line-height:1.4}
  .col .tag{display:block;font-family:'${t.fonts.mono}',monospace;font-size:26px;text-transform:uppercase;letter-spacing:.15em;margin-bottom:24px}
  .before .tag{color:${c.danger}}.after .tag{color:${c.accent}}
  .handle-big{font-family:'${t.fonts.mono}',monospace;font-size:48px;color:${c.accent}}
  .story h2{font-size:104px !important;line-height:1.05}
  .story p{font-size:52px !important}
  .story .big{font-size:300px}
  .sim{display:flex;justify-content:center;background:${c.surface};border-radius:32px;padding:10px}
  .stats{display:flex;gap:40px;font-family:'${t.fonts.mono}',monospace;font-size:34px;color:${c.muted}}
  .stats b{color:${c.accent2}}
  `;
}

export function slideHtml(slide: Slide, ctx: SlideContext): string {
  const last = ctx.index === ctx.total - 1;
  const progress = ((ctx.index + 1) / ctx.total) * 100;
  return `<section class="slide ${ctx.canvas}">
    <div class="top"><span><span class="dot"></span>${esc(ctx.tokens.handle)}</span>${ctx.total > 1 ? `<span>${String(ctx.index + 1).padStart(2, "0")}/${String(ctx.total).padStart(2, "0")}</span>` : ""}</div>
    <div class="content">${body(slide, ctx)}</div>
    ${ctx.total > 1 && !last ? `<div class="bottom"><span></span><span>arrasta →</span></div>` : ""}
    ${ctx.total > 1 ? `<div class="bar" style="width:${progress}%"></div>` : ""}
  </section>`;
}

export function documentHtml(slides: Slide[], opts: { canvas: Canvas; tokens: VisualTokens; sim?: GaRun }): string {
  const fonts = [opts.tokens.fonts.display, opts.tokens.fonts.body, opts.tokens.fonts.mono]
    .map((f) => `family=${encodeURIComponent(f).replaceAll("%20", "+")}:wght@400;600;700`)
    .join("&");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${fonts}&display=block" rel="stylesheet">
  <style>${css(opts.tokens, opts.canvas)}</style></head><body>
  ${slides.map((s, i) => slideHtml(s, { index: i, total: slides.length, canvas: opts.canvas, tokens: opts.tokens, sim: opts.sim })).join("\n")}
  </body></html>`;
}
