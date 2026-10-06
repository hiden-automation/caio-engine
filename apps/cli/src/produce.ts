import { randomInt } from "node:crypto";
import { join } from "node:path";
import {
  deterministicIssues,
  log,
  logError,
  mulberry32,
  newId,
  transition,
  type Asset,
  type ContentPackage,
  type Idea,
  type Platform,
  type Variant,
  type VariantKind,
} from "@jarvis/core";
import { judgePackage, KIND_BY_FORMAT, RefusedError, writePackage, type WriterOutput } from "@jarvis/llm";
import { allocateDay, IMPLEMENTED_FORMATS, type Slot } from "@jarvis/optimizer";
import { runGeneticTsp, SP_BAIRROS, type GaRun } from "@jarvis/sims";
import { Renderer } from "@jarvis/visuals";
import type { Ctx } from "./context.ts";

const MAX_QA_ATTEMPTS = 2;
const DEFAULT_TTL_H = 7 * 24;

function platformsFor(slot: Pick<Slot, "pillar" | "format">, allowed: Platform[], pillarPlatforms: Record<string, Platform[]>): Platform[] {
  const kinds = KIND_BY_FORMAT[slot.format] ?? {};
  return (pillarPlatforms[slot.pillar] ?? []).filter((p) => allowed.includes(p) && kinds[p]);
}

/** Resumo textual da execução real, para a narração citar números exatos. */
export function simulationSummary(run: GaRun): string {
  const checkpoints = [0, 10, 25, 50, 100, 200, run.params.generations]
    .filter((g) => g <= run.params.generations)
    .map((g) => `geração ${g}: ${run.history[g]!.bestKm} km (média da população ${run.history[g]!.meanKm} km)`);
  return [
    `Problema: menor rota passando uma vez por cada um dos ${run.cities.length} bairros de São Paulo e voltando ao início (caixeiro-viajante). Bairros: ${run.cities.map((c) => c.name).join(", ")}. Perdizes (onde o Caio mora) aparece destacado no mapa.`,
    `Algoritmo genético: população ${run.params.populationSize}, ${run.params.generations} gerações, torneio de ${run.params.tournamentSize}, cruzamento OX, mutação por inversão ${run.params.mutationRate * 100}%, elitismo ${run.params.elitism}, seed ${run.params.seed}.`,
    `Resultado: ${run.history[0]!.bestKm} km → ${run.history.at(-1)!.bestKm} km (melhora de ${run.improvementPct}%).`,
    `Marcos:\n${checkpoints.join("\n")}`,
    `Eventos:\n${run.events.map((e) => e.description).join("\n")}`,
    `Gerações que podem virar slide com "sim:<geração>": qualquer número de 0 a ${run.params.generations}.`,
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
      caption: v.caption.trim(),
      threadParts: kind === "thread" ? v.threadParts.map((t) => t.trim()).filter(Boolean) : [],
      assetIds: [],
      status: "draft",
      attempts: 0,
      aiLabel: false,
    });
  }
  return out;
}

async function render(ctx: Ctx, renderer: Renderer, pkg: ContentPackage, sim?: GaRun): Promise<ContentPackage> {
  if (pkg.format === "text" || !pkg.slides.length) return { ...pkg, assets: [] };
  const month = pkg.createdAt.slice(0, 7);
  const relDir = `${month}/${pkg.id}`;
  const outDir = join(ctx.store.previewsDir, relDir);
  const story = pkg.format === "story";
  const needsPdf = pkg.variants.some((v) => v.kind === "document");
  const slides = story ? pkg.slides.slice(0, 1) : pkg.slides;
  const result = await renderer.render(slides, {
    canvas: story ? "story" : "carousel",
    tokens: await ctx.tokens(),
    outDir,
    prefix: story ? "story" : "slide",
    pdf: needsPdf,
    sim,
  });

  const assets: Asset[] = result.images.map((file, i) => ({
    id: `img-${i + 1}`,
    kind: "image",
    path: `${relDir}/${file.split(/[\\/]/).pop()}`,
    role: story ? "story" : i === 0 ? "cover" : "slide",
    order: i,
    width: 1080,
    height: story ? 1920 : 1350,
  }));
  if (result.pdf) assets.push({ id: "pdf", kind: "pdf", path: `${relDir}/${result.pdf.split(/[\\/]/).pop()}`, role: "document", order: 0 });

  const imageIds = assets.filter((a) => a.kind === "image").map((a) => a.id);
  const variants = pkg.variants.map((v) => ({
    ...v,
    assetIds:
      v.kind === "document" ? ["pdf"] : v.kind === "text" || v.kind === "thread" ? [] : v.platform === "x" ? imageIds.slice(0, 4) : imageIds,
  }));
  return { ...pkg, assets, variants };
}

