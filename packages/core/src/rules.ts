import type { BrandRules, ContentPackage, Platform } from "./schemas.ts";

/** Limites de legenda por plataforma (conservadores). */
export const CAPTION_LIMITS: Record<Platform, { maxChars: number; maxHashtags: number; allowLinks: boolean }> = {
  instagram: { maxChars: 2200, maxHashtags: 5, allowLinks: false },
  tiktok: { maxChars: 2200, maxHashtags: 5, allowLinks: false },
  youtube: { maxChars: 5000, maxHashtags: 5, allowLinks: true },
  linkedin: { maxChars: 3000, maxHashtags: 5, allowLinks: true },
  threads: { maxChars: 500, maxHashtags: 1, allowLinks: true },
  // Post com link custa ~13× mais na API do X: nunca link.
  x: { maxChars: 280, maxHashtags: 2, allowLinks: false },
};

const LINK = /https?:\/\/|www\.\w/i;

/**
 * Regras imutáveis: ficam no código (não no banned.yml) para que nem o
 * otimizador nem uma edição de dados consiga removê-las.
 */
export const IMMUTABLE_PATTERNS: { pattern: string; reason: string }[] = [
  {
    pattern: String.raw`\b(faturei|faturamos|faturo|faturamento|lucrei|lucro de|ganhei|ganho|tiro|recebi)\b[^.\n]{0,40}R\$\s?\d`,
    reason: "nunca expor faturamento ou quanto o Caio ganha",
  },
  {
    pattern: String.raw`R\$\s?\d[\d.,]*\s?(k|mil|milh(ão|ões))?\s*(por mês|/mês|ao mês|por ano|de faturamento|de lucro)`,
    reason: "nunca expor faturamento ou renda",
  },
  {
    pattern: String.raw`\b(tenho|atendo|atendi|já são|somos)\s+(mais de\s+)?\d+\s+clientes\b`,
    reason: "nunca expor número de clientes",
  },
  {
    pattern: String.raw`\b(meu|minha|um|uma|nosso|nossa)\s+(cliente|clínica|escritório|empresa cliente|loja)\b[^.\n]{0,80}\b(economizou|economiza|reduziu|faturou|ganhou|aumentou|dobrou|triplicou|cresceu)\b`,
    reason: "proibido inventar resultado de cliente — use demo real ou cenário hipotético",
  },
  {
    pattern: String.raw`\b(depoimento|segundo (o|a) cliente|disse (o|a) cliente)\b`,
    reason: "proibido depoimento de cliente gerado",
  },
];

/**
 * Checagens determinísticas, antes do LLM-juiz. Barram o que é regra fixa
 * de marca (renda, cases de cliente inventados...) e limites de plataforma.
 */
export function deterministicIssues(pkg: ContentPackage, rules: BrandRules): string[] {
  const issues: string[] = [];
  const texts = [
    pkg.script ?? "",
    pkg.chosenHook ?? "",
    ...pkg.slides.flatMap((s) => [s.title, s.body, s.code ?? ""]),
    ...pkg.variants.flatMap((v) => [v.caption, ...v.threadParts]),
  ].join("\n");

  for (const { pattern, reason } of [...IMMUTABLE_PATTERNS, ...rules.forbiddenPatterns]) {
    if (new RegExp(pattern, "iu").test(texts)) issues.push(`Regra de marca: ${reason}`);
  }

  for (const v of pkg.variants) {
    if (v.status === "disabled") continue;
    const lim = CAPTION_LIMITS[v.platform];
    for (const [i, part] of [v.caption, ...v.threadParts].entries()) {
      const where = i === 0 ? `${v.platform}` : `${v.platform} (parte ${i + 1})`;
      if ([...part].length > lim.maxChars) issues.push(`${where}: legenda acima de ${lim.maxChars} caracteres`);
      if (!lim.allowLinks && LINK.test(part)) issues.push(`${where}: link não permitido nesta plataforma`);
    }
    const hashtags = v.caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    if (hashtags.length > lim.maxHashtags) issues.push(`${v.platform}: ${hashtags.length} hashtags (máx. ${lim.maxHashtags})`);
  }

  if (rules.noClonedVoicePillars.includes(pkg.pillar) && pkg.features.voice === "clone") {
    issues.push(`Pilar "${pkg.pillar}" não pode usar voz clonada`);
  }

  const thirdParty = pkg.sources.filter((s) => s.license === "nenhum");
  if (thirdParty.length) issues.push("Fonte sem licença de uso (license=nenhum)");

  return [...new Set(issues)];
}
