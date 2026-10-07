import { createHash, randomInt } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  deterministicIssues,
  log,
  logError,
  mulberry32,
  newId,
  transition,
  type Asset,
  type ContentPackage,
  type HookType,
  type Idea,
  type LibraryItem,
  type Pillar,
  type Platform,
  type Variant,
  type VariantKind,
} from "@jarvis/core";
import { judgePackage, KIND_BY_FORMAT, RefusedError, writePackage, type WriterOutput } from "@jarvis/llm";
import { clipFrames, encodeReel, framesAt, mixAudio, narrate, storyFrame, writeTrack, type AudioCue } from "@jarvis/media";
import { allocateDay, IMPLEMENTED_FORMATS, type Slot } from "@jarvis/optimizer";
import { runGeneticTsp, SP_BAIRROS, type GaRun } from "@jarvis/sims";
import { reelTiming, renderReel, Renderer, sceneDuration, type Look, type MediaRef, type Style, type VisualTokens } from "@jarvis/visuals";
import type { Ctx } from "./context.ts";
import { libraryCatalog, usable } from "./library.ts";
import { prepareReact, resolveImages, type ReactSourceReady } from "./steps.ts";

const MAX_QA_ATTEMPTS = 2;
const DEFAULT_TTL_H = 7 * 24;

/** Vaga de produção: o que o otimizador sorteou (+ direção opcional do teste em massa). */
export interface ProduceSlot extends Slot {
  style?: Style;
  brief?: string;
  /** Reel com simulação real (algoritmo genético) animada. */
  sim?: boolean;
  /** React: o que buscar de vídeo de terceiro (licença livre). */
  sourceQuery?: string;
}

function platformsFor(slot: Pick<Slot, "pillar" | "format">, allowed: Platform[], pillarPlatforms: Record<string, Platform[]>): Platform[] {
  const kinds = KIND_BY_FORMAT[slot.format] ?? {};
  return (pillarPlatforms[slot.pillar] ?? []).filter((p) => allowed.includes(p) && kinds[p]);
}

/** Resumo textual da execução real, para a narração citar números exatos. */
export function simulationSummary(run: GaRun): string {
  const km = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const checkpoints = [0, 10, 25, 50, 100, 200, run.params.generations]
    .filter((g) => g <= run.params.generations)
    .map((g) => `geração ${g}: ${km(run.history[g]!.bestKm)} km (média da população ${km(run.history[g]!.meanKm)} km)`);
  return [
    `Problema: menor rota passando uma vez por cada um dos ${run.cities.length} bairros de São Paulo e voltando ao início (caixeiro-viajante). Bairros: ${run.cities.map((c) => c.name).join(", ")}. Perdizes (onde o Caio mora) aparece destacado no mapa.`,
    `Algoritmo genético: população ${run.params.populationSize}, ${run.params.generations} gerações, torneio de ${run.params.tournamentSize}, cruzamento OX, mutação por inversão ${km(run.params.mutationRate * 100)}%, elitismo ${run.params.elitism}, seed ${run.params.seed}.`,
    `Resultado: ${km(run.history[0]!.bestKm)} km → ${km(run.history.at(-1)!.bestKm)} km (melhora de ${km(run.improvementPct)}%).`,
    `Marcos:\n${checkpoints.join("\n")}`,
    `Eventos:\n${run.events.map((e) => e.description).join("\n")}`,
    `Gerações válidas para "sim:": de 0 a ${run.params.generations}.`,
  ].join("\n\n");
}

function normalizeVariants(draft: WriterOutput, format: string, platforms: Platform[]): Variant[] {
  const kinds = KIND_BY_FORMAT[format] ?? {};
  const seen = new Set<Platform>();
  const out: Variant[] = [];
  for (const v of draft.variants) {
    if (!platforms.includes(v.platform) || seen.has(v.platform)) continue;
    seen.add(v.platform);
    const allowed = (kinds[v.platform] ?? "").split("|") as VariantKind[];
    let kind: VariantKind = allowed.includes(v.kind) ? v.kind : allowed[0]!;
    if (kind === "thread" && !v.threadParts.length) kind = "text";
    out.push({
      id: `${v.platform}-${kind}`,
      platform: v.platform,
      kind,
      caption: kind === "story" ? "" : v.caption.trim(),
      threadParts: kind === "thread" ? v.threadParts.map((t) => t.trim()).filter(Boolean) : [],
      assetIds: [],
      status: "draft",
      attempts: 0,
      aiLabel: false,
    });
  }
  // O roteirista às vezes esquece uma rede: garante uma variante por plataforma pedida.
  for (const p of platforms.filter((x) => !seen.has(x))) {
    const kind = (kinds[p] ?? "").split("|")[0] as VariantKind;
    out.push({ id: `${p}-${kind}`, platform: p, kind, caption: kind === "story" ? "" : draft.chosenHook, threadParts: [], assetIds: [], status: "draft", attempts: 0, aiLabel: false });
  }
  return out;
}

