import { z } from "zod";

export const Platform = z.enum(["instagram", "tiktok", "youtube", "linkedin", "threads", "x"]);
export type Platform = z.infer<typeof Platform>;
export const PLATFORMS = Platform.options;

export const Pillar = z.enum(["computacao", "geek", "bastidores", "jarvis", "liberdade"]);
export type Pillar = z.infer<typeof Pillar>;
export const PILLARS = Pillar.options;

export const Format = z.enum([
  "carousel",
  "demo",
  "voice_reel",
  "slideshow",
  "react",
  "cut",
  "algoviz",
  "story",
  "text",
  "longform",
  "take",
]);
export type Format = z.infer<typeof Format>;

export const HookType = z.enum(["pergunta", "choque", "lista", "eu_fiz", "contrarian", "historia", "tutorial"]);
export type HookType = z.infer<typeof HookType>;

export const License = z.enum(["livre", "permitido", "citacao", "proprio", "nenhum"]);
export type License = z.infer<typeof License>;

export const PackageStatus = z.enum([
  "idea",
  "scripted",
  "rendered",
  "qa_passed",
  "pending_review",
  "edit_requested",
  "approved",
  "rejected",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "expired",
  "discarded",
]);
export type PackageStatus = z.infer<typeof PackageStatus>;

export const VariantKind = z.enum(["carousel", "document", "image", "reel", "story", "text", "thread"]);
export type VariantKind = z.infer<typeof VariantKind>;

export const VariantStatus = z.enum(["draft", "approved", "disabled", "publishing", "published", "failed"]);
export type VariantStatus = z.infer<typeof VariantStatus>;

export const Source = z.object({
  title: z.string(),
  url: z.string().optional(),
  license: License,
  credit: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(["image", "video", "pdf", "audio"]),
  /** Caminho relativo dentro da branch `previews` do caio-data. */
  path: z.string(),
  role: z.enum(["slide", "cover", "reel", "story", "document"]),
  order: z.number().int().default(0),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationSec: z.number().optional(),
});
export type Asset = z.infer<typeof Asset>;

export const Variant = z.object({
  id: z.string(),
  platform: Platform,
  kind: VariantKind,
  caption: z.string(),
  /** Partes extras de thread (X/Threads), na ordem. */
  threadParts: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
  status: VariantStatus.default("draft"),
  scheduledAt: z.string().optional(),
  publishedAt: z.string().optional(),
  externalId: z.string().optional(),
  permalink: z.string().optional(),
  attempts: z.number().int().default(0),
  error: z.string().optional(),
  /** Rótulo de conteúdo gerado/alterado por IA (voz sintética etc.). */
  aiLabel: z.boolean().default(false),
});
export type Variant = z.infer<typeof Variant>;

export const Slide = z.object({
  title: z.string(),
  body: z.string().default(""),
  /** Dica visual para o Estúdio Visual (ex.: "diagrama", "codigo", "lista"). */
  visual: z.string().optional(),
  code: z.string().optional(),
  /** Reels: segundos em tela desta cena (o render ajusta pelo tamanho do texto se faltar). */
  durationSec: z.number().optional(),
  /** Reels: o que o locutor fala nesta cena. */
  narration: z.string().optional(),
  /** Imagem do assunto (banco com licença livre), resolvida no render. */
  imageQuery: z.string().optional(),
  image: z.object({ path: z.string(), credit: z.string() }).optional(),
});
export type Slide = z.infer<typeof Slide>;

/** Etiquetas que a IA dá para cada mídia da base ("jogar na base"). */
export const LibraryTags = z.object({
  description: z.string(),
  people: z.enum(["caio", "caio_e_outros", "outros", "ninguem"]),
  hasDog: z.boolean(),
  expression: z.string(),
  setting: z.string(),
  mood: z.string(),
  quality: z.number(),
  /** Símbolo/adesivo/número de partido ou candidato: nunca usar fora do pilar político. */
  political: z.boolean(),
  /** Rosto de terceiros identificável, criança, documento, placa, endereço: não usar. */
  sensitive: z.boolean(),
  uses: z.array(z.enum(["avatar", "capa", "fundo", "story", "reacao", "broll", "recorte"])),
  /** Ponto de interesse (0–1) para enquadrar o corte. */
  focus: z.object({ x: z.number(), y: z.number() }),
});
export type LibraryTags = z.infer<typeof LibraryTags>;

export const LibraryItem = z.object({
  id: z.string(),
  raw: z.string(),
  kind: z.enum(["image", "video"]),
  addedAt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  durationSec: z.number().optional(),
  /** Caminhos relativos à branch `library`. */
  derived: z.object({
    full: z.string(),
    frames: z.array(z.string()).default([]),
    cutout: z.string().optional(),
    /** Vídeo normalizado 1080×1920 (b-roll de reels). */
    clip: z.string().optional(),
  }),
  tags: LibraryTags.optional(),
  usage: z.object({ count: z.number().int().default(0), lastUsedAt: z.string().optional() }).default({ count: 0 }),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const QaResult = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
  checkedAt: z.string(),
});
export type QaResult = z.infer<typeof QaResult>;

export const HistoryEntry = z.object({
  at: z.string(),
  from: PackageStatus,
  to: PackageStatus,
  note: z.string().optional(),
});

/** Características usadas pelo otimizador para aprender o que funciona. */
export const Features = z.object({
  pillar: Pillar,
  format: Format,
  hookType: HookType,
  firstFrame: z.enum(["rosto", "texto", "simulacao", "tela"]).default("texto"),
  voice: z.enum(["clone", "real", "locutor", "nenhuma"]).default("nenhuma"),
  trendLinked: z.boolean().default(false),
  modeledFormat: z.string().optional(),
  series: z.string().optional(),
  slideCount: z.number().int().optional(),
  durationSec: z.number().optional(),
});
export type Features = z.infer<typeof Features>;

