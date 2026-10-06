import type { ContentPackage, PackageStatus } from "./schemas.ts";

const TRANSITIONS: Record<PackageStatus, PackageStatus[]> = {
  idea: ["scripted", "discarded"],
  scripted: ["rendered", "discarded", "failed"],
  rendered: ["qa_passed", "scripted", "discarded"],
  qa_passed: ["pending_review"],
  pending_review: ["approved", "rejected", "edit_requested", "expired"],
  edit_requested: ["scripted", "discarded"],
  approved: ["scheduled", "expired"],
  scheduled: ["publishing", "approved", "expired"],
  publishing: ["published", "scheduled", "failed"],
  published: [],
  failed: ["scheduled", "discarded"],
  rejected: [],
  expired: [],
  discarded: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: PackageStatus, to: PackageStatus) {
    super(`Transição inválida: ${from} → ${to}`);
  }
}

export function canTransition(from: PackageStatus, to: PackageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Retorna um novo pacote com o status trocado e o histórico registrado. */
export function transition(
  pkg: ContentPackage,
  to: PackageStatus,
  note?: string,
  now: Date = new Date(),
): ContentPackage {
  if (!canTransition(pkg.status, to)) throw new InvalidTransitionError(pkg.status, to);
  const at = now.toISOString();
  return {
    ...pkg,
    status: to,
    updatedAt: at,
    history: [...pkg.history, { at, from: pkg.status, to, ...(note ? { note } : {}) }],
  };
}

export function isTerminal(status: PackageStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
