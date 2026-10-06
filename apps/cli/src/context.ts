import { resolve } from "node:path";
import { Budget, FsStore, PLATFORMS, type Platform } from "@jarvis/core";
import { Llm, stableSystem, type BrandContext } from "@jarvis/llm";
import { VisualTokens } from "@jarvis/visuals";

export interface Ctx {
  store: FsStore;
  budget: Budget;
  now: Date;
  dryRun: boolean;
  /** Plataformas ligadas para produção (JARVIS_PLATFORMS). */
  platforms: Platform[];
  llm(): Llm;
  brand(): Promise<BrandContext>;
  tokens(): Promise<VisualTokens>;
}

export function createContext(env: NodeJS.ProcessEnv = process.env): Ctx {
  const dataDir = resolve(env.DATA_DIR ?? "../data");
  const store = new FsStore(dataDir, resolve(env.PREVIEWS_DIR ?? "../previews"));
  const budget = new Budget(store);
  const platforms = (env.JARVIS_PLATFORMS ?? "instagram,threads,linkedin,x")
    .split(",")
    .map((s) => s.trim())
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));

  let llm: Llm | undefined;
  let brand: BrandContext | undefined;
  return {
    store,
    budget,
    now: env.JARVIS_NOW ? new Date(env.JARVIS_NOW) : new Date(),
    dryRun: env.JARVIS_DRY_RUN === "1",
    platforms,
    llm: () => (llm ??= new Llm(budget)),
    brand: async () => {
      if (!brand) {
        const rules = await store.brandRules();
        brand = { rules, system: stableSystem(await store.brandBible(), await store.playbook(), rules) };
      }
      return brand;
    },
    tokens: async () =>
      (await store.exists("brand/visual-tokens.json")) ? store.readJson("brand/visual-tokens.json", VisualTokens) : VisualTokens.parse({}),
  };
}

/** Escreve um output para o workflow (GITHUB_OUTPUT) quando disponível. */
export async function setOutput(name: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, `${name}=${value}\n`);
}
