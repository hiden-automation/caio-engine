import { writeFile } from "node:fs/promises";
import { log, logError } from "@jarvis/core";
import { InstagramPublisher, ThreadsPublisher } from "@jarvis/publishers";
import type { Ctx } from "./context.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Saúde do sistema: credenciais, tokens perto de expirar, orçamento.
 * Com --refresh renova os tokens de IG/Threads (60 dias) e grava em
 * arquivos que o workflow usa para atualizar os Secrets.
 */
export async function doctor(ctx: Ctx, opts: { refresh?: boolean; outDir?: string } = {}, env: NodeJS.ProcessEnv = process.env): Promise<Check[]> {
  const checks: Check[] = [];
  const has = (...keys: string[]) => keys.every((k) => !!env[k]);

  checks.push({ name: "Claude API", ok: has("ANTHROPIC_API_KEY"), detail: "ANTHROPIC_API_KEY" });
  checks.push({ name: "caio-cdn", ok: has("CDN_BASE_URL", "CDN_PUSH_URL"), detail: "necessário para Instagram e Threads" });
  checks.push({ name: "Instagram", ok: has("IG_USER_ID", "IG_TOKEN"), detail: "IG_USER_ID, IG_TOKEN" });
  checks.push({ name: "Threads", ok: has("THREADS_USER_ID", "THREADS_TOKEN"), detail: "THREADS_USER_ID, THREADS_TOKEN" });
  checks.push({ name: "LinkedIn", ok: has("LINKEDIN_PERSON_URN", "LINKEDIN_TOKEN"), detail: "LINKEDIN_PERSON_URN, LINKEDIN_TOKEN" });
  checks.push({ name: "X", ok: has("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"), detail: "4 chaves OAuth 1.0a" });
  checks.push({ name: "YouTube (tendências)", ok: has("YOUTUBE_API_KEY"), detail: "opcional no Sprint 1" });

  if (env.LINKEDIN_TOKEN_CREATED) {
    const ageDays = (ctx.now.getTime() - new Date(env.LINKEDIN_TOKEN_CREATED).getTime()) / 86_400_000;
    checks.push({ name: "Token LinkedIn", ok: ageDays < 50, detail: `${Math.floor(ageDays)} de 60 dias: reautentique antes de vencer` });
  }

  const spent = await ctx.budget.totalBrl();
  checks.push({ name: "Orçamento do mês", ok: spent < Number(env.JARVIS_BUDGET_BRL ?? 450), detail: `R$ ${spent.toFixed(2)}` });

  if (opts.refresh && opts.outDir) {
    const refreshers: [string, () => Promise<{ token: string }>][] = [];
    if (has("IG_USER_ID", "IG_TOKEN")) refreshers.push(["IG_TOKEN", () => new InstagramPublisher(env.IG_USER_ID!, env.IG_TOKEN!).refreshToken()]);
    if (has("THREADS_USER_ID", "THREADS_TOKEN")) refreshers.push(["THREADS_TOKEN", () => new ThreadsPublisher(env.THREADS_USER_ID!, env.THREADS_TOKEN!).refreshToken()]);
    for (const [secret, fn] of refreshers) {
      try {
        const { token } = await fn();
        await writeFile(`${opts.outDir}/${secret}`, token, { mode: 0o600 });
        checks.push({ name: `Renovação ${secret}`, ok: true, detail: "renovado" });
      } catch (err) {
        logError("doctor.refresh", err, { secret });
        checks.push({ name: `Renovação ${secret}`, ok: false, detail: "falhou" });
      }
    }
  }

  for (const c of checks) log(`doctor ${c.ok ? "OK " : "FALTA"}`, { check: c.name, info: c.detail });
  await ctx.store.writeJson("health.json", { checkedAt: ctx.now.toISOString(), checks });
  return checks;
}
