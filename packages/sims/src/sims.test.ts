import { describe, expect, it } from "vitest";
import { runGeneticTsp } from "./genetic-tsp.ts";
import { SP_BAIRROS } from "./cities.ts";

describe("algoritmo genético (TSP)", () => {
  it("é determinístico pela seed", () => {
    const a = runGeneticTsp(SP_BAIRROS, { generations: 60 });
    const b = runGeneticTsp(SP_BAIRROS, { generations: 60 });
    expect(a.history.map((h) => h.bestKm)).toEqual(b.history.map((h) => h.bestKm));
  });

  it("melhora a rota entre a geração 0 e a final, sem nunca piorar (elitismo)", () => {
    const run = runGeneticTsp(SP_BAIRROS);
    const best = run.history.map((h) => h.bestKm);
    expect(best[best.length - 1]!).toBeLessThan(best[0]! * 0.7);
    for (let i = 1; i < best.length; i++) expect(best[i]!).toBeLessThanOrEqual(best[i - 1]!);
    expect(run.improvementPct).toBeGreaterThan(30);
  });

  it("toda rota é uma permutação válida", () => {
    const run = runGeneticTsp(SP_BAIRROS, { generations: 20 });
    for (const h of run.history) expect([...h.bestRoute].sort((a, b) => a - b)).toEqual(SP_BAIRROS.map((_, i) => i));
  });

  it("gera eventos narráveis ancorados nos dados", () => {
    const run = runGeneticTsp(SP_BAIRROS);
    expect(run.events.at(-1)!.kind).toBe("fim");
    expect(run.events.some((e) => e.kind === "salto")).toBe(true);
  });
});
