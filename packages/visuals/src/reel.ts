import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { routeSvg } from "./sim-svg.ts";
import { CANVAS, css, fontLinks, PILLAR_ACCENT, simColors, slideHtml, type Look } from "./templates.ts";
import type { Renderer } from "./render.ts";
import type { VisualTokens } from "./tokens.ts";

export const REEL_FPS = 30;

/** Tempo de cena pelo tamanho do texto: dá para ler sem pausar o vídeo. */
export function sceneDuration(s: Slide, index: number): number {
  if (s.durationSec) return Math.max(1.5, Math.min(20, s.durationSec));
  const words = `${s.title} ${s.body}`.split(/\s+/).filter(Boolean).length;
  const d = 1.4 + words * 0.3;
  return index === 0 ? Math.min(2.6, Math.max(1.8, d)) : Math.min(6.5, Math.max(2.2, d));
}

export interface ReelTiming {
  starts: number[];
  ends: number[];
  total: number;
}

export function reelTiming(scenes: Slide[]): ReelTiming {
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (const [i, s] of scenes.entries()) {
    starts.push(t);
    t += sceneDuration(s, i);
    ends.push(t);
  }
  return { starts, ends, total: t + 0.4 };
}

/** Gerações mostradas numa cena "sim:A-B": progressão logarítmica (o começo muda mais). */
function simFrames(run: GaRun, from: number, to: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = count === 1 ? 1 : i / (count - 1);
    const g = from + (to - from) * (Math.log1p(p * 9) / Math.log(10));
    out.push(Math.round(g));
  }
  return out;
}

const ANIMATE = `
const clamp=(x)=>Math.max(0,Math.min(1,x));
const ease=(x)=>1-Math.pow(1-x,3);
const scenes=[...document.querySelectorAll('section.slide')].map((el,i)=>{
  const anim=[...el.querySelectorAll('.content > *:not(.bleed):not(.cover-person):not(.split):not(.credit), .cover-text > *, .bleed-text, .list li, .check li, .node, .arrow, .msg, .crow, .col, .bubble, .talker, .cutout, .re-card, .re-cut')];
  const big=el.querySelector('.big');
  const target=big?parseFloat(big.textContent.replace(/[^0-9.,]/g,'').replace(',','.')):NaN;
  return {el,start:T.starts[i],end:T.ends[i],anim,kb:el.querySelector('.ph'),frames:el.querySelector('[data-frames]'),sim:el.querySelector('[data-sim]'),big,target,bigText:big?big.innerHTML:''};
});
scenes.forEach(s=>{if(s.frames){s.list=JSON.parse(s.frames.dataset.frames);}});
window.__seek=async(t)=>{
  const waits=[];
  for(const [i,s] of scenes.entries()){
    const local=t-s.start, dur=s.end-s.start;
    const last=i===scenes.length-1;
    const vin=i===0?1:clamp(local/0.18), vout=last?1:clamp((s.end-t)/0.18);
    const on=local>=-0.01&&(last||t<s.end+0.01);
    s.el.style.display=on?'flex':'none';
    if(!on) continue;
    s.el.style.opacity=Math.min(vin,vout);
    s.anim.forEach((a,k)=>{const p=ease(clamp((local-0.08-k*0.14)/0.38));a.style.opacity=p;a.style.transform='translateY('+((1-p)*46).toFixed(1)+'px)';});
    if(s.kb&&!s.frames){s.kb.style.transform='scale('+(1.02+0.1*clamp(local/dur)).toFixed(4)+')';}
    if(s.frames&&s.list.length){const f=s.list[Math.min(s.list.length-1,Math.max(0,Math.floor(local*${REEL_FPS})))];if(s.frames.getAttribute('src')!==f){s.frames.src=f;waits.push(s.frames.decode().catch(()=>null));}}
    if(s.sim&&SIM[i]){const fr=SIM[i];const k=Math.min(fr.svgs.length-1,Math.floor(clamp(local/(dur*0.85))*(fr.svgs.length-1)+0.0001));if(s.sim.dataset.k!==String(k)){s.sim.dataset.k=k;s.sim.innerHTML=fr.svgs[k];const g=s.el.querySelector('[data-gen]'),km=s.el.querySelector('[data-km]');if(g)g.textContent=fr.gens[k];if(km)km.textContent=fr.kms[k];}}
    if(s.big&&isFinite(s.target)&&s.target>0){const p=ease(clamp((local-0.1)/0.9));const v=s.target*p;const dec=(s.bigText.match(/[.,](\\d+)/)||[,''])[1].length;s.big.innerHTML=s.bigText.replace(/[0-9][0-9.,]*/, v.toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec}));}
  }
  const bar=document.getElementById('reel-prog');bar.style.width=(clamp(t/T.total)*100).toFixed(2)+'%';
  // Legenda sincronizada: blocos de até 4 palavras, a palavra falada em destaque.
  const cap=document.getElementById('cap');let shown=false;
  for(const [i,s] of scenes.entries()){
    const W=CAP[i];if(!W||!W.length)continue;const local=t-s.start;
    if(local<W[0].t-0.05||local>W[W.length-1].t+W[W.length-1].d+0.35)continue;
    let k=0;for(let j=0;j<W.length;j++){if(W[j].t<=local)k=j;}
    const a=Math.floor(k/4)*4;const chunk=W.slice(a,a+4);
    const html=chunk.map((w,j)=>a+j===k?'<b>'+w.w+'</b>':w.w).join(' ');
    if(cap.dataset.h!==html){cap.dataset.h=html;cap.innerHTML=html;}
    cap.className=s.el.classList.contains('react')?'on react':'on';shown=true;break;
  }
  if(!shown)cap.className='';
  await Promise.all(waits);
};`;

