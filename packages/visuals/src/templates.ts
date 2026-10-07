import type { Pillar, Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { routeSvg } from "./sim-svg.ts";
import type { VisualTokens } from "./tokens.ts";

export type Canvas = "carousel" | "story";
export const CANVAS: Record<Canvas, { w: number; h: number }> = {
  carousel: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

export type Style = "hud" | "post" | "quadro";

/** Cada pilar tem a sua cor: o seguidor reconhece a série pela cor. */
export const PILLAR_ACCENT: Record<Pillar, { dark: string; light: string; label: string }> = {
  computacao: { dark: "#3DDC97", light: "#0F9D63", label: "IA & automação" },
  geek: { dark: "#FFB547", light: "#C77700", label: "geek" },
  bastidores: { dark: "#FF7A59", light: "#D9482B", label: "bastidores" },
  jarvis: { dark: "#4CC9F0", light: "#0B8DB8", label: "diário do JARVIS" },
  liberdade: { dark: "#8FB0FF", light: "#3557C9", label: "liberdade" },
};

/** Mídia da base resolvida para URL local (file://) no momento do render. */
export interface MediaRef {
  photo: string;
  cutout?: string;
  focus: { x: number; y: number };
  /** Reels: quadros do b-roll (um por frame de vídeo). */
  frames?: string[];
}

export interface Look {
  style: Style;
  pillar: Pillar;
  series?: string;
  avatar?: string;
  media: Record<string, MediaRef>;
  /** React (tela dividida): vídeo de terceiro em cima, o Caio embaixo. */
  react?: {
    still: string;
    credit: string;
    /** Quadros do trecho que toca, por índice de cena. */
    clipFrames: Record<number, string[]>;
    /** Foto do Caio para a metade de baixo. */
    caio?: { photo: string; cutout?: string; focus: { x: number; y: number } };
  };
}

/** O @ ainda não foi configurado (brand/visual-tokens.json): melhor não mostrar do que mostrar placeholder. */
export function handleOf(t: VisualTokens): string {
  return /seu\.handle|^@?$/.test(t.handle.trim()) ? "" : t.handle;
}

/** Crédito numa linha: autor encurtado + licença. */
export function shortCredit(credit: string): string {
  const [who = "", lic = ""] = credit.split(" · ");
  const name = who.replace(/\s*[–—(-].*$/, "").trim() || who;
  const cut = name.length > 34 ? `${name.slice(0, 32).trim()}…` : name;
  return lic ? `${cut} · ${lic}` : cut;
}

export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Escolhe o tamanho da fonte pelo comprimento do texto (auto-fit simples). */
export function fit(text: string, steps: [number, number][]): number {
  const len = [...text].length;
  for (const [maxLen, size] of steps) if (len <= maxLen) return size;
  return steps[steps.length - 1]![1];
}

/** **negrito** vira destaque na cor do pilar. */
export function rich(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="hl">$1</strong>').replaceAll("\n", "<br>");
}

const KEYWORDS = /\b(def|return|for|in|if|else|elif|import|from|const|let|function|async|await|class|while|new|true|false|True|False|None|print)\b/g;

function highlight(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const e = esc(line);
      if (/^\s*(#|\/\/)/.test(line)) return `<span class="cm">${e}</span>`;
      return e.replace(KEYWORDS, '<span class="kw">$1</span>').replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="st">$1</span>');
    })
    .join("\n");
}

function lines(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

export interface SlideContext {
  index: number;
  total: number;
  canvas: Canvas;
  tokens: VisualTokens;
  look: Look;
  sim?: GaRun;
  /** Reels: sem cabeçalho de contagem nem "arrasta". */
  motion?: boolean;
}

function mediaFor(ctx: SlideContext, arg?: string): MediaRef | undefined {
  return arg ? ctx.look.media[arg] : undefined;
}

const BADGE = `<svg class="badge" viewBox="0 0 24 24" aria-label="verificado"><path fill="#1D9BF0" d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484z"/><path fill="#fff" d="M10.54 16.6l-3.71-3.7 1.4-1.42 2.29 2.28 5.14-5.6 1.47 1.36z"/></svg>`;

function nameHtml(ctx: SlideContext): string {
  return `${esc(ctx.tokens.displayName)}${ctx.tokens.verified ? BADGE : ""}`;
}

function avatarHtml(ctx: SlideContext, cls = "av"): string {
  if (ctx.look.avatar) return `<img class="${cls}" src="${ctx.look.avatar}" alt="">`;
  const initials = ctx.tokens.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return `<div class="${cls} mono-av">${esc(initials)}</div>`;
}

function photoStyle(m: MediaRef, zoom = 1): string {
  return `object-position:${(m.focus.x * 100).toFixed(0)}% ${(m.focus.y * 100).toFixed(0)}%;${zoom !== 1 ? `transform:scale(${zoom})` : ""}`;
}

export function body(slide: Slide, ctx: SlideContext): string {
  const [kind = "texto", arg] = (slide.visual ?? "texto").split(":");
  const title = rich(slide.title);
  const text = rich(slide.body);
  const story = ctx.canvas === "story";
  const m = mediaFor(ctx, arg);

  switch (kind) {
    case "capa": {
      const size = fit(slide.title, story ? [[30, 124], [60, 108], [100, 92], [999, 76]] : [[30, 112], [60, 96], [100, 80], [999, 66]]);
      if (m?.cutout && ctx.look.style !== "post") {
        const narrow = story ? size : fit(slide.title, [[24, 92], [45, 78], [75, 66], [999, 56]]);
        return `<div class="cover-person">
          <img class="cutout" src="${m.cutout}" alt="">
          <div class="cover-text">
            ${ctx.look.series ? `<div class="kicker">${esc(ctx.look.series)}</div>` : ""}
            <h1 style="font-size:${narrow}px">${title}</h1>
            ${slide.body ? `<p class="lead">${text}</p>` : ""}
          </div></div>`;
      }
      if (arg === "img" && slide.image) {
        return `<div class="cover-photo"><img class="ph" src="${slide.image.path}" alt=""><div class="credit in">${esc(slide.image.credit)}</div></div>
          <div class="cover-under">${ctx.look.series ? `<div class="kicker">${esc(ctx.look.series)}</div>` : ""}<h1 style="font-size:${Math.round(size * 0.82)}px">${title}</h1>${slide.body ? `<p class="lead">${text}</p>` : ""}</div>`;
      }
      if (m) {
        return `<div class="cover-photo"><img class="ph" src="${m.photo}" style="${photoStyle(m)}" alt=""></div>
          <div class="cover-under">${ctx.look.series ? `<div class="kicker">${esc(ctx.look.series)}</div>` : ""}<h1 style="font-size:${Math.round(size * 0.82)}px">${title}</h1>${slide.body ? `<p class="lead">${text}</p>` : ""}</div>`;
      }
      return `<div class="center">
        ${ctx.look.series ? `<div class="kicker">${esc(ctx.look.series)}</div>` : ""}
        <h1 style="font-size:${size}px">${title}</h1>
        ${slide.body ? `<p class="lead">${text}</p>` : ""}
      </div>`;
    }
    case "prompt":
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="promptbox"><div class="pb-head"><span class="pb-dot"></span>pedido para a IA</div><div class="pb-text">${rich(slide.body)}</div><div class="pb-send">enviar ➜</div></div>`;
    case "formula":
      return `<div class="center"><div class="formula">${rich(slide.title)}</div>${slide.body ? `<p class="lead">${text}</p>` : ""}</div>`;
    case "imagem": {
      if (!slide.image) break;
      return `<div class="bleed"><img class="ph kb" src="${slide.image.path}" alt=""><div class="shade"></div></div>
        ${cardOnPhoto(slide, title, text, [[40, 72], [80, 60], [999, 52]])}
        <div class="credit">${esc(slide.image.credit)}</div>`;
    }
    case "react": {
      const r = ctx.look.react;
      if (!r) break;
      const frames = r.clipFrames[ctx.index];
      const src = frames?.length ? `<img class="src-v" src="${frames[0]}" data-frames='${JSON.stringify(frames).replaceAll("'", "&#39;")}' alt="">` : `<img class="src-v still" src="${r.still}" alt="">`;
      const caio = r.caio?.cutout
        ? `<img class="re-cut" src="${r.caio.cutout}" alt="">`
        : r.caio
          ? `<img class="re-photo" src="${r.caio.photo}" style="${photoStyle(r.caio)}" alt="">`
          : "";
      const isCta = arg === "cta";
      return `<div class="split">
        <div class="src-area"><div class="src-bg" style="background-image:url('${r.still}')"></div>${src}<div class="src-credit">▶ ${esc(shortCredit(r.credit))}</div></div>
        <div class="me-area">${caio}${slide.title || slide.body ? `<div class="re-card${isCta ? " cta-card" : ""}">${slide.title ? `<h2>${title}</h2>` : ""}${slide.body ? `<p>${text}</p>` : ""}</div>` : ""}</div>
      </div>`;
    }
    case "video": {
      // B-roll da base: no reel troca o quadro a cada frame; na arte estática vira foto.
      if (!m) break;
      const frames = m.frames?.length ? ` data-frames='${JSON.stringify(m.frames).replaceAll("'", "&#39;")}'` : "";
      return `<div class="bleed"><img class="ph" src="${m.frames?.[0] ?? m.photo}"${frames} style="${photoStyle(m)}" alt=""><div class="shade"></div></div>
        ${cardOnPhoto(slide, title, text, [[40, 84], [80, 70], [999, 58]])}`;
    }
    case "foto": {
      if (!m) break;
      if (ctx.look.style === "hud" || story) {
        return `<div class="bleed"><img class="ph kb" src="${m.photo}" style="${photoStyle(m)}" alt=""><div class="shade"></div></div>
          ${cardOnPhoto(slide, title, text, [[40, 84], [80, 70], [999, 58]])}`;
      }
      return `<h2>${title}</h2><div class="framed"><img src="${m.photo}" style="${photoStyle(m)}" alt=""></div>${slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
    case "eu": {
      const img = m?.cutout ?? m?.photo;
      return `${slide.title ? `<h2 style="font-size:${fit(slide.title, [[40, 68], [80, 58], [999, 50]])}px">${title}</h2>` : ""}
        <div class="talk">
          ${slide.body.trim() ? `<div class="bubble">${text}</div>` : ""}
          ${img ? `<img class="talker ${m?.cutout ? "" : "round"}" src="${img}" alt="">` : avatarHtml(ctx, "talker round")}
        </div>`;
    }
    case "lista": {
      const items = lines(slide.body).map((l) => l.replace(/^[-•\d.)]+\s*/, ""));
      return `${slide.title ? `<h2>${title}</h2>` : ""}<ol class="list">${items.map((i) => `<li>${rich(i)}</li>`).join("")}</ol>`;
    }
    case "checklist": {
      const items = lines(slide.body).map((l) => ({ ok: !l.startsWith("-"), t: l.replace(/^[+\-✓✗x]\s*/, "") }));
      return `${slide.title ? `<h2>${title}</h2>` : ""}<ul class="check">${items.map((i) => `<li class="${i.ok ? "ok" : "no"}"><span>${i.ok ? "✓" : "✕"}</span><div>${rich(i.t)}</div></li>`).join("")}</ul>`;
    }
    case "codigo":
      return `${slide.title ? `<h2>${title}</h2>` : ""}${slide.body ? `<p class="small">${text}</p>` : ""}<div class="window"><div class="bar3"><i></i><i></i><i></i><span>${esc(arg ?? "automacao.py")}</span></div><pre class="code">${highlight(slide.code ?? "")}</pre></div>`;
    case "terminal": {
      const out = (slide.code || slide.body)
        .split("\n")
        .map((l) => (l.startsWith("$") ? `<span class="cmd">${esc(l)}</span>` : l.startsWith("✓") || l.toLowerCase().startsWith("ok") ? `<span class="okl">${esc(l)}</span>` : esc(l)))
        .join("\n");
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="window term"><div class="bar3"><i></i><i></i><i></i><span>jarvis@caio ~ zsh</span></div><pre class="code">${out}<span class="caret">█</span></pre></div>${slide.code && slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
    case "chat": {
      const msgs = lines(slide.body).map((l) => {
        const [who, ...rest] = l.split(":");
        const w = (who ?? "").trim().toLowerCase();
        return { side: w === "eu" || w === "caio" ? "me" : w === "ia" || w === "jarvis" || w === "chatgpt" || w === "claude" ? "bot" : "other", who: (who ?? "").trim(), t: rest.join(":").trim() || l };
      });
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="chat">${msgs
        .map((c) => `<div class="msg ${c.side}">${c.side === "bot" ? `<span class="who">IA</span>` : c.side === "other" ? `<span class="who">${esc(c.who)}</span>` : ""}${rich(c.t)}</div>`)
        .join("")}</div>`;
    }
    case "diagrama": {
      const steps = slide.body.split(/\n|->|→/).map((s) => s.trim()).filter(Boolean);
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="flow">${steps.map((s, i) => `<div class="node"><b>${String(i + 1).padStart(2, "0")}</b>${rich(s)}</div>${i < steps.length - 1 ? `<div class="arrow">↓</div>` : ""}`).join("")}</div>`;
    }
    case "grafico": {
      const rows = lines(slide.body)
        .map((l) => {
          const i = l.lastIndexOf(":");
          return { label: l.slice(0, i).trim(), value: Number(l.slice(i + 1).replace(/[^\d.,-]/g, "").replace(",", ".")), raw: l.slice(i + 1).trim() };
        })
        .filter((r) => r.label && Number.isFinite(r.value));
      const max = Math.max(1, ...rows.map((r) => r.value));
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="chart">${rows
        .map((r, i) => `<div class="crow"><span class="cl">${rich(r.label)}</span><div class="ctrack"><div class="cbar${i === rows.length - 1 ? " last" : ""}" style="width:${Math.max(4, (r.value / max) * 100)}%"></div></div><span class="cv">${esc(r.raw)}</span></div>`)
        .join("")}</div>`;
    }
    case "comparacao": {
      const side = (part: string, fallback: string) => {
        const m2 = part.trim().match(/^([^:\n]{1,32}):\s*([\s\S]*)$/);
        return m2 ? { tag: m2[1]!.trim(), text: m2[2]!.trim() } : { tag: fallback, text: part.trim() };
      };
      const [pa = "", pb = ""] = slide.body.split("||");
      const a = side(pa, "antes");
      const b = side(pb, "depois");
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="cmp"><div class="col before"><span class="tag">${esc(a.tag)}</span>${rich(a.text)}</div><div class="col after"><span class="tag">${esc(b.tag)}</span>${rich(b.text)}</div></div>`;
    }
    case "numero":
      return `<div class="center"><div class="big">${title}</div><p class="lead">${text}</p></div>`;
    case "citacao":
      return `<div class="center"><div class="qmark">“</div><div class="quote" style="font-size:${fit(slide.title, [[60, 76], [120, 62], [999, 52]])}px">${title}</div>${slide.body ? `<p class="small">${text}</p>` : ""}</div>`;
    case "post":
      return `<div class="center"><div class="tweet">
        <div class="tw-head">${avatarHtml(ctx, "tw-av")}<div><b>${nameHtml(ctx)}</b>${handleOf(ctx.tokens) ? `<span>${esc(handleOf(ctx.tokens))}</span>` : ""}</div></div>
        <div class="tw-text" style="font-size:${fit(slide.body || slide.title, [[90, 52], [180, 44], [999, 38]])}px">${rich(slide.body || slide.title)}</div>
      </div>${slide.body && slide.title ? `<p class="small center-t">${title}</p>` : ""}</div>`;
    case "cta":
      return `<div class="center cta">
        <div class="cta-av">${avatarHtml(ctx, "big-av")}</div>
        <h1 style="font-size:${fit(slide.title, [[30, 84], [60, 70], [999, 58]])}px">${title}</h1>
        ${slide.body ? `<p class="lead">${text}</p>` : ""}
        ${handleOf(ctx.tokens) ? `<div class="handle-big">${esc(handleOf(ctx.tokens))}</div>` : ""}
      </div>`;
    case "sim": {
      if (!ctx.sim) break;
      const gen = Number(arg ?? 0);
      const rec = ctx.sim.history[Math.min(gen, ctx.sim.history.length - 1)]!;
      return `${slide.title ? `<h2 style="font-size:${fit(slide.title, [[40, 60], [999, 50]])}px">${title}</h2>` : ""}
        <div class="sim" data-sim>${routeSvg(ctx.sim, gen, ctx.tokens, story ? 900 : slide.body ? 600 : 720, simColors(ctx))}</div>
        <div class="stats"><span>geração <b data-gen>${rec.gen}</b></span><span>rota <b data-km>${rec.bestKm.toLocaleString("pt-BR")} km</b></span></div>
        ${slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
  }
  return `<h2 style="font-size:${fit(slide.title, [[50, 72], [90, 62], [999, 52]])}px">${title}</h2>${slide.body ? `<p style="font-size:${fit(slide.body, [[120, 46], [220, 40], [999, 34]])}px">${text}</p>` : ""}`;
}

/** Texto sobre foto sempre num card; sem texto, sem card. */
function cardOnPhoto(slide: Slide, title: string, text: string, sizes: [number, number][]): string {
  if (!slide.title && !slide.body) return "";
  return `<div class="bleed-text">${slide.title ? `<h2 style="font-size:${fit(slide.title, sizes)}px">${title}</h2>` : ""}${slide.body ? `<p>${text}</p>` : ""}</div>`;
}

export function simColors(ctx: Pick<SlideContext, "tokens" | "look">): { line: string; dot: string; home: string } {
  const c = palette(ctx.tokens, ctx.look);
  return { line: c.accent, dot: c.fg, home: c.accent2 };
}

function palette(t: VisualTokens, look: Look) {
  const a = PILLAR_ACCENT[look.pillar];
  if (look.style === "hud") return { bg: t.colors.bg, surface: t.colors.surface, fg: t.colors.fg, muted: t.colors.muted, accent: a.dark, accent2: t.colors.accent2, danger: t.colors.danger, line: "#ffffff0d" };
  if (look.style === "post") return { bg: "#FBFAF7", surface: "#F0EEE8", fg: "#0F1419", muted: "#536471", accent: a.light, accent2: "#C77700", danger: "#D92D4A", line: "#0000000f" };
  return { bg: "#FAF7EF", surface: "#FFFFFF", fg: "#1B1F2A", muted: "#5B6372", accent: a.light, accent2: "#C77700", danger: "#D92D4A", line: "#1B1F2A14" };
}

export function css(t: VisualTokens, canvas: Canvas, look: Look): string {
  const { w, h } = CANVAS[canvas];
  const c = palette(t, look);
  const pad = canvas === "story" ? 96 : 88;
  const bgLayer =
    look.style === "hud"
      ? `linear-gradient(${c.line} 1px, transparent 1px) 0 0/54px 54px, linear-gradient(90deg, ${c.line} 1px, transparent 1px) 0 0/54px 54px,
         radial-gradient(1100px 650px at 105% -5%, ${c.accent}26, transparent 60%), radial-gradient(900px 600px at -15% 110%, ${c.accent}14, transparent 60%), ${c.bg}`
      : look.style === "quadro"
        ? `radial-gradient(${c.line} 2.2px, transparent 2.4px) 0 0/36px 36px, ${c.bg}`
        : c.bg;
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:${c.bg}}
  .slide{width:${w}px;height:${h}px;position:relative;overflow:hidden;background:${bgLayer};
    color:${c.fg};font-family:'${t.fonts.body}',system-ui,sans-serif;padding:${canvas === "story" ? 250 : 170}px ${pad}px ${canvas === "story" ? 230 : 120}px;
    display:flex;flex-direction:column;page-break-after:always}
  .hdr{position:absolute;top:${canvas === "story" ? 120 : 52}px;left:${pad}px;right:${pad}px;display:flex;align-items:center;gap:20px;z-index:5}
  .av{width:76px;height:76px;border-radius:50%;object-fit:cover;border:3px solid ${c.accent};box-shadow:0 0 0 5px ${c.accent}22}
  .mono-av{display:flex;align-items:center;justify-content:center;background:${c.surface};font-family:'${t.fonts.display}';font-weight:700;font-size:30px;color:${c.accent}}
  .who{display:flex;flex-direction:column;line-height:1.15}
  .who b{font-family:'${t.fonts.display}';font-size:31px;font-weight:700}
  .who span{font-family:'${t.fonts.mono}';font-size:24px;color:${c.muted}}
  .meta{margin-left:auto;display:flex;gap:14px;align-items:center;font-family:'${t.fonts.mono}';font-size:24px;color:${c.muted}}
  .pill{border:2px solid ${c.accent};color:${c.accent};border-radius:999px;padding:6px 16px;font-size:20px;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
  .foot{position:absolute;bottom:${canvas === "story" ? 120 : 44}px;left:${pad}px;right:${pad}px;display:flex;justify-content:space-between;align-items:center;font-family:'${t.fonts.mono}';font-size:24px;color:${c.muted};z-index:5}
  .foot .sig{display:flex;align-items:center;gap:10px}
  .foot .sig i{width:14px;height:14px;border-radius:50%;border:3px solid ${c.accent};box-shadow:0 0 12px ${c.accent}}
  .prog{position:absolute;bottom:0;left:0;height:10px;background:${c.accent};z-index:6}
  ${look.style === "hud" ? `.brk{position:absolute;width:46px;height:46px;border-color:${c.accent}88;border-style:solid;z-index:4}
  .brk.tl{top:28px;left:28px;border-width:3px 0 0 3px}.brk.tr{top:28px;right:28px;border-width:3px 3px 0 0}
  .brk.bl{bottom:28px;left:28px;border-width:0 0 3px 3px}.brk.br{bottom:28px;right:28px;border-width:0 3px 3px 0}` : ".brk{display:none}"}
  .content{flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px;position:relative}
  h1,h2,.big,.quote{font-family:'${t.fonts.display}',sans-serif;letter-spacing:-0.025em;line-height:1.04;font-weight:700}
  h2{font-size:62px}
  p{font-size:40px;line-height:1.42}
  .lead{font-size:42px;color:${c.muted};line-height:1.35}
  .small{font-size:32px;color:${c.muted};line-height:1.4}
  .hl{color:${c.accent};font-weight:700}
  ${look.style === "post" ? `.hl{color:inherit;background:linear-gradient(transparent 55%, ${c.accent}40 55%);padding:0 4px}` : ""}
  ${look.style === "quadro" ? `.hl{color:inherit;background:linear-gradient(100deg, transparent 2%, ${c.accent}33 4%, ${c.accent}40 96%, transparent 98%);padding:0 6px;border-radius:6px}
  .kicker,.lead,.small,.foot{font-family:'Caveat',cursive !important}.lead{font-size:52px}.small{font-size:42px}.kicker{font-size:48px !important;letter-spacing:0 !important;text-transform:none !important}` : ""}
  .center{flex:1;display:flex;flex-direction:column;justify-content:center;gap:38px}
  .kicker{font-family:'${t.fonts.mono}';color:${c.accent};font-size:28px;text-transform:uppercase;letter-spacing:.2em;font-weight:700}
  .big{font-size:230px;color:${c.accent};line-height:.95}
  .qmark{font-family:Georgia,serif;font-size:220px;line-height:.5;color:${c.accent};height:90px}
  .list{list-style:none;counter-reset:i;display:flex;flex-direction:column;gap:30px}
  .list li{counter-increment:i;font-size:40px;line-height:1.3;padding-left:96px;position:relative}
  .list li::before{content:counter(i);position:absolute;left:0;top:-6px;width:66px;height:66px;border-radius:18px;background:${c.accent};color:${look.style === "hud" ? c.bg : "#fff"};font-family:'${t.fonts.mono}';font-weight:700;font-size:34px;display:flex;align-items:center;justify-content:center}
  .check{list-style:none;display:flex;flex-direction:column;gap:26px}
  .check li{font-size:40px;line-height:1.3;display:flex;gap:24px;align-items:flex-start}
  .check li span{flex:0 0 58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700}
  .check .ok span{background:${c.accent}26;color:${c.accent}}.check .no span{background:${c.danger}22;color:${c.danger}}
  .window{background:${look.style === "hud" ? c.surface : "#0F1420"};border-radius:24px;overflow:hidden;border:1px solid ${c.muted}33;box-shadow:0 30px 60px #0005}
  .bar3{display:flex;gap:10px;align-items:center;padding:18px 22px;background:#ffffff08;border-bottom:1px solid #ffffff10}
  .bar3 i{width:16px;height:16px;border-radius:50%;background:#FF5F57}.bar3 i:nth-child(2){background:#FEBC2E}.bar3 i:nth-child(3){background:#28C840}
  .bar3 span{margin-left:12px;font-family:'${t.fonts.mono}';font-size:22px;color:#8A94A6}
  .code{padding:34px 36px;font-family:'${t.fonts.mono}';font-size:29px;line-height:1.5;white-space:pre-wrap;color:#E6EAF2}
  .code .kw{color:${PILLAR_ACCENT[look.pillar].dark}}.code .cm{color:#6B7689}.code .st{color:#FFB547}
  .term .cmd{color:${PILLAR_ACCENT[look.pillar].dark}}.term .okl{color:#3DDC97}.caret{color:${PILLAR_ACCENT[look.pillar].dark}}
  .chat{display:flex;flex-direction:column;gap:22px}
  .msg{max-width:80%;padding:24px 30px;border-radius:30px;font-size:36px;line-height:1.35}
  .msg .who{display:block;font-family:'${t.fonts.mono}';font-size:20px;letter-spacing:.12em;margin-bottom:8px;opacity:.75}
  .msg.me{align-self:flex-end;background:${c.accent};color:${look.style === "hud" ? c.bg : "#fff"};border-bottom-right-radius:8px}
  .msg.me .hl{color:inherit;background:none;text-decoration:underline;text-underline-offset:6px}
  .msg.bot,.msg.other{align-self:flex-start;background:${c.surface};border:1px solid ${c.muted}33;border-bottom-left-radius:8px}
  .msg.bot .who{color:${c.accent}}
  .flow{display:flex;flex-direction:column;align-items:stretch;gap:4px}
  .node{background:${c.surface};border:2px solid ${c.accent}55;border-radius:22px;padding:22px 28px;font-size:34px;line-height:1.3;display:flex;gap:22px;align-items:center}
  .node b{font-family:'${t.fonts.mono}';color:${c.accent};font-size:28px}
  .arrow{text-align:center;color:${c.accent};font-size:40px;line-height:1}
  .chart{display:flex;flex-direction:column;gap:30px}
  .crow{display:grid;grid-template-columns:280px 1fr 150px;gap:20px;align-items:center;font-size:32px}
  .ctrack{height:46px;background:${c.surface};border-radius:12px;overflow:hidden}
  .cbar{height:100%;background:${c.muted}88;border-radius:12px}.cbar.last{background:${c.accent}}
  .cv{font-family:'${t.fonts.mono}';text-align:right;color:${c.accent};font-weight:700}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:26px;min-height:420px}
  .col{background:${c.surface};border-radius:24px;padding:38px;font-size:35px;line-height:1.4}
  .col .tag{display:block;font-family:'${t.fonts.mono}';font-size:24px;text-transform:uppercase;letter-spacing:.15em;margin-bottom:22px;font-weight:700}
  .before .tag{color:${c.danger}}.after .tag{color:${c.accent}}.after{border:2px solid ${c.accent}66}
  .tweet{background:${look.style === "hud" ? c.surface : "#fff"};border:1px solid ${c.muted}33;border-radius:32px;padding:44px;box-shadow:0 20px 50px #0000001f}
  .tw-head{display:flex;gap:20px;align-items:center;margin-bottom:28px}
  .tw-head b{display:block;font-size:32px;font-family:'${t.fonts.display}'}.tw-head span{font-size:26px;color:${c.muted}}
  .tw-av{width:88px;height:88px;border-radius:50%;object-fit:cover}
  .tw-text{line-height:1.38}
  .center-t{text-align:center}
  .cta{align-items:center;text-align:center}
  .big-av{width:230px;height:230px;border-radius:50%;object-fit:cover;border:6px solid ${c.accent};box-shadow:0 0 0 14px ${c.accent}1f,0 0 80px ${c.accent}55}
  .big-av.mono-av{font-size:80px}
  .handle-big{font-family:'${t.fonts.mono}';font-size:46px;color:${c.accent};font-weight:700}
  .cover-person{position:absolute;inset:0;z-index:1}
  .cover-person .cutout{position:absolute;right:-30px;bottom:0;height:${canvas === "story" ? 44 : 80}%;max-width:${canvas === "story" ? 80 : 50}%;object-fit:contain;object-position:bottom right;filter:drop-shadow(0 0 60px ${c.accent}40);-webkit-mask-image:linear-gradient(to bottom, #000 82%, transparent 100%);mask-image:linear-gradient(to bottom, #000 82%, transparent 100%)}
  .cover-person .cover-text{position:absolute;left:${pad}px;${canvas === "story" ? `right:${pad}px;top:300px` : `width:54%;top:0;bottom:0;justify-content:center`};display:flex;flex-direction:column;gap:28px;z-index:2}
  .cover-person h1{text-shadow:0 6px 40px ${c.bg}}
  .cover-person .lead{text-shadow:0 4px 24px ${c.bg}}
  .cover-photo{height:${canvas === "story" ? 820 : 560}px;flex:0 0 auto;border-radius:28px;overflow:hidden;margin-bottom:12px}
  .cover-photo .ph,.framed img{width:100%;height:100%;object-fit:cover}
  .cover-under{display:flex;flex-direction:column;gap:22px}
  .framed{flex:0 0 auto;height:${canvas === "story" ? 900 : 620}px;border-radius:28px;overflow:hidden;border:10px solid #fff;box-shadow:0 20px 50px #0003;transform:rotate(-1.2deg)}
  .bleed{position:absolute;inset:0;z-index:0;overflow:hidden}
  .fullbleed .content{position:static}
  .bleed .ph{width:100%;height:100%;object-fit:cover}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg, #0B0F17d9 0%, #0B0F1740 14%, transparent 28%)}
  .bleed-text{position:absolute;left:${pad}px;right:${pad}px;bottom:${canvas === "story" ? 300 : 130}px;z-index:2;display:flex;flex-direction:column;gap:18px;
    background:${look.style === "hud" ? "#0F1520ee" : "#FFFFFFf2"};color:${c.fg};border-radius:32px;padding:40px 44px;box-shadow:0 24px 60px #0007;border:1px solid ${c.accent}40}
  .bleed-text p{color:${c.fg};opacity:.9}
  .talk{flex:1;position:relative;min-height:600px}
  .bubble{position:absolute;left:0;top:0;right:${canvas === "story" ? 0 : 300}px;background:${c.surface};border:2px solid ${c.accent}66;border-radius:36px;padding:36px 40px;font-size:40px;line-height:1.38;z-index:2}
  .bubble::after{content:"";position:absolute;right:120px;bottom:-30px;border:16px solid transparent;border-top:18px solid ${c.accent}66}
  .talker{-webkit-mask-image:linear-gradient(to bottom, #000 85%, transparent);mask-image:linear-gradient(to bottom, #000 85%, transparent);position:absolute;right:-${pad}px;bottom:-${canvas === "story" ? 230 : 120}px;height:${canvas === "story" ? 860 : 640}px;object-fit:contain;object-position:bottom;z-index:1}
  .talker.round{right:0;bottom:0;width:300px;height:300px;border-radius:50%;object-fit:cover;border:6px solid ${c.accent}}
  .hdr.on-photo{color:#fff;background:#0B0F17b3;border-radius:999px;padding:10px 26px 10px 10px;right:auto;max-width:calc(100% - ${pad * 2}px)}
  .hdr.on-photo .who span{color:#C9D1DE}
  .hdr.on-photo .meta{display:none}
  .badge{width:.9em;height:.9em;margin-left:8px;vertical-align:-0.1em}
  .cover-photo{position:relative}
  .credit.in{top:16px;right:16px;bottom:auto}
  .credit{position:absolute;right:${pad}px;top:${canvas === "story" ? 230 : 150}px;font-family:'${t.fonts.mono}';font-size:18px;color:#fff;background:#0009;padding:4px 10px;border-radius:8px;z-index:6;max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .promptbox{background:${look.style === "hud" ? c.surface : "#fff"};border:2px solid ${c.accent}66;border-radius:28px;padding:30px 34px;box-shadow:0 20px 50px #0003}
  .pb-head{display:flex;align-items:center;gap:12px;font-family:'${t.fonts.mono}';font-size:22px;color:${c.muted};text-transform:uppercase;letter-spacing:.1em;margin-bottom:18px}
  .pb-dot{width:14px;height:14px;border-radius:50%;background:${c.accent}}
  .pb-text{font-size:36px;line-height:1.45}
  .pb-send{margin-top:22px;margin-left:auto;width:max-content;background:${c.accent};color:${look.style === "hud" ? c.bg : "#fff"};font-weight:700;border-radius:999px;padding:10px 24px;font-size:24px}
  .formula{font-family:'${t.fonts.mono}';font-size:62px;line-height:1.3;font-weight:700;color:${c.fg};background:${look.style === "hud" ? c.surface : "#fff"};border:2px solid ${c.accent}55;border-radius:28px;padding:40px;text-align:center}
  .formula .hl{color:${c.accent}}
  .split{position:absolute;inset:0;display:flex;flex-direction:column}
  .src-area{position:relative;height:50%;overflow:hidden;background:#000;border-bottom:6px solid ${c.accent}}
  .src-bg{position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(30px) brightness(.5)}
  .src-v{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);width:100%;height:auto;max-height:100%;object-fit:contain}
  .src-v.still{filter:brightness(.55)}
  .src-credit{white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis;position:absolute;left:24px;bottom:20px;font-family:'${t.fonts.mono}';font-size:22px;color:#fff;background:#000a;padding:6px 14px;border-radius:10px}
  .me-area{position:relative;height:50%;overflow:hidden}
  .re-cut{position:absolute;right:-30px;bottom:0;height:94%;max-width:52%;object-fit:contain;object-position:bottom right;-webkit-mask-image:linear-gradient(to bottom,#000 85%,transparent);mask-image:linear-gradient(to bottom,#000 85%,transparent)}
  .re-photo{position:absolute;right:0;top:0;bottom:0;width:46%;height:100%;object-fit:cover;-webkit-mask-image:linear-gradient(to right,transparent,#000 22%);mask-image:linear-gradient(to right,transparent,#000 22%)}
  .re-card{position:absolute;left:${pad}px;width:54%;top:60px;background:${look.style === "hud" ? "#0F1520ee" : "#FFFFFFf2"};border:1px solid ${c.accent}55;border-radius:28px;padding:30px 34px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px #0007}
  .re-card h2{font-size:58px !important}.re-card p{font-size:38px !important;opacity:.9}
  .react .hdr{display:none}
  .sim{display:flex;justify-content:center;background:${c.surface};border-radius:32px;padding:10px}
  .stats{display:flex;gap:40px;font-family:'${t.fonts.mono}';font-size:34px;color:${c.muted}}
  .stats b{color:${c.accent2}}
  .story h2{font-size:100px !important;line-height:1.04}
  .story p{font-size:54px !important;line-height:1.38}
  .story .big{font-size:320px}
  .story .content{justify-content:center;gap:48px}
  .story .list li,.story .check li{font-size:54px}
  .story .list li{padding-left:110px}.story .list li::before{width:80px;height:80px;font-size:40px}
  .story .check li span{flex-basis:72px;height:72px}
  .story .node{font-size:46px;padding:30px 34px}
  .story .msg{font-size:48px;max-width:86%}
  .story .bubble{font-size:52px;right:0}
  .story .col{font-size:44px}
  .story .tw-text{font-size:60px !important}
  .story .code{font-size:34px}
  .story .crow{grid-template-columns:300px 1fr 170px;font-size:40px}
  .story .ctrack{height:60px}
  .story .big-av{width:320px;height:320px}
  .story .lead{font-size:56px}
  `;
}

export function slideHtml(slide: Slide, ctx: SlideContext): string {
  const last = ctx.index === ctx.total - 1;
  const [kind] = (slide.visual ?? "").split(":");
  const fullBleed = kind === "video" || kind === "imagem" || (kind === "foto" && (ctx.look.style === "hud" || ctx.canvas === "story"));
  const counter = ctx.total > 1 && !ctx.motion ? `<span>${String(ctx.index + 1).padStart(2, "0")}/${String(ctx.total).padStart(2, "0")}</span>` : "";
  const series = ctx.look.series && ctx.index > 0 ? `<span class="pill">${esc(ctx.look.series)}</span>` : "";
  const isReact = kind === "react";
  return `<section class="slide ${ctx.canvas} ${ctx.look.style}${fullBleed || isReact ? " fullbleed" : ""}${isReact ? " react" : ""}">
    <i class="brk tl"></i><i class="brk tr"></i><i class="brk bl"></i><i class="brk br"></i>
    <div class="hdr${fullBleed ? " on-photo" : ""}">${avatarHtml(ctx)}<div class="who"><b>${nameHtml(ctx)}</b>${handleOf(ctx.tokens) ? `<span>${esc(handleOf(ctx.tokens))}</span>` : ""}</div><div class="meta">${series}${counter}</div></div>
    <div class="content">${body(slide, ctx)}</div>
    ${!ctx.motion && ctx.total > 1 ? `<div class="foot">${last ? `<span class="sig"><i></i>${esc(handleOf(ctx.tokens) || ctx.tokens.displayName)}</span><span>salva pra depois</span>` : `<span class="sig"><i></i>${esc(PILLAR_ACCENT[ctx.look.pillar].label)}</span><span>arrasta →</span>`}</div>` : ""}
    ${ctx.total > 1 && !ctx.motion ? `<div class="prog" style="width:${((ctx.index + 1) / ctx.total) * 100}%"></div>` : ""}
  </section>`;
}

/**
 * Cena de vídeo (reel e story) em três faixas que nunca se cruzam:
 * manchete no topo, o visual no meio ocupando a área e a base livre para a legenda.
 */
export function reelSlideHtml(slide: Slide, ctx: SlideContext): string {
  const [kind = "texto", arg] = (slide.visual ?? "texto").split(":");
  if (kind === "react") return slideHtml(slide, ctx);
  if (kind === "slideimg" && slide.image) {
    // Carrossel virando reel: o slide inteiro no alto, fundo desfocado dele mesmo, base livre para a legenda.
    return `<section class="slide ${ctx.canvas} ${ctx.look.style} rs fullbleed">
      <div class="bleed"><img class="rs-blur" src="${slide.image.path}" alt=""></div>
      <div class="r-stage rs-slide"><img src="${slide.image.path}" alt=""></div>
    </section>`;
  }
  const m = mediaFor(ctx, arg);
  const demo = (s: Slide) => body({ ...s, title: "" }, ctx);
  const bigAvatar = `<div class="r-ava">${avatarHtml(ctx, "big-av")}${handleOf(ctx.tokens) ? `<div class="handle-big">${esc(handleOf(ctx.tokens))}</div>` : ""}</div>`;
  const backdrop = (src: string, style = "", frames = "") =>
    `<div class="bleed"><img class="ph kb" src="${src}"${frames} style="${style}" alt=""><div class="r-shade"></div></div>`;
  let head = slide.title;
  let sub = slide.body;
  let stage = "";
  let bg = "";
  const textStage = () => {
    stage = sub ? `<div class="r-say">${rich(sub)}</div>` : bigAvatar;
    sub = "";
  };

  switch (kind) {
    case "capa":
      if (m?.cutout) stage = `<img class="r-cutout" src="${m.cutout}" alt="">`;
      else if (arg === "img" && slide.image) bg = backdrop(slide.image.path) + `<div class="credit">${esc(slide.image.credit)}</div>`;
      else if (m) bg = backdrop(m.photo, photoStyle(m));
      else stage = bigAvatar;
      break;
    case "imagem":
      if (slide.image) bg = backdrop(slide.image.path) + `<div class="credit">${esc(slide.image.credit)}</div>`;
      else textStage();
      break;
    case "foto":
      if (m) bg = backdrop(m.photo, photoStyle(m));
      else textStage();
      break;
    case "video":
      if (m) bg = backdrop(m.frames?.[0] ?? m.photo, photoStyle(m), m.frames?.length ? ` data-frames='${JSON.stringify(m.frames).replaceAll("'", "&#39;")}'` : "");
      else textStage();
      break;
    case "formula":
      head = slide.body;
      sub = "";
      stage = `<div class="formula">${rich(slide.title)}</div>`;
      break;
    case "numero":
      head = slide.body;
      sub = "";
      stage = `<div class="big">${rich(slide.title)}</div>`;
      break;
    case "citacao":
      head = "";
      stage = `<div class="qmark">“</div><div class="quote">${rich(slide.title)}</div>${sub ? `<p class="small">${rich(sub)}</p>` : ""}`;
      sub = "";
      break;
    case "cta":
      head = "";
      sub = "";
      stage = body(slide, ctx);
      break;
    case "sim":
      stage = demo({ ...slide, body: "" });
      break;
    case "prompt":
    case "chat":
    case "diagrama":
    case "grafico":
    case "comparacao":
    case "lista":
    case "checklist":
    case "codigo":
    case "terminal":
    case "post":
    case "eu":
      stage = demo(slide);
      sub = "";
      break;
    default:
      textStage();
  }
  const headHtml = head
    ? `<div class="r-head${bg ? " card" : ""}"><h2 style="--hs:${fit(head, [[18, 104], [36, 90], [60, 76], [999, 64]])}px">${rich(head)}</h2>${sub ? `<p>${rich(sub)}</p>` : ""}</div>`
    : "";
  return `<section class="slide ${ctx.canvas} ${ctx.look.style} rs${bg ? " fullbleed" : ""}${head ? "" : " nohead"}">
    <i class="brk tl"></i><i class="brk tr"></i><i class="brk bl"></i><i class="brk br"></i>
    ${bg}
    <div class="hdr${bg ? " on-photo" : ""}">${avatarHtml(ctx)}<div class="who"><b>${nameHtml(ctx)}</b>${handleOf(ctx.tokens) ? `<span>${esc(handleOf(ctx.tokens))}</span>` : ""}</div><div class="meta">${ctx.look.series && ctx.index > 0 ? `<span class="pill">${esc(ctx.look.series)}</span>` : ""}</div></div>
    ${headHtml}
    ${stage ? `<div class="r-stage"><div class="r-inner">${stage}</div></div>` : ""}
  </section>`;
}

/** CSS das cenas de vídeo (faixas, legenda em pílula). Vem depois do css() base. */
export function reelCss(t: VisualTokens, look: Look): string {
  const c = palette(t, look);
  const card = look.style === "hud" ? "#0F1520f0" : "#FFFFFFf4";
  return `
  .rs{padding:0 !important}
  .rs .r-head{position:absolute;left:80px;right:80px;top:230px;height:330px;display:flex;flex-direction:column;justify-content:flex-end;gap:16px;z-index:3}
  .rs .r-head h2{font-size:var(--hs) !important;line-height:1.05 !important}
  .rs .r-head p{font-size:44px !important;line-height:1.3 !important;color:${c.muted}}
  .rs .r-head.card{height:auto;justify-content:flex-start;background:${card};color:${c.fg};border-radius:34px;padding:36px 42px;border:1px solid ${c.accent}40;box-shadow:0 24px 60px #0007}
  .rs .r-head.card p{color:${c.fg};opacity:.85}
  .rs .r-stage{position:absolute;left:72px;right:72px;top:600px;height:770px;display:flex;align-items:center;justify-content:center;z-index:2;transform-origin:50% 50%}
  .rs.nohead .r-stage{top:250px;height:1120px}
  .rs .r-inner{width:100%;display:flex;flex-direction:column;gap:30px}
  .rs .r-inner > .center{flex:none}
  .rs .r-cutout{display:block;margin:0 auto;height:770px;max-width:100%;object-fit:contain;object-position:bottom;filter:drop-shadow(0 0 60px ${c.accent}40);-webkit-mask-image:linear-gradient(to bottom,#000 85%,transparent);mask-image:linear-gradient(to bottom,#000 85%,transparent)}
  .rs .r-say{font-family:'${t.fonts.display}',sans-serif;font-weight:700;font-size:74px;line-height:1.15;letter-spacing:-0.02em;background:${look.style === "hud" ? c.surface : "#fff"};border:2px solid ${c.accent}55;border-radius:36px;padding:56px 54px;box-shadow:0 24px 60px #0003}
  .rs .r-ava{display:flex;flex-direction:column;align-items:center;gap:30px}
  .rs .r-shade{position:absolute;inset:0;background:linear-gradient(180deg,#0B0F17cc 0%,#0B0F1700 22%,#0B0F1700 62%,#0B0F17aa 100%)}
  .rs .formula{font-size:68px;text-wrap:balance}
  .rs .big{font-size:300px;text-align:center}
  .rs .quote{font-size:84px}
  .rs .talk{min-height:770px}
  .rs .talker{right:-60px;bottom:0;height:770px}
  .rs .bubble{right:300px;font-size:46px}
  .rs .credit{top:auto;bottom:240px}
  .rs .rs-blur{width:100%;height:100%;object-fit:cover;filter:blur(38px) brightness(.45);transform:scale(1.15)}
  .rs .rs-slide{top:150px;height:1230px;left:60px;right:60px}
  .rs .rs-slide img{width:100%;height:100%;object-fit:contain;border-radius:28px;box-shadow:0 30px 80px #000a;clip-path:inset(0 0 8.5% 0 round 28px)}
  .rs .pb-text{font-size:52px;line-height:1.4}.rs .pb-head{font-size:26px}.rs .pb-send{font-size:28px}
  .rs .node{font-size:52px;padding:34px 40px}.rs .node b{font-size:34px}
  .rs .msg{font-size:50px}.rs .list li,.rs .check li{font-size:58px}.rs .col{font-size:46px}
  .rs .crow{font-size:44px}
  `;
}

export function fontLinks(t: VisualTokens): string {
  const fonts = [t.fonts.display, t.fonts.body, t.fonts.mono]
    .map((f) => `family=${encodeURIComponent(f).replaceAll("%20", "+")}:wght@400;600;700`)
    .join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${fonts}&family=Caveat:wght@600;700&display=block" rel="stylesheet">`;
}

export function documentHtml(slides: Slide[], opts: { canvas: Canvas; tokens: VisualTokens; look: Look; sim?: GaRun }): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${fontLinks(opts.tokens)}
  <style>${css(opts.tokens, opts.canvas, opts.look)}</style></head><body>
  ${slides.map((s, i) => slideHtml(s, { index: i, total: slides.length, canvas: opts.canvas, tokens: opts.tokens, look: opts.look, sim: opts.sim })).join("\n")}
  </body></html>`;
}
