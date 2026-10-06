import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { costUsd, Llm, RefusedError } from "./client.ts";

function fakeClient(response: Record<string, unknown>, seen: Record<string, unknown>[] = []): Anthropic {
  return {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          seen.push(params);
          return {
            model: "claude-opus-5-5",
            usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
            stop_details: null,
            ...response,
          };
        },
      },
    },
  } as unknown as Anthropic;
}

const Schema = z.object({ ok: z.boolean() });

describe("Llm", () => {
  it("devolve a saída parseada e manda o fallback de recusa no Opus 5.5", async () => {
    const seen: Record<string, unknown>[] = [];
    const llm = new Llm(undefined, fakeClient({ parsed_output: { ok: true } }, seen));
    const out = await llm.structured({ role: "writer", stableSystem: "s", user: "u", schema: Schema });
    expect(out.ok).toBe(true);
    expect(seen[0]!.fallbacks).toBe("default");
    expect(seen[0]!.model).toBe("claude-opus-5-5");
  });

  it("transforma recusa em erro tipado", async () => {
    const llm = new Llm(undefined, fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }));
    await expect(llm.structured({ role: "judge", stableSystem: "s", user: "u", schema: Schema })).rejects.toBeInstanceOf(RefusedError);
  });

  it("calcula custo com cache", () => {
    const usd = costUsd("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    } as Anthropic.Beta.BetaUsage);
    expect(usd).toBeCloseTo(4.2);
  });
});
