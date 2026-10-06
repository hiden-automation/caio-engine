import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { Budget, FsStore, type Platform, type Variant } from "@jarvis/core";
import { Llm, stableSystem, type WriterOutput } from "@jarvis/llm";
import type { Insights, Publisher, ResolvedAsset } from "@jarvis/publishers";
import { VisualTokens } from "@jarvis/visuals";
import type { Ctx } from "./context.ts";
import { initData } from "./init-data.ts";
import { produce } from "./produce.ts";
import { applyReviews } from "./reviews.ts";
import { publish } from "./publish.ts";
import { snapshot } from "./snapshot.ts";
import { optimize } from "./optimize.ts";

const WRITER: WriterOutput = {
  topic: "Algoritmo genético nos bairros de SP",
  angle: "evolução resolvendo rota",
  hookType: "eu_fiz",
  hooks: ["a", "b", "c"],
  chosenHook: "Deixei a evolução achar a rota",
  firstFrame: "simulacao",
  series: "Evolução ao vivo",
  slides: [
    { title: "Deixei a **evolução** achar a rota", body: "", visual: "capa", code: "" },
    { title: "Geração 0", body: "caos", visual: "sim:0", code: "" },
    { title: "Salva aí", body: "segue pra mais", visual: "cta", code: "" },
  ],
  variants: [
    { platform: "instagram", kind: "carousel", caption: "Legenda IG #ia", threadParts: [] },
    { platform: "linkedin", kind: "document", caption: "Post LinkedIn", threadParts: [] },
    { platform: "x", kind: "carousel", caption: "Post X", threadParts: [] },
    { platform: "threads", kind: "carousel", caption: "Post Threads", threadParts: [] },
  ],
  sources: [],
};

/** Cliente falso: responde como roteirista ou juiz conforme a tarefa. */
function fakeAnthropic(judgeScores: number[]): Anthropic {
  return {
    beta: {
      messages: {
        parse: async (params: { messages: { content: string }[] }) => {
          const user = String(params.messages[0]!.content);
          const parsed = user.includes("revisor de qualidade")
            ? { score: judgeScores.shift() ?? 9, blocking: false, issues: [], fixInstructions: "" }
            : WRITER;
          return {
            model: "claude-opus-5-5",
            usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
            stop_details: null,
            parsed_output: parsed,
          };
        },
      },
    },
  } as unknown as Anthropic;
}

class FakePublisher implements Publisher {
  readonly needsPublicUrls = false;
  calls: { variant: Variant; assets: ResolvedAsset[] }[] = [];
  constructor(readonly platform: Platform) {}
  async publish(variant: Variant, assets: ResolvedAsset[]) {
    this.calls.push({ variant, assets });
    return { externalId: `${this.platform}-${this.calls.length}` };
  }
  async insights(): Promise<Insights> {
    return { views: 1000, likes: 50, shares: 10, saves: 8, comments: 4 };
  }
}

async function makeCtx(now: Date, judgeScores: number[]): Promise<Ctx> {
  const root = await mkdtemp(join(tmpdir(), "jarvis-"));
  const dataDir = join(root, "data");
  await initData(dataDir);
  const store = new FsStore(dataDir, join(root, "previews"));
  const budget = new Budget(store);
  const llm = new Llm(budget, fakeAnthropic(judgeScores));
  const rules = await store.brandRules();
  return {
    store,
    budget,
    now,
    dryRun: false,
    platforms: ["instagram", "linkedin", "x", "threads"],
    llm: () => llm,
    brand: async () => ({ rules, system: stableSystem(await store.brandBible(), "", rules) }),
    tokens: async () => VisualTokens.parse({}),
  };
}

