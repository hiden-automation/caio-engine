import { describe, expect, it } from "vitest";
import { fakePackage, mulberry32, PILLARS, type ContentPackage, type MetricSnapshot, type Pillar } from "@jarvis/core";
import { ThompsonBandit } from "./bandit.ts";
import { allocateDay, boundedMix, optimizeStrategy } from "./strategy.ts";
import { defaultStrategy, IMPLEMENTED_FORMATS } from "./defaults.ts";

describe("bandit", () => {
  it("converge para o braço sabidamente melhor", () => {
    const rng = mulberry32(7);
    const truth = { a: 0.2, b: 0.35, c: 0.6 } as const;
    const bandit = new ThompsonBandit(["a", "b", "c"] as const);
    const pulls = { a: 0, b: 0, c: 0 };
    for (let round = 0; round < 600; round++) {
      let best: "a" | "b" | "c" = "a";
      let bestV = -1;
      for (const [arm, v] of bandit.sample(rng)) if (v > bestV) [best, bestV] = [arm, v];
      pulls[best]++;
      bandit.observe(best, rng() < truth[best]);
    }
    expect(pulls.c).toBeGreaterThan(pulls.a + pulls.b);
  });
});

describe("boundedMix", () => {
  const current = { a: 40, b: 25, c: 10, d: 10, e: 15 };

  it("nunca move mais que o limite, respeita pisos e soma 100", () => {
    const target = { a: 90, b: 2, c: 2, d: 2, e: 4 };
    const floors = { a: 25, b: 10, c: 5, d: 5, e: 5 };
    const out = boundedMix(current, target, 10, floors);
    const sum = Object.values(out).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(100, 1);
    for (const k of Object.keys(current) as (keyof typeof current)[]) {
      expect(Math.abs(out[k] - current[k])).toBeLessThanOrEqual(10 + 0.02);
      expect(out[k]).toBeGreaterThanOrEqual(floors[k] - 0.01);
    }
  });

  it("chega ao alvo quando ele está dentro do limite", () => {
    const target = { a: 45, b: 20, c: 10, d: 10, e: 15 };
    expect(boundedMix(current, target, 10)).toEqual(target);
  });
});

function published(pillar: Pillar, i: number): ContentPackage {
  const base = fakePackage();
  return fakePackage({
    id: `p-${pillar}-${i}`,
    status: "published",
    pillar,
    features: { ...base.features, pillar },
    variants: [{ ...base.variants[0]!, id: `v-${pillar}-${i}`, status: "published", publishedAt: "2026-10-01T12:00:00.000Z", externalId: "x" }],
  });
}

describe("optimizeStrategy", () => {
  it("só observa enquanto não há dados suficientes", () => {
    const r = optimizeStrategy({ strategy: defaultStrategy(), packages: [], snapshots: [], now: new Date(), rng: mulberry32(1) });
    expect(r.changed).toBe(false);
  });

  it("aumenta o pilar que performa e gera propostas fora do limite", () => {
    const pkgs: ContentPackage[] = [];
    const snaps: MetricSnapshot[] = [];
    for (const pillar of PILLARS) {
      for (let i = 0; i < 12; i++) {
        const p = published(pillar, i);
        pkgs.push(p);
        const good = pillar === "geek";
        snaps.push({
          packageId: p.id,
          variantId: p.variants[0]!.id,
          platform: "instagram",
          externalId: "x",
          takenAt: "2026-10-05T12:00:00.000Z",
          ageHours: 96,
          shares: good ? 50 + i : 5 + (i % 3),
          saves: good ? 40 : 4,
        });
      }
    }
    const s0 = defaultStrategy(new Date("2026-10-01"));
    const r = optimizeStrategy({ strategy: s0, packages: pkgs, snapshots: snaps, now: new Date("2026-10-06"), rng: mulberry32(3) });
    expect(r.changed).toBe(true);
    expect(r.strategy.pillarMix.geek).toBeGreaterThan(s0.pillarMix.geek);
    expect(r.strategy.pillarMix.geek - s0.pillarMix.geek).toBeLessThanOrEqual(10.02);
    for (const p of PILLARS) expect(r.strategy.pillarMix[p]).toBeGreaterThanOrEqual(s0.pillarFloors[p] - 0.01);
    expect(r.proposals.some((p) => p.dimension === "pillar" && p.key === "geek")).toBe(true);
    // Formato ainda não implementado continua com peso 0.
    expect(r.strategy.formatWeights.voice_reel).toBe(0);
    // Pilar desligado pelo Caio (peso 0) não volta sozinho.
    expect(r.strategy.pillarMix.jarvis).toBe(0);
  });
});

describe("allocateDay", () => {
  it("respeita formatos disponíveis e reserva exploração", () => {
    const slots = allocateDay(defaultStrategy(), mulberry32(9), IMPLEMENTED_FORMATS, 10);
    expect(slots).toHaveLength(10);
    expect(slots.filter((s) => s.exploration)).toHaveLength(2);
    for (const s of slots) expect(IMPLEMENTED_FORMATS).toContain(s.format);
  });
});
