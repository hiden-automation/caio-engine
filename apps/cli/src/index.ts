import { parseArgs } from "node:util";
import { BudgetExceededError, log, logError } from "@jarvis/core";
import { createContext } from "./context.ts";
import { doctor } from "./doctor.ts";
import { gc } from "./gc.ts";
import { writeFeed } from "./feed.ts";
import { initData } from "./init-data.ts";
import { optimize } from "./optimize.ts";
import { produce } from "./produce.ts";
import { publish } from "./publish.ts";
import { applyReviews } from "./reviews.ts";
import { snapshot } from "./snapshot.ts";
import { trends } from "./trends.ts";

const HELP = `jarvis <comando> [opções]

  init-data <pasta> [--force]   cria a estrutura do repositório caio-data
  trends                        caça tendências → ideias (e via expressa)
  produce [--count N] [--idea ID]  roteiro → arte → QA → fila do PWA
  reviews                       aplica decisões do PWA e agenda os aprovados
  publish                       publica o que está no horário (JARVIS_DRY_RUN=1 simula)
  snapshot                      coleta métricas (1h, 6h, 24h, 72h, 7d)
  optimize                      bandit → strategy.yml + propostas
  doctor [--refresh --out DIR]  saúde: credenciais, tokens, orçamento
  gc                            apaga artes antigas da branch previews
  feed                          só regera pwa/feed.json

Variáveis: DATA_DIR, PREVIEWS_DIR, JARVIS_PLATFORMS, ANTHROPIC_API_KEY, ...`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: "string" },
      idea: { type: "string" },
      force: { type: "boolean" },
      refresh: { type: "boolean" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, arg] = positionals;
  if (!cmd || values.help) {
    console.log(HELP);
    return;
  }
  if (cmd === "init-data") {
    if (!arg) throw new Error("Informe a pasta: jarvis init-data ../caio-data");
    await initData(arg, values.force);
    return;
  }

  const ctx = createContext();
  log("start", { cmd, dryRun: ctx.dryRun, platforms: ctx.platforms.join("+") });
  switch (cmd) {
    case "trends":
      await trends(ctx);
      break;
    case "produce":
      await produce(ctx, { count: values.count ? Number(values.count) : undefined, ideaId: values.idea });
      break;
    case "reviews":
      await applyReviews(ctx);
      break;
    case "publish":
      await publish(ctx);
      break;
    case "snapshot":
      await snapshot(ctx);
      break;
    case "optimize":
      await optimize(ctx);
      break;
    case "doctor": {
      const checks = await doctor(ctx, { refresh: values.refresh, outDir: values.out });
      if (checks.some((c) => !c.ok && c.name.startsWith("Renovação"))) process.exitCode = 1;
      break;
    }
    case "gc":
      await gc(ctx);
      break;
    case "feed":
      break;
    default:
      console.log(HELP);
      process.exitCode = 2;
      return;
  }
  // Toda execução deixa o PWA atualizado.
  await writeFeed(ctx);
}

main().catch((err) => {
  if (err instanceof BudgetExceededError) {
    log("pausado: teto de orçamento atingido");
    return;
  }
  logError("fatal", err);
  process.exitCode = 1;
});
