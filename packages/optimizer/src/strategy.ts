import {
  type ContentPackage,
  type Format,
  type HookType,
  type MetricSnapshot,
  type Pillar,
  type Rng,
  type Strategy,
  PILLARS,
  randInt,
} from "@jarvis/core";
import { decayWeight, ThompsonBandit } from "./bandit.ts";
import { packageOutcomes } from "./score.ts";

export interface Proposal {
  dimension: "pillar" | "format" | "hook";
  key: string;
  current: number;
  target: number;
  applied: number;
}

/**
 * Move `current` em direção a `target` sem passar de ±maxShift por chave,
 * respeitando pisos e mantendo a soma em 100. Mudanças maiores que o limite
 * viram propostas para o Caio aprovar no PWA.
 */
export function boundedMix<K extends string>(
  current: Record<K, number>,
  target: Record<K, number>,
  maxShift: number,
  floors: Partial<Record<K, number>> = {},
): Record<K, number> {
  const keys = Object.keys(current) as K[];
  const lo = new Map(keys.map((k) => [k, Math.max(floors[k] ?? 0, current[k] - maxShift, 0)]));
  const hi = new Map(keys.map((k) => [k, Math.max(current[k] + maxShift, lo.get(k)!)]));
  const out = new Map(keys.map((k) => [k, Math.min(hi.get(k)!, Math.max(lo.get(k)!, target[k] ?? 0))]));

  // Water-filling: distribui o que falta/sobra entre quem ainda tem folga.
  for (let iter = 0; iter < 50; iter++) {
    const sum = [...out.values()].reduce((a, b) => a + b, 0);
    const diff = 100 - sum;
    if (Math.abs(diff) < 1e-9) break;
    const room = keys.map((k) => [k, diff > 0 ? hi.get(k)! - out.get(k)! : out.get(k)! - lo.get(k)!] as const);
    const totalRoom = room.reduce((a, [, r]) => a + r, 0);
    if (totalRoom <= 1e-12) break;
    for (const [k, r] of room) {
      const delta = (Math.abs(diff) * r) / totalRoom;
      out.set(k, out.get(k)! + (diff > 0 ? delta : -delta));
    }
  }
  return Object.fromEntries(keys.map((k) => [k, Math.round(out.get(k)! * 100) / 100])) as Record<K, number>;
}

export interface OptimizeInput {
  strategy: Strategy;
  packages: ContentPackage[];
  snapshots: MetricSnapshot[];
  now: Date;
  rng: Rng;
  /** Abaixo disso o otimizador só observa (mix fixo). */
  minObservations?: number;
}

export interface OptimizeResult {
  strategy: Strategy;
  changed: boolean;
  proposals: Proposal[];
  report: string[];
}

function optimizeDimension<K extends string>(
  dimension: Proposal["dimension"],
  current: Record<K, number>,
  bandit: ThompsonBandit<K>,
  exploration: number,
  maxShift: number,
  rng: Rng,
  floors: Partial<Record<K, number>> = {},
): { mix: Record<K, number>; proposals: Proposal[] } {
  // Só otimiza o que está ativo (peso 0 = formato ainda não implementado).
  const active = (Object.keys(current) as K[]).filter((k) => current[k] > 0);
  const activeCurrent = Object.fromEntries(active.map((k) => [k, current[k]])) as Record<K, number>;
  const activeSum = active.reduce((a, k) => a + current[k], 0);
  const scale = 100 / activeSum;
  const scaled = Object.fromEntries(active.map((k) => [k, activeCurrent[k] * scale])) as Record<K, number>;

  const shares = bandit.winShares(rng);
  const target = Object.fromEntries(
    active.map((k) => [k, ((1 - exploration) * (shares.get(k) ?? 0) + exploration / active.length) * 100]),
  ) as Record<K, number>;
  const applied = boundedMix(scaled, target, maxShift, floors);

  const proposals: Proposal[] = [];
  for (const k of active) {
    if (Math.abs(target[k] - scaled[k]) > maxShift + 1e-9) {
      proposals.push({ dimension, key: k, current: scaled[k], target: Math.round(target[k] * 100) / 100, applied: applied[k] });
    }
  }
  const mix = { ...current };
  for (const k of active) mix[k] = Math.round((applied[k] / scale) * 100) / 100;
  return { mix, proposals };
}

