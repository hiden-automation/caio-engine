/**
 * Logger seguro para repositório público: os logs do Actions do caio-engine
 * são visíveis para qualquer pessoa, então só registramos ids, status e
 * contagens — nunca legendas, roteiros, URLs de mídia ou tokens.
 */
type Meta = Record<string, string | number | boolean | undefined>;

const FORBIDDEN_KEYS = /caption|script|text|body|url|token|secret|key|hook|title/i;

export function log(event: string, meta: Meta = {}): void {
  const safe: Meta = {};
  for (const [k, v] of Object.entries(meta)) {
    safe[k] = FORBIDDEN_KEYS.test(k) ? "[omitido]" : v;
  }
  const parts = Object.entries(safe)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  console.log(`[jarvis] ${event}${parts.length ? " " + parts.join(" ") : ""}`);
}

export function logError(event: string, err: unknown, meta: Meta = {}): void {
  const name = err instanceof Error ? err.constructor.name : typeof err;
  // A mensagem pode conter conteúdo; no Actions público registramos só o tipo.
  const detail = process.env.JARVIS_VERBOSE_ERRORS === "1" && err instanceof Error ? err.message : undefined;
  log(`ERRO ${event}`, { ...meta, error: name, detail });
}