function applyDraft(pkg: ContentPackage, draft: WriterOutput, platforms: Platform[]): ContentPackage {
  const slides = draft.slides.map((s) => ({ title: s.title, body: s.body, visual: s.visual, ...(s.code ? { code: s.code } : {}) }));
  return {
    ...pkg,
    topic: draft.topic,
    angle: draft.angle,
    hookType: draft.hookType,
    hooks: draft.hooks,
    chosenHook: draft.chosenHook,
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
}

interface BuildInput {
  slot: Slot;
  idea?: Idea;
  existing?: ContentPackage;
  feedback?: string;
}

/** Roteiro → render → QA (com até 2 reescritas). Devolve o pacote final. */
async function build(ctx: Ctx, renderer: Renderer, input: BuildInput, recentTopics: string[]): Promise<ContentPackage> {
  const strategy = await ctx.store.strategy();
  const brand = await ctx.brand();
  const llm = ctx.llm();
  const now = ctx.now;
  const { slot, idea } = input;
  const platforms = platformsFor(slot, ctx.platforms, strategy.pillarPlatforms);

  let simRun: GaRun | undefined;
  let simulation = input.existing?.simulation;
  if (slot.format === "algoviz") {
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
    });
    if (pkg.status === "idea") pkg = transition(pkg, "scripted", undefined, now);
    else if (pkg.status === "rendered") pkg = transition(pkg, "scripted", "reescrita pelo QA", now);
    pkg = applyDraft(pkg, draft, platforms);

    pkg = await render(ctx, renderer, pkg, simRun);
    pkg = transition(pkg, "rendered", undefined, now);

    const issues = deterministicIssues(pkg, brand.rules);
    const judge = await judgePackage(llm, brand, pkg);
    const passed = !judge.blocking && judge.score >= brand.rules.minBrandScore && issues.length === 0;
    pkg = {
      ...pkg,
      qaAttempts: pkg.qaAttempts + 1,
      qa: { passed, score: judge.score, issues: [...issues, ...judge.issues], checkedAt: now.toISOString() },
    };
    log("produce.qa", { pkg: pkg.id, attempt: attempt + 1, score: judge.score, passed });

    if (passed) {
      pkg = transition(pkg, "qa_passed", undefined, now);
      return transition(pkg, "pending_review", undefined, now);
    }
    if (attempt + 1 >= MAX_QA_ATTEMPTS) return transition(pkg, "discarded", "reprovado no QA", now);
    feedback = [...issues, ...judge.issues, judge.fixInstructions].filter(Boolean).join("\n");
  }
}

export interface ProduceOptions {
  count?: number;
  ideaId?: string;
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

  const renderer = new Renderer();
  let created = 0;
  let discarded = 0;
  const save = async (pkg: ContentPackage) => {
    await ctx.store.savePackage(pkg);
    if (pkg.status === "pending_review") created++;
    else discarded++;
  };

  try {
    // 1) Pedidos de ajuste feitos no PWA têm prioridade.
    for (const pkg of all.filter((p) => p.status === "edit_requested")) {
      try {
        const slot: Slot = { pillar: pkg.pillar, format: pkg.format, hookType: pkg.hookType, exploration: false };
        const feedback = pkg.editRequests.at(-1)?.note;
        await save(await build(ctx, renderer, { slot, existing: pkg, feedback }, recentTopics));
      } catch (err) {
        logError("produce.edit", err, { pkg: pkg.id });
      }
    }

    // 2) Ideias novas: expressa (uma ideia específica) ou a cota do dia.
    const ideas = (await ctx.store.listIdeas("new")).filter((i) => !i.expiresAt || new Date(i.expiresAt) > ctx.now);
    let slots: { slot: Slot; idea?: Idea }[];
    if (opts.ideaId) {
      const idea = ideas.find((i) => i.id === opts.ideaId);
      if (!idea) throw new Error(`Ideia ${opts.ideaId} não encontrada ou expirada`);
      slots = [{ slot: { pillar: idea.pillar, format: idea.suggestedFormat, hookType: "choque", exploration: false }, idea }];
    } else {
      const rng = mulberry32(ctx.now.getTime() % 2 ** 31);
      const n = opts.count ?? Math.ceil(strategy.packagesPerDay / 2);
      const pool = [...ideas].sort((a, b) => b.hypeScore - a.hypeScore);
      // Só formatos que alguma rede ligada aceita (ex.: só Instagram = sem "text").
      const available = IMPLEMENTED_FORMATS.filter((f) => ctx.platforms.some((p) => KIND_BY_FORMAT[f]?.[p]));
      slots = allocateDay(strategy, rng, available, n).map((slot) => {
        if (slot.format === "algoviz") return { slot };
        const i = pool.findIndex((x) => x.pillar === slot.pillar || slot.exploration);
        return { slot, idea: i >= 0 ? pool.splice(i, 1)[0] : undefined };
      });
    }

    for (const { slot, idea } of slots) {
      const strategyPlatforms = platformsFor(slot, ctx.platforms, strategy.pillarPlatforms);
      if (!strategyPlatforms.length) {
        log("produce.skip", { reason: "sem plataforma para o formato", format: slot.format, pillar: slot.pillar });
        continue;
      }
      try {
        const pkg = await build(ctx, renderer, { slot, idea }, recentTopics);
        await save(pkg);
        recentTopics.unshift(pkg.topic);
        if (idea) await ctx.store.saveIdea({ ...idea, status: "used" });
      } catch (err) {
        if (err instanceof RefusedError) log("produce.refused", { format: slot.format, pillar: slot.pillar });
        else logError("produce.build", err, { format: slot.format, pillar: slot.pillar });
      }
    }
  } finally {
    await renderer.close();
  }
  log("produce.done", { created, discarded });
  return { created, discarded };
}
