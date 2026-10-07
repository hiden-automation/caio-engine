import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Slide } from "@jarvis/core";
import type { GaRun } from "@jarvis/sims";
import { routeSvg } from "./sim-svg.ts";
import { CANVAS, css, fontLinks, PILLAR_ACCENT, reelCss, reelSlideHtml, simColors, type Look } from "./templates.ts";
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
// O visual do meio ocupa a faixa dele: amplia o que ficou pequeno e encolhe o que não cabe.
const fitStage=(el)=>{
  const st=el.querySelector('.r-stage'),inner=el.querySelector('.r-inner');if(!st||!inner)return;
  const S=st.clientHeight,W=st.clientWidth;
  // Medidas na tela (já com o zoom aplicado).
  const box=()=>inner.getBoundingClientRect();
  const fits=()=>{const b=box();return b.height<=S*0.94&&b.width<=W+2;};
  for(const z of [1.3,1.2,1.1,1]){inner.style.zoom=z;if(fits())return;}
  for(let n=0;n<5&&!fits();n++){inner.style.zoom=(parseFloat(inner.style.zoom)||1)*Math.min(0.97,(S*0.92)/box().height);}
};
// Fora dos reels (react): conteúdo que transborda encolhe.
const fitContent=(el)=>{
  const c=el.querySelector('.content');if(!c||el.classList.contains('fullbleed'))return;
  const r=c.getBoundingClientRect();let top=Infinity,bot=-Infinity;
  for(const k of c.children){if(getComputedStyle(k).position==='absolute')continue;const b=k.getBoundingClientRect();if(!b.height)continue;top=Math.min(top,b.top);bot=Math.max(bot,b.bottom);}
  const need=bot-top;if(isFinite(need)&&need>r.height+2){const z=(r.height/need)*0.97;for(const k of c.children)k.style.zoom=z;}
};
let fitted=false;
const ITEMS='.list li, .check li, .node, .msg, .crow, .col';
const scenes=[...document.querySelectorAll('section.slide')].map((el,i)=>{
  const big=el.querySelector('.big');
  const target=big?parseFloat(big.textContent.replace(/[^0-9.,]/g,'').replace(',','.')):NaN;
  const pb=el.querySelector('.pb-text');
  return {el,i,start:T.starts[i],end:T.ends[i],kb:el.querySelector('.ph'),frames:el.querySelector('[data-frames]'),sim:el.querySelector('[data-sim]'),stage:el.querySelector('.r-stage'),big,target,bigText:big?big.innerHTML:'',pb,pbHtml:pb?pb.innerHTML:'',pbText:pb?pb.textContent:''};
});
// Quando cada elemento aparece: manchete e blocos em sequência; itens (lista, etapas, mensagens)
// espalhados ao longo da narração, para a tela acompanhar o que está sendo falado.
const plan=(s)=>{
  const el=s.el,out=[];
  const seq=[...el.querySelectorAll('.r-head > *, .content > *:not(.bleed):not(.cover-person):not(.split):not(.credit), .cover-text > *, .bleed-text, .re-card, .re-cut, .bubble, .talker, .cutout')];
  el.querySelectorAll('.r-inner > *').forEach(b=>{if(!b.querySelector(ITEMS)&&!b.matches(ITEMS))seq.push(b);});
  seq.forEach((a,k)=>out.push([a,0.08+k*0.16]));
  const items=[...el.querySelectorAll(ITEMS)];
  const W=CAP[s.i];const endT=W&&W.length?W[W.length-1].t:0;
  const from=0.45+seq.length*0.12,span=Math.max(0.6,(endT?endT*0.82:(s.end-s.start)*0.6)-from);
  const when=new Map();items.forEach((a,k)=>{const at=from+span*k/Math.max(1,items.length);when.set(a,at);out.push([a,at]);});
  el.querySelectorAll('.arrow').forEach(a=>{let n=a.nextElementSibling;out.push([a,n&&when.has(n)?when.get(n)-0.1:from]);});
  return out;
};
scenes.forEach(s=>{s.plan=plan(s);if(s.frames){s.list=JSON.parse(s.frames.dataset.frames);}});
window.__seek=async(t,nocap)=>{
  if(!fitted){await document.fonts.ready;for(const s of scenes){const prev=s.el.style.display;s.el.style.display='flex';s.stage?fitStage(s.el):fitContent(s.el);s.el.style.display=prev;}fitted=true;}
  const waits=[];
  for(const [i,s] of scenes.entries()){
    const local=t-s.start, dur=s.end-s.start;
    const last=i===scenes.length-1;
    const vin=i===0?1:clamp(local/0.22), vout=last?1:clamp((s.end-t)/0.16);
    const on=local>=-0.01&&(last||t<s.end+0.01);
    s.el.style.display=on?'flex':'none';
    if(!on) continue;
    s.el.style.opacity=Math.min(vin,vout);
    s.el.style.transform=vin<1?'translateX('+((1-ease(vin))*60).toFixed(1)+'px)':'';
    for(const [a,at] of s.plan){const p=ease(clamp((local-at)/0.38));a.style.opacity=p;a.style.transform='translateY('+((1-p)*46).toFixed(1)+'px)';}
    // Nada fica parado: o visual do meio aproxima devagar durante a cena.
    if(s.stage)s.stage.style.transform='scale('+(1+0.045*ease(clamp(local/dur))).toFixed(4)+')';
    if(s.kb&&!s.frames){s.kb.style.transform='scale('+(1.02+0.1*clamp(local/dur)).toFixed(4)+')';}
    if(s.frames&&s.list.length){const f=s.list[Math.min(s.list.length-1,Math.max(0,Math.floor(local*${REEL_FPS})))];if(s.frames.getAttribute('src')!==f){s.frames.src=f;waits.push(s.frames.decode().catch(()=>null));}}
    if(s.sim&&SIM[i]){const fr=SIM[i];const k=Math.min(fr.svgs.length-1,Math.floor(clamp(local/(dur*0.85))*(fr.svgs.length-1)+0.0001));if(s.sim.dataset.k!==String(k)){s.sim.dataset.k=k;s.sim.innerHTML=fr.svgs[k];const g=s.el.querySelector('[data-gen]'),km=s.el.querySelector('[data-km]');if(g)g.textContent=fr.gens[k];if(km)km.textContent=fr.kms[k];}}
    if(s.big&&isFinite(s.target)&&s.target>0){const p=ease(clamp((local-0.1)/0.9));const v=s.target*p;const dec=(s.bigText.match(/[.,](\\d+)/)||[,''])[1].length;s.big.innerHTML=s.bigText.replace(/[0-9][0-9.,]*/, v.toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec}));}
    // Pedido para a IA sendo digitado.
    if(s.pb){const t0=0.5,t1=t0+Math.min(3.2,dur*0.55);if(local>=t1){if(s.pb.dataset.full!=='1'){s.pb.innerHTML=s.pbHtml;s.pb.dataset.full='1';}}else{const n=Math.floor(s.pbText.length*clamp((local-t0)/(t1-t0)));s.pb.textContent=s.pbText.slice(0,n)+'▍';s.pb.dataset.full='0';}}
  }
  const bar=document.getElementById('reel-prog');bar.style.width=(clamp(t/T.total)*100).toFixed(2)+'%';
  // Legenda sincronizada: blocos de até 3 palavras, a palavra falada em destaque.
  const cap=document.getElementById('cap');let shown=false;
  for(const [i,s] of scenes.entries()){
    const W=CAP[i];if(!W||!W.length)continue;const local=t-s.start;
    if(local<W[0].t-0.05||local>W[W.length-1].t+W[W.length-1].d+0.35)continue;
    let k=0;for(let j=0;j<W.length;j++){if(W[j].t<=local)k=j;}
    const a=Math.floor(k/3)*3;const chunk=W.slice(a,a+3);
    const html=chunk.map((w,j)=>a+j===k?'<b>'+w.w+'</b>':w.w).join(' ');
    if(cap.dataset.h!==html){cap.dataset.h=html;cap.innerHTML=html;}
    cap.className='on';shown=true;break;
  }
  if(!shown||nocap)cap.className='';
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
    .map((s, i) => reelSlideHtml(s, { index: i, total: scenes.length, canvas: "story", tokens: opts.tokens, look: opts.look, sim: opts.sim, motion: true }))
    .join("\n");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${fontLinks(opts.tokens)}
  <style>${css(opts.tokens, "story", opts.look)}${reelCss(opts.tokens, opts.look)}
  body{width:${w}px;height:${h}px;overflow:hidden;position:relative}
  section.slide{position:absolute;inset:0}
  .ph{will-change:transform}
  #reel-prog{position:absolute;top:0;left:0;height:8px;background:${"var(--accent, #3DDC97)"};z-index:20}
  /* Faixa da legenda (1420–1640 px) é só dela: manchete e visual terminam antes. */
  #cap{position:absolute;left:50%;top:1430px;transform:translateX(-50%);width:max-content;max-width:940px;z-index:30;text-align:center;
    font-family:'${opts.tokens.fonts.display}',sans-serif;font-weight:700;font-size:64px;line-height:1.18;color:#fff;opacity:0;
    background:#0B0F17d9;border-radius:26px;padding:14px 32px 18px;box-shadow:0 12px 40px #0006}
  #cap.on{opacity:1}
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
    await page.evaluate((t) => (window as unknown as { __seek: (t: number, nocap?: boolean) => Promise<void> }).__seek(t, true), Math.max(0, timing.ends[0]! - 0.3));
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
