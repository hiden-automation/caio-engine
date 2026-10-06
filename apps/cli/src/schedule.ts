import type { ContentPackage, Strategy, Variant } from "@jarvis/core";

/** São Paulo não tem horário de verão desde 2019: UTC−3 fixo. */
const SP_OFFSET_H = 3;

export function slotKey(v: Pick<Variant, "platform" | "kind">): string {
  // Story não disputa horário com post de feed.
  return v.kind === "story" ? `${v.platform}:story` : v.platform;
}

/** Próximo horário livre da plataforma depois de `after` (ISO em UTC). */
export function nextSlot(slots: string[], taken: Set<string>, after: Date): string {
  const spNow = new Date(after.getTime() - SP_OFFSET_H * 3_600_000);
  const sorted = [...slots].sort();
  for (let day = 0; day < 30; day++) {
    for (const hhmm of sorted) {
      const [h, m] = hhmm.split(":").map(Number) as [number, number];
      const t = new Date(Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), spNow.getUTCDate() + day, h + SP_OFFSET_H, m));
      if (t.getTime() <= after.getTime()) continue;
      const iso = t.toISOString();
      if (!taken.has(iso)) return iso;
    }
  }
  throw new Error("Sem horário livre nos próximos 30 dias");
}

/** Horários já ocupados por variantes agendadas, por chave de slot. */
export function takenSlots(pkgs: ContentPackage[]): Map<string, Set<string>> {
  const taken = new Map<string, Set<string>>();
  for (const p of pkgs) {
    for (const v of p.variants) {
      if (!v.scheduledAt || v.status === "disabled" || v.status === "failed") continue;
      const k = slotKey(v);
      if (!taken.has(k)) taken.set(k, new Set());
      taken.get(k)!.add(v.scheduledAt);
    }
  }
  return taken;
}

/**
 * Agenda as variantes aprovadas. Pacote expresso (tendência) vai o quanto
 * antes; o resto ocupa os horários do strategy.yml.
 */
export function scheduleVariants(pkg: ContentPackage, strategy: Strategy, taken: Map<string, Set<string>>, now: Date): ContentPackage {
  const after = new Date(now.getTime() + 10 * 60_000);
  const variants = pkg.variants.map((v) => {
    if (v.status !== "approved") return v;
    if (v.scheduledAt && new Date(v.scheduledAt) > now) return v; // horário escolhido no PWA
    if (pkg.express) return { ...v, scheduledAt: after.toISOString() };
    const k = slotKey(v);
    if (!taken.has(k)) taken.set(k, new Set());
    const iso = nextSlot(strategy.slots[v.platform] ?? ["12:00"], taken.get(k)!, after);
    taken.get(k)!.add(iso);
    return { ...v, scheduledAt: iso };
  });
  return { ...pkg, variants };
}
