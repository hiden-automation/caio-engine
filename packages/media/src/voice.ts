import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG, probe, run } from "./ffmpeg.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/tts.py", import.meta.url));

/** Palavra narrada, com início e duração em segundos (relativos ao áudio da cena). */
export interface Word {
  t: number;
  d: number;
  w: string;
}

export interface Narration {
  file: string;
  durationSec: number;
  words: Word[];
}

/**
 * Como o locutor deve falar nomes e siglas (o texto na tela continua escrito
 * do jeito certo). Ex.: "ChatGPT" → "Chat GPT".
 */
const SPOKEN: [RegExp, string][] = [
  [/\bchat\s*gpt\b/gi, "Chat G P T"],
  [/\bchat\s*ggt\b/gi, "Chat G P T"],
  [/\bGPT\b/g, "G P T"],
  [/\bLLMs?\b/g, "L L M"],
  [/\bCEO\b/g, "C E O"],
  [/\bAPIs?\b/g, "A P I"],
  [/\bPMEs?\b/g, "pequena empresa"],
  [/\bR2-D2\b/gi, "R2 D2"],
  [/\bIA\b/g, "I A"],
];

export function spoken(text: string): string {
  return SPOKEN.reduce((t, [re, to]) => t.replace(re, to), text);
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * A legenda mostra o texto escrito, não a pronúncia: as palavras faladas
 * ("I", "A") voltam a ser a palavra original ("IA"), com o tempo somado.
 */
export function writtenWords(original: string, words: Word[]): Word[] {
  const tokens = original.split(/\s+/).filter(Boolean);
  const said = tokens.flatMap((tok, oi) => spoken(tok).split(/\s+/).filter(Boolean).map((sub) => ({ n: norm(sub), oi })));
  let p = 0;
  const owner = words.map((w) => {
    const n = norm(w.w);
    const hit = said.slice(p, p + 5).findIndex((x) => x.n === n);
    const at = hit >= 0 ? p + hit : Math.min(p, said.length - 1);
    p = at + 1;
    return said[at]?.oi ?? -1;
  });
  const out: Word[] = [];
  for (const [j, w] of words.entries()) {
    const oi = owner[j]!;
    const prev = out.at(-1);
    if (prev && oi >= 0 && owner[j - 1] === oi) {
      prev.d = w.t + w.d - prev.t;
      continue;
    }
    const text = oi >= 0 ? tokens[oi]!.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "") : w.w;
    out.push({ t: w.t, d: w.d, w: text || w.w });
  }
  return out;
}

/** Locutor padrão até a voz do Caio ser clonada (JARVIS_VOICE troca). */
export const DEFAULT_VOICE = "pt-BR-AntonioNeural";

/** Gera a narração de cada cena (voz neural de locutor) com o tempo de cada palavra. */
export async function narrate(texts: string[], dir: string, opts: { voice?: string; rate?: string } = {}): Promise<(Narration | undefined)[]> {
  const items = texts.map((text, i) => ({ text: spoken(text.trim()), out: join(dir, `narracao-${i + 1}.mp3`) })).filter((x) => x.text);
  if (!items.length) return texts.map(() => undefined);
  const req = join(dir, "narracao.json");
  await writeFile(req, JSON.stringify({ voice: opts.voice ?? process.env.JARVIS_VOICE ?? DEFAULT_VOICE, rate: opts.rate ?? process.env.JARVIS_VOICE_RATE ?? "+8%", items }), "utf8");
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [SCRIPT, req], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`narração falhou: ${err.slice(-300)}`))));
  });
  return Promise.all(
    texts.map(async (text, i) => {
      if (!text.trim()) return undefined;
      const file = join(dir, `narracao-${i + 1}.mp3`);
      const said = JSON.parse(await readFile(file.replace(/\.mp3$/, ".json"), "utf8")) as Word[];
      return { file, durationSec: (await probe(file)).durationSec, words: writtenWords(text.trim(), said) };
    }),
  );
}

export interface AudioCue {
  file: string;
  /** Início no vídeo (s). */
  at: number;
  /** Trecho do arquivo (s), para áudio original de vídeo de terceiro. */
  from?: number;
  duration?: number;
  volume?: number;
}

/**
 * Mixa narração e trechos originais sobre a trilha. A trilha abaixa sozinha
 * quando alguém fala (sidechain), como numa edição de verdade.
 */
export async function mixAudio(cues: AudioCue[], music: string | undefined, totalSec: number, out: string): Promise<void> {
  const args = ["-v", "error", "-y"];
  const filters: string[] = [];
  const labels: string[] = [];
  cues.forEach((c, i) => {
    if (c.from !== undefined) args.push("-ss", c.from.toFixed(2));
    if (c.duration !== undefined) args.push("-t", c.duration.toFixed(2));
    args.push("-i", c.file);
    const ms = Math.round(c.at * 1000);
    filters.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${c.volume ?? 1},adelay=${ms}|${ms}[v${i}]`);
    labels.push(`[v${i}]`);
  });
  const voiceMix = labels.length ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad[voz]` : "";
  if (voiceMix) filters.push(voiceMix);
  if (music) {
    const m = cues.length;
    args.push("-i", music);
    filters.push(`[${m}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.55[mus]`);
    if (voiceMix) {
      filters.push(`[voz]asplit=2[voz1][sc]`);
      filters.push(`[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]`);
      filters.push(`[voz1][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]`);
    } else filters.push(`[mus]anull[out]`);
  } else filters.push(`[voz]alimiter=limit=0.95[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", totalSec.toFixed(2), "-c:a", "pcm_s16le", out);
  await run(FFMPEG, args);
}
