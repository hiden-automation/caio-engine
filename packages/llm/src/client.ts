import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { log, type Budget } from "@jarvis/core";

export type Role = "writer" | "judge" | "triage";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_MODEL = "claude-opus-5-5";
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
  return env[`JARVIS_MODEL_${role.toUpperCase()}`] ?? env.JARVIS_MODEL ?? DEFAULT_MODEL;
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
  private readonly client: Anthropic;

  constructor(
    private readonly budget?: Budget,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    await this.budget?.assertAvailable();
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
}
