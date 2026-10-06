import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { log, type Budget } from "@jarvis/core";
import { claudeCodeArgs, runClaudeCli, type ClaudeCodeResult, type ClaudeCodeRunner } from "./claude-code.ts";

export type Role = "writer" | "judge" | "triage";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_MODEL = "claude-opus-5-5";
/** Na assinatura não há custo por token, mas há cota: Sonnet rende mais. */
const DEFAULT_CC_MODEL = "sonnet";

/** "api" (paga por token) ou "claude-code" (assinatura, via `claude -p`). */
export function backend(env: NodeJS.ProcessEnv = process.env): "api" | "claude-code" {
  return env.JARVIS_LLM === "claude-code" ? "claude-code" : "api";
}
const DEFAULT_EFFORT: Record<Role, Effort> = { writer: "high", judge: "medium", triage: "low" };

/** US$ por milhão de tokens: [entrada, saída, leitura de cache, escrita de cache]. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25],
};

export class RefusedError extends Error {
  constructor(readonly category: string | null) {
    super(`Modelo recusou a tarefa (categoria: ${category ?? "n/d"})`);
  }
}

export class EmptyOutputError extends Error {}

/** Modelos que aceitam o fallback de recusa no servidor. */
function supportsFallback(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}

export function modelFor(role: Role, env: NodeJS.ProcessEnv = process.env): string {
  return env[`JARVIS_MODEL_${role.toUpperCase()}`] ?? env.JARVIS_MODEL ?? (backend(env) === "claude-code" ? DEFAULT_CC_MODEL : DEFAULT_MODEL);
}

export function effortFor(role: Role, env: NodeJS.ProcessEnv = process.env): Effort {
  return (env[`JARVIS_EFFORT_${role.toUpperCase()}`] as Effort | undefined) ?? DEFAULT_EFFORT[role];
}

export function costUsd(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  return (
    (usage.input_tokens * p[0] +
      usage.output_tokens * p[1] +
      (usage.cache_read_input_tokens ?? 0) * p[2] +
      (usage.cache_creation_input_tokens ?? 0) * p[3]) /
    1_000_000
  );
}

export interface StructuredRequest<S extends z.ZodType> {
  role: Role;
  /** Parte estável (bíblia da marca, regras): fica em cache entre chamadas. */
  stableSystem: string;
  user: string | Anthropic.Beta.BetaContentBlockParam[];
  schema: S;
  maxTokens?: number;
}

export class Llm {
  private client?: Anthropic;

  constructor(
    private readonly budget?: Budget,
    client?: Anthropic,
    private readonly claudeCode?: ClaudeCodeRunner,
  ) {
    this.client = client;
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    await this.budget?.assertAvailable();
    if (this.claudeCode || (!this.client && backend() === "claude-code")) return this.viaClaudeCode(req);
    this.client ??= new Anthropic();
    const model = modelFor(req.role);
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: "text", text: req.stableSystem, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
      output_config: { effort: effortFor(req.role), format: betaZodOutputFormat(req.schema) },
      ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    const usd = costUsd(response.model, response.usage);
    await this.budget?.add("anthropic", usd);
    log("llm.call", {
      role: req.role,
      model: response.model,
      in: response.usage.input_tokens,
      out: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      usd: usd.toFixed(4),
    });

    if (response.stop_reason === "refusal") throw new RefusedError(response.stop_details?.category ?? null);
    if (response.stop_reason === "max_tokens") throw new EmptyOutputError("Saída truncada em max_tokens");
    if (!response.parsed_output) throw new EmptyOutputError("Saída estruturada vazia");
    return response.parsed_output as z.infer<S>;
  }

  /** Assinatura: custo marginal zero, então nada entra no teto de gasto. */
  private async viaClaudeCode<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    if (typeof req.user !== "string") throw new Error("Modo claude-code só aceita entrada em texto");
    const model = modelFor(req.role);
    const raw = await (this.claudeCode ?? runClaudeCli)(claudeCodeArgs(model, effortFor(req.role), req.stableSystem, req.schema), req.user);
    let res: ClaudeCodeResult;
    try {
      res = JSON.parse(raw) as ClaudeCodeResult;
    } catch {
      throw new EmptyOutputError("Resposta do claude -p não é JSON");
    }
    log("llm.call", {
      role: req.role,
      backend: "claude-code",
      model: Object.keys(res.modelUsage ?? {})[0] ?? model,
      in: res.usage?.input_tokens ?? 0,
      out: res.usage?.output_tokens ?? 0,
      cacheRead: res.usage?.cache_read_input_tokens ?? 0,
    });
    if (res.stop_reason === "refusal") throw new RefusedError(null);
    if (res.is_error || res.structured_output == null) throw new EmptyOutputError(`claude -p falhou (${res.subtype ?? "sem saída estruturada"})`);
    return req.schema.parse(res.structured_output) as z.infer<S>;
  }
}
