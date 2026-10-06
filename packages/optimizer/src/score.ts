import type { ContentPackage, MetricSnapshot, Platform } from "@jarvis/core";

/**
 * KPI principal = seguidores ganhos. Quando a plataforma não informa
 * seguidores por post, usamos um proxy ponderado pelos sinais que mais
 * antecipam seguidores (shares e saves).
 */
export function rawScore(s: MetricSnapshot): number {
  if (s.follows !== undefined) return s.follows * 10 + (s.shares ?? 0) * 0.5;
  return (
    (s.shares ?? 0) * 3 +
    (s.saves ?? 0) * 2 +
    (s.comments ?? 0) * 1 +
    (s.likes ?? 0) * 0.2 +
    (s.views ?? s.reach ?? 0) * 0.01
  );
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Último snapshot de cada variante com pelo menos `minAgeHours`. */
export function latestSnapshots(snaps: MetricSnapshot[], minAgeHours = 24): Map<string, MetricSnapshot> {
  const out = new Map<string, MetricSnapshot>();
  for (const s of snaps) {
    if (s.ageHours < minAgeHours) continue;
    const prev = out.get(s.variantId);
    if (!prev || s.ageHours > prev.ageHours) out.set(s.variantId, s);
  }
  return out;
}

export interface PackageOutcome {
  packageId: string;
  /** Desempenho relativo à mediana da plataforma (1 = mediano). */
  relative: number;
  success: boolean;
  publishedAt: string;
}

/**
 * Normaliza por plataforma (cada rede tem escala própria) e agrega por pacote.
 * Sucesso = acima da mediana — é o que alimenta o bandit Beta-Bernoulli.
 */
export function packageOutcomes(pkgs: ContentPackage[], snaps: MetricSnapshot[]): PackageOutcome[] {
  const latest = latestSnapshots(snaps);
  const byPlatform = new Map<Platform, number[]>();
  for (const s of latest.values()) {
    const arr = byPlatform.get(s.platform) ?? [];
    arr.push(rawScore(s));
    byPlatform.set(s.platform, arr);
  }
  const medians = new Map([...byPlatform].map(([p, xs]) => [p, Math.max(median(xs), 1e-9)]));

  const outcomes: PackageOutcome[] = [];
  for (const pkg of pkgs) {
    const rels = pkg.variants
      .map((v) => latest.get(v.id))
      .filter((s): s is MetricSnapshot => !!s)
      .map((s) => rawScore(s) / medians.get(s.platform)!);
    if (!rels.length) continue;
    const relative = rels.reduce((a, b) => a + b, 0) / rels.length;
    const publishedAt = pkg.variants.map((v) => v.publishedAt).filter(Boolean).sort()[0] ?? pkg.updatedAt;
    outcomes.push({ packageId: pkg.id, relative, success: relative > 1, publishedAt });
  }
  return outcomes;
}
