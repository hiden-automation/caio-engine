import { spawn } from "node:child_process";
import { z } from "zod";

/**
 * Chama o Claude Code em modo não interativo (`claude -p`), logado na
 * assinatura (CLAUDE_CODE_OAUTH_TOKEN). Sem ferramentas: só texto entra e
 * JSON validado pelo schema sai.
 */
export interface ClaudeCodeResult {
  structured_output?: unknown;
  is_error?: boolean;
  subtype?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export type ClaudeCodeRunner = (args: string[], stdin: string) => Promise<string>;

export const runClaudeCli: ClaudeCodeRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const bin = process.env.JARVIS_CLAUDE_BIN ?? "claude";
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Saída JSON vem mesmo com exit != 0 (ex.: limite de uso); quem decide é o chamador.
      if (out.trim()) resolve(out);
      else reject(new Error(`claude saiu com código ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(stdin);
  });

export function claudeCodeArgs(model: string, effort: string, system: string, schema: z.ZodType, imageDirs: string[] = []): string[] {
  // Com imagens, o modelo precisa da ferramenta Read (só leitura) para enxergá-las.
  const tools = imageDirs.length ? ["--tools", "Read", "--allowedTools", "Read", ...imageDirs.flatMap((d) => ["--add-dir", d])] : ["--tools", ""];
  return [
    "-p",
    "--output-format", "json",
    "--model", model,
    "--effort", effort,
    ...tools,
    "--system-prompt", system,
    "--json-schema", JSON.stringify(jsonSchemaFor(schema)),
    "--no-session-persistence",
  ];
}

/** O validador do Claude Code não resolve o meta-schema 2020-12: tira o `$schema`. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