const REF = /\bL\d+\b/g;

function refsOf(pkg: Pick<ContentPackage, "slides">): string[] {
  return [...new Set(pkg.slides.flatMap((s) => (s.visual ?? "").match(REF) ?? []))];
}

interface Env {
  renderer: Renderer;
  library: LibraryItem[];
  /** Usos recentes de cada mídia (últimos pacotes + os desta rodada), para rodízio. */
  recentUses: Map<string, number>;
  avatar?: string;
}

const fileUrl = (p: string) => pathToFileURL(p).href;

function lookFor(ctx: Ctx, env: Env, pkg: ContentPackage): Look {
  const media: Record<string, MediaRef> = {};
  for (const id of pkg.libraryRefs) {
    const it = env.library.find((i) => i.id === id);
    if (!it) continue;
    media[id] = {
      photo: fileUrl(join(ctx.libraryDir, it.derived.full)),
      cutout: it.derived.cutout ? fileUrl(join(ctx.libraryDir, it.derived.cutout)) : undefined,
      focus: it.tags?.focus ?? { x: 0.5, y: 0.4 },
    };
  }
  return { style: pkg.style, pillar: pkg.pillar, series: pkg.features.series, avatar: env.avatar, media };
}

function seedOf(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32LE(0);
}

interface Rendered {
  pkg: ContentPackage;
  /** Imagens que o revisor olha (capa + amostras). */
  review: string[];
}