export const ContentPackage = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: PackageStatus,
  pillar: Pillar,
  format: Format,
  topic: z.string(),
  angle: z.string(),
  hooks: z.array(z.string()).default([]),
  chosenHook: z.string().optional(),
  hookType: HookType,
  slides: z.array(Slide).default([]),
  script: z.string().optional(),
  sources: z.array(Source).default([]),
  assets: z.array(Asset).default([]),
  variants: z.array(Variant).default([]),
  qa: QaResult.optional(),
  qaAttempts: z.number().int().default(0),
  ideaId: z.string().optional(),
  express: z.boolean().default(false),
  expiresAt: z.string().optional(),
  editRequests: z.array(z.object({ at: z.string(), note: z.string() })).default([]),
  history: z.array(HistoryEntry).default([]),
  features: Features,
  /** Estilo visual: hud (escuro, assinatura), post (print de post), quadro (explicação desenhada). */
  style: z.enum(["hud", "post", "quadro"]).default("hud"),
  /** A mensagem do post em uma frase (o roteirista define antes de escrever). */
  message: z.string().optional(),
  /** React: vídeo de terceiro usado (com crédito). */
  reactSource: z.object({ path: z.string(), credit: z.string(), url: z.string().optional(), durationSec: z.number() }).optional(),
  /** Itens da base (L1, L2…) usados nas artes: controla o desgaste. */
  libraryRefs: z.array(z.string()).default([]),
  /** Parâmetros da simulação (AlgoViz), para re-renderizar idêntico. */
  simulation: z
    .object({ kind: z.literal("genetic_tsp"), seed: z.number().int(), generations: z.number().int() })
    .optional(),
});
export type ContentPackage = z.infer<typeof ContentPackage>;

/** Decisão tomada no PWA. O PWA grava em `reviews/<packageId>-<ts>.json`. */
export const Review = z.object({
  packageId: z.string(),
  decision: z.enum(["approve", "reject", "edit"]),
  at: z.string(),
  reason: z.string().optional(),
  note: z.string().optional(),
  variantToggles: z.record(z.string(), z.boolean()).default({}),
  captionEdits: z.record(z.string(), z.string()).default({}),
  schedule: z.record(z.string(), z.string()).default({}),
});
export type Review = z.infer<typeof Review>;

export const Signal = z.object({
  id: z.string(),
  collector: z.string(),
  platform: Platform.optional(),
  title: z.string(),
  url: z.string().optional(),
  observedAt: z.string(),
  /** Valor bruto da métrica principal da fonte (views, pontos, buscas...). */
  value: z.number().default(0),
  /** Crescimento por hora relativo (0.5 = +50%/h) quando há histórico. */
  velocity: z.number().default(0),
  tags: z.array(z.string()).default([]),
  summary: z.string().optional(),
});
export type Signal = z.infer<typeof Signal>;

export const Idea = z.object({
  id: z.string(),
  createdAt: z.string(),
  title: z.string(),
  angle: z.string(),
  pillar: Pillar,
  suggestedFormat: Format,
  hypeScore: z.number(),
  express: z.boolean().default(false),
  status: z.enum(["new", "used", "discarded"]).default("new"),
  expiresAt: z.string().optional(),
  signalIds: z.array(z.string()).default([]),
  /** Vídeo de referência que o Caio mandou pelo PWA (branch library), para react. */
  refVideo: z.object({ path: z.string(), credit: z.string(), url: z.string().optional() }).optional(),
  sources: z.array(Source).default([]),
});
export type Idea = z.infer<typeof Idea>;

export const Strategy = z.object({
  version: z.number().int(),
  updatedAt: z.string(),
  /** Pesos por pilar, em pontos percentuais (somam 100). */
  pillarMix: z.record(Pillar, z.number()),
  /** Piso por pilar (pp) — o otimizador nunca desce abaixo. */
  pillarFloors: z.record(Pillar, z.number()),
  maxWeeklyShiftPts: z.number().default(10),
  /** Fração da produção reservada para exploração. */
  exploration: z.number().min(0).max(1).default(0.2),
  packagesPerDay: z.number().int().default(6),
  formatWeights: z.record(Format, z.number()),
  hookWeights: z.record(HookType, z.number()),
  /** Horários (HH:MM, America/Sao_Paulo) por plataforma. */
  slots: z.record(Platform, z.array(z.string())),
  /** Plataformas que recebem cada pilar. */
  pillarPlatforms: z.record(Pillar, z.array(Platform)),
  hypeExpressThreshold: z.number().default(0.75),
});
export type Strategy = z.infer<typeof Strategy>;

/** Regras imutáveis de marca (banned.yml). */
export const BrandRules = z.object({
  forbiddenTopics: z.array(z.string()).default([]),
  /** Regexes (case-insensitive) que reprovam o conteúdo na hora. */
  forbiddenPatterns: z.array(z.object({ pattern: z.string(), reason: z.string() })).default([]),
  /** Pilares que nunca podem usar voz clonada. */
  noClonedVoicePillars: z.array(Pillar).default(["liberdade"]),
  maxThirdPartyRatio: z.number().default(0.4),
  minBrandScore: z.number().default(7),
});
export type BrandRules = z.infer<typeof BrandRules>;

export const MetricSnapshot = z.object({
  packageId: z.string(),
  variantId: z.string(),
  platform: Platform,
  externalId: z.string(),
  takenAt: z.string(),
  ageHours: z.number(),
  views: z.number().optional(),
  reach: z.number().optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
  saves: z.number().optional(),
  follows: z.number().optional(),
  avgWatchSec: z.number().optional(),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;