export interface ReelOptions {
  tokens: VisualTokens;
  look: Look;
  outDir: string;
  prefix: string;
  sim?: GaRun;
  /** Trilha (WAV) já gerada; o vídeo sai com o tamanho do áudio ou das cenas, o menor. */
  audio?: string;
  /** Palavras narradas por cena (tempo relativo ao início da cena), para a legenda. */
  captions?: Record<number, { t: number; d: number; w: string }[]>;
  encode: (framesPattern: string, fps: number, audio: string | undefined, dst: string) => Promise<void>;
}

export interface ReelResult {
  video: string;
  cover: string;
  durationSec: number;
  /** Quadros soltos (meio de algumas cenas) para o revisor olhar. */
  stills: string[];
}

/** Reel 9:16 renderizado quadro a quadro (determinístico) e codificado em H.264. */
export async function renderReel(renderer: Renderer, scenes: Slide[], opts: ReelOptions): Promise<ReelResult> {
  const { w, h } = CANVAS.story;
  const timing = reelTiming(scenes);
  const sims: Record<number, { svgs: string[]; gens: number[]; kms: string[] }> = {};
  if (opts.sim) {
    for (const [i, s] of scenes.entries()) {
      const [kind, arg = "0"] = (s.visual ?? "").split(":");
      if (kind !== "sim") continue;
      const [a, b] = arg.includes("-") ? arg.split("-").map(Number) : [0, Number(arg)];
      const steps = Math.max(2, Math.round((timing.ends[i]! - timing.starts[i]!) * 10));
      const gens = simFrames(opts.sim, Math.max(0, a ?? 0), Math.min(opts.sim.params.generations, b ?? 0), steps);
      sims[i] = {
        gens,
        svgs: gens.map((g) => routeSvg(opts.sim!, g, opts.tokens, 900, simColors({ tokens: opts.tokens, look: opts.look }))),
        kms: gens.map((g) => `${opts.sim!.history[g]!.bestKm.toLocaleString("pt-BR")} km`),
      };
      // O HTML estático mostra a geração inicial do intervalo.
      scenes[i] = { ...s, visual: `sim:${gens[0]}` };
    }
  }
  const sections = scenes
    .map((s, i) => slideHtml(s, { index: i, total: scenes.length, canvas: "story", tokens: opts.tokens, look: opts.look, sim: opts.sim, motion: true }))
    .join("\n");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${fontLinks(opts.tokens)}
  <style>${css(opts.tokens, "story", opts.look)}
  body{width:${w}px;height:${h}px;overflow:hidden;position:relative}
  section.slide{position:absolute;inset:0}
  .ph{will-change:transform}
  #reel-prog{position:absolute;top:0;left:0;height:8px;background:${"var(--accent, #3DDC97)"};z-index:20}
  #cap{position:absolute;left:70px;right:70px;top:1440px;z-index:30;text-align:center;font-family:'${opts.tokens.fonts.display}',sans-serif;font-weight:700;font-size:58px;line-height:1.2;color:#fff;opacity:0;
    text-shadow:0 4px 0 #000,0 0 18px #000c;-webkit-text-stroke:2px #000;paint-order:stroke fill}
  #cap.on{opacity:1}#cap.react{top:880px}
  #cap b{color:${PILLAR_ACCENT[opts.look.pillar].dark}}
  </style></head><body>${sections}<div id="reel-prog"></div><div id="cap"></div>
  <script>const T=${JSON.stringify(timing)};const SIM=${JSON.stringify(sims)};const CAP=${JSON.stringify(opts.captions ?? {})};${ANIMATE}</script></body></html>`;

  await mkdir(opts.outDir, { recursive: true });
  const framesDir = await mkdtemp(join(tmpdir(), "jarvis-reel-"));
  const { page, dispose } = await renderer.page(html, w, h);
  const cover = join(opts.outDir, `${opts.prefix}-capa.jpg`);
  try {
    // A barra de progresso usa a cor do pilar.
    await page.evaluate((c) => {
      (document.getElementById("reel-prog") as HTMLElement).style.background = c;
    }, getComputedAccent(opts));
    const n = Math.ceil(timing.total * REEL_FPS);
    for (let f = 0; f < n; f++) {
      await page.evaluate((t) => (window as unknown as { __seek: (t: number) => Promise<void> }).__seek(t), f / REEL_FPS);
      await page.screenshot({ path: join(framesDir, `${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 88 });
    }
    // Capa: o gancho já montado (fim da primeira cena).
    await page.evaluate((t) => (window as unknown as { __seek: (t: number) => Promise<void> }).__seek(t), Math.max(0, timing.ends[0]! - 0.3));
    await page.screenshot({ path: cover, type: "jpeg", quality: 92 });
    const stillsDir = await mkdtemp(join(tmpdir(), "jarvis-stills-"));
    const stills: string[] = [];
    for (const i of [...new Set([1, Math.floor(scenes.length * 0.6), scenes.length - 1])].filter((i) => i > 0 && i < scenes.length)) {
      const file = join(stillsDir, `cena-${i + 1}.jpg`);
      await page.evaluate((t) => (window as unknown as { __seek: (t: number) => Promise<void> }).__seek(t), timing.ends[i]! - 0.25);
      await page.screenshot({ path: file, type: "jpeg", quality: 85 });
      stills.push(file);
    }
    const video = join(opts.outDir, `${opts.prefix}.mp4`);
    await opts.encode(join(framesDir, "%05d.jpg"), REEL_FPS, opts.audio, video);
    return { video, cover, durationSec: Math.round(timing.total * 10) / 10, stills };
  } finally {
    await dispose();
    await rm(framesDir, { recursive: true, force: true });
  }
}

function getComputedAccent(opts: ReelOptions): string {
  return simColors({ tokens: opts.tokens, look: opts.look }).line;
}