const clipRange = (visual = ""): [number, number] | undefined => {
  const m = visual.match(/^react:clip:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};

/** Foto do Caio para a metade de baixo do react: recorte, a menos usada. */
function reactPhoto(env: Env): string | undefined {
  const pool = env.library.filter((i) => usable(i) && i.kind === "image" && i.tags!.people === "caio");
  pool.sort((a, b) => Number(!!b.derived.cutout) - Number(!!a.derived.cutout) || (env.recentUses.get(a.id) ?? 0) - (env.recentUses.get(b.id) ?? 0));
  return pool[0]?.id;
}

interface VideoOpts {
  tokens: VisualTokens;
  outDir: string;
  prefix: string;
  forRender: (slides: ContentPackage["slides"]) => ContentPackage["slides"];
  /** Duração mínima de cada cena (story precisa de tempo para ler). */
  minScene?: number;
  seedOffset?: number;
}

/** Cenas → narração do locutor, tempo de cada cena pela fala, trilha, legenda e vídeo. */
async function videoFrom(ctx: Ctx, env: Env, pkg: ContentPackage, slides: ContentPackage["slides"], look: Look, work: string, o: VideoOpts, sim?: GaRun, react?: ReactSourceReady) {
  let libraryRefs = pkg.libraryRefs;
  // Narração do locutor: o tempo de cada cena vem da fala.
  const narr = await narrate(slides.map((sl) => (clipRange(sl.visual) ? "" : (sl.narration ?? ""))), work);
  const lead = 0.15;
  const timed = slides.map((sl, i) => {
    const range = clipRange(sl.visual);
    if (range && react) return { ...sl, durationSec: Math.max(4, Math.min(15, range[1] - range[0], react.durationSec - range[0])) };
    const n = narr[i];
    return { ...sl, durationSec: Math.max(o.minScene ?? 1.8, n ? n.durationSec + lead + 0.35 : sceneDuration(sl, i)) };
  });
  const timing = reelTiming(timed);

  // React: trecho do vídeo de terceiro (em cima) + foto do Caio (embaixo).
  const cues: AudioCue[] = [];
  if (react) {
    const firstClip = timed.find((sl) => clipRange(sl.visual));
    const startAt = clipRange(firstClip?.visual)?.[0] ?? 0;
    const [still] = await framesAt(react.file, join(work, `${o.prefix}-still`), [Math.min(startAt + 0.5, react.durationSec - 0.2)]);
    const caioId = reactPhoto(env);
    const caioItem = env.library.find((x) => x.id === caioId);
    look.react = {
      still: fileUrl(still!),
      credit: react.credit,
      clipFrames: {},
      ...(caioItem
        ? {
            caio: {
              photo: fileUrl(join(ctx.libraryDir, caioItem.derived.full)),
              cutout: caioItem.derived.cutout ? fileUrl(join(ctx.libraryDir, caioItem.derived.cutout)) : undefined,
              focus: caioItem.tags?.focus ?? { x: 0.5, y: 0.4 },
            },
          }
        : {}),
    };
    if (caioId && !libraryRefs.includes(caioId)) libraryRefs = [...libraryRefs, caioId];
    for (const [i, sl] of timed.entries()) {
      const range = clipRange(sl.visual);
      if (!range) continue;
      const dur = timing.ends[i]! - timing.starts[i]!;
      const frames = await clipFrames(react.file, join(work, `${o.prefix}-clip-${i}`), range[0], dur + 0.2);
      look.react.clipFrames[i] = frames.map(fileUrl);
      cues.push({ file: react.file, at: timing.starts[i]!, from: range[0], duration: dur, volume: 1 });
    }
  }

  // B-roll: quadros do clipe da base, do tamanho da cena que o usa.
  for (const [i, s] of timed.entries()) {
    const [kind, id] = (s.visual ?? "").split(":");
    const it = env.library.find((x) => x.id === id);
    if (kind !== "video" || !it?.derived.clip || !look.media[id!]) continue;
    const dur = timing.ends[i]! - timing.starts[i]! + 0.3;
    const start = Math.max(0, Math.min((it.durationSec ?? dur) - dur, 1));
    const frames = await clipFrames(join(ctx.libraryDir, it.derived.clip), join(work, `${o.prefix}-${i}`), start, dur);
    look.media[id!] = { ...look.media[id!]!, frames: frames.map(fileUrl) };
  }
  const music = join(work, `${o.prefix}-trilha.wav`);
  await writeTrack(music, { seed: seedOf(pkg.id) + (o.seedOffset ?? 0), seconds: timing.total + 0.5, energy: pkg.hookType === "choque" || sim ? "energia" : seedOf(pkg.id) % 2 ? "energia" : "calma" });
  const captions: Record<number, { t: number; d: number; w: string }[]> = {};
  for (const [i, n] of narr.entries()) {
    if (!n) continue;
    cues.push({ file: n.file, at: timing.starts[i]! + lead });
    captions[i] = n.words.map((w) => ({ ...w, t: w.t + lead }));
  }
  const audio = join(work, `${o.prefix}-mix.wav`);
  await mixAudio(cues, music, timing.total, audio);
  const reel = await renderReel(env.renderer, o.forRender(timed), { tokens: o.tokens, look, outDir: o.outDir, prefix: o.prefix, sim, audio, captions, encode: encodeReel });
  return { slides: timed, reel, voiced: narr.some(Boolean), libraryRefs };
}

async function render(ctx: Ctx, env: Env, pkg: ContentPackage, sim?: GaRun, react?: ReactSourceReady): Promise<Rendered> {
  if (pkg.format === "text" || !pkg.slides.length) return { pkg: { ...pkg, assets: [] }, review: [] };
  const relDir = `${pkg.createdAt.slice(0, 7)}/${pkg.id}`;
  const outDir = join(ctx.store.previewsDir, relDir);
  const tokens = await ctx.tokens();
  const look = lookFor(ctx, env, pkg);
  const assetPath = (file: string) => `${relDir}/${file.split(/[\\/]/).pop()}`;
  // Imagens do assunto ficam na pasta do pacote; o navegador do render lê por file://.
  const forRender = (slides: ContentPackage["slides"]) =>
    slides.map((sl) => (sl.image ? { ...sl, image: { ...sl.image, path: fileUrl(join(ctx.store.previewsDir, sl.image.path)) } } : sl));

  if (pkg.format === "slideshow" || pkg.format === "react") {
    const work = await mkdtemp(join(tmpdir(), "jarvis-reel-"));
    try {
      const v = await videoFrom(ctx, env, pkg, pkg.slides, look, work, { tokens, outDir, prefix: "reel", forRender }, sim, pkg.format === "react" ? react : undefined);
      pkg = { ...pkg, slides: v.slides, libraryRefs: v.libraryRefs };
      const reel = v.reel;
      const assets: Asset[] = [
        { id: "video", kind: "video", path: assetPath(reel.video), role: "reel", order: 0, width: 1080, height: 1920, durationSec: reel.durationSec },
        { id: "img-1", kind: "image", path: assetPath(reel.cover), role: "cover", order: 1, width: 1080, height: 1920 },
      ];
      const variants = pkg.variants.map((x) => ({ ...x, assetIds: ["video", "img-1"], aiLabel: v.voiced }));
      return {
        pkg: { ...pkg, assets, variants, features: { ...pkg.features, durationSec: reel.durationSec, voice: v.voiced ? "locutor" : "nenhuma" } },
        review: [reel.cover, ...reel.stills],
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  if (pkg.format === "story") {
    // Story livre: só a foto (da base ou do assunto), sem texto nenhum.
    const sl = pkg.slides[0]!;
    const [kind, id] = (sl.visual ?? "").split(":");
    const it = env.library.find((x) => x.id === id);
    // Sem foto escolhida: a foto da base menos usada.
    const spare = env.library.filter((x) => usable(x) && x.kind === "image").sort((x, y) => (env.recentUses.get(x.id) ?? 0) - (env.recentUses.get(y.id) ?? 0))[0];
    const src = kind === "foto" && it ? join(ctx.libraryDir, it.derived.full) : sl.image ? join(ctx.store.previewsDir, sl.image.path) : spare ? join(ctx.libraryDir, spare.derived.full) : undefined;
    await mkdir(outDir, { recursive: true });
    const file = join(outDir, "story-1.jpg");
    if (src) await storyFrame(src, file);
    else {
      // Base vazia: o story desenhado (texto em card), como antes.
      const r = await env.renderer.render(forRender([sl]), { canvas: "story", tokens, look, outDir, prefix: "story", pdf: false });
      await rename(r.images[0]!, file);
    }
    const assets: Asset[] = [{ id: "img-1", kind: "image", path: assetPath(file), role: "story", order: 0, width: 1080, height: 1920 }];
    return { pkg: { ...pkg, assets, variants: pkg.variants.map((x) => ({ ...x, assetIds: ["img-1"] })) }, review: [file] };
  }

  const result = await env.renderer.render(forRender(pkg.slides), {
    canvas: "carousel",
    tokens,
    look,
    outDir,
    prefix: "slide",
    pdf: pkg.variants.some((v) => v.kind === "document"),
    sim,
  });
  const assets: Asset[] = result.images.map((file, i) => ({
    id: `img-${i + 1}`,
    kind: "image",
    path: assetPath(file),
    role: i === 0 ? "cover" : "slide",
    order: i,
    width: 1080,
    height: 1350,
  }));
  if (result.pdf) assets.push({ id: "pdf", kind: "pdf", path: assetPath(result.pdf), role: "document", order: 0 });

  // Todo carrossel vira também um reel: os mesmos slides, narrados, com legenda.
  let reelVariant: ContentPackage["variants"][number] | undefined;
  const igCarousel = pkg.variants.find((v) => v.platform === "instagram" && v.kind === "carousel");
  if (igCarousel && process.env.JARVIS_CAROUSEL_REEL !== "0" && !pkg.variants.some((v) => v.kind === "reel")) {
    const work = await mkdtemp(join(tmpdir(), "jarvis-c2r-"));
    try {
      const scenes = pkg.slides.map((sl, i) => ({ ...sl, visual: "slideimg", image: { path: assetPath(result.images[i]!), credit: "" }, durationSec: 0 }));
      const v = await videoFrom(ctx, env, pkg, scenes, look, work, { tokens, outDir, prefix: "reel", forRender, minScene: 2.8 });
      assets.push(
        { id: "video", kind: "video", path: assetPath(v.reel.video), role: "reel", order: 0, width: 1080, height: 1920, durationSec: v.reel.durationSec },
        { id: "reel-capa", kind: "image", path: assetPath(v.reel.cover), role: "cover", order: 200, width: 1080, height: 1920 },
      );
      reelVariant = { ...igCarousel, id: "instagram-reel", kind: "reel", assetIds: ["video", "reel-capa"], aiLabel: v.voiced };
    } catch (err) {
      logError("produce.carousel_reel", err, { pkg: pkg.id });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  const imageIds = assets.filter((a) => a.kind === "image" && a.id !== "reel-capa").map((a) => a.id);
  const variants = pkg.variants.map((v) => ({
    ...v,
    assetIds: v.kind === "document" ? ["pdf"] : v.kind === "text" || v.kind === "thread" ? [] : v.platform === "x" ? imageIds.slice(0, 4) : imageIds,
  }));
  const imgs = result.images;
  const review = [...new Set([imgs[0], imgs[Math.floor(imgs.length / 2)], imgs[imgs.length - 2]].filter((x): x is string => !!x))];
  return { pkg: { ...pkg, assets, variants: reelVariant ? [...variants, reelVariant] : variants }, review };
}

function applyDraft(pkg: ContentPackage, draft: WriterOutput, platforms: Platform[], env: Env, forcedStyle?: Style): ContentPackage {
  const ok = new Set(env.library.filter(usable).map((i) => i.id));
  const slides = draft.slides.map((s) => {
    // Mídia inexistente/bloqueada vira o visual equivalente sem mídia.
    let visual = s.visual;
    const id = visual.split(":")[1];
    if (id && /^L\d+$/.test(id) && !ok.has(id)) visual = visual.startsWith("capa") ? "capa" : "texto";
    // React: toda cena usa a tela dividida.
    if (pkg.format === "react" && !visual.startsWith("react")) visual = visual === "cta" ? "react:cta" : "react:comentario";
    return {
      title: s.title,
      body: s.body,
      visual,
      ...(s.narration.trim() ? { narration: s.narration.trim() } : {}),
      ...(s.imageQuery.trim() ? { imageQuery: s.imageQuery.trim() } : {}),
    };
  });
  const next: ContentPackage = {
    ...pkg,
    topic: draft.topic,
    angle: draft.angle,
    hookType: draft.hookType,
    hooks: draft.hooks,
    chosenHook: draft.chosenHook,
    message: draft.message,
    style: forcedStyle ?? draft.style,
    slides,
    variants: normalizeVariants(draft, pkg.format, platforms),
    sources: [...pkg.sources, ...draft.sources.filter((s) => s.url && !pkg.sources.some((x) => x.url === s.url))],
    features: {
      ...pkg.features,
      hookType: draft.hookType,
      firstFrame: draft.firstFrame,
      ...(draft.series ? { series: draft.series } : {}),
      slideCount: slides.length,
    },
  };
  return { ...next, libraryRefs: refsOf(next) };
}

interface BuildInput {
  slot: ProduceSlot;
  idea?: Idea;
  existing?: ContentPackage;
  feedback?: string;
}

/** Roteiro → render → QA (texto + imagens), com até 2 reescritas. */
async function build(ctx: Ctx, env: Env, input: BuildInput, recentTopics: string[]): Promise<ContentPackage> {
  const strategy = await ctx.store.strategy();
  const brand = await ctx.brand();
  const llm = ctx.llm();
  const now = ctx.now;
  const { idea } = input;
  // Política/fé: sem reel (regra de marca); vira carrossel.
  const slot: ProduceSlot = input.slot.pillar === "liberdade" && input.slot.format === "slideshow" ? { ...input.slot, format: "carousel" } : input.slot;
  const platforms = platformsFor(slot, ctx.platforms, strategy.pillarPlatforms);

  let simRun: GaRun | undefined;
  let simulation = input.existing?.simulation;
  if (slot.format === "algoviz" || slot.sim || simulation) {
    simulation ??= { kind: "genetic_tsp", seed: randomInt(1, 1_000_000), generations: 300 };
    simRun = runGeneticTsp(SP_BAIRROS, { seed: simulation.seed, generations: simulation.generations });
  }

  let pkg: ContentPackage = input.existing
    ? transition(input.existing, "scripted", "reescrita a pedido do Caio", now)
    : {
        id: newId("p-", now),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        status: "idea",
        pillar: slot.pillar,
        format: slot.format,
        topic: idea?.title ?? "",
        angle: idea?.angle ?? "",
        hooks: [],
        hookType: slot.hookType,
        slides: [],
        sources: idea?.sources ?? [],
        assets: [],
        variants: [],
        qaAttempts: 0,
        express: idea?.express ?? false,
        expiresAt: idea?.expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_H * 3_600_000).toISOString(),
        editRequests: [],
        history: [],
        style: slot.style ?? "hud",
        libraryRefs: [],
        ...(idea ? { ideaId: idea.id } : {}),
        ...(simulation ? { simulation } : {}),
        features: {
          pillar: slot.pillar,
          format: slot.format,
          hookType: slot.hookType,
          firstFrame: "texto",
          voice: "nenhuma",
          trendLinked: !!idea,
        },
      };

  // React: prepara o vídeo de terceiro uma vez (a IA "assiste" antes de comentar).
  let react: ReactSourceReady | undefined;
  if (pkg.format === "react") {
    const prev = input.existing?.reactSource;
    react = await prepareReact(llm, brand, slot.sourceQuery ?? pkg.topic, prev ? { downloadUrl: prev.path, credit: prev.credit, url: prev.url } : undefined);
    if (!react) throw new Error("react sem vídeo-fonte disponível");
    pkg = { ...pkg, reactSource: { path: react.downloadUrl ?? "", credit: react.credit, url: react.url, durationSec: react.durationSec } };
    if (!pkg.sources.some((x) => x.url === react!.url)) pkg = { ...pkg, sources: [...pkg.sources, { title: `Vídeo: ${react.credit}`, url: react.url, license: "livre", credit: react.credit }] };
  }

  try {
    let feedback = input.feedback;
    for (let attempt = 0; ; attempt++) {
      const draft = await writePackage(llm, brand, {
        pillar: slot.pillar,
        format: slot.format,
        hookType: slot.hookType,
        exploration: slot.exploration,
        platforms,
        idea,
        recentTopics,
        simulationData: simRun ? simulationSummary(simRun) : undefined,
        feedback,
        previous: input.existing ?? (attempt > 0 ? pkg : undefined),
        library: libraryCatalog(env.library, env.recentUses),
        style: slot.style,
        brief: slot.brief,
        ...(react ? { reactSource: { description: react.description, durationSec: react.durationSec, credit: react.credit, moments: react.moments } } : {}),
      });
      if (pkg.status === "idea") pkg = transition(pkg, "scripted", undefined, now);
      else if (pkg.status === "rendered") pkg = transition(pkg, "scripted", "reescrita pelo QA", now);
      pkg = applyDraft(pkg, draft, platforms, env, slot.style);
      pkg = await resolveImages(llm, brand, pkg, join(ctx.store.previewsDir, pkg.createdAt.slice(0, 7), pkg.id), `${pkg.createdAt.slice(0, 7)}/${pkg.id}`);

      // Reserva já as mídias escolhidas: os pacotes em paralelo veem o rodízio na hora.
      for (const r of pkg.libraryRefs) env.recentUses.set(r, (env.recentUses.get(r) ?? 0) + 1);
      const rendered = await render(ctx, env, pkg, simRun, react);
      pkg = transition(rendered.pkg, "rendered", undefined, now);

      const issues = deterministicIssues(pkg, brand.rules);
      const judge = await judgePackage(llm, brand, pkg, rendered.review);
      const passed = !judge.blocking && judge.score >= brand.rules.minBrandScore && issues.length === 0;
      pkg = {
        ...pkg,
        qaAttempts: pkg.qaAttempts + 1,
        qa: { passed, score: judge.score, issues: [...issues, ...judge.issues], checkedAt: now.toISOString() },
      };
      log("produce.qa", { pkg: pkg.id, format: pkg.format, style: pkg.style, attempt: attempt + 1, score: judge.score, passed });

      if (passed) {
        pkg = transition(pkg, "qa_passed", undefined, now);
        return transition(pkg, "pending_review", undefined, now);
      }
      if (attempt + 1 >= MAX_QA_ATTEMPTS) return transition(pkg, "discarded", "reprovado no QA", now);
      feedback = [`O revisor entendeu esta mensagem: "${judge.messageUnderstood}" (clareza ${judge.clarity}/10).`, ...issues, ...judge.issues, judge.fixInstructions].filter(Boolean).join("\n");
    }
  } finally {
    if (react) await rm(react.work, { recursive: true, force: true });
  }
}

/**
 * Teste em massa: todos os pilares, formatos (carrossel, reel narrado, react,
 * AlgoViz, story) e estilos, com temas que exigem clareza e imagem do assunto.
 */
export function testMatrix(): ProduceSlot[] {
  const s = (pillar: Pillar, format: ProduceSlot["format"], hookType: HookType, style: Style, brief: string, extra: Partial<ProduceSlot> = {}): ProduceSlot => ({
    pillar,
    format,
    hookType,
    style,
    brief,
    exploration: false,
    ...extra,
  });
  return [
    s("computacao", "carousel", "pergunta", "quadro", "Curiosidade: a IA não entende palavras, ela transforma cada palavra numa lista de números (embeddings). Mostre a conta rei − homem + mulher ≈ rainha com o visual \"formula\" e explique por que isso funciona."),
    s("computacao", "slideshow", "choque", "hud", "Reel narrado: por que o ChatGPT às vezes inventa coisas com confiança. Ele escolhe a palavra mais provável, não a verdadeira. Termine com como se proteger disso."),
    s("computacao", "carousel", "lista", "hud", "Automação sem código: 5 tarefas de uma pequena empresa que qualquer pessoa já consegue automatizar só descrevendo para a IA. Mostre um pedido real com o visual \"prompt\". Nada de código."),
    s("computacao", "slideshow", "pergunta", "quadro", "Reel narrado: como um modelo de IA aprende errando — a função de erro e o gradiente descendente explicados como descer uma montanha no escuro, um passo de cada vez."),
    s("computacao", "algoviz", "eu_fiz", "hud", "Carrossel da simulação: o que é um algoritmo genético e por que ele achou uma rota curta entre 30 bairros de SP sem testar todas as combinações (explique a explosão combinatória)."),
    s("computacao", "slideshow", "eu_fiz", "hud", "Reel narrado mostrando a rota evoluindo (use \"sim:<de>-<até>\" em 2 cenas): seleção, cruzamento e mutação explicados em linguagem simples.", { sim: true }),
    s("computacao", "carousel", "contrarian", "post", "Opinião: saber programar deixou de ser o diferencial; saber descrever bem o problema para a IA é o novo diferencial. Use \"eu:L<id>\" e um \"prompt\" de exemplo."),
    s("computacao", "react", "choque", "hud", "React em tela dividida: comente o vídeo do robô. O que já é real, o que ainda falta e o que isso muda para quem tem uma pequena empresa.", { sourceQuery: "humanoid robot" }),
    s("computacao", "slideshow", "historia", "hud", "Reel narrado: como eu automatizaria o meu aquário plantado (luz, temperatura, alerta no celular) só descrevendo para a IA, sem programar. Use o vídeo do aquário da base (video:L<id>)."),
    s("geek", "carousel", "pergunta", "quadro", "Geek × computação: o Chapéu Seletor de Harry Potter é um classificador. Explique classificação em IA usando ele. Use imagem do Chapéu Seletor (imageQuery)."),
    s("geek", "slideshow", "contrarian", "post", "Reel narrado Geek × negócios: Darth Vader seria um péssimo CEO — 3 erros de gestão dele e a lição de cada um. Use imagem do Darth Vader (imageQuery)."),
    s("geek", "carousel", "choque", "hud", "Geek × computação: R2-D2 contra o ChatGPT — o que cada um faz de verdade e qual tecnologia de hoje se parece mais com ele. Use imagem do R2-D2 (imageQuery)."),
    s("geek", "react", "pergunta", "quadro", "React em tela dividida: comente o show de drones. Explique de forma simples como centenas de drones se coordenam sem bater (algoritmos de enxame) e onde isso é usado.", { sourceQuery: "drone light show" }),
    s("bastidores", "carousel", "historia", "post", "Como eu organizo o meu dia trabalhando sozinho com tecnologia: blocos de foco, o que eu delego para a IA e o que nunca delego. Use fotos reais do Caio. Sem números da empresa."),
    s("bastidores", "slideshow", "historia", "hud", "Reel narrado com o cachorro como o \"estagiário\" do home office: humor leve e uma lição clara sobre pausas e foco. Use as fotos do cachorro."),
    s("bastidores", "story", "pergunta", "hud", "Sequência de stories (bastidor): foto de viagem da base, o que uma pausa de verdade faz pelo trabalho de quem empreende sozinho, e a pergunta \"quando foi sua última pausa sem celular? me responde aqui\"."),
    s("liberdade", "carousel", "contrarian", "post", "O custo invisível da burocracia para quem tem pequena empresa no Brasil e o que o empreendedor consegue controlar. Sem política partidária, sem dados sem fonte."),
    s("liberdade", "story", "historia", "quadro", "Sequência de stories (reflexão de domingo): fé e trabalho bem feito mesmo quando ninguém vê, com foto de natureza da base. Curta, clara e com aplicação prática."),
    s("computacao", "story", "pergunta", "hud", "Sequência de stories (curiosidade rápida): por que a IA às vezes responde com muita certeza algo errado. Mostre um chat curto de exemplo e feche com \"já aconteceu com você? me responde aqui\"."),
    s("geek", "story", "pergunta", "quadro", "Sequência de stories (curiosidade rápida geek): dá para ter hoje um assistente como o do Homem de Ferro? O que já dá para fazer com IA e o que ainda é ficção. Use imagem do Homem de Ferro (imageQuery)."),
  ];
}

export interface ProduceOptions {
  count?: number;
  ideaId?: string;
  /** Roda a matriz de teste (todos os formatos/estilos/pilares). */
  matrix?: boolean;
  concurrency?: number;
  /** Restringe os formatos sorteados (ex.: testes sem rede). */
  formats?: ProduceSlot["format"][];
  /** Só refaz os pacotes com ajuste pedido no PWA (disparado na hora do pedido). */
  editsOnly?: boolean;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
    }),
  );
}

export async function produce(ctx: Ctx, opts: ProduceOptions = {}): Promise<{ created: number; discarded: number }> {
  await ctx.budget.assertAvailable();
  const strategy = await ctx.store.strategy();
  const all = await ctx.store.listPackages();
  const recentTopics = all
    .filter((p) => p.topic)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)
    .map((p) => p.topic);

  const library = await ctx.store.library();
  const meta = await ctx.store.libraryMeta();
  // Rodízio: o que apareceu nos 8 pacotes mais recentes da fila/agenda já conta como uso.
  const recentUses = new Map<string, number>();
  for (const p of all.filter((x) => ["pending_review", "scheduled", "published"].includes(x.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)) {
    for (const r of p.libraryRefs) recentUses.set(r, (recentUses.get(r) ?? 0) + 1);
  }
  const env: Env = {
    renderer: new Renderer(),
    library,
    recentUses,
    avatar: meta.avatar ? fileUrl(join(ctx.libraryDir, meta.avatar)) : undefined,
  };
  let created = 0;
  let discarded = 0;
  const used = new Map<string, number>();
  const save = async (pkg: ContentPackage) => {
    await ctx.store.savePackage(pkg);
    if (pkg.status === "pending_review") {
      created++;
      for (const r of pkg.libraryRefs) used.set(r, (used.get(r) ?? 0) + 1);
    } else discarded++;
  };

  try {
    // 1) Pedidos de ajuste feitos no PWA têm prioridade.
    for (const pkg of all.filter((p) => p.status === "edit_requested")) {
      try {
        const slot: ProduceSlot = { pillar: pkg.pillar, format: pkg.format, hookType: pkg.hookType, exploration: false, style: pkg.style };
        const feedback = pkg.editRequests.at(-1)?.note;
        await save(await build(ctx, env, { slot, existing: pkg, feedback }, recentTopics));
      } catch (err) {
        logError("produce.edit", err, { pkg: pkg.id });
      }
    }

    // 2) Ideias novas: expressa, matriz de teste ou a cota do dia.
    const ideas = (await ctx.store.listIdeas("new")).filter((i) => !i.expiresAt || new Date(i.expiresAt) > ctx.now);
    const available = IMPLEMENTED_FORMATS.filter((f) => ctx.platforms.some((p) => KIND_BY_FORMAT[f]?.[p]) && (!opts.formats || opts.formats.includes(f)));
    let slots: { slot: ProduceSlot; idea?: Idea }[];
    if (opts.editsOnly) {
      slots = [];
    } else if (opts.ideaId) {
      const idea = ideas.find((i) => i.id === opts.ideaId);
      if (!idea) throw new Error(`Ideia ${opts.ideaId} não encontrada ou expirada`);
      const format = available.includes(idea.suggestedFormat) ? idea.suggestedFormat : "carousel";
      slots = [{ slot: { pillar: idea.pillar, format, hookType: "choque", exploration: false }, idea }];
    } else if (opts.matrix) {
      // + 2 pacotes vindos do radar de tendências (ideias reais do dia).
      const top = process.env.JARVIS_MATRIX_ONLY ? [] : [...ideas].sort((a, b) => b.hypeScore - a.hypeScore).slice(0, 2);
      slots = [
        ...testMatrix()
          .filter((_, i) => !process.env.JARVIS_MATRIX_ONLY || process.env.JARVIS_MATRIX_ONLY.split(",").map(Number).includes(i))
          .map((slot) => ({ slot })),
        ...top.map((idea) => ({
          slot: { pillar: idea.pillar, format: available.includes(idea.suggestedFormat) ? idea.suggestedFormat : ("carousel" as const), hookType: "choque" as const, exploration: false },
          idea,
        })),
      ];
    } else {
      const rng = mulberry32(ctx.now.getTime() % 2 ** 31);
      const n = opts.count ?? Math.ceil(strategy.packagesPerDay / 2);
      const ideaPool = [...ideas].sort((a, b) => b.hypeScore - a.hypeScore);
      slots = allocateDay(strategy, rng, available, n).map((slot) => {
        if (slot.format === "algoviz") return { slot };
        const i = ideaPool.findIndex((x) => x.pillar === slot.pillar || slot.exploration);
        return { slot, idea: i >= 0 ? ideaPool.splice(i, 1)[0] : undefined };
      });
    }

    await pool(slots, opts.concurrency ?? 1, async ({ slot, idea }) => {
      if (!platformsFor(slot, ctx.platforms, strategy.pillarPlatforms).length) {
        log("produce.skip", { reason: "sem plataforma para o formato", format: slot.format, pillar: slot.pillar });
        return;
      }
      try {
        const pkg = await build(ctx, env, { slot, idea }, recentTopics);
        await save(pkg);
        recentTopics.unshift(pkg.topic);
        if (idea) await ctx.store.saveIdea({ ...idea, status: "used" });
      } catch (err) {
        if (err instanceof RefusedError) log("produce.refused", { format: slot.format, pillar: slot.pillar });
        else logError("produce.build", err, { format: slot.format, pillar: slot.pillar });
      }
    });
  } finally {
    await env.renderer.close();
  }

  // Desgaste da base: quantas vezes cada mídia já foi usada.
  if (used.size) {
    const items = await ctx.store.library();
    for (const it of items) {
      const n = used.get(it.id);
      if (n) it.usage = { count: it.usage.count + n, lastUsedAt: ctx.now.toISOString() };
    }
    await ctx.store.saveLibrary(items);
  }
  log("produce.done", { created, discarded });
  return { created, discarded };
}

/**
 * Refaz só as artes e os vídeos dos pacotes que estão na fila, com o mesmo
 * texto (sem chamar o roteirista): serve para corrigir nome, layout ou um
 * render que falhou sem perder o conteúdo aprovado pelo revisor.
 */
export async function rerender(ctx: Ctx, formats?: string[]): Promise<{ done: number; failed: number }> {
  const pending = (await ctx.store.listPackages(["pending_review"])).filter((p) => !formats?.length || formats.includes(p.format));
  const library = await ctx.store.library();
  const meta = await ctx.store.libraryMeta();
  const env: Env = {
    renderer: new Renderer(),
    library,
    recentUses: new Map(),
    avatar: meta.avatar ? fileUrl(join(ctx.libraryDir, meta.avatar)) : undefined,
  };
  const brand = await ctx.brand();
  let done = 0;
  let failed = 0;
  try {
    for (const pkg of pending) {
      let react: ReactSourceReady | undefined;
      try {
        const sim = pkg.simulation ? runGeneticTsp(SP_BAIRROS, { seed: pkg.simulation.seed, generations: pkg.simulation.generations }) : undefined;
        if (pkg.format === "react" && pkg.reactSource?.path) {
          react = await prepareReact(ctx.llm(), brand, "", { downloadUrl: pkg.reactSource.path, credit: pkg.reactSource.credit, url: pkg.reactSource.url }, { describe: false });
        }
        const r = await render(ctx, env, pkg, sim, react);
        await ctx.store.savePackage({ ...r.pkg, updatedAt: ctx.now.toISOString() });
        done++;
        log("rerender.ok", { pkg: pkg.id, format: pkg.format });
      } catch (err) {
        failed++;
        logError("rerender", err, { pkg: pkg.id });
      } finally {
        if (react) await rm(react.work, { recursive: true, force: true });
      }
    }
  } finally {
    await env.renderer.close();
  }
  log("rerender.done", { done, failed });
  return { done, failed };
}
