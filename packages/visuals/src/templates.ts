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
}

/** O @ ainda não foi configurado (brand/visual-tokens.json): melhor não mostrar do que mostrar placeholder. */
export function handleOf(t: VisualTokens): string {
  return /seu\.handle|^@?$/.test(t.handle.trim()) ? "" : t.handle;
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
        return `<div class="cover-person">
          <img class="cutout" src="${m.cutout}" alt="">
          <div class="cover-text">
            ${ctx.look.series ? `<div class="kicker">${esc(ctx.look.series)}</div>` : ""}
            <h1 style="font-size:${size}px">${title}</h1>
            ${slide.body ? `<p class="lead">${text}</p>` : ""}
          </div></div>`;
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
    case "video": {
      // B-roll da base: no reel troca o quadro a cada frame; na arte estática vira foto.
      if (!m) break;
      const frames = m.frames?.length ? ` data-frames='${JSON.stringify(m.frames).replaceAll("'", "&#39;")}'` : "";
      return `<div class="bleed"><img class="ph" src="${m.frames?.[0] ?? m.photo}"${frames} style="${photoStyle(m)}" alt=""><div class="shade"></div></div>
        <div class="bleed-text"><h2 style="font-size:${fit(slide.title, [[40, 84], [80, 70], [999, 58]])}px">${title}</h2>${slide.body ? `<p>${text}</p>` : ""}</div>`;
    }
    case "foto": {
      if (!m) break;
      if (ctx.look.style === "hud" || story) {
        return `<div class="bleed"><img class="ph kb" src="${m.photo}" style="${photoStyle(m)}" alt=""><div class="shade"></div></div>
          <div class="bleed-text"><h2 style="font-size:${fit(slide.title, [[40, 84], [80, 70], [999, 58]])}px">${title}</h2>${slide.body ? `<p>${text}</p>` : ""}</div>`;
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
      return `<h2>${title}</h2><ol class="list">${items.map((i) => `<li>${rich(i)}</li>`).join("")}</ol>`;
    }
    case "checklist": {
      const items = lines(slide.body).map((l) => ({ ok: !l.startsWith("-"), t: l.replace(/^[+\-✓✗x]\s*/, "") }));
      return `<h2>${title}</h2><ul class="check">${items.map((i) => `<li class="${i.ok ? "ok" : "no"}"><span>${i.ok ? "✓" : "✕"}</span><div>${rich(i.t)}</div></li>`).join("")}</ul>`;
    }
    case "codigo":
      return `<h2>${title}</h2>${slide.body ? `<p class="small">${text}</p>` : ""}<div class="window"><div class="bar3"><i></i><i></i><i></i><span>${esc(arg ?? "automacao.py")}</span></div><pre class="code">${highlight(slide.code ?? "")}</pre></div>`;
    case "terminal": {
      const out = (slide.code || slide.body)
        .split("\n")
        .map((l) => (l.startsWith("$") ? `<span class="cmd">${esc(l)}</span>` : l.startsWith("✓") || l.toLowerCase().startsWith("ok") ? `<span class="okl">${esc(l)}</span>` : esc(l)))
        .join("\n");
      return `<h2>${title}</h2><div class="window term"><div class="bar3"><i></i><i></i><i></i><span>jarvis@caio ~ zsh</span></div><pre class="code">${out}<span class="caret">█</span></pre></div>${slide.code && slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
    case "chat": {
      const msgs = lines(slide.body).map((l) => {
        const [who, ...rest] = l.split(":");
        const w = (who ?? "").trim().toLowerCase();
        return { side: w === "eu" || w === "caio" ? "me" : w === "jarvis" ? "bot" : "other", who: (who ?? "").trim(), t: rest.join(":").trim() || l };
      });
      return `${slide.title ? `<h2>${title}</h2>` : ""}<div class="chat">${msgs
        .map((c) => `<div class="msg ${c.side}">${c.side === "bot" ? `<span class="who">JARVIS</span>` : c.side === "other" ? `<span class="who">${esc(c.who)}</span>` : ""}${rich(c.t)}</div>`)
        .join("")}</div>`;
    }
    case "diagrama": {
      const steps = slide.body.split(/\n|->|→/).map((s) => s.trim()).filter(Boolean);
      return `<h2>${title}</h2><div class="flow">${steps.map((s, i) => `<div class="node"><b>${String(i + 1).padStart(2, "0")}</b>${rich(s)}</div>${i < steps.length - 1 ? `<div class="arrow">↓</div>` : ""}`).join("")}</div>`;
    }
    case "grafico": {
      const rows = lines(slide.body)
        .map((l) => {
          const i = l.lastIndexOf(":");
          return { label: l.slice(0, i).trim(), value: Number(l.slice(i + 1).replace(/[^\d.,-]/g, "").replace(",", ".")), raw: l.slice(i + 1).trim() };
        })
        .filter((r) => r.label && Number.isFinite(r.value));
      const max = Math.max(1, ...rows.map((r) => r.value));
      return `<h2>${title}</h2><div class="chart">${rows
        .map((r, i) => `<div class="crow"><span class="cl">${rich(r.label)}</span><div class="ctrack"><div class="cbar${i === rows.length - 1 ? " last" : ""}" style="width:${Math.max(4, (r.value / max) * 100)}%"></div></div><span class="cv">${esc(r.raw)}</span></div>`)
        .join("")}</div>`;
    }
    case "comparacao": {
      const [a = "", b = ""] = slide.body.split("||");
      return `<h2>${title}</h2><div class="cmp"><div class="col before"><span class="tag">antes</span>${rich(a.trim())}</div><div class="col after"><span class="tag">depois</span>${rich(b.trim())}</div></div>`;
    }
    case "numero":
      return `<div class="center"><div class="big">${title}</div><p class="lead">${text}</p></div>`;
    case "citacao":
      return `<div class="center"><div class="qmark">“</div><div class="quote" style="font-size:${fit(slide.title, [[60, 76], [120, 62], [999, 52]])}px">${title}</div>${slide.body ? `<p class="small">${text}</p>` : ""}</div>`;
    case "post":
      return `<div class="center"><div class="tweet">
        <div class="tw-head">${avatarHtml(ctx, "tw-av")}<div><b>${esc(ctx.tokens.displayName)}</b>${handleOf(ctx.tokens) ? `<span>${esc(handleOf(ctx.tokens))}</span>` : ""}</div></div>
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
      return `<h2 style="font-size:${fit(slide.title, [[40, 60], [999, 50]])}px">${title}</h2>
        <div class="sim" data-sim>${routeSvg(ctx.sim, gen, ctx.tokens, story ? 900 : 760, simColors(ctx))}</div>
        <div class="stats"><span>geração <b data-gen>${rec.gen}</b></span><span>rota <b data-km>${rec.bestKm.toLocaleString("pt-BR")} km</b></span></div>
        ${slide.body ? `<p class="small">${text}</p>` : ""}`;
    }
  }
  return `<h2 style="font-size:${fit(slide.title, [[50, 72], [90, 62], [999, 52]])}px">${title}</h2><p style="font-size:${fit(slide.body, [[120, 46], [220, 40], [999, 34]])}px">${text}</p>`;
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
  ${look.style === "quadro" ? `.hl{color:${c.accent};text-decoration:underline wavy ${c.accent}88;text-underline-offset:10px;text-decoration-thickness:3px}
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
  .cover-person .cutout{position:absolute;right:-60px;bottom:0;height:${canvas === "story" ? 74 : 78}%;max-width:78%;object-fit:contain;object-position:bottom right;filter:drop-shadow(0 0 60px ${c.accent}40);-webkit-mask-image:linear-gradient(to bottom, #000 82%, transparent 100%);mask-image:linear-gradient(to bottom, #000 82%, transparent 100%)}
  .cover-person .cover-text{position:absolute;left:${pad}px;right:${pad + 120}px;top:${canvas === "story" ? 330 : 210}px;display:flex;flex-direction:column;gap:28px}
  .cover-person h1{text-shadow:0 6px 40px ${c.bg}}
  .cover-person .lead{max-width:62%;text-shadow:0 4px 24px ${c.bg}}
  .cover-photo{height:${canvas === "story" ? 820 : 560}px;flex:0 0 auto;border-radius:28px;overflow:hidden;margin-bottom:12px}
  .cover-photo .ph,.framed img{width:100%;height:100%;object-fit:cover}
  .cover-under{display:flex;flex-direction:column;gap:22px}
  .framed{flex:1;max-height:62%;border-radius:28px;overflow:hidden;border:10px solid #fff;box-shadow:0 20px 50px #0003;transform:rotate(-1.2deg)}
  .bleed{position:absolute;inset:0;z-index:0;overflow:hidden}
  .bleed .ph{width:100%;height:100%;object-fit:cover}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg, #0B0F17cc 0%, transparent 25%, transparent 45%, #0B0F17f2 85%)}
  .bleed-text{position:absolute;left:${pad}px;right:${pad}px;bottom:${canvas === "story" ? 300 : 150}px;z-index:2;display:flex;flex-direction:column;gap:22px;color:#fff}
  .bleed-text p{color:#E6EAF2}
  .talk{flex:1;position:relative;min-height:600px}
  .bubble{position:absolute;left:0;top:0;right:${canvas === "story" ? 0 : 300}px;background:${c.surface};border:2px solid ${c.accent}66;border-radius:36px;padding:36px 40px;font-size:40px;line-height:1.38;z-index:2}
  .bubble::after{content:"";position:absolute;right:120px;bottom:-30px;border:16px solid transparent;border-top:18px solid ${c.accent}66}
  .talker{-webkit-mask-image:linear-gradient(to bottom, #000 85%, transparent);mask-image:linear-gradient(to bottom, #000 85%, transparent);position:absolute;right:-${pad}px;bottom:-${canvas === "story" ? 230 : 120}px;height:${canvas === "story" ? 860 : 640}px;object-fit:contain;object-position:bottom;z-index:1}
  .talker.round{right:0;bottom:0;width:300px;height:300px;border-radius:50%;object-fit:cover;border:6px solid ${c.accent}}
  .sim{display:flex;justify-content:center;background:${c.surface};border-radius:32px;padding:10px}
  .stats{display:flex;gap:40px;font-family:'${t.fonts.mono}';font-size:34px;color:${c.muted}}
  .stats b{color:${c.accent2}}
  .story h2{font-size:96px !important;line-height:1.05}
  .story p{font-size:50px !important}
  .story .big{font-size:300px}
  `;
}

export function slideHtml(slide: Slide, ctx: SlideContext): string {
  const last = ctx.index === ctx.total - 1;
  const [kind] = (slide.visual ?? "").split(":");
  const fullBleed = kind === "video" || (kind === "foto" && (ctx.look.style === "hud" || ctx.canvas === "story"));
  const counter = ctx.total > 1 && !ctx.motion ? `<span>${String(ctx.index + 1).padStart(2, "0")}/${String(ctx.total).padStart(2, "0")}</span>` : "";
  const series = ctx.look.series && ctx.index > 0 ? `<span class="pill">${esc(ctx.look.series)}</span>` : "";
  return `<section class="slide ${ctx.canvas} ${ctx.look.style}">
    <i class="brk tl"></i><i class="brk tr"></i><i class="brk bl"></i><i class="brk br"></i>
    <div class="hdr" ${fullBleed ? 'style="color:#fff;text-shadow:0 2px 12px #000a"' : ""}>${avatarHtml(ctx)}<div class="who"><b>${esc(ctx.tokens.displayName)}</b>${handleOf(ctx.tokens) ? `<span>${esc(handleOf(ctx.tokens))}</span>` : ""}</div><div class="meta">${series}${counter}</div></div>
    <div class="content">${body(slide, ctx)}</div>
    ${!ctx.motion && ctx.total > 1 ? `<div class="foot">${last ? `<span class="sig"><i></i>feito com o meu JARVIS</span><span></span>` : `<span class="sig"><i></i>${esc(PILLAR_ACCENT[ctx.look.pillar].label)}</span><span>arrasta →</span>`}</div>` : ""}
    ${ctx.total > 1 && !ctx.motion ? `<div class="prog" style="width:${((ctx.index + 1) / ctx.total) * 100}%"></div>` : ""}
  </section>`;
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
