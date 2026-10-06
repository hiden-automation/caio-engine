import { betaSample, type Rng } from "@jarvis/core";

export interface ArmStats {
  successes: number;
  failures: number;
}

/**
 * Bandit Beta-Bernoulli com decaimento temporal: resultados antigos pesam
 * menos (o algoritmo das redes muda), então o sistema se adapta.
 */
export class ThompsonBandit<K extends string> {
  readonly stats = new Map<K, ArmStats>();

  constructor(readonly arms: readonly K[]) {
    for (const a of arms) this.stats.set(a, { successes: 0, failures: 0 });
  }

  observe(arm: K, success: boolean, weight = 1): void {
    const s = this.stats.get(arm);
    if (!s) return;
    if (success) s.successes += weight;
    else s.failures += weight;
  }

  sample(rng: Rng): Map<K, number> {
    const out = new Map<K, number>();
    for (const [arm, s] of this.stats) out.set(arm, betaSample(rng, 1 + s.successes, 1 + s.failures));
    return out;
  }

  /** Fração de vezes em que cada braço vence o sorteio de Thompson. */
  winShares(rng: Rng, draws = 2000): Map<K, number> {
    const wins = new Map<K, number>(this.arms.map((a) => [a, 0]));
    for (let i = 0; i < draws; i++) {
      let best: K | undefined;
      let bestV = -1;
      for (const [arm, v] of this.sample(rng)) {
        if (v > bestV) {
          bestV = v;
          best = arm;
        }
      }
      wins.set(best!, wins.get(best!)! + 1);
    }
    return new Map([...wins].map(([k, w]) => [k, w / draws]));
  }

  observations(arm: K): number {
    const s = this.stats.get(arm)!;
    return s.successes + s.failures;
  }
}

/** Peso de um resultado antigo: meia-vida em semanas. */
export function decayWeight(publishedAt: string, now: Date, halfLifeWeeks = 4): number {
  const weeks = (now.getTime() - new Date(publishedAt).getTime()) / (7 * 24 * 3600 * 1000);
  return Math.pow(0.5, Math.max(0, weeks) / halfLifeWeeks);
}
