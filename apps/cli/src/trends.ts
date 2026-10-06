import { rm } from "node:fs/promises";
import { z } from "zod";
import { log, newId, type Idea, type Signal } from "@jarvis/core";
import { triageSignals } from "@jarvis/llm";
import { buildCollectors, collectAll, hypeScore, mergeSignals, scoreSignals, TrendsConfig } from "@jarvis/trends";
import { setOutput, type Ctx } from "./context.ts";

const EXPRESS_TTL_H = 6;

const InboxItem = z.object({ at: z.string(), text: z.string().default(""), url: z.string().optional() });

/** Ideias e links que o Caio jogou na Caixa de ideias do PWA (inbox/). */
async function readInbox(ctx: Ctx): Promise<{ files: string[]; signals: Signal[] }> {
  const files = (await ctx.store.list("inbox")).filter((f) => !f.includes("processed"));
  const signals: Signal[] = [];
  for (const f of files) {
    const item = await ctx.store.readJson(f, InboxItem);
    signals.push({
      id: `inbox:${f.split(/[\\/]/).pop()!.replace(".json", "")}`,
      collector: "inbox",
      title: item.text || item.url || "(ideia sem texto)",
      url: item.url,
      observedAt: item.at,
      // Ideia do próprio Caio entra no topo da triagem.
      value: 1e9,
      velocity: 1e9,
      tags: ["caio"],
    });
  }
  return { files, signals };
}
const IDEA_TTL_H = 72;

/** Coleta → hype score → triagem do LLM → ideias (e via expressa 🔥). */
export async function trends(ctx: Ctx): Promise<{ signals: number; ideas: number; express: string[] }> {
  const cfg = (await ctx.store.exists("trends.yml")) ? await ctx.store.readYaml("trends.yml", TrendsConfig) : TrendsConfig.parse({});
  const strategy = await ctx.store.strategy();
  const day = ctx.now.toISOString().slice(0, 10);

  const inbox = await readInbox(ctx);
  const fresh = [...inbox.signals, ...(await collectAll(buildCollectors(cfg), ctx.now))];
  const merged = mergeSignals(await ctx.store.loadSignals(day), fresh);
  await ctx.store.saveSignals(day, merged);

  // Só o que é novo nesta rodada e ainda não virou ideia vai para a triagem.
  const known = new Set((await ctx.store.listIdeas()).flatMap((i) => i.signalIds));
  const freshIds = new Set(fresh.map((s) => s.id));
  const scored = scoreSignals(merged, ctx.now).filter((s) => freshIds.has(s.signal.id) && !known.has(s.signal.id));
  const top = scored.slice(0, cfg.triageTopN);
  const verdicts = await triageSignals(ctx.llm(), await ctx.brand(), top.map((s) => s.signal));

  const ideas: Idea[] = [];
  for (const v of verdicts) {
    const s = top.find((x) => x.signal.id === v.signalId);
    if (!s || !v.keep) continue;
    const hype = hypeScore(s, v);
    if (hype < cfg.ideaThreshold) continue;
    const express = hype >= strategy.hypeExpressThreshold;
    const idea: Idea = {
      id: newId("i-", ctx.now),
      createdAt: ctx.now.toISOString(),
      title: v.title,
      angle: v.angle,
      pillar: v.pillar,
      suggestedFormat: ["carousel", "algoviz", "text", "story"].includes(v.suggestedFormat) ? v.suggestedFormat : "carousel",
      hypeScore: Math.round(hype * 1000) / 1000,
      express,
      status: "new",
      expiresAt: new Date(ctx.now.getTime() + (express ? EXPRESS_TTL_H : IDEA_TTL_H) * 3_600_000).toISOString(),
      signalIds: [s.signal.id],
      sources: s.signal.url ? [{ title: s.signal.title, url: s.signal.url, license: "citacao" }] : [],
    };
    await ctx.store.saveIdea(idea);
    ideas.push(idea);
  }

  for (const f of inbox.files) {
    await ctx.store.writeText(`inbox/processed/${f.split(/[\\/]/).pop()}`, await ctx.store.readText(f));
    await rm(ctx.store.path(f));
  }

  const express = ideas.filter((i) => i.express).map((i) => i.id);
  await setOutput("express_ids", express.join(","));
  log("trends.done", { signals: fresh.length, triaged: top.length, ideas: ideas.length, express: express.length });
  return { signals: fresh.length, ideas: ideas.length, express };
}
