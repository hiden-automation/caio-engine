import type { ContentPackage, Strategy } from "@jarvis/core/schemas";

export type { ContentPackage, Variant, Review } from "@jarvis/core/schemas";

export interface VariantSummary {
  id: string;
  platform: string;
  kind: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  permalink?: string;
  error?: string;
}

export interface PackageSummary {
  id: string;
  topic: string;
  pillar: string;
  format: string;
  status: string;
  cover?: string;
  variants: VariantSummary[];
}

export interface Feed {
  generatedAt: string;
  pending: ContentPackage[];
  /** Agendados, com o conteúdo completo (dá para rever e tirar da agenda). */
  scheduled: ContentPackage[];
  /** Ajustes pedidos que o motor está refazendo agora. */
  editing?: { id: string; hook: string; format: string; note: string; at: string }[];
  /** Rejeitados por ele, expirados e reprovados pelo revisor (dá para recuperar). */
  rejected?: ContentPackage[];
  published: PackageSummary[];
  counts: Record<string, number>;
  spendBrl: number;
  health: { checkedAt: string; checks: { name: string; ok: boolean; detail: string }[] } | null;
  proposals: { createdAt: string; proposals: { dimension: string; key: string; current: number; target: number; applied: number }[] } | null;
  strategy: Strategy;
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  x: "X",
};

export const PILLAR_LABEL: Record<string, string> = {
  computacao: "Computação & IA",
  geek: "Geek",
  bastidores: "Bastidores",
  jarvis: "JARVIS",
  liberdade: "Liberdade & fé",
};
