import { mulberry32, randInt, type Rng } from "@jarvis/core";
import { haversineKm, type City } from "./cities.ts";

export interface GaParams {
  seed: number;
  populationSize: number;
  generations: number;
  mutationRate: number;
  tournamentSize: number;
  elitism: number;
}

export const DEFAULT_GA_PARAMS: GaParams = {
  seed: 42,
  populationSize: 120,
  generations: 300,
  mutationRate: 0.15,
  tournamentSize: 5,
  elitism: 2,
};

export interface GenerationRecord {
  gen: number;
  bestKm: number;
  meanKm: number;
  bestRoute: number[];
}

export interface GaEvent {
  gen: number;
  kind: "salto" | "estagnacao" | "fim";
  description: string;
}

export interface GaRun {
  params: GaParams;
  cities: City[];
  history: GenerationRecord[];
  events: GaEvent[];
  improvementPct: number;
}

type Route = number[];

function routeKm(route: Route, dist: number[][]): number {
  let total = 0;
  for (let i = 0; i < route.length; i++) total += dist[route[i]!]![route[(i + 1) % route.length]!]!;
  return total;
}

function shuffled(n: number, rng: Rng): Route {
  const r = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/** Order crossover (OX): preserva a ordem relativa das cidades de cada pai. */
function orderCrossover(a: Route, b: Route, rng: Rng): Route {
  const n = a.length;
  let i = randInt(rng, n);
  let j = randInt(rng, n);
  if (i > j) [i, j] = [j, i];
  const child: number[] = new Array(n).fill(-1);
  const used = new Set<number>();
  for (let k = i; k <= j; k++) {
    child[k] = a[k]!;
    used.add(a[k]!);
  }
  let pos = (j + 1) % n;
  for (let k = 0; k < n; k++) {
    const city = b[(j + 1 + k) % n]!;
    if (used.has(city)) continue;
    child[pos] = city;
    pos = (pos + 1) % n;
  }
  return child;
}

/** Mutação por inversão de um trecho (2-opt aleatório). */
function mutate(route: Route, rate: number, rng: Rng): Route {
  if (rng() >= rate) return route;
  const r = [...route];
  let i = randInt(rng, r.length);
  let j = randInt(rng, r.length);
  if (i > j) [i, j] = [j, i];
  while (i < j) {
    [r[i], r[j]] = [r[j]!, r[i]!];
    i++;
    j--;
  }
  return r;
}

/**
 * Algoritmo genético para o caixeiro-viajante. Determinístico por seed, para
 * que o vídeo e a narração ("na geração 47 aconteceu um salto") batam com os
 * dados reais da execução.
 */
export function runGeneticTsp(cities: City[], params: Partial<GaParams> = {}): GaRun {
  const p = { ...DEFAULT_GA_PARAMS, ...params };
  const rng = mulberry32(p.seed);
  const n = cities.length;
  const dist = cities.map((a) => cities.map((b) => haversineKm(a, b)));

  let population = Array.from({ length: p.populationSize }, () => shuffled(n, rng));
  const history: GenerationRecord[] = [];

  const tournament = (scored: { route: Route; km: number }[]): Route => {
    let best = scored[randInt(rng, scored.length)]!;
    for (let k = 1; k < p.tournamentSize; k++) {
      const c = scored[randInt(rng, scored.length)]!;
      if (c.km < best.km) best = c;
    }
    return best.route;
  };

  for (let gen = 0; gen <= p.generations; gen++) {
    const scored = population.map((route) => ({ route, km: routeKm(route, dist) })).sort((a, b) => a.km - b.km);
    history.push({
      gen,
      bestKm: Math.round(scored[0]!.km * 100) / 100,
      meanKm: Math.round((scored.reduce((s, x) => s + x.km, 0) / scored.length) * 100) / 100,
      bestRoute: [...scored[0]!.route],
    });
    if (gen === p.generations) break;

    const next: Route[] = scored.slice(0, p.elitism).map((s) => s.route);
    while (next.length < p.populationSize) {
      next.push(mutate(orderCrossover(tournament(scored), tournament(scored), rng), p.mutationRate, rng));
    }
    population = next;
  }

  const first = history[0]!.bestKm;
  const last = history[history.length - 1]!.bestKm;
  return {
    params: p,
    cities,
    history,
    events: detectEvents(history),
    improvementPct: Math.round(((first - last) / first) * 1000) / 10,
  };
}

/** Momentos narráveis: saltos grandes, platôs longos e o resultado final. */
export function detectEvents(history: GenerationRecord[]): GaEvent[] {
  const events: GaEvent[] = [];
  let plateauStart = 0;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!.bestKm;
    const cur = history[i]!.bestKm;
    const drop = (prev - cur) / prev;
    if (drop >= 0.04) {
      events.push({ gen: i, kind: "salto", description: `Geração ${i}: a melhor rota caiu ${(drop * 100).toFixed(1)}% de uma vez (${prev} → ${cur} km)` });
    }
    if (cur < prev) {
      if (i - plateauStart >= 40) {
        events.push({ gen: i, kind: "estagnacao", description: `Gerações ${plateauStart}–${i - 1}: ${i - plateauStart} gerações presas em ${prev} km até uma mutação destravar` });
      }
      plateauStart = i;
    }
  }
  const last = history[history.length - 1]!;
  events.push({ gen: last.gen, kind: "fim", description: `Geração ${last.gen}: melhor rota com ${last.bestKm} km (início: ${history[0]!.bestKm} km)` });
  return events;
}
