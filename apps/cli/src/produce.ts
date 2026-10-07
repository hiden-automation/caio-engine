import { createHash, randomInt } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import { clipFrames, encodeReel, writeTrack } from "@jarvis/media";
import { allocateDay, IMPLEMENTED_FORMATS, type Slot } from "@jarvis/optimizer";
import { runGeneticTsp, SP_BAIRROS, type GaRun } from "@jarvis/sims";
import { reelTiming, renderReel, Renderer, type Look, type MediaRef, type Style } from "@jarvis/visuals";
import type { Ctx } from "./context.ts";
import { libraryCatalog, usable } from "./library.ts";

const MAX_QA_ATTEMPTS = 2;
const DEFAULT_TTL_H = 7 * 24;

/** Vaga de produção: o que o otimizador sorteou (+ direção opcional do teste em massa). */
export interface ProduceSlot extends Slot {
  style?: Style;
  brief?: string;
  /** Reel com simulação real (algoritmo genético) animada. */
  sim?: boolean;
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
  catalog: string;
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

async function render(ctx: Ctx, env: Env, pkg: ContentPackage, sim?: GaRun): Promise<Rendered> {
  if (pkg.format === "text" || !pkg.slides.length) return { pkg: { ...pkg, assets: [] }, review: [] };
  const relDir = `${pkg.createdAt.slice(0, 7)}/${pkg.id}`;
  const outDir = join(ctx.store.previewsDir, relDir);
  const tokens = await ctx.tokens();
  const look = lookFor(ctx, env, pkg);
  const assetPath = (file: string) => `${relDir}/${file.split(/[\\/]/).pop()}`;

  if (pkg.format === "slideshow") {
    const timing = reelTiming(pkg.slides);
    const work = await mkdtemp(join(tmpdir(), "jarvis-broll-"));
    try {
      // B-roll: quadros do clipe da base, do tamanho da cena que o usa.
      for (const [i, s] of pkg.slides.entries()) {
        const [kind, id] = (s.visual ?? "").split(":");
        const it = env.library.find((x) => x.id === id);
        if (kind !== "video" || !it?.derived.clip || !look.media[id!]) continue;
        const dur = timing.ends[i]! - timing.starts[i]! + 0.3;
        const start = Math.max(0, Math.min((it.durationSec ?? dur) - dur, 1));
        const frames = await clipFrames(join(ctx.libraryDir, it.derived.clip), join(work, `${i}`), start, dur);
        look.media[id!] = { ...look.media[id!]!, frames: frames.map(fileUrl) };
      }
      const audio = join(work, "trilha.wav");
      await writeTrack(audio, { seed: seedOf(pkg.id), seconds: timing.total + 0.5, energy: pkg.hookType === "choque" || sim ? "energia" : seedOf(pkg.id) % 2 ? "energia" : "calma" });
      const reel = await renderReel(env.renderer, pkg.slides, { tokens, look, outDir, prefix: "reel", sim, audio, encode: encodeReel });
      const assets: Asset[] = [
        { id: "video", kind: "video", path: assetPath(reel.video), role: "reel", order: 0, width: 1080, height: 1920, durationSec: reel.durationSec },
        { id: "img-1", kind: "image", path: assetPath(reel.cover), role: "cover", order: 1, width: 1080, height: 1920 },
      ];
      const variants = pkg.variants.map((v) => ({ ...v, assetIds: ["video", "img-1"] }));
      return { pkg: { ...pkg, assets, variants, features: { ...pkg.features, durationSec: reel.durationSec } }, review: [reel.cover, ...reel.stills] };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  const story = pkg.format === "story";
  const result = await env.renderer.render(story ? pkg.slides.slice(0, 1) : pkg.slides, {
    canvas: story ? "story" : "carousel",
    tokens,
    look,
    outDir,
    prefix: story ? "story" : "slide",
    pdf: pkg.variants.some((v) => v.kind === "document"),
    sim,
  });
  const assets: Asset[] = result.images.map((file, i) => ({
    id: `img-${i + 1}`,
    kind: "image",
    path: assetPath(file),
    role: story ? "story" : i === 0 ? "cover" : "slide",
    order: i,
    width: 1080,
    height: story ? 1920 : 1350,
  }));
  if (result.pdf) assets.push({ id: "pdf", kind: "pdf", path: assetPath(result.pdf), role: "document", order: 0 });
  const imageIds = assets.filter((a) => a.kind === "image").map((a) => a.id);
  const variants = pkg.variants.map((v) => ({
    ...v,
    assetIds: v.kind === "document" ? ["pdf"] : v.kind === "text" || v.kind === "thread" ? [] : v.platform === "x" ? imageIds.slice(0, 4) : imageIds,
  }));
  const imgs = result.images;
  const review = [...new Set([imgs[0], imgs[Math.floor(imgs.length / 2)], imgs[imgs.length - 2]].filter((x): x is string => !!x))];
  return { pkg: { ...pkg, assets, variants }, review };
}

function applyDraft(pkg: ContentPackage, draft: WriterOutput, platforms: Platform[], env: Env, forcedStyle?: Style): ContentPackage {
  const ok = new Set(env.library.filter(usable).map((i) => i.id));
  const slides = draft.slides.map((s) => {
    // Mídia inexistente/bloqueada vira o visual equivalente sem mídia.
    let visual = s.visual;
    const id = visual.split(":")[1];
    if (id && /^L\d+$/.test(id) && !ok.has(id)) visual = visual.startsWith("capa") ? "capa" : "texto";
    return { title: s.title, body: s.body, visual, ...(s.code ? { code: s.code } : {}), ...(s.durationSec > 0 ? { durationSec: s.durationSec } : {}) };
  });
  const next: ContentPackage = {
    ...pkg,
    topic: draft.topic,
    angle: draft.angle,
    hookType: draft.hookType,
    hooks: draft.hooks,
    chosenHook: draft.chosenHook,
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
  const { slot, idea } = input;
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
      library: env.catalog,
      style: slot.style,
      brief: slot.brief,
    });
    if (pkg.status === "idea") pkg = transition(pkg, "scripted", undefined, now);
    else if (pkg.status === "rendered") pkg = transition(pkg, "scripted", "reescrita pelo QA", now);
    pkg = applyDraft(pkg, draft, platforms, env, slot.style);

    const rendered = await render(ctx, env, pkg, simRun);
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
    feedback = [...issues, ...judge.issues, judge.fixInstructions].filter(Boolean).join("\n");
  }
}

/**
 * Teste em massa: cobre todos os pilares, formatos e estilos, e força o uso
 * da base (Caio, cachorro, viagens, aquário) para validar o sistema inteiro.
 */
export function testMatrix(): ProduceSlot[] {
  const s = (pillar: Pillar, format: ProduceSlot["format"], hookType: HookType, style: Style, brief: string, sim = false): ProduceSlot => ({
    pillar,
    format,
    hookType,
    style,
    brief,
    sim,
    exploration: false,
  });
  return [
    s("computacao", "carousel", "tutorial", "hud", "Automação prática para pequena empresa com código real e curto. Capa com o Caio recortado (capa:L<id>)."),
    s("computacao", "carousel", "pergunta", "quadro", "Explicar como uma LLM escolhe a próxima palavra (tokens, probabilidade, temperatura) com diagrama e gráfico."),
    s("computacao", "slideshow", "lista", "hud", "Reel: 3 automações que todo pequeno negócio deveria ter. Gancho com o Caio (capa:L<id> ou foto)."),
    s("computacao", "algoviz", "eu_fiz", "hud", "Carrossel da simulação do algoritmo genético nos bairros de SP."),
    s("computacao", "slideshow", "eu_fiz", "hud", "Reel animando a evolução do algoritmo genético nos bairros de SP (use sim:<de>-<até> em 2 ou 3 cenas).", true),
    s("computacao", "slideshow", "historia", "quadro", "Reel: como eu automatizaria meu aquário plantado (luz, CO2, temperatura, alertas). Use o vídeo do aquário da base (video:L<id>)."),
    s("computacao", "carousel", "contrarian", "post", "Opinião forte e bem argumentada sobre IA e trabalho, com slides 'post' e 'eu:L<id>'."),
    s("geek", "carousel", "pergunta", "quadro", "Geek × computação: o Chapéu Seletor é um classificador (explicar classificação de verdade)."),
    s("geek", "carousel", "choque", "hud", "Geek × negócios: dá pra construir o JARVIS do Tony Stark hoje? O que já existe e o que falta."),
    s("geek", "slideshow", "contrarian", "post", "Reel: Darth Vader seria um péssimo CEO (gestão), com humor e o Caio reagindo (eu:L<id>)."),
    s("bastidores", "carousel", "historia", "post", "Rotina de quem empreende sozinho trabalhando com automação. Use fotos reais do Caio. Sem faturamento nem número de clientes."),
    s("bastidores", "slideshow", "historia", "hud", "Reel com o cachorro do Caio como 'estagiário' do home office (humor leve). Use as fotos do cachorro."),
    s("bastidores", "story", "pergunta", "hud", "Story com foto de viagem/praia da base: pausa e pergunta para a audiência."),
    s("bastidores", "carousel", "tutorial", "quadro", "Como eu organizo a semana em sistemas (diagrama, checklist)."),
    s("jarvis", "carousel", "eu_fiz", "hud", "Diário do JARVIS: como o robô que criou este post funciona por dentro (chat eu↔jarvis, terminal, diagrama)."),
    s("jarvis", "slideshow", "choque", "hud", "Reel: meu robô errou feio hoje (humor) — use eu:L<id> com a expressão pensativa do Caio."),
    s("jarvis", "story", "pergunta", "post", "Story de bastidor do JARVIS com enquete em texto."),
    s("liberdade", "carousel", "contrarian", "post", "Burocracia para empreender no Brasil pela lente do empreendedor. Sem política partidária, sem afirmar dados sem fonte."),
    s("liberdade", "story", "historia", "quadro", "Reflexão de domingo (fé e trabalho) com foto de natureza da base."),
    s("geek", "story", "pergunta", "hud", "Story: enquete — Marvel ou Star Wars para explicar IA no próximo post?"),
  ];
}

export interface ProduceOptions {
  count?: number;
  ideaId?: string;
  /** Roda a matriz de teste (todos os formatos/estilos/pilares). */
  matrix?: boolean;
  concurrency?: number;
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
  const env: Env = {
    renderer: new Renderer(),
    library,
    catalog: libraryCatalog(library),
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
    const available = IMPLEMENTED_FORMATS.filter((f) => ctx.platforms.some((p) => KIND_BY_FORMAT[f]?.[p]));
    let slots: { slot: ProduceSlot; idea?: Idea }[];
    if (opts.ideaId) {
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
