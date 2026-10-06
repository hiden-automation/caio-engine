import type { Signal } from "@jarvis/core";

export interface ScoredSignal {
  signal: Signal;
  /** Percentil da velocidade dentro do próprio coletor (0..1). */
  velocityRank: number;
  /** Presença em várias fontes/plataformas (0..1). */
  crossPlatform: number;
  /** Decaimento por idade da observação mais antiga (0..1). */
  freshness: number;
  preScore: number;
}

const STOP = new Set(["para", "como", "com", "sobre", "mais", "pelo", "pela", "that", "with", "from", "this", "what", "your", "will", "have"]);

export function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Junta a rodada nova com o arquivo do dia, mantendo a 1ª observação de cada sinal. */
export function mergeSignals(previous: Signal[], fresh: Signal[]): Signal[] {
  const byId = new Map(previous.map((s) => [s.id, s]));
  for (const s of fresh) {
    const prev = byId.get(s.id);
    byId.set(s.id, prev ? { ...s, observedAt: prev.observedAt } : s);
  }
  return [...byId.values()];
}

export function scoreSignals(signals: Signal[], now: Date): ScoredSignal[] {
  const byCollector = new Map<string, Signal[]>();
  for (const s of signals) {
    const arr = byCollector.get(s.collector) ?? [];
    arr.push(s);
    byCollector.set(s.collector, arr);
  }
  const rank = new Map<string, number>();
  for (const group of byCollector.values()) {
    const sorted = [...group].sort((a, b) => a.velocity - b.velocity);
    sorted.forEach((s, i) => rank.set(s.id, group.length === 1 ? 0.5 : i / (group.length - 1)));
  }

  const toks = new Map(signals.map((s) => [s.id, tokens(s.title)]));
  return signals
    .map((signal) => {
      const mine = toks.get(signal.id)!;
      const otherCollectors = new Set<string>();
      for (const other of signals) {
        if (other.collector !== signal.collector && jaccard(mine, toks.get(other.id)!) >= 0.3) otherCollectors.add(other.collector);
      }
      const crossPlatform = Math.min(1, otherCollectors.size / 3);
      const ageH = Math.max(0, (now.getTime() - new Date(signal.observedAt).getTime()) / 3_600_000);
      const freshness = Math.exp(-ageH / 24);
      const velocityRank = rank.get(signal.id)!;
      return {
        signal,
        velocityRank,
        crossPlatform,
        freshness,
        preScore: 0.6 * velocityRank + 0.25 * crossPlatform + 0.15 * freshness,
      };
    })
    .sort((a, b) => b.preScore - a.preScore);
}

export interface TriageVerdict {
  /** Quanto conecta com os pilares do Caio (0..1). */
  pillarFit: number;
  /** Risco de marca, direitos ou eleição (0..1). */
  risk: number;
  /** Quantos criadores de referência já cobriram (0..1). */
  saturation: number;
}

/**
 * Hype score final (0..1): velocidade × presença cruzada × aderência × frescor,
 * penalizado por saturação e risco.
 */
export function hypeScore(s: ScoredSignal, v: TriageVerdict): number {
  const base = 0.35 * s.velocityRank + 0.2 * s.crossPlatform + 0.3 * v.pillarFit + 0.15 * s.freshness;
  const score = base * (1 - 0.5 * v.saturation) - 0.4 * v.risk;
  // Sem aderência aos pilares não existe "ângulo do Caio": zera.
  return v.pillarFit < 0.3 ? 0 : Math.max(0, Math.min(1, score));
}
