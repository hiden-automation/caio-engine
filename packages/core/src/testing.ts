import type { ContentPackage } from "./schemas.ts";

/** Pacote mínimo válido para testes. */
export function fakePackage(overrides: Partial<ContentPackage> = {}): ContentPackage {
  const now = "2026-10-06T12:00:00.000Z";
  return {
    id: "p-20261006-1200-abc123",
    createdAt: now,
    updatedAt: now,
    status: "rendered",
    pillar: "computacao",
    format: "carousel",
    topic: "Algoritmo genético",
    angle: "Como a evolução resolve problemas",
    hooks: [],
    hookType: "eu_fiz",
    slides: [{ title: "Slide 1", body: "Texto" }],
    sources: [],
    assets: [],
    variants: [
      {
        id: "v-ig",
        platform: "instagram",
        kind: "carousel",
        caption: "Legenda ok",
        threadParts: [],
        assetIds: [],
        status: "draft",
        attempts: 0,
        aiLabel: false,
      },
    ],
    qaAttempts: 0,
    express: false,
    editRequests: [],
    history: [],
    features: { pillar: "computacao", format: "carousel", hookType: "eu_fiz", firstFrame: "texto", voice: "nenhuma", trendLinked: false },
    ...overrides,
  };
}