export function optimizeStrategy(input: OptimizeInput): OptimizeResult {
  const { strategy, now, rng } = input;
  const minObs = input.minObservations ?? 30;
  const outcomes = packageOutcomes(
    input.packages.filter((p) => p.status === "published"),
    input.snapshots,
  );
  const byId = new Map(input.packages.map((p) => [p.id, p]));

  const pillarB = new ThompsonBandit<Pillar>(PILLARS);
  const formatB = new ThompsonBandit<Format>(Object.keys(strategy.formatWeights) as Format[]);
  const hookB = new ThompsonBandit<HookType>(Object.keys(strategy.hookWeights) as HookType[]);
  for (const o of outcomes) {
    const pkg = byId.get(o.packageId)!;
    const w = decayWeight(o.publishedAt, now);
    pillarB.observe(pkg.features.pillar, o.success, w);
    formatB.observe(pkg.features.format, o.success, w);
    hookB.observe(pkg.features.hookType, o.success, w);
  }

  const report: string[] = [`Pacotes com métricas: ${outcomes.length}`];
  if (outcomes.length < minObs) {
    report.push(`Dados insuficientes (mín. ${minObs}). Mix mantido; só coletando.`);
    return { strategy, changed: false, proposals: [], report };
  }

  const shift = strategy.maxWeeklyShiftPts;
  const p = optimizeDimension("pillar", strategy.pillarMix, pillarB, strategy.exploration, shift, rng, strategy.pillarFloors);
  const f = optimizeDimension("format", strategy.formatWeights, formatB, strategy.exploration, shift, rng, {});
  const h = optimizeDimension("hook", strategy.hookWeights, hookB, strategy.exploration, shift, rng, {});

  for (const pillar of PILLARS) {
    const s = pillarB.stats.get(pillar)!;
    report.push(`Pilar ${pillar}: ${strategy.pillarMix[pillar]} → ${p.mix[pillar]} pp (sucessos ${s.successes.toFixed(1)} / falhas ${s.failures.toFixed(1)})`);
  }

  const next: Strategy = {
    ...strategy,
    version: strategy.version + 1,
    updatedAt: now.toISOString(),
    pillarMix: p.mix,
    formatWeights: f.mix,
    hookWeights: h.mix,
  };
  return { strategy: next, changed: true, proposals: [...p.proposals, ...f.proposals, ...h.proposals], report };
}

export interface Slot {
  pillar: Pillar;
  format: Format;
  hookType: HookType;
  exploration: boolean;
}

function weightedPick<K extends string>(weights: Partial<Record<K, number>>, rng: Rng, allowed?: readonly K[]): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([k, w]) => w > 0 && (!allowed || allowed.includes(k)));
  if (!entries.length) throw new Error("Nenhuma opção com peso > 0");
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1]![0];
}

/** Distribui a produção do dia: (1 − exploração) pelos pesos, o resto aleatório. */
export function allocateDay(strategy: Strategy, rng: Rng, availableFormats: readonly Format[], n = strategy.packagesPerDay): Slot[] {
  const slots: Slot[] = [];
  const nExplore = Math.round(n * strategy.exploration);
  const hooks = Object.keys(strategy.hookWeights) as HookType[];
  for (let i = 0; i < n; i++) {
    const exploration = i >= n - nExplore;
    slots.push(
      exploration
        ? {
            pillar: PILLARS[randInt(rng, PILLARS.length)]!,
            format: availableFormats[randInt(rng, availableFormats.length)]!,
            hookType: hooks[randInt(rng, hooks.length)]!,
            exploration,
          }
        : {
            pillar: weightedPick(strategy.pillarMix, rng),
            format: weightedPick(strategy.formatWeights, rng, availableFormats),
            hookType: weightedPick(strategy.hookWeights, rng),
            exploration,
          },
    );
  }
  return slots;
}