describe("pipeline de ponta a ponta (LLM e redes simuladas)", () => {
  it("produz → PWA aprova → agenda → publica → mede → otimiza", { timeout: 120_000 }, async () => {
    const ctx = await makeCtx(new Date("2026-10-06T12:00:00Z"), [5, 9]); // 1ª versão reprovada no QA
    const { created } = await produce(ctx, { count: 1 });
    expect(created).toBe(1);

    const [pkg] = await ctx.store.listPackages(["pending_review"]);
    expect(pkg!.qaAttempts).toBe(2); // reescreveu depois do QA
    expect(pkg!.assets.filter((a) => a.kind === "image")).toHaveLength(3);
    expect(pkg!.assets.some((a) => a.kind === "pdf")).toBe(true);
    const files = await readdir(join(ctx.store.previewsDir, pkg!.createdAt.slice(0, 7), pkg!.id));
    expect(files.filter((f) => f.endsWith(".jpg"))).toHaveLength(3);

    // Decisão gravada pelo PWA: aprova, desliga o X e edita a legenda do IG.
    await writeFile(
      ctx.store.path(`reviews/${pkg!.id}-1.json`),
      JSON.stringify({
        packageId: pkg!.id,
        decision: "approve",
        at: ctx.now.toISOString(),
        variantToggles: { "x-carousel": false },
        captionEdits: { "instagram-carousel": "Legenda editada no celular" },
      }),
    );
    expect((await applyReviews(ctx)).applied).toBe(1);
    const scheduled = (await ctx.store.loadPackage(pkg!.id))!;
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.variants.find((v) => v.platform === "x")!.status).toBe("disabled");
    for (const v of scheduled.variants.filter((x) => x.status === "approved")) {
      expect(new Date(v.scheduledAt!).getTime()).toBeGreaterThan(ctx.now.getTime());
    }

    // Nada publica antes do horário.
    const pubs = Object.fromEntries((["instagram", "linkedin", "x", "threads"] as const).map((p) => [p, new FakePublisher(p)]));
    expect((await publish(ctx, pubs)).published).toBe(0);

    // Dois dias depois: tudo no horário.
    const later = { ...ctx, now: new Date("2026-10-08T12:00:00Z") };
    expect((await publish(later, pubs)).published).toBe(3);
    expect(pubs.instagram!.calls[0]!.variant.caption).toBe("Legenda editada no celular");
    expect(pubs.linkedin!.calls[0]!.assets[0]!.asset.kind).toBe("pdf");
    expect(pubs.x!.calls).toHaveLength(0);
    const done = (await later.store.loadPackage(pkg!.id))!;
    expect(done.status).toBe("published");

    // Idempotente: rodar de novo não republica.
    expect((await publish(later, pubs)).published).toBe(0);

    const week = { ...ctx, now: new Date("2026-10-15T13:00:00Z") };
    expect(await snapshot(week, pubs)).toBe(3);
    expect(await snapshot(week, pubs)).toBe(0); // mesma janela não duplica
    const opt = await optimize(week);
    expect(opt.changed).toBe(false); // poucos dados: só observa
  });

  it("descarta o pacote que viola regra de marca mesmo com nota alta do juiz", { timeout: 120_000 }, async () => {
    const ctx = await makeCtx(new Date("2026-10-06T12:00:00Z"), [10, 10]);
    WRITER.variants[0]!.caption = "Esse mês faturei R$ 40 mil com automação";
    try {
      const r = await produce(ctx, { count: 1 });
      expect(r.created).toBe(0);
      expect(r.discarded).toBe(1);
    } finally {
      WRITER.variants[0]!.caption = "Legenda IG #ia";
    }
  });
});

describe("gc", () => {
  it("mantém artes de pacotes vivos e apaga as de pacotes antigos encerrados", async () => {
    const { referencedPaths } = await import("./gc.ts");
    const { fakePackage } = await import("@jarvis/core");
    const asset = (path: string) => ({ id: "a", kind: "image" as const, path, role: "slide" as const, order: 0 });
    const keep = referencedPaths(
      [
        fakePackage({ id: "vivo", status: "pending_review", assets: [asset("m/vivo/1.jpg")] }),
        fakePackage({ id: "velho", status: "published", updatedAt: "2026-09-01T00:00:00.000Z", assets: [asset("m/velho/1.jpg")] }),
        fakePackage({ id: "recente", status: "published", updatedAt: "2026-10-05T00:00:00.000Z", assets: [asset("m/recente/1.jpg")] }),
      ],
      new Date("2026-10-06T00:00:00Z"),
    );
    expect([...keep].sort()).toEqual(["m/recente/1.jpg", "m/vivo/1.jpg"]);
  });
});

describe("produção só com Instagram", () => {
  it("não sorteia formato que nenhuma rede ligada aceita", { timeout: 120_000 }, async () => {
    const ctx = { ...(await makeCtx(new Date("2026-10-06T12:00:00Z"), [])), platforms: ["instagram"] as Platform[] };
    await produce(ctx, { count: 8 });
    const pkgs = await ctx.store.listPackages();
    expect(pkgs.length).toBe(8);
    for (const p of pkgs) {
      expect(p.format).not.toBe("text");
      expect(p.variants.every((v) => v.platform === "instagram")).toBe(true);
    }
  });
});
